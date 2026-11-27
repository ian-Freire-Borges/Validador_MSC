import { columns, compatibleCatalog, natures, rules, valueTypes } from './catalog.ts';
import { decodeLines, parseRecord } from './csv.ts';
import { balanceOrigin, balanceRules, Balances } from './balances.ts';
import type { BalanceOrigin } from './balances.ts';
import { MonthlyBalanceCollector, monthlyCompetence } from './monthly-balances.ts';
import type { Competence, MonthlyBalances } from './monthly-balances.ts';

export const validationRules = { ...rules, ...balanceRules };
export type RuleId = keyof typeof validationRules;
export type RuleState = 'Conforme' | 'Falhou' | 'Bloqueada' | 'Não aplicável';
export type BlockReason =
  | 'leitura-incompleta' | 'metadados' | 'guia' | 'instituição' | 'competência' | 'catálogo'
  | 'registro' | 'par-incompleto' | 'tipo' | 'conta' | 'largura'
  | 'outra-esfera' | 'cadastro-inconclusivo' | 'sem-registros' | 'chave-ic' | 'dados-saldo';

export interface Finding {
  id: RuleId;
  status: 'Falhou' | 'Bloqueada';
  line?: number;
  fieldIndex?: number;
  fieldName?: string;
  pair?: number;
  byteOffset?: number;
  accountCode?: string;
  observed: string;
  expected: string;
  reason?: BlockReason;
}

interface Location {
  line?: number;
  fieldIndex?: number;
  fieldName?: string;
  pair?: number;
  byteOffset?: number;
}

interface RuleCounts {
  passed: number;
  failed: number;
  blocked: number;
  reasons: Partial<Record<BlockReason, number>>;
}

export interface ValidationResult {
  catalogVersion: string | null;
  catalogCompatible: boolean;
  institution: string | null;
  institutionName: string | null;
  institutionStatus: 'municipal' | 'outra-esfera' | 'cadastro-inconclusivo' | 'inelegível' | 'incompatível' | null;
  period: string | null;
  periodKind: 'Mensal' | 'Encerramento' | null;
  records: number;
  findings: Finding[];
  rules: Record<RuleId, RuleCounts & { state: RuleState }>;
  balances: ReturnType<Balances['finish']>;
  monthlyBalances: MonthlyBalances | null;
  summary: 'Pendências nas verificações do MVP 1.1' | 'Verificação incompleta' | 'Sem pendências nas verificações executadas do MVP 1.1';
}

const contentRules: RuleId[] = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10'];
const recordRules: RuleId[] = ['E06', 'E07', 'E08', 'E10', ...contentRules];
const dataRules: RuleId[] = ['E05', ...recordRules];
const domainRules = { FP: 'C06', DC: 'C07', PO: 'C08', FR: 'C09', CO: 'C10' } as const;
const domainExpectations: Partial<Record<string, string>> = {
  PO: 'Código da aba PO do Anexo II',
  FR: 'Código FR municipal da aba FR 2026 do Anexo II, com prefixo 1, 2 ou 9 e código principal listado no bloco subnacional',
  CO: 'Código de quatro dígitos listado na aba CO 2026 do Anexo II',
};
const ruleIds = Object.keys(validationRules) as RuleId[];

function location(line: number, fieldIndex?: number, fieldName?: string): Location {
  if (fieldIndex === undefined) return { line };
  const pair = line >= 3 && fieldIndex >= 2 && fieldIndex <= 13 ? Math.floor(fieldIndex / 2) : undefined;
  return { line, fieldIndex, fieldName: fieldName ?? (line >= 2 ? columns[fieldIndex - 1] : undefined), pair };
}

export interface ValidationProgress {
  bytesRead: number;
  totalBytes: number;
  records: number;
  phase: 'catálogo' | 'leitura e análise';
}

