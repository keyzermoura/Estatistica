import type { ConformityRule } from '../stats/conformity';

export interface ConformityFormErrors {
  lsl?: string;
  usl?: string;
  limits?: string;
  guardBandFactor?: string;
  probabilityThreshold?: string;
  massFraction?: string;
  processVariation?: string;
  individualLsl?: string;
}

export interface ConformityValidationResult {
  isValid: boolean;
  errors: ConformityFormErrors;
  firstError: string | null;
}

export interface ConformityFormValues {
  lslInput: string;
  uslInput: string;
  rule: ConformityRule;
  guardBandFactor: number;
  probabilityThreshold: number;
  massFractionInput?: string;
  processVariationInput?: string;
  individualLslInput?: string;
}

/**
 * Valida de forma centralizada os parâmetros de limites de tolerância e regras de decisão
 * conforme Eurachem 2021, ILAC-G8:09/2019 e JCGM 106:2012.
 */
export function validateConformityForm(values: ConformityFormValues): ConformityValidationResult {
  const errors: ConformityFormErrors = {};

  // 1. Limites de tolerância (LSL e USL)
  const lslTrim = values.lslInput.trim();
  const uslTrim = values.uslInput.trim();

  let parsedLsl: number | null = null;
  let parsedUsl: number | null = null;

  if (lslTrim !== '') {
    const n = Number(lslTrim);
    if (!Number.isFinite(n)) {
      errors.lsl = 'O limite inferior (LSL) deve ser um número válido.';
    } else {
      parsedLsl = n;
    }
  }

  if (uslTrim !== '') {
    const n = Number(uslTrim);
    if (!Number.isFinite(n)) {
      errors.usl = 'O limite superior (USL) deve ser um número válido.';
    } else {
      parsedUsl = n;
    }
  }

  if (parsedLsl !== null && parsedUsl !== null) {
    if (parsedLsl >= parsedUsl) {
      const msg = `O limite inferior (${parsedLsl}) deve ser estritamente menor que o limite superior (${parsedUsl}).`;
      errors.limits = msg;
      errors.lsl = errors.lsl ?? msg;
      errors.usl = errors.usl ?? msg;
    }
  }

  // 2. Fator da banda de guarda g (w = g · U)
  if (values.rule === 'guard_band') {
    if (
      !Number.isFinite(values.guardBandFactor) ||
      values.guardBandFactor < 0
    ) {
      errors.guardBandFactor = 'O fator de banda de guarda g deve ser um número maior ou igual a zero (ex.: g = 1,0).';
    } else if (values.guardBandFactor > 10) {
      errors.guardBandFactor = 'O fator de banda de guarda g é excessivamente alto (máximo recomendado: 5,0).';
    }
  }

  // 3. Limiar de probabilidade de conformidade p*
  if (values.rule === 'probability') {
    if (
      !Number.isFinite(values.probabilityThreshold) ||
      values.probabilityThreshold < 0.5 ||
      values.probabilityThreshold >= 1.0
    ) {
      errors.probabilityThreshold = 'O limiar de probabilidade p* deve estar entre 0,50 (50%) e 0,999 (99,9%).';
    }
  }

  // 4. Fração mássica (opcional para incerteza-alvo Thompson-Howarth / Horwitz)
  const mfTrim = values.massFractionInput?.trim();
  if (mfTrim && mfTrim !== '') {
    const mf = Number(mfTrim);
    if (!Number.isFinite(mf) || mf <= 0) {
      errors.massFraction = 'A fração mássica deve ser um número estritamente positivo (ex.: 0,001 para 0,1%).';
    }
  }

  // 5. Variação do processo 6σ_p (opcional)
  const pvTrim = values.processVariationInput?.trim();
  if (pvTrim && pvTrim !== '') {
    const pv = Number(pvTrim);
    if (!Number.isFinite(pv) || pv <= 0) {
      errors.processVariation = 'A variação do processo 6σ_p deve ser um número estritamente positivo.';
    }
  }

  // 6. LSL individual (opcional)
  const indLslTrim = values.individualLslInput?.trim();
  if (indLslTrim && indLslTrim !== '') {
    const ind = Number(indLslTrim);
    if (!Number.isFinite(ind)) {
      errors.individualLsl = 'O LSL individual deve ser um número válido.';
    }
  }

  const errorKeys = Object.keys(errors) as Array<keyof ConformityFormErrors>;
  const isValid = errorKeys.length === 0;
  const firstError = isValid ? null : (errors[errorKeys[0]] ?? null);

  return {
    isValid,
    errors,
    firstError,
  };
}
