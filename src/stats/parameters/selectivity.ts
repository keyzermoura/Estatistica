/**
 * Seletividade / especificidade — módulo do perfil analítico.
 *
 * Quando as medições identificam explicitamente brancos, amostras fortificadas/
 * com interferentes ou resolução crítica (via `level`, `sample`, `lot` ou `notes`),
 * calcula recuperação na presença de interferente, compara matriz/interferente vs.
 * padrão limpo quando disponível e avalia a resolução crítica contra os critérios.
 * Sem marcadores de seletividade, mantém o parâmetro como não avaliado para não
 * misturar amostras de curva/repetibilidade comuns com teste de interferentes.
 *
 * Referência: ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2); EURACHEM.
 */

import type { Measurement } from '../../lib/types';
import { evaluateParameter } from '../../lib/criteria';
import { anovaOneWay } from '../anova';
import { recoveryTest } from '../bias';
import { describe } from '../descriptive';
import { tCdf } from '../distributions';
import { linearRegression, type RegressionPoint } from '../regression';
import type { AnalysisModule, AnalysisTable } from '../analysis-types';
import {
  buildMetric,
  emptyParameter,
  parameterSummary,
  referenceOf,
} from '../analysis-utils';

const BLANK_RE = /\b(branco|blank)\b/i;
const INTERFERENT_RE =
  /(interferen|matriz|matrix|fortificad|spiked|adicionad)/i;
const STANDARD_RE = /\b(padrao|standard|solucao|controle|control|limp[ao])\b/i;
const RESOLUTION_RE = /(resoluc|resolution|\brs\b)/i;

