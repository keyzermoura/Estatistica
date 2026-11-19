import { describe, expect, it } from 'vitest';
import { computeUncertainty } from '../uncertainty';

describe('Item A1: Tratamento de graus de liberdade (GL) no orçamento GUM (JCGM 100 §G.4)', () => {
  // Caso ilustrativo:
  // u_rep = 0,002 (Tipo A, GL = 360)
  // u_reprod = 0,004 (Tipo A)
  // u_cal = ~0,0009955 (Tipo B, ν = ∞)
  // u_c = 0,0045816
  const uRep = 0.002;
  const uReprod = 0.004;
  const targetCombined = 0.0045816;
  const uCal = Math.sqrt(Math.max(0, targetCombined ** 2 - uRep ** 2 - uReprod ** 2));

  it('(i) Tipo A com GL nulo resulta em dofComplete: false, effectiveDof: null e k = 2 provisório (não ν_eff ≈ 9.922)', () => {
    const result = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: uRep, divisor: 1, dof: 360 },
      { source: 'Reprodutibilidade', type: 'A', distribution: 'normal', value: uReprod, divisor: 1, dof: null },
      { source: 'Calibração', type: 'B', distribution: 'normal', value: uCal, divisor: 1, dof: null },
    ]);

    expect(result.dofComplete).toBe(false);
    expect(result.effectiveDof).toBeNull();
    // Garante que não é calculado como se a reprodutibilidade tivesse GL infinito (~9.922)
    expect(result.effectiveDof).not.toBeCloseTo(9922, -2);
    expect(result.coverageFactor).toBe(2);
    expect(result.combined).toBeCloseTo(targetCombined, 5);
    expect(
      result.warnings.some((w) =>
        w.includes('Fonte(s) Tipo A com graus de liberdade ausentes ou inválidos'),
      ),
    ).toBe(true);
  });

  it('(ii) Tipo A com GL = 2 e GL = 1 produz ν_eff ≈ 3,44 e ≈ 1,72, com k ≈ 3,182 e ≈ 4,303', () => {
    // Subcaso: GL = 2
    const resDof2 = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: uRep, divisor: 1, dof: 360 },
      { source: 'Reprodutibilidade', type: 'A', distribution: 'normal', value: uReprod, divisor: 1, dof: 2 },
      { source: 'Calibração', type: 'B', distribution: 'normal', value: uCal, divisor: 1, dof: null },
    ]);

    expect(resDof2.dofComplete).not.toBe(false);
    expect(resDof2.effectiveDof).not.toBeNull();
    // Tolerância 1e-2 em ν_eff (3,44)
    expect(Math.abs((resDof2.effectiveDof ?? 0) - 3.44)).toBeLessThan(0.01);
    // Tolerância 1e-3 em k (3,182)
    expect(Math.abs(resDof2.coverageFactor - 3.182)).toBeLessThan(0.001);
    // Incerteza expandida U ≈ 0,01458 (+62% frente a k=1,96)
    expect(resDof2.expanded).toBeCloseTo(0.01458, 4);

    // Subcaso: GL = 1
    const resDof1 = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: uRep, divisor: 1, dof: 360 },
      { source: 'Reprodutibilidade', type: 'A', distribution: 'normal', value: uReprod, divisor: 1, dof: 1 },
      { source: 'Calibração', type: 'B', distribution: 'normal', value: uCal, divisor: 1, dof: null },
    ]);

    expect(resDof1.dofComplete).not.toBe(false);
    expect(resDof1.effectiveDof).not.toBeNull();
    // Tolerância 1e-2 em ν_eff (1,72)
    expect(Math.abs((resDof1.effectiveDof ?? 0) - 1.72)).toBeLessThan(0.01);
    // Tolerância 1e-3 em k (4,303)
    expect(Math.abs(resDof1.coverageFactor - 4.303)).toBeLessThan(0.001);
  });

  it('(iii) Tipo B sem GL continua aceito como ν = ∞ (JCGM 100 §G.4.2)', () => {
    // Apenas fontes Tipo B sem GL (dof: null ou Infinity)
    const onlyB = computeUncertainty([
      { source: 'Resolução', type: 'B', distribution: 'rectangular', value: 0.1, dof: null },
      { source: 'Calibração', type: 'B', distribution: 'normal', value: 0.05, dof: Infinity },
    ]);
    expect(onlyB.dofComplete).not.toBe(false);
    expect(onlyB.effectiveDof).toBe(1e6);
    expect(onlyB.coverageFactor).toBeCloseTo(1.96, 2);

    // Tipo A com GL válido + Tipo B sem GL
    const aAndB = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: 0.4, dof: 9 },
      { source: 'Resolução', type: 'B', distribution: 'rectangular', value: 0.3 * Math.sqrt(3), dof: null },
    ]);
    expect(aAndB.dofComplete).not.toBe(false);
    // u_c = 0.5; ν_eff = 0.5^4 / (0.4^4 / 9 + 0) = 21.97265625
    expect(aAndB.effectiveDof).toBeCloseTo(21.97265625, 6);
  });

  it('(iv) Regressão: casos com todos os GL informados fornecem exatamente os mesmos valores anteriores', () => {
    const res = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: 0.5, dof: 9 },
      { source: 'Calibração', type: 'B', distribution: 'rectangular', value: 0.2, dof: 5 },
    ]);
    const expectedCombined = Math.sqrt(0.5 ** 2 + (0.2 / Math.sqrt(3)) ** 2);
    expect(res.combined).toBeCloseTo(expectedCombined, 9);
    expect(res.dofComplete).not.toBe(false);
    expect(res.effectiveDof).toBeGreaterThan(0);
    expect(res.expanded).toBeGreaterThan(res.combined);
  });
});
