import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { computeEmp } from '../emp';
import { computeCapabilityCg } from '../capabilityCg';
import {
  blandAltman,
  demingRegression,
  passingBablokRegression,
} from '../methodComparison';
import { clsiEp17Limits, probitLod95 } from '../lodProbit';
import {
  evaluateExpression,
  numericalSensitivity,
  runMonteCarloUncertainty,
} from '../monteCarlo';
import {
  NORMATIVE_TEMPLATES,
  applyNormativeTemplate,
} from '../../profiles/normative-templates';
import { setDatabaseForTests } from '../../lib/db';
import { initializeSchema } from '../../lib/schema';
import {
  getBundle,
  getLatestReport,
  getValidation,
  saveReport,
} from '../../lib/repository';
import { composeReport } from '../../lib/report';
import { analyzeValidation } from '../analysis';
import { computeBufferSha256, validateImportBalance } from '../../lib/spreadsheet';
import { computeAccuracyProfile } from '../accuracyProfile';
import {
  compareCalibrationWeightings,
  lodLoqEurachemBlanks,
  mandelLinearityTest,
} from '../regression';
import {
  computeSamplingDuplicateUncertainty,
  computeTopDownUncertainty,
  computeUncertainty,
} from '../uncertainty';
import { zetaScore, zPrimeScore } from '../bias';
import { computeMatrixEffectCurves } from '../parameters/selectivity';
import {
  buildConformityDensityData,
  computeBayesianConformityRisks,
  computeTargetUncertainty,
  conformityDecision,
} from '../conformity';
import {
  buildMandelCharts,
  evaluateMandelConsistency,
  iso5725Analysis,
  mandelHCritical,
  mandelKCritical,
  type Iso5725Row,
} from '../iso5725';
import {
  buildHistogramChart,
  buildNormalProbabilityChart,
  computeHistogramWithNormalCurve,
  computeNormalProbabilityPlot,
} from '../normality';
import { gageRRAnalysis, gageRRUnbalancedMethods, type GageRRMatrix } from '../gagerr';
import { computeQualitativeDiagnosticMetrics } from '../attribute';
import type { Measurement, ValidationParameter } from '../../lib/types';

async function openMemoryDb(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), 'node_modules/sql.js/dist', file),
  });
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

describe('EMP (Wheeler) e Capabilidade Tipo 1 (Cg/Cgk + VDA 5)', () => {
  it('classifica monitor Class I para sistema capaz e Class IV para sistema ruidoso', () => {
    const class1 = computeEmp({
      sigmaPart: 2.0,
      sigmaRepeatability: 0.25,
      sigmaReproducibility: 0.1,
      resolution: 0.1,
    });
    expect(class1.icc).toBeGreaterThanOrEqual(0.8);
    expect(class1.monitorClass).toBe('Class I');
    expect(class1.probableError).toBeCloseTo(0.6745 * 0.25, 4);
    expect(class1.resolutionStatus).toBe('adequada');

    const class4 = computeEmp({
      sigmaPart: 0.2,
      sigmaRepeatability: 1.0,
      sigmaReproducibility: 0.5,
      resolution: 2.0,
    });
    expect(class4.icc).toBeLessThan(0.2);
    expect(class4.monitorClass).toBe('Class IV');
    expect(class4.resolutionStatus).toBe('grosseira');
  });

  it('calcula Cg, Cgk e Q_MS / Q_MP com veredito AIAG / VDA 5', () => {
    const good = computeCapabilityCg({
      values: [10.0, 10.01, 9.99, 10.0, 10.01, 9.99, 10.0, 10.01, 9.99, 10.0],
      reference: 10.0,
      tolerance: 1.0,
      uMS: 0.04,
      uMP: 0.08,
    });
    expect(good.cg).not.toBeNull();
    expect(good.cg!).toBeGreaterThanOrEqual(1.33);
    expect(good.cgk!).toBeGreaterThanOrEqual(1.33);
    expect(good.qMsPct).toBeCloseTo(8, 5);
    expect(good.qMpPct).toBeCloseTo(16, 5);
    expect(good.verdict).toBe('pass');

    const poor = computeCapabilityCg({
      values: [10.35, 10.42, 10.28, 10.45, 10.38, 10.4, 10.31, 10.44],
      reference: 10.0,
      tolerance: 1.0,
    });
    expect(poor.verdict).toBe('fail');
  });
});

describe('Comparação de métodos (CLSI EP09) e Capacidade de Detecção (CLSI EP17 / Probit)', () => {
  it('executa Bland-Altman, regressão de Deming e Passing-Bablok consistentemente', () => {
    const x = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const y = [10.2, 20.1, 29.8, 40.3, 50.0, 59.7, 70.4, 80.2, 89.9, 100.1];

    const ba = blandAltman(x, y);
    expect(Math.abs(ba.meanBias)).toBeLessThan(0.3);
    expect(ba.loaUpper).toBeGreaterThan(ba.loaLower);

    const deming = demingRegression(x, y, 1);
    expect(deming.slope).toBeCloseTo(1, 1);
    expect(deming.equivalentSlope).toBe(true);
    expect(deming.equivalentIntercept).toBe(true);

    const pb = passingBablokRegression(x, y);
    expect(pb.slope).toBeCloseTo(1, 1);
    expect(pb.validSlopes).toBeGreaterThan(10);
    expect(pb.equivalentSlope).toBe(true);
  });

  it('calcula LoB e LoD via CLSI EP17-A2 e LOD95% por Probit IRLS', () => {
    const blanks = [0.02, 0.03, 0.01, 0.04, 0.02, 0.03, 0.02, 0.01, 0.03, 0.02, 0.02, 0.03];
    const lowSamples = [0.09, 0.11, 0.1, 0.12, 0.08, 0.11, 0.1, 0.09, 0.12, 0.1];
    const ep17 = clsiEp17Limits(blanks, lowSamples);
    expect(ep17.lobParametric).toBeGreaterThan(ep17.meanBlank);
    expect(ep17.lodParametric).toBeGreaterThan(ep17.lobParametric);

    const probit = probitLod95([
      { concentration: 1, positives: 2, total: 20 },
      { concentration: 2, positives: 6, total: 20 },
      { concentration: 4, positives: 13, total: 20 },
      { concentration: 8, positives: 18, total: 20 },
      { concentration: 16, positives: 20, total: 20 },
    ]);
    expect(probit.lod).toBeGreaterThan(probit.lod50);
    expect(probit.lod).toBeLessThan(20);
    expect(probit.lodCi[0]).toBeLessThan(probit.lodCi[1]);
  });
});

