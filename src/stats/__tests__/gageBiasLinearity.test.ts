/**
 * Referências dos testes:
 *  - Exemplo AIAG/MSA de 5 peças × 10 réplicas (referências 7, 9, 11, 13 e
 *    15), reproduzido de SPC for Excel (2021), "The Calculations Behind a Gage
 *    Linearity Study". Os valores foram conferidos de forma independente em
 *    Python/NumPy: b = −0,132; a = 1,408; s_yx = 0,25304808502206316;
 *    t_b = −10,432799757286524 com 48 graus de liberdade.
 *  - Teste com incerteza-padrão da referência calculado por Welch–Satterthwaite
 *    em Python/NumPy: EP = 0,5033222956847166; gl = 10,259325044404974.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAGE_BIAS_LINEARITY_CRITERIA,
  gageBiasLinearityStudy,
  type GageBiasLevelInput,
} from '../index';

const close = (actual: number, expected: number, tol = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

const AIAG_LEVELS: GageBiasLevelInput[] = [
  { reference: 7, values: [7.7, 7.5, 7.4, 7.5, 7.7, 7.3, 7.5, 7.5, 7.4, 7.4] },
  { reference: 9, values: [10.1, 8.9, 9.2, 10.0, 8.8, 8.9, 8.9, 8.9, 8.9, 9.0] },
  { reference: 11, values: [10.8, 10.7, 10.9, 10.9, 11.0, 11.1, 11.0, 11.1, 11.4, 11.3] },
  { reference: 13, values: [12.6, 12.7, 12.8, 12.7, 12.8, 12.8, 12.8, 12.7, 12.8, 12.5] },
  { reference: 15, values: [14.1, 14.3, 14.5, 14.3, 14.4, 14.5, 14.5, 14.5, 14.6, 14.2] },
];

function aiagStudy() {
  return gageBiasLinearityStudy({
    levels: AIAG_LEVELS,
    tolerance: 20,
    processVariation: 10,
    rangeMin: 7,
    rangeMax: 15,
  });
}

describe('Tendência por nível — exemplo AIAG', () => {
  it('reproduz bias, desvio-padrão, erro-padrão, t e IC por nível', () => {
    const result = aiagStudy();
    expect(result.levels).toHaveLength(5);
    const expected = [
      { reference: 7, bias: 0.49, sd: 0.1286683937707919, sem: 0.040688518719112346, t: 12.0427092316299, ciLow: 0.3979561759382393, ciHigh: 0.5820438240617611 },
      { reference: 9, bias: 0.16000000000000014, sd: 0.4812021982031621, sem: 0.1521694961401776, t: 1.051459090411978, ciLow: -0.18423131564419032, ciHigh: 0.5042313156441907 },
      { reference: 11, bias: 0.019999999999999574, sd: 0.21499353995462814, sem: 0.06798692684790383, t: 0.2941742027072696, ciLow: -0.1337971135417339, ciHigh: 0.17379711354173305 },
      { reference: 13, bias: -0.27999999999999936, sd: 0.10327955589886484, sem: 0.03265986323710916, t: -8.573214099741072, ciLow: -0.353881743555967, ciHigh: -0.2061182564440317 },
      { reference: 15, bias: -0.610000000000003, sd: 0.15951314818673867, sem: 0.05044248650140519, t: -12.0929803883282, ciLow: -0.7241088321456225, ciHigh: -0.4958911678543835 },
    ];
    result.levels.forEach((level, index) => {
      const exp = expected[index];
      expect(level.reference).toBe(exp.reference);
      close(level.bias, exp.bias);
      close(level.sd, exp.sd);
      close(level.sem, exp.sem);
      close(level.t, exp.t);
      close(level.ciLow, exp.ciLow);
      close(level.ciHigh, exp.ciHigh);
      expect(level.n).toBe(10);
    });
    expect(result.levels[0].significant).toBe(true);
    expect(result.levels[1].significant).toBe(false);
    expect(result.levels[2].significant).toBe(false);
    expect(result.levels[3].significant).toBe(true);
    expect(result.levels[4].significant).toBe(true);
  });

  it('reproduz a regressão AIAG e calcula %linearidade e linearidade absoluta', () => {
    const result = aiagStudy();
    close(result.regression.slope, -0.132);
    close(result.regression.intercept, 1.408);
    close(result.regression.syx, 0.25304808502206316);
    close(result.regression.slopeT, -10.432799757286524);
    expect(result.regression.df).toBe(48);
    close(result.linearity ?? NaN, 1.32);
    close(result.linearityPct ?? NaN, 13.2);
    close(result.linearityPctT ?? NaN, 6.6);
    close(result.maxBiasPctT ?? NaN, 3.05);
    expect(result.verdict).toBe('fail');
    expect(result.warnings.some((warning) => warning.includes('Declive significativo'))).toBe(true);
  });

  it('aprova os requisitos de delineamento AIAG', () => {
    const result = aiagStudy();
    expect(result.designAdequate).toBe(true);
    expect(result.levelCount).toBe(5);
    expect(result.replicatesMin).toBe(10);
    close(result.coveragePct ?? NaN, 100);
    expect(result.metrics.find((metric) => metric.key === 'design_levels')?.verdict).toBe('pass');
    expect(result.metrics.find((metric) => metric.key === 'design_replicates')?.verdict).toBe('pass');
  });
});

describe('Tendência com incerteza da referência', () => {
  it('usa EP = √(s²/n + u_ref²) e Welch–Satterthwaite', () => {
    const result = gageBiasLinearityStudy({
      levels: [
        {
          reference: 10,
          values: [10.1, 10.2, 10.3],
          referenceUncertainty: 0.5,
          referenceDof: 10,
        },
      ],
    });
    const level = result.levels[0];
    close(level.bias, 0.2);
    close(level.sd, 0.10000000000000053);
    close(level.sem, 0.5033222956847166);
    close(level.t, 0.39735970711951174);
    close(level.df, 10.259325044404974);
    expect(level.referenceUncertainty).toBe(0.5);
  });

  it('mantém o teste sem incerteza igual ao biasTest pareado', () => {
    const result = gageBiasLinearityStudy({
      levels: [
        { reference: 10, values: [10.1, 10.2, 9.9] },
        { reference: 20, values: [20.1, 20.2, 19.9] },
        { reference: 30, values: [30.1, 30.2, 29.9] },
      ],
    });
    const level = result.levels[0];
    close(level.bias, 0.06666666666666643);
    close(level.sem, 0.08819171036881971);
    close(level.t, 0.7559289460184516);
    expect(level.df).toBe(2);
  });

  it('usa apenas u_ref quando a variabilidade das réplicas é nula', () => {
    const result = gageBiasLinearityStudy({
      levels: [
        {
          reference: 10,
          values: [10.1, 10.1, 10.1],
          referenceUncertainty: 0.5,
          referenceDof: 20,
        },
      ],
    });
    const level = result.levels[0];
    close(level.bias, 0.10000000000000142);
    close(level.sem, 0.5);
    close(level.t, 0.20000000000000284);
    expect(level.df).toBe(20);
    expect(level.warnings.some((warning) => warning.includes('Desvio-padrão das diferenças igual a zero'))).toBe(true);
  });
});

describe('Delineamento e entradas do estudo de linearidade', () => {
  it('sinaliza menos de 5 níveis e menos de 3 réplicas', () => {
    const result = gageBiasLinearityStudy({
      levels: [
        { reference: 7, values: [7.2, 7.0] },
        { reference: 9, values: [9.2, 9.0] },
        { reference: 11, values: [11.2, 11.0] },
      ],
      tolerance: 10,
      rangeMin: 7,
      rangeMax: 15,
    });
    expect(result.designAdequate).toBe(false);
    expect(result.metrics.find((metric) => metric.key === 'design_levels')?.verdict).toBe('warning');
    expect(result.metrics.find((metric) => metric.key === 'design_replicates')?.verdict).toBe('warning');
    expect(result.warnings.some((warning) => warning.includes('pelo menos 5 níveis'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('pelo menos 3'))).toBe(true);
    close(result.coveragePct ?? NaN, 50);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => gageBiasLinearityStudy({ levels: [] })).toThrow(/pelo menos um nível/);
    expect(() =>
      gageBiasLinearityStudy({
        levels: [{ reference: 10, values: [10.1, 10.2], referenceUncertainty: -0.1 }],
      }),
    ).toThrow(/incerteza-padrão/);
    expect(() =>
      gageBiasLinearityStudy({
        levels: [{ reference: 10, values: [10.1, 10.2] }],
        rangeMin: 10,
        rangeMax: 10,
      }),
    ).toThrow(/rangeMin < rangeMax/);
    expect(() =>
      gageBiasLinearityStudy(
        { levels: [{ reference: 10, values: [10.1, 10.2] }] },
        { criteria: { biasPctAccept: 10, biasPctWarning: 5 } },
      ),
    ).toThrow(/maior ou igual/);
    expect(() =>
      gageBiasLinearityStudy({
        levels: [{ reference: 10, values: [10.1, 10.2] }],
        tolerance: -1,
      }),
    ).toThrow(/tolerância/);
  });

  it('mantém os critérios padrão editáveis e documentados', () => {
    expect(DEFAULT_GAGE_BIAS_LINEARITY_CRITERIA).toEqual({
      biasPctAccept: 5,
      biasPctWarning: 10,
      linearityPctAccept: 5,
      linearityPctWarning: 10,
      minLevels: 5,
      minReplicates: 3,
    });
  });
});
