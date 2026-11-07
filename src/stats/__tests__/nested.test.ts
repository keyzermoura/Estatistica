import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_INPUT } from '../../lib/types';
import {
  NESTED_DESTRUCTIVE_WARNING,
  anovaNested,
  buildDesign,
  gageRRNested,
  gagerrNested,
  homogeneityCheck,
  iso5725Analysis,
  nestedDesignN,
  rerandomize,
  type GageRRNestedResult,
  type NestedObservation,
} from '../index';

/**
 * Referências dos conjuntos de teste:
 *  - Montgomery (2020), cap. 14, Example 14-1 (3 fornecedores × 4 lotes ×
 *    3 observações). Dados brutos obtidos do arquivo Minitab do STAT 503/PSU
 *    e somas de quadrados calculadas de forma independente em Python/NumPy.
 *  - Planilha 2 × 2 × 3 conferida célula a célula, com somas de quadrados
 *    obtidas por frações exatas.
 *  - Caso b = 1 comparado diretamente com `iso5725Analysis` (mesmos dados).
 */

const close = (actual: number, expected: number, tol = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

// Montgomery Example 14-1: fornecedor → lote → observações.
const MONTGOMERY: Record<string, Record<string, number[]>> = {
  'Fornecedor 1': {
    L1: [1, -1, 0],
    L2: [-2, -3, -4],
    L3: [-2, 0, 1],
    L4: [1, 4, 0],
  },
  'Fornecedor 2': {
    L1: [1, -2, -3],
    L2: [0, 4, 2],
    L3: [-1, 0, -2],
    L4: [0, 3, 2],
  },
  'Fornecedor 3': {
    L1: [2, 4, 0],
    L2: [-2, 0, 2],
    L3: [1, -1, 2],
    L4: [3, 2, 1],
  },
};

function montgomeryObservations(): NestedObservation[] {
  const rows: NestedObservation[] = [];
  for (const [operator, samples] of Object.entries(MONTGOMERY)) {
    for (const [sample, values] of Object.entries(samples)) {
      values.forEach((value, index) => {
        rows.push({ operator, sample, replicate: index + 1, value });
      });
    }
  }
  return rows;
}

function montgomeryMatrix() {
  return Object.values(MONTGOMERY).map((samples) => Object.values(samples));
}

function component(result: GageRRNestedResult, key: GageRRNestedResult['components'][number]['key']) {
  const found = result.components.find((item) => item.key === key);
  if (!found) throw new Error(`Componente ausente: ${key}`);
  return found;
}

describe('ANOVA aninhada — Montgomery Example 14-1', () => {
  it('reproduz somas de quadrados, graus de liberdade e componentes', () => {
    const result = anovaNested(montgomeryObservations());
    expect(result.balanced).toBe(true);
    expect(result.twoLevel).toBe(false);
    expect(result.operators).toBe(3);
    expect(result.samplesPerOperator).toBe(4);
    expect(result.replicates).toBe(3);
    expect(result.n).toBe(36);

    expect(result.rows.map((row) => row.df)).toEqual([2, 9, 24, 35]);
    close(result.rows[0].ss, 15.055555555555557);
    close(result.rows[1].ss, 69.91666666666667);
    close(result.rows[2].ss, 63.33333333333333);
    close(result.totalSs, 148.30555555555554);

    close(result.msA, 7.527777777777779);
    close(result.msBA ?? NaN, 7.768518518518519);
    close(result.msE, 2.638888888888889);
    close(result.fA ?? NaN, 0.9690107270560191);
    close(result.fBA ?? NaN, 2.9438596491228073);
    expect(result.pA).toBeGreaterThan(0.41);
    expect(result.pA).toBeLessThan(0.42);
    expect(result.pBA).toBeGreaterThan(0.01);
    expect(result.pBA).toBeLessThan(0.02);

    close(result.components.repeatability.variance, 2.638888888888889);
    close(result.components.sample.variance, 1.7098765432098766);
    expect(result.components.operator.variance).toBe(0);
    expect(result.components.operator.truncated).toBe(true);
    close(result.components.totalVariance, 4.348765432098766);
    close(result.components.totalSd, Math.sqrt(4.348765432098766));
    expect(result.warnings.some((warning) => warning.includes('truncado'))).toBe(true);
  });
});

describe('ANOVA aninhada — b = 1 delegado ao ISO 5725-2', () => {
  const observations: NestedObservation[] = [
    { operator: 'Op 1', sample: 'A', replicate: 1, value: 10.0 },
    { operator: 'Op 1', sample: 'A', replicate: 2, value: 10.2 },
    { operator: 'Op 1', sample: 'A', replicate: 3, value: 9.8 },
    { operator: 'Op 1', sample: 'A', replicate: 4, value: 10.1 },
    { operator: 'Op 2', sample: 'A', replicate: 1, value: 10.5 },
    { operator: 'Op 2', sample: 'A', replicate: 2, value: 10.4 },
    { operator: 'Op 2', sample: 'A', replicate: 3, value: 10.6 },
    { operator: 'Op 2', sample: 'A', replicate: 4, value: 10.5 },
    { operator: 'Op 3', sample: 'A', replicate: 1, value: 9.5 },
    { operator: 'Op 3', sample: 'A', replicate: 2, value: 9.6 },
    { operator: 'Op 3', sample: 'A', replicate: 3, value: 9.4 },
    { operator: 'Op 3', sample: 'A', replicate: 4, value: 9.5 },
  ];

  it('coincide com iso5725Analysis', () => {
    const result = anovaNested(observations);
    const iso = iso5725Analysis(
      observations.map((row) => ({
        lab: row.operator,
        level: 'único',
        replicate: row.replicate,
        value: row.value,
      })),
    );
    expect(result.twoLevel).toBe(true);
    expect(result.iso5725).not.toBeNull();
    expect(result.samplesPerOperator).toBe(1);
    close(result.msA, iso.levels[0].msBetween);
    close(result.msE, iso.levels[0].msWithin);
    close(result.components.repeatability.variance, iso.pooled.sr ** 2);
    close(result.components.operator.variance, iso.pooled.sL ** 2);
    close(result.components.totalVariance, iso.pooled.sR ** 2);
    expect(result.rows.map((row) => row.df)).toEqual([2, 9, 11]);
    expect(result.warnings.some((warning) => warning.includes('b = 1'))).toBe(true);
  });

  it('produz o mesmo σ_GRR no Gage R&R aninhado', () => {
    const matrix = observations.reduce<number[][][]>((operators, row) => {
      const opIndex = Number(row.operator.slice(-1)) - 1;
      operators[opIndex] ??= [[]];
      operators[opIndex][0].push(row.value);
      return operators;
    }, []);
    const result = gageRRNested({ y: matrix, tolerance: 5 });
    const iso = iso5725Analysis(
      observations.map((row) => ({
        lab: row.operator,
        level: 'único',
        replicate: row.replicate,
        value: row.value,
      })),
    );
    close(result.rawMetrics.variance_repeatability ?? NaN, iso.pooled.sr ** 2);
    close(result.rawMetrics.variance_operator ?? NaN, iso.pooled.sL ** 2);
    close(result.rawMetrics.variance_grr ?? NaN, iso.pooled.sR ** 2);
    expect(result.anova.twoLevel).toBe(true);
    expect(result.rawMetrics.variance_sample).toBe(0);
    expect(result.components.find((item) => item.key === 'sample')?.estimable).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('ISO 5725-2'))).toBe(true);
    expect(result.destructiveWarning).toBe(NESTED_DESTRUCTIVE_WARNING);
  });
});

