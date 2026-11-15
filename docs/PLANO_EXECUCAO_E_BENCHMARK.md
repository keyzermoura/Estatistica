# Plano de Execução, Benchmark Competitivo e Análise de Viabilidade Técnica

**Sistema avaliado:** **ValidaMétodo**  
**Normas e guias de referência:** ABNT NBR ISO/IEC 17025:2017 (§7.2, §7.6, §7.8), JCGM 100:2008 (GUM), JCGM 101:2008 (GUM Suplemento 1), JCGM 106:2012, ILAC-G8:09/2019, AIAG MSA 4ª ed., ISO 5725-2:2019, ISO 14253-1:2017, VDA 5, ICH Q2(R2), ANVISA RDC 166/2017, DOQ-CGCRE-008 e CLSI (EP05, EP06, EP09, EP15, EP17).

---

## 1. Posicionamento Atual do ValidaMétodo

O **ValidaMétodo** diferencia-se por reunir, em uma aplicação web local-first em português (React 18 + TypeScript + SQLite WebAssembly em IndexedDB, com motor estatístico próprio em `src/stats/` sem dependências externas de runtime), capacidades que normalmente exigem múltiplas ferramentas separadas no laboratório:

- **Fluxo guiado em 7 etapas** (`Método → Parâmetros → Delineamento → Coleta → Análise → Relatório → Auditoria`).
- **Múltiplos perfis estatísticos nativos** (`src/profiles/`): analítico quantitativo, microbiológico, atributo/qualitativo (Kappa de Cohen/Fleiss, FAR/FRR, Wilson), dimensional, físico não destrutivo (Gage R&R cruzado) e físico destrutivo (Gage R&R aninhado `operador > amostra > corpo de prova`).
- **Metrológica e decisão de conformidade integradas**: orçamento de incerteza GUM com graus de liberdade efetivos por Welch–Satterthwaite (`src/stats/uncertainty.ts`), regras de decisão ILAC-G8 / JCGM 106 (`simple_acceptance`, `guard_band` com $w = r \cdot U$, `probability`), suporte a especificação bilateral ou estritamente unilateral (`LSL`-only / `USL`-only) e verificação dupla compendial via `individualLsl` (ex.: ABNT NBR 13904 / USP `<881>`).
- **Rastreabilidade local**: hash SHA-256 de entrada no congelamento de análises, versionamento imutável após aprovação, assinaturas eletrônicas simples e exportação em DOCX, PDF, HTML, XLSX, JSON e pacote ZIP de evidências.

---

## 2. Benchmark de Mercado Comparativo

A tabela abaixo compara o **ValidaMétodo** com referências comerciais e open-source em validação analítica, MSA industrial, estatística e incerteza de medição:

