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
aninhado, aninhado destrutivo, cruzado ou ISO 5725-2) e a ordem é embaralhada
por Fisher–Yates com um PRNG determinístico **mulberry32** e semente
registrada. A mesma semente reproduz exatamente a mesma ordem. No desenho
`nested_destructive`, cada réplica é um corpo de prova identificado
(`CP-001`, …) e o plano informa o total de corpos de prova a retirar do lote.
A curva de poder usa o poder do teste t de duas amostras para `n = 2…max`.

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
o desenho passa a ser tratado como desbalanceado, com somas de quadrados
sequenciais (peça → operador → interação), estimação por mínimos quadrados
ponderados e `r_eff = N/células`. O resultado registra `N`, `r_eff`, o
número de observações ausentes e alerta sobre a aproximação. `r = 1` falha
claramente, pois não permite estimar a repetibilidade.

Referências: AIAG (2010), *Measurement Systems Analysis Reference Manual*,
4. ed.; Montgomery (2020), cap. 13; Burdick, Borror & Montgomery (2003);
Satterthwaite (1946); ISO 22514-7:2021.

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
calculados com `|h| > 2` e `k > 2` sinalizando discrepância. Referências:
ISO 5725-1:2023; ISO 5725-2:2019, cláusulas 5–7; Mandel (1991).

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

## 12. Incerteza de medição — GUM

Arquivo: `src/stats/uncertainty.ts`.

```
u_i = valor/divisor
divisor = 1 (normal), √3 (retangular), √6 (triangular), √2 (forma U)
contribuição_i = |c_i|·u_i
u_c = √Σ(contribuição_i)²
%contribuição_i = 100·contribuição_i²/u_c²
ν_eff = u_c⁴ / Σ(u_i⁴/ν_i)          (Welch–Satterthwaite)
U = k·u_c
k = t_{1−α/2, ν_eff}               (quando ν_eff é conhecido)
k = 2                              (quando faltam graus de liberdade)
```

Tipo A: `u = s/√n`, `ν = n−1`. Tipo B normal a partir de incerteza expandida:
`u = U/k`. Quando todas as fontes têm `ν` mas o denominador é zero, o sistema
usa `ν_eff = 10⁶` e `k ≈ 1,96`. Referências: JCGM 100:2008 (GUM), cláusulas 5
e G; JCGM 101:2008; EURACHEM/CITAC (2012).

## 13. Como cada parâmetro é calculado e julgado

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

### 13.1 Veredito de um parâmetro

1. Se não há critério cadastrado para as métricas disponíveis → **não avaliado**.
2. Se alguma métrica aplicável falha → **não conforme**.
3. Se todas as métricas aplicáveis passam → **conforme**.
4. Casos intermediários (parte avaliada, parte sem dado) → **atenção**.

### 13.2 Veredito global

```
se algum parâmetro = não conforme  → não conforme
senão se todos = conforme          → conforme
senão se algum = não avaliado      → não avaliado
senão                              → atenção
```

O relatório sempre traz a fórmula, o valor, o critério e o veredito de cada
métrica. O `n` efetivo é o número de medições numéricas válidas; dados ausentes
são tratados por lista (listwise) e registrados.

## 14. Decisões e suposições registradas

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
- **Dados faltantes**: análise por lista, com `n` efetivo no relatório.
- **Aleatorização**: mulberry32 + Fisher–Yates; a semente fica gravada.
- **Incerteza**: entradas independentes; GUM com Welch–Satterthwaite.

## 15. Testes de referência

`npm test` executa 100 casos: 91 casos estatísticos (18 referências numéricas
de `stats.test.ts`, 15 de `gagerr.test.ts`, 33 de `nested.test.ts`, 9 de
`gageBiasLinearity.test.ts`, 15 de `stability.test.ts` e 1 teste de
caracterização que congela a saída completa da análise analítica anterior à
introdução dos perfis de método) e 9 testes de infraestrutura de dados
(migração versionada, round-trip XLSX/CSV e validações do modelo v2). Os
principais valores de referência estatísticos:

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

Os testes de referência ficam em `src/stats/__tests__/stats.test.ts`; a
caracterização da análise analítica fica em
`src/stats/__tests__/analysis-characterization.test.ts` e é executada também
pelo `scripts/setup.mjs`.