describe('Gage R&R aninhado — Montgomery e métricas destrutivas', () => {
  it('calcula componentes, %GRR, %P/T, ndc e ICs', () => {
    const result = gageRRNested({ y: montgomeryMatrix(), tolerance: 10 });
    expect(result.balanced).toBe(true);
    expect(result.operators).toBe(3);
    expect(result.samplesPerOperator).toBe(4);
    expect(result.replicates).toBe(3);
    expect(result.cells).toBe(12);

    close(component(result, 'repeatability').variance, 2.638888888888889);
    close(component(result, 'sample').variance, 1.7098765432098766);
    expect(component(result, 'operator').variance).toBe(0);
    close(component(result, 'grr').variance, 2.638888888888889);
    close(component(result, 'total').variance, 4.348765432098766);

    close(result.rawMetrics.grr_pct ?? NaN, 77.89822480623737);
    close(result.rawMetrics.pt_pct ?? NaN, 97.46794344808964);
    close(result.rawMetrics.contribution_grr ?? NaN, 60.68133427963093);
    expect(result.rawMetrics.ndc).toBe(1);

    close(result.rawMetrics.df_sample ?? NaN, 3.7613260022096857);
    close(result.rawMetrics.df_grr ?? NaN, 12.855602282690354);
    expect(result.intervals.sigmaGrr).not.toBeNull();
    expect(result.intervals.grrPct).not.toBeNull();
    expect(result.intervals.ptPct).not.toBeNull();
    close(result.intervals.sigmaGrr?.df ?? NaN, 12.855602282690354);
    close(result.intervals.grrPct?.df2 ?? NaN, 3.7613260022096857);
    expect(result.intervals.sigmaGrr?.lower ?? Infinity).toBeLessThan(
      component(result, 'grr').standardDeviation,
    );
    expect(result.intervals.sigmaGrr?.upper ?? 0).toBeGreaterThan(
      component(result, 'grr').standardDeviation,
    );

    expect(result.metrics.find((metric) => metric.key === 'grr_pct')?.verdict).toBe('fail');
    expect(result.metrics.find((metric) => metric.key === 'ndc')?.verdict).toBe('fail');
    expect(result.verdict).toBe('fail');
  });

  it('exibe o aviso destrutivo obrigatório na saída e no resumo', () => {
    const result = gageRRNested({ y: montgomeryMatrix(), tolerance: 10 });
    expect(result.warnings[0]).toBe(NESTED_DESTRUCTIVE_WARNING);
    expect(result.summary).toContain(NESTED_DESTRUCTIVE_WARNING);
    expect(result.notes.some((note) => note.includes('corpo de prova'))).toBe(true);
    expect(result.destructiveWarning).toContain('homogeneidade do lote');
  });

  it('mantém a tabela de resumo por operador e amostra', () => {
    const result = gageRRNested({
      y: montgomeryMatrix(),
      tolerance: 10,
      operatorLabels: Object.keys(MONTGOMERY),
      sampleLabels: Object.values(MONTGOMERY).map((samples) => Object.keys(samples)),
    });
    const table = result.tables.find((item) => item.title.includes('Resumo por operador'));
    expect(table).toBeDefined();
    expect(table?.columns).toEqual([
      'Operador',
      'Amostra',
      'n',
      'Média',
      'Desvio-padrão',
      'Amplitude',
    ]);
    expect(table?.rows).toHaveLength(12);
    expect(table?.rows[0]).toEqual(['Fornecedor 1', 'L1', 3, 0, 1, 2]);
  });
});

