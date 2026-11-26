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
  anterior: { blocked: false, balances: [expected], exclusions: [] },
  posterior: { blocked: false, balances: [expected], exclusions: [] },
});
const page = (rows = [], nextOffset = null) => ({ rows, nextOffset });
const run = async (data, load, signal = new AbortController().signal) => {
  const results = [];
  await compareMonthlyBalances(data, load, signal, result => results.push(result));
  return results;
};
const csvRow = (type, value, { code = account, pairs = [['10131', 'PO']], side = 'D' } = {}) =>
  [code, ...pairs.flat(), ...Array(12 - pairs.length * 2).fill(''), value, type, side].join(';');
const verify = (code, period, rows) => validate(Buffer.from([code + ';' + period, columns.join(';'), ...rows].join('\n')), catalog);

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

test('extrai saldos locais só para BA mensal, distingue ausência e exclui a chave exata', () => {
  const rows = [csvRow('beginning_balance', '1.01'), csvRow('beginning_balance', '0'), csvRow('ending_balance', 'inválido')];
  const ba = verify('2914604EX', '2026-10', rows).monthlyBalances;
  assert.deepEqual(ba.anterior, { blocked: false, balances: [expected], exclusions: [] });
  assert.deepEqual(ba.posterior, { blocked: false, balances: [], exclusions: [{ exact: key }] });
  const absent = verify('2914604EX', '2026-10', [csvRow('ending_balance', '0')]).monthlyBalances;
  assert.deepEqual(absent.anterior, { blocked: false, balances: [], exclusions: [] });
  assert.equal(format(absent.posterior.balances[0].net), '0');
  assert.equal(verify('3550308EX', '2026-10', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-13', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-10', rows.concat('truncada')).monthlyBalances.anterior.blocked, true);
});

test('delimita máscaras pelos pares confiáveis e trata conta ou tipo incerto conservadoramente', () => {
  const code = '621100000';
  const seed = [['10131', 'PO'], ['inválida', 'NR'], ['1500', 'FR']];
  const fiscalDirection = (pairs, item = {}) => verify('2914604EX', '2026-10', [
    csvRow('ending_balance', '1.01', { code, pairs, ...item }),
  ]).monthlyBalances;
  assert.deepEqual(fiscalDirection(seed).posterior.exclusions, [{ account: code, pairs: ['FR 1500', 'PO 10131'] }]);
  assert.deepEqual(fiscalDirection([...seed, ['10132', 'PO']]).posterior.exclusions,
    [{ account: code, pairs: ['FR 1500'] }]);
  for (const pair of [['1234', 'XX'], ['1234', '']]) {
    assert.deepEqual(fiscalDirection([...seed, pair]).posterior.exclusions, [{ account: code, pairs: [] }]);
  }
  const uncertain = fiscalDirection(seed, { code: '699999999' });
  assert.equal(uncertain.posterior.blocked, true);
  assert.equal(uncertain.anterior.blocked, false);
  const wrongSide = fiscalDirection([['10131', 'PO']], { side: '?' });
  assert.deepEqual(wrongSide.posterior.exclusions, [{ exact: code + ' · PO 10131' }]);
  for (const type of ['period_change', 'desconhecido']) {
    const monthly = verify('2914604EX', '2026-10', [csvRow(type, 'inválido', { code: '699999999', pairs: seed })]).monthlyBalances;
    assert.equal(monthly.anterior.blocked, type === 'desconhecido');
    assert.equal(monthly.posterior.blocked, type === 'desconhecido');
    assert.deepEqual(monthly.posterior.exclusions, []);
  }
});

