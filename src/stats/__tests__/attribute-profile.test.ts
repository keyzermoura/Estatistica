import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_INPUT } from '../../lib/types';
import type {
  AcceptanceCriterion,
  Measurement,
  ValidationParameter,
} from '../../lib/types';
import { getProfileForFamily, getProfileForMethod } from '../../profiles/index';
import { ATTRIBUTE_PROFILE } from '../../profiles/attribute';
import {
  attributeObservationsFrom,
  attributeReferenceSheet,
  attributeStudyCriteria,
  buildAttributeStudy,
} from '../attribute-data';
import { analyzeValidation } from '../analysis';
import { buildDesign } from '../design';
import {
  planForParameter,
  sampleSizeAttributeAgreement,
} from '../sampleSize';

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm-1',
    validationId: 'v-attribute',
    runOrder: 1,
    level: '',
    analyst: '',
    day: '',
    equipment: '',
    lot: '',
    sample: '',
    category: '',
    replicate: 1,
    value: null,
    referenceValue: null,
    textValue: '',
    notes: '',
    ...overrides,
  };
}

/** 10 itens, 3 avaliadores e 2 réplicas, com erros conhecidos. */
function fixtureMeasurements(): Measurement[] {
  const items = Array.from({ length: 10 }, (_, index) => `A-${index + 1}`);
  const references = items.map((_, index) =>
    index % 2 === 0 ? 'conforme' : 'não conforme',
  );
  const raters = ['R1', 'R2', 'R3'];
  const out: Measurement[] = [];
  let order = 0;
  items.forEach((item, itemIndex) => {
    raters.forEach((rater, raterIndex) => {
      for (let replicate = 1; replicate <= 2; replicate++) {
        const reference = references[itemIndex];
        const wrong =
          (raterIndex === 0 && itemIndex === 2) ||
          (raterIndex === 1 && (itemIndex === 2 || itemIndex === 6));
        const category = wrong
          ? reference === 'conforme'
            ? 'não conforme'
            : 'conforme'
          : reference;
        out.push(
          measurement({
            id: `m-${item}-${rater}-${replicate}`,
            runOrder: ++order,
            sample: item,
            analyst: rater,
            level: reference,
            category,
            replicate,
          }),
        );
      }
    });
  });
  return out;
}

function parameters(keys: Array<'accuracy' | 'repeatability' | 'intermediate_precision'>): ValidationParameter[] {
  return keys.map((key) => ({
    validationId: 'v-attribute',
    key,
    selected: true,
    justification: `Teste de ${key}`,
    criteria: ATTRIBUTE_PROFILE.defaultCriteria[key] ?? [],
  }));
}

