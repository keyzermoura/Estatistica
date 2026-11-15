/**
 * Repositório: CRUD tipado, auditoria e versionamento.
 *
 * Toda escrita relevante registra um evento em audit_logs. Validações
 * aprovadas ficam bloqueadas; criar nova versão exige justificativa.
 */

import {
  DEFAULT_DESIGN_INPUT,
  DEFAULT_REPORT_CONFIG,
  type AnalysisRecord,
  type AppSettings,
  type AuditLog,
  type DesignRecord,
  type Measurement,
  type MeasurementCondition,
  type Method,
  type MethodFamily,
  type ParamKey,
  type ReportConfig,
  type ReportRecord,
  type UncertaintyItem,
  type Validation,
  type ValidationBundle,
  type ValidationParameter,
  type ValidationVersion,
} from './types';
import {
  assertMeasurementIdentities,
  assertMethodTolerance,
  normalizeMethodFamily,
} from './validation';
import {
  exportDatabase,
  flush,
  initDb,
  markDirty,
  row,
  rows,
  run,
  transaction,
} from './db';
import { nowIso, uid } from './utils';
import { DEFAULT_PROFILE_ID, getProfile, getProfileForMethod } from '../profiles/index';

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string =>
  v === null || v === undefined ? fallback : String(v);
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const maybeNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => Number(v) === 1 || v === true;
const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  laboratoryName: '',
  laboratoryAddress: '',
  accreditation: '',
  logoDataUrl: '',
  responsible: '',
  reviewer: '',
  approver: '',
  defaultConfidence: 0.95,
  defaultPower: 0.8,
  reportFooter: DEFAULT_REPORT_CONFIG.templateFooter,
  reportIntro: DEFAULT_REPORT_CONFIG.templateIntro,
  references: [
    'ISO/IEC 17025:2017 — Requisitos gerais para a competência de laboratórios de ensaio e calibração.',
    'ISO 5725-1:2023 / ISO 5725-2:2019 — Exatidão e precisão de métodos de medição.',
    'JCGM 100:2008 (GUM) — Avaliação de dados de medição.',
    'ICH Q2(R2) — Validation of Analytical Procedures.',
  ],
};

function mapMethod(r: Row): Method {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    type: str(r.type, 'quantitative') as Method['type'],
    family: normalizeMethodFamily(r.family),
    unit: str(r.unit),
    rangeMin: maybeNum(r.range_min),
    rangeMax: maybeNum(r.range_max),
    lsl: maybeNum(r.lsl),
    usl: maybeNum(r.usl),
    resolution: maybeNum(r.resolution),
    measurand: str(r.measurand),
    toleranceUnit: str(r.tolerance_unit),
    equipment: str(r.equipment),
    referenceNorm: str(r.reference_norm),
    validationType: str(r.validation_type, 'full') as Method['validationType'],
    description: str(r.description),
    criteria: json(r.criteria_json, []),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function mapValidation(r: Row): Validation {
  return {
    id: str(r.id),
    methodId: str(r.method_id),
    title: str(r.title),
    objective: str(r.objective),
    scope: str(r.scope),
    status: str(r.status, 'draft') as Validation['status'],
    currentStep: num(r.current_step),
    version: num(r.version, 1),
    responsible: str(r.responsible),
    reviewer: str(r.reviewer),
    approver: str(r.approver),
    approvedAt: (r.approved_at as string | null) ?? null,
    locked: bool(r.locked),
    reportConfig: json<ReportConfig>(r.report_config_json, DEFAULT_REPORT_CONFIG),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function mapParameter(r: Row): ValidationParameter {
  return {
    validationId: str(r.validation_id),
    key: str(r.param_key) as ParamKey,
    selected: bool(r.selected),
    justification: str(r.justification),
    criteria: json(r.criteria_json, []),
  };
}

function normalizeCondition(
  condition: MeasurementCondition | null | undefined,
): MeasurementCondition | null {
  if (!condition || typeof condition !== 'object') return null;
  return {
    temperature: maybeNum(condition.temperature),
    humidity: maybeNum(condition.humidity),
    testSpeed: maybeNum(condition.testSpeed),
    other: typeof condition.other === 'string' ? condition.other : '',
  };
}

function mapMeasurement(r: Row): Measurement {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    runOrder: num(r.run_order),
    level: str(r.level),
    analyst: str(r.analyst),
    day: str(r.day),
    equipment: str(r.equipment),
    lot: str(r.lot),
    sample: str(r.sample),
    partId: str(r.part_id),
    specimen: str(r.specimen),
    destructive: bool(r.destructive),
    condition: normalizeCondition(json<MeasurementCondition | null>(r.condition_json, null)),
    refValue: maybeNum(r.ref_value),
    refUncertainty: maybeNum(r.ref_uncertainty),
    category: str(r.category),
    replicate: num(r.replicate, 1),
    value: maybeNum(r.value),
    referenceValue: maybeNum(r.reference_value),
    textValue: str(r.text_value),
    notes: str(r.notes),
  };
}

type NormalizedMeasurement = Measurement & {
  partId: string;
  specimen: string;
  destructive: boolean;
  condition: MeasurementCondition | null;
  refValue: number | null;
  refUncertainty: number | null;
  category: string;
};

/** Garante que campos opcionais vindos de chamadas antigas tenham defaults. */
function normalizeMeasurement(measurement: Measurement): NormalizedMeasurement {
  return {
    ...measurement,
    partId: measurement.partId ?? '',
    specimen: measurement.specimen ?? '',
    destructive: measurement.destructive === true,
    condition: normalizeCondition(measurement.condition),
    refValue: measurement.refValue ?? null,
    refUncertainty: measurement.refUncertainty ?? null,
    category: measurement.category ?? '',
  };
}

function conditionToJson(condition: MeasurementCondition | null | undefined): string | null {
  const normalized = normalizeCondition(condition);
  if (!normalized) return null;
  const hasValue =
    normalized.temperature !== null ||
    normalized.humidity !== null ||
    normalized.testSpeed !== null ||
    normalized.other.trim() !== '';
  return hasValue ? JSON.stringify(normalized) : null;
}

function mapDesign(r: Row): DesignRecord {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    input: json(r.input_json, DEFAULT_DESIGN_INPUT),
    plan: json(r.plan_json, {} as DesignRecord['plan']),
    seed: num(r.seed),
    createdAt: str(r.created_at),
  };
}

function mapAnalysis(r: Row): AnalysisRecord {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    parameterKey: str(r.parameter_key, 'global') as AnalysisRecord['parameterKey'],
    kind: str(r.kind),
    inputHash: str(r.input_hash),
    results: json(r.results_json, {}),
    createdAt: str(r.created_at),
  };
}

