/**
 * Perfil de método analítico.
 *
 * Este arquivo é a única fonte dos rótulos, descrições, referências, métricas,
 * critérios padrão e pressupostos dos parâmetros analíticos. O motor estatístico
 * e a interface consultam o perfil ativo em vez de repetir esse catálogo.
 *
 * Referências gerais: ISO/IEC 17025:2017; ICH Q2(R2); ISO 5725; GUM.
 */

import type { AcceptanceCriterion, ParamKey } from '../lib/types';
import { makeCriterion } from '../lib/criteria';
import type {
  DesignTemplate,
  MethodProfile,
  MetricDefinition,
  ParameterDef,
} from './types';
import { selectivityAnalysis } from '../stats/parameters/selectivity';
import { linearityAnalysis } from '../stats/parameters/linearity';
import { workingRangeAnalysis } from '../stats/parameters/workingRange';
import { lodLoqAnalysis } from '../stats/parameters/lodLoq';
import { makePrecisionAnalysis } from '../stats/parameters/precision';
import { reproducibilityAnalysis } from '../stats/parameters/reproducibility';
import { accuracyAnalysisModule } from '../stats/parameters/accuracy';
import { robustnessAnalysis } from '../stats/parameters/robustness';
import { uncertaintyAnalysis } from '../stats/parameters/uncertainty';

const METRICS: Record<ParamKey, MetricDefinition[]> = {
  selectivity: [
    { key: 'interferenceRecovery', label: 'Recuperação na presença de interferente', unit: '%', suggested: { operator: 'between', limit: 90, limit2: 110 } },
    { key: 'resolution', label: 'Resolução crítica', unit: '', suggested: { operator: '>=', limit: 1.5 } },
  ],
  linearity: [
    { key: 'r2', label: 'Coeficiente de determinação (R²)', unit: '', suggested: { operator: '>=', limit: 0.99 } },
    { key: 'lackOfFitP', label: 'p do teste de falta de ajuste', unit: '', suggested: { operator: '>=', limit: 0.05 } },
    { key: 'slopeP', label: 'p do declive', unit: '', suggested: { operator: '<=', limit: 0.05 } },
  ],
  working_range: [
    { key: 'rangeMin', label: 'Limite inferior da faixa', unit: '', suggested: { operator: '<=', limit: 0 } },
    { key: 'rangeMax', label: 'Limite superior da faixa', unit: '', suggested: { operator: '>=', limit: 0 } },
  ],
  lod_loq: [
    { key: 'lod', label: 'Limite de detecção (LD)', unit: '', suggested: { operator: '<=', limit: 0 } },
    { key: 'loq', label: 'Limite de quantificação (LQ)', unit: '', suggested: { operator: '<=', limit: 0 } },
    { key: 'snr', label: 'Relação sinal/ruído', unit: '', suggested: { operator: '>=', limit: 10 } },
  ],
  repeatability: [
    { key: 'cv', label: 'Coeficiente de variação', unit: '%', suggested: { operator: '<=', limit: 2 } },
    { key: 'sr', label: 'Desvio-padrão de repetibilidade', unit: '', suggested: { operator: '<=', limit: 0 } },
  ],
  intermediate_precision: [
    { key: 'cv', label: 'Coeficiente de variação', unit: '%', suggested: { operator: '<=', limit: 5 } },
    { key: 'sd', label: 'Desvio-padrão intermediário', unit: '', suggested: { operator: '<=', limit: 0 } },
  ],
  reproducibility: [
    { key: 'cvR', label: 'Coeficiente de variação de reprodutibilidade', unit: '%', suggested: { operator: '<=', limit: 10 } },
    { key: 'sR', label: 'Desvio-padrão de reprodutibilidade', unit: '', suggested: { operator: '<=', limit: 0 } },
  ],
  accuracy: [
    { key: 'recovery', label: 'Recuperação média', unit: '%', suggested: { operator: 'between', limit: 98, limit2: 102 } },
    { key: 'bias', label: 'Tendência (diferença média)', unit: '', suggested: { operator: 'between', limit: -1, limit2: 1 } },
    { key: 'biasP', label: 'p do teste de tendência', unit: '', suggested: { operator: '>=', limit: 0.05 } },
  ],
  robustness: [
    { key: 'maxEffect', label: 'Maior efeito padronizado', unit: '', suggested: { operator: '<=', limit: 2 } },
    { key: 'criticalFactorP', label: 'p do fator crítico', unit: '', suggested: { operator: '>=', limit: 0.05 } },
  ],
  uncertainty: [
    { key: 'relativeExpanded', label: 'Incerteza expandida relativa', unit: '%', suggested: { operator: '<=', limit: 5 } },
    { key: 'expanded', label: 'Incerteza expandida', unit: '', suggested: { operator: '<=', limit: 0 } },
  ],
};

