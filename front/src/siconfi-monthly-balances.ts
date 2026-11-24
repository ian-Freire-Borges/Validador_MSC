import { widths } from './catalog.ts';
import { add, decimal, format, negate } from './decimal.ts';
import type { Decimal } from './decimal.ts';
import { accumulateBalance, balanceKey, signedBalance } from './monthly-balances.ts';
import type { AccountDimension, BalanceDirection, MonthlyBalance, MonthlyBalances } from './monthly-balances.ts';
import { HistoryError } from './siconfi-history.ts';
import type { Filters, HistoryPage, HistoryRow } from './siconfi-history.ts';

export const monthlyDirections = [
  { id: 'anterior', label: 'Saldo inicial × saldo final do mês anterior', shift: -1, reference: 'ending_balance' },
  { id: 'posterior', label: 'Saldo final × saldo inicial do mês posterior', shift: 1, reference: 'beginning_balance' },
] as const;

export type MonthlyDifference = {
  key: string;
  local: string | null;
  official: string | null;
  difference: string | null;
};
export type DirectionResult = {
  id: BalanceDirection;
  month: number;
  state: 'Conforme' | 'Divergente' | 'Inconclusiva' | 'Não aplicável';
  message: string;
  differences: MonthlyDifference[];
  divergenceCount: number;
};

const searchLimit = 5000;
const maximumPages = 60;
const deadlineMs = 180_000;
const budgetMessage = 'O limite de consultas desta comparação foi atingido.';
const ambiguousMessage = 'O Siconfi retornou registros com identificação ou saldo ambíguo para esta comparação.';
const directDimensions = [
  ['PO', 'poder_orgao'], ['FP', 'financeiro_permanente'], ['DC', 'divida_consolidada'],
  ['FR', 'fonte_recursos'], ['CO', 'complemento_fonte'], ['NR', 'natureza_receita'],
  ['ND', 'natureza_despesa'], ['AI', 'ano_inscricao'],
] as const;

function ambiguous(): never {
  throw new HistoryError(ambiguousMessage);
}

function present(value: string | null | undefined): value is string {
  return value != null && value !== '';
}

function fixedCode(value: string, width: number): string {
  if (!/^[0-9]+$/.test(value) || value.length !== width) return ambiguous();
  return value;
}

function magnitude(value: string | null | undefined): Decimal {
  const match = typeof value === 'string' && /^([0-9]+(?:\.[0-9]+)?)(?:[eE]([+-]?[0-9]+))?$/.exec(value);
  if (!match) return ambiguous();
  const amount = decimal(match[1]);
  const exponent = Number(match[2] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) return ambiguous();
  const scale = amount.scale - exponent;
  return scale < 0 ? { units: amount.units * 10n ** BigInt(-scale), scale: 0 } : { units: amount.units, scale };
}

export function normalizeMonthlyRow(row: HistoryRow): MonthlyBalance {
  const account = row.conta_contabil;
  const side = row.natureza_conta;
  if (typeof account !== 'string' || !/^[1-8][0-9]{8}$/.test(account) || (side !== 'C' && side !== 'D')) return ambiguous();
  const dimensions: AccountDimension[] = [];
  for (const [type, field] of directDimensions) {
    const value = row[field];
    if (present(value)) dimensions.push([type, fixedCode(value, widths[type])]);
  }
  if (!present(row.poder_orgao) || present(row.educacao_saude)) return ambiguous();
  const { funcao, subfuncao, ano_fonte_recursos: sourceYear, fonte_recursos: source } = row;
  if (present(sourceYear) && (!present(source) || sourceYear !== source[0])) return ambiguous();
  if (present(funcao) || present(subfuncao)) {
    if (!present(funcao) || !present(subfuncao)) return ambiguous();
    dimensions.push(['FS', fixedCode(funcao, 2) + fixedCode(subfuncao, 3)]);
  }
  return { key: balanceKey(account, dimensions), net: signedBalance(magnitude(row.valor), side) };
}