function normalizedTagText(m: Measurement): string {
  return [m.level, m.sample, m.lot, m.notes]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function finiteRef(m: Measurement): number | null {
  if (
    m.referenceValue !== null &&
    m.referenceValue !== undefined &&
    Number.isFinite(m.referenceValue)
  ) {
    return m.referenceValue;
  }
  if (
    m.refValue !== null &&
    m.refValue !== undefined &&
    Number.isFinite(m.refValue)
  ) {
    return m.refValue;
  }
  return referenceOf(m);
}

export interface MatrixEffectCurveComparison {
  solventSlope: number;
  solventSlopeSe: number;
  solventIntercept: number;
  solventSyx: number;
  solventN: number;
  matrixSlope: number;
  matrixSlopeSe: number;
  matrixIntercept: number;
  matrixSyx: number;
  matrixN: number;
  /** Fator de efeito matriz (%ME) = 100·(b_matriz/b_solvente − 1). */
  matrixEffectPct: number;
  t: number;
  df: number;
  pValue: number;
  alpha: number;
  significant: boolean;
  interpretation: string;
  reference: string;
}

/**
 * Compara as inclinações (slopes) entre curva em solvente puro e curva em
 * extrato/matriz fortificada via teste t de Welch–Satterthwaite e %ME.
 *
 * Referência: EURACHEM — The Fitness for Purpose of Analytical Methods (3ª ed., 2025).
 */
export function computeMatrixEffectCurves(
  solventPoints: RegressionPoint[],
  matrixPoints: RegressionPoint[],
  alpha = 0.05,
): MatrixEffectCurveComparison | null {
  const sValid = solventPoints.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const mValid = matrixPoints.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (
    sValid.length < 3 ||
    mValid.length < 3 ||
    new Set(sValid.map((p) => p.x)).size < 2 ||
    new Set(mValid.map((p) => p.x)).size < 2
  ) {
    return null;
  }

  const solv = linearRegression(sValid, 1 - alpha, alpha);
  const mat = linearRegression(mValid, 1 - alpha, alpha);
  if (
    !Number.isFinite(solv.slope) ||
    !Number.isFinite(mat.slope) ||
    solv.slope === 0 ||
    !Number.isFinite(solv.slopeSe) ||
    !Number.isFinite(mat.slopeSe)
  ) {
    return null;
  }

  const matrixEffectPct = 100 * (mat.slope / solv.slope - 1);
  const vSolv = solv.slopeSe * solv.slopeSe;
  const vMat = mat.slopeSe * mat.slopeSe;
  const seDiff = Math.sqrt(vSolv + vMat);
  let t = 0;
  let df = Math.max(1, solv.df + mat.df);
  let pValue = 1;

  if (seDiff > 0) {
    t = Math.abs(mat.slope - solv.slope) / seDiff;
    const denom =
      (vSolv > 0 && solv.df > 0 ? (vSolv * vSolv) / solv.df : 0) +
      (vMat > 0 && mat.df > 0 ? (vMat * vMat) / mat.df : 0);
    if (denom > 0) {
      df = ((vSolv + vMat) * (vSolv + vMat)) / denom;
    }
    pValue = Math.min(1, Math.max(0, 2 * (1 - tCdf(Math.abs(t), df))));
  } else if (mat.slope !== solv.slope) {
    t = Infinity;
    pValue = 0;
  }

  const significant = pValue < alpha;
  const interpretation = significant
    ? `Efeito matriz estatisticamente significativo (%ME = ${matrixEffectPct >= 0 ? '+' : ''}${matrixEffectPct.toFixed(2)}%; t = ${Number.isFinite(t) ? t.toFixed(3) : '∞'}, p = ${pValue.toFixed(4)} < ${alpha}): recomenda-se calibração em matriz (matrix-matched).`
    : `Sem diferença significativa entre as inclinações em matriz e solvente (%ME = ${matrixEffectPct >= 0 ? '+' : ''}${matrixEffectPct.toFixed(2)}%; p = ${pValue.toFixed(4)} ≥ ${alpha}).`;

  return {
    solventSlope: solv.slope,
    solventSlopeSe: solv.slopeSe,
    solventIntercept: solv.intercept,
    solventSyx: solv.syx,
    solventN: solv.n,
    matrixSlope: mat.slope,
    matrixSlopeSe: mat.slopeSe,
    matrixIntercept: mat.intercept,
    matrixSyx: mat.syx,
    matrixN: mat.n,
    matrixEffectPct,
    t,
    df,
    pValue,
    alpha,
    significant,
    interpretation,
    reference: 'EURACHEM — The Fitness for Purpose of Analytical Methods (3ª ed., 2025)',
  };
}

export const selectivityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const tagged = context.used.map((m) => ({
    m,
    text: normalizedTagText(m),
  }));

  const blanks = tagged.filter(
    ({ text, m }) =>
      BLANK_RE.test(text) && m.value !== null && Number.isFinite(m.value),
  );
  const interferents = tagged.filter(
    ({ text, m }) =>
      !BLANK_RE.test(text) &&
      INTERFERENT_RE.test(text) &&
      m.value !== null &&
      Number.isFinite(m.value),
  );
  const standards = tagged.filter(
    ({ text, m }) =>
      !INTERFERENT_RE.test(text) &&
      !BLANK_RE.test(text) &&
      STANDARD_RE.test(text) &&
      m.value !== null &&
      Number.isFinite(m.value),
  );
  const resolutions = tagged.filter(
    ({ text, m }) =>
      RESOLUTION_RE.test(text) &&
      m.value !== null &&
      Number.isFinite(m.value),
  );

  const hasSelectivityMarkers =
    blanks.length > 0 || interferents.length > 0 || resolutions.length > 0;

  if (!hasSelectivityMarkers) {
    return emptyParameter(
      parameter,
      context.used.length,
      'A seletividade exige experimento com branco/interferentes e critério de recuperação; registre os resultados no relatório ou use o teste de recuperação.',
      ['Ensaie branco, amostra fortificada e amostra com interferente nas mesmas condições.'],
    );
  }

  const interferentPairs = interferents
    .map(({ m }) => {
      const ref = finiteRef(m);
      return ref !== null && ref !== 0 && m.value !== null
        ? { measured: m.value, reference: ref }
        : null;
    })
    .filter((p): p is { measured: number; reference: number } => p !== null);

  const recovery =
    interferentPairs.length >= 2
      ? recoveryTest(
          interferentPairs.map((p) => p.measured),
          interferentPairs.map((p) => p.reference),
          context.options.alpha ?? 0.05,
          null,
        )
      : null;

  const minResolution = resolutions.length
    ? Math.min(...resolutions.map(({ m }) => m.value!))
    : null;

  if (!recovery && minResolution === null) {
    const blankNote =
      blanks.length > 0
        ? `Brancos analisados (n = ${blanks.length}): média = ${describe(blanks.map((b) => b.m.value)).mean?.toPrecision(4) ?? '—'}.`
        : null;
    return emptyParameter(
      parameter,
      blanks.length + interferents.length,
      'Informe ao menos 2 medições fortificadas / com interferente com valor de referência (ou valores de resolução crítica) para quantificar a seletividade.',
      blankNote
        ? [
            blankNote,
            'Ensaie branco, amostra fortificada e amostra com interferente nas mesmas condições.',
          ]
        : [
            'Ensaie branco, amostra fortificada e amostra com interferente nas mesmas condições.',
          ],
    );
  }

  const standardPairs = standards
    .map(({ m }) => {
      const ref = finiteRef(m);
      return ref !== null && ref !== 0 && m.value !== null
        ? { measured: m.value, reference: ref }
        : null;
    })
    .filter((p): p is { measured: number; reference: number } => p !== null);

  const interferentRecoveries = interferentPairs.map(
    (p) => (100 * p.measured) / p.reference,
  );
  const standardRecoveries = standardPairs.map(
    (p) => (100 * p.measured) / p.reference,
  );

  const matrixComparison =
    interferentRecoveries.length >= 2 && standardRecoveries.length >= 2
      ? anovaOneWay(
          [
            { name: 'Matriz / interferente', values: interferentRecoveries },
            { name: 'Padrão / controle', values: standardRecoveries },
          ],
          context.options.alpha ?? 0.05,
        )
      : null;

  const matrixEffectCurve = computeMatrixEffectCurves(
    standardPairs.map((p) => ({ x: p.reference, y: p.measured })),
    interferentPairs.map((p) => ({ x: p.reference, y: p.measured })),
    context.options.alpha ?? 0.05,
  );

  const interferenceRecovery = recovery ? recovery.meanRecovery : null;
  const rawMetrics = {
    interferenceRecovery,
    resolution: minResolution,
  };
  const verdict = evaluateParameter(parameter.key, rawMetrics, criteria).verdict;
  const metrics = [
    buildMetric(
      parameter,
      'interferenceRecovery',
      interferenceRecovery,
      criteria,
      'R% = 100·medido/referência (matriz/interferente)',
      parameter.reference,
    ),
    buildMetric(
      parameter,
      'resolution',
      minResolution,
      criteria,
      'mínimo(R_s) observado entre picos críticos',
      parameter.reference,
    ),
  ];

  const tables: AnalysisTable[] = [];
  if (recovery) {
    const rows: Array<Array<string | number>> = [
      [
        'Matriz / interferente fortificado',
        recovery.n,
        recovery.meanRecovery,
        recovery.sdRecovery,
        `${recovery.ciLow.toFixed(2)} a ${recovery.ciHigh.toFixed(2)}`,
      ],
    ];
    if (standardRecoveries.length >= 2) {
      const stdDesc = describe(standardRecoveries);
      rows.push([
        'Padrão / controle sem matriz',
        stdDesc.n,
        stdDesc.mean ?? '—',
        stdDesc.sd ?? '—',
        stdDesc.ciLow !== null && stdDesc.ciHigh !== null
          ? `${stdDesc.ciLow.toFixed(2)} a ${stdDesc.ciHigh.toFixed(2)}`
          : '—',
      ]);
    }
    tables.push({
      title: 'Seletividade — recuperação na presença de interferentes/matriz',
      columns: ['Grupo', 'n', 'Recuperação média (%)', 's (%)', 'IC 95%'],
      rows,
    });
  }
  if (matrixEffectCurve) {
    tables.push({
      title: 'Efeito Matriz — Comparação de Inclinações Solvente vs. Matriz (Eurachem 2025)',
      columns: ['Curva', 'n', 'Inclinação (b)', 'EP(b)', '%ME', 't / gl', 'p-valor'],
      rows: [
        [
          'Padrão / Solvente limpo',
          matrixEffectCurve.solventN,
          Number(matrixEffectCurve.solventSlope.toPrecision(5)),
          Number(matrixEffectCurve.solventSlopeSe.toPrecision(4)),
          '—',
          '—',
          '—',
        ],
        [
          'Extrato / Matriz fortificada',
          matrixEffectCurve.matrixN,
          Number(matrixEffectCurve.matrixSlope.toPrecision(5)),
          Number(matrixEffectCurve.matrixSlopeSe.toPrecision(4)),
          `${matrixEffectCurve.matrixEffectPct >= 0 ? '+' : ''}${matrixEffectCurve.matrixEffectPct.toFixed(2)}%`,
          Number.isFinite(matrixEffectCurve.t)
            ? `${matrixEffectCurve.t.toFixed(3)} / ${matrixEffectCurve.df.toFixed(1)}`
            : '∞',
          Number(matrixEffectCurve.pValue.toFixed(4)),
        ],
      ],
      note: matrixEffectCurve.interpretation,
    });
  }
  if (blanks.length > 0) {
    const bDesc = describe(blanks.map((b) => b.m.value));
    tables.push({
      title: 'Brancos analíticos',
      columns: ['n', 'Média', 's', 'Máximo'],
      rows: [[bDesc.n, bDesc.mean ?? '—', bDesc.sd ?? '—', bDesc.max ?? '—']],
    });
  }

  const notes: string[] = [];
  if (blanks.length > 0) {
    const bDesc = describe(blanks.map((b) => b.m.value));
    notes.push(
      `Brancos (n = ${bDesc.n}): média = ${bDesc.mean?.toPrecision(4) ?? '—'}, máximo = ${bDesc.max?.toPrecision(4) ?? '—'}.`,
    );
  }
  if (matrixComparison?.rows[0]?.p !== null && matrixComparison?.rows[0]?.p !== undefined) {
    notes.push(
      `Comparação recuperação matriz/interferente vs. padrão (ANOVA 1 fator): F = ${matrixComparison.rows[0].f?.toFixed(3) ?? '—'}, p = ${matrixComparison.rows[0].p.toFixed(4)}.`,
    );
  }
  if (matrixEffectCurve) {
    notes.push(matrixEffectCurve.interpretation);
  }

  const parts: string[] = [];
  if (interferenceRecovery !== null) {
    parts.push(`Recuperação c/ interferente = ${interferenceRecovery.toFixed(2)}%`);
  }
  if (minResolution !== null) {
    parts.push(`Resolução mínima = ${minResolution.toFixed(2)}`);
  }

  return {
    key: parameter.key,
    label: parameter.label,
    n: blanks.length + interferents.length + standards.length + resolutions.length,
    verdict,
    summary: parameterSummary(parameter.label, verdict, `${parts.join('; ')}.`),
    metrics,
    rawMetrics,
    tables,
    charts: [],
    warnings: recovery ? recovery.warnings : [],
    notes,
    reference: matrixEffectCurve
      ? `${parameter.reference}; ${matrixEffectCurve.reference}`
      : parameter.reference,
    results: {
      recovery,
      minResolution,
      blankStats: blanks.length > 0 ? describe(blanks.map((b) => b.m.value)) : null,
      matrixComparison,
      matrixEffectCurve,
    },
  };
};
