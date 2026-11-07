import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAGERR_CRITERIA,
  gageRRAnalysis,
  type GageRRComponent,
  type GageRRMatrix,
  type GageRRResult,
} from '../index';

/**
 * Referências dos conjuntos de teste:
 *  - AIAG (2010), MSA Reference Manual, 4. ed.: estudo cruzado 10 peças ×
 *    3 operadores × 3 réplicas, tolerância 8. Valores de ANOVA e componentes
 *    conferidos contra a tabela publicada (Minitab Crossed Gage R&R).
 *  - Conjunto independente calculado em Python/NumPy por fórmulas explícitas
 *    (sem reutilizar o código TypeScript).
 *  - Planilha 3 × 2 × 2 conferida célula a célula, com somas de quadrados
 *    obtidas à mão.
 */

const close = (actual: number, expected: number, tol = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

function component(result: GageRRResult, key: GageRRComponent['key']): GageRRComponent {
  const found = result.components.find((item) => item.key === key);
  if (!found) throw new Error(`Componente ausente: ${key}`);
  return found;
}

// Tabela publicada AIAG: linhas por operador e réplica, colunas por peça.
const AIAG_ROWS: Record<string, number[][]> = {
  A: [
    [0.29, -0.56, 1.34, 0.47, -0.8, 0.02, 0.59, -0.31, 2.26, -1.36],
    [0.41, -0.68, 1.17, 0.5, -0.92, -0.11, 0.75, -0.2, 1.99, -1.25],
    [0.64, -0.58, 1.27, 0.64, -0.84, -0.21, 0.66, -0.17, 2.01, -1.31],
  ],
  B: [
    [0.08, -0.47, 1.19, 0.01, -0.56, -0.2, 0.47, -0.63, 1.8, -1.68],
    [0.25, -1.22, 0.94, 1.03, -1.2, 0.22, 0.55, 0.08, 2.12, -1.62],
    [0.07, -0.68, 1.34, 0.2, -1.28, 0.06, 0.83, -0.34, 2.19, -1.5],
  ],
  C: [
    [0.04, -1.38, 0.88, 0.14, -1.46, -0.29, 0.02, -0.46, 1.77, -1.49],
    [-0.11, -1.13, 1.09, 0.2, -1.07, -0.67, 0.01, -0.56, 1.45, -1.77],
    [-0.15, -0.96, 0.67, 0.11, -1.45, -0.49, 0.21, -0.49, 1.87, -2.16],
  ],
};

function aiagMatrix(): GageRRMatrix {
  const operators = ['A', 'B', 'C'];
  return Array.from({ length: 10 }, (_, part) =>
    operators.map((operator) => AIAG_ROWS[operator].map((row) => row[part])),
  );
}

describe('Gage R&R — AIAG MSA 10 × 3 × 3', () => {
  it('reproduz a ANOVA publicada e adota o modelo sem interação', () => {
    const result = gageRRAnalysis({ y: aiagMatrix(), tolerance: 8 });
    expect(result.model).toBe('without_interaction');
    expect(result.interaction.p).not.toBeNull();
    expect(result.interaction.decision).toContain('não significativa');
    expect(result.interaction.decision).toContain('sem interação');
    close(result.interaction.f ?? NaN, 0.4337210301351029);
    close(result.interaction.p ?? NaN, 0.9741064043290459);

    const full = result.anova.full;
    expect(full.map((row) => row.df)).toEqual([9, 2, 18, 60, 89]);
    close(full[0].ss, 88.36193444444444);
    close(full[1].ss, 3.167262222222222);
    close(full[2].ss, 0.358982222222222);
    close(full[3].ss, 2.758933333333334);
    close(full[4].ss, 94.64711222222222);
    close(full[0].ms ?? NaN, 9.817992716049382);
    close(full[1].ms ?? NaN, 1.5836311111111111);
    close(full[2].ms ?? NaN, 0.019943456790123448);
    close(full[3].ms ?? NaN, 0.04598222222222224);
    close(full[0].f ?? NaN, 492.2914226640752);
    close(full[1].f ?? NaN, 79.40604920082706);
    close(full[2].f ?? NaN, 0.4337210301351029);

    const reduced = result.anova.reduced;
    expect(reduced).not.toBeNull();
    close(reduced?.[2].ss ?? NaN, 3.117915555555556);
    expect(reduced?.[2].df).toBe(78);
    close(reduced?.[2].ms ?? NaN, 0.03997327635327636);
    close(reduced?.[0].f ?? NaN, 245.614, 1e-2);
    close(reduced?.[1].f ?? NaN, 39.617, 1e-2);
  });

  it('calcula componentes, contribuições, %P/T e ndc', () => {
    const result = gageRRAnalysis({ y: aiagMatrix(), tolerance: 8 });
    close(component(result, 'repeatability').variance, 0.03997327635327636);
    close(component(result, 'interaction').variance, 0);
    close(component(result, 'operator').variance, 0.05145526115859449);
    close(component(result, 'part').variance, 1.0864466044106784);
    close(component(result, 'grr').variance, 0.09142853751187086);
    close(component(result, 'total').variance, 1.1778751419225493);

    close(result.rawMetrics.grr_pct ?? NaN, 27.86065088114229);
    close(result.rawMetrics.contribution_grr ?? NaN, 7.762158675208948);
    close(result.rawMetrics.pt_pct ?? NaN, 22.677864174217852);
    expect(result.rawMetrics.ndc).toBe(4);
    expect(result.verdict).toBe('fail');
    expect(result.metrics.find((metric) => metric.key === 'grr_pct')?.verdict).toBe('warning');
    expect(result.metrics.find((metric) => metric.key === 'pt_pct')?.verdict).toBe('warning');
    expect(result.metrics.find((metric) => metric.key === 'ndc')?.verdict).toBe('fail');
  });

  it('apresenta IC de σ_GRR e %GRR por Satterthwaite', () => {
    const result = gageRRAnalysis({ y: aiagMatrix(), tolerance: 8 });
    expect(result.intervals.sigmaGrr).not.toBeNull();
    expect(result.intervals.grrPct).not.toBeNull();
    close(result.intervals.sigmaGrr?.df ?? NaN, 5.918364943329477, 1e-5);
    close(result.intervals.sigmaGrr?.lower ?? NaN, 0.19439117827592564, 1e-5);
    close(result.intervals.sigmaGrr?.upper ?? NaN, 0.6708637942960581, 1e-5);
    close(result.intervals.grrPct?.df ?? NaN, 5.918364943329477, 1e-5);
    close(result.intervals.grrPct?.df2 ?? NaN, 8.926846363245362, 1e-5);
    close(result.intervals.grrPct?.lower ?? NaN, 13.772660950796503, 1e-5);
    close(result.intervals.grrPct?.upper ?? NaN, 56.600424613041646, 1e-5);
  });

  it('permite editar o limiar de interação', () => {
    const strict = gageRRAnalysis(
      { y: aiagMatrix(), tolerance: 8 },
      { interactionThreshold: 0.99 },
    );
    expect(strict.model).toBe('with_interaction');
    expect(strict.interaction.significant).toBe(true);
    expect(strict.anova.selected).toBe('with_interaction');
  });
});

describe('Gage R&R — referência independente', () => {
  const y: GageRRMatrix = [
    [
      [10, 10.1, 9.9],
      [2, 2.1, 1.9],
    ],
    [
      [20, 20.1, 19.9],
      [20, 20.1, 19.9],
    ],
    [
      [30, 30.1, 29.9],
      [22, 22.1, 21.9],
    ],
  ];

  it('reproduz somas de quadrados e componentes com interação significativa', () => {
    const result = gageRRAnalysis({ y, tolerance: 8 });
    expect(result.model).toBe('with_interaction');
    expect(result.interaction.significant).toBe(true);

    close(result.anova.full[0].ss, 1264);
    close(result.anova.full[1].ss, 128);
    close(result.anova.full[2].ss, 64);
    close(result.anova.full[3].ss, 0.12);
    close(result.anova.full[4].ss, 1456.12);
    expect(result.anova.full.map((row) => row.df)).toEqual([2, 1, 2, 12, 17]);

    close(component(result, 'repeatability').variance, 0.01);
    close(component(result, 'interaction').variance, 10.663333333333329);
    close(component(result, 'operator').variance, 10.666666666666671);
    close(component(result, 'part').variance, 100);
    close(component(result, 'grr').variance, 21.34);
    close(component(result, 'total').variance, 121.34);
    close(result.rawMetrics.grr_pct ?? NaN, 41.936792643465616);
    close(result.rawMetrics.pt_pct ?? NaN, 346.4642838735329);
    expect(result.rawMetrics.ndc).toBe(3);
    expect(result.intervals.sigmaGrr).not.toBeNull();
    expect(result.intervals.grrPct).not.toBeNull();
  });

  it('fixa o modelo com interação quando solicitado', () => {
    const result = gageRRAnalysis({ y, tolerance: 8 }, { model: 'with_interaction' });
    expect(result.model).toBe('with_interaction');
    expect(result.notes.some((note) => note.includes('fixado manualmente'))).toBe(true);
    expect(result.interaction.decision).toContain('fixado manualmente');
    expect(result.interaction.decision).toContain('com interação');
  });
});

describe('Gage R&R — planilha validada célula a célula', () => {
  const y: GageRRMatrix = [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [2, 3],
      [4, 5],
    ],
    [
      [3, 4],
      [5, 6],
    ],
  ];

  it('reproduz ANOVA, componentes e tabela de células', () => {
    const result = gageRRAnalysis({ y, tolerance: 5 });
    expect(result.balanced).toBe(true);
    expect(result.model).toBe('without_interaction');

    close(result.anova.full[0].ss, 8);
    close(result.anova.full[1].ss, 12);
    close(result.anova.full[2].ss, 0);
    close(result.anova.full[3].ss, 3);
    close(result.anova.full[4].ss, 23);
    expect(result.anova.full.map((row) => row.df)).toEqual([2, 1, 2, 6, 11]);
    close(result.anova.reduced?.[2].ss ?? NaN, 3);
    expect(result.anova.reduced?.[2].df).toBe(8);
    close(result.anova.reduced?.[2].ms ?? NaN, 0.375);

    close(component(result, 'repeatability').variance, 0.375);
    close(component(result, 'interaction').variance, 0);
    close(component(result, 'operator').variance, 1.9375);
    close(component(result, 'part').variance, 0.90625);
    close(component(result, 'grr').variance, 2.3125);
    close(component(result, 'total').variance, 3.21875);
    close(result.rawMetrics.grr_pct ?? NaN, 84.76122945909572);
    close(result.rawMetrics.contribution_grr ?? NaN, 71.84466019417475);
    close(result.rawMetrics.pt_pct ?? NaN, 182.48287590894657);
    expect(result.rawMetrics.ndc).toBe(0);

    const cells = result.tables.find((table) => table.title.includes('Médias e amplitudes'));
    expect(cells).toBeDefined();
    expect(cells?.columns).toEqual([
      'Peça',
      'Operador',
      'n',
      'Média',
      'Desvio-padrão',
      'Amplitude',
    ]);
    expect(cells?.rows[0]).toEqual(['Peça 1', 'Operador 1', 2, 1.5, 0.707107, 1]);
    expect(cells?.rows[cells.rows.length - 1]).toEqual([
      'Peça 3',
      'Operador 2',
      2,
      5.5,
      0.707107,
      1,
    ]);
  });

  it('deixa %P/T não avaliado quando T não é informado', () => {
    const result = gageRRAnalysis({ y });
    expect(result.tolerance).toBeNull();
    expect(result.rawMetrics.pt_pct).toBeNull();
    expect(result.metrics.find((metric) => metric.key === 'pt_pct')?.verdict).toBe(
      'not_evaluated',
    );
    expect(result.warnings.some((warning) => warning.includes('T = USL − LSL'))).toBe(true);
    expect(result.verdict).not.toBe('not_evaluated');
  });

  it('fornece insumos para gráficos de médias e amplitudes', () => {
    const result = gageRRAnalysis({ y, tolerance: 5 });
    expect(result.charts).toHaveLength(2);
    expect(result.charts[0].kind).toBe('line');
    expect(result.charts[0].data).toHaveLength(6);
    expect(result.charts[0].data[0].mean).toBe(1.5);
    expect(result.charts[1].kind).toBe('bar');
    expect(result.charts[1].data).toHaveLength(6);
    expect(result.charts[1].data[0].range).toBe(1);
  });

  it('aplica critérios editáveis e k configurável', () => {
    const result = gageRRAnalysis(
      { y, tolerance: 4, k: 5 },
      {
        criteria: {
          grrAccept: 90,
          grrWarning: 95,
          ptAccept: 100,
          ptWarning: 120,
          ndcMin: 1,
        },
      },
    );
    close(result.rawMetrics.pt_pct ?? NaN, 190.08632907181936);
    expect(result.metrics.find((metric) => metric.key === 'grr_pct')?.verdict).toBe('pass');
    expect(result.metrics.find((metric) => metric.key === 'pt_pct')?.verdict).toBe('fail');
    expect(result.metrics.find((metric) => metric.key === 'ndc')?.verdict).toBe('fail');
    expect(result.verdict).toBe('fail');
  });
});

