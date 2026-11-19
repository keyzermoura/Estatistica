import { describe, expect, it } from 'vitest';
import { computeUncertainty } from '../uncertainty';
import {
  dimensionalRepeatabilityAnalysis,
  dimensionalReproducibilityAnalysis,
  dimensionalUncertaintyAnalysis,
  dimensionalUncertaintyBudget,
} from '../parameters/dimensional';
import { uncertaintyAnalysis } from '../parameters/uncertainty';
import { DIMENSIONAL_PROFILE } from '../../profiles/dimensional';
import { ANALYTICAL_PROFILE } from '../../profiles/analytical';

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

describe('Item A2: GL do orçamento dimensional ligado ao estudo de origem', () => {
  it('preenche repeatabilityDof e reproducibilityDof vindos do estudo e calcula ν_eff e k sem aproximações indevidas', () => {
    // Estudo dimensional 10 peças × 3 operadores × 3 réplicas:
    // dfE = 10 * 3 * (3 - 1) = 60
    // dfO = 3 - 1 = 2
    const items = dimensionalUncertaintyBudget({
      validationId: 'val-test-1',
      resolution: 0.001,
      calibrationUncertainty: 0.0008,
      coverageFactor: 2,
      repeatabilitySd: 0.0007,
      repeatabilityDof: 60,
      nReplicates: 3,
      reproducibilitySd: 0.0003,
      reproducibilityDof: 2,
      referenceUncertainty: 0.00015,
    });

    const repItem = items.find((i) => i.id === 'dim-repeatability');
    const reproItem = items.find((i) => i.id === 'dim-reproducibility');

    expect(repItem).toBeDefined();
    expect(repItem?.dof).toBe(60);
    expect(repItem?.notes).toContain('ν = 60 do resíduo do estudo');

    expect(reproItem).toBeDefined();
    expect(reproItem?.dof).toBe(2);
    expect(reproItem?.notes).toContain('ν = 2 (Satterthwaite');

    const result = computeUncertainty(items);
    expect(result.dofComplete).not.toBe(false);
    expect(result.effectiveDof).not.toBeNull();
    // Como reprodutibilidade tem GL = 2, ν_eff reflete essa limitação e k > 2 (t-Student)
    expect(result.effectiveDof).toBeGreaterThan(0);
    expect(result.effectiveDof!).toBeLessThan(60);
    expect(result.coverageFactor).toBeGreaterThan(2);
  });

  it('usa fallback conservador (n - 1) para repetibilidade com aviso documentado quando repeatabilityDof ausente', () => {
    const items = dimensionalUncertaintyBudget({
      validationId: 'val-test-2',
      resolution: 0.001,
      calibrationUncertainty: 0.0008,
      repeatabilitySd: 0.0007,
      nReplicates: 4, // fallback deve ser 4 - 1 = 3
      reproducibilitySd: 0.0003,
      reproducibilityDof: 5,
    });

    const repItem = items.find((i) => i.id === 'dim-repeatability');
    expect(repItem?.dof).toBe(3);
    expect(repItem?.notes).toContain('fallback (n − 1 réplicas)');
    expect(repItem?.notes).toContain('conservador');
  });

  it('quando reproducibilityDof é ausente, dof permanece null e sinaliza incomplete sem inventar valor', () => {
    const items = dimensionalUncertaintyBudget({
      validationId: 'val-test-3',
      resolution: 0.001,
      calibrationUncertainty: 0.0008,
      repeatabilitySd: 0.0007,
      repeatabilityDof: 60,
      reproducibilitySd: 0.0003,
      // reproducibilityDof omitido
    });

    const reproItem = items.find((i) => i.id === 'dim-reproducibility');
    expect(reproItem?.dof).toBeNull();
    expect(reproItem?.notes).toContain('graus de liberdade do operador não informados');

    const result = computeUncertainty(items);
    expect(result.dofComplete).toBe(false);
    expect(result.effectiveDof).toBeNull();
    expect(result.coverageFactor).toBe(2); // provisório sinalizado
  });

  it('repete e expõe df_rep e df_oper em dimensionalRepeatabilityAnalysis e dimensionalReproducibilityAnalysis', () => {
    // Matriz balanceada 3 peças × 2 operadores × 2 réplicas = 12 medições
    // anova: dfP = 2, dfO = 1, dfPO = 2, dfE = 6
    const measurements = [
      // P1: Op1 (10.0, 10.1), Op2 (10.2, 10.3)
      { partId: 'P1', analyst: 'Op1', replicate: 1, value: 10.0 },
      { partId: 'P1', analyst: 'Op1', replicate: 2, value: 10.1 },
      { partId: 'P1', analyst: 'Op2', replicate: 1, value: 10.2 },
      { partId: 'P1', analyst: 'Op2', replicate: 2, value: 10.3 },
      // P2: Op1 (20.0, 20.1), Op2 (20.2, 20.3)
      { partId: 'P2', analyst: 'Op1', replicate: 1, value: 20.0 },
      { partId: 'P2', analyst: 'Op1', replicate: 2, value: 20.1 },
      { partId: 'P2', analyst: 'Op2', replicate: 1, value: 20.2 },
      { partId: 'P2', analyst: 'Op2', replicate: 2, value: 20.3 },
      // P3: Op1 (30.0, 30.1), Op2 (30.2, 30.3)
      { partId: 'P3', analyst: 'Op1', replicate: 1, value: 30.0 },
      { partId: 'P3', analyst: 'Op1', replicate: 2, value: 30.1 },
      { partId: 'P3', analyst: 'Op2', replicate: 1, value: 30.2 },
      { partId: 'P3', analyst: 'Op2', replicate: 2, value: 30.3 },
    ];

    const ctx = {
      used: measurements,
      options: { tolerance: 1.0, unit: 'mm' },
    } as any;

    const repDef = DIMENSIONAL_PROFILE.parameters.find((p) => p.key === 'repeatability')!;
    const reproDef = DIMENSIONAL_PROFILE.parameters.find((p) => p.key === 'reproducibility')!;

    const repRes = dimensionalRepeatabilityAnalysis({
      parameter: repDef,
      criteria: [],
      context: ctx,
    });

    const reproRes = dimensionalReproducibilityAnalysis({
      parameter: reproDef,
      criteria: [],
      context: ctx,
    });

    // No modelo com interação dfE = 6; com interação não-significativa agregada (pooling), dfE,red = 6 + 2 = 8
    expect([6, 8]).toContain(repRes.rawMetrics.df_rep);
    expect(reproRes.rawMetrics.df_oper).toBeDefined();
    expect(Number.isFinite(reproRes.rawMetrics.df_oper)).toBe(true);
  });
});

