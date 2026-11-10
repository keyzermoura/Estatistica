/**
 * Contratos de saída da análise estatística.
 *
 * Separados da orquestração e dos perfis para permitir que novos módulos de
 * análise (dimensional, físico, atributo) reutilizem a mesma estrutura de
 * resultado sem acoplar o motor a um perfil específico.
 */

import type {
  AcceptanceCriterion,
  Measurement,
  ParamKey,
  ParameterPlan,
  UncertaintyItem,
  Verdict,
} from '../lib/types';
import type { DescriptiveStats } from './descriptive';
import type { AnovaResult } from './anova';
import type { Iso5725Result } from './iso5725';
import type { RegressionResult } from './regression';
import type { NormalityResult } from './normality';
import type { HomogeneityResult } from './variance';
import type { UncertaintyResult } from './uncertainty';
import type { ConformityCriteria, ConformityRule } from './conformity';

export interface AnalysisMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  verdict: Verdict;
  criterionText: string;
  formula?: string;
  reference?: string;
}

export interface AnalysisTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  note?: string;
}

export interface AnalysisChart {
  kind: 'scatter' | 'residual' | 'line' | 'box' | 'bar' | 'power';
  title: string;
  xLabel?: string;
  yLabel?: string;
  data: Array<Record<string, string | number | null>>;
}

export interface ParameterAnalysis {
  key: ParamKey;
  label: string;
  n: number;
  verdict: Verdict;
  summary: string;
  metrics: AnalysisMetric[];
  rawMetrics: Record<string, number | null>;
  tables: AnalysisTable[];
  charts: AnalysisChart[];
  warnings: string[];
  notes: string[];
  reference: string;
  results: Record<string, unknown>;
}

export interface QcSummary {
  descriptive: DescriptiveStats;
  byLevel: Array<{ group: string; stats: DescriptiveStats }>;
  byAnalyst: Array<{ group: string; stats: DescriptiveStats }>;
  byDay: Array<{ group: string; stats: DescriptiveStats }>;
  byEquipment: Array<{ group: string; stats: DescriptiveStats }>;
  outliers: ReturnType<typeof import('./outliers').grubbsTest> | null;
  normality: NormalityResult | null;
  normalitySuite: ReturnType<typeof import('./normality').normalitySuite> | null;
  homogeneity: HomogeneityResult | null;
  homogeneitySuite: ReturnType<typeof import('./variance').homogeneitySuite> | null;
  anova: AnovaResult | null;
  iso5725: Iso5725Result | null;
  regression: RegressionResult | null;
  bias: ReturnType<typeof import('./bias').biasTest> | null;
  recovery: ReturnType<typeof import('./bias').recoveryTest> | null;
  tost: ReturnType<typeof import('./bias').tost> | null;
  uncertainty: UncertaintyResult | null;
  residualChart: AnalysisChart | null;
  calibrationChart: AnalysisChart | null;
}

export interface ValidationAnalysis {
  nTotal: number;
  nUsed: number;
  overallVerdict: Verdict;
  parameters: ParameterAnalysis[];
  qc: QcSummary;
  warnings: string[];
  assumptions: string[];
  generatedAt: string;
}

export interface AnalysisOptions {
  alpha?: number;
  confidence?: number;
  margin?: number;
  plans?: ParameterPlan[];
  uncertaintyItems?: UncertaintyItem[];
  rangeMin?: number | null;
  rangeMax?: number | null;
  /** Perfil de método ativo. Ausente = perfil analítico. */
  profileId?: string;
  /** Limite inferior de tolerância (dimensional). */
  lsl?: number | null;
  /** Limite superior de tolerância (dimensional). */
  usl?: number | null;
  /** Menor incremento distinguível do sistema de medição. */
  resolution?: number | null;
  /** Unidade do mensurando, usada apenas para exibição. */
  unit?: string;
  /** Variação do processo (6σ), quando conhecida. */
  processVariation?: number | null;
  /** Regra de decisão de conformidade e dados do valor medido. */
  conformity?: DimensionalConformityOptions;
}

/** Parâmetros da avaliação de conformidade do perfil dimensional. */
export interface DimensionalConformityOptions {
  rule?: ConformityRule;
  /** Fator de abrangência k; U = k·u. Padrão 2. */
  coverageFactor?: number;
  /** r em w = r·U (regra de banda de guarda). */
  guardBandFactor?: number;
  /** Limiar de probabilidade (regra de probabilidade). */
  probabilityThreshold?: number;
  /** Limiares de alerta e de decisão editáveis. */
  criteria?: Partial<ConformityCriteria>;
  /** Valor medido; ausente = média das medições de peças. */
  value?: number | null;
  /** Incerteza-padrão; ausente = incerteza combinada do orçamento GUM. */
  standardUncertainty?: number | null;
  /** Limites que sobrepõem `lsl`/`usl` globais. */
  lsl?: number | null;
  usl?: number | null;
}

/**
 * Dados globais calculados uma única vez por validação e compartilhados pelos
 * módulos de análise de cada parâmetro.
 */
export interface AnalysisContext {
  used: Measurement[];
  values: number[];
  options: AnalysisOptions;
  uniqueLevels: number[];
  regressionPoints: Array<{ x: number; y: number }>;
  regression: RegressionResult | null;
  iso5725: Iso5725Result | null;
  uncertaintyItems: UncertaintyItem[];
  observedMean: number | null;
}

export interface AnalysisModuleInput {
  parameter: import('../profiles/types').ParameterDef;
  criteria: AcceptanceCriterion[];
  context: AnalysisContext;
}

export type AnalysisModule = (input: AnalysisModuleInput) => ParameterAnalysis;