describe('Gage R&R aninhado — planilha 2 × 2 × 3 validada célula a célula', () => {
  const matrix = [
    [
      [10, 11, 12],
      [20, 21, 22],
    ],
    [
      [10, 11, 13],
      [21, 22, 23],
    ],
  ];

  it('reproduz ANOVA e componentes por frações exatas', () => {
    const result = gageRRNested({ y: matrix, tolerance: 10 });
    close(result.anova.rows[0].ss, 4 / 3);
    close(result.anova.rows[1].ss, 962 / 3);
    close(result.anova.rows[2].ss, 32 / 3);
    close(result.anova.totalSs, 998 / 3);
    expect(result.anova.rows.map((row) => row.df)).toEqual([1, 2, 8, 11]);

    close(component(result, 'repeatability').variance, 4 / 3);
    close(component(result, 'sample').variance, 53);
    expect(component(result, 'operator').variance).toBe(0);
    close(component(result, 'total').variance, 163 / 3);

    close(result.rawMetrics.grr_pct ?? NaN, 15.665208999759145);
    close(result.rawMetrics.pt_pct ?? NaN, 69.28203230275508);
    expect(result.rawMetrics.ndc).toBe(8);
    expect(result.metrics.find((metric) => metric.key === 'grr_pct')?.verdict).toBe('warning');
    expect(result.metrics.find((metric) => metric.key === 'pt_pct')?.verdict).toBe('fail');
  });

  it('confere a tabela de células', () => {
    const result = gageRRNested({ y: matrix, tolerance: 10 });
    const table = result.tables.find((item) => item.title.includes('Resumo por operador'));
    expect(table?.rows[0]).toEqual(['Operador 1', 'A1', 3, 11, 1, 2]);
    expect(table?.rows[1]).toEqual(['Operador 1', 'A2', 3, 21, 1, 2]);
    expect(table?.rows[2]).toEqual(['Operador 2', 'A1', 3, 11.333333, 1.527525, 3]);
    expect(table?.rows[3]).toEqual(['Operador 2', 'A2', 3, 22, 1, 2]);
  });
});

