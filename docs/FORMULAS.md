# Fórmulas e decisões estatísticas — ValidaMétodo

Este documento cataloga as fórmulas implementadas no núcleo estatístico
(`src/stats/`), a referência de cada uma e a forma como o sistema transforma o
resultado em veredito. O motor é **TypeScript próprio**, sem biblioteca externa
de estatística; os testes de `src/stats/__tests__/stats.test.ts` comparam os
valores com `scipy`, `R` e resultados publicados, e o teste de caracterização
`analysis-characterization.test.ts` protege a saída analítica original.

> Regra do produto: nenhum resultado é apresentado como conforme sem dado
> numérico **e** critério de aceitação cadastrado. Sem um dos dois, o veredito é
> **não avaliado**. Nenhum outlier é removido automaticamente.

## 1. Notação

| Símbolo | Significado |
|---|---|
| `n` | número de observações válidas |
| `x̄`, `s`, `s²` | média, desvio-padrão amostral e variância amostral (divisor `n−1`) |
| `α` | nível de significância (padrão 0,05) |
| `1−α` | confiança (padrão 0,95) |
| `1−β` | poder (padrão 0,80) |
| `t_{p,ν}` | quantil `p` da t de Student com `ν` graus de liberdade |
| `F_{p,d1,d2}` | quantil `p` da distribuição F |
| `Φ`, `F_t`, `F_F`, `F_χ²` | funções de distribuição acumulada normal, t, F e χ² |
| `F′` | distribuição não central |
| `ν_eff` | graus de liberdade efetivos de Welch–Satterthwaite |
| `u_i`, `u_c`, `U` | incerteza padrão da fonte, combinada e expandida |

As distribuições são implementadas em `src/stats/distributions.ts` com
`lnGamma` (Lanczos), `erfc` (Cody), inversa normal (Acklam + Halley), gama e
beta incompletas, t, χ², F e as versões não centrais. As inversas de t, χ² e F
usam bisseção com tolerância numérica; não há dependência de runtime.

## 2. Estatística descritiva

Arquivo: `src/stats/descriptive.ts`.

| Métrica | Fórmula |
|---|---|
| Média | `x̄ = Σx_i / n` |
| Variância amostral | `s² = Σ(x_i − x̄)² / (n−1)` |
| Desvio-padrão | `s = √s²` |
| Erro padrão da média | `EP = s/√n` |
| Coeficiente de variação | `CV% = 100·s/|x̄|` |
| Quantil | interpolação linear, método 7 de Hyndman & Fan |
| Assimetria ajustada | `G1 = n/[(n−1)(n−2)] · Σ[(x_i−x̄)/s]³` |
| Curtose em excesso | `G2 = {n(n+1)/[(n−1)(n−2)(n−3)]}·Σz_i⁴ − 3(n−1)²/[(n−2)(n−3)]` |
| IC da média | `x̄ ± t_{1−α/2,n−1}·s/√n` |
| IC de proporção (Wilson) | `[p + z²/(2n) ± z√(p(1−p)/n + z²/(4n²))] / (1 + z²/n)` |

Referências: ISO 3534-1:2006; Montgomery & Runger, cap. 8.

## 3. Tamanho de amostra e poder

Arquivo: `src/stats/sampleSize.ts`. Todos os cálculos arredondam `n` para cima
e usam a distribuição exata (t ou F não central), não apenas a aproximação
normal. A busca do menor `n` é binária (`findN`).

### 3.1 Média com margem de erro

```
n = (t_{1−α/2, n−1} · σ / E)²
```

`E` é a semi-amplitude do IC. Como `n` aparece nos dois lados, o sistema parte
da aproximação normal e itera até estabilizar. Referências: ISO 3534-1;
Montgomery & Runger, cap. 8; Chow, Shao & Wang (2008).

### 3.2 Teste t de uma ou duas amostras

```
EP = σ·√(2/n)          (duas amostras, n por grupo)
EP = σ/√n              (uma amostra ou diferenças pareadas)
δ  = |Δ| / EP
Poder = 1 − F_{t′}(t_crítico; ν, δ) + F_{t′}(−t_crítico; ν, δ)
ν = 2n − 2             (duas amostras)
ν = n − 1              (uma amostra/pareado)
```

`t_crítico = t_{1−α/2,ν}` no bilateral e `t_{1−α,ν}` no unilateral. O `n` é o
menor inteiro cujo poder atinge `1−β`. Referências: Chow et al. (2008), cap. 2;
R `power.t.test`; Montgomery & Runger.

### 3.3 TOST (equivalência)

```
Poder = F_t(δ − t_{1−α,ν}) − F_t(−δ + t_{1−α,ν})
δ = margem / EP
```

Assume diferença verdadeira nula (cenário conservador). O IC de equivalência é
`1−2α` (90% quando `α = 5%`). Referências: Schuirmann (1987); Chow et al.
(2008), cap. 3; FDA/ICH E9.

### 3.4 Razão de variâncias

Sob `H₁`, `F = r²·F_{ν,ν}`, com `r = σ₁/σ₂` e `ν = n−1`. O poder bilateral é

```
Poder = P(F < f_inf/r²) + P(F > f_sup/r²)
```

com `f_inf = F_{α/2,ν,ν}` e `f_sup = F_{1−α/2,ν,ν}`. Referências: Montgomery &
Runger, cap. 9; ISO 5725-2.

### 3.5 ANOVA de um fator

```
λ = n·k·f²
ν₁ = k − 1
ν₂ = k(n − 1)
Poder = 1 − F_{F′}(F_{1−α,ν₁,ν₂}; ν₁, ν₂, λ)
```

`f` é o efeito de Cohen (desvio-padrão das médias dividido por `σ`). Para
`k = 2`, `f = d/2`. Referências: Cohen (1988), cap. 8; Montgomery & Runger,
cap. 13.

### 3.6 Outros planejamentos

| Situação | Fórmula / regra |
|---|---|
| Erro relativo de `s` | `EP(s)/s ≈ 1/√(2(n−1))` ⇒ `n = 1 + 1/(2·erro_relativo²)` |
| Média com erro relativo | `n = (z_{1−α/2}/erro_relativo)²` |
| ISO 5725-2 | `ν_r = p(n−1)`; `ν_L = p−1`; erro relativo de `s_r ≈ 1/√(2ν_r)`; `s_R` por Welch–Satterthwaite com `σ_L/σ_r` informado; busca `p ∈ [6,30]` e `n ∈ [2,10]` que atende ao alvo com menor total |
| Aninhado destrutivo | `ν_E = a·b·(n−1)`; `EP(s_r)/s_r = 1/√(2ν_E)`; IC de `σ_GRR` por χ² com `ν_GRR` de Satterthwaite; `findN` busca o menor `n` que atende à largura do IC ou ao erro relativo de `s_r` |
| LD/LQ | orientação: ≥ 10 brancos ou ≥ 6 níveis baixos; curva com ≥ 5 níveis × 3 réplicas |
| Linearidade | mínimo 5 níveis × 3 réplicas |
| Seletividade | branco + fortificada, ≥ 3 réplicas por condição |
| Robustez | fatorial 2^k (3 fatores = 8 combinações) × ≥ 2 réplicas |
| Incerteza | ≥ 10 réplicas recomendadas; o orçamento GUM usa as fontes cadastradas |

## 4. Delineamento e aleatorização

Arquivo: `src/stats/design.ts`.

```
total = max(6, maior total entre os planos dos parâmetros selecionados)
```

Se houver substituição manual (`manualOverride`), prevalece o total informado.
O plano de execução é gerado conforme o desenho (CRD, blocos, fatorial,
aninhado, aninhado destrutivo, cruzado, ISO 5725-2 ou concordância de atributo)
e a ordem é embaralhada
por Fisher–Yates com um PRNG determinístico **mulberry32** e semente
registrada. A mesma semente reproduz exatamente a mesma ordem. No desenho
`nested_destructive`, cada réplica é um corpo de prova identificado
(`CP-001`, …) e o plano informa o total de corpos de prova a retirar do lote.
A curva de poder usa o poder do teste t de duas amostras para `n = 2…max`.

No desenho `attribute_agreement`, `nSamples` é o total de amostras **incluindo**
as limítrofes (subconjunto `nBorderlineSamples`). O plano gera
`amostras × avaliadores × réplicas` execuções, com referência conhecida,
códigos cegos `A-###` (permutação aleatória reprodutível) e ordem global
embaralhada pela semente; o avaliador não vê a referência nem a condição
limítrofe. O template do perfil sugere 30 amostras (6 limítrofes), 3 avaliadores
e 3 réplicas.

Referências: Montgomery (2020); ISO 5725-2:2019; Chow et al. (2008).

## 5. Outliers

Arquivo: `src/stats/outliers.ts`.

### 5.1 Grubbs

```
G = max_i |x_i − x̄| / s
G_crítico = ((n−1)/√n) · √(t²/(n−2+t²))
t = t_{1−α/(2n), n−2}   (bilateral; α/n no unilateral)
```

O p-valor é aproximado pela t com `n−2` graus de liberdade. O sistema sinaliza,
mas **não remove** o valor; a exclusão exige justificativa no repositório.
Referências: Grubbs (1969); ISO 5725-2:2019, anexo B; ASTM E178.

### 5.2 Cochran

```
C = s²_max / Σ s²_i
```

Comparado com a tabela de Cochran para `α = 0,05` (k grupos, `df = n−1`).
Referências: Cochran (1941); ISO 5725-2:2019, anexo B.

### 5.3 Hampel e z robusto