function mapUncertainty(r: Row): UncertaintyItem {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    source: str(r.source),
    type: str(r.type, 'B') as UncertaintyItem['type'],
    distribution: str(r.distribution, 'rectangular') as UncertaintyItem['distribution'],
    value: num(r.value),
    divisor: num(r.divisor, 1),
    sensitivity: num(r.sensitivity, 1),
    stdUncertainty: num(r.std_uncertainty),
    dof: maybeNum(r.dof),
    notes: str(r.notes),
  };
}

function mapReport(r: Row): ReportRecord {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    version: num(r.version, 1),
    status: str(r.status, 'draft') as ReportRecord['status'],
    content: json(r.content_json, {} as ReportRecord['content']),
    elaboratedBy: str(r.elaborated_by),
    reviewedBy: str(r.reviewed_by),
    approvedBy: str(r.approved_by),
    elaboratedAt: (r.elaborated_at as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    locked: bool(r.locked),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function mapVersion(r: Row): ValidationVersion {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    version: num(r.version),
    snapshot: str(r.snapshot_json),
    reason: str(r.reason),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  };
}

function mapAudit(r: Row): AuditLog {
  return {
    id: str(r.id),
    validationId: str(r.validation_id),
    entity: str(r.entity),
    action: str(r.action),
    actor: str(r.actor),
    before: json(r.before_json, null),
    after: json(r.after_json, null),
    reason: str(r.reason),
    timestamp: str(r.timestamp),
  };
}

export async function ensureDb(): Promise<void> {
  await initDb();
}

export function logAudit(
  validationId: string,
  entity: string,
  action: string,
  actor: string,
  before: unknown,
  after: unknown,
  reason = '',
) {
  run(
    `INSERT INTO audit_logs (id, validation_id, entity, action, actor, before_json, after_json, reason, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid('aud'),
      validationId,
      entity,
      action,
      actor || 'sistema',
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      reason,
      nowIso(),
    ],
  );
}

// ── Métodos ────────────────────────────────────────────────────────────────

export function listMethods(): Method[] {
  return rows('SELECT * FROM methods ORDER BY updated_at DESC').map(mapMethod);
}

export function getMethod(id: string): Method | null {
  const r = row('SELECT * FROM methods WHERE id = ?', [id]);
  return r ? mapMethod(r) : null;
}

export function saveMethod(method: Method, actor = 'sistema'): Method {
  const existing = getMethod(method.id);
  const timestamp = nowIso();
  const next: Method = {
    ...method,
    family: normalizeMethodFamily(method.family),
    lsl: method.lsl ?? null,
    usl: method.usl ?? null,
    resolution: method.resolution ?? null,
    measurand: method.measurand ?? '',
    toleranceUnit: method.toleranceUnit ?? '',
    updatedAt: timestamp,
    createdAt: existing?.createdAt ?? timestamp,
  };
  assertMethodTolerance(next);
  transaction(() => {
    run(
      `INSERT INTO methods (id, code, name, type, family, unit, range_min, range_max, lsl, usl, resolution, measurand, tolerance_unit, equipment, reference_norm, validation_type, description, criteria_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code=excluded.code, name=excluded.name, type=excluded.type, family=excluded.family,
         unit=excluded.unit, range_min=excluded.range_min, range_max=excluded.range_max,
         lsl=excluded.lsl, usl=excluded.usl, resolution=excluded.resolution,
         measurand=excluded.measurand, tolerance_unit=excluded.tolerance_unit,
         equipment=excluded.equipment, reference_norm=excluded.reference_norm,
         validation_type=excluded.validation_type, description=excluded.description,
         criteria_json=excluded.criteria_json, updated_at=excluded.updated_at`,
      [
        next.id,
        next.code,
        next.name,
        next.type,
        next.family,
        next.unit,
        next.rangeMin,
        next.rangeMax,
        next.lsl,
        next.usl,
        next.resolution,
        next.measurand,
        next.toleranceUnit,
        next.equipment,
        next.referenceNorm,
        next.validationType,
        next.description,
        JSON.stringify(next.criteria),
        next.createdAt,
        next.updatedAt,
      ],
    );
    if (existing) {
      const unlocked = rows<{ id: string }>(
        'SELECT id FROM validations WHERE method_id = ? AND locked = 0',
        [next.id],
      );
      for (const item of unlocked) {
        invalidateCurrentReportIfSigned(
          item.id,
          actor,
          'Método atualizado após assinatura do relatório',
        );
      }
    }
    logAudit(
      'global',
      'method',
      existing ? 'update' : 'create',
      actor,
      existing,
      next,
      existing ? 'Atualização do cadastro do método' : 'Criação do método',
    );
  });
  return next;
}

export function deleteMethod(id: string, actor = 'sistema') {
  const used = row<{ n: number }>('SELECT COUNT(*) AS n FROM validations WHERE method_id = ?', [id]);
  if (num(used?.n) > 0) throw new Error('Exclua as validações vinculadas antes de excluir o método.');
  const before = getMethod(id);
  transaction(() => {
    run('DELETE FROM methods WHERE id = ?', [id]);
    logAudit('global', 'method', 'delete', actor, before, null, 'Exclusão do método');
  });
}

// ── Validações ─────────────────────────────────────────────────────────────

export function listValidations(): Validation[] {
  return rows('SELECT * FROM validations ORDER BY updated_at DESC').map(mapValidation);
}

export function getValidation(id: string): Validation | null {
  const r = row('SELECT * FROM validations WHERE id = ?', [id]);
  return r ? mapValidation(r) : null;
}

/**
 * Se a versão atual da validação tiver relatório assinado ou fora de rascunho,
 * invalida as assinaturas e retorna o relatório para 'draft' após edição dos dados.
 */
function invalidateCurrentReportIfSigned(
  validationId: string,
  actor: string,
  reason: string,
): void {
  const validation = getValidation(validationId);
  if (!validation || validation.locked) return;
  const raw = row(
    'SELECT * FROM reports WHERE validation_id = ? AND version = ? ORDER BY version DESC LIMIT 1',
    [validationId, validation.version],
  );
  if (!raw) return;
  const report = mapReport(raw);
  const hasSignatureOrReview = Boolean(
    report.elaboratedAt ||
      report.reviewedAt ||
      report.approvedAt ||
      report.status !== 'draft' ||
      report.content.signatures?.some((signature) => signature.signed),
  );
  if (!hasSignatureOrReview) return;
  const timestamp = nowIso();
  const next: ReportRecord = {
    ...report,
    status: 'draft',
    locked: false,
    elaboratedAt: null,
    reviewedAt: null,
    approvedAt: null,
    reviewedBy: '',
    approvedBy: '',
    updatedAt: timestamp,
    content: {
      ...report.content,
      signatures: (report.content.signatures ?? []).map((signature) => ({
        ...signature,
        date: null,
        signed: false,
      })),
    },
  };
  run(
    `UPDATE reports SET status=?, content_json=?, reviewed_by=?, approved_by=?, elaborated_at=?, reviewed_at=?, approved_at=?, locked=?, updated_at=?
     WHERE id=?`,
    [
      next.status,
      JSON.stringify(next.content),
      next.reviewedBy,
      next.approvedBy,
      next.elaboratedAt,
      next.reviewedAt,
      next.approvedAt,
      next.locked ? 1 : 0,
      next.updatedAt,
      next.id,
    ],
  );
  logAudit(validationId, 'report', 'invalidate', actor, report, next, reason);
}

/** Impede escrita em processo aprovado; a saída é abrir nova versão. */
function assertUnlocked(validationId: string) {
  const validation = getValidation(validationId);
  if (validation?.locked) {
    throw new Error('Validação aprovada e bloqueada; crie uma nova versão para editar.');
  }
}

/** Família do método vinculado à validação (analytical como fallback seguro). */
function methodFamilyForValidation(validationId: string): MethodFamily {
  const validation = getValidation(validationId);
  const method = validation ? getMethod(validation.methodId) : null;
  return method?.family ?? 'analytical';
}

export function createValidation(
  methodId: string,
  title?: string,
  actor = 'sistema',
): Validation {
  const method = getMethod(methodId);
  if (!method) throw new Error('Método não encontrado.');
  const settings = loadSettings();
  const timestamp = nowIso();
  const id = uid('val');
  const reportConfig: ReportConfig = {
    ...DEFAULT_REPORT_CONFIG,
    laboratoryName: settings.laboratoryName,
    laboratoryAddress: settings.laboratoryAddress,
    accreditation: settings.accreditation,
    logoDataUrl: settings.logoDataUrl,
    reportTitle: `Relatório de Validação — ${method.name}`,
    templateIntro: settings.reportIntro,
    templateFooter: settings.reportFooter,
  };
  const validation: Validation = {
    id,
    methodId,
    title: title || `Validação — ${method.name}`,
    objective: `Demonstrar que o método ${method.code} é adequado ao uso pretendido.`,
    scope: method.description,
    status: 'draft',
    currentStep: 0,
    version: 1,
    responsible: settings.responsible,
    reviewer: settings.reviewer,
    approver: settings.approver,
    approvedAt: null,
    locked: false,
    reportConfig,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const profile = getProfileForMethod(method);
  transaction(() => {
    run(
      `INSERT INTO validations (id, method_id, title, objective, scope, status, current_step, version, responsible, reviewer, approver, approved_at, locked, report_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validation.id,
        validation.methodId,
        validation.title,
        validation.objective,
        validation.scope,
        validation.status,
        validation.currentStep,
        validation.version,
        validation.responsible,
        validation.reviewer,
        validation.approver,
        null,
        0,
        JSON.stringify(validation.reportConfig),
        validation.createdAt,
        validation.updatedAt,
      ],
    );
    const selected = new Set(profile.suggestedParameters(method.type, method.validationType));
    for (const parameter of profile.parameters) {
      run(
        `INSERT INTO validation_parameters (validation_id, param_key, selected, justification, criteria_json)
         VALUES (?, ?, ?, ?, ?)`,
        [id, parameter.key, selected.has(parameter.key) ? 1 : 0, '', '[]'],
      );
    }
    logAudit(id, 'validation', 'create', actor, null, validation, 'Criação da validação');
  });
  return validation;
}

