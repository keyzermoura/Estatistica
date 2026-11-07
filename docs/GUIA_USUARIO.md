# Guia do usuário — ValidaMétodo

Este guia é para quem vai **usar** o sistema para validar um método analítico,
mesmo sem formação em estatística. Ele explica o que preencher em cada etapa,
o que o sistema calcula, como interpretar os vereditos e como aprovar e
arquivar uma validação.

> O princípio central: o sistema não “inventa” conformidade. Um resultado só é
> **conforme** ou **não conforme** quando existe um dado numérico e um critério
> de aceitação cadastrado. Sem um dos dois, aparece **não avaliado**.

## 1. Antes de começar

### 1.1 O que você precisa

- Um computador com navegador moderno (Chrome, Edge ou Firefox) e JavaScript
  habilitado.
- Node.js 18 ou superior (recomendado: 20 LTS) para executar o sistema.
- Os dados brutos da validação: identificação do método, faixa de trabalho,
  medições, valores de referência e fontes de incerteza.
- Os critérios de aceitação do método. Se o laboratório ainda não os definiu,
  use as sugestões do sistema como ponto de partida e registre a decisão.

### 1.2 Como abrir o sistema

No computador onde o projeto está instalado:

```bash
npm install
npm run dev
```

Para instalar, verificar tipos, rodar os testes e gerar o build de uma vez:

```bash
npm run setup
```

O navegador abre em `http://localhost:5173`. Para uso contínuo, prefira
`npm run build` + `npm run preview`, que servem a versão otimizada. O sistema
funciona offline depois de carregado; os dados ficam no próprio navegador.

### 1.3 Onde os dados ficam

O banco é um **SQLite real** compilado para WebAssembly e persistido no
IndexedDB do navegador. Ele não sai do computador. Se você limpar os dados do
site, trocar de navegador ou usar outro perfil, o banco não estará lá. Faça
backups em **Configurações → Dados**.

## 2. Visão geral do fluxo

```
Painel → Nova validação → 7 etapas → Relatório → Assinaturas → Aprovação
         1 Método
         2 Parâmetros
         3 Delineamento
         4 Coleta
         5 Análise
         6 Relatório
         7 Auditoria
```

Cada etapa salva o que você preencheu e registra o evento na trilha de
auditoria. Você pode navegar pelas etapas pelo menu lateral do fluxo.

## 3. Painel

O painel mostra todas as validações locais, o status, o progresso, o número de
medições e a data da última atualização.

- **Nova validação**: cria um processo a partir de um método já cadastrado.
- **Abrir**: entra no fluxo da validação.
- **Duplicar**: cria uma cópia para reutilizar a estrutura em outro método.
- **Excluir**: remove a validação e os dados associados. Use com cuidado; a
  exclusão também fica registrada enquanto o banco existir.

Ao abrir uma validação já aprovada, o sistema entra em modo somente leitura e
mostra o selo **bloqueada**. Para editar, é necessário criar uma nova versão.

## 4. Etapa 1 — Método

Preencha a identificação que aparecerá no relatório:

| Campo | O que informar |
|---|---|
| Código | Código interno do método (ex.: `HPLC-CAF-01`) |
| Nome | Nome descritivo do método |
| Tipo | Quantitativo, qualitativo, dimensional/físico, microbiológico ou outro |
| Tipo de validação | Completa, parcial ou verificação de método normalizado |
| Unidade | Unidade do resultado (ex.: `mg/L`) |
| Equipamento principal | Equipamento e condições relevantes |
| Faixa mínima / máxima | Faixa de trabalho declarada |
| Norma / referência | Norma ou documento que orienta a validação |
| Descrição | Resumo do princípio analítico |
| Título da validação | Nome do processo no painel e no relatório |
| Objetivo | O que a validação pretende demonstrar |
| Escopo | Matriz, analito, faixa e limitações |
| Responsável / revisor / aprovador | Nomes que constarão no relatório |

Em **Critérios de aceitação do método**, cadastre os limites que serão usados
para julgar cada parâmetro. Você pode:

