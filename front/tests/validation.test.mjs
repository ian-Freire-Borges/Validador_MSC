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
const balancedFile = (row = makeRow(), options) => file([row, ...['D', 'C'].map(side =>
  makeRow({ 1: '111110200', 14: '1', 15: 'period_change', 16: side }))], options);
const evaluate = (text, selectedCatalog = catalog) => validate(Buffer.from(text), selectedCatalog);
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
  const result = evaluate(balancedFile());
  assert.equal(result.summary, good);
  assert.equal(result.institutionName, 'Prefeitura Municipal de São Paulo - SP');
  assert.equal(result.periodKind, 'Mensal');
  assert.equal(result.records, 3);
  assert.deepEqual(result, evaluate(balancedFile()));
  assert.deepEqual(Object.keys(result.rules), Object.keys(rules));
  for (const id of Object.keys(rules)) {
    assert.equal(result.rules[id].state, ['C06', 'C07', 'C09', 'C10', 'C11', 'C13'].includes(id) ? 'Não aplicável' : 'Conforme', id);
  }
});

test('L01: template original com byte incompatível com UTF-8', () => {
  const template = readFileSync(new URL('../../references/msc/2026/2026_Template_MSC_15012026.csv', import.meta.url));
  const utf8 = validate(template, catalog);
  checkFinding(utf8, 'L01', 1, undefined);
  assert.ok(Number.isInteger(utf8.findings[0].byteOffset));
  assert.equal(utf8.rules.E03.state, 'Bloqueada');
  assert.match(utf8.findings[0].expected, /Reexporte o CSV em UTF-8/);
});

test('L01: BOM UTF-8, BOM incompatível, NUL e UTF-8 malformado', () => {
  assert.equal(evaluate('\ufeff' + balancedFile()).summary, good);
  checkFinding(evaluate('\ufeff\ufeff' + file()), 'E02', 1, 1);
  for (const bytes of [[0x80], [0xff, 0xfe], [0xfe, 0xff], [0]]) {
    const result = validate(Uint8Array.from(bytes), catalog);
    checkFinding(result, 'L01', 1, undefined);
    assert.equal(result.findings[0].byteOffset, 0);
  }
  for (const bytes of [[0], [0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x90]]) {
    checkFinding(validate(Uint8Array.from(bytes), catalog), 'L01', 1, undefined);
  }
  const secondByte = Buffer.concat([Buffer.from(file() + '\n'), Buffer.from([0x80])]);
  const prefix = validate(secondByte, catalog);
  checkFinding(prefix, 'L01', 4, undefined, '0x80');
  assert.equal(prefix.findings[0].byteOffset, secondByte.length - 1);
  assert.equal(prefix.rules.E09.state, 'Bloqueada');
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
  assert.equal(prefix.rules.E09.state, 'Bloqueada');
  assert.equal(evaluate(file([makeRow({ 14: '-1' }), makeRow({ 14: '"12' })])).rules.E09.state, 'Bloqueada');
  assert.equal(evaluate(file([makeRow({ 14: '"12' }), makeRow()])).rules.E09.state, 'Bloqueada');
});

test('L02/E03: formas de metadados, guia literal de 16 campos e dependências', () => {
  assert.equal(evaluate(balancedFile(makeRow(), { first: meta + ';'.repeat(14) })).summary, good);
  const metadata = evaluate(file(makeRow(), { first: meta + ';X' }));
  checkFinding(metadata, 'L02', 1, 3, 'X');
  assert.equal(metadata.rules.E05.state, 'Bloqueada');
  assert.equal(metadata.rules.E02.state, 'Bloqueada');
  const guide18 = columns.slice(0, 13).concat(['IC7', 'TIPO7'], columns.slice(13)).join(';');
  checkFinding(evaluate(file(makeRow(), { second: guide18 })), 'E03', 2, 14, 'IC7');
  checkFinding(evaluate(file(makeRow(), { second: columns.join(',') })), 'E03', 2, 1);
  checkFinding(evaluate(meta), 'E03', 2, undefined);
  assert.equal(evaluate(balancedFile(makeRow(), { second: columns.map(s => '"' + s + '"').join(';') })).summary, good);
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
    const result = evaluate(balancedFile(makeRow(), { first: '3550308EX;' + period }));
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
  assert.equal(result.rules.E09.state, 'Bloqueada');
  checkFinding(evaluate(file(makeRow()) + '\n\n'), 'E05', 4, undefined);
  checkFinding(evaluate(file([])), 'E09', undefined, undefined);
  checkFinding(evaluate(file(short)), 'E09', undefined, undefined);
  checkFinding(evaluate(file(makeRow({ 14: '0' }))), 'E09', undefined, undefined, 'Todos os valores dos registros são zero');
});