describe('Homogeneidade do lote', () => {
  it('não rejeita lote homogêneo', () => {
    const result = homogeneityCheck([
      [10, 10.1, 9.9],
      [10, 10.1, 9.9],
      [10, 10.1, 9.9],
    ]);
    expect(result.homogeneous).toBe(true);
    expect(result.verdict).toBe('pass');
    expect(result.justificationRequired).toBe(false);
    expect(result.justified).toBe(true);
    expect(result.anova.rows[0].p).toBe(1);
    expect(result.cochran.statistic).toBeCloseTo(1 / 3, 12);
    expect(result.varianceRatio.statistic).toBe(1);
    expect(result.justification).toBeNull();
  });

  it('rejeita médias diferentes e exige justificativa', () => {
    const result = homogeneityCheck([
      [10, 10.1, 9.9],
      [20, 20.1, 19.9],
      [10, 10.1, 9.9],
    ]);
    expect(result.homogeneous).toBe(false);
    expect(result.verdict).toBe('fail');
    expect(result.justificationRequired).toBe(true);
    expect(result.justified).toBe(false);
    expect(result.anova.rows[0].p ?? 1).toBeLessThan(0.05);
    expect(result.warnings.some((warning) => warning.includes('justificativa'))).toBe(true);
  });

  it('rejeita variâncias diferentes com médias iguais', () => {
    const result = homogeneityCheck([
      [10, 10, 10],
      [10, 10.1, 9.9],
      [10, 14, 6],
    ]);
    expect(result.homogeneous).toBe(false);
    expect(result.anova.rows[0].p ?? 1).toBeGreaterThan(0.05);
    expect(result.cochran.rejected).toBe(true);
    expect(result.varianceRatio.rejected).toBe(true);
    expect(result.justificationRequired).toBe(true);
  });

  it('aceita justificativa registrada', () => {
    const result = homogeneityCheck(
      [
        [10, 10.1, 9.9],
        [20, 20.1, 19.9],
        [10, 10.1, 9.9],
      ],
      { justification: 'Lote caracterizado por histórico; desvio entre amostras atribuído ao processo.' },
    );
    expect(result.homogeneous).toBe(false);
    expect(result.justificationRequired).toBe(true);
    expect(result.justified).toBe(true);
    expect(result.justification).toContain('histórico');
    expect(result.warnings.some((warning) => warning.includes('justificativa registrada'))).toBe(true);
  });

  it('permite critério editável de razão de variâncias', () => {
    const result = homogeneityCheck(
      [
        [10, 10.1, 9.9],
        [10, 10.1, 9.9],
        [10, 10.1, 9.9],
      ],
      { maxVarianceRatio: 1.0 },
    );
    expect(result.varianceRatio.statistic).toBe(1);
    expect(result.varianceRatio.rejected).toBe(false);
  });
});