```
MAD = mediana(|x_i − mediana(x)|)
σ_robusto = 1,4826 · MAD
limite = mediana ± k · σ_robusto      (k = 3 por padrão)
z_robusto = (x_i − mediana) / σ_robusto
```

Referências: Hampel (1974); ISO 13528:2022, anexo C.

## 6. Normalidade

Arquivo: `src/stats/normality.ts`.

| Teste | Estatística | Observação |
|---|---|---|
| Shapiro–Wilk | `W = (Σa_i x_(i))² / Σ(x_i−x̄)²` | coeficientes e p-valor de Royston/AS R94; `n ≥ 3` |
| Anderson–Darling | `A² = −n − (1/n)Σ(2i−1)[lnF(x_(i)) + ln(1−F(x_(n+1−i)))]` | `A* = A²(1 + 0,75/n + 2,25/n²)`; p de Stephens; `n ≥ 8` |
| Jarque–Bera | `JB = (n/6)[S² + (K−3)²/4]` | assintótico, `χ²` com 2 g.l.; `n ≥ 8` |

O teste principal é Shapiro–Wilk. A bateria exibe os três; se todos rejeitarem,
o relatório alerta; se houver divergência, pede avaliação gráfica. A decisão
não bloqueia automaticamente a análise. Referências: Shapiro & Wilk (1965);
Royston (1995); Anderson & Darling (1954); Stephens (1986); Jarque & Bera (1980).

## 7. Homogeneidade de variâncias

Arquivo: `src/stats/variance.ts`.

### 7.1 Teste F (duas variâncias)

```
F = s₁²/s₂²
p = 2·min(F_F(F; ν₁,ν₂), 1−F_F(F; ν₁,ν₂))   (bilateral)
```

### 7.2 Bartlett

```
χ² = [(N−k)·ln(s²_p) − Σ(n_i−1)·ln(s²_i)] / C
C = 1 + [1/(3(k−1))]·[Σ 1/(n_i−1) − 1/(N−k)]
s²_p = Σ(n_i−1)s²_i / (N−k)
```

### 7.3 Levene / Brown–Forsythe

```
z_ij = |x_ij − centro_i|
F = [Σ n_i(z̄_i−z̄)²/(k−1)] / [ΣΣ(z_ij−z̄_i)²/(N−k)]
```

`centro` é a média (Levene) ou a mediana (Brown–Forsythe). **Levene é o teste
de decisão**; Bartlett é exibido como sensível à não normalidade. Referências:
Bartlett (1937); Levene (1960); Brown & Forsythe (1974); ISO 5725-2.

## 8. ANOVA e componentes de variância

Arquivo: `src/stats/anova.ts`.

### 8.1 Um fator

```
SS_entre = Σ n_i(x̄_i − x̄)²
SS_dentro = ΣΣ(x_ij − x̄_i)²
MS_entre = SS_entre/(k−1)
MS_dentro = SS_dentro/(N−k)
F = MS_entre/MS_dentro
η² = SS_entre/SS_total
```

### 8.2 Welch (variâncias desiguais)

```
w_i = n_i/s_i²
W = Σw_i
m_w = Σw_i x̄_i / W
A = [Σw_i(x̄_i−m_w)²]/(k−1)
B = 1 + [2(k−2)/(k²−1)]·Σ[(1−w_i/W)²/(n_i−1)]
F = A/B
ν₂ = (k²−1)/(3·Σ[(1−w_i/W)²/(n_i−1)])
```

### 8.3 Dois fatores cruzados balanceados

```
SS_A = b·n·Σ(x̄_i·· − x̄)²
SS_B = a·n·Σ(x̄_·j· − x̄)²
SS_AB = n·Σ(x̄_ij· − x̄_i·· − x̄_·j· + x̄)²
SS_E = ΣΣΣ(x_ijk − x̄_ij·)²
```

Componentes por momentos:

```
s²_e  = MS_E
s²_ab = max(0, (MS_AB − MS_E)/n)
s²_a  = max(0, (MS_A − MS_AB)/(b·n))
s²_b  = max(0, (MS_B − MS_AB)/(a·n))
```

Componentes negativos são truncados em zero. Desenhos desbalanceados recebem
alerta: a decomposição é aproximada e o relatório registra a limitação.
Referências: Montgomery (2020), caps. 3–13; ISO 5725-2:2019; Searle, Casella &
McCulloch (1992); Welch (1951).

### 8.4 Um fator aleatório (componentes)

```
n₀ = [N − Σn_i²/N]/(k−1)
s²_dentro = MS_dentro
s²_entre = max(0, (MS_entre − MS_dentro)/n₀)
```

### 8.5 Gage R&R cruzado por ANOVA

Arquivo: `src/stats/gagerr.ts`. Entrada `y[parte][operador][réplica]`, com
`p` peças, `o` operadores e `r` réplicas. O modelo aleatório é

```
y_ijk = μ + P_i + O_j + (PO)_ij + e_ijk
```

com `P_i ~ N(0, σ²_peça)`, `O_j ~ N(0, σ²_oper)`,
`(PO)_ij ~ N(0, σ²_inter)` e `e_ijk ~ N(0, σ²_rep)`. Para o desenho
balanceado:

```
SS_P  = o·r·Σ(x̄_i·· − x̄)²
SS_O  = p·r·Σ(x̄_·j· − x̄)²
SS_PO = r·Σ(x̄_ij· − x̄_i·· − x̄_·j· + x̄)²
SS_E  = ΣΣΣ(x_ijk − x̄_ij·)²
gl_P = p−1; gl_O = o−1; gl_PO = (p−1)(o−1); gl_E = p·o·(r−1)
```

O teste da interação é `F = MS_PO/MS_E`, com `gl_PO` e `gl_E`. Se
`p > limiar` (padrão 0,25, editável), adota-se o modelo sem interação:
`SS_E,red = SS_PO + SS_E` e `gl_E,red = gl_PO + gl_E`. A decisão e o limiar
ficam registrados no resultado. O modelo também pode ser fixado manualmente.

Componentes pelo método dos momentos, com truncamento em zero:

```
σ²_rep   = MS_E
σ²_inter = max(0, (MS_PO − MS_E)/r)
σ²_oper  = max(0, (MS_O − MS_PO)/(p·r))
σ²_peça  = max(0, (MS_P − MS_PO)/(o·r))
σ²_GRR   = σ²_rep + σ²_oper + σ²_inter
σ²_total = σ²_GRR + σ²_peça
```

No modelo reduzido, `MS_E` é substituído por `MS_E,red` e
`σ²_inter = 0` (a interação foi agregada ao erro).

Métricas e critérios padrão editáveis:

```
%GRR  = 100·σ_GRR/σ_total
%P/T  = 100·k·σ_GRR/T, com T = USL − LSL e k = 6 por padrão
ndc   = floor(1,41·σ_peça/σ_GRR)
contribuição_i = 100·σ²_i/σ²_total
```

`%GRR` e `%P/T` usam `≤ 10%` conforme, `> 10%` e `≤ 30%` atenção e
`> 30%` não conforme; `ndc ≥ 5` é conforme. Sem `T`, `%P/T` fica não
avaliado. Nenhum critério é inventado quando o dado não existe.

Os graus de liberdade efetivos seguem Satterthwaite:

```
ν = (Σ c_i·MS_i)² / Σ[(c_i·MS_i)²/gl_i]
```

O IC de `σ_GRR` usa `gl·σ²_GRR/χ²`; o IC de `%GRR` usa a razão
`σ²_GRR/σ²_peça` com quantis `F(ν_GRR, ν_peça)` e a transformação
`θ = R/(1+R)`, `%GRR = 100·√θ`. O IC de `%P/T` é derivado do IC de
`σ_GRR`. Quando um componente é zero ou os graus de liberdade não são
estimáveis, o IC fica explicitamente indisponível com alerta.

Dados faltantes são descartados por lista (observações válidas restantes);
por padrão (`unbalancedMethod: 'sequential_ls'`), o desenho desbalanceado usa
somas de quadrados sequenciais (peça → operador → interação), estimação por
mínimos quadrados ponderados e `r_eff = N/células`. O resultado registra `N`,
`r_eff`, o número de observações ausentes e alerta sobre a aproximação. `r = 1`
falha claramente, pois não permite estimar a repetibilidade.

Alternativamente, o parâmetro `unbalancedMethod` e o comparador
`gageRRUnbalancedMethods` suportam dois métodos exatos para desenhos
desbalanceados (ou comparativos em desenhos balanceados):

- **Método 3 de Henderson / Tipo III (`'type3_henderson'`)**: calcula somas de
  quadrados parciais ortogonais `SS_P = R(P | μ, O)`, `SS_O = R(O | μ, P)` e
  `SS_PO = R(PO | μ, P, O)` com coeficientes exatos da esperança matemática dos
  quadrados médios (`E[MS] = tr(M·Z·Zᵀ)`) e ICs de Satterthwaite derivados da
  combinação linear exata das médias quadráticas;
- **REML cruzado de dois fatores (`'reml'`)**: minimiza a deviância restrita
  exata `−2ℓ_R(γ) = (N−1)·ln σ²_e(γ) + ln|H(γ)| + ln(w₁ᵀ H(γ)⁻¹ w₁)` por
  estatísticas suficientes de célula (`O(K³)` via fatoração de Cholesky e
  otimização restrita com `γ = (σ²_peça/σ²_e, σ²_oper/σ²_e, σ²_inter/σ²_e) ≥ 0`).

Referências: AIAG (2010), *Measurement Systems Analysis Reference Manual*,
4. ed.; Montgomery (2020), cap. 13; Burdick, Borror & Montgomery (2003);
Satterthwaite (1946); ISO 22514-7:2021; Searle, Casella & McCulloch (1992),
caps. 5–6; Henderson (1953); Patterson & Thompson (1971).