describe('Propagação por Monte Carlo (JCGM 101:2008)', () => {
  it('avalia expressões matemáticas seguras e converge para o resultado GUM em modelos lineares', () => {
    const val = evaluateExpression('F / (0.25 * 3.14159265 * d^2)', { F: 100, d: 2 });
    expect(val).toBeCloseTo(100 / Math.PI, 4);

    const sens = numericalSensitivity('2 * x + 3 * y', { x: 10, y: 5 }, 'x');
    expect(sens).toBeCloseTo(2, 5);

    const mcGaussian = runMonteCarloUncertainty({
      variables: [
        { name: 'X1', estimate: 0, halfWidthOrSd: 0.3, distribution: 'normal' },
        { name: 'X2', estimate: 0, halfWidthOrSd: 0.4, distribution: 'normal' },
      ],
      trials: 40000,
      coverageProbability: 0.95,
      seed: 17025,
    });
    expect(mcGaussian.gumCombinedUncertainty).toBeCloseTo(0.5, 4);
    expect(mcGaussian.standardUncertainty).toBeCloseTo(0.5, 1);
    expect(mcGaussian.gumCompatible).toBe(true);
    expect(mcGaussian.shortestInterval[1]).toBeGreaterThan(mcGaussian.shortestInterval[0]);

    const mcRect = runMonteCarloUncertainty({
      variables: [
        { name: 'X1', estimate: 0, halfWidthOrSd: 0.3, distribution: 'normal' },
        {
          name: 'X2',
          estimate: 0,
          halfWidthOrSd: 0.4 * Math.sqrt(3),
          distribution: 'rectangular',
        },
      ],
      trials: 30000,
      coverageProbability: 0.95,
      seed: 17025,
    });
    expect(mcRect.gumCombinedUncertainty).toBeCloseTo(0.5, 4);
    expect(mcRect.standardUncertainty).toBeCloseTo(0.5, 1);
    // Distribuição dominada por retangular possui intervalo 95% mais estreito que k=1,96·u_c do GUM
    expect(mcRect.gumCompatible).toBe(false);
    expect(mcRect.shortestInterval[1] - mcRect.shortestInterval[0]).toBeLessThan(
      2 * mcRect.gumExpandedUncertainty,
    );
  });
});

describe('Templates normativos e Integridade de Importação', () => {
  let db: Database | null = null;

  afterEach(() => {
    setDatabaseForTests(null);
    db?.close();
    db = null;
  });

  it('instancia método e validação pré-configurados em 1 clique a partir de templates normativos', async () => {
    db = await openMemoryDb();
    setDatabaseForTests(db);

    expect(NORMATIVE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const { method, validation } = applyNormativeTemplate('abnt-nbr-13904-sutura', 'qa-test');
    expect(method.family).toBe('physical-destructive');
    expect(method.lsl).toBe(16.5);
    expect(validation.reportConfig.individualLsl).toBe(13.4);

    const bundle = getBundle(validation.id);
    expect(bundle).not.toBeNull();
    const analysis = analyzeValidation(
      bundle!.parameters,
      bundle!.measurements,
      bundle!.method.criteria,
      {
        profileId: bundle!.method.family,
        lsl: bundle!.method.lsl,
        usl: bundle!.method.usl,
        resolution: bundle!.method.resolution,
        unit: bundle!.method.unit,
        uncertaintyItems: bundle!.uncertainty,
        conformity: {
          individualLsl: bundle!.validation.reportConfig.individualLsl,
        },
      },
    );
    const report = await composeReport(bundle!, analysis, 'qa-test');
    saveReport(report, 'qa-test');
    expect(report.content.assumptions.some((a) => a.includes('Regra de decisão'))).toBe(true);
    expect(report.content.assumptions.some((a) => a.includes('13.4'))).toBe(true);

    const latest = getLatestReport(validation.id);
    expect(latest?.content.auditHash).toBeTruthy();
    expect(getValidation(validation.id)?.id).toBe(validation.id);
  });

  it('calcula hash SHA-256 e identifica desbalanceamento ou corpos de prova duplicados', async () => {
    const sampleBytes = new TextEncoder().encode('ordem;valor\n1;19.4\n2;20.1\n');
    const h1 = await computeBufferSha256(sampleBytes);
    const h2 = await computeBufferSha256(sampleBytes);
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);

    const warnings = validateImportBalance(
      [
        { analyst: 'Op1', sample: 'S1', specimen: 'CP-1', value: 19.2 },
        { analyst: 'Op1', sample: 'S1', specimen: 'CP-1', value: 19.5 },
        { analyst: 'Op2', sample: 'S1', specimen: 'CP-2', value: 18.9 },
      ],
      'physical-destructive',
    );
    expect(warnings.some((w) => w.includes('duplicados'))).toBe(true);
    expect(warnings.some((w) => w.includes('desbalanceado'))).toBe(true);
  });
});

