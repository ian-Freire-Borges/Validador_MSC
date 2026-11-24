import { Component, computed, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { HistoryError, historyService, pageSize, validateFilters, valueTypes } from './siconfi-history.ts';
import type { Filters, HistoryPage } from './siconfi-history.ts';

const primaryFields = [
  ['conta_contabil', 'Conta contábil'],
  ['valor', 'Valor (R$)'],
  ['natureza_conta', 'Natureza'],
  ['tipo_valor', 'Tipo de valor'],
] as const;

@Component({
  selector: 'msc-siconfi-history',
  templateUrl: './siconfi-history.html',
})
export class SiconfiHistory implements OnDestroy {
  private request: AbortController | null = null;
  readonly expanded = signal(false);
  readonly busy = signal(false);
  readonly status = signal('Preencha os filtros para consultar a matriz mensal.');
  readonly error = signal('');
  readonly filters = signal<Filters | null>(null);
  readonly page = signal<HistoryPage | null>(null);
  readonly failed = signal<{ offset: number; refresh: boolean } | null>(null);
  readonly valueTypes = valueTypes;
  readonly monthNumbers = Array.from({ length: 12 }, (_, index) => index + 1);
  readonly classes = Array.from({ length: 8 }, (_, index) => index + 1);
  readonly currentYear = new Date().getFullYear();
  readonly pageSize = pageSize;
  readonly primaryFields = primaryFields;
  readonly additionalFields = computed(() => {
    const fields = new Set<string>();
    for (const row of this.page()?.rows ?? []) {
      for (const field of Object.keys(row)) {
        if (!primaryFields.some(([key]) => key === field)) fields.add(field);
      }
    }
    return [...fields];
  });

  toggle(): void {
    this.expanded.update(value => !value);
    if (!this.expanded()) {
      this.changeFilters();
    }
  }

  changeFilters(): void {
    const interrupted = this.busy();
    this.stop();
    this.filters.set(null);
    this.page.set(null);
    this.failed.set(null);
    this.error.set('');
    this.status.set(interrupted ? 'Consulta cancelada.' : 'Preencha os filtros para consultar a matriz mensal.');
  }

  cancel(): void {
    this.stop();
    this.status.set('Consulta cancelada.');
  }

  submit(event: Event, entity: string, year: string, month: string, accountClass: string, valueType: string): void {
    event.preventDefault();
    if (this.busy()) return;
    const input = validateFilters({ entity, year, month, accountClass, valueType });
    if (typeof input === 'string') {
      this.error.set(input);
      this.status.set('');
      return;
    }
    this.filters.set(input);
    this.page.set(null);
    void this.load(0);
  }

  async load(offset: number, refresh = false): Promise<void> {
    const filters = this.filters();
    if (!filters || this.busy()) return;
    const request = new AbortController();
    this.request = request;
    this.error.set('');
    this.failed.set(null);
    this.busy.set(true);
    this.status.set('Consultando o Siconfi…');
    try {
      const page = await historyService.load(filters, offset, refresh, request.signal);
      if (this.request !== request) return;
      this.page.set(page);
      this.status.set(page.rows.length
        ? 'Página ' + (offset / pageSize + 1) + ' carregada com ' + page.rows.length + ' registros.'
        : 'O Siconfi retornou zero registros para esta consulta.');
    } catch (error) {
      if (this.request !== request) return;
      this.error.set(error instanceof HistoryError ? error.message : 'A consulta ao Siconfi está indisponível.');
      this.status.set('');
      this.failed.set({ offset, refresh });
    } finally {
      if (this.request === request) {
        this.request = null;
        this.busy.set(false);
      }
    }
  }

  private stop(): void {
    this.request?.abort();
    this.request = null;
    this.busy.set(false);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  display(value: string | null | undefined): string {
    if (value === undefined) return 'Ausente';
    if (value === null) return 'Nulo';
    if (value === '') return '(vazio)';
    return value;
  }
}
