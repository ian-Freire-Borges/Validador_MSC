import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../src/catalog-2026.json' with { type: 'json' };
import { columns } from '../src/catalog.ts';
import { decimal, format } from '../src/decimal.ts';
import { balanceKey } from '../src/monthly-balances.ts';
import { HistoryError } from '../src/siconfi-history.ts';
import { compareMonthlyBalances, normalizeMonthlyRow } from '../src/siconfi-monthly-balances.ts';
import { validate } from '../src/validation.ts';

const account = '111110100';
const reference = { conta_contabil: account, poder_orgao: '10131', valor: '1.01', natureza_conta: 'D' };
const key = balanceKey(account, [['PO', '10131']]);
const expected = { key, net: decimal('1.01') };
const local = (month = 5) => ({
  entity: '2914604', month,
  anterior: { blocked: false, balances: [expected] },
  posterior: { blocked: false, balances: [expected] },
});
const page = (rows = [], nextOffset = null) => ({ rows, nextOffset, offset: 0, receivedAt: new Date(0), cached: false });
const run = async (data, load, signal = new AbortController().signal) => {
  const results = [];
  await compareMonthlyBalances(data, load, signal, result => results.push(result));
  return results;
};
const csvRow = (type, value) => [account, '10131', 'PO', ...Array(10).fill(''), value, type, 'D'].join(';');
const verify = (code, period, rows) => validate(Buffer.from([code + ';' + period, columns.join(';'), ...rows].join('\n')), 'UTF-8', catalog);

test('combina todas as dimensões, preserva zeros e usa decimais exatos', () => {
  const actual = normalizeMonthlyRow({
    ...reference, fonte_recursos: '1500', ano_fonte_recursos: '1', complemento_fonte: '0001',
    financeiro_permanente: '2', divida_consolidada: '1', funcao: '02', subfuncao: '001',
    natureza_receita: '00000002', natureza_despesa: '00000001', ano_inscricao: '2026',
    natureza_conta: 'C', valor: '900719925474099312345678901e-11',
  });
  assert.equal(actual.key, account + ' · AI 2026 · CO 0001 · DC 1 · FP 2 · FR 1500 · FS 02001 · ND 00000001 · NR 00000002 · PO 10131');
  assert.equal(format(actual.net), '−9007199254740993.12345678901');
  assert.equal(format(normalizeMonthlyRow({ ...reference, valor: '0.00' }).net), '0');
  for (const invalid of [
    { fonte_recursos: '01500' }, { fonte_recursos: '1500', ano_fonte_recursos: '2' },
    { funcao: '01' }, { funcao: '1', subfuncao: '002' }, { educacao_saude: '2' },
    { poder_orgao: null }, { valor: null }, { valor: '-1' }, { valor: '1e-1001' },
  ]) assert.throws(() => normalizeMonthlyRow({ ...reference, ...invalid }), /ambíguo/);
});

test('extrai saldos locais só para BA mensal, distingue ausência e bloqueia a direção afetada', () => {
  const rows = [csvRow('beginning_balance', '1.01'), csvRow('beginning_balance', '0'), csvRow('ending_balance', 'inválido')];
  const ba = verify('2914604EX', '2026-10', rows).monthlyBalances;
  assert.deepEqual(ba.anterior, { blocked: false, balances: [expected] });
  assert.deepEqual(ba.posterior, { blocked: true, balances: [] });
  const absent = verify('2914604EX', '2026-10', [csvRow('ending_balance', '0')]).monthlyBalances;
  assert.deepEqual(absent.anterior, { blocked: false, balances: [] });
  assert.equal(format(absent.posterior.balances[0].net), '0');
  assert.equal(verify('3550308EX', '2026-10', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-13', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-10', rows.concat('truncada')).monthlyBalances.anterior.blocked, true);
});

