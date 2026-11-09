/**
 * Referências:
 * - T = USL − LSL; %P/T = 100·U/T; U/T = U/T; TUR/TAR = T/(2U).
 * - Convenção de alerta de 4:1 (TUR ≥ 4) e de 10% para %P/T, ambas editáveis.
 * - Os valores abaixo foram conferidos por cálculo direto.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE_CRITERIA,
  TOLERANCE_METRIC_DEFINITIONS,
  toleranceMetrics,
} from '../criteria';

const close = (actual: number | null, expected: number, tol = 1e-12) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
};

describe('métricas relativas à tolerância', () => {
  it('calcula T, %P/T, U/T e TUR/TAR', () => {
    const result = toleranceMetrics({
      lsl: 9,
      usl: 11,
      expandedUncertainty: 0.5,
    });
    close(result.tolerance, 2);
    close(result.pctPT, 25);
    close(result.uOverT, 0.25);
    close(result.tur, 2);
  });

  it('trata U = 0 como caso limite', () => {
    const result = toleranceMetrics({
      lsl: 9,
      usl: 11,
      expandedUncertainty: 0,
    });
    close(result.tolerance, 2);
    close(result.pctPT, 0);
    close(result.uOverT, 0);
    expect(result.tur).toBeNull();
  });

  it('não inventa denominador quando falta T ou U', () => {
    const semU = toleranceMetrics({ lsl: 9, usl: 11, expandedUncertainty: null });
    close(semU.tolerance, 2);
    expect(semU.pctPT).toBeNull();
    expect(semU.uOverT).toBeNull();
    expect(semU.tur).toBeNull();

    const unilateral = toleranceMetrics({
      lsl: 9,
      usl: null,
      expandedUncertainty: 0.5,
    });
    expect(unilateral.tolerance).toBeNull();
    expect(unilateral.pctPT).toBeNull();
    expect(unilateral.uOverT).toBeNull();
    expect(unilateral.tur).toBeNull();
  });

  it('rejeita tolerância inválida e incerteza negativa', () => {
    expect(() =>
      toleranceMetrics({ lsl: 11, usl: 9, expandedUncertainty: 0.5 }),
    ).toThrow(/LSL < USL/);
    expect(() =>
      toleranceMetrics({ lsl: 9, usl: 11, expandedUncertainty: -0.1 }),
    ).toThrow(/negativa/);
    expect(() =>
      toleranceMetrics({ lsl: Number.NaN, usl: 11, expandedUncertainty: 0.5 }),
    ).toThrow(/finito/);
  });

  it('expõe definições editáveis com os limiares sugeridos', () => {
    expect(TOLERANCE_METRIC_DEFINITIONS.map((definition) => definition.key)).toEqual([
      'pct_pt',
      'u_over_t',
      'tur',
    ]);
    expect(TOLERANCE_METRIC_DEFINITIONS[0].suggested).toMatchObject({
      operator: '<=',
      limit: DEFAULT_TOLERANCE_CRITERIA.pctPTMaximum,
    });
    expect(TOLERANCE_METRIC_DEFINITIONS[1].suggested).toMatchObject({
      operator: '<=',
      limit: DEFAULT_TOLERANCE_CRITERIA.uOverTMaximum,
    });
    expect(TOLERANCE_METRIC_DEFINITIONS[2].suggested).toMatchObject({
      operator: '>=',
      limit: DEFAULT_TOLERANCE_CRITERIA.turMinimum,
    });
  });
});