describe('Perfil de Exatidão, Mandel, Ponderação WLS, Youden/Lenth e Probit integrados', () => {
  it('calcula Perfil de Exatidão β-expectation (SFSTP / USP <1210>) por nível e define LLOQ/ULOQ', () => {
    const base = {
      validationId: 'val-ap',
      equipment: 'HPLC-1',
      lot: 'L1',
      textValue: '',
      notes: '',
    };
    const measurements: Measurement[] = [];
    let id = 0;
    const specs: Array<{ lvl: string; ref: number; deltas: number[] }> = [
      { lvl: '10', ref: 10, deltas: [-0.9, -0.7, 0.8, 0.9, -0.8, 0.85] },
      { lvl: '50', ref: 50, deltas: [0.2, -0.1, 0.3, 0.1, -0.2, 0.05] },
      { lvl: '100', ref: 100, deltas: [-0.3, 0.4, -0.1, 0.2, -0.2, 0.1] },
    ];
    for (const s of specs) {
      s.deltas.forEach((d, idx) => {
        id += 1;
        measurements.push({
          ...base,
          id: `ap-${id}`,
          runOrder: id,
          level: s.lvl,
          analyst: idx < 3 ? 'Ana' : 'Bruno',
          day: idx < 3 ? 'D1' : 'D2',
          sample: `S-${s.lvl}-${idx}`,
          replicate: (idx % 3) + 1,
          refValue: s.ref,
          value: s.ref + d,
        });
      });
    }

    const strictProfile = computeAccuracyProfile(measurements, {
      beta: 0.95,
      acceptanceLimitPct: 10,
    });
    expect(strictProfile).not.toBeNull();
    expect(strictProfile!.levels).toHaveLength(3);
    // Nível 10 tem dispersão ±0.85 (~8.5% RSD) e IT 95% excede ±10%, enquanto 50 e 100 passam!
    expect(strictProfile!.levels[0].withinAcceptance).toBe(false);
    expect(strictProfile!.levels[1].withinAcceptance).toBe(true);
    expect(strictProfile!.levels[2].withinAcceptance).toBe(true);
    expect(strictProfile!.lloq).toBe(50);
    expect(strictProfile!.uloq).toBe(100);
  });

  it('executa Teste de Mandel (ISO 8466-1) e seleção de ponderação WLS por Σ|%RE|', () => {
    const linearPts = [
      { x: 1, y: 2.02 },
      { x: 1, y: 1.98 },
      { x: 5, y: 10.05 },
      { x: 5, y: 9.95 },
      { x: 10, y: 20.1 },
      { x: 10, y: 19.9 },
      { x: 20, y: 40.2 },
      { x: 20, y: 39.8 },
    ];
    const mandelLinear = mandelLinearityTest(linearPts);
    expect(mandelLinear).not.toBeNull();
    expect(mandelLinear!.significant).toBe(false);
    expect(mandelLinear!.pValue).toBeGreaterThan(0.05);

    const curvedPts = [
      { x: 1, y: 2.1 },
      { x: 5, y: 12.5 },
      { x: 10, y: 30.0 },
      { x: 15, y: 52.5 },
      { x: 20, y: 80.0 },
    ];
    const mandelCurved = mandelLinearityTest(curvedPts);
    expect(mandelCurved).not.toBeNull();
    expect(mandelCurved!.significant).toBe(true);
    expect(mandelCurved!.pValue).toBeLessThan(0.01);
    expect(mandelCurved!.quadraticTerm).toBeGreaterThan(0);

    // Pontos com dispersão proporcional a x (heterocedástica: ±0.01 em x=1 e ±1.2 em x=100)
    const heteroPts = [
      { x: 1, y: 2.0 },
      { x: 1, y: 2.02 },
      { x: 1, y: 1.98 },
      { x: 10, y: 20.1 },
      { x: 10, y: 19.9 },
      { x: 10, y: 20.2 },
      { x: 100, y: 198.5 },
      { x: 100, y: 202.0 },
      { x: 100, y: 204.5 },
    ];
    const comp = compareCalibrationWeightings(heteroPts);
    expect(comp).not.toBeNull();
    expect(comp!.heteroscedastic).toBe(true);
    expect(comp!.recommendedScheme).not.toBe('ols');
    const ols = comp!.models.find((m) => m.scheme === 'ols')!;
    const best = comp!.models.find((m) => m.scheme === comp!.recommendedScheme)!;
    expect(best.sumAbsRePct!).toBeLessThan(ols.sumAbsRePct!);
  });

  it('integra Perfil de Exatidão, Mandel, limites r/R_IP e Youden/Lenth em analyzeValidation', () => {
    const base = {
      validationId: 'val-full',
      textValue: '',
      notes: '',
    };
    const measurements: Measurement[] = [];
    let id = 0;
    const conc = [10, 50, 100];
    const analysts = ['Ana', 'Bruno'];
    const days = ['D1', 'D2'];
    const equips = ['EQ1', 'EQ2'];
    const lots = ['L1', 'L2'];

    for (let cIdx = 0; cIdx < conc.length; cIdx++) {
      const x = conc[cIdx];
      for (let i = 0; i < 4; i++) {
        id += 1;
        measurements.push({
          ...base,
          id: `f-${id}`,
          runOrder: id,
          level: String(x),
          analyst: analysts[i % 2],
          day: days[Math.floor(i / 2) % 2],
          equipment: equips[(i + cIdx) % 2],
          lot: lots[(i + (cIdx === 0 ? 1 : 0)) % 2],
          sample: `S-${x}-${i}`,
          replicate: i + 1,
          refValue: x,
          value: 2 * x + (i % 2 === 0 ? 0.15 : -0.15) + (analysts[i % 2] === 'Ana' ? 0.05 : -0.05),
        });
      }
    }

    // Ajusta pares referência-medido para escala direta no teste de exatidão/linearidade
    const accMeasurements = measurements.map((m) => ({
      ...m,
      value: (m.value ?? 0) / 2,
    }));

    const params: ValidationParameter[] = [
      { validationId: 'val-full', key: 'linearity', selected: true, justification: '', criteria: [] },
      { validationId: 'val-full', key: 'intermediate_precision', selected: true, justification: '', criteria: [] },
      { validationId: 'val-full', key: 'accuracy', selected: true, justification: '', criteria: [] },
      { validationId: 'val-full', key: 'robustness', selected: true, justification: '', criteria: [] },
    ];

    const res = analyzeValidation(params, accMeasurements, [], {
      includeMethodComparison: true,
    });

    const lin = res.parameters.find((p) => p.key === 'linearity')!;
    expect(lin.tables.some((t) => t.title.includes('Mandel'))).toBe(true);
    expect(lin.tables.some((t) => t.title.includes('Ponderações'))).toBe(true);

    const ip = res.parameters.find((p) => p.key === 'intermediate_precision')!;
    expect(ip.tables[0]?.title).toBe('Precisão por nível');
    expect(ip.tables.some((t) => t.title.includes('2,8')) || ip.tables.some((t) => t.title.includes('Limites críticos'))).toBe(true);

    const acc = res.parameters.find((p) => p.key === 'accuracy')!;
    expect(acc.tables[0]?.title).toBe('Tendência e recuperação');
    expect(acc.tables.some((t) => t.title.includes('Perfil de Exatidão'))).toBe(true);
    expect(acc.charts.some((c) => c.title.includes('Bland–Altman'))).toBe(true);

    const rob = res.parameters.find((p) => p.key === 'robustness')!;
    expect(rob.tables[0]?.columns).toContain('Conclusão');
    expect(rob.tables[0]?.note).toContain('Lenth');
  });
});

