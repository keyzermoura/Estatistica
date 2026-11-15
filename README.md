# ValidaMétodo

Sistema web **offline-first** para validação de métodos analíticos,
dimensionais, físicos e qualitativos. Combina um fluxo guiado de sete etapas,
delineamento amostral estatístico, análise auditável, orçamento de incerteza
(GUM) e relatório exportável em DOCX, PDF e pacote de evidências.

O princípio central: **nenhum resultado é declarado conforme sem dado válido
e critério de aceitação cadastrado**. Quando falta um dos dois, o veredito é
**não avaliado**. Nenhum outlier é removido automaticamente.

## Recursos

- Painel de validações com status, progresso, medições e versionamento.
- Fluxo em 7 etapas: método, parâmetros, delineamento, coleta, análise,
  relatório e auditoria.
- Delineamento com poder estatístico, tamanho de amostra por parâmetro,
  aleatorização reproduzível (semente registrada) e plano de execução.
- Análise com fórmula, valor, critério e veredito em cada métrica.
- Estatística descritiva, normalidade, homogeneidade, ANOVA, ISO 5725-2,
  regressão/linearidade, LD/LQ, tendência/recuperação/TOST, robustez e GUM.
- **Cinco perfis de método**: analítico, dimensional, físico destrutivo, físico
  não destrutivo e atributo, cada um com catálogo de parâmetros, critérios
  sugeridos e análises próprias.
- **Perfil físico destrutivo** com Gage R&R aninhado (operador > amostra >
  corpo de prova) e verificação opcional de homogeneidade do lote; **perfil não
  destrutivo** com Gage R&R cruzado e regressão de covariáveis ambientais.
- **Biblioteca de templates normativos** (ABNT NBR 13904/USP `<881>`, ANVISA
  RDC 166/ICH Q2(R2), ISO/IEC 17025/DOQ-CGCRE-008, AIAG MSA/VDA 5 e outros)
  para criar método e validação pré-configurados em um clique.
- **Pacotes avançados**: EMP de Wheeler, `C_g/C_gk` (VDA 5), CLSI EP17/Probit,
  perfil de exatidão SFSTP, Passing–Bablok/Deming/Bland–Altman, Monte Carlo
  (JCGM 101), Mandel/WLS, incerteza Top-Down/UfS e conformidade bayesiana
  (JCGM 106).
- Concordância de atributo para métodos qualitativos: kappa de Cohen/Fleiss,
  concordância intra e interavaliadores, eficácia, FAR, FRR e cobertura de
  referência, com itens limítrofes e códigos cegados.
- Coleta manual, importação de XLSX/CSV e exportação de dados.
- Relatório com hash SHA-256, três assinaturas eletrônicas e bloqueio após a
  aprovação.
- Snapshots imutáveis por versão; nova versão reabre a edição preservando o
  histórico.
- Persistência local em SQLite (WebAssembly) sobre IndexedDB, sem backend.

## Stack

| Camada | Tecnologia |
|---|---|
| Interface | React 18 + TypeScript + Vite |
| Estilos | Tailwind CSS |
| Gráficos | Recharts |
| Persistência | SQLite compilado para WebAssembly (`sql.js`) + IndexedDB |
| Exportação | DOCX (`docx`), PDF (`jspdf`), XLSX (`xlsx`), ZIP (`jszip`) |
| Testes | Vitest |
| Estatística | Motor próprio em TypeScript, sem biblioteca externa |

## Requisitos

- Node.js 18 ou superior (recomendado: 20 LTS)
- Navegador moderno com JavaScript habilitado (Chrome, Edge ou Firefox)

## Instalação

```bash
npm install
npm run dev
```

O Vite inicia o sistema em `http://localhost:5173`. Abra o endereço no
navegador (ou use `npm start` para abrir automaticamente).

Para instalar, verificar tipos, rodar os testes e gerar o build em um único
comando:

```bash
npm run setup
```

> **Windows/PowerShell:** se `npm.ps1` estiver bloqueado pela política de
> execução, use `npm.cmd run setup`, `cmd /c npm run dev` ou ajuste a política
> do PowerShell.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com recarga |
| `npm run setup` | Instala dependências, verifica tipos, testa e gera o build |
| `npm run typecheck` | Verificação de tipos (`tsc -b`) |
| `npm test` | Testes de referência do núcleo estatístico |
| `npm run test:watch` | Testes em modo observação |
| `npm run test:e2e` | Testes de ponta a ponta no Chromium (Playwright) |
| `npm run build` | Verificação de tipos + build de produção em `dist/` |
| `npm run preview` | Serve o build de produção localmente |
| `npm start` | Inicia o servidor de desenvolvimento e abre o navegador |

### Testes de ponta a ponta