export function updateValidation(
  validation: Validation,
  actor = 'sistema',
  reason = '',
): Validation {
  const before = getValidation(validation.id);
  if (!before) throw new Error('Validação não encontrada.');
  if (before.locked) throw new Error('Validação aprovada e bloqueada; crie uma nova versão.');
  const next: Validation = { ...validation, updatedAt: nowIso() };
  run(
    `UPDATE validations SET method_id=?, title=?, objective=?, scope=?, status=?, current_step=?,
       version=?, responsible=?, reviewer=?, approver=?, approved_at=?, locked=?, report_config_json=?, updated_at=?
     WHERE id=?`,
    [
      next.methodId,
      next.title,
      next.objective,
      next.scope,
      next.status,
      next.currentStep,
      next.version,
      next.responsible,
      next.reviewer,
      next.approver,
      next.approvedAt,
      next.locked ? 1 : 0,
      JSON.stringify(next.reportConfig),
      next.updatedAt,
      next.id,
    ],
  );
  logAudit(next.id, 'validation', 'update', actor, before, next, reason);
  return next;
}

export function setValidationStep(id: string, step: number, actor = 'sistema') {
  const before = getValidation(id);
  if (!before) return;
  if (before.locked) return;
  run('UPDATE validations SET current_step=?, updated_at=? WHERE id=?', [
    step,
    nowIso(),
    id,
  ]);
  markDirty();
}

