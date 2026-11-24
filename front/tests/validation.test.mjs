import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import catalog from '../src/catalog-2026.json' with { type: 'json' };
import { compatibleCatalog, columns } from '../src/catalog.ts';
import { parseRecord } from '../src/csv.ts';
import { sha256 } from '../src/sha256.ts';
import { validate, validationRules as rules } from '../src/validation.ts';

const makeRow = (fields = {}) => {
  const defaults = ['111110100', '10131', 'PO', ...Array(10).fill(''), '0.00', 'ending_balance', 'D'];
  return defaults.map((value, i) => fields[i + 1] ?? value).join(';');
};
const header = columns.join(';');
const meta = '3550308EX;2026-01';
const file = (row = makeRow(), { first = meta, second = header, newline = '\n', trailing = false } = {}) =>
  [first, second, ...(Array.isArray(row) ? row : [row])].join(newline) + (trailing ? newline : '');
const evaluate = (text, selectedCatalog = catalog) => validate(Buffer.from(text), 'UTF-8', selectedCatalog);
const good = 'Sem pendências nas verificações executadas do MVP 1.1';
const bad = 'Pendências nas verificações do MVP 1.1';

function checkFinding(result, id, line, fieldIndex, observed) {
  assert.equal(result.rules[id].state, 'Falhou');
  const found = result.findings.find(item => item.id === id);
  assert.ok(found);
  assert.equal(found.line, line);
  assert.equal(found.fieldIndex, fieldIndex);
  if (observed !== undefined) assert.equal(found.observed, observed);
  if (line >= 3 && fieldIndex >= 2 && fieldIndex <= 13) assert.equal(found.pair, Math.floor(fieldIndex / 2));
  assert.ok(found.expected);
  assert.equal(result.summary, bad);
}

test('arquivo mensal canônico é determinístico e preserva regras sem candidato', () => {
  const result = evaluate(file());
  assert.equal(result.summary, good);
  assert.equal(result.institutionName, 'Prefeitura Municipal de São Paulo - SP');
  assert.equal(result.periodKind, 'Mensal');
  assert.equal(result.records, 1);
  assert.equal(result.encoding, 'UTF-8');
  assert.deepEqual(result, evaluate(file()));
  assert.deepEqual(Object.keys(result.rules), Object.keys(rules));
  for (const id of Object.keys(rules)) {
    assert.equal(result.rules[id].state, ['C06', 'C07'].includes(id) ? 'Não aplicável' : 'Conforme', id);
  }
});

test('L01: template original, offset e codificações explícitas', () => {
  const template = readFileSync(new URL('../../references/msc/2026/2026_Template_MSC_15012026.csv', import.meta.url));
  const utf8 = validate(template, 'UTF-8', catalog);
  checkFinding(utf8, 'L01', 1, undefined);
  assert.ok(Number.isInteger(utf8.findings[0].byteOffset));
  assert.equal(utf8.rules.E03.state, 'Bloqueada');
  const cp = validate(template, 'Windows-1252', catalog);
  assert.equal(cp.rules.L01.state, 'Conforme');
  assert.equal(cp.rules.E03.state, 'Conforme');
  assert.equal(cp.encoding, 'Windows-1252');
  assert.equal(cp.records, 6119);
  assert.equal(cp.summary, bad);
  assert.equal(cp.rules.E02.state, 'Falhou');
  assert.equal(cp.rules.E09.state, 'Falhou');
  assert.equal(validate(Buffer.from(file()), 'Windows-1252', catalog).summary, good);
});

test('L01: BOM, bytes sem mapeamento, NUL e UTF-8 malformado', () => {
  assert.equal(evaluate('\ufeff' + file()).summary, good);
  checkFinding(evaluate('\ufeff\ufeff' + file()), 'E02', 1, 1);
  for (const bytes of [[0x81], [0x8d], [0x8f], [0x90], [0x9d], [0], [0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff]]) {
    const cp = validate(Uint8Array.from(bytes), 'Windows-1252', catalog);
    checkFinding(cp, 'L01', 1, undefined);
    assert.equal(cp.findings[0].byteOffset, 0);
  }
  for (const bytes of [[0], [0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x90]]) {
    checkFinding(validate(Uint8Array.from(bytes), 'UTF-8', catalog), 'L01', 1, undefined);
  }
  const secondByte = Buffer.concat([Buffer.from(file() + '\n'), Buffer.from([0x80])]);
  const prefix = validate(secondByte, 'UTF-8', catalog);
  checkFinding(prefix, 'L01', 4, undefined, '0x80');
  assert.equal(prefix.findings[0].byteOffset, secondByte.length - 1);
  assert.equal(prefix.rules.E09.state, 'Conforme');
});

