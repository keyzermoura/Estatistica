/**
 * Distribuições estatísticas e utilitários numéricos.
 *
 * Implementações próprias (sem dependências de runtime) para garantir
 * reprodutibilidade offline. Referências:
 *  - Abramowitz & Stegun (1964), Handbook of Mathematical Functions.
 *  - Numerical Recipes, 3rd ed. (2007), caps. 6 e 7.
 *  - Johnson, Kotz & Balakrishnan (1995), Continuous Univariate Distributions.
 *  - ISO 3534-1:2006 (vocabulário de estatística).
 *
 * Tolerância dos testes: 1e-8 para funções de distribuição, salvo indicação.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x <= 0) return NaN;
  if (x < 0.5) {
    // reflexão: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function normalPdf(x: number, mean = 0, sd = 1): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Φ(x) — função de distribuição normal padrão. */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  // erf via aproximação de alta precisão (Cody, 1969), usando erfc.
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** erfc com precisão ~1e-15 (algoritmo de W. J. Cody). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/**
 * Inversa da normal padrão (Acklam, 2003), erro relativo < 1.15e-9.
 * Refinamento de Halley para ~1e-15.
 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  let x =
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
    q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  // refinamento de Halley
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

/** Função gama incompleta regularizada P(a,x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    // série
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 10000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // fração continuada para Q(a,x)
  return 1 - gammaQ(a, x);
}

/** Função gama incompleta regularizada Q(a,x) = 1 - P(a,x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  if (x < a + 1) return 1 - gammaP(a, x);
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Beta incompleta regularizada I_x(a,b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** FDP t de Student. */
export function tPdf(t: number, df: number): number {
  return (
    (Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) / Math.sqrt(df * Math.PI)) *
    Math.pow(1 + (t * t) / df, -(df + 1) / 2)
  );
}

/** FDA t de Student. */
export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const p = 0.5 * incompleteBeta(df / 2, 0.5, x);
  return t >= 0 ? 1 - p : p;
}

/** Inversa da t de Student (bisseção robusta). */
export function tInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** FDP χ². */
export function chi2Pdf(x: number, df: number): number {
  if (x < 0) return 0;
  if (x === 0) {
    if (df < 2) return Infinity;
    if (df === 2) return 0.5;
    return 0;
  }
  return Math.exp(
    (df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lnGamma(df / 2),
  );
}

/** FDA χ². */
export function chi2Cdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return gammaP(df / 2, x / 2);
}

/** Inversa da χ² (bisseção). */
export function chi2Inv(p: number, df: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = Math.max(10, df + 10 * Math.sqrt(2 * df) + 100);
  while (chi2Cdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chi2Cdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** FDA F de Snedecor. */
export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  const y = (d1 * x) / (d1 * x + d2);
  return incompleteBeta(d1 / 2, d2 / 2, y);
}

/** FDP F de Snedecor. */
export function fPdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  const l =
    (d1 / 2) * Math.log(d1 / d2) +
    (d1 / 2 - 1) * Math.log(x) -
    ((d1 + d2) / 2) * Math.log(1 + (d1 * x) / d2) -
    lnGamma(d1 / 2) -
    lnGamma(d2 / 2) +
    lnGamma((d1 + d2) / 2);
  return Math.exp(l);
}

