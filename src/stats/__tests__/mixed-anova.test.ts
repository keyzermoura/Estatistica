import { describe, expect, it } from 'vitest';
import {
  mixedNestedCrossedAnova,
  type MixedAnovaObservation,
} from '../mixedAnova';
import {
  dimensionalRepeatabilityAnalysis,
  dimensionalReproducibilityAnalysis,
  dimensionalUncertaintyBudget,
} from '../parameters/dimensional';
import { DIMENSIONAL_PROFILE } from '../../profiles/dimensional';
import { computeUncertainty } from '../uncertainty';
import type { AnalysisContext } from '../analysis-types';
import type { Measurement } from '../../lib/types';

/**
 * Gerador de dados determinísticos balanceados para teste:
 * 2 fabricantes × 6 agulhas/fab × 3 analistas × 2 dias × 6 réplicas = 432 observações.
 */
function generateSyntheticDataset(options?: {
  outlierIndex?: number;
  outlierShift?: number;
  analyst3HeteroScale?: number;
}): MixedAnovaObservation[] {
  const manufacturers = ['Fab-A', 'Fab-B'];
  const needlesPerMfg = 6;
  const analysts = ['Op-1', 'Op-2', 'Op-3'];
  const days = ['Dia-1', 'Dia-2'];
  const replicates = 6;

  const obs: MixedAnovaObservation[] = [];
  let index = 0;

  // Efeitos sintéticos conhecidos
  const mfgEffects: Record<string, number> = { 'Fab-A': 0.6, 'Fab-B': -0.6 };
  const analystEffects: Record<string, number> = { 'Op-1': -0.15, 'Op-2': 0.05, 'Op-3': 0.10 };
  const dayEffects: Record<string, number> = { 'Dia-1': 0.08, 'Dia-2': -0.08 };

  for (const mfg of manufacturers) {
    for (let a = 1; a <= needlesPerMfg; a++) {
      const needle = `${mfg}-N${a}`;
      const needleEffect = ((a - 3.5) / 2.5) * 0.12;

      for (const op of analysts) {
        for (const day of days) {
          // Componentes de interação controlados
          const mfgOpEffect = mfg === 'Fab-A' && op === 'Op-1' ? 0.04 : 0;
          const opDayEffect = op === 'Op-1' && day === 'Dia-1' ? 0.05 : 0;

          for (let rep = 1; rep <= replicates; rep++) {
            index++;
            // Pseudorrandomização determinística baseada no índice
            const pseudoNoise = Math.sin(index * 1.7) * 0.02 + Math.cos(index * 0.9) * 0.01;
            let noise = pseudoNoise;

            if (options?.analyst3HeteroScale && op === 'Op-3') {
              noise *= options.analyst3HeteroScale;
            }

            let value =
              25.0 +
              mfgEffects[mfg] +
              needleEffect +
              analystEffects[op] +
              dayEffects[day] +
              mfgOpEffect +
              opDayEffect +
              noise;

            if (options?.outlierIndex === index && options.outlierShift) {
              value += options.outlierShift;
            }

            obs.push({
              manufacturer: mfg,
              needle,
              analyst: op,
              day,
              replicate: rep,
              value,
              runOrder: index,
            });
          }
        }
      }
    }
  }

  return obs;
}