- clicar em **Sugerir métricas** para carregar sugestões iniciais;
- editar o operador (`≥`, `≤`, `entre`), o limite e a unidade;
- adicionar mais de um critério por parâmetro;
- remover critérios que não se aplicam.

**Os critérios são decisões do laboratório.** As sugestões não são regras
universais. Se você mudar um limite, isso fica registrado e o relatório passa a
usar o novo valor. Não deixe um critério com limite `0` por engano: isso pode
reprovar resultados válidos.

Clique em **Salvar** ou **Salvar e continuar**. O sistema exige código, nome e
título.

## 5. Etapa 2 — Parâmetros

Marque os parâmetros que farão parte desta validação. A seleção sugerida
depende do tipo de método, mas você decide.

Para cada parâmetro selecionado:

- escreva uma **justificativa** curta (por que ele é relevante e como será
  avaliado);
- confira os **critérios específicos** da validação. Eles se somam aos critérios
  globais do método.

Parâmetros disponíveis:

- Seletividade / especificidade
- Linearidade
- Faixa de trabalho
- Limites de detecção e quantificação (LD/LQ)
- Repetibilidade
- Precisão intermediária
- Reprodutibilidade
- Exatidão / tendência
- Robustez
- Incerteza de medição

Se um parâmetro não tiver dados suficientes na etapa de análise, ele ficará
**não avaliado** — não será reprovado automaticamente. O relatório mostrará o
motivo.

## 6. Etapa 3 — Delineamento

O delineamento traduz seus objetivos estatísticos em um plano executável.

### 6.1 Premissas

| Campo | Significado | Padrão |
|---|---|---|
| Confiança | Confiança dos intervalos | 95% |
| Poder | Probabilidade de detectar um efeito real | 80% |
| α | Risco de falso positivo | 5% |
| σ esperado | Variabilidade do método | 0,5 (troque pelo piloto) |
| Efeito mínimo | Diferença que você precisa detectar | 0,5 |
| Margem | Margem de equivalência/tolerância | 0,5 |
| Erro relativo de s | Precisão desejada para estimar o desvio | 20% |
| Razão de variâncias | σ₁/σ₂ para comparar precisões | 1,5 |
| Razão entre laboratórios | σ_L/σ_r para ISO 5725 | 1,0 |

> **σ = 0,5 é apenas um valor inicial.** Use o desvio-padrão de um estudo
> piloto, de dados históricos ou de um material de referência. O sistema avisa
> quando o valor padrão não foi substituído.

### 6.2 Desenho

Escolha o desenho que corresponde à sua execução:

- **CRD**: completamente aleatorizado, um fator.
- **Blocos**: dias ou outra condição como bloco.
- **Fatorial**: dois ou mais fatores em níveis.
- **Aninhado**: lotes e amostras dentro de lotes.
- **Cruzado**: analista × dia × equipamento (precisão intermediária).
- **ISO 5725-2**: laboratórios × réplicas × níveis.

Informe níveis, analistas/laboratórios, dias, equipamentos, lotes, amostras,
réplicas e a semente. A semente garante que a ordem aleatorizada seja
reproduzível: mesma semente → mesma sequência.

### 6.3 O que o sistema calcula

- **n por parâmetro**, com fórmula, poder alcançado e referência;
- **total recomendado** (o maior n entre os parâmetros, no mínimo 6);
- **plano de execução** com a ordem aleatorizada;
- **curva de poder** e precisão do IC;
- **resumo em linguagem simples** e **avisos**.

Se você marcar **substituir total manualmente**, o plano usa o valor informado,
mas os cálculos por parâmetro continuam visíveis. Use essa opção com
justificativa.

Clique em **Calcular delineamento** e depois em **Salvar**. Se alterar qualquer
premissa depois de salvar, o sistema marca o delineamento como desatualizado;
recalcule antes de seguir.

## 7. Etapa 4 — Coleta

### 7.1 Formulário

A tabela permite adicionar, editar e remover medições. Cada linha tem:

