import { expect, test } from '@playwright/test';
import { columns } from '../../src/catalog.ts';

const siconfiOrigin = 'https://apidatalake.tesouro.gov.br';
const debitAccount = '111110100';
const creditAccount = '111110200';
const powerCode = '10131';

function row(account, amount, type, side, fundingSource = null) {
  const information = [
    powerCode, 'PO', '', '', fundingSource ?? '', fundingSource === null ? '' : 'FR',
    '', '', '', '', '', '',
  ];
  return [account, ...information, amount, type, side].join(';');
}

async function validateFile(page, institution, rows) {
  await page.goto('/');
  const csv = [institution + ';2026-10', columns.join(';'), ...rows].join('\r\n');
  await page.getByLabel('Arquivo MSC em CSV').setInputFiles({
    name: 'msc-sintetica.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByRole('button', { name: 'Validar', exact: true }).click();
}

async function mockSiconfi(context, baseURL, load) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) {
      await route.continue();
      return;
    }
    if (url.origin !== siconfiOrigin || !url.pathname.startsWith('/ords/cdwhprd/siconfi/tt/msc_')) {
      await route.abort();
      return;
    }
    expect(route.request().method()).toBe('GET');
    expect(route.request().postData()).toBeNull();
    const items = load(url.searchParams);
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': baseURL },
      json: { items, count: items.length, limit: 5000, offset: 0, hasMore: false, links: [] },
    });
  });
}

test('mostra a falha de FR e a conta da própria linha na aba Resultado', async ({ page, context, baseURL }) => {
  const calls = [];
  await mockSiconfi(context, baseURL, filters => { calls.push(filters); return []; });
  await validateFile(page, '3550308EX', [row(debitAccount, '0.00', 'ending_balance', 'D', '*ERRO*')]);

  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  await expect(result.getByText('Erros na pré-validação', { exact: true })).toBeVisible();
  const finding = result.getByRole('row', { name: /Fonte de Recursos \(FR\) inválida/ });
  await expect(finding).toContainText('Linha 3');
  await expect(finding).toContainText('*ERRO*');
  await expect(finding).toContainText('C03 · Campo IC3');
  await expect(finding).toContainText('Conta informada ' + debitAccount);
  await expect(result.getByText(/Confira o cadastro e o vínculo da fonte/)).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('consulta automaticamente e mantém a divergência do mês anterior apenas em Avisos', async ({ page, context, baseURL }) => {
  const calls = [];
  await mockSiconfi(context, baseURL, filters => {
    expect([...filters.keys()].sort()).toEqual([
      'an_referencia', 'classe_conta', 'co_tipo_matriz', 'id_ente', 'id_tv', 'limit', 'me_referencia', 'offset',
    ]);
    const month = Number(filters.get('me_referencia'));
    const accountClass = Number(filters.get('classe_conta'));
    const valueType = filters.get('id_tv');
    expect(filters.get('id_ente')).toBe('2914604');
    expect(filters.get('an_referencia')).toBe('2026');
    expect(filters.get('co_tipo_matriz')).toBe('MSCC');
    expect(filters.get('limit')).toBe('5000');
    expect(filters.get('offset')).toBe('0');
    calls.push({ month, accountClass, valueType });
    if (month !== 9 || accountClass !== 1) return [];
    const common = { cod_ibge: 2914604, exercicio: 2026, mes_referencia: month, classe_conta: accountClass,
      tipo_matriz: 'MSCC', tipo_valor: valueType, poder_orgao: powerCode };
    return [
      { ...common, conta_contabil: debitAccount, valor: 99, natureza_conta: 'D' },
      { ...common, conta_contabil: creditAccount, valor: 100, natureza_conta: 'C' },
    ];
  });
  const balances = [[debitAccount, 'D'], [creditAccount, 'C']].flatMap(([account, side]) => [
    row(account, '100.00', 'beginning_balance', side),
    row(account, '100.00', 'ending_balance', side),
  ]);
  await validateFile(page, '2914604EX', balances);

  const resultTab = page.getByRole('tab', { name: 'Resultado' });
  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  await expect(result.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await expect(result.getByText('Divergência confirmada')).toHaveCount(0);
  await expect(noticesTab).toHaveAttribute('aria-selected', 'false');
  await expect.poll(() => calls.length, { timeout: 25_000 }).toBe(16);
  expect(calls.map(({ month, accountClass, valueType }) => [month, accountClass, valueType])).toEqual([
    ...Array.from({ length: 8 }, (_, index) => [9, index + 1, 'ending_balance']),
    ...Array.from({ length: 8 }, (_, index) => [11, index + 1, 'beginning_balance']),
  ]);

  await resultTab.press('ArrowRight');
  await expect(noticesTab).toBeFocused();
  await expect(noticesTab).toHaveAttribute('aria-selected', 'true');
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  const divergence = notices.getByRole('row', { name: /Divergência confirmada/ });
  await expect(divergence).toContainText('Conta ' + debitAccount);
  await expect(divergence).toContainText('outubro de 2026');
  await expect(divergence).toContainText('setembro de 2026');
  await expect(divergence).toContainText('Diferença de R$ 1');
  await expect(notices.getByText('Sem referência na API')).toBeVisible();
  await expect(notices.getByText(/não retornou registros para o saldo de novembro de 2026/)).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(result.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await expect(notices).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(noticesTab).toHaveAttribute('aria-selected', 'true');
  await expect(notices).toBeVisible();
  await noticesTab.press('Home');
  await expect(resultTab).toBeFocused();
  await expect(result).toBeVisible();
  await expect(result.getByText('Divergência confirmada')).toHaveCount(0);
  await expect(result.getByText(/Diferença de R\$ 1 \(CSV menos Siconfi\)/)).toHaveCount(0);
});
