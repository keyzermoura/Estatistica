import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_INPUT,
  type Measurement,
  type UncertaintyItem,
  type ValidationParameter,
} from '../../lib/types';
import { getProfileForFamily, getProfileForMethod } from '../../profiles/index';
import { PHYSICAL_DESTRUCTIVE_PROFILE } from '../../profiles/physical-destructive';
import { PHYSICAL_NONDESTRUCTIVE_PROFILE } from '../../profiles/physical-nondestructive';
import type { PhysicalParamKey } from '../../profiles/physical-common';
import { analyzeValidation } from '../analysis';
import { buildDesign } from '../design';
import {
  gageRRNested,
  NESTED_DESTRUCTIVE_WARNING,
  type GageRRNestedResult,
} from '../nested';
import { evaluateNonNormalityAndOptions } from '../normality';
import {
  analyzeEnvironmentalConditions,
  physicalUncertaintyBudget,
} from '../parameters/physical';
import { planForParameter } from '../sampleSize';

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm-1',
    validationId: 'v-physical',
    runOrder: 1,
    level: '',
    analyst: '',
    day: '',
    equipment: '',
    lot: '',
    sample: '',
    partId: '',
    specimen: '',
    destructive: false,
    refValue: null,
    refUncertainty: null,
    replicate: 1,
    value: null,
    referenceValue: null,
    textValue: '',
    notes: '',
    ...overrides,
  };
}

function physicalParameters(
  profileId: 'physical-destructive' | 'physical-nondestructive',
  keys: PhysicalParamKey[],
): ValidationParameter[] {
  const profile =
    profileId === 'physical-destructive'
      ? PHYSICAL_DESTRUCTIVE_PROFILE
      : PHYSICAL_NONDESTRUCTIVE_PROFILE;
  return keys.map((key) => ({
    validationId: `v-${profileId}`,
    key,
    selected: true,
    justification: `Avaliação de ${key}`,
    criteria: profile.defaultCriteria[key] ?? [],
  }));
}

function uncertaintyItems(): UncertaintyItem[] {
  return [
    {
      id: 'u-cal',
      validationId: 'v-physical',
      source: 'Calibração da máquina universal',
      type: 'B',
      distribution: 'normal',
      value: 0.4,
      divisor: 2,
      sensitivity: 1,
      stdUncertainty: 0.2,
      dof: 30,
      notes: 'Certificado',
    },
    {
      id: 'u-res',
      validationId: 'v-physical',
      source: 'Resolução',
      type: 'B',
      distribution: 'rectangular',
      value: 0.05,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.05 / Math.sqrt(3),
      dof: null,
      notes: 'Divisor retangular',
    },
    {
      id: 'u-rep',
      validationId: 'v-physical',
      source: 'Repetibilidade',
      type: 'A',
      distribution: 'normal',
      value: 0.35,
      divisor: 1,
      sensitivity: 1,
      stdUncertainty: 0.35,
      dof: 29,
      notes: 'Estudo piloto',
    },
  ];
}

/** 3 operadores × 5 amostras/operador × 3 corpos de prova únicos = 45 medições destrutivas. */
function destructiveMeasurements(): Measurement[] {
  const operators = ['Op1', 'Op2', 'Op3'];
  const sampleBases = [94, 97, 100, 103, 106];
  const out: Measurement[] = [];
  let order = 0;
  operators.forEach((op, opIndex) => {
    sampleBases.forEach((base, sampleIndex) => {
      for (let rep = 1; rep <= 3; rep++) {
        order += 1;
        out.push(
          measurement({
            id: `d-${order}`,
            runOrder: order,
            analyst: op,
            lot: 'Lote-01',
            sample: `${op}-A${sampleIndex + 1}`,
            specimen: `CP-${String(order).padStart(3, '0')}`,
            destructive: true,
            replicate: rep,
            value: Number((base + (opIndex - 1) * 0.1 + (rep - 2) * 0.2).toFixed(2)),
          }),
        );
      }
    });
  });
  return out;
}

