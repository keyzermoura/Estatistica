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
│  │  ├─ schema.ts            ← schema SQLite + migrações versionadas
│  │  ├─ db.ts                ← abertura/persistência e acesso ao SQLite
│  │  ├─ repository.ts        ← CRUD + auditoria + versionamento
│  │  ├─ spreadsheet.ts       ← XLSX/CSV de coleta (importação/exportação)
│  │  ├─ validation.ts        ← regras de integridade do modelo v2
│  │  ├─ seed.ts              ← método/validação de exemplo
│  │  ├─ export.ts            ← XLSX, CSV, DOCX, PDF, ZIP
│  │  ├─ report.ts            ← composição do relatório
│  │  ├─ criteria.ts          ← critérios de aceitação + métricas de tolerância
│  │  ├─ __tests__/           ← migração, planilhas, validações e critérios
│  │  └─ utils.ts
│  ├─ profiles/
│  │  ├─ types.ts             ← contrato MethodProfile
│  │  ├─ analytical.ts        ← catálogo e módulos do perfil analítico
│  │  ├─ dimensional.ts       ← catálogo e módulos do perfil dimensional
│  │  ├─ attribute.ts         ← catálogo e módulos do perfil de atributo
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
│     ├─ gagerr.ts            ← Gage R&R cruzado por ANOVA
│     ├─ nested.ts            ← ANOVA aninhada + Gage R&R destrutivo
│     ├─ iso5725.ts           ← repetibilidade/reprodutibilidade
│     ├─ regression.ts        ← linearidade, WLS, LOD/LOQ
│     ├─ bias.ts              ← tendência, recuperação, z, En, TOST
│     ├─ gageBiasLinearity.ts ← tendência por nível + linearidade AIAG
│     ├─ stability.ts         ← cartas I-MR/X̄-R, alarmes e resolução
│     ├─ attribute.ts         ← Cohen/Fleiss, kappa ponderado, FAR/FRR
│     ├─ attribute-data.ts    ← medições → observações de atributo
│     ├─ conformity.ts        ← regra de decisão, banda de guarda e riscos
│     ├─ uncertainty.ts       ← GUM + Welch-Satterthwaite
│     ├─ analysis.ts          ← orquestração genérica da análise
│     ├─ analysis-types.ts    ← contratos de resultado
│     ├─ analysis-utils.ts    ← métricas e resumos compartilhados
│     ├─ parameters/          ← módulos analíticos/dimensionais/de atributo
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
pressupostos e os templates de delineamento ficam em `src/profiles/`. Os perfis
`analytical`, `dimensional` e `attribute` compartilham o mesmo contrato. O motor
em `src/stats/analysis.ts` apenas orquestra os módulos indicados pelo perfil
ativo e mantém as regras gerais de veredito, qualidade e auditoria.

Desde a migração v2, `methods.family` registra a família do ensaio
(`analytical`, `dimensional`, `physical-destructive`,
`physical-nondestructive` ou `attribute`). Famílias ainda sem perfil próprio
usam o perfil analítico como fallback para não quebrar telas; métodos migrados
de versões anteriores são lidos como `analytical`.

O perfil `attribute` não exige migração de schema: ele reutiliza as colunas já
existentes. O mapeamento é explícito em `src/stats/attribute-data.ts`:

| Conceito do estudo | Coluna existente |
|---|---|
| Item / amostra | `sample` |
| Avaliador | `analyst` |
| Categoria observada | `category`, depois `text_value`, depois `value` |
| Referência conhecida | `level`, depois `reference_value` |
| Réplica | `replicate` |

O estudo usa `attributeAgreementStudy` para κ de Cohen/Fleiss, concordância
intra-avaliador, concordância com a referência, eficácia, FAR, FRR e cobertura.
Falhas de coleta (item/avaliador/réplica duplicados, referências conflitantes)
são capturadas e expostas como `not_evaluated`, com a mensagem no relatório.
`QcSummary.attribute` leva dados, estudo e erro para a interface e o laudo.

