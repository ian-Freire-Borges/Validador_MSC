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
  await selectFile(page, institution, '2026-10', rows, 'msc-sintetica.csv');
  await page.getByRole('button', { name: 'Validar', exact: true }).click();
}

async function selectFile(page, institution, period, rows, name) {
  const csv = [institution + ';' + period, columns.join(';'), ...rows].join('\r\n');
  await page.getByLabel('Arquivo MSC em CSV').setInputFiles({
    name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8'),
  });
}

async function routeSiconfi(context, baseURL, respond) {
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
    await respond(route, url.searchParams);
  });
}

function fulfillSiconfi(route, baseURL, items) {
  return route.fulfill({
    headers: { 'Access-Control-Allow-Origin': baseURL },
    json: { items, count: items.length, limit: 5000, offset: 0, hasMore: false, links: [] },
  });
}

function mockSiconfi(context, baseURL, load) {
  return routeSiconfi(context, baseURL, (route, filters) => fulfillSiconfi(route, baseURL, load(filters)));
}

const balances = [[debitAccount, 'D'], [creditAccount, 'C']].flatMap(([account, side]) => [
  row(account, '100.00', 'beginning_balance', side),
  row(account, '100.00', 'ending_balance', side),
]);

function previousReference(filters) {
  if (filters.get('me_referencia') !== '9' || filters.get('classe_conta') !== '1') return [];
  const common = { cod_ibge: 2914604, exercicio: 2026, mes_referencia: 9, classe_conta: 1,
    tipo_matriz: 'MSCC', tipo_valor: 'ending_balance', poder_orgao: powerCode };
  return [
    { ...common, conta_contabil: debitAccount, valor: 99, natureza_conta: 'D' },
    { ...common, conta_contabil: creditAccount, valor: 100, natureza_conta: 'C' },
  ];
}

