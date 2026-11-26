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
  const finding = result.getByRole('row', { name: /leitura em UTF-8/ });
  await expect(finding).toContainText('Linha: 1 · Byte: 0');
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
  await expect(finding).toContainText('Conta: ' + debitAccount + ' · Linha: 3');
  await expect(finding).toContainText('*ERRO*');
  await expect(finding).toContainText('Regra C03 · Campo 6 · IC3 · Par 3');
  await expect(result.getByText(/Confira o cadastro e o vínculo da fonte/)).toBeVisible();
  await expect(result.getByText('Corrija os erros listados abaixo antes de enviar a MSC ao Siconfi.')).toBeVisible();
  await expect(result.getByRole('list', { name: 'Motivos das verificações pendentes' }).getByRole('listitem')).toHaveText([
    'Um código de informação complementar não tem a quantidade de dígitos ou o formato exigido.',
    'A combinação de informações complementares está incompleta, inválida ou ambígua.',
  ]);
  await expect(result.getByRole('row').filter({ hasText: 'Regra C09' })).toHaveCount(0);
  await expect(result.getByText('A pré-validação local não garante aceitação pelo Siconfi.')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Avisos' }).getByText('!', { exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('mostra FR bem formada fora do domínio municipal como erro de conteúdo localizado', async ({ page, context, baseURL }) => {
  await mockSiconfi(context, baseURL, () => []);
  await validateFile(page, '3550308EX', [row(debitAccount, '0.00', 'ending_balance', 'D', '1504')]);

  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  const finding = result.getByRole('row').filter({ hasText: 'Regra C09' });
  await expect(finding.getByRole('cell', { name: 'Conteúdo', exact: true })).toBeVisible();
  await expect(finding).toContainText('Fonte de Recursos (FR) fora do domínio municipal de 2026.');
  await expect(finding).toContainText('Conta: ' + debitAccount + ' · Linha: 3');
  await expect(finding).toContainText('Valor informado: 1504');
  await expect(finding).toContainText('prefixo 1, 2 ou 9 e código principal listado no bloco subnacional');
  await expect(finding).toContainText('Regra C09 · Campo 6 · IC3 · Par 3');
  await expect(result.getByRole('row').filter({ hasText: 'Regra C03' })).toHaveCount(0);
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
  await expect(consistency).toContainText('Conta: 111110100 · PO 10131 · Linhas do grupo 3, 4, 5');
  await expect(consistency).toContainText('Saldo final informado: R$ 6.');
  await expect(consistency).toContainText('O saldo inicial de R$ 10 somado à movimentação líquida de R$ −15 resulta em R$ −5. Diferença de R$ 11.');
  await expect(consistency).toContainText('Regra SAL-CONS-01');

  const equilibrium = errors.filter({ hasText: 'SAL-EQU-01' });
  await expect(equilibrium).toContainText('Patrimonial (classes 1–4) · Linhas do grupo 3, 4, 5');
  await expect(equilibrium).toContainText('Totais informados: R$ 16 em débitos e R$ 15 em créditos.');
  await expect(equilibrium).toContainText('Os totais deveriam coincidir. Diferença de R$ 1 (débitos menos créditos).');
  await expect(equilibrium).toContainText('Regra SAL-EQU-01');
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
    const rows = previousReference(filters);
    if (rows.length) rows.push({ ...rows[0], conta_contabil: '111110603', valor: 0 });
    return rows;
  });
  await validateFile(page, '2914604EX', [...balances, row('111110602', '0', 'beginning_balance', 'D')]);

  const resultTab = page.getByRole('tab', { name: 'Resultado' });
  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  await expect(result.getByText('Sem erros nas verificações executadas')).toBeVisible();
  await expect(result.getByRole('table', { name: 'Avisos da comparação entre competências' })).toHaveCount(0);
  await expect(noticesTab).toHaveAttribute('aria-selected', 'false');
  await expect(noticesTab).toHaveAccessibleDescription('A comparação com o Siconfi está em andamento.');
  const spinner = noticesTab.locator('.report-tab-spinner');
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS('animation-name', 'none');

  await resultTab.press('ArrowRight');
  await expect(noticesTab).toBeFocused();
  await expect(noticesTab).toHaveAttribute('aria-selected', 'true');
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  const comparisonHeading = notices.getByRole('heading', { name: '1 aviso de saldo entre competências', exact: true });
  await expect(comparisonHeading).toHaveCount(0);
  await expect(notices.getByRole('status')).toHaveText('A comparação com o Siconfi está em andamento.');
  await expect(notices.getByRole('button', { name: 'Cancelar comparação' })).toHaveCount(0);

  await expect(noticesTab.getByText('!', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(spinner).toHaveCount(0);
  await expect(noticesTab).toHaveAccessibleDescription('Há avisos que merecem atenção.');
  expect(calls.map(({ month, accountClass, valueType }) => [month, accountClass, valueType])).toEqual([
    ...Array.from({ length: 8 }, (_, index) => [9, index + 1, 'ending_balance']),
  ]);

  const table = notices.getByRole('table', { name: 'Avisos da comparação entre competências' });
  await expect(table.getByRole('columnheader')).toHaveText(['Tipo', 'Mensagem']);
  const divergence = table.getByRole('row', { name: new RegExp(debitAccount) });
  await expect(divergence.getByRole('cell').first()).toHaveText('Aviso');
  const message = divergence.getByRole('cell').last();
  await expect(message.locator('strong')).toHaveText('Divergência de saldo entre competências');
  await expect(message.locator('div')).toHaveText([
    `Conta ${debitAccount} · PO ${powerCode}`,
    'Saldo inicial da MSC: R$ 100,00 (D)',
    'Saldo final da competência anterior no Siconfi: R$ 99,00 (D)',
  ]);
  await expect(comparisonHeading).toBeVisible();
  await expect(notices.getByText('setembro de 2026 → outubro de 2026', { exact: true })).toBeVisible();
  await expect(notices.getByText('Os avisos possuem caráter informativo e não são impeditivos.')).toBeVisible();
  await expect(notices.getByText(/^Comparação parcial:/)).toHaveCount(0);
  await expect(table.locator('tbody').getByRole('row')).toHaveCount(1);
  await expect(notices.getByText('2 combinações sem par · 1 só no Siconfi e 1 só no CSV.')).toBeVisible();
  await expect(notices.getByText('Entre as combinações sem par, o saldo líquido é zero em 1 das que só constam no CSV e em 1 das que só constam no Siconfi.')).toBeVisible();

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
  await expect(result.getByRole('table', { name: 'Avisos da comparação entre competências' })).toHaveCount(0);
});

