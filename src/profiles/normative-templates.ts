/**
 * Biblioteca de templates normativos para criação em 1 clique de validações
 * e verificações pré-configuradas segundo referências regulatórias e normas técnicas.
 */

import type {
  DesignType,
  Method,
  MethodFamily,
  MethodType,
  ParamKey,
  ReportConfig,
  Validation,
  ValidationParameter,
  ValidationType,
} from '../lib/types';
import { uid } from '../lib/utils';
import {
  createValidation,
  saveMethod,
  saveParameters,
  updateValidation,
} from '../lib/repository';
import { getProfileForFamily } from './index';

export interface NormativeTemplate {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  family: MethodFamily;
  methodType: MethodType;
  validationType: ValidationType;
  designType: DesignType;
  normativeReference: string;
  description: string;
  recommendedSamplePlan: string;
  selectedParameters: ParamKey[];
  methodDefaults: {
    unit: string;
    toleranceUnit: string;
    measurand: string;
    equipment: string;
    rangeMin: number | null;
    rangeMax: number | null;
    lsl: number | null;
    usl: number | null;
    resolution: number | null;
  };
  reportConfigDefaults: Partial<ReportConfig>;
}

export const NORMATIVE_TEMPLATES: readonly NormativeTemplate[] = [
  {
    id: 'abnt-nbr-13904-sutura',
    code: 'VER-NBR13904-USP881',
    title: 'Fios de Sutura Cirúrgica — Tração sobre o Nó',
    subtitle: 'ABNT NBR 13904 / USP <881> / ISO/IEC 17025 (7.2.1.5)',
    family: 'physical-destructive',
    methodType: 'dimensional',
    validationType: 'verification',
    designType: 'nested_destructive',
    normativeReference: 'ABNT NBR 13904; USP <881>; ISO 5725-2; JCGM 106',
    description:
      'Verificação de desempenho operacional de ensaio físico destrutivo de força de tração sobre o nó em fio de sutura USP 2-0 (máquina universal 100 N, 300 mm/min, garras 125 mm).',
    recommendedSamplePlan: '3 operadores × 5 amostras × 3 corpos de prova (45 ensaios destrutivos) + massas padrão (9 leituras)',
    selectedParameters: [
      'resolution',
      'bias',
      'stability',
      'repeatability',
      'reproducibility',
      'uncertainty',
      'conformity',
    ],
    methodDefaults: {
      unit: 'N',
      toleranceUnit: 'N',
      measurand: 'Força de ruptura à tração sobre o nó cirúrgico',
      equipment: 'Máquina Universal de Ensaios (célula 100 N)',
      rangeMin: 5,
      rangeMax: 80,
      lsl: 16.5,
      usl: null,
      resolution: 0.01,
    },
    reportConfigDefaults: {
      conformityRule: 'guard_band',
      guardBandFactor: 1,
      probabilityThreshold: 0.95,
      individualLsl: 13.4,
    },
  },
  {
    id: 'ich-q2-r2-hplc',
    code: 'VAL-ICH-Q2R2-HPLC',
    title: 'Doseamento Cromatográfico Quantitativo (HPLC / GC)',
    subtitle: 'ICH Q2(R2) / ANVISA RDC 166/2017',
    family: 'analytical',
    methodType: 'quantitative',
    validationType: 'full',
    designType: 'crossed',
    normativeReference: 'ICH Q2(R2) (2023); ANVISA RDC 166/2017; Eurachem (2014)',
    description:
      'Validação completa de método cromatográfico quantitativo cobrindo seletividade, linearidade ponderada/OLS, faixa de trabalho, LoD/LoQ, repetibilidade, precisão intermediária, exatidão e incerteza.',
    recommendedSamplePlan: '3 níveis (80–120%) × 2 analistas × 3 dias × 3 réplicas + curva analítica em 5–6 concentrações',
    selectedParameters: [
      'selectivity',
      'linearity',
      'working_range',
      'lod_loq',
      'repeatability',
      'intermediate_precision',
      'accuracy',
      'robustness',
      'uncertainty',
    ],
    methodDefaults: {
      unit: '%',
      toleranceUnit: '%',
      measurand: 'Teor de princípio ativo (recuperação / concentração)',
      equipment: 'Cromatógrafo Líquido HPLC-DAD',
      rangeMin: 80,
      rangeMax: 120,
      lsl: 98,
      usl: 102,
      resolution: 0.01,
    },
    reportConfigDefaults: {
      conformityRule: 'guard_band',
      guardBandFactor: 1,
    },
  },
  {
    id: 'iso-5725-2-interlab',
    code: 'VAL-ISO5725-2-COLLAB',
    title: 'Estudo Colaborativo e Precisão Interlaboratorial',
    subtitle: 'ABNT NBR ISO 5725-2:2019 (Mandel h/k, Cochran & Grubbs)',
    family: 'analytical',
    methodType: 'quantitative',
    validationType: 'full',
    designType: 'iso5725',
    normativeReference: 'ISO 5725-2:2019; AOAC Appendix F',
    description:
      'Estudo colaborativo multilaboratorial com triagem de consistência e dispersão pelos testes de Mandel h e k, Cochran e Grubbs, fornecendo repetibilidade (r) e reprodutibilidade (R).',
    recommendedSamplePlan: '≥ 8 laboratórios × 5 níveis de matriz × 2–3 réplicas por célula',
    selectedParameters: [
      'repeatability',
      'intermediate_precision',
      'reproducibility',
      'accuracy',
      'uncertainty',
    ],
    methodDefaults: {
      unit: 'mg/L',
      toleranceUnit: 'mg/L',
      measurand: 'Concentração do analito em estudo colaborativo',
      equipment: 'Protocolo multi-equipamento (redes de ensaio)',
      rangeMin: 1,
      rangeMax: 100,
      lsl: null,
      usl: null,
      resolution: 0.001,
    },
    reportConfigDefaults: {
      conformityRule: 'simple_acceptance',
    },
  },
  {
    id: 'aiag-msa-gage-rr',
    code: 'MSA-AIAG-VDA5-DIM',
    title: 'Sistema de Medição Dimensional (Gage R&R Cruzado + Cg/Cgk + VDA 5)',
    subtitle: 'AIAG MSA 4ª ed. / VDA Volume 5 / ISO 22514-7',
    family: 'dimensional',
    methodType: 'dimensional',
    validationType: 'full',
    designType: 'gage_rr',
    normativeReference: 'AIAG MSA 4th ed. (2010); VDA 5 (2021); Wheeler EMP III',
    description:
      'Qualificação de paquímetro, micrômetro, MMC ou calibrador com ANOVA Gage R&R cruzado, classificação EMP de Wheeler, capabilidade Tipo 1 (Cg/Cgk) e razão de incerteza Q_MS / Q_MP.',
    recommendedSamplePlan: '10 peças representativas × 3 operadores × 3 réplicas + 25–50 leituras em padrão Tipo 1',
    selectedParameters: [
      'resolution',
      'repeatability',
      'reproducibility',
      'bias',
      'linearity',
      'stability',
      'uncertainty',
      'conformity',
    ],
    methodDefaults: {
      unit: 'mm',
      toleranceUnit: 'mm',
      measurand: 'Cota dimensional crítica (T = USL − LSL)',
      equipment: 'Micrômetro digital / Máquina de Medição por Coordenadas',
      rangeMin: 0,
      rangeMax: 25,
      lsl: 9.95,
      usl: 10.05,
      resolution: 0.001,
    },
    reportConfigDefaults: {
      conformityRule: 'guard_band',
      guardBandFactor: 1,
    },
  },
  {
    id: 'clsi-ep17-lod',
    code: 'VAL-CLSI-EP17-LOD',
    title: 'Limites de Detecção e Quantificação (LoB / LoD / LoQ)',
    subtitle: 'CLSI EP17-A2 / Probit (EP05 / EP17)',
    family: 'analytical',
    methodType: 'quantitative',
    validationType: 'partial',
    designType: 'crd',
    normativeReference: 'CLSI EP17-A2; ICH Q2(R2)',
    description:
      'Estabelecimento rigoroso de Limite de Branco (LoB), Limite de Detecção (LoD) não paramétrico/paramétrico e Limite de Quantificação (LoQ) com brancos e amostras em baixos teores.',
    recommendedSamplePlan: '≥ 20 brancos + ≥ 4 níveis de baixa concentração em duplicata/triplicata ao longo de 3 dias',
    selectedParameters: ['lod_loq', 'linearity', 'repeatability', 'accuracy'],
    methodDefaults: {
      unit: 'µg/L',
      toleranceUnit: 'µg/L',
      measurand: 'Concentração traço próxima ao limite de detecção',
      equipment: 'LC-MS/MS ou ICP-MS',
      rangeMin: 0.05,
      rangeMax: 50,
      lsl: null,
      usl: 50,
      resolution: 0.001,
    },
    reportConfigDefaults: {
      conformityRule: 'simple_acceptance',
    },
  },
  {
    id: 'attribute-kappa-aiag',
    code: 'MSA-ATRIB-KAPPA',
    title: 'Inspeção Visual e Concordância de Atributos (Kappa)',
    subtitle: 'AIAG MSA Atributos / Fleiss Kappa & Sinal-Detecção',
    family: 'attribute',
    methodType: 'qualitative',
    validationType: 'full',
    designType: 'attribute_agreement',
    normativeReference: 'AIAG MSA 4th ed. ch. IV; Fleiss (1971); ISO 17025',
    description:
      'Estudo de eficácia e concordância entre inspetores (vs. padrão ouro, intra e interavaliador) para ensaios passa/não-passa com amostras conformes, não conformes e limítrofes.',
    recommendedSamplePlan: '30–50 peças (incl. zona limítrofe) × 3 avaliadores × 2–3 rodadas cegas',
    selectedParameters: ['selectivity', 'repeatability', 'reproducibility', 'accuracy'],
    methodDefaults: {
      unit: 'Passa/Falha',
      toleranceUnit: '',
      measurand: 'Classificação visual / atributiva de conformidade',
      equipment: 'Cabine de inspeção / gabarito passa-não-passa',
      rangeMin: null,
      rangeMax: null,
      lsl: null,
      usl: null,
      resolution: null,
    },
    reportConfigDefaults: {
      conformityRule: 'simple_acceptance',
    },
  },
];

