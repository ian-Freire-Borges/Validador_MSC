import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../src/catalog-2026.json' with { type: 'json' };
import { columns } from '../src/catalog.ts';
import { validate } from '../src/validation.ts';

const [A, B, O, P, C] = ['111110100', '111110200', '511100000', '511200000', '711110101'];
const [SI, M, SF] = ['beginning_balance', 'period_change', 'ending_balance'];
const [CONS, EQU] = ['SAL-CONS-01', 'SAL-EQU-01'];
const good = 'Sem pendências nas verificações executadas do MVP 1.1';
const bad = 'Pendências nas verificações do MVP 1.1';
const po = ['10131', 'PO'];
const otherPO = ['10101', 'PO'];
const fp = ['1', 'FP'];
const row = (account, type, value, side, pairs = [po]) => [account, ...pairs.flat(),
  ...Array(12 - pairs.length * 2).fill(''), value, type, side].join(';');
const run = (rows, { period = '2026-01', metadata = '3550308EX;' + period, guide = columns.join(';'), selected = catalog } = {}) =>
  validate(Buffer.from([metadata, guide, ...rows].join('\n')), selected);
const groups = (result, id) => result.balances.groups.filter(group => group.id === id);
const totals = group => group.totals.map(total => total.value);
const origins = group => group.blocks.flatMap(block => block.origins.items);
const normative = result => result.balances.groups.map(group => [group.id, group.group, group.state, totals(group)]);

test('mensal: consistência por combinação e equilíbrio por natureza, com somas por tipo', () => {
  const result = run([
    row(A, SI, '100', 'D'), row(A, M, '25', 'D'), row(A, M, '5', 'C'), row(A, SF, '120', 'D'),
    row(B, SI, '100', 'C'), row(B, M, '25', 'C'), row(B, M, '5', 'D'), row(B, SF, '120', 'C'),
  ]);
  assert.equal(result.summary, good);
  assert.deepEqual(groups(result, CONS).map(totals), [['100', '20', '120', '120', '0'], ['−100', '−20', '−120', '−120', '0']]);
  assert.deepEqual(groups(result, EQU).map(group => group.state), ['Conforme', 'Não aplicável', 'Não aplicável']);
  assert.deepEqual(totals(groups(result, EQU)[0]), ['250', '250', '0']);
  const withoutCounterpart = run([row(A, SI, '100', 'D'), row(A, M, '25', 'D'), row(A, M, '5', 'C'), row(A, SF, '120', 'D')]);
  assert.deepEqual(totals(groups(withoutCounterpart, EQU)[0]), ['245', '5', '240']);
});

test('inversão de natureza e diferença do observado menos o esperado', () => {
  const start = [row(A, SI, '10', 'D'), row(A, M, '15', 'C')];
  for (const [side, state, observed, difference] of [['C', 'Conforme', '−5', '0'], ['D', 'Falhou', '5', '10']]) {
    const group = groups(run([...start, row(A, SF, '5', side)]), CONS)[0];
    assert.equal(group.state, state);
    assert.deepEqual(totals(group), ['10', '−15', observed, '−5', difference]);
  }
});

test('decimais exatos, múltiplos movimentos, ordem das linhas e dos slots', () => {
  const first = [row(A, M, '0.10', 'D', [po, fp]), row(A, M, '0.20', 'D', [fp, po]), row(A, SF, '0.300', 'D', [po, fp])];
  const result = run(first);
  assert.equal(groups(result, CONS).length, 1);
  assert.deepEqual(totals(groups(result, CONS)[0]), ['0', '0.3', '0.3', '0.3', '0']);
  assert.equal(groups(result, CONS)[0].state, 'Conforme');
  assert.deepEqual(normative(result), normative(run([...first].reverse())));
  const large = [row(A, SI, '9007199254740993.001', 'D'), row(A, M, '0.009', 'D')];
  for (const [value, state, diff] of [['9007199254740993.010', 'Conforme', '0'], ['9007199254740993.009', 'Falhou', '−0.001']]) {
    const group = groups(run([...large, row(A, SF, value, 'D')]), CONS)[0];
    assert.equal(group.state, state);
    assert.deepEqual(totals(group).slice(-2), ['9007199254740993.01', diff]);
  }
  const tiny = '0.' + '0'.repeat(120) + '1';
  assert.equal(totals(groups(run([row(A, M, tiny, 'D')]), CONS)[0]).at(-1), '−' + tiny);
});

