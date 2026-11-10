/**
 * Adaptadores do perfil dimensional.
 *
 * Reúnem os módulos já implementados (Gage R&R, tendência/linearidade,
 * estabilidade/resolução e conformidade) em parâmetros de perfil, aplicando
 * critérios editáveis sem alterar o motor estatístico original.
 *
 * Referências:
 *  - AIAG (2010). Measurement Systems Analysis Reference Manual, 4. ed.
 *  - ISO 22514-7:2021 — capability of measurement processes.
 *  - ISO 14253-1:2017 — decisão por medição.
 *  - JCGM 106:2012; ILAC-G8:09/2019 — regra de decisão e conformidade.
 *  - JCGM 100:2008 (GUM) — orçamento de incerteza.
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
  ParameterAnalysis,
} from '../analysis-types';
import { buildMetric, emptyParameter, parameterSummary } from '../analysis-utils';
import {
  DEFAULT_TOLERANCE_CRITERIA,
  evaluateParameter,
  toleranceMetrics,
} from '../../lib/criteria';
import { mean } from '../descriptive';
import { fmt } from '../distributions';
import {
  gageRRAnalysis,
  type GageRRCriteria,
  type GageRRResult,
} from '../gagerr';
import {
  gageBiasLinearityStudy,
  type GageBiasLevelInput,
  type GageBiasLinearityCriteria,
  type GageBiasLinearityResult,
} from '../gageBiasLinearity';
import {
  stabilityStudy,
  type StabilityCriteria,
  type StabilityResult,
} from '../stability';
import {
  conformityDecision,
  DEFAULT_CONFORMITY_CRITERIA,
  type ConformityCriteria,
  type ConformityResult,
} from '../conformity';
import { computeUncertainty, type UncertaintyResult } from '../uncertainty';

const GAGE_REFERENCE = 'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; Montgomery (2020)';
const STABILITY_REFERENCE = 'AIAG MSA (2010); ISO 7870-2; Montgomery (2020)';
const TOLERANCE_REFERENCE = 'JCGM 100:2008 (GUM); ISO/IEC 17025:2017, 7.6';

function hasReference(m: Measurement): boolean {
  return (
    m.refValue !== null &&
    m.refValue !== undefined &&
    Number.isFinite(m.refValue)
  );
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

function componentOf(result: GageRRResult, key: 'repeatability' | 'operator') {
  return result.components.find((component) => component.key === key) ?? null;
}

// ── Gage R&R (repetibilidade e reprodutibilidade) ─────────────────────────

interface GageRRStudy {
  result: GageRRResult;
  measurements: number;
}

function gageRRStudy(
  context: AnalysisContext,
  criteria: AcceptanceCriterion[],
): GageRRStudy | { error: string } {
  const measurements = context.used.filter(
    (m) =>
      (m.partId ?? '').trim() !== '' &&
      !hasReference(m) &&
      m.value !== null,
  );
  if (!measurements.length) {
    return {
      error:
        'Informe as peças (coluna “Peça”) e as medições do estudo Gage R&R; medições com referência são usadas em tendência/linearidade.',
    };
  }
  const partIds = [
    ...new Set(measurements.map((m) => (m.partId ?? '').trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const operators = [
    ...new Set(measurements.map((m) => m.analyst || m.equipment || 'Operador')),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  if (partIds.length < 2) {
    return { error: 'O Gage R&R requer pelo menos 2 peças com medições válidas.' };
  }
  if (operators.length < 2) {
    return {
      error:
        'O Gage R&R requer pelo menos 2 operadores; use a coluna “Analista/operador” para identificá-los.',
    };
  }

  const cells = new Map<string, number[]>();
  for (const measurement of measurements) {
    const key = `${(measurement.partId ?? '').trim()}\u0000${measurement.analyst || measurement.equipment || 'Operador'}`;
    const values = cells.get(key) ?? [];
    values.push(measurement.value!);
    cells.set(key, values);
  }
  const maxReplicates = Math.max(
    ...[...cells.values()].map((values) => values.length),
    0,
  );
  if (maxReplicates < 2) {
    return {
      error:
        'O Gage R&R requer pelo menos 2 réplicas por peça × operador; r = 1 não permite estimar a repetibilidade.',
    };
  }

  const y = partIds.map((part) =>
    operators.map((operator) => {
      const values = cells.get(`${part}\u0000${operator}`) ?? [];
      return Array.from({ length: maxReplicates }, (_, index) => values[index] ?? null);
    }),
  );

  const nativeCriteria: Partial<GageRRCriteria> = {
    grrAccept: criterionLimit(criteria, 'grr_pct', 10),
    grrWarning: Math.max(criterionLimit(criteria, 'grr_pct', 10), 30),
    ptAccept: criterionLimit(criteria, 'pt_pct', 10),
    ptWarning: Math.max(criterionLimit(criteria, 'pt_pct', 10), 30),
    ndcMin: criterionLimit(criteria, 'ndc', 5),
  };

  try {
    const result = gageRRAnalysis(
      {
        y,
        tolerance: toleranceOf(context.options),
        partLabels: partIds,
        operatorLabels: operators,
        k: 6,
      },
      {
        confidence: context.options.confidence ?? 0.95,
        criteria: nativeCriteria,
        unit: unitOf(context.options),
      },
    );
    return { result, measurements: measurements.length };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function gageRRTables(result: GageRRResult) {
  return {
    tables: result.tables,
    charts: result.charts,
    warnings: result.warnings,
    notes: result.notes,
  };
}

export const dimensionalRepeatabilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = gageRRStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A repetibilidade usa o Gage R&R cruzado: a mesma peça é medida várias vezes pelo mesmo operador.',
    ]);
  }
  const { result } = study;
  const repetition = componentOf(result, 'repeatability');
  const raw = {
    ev_pct: repetition?.studyVariationPct ?? null,
    sigma_rep: repetition?.standardDeviation ?? null,
    grr_pct: result.rawMetrics.grr_pct ?? null,
    ndc: result.rawMetrics.ndc ?? null,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: result.nEff,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `%EV = ${raw.ev_pct === null ? '—' : fmt(raw.ev_pct)}%; σ_rep = ${raw.sigma_rep === null ? '—' : fmt(raw.sigma_rep)} ${unitOf(context.options)}; %GRR = ${raw.grr_pct === null ? '—' : fmt(raw.grr_pct)}%; ndc = ${raw.ndc === null ? '—' : fmt(raw.ndc)}. ${result.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'ev_pct',
        raw.ev_pct,
        criteria,
        '%EV = 100·σ_rep/σ_total',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'sigma_rep',
        raw.sigma_rep,
        criteria,
        'σ_rep = √MS_E (variação dentro da mesma peça × operador)',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'grr_pct',
        raw.grr_pct,
        criteria,
        '%GRR = 100·σ_GRR/σ_total',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'ndc',
        raw.ndc,
        criteria,
        'ndc = 1,41·(σ_peça/σ_GRR)',
        GAGE_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    ...gageRRTables(result),
    reference: GAGE_REFERENCE,
    results: { gageRR: result, study: 'gage_rr' },
  };
};

export const dimensionalReproducibilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = gageRRStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A reprodutibilidade dimensional é a variação entre operadores no Gage R&R cruzado; não exige laboratórios distintos.',
    ]);
  }
  const { result } = study;
  const operator = componentOf(result, 'operator');
  const raw = {
    oper_pct: operator?.studyVariationPct ?? null,
    sigma_oper: operator?.standardDeviation ?? null,
    grr_pct: result.rawMetrics.grr_pct ?? null,
    pt_pct: result.rawMetrics.pt_pct ?? null,
    ndc: result.rawMetrics.ndc ?? null,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: result.nEff,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `%AV = ${raw.oper_pct === null ? '—' : fmt(raw.oper_pct)}%; σ_oper = ${raw.sigma_oper === null ? '—' : fmt(raw.sigma_oper)} ${unitOf(context.options)}; %GRR = ${raw.grr_pct === null ? '—' : fmt(raw.grr_pct)}%; %P/T = ${raw.pt_pct === null ? '—' : fmt(raw.pt_pct)}%; ndc = ${raw.ndc === null ? '—' : fmt(raw.ndc)}. ${result.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'oper_pct',
        raw.oper_pct,
        criteria,
        '%AV = 100·σ_oper/σ_total',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'sigma_oper',
        raw.sigma_oper,
        criteria,
        'σ_oper = √[(MS_operador − MS_interação)/(peças × réplicas)]',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'grr_pct',
        raw.grr_pct,
        criteria,
        '%GRR = 100·σ_GRR/σ_total',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'pt_pct',
        raw.pt_pct,
        criteria,
        '%P/T = 100·6·σ_GRR/T',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'ndc',
        raw.ndc,
        criteria,
        'ndc = 1,41·(σ_peça/σ_GRR)',
        GAGE_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    ...gageRRTables(result),
    reference: GAGE_REFERENCE,
    results: { gageRR: result, study: 'gage_rr' },
  };
};

// ── Tendência e linearidade ────────────────────────────────────────────────

function biasLevels(context: AnalysisContext): GageBiasLevelInput[] {
  const groups = new Map<number, { values: number[]; referenceUncertainty?: number }>();
  for (const measurement of context.used) {
    if (!hasReference(measurement) || measurement.value === null) continue;
    const reference = measurement.refValue!;
    const entry = groups.get(reference) ?? { values: [] };
    entry.values.push(measurement.value);
    if (
      measurement.refUncertainty !== null &&
      measurement.refUncertainty !== undefined &&
      Number.isFinite(measurement.refUncertainty) &&
      measurement.refUncertainty >= 0
    ) {
      // O campo guarda a incerteza expandida do padrão; u_ref = U_ref/k, k = 2.
      entry.referenceUncertainty = measurement.refUncertainty / 2;
    }
    groups.set(reference, entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([reference, entry]) => ({
      reference,
      values: entry.values,
      referenceUncertainty: entry.referenceUncertainty,
    }));
}

function biasCriteria(
  criteria: AcceptanceCriterion[],
): Partial<GageBiasLinearityCriteria> {
  const bias = criterionLimit(criteria, 'max_bias_pct_t', 10);
  const linearity = criterionLimit(criteria, 'linearity_pct_t', 10);
  return {
    biasPctAccept: bias,
    biasPctWarning: Math.max(bias, 30),
    linearityPctAccept: linearity,
    linearityPctWarning: Math.max(linearity, 30),
  };
}

function biasStudy(
  context: AnalysisContext,
  criteria: AcceptanceCriterion[],
): GageBiasLinearityResult | { error: string } {
  const levels = biasLevels(context);
  if (!levels.length) {
    return {
      error:
        'Cadastre medições com valor de referência (coluna “Referência”) para o estudo de tendência/linearidade.',
    };
  }
  try {
    return gageBiasLinearityStudy(
      {
        levels,
        tolerance: toleranceOf(context.options),
        processVariation: context.options.processVariation ?? null,
        rangeMin: context.options.rangeMin ?? null,
        rangeMax: context.options.rangeMax ?? null,
      },
      {
        criteria: biasCriteria(criteria),
        unit: unitOf(context.options),
        confidence: context.options.confidence ?? 0.95,
        alpha: context.options.alpha ?? 0.05,
      },
    );
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function biasTables(study: GageBiasLinearityResult) {
  return {
    tables: study.tables,
    charts: study.charts,
    warnings: study.warnings,
    notes: study.notes,
  };
}

export const dimensionalBiasAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = biasStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A tendência compara a média das medições com o valor aceito do padrão de referência.',
    ]);
  }
  const maxBias =
    study.levels.length > 0
      ? Math.max(...study.levels.map((level) => Math.abs(level.bias)))
      : null;
  const raw = {
    max_bias_pct_t: study.maxBiasPctT ?? null,
    max_bias: maxBias,
    design_levels: study.levelCount,
    design_replicates: study.replicatesMin,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: study.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `maior |tendência| = ${maxBias === null ? '—' : fmt(maxBias)} ${unitOf(context.options)}; maior |tendência|/T = ${raw.max_bias_pct_t === null ? '—' : fmt(raw.max_bias_pct_t)}%; níveis = ${study.levelCount}. ${study.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'max_bias_pct_t',
        raw.max_bias_pct_t,
        criteria,
        'max |bias_i|/T × 100, com bias_i = x̄_i − ref_i',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'max_bias',
        raw.max_bias,
        criteria,
        'max |x̄_i − ref_i|',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'design_levels',
        raw.design_levels,
        criteria,
        'número de níveis de referência com medições',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'design_replicates',
        raw.design_replicates,
        criteria,
        'mínimo de réplicas entre os níveis',
        GAGE_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    ...biasTables(study),
    reference: GAGE_REFERENCE,
    results: { biasLinearity: study },
  };
};

export const dimensionalLinearityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = biasStudy(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A linearidade verifica se a tendência muda de forma proporcional ao longo da faixa de uso.',
    ]);
  }
  const raw = {
    linearity_pct_t: study.linearityPctT ?? null,
    linearity_pct: study.linearityPct ?? null,
    linearity: study.linearity ?? null,
    slope_p: Number.isFinite(study.regression.slopeP) ? study.regression.slopeP : null,
    r2: Number.isFinite(study.regression.r2) ? study.regression.r2 : null,
    design_levels: study.levelCount,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: study.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `linearidade/T = ${raw.linearity_pct_t === null ? '—' : fmt(raw.linearity_pct_t)}%; declive = ${Number.isFinite(study.regression.slope) ? fmt(study.regression.slope) : '—'}; p = ${raw.slope_p === null ? '—' : fmt(raw.slope_p)}; níveis = ${study.levelCount}. ${study.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'linearity_pct_t',
        raw.linearity_pct_t,
        criteria,
        'linearidade/T × 100, com linearidade = |b|·variação do processo',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'linearity_pct',
        raw.linearity_pct,
        criteria,
        '100·|b| (variação da tendência por unidade da referência)',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'linearity',
        raw.linearity,
        criteria,
        'linearidade = |b|·(6σ_processo)',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'slope_p',
        raw.slope_p,
        criteria,
        'p do declive na regressão bias = a + b·referência',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'r2',
        raw.r2,
        criteria,
        'R² da regressão da tendência sobre a referência',
        GAGE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'design_levels',
        raw.design_levels,
        criteria,
        'número de níveis de referência com medições',
        GAGE_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    ...biasTables(study),
    reference: GAGE_REFERENCE,
    results: { biasLinearity: study },
  };
};

// ── Estabilidade e resolução ───────────────────────────────────────────────

interface StabilitySeries {
  values: number[];
  reference: number | null;
  labels: string[];
}

function stabilitySeries(context: AnalysisContext): StabilitySeries {
  const withReference = context.used.filter(
    (m) => hasReference(m) && m.value !== null,
  );
  if (!withReference.length) {
    return { values: [], reference: null, labels: [] };
  }
  const counts = new Map<number, number>();
  for (const measurement of withReference) {
    const reference = measurement.refValue!;
    counts.set(reference, (counts.get(reference) ?? 0) + 1);
  }
  let target: number | null = null;
  let best = -1;
  for (const [reference, count] of counts) {
    if (count > best) {
      target = reference;
      best = count;
    }
  }
  const selected = withReference
    .filter((measurement) => measurement.refValue === target)
    .sort((a, b) => {
      const keyA = `${a.day}|${String(a.replicate).padStart(4, '0')}|${String(a.runOrder).padStart(6, '0')}`;
      const keyB = `${b.day}|${String(b.replicate).padStart(4, '0')}|${String(b.runOrder).padStart(6, '0')}`;
      return keyA.localeCompare(keyB, 'pt-BR', { numeric: true });
    });
  return {
    values: selected.map((measurement) => measurement.value!),
    reference: target,
    labels: selected.map(
      (measurement) =>
        `${measurement.day || '—'} · réplica ${measurement.replicate}`,
    ),
  };
}

function stabilityCriteria(
  criteria: AcceptanceCriterion[],
): Partial<StabilityCriteria> {
  return {
    maxAlarms: criterionLimit(criteria, 'alarm_count', 0),
    maxResolutionPct: criterionLimit(criteria, 'resolution_pct', 10),
  };
}

function runStability(
  context: AnalysisContext,
  criteria: AcceptanceCriterion[],
): StabilityResult | { error: string } {
  const series = stabilitySeries(context);
  if (series.values.length < 2) {
    return {
      error:
        'O estudo de estabilidade requer pelo menos 2 medições do mesmo padrão de referência ao longo do tempo.',
    };
  }
  try {
    return stabilityStudy(
      { values: series.values },
      {
        criteria: stabilityCriteria(criteria),
        tolerance: toleranceOf(context.options),
        resolution: context.options.resolution ?? null,
        unit: unitOf(context.options),
        labels: series.labels,
      },
    );
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export const dimensionalStabilityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const study = runStability(context, criteria);
  if ('error' in study) {
    return emptyParameter(parameter, context.used.length, study.error, [
      'A estabilidade acompanha o mesmo padrão ao longo do tempo por meio de cartas de controle.',
    ]);
  }
  const raw = {
    alarm_count: study.alarms.length,
    out_of_limits: study.alarms.filter((alarm) => alarm.rule === 'out_of_limits').length,
    sigma_within: study.sigmaWithin,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: study.n,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `alarmes = ${raw.alarm_count}; pontos fora dos limites = ${raw.out_of_limits}; σ de curto prazo = ${raw.sigma_within === null ? '—' : fmt(raw.sigma_within)} ${unitOf(context.options)}. ${study.summary}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'alarm_count',
        raw.alarm_count,
        criteria,
        'contagem de alarmes das regras (fora dos limites, mesmo lado, tendência)',
        STABILITY_REFERENCE,
      ),
      buildMetric(
        parameter,
        'out_of_limits',
        raw.out_of_limits,
        criteria,
        'pontos com valor < LIC ou > LSC',
        STABILITY_REFERENCE,
      ),
      buildMetric(
        parameter,
        'sigma_within',
        study.sigmaWithin,
        criteria,
        study.mode === 'I-MR' ? 'σ_dentro = MR̄/1,128' : 'σ_dentro combinado dos subgrupos',
        STABILITY_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    tables: study.tables,
    charts: study.charts,
    warnings: study.warnings,
    notes: study.notes,
    reference: STABILITY_REFERENCE,
    results: { stability: study },
  };
};

export const dimensionalResolutionAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const series = stabilitySeries(context);
  const providedResolution = context.options.resolution ?? null;
  const tolerance = toleranceOf(context.options);
  let study: StabilityResult | null = null;
  if (series.values.length >= 2) {
    try {
      study = stabilityStudy(
        { values: series.values },
        {
          criteria: stabilityCriteria(criteria),
          tolerance,
          resolution: providedResolution,
          unit: unitOf(context.options),
          labels: series.labels,
        },
      );
    } catch {
      study = null;
    }
  }
  const resolution = providedResolution ?? study?.resolution.resolution ?? null;
  const ratioPct =
    resolution !== null && tolerance !== null
      ? (100 * resolution) / tolerance
      : study?.resolution.ratioPct ?? null;
  if (resolution === null && ratioPct === null) {
    return emptyParameter(
      parameter,
      context.used.length,
      'Informe a resolução do sistema de medição (ou colete pelo menos 2 medições do mesmo padrão para inferi-la).',
      [
        'A resolução deve ser ≤ 10% da tolerância T = USL − LSL.',
      ],
    );
  }
  const raw = {
    resolution_pct: ratioPct,
    resolution,
    categories: study?.distinctValues ?? null,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  const fallbackNote =
    study === null
      ? 'Resolução informada diretamente: não havia medições repetidas suficientes para inferi-la; o critério 100·resolução/T foi aplicado.'
      : null;
  return {
    key: parameter.key,
    label: parameter.label,
    n: study?.n ?? context.used.length,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `resolução = ${fmt(resolution)} ${unitOf(context.options)}; T = ${tolerance === null ? '—' : `${fmt(tolerance)} ${unitOf(context.options)}`}; resolução/T = ${ratioPct === null ? '—' : `${fmt(ratioPct)}%`}.${fallbackNote ? ` ${fallbackNote}` : ''}`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'resolution_pct',
        ratioPct,
        criteria,
        'resolução/T × 100',
        STABILITY_REFERENCE,
      ),
      buildMetric(
        parameter,
        'resolution',
        resolution,
        criteria,
        'menor incremento distinguível do sistema de medição',
        STABILITY_REFERENCE,
      ),
      buildMetric(
        parameter,
        'categories',
        raw.categories,
        criteria,
        'número de valores distintos observados',
        STABILITY_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    tables: study?.tables ?? [],
    charts: study?.charts ?? [],
    warnings: study?.warnings ?? [],
    notes: [
      ...(study?.notes ?? []),
      ...(fallbackNote ? [fallbackNote] : []),
    ],
    reference: STABILITY_REFERENCE,
    results: { stability: study, resolution, ratioPct },
  };
};

// ── Incerteza (orçamento GUM) ──────────────────────────────────────────────

function gumResult(context: AnalysisContext): UncertaintyResult | null {
  if (!context.uncertaintyItems.length) return null;
  return computeUncertainty(
    context.uncertaintyItems.map((item) => ({
      id: item.id,
      source: item.source,
      type: item.type,
      distribution: item.distribution,
      value: item.value,
      divisor: item.divisor,
      sensitivity: item.sensitivity,
      dof: item.dof,
      notes: item.notes,
    })),
  );
}

export const dimensionalUncertaintyAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const result = gumResult(context);
  if (!result) {
    return emptyParameter(
      parameter,
      context.observedMean === null ? 0 : 1,
      'Cadastre as fontes no orçamento de incerteza (etapa Análise).',
      [
        'O orçamento-modelo dimensional inclui resolução, calibração, temperatura, repetibilidade, reprodutibilidade, padrão de referência e, opcionalmente, planicidade/paralelismo/força.',
      ],
    );
  }
  const tolerance = toleranceOf(context.options);
  const toleranceValues = toleranceMetrics({
    lsl: context.options.lsl ?? null,
    usl: context.options.usl ?? null,
    expandedUncertainty: result.expanded,
  });
  const relative =
    context.observedMean && context.observedMean !== 0
      ? (100 * result.expanded) / Math.abs(context.observedMean)
      : null;
  const raw = {
    expanded: result.expanded,
    relative_expanded: relative,
    pct_pt: toleranceValues.pctPT,
    u_over_t: toleranceValues.uOverT,
    tur: toleranceValues.tur,
  };
  const verdict = evaluateParameter(parameter.key, raw, criteria).verdict;
  return {
    key: parameter.key,
    label: parameter.label,
    n: context.observedMean === null ? 0 : 1,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `u_c = ${fmt(result.combined)} ${unitOf(context.options)}; U = ${fmt(result.expanded)} ${unitOf(context.options)} (k = ${fmt(result.coverageFactor)}); T = ${tolerance === null ? '—' : fmt(tolerance)}; %P/T = ${raw.pct_pt === null ? '—' : `${fmt(raw.pct_pt)}%`}; TUR/TAR = ${raw.tur === null ? '—' : fmt(raw.tur)}.`,
    ),
    metrics: [
      buildMetric(
        parameter,
        'expanded',
        result.expanded,
        criteria,
        'U = k·u_c',
        TOLERANCE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'relative_expanded',
        relative,
        criteria,
        'U_rel = 100·U/valor médio',
        TOLERANCE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'pct_pt',
        toleranceValues.pctPT,
        criteria,
        '%P/T = 100·U/T',
        TOLERANCE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'u_over_t',
        toleranceValues.uOverT,
        criteria,
        'U/T',
        TOLERANCE_REFERENCE,
      ),
      buildMetric(
        parameter,
        'tur',
        toleranceValues.tur,
        criteria,
        'TUR/TAR = T/(2U)',
        TOLERANCE_REFERENCE,
      ),
    ],
    rawMetrics: raw,
    tables: [
      {
        title: 'Orçamento de incerteza',
        columns: ['Fonte', 'Tipo', 'Valor', 'Divisor', 'c_i', 'u_i', '% contribuição', 'ν'],
        rows: result.items.map((item) => [
          item.source,
          item.type,
          item.value,
          item.divisor,
          item.sensitivity,
          item.stdUncertainty,
          item.percentContribution,
          item.dof ?? '',
        ]),
        note: 'u_i = c_i·valor/divisor; u_c = √Σu_i²; U = k·u_c.',
      },
      {
        title: 'Incerteza relativa à tolerância',
        columns: ['Métrica', 'Fórmula', 'Valor', 'Critério', 'Veredito'],
        rows: [
          ['%P/T', '100·U/T', toleranceValues.pctPT ?? '—', 'editável no critério', ''],
          ['U/T', 'U/T', toleranceValues.uOverT ?? '—', 'editável no critério', ''],
          ['TUR/TAR', 'T/(2U)', toleranceValues.tur ?? '—', 'editável no critério', ''],
        ],
      },
    ],
    charts: [
      {
        kind: 'bar',
        title: 'Contribuição relativa das fontes de incerteza',
        xLabel: 'Fonte',
        yLabel: '%',
        data: result.items.map((item) => ({
          fonte: item.source,
          contribuicao: item.percentContribution,
        })),
      },
    ],
    warnings: result.warnings,
    notes: [
      ...(tolerance === null
        ? ['Sem tolerância bilateral, %P/T, U/T e TUR/TAR ficam não avaliados.']
        : []),
    ],
    reference: result.reference,
    results: { uncertainty: result, tolerance: toleranceValues },
  };
};

// ── Conformidade ───────────────────────────────────────────────────────────

export const dimensionalConformityAnalysis: AnalysisModule = ({
  parameter,
  criteria,
  context,
}) => {
  const options = context.options;
  const conformityOptions = options.conformity;
  const lsl = conformityOptions?.lsl ?? options.lsl ?? null;
  const usl = conformityOptions?.usl ?? options.usl ?? null;
  if (lsl === null && usl === null) {
    return emptyParameter(
      parameter,
      context.used.length,
      'Informe LSL e/ou USL para avaliar a conformidade.',
      [
        'A regra de decisão e a incerteza devem ser declaradas antes da medição.',
      ],
    );
  }
  const gum = gumResult(context);
  const standardUncertainty =
    conformityOptions?.standardUncertainty ?? gum?.combined ?? null;
  if (standardUncertainty === null) {
    return emptyParameter(
      parameter,
      context.used.length,
      'Cadastre o orçamento de incerteza ou informe u para a avaliação de conformidade.',
      [
        'Sem incerteza não é possível aplicar uma regra de decisão protegida.',
      ],
    );
  }
  const partValues = context.used
    .filter((measurement) => (measurement.partId ?? '').trim() !== '' && measurement.value !== null)
    .map((measurement) => measurement.value!);
  const value =
    conformityOptions?.value ??
    (partValues.length ? mean(partValues) : context.observedMean);
  if (value === null || !Number.isFinite(value)) {
    return emptyParameter(
      parameter,
      context.used.length,
      'Não há valor medido para a avaliação de conformidade.',
    );
  }
  const nativeCriteria: Partial<ConformityCriteria> = {
    ...(conformityOptions?.criteria ?? {}),
    turMinimum: criterionLimit(
      criteria,
      'tur',
      DEFAULT_TOLERANCE_CRITERIA.turMinimum,
    ),
    maxPctPT: criterionLimit(
      criteria,
      'pct_pt',
      DEFAULT_TOLERANCE_CRITERIA.pctPTMaximum,
    ),
    maxUOverT: criterionLimit(
      criteria,
      'u_over_t',
      DEFAULT_CONFORMITY_CRITERIA.maxUOverT,
    ),
  };
  let result: ConformityResult;
  try {
    result = conformityDecision(
      {
        value,
        standardUncertainty,
        coverageFactor: conformityOptions?.coverageFactor ?? 2,
        lsl,
        usl,
        rule: conformityOptions?.rule ?? 'guard_band',
        guardBandFactor: conformityOptions?.guardBandFactor,
        probabilityThreshold: conformityOptions?.probabilityThreshold,
      },
      { criteria: nativeCriteria, unit: unitOf(options) },
    );
  } catch (error) {
    return emptyParameter(parameter, context.used.length, errorMessage(error));
  }

  const riskVerdict = evaluateParameter(
    parameter.key,
    { tur: result.tur, pct_pt: result.pctPT, u_over_t: result.uOverT },
    criteria,
  ).verdict;
  const verdict =
    result.verdict === 'pass' && riskVerdict === 'fail' ? 'warning' : result.verdict;
  const riskAlert =
    result.verdict === 'pass' && riskVerdict === 'fail'
      ? 'A decisão é conforme, mas TUR/TAR, %P/T ou U/T falharam no critério de alerta; o resultado foi elevado a atenção.'
      : null;

  return {
    key: parameter.key,
    label: parameter.label,
    n: context.used.length,
    verdict,
    summary: parameterSummary(
      parameter.label,
      verdict,
      `${result.summary}${riskAlert ? ` ${riskAlert}` : ''}`,
    ),
    metrics: [
      {
        key: 'conformity',
        label: parameter.metrics.find((metric) => metric.key === 'conformity')?.label ?? 'Conformidade',
        value: result.value,
        unit: unitOf(options),
        verdict: result.verdict,
        criterionText: result.criteriaText,
        formula: 'x confrontado com a regra de decisão e os limites efetivos',
        reference: result.reference,
      },
      buildMetric(
        parameter,
        'expanded_uncertainty',
        result.expandedUncertainty,
        criteria,
        'U = k·u',
        result.reference,
      ),
      buildMetric(
        parameter,
        'guard_band',
        result.guardBand,
        criteria,
        'w = r·U',
        result.reference,
      ),
      buildMetric(
        parameter,
        'pct_pt',
        result.pctPT,
        criteria,
        '%P/T = 100·U/T',
        result.reference,
      ),
      buildMetric(
        parameter,
        'u_over_t',
        result.uOverT,
        criteria,
        'U/T',
        result.reference,
      ),
      buildMetric(
        parameter,
        'tur',
        result.tur,
        criteria,
        'TUR/TAR = T/(2U)',
        result.reference,
      ),
    ],
    rawMetrics: {
      conformity: result.value,
      expanded_uncertainty: result.expandedUncertainty,
      guard_band: result.guardBand,
      pct_pt: result.pctPT,
      u_over_t: result.uOverT,
      tur: result.tur,
      probability_conformity: result.probabilityConform,
      false_accept_risk: result.falseAcceptRisk,
      false_reject_risk: result.falseRejectRisk,
    },
    tables: result.tables,
    charts: [],
    warnings: [...result.warnings, ...(riskAlert ? [riskAlert] : [])],
    notes: result.notes,
    reference: result.reference,
    results: { conformity: result },
  };
};

// ── Orçamento-modelo dimensional ───────────────────────────────────────────

export interface DimensionalBudgetInput {
  validationId: string;
  /** Resolução do sistema de medição, na unidade do mensurando. */
  resolution: number;
  /** Incerteza expandida da calibração, U_cal. */
  calibrationUncertainty: number;
  /** Fator de abrangência da calibração e do padrão de referência; padrão 2. */
  coverageFactor?: number;
  /** Correção térmica: L·α·δT, com α em 1/°C. */
  temperature?: {
    length: number;
    coefficient: number;
    deltaT: number;
  } | null;
  /** Desvio-padrão de repetibilidade, s. */
  repeatabilitySd?: number | null;
  /** Número de réplicas usado em s/√n. */
  nReplicates?: number | null;
  /** Desvio-padrão entre operadores (reprodutibilidade). */
  reproducibilitySd?: number | null;
  /** Incerteza expandida do padrão de referência, U_ref. */
  referenceUncertainty?: number | null;
  /** Desvio máximo de planicidade (distribuição retangular). */
  flatness?: number | null;
  /** Desvio máximo de paralelismo (distribuição retangular). */
  parallelism?: number | null;
  /** Componente de força (distribuição retangular). */
  force?: number | null;
}

