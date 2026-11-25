import { add, decimal, negate } from './decimal.ts';
import type { Decimal } from './decimal.ts';

export type BalanceDirection = 'anterior' | 'posterior';
export type AccountDimension = [type: string, code: string];
export type Competence = Readonly<{ entity: string; month: number }>;
export type MonthlyBalance = { key: string; net: Decimal };
export type BalanceExclusion = { exact: string } | { account: string; pairs: string[] };
type LocalDirection = { balances: MonthlyBalance[]; blocked: boolean; exclusions: BalanceExclusion[] };
export type MonthlyBalances = Competence & Record<BalanceDirection, LocalDirection>;

export function monthlyCompetence(entity: string | null, period: string | null): Competence | null {
  if (!entity || !/^29[0-9]{5}EX$/.test(entity) || !period || !/^2026-(0[1-9]|1[0-2])$/.test(period)) return null;
  return { entity: entity.slice(0, -2), month: Number(period.slice(5)) };
}

export function balanceKey(account: string, dimensions: AccountDimension[]): string {
  const sorted = [...dimensions].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return [account, ...sorted.map(([type, code]) => type + ' ' + code)].join(' · ');
}

export function signedBalance(amount: Decimal, side: 'D' | 'C'): Decimal {
  return side === 'D' ? amount : negate(amount);
}

export function accumulateBalance(target: Map<string, Decimal>, key: string, amount: Decimal): void {
  const existing = target.get(key);
  target.set(key, existing === undefined ? amount : add(existing, amount));
}

export class MonthlyBalanceCollector {
  private readonly balances = { anterior: new Map<string, Decimal>(), posterior: new Map<string, Decimal>() };
  private readonly blocked = { anterior: false, posterior: false };
  private readonly exclusions = { anterior: new Map<string, BalanceExclusion>(), posterior: new Map<string, BalanceExclusion>() };

  block(): void {
    this.blocked.anterior = true;
    this.blocked.posterior = true;
  }

  record(
    identity: { account: string | undefined; dimensions: AccountDimension[]; complete: boolean },
    valueType: string, value: string, side: string, validValue: boolean,
  ): void {
    if (valueType === 'period_change') return;
    if (valueType !== 'beginning_balance' && valueType !== 'ending_balance') {
      this.block();
      return;
    }
    const direction = valueType === 'beginning_balance' ? 'anterior' : 'posterior';
    const { account, dimensions, complete } = identity;
    if (!account) {
      this.blocked[direction] = true;
      return;
    }
    const key = balanceKey(account, dimensions);
    if (!complete || !validValue || (side !== 'D' && side !== 'C')) {
      const exclusion = complete ? { exact: key } : { account, pairs: key.split(' · ').slice(1) };
      this.exclusions[direction].set((complete ? 'exact:' : 'mask:') + key, exclusion);
      return;
    }
    accumulateBalance(this.balances[direction], key, signedBalance(decimal(value), side));
  }

  finish(competence: Competence): MonthlyBalances {
    const result = (direction: BalanceDirection): LocalDirection => ({
      blocked: this.blocked[direction],
      balances: this.blocked[direction] ? [] : [...this.balances[direction]].map(([key, net]) => ({ key, net })),
      exclusions: this.blocked[direction] ? [] : [...this.exclusions[direction].values()],
    });
    return { ...competence, anterior: result('anterior'), posterior: result('posterior') };
  }
}
