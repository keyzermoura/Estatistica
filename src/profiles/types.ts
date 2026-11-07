/**
 * Contratos de perfil de método.
 *
 * Um perfil reúne o catálogo de parâmetros, os módulos de análise, os critérios
 * e pressupostos padrão, os templates de delineamento e as seções de relatório
 * de uma família de ensaios. A orquestração e as regras de veredito permanecem
 * genéricas em src/stats/analysis.ts.
 */

import type {
  AcceptanceCriterion,
  DesignInput,
  DesignType,
  MethodFamily,
  MethodType,
  ParamKey,
  ValidationType,
} from '../lib/types';
import type { AnalysisModule } from '../stats/analysis-types';

export type { MethodFamily } from '../lib/types';

export interface MetricDefinition {
  key: string;
  label: string;
  unit: string;
  suggested?: Omit<AcceptanceCriterion, 'id' | 'parameter' | 'metric'>;
}

export interface ParameterDef {
  key: ParamKey;
  label: string;
  /** Texto curto para o checklist da interface. */
  shortDescription: string;
  /** Referência normativa/bibliográfica exibida no parâmetro. */
  reference: string;
  metrics: MetricDefinition[];
  /** Entra no conjunto inicial quando o chamador não informa parâmetros. */
  defaultSelected?: boolean;
  /** Texto de justificativa usado apenas na carga de demonstração. */
  defaultJustification?: string;
}

export interface DesignTemplate {
  id: string;
  designType: DesignType;
  label: string;
  description: string;
  defaults?: Partial<DesignInput>;
}

export interface DefaultAssumptions {
  confidence: number;
  power: number;
  alpha: number;
  /** σ esperado quando não há dado piloto. */
  sigma: number;
  /** Diferença mínima detectável padrão. */
  minimumEffect: number;
  /** Margem de equivalência TOST padrão. */
  tostMargin: number;
  /** n mínimo por condição. */
  minimumN: number;
  /** Divisor da faixa para estimar σ (faixa/divisor). */
  sigmaFromRangeDivisor: number;
}

export interface ReportSectionDef {
  id: string;
  title: string;
  required?: boolean;
}

export interface MethodProfile {
  id: MethodFamily;
  label: string;
  parameters: ParameterDef[];
  designTemplates: DesignTemplate[];
  /** parameterKey -> módulo de análise do parâmetro. */
  analyses: Record<string, AnalysisModule>;
  defaultCriteria: Record<string, AcceptanceCriterion[]>;
  defaultAssumptions: DefaultAssumptions;
  reportSections: ReportSectionDef[];
  suggestedParameters: (methodType: MethodType, validationType: ValidationType) => ParamKey[];
  /** Critérios iniciais para um método criado pelo painel. */
  defaultMethodCriteria: AcceptanceCriterion[];
}