test('E01: aspas, preservação de campos, controles e quebras físicas', () => {
  assert.deepEqual(parseRecord(' A ;"b;c";"d""e";"";'), { fields: [' A ', 'b;c', 'd"e', '', ''] });
  for (const newline of ['\n', '\r\n']) {
    for (const trailing of [false, true]) {
      const result = evaluate(file(makeRow({ 14: '"12.34"' }), { newline, trailing }));
      assert.equal(result.rules.E01.state, 'Conforme');
      assert.equal(result.rules.E06.state, 'Conforme');
    }
  }
  for (const field of ['"12.34', '1"2', '"12"x', '"12\n34"', '"12\r\n34"', '1\t2', '1\r2', '1\x7f2']) {
    checkFinding(evaluate(file(makeRow({ 14: field }))), 'E01', 3, 14);
  }
  const prefix = evaluate(file([makeRow({ 16: 'd' }), makeRow({ 14: '"12' })]));
  checkFinding(prefix, 'E08', 3, 16, 'd');
  assert.equal(prefix.rules.E06.state, 'Bloqueada');
  assert.equal(prefix.rules.E09.state, 'Conforme');
  assert.equal(evaluate(file([makeRow({ 14: '-1' }), makeRow({ 14: '"12' })])).rules.E09.state, 'Bloqueada');
  assert.equal(evaluate(file([makeRow({ 14: '"12' }), makeRow()])).rules.E09.state, 'Bloqueada');
});

test('L02/E03: formas de metadados, guia literal de 16 campos e dependências', () => {
  assert.equal(evaluate(file(makeRow(), { first: meta + ';'.repeat(14) })).summary, good);
  const metadata = evaluate(file(makeRow(), { first: meta + ';X' }));
  checkFinding(metadata, 'L02', 1, 3, 'X');
  assert.equal(metadata.rules.E05.state, 'Bloqueada');
  assert.equal(metadata.rules.E02.state, 'Bloqueada');
  const guide18 = columns.slice(0, 13).concat(['IC7', 'TIPO7'], columns.slice(13)).join(';');
  checkFinding(evaluate(file(makeRow(), { second: guide18 })), 'E03', 2, 14, 'IC7');
  checkFinding(evaluate(file(makeRow(), { second: columns.join(',') })), 'E03', 2, 1);
  checkFinding(evaluate(meta), 'E03', 2, undefined);
  assert.equal(evaluate(file(makeRow(), { second: columns.map(s => '"' + s + '"').join(';') })).summary, good);
  checkFinding(evaluate(file(header)), 'C01', 3, 1, 'CONTA');
});

test('E02: conhecida municipal, inelegível, outra esfera e cadastro inconclusivo', () => {
  for (const code of ['3550308LG', '3550308TM', '1SF', '3550308ex', '3550308 EX', '']) {
    checkFinding(evaluate(file(makeRow(), { first: code + ';2026-01' })), 'E02', 1, 1, code);
  }
  for (const [code, reason] of [['1EX', 'outra-esfera'], ['35EX', 'outra-esfera'], ['53EX', 'outra-esfera'], ['3550309EX', 'cadastro-inconclusivo']]) {
    const result = evaluate(file(makeRow(), { first: code + ';2026-01' }));
    assert.equal(result.institutionStatus, reason);
    assert.equal(result.rules.E02.state, 'Bloqueada');
    assert.equal(result.findings[0].reason, reason);
    assert.equal(result.findings[0].fieldIndex, 1);
    assert.equal(result.findings[0].observed, code);
    assert.equal(result.rules.E06.state, 'Conforme');
    for (const id of Object.keys(rules).filter(id => id.startsWith('C'))) assert.equal(result.rules[id].state, 'Bloqueada');
    assert.equal(result.summary, 'Verificação incompleta');
  }
});

test('E04: meses de fronteira e encerramento', () => {
  for (const [period, kind] of [['2026-01', 'Mensal'], ['2026-12', 'Mensal'], ['2026-13', 'Encerramento']]) {
    const result = evaluate(file(makeRow(), { first: '3550308EX;' + period }));
    assert.equal(result.periodKind, kind);
    assert.equal(result.summary, good);
  }
  for (const period of ['202613', '2026-00', '2026-14', '2025-12', '202601', '2026-01 ', '']) {
    checkFinding(evaluate(file(makeRow(), { first: '3550308EX;' + period })), 'E04', 1, 2, period);
  }
});