- **Ordem**: sequência de execução (pode vir do plano);
- **Nível**: concentração, nível ou identificador do grupo;
- **Analista/Lab**: analista ou laboratório;
- **Dia**, **Equipamento**, **Lote**, **Amostra**, **Réplica**;
- **Valor**: resultado numérico;
- **Referência**: valor nominal, fortificado ou de material de referência;
- **Texto**: resultado qualitativo, quando aplicável;
- **Notas**.

Para repetibilidade e precisão, o **nível** é o agrupamento principal. Para
exatidão, informe a **Referência**; se ela estiver vazia, o sistema tenta usar
um nível numérico como referência. Para LD/LQ por brancos, use um nível chamado
`branco`, `blank` ou `0`.

### 7.2 Importação

1. Clique em **Modelo** para baixar um XLSX já com a ordem do delineamento.
2. Preencha as colunas `Valor`, `Referência` e `Notas`.
3. Clique em **Importar** e selecione o arquivo `.xlsx`, `.xls` ou `.csv`.
4. Revise as linhas na tela e clique em **Salvar medições**.

A primeira aba da planilha é lida. Os cabeçalhos aceitam variações com ou sem
acento (ex.: `Nível`, `Nivel`, `Concentração`; `Analista/Lab`, `Laboratório`,
`Lab`; `Valor`, `Resultado`, `Resposta`; `Referência`, `Fortificado`,
`Nominal`). Números com vírgula decimal são aceitos. Linhas sem valor e sem
texto são ignoradas.

### 7.3 Verificações automáticas

Antes de salvar, o sistema mostra:

- medições numéricas e ausentes;
- valores fora da faixa declarada;
- níveis com número desigual de réplicas;
- grupos com menos de 2 réplicas;
- combinações do plano ainda não coletadas.

Nada é corrigido automaticamente. Se um valor fora da faixa for legítimo,
registre a justificativa nas notas.

## 8. Etapa 5 — Análise

Esta etapa calcula os resultados a partir dos dados salvos. Cada tabela mostra
**métrica, fórmula, valor, critério e veredito**.

### 8.1 Visão geral

No topo aparecem n usado, média, desvio-padrão, CV, IC e o **veredito global**.
Também são exibidos avisos de normalidade, homogeneidade e tamanho de amostra.

### 8.2 Orçamento de incerteza (GUM)

Cadastre as fontes de incerteza:

| Campo | Exemplo |
|---|---|
| Fonte | Repetibilidade, calibração da balança, pureza do padrão, tendência residual |
| Tipo | A (estatística, a partir de réplicas) ou B (informação externa) |
| Distribuição | Normal, retangular, triangular, forma U ou sem distribuição |
| Valor | Incerteza padrão (Tipo A) ou semi-amplitude/incerteza expandida (Tipo B) |
| Divisor | 1 (normal), √3 (retangular), √6 (triangular), √2 (forma U) |
| Sensibilidade | Coeficiente de sensibilidade `c_i` (padrão 1) |
| Graus de liberdade | `n−1` para Tipo A; `∞`/vazio quando desconhecido |

O sistema calcula `u_c`, `ν_eff`, `k` e `U`. Se faltarem graus de liberdade,
adota `k = 2` e avisa. Clique em **Salvar orçamento** antes de sair.

### 8.3 Resultados por parâmetro

- **Linearidade**: R², falta de ajuste e p do declive, com gráfico e resíduos.
- **Faixa de trabalho**: menor e maior nível observados. O sistema não declara
  a faixa como conforme; ele mostra a faixa coberta e pede que você confira o
  escopo.
- **LD/LQ**: por brancos (se houver ≥ 3) ou pela curva (≥ 3 pontos).
- **Repetibilidade**: `s_r` e CV dentro dos níveis.
- **Precisão intermediária**: componente entre analista × dia × equipamento.
- **Reprodutibilidade**: ISO 5725-2, com `s_r`, `s_L`, `s_R`, `r` e `R`.
- **Exatidão**: tendência, recuperação e TOST. O TOST é exibido como apoio; os
  critérios cadastrados decidem o veredito.
- **Robustez**: efeito padronizado dos fatores analista, dia, equipamento e
  lote.
