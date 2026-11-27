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
  blocked: false, balances: [expected], exclusions: [],
});
const page = (rows = [], nextOffset = null) => ({ rows, nextOffset });
const run = (data, load, signal = new AbortController().signal) => compareMonthlyBalances(data, load, signal);
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
  assert.deepEqual(ba, { ...local(10), balances: [expected] });
  const invalidInitial = verify('2914604EX', '2026-10', [csvRow('beginning_balance', 'inválido')]).monthlyBalances;
  assert.deepEqual(invalidInitial.exclusions, [{ exact: key }]);
  const absent = verify('2914604EX', '2026-10', [csvRow('ending_balance', '0')]).monthlyBalances;
  assert.deepEqual(absent, { ...local(10), balances: [] });
  assert.equal(verify('3550308EX', '2026-10', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-13', rows).monthlyBalances, null);
  assert.equal(verify('2914604EX', '2026-10', rows.concat('truncada')).monthlyBalances.blocked, true);
});

test('delimita máscaras pelos pares confiáveis e trata conta ou tipo incerto conservadoramente', () => {
  const code = '621100000';
  const seed = [['10131', 'PO'], ['inválida', 'NR'], ['1500', 'FR']];
  const fiscalDirection = (pairs, item = {}) => verify('2914604EX', '2026-10', [
    csvRow('beginning_balance', '1.01', { code, pairs, ...item }),
  ]).monthlyBalances;
  assert.deepEqual(fiscalDirection(seed).exclusions, [{ account: code, pairs: ['FR 1500', 'PO 10131'] }]);
  assert.deepEqual(fiscalDirection([...seed, ['10132', 'PO']]).exclusions,
    [{ account: code, pairs: ['FR 1500'] }]);
  for (const pair of [['1234', 'XX'], ['1234', '']]) {
    assert.deepEqual(fiscalDirection([...seed, pair]).exclusions, [{ account: code, pairs: [] }]);
  }
  const uncertain = fiscalDirection(seed, { code: '699999999' });
  assert.equal(uncertain.blocked, true);
  const wrongSide = fiscalDirection([['10131', 'PO']], { side: '?' });
  assert.deepEqual(wrongSide.exclusions, [{ exact: code + ' · PO 10131' }]);
  for (const type of ['period_change', 'ending_balance', 'desconhecido']) {
    const monthly = verify('2914604EX', '2026-10', [csvRow(type, 'inválido', { code: '699999999', pairs: seed })]).monthlyBalances;
    assert.equal(monthly.blocked, type === 'desconhecido');
    assert.deepEqual(monthly.exclusions, []);
  }
});

test('domínio local de FR preserva as chaves e exclusões do comparador histórico', () => {
  const code = '621100000';
  const initial = (amount, fr, ...extra) => csvRow('beginning_balance', amount, {
    code, pairs: [['10131', 'PO'], [fr, 'FR'], ...extra],
  });
  const report = verify('2914604EX', '2026-10', [
    initial('1.01', '1504'),
    initial('inválido', '1999'),
    initial('2.01', '1499', ['inválida', 'NR']),
  ]);
  assert.equal(report.rules.C09.failed, 3);
  assert.deepEqual(report.monthlyBalances, {
    ...local(10),
    balances: [{ key: code + ' · FR 1504 · PO 10131', net: { units: 101n, scale: 2 } }],
    exclusions: [
      { exact: code + ' · FR 1999 · PO 10131' },
      { account: code, pairs: ['FR 1499', 'PO 10131'] },
    ],
  });

  const localOnly = verify('2914604EX', '2026-10', [initial('1.01', '1504')]);
  assert.equal(localOnly.rules['SAL-CONS-01'].state, 'Bloqueada');
  assert.equal(localOnly.rules['SAL-EQU-01'].state, 'Falhou');
});