test('consulta as oito classes e todas as páginas, soma duplicatas e preserva divergências com chaves sem par', async () => {
  const calls = [];
  const balances = local();
  balances.anterior.balances.push({ key: '111110002 · PO 10131', net: decimal('0') });
  const results = await run(balances, async (filters, offset, refresh, _signal, limit) => {
    calls.push({ ...filters, offset });
    assert.equal(refresh, true);
    assert.equal(limit, 5000);
    assert.equal(filters.year, '2026');
    if (filters.accountClass !== '1') return page();
    if (filters.month === '4' && offset === 0) return page([{ ...reference, valor: '2' }], 5000);
    if (filters.month === '4') return page([
      { ...reference, valor: '0.9', natureza_conta: 'C' },
      { ...reference, conta_contabil: '111110001', valor: '0' },
    ]);
    return page([reference]);
  });
  assert.equal(calls.length, 17);
  assert.deepEqual(calls.filter(call => call.accountClass === '1').map(call => [call.month, call.valueType, call.offset]),
    [['4', 'ending_balance', 0], ['4', 'ending_balance', 5000], ['6', 'beginning_balance', 0]]);
  assert.equal(results[0].state, 'Inconclusiva');
  assert.deepEqual(results[0].differences, [
    { key, local: '1.01', official: '1.1', difference: '−0.09' },
  ]);
  assert.equal(results[0].missingInCsv, 1);
  assert.equal(results[0].missingInSiconfi, 1);
  assert.equal(results[1].state, 'Conforme');
});

test('respeita janeiro e dezembro e distingue referência vazia de falha parcial', async () => {
  const references = [];
  const begin = await run(local(1), async () => page());
  assert.deepEqual(begin.map(result => result.state), ['Não aplicável', 'Sem referência na API']);
  assert.deepEqual(begin[1].differences, []);
  assert.equal(begin[1].missingInCsv + begin[1].missingInSiconfi, 0);
  const end = await run(local(12), async filter => {
    references.push(filter.month);
    return filter.accountClass === '1' ? page([{ ...reference, valor: '2' }]) : page();
  });
  assert.deepEqual(end.map(result => result.state), ['Divergente', 'Não aplicável']);
  assert.deepEqual(new Set(references), new Set(['11']));
  await assert.rejects(run({ ...local(13) }, async () => assert.fail()), /mensais de 2026/);
  await assert.rejects(run({ ...local(), entity: '3550308' }, async () => assert.fail()), /municípios baianos/);
  const partial = await run(local(), async filter => {
    if (filter.month === '6') throw new HistoryError('Falha simulada.');
    return filter.accountClass === '1' ? page([reference]) : page();
  });
  assert.deepEqual(partial.map(result => result.state), ['Conforme', 'Inconclusiva']);
  assert.deepEqual(partial[1].differences, []);
});

test('interrompe no orçamento, no HTTP 429 e ao cancelar', async t => {
  let requests = 0;
  const budget = await run(local(), async (_filters, offset) => {
    requests++;
    return page([], offset + 5000);
  });
  assert.equal(requests, 60);
  assert.ok(budget.every(result => result.state === 'Inconclusiva'));
  assert.ok(budget.every(result => /limite/.test(result.message)));
  requests = 0;
  const limited = await run(local(), async () => {
    requests++;
    throw new HistoryError('Limite HTTP 429', 429);
  });
  assert.equal(requests, 1);
  assert.ok(limited.every(result => result.state === 'Inconclusiva'));
  const abort = new AbortController();
  await assert.rejects(run(local(), async (_filter, _offset, _refresh, signal) => {
    abort.abort();
    assert.equal(signal.aborted, true);
    return page();
  }, abort.signal), { name: 'AbortError' });
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 180_000);
    return deadline.signal;
  });
  let deadlineRequests = 0;
  const expired = await run(local(), async (_filter, _offset, _refresh, signal) => {
    deadlineRequests++;
    deadline.abort();
    assert.equal(signal.aborted, true);
    return page();
  });
  assert.equal(deadlineRequests, 1);
  assert.ok(expired.every(result => result.state === 'Inconclusiva'));
});