test('omite máscaras e chaves exatas dos dois lados sem excluir conta irmã ou outro PO', async () => {
  const fiscal = (code, po, nr, value, side = 'D') => csvRow('ending_balance', value, {
    code, pairs: [['1500', 'FR'], [po, 'PO'], [nr, 'NR']], side,
  });
  const monthly = verify('2914604EX', '2026-10', [
    fiscal('621100000', '10131', 'inválida', '20'),
    fiscal('621100000', '10131', '00000001', '5'),
    fiscal('621100000', '10132', '00000001', '4'),
    fiscal('621200000', '10131', '00000001', '0'),
    fiscal('621200000', '10131', '00000002', 'inválido'),
  ]).monthlyBalances;
  const official = (code, po, nr, value) => ({ ...reference, conta_contabil: code,
    poder_orgao: po, fonte_recursos: '1500', natureza_receita: nr, valor: value });
  const results = await run(monthly, async filters => filters.month === '11' && filters.accountClass === '6' ? page([
    { ...official('621100000', '10131', '00000001', '8'), complemento_fonte: '0001' },
    official('621100000', '10132', '00000001', '3'),
    official('621200000', '10131', '00000001', '0'),
    official('621200000', '10131', '00000002', '7'),
  ]) : page());
  assert.equal(results[1].state, 'Parcial');
  assert.deepEqual(results[1].differences, [
    { key: '621100000 · FR 1500 · NR 00000001 · PO 10132', local: '4', official: '3', difference: '1' },
  ]);
  assert.equal(results[1].missingInCsv + results[1].missingInSiconfi, 0);
  const empty = await run(monthly, async () => page());
  assert.equal(empty[1].state, 'Sem referência na API');
  assert.match(empty[1].message, /excluídas/);
});

