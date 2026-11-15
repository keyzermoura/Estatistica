import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addMeasurement,
  approveValidation,
  createValidation,
  deleteMeasurement,
  deleteValidation,
  getBundle,
  getLatestReport,
  getMethod,
  getValidation,
  listAudit,
  replaceMeasurements,
  replaceUncertainty,
  saveDesign,
  saveMethod,
  saveParameters,
  saveReport,
  signReport,
  updateValidation,
} from '../repository';
import { composeReport } from '../report';
import { seedSutureVerification } from '../seed';
import { setDatabaseForTests, transaction } from '../db';
import { initializeSchema } from '../schema';
import {
  DEFAULT_DESIGN_INPUT,
  DEFAULT_REPORT_CONFIG,
  type DesignRecord,
  type Measurement,
  type Method,
  type ReportRecord,
} from '../types';
import { analyzeValidation } from '../../stats/analysis';
import { buildDesign } from '../../stats/design';

async function openMemoryDb(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function makeMethod(id: string): Method {
  const now = '2026-01-10T10:00:00.000Z';
  return {
    id,
    code: `M-${id}`,
    name: `Método ${id}`,
    type: 'quantitative',
    family: 'analytical',
    unit: 'mg/L',
    rangeMin: 1,
    rangeMax: 100,
    lsl: null,
    usl: null,
    resolution: null,
    measurand: '',
    toleranceUnit: '',
    equipment: 'HPLC',
    referenceNorm: 'ICH Q2(R2)',
    validationType: 'full',
    description: 'Método teste',
    criteria: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeMeasurement(validationId: string, id: string, runOrder: number): Measurement {
  return {
    id,
    validationId,
    runOrder,
    level: '10',
    analyst: 'Ana',
    day: 'D1',
    equipment: 'HPLC',
    lot: 'L1',
    sample: 'S1',
    replicate: runOrder,
    value: 10 + runOrder * 0.1,
    referenceValue: 10,
    textValue: '',
    notes: '',
  };
}

function makeDraftReport(validationId: string, version: number): ReportRecord {
  const now = '2026-01-10T12:00:00.000Z';
  return {
    id: `rep-${validationId}-v${version}`,
    validationId,
    version,
    status: 'draft',
    content: {
      title: 'Relatório de Teste',
      subtitle: 'Validação teste',
      laboratory: {
        name: DEFAULT_REPORT_CONFIG.laboratoryName,
        address: DEFAULT_REPORT_CONFIG.laboratoryAddress,
        accreditation: DEFAULT_REPORT_CONFIG.accreditation,
        logoDataUrl: '',
      },
      method: {
        name: 'Método 1',
        code: 'M-1',
        type: 'quantitative',
        unit: 'mg/L',
        range: '1 – 100 mg/L',
        equipment: 'HPLC',
        referenceNorm: 'ICH Q2(R2)',
        validationType: 'full',
      },
      objective: 'Objetivo',
      scope: 'Escopo',
      designSummary: 'Resumo',
      dataSummary: 'Dados',
      parameterResults: [],
      uncertainty: null,
      conclusion: 'Conclusão',
      limitations: [],
      assumptions: [],
      references: [],
      signatures: [
        { role: 'elaboration', name: 'Ana', date: null, signed: false },
        { role: 'review', name: 'Bruno', date: null, signed: false },
        { role: 'approval', name: 'Carla', date: null, signed: false },
      ],
      generatedAt: now,
      version: String(version),
      auditHash: 'hash-teste',
    },
    elaboratedBy: 'Ana',
    reviewedBy: '',
    approvedBy: '',
    elaboratedAt: null,
    reviewedAt: null,
    approvedAt: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe('repositório e persistência SQLite', () => {
  let db: Database;

  beforeEach(async () => {
    db = await openMemoryDb();
    setDatabaseForTests(db);
  });

  afterEach(() => {
    setDatabaseForTests(null);
    db.close();
  });

  it('suporta transações aninhadas com SAVEPOINT em rollback parcial e total', () => {
    transaction(() => {
      saveMethod(makeMethod('outer-keep'));
      expect(() =>
        transaction(() => {
          saveMethod(makeMethod('inner-abort'));
          throw new Error('Falha interna');
        }),
      ).toThrow('Falha interna');
    });

    expect(getMethod('outer-keep')?.code).toBe('M-outer-keep');
    expect(getMethod('inner-abort')).toBeNull();

    expect(() =>
      transaction(() => {
        saveMethod(makeMethod('outer-abort'));
        transaction(() => {
          saveMethod(makeMethod('inner-commit-then-outer-abort'));
        });
        expect(getMethod('inner-commit-then-outer-abort')).not.toBeNull();
        throw new Error('Falha externa');
      }),
    ).toThrow('Falha externa');

    expect(getMethod('outer-abort')).toBeNull();
    expect(getMethod('inner-commit-then-outer-abort')).toBeNull();
  });

  it('invalida assinaturas do relatório da versão atual ao mutar medições, parâmetros ou método', () => {
    const method = saveMethod(makeMethod('m1'), 'Ana');
    const validation = createValidation(method.id, 'Validação 1', 'Ana');

    const signCycle = () => {
      saveReport(makeDraftReport(validation.id, validation.version), 'Ana');
      signReport(validation.id, 'elaboration', 'Ana', 'Ana');
      signReport(validation.id, 'review', 'Bruno', 'Bruno');
      const signed = getLatestReport(validation.id)!;
      expect(signed.status).toBe('in_review');
      expect(signed.elaboratedAt).not.toBeNull();
      expect(signed.reviewedAt).not.toBeNull();
      expect(signed.content.signatures.filter((s) => s.signed)).toHaveLength(2);
    };

    const expectInvalidated = (expectedReason: string) => {
      const report = getLatestReport(validation.id)!;
      expect(report.status).toBe('draft');
      expect(report.locked).toBe(false);
      expect(report.elaboratedAt).toBeNull();
      expect(report.reviewedAt).toBeNull();
      expect(report.approvedAt).toBeNull();
      expect(report.reviewedBy).toBe('');
      expect(report.approvedBy).toBe('');
      expect(report.content.signatures.every((s) => !s.signed && s.date === null)).toBe(true);
      const lastInvalidate = listAudit(validation.id).find(
        (entry) => entry.entity === 'report' && entry.action === 'invalidate',
      );
      expect(lastInvalidate?.reason).toBe(expectedReason);
    };

    // 1) Substituição de medições
    signCycle();
    replaceMeasurements(
      validation.id,
      [makeMeasurement(validation.id, 'm-1', 1)],
      'Carlos',
      'Nova coleta',
    );
    expectInvalidated('Medições substituídas após assinatura do relatório');

    // 2) Adição / edição / exclusão unitária de medição
    signCycle();
    const extra = makeMeasurement(validation.id, 'm-2', 2);
    addMeasurement(extra, 'Carlos');
    expectInvalidated('Medições alteradas após assinatura do relatório');

    signCycle();
    replaceUncertainty(validation.id, [], 'Carlos');
    expectInvalidated('Orçamento de incerteza alterado após assinatura do relatório');

    // 3) Alteração de parâmetros e delineamento
    signCycle();
    saveParameters(validation.id, [], 'Carlos');
    expectInvalidated('Parâmetros alterados após assinatura do relatório');

    signCycle();
    const designRecord: DesignRecord = {
      id: 'des-1',
      validationId: validation.id,
      input: DEFAULT_DESIGN_INPUT,
      plan: buildDesign(DEFAULT_DESIGN_INPUT, { selected: ['repeatability', 'accuracy'], profileId: 'analytical' }),
      seed: DEFAULT_DESIGN_INPUT.seed,
      createdAt: '2026-01-10T11:00:00.000Z',
    };
    saveDesign(designRecord, 'Carlos');
    expectInvalidated('Delineamento alterado após assinatura do relatório');

    // 4) Alteração do método vinculado sem afetar validação já bloqueada
    const lockedVal = createValidation(method.id, 'Validação Aprovada', 'Ana');
    saveReport(makeDraftReport(lockedVal.id, lockedVal.version), 'Ana');
    signReport(lockedVal.id, 'elaboration', 'Ana', 'Ana');
    signReport(lockedVal.id, 'review', 'Bruno', 'Bruno');
    signReport(lockedVal.id, 'approval', 'Carla', 'Carla');
    approveValidation(lockedVal.id, 'Carla');

    signCycle();
    saveMethod({ ...method, name: 'Método Atualizado' }, 'Gestor');
    expectInvalidated('Método atualizado após assinatura do relatório');
    expect(getLatestReport(lockedVal.id)?.locked).toBe(true);
    expect(getLatestReport(lockedVal.id)?.status).toBe('approved');

    // 5) updateMeasurement e deleteMeasurement invalidam em validação livre
    signCycle();
    deleteMeasurement(extra, 'Carlos', 'Remoção');
    expectInvalidated('Medições alteradas após assinatura do relatório');
  });

  it('preserva registro de auditoria ao excluir validação', () => {
    const method = saveMethod(makeMethod('m-del'));
    const validation = createValidation(method.id, 'Para excluir', 'Ana');
    deleteValidation(validation.id, 'Auditora Paula');

    expect(getValidation(validation.id)).toBeNull();
    const audit = listAudit(validation.id);
    const deleteEntry = audit.find(
      (entry) => entry.entity === 'validation' && entry.action === 'delete',
    );
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.actor).toBe('Auditora Paula');
    expect((deleteEntry?.before as { id?: string } | null)?.id).toBe(validation.id);
    expect(deleteEntry?.after).toBeNull();
    expect(deleteEntry?.reason).toBe('Exclusão da validação');
  });

  it('distingue verificação (ISO/IEC 17025 7.2.1.5) e validação (7.2.2) ao compor relatórios', async () => {
    const verificationMethod = saveMethod({
      ...makeMethod('m-verif'),
      name: 'Cloreto por Cromatografia',
      validationType: 'verification',
    });
    const fullMethod = saveMethod({
      ...makeMethod('m-full'),
      name: 'Mercúrio por ICP-OES',
      validationType: 'full',
    });

    const verifVal = createValidation(verificationMethod.id, 'Verificação', 'Ana');
    const fullVal = createValidation(fullMethod.id, 'Validação', 'Ana');
    const verifBundle = getBundle(verifVal.id)!;
    const fullBundle = getBundle(fullVal.id)!;

    const baseAnalysis = analyzeValidation(
      verifBundle.parameters,
      [makeMeasurement(verifVal.id, 'mv-1', 1)],
      [],
      { profileId: 'analytical' },
    );
    const passAnalysis = {
      ...baseAnalysis,
      overallVerdict: 'pass' as const,
      parameters: baseAnalysis.parameters.slice(0, 1).map((p) => ({
        ...p,
        verdict: 'pass' as const,
      })),
    };
    const failAnalysis = {
      ...baseAnalysis,
      overallVerdict: 'fail' as const,
      parameters: baseAnalysis.parameters.slice(0, 1).map((p) => ({
        ...p,
        verdict: 'fail' as const,
      })),
    };

    const verifPass = await composeReport(verifBundle, passAnalysis, 'Ana');
    expect(verifPass.content.title).toBe('Relatório de Verificação de Método — Cloreto por Cromatografia');
    expect(verifPass.content.conclusion).toContain('item 7.2.1.5');
    expect(verifPass.content.conclusion).toContain('verificação de método normalizado');

    const verifFail = await composeReport(verifBundle, failAnalysis, 'Ana');
    expect(verifFail.content.conclusion).toContain('item 7.2.1.5');
    expect(verifFail.content.conclusion).toContain('repetir a verificação');

    const verifIncomplete = await composeReport(verifBundle, baseAnalysis, 'Ana');
    expect(verifIncomplete.content.conclusion).toContain('A verificação está incompleta');

    const customBundle = {
      ...verifBundle,
      validation: {
        ...verifBundle.validation,
        reportConfig: {
          ...verifBundle.validation.reportConfig,
          reportTitle: 'Relatório Técnico Customizado',
        },
      },
    };
    const customReport = await composeReport(customBundle, passAnalysis, 'Ana');
    expect(customReport.content.title).toBe('Relatório Técnico Customizado');

    const fullPass = await composeReport(fullBundle, passAnalysis, 'Ana');
    expect(fullPass.content.title).toBe('Relatório de Validação — Mercúrio por ICP-OES');
    expect(fullPass.content.conclusion).toContain('item 7.2.2');
    expect(fullPass.content.conclusion).toContain('adequação ao uso pretendido');
  });

  it('carrega o exemplo ABNT NBR 13904 / USP <881> com todos os parâmetros avaliados como conformes', async () => {
    const id = seedSutureVerification();
    expect(seedSutureVerification()).toBe(id);

    const bundle = getBundle(id)!;
    expect(bundle).not.toBeNull();
    expect(bundle.method.code).toBe('SUT-TRA-13904');
    expect(bundle.method.family).toBe('physical-destructive');
    expect(bundle.method.validationType).toBe('verification');
    expect(bundle.method.lsl).toBe(26.8);
    expect(bundle.method.usl).toBeNull();
    expect(bundle.validation.reportConfig.individualLsl).toBe(13.4);
    expect(bundle.validation.currentStep).toBe(4);
    expect(bundle.measurements).toHaveLength(54);

    const analysis = analyzeValidation(
      bundle.parameters,
      bundle.measurements,
      bundle.method.criteria,
      {
        alpha: bundle.design?.input.alpha ?? 0.05,
        confidence: bundle.design?.input.confidence ?? 0.95,
        margin: bundle.design?.input.margin,
        plans: bundle.design?.plan.parameterPlans,
        uncertaintyItems: bundle.uncertainty,
        rangeMin: bundle.method.rangeMin,
        rangeMax: bundle.method.rangeMax,
        profileId: 'physical-destructive',
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
      },
    );

    expect(analysis.parameters.map((p) => p.key)).toEqual([
      'resolution',
      'bias',
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
    const conformity = analysis.parameters.find((p) => p.key === 'conformity')!;
    expect(conformity.rawMetrics.individual_lsl).toBe(13.4);
    expect(conformity.rawMetrics.individual_below_count).toBe(0);

    const report = await composeReport(bundle, analysis, 'seed');
    expect(report.content.title).toContain('Verificação de Método');
    expect(report.content.method.referenceNorm).toContain('ABNT NBR 13904');
    expect(report.content.conclusion).toContain('item 7.2.1.5');
  });

  it('persiste a configuração de homogeneidade do lote no relatório da validação', () => {
    const method = saveMethod(makeMethod('m-homogeneity'));
    const validation = createValidation(method.id, 'Validação com homogeneidade', 'Ana');
    const bundle = getBundle(validation.id)!;

    updateValidation(
      {
        ...bundle.validation,
        reportConfig: {
          ...bundle.validation.reportConfig,
          homogeneityCheck: true,
          homogeneityJustification: 'Sublotes certificados no histórico do fornecedor.',
        },
      },
      'Ana',
      'Configuração de homogeneidade',
    );

    const reloaded = getBundle(validation.id)!;
    expect(reloaded.validation.reportConfig.homogeneityCheck).toBe(true);
    expect(reloaded.validation.reportConfig.homogeneityJustification).toBe(
      'Sublotes certificados no histórico do fornecedor.',
    );
  });
});