/**
 * Lote heterogêneo para a verificação de homogeneidade: 2 operadores ×
 * 2 amostras × 3 corpos de prova. A amostra A-2 tem dispersão muito maior.
 */
function heterogeneousLotMeasurements(): Measurement[] {
  const operators = ['Op1', 'Op2'];
  const sampleValues: Record<string, number[]> = {
    'A-1': [9.9, 10.0, 10.1],
    'A-2': [4.0, 10.0, 16.0],
  };
  const out: Measurement[] = [];
  let order = 0;
  operators.forEach((operator, operatorIndex) => {
    Object.entries(sampleValues).forEach(([sample, values]) => {
      values.forEach((value, replicateIndex) => {
        order += 1;
        out.push(
          measurement({
            id: `h-${order}`,
            runOrder: order,
            analyst: operator,
            lot: 'Lote-heterogeneo',
            sample,
            specimen: `CP-H-${String(order).padStart(3, '0')}`,
            destructive: true,
            replicate: replicateIndex + 1,
            value: Number((value + operatorIndex * 0.01).toFixed(2)),
          }),
        );
      });
    });
  });
  return out;
}

/** Medições com padrões de referência ao longo dos dias para tendência, linearidade e estabilidade. */
function referenceMeasurements(startOrder: number): Measurement[] {
  const refs = [90, 100, 110];
  const out: Measurement[] = [];
  let order = startOrder;
  refs.forEach((ref) => {
    for (let rep = 1; rep <= 3; rep++) {
      order += 1;
      out.push(
        measurement({
          id: `ref-${order}`,
          runOrder: order,
          day: `D${rep}`,
          analyst: 'Op1',
          sample: `Pad-${ref}`,
          refValue: ref,
          refUncertainty: 0.2,
          replicate: rep,
          value: Number((ref + 0.05 * (rep - 2)).toFixed(2)),
        }),
      );
    }
  });
  return out;
}

/** Gage R&R cruzado para perfil físico não destrutivo: 5 peças × 3 operadores × 2 réplicas. */
function nonDestructiveMeasurements(): Measurement[] {
  const partMeans = [94, 97, 100, 103, 106];
  const operators = ['Op1', 'Op2', 'Op3'];
  const out: Measurement[] = [];
  let order = 0;
  partMeans.forEach((partMean, partIndex) => {
    operators.forEach((op, opIndex) => {
      for (let rep = 1; rep <= 2; rep++) {
        order += 1;
        out.push(
          measurement({
            id: `nd-${order}`,
            runOrder: order,
            partId: `P-${partIndex + 1}`,
            sample: `P-${partIndex + 1}`,
            analyst: op,
            destructive: false,
            replicate: rep,
            value: Number((partMean + (opIndex - 1) * 0.08 + (rep - 1.5) * 0.15).toFixed(3)),
          }),
        );
      }
    });
  });
  return out;
}

