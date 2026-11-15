/**
 * Adaptadores dos perfis físicos.
 *
 * Ensaio não destrutivo: a mesma peça pode ser medida por todos os operadores,
 * então o Gage R&R cruzado do perfil dimensional é reutilizado com os rótulos e
 * as referências da família física.
 *
 * Ensaio destrutivo: cada réplica consome um corpo de prova distinto. O estudo
 * é aninhado (operador > amostra > corpo de prova) e usa `gageRRNested`. Antes
 * de calcular, o adaptador valida a matriz: corpo de prova obrigatório e único,
 * amostra/operador obrigatórios, células completas e balanceadas. Os erros são
 * devolvidos como parâmetro não avaliado, com texto acionável para a coleta.
 *
 * Referências:
 *  - Montgomery (2020), cap. 14; ISO 5725-2:2019 — modelo aninhado.
 *  - AIAG MSA (2010), 4. ed.; ISO 22514-7:2021 — sistemas de medição.
 *  - JCGM 100:2008 (GUM); JCGM 106:2012; ILAC-G8:09/2019 — incerteza e decisão.
 */

import type {
  AcceptanceCriterion,
  Measurement,
  UncertaintyItem,
} from '../../lib/types';
import type {
  AnalysisContext,
  AnalysisModule,
  AnalysisOptions,
  AnalysisTable,
  ParameterAnalysis,
} from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import { evaluateParameter } from '../../lib/criteria';
import { fmt } from '../distributions';
import { gageRRNested, type GageRRNestedResult } from '../nested';
import { computeEmp } from '../emp';
import { linearRegression, type RegressionResult } from '../regression';
import {
  evaluateNonNormalityAndOptions,
  type NonNormalityOptionsResult,
} from '../normality';
import type { GageBiasLinearityResult } from '../gageBiasLinearity';
import {
  dimensionalBiasAnalysis,
  dimensionalConformityAnalysis,
  dimensionalLinearityAnalysis,
  dimensionalRepeatabilityAnalysis,
  dimensionalReproducibilityAnalysis,
  dimensionalResolutionAnalysis,
  dimensionalStabilityAnalysis,
  dimensionalUncertaintyAnalysis,
} from './dimensional';

const GAGE_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; Montgomery (2020), cap. 13';
const NESTED_REFERENCE =
  'Montgomery (2020), cap. 14; ISO 5725-2:2019; AIAG MSA (2010), 4. ed.';
const BIAS_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; ISO 14253-1:2017';
const STABILITY_REFERENCE = 'AIAG MSA (2010); ISO 7870-2; Montgomery (2020)';
const TOLERANCE_REFERENCE =
  'JCGM 100:2008 (GUM); ISO/IEC 17025:2017, 7.6';
const CONFORMITY_REFERENCE =
  'JCGM 106:2012; ILAC-G8:09/2019; ISO/IEC 17025:2017, 7.8.2.1';

type NumericMeasurement = Measurement & { value: number };

function isNumeric(measurement: Measurement): measurement is NumericMeasurement {
  return measurement.value !== null && Number.isFinite(measurement.value);
}

function unitOf(options: AnalysisOptions): string {
  return options.unit ?? '';
}

function toleranceOf(options: AnalysisOptions): number | null {
  const lsl = options.lsl ?? null;
  const usl = options.usl ?? null;
  if (lsl === null || usl === null || !(usl > lsl)) return null;
  return usl - lsl;
}

function criterionLimit(
  criteria: AcceptanceCriterion[],
  metric: string,
  fallback: number,
): number {
  const criterion = criteria.find((item) => item.metric === metric);
  return criterion && Number.isFinite(criterion.limit) ? criterion.limit : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function operatorOf(measurement: Measurement): string {
  return measurement.analyst.trim() || measurement.equipment.trim() || 'Operador';
}

function sampleOf(measurement: Measurement): string {
  return measurement.sample.trim();
}

function specimenOf(measurement: Measurement): string {
  return (measurement.specimen ?? '').trim();
}

function localeSort(values: string[]): string[] {
  return [...values].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { numeric: true }),
  );
}

/**
 * Reaproveita um módulo dimensional trocando apenas a referência e acrescentando
 * uma nota de contexto físico. O cálculo permanece no módulo original.
 */
function withReference(
  module: AnalysisModule,
  reference: string,
  note: string,
): AnalysisModule {
  return (input) => {
    const result = module(input);
    return {
      ...result,
      reference,
      notes: [...result.notes, note],
    };
  };
}

