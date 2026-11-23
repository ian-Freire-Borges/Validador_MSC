import { valueTypes } from './catalog.ts';
import type { BlockReason, Finding, RuleId, RuleState } from './validation.ts';

export const balanceRules = {
  'SAL-CONS-01': ['Consistência por conta e IC', 'Regras de Validação da MSC 2026, revisão 24/11/2025, pp. 5–6, alínea f; Anexo I MSC 2026, pp. 12–13 e 17'],
  'SAL-EQU-01': ['Equilíbrio por natureza da informação', 'Regras de Validação da MSC 2026, revisão 24/11/2025, pp. 5–6, alínea e; Anexo I MSC 2026, p. 17'],
} as const;
export const balanceSpecification = 'ARQ-MVP-1.1-ACEITE com ressalva aprovada';
export const valueTypeLabels = ['Saldo inicial', 'Movimentação', 'Saldo final'];
const natureLabels = ['Patrimonial (classes 1–4)', 'Orçamentária (classes 5–6)', 'Controle (classes 7–8)'];
type BalanceRuleId = keyof typeof balanceRules;
type Pair = [type: string, code: string];
type Decimal = { units: bigint; scale: number };
const zero: Decimal = { units: 0n, scale: 0 };

function decimal(value: string): Decimal {
  const [whole, fraction = ''] = value.split('.');
  let scale = fraction.length;
  while (scale > 0 && fraction[scale - 1] === '0') scale--;
  return { units: BigInt(whole + fraction.slice(0, scale)), scale };
}

function add(a: Decimal, b: Decimal): Decimal {
  if (a.units === 0n) return b;
  if (b.units === 0n) return a;
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}

function negate(value: Decimal): Decimal {
  return { ...value, units: -value.units };
}

function format(value: Decimal): string {
  const { units, scale } = value;
  if (units === 0n) return '0';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  let end = digits.length;
  const point = digits.length - scale;
  while (end > point && digits[end - 1] === '0') end--;
  const magnitude = end > point ? digits.slice(0, point) + '.' + digits.slice(point, end) : digits.slice(0, point);
  return (units < 0n ? '−' : '') + magnitude;
}

const sampleLimit = 5;
interface Sample<T> { count: number; items: T[] }
function sample<T>(): Sample<T> { return { count: 0, items: [] }; }
function remember<T>(target: Sample<T>, item: T): void {
  target.count++;
  if (target.items.length < sampleLimit) target.items.push(item);
}

export interface BalanceOrigin { line?: number; rule?: RuleId; field?: string; slots?: number[] }
export interface BalanceBlock { reason: BlockReason; origins: Sample<BalanceOrigin>; type?: string }
type Totals = { label: string; value: string }[];
export interface BalanceGroup {
  id: BalanceRuleId;
  group: string;
  state: RuleState;
  totals: Totals;
  lines: Sample<number>;
  blocks: BalanceBlock[];
}
export interface BalanceNotice {
  id: 'SAL-EQU-TIPO' | 'SAL-CONS-REP';
  group: string;
  type?: string;
  totals: Totals;
  lines: Sample<number>;
}

interface Accumulation {
  lines: Sample<number>;
  block?: BalanceBlock;
}
interface Combination extends Accumulation {
  net: Decimal[];
  occurrences: Map<string, number | Sample<number>>;
}
interface Partition extends Accumulation { debit: Decimal; credit: Decimal }
const partition = (): Partition => ({ lines: sample(), debit: zero, credit: zero });

function recordBlock(current: BalanceBlock | undefined, reason: BlockReason, origins: BalanceOrigin[]): BalanceBlock {
  const block = current ?? { reason, origins: sample<BalanceOrigin>() };
  for (const origin of origins) remember(block.origins, origin);
  return block;
}

export function balanceOrigin(finding: Finding): BalanceOrigin {
  return { rule: finding.id, line: finding.line, field: finding.fieldName };
}

function balanceGroup(id: BalanceRuleId, group: string, lines: Sample<number>, blocks: BalanceBlock[],
  evaluate: () => { difference: Decimal; totals: Totals }): BalanceGroup {
  if (blocks.length) return { id, group, state: 'Bloqueada', lines, blocks, totals: [] };
  if (!lines.count) return { id, group, state: 'Não aplicável', lines, blocks, totals: [] };
  const { difference, totals } = evaluate();
  return { id, group, state: difference.units === 0n ? 'Conforme' : 'Falhou', lines, blocks, totals };
}

function equilibriumTotals(debit: Decimal, credit: Decimal) {
  const difference = add(debit, negate(credit));
  return { difference, totals: [
    { label: 'Débitos', value: format(debit) },
    { label: 'Créditos', value: format(credit) },
    { label: 'Diferença (D − C)', value: format(difference) },
  ] };
}

export class Balances {
  private readonly combinations = new Map<string, Map<string, Combination>>();
  private readonly uncertainAccounts = new Map<string, BalanceBlock>();
  private readonly natures = natureLabels.map(() => ({ lines: sample<number>(), types: valueTypes.map(partition) }));
  private readonly fileBlocks = new Map<BlockReason, BalanceBlock>();

