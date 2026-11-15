import { describe, expect, it } from 'vitest';
import { validateConformityForm } from '../conformityValidation';

describe('validateConformityForm', () => {
  it('aprova parâmetros bilaterais válidos com banda de guarda', () => {
    const result = validateConformityForm({
      lslInput: '9.8',
      uslInput: '10.2',
      rule: 'guard_band',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.95,
      massFractionInput: '',
      processVariationInput: '',
    });

    expect(result.isValid).toBe(true);
    expect(result.firstError).toBeNull();
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('rejeita quando LSL >= USL', () => {
    const result = validateConformityForm({
      lslInput: '10.5',
      uslInput: '10.2',
      rule: 'guard_band',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.95,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.limits).toContain('deve ser estritamente menor');
    expect(result.firstError).toContain('deve ser estritamente menor');
  });

  it('rejeita fator g de banda de guarda negativo', () => {
    const result = validateConformityForm({
      lslInput: '9.8',
      uslInput: '10.2',
      rule: 'guard_band',
      guardBandFactor: -0.5,
      probabilityThreshold: 0.95,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.guardBandFactor).toContain('maior ou igual a zero');
  });

  it('rejeita limiar de probabilidade fora de [0.5, 1.0)', () => {
    const resultLow = validateConformityForm({
      lslInput: '9.8',
      uslInput: '10.2',
      rule: 'probability',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.4,
    });
    expect(resultLow.isValid).toBe(false);
    expect(resultLow.errors.probabilityThreshold).toContain('entre 0,50');

    const resultHigh = validateConformityForm({
      lslInput: '9.8',
      uslInput: '10.2',
      rule: 'probability',
      guardBandFactor: 1.0,
      probabilityThreshold: 1.05,
    });
    expect(resultHigh.isValid).toBe(false);
    expect(resultHigh.errors.probabilityThreshold).toContain('entre 0,50');
  });

  it('rejeita variação de processo ou fração mássica não positivas', () => {
    const result = validateConformityForm({
      lslInput: '',
      uslInput: '100',
      rule: 'simple_acceptance',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.95,
      processVariationInput: '-2',
      massFractionInput: '0',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.processVariation).toBeDefined();
    expect(result.errors.massFraction).toBeDefined();
  });

  it('permite limites unilaterais válidos', () => {
    const resultUnilateralLower = validateConformityForm({
      lslInput: '95',
      uslInput: '',
      rule: 'simple_acceptance',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.95,
    });
    expect(resultUnilateralLower.isValid).toBe(true);

    const resultUnilateralUpper = validateConformityForm({
      lslInput: '',
      uslInput: '105',
      rule: 'simple_acceptance',
      guardBandFactor: 1.0,
      probabilityThreshold: 0.95,
    });
    expect(resultUnilateralUpper.isValid).toBe(true);
  });
});