export function validate(
  bytes: Uint8Array, candidate: unknown,
  onProgress?: (progress: ValidationProgress) => void,
): ValidationResult {
  onProgress?.({ bytesRead: 0, totalBytes: bytes.length, records: 0, phase: 'catálogo' });
  const catalog = compatibleCatalog(candidate) ? candidate : null;
  const catalogVersion = candidate && typeof candidate === 'object' && 'version' in candidate && typeof candidate.version === 'string'
    ? candidate.version : null;
  const counts = Object.fromEntries(ruleIds.map(id => [id, { passed: 0, failed: 0, blocked: 0, reasons: {} }])) as Record<RuleId, RuleCounts>;
  const findings: Finding[] = [];
  const balances = new Balances();
  let institution: string | null = null;
  let institutionName: string | null = null;
  let institutionStatus: ValidationResult['institutionStatus'] = null;
  let period: string | null = null;
  let periodKind: ValidationResult['periodKind'] = null;
  let records = 0;
  let lineCount = 0;
  let lastProgressByte = 0;
  let readFault: 'bytes' | 'syntax' | null = null;
  let metadataValid = false;
  let headerValid = false;
  let validValue = false;
  let monthly: { competence: Competence; collector: MonthlyBalanceCollector } | null = null;

  const check = (id: RuleId, ok: boolean, at: Location, observed: string, expected: string): boolean => {
    if (ok) counts[id].passed++;
    else {
      counts[id].failed++;
      findings.push({ id, status: 'Falhou', ...at, observed, expected });
    }
    return ok;
  };

  const block = (id: RuleId, reason: BlockReason, detail?: Omit<Finding, 'id' | 'status' | 'reason'>) => {
    const rule = counts[id];
    rule.blocked++;
    rule.reasons[reason] = (rule.reasons[reason] ?? 0) + 1;
    if (detail) findings.push({ id, status: 'Bloqueada', reason, ...detail });
  };

  const contentBlock = (): BlockReason | null => {
    if (!catalog) return 'catálogo';
    if (institutionStatus === 'outra-esfera' || institutionStatus === 'cadastro-inconclusivo') return institutionStatus;
    if (institutionStatus !== 'municipal') return 'instituição';
    return periodKind ? null : 'competência';
  };

  onProgress?.({ bytesRead: 0, totalBytes: bytes.length, records: 0, phase: 'leitura e análise' });
  for (const line of decodeLines(bytes)) {
    if (line.fault) {
      readFault = 'bytes';
      check('L01', false, { line: line.number, byteOffset: line.fault.offset }, line.fault.observed, line.fault.expected);
      block('E01', 'leitura-incompleta');
      break;
    }
    const parsed = parseRecord(line.text!);
    if (!('fields' in parsed)) {
      readFault = 'syntax';
      check('E01', false, location(line.number, parsed.fieldIndex, line.number === 1 ? ['Instituição', 'Competência'][parsed.fieldIndex - 1] : undefined),
        parsed.observed, parsed.expected);
      if (line.endByte < bytes.length) block('L01', 'leitura-incompleta');
      else check('L01', true, {}, 'UTF-8', 'UTF-8');
      break;
    }
    const fields = parsed.fields;
    lineCount = line.number;
    if (lineCount === 1) {
      institution = fields[0] ?? null;
      period = fields[1] ?? null;
      const firstExtra = fields.findIndex((field, index) => index >= 2 && field !== '');
      metadataValid = check('L02', fields.length === 2 || (fields.length === 16 && firstExtra < 0),
        firstExtra < 0 ? location(1) : location(1, firstExtra + 1),
        firstExtra < 0 ? String(fields.length) + ' campos' : fields[firstExtra],
        '2 campos ou 16 campos com C:P vazios');
      if (!metadataValid) {
        block('E02', 'metadados');
        block('E04', 'metadados');
      } else {
        const code = fields[0];
        const at = location(1, 1, 'Instituição');
        const expected = 'Código de Executivo municipal da tabela Siconfi de 28/08/2025';
        const group = catalog?.institutions;
        if (group && Object.hasOwn(group.otherExecutive, code)) {
          institutionName = group.otherExecutive[code];
          institutionStatus = 'outra-esfera';
          block('E02', 'outra-esfera', { ...at, observed: code, expected });
        } else if (group && Object.hasOwn(group.ineligible, code)) {
          institutionName = group.ineligible[code];
          institutionStatus = 'inelegível';
          check('E02', false, at, code, expected);
        } else if (!/^[0-9]{7}EX$/.test(code)) {
          if (!catalog && /^[0-9]{1,2}EX$/.test(code)) {
            block('E02', 'catálogo', { ...at, observed: code, expected });
          } else {
            institutionStatus = 'incompatível';
            check('E02', false, at, code, expected);
          }
        } else if (!group) {
          block('E02', 'catálogo', { ...at, observed: code, expected });
        } else if (!Object.hasOwn(group.municipal, code)) {
          institutionStatus = 'cadastro-inconclusivo';
          block('E02', 'cadastro-inconclusivo', { ...at, observed: code, expected });
        } else {
          institutionName = group.municipal[code];
          institutionStatus = 'municipal';
          check('E02', true, at, code, expected);
        }
        if (check('E04', /^2026-(0[1-9]|1[0-3])$/.test(fields[1]), location(1, 2, 'Competência'),
          fields[1], '2026-01 a 2026-13')) {
          periodKind = fields[1] === '2026-13' ? 'Encerramento' : 'Mensal';
        }
        const competence = institutionStatus === 'municipal' && monthlyCompetence(institution, period);
        if (catalog && competence) monthly = { competence, collector: new MonthlyBalanceCollector() };
      }
    } else if (lineCount === 2) {
      const different = columns.findIndex((field, index) => field !== fields[index]);
      const index = different < 0 ? undefined : different + 1;
      headerValid = check('E03', fields.length === columns.length && different < 0, location(2, index),
        index === undefined ? String(fields.length) + ' campos' : fields[index - 1] ?? '(campo ausente)',
        index === undefined ? '16 campos na sequência canônica' : columns[index - 1]);
    } else {
      records++;
      const unavailable: BlockReason | null = !metadataValid ? 'metadados' : !headerValid ? 'guia' : null;
      if (unavailable) {
        for (const id of dataRules) block(id, unavailable);
      } else if (!check('E05', fields.length === columns.length, location(lineCount), String(fields.length), '16 campos')) {
        for (const id of recordRules) block(id, 'registro');
        balances.blockFile('registro', { rule: 'E05', line: lineCount });
        monthly?.collector.block();
      } else {
        const beforeValues = findings.length;
        const value = fields[13];
        validValue = check('E06', /^[0-9]+(\.[0-9]+)?$/.test(value), location(lineCount, 14), value,
          'Dígitos ASCII, com ponto decimal opcional seguido de dígitos') || validValue;
        const typeIndex = valueTypes.indexOf(fields[14]);
        check('E07', typeIndex >= 0, location(lineCount, 15), fields[14], valueTypes.join(', '));
        check('E08', natures.includes(fields[15]), location(lineCount, 16), fields[15], natures.join(', '));
        const beforeContent = findings.length;

        const contentBlocked = contentBlock();
        const account = fields[0];
        let permitted: string[] | undefined;
        if (!contentBlocked && catalog) {
          permitted = Object.hasOwn(catalog.accounts, account) ? catalog.combinations[catalog.accounts[account]] : undefined;
          check('C01', Boolean(permitted), location(lineCount, 1), account, 'Conta de 9 dígitos ativa de último nível no leiaute MSC 2026');
        } else {
          for (const id of contentRules) block(id, contentBlocked ?? 'catálogo');
        }
        let po = false;
        const pairs: [string, string][] = [];
        const trustedPairs: [string, string][] = [];
        const repeatedTypes = new Set<string>();
        let uncertainPair = false;
        const slots = new Map<string, number>();
        const repeated: BalanceOrigin[] = [];
        for (let pair = 1; pair <= 6; pair++) {
          const ic = fields[pair * 2 - 1];
          const kind = fields[pair * 2];
          // Alguns exportadores preenchem o TIPO de um par ausente com espaços ASCII.
          if (ic === '' && !/[^ ]/.test(kind)) continue;
          const icAt = location(lineCount, pair * 2);
          const kindAt = location(lineCount, pair * 2 + 1);
          const complete = check('E10', Boolean(ic && kind), ic ? kindAt : icAt, '', ic ? 'TIPO preenchido' : 'IC preenchido');
          po ||= complete && kind === 'PO';
          if (contentBlocked || !catalog) continue;
          if (permitted && complete) {
            const earlier = slots.get(kind);
            if (earlier === undefined) slots.set(kind, pair);
            else {
              repeated.push({ line: lineCount, field: 'TIPO repetido: ' + kind, slots: [earlier, pair] });
              repeatedTypes.add(kind);
            }
            pairs.push([kind, ic]);
          }

          const known = Boolean(kind) && check('C02', Object.hasOwn(catalog.widths, kind), kindAt, kind,
            Object.keys(catalog.widths).join(', '));
          const domainId = Object.hasOwn(domainRules, kind) ? domainRules[kind as keyof typeof domainRules] : undefined;
          if (!complete || !known) {
            uncertainPair = true;
            const reason = complete ? 'tipo' : 'par-incompleto';
            block('C03', reason);
            block('C04', reason);
            if (domainId) block(domainId, reason);
            else if (!kind || !known) for (const id of Object.values(domainRules)) block(id, reason);
            continue;
          }

          const width = catalog.widths[kind];
          const wide = check('C03', ic.length === width && /^[0-9]+$/.test(ic), icAt, ic, width + ' dígitos ASCII para ' + kind);
          const allowed = permitted?.includes(kind) ?? false;
          if (permitted) check('C04', allowed, kindAt, kind, permitted.join(', '));
          else block('C04', 'conta');
          let inDomain = true;
          if (domainId) {
            if (wide) {
              const expected = domainExpectations[kind] ?? catalog.domains[kind].join(', ');
              inDomain = check(domainId, catalog.domains[kind].includes(ic), icAt, ic, expected);
            }
            else block(domainId, 'largura');
          }
          if (monthly && wide && allowed && (inDomain || kind === 'FR' || kind === 'CO')) trustedPairs.push([kind, ic]);
        }
        if (!contentBlocked) check('C05', po, location(lineCount), 'Nenhum par IC/PO completo', 'Pelo menos um par IC/PO completo');
        if (account) {
          for (let index = beforeValues; index < findings.length; index++) findings[index].accountCode = account;
        }
        if (!contentBlocked) {
          const contentFindings = findings.slice(beforeContent);
          if (!permitted) balances.blockFile('conta', { rule: 'C01', line: lineCount, field: 'CONTA' });
          else balances.record(lineCount, account, pairs, contentFindings.map(balanceOrigin).concat(repeated),
            value, typeIndex, fields[15], findings.slice(beforeValues, beforeContent).map(balanceOrigin));
          if (monthly) {
            // The historical API comparison retains the original structural criteria for FR and CO.
            const complete = Boolean(permitted) && contentFindings.every(finding => finding.id === 'C09' || finding.id === 'C10') &&
              repeated.length === 0;
            const dimensions = complete ? pairs : uncertainPair ? [] : trustedPairs.filter(([kind]) => !repeatedTypes.has(kind));
            monthly.collector.record({ account: permitted ? account : undefined, dimensions, complete },
              fields[14], value, fields[15], beforeValues === beforeContent);
          }
        }
      }
    }
    if (line.endByte - lastProgressByte >= 262144) {
      lastProgressByte = line.endByte;
      onProgress?.({ bytesRead: line.endByte, totalBytes: bytes.length, records, phase: 'leitura e análise' });
    }
  }

  if (!readFault) {
    check('L01', true, {}, 'UTF-8', 'UTF-8');
    check('E01', true, {}, '', 'CSV com delimitador ponto e vírgula');
  }
  if (lineCount === 0) {
    if (readFault) block('L02', 'leitura-incompleta');
    else check('L02', false, location(1), 'Linha ausente', 'Linha de metadados');
    block('E02', 'metadados');
    block('E04', 'metadados');
  }
  if (lineCount < 2) {
    if (readFault) block('E03', 'leitura-incompleta');
    else check('E03', false, location(2), 'Linha ausente', columns.join(';'));
  }
  if (readFault || (!records && (!metadataValid || !headerValid))) {
    const reason = readFault ? 'leitura-incompleta' : !metadataValid ? 'metadados' : 'guia';
    for (const id of dataRules) block(id, reason);
  } else if (!records) {
    const reason = contentBlock();
    if (reason) for (const id of contentRules) block(id, reason);
  }

  if (validValue) check('E09', true, {}, '', 'Pelo menos um registro válido quanto ao valor');
  else if (readFault || !metadataValid || !headerValid) {
    block('E09', readFault ? 'leitura-incompleta' : !metadataValid ? 'metadados' : 'guia');
  } else check('E09', false, {}, 'Nenhum valor decimal válido em registro com 16 campos', 'Pelo menos um valor válido no arquivo');

  const fileBlock = readFault ? { reason: 'leitura-incompleta', id: readFault === 'bytes' ? 'L01' : 'E01' } as const :
    !metadataValid ? { reason: 'metadados', id: 'L02' } as const :
    !headerValid ? { reason: 'guia', id: 'E03' } as const : null;
  const contentReason = contentBlock();
  if (fileBlock || contentReason || !records) {
    const reason = fileBlock?.reason ?? contentReason ?? 'sem-registros';
    const id = fileBlock?.id ?? (reason === 'competência' ? 'E04' : reason === 'sem-registros' ? 'E09' : 'E02');
    const origin = findings.find(item => item.id === id);
    balances.blockFile(reason, origin ? balanceOrigin(origin) : { rule: id }, true);
    monthly?.collector.block();
  }
  const balanceResults = balances.finish();
  for (const group of balanceResults.groups) {
    if (group.state === 'Bloqueada') {
      const reasons = new Set(group.blocks.map(item => item.reason));
      counts[group.id].blocked++;
      for (const reason of reasons) counts[group.id].reasons[reason] = (counts[group.id].reasons[reason] ?? 0) + 1;
    } else if (group.state === 'Conforme') counts[group.id].passed++;
    else if (group.state === 'Falhou') counts[group.id].failed++;
  }

  const results = Object.fromEntries(ruleIds.map(id => {
    const tally = counts[id];
    const state: RuleState = tally.failed ? 'Falhou' : tally.blocked ? 'Bloqueada' : tally.passed ? 'Conforme' : 'Não aplicável';
    return [id, { ...tally, state }];
  })) as ValidationResult['rules'];

  const summary = ruleIds.some(id => results[id].state === 'Falhou') ? 'Pendências nas verificações do MVP 1.1' :
    ruleIds.some(id => results[id].state === 'Bloqueada') ? 'Verificação incompleta' :
      'Sem pendências nas verificações executadas do MVP 1.1';
  return {
    catalogCompatible: Boolean(catalog), catalogVersion, institution, institutionName,
    institutionStatus, period, periodKind, records, findings, rules: results, summary, balances: balanceResults,
    monthlyBalances: monthly?.collector.finish(monthly.competence) ?? null,
  };
}