test('E05/E09: registro curto, linha em branco adicional, presença de valor e recuperação', () => {
  const short = makeRow().split(';').slice(0, -1).join(';');
  const result = evaluate(file([short, makeRow()]));
  checkFinding(result, 'E05', 3, undefined, '15');
  assert.equal(result.rules.E06.passed, 1);
  assert.equal(result.rules.E06.blocked, 1);
  assert.equal(result.rules.E09.state, 'Conforme');
  checkFinding(evaluate(file(makeRow()) + '\n\n'), 'E05', 4, undefined);
  checkFinding(evaluate(file([])), 'E09', undefined, undefined);
  checkFinding(evaluate(file(short)), 'E09', undefined, undefined);
  assert.equal(evaluate(file(makeRow({ 14: '0' }))).rules.E09.state, 'Conforme');
});

test('E06/E07/E08: magnitude em texto, domínios literais e campos exigidos para zero', () => {
  for (const value of ['0', '0.00', '0001.000', '0000000000000000000000000000000000001.00000000000000000000000']) {
    assert.equal(evaluate(file(makeRow({ 14: value }))).rules.E06.state, 'Conforme');
  }
  for (const value of ['-0.00', '+1', '-0', '.', '.5', '1.', '1e3', '1,23', '1.000,50', ' 12.34', '', '１２.３４']) {
    checkFinding(evaluate(file(makeRow({ 14: value }))), 'E06', 3, 14, value);
  }
  for (const type of ['beginning_balance', 'period_change', 'ending_balance']) {
    assert.equal(evaluate(file(makeRow({ 15: type, 16: 'C' }))).summary, good);
  }
  for (const type of ['Period_Change', '']) checkFinding(evaluate(file(makeRow({ 14: '0', 15: type }))), 'E07', 3, 15, type);
  for (const nature of ['d', '']) checkFinding(evaluate(file(makeRow({ 14: '0', 16: nature }))), 'E08', 3, 16, nature);
});

test('relaciona falhas de registro à conta literal sem atribuir conta a erros gerais ou truncados', () => {
  const result = evaluate(file([
    makeRow({ 6: '*ERRO*', 7: 'FR' }),
    makeRow({ 1: '001234567', 14: 'inválido' }),
    '111110200;',
  ]));
  const fr = result.findings.find(item => item.id === 'C03');
  assert.equal(fr.accountCode, '111110100');
  assert.equal(fr.fieldName, 'IC3');
  assert.equal(fr.observed, '*ERRO*');
  assert.equal(result.findings.find(item => item.id === 'E06').accountCode, '001234567');
  assert.equal(result.findings.find(item => item.id === 'C01').accountCode, '001234567');
  assert.equal(result.findings.find(item => item.id === 'E05').accountCode, undefined);
  assert.equal(evaluate(file(makeRow(), { first: '3550308EX;2026-00' }))
    .findings.find(item => item.id === 'E04').accountCode, undefined);
});

test('E10/C02: espaços ASCII no TIPO só são ignorados quando o IC está vazio', () => {
  const absent = evaluate(file(makeRow({ 11: ' ', 13: '"  "' })));
  assert.equal(absent.summary, good);
  assert.deepEqual(absent.findings, []);

  const presentIc = evaluate(file(makeRow({ 10: '1234', 11: ' ' })));
  checkFinding(presentIc, 'C02', 3, 11, ' ');
  assert.equal(presentIc.rules['SAL-CONS-01'].state, 'Bloqueada');

  const nonAscii = evaluate(file(makeRow({ 11: '\u00a0' })));
  checkFinding(nonAscii, 'E10', 3, 10, '');
  checkFinding(nonAscii, 'C02', 3, 11, '\u00a0');
});

