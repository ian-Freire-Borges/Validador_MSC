import { ChangeDetectorRef, Component, computed, inject, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { currency, findingTitle, formatCompetence, validationLabel } from './report-presentation.ts';
import { SiconfiContinuity } from './siconfi-continuity.component.ts';
import type { OnDestroy } from '@angular/core';
import type { BlockReason, Finding, ValidationResult } from './validation.ts';
import type { ValidationRequest, WorkerMessage } from './validation.worker.ts';

const reasonLabels: Record<BlockReason, string> = {
  'leitura-incompleta': 'Não foi possível ler o CSV até o fim.',
  'metadados': 'A primeira linha com a instituição e a competência está ausente ou fora do leiaute esperado.',
  'guia': 'O cabeçalho das colunas está ausente ou fora do leiaute esperado.',
  'instituição': 'Não foi possível confirmar que a instituição é um Executivo municipal.',
  'competência': 'A competência está fora do período coberto pelo validador.',
  'catálogo': 'O catálogo de regras está indisponível ou é incompatível.',
  'registro': 'Um registro tem um número de campos diferente do esperado.',
  'par-incompleto': 'Falta o código ou o tipo em um par de campos de informação complementar.',
  'tipo': 'O tipo de informação complementar não é reconhecido.',
  'conta': 'A conta não é elegível no catálogo.',
  'largura': 'Um código de informação complementar não tem a quantidade de dígitos ou o formato exigido.',
  'outra-esfera': 'A instituição pertence ao Executivo de outra esfera de governo.',
  'cadastro-inconclusivo': 'A tabela do Siconfi usada nesta validação não permitiu confirmar a instituição.',
  'sem-registros': 'O CSV não tem registros para verificar.',
  'chave-ic': 'A combinação de informações complementares está incompleta, inválida ou ambígua.',
  'dados-saldo': 'O valor, o tipo de valor ou a indicação de débito ou crédito está ausente ou inválido.',
};

@Component({
  selector: 'msc-root',
  imports: [SiconfiContinuity],
  templateUrl: './app.html',
  host: { '(window:beforeprint)': 'preparePrinting()', '(window:afterprint)': 'finishPrinting()' },
})
class App implements OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly continuity = viewChild(SiconfiContinuity);
  private worker: Worker | null = null;
  private file: File | null = null;
  readonly fileName = signal('');
  readonly busy = signal(false);
  readonly status = signal('Selecione um arquivo CSV.');
  readonly progress = signal(0);
  readonly result = signal<ValidationResult | null>(null);
  readonly activeReportTab = signal<'resultado' | 'avisos'>('resultado');
  readonly page = signal(1);
  readonly pageSize = 50;
  readonly printing = signal(false);
  readonly noticesNeedAttention = computed(() => this.continuity()?.needsAttention() ?? false);
  readonly noticesBusy = computed(() => this.continuity()?.busy() ?? false);
  readonly findings = computed(() => this.result()?.findings.filter(finding => finding.status === 'Falhou') ?? []);
  readonly hasSourceOfFundsExportError = computed(() => this.findings().some(finding => this.isSourceOfFundsExportError(finding)));
  readonly currency = currency;
  readonly findingTitle = findingTitle;
  readonly formatCompetence = formatCompetence;
  readonly blockedReasons = computed(() => {
    const report = this.result();
    if (!report) return [];
    const reasons = Object.values(report.rules).flatMap(rule => Object.keys(rule.reasons) as BlockReason[]);
    return [...new Set(reasons)].map(reason => reasonLabels[reason]);
  });
  readonly balanceFailures = computed(() => this.result()?.balances.groups.filter(group => group.state === 'Falhou') ?? []);
  readonly structureCount = computed(() => this.findings().filter(finding => this.category(finding) === 'Estrutura').length);
  readonly errorCount = computed(() => this.findings().length + this.balanceFailures().length);
  readonly incomplete = computed(() => {
    const report = this.result();
    return !!report && Object.values(report.rules).some(rule => rule.blocked > 0);
  });
  readonly reportStatus = computed(() => validationLabel(this.errorCount(), this.incomplete()));
  readonly contentCount = computed(() => this.errorCount() - this.structureCount());
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.errorCount() / this.pageSize)));
  readonly visible = computed(() => {
    if (this.printing()) return this.findings();
    const first = (this.page() - 1) * this.pageSize;
    return this.findings().slice(first, first + this.pageSize);
  });
  readonly visibleBalances = computed(() => {
    if (this.printing()) return this.balanceFailures();
    const first = (this.page() - 1) * this.pageSize - this.findings().length;
    return this.balanceFailures().slice(Math.max(0, first), Math.max(0, first + this.pageSize));
  });

  category(finding: Finding): 'Estrutura' | 'Conteúdo' {
    return finding.id.startsWith('C') ? 'Conteúdo' : 'Estrutura';
  }

  isSourceOfFundsExportError(finding: Finding): boolean {
    return finding.id === 'C03' && finding.observed === '*ERRO*' && finding.expected === '4 dígitos ASCII para FR';
  }

  lineText(lines: { count: number; items: number[] }): string {
    if (!lines.count) return '—';
    return lines.count > lines.items.length ? `${lines.count} registros (amostra das linhas: ${lines.items.join(', ')})` : lines.items.join(', ');
  }

  selectFile(files: FileList | null): void {
    this.file = files?.item(0) ?? null;
    this.fileName.set(this.file?.name ?? '');
    this.reset(this.file ? 'Arquivo selecionado. Selecione Validar.' : 'Selecione um arquivo CSV.');
  }

  run(): void {
    if (!this.file || this.busy()) return;
    this.reset('Lendo o arquivo.');
    try {
      const worker = new Worker(new URL('./validation.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      this.busy.set(true);
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (this.worker !== worker) return;
        if (data.type === 'progress') {
          const { bytesRead, totalBytes, phase } = data.progress;
          this.progress.set(totalBytes ? Math.min(99, Math.floor(bytesRead / totalBytes * 100)) : 0);
          const status = phase === 'catálogo' ? 'Conferindo o catálogo.' : 'Verificando os registros.';
          if (this.status() !== status) this.status.set(status);
        } else if (data.type === 'complete') {
          this.stop();
          this.progress.set(100);
          this.result.set(data.result);
          this.status.set('Pré-validação local concluída.');
        } else {
          this.reset(data.stage === 'leitura'
            ? 'Falha durante a leitura. Reexporte o CSV em UTF-8 e valide novamente.'
            : 'Falha durante a validação. Selecione Validar para tentar de novo.');
        }
      };
      worker.onerror = () => {
        if (this.worker === worker) this.reset('Falha ao iniciar a validação. Recarregue a aplicação e tente novamente.');
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.reset('Falha ao receber o resultado. Selecione Validar para tentar de novo.');
      };
      worker.postMessage({ file: this.file } satisfies ValidationRequest);
    } catch {
      this.reset('Falha ao iniciar a validação. Recarregue a aplicação e tente novamente.');
    }
  }

  cancel(): void {
    if (this.busy()) this.reset('Validação cancelada.');
  }

  movePage(change: number): void {
    this.page.update(page => Math.max(1, Math.min(this.pageCount(), page + change)));
  }

  navigateReportTabs(event: KeyboardEvent, resultTab: HTMLButtonElement, noticesTab: HTMLButtonElement): void {
    let tab = this.activeReportTab();
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        tab = tab === 'resultado' ? 'avisos' : 'resultado';
        break;
      case 'Home':
        tab = 'resultado';
        break;
      case 'End':
        tab = 'avisos';
        break;
      default:
        return;
    }
    event.preventDefault();
    this.activeReportTab.set(tab);
    (tab === 'resultado' ? resultTab : noticesTab).focus();
  }

  printErrors(): void {
    if (!this.errorCount() || this.printing()) return;
    this.preparePrinting();
    window.print();
  }

  preparePrinting(): void {
    if (!this.result() || this.printing()) return;
    this.printing.set(true);
    this.changeDetector.detectChanges();
  }

  finishPrinting(): void {
    this.printing.set(false);
  }

  describeLocation(finding: Finding): string {
    if (finding.byteOffset !== undefined) return 'Linha ' + finding.line + ', byte ' + finding.byteOffset;
    if (finding.line === undefined) return 'Arquivo';
    return [
      'Linha ' + finding.line,
      finding.fieldIndex === undefined ? '' : 'campo ' + finding.fieldIndex,
      finding.fieldName ?? '',
      finding.pair === undefined ? '' : 'par ' + finding.pair,
    ].filter(Boolean).join(', ');
  }

  describeObserved(value: string): string {
    if (value === '') return '(vazio)';
    if (value.trim() === '') return '(somente espaços em branco)';
    return value;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private reset(status: string): void {
    this.stop();
    this.continuity()?.reset();
    this.result.set(null);
    this.progress.set(0);
    this.page.set(1);
    this.activeReportTab.set('resultado');
    this.finishPrinting();
    this.status.set(status);
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.busy.set(false);
  }
}

bootstrapApplication(App);
