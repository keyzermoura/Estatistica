/**
 * Elementos compartilhados pelos perfis físicos (destrutivo e não destrutivo).
 *
 * As métricas são as mesmas usadas pelo perfil dimensional porque o objeto de
 * estudo continua sendo o sistema de medição; o que muda é o modelo
 * experimental (Gage R&R cruzado ou aninhado) e a interpretação do consumo de
 * corpos de prova. Manter o catálogo em um único lugar evita divergência entre
 * os dois perfis.
 *
 * Referências gerais: AIAG MSA (2010); ISO 22514-7:2021; ISO 14253-1:2017;
 * GUM/JCGM 100:2008; JCGM 106:2012; ILAC-G8:09/2019; ISO 5725-2:2019.
 */

import type { AcceptanceCriterion, ParamKey } from '../lib/types';
import { makeCriterion } from '../lib/criteria';
import type { MetricDefinition, ParameterDef } from './types';

export type PhysicalParamKey =
  | 'resolution'
  | 'bias'
  | 'linearity'
  | 'stability'
  | 'repeatability'
  | 'reproducibility'
  | 'uncertainty'
  | 'conformity';

export const PHYSICAL_MSA_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; ISO 14253-1:2017';
export const PHYSICAL_GUM_REFERENCE =
  'GUM / JCGM 100:2008; ISO/IEC 17025:2017, 7.6';
export const PHYSICAL_CONFORMITY_REFERENCE =
  'JCGM 106:2012; ILAC-G8:09/2019; ISO/IEC 17025:2017, 7.8.2.1';
export const PHYSICAL_NESTED_REFERENCE =
  'Montgomery (2020), cap. 14; ISO 5725-2:2019; AIAG MSA (2010), 4. ed.';

export const PHYSICAL_METRICS: Record<PhysicalParamKey, MetricDefinition[]> = {
  resolution: [
    {
      key: 'resolution_pct',
      label: 'Resolução relativa à tolerância',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'resolution',
      label: 'Resolução do sistema de medição',
      unit: '',
    },
    {
      key: 'categories',
      label: 'Categorias distintas observadas',
      unit: '',
    },
  ],
  bias: [
    {
      key: 'max_bias_pct_t',
      label: 'Maior tendência relativa à tolerância',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'max_bias',
      label: 'Maior tendência absoluta',
      unit: '',
    },
    {
      key: 'design_levels',
      label: 'Níveis de referência',
      unit: '',
    },
    {
      key: 'design_replicates',
      label: 'Réplicas mínimas por nível',
      unit: '',
    },
  ],
  linearity: [
    {
      key: 'linearity_pct_t',
      label: 'Linearidade relativa à tolerância',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'linearity_pct',
      label: 'Linearidade relativa à variação do processo',
      unit: '%',
    },
    {
      key: 'linearity',
      label: 'Linearidade absoluta',
      unit: '',
    },
    {
      key: 'slope_p',
      label: 'p do declive da tendência',
      unit: '',
    },
    {
      key: 'r2',
      label: 'R² da regressão da tendência',
      unit: '',
    },
    {
      key: 'design_levels',
      label: 'Níveis de referência',
      unit: '',
    },
  ],
  stability: [
    {
      key: 'alarm_count',
      label: 'Alarmes nas cartas de controle',
      unit: '',
      suggested: { operator: '<=', limit: 0 },
    },
    {
      key: 'out_of_limits',
      label: 'Pontos fora dos limites de controle',
      unit: '',
    },
    {
      key: 'sigma_within',
      label: 'Desvio-padrão de curto prazo',
      unit: '',
    },
  ],
  repeatability: [
    {
      key: 'ev_pct',
      label: '%EV (repetibilidade)',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'sigma_rep',
      label: 'Desvio-padrão de repetibilidade',
      unit: '',
    },
    {
      key: 'grr_pct',
      label: '%GRR do sistema de medição',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'ndc',
      label: 'Número de categorias distintas (ndc)',
      unit: '',
      suggested: { operator: '>=', limit: 5 },
    },
  ],
  reproducibility: [
    {
      key: 'oper_pct',
      label: '%AV (reprodutibilidade/operador)',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'sigma_oper',
      label: 'Desvio-padrão entre operadores',
      unit: '',
    },
    {
      key: 'grr_pct',
      label: '%GRR do sistema de medição',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'pt_pct',
      label: '%P/T (Gage R&R)',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'ndc',
      label: 'Número de categorias distintas (ndc)',
      unit: '',
      suggested: { operator: '>=', limit: 5 },
    },
  ],
  uncertainty: [
    {
      key: 'expanded',
      label: 'Incerteza expandida U',
      unit: '',
    },
    {
      key: 'relative_expanded',
      label: 'Incerteza expandida relativa',
      unit: '%',
    },
    {
      key: 'pct_pt',
      label: '%P/T (U/T)',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'u_over_t',
      label: 'U/T',
      unit: '',
      suggested: { operator: '<=', limit: 0.25 },
    },
    {
      key: 'tur',
      label: 'TUR/TAR',
      unit: '',
      suggested: { operator: '>=', limit: 4 },
    },
  ],
  conformity: [
    {
      key: 'conformity',
      label: 'Conformidade — regra de decisão',
      unit: '',
    },
    {
      key: 'expanded_uncertainty',
      label: 'Incerteza expandida U',
      unit: '',
    },
    {
      key: 'guard_band',
      label: 'Banda de guarda w',
      unit: '',
    },
    {
      key: 'pct_pt',
      label: '%P/T (U/T)',
      unit: '%',
      suggested: { operator: '<=', limit: 10, unit: '%' },
    },
    {
      key: 'u_over_t',
      label: 'U/T',
      unit: '',
      suggested: { operator: '<=', limit: 0.25 },
    },
    {
      key: 'tur',
      label: 'TUR/TAR',
      unit: '',
      suggested: { operator: '>=', limit: 4 },
    },
  ],
};