function nonNormalityBlock(
  values: number[],
  unit: string,
  alpha = 0.05,
): {
  result: NonNormalityOptionsResult | null;
  tables: AnalysisTable[];
  warnings: string[];
  notes: string[];
} {
  if (values.length < 8) {
    return { result: null, tables: [], warnings: [], notes: [] };
  }
  const diag = evaluateNonNormalityAndOptions(values, { alpha });
  if (!diag.bothRejected) {
    return { result: diag, tables: [], warnings: [], notes: [] };
  }
  const tolText = diag.nonParametricTolerance
    ? `[${fmt(diag.nonParametricTolerance.lower)}; ${fmt(diag.nonParametricTolerance.upper)}] ${unit}`.trim()
    : '—';
  const rows: Array<Array<string | number>> = [
    [
      'Shapiro–Wilk (original)',
      `W = ${fmt(diag.shapiro.statistic)}`,
      fmt(diag.shapiro.pValue),
      'Normalidade rejeitada',
    ],
    [
      'Anderson–Darling (original)',
      `A* = ${fmt(diag.anderson.statistic)}`,
      fmt(diag.anderson.pValue),
      'Normalidade rejeitada',
    ],
    [
      'Opção A: Transformação ln(x)',
      diag.logTransform.shapiroOnLog
        ? `W = ${fmt(diag.logTransform.shapiroOnLog.statistic)} · x̄_g = ${fmt(diag.logTransform.geometricMean)} ${unit}`.trim()
        : 'Indisponível (valores ≤ 0)',
      diag.logTransform.shapiroOnLog ? fmt(diag.logTransform.shapiroOnLog.pValue) : '—',
      diag.logTransform.note,
    ],
    [
      'Opção B: Intervalo de tolerância não paramétrico (Wilks)',
      tolText,
      diag.nonParametricTolerance
        ? `${(diag.nonParametricTolerance.achievedConfidence * 100).toFixed(1)}% conf.`
        : '—',
      diag.nonParametricTolerance
        ? `Cobertura ${(diag.nonParametricTolerance.targetCoverage * 100).toFixed(0)}%; n recomendado ≥ ${diag.nonParametricTolerance.recommendedMinN}`
        : '—',
    ],
  ];
  return {
    result: diag,
    tables: [
      {
        title: 'Diagnóstico de Não Normalidade e Alternativas (Transformação Log / Intervalo Não Paramétrico)',
        columns: ['Alternativa / Teste', 'Resultado', 'p / Confiança', 'Orientação'],
        rows,
        note: diag.reference,
      },
    ],
    warnings: diag.warnings,
    notes: [diag.logTransform.note],
  };
}

export interface EnvironmentalCovariateResult {
  covariate: 'temperature' | 'humidity';
  label: string;
  n: number;
  regression: RegressionResult;
  significant: boolean;
}

export interface EnvironmentalAnalysisOutcome {
  covariates: EnvironmentalCovariateResult[];
  tables: AnalysisTable[];
  warnings: string[];
  notes: string[];
}

/**
 * Regressão da medida sobre condições ambientais registradas em `condition`
 * (`temperature` e `humidity`), para verificar deriva/efeito ambiental em ensaios
 * físicos (ex.: temperatura e umidade ambiente conforme `condition_json`).
 *
 * Referências: Montgomery, Peck & Vining (2021); ISO/IEC 17025:2017, 6.3.
 */
export function analyzeEnvironmentalConditions(
  measurements: Measurement[],
  unit = '',
): EnvironmentalAnalysisOutcome {
  const numeric = measurements.filter(isNumeric);
  const candidates: Array<{
    covariate: 'temperature' | 'humidity';
    label: string;
    covUnit: string;
    extract: (m: NumericMeasurement) => number | null;
  }> = [
    {
      covariate: 'temperature',
      label: 'Temperatura',
      covUnit: '°C',
      extract: (m) => m.condition?.temperature ?? null,
    },
    {
      covariate: 'humidity',
      label: 'Umidade relativa',
      covUnit: '% UR',
      extract: (m) => m.condition?.humidity ?? null,
    },
  ];

  const covariates: EnvironmentalCovariateResult[] = [];
  const rows: Array<Array<string | number>> = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  for (const candidate of candidates) {
    const points: Array<{ x: number; y: number }> = [];
    for (const m of numeric) {
      const cov = candidate.extract(m);
      if (cov !== null && Number.isFinite(cov)) {
        points.push({ x: cov, y: m.value });
      }
    }
    const distinctX = new Set(points.map((p) => p.x)).size;
    if (points.length >= 3 && distinctX >= 2) {
      const reg = linearRegression(points);
      const significant = Number.isFinite(reg.slopeP) && reg.slopeP < 0.05;
      covariates.push({
        covariate: candidate.covariate,
        label: candidate.label,
        n: reg.n,
        regression: reg,
        significant,
      });
      rows.push([
        `${candidate.label} (${candidate.covUnit})`,
        reg.n,
        `${fmt(reg.slope)} ${unit ? `${unit}/` : ''}${candidate.covUnit}`,
        fmt(reg.slopeSe),
        fmt(reg.slopeT),
        fmt(reg.slopeP),
        fmt(reg.r2),
        significant
          ? 'Efeito significativo (p < 0,05): controlar/compensar condição'
          : 'Sem evidência de deriva significativa (p ≥ 0,05)',
      ]);
      if (significant) {
        warnings.push(
          `Efeito ambiental significativo de ${candidate.label.toLowerCase()} (inclinação = ${fmt(reg.slope)}, p = ${fmt(reg.slopeP)} < 0,05).`,
        );
      } else {
        notes.push(
          `Covariável ${candidate.label.toLowerCase()} avaliada (n = ${reg.n}; R² = ${fmt(reg.r2)}; p = ${fmt(reg.slopeP)}).`,
        );
      }
    }
  }

  const tables: AnalysisTable[] = rows.length
    ? [
        {
          title: 'Efeito de Condições Ambientais (Covariável — Temperatura / Umidade)',
          columns: [
            'Covariável',
            'n',
            'Inclinação (b)',
            'EP(b)',
            't',
            'p-valor',
            'R²',
            'Interpretação',
          ],
          rows,
          note: 'Regressão linear simples y = a + b·covariável sobre registros com condição ambiental informada; critério informativo p < 0,05.',
        },
      ]
    : [];

  return { covariates, tables, warnings, notes };
}