  blockFile(reason: BlockReason, origin: BalanceOrigin, replace = false): void {
    if (replace) this.fileBlocks.clear();
    this.fileBlocks.set(reason, recordBlock(this.fileBlocks.get(reason), reason, [origin]));
  }

  record(line: number, account: string, pairs: Pair[], keyFaults: BalanceOrigin[], value: string,
    type: number, side: string, valueFaults: BalanceOrigin[]): void {
    const accountClass = account.charCodeAt(0) - 48;
    const nature = this.natures[accountClass <= 4 ? 0 : accountClass <= 6 ? 1 : 2];
    remember(nature.lines, line);
    const amount = valueFaults.length === 0 ? decimal(value) : null;
    if (amount === null) {
      const affected = type < 0 ? nature.types : [nature.types[type]];
      for (const target of affected) target.block = recordBlock(target.block, 'dados-saldo', valueFaults);
    } else {
      const target = nature.types[type];
      remember(target.lines, line);
      if (side === 'D') target.debit = add(target.debit, amount);
      else target.credit = add(target.credit, amount);
    }

    if (keyFaults.length) {
      this.uncertainAccounts.set(account, recordBlock(this.uncertainAccounts.get(account), 'chave-ic', keyFaults));
      return;
    }
    pairs.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const key = pairs.map(([kind, code]) => kind + ' ' + code).join(' · ');
    let combinations = this.combinations.get(account);
    if (!combinations) this.combinations.set(account, combinations = new Map());
    let group = combinations.get(key);
    if (!group) combinations.set(key, group = { net: valueTypes.map(() => zero), lines: sample(), occurrences: new Map() });
    remember(group.lines, line);
    if (amount === null) {
      group.block = recordBlock(group.block, 'dados-saldo', valueFaults);
      return;
    }
    group.net[type] = add(group.net[type], side === 'D' ? amount : negate(amount));
    const signature = type + '/' + side + '/' + amount.units + '/' + amount.scale;
    const occurrences = group.occurrences.get(signature);
    if (occurrences === undefined) group.occurrences.set(signature, line);
    else if (typeof occurrences === 'number') group.occurrences.set(signature, { count: 2, items: [occurrences, line] });
    else remember(occurrences, line);
  }

  finish(): { groups: BalanceGroup[]; notices: BalanceNotice[] } {
    const groups: BalanceGroup[] = [];
    const notices: BalanceNotice[] = [];
    if (this.fileBlocks.size) {
      const blocks = [...this.fileBlocks.values()];
      for (const id of Object.keys(balanceRules) as BalanceRuleId[]) {
        groups.push({ id, group: 'Arquivo', state: 'Bloqueada', totals: [], blocks, lines: sample() });
      }
      return { groups, notices };
    }

    const accounts = new Set([...this.combinations.keys(), ...this.uncertainAccounts.keys()]);
    for (const account of [...accounts].sort()) {
      const accountBlock = this.uncertainAccounts.get(account);
      const combinations = this.combinations.get(account);
      if (!combinations) {
        if (accountBlock) groups.push({ id: 'SAL-CONS-01', group: account, state: 'Bloqueada', totals: [], lines: sample(), blocks: [accountBlock] });
        continue;
      }
      for (const key of [...combinations.keys()].sort()) {
        const { net, lines, block, occurrences } = combinations.get(key)!;
        const group = account + ' · ' + key;
        const blocks = [accountBlock, block].filter(item => item !== undefined);
        groups.push(balanceGroup('SAL-CONS-01', group, lines, blocks, () => {
          const [initial, movement, final] = net;
          const expected = add(initial, movement);
          const difference = add(final, negate(expected));
          return { difference, totals: [
            { label: 'Saldo inicial', value: format(initial) }, { label: 'Movimentação', value: format(movement) },
            { label: 'Saldo final informado', value: format(final) }, { label: 'Saldo final esperado', value: format(expected) },
            { label: 'Diferença (informado − esperado)', value: format(difference) },
          ] };
        }));
        const repeated = [...occurrences.keys()].filter(key => typeof occurrences.get(key) !== 'number').sort();
        for (const signature of repeated) {
          const lines = occurrences.get(signature);
          if (lines && typeof lines !== 'number') notices.push({ id: 'SAL-CONS-REP', group, totals: [], lines });
        }
      }
    }

    const equilibria = this.natures.map(({ types, lines }, index) => {
      const group = natureLabels[index];
      const blocks = types.flatMap((type, i) => type.block ? [{ ...type.block, type: valueTypes[i] }] : []);
      types.forEach(({ block, debit, credit, lines }, i) => {
        if (block || !lines.count) return;
        const { difference, totals } = equilibriumTotals(debit, credit);
        if (difference.units !== 0n) notices.push({ id: 'SAL-EQU-TIPO', group, type: valueTypes[i], totals, lines });
      });
      return balanceGroup('SAL-EQU-01', group, lines, blocks, () => equilibriumTotals(
        types.reduce((total, type) => add(total, type.debit), zero),
        types.reduce((total, type) => add(total, type.credit), zero),
      ));
    });
    return { groups: equilibria.concat(groups), notices };
  }
}