### 8.6 ANOVA aninhada e Gage R&R para ensaio destrutivo

Arquivo: `src/stats/nested.ts`. Para ensaios em que o mesmo corpo de prova não
pode ser medido duas vezes (tração, ruptura, encastoamento), o modelo aleatório
balanceado de três níveis é

```
y_ijk = μ + A_i + B_j(i) + e_k(ij)
```

com `A_i ~ N(0, σ²_A)` (operador), `B_j(i) ~ N(0, σ²_B(A))` (amostra dentro de
operador) e `e_k(ij) ~ N(0, σ²_e)` (réplica/corpo de prova), para `a`
operadores, `b` amostras por operador e `n` réplicas por amostra. As somas de
quadrados e graus de liberdade são

```
SS_A    = b·n·Σ_i(x̄_i·· − x̄)²
SS_B(A) = n·Σ_iΣ_j(x̄_ij· − x̄_i··)²
SS_E    = Σ_iΣ_jΣ_k(x_ijk − x̄_ij·)²
gl_A = a−1; gl_B(A) = a(b−1); gl_E = a·b·(n−1)
F_A = MS_A/MS_B(A); F_B(A) = MS_B(A)/MS_E
```

Componentes pelo método dos momentos, com truncamento em zero:

```
σ²_e    = MS_E
σ²_B(A) = max(0, (MS_B(A) − MS_E)/n)
σ²_A    = max(0, (MS_A − MS_B(A))/(b·n))
```

Com `b = 1` (Operador > Réplica), `σ²_B(A)` não é separável de `σ²_e`; o
cálculo é delegado a `iso5725Analysis`, que fornece `s_r² = MS_E` e
`s_L² = max(0, (MS_A − MS_E)/n)`. O resultado registra `twoLevel = true` e
fixa a componente de amostragem em zero como não estimável.

O Gage R&R aninhado separa a variação entre amostras como **variação de
amostragem** e calcula

```
σ²_GRR   = σ²_e + σ²_A
σ²_total = σ²_GRR + σ²_B(A)
%GRR     = 100·σ_GRR/σ_total
%P/T     = 100·k·σ_GRR/T, com T = USL − LSL e k = 6 por padrão
ndc      = floor(1,41·σ_B(A)/σ_GRR)
contribuição_i = 100·σ²_i/σ²_total
```

A componente entre amostras entra apenas no denominador de `%GRR` e em `ndc`;
não compõe `σ²_GRR`. Os critérios padrão são os mesmos do Gage R&R cruzado
(`≤ 10%` conforme, `> 10%` e `≤ 30%` atenção, `> 30%` não conforme;
`ndc ≥ 5`) e são editáveis. Sem `T`, `%P/T` fica não avaliado. Os ICs usam
Satterthwaite para os graus de liberdade efetivos, χ² para `σ_GRR` e a razão
`σ²_GRR/σ²_B(A)` com quantis `F` para `%GRR`; `%P/T` é derivado do IC de
`σ_GRR`. Células incompletas e `n = 1` falham claramente.

**Aviso obrigatório:** em ensaio destrutivo a repetibilidade inclui a variação
entre corpos de prova e a validade do estudo depende da homogeneidade do lote.
O aviso acompanha `warnings`, `summary` e o relatório.

`homogeneityCheck` avalia a homogeneidade do lote combinando três
procedimentos, todos com nível `α` (padrão 0,05):

```
ANOVA entre amostras: F = MS_entre/MS_dentro, gl = (k−1, N−k)
Cochran: C = s²_máx/Σs²_i; C_crítico ≈ 1/[1 + (k−1)·F_{α/k}(ν,ν)], ν = n−1
Razão de variâncias: F = s²_máx/s²_mín, com α ajustado por Bonferroni
```

A aproximação do valor crítico de Cochran é a forma conservadora de Wilrich;
o teste de Cochran não fornece p-valor e é sensível à não normalidade. A razão
de variâncias usa o menor `n−1` quando os grupos têm tamanhos diferentes e
corrige o nível por todos os pares. A homogeneidade é rejeitada se qualquer
teste rejeitar; se rejeitada, é obrigatório registrar justificativa técnica
para prosseguir, e o aceite fica registrado no resultado. Quando falta um dos
testes, o veredito é “não avaliado”, nunca conforme por omissão.

No fluxo físico destrutivo, a verificação é habilitada por
`ReportConfig.homogeneityCheck` e a justificativa é persistida em
`ReportConfig.homogeneityJustification`. O adaptador
`src/stats/parameters/physical.ts` deriva um grupo por valor distinto da coluna
`Amostra`, reunindo os corpos de prova medidos por todos os operadores. São
necessários pelo menos 2 grupos com 2 ou mais observações. A opção chega ao
motor por `AnalysisOptions.homogeneity` e é repassada ao `gageRRNested`. Se o
lote for rejeitado sem justificativa, o parâmetro é devolvido como
**não avaliado** com a mensagem acionável; com justificativa, o estudo prossegue
e a tabela de homogeneidade, os testes e a justificativa acompanham o
resultado e o relatório. Quando a opção está desabilitada, o resultado registra
que a homogeneidade não foi avaliada.

`nestedDesignN` mantém fixos operadores (`a`) e amostras por operador (`b`) e
busca o menor número de réplicas `n` que atinja a largura-alvo do IC de
`σ_GRR` ou o erro relativo-alvo de `s_r`, reutilizando `findN`:

```
E[MS_E]    = σ²_e
E[MS_B(A)] = σ²_e + n·σ²_B(A)
E[MS_A]    = σ²_e + n·σ²_B(A) + b·n·σ²_A
σ²_GRR     = σ²_e + σ²_A
EP(s_r)/s_r = 1/√(2·a·b·(n−1))
largura do IC de σ_GRR = √σ²_GRR·[√(ν/χ²_{α/2,ν}) − √(ν/χ²_{1−α/2,ν})]
```

O plano reporta o total de corpos de prova a retirar do lote: `a·b·n`.

No delineamento `nested_destructive` de `src/stats/design.ts`, o plano gera
`a` operadores × `b` amostras × `n` corpos de prova, com identificação
`CP-001`, `CP-002`, … e `factorValues.corpo_de_prova`, na ordem embaralhada
por mulberry32 + Fisher–Yates com semente registrada. `specimenConsumption`
totaliza os corpos de prova consumidos. Com `b = 1`, o plano alerta que a
componente entre amostras não é estimável.

Referências: Montgomery (2020), cap. 14; ISO 5725-2:2019, cláusulas 5–7;
AIAG (2010), *Measurement Systems Analysis Reference Manual*, 4. ed.;
Satterthwaite (1946); Cochran (1941); Wilrich (2010); Searle, Casella &
McCulloch (1992).

## 9. Precisão ISO 5725-2

Arquivo: `src/stats/iso5725.ts`. Para cada nível, com `p` laboratórios e `n`
réplicas:

```
MS_entre = n/(p−1) · Σ(x̄_lab − x̄_geral)²
MS_dentro = Σ(n_i−1)s_i² / Σ(n_i−1)
s_r² = MS_dentro
s_L² = max(0, (MS_entre − MS_dentro)/n)
s_R² = s_r² + s_L²
r = 2,8·s_r
R = 2,8·s_R
CV_r = 100·s_r/|média|
CV_R = 100·s_R/|média|
```

O pooled combina `s_r²` ponderado pelos graus de liberdade e `s_L²` ponderado
por `p−1`. Os graus de liberdade de `s_R` usam Welch–Satterthwaite:

```
ν_R = (s_r² + s_L²)² / [s_r⁴/ν_r + s_L⁴/ν_L]
```

Mandel `h` (média do laboratório) e `k` (desvio-padrão do laboratório) são
avaliados pelos limites críticos exatos da ISO 5725-2:2019 (Anexo B,
Tabelas B.1 e B.2), com triagem em dois níveis: **5% (*straggler* / suspeito)**
e **1% (*outlier* / aberrante)**:

```
h_crit(p, α)    = (p − 1) · t_{1−α/2, p−2} / √[p · (t²_{1−α/2, p−2} + p − 2)]   (p ≥ 3)
k_crit(p, n, α) = √[ p · F_{1−α; n−1, (p−1)(n−1)} / (p − 1 + F) ]               (p ≥ 2, n ≥ 2)
```

`mandelHCritical`, `mandelKCritical` e `evaluateMandelConsistency` expõem os
limiares exatos de 5% e 1%; em `iso5725Analysis`, `hFlag`/`kFlag` sinalizam
violações ao limite de 1% (com fallback para `2` quando `p < 3` ou `n < 2`).
Referências: ISO 5725-1:2023; ISO 5725-2:2019, cláusulas 5–7 e Anexo B;
Mandel (1991); Wilrich (2013).

## 10. Regressão, linearidade e LD/LQ

Arquivo: `src/stats/regression.ts`.

### 10.1 Mínimos quadrados ordinários

```
b = S_xy/S_xx
a = ȳ − b·x̄
ŷ_i = a + b·x_i
e_i = y_i − ŷ_i
s_yx = √[Σe_i²/(n−2)]
EP(b) = s_yx/√S_xx
EP(a) = s_yx·√(1/n + x̄²/S_xx)
R² = 1 − SS_res/SS_tot
R²_aj = 1 − (1−R²)(n−1)/(n−2)
F = (SS_reg/1)/(SS_res/(n−2))
```

Os ICs usam `t_{1−α/2,n−2}` e os p-valores usam a t bilateral. A falta de
ajuste é testada quando há réplicas em `x`:

```
SS_puro = ΣΣ(y_ij − ȳ_i)²
SS_falta = SS_res − SS_puro
F = [SS_falta/(ν_res−ν_puro)] / [SS_puro/ν_puro]
```

### 10.2 Regressão ponderada (WLS)

Minimiza `Σw_i(y_i − a − b·x_i)²`; as médias, `S_xx`, `S_xy` e os erros padrão
são ponderados por `w_i`. Referência: Draper & Smith (1998), cap. 9.

### 10.3 LD/LQ

| Abordagem | Fórmula |
|---|---|
| Curva de calibração | `LD = 3,3·s_yx/|b|`; `LQ = 10·s_yx/|b|` |
| Brancos | `LD = x̄_branco + 3·s_branco`; `LQ = x̄_branco + 10·s_branco` |

Referências: ISO 8466-1:2021; ISO 11843-2; IUPAC (1997); ICH Q2(R2).

## 11. Exatidão, tendência, recuperação e proficiência

Arquivo: `src/stats/bias.ts`.

### 11.1 Teste t pareado de tendência

```
d_i = medido_i − referência_i
d̄ = Σd_i/n
EP_d = s_d/√n
t = d̄/EP_d,  ν = n−1
IC = d̄ ± t_{1−α/2,n−1}·EP_d
tendência% = 100·d̄/|x̄_ref|
```

### 11.2 Recuperação

```
R_i% = 100·medido_i/referência_i
R̄ = ΣR_i/n
IC = R̄ ± t_{1−α/2,n−1}·s_R/√n
```

Se houver critério `[L_inf, L_sup]`, a recuperação é aceitável quando o IC
inteiro está dentro do intervalo; sem critério, usa-se o p-valor do teste
`H₀: R = 100%`.

### 11.3 TOST

```
t_low  = (d̄ + margem)/EP_d
t_high = (margem − d̄)/EP_d
p_low  = 1 − F_t(t_low, n−1)
p_high = 1 − F_t(t_high, n−1)
p = max(p_low, p_high)
equivalente se p < α
IC 1−2α = d̄ ± t_{1−α,n−1}·EP_d
```

### 11.4 Proficiência

```
z = (x − x_ref)/σ_pt
E_n = (x − x_ref)/√(u_lab² + u_ref²)
```

`|z| ≤ 2` satisfatório; `2 < |z| ≤ 3` questionável; `|z| > 3` insatisfatório.
`|E_n| ≤ 1` compatível. Referências: ISO 13528:2022; ISO 17043; Schuirmann
(1987); ISO 5725-4:2020; EURACHEM (2014).

### 11.5 Intervalo de tolerância

Aproximação de Howe para cobertura e confiança informadas:

```
k = z + (z²+1)/(2n) + (5z³+16z)/(12n²) + (3z⁵+19z³+17z)/(24n³)
limites = x̄ ± k·s
```

### 11.6 Tendência por nível e linearidade do instrumento (AIAG)

Arquivo: `src/stats/gageBiasLinearity.ts`. A entrada é uma lista de níveis de
referência, cada um com réplicas medidas no mesmo nível. A tolerância
`T = USL − LSL` e a variação do processo `VP = 6σ_processo` são opcionais.

Por nível:

```
bias_i = x̄_i − ref_i
EP_i   = s_i/√n_i                         (sem incerteza do padrão)
EP_i   = √(s_i²/n_i + u_ref_i²)           (com incerteza-padrão do padrão)
t_i    = bias_i/EP_i
ν_i    = n_i − 1                          (u_ref conhecida)
ν_i    = (s_i²/n_i + u_ref_i²)² /
         [(s_i²/n_i)²/(n_i−1) + (u_ref_i²)²/ν_ref]   (Welch–Satterthwaite)
IC_i   = bias_i ± t_{1−α/2,ν_i}·EP_i
tendência/T   = 100·bias_i/T
tendência/ref = 100·bias_i/|ref_i|
```

A linearidade segue o método AIAG e reutiliza a regressão OLS de
`regression.ts` sobre todos os pares individuais `(ref_i, bias_ij)`:

```
bias_ij = a + b·ref_i + e_ij
b = S_xy/S_xx;  a = ȳ − b·x̄
s_yx = √[Σe_ij²/(N−2)]
EP(b) = s_yx/√S_xx;  EP(a) = s_yx·√(1/N + x̄²/S_xx)
t_b = b/EP(b);  t_a = a/EP(a);  ν = N − 2
linearidade   = |b|·VP
%linearidade  = 100·|b| = 100·linearidade/VP
%linearidade/T = 100·linearidade/T
```

O declive `b` e o intercepto `a` são testados bilateralmente. O estudo deve ter
**pelo menos 5 níveis** e **pelo menos 3 réplicas por nível**, cobrindo a faixa
de uso; essas condições entram como métricas de delineamento com veredito
editável. Os critérios padrão de 5% (conforme) e 10% (atenção) para
`|tendência|/T` e `%linearidade` são orientação AIAG, não norma, e podem ser
alterados. Cada nível e cada métrica do resumo carrega fórmula, valor, critério
e veredito; nenhum ponto é removido automaticamente.

### 11.7 Estabilidade: cartas I-MR e X̄-R

Arquivo: `src/stats/stability.ts`.

Carta I-MR, para observações individuais em ordem cronológica:

```
MR_i = |x_i − x_{i−1}|
LC_I = x̄;        LIC_I/LSC_I = x̄ ± 2,66·MR̄
LC_MR = MR̄;      LIC_MR = 0;  LSC_MR = 3,267·MR̄
σ_dentro = MR̄/1,128
```

Carta X̄-R, para subgrupos racionais de tamanho fixo `n` (2 a 10):

```
R_i = máx(subgrupo_i) − mín(subgrupo_i)
x̄̄ = média das médias dos subgrupos;  R̄ = média das amplitudes
LC_X = x̄̄;        LIC_X/LSC_X = x̄̄ ± A2·R̄
LC_R = R̄;        LIC_R = D3·R̄;  LSC_R = D4·R̄
σ_dentro = √[Σ(n_i−1)·s_i²/Σ(n_i−1)]
```

Constantes tabeladas (ASTM MNL 7):

| n | A2 | D3 | D4 |
|---|---|---|---|
| 2 | 1,880 | 0 | 3,267 |
| 3 | 1,023 | 0 | 2,574 |
| 4 | 0,729 | 0 | 2,282 |
| 5 | 0,577 | 0 | 2,114 |
| 6 | 0,483 | 0 | 2,004 |
| 7 | 0,419 | 0,076 | 1,924 |
| 8 | 0,373 | 0,136 | 1,864 |
| 9 | 0,337 | 0,184 | 1,816 |
| 10 | 0,308 | 0,223 | 1,777 |

Regras de alarme, aplicadas às cartas principal e secundária:

1. **Ponto fora dos limites:** `valor < LIC` ou `valor > LSC`.
2. **8 consecutivos do mesmo lado:** oito pontos estritamente acima ou
   estritamente abaixo da linha central; um ponto exatamente na LC interrompe a
   sequência.
3. **6 em tendência:** seis pontos consecutivos estritamente crescentes ou
   estritamente decrescentes.

Cada alarme registra carta, regra, índices dos pontos, valor, LC, LIC, LSC e
descrição. Todos os pontos permanecem nas cartas e nas tabelas; nenhum é
excluído. O critério padrão de estabilidade é **zero alarmes**, com os
comprimentos 8 e 6 editáveis.

A resolução é verificada contra `T` ou, na ausência deste, contra `σ_total`:

```
resolução ≤ 10%·T          (T informado)
resolução ≤ 10%·σ_total    (T ausente)
%resolução = 100·resolução/T ou 100·resolução/σ_total
```

Se a resolução não for informada, ela é inferida pela menor diferença positiva
entre valores distintos. O sistema também registra o número de categorias
distintas de dados e de amplitudes (`MR` ou `R`), que evita superestimar a
discriminação efetiva da carta de amplitudes. A violação do limite gera alerta
e veredito não conforme, sem remover pontos.

Referências: ASTM MNL 7; ISO 7870-2:2013; Montgomery & Runger, cap. 6; Nelson
(1984); AIAG MSA 4th ed.

## 12. Concordância para dados de atributo

Arquivo: `src/stats/attribute.ts`. As categorias são tratadas como **nominais**
por padrão. O kappa ponderado (linear ou quadrático) exige a ordem ordinal em
`categories`; sem essa ordem o sistema recusa o cálculo, para não impor uma
ordem arbitrária aos rótulos.

### 12.1 Cohen — dois avaliadores

Para uma tabela de contingência `n_ij` (avaliador 1 × avaliador 2) com `n`
sujeitos e `k` categorias:

```
p_o = Σ_i n_ii / n
p_e = Σ_i (n_i· · n_·i) / n²
κ   = (p_o − p_e)/(1 − p_e)
EP(κ) = √{[Σ_ij (e_ij/n)·(w_ij − (w_i· + w_·j))² − p_e²] / [n·(1 − p_e)²]}
z   = κ/EP(κ);  p = 2·[1 − Φ(|z|)]
IC  = κ ± z_{1−α/2}·EP(κ), truncado em [−1, 1]
```

com `e_ij = n_i· · n_·j/n` e `w_ij = 1` para `i = j` e `0` caso contrário. O
erro-padrão segue Fleiss, Cohen & Everitt (1969) na parametrização do pacote R
`irr::kappa2`; a orientação das margens foi validada contra `anxiety` e
`diagnoses`. O IC é truncado no intervalo admissível de κ.