describe('Módulo de ANOVA Mista Aninhada-Cruzada (Tarefa B)', () => {
  it('decompõe exatamente os 431 graus de liberdade e particiona perfeitamente a SQ total', () => {
    const data = generateSyntheticDataset();
    expect(data.length).toBe(432);

    const result = mixedNestedCrossedAnova(data);

    expect(result.nTotal).toBe(432);
    expect(result.factors.manufacturers).toEqual(['Fab-A', 'Fab-B']);
    expect(result.factors.needlesPerManufacturer).toBe(6);
    expect(result.factors.totalNeedles).toBe(12);
    expect(result.factors.analysts).toHaveLength(3);
    expect(result.factors.days).toHaveLength(2);
    expect(result.factors.replicates).toBe(6);

    // Mapeamento dos GL esperados por fonte
    const expectedDfs: Record<string, number> = {
      F: 1, // 2 - 1
      AF: 10, // 2 * (6 - 1)
      O: 2, // 3 - 1
      D: 1, // 2 - 1
      FO: 2, // 1 * 2
      FD: 1, // 1 * 1
      OD: 2, // 2 * 1
      OAF: 20, // 2 * 5 * 2
      DAF: 10, // 2 * 5 * 1
      FOD: 2, // 1 * 2 * 1
      ODAF: 20, // 2 * 5 * 2 * 1
      E: 360, // 2 * 6 * 3 * 2 * (6 - 1) = 72 * 5 = 360
    };

    let sumDf = 0;
    let sumSs = 0;

    for (const row of result.table) {
      expect(expectedDfs[row.sourceKey]).toBeDefined();
      expect(row.df).toBe(expectedDfs[row.sourceKey]);
      sumDf += row.df;
      sumSs += row.ss;
      // MS = SS / DF
      expect(row.ms).toBeCloseTo(row.ss / row.df, 9);
    }

    // Soma exata dos GL = 431
    expect(sumDf).toBe(431);

    // SQ Total
    const values = data.map((d) => d.value);
    const grandMean = values.reduce((acc, v) => acc + v, 0) / values.length;
    const ssTotalExpected = values.reduce((acc, v) => acc + (v - grandMean) ** 2, 0);

    expect(sumSs).toBeCloseTo(ssTotalExpected, 7);
  });

  it('calcula esperanças de quadrados médios E[QM] e resolve o sistema linear de componentes', () => {
    const data = generateSyntheticDataset();
    const result = mixedNestedCrossedAnova(data);

    // Componentes de variância reportados (11 componentes aleatórios / interação)
    expect(result.components).toHaveLength(11);
    const repComp = result.components.find((c) => c.key === 'repeatability');
    expect(repComp).toBeDefined();
    expect(repComp!.standardDeviation).toBeGreaterThan(0);
    expect(repComp!.df).toBe(360);

    const operComp = result.components.find((c) => c.key === 'analyst');
    expect(operComp).toBeDefined();
    expect(operComp!.standardDeviation).toBeGreaterThan(0);

    const dayComp = result.components.find((c) => c.key === 'day');
    expect(dayComp).toBeDefined();
    expect(dayComp!.standardDeviation).toBeGreaterThan(0);

    // Orçamento exposto
    expect(result.budget.repeatability.df).toBe(360);
    expect(result.budget.repeatability.sd).toBe(repComp!.standardDeviation);
    expect(result.budget.analyst.df).toBeGreaterThan(0);
    expect(result.budget.day.df).toBeGreaterThan(0);
    expect(result.budget.intermediatePrecision.df).toBeGreaterThan(0);

    // Percentuais somam 100%
    const sumPct = result.components.reduce((acc, c) => acc + c.percentContribution, 0);
    expect(sumPct).toBeCloseTo(100, 2);
  });

  it('calcula testes F sintetizados com graus de liberdade de Satterthwaite', () => {
    const data = generateSyntheticDataset();
    const result = mixedNestedCrossedAnova(data);

    // Efeito de Fabricante (fixo) tem teste F sintetizado com denominador composto
    const fRow = result.table.find((r) => r.sourceKey === 'F');
    expect(fRow).toBeDefined();
    expect(typeof fRow!.f).toBe('number');
    expect(fRow!.f).toBeGreaterThan(0);
    expect(fRow!.p).not.toBeNull();
    expect(fRow!.p!).toBeLessThanOrEqual(1);
    expect(fRow!.p!).toBeGreaterThanOrEqual(0);
    expect(fRow!.denominatorDf).not.toBeNull();
    expect(fRow!.denominatorDf!).toBeGreaterThan(0);

    // Efeito de Analista (aleatório)
    const oRow = result.table.find((r) => r.sourceKey === 'O');
    expect(oRow).toBeDefined();
    expect(typeof oRow!.f).toBe('number');
    expect(oRow!.f).toBeGreaterThan(0);
    expect(oRow!.denominatorDf).not.toBeNull();

    // Efeito de Dia (aleatório)
    const dRow = result.table.find((r) => r.sourceKey === 'D');
    expect(dRow).toBeDefined();
    expect(typeof dRow!.f).toBe('number');
    expect(dRow!.f).toBeGreaterThan(0);
    expect(dRow!.denominatorDf).not.toBeNull();
  });

  it('detecta outliers por resíduos estudentizados com correção de Bonferroni sem exclusão automática', () => {
    // Injeta um desvio aberrante de +0.5 (~25x o erro residual) na observação 120
    const outlierIndex = 120;
    const data = generateSyntheticDataset({
      outlierIndex,
      outlierShift: 0.5,
    });

    const result = mixedNestedCrossedAnova(data);

    expect(result.outliers.flagged.length).toBeGreaterThanOrEqual(1);
    const detected = result.outliers.flagged.find((o) => o.index === outlierIndex - 1);
    expect(detected).toBeDefined();
    expect(detected!.isOutlier).toBe(true);
    expect(Math.abs(detected!.studentizedResidual)).toBeGreaterThan(3.5);
    expect(detected!.pValue).toBeLessThan(0.05);

    // O dataset não deve ter observações deletadas
    expect(result.nTotal).toBe(432);
    expect(result.warnings.some((w) => w.includes('sinalizada') || w.includes('outlier'))).toBe(true);
  });

  it('executa teste de sensibilidade de heterocedasticidade de Bartlett e Welch-ANOVA', () => {
    // Injeta variância 5x maior no operador 3
    const data = generateSyntheticDataset({ analyst3HeteroScale: 5 });
    const result = mixedNestedCrossedAnova(data);

    expect(result.sensitivity.bartlettStatistic).not.toBeNull();
    expect(result.sensitivity.bartlettP).not.toBeNull();
    expect(result.sensitivity.isHeteroscedastic).toBe(true);
    expect(result.sensitivity.welchF).not.toBeNull();
    expect(result.sensitivity.welchDf1).not.toBeNull();
    expect(result.sensitivity.welchDf2).not.toBeNull();
    expect(result.sensitivity.welchP).not.toBeNull();
    expect(result.warnings.some((w) => w.includes('heterocedásticas') || w.includes('heterogêneas'))).toBe(true);
  });

  it('rejeita estritamente desenhos desbalanceados com mensagem clara de erro', () => {
    const data = generateSyntheticDataset();
    // Remove 1 medição para desbalancear (431 em vez de 432)
    const unbalanced = data.slice(0, 431);

    expect(() => mixedNestedCrossedAnova(unbalanced)).toThrowError(/Delineamento desbalanceado/i);
  });

  it('propaga graus de liberdade de Satterthwaite para repetibilidade, reprodutibilidade e orçamento GUM', () => {
    const rawData = generateSyntheticDataset();

    // Converte para measurements da aplicação
    const measurements: Measurement[] = rawData.map((d, i) => ({
      id: `m-${i + 1}`,
      validationId: 'val-mixed',
      value: d.value,
      partId: d.needle,
      analyst: d.analyst,
      day: d.day,
      manufacturer: d.manufacturer,
      replicate: d.replicate,
      runOrder: d.runOrder,
      timestamp: new Date().toISOString(),
    }));

    const repParamDef = DIMENSIONAL_PROFILE.parameters.find((p) => p.key === 'repeatability')!;
    const reproParamDef = DIMENSIONAL_PROFILE.parameters.find((p) => p.key === 'reproducibility')!;

    const context: AnalysisContext = {
      all: measurements,
      used: measurements,
      values: measurements.map((m) => m.value!),
      options: { unit: 'mm' },
      uniqueLevels: [1],
      regressionPoints: [],
      regression: null,
      iso5725: null,
      uncertaintyItems: [],
      observedMean: 25.0,
      attributeData: null,
      attributeStudy: null,
      attributeError: null,
    };

    // Análise de repetibilidade
    const repAnalysis = dimensionalRepeatabilityAnalysis({
      parameter: repParamDef,
      criteria: [],
      context,
    });

    expect(repAnalysis.rawMetrics.df_rep).toBe(360);
    expect(repAnalysis.rawMetrics.sigma_rep).toBeGreaterThan(0);
    expect(repAnalysis.results?.study).toBe('mixed_anova');
    expect(repAnalysis.tables.length).toBeGreaterThanOrEqual(2);

    // Análise de reprodutibilidade
    const reproAnalysis = dimensionalReproducibilityAnalysis({
      parameter: reproParamDef,
      criteria: [],
      context,
    });

    expect(reproAnalysis.rawMetrics.df_oper).toBeGreaterThan(0);
    expect(reproAnalysis.rawMetrics.sigma_oper).toBeGreaterThan(0);
    expect(reproAnalysis.rawMetrics.df_day).toBeGreaterThan(0);
    expect(reproAnalysis.rawMetrics.sigma_day).toBeGreaterThan(0);
    expect(reproAnalysis.rawMetrics.df_ip).toBeGreaterThan(0);
    expect(reproAnalysis.rawMetrics.sigma_ip).toBeGreaterThan(0);
    expect(reproAnalysis.results?.study).toBe('mixed_anova');

    // Orçamento de incerteza dimensional alimentado com os GL de Satterthwaite
    const budgetItems = dimensionalUncertaintyBudget({
      validationId: 'val-mixed',
      resolution: 0.001,
      calibrationUncertainty: 0.002,
      coverageFactor: 2,
      repeatabilitySd: repAnalysis.rawMetrics.sigma_rep,
      repeatabilityDof: repAnalysis.rawMetrics.df_rep,
      reproducibilitySd: reproAnalysis.rawMetrics.sigma_oper,
      reproducibilityDof: reproAnalysis.rawMetrics.df_oper,
      daySd: reproAnalysis.rawMetrics.sigma_day,
      dayDof: reproAnalysis.rawMetrics.df_day,
      referenceUncertainty: 0.002,
    });

    expect(budgetItems.some((i) => i.id === 'dim-repeatability' && i.dof === 360)).toBe(true);
    expect(budgetItems.some((i) => i.id === 'dim-reproducibility' && typeof i.dof === 'number' && i.dof > 0)).toBe(true);
    expect(budgetItems.some((i) => i.id === 'dim-day' && typeof i.dof === 'number' && i.dof > 0)).toBe(true);

    // Execução do GUM com graus de liberdade completos
    const gumResult = computeUncertainty(budgetItems);
    expect(gumResult.dofComplete).not.toBe(false);
    expect(gumResult.effectiveDof).not.toBeNull();
    expect(gumResult.effectiveDof!).toBeGreaterThan(0);
    expect(gumResult.coverageFactor).toBeGreaterThanOrEqual(1.96);
    expect(gumResult.expanded).toBeGreaterThan(0);
  });
});