test('E06/E07/E08: magnitude em texto, domínios literais e campos exigidos para zero', () => {
  for (const value of ['0', '0.00', '0001.000', '0000000000000000000000000000000000001.00000000000000000000000']) {
    assert.equal(evaluate(file(makeRow({ 14: value }))).rules.E06.state, 'Conforme');
  }
  for (const value of ['-0.00', '+1', '-0', '.', '.5', '1.', '1e3', '1,23', '1.000,50', ' 12.34', '', '１２.３４']) {
    checkFinding(evaluate(file(makeRow({ 14: value }))), 'E06', 3, 14, value);
  }
  for (const type of ['beginning_balance', 'period_change', 'ending_balance']) {
    assert.equal(evaluate(balancedFile(makeRow({ 15: type, 16: 'C' }))).summary, good);
  }
  for (const type of ['Period_Change', '']) checkFinding(evaluate(file(makeRow({ 14: '0', 15: type }))), 'E07', 3, 15, type);
  for (const nature of ['d', '']) checkFinding(evaluate(file(makeRow({ 14: '0', 16: nature }))), 'E08', 3, 16, nature);
});

test('E09 rejeita MSC mensal integralmente zerada quando é possível verificar todos os valores', () => {
  const zeros = ['0', '00.0000', '000'].map(value => makeRow({ 14: value }));
  const rejected = evaluate(file(zeros));
  checkFinding(rejected, 'E09', undefined, undefined, 'Todos os valores dos registros são zero');
  assert.equal(rejected.findings.filter(finding => finding.status === 'Falhou').length, 1);

  const tiny = '0.' + '0'.repeat(330) + '1';
  const balanced = evaluate(file([...zeros, ...['D', 'C'].map(side => makeRow({ 14: tiny, 15: 'period_change', 16: side }))]));
  assert.equal(balanced.rules.E09.state, 'Conforme');
  assert.equal(balanced.summary, good);

  for (const row of ['111110100;', makeRow({ 14: 'inválido' }), makeRow({ 15: 'inválido' }), makeRow({ 16: '' }), makeRow({ 5: 'FP' })]) {
    const uncertain = evaluate(file([...zeros, row]));
    assert.equal(uncertain.rules.E09.state, 'Bloqueada');
    assert.ok(!uncertain.findings.some(finding => finding.id === 'E09'));
  }
  assert.equal(evaluate(file(zeros, { first: '3550308EX;2026-13' })).rules.E09.state, 'Conforme');
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
  const absent = evaluate(balancedFile(makeRow({ 11: ' ', 13: '"  "' })));
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
    const result = evaluate(balancedFile(makeRow({ 2: '', 3: '', [pair * 2]: '10131', [pair * 2 + 1]: 'PO' })));
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
  assert.equal(evaluate(balancedFile(makeRow({ 4: '1500', 5: 'FR' }))).summary, good);
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
  const resultAccount = Object.keys(catalog.accounts).find(code => /^[34]/.test(code));
  assert.ok(resultAccount);
  assert.equal(evaluate(file(makeRow({ 1: resultAccount }), { first: '3550308EX;2026-13' })).summary, good);
});

test('C09 aplica prefixos e códigos principais subnacionais do catálogo FR 2026', () => {
  const funding = (code, fields = {}) => makeRow({ 8: code, 9: 'FR', ...fields });
  for (const code of ['1500', '2500', '9500', '1898', '1899', '1704']) {
    const result = evaluate(balancedFile(funding(code)));
    assert.equal(result.rules.C09.state, 'Conforme', code);
    assert.equal(result.summary, good, code);
  }
  for (const code of ['0500', '3500', '1504', '1999', '1499']) {
    const result = evaluate(file(funding(code)));
    checkFinding(result, 'C09', 3, 8, code);
    const finding = result.findings.find(item => item.id === 'C09');
    assert.equal(finding.accountCode, '111110100');
    assert.equal(finding.fieldName, 'IC4');
    assert.match(finding.expected, /bloco subnacional/);
    assert.equal(result.rules.C03.state, 'Conforme', code);
    assert.equal(result.rules.C04.state, 'Conforme', code);
  }
  const malformed = evaluate(file(funding('*ERRO*')));
  checkFinding(malformed, 'C03', 3, 8, '*ERRO*');
  assert.equal(malformed.rules.C09.state, 'Bloqueada');
  assert.ok(!malformed.findings.some(item => item.id === 'C09'));
  const missing = evaluate(file(funding('')));
  checkFinding(missing, 'E10', 3, 8, '');
  assert.equal(missing.rules.C09.state, 'Bloqueada');
  const accountWithoutFunding = Object.keys(catalog.accounts).find(code => !catalog.combinations[catalog.accounts[code]].includes('FR'));
  assert.ok(accountWithoutFunding);
  const incompatible = evaluate(file(funding('1504', { 1: accountWithoutFunding })));
  checkFinding(incompatible, 'C04', 3, 9, 'FR');
  checkFinding(incompatible, 'C09', 3, 8, '1504');
  const otherScope = evaluate(file(funding('1504'), { first: '35EX;2026-01' }));
  assert.equal(otherScope.rules.C09.state, 'Bloqueada');
  assert.ok(!otherScope.findings.some(item => item.id === 'C09'));
});

