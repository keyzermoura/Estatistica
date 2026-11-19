import { describe, expect, it } from 'vitest';
import type { Measurement } from '../../lib/types';
import type { ParameterDef } from '../../profiles/types';
import type { AnalysisContext } from '../analysis-types';
import {
  dimensionalRepeatabilityAnalysis,
  dimensionalReproducibilityAnalysis,
  dimensionalUncertaintyBudget,
} from '../parameters/dimensional';
import { computeUncertainty } from '../uncertainty';

function createMockMeasurement(
  id: string,
  partId: string,
  analyst: string,
  day: string,
  replicate: number,
  value: number,
): Measurement {
  return {
    id,
    validationId: 'val-nested-test',
    runOrder: 1,
    level: '1',
    analyst,
    day,
    equipment: 'Paquimetro',
    lot: 'L1',
    sample: 'S1',
    partId,
    replicate,
    value,
    textValue: String(value),
    notes: '',
  };
}

function createMockContext(
  measurements: Measurement[],
  options: AnalysisContext['options'] = {},
): AnalysisContext {
  return {
    all: measurements,
    used: measurements,
    values: measurements.map((m) => m.value!).filter(Number.isFinite),
    options,
    uniqueLevels: [],
    regressionPoints: [],
    regression: null,
    iso5725: null,
    uncertaintyItems: [],
    observedMean: 10.0,
    attributeData: null,
    attributeStudy: null,
    attributeError: null,
  };
}

