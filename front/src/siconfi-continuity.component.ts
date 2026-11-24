import { Component, input, signal } from '@angular/core';
import type { OnChanges, OnDestroy } from '@angular/core';
import type { BalanceDirection, MonthlyBalances } from './monthly-balances.ts';
import { historyService } from './siconfi-history.ts';
import { compareMonthlyBalances, monthlyDirections } from './siconfi-monthly-balances.ts';
import type { DirectionResult } from './siconfi-monthly-balances.ts';
import { currency, formatCompetence } from './report-presentation.ts';

@Component({
  selector: 'msc-siconfi-continuity',
  templateUrl: './siconfi-continuity.html',
})
export class SiconfiContinuity implements OnChanges, OnDestroy {
  private request: AbortController | null = null;
  readonly balances = input.required<MonthlyBalances | null>();
  readonly period = input.required<string | null>();
  readonly directions = monthlyDirections;
  readonly pageSize = 50;
  readonly currency = currency;
  readonly formatCompetence = formatCompetence;
  readonly busy = signal(false);
  readonly status = signal('');
  readonly results = signal<DirectionResult[]>([]);
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
    this.status.set('Consultando as competências vizinhas…');
    try {
      await compareMonthlyBalances(balances, historyService.load.bind(historyService), request.signal, result => {
        if (this.request === request) this.results.update(results => [...results, result]);
      }, pages => {
        if (this.request === request) this.status.set('Páginas consultadas no Siconfi: ' + pages + '.');
      });
      if (this.request === request) this.status.set('Comparação concluída. Confira o resultado de cada direção.');
    } catch (error) {
      if (this.request === request) this.status.set(error instanceof Error ? error.message : 'A comparação não pôde ser concluída.');
    } finally {
      if (this.request === request) this.stop();
    }
  }

  cancel(): void {
    const balances = this.balances();
    if (!balances) return;
    this.stop();
    this.results.update(results => monthlyDirections.map(({ id, shift }) => {
      const existing = results.find(result => result.id === id);
      if (existing) return existing;
      const month = balances.month + shift;
      const applicable = month >= 1 && month <= 12;
      return {
        id, month, state: applicable ? 'Inconclusiva' : 'Não aplicável',
        message: applicable ? 'A consulta foi cancelada antes de concluir esta direção.' : 'A comparação não cruza exercícios nem inclui o encerramento.',
        differences: [], missingInCsv: 0, missingInSiconfi: 0,
      };
    }));
    this.status.set('Comparação cancelada.');
  }

  referenceMonth(result: DirectionResult): string {
    return formatCompetence('2026-' + String(result.month).padStart(2, '0'));
  }

  visible(result: DirectionResult) {
    const first = (this.pages()[result.id] - 1) * this.pageSize;
    return result.differences.slice(first, first + this.pageSize);
  }

  pageCount(result: DirectionResult): number {
    return Math.ceil(result.differences.length / this.pageSize);
  }

  movePage(id: BalanceDirection, change: number): void {
    this.pages.update(pages => ({ ...pages, [id]: pages[id] + change }));
  }

  private stop(): void {
    this.request?.abort();
    this.request = null;
    this.busy.set(false);
  }
}
