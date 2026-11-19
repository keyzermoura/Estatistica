# Validação do Software — ValidaMétodo

Este documento registra a verificação e validação independente do núcleo estatístico
e da infraestrutura de dados do **ValidaMétodo**, em apoio aos requisitos de validação
de planilhas e softwares de cálculo da **ISO/IEC 17025:2017** (item 7.11) e da **GAMP 5 /
BPL**.

## 1. Estratégia de verificação

1. **Verificação estática de tipos**: TypeScript estrito (`tsc -b` via `npm run typecheck`)
   garantindo integridade de contratos entre modelos de dados, perfis, motor estatístico,
   persistência SQLite e componentes React.
2. **Testes unitários contra fontes independentes**: cada algoritmo estatístico em `src/stats/`
   é confrontado com valores publicados em normas/manuais ou calculados em ferramentas externas
   independentes (`R 4.x`, `Python / SciPy / NumPy`, `scikit-learn`), com tolerâncias
   explícitas (`1e-6` a `1e-12`).
3. **Teste de caracterização (`analysis-characterization.test.ts`)**: congela em snapshot o
   JSON completo produzido pelo motor analítico antes da refatoração multifamília, garantindo
   ausência de regressões nas validações analíticas existentes.
4. **Testes de migração, persistência e exportação**: validam abertura de banco legado
   SQLite v1 real, migração idempotente para v2, trilha de auditoria (`audit_logs`), bloqueio
   pós-aprovação, round-trip XLSX/CSV e geração binária de relatórios DOCX (`PK`) e PDF (`%PDF`)
   nas cinco famílias de método.

## 2. Fontes e versões de referência utilizadas

- **Normas e guias internacionais / nacionais**:
  - ISO/IEC 17025:2017 (itens 7.2.1.5, 7.2.2, 7.6, 7.8.2.1 e 7.11)
  - ISO 5725-1:2023 e ISO 5725-2:2019 (precisão, Mandel *h* e *k*)
  - ISO 22514-7:2021 e ISO 14253-1:2017 (capabilidade de medição e conformidade)
  - ISO 13528:2022 e ISO/IEC 17043 (ensaios de proficiência: `z`, `ζ`, `z'`, `En`)
  - ISO 8466-1:2021 (teste quadrático de linearidade de Mandel)
  - ISO 16269-6:2014 / Wilks (1941) (intervalos de tolerância não paramétricos)
  - JCGM 100:2008 / GUM (incerteza combinada e graus de liberdade efetivos)
  - JCGM 101:2008 / Suplemento 1 do GUM (propagação por Monte Carlo)
  - JCGM 106:2012 e ILAC-G8:09/2019 (regras de decisão, banda de guarda e risco específico)
  - AIAG *Measurement Systems Analysis (MSA)*, 4ª ed., 2010 (Gage R&R, tendência, linearidade e atributos)
  - ASTM MNL 7 / Manual on Presentation of Data and Control Chart Analysis (`A2`, `D3`, `D4`)
  - VDA Volume 5 (2021) e Bosch / Q-DAS Tipo 1 (`Cg`, `Cgk`, `Q_MS`, `Q_MP`)
  - EURACHEM / CITAC: *QUAM* (3ª ed., 2012), *Target Uncertainty* (2015), *UfS* (2ª ed., 2019),
    *Qualitative Chemical Analysis* (2021), *PT Guide* (3ª ed., 2021), *Fitness for Purpose* (3ª ed., 2025)
    e *Blanks in Method Validation* (2025)
  - CLSI EP09c (comparação de métodos) e CLSI EP17-A2 (LoB/LoD)
  - USP `<1210>` / Hubert et al. SFSTP (2007) e ABNT NBR 13904 / USP `<881>`
- **Softwares independentes de conferência numérica**:
  - **R 4.x**: `stats::shapiro.test`, `stats::bartlett.test`, `stats::power.t.test`, `lme4`, `irr::kappa2`, `irr::kappam.fleiss`
  - **Python / SciPy / NumPy / scikit-learn**: integrações numéricas de Simpson, regressão OLS/WLS, testes `t`, `χ²`, `F`, Welch–Satterthwaite e `sklearn.metrics.cohen_kappa_score`
  - **Bibliografia estatística**: Montgomery (2020), Example 14-1; Fleiss (1971); Bland & Altman (1986); Passing & Bablok (1983); Finney (1971); Wheeler (2006) *EMP III*.

## 3. Matriz de rastreabilidade (Requisito → Código → Teste → Referência)

