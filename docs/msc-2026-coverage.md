# Cobertura e lacunas da pré-validação MSC 2026

A auditoria local tem como denominador as dez alíneas de estrutura (a–j) e as oito de conteúdo (a–h) das [Regras de Validação da MSC 2026](../references/msc/2026/2026_Regras_de_Validacao_MSC_24112025.pdf), além dos nove tipos de informação complementar do Anexo II, revisão de 08/07/2026. Uma alínea pode corresponder a várias regras locais. Avisos e critérios de Ranking ficam fora da contagem das validações impeditivas.

| Área auditada | Cobertura local | Lacuna operacional |
| --- | --- | --- |
| Estrutura, a–j | E01–E08 e E10 cobrem a sintaxe, os campos e os pares do CSV, com L01/L02 para leitura e metadados. | A competência é validada no arquivo. A seleção de competência no portal, XBRL GL e o pacote ZIP ficam fora da pré-validação. |
| Conteúdo, a–h | C01–C11 e C13 cobrem conta e IC nos limites abaixo. SAL-EQU-01 e SAL-CONS-01 cobrem equilíbrio e consistência locais. E06 e E09 cobrem formato sem valores negativos e presença de valor. | Validação de conteúdo limitada a Executivos municipais cadastrados. O código PO é conferido em tabela ampla, sem verificar a esfera do PO ou o conjunto de órgãos esperado por ente. |
| Encerramento e comparação | O CSV 2026-13 passa pelas regras genéricas. A comparação histórica é informativa para municípios baianos de fevereiro a dezembro. | Sem confronto dezembro–encerramento, zeragem das contas de resultado, verificação específica das inscrições em RP de dezembro ou cruzamentos com RREO/DCA. |

## Informações complementares

| IC | Regra local | Referência e limite |
| --- | --- | --- |
| PO, FP, DC | C05–C08, além das regras gerais de formato e associação. | Anexo II, abas `Informações Complementares` e `PO`. |
| FR e CO | C09 e C10 conferem os domínios de 2026. | `FR 2026!A7:B9` e `A12:B121`, com 98 códigos principais e três prefixos. `CO 2026!A7:A68`, com 52 códigos. |
| NR | C11 distingue código ausente de código publicado como não valorizável. A verificação de domínio é não aplicável à ocorrência de um código `999` bem formado e ausente. | `NR 2026!H6:K5457`, com 4.504 códigos valorizáveis e 948 não valorizáveis. `J5457` admite desdobramento para PL/LOA. |
| ND | C12 avisa quando o código completo está ausente e informa se o prefixo de seis dígitos consta na referência. | `ND 2026!F8:F1242`, com 1.235 códigos. A lista é uma referência mínima para o De-Para. A normalização de pontuação ocorre na importação da planilha. |
| FS | C13 aponta componente fora do rol como erro. Com ambos publicados, cruzamento incompatível de Encargos Especiais ou reservas gera aviso local, como `01846`. | `FS!A3:B123`, com 29 funções e 117 subfunções, inclusive 601–604. A combinação normativa de Encargos Especiais é função 28 com subfunções 841–847, conforme `FS!A115:B121` e MCASP, 11ª ed., p. 74, § 4.2.2.2. A aba FS lista `99997` e `99999` para reservas. |
| AI | C14 avisa sobre ano zero ou posterior a 2026. C03 continua exigindo quatro dígitos. | `Informações Complementares!B14:F14`. A comparação com o exercício é uma conferência local informativa e não estabelece um ano mínimo. |

O Anexo II e a documentação normativa orientam a conferência local. A aceitação de um arquivo pelo Siconfi depende também das regras do portal e do contexto de transmissão. Os avisos locais de ND, FS e AI têm seção própria na aba Avisos e independem da consulta à API.

Neste ciclo, o extrator, os domínios e os IDs foram atualizados em [extract_catalog.py](../front/scripts/extract_catalog.py), [catalog.ts](../front/src/catalog.ts) e [catalog-2026.json](../front/src/catalog-2026.json). O cálculo e a apresentação estão em [validation.ts](../front/src/validation.ts), [report-presentation.ts](../front/src/report-presentation.ts), [main.ts](../front/src/main.ts) e [app.html](../front/src/app.html).
