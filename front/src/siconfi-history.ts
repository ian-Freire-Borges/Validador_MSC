export const valueTypes = [
  ['beginning_balance', 'Saldo inicial'],
  ['ending_balance', 'Saldo final'],
  ['period_change', 'Movimento do período'],
] as const;

type ValueType = typeof valueTypes[number][0];
type FilterInput = { entity: string; year: string; month: string; accountClass: string; valueType: string };
export type Filters = Readonly<Omit<FilterInput, 'valueType'> & { valueType: ValueType }>;
type Row = Record<string, string | null>;
type JsonObject = Record<string, unknown>;

const endpoint = 'https://apidatalake.tesouro.gov.br/ords/cdwhprd/siconfi/tt/';
const linkOrigins = new Set([
  new URL(endpoint).origin,
  // O ORDS anuncia este host nos links. As requisições usam sempre o endereço público.
  'https://host-5hrds-scan.prosubnet.vcndados.oraclevcn.com',
]);
export const pageSize = 100;
const cacheDuration = 5 * 60_000;

export function validateFilters(input: FilterInput, year = new Date().getFullYear()): Filters | string {
  const entity = input.entity.trim();
  if (!/^(?:[1-9]\d?|[1-9]\d{6})$/.test(entity)) {
    return 'Informe o código IBGE do ente com um, dois ou sete dígitos.';
  }
  if (!/^\d{4}$/.test(input.year) || Number(input.year) < 2019 || Number(input.year) > year) {
    return 'Informe um ano entre 2019 e ' + year + '.';
  }
  if (!/^(?:[1-9]|1[0-2])$/.test(input.month)) return 'Selecione um mês de 1 a 12.';
  if (!/^[1-8]$/.test(input.accountClass)) return 'Selecione uma classe de 1 a 8.';
  const valueType = valueTypes.find(([id]) => id === input.valueType)?.[0];
  if (!valueType) return 'Selecione um tipo de valor.';
  return { ...input, entity, valueType };
}

export function pageUrl(filters: Filters, offset: number, limit = pageSize): URL {
  const accountClass = Number(filters.accountClass);
  const route = accountClass <= 4 ? 'patrimonial' : accountClass <= 6 ? 'orcamentaria' : 'controle';
  const url = new URL('msc_' + route, endpoint);
  url.search = new URLSearchParams({
    id_ente: filters.entity,
    an_referencia: filters.year,
    me_referencia: filters.month,
    co_tipo_matriz: 'MSCC',
    classe_conta: filters.accountClass,
    id_tv: filters.valueType,
    limit: String(limit),
    offset: String(offset),
  }).toString();
  return url;
}

export class HistoryError extends Error {}

function contractError(): never {
  throw new HistoryError('O Siconfi retornou uma resposta em formato inesperado.');
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const numberToken = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const jsonToken = new RegExp('"(?:[^"\\\\]|\\\\[\\s\\S])*"|(' + numberToken + ')', 'g');
const integerToken = /^-?(?:0|[1-9]\d*)$/;
const int64 = 2n ** 63n;

function isSourceInteger(value: unknown, source: unknown): source is string {
  if (typeof value !== 'number' || typeof source !== 'string' ||
      source.length > 20 || !integerToken.test(source)) return false;
  const integer = BigInt(source);
  return integer >= -int64 && integer < int64;
}

function isReferenceDate(value: unknown): boolean {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  return new Date(date + 'T00:00:00Z').toISOString().startsWith(date + 'T');
}

const commonIntegerFields = ['ano_fonte_recursos', 'entrada_msc'];
const patrimonialIntegerFields = ['financeiro_permanente', 'divida_consolidada'];
const otherIntegerFields = ['educacao_saude', 'ano_inscricao'];
const otherTextFields = ['funcao', 'subfuncao', 'natureza_despesa'];

function parseRow(entry: unknown, source: unknown, filters: Filters): Row {
  if (!isObject(entry) ||
      !isObject(source) ||
      entry['tipo_valor'] !== filters.valueType || entry['tipo_matriz'] !== 'MSCC' ||
      typeof entry['conta_contabil'] !== 'string' ||
      !new RegExp('^' + filters.accountClass + '\\d*$').test(entry['conta_contabil']) ||
      (entry['valor'] != null && typeof entry['valor'] !== 'number') ||
      (entry['natureza_conta'] != null && entry['natureza_conta'] !== 'C' && entry['natureza_conta'] !== 'D')) {
    return contractError();
  }
  const identity = {
    cod_ibge: filters.entity, exercicio: filters.year,
    mes_referencia: filters.month, classe_conta: filters.accountClass,
  };
  for (const [key, expected] of Object.entries(identity)) {
    if (!isSourceInteger(entry[key], source[key]) || source[key] !== expected) return contractError();
  }

  const accountClass = Number(filters.accountClass);
  const integerFields = accountClass <= 4 ? patrimonialIntegerFields : otherIntegerFields;
  for (const key of [...commonIntegerFields, ...integerFields]) {
    if (entry[key] != null && !isSourceInteger(entry[key], source[key])) return contractError();
  }
  const textFields = ['fonte_recursos'];
  if (accountClass >= 5) textFields.push(...otherTextFields);
  if (accountClass === 5 || accountClass === 6) textFields.push('natureza_receita');
  for (const key of textFields) {
    if (entry[key] != null && typeof entry[key] !== 'string') return contractError();
  }

  // O OpenAPI descreve um inteiro, e as três rotas também retornam códigos textuais.
  const power = entry['poder_orgao'];
  if (power != null && !isSourceInteger(power, source['poder_orgao']) &&
      !(typeof power === 'string' && /^\d+$/.test(power))) return contractError();
  if (entry['data_referencia'] != null && !isReferenceDate(entry['data_referencia'])) return contractError();

  const row: Row = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value !== 'string') return contractError();
    row[key] = value;
  }
  return row;
}