const LABELS: Record<ParamKey, string> = {
  selectivity: 'Seletividade / especificidade',
  linearity: 'Linearidade',
  working_range: 'Faixa de trabalho',
  lod_loq: 'Limites de detecção e quantificação (LD/LQ)',
  repeatability: 'Repetibilidade',
  intermediate_precision: 'Precisão intermediária',
  reproducibility: 'Reprodutibilidade',
  accuracy: 'Exatidão / tendência',
  robustness: 'Robustez',
  uncertainty: 'Incerteza de medição',
};

const SHORT: Record<ParamKey, string> = {
  selectivity: 'Demonstra que o método mede o analito sem interferentes.',
  linearity: 'Verifica se a resposta é proporcional à concentração.',
  working_range: 'Define a faixa em que o método é válido.',
  lod_loq: 'Menor quantidade detectável e quantificável com confiança.',
  repeatability: 'Variação entre réplicas no mesmo laboratório, analista e dia.',
  intermediate_precision: 'Variação por analista, dia ou equipamento no mesmo laboratório.',
  reproducibility: 'Variação entre laboratórios diferentes.',
  accuracy: 'Grau de concordância com o valor de referência ou recuperação.',
  robustness: 'Capacidade de resistir a pequenas mudanças de condições.',
  uncertainty: 'Faixa de valores provável para o resultado, conforme GUM.',
};

const REFERENCES: Record<ParamKey, string> = {
  selectivity: 'ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2); EURACHEM',
  linearity: 'ISO/IEC 17025:2017, 7.2.2; ISO 8466-1; ICH Q2(R2)',
  working_range: 'ISO/IEC 17025:2017, 7.2.2; ICH Q2(R2)',
  lod_loq: 'ISO 11843; IUPAC; ICH Q2(R2)',
  repeatability: 'ISO 5725-2:2019; ISO/IEC 17025:2017, 7.2.2',
  intermediate_precision: 'ISO 5725-3; ISO/IEC 17025:2017, 7.2.2',
  reproducibility: 'ISO 5725-1/2; ISO/IEC 17025:2017, 7.2.2',
  accuracy: 'ISO 5725-1/4; ISO 17043; ISO 13528; EURACHEM',
  robustness: 'ICH Q2(R2); Youden; ISO/IEC 17025:2017, 7.2.2',
  uncertainty: 'GUM / JCGM 100:2008; ISO/IEC 17025:2017, 7.6',
};

const DEFAULT_SELECTED = new Set<ParamKey>([
  'selectivity',
  'linearity',
  'working_range',
  'lod_loq',
  'repeatability',
  'intermediate_precision',
  'accuracy',
  'uncertainty',
]);

const PARAMETERS: ParameterDef[] = (Object.keys(LABELS) as ParamKey[]).map((key) => ({
  key,
  label: LABELS[key],
  shortDescription: SHORT[key],
  reference: REFERENCES[key],
  metrics: METRICS[key],
  defaultSelected: DEFAULT_SELECTED.has(key),
  defaultJustification:
    key === 'selectivity'
      ? 'Avaliada por cromatogramas de branco e amostra fortificada; ver relatório.'
      : key === 'lod_loq'
        ? 'Limites estimados pela curva e confirmados com brancos.'
        : '',
}));

function buildDefaultCriteria(): Record<string, AcceptanceCriterion[]> {
  const result: Record<string, AcceptanceCriterion[]> = {};
  for (const parameter of PARAMETERS) {
    const first = parameter.metrics.find((metric) => metric.suggested);
    result[parameter.key] = first
      ? [makeCriterion(parameter.key, first, `${parameter.key}-0`)]
      : [];
  }
  return result;
}

const DEFAULT_CRITERIA = buildDefaultCriteria();

