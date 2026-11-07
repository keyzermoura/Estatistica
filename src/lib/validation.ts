/**
 * Validações estruturais do modelo de dados.
 *
 * Estas regras protegem a integridade dos campos introduzidos na migração v2:
 * família de método, limites de tolerância e identificação de peças/corpos de
 * prova. Elas são aplicadas tanto na importação de planilhas quanto no
 * repositório, para que nenhuma escrita contorne a validação.
 */

import {
  METHOD_FAMILY_VALUES,
  type Method,
  type MethodFamily,
} from './types';

export interface MeasurementIdentity {
  runOrder?: number;
  partId?: string | null;
  specimen?: string | null;
  destructive?: boolean | number | null;
}

/** Normaliza o valor lido do banco/planilha; desconhecidos viram analytical. */
export function normalizeMethodFamily(value: unknown): MethodFamily {
  const key = String(value ?? '').trim().toLowerCase();
  return (METHOD_FAMILY_VALUES as string[]).includes(key)
    ? (key as MethodFamily)
    : 'analytical';
}

/**
 * LSL e USL, quando ambos informados, precisam definir um intervalo válido.
 * Retorna uma lista de mensagens (vazia quando não há erro).
 */
export function validateMethodTolerance(
  method: Pick<Method, 'lsl' | 'usl'>,
): string[] {
  if (method.lsl === null || method.usl === null) return [];
  if (!(method.lsl < method.usl)) {
    return [
      `O limite inferior de tolerância (LSL = ${method.lsl}) deve ser menor que o limite superior (USL = ${method.usl}).`,
    ];
  }
  return [];
}

export function assertMethodTolerance(method: Pick<Method, 'lsl' | 'usl'>): void {
  const issues = validateMethodTolerance(method);
  if (issues.length) throw new Error(issues.join(' '));
}

/**
 * Regras de importação/gravação das medições:
 *  - família dimensional exige `part_id`;
 *  - `destructive = 1` exige `specimen`.
 *
 * As demais famílias não são restringidas nesta etapa.
 */
export function validateMeasurementIdentities(
  rows: MeasurementIdentity[],
  family: MethodFamily,
): string[] {
  const issues: string[] = [];
  rows.forEach((row, index) => {
    const line = Number.isFinite(row.runOrder) ? Number(row.runOrder) : index + 1;
    if (family === 'dimensional' && !String(row.partId ?? '').trim()) {
      issues.push(
        `Linha ${line}: o identificador da peça (part_id) é obrigatório para a família dimensional.`,
      );
    }
    const destructive = row.destructive === true || Number(row.destructive) === 1;
    if (destructive && !String(row.specimen ?? '').trim()) {
      issues.push(
        `Linha ${line}: medições destrutivas exigem a identificação do corpo de prova (specimen).`,
      );
    }
  });
  return issues;
}

const MAX_REPORTED_ISSUES = 8;

export function assertMeasurementIdentities(
  rows: MeasurementIdentity[],
  family: MethodFamily,
): void {
  const issues = validateMeasurementIdentities(rows, family);
  if (!issues.length) return;
  const visible = issues.slice(0, MAX_REPORTED_ISSUES);
  if (issues.length > visible.length) {
    visible.push(`… e mais ${issues.length - visible.length} problema(s).`);
  }
  throw new Error(visible.join(' '));
}