test('zeros omitidos ou explícitos e compensação entre tipos preservam a síntese conforme', () => {
  const start = [row(A, SI, '10', 'D'), row(A, M, '10', 'C')];
  for (const rows of [start, [...start, row(A, SF, '0', 'C')]]) {
    const result = run(rows);
    assert.equal(result.summary, good);
    assert.equal(result.rules[CONS].state, 'Conforme');
    assert.equal(result.rules[EQU].state, 'Conforme');
    assert.deepEqual(totals(groups(result, EQU)[0]), ['10', '10', '0']);
    assert.equal(result.findings.length, 0);
  }
  const blocked = run([...start, row(A, SF, '0', '')]);
  assert.equal(blocked.rules.E08.state, 'Falhou');
  assert.equal(blocked.rules[CONS].state, 'Bloqueada');
  assert.equal(blocked.rules[EQU].state, 'Bloqueada');
  assert.deepEqual(origins(groups(blocked, EQU)[0]), [{ rule: 'E08', line: 5, field: 'Natureza_valor' }]);
  const allZero = run([row(C, SF, '000.0000', 'D')]);
  assert.deepEqual(groups(allZero, EQU).map(group => group.state), ['Não aplicável', 'Não aplicável', 'Conforme']);
});

test('linhas duplicadas somam e os grupos preservam amostra limitada das linhas', () => {
  const movement = [row(A, M, '4', 'D', [po, fp]), row(A, M, '04.00', 'D', [fp, po])];
  for (const [final, state, diff] of [['8', 'Conforme', '0'], ['4', 'Falhou', '−4']]) {
    const result = run([...movement, row(A, SF, final, 'D', [po, fp])]);
    const group = groups(result, CONS)[0];
    assert.equal(group.state, state);
    assert.equal(totals(group).at(-1), diff);
    assert.deepEqual(group.lines, { count: 3, items: [3, 4, 5] });
  }
  const duplicateOnly = run(Array(8).fill(row(A, SF, '0', 'D')));
  assert.equal(duplicateOnly.rules.E09.state, 'Falhou');
  assert.equal(duplicateOnly.rules[CONS].state, 'Conforme');
  assert.deepEqual(groups(duplicateOnly, CONS)[0].lines, { count: 8, items: [3, 4, 5, 6, 7] });
});

test('repetição de TIPO com código igual ou distinto e chaves inválidas bloqueiam a conta, mas preservam EQU', () => {
  for (const [pairs, source] of [
    [[po, po], undefined], [[po, otherPO], undefined], [[po, ['', 'FP']], 'E10'],
    [[po, ['1', 'ZZ']], 'C02'], [[po, ['123', 'FR']], 'C03'], [[po, ['1', 'DC']], 'C04'],
    [[fp], 'C05'], [[po, ['9', 'FP']], 'C06'], [[['00000', 'PO']], 'C08'],
  ]) {
    const result = run([row(A, M, '4', 'D', pairs), row(A, SF, '0', 'D'), row(A, SI, '0', 'D', [otherPO]), row(B, SF, '0', 'D')]);
    const cons = groups(result, CONS);
    assert.deepEqual(cons.map(group => group.state), ['Bloqueada', 'Bloqueada', 'Conforme']);
    const sourceTrace = origins(cons[0]).find(origin => origin.rule === source);
    assert.equal(sourceTrace.line, 3);
    if (!source) assert.deepEqual(sourceTrace.slots, [1, 2]);
    assert.deepEqual(totals(groups(result, EQU)[0]), ['4', '0', '4']);
    assert.equal(groups(result, EQU)[0].state, 'Falhou');
  }
  const only = run([row(A, M, '4', 'D', [po, po])]);
  assert.equal(groups(only, CONS)[0].group, A);
  assert.equal(groups(only, CONS)[0].state, 'Bloqueada');
});

test('combinações e naturezas diferentes nunca se compensam', () => {
  const result = run([row(A, SI, '10', 'D'), row(A, SF, '8', 'D'),
    row(A, SI, '5', 'D', [otherPO]), row(A, SF, '7', 'D', [otherPO])]);
  assert.equal(result.rules[CONS].failed, 2);
  assert.deepEqual(groups(result, CONS).map(group => totals(group).at(-1)).sort(), ['2', '−2']);
  const optional = run([row(A, SI, '10', 'D'), row(A, SF, '10', 'D', [po, fp])]);
  assert.equal(optional.rules[CONS].failed, 2);
  const inter = run([row(A, M, '10', 'D'), row(O, M, '10', 'C')]);
  assert.equal(inter.rules[EQU].failed, 2);
  assert.deepEqual(groups(inter, EQU).map(group => totals(group).at(-1)), ['10', '−10', undefined]);
  assert.equal(inter.summary, bad);
});

