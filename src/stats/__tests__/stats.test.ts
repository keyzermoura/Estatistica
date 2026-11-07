import { describe, expect, it } from 'vitest';
import {
  anovaOneWay,
  bartlettTest,
  biasTest,
  buildDesign,
  chi2Cdf,
  computeUncertainty,
  fCdf,
  iso5725Analysis,
  linearRegression,
  lodLoqFromRegression,
  normalCdf,
  normalInv,
  powerTTest,
  sampleSizeTTest,
  shapiroWilk,
  tCdf,
  tInv,
  tost,
  varianceComponentsOneWay,
  analyzeValidation,
} from '../index';
import { DEFAULT_DESIGN_INPUT, type Measurement, type ValidationParameter } from '../../lib/types';

const close = (actual: number, expected: number, tol = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('distribuições', () => {
  it('normal padrão', () => {
    close(normalCdf(1.959963984540054), 0.975, 1e-6);
    close(normalInv(0.975), 1.959963984540054, 1e-6);
  });
  it('t de Student', () => {
    close(tCdf(2.228138852, 10), 0.975, 1e-8);
    close(tInv(0.975, 10), 2.228138852, 1e-7);
  });
  it('χ² e F', () => {
    close(chi2Cdf(18.307038, 10), 0.95, 1e-8);
    close(fCdf(4.102821, 2, 10), 0.95, 1e-8);
  });
});

describe('tamanho de amostra', () => {
  it('reproduz o poder do teste t', () => {
    const power = powerTTest(64, 0.5, 1, { alpha: 0.05, sides: 2, design: 'two_sample' });
    expect(power).toBeGreaterThan(0.79);
    expect(power).toBeLessThan(0.81);
  });
  it('n = 64 por grupo para d = 0,5, poder 80%', () => {
    const result = sampleSizeTTest(0.5, 1, { alpha: 0.05, power: 0.8, design: 'two_sample' });
    expect(result.nPerGroup).toBe(64);
    expect(result.total).toBe(128);
    expect(result.power).toBeGreaterThanOrEqual(0.8);
  });
});

describe('ANOVA e componentes de variância', () => {
  it('ANOVA de um fator (F = 27)', () => {
    const result = anovaOneWay([
      { name: 'A', values: [1, 2, 3] },
      { name: 'B', values: [4, 5, 6] },
      { name: 'C', values: [7, 8, 9] },
    ]);
    close(result.rows[0].f ?? NaN, 27, 1e-9);
    expect(result.rows[0].p).toBeLessThan(0.01);
  });
  it('componentes com grupos balanceados', () => {
    const result = varianceComponentsOneWay([
      { name: 'A', values: [0, 0, 0] },
      { name: 'B', values: [2, 2, 2] },
      { name: 'C', values: [4, 4, 4] },
    ]);
    // MSW = 0; MSB = 12; n0 = 3; s²_between = 4
    close(result.repeatability, 0, 1e-9);
    close(result.betweenA, 4, 1e-9);
  });
});

describe('ISO 5725-2', () => {
  it('calcula s_r, s_L e s_R em desenho balanceado', () => {
    const rows = Array.from({ length: 6 }, (_, i) => {
      const lab = `Lab ${i + 1}`;
      const mean = 10 + i;
      return [
        { lab, level: '1', replicate: 1, value: mean - 0.5 },
        { lab, level: '1', replicate: 2, value: mean + 0.5 },
      ];
    }).flat();
    const result = iso5725Analysis(rows);
    close(result.pooled.sr, Math.sqrt(0.5), 1e-9);
    close(result.pooled.sL, Math.sqrt(3.25), 1e-9);
    close(result.pooled.sR, Math.sqrt(3.75), 1e-9);
    expect(result.pooled.repeatabilityLimit).toBeCloseTo(2.8 * Math.sqrt(0.5), 6);
  });
});

describe('normalidade', () => {
  it('Shapiro-Wilk contra scipy (n = 11)', () => {
    const result = shapiroWilk([148, 154, 158, 160, 161, 162, 166, 170, 182, 195, 236]);
    close(result.statistic, 0.7888146948631716, 1e-6);
    expect(result.pValue).toBeGreaterThan(0.005);
    expect(result.pValue).toBeLessThan(0.008);
  });
  it('Shapiro-Wilk contra scipy (n = 10, normal)', () => {
    const result = shapiroWilk([2.1, 2.4, 2.2, 2.5, 2.3, 2.6, 2.2, 2.4, 2.3, 2.5]);
    close(result.statistic, 0.965721945342874, 1e-6);
    close(result.pValue, 0.8485975564649969, 1e-4);
  });
});

describe('homogeneidade', () => {
  it('Bartlett contra scipy', () => {
    const result = bartlettTest([
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10],
      [1, 3, 5, 7, 9],
    ]);
    close(result.statistic, 1.8836933175523678, 1e-6);
    close(result.pValue, 0.38990714467782495, 1e-6);
  });
});