function validateNext(href: string, current: URL, expected: URL): void {
  let link: URL;
  try {
    link = new URL(href, current);
  } catch {
    return contractError();
  }
  if (!linkOrigins.has(link.origin) || link.username || link.password || link.hash ||
      link.pathname !== expected.pathname ||
      link.searchParams.size !== expected.searchParams.size) {
    return contractError();
  }
  expected.searchParams.forEach((value, name) => {
    const values = link.searchParams.getAll(name);
    if (values.length !== 1 || values[0] !== value) return contractError();
  });
}

export type HistoryPage = {
  rows: Row[];
  offset: number;
  nextOffset: number | null;
  receivedAt: Date;
  cached: boolean;
};

export function parsePage(
  text: string, filters: Filters, offset: number, pageLimit = pageSize,
): Omit<HistoryPage, 'receivedAt' | 'cached'> {
  let data: unknown;
  let source: unknown;
  try {
    data = JSON.parse(text);
    // Depois de validar a sintaxe, capture lexemas sem perder os tipos originais.
    source = JSON.parse(text.replace(jsonToken, (token, number?: string) =>
      number === undefined ? token : JSON.stringify(number)));
  } catch {
    return contractError();
  }
  if (!isObject(data) || !isObject(source) || !Array.isArray(source['items'])) return contractError();
  const { items, hasMore, limit, count, links } = data;
  if (!Array.isArray(items) || typeof hasMore !== 'boolean' ||
      !isSourceInteger(limit, source['limit']) || source['limit'] !== String(pageLimit) ||
      !isSourceInteger(data['offset'], source['offset']) || source['offset'] !== String(offset) ||
      !isSourceInteger(count, source['count']) || source['count'] !== String(items.length) ||
      items.length > pageLimit || !Array.isArray(links) ||
      (hasMore && items.length !== pageLimit)) return contractError();

  const next = [];
  for (const link of links) {
    if (!isObject(link) || typeof link['rel'] !== 'string' || typeof link['href'] !== 'string') {
      return contractError();
    }
    if (link['rel'] === 'next') next.push(link['href']);
  }

  if (next.length !== (hasMore ? 1 : 0)) return contractError();
  const nextOffset = hasMore ? offset + pageLimit : null;
  if (nextOffset !== null) {
    if (!Number.isSafeInteger(nextOffset)) return contractError();
    validateNext(next[0], pageUrl(filters, offset, pageLimit), pageUrl(filters, nextOffset, pageLimit));
  }
  const sourceItems = source['items'];
  return { rows: items.map((entry, index) => parseRow(entry, sourceItems[index], filters)), offset, nextOffset };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function retryDelay(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, Number.MAX_SAFE_INTEGER);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

export class HistoryService {
  private readonly cache = new Map<string, HistoryPage>();
  private lastStart = -Infinity;
  private retryAt = 0;
  private active: Promise<HistoryPage> | null = null;

  async load(filters: Filters, offset: number, refresh: boolean, signal: AbortSignal): Promise<HistoryPage> {
    signal.throwIfAborted();
    const validated = validateFilters(filters);
    if (typeof validated === 'string' || !Number.isSafeInteger(offset) || offset < 0 || offset % pageSize !== 0) {
      throw new HistoryError(typeof validated === 'string' ? validated : 'Página inválida.');
    }
    const url = pageUrl(validated, offset);
    const key = url.href;
    const cached = this.cache.get(key);
    if (!refresh && cached && Date.now() - cached.receivedAt.getTime() < cacheDuration) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { ...cached, cached: true };
    }

    while (this.active) {
      await this.active.catch(() => {});
      signal.throwIfAborted();
    }
    const task = this.request(url, validated, offset, signal);
    this.active = task;
    try {
      const page = await task;
      signal.throwIfAborted();
      this.cache.delete(key);
      this.cache.set(key, page);
      if (this.cache.size > 5) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return page;
    } finally {
      this.active = null;
    }
  }

  private async request(url: URL, filters: Filters, offset: number, signal: AbortSignal): Promise<HistoryPage> {
    let delay = Math.max(this.lastStart + 1000, this.retryAt) - performance.now();
    while (delay > 0) {
      await wait(Math.min(delay, 2_147_483_647), signal);
      delay = Math.max(this.lastStart + 1000, this.retryAt) - performance.now();
    }
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    const requestSignal = AbortSignal.any([signal, timeout.signal]);
    this.lastStart = performance.now();
    try {
      const response = await fetch(url, {
        method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        redirect: 'error', cache: 'no-store', signal: requestSignal,
      });
      if (response.status === 429) {
        this.retryAt = performance.now() + retryDelay(response.headers.get('Retry-After'));
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HistoryError('O Siconfi respondeu com erro HTTP ' + response.status + '.');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
        await response.body?.cancel();
        return contractError();
      }
      const body = await response.text();
      requestSignal.throwIfAborted();
      return { ...parsePage(body, filters, offset), receivedAt: new Date(), cached: false };
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.signal.aborted) throw new HistoryError('O Siconfi excedeu o prazo de 15 segundos.');
      if (error instanceof HistoryError) throw error;
      throw new HistoryError('A consulta ao Siconfi está indisponível. Verifique a conexão ou tente novamente.');
    } finally {
      clearTimeout(timer);
    }
  }
}