// ── Estudo aninhado destrutivo ─────────────────────────────────────────────

interface SpecimenObservation {
  operator: string;
  sample: string;
  specimen: string;
  replicate: number;
  value: number;
}

interface NestedStudy {
  result: GageRRNestedResult;
  operators: string[];
  samples: string[][];
  specimens: SpecimenObservation[];
  measurements: number;
  /** Medições numéricas sem corpo de prova, fora do estudo destrutivo. */
  ignored: number;
}

function specimenTable(study: NestedStudy): AnalysisTable {
  return {
    title: 'Mapa de corpos de prova',
    columns: ['Operador', 'Amostra', 'Réplica', 'Corpo de prova', 'Valor'],
    rows: study.specimens.map((item) => [
      item.operator,
      item.sample,
      item.replicate,
      item.specimen,
      item.value,
    ]),
    note:
      'Cada corpo de prova é consumido uma única vez. A réplica é a posição do corpo de prova dentro da amostra/operador; o identificador permite rastrear a retirada no lote.',
  };
}

function duplicateSpecimenError(duplicates: Array<[string, Measurement[]]>): string {
  const visible = duplicates
    .slice(0, 5)
    .map(([specimen, rows]) => `${specimen} (${rows.length} medições)`)
    .join(', ');
  const extra = duplicates.length > 5 ? ` … e mais ${duplicates.length - 5}.` : '.';
  return `Corpo de prova duplicado: ${visible}${extra} Em ensaio destrutivo cada corpo de prova é consumido uma única vez; corrija a identificação na coleta.`;
}

function unbalancedError(
  cells: Array<{ label: string; count: number }>,
  expected: number,
): string {
  const visible = cells
    .slice(0, 6)
    .map((cell) => `${cell.label} tem ${cell.count}`)
    .join('; ');
  const extra = cells.length > 6 ? ` … e mais ${cells.length - 6} célula(s).` : '.';
  return `Delineamento aninhado desbalanceado: esperado ${expected} corpo(s) de prova por operador × amostra; ${visible}${extra} O Gage R&R aninhado exige células completas.`;
}

/**
 * Constrói a matriz y[operador][amostra][corpo de prova] a partir das medições.
 *
 * Somente linhas com corpo de prova ou marcadas como destrutivas entram no
 * estudo. Linhas numéricas sem corpo de prova são registradas em `ignored` e
 * podem ser usadas em tendência/linearidade com padrões de referência.
 */
