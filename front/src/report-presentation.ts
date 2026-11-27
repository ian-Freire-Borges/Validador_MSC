import type { BalanceGroup } from './balances.ts';
import type { RuleId } from './validation.ts';

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const balanceFormatter = new Intl.NumberFormat('pt-BR');
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
  E09: 'O arquivo precisa ter valores válidos e a MSC mensal precisa ter pelo menos um valor maior que zero.',
  E10: 'Falta preencher um campo do par de informação complementar.',
  C01: 'O código da conta não corresponde a uma conta elegível.',
  C02: 'O tipo de informação complementar não é reconhecido.',
  C03: 'O código da informação complementar não segue o formato exigido.',
  C04: 'O tipo de informação complementar não é permitido para esta conta.',
  C05: 'Falta informar o par de poder e órgão (PO).',
  C06: 'O código do indicador financeiro ou permanente é inválido.',
  C07: 'O código de dívida consolidada é inválido.',
  C08: 'O código de poder e órgão (PO) não consta na tabela de referência.',
  C09: 'Fonte de Recursos (FR) fora do domínio municipal de 2026.',
  C10: 'Código de Acompanhamento da Execução Orçamentária (CO) fora do domínio de 2026.',
  C11: 'Natureza da Receita (NR) fora do domínio de 2026.',
  C13: 'Função e Subfunção (FS) fora do domínio de 2026.',
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

export function advisoryBalance(value: string): string {
  const credit = value.startsWith('−');
  const magnitude = credit ? value.slice(1) : value;
  const [integer, fraction = ''] = magnitude.split('.');
  let cents = BigInt(integer + fraction.slice(0, 2).padEnd(2, '0'));
  if (fraction.charAt(2) >= '5') cents += 1n;
  const reais = balanceFormatter.format(cents / 100n);
  const centavos = (cents % 100n).toString().padStart(2, '0');
  return `R$\u00a0${reais},${centavos} (${credit ? 'C' : 'D'})`;
}

export function validationLabel(errorCount: number, incomplete: boolean): string {
  if (errorCount > 0) return 'Erros na pré-validação';
  return incomplete ? 'Pré-validação incompleta' : 'Sem erros nas verificações executadas';
}
