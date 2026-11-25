# Validador MSC 2026

Pré-validação local de CSV da MSC agregada mensal e de encerramento do Executivo municipal. O resultado se aplica às verificações do MVP 1 e requer conferência da instituição e da competência antes do envio ao Siconfi.

## Uso local

Com Node.js 24.18 e npm, execute os comandos abaixo a partir da raiz do repositório. Os comandos das seções seguintes são executados em `front/`.

```powershell
Set-Location front
npm.cmd ci --no-audit --no-fund
npm.cmd start
```

Abra http://127.0.0.1:4200. Selecione o CSV, escolha a codificação e acione **Validar**. A validação executa em um Web Worker que pode ser encerrado pelo botão **Cancelar validação**. A mudança de arquivo ou de codificação limpa os resultados anteriores. O arquivo é processado na memória do navegador, sem transmissão e sem armazenamento pelo aplicativo.

Angular CLI e builder 22.0.9, Angular 22.0.8 e TypeScript 6.0.3 estão fixados no lockfile. A [matriz oficial](https://angular.dev/reference/versions) inclui Node.js 24.18 para essa combinação.

```powershell
npm.cmd test
npm.cmd run build
```

Os testes do motor usam o executor do Node.js e podem rodar com `node --test 'tests/*.test.mjs'` antes de instalar as dependências Angular. O build de produção gera `front/dist/validador-msc/browser` na árvore do repositório. Se o registro npm estiver indisponível e o cache local estiver completo, use `npm.cmd ci --offline --cache ../.npm-cache --no-audit --no-fund`.

Para verificar o relatório no Chromium headless, instale o navegador de teste uma vez e execute a suíte em `front/`:

```powershell
npx.cmd playwright install chromium --only-shell
npm.cmd run test:e2e
```

O Playwright serve o build Angular localmente e usa CSVs sintéticos e respostas simuladas do Siconfi.

Para separar erros do compilador das restrições de acesso do bundler, execute `node_modules/.bin/ngc.cmd -p tsconfig.json` e `node_modules/.bin/tsc.cmd -p tsconfig.worker.json`. Em um ambiente capaz de executar o esbuild, rode também o build oficial completo.

## Catálogo

O script de extração usa Python com openpyxl 3.1.5 e pypdf 6.21.4. Ele lê as referências locais em `references/msc/` na raiz do repositório, confronta o conjunto integral das 6.119 contas e associações entre Leiaute MSC, PCASP e Conjunto de IC, valida larguras e domínios e classifica as 11.382 instituições nas 317 páginas da tabela. A conferência de instituições considera as colunas IBGE, código Siconfi e instituição. O catálogo inclui os hashes, as edições e as regiões das fontes, as contagens por página e o identificador das regras.

```powershell
python scripts/extract_catalog.py
python scripts/extract_catalog.py --check
```

A opção `--check` regenera em memória e exige identidade byte a byte com `front/src/catalog-2026.json`. O motor exige a versão aprovada e confirma o SHA256 do JSON compacto em UTF-8 com chaves ordenadas, excluindo o próprio campo `version`. O template oficial original tem 6.121 linhas físicas com CRLF, incluindo metadados, guia e 6.119 registros. Em Windows-1252, a guia passa e os campos ilustrativos produzem achados. Em UTF-8 estrito, a decodificação para no primeiro erro.

## Corpus sintético e benchmark do motor

```powershell
node scripts/benchmark.mjs
```

O comando grava seis CSVs e o relatório `front/dist/benchmark/motor.json` na árvore do repositório. O relatório registra hashes e contagens, densidade esperada de diagnósticos, distribuição de IC, leituras da memória do processo e quatro medições por amostra. O script verifica os diagnósticos esperados em cada execução. O mesmo corpus serve de entrada para as medições de interface, renderização e responsividade no navegador.