function nestedStudy(
  context: AnalysisContext,
  criteria: AcceptanceCriterion[],
): NestedStudy | { error: string } {
  const numeric = context.used.filter(isNumeric);
  if (!numeric.length) {
    return {
      error:
        'Não há medições numéricas. Registre os resultados do ensaio destrutivo na etapa Coleta.',
    };
  }
  const destructiveRows = numeric.filter(
    (measurement) =>
      measurement.destructive === true || specimenOf(measurement) !== '',
  );
  if (!destructiveRows.length) {
    return {
      error:
        'Nenhuma medição com corpo de prova. No ensaio destrutivo, informe a coluna “Corpo de prova” para cada réplica consumida.',
    };
  }
  const missingSpecimen = destructiveRows.filter(
    (measurement) => specimenOf(measurement) === '',
  );
  if (missingSpecimen.length) {
    return {
      error: `${missingSpecimen.length} medição(ões) marcada(s) como destrutiva(s) não têm corpo de prova. Informe um identificador único por corpo de prova consumido.`,
    };
  }
  const missingSample = destructiveRows.filter(
    (measurement) => sampleOf(measurement) === '',
  );
  if (missingSample.length) {
    return {
      error: `${missingSample.length} medição(ões) destrutiva(s) não têm amostra. A amostra identifica o lote/grupo de onde os corpos de prova foram retirados.`,
    };
  }
  const missingOperator = destructiveRows.filter(
    (measurement) =>
      measurement.analyst.trim() === '' && measurement.equipment.trim() === '',
  );
  if (missingOperator.length) {
    return {
      error: `${missingOperator.length} medição(ões) destrutiva(s) não têm operador. Use a coluna “Analista/operador” para identificar quem executou o ensaio.`,
    };
  }

  const bySpecimen = new Map<string, Measurement[]>();
  for (const measurement of destructiveRows) {
    const specimen = specimenOf(measurement);
    const list = bySpecimen.get(specimen) ?? [];
    list.push(measurement);
    bySpecimen.set(specimen, list);
  }
  const duplicates = [...bySpecimen.entries()].filter(
    ([, rows]) => rows.length > 1,
  );
  if (duplicates.length) return { error: duplicateSpecimenError(duplicates) };

  const operators = localeSort([
    ...new Set(destructiveRows.map(operatorOf)),
  ]);
  if (operators.length < 2) {
    return {
      error:
        'O Gage R&R aninhado requer pelo menos 2 operadores. Use a coluna “Analista/operador” para diferenciá-los.',
    };
  }

  const samplesByOperator = new Map<string, string[]>();
  for (const operator of operators) {
    samplesByOperator.set(
      operator,
      localeSort([
        ...new Set(
          destructiveRows
            .filter((measurement) => operatorOf(measurement) === operator)
            .map(sampleOf),
        ),
      ]),
    );
  }
  const sampleCounts = operators.map(
    (operator) => samplesByOperator.get(operator)!.length,
  );
  if (new Set(sampleCounts).size > 1) {
    const detail = operators
      .map((operator, index) => `${operator}: ${sampleCounts[index]}`)
      .join('; ');
    return {
      error: `Delineamento aninhado desbalanceado: os operadores têm números diferentes de amostras (${detail}). Cada operador deve avaliar o mesmo número de amostras.`,
    };
  }
  const samplesPerOperator = sampleCounts[0] ?? 0;
  if (samplesPerOperator < 1) {
    return {
      error:
        'O delineamento aninhado requer pelo menos 1 amostra por operador.',
    };
  }

  const cells = new Map<string, NumericMeasurement[]>();
  for (const measurement of destructiveRows) {
    const key = `${operatorOf(measurement)}\u0000${sampleOf(measurement)}`;
    const list = cells.get(key) ?? [];
    list.push(measurement);
    cells.set(key, list);
  }
  const missingCells: string[] = [];
  for (const operator of operators) {
    for (const sample of samplesByOperator.get(operator)!) {
      if (!cells.has(`${operator}\u0000${sample}`)) {
        missingCells.push(`${operator} × ${sample}`);
      }
    }
  }
  if (missingCells.length) {
    return {
      error: `Célula(s) sem medição: ${missingCells.slice(0, 6).join(', ')}${missingCells.length > 6 ? ` … e mais ${missingCells.length - 6}` : ''}. O delineamento aninhado exige pelo menos um corpo de prova em cada operador × amostra.`,
    };
  }

  const cellCounts = [...cells.entries()].map(([key, rows]) => ({
    label: key.replace('\u0000', ' × '),
    count: rows.length,
  }));
  const replicates = cellCounts[0]?.count ?? 0;
  if (replicates < 2) {
    return {
      error:
        'O Gage R&R aninhado requer pelo menos 2 corpos de prova por amostra; com 1 corpo de prova não é possível estimar a repetibilidade.',
    };
  }
  const unbalanced = cellCounts.filter((cell) => cell.count !== replicates);
  if (unbalanced.length) return { error: unbalancedError(unbalanced, replicates) };

  const y: number[][][] = operators.map((operator) =>
    samplesByOperator.get(operator)!.map((sample) => {
      const rows = [...cells.get(`${operator}\u0000${sample}`)!];
      rows.sort((a, b) =>
        specimenOf(a).localeCompare(specimenOf(b), 'pt-BR', { numeric: true }),
      );
      return rows.map((measurement) => measurement.value);
    }),
  );
  const sampleLabels = operators.map((operator) => samplesByOperator.get(operator)!);
  const specimens: SpecimenObservation[] = [];
  operators.forEach((operator, operatorIndex) => {
    sampleLabels[operatorIndex].forEach((sample, sampleIndex) => {
      const rows = [...cells.get(`${operator}\u0000${sample}`)!];
      rows.sort((a, b) =>
        specimenOf(a).localeCompare(specimenOf(b), 'pt-BR', { numeric: true }),
      );
      rows.forEach((measurement, replicateIndex) => {
        specimens.push({
          operator,
          sample,
          specimen: specimenOf(measurement),
          replicate: replicateIndex + 1,
          value: measurement.value,
        });
      });
    });
  });

  const nativeCriteria = {
    grrAccept: criterionLimit(criteria, 'grr_pct', 10),
    grrWarning: Math.max(criterionLimit(criteria, 'grr_pct', 10), 30),
    ptAccept: criterionLimit(criteria, 'pt_pct', 10),
    ptWarning: Math.max(criterionLimit(criteria, 'pt_pct', 10), 30),
    ndcMin: criterionLimit(criteria, 'ndc', 5),
  };

  try {
    const result = gageRRNested(
      {
        y,
        tolerance: toleranceOf(context.options),
        operatorLabels: operators,
        sampleLabels,
      },
      {
        confidence: context.options.confidence ?? 0.95,
        alpha: context.options.alpha ?? 0.05,
        criteria: nativeCriteria,
        unit: unitOf(context.options),
      },
    );
    return {
      result,
      operators,
      samples: sampleLabels,
      specimens,
      measurements: destructiveRows.length,
      ignored: numeric.length - destructiveRows.length,
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function nestedNotes(study: NestedStudy): string[] {
  const notes = [
    'Modelo aninhado destrutivo: Operador > Amostra(Operador) > Corpo de prova.',
    'A repetibilidade inclui a variação entre corpos de prova do mesmo lote; a componente entre amostras é reportada separadamente.',
  ];
  if (study.ignored > 0) {
    notes.push(
      `${study.ignored} medição(ões) numérica(s) sem corpo de prova não entraram no estudo aninhado; elas permanecem disponíveis para tendência/linearidade com padrões de referência.`,
    );
  }
  return notes;
}

function nestedRawMetrics(result: GageRRNestedResult) {
  const repeatability =
    result.components.find((component) => component.key === 'repeatability') ??
    null;
  const operator =
    result.components.find((component) => component.key === 'operator') ?? null;
  const sample =
    result.components.find((component) => component.key === 'sample') ?? null;
  return { repeatability, operator, sample };
}

function nestedRepeatabilityAnalysis(
  parameter: Parameters<AnalysisModule>[0]['parameter'],
  criteria: AcceptanceCriterion[],
  context: AnalysisContext,
  study: NestedStudy,
): ParameterAnalysis {
  const { repeatability, operator, sample } = nestedRawMetrics(study.result);
  const raw = {
    ev_pct: repeatability?.studyVariationPct ?? null,
    sigma_rep: repeatability?.standardDeviation ?? null,
    grr_pct: study.result.rawMetrics.grr_pct ?? null,
    ndc: study.result.rawMetrics.ndc ?? null,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  const emp =
    repeatability &&
    sample &&
    sample.estimable &&
    (sample.standardDeviation > 0 ||
      repeatability.standardDeviation > 0 ||
      (operator?.standardDeviation ?? 0) > 0)
      ? computeEmp({
          sigmaPart: sample.standardDeviation,
          sigmaRepeatability: repeatability.standardDeviation,
          sigmaReproducibility: operator?.standardDeviation ?? 0,
          resolution: context.options.resolution ?? null,
        })
      : null;
  const empTable: AnalysisTable[] = emp
    ? [
        {
          title: 'EMP — Wheeler (Evaluating the Measurement Process)',
          columns: ['Métrica EMP', 'Valor', 'Classificação / Interpretação'],
          rows: [
            ['ICC (Coef. Correlação Intraclasse)', fmt(emp.icc), emp.monitorClass],
            ['Atenuação do sinal (%)', `${fmt(emp.signalAttenuationPct)}%`, emp.monitorDescription],
            ['Erro provável (PE = 0,6745·σ_rep)', fmt(emp.probableError), unitOf(context.options)],
            [
              'Resolução efetiva recomendada',
              `${fmt(emp.effectiveResolutionMin)} a ${fmt(emp.effectiveResolutionMax)}`,
              `Status: ${emp.resolutionStatus}`,
            ],
          ],
          note: emp.reference,
        },
      ]
    : [];
  const empNotes = emp
    ? [`EMP (Wheeler): ${emp.monitorClass} (ICC = ${fmt(emp.icc)}; atenuação de sinal = ${fmt(emp.signalAttenuationPct)}%).`]
    : [];
  const nonNormality = nonNormalityBlock(
    study.specimens.map((s) => s.value),
    unitOf(context.options),
    context.options.alpha ?? 0.05,
  );
  return {
    key: parameter.key,
    label: parameter.label,
    n: study.result.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `%EV = ${raw.ev_pct === null ? '—' : fmt(raw.ev_pct)}%; σ_rep = ${raw.sigma_rep === null ? '—' : fmt(raw.sigma_rep)} ${unitOf(context.options)}; %GRR = ${raw.grr_pct === null ? '—' : fmt(raw.grr_pct)}%; ndc = ${raw.ndc === null ? '—' : fmt(raw.ndc)}. ${study.result.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'ev_pct',
        raw.ev_pct,
        criteria,
        '%EV = 100·σ_rep/σ_total',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'sigma_rep',
        raw.sigma_rep,
        criteria,
        'σ_rep = √MS_E (variação entre corpos de prova da mesma amostra × operador)',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'grr_pct',
        raw.grr_pct,
        criteria,
        '%GRR = 100·σ_GRR/σ_total',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'ndc',
        raw.ndc,
        criteria,
        'ndc = floor(1,41·σ_amostra/σ_GRR)',
        NESTED_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    tables: [
      ...study.result.tables,
      ...empTable,
      ...nonNormality.tables,
      specimenTable(study),
    ],
    charts: study.result.charts,
    warnings: [...study.result.warnings, ...nonNormality.warnings],
    notes: [
      ...study.result.notes,
      ...nestedNotes(study),
      ...empNotes,
      ...nonNormality.notes,
    ],
    reference: NESTED_REFERENCE,
    results: {
      gageRRNested: study.result,
      emp,
      nonNormality: nonNormality.result,
      study: 'nested_destructive',
      operators: study.operators,
      samples: study.samples,
      specimens: study.specimens,
    },
  };
}

function nestedReproducibilityAnalysis(
  parameter: Parameters<AnalysisModule>[0]['parameter'],
  criteria: AcceptanceCriterion[],
  context: AnalysisContext,
  study: NestedStudy,
): ParameterAnalysis {
  const { operator } = nestedRawMetrics(study.result);
  const raw = {
    oper_pct: operator?.studyVariationPct ?? null,
    sigma_oper: operator?.standardDeviation ?? null,
    grr_pct: study.result.rawMetrics.grr_pct ?? null,
    pt_pct: study.result.rawMetrics.pt_pct ?? null,
    ndc: study.result.rawMetrics.ndc ?? null,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: study.result.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `%AV = ${raw.oper_pct === null ? '—' : fmt(raw.oper_pct)}%; σ_oper = ${raw.sigma_oper === null ? '—' : fmt(raw.sigma_oper)} ${unitOf(context.options)}; %GRR = ${raw.grr_pct === null ? '—' : fmt(raw.grr_pct)}%; %P/T = ${raw.pt_pct === null ? '—' : fmt(raw.pt_pct)}%; ndc = ${raw.ndc === null ? '—' : fmt(raw.ndc)}. ${study.result.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'oper_pct',
        raw.oper_pct,
        criteria,
        '%AV = 100·σ_oper/σ_total',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'sigma_oper',
        raw.sigma_oper,
        criteria,
        'σ_oper = √[(MS_operador − MS_amostra(operador))/(amostras × corpos de prova)]',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'grr_pct',
        raw.grr_pct,
        criteria,
        '%GRR = 100·σ_GRR/σ_total',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'pt_pct',
        raw.pt_pct,
        criteria,
        '%P/T = 100·k·σ_GRR/T',
        NESTED_REFERENCE,
      ),
      buildMetric(
        parameter,
        'ndc',
        raw.ndc,
        criteria,
        'ndc = floor(1,41·σ_amostra/σ_GRR)',
        NESTED_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    tables: [...study.result.tables, specimenTable(study)],
    charts: study.result.charts,
    warnings: study.result.warnings,
    notes: [...study.result.notes, ...nestedNotes(study)],
    reference: NESTED_REFERENCE,
    results: {
      gageRRNested: study.result,
      study: 'nested_destructive',
      operators: study.operators,
      samples: study.samples,
      specimens: study.specimens,
    },
  };
}

export const physicalDestructiveRepeatabilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = nestedStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'No ensaio destrutivo, a repetibilidade é estimada entre corpos de prova distintos do mesmo lote; cada corpo de prova é medido uma única vez.',
    ]);
  }
  return nestedRepeatabilityAnalysis(parameter, criteria, context, study);
};

export const physicalDestructiveReproducibilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = nestedStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A reprodutibilidade compara operadores que consomem corpos de prova distintos, em um modelo aninhado.',
    ]);
  }
  return nestedReproducibilityAnalysis(parameter, criteria, context, study);
};