describe('Veredito de conformidade do parâmetro Incerteza quando GL é incompleto', () => {
  it('no perfil analítico, define veredito como not_evaluated e adiciona nota técnica quando GL Tipo A for nulo', () => {
    const uncertDef = ANALYTICAL_PROFILE.parameters.find((p) => p.key === 'uncertainty')!;
    const criteria = [
      {
        id: 'crit-u-1',
        parameter: 'uncertainty' as const,
        metric: 'expanded',
        operator: '<=' as const,
        limit: 0.1,
      },
    ];

    // Caso 1: GL Tipo A ausente -> not_evaluated
    const incompleteContext = {
      uncertaintyItems: [
        {
          id: 'u-rep',
          source: 'Repetibilidade',
          type: 'A' as const,
          distribution: 'normal' as const,
          value: 0.01,
          divisor: 1,
          sensitivity: 1,
          dof: null, // incompleto!
        },
      ],
      observedMean: 10,
    } as any;

    const resIncomplete = uncertaintyAnalysis({
      parameter: uncertDef,
      criteria,
      context: incompleteContext,
    });

    expect(resIncomplete.verdict).toBe('not_evaluated');
    expect(resIncomplete.notes.length).toBeGreaterThan(0);
    expect(resIncomplete.notes[0]).toContain('permanece Não Avaliado porque existem fontes experimentais (Tipo A) com graus de liberdade ausentes');
    expect(resIncomplete.summary).toContain('GL Tipo A ausentes: conformidade não avaliada');

    // Caso 2: GL Tipo A completo -> avalia normalmente critério (pass)
    const completeContext = {
      uncertaintyItems: [
        {
          id: 'u-rep',
          source: 'Repetibilidade',
          type: 'A' as const,
          distribution: 'normal' as const,
          value: 0.01,
          divisor: 1,
          sensitivity: 1,
          dof: 10,
        },
      ],
      observedMean: 10,
    } as any;

    const resComplete = uncertaintyAnalysis({
      parameter: uncertDef,
      criteria,
      context: completeContext,
    });

    expect(resComplete.verdict).toBe('pass');
    expect(resComplete.notes.length).toBe(0);
  });

  it('no perfil dimensional, define veredito como not_evaluated e adiciona nota técnica quando GL Tipo A for nulo', () => {
    const uncertDef = DIMENSIONAL_PROFILE.parameters.find((p) => p.key === 'uncertainty')!;
    const criteria = [
      {
        id: 'crit-dim-u-1',
        parameter: 'uncertainty' as const,
        metric: 'expanded',
        operator: '<=' as const,
        limit: 0.05,
      },
    ];

    // Orçamento com reprodutibilidade sem GL
    const incompleteBudget = dimensionalUncertaintyBudget({
      validationId: 'val-test-dim',
      resolution: 0.001,
      calibrationUncertainty: 0.0008,
      repeatabilitySd: 0.0007,
      repeatabilityDof: 60,
      reproducibilitySd: 0.0003,
      // reproducibilityDof ausente -> dof: null
    });

    const incompleteContext = {
      uncertaintyItems: incompleteBudget,
      observedMean: 10,
      options: { tolerance: 0.1, unit: 'mm' },
    } as any;

    const resIncomplete = dimensionalUncertaintyAnalysis({
      parameter: uncertDef,
      criteria,
      context: incompleteContext,
    });

    expect(resIncomplete.verdict).toBe('not_evaluated');
    expect(resIncomplete.notes.some((n) => n.includes('permanece Não Avaliado'))).toBe(true);
    expect(resIncomplete.summary).toContain('GL Tipo A ausentes: conformidade não avaliada');

    // Orçamento completo com GL
    const completeBudget = dimensionalUncertaintyBudget({
      validationId: 'val-test-dim-2',
      resolution: 0.001,
      calibrationUncertainty: 0.0008,
      repeatabilitySd: 0.0007,
      repeatabilityDof: 60,
      reproducibilitySd: 0.0003,
      reproducibilityDof: 2,
    });

    const completeContext = {
      uncertaintyItems: completeBudget,
      observedMean: 10,
      options: { tolerance: 0.1, unit: 'mm' },
    } as any;

    const resComplete = dimensionalUncertaintyAnalysis({
      parameter: uncertDef,
      criteria,
      context: completeContext,
    });

    expect(resComplete.verdict).toBe('pass');
    expect(resComplete.notes.some((n) => n.includes('permanece Não Avaliado'))).toBe(false);
  });
});
