import { Component, computed, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { validationRules } from './validation.ts';
import { SiconfiHistory } from './siconfi-history.component.ts';
import type { OnDestroy } from '@angular/core';
import type { Encoding } from './csv.ts';
import type { BlockReason, Finding, ValidationResult } from './validation.ts';
import type { ValidationRequest, WorkerMessage } from './validation.worker.ts';

const reasonLabels: Record<BlockReason, string> = {
  'leitura-incompleta': 'Leitura incompleta',
  'metadados': 'Metadados indisponíveis ou inválidos',
  'guia': 'Guia indisponível ou inválida',
  'instituição': 'Instituição sem enquadramento confirmado neste perfil',
  'competência': 'Competência fora do perfil',
  'catálogo': 'Catálogo indisponível ou incompatível',
  'registro': 'Registro com tamanho inválido',
  'par-incompleto': 'Par IC/TIPO incompleto',
  'tipo': 'Tipo de IC desconhecido',
  'conta': 'Conta inelegível',
  'largura': 'Largura ou composição do IC inválida',
  'outra-esfera': 'Executivo de outra esfera, fora da cobertura',
  'cadastro-inconclusivo': 'Cadastro inconclusivo na edição da tabela Siconfi',
  'sem-registros': 'Arquivo sem registros',
  'chave-ic': 'Combinação de informações complementares incompleta, inválida ou ambígua',
  'dados-saldo': 'Valor, tipo de valor ou natureza D/C inválido ou ausente',
};

@Component({
  selector: 'msc-root',
  imports: [SiconfiHistory],
  templateUrl: './app.html',
})
class App implements OnDestroy {
  private worker: Worker | null = null;
  private file: File | null = null;
  readonly fileName = signal('');
  readonly encoding = signal<Encoding>('UTF-8');
  readonly busy = signal(false);
  readonly status = signal('Selecione um arquivo CSV.');
  readonly progress = signal(0);
  readonly result = signal<ValidationResult | null>(null);
  readonly page = signal(1);
  readonly pageSize = 50;
  readonly findings = computed(() => this.result()?.findings.filter(finding => finding.status === 'Falhou') ?? []);
  readonly hasSourceOfFundsExportError = computed(() => this.findings().some(finding =>
    finding.id === 'C03' && finding.observed === '*ERRO*' && finding.expected === '4 dígitos ASCII para FR',
  ));
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.findings().length / this.pageSize)));
  readonly visible = computed(() => {
    const first = (this.page() - 1) * this.pageSize;
    return this.findings().slice(first, first + this.pageSize);
  });
  readonly ruleInfo = validationRules;
  readonly blockedReasons = computed(() => {
    const report = this.result();
    if (!report) return [];
    const reasons = Object.values(report.rules).flatMap(rule => Object.keys(rule.reasons) as BlockReason[]);
    return [...new Set(reasons)].map(reason => reasonLabels[reason]);
  });
  readonly balancePage = signal(1);
  readonly balanceFailures = computed(() => this.result()?.balances.groups.filter(group => group.state === 'Falhou') ?? []);
  readonly balancePageCount = computed(() => Math.max(1, Math.ceil(this.balanceFailures().length / this.pageSize)));
  readonly visibleBalances = computed(() => {
    const first = (this.balancePage() - 1) * this.pageSize;
    return this.balanceFailures().slice(first, first + this.pageSize);
  });

  lineText(lines: { count: number; items: number[] }): string {
    if (!lines.count) return '—';
    return lines.count > lines.items.length ? `${lines.count} registros (amostra das linhas: ${lines.items.join(', ')})` : lines.items.join(', ');
  }

  selectFile(files: FileList | null): void {
    this.file = files?.item(0) ?? null;
    this.fileName.set(this.file?.name ?? '');
    this.reset(this.file ? 'Arquivo selecionado. Confira a codificação e selecione Validar.' : 'Selecione um arquivo CSV.');
  }

  selectEncoding(encoding: string): void {
    this.encoding.set(encoding === 'Windows-1252' ? encoding : 'UTF-8');
    this.reset(this.file ? 'Codificação selecionada. Selecione Validar para processar o arquivo.' : 'Selecione um arquivo CSV.');
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
          this.status.set('Execução encerrada. ' + data.result.summary + '.');
        } else {
          this.reset('Falha durante a ' + data.stage + '. Selecione Validar para tentar de novo.');
        }
      };
      worker.onerror = () => {
        if (this.worker === worker) this.reset('Falha ao iniciar a validação. Recarregue a aplicação e tente novamente.');
      };
      worker.onmessageerror = () => {
        if (this.worker === worker) this.reset('Falha ao receber o resultado. Selecione Validar para tentar de novo.');
      };
      worker.postMessage({ file: this.file, encoding: this.encoding() } satisfies ValidationRequest);
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
    this.result.set(null);
    this.progress.set(0);
    this.page.set(1);
    this.balancePage.set(1);
    this.status.set(status);
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.busy.set(false);
  }
}

bootstrapApplication(App);