// ── Ensaio não destrutivo (Gage R&R cruzado) ───────────────────────────────

export const physicalNonDestructiveRepeatabilityAnalysis: AnalysisModule = (input) => {
  const base = dimensionalRepeatabilityAnalysis(input);
  const env = analyzeEnvironmentalConditions(
    input.context.used,
    unitOf(input.context.options),
  );
  const values = input.context.used.filter(isNumeric).map((m) => m.value);
  const nonNorm = nonNormalityBlock(
    values,
    unitOf(input.context.options),
    input.context.options.alpha ?? 0.05,
  );
  return {
    ...base,
    reference: GAGE_REFERENCE,
    tables: [...base.tables, ...env.tables, ...nonNorm.tables],
    warnings: [...base.warnings, ...env.warnings, ...nonNorm.warnings],
    notes: [
      ...base.notes,
      'Perfil físico não destrutivo: a mesma peça é medida várias vezes pelos operadores, sem consumo do corpo de prova; o modelo é o Gage R&R cruzado.',
      ...env.notes,
      ...nonNorm.notes,
    ],
    results: {
      ...base.results,
      environmentalConditions: env.covariates,
      nonNormality: nonNorm.result,
    },
  };
};

export const physicalNonDestructiveReproducibilityAnalysis = withReference(
  dimensionalReproducibilityAnalysis,
  GAGE_REFERENCE,
  'Perfil físico não destrutivo: a reprodutibilidade é a variação entre operadores que medem as mesmas peças; não há consumo de corpos de prova.',
);

