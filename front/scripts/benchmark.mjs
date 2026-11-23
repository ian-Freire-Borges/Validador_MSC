import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import catalog from '../src/catalog-2026.json' with { type: 'json' };
import { decodeLines } from '../src/csv.ts';
import { validate } from '../src/validation.ts';

const destination = process.argv[2] ?? 'dist/benchmark';
mkdirSync(destination, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const distribution = [
  [['10131', 'PO']],
  [['10131', 'PO'], ['1', 'FP']],
  [['10131', 'PO'], ['2', 'FP'], ['0000', 'FR']],
];

function fixture(records, dense) {
  const header = '3550308EX;2026-01\n' + catalog.header.join(';') + '\n';
  const rows = distribution.map(pairs => [
    '111110100',
    ...pairs.flatMap(([ic, type]) => [dense && type === 'PO' ? '99999' : ic, type]),
    ...Array(12 - pairs.length * 2).fill(''),
    dense ? '-1' : '12.34', dense ? 'invalid' : 'ending_balance', dense ? 'X' : 'D',
  ].join(';') + '\n');
  const counts = distribution.map((_, index) => Math.floor((records + 2 - index) / 3));
  const repetitions = Math.floor(records / rows.length);
  const text = header + rows.join('').repeat(repetitions) + rows.slice(0, records % rows.length).join('');
  return { bytes: Buffer.from(text), counts };
}

const corpus = [];
for (const records of [1000, 10000, 50000]) {
  for (const dense of [false, true]) {
    const { bytes, counts } = fixture(records, dense);
    const name = records + (dense ? '-muitos-achados.csv' : '-limpo.csv');
    writeFileSync(join(destination, name), bytes);
    const expected = dense ? { E06: records, E07: records, E08: records, C08: records, E09: 1 } : {};
    corpus.push({
      name, records, physicalLines: records + 2, bytes: bytes.length, sha256: hash(bytes),
      distribution: Object.fromEntries(distribution.map((pairs, index) => [pairs.map(pair => pair[1]).join('+'), counts[index]])),
      expected, diagnosticsPerRecord: Object.values(expected).reduce((sum, count) => sum + count, 0) / records,
    });
  }
}

const runs = [];
for (const sample of corpus) {
  for (let index = 0; index < 4; index++) {
    const before = process.memoryUsage();
    const start = performance.now();
    const file = readFileSync(join(destination, sample.name));
    const readMs = performance.now() - start;
    const analyzeStart = performance.now();
    const result = validate(file, 'UTF-8', catalog);
    const finished = performance.now();
    const after = process.memoryUsage();
    assert.equal(result.records, sample.records);
    const observed = {};
    for (const item of result.findings) observed[item.id] = (observed[item.id] ?? 0) + 1;
    assert.deepEqual(observed, sample.expected);

    const decodeStart = performance.now();
    let lines = 0;
    for (const line of decodeLines(file, 'UTF-8')) {
      assert.ok(!line.fault);
      lines++;
    }
    assert.equal(lines, sample.physicalLines);
    runs.push({
      sample: sample.name, repetition: index + 1, firstForSample: index === 0, readMs,
      decodeAndAnalyzeMs: finished - analyzeStart, totalMs: finished - start,
      decodeOnlyMs: performance.now() - decodeStart, heapDeltaBytes: after.heapUsed - before.heapUsed,
      rssDeltaBytes: after.rss - before.rss, findings: result.findings.length,
    });
  }
}
const evidence = {
  environment: { os: platform(), release: release(), node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
  catalog: catalog.version, corpus, runs,
};
writeFileSync(join(destination, 'motor.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('Benchmark do motor:', corpus.length, 'amostras,', runs.length, 'execuções,', join(destination, 'motor.json'));
