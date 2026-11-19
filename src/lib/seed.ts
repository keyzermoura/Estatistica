/**
 * Dados de demonstração: um método quantitativo completo, pronto para ser
 * explorado. Criado apenas quando o banco está vazio.
 */

import type { Measurement, Method, ParamKey, UncertaintyItem, ValidationParameter } from './types';
import { DEFAULT_DESIGN_INPUT } from './types';
import {
  createValidation,
  listMethods,
  listValidations,
  loadSettings,
  replaceMeasurements,
  replaceUncertainty,
  saveDesign,
  saveMethod,
  saveParameters,
  saveSettings,
  setValidationStep,
  updateValidation,
} from './repository';
import { DEFAULT_PROFILE_ID, getProfile } from '../profiles/index';
import { DIMENSIONAL_PROFILE } from '../profiles/dimensional';
import { PHYSICAL_DESTRUCTIVE_PROFILE } from '../profiles/physical-destructive';
import { buildDesign } from '../stats/design';
import { describe } from '../stats/descriptive';
import { mulberry32 } from '../stats/distributions';
import { dimensionalUncertaintyBudget } from '../stats/parameters/dimensional';
import { nowIso, uid } from './utils';

const DEMO_METHOD_ID = 'method_demo_caffeine';

const DEMO_METHOD: Method = {
  id: DEMO_METHOD_ID,
  code: 'HPLC-CAF-01',
  name: 'Cafeína em bebidas por HPLC-UV',
  type: 'quantitative',
  family: 'analytical',
  unit: 'mg/L',
  rangeMin: 5,
  rangeMax: 25,
  lsl: null,
  usl: null,
  resolution: null,
  measurand: 'Concentração de cafeína',
  toleranceUnit: 'mg/L',
  equipment: 'HPLC Agilent 1260, coluna C18 150 × 4,6 mm, 5 µm',
  referenceNorm: 'ICH Q2(R2); ISO/IEC 17025:2017',
  validationType: 'full',
  description:
    'Determinação quantitativa de cafeína em bebidas não alcoólicas por cromatografia líquida de alta eficiência com detecção UV a 275 nm.',
  criteria: [
    {
      id: 'crit-lin-r2',
      parameter: 'linearity',
      metric: 'r2',
      operator: '>=',
      limit: 0.995,
      note: 'Linearidade mínima para a faixa de trabalho.',
    },
    {
      id: 'crit-acc-rec',
      parameter: 'accuracy',
      metric: 'recovery',
      operator: 'between',
      limit: 98,
      limit2: 102,
      unit: '%',
      note: 'Recuperação média aceitável.',
    },
    {
      id: 'crit-rep-cv',
      parameter: 'repeatability',
      metric: 'cv',
      operator: '<=',
      limit: 5,
      unit: '%',
      note: 'Repetibilidade máxima.',
    },
    {
      id: 'crit-ip-cv',
      parameter: 'intermediate_precision',
      metric: 'cv',
      operator: '<=',
      limit: 8,
      unit: '%',
      note: 'Precisão intermediária máxima.',
    },
    {
      id: 'crit-unc-rel',
      parameter: 'uncertainty',
      metric: 'relativeExpanded',
      operator: '<=',
      limit: 5,
      unit: '%',
      note: 'Incerteza expandida relativa máxima.',
    },
  ],
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

function demoMeasurements(validationId: string): Measurement[] {
  const levels = [5, 10, 15, 20, 25];
  const analysts = ['Ana', 'Bruno'];
  const rand = mulberry32(20261031);
  const out: Measurement[] = [];
  let order = 0;
  for (const level of levels) {
    for (const analyst of analysts) {
      for (let rep = 1; rep <= 2; rep++) {
        order += 1;
        const analystBias = analyst === 'Ana' ? 0.015 : -0.012;
        const noise = (rand() - 0.5) * 0.12 * level;
        const value = level * (1 + analystBias) + noise;
        out.push({
          id: uid('m'),
          validationId,
          runOrder: order,
          level: String(level),
          analyst,
          day: rep === 1 ? 'D1' : 'D2',
          equipment: 'HPLC-1',
          lot: 'L-2026-01',
          sample: `S${level}-${analyst}-${rep}`,
          replicate: rep,
          value: Math.round(value * 1000) / 1000,
          referenceValue: level,
          textValue: '',
          notes: '',
        });
      }
    }
  }
  return out;
}

export const DEMO_SUTURE_METHOD_ID = 'method_demo_suture_nbr13904';

const DEMO_SUTURE_METHOD: Method = {
  id: DEMO_SUTURE_METHOD_ID,
  code: 'SUT-TRA-13904',
  name: 'Força de tração sobre o nó em fios de sutura cirúrgica (USP 2-0)',
  type: 'quantitative',
  family: 'physical-destructive',
  unit: 'N',
  rangeMin: 5,
  rangeMax: 100,
  lsl: 26.8,
  usl: null,
  resolution: 0.01,
  measurand: 'Força máxima de ruptura em tração sobre nó simples (N)',
  toleranceUnit: 'N',
  equipment:
    'Máquina universal de ensaios (célula de carga 100 N classe 0,5 ISO 7500-1; velocidade 300 mm/min; distância entre garras 125 mm)',
  referenceNorm:
    'ABNT NBR 13904; USP <881> Tensile Strength; ABNT NBR ISO/IEC 17025:2017 (item 7.2.1.5)',
  validationType: 'verification',
  description:
    'Verificação de método normalizado para determinação da resistência à tração sobre o nó simples em fio de sutura sintético absorvível calibre USP 2-0 (métrico 3,0) conforme ABNT NBR 13904 e USP <881>. Especificação estritamente unilateral inferior: média mínima do lote = 26,8 N (LSL) e limite mínimo individual por corpo de prova = 13,4 N.',
  criteria: PHYSICAL_DESTRUCTIVE_PROFILE.defaultMethodCriteria.map((criterion) => ({
    ...criterion,
  })),
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

function ensureDefaultLabSettings(): void {
  const settings = loadSettings();
  if (!settings.laboratoryName) {
    saveSettings({
      ...settings,
      laboratoryName: 'Laboratório de Ensaios Físicos e Químicos',
      laboratoryAddress: 'Av. Central, 100 — Bloco B',
      accreditation: 'Acreditação de ensaio (demo)',
      responsible: 'Dra. Marina Costa',
      reviewer: 'Dr. Paulo Alves',
      approver: 'Dra. Helena Ribeiro',
    });
  }
}

function sutureVerificationMeasurements(validationId: string): Measurement[] {
  const operators = [
    { name: 'Juliana', bias: -0.04 },
    { name: 'Marcos', bias: 0.0 },
    { name: 'Renata', bias: 0.05 },
  ];
  const sampleMeans = [34.2, 36.4, 38.5, 40.3, 42.1];
  const repOffsets = [-0.18, 0.04, 0.14];
  const out: Measurement[] = [];
  let order = 0;

  // 45 ensaios destrutivos: 3 operadores × 5 amostras × 3 corpos de prova únicos
  for (const [opIdx, op] of operators.entries()) {
    for (const [sampleIdx, sampleMean] of sampleMeans.entries()) {
      for (let rep = 1; rep <= 3; rep++) {
        order += 1;
        const fineJitter = ((opIdx + sampleIdx + rep) % 3 - 1) * 0.02;
        const value = sampleMean + op.bias + repOffsets[rep - 1] + fineJitter;
        out.push({
          id: uid('m'),
          validationId,
          runOrder: order,
          level: 'USP 2-0',
          analyst: op.name,
          day: `D${rep}`,
          equipment: 'MUE-100N',
          lot: 'SUT-2026-04',
          sample: `${op.name.slice(0, 3).toUpperCase()}-Bob-${sampleIdx + 1}`,
          partId: '',
          specimen: `CP-${String(order).padStart(3, '0')}`,
          destructive: true,
          condition: {
            temperature: 21.0,
            humidity: 50,
            testSpeed: 300,
            other: 'Distância entre garras 125 mm · nó simples',
          },
          refValue: null,
          refUncertainty: null,
          category: '',
          replicate: rep,
          value: Math.round(value * 100) / 100,
          referenceValue: null,
          textValue: '',
          notes: 'Ensaio destrutivo de tração sobre o nó (ABNT NBR 13904 / USP <881>)',
        });
      }
    }
  }

  // 9 medições não destrutivas com massas padrão na célula de carga (tendência e estabilidade)
  const referenceWeights = [20, 35, 50];
  for (const ref of referenceWeights) {
    for (let rep = 1; rep <= 3; rep++) {
      order += 1;
      const offset = (rep - 2) * 0.02;
      out.push({
        id: uid('m'),
        validationId,
        runOrder: order,
        level: `${ref} N`,
        analyst: 'Juliana',
        day: `D${rep}`,
        equipment: 'MUE-100N',
        lot: 'PAD-MASSA-01',
        sample: `Padrao-${ref}N`,
        partId: '',
        specimen: '',
        destructive: false,
        condition: {
          temperature: 21.0,
          humidity: 50,
          testSpeed: null,
          other: 'Verificação metrológica da célula de carga 100 N',
        },
        refValue: ref,
        refUncertainty: 0.05,
        category: '',
        replicate: rep,
        value: Math.round((ref + offset) * 100) / 100,
        referenceValue: ref,
        textValue: '',
        notes: 'Massa padrão calibrada (não destrutivo)',
      });
    }
  }

  return out;
}

/**
 * Cria (de forma idempotente) um exemplo completo de verificação de força de
 * tração sobre o nó em fios de sutura cirúrgica conforme ABNT NBR 13904 e USP <881>.
 */
export function seedSutureVerification(): string {
  const existing = listValidations().find(
    (item) => item.methodId === DEMO_SUTURE_METHOD_ID,
  );
  if (existing) return existing.id;

  ensureDefaultLabSettings();
  const method = saveMethod(DEMO_SUTURE_METHOD, 'seed');
  const created = createValidation(
    method.id,
    'Verificação ABNT NBR 13904 / USP <881> — Sutura Sintética USP 2-0',
    'seed',
  );
  const validation = updateValidation(
    {
      ...created,
      status: 'in_progress',
      reportConfig: {
        ...created.reportConfig,
        conformityRule: 'guard_band',
        guardBandFactor: 1,
        probabilityThreshold: 0.95,
        individualLsl: 13.4,
      },
      objective:
        'Verificar o desempenho operacional do ensaio de força de tração sobre o nó simples em fio de sutura cirúrgica USP 2-0 conforme ABNT NBR 13904, USP <881> e ABNT NBR ISO/IEC 17025:2017 (item 7.2.1.5).',
      scope:
        'Ensaio físico destrutivo em máquina universal de ensaios (100 N, 300 mm/min, distância entre garras de 125 mm) cobrindo resolução, tendência e estabilidade da célula de carga, precisão aninhada (operador > amostra > corpo de prova), incerteza GUM e decisão de conformidade.',
    },
    'seed',
    'Exemplo ABNT NBR 13904 / USP <881>',
  );

  const selected = new Set<ParamKey>([
    'resolution',
    'bias',
    'stability',
    'repeatability',
    'reproducibility',
    'uncertainty',
    'conformity',
  ]);
  const parameters: ValidationParameter[] = PHYSICAL_DESTRUCTIVE_PROFILE.parameters.map(
    (definition) => ({
      validationId: validation.id,
      key: definition.key,
      selected: selected.has(definition.key),
      justification: definition.defaultJustification ?? '',
      criteria: [],
    }),
  );
  saveParameters(validation.id, parameters, 'seed', 'Parâmetros de verificação de sutura');

  const designInput = {
    ...DEFAULT_DESIGN_INPUT,
    designType: 'nested_destructive' as const,
    sigma: 0.25,
    effect: 1.0,
    margin: 1.0,
    confidence: 0.95,
    power: 0.8,
    nLevels: 3,
    nAnalysts: 3,
    nSamples: 5,
    nDays: 3,
    nEquipments: 1,
    nReplicates: 3,
    nLabs: 1,
    levels: ['20', '35', '50'],
    factors: ['operador', 'amostra(operador)'],
    seed: 13904,
    notes:
      'Estudo aninhado destrutivo (3 operadores × 5 amostras/operador × 3 corpos de prova = 45 ensaios destrutivos) + 9 verificações metrológicas não destrutivas da célula de carga.',
  };
  const plan = buildDesign(designInput, {
    selected: [...selected],
    profileId: PHYSICAL_DESTRUCTIVE_PROFILE.id,
  });
  saveDesign(
    {
      id: uid('design'),
      validationId: validation.id,
      input: designInput,
      plan,
      seed: designInput.seed,
      createdAt: nowIso(),
    },
    'seed',
    'Delineamento aninhado destrutivo ABNT NBR 13904',
  );

  const measurements = sutureVerificationMeasurements(validation.id);
  replaceMeasurements(
    validation.id,
    measurements,
    'seed',
    'Carga de dados ABNT NBR 13904 / USP <881>',
  );

  const uncertainty: UncertaintyItem[] = [
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Repetibilidade entre corpos de prova (Tipo A)',
      type: 'A',
      distribution: 'normal',
      value: 0.18,
      divisor: 1,
      sensitivity: 1,
      stdUncertainty: 0.18,
      dof: 30,
      notes: 'Desvio-padrão combinado da repetibilidade no estudo aninhado destrutivo.',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Calibração da célula de carga 100 N (ISO 7500-1 classe 0,5)',
      type: 'B',
      distribution: 'normal',
      value: 0.25,
      divisor: 2,
      sensitivity: 1,
      stdUncertainty: 0.125,
      dof: 30,
      notes: 'Incerteza expandida do certificado de calibração (U = 0,25 N, k = 2).',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Resolução do indicador digital (0,01 N)',
      type: 'B',
      distribution: 'rectangular',
      value: 0.005,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.005 / Math.sqrt(3),
      dof: null,
      notes: 'Meia resolução d/2 = 0,005 N com distribuição retangular.',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Fixação nas garras e velocidade de ensaio (300 mm/min)',
      type: 'B',
      distribution: 'rectangular',
      value: 0.2,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.2 / Math.sqrt(3),
      dof: 15,
      notes: 'Semi-amplitude operacional estimada para alinhamento do nó nas garras.',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Deriva e variação ambiental (21 ± 2 °C; 50 % UR)',
      type: 'B',
      distribution: 'rectangular',
      value: 0.1,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.1 / Math.sqrt(3),
      dof: 15,
      notes: 'Estabilidade da célula de carga entre calibrações.',
    },
  ];
  replaceUncertainty(validation.id, uncertainty, 'seed');
  setValidationStep(validation.id, 4, 'seed');
  return validation.id;
}

export async function seedIfEmpty(): Promise<boolean> {
  const existing = listMethods();
  if (existing.length > 0) return false;
  const profile = getProfile(DEFAULT_PROFILE_ID);

  ensureDefaultLabSettings();

  const method = saveMethod(DEMO_METHOD);
  const validation = createValidation(method.id, 'Validação HPLC-CAF-01 — 2026', 'Especialista em Validação');
  const selectedKeys = profile.parameters
    .filter((parameter) => parameter.defaultSelected)
    .map((parameter) => parameter.key);
  const parameters: ValidationParameter[] = profile.parameters.map((definition) => ({
    validationId: validation.id,
    key: definition.key,
    selected: Boolean(definition.defaultSelected),
    justification: definition.defaultJustification ?? '',
    // Critérios globais ficam no método; a validação só guarda substituições.
    criteria: [],
  }));
  saveParameters(validation.id, parameters);

  const designInput = {
    ...DEFAULT_DESIGN_INPUT,
    designType: 'crossed' as const,
    sigma: 0.35,
    effect: 0.5,
    margin: 0.4,
    confidence: 0.95,
    power: 0.8,
    nLevels: 5,
    nAnalysts: 2,
    nDays: 2,
    nEquipments: 1,
    nReplicates: 2,
    nLabs: 1,
    levels: ['5', '10', '15', '20', '25'],
    factors: ['analista', 'dia'],
    seed: 20261031,
    notes: 'Desenho cruzado analista × dia, 2 réplicas por combinação.',
  };
  const plan = buildDesign(designInput, {
    selected: selectedKeys.filter((key) => key !== 'selectivity'),
  });
  saveDesign({
    id: uid('design'),
    validationId: validation.id,
    input: designInput,
    plan,
    seed: designInput.seed,
    createdAt: nowIso(),
  });

  const measurements = demoMeasurements(validation.id);
  replaceMeasurements(validation.id, measurements, 'seed', 'Carga de dados de demonstração');

  const values = measurements.map((m) => m.value!).filter(Number.isFinite);
  const stats = describe(values);
  const residualSd = stats.sd ?? 0.1;
  const uncertainty: UncertaintyItem[] = [
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Repetibilidade (Tipo A)',
      type: 'A',
      distribution: 'normal',
      value: residualSd / Math.sqrt(values.length),
      divisor: 1,
      sensitivity: 1,
      stdUncertainty: residualSd / Math.sqrt(values.length),
      dof: values.length - 1,
      notes: `s = ${residualSd.toPrecision(4)}; n = ${values.length}`,
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Calibração da balança/volumétrico',
      type: 'B',
      distribution: 'rectangular',
      value: 0.06,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.06 / Math.sqrt(3),
      dof: 10,
      notes: 'Certificado de calibração; semi-amplitude 0,06 mg/L.',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Pureza do padrão',
      type: 'B',
      distribution: 'normal',
      value: 0.08,
      divisor: 2,
      sensitivity: 1,
      stdUncertainty: 0.04,
      dof: 30,
      notes: 'Incerteza expandida 0,08 mg/L (k = 2).',
    },
    {
      id: uid('u'),
      validationId: validation.id,
      source: 'Tendência residual',
      type: 'B',
      distribution: 'rectangular',
      value: 0.02,
      divisor: Math.sqrt(3),
      sensitivity: 1,
      stdUncertainty: 0.02 / Math.sqrt(3),
      dof: 8,
  notes: 'Diferença média observada entre medido e referência.',
    },
  ];
  replaceUncertainty(validation.id, uncertainty, 'seed');

  // Ajusta o passo atual para a etapa de análise.
  setValidationStep(validation.id, 4, 'seed');
  seedSutureVerification();
  seedDimensionalDemo();
  return true;
}