export function deleteValidation(id: string, actor = 'sistema') {
  const before = getValidation(id);
  if (!before) return;
  transaction(() => {
    for (const table of [
      'audit_logs',
      'validation_versions',
      'reports',
      'uncertainty_items',
      'analyses',
      'measurements',
      'designs',
      'validation_parameters',
    ]) {
      run(`DELETE FROM ${table} WHERE validation_id = ?`, [id]);
    }
    run('DELETE FROM validations WHERE id = ?', [id]);
    logAudit(id, 'validation', 'delete', actor, before, null, 'Exclusão da validação');
  });
}

export function duplicateValidation(id: string, actor = 'sistema'): Validation {
  const bundle = getBundle(id);
  if (!bundle) throw new Error('Validação não encontrada.');
  const method = bundle.method;
  const copy = createValidation(method.id, `${bundle.validation.title} (cópia)`, actor);
  updateValidation(
    {
      ...copy,
      objective: bundle.validation.objective,
      scope: bundle.validation.scope,
      responsible: bundle.validation.responsible,
      reviewer: bundle.validation.reviewer,
      approver: bundle.validation.approver,
      reportConfig: bundle.validation.reportConfig,
    },
    actor,
    'Duplicação',
  );
  saveParameters(copy.id, bundle.parameters, actor);
  if (bundle.design) {
    saveDesign({ ...bundle.design, id: uid('design'), validationId: copy.id, createdAt: nowIso() }, actor);
  }
  if (bundle.measurements.length) {
    replaceMeasurements(
      copy.id,
      bundle.measurements.map((m) => ({ ...m, id: uid('m'), validationId: copy.id })),
      actor,
      'Duplicação',
    );
  }
  const uncertainty = listUncertainty(id);
  if (uncertainty.length) {
    replaceUncertainty(
      copy.id,
      uncertainty.map((item) => ({ ...item, id: uid('u'), validationId: copy.id })),
      actor,
    );
  }
  return copy;
}

