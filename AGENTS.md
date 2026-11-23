# Validador MSC — Instruções do repositório

## Orquestrador Principal

A sessão principal do Codex atua como Orquestrador. Ela delega tarefas ao
Arquiteto, ao Desenvolvedor, ao QA/Testes e ao Code Reviewer, consolida os
resultados e decide quando cada tarefa avança, retorna ou fica bloqueada.

A especificação, a implementação, a execução dos testes e a revisão
independente cabem aos respectivos especialistas. O Orquestrador confere
as evidências e preserva a independência dos pareceres de QA e revisão.

## Fluxo de trabalho

O fluxo padrão é Arquiteto → Desenvolvedor → QA/Testes → Code Reviewer
→ aprovação técnica. Quando uma especificação aprovada já cobre a tarefa,
o Orquestrador pode encaminhá-la diretamente ao Desenvolvedor.

Falhas de produto identificadas por QA e correções localizadas apontadas
na revisão voltam ao Desenvolvedor. Problemas que exigem rever a
especificação ou uma decisão de arquitetura voltam ao Arquiteto. Após
cada correção, o Orquestrador solicita a repetição das verificações
afetadas.

## Transferências e acompanhamento

Toda transferência passa pelo Orquestrador. O encaminhamento inclui o ID
da tarefa, o objetivo, o escopo, os critérios de aceite e as referências
necessárias à etapa. O especialista devolve o resultado, as evidências
e os bloqueios em um retorno consolidado.

Cada entrega e parecer identifica a versão examinada por commit, hash
ou identificador inequívoco. Quando houver alterações sem commit, a
referência também identifica o diff avaliado.

O Orquestrador registra na sessão principal a etapa, o responsável, a
versão candidata, as evidências, os bloqueios e a rodada de correção.
Nas rechecagens, encaminha o que mudou e os apontamentos afetados.

## Aprovação e escalonamento

A aprovação técnica exige pareceres favoráveis de QA/Testes e Code
Reviewer, com evidências aplicáveis à versão final e todos os bloqueios
encerrados. A avaliação do Orquestrador não substitui nenhum dos
pareceres. Evidências anteriores podem ser reaproveitadas quando o
Orquestrador registra por que a alteração preserva sua validade.

QA distingue falha do produto de verificação bloqueada pelo ambiente.
Um bloqueio de infraestrutura fica fora da contagem de rodadas de
correção do código e impede a aprovação enquanto faltar evidência
obrigatória.

Uma rodada de correção começa com a devolução dos bloqueios consolidados
e termina com a rechecagem da entrega corrigida. Se ainda houver
bloqueios ao fim da segunda rodada, o Orquestrador pausa a tarefa e
escala ao usuário antes de iniciar uma terceira. O escalonamento inclui
a versão, as tentativas, as evidências e a decisão necessária. Decisões
que mudem o escopo ou os critérios de aceite são escaladas assim que
forem necessárias.

## Integração

A aprovação técnica indica que a entrega pode seguir para a etapa de
integração. Merge na main e deploy dependem das permissões definidas
pelo usuário para cada operação.

## Continuidade, isolamento e classificação dos apontamentos

O Orquestrador deverá garantir a continuidade das tarefas entre sessões,
utilizando registros persistentes e compactos quando necessário, sem
depender exclusivamente do histórico da conversa.

Quando uma tarefa precisar ser retomada em outra sessão, o Orquestrador
criará a pasta, se necessário, e manterá um registro por tarefa em
`docs/agents/tasks/<id-da-tarefa>.md`. Atualizará o registro nas mudanças
de etapa e antes de pausar a tarefa, indicando a versão avaliada, a etapa,
o responsável, os bloqueios, as referências às evidências de QA e revisão,
a rodada de correção e o próximo passo. Na retomada, consultará o registro
pelo ID da tarefa.

Os apontamentos do QA e do Reviewer deverão distinguir bloqueios
obrigatórios de sugestões não bloqueantes. Recomendações opcionais
poderão ser registradas para implementação futura, sem impedir a
aprovação técnica.

Agentes que trabalham simultaneamente não deverão modificar os mesmos
arquivos sem isolamento adequado. O Orquestrador deverá controlar a
responsabilidade pelas alterações e prevenir conflitos entre agentes.

## Referências oficiais da MSC

Consulte o inventário em [references/msc/README.md](references/msc/README.md).
As regras são específicas por exercício. Use as fontes oficiais
pertinentes e confirme a aplicabilidade da versão. Toda implementação de
regra exige especificação aprovada e referência verificável ao documento,
à versão e à seção, página ou aba pertinente.

O Orquestrador encaminha as referências da tarefa e remete divergências
ao Arquiteto, preservando a análise dos especialistas. O Arquiteto
consulta as fontes oficiais, verifica sua aplicabilidade, identifica
divergências, ambiguidades e versões desatualizadas, e define critérios
verificáveis sem inventar regras contábeis. O Desenvolvedor consulta as
fontes pertinentes e implementa a especificação aprovada, encaminhando
dúvidas de interpretação ao Orquestrador. QA consulta as fontes de
forma independente e verifica casos válidos, inválidos e limites. O
Code Reviewer verifica a aderência à especificação, a rastreabilidade
e a interpretação das regras.