test('consulta as oito classes e todas as páginas, soma duplicatas e preserva divergências com chaves sem par', async () => {
  const calls = [];
  const balances = local();
  balances.anterior.balances.push({ key: '111110002 · PO 10131', net: decimal('0') });
  const results = await run(balances, async (filters, offset, _signal, limit) => {
    calls.push({ ...filters, offset });
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
  assert.deepEqual(results[0].zeroWithoutPair, { csv: 1, siconfi: 1 });
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

test('descarta uma classe incompleta ou ambígua sem perder as classes concluídas', async () => {
  const balances = local(12);
  balances.anterior.balances.push({ key: '211110101 · PO 10131', net: decimal('0') });
  const calls = [];
  const [partial] = await run(balances, async (filters, offset) => {
    calls.push([filters.accountClass, offset]);
    if (filters.accountClass === '1') return page([{ ...reference, valor: '2' }]);
    if (filters.accountClass === '2' && offset === 0) {
      return page([{ ...reference, conta_contabil: '211110101', valor: '999' }], 5000);
    }
    if (filters.accountClass === '2') throw new HistoryError('O Siconfi respondeu com erro HTTP 503.', 503);
    if (filters.accountClass === '3') return page([{ ...reference, conta_contabil: '311110100', valor: null }]);
    return page();
  });
  assert.deepEqual(calls, [['1', 0], ['2', 0], ['2', 5000], ['3', 0], ['4', 0], ['5', 0], ['6', 0], ['7', 0], ['8', 0]]);
  assert.equal(partial.state, 'Parcial');
  assert.match(partial.message, /HTTP 503.*ambíguo/);
  assert.deepEqual(partial.differences, [{ key, local: '1.01', official: '2', difference: '−0.99' }]);
  assert.equal(partial.missingInCsv + partial.missingInSiconfi, 0);
});

test('descarta a classe inteira se a conta pertence a uma classe diferente da declarada', async () => {
  const balances = local(12);
  const affectedAccount = '211110101';
  const reliableKey = '311110100 · PO 10131';
  balances.anterior.balances.push({ key: reliableKey, net: decimal('10') });
  const [partial] = await run(balances, async (filters, offset) => {
    if (filters.accountClass === '1') {
      return offset === 0 ? page([{ ...reference, valor: '2' }], 5000) :
        page([{ ...reference, conta_contabil: affectedAccount, classe_conta: '1' }]);
    }
    if (filters.accountClass === '2') throw new HistoryError('O Siconfi respondeu com erro HTTP 503.', 503);
    if (filters.accountClass === '3') return page([{ ...reference, conta_contabil: '311110100', valor: '9' }]);
    return page();
  });
  assert.equal(partial.state, 'Parcial');
  assert.match(partial.message, /ambíguo.*HTTP 503/);
  assert.deepEqual(partial.differences, [{ key: reliableKey, local: '10', official: '9', difference: '1' }]);
  assert.equal(partial.missingInCsv + partial.missingInSiconfi, 0);
});

test('calcula hipótese somente para chaves unilaterais não zero de classes confiáveis e com referência', async () => {
  const data = local(12);
  const extra = (code, amount) => ({ key: code + ' · PO 10131', net: decimal(amount) });
  const masked = '111110601';
  data.anterior.balances.push(extra('211110101', '9007199254740993.01'), extra('311110100', '7'),
    extra(masked, '5'), extra('111110602', '0'));
  data.anterior.exclusions.push({ account: masked, pairs: ['PO 10131'] });
  const [result] = await run(data, async filters => {
    if (filters.accountClass === '1') return page([reference,
      { ...reference, conta_contabil: '111110603', valor: '2.5' },
      { ...reference, conta_contabil: '111110604', valor: '2.5', natureza_conta: 'C' },
      { ...reference, conta_contabil: masked, valor: '8' }]);
    if (filters.accountClass === '3') throw new HistoryError('Falha simulada.');
    return page();
  });
  assert.equal(result.state, 'Parcial');
  assert.deepEqual(result.differences, []);
  assert.equal(result.missingInCsv, 2);
  assert.equal(result.missingInSiconfi, 2);
  assert.deepEqual(result.zeroWithoutPair, { csv: 1, siconfi: 0 });
  assert.deepEqual(result.inferredDifferences, [
    { key: '111110603 · PO 10131', source: 'Siconfi', observed: '2.5', difference: '−2.5' },
    { key: '111110604 · PO 10131', source: 'Siconfi', observed: '−2.5', difference: '2.5' },
    { key: '211110101 · PO 10131', source: 'CSV', observed: '9007199254740993.01', difference: '9007199254740993.01' },
  ]);
  const [withMaskedReferenceOnly] = await run(data, async filters => filters.accountClass === '1'
    ? page([{ ...reference, conta_contabil: masked }]) : page());
  assert.deepEqual(withMaskedReferenceOnly.inferredDifferences, []);
  const [onlyFailureAndEmptyClasses] = await run(data, async filters => {
    if (filters.accountClass === '3') throw new HistoryError('Falha simulada.');
    return page();
  });
  assert.deepEqual(onlyFailureAndEmptyClasses.inferredDifferences, []);
  const [empty] = await run(data, async () => page());
  assert.equal(empty.state, 'Sem referência na API');
  assert.equal(empty.inferredDifferences, undefined);
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
  const startedClasses = [];
  const rateLimitedAfterComplete = await run(local(), async filters => {
    startedClasses.push(filters.accountClass);
    if (filters.accountClass === '1') return page([{ ...reference, valor: '2' }]);
    throw new HistoryError('Limite HTTP 429', 429);
  });
  assert.deepEqual(startedClasses, ['1', '2']);
  assert.deepEqual(rateLimitedAfterComplete.map(result => result.state), ['Parcial', 'Inconclusiva']);
  assert.deepEqual(rateLimitedAfterComplete[0].differences, [{ key, local: '1.01', official: '2', difference: '−0.99' }]);
  const abort = new AbortController();
  await assert.rejects(run(local(), async (_filter, _offset, signal) => {
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
  const expired = await run(local(), async (filters, _offset, signal) => {
    deadlineRequests++;
    if (filters.accountClass === '1') return page([{ ...reference, valor: '2' }]);
    deadline.abort();
    assert.equal(signal.aborted, true);
    return page();
  });
  assert.equal(deadlineRequests, 2);
  assert.deepEqual(expired.map(result => result.state), ['Parcial', 'Inconclusiva']);
  assert.deepEqual(expired[0].differences, [{ key, local: '1.01', official: '2', difference: '−0.99' }]);
});