describe('Gage R&R aninhado — integração com homogeneidade', () => {
  const matrix = [
    [
      [10, 10.1, 9.9],
      [10.2, 10.1, 10.3],
    ],
    [
      [10.5, 10.4, 10.6],
      [10.7, 10.6, 10.8],
    ],
  ];

  it('lança erro quando o lote é rejeitado sem justificativa', () => {
    expect(() =>
      gageRRNested(
        { y: matrix, tolerance: 2 },
        {
          homogeneity: {
            groups: [
              [10, 10.1, 9.9],
              [20, 20.1, 19.9],
              [10, 10.1, 9.9],
            ],
          },
        },
      ),
    ).toThrow(/justificativa/i);
  });

  it('aceita o estudo com justificativa e registra o resultado', () => {
    const result = gageRRNested(
      { y: matrix, tolerance: 2 },
      {
        homogeneity: {
          groups: [
            [10, 10.1, 9.9],
            [20, 20.1, 19.9],
            [10, 10.1, 9.9],
          ],
          justification: 'Lote heterogêneo por projeto; amostras representativas do processo.',
        },
      },
    );
    expect(result.homogeneity).not.toBeNull();
    expect(result.homogeneity?.homogeneous).toBe(false);
    expect(result.justificationRequired).toBe(true);
    expect(result.justified).toBe(true);
    expect(result.justification).toContain('projeto');
    expect(result.rawMetrics.homogeneity_rejected).toBe(1);
    expect(result.rawMetrics.homogeneity_justified).toBe(1);
    expect(result.tables.some((table) => table.title === 'Homogeneidade do lote')).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('justificativa registrada'))).toBe(true);
  });

  it('avisa quando a homogeneidade não foi avaliada', () => {
    const result = gageRRNested({ y: matrix, tolerance: 2 });
    expect(result.homogeneity).toBeNull();
    expect(result.warnings.some((warning) => warning.includes('não avaliada'))).toBe(true);
    expect(result.justificationRequired).toBe(false);
  });
});

describe('Delineamento aninhado destrutivo', () => {
  const input = {
    ...DEFAULT_DESIGN_INPUT,
    designType: 'nested_destructive' as const,
    nAnalysts: 3,
    nSamples: 4,
    nReplicates: 3,
    seed: 123,
    levels: ['1', '2'],
  };

  it('gera operadores × amostras × corpos de prova e o plano de consumo', () => {
    const plan = buildDesign(input, { selected: ['repeatability'] });
    expect(plan.runs).toHaveLength(36);
    expect(plan.specimenConsumption).toEqual({
      operators: 3,
      samplesPerOperator: 4,
      replicates: 3,
      total: 36,
    });
    expect(plan.recommended.samples).toBe(4);
    expect(new Set(plan.runs.map((run) => run.specimen)).size).toBe(36);
    expect(plan.runs[0].specimen).toMatch(/^CP-\d{3}$/);
    expect(plan.runs.every((run) => run.factorValues.corpo_de_prova === run.specimen)).toBe(true);
    expect(plan.summary).toContain('36 corpos de prova a retirar do lote');
    expect(plan.warnings).toContain(NESTED_DESTRUCTIVE_WARNING);
    expect(plan.assumptions.some((assumption) => assumption.includes('corpo de prova'))).toBe(true);
  });

  it('é reprodutível com a mesma semente e muda com outra', () => {
    const a = buildDesign(input, { selected: ['repeatability'] });
    const b = buildDesign(input, { selected: ['repeatability'] });
    const c = buildDesign({ ...input, seed: 999 }, { selected: ['repeatability'] });
    const order = (plan: typeof a) => plan.runs.map((run) => `${run.runOrder}:${run.specimen}`);
    expect(order(a)).toEqual(order(b));
    expect(order(a)).not.toEqual(order(c));
    const r1 = rerandomize(a, 321);
    const r2 = rerandomize(a, 321);
    expect(order(r1)).toEqual(order(r2));
  });

  it('aceita b = 1 e alerta sobre a componente não estimável', () => {
    const plan = buildDesign({ ...input, nSamples: 1 }, { selected: ['repeatability'] });
    expect(plan.runs).toHaveLength(9);
    expect(plan.specimenConsumption?.total).toBe(9);
    expect(plan.recommended.samples).toBe(1);
    expect(plan.warnings.some((warning) => warning.includes('b = 1'))).toBe(true);
  });
});