| Dimensão / Capacidade | **ValidaMétodo (Atual)** | **Finbiosoft Validation Manager** | **Waters Empower MVM / Thermo Chromeleon** | **Q-DAS solara.MP (Hexagon)** | **JMP (SAS) / Minitab (MSA)** | **GUM Workbench / Sandia Suncal** |
|---|---|---|---|---|---|---|
| **Posicionamento** | Validação e verificação multi-perfil (ISO/IEC 17025) em PT-BR | Cloud para validação clínica e laboratorial (ISO 15189 / ISO 17025) | Validação cromatográfica nativa acoplada ao CDS (ICH Q2) | Capabilidade de sistemas e processos de medição industrial | Estatística geral, DOE, Gage R&R e **EMP** (JMP) | Orçamento de incerteza e modelagem metrológica |
| **Precisão / Gage R&R** | Cruzado, aninhado destrutivo, ISO 5725-2 | CLSI EP05 (ANOVA multi-dia) e EP15 (verificação) | %RSD repetibilidade e precisão intermediária em CDS | Tipo 1 ($C_g/C_{gk}$), Tipo 2/3, VDA 5, MSA cruzado/aninhado | Gage R&R cruzado/aninhado; JMP inclui método **EMP** | ANOVA / comparação interlaboratorial (Suncal) |
| **Comparação de Métodos** | Tendência vs. referência + TOST + proficiência ($E_n$/$z$) | **Forte:** Passing–Bablok, Bland–Altman (CLSI EP09) | Regressão ICH, recuperação e System Suitability (SST) | Viés por nível, linearidade MSA | Regressão ortogonal / Bland–Altman via script | Regressão com incerteza nas duas variáveis (Suncal) |
| **Sensibilidade (LD / LQ)** | Regressão linear (desvio do branco/calibração) | **Forte:** CLSI EP17 (LoB, LoD, LoQ, regressão **Probit**) | S/N, desvio do branco, ICH Q2 | Não aplicável | Plataformas separadas (regressão/Probit) | Não é o foco |
| **Incerteza de Medição** | GUM aditivo Tipo A/B + Welch–Satterthwaite | Parcial (foco clínico / TEA) | Não nativo | Orçamento focado em **VDA 5** | Não nativo (requer JSL/macros) | **Referência:** equações simbólicas + **Monte Carlo (JCGM 101)** |
| **Regra de Decisão e Risco** | Aceitação simples, banda de guarda $r \cdot U$, probabilidade + `individualLsl` | Critérios analíticos e erro total permitido (TEA) | Flag OOS simples contra limite | ISO 14253-1 / VDA 5 | Não nativo | Risco de falsa aceitação/rejeição (FAR/FRR no Suncal) |
| **Fluxo e Templates** | Wizard 7 etapas; presets por família e exemplo NBR 13904 | Protocolos pré-prontos alinhados a diretrizes **CLSI EP** | **eWorkflows** sequenciais guiados + planilhas de relatório | Pacotes normativos automotivos (AIAG / VDA 5) | Análise sob demanda sem fluxo regulado | Modelos editáveis sem fluxo multi-etapas de aprovação |
| **Captura de Dados** | Digitação, XLSX/CSV genérico e exemplo seed | Interfaces com analisadores / LIS | **Zero-export** direto do cromatógrafo | **Direta** de CMMs, paquímetros, RS-232/OPC | Importação de tabelas | Importação CSV / manual |
| **Governança / 21 CFR Part 11** | Local-first (SQLite Wasm + lock por versão) | Cloud multiusuário com auditoria e aprovações | **Completa** (SQL Vault, RBAC, Part 11 nativo) | Servidor corporativo com histórico | Licença desktop/corporativa | Arquivo de projeto local |

---

## 3. Avaliação de Viabilidade dos Pontos Fortes dos Concorrentes

Esta seção avalia cada diferencial forte observado nos concorrentes, sua aderência ao motor TypeScript próprio em `src/stats/`, as extensões necessárias, os algoritmos envolvidos e os riscos técnicos.

### F1 — Propagação de Incerteza por Monte Carlo (JCGM 101) e Equação do Mensurando
- **Referência de mercado:** Sandia Suncal e GUM Workbench.
- **Lacuna atual no ValidaMétodo:** `src/stats/uncertainty.ts` suporta combinação aditiva linear $u_c = \sqrt{\sum (c_i \cdot u_i)^2}$ com coeficientes $c_i$ informados manualmente. Não avalia expressões simbólicas não lineares $Y = f(X_1, \dots, X_k)$ nem distribuições de saída assimétricas.
- **Viabilidade técnica:** **Alta.** Todo o motor já utiliza PRNG determinístico (`mulberry32` em `src/stats/design.ts`) e inversas de distribuições em `src/stats/distributions.ts`.
- **Arquitetura proposta:**
  - Criar `src/stats/monteCarlo.ts`:
    - Parser seguro de expressão matemática (AST própria ou Shunting-Yard com operadores `+ - * / ^` e funções `sqrt`, `abs`, `log`, `ln`, `exp`, `sin`, `cos`, sem uso de `eval` ou `Function`), vinculando cada variável $X_i$ a uma distribuição (`normal`, `rectangular`, `triangular`, `u_shaped`, `t_student`) com parâmetros de locação/escala.
    - Cálculo numérico automático de coeficientes de sensibilidade $c_i = \frac{f(x + h_i) - f(x - h_i)}{2 h_i}$ via diferenças finitas centradas para comparar diretamente com o orçamento GUM linear de `uncertainty.ts`.
    - Simulação determinística ($N = 50\,000$ a $200\,000$ iterações em Web Worker opcional para não travar a UI), gerando estimativa média/mediana, desvio-padrão $u_{\text{MC}}$, intervalo de cobertura de $95\%$ (simétrico por quantis e menor intervalo / *shortest coverage interval*), histograma para `AnalysisChart` (Recharts) e verificação de consistência frente ao GUM tradicional conforme JCGM 101 (§8).
- **Esforço estimado:** Médio (2 a 3 semanas).

