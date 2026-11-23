import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { columns } from '../src/catalog.ts';

test('Worker carrega o catálogo, publica progresso e retorna a validação', { timeout: 10000 }, async t => {
  const location = new URL('../src/validation.worker.ts', import.meta.url).href;
  const entrypoint = `
    import { parentPort } from 'node:worker_threads';
    globalThis.postMessage = message => parentPort.postMessage(message);
    globalThis.addEventListener = (event, callback) => {
      if (event === 'message') parentPort.on('message', data => callback({ data }));
    };
    await import(${JSON.stringify(location)});
  `;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(entrypoint)));
  t.after(() => worker.terminate());

  const csv = ['3550308EX;2026-01', columns.join(';'),
    '111110100;10131;PO;;;;;;;;;;;10;beginning_balance;D',
    '111110100;10131;PO;;;;;;;;;;;10;period_change;C'].join('\n');
  const messages = [];
  const result = await new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', message => {
      messages.push(message.type);
      if (message.type === 'complete') resolve(message.result);
      if (message.type === 'error') reject(new Error(message.stage));
    });
    worker.postMessage({ file: new Blob([csv]), encoding: 'UTF-8' });
  });

  assert.deepEqual(messages, ['progress', 'progress', 'complete']);
  assert.equal(result.records, 2);
  assert.equal(result.catalogCompatible, true);
  assert.equal(result.encoding, 'UTF-8');
  assert.equal(result.summary, 'Sem pendências nas verificações executadas do MVP 1.1');
  assert.equal(result.findings.length, 0);
  assert.equal(result.rules['SAL-CONS-01'].state, 'Conforme');
  assert.equal(result.rules['SAL-EQU-01'].state, 'Conforme');
  assert.deepEqual(result.balances.notices.map(notice => [notice.id, notice.type, notice.totals.at(-1).value]), [
    ['SAL-EQU-TIPO', 'beginning_balance', '10'], ['SAL-EQU-TIPO', 'period_change', '−10'],
  ]);
});