test('domínio local de CO preserva chaves e exclusões históricas inclusive com FR inválida', () => {
  const code = '111110100';
  const initial = (amount, co, fr, ...extra) => csvRow('beginning_balance', amount, {
    code, pairs: [['10131', 'PO'], [co, 'CO'], [fr, 'FR'], ...extra],
  });
  const report = verify('2914604EX', '2026-10', [
    initial('1.01', '0000', '1504'),
    initial('inválido', '0001', '1500'),
    initial('2.01', '0002', '1500', ['3', 'FP']),
  ]);
  assert.equal(report.rules.C10.failed, 3);
  assert.equal(report.rules.C09.failed, 1);
  assert.deepEqual(report.monthlyBalances, {
    ...local(10),
    balances: [{ key: code + ' · CO 0000 · FR 1504 · PO 10131', net: { units: 101n, scale: 2 } }],
    exclusions: [
      { exact: code + ' · CO 0001 · FR 1500 · PO 10131' },
      { account: code, pairs: ['CO 0002', 'FR 1500', 'PO 10131'] },
    ],
  });
  const localOnly = verify('2914604EX', '2026-10', [initial('1.01', '0000', '1500')]);
  assert.equal(localOnly.rules['SAL-CONS-01'].state, 'Bloqueada');
  assert.equal(localOnly.rules['SAL-EQU-01'].state, 'Falhou');
});

test('NR, ND, FS e AI preservam saldos, máscaras e exclusões do comparador histórico', () => {
  const row = (code, amount, ...pairs) => csvRow('beginning_balance', amount, {
    code, pairs: [['10131', 'PO'], ...pairs],
  });
  const result = verify('2914604EX', '2026-10', [
    row('621100000', '1', ['00000001', 'NR']),
    row('621100000', 'inválido', ['10000000', 'NR']),
    row('522110100', '2', ['10841', 'FS'], ['31904601', 'ND'], ['*ERRO*', 'FR']),
    row('531100000', '3', ['2027', 'AI']),
    row('621200000', '4', ['99900001', 'NR']),
    row('522110100', '0', ['01846', 'FS']),
  ]);
  assert.equal(result.rules.C11.failed, 2);
  assert.equal(result.rules.C13.failed, 0);
  assert.deepEqual(result.localNotices.map(notice => notice.id), ['C13', 'C12', 'C14', 'C13']);
  assert.deepEqual(result.monthlyBalances, {
    ...local(10),
    balances: [
      { key: '621100000 · NR 00000001 · PO 10131', net: { units: 1n, scale: 0 } },
      { key: '531100000 · AI 2027 · PO 10131', net: { units: 3n, scale: 0 } },
      { key: '621200000 · NR 99900001 · PO 10131', net: { units: 4n, scale: 0 } },
      { key: '522110100 · FS 01846 · PO 10131', net: { units: 0n, scale: 0 } },
    ],
    exclusions: [
      { exact: '621100000 · NR 10000000 · PO 10131' },
      { account: '522110100', pairs: ['FS 10841', 'ND 31904601', 'PO 10131'] },
    ],
  });
});