Os testes E2E usam Chromium real e um banco novo (IndexedDB) por contexto. Na
primeira execução, instale o navegador:

```bash
npx playwright install chromium
npm run test:e2e
```

O Playwright sobe o Vite em `http://localhost:4173` automaticamente. Em caso de
falha, screenshots e traces ficam em `test-results/` e o relatório HTML em
`playwright-report/` (ambos ignorados pelo Git).

## Fluxo de uso

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

1. **Método**: identificação, faixa, referências normativas e critérios de
   aceitação.
2. **Parâmetros**: seleção do checklist, justificativas e critérios
   específicos (substituem os globais da mesma métrica).
3. **Delineamento**: premissas estatísticas, n por parâmetro, poder, plano e
   ordem aleatorizada.
4. **Coleta**: formulário, importação de planilha e verificações automáticas.
5. **Análise**: resultados por parâmetro e orçamento de incerteza.
6. **Relatório**: prévia, configuração, assinaturas e exportações.
7. **Auditoria**: trilha de eventos, snapshots, aprovação, bloqueio e nova
   versão.

## Motor estatístico

O motor é implementado em **TypeScript próprio** em `src/stats/`, sem
dependência de runtime como SciPy, R, jStat ou similar. As distribuições
(normal, t, χ², F e não centrais), as inversas e os testes são calculados
localmente para garantir reprodutibilidade e funcionamento offline.

| Arquivo | Conteúdo |
|---|---|
| `distributions.ts` | funções gama/beta, normal, t, χ², F, não centrais e inversas |
| `descriptive.ts` | média, variância, quantis, IC, assimetria, curtose |
| `sampleSize.ts` | poder e tamanho de amostra (t, TOST, razão de variâncias, ANOVA) |
| `design.ts` | planos de execução, aleatorização e curva de poder |
| `outliers.ts` | Grubbs, Cochran, Hampel |
| `normality.ts` | Shapiro–Wilk, Anderson–Darling, Jarque–Bera |
| `variance.ts` | F, Bartlett, Levene/Brown–Forsythe |
| `anova.ts` | ANOVA de um e dois fatores, Welch, componentes de variância |
| `iso5725.ts` | precisão por ISO 5725-2, Mandel h/k |
| `regression.ts` | OLS, WLS, falta de ajuste, LD/LQ |
| `bias.ts` | tendência, recuperação, TOST, proficiência, tolerância |
| `attribute.ts` | Cohen/Fleiss kappa, concordância intra/inter, FAR/FRR, IC de Wilson |
| `attribute-data.ts` | mapeamento das medições para o estudo de atributo e diagnósticos |
| `uncertainty.ts` | GUM, Welch–Satterthwaite, incerteza expandida, Top-Down/UfS |
| `nested.ts` | ANOVA aninhada 3 níveis, Gage R&R destrutivo e homogeneidade do lote |
| `gagerr.ts` | Gage R&R cruzado, Henderson Tipo III e REML |
| `emp.ts` | avaliação do sistema de medição (EMP de Wheeler) |
| `capabilityCg.ts` | `C_g/C_gk` e capacidade de medição (VDA 5) |
| `lodProbit.ts` | LD/LQ por Probit (CLSI EP17) |
| `methodComparison.ts` | Bland–Altman, Deming e Passing–Bablok |
| `monteCarlo.ts` | propagação Monte Carlo (JCGM 101) |
| `accuracyProfile.ts` | perfil de exatidão SFSTP / USP `<1210>` |
| `conformity.ts` | regras de decisão e riscos de conformidade (JCGM 106 / ILAC-G8) |
| `analysis.ts` | orquestração genérica dos parâmetros e vereditos |

O catálogo de parâmetros, critérios sugeridos, pressupostos e templates de cada
família fica em `src/profiles/`. O perfil `attribute` reutiliza as colunas
existentes (`sample`, `analyst`, `category`, `textValue`, `level`,
`referenceValue`, `replicate`), sem migração de schema. `analysis.ts` consulta o
perfil ativo, de modo que novas famílias possam ser acrescentadas sem duplicar o
catálogo analítico.

Os testes em `src/stats/__tests__/stats.test.ts` comparam os resultados com
valores de `scipy`, `R` e publicações de referência. A catalogação completa das
fórmulas está em [`docs/FORMULAS.md`](docs/FORMULAS.md).

## Dados, privacidade e backup

- O banco é um SQLite real compilado para WebAssembly e persistido no
  **IndexedDB do navegador**. Nenhum dado é enviado a um servidor.
- O sistema funciona offline depois de carregado.
- `localhost` e `127.0.0.1` são origens diferentes: cada uma tem seu próprio
  banco.
