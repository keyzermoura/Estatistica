# Arquitetura — ValidaMétodo

Sistema web offline-first para validação de métodos analíticos, com fluxo guiado,
delineamento amostral, análise estatística auditável, orçamento de incerteza e
relatório em DOCX/PDF.

## 1. Visão geral

```
┌────────────────────────────────────────────────────────────────────┐
│  React 18 + TypeScript + Vite + Tailwind CSS                       │
│                                                                    │
│  Dashboard ─ Wizard (7 etapas) ─ Coleta ─ Análise ─ Relatório      │
│       │            │                 │          │          │       │
│       └────────────┴─────────────────┴──────────┴──────────┘       │
│                              │                                     │
│              ┌───────────────┴───────────────┐                     │
│              │  Núcleo estatístico (src/stats)│                     │
│              │  fórmulas + referências       │                     │
│              └───────────────┬───────────────┘                     │
│                              │                                     │
│              ┌───────────────┴───────────────┐                     │
│              │ Repositório + auditoria        │                     │
│              └───────────────┬───────────────┘                     │
│                              │                                     │
│         SQLite (sql.js/WASM) persistido em IndexedDB               │
│         Exportação: .sqlite, XLSX/CSV, DOCX, PDF, ZIP de evidências│
└────────────────────────────────────────────────────────────────────┘
```

**Por que tudo no cliente?** O requisito técnico admite explicitamente a
alternativa “tudo no cliente com TypeScript para uso offline”. A escolha elimina
servidor e dependências nativas, garante funcionamento em laboratório sem rede,
mantém os dados sob controle local e permite executar todo o sistema com um
único comando. O banco é SQLite real (compilado para WebAssembly), persistido em
IndexedDB; o arquivo `.sqlite` pode ser exportado e aberto em qualquer ferramenta
SQLite.

## 2. Estrutura de pastas

```
estat2/
├─ docs/
│  ├─ ARQUITETURA.md          ← este documento
│  ├─ FORMULAS.md             ← catálogo de fórmulas e referências
│  └─ GUIA_USUARIO.md         ← passo a passo para não estatísticos
├─ public/
│  └─ favicon.svg
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx                 ← rotas
│  ├─ index.css               ← Tailwind + acessibilidade + impressão
│  ├─ components/
│  │  ├─ ui/                  ← Button, Card, Input, Select, Badge, Modal…
│  │  ├─ layout/              ← Shell, Sidebar, Topbar, ThemeToggle
│  │  ├─ charts/              ← gráficos Recharts e captura SVG→PNG
│  │  ├─ wizard/              ← Stepper, StepShell, HelpTip
│  │  ├─ Glossary.tsx
│  │  └─ CriteriaTable.tsx
│  ├─ pages/
│  │  ├─ Dashboard.tsx
│  │  ├─ Settings.tsx
│  │  ├─ ValidationWizard.tsx
│  │  └─ steps/
│  │     ├─ StepMethod.tsx
│  │     ├─ StepParameters.tsx
│  │     ├─ StepDesign.tsx
│  │     ├─ StepCollection.tsx
│  │     ├─ StepAnalysis.tsx
│  │     ├─ StepReport.tsx
│  │     └─ StepAudit.tsx
│  ├─ lib/
│  │  ├─ types.ts             ← modelo de dados TypeScript
│  │  ├─ db.ts                ← schema SQLite, persistência, migrações
│  │  ├─ repository.ts        ← CRUD + auditoria + versionamento
│  │  ├─ seed.ts              ← método/validação de exemplo
│  │  ├─ export.ts            ← XLSX, CSV, DOCX, PDF, ZIP
│  │  ├─ report.ts            ← composição do relatório
│  │  ├─ criteria.ts          ← avaliação de critérios de aceitação
│  │  └─ utils.ts
│  ├─ profiles/
│  │  ├─ types.ts             ← contrato MethodProfile
│  │  ├─ analytical.ts        ← catálogo e módulos do perfil analítico
│  │  └─ index.ts             ← registro e seleção do perfil ativo
│  └─ stats/
│     ├─ distributions.ts     ← normais, t, χ², F, não centrais
│     ├─ descriptive.ts
│     ├─ sampleSize.ts        ← Módulo 3 (núcleo)
│     ├─ design.ts            ← delineamentos + aleatorização
│     ├─ outliers.ts          ← Grubbs, Cochran, Hampel
│     ├─ normality.ts         ← Shapiro-Wilk
│     ├─ variance.ts          ← Bartlett, Levene
│     ├─ anova.ts             ← ANOVA 1/2 fatores + componentes
│     ├─ iso5725.ts           ← repetibilidade/reprodutibilidade
│     ├─ regression.ts        ← linearidade, WLS, LOD/LOQ
│     ├─ bias.ts              ← tendência, recuperação, z, En, TOST
│     ├─ uncertainty.ts       ← GUM + Welch-Satterthwaite
│     ├─ analysis.ts          ← orquestração genérica da análise
│     ├─ analysis-types.ts    ← contratos de resultado
│     ├─ analysis-utils.ts    ← métricas e resumos compartilhados
│     ├─ parameters/          ← módulos analíticos por parâmetro
│     ├─ index.ts
│     └─ __tests__/           ← referência numérica + caracterização
├─ scripts/
│  └─ setup.mjs               ← instalação + verificação em 1 comando
├─ README.md
├─ package.json
├─ vite.config.ts
├─ tailwind.config.js
└─ tsconfig*.json
```