test('omite máscaras e chaves exatas dos dois lados sem excluir conta irmã ou outro PO', async () => {
  const fiscal = (code, po, nr, value, side = 'D') => csvRow('beginning_balance', value, {
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
  const result = await run(monthly, async filters => filters.month === '9' && filters.accountClass === '6' ? page([
    { ...official('621100000', '10131', '00000001', '8'), complemento_fonte: '0001' },
    official('621100000', '10132', '00000001', '3'),
    official('621200000', '10131', '00000001', '0'),
    official('621200000', '10131', '00000002', '7'),
  ]) : page());
  assert.equal(result.state, 'Parcial');
  assert.deepEqual(result.differences, [
    { key: '621100000 · FR 1500 · NR 00000001 · PO 10132', local: '4', official: '3', difference: '1' },
  ]);
  assert.equal(result.missingInCsv + result.missingInSiconfi, 0);
  const empty = await run(monthly, async () => page());
  assert.equal(empty.state, 'Sem referência na API');
  assert.match(empty.message, /excluídas/);
});

test('consulta as oito classes e todas as páginas, soma duplicatas e preserva divergências com chaves sem par', async () => {
  const calls = [];
  const balances = local();
  balances.balances.push({ key: '111110002 · PO 10131', net: decimal('0') });
  const result = await run(balances, async (filters, offset, _signal, limit) => {
    calls.push({ ...filters, offset });
    assert.equal(limit, 5000);
    assert.equal(filters.year, '2026');
    assert.equal(filters.month, '4');
    assert.equal(filters.valueType, 'ending_balance');
    if (filters.accountClass !== '1') return page();
    if (offset === 0) return page([{ ...reference, valor: '2' }], 5000);
    return page([
      { ...reference, valor: '0.9', natureza_conta: 'C' },
      { ...reference, conta_contabil: '111110001', valor: '0' },
    ]);
  });
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.filter(call => call.accountClass === '1').map(call => [call.month, call.valueType, call.offset]),
    [['4', 'ending_balance', 0], ['4', 'ending_balance', 5000]]);
  assert.equal(result.state, 'Inconclusiva');
  assert.deepEqual(result.differences, [
    { key, local: '1.01', official: '1.1', difference: '−0.09' },
  ]);
  assert.equal(result.missingInCsv, 1);
  assert.equal(result.missingInSiconfi, 1);
  assert.deepEqual(result.zeroWithoutPair, { csv: 1, siconfi: 1 });
});

test('não consulta janeiro, consulta novembro para dezembro e distingue referência vazia de falha', async () => {
  const references = [];
  const begin = await run(local(1), async () => assert.fail('Janeiro não deve consultar a API.'));
  assert.equal(begin.state, 'Não aplicável');
  const empty = await run(local(), async () => page());
  assert.equal(empty.state, 'Sem referência na API');
  assert.equal(empty.missingInCsv + empty.missingInSiconfi, 0);
  const end = await run(local(12), async filter => {
    references.push(filter.month);
    return filter.accountClass === '1' ? page([{ ...reference, valor: '2' }]) : page();
  });
  assert.equal(end.state, 'Divergente');
  assert.deepEqual(new Set(references), new Set(['11']));
  assert.equal(references.length, 8);
  await assert.rejects(run({ ...local(13) }, async () => assert.fail()), /mensais de 2026/);
  await assert.rejects(run({ ...local(), entity: '3550308' }, async () => assert.fail()), /municípios baianos/);
  const failed = await run(local(), async () => { throw new HistoryError('Falha simulada.'); });
  assert.equal(failed.state, 'Inconclusiva');
  assert.match(failed.message, /Falha simulada/);
});

test('descarta uma classe incompleta ou ambígua sem perder as classes concluídas', async () => {
  const balances = local(12);
  balances.balances.push({ key: '211110101 · PO 10131', net: decimal('0') });
  const calls = [];
  const partial = await run(balances, async (filters, offset) => {
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
  balances.balances.push({ key: reliableKey, net: decimal('10') });
  const partial = await run(balances, async (filters, offset) => {
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
  data.balances.push(extra('211110101', '9007199254740993.01'), extra('311110100', '7'),
    extra(masked, '5'), extra('111110602', '0'));
  data.exclusions.push({ account: masked, pairs: ['PO 10131'] });
  const result = await run(data, async filters => {
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
  const withMaskedReferenceOnly = await run(data, async filters => filters.accountClass === '1'
    ? page([{ ...reference, conta_contabil: masked }]) : page());
  assert.deepEqual(withMaskedReferenceOnly.inferredDifferences, []);
  const onlyFailureAndEmptyClasses = await run(data, async filters => {
    if (filters.accountClass === '3') throw new HistoryError('Falha simulada.');
    return page();
  });
  assert.deepEqual(onlyFailureAndEmptyClasses.inferredDifferences, []);
  const empty = await run(data, async () => page());
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
  assert.equal(budget.state, 'Inconclusiva');
  assert.match(budget.message, /limite/);
  requests = 0;
  const limited = await run(local(), async () => {
    requests++;
    throw new HistoryError('Limite HTTP 429', 429);
  });
  assert.equal(requests, 1);
  assert.equal(limited.state, 'Inconclusiva');
  const startedClasses = [];
  const rateLimitedAfterComplete = await run(local(), async filters => {
    startedClasses.push(filters.accountClass);
    if (filters.accountClass === '1') return page([{ ...reference, valor: '2' }]);
    throw new HistoryError('Limite HTTP 429', 429);
  });
  assert.deepEqual(startedClasses, ['1', '2']);
  assert.equal(rateLimitedAfterComplete.state, 'Parcial');
  assert.deepEqual(rateLimitedAfterComplete.differences, [{ key, local: '1.01', official: '2', difference: '−0.99' }]);
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
  assert.equal(expired.state, 'Parcial');
  assert.deepEqual(expired.differences, [{ key, local: '1.01', official: '2', difference: '−0.99' }]);
});