/** Inversa da F (bisseção). */
export function fInv(p: number, d1: number, d2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 10;
  while (fCdf(hi, d1, d2) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (fCdf(mid, d1, d2) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * FDA χ² não central.
 * Mistura de Poisson de χ² centrais; normalização numérica das pesos para
 * evitar perda de precisão quando λ é grande.
 */
export function noncentralChi2Cdf(x: number, df: number, lambda: number): number {
  if (x <= 0) return 0;
  if (lambda <= 1e-12) return chi2Cdf(x, df);
  if (lambda > 5000) {
    // Wilson–Hilferty aproximada, documentada como aproximação.
    const mean = df + lambda;
    const variance = 2 * (df + 2 * lambda);
    const z = (Math.pow(x / mean, 1 / 3) - (1 - (2 / 9) * (mean / variance))) /
      Math.sqrt((2 / 9) * (mean / variance));
    return normalCdf(z);
  }
  const half = lambda / 2;
  const spread = 10 * Math.sqrt(half + 1) + 20;
  const jmin = Math.max(0, Math.floor(half - spread));
  const jmax = Math.ceil(half + spread);
  const logHalf = Math.log(half);
  let maxLog = -Infinity;
  const logs: number[] = [];
  for (let j = jmin; j <= jmax; j++) {
    const logw = -half + j * logHalf - lnGamma(j + 1);
    logs.push(logw);
    if (logw > maxLog) maxLog = logw;
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < logs.length; i++) {
    const w = Math.exp(logs[i] - maxLog);
    const j = jmin + i;
    num += w * gammaP(df / 2 + j, x / 2);
    den += w;
  }
  return num / den;
}

/**
 * FDA t não central.
 *
 * Para t > 0:
 *   P(T' ≤ t) = Φ(-δ) + ∫_{-δ}^{∞} Q_χ²(ν, ν(z+δ)²/t²) φ(z) dz
 * em que T' = (Z+δ)/√(V/ν), V ~ χ²_ν.
 * Para t < 0 usa-se a simetria P(T'_δ ≤ t) = 1 − P(T'_{-δ} ≤ −t).
 */
export function noncentralTCdf(t: number, df: number, delta: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (Math.abs(delta) < 1e-12) return tCdf(t, df);
  if (t < 0) return 1 - noncentralTCdf(-t, df, -delta);
  if (t === 0) return normalCdf(-delta);
  const shift = -delta;
  const transition = shift + t;
  const upper = Math.abs(delta) + Math.abs(t) + 20;
  const integrand = (z: number) => {
    const arg = (df * (z + delta) * (z + delta)) / (t * t);
    return gammaQ(df / 2, arg / 2) * normalPdf(z);
  };
  const tail = normalCdf(-delta);
  let integral = 0;
  if (transition > shift) {
    integral += adaptiveSimpson(integrand, shift, transition, 1e-10, 20);
    integral += adaptiveSimpson(integrand, transition, upper, 1e-10, 20);
  } else {
    integral += adaptiveSimpson(integrand, shift, upper, 1e-10, 20);
  }
  return Math.min(1, Math.max(0, tail + integral));
}

/**
 * FDA F não central.
 * Integra a FDA χ² não central do numerador sobre a χ² central do denominador:
 *   P(F' ≤ f) = ∫ P(χ²_{d1}(λ) ≤ d1 f v / d2) f_χ²_{d2}(v) dv.
 */
export function noncentralFCdf(
  f: number,
  d1: number,
  d2: number,
  lambda: number,
): number {
  if (f <= 0) return 0;
  if (lambda <= 1e-12) return fCdf(f, d1, d2);
  const upper = chi2Inv(1 - 1e-10, d2);
  const integrand = (v: number) =>
    noncentralChi2Cdf((d1 * f * v) / d2, d1, lambda) * chi2Pdf(v, d2);
  return Math.min(
    1,
    Math.max(0, adaptiveSimpson(integrand, 0, upper, 1e-9, 22)),
  );
}

/** Simpson adaptativo com tolerância absoluta. */
export function adaptiveSimpson(
  f: (x: number) => number,
  a: number,
  b: number,
  eps = 1e-9,
  maxDepth = 20,
): number {
  if (b <= a) return 0;
  const fa = f(a);
  const fb = f(b);
  const m = (a + b) / 2;
  const fm = f(m);
  const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
  const recurse = (
    x0: number,
    x1: number,
    f0: number,
    f1: number,
    f2: number,
    est: number,
    depth: number,
    tol: number,
  ): number => {
    const mid = (x0 + x1) / 2;
    const lm = (x0 + mid) / 2;
    const rm = (mid + x1) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = ((mid - x0) / 6) * (f0 + 4 * flm + f1);
    const right = ((x1 - mid) / 6) * (f1 + 4 * frm + f2);
    const delta = left + right - est;
    if (depth <= 0 || Math.abs(delta) <= 15 * tol) {
      return left + right + delta / 15;
    }
    return (
      recurse(x0, mid, f0, flm, f1, left, depth - 1, tol / 2) +
      recurse(mid, x1, f1, frm, f2, right, depth - 1, tol / 2)
    );
  };
  return recurse(a, b, fa, fm, fb, whole, maxDepth, eps);
}

/** Gerador pseudoaleatório determinístico (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Embaralhamento Fisher–Yates com semente reprodutível. */
export function shuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Formata número com casas significativas para exibição. */
export function fmt(x: number | null | undefined, digits = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (x !== 0 && Math.abs(x) < 1e-3) return x.toExponential(digits);
  return Number(x.toFixed(digits)).toLocaleString('pt-BR', {
    maximumFractionDigits: digits,
  });
}
