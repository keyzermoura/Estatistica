/**
 * Modelo de dados do ValidaMétodo.
 * Mantido em um único arquivo para servir de contrato entre UI, estatística,
 * persistência e geração de relatórios.
 */

export type MethodType =
  | 'quantitative'
  | 'qualitative'
  | 'dimensional'
  | 'microbiological'
  | 'other';

/**
 * Famílias de ensaio suportadas pelo modelo de dados.
 *
 * A família determina o perfil estatístico aplicado à validação. Métodos
 * criados antes da migração v2 são lidos como `analytical`.
 */
export type MethodFamily =
  | 'analytical'
  | 'dimensional'
  | 'physical-destructive'
  | 'physical-nondestructive'
  | 'attribute';

export const METHOD_FAMILY_VALUES: MethodFamily[] = [
  'analytical',
  'dimensional',
  'physical-destructive',
  'physical-nondestructive',
  'attribute',
];

export type ValidationType = 'full' | 'partial' | 'verification';

export type ValidationStatus =
  | 'draft'
  | 'in_progress'
  | 'in_review'
  | 'approved'
  | 'rejected';

export type ParamKey =
  | 'selectivity'
  | 'linearity'
  | 'working_range'
  | 'lod_loq'
  | 'repeatability'
  | 'intermediate_precision'
  | 'reproducibility'
  | 'accuracy'
  | 'robustness'
  | 'uncertainty'
  // Parâmetros do perfil dimensional (Prompt 8). `linearity`, `repeatability`,
  // `reproducibility` e `uncertainty` são compartilhados com o perfil analítico.
  | 'resolution'
  | 'bias'
  | 'stability'
  | 'conformity';

export type DesignType =
  | 'crd'
  | 'rbd'
  | 'factorial'
  | 'crossed'
  | 'nested'
  | 'nested_destructive'
  | 'iso5725'
  | 'attribute_agreement'
  /** Gage R&R cruzado: peças × operadores × réplicas (Prompt 8). */
  | 'gage_rr';

export type SampleSizeMethod =
  | 'mean_ci'
  | 't_test'
  | 'tost'
  | 'variance_ratio'
  | 'anova'
  | 'relative_sd'
  | 'iso5725'
  | 'nested'
  | 'lod'
  | 'linearity'
  | 'guideline'
  | 'attribute_agreement';

export type CriterionOperator = '>=' | '<=' | 'between';

export interface AcceptanceCriterion {
  id: string;
  parameter: ParamKey;
  metric: string;
  operator: CriterionOperator;
  limit: number;
  limit2?: number;
  unit?: string;
  note?: string;
}