test('C10 valida os três blocos de CO 2026 independentemente de E10, C03 e C04', () => {
  const co = (code, fields = {}) => makeRow({ 8: code, 9: 'CO', ...fields });
  for (const code of ['1001', '1070', '3110', '5001']) {
    const result = evaluate(balancedFile(co(code)));
    assert.equal(result.rules.C10.state, 'Conforme', code);
    assert.equal(result.summary, good, code);
  }
  for (const code of ['0000', '0100', '9999']) {
    const result = evaluate(file(co(code)));
    checkFinding(result, 'C10', 3, 8, code);
    assert.equal(result.rules.C03.state, 'Conforme');
    assert.equal(result.rules.C04.state, 'Conforme');
    const finding = result.findings.find(item => item.id === 'C10');
    assert.equal(finding.fieldName, 'IC4');
    assert.equal(finding.accountCode, '111110100');
    assert.match(finding.expected, /aba CO 2026/);
  }
  for (const [code, rule] of [['', 'E10'], ['100', 'C03'], ['１００１', 'C03']]) {
    const result = evaluate(file(co(code)));
    checkFinding(result, rule, 3, 8, code);
    assert.equal(result.rules.C10.state, 'Bloqueada');
    assert.ok(!result.findings.some(item => item.id === 'C10'));
  }
  const accountWithoutCo = Object.keys(catalog.accounts).find(code => !catalog.combinations[catalog.accounts[code]].includes('CO'));
  const incompatible = evaluate(file(co('0000', { 1: accountWithoutCo })));
  checkFinding(incompatible, 'C04', 3, 9, 'CO');
  checkFinding(incompatible, 'C10', 3, 8, '0000');
  const otherScope = evaluate(file(co('0000'), { first: '35EX;2026-01' }));
  assert.equal(otherScope.rules.C10.state, 'Bloqueada');
  assert.ok(!otherScope.findings.some(item => item.id === 'C10'));
});

test('C11 diferencia NR valorizável, não valorizável, ausente e desdobramento 999', () => {
  const nr = code => evaluate(balancedFile(makeRow({ 1: '521110000', 8: code, 9: 'NR' })));
  for (const code of ['11110101', '99900000']) {
    assert.equal(nr(code).rules.C11.state, 'Conforme');
  }
  for (const [code, reason] of [['10000000', /não valorizável/], ['00000000', /não consta/]]) {
    const result = nr(code);
    checkFinding(result, 'C11', 3, 8, code);
    assert.match(result.findings.find(finding => finding.id === 'C11').expected, reason);
  }
  const detail = nr('99900001');
  assert.equal(detail.summary, good);
  assert.equal(detail.rules.C11.state, 'Não aplicável');
  assert.deepEqual(detail.findings, []);
  assert.equal(detail.rules.C11.passed, 0);
  const malformed = nr('1111010');
  checkFinding(malformed, 'C03', 3, 8, '1111010');
  assert.equal(malformed.rules.C11.state, 'Bloqueada');
});

test('C13 rejeita componentes fora do rol e aceita componentes publicados', () => {
  const fs = code => evaluate(balancedFile(makeRow({ 1: '522110100', 8: code, 9: 'FS' })));
  for (const code of ['01061', '04601', '04602', '04603', '04604', '99997', '99999', '28841', '28847',
    '01846', '28301', '10841', '01997', '01999', '99031']) {
    const result = fs(code);
    assert.equal(result.summary, good, code);
    assert.deepEqual(result.findings, [], code);
    assert.equal(result.rules.C13.state, 'Conforme', code);
    assert.equal(result.rules['SAL-CONS-01'].state, 'Conforme');
    assert.equal(result.rules['SAL-EQU-01'].state, 'Conforme');
  }
  for (const code of ['00031', '01000', '99000']) checkFinding(fs(code), 'C13', 3, 8, code);
  checkFinding(fs('1061'), 'C03', 3, 8, '1061');
  assert.equal(fs('1061').rules.C13.state, 'Bloqueada');
});

test('ND e AI mantêm formato e não restringem o domínio ou o ano', () => {
  const nd = code => evaluate(balancedFile(makeRow({ 1: '522110100', 8: code, 9: 'ND' })));
  const ai = code => evaluate(balancedFile(makeRow({ 1: '531100000', 8: code, 9: 'AI' })));
  for (const result of ['31904600', '31904601', '99999999', '00000000'].map(nd)
    .concat(['0000', '0001', '1999', '2026', '2027'].map(ai))) {
    assert.equal(result.summary, good);
    assert.deepEqual(result.findings, []);
    assert.equal(result.rules['SAL-CONS-01'].state, 'Conforme');
  }
  checkFinding(ai('202'), 'C03', 3, 8, '202');
  checkFinding(nd('3.1.90.46.00'), 'C03', 3, 8);
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
