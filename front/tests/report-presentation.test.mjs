import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advisoryBalance, currency, findingTitle, formatCompetence, groupInferredDifferences, validationLabel } from '../src/report-presentation.ts';
import { validationRules } from '../src/validation.ts';

test('formata a competência local sem inferir períodos fora do leiaute', () => {
  assert.equal(formatCompetence('2026-01'), 'janeiro de 2026');
  assert.equal(formatCompetence('2026-10'), 'outubro de 2026');
  assert.equal(formatCompetence('2026-13'), 'Encerramento de 2026');
  for (const invalid of [null, '', '2026-00', '2026-14', '2025-12']) {
    assert.equal(formatCompetence(invalid), 'Não identificada');
  }
});

test('descreve cada regra e exibe valores exatos em reais', () => {
  for (const id of Object.keys(validationRules)) assert.match(findingTitle(id), /\.$/, id);
  assert.equal(currency('−9007199254740993.12345678901'), 'R$ −9007199254740993,12345678901');
});

test('formata saldos de aviso em reais com centavos e natureza contábil', () => {
  assert.equal(advisoryBalance('−9007199254740993.125'), 'R$\u00a09.007.199.254.740.993,13 (C)');
  assert.equal(advisoryBalance('1234'), 'R$\u00a01.234,00 (D)');
  assert.equal(advisoryBalance('0'), 'R$\u00a00,00 (D)');
});

test('agrupa centenas de dígitos e arredonda centavos sem perder precisão', () => {
  const magnitude = '9'.repeat(310);
  const grouped = '9' + '.999'.repeat(103);
  assert.equal(advisoryBalance('−' + magnitude + '.9949'), 'R$\u00a0' + grouped + ',99 (C)');
  assert.equal(advisoryBalance(magnitude + '.995'), 'R$\u00a010' + '.000'.repeat(103) + ',00 (D)');
  assert.equal(advisoryBalance('−0.0049'), 'R$\u00a00,00 (C)');
  assert.equal(advisoryBalance('0.005'), 'R$\u00a00,01 (D)');
});

test('distingue erros, verificações bloqueadas e resultado sem falhas', () => {
  assert.equal(validationLabel(2, true), 'Erros na pré-validação');
  assert.equal(validationLabel(2, false), 'Erros na pré-validação');
  assert.equal(validationLabel(0, true), 'Pré-validação incompleta');
  assert.equal(validationLabel(0, false), 'Sem erros nas verificações executadas');
});

test('exibe 18 avisos espelhados de nove contas em nove linhas, sem alterar os avisos de origem', () => {
  const entries = Array.from({ length: 9 }, (_, index) => String(211110101 + index)).flatMap(account => [
    { key: account + ' · FP 1 · FR 1500 · PO 10131', source: 'CSV', observed: '−1.01', difference: '−1.01' },
    { key: account + ' · FP 1 · PO 10131', source: 'Siconfi', observed: '−1.01', difference: '1.01' },
  ]);
  const rows = groupInferredDifferences(entries);
  assert.equal(entries.length, 18);
  assert.equal(rows.length, 9);
  assert.ok(rows.every(row => row.paired?.changedType === 'FR'));
  assert.deepEqual(rows.map(row => row.paired.account), entries.filter(entry => entry.source === 'CSV').map(entry => entry.key.slice(0, 9)));
});