describe('Pacotes Eurachem / CITAC (Top-Down, UfS, PT ζ/En, Blanks 2025, Efeito Matriz, U^tg e Qualitativo)', () => {
  it('sintetiza incerteza Top-Down (s_IP + u_bias) e incerteza de amostragem (UfS duplicado)', () => {
    const td = computeTopDownUncertainty({
      intermediatePrecisionSd: 0.4,
      intermediatePrecisionDof: 14,
      measuredValues: [10.3, 10.2, 10.4, 10.3, 10.25, 10.35],
      referenceValues: [10.0, 10.0, 10.0, 10.0, 10.0, 10.0],
      referenceUncertainties: [0.2],
      refCoverageFactor: 2,
    });
    expect(td.uRw).toBe(0.4);
    expect(td.meanBias).toBeCloseTo(0.3, 4);
    expect(td.uRef).toBeCloseTo(0.1, 4);
    expect(td.uBias).toBeGreaterThan(0.31);
    expect(td.combined).toBeCloseTo(Math.hypot(td.uRw, td.uBias), 5);
    expect(td.items).toHaveLength(2);
    expect(td.items[0].source).toContain('Eurachem Top-Down');

    const ufs = computeSamplingDuplicateUncertainty([
      { target: 'T1', subsample: 'S1', value: 10.0 },
      { target: 'T1', subsample: 'S1', value: 10.2 },
      { target: 'T1', subsample: 'S2', value: 11.4 },
      { target: 'T1', subsample: 'S2', value: 11.6 },
      { target: 'T2', subsample: 'S1', value: 14.0 },
      { target: 'T2', subsample: 'S1', value: 14.1 },
      { target: 'T2', subsample: 'S2', value: 15.2 },
      { target: 'T2', subsample: 'S2', value: 15.4 },
    ]);
    expect(ufs.targets).toBe(2);
    expect(ufs.subsamples).toBe(4);
    expect(ufs.observations).toBe(8);
    expect(ufs.uSampling).toBeGreaterThan(ufs.uAnalytical);
    expect(ufs.pctSampling + ufs.pctAnalytical).toBeCloseTo(100, 4);
    expect(ufs.items).toHaveLength(2);
  });

  it('calcula ζ-score e z\'-score e expõe |En| no módulo de exatidão com MRC', () => {
    const zeta = zetaScore(10.5, 10.0, 0.2, 0.15);
    expect(zeta.score).toBeCloseTo(2.0, 6);
    expect(zeta.satisfactory).toBe(true);

    const zp = zPrimeScore(10.6, 10.0, 0.2, 0.15);
    expect(zp.score).toBeCloseTo(2.4, 6);
    expect(zp.satisfactory).toBe(false);
    expect(zp.questionable).toBe(true);

    const mrcData: Measurement[] = [10.05, 10.08, 10.04, 10.06].map((v, i) => ({
      id: `mrc-${i}`,
      validationId: 'v-mrc',
      runOrder: i + 1,
      level: '10',
      analyst: 'Ana',
      day: 'D1',
      equipment: 'ICP-OES',
      lot: 'MRC-1',
      sample: `S-${i}`,
      replicate: i + 1,
      value: v,
      refValue: 10.0,
      refUncertainty: 0.2,
      textValue: '',
      notes: '',
    }));
    const params: ValidationParameter[] = [
      { validationId: 'v-mrc', key: 'accuracy', selected: true, justification: '', criteria: [] },
    ];
    const res = analyzeValidation(params, mrcData, []);
    const acc = res.parameters.find((p) => p.key === 'accuracy')!;
    expect(acc.rawMetrics.en).not.toBeNull();
    expect(acc.rawMetrics.en!).toBeLessThanOrEqual(1);
    expect(acc.tables.some((t) => t.title.includes('Eurachem PT'))).toBe(true);
  });

  it('calcula LD/LQ com correção de rotina s0\' (Blanks 2025) e Efeito Matriz entre curvas', () => {
    const blanks = [0.02, 0.03, 0.01, 0.04, 0.02, 0.03, 0.02, 0.01, 0.03, 0.02];
    const eb = lodLoqEurachemBlanks(blanks, {
      routineSampleReplicates: 1,
      routineBlankReplicates: 1,
      blankCorrected: true,
    });
    expect(eb.correctionFactor).toBeCloseTo(Math.SQRT2, 6);
    expect(eb.s0Prime).toBeCloseTo(eb.blankSd * Math.SQRT2, 6);
    expect(eb.lodCorrected).toBeCloseTo(eb.tCrit * eb.s0Prime, 6);
    expect(eb.loqCorrected).toBeCloseTo(10 * eb.s0Prime, 6);

    const solv = [
      { x: 1, y: 10 },
      { x: 5, y: 50 },
      { x: 10, y: 100 },
      { x: 20, y: 200 },
    ];
    const mat = [
      { x: 1, y: 7.9 },
      { x: 5, y: 40.1 },
      { x: 10, y: 80.2 },
      { x: 20, y: 159.8 },
    ];
    const me = computeMatrixEffectCurves(solv, mat);
    expect(me).not.toBeNull();
    expect(me!.matrixEffectPct).toBeCloseTo(-20, 0);
    expect(me!.significant).toBe(true);
    expect(me!.pValue).toBeLessThan(0.001);
  });

  it('calcula Incerteza-Alvo (U^tg e Horwitz) e Desempenho Diagnóstico Qualitativo (Se, Sp, LR+, LR−, VPP/VPN)', () => {
    const tg = computeTargetUncertainty({
      lsl: 95,
      usl: 105,
      massFraction: 0.01,
      coverageFactor: 2,
      currentExpandedUncertainty: 1.1,
    });
    expect(tg.tolerance).toBe(10);
    expect(tg.expandedTargetSpecModerate).toBeCloseTo(2.5, 6);
    expect(tg.expandedTargetSpecStrict).toBeCloseTo(1.25, 6);
    expect(tg.horwitzSigma).toBeGreaterThan(0);
    expect(tg.meetsModerateSpec).toBe(true);
    expect(tg.meetsStrictSpec).toBe(true);

    const diag = computeQualitativeDiagnosticMetrics(45, 5, 5, 45, 0.2, 0.95);
    expect(diag.sensitivity).toBeCloseTo(0.9, 6);
    expect(diag.specificity).toBeCloseTo(0.9, 6);
    expect(diag.lrPositive).toBeCloseTo(9.0, 4);
    expect(diag.lrNegative).toBeCloseTo(1 / 9, 4);
    expect(diag.youdenJ).toBeCloseTo(0.8, 6);
    expect(diag.sensitivityCi![0]).toBeLessThan(0.9);
    expect(diag.sensitivityCi![1]).toBeGreaterThan(0.9);
    // PPV com prevalência = 0.20, Se = 0.9, Sp = 0.9 => (0.18)/(0.18 + 0.08) = 0.6923
    expect(diag.ppv).toBeCloseTo(0.18 / 0.26, 4);
  });

  it('calcula valores críticos exatos de Mandel h e k (ISO 5725-2) e classifica 5%/1%', () => {
    // Valores tabelados da ISO 5725-2 (Tabelas B.1 e B.2):
    // p = 6: h_crit(5%) = 1,6563 (~1,66), h_crit(1%) = 1,8722 (~1,87)
    expect(mandelHCritical(6, 0.05)).toBeCloseTo(1.656262, 4);
    expect(mandelHCritical(6, 0.01)).toBeCloseTo(1.872207, 4);
    // p = 10: h_crit(5%) = 1,7984 (~1,80), h_crit(1%) = 2,1761 (~2,18)
    expect(mandelHCritical(10, 0.05)).toBeCloseTo(1.798412, 4);
    expect(mandelHCritical(10, 0.01)).toBeCloseTo(2.176071, 4);

    // k_crit(p = 6, n = 2): F_{0.95;1,5} = 6,607891 -> 1,848121 (~1,85); F_{0.99;1,5} = 16,25818 -> 2,14217 (~2,14)
    expect(mandelKCritical(6, 2, 0.05)).toBeCloseTo(Math.sqrt((6 * 6.607891) / (5 + 6.607891)), 5);
    expect(mandelKCritical(6, 2, 0.01)).toBeCloseTo(Math.sqrt((6 * 16.25818) / (5 + 16.25818)), 4);
    // k_crit(p = 6, n = 3): F_{0.95;2,10} = 4,102821 -> 1,64449; F_{0.99;2,10} = 7,559433 -> 1,90035
    expect(mandelKCritical(6, 3, 0.05)).toBeCloseTo(1.64449, 4);
    expect(mandelKCritical(6, 3, 0.01)).toBeCloseTo(1.90035, 4);

    expect(() => mandelHCritical(2, 0.05)).toThrow();
    expect(() => mandelKCritical(2, 1, 0.05)).toThrow();

    // Estudo p = 6, n = 3: L6 tem média aberrante (h = 5/√6 ≈ 2,0412 > 1,8722);
    // variando L5 para ficar entre 5% e 1% em k (straggler: s_5 = 0,22 vs s_demais = 0,10 -> k ≈ 1,7179).
    const rows = [
      ...[9.9, 10.0, 10.1].map((v, r) => ({ lab: 'L1', level: '10', replicate: r + 1, value: v })),
      ...[9.9, 10.0, 10.1].map((v, r) => ({ lab: 'L2', level: '10', replicate: r + 1, value: v })),
      ...[9.9, 10.0, 10.1].map((v, r) => ({ lab: 'L3', level: '10', replicate: r + 1, value: v })),
      ...[9.9, 10.0, 10.1].map((v, r) => ({ lab: 'L4', level: '10', replicate: r + 1, value: v })),
      ...[9.78, 10.0, 10.22].map((v, r) => ({ lab: 'L5', level: '10', replicate: r + 1, value: v })),
      ...[10.9, 11.0, 11.1].map((v, r) => ({ lab: 'L6', level: '10', replicate: r + 1, value: v })),
    ];
    const iso = iso5725Analysis(rows);
    const mandel = evaluateMandelConsistency(iso);
    const l6 = mandel.levels[0].labs.find((l) => l.lab === 'L6')!;
    const l5 = mandel.levels[0].labs.find((l) => l.lab === 'L5')!;
    expect(l6.h).toBeCloseTo(5 / Math.sqrt(6), 6);
    expect(l6.hStatus).toBe('outlier');
    expect(iso.levels[0].labMeans.find((l) => l.lab === 'L6')!.hFlag).toBe(true);
    expect(l5.k).toBeCloseTo(0.22 / Math.sqrt((5 * 0.01 + 0.22 * 0.22) / 6), 6);
    expect(l5.kStatus).toBe('straggler');
    expect(iso.levels[0].labMeans.find((l) => l.lab === 'L5')!.kFlag).toBe(false);
  });

  it('trata ν_i = ∞ para fontes Tipo B (GUM §G.4.2) e propagação correlacionada r(x_i, x_j) (§5.2)', () => {
    // Caso 1: Tipo A com ν_A = 9 (u = 0,4) + Tipo B com dof: null (u = 0,3 -> ν_B = ∞)
    // u_c = 0,5; ν_eff = 0,5^4 / (0,4^4 / 9 + 0) = 21,97265625
    const infB = computeUncertainty([
      { id: 'rep', source: 'Repetibilidade', type: 'A', distribution: 'normal', value: 0.4, dof: 9 },
      {
        id: 'res',
        source: 'Resolução',
        type: 'B',
        distribution: 'rectangular',
        value: 0.3 * Math.sqrt(3),
        dof: null,
      },
    ]);
    expect(infB.combined).toBeCloseTo(0.5, 9);
    expect(infB.effectiveDof).toBeCloseTo(21.97265625, 8);

    // Somente Tipo B com dof: Infinity -> ν_eff efetivo 1e6 (normal, k ≈ 1,96)
    const onlyB = computeUncertainty([
      { source: 'Certificado', type: 'B', distribution: 'normal', value: 0.3, divisor: 1, dof: Infinity },
      { source: 'Resolução', type: 'B', distribution: 'rectangular', value: 0.4 * Math.sqrt(3), dof: null },
    ]);
    expect(onlyB.combined).toBeCloseTo(0.5, 9);
    expect(onlyB.effectiveDof).toBe(1e6);
    expect(onlyB.coverageFactor).toBeCloseTo(1.96, 2);

    // Caso 2: correlação r = +1, r = -1 e sensibilidade de sinal oposto (y = x1 - x2)
    const baseItems = [
      { id: 'x1', source: 'X1', type: 'B' as const, distribution: 'normal' as const, value: 0.3, sensitivity: 1, dof: null },
      { id: 'x2', source: 'X2', type: 'B' as const, distribution: 'normal' as const, value: 0.4, sensitivity: 1, dof: null },
    ];
    const corrPos = computeUncertainty(baseItems, 0.95, [{ sourceA: 'x1', sourceB: 'x2', correlation: 1 }]);
    expect(corrPos.combined).toBeCloseTo(0.7, 9);
    expect(corrPos.covarianceTerm).toBeCloseTo(0.24, 9);

    const corrNeg = computeUncertainty(baseItems, 0.95, [{ sourceA: 'x1', sourceB: 'x2', correlation: -1 }]);
    expect(corrNeg.combined).toBeCloseTo(0.1, 9);
    expect(corrNeg.covarianceTerm).toBeCloseTo(-0.24, 9);

    const corrHalf = computeUncertainty(baseItems, 0.95, [{ sourceA: 'x1', sourceB: 'x2', correlation: 0.5 }]);
    expect(corrHalf.combined).toBeCloseTo(Math.sqrt(0.37), 9);

    // Diferença y = x1 - x2 com r = +1 -> (u1 - u2)²
    const diffItems = [
      { id: 'x1', source: 'X1', type: 'B' as const, distribution: 'normal' as const, value: 0.3, sensitivity: 1, dof: null },
      { id: 'x2', source: 'X2', type: 'B' as const, distribution: 'normal' as const, value: 0.4, sensitivity: -1, dof: null },
    ];
    const corrDiff = computeUncertainty(diffItems, 0.95, [{ sourceA: 'x1', sourceB: 'x2', correlation: 1 }]);
    expect(corrDiff.combined).toBeCloseTo(0.1, 9);

    expect(() =>
      computeUncertainty(baseItems, 0.95, [{ sourceA: 'x1', sourceB: 'x2', correlation: 1.2 }]),
    ).toThrow();
    expect(() =>
      computeUncertainty(
        [
          { id: 'a', source: 'A', type: 'B', distribution: 'normal', value: 1 },
          { id: 'b', source: 'B', type: 'B', distribution: 'normal', value: 1 },
          { id: 'c', source: 'C', type: 'B', distribution: 'normal', value: 1 },
        ],
        0.95,
        [
          { sourceA: 'a', sourceB: 'b', correlation: -0.8 },
          { sourceA: 'a', sourceB: 'c', correlation: -0.8 },
          { sourceA: 'b', sourceB: 'c', correlation: -0.8 },
        ],
      ),
    ).toThrow();
  });

  it('estima Gage R&R desbalanceado via Henderson Tipo III e REML com invariância à transposição', () => {
    // Em dados balanceados sem interação com todas as variâncias > 0, Tipo III e REML coincidem com ANOVA
    const balanced: GageRRMatrix = [
      [
        [10.0, 10.2, 9.8],
        [11.0, 11.2, 10.8],
      ],
      [
        [14.0, 14.2, 13.8],
        [15.0, 15.2, 14.8],
      ],
      [
        [18.0, 18.2, 17.8],
        [19.0, 19.2, 18.8],
      ],
      [
        [22.0, 22.2, 21.8],
        [23.0, 23.2, 22.8],
      ],
    ];
    const cmpBal = gageRRUnbalancedMethods(
      { y: balanced, tolerance: 20 },
      { model: 'without_interaction' },
    );
    expect(cmpBal.type3Henderson.rawMetrics.variance_repeatability!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_repeatability!,
      8,
    );
    expect(cmpBal.type3Henderson.rawMetrics.variance_operator!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_operator!,
      6,
    );
    expect(cmpBal.type3Henderson.rawMetrics.variance_part!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_part!,
      6,
    );
    // REML em modelo balanceado com variâncias positivas converge para os mesmos componentes ANOVA
    expect(cmpBal.reml.rawMetrics.variance_repeatability!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_repeatability!,
      3,
    );
    expect(cmpBal.reml.rawMetrics.variance_operator!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_operator!,
      3,
    );
    expect(cmpBal.reml.rawMetrics.variance_part!).toBeCloseTo(
      cmpBal.sequentialLs.rawMetrics.variance_part!,
      3,
    );

    // Desbalanceamento severo (células preenchidas com null para réplicas ausentes):
    // checar invariância à transposição Peça <-> Operador em Tipo III e REML
    const unbalanced: GageRRMatrix = [
      [
        [10.0, 10.4, 9.9, 10.1, 10.2],
        [11.3, 11.7, null, null, null],
        [12.1, 12.5, 12.2, null, null],
      ],
      [
        [13.8, 14.1, null, null, null],
        [15.2, 15.6, 15.0, 15.4, null],
        [16.0, 16.3, null, null, null],
      ],
      [
        [17.9, 18.3, 18.0, null, null],
        [19.1, 19.5, null, null, null],
        [20.2, 20.6, 20.1, 20.4, 20.3],
      ],
      [
        [21.7, 22.1, null, null, null],
        [23.0, 23.4, 23.1, null, null],
        [24.2, 24.5, 24.1, null, null],
      ],
    ];
    const transposed: GageRRMatrix = Array.from({ length: 3 }, (_, j) =>
      Array.from({ length: 4 }, (__, i) => [...unbalanced[i][j]]),
    );

    const t3Orig = gageRRAnalysis(
      { y: unbalanced },
      { model: 'without_interaction', unbalancedMethod: 'type3_henderson' },
    );
    const t3Trans = gageRRAnalysis(
      { y: transposed },
      { model: 'without_interaction', unbalancedMethod: 'type3_henderson' },
    );
    expect(t3Orig.rawMetrics.variance_repeatability!).toBeCloseTo(
      t3Trans.rawMetrics.variance_repeatability!,
      9,
    );
    expect(t3Orig.rawMetrics.variance_part!).toBeCloseTo(t3Trans.rawMetrics.variance_operator!, 9);
    expect(t3Orig.rawMetrics.variance_operator!).toBeCloseTo(t3Trans.rawMetrics.variance_part!, 9);

    const remlOrig = gageRRAnalysis(
      { y: unbalanced },
      { model: 'without_interaction', unbalancedMethod: 'reml' },
    );
    const remlTrans = gageRRAnalysis(
      { y: transposed },
      { model: 'without_interaction', unbalancedMethod: 'reml' },
    );
    expect(remlOrig.rawMetrics.variance_repeatability!).toBeCloseTo(
      remlTrans.rawMetrics.variance_repeatability!,
      5,
    );
    expect(remlOrig.rawMetrics.variance_part!).toBeCloseTo(remlTrans.rawMetrics.variance_operator!, 4);
    expect(remlOrig.rawMetrics.variance_operator!).toBeCloseTo(remlTrans.rawMetrics.variance_part!, 4);
  });

  it('calcula posterior conjugada Normal–Normal e riscos globais R_C/R_P (JCGM 106 §7 e §9.5)', () => {
    // 1. Posterior conjugada analítica: μ₀ = 10, σ₀ = 2, u_m = 1, x = 13
    //    μ_post = (1*10 + 4*13)/(4 + 1) = 12,4; u_post = 2*1/√5 = 0,894427191
    const conj = computeBayesianConformityRisks({
      lsl: null,
      usl: 14,
      priorMean: 10,
      priorStd: 2,
      standardUncertainty: 1,
      measuredValue: 13,
    });
    expect(conj.posteriorMean).toBeCloseTo(12.4, 10);
    expect(conj.posteriorStd).toBeCloseTo(2 / Math.sqrt(5), 10);

    // 2. Benchmark exato de Sheppard: USL = μ₀ = 10, σ₀ = 2, u_m = 2, w = 0
    //    ρ = 1/√2 -> R_C = R_P = arccos(1/√2)/(2π) = 0,125; P(X ≤ 10) = 0,5 -> R_C* = 0,25
    const bench = computeBayesianConformityRisks({
      lsl: null,
      usl: 10,
      priorMean: 10,
      priorStd: 2,
      standardUncertainty: 2,
      guardBand: 0,
    });
    expect(bench.acceptanceProbability).toBeCloseTo(0.5, 7);
    expect(bench.globalConsumerRisk).toBeCloseTo(0.125, 7);
    expect(bench.globalProducerRisk).toBeCloseTo(0.125, 7);
    expect(bench.conditionalConsumerRisk).toBeCloseTo(0.25, 7);
    expect(bench.conditionalProducerRisk).toBeCloseTo(0.25, 7);

    // Banda de guarda w = 1 reduz R_C e eleva R_P
    const guarded = computeBayesianConformityRisks({
      lsl: null,
      usl: 10,
      priorMean: 10,
      priorStd: 2,
      standardUncertainty: 2,
      guardBand: 1,
    });
    expect(guarded.globalConsumerRisk).toBeLessThan(bench.globalConsumerRisk);
    expect(guarded.globalProducerRisk).toBeGreaterThan(bench.globalProducerRisk);

    // Integração em conformityDecision: preserva comportamento padrão sem prior e preenche bayesianRisks com prior
    const plain = conformityDecision({ value: 13, standardUncertainty: 1, usl: 14 });
    expect(plain.bayesianRisks).toBeUndefined();

    const withPrior = conformityDecision({
      value: 13,
      standardUncertainty: 1,
      usl: 14,
      priorMean: 10,
      priorStd: 2,
      rule: 'guard_band',
      guardBandFactor: 0.5,
    });
    expect(withPrior.bayesianRisks).toBeDefined();
    expect(withPrior.bayesianRisks!.posteriorMean).toBeCloseTo(12.4, 10);
    expect(withPrior.rawMetrics.bayesian_global_consumer_risk).toBeCloseTo(
      withPrior.bayesianRisks!.globalConsumerRisk,
      10,
    );
  });

  describe('Pacotes Gráficos Especializados: Histograma, Q-Q Plot, Mandel e Conformidade', () => {
    it('calcula histograma com curva normal sobreposta e preserva contagem total n', () => {
      const data = [
        10.1, 10.2, 9.9, 10.0, 10.3, 9.8, 10.0, 10.1, 9.9, 10.0,
        10.2, 9.7, 10.4, 10.0, 10.1, 9.9, 10.2, 10.0, 9.8, 10.1,
      ];
      const hist = computeHistogramWithNormalCurve(data);

      expect(hist.n).toBe(20);
      expect(hist.mean).toBeCloseTo(10.04, 2);
      expect(hist.sd).toBeGreaterThan(0);
      expect(hist.binWidth).toBeGreaterThan(0);
      expect(hist.bins.length).toBeGreaterThanOrEqual(4);

      // Soma de frequências dos bins deve ser exatamente n
      const totalCount = hist.bins.reduce((acc, b) => acc + b.count, 0);
      expect(totalCount).toBe(20);

      // Bins têm densidade e contagem esperada teórica
      for (const b of hist.bins) {
        expect(Number.isFinite(b.binMid)).toBe(true);
        expect(b.count).toBeGreaterThanOrEqual(0);
        expect(b.normalPdf).toBeGreaterThanOrEqual(0);
        expect(b.expectedCount).toBeGreaterThanOrEqual(0);
      }

      // Chart structure
      const chart = buildHistogramChart(data, 'Teste de Histograma');
      expect(chart.kind).toBe('histogram');
      expect(chart.data.length).toBe(hist.bins.length);
      expect(chart.meta?.mean).toBeCloseTo(hist.mean, 5);
    });

    it('calcula Gráfico de Probabilidade Normal (Q-Q) com posições de Blom e bandas de 95%', () => {
      const data = [1.2, 2.5, 3.1, 4.0, 4.8, 5.2, 6.1, 7.3, 8.0, 15.0];
      const outlierSet = new Set([9]); // índice do 15.0
      const qq = computeNormalProbabilityPlot(data);

      expect(qq.n).toBe(10);
      expect(qq.points.length).toBe(10);
      expect(qq.slope).toBeCloseTo(qq.sd, 10);
      expect(qq.intercept).toBeCloseTo(qq.mean, 10);

      // Blom plotting positions: p_1 = (1 - 0.375)/(10 + 0.25) = 0.625/10.25 ≈ 0.0609756
      expect(qq.points[0].percentile / 100).toBeCloseTo(0.625 / 10.25, 5);
      expect(qq.points[9].percentile / 100).toBeCloseTo(9.625 / 10.25, 5);

      // Theoretical quantiles ordenados monotonicamente
      for (let i = 1; i < qq.points.length; i++) {
        expect(qq.points[i].zTheoretical).toBeGreaterThan(qq.points[i - 1].zTheoretical);
      }

      // Bandas de 95%: lowerBand < expected < upperBand
      for (const pt of qq.points) {
        expect(pt.lowerBand).toBeLessThan(pt.expected);
        expect(pt.upperBand).toBeGreaterThan(pt.expected);
      }

      // Chart structure com destaque de outliers
      const chart = buildNormalProbabilityChart(data, 'Teste Q-Q', outlierSet);
      expect(chart.kind).toBe('qq');
      expect(chart.data.length).toBe(10);
      expect(chart.meta?.intercept).toBeCloseTo(qq.mean, 5);
      const outlierPt = chart.data.find((p) => p.outlier === true);
      expect(outlierPt).toBeDefined();
    });

    it('gera gráficos de consistência Mandel h e k a partir de ISO 5725-2', () => {
      // 3 laboratórios, 2 réplicas cada
      const measurements: Iso5725Row[] = [
        { level: 'N1', lab: 'Lab A', replicate: 1, value: 10.0 },
        { level: 'N1', lab: 'Lab A', replicate: 2, value: 10.2 },
        { level: 'N1', lab: 'Lab B', replicate: 1, value: 9.8 },
        { level: 'N1', lab: 'Lab B', replicate: 2, value: 9.9 },
        { level: 'N1', lab: 'Lab C', replicate: 1, value: 12.0 },
        { level: 'N1', lab: 'Lab C', replicate: 2, value: 12.2 },
      ];
      const iso = iso5725Analysis(measurements);
      const charts = buildMandelCharts(iso);

      expect(charts.hChart).not.toBeNull();
      expect(charts.kChart).not.toBeNull();
      expect(charts.hChart!.kind).toBe('mandel');
      expect(charts.kChart!.kind).toBe('mandel');
      expect(charts.hChart!.data.length).toBe(3); // 3 labs
      expect(charts.kChart!.data.length).toBe(3);
      expect(charts.hChart!.meta?.crit05).toBeDefined();
      expect(charts.hChart!.meta?.crit01).toBeDefined();
    });

    it('gera grid de densidade para curva de conformidade JCGM 106 com cobertura integral', () => {
      const conf = conformityDecision({
        value: 100,
        standardUncertainty: 2,
        coverageFactor: 2,
        lsl: 95,
        usl: 105,
        priorMean: 99,
        priorStd: 3,
      });

      const density = buildConformityDensityData(conf, 100);
      expect(density.length).toBeGreaterThanOrEqual(100);
      expect(density[0].x).toBeLessThan(100 - 3 * 2);
      expect(density[density.length - 1].x).toBeGreaterThan(100 + 3 * 2);

      // Todos os pontos da curva devem ser finitos e positivos
      for (const pt of density) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(pt.density).toBeGreaterThanOrEqual(0);
        if (pt.postDensity !== undefined) {
          expect(pt.postDensity).toBeGreaterThanOrEqual(0);
        }
      }

      // Área sob a curva normalizada deve aproximar ~1
      const step = (density[density.length - 1].x - density[0].x) / (density.length - 1);
      const sumDensity = density.reduce((acc, pt) => acc + pt.density, 0) * step;
      expect(sumDensity).toBeCloseTo(1.0, 1);
    });
  });
});