- **Incerteza**: `U` e `U_rel`.
- **Seletividade**: não é calculada automaticamente; o sistema explica o
  experimento necessário e mantém o parâmetro como não avaliado até que você
  registre a evidência no relatório.

### 8.4 Congelar resultados

Clique em **Congelar resultados** para gravar uma cópia dos resultados da versão
atual na tabela `analyses`. Isso preserva o que foi analisado mesmo que os
dados mudem depois (desde que a validação ainda não esteja aprovada). O
relatório sempre usa a análise mais recente; para uma evidência formal, gere o
relatório depois de congelar.

## 9. Etapa 6 — Relatório

### 9.1 Configuração

Ajuste título, laboratório, endereço, acreditação, logo, introdução, rodapé e
versão do documento. Você pode incluir dados brutos, fórmulas e gráficos nos
exports.

### 9.2 Gerar a prévia

Clique em **Gerar prévia do relatório**. O sistema:

- compõe o documento com identificação, objetivo, escopo, delineamento,
  resultados, fórmulas, critérios, vereditos, incerteza, conclusão e auditoria;
- calcula um **hash SHA-256** do conteúdo;
- grava o relatório da versão atual;
- permite exportar.

Se você alterar dados depois de gerar a prévia, gere novamente. A prévia
anterior deixa de representar a versão atual.

### 9.3 Assinaturas eletrônicas

Há três papéis, nesta ordem obrigatória:

1. **Elaboração** — responsável técnico pela execução.
2. **Revisão** — revisor independente.
3. **Aprovação** — aprovador do laboratório.

Digite o nome completo e clique em **Assinar**. O nome, o instante e o papel
ficam gravados no relatório e na auditoria. O sistema impede revisar antes de
elaborar e aprovar antes de revisar.

### 9.4 Exportações

| Formato | Conteúdo |
|---|---|
| DOCX | Relatório completo com tabelas, gráficos e assinaturas |
| PDF | Prévia paginada com cabeçalho/rodapé e numeração |
| Pacote de evidências (ZIP) | Dados, resultados JSON, relatório, snapshot SQLite e manifesto com hashes |
| HTML | Prévia autônoma para visualização |
| Resultados JSON | Métricas e resultados estruturados |
| Dados XLSX | Medições e plano de execução |

Verifique o arquivo baixado antes de arquivar. O ZIP de evidências é o pacote
mais completo para auditoria.

## 10. Etapa 7 — Auditoria e aprovação

### 10.1 Antes de aprovar

Confira a lista de pré-requisitos:

- método e identificação registrados;
- ao menos um parâmetro selecionado;
- delineamento salvo;
- medições registradas;
- todos os parâmetros avaliados (quando aplicável);
- relatório gerado para a versão atual;
- relatório com as três assinaturas.

**Parâmetros não conformes não impedem a aprovação.** A aprovação registra a
conclusão do laboratório; o relatório mostrará a não conformidade. O sistema
avisa, mas não esconde o resultado.

### 10.2 Aprovar

Clique em **Aprovar validação**, informe uma justificativa/decisão e confirme.
O sistema, em uma única transação:

1. congela o relatório com `locked = true`;
2. marca a validação como `approved` e `locked = true`;
3. registra o evento na auditoria;
4. cria um snapshot imutável em `validation_versions`.

Depois disso, todas as escritas — parâmetros, delineamento, medições,
incerteza, análises, relatório e assinaturas — são rejeitadas pelo repositório.

### 10.3 Nova versão

Se precisar corrigir algo depois da aprovação:

1. clique em **Criar nova versão**;
2. informe a justificativa (obrigatória);
3. confirme.

O sistema arquiva um snapshot da versão atual, incrementa a versão, volta ao
início do fluxo, desbloqueia a edição e mantém os dados existentes. O relatório
da versão nova começa vazio; a versão anterior continua congelada no histórico.

### 10.4 Snapshot manual

**Snapshot atual** cria uma cópia do estado no momento, sem alterar o status.
Use antes de uma mudança importante ou para arquivar uma revisão intermediária.

