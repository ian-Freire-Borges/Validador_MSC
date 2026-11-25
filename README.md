# Validador MSC 2026

Pré-validação local de CSV da MSC agregada mensal e de encerramento do Executivo municipal. O resultado se aplica às verificações do MVP 1 e requer conferência da instituição e da competência antes do envio ao Siconfi.

## Uso local

Com Node.js 24.18 e npm, execute os comandos abaixo a partir da raiz do repositório. Os comandos das seções seguintes são executados em `front/`.

```powershell
Set-Location front
npm.cmd ci --no-audit --no-fund
npm.cmd start
```

Abra http://127.0.0.1:4200. Selecione um CSV em UTF-8 e acione **Validar**. Se houver falha na leitura, reexporte o CSV em UTF-8 e valide novamente. A validação executa em um Web Worker que pode ser encerrado pelo botão **Cancelar validação**. A troca do arquivo limpa o relatório anterior. O arquivo é processado na memória do navegador, sem transmissão e sem armazenamento pelo aplicativo. Para arquivos elegíveis de municípios baianos de 2026, a aba **Avisos** exibe a comparação automática com as competências vizinhas consultadas no Siconfi.

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

### Gate local e revisão

Em `front/`, com o Chromium headless instalado, execute `npm.cmd run test:gate`. O comando reinstala as dependências pelo lockfile e executa as suítes Node e Playwright com o build Angular. Uma suíte vazia, falhas, cancelamentos, testes pulados ou pendentes, inconsistências no lockfile e falhas de build reprovam o gate. Encerre servidores de desenvolvimento do projeto antes de executar caso estejam usando os executáveis em `node_modules`.

O gate grava a cobertura por arquivo em `front/dist/test-gate/node-coverage.json` e o relatório de navegador em `front/dist/test-gate/playwright.json`. A base é o commit `059f44b`, medida com Node.js 24.18 sobre os arquivos de `src/**/*.ts` carregados pelos testes do Node. A cobertura de referência é **97,87% de linhas, 95,52% de branches e 99,18% de funções**. As diferenças em pontos percentuais são informativas. O relatório do Playwright registra o comportamento no navegador.

A aprovação exige revisão de QA e de código, além do gate automatizado. Registre o commit ou o commit-base e o identificador do diff, as versões do ambiente, o comando executado e os dois relatórios. Use o checklist para reunir as evidências aplicáveis à mudança.

- **Estrutura e cadastro (L01/L02, E01–E10)**. Confira codificação, leiaute, ente e competência. Registre um caso aceito, uma falha e, quando aplicável, uma verificação bloqueada com o motivo.
- **Conteúdo (C01–C08)**. Confira conta, tipo, formato e domínios de informação complementar nos casos alterados. Confira também se o relatório aponta a linha, o campo e a conta quando disponíveis.
- **Saldos normativos (SAL-CONS-01 e SAL-EQU-01)**. Confira a consistência e o equilíbrio com valores exatos, incluindo um caso que passa e um que diverge.
- **Consulta e avisos mensais (SICONFI-HIST-001 e SICONFI-SAL-MES-001)**. Confira os filtros enviados, paginação, cancelamento, ausência de referência na API e a separação entre divergências confirmadas, combinações sem par e erros da pré-validação.
- **Relatório e impressão**. Confira ausência de falhas, falhas, resultado incompleto, abas por teclado e impressão da lista inteira de erros quando esses fluxos forem afetados.

Para regras contábeis, associe cada evidência ao identificador da regra, à versão e à seção da [referência MSC aplicável](references/msc/README.md), à entrada de teste e ao resultado esperado e obtido. Registre também os pareceres de QA e revisão para o mesmo candidato. A aprovação do responsável pelo repositório deve identificar a versão aprovada antes da integração. Push, merge e deploy seguem as autorizações do projeto.

Para separar erros do compilador das restrições de acesso do bundler, execute `node_modules/.bin/ngc.cmd -p tsconfig.json` e `node_modules/.bin/tsc.cmd -p tsconfig.worker.json`. Em um ambiente capaz de executar o esbuild, rode também o build oficial completo.

## Catálogo

O script de extração usa Python com openpyxl 3.1.5 e pypdf 6.21.4. Ele lê as referências locais em `references/msc/` na raiz do repositório, confronta o conjunto integral das 6.119 contas e associações entre Leiaute MSC, PCASP e Conjunto de IC, valida larguras e domínios e classifica as 11.382 instituições nas 317 páginas da tabela. A conferência de instituições considera as colunas IBGE, código Siconfi e instituição. O catálogo inclui os hashes, as edições e as regiões das fontes, as contagens por página e o identificador das regras.

```powershell
python scripts/extract_catalog.py
python scripts/extract_catalog.py --check
```

A opção `--check` regenera em memória e exige identidade byte a byte com `front/src/catalog-2026.json`. O motor exige a versão aprovada e confirma o SHA256 do JSON compacto em UTF-8 com chaves ordenadas, excluindo o próprio campo `version`. O template oficial arquivado tem 6.121 linhas físicas com CRLF, incluindo metadados, guia e 6.119 registros. Na pré-validação com UTF-8 estrito, a leitura desse template para no primeiro byte inválido.

## Corpus sintético e benchmark do motor

```powershell
node scripts/benchmark.mjs
```

O comando grava seis CSVs e o relatório `front/dist/benchmark/motor.json` na árvore do repositório. O relatório registra hashes e contagens, densidade esperada de diagnósticos, distribuição de IC, leituras da memória do processo e quatro medições por amostra. O script verifica os diagnósticos esperados em cada execução. O mesmo corpus serve de entrada para as medições de interface, renderização e responsividade no navegador.