// ── Módulos compartilhados pelos dois perfis físicos ───────────────────────

export const physicalBiasAnalysis: AnalysisModule = (input) => {
  const base = dimensionalBiasAnalysis(input);
  const study = base.results.biasLinearity as GageBiasLinearityResult | undefined;
  const extraTables: AnalysisTable[] = [];
  if (study && study.levels.length > 0) {
    extraTables.push({
      title: 'Verificação Metrológica do Equipamento por Ponto (Erro Relativo vs. Critério Editável)',
      columns: [
        'Ponto de referência',
        'n',
        'Média observada',
        'Tendência (Erro)',
        'Erro relativo (%)',
        'u_ref',
        'Nota normativa',
      ],
      rows: study.levels.map((lvl) => [
        `${fmt(lvl.reference)} ${unitOf(input.context.options)}`.trim(),
        lvl.n,
        fmt(lvl.mean),
        fmt(lvl.bias),
        lvl.biasPctRef !== null ? `${fmt(lvl.biasPctRef)}%` : '—',
        fmt(lvl.referenceUncertainty),
        'Comparar erro relativo ao critério de classe editável (ex.: ISO 7500-1 / OIML R76 / norma aplicável).',
      ]),
      note: 'Os limiares de classe do equipamento não são embutidos como norma fixa: ajuste o critério editável conforme a classe da célula de carga/balança/torquímetro.',
    });
  }
  return {
    ...base,
    reference: BIAS_REFERENCE,
    tables: [...base.tables, ...extraTables],
    notes: [
      ...base.notes,
      'Perfil físico: a tendência compara a média das medições com o valor aceito do padrão de referência; no ensaio destrutivo, use padrões ou lotes de referência medidos separadamente.',
    ],
  };
};