describe('nestedDesignN — planejamento do número de réplicas', () => {
  it('atinge o erro relativo-alvo de s_r com o menor n', () => {
    const result = nestedDesignN({
      sigmaRepeatability: 1,
      sigmaSample: 0.5,
      sigmaOperator: 0.5,
      operators: 3,
      samplesPerOperator: 5,
      targetRelativeSdError: 0.05,
      minReplicates: 2,
      maxReplicates: 100,
    });
    expect(result.method).toBe('nested');
    expect(result.replicates).toBe(15);
    expect(result.nPerGroup).toBe(15);
    expect(result.totalSpecimens).toBe(225);
    expect(result.total).toBe(225);
    expect(result.achievedRelativeSdError).toBeLessThanOrEqual(0.05);
    const previous = 1 / Math.sqrt(2 * 3 * 5 * (14 - 1));
    expect(previous).toBeGreaterThan(0.05);
    expect(result.targetMet).toBe(true);
  });

  it('atinge a largura-alvo do IC de σ_GRR', () => {
    const result = nestedDesignN({
      sigmaRepeatability: 1,
      sigmaSample: 0.5,
      sigmaOperator: 0.5,
      operators: 3,
      samplesPerOperator: 5,
      targetCiWidth: 0.8,
      confidence: 0.95,
      minReplicates: 2,
      maxReplicates: 200,
    });
    expect(result.achievedCiWidth).not.toBeNull();
    expect(result.achievedCiWidth ?? Infinity).toBeLessThanOrEqual(0.8);
    expect(result.targetMet).toBe(true);
    expect(result.replicates).toBeGreaterThan(2);
    expect(result.dofGrr).not.toBeNull();
  });

  it('combina os dois critérios e reporta o plano completo', () => {
    const result = nestedDesignN({
      sigmaRepeatability: 1,
      sigmaSample: 0.5,
      sigmaOperator: 0.3,
      operators: 4,
      samplesPerOperator: 6,
      targetRelativeSdError: 0.08,
      targetCiWidth: 1.0,
      minReplicates: 2,
      maxReplicates: 500,
    });
    expect(result.achievedRelativeSdError).toBeLessThanOrEqual(0.08);
    expect(result.achievedCiWidth ?? Infinity).toBeLessThanOrEqual(1.0);
    expect(result.totalSpecimens).toBe(4 * 6 * result.replicates);
    expect(result.notes.some((note) => note.includes('corpos de prova'))).toBe(true);
  });

  it('falha com componentes inválidos', () => {
    expect(() =>
      nestedDesignN({ sigmaRepeatability: 0, targetRelativeSdError: 0.2 }),
    ).toThrow(/sigmaRepeatability/);
  });

  it('rejeita alvos e dimensões inválidas', () => {
    const base = { sigmaRepeatability: 1, targetRelativeSdError: 0.2 };
    expect(() => nestedDesignN({ ...base, operators: 1 })).toThrow(/operadores/);
    expect(() => nestedDesignN({ ...base, samplesPerOperator: 0 })).toThrow(/amostras/);
    expect(() => nestedDesignN({ ...base, targetCiWidth: 0 })).toThrow(/largura-alvo/);
    expect(() => nestedDesignN({ ...base, targetRelativeSdError: -0.1 })).toThrow(
      /erro relativo-alvo/,
    );
  });
});

