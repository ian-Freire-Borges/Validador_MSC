import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';

const front = new URL('../', import.meta.url);
const evidence = new URL('dist/test-gate/', front);
const coverageGlob = 'src/**/*.ts';
const baseline = { commit: '059f44b', line: 97.87, branch: 95.52, function: 99.18 };

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runProcess(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: fileURLToPath(front), env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status;
}

function installLockedDependencies() {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Execute o gate por npm run test:gate.');
  const manifest = readJson(new URL('package.json', front));
  const lockfile = new URL('package-lock.json', front);
  const beforeInstall = readFileSync(lockfile);
  const rootLock = JSON.parse(beforeInstall.toString('utf8')).packages?.[''];
  assert.ok(rootLock, 'package-lock.json sem os metadados do pacote raiz.');
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(rootLock[group] ?? {}, manifest[group] ?? {}, group + ' deve coincidir com o package-lock.json.');
  }
  const status = runProcess([npmCli, 'ci', '--no-audit', '--no-fund']);
  assert.ok(beforeInstall.equals(readFileSync(lockfile)), 'npm ci alterou o package-lock.json.');
  assert.equal(status, 0, 'npm ci falhou.');
}

async function checkNodeSuite() {
  let coverage;
  let summary;
  const cwd = fileURLToPath(front);
  const files = globSync('tests/*.test.mjs', { cwd }).map(file => resolve(cwd, file));
  assert.ok(files.length, 'A suíte Node não contém arquivos de teste.');
  const filesWithTests = new Set();
  const tests = run({
    cwd, files,
    coverage: true, coverageIncludeGlobs: [coverageGlob],
  });
  for await (const event of tests) {
    if (event.type === 'test:coverage') coverage = event.data.summary;
    if (event.type === 'test:summary') {
      if (event.data.file === undefined) summary = event.data;
      else if (event.data.counts.tests > 0) filesWithTests.add(event.data.file);
    }
    if (event.type === 'test:fail') console.error(event.data.name, event.data.details.error);
  }
  assert.ok(summary, 'O executor Node não produziu um resumo.');
  const { passed, failed, cancelled, skipped, todo } = summary.counts;
  console.log(`Node: ${passed} passaram, ${failed} falharam, ${cancelled} cancelados, ${skipped} pulados, ${todo} pendentes.`);
  if (coverage?.totals.totalLineCount > 0) {
    const totals = {
      line: coverage.totals.coveredLinePercent,
      branch: coverage.totals.coveredBranchPercent,
      function: coverage.totals.coveredFunctionPercent,
    };
    const comparison = Object.fromEntries(Object.entries(totals).map(([metric, percent]) => {
      const current = Number(percent.toFixed(2));
      const deltaPoints = Number((current - baseline[metric]).toFixed(2));
      return [metric, { current, baseline: baseline[metric], deltaPoints }];
    }));
    writeFileSync(new URL('node-coverage.json', evidence), JSON.stringify({
      nodeVersion: process.version, scope: coverageGlob, baselineCommit: baseline.commit, comparison, coverage,
    }, null, 2) + '\n');
    console.log('Cobertura do Node e diferença em pontos percentuais em relação a ' + baseline.commit);
    console.table(comparison);
  }
  // O executor pode contar um arquivo sem casos como um teste passado no resumo global.
  const emptyFiles = files.filter(file => !filesWithTests.has(file));
  assert.ok(!emptyFiles.length, 'Arquivos sem casos executados no Node: ' + emptyFiles.join(', '));
  assert.ok(summary.success && passed > 0 && !failed && !cancelled && !skipped && !todo,
    'A suíte Node deve executar testes e terminar sem falhas, cancelamentos, skips ou todos.');
  assert.ok(coverage?.totals.totalLineCount > 0, 'O executor Node não mediu a cobertura do código fonte.');
}

function playwrightTests(suites) {
  return suites.flatMap(suite => [
    ...suite.specs.flatMap(spec => spec.tests),
    ...playwrightTests(suite.suites ?? []),
  ]);
}

function checkPlaywrightSuite() {
  const playReport = new URL('playwright.json', evidence);
  const cli = fileURLToPath(new URL('node_modules/@playwright/test/cli.js', front));
  const status = runProcess([cli, 'test', '--forbid-only', '--reporter=json'], {
    ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: fileURLToPath(playReport),
  });
  let report;
  try {
    report = readJson(playReport);
  } catch (error) {
    throw new Error('O Playwright não gerou um relatório. Confira o build, o servidor local e o Chromium headless.', { cause: error });
  }
  const tests = playwrightTests(report.suites);
  for (const error of report.errors) console.error(error.message);
  for (const test of tests) {
    for (const result of test.results) {
      for (const error of result.errors) console.error(error.message);
    }
  }
  console.log(`Playwright: ${report.stats.expected} esperados, ${report.stats.unexpected} inesperados, ${report.stats.skipped} pulados, ${report.stats.flaky} instáveis.`);
  assert.ok(status === 0 && report.errors.length === 0 && tests.length > 0 &&
    tests.every(test => test.expectedStatus === 'passed' && test.results.length > 0 &&
      test.results.every(result => result.status === 'passed')),
    'A suíte Playwright deve compilar e executar testes headless sem falhas, skips, todos ou interrupções.');
}

try {
  mkdirSync(evidence, { recursive: true });
  for (const file of ['node-coverage.json', 'playwright.json']) rmSync(new URL(file, evidence), { force: true });
  installLockedDependencies();
  await checkNodeSuite();
  checkPlaywrightSuite();
  console.log('Gate automatizado concluído. Consulte os relatórios em dist/test-gate/.');
} catch (error) {
  console.error('Gate reprovado.', error.message);
  process.exitCode = 1;
}