describe('Gage R&R — componentes negativos e dados faltantes', () => {
  it('trunca componentes negativos em zero e registra o alerta', () => {
    const y: GageRRMatrix = [
      [
        [9.9, 10.1],
        [14.1, 13.9],
      ],
      [
        [11.9, 12.1],
        [11.9, 12.1],
      ],
      [
        [11.9, 12.1],
        [11.9, 12.1],
      ],
      [
        [13.9, 14.1],
        [9.9, 10.1],
      ],
    ];
    const result = gageRRAnalysis({ y, tolerance: 8 });
    expect(result.model).toBe('with_interaction');
    close(component(result, 'repeatability').variance, 0.02);
    close(component(result, 'interaction').variance, 5.323333333333333);
    close(component(result, 'operator').variance, 0);
    close(component(result, 'part').variance, 0);
    expect(component(result, 'operator').truncated).toBe(true);
    expect(component(result, 'part').truncated).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('truncado'))).toBe(true);
    close(result.rawMetrics.grr_pct ?? NaN, 100);
    expect(result.rawMetrics.ndc).toBe(0);
    expect(result.intervals.sigmaGrr).not.toBeNull();
    expect(result.intervals.grrPct).toBeNull();
  });

  it('trata dados faltantes por análise por lista e registra n efetivo', () => {
    const y = aiagMatrix().map((part) => part.map((operator) => [...operator]));
    y[2][1][2] = null;
    y[5][0][0] = null;
    y[8][2][1] = null;
    y[0][2][0] = null;

    const result = gageRRAnalysis({ y, tolerance: 8 });
    expect(result.balanced).toBe(false);
    expect(result.n).toBe(86);
    expect(result.nEff).toBe(86);
    expect(result.missing).toBe(4);
    expect(result.cells).toBe(30);
    close(result.rEff, 2.8666666666666667);
    expect(result.model).toBe('without_interaction');

    close(result.anova.full[0].ss, 84.77773181524547);
    close(result.anova.full[1].ss, 2.8815933140933225);
    close(result.anova.full[2].ss, 0.4254636303511319);
    close(result.anova.full[3].ss, 2.5763833333333337);
    close(result.anova.full[4].ss, 90.66117209302327);
    expect(result.anova.full.map((row) => row.df)).toEqual([9, 2, 18, 56, 85]);
    close(result.anova.reduced?.[2].ss ?? NaN, 3.0018469636844656);
    expect(result.anova.reduced?.[2].df).toBe(74);

    close(component(result, 'repeatability').variance, 0.040565499509249536);
    close(component(result, 'operator').variance, 0.04884527293735157);
    close(component(result, 'part').variance, 1.0906026139491245);
    close(component(result, 'grr').variance, 0.08941077244660112);
    close(component(result, 'total').variance, 1.1800133863957256);
    close(result.rawMetrics.grr_pct ?? NaN, 27.5265292908278);
    close(result.rawMetrics.pt_pct ?? NaN, 22.426225607804167);
    expect(result.rawMetrics.ndc).toBe(4);
    expect(result.warnings.some((warning) => warning.includes('n efetivo = 86'))).toBe(true);
  });
});

describe('Gage R&R — validação de entrada', () => {
  it('falha claramente com r = 1', () => {
    expect(() =>
      gageRRAnalysis({
        y: [
          [[1], [2]],
          [[3], [4]],
        ],
      }),
    ).toThrow(/r = 1|repetibilidade/i);
  });

  it('exige T positivo e k positivo', () => {
    const y: GageRRMatrix = [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [2, 3],
        [4, 5],
      ],
    ];
    expect(() => gageRRAnalysis({ y, tolerance: 0 })).toThrow(/tolerância/i);
    expect(() => gageRRAnalysis({ y, k: 0 })).toThrow(/multiplicador k/i);
  });

  it('expõe critérios padrão editáveis', () => {
    expect(DEFAULT_GAGERR_CRITERIA).toEqual({
      grrAccept: 10,
      grrWarning: 30,
      ptAccept: 10,
      ptWarning: 30,
      ndcMin: 5,
    });
  });
});
