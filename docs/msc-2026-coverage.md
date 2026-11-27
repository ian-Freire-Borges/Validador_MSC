# Cobertura e lacunas da pré-validação MSC 2026

As [Regras de Validação da MSC 2026, pp. 2–6](../references/msc/2026/2026_Regras_de_Validacao_MSC_24112025.pdf#page=2) enumeram 18 alíneas, dez de estrutura (a–j) e oito de conteúdo (a–h). Dessas, 17 se aplicam ao CSV. A alínea f de estrutura é exclusiva do XBRL GL. O Anexo II aplicável ao exercício é a revisão de 08/07/2026. O tratamento da MSC totalmente zerada detalha a alínea h de conteúdo. Avisos históricos e critérios de Ranking ficam fora dessa contagem.

A versão publicada `a1b856c` concluiu o escopo mensal de janeiro a dezembro de 2026 da pré-validação local de CSV. A verificação registrada para essa versão passou com 67 testes Node e 18 testes Playwright. Em mídia de impressão, foram verificados 26 IDs locais, incluindo verificações associadas às referências oficiais e proteções técnicas da pré-validação. Vários IDs podem corresponder à mesma alínea do PDF. [Testes de validação](../front/tests/validation.test.mjs) · [Testes de interface e impressão](../front/tests/e2e/validation-report.spec.mjs)

| Área auditada | Cobertura local | Lacuna operacional |
| --- | --- | --- |
| Estrutura, a–j | E01–E08 e E10 cobrem a sintaxe, os campos e os pares do CSV, com L01/L02 para leitura e metadados. E02 e E04 validam a instituição e a competência declaradas no arquivo. | O CSV isolado não permite confirmar a instituição transmissora ou a competência selecionada no portal. XBRL GL e o pacote ZIP ficam fora da pré-validação. |
| Conteúdo, a–h | C01–C11 e C13 cobrem conta e IC nos limites abaixo. SAL-EQU-01 e SAL-CONS-01 cobrem equilíbrio e consistência locais. E06 e E09 cobrem formato sem valores negativos e presença de valor. | Validação de conteúdo limitada a Executivos municipais cadastrados. O código PO é conferido em tabela ampla, sem verificar a esfera do PO ou o conjunto de órgãos esperado por ente. |
| Encerramento 2026-13 | O CSV passa pelas regras genéricas. | **Pendente e postergado.** O confronto dezembro–encerramento e a zeragem das contas de resultado permanecem como requisitos de conteúdo com as limitações descritas abaixo. |
| Competências mensais 2026-01 a 2026-12 | E09 inclui a MSC totalmente zerada, e as comparações anterior e posterior são informativas para municípios baianos no intervalo aplicável. | A avaliação de inscrições em RP de dezembro depende dos insumos descritos abaixo. Os cruzamentos com RREO/DCA ficam fora do escopo mensal fechado. |

## Conclusões da auditoria das lacunas

A confirmação da instituição transmissora e da competência selecionada no portal, a verificação de contas omitidas e a avaliação das inscrições em restos a pagar de dezembro são limitações documentadas, sem pendências de implementação no escopo mensal.

| Item | Estado | Evidência | Limitação |
| --- | --- | --- | --- |
| Instituição e competência mensais | E02 e E04 verificam os metadados declarados no CSV. A confirmação do destino efetivo depende do contexto da transmissão. | Regras de Validação, p. 2, alíneas a–b, e Anexo I, p. 5. | O CSV isolado não identifica a instituição transmissora nem a competência selecionada no portal. |
| MSC com todos os valores zerados | E09 identifica uma MSC mensal inteiramente zerada e distingue esse caso de ausência de valores válidos ou de uma verificação inconclusiva. | O [comunicado do Siconfi sobre validações de carregamento](https://siconfi.tesouro.gov.br/siconfi/pages/public/conteudo/conteudo.jsf?id=43503) confirma o caráter impeditivo. | Um registro zero pode coexistir com valores positivos. Saldos líquidos que se anulam também podem resultar de valores positivos. |
| PO de outra esfera | Critério de Ranking documentado. | Regras de Validação, p. 7, seção de Ranking. A validação de conteúdo de PO nas pp. 4–5 trata presença e padrão. | As fontes examinadas não demonstram que o teste por esfera seja impeditivo no carregamento. |
| Órgãos ou contas omitidos | Limite da verificação de completude com CSV isolado. | Regras de Validação, pp. 4–5 e 7. O Ranking avalia o detalhamento esperado de PO. A exigência de reportar contas com saldo e a possibilidade de omitir registros zero constam das referências gerais. | A conclusão exige uma relação independente dos órgãos e das contas com saldo. O CSV isolado não comprova omissão indevida nem a existência de bloqueio específico no carregamento. |
| Inscrições em RP em dezembro | Requisito de conteúdo documentado. | [Anexo I, p. 14](../references/msc/2026/2026_Anexo_I_Portaria_STN_642_Regras_Gerais_MSC.pdf#page=14), contas da classe 6 para RPNP e RPP. | O insumo disponível não demonstra se havia valores sujeitos a inscrição. As fontes consultadas não comprovam um bloqueio específico de carregamento para essa ausência. |
| Encerramento 2026-13 | Validações gerais implementadas. Vínculo com dezembro e zeragem de contas de resultado documentados como requisitos de conteúdo. | [Anexo I, pp. 13–14](../references/msc/2026/2026_Anexo_I_Portaria_STN_642_Regras_Gerais_MSC.pdf#page=13), seção Tipos de MSC. | As fontes examinadas não demonstram bloqueio específico do portal por esses requisitos. Um arquivo de dezembro compatível está indisponível para o confronto. |

## Informações complementares

| IC | Regra local | Referência e limite |
| --- | --- | --- |
| PO, FP, DC | C05–C08, além das regras gerais de formato e associação. | Anexo II, abas `Informações Complementares` e `PO`. |
| FR e CO | C09 e C10 conferem os domínios de 2026. | `FR 2026!A7:B9` e `A12:B121`, com 98 códigos principais e três prefixos. `CO 2026!A7:A68`, com 52 códigos. |
| NR | C11 distingue código ausente de código publicado como não valorizável. A verificação de domínio é não aplicável à ocorrência de um código `999` bem formado e ausente. | `NR 2026!H6:K5457`, com 4.504 códigos valorizáveis e 948 não valorizáveis. `J5457` admite desdobramento para PL/LOA. |
| ND | C03 exige oito dígitos e C04 verifica a associação com a conta. | `ND 2026!F8:F1242` é uma referência mínima para o De-Para. A lista e os prefixos não são conferidos pelo Validador. |
| FS | C13 aponta componente fora do rol como erro. A função e a subfunção são verificadas individualmente. | `FS!A3:B123`, com 29 funções e 117 subfunções, inclusive 601–604. O Validador não cruza as combinações de Encargos Especiais e reservas. As referências são `FS!A115:B121` e MCASP, 11ª ed., p. 74, § 4.2.2.2. |
| AI | C03 exige quatro dígitos e C04 verifica a associação com a conta. | `Informações Complementares!B14:F14`. O Validador não compara o ano com o exercício nem impõe faixa de anos. |

## Mapa de testes da versão mensal publicada

Os links apontam para os arquivos de teste da verificação local. O mapa relaciona as alíneas aos cenários de referência e registra os limites que exigem evidência externa.

| Alínea do PDF | Regra local | Cenários positivos e negativos |
| --- | --- | --- |
| Estrutura a, p. 2 | E02 | Executivo municipal cadastrado e código inexistente ou fora do escopo. [Validação](../front/tests/validation.test.mjs) |
| Estrutura b, p. 2 | E04 | Janeiro e dezembro válidos e mês fora do formato ou período suportado. [Validação](../front/tests/validation.test.mjs) |
| Estrutura c, p. 3 | E03/E05 | 16 colunas e registro com colunas a menos ou a mais. [Validação](../front/tests/validation.test.mjs) |
| Estrutura d, p. 3 | E03 | Cabeçalho canônico, ordem trocada e campo ausente. Seis pares conforme Anexo II e template de 2026. [Validação](../front/tests/validation.test.mjs) |
| Estrutura e, p. 3 | E01 | Ponto e vírgula entre campos e linha com separação ou aspas inválidas. [Validação](../front/tests/validation.test.mjs) |
| Estrutura f, p. 3 | Fora do escopo CSV | Boa formação do XBRL GL. |
| Estrutura g, p. 4 | E06 | Decimal com ponto e entradas com vírgula, sinal ou separador de milhares. [Validação](../front/tests/validation.test.mjs) |
| Estrutura h, p. 4 | E07 | Os três tipos publicados e tipo desconhecido. [Validação](../front/tests/validation.test.mjs) |
| Estrutura i, p. 4 | E08 | Natureza C ou D e natureza inválida ou ausente. [Validação](../front/tests/validation.test.mjs) |
| Estrutura j, p. 4 | E10 | Par completo, par vazio e par incompleto em posições distintas. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo a, p. 4 | C01 | Conta de último nível ativa e conta inválida; omissão de conta com saldo requer fonte externa. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo b, p. 5 | C02/C03 e domínios | Tipo/código válidos, tipo desconhecido e formato incorreto; domínio válido e fora da lista onde aplicável, com exceção de NR 999 e limites de ND, FS e AI descritos acima. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo c, p. 5 | C04 | Associação conta–IC permitida e não permitida. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo d, p. 5 | C05/C08 | Registro com PO válido, registro sem PO e código fora da tabela. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo e, pp. 5–6 | SAL-EQU-01 | Equilíbrio e diferença em cada natureza da informação, sem compensação entre naturezas. [Saldos locais](../front/tests/balances.test.mjs) |
| Conteúdo f, p. 6 | SAL-CONS-01 | Saldo inicial mais movimento compatível ou incompatível com saldo final por conta e IC. [Saldos locais](../front/tests/balances.test.mjs) |
| Conteúdo g, p. 6 | E06/E09 | Valor não negativo válido, valor negativo e valor ausente. [Validação](../front/tests/validation.test.mjs) |
| Conteúdo h, p. 6 | E09 | CSV íntegro com valor positivo, zeros junto de positivo, cabeçalho sem valores e matriz inteiramente zerada. Incluir decimais muito pequenos, zero em grafias válidas, positivos que se anulam no saldo e arquivo inválido ou truncado. [Validação](../front/tests/validation.test.mjs) · [Interface e impressão](../front/tests/e2e/validation-report.spec.mjs) |

Na interface, verificar a distinção entre Estrutura e Conteúdo na aba **Resultado**, a localização dos erros e a impressão de todos os erros, inclusive E09. A impressão exclui as duas direções do histórico. Os testes do Worker devem exercitar conclusão normal, erro de leitura, erro inesperado de validação, cancelamento da leitura em andamento e nova validação bem-sucedida. [Testes do Worker](../front/tests/worker.test.mjs) · [Interface e impressão](../front/tests/e2e/validation-report.spec.mjs)

## Comparação histórica

A versão publicada preserva a comparação do saldo inicial do CSV com o saldo final do mês anterior e compara o saldo final do CSV com o saldo inicial do mês seguinte. A direção posterior fica disponível somente depois de concluir todas as classes e obter registros válidos em pelo menos uma. Uma consulta completa e vazia indica ausência de registros na API no escopo consultado. Uma classe incompleta ou com falha deixa a direção posterior inconclusiva e impede o uso de resultados provisórios. Janeiro dispensa a direção anterior e dezembro dispensa a posterior. Não há comparação entre exercícios ou para 2026-13. [Comunicado do Tesouro sobre continuidade](https://siconfi.tesouro.gov.br/siconfi/pages/public/conteudo/conteudo.jsf?id=54103)

Verificar as duas direções, os filtros de mês e tipo de saldo, a preservação do resultado anterior diante de falha posterior, uma referência posterior íntegra com dados, resposta vazia, falha em página posterior, isolamento de chave ambígua e troca de CSV com resposta tardia. Preservar o rótulo do zero inferido pelo Validador, as condições de sua aplicação e a separação entre Resultado, Avisos e impressão. [Comparação mensal](../front/tests/siconfi-monthly-balances.test.mjs) · [Consulta e paginação](../front/tests/siconfi-history.test.mjs) · [Interface e impressão](../front/tests/e2e/validation-report.spec.mjs)

Neste ciclo, o extrator, os domínios e os IDs foram atualizados em [extract_catalog.py](../front/scripts/extract_catalog.py), [catalog.ts](../front/src/catalog.ts) e [catalog-2026.json](../front/src/catalog-2026.json). O cálculo e a apresentação estão em [validation.ts](../front/src/validation.ts), [report-presentation.ts](../front/src/report-presentation.ts), [main.ts](../front/src/main.ts) e [app.html](../front/src/app.html).
