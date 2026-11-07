import { describe, expect, it } from 'vitest';
import type {
  AcceptanceCriterion,
  Measurement,
  ParamKey,
  UncertaintyItem,
  ValidationParameter,
} from '../../lib/types';
import { analyzeValidation } from '../analysis';

/**
 * Caracterização do comportamento anterior à introdução dos perfis de método.
 *
 * O snapshot foi gerado com a implementação analítica original. Qualquer
 * refatoração deve reproduzir exatamente o mesmo resultado, exceto o instante
 * de geração (removido antes da comparação).
 */

const LEVELS = [5, 10, 15, 20, 25];
const ANALYSTS = ['Ana', 'Bruno'];
const VALUES: number[][] = [
  [5.07, 4.98, 9.94, 10.12, 15.08, 14.96, 19.91, 20.07, 25.04, 24.97],
  [5.02, 5.11, 10.05, 9.89, 14.93, 15.11, 20.03, 19.92, 24.95, 25.08],
];

function criteria(parameter: ParamKey, definitions: Array<[string, AcceptanceCriterion['operator'], number, number?]>): AcceptanceCriterion[] {
  return definitions.map(([metric, operator, limit, limit2], index) => ({
    id: `${parameter}-${index}`,
    parameter,
    metric,
    operator,
    limit,
    limit2,
    unit: '',
  }));
}

function fixtureMeasurements(): Measurement[] {
  const out: Measurement[] = [];
  let order = 0;
  LEVELS.forEach((level, levelIndex) => {
    ANALYSTS.forEach((analyst, analystIndex) => {
      for (let replicate = 1; replicate <= 2; replicate++) {
        const index = levelIndex * 2 + (replicate - 1);
        out.push({
          id: `m-${level}-${analyst}-${replicate}`,
          validationId: 'validation-characterization',
          runOrder: ++order,
          level: String(level),
          analyst,
          day: replicate === 1 ? 'D1' : 'D2',
          equipment: 'HPLC-1',
          lot: 'L-1',
          sample: `S-${level}-${analyst}-${replicate}`,
          replicate,
          value: VALUES[analystIndex][index],
          referenceValue: level,
          textValue: '',
          notes: '',
        });
      }
    });
  });
  return out;
}

function fixtureParameters(): ValidationParameter[] {
  const selected: ParamKey[] = [
    'selectivity',
    'linearity',
    'working_range',
    'lod_loq',
    'repeatability',
    'intermediate_precision',
    'reproducibility',
    'accuracy',
    'robustness',
    'uncertainty',
  ];
  const criteriaByParameter: Record<ParamKey, AcceptanceCriterion[]> = {
    selectivity: criteria('selectivity', [
      ['interferenceRecovery', 'between', 90, 110],
      ['resolution', '>=', 1.5],
    ]),
    linearity: criteria('linearity', [
      ['r2', '>=', 0.99],
      ['lackOfFitP', '>=', 0.05],
      ['slopeP', '<=', 0.05],
    ]),
    working_range: criteria('working_range', [
      ['rangeMin', '<=', 0],
      ['rangeMax', '>=', 0],
    ]),
    lod_loq: criteria('lod_loq', [
      ['lod', '<=', 2],
      ['loq', '<=', 5],
    ]),
    repeatability: criteria('repeatability', [
      ['cv', '<=', 2],
      ['sr', '<=', 1],
    ]),
    intermediate_precision: criteria('intermediate_precision', [
      ['cv', '<=', 5],
      ['sd', '<=', 1],
    ]),
    reproducibility: criteria('reproducibility', [
      ['cvR', '<=', 10],
      ['sR', '<=', 2],
    ]),
    accuracy: criteria('accuracy', [
      ['recovery', 'between', 98, 102],
      ['bias', 'between', -1, 1],
      ['biasP', '>=', 0.05],
    ]),
    robustness: criteria('robustness', [
      ['maxEffect', '<=', 2],
      ['criticalFactorP', '>=', 0.05],
    ]),
    uncertainty: criteria('uncertainty', [
      ['relativeExpanded', '<=', 5],
      ['expanded', '<=', 2],
    ]),
  };
  return selected.map((key) => ({
    validationId: 'validation-characterization',
    key,
    selected: true,
    justification: `Caracterização de ${key}`,
    criteria: criteriaByParameter[key],
  }));
}

const UNCERTAINTY: UncertaintyItem[] = [
  {
    id: 'u-rep',
    validationId: 'validation-characterization',
    source: 'Repetibilidade (Tipo A)',
    type: 'A',
    distribution: 'normal',
    value: 0.2,
    divisor: 1,
    sensitivity: 1,
    stdUncertainty: 0.2,
    dof: 19,
    notes: 's/√n',
  },
  {
    id: 'u-cal',
    validationId: 'validation-characterization',
    source: 'Calibração',
    type: 'B',
    distribution: 'rectangular',
    value: 0.06,
    divisor: Math.sqrt(3),
    sensitivity: 1,
    stdUncertainty: 0.06 / Math.sqrt(3),
    dof: 10,
    notes: 'Certificado',
  },
  {
    id: 'u-pad',
    validationId: 'validation-characterization',
    source: 'Padrão',
    type: 'B',
    distribution: 'normal',
    value: 0.08,
    divisor: 2,
    sensitivity: 1,
    stdUncertainty: 0.04,
    dof: 30,
    notes: 'U/k',
  },
];

describe('caracterização da análise analítica', () => {
  it('reproduz o resultado completo do motor original', () => {
    const analysis = analyzeValidation(
      fixtureParameters(),
      fixtureMeasurements(),
      [],
      {
        alpha: 0.05,
        confidence: 0.95,
        margin: 0.5,
        uncertaintyItems: UNCERTAINTY,
        rangeMin: 5,
        rangeMax: 25,
      },
    );
    const { generatedAt: _generatedAt, ...stable } = analysis;
    expect(stable).toMatchSnapshot();
  });
});
