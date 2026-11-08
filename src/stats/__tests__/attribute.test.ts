/**
 * Referências dos testes:
 *
 * - Fleiss (1971), 10 itens × 14 avaliadores × 5 categorias (tabela clássica
 *   de contagens). Valores conferidos em Python/NumPy com as equações do
 *   artigo: κ = 0,20993070442195522; EP = 0,016965069224393132;
 *   z = 12,374291059190464; IC95% = (0,17667977974691582,
 *   0,24318162909699462); P̄ = 0,378021978021978; p_j = (0,142857...,
 *   0,2, 0,278571..., 0,15, 0,228571...); p_e = 0,21275510204081632.
 * - sklearn.metrics.cohen_kappa_score, exemplo 3×3
 *   [[2,0,0],[0,1,0],[1,0,1]]: nominal 0,6875; linear 0,5833333333333334;
 *   quadrático 0,5. EP pela fórmula de Fleiss, Cohen & Everitt (1969) na
 *   parametrização de `irr::kappa2`: 0,3010398644698074; 0,34156502553198664;
 *   0,4000000000000002.
 * - Pacote R `irr` 0.84.1: `kappa2` para os conjuntos `anxiety` e
 *   `diagnoses`. Para `anxiety`: nominal κ = 0,11949685534591195,
 *   EP = 0,10268150349195661; linear κ = 0,18918918918918934,
 *   EP = 0,1336403817846071; quadrático κ = 0,29676511954993035,
 *   EP = 0,221384103778562. Para `diagnoses`: κ = 0,6511627906976744,
 *   z = 6,996470769782091. Valores de EP conferidos em Python/NumPy.
 * - Cohen 2×2 [[20,5],[10,15]]: κ = 0,4; p_o = 0,7; p_e = 0,5;
 *   EP = 0,1385640646055102; z = 2,8867513459481278;
 *   p = 0,0038924171227785465; IC95% = (0,12841942382171867,
 *   0,6715805761782812).
 * - Fleiss ponderado (5 itens × 3 categorias, m = 4): contagens
 *   [[3,1,0],[0,4,0],[1,2,1],[0,1,3],[2,0,2]]; nominal κ =
 *   0,24242424242424263 com EP analítico 0,12963181597701476; linear κ =
 *   0,2063492063492066 com EP jackknife 0,2303583134073125; quadrático κ =
 *   0,1666666666666668 com EP jackknife 0,3780652501002086.
 * - Intervalos de Wilson conferidos em Python/NumPy (função `ciProportion`).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_INPUT } from '../../lib/types';
import {
  DEFAULT_ATTRIBUTE_AGREEMENT_CRITERIA,
  attributeAgreementStudy,
  buildDesign,
  ciProportion,
  cohenKappa,
  fleissKappa,
  fleissKappaFromCounts,
  type AttributeObservation,
} from '../index';

const close = (actual: number | null, expected: number, tol = 1e-9) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
};

const repeat = (value: string, count: number): string[] =>
  Array.from({ length: count }, () => value);

const FLEISS_1971 = [
  [0, 0, 0, 0, 14],
  [0, 2, 6, 4, 2],
  [0, 0, 3, 5, 6],
  [0, 3, 9, 2, 0],
  [2, 2, 8, 1, 1],
  [7, 7, 0, 0, 0],
  [3, 2, 6, 3, 0],
  [2, 5, 3, 2, 2],
  [6, 5, 2, 1, 0],
  [0, 2, 2, 3, 7],
];

const ANXIETY: Array<[number, number]> = [
  [3, 3],
  [3, 6],
  [3, 4],
  [4, 6],
  [5, 2],
  [5, 4],
  [2, 2],
  [3, 4],
  [5, 3],
  [2, 3],
  [2, 2],
  [6, 3],
  [1, 3],
  [5, 3],
  [2, 2],
  [2, 2],
  [1, 1],
  [2, 3],
  [4, 3],
  [3, 4],
];

const DIAGNOSES: Array<[string, string]> = [
  ['4', '4'],
  ['2', '2'],
  ['2', '3'],
  ['5', '5'],
  ['2', '2'],
  ['1', '1'],
  ['3', '3'],
  ['1', '1'],
  ['1', '1'],
  ['5', '5'],
  ['1', '4'],
  ['1', '2'],
  ['2', '2'],
  ['1', '4'],
  ['2', '2'],
  ['3', '3'],
  ['1', '1'],
  ['1', '1'],
  ['2', '2'],
  ['1', '3'],
  ['5', '5'],
  ['2', '4'],
  ['2', '2'],
  ['1', '1'],
  ['1', '4'],
  ['2', '2'],
  ['1', '1'],
  ['2', '2'],
  ['1', '3'],
  ['5', '5'],
];

const pairs = (data: ReadonlyArray<readonly [string | number, string | number]>) => ({
  first: data.map(([a]) => String(a)),
  second: data.map(([, b]) => String(b)),
});

describe('Kappa de Cohen', () => {
  it('reproduz a tabela 2×2 de referência com EP, z, p e IC', () => {
    const first = [...repeat('A', 20), ...repeat('A', 5), ...repeat('B', 10), ...repeat('B', 15)];
    const second = [...repeat('A', 20), ...repeat('B', 5), ...repeat('A', 10), ...repeat('B', 15)];
    const result = cohenKappa(first, second, {
      categories: ['A', 'B'],
      confidence: 0.95,
    });
    expect(result.defined).toBe(true);
    expect(result.method).toBe('cohen');
    close(result.po, 0.7);
    close(result.pe, 0.5);
    close(result.kappa, 0.4);
    close(result.se, 0.1385640646055102);
    close(result.z, 2.8867513459481278);
    close(result.pValue, 0.0038924171227785465);
    close(result.ciLow, 0.12841942382171867);
    close(result.ciHigh, 0.6715805761782812);
    expect(result.seMethod).toBe('analytic');
    expect(result.missing).toBe(0);
  });

  it('confere com sklearn nos pesos nominais, lineares e quadráticos', () => {
    const first = ['negative', 'positive', 'negative', 'neutral', 'positive'];
    const second = ['negative', 'positive', 'negative', 'neutral', 'negative'];
    const categories = ['negative', 'neutral', 'positive'];

    const nominal = cohenKappa(first, second, { categories, weight: 'none' });
    close(nominal.kappa, 0.6875);
    close(nominal.se, 0.3010398644698074);

    const linear = cohenKappa(first, second, { categories, weight: 'linear' });
    close(linear.kappa, 0.5833333333333334);
    close(linear.se, 0.34156502553198664);

    const quadratic = cohenKappa(first, second, {
      categories,
      weight: 'quadratic',
    });
    close(quadratic.kappa, 0.5);
    close(quadratic.se, 0.4000000000000002);
  });

  it('confere com o pacote irr no conjunto anxiety', () => {
    const { first, second } = pairs(ANXIETY);
    const categories = ['1', '2', '3', '4', '5', '6'];

    const nominal = cohenKappa(first, second, { categories });
    close(nominal.kappa, 0.11949685534591195);
    close(nominal.se, 0.10268150349195661);
    close(nominal.z, 1.163762228659542);
    expect(nominal.kappa !== null && nominal.kappa < 0.4).toBe(true);

    const linear = cohenKappa(first, second, { categories, weight: 'linear' });
    close(linear.kappa, 0.18918918918918934);
    close(linear.se, 0.1336403817846071);

    const quadratic = cohenKappa(first, second, {
      categories,
      weight: 'quadratic',
    });
    close(quadratic.kappa, 0.29676511954993035);
    close(quadratic.se, 0.221384103778562);
  });

  it('confere com o pacote irr no conjunto diagnoses', () => {
    const { first, second } = pairs(DIAGNOSES);
    const result = cohenKappa(first, second, {
      categories: ['1', '2', '3', '4', '5'],
    });
    close(result.kappa, 0.6511627906976744);
    close(result.z, 6.996470769782091);
    expect(result.defined).toBe(true);
  });

  it('trata p_e = 1 como kappa indefinido com mensagem clara', () => {
    const result = cohenKappa(['A', 'A', 'A'], ['A', 'A', 'A'], {
      categories: ['A', 'B'],
    });
    expect(result.defined).toBe(false);
    expect(result.kappa).toBeNull();
    expect(result.se).toBeNull();
    expect(result.ciLow).toBeNull();
    expect(result.warnings.some((warning) => warning.includes('p_e = 1'))).toBe(true);
  });

  it('conta dados ausentes sem removê-los silenciosamente', () => {
    const result = cohenKappa(['A', null, 'B'], ['A', 'B', 'B'], {
      categories: ['A', 'B'],
    });
    expect(result.subjects).toBe(2);
    expect(result.missing).toBe(1);
    expect(result.defined).toBe(true);
    close(result.kappa, 1);
  });

  it('exige a ordem das categorias no kappa ponderado', () => {
    expect(() =>
      cohenKappa(['A', 'B'], ['A', 'B'], { weight: 'linear' }),
    ).toThrow(/ordem das categorias/);
    expect(() =>
      cohenKappa(['A', 'B'], ['A', 'B'], {
        weight: 'linear',
        categories: ['A'],
      }),
    ).toThrow(/pelo menos duas categorias/);
    expect(() =>
      cohenKappa(['A', 'B'], ['A', 'B'], {
        weight: 'linear',
        categories: ['A', 'A'],
      }),
    ).toThrow(/duplicatas/);
  });
});

describe('Kappa de Fleiss', () => {
  it('reproduz o exemplo de Fleiss (1971) com EP analítico', () => {
    const result = fleissKappaFromCounts(FLEISS_1971, {
      categories: ['1', '2', '3', '4', '5'],
    });
    expect(result.defined).toBe(true);
    expect(result.method).toBe('fleiss');
    expect(result.subjects).toBe(10);
    expect(result.raters).toBe(14);
    close(result.po, 0.378021978021978);
    close(result.pe, 0.21275510204081632);
    close(result.kappa, 0.20993070442195522);
    close(result.se, 0.016965069224393132);
    close(result.z, 12.374291059190464);
    close(result.ciLow, 0.17667977974691582);
    close(result.ciHigh, 0.24318162909699462);
    expect(result.seMethod).toBe('analytic');
    expect(result.warnings).toHaveLength(0);
  });

  it('reproduz o exemplo ponderado e usa jackknife no EP', () => {
    const counts = [
      [3, 1, 0],
      [0, 4, 0],
      [1, 2, 1],
      [0, 1, 3],
      [2, 0, 2],
    ];
    const categories = ['leve', 'moderado', 'grave'];

    const nominal = fleissKappaFromCounts(counts, { categories });
    close(nominal.kappa, 0.24242424242424263);
    close(nominal.se, 0.12963181597701476);
    expect(nominal.seMethod).toBe('analytic');

    const linear = fleissKappaFromCounts(counts, {
      categories,
      weight: 'linear',
    });
    close(linear.kappa, 0.2063492063492066);
    close(linear.se, 0.2303583134073125);
    expect(linear.seMethod).toBe('jackknife');
    expect(linear.warnings.some((warning) => warning.includes('jackknife'))).toBe(true);

    const quadratic = fleissKappaFromCounts(counts, {
      categories,
      weight: 'quadratic',
    });
    close(quadratic.kappa, 0.1666666666666668);
    close(quadratic.se, 0.3780652501002086);
    expect(quadratic.seMethod).toBe('jackknife');
  });

  it('confere com o kappa intra-avaliador de 6 itens × 3 réplicas', () => {
    const ratings = [
      ['A', 'A', 'A'],
      ['A', 'A', 'B'],
      ['B', 'B', 'B'],
      ['A', 'B', 'B'],
      ['B', 'A', 'B'],
      ['A', 'A', 'A'],
    ];
    const result = fleissKappa(ratings, { categories: ['A', 'B'] });
    close(result.po, 0.6666666666666666);
    close(result.pe, 0.5061728395061729);
    close(result.kappa, 0.3249999999999999);
    close(result.se, 0.23570226039551584);
    close(result.z, 1.3788582233137672);
    close(result.pValue, 0.1679384709880125, 1e-8);
  });

  it('exclui itens com avaliação ausente por lista e registra o motivo', () => {
    const result = fleissKappa(
      [
        ['A', 'A'],
        ['A', null],
        ['B', 'B'],
      ],
      { categories: ['A', 'B'] },
    );
    expect(result.subjects).toBe(2);
    expect(result.missing).toBe(1);
    close(result.kappa, 1);
    expect(
      result.warnings.some((warning) => warning.includes('avaliação ausente')),
    ).toBe(true);
  });

  it('trata p_e = 1 como kappa indefinido', () => {
    const result = fleissKappaFromCounts(
      [
        [3, 0],
        [3, 0],
      ],
      { categories: ['A', 'B'] },
    );
    expect(result.defined).toBe(false);
    expect(result.kappa).toBeNull();
    expect(result.warnings.some((warning) => warning.includes('p_e = 1'))).toBe(true);
  });

  it('avisa quando o número de avaliadores varia e usa jackknife', () => {
    const result = fleissKappaFromCounts(
      [
        [2, 0, 0],
        [2, 1, 0],
        [1, 1, 1],
      ],
      { categories: ['A', 'B', 'C'] },
    );
    expect(result.defined).toBe(true);
    expect(result.ratersVariable).toBe(true);
    expect(result.raters).toBe(3);
    expect(result.seMethod).toBe('jackknife');
    expect(
      result.warnings.some((warning) =>
        warning.includes('número de avaliadores varia'),
      ),
    ).toBe(true);
  });
});

describe('Proporções e intervalos de Wilson', () => {
  it('reproduz os limites de Wilson de referência', () => {
    const one = ciProportion(1, 10);
    close(one[0], 0.017876213095072896);
    close(one[1], 0.4041500267952385);

    const nine = ciProportion(9, 10);
    close(nine[0], 0.5958499732047615);
    close(nine[1], 0.9821237869049271);

    const zero = ciProportion(0, 10);
    close(zero[0], 0);
    close(zero[1], 0.2775327998628892);

    const ten = ciProportion(10, 10);
    close(ten[0], 0.7224672001371107);
    close(ten[1], 1);

    const eighteen = ciProportion(18, 20);
    close(eighteen[0], 0.6989663547715128);
    close(eighteen[1], 0.9721335187862319);

    const twenty = ciProportion(20, 20);
    close(twenty[0], 0.8388748419471806);
    close(twenty[1], 1);
  });

  it('respeita a confiança informada', () => {
    const narrow = ciProportion(5, 10, 0.8);
    const wide = ciProportion(5, 10, 0.99);
    expect(wide[0]).toBeLessThan(narrow[0]);
    expect(wide[1]).toBeGreaterThan(narrow[1]);
  });
});

describe('Estudo de concordância de atributo', () => {
  const buildStudy = (): AttributeObservation[] => {
    const observations: AttributeObservation[] = [];
    const reference = (item: number): string =>
      item <= 10 ? 'conforme' : 'não conforme';
    for (let item = 1; item <= 20; item++) {
      const label = String(item).padStart(2, '0');
      const aCategory =
        item === 10 ? 'não conforme' : item === 20 ? 'conforme' : reference(item);
      observations.push({
        item: label,
        rater: 'A',
        category: aCategory,
        replicate: 1,
        reference: reference(item),
      });
      observations.push({
        item: label,
        rater: 'B',
        category: reference(item),
        replicate: 1,
        reference: reference(item),
      });
    }
    return observations;
  };

  it('calcula concordância interavaliadores, referência, eficácia, FAR e FRR', () => {
    const result = attributeAgreementStudy(
      { observations: buildStudy() },
      {
        criteria: {
          effectivenessMinimum: 0.85,
          farMaximum: 0.15,
          frrMaximum: 0.15,
        },
      },
    );

    expect(result.items).toBe(20);
    expect(result.raters).toBe(2);
    expect(result.replicates).toBe(1);
    expect(result.referenceCoveragePct).toBe(100);
    close(result.interRater.kappa, 0.8);

    const raterA = result.vsReference.find((entry) => entry.rater === 'A');
    const raterB = result.vsReference.find((entry) => entry.rater === 'B');
    expect(raterA).toBeDefined();
    expect(raterB).toBeDefined();
    close(raterA!.kappa.kappa, 0.8);
    close(raterA!.effectiveness, 0.9);
    close(raterA!.falseAcceptRate, 0.1);
    close(raterA!.falseRejectRate, 0.1);
    expect(raterA!.falseAccepts).toBe(1);
    expect(raterA!.falseRejects).toBe(1);
    expect(raterA!.referenceAccepts).toBe(10);
    expect(raterA!.referenceRejects).toBe(10);

    close(raterB!.kappa.kappa, 1);
    close(raterB!.effectiveness, 1);
    close(raterB!.falseAcceptRate, 0);
    close(raterB!.falseRejectRate, 0);
    expect(raterB!.falseAccepts).toBe(0);
    expect(raterB!.falseRejects).toBe(0);

    expect(raterA!.verdict).toBe('pass');
    expect(raterB!.verdict).toBe('pass');
    expect(result.verdict).toBe('pass');

    expect(
      result.tables.some((table) => table.title.includes('Matriz de concordância')),
    ).toBe(true);
    expect(result.charts.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain('Veredito global: conforme');
  });

  it('mantém eficácia, FAR e FRR não avaliadas sem critérios cadastrados', () => {
    const result = attributeAgreementStudy({ observations: buildStudy() });
    const raterA = result.vsReference.find((entry) => entry.rater === 'A')!;
    const effectiveness = raterA.metrics.find((metric) =>
      metric.key.startsWith('effectiveness'),
    );
    const far = raterA.metrics.find((metric) => metric.key.startsWith('far'));
    const frr = raterA.metrics.find((metric) => metric.key.startsWith('frr'));
    expect(effectiveness?.verdict).toBe('not_evaluated');
    expect(far?.verdict).toBe('not_evaluated');
    expect(frr?.verdict).toBe('not_evaluated');
    expect(effectiveness?.criterionText).toContain('Sem limite');
    expect(far?.criterionText).toContain('Sem limite');
    expect(frr?.criterionText).toContain('Sem limite');
  });

  it('usa os limiares editáveis de κ e a orientação de Landis & Koch', () => {
    const defaultStudy = attributeAgreementStudy({ observations: buildStudy() });
    expect(defaultStudy.criteria.kappaAccept).toBe(
      DEFAULT_ATTRIBUTE_AGREEMENT_CRITERIA.kappaAccept,
    );
    expect(defaultStudy.criteria.kappaWarning).toBe(
      DEFAULT_ATTRIBUTE_AGREEMENT_CRITERIA.kappaWarning,
    );
    expect(defaultStudy.notes.some((note) => note.includes('Landis & Koch'))).toBe(
      true,
    );

    const strict = attributeAgreementStudy(
      { observations: buildStudy() },
      { criteria: { kappaAccept: 0.9, kappaWarning: 0.7 } },
    );
    const raterA = strict.vsReference.find((entry) => entry.rater === 'A')!;
    expect(raterA.metrics[0].verdict).toBe('warning');
    expect(strict.verdict).toBe('warning');

    expect(() =>
      attributeAgreementStudy(
        { observations: buildStudy() },
        { criteria: { kappaAccept: 0.5, kappaWarning: 0.8 } },
      ),
    ).toThrow(/limite de atenção/);
  });

  it('computa concordância intra-avaliador entre réplicas', () => {
    const ratings = [
      ['A', 'A', 'A'],
      ['A', 'A', 'B'],
      ['B', 'B', 'B'],
      ['A', 'B', 'B'],
      ['B', 'A', 'B'],
      ['A', 'A', 'A'],
    ];
    const observations: AttributeObservation[] = [];
    ratings.forEach((row, itemIndex) => {
      row.forEach((category, replicateIndex) => {
        observations.push({
          item: `I${itemIndex + 1}`,
          rater: 'X',
          category,
          replicate: replicateIndex + 1,
        });
      });
    });
    const result = attributeAgreementStudy({ observations });
    expect(result.intraRater).toHaveLength(1);
    const intra = result.intraRater[0];
    expect(intra.rater).toBe('X');
    expect(intra.items).toBe(6);
    expect(intra.replicates).toBe(3);
    close(intra.kappa.kappa, 0.3249999999999999);
    close(intra.kappa.se, 0.23570226039551584);
    close(intra.kappa.z, 1.3788582233137672);
    close(intra.kappa.pValue, 0.1679384709880125, 1e-8);
    expect(result.interRater.defined).toBe(false);
  });

  it('registra ausência de referência e de mapeamento de aceitação', () => {
    const observations: AttributeObservation[] = [
      { item: '1', rater: 'A', category: 'A' },
      { item: '1', rater: 'B', category: 'A' },
      { item: '2', rater: 'A', category: 'B' },
      { item: '2', rater: 'B', category: 'B' },
    ];
    const result = attributeAgreementStudy({ observations });
    expect(result.referenceCoveragePct).toBe(0);
    close(result.interRater.kappa, 1);
    expect(
      result.warnings.some((warning) => warning.includes('Nenhum item possui referência')),
    ).toBe(true);

    const withReference = attributeAgreementStudy({
      observations: [
        { item: '1', rater: 'A', category: 'A', reference: 'A' },
        { item: '1', rater: 'B', category: 'A', reference: 'A' },
        { item: '2', rater: 'A', category: 'B' },
        { item: '2', rater: 'B', category: 'B' },
      ],
    });
    expect(
      withReference.warnings.some((warning) =>
        warning.includes('categoria de aceitação'),
      ),
    ).toBe(true);
  });

  it('rejeita observações duplicadas e referências conflitantes', () => {
    expect(() =>
      attributeAgreementStudy({
        observations: [
          { item: '1', rater: 'A', category: 'A', replicate: 1 },
          { item: '1', rater: 'A', category: 'B', replicate: 1 },
        ],
      }),
    ).toThrow(/duplicada/);

    expect(() =>
      attributeAgreementStudy({
        observations: [
          { item: '1', rater: 'A', category: 'A', reference: 'A' },
          { item: '1', rater: 'B', category: 'A', reference: 'B' },
        ],
      }),
    ).toThrow(/Referência conflitante/);
  });
});

describe('Delineamento de concordância de atributo', () => {
  const input = {
    ...DEFAULT_DESIGN_INPUT,
    designType: 'attribute_agreement' as const,
    seed: 123,
    nAnalysts: 3,
    nReplicates: 2,
    nSamples: 12,
    nBorderlineSamples: 4,
  };

  it('gera amostras × avaliadores × réplicas com códigos cegos', () => {
    const plan = buildDesign(input, { selected: ['repeatability'] });
    expect(plan.runs).toHaveLength(12 * 3 * 2);
    expect(plan.recommended.samples).toBe(12);
    expect(plan.recommended.borderlineSamples).toBe(4);
    expect(plan.runs.map((run) => run.runOrder)).toEqual(
      Array.from({ length: 72 }, (_, index) => index + 1),
    );
    const samples = [...new Set(plan.runs.map((run) => run.sample))];
    expect(samples).toHaveLength(12);
    expect(samples.every((sample) => /^A-\d{3}$/.test(sample))).toBe(true);
    expect(plan.runs.every((run) => run.factorValues.cego === 'sim')).toBe(true);
    expect(plan.summary).toContain('12 amostras (4 limítrofes)');
    expect(plan.summary).toContain('ordem/códigos cegados pela semente');
    expect(
      plan.assumptions.some((assumption) =>
        assumption.includes('ordem de apresentação é aleatorizada'),
      ),
    ).toBe(true);
  });

  it('é reprodutível com a mesma semente e muda com outra semente', () => {
    const first = buildDesign(input, { selected: ['repeatability'] });
    const second = buildDesign(input, { selected: ['repeatability'] });
    expect(second.runs.map((run) => run.combination)).toEqual(
      first.runs.map((run) => run.combination),
    );
    const other = buildDesign(
      { ...input, seed: 999 },
      { selected: ['repeatability'] },
    );
    expect(other.runs.map((run) => run.combination)).not.toEqual(
      first.runs.map((run) => run.combination),
    );
  });

  it('avisa sobre ausência ou excesso de amostras limítrofes', () => {
    const none = buildDesign(
      { ...input, nBorderlineSamples: 0 },
      { selected: ['repeatability'] },
    );
    expect(
      none.warnings.some((warning) => warning.includes('Nenhuma amostra limítrofe')),
    ).toBe(true);

    const excess = buildDesign(
      { ...input, nSamples: 10, nBorderlineSamples: 15 },
      { selected: ['repeatability'] },
    );
    expect(
      excess.warnings.some((warning) => warning.includes('excede o total')),
    ).toBe(true);
    expect(excess.recommended.borderlineSamples).toBe(10);

    const all = buildDesign(
      { ...input, nSamples: 10, nBorderlineSamples: 10 },
      { selected: ['repeatability'] },
    );
    expect(
      all.warnings.some((warning) => warning.includes('Todas as amostras são limítrofes')),
    ).toBe(true);
  });
});