describe('regressão e LD/LQ', () => {
  const points = [
    { x: 1, y: 2.1 },
    { x: 2, y: 4.2 },
    { x: 3, y: 5.9 },
    { x: 4, y: 8.1 },
    { x: 5, y: 9.8 },
  ];
  it('OLS contra scipy', () => {
    const result = linearRegression(points);
    close(result.slope, 1.93, 1e-9);
    close(result.intercept, 0.23, 1e-9);
    close(result.slopeSe, 0.04434711565217219, 1e-9);
    expect(result.r2).toBeGreaterThan(0.998);
  });
  it('LD e LQ pela curva', () => {
    const result = lodLoqFromRegression(points);
    close(result.lod, (3.3 * result.syx) / 1.93, 1e-9);
    close(result.loq, (10 * result.syx) / 1.93, 1e-9);
  });
});

describe('tendência e TOST', () => {
  it('detecta ausência de tendência em dados simétricos', () => {
    const result = biasTest([10.1, 10.2, 9.9, 10.0], [10, 10, 10, 10]);
    expect(result.meanDifference).toBeCloseTo(0.05, 6);
    expect(result.pValue).toBeGreaterThan(0.05);
  });
  it('TOST com diferença nula e margem ampla', () => {
    const result = tost([10, 10.1, 9.9, 10.05, 9.95], [10, 10, 10, 10, 10], 1, 0.05);
    expect(result.equivalent).toBe(true);
  });
});

describe('incerteza GUM', () => {
  it('combina fontes e calcula Welch-Satterthwaite', () => {
    const result = computeUncertainty([
      { source: 'Repetibilidade', type: 'A', distribution: 'normal', value: 0.5, dof: 9 },
      { source: 'Calibração', type: 'B', distribution: 'rectangular', value: 0.2, dof: 5 },
    ]);
    const expected = Math.sqrt(0.5 ** 2 + (0.2 / Math.sqrt(3)) ** 2);
    close(result.combined, expected, 1e-9);
    expect(result.effectiveDof).toBeGreaterThan(0);
    expect(result.expanded).toBeGreaterThan(result.combined);
  });
});

describe('delineamento', () => {
  it('é reprodutível com a mesma semente', () => {
    const a = buildDesign({ ...DEFAULT_DESIGN_INPUT, seed: 123, nAnalysts: 2, nDays: 2, nReplicates: 2, levels: ['1', '2'] }, { selected: ['repeatability'] });
    const b = buildDesign({ ...DEFAULT_DESIGN_INPUT, seed: 123, nAnalysts: 2, nDays: 2, nReplicates: 2, levels: ['1', '2'] }, { selected: ['repeatability'] });
    expect(a.runs.map((r) => r.combination)).toEqual(b.runs.map((r) => r.combination));
    const c = buildDesign({ ...DEFAULT_DESIGN_INPUT, seed: 999, nAnalysts: 2, nDays: 2, nReplicates: 2, levels: ['1', '2'] }, { selected: ['repeatability'] });
    expect(c.runs.map((r) => r.combination)).not.toEqual(a.runs.map((r) => r.combination));
  });
});

describe('análise integrada', () => {
  it('calcula linearidade, precisão e exatidão', () => {
    const measurements: Measurement[] = [];
    let id = 0;
    for (const level of ['1', '2', '3', '4', '5']) {
      for (let rep = 1; rep <= 3; rep++) {
        id += 1;
        const x = Number(level);
        measurements.push({
          id: `m${id}`,
          validationId: 'v1',
          runOrder: id,
          level,
          analyst: rep === 1 ? 'A' : 'B',
          day: 'D1',
          equipment: 'E1',
          lot: 'L1',
          sample: `S${id}`,
          replicate: rep,
          value: x + (rep - 2) * 0.05,
          textValue: '',
          notes: '',
        });
      }
    }
    const parameters: ValidationParameter[] = [
      { validationId: 'v1', key: 'linearity', selected: true, justification: '', criteria: [] },
      { validationId: 'v1', key: 'repeatability', selected: true, justification: '', criteria: [] },
      { validationId: 'v1', key: 'accuracy', selected: true, justification: '', criteria: [] },
    ];
    const result = analyzeValidation(parameters, measurements, []);
    expect(result.nUsed).toBe(15);
    expect(result.qc.regression?.r2).toBeGreaterThan(0.999);
    const precision = result.parameters.find((p) => p.key === 'repeatability');
    expect(precision?.rawMetrics.cv).toBeLessThan(5);
    const accuracy = result.parameters.find((p) => p.key === 'accuracy');
    expect(accuracy?.rawMetrics.recovery).toBeCloseTo(100, 0);
  });
});