export const DEMO_DIMENSIONAL_METHOD_ID = 'method_demo_micrometer_dim';

/**
 * Cria (de forma idempotente) um exemplo completo da família dimensional:
 * micrômetro externo digital 0–25 mm com Gage R&R cruzado (10 peças ×
 * 3 operadores × 3 réplicas), estudo de tendência/linearidade com blocos-padrão,
 * controle de estabilidade temporal e orçamento metrológico GUM.
 */
export function seedDimensionalDemo(): string {
  const existing = listValidations().find(
    (item) => item.methodId === DEMO_DIMENSIONAL_METHOD_ID,
  );
  if (existing) return existing.id;

  const profile = DIMENSIONAL_PROFILE;
  const now = nowIso();
  const dimMethod: Method = {
    id: DEMO_DIMENSIONAL_METHOD_ID,
    code: 'DIM-MIC-025',
    name: 'Diâmetro externo de eixo retificado por micrômetro digital 0–25 mm',
    type: 'dimensional',
    family: 'dimensional',
    unit: 'mm',
    rangeMin: 0,
    rangeMax: 25,
    lsl: 9.95,
    usl: 10.05,
    resolution: 0.001,
    measurand: 'Diâmetro externo nominal de 10,000 mm',
    toleranceUnit: 'mm',
    equipment: 'Micrômetro externo digital 0–25 mm (resolução 0,001 mm, catraca constante)',
    referenceNorm: 'AIAG MSA 4ª ed.; ISO 22514-7:2021; ISO 14253-1:2017; JCGM 100:2008; ILAC-G8:09/2019',
    validationType: 'full',
    description:
      'Estudo metrológico completo de medição dimensional em eixo retificado (tolerância bilateral 9,950 a 10,050 mm; T = 0,100 mm).',
    criteria: profile.defaultMethodCriteria,
    createdAt: now,
    updatedAt: now,
  };
  saveMethod(dimMethod, 'seed');

  const validation = createValidation(
    dimMethod.id,
    'Validação Dimensional — Micrômetro Digital 0–25 mm (Eixo 10 mm)',
    'seed',
  );

  updateValidation(
    {
      ...validation,
      status: 'in_progress',
      objective:
        'Demonstrar adequação metrológica (resolução, tendência, linearidade, estabilidade, Gage R&R cruzado, incerteza GUM e regra de decisão por banda de guarda) para controle dimensional de diâmetro externo.',
      scope: 'Faixa nominal de trabalho 9,950 a 10,050 mm com tolerância bilateral T = 0,100 mm.',
      responsible: 'Lucas Andrade (Metrologia)',
      reviewer: 'Helena Duarte (Qualidade)',
      approver: 'Paulo Menezes (Direção Técnica)',
      reportConfig: {
        ...validation.reportConfig,
        reportTitle: `Relatório de Validação Dimensional — ${dimMethod.name}`,
        conformityRule: 'guard_band',
        guardBandFactor: 1,
        probabilityThreshold: 0.95,
        processVariation: null,
      },
    },
    'seed',
    'Exemplo dimensional inicial',
  );

  const selectedKeys = new Set(profile.suggestedParameters(dimMethod.type, dimMethod.validationType));
  const params: ValidationParameter[] = profile.parameters.map((param) => ({
    validationId: validation.id,
    key: param.key,
    selected: selectedKeys.has(param.key),
    justification: param.defaultJustification ?? '',
    criteria: profile.defaultCriteria[param.key] ?? [],
  }));
  saveParameters(validation.id, params, 'seed', 'Parâmetros do perfil dimensional');

  const designInput = {
    ...DEFAULT_DESIGN_INPUT,
    designType: 'gage_rr' as const,
    confidence: profile.defaultAssumptions.confidence,
    power: profile.defaultAssumptions.power,
    alpha: profile.defaultAssumptions.alpha,
    sigma: 0.001,
    effect: 0.005,
    margin: 0.005,
    nSamples: 10,
    nAnalysts: 3,
    nReplicates: 3,
    nLevels: 5,
    nDays: 5,
    levels: ['9.950', '9.975', '10.000', '10.025', '10.050'],
    factors: ['peça', 'operador', 'réplica'],
    seed: 20261114,
  };
  const plan = buildDesign(designInput, { selected: Array.from(selectedKeys), profileId: 'dimensional' });
  saveDesign(
    {
      id: uid('design'),
      validationId: validation.id,
      input: designInput,
      plan,
      seed: designInput.seed,
      createdAt: nowIso(),
    },
    'seed',
    'Delineamento Gage R&R cruzado 10 × 3 × 3',
  );

  const rand = mulberry32(20261114);
  const gauss = () => {
    const u1 = Math.max(1e-9, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const measurements: Measurement[] = [];
  let runOrder = 1;

  // 1) Gage R&R cruzado: 10 peças × 3 operadores × 3 réplicas = 90 medições
  const partMeans = [
    9.964, 9.972, 9.980, 9.988, 9.996, 10.004, 10.012, 10.020, 10.028, 10.036,
  ];
  const operators = [
    { name: 'Ana', bias: 0.0 },
    { name: 'Bruno', bias: 0.0002 },
    { name: 'Carla', bias: -0.0002 },
  ];
  for (let r = 1; r <= 3; r++) {
    for (let pIdx = 0; pIdx < partMeans.length; pIdx++) {
      const partId = `P${String(pIdx + 1).padStart(2, '0')}`;
      for (const op of operators) {
        const rawVal = partMeans[pIdx] + op.bias + gauss() * 0.0007;
        measurements.push({
          id: uid('m'),
          validationId: validation.id,
          runOrder: runOrder++,
          level: 'Gage R&R',
          analyst: op.name,
          day: 'D1',
          equipment: 'Micrômetro 0-25 mm #01',
          lot: 'LOTE-EIXO-01',
          sample: partId,
          partId,
          specimen: '',
          destructive: false,
          condition: {
            temperature: Number((20 + gauss() * 0.15).toFixed(2)),
            humidity: Number((50 + gauss() * 1.2).toFixed(1)),
            testSpeed: null,
            other: '',
          },
          refValue: null,
          refUncertainty: null,
          category: '',
          replicate: r,
          value: Number(rawVal.toFixed(4)),
          referenceValue: null,
          textValue: '',
          notes: 'Estudo Gage R&R cruzado (10 × 3 × 3)',
        });
      }
    }
  }

  // 2) Tendência e linearidade com 5 blocos-padrão calibrados (5 réplicas cada)
  const blocks = [
    { label: '9.950', ref: 9.95, uRef: 0.00015 },
    { label: '9.975', ref: 9.975, uRef: 0.00015 },
    { label: '10.000', ref: 10.0, uRef: 0.00015 },
    { label: '10.025', ref: 10.025, uRef: 0.00015 },
    { label: '10.050', ref: 10.05, uRef: 0.00015 },
  ];
  for (const blk of blocks) {
    const partId = `BP-${blk.label}`;
    for (let rep = 1; rep <= 5; rep++) {
      const val = blk.ref + 0.0002 + gauss() * 0.0006;
      measurements.push({
        id: uid('m'),
        validationId: validation.id,
        runOrder: runOrder++,
        level: blk.label,
        analyst: 'Ana',
        day: 'D1',
        equipment: 'Micrômetro 0-25 mm #01',
        lot: 'JOGO-BP-01',
        sample: partId,
        partId,
        specimen: '',
        destructive: false,
        condition: { temperature: 20.0, humidity: 50.0, testSpeed: null, other: '' },
        refValue: blk.ref,
        refUncertainty: blk.uRef,
        category: '',
        replicate: rep,
        value: Number(val.toFixed(4)),
        referenceValue: blk.ref,
        textValue: '',
        notes: 'Bloco-padrão calibrado para tendência/linearidade',
      });
    }
  }

  // 3) Estabilidade temporal ao longo de 5 dias com padrão de controle 10,000 mm
  const stabilityDays = ['D2', 'D3', 'D4', 'D5', 'D6'];
  for (const day of stabilityDays) {
    for (let rep = 1; rep <= 3; rep++) {
      const val = 10.0 + gauss() * 0.0005;
      measurements.push({
        id: uid('m'),
        validationId: validation.id,
        runOrder: runOrder++,
        level: 'Estabilidade 10.000',
        analyst: 'Ana',
        day,
        equipment: 'Micrômetro 0-25 mm #01',
        lot: 'BP-CONTROLE',
        sample: 'BP-10.000',
        partId: 'BP-10.000',
        specimen: '',
        destructive: false,
        condition: { temperature: 20.0, humidity: 50.0, testSpeed: null, other: '' },
        refValue: 10.0,
        refUncertainty: 0.00015,
        category: '',
        replicate: rep,
        value: Number(val.toFixed(4)),
        referenceValue: 10.0,
        textValue: '',
        notes: 'Padrão de verificação para estabilidade temporal',
      });
    }
  }

  replaceMeasurements(
    validation.id,
    measurements,
    'seed',
    'Conjunto dimensional de demonstração (Gage R&R + blocos-padrão + estabilidade)',
  );

  const budget = dimensionalUncertaintyBudget({
    validationId: validation.id,
    resolution: 0.001,
    calibrationUncertainty: 0.0008,
    coverageFactor: 2,
    temperature: {
      length: 10,
      coefficient: 11.5e-6,
      deltaT: 1.0,
    },
    repeatabilitySd: 0.0007,
    nReplicates: 3,
    reproducibilitySd: 0.0003,
    referenceUncertainty: 0.00015,
    flatness: 0.0003,
    parallelism: 0.0003,
  });
  replaceUncertainty(validation.id, budget, 'seed');
  setValidationStep(validation.id, 4, 'seed');
  return validation.id;
}

export const DEMO = {
  methodId: DEMO_METHOD_ID,
  methodCode: DEMO_METHOD.code,
  methodName: DEMO_METHOD.name,
  dimensionalMethodId: DEMO_DIMENSIONAL_METHOD_ID,
};