describe('Modelo Aninhado Dia > Peça > Réplica no Perfil Dimensional (Etapa D3)', () => {
  const repParamDef: ParameterDef = {
    key: 'repeatability',
    label: 'Repetibilidade',
    shortDescription: 'Repetibilidade dimensional',
    reference: 'AIAG MSA (2010)',
    metrics: [
      { key: 'sigma_rep', label: 'σ_rep', unit: 'mm' },
      { key: 'ev_pct', label: '%EV', unit: '%' },
      { key: 'grr_pct', label: '%GRR', unit: '%' },
      { key: 'ndc', label: 'ndc', unit: '' },
    ],
  };

  const reproParamDef: ParameterDef = {
    key: 'reproducibility',
    label: 'Reprodutibilidade',
    shortDescription: 'Reprodutibilidade dimensional',
    reference: 'AIAG MSA (2010)',
    metrics: [
      { key: 'sigma_oper', label: 'σ_oper', unit: 'mm' },
      { key: 'oper_pct', label: '%AV', unit: '%' },
      { key: 'grr_pct', label: '%GRR', unit: '%' },
      { key: 'pt_pct', label: '%P/T', unit: '%' },
      { key: 'ndc', label: 'ndc', unit: '' },
    ],
  };

  /**
   * Conjunto sintético determinístico com parâmetros teóricos conhecidos:
   * 2 dias (a = 2), 12 peças por dia (b = 12, 24 peças distintas no total), 3 réplicas (n = 3)
   * N = 2 * 12 * 3 = 72 medições.
   *
   * Modelo: y_ijk = μ + D_i + P_j(i) + e_k(ij)
   * μ = 10.0
   * Dia 1: D_1 = -0.05
   * Dia 2: D_2 = +0.05
   * Peças: P_j = offset determinístico (-0.2 a +0.2)
   * Réplicas: e_k = offset determinístico (-0.01, 0, +0.01)
   */
  function generateDeterministicNestedData(): {
    measurements: Measurement[];
    a: number;
    b: number;
    n: number;
  } {
    const measurements: Measurement[] = [];
    const a = 2;
    const b = 12;
    const n = 3;
    let count = 0;

    for (let d = 1; d <= a; d++) {
      const day = `Dia-${d}`;
      const dayEffect = d === 1 ? -0.05 : 0.05;

      for (let p = 1; p <= b; p++) {
        // Peças de 1 a 12 no Dia 1, 13 a 24 no Dia 2
        const globalPartIndex = (d - 1) * b + p;
        const partId = `Fio-${globalPartIndex}`;
        const partEffect = ((p - 6.5) / 5.5) * 0.15; // de -0.15 a +0.15

        for (let r = 1; r <= n; r++) {
          count++;
          const repEffect = (r - 2) * 0.01; // r=1: -0.01, r=2: 0, r=3: +0.01
          const value = 10.0 + dayEffect + partEffect + repEffect;
          measurements.push(createMockMeasurement(`m-${count}`, partId, 'Op-1', day, r, value));
        }
      }
    }

    return { measurements, a, b, n };
  }

  it('(1) executa ANOVA aninhada balanceada Dia > Peça > Réplica recuperando graus de liberdade analíticos exatos', () => {
    const { measurements, a, b, n } = generateDeterministicNestedData();
    expect(measurements).toHaveLength(72);

    const context = createMockContext(measurements, {
      studyModel: 'nested_day',
      lsl: 9.5,
      usl: 10.5,
      unit: 'mm',
    });

    const criteria = [
      {
        id: 'c-rep',
        parameter: 'repeatability' as const,
        metric: 'ev_pct',
        operator: '<=' as const,
        limit: 30,
        unit: '%',
      },
    ];

    const repRes = dimensionalRepeatabilityAnalysis({
      parameter: repParamDef,
      criteria,
      context,
    });

    expect(repRes.results?.study).toBe('nested_day');
    expect(repRes.verdict).toBe('pass');
    expect(repRes.n).toBe(72);

    // Graus de liberdade teóricos:
    // dfA = a - 1 = 2 - 1 = 1
    // dfBA = a * (b - 1) = 2 * (12 - 1) = 22
    // dfE = a * b * (n - 1) = 2 * 12 * (3 - 1) = 48
    const nestedData = repRes.results?.nested as any;
    expect(nestedData.anova.dfA).toBe(1);
    expect(nestedData.anova.dfBA).toBe(22);
    expect(nestedData.anova.dfE).toBe(48);

    // Repetibilidade intra-peça (resíduo)
    expect(repRes.rawMetrics.df_rep).toBe(48);
    expect(repRes.rawMetrics.sigma_rep).toBeGreaterThan(0);
    // Como os resíduos determinísticos são -0.01, 0, +0.01:
    // s²_e = [(-0.01)² + 0² + 0.01²]/2 = 0.0002 / 2 = 0.0001 => s_e = 0.01
    expect(repRes.rawMetrics.sigma_rep).toBeCloseTo(0.01, 6);

    // Reprodutibilidade entre dias
    const reproRes = dimensionalReproducibilityAnalysis({
      parameter: reproParamDef,
      criteria: [],
      context,
    });

    expect(reproRes.results?.study).toBe('nested_day');
    expect(reproRes.rawMetrics.sigma_day).toBeGreaterThan(0);
    expect(reproRes.rawMetrics.sigma_oper).toBe(reproRes.rawMetrics.sigma_day);
    expect(reproRes.rawMetrics.df_day).toBeGreaterThan(0);

    // Grau de liberdade de Satterthwaite para o componente Dia deve ser número finito positivo
    const dayDof = reproRes.rawMetrics.df_day!;
    expect(dayDof).toBeGreaterThan(0);
    expect(Number.isFinite(dayDof)).toBe(true);

    // Variação do produto/peça NÃO entra no erro de medição σ_GRR
    // σ²_GRR = σ²_rep + σ²_dia
    const sigmaRep = repRes.rawMetrics.sigma_rep!;
    const sigmaDay = reproRes.rawMetrics.sigma_day!;
    const expectedGrr = Math.sqrt(sigmaRep * sigmaRep + sigmaDay * sigmaDay);

    const grrComp = nestedData.components.find((c: any) => c.key === 'grr');
    expect(grrComp.standardDeviation).toBeCloseTo(expectedGrr, 6);

    // O componente de peça é estritamente separado
    const sampleComp = nestedData.components.find((c: any) => c.key === 'sample');
    expect(sampleComp.label).toContain('Peça (dentro do dia)');
    expect(sampleComp.variance).toBeGreaterThan(0);

    // ndc deve ser derivado de σ_peça / σ_GRR
    expect(reproRes.rawMetrics.ndc).toBeGreaterThanOrEqual(1);
  });

  it('(2) propaga GL de Satterthwaite do estudo aninhado para o orçamento GUM (Welch-Satterthwaite)', () => {
    const { measurements } = generateDeterministicNestedData();
    const context = createMockContext(measurements, {
      studyModel: 'nested_day',
      lsl: 9.5,
      usl: 10.5,
      resolution: 0.001,
      unit: 'mm',
    });

    const repRes = dimensionalRepeatabilityAnalysis({
      parameter: repParamDef,
      criteria: [],
      context,
    });
    const reproRes = dimensionalReproducibilityAnalysis({
      parameter: reproParamDef,
      criteria: [],
      context,
    });

    const sigmaRep = repRes.rawMetrics.sigma_rep!;
    const dfRep = repRes.rawMetrics.df_rep!;
    const sigmaDay = reproRes.rawMetrics.sigma_day!;
    const dfDay = reproRes.rawMetrics.df_day!;

    expect(dfRep).toBe(48);
    expect(dfDay).toBeGreaterThan(0);

    // Orçamento dimensional montado para estudo aninhado Dia > Peça
    const budgetItems = dimensionalUncertaintyBudget({
      validationId: 'val-nested-test',
      resolution: 0.001,
      calibrationUncertainty: 0.002,
      coverageFactor: 2,
      repeatabilitySd: sigmaRep,
      repeatabilityDof: dfRep,
      nReplicates: 3,
      daySd: sigmaDay,
      dayDof: dfDay,
    });

    const repItem = budgetItems.find((item) => item.source === 'Repetibilidade');
    expect(repItem).toBeDefined();
    expect(repItem!.type).toBe('A');
    expect(repItem!.dof).toBe(48);

    const dayItem = budgetItems.find((item) => item.source.includes('dias'));
    expect(dayItem).toBeDefined();
    expect(dayItem!.type).toBe('A');
    expect(dayItem!.dof).toBeCloseTo(dfDay, 2);

    // Welch-Satterthwaite com fontes Tipo A completas
    const gumResult = computeUncertainty(budgetItems);
    expect(gumResult.dofComplete).not.toBe(false);
    expect(gumResult.effectiveDof).not.toBeNull();
    expect(gumResult.effectiveDof!).toBeGreaterThan(0);
    expect(gumResult.coverageFactor).toBeGreaterThanOrEqual(1.96);
    expect(gumResult.expanded).toBeGreaterThan(0);
  });

  it('(3) rejeita graciosamente delineamento aninhado desbalanceado com recomendação e diagnóstico', () => {
    const measurements: Measurement[] = [];
    let count = 0;

    // Dia 1: 12 peças, 3 réplicas
    for (let p = 1; p <= 12; p++) {
      for (let r = 1; r <= 3; r++) {
        count++;
        measurements.push(createMockMeasurement(`m-${count}`, `P-${p}`, 'Op-1', 'Dia-1', r, 10.0));
      }
    }
    // Dia 2: apenas 10 peças (desbalanceado no número de peças!)
    for (let p = 13; p <= 22; p++) {
      for (let r = 1; r <= 3; r++) {
        count++;
        measurements.push(createMockMeasurement(`m-${count}`, `P-${p}`, 'Op-1', 'Dia-2', r, 10.0));
      }
    }

    const context = createMockContext(measurements, {
      studyModel: 'nested_day',
      unit: 'mm',
    });

    const repRes = dimensionalRepeatabilityAnalysis({
      parameter: repParamDef,
      criteria: [],
      context,
    });

    expect(repRes.verdict).toBe('not_evaluated');
    expect(repRes.summary).toContain('balanceado');
    expect(repRes.tables.some((t) => t.title.includes('Diagnóstico de Estrutura'))).toBe(true);
  });

  it('(4) rejeita graciosamente se houver apenas 1 dia informado em dados aninhados', () => {
    const measurements: Measurement[] = [];
    let count = 0;

    // Todas as 12 peças medidas em 1 único dia
    for (let p = 1; p <= 12; p++) {
      for (let r = 1; r <= 3; r++) {
        count++;
        measurements.push(createMockMeasurement(`m-${count}`, `P-${p}`, 'Op-1', 'Dia-1', r, 10.0));
      }
    }

    const context = createMockContext(measurements, { unit: 'mm' });

    const repRes = dimensionalRepeatabilityAnalysis({
      parameter: repParamDef,
      criteria: [],
      context,
    });

    // Como há apenas 1 dia e 1 operador, diagnoseDesignStructure aponta insuficiência para separação de fatores
    expect(repRes.verdict).toBe('not_evaluated');
  });
});
