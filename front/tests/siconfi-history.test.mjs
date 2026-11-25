import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryService, pageUrl, parsePage, validateFilters } from '../src/siconfi-history.ts';

const pageLimit = 5000;
const filters = {
  entity: '17', year: '2022', month: '12', accountClass: '1', valueType: 'ending_balance',
};
const row = {
  tipo_matriz: 'MSCC', cod_ibge: 17, classe_conta: 1, conta_contabil: '119110000',
  exercicio: 2022, mes_referencia: 12, natureza_conta: 'D', tipo_valor: 'ending_balance',
  fonte_recursos: '0012345', complemento_fonte: null, valor: null,
};
const envelope = {
  items: [row], hasMore: false, limit: pageLimit, offset: 0, count: 1, links: [],
};

test('valida cada filtro e roteia as oito classes sem enviar parâmetros adicionais', () => {
  assert.deepEqual(validateFilters(filters, 2026), filters);
  for (const [key, value] of [
    ['entity', '17,18'], ['entity', '17&id_tv=period_change'], ['year', '2018'], ['year', '2027'],
    ['month', '13'], ['month', '0'], ['accountClass', '9'], ['valueType', 'saldo'],
  ]) {
    assert.equal(typeof validateFilters({ ...filters, [key]: value }, 2026), 'string');
  }
  const routes = ['patrimonial', 'patrimonial', 'patrimonial', 'patrimonial',
    'orcamentaria', 'orcamentaria', 'controle', 'controle'];
  for (const [index, route] of routes.entries()) {
    const url = pageUrl({ ...filters, accountClass: String(index + 1) }, 0, pageLimit);
    assert.ok(url.pathname.endsWith('/msc_' + route));
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      id_ente: '17', an_referencia: '2022', me_referencia: '12', co_tipo_matriz: 'MSCC',
      classe_conta: String(index + 1), id_tv: 'ending_balance', limit: '5000', offset: '0',
    });
  }
});

test('preserva o decimal de origem e distingue zero, nulo, campo ausente e código textual', () => {
  const raw = JSON.stringify(envelope).replace('"valor":null', '"valor":-9007199254740993.123456789010');
  const [record] = parsePage(raw, filters, 0, pageLimit).rows;
  assert.equal(record.valor, '-9007199254740993.123456789010');
  assert.equal(record.fonte_recursos, '0012345');
  assert.equal(record.complemento_fonte, null);
  assert.equal(record.natureza_receita, undefined);
  assert.equal(parsePage(JSON.stringify(envelope), filters, 0, pageLimit).rows[0].valor, null);
  assert.equal(parsePage(raw.replace('-9007199254740993.123456789010', '0.00'), filters, 0, pageLimit).rows[0].valor, '0.00');
  const empty = { ...envelope, items: [], count: 0 };
  assert.deepEqual(parsePage(JSON.stringify(empty), filters, 0, pageLimit), { rows: [], nextOffset: null });
});

test('aceita metadados de continuação observados e impede alteração de destino ou filtros', () => {
  const continuation = pageUrl(filters, 1, 1);
  continuation.hostname = 'host-5hrds-scan.prosubnet.vcndados.oraclevcn.com';
  const paginated = { ...envelope, limit: 1, hasMore: true, links: [{ rel: 'next', href: continuation.href }] };
  assert.equal(parsePage(JSON.stringify(paginated), filters, 0, 1).nextOffset, 1);
  for (const invalid of [
    continuation.href.replace(continuation.hostname, 'example.org'),
    continuation.href.replace('offset=1', 'offset=2'),
    continuation.href.replace('id_ente=17', 'id_ente=18'),
    continuation.href.replace('msc_patrimonial', 'msc_controle'),
    continuation.href + '&limit=1',
  ]) {
    const result = { ...paginated, links: [{ rel: 'next', href: invalid }] };
    assert.throws(() => parsePage(JSON.stringify(result), filters, 0, 1), /formato inesperado/);
  }
  for (const invalid of [
    { ...envelope, count: 2 },
    { ...envelope, limit: String(pageLimit) },
    { ...envelope, items: [{ ...row, tipo_matriz: 'MSCE' }] },
    { ...envelope, items: [{ ...row, valor: { decimal: '1.00' } }] },
  ]) {
    assert.throws(() => parsePage(JSON.stringify(invalid), filters, 0, pageLimit), /formato inesperado/);
  }
});

test('valida os tipos e inteiros de origem antes de formatar os registros', () => {
  const record = {
    ...row, entrada_msc: 5286, poder_orgao: '060611',
    data_referencia: '2022-12-31T00:00:00Z', financeiro_permanente: 2,
  };
  const body = JSON.stringify({ ...envelope, items: [record] });
  assert.equal(parsePage(body, filters, 0, pageLimit).rows[0].poder_orgao, '060611');
  assert.equal(parsePage(body.replace('"entrada_msc":5286', '"entrada_msc":9223372036854775807'),
    filters, 0, pageLimit).rows[0].entrada_msc, '9223372036854775807');
  for (const [field, value] of [
    ['conta_contabil', 119110000], ['cod_ibge', '17'], ['classe_conta', '1'],
    ['exercicio', '2022'], ['mes_referencia', '12'], ['entrada_msc', '5286'],
    ['financeiro_permanente', '2'], ['fonte_recursos', 12345], ['poder_orgao', 'inválido'],
    ['data_referencia', 'inválida'], ['data_referencia', '2022-02-30T00:00:00Z'], ['valor', '99.01'],
  ]) {
    const invalid = { ...envelope, items: [{ ...record, [field]: value }] };
    assert.throws(() => parsePage(JSON.stringify(invalid), filters, 0, pageLimit), /formato inesperado/, field);
  }
  for (const [original, invalid] of [
    ['"limit":5000', '"limit":5000.0000000000000001'],
    ['"offset":0', '"offset":1e-400'],
    ['"count":1', '"count":1.0000000000000001'],
    ['"exercicio":2022', '"exercicio":2022.0000000000000001'],
    ['"entrada_msc":5286', '"entrada_msc":9223372036854775808'],
  ]) {
    assert.throws(() => parsePage(body.replace(original, invalid), filters, 0, pageLimit), /formato inesperado/, invalid);
  }
});

