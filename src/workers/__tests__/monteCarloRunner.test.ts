import { describe, expect, it } from 'vitest';
import { executeMonteCarloAsync } from '../monteCarloRunner';

describe('executeMonteCarloAsync', () => {
  it('executa simulação Monte Carlo assíncrona com variáveis normais', async () => {
    const result = await executeMonteCarloAsync({
      variables: [
        {
          name: 'X1',
          estimate: 10,
          halfWidthOrSd: 0.2,
          distribution: 'normal',
        },
        {
          name: 'X2',
          estimate: 5,
          halfWidthOrSd: 0.1,
          distribution: 'normal',
        },
      ],
      trials: 5000,
      coverageProbability: 0.95,
      seed: 42,
    });

    expect(result).toBeDefined();
    expect(result.trials).toBe(5000);
    expect(result.mean).toBeCloseTo(15, 0);
    expect(result.standardUncertainty).toBeGreaterThan(0);
    expect(result.symmetricInterval[0]).toBeLessThan(result.symmetricInterval[1]);
  });

  it('avalia expressão não-linear com sucesso', async () => {
    const result = await executeMonteCarloAsync({
      expression: 'F / (0.25 * 3.14159265 * d^2)',
      variables: [
        {
          name: 'F',
          estimate: 1000,
          halfWidthOrSd: 10,
          distribution: 'normal',
        },
        {
          name: 'd',
          estimate: 10,
          halfWidthOrSd: 0.05,
          distribution: 'rectangular',
        },
      ],
      trials: 3000,
      coverageProbability: 0.95,
      seed: 1234,
    });

    expect(result).toBeDefined();
    expect(result.nominalY).toBeCloseTo(1000 / (0.25 * Math.PI * 100), 1);
    expect(result.histogram.length).toBeGreaterThan(0);
  });
});