### Perfis de método

O catálogo de parâmetros, os rótulos, as métricas, os critérios sugeridos, os
pressupostos e os templates de delineamento ficam em `src/profiles/`. Nesta
etapa só existe o perfil `analytical`; as demais famílias (dimensional, físico
destrutivo/não destrutivo e atributo) serão registradas no mesmo contrato. O
motor em `src/stats/analysis.ts` apenas orquestra os módulos indicados pelo
perfil ativo e mantém as regras gerais de veredito, qualidade e auditoria.

## 3. Modelo de dados (SQLite)

```
methods 1───n validations 1───n validation_parameters
                    │
                    ├──1 designs (versão corrente)
                    ├──n measurements
                    ├──n analyses (por parâmetro/versão)
                    ├──n uncertainty_items
                    ├──n reports (versões)
                    ├──n validation_versions (snapshots)
                    └──n audit_logs
settings (chave/valor: laboratório, logo, tema, referências)
```

| Tabela | Campos principais | Finalidade |
|---|---|---|
| `methods` | id, code, name, type, unit, range_min/max, equipment, reference_norm, validation_type, criteria_json | Cadastro do método e critérios |
| `validations` | id, method_id, title, objective, scope, status, current_step, version, responsible, reviewer, approver, locked, approved_at, report_config_json | Processo de validação |
| `validation_parameters` | validation_id, param_key, selected, justification, criteria_json | Checklist de parâmetros |
| `designs` | validation_id, input_json, plan_json, seed, created_at | Delineamento, curva de poder e mapa de execução |
| `measurements` | validation_id, run_order, level, analyst, day, equipment, lot, sample, replicate, value, text_value, notes | Dados brutos |
| `analyses` | validation_id, parameter_key, kind, input_hash, results_json | Resultados congelados por versão |
| `uncertainty_items` | validation_id, source, type, distribution, value, divisor, sensitivity, std_uncertainty, dof | Orçamento GUM |
| `reports` | validation_id, version, status, content_json, elaborated/reviewed/approved, dates, locked | Relatório e assinaturas |
| `validation_versions` | validation_id, version, snapshot_json, reason, created_by, created_at | Histórico imutável |
| `audit_logs` | validation_id, entity, action, actor, before_json, after_json, reason, timestamp | Trilha de auditoria |
| `settings` | key, value_json | Configuração local |

Regras de integridade:

- `validations.locked = 1` após aprovação; repositório rejeita alterações.
- Toda escrita relevante gera `audit_logs` com antes/depois.
- Aprovar cria um snapshot em `validation_versions` e congela o relatório.
- Nova versão exige justificativa e incrementa `validations.version`.

## 4. Fluxo do usuário

1. **Método** — identificação, faixa, equipamento, norma, tipo de validação e critérios.
2. **Parâmetros** — checklist com sugestão automática por tipo de método.
3. **Delineamento** — confiança, poder, σ, efeito, margem; cálculo por parâmetro;
   desenho (CRD, blocos, fatorial, cruzado, aninhado, ISO 5725-2); curva de poder;
   aleatorização com semente; resumo leigo.
4. **Coleta** — formulário, planilha modelo, importação com validação, detecção de
   faltantes, desbalanceamento e valores fora da faixa.
5. **Análise** — descritiva, gráficos, outliers, normalidade, homogeneidade,
   ANOVA, componentes de variância, ISO 5725-2, regressão/linearidade, LD/LQ,
   tendência/recuperação, z/En, TOST e orçamento de incerteza GUM.