## 11. Configurações

- **Laboratório**: nome, endereço, acreditação, logo, responsáveis e textos
  padrão do relatório.
- **Aparência**: tema claro/escuro.
- **Dados**:
  - **Exportar banco SQLite**: baixa o arquivo `.sqlite` com todas as tabelas.
  - **Importar backup**: substitui o banco local pelo arquivo escolhido.
  - **Restaurar demonstração**: recria o método e a validação de exemplo.
  - **Limpar dados**: apaga o banco local (confirme antes).

O arquivo `.sqlite` pode ser aberto em DB Browser for SQLite, DBeaver ou
qualquer ferramenta SQLite. O ZIP de evidências também inclui uma cópia do
banco.

## 12. Como interpretar os vereditos

| Veredito | Significado |
|---|---|
| **Conforme** | Todas as métricas com critério cadastrado atendem ao limite |
| **Não conforme** | Pelo menos uma métrica com critério falha |
| **Atenção** | Avaliação parcial: parte das métricas tem dado, parte não |
| **Não avaliado** | Falta dado numérico ou critério; o sistema não conclui |

O veredito global segue a mesma lógica: qualquer não conforme → não conforme;
todos conformes → conforme; qualquer não avaliado → não avaliado; caso
contrário → atenção.

## 13. Glossário rápido

- **α (alfa)**: probabilidade de concluir que há diferença quando não há.
- **Poder (1−β)**: probabilidade de detectar uma diferença real.
- **σ (sigma)**: desvio-padrão do processo.
- **CV**: coeficiente de variação, `100·s/média`.
- **Repetibilidade**: variação dentro das mesmas condições (mesmo analista,
  dia e equipamento).
- **Precisão intermediária**: variação entre analistas, dias ou equipamentos.
- **Reprodutibilidade**: variação entre laboratórios.
- **Tendência (bias)**: diferença média entre medido e referência.
- **Recuperação**: percentual do valor fortificado recuperado.
- **LD/LQ**: menor concentração detectável/quantificável com confiança.
- **GUM**: guia para expressão da incerteza de medição.
- **u_c**: incerteza padrão combinada.
- **U**: incerteza expandida, `k·u_c`.
- **TOST**: teste de equivalência em duas caudas.
- **ISO 5725-2**: norma para precisão de métodos por experimentos
  interlaboratoriais.
- **Snapshot**: cópia imutável do processo em uma versão.

## 14. Problemas comuns

### O navegador não abre o sistema

Confirme que o terminal mostra `Local: http://localhost:5173`. Se a porta estiver
ocupada, rode `npm run dev -- --port 5174`.

### No Windows, `npm` não executa no PowerShell

Use `cmd /c npm run dev`, `cmd /c npm test` ou `npm.cmd run dev`. A política de
execução do PowerShell pode bloquear `npm.ps1`.

### Os dados desapareceram

Você pode ter limpado os dados do site, trocado de navegador/perfil ou usado
outra origem (`localhost` e `127.0.0.1` têm bancos separados). Restaure o
backup em **Configurações → Dados**.

### O relatório está desatualizado

Gere a prévia novamente. O relatório é um retrato do momento; ele não se
atualiza sozinho.

### A validação está bloqueada

Isso é intencional após a aprovação. Use **Criar nova versão** na etapa de
Auditoria. A versão anterior permanece no histórico.

### Um parâmetro está “não avaliado”

Verifique se há dados numéricos suficientes e se existe critério para a métrica.
A própria tela explica o motivo e o que fazer.

## 15. Boas práticas

- Defina os critérios **antes** de olhar os resultados.
- Use dados piloto para σ, efeito e margem; não confie no padrão 0,5.
- Registre a ordem de execução e a semente da aleatorização.
- Não remova outliers sem justificativa técnica documentada.
- Congele os resultados e gere o relatório somente quando os dados estiverem
  revisados.
- Assine na ordem elaboração → revisão → aprovação.
- Exporte o ZIP de evidências e o `.sqlite` ao final.
- Mantenha o relatório aprovado e o snapshot no mesmo local do processo físico.