### F2 — Comparação de Métodos e Transferência Analítica (Passing–Bablok, Deming e Bland–Altman)
- **Referência de mercado:** Finbiosoft Validation Manager (CLSI EP09 / EP15).
- **Lacuna atual no ValidaMétodo:** `src/stats/regression.ts` e `src/stats/bias.ts` cobrem regressão linear OLS/WLS ($y$ contra concentração nominal $x$ sem erro) e TOST de duas amostras, mas não modelam erro em ambos os eixos nem regressão não-paramétrica robusta a outliers para pares de método teste vs. método referência.
- **Viabilidade técnica:** **Alta.**
- **Arquitetura proposta:**
  - Criar `src/stats/methodComparison.ts`:
    - **Bland–Altman:** diferenças $d_i = y_i - x_i$ (e diferença percentual $\frac{y_i - x_i}{\bar{m}_i} \times 100$), viés médio $\bar{d}$, desvio-padrão $s_d$, limites de concordância $95\%$ ($\text{LoA} = \bar{d} \pm 1{,}96 \cdot s_d$) com intervalos de confiança e regressão de proporcionalidade ($d_i$ vs. média).
    - **Regressão de Deming (ordinária e ponderada):** minimização ortogonal parametrizada pela razão de variâncias $\lambda = \sigma_{\varepsilon}^2 / \sigma_{\delta}^2$ com erros-padrão por *jackknife* e teste de aceitação para inclinação $= 1$ e intercepto $= 0$.
    - **Regressão de Passing–Bablok:** cálculo de todas as inclinações pareadas $S_{ij} = \frac{y_j - y_i}{x_j - x_i}$, exclusão de empates $x_i = x_j$ e pares simétricos a $-1$, ordenamento para encontrar mediana deslocada $b$ com IC $95\%$ exato e intercepto $a = \text{mediana}(y_i - b x_i)$, mais teste Cusum de linearidade.
  - Adicionar novo parâmetro opcional ou modo no perfil analítico/físico (`comparison` ou aba complementar em `bias`).
- **Esforço estimado:** Baixo a Médio (1,5 a 2 semanas).

### F3 — Limites de Detecção CLSI EP17 e Regressão Probit
- **Referência de mercado:** Finbiosoft Validation Manager / Empower MVM.
- **Lacuna atual no ValidaMétodo:** `src/stats/regression.ts` implementa $\text{LD} = 3{,}3 \cdot s / b$ e $\text{LQ} = 10 \cdot s / b$ pela curva analítica (ICH Q2 clássico). Falta suporte ao protocolo **CLSI EP17** (LoB não-paramétrico e LoD via desvio de pools de baixa concentração) e **regressão Probit** ($\Phi^{-1}(p) = a + b \cdot \log_{10}(C)$) usada em ensaios qualitativos/biológicos/microbiológicos para determinar $\text{LOD}_{95\%}$.
- **Viabilidade técnica:** **Alta.** A inversa normal $\Phi^{-1}(p)$ e a CDF normal já existem com alta precisão em `src/stats/distributions.ts`.
- **Arquitetura proposta:**
  - Criar `src/stats/lodProbit.ts` com:
    - Estimador **LoB/LoD/LoQ CLSI EP17**: suporte a cálculo paramétrico ($c_p = \frac{1{,}645}{1 - 1/(4f)}$) e não-paramétrico por ranking em brancos e amostras de baixa concentração.
    - **Modelo Probit / Logit via IRLS (Iteratively Reweighted Least Squares):** estimação de máxima verossimilhança para resposta binomial (`detectado` / `não detectado` por nível de diluição), intervalo de confiança fiducial de Fieller para $\text{LOD}_{95\%}$ e teste de aderência $\chi^2$.
- **Esforço estimado:** Médio (2 semanas).

### F4 — Método EMP (*Evaluating the Measurement Process* de Donald Wheeler)
- **Referência de mercado:** JMP (SAS).
- **Lacuna atual no ValidaMétodo:** O sistema avalia sistemas de medição pelos critérios da AIAG MSA 4ª ed. (`%GRR <= 10% conforme`, `ndc >= 5`). Em linhas de produção muito estáveis ($\sigma_{\text{peça}}$ pequena), o `%GRR` pode reprovar artificialmente instrumentos plenamente capazes.
- **Viabilidade técnica:** **Muito Alta.** Os componentes de variância ($\sigma_{\text{rep}}^2$, $\sigma_{\text{repro}}^2$, $\sigma_{\text{peça}}^2$) já são calculados em `src/stats/gagerr.ts` e `src/stats/nested.ts`.
- **Arquitetura proposta:**
  - Criar `src/stats/emp.ts` utilizando os mesmos componentes da ANOVA de `gagerr.ts`/`nested.ts`:
    - Cálculo de **ICC** ($\rho = \frac{\sigma_{\text{peça}}^2}{\sigma_{\text{total}}^2}$), **Erro Provável** ($PE = 0{,}6745 \cdot \sigma_{\text{GRR}}$), **Resolução Efetiva** recomendada ($0{,}2 \cdot PE \le \text{resolução} \le 2 \cdot PE$), **Atenuação do Sinal** ($1 - \rho$) e classificação nas **4 Classes de Monitor de Processo (Classe I a IV)** além do perfil de probabilidade de detecção de deslocamentos de $k \cdot \sigma$.
  - Exibir os indicadores EMP como painel complementar nos estudos dimensional e físicos (`src/stats/parameters/dimensional.ts` e `physical.ts`) sem quebrar critérios AIAG existentes.