describe('perfil de atributo', () => {
  it('registra e seleciona o perfil para a família attribute', () => {
    expect(getProfileForFamily('attribute').id).toBe('attribute');
    expect(getProfileForMethod({ family: 'attribute' } as never).id).toBe(
      'attribute',
    );
    expect(ATTRIBUTE_PROFILE.parameters.map((parameter) => parameter.key)).toEqual([
      'accuracy',
      'repeatability',
      'intermediate_precision',
    ]);
    expect(ATTRIBUTE_PROFILE.defaultDesignType).toBe('attribute_agreement');
  });

  it('mapeia categoria, referência e diagnósticos sem perder linhas', () => {
    const data = attributeObservationsFrom([
      measurement({
        id: 'a',
        sample: 'A-1',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'b',
        sample: 'A-2',
        analyst: 'R1',
        textValue: 'não conforme',
        level: 'não conforme',
        replicate: 2,
      }),
      measurement({
        id: 'c',
        sample: 'A-3',
        analyst: 'R2',
        value: 1,
        referenceValue: 1,
      }),
      measurement({ id: 'd', sample: '', analyst: 'R1', category: 'conforme' }),
      measurement({ id: 'e', sample: 'A-4', analyst: '', category: 'conforme' }),
      measurement({
        id: 'f',
        sample: 'A-5',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'g',
        sample: 'A-5',
        analyst: 'R1',
        category: 'não conforme',
        level: 'conforme',
      }),
    ]);

    expect(data.validRows).toBe(5);
    expect(data.missingItem).toBe(1);
    expect(data.missingRater).toBe(1);
    expect(data.items).toEqual(['A-1', 'A-2', 'A-3', 'A-5']);
    expect(data.raters).toEqual(['R1', 'R2']);
    expect(data.categories).toEqual(['1', 'conforme', 'não conforme']);
    expect(data.references['A-3']).toBe('1');
    expect(data.duplicateCells).toBe(1);
    expect(data.referenceConflicts).toHaveLength(0);
    expect(data.warnings.some((warning) => warning.includes('duplicada'))).toBe(
      true,
    );
  });

  it('consolida o gabarito de referência por item e sinaliza conflitos', () => {
    const sheet = attributeReferenceSheet([
      measurement({
        id: 'a',
        sample: 'A-2',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'b',
        sample: 'A-2',
        analyst: 'R2',
        category: 'não conforme',
        level: 'não conforme',
        replicate: 2,
      }),
      measurement({
        id: 'c',
        sample: 'A-1',
        analyst: 'R1',
        category: 'conforme',
      }),
      measurement({
        id: 'd',
        sample: 'A-1',
        analyst: 'R2',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'e',
        sample: 'A-3',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'f',
        sample: 'A-3',
        analyst: 'R2',
        category: 'não conforme',
        level: 'não conforme',
      }),
      measurement({
        id: 'g',
        sample: '',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
    ]);

    expect(sheet.items.map((item) => item.item)).toEqual(['A-1', 'A-2', 'A-3']);
    expect(sheet.items[0]).toMatchObject({
      rows: 2,
      reference: 'conforme',
      conflict: false,
    });
    expect(sheet.items[1]).toMatchObject({
      rows: 2,
      reference: null,
      conflict: true,
    });
    expect(sheet.items[1].references).toEqual(['conforme', 'não conforme']);
    expect(sheet.items[2]).toMatchObject({
      rows: 2,
      reference: null,
      conflict: true,
    });
    expect(sheet.categories).toEqual(['conforme', 'não conforme']);
  });

  it('não quebra quando há referências conflitantes ou duplicidades', () => {
    const conflict = buildAttributeStudy([
      measurement({
        id: 'a',
        sample: 'A-1',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'b',
        sample: 'A-1',
        analyst: 'R2',
        category: 'não conforme',
        level: 'não conforme',
      }),
    ]);
    expect(conflict.study).toBeNull();
    expect(conflict.error).toContain('Referência conflitante');

    const duplicate = buildAttributeStudy([
      measurement({
        id: 'a',
        sample: 'A-1',
        analyst: 'R1',
        category: 'conforme',
        level: 'conforme',
      }),
      measurement({
        id: 'b',
        sample: 'A-1',
        analyst: 'R1',
        category: 'não conforme',
        level: 'conforme',
      }),
    ]);
    expect(duplicate.study).toBeNull();
    expect(duplicate.error).toContain('duplicada');
  });

  it('extrai os limites de kappa dos critérios editáveis', () => {
    const criteria: AcceptanceCriterion[] = [
      {
        id: 'c1',
        parameter: 'intermediate_precision',
        metric: 'kappa_inter',
        operator: '>=',
        limit: 0.8,
        limit2: 0.5,
      },
      {
        id: 'c2',
        parameter: 'accuracy',
        metric: 'reference_coverage',
        operator: '>=',
        limit: 90,
      },
    ];
    const extracted = attributeStudyCriteria(criteria);
    expect(extracted.kappaAccept).toBe(0.8);
    expect(extracted.kappaWarning).toBe(0.5);
    expect(extracted.referenceCoverageMinimum).toBe(90);
  });

  it('analisa concordância de atributo e expõe métricas com critério', () => {
    const analysis = analyzeValidation(
      parameters(['accuracy', 'repeatability', 'intermediate_precision']),
      fixtureMeasurements(),
      [],
      { profileId: 'attribute', confidence: 0.95 },
    );

    expect(analysis.nTotal).toBe(60);
    expect(analysis.nUsed).toBe(60);
    expect(analysis.qc.attribute?.study).not.toBeNull();
    expect(analysis.qc.attribute?.error).toBeNull();
    expect(analysis.parameters).toHaveLength(3);

    const accuracy = analysis.parameters.find(
      (parameter) => parameter.key === 'accuracy',
    );
    const repeatability = analysis.parameters.find(
      (parameter) => parameter.key === 'repeatability',
    );
    const intermediate = analysis.parameters.find(
      (parameter) => parameter.key === 'intermediate_precision',
    );

    expect(accuracy?.metrics.map((metric) => metric.key)).toEqual([
      'kappa_reference',
      'effectiveness',
      'far',
      'frr',
      'reference_coverage',
    ]);
    expect(repeatability?.metrics.map((metric) => metric.key)).toEqual([
      'kappa_intra',
      'po_intra',
    ]);
    expect(intermediate?.metrics.map((metric) => metric.key)).toEqual([
      'kappa_inter',
      'po_inter',
    ]);
    expect(accuracy?.metrics[0].criterionText).toContain('conforme');
    expect(accuracy?.metrics[0].value).not.toBeNull();
    expect(intermediate?.metrics[0].value).not.toBeNull();
    expect(analysis.qc.attribute?.data?.items).toHaveLength(10);
    expect(analysis.qc.attribute?.data?.raters).toHaveLength(3);
  });

  it('mantém parâmetros não avaliados quando a coleta tem duplicidade', () => {
    const data = fixtureMeasurements();
    data.push({ ...data[0], id: 'duplicada', category: 'não conforme' });
    const analysis = analyzeValidation(
      parameters(['accuracy', 'repeatability', 'intermediate_precision']),
      data,
      [],
      { profileId: 'attribute' },
    );

    expect(analysis.qc.attribute?.study).toBeNull();
    expect(analysis.qc.attribute?.error).toContain('duplicada');
    expect(
      analysis.parameters.every(
        (parameter) => parameter.verdict === 'not_evaluated',
      ),
    ).toBe(true);
    expect(
      analysis.warnings.some((warning) => warning.includes('Estudo de atributo')),
    ).toBe(true);
  });

  it('calcula o total de classificações e o plano de atributo', () => {
    expect(
      sampleSizeAttributeAgreement({
        nSamples: 30,
        nAnalysts: 3,
        nReplicates: 3,
      }).total,
    ).toBe(270);

    const plan = buildDesign(
      {
        ...DEFAULT_DESIGN_INPUT,
        designType: 'attribute_agreement',
        nSamples: 30,
        nAnalysts: 3,
        nReplicates: 3,
        nBorderlineSamples: 6,
        levels: ['conforme', 'não conforme'],
      },
      {
        profileId: 'attribute',
        selected: ['accuracy', 'repeatability', 'intermediate_precision'],
      },
    );

    expect(plan.recommended.total).toBe(270);
    expect(plan.runs).toHaveLength(270);
    expect(plan.powerCurve).toEqual([]);
    expect(
      plan.parameterPlans.every((item) => item.method === 'attribute_agreement'),
    ).toBe(true);
    expect(plan.summary).toContain('classificações');
    expect(plan.warnings.some((warning) => warning.includes('30 itens'))).toBe(
      false,
    );
  });

  it('avisa sobre tamanho reduzido do estudo de atributo', () => {
    const plan = buildDesign(
      {
        ...DEFAULT_DESIGN_INPUT,
        designType: 'attribute_agreement',
        nSamples: 10,
        nAnalysts: 2,
        nReplicates: 2,
        nBorderlineSamples: 0,
      },
      { profileId: 'attribute' },
    );
    expect(plan.warnings.some((warning) => warning.includes('30 itens'))).toBe(
      true,
    );
    expect(
      plan.warnings.some((warning) => warning.includes('3 avaliadores')),
    ).toBe(true);
    expect(
      plan.warnings.some((warning) => warning.includes('limítrofe')),
    ).toBe(true);
  });

  it('usa o método de atributo no cálculo por parâmetro', () => {
    const result = planForParameter('accuracy', {
      sigma: 0.5,
      effect: 0.5,
      margin: 0.5,
      confidence: 0.95,
      power: 0.8,
      alpha: 0.05,
      relativeSdError: 0.2,
      varianceRatio: 1.5,
      betweenLabRatio: 1,
      nLevels: 2,
      nReplicates: 3,
      nAnalysts: 3,
      nDays: 1,
      nLabs: 1,
      nSamples: 10,
      designType: 'attribute_agreement',
      profileId: 'attribute',
    });
    expect(result.method).toBe('attribute_agreement');
    expect(result.total).toBe(90);
    expect(result.power).toBeNull();
  });
});
