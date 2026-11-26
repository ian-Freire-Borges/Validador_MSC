import { add, decimal, negate } from './decimal.ts';
import type { Decimal } from './decimal.ts';

export type AccountDimension = [type: string, code: string];
export type Competence = Readonly<{ entity: string; month: number }>;
export type MonthlyBalance = { key: string; net: Decimal };
export type BalanceExclusion = { exact: string } | { account: string; pairs: string[] };
export type MonthlyBalances = Competence & { balances: MonthlyBalance[]; blocked: boolean; exclusions: BalanceExclusion[] };

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
  private readonly balances = new Map<string, Decimal>();
  private blocked = false;
  private readonly exclusions = new Map<string, BalanceExclusion>();

  block(): void {
    this.blocked = true;
  }

  record(
    identity: { account: string | undefined; dimensions: AccountDimension[]; complete: boolean },
    valueType: string, value: string, side: string, validValue: boolean,
  ): void {
    if (valueType === 'period_change' || valueType === 'ending_balance') return;
    if (valueType !== 'beginning_balance') {
      this.block();
      return;
    }
    const { account, dimensions, complete } = identity;
    if (!account) {
      this.block();
      return;
    }
    const key = balanceKey(account, dimensions);
    if (!complete || !validValue || (side !== 'D' && side !== 'C')) {
      const exclusion = complete ? { exact: key } : { account, pairs: key.split(' · ').slice(1) };
      this.exclusions.set((complete ? 'exact:' : 'mask:') + key, exclusion);
      return;
    }
    accumulateBalance(this.balances, key, signedBalance(decimal(value), side));
  }

  finish(competence: Competence): MonthlyBalances {
    return {
      ...competence,
      blocked: this.blocked,
      balances: this.blocked ? [] : [...this.balances].map(([key, net]) => ({ key, net })),
      exclusions: this.blocked ? [] : [...this.exclusions.values()],
    };
  }
}