### 12.2 Fleiss — dois ou mais avaliadores

Cada item `i` tem `m_i` avaliações; `n_ij` é quantas vezes a categoria `j` foi
atribuída ao item `i`:

```
P_i = [Σ_j n_ij·(n_ij − 1)]/[m_i·(m_i − 1)]        (nominal)
P̄  = Σ_i P_i/N
p_j = Σ_i n_ij / Σ_i m_i
p_e = Σ_j p_j²
κ   = (P̄ − p_e)/(1 − p_e)
```

Com número constante `m` de avaliadores e peso nominal, o EP analítico é

```
q_j = 1 − p_j;  S = Σ_j p_j·q_j
EP(κ) = √{2·[S² − Σ_j p_j·q_j·(q_j − p_j)] / [S²·N·m·(m − 1)]}
```

Quando `m` varia entre itens ou há ponderação, não há fórmula fechada adotada:
o EP é estimado por **jackknife delete-one** (recalcular κ excluindo um item por
vez e usar `EP² = (N−1)/N·Σ(κ_(−i) − κ̄_(−·))²`). Com menos de 3 itens o EP fica
indisponível e o IC não é calculado, com alerta.

### 12.3 Kappa ponderado

Para categorias ordinais `i = 0…k−1`:

```
w_ij = 1 − |i − j|/(k − 1)              (linear)
w_ij = 1 − [(i − j)/(k − 1)]²           (quadrático)
p_o,w = Σ_ij w_ij·n_ij/n
p_e,w = Σ_ij w_ij·p_i·p_j               (Cohen)
κ_w   = (p_o,w − p_e,w)/(1 − p_e,w)
```

Em Fleiss, com `n_i` = contagem da categoria `i` no item,
`P_i,w = [Σ_ij w_ij·n_i·n_j − m_i]/[m_i(m_i − 1)]`; para pesos nominais isso
reduz a `Σ_j n_j(n_j − 1)/[m_i(m_i − 1)]`.

### 12.4 Estudo completo de concordância

O estudo recebe observações `(item, avaliador, categoria, réplica, referência)`
e calcula:

| Componente | Regra |
|---|---|
| Interavaliadores | Cohen com 2 avaliadores; Fleiss com 3 ou mais, usando a réplica selecionada (`interRaterTrial`, padrão 1) e apenas itens completos |
| Intra-avaliador | Fleiss entre as réplicas comuns a todos os itens de cada avaliador |
| Com a referência | Cohen entre a classificação do avaliador e a referência conhecida, na réplica selecionada |
| Eficácia | `acertos/observações com referência`, usando **todas** as réplicas |
| FAR (falso aceite) | `falsos aceites/referências rejeitadas` |
| FRR (falso rejeite) | `falsos rejeites/referências aceitas` |
| Cobertura | `100·itens com referência/itens` |

Eficácia, FAR e FRR usam IC de Wilson (seção 2). A categoria de aceitação é
informada em `conformingCategories` ou inferida apenas para pares de rótulos
reconhecidos (`conforme`/`não conforme`, `aprovado`/`reprovado`, `1`/`0`,
`pass`/`fail`, etc.); se não for possível inferir, FAR e FRR ficam não avaliadas
com alerta. A réplica selecionada ausente cai para a menor réplica disponível,
com alerta; itens incompletos são excluídos do kappa interavaliadores e a
quantidade é registrada.

### 12.5 Veredito e critérios editáveis

```
κ ≥ kappaAccept                          → conforme
kappaWarning ≤ κ < kappaAccept           → atenção
κ < kappaWarning                         → não conforme
κ indefinido (p_e = 1 ou dado ausente)   → não avaliado
```

Padrões: `kappaAccept = 0,75`, `kappaWarning = 0,40`, cobertura de referência
mínima de 100%, e **sem limite** para eficácia, FAR e FRR até o usuário
cadastrar um critério. A classificação de Landis & Koch (1977) é exibida apenas
como orientação — não é norma e não substitui os limiares editáveis. Quando
`p_e = 1` (todas as classificações na mesma categoria), κ é **indefinido**:
valor nulo, veredito não avaliado e mensagem explícita, em vez de divisão por
zero. Nenhuma observação é removida automaticamente; ausências são contadas e
registradas.

Referências: Cohen (1960); Fleiss (1971); Fleiss, Cohen & Everitt (1969);
Landis & Koch (1977); AIAG MSA 4th ed.; `irr` 0.84.1 (`kappa2`,
`kappam.fleiss`); `sklearn.metrics.cohen_kappa_score`.

### 12.6 Perfil de atributo e mapeamento das medições

O perfil `attribute` reutiliza o schema existente, sem migração:

| Conceito | Campo da medição |
|---|---|
| Item / amostra | `sample` |
| Avaliador | `analyst` |
| Categoria observada | `category` → `textValue` → `value` (numérico convertido em texto) |
| Referência conhecida | `level` → `referenceValue` |
| Réplica | `replicate` (inteiro ≥ 1; inválido vira 1 com alerta) |

`attributeObservationsFrom` conta itens sem referência, categorias ausentes,
amostra/avaliador ausentes, réplicas inválidas, células duplicadas e referências
conflitantes. O estudo só é executado quando não há conflito de referência nem
duplicidade item/avaliador/réplica; nesses casos o resultado fica
`not_evaluated` com a mensagem registrada, em vez de quebrar a interface.

Os parâmetros do perfil são:

| Parâmetro | Métricas | Fonte |
|---|---|---|
| Exatidão / concordância com a referência | `kappa_reference`, `effectiveness`, `far`, `frr`, `reference_coverage` | concordância de cada avaliador com a referência |
| Repetibilidade | `kappa_intra`, `po_intra` | réplicas do mesmo avaliador |
| Precisão intermediária | `kappa_inter`, `po_inter` | primeira réplica de cada item, entre avaliadores |

As métricas agregadas usam o **pior avaliador** (mínimo para κ, eficácia e
cobertura; máximo para FAR e FRR), para que um avaliador fora do critério não
seja mascarado pela média. Cada métrica é reavaliada com o seu próprio critério;
sem critério cadastrado, o veredito é `not_evaluated`. Cobertura abaixo do
mínimo é **atenção**, não reprovação automática, porque limita a conclusão sobre
exatidão sem invalidar a concordância entre avaliadores.

### 12.7 Tamanho de amostra de atributo

O estudo não usa poder de teste t. O total é o produto:

```
N = itens × avaliadores × réplicas
```

O template padrão usa 30 itens × 3 avaliadores × 3 réplicas = **270
classificações**, com 6 itens limítrofes. O padrão AIAG MSA (30 itens, 3
avaliadores, 2–3 réplicas) é uma recomendação prática; a precisão do κ depende
da prevalência das categorias e do número de itens. O sistema alerta quando há
menos de 30 itens, menos de 3 avaliadores ou nenhum item limítrofe, mas não
bloqueia o plano.

Critérios iniciais: apenas κ (0,75 conforme; 0,40 atenção). Eficácia (≥ 90%),
FAR (≤ 10%), FRR (≤ 10%) e cobertura (100%) aparecem como sugestões editáveis,
mas **não são aplicados** sem decisão explícita do laboratório.

## 13. Conformidade, banda de guarda e riscos

Arquivo: `src/stats/conformity.ts`. A entrada é o valor medido `x`, a
incerteza-padrão `u`, o fator de abrangência `k`, os limites `LSL`/`USL` (um ou
ambos) e a regra de decisão. A incerteza expandida é `U = k·u`; a tolerância
bilateral é `T = USL − LSL`.

### 13.1 Regras de decisão

```
1. Aceitação simples (w = 0):
   conforme se LSL ≤ x ≤ USL; não conforme fora.

2. Banda de guarda (w = r·U, r editável, padrão 1):
   aceitação:    LSL + w ≤ x ≤ USL − w
   rejeição:     x < LSL − w  ou  x > USL + w
   indeterminado: demais casos (zona intermediária)
   Se w > T/2, a zona de aceitação é vazia; o sistema alerta que nenhuma
   aceitação é possível.

3. Probabilidade de conformidade (normal):
   P = Φ((USL − x)/u) − Φ((LSL − x)/u)
   conforme se P ≥ p0; não conforme se P < p0 (p0 editável, padrão 0,95).
```

Em tolerância unilateral, usa-se `P = Φ((USL − x)/u)` (somente superior) ou
`P = 1 − Φ((LSL − x)/u)` (somente inferior). Os limites são fechados: `x`
exatamente em `LSL`, `USL`, `LSL + w` ou `USL − w` pertence à aceitação; `x`
exatamente em `LSL − w` ou `USL + w` permanece indeterminado.

### 13.2 Riscos específicos

Sob `X_verdadeiro ~ N(x, u²)`, a probabilidade de conformidade condicional é

```
P_conf(x) = ∫_{LSL}^{USL} φ(t; x, u) dt
```

O risco específico de falso aceite (se a decisão for aceitar) e o de falso
rejeite (se a decisão for rejeitar) são

```
P_FA = 1 − P_conf(x)
P_FR = P_conf(x)
```

São riscos **específicos/condicionais** ao valor medido, como em JCGM 106. O
risco global exigiria uma distribuição a priori do valor verdadeiro e não é
estimado. Para `u = 0`, a distribuição é degenerada: `P_conf = 1` se `x` está
dentro dos limites fechados e `0` caso contrário; os riscos tornam-se `0` ou
`1` e o TUR não é definido.

### 13.3 Métricas relativas à tolerância

```
TUR/TAR = T/(2U)
%P/T    = 100·U/T
U/T     = U/T
```