| Requisito / Prompt | Módulo / Funções | Arquivo de Teste (`vitest`) | Fonte / Referência Independente |
|---|---|---|---|
| **P1 — Perfis configuráveis e preservação analítica** | `src/profiles/{types,analytical,index}.ts`, `src/stats/analysis.ts` | `src/stats/__tests__/analysis-characterization.test.ts` (1), `criteria-precedence.test.ts` (6) | Snapshot JSON integral pré-refatoração; precedência método vs. validação |
| **P2 — Modelo v2, migração, auditoria e planilhas** | `src/lib/{schema,repository,validation,spreadsheet}.ts` | `src/lib/__tests__/{migration,repository,validation,spreadsheet,criteria}.test.ts` (20) | Banco legado `schema-v1.sqlite`, round-trip XLSX/CSV, regras `part_id`, `specimen`, `lsl < usl` |
| **P3 — Gage R&R cruzado por ANOVA, Henderson Tipo III e REML** | `src/stats/gagerr.ts` | `src/stats/__tests__/gagerr.test.ts` (15), `advanced-features.test.ts` (invariância Tipo III / REML) | Exemplo AIAG MSA 10×3×3 (`tol = 1e-6`), R `lme4`/ANOVA, Henderson (1953) / Searle et al. (1992), REML exato |
| **P4 — ANOVA aninhada e ensaio destrutivo** | `src/stats/nested.ts`, `design.ts`, `sampleSize.ts` | `src/stats/__tests__/nested.test.ts` (33) | Montgomery (2020) Example 14-1 (`tol = 1e-9`), planilha 2×2×3 exata, `b = 1` = ISO 5725-2, Cochran e justificativa obrigatória |
| **P5 — Tendência por nível, linearidade, I-MR/X̄-R e resolução** | `src/stats/gageBiasLinearity.ts`, `stability.ts` | `src/stats/__tests__/gageBiasLinearity.test.ts` (9), `stability.test.ts` (15) | AIAG 5×10 conferido em NumPy (`tol = 1e-9`), Welch–Satterthwaite com `u_ref`, constantes ASTM MNL 7 |
| **P6 — Concordância para dados de atributo** | `src/stats/attribute.ts`, `attribute-data.ts` | `src/stats/__tests__/attribute.test.ts` (24), `attribute-profile.test.ts` (10) | `sklearn` 2×2/3×3, R `irr` (anxiety/diagnoses), Fleiss (1971) 10×14×5, Wilson exact, `p_e = 1`, conflito de referência |
| **P7 — Conformidade, banda de guarda, posterior bayesiano e riscos globais** | `src/stats/conformity.ts`, `src/lib/criteria.ts` | `src/stats/__tests__/conformity.test.ts` (21), `advanced-features.test.ts` (JCGM 106 bayesiano) | Integração numérica de Simpson independente (`tol = 1e-6`), ILAC-G8 / JCGM 106 §7 e §9.5 (Sheppard `R_C = 0,125`), `u = 0`, `w > T/2` |
| **P8/P9/P10 — Perfis Dimensional, Físico (Destrutivo / Não Destrutivo), Não Normalidade, Covariáveis, Orçamentos-Modelo e Relatórios** | `src/stats/normality.ts`, `parameters/{dimensional,physical}.ts`, `lib/{seed,report,export}.ts`, `pages/steps/StepAnalysis.tsx` | `src/stats/__tests__/physical-profile.test.ts` (10, incluindo a integração da homogeneidade ao fluxo destrutivo), `dimensional-profile.test.ts` (2) | `seedSutureVerification` (ABNT NBR 13904), `seedDimensionalDemo`, Wilks / ISO 16269-6 (`n_min = 93`), regressão ambiental e exportação DOCX/PDF nas 5 famílias |
| **P11 — Graus de liberdade (GL) no orçamento GUM e vínculo com estudos** | `src/stats/uncertainty.ts`, `src/stats/parameters/dimensional.ts`, `src/stats/gagerr.ts` | `src/stats/__tests__/uncertainty-dof.test.ts` (10) | JCGM 100:2008 §G.4 e §G.4.2; não omissão de Tipo A sem GL; propagação de GL do resíduo (dfE) e Satterthwaite de operador |
| **P12 — ANOVA mista aninhada-cruzada com GL por Satterthwaite** | `src/stats/mixedAnova.ts`, `src/stats/parameters/dimensional.ts`, `src/pages/steps/StepAnalysis.tsx` | `src/stats/__tests__/mixed-anova.test.ts` (7) | Montgomery (2020) Caps. 13–14; Searle et al. (1992); Satterthwaite (1946); partição de 431 GL (2×6×3×2×6); F sintetizado; resíduos estudentizados com Bonferroni; Welch-ANOVA com Bartlett |
| **Núcleo estatístico analítico + Pacotes avançados Eurachem/CLSI/VDA/JCGM 101** | `src/stats/{distributions,sampleSize,outliers,normality,variance,anova,iso5725,regression,bias,uncertainty,accuracyProfile,emp,capabilityCg,lodProbit,methodComparison,monteCarlo}.ts` | `src/stats/__tests__/stats.test.ts` (26), `advanced-features.test.ts` (22) | R `power.t.test`, `shapiro.test`, ISO 5725-2 Tabelas B.1/B.2 (Mandel 5%/1%), ISO 8466-1, JCGM 100 §5.2 (`r`) & §G.4.2 (`ν_B = ∞`), Eurachem, SFSTP, Wheeler EMP, VDA 5, EP09c, EP17-A2, JCGM 101 |

