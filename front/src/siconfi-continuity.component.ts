import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import type { OnChanges, OnDestroy } from '@angular/core';
import type { MonthlyBalances } from './monthly-balances.ts';
import { historyService } from './siconfi-history.ts';
import { compareMonthlyPeriods } from './siconfi-monthly-balances.ts';
import type { BalanceDirection, MonthlyComparisonResult } from './siconfi-monthly-balances.ts';
import { advisoryBalance, formatCompetence } from './report-presentation.ts';

@Component({
  selector: 'msc-siconfi-continuity',
  imports: [NgTemplateOutlet],
  templateUrl: './siconfi-continuity.html',
})
export class SiconfiContinuity implements OnChanges, OnDestroy {
  private request: AbortController | null = null;
  readonly balances = input.required<MonthlyBalances | null>();
  readonly period = input.required<string | null>();
  readonly pageSize = 50;
  readonly advisoryBalance = advisoryBalance;
  readonly currentMonth = computed(() => formatCompetence(this.period()));
  readonly busy = signal(false);
  readonly status = signal('');
  readonly results = signal<MonthlyComparisonResult[]>([]);
  readonly comparisons = computed(() => this.results().map(result => {
    const rows = [...result.differences, ...(result.inferredDifferences ?? []).map(entry => ({
      key: entry.key,
      official: entry.source === 'Siconfi' ? entry.observed : null,
      local: entry.source === 'CSV' ? entry.observed : null,
    }))];
    return { result, rows, pageCount: Math.ceil(rows.length / this.pageSize) };
  }));
  readonly hasRows = computed(() => this.comparisons().some(comparison => comparison.rows.length > 0));
  readonly needsAttention = computed(() => this.results().some(({ state }) =>
    state === 'Divergente' || state === 'Parcial' || state === 'Inconclusiva'));
  readonly pages = signal({ anterior: 1, posterior: 1 });

  ngOnChanges(): void {
    this.reset();
    void this.compare();
  }

  reset(): void {
    this.stop();
    this.results.set([]);
    this.pages.set({ anterior: 1, posterior: 1 });
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
      await compareMonthlyPeriods(balances, historyService.load.bind(historyService), request.signal, result => {
        if (this.request === request) this.results.update(results => [...results, result]);
      });
      if (this.request === request) {
        const allBlocked = (balances.month === 1 || balances.blocked) && (balances.month === 12 || balances.ending.blocked);
        this.status.set(allBlocked
          ? 'Comparação indisponível devido a dados inválidos ou incompletos no CSV.'
          : 'Confira o resultado da comparação.');
      }
    } catch (error) {
      if (this.request === request) this.status.set(error instanceof Error ? error.message : 'A comparação não pôde ser concluída.');
    } finally {
      if (this.request === request) this.stop();
    }
  }

  referenceMonth(result: MonthlyComparisonResult): string {
    return formatCompetence('2026-' + String(result.month).padStart(2, '0'));
  }

  movePage(direction: BalanceDirection, change: number): void {
    this.pages.update(pages => ({ ...pages, [direction]: pages[direction] + change }));
  }

  private stop(): void {
    this.request?.abort();
    this.request = null;
    this.busy.set(false);
  }
}
