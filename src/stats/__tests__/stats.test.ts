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

  it('calcula s_r, s_L e s_R em desenho desbalanceado contra referência independente (Python/R)', () => {
    // 3 laboratórios com réplicas desiguais:
    // Lab A: 3 réplicas [10.2, 10.5, 10.1]
    // Lab B: 4 réplicas [9.8, 10.0, 9.9, 10.1]
    // Lab C: 2 réplicas [11.0, 11.2]
    const rows = [
      { lab: 'Lab A', level: '1', replicate: 1, value: 10.2 },
      { lab: 'Lab A', level: '1', replicate: 2, value: 10.5 },
      { lab: 'Lab A', level: '1', replicate: 3, value: 10.1 },
      { lab: 'Lab B', level: '1', replicate: 1, value: 9.8 },
      { lab: 'Lab B', level: '1', replicate: 2, value: 10.0 },
      { lab: 'Lab B', level: '1', replicate: 3, value: 9.9 },
      { lab: 'Lab B', level: '1', replicate: 4, value: 10.1 },
      { lab: 'Lab C', level: '1', replicate: 1, value: 11.0 },
      { lab: 'Lab C', level: '1', replicate: 2, value: 11.2 },
    ];
    const result = iso5725Analysis(rows);
    const lvl = result.levels[0];
    expect(lvl.balanced).toBe(false);
    expect(result.warnings.some((w) => w.includes('número de réplicas desigual entre laboratórios'))).toBe(true);

    // Referência independente calculada via ISO 5725-2:2019 / Python:
    // N = 9, p = 3, sum(n_i²) = 9 + 16 + 4 = 29
    // n_bar = (9 - 29/9) / 2 = 2.888888888888889
    // grandMean = 10.311111111111112
    // msWithin = 0.02611111111111111 => sr = 0.1615893285805409
    // msBetween = 0.886111111111111 => sL2 = (0.8861111 - 0.0261111) / 2.8888889 = 0.2976926926926926
    // sL = 0.5456121943916035
    // sR = 0.5690372864177484
    close(lvl.nBar!, 2.888888888888889, 1e-6);
    close(lvl.grandMean, 10.311111111111112, 1e-6);
    close(lvl.msWithin, 0.02611111111111111, 1e-6);
    close(lvl.msBetween, 0.886111111111111, 1e-6);
    close(lvl.sr, 0.1615893285805409, 1e-6);
    close(lvl.sL, 0.5456121943916035, 1e-6);
    close(lvl.sR, 0.5690372864177484, 1e-6);
  });

  it('remoção de 1 a 2 réplicas de estudo balanceado mantém estimativas consistentes', () => {
    // Estudo balanceado: 6 laboratórios com 5 réplicas cada
    const balancedRows: Array<{ lab: string; level: string; replicate: number; value: number }> = [];
    const labOffsets = [0, 0.5, -0.3, 0.8, -0.6, 0.2];
    const errors = [
      [0.1, -0.1, 0.05, -0.05, 0.0],
      [0.08, -0.06, 0.02, -0.1, 0.06],
      [-0.05, 0.09, -0.04, 0.01, -0.01],
      [0.12, -0.08, 0.04, -0.05, -0.03],
      [-0.1, 0.07, -0.02, 0.08, -0.03],
      [0.05, -0.04, 0.06, -0.08, 0.01],
    ];
    for (let i = 0; i < 6; i++) {
      for (let r = 0; r < 5; r++) {
        balancedRows.push({
          lab: `Lab ${i + 1}`,
          level: '1',
          replicate: r + 1,
          value: 10 + labOffsets[i] + errors[i][r],
        });
      }
    }
    const balancedResult = iso5725Analysis(balancedRows).levels[0];

    // Remove 1 réplica do Lab 1 e 2 réplicas do Lab 2
    const unbalancedRows = balancedRows.filter((r) => {
      if (r.lab === 'Lab 1' && r.replicate === 5) return false;
      if (r.lab === 'Lab 2' && (r.replicate === 4 || r.replicate === 5)) return false;
      return true;
    });
    const unbalancedResult = iso5725Analysis(unbalancedRows).levels[0];

    expect(unbalancedResult.balanced).toBe(false);
    // Estimativas de s_r e s_R devem ser consistentes com o estudo completo (desvio relativo < 8%)
    expect(Math.abs(unbalancedResult.sr - balancedResult.sr) / balancedResult.sr).toBeLessThan(0.08);
    expect(Math.abs(unbalancedResult.sR - balancedResult.sR) / balancedResult.sR).toBeLessThan(0.08);
    expect(Math.abs(unbalancedResult.grandMean - balancedResult.grandMean)).toBeLessThan(0.1);
  });

  it('agregação entre níveis: agrupa quando desvio-padrão é constante entre níveis (p ≥ 0,05)', () => {
    // 3 níveis com médias distintas (10, 50, 100), mas mesma dispersão residual (sr ≈ 0,1)
    const rows: Array<{ lab: string; level: string; replicate: number; value: number }> = [];
    const levels = [
      { name: 'N1', base: 10 },
      { name: 'N2', base: 50 },
      { name: 'N3', base: 100 },
    ];
    for (const lvl of levels) {
      for (let l = 1; l <= 4; l++) {
        // Lab offset constante entre níveis
        const labOffset = (l - 2.5) * 0.05;
        // Erros de réplica idênticos em dispersão
        rows.push({ lab: `L${l}`, level: lvl.name, replicate: 1, value: lvl.base + labOffset - 0.1 });
        rows.push({ lab: `L${l}`, level: lvl.name, replicate: 2, value: lvl.base + labOffset + 0.1 });
      }
    }
    const result = iso5725Analysis(rows);
    expect(result.poolingDecision?.pooled).toBe(true);
    expect(result.pooled).not.toBeNull();
    expect(result.poolingDecision?.regressionSr?.significant).toBe(false);
    expect(result.warnings.some((w) => w.includes('dependência estatisticamente significativa'))).toBe(false);
  });

  it('agregação entre níveis: não agrupa quando desvio-padrão é proporcional à média (p < 0,05)', () => {
    // 3 níveis onde sr é proporcional à concentração média (CV ≈ 1%)
    // N1 (m=10, erro=±0,10), N2 (m=50, erro=±0,50), N3 (m=100, erro=±1,00)
    const rows: Array<{ lab: string; level: string; replicate: number; value: number }> = [];
    const configs = [
      { name: 'N1', base: 10, scale: 0.1 },
      { name: 'N2', base: 50, scale: 0.5 },
      { name: 'N3', base: 100, scale: 1.0 },
    ];
    for (const cfg of configs) {
      for (let l = 1; l <= 4; l++) {
        const labOffset = (l - 2.5) * cfg.scale * 0.2;
        rows.push({ lab: `L${l}`, level: cfg.name, replicate: 1, value: cfg.base + labOffset - cfg.scale });
        rows.push({ lab: `L${l}`, level: cfg.name, replicate: 2, value: cfg.base + labOffset + cfg.scale });
      }
    }
    const result = iso5725Analysis(rows);
    expect(result.poolingDecision?.pooled).toBe(false);
    expect(Number.isNaN(result.pooled.sr)).toBe(true);
    expect(result.poolingDecision?.regressionSr?.significant).toBe(true);
    // Inclinação log-log de sr vs m deve ser próxima de 1,0 (proporcionalidade direta)
    expect(result.poolingDecision?.regressionSr?.slope).toBeCloseTo(1.0, 1);
    expect(result.warnings.some((w) => w.includes('dependência estatisticamente significativa'))).toBe(true);
    expect(result.interpretation).toContain('Agregação global suprimida');
  });

  it('prevenção do viés de truncamento de s_L² em simulação determinística', () => {
    // Estudo determinístico em 3 níveis onde a variância real interlaboratorial é nula (σ_L² = 0).
    // Amostras finitas geram flutuações simétricas: Nível A tem MSB > MSW (sL² > 0) e Nível B tem MSB < MSW (sL² < 0).
    // Delineamento: 3 laboratórios por nível, 2 réplicas por laboratório (n = 2, df_between = 2, df_within = 3).
    // Nível A: MSB = 0,08, MSW = 0,02 => sL²_raw = (0,08 - 0,02)/2 = +0,03
    // Nível B: MSB = 0,02, MSW = 0,08 => sL²_raw = (0,02 - 0,08)/2 = -0,03
    // Nível C: MSB = 0,04, MSW = 0,04 => sL²_raw = 0
    const rows: Array<{ lab: string; level: string; replicate: number; value: number }> = [
      // Nível A (MSB > MSW):
      // Lab 1: [9.8, 10.0] (mean 9.9)
      // Lab 2: [10.0, 10.0] (mean 10.0)
      // Lab 3: [10.1, 10.1] (mean 10.1)
      { lab: 'L1', level: 'A', replicate: 1, value: 9.9 },
      { lab: 'L1', level: 'A', replicate: 2, value: 9.9 },
      { lab: 'L2', level: 'A', replicate: 1, value: 10.0 },
      { lab: 'L2', level: 'A', replicate: 2, value: 10.0 },
      { lab: 'L3', level: 'A', replicate: 1, value: 10.1 },
      { lab: 'L3', level: 'A', replicate: 2, value: 10.1 },

      // Nível B (MSB < MSW: médias dos laboratórios iguais a 10.0, mas variabilidade interna):
      // Lab 1: [9.9, 10.1] (mean 10.0)
      // Lab 2: [9.9, 10.1] (mean 10.0)
      // Lab 3: [9.9, 10.1] (mean 10.0)
      { lab: 'L1', level: 'B', replicate: 1, value: 9.9 },
      { lab: 'L1', level: 'B', replicate: 2, value: 10.1 },
      { lab: 'L2', level: 'B', replicate: 1, value: 9.9 },
      { lab: 'L2', level: 'B', replicate: 2, value: 10.1 },
      { lab: 'L3', level: 'B', replicate: 1, value: 9.9 },
      { lab: 'L3', level: 'B', replicate: 2, value: 10.1 },

      // Nível C (neutro):
      { lab: 'L1', level: 'C', replicate: 1, value: 10.0 },
      { lab: 'L1', level: 'C', replicate: 2, value: 10.0 },
      { lab: 'L2', level: 'C', replicate: 1, value: 10.0 },
      { lab: 'L2', level: 'C', replicate: 2, value: 10.0 },
      { lab: 'L3', level: 'C', replicate: 1, value: 10.0 },
      { lab: 'L3', level: 'C', replicate: 2, value: 10.0 },
    ];

    const result = iso5725Analysis(rows);
    const lvlA = result.levels.find((l) => l.level === 'A')!;
    const lvlB = result.levels.find((l) => l.level === 'B')!;

    // No nível individual, o truncamento é obrigatório pela norma:
    expect(lvlA.sL).toBeGreaterThan(0);
    expect(lvlB.sL).toBe(0); // MSB < MSW foi truncado em 0

    // Se o motor agrupasse truncando antes da soma (bug antigo):
    // soma truncada = (df_A * sL_A² + df_B * 0) / (df_A + df_B) > 0 (viés positivo artificial!)
    // Com agregação não-viesada: os termos brutos se compensam e o truncamento final resulta em 0:
    expect(result.pooled).not.toBeNull();
    // A variância agrupada sL² antes do truncamento é ≤ 0, eliminando o viés artificial:
    expect(result.pooled!.sL).toBe(0);
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

  it('mantém rótulos alinhados na precisão quando há nível com n = 1', () => {
    const base = {
      validationId: 'v-prec',
      analyst: 'Ana',
      day: 'D1',
      equipment: 'HPLC',
      lot: 'L1',
      sample: 'S1',
      textValue: '',
      notes: '',
    };
    const measurements: Measurement[] = [
      { ...base, id: 'm1', runOrder: 1, level: 'único', replicate: 1, value: 99 },
      { ...base, id: 'm2', runOrder: 2, level: 'baixo', replicate: 1, value: 10.1 },
      { ...base, id: 'm3', runOrder: 3, level: 'baixo', replicate: 2, value: 9.9 },
      { ...base, id: 'm4', runOrder: 4, level: 'alto', replicate: 1, value: 50.2 },
      { ...base, id: 'm5', runOrder: 5, level: 'alto', replicate: 2, value: 49.8 },
    ];
    const parameters: ValidationParameter[] = [
      { validationId: 'v-prec', key: 'repeatability', selected: true, justification: '', criteria: [] },
    ];
    const result = analyzeValidation(parameters, measurements, []);
    const rep = result.parameters[0];
    expect(rep.tables[0]?.rows.map((r) => r[0])).toEqual(['baixo', 'alto']);
  });

  it('usa refValue e refUncertainty na exatidão analítica', () => {
    const base = {
      validationId: 'v-acc',
      level: 'MRC',
      analyst: 'Ana',
      day: 'D1',
      equipment: 'HPLC',
      lot: 'L1',
      sample: 'S1',
      textValue: '',
      notes: '',
    };
    const withoutUncertainty: Measurement[] = [10.08, 10.09, 10.07, 10.1].map((value, i) => ({
      ...base,
      id: `a${i}`,
      runOrder: i + 1,
      replicate: i + 1,
      value,
      refValue: 10.0,
    }));
    const withUncertainty = withoutUncertainty.map((m) => ({
      ...m,
      refUncertainty: 0.4, // u_ref = 0.2
    }));
    const params: ValidationParameter[] = [
      {
        validationId: 'v-acc',
        key: 'accuracy',
        selected: true,
        justification: '',
        criteria: [
          { id: 'c1', parameter: 'accuracy', metric: 'biasP', operator: '>=', limit: 0.05 },
        ],
      },
    ];
    const resNoU = analyzeValidation(params, withoutUncertainty, []);
    const resWithU = analyzeValidation(params, withUncertainty, []);
    expect(resNoU.parameters[0].verdict).toBe('fail');
    expect(resWithU.parameters[0].verdict).toBe('pass');
    expect(resWithU.parameters[0].rawMetrics.biasP).toBeGreaterThan(0.05);
  });

  it('avalia seletividade quando há medições com interferentes, brancos e resolução', () => {
    const base = {
      validationId: 'v-sel',
      analyst: 'Ana',
      day: 'D1',
      equipment: 'HPLC',
      lot: 'L1',
      textValue: '',
      notes: '',
    };
    const measurements: Measurement[] = [
      { ...base, id: 's1', runOrder: 1, level: '10', sample: 'Branco matriz', replicate: 1, value: 0.01 },
      { ...base, id: 's2', runOrder: 2, level: '10', sample: 'Amostra interferente 1', replicate: 1, value: 9.8, referenceValue: 10 },
      { ...base, id: 's3', runOrder: 3, level: '10', sample: 'Amostra interferente 2', replicate: 2, value: 10.1, referenceValue: 10 },
      { ...base, id: 's4', runOrder: 4, level: '10', sample: 'Padrão controle 1', replicate: 1, value: 10.0, referenceValue: 10 },
      { ...base, id: 's5', runOrder: 5, level: '10', sample: 'Padrão controle 2', replicate: 2, value: 10.05, referenceValue: 10 },
      { ...base, id: 's6', runOrder: 6, level: 'resolução Rs', sample: 'Resolução crítica', replicate: 1, value: 2.1 },
    ];
    const params: ValidationParameter[] = [
      {
        validationId: 'v-sel',
        key: 'selectivity',
        selected: true,
        justification: '',
        criteria: [
          { id: 'sel-1', parameter: 'selectivity', metric: 'interferenceRecovery', operator: 'between', limit: 90, limit2: 110 },
          { id: 'sel-2', parameter: 'selectivity', metric: 'resolution', operator: '>=', limit: 1.5 },
        ],
      },
    ];
    const result = analyzeValidation(params, measurements, []);
    const sel = result.parameters[0];
    expect(sel.verdict).toBe('pass');
    expect(sel.rawMetrics.interferenceRecovery).toBeCloseTo(99.5, 1);
    expect(sel.rawMetrics.resolution).toBeCloseTo(2.1, 4);
  });
});