`src/lib/criteria.ts` expõe `toleranceMetrics`, as definições `pct_pt`,
`u_over_t` e `tur` e os limiares sugeridos editáveis: `%P/T ≤ 10%`,
`U/T ≤ 0,1` e `TUR ≥ 4`. O módulo de conformidade alerta quando `TUR < 4`,
`U > T/4` ou `%P/T > 10%` (todos editáveis); esses alertas não alteram o
veredito da regra, que é sempre o da decisão adotada. O `%P/T` desta seção é a
incerteza expandida relativa à tolerância; ele **não** é o `%P/T` do Gage R&R
(seção 8.5), calculado como `100·6·σ_GRR/T`.

### 13.4 Veredito de três estados e relatório

```
conform       → pass
nonconform    → fail
indeterminate → warning
sem dado      → not_evaluated
```

O bloco `report` do resultado (e as métricas/tabelas) registra a regra adotada,
o valor `x`, `u`, `k`, `U`, os limites efetivos, a probabilidade `P`, os riscos,
`TUR/TAR`, `%P/T`, `U/T` e o veredito de três estados. O laudo deve declarar a
regra de decisão e a incerteza expandida, como exige a ISO/IEC 17025:2017,
7.8.2.1.

### 13.5 Atualização bayesiana Normal–Normal e riscos globais `R_C` e `R_P`

Quando uma distribuição a priori `Y ~ N(μ₀, σ₀²)` (`priorMean`, `priorStd`) é
informada em `computeBayesianConformityRisks` ou em `conformityDecision`:

```
u_post² = 1 / (1/σ₀² + 1/u_m²) = σ₀²·u_m² / (σ₀² + u_m²)
μ_post  = (u_m²·μ₀ + σ₀²·x) / (σ₀² + u_m²)
R_C = ∫_{y ∉ T} f₀(y) · P(X ∈ A | Y = y) dy     (risco global do consumidor, JCGM 106 Eq. 19)
R_P = ∫_{y ∈ T} f₀(y) · [1 − P(X ∈ A | Y = y)] dy (risco global do produtor, JCGM 106 Eq. 20)
R_C* = R_C / P(X ∈ A) ;   R_P* = R_P / P(X ∉ A)
```

A integração numérica utiliza regra composta de Simpson (`N = 400`
subintervalos por região suave sem descontinuidade) em `[μ₀ − 8σ₀, μ₀ + 8σ₀]`.
Referências: JCGM 106:2012, seções 7.2 e 9.5; ILAC-G8:09/2019; ISO/IEC 17025:2017,
7.8.2.1; ISO 14253-1:2017.

## 14. Incerteza de medição — GUM

Arquivo: `src/stats/uncertainty.ts`.

```
u_i = valor/divisor
divisor = 1 (normal), √3 (retangular), √6 (triangular), √2 (forma U)
contribuição_i = |c_i|·u_i
u_c² = Σ(c_i·u_i)² + 2·Σ_{i<j} c_i·c_j·u_i·u_j·r(x_i, x_j)   (r ∈ [−1, 1], JCGM 100 §5.2 Eq. 13)
%contribuição_i = 100·(c_i·u_i)²/u_c²
ν_eff = u_c⁴ / Σ(u_i⁴/ν_i)          (Welch–Satterthwaite, JCGM 100 §G.4)
U = k·u_c
k = t_{1−α/2, ν_eff}               (quando ν_eff é conhecido e completo)
k = 2                              (apenas provisório quando faltam graus de liberdade em fontes Tipo A)
```

### 14.1 Regras de graus de liberdade no orçamento GUM (JCGM 100:2008 §G.4 e §G.4.2)

1. **Fontes Tipo B sem graus de liberdade informados** (`dof: null` ou `dof: Infinity`):
   Conforme o JCGM 100:2008 §G.4.2, incertezas Tipo B com limites confiáveis ou certificados
   são tratadas com graus de liberdade infinitos (`ν_i = ∞`), de modo que sua parcela no
   denominador de Welch–Satterthwaite é nula (`u_i⁴ / ∞ = 0`). Se todas as fontes forem Tipo B
   com `ν = ∞`, o sistema adota `ν_eff = 10⁶` (`k ≈ 1,960` para 95,45%).
2. **Fontes Tipo A com graus de liberdade ausentes, nulos ou não positivos** (`dof === null` ou `dof ≤ 0`):
   **Não podem** ser omitidas do denominador nem tratadas como `ν = ∞` (o que superestimaria
   artificialmente o `ν_eff` e subestimaria o fator de abrangência `k`). Nessa situação:
   - O cálculo de `ν_eff` é interrompido (`effectiveDof = null`);
   - O fator `k = 2,000` é adotado **apenas em caráter provisório sinalizado**;
   - O orçamento recebe o atributo explícito `dofComplete: false` e emite alerta destacado na interface e no relatório.
3. **Vínculo dos graus de liberdade ao estudo experimental de origem**:
   - **Repetibilidade (`u_rep`)**: utiliza os graus de liberdade do resíduo do estudo experimental
     (`ν_rep = df_E` da ANOVA ou Gage R&R cruzado, ou `df_{E,red}` no caso de modelo reduzido com *pooling*
     da interação não significativa). Quando não informado e houver `n > 1` réplicas declaradas,
     aplica-se o *fallback* conservador documentado `ν = n − 1` acompanhado de nota técnica.
   - **Reprodutibilidade (`u_reprod` / `u_oper`)**: utiliza os graus de liberdade efetivos de Satterthwaite
     do componente de operador (`ν_oper`), calculados diretamente a partir dos quadrados médios da ANOVA
     do Gage R&R. Se ausente, o campo permanece `dof: null` (Tipo A incompleto), sem inventar valores
     artificiais.
4. **Pares correlacionados**:
   Pares com correlação estimada `r(x_i, x_j)` utilizam os coeficientes de sensibilidade com sinal (`c_i·c_j`).

Referências: JCGM 100:2008 (GUM), cláusulas 5 (Eq. 13), §G.4 e §G.4.2;
JCGM 101:2008; EURACHEM/CITAC (2012).

## 15. Como cada parâmetro é calculado e julgado

Arquivo de orquestração: `src/stats/analysis.ts`. O critério é procurado pelo
par `parameter + metric`; o operador pode ser `≥`, `≤` ou `entre`.

| Parâmetro | Métricas calculadas | Critério típico (editável) |
|---|---|---|
| Seletividade | não há cálculo automático; exige experimento com branco/interferente e registro no relatório | recuperação na presença de interferente 90–110%; resolução ≥ 1,5 |
| Linearidade | `R²`, `p` da falta de ajuste, `p` do declive | `R² ≥ 0,99`; `p_falta ≥ 0,05`; `p_declive ≤ 0,05` |
| Faixa de trabalho | menor e maior nível numérico observados | exibição contextual; o veredito permanece não avaliado |
| LD/LQ | LD e LQ por brancos (≥ 3) ou pela curva (≥ 3 pontos) | LD ≤ limite; LQ ≤ limite |
| Repetibilidade | `s_r` ponderado dentro dos níveis e `CV = 100·s_r/|x̄|` | `CV ≤ 2%`; `s_r ≤ limite` |
| Precisão intermediária | `s_ip = √(s_r² + s_entre²)` e CV | `CV ≤ 5%`; `s_ip ≤ limite` |
| Reprodutibilidade | `s_R` e `CV_R` pela ISO 5725-2 | `CV_R ≤ 10%`; `s_R ≤ limite` |
| Exatidão | recuperação média, tendência e `p` da tendência; TOST calculado e exibido | recuperação 98–102%; tendência entre −1 e 1; `p ≥ 0,05` |
| Robustez | maior efeito padronizado entre analista/dia/equipamento/lote e menor `p` | efeito ≤ 2; `p ≥ 0,05` |
| Incerteza | `U` e `U_rel = 100·U/|x̄|` | `U_rel ≤ 5%`; `U ≤ limite` |

### 15.1 Veredito de um parâmetro

1. Se não há critério cadastrado para as métricas disponíveis → **não avaliado**.
2. Se alguma métrica aplicável falha → **não conforme**.
3. Se todas as métricas aplicáveis passam → **conforme**.
4. Casos intermediários (parte avaliada, parte sem dado) → **atenção**.

### 15.2 Veredito global

```
se algum parâmetro = não conforme  → não conforme
senão se todos = conforme          → conforme
senão se algum = não avaliado      → não avaliado
senão                              → atenção
```

O relatório sempre traz a fórmula, o valor, o critério e o veredito de cada
métrica. O `n` efetivo é o número de medições numéricas válidas; dados ausentes
são tratados por lista (listwise) e registrados.

## 16. Decisões e suposições registradas

- **Confiança** padrão 95%; **poder** padrão 80%; **α** padrão 5% bilateral.
- **σ esperado**: dado piloto; se ausente, `faixa/6`. É uma suposição explícita
  e aparece no relatório.
- **Diferença mínima detectável**: limite de aceitação do parâmetro; se
  ausente, 5% da faixa.
- **Margem TOST**: limite de aceitação de tendência/recuperação; se ausente, 1%
  da faixa.
- **n mínimo**: 3 medições por condição; abaixo disso o sistema alerta.
- **Arredondamento**: para cima, para preservar o poder nominal.
- **Normalidade**: Shapiro–Wilk; a rejeição gera alerta e sugestão de método
  não paramétrico, sem bloquear automaticamente.
- **Homogeneidade**: Levene é o teste de decisão; Bartlett é informativo.
- **Outliers**: apenas sinalizados; nenhuma remoção automática.
- **Tendência/linearidade**: limites padrão de 5% (conforme) e 10% (atenção)
  para `|tendência|/T` e `%linearidade`, editáveis; são orientação AIAG, não
  norma. O estudo AIAG exige ≥ 5 níveis e ≥ 3 réplicas por nível.
