import { Component, computed, input, signal } from '@angular/core';
import type { OnChanges, OnDestroy } from '@angular/core';
import type { MonthlyBalances } from './monthly-balances.ts';
import { historyService } from './siconfi-history.ts';
import { compareMonthlyBalances } from './siconfi-monthly-balances.ts';
import type { PreviousBalanceResult } from './siconfi-monthly-balances.ts';
import { advisoryBalance, formatCompetence, groupInferredDifferences } from './report-presentation.ts';

@Component({
  selector: 'msc-siconfi-continuity',
  templateUrl: './siconfi-continuity.html',
})
export class SiconfiContinuity implements OnChanges, OnDestroy {
  private request: AbortController | null = null;
  readonly balances = input.required<MonthlyBalances | null>();
  readonly period = input.required<string | null>();
  readonly pageSize = 50;
  readonly advisoryBalance = advisoryBalance;
  readonly busy = signal(false);
  readonly status = signal('');
  readonly result = signal<PreviousBalanceResult | null>(null);
  readonly inferredRows = computed(() => groupInferredDifferences(this.result()?.inferredDifferences ?? []));
  readonly rows = computed(() => [
    ...(this.result()?.differences ?? []),
    ...this.inferredRows().map(({ entry }) => ({
      key: entry.key,
      official: entry.source === 'Siconfi' ? entry.observed : null,
      local: entry.source === 'CSV' ? entry.observed : null,
    })),
  ]);
  readonly needsAttention = computed(() => {
    const state = this.result()?.state;
    return state === 'Divergente' || state === 'Parcial' || state === 'Inconclusiva';
  });
  readonly page = signal(1);
  readonly visible = computed(() => {
    const first = (this.page() - 1) * this.pageSize;
    return this.rows().slice(first, first + this.pageSize).map(({ key, local, official }) => {
      const [account, ...dimensions] = key.split(' · ');
      return { key, account, dimensions, local, official };
    });
  });
  readonly pageCount = computed(() => Math.ceil(this.rows().length / this.pageSize));

  ngOnChanges(): void {
    this.reset();
    void this.compare();
  }

  reset(): void {
    this.stop();
    this.result.set(null);
    this.page.set(1);
    this.status.set('');
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private async compare(): Promise<void> {
    const balances = this.balances();
    if (!balances || this.request) return;
    const request = new AbortController();
    this.request = request;
    this.busy.set(true);
    this.status.set('A comparação com o Siconfi está em andamento.');
    try {
      const result = await compareMonthlyBalances(balances, historyService.load.bind(historyService), request.signal);
      if (this.request === request) {
        this.result.set(result);
        this.status.set(balances.blocked && result.state !== 'Não aplicável'
          ? 'Comparação indisponível devido a dados inválidos ou incompletos no CSV.'
          : 'Confira o resultado da comparação.');
      }
    } catch (error) {
      if (this.request === request) this.status.set(error instanceof Error ? error.message : 'A comparação não pôde ser concluída.');
    } finally {
      if (this.request === request) this.stop();
    }
  }

  referenceMonth(result: PreviousBalanceResult): string {
    return formatCompetence('2026-' + String(result.month).padStart(2, '0'));
  }

  movePage(change: number): void {
    this.page.update(page => page + change);
  }

  private stop(): void {
    this.request?.abort();
    this.request = null;
    this.busy.set(false);
  }
}
