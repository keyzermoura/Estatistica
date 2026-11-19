import { describe, expect, it } from 'vitest';
import { diagnoseDesignStructure } from '../designStructure';
import type { Measurement } from '../../lib/types';
import type { ParameterDef } from '../../profiles/types';
import type { AnalysisContext } from '../analysis-types';
import { dimensionalRepeatabilityAnalysis } from '../parameters/dimensional';

function createMockMeasurement(
  id: string,
  partId: string,
  analyst: string,
  day: string,
  replicate: number,
  value = 10.0,
): Measurement {
  return {
    id,
    validationId: 'val-test',
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

describe('Diagnóstico de Estrutura do Delineamento Amostral (Etapa D1)', () => {
  it('(a) identifica delineamento cruzado balanceado (3 analistas × 6 peças × 3 réplicas)', () => {
    const measurements: Measurement[] = [];
    let count = 0;
    const analysts = ['Op-A', 'Op-B', 'Op-C'];
    const parts = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

    for (const part of parts) {
      for (const op of analysts) {
        for (let r = 1; r <= 3; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    expect(measurements).toHaveLength(54); // 6 * 3 * 3 = 54

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('crossed_balanced');
    expect(diagnosis.suggestedModel).toBe('gage_rr_crossed');
    expect(diagnosis.isBalanced).toBe(true);
    expect(diagnosis.canRunCrossedGageRR).toBe(true);
    expect(diagnosis.canRunNestedAnova).toBe(false);
    expect(diagnosis.partsCount).toBe(6);
    expect(diagnosis.analystsCount).toBe(3);
    expect(diagnosis.partAnalystIncidence.emptyCells).toBe(0);
    expect(diagnosis.partAnalystIncidence.minReplicates).toBe(3);
    expect(diagnosis.partAnalystIncidence.maxReplicates).toBe(3);
    expect(diagnosis.partAnalystIncidence.isConnected).toBe(true);
    expect(diagnosis.warnings).toHaveLength(0);
  });

  it('(b) identifica cruzado desbalanceado com células faltantes mas conectado', () => {
    const measurements: Measurement[] = [];
    let count = 0;
    const analysts = ['Op-A', 'Op-B', 'Op-C'];
    const parts = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

    for (const part of parts) {
      for (const op of analysts) {
        // Omite 2 células específicas: (P1, Op-A) e (P4, Op-C)
        if ((part === 'P1' && op === 'Op-A') || (part === 'P4' && op === 'Op-C')) {
          continue;
        }
        for (let r = 1; r <= 3; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('crossed_unbalanced');
    expect(diagnosis.suggestedModel).toBe('unbalanced_gage_rr_type3_reml');
    expect(diagnosis.isBalanced).toBe(false);
    expect(diagnosis.canRunCrossedGageRR).toBe(true);
    expect(diagnosis.partAnalystIncidence.emptyCells).toBe(2);
    expect(diagnosis.partAnalystIncidence.isConnected).toBe(true);
    expect(diagnosis.warnings.some((w) => w.includes('desbalanceado'))).toBe(true);
  });

  it('(c) identifica estudo aninhado Dia > Peça (24 peças distintas, 12 por dia, 2 dias)', () => {
    const measurements: Measurement[] = [];
    let count = 0;
    const days = ['Dia-1', 'Dia-2'];

    // 12 peças no Dia-1, 12 peças distintas no Dia-2
    for (let i = 1; i <= 24; i++) {
      const day = i <= 12 ? 'Dia-1' : 'Dia-2';
      const part = `Fio-${i}`;
      for (let r = 1; r <= 3; r++) {
        count++;
        measurements.push(createMockMeasurement(`m-${count}`, part, 'Op-1', day, r));
      }
    }

    expect(measurements).toHaveLength(72); // 24 * 3 = 72

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('nested');
    expect(diagnosis.suggestedModel).toBe('nested_anova_3level');
    expect(diagnosis.partsCount).toBe(24);
    expect(diagnosis.daysCount).toBe(2);
    expect(diagnosis.singleDayPartsCount).toBe(24);
    expect(diagnosis.nestedHierarchy).toBeDefined();
    expect(diagnosis.nestedHierarchy!.nestedFactor).toBe('part');
    expect(diagnosis.nestedHierarchy!.parentFactor).toBe('day');
    expect(diagnosis.canRunCrossedGageRR).toBe(false);
    expect(diagnosis.canRunNestedAnova).toBe(true);
    expect(diagnosis.warnings.some((w) => w.includes('Dia > Peça'))).toBe(true);
    expect(diagnosis.recommendation).toContain('ANOVA aninhada (Dia > Peça > Réplica)');
  });

  it('(d) identifica delineamento desconectado (ilhas isoladas sem ligação)', () => {
    const measurements: Measurement[] = [];
    let count = 0;

    // Ilha 1: Peças 1, 2, 3 medidas APENAS por Op-A e Op-B
    for (const part of ['P1', 'P2', 'P3']) {
      for (const op of ['Op-A', 'Op-B']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    // Ilha 2: Peças 4, 5, 6 medidas APENAS por Op-C e Op-D
    for (const part of ['P4', 'P5', 'P6']) {
      for (const op of ['Op-C', 'Op-D']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('disconnected');
    expect(diagnosis.partAnalystIncidence.isConnected).toBe(false);
    expect(diagnosis.partAnalystIncidence.connectedComponents.length).toBeGreaterThan(1);
    expect(diagnosis.canRunCrossedGageRR).toBe(false);
    expect(diagnosis.warnings.some((w) => w.includes('desconectado'))).toBe(true);
  });

  it('(e) identifica delineamento parcialmente cruzado (algumas peças com 1 analista, outras com vários)', () => {
    const measurements: Measurement[] = [];
    let count = 0;

    // P1 e P2 medidas por Op-A e Op-B
    for (const part of ['P1', 'P2']) {
      for (const op of ['Op-A', 'Op-B']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    // P3 medida apenas por Op-A (peça exclusiva)
    for (let r = 1; r <= 2; r++) {
      count++;
      measurements.push(createMockMeasurement(`m-${count}`, 'P3', 'Op-A', 'Dia-1', r));
    }

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('partially_crossed');
    expect(diagnosis.canRunCrossedGageRR).toBe(false);
    expect(diagnosis.singleAnalystPartsCount).toBe(1);
    expect(diagnosis.partsCount).toBe(3);
    expect(diagnosis.warnings.some((w) => w.includes('parcialmente cruzado'))).toBe(true);
  });

  it('identifica dados insuficientes para análise de repetibilidade e reprodutibilidade', () => {
    const measurements = [
      createMockMeasurement('m-1', 'P1', 'Op-A', 'Dia-1', 1),
      createMockMeasurement('m-2', 'P1', 'Op-A', 'Dia-1', 2),
    ];

    const diagnosis = diagnoseDesignStructure(measurements);

    expect(diagnosis.classification).toBe('insufficient_data');
    expect(diagnosis.suggestedModel).toBe('insufficient_data');
    expect(diagnosis.canRunCrossedGageRR).toBe(false);
    expect(diagnosis.canRunNestedAnova).toBe(false);
  });
});

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

describe('Bloqueio de Gage R&R Cruzado sob Delineamento Aninhado / Desconexo (Etapa D2)', () => {
  const mockRepParameter: ParameterDef = {
    key: 'repeatability',
    label: 'Repetibilidade',
    shortDescription: 'Repetibilidade dimensional',
    reference: 'AIAG MSA (2010)',
    metrics: [
      { key: 'sigma_rep', label: 'σ_rep', unit: 'mm' },
      { key: 'ev_pct', label: '%EV', unit: '%' },
    ],
  };

  it('bloqueia Gage R&R cruzado quando dados possuem estrutura aninhada Dia > Peça e retorna not_evaluated com diagnóstico', () => {
    // 24 peças distintas: 12 no Dia 1 (Op-A e Op-B), 12 no Dia 2 (Op-A e Op-B), 2 réplicas
    const measurements: Measurement[] = [];
    let count = 0;
    for (let i = 1; i <= 24; i++) {
      const day = i <= 12 ? 'Dia-1' : 'Dia-2';
      const part = `P-${i}`;
      for (const op of ['Op-A', 'Op-B']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, day, r, 10.0 + (i % 3) * 0.1 + r * 0.01));
        }
      }
    }

    const context = createMockContext(measurements, {
      lsl: 9.0,
      usl: 11.0,
      unit: 'mm',
    });

    const res = dimensionalRepeatabilityAnalysis({
      parameter: mockRepParameter,
      criteria: [],
      context,
    });

    expect(res.verdict).toBe('not_evaluated');
    expect(res.summary).toContain('incompatível com Gage R&R cruzado (nested)');
    expect(res.summary).toContain('ANOVA aninhada (Dia > Peça > Réplica)');
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.tables.some((t) => t.title.includes('Diagnóstico de Estrutura do Delineamento Amostral'))).toBe(true);
    const diag = res.results?.diagnosis as { classification: string } | undefined;
    expect(diag?.classification).toBe('nested');
  });

  it('bloqueia Gage R&R cruzado quando dados formam rede desconectada (ilhas isoladas)', () => {
    const measurements: Measurement[] = [];
    let count = 0;

    // Ilha 1: Peças 1, 2 por Op-A, Op-B
    for (const part of ['P1', 'P2']) {
      for (const op of ['Op-A', 'Op-B']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }
    // Ilha 2: Peças 3, 4 por Op-C, Op-D
    for (const part of ['P3', 'P4']) {
      for (const op of ['Op-C', 'Op-D']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, 'Dia-1', r));
        }
      }
    }

    const context = createMockContext(measurements, { unit: 'mm' });

    const res = dimensionalRepeatabilityAnalysis({
      parameter: mockRepParameter,
      criteria: [],
      context,
    });

    expect(res.verdict).toBe('not_evaluated');
    expect(res.summary).toContain('incompatível com Gage R&R cruzado (disconnected)');
    const diag = res.results?.diagnosis as { classification: string } | undefined;
    expect(diag?.classification).toBe('disconnected');
    expect(res.tables.some((t) => t.title.includes('Diagnóstico de Estrutura'))).toBe(true);
  });

  it('permite override quando forceCrossedModel for verdadeiro, emitindo aviso de risco metrológico', () => {
    // 24 peças em 2 dias (estrutura aninhada Dia > Peça), mas com forceCrossedModel: true
    const measurements: Measurement[] = [];
    let count = 0;
    for (let i = 1; i <= 6; i++) {
      const day = i <= 3 ? 'Dia-1' : 'Dia-2';
      const part = `P-${i}`;
      for (const op of ['Op-A', 'Op-B']) {
        for (let r = 1; r <= 2; r++) {
          count++;
          measurements.push(createMockMeasurement(`m-${count}`, part, op, day, r, 10.0 + r * 0.05));
        }
      }
    }

    const context = createMockContext(measurements, {
      forceCrossedModel: true,
      unit: 'mm',
    });

    const res = dimensionalRepeatabilityAnalysis({
      parameter: mockRepParameter,
      criteria: [],
      context,
    });

    // Como forceCrossedModel está ativo, não deve ter sido bloqueado por estrutura
    expect(res.results?.study).toBe('gage_rr');
    expect(res.warnings.some((w) => w.includes('AVISO DE RISCO METROLÓGICO'))).toBe(true);
  });
});