test('valor inválido bloqueia somente a combinação e toda a natureza afetada, sem subtotal', () => {
  const result = run([row(A, SI, '5', 'D'), row(A, M, '-5', 'D'), row(A, SF, '0', 'D'),
    row(A, SF, '0', 'C', [otherPO]), row(O, SI, '3', 'D'), row(O, SF, '2', 'D'), row(P, SI, '3', 'C'), row(P, SF, '2', 'C')]);
  assert.equal(result.rules.E06.state, 'Falhou');
  assert.deepEqual([result.rules[CONS].state, result.rules[CONS].failed, result.rules[CONS].blocked, result.rules[CONS].passed],
    ['Falhou', 2, 1, 1]);
  const [patrimonial, orcamentaria, controle] = groups(result, EQU);
  assert.equal(patrimonial.state, 'Bloqueada');
  assert.deepEqual(patrimonial.totals, []);
  assert.deepEqual(origins(patrimonial), [{ rule: 'E06', line: 4, field: 'Valor' }]);
  assert.equal(orcamentaria.state, 'Conforme');
  assert.deepEqual(totals(orcamentaria), ['5', '5', '0']);
  assert.equal(controle.state, 'Não aplicável');
  assert.equal(result.summary, bad);

  const mixed = run([row(A, M, '', 'D'), row(O, SF, '1', 'D')]);
  assert.deepEqual(groups(mixed, EQU).map(group => group.state), ['Bloqueada', 'Falhou', 'Não aplicável']);
  assert.equal(mixed.rules[EQU].blocked, 1);
  assert.equal(mixed.rules[EQU].failed, 1);
  assert.equal(mixed.rules[EQU].state, 'Falhou');
});

test('tipo inválido bloqueia a natureza e todas as suas partições, mesmo se parecerem vazias', () => {
  const result = run([row(A, 'unknown', '7', 'D'), row(O, M, '2', 'D'), row(O, SF, '2', 'D'), row(P, M, '2', 'C'), row(P, SF, '2', 'C')]);
  assert.equal(result.rules.E07.state, 'Falhou');
  assert.equal(groups(result, CONS)[0].state, 'Bloqueada');
  const [patrimonial, orcamentaria] = groups(result, EQU);
  assert.equal(patrimonial.state, 'Bloqueada');
  assert.deepEqual(patrimonial.blocks.map(block => block.type), [SI, M, SF]);
  assert.equal(orcamentaria.state, 'Conforme');
});

test('2026-12 e 2026-13 calculados no próprio arquivo', () => {
  const rows = [row(A, SI, '40', 'D'), row(A, M, '40', 'C'), row(B, SI, '40', 'C'), row(B, M, '40', 'D')];
  const december = run(rows, { period: '2026-12' });
  const closing = run(rows, { period: '2026-13' });
  assert.equal(december.periodKind, 'Mensal');
  assert.equal(closing.periodKind, 'Encerramento');
  assert.equal(closing.summary, good);
  assert.deepEqual(normative(december), normative(closing));
});

test('pré-requisitos globais bloqueiam os dois cálculos, mesmo após subtotal válido', () => {
  const valid = [row(A, SF, '0', 'D')];
  const bytes = Buffer.concat([Buffer.from(['3550308EX;2026-01', columns.join(';'), ...valid, ''].join('\n')), Buffer.from([0xff])]);
  for (const [result, cause, source] of [
    [run([...valid, '"abc']), 'leitura-incompleta', 'E01'],
    [validate(bytes, catalog), 'leitura-incompleta', 'L01'],
    [run(valid, { metadata: '3550308EX' }), 'metadados', 'L02'],
    [run(valid, { guide: 'CONTA' }), 'guia', 'E03'],
    [run(valid, { period: '2026-14' }), 'competência', 'E04'],
    [run(valid, { selected: null }), 'catálogo', 'E02'],
    [run(valid, { metadata: '1EX;2026-01' }), 'outra-esfera', 'E02'],
    [run(valid, { metadata: '9999999EX;2026-01' }), 'cadastro-inconclusivo', 'E02'],
    [run(valid, { metadata: 'inválida;2026-01' }), 'instituição', 'E02'],
    [run([...valid, 'curta']), 'registro', 'E05'],
    [run([...valid, row('999999999', SF, '0', 'D')]), 'conta', 'C01'],
    [run([]), 'sem-registros', 'E09'],
  ]) {
    assert.deepEqual(result.balances.groups.map(group => [group.id, group.group, group.state, group.blocks[0].reason]),
      [[CONS, 'Arquivo', 'Bloqueada', cause], [EQU, 'Arquivo', 'Bloqueada', cause]]);
    assert.equal(origins(result.balances.groups[0])[0].rule, source);
  }
  assert.equal(run([]).rules.E09.state, 'Falhou');
});
