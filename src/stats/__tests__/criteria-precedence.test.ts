import { describe, expect, it } from 'vitest';
import type {
  AcceptanceCriterion,
  Measurement,
  ParamKey,
  ValidationParameter,
} from '../../lib/types';
import { resolveCriteria, resolveCriteriaDetailed } from '../../lib/criteria';
import { analyzeValidation } from '../analysis';

function criterion(
  id: string,
  parameter: ParamKey,
  metric: string,
  limit: number,
  operator: AcceptanceCriterion['operator'] = '<=',
): AcceptanceCriterion {
  return { id, parameter, metric, operator, limit, unit: '' };
}

function measurement(id: string, value: number): Measurement {
  return {
    id,
    validationId: 'v-precedencia',
    runOrder: Number(id.replace(/\D/g, '')) || 1,
    level: '10',
    analyst: 'A1',
    day: 'D1',
    equipment: 'E1',
    lot: 'L1',
    sample: id,
    replicate: 1,
    value,
    referenceValue: 10,
    textValue: '',
    notes: '',
  };
}

const METHOD_CRITERIA: AcceptanceCriterion[] = [
  criterion('g-cv', 'repeatability', 'cv', 2),
  criterion('g-sr', 'repeatability', 'sr', 1),
  criterion('g-recovery', 'accuracy', 'recovery', 98, '>='),
];

describe('precedência de critérios', () => {
  it('mantém os globais sem específico e adiciona métricas novas', () => {
    const resolved = resolveCriteria(
      METHOD_CRITERIA,
      [criterion('v-sd', 'repeatability', 'sd', 0.5)],
      'repeatability',
    );
    expect(resolved.map((item) => item.id)).toEqual(['g-cv', 'g-sr', 'v-sd']);
  });

  it('substitui o global da mesma métrica', () => {
    const resolved = resolveCriteria(
      METHOD_CRITERIA,
      [criterion('v-cv', 'repeatability', 'cv', 5)],
      'repeatability',
    );
    expect(resolved.map((item) => item.id)).toEqual(['g-sr', 'v-cv']);
  });

  it('ignora critérios específicos de outro parâmetro', () => {
    const resolved = resolveCriteria(
      METHOD_CRITERIA,
      [criterion('v-cv', 'accuracy', 'cv', 5)],
      'repeatability',
    );
    expect(resolved.map((item) => item.id)).toEqual(['g-cv', 'g-sr']);
  });

  it('registra a origem e o critério global substituído', () => {
    const detailed = resolveCriteriaDetailed(
      METHOD_CRITERIA,
      [criterion('v-cv', 'repeatability', 'cv', 5)],
      'repeatability',
    );
    expect(detailed.find((item) => item.criterion.id === 'v-cv')).toMatchObject({
      source: 'validation',
      replaced: { id: 'g-cv' },
    });
    expect(detailed.find((item) => item.criterion.id === 'g-sr')).toMatchObject({
      source: 'method',
      replaced: null,
    });
  });

  it('mantém específicos duplicados e remove todos os globais da métrica', () => {
    const resolved = resolveCriteria(
      METHOD_CRITERIA,
      [
        criterion('v-cv-1', 'repeatability', 'cv', 3),
        criterion('v-cv-2', 'repeatability', 'cv', 4),
      ],
      'repeatability',
    );
    expect(resolved.map((item) => item.id)).toEqual(['g-sr', 'v-cv-1', 'v-cv-2']);
  });

  it('usa o específico no lugar do global na análise', () => {
    const parameters: ValidationParameter[] = [
      {
        validationId: 'v-precedencia',
        key: 'repeatability',
        selected: true,
        justification: 'Teste de precedência',
        criteria: [criterion('v-cv', 'repeatability', 'cv', 100)],
      },
    ];
    const measurements = [
      9.9, 10.1, 10, 10.2, 9.8, 10.1, 9.9, 10, 10.1, 9.9,
    ].map((value, index) => measurement(`m-${index + 1}`, value));

    const analysis = analyzeValidation(parameters, measurements, [
      criterion('g-cv', 'repeatability', 'cv', 0.01),
    ]);

    expect(analysis.parameters).toHaveLength(1);
    expect(analysis.parameters[0].verdict).toBe('pass');
    expect(
      analysis.parameters[0].metrics.find((metric) => metric.key === 'cv')?.criterionText,
    ).toContain('100');
    expect(analysis.assumptions.some((line) => line.includes('substituem'))).toBe(true);
  });
});