export interface PhysicalParameterOptions {
  labels: Record<PhysicalParamKey, string>;
  short: Record<PhysicalParamKey, string>;
  references: Record<PhysicalParamKey, string>;
  /** Parâmetros marcados no checklist ao criar a validação. */
  defaultSelected: PhysicalParamKey[];
  justifications?: Partial<Record<PhysicalParamKey, string>>;
}

/** Monta o catálogo do perfil físico a partir dos textos específicos da família. */
export function buildPhysicalParameters(
  options: PhysicalParameterOptions,
): ParameterDef[] {
  return (Object.keys(PHYSICAL_METRICS) as PhysicalParamKey[]).map((key) => ({
    key,
    label: options.labels[key],
    shortDescription: options.short[key],
    reference: options.references[key],
    metrics: PHYSICAL_METRICS[key],
    defaultSelected: options.defaultSelected.includes(key),
    defaultJustification: options.justifications?.[key] ?? '',
  }));
}

/** Critérios sugeridos por parâmetro, iguais aos do perfil dimensional. */
export function buildPhysicalCriteria(
  parameters: ParameterDef[],
): Record<string, AcceptanceCriterion[]> {
  const result: Record<string, AcceptanceCriterion[]> = {};
  for (const parameter of parameters) {
    result[parameter.key] = parameter.metrics
      .filter((metric) => metric.suggested)
      .map((metric, index) =>
        makeCriterion(parameter.key as ParamKey, metric, `${parameter.key}-${index}`),
      );
  }
  return result;
}

export function pickPhysicalCriterion(
  criteria: Record<string, AcceptanceCriterion[]>,
  parameter: PhysicalParamKey,
  metric: string,
): AcceptanceCriterion | null {
  return (
    criteria[parameter]?.find((criterion) => criterion.metric === metric) ?? null
  );
}