/**
 * Instancia no banco local um novo método e validação pré-configurados a partir
 * de um template normativo em 1 clique.
 */
export function applyNormativeTemplate(
  templateId: string,
  actor = 'usuario',
): { method: Method; validation: Validation } {
  const template = NORMATIVE_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Template normativo não encontrado: ${templateId}`);
  }
  const timestamp = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const profile = getProfileForFamily(template.family);

  const method: Method = {
    id: uid('met'),
    code: `${template.code}-${suffix}`,
    name: template.title,
    type: template.methodType,
    family: template.family,
    unit: template.methodDefaults.unit,
    rangeMin: template.methodDefaults.rangeMin,
    rangeMax: template.methodDefaults.rangeMax,
    lsl: template.methodDefaults.lsl,
    usl: template.methodDefaults.usl,
    resolution: template.methodDefaults.resolution,
    measurand: template.methodDefaults.measurand,
    toleranceUnit: template.methodDefaults.toleranceUnit,
    equipment: template.methodDefaults.equipment,
    referenceNorm: template.normativeReference,
    validationType: template.validationType,
    description: `${template.description} Plano recomendado: ${template.recommendedSamplePlan}.`,
    criteria: [...profile.defaultMethodCriteria],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveMethod(method, actor);

  const created = createValidation(method.id, `${template.title}`, actor);
  const validation = updateValidation(
    {
      ...created,
      objective: `${template.description} (${template.normativeReference}).`,
      scope: `Plano amostral recomendado: ${template.recommendedSamplePlan}.`,
      reportConfig: {
        ...created.reportConfig,
        ...template.reportConfigDefaults,
      },
    },
    actor,
    `Template normativo ${template.id}`,
  );

  const selectedSet = new Set(template.selectedParameters);
  const parameters: ValidationParameter[] = profile.parameters.map((definition) => ({
    validationId: validation.id,
    key: definition.key,
    selected: selectedSet.has(definition.key),
    justification: definition.defaultJustification ?? '',
    criteria: [],
  }));
  saveParameters(validation.id, parameters, actor, `Parâmetros do template ${template.id}`);

  return { method, validation };
}