- **Estabilidade**: zero alarmes como padrão; 8 pontos do mesmo lado e 6 em
  tendência são os comprimentos padrão, editáveis. Nenhum ponto é excluído.
- **Resolução**: limite padrão de 10% de `T` ou de `σ_total`; se a resolução
  não for informada, é inferida pela menor diferença positiva entre valores
  distintos.
- **Concordância de atributo**: κ padrão conforme em 0,75 e atenção em 0,40,
  ambos editáveis; Landis & Koch é orientação, não norma. `p_e = 1` torna κ
  indefinido (não avaliado). Eficácia, FAR e FRR só são julgadas com critério
  cadastrado. Kappa interavaliadores e com a referência usam a primeira réplica
  (ou a menor disponível, com alerta); eficácia/FAR/FRR usam todas as réplicas.
  Kappa ponderado exige a ordem ordinal explícita das categorias. O
  delineamento de atributo inclui amostras limítrofes, referência conhecida,
  códigos cegos `A-###` e ordem embaralhada pela semente.
- **Conformidade**: regra explícita escolhida entre aceitação simples
  (`w = 0`), banda de guarda (`w = r·U`, `r = 1` padrão) e probabilidade normal
  (`P ≥ 0,95` padrão); todos os parâmetros são editáveis. Os limites são
  fechados e a decisão tem três estados (`pass`, `fail`, `warning`). Os riscos
  são específicos/condicionais ao valor medido (JCGM 106), não globais. Com
  `u = 0`, os riscos degeneram em 0/1 e o `TUR` fica indefinido. Alertas
  padrão, editáveis: `TUR/TAR < 4`, `U/T > 0,25` e `%P/T > 10%`. O `TUR/TAR`
  usa a convenção `T/(2U)`. O `%P/T` da conformidade (`100·U/T`) não se
  confunde com o `%P/T` do Gage R&R (`100·6·σ_GRR/T`).
- **Dados faltantes**: análise por lista, com `n` efetivo no relatório.
- **Aleatorização**: mulberry32 + Fisher–Yates; a semente fica gravada.
- **Incerteza**: entradas independentes; GUM com Welch–Satterthwaite.

## 17. Orçamentos-modelo, covariáveis ambientais e não normalidade (Perfis Dimensional e Físico)

### 17.1 Diagnóstico de não normalidade e alternativas não paramétricas (`src/stats/normality.ts`)

`evaluateNonNormalityAndOptions` aplica simultaneamente Shapiro–Wilk e Anderson–Darling ao nível `α` editável (padrão `0,05`). **Nenhuma transformação é aplicada automaticamente**:

- **Opção A — Transformação logarítmica explícita** (quando todos os valores são positivos, `n ≥ 3`): calcula `y_i = ln(x_i)`, média geométrica `x̄_g = exp(ȳ)` e desvio-padrão geométrico `s_g = exp(s_y)`, e reaplica Shapiro–Wilk aos valores transformados. Só retorna `transformedValues` quando o usuário ou módulo solicita `applyLogTransform: true`.
- **Opção B — Intervalo de tolerância não paramétrico de Wilks (ISO 16269-6:2014)**: utiliza os extremos amostrais `[x_(1), x_(n)]` como limites livres de distribuição para cobertura alvo `q` (padrão `0,95`), com confiança bilateral atingida:

```
γ = 1 − n · q^(n−1) + (n − 1) · q^n
```

O tamanho amostral mínimo `n_min` (`wilksMinimumN`) é o menor inteiro `n ≥ 2` tal que `γ ≥ 1 − α` (ex.: `n_min = 93` para `q = 0,95` e `γ ≥ 0,95`). Referências: Wilks (1941), *Ann. Math. Statist.* 12:91–96; ISO 16269-6:2014.

### 17.2 Covariáveis ambientais (`src/stats/parameters/physical.ts`)

`analyzeEnvironmentalConditions` ajusta regressão linear simples `y = a + b · x_cov` (`linearRegression`) entre as medições numéricas e cada covariável ambiental registrada em `condition_json` (`temperature` em `°C`; `humidity` em `% UR`), quando há `n ≥ 3` pares e ao menos 2 níveis distintos. Emite alerta explícito se `p_declive < 0,05` (Montgomery, Peck & Vining, 2021; ISO/IEC 17025:2017, 6.3).

### 17.3 Orçamentos-modelo metrológicos GUM (`src/stats/parameters/dimensional.ts` e `physical.ts`)

- **`dimensionalUncertaintyBudget`**: pré-popula fontes Type A e Type B típicas de metrologia dimensional (`u_res = (d/2)/√3`, calibração `u_cal = U_cal/k`, dilatação térmica diferencial `u_temp = (L · α · ΔT)/√3`, repetibilidade `s_r / √n`, reprodutibilidade entre operadores `u_oper`, padrão de referência `u_ref`, planicidade, paralelismo e força de medição retangulares `a / √3`).
- **`physicalUncertaintyBudget`**: pré-popula fontes para ensaios físicos destrutivos e não destrutivos (`u_res = (d/2)/√3`, calibração `U_cal/k`, repetibilidade entre corpos de prova `s_r / √n`, reprodutibilidade entre operadores `u_oper`, heterogeneidade do lote `σ_amostra` separada na ANOVA aninhada, alinhamento/fixação, velocidade de ensaio e deriva ambiental retangulares `a / √3`).

### 17.4 Verificação metrológica por ponto do equipamento (`physicalBiasAnalysis`)

Para cada ponto de calibração/referência `j`, apresenta o erro relativo percentual ao valor de referência (`100 · (x̄_j − x_ref,j) / x_ref,j`) com a incerteza-padrão da referência `u_ref`, permitindo comparação contra o critério de classe editável cadastrado pelo laboratório (ex.: ISO 7500-1 ou OIML R76) sem embutir limiares normativos fixos.

## 18. Módulos complementares e pacotes Eurachem/CITAC

| Funcionalidade | Módulo / Função | Equação / Regra principal | Referência |
|---|---|---|---|
| **Incerteza Top-Down** | `uncertainty.ts` (`computeTopDownUncertainty`) | `u(bias) = √(bias̄² + s_bias²/n + u_ref²)`; `u_c = √(u(R_w)² + u(bias)²)` | Eurachem/CITAC QUAM (3ª ed., 2012) |
| **Incerteza da amostragem** | `uncertainty.ts` (`computeSamplingDuplicateUncertainty`) | ANOVA aninhada (Alvo > Subamostra > Réplica): `s²_amost = (MS_S − MS_A)/n_r` | Eurachem/CITAC/Nordtest UfS (2ª ed., 2019) |
| **Proficiência `ζ` e `z'`** | `bias.ts` (`zetaScore`, `zPrimeScore`) | `ζ = (x − x_ref)/√(u_lab² + u_ref²)`; `z' = (x − x_pt)/√(σ_pt² + u_pt²)` | ISO 13528:2022 (§9.4–9.5); Eurachem PT (2021) |
| **Efeito matriz (%ME)** | `parameters/selectivity.ts` (`computeMatrixEffectCurves`) | `%ME = 100·(b_matriz/b_solv − 1)`; teste t de Welch sobre `b_matriz − b_solv` | Eurachem Fitness for Purpose (2025) |
| **Brancos corrigidos** | `regression.ts` (`lodLoqEurachemBlanks`) | `s₀' = s_b·√(1/n + 1/n_b)`; `LD = t_{1−α,ν}·s₀'`; `LQ = k_Q·s₀'` | Eurachem Blanks Guide (2025) |
| **Linearidade de Mandel e WLS** | `regression.ts` (`mandelLinearityTest`, `compareCalibrationWeightings`) | Teste F quadrático `DS²/s_{y2}²`; seleção entre OLS, `1/x` e `1/x²` | ISO 8466-1:2021; EMA/FDA bioanalítico |
| **Incerteza-Alvo e Horwitz** | `conformity.ts` (`computeTargetUncertainty`) | `U^tg ≤ T/4` (moderado), `≤ T/8` (rigoroso); `σ_H` por fração mássica `c` | Eurachem Target Uncertainty (2015); Thompson |
| **Qualitativo diagnóstico** | `attribute.ts` (`computeQualitativeDiagnosticMetrics`) | Sensibilidade/Especificidade (IC Wilson), `LR⁺`, `LR⁻`, VPP/VPN, Youden `J` | Eurachem Qualitative (2021) |
| **LoB / LoD / Probit** | `lodProbit.ts` (`clsiEp17Limits`, `probitLod95`) | `LoB = μ_B + c_p·σ_B` (paramétrico e quantil); regressão Probit IRLS + Fieller | CLSI EP17-A2; Finney (1971) |
| **Perfil de Exatidão** | `accuracyProfile.ts` (`computeAccuracyProfile`) | Intervalo de tolerância `β`-expectation `[L_j, U_j]` vs. `±λ (%)`; `LLOQ`/`ULOQ` | Hubert et al. (SFSTP 2007); USP `<1210>` |
| **EMP (Wheeler)** | `emp.ts` (`computeEmp`) | `ICC = σ²_peça/(σ²_peça + σ²_med)`; `PE = 0,6745·σ_rep`; Classes I–IV | Wheeler (2006) *EMP III* |
| **Capabilidade Tipo 1** | `capabilityCg.ts` (`computeCapabilityCg`) | `C_g = (k%·T)/(m·s)`; `C_{gk} = (0,5·k%·T − |bias|)/(0,5·m·s)`; `Q_MS`, `Q_MP` | AIAG MSA / Bosch / VDA 5:2021 |
| **Comparação de métodos** | `methodComparison.ts` (`blandAltman`, `demingRegression`, `passingBablokRegression`) | Limites de concordância 95%, Deming ortogonal e Passing–Bablok (Kendall/Sen) | CLSI EP09c; Bland & Altman (1986); Passing–Bablok (1983) |
| **Monte Carlo** | `monteCarlo.ts` (`runMonteCarloUncertainty`) | Parser Shunting-Yard seguro + amostragem determinística vs. linearização GUM | JCGM 101:2008 (Suplemento 1 do GUM) |