## 4. Como reproduzir a verificação localmente

Pré-requisitos: Node.js 18+ (recomendado 20 LTS) e `npm`.

```bash
# Instalação completa + verificação de tipos + suíte de testes + build de produção
npm run setup

# Ou executando cada etapa individualmente (no Windows PowerShell usar npm.cmd):
npm run typecheck
npm test
npm run build
```

Critério de aceite da verificação do software:
- `npm run typecheck` (`tsc -b`) termina com código `0` e zero erros de tipo;
- `npm test` (`vitest run`) aprova 100% dos arquivos de teste e casos cadastrados (obtenha a contagem atualizada executando `npm test`), sem testes pulados ou modificados para relaxar asserções;
- `npm run build` gera o bundle estático em `dist/` com código `0`.

## 5. Limitações conhecidas e declarações de uso

1. **Gage R&R cruzado desbalanceado (`src/stats/gagerr.ts`)**: por padrão (`unbalancedMethod: 'sequential_ls'`), observações faltantes usam análise por lista (*listwise*) com somas de quadrados sequenciais para compatibilidade retroativa, registrando `n` e `r_eff` no relatório; para desenhos severamente desbalanceados ou ausência de células conectadas, recomenda-se selecionar `'type3_henderson'` (Henderson Método 3) ou `'reml'` (REML cruzado de dois fatores), ou comparar os três via `gageRRUnbalancedMethods`. Note-se que para REML os ICs de `σ_GRR` e `%GRR` utilizam os graus de liberdade Satterthwaite equivalentes do modelo Tipo III.
2. **Ensaio destrutivo (`src/stats/nested.ts`)**: como o mesmo corpo de prova não pode ser ensaiado duas vezes, a estimativa de repetibilidade absorve eventual variabilidade intrínseca entre corpos de prova do lote. Se o teste de homogeneidade do lote (ANOVA + Cochran + razão de variâncias) rejeitar homogeneidade, a execução exige justificativa técnica formal registrada para prosseguir.
3. **Transformações e remoção de outliers**: o software **nunca** exclui outliers nem aplica transformação logarítmica ou ponderada automaticamente sobre os dados originais; todas as decisões estatísticas permanecem editáveis pelo usuário e rastreáveis em `audit_logs` e no relatório final.
4. **Conformidade quando `u = 0` (`src/stats/conformity.ts`)**: se a incerteza combinada informada for nula, a distribuição do mensurando degenera em ponto discreto (risco de falso aceite/rejeite `0` ou `1`, `TUR` indefinido/nulo) e o sistema exibe alerta normativo registrando o caso limite.
5. **Seletividade e inspeções documentais**: parâmetros puramente qualitativos de evidência cromatográfica ou documental sem tabela de dados numéricos permanecem explicitamente como `not_evaluated` até o registro de evidência técnica ou justificativa no relatório.
6. **Graus de liberdade em fontes Tipo A no orçamento GUM (`src/stats/uncertainty.ts`)**: conforme o JCGM 100:2008 §G.4, fontes Tipo A com graus de liberdade ausentes ou não positivos não podem ser omitidas do denominador de Welch–Satterthwaite nem consideradas como infinito. O sistema suspende o cálculo do `ν_eff` (definindo-o como nulo), sinaliza o orçamento com `dofComplete: false` e adota provisoriamente `k = 2,000` com aviso em destaque, até que os graus de liberdade válidos (do estudo experimental ou *fallback* conservador documentado) sejam informados.
