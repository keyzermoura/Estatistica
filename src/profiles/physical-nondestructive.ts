/**
 * Perfil de método físico não destrutivo.
 *
 * A mesma peça pode ser medida por todos os operadores, então o estudo de
 * precisão é o Gage R&R cruzado (peças × operadores × réplicas), reutilizando
 * os módulos dimensionais com rótulos e referências da família física.
 *
 * Referências gerais: AIAG MSA (2010); ISO 22514-7:2021; ISO 14253-1:2017;
 * GUM/JCGM 100:2008; JCGM 106:2012; ILAC-G8:09/2019.
 */

import type { AcceptanceCriterion, ParamKey } from '../lib/types';
import type { DesignTemplate, MethodProfile } from './types';
import {
  PHYSICAL_CONFORMITY_REFERENCE,
  PHYSICAL_GUM_REFERENCE,
  PHYSICAL_MSA_REFERENCE,
  buildPhysicalCriteria,
  buildPhysicalParameters,
  pickPhysicalCriterion,
  type PhysicalParamKey,
} from './physical-common';
import {
  physicalBiasAnalysis,
  physicalConformityAnalysis,
  physicalLinearityAnalysis,
  physicalNonDestructiveRepeatabilityAnalysis,
  physicalNonDestructiveReproducibilityAnalysis,
  physicalResolutionAnalysis,
  physicalStabilityAnalysis,
  physicalUncertaintyAnalysis,
} from '../stats/parameters/physical';

const PRECISION_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO 22514-7:2021; Montgomery (2020), cap. 13';

const PARAMETERS = buildPhysicalParameters({
  labels: {
    resolution: 'Resolução',
    bias: 'Tendência',
    linearity: 'Linearidade',
    stability: 'Estabilidade',
    repeatability: 'Repetibilidade (mesma peça)',
    reproducibility: 'Reprodutibilidade (operadores)',
    uncertainty: 'Incerteza de medição',
    conformity: 'Conformidade',
  },
  short: {
    resolution:
      'Menor diferença que o sistema consegue distinguir; deve ser pequena em relação à tolerância.',
    bias:
      'Diferença entre o valor medido e o valor aceito de um padrão de referência.',
    linearity:
      'Verifica se a tendência se mantém ao longo de toda a faixa de uso.',
    stability:
      'Verifica se o sistema continua estável ao longo do tempo, usando cartas de controle.',
    repeatability:
      'Variação quando o mesmo operador mede a mesma peça várias vezes, sem consumir o corpo de prova.',
    reproducibility:
      'Variação entre operadores diferentes medindo as mesmas peças.',
    uncertainty:
      'Faixa provável do resultado, combinando todas as fontes de incerteza (GUM).',
    conformity:
      'Decide se o resultado atende à tolerância, declarando a regra de decisão e o risco.',
  },
  references: {
    resolution: PHYSICAL_MSA_REFERENCE,
    bias: PHYSICAL_MSA_REFERENCE,
    linearity: PHYSICAL_MSA_REFERENCE,
    stability: PHYSICAL_MSA_REFERENCE,
    repeatability: PRECISION_REFERENCE,
    reproducibility: PRECISION_REFERENCE,
    uncertainty: PHYSICAL_GUM_REFERENCE,
    conformity: PHYSICAL_CONFORMITY_REFERENCE,
  },
  defaultSelected: [
    'repeatability',
    'reproducibility',
    'uncertainty',
    'conformity',
  ],
  justifications: {
    repeatability:
      'Estudo Gage R&R cruzado com peças reutilizadas; a mesma peça é medida várias vezes.',
    reproducibility:
      'Estudo Gage R&R cruzado com os mesmos operadores e as mesmas peças.',
    uncertainty:
      'Orçamento GUM com as fontes do ensaio físico; valores-modelo substituídos pelos certificados e pelo estudo de precisão.',
    conformity:
      'Regra de decisão e limites efetivos declarados antes da medição.',
  },
});

const DEFAULT_CRITERIA = buildPhysicalCriteria(PARAMETERS);

const METHOD_CRITERIA_KEYS: Array<[PhysicalParamKey, string]> = [
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
      'Peças reutilizadas, medidas por todos os operadores, com réplicas independentes e ordem de execução aleatorizada pela semente. Não há consumo de corpos de prova.',
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
  return ['repeatability', 'reproducibility', 'uncertainty', 'conformity'];
}

export const PHYSICAL_NONDESTRUCTIVE_PROFILE: MethodProfile = {
  id: 'physical-nondestructive',
  label: 'Ensaio físico não destrutivo',
  parameters: PARAMETERS,
  designTemplates: DESIGN_TEMPLATES,
  analyses: {
    resolution: physicalResolutionAnalysis,
    bias: physicalBiasAnalysis,
    linearity: physicalLinearityAnalysis,
    stability: physicalStabilityAnalysis,
    repeatability: physicalNonDestructiveRepeatabilityAnalysis,
    reproducibility: physicalNonDestructiveReproducibilityAnalysis,
    uncertainty: physicalUncertaintyAnalysis,
    conformity: physicalConformityAnalysis,
  },
  defaultCriteria: DEFAULT_CRITERIA,
  defaultAssumptions: {
    confidence: 0.95,
    power: 0.8,
    alpha: 0.05,
    sigma: 0.5,
    minimumEffect: 0.5,
    tostMargin: 0.5,
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
    pickPhysicalCriterion(DEFAULT_CRITERIA, parameter, metric),
  ).filter((criterion): criterion is AcceptanceCriterion => criterion !== null),
  sigmaFromToleranceDivisor: 6,
  defaultDesignType: 'gage_rr',
};