O módulo `src/stats/conformity.ts` é autônomo e entrega um bloco `report` com
regra, valor, `U`, `k`, limites efetivos e veredito. Ele ainda não altera
`ValidationAnalysis` nem os perfis existentes; a integração por perfil e a
seção de conformidade do laudo entram nos Prompts 8–10. As métricas `%P/T`,
`U/T` e `TUR/TAR` ficam em `src/lib/criteria.ts` e são aditivas: nenhuma
métrica analítica anterior muda.

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
| `methods` | id, code, name, type, **family**, unit, range_min/max, **lsl/usl**, **resolution**, **measurand**, **tolerance_unit**, equipment, reference_norm, validation_type, criteria_json | Cadastro do método, família e tolerâncias |
| `validations` | id, method_id, title, objective, scope, status, current_step, version, responsible, reviewer, approver, locked, approved_at, report_config_json | Processo de validação |
| `validation_parameters` | validation_id, param_key, selected, justification, criteria_json | Checklist de parâmetros |
| `designs` | validation_id, input_json, plan_json, seed, created_at | Delineamento, curva de poder e mapa de execução |
| `measurements` | validation_id, run_order, level, analyst, day, equipment, lot, sample, **part_id**, **specimen**, **destructive**, **condition_json**, **ref_value**, **ref_uncertainty**, **category**, replicate, value, reference_value, text_value, notes | Dados brutos dimensionais, físicos e de atributo |
| `analyses` | validation_id, parameter_key, kind, input_hash, results_json | Resultados congelados por versão |
| `uncertainty_items` | validation_id, source, type, distribution, value, divisor, sensitivity, std_uncertainty, dof | Orçamento GUM |
| `reports` | validation_id, version, status, content_json, elaborated/reviewed/approved, dates, locked | Relatório e assinaturas |
| `validation_versions` | validation_id, version, snapshot_json, reason, created_by, created_at | Histórico imutável |
| `audit_logs` | validation_id, entity, action, actor, before_json, after_json, reason, timestamp | Trilha de auditoria |
| `settings` | key, value_json | Configuração local |
| `schema_migrations` | version, applied_at, description | Versão aplicada do schema |

### Migrações versionadas

`src/lib/schema.ts` concentra o schema base e as migrações. Abrir um banco
antigo executa `CREATE TABLE IF NOT EXISTS` (sem alterar tabelas existentes) e
depois aplica, em transação, as versões pendentes registradas em
`schema_migrations`:

| Versão | Conteúdo |
|---|---|
| 1 | Schema inicial analítico (marco para bancos anteriores ao controle de versão) |
| 2 | `methods.family/lsl/usl/resolution/measurand/tolerance_unit` e `measurements.part_id/specimen/destructive/condition_json/ref_value/ref_uncertainty/category`; métodos existentes recebem `family = 'analytical'` |

As migrações são idempotentes: cada coluna é adicionada apenas se ausente e
cada versão é registrada uma única vez. O arquivo persistido em IndexedDB é
regravado logo após a abertura, de modo que a migração fica durável. Uma falha
de migração não substitui o banco por um vazio; o arquivo original permanece
intacto para diagnóstico e exportação.

Regras de integridade:

- `validations.locked = 1` após aprovação; repositório rejeita alterações.
- Toda escrita relevante gera `audit_logs` com antes/depois (inclusive métodos e
  a substituição completa das medições).
- Aprovar cria um snapshot em `validation_versions` e congela o relatório.
- Nova versão exige justificativa e incrementa `validations.version`.
- Família `dimensional` exige `measurements.part_id`; `destructive = 1` exige
  `specimen`; quando ambos os limites existem, `lsl < usl`. As regras valem na
  importação e no repositório.

## 4. Fluxo do usuário

1. **Método** — identificação, faixa, equipamento, norma, tipo de validação e critérios.
2. **Parâmetros** — checklist com sugestão automática por tipo de método.
3. **Delineamento** — confiança, poder, σ, efeito, margem; cálculo por parâmetro;
   desenho (CRD, blocos, fatorial, cruzado, aninhado, ISO 5725-2, concordância
   de atributo); curva de poder ou orientação de cegamento; aleatorização com
   semente; resumo leigo.
4. **Coleta** — formulário, planilha modelo, importação com validação, detecção de
   faltantes, desbalanceamento, valores fora da faixa, categorias ausentes,
   referências ausentes e duplicidades item/avaliador/réplica.
