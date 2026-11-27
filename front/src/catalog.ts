import { sha256 } from './sha256.ts';

export const columns = [
  'CONTA', 'IC1', 'TIPO1', 'IC2', 'TIPO2', 'IC3', 'TIPO3', 'IC4', 'TIPO4',
  'IC5', 'TIPO5', 'IC6', 'TIPO6', 'Valor', 'Tipo_valor', 'Natureza_valor',
] as const;

export const rules = {
  L01: ['Codificação', 'T (política local)'],
  E01: ['Sintaxe CSV', 'V p. 3(e); T'],
  L02: ['Estrutura dos metadados', 'I p. 5; II Leiaute MSC!A3:P3; T linha 1'],
  E02: ['Instituição transmissora', 'V p. 2(a); I p. 5; S (317 páginas, exemplo p. 219)'],
  E03: ['Linha-guia', 'I p. 5; V p. 3(c–d); II Leiaute MSC!A4:P4; T linha 2'],
  E04: ['Competência', 'I p. 5; V p. 2(b); II Leiaute MSC!B3; T linha 1'],
  E05: ['Quantidade de campos', 'I p. 5; V p. 3(c); II Leiaute MSC!A4:P4'],
  E06: ['Formato do valor', 'V p. 4(g), 6(g); I p. 12; II Observações!A5'],
  E07: ['Tipo do valor', 'V p. 4(h); I p. 12; II Observações!A6:A9'],
  E08: ['Natureza do valor', 'V p. 4(i); I p. 13; II Observações!A10'],
  E09: ['Presença de valor', 'V p. 6(h); política local para zero'],
  E10: ['Preenchimento de pares IC/TIPO', 'V p. 4(j); I p. 5'],
  C01: ['Conta contábil elegível', 'V p. 4(a); I p. 6; II Leiaute MSC!A5:A6123 e PcaspEstendido2026!H/L/M'],
  C02: ['Tipo de IC conhecido', 'V p. 5(b); I p. 11–12; II Informações Complementares!B6:B14'],
  C03: ['Largura e composição do IC', 'V p. 5(b); I p. 11–12; II Informações Complementares!B6:E14'],
  C04: ['Associação do tipo de IC à conta', 'V p. 5(c); I p. 7; II Leiaute MSC!C5:M6123, PcaspEstendido2026!O:P e Conjunto de IC!A4:F12'],
  C05: ['Presença de PO', 'V p. 5(d); I p. 7'],
  C06: ['Domínio FP', 'I p. 8 e 11; II Informações Complementares!B7:F7'],
  C07: ['Domínio DC', 'I p. 8 e 11; II Informações Complementares!B8:F8'],
  C08: ['Domínio PO', 'V p. 5(b); I p. 7 e 11; II PO!A6:B97'],
  C09: ['Domínio FR municipal', 'I p. 8 e 11; II FR 2026!A7:B9 e A12:B121'],
  C10: ['Domínio CO', 'I p. 8 e 11; II CO 2026!A7:A68'],
  C11: ['Domínio NR', 'I p. 9 e 11; II NR 2026!H6:K5457, desdobramentos em J5457'],
  C13: ['Domínio FS', 'I p. 10 e 11; II FS!A3:B123; MCASP 11ª ed., p. 74, § 4.2.2.2'],
} as const;

export const advisoryRules = {
  C12: ['Conferência da codificação de ND', 'II ND 2026!A3 e F8:F1242'],
  C13: ['Conferência do cruzamento de FS', 'II FS!A115:B123; MCASP 11ª ed., p. 74, § 4.2.2.2'],
  C14: ['Conferência do ano de inscrição de restos a pagar', 'I p. 11–12; II Informações Complementares!B14:F14'],
} as const;

export const widths = { PO: 5, FP: 1, DC: 1, FR: 4, CO: 4, NR: 8, ND: 8, FS: 5, AI: 4 };
export const valueTypes = ['beginning_balance', 'period_change', 'ending_balance'];
export const natures = ['D', 'C'];
const approvedVersion = '2026-f05e9a2685d59fd10351b0a7270661241eec5a652e3cba19003393e1581e9443';

export interface Catalog {
  version: string;
  year: number;
  rulesVersion: string;
  sources: Record<string, { path: string; edition: string; region: string; sha256: string }>;
  header: string[];
  widths: Record<string, number>;
  domains: Record<string, string[]>;
  combinations: Record<string, string[]>;
  accounts: Record<string, string>;
  valueTypes: string[];
  natures: string[];
  institutions: Record<'municipal' | 'otherExecutive' | 'ineligible', Record<string, string>>;
  extraction: {
    institutionPages: { page: number; municipal: number; otherExecutive: number; ineligible: number }[];
    eligiblePcasp: number;
    institutionAmbiguities: string[];
  };
}

