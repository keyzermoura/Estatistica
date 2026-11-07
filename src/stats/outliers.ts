/**
 * Identificação de outliers.
 *
 * Nenhum valor é removido automaticamente: as funções apenas sinalizam e o
 * repositório exige justificativa registrada para exclusão (ISO/IEC 17025).
 *
 * Referências:
 *  - Grubbs (1969), Technometrics 11:1–21.
 *  - Cochran (1941), Ann. Eug. 11:47–52; ISO 5725-2:2019, anexo B.
 *  - Hampel (1974), JASA 69:383–393.
 */

import { median, mean, sd } from './descriptive';
import { tCdf } from './distributions';

export interface OutlierFlag {
  index: number;
  value: number;
  statistic: number;
  threshold: number;
  outlier: boolean;
  label: string;
}

export interface GrubbsResult {
  n: number;
  mean: number;
  sd: number;
  g: number;
  gCrit: number;
  alpha: number;
  sides: 1 | 2;
  pValue: number;
  outlier: boolean;
  flags: OutlierFlag[];
  method: string;
  reference: string;
}

/** Estatística G de Grubbs (maior desvio absoluto em relação à média). */
export function grubbsStatistic(values: number[]): {
  g: number;
  index: number;
} {
  if (values.length < 3) return { g: NaN, index: -1 };
  const m = mean(values);
  const s = sd(values);
  if (!(s > 0)) return { g: 0, index: -1 };
  let max = -1;
  let index = -1;
  values.forEach((v, i) => {
    const z = Math.abs(v - m) / s;
    if (z > max) {
      max = z;
      index = i;
    }
  });
  return { g: max, index };
}

/** Valor crítico bilateral de Grubbs para α. */
export function grubbsCritical(n: number, alpha = 0.05, sides: 1 | 2 = 2): number {
  if (n < 3) return NaN;
  const a = sides === 2 ? alpha / (2 * n) : alpha / n;
  const t = tCdfInverse(1 - a, n - 2);
  return ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t));
}