function budgetItem(
  input: DimensionalBudgetInput,
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
    id: `dim-${id}`,
    validationId: input.validationId,
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
 * Orçamento-modelo dimensional editável. Os valores são apenas um ponto de
 * partida: o usuário deve substituir os números fictícios pelos do certificado,
 * do histórico de calibração e do estudo Gage R&R.
 */
export function dimensionalUncertaintyBudget(
  input: DimensionalBudgetInput,
): UncertaintyItem[] {
  const k = input.coverageFactor ?? 2;
  const items: UncertaintyItem[] = [
    budgetItem(
      input,
      'resolution',
      'Resolução do sistema de medição',
      'B',
      'rectangular',
      input.resolution / 2,
      Math.sqrt(3),
      null,
      'u_res = (resolução/2)/√3 = resolução/(2√3).',
    ),
    budgetItem(
      input,
      'calibration',
      'Calibração do instrumento',
      'B',
      'normal',
      input.calibrationUncertainty,
      k,
      null,
      'u_cal = U_cal/k, com k do certificado de calibração.',
    ),
  ];

  if (input.temperature) {
    const { length, coefficient, deltaT } = input.temperature;
    items.push(
      budgetItem(
        input,
        'temperature',
        'Efeito da temperatura',
        'B',
        'rectangular',
        Math.abs(length * coefficient * deltaT),
        Math.sqrt(3),
        null,
        'u_temp = L·α·δT/√3; α em 1/°C.',
      ),
    );
  }

  const nReplicates = Math.max(1, Math.round(input.nReplicates ?? 1));
  if (input.repeatabilitySd !== null && input.repeatabilitySd !== undefined) {
    items.push(
      budgetItem(
        input,
        'repeatability',
        'Repetibilidade',
        'A',
        'normal',
        input.repeatabilitySd,
        Math.sqrt(nReplicates),
        Math.max(1, nReplicates - 1),
        'u_rep = s/√n, com s do estudo de repetibilidade.',
      ),
    );
  }

  if (
    input.reproducibilitySd !== null &&
    input.reproducibilitySd !== undefined
  ) {
    items.push(
      budgetItem(
        input,
        'reproducibility',
        'Reprodutibilidade entre operadores',
        'A',
        'normal',
        input.reproducibilitySd,
        1,
        null,
        'u_reprod = σ_operador do Gage R&R (desvio-padrão entre operadores).',
      ),
    );
  }

  if (
    input.referenceUncertainty !== null &&
    input.referenceUncertainty !== undefined
  ) {
    items.push(
      budgetItem(
        input,
        'reference',
        'Padrão de referência',
        'B',
        'normal',
        input.referenceUncertainty,
        k,
        null,
        'u_ref = U_ref/k, com k do certificado do padrão.',
      ),
    );
  }

  const rectangularExtras: Array<[keyof DimensionalBudgetInput, string, string]> = [
    ['flatness', 'Planicidade da superfície', 'u_plan = desvio/√3.'],
    ['parallelism', 'Paralelismo', 'u_par = desvio/√3.'],
    ['force', 'Variação da força de medição', 'u_força = variação/√3.'],
  ];
  for (const [key, source, note] of rectangularExtras) {
    const value = input[key];
    if (value !== null && value !== undefined) {
      items.push(
        budgetItem(
          input,
          String(key),
          source,
          'B',
          'rectangular',
          Math.abs(Number(value)),
          Math.sqrt(3),
          null,
          note,
        ),
      );
    }
  }

  return items;
}