6. **Relatório** — prévia auditável, assinaturas, DOCX/PDF, pacote de evidências.
7. **Auditoria** — log, versões, bloqueio.

## 5. Decisões estatísticas e suposições registradas

Sempre que uma decisão puder alterar a conclusão, ela é **editável** e fica
registrada no relatório. Os padrões abaixo são apenas recomendações iniciais.

| Tema | Padrão | Justificativa / observação |
|---|---|---|
| Confiança | 95% | Prática laboratorial; ISO 5725 e GUM usuais |
| Poder | 80% | Convenção; risco β = 20% |
| α | 5% (bilateral) | Editável; TOST usa α unilateral de 5% em cada cauda |
| σ esperado | dado piloto; se ausente, faixa/6 | Faixa/6 cobre ~99,7% se o processo for normal e a faixa for o intervalo de trabalho; é uma **suposição** e aparece no relatório |
| Diferença mínima detectável | limite de aceitação do parâmetro; se ausente, 5% da faixa | O usuário pode alterar |
| Margem TOST | igual ao limite de aceitação de tendência/recuperação | Se não houver, 1% da faixa; registrada |
| n mínimo | 3 medições por condição | Permite estimar variabilidade; abaixo disso o sistema alerta |
| Arredondamento | para cima | Garante o poder nominal |
| Normalidade | Shapiro-Wilk (α=0,05) | Quando rejeitada, o sistema alerta e sugere métodos não paramétricos/alternativos; não bloqueia automaticamente |
| Homogeneidade | Levene (robusto) e Bartlett | Bartlett é sensível à não normalidade; Levene é o padrão de decisão |
| Outliers | Grubbs bilateral, Cochran (variâncias), Hampel | Nenhum outlier é removido automaticamente; exige justificativa registrada |
| ANOVA | 1 fator (balanceada/desbalanceada); 2 fatores cruzados balanceados; modelo misto REML para 1 fator aleatório desbalanceado | Para desenhos cruzados desbalanceados, o sistema emite alerta e usa aproximação ANOVA, registrando a limitação |
| Componentes de variância | método dos momentos (ANOVA) para balanceado; REML para 1 fator | Coincide com ISO 5725-2 no caso balanceado |
| ISO 5725-2 | p laboratórios × n replicatas × q níveis, balanceado | s_r² = MSW; s_L² = (MSB−MSW)/n; s_R² = s_r²+s_L²; pooling por nível |
| Incerteza | GUM, entradas independentes | Tipo A = s/√n; Tipo B conforme distribuição; k=2 ou t(ν_eff) |
| Dados faltantes | análise por lista (listwise) com aviso | O delineamento e o relatório registram o n efetivo |
| Aleatorização | PRNG determinístico (mulberry32) com semente | Semente fica gravada; mesma semente → mesma ordem |
| z-score / En | z = (x−x_ref)/σ_pt; En = (x−x_ref)/√(u_lab²+u_ref²) | Quando aplicável a proficiência (ISO 17043/13528) |

### Fórmulas

Todas as fórmulas ficam em `src/stats/*` e são catalogadas em
`docs/FORMULAS.md`, com referência à norma/literatura. Nenhum resultado é
exibido sem: **fórmula, valor, critério de aceitação e veredito** (quando há
critério cadastrado).

## 6. Exportações

- **XLSX/CSV**: planilha de coleta e dados brutos.
- **DOCX**: relatório completo, com tabelas, gráficos (PNG) e assinaturas.
- **PDF**: prévia renderizada, paginada, com cabeçalho/rodapé e numeração.
- **ZIP de evidências**: dados CSV, resultados JSON, relatório DOCX/PDF, snapshot
  do banco `.sqlite`, manifesto com hashes SHA-256.
- **Banco**: `.sqlite` exportável/importável.

## 7. Testes

`npm test` executa Vitest. Casos de referência incluem:

- tamanho de amostra para teste t e TOST contra valores de `R power.t.test`;
- ANOVA e componentes de variância contra um conjunto balanceado ISO 5725-2;
- Shapiro-Wilk, Grubbs, Bartlett/Levene contra valores publicados;
- regressão linear e LD/LQ contra cálculo manual;
- orçamento GUM (exemplo de incerteza combinada e Welch-Satterthwaite);
- aleatorização reprodutível (mesma semente → mesma sequência);
- caracterização da saída analítica original (snapshot completo, sem `-u`),
  protegendo o comportamento existente durante a evolução por perfis.
