import { widths } from './catalog.ts';
import type { BalanceGroup } from './balances.ts';
import type { InferredDifference } from './siconfi-monthly-balances.ts';
import type { RuleId } from './validation.ts';

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const findingTitles: Record<Exclude<RuleId, BalanceGroup['id']>, string> = {
  L01: 'O arquivo contém bytes inválidos para a leitura em UTF-8.',
  L02: 'A primeira linha não segue o formato dos metadados da MSC.',
  E01: 'O registro não segue a sintaxe do CSV.',
  E02: 'O código da instituição transmissora não é elegível.',
  E03: 'A linha de cabeçalho não segue o leiaute da MSC.',
  E04: 'A competência está fora dos períodos aceitos.',
  E05: 'O registro tem uma quantidade incorreta de campos.',
  E06: 'O valor do registro não está no formato aceito.',
  E07: 'O tipo de valor não é reconhecido.',
  E08: 'A natureza do valor deve ser débito ou crédito.',
  E09: 'O arquivo precisa ter pelo menos um registro com valor válido.',
  E10: 'Falta preencher um campo do par de informação complementar.',
  C01: 'O código da conta não corresponde a uma conta elegível.',
  C02: 'O tipo de informação complementar não é reconhecido.',
  C03: 'O código da informação complementar não segue o formato exigido.',
  C04: 'O tipo de informação complementar não é permitido para esta conta.',
  C05: 'Falta informar o par de poder e órgão (PO).',
  C06: 'O código do indicador financeiro ou permanente é inválido.',
  C07: 'O código de dívida consolidada é inválido.',
  C08: 'O código de poder e órgão (PO) não consta na tabela de referência.',
};

export function findingTitle(id: RuleId): string {
  if (id === 'SAL-CONS-01') return 'O saldo final informado não confere.';
  if (id === 'SAL-EQU-01') return 'O total de débitos não confere com o de créditos.';
  return findingTitles[id];
}

export function formatCompetence(period: string | null): string {
  if (period === '2026-13') return 'Encerramento de 2026';
  const valid = period?.match(/^(2026)-(0[1-9]|1[0-2])$/);
  return valid ? monthFormatter.format(new Date(Date.UTC(Number(valid[1]), Number(valid[2]) - 1, 1))) : 'Não identificada';
}

export function currency(value: string): string {
  return 'R$ ' + value.replace('.', ',');
}

export function validationLabel(errorCount: number, incomplete: boolean): string {
  if (errorCount > 0) return 'Erros na pré-validação';
  return incomplete ? 'Pré-validação incompleta' : 'Sem erros nas verificações executadas';
}
const icTypes = Object.keys(widths);
type GroupedInferredRow = { entry: InferredDifference; paired?: {
  account: string; csvPairs: string; officialPairs: string; changedType: string; official: InferredDifference;
} };

export function groupInferredDifferences(entries: InferredDifference[]): GroupedInferredRow[] {
  const buckets = new Map<string, Partial<Record<InferredDifference['source'], InferredDifference | null>>>();
  function signatures(entry: InferredDifference): string[] {
    const [account, ...pairs] = entry.key.split(' · ');
    return icTypes.map(type => [account, entry.observed, type, ...pairs.filter(pair => !pair.startsWith(type + ' '))].join('|'));
  }
  for (const entry of entries) {
    for (const key of signatures(entry)) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {};
        buckets.set(key, bucket);
      }
      bucket[entry.source] = bucket[entry.source] === undefined ? entry : null;
    }
  }

  const matches = new Map<InferredDifference, InferredDifference>();
  for (const entry of entries) {
    const otherSource = entry.source === 'CSV' ? 'Siconfi' : 'CSV';
    let match: InferredDifference | undefined;
    for (const key of signatures(entry)) {
      const other = buckets.get(key)?.[otherSource];
      if (other === null || (other && other.key !== entry.key && match && match !== other)) {
        match = undefined;
        break;
      }
      if (other && other.key !== entry.key) match = other;
    }
    if (match) matches.set(entry, match);
  }

  const rows: GroupedInferredRow[] = [];
  for (const entry of entries) {
    const other = matches.get(entry);
    if (!other || matches.get(other) !== entry) {
      rows.push({ entry });
    } else if (entry.source === 'CSV') {
      const [account, ...csv] = entry.key.split(' · ');
      const [, ...official] = other.key.split(' · ');
      const changedType = (csv.find(pair => !official.includes(pair)) ?? official.find(pair => !csv.includes(pair)))!.split(' ')[0];
      rows.push({ entry, paired: { account, csvPairs: csv.join(' · '), officialPairs: official.join(' · '), changedType, official: other } });
    }
  }
  return rows;
}