describe('perfis físicos (destrutivo e não destrutivo)', () => {
  it('registra e seleciona os perfis physical-destructive e physical-nondestructive', () => {
    const destructive = getProfileForFamily('physical-destructive');
    const nonDestructive = getProfileForFamily('physical-nondestructive');

    expect(destructive.id).toBe('physical-destructive');
    expect(nonDestructive.id).toBe('physical-nondestructive');
    expect(getProfileForMethod({ family: 'physical-destructive' } as never).id).toBe(
      'physical-destructive',
    );
    expect(getProfileForMethod({ family: 'physical-nondestructive' } as never).id).toBe(
      'physical-nondestructive',
    );
    expect(destructive.defaultDesignType).toBe('nested_destructive');
    expect(nonDestructive.defaultDesignType).toBe('gage_rr');
    expect(destructive.designTemplates[0]?.designType).toBe('nested_destructive');
    expect(nonDestructive.designTemplates[0]?.designType).toBe('gage_rr');
  });

  it('gera plano aninhado destrutivo com corpos de prova únicos e consumo calculado', () => {
    const plan = buildDesign(
      {
        ...DEFAULT_DESIGN_INPUT,
        designType: 'nested_destructive',
        nAnalysts: 3,
        nSamples: 5,
        nReplicates: 3,
        sigma: 0.4,
        relativeSdError: 0.2,
      },
      {
        profileId: 'physical-destructive',
        selected: ['repeatability', 'reproducibility', 'uncertainty', 'conformity'],
      },
    );

    expect(plan.specimenConsumption).toEqual({
      operators: 3,
      samplesPerOperator: 5,
      replicates: 3,
      total: 45,
    });
    expect(plan.runs).toHaveLength(45);
    expect(plan.runs.every((run) => run.destructive === true && Boolean(run.specimen))).toBe(true);
    const specimens = new Set(plan.runs.map((run) => run.specimen));
    expect(specimens.size).toBe(45);
    expect(plan.warnings).toContain(NESTED_DESTRUCTIVE_WARNING);

    const paramPlan = planForParameter('repeatability', {
      sigma: 0.4,
      effect: 0.5,
      margin: 0.5,
      confidence: 0.95,
      power: 0.8,
      alpha: 0.05,
      relativeSdError: 0.2,
      varianceRatio: 1.5,
      betweenLabRatio: 1,
      nLevels: 5,
      nReplicates: 3,
      nAnalysts: 3,
      nDays: 3,
      nLabs: 3,
      nSamples: 5,
      designType: 'nested_destructive',
      profileId: 'physical-destructive',
    });
    expect(paramPlan.method).toBe('nested');
    expect(paramPlan.total).toBe(45);
  });

  it('avalia todos os parâmetros do perfil physical-destructive com Gage R&R aninhado, tendência, estabilidade e conformidade', () => {
    const destRows = destructiveMeasurements();
    const refRows = referenceMeasurements(destRows.length);
    const allKeys: PhysicalParamKey[] = [
      'repeatability',
      'reproducibility',
      'bias',
      'linearity',
      'stability',
      'resolution',
      'uncertainty',
      'conformity',
    ];
    const analysis = analyzeValidation(
      physicalParameters('physical-destructive', allKeys),
      [...destRows, ...refRows],
      [],
      {
        profileId: 'physical-destructive',
        lsl: 80,
        usl: 120,
        processVariation: 20,
        resolution: 0.1,
        unit: 'N',
        uncertaintyItems: uncertaintyItems(),
        conformity: { rule: 'guard_band', value: 100 },
      },
    );

    expect(analysis.parameters).toHaveLength(8);
    expect(
      analysis.parameters
        .filter((param) => param.verdict === 'not_evaluated')
        .map((param) => [param.key, param.summary]),
    ).toEqual([]);
    const rep = analysis.parameters.find((p) => p.key === 'repeatability')!;
    const repro = analysis.parameters.find((p) => p.key === 'reproducibility')!;
    const unc = analysis.parameters.find((p) => p.key === 'uncertainty')!;
    const conf = analysis.parameters.find((p) => p.key === 'conformity')!;

    expect(rep.results.study).toBe('nested_destructive');
    expect(rep.rawMetrics.grr_pct).toBeLessThan(10);
    expect(rep.rawMetrics.ndc).toBeGreaterThanOrEqual(5);
    expect(repro.rawMetrics.pt_pct).toBeLessThan(10);
    expect(unc.rawMetrics.tur).toBeGreaterThan(4);
    expect(conf.verdict).toBe('pass');
  });

  it('rejeita corpo de prova duplicado ou campos ausentes no estudo destrutivo', () => {
    const duplicated = destructiveMeasurements();
    duplicated[1] = { ...duplicated[1], specimen: duplicated[0].specimen };
    const dupAnalysis = analyzeValidation(
      physicalParameters('physical-destructive', ['repeatability', 'reproducibility']),
      duplicated,
      [],
      { profileId: 'physical-destructive', lsl: 80, usl: 120 },
    );
    expect(dupAnalysis.parameters[0].verdict).toBe('not_evaluated');
    expect(dupAnalysis.parameters[0].summary).toContain('Corpo de prova duplicado');
    expect(dupAnalysis.parameters[1].verdict).toBe('not_evaluated');

    const missingSpecimen = destructiveMeasurements().map((m, i) =>
      i === 0 ? { ...m, specimen: '' } : m,
    );
    const missSpecAnalysis = analyzeValidation(
      physicalParameters('physical-destructive', ['repeatability']),
      missingSpecimen,
      [],
      { profileId: 'physical-destructive' },
    );
    expect(missSpecAnalysis.parameters[0].verdict).toBe('not_evaluated');
    expect(missSpecAnalysis.parameters[0].summary).toContain('não têm corpo de prova');

    const unbalanced = destructiveMeasurements().slice(0, -1);
    const unbalAnalysis = analyzeValidation(
      physicalParameters('physical-destructive', ['repeatability']),
      unbalanced,
      [],
      { profileId: 'physical-destructive' },
    );
    expect(unbalAnalysis.parameters[0].verdict).toBe('not_evaluated');
    expect(unbalAnalysis.parameters[0].summary).toContain('desbalanceado');
  });

  it('avalia o perfil physical-nondestructive via Gage R&R cruzado e exige peça para precisão', () => {
    const ndRows = nonDestructiveMeasurements();
    const refRows = referenceMeasurements(ndRows.length);
    const analysis = analyzeValidation(
      physicalParameters('physical-nondestructive', [
        'repeatability',
        'reproducibility',
        'bias',
        'linearity',
        'stability',
        'resolution',
        'uncertainty',
        'conformity',
      ]),
      [...ndRows, ...refRows],
      [],
      {
        profileId: 'physical-nondestructive',
        lsl: 80,
        usl: 120,
        processVariation: 20,
        resolution: 0.1,
        unit: 'MPa',
        uncertaintyItems: uncertaintyItems(),
        conformity: { rule: 'guard_band', value: 100 },
      },
    );

    const rep = analysis.parameters.find((p) => p.key === 'repeatability')!;
    const repro = analysis.parameters.find((p) => p.key === 'reproducibility')!;
    expect(rep.results.study).toBe('gage_rr');
    expect(rep.verdict).toBe('pass');
    expect(repro.verdict).toBe('pass');
    expect(
      analysis.parameters
        .filter((p) => p.verdict === 'not_evaluated')
        .map((p) => [p.key, p.summary]),
    ).toEqual([]);

    const withoutPartId = ndRows.map((m) => ({ ...m, partId: '' }));
    const missingPart = analyzeValidation(
      physicalParameters('physical-nondestructive', ['repeatability']),
      withoutPartId,
      [],
      { profileId: 'physical-nondestructive', lsl: 80, usl: 120 },
    );
    expect(missingPart.parameters[0].verdict).toBe('not_evaluated');
    expect(missingPart.parameters[0].summary).toContain('Peça');
  });

  it('suporta especificação estritamente unilateral (LSL-only) e conformidade dupla compendial (individualLsl)', () => {
    const dRows = destructiveMeasurements();
    const refRows = referenceMeasurements(dRows.length);
    const params = physicalParameters('physical-destructive', [
      'resolution',
      'bias',
      'linearity',
      'stability',
      'repeatability',
      'reproducibility',
      'uncertainty',
      'conformity',
    ]);

    const unilateralPass = analyzeValidation(params, [...dRows, ...refRows], [], {
      profileId: 'physical-destructive',
      lsl: 26.8,
      usl: null,
      resolution: 0.01,
      unit: 'N',
      uncertaintyItems: uncertaintyItems(),
      conformity: {
        rule: 'guard_band',
        coverageFactor: 2,
        guardBandFactor: 1,
        individualLsl: 13.4,
      },
    });

    expect(
      unilateralPass.parameters
        .filter((p) => p.verdict !== 'pass')
        .map((p) => [p.key, p.verdict, p.summary]),
    ).toEqual([]);
    const conformityPass = unilateralPass.parameters.find((p) => p.key === 'conformity')!;
    expect(conformityPass.rawMetrics.individual_lsl).toBe(13.4);
    expect(conformityPass.rawMetrics.individual_below_count).toBe(0);

    const withFailingSpecimen = dRows.map((row, index) =>
      index === 0 ? { ...row, value: 12.9 } : row,
    );
    const unilateralFail = analyzeValidation(
      physicalParameters('physical-destructive', ['conformity']),
      [...withFailingSpecimen, ...refRows],
      [],
      {
        profileId: 'physical-destructive',
        lsl: 26.8,
        usl: null,
        resolution: 0.01,
        unit: 'N',
        uncertaintyItems: uncertaintyItems(),
        conformity: {
          rule: 'guard_band',
          coverageFactor: 2,
          guardBandFactor: 1,
          individualLsl: 13.4,
        },
      },
    );

    const conformityFail = unilateralFail.parameters[0];
    expect(conformityFail.verdict).toBe('fail');
    expect(conformityFail.rawMetrics.individual_below_count).toBe(1);
    expect(conformityFail.summary).toContain('abaixo do LSL individual');
  });

  it('bloqueia homogeneidade rejeitada sem justificativa e aceita com justificativa registrada', () => {
    const matrix = [
      [
        [10.0, 10.1, 9.9],
        [10.2, 10.1, 10.3],
      ],
      [
        [10.1, 10.0, 10.2],
        [10.3, 10.2, 10.4],
      ],
    ];
    const heterogeneousGroups = [
      [10.0, 10.0, 10.0],
      [10.0, 10.1, 9.9],
      [10.0, 16.0, 4.0],
    ];

    expect(() =>
      gageRRNested(
        { y: matrix, tolerance: 2 },
        { homogeneity: { groups: heterogeneousGroups, justification: '   ' } },
      ),
    ).toThrow(/Homogeneidade do lote rejeitada/);

    const justified = gageRRNested(
      { y: matrix, tolerance: 2 },
      {
        homogeneity: {
          groups: heterogeneousGroups,
          justification: 'Dispersão decorrente de sublotes certificados no histórico do fornecedor.',
        },
      },
    );
    expect(justified.homogeneity?.homogeneous).toBe(false);
    expect(justified.warnings.some((w) => w.includes('Dispersão decorrente de sublotes'))).toBe(true);
  });

  it('conecta a homogeneidade do lote ao fluxo fisico destrutivo', () => {
    const parameters = physicalParameters('physical-destructive', ['repeatability']);
    const rows = heterogeneousLotMeasurements();

    const defaults = analyzeValidation(parameters, rows, [], {
      profileId: 'physical-destructive',
    });
    const defaultParameter = defaults.parameters[0];
    expect(defaultParameter.verdict).not.toBe('not_evaluated');
    const defaultNested = defaultParameter.results.gageRRNested as GageRRNestedResult;
    expect(defaultNested.homogeneity).toBeNull();
    expect(
      defaultParameter.warnings.some((warning) =>
        warning.includes('Homogeneidade do lote não avaliada'),
      ),
    ).toBe(true);

    const withoutJustification = analyzeValidation(parameters, rows, [], {
      profileId: 'physical-destructive',
      homogeneity: { enabled: true },
    });
    expect(withoutJustification.parameters[0].verdict).toBe('not_evaluated');
    expect(withoutJustification.parameters[0].summary).toContain(
      'Homogeneidade do lote rejeitada',
    );

    const withJustification = analyzeValidation(parameters, rows, [], {
      profileId: 'physical-destructive',
      homogeneity: {
        enabled: true,
        justification:
          'Sublotes certificados com dispersão distinta no histórico do fornecedor.',
      },
    });
    const justifiedParameter = withJustification.parameters[0];
    expect(justifiedParameter.verdict).not.toBe('not_evaluated');
    const justifiedNested =
      justifiedParameter.results.gageRRNested as GageRRNestedResult;
    expect(justifiedNested.homogeneity?.homogeneous).toBe(false);
    expect(justifiedNested.homogeneity?.justified).toBe(true);
    expect(
      justifiedParameter.tables.some((table) => table.title === 'Homogeneidade do lote'),
    ).toBe(true);
    expect(
      justifiedParameter.warnings.some((warning) =>
        warning.includes('Sublotes certificados'),
      ),
    ).toBe(true);
  });

  it('diagnostica não normalidade sem transformar automaticamente e calcula intervalo não paramétrico de Wilks', () => {
    // Série exponencial/assimétrica à direita (n = 12) onde S-W e A-D rejeitam normalidade,
    // mas ln(x) aproxima-se da normalidade.
    const skewed = [1.0, 1.1, 1.2, 1.4, 1.8, 2.5, 4.0, 7.2, 14.0, 29.0, 62.0, 135.0];
    const noAuto = evaluateNonNormalityAndOptions(skewed, { alpha: 0.05, targetCoverage: 0.95 });
    expect(noAuto.bothRejected).toBe(true);
    expect(noAuto.logTransform.applied).toBe(false);
    expect(noAuto.logTransform.transformedValues).toBeNull();
    expect(noAuto.logTransform.geometricMean).not.toBeNull();
    expect(noAuto.logTransform.shapiroOnLog?.normal).toBe(true);
    expect(noAuto.nonParametricTolerance).not.toBeNull();
    expect(noAuto.nonParametricTolerance?.lower).toBe(1.0);
    expect(noAuto.nonParametricTolerance?.upper).toBe(135.0);
    expect(noAuto.nonParametricTolerance?.recommendedMinN).toBe(93);

    const n = skewed.length;
    const q = 0.95;
    const expectedConf = 1 - n * Math.pow(q, n - 1) + (n - 1) * Math.pow(q, n);
    expect(noAuto.nonParametricTolerance?.achievedConfidence ?? 0).toBeCloseTo(expectedConf, 9);

    const explicitLog = evaluateNonNormalityAndOptions(skewed, {
      alpha: 0.05,
      applyLogTransform: true,
    });
    expect(explicitLog.logTransform.applied).toBe(true);
    expect(explicitLog.logTransform.transformedValues).toHaveLength(skewed.length);
  });

  it('detecta covariável ambiental significativa e gera orçamento-modelo físico', () => {
    const temps = [18, 19, 20, 21, 22, 23, 24, 25];
    const tempMeasurements: Measurement[] = temps.map((t, index) =>
      measurement({
        id: `env-${index}`,
        runOrder: index + 1,
        value: 30 + (t - 20) * 0.8 + (index % 2 === 0 ? 0.02 : -0.02),
        condition: { temperature: t, humidity: 50, testSpeed: 100, other: '' },
      }),
    );

    const env = analyzeEnvironmentalConditions(tempMeasurements, 'N');
    expect(env.covariates.length).toBeGreaterThanOrEqual(1);
    const tempCov = env.covariates.find((c) => c.covariate === 'temperature');
    expect(tempCov).toBeDefined();
    expect(tempCov?.significant).toBe(true);
    expect(tempCov?.regression.slopeP).toBeLessThan(0.05);
    expect(env.warnings.some((w) => w.includes('Efeito ambiental significativo'))).toBe(true);
    expect(env.tables).toHaveLength(1);

    const budget = physicalUncertaintyBudget({
      validationId: 'v-physical',
      resolution: 0.1,
      calibrationUncertainty: 0.08,
      coverageFactor: 2,
      repeatabilitySd: 0.3,
      nReplicates: 5,
      reproducibilitySd: 0.15,
      lotHeterogeneitySd: 0.4,
      alignment: 0.05,
      testSpeed: 0.05,
      temperatureEffect: 0.1,
    });
    expect(budget.length).toBeGreaterThanOrEqual(8);
    expect(budget.every((item) => item.stdUncertainty > 0)).toBe(true);
    expect(budget.some((item) => item.type === 'A')).toBe(true);
    expect(budget.some((item) => item.type === 'B')).toBe(true);
  });
});