// inversa local para evitar import circular de distribuições
function tCdfInverse(p: number, df: number): number {
  let lo = 0;
  let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function grubbsTest(
  values: number[],
  alpha = 0.05,
  sides: 1 | 2 = 2,
): GrubbsResult {
  const n = values.length;
  if (n < 3) {
    return {
      n,
      mean: n ? mean(values) : NaN,
      sd: n > 1 ? sd(values) : NaN,
      g: NaN,
      gCrit: NaN,
      alpha,
      sides,
      pValue: NaN,
      outlier: false,
      flags: [],
      method: 'Grubbs',
      reference: 'Grubbs (1969); ISO 5725-2:2019, anexo B',
    };
  }
  const m = mean(values);
  const s = sd(values);
  const { g, index } = grubbsStatistic(values);
  const gCrit = grubbsCritical(n, alpha, sides);
  let pValue = NaN;
  if (s > 0 && g < 1) {
    const t =
      Math.sqrt((n * (n - 2) * g * g) / ((n - 1) * (n - 1) - n * g * g));
    pValue = Math.min(
      1,
      (sides === 2 ? 2 * n : n) * (1 - tCdf(t, n - 2)),
    );
  }
  const flags: OutlierFlag[] = values.map((v, i) => {
    const stat = s > 0 ? Math.abs(v - m) / s : 0;
    return {
      index: i,
      value: v,
      statistic: stat,
      threshold: gCrit,
      outlier: i === index && g > gCrit,
      label:
        i === index && g > gCrit
          ? `Valor ${v} excede G crítico (${g.toFixed(3)} > ${gCrit.toFixed(3)})`
          : `Valor ${v} dentro do limite (G = ${stat.toFixed(3)})`,
    };
  });
  return {
    n,
    mean: m,
    sd: s,
    g,
    gCrit,
    alpha,
    sides,
    pValue,
    outlier: g > gCrit,
    flags,
    method:
      sides === 2
        ? 'Grubbs bilateral (α ajustado por Bonferroni)'
        : 'Grubbs unilateral',
    reference: 'Grubbs (1969); ISO 5725-2:2019, anexo B; ASTM E178',
  };
}

/** Aplica Grubbs repetidamente, removendo um valor por vez (para diagnóstico). */
export function grubbsIterative(
  values: number[],
  alpha = 0.05,
  sides: 1 | 2 = 2,
): { kept: number[]; removed: Array<{ value: number; index: number; g: number }> } {
  let current = values.map((value, index) => ({ value, index }));
  const removed: Array<{ value: number; index: number; g: number }> = [];
  for (let guard = 0; guard < values.length; guard++) {
    if (current.length < 3) break;
    const test = grubbsTest(
      current.map((d) => d.value),
      alpha,
      sides,
    );
    if (!test.outlier) break;
    const local = test.flags.findIndex((f) => f.outlier);
    if (local < 0) break;
    const [item] = current.splice(local, 1);
    removed.push({ value: item.value, index: item.index, g: test.g });
  }
  return { kept: current.map((d) => d.value), removed };
}

const COCHRAN_005: Record<number, number[]> = {
  2: [0.9985, 0.975, 0.9392, 0.9057, 0.8772, 0.8534, 0.8332, 0.8159, 0.801, 0.788],
  3: [0.9669, 0.8709, 0.7977, 0.7457, 0.7071, 0.6771, 0.653, 0.6333, 0.6167, 0.6025],
  4: [0.9065, 0.7679, 0.6841, 0.6287, 0.5895, 0.5598, 0.5365, 0.5175, 0.5017, 0.4884],
  5: [0.8412, 0.6838, 0.5981, 0.544, 0.5063, 0.4783, 0.4564, 0.4387, 0.4241, 0.4118],
  6: [0.7808, 0.6161, 0.5321, 0.4803, 0.4447, 0.4184, 0.398, 0.3817, 0.3682, 0.3568],
  7: [0.7271, 0.5612, 0.48, 0.4307, 0.3974, 0.3726, 0.3535, 0.3384, 0.3259, 0.3154],
  8: [0.6798, 0.5153, 0.4377, 0.391, 0.3595, 0.3362, 0.3185, 0.3043, 0.2926, 0.2829],
  9: [0.6385, 0.4775, 0.4027, 0.3584, 0.3286, 0.3067, 0.2901, 0.2768, 0.2659, 0.2568],
  10: [0.602, 0.445, 0.3733, 0.3311, 0.3029, 0.2823, 0.2666, 0.2541, 0.2439, 0.2353],
};

export interface CochranResult {
  k: number;
  df: number;
  c: number;
  cCrit: number;
  alpha: number;
  outlierGroup: number | null;
  groupVariances: number[];
  outlier: boolean;
  pNote: string;
  method: string;
  reference: string;
}

/**
 * Teste de Cochran para igualdade de variâncias (detecta o grupo com maior
 * variância). C = s²_max / Σ s²_i.
 */
export function cochranTest(
  groups: number[][],
  alpha = 0.05,
): CochranResult {
  const variances = groups.map((g) => {
    const s = sd(g);
    return Number.isFinite(s) ? s * s : 0;
  });
  const k = variances.length;
  const df = Math.max(...groups.map((g) => g.length)) - 1;
  const total = variances.reduce((a, b) => a + b, 0);
  const max = Math.max(...variances);
  const c = total > 0 ? max / total : NaN;
  let cCrit = NaN;
  if (alpha === 0.05 && COCHRAN_005[k] && df >= 1 && df <= 10) {
    cCrit = COCHRAN_005[k][df - 1];
  }
  const outlierGroup =
    Number.isFinite(cCrit) && c > cCrit ? variances.indexOf(max) : null;
  return {
    k,
    df,
    c,
    cCrit,
    alpha,
    outlierGroup,
    groupVariances: variances,
    outlier: outlierGroup !== null,
    pNote: Number.isFinite(cCrit)
      ? c > cCrit
        ? 'Rejeita-se a homogeneidade: o grupo com maior variância difere dos demais.'
        : 'Não se rejeita a homogeneidade das variâncias.'
      : 'Valor crítico não tabelado para esta combinação; use Levene/Bartlett.',
    method: 'Cochran (variâncias)',
    reference: 'Cochran (1941); ISO 5725-2:2019, anexo B; ASTM E178',
  };
}

export interface HampelResult {
  median: number;
  mad: number;
  sigmaRobust: number;
  threshold: number;
  flags: OutlierFlag[];
  outliers: number[];
  method: string;
  reference: string;
}

/** Identificador de Hampel: mediana ± k·1,4826·MAD. */
export function hampelTest(values: number[], k = 3): HampelResult {
  const med = median(values);
  const deviations = values.map((v) => Math.abs(v - med));
  const mad = median(deviations);
  const sigmaRobust = 1.4826 * mad;
  const threshold = k * sigmaRobust;
  const flags: OutlierFlag[] = values.map((v, i) => {
    const stat = Math.abs(v - med);
    return {
      index: i,
      value: v,
      statistic: stat,
      threshold,
      outlier: sigmaRobust > 0 && stat > threshold,
      label: `Desvio da mediana = ${stat.toPrecision(4)}`,
    };
  });
  return {
    median: med,
    mad,
    sigmaRobust,
    threshold,
    flags,
    outliers: flags.filter((f) => f.outlier).map((f) => f.value),
    method: `Hampel (k = ${k})`,
    reference: 'Hampel (1974); ISO 13528:2022, anexo C',
  };
}

/** z-score robusto (mediana/MAD) para cada observação. */
export function robustZScores(values: number[]): number[] {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  const scale = 1.4826 * mad;
  return values.map((v) => (scale > 0 ? (v - med) / scale : 0));
}
