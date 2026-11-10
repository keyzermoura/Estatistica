/**
 * Perfil de método dimensional.
 *
 * Reúne o catálogo de parâmetros, os critérios padrão editáveis, os módulos de
 * análise e o template Gage R&R da família dimensional. Os cálculos ficam em
 * `src/stats/parameters/dimensional.ts`; o motor estatístico existente não é
 * alterado.
 *
 * Referências gerais: AIAG MSA (2010); ISO 22514-7:2021; ISO 14253-1:2017;
 * GUM/JCGM 100:2008; JCGM 106:2012; ILAC-G8:09/2019.
 */

import type { AcceptanceCriterion, ParamKey } from '../lib/types';
import { makeCriterion } from '../lib/criteria';
import type {
  DesignTemplate,
  MethodProfile,
  MetricDefinition,
  ParameterDef,
} from './types';
import {
  dimensionalBiasAnalysis,
  dimensionalConformityAnalysis,
  dimensionalLinearityAnalysis,
  dimensionalRepeatabilityAnalysis,
  dimensionalReproducibilityAnalysis,
  dimensionalResolutionAnalysis,
  dimensionalStabilityAnalysis,
  dimensionalUncertaintyAnalysis,
} from '../stats/parameters/dimensional';

type DimensionalParamKey =
  | 'resolution'
  | 'bias'
  | 'linearity'
  | 'stability'
  | 'repeatability'
  | 'reproducibility'
  | 'uncertainty'
  | 'conformity';

const MSA_REFERENCE = 'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; ISO 14253-1:2017';
const GUM_REFERENCE = 'GUM / JCGM 100:2008; ISO/IEC 17025:2017, 7.6';
const CONFORMITY_REFERENCE =
  'JCGM 106:2012; ILAC-G8:09/2019; ISO/IEC 17025:2017, 7.8.2.1';

const METRICS: Record<DimensionalParamKey, MetricDefinition[]> = {
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

const LABELS: Record<DimensionalParamKey, string> = {
  resolution: 'Resolução',
  bias: 'Tendência',
  linearity: 'Linearidade',
  stability: 'Estabilidade',
  repeatability: 'Repetibilidade',
  reproducibility: 'Reprodutibilidade',
  uncertainty: 'Incerteza de medição',
  conformity: 'Conformidade',
};

const SHORT: Record<DimensionalParamKey, string> = {
  resolution:
    'Menor diferença que o instrumento consegue distinguir; deve ser pequena em relação à tolerância.',
  bias:
    'Diferença entre o valor medido e o valor aceito de um padrão de referência.',
  linearity:
    'Verifica se a tendência se mantém ao longo de toda a faixa de uso.',
  stability:
    'Verifica se o sistema continua estável ao longo do tempo, usando cartas de controle.',
  repeatability:
    'Variação quando o mesmo operador mede a mesma peça várias vezes.',
  reproducibility:
    'Variação entre operadores diferentes medindo as mesmas peças.',
  uncertainty:
    'Faixa provável do resultado, combinando todas as fontes de incerteza (GUM).',
  conformity:
    'Decide se o resultado atende à tolerância, declarando a regra de decisão e o risco.',
};

const REFERENCES: Record<DimensionalParamKey, string> = {
  resolution: MSA_REFERENCE,
  bias: MSA_REFERENCE,
  linearity: MSA_REFERENCE,
  stability: MSA_REFERENCE,
  repeatability: MSA_REFERENCE,
  reproducibility: MSA_REFERENCE,
  uncertainty: GUM_REFERENCE,
  conformity: CONFORMITY_REFERENCE,
};

const PARAMETERS: ParameterDef[] = (
  Object.keys(LABELS) as DimensionalParamKey[]
).map((key) => ({
  key,
  label: LABELS[key],
  shortDescription: SHORT[key],
  reference: REFERENCES[key],
  metrics: METRICS[key],
  defaultSelected: true,
  defaultJustification:
    key === 'bias' || key === 'linearity'
      ? 'Avaliado com padrões de referência cobrindo a faixa de uso; ver tabelas do estudo.'
      : key === 'stability'
        ? 'Avaliado com medições repetidas do mesmo padrão ao longo do tempo.'
        : key === 'conformity'
          ? 'Regra de decisão e limites efetivos declarados antes da medição.'
          : '',
}));

function buildDefaultCriteria(): Record<string, AcceptanceCriterion[]> {
  const result: Record<string, AcceptanceCriterion[]> = {};
  for (const parameter of PARAMETERS) {
    result[parameter.key] = parameter.metrics
      .filter((metric) => metric.suggested)
      .map((metric, index) =>
        makeCriterion(parameter.key, metric, `${parameter.key}-${index}`),
      );
  }
  return result;
}

const DEFAULT_CRITERIA = buildDefaultCriteria();

function pickCriterion(
  parameter: DimensionalParamKey,
  metric: string,
): AcceptanceCriterion | null {
  return (
    DEFAULT_CRITERIA[parameter]?.find((criterion) => criterion.metric === metric) ??
    null
  );
}

const METHOD_CRITERIA_KEYS: Array<[DimensionalParamKey, string]> = [
  ['resolution', 'resolution_pct'],
  ['bias', 'max_bias_pct_t'],
  ['linearity', 'linearity_pct_t'],
  ['stability', 'alarm_count'],
  ['repeatability', 'grr_pct'],
  ['repeatability', 'ndc'],
  ['reproducibility', 'grr_pct'],
  ['reproducibility', 'pt_pct'],
  ['reproducibility', 'ndc'],
  ['uncertainty', 'pct_pt'],
  ['uncertainty', 'tur'],
  ['conformity', 'tur'],
  ['conformity', 'pct_pt'],
  ['conformity', 'u_over_t'],
];

const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'gage_rr',
    designType: 'gage_rr',
    label: 'Gage R&R cruzado (peças × operadores × réplicas)',
    description:
      'Peças aleatórias medidas por todos os operadores, com réplicas independentes e ordem de execução aleatorizada pela semente.',
    defaults: {
      designType: 'gage_rr',
      nSamples: 10,
      nAnalysts: 3,
      nReplicates: 3,
      nLevels: 5,
      nDays: 5,
    },
  },
];