// ── Parâmetros ─────────────────────────────────────────────────────────────

export function listParameters(validationId: string): ValidationParameter[] {
  const existing = rows('SELECT * FROM validation_parameters WHERE validation_id = ?', [
    validationId,
  ]).map(mapParameter);
  const byKey = new Map(existing.map((p) => [p.key, p]));
  const validation = getValidation(validationId);
  const method = validation ? getMethod(validation.methodId) : null;
  const profile = method ? getProfileForMethod(method) : getProfile(DEFAULT_PROFILE_ID);
  const selected = new Set(
    method ? profile.suggestedParameters(method.type, method.validationType) : [],
  );
  return profile.parameters.map(
    (parameter) =>
      byKey.get(parameter.key) ?? {
        validationId,
        key: parameter.key,
        selected: selected.has(parameter.key),
        justification: '',
        criteria: [],
      },
  );
}

export function saveParameters(
  validationId: string,
  parameters: ValidationParameter[],
  actor = 'sistema',
  reason = '',
) {
  assertUnlocked(validationId);
  const before = listParameters(validationId);
  transaction(() => {
    for (const p of parameters) {
      run(
        `INSERT INTO validation_parameters (validation_id, param_key, selected, justification, criteria_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(validation_id, param_key) DO UPDATE SET
           selected=excluded.selected, justification=excluded.justification, criteria_json=excluded.criteria_json`,
        [validationId, p.key, p.selected ? 1 : 0, p.justification, JSON.stringify(p.criteria)],
      );
    }
    invalidateCurrentReportIfSigned(
      validationId,
      actor,
      'Parâmetros alterados após assinatura do relatório',
    );
    logAudit(validationId, 'parameters', 'update', actor, before, parameters, reason);
  });
}

/** Critérios globais do método + critérios específicos da validação. */
export function getAllCriteria(validationId: string) {
  const validation = getValidation(validationId);
  const method = validation ? getMethod(validation.methodId) : null;
  const parameters = listParameters(validationId);
  return {
    methodCriteria: method?.criteria ?? [],
    parameterCriteria: parameters.flatMap((p) => p.criteria),
  };
}

// ── Delineamento ───────────────────────────────────────────────────────────

export function getDesign(validationId: string): DesignRecord | null {
  const r = row('SELECT * FROM designs WHERE validation_id = ? ORDER BY created_at DESC LIMIT 1', [
    validationId,
  ]);
  return r ? mapDesign(r) : null;
}

export function saveDesign(design: DesignRecord, actor = 'sistema', reason = ''): DesignRecord {
  assertUnlocked(design.validationId);
  const before = getDesign(design.validationId);
  transaction(() => {
    run('DELETE FROM designs WHERE validation_id = ?', [design.validationId]);
    run(
      `INSERT INTO designs (id, validation_id, input_json, plan_json, seed, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        design.id,
        design.validationId,
        JSON.stringify(design.input),
        JSON.stringify(design.plan),
        design.seed,
        design.createdAt,
      ],
    );
    invalidateCurrentReportIfSigned(
      design.validationId,
      actor,
      'Delineamento alterado após assinatura do relatório',
    );
    logAudit(design.validationId, 'design', 'save', actor, before, design, reason);
  });
  return design;
}

// ── Medições ───────────────────────────────────────────────────────────────

export function listMeasurements(validationId: string): Measurement[] {
  return rows('SELECT * FROM measurements WHERE validation_id = ? ORDER BY run_order, id', [
    validationId,
  ]).map(mapMeasurement);
}

export function replaceMeasurements(
  validationId: string,
  measurements: Measurement[],
  actor = 'sistema',
  reason = '',
): Measurement[] {
  assertUnlocked(validationId);
  const before = listMeasurements(validationId);
  const normalized = measurements.map((measurement) => ({
    ...normalizeMeasurement(measurement),
    validationId,
  }));
  assertMeasurementIdentities(normalized, methodFamilyForValidation(validationId));
  transaction(() => {
    run('DELETE FROM measurements WHERE validation_id = ?', [validationId]);
    for (const m of normalized) {
      run(
        `INSERT INTO measurements (id, validation_id, run_order, level, analyst, day, equipment, lot, sample, part_id, specimen, destructive, condition_json, ref_value, ref_uncertainty, category, replicate, value, reference_value, text_value, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          validationId,
          m.runOrder,
          m.level,
          m.analyst,
          m.day,
          m.equipment,
          m.lot,
          m.sample,
          m.partId,
          m.specimen,
          m.destructive ? 1 : 0,
          conditionToJson(m.condition),
          m.refValue,
          m.refUncertainty,
          m.category,
          m.replicate,
          m.value,
          m.referenceValue ?? null,
          m.textValue,
          m.notes,
        ],
      );
    }
    invalidateCurrentReportIfSigned(
      validationId,
      actor,
      'Medições substituídas após assinatura do relatório',
    );
    logAudit(
      validationId,
      'measurements',
      'replace',
      actor,
      { count: before.length, measurements: before },
      { count: normalized.length, measurements: normalized },
      reason,
    );
  });
  return listMeasurements(validationId);
}