export const physicalLinearityAnalysis = withReference(
  dimensionalLinearityAnalysis,
  BIAS_REFERENCE,
  'Perfil físico: a linearidade verifica se a tendência se mantém ao longo de toda a faixa de uso do ensaio.',
);

export const physicalStabilityAnalysis: AnalysisModule = (input) => {
  const base = dimensionalStabilityAnalysis(input);
  const env = analyzeEnvironmentalConditions(
    input.context.used,
    unitOf(input.context.options),
  );
  return {
    ...base,
    reference: STABILITY_REFERENCE,
    tables: [...base.tables, ...env.tables],
    warnings: [...base.warnings, ...env.warnings],
    notes: [
      ...base.notes,
      'Perfil físico: a estabilidade acompanha o mesmo padrão ou material de referência ao longo do tempo.',
      ...env.notes,
    ],
    results: {
      ...base.results,
      environmentalConditions: env.covariates,
    },
  };
};

export const physicalResolutionAnalysis = withReference(
  dimensionalResolutionAnalysis,
  STABILITY_REFERENCE,
  'Perfil físico: a resolução deve ser pequena em relação à tolerância do ensaio.',
);

export const physicalUncertaintyAnalysis = withReference(
  dimensionalUncertaintyAnalysis,
  TOLERANCE_REFERENCE,
  'Perfil físico: o orçamento de incerteza reutiliza as fontes típicas de ensaios físicos (calibração/classe, alinhamento, velocidade, resolução, temperatura, repetibilidade, reprodutibilidade e heterogeneidade do lote); substitua os valores-modelo pelos certificados e dados do estudo.',
);

export const physicalConformityAnalysis = withReference(
  dimensionalConformityAnalysis,
  CONFORMITY_REFERENCE,
  'Perfil físico: a decisão de conformidade confronta o valor medido com LSL/USL e a incerteza, declarando a regra de decisão.',
);

// ── Orçamento-modelo físico ────────────────────────────────────────────────

export interface PhysicalBudgetInput {
  validationId: string;
  /** Resolução do indicador/máquina, na unidade do mensurando. */
  resolution: number;
  /** Incerteza expandida de calibração/classe da célula de carga, balança ou torquímetro (U_cal). */
  calibrationUncertainty: number;
  /** Fator de abrangência do certificado de calibração (padrão 2). */
  coverageFactor?: number;
  /** Desvio-padrão de repetibilidade s_r. */
  repeatabilitySd?: number | null;
  /** Número de corpos de prova/réplicas n para u = s/√n (padrão 1). */
  nReplicates?: number | null;
  /** Desvio-padrão entre operadores (reprodutibilidade σ_oper). */
  reproducibilitySd?: number | null;
  /** Heterogeneidade entre amostras do lote (σ_amostra em ensaio destrutivo). */
  lotHeterogeneitySd?: number | null;
  /** Semi-amplitude devida a alinhamento/fixação nas garras (retangular). */
  alignment?: number | null;
  /** Semi-amplitude devida à variação da velocidade de ensaio (retangular). */
  testSpeed?: number | null;
  /** Semi-amplitude devida a variação de temperatura/umidade (retangular). */
  temperatureEffect?: number | null;
}