test('exige CSV em UTF-8, orienta a reexportação e omite o histórico manual', async ({ page, context, baseURL }) => {
  const calls = [];
  await mockSiconfi(context, baseURL, filters => { calls.push(filters); return []; });
  await page.goto('/');
  const input = page.getByLabel('Arquivo MSC em CSV');
  await expect(input).toHaveAccessibleDescription(/^Use um arquivo CSV em UTF-8\./);
  await expect(page.getByLabel('Codificação', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Histórico público do Siconfi', includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Abrir histórico|Consultar histórico/, includeHidden: true })).toHaveCount(0);

  await input.setInputFiles({
    name: 'msc-codificacao-invalida.csv', mimeType: 'text/csv', buffer: Buffer.from([0xe9]),
  });
  await page.getByRole('button', { name: 'Validar', exact: true }).click();
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  const finding = result.getByRole('row', { name: /Linha 1, byte 0.*leitura em UTF-8/ });
  await expect(finding).toContainText('0xE9');
  await expect(finding).toContainText('Reexporte o CSV em UTF-8 e valide novamente.');
  await expect(finding).toContainText('L01');
  expect(calls).toHaveLength(0);
});

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

test('mostra consistência e equilíbrio patrimonial na aba Resultado', async ({ page, context, baseURL }) => {
  const calls = [];
  await mockSiconfi(context, baseURL, filters => { calls.push(filters); return []; });
  await validateFile(page, '3550308EX', [
    row(debitAccount, '10', 'beginning_balance', 'D'),
    row(debitAccount, '15', 'period_change', 'C'),
    row(debitAccount, '6', 'ending_balance', 'D'),
  ]);

  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  await expect(result.getByText('Erros na pré-validação', { exact: true })).toBeVisible();
  await expect(result.getByText('Total de erros 2 · Estrutura 0 · Conteúdo 2', { exact: true })).toBeVisible();
  const table = result.getByRole('table', { name: 'Erros da pré-validação da MSC' });
  const errors = table.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Conteúdo', exact: true }) });
  await expect(errors).toHaveCount(2);
  await expect(table.getByRole('cell', { name: 'Estrutura', exact: true })).toHaveCount(0);

  const consistency = errors.filter({ hasText: 'SAL-CONS-01' });
  await expect(consistency).toContainText('Conta 111110100 · PO 10131');
  await expect(consistency).toContainText('O arquivo trouxe saldo final de R$ 6. O saldo inicial de R$ 10 somado à movimentação líquida de R$ −15 resulta em R$ −5. Diferença de R$ 11.');
  await expect(consistency).toContainText('SAL-CONS-01 · Linhas do grupo 3, 4, 5');

  const equilibrium = errors.filter({ hasText: 'SAL-EQU-01' });
  await expect(equilibrium).toContainText('Patrimonial (classes 1–4)');
  await expect(equilibrium).toContainText('O arquivo trouxe R$ 16 em débitos e R$ 15 em créditos. Os totais deveriam coincidir. Diferença de R$ 1 (débitos menos créditos).');
  await expect(equilibrium).toContainText('SAL-EQU-01 · Linhas do grupo 3, 4, 5');
  expect(calls).toHaveLength(0);
});

test('cancela a validação local em andamento e permite validar novamente', async ({ page, context, baseURL }) => {
  await mockSiconfi(context, baseURL, () => []);
  const workerAsset = /\/worker-[\w-]+\.js$/;
  const readBarrierChannel = 'msc-validation-read-barrier';
  let workerLoads = 0;
  await context.route(url => url.origin === baseURL && workerAsset.test(url.pathname), async route => {
    if (++workerLoads > 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response, body: `
      {
        const barrier = new BroadcastChannel(${JSON.stringify(readBarrierChannel)});
        const read = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = async function () {
          const released = new Promise(resolve => barrier.addEventListener('message', resolve, { once: true }));
          barrier.postMessage('reading');
          await released;
          barrier.close();
          return read.call(this);
        };
      }
      ${await response.text()}
    ` });
  });
  await page.addInitScript(channelName => {
    const barrier = new BroadcastChannel(channelName);
    barrier.addEventListener('message', event => { window.validationReadStarted = event.data === 'reading'; });
    window.releaseValidationRead = () => {
      barrier.postMessage('release');
      barrier.close();
    };
  }, readBarrierChannel);

  const validate = page.getByRole('button', { name: 'Validar', exact: true });
  const cancel = page.getByRole('button', { name: 'Cancelar validação' });
  const progress = page.getByRole('progressbar', { name: 'Progresso da validação' });
  const status = page.getByRole('region', { name: 'Arquivo para validar' }).getByRole('status');
  const report = page.getByRole('region', { name: 'Relatório de pré-validação' });
  const workerStarted = page.waitForEvent('worker', worker => workerAsset.test(new URL(worker.url()).pathname));
  await validateFile(page, '3550308EX', balances);
  const worker = await workerStarted;
  await page.waitForFunction(() => window.validationReadStarted === true);
  await expect(cancel).toBeEnabled();
  await expect(validate).toBeDisabled();
  await expect(progress).toBeVisible();
  await expect(status).toHaveText('Lendo o arquivo.');
  await expect(report).toHaveCount(0);

  const workerClosed = worker.waitForEvent('close');
  await cancel.click();
  await workerClosed;
  await expect(cancel).toHaveCount(0);
  await expect(progress).toHaveCount(0);
  await expect(validate).toBeEnabled();

  await page.evaluate(() => window.releaseValidationRead());
  await expect(status).toHaveText('Validação cancelada.');
  await expect(report).toHaveCount(0);

  await validate.click();
  await expect(status).toHaveText('Pré-validação local concluída.');
  await expect(report.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await expect(report.getByText('3550308EX', { exact: true })).toBeVisible();
  expect(workerLoads).toBe(2);
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
    return previousReference(filters);
  });
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

test('trata HTTP 503 como comparação inconclusiva apenas em Avisos', async ({ page, context, baseURL }) => {
  await routeSiconfi(context, baseURL, route => route.fulfill({
    status: 503,
    headers: { 'Access-Control-Allow-Origin': baseURL },
  }));
  await validateFile(page, '2914604EX', balances);

  await page.getByRole('tab', { name: 'Avisos' }).click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByText('Inconclusiva', { exact: true })).toHaveCount(2);
  await expect(notices.getByText('O Siconfi respondeu com erro HTTP 503.', { exact: true })).toHaveCount(2);
  await expect(notices.getByText('Divergência confirmada')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Resultado' }).click();
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  await expect(result.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await expect(result.getByRole('heading', { name: 'Erros de validação' })).toHaveCount(0);
  await expect(result).not.toContainText(/HTTP 503|Inconclusiva/);
});

test('cancela a consulta Siconfi do CSV substituído e descarta a resposta tardia', async ({ page, context, baseURL }) => {
  const intercepted = Promise.withResolvers();
  const releaseResponse = Promise.withResolvers();
  const responseHandled = Promise.withResolvers();
  const calls = [];
  await routeSiconfi(context, baseURL, async (route, filters) => {
    calls.push(filters.get('id_ente'));
    if (calls.length > 1) {
      await fulfillSiconfi(route, baseURL, []);
      return;
    }
    intercepted.resolve(route.request().url());
    await releaseResponse.promise;
    try {
      await fulfillSiconfi(route, baseURL, previousReference(filters));
    } finally {
      responseHandled.resolve();
    }
  });

  const report = page.getByRole('region', { name: 'Relatório de pré-validação' });
  try {
    await validateFile(page, '2914604EX', balances);
    await page.getByRole('tab', { name: 'Avisos' }).click();
    await expect(report.getByText('Consultando as competências vizinhas…')).toBeVisible();
    const url = await intercepted.promise;
    const aborted = page.waitForEvent('requestfailed', request => request.url() === url);

    await selectFile(page, '3550308EX', '2026-11', balances, 'msc-substituta.csv');
    await expect(report).toHaveCount(0);
    expect((await aborted).failure()?.errorText).toBe('net::ERR_ABORTED');

    await page.getByRole('button', { name: 'Validar', exact: true }).click();
    await expect(report.getByText('3550308EX', { exact: true })).toBeVisible();
    await expect(report.getByText('novembro de 2026', { exact: true })).toBeVisible();
  } finally {
    releaseResponse.resolve();
  }
  await responseHandled.promise;
  await expect(report.getByText('3550308EX', { exact: true })).toBeVisible();
  await expect(report.getByText('2914604EX', { exact: true })).toHaveCount(0);
  await expect(report.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await page.getByRole('tab', { name: 'Avisos' }).click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByText(/Disponível para arquivos mensais de 2026 de municípios baianos/)).toBeVisible();
  await expect(notices.getByText(/Divergência confirmada|setembro de 2026|Consultando as competências vizinhas/)).toHaveCount(0);
  expect(calls).toEqual(['2914604']);
});

test('prepara todos os erros para impressão, exclui Avisos e restaura aba e página', async ({ page, context, baseURL }) => {
  await mockSiconfi(context, baseURL, previousReference);
  const invalidRows = Array.from({ length: 53 }, () => row(debitAccount, '0.00', 'period_change', 'D', '*ERRO*'));
  const expectedErrors = invalidRows.map((_, index) => `Linha ${3 + balances.length + index} — Fonte de Recursos (FR) inválida.`);
  await validateFile(page, '2914604EX', [...balances, ...invalidRows]);

  const resultTab = page.getByRole('tab', { name: 'Resultado' });
  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  const notices = page.getByRole('tabpanel', { name: 'Avisos', includeHidden: true });
  const errorTable = result.getByRole('table', { name: 'Erros da pré-validação da MSC' });
  const errorRows = errorTable.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
  const errorLabels = errorRows.getByText(/^Linha \d+ — Fonte de Recursos/);
  const pagination = result.getByRole('navigation', { name: 'Paginação da lista de erros' });
  await expect(errorLabels).toHaveText(expectedErrors.slice(0, 50));
  await pagination.getByRole('button', { name: 'Próxima' }).click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(errorLabels).toHaveText(expectedErrors.slice(50));
  await noticesTab.click();
  const divergence = page.getByText('Divergência confirmada', { exact: true });
  await expect(divergence).toBeVisible({ timeout: 20_000 });

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(result).toBeVisible();
  await expect(errorRows).toHaveCount(expectedErrors.length);
  await expect(errorLabels).toHaveText(expectedErrors);
  for (const index of [0, 49, 50, 52]) await expect(errorLabels.nth(index)).toBeVisible();
  await expect(result.getByText('Total de erros 53', { exact: true })).toBeVisible();
  await expect(pagination).toBeHidden();
  await expect(notices).toBeHidden();
  await expect(divergence).toBeHidden();

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(noticesTab).toHaveAttribute('aria-selected', 'true');
  await expect(divergence).toBeVisible();
  await expect(result).toBeHidden();
  await resultTab.click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(errorLabels).toHaveText(expectedErrors.slice(50));
});