- Limpar os dados do site, trocar de navegador ou de perfil remove o acesso ao
  banco local. Exporte backups em **Configurações → Dados**.
- É possível exportar o arquivo `.sqlite` e abri-lo em DB Browser for SQLite,
  DBeaver ou outra ferramenta SQLite.
- O pacote de evidências (ZIP) inclui dados, resultados, relatório, snapshot e
  manifesto com hashes.

## Exportações

| Formato | Conteúdo |
|---|---|
| DOCX | Relatório completo com tabelas, gráficos e assinaturas |
| PDF | Prévia paginada com cabeçalho, rodapé e numeração |
| Pacote de evidências (ZIP) | Dados, resultados JSON, relatório, snapshot e manifesto |
| HTML | Prévia autônoma |
| Resultados JSON | Métricas e resultados estruturados |
| Dados XLSX | Medições e plano de execução |

## Estrutura do projeto

```
src/
  components/       componentes de UI, layout, wizard, gráficos e prévia
  lib/              banco, repositório, tipos, critérios, relatório, exportação
  pages/            painel, configurações, wizard e etapas
  stats/            motor estatístico próprio e testes de referência
e2e/                testes de ponta a ponta com Playwright
docs/
  ARQUITETURA.md    arquitetura, modelo de dados e decisões
  FORMULAS.md       catálogo de fórmulas, referências e valores de teste
  GUIA_USUARIO.md   guia para usuários sem formação estatística
  INTEGRACAO_MODULO_LIMS.md  arquitetura da integração corporativa (Onda 4)
scripts/
  setup.mjs         instalação + verificação + testes + build
```

## Decisões e limitações

- **Confiança** padrão 95%, **poder** 80%, **α** 5% bilateral. Os valores são
  editáveis no delineamento.
- **σ esperado** usa dado piloto; se ausente, `faixa/6`. A suposição aparece no
  relatório.
- **Normalidade**: Shapiro–Wilk é o teste principal; rejeições geram alerta, sem
  bloquear automaticamente a análise.
- **Homogeneidade**: Levene é o teste de decisão; Bartlett é informativo.
- **Homogeneidade do lote (físico destrutivo)**: verificação opcional por ANOVA
  entre amostras, Cochran e razão de variâncias, com grupos derivados da coluna
  `Amostra`. Se o lote for rejeitado, é obrigatório registrar justificativa
  técnica; sem ela, repetibilidade e reprodutibilidade ficam **não avaliadas**.
- **Perfis físicos**: ensaio destrutivo usa Gage R&R aninhado e consome um corpo
  de prova por réplica; ensaio não destrutivo usa Gage R&R cruzado. Nenhuma
  transformação ou exclusão é automática.
- **Critérios**: os globais do método valem para todas as validações; um
  critério específico da validação substitui o global da mesma métrica. A regra
  e as substituições aplicadas aparecem nos pressupostos do relatório.
- **Outliers**: apenas sinalizados. A exclusão exige justificativa registrada.
- **Atributo/qualitativo**: item = amostra, avaliador = analista, categoria
  observada = `category` (ou `textValue`/`value`) e referência = `level` (ou
  `referenceValue`). O estudo usa kappa de Cohen/Fleiss; a decisão padrão usa
  κ ≥ 0,75 como conforme e 0,40–0,75 como atenção, valores editáveis.
- **Gabarito de atributo**: na coleta, um quadro por item permite definir a
  categoria de referência de todas as réplicas/avaliadores, aplicar em massa e
  sinalizar referências conflitantes. A visão é derivada de `level` e não altera
  o schema.
- **Seletividade**: não há cálculo automático; exige experimento e evidência
  registrada. Permanece “não avaliado” até haver critério e dado.
- **Assinaturas**: são eletrônicas simples (nome, papel, instante e hash), não
  certificado digital ICP-Brasil.
- **Uso**: aplicação local/monousuário; não há autenticação, servidor central
  nem sincronização entre dispositivos.
- **Aprovação**: congela o relatório e a validação; qualquer alteração posterior
  exige **Criar nova versão** com justificativa.

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Fórmulas e decisões estatísticas](docs/FORMULAS.md)
- [Guia do usuário](docs/GUIA_USUARIO.md)
- [Plano de execução, benchmark competitivo e viabilidade](docs/PLANO_EXECUCAO_E_BENCHMARK.md)
- [Arquitetura de integração como módulo do LIMS](docs/INTEGRACAO_MODULO_LIMS.md)

## Aviso

O sistema apoia o processo de validação e organiza a evidência estatística, mas
não substitui a avaliação técnica do responsável, os requisitos da norma
aplicável nem a revisão independente do laboratório. Os critérios de aceitação
são decisões do laboratório e devem ser definidos e justificados antes da
análise dos resultados.