export function compatibleCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Catalog;
  if (
    catalog.version !== approvedVersion || catalog.year !== 2026 ||
    catalog.rulesVersion !== 'ARQ-MVP-001-ACEITE+E02+C09–C14' ||
    !['I', 'II', 'V', 'T', 'S'].every(key => {
      const source = catalog.sources?.[key];
      return source?.path && source.edition && source.region && /^[a-f0-9]{64}$/.test(source.sha256);
    }) ||
    !sameList(catalog.header, columns) ||
    !sameList(catalog.valueTypes, valueTypes, true) || !sameList(catalog.natures, natures) ||
    !catalog.widths || Object.keys(catalog.widths).length !== Object.keys(widths).length ||
    !Object.entries(widths).every(([kind, width]) => catalog.widths[kind] === width) ||
    !sameList(catalog.domains?.['FP'], ['1', '2']) || !sameList(catalog.domains?.['DC'], ['1']) ||
    !catalog.domains || Object.keys(catalog.domains).length !== 10 ||
    !validList(catalog.domains['PO'], 92, code => /^[0-9]{5}$/.test(code)) ||
    !validList(catalog.domains['FR'], 294, code => /^[129][5-9][0-9]{2}$/.test(code)) ||
    !validList(catalog.domains['CO'], 52, code => /^[0-9]{4}$/.test(code)) ||
    !validList(catalog.domains['NR'], 4504, code => /^[0-9]{8}$/.test(code)) ||
    !validList(catalog.domains['NRNonValued'], 948, code => /^[0-9]{8}$/.test(code)) ||
    !validList(catalog.domains['ND'], 1235, code => /^[0-9]{8}$/.test(code)) ||
    !validList(catalog.domains['FSFunction'], 29, code => /^[0-9]{2}$/.test(code)) ||
    !validList(catalog.domains['FSSubfunction'], 117, code => /^[0-9]{3}$/.test(code))
  ) return false;

  if (!catalog.combinations || Object.keys(catalog.combinations).length !== 9 ||
    !Object.entries(catalog.combinations).every(([key, kinds]) =>
      /^[1-9]$/.test(key) && validList(kinds, undefined, kind => Object.hasOwn(widths, kind)) && kinds.includes('PO')
    ) ||
    !catalog.accounts || Object.keys(catalog.accounts).length !== 6119 ||
    !Object.entries(catalog.accounts).every(([code, set]) => /^[0-9]{9}$/.test(code) && Object.hasOwn(catalog.combinations, set))
  ) return false;

  const groups = catalog.institutions;
  const pages = catalog.extraction?.institutionPages;
  if (!groups || !Array.isArray(pages) || pages.length !== 317 ||
    catalog.extraction.eligiblePcasp < 6119 || !sameList(catalog.extraction.institutionAmbiguities, [])
  ) return false;

  const seen = new Set<string>();
  for (const group of ['municipal', 'otherExecutive', 'ineligible'] as const) {
    const entries = groups[group];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return false;
    const count = pages.reduce((total, page, index) =>
      page?.page === index + 1 && Number.isSafeInteger(page[group]) && page[group] >= 0 ? total + page[group] : NaN, 0);
    if (!count || count !== Object.keys(entries).length) return false;
    for (const [code, name] of Object.entries(entries)) {
      const valid = group === 'municipal'
        ? /^[0-9]{7}EX$/.test(code) && /^Prefeitura Municipal .+ - [A-Z]{2}$/.test(name)
        : group === 'otherExecutive'
          ? /^[0-9]{1,2}EX$/.test(code) && /^Governo (Federal|do Estado |do Distrito Federal)/.test(name)
          : /^[0-9]+[A-Z][A-Z0-9]*$/.test(code) && !code.endsWith('EX');
      if (seen.has(code) || typeof name !== 'string' || !name || !valid) return false;
      seen.add(code);
    }
  }
  const { version, ...payload } = catalog;
  try {
    const digest = sha256(new TextEncoder().encode(canonicalJson(payload)));
    return version === '2026-' + digest;
  } catch {
    return false;
  }
}

// Matches the extractor's compact, key-sorted UTF-8 JSON for the catalog's JSON types.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  throw new TypeError('Valor incompatível com o JSON do catálogo');
}

function sameList(value: unknown, expected: readonly string[], unordered = false): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const actual = unordered ? [...value].sort() : value;
  const reference = unordered ? [...expected].sort() : expected;
  return reference.every((item, index) => item === actual[index]);
}

function validList(value: unknown, length: number | undefined, valid: (item: string) => boolean): value is string[] {
  return Array.isArray(value) && value.length > 0 && (length === undefined || value.length === length) &&
    new Set(value).size === value.length && value.every(item => typeof item === 'string' && valid(item));
}
