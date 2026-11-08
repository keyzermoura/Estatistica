/**
 * Referências dos testes:
 *  - Constantes A2, D3 e D4 conferidas contra a tabela ASTM MNL 7 para
 *    subgrupos de 2 a 10.
 *  - Carta I-MR: conjunto [10, 12, 11, 13, 12, 11, 10, 9, 10, 11], com
 *    x̄ = 10,9; MR̄ = 1,2222222222222223; LIC = 7,648888888888889 e
 *    LSC = 14,151111111111112; LSC_MR = 3,993. Valores conferidos em
 *    Python/NumPy.
 *  - Carta X̄-R: 5 subgrupos de 5 observações, x̄̄ = 10,2; R̄ = 2;
 *    LIC = 9,046 e LSC = 11,354 para A2 = 0,577 (n = 5); LIC_R = 0 e
 *    LSC_R = 4,228 para D3 = 0 e D4 = 2,114.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STABILITY_CRITERIA,
  IMR_CONSTANTS,
  XBAR_R_CONSTANTS,
  imrStudy,
  stabilityStudy,
  xbarRStudy,
} from '../index';

const close = (actual: number, expected: number, tol = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

const IMR_VALUES = [10, 12, 11, 13, 12, 11, 10, 9, 10, 11];

const XBAR_SUBGROUPS = [
  [10, 11, 9, 10, 10],
  [11, 12, 10, 11, 11],
  [9, 10, 8, 9, 9],
  [10, 11, 9, 10, 10],
  [11, 12, 10, 11, 11],
];

describe('Constantes das cartas de controle', () => {
  it('confere A2, D3 e D4 com a tabela ASTM MNL 7', () => {
    expect(XBAR_R_CONSTANTS[2]).toEqual({ n: 2, A2: 1.88, D3: 0, D4: 3.267 });
    expect(XBAR_R_CONSTANTS[3]).toEqual({ n: 3, A2: 1.023, D3: 0, D4: 2.574 });
    expect(XBAR_R_CONSTANTS[4]).toEqual({ n: 4, A2: 0.729, D3: 0, D4: 2.282 });
    expect(XBAR_R_CONSTANTS[5]).toEqual({ n: 5, A2: 0.577, D3: 0, D4: 2.114 });
    expect(XBAR_R_CONSTANTS[6]).toEqual({ n: 6, A2: 0.483, D3: 0, D4: 2.004 });
    expect(XBAR_R_CONSTANTS[7]).toEqual({ n: 7, A2: 0.419, D3: 0.076, D4: 1.924 });
    expect(XBAR_R_CONSTANTS[8]).toEqual({ n: 8, A2: 0.373, D3: 0.136, D4: 1.864 });
    expect(XBAR_R_CONSTANTS[9]).toEqual({ n: 9, A2: 0.337, D3: 0.184, D4: 1.816 });
    expect(XBAR_R_CONSTANTS[10]).toEqual({ n: 10, A2: 0.308, D3: 0.223, D4: 1.777 });
    expect(IMR_CONSTANTS).toEqual({ d2: 1.128, e2: 2.66, d4mr: 3.267 });
  });
});

describe('Carta I-MR', () => {
  it('reproduz os limites, mantém todos os pontos e calcula a resolução', () => {
    const result = imrStudy(IMR_VALUES, { tolerance: 10, resolution: 1 });
    expect(result.mode).toBe('I-MR');
    expect(result.n).toBe(10);
    expect(result.controlCharts).toHaveLength(2);
    const individual = result.controlCharts[0];
    const movingRange = result.controlCharts[1];
    expect(individual.key).toBe('individual');
    expect(movingRange.key).toBe('moving_range');
    close(individual.center, 10.9);
    close(individual.lcl, 7.648888888888889);
    close(individual.ucl, 14.151111111111112);
    close(movingRange.center, 1.2222222222222223);
    close(movingRange.lcl, 0);
    close(movingRange.ucl, 3.9930000000000003);
    expect(individual.points).toHaveLength(10);
    expect(movingRange.points).toHaveLength(9);
    expect(individual.points.map((point) => point.value)).toEqual(IMR_VALUES);
    expect(result.alarms).toHaveLength(0);
    close(result.sigmaWithin ?? NaN, 1.083530338849488);
    expect(result.distinctValues).toBe(5);
    expect(result.distinctRangeValues).toBe(2);
    close(result.resolution.ratioPct ?? NaN, 10);
    expect(result.resolution.verdict).toBe('pass');
    expect(result.verdict).toBe('pass');
    expect(result.charts).toHaveLength(2);
    expect(result.charts[0].kind).toBe('line');
    expect(result.charts[0].data).toHaveLength(10);
  });

  it('detecta 8 consecutivos do mesmo lado sem excluir pontos', () => {
    const result = imrStudy([1, 1, 1, 1, 1, 1, 1, 1, 1, 10], {
      tolerance: 20,
      resolution: 1,
    });
    const alarm = result.alarms.find(
      (item) => item.rule === 'same_side' && item.chart === 'individual',
    );
    expect(alarm).toBeDefined();
    expect(alarm?.index).toBe(8);
    expect(alarm?.indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.controlCharts[0].points).toHaveLength(10);
  });

  it('detecta 6 pontos consecutivos em tendência', () => {
    const result = imrStudy([1, 2, 3, 4, 5, 6, 7, 8, 8, 8], {
      tolerance: 20,
      resolution: 1,
    });
    const alarm = result.alarms.find(
      (item) => item.rule === 'trend' && item.chart === 'individual',
    );
    expect(alarm).toBeDefined();
    expect(alarm?.index).toBe(6);
    expect(alarm?.indices).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.controlCharts[0].points).toHaveLength(10);
  });

  it('registra ponto fora dos limites e mantém o ponto na carta', () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20];
    const result = imrStudy(values, { tolerance: 20, resolution: 1 });
    const alarm = result.alarms.find(
      (item) => item.rule === 'out_of_limits' && item.chart === 'individual',
    );
    expect(alarm).toBeDefined();
    expect(alarm?.index).toBe(11);
    expect(alarm?.indices).toEqual([11]);
    expect(result.controlCharts[0].points).toHaveLength(11);
    expect(result.controlCharts[0].points[10].value).toBe(20);
  });
});

describe('Carta X̄-R', () => {
  it('reproduz as constantes e os limites para n = 5', () => {
    const result = xbarRStudy(XBAR_SUBGROUPS, { tolerance: 10, resolution: 1 });
    expect(result.mode).toBe('Xbar-R');
    expect(result.subgroupSize).toBe(5);
    expect(result.subgroupCount).toBe(5);
    const xbar = result.controlCharts[0];
    const range = result.controlCharts[1];
    expect(xbar.key).toBe('xbar');
    expect(range.key).toBe('range');
    close(xbar.center, 10.2);
    close(xbar.lcl, 9.046);
    close(xbar.ucl, 11.354);
    close(range.center, 2);
    close(range.lcl, 0);
    close(range.ucl, 4.228);
    close(result.sigmaWithin ?? NaN, 0.7071067811865476);
    expect(xbar.points).toHaveLength(5);
    expect(range.points).toHaveLength(5);
    expect(result.distinctRangeValues).toBe(1);
  });

  it('detecta a média do subgrupo fora dos limites', () => {
    const result = xbarRStudy(XBAR_SUBGROUPS, { tolerance: 10, resolution: 1 });
    const alarm = result.alarms.find(
      (item) => item.rule === 'out_of_limits' && item.chart === 'xbar',
    );
    expect(alarm).toBeDefined();
    expect(alarm?.index).toBe(3);
    expect(alarm?.value).toBe(9);
    expect(result.verdict).toBe('fail');
    expect(result.controlCharts[0].points).toHaveLength(5);
  });

  it('agrupa observações consecutivas quando subgroupSize é informado', () => {
    const result = stabilityStudy(
      { values: [10, 11, 9, 10, 10, 11, 12, 10, 11, 11, 99], subgroupSize: 5 },
      { tolerance: 20, resolution: 1 },
    );
    expect(result.mode).toBe('Xbar-R');
    expect(result.subgroupSize).toBe(5);
    expect(result.subgroupCount).toBe(2);
    expect(result.warnings.some((warning) => warning.includes('fração incompleta'))).toBe(true);
    expect(result.n).toBe(10);
  });
});

describe('Resolução e categorias distintas', () => {
  it('aceita resolução de exatamente 10% de T', () => {
    const result = imrStudy(IMR_VALUES, { tolerance: 10, resolution: 1 });
    close(result.resolution.ratioPct ?? NaN, 10);
    expect(result.resolution.verdict).toBe('pass');
    expect(result.metrics.find((metric) => metric.key === 'resolution_pct')?.verdict).toBe('pass');
  });

  it('reprova resolução acima de 10% de T e registra alerta', () => {
    const result = imrStudy(IMR_VALUES, { tolerance: 5, resolution: 1 });
    close(result.resolution.ratioPct ?? NaN, 20);
    expect(result.resolution.verdict).toBe('fail');
    expect(result.warnings.some((warning) => warning.includes('acima do limite'))).toBe(true);
    expect(result.verdict).toBe('fail');
  });

  it('infere a resolução e conta as categorias distintas de amplitudes', () => {
    const result = imrStudy(IMR_VALUES, { tolerance: 10 });
    expect(result.resolution.inferred).toBe(true);
    close(result.resolution.resolution ?? NaN, 1);
    expect(result.resolution.distinctValues).toBe(5);
    expect(result.resolution.distinctRangeValues).toBe(2);
    expect(result.metrics.find((metric) => metric.key === 'distinct_range_values')?.value).toBe(2);
  });

  it('usa σ_total estimado quando T não é informado', () => {
    const result = imrStudy(IMR_VALUES, { resolution: 1 });
    expect(result.sigmaTotalEstimated).toBe(true);
    close(result.sigmaTotal ?? NaN, 1.1972189997378646);
    close(result.resolution.referenceValue ?? NaN, 1.1972189997378646);
    expect(result.resolution.referenceKind).toBe('sigma_total');
  });
});

describe('Validação e critérios de estabilidade', () => {
  it('mantém os critérios padrão editáveis', () => {
    expect(DEFAULT_STABILITY_CRITERIA).toEqual({
      maxAlarms: 0,
      maxResolutionPct: 10,
      sameSideRun: 8,
      trendRun: 6,
    });
  });

  it('rejeita configurações inválidas', () => {
    expect(() => stabilityStudy({})).toThrow(/Informe values ou subgroups/);
    expect(() =>
      stabilityStudy({ values: IMR_VALUES, subgroups: XBAR_SUBGROUPS }),
    ).toThrow(/não ambos/);
    expect(() => xbarRStudy([[1, 2, 3], [4, 5]])).toThrow(/mesmo tamanho/);
    expect(() => stabilityStudy({ values: IMR_VALUES, subgroupSize: 11 })).toThrow(
      /entre 2 e 10/,
    );
    expect(() =>
      imrStudy(IMR_VALUES, { criteria: { maxAlarms: -1 } }),
    ).toThrow(/máximo de alarmes/);
    expect(() =>
      imrStudy(IMR_VALUES, { tolerance: 10, resolution: 0 }),
    ).toThrow(/resolução/);
  });

  it('permite editar o limite de alarmes e a regra de sequência', () => {
    const result = imrStudy([1, 1, 1, 1, 1, 1, 1, 1, 1, 10], {
      tolerance: 20,
      resolution: 1,
      criteria: { maxAlarms: 10, sameSideRun: 4 },
    });
    expect(result.criteria.maxAlarms).toBe(10);
    expect(result.criteria.sameSideRun).toBe(4);
    expect(result.metrics.find((metric) => metric.key === 'alarm_count')?.verdict).toBe('pass');
    expect(result.alarms.some((alarm) => alarm.rule === 'same_side')).toBe(true);
  });
});