function suggestedParameters(): ParamKey[] {
  return [
    'resolution',
    'bias',
    'linearity',
    'stability',
    'repeatability',
    'reproducibility',
    'uncertainty',
    'conformity',
  ];
}

export const DIMENSIONAL_PROFILE: MethodProfile = {
  id: 'dimensional',
  label: 'Método dimensional (metrologia)',
  parameters: PARAMETERS,
  designTemplates: DESIGN_TEMPLATES,
  analyses: {
    resolution: dimensionalResolutionAnalysis,
    bias: dimensionalBiasAnalysis,
    linearity: dimensionalLinearityAnalysis,
    stability: dimensionalStabilityAnalysis,
    repeatability: dimensionalRepeatabilityAnalysis,
    reproducibility: dimensionalReproducibilityAnalysis,
    uncertainty: dimensionalUncertaintyAnalysis,
    conformity: dimensionalConformityAnalysis,
  },
  defaultCriteria: DEFAULT_CRITERIA,
  defaultAssumptions: {
    confidence: 0.95,
    power: 0.8,
    alpha: 0.05,
    sigma: 0.05,
    minimumEffect: 0.01,
    tostMargin: 0.01,
    minimumN: 10,
    sigmaFromRangeDivisor: 6,
  },
  reportSections: [
    { id: 'identification', title: 'Identificação', required: true },
    { id: 'objective', title: 'Objetivo', required: true },
    { id: 'scope', title: 'Escopo', required: true },
    { id: 'design', title: 'Delineamento', required: true },
    { id: 'data-summary', title: 'Resumo dos dados', required: true },
    { id: 'parameter-results', title: 'Resultados por parâmetro', required: true },
    { id: 'uncertainty', title: 'Incerteza de medição', required: true },
    { id: 'conformity', title: 'Conformidade e regra de decisão', required: true },
    { id: 'conclusion', title: 'Conclusão', required: true },
    { id: 'limitations', title: 'Limitações', required: false },
    { id: 'assumptions', title: 'Pressupostos', required: false },
    { id: 'references', title: 'Referências', required: false },
    { id: 'signatures', title: 'Assinaturas', required: true },
  ],
  suggestedParameters,
  defaultMethodCriteria: METHOD_CRITERIA_KEYS.map(([parameter, metric]) =>
    pickCriterion(parameter, metric),
  ).filter((criterion): criterion is AcceptanceCriterion => criterion !== null),
  sigmaFromToleranceDivisor: 6,
  defaultDesignType: 'gage_rr',
};