export interface Method {
  id: string;
  code: string;
  name: string;
  type: MethodType;
  /** Família estatística do ensaio; padrão `analytical`. */
  family: MethodFamily;
  unit: string;
  rangeMin: number | null;
  rangeMax: number | null;
  /** Limite inferior de tolerância (LSL), quando aplicável. */
  lsl: number | null;
  /** Limite superior de tolerância (USL), quando aplicável. */
  usl: number | null;
  /** Menor incremento distinguível do sistema de medição. */
  resolution: number | null;
  /** Grandeza medida (mensurando) descrita no relatório. */
  measurand: string;
  /** Unidade dos limites de tolerância. */
  toleranceUnit: string;
  equipment: string;
  referenceNorm: string;
  validationType: ValidationType;
  description: string;
  criteria: AcceptanceCriterion[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportConfig {
  laboratoryName: string;
  laboratoryAddress: string;
  accreditation: string;
  logoDataUrl: string;
  reportTitle: string;
  templateIntro: string;
  templateFooter: string;
  showRawData: boolean;
  showFormulas: boolean;
  showCharts: boolean;
  version: string;
  conformityRule?: 'simple_acceptance' | 'guard_band' | 'probability';
  guardBandFactor?: number;
  probabilityThreshold?: number;
  processVariation?: number | null;
  individualLsl?: number | null;
  /** Habilita a verificação de homogeneidade do lote no ensaio destrutivo. */
  homogeneityCheck?: boolean;
  /** Justificativa técnica quando a homogeneidade do lote é rejeitada. */
  homogeneityJustification?: string;
}

export interface Validation {
  id: string;
  methodId: string;
  title: string;
  objective: string;
  scope: string;
  status: ValidationStatus;
  currentStep: number;
  version: number;
  responsible: string;
  reviewer: string;
  approver: string;
  approvedAt: string | null;
  locked: boolean;
  reportConfig: ReportConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationParameter {
  validationId: string;
  key: ParamKey;
  selected: boolean;
  justification: string;
  criteria: AcceptanceCriterion[];
}

export interface DesignInput {
  designType: DesignType;
  confidence: number;
  power: number;
  alpha: number;
  beta: number;
  sigma: number;
  /** Origem do σ (dado piloto, T/6, manual); registrada nos pressupostos. */
  sigmaSource?: string;
  effect: number;
  margin: number;
  targetPrecision: number;
  relativeSdError: number;
  varianceRatio: number;
  betweenLabRatio: number;
  nLevels: number;
  nAnalysts: number;
  nDays: number;
  nEquipments: number;
  nLots: number;
  nReplicates: number;
  nLabs: number;
  nSamples: number;
  /** Amostras limítrofes incluídas no total de amostras (atributo). */
  nBorderlineSamples: number;
  factors: string[];
  levels: string[];
  seed: number;
  manualTotal: number | null;
  manualOverride: boolean;
  notes: string;
}

export interface ParameterPlan {
  key: ParamKey;
  method: SampleSizeMethod;
  n: number;
  nPerGroup: number | null;
  groups: number | null;
  total: number;
  achievedPower: number | null;
  achievedPrecision: number | null;
  formula: string;
  reference: string;
  assumptions: string[];
  notes: string[];
}

export interface PowerPoint {
  n: number;
  power: number;
  precision: number | null;
}

export interface RunRow {
  runOrder: number;
  level: string;
  analyst: string;
  day: string;
  equipment: string;
  lot: string;
  sample: string;
  replicate: number;
  /** Peça/parte do estudo Gage R&R (delineamento dimensional). */
  partId?: string;
  /** Identificação do corpo de prova em delineamentos destrutivos. */
  specimen?: string;
  /** Marca a linha como ensaio destrutivo (corpo de prova consumido). */
  destructive?: boolean;
  combination: string;
  factorValues: Record<string, string>;
}

export interface DesignPlan {
  input: DesignInput;
  parameterPlans: ParameterPlan[];
  recommended: {
    total: number;
    analysts: number;
    days: number;
    equipments: number;
    replicates: number;
    labs: number;
    levels: number;
    samples: number;
    /** Amostras limítrofes no delineamento de concordância de atributo. */
    borderlineSamples?: number;
  };
  runs: RunRow[];
  powerCurve: PowerPoint[];
  summary: string;
  assumptions: string[];
  warnings: string[];
  /** Plano de consumo de corpos de prova em delineamentos destrutivos. */
  specimenConsumption?: {
    operators: number;
    samplesPerOperator: number;
    replicates: number;
    total: number;
  };
  createdAt: string;
}

export interface DesignRecord {
  id: string;
  validationId: string;
  input: DesignInput;
  plan: DesignPlan;
  seed: number;
  createdAt: string;
}

/** Condições ambientais/operacionais registradas por medição. */
export interface MeasurementCondition {
  temperature: number | null;
  humidity: number | null;
  testSpeed: number | null;
  other: string;
}

export interface Measurement {
  id: string;
  validationId: string;
  runOrder: number;
  level: string;
  analyst: string;
  day: string;
  equipment: string;
  lot: string;
  sample: string;
  /** Identificação da peça/parte para ensaios dimensionais. */
  partId?: string;
  /** Corpo de prova individual em ensaios destrutivos. */
  specimen?: string;
  /** 1/0 no banco; `true` quando o corpo de prova é consumido. */
  destructive?: boolean;
  /** Condições de ensaio; serializadas em `condition_json`. */
  condition?: MeasurementCondition | null;
  /** Valor aceito do padrão de referência (distinto de `referenceValue`). */
  refValue?: number | null;
  /** Incerteza expandida declarada para o padrão de referência. */
  refUncertainty?: number | null;
  /** Categoria observada em ensaios de atributo. */
  category?: string;
  replicate: number;
  value: number | null;
  referenceValue?: number | null;
  textValue: string;
  notes: string;
}

export interface AnalysisRecord {
  id: string;
  validationId: string;
  parameterKey: ParamKey | 'global';
  kind: string;
  inputHash: string;
  results: Record<string, unknown>;
  createdAt: string;
}

export type UncertaintyType = 'A' | 'B';
export type UncertaintyDistribution =
  | 'normal'
  | 'rectangular'
  | 'triangular'
  | 'u_shaped'
  | 'none';

export interface UncertaintyItem {
  id: string;
  validationId: string;
  source: string;
  type: UncertaintyType;
  distribution: UncertaintyDistribution;
  value: number;
  divisor: number;
  sensitivity: number;
  stdUncertainty: number;
  dof: number | null;
  notes: string;
}

export interface ReportSignature {
  role: 'elaboration' | 'review' | 'approval';
  name: string;
  date: string | null;
  signed: boolean;
  roleTitle?: string;
  meaning?: string;
  signatureDigest?: string;
}

export interface ReportContent {
  title: string;
  subtitle: string;
  laboratory: {
    name: string;
    address: string;
    accreditation: string;
    logoDataUrl: string;
  };
  method: {
    name: string;
    code: string;
    type: string;
    unit: string;
    range: string;
    equipment: string;
    referenceNorm: string;
    validationType: string;
  };
  objective: string;
  scope: string;
  designSummary: string;
  dataSummary: string;
  parameterResults: Array<{
    key: ParamKey;
    label: string;
    summary: string;
    verdict: Verdict;
    metrics: Array<{
      label: string;
      value: string;
      criterion: string;
      verdict: Verdict;
      formula?: string;
    }>;
    notes: string[];
  }>;
  uncertainty: {
    summary: string;
    combined: number;
    expanded: number;
    coverageFactor: number;
    effectiveDof: number | null;
    dofComplete?: boolean;
    items: Array<{
      source: string;
      type: string;
      value: number;
      divisor: number;
      sensitivity: number;
      stdUncertainty: number;
      contribution: number;
      dof: number | null;
    }>;
  } | null;
  conclusion: string;
  limitations: string[];
  assumptions: string[];
  references: string[];
  signatures: ReportSignature[];
  generatedAt: string;
  version: string;
  auditHash: string;
}

export interface ReportRecord {
  id: string;
  validationId: string;
  version: number;
  status: 'draft' | 'in_review' | 'approved';
  content: ReportContent;
  elaboratedBy: string;
  reviewedBy: string;
  approvedBy: string;
  elaboratedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationVersion {
  id: string;
  validationId: string;
  version: number;
  snapshot: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  validationId: string;
  entity: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  reason: string;
  timestamp: string;
  previousHash?: string | null;
  currentHash?: string | null;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  laboratoryName: string;
  laboratoryAddress: string;
  accreditation: string;
  logoDataUrl: string;
  responsible: string;
  reviewer: string;
  approver: string;
  userName?: string;
  userRegistration?: string;
  backupReminderDays?: number;
  lastBackupExportedAt?: string | null;
  defaultConfidence: number;
  defaultPower: number;
  reportFooter: string;
  reportIntro: string;
  references: string[];
}

export type Verdict = 'pass' | 'fail' | 'warning' | 'not_evaluated';

export interface ValidationBundle {
  validation: Validation;
  method: Method;
  parameters: ValidationParameter[];
  design: DesignRecord | null;
  measurements: Measurement[];
  analyses: AnalysisRecord[];
  uncertainty: UncertaintyItem[];
  report: ReportRecord | null;
  versions: ValidationVersion[];
  audit: AuditLog[];
}

export const METHOD_TYPE_LABELS: Record<MethodType, string> = {
  quantitative: 'Quantitativo',
  qualitative: 'Qualitativo',
  dimensional: 'Dimensional / físico',
  microbiological: 'Microbiológico',
  other: 'Outro',
};

export const METHOD_FAMILY_LABELS: Record<MethodFamily, string> = {
  analytical: 'Analítico (química)',
  dimensional: 'Dimensional',
  'physical-destructive': 'Físico destrutivo',
  'physical-nondestructive': 'Físico não destrutivo',
  attribute: 'Atributo (qualitativo)',
};

export const EMPTY_MEASUREMENT_CONDITION: MeasurementCondition = {
  temperature: null,
  humidity: null,
  testSpeed: null,
  other: '',
};

export const VALIDATION_TYPE_LABELS: Record<ValidationType, string> = {
  full: 'Validação completa',
  partial: 'Validação parcial',
  verification: 'Verificação de método normalizado',
};

export const STATUS_LABELS: Record<ValidationStatus, string> = {
  draft: 'Rascunho',
  in_progress: 'Em andamento',
  in_review: 'Em aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  laboratoryName: '',
  laboratoryAddress: '',
  accreditation: '',
  logoDataUrl: '',
  reportTitle: 'Relatório de Validação de Método',
  templateIntro:
    'Este relatório descreve a validação do método analítico, o delineamento amostral, os dados coletados, a análise estatística e a conclusão de adequação ao uso, em conformidade com a ISO/IEC 17025:2017 (item 7.2.2).',
  templateFooter:
    'Os resultados referem-se exclusivamente às condições e amostras descritas neste relatório. A reprodução parcial requer aprovação do laboratório.',
  showRawData: true,
  showFormulas: true,
  showCharts: true,
  version: '1.0',
  conformityRule: 'guard_band',
  guardBandFactor: 1,
  probabilityThreshold: 0.95,
  processVariation: null,
  individualLsl: null,
  homogeneityCheck: false,
  homogeneityJustification: '',
};

export const DEFAULT_DESIGN_INPUT: DesignInput = {
  designType: 'crossed',
  confidence: 0.95,
  power: 0.8,
  alpha: 0.05,
  beta: 0.2,
  sigma: 0.5,
  effect: 0.5,
  margin: 0.5,
  targetPrecision: 0.25,
  relativeSdError: 0.2,
  varianceRatio: 1.5,
  betweenLabRatio: 1,
  nLevels: 5,
  nAnalysts: 2,
  nDays: 3,
  nEquipments: 1,
  nLots: 1,
  nReplicates: 3,
  nLabs: 8,
  nSamples: 10,
  nBorderlineSamples: 3,
  factors: ['analista', 'dia', 'equipamento'],
  levels: ['baixo', 'médio', 'alto'],
  seed: 20261031,
  manualTotal: null,
  manualOverride: false,
  notes: '',
};
