/**
 * ANOVA Mista Aninhada-Cruzada com Graus de Liberdade por Satterthwaite
 *
 * Delineamento:
 *   Fabricante (fixo, f) > Agulha (aninhada em Fabricante, aleatória, a)
 *   × Analista (aleatório, o) × Dia (aleatório, d), com r réplicas.
 *
 * Modelo Estatístico (irrestrito):
 *   y_ijklm = μ + α_i + β_j(i) + γ_k + δ_l + (αγ)_ik + (αδ)_il + (γδ)_kl
 *             + (βγ)_j(i)k + (βδ)_j(i)l + (αγδ)_ikl + (βγδ)_j(i)kl + ε_ijklm
 *
 * Referências:
 *   - Montgomery, D. C. (2020). Design and Analysis of Experiments (10ª ed.), Cap. 13 e 14.
 *   - Searle, S. R., Casella, G., McCulloch, C. E. (1992). Variance Components, Cap. 4 e 5.
 *   - Satterthwaite, F. E. (1946). An Approximate Distribution of Estimates of Variance Components.
 *     Biometrics Bulletin, 2(6), 110-114.
 *   - ISO 5725-2:2019: Accuracy (trueness and precision) of measurement methods and results.
 */

import { chi2Cdf, chi2Inv, fCdf, fmt, tCdf } from './distributions';

export interface MixedAnovaObservation {
  manufacturer: string;
  needle: string;
  analyst: string;
  day: string;
  replicate: number;
  value: number;
  runOrder?: number;
}

export interface MixedAnovaSourceRow {
  source: string;
  sourceKey: string;
  df: number;
  ss: number;
  ms: number;
  f: number | null;
  p: number | null;
  expectedMsText: string;
  denominatorFormula: string;
  denominatorMs: number | null;
  denominatorDf: number | null;
  hasNegativeCoefficients: boolean;
}

export interface MixedAnovaVarianceComponent {
  key: string;
  label: string;
  variance: number;
  rawVariance: number;
  standardDeviation: number;
  percentContribution: number;
  df: number | null;
  confidenceInterval: {
    lower: number;
    upper: number;
    confidence: number;
  } | null;
  truncated: boolean;
}

export interface MixedAnovaOutlier {
  index: number;
  manufacturer: string;
  needle: string;
  analyst: string;
  day: string;
  replicate: number;
  value: number;
  fittedValue: number;
  residual: number;
  studentizedResidual: number;
  pValue: number;
  isOutlier: boolean;
}

export interface MixedAnovaSensitivityAnalyst {
  bartlettStatistic: number | null;
  bartlettP: number | null;
  isHeteroscedastic: boolean;
  welchF: number | null;
  welchDf1: number | null;
  welchDf2: number | null;
  welchP: number | null;
  analystVariances: Record<
    string,
    { n: number; mean: number; variance: number; sd: number }
  >;
}

export interface MixedAnovaBudgetDof {
  repeatability: { sd: number; variance: number; df: number };
  analyst: { sd: number; variance: number; df: number | null };
  day: { sd: number; variance: number; df: number | null };
  intermediatePrecision: { sd: number; variance: number; df: number | null };
}

export interface MixedAnovaResult {
  nTotal: number;
  factors: {
    manufacturers: string[];
    needlesPerManufacturer: number;
    totalNeedles: number;
    analysts: string[];
    days: string[];
    replicates: number;
  };
  table: MixedAnovaSourceRow[];
  components: MixedAnovaVarianceComponent[];
  budget: MixedAnovaBudgetDof;
  outliers: {
    flagged: MixedAnovaOutlier[];
    bonferroniAlpha: number;
    sr: number;
  };
  sensitivity: MixedAnovaSensitivityAnalyst;
  warnings: string[];
  notes: string[];
  summary: string;
}

export interface MixedAnovaOptions {
  confidence?: number;
  alphaOutlier?: number;
}

function satterthwaiteDf(
  terms: Array<{ ms: number; df: number; coefficient: number }>,
): number | null {
  const L = terms.reduce((acc, t) => acc + t.coefficient * t.ms, 0);
  if (!Number.isFinite(L) || L <= 0) return null;
  let denom = 0;
  for (const t of terms) {
    if (t.df <= 0) return null;
    denom += ((t.coefficient * t.ms) ** 2) / t.df;
  }
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return (L * L) / denom;
}

function chiSquareSdInterval(
  variance: number,
  df: number | null,
  confidence: number,
): { lower: number; upper: number; confidence: number } | null {
  if (variance <= 0 || df === null || !Number.isFinite(df) || df <= 0) return null;
  const alpha = 1 - confidence;
  try {
    const chiLower = chi2Inv(1 - alpha / 2, df);
    const chiUpper = chi2Inv(alpha / 2, df);
    if (!chiLower || !chiUpper || chiLower <= 0 || chiUpper <= 0) return null;
    const lowerVar = (df * variance) / chiLower;
    const upperVar = (df * variance) / chiUpper;
    return {
      lower: Math.sqrt(Math.max(0, lowerVar)),
      upper: Math.sqrt(Math.max(0, upperVar)),
      confidence,
    };
  } catch {
    return null;
  }
}

/**
 * Executa a ANOVA Mista Aninhada-Cruzada para Fabricante > Agulha × Analista × Dia.
 * Exige delineamento estritamente balanceado.
 */