const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'crd',
    designType: 'crd',
    label: 'Totalmente aleatorizado (CRD)',
    description: 'Um fator, execuções inteiramente aleatorizadas.',
  },
  {
    id: 'rbd',
    designType: 'rbd',
    label: 'Blocos aleatorizados (RBD)',
    description: 'Blocos (por exemplo, dias) com tratamentos dentro de cada bloco.',
  },
  {
    id: 'factorial',
    designType: 'factorial',
    label: 'Fatorial 2^k (robustez)',
    description: 'Dois ou mais fatores em dois níveis, com réplicas.',
  },
  {
    id: 'crossed',
    designType: 'crossed',
    label: 'Cruzado (analista × dia × equipamento)',
    description: 'Todas as combinações de analista, dia e equipamento.',
  },
  {
    id: 'nested',
    designType: 'nested',
    label: 'Aninhado / hierárquico (lote → amostra → réplica)',
    description: 'Amostras dentro de lotes e réplicas dentro de amostras.',
  },
  {
    id: 'nested_destructive',
    designType: 'nested_destructive',
    label: 'Aninhado destrutivo (operador → amostra → corpo de prova)',
    description:
      'Cada corpo de prova é medido uma única vez; amostras aninhadas em operadores e homogeneidade do lote verificada.',
  },
  {
    id: 'iso5725',
    designType: 'iso5725',
    label: 'ISO 5725-2 (p laboratórios × n réplicas × q níveis)',
    description: 'Experimento interlaboratorial para precisão e reprodutibilidade.',
  },
  {
    id: 'attribute_agreement',
    designType: 'attribute_agreement',
    label: 'Concordância de atributo (amostras × avaliadores × réplicas)',
    description:
      'Amostras com referência conhecida, incluindo itens limítrofes; ordem e códigos cegados pela semente.',
    defaults: {
      nAnalysts: 3,
      nReplicates: 3,
      nSamples: 30,
      nBorderlineSamples: 6,
    },
  },
];

function suggestedParameters(
  methodType: import('../lib/types').MethodType,
  validationType: import('../lib/types').ValidationType,
): ParamKey[] {
  if (validationType === 'verification') {
    return ['selectivity', 'repeatability', 'intermediate_precision', 'accuracy', 'uncertainty'];
  }
  if (methodType === 'qualitative') {
    return ['selectivity', 'repeatability', 'intermediate_precision', 'robustness'];
  }
  if (methodType === 'microbiological') {
    return ['selectivity', 'repeatability', 'intermediate_precision', 'accuracy', 'uncertainty'];
  }
  if (methodType === 'dimensional') {
    return ['repeatability', 'intermediate_precision', 'accuracy', 'linearity', 'uncertainty'];
  }
  return [
    'selectivity',
    'linearity',
    'working_range',
    'lod_loq',
    'repeatability',
    'intermediate_precision',
    'accuracy',
    'uncertainty',
  ];
}

export const ANALYTICAL_PROFILE: MethodProfile = {
  id: 'analytical',
  label: 'Método analítico quantitativo / qualitativo',
  parameters: PARAMETERS,
  designTemplates: DESIGN_TEMPLATES,
  analyses: {
    selectivity: selectivityAnalysis,
    linearity: linearityAnalysis,
    working_range: workingRangeAnalysis,
    lod_loq: lodLoqAnalysis,
    repeatability: makePrecisionAnalysis('repeatability'),
    intermediate_precision: makePrecisionAnalysis('intermediate_precision'),
    reproducibility: reproducibilityAnalysis,
    accuracy: accuracyAnalysisModule,
    robustness: robustnessAnalysis,
    uncertainty: uncertaintyAnalysis,
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
    { id: 'parameter-results', title: 'Resultados por parâmetro', required: true },
    { id: 'uncertainty', title: 'Incerteza de medição', required: true },
    { id: 'conclusion', title: 'Conclusão', required: true },
    { id: 'limitations', title: 'Limitações', required: false },
    { id: 'assumptions', title: 'Pressupostos', required: false },
    { id: 'references', title: 'Referências', required: false },
    { id: 'signatures', title: 'Assinaturas', required: true },
  ],
  suggestedParameters,
  defaultMethodCriteria: [
    ...DEFAULT_CRITERIA.linearity,
    ...DEFAULT_CRITERIA.accuracy,
    ...DEFAULT_CRITERIA.repeatability,
    ...DEFAULT_CRITERIA.uncertainty,
  ],
};
