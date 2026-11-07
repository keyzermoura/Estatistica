/**
 * Dados de demonstração: um método quantitativo completo, pronto para ser
 * explorado. Criado apenas quando o banco está vazio.
 */

import type { Measurement, Method, UncertaintyItem, ValidationParameter } from './types';
import { DEFAULT_DESIGN_INPUT } from './types';
import {
  createValidation,
  listMethods,
  loadSettings,
  replaceMeasurements,
  replaceUncertainty,
  saveDesign,
  saveMethod,
  saveParameters,
  saveSettings,
  setValidationStep,
} from './repository';
import { DEFAULT_PROFILE_ID, getProfile } from '../profiles/index';
import { buildDesign } from '../stats/design';
import { describe } from '../stats/descriptive';
import { mulberry32 } from '../stats/distributions';
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

export async function seedIfEmpty(): Promise<boolean> {
  const existing = listMethods();
  if (existing.length > 0) return false;
  const profile = getProfile(DEFAULT_PROFILE_ID);

  const settings = loadSettings();
  if (!settings.laboratoryName) {
    saveSettings({
      ...settings,
      laboratoryName: 'Laboratório de Análises Químicas',
      laboratoryAddress: 'Av. Central, 100 — Bloco B',
      accreditation: 'Acreditação de ensaio (demo)',
      responsible: 'Dra. Marina Costa',
      reviewer: 'Dr. Paulo Alves',
      approver: 'Dra. Helena Ribeiro',
    });
  }

  const method = saveMethod(DEMO_METHOD);
  const validation = createValidation(method.id, 'Validação HPLC-CAF-01 — 2026');
  const selectedKeys = profile.parameters
    .filter((parameter) => parameter.defaultSelected)
    .map((parameter) => parameter.key);
  const parameters: ValidationParameter[] = profile.parameters.map((definition) => ({
    validationId: validation.id,
    key: definition.key,
    selected: Boolean(definition.defaultSelected),
    justification: definition.defaultJustification ?? '',
    criteria: method.criteria.filter((c) => c.parameter === definition.key),
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
  return true;
}

export const DEMO = {
  methodId: DEMO_METHOD_ID,
  methodCode: DEMO_METHOD.code,
  methodName: DEMO_METHOD.name,
};