test('não sinaliza atenção quando há somente ausência de referência na API', async ({ page, context, baseURL }) => {
  await mockSiconfi(context, baseURL, () => []);
  await page.goto('/');
  await selectFile(page, '2914604EX', '2026-02', balances, 'msc-sintetica.csv');
  await page.getByRole('button', { name: 'Validar', exact: true }).click();

  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  await noticesTab.click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByText('Sem referência na API')).toBeVisible({ timeout: 15_000 });
  await expect(noticesTab.locator('.report-tab-spinner')).toHaveCount(0);
  await expect(noticesTab.getByText('!', { exact: true })).toHaveCount(0);
  await expect(noticesTab).toHaveAccessibleDescription('');
});

test('trata HTTP 503 como comparação inconclusiva apenas em Avisos', async ({ page, context, baseURL }) => {
  await routeSiconfi(context, baseURL, (route, filters) => filters.get('classe_conta') === '1'
    ? route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': baseURL } })
    : fulfillSiconfi(route, baseURL, []));
  await validateFile(page, '2914604EX', balances);

  await page.getByRole('tab', { name: 'Avisos' }).click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByText('Inconclusiva', { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await expect(notices.getByText('O Siconfi respondeu com erro HTTP 503.', { exact: true })).toHaveCount(1);
  await expect(notices.getByRole('table', { name: 'Avisos da comparação entre competências' })).toHaveCount(0);

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
    await expect(report.getByRole('tabpanel', { name: 'Avisos' }).getByRole('status')).toHaveText('A comparação com o Siconfi está em andamento.');
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
  await expect(notices.getByText(/setembro de 2026|A comparação com o Siconfi está em andamento/)).toHaveCount(0);
  expect(calls).toEqual(['2914604']);
});

test('prepara todos os erros para impressão, exclui Avisos e restaura aba e página', async ({ page, context, baseURL }) => {
  await mockSiconfi(context, baseURL, previousReference);
  const invalidRows = Array.from({ length: 53 }, () => row(debitAccount, '0.00', 'period_change', 'D', '*ERRO*'));
  const expectedErrors = invalidRows.map((_, index) => `Conta: ${debitAccount} · Linha: ${3 + balances.length + index}`);
  await validateFile(page, '2914604EX', [...balances, ...invalidRows]);

  const resultTab = page.getByRole('tab', { name: 'Resultado' });
  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  const notices = page.getByRole('tabpanel', { name: 'Avisos', includeHidden: true });
  const errorTable = result.getByRole('table', { name: 'Erros da pré-validação da MSC' });
  const errorRows = errorTable.getByRole('row').filter({ hasNot: page.getByRole('columnheader') });
  const errorLabels = errorRows.filter({ hasText: 'Fonte de Recursos (FR) inválida' }).locator('.finding-context');
  const pagination = result.getByRole('navigation', { name: 'Paginação da lista de erros' });
  await expect(errorLabels).toHaveText(expectedErrors.slice(0, 50));
  await pagination.getByRole('button', { name: 'Próxima' }).click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(errorLabels).toHaveText(expectedErrors.slice(50));
  await noticesTab.click();
  const divergence = page.getByRole('table', { name: 'Avisos da comparação entre competências', includeHidden: true });
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

test('mantém divergências confiáveis em Avisos quando outro saldo tem NR inválida', async ({ page, context, baseURL }) => {
  const accountWithInvalidNr = '621100000';
  const relatedAccount = '621200000';
  const validAccount = '211110101';
  const nr = '00000001';
  const csvWithNr = (account, value, revenueCode) =>
    [account, powerCode, 'PO', '', '', '', '', revenueCode, 'NR', ...Array(4).fill(''), value, 'beginning_balance', 'D'].join(';');
  await mockSiconfi(context, baseURL, filters => {
    const month = Number(filters.get('me_referencia'));
    const accountClass = Number(filters.get('classe_conta'));
    if (month !== 9) return [];
    const common = { cod_ibge: 2914604, exercicio: 2026, mes_referencia: month, classe_conta: accountClass,
      tipo_matriz: 'MSCC', tipo_valor: 'ending_balance', poder_orgao: powerCode, natureza_conta: 'D' };
    if (accountClass === 2) return [{ ...common, conta_contabil: validAccount, valor: 8 }];
    if (accountClass === 6) return [
      { ...common, conta_contabil: accountWithInvalidNr, natureza_receita: nr, valor: 50 },
      { ...common, conta_contabil: relatedAccount, natureza_receita: nr, valor: 12 },
    ];
    return [];
  });
  await validateFile(page, '2914604EX', [
    csvWithNr(accountWithInvalidNr, '20', 'ERRO'),
    csvWithNr(relatedAccount, '13', nr),
    row(validAccount, '10', 'beginning_balance', 'D'),
  ]);

  const result = page.getByRole('tabpanel', { name: 'Resultado' });
  const finding = result.getByRole('row').filter({ hasText: 'C03' });
  await expect(finding).toHaveCount(1);
  await expect(finding.getByText('Natureza da Receita (NR) inválida', { exact: true })).toBeVisible();
  await expect(finding).toContainText(`Conta: ${accountWithInvalidNr} · Linha: 3`);
  await expect(finding).toContainText('Valor informado: ERRO');
  await expect(finding.getByText('ERRO', { exact: true })).toHaveCSS('color', 'rgb(181, 29, 29)');
  await expect(finding).toContainText('Correção: informe um código de Natureza da Receita válido, composto por 8 dígitos numéricos.');
  await expect(finding).toContainText('Regra C03 · Campo 8 · IC4 · Par 4');
  await expect(result.getByRole('table', { name: 'Avisos da comparação entre competências' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Avisos' }).click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByRole('heading', { name: '2 avisos de saldo entre competências' })).toBeVisible({ timeout: 25_000 });
  await expect(notices.getByText('Comparação parcial: Há combinações excluídas por dados inválidos no CSV.', { exact: true })).toBeVisible();
  const differences = notices.getByRole('table').locator('tbody').getByRole('row');
  await expect(differences).toHaveCount(2);
  const validMessage = differences.filter({ hasText: validAccount }).getByRole('cell').last();
  const relatedMessage = differences.filter({ hasText: relatedAccount }).getByRole('cell').last();
  await expect(validMessage.locator('div')).toHaveText([
    `Conta ${validAccount} · PO ${powerCode}`,
    'Saldo inicial da MSC: R$ 10,00 (D)',
    'Saldo final da competência anterior no Siconfi: R$ 8,00 (D)',
  ]);
  await expect(relatedMessage.locator('div')).toHaveText([
    `Conta ${relatedAccount} · NR ${nr} · PO ${powerCode}`,
    'Saldo inicial da MSC: R$ 13,00 (D)',
    'Saldo final da competência anterior no Siconfi: R$ 12,00 (D)',
  ]);
  await expect(notices.getByText(accountWithInvalidNr, { exact: false })).toHaveCount(0);
  await expect(notices.getByText(/^\d+ combinações sem par · \d+ só no Siconfi e \d+ só no CSV\.$/)).toHaveCount(0);
});

test('informa que a comparação está indisponível quando o CSV tem tipo de saldo desconhecido', async ({ page, context, baseURL }) => {
  const calls = [];
  await mockSiconfi(context, baseURL, filters => { calls.push(filters); return []; });
  await validateFile(page, '2914604EX', [row(debitAccount, '1', 'desconhecido', 'D')]);

  await page.getByRole('tab', { name: 'Avisos' }).click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  await expect(notices.getByRole('status')).toHaveText('Comparação indisponível devido a dados inválidos ou incompletos no CSV.');
  await expect(notices.getByText('Inconclusiva', { exact: true })).toHaveCount(1);
  expect(calls).toHaveLength(0);
});

for (const [period, message] of [
  ['2026-01', 'Não aplicável'],
  ['2026-13', 'Não aplicável ao encerramento 2026-13.'],
]) {
  test(`não consulta o Siconfi para ${period}`, async ({ page, context, baseURL }) => {
    const calls = [];
    await mockSiconfi(context, baseURL, filters => { calls.push(filters); return []; });
    await page.goto('/');
    await selectFile(page, '2914604EX', period, balances, 'msc-sintetica.csv');
    await page.getByRole('button', { name: 'Validar', exact: true }).click();

    await page.getByRole('tab', { name: 'Avisos' }).click();
    const notices = page.getByRole('tabpanel', { name: 'Avisos' });
    await expect(notices.getByText(message, { exact: true })).toBeVisible();
    expect(calls).toHaveLength(0);
  });
}

test('mostra cada aviso com zero inferido e reinicia a paginação ao revalidar', async ({ page, context, baseURL }) => {
  const calls = [];
  const localOnly = '111110602';
  const pairedAccount = '111110603';
  const ambiguousAccount = '111110604';
  const oppositeSigns = '111110701';
  const twoDifferentDimensions = '111111900';
  await routeSiconfi(context, baseURL, async (route, filters) => {
    const month = Number(filters.get('me_referencia'));
    const accountClass = Number(filters.get('classe_conta'));
    calls.push([month, accountClass]);
    if (accountClass !== 1) return fulfillSiconfi(route, baseURL, []);
    const common = { cod_ibge: 2914604, exercicio: 2026, mes_referencia: month, classe_conta: 1,
      tipo_matriz: 'MSCC', tipo_valor: filters.get('id_tv'), poder_orgao: powerCode, natureza_conta: 'D' };
    return fulfillSiconfi(route, baseURL, [
      { ...common, conta_contabil: debitAccount, valor: 99 },
      { ...common, conta_contabil: creditAccount, valor: 2.5 },
      { ...common, conta_contabil: pairedAccount, valor: 4, natureza_conta: 'C' },
      { ...common, conta_contabil: ambiguousAccount, valor: 6, fonte_recursos: '1501' },
      { ...common, conta_contabil: ambiguousAccount, valor: 6, fonte_recursos: '1502' },
      { ...common, conta_contabil: oppositeSigns, valor: 8, natureza_conta: 'C' },
      { ...common, conta_contabil: twoDifferentDimensions, valor: 9, fonte_recursos: '1501', poder_orgao: '10132' },
      ...Array.from({ length: 49 }, (_, index) => ({ ...common, conta_contabil: String(119900000 + index), valor: 1 })),
    ]);
  });
  const rows = [row(debitAccount, '100', 'beginning_balance', 'D'), row(localOnly, '3', 'beginning_balance', 'D'),
    row(pairedAccount, '4', 'beginning_balance', 'C', '1500'), row(ambiguousAccount, '6', 'beginning_balance', 'D', '1500'),
    row(oppositeSigns, '8', 'beginning_balance', 'D', '1500'), row(twoDifferentDimensions, '9', 'beginning_balance', 'D', '1500')];
  await page.goto('/');
  await selectFile(page, '2914604EX', '2026-10', rows, 'msc-sintetica.csv');
  const validate = page.getByRole('button', { name: 'Validar', exact: true });
  await validate.click();

  const noticesTab = page.getByRole('tab', { name: 'Avisos' });
  await noticesTab.click();
  const notices = page.getByRole('tabpanel', { name: 'Avisos' });
  const table = notices.getByRole('table', { name: 'Avisos da comparação entre competências' });
  const pagination = notices.getByRole('navigation', { name: 'Paginação da comparação com a competência setembro de 2026' });
  await expect(notices.getByRole('checkbox')).toHaveCount(0);
  await expect(notices.getByText('60 combinações sem par · 55 só no Siconfi e 5 só no CSV.')).toBeVisible({ timeout: 20_000 });
  await expect(notices.getByText('Total de avisos com zero inferido 60', { exact: true })).toBeVisible();
  const csv = table.getByRole('row', { name: new RegExp(localOnly) });
  const api = table.getByRole('row', { name: new RegExp(creditAccount) });
  await expect(csv.getByText('Saldo inicial da MSC: R$ 3,00 (D)', { exact: true })).toBeVisible();
  await expect(csv.getByText('Saldo final da competência anterior no Siconfi: R$ 0,00 inferido', { exact: true })).toBeVisible();
  await expect(api.getByText('Saldo inicial da MSC: R$ 0,00 inferido', { exact: true })).toBeVisible();
  await expect(api.getByText('Saldo final da competência anterior no Siconfi: R$ 2,50 (D)', { exact: true })).toBeVisible();
  const paired = table.getByRole('row').filter({ hasText: pairedAccount });
  await expect(paired).toHaveCount(2);
  const localPair = paired.filter({ hasText: 'FR 1500' });
  const officialPair = paired.filter({ hasNotText: 'FR 1500' });
  await expect(localPair.getByText(`Conta ${pairedAccount} · FR 1500 · PO ${powerCode}`, { exact: true })).toBeVisible();
  await expect(localPair).toContainText('Saldo inicial da MSC: R$ 4,00 (C)');
  await expect(officialPair.getByText(`Conta ${pairedAccount} · PO ${powerCode}`, { exact: true })).toBeVisible();
  await expect(officialPair).toContainText('Saldo final da competência anterior no Siconfi: R$ 4,00 (C)');
  await expect(table.getByRole('row').filter({ hasText: ambiguousAccount })).toHaveCount(3);
  await expect(table.getByRole('row').filter({ hasText: oppositeSigns })).toHaveCount(2);
  await expect(table.getByRole('row').filter({ hasText: twoDifferentDimensions })).toHaveCount(2);
  await expect(notices.getByRole('heading', { name: '61 avisos de saldo entre competências' })).toBeVisible();
  await expect(notices.getByText('Comparação inconclusiva: Há combinações sem saldo correspondente.', { exact: true })).toBeVisible();
  await expect(notices.getByText('Total de avisos de divergência 1', { exact: true })).toBeVisible();
  await expect(table.locator('tbody').getByRole('row')).toHaveCount(50);
  await expect(table.locator('tbody').getByRole('row').first()).toContainText(`Conta ${debitAccount} · PO ${powerCode}`);
  await pagination.getByRole('button', { name: 'Próxima' }).click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(table.locator('tbody').getByRole('row')).toHaveCount(11);
  expect(calls).toEqual(Array.from({ length: 8 }, (_, index) => [9, index + 1]));

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(table).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });

  await validate.click();
  await noticesTab.click();
  await expect(table).toHaveCount(0);
  await expect(pagination).toContainText('Página 1', { timeout: 20_000 });
  await expect(csv).toBeVisible();

  await selectFile(page, '2914604EX', '2026-12', rows, 'msc-substituta.csv');
  await validate.click();
  await noticesTab.click();
  await expect(table).toHaveCount(0);
});