- **Esforço estimado:** Baixo (3 a 5 dias).

### F5 — Estudo Tipo 1 ($C_g / C_{gk}$) e Capabilidade VDA 5 ($Q_{\text{MS}} / Q_{\text{MP}}$)
- **Referência de mercado:** Q-DAS solara.MP (Hexagon).
- **Lacuna atual no ValidaMétodo:** A tendência e repetibilidade estão separadas em etapas distintas e orientadas à tolerância AIAG. Falta o ensaio rápido de qualificação de instrumento (50 medições no padrão de referência) com cálculo de $C_g / C_{gk}$, além dos índices de razão de incerteza da norma alemã VDA 5 ($Q_{\text{MS}} = \frac{2 \cdot U_{\text{MS}}}{T} \le 15\%$ e $Q_{\text{MP}} = \frac{2 \cdot U_{\text{MP}}}{T} \le 30\%$).
- **Viabilidade técnica:** **Muito Alta.**
- **Arquitetura proposta:**
  - Criar `src/stats/capabilityCg.ts`: calcula $C_g = \frac{0{,}20 \cdot T}{6 \cdot s_g}$ e $C_{gk} = \frac{0{,}10 \cdot T - |\bar{x} - x_{\text{ref}}|}{3 \cdot s_g}$ (configurável para regra $20\% / 6s$ ou $15\% / 4s$), e adiciona métricas $Q_{\text{MS}}$ / $Q_{\text{MP}}$ ao adaptador dimensional/físico em `src/stats/parameters/dimensional.ts`.
- **Esforço estimado:** Baixo (3 a 5 dias).

### F6 — Biblioteca de Protocolos Normativos Pré-Configurados (`eWorkflows`) e Consolidação do Relatório
- **Referência de mercado:** Thermo Chromeleon (`eWorkflows`) e Waters Empower MVM.
- **Lacuna atual no ValidaMétodo:** Hoje o usuário configura manualmente método, critérios, regra de decisão e fontes de incerteza (com apenas os exemplos `seed` pré-montados). Além disso, `src/lib/report.ts` precisa explicitar os novos campos de `ReportConfig` (`conformityRule`, `guardBandFactor`, `probabilityThreshold`, `processVariation`, `individualLsl`) na seção de conformidade do relatório HTML/DOCX/PDF.
- **Viabilidade técnica:** **Muito Alta.**
- **Arquitetura proposta:**
  - Refletir os campos de decisão e `individualLsl` em `src/lib/report.ts` e `src/pages/steps/StepReport.tsx`.
  - Criar catálogo `src/profiles/normative-templates.ts` com protocolos selecionáveis na criação de nova validação:
    - *ABNT NBR 13904 / USP `<881>` (Tração sobre Nó em Suturas — `LSL` + `individualLsl`)*
    - *ANVISA RDC 166/2017 / ICH Q2(R2) (Validação Cromatográfica Quantitativa)*
    - *ISO/IEC 17025 / DOQ-CGCRE-008 (Verificação de Método Normalizado)*
    - *AIAG MSA 4ª ed. / VDA 5 (Qualificação de Sistema de Medição)*
- **Esforço estimado:** Baixo a Médio (1 semana).

### F7 — Parsers de Instrumentos de Bancada com Rastreabilidade SHA-256 (ALCOA+)
- **Referência de mercado:** Chromeleon / Q-DAS solara.MP.
- **Lacuna atual no ValidaMétodo:** `src/lib/spreadsheet.ts` importa planilhas genéricas XLSX/CSV, sem presets para cabeçalhos exportados por máquinas universais de ensaio (Instron/Bluehill, EMIC/Tesc, Shimadzu/Trapezium) nem retenção do hash SHA-256 do arquivo original importado.
- **Viabilidade técnica:** **Alta.** `objectHash` / Web Crypto (`crypto.subtle.digest('SHA-256', ...)`) já são usados em `StepAnalysis.tsx` e `report.ts`.
- **Arquitetura proposta:**
  - Estender `src/lib/spreadsheet.ts` e `StepCollection.tsx` com assistente de mapeamento de colunas, validação prévia de balanceamento (para evitar falha tardia na etapa Análise em ensaios aninhados destrutivos) e registro automático do nome do arquivo + SHA-256 na trilha de auditoria (`audit_log`).
