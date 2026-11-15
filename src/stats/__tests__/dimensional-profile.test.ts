import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDatabaseForTests } from '../../lib/db';
import { buildReportDocx, buildReportPdf } from '../../lib/export';
import {
  createValidation,
  getBundle,
  listValidations,
  replaceMeasurements,
  saveMethod,
} from '../../lib/repository';
import { composeReport } from '../../lib/report';
import { initializeSchema } from '../../lib/schema';
import {
  DEMO,
  DEMO_DIMENSIONAL_METHOD_ID,
  DEMO_SUTURE_METHOD_ID,
  seedDimensionalDemo,
  seedIfEmpty,
  seedSutureVerification,
} from '../../lib/seed';
import type { Measurement, Method, ValidationBundle } from '../../lib/types';
import { analyzeValidation } from '../analysis';

async function openMemoryDb(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function runBundleAnalysis(bundle: ValidationBundle) {
  return analyzeValidation(bundle.parameters, bundle.measurements, bundle.method.criteria, {
    alpha: bundle.design?.input.alpha ?? 0.05,
    confidence: bundle.design?.input.confidence ?? 0.95,
    margin: bundle.design?.input.margin,
    plans: bundle.design?.plan.parameterPlans,
    uncertaintyItems: bundle.uncertainty,
    rangeMin: bundle.method.rangeMin,
    rangeMax: bundle.method.rangeMax,
    profileId: bundle.method.family,
    lsl: bundle.method.lsl,
    usl: bundle.method.usl,
    resolution: bundle.method.resolution,
    unit: bundle.method.unit,
    processVariation: bundle.validation.reportConfig.processVariation ?? null,
    conformity: {
      rule: bundle.validation.reportConfig.conformityRule ?? 'guard_band',
      coverageFactor: 2,
      guardBandFactor: bundle.validation.reportConfig.guardBandFactor ?? 1,
      probabilityThreshold: bundle.validation.reportConfig.probabilityThreshold ?? 0.95,
      individualLsl: bundle.validation.reportConfig.individualLsl ?? null,
    },
  });
}

describe('Perfil dimensional (eixo 10 mm) e geração de relatórios multifamília', () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMemoryDb();
    setDatabaseForTests(db);
  });

  afterEach(() => {
    setDatabaseForTests(null);
    db.close();
  });

  it('carrega seedDimensionalDemo de forma idempotente e aprova os 8 parâmetros dimensionais', () => {
    const firstId = seedDimensionalDemo();
    const secondId = seedDimensionalDemo();
    expect(secondId).toBe(firstId);

    const bundle = getBundle(firstId)!;
    expect(bundle).not.toBeNull();
    expect(bundle.method.id).toBe(DEMO_DIMENSIONAL_METHOD_ID);
    expect(bundle.method.code).toBe('DIM-MIC-025');
    expect(bundle.method.family).toBe('dimensional');
    expect(bundle.method.lsl).toBe(9.95);
    expect(bundle.method.usl).toBe(10.05);
    expect(bundle.method.resolution).toBe(0.001);
    expect(bundle.measurements.length).toBeGreaterThanOrEqual(120);
    expect(bundle.uncertainty.length).toBeGreaterThanOrEqual(5);

    const analysis = runBundleAnalysis(bundle);
    expect(analysis.parameters.map((p) => p.key)).toEqual([
      'resolution',
      'bias',
      'linearity',
      'stability',
      'repeatability',
      'reproducibility',
      'uncertainty',
      'conformity',
    ]);
    expect(
      analysis.parameters.filter((p) => p.verdict !== 'pass').map((p) => [p.key, p.verdict, p.summary]),
    ).toEqual([]);
    expect(analysis.overallVerdict).toBe('pass');
  });

  it('gera relatório composto, DOCX e PDF válidos nas 5 famílias de método', async () => {
    seedIfEmpty();
    seedSutureVerification();
    seedDimensionalDemo();

    const now = '2026-11-14T12:00:00.000Z';

    // Físico não destrutivo (dureza Shore A cruzada)
    const nonDestructiveMethod: Method = {
      id: 'method_pnd_test',
      code: 'FND-DUR-01',
      name: 'Dureza Shore A por durômetro digital',
      type: 'dimensional',
      family: 'physical-nondestructive',
      unit: 'Shore A',
      rangeMin: 0,
      rangeMax: 100,
      lsl: 55,
      usl: 65,
      resolution: 0.5,
      measurand: 'Dureza Shore A',
      toleranceUnit: 'Shore A',
      equipment: 'Durômetro Shore A calibrado',
      referenceNorm: 'ASTM D2240; ISO 22514-7',
      validationType: 'full',
      description: 'Ensaio não destrutivo de dureza superficial.',
      criteria: [],
      createdAt: now,
      updatedAt: now,
    };
    saveMethod(nonDestructiveMethod, 'test');
    const pndVal = createValidation(nonDestructiveMethod.id, 'Validação FND — Dureza', 'test');
    const pndMeas: Measurement[] = [];
    let order = 1;
    for (const part of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      const base = 58 + Number(part.slice(1));
      for (const analyst of ['Ana', 'Bruno']) {
        for (const rep of [1, 2]) {
          pndMeas.push({
            id: `pnd-${order}`,
            validationId: pndVal.id,
            runOrder: order++,
            level: '60 Shore A',
            analyst,
            day: 'D1',
            equipment: 'Durômetro #1',
            lot: 'L1',
            sample: part,
            partId: part,
            specimen: '',
            destructive: false,
            condition: { temperature: 23, humidity: 50, testSpeed: null, other: '' },
            refValue: null,
            refUncertainty: null,
            category: '',
            replicate: rep,
            value: base + (rep === 1 ? 0.1 : -0.1),
            referenceValue: null,
            textValue: '',
            notes: '',
          });
        }
      }
    }
    replaceMeasurements(pndVal.id, pndMeas, 'test');

    // Atributo (inspeção visual Passa / Não Passa)
    const attrMethod: Method = {
      id: 'method_attr_test',
      code: 'ATR-VIS-01',
      name: 'Inspeção visual de solda em embalagem',
      type: 'qualitative',
      family: 'attribute',
      unit: '',
      rangeMin: null,
      rangeMax: null,
      lsl: null,
      usl: null,
      resolution: null,
      measurand: 'Integridade da selagem',
      toleranceUnit: '',
      equipment: 'Cabine de inspeção 1000 lux',
      referenceNorm: 'AIAG MSA cap. IV (Atributos); ISO 13485',
      validationType: 'full',
      description: 'Avaliação qualitativa binária (Conforme / Não conforme).',
      criteria: [],
      createdAt: now,
      updatedAt: now,
    };
    saveMethod(attrMethod, 'test');
    const attrVal = createValidation(attrMethod.id, 'Validação Atributo — Inspeção Visual', 'test');
    const attrMeas: Measurement[] = [];
    let aOrder = 1;
    const refs = ['Conforme', 'Não conforme', 'Conforme', 'Conforme', 'Não conforme'];
    for (let i = 0; i < refs.length; i++) {
      const part = `A${i + 1}`;
      const expectedLabel = refs[i];
      for (const analyst of ['Ana', 'Bruno']) {
        for (const rep of [1, 2]) {
          attrMeas.push({
            id: `attr-${aOrder}`,
            validationId: attrVal.id,
            runOrder: aOrder++,
            level: 'Lote padrão',
            analyst,
            day: 'D1',
            equipment: 'Cabine 01',
            lot: 'L1',
            sample: part,
            partId: part,
            specimen: '',
            destructive: false,
            condition: null,
            refValue: expectedLabel === 'Conforme' ? 1 : 0,
            refUncertainty: null,
            category: expectedLabel,
            replicate: rep,
            value: expectedLabel === 'Conforme' ? 1 : 0,
            referenceValue: expectedLabel === 'Conforme' ? 1 : 0,
            textValue: expectedLabel,
            notes: expectedLabel,
          });
        }
      }
    }
    replaceMeasurements(attrVal.id, attrMeas, 'test');

    const allValidations = listValidations();
    const targetIds = [
      allValidations.find((v) => v.methodId === DEMO.methodId)?.id,
      allValidations.find((v) => v.methodId === DEMO_DIMENSIONAL_METHOD_ID)?.id,
      allValidations.find((v) => v.methodId === DEMO_SUTURE_METHOD_ID)?.id,
      pndVal.id,
      attrVal.id,
    ];
    expect(targetIds.every(Boolean)).toBe(true);

    const seenFamilies = new Set<string>();
    for (const id of targetIds) {
      const bundle = getBundle(id!)!;
      seenFamilies.add(bundle.method.family);
      const analysis = runBundleAnalysis(bundle);
      const report = await composeReport(bundle, analysis, 'Validador QA');
      expect(report.content.auditHash).toMatch(/^[0-9a-f]{64}$/);
      expect(report.content.parameterResults.length).toBeGreaterThan(0);

      const docxBytes = await buildReportDocx(bundle, analysis, report);
      expect(docxBytes.byteLength).toBeGreaterThan(1000);
      expect(String.fromCharCode(docxBytes[0], docxBytes[1])).toBe('PK');

      const pdfBytes = await buildReportPdf(bundle, analysis, report);
      expect(pdfBytes.byteLength).toBeGreaterThan(1000);
      expect(String.fromCharCode(pdfBytes[0], pdfBytes[1], pdfBytes[2], pdfBytes[3])).toBe('%PDF');
    }

    expect(seenFamilies).toEqual(
      new Set([
        'analytical',
        'dimensional',
        'physical-destructive',
        'physical-nondestructive',
        'attribute',
      ]),
    );
  });
});