function compare(localBalances: MonthlyBalance[], officialBalances: Map<string, Decimal>): MonthlyDifference[] {
  const local = new Map(localBalances.map(balance => [balance.key, balance.net]));
  const keys = new Set([...local.keys(), ...officialBalances.keys()]);
  const differences: MonthlyDifference[] = [];
  for (const key of [...keys].sort()) {
    const localAmount = local.get(key);
    const officialAmount = officialBalances.get(key);
    const difference = localAmount && officialAmount ? add(localAmount, negate(officialAmount)) : null;
    if (difference?.units === 0n) continue;
    differences.push({
      key, local: localAmount ? format(localAmount) : null, official: officialAmount ? format(officialAmount) : null,
      difference: difference ? format(difference) : null,
    });
  }
  return differences.sort((left, right) => Number(left.difference === null) - Number(right.difference === null));
}

type PageLoader = (filters: Filters, offset: number, refresh: boolean, signal: AbortSignal, limit: number) => Promise<HistoryPage>;

export async function compareMonthlyBalances(
  local: MonthlyBalances, load: PageLoader, signal: AbortSignal,
  onDirection: (result: DirectionResult) => void, onPage?: (loaded: number) => void,
): Promise<void> {
  if (!/^29[0-9]{5}$/.test(local.entity) || !Number.isInteger(local.month) || local.month < 1 || local.month > 12) {
    throw new HistoryError('A comparação está disponível para municípios baianos em competências mensais de 2026.');
  }
  const deadline = AbortSignal.timeout(deadlineMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  let queries = 0;
  let rateLimited = false;
  for (const direction of monthlyDirections) {
    signal.throwIfAborted();
    const { id, shift, reference } = direction;
    const month = local.month + shift;
    const publish = (state: DirectionResult['state'], message: string, differences: MonthlyDifference[] = []) =>
      onDirection({ id, month, state, message, differences, divergenceCount: differences.filter(item => item.difference !== null).length });
    if (month < 1 || month > 12) {
      publish('Não aplicável', 'A comparação não cruza exercícios nem inclui o encerramento.');
      continue;
    }
    if (local[id].blocked) {
      publish('Inconclusiva', 'O CSV tem dados inválidos ou incompletos que impedem esta comparação.');
      continue;
    }
    const official = new Map<string, Decimal>();
    try {
      if (rateLimited) throw new HistoryError('Consulta interrompida após atingir o limite do Siconfi (HTTP 429).');
      for (let accountClass = 1; accountClass <= 8; accountClass++) {
        const filters: Filters = { entity: local.entity, year: '2026', month: String(month), accountClass: String(accountClass), valueType: reference };
        let offset: number | null = 0;
        while (offset !== null) {
          if (queries >= maximumPages || deadline.aborted) throw new HistoryError(budgetMessage);
          signal.throwIfAborted();
          queries++;
          const page = await load(filters, offset, true, requestSignal, searchLimit);
          requestSignal.throwIfAborted();
          for (const row of page.rows) {
            const balance = normalizeMonthlyRow(row);
            accumulateBalance(official, balance.key, balance.net);
          }
          offset = page.nextOffset;
          onPage?.(queries);
        }
      }
      if (official.size === 0) {
        publish('Inconclusiva', 'A API retornou zero registros e a ausência de uma matriz publicada não pôde ser confirmada.', compare(local[id].balances, official));
        continue;
      }
      const differences = compare(local[id].balances, official);
      if (differences.some(item => item.difference === null)) {
        publish('Inconclusiva', 'Há chaves sem saldo correspondente. Nenhum valor ausente foi tratado como zero.', differences);
      } else if (differences.length) {
        publish('Divergente', 'Foram encontradas diferenças entre os saldos do CSV e os do Siconfi.', differences);
      } else {
        publish('Conforme', 'Os saldos comparados coincidem.');
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof HistoryError && error.status === 429) rateLimited = true;
      publish('Inconclusiva', deadline.aborted ? budgetMessage :
        error instanceof HistoryError ? error.message : 'A consulta ao Siconfi não foi concluída.');
    }
  }
}