5. **Análise** — descritiva, gráficos, outliers, normalidade, homogeneidade,
   ANOVA, componentes de variância, ISO 5725-2, regressão/linearidade, LD/LQ,
   tendência/recuperação, z/En, TOST, orçamento de incerteza GUM e, no perfil de
   atributo, κ, eficácia, FAR, FRR e cobertura de referência.
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
| Atributo | 30 itens × 3 avaliadores × 3 réplicas (AIAG MSA); κ ≥ 0,75 conforme, 0,40–0,75 atenção | Itens limítrofes e referência conhecida; κ de Cohen/Fleiss; FAR/FRR só quando a categoria de aceitação é reconhecida; limites editáveis |
| Incerteza | GUM, entradas independentes | Tipo A = s/√n; Tipo B conforme distribuição; k=2 ou t(ν_eff) |
| Conformidade | aceitação simples, banda de guarda (`r=1`) ou probabilidade normal (`P≥0,95`) | Regra explícita e editável (ISO/IEC 17025, 7.8.2.1); limites fechados; três estados (conforme/não conforme/indeterminado). Riscos são específicos ao valor medido (JCGM 106), não globais |
| Alertas de tolerância | `TUR/TAR ≥ 4`, `U/T ≤ 0,25`, `%P/T ≤ 10%` | Limiares editáveis e apenas informativos; não mudam a decisão da regra. `TUR/TAR = T/(2U)`; `%P/T = 100·U/T` é distinto do `%P/T` do Gage R&R |
| Banda de guarda | `w = r·U`; se `w > T/2`, alerta de zona de aceitação vazia | `x` em `LSL+w`/`USL−w` é conforme; em `LSL−w`/`USL+w` é indeterminado; nenhum valor é corrigido automaticamente |
| `u = 0` na conformidade | riscos degenerados (0 ou 1); `TUR` nulo | Caso limite registrado, com alerta explícito; não se inventa denominador |
| Dados faltantes | análise por lista (listwise) com aviso | O delineamento e o relatório registram o n efetivo |
| Aleatorização | PRNG determinístico (mulberry32) com semente | Semente fica gravada; mesma semente → mesma ordem |
| z-score / En | z = (x−x_ref)/σ_pt; En = (x−x_ref)/√(u_lab²+u_ref²) | Quando aplicável a proficiência (ISO 17043/13528) |

### Fórmulas

Todas as fórmulas ficam em `src/stats/*` e são catalogadas em
`docs/FORMULAS.md`, com referência à norma/literatura. Nenhum resultado é
exibido sem: **fórmula, valor, critério de aceitação e veredito** (quando há
critério cadastrado).

## 6. Exportações

- **XLSX/CSV**: planilha de coleta e dados brutos. Inclui as novas colunas de
  identificação (`Parte`, `Corpo de prova`, `Destrutivo`), condições de ensaio,
  padrão de referência (`Valor/Incerteza da referência`) e categoria. O XLSX
  traz também a aba `Método` com família, LSL/USL, resolução, mensurando e
  unidade de tolerância.
- **Importação**: orientada por cabeçalho, com aliases em português/inglês.
  Planilhas antigas continuam válidas; colunas ausentes assumem valores
  neutros. A primeira aba é sempre lida como medições.
- **DOCX**: relatório completo, com tabelas, gráficos (PNG) e assinaturas.
- **PDF**: prévia renderizada, paginada, com cabeçalho/rodapé e numeração.
- **ZIP de evidências**: dados CSV, `metodo.json` com os novos campos do método,
  resultados JSON, relatório DOCX/PDF, snapshot do banco `.sqlite`, manifesto
  com hashes SHA-256.
- **Banco**: `.sqlite` exportável/importável; ao importar, as migrações são
  aplicadas antes de disponibilizar os dados.

## 7. Testes

`npm test` executa Vitest. Casos de referência incluem:

- tamanho de amostra para teste t e TOST contra valores de `R power.t.test`;
- ANOVA e componentes de variância contra um conjunto balanceado ISO 5725-2;
- Shapiro-Wilk, Grubbs, Bartlett/Levene contra valores publicados;
- regressão linear e LD/LQ contra cálculo manual;
- orçamento GUM (exemplo de incerteza combinada e Welch-Satterthwaite);
- conformidade contra valores exatos de Φ, com riscos específicos conferidos por
  integração numérica independente (tolerância 1e-6), incluindo bordas `x` no
  limite, `u = 0` e banda de guarda maior que a tolerância;
- métricas `%P/T`, `U/T` e `TUR/TAR` contra cálculo direto e casos sem
  denominador;
- aleatorização reprodutível (mesma semente → mesma sequência);
- caracterização da saída analítica original (snapshot completo, sem `-u`),
  protegendo o comportamento existente durante a evolução por perfis;
- migração de um `.sqlite` real da versão anterior, comparando dados
  antes/depois e verificando idempotência;
- round-trip XLSX/CSV de todas as colunas de medição e compatibilidade com
  planilhas antigas;
- regras de integridade (`part_id` dimensional, `specimen` destrutivo e
  `lsl < usl`).
