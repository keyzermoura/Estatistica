/**
 * Perfil de método de atributo (qualitativo).
 *
 * Reúne o catálogo de parâmetros, os critérios padrão editáveis, os módulos de
 * análise e o template de concordância da família de atributo. Os cálculos
 * ficam em `src/stats/attribute.ts`; a ponte com as medições e os adaptadores
 * ficam em `src/stats/attribute-data.ts` e `src/stats/parameters/attribute.ts`.
 *
 * Referências gerais: AIAG MSA (2010), 4. ed.; Cohen (1960); Fleiss (1971);
 * ISO 5725-2:2019; ISO/IEC 17025:2017, 7.2.2.
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
  attributeAccuracyAnalysis,
  attributeIntermediatePrecisionAnalysis,
  attributeRepeatabilityAnalysis,
} from '../stats/parameters/attribute';

type AttributeParamKey = 'accuracy' | 'repeatability' | 'intermediate_precision';

const AIAG_REFERENCE =
  'AIAG MSA (2010), 4. ed.; Cohen (1960); Fleiss (1971); ISO 5725-2:2019';
const ACCURACY_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO/IEC 17025:2017, 7.2.2; Cohen (1960); Fleiss (1971)';
const PRECISION_REFERENCE =
  'AIAG MSA (2010), 4. ed.; ISO 5725-2:2019; Fleiss (1971)';

const KAPPA_SUGGESTED = {
  operator: '>=' as const,
  limit: 0.75,
  limit2: 0.4,
  unit: '',
};

const METRICS: Record<AttributeParamKey, MetricDefinition[]> = {
  accuracy: [
    {
      key: 'kappa_reference',
      label: 'Kappa com a referência (pior avaliador)',
      unit: '',
      suggested: KAPPA_SUGGESTED,
    },
    {
      key: 'effectiveness',
      label: 'Eficácia (pior avaliador)',
      unit: '',
      suggested: { operator: '>=', limit: 0.9, unit: '' },
    },
    {
      key: 'far',
      label: 'Taxa de falso aceite (FAR, pior avaliador)',
      unit: '',
      suggested: { operator: '<=', limit: 0.1, unit: '' },
    },
    {
      key: 'frr',
      label: 'Taxa de falso rejeite (FRR, pior avaliador)',
      unit: '',
      suggested: { operator: '<=', limit: 0.1, unit: '' },
    },
    {
      key: 'reference_coverage',
      label: 'Cobertura de referência conhecida',
      unit: '%',
      suggested: { operator: '>=', limit: 100, unit: '%' },
    },
  ],
  repeatability: [
    {
      key: 'kappa_intra',
      label: 'Kappa intra-avaliador (pior avaliador)',
      unit: '',
      suggested: KAPPA_SUGGESTED,
    },
    {
      key: 'po_intra',
      label: 'Concordância observada intra-avaliador (pior avaliador)',
      unit: '',
    },
  ],
  intermediate_precision: [
    {
      key: 'kappa_inter',
      label: 'Kappa interavaliadores',
      unit: '',
      suggested: KAPPA_SUGGESTED,
    },
    {
      key: 'po_inter',
      label: 'Concordância observada interavaliadores',
      unit: '',
    },
  ],
};

const LABELS: Record<AttributeParamKey, string> = {
  accuracy: 'Exatidão / concordância com a referência',
  repeatability: 'Repetibilidade (concordância intra-avaliador)',
  intermediate_precision: 'Precisão intermediária (concordância entre avaliadores)',
};

const SHORT: Record<AttributeParamKey, string> = {
  accuracy:
    'Compara a classificação do avaliador com a referência conhecida; mede acertos, falsos aceites e falsos rejeites.',
  repeatability:
    'Verifica se o mesmo avaliador classifica o mesmo item da mesma forma em réplicas independentes.',
  intermediate_precision:
    'Verifica se avaliadores diferentes concordam entre si ao classificar os mesmos itens.',
};

const REFERENCES: Record<AttributeParamKey, string> = {
  accuracy: ACCURACY_REFERENCE,
  repeatability: PRECISION_REFERENCE,
  intermediate_precision: PRECISION_REFERENCE,
};

const PARAMETERS: ParameterDef[] = (
  Object.keys(LABELS) as AttributeParamKey[]
).map((key) => ({
  key,
  label: LABELS[key],
  shortDescription: SHORT[key],
  reference: REFERENCES[key],
  metrics: METRICS[key],
  defaultSelected: true,
  defaultJustification:
    key === 'accuracy'
      ? 'Itens com referência conhecida, incluindo casos limítrofes; FAR/FRR dependem de categorias de aceitação reconhecidas.'
      : key === 'repeatability'
        ? 'Réplicas independentes do mesmo item, sem acesso à referência.'
        : 'Todos os avaliadores classificam todos os itens, com ordem e códigos cegados.',
}));

/** Métrica κ que representa cada parâmetro no conjunto inicial de critérios. */
const KAPPA_KEY: Record<AttributeParamKey, string> = {
  accuracy: 'kappa_reference',
  repeatability: 'kappa_intra',
  intermediate_precision: 'kappa_inter',
};