## 19. Testes de referência

`npm test` executa **209 casos** distribuídos em **18 arquivos de teste**: **189 casos estatísticos e de perfis** (21 em `stats.test.ts`, 15 em `gagerr.test.ts`, 33 em `nested.test.ts`, 9 em `gageBiasLinearity.test.ts`, 15 em `stability.test.ts`, 24 em `attribute.test.ts`, 21 em `conformity.test.ts`, 10 em `attribute-profile.test.ts`, 10 em `physical-profile.test.ts`, 2 em `dimensional-profile.test.ts`, 22 em `advanced-features.test.ts`, 6 em `criteria-precedence.test.ts` e 1 teste de caracterização em `analysis-characterization.test.ts` que congela a saída completa da análise analítica original) e **20 testes de infraestrutura de dados** (6 em `repository.test.ts`, 4 em `validation.test.ts`, 5 em `criteria.test.ts`, 2 em `migration.test.ts` e 3 em `spreadsheet.test.ts`). Os principais valores de referência estatísticos:

| Caso | Referência | Tolerância |
|---|---|---|
| Normal padrão | `Φ(1,9599639845) = 0,975` | 1e-6 |
| t de Student | `t_{0,975,10} = 2,228138852` | 1e-7 |
| χ² e F | `χ²_{0,95,10} = 18,307038`; `F_{0,95,2,10} = 4,102821` | 1e-8 |
| Poder t | `n = 64/grupo`, `d = 0,5`, poder 80% | faixa 0,79–0,81 |
| ANOVA | `F = 27` para três grupos 1–3/4–6/7–9 | 1e-9 |
| Componentes | `s²_entre = 4` no exemplo balanceado | 1e-9 |
| ISO 5725-2 | `s_r = √0,5`, `s_L = √3,25`, `s_R = √3,75` | 1e-9 |
| Shapiro–Wilk | `W = 0,7888146949` (n = 11) e `0,9657219453` (n = 10) | 1e-6 |
| Bartlett | `χ² = 1,8836933176`, `p = 0,3899071447` | 1e-6 |
| OLS | `b = 1,93`, `a = 0,23`, `EP(b) = 0,0443471157` | 1e-9 |
| GUM | `u_c = √(0,5² + (0,2/√3)²)` | 1e-9 |
| Gage R&R cruzado | AIAG 10×3×3: componentes e %GRR conferidos com a tabela publicada | 1e-6 |
| ANOVA aninhada | Montgomery Example 14-1: `SS_A = 15,0555555556`, `SS_B(A) = 69,9166666667`, `SS_E = 63,3333333333` | 1e-9 |
| Gage R&R aninhado | `σ²_e = 2,6388888889`; `σ²_B(A) = 1,7098765432`; `%GRR = 77,8982248062` | 1e-9 |
| Aninhado com `b = 1` | coincide com `iso5725Analysis` (`s_r²`, `s_L²`, `s_R²`) | 1e-9 |
| Homogeneidade | Cochran `C = 1/3` para variâncias iguais; razão `F = 1` | 1e-12 |
| `nestedDesignN` | menor `n` que atinge erro relativo e largura do IC; plano `a·b·n` | exata |
| Aleatorização | mesma semente → mesma ordem; semente diferente → ordem diferente | exata |
| Tendência AIAG | ref. 7: `bias = 0,49`; `s = 0,1286683938`; `EP = 0,0406885187`; `t = 12,0427092316` | 1e-9 |
| Linearidade AIAG | `b = −0,132`; `a = 1,408`; `s_yx = 0,2530480850`; `t_b = −10,4327997573` (gl 48) | 1e-9 |
| Incerteza da referência | `EP = √(s²/n + u_ref²) = 0,5033222957`; Welch gl `10,2593250444` | 1e-9 |
| Constantes X̄-R | ASTM MNL 7, `n = 2…10`: A2 `1,880…0,308`; D3 `0…0,223`; D4 `3,267…1,777` | exata |
| Carta I-MR | `x̄ = 10,9`; `MR̄ = 1,2222222222`; `LIC = 7,6488888889`; `LSC = 14,1511111111` | 1e-9 |
| Carta X̄-R | `x̄̄ = 10,2`; `R̄ = 2`; `LIC = 9,046`; `LSC = 11,354` para `n = 5` | 1e-9 |
| Resolução | `1/10 = 10%` passa; `1/5 = 20%` falha; categorias distintas de MR/R registradas | exata |
| Alarmes | 1 fora dos limites, 8 do mesmo lado e 6 em tendência, sem excluir pontos | exata |
| Cohen 2×2 | `[[20,5],[10,15]]`: κ = 0,4; `p_o = 0,7`; `p_e = 0,5`; EP = 0,1385640646; z = 2,8867513460 | 1e-9 |
| sklearn 3×3 | `[[2,0,0],[0,1,0],[1,0,1]]`: κ nominal 0,6875; linear 0,5833333333; quadrático 0,5 | 1e-9 |
| `irr` anxiety | κ nominal 0,1194968553 (EP 0,1026815035); linear 0,1891891892; quadrático 0,2967651195 | 1e-9 |
| `irr` diagnoses | κ = 0,6511627907; z = 6,9964707698 | 1e-9 |
| Fleiss (1971) | 10 itens × 14 avaliadores × 5 categorias: κ = 0,2099307044; EP = 0,0169650692; z = 12,3742910592; IC (0,1766797797, 0,2431816291) | 1e-9 |
| Fleiss ponderado | nominal 0,2424242424 (EP 0,1296318160); linear 0,2063492063 (EP jackknife 0,2303583134); quadrático 0,1666666667 (EP 0,3780652501) | 1e-9 |
| Kappa intra-avaliador | 6 itens × 3 réplicas: κ = 0,325; EP = 0,2357022604; z = 1,3788582233 | 1e-8 |
| Wilson | `18/20 = (0,6989663548, 0,9721335188)`; `20/20 = (0,8388748419, 1)` | 1e-9 |
| `p_e = 1` | κ nulo, veredito não avaliado e mensagem explícita | exata |
| Delineamento de atributo | 12 amostras × 3 avaliadores × 2 réplicas, códigos `A-###`, mesma semente reproduz a ordem | exata |
| Probabilidade de conformidade | `x = 10`, `u = 0,2`, `[9,5; 10,5]`: `P = Φ(2,5) − Φ(−2,5) = 0,9875806693` | 1e-6 |
| Risco específico | falso aceite e falso rejeite conferidos por integração de Simpson independente (densidade normal própria) | 1e-6 |
| Limite de decisão | `x` exatamente em `LSL`/`USL` é conforme; `P = 0,4999997133` na borda bilateral | 1e-6 |
| Banda de guarda | `U = 0,4`, `r = 1`: `w = 0,4`; aceitação `[9,9; 10,1]`; rejeição fora de `[9,1; 10,9]` | 1e-9 |
| Banda vazia | `w > T/2` deixa a zona de aceitação vazia e gera alerta de que nenhuma aceitação é possível | exata |
| `u = 0` | distribuição degenerada: `P = 1` dentro dos limites fechados, `0` fora; riscos `0`/`1`; `TUR` nulo | exata |
| Métricas de tolerância | `T = 2`, `U = 0,5`: `%P/T = 25%`, `U/T = 0,25`, `TUR/TAR = 2`; `U = 0` → métricas `0` e `TUR` nulo | 1e-12 |
| Wilks não paramétrico | `n = 12`, `q = 0,95`: `γ = 1 − 12·0,95^11 + 11·0,95^12`; `n_min(0,95; 0,95) = 93` | 1e-9 |
| Não normalidade | série exponencial rejeitada em S–W e A–D mantém `logTransform.applied = false` até ação explícita | exata |
| Covariáveis ambientais | regressão linear `y ~ temperatura` detecta `p < 0,05` e gera alerta ambiental | 1e-6 |
| Orçamentos e relatórios | `seedDimensionalDemo` aprova 8 parâmetros; DOCX (`PK`) e PDF (`%PDF`) válidos nas 5 famílias | estrutural |
| Módulos complementares | EMP Wheeler, `Cg/Cgk`, EP09c Deming/Passing–Bablok, Probit IRLS, Monte Carlo JCGM 101 e Eurachem | conferida |
| Refinamentos metrológicos | Mandel `h`/`k` exatos (5%/1%), GUM `ν_B = ∞` e `r(x_i,x_j)`, Henderson Tipo III/REML (invariância à transposição) e JCGM 106 bayesiano (`R_C = R_P = 0,125` em Sheppard) | 1e-7 a 1e-9 |

Os testes de referência ficam em `src/stats/__tests__/` e `src/lib/__tests__/`; a
caracterização da análise analítica fica em
`src/stats/__tests__/analysis-characterization.test.ts` e é executada também
pelo `scripts/setup.mjs`. A matriz completa de rastreabilidade entre requisitos,
funções, testes e fontes independentes consta em `docs/VALIDACAO_SOFTWARE.md`.