- **Esforço estimado:** Médio (1 a 2 semanas).

---

## 4. Plano de Execução Faseado (Roadmap Detalhado)

| Onda | Objetivo | Entregáveis Principais | Critério de Pronto (DoD) | Dependências |
|---|---|---|---|---|
| **Onda 1 (Curto Prazo — 2 semanas)** | Fechar lacunas de relatório e análises rápidas de alto impacto | 1. Expor `conformityRule`, `guardBandFactor`, `probabilityThreshold`, `processVariation`, `individualLsl` e notas unilaterais no relatório (`src/lib/report.ts`, `StepReport.tsx`).<br>2. Implementar módulo EMP (`src/stats/emp.ts`) e Tipo 1 $C_g/C_{gk}$ + VDA 5 (`src/stats/capabilityCg.ts`).<br>3. Criar biblioteca de templates normativos (`src/profiles/normative-templates.ts`). | `npm run typecheck`, `npm test` (com testes unitários de EMP e $C_g/C_{gk}$ validados contra Minitab/JMP) e E2E de geração de DOCX/PDF passando. | Nenhuma |
| **Onda 2 (Curto/Médio Prazo — 3 semanas)** | Fortalecer comparação de métodos e limites compendiais | 1. Implementar `src/stats/methodComparison.ts` (Passing–Bablok, Deming, Bland–Altman) e UI/gráficos Recharts.<br>2. Implementar `src/stats/lodProbit.ts` (CLSI EP17 + Probit IRLS para $\text{LOD}_{95\%}$).<br>3. Presets de importação de instrumentos e validação pré-coleta em `src/lib/spreadsheet.ts` com hash SHA-256 do arquivo bruto. | Testes de referência em Vitest comparando coeficientes Passing–Bablok, Deming e Probit contra `R`/`scipy` com tolerância $\le 10^{-4}$. | Onda 1 |
| **Onda 3 (Médio Prazo — 3 semanas)** | Modelagem avançada de incerteza não-linear (nível Suncal / GUM Workbench) | 1. Parser seguro e motor `src/stats/monteCarlo.ts` (JCGM 101).<br>2. Modo "Equação do mensurando $Y = f(X)$" na etapa Análise (`StepAnalysis.tsx`) com histograma comparativo GUM vs. Monte Carlo.<br>3. Suporte a múltiplos sub-níveis/calibres por protocolo (ex.: USP 3-0, 2-0 e 0 no mesmo dossiê NBR 13904). | Simulação determinística por seed, comparação automatizada $\text{GUM vs. MC}$ dentro dos critérios do JCGM 101 e performance $< 300\text{ ms}$ para $50\,000$ amostras (Web Worker). | Onda 1 |
| **Onda 4 (Médio/Longo Prazo — 4 a 6 semanas)** | Integração corporativa como módulo do `keyzermoura/LIMS` (21 CFR Part 11 + PostgreSQL) | 1. Migração Alembic `0007_fase4_validacao_metodos.py` no LIMS.<br>2. Rotas FastAPI `/api/v1/method-validations` + assinatura em 2 etapas.<br>3. Gates operacionais entre `TestMethod`, `LaboratoryEquipment`, `LabTest` e `CapaAction`. | Especificado integralmente em [`INTEGRACAO_MODULO_LIMS.md`](INTEGRACAO_MODULO_LIMS.md). | Ondas 1–3 (motor TS empacotado) |

---

## 5. Riscos Técnicos e Mitigações

1. **Bloqueio de UI em simulações Monte Carlo:** Executar amostragem $N \ge 50\,000$ em `Web Worker` dedicado para manter o navegador responsivo em máquinas de laboratório de menor porte.
2. **Divergência entre critérios AIAG MSA e EMP/VDA 5:** Manter `AIAG MSA` como padrão explícito e exibir `EMP` / `VDA 5` em bloco identificado por norma, nunca misturando limiares no mesmo veredito sem transparência no relatório.
3. **Execução segura de fórmulas definidas pelo usuário:** Proibir estritamente `eval`/`new Function` na equação do mensurando $Y = f(X)$, adotando lexer/parser restrito a expressões matemáticas puras.
