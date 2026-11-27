import assert from 'node:assert/strict';
import { on } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { columns } from '../src/catalog.ts';

const options = { timeout: 10000 };

async function runWorker(t, file, failure) {
  const location = new URL('../src/validation.worker.ts', import.meta.url).href;
  const entrypoint = `
    import { parentPort, workerData } from 'node:worker_threads';
    globalThis.postMessage = message => parentPort.postMessage({ message });
    globalThis.addEventListener = (event, callback) => {
      if (event === 'message') parentPort.on('message', async data => {
        await callback({ data });
        parentPort.postMessage({ callbackFinished: true });
      });
    };
    await import(${JSON.stringify(location)});
    if (workerData === 'read') {
      Blob.prototype.arrayBuffer = async () => { throw new Error('Falha de leitura simulada'); };
    }
    if (workerData === 'decoder') {
      globalThis.TextDecoder = class {
        constructor() { throw new Error('Falha inesperada do decodificador'); }
      };
    }
  `;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(entrypoint)), { workerData: failure });
  t.after(() => worker.terminate());

  const events = on(worker, 'message', { signal: t.signal, close: ['exit'] });
  const messages = [];
  worker.postMessage({ file });
  for await (const [event] of events) {
    if (event.callbackFinished) return messages;
    messages.push(event.message);
  }
  assert.fail('Worker encerrou antes de concluir o callback');
}

test('Worker carrega o catálogo, publica progresso e retorna a validação', options, async t => {
  const csv = ['3550308EX;2026-01', columns.join(';'),
    '111110100;10131;PO;;;;;;;;;;;10;beginning_balance;D',
    '111110100;10131;PO;;;;;;;;;;;10;period_change;C'].join('\n');
  const messages = await runWorker(t, new Blob([csv]));
  assert.deepEqual(messages.map(message => message.type), ['progress', 'progress', 'complete']);
  const { result } = messages.at(-1);
  assert.equal(result.records, 2);
  assert.equal(result.catalogCompatible, true);
  assert.equal(result.summary, 'Sem pendências nas verificações executadas do MVP 1.1');
  assert.equal(result.findings.length, 0);
  assert.equal(result.rules['SAL-CONS-01'].state, 'Conforme');
  assert.equal(result.rules['SAL-EQU-01'].state, 'Conforme');
  assert.deepEqual(result.balances.groups.find(group => group.id === 'SAL-EQU-01').totals.map(total => total.value), ['10', '10', '0']);
});

test('Worker retorna erro de leitura quando o Blob rejeita arrayBuffer', options, async t => {
  const messages = await runWorker(t, new Blob(['3550308EX;2026-01']), 'read');
  assert.deepEqual(messages, [{ type: 'error', stage: 'leitura' }]);
});

test('Worker retorna erro de validação quando o TextDecoder falha após a leitura', options, async t => {
  const messages = await runWorker(t, new Blob(['3550308EX;2026-01']), 'decoder');
  assert.deepEqual(messages.map(message => message.type), ['progress', 'progress', 'error']);
  assert.deepEqual(messages.at(-1), { type: 'error', stage: 'validação' });
});

test('Worker conclui a validação de UTF-8 inválido com achado L01', options, async t => {
  const messages = await runWorker(t, new Blob([Uint8Array.of(0x80)]));
  assert.deepEqual(messages.map(message => message.type), ['progress', 'progress', 'complete']);
  const { result } = messages.at(-1);
  assert.equal(result.rules.L01.state, 'Falhou');
  const finding = result.findings.find(finding => finding.id === 'L01');
  assert.equal(finding?.status, 'Falhou');
  assert.equal(finding.byteOffset, 0);
  assert.equal(finding.observed, '0x80');
  assert.match(finding.expected, /Reexporte o CSV em UTF-8/);
});