export function mixedNestedCrossedAnova(
  observations: MixedAnovaObservation[],
  options: MixedAnovaOptions = {},
): MixedAnovaResult {
  const confidence = options.confidence ?? 0.95;
  const alphaOutlier = options.alphaOutlier ?? 0.05;

  if (!observations || observations.length === 0) {
    throw new Error('Conjunto de observações vazio para ANOVA mista.');
  }

  // 1. Identificação e ordenação dos níveis dos fatores
  const manufacturers = [
    ...new Set(observations.map((o) => (o.manufacturer ?? '').trim())),
  ].filter(Boolean).sort();
  const needles = [
    ...new Set(observations.map((o) => (o.needle ?? '').trim())),
  ].filter(Boolean).sort();
  const analysts = [
    ...new Set(observations.map((o) => (o.analyst ?? '').trim())),
  ].filter(Boolean).sort();
  const days = [
    ...new Set(observations.map((o) => (o.day ?? '').trim())),
  ].filter(Boolean).sort();

  if (manufacturers.length < 2) {
    throw new Error(
      `A ANOVA mista requer pelo menos 2 fabricantes (encontrados: ${manufacturers.length}).`,
    );
  }
  if (analysts.length < 2) {
    throw new Error(
      `A ANOVA mista requer pelo menos 2 analistas (encontrados: ${analysts.length}).`,
    );
  }
  if (days.length < 2) {
    throw new Error(
      `A ANOVA mista requer pelo menos 2 dias (encontrados: ${days.length}).`,
    );
  }

  // Verificar agulhas por fabricante
  const needlesByMfg = new Map<string, Set<string>>();
  for (const mfg of manufacturers) {
    needlesByMfg.set(mfg, new Set());
  }
  for (const obs of observations) {
    const mfg = (obs.manufacturer ?? '').trim();
    const ndl = (obs.needle ?? '').trim();
    if (mfg && ndl) {
      needlesByMfg.get(mfg)?.add(ndl);
    }
  }

  const countsPerMfg = manufacturers.map((mfg) => needlesByMfg.get(mfg)?.size ?? 0);
  const a = countsPerMfg[0];
  if (a < 2) {
    throw new Error(
      `A ANOVA mista requer pelo menos 2 agulhas por fabricante (encontradas: ${a}).`,
    );
  }
  if (!countsPerMfg.every((count) => count === a)) {
    throw new Error(
      `Delineamento desbalanceado: número de agulhas difere entre fabricantes (${manufacturers
        .map((m, idx) => `${m}: ${countsPerMfg[idx]}`)
        .join(', ')}).`,
    );
  }

  // Mapeamento em células: chave = `${mfg}\u0000${needle}\u0000${analyst}\u0000${day}`
  const cells = new Map<string, number[]>();
  for (const obs of observations) {
    if (obs.value === null || obs.value === undefined || !Number.isFinite(obs.value)) {
      throw new Error(
        'Observação com valor numérico inválido ou ausente no delineamento de ANOVA mista.',
      );
    }
    const key = `${obs.manufacturer.trim()}\u0000${obs.needle.trim()}\u0000${obs.analyst.trim()}\u0000${obs.day.trim()}`;
    const list = cells.get(key) ?? [];
    list.push(obs.value);
    cells.set(key, list);
  }

  const f = manufacturers.length;
  const o = analysts.length;
  const d = days.length;
  const totalCells = f * a * o * d;

  if (cells.size !== totalCells) {
    throw new Error(
      `Delineamento incompleto: esperavam-se ${totalCells} células (${f} fabricantes × ${a} agulhas × ${o} analistas × ${d} dias), mas foram encontradas ${cells.size} células com dados.`,
    );
  }

  const replicateCounts = [...cells.values()].map((list) => list.length);
  const r = replicateCounts[0];
  if (r < 2) {
    throw new Error(
      `A ANOVA mista requer pelo menos 2 réplicas por célula (encontradas: ${r}).`,
    );
  }
  if (!replicateCounts.every((count) => count === r)) {
    throw new Error(
      `Delineamento desbalanceado: o número de réplicas difere entre células (mínimo ${Math.min(
        ...replicateCounts,
      )}, máximo ${Math.max(...replicateCounts)}).`,
    );
  }

  const N = f * a * o * d * r;
  if (observations.length !== N) {
    throw new Error(
      `Inconsistência no número total de observações: esperadas ${N}, encontradas ${observations.length}.`,
    );
  }

  // 2. Construção da matriz multidimensional balanceada y[i][j][k][l][m]
  const needleIndexMap = new Map<string, number>();
  for (const mfg of manufacturers) {
    const ndlList = [...(needlesByMfg.get(mfg) ?? [])].sort();
    ndlList.forEach((ndl, idx) => {
      needleIndexMap.set(`${mfg}\u0000${ndl}`, idx);
    });
  }

  const y: number[][][][][] = Array.from({ length: f }, () =>
    Array.from({ length: a }, () =>
      Array.from({ length: o }, () =>
        Array.from({ length: d }, () => Array.from({ length: r }, () => 0)),
      ),
    ),
  );

  for (let i = 0; i < f; i++) {
    const mfg = manufacturers[i];
    const ndlList = [...(needlesByMfg.get(mfg) ?? [])].sort();
    for (let j = 0; j < a; j++) {
      const ndl = ndlList[j];
      for (let k = 0; k < o; k++) {
        const ana = analysts[k];
        for (let l = 0; l < d; l++) {
          const dy = days[l];
          const key = `${mfg}\u0000${ndl}\u0000${ana}\u0000${dy}`;
          const vals = cells.get(key)!;
          for (let m = 0; m < r; m++) {
            y[i][j][k][l][m] = vals[m];
          }
        }
      }
    }
  }

  // 3. Médias e totais marginais
  let sumAll = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      for (let k = 0; k < o; k++) {
        for (let l = 0; l < d; l++) {
          for (let m = 0; m < r; m++) {
            sumAll += y[i][j][k][l][m];
          }
        }
      }
    }
  }
  const grandMean = sumAll / N;

  // y_bar_i (Fabricante)
  const meanF = Array.from({ length: f }, (_, i) => {
    let s = 0;
    for (let j = 0; j < a; j++)
      for (let k = 0; k < o; k++)
        for (let l = 0; l < d; l++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
    return s / (a * o * d * r);
  });

  // y_bar_ij (Agulha dentro de Fabricante)
  const meanAF = Array.from({ length: f }, (_, i) =>
    Array.from({ length: a }, (_, j) => {
      let s = 0;
      for (let k = 0; k < o; k++)
        for (let l = 0; l < d; l++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
      return s / (o * d * r);
    }),
  );

  // y_bar_k (Analista)
  const meanO = Array.from({ length: o }, (_, k) => {
    let s = 0;
    for (let i = 0; i < f; i++)
      for (let j = 0; j < a; j++)
        for (let l = 0; l < d; l++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
    return s / (f * a * d * r);
  });

  // y_bar_l (Dia)
  const meanD = Array.from({ length: d }, (_, l) => {
    let s = 0;
    for (let i = 0; i < f; i++)
      for (let j = 0; j < a; j++)
        for (let k = 0; k < o; k++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
    return s / (f * a * o * r);
  });

  // y_bar_ik (Fabricante × Analista)
  const meanFO = Array.from({ length: f }, (_, i) =>
    Array.from({ length: o }, (_, k) => {
      let s = 0;
      for (let j = 0; j < a; j++)
        for (let l = 0; l < d; l++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
      return s / (a * d * r);
    }),
  );

  // y_bar_il (Fabricante × Dia)
  const meanFD = Array.from({ length: f }, (_, i) =>
    Array.from({ length: d }, (_, l) => {
      let s = 0;
      for (let j = 0; j < a; j++)
        for (let k = 0; k < o; k++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
      return s / (a * o * r);
    }),
  );

  // y_bar_kl (Analista × Dia)
  const meanOD = Array.from({ length: o }, (_, k) =>
    Array.from({ length: d }, (_, l) => {
      let s = 0;
      for (let i = 0; i < f; i++)
        for (let j = 0; j < a; j++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
      return s / (f * a * r);
    }),
  );

  // y_bar_ijk (Analista × Agulha(Fabricante))
  const meanOAF = Array.from({ length: f }, (_, i) =>
    Array.from({ length: a }, (_, j) =>
      Array.from({ length: o }, (_, k) => {
        let s = 0;
        for (let l = 0; l < d; l++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
        return s / (d * r);
      }),
    ),
  );

  // y_bar_ijl (Dia × Agulha(Fabricante))
  const meanDAF = Array.from({ length: f }, (_, i) =>
    Array.from({ length: a }, (_, j) =>
      Array.from({ length: d }, (_, l) => {
        let s = 0;
        for (let k = 0; k < o; k++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
        return s / (o * r);
      }),
    ),
  );

  // y_bar_ikl (Fabricante × Analista × Dia)
  const meanFOD = Array.from({ length: f }, (_, i) =>
    Array.from({ length: o }, (_, k) =>
      Array.from({ length: d }, (_, l) => {
        let s = 0;
        for (let j = 0; j < a; j++)
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
        return s / (a * r);
      }),
    ),
  );

  // y_bar_ijkl (Célula: Analista × Dia × Agulha(Fabricante))
  const meanCell = Array.from({ length: f }, (_, i) =>
    Array.from({ length: a }, (_, j) =>
      Array.from({ length: o }, (_, k) =>
        Array.from({ length: d }, (_, l) => {
          let s = 0;
          for (let m = 0; m < r; m++) s += y[i][j][k][l][m];
          return s / r;
        }),
      ),
    ),
  );

  // 4. Somas de Quadrados (SS) e Graus de Liberdade (DF)
  let ssF = 0;
  for (let i = 0; i < f; i++) ssF += (meanF[i] - grandMean) ** 2;
  ssF *= a * o * d * r;
  const dfF = f - 1;

  let ssAF = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      ssAF += (meanAF[i][j] - meanF[i]) ** 2;
    }
  }
  ssAF *= o * d * r;
  const dfAF = f * (a - 1);

  let ssO = 0;
  for (let k = 0; k < o; k++) ssO += (meanO[k] - grandMean) ** 2;
  ssO *= f * a * d * r;
  const dfO = o - 1;

  let ssD = 0;
  for (let l = 0; l < d; l++) ssD += (meanD[l] - grandMean) ** 2;
  ssD *= f * a * o * r;
  const dfD = d - 1;

  let ssFO = 0;
  for (let i = 0; i < f; i++) {
    for (let k = 0; k < o; k++) {
      ssFO += (meanFO[i][k] - meanF[i] - meanO[k] + grandMean) ** 2;
    }
  }
  ssFO *= a * d * r;
  const dfFO = (f - 1) * (o - 1);

  let ssFD = 0;
  for (let i = 0; i < f; i++) {
    for (let l = 0; l < d; l++) {
      ssFD += (meanFD[i][l] - meanF[i] - meanD[l] + grandMean) ** 2;
    }
  }
  ssFD *= a * o * r;
  const dfFD = (f - 1) * (d - 1);

  let ssOD = 0;
  for (let k = 0; k < o; k++) {
    for (let l = 0; l < d; l++) {
      ssOD += (meanOD[k][l] - meanO[k] - meanD[l] + grandMean) ** 2;
    }
  }
  ssOD *= f * a * r;
  const dfOD = (o - 1) * (d - 1);

  let ssOAF = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      for (let k = 0; k < o; k++) {
        ssOAF += (meanOAF[i][j][k] - meanAF[i][j] - meanFO[i][k] + meanF[i]) ** 2;
      }
    }
  }
  ssOAF *= d * r;
  const dfOAF = f * (a - 1) * (o - 1);

  let ssDAF = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      for (let l = 0; l < d; l++) {
        ssDAF += (meanDAF[i][j][l] - meanAF[i][j] - meanFD[i][l] + meanF[i]) ** 2;
      }
    }
  }
  ssDAF *= o * r;
  const dfDAF = f * (a - 1) * (d - 1);

  let ssFOD = 0;
  for (let i = 0; i < f; i++) {
    for (let k = 0; k < o; k++) {
      for (let l = 0; l < d; l++) {
        ssFOD +=
          (meanFOD[i][k][l] -
            meanFO[i][k] -
            meanFD[i][l] -
            meanOD[k][l] +
            meanF[i] +
            meanO[k] +
            meanD[l] -
            grandMean) **
          2;
      }
    }
  }
  ssFOD *= a * r;
  const dfFOD = (f - 1) * (o - 1) * (d - 1);

  let ssODAF = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      for (let k = 0; k < o; k++) {
        for (let l = 0; l < d; l++) {
          ssODAF +=
            (meanCell[i][j][k][l] -
              meanOAF[i][j][k] -
              meanDAF[i][j][l] -
              meanFOD[i][k][l] +
              meanAF[i][j] +
              meanFO[i][k] +
              meanFD[i][l] -
              meanF[i]) **
            2;
        }
      }
    }
  }
  ssODAF *= r;
  const dfODAF = f * (a - 1) * (o - 1) * (d - 1);

  let ssE = 0;
  for (let i = 0; i < f; i++) {
    for (let j = 0; j < a; j++) {
      for (let k = 0; k < o; k++) {
        for (let l = 0; l < d; l++) {
          for (let m = 0; m < r; m++) {
            ssE += (y[i][j][k][l][m] - meanCell[i][j][k][l]) ** 2;
          }
        }
      }
    }
  }
  const dfE = f * a * o * d * (r - 1);

  const msF = ssF / dfF;
  const msAF = ssAF / dfAF;
  const msO = ssO / dfO;
  const msD = ssD / dfD;
  const msFO = ssFO / dfFO;
  const msFD = ssFD / dfFD;
  const msOD = ssOD / dfOD;
  const msOAF = ssOAF / dfOAF;
  const msDAF = ssDAF / dfDAF;
  const msFOD = ssFOD / dfFOD;
  const msODAF = ssODAF / dfODAF;
  const msE = ssE / dfE;

  const msMap = {
    F: { ms: msF, df: dfF },
    AF: { ms: msAF, df: dfAF },
    O: { ms: msO, df: dfO },
    D: { ms: msD, df: dfD },
    FO: { ms: msFO, df: dfFO },
    FD: { ms: msFD, df: dfFD },
    OD: { ms: msOD, df: dfOD },
    OAF: { ms: msOAF, df: dfOAF },
    DAF: { ms: msDAF, df: dfDAF },
    FOD: { ms: msFOD, df: dfFOD },
    ODAF: { ms: msODAF, df: dfODAF },
    E: { ms: msE, df: dfE },
  };

  // 5. Testes F (exatos e sintetizados por Satterthwaite)
  const warnings: string[] = [];
  const notes: string[] = [];

  function evaluateTest(
    numMs: number,
    numDf: number,
    terms: Array<{ key: keyof typeof msMap; coef: number }>,
    formulaStr: string,
  ): {
    f: number | null;
    p: number | null;
    denMs: number | null;
    denDf: number | null;
    hasNegativeCoefficients: boolean;
  } {
    const hasNegative = terms.some((t) => t.coef < 0);
    const denTerms = terms.map((t) => ({
      ms: msMap[t.key].ms,
      df: msMap[t.key].df,
      coefficient: t.coef,
    }));
    const denMs = denTerms.reduce((acc, t) => acc + t.coefficient * t.ms, 0);
    const denDf = satterthwaiteDf(denTerms);

    if (denMs <= 0 || denDf === null || !Number.isFinite(denDf) || denDf <= 0) {
      return {
        f: null,
        p: null,
        denMs: denMs <= 0 ? denMs : null,
        denDf: null,
        hasNegativeCoefficients: hasNegative,
      };
    }

    const fStat = numMs / denMs;
    const pVal = 1 - fCdf(fStat, numDf, denDf);
    return {
      f: fStat,
      p: Math.max(0, Math.min(1, pVal)),
      denMs,
      denDf,
      hasNegativeCoefficients: hasNegative,
    };
  }

  // Tabela de testes
  const testODAF = evaluateTest(msODAF, dfODAF, [{ key: 'E', coef: 1 }], 'MS_E');
  const testFOD = evaluateTest(msFOD, dfFOD, [{ key: 'ODAF', coef: 1 }], 'MS_ODA(F)');
  const testDAF = evaluateTest(msDAF, dfDAF, [{ key: 'ODAF', coef: 1 }], 'MS_ODA(F)');
  const testOAF = evaluateTest(msOAF, dfOAF, [{ key: 'ODAF', coef: 1 }], 'MS_ODA(F)');
  const testOD = evaluateTest(msOD, dfOD, [{ key: 'FOD', coef: 1 }], 'MS_FOD');

  const testFD = evaluateTest(
    msFD,
    dfFD,
    [
      { key: 'FOD', coef: 1 },
      { key: 'DAF', coef: 1 },
      { key: 'ODAF', coef: -1 },
    ],
    'MS_FOD + MS_DA(F) − MS_ODA(F)',
  );

  const testFO = evaluateTest(
    msFO,
    dfFO,
    [
      { key: 'FOD', coef: 1 },
      { key: 'OAF', coef: 1 },
      { key: 'ODAF', coef: -1 },
    ],
    'MS_FOD + MS_OA(F) − MS_ODA(F)',
  );

  const testAF = evaluateTest(
    msAF,
    dfAF,
    [
      { key: 'OAF', coef: 1 },
      { key: 'DAF', coef: 1 },
      { key: 'ODAF', coef: -1 },
    ],
    'MS_OA(F) + MS_DA(F) − MS_ODA(F)',
  );

  const testD = evaluateTest(
    msD,
    dfD,
    [
      { key: 'OD', coef: 1 },
      { key: 'FD', coef: 1 },
      { key: 'FOD', coef: -1 },
    ],
    'MS_OD + MS_FD − MS_FOD',
  );

  const testO = evaluateTest(
    msO,
    dfO,
    [
      { key: 'OD', coef: 1 },
      { key: 'FO', coef: 1 },
      { key: 'FOD', coef: -1 },
    ],
    'MS_OD + MS_FO − MS_FOD',
  );

  const testF = evaluateTest(
    msF,
    dfF,
    [
      { key: 'FO', coef: 1 },
      { key: 'FD', coef: 1 },
      { key: 'AF', coef: 1 },
      { key: 'ODAF', coef: 1 },
      { key: 'FOD', coef: -1 },
      { key: 'OAF', coef: -1 },
      { key: 'DAF', coef: -1 },
    ],
    'MS_FO + MS_FD + MS_A(F) + MS_ODA(F) − MS_FOD − MS_OA(F) − MS_DA(F)',
  );

  const testsWithNegative = [testFD, testFO, testAF, testD, testO, testF].filter(
    (t) => t.hasNegativeCoefficients,
  );
  if (testsWithNegative.length > 0) {
    notes.push(
      'Testes F sintetizados envolvem coeficientes negativos na esperança de QM do denominador; Satterthwaite aplicado conforme Montgomery (Cap. 14).',
    );
  }

  // 6. Solução do sistema linear de componentes de variância
  // Variância do erro
  const rawVarE = msE;

  // σ²_ODA(F) = (MS_ODA(F) - MS_E) / r
  const rawVarODAF = (msODAF - msE) / r;
  const dfVarODAF = satterthwaiteDf([
    { ms: msODAF, df: dfODAF, coefficient: 1 / r },
    { ms: msE, df: dfE, coefficient: -1 / r },
  ]);

  // σ²_FOD = (MS_FOD - MS_ODA(F)) / (a*r)
  const rawVarFOD = (msFOD - msODAF) / (a * r);
  const dfVarFOD = satterthwaiteDf([
    { ms: msFOD, df: dfFOD, coefficient: 1 / (a * r) },
    { ms: msODAF, df: dfODAF, coefficient: -1 / (a * r) },
  ]);

  // σ²_DA(F) = (MS_DA(F) - MS_ODA(F)) / (o*r)
  const rawVarDAF = (msDAF - msODAF) / (o * r);
  const dfVarDAF = satterthwaiteDf([
    { ms: msDAF, df: dfDAF, coefficient: 1 / (o * r) },
    { ms: msODAF, df: dfODAF, coefficient: -1 / (o * r) },
  ]);

  // σ²_OA(F) = (MS_OA(F) - MS_ODA(F)) / (d*r)
  const rawVarOAF = (msOAF - msODAF) / (d * r);
  const dfVarOAF = satterthwaiteDf([
    { ms: msOAF, df: dfOAF, coefficient: 1 / (d * r) },
    { ms: msODAF, df: dfODAF, coefficient: -1 / (d * r) },
  ]);

  // σ²_OD = (MS_OD - MS_FOD) / (f*a*r)
  const rawVarOD = (msOD - msFOD) / (f * a * r);
  const dfVarOD = satterthwaiteDf([
    { ms: msOD, df: dfOD, coefficient: 1 / (f * a * r) },
    { ms: msFOD, df: dfFOD, coefficient: -1 / (f * a * r) },
  ]);

  // σ²_FD = (MS_FD - MS_FOD - MS_DA(F) + MS_ODA(F)) / (a*o*r)
  const rawVarFD = (msFD - msFOD - msDAF + msODAF) / (a * o * r);
  const dfVarFD = satterthwaiteDf([
    { ms: msFD, df: dfFD, coefficient: 1 / (a * o * r) },
    { ms: msFOD, df: dfFOD, coefficient: -1 / (a * o * r) },
    { ms: msDAF, df: dfDAF, coefficient: -1 / (a * o * r) },
    { ms: msODAF, df: dfODAF, coefficient: 1 / (a * o * r) },
  ]);

  // σ²_FO = (MS_FO - MS_FOD - MS_OA(F) + MS_ODA(F)) / (a*d*r)
  const rawVarFO = (msFO - msFOD - msOAF + msODAF) / (a * d * r);
  const dfVarFO = satterthwaiteDf([
    { ms: msFO, df: dfFO, coefficient: 1 / (a * d * r) },
    { ms: msFOD, df: dfFOD, coefficient: -1 / (a * d * r) },
    { ms: msOAF, df: dfOAF, coefficient: -1 / (a * d * r) },
    { ms: msODAF, df: dfODAF, coefficient: 1 / (a * d * r) },
  ]);

  // σ²_D = (MS_D - MS_OD - MS_FD + MS_FOD) / (f*a*o*r)
  const rawVarD = (msD - msOD - msFD + msFOD) / (f * a * o * r);
  const dfVarD = satterthwaiteDf([
    { ms: msD, df: dfD, coefficient: 1 / (f * a * o * r) },
    { ms: msOD, df: dfOD, coefficient: -1 / (f * a * o * r) },
    { ms: msFD, df: dfFD, coefficient: -1 / (f * a * o * r) },
    { ms: msFOD, df: dfFOD, coefficient: 1 / (f * a * o * r) },
  ]);

  // σ²_O = (MS_O - MS_OD - MS_FO + MS_FOD) / (f*a*d*r)
  const rawVarO = (msO - msOD - msFO + msFOD) / (f * a * d * r);
  const dfVarO = satterthwaiteDf([
    { ms: msO, df: dfO, coefficient: 1 / (f * a * d * r) },
    { ms: msOD, df: dfOD, coefficient: -1 / (f * a * d * r) },
    { ms: msFO, df: dfFO, coefficient: -1 / (f * a * d * r) },
    { ms: msFOD, df: dfFOD, coefficient: 1 / (f * a * d * r) },
  ]);

  // σ²_A(F) = (MS_A(F) - MS_OA(F) - MS_DA(F) + MS_ODA(F)) / (o*d*r)
  const rawVarAF = (msAF - msOAF - msDAF + msODAF) / (o * d * r);
  const dfVarAF = satterthwaiteDf([
    { ms: msAF, df: dfAF, coefficient: 1 / (o * d * r) },
    { ms: msOAF, df: dfOAF, coefficient: -1 / (o * d * r) },
    { ms: msDAF, df: dfDAF, coefficient: -1 / (o * d * r) },
    { ms: msODAF, df: dfODAF, coefficient: 1 / (o * d * r) },
  ]);

  // Componentes de variância brutos
  const rawVars: Record<string, { raw: number; df: number | null; label: string }> = {
    analyst: { raw: rawVarO, df: dfVarO, label: 'Analista (σ²_analista)' },
    day: { raw: rawVarD, df: dfVarD, label: 'Dia (σ²_dia)' },
    needle: { raw: rawVarAF, df: dfVarAF, label: 'Agulha(Fabricante) (σ²_agulha)' },
    analyst_day: { raw: rawVarOD, df: dfVarOD, label: 'Analista × Dia (σ²_OD)' },
    mfg_analyst: { raw: rawVarFO, df: dfVarFO, label: 'Fabricante × Analista (σ²_FO)' },
    mfg_day: { raw: rawVarFD, df: dfVarFD, label: 'Fabricante × Dia (σ²_FD)' },
    analyst_needle: { raw: rawVarOAF, df: dfVarOAF, label: 'Analista × Agulha(Fab) (σ²_OA(F))' },
    day_needle: { raw: rawVarDAF, df: dfVarDAF, label: 'Dia × Agulha(Fab) (σ²_DA(F))' },
    mfg_analyst_day: { raw: rawVarFOD, df: dfVarFOD, label: 'Fabricante × Analista × Dia (σ²_FOD)' },
    three_way_needle: { raw: rawVarODAF, df: dfVarODAF, label: 'Analista × Dia × Agulha(Fab) (σ²_ODA(F))' },
    repeatability: { raw: rawVarE, df: dfE, label: 'Repetibilidade / Erro (σ²_e)' },
  };

  const hasNegativeVars = Object.values(rawVars).some((v) => v.raw < 0);
  if (hasNegativeVars) {
    warnings.push(
      'Um ou mais componentes de variância estimados resultaram negativos antes do truncamento (MS_fonte < MS_resíduo). Conforme ISO 5725-2, esses componentes foram truncados em zero para a partição descritiva.',
    );
  }

  // Truncar em zero conforme ISO 5725-2
  const varE = Math.max(0, rawVarE);
  const varO = Math.max(0, rawVarO);
  const varD = Math.max(0, rawVarD);
  const varAF = Math.max(0, rawVarAF);
  const varOD = Math.max(0, rawVarOD);
  const varFO = Math.max(0, rawVarFO);
  const varFD = Math.max(0, rawVarFD);
  const varOAF = Math.max(0, rawVarOAF);
  const varDAF = Math.max(0, rawVarDAF);
  const varFOD = Math.max(0, rawVarFOD);
  const varODAF = Math.max(0, rawVarODAF);

  const totalVar =
    varE +
    varO +
    varD +
    varAF +
    varOD +
    varFO +
    varFD +
    varOAF +
    varDAF +
    varFOD +
    varODAF;

  const components: MixedAnovaVarianceComponent[] = Object.entries(rawVars).map(
    ([key, item]) => {
      const variance = Math.max(0, item.raw);
      const standardDeviation = Math.sqrt(variance);
      const percentContribution = totalVar > 0 ? (100 * variance) / totalVar : 0;
      const confidenceInterval = chiSquareSdInterval(variance, item.df, confidence);
      return {
        key,
        label: item.label,
        variance,
        rawVariance: item.raw,
        standardDeviation,
        percentContribution,
        df: item.df,
        confidenceInterval,
        truncated: item.raw < 0,
      };
    },
  );

  // Precisão intermediária: σ²_ip = σ²_O + σ²_D + σ²_OD (ou somado à repetibilidade no orçamento)
  const rawVarIp = rawVarO + rawVarD + rawVarOD;
  const dfVarIp = satterthwaiteDf([
    { ms: msO, df: dfO, coefficient: 1 / (f * a * d * r) },
    { ms: msD, df: dfD, coefficient: 1 / (f * a * o * r) },
    { ms: msOD, df: dfOD, coefficient: 1 / (f * a * r) },
    { ms: msFO, df: dfFO, coefficient: -1 / (f * a * d * r) },
    { ms: msFD, df: dfFD, coefficient: -1 / (f * a * o * r) },
  ]);

  const budget: MixedAnovaBudgetDof = {
    repeatability: {
      sd: Math.sqrt(varE),
      variance: varE,
      df: dfE,
    },
    analyst: {
      sd: Math.sqrt(varO),
      variance: varO,
      df: dfVarO,
    },
    day: {
      sd: Math.sqrt(varD),
      variance: varD,
      df: dfVarD,
    },
    intermediatePrecision: {
      sd: Math.sqrt(Math.max(0, rawVarIp)),
      variance: Math.max(0, rawVarIp),
      df: dfVarIp,
    },
  };

  // 7. Detecção de Outliers por Resíduo Estudentizado (Bonferroni)
  const sr = Math.sqrt(msE);
  const bonferroniAlpha = alphaOutlier / N;
  const flaggedOutliers: MixedAnovaOutlier[] = [];

  observations.forEach((obs, index) => {
    const i = manufacturers.indexOf(obs.manufacturer.trim());
    const j = needleIndexMap.get(`${obs.manufacturer.trim()}\u0000${obs.needle.trim()}`) ?? 0;
    const k = analysts.indexOf(obs.analyst.trim());
    const l = days.indexOf(obs.day.trim());

    const fitted = meanCell[i][j][k][l];
    const residual = obs.value - fitted;
    const h = 1 / r;
    const seRes = sr * Math.sqrt(Math.max(1e-12, 1 - h));
    const studentized = seRes > 0 ? residual / seRes : 0;
    const pVal = 2 * (1 - tCdf(Math.abs(studentized), dfE));
    const isOut = pVal < bonferroniAlpha;

    if (isOut) {
      flaggedOutliers.push({
        index,
        manufacturer: obs.manufacturer,
        needle: obs.needle,
        analyst: obs.analyst,
        day: obs.day,
        replicate: obs.replicate,
        value: obs.value,
        fittedValue: fitted,
        residual,
        studentizedResidual: studentized,
        pValue: pVal,
        isOutlier: true,
      });
    }
  });

  if (flaggedOutliers.length > 0) {
    warnings.push(
      `${flaggedOutliers.length} observação(ões) sinalizada(s) como potencial(is) outlier(s) por resíduo estudentizado com correção de Bonferroni (α = ${bonferroniAlpha.toExponential(
        2,
      )}). Conforme política do sistema, nenhum dado foi excluído automaticamente.`,
    );
  }

  // 8. Welch-ANOVA Bloqueada por Agulha para Analista (Sensibilidade)
  // Subtrai o efeito da agulha para análise robusta de sensibilidade
  const analystVariances: Record<
    string,
    { n: number; mean: number; variance: number; sd: number }
  > = {};
  for (const ana of analysts) {
    const vals = observations
      .filter((obs) => obs.analyst.trim() === ana)
      .map((obs) => {
        const mfg = obs.manufacturer.trim();
        const ndl = obs.needle.trim();
        const i = manufacturers.indexOf(mfg);
        const j = needleIndexMap.get(`${mfg}\u0000${ndl}`) ?? 0;
        return obs.value - meanAF[i][j] + grandMean;
      });

    const nK = vals.length;
    const mK = vals.reduce((a, b) => a + b, 0) / nK;
    const vK = vals.reduce((a, b) => a + (b - mK) ** 2, 0) / (nK - 1);
    analystVariances[ana] = {
      n: nK,
      mean: mK,
      variance: vK,
      sd: Math.sqrt(vK),
    };
  }

  // Teste de Bartlett para homogeneidade entre analistas
  let bartlettP: number | null = null;
  let bartlettStat: number | null = null;
  let isHetero = false;
  try {
    const kGroups = Object.values(analystVariances);
    const nTotalAdj = kGroups.reduce((acc, g) => acc + g.n, 0);
    const pooledV =
      kGroups.reduce((acc, g) => acc + (g.n - 1) * g.variance, 0) /
      (nTotalAdj - kGroups.length);
    if (pooledV > 0 && kGroups.every((g) => g.variance > 0)) {
      const num =
        (nTotalAdj - kGroups.length) * Math.log(pooledV) -
        kGroups.reduce((acc, g) => acc + (g.n - 1) * Math.log(g.variance), 0);
      const c =
        1 +
        (1 / (3 * (kGroups.length - 1))) *
          (kGroups.reduce((acc, g) => acc + 1 / (g.n - 1), 0) -
            1 / (nTotalAdj - kGroups.length));
      bartlettStat = num / c;
      bartlettP = 1 - chi2Cdf(Math.max(0, bartlettStat), kGroups.length - 1);
      isHetero = bartlettP < 0.05;
    }
  } catch {
    bartlettP = null;
  }

  // Welch ANOVA para analistas bloqueado por agulha
  let welchF: number | null = null;
  let welchDf1: number | null = null;
  let welchDf2: number | null = null;
  let welchP: number | null = null;

  try {
    const groups = Object.values(analystVariances);
    const wK = groups.map((g) => g.n / g.variance);
    const sumW = wK.reduce((a, b) => a + b, 0);
    const yPrime = groups.reduce((acc, g, idx) => acc + wK[idx] * g.mean, 0) / sumW;

    const termNum =
      (1 / (groups.length - 1)) *
      groups.reduce((acc, g, idx) => acc + wK[idx] * (g.mean - yPrime) ** 2, 0);
    const lambda = groups.reduce(
      (acc, g, idx) => acc + ((1 - wK[idx] / sumW) ** 2) / (g.n - 1),
      0,
    );
    const termDen = 1 + (2 * (groups.length - 2) * lambda) / (groups.length ** 2 - 1);

    welchF = termNum / termDen;
    welchDf1 = groups.length - 1;
    welchDf2 = (groups.length ** 2 - 1) / (3 * lambda);
    welchP = 1 - fCdf(welchF, welchDf1, welchDf2);
  } catch {
    welchF = null;
  }

  const sensitivity: MixedAnovaSensitivityAnalyst = {
    bartlettStatistic: bartlettStat,
    bartlettP,
    isHeteroscedastic: isHetero,
    welchF,
    welchDf1,
    welchDf2,
    welchP,
    analystVariances,
  };

  if (isHetero) {
    notes.push(
      `Variâncias entre analistas heterocedásticas pelo teste de Bartlett (p = ${fmt(
        bartlettP,
      )}). A Welch-ANOVA bloqueada por agulha confirma F_Welch = ${fmt(
        welchF,
      )} (p = ${fmt(welchP)}).`,
    );
  }

  // 9. Tabela ANOVA completa
  const table: MixedAnovaSourceRow[] = [
    {
      source: 'Fabricante (fixo)',
      sourceKey: 'F',
      df: dfF,
      ss: ssF,
      ms: msF,
      f: testF.f,
      p: testF.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + o·r·σ²_DA(F) + d·r·σ²_OA(F) + a·o·r·σ²_FD + a·d·r·σ²_FO + o·d·r·σ²_A(F) + a·o·d·r·φ_F',
      denominatorFormula: testF.denDf ? 'Sintetizado (Satterthwaite)' : '—',
      denominatorMs: testF.denMs,
      denominatorDf: testF.denDf,
      hasNegativeCoefficients: testF.hasNegativeCoefficients,
    },
    {
      source: 'Agulha(Fabricante) (aleat.)',
      sourceKey: 'AF',
      df: dfAF,
      ss: ssAF,
      ms: msAF,
      f: testAF.f,
      p: testAF.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + o·r·σ²_DA(F) + d·r·σ²_OA(F) + o·d·r·σ²_A(F)',
      denominatorFormula: 'MS_OA(F) + MS_DA(F) − MS_ODA(F)',
      denominatorMs: testAF.denMs,
      denominatorDf: testAF.denDf,
      hasNegativeCoefficients: testAF.hasNegativeCoefficients,
    },
    {
      source: 'Analista (aleat.)',
      sourceKey: 'O',
      df: dfO,
      ss: ssO,
      ms: msO,
      f: testO.f,
      p: testO.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + d·r·σ²_OA(F) + f·a·r·σ²_OD + a·d·r·σ²_FO + f·a·d·r·σ²_O',
      denominatorFormula: 'MS_OD + MS_FO − MS_FOD',
      denominatorMs: testO.denMs,
      denominatorDf: testO.denDf,
      hasNegativeCoefficients: testO.hasNegativeCoefficients,
    },
    {
      source: 'Dia (aleat.)',
      sourceKey: 'D',
      df: dfD,
      ss: ssD,
      ms: msD,
      f: testD.f,
      p: testD.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + o·r·σ²_DA(F) + f·a·r·σ²_OD + a·o·r·σ²_FD + f·a·o·r·σ²_D',
      denominatorFormula: 'MS_OD + MS_FD − MS_FOD',
      denominatorMs: testD.denMs,
      denominatorDf: testD.denDf,
      hasNegativeCoefficients: testD.hasNegativeCoefficients,
    },
    {
      source: 'Fabricante × Analista',
      sourceKey: 'FO',
      df: dfFO,
      ss: ssFO,
      ms: msFO,
      f: testFO.f,
      p: testFO.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + d·r·σ²_OA(F) + a·d·r·σ²_FO',
      denominatorFormula: 'MS_FOD + MS_OA(F) − MS_ODA(F)',
      denominatorMs: testFO.denMs,
      denominatorDf: testFO.denDf,
      hasNegativeCoefficients: testFO.hasNegativeCoefficients,
    },
    {
      source: 'Fabricante × Dia',
      sourceKey: 'FD',
      df: dfFD,
      ss: ssFD,
      ms: msFD,
      f: testFD.f,
      p: testFD.p,
      expectedMsText:
        'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + o·r·σ²_DA(F) + a·o·r·σ²_FD',
      denominatorFormula: 'MS_FOD + MS_DA(F) − MS_ODA(F)',
      denominatorMs: testFD.denMs,
      denominatorDf: testFD.denDf,
      hasNegativeCoefficients: testFD.hasNegativeCoefficients,
    },
    {
      source: 'Analista × Dia',
      sourceKey: 'OD',
      df: dfOD,
      ss: ssOD,
      ms: msOD,
      f: testOD.f,
      p: testOD.p,
      expectedMsText: 'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD + f·a·r·σ²_OD',
      denominatorFormula: 'MS_FOD',
      denominatorMs: testOD.denMs,
      denominatorDf: testOD.denDf,
      hasNegativeCoefficients: testOD.hasNegativeCoefficients,
    },
    {
      source: 'Analista × Agulha(Fabricante)',
      sourceKey: 'OAF',
      df: dfOAF,
      ss: ssOAF,
      ms: msOAF,
      f: testOAF.f,
      p: testOAF.p,
      expectedMsText: 'σ²_e + r·σ²_ODA(F) + d·r·σ²_OA(F)',
      denominatorFormula: 'MS_ODA(F)',
      denominatorMs: testOAF.denMs,
      denominatorDf: testOAF.denDf,
      hasNegativeCoefficients: testOAF.hasNegativeCoefficients,
    },
    {
      source: 'Dia × Agulha(Fabricante)',
      sourceKey: 'DAF',
      df: dfDAF,
      ss: ssDAF,
      ms: msDAF,
      f: testDAF.f,
      p: testDAF.p,
      expectedMsText: 'σ²_e + r·σ²_ODA(F) + o·r·σ²_DA(F)',
      denominatorFormula: 'MS_ODA(F)',
      denominatorMs: testDAF.denMs,
      denominatorDf: testDAF.denDf,
      hasNegativeCoefficients: testDAF.hasNegativeCoefficients,
    },
    {
      source: 'Fabricante × Analista × Dia',
      sourceKey: 'FOD',
      df: dfFOD,
      ss: ssFOD,
      ms: msFOD,
      f: testFOD.f,
      p: testFOD.p,
      expectedMsText: 'σ²_e + r·σ²_ODA(F) + a·r·σ²_FOD',
      denominatorFormula: 'MS_ODA(F)',
      denominatorMs: testFOD.denMs,
      denominatorDf: testFOD.denDf,
      hasNegativeCoefficients: testFOD.hasNegativeCoefficients,
    },
    {
      source: 'Analista × Dia × Agulha(Fabricante)',
      sourceKey: 'ODAF',
      df: dfODAF,
      ss: ssODAF,
      ms: msODAF,
      f: testODAF.f,
      p: testODAF.p,
      expectedMsText: 'σ²_e + r·σ²_ODA(F)',
      denominatorFormula: 'MS_E',
      denominatorMs: testODAF.denMs,
      denominatorDf: testODAF.denDf,
      hasNegativeCoefficients: testODAF.hasNegativeCoefficients,
    },
    {
      source: 'Repetibilidade (erro)',
      sourceKey: 'E',
      df: dfE,
      ss: ssE,
      ms: msE,
      f: null,
      p: null,
      expectedMsText: 'σ²_e',
      denominatorFormula: '—',
      denominatorMs: null,
      denominatorDf: null,
      hasNegativeCoefficients: false,
    },
  ];

  const summary = `ANOVA Mista Aninhada-Cruzada (${f} fabricantes × ${a} agulhas × ${o} analistas × ${d} dias × ${r} réplicas = ${N} observações). σ_rep = ${fmt(
    budget.repeatability.sd,
  )} (gl = ${dfE}); σ_analista = ${fmt(budget.analyst.sd)} (gl_Satt = ${
    budget.analyst.df !== null ? fmt(budget.analyst.df, 1) : '—'
  }); σ_dia = ${fmt(budget.day.sd)} (gl_Satt = ${
    budget.day.df !== null ? fmt(budget.day.df, 1) : '—'
  }).`;

  return {
    nTotal: N,
    factors: {
      manufacturers,
      needlesPerManufacturer: a,
      totalNeedles: f * a,
      analysts,
      days,
      replicates: r,
    },
    table,
    components,
    budget,
    outliers: {
      flagged: flaggedOutliers,
      bonferroniAlpha,
      sr,
    },
    sensitivity,
    warnings,
    notes,
    summary,
  };
}
