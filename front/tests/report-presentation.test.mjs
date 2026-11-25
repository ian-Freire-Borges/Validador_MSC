import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currency, findingTitle, formatCompetence, validationLabel } from '../src/report-presentation.ts';
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

test('distingue erros, verificações bloqueadas e resultado sem falhas', () => {
  assert.equal(validationLabel(2, true), 'Erros na pré-validação');
  assert.equal(validationLabel(2, false), 'Erros na pré-validação');
  assert.equal(validationLabel(0, true), 'Pré-validação incompleta');
  assert.equal(validationLabel(0, false), 'Sem erros nas verificações executadas');
});