test('aceita DC textual ou inteiro e preserva a grafia do código', () => {
  for (const value of ['001', 1]) {
    const body = JSON.stringify({ ...envelope, items: [{ ...row, divida_consolidada: value }] });
    assert.equal(parsePage(body, filters, 0, pageLimit).rows[0].divida_consolidada, String(value));
  }
  for (const value of ['DC', '1\n', 1.5, -1]) {
    const body = JSON.stringify({ ...envelope, items: [{ ...row, divida_consolidada: value }] });
    assert.throws(() => parsePage(body, filters, 0, pageLimit), /formato inesperado/);
  }
});

test('aplica o esquema das dimensões das rotas orçamentária e de controle', () => {
  for (const accountClass of ['5', '7']) {
    const search = { ...filters, accountClass };
    const record = {
      ...row, classe_conta: Number(accountClass), conta_contabil: accountClass + '19110000',
      poder_orgao: 10111, funcao: '03', subfuncao: '001', natureza_despesa: '00000001', ano_inscricao: 2020,
      ...(accountClass === '5' ? { natureza_receita: '00000002' } : {}),
    };
    const parse = record => parsePage(JSON.stringify({ ...envelope, items: [record] }), search, 0, pageLimit);
    assert.equal(parse(record).rows[0].subfuncao, '001');
    for (const [field, value] of [
      ['funcao', 3], ['subfuncao', 1], ['natureza_despesa', 1], ['ano_inscricao', '2020'],
      ...(accountClass === '5' ? [['natureza_receita', 2]] : []),
    ]) {
      assert.throws(() => parse({ ...record, [field]: value }), /formato inesperado/, field);
    }
  }
});

test('cancela durante o intervalo entre GETs e consulta novamente a mesma página', async t => {
  const starts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    starts.push(performance.now());
    assert.equal(url.hostname, 'apidatalake.tesouro.gov.br');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(envelope), { headers: { 'Content-Type': 'application/json' } });
  });
  const service = new HistoryService();
  const { signal } = new AbortController();
  const first = await service.load(filters, 0, signal, pageLimit);
  const canceled = new AbortController();
  const waiting = service.load(filters, 0, canceled.signal, pageLimit);
  canceled.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(starts.length, 1);
  assert.deepEqual(await service.load(filters, 0, signal, pageLimit), first);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 1000);
});

test('a mesma fila serializa páginas e permite cancelar uma consulta enfileirada', async t => {
  const started = [];
  const pending = Promise.withResolvers();
  t.mock.method(globalThis, 'fetch', async url => {
    const offset = Number(url.searchParams.get('offset'));
    started.push({ offset, at: performance.now() });
    if (offset === 0) await pending.promise;
    return new Response(JSON.stringify({ ...envelope, offset }), { headers: { 'Content-Type': 'application/json' } });
  });
  const service = new HistoryService();
  const { signal } = new AbortController();
  const first = service.load(filters, 0, signal, pageLimit);
  const canceled = new AbortController();
  const queued = service.load(filters, 2 * pageLimit, canceled.signal, pageLimit);
  const next = service.load(filters, pageLimit, signal, pageLimit);
  canceled.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.deepEqual(started.map(item => item.offset), [0]);
  pending.resolve();
  await Promise.all([first, next]);
  assert.deepEqual(started.map(item => item.offset), [0, pageLimit]);
  assert.ok(started[1].at - started[0].at >= 1000);
});

test('distingue HTTP, rede e cancelamento durante um GET', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  const { signal } = new AbortController();
  await assert.rejects(new HistoryService().load(filters, 0, signal, pageLimit), /HTTP 429/);
  fetch.mock.mockImplementation(async () => { throw new TypeError('Falha simulada'); });
  await assert.rejects(new HistoryService().load(filters, 0, signal, pageLimit), /indisponível/);
  fetch.mock.mockImplementation(async (_url, options) =>
    new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))));
  const canceled = new AbortController();
  const inFlight = new HistoryService().load(filters, 0, canceled.signal, pageLimit);
  canceled.abort();
  await assert.rejects(inFlight, { name: 'AbortError' });
});

test('enquadra o timeout em 15 segundos e faz nova tentativa apenas por ação do chamador', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) =>
    new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))));
  const { signal } = new AbortController();
  const pending = new HistoryService().load(filters, 0, signal, pageLimit);
  t.mock.timers.tick(15_000);
  await assert.rejects(pending, /prazo de 15 segundos/);
  assert.equal(fetch.mock.callCount(), 1);
});