test('E10/C02/C03/C04/C05: pares em posições livres e dependências locais', () => {
  for (let pair = 1; pair <= 6; pair++) {
    const result = evaluate(file(makeRow({ 2: '', 3: '', [pair * 2]: '10131', [pair * 2 + 1]: 'PO' })));
    assert.equal(result.summary, good, String(pair));
  }
  const missingType = evaluate(file(makeRow({ 3: '' })));
  checkFinding(missingType, 'E10', 3, 3, '');
  assert.equal(missingType.rules.C03.state, 'Bloqueada');
  assert.equal(missingType.rules.C04.state, 'Bloqueada');
  const missingIc = evaluate(file(makeRow({ 2: '""' })));
  checkFinding(missingIc, 'E10', 3, 2, '');
  assert.equal(missingIc.rules.C02.state, 'Conforme');
  assert.equal(missingIc.rules.C08.state, 'Bloqueada');
  checkFinding(evaluate(file(makeRow({ 3: 'XX' }))), 'C02', 3, 3, 'XX');
  const width = evaluate(file(makeRow({ 2: '0131' })));
  checkFinding(width, 'C03', 3, 2, '0131');
  assert.equal(width.rules.C04.state, 'Conforme');
  assert.equal(width.rules.C05.state, 'Conforme');
  assert.equal(width.rules.C08.state, 'Bloqueada');
  checkFinding(evaluate(file(makeRow({ 4: '12345678', 5: 'NR' }))), 'C04', 3, 5, 'NR');
  checkFinding(evaluate(file(makeRow({ 2: '', 3: '' }))), 'C05', 3, undefined);
  assert.equal(evaluate(file(makeRow({ 4: '0123', 5: 'FR' }))).summary, good);
});

test('C01/C06/C07/C08: plano de contas, domínios ativos e casos adiados', () => {
  const superior = evaluate(file(makeRow({ 1: '111110000' })));
  checkFinding(superior, 'C01', 3, 1, '111110000');
  assert.equal(superior.rules.C04.state, 'Bloqueada');
  assert.equal(superior.rules.C03.state, 'Conforme');
  assert.equal(superior.rules.C08.state, 'Conforme');
  assert.equal(evaluate(file(makeRow({ 4: '1', 5: 'FP' }))).rules.C06.state, 'Conforme');
  checkFinding(evaluate(file(makeRow({ 4: '3', 5: 'FP' }))), 'C06', 3, 4, '3');
  assert.equal(evaluate(file(makeRow({ 1: '211410102', 4: '1', 5: 'DC' }))).rules.C07.state, 'Conforme');
  checkFinding(evaluate(file(makeRow({ 1: '211410102', 4: '2', 5: 'DC' }))), 'C07', 3, 4, '2');
  for (const po of ['10131', '20231', '10111']) assert.equal(evaluate(file(makeRow({ 2: po }))).rules.C08.state, 'Conforme');
  checkFinding(evaluate(file(makeRow({ 2: '99999' }))), 'C08', 3, 2, '99999');
  assert.equal(evaluate(file(makeRow({ 4: '9999', 5: 'FR' }))).summary, good);
  const resultAccount = Object.keys(catalog.accounts).find(code => /^[34]/.test(code));
  assert.ok(resultAccount);
  assert.equal(evaluate(file(makeRow({ 1: resultAccount }), { first: '3550308EX;2026-13' })).summary, good);
});

test('catálogo incompatível bloqueia dependências e mantém as estruturais', () => {
  assert.equal(compatibleCatalog(catalog), true);
  for (const mutation of [
    { ...catalog, year: 2025 },
    { ...catalog, domains: { ...catalog.domains, FP: [] } },
    { ...catalog, accounts: { ...catalog.accounts, 111110100: '99' } },
    { ...catalog, institutions: { ...catalog.institutions, municipal: {} } },
    null,
  ]) {
    const result = evaluate(file(), mutation);
    assert.equal(result.catalogCompatible, false);
    assert.equal(result.rules.E02.state, 'Bloqueada');
    assert.equal(result.rules.C01.state, 'Bloqueada');
    assert.equal(result.rules.E06.state, 'Conforme');
    assert.equal(result.summary, 'Verificação incompleta');
  }
});

test('SHA256 síncrono coincide com o Node ao redor dos limites de bloco', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 129]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256);
    assert.equal(sha256(bytes), createHash('sha256').update(bytes).digest('hex'), String(length));
  }
});

test('editar um domínio sem atualizar a versão invalida o catálogo e impede conclusão', () => {
  const modified = structuredClone(catalog);
  modified.domains.PO[0] = '99999';
  assert.equal(modified.version, catalog.version);
  assert.equal(compatibleCatalog(modified), false);

  const csv = file(makeRow({ 2: '99999' }));
  const rejected = evaluate(csv, modified);
  assert.equal(rejected.rules.E06.state, 'Conforme');
  assert.equal(rejected.rules.C08.state, 'Bloqueada');
  assert.equal(rejected.summary, 'Verificação incompleta');
  checkFinding(evaluate(csv), 'C08', 3, 2, '99999');
});