function physicalBudgetItem(
  validationId: string,
  id: string,
  source: string,
  type: 'A' | 'B',
  distribution: UncertaintyItem['distribution'],
  value: number,
  divisor: number,
  dof: number | null,
  notes: string,
): UncertaintyItem {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  const safeDivisor = Number.isFinite(divisor) && divisor > 0 ? divisor : 1;
  return {
    id: `phys-${id}`,
    validationId,
    source,
    type,
    distribution,
    value: safeValue,
    divisor: safeDivisor,
    sensitivity: 1,
    stdUncertainty: safeValue / safeDivisor,
    dof,
    notes,
  };
}

/**
 * Orçamento-modelo editável para ensaios físicos (destrutivos e não destrutivos).
 * Os valores devem ser substituídos pelos dados reais de calibração/classe da máquina
 * ou balança, condições operacionais e resultados do estudo de precisão.
 *
 * Referências: JCGM 100:2008 (GUM); ISO 7500-1; Eurachem/CITAC (2012).
 */
export function physicalUncertaintyBudget(input: PhysicalBudgetInput): UncertaintyItem[] {
  const k = input.coverageFactor ?? 2;
  const nRep = Math.max(1, Math.round(input.nReplicates ?? 1));
  const items: UncertaintyItem[] = [
    physicalBudgetItem(
      input.validationId,
      'calibration',
      'Calibração / classe do equipamento (célula de carga / balança / transdutor)',
      'B',
      'normal',
      input.calibrationUncertainty,
      k,
      30,
      'u_cal = U_cal / k (confirmar certificado e classe conforme norma aplicável ao equipamento).',
    ),
    physicalBudgetItem(
      input.validationId,
      'resolution',
      'Resolução do indicador digital',
      'B',
      'rectangular',
      input.resolution / 2,
      Math.sqrt(3),
      null,
      'u_res = (resolução / 2) / √3.',
    ),
  ];

  if (input.repeatabilitySd !== null && input.repeatabilitySd !== undefined) {
    items.push(
      physicalBudgetItem(
        input.validationId,
        'repeatability',
        'Repetibilidade entre corpos de prova / réplicas (Tipo A)',
        'A',
        'normal',
        input.repeatabilitySd,
        Math.sqrt(nRep),
        Math.max(1, nRep - 1),
        'u_rep = s_r / √n (estimada no estudo de precisão).',
      ),
    );
  }

  if (input.reproducibilitySd !== null && input.reproducibilitySd !== undefined) {
    items.push(
      physicalBudgetItem(
        input.validationId,
        'reproducibility',
        'Reprodutibilidade entre operadores (Tipo A)',
        'A',
        'normal',
        input.reproducibilitySd,
        1,
        15,
        'u_oper = σ_operador do Gage R&R.',
      ),
    );
  }

  if (input.lotHeterogeneitySd !== null && input.lotHeterogeneitySd !== undefined) {
    items.push(
      physicalBudgetItem(
        input.validationId,
        'lot-heterogeneity',
        'Heterogeneidade entre amostras do lote',
        'A',
        'normal',
        input.lotHeterogeneitySd,
        1,
        15,
        'Componente σ_amostra separada no estudo aninhado (quando aplicável ao mensurando do lote).',
      ),
    );
  }

  const extras: Array<[number | null | undefined, string, string, string]> = [
    [
      input.alignment,
      'alignment',
      'Alinhamento / fixação nas garras ou apoios',
      'u_alin = a / √3 (retangular; ajustar conforme geometria e dispositivo de fixação).',
    ],
    [
      input.testSpeed,
      'test-speed',
      'Velocidade de ensaio / taxa de carregamento',
      'u_vel = a / √3 (retangular; sensibilidade ao ajuste de velocidade da máquina).',
    ],
    [
      input.temperatureEffect,
      'temperature',
      'Condições ambientais (temperatura / umidade)',
      'u_amb = a / √3 (retangular; deriva térmica/higrométrica no ambiente de ensaio).',
    ],
  ];

  for (const [val, id, source, note] of extras) {
    if (val !== null && val !== undefined) {
      items.push(
        physicalBudgetItem(
          input.validationId,
          id,
          source,
          'B',
          'rectangular',
          Math.abs(val),
          Math.sqrt(3),
          15,
          note,
        ),
      );
    }
  }

  return items;
}