/**
 * Os critérios iniciais usam apenas κ. Eficácia, FAR, FRR e cobertura têm
 * valores sugeridos no catálogo de métricas, mas não são aplicados sem uma
 * decisão explícita do laboratório.
 */
function buildDefaultCriteria(): Record<string, AcceptanceCriterion[]> {
  const result: Record<string, AcceptanceCriterion[]> = {};
  for (const parameter of PARAMETERS) {
    const metric = parameter.metrics.find(
      (definition) => definition.key === KAPPA_KEY[parameter.key as AttributeParamKey],
    );
    result[parameter.key] = metric
      ? [makeCriterion(parameter.key, metric, `${parameter.key}-kappa`)]
      : [];
  }
  return result;
}

const DEFAULT_CRITERIA = buildDefaultCriteria();

const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'attribute_agreement',
    designType: 'attribute_agreement',
    label: 'Concordância de atributo (itens × avaliadores × réplicas)',
    description:
      'Cada avaliador classifica todos os itens sem conhecer a referência; a ordem e os códigos são aleatorizados pela semente. Inclua itens limítrofes e casos claros de cada categoria.',
    defaults: {
      designType: 'attribute_agreement',
      nSamples: 30,
      nAnalysts: 3,
      nReplicates: 3,
      nBorderlineSamples: 6,
      nLevels: 2,
      levels: ['conforme', 'não conforme'],
    },
  },
];

function suggestedParameters(): ParamKey[] {
  return ['accuracy', 'repeatability', 'intermediate_precision'];
}

export const ATTRIBUTE_PROFILE: MethodProfile = {
  id: 'attribute',
  label: 'Método de atributo (qualitativo)',
  parameters: PARAMETERS,
  designTemplates: DESIGN_TEMPLATES,
  analyses: {
    accuracy: attributeAccuracyAnalysis,
    repeatability: attributeRepeatabilityAnalysis,
    intermediate_precision: attributeIntermediatePrecisionAnalysis,
  },
  defaultCriteria: DEFAULT_CRITERIA,
  defaultAssumptions: {
    confidence: 0.95,
    power: 0.8,
    alpha: 0.05,
    sigma: 0.5,
    minimumEffect: 0.5,
    tostMargin: 0.5,
    minimumN: 3,
    sigmaFromRangeDivisor: 6,
  },
  reportSections: [
    { id: 'identification', title: 'Identificação', required: true },
    { id: 'objective', title: 'Objetivo', required: true },
    { id: 'scope', title: 'Escopo', required: true },
    { id: 'design', title: 'Delineamento', required: true },
    { id: 'data-summary', title: 'Resumo dos dados', required: true },
    {
      id: 'attribute-agreement',
      title: 'Concordância de atributo',
      required: true,
    },
    {
      id: 'parameter-results',
      title: 'Resultados por parâmetro',
      required: true,
    },
    { id: 'conclusion', title: 'Conclusão', required: true },
    { id: 'limitations', title: 'Limitações', required: false },
    { id: 'assumptions', title: 'Pressupostos', required: false },
    { id: 'references', title: 'Referências', required: false },
    { id: 'signatures', title: 'Assinaturas', required: true },
  ],
  suggestedParameters,
  defaultMethodCriteria: PARAMETERS.map(
    (parameter) => DEFAULT_CRITERIA[parameter.key]?.[0],
  ).filter((criterion): criterion is AcceptanceCriterion => Boolean(criterion)),
  sigmaFromToleranceDivisor: 6,
  defaultDesignType: 'attribute_agreement',
};

/** Referência comum do perfil, usada em notas de interface. */
export const ATTRIBUTE_PROFILE_REFERENCE = AIAG_REFERENCE;