describe('ANOVA aninhada — validação de entrada', () => {
  it('exige pelo menos dois operadores', () => {
    expect(() =>
      anovaNested([
        { operator: 'A', sample: 'A1', replicate: 1, value: 1 },
        { operator: 'A', sample: 'A1', replicate: 2, value: 2 },
      ]),
    ).toThrow(/2 operadores/i);
  });

  it('exige delineamento balanceado', () => {
    expect(() =>
      anovaNested([
        { operator: 'A', sample: 'A1', replicate: 1, value: 1 },
        { operator: 'A', sample: 'A1', replicate: 2, value: 2 },
        { operator: 'A', sample: 'A2', replicate: 1, value: 3 },
        { operator: 'A', sample: 'A2', replicate: 2, value: 4 },
        { operator: 'B', sample: 'B1', replicate: 1, value: 5 },
        { operator: 'B', sample: 'B1', replicate: 2, value: 6 },
      ]),
    ).toThrow(/desbalanceado/i);
  });

  it('exige pelo menos duas réplicas', () => {
    expect(() =>
      anovaNested([
        { operator: 'A', sample: 'A1', replicate: 1, value: 1 },
        { operator: 'B', sample: 'B1', replicate: 1, value: 2 },
      ]),
    ).toThrow(/2 réplicas/i);
  });

  it('rejeita valores não numéricos e dados faltantes no Gage R&R', () => {
    expect(() =>
      anovaNested([
        { operator: 'A', sample: 'A1', replicate: 1, value: 1 },
        { operator: 'A', sample: 'A1', replicate: 2, value: Number.NaN },
        { operator: 'B', sample: 'B1', replicate: 1, value: 3 },
        { operator: 'B', sample: 'B1', replicate: 2, value: 4 },
      ]),
    ).toThrow(/inválido/i);
    expect(() =>
      gageRRNested({
        y: [
          [[1, 2], [3, null]],
          [[4, 5], [6, 7]],
        ],
      }),
    ).toThrow(/faltantes/i);
  });

  it('rejeita r = 1 no Gage R&R aninhado', () => {
    expect(() =>
      gageRRNested({
        y: [
          [[1], [2]],
          [[3], [4]],
        ],
      }),
    ).toThrow(/r = 1|repetibilidade/i);
  });

  it('rejeita tolerância e critérios inválidos', () => {
    const y = [
      [
        [10, 10.1],
        [10.2, 10.3],
      ],
      [
        [10.4, 10.5],
        [10.6, 10.7],
      ],
    ];
    expect(() => gageRRNested({ y, tolerance: 0 })).toThrow(/tolerância/i);
    expect(() =>
      gageRRNested({ y }, { criteria: { grrWarning: 5, grrAccept: 10 } }),
    ).toThrow(/atenção de %GRR/i);
    expect(() =>
      gageRRNested({ y }, { criteria: { ndcMin: 0 } }),
    ).toThrow(/ndc mínimo/i);
  });
});

describe('homogeneityCheck — validação de entrada', () => {
  it('exige grupos válidos', () => {
    expect(() => homogeneityCheck([])).toThrow(/dois grupos/i);
    expect(() => homogeneityCheck([[1, 2], [3, Number.NaN]])).toThrow(/inválido/i);
    expect(() => homogeneityCheck([[1, 2]], { labels: ['A', 'B'] })).toThrow(/rótulos/i);
    expect(() =>
      homogeneityCheck([[1, 2], [3, 4]], { maxVarianceRatio: 0 }),
    ).toThrow(/razão de variâncias/i);
  });

  it('retorna não avaliado com dados insuficientes', () => {
    const result = homogeneityCheck([[1, 2], [3]]);
    expect(result.homogeneous).toBeNull();
    expect(result.verdict).toBe('not_evaluated');
    expect(result.warnings.some((warning) => warning.includes('menos de 2'))).toBe(true);
  });
});

describe('alias gagerrNested', () => {
  it('aponta para a mesma implementação', () => {
    expect(gagerrNested).toBe(gageRRNested);
  });
});