export function addMeasurement(measurement: Measurement, actor = 'sistema'): Measurement {
  const validation = getValidation(measurement.validationId);
  if (validation?.locked) throw new Error('Validação bloqueada.');
  const next = normalizeMeasurement(measurement);
  assertMeasurementIdentities([next], methodFamilyForValidation(measurement.validationId));
  transaction(() => {
    run(
      `INSERT INTO measurements (id, validation_id, run_order, level, analyst, day, equipment, lot, sample, part_id, specimen, destructive, condition_json, ref_value, ref_uncertainty, category, replicate, value, reference_value, text_value, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.id,
        next.validationId,
        next.runOrder,
        next.level,
        next.analyst,
        next.day,
        next.equipment,
        next.lot,
        next.sample,
        next.partId,
        next.specimen,
        next.destructive ? 1 : 0,
        conditionToJson(next.condition),
        next.refValue,
        next.refUncertainty,
        next.category,
        next.replicate,
        next.value,
        next.referenceValue ?? null,
        next.textValue,
        next.notes,
      ],
    );
    invalidateCurrentReportIfSigned(
      measurement.validationId,
      actor,
      'Medições alteradas após assinatura do relatório',
    );
    logAudit(measurement.validationId, 'measurement', 'create', actor, null, next);
  });
  return next;
}

export function updateMeasurement(measurement: Measurement, actor = 'sistema'): Measurement {
  assertUnlocked(measurement.validationId);
  const before = row('SELECT * FROM measurements WHERE id = ?', [measurement.id]);
  const next = normalizeMeasurement(measurement);
  assertMeasurementIdentities([next], methodFamilyForValidation(measurement.validationId));
  transaction(() => {
    run(
      `UPDATE measurements SET run_order=?, level=?, analyst=?, day=?, equipment=?, lot=?, sample=?, part_id=?, specimen=?, destructive=?, condition_json=?, ref_value=?, ref_uncertainty=?, category=?, replicate=?, value=?, reference_value=?, text_value=?, notes=?
       WHERE id=?`,
      [
        next.runOrder,
        next.level,
        next.analyst,
        next.day,
        next.equipment,
        next.lot,
        next.sample,
        next.partId,
        next.specimen,
        next.destructive ? 1 : 0,
        conditionToJson(next.condition),
        next.refValue,
        next.refUncertainty,
        next.category,
        next.replicate,
        next.value,
        next.referenceValue ?? null,
        next.textValue,
        next.notes,
        next.id,
      ],
    );
    invalidateCurrentReportIfSigned(
      measurement.validationId,
      actor,
      'Medições alteradas após assinatura do relatório',
    );
    logAudit(
      measurement.validationId,
      'measurement',
      'update',
      actor,
      before ? mapMeasurement(before) : null,
      next,
    );
  });
  return next;
}

export function deleteMeasurement(measurement: Measurement, actor = 'sistema', reason = '') {
  assertUnlocked(measurement.validationId);
  transaction(() => {
    run('DELETE FROM measurements WHERE id = ?', [measurement.id]);
    invalidateCurrentReportIfSigned(
      measurement.validationId,
      actor,
      'Medições alteradas após assinatura do relatório',
    );
    logAudit(measurement.validationId, 'measurement', 'delete', actor, measurement, null, reason);
  });
}

// ── Análises ───────────────────────────────────────────────────────────────

export function listAnalyses(validationId: string): AnalysisRecord[] {
  return rows('SELECT * FROM analyses WHERE validation_id = ? ORDER BY created_at DESC', [
    validationId,
  ]).map(mapAnalysis);
}

export function saveAnalysis(record: Omit<AnalysisRecord, 'id' | 'createdAt'>): AnalysisRecord {
  assertUnlocked(record.validationId);
  const full: AnalysisRecord = { ...record, id: uid('an'), createdAt: nowIso() };
  run(
    `INSERT INTO analyses (id, validation_id, parameter_key, kind, input_hash, results_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      full.id,
      full.validationId,
      full.parameterKey,
      full.kind,
      full.inputHash,
      JSON.stringify(full.results),
      full.createdAt,
    ],
  );
  return full;
}

export function clearAnalyses(validationId: string) {
  assertUnlocked(validationId);
  run('DELETE FROM analyses WHERE validation_id = ?', [validationId]);
}

// ── Incerteza ──────────────────────────────────────────────────────────────

export function listUncertainty(validationId: string): UncertaintyItem[] {
  return rows('SELECT * FROM uncertainty_items WHERE validation_id = ? ORDER BY source', [
    validationId,
  ]).map(mapUncertainty);
}

export function replaceUncertainty(
  validationId: string,
  items: UncertaintyItem[],
  actor = 'sistema',
): UncertaintyItem[] {
  assertUnlocked(validationId);
  const before = listUncertainty(validationId);
  transaction(() => {
    run('DELETE FROM uncertainty_items WHERE validation_id = ?', [validationId]);
    for (const item of items) {
      run(
        `INSERT INTO uncertainty_items (id, validation_id, source, type, distribution, value, divisor, sensitivity, std_uncertainty, dof, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          validationId,
          item.source,
          item.type,
          item.distribution,
          item.value,
          item.divisor,
          item.sensitivity,
          item.stdUncertainty,
          item.dof,
          item.notes,
        ],
      );
    }
    invalidateCurrentReportIfSigned(
      validationId,
      actor,
      'Orçamento de incerteza alterado após assinatura do relatório',
    );
    logAudit(validationId, 'uncertainty', 'replace', actor, before, items);
  });
  return listUncertainty(validationId);
}

// ── Relatórios ─────────────────────────────────────────────────────────────

export function listReports(validationId: string): ReportRecord[] {
  return rows('SELECT * FROM reports WHERE validation_id = ? ORDER BY version DESC', [
    validationId,
  ]).map(mapReport);
}

export function getLatestReport(validationId: string): ReportRecord | null {
  const r = row('SELECT * FROM reports WHERE validation_id = ? ORDER BY version DESC LIMIT 1', [
    validationId,
  ]);
  return r ? mapReport(r) : null;
}

export function saveReport(report: ReportRecord, actor = 'sistema'): ReportRecord {
  assertUnlocked(report.validationId);
  const existing = row('SELECT * FROM reports WHERE id = ?', [report.id]);
  run(
    `INSERT INTO reports (id, validation_id, version, status, content_json, elaborated_by, reviewed_by, approved_by, elaborated_at, reviewed_at, approved_at, locked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status, content_json=excluded.content_json,
       elaborated_by=excluded.elaborated_by, reviewed_by=excluded.reviewed_by,
       approved_by=excluded.approved_by, elaborated_at=excluded.elaborated_at,
       reviewed_at=excluded.reviewed_at, approved_at=excluded.approved_at,
       locked=excluded.locked, updated_at=excluded.updated_at`,
    [
      report.id,
      report.validationId,
      report.version,
      report.status,
      JSON.stringify(report.content),
      report.elaboratedBy,
      report.reviewedBy,
      report.approvedBy,
      report.elaboratedAt,
      report.reviewedAt,
      report.approvedAt,
      report.locked ? 1 : 0,
      report.createdAt,
      report.updatedAt,
    ],
  );
  logAudit(
    report.validationId,
    'report',
    existing ? 'update' : 'create',
    actor,
    existing ? mapReport(existing) : null,
    report,
  );
  return report;
}

export function signReport(
  validationId: string,
  role: 'elaboration' | 'review' | 'approval',
  name: string,
  actor = 'sistema',
): ReportRecord | null {
  assertUnlocked(validationId);
  const report = getLatestReport(validationId);
  if (!report) return null;
  const timestamp = nowIso();
  const next: ReportRecord = { ...report, updatedAt: timestamp };
  if (role === 'elaboration') {
    next.elaboratedBy = name;
    next.elaboratedAt = timestamp;
    next.status = 'draft';
  } else if (role === 'review') {
    next.reviewedBy = name;
    next.reviewedAt = timestamp;
    next.status = 'in_review';
  } else {
    next.approvedBy = name;
    next.approvedAt = timestamp;
    next.status = 'approved';
  }
  next.content = {
    ...next.content,
    signatures: next.content.signatures?.map((s) =>
      s.role === role ? { ...s, name, date: timestamp, signed: true } : s,
    ) ?? [],
  };
  return saveReport(next, actor);
}

// ── Versões, aprovação e auditoria ─────────────────────────────────────────

export function listVersions(validationId: string): ValidationVersion[] {
  return rows('SELECT * FROM validation_versions WHERE validation_id = ? ORDER BY version DESC', [
    validationId,
  ]).map(mapVersion);
}

export function createVersionSnapshot(
  validationId: string,
  reason: string,
  actor = 'sistema',
): ValidationVersion {
  const bundle = getBundle(validationId);
  if (!bundle) throw new Error('Validação não encontrada.');
  const version: ValidationVersion = {
    id: uid('ver'),
    validationId,
    version: bundle.validation.version,
    // Evita encadear snapshots dentro de snapshots (crescimento exponencial).
    // As versões anteriores continuam disponíveis individualmente na auditoria.
    snapshot: JSON.stringify({
      validation: bundle.validation,
      method: bundle.method,
      parameters: bundle.parameters,
      design: bundle.design,
      measurements: bundle.measurements,
      analyses: bundle.analyses,
      uncertainty: bundle.uncertainty,
      report: bundle.report,
      audit: bundle.audit,
      versions: bundle.versions.map(({ snapshot: _snapshot, ...metadata }) => metadata),
    }),
    reason,
    createdBy: actor,
    createdAt: nowIso(),
  };
  run(
    `INSERT INTO validation_versions (id, validation_id, version, snapshot_json, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [version.id, validationId, version.version, version.snapshot, reason, actor, version.createdAt],
  );
  return version;
}

export function approveValidation(
  validationId: string,
  actor: string,
  reason = 'Aprovação da validação',
): Validation {
  const validation = getValidation(validationId);
  if (!validation) throw new Error('Validação não encontrada.');
  if (validation.locked) return validation;
  const rawReport = row(
    'SELECT * FROM reports WHERE validation_id = ? AND version = ? ORDER BY version DESC LIMIT 1',
    [validationId, validation.version],
  );
  if (!rawReport) {
    throw new Error('Gere o relatório da versão atual antes de aprovar a validação.');
  }
  const report = mapReport(rawReport);
  const signedRoles = new Set(
    (report.content.signatures ?? []).filter((signature) => signature.signed).map((signature) => signature.role),
  );
  const requiredRoles = ['elaboration', 'review', 'approval'] as const;
  if (!requiredRoles.every((role) => signedRoles.has(role))) {
    throw new Error('Todas as assinaturas (elaboração, revisão e aprovação) são obrigatórias.');
  }
  const timestamp = nowIso();
  let approved: Validation | null = null;
  transaction(() => {
    // Congela o relatório antes de bloquear a validação (saveReport rejeita
    // escrita em processo bloqueado).
    saveReport(
      {
        ...report,
        status: 'approved',
        locked: true,
        updatedAt: timestamp,
      },
      actor,
    );
    run(
      `UPDATE validations SET status='approved', approved_at=?, locked=1, updated_at=? WHERE id=?`,
      [timestamp, timestamp, validationId],
    );
    approved = getValidation(validationId)!;
    logAudit(validationId, 'validation', 'approve', actor, validation, approved, reason);
    // O snapshot é criado por último para refletir o estado aprovado e congelado.
    createVersionSnapshot(validationId, reason, actor);
  });
  return approved!;
}

export function newVersion(
  validationId: string,
  reason: string,
  actor = 'sistema',
): Validation {
  const validation = getValidation(validationId);
  if (!validation) throw new Error('Validação não encontrada.');
  if (!reason.trim()) throw new Error('Informe a justificativa da nova versão.');
  createVersionSnapshot(validationId, reason, actor);
  const timestamp = nowIso();
  run(
    `UPDATE validations SET status='in_progress', version=?, locked=0, approved_at=NULL, current_step=0, updated_at=? WHERE id=?`,
    [validation.version + 1, timestamp, validationId],
  );
  const next = getValidation(validationId)!;
  logAudit(validationId, 'validation', 'new_version', actor, validation, next, reason);
  return next;
}

export function listAudit(validationId: string): AuditLog[] {
  return rows('SELECT * FROM audit_logs WHERE validation_id = ? ORDER BY timestamp DESC', [
    validationId,
  ]).map(mapAudit);
}

// ── Configurações ──────────────────────────────────────────────────────────

export function loadSettings(): AppSettings {
  const r = row('SELECT value_json FROM settings WHERE key = ?', ['app']);
  return { ...DEFAULT_SETTINGS, ...json<Partial<AppSettings>>(r?.value_json, {}) };
}

export function saveSettings(settings: AppSettings, actor = 'sistema') {
  const before = loadSettings();
  run(
    `INSERT INTO settings (key, value_json) VALUES ('app', ?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`,
    [JSON.stringify(settings)],
  );
  logAudit('global', 'settings', 'update', actor, before, settings);
}

// ── Bundle ─────────────────────────────────────────────────────────────────

export function getBundle(validationId: string): ValidationBundle | null {
  const validation = getValidation(validationId);
  if (!validation) return null;
  const method = getMethod(validation.methodId);
  if (!method) return null;
  // Um relatório de versão anterior permanece arquivado no snapshot, mas não
  // representa a versão corrente enquanto uma nova versão está em edição.
  const report =
    listReports(validationId).find((item) => item.version === validation.version) ?? null;
  return {
    validation,
    method,
    parameters: listParameters(validationId),
    design: getDesign(validationId),
    measurements: listMeasurements(validationId),
    analyses: listAnalyses(validationId),
    uncertainty: listUncertainty(validationId),
    report,
    versions: listVersions(validationId),
    audit: listAudit(validationId),
  };
}

export function getValidationSummaries(): Array<{
  validation: Validation;
  method: Method;
  parameterCount: number;
  measurementCount: number;
  progress: number;
}> {
  const validations = listValidations();
  return validations.map((validation) => {
    const method = getMethod(validation.methodId);
    const parameters = listParameters(validation.id);
    const measurementCount =
      row<{ n: number }>('SELECT COUNT(*) AS n FROM measurements WHERE validation_id = ?', [
        validation.id,
      ])?.n ?? 0;
    return {
      validation,
      method: method ?? {
        id: '',
        code: '',
        name: 'Método removido',
        type: 'other',
        family: 'analytical',
        unit: '',
        rangeMin: null,
        rangeMax: null,
        lsl: null,
        usl: null,
        resolution: null,
        measurand: '',
        toleranceUnit: '',
        equipment: '',
        referenceNorm: '',
        validationType: 'full',
        description: '',
        criteria: [],
        createdAt: '',
        updatedAt: '',
      },
      parameterCount: parameters.filter((p) => p.selected).length,
      measurementCount: num(measurementCount),
      progress: Math.min(100, Math.round((validation.currentStep / 6) * 100)),
    };
  });
}

export async function exportSqlite(): Promise<Uint8Array> {
  await flush();
  return exportDatabase();
}
