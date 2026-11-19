/**
 * Diagnóstico de Estrutura do Delineamento Experimental
 *
 * Analisa a matriz de incidência entre fatores (peça × operador, peça × dia, operador × dia)
 * para identificar se o estudo é cruzado balanceado, cruzado desbalanceado, aninhado,
 * parcialmente cruzado ou desconectado.
 *
 * Evita o erro metodológico de rodar Gage R&R cruzado em estudos aninhados (ex.: peças
 * distintas ensaiadas por dia ou ensaios destrutivos) e orienta a escolha do modelo adequado.
 *
 * Referências:
 *  - Montgomery, D. C. (2020). Design and Analysis of Experiments (10ª ed.), Cap. 14.
 *  - AIAG MSA (2010), 4ª ed.
 *  - ISO 5725-2:2019 e ISO 5725-3:2020.
 *  - Searle, S. R. et al. (1992). Variance Components.
 */

import type { Measurement } from '../lib/types';

export type DesignClassification =
  | 'crossed_balanced'
  | 'crossed_unbalanced'
  | 'nested'
  | 'partially_crossed'
  | 'disconnected'
  | 'insufficient_data';

export type SuggestedModel =
  | 'gage_rr_crossed'
  | 'nested_anova_3level'
  | 'mixed_nested_crossed_4factor'
  | 'unbalanced_gage_rr_type3_reml'
  | 'insufficient_data';

export interface PartCoverage {
  partId: string;
  analysts: string[];
  days: string[];
  totalMeasurements: number;
  isSingleDay: boolean;
  isSingleAnalyst: boolean;
}

export interface FactorIncidence {
  factorA: string;
  factorB: string;
  levelsA: string[];
  levelsB: string[];
  /** cellCounts[levelA][levelB] = contagem de medições */
  cellCounts: Record<string, Record<string, number>>;
  emptyCells: number;
  totalCells: number;
  minReplicates: number;
  maxReplicates: number;
  connectedComponents: string[][];
  isConnected: boolean;
}

export interface NestedHierarchy {
  nestedFactor: 'part';
  parentFactor: 'day' | 'analyst';
  levelsPerParent: Record<string, string[]>;
  isStrictlyNested: boolean;
}

export interface DesignDiagnosis {
  classification: DesignClassification;
  summary: string;
  recommendation: string;
  suggestedModel: SuggestedModel;
  warnings: string[];
  notes: string[];
  partCoverage: PartCoverage[];
  partsCount: number;
  analystsCount: number;
  daysCount: number;
  singleDayPartsCount: number;
  singleAnalystPartsCount: number;
  partAnalystIncidence: FactorIncidence;
  partDayIncidence?: FactorIncidence;
  analystDayIncidence?: FactorIncidence;
  nestedHierarchy?: NestedHierarchy;
  isBalanced: boolean;
  canRunCrossedGageRR: boolean;
  canRunNestedAnova: boolean;
  canRunMixedAnova: boolean;
}

export interface DiagnoseOptions {
  /** Considera apenas medições com valor numérico e sem referência metrológica */
  filterNumeric?: boolean;
}

function computeIncidence(
  data: Array<{ a: string; b: string }>,
  factorA: string,
  factorB: string,
): FactorIncidence {
  const levelsASet = new Set<string>();
  const levelsBSet = new Set<string>();
  const counts: Record<string, Record<string, number>> = {};

  for (const row of data) {
    if (!row.a || !row.b) continue;
    levelsASet.add(row.a);
    levelsBSet.add(row.b);
    counts[row.a] = counts[row.a] ?? {};
    counts[row.a][row.b] = (counts[row.a][row.b] ?? 0) + 1;
  }

  const levelsA = [...levelsASet].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true }));
  const levelsB = [...levelsBSet].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true }));

  let emptyCells = 0;
  let minR = Infinity;
  let maxR = 0;

  for (const a of levelsA) {
    counts[a] = counts[a] ?? {};
    for (const b of levelsB) {
      const c = counts[a][b] ?? 0;
      if (c === 0) {
        emptyCells++;
      } else {
        if (c < minR) minR = c;
        if (c > maxR) maxR = c;
      }
    }
  }

  if (minR === Infinity) minR = 0;
  const totalCells = levelsA.length * levelsB.length;

  // Grafo bipartido para detecção de componentes conexos
  const adj = new Map<string, Set<string>>();
  for (const a of levelsA) adj.set(`A:${a}`, new Set());
  for (const b of levelsB) adj.set(`B:${b}`, new Set());

  for (const a of levelsA) {
    for (const b of levelsB) {
      if ((counts[a][b] ?? 0) > 0) {
        adj.get(`A:${a}`)!.add(`B:${b}`);
        adj.get(`B:${b}`)!.add(`A:${a}`);
      }
    }
  }

  const visited = new Set<string>();
  const connectedComponents: string[][] = [];

  for (const [node] of adj) {
    if (!visited.has(node)) {
      const comp: string[] = [];
      const queue = [node];
      visited.add(node);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        comp.push(curr);
        for (const neighbor of adj.get(curr) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      connectedComponents.push(comp);
    }
  }

  const isConnected = connectedComponents.length <= 1 && totalCells > 0 && levelsA.length > 0 && levelsB.length > 0;

  return {
    factorA,
    factorB,
    levelsA,
    levelsB,
    cellCounts: counts,
    emptyCells,
    totalCells,
    minReplicates: minR,
    maxReplicates: maxR,
    connectedComponents,
    isConnected,
  };
}

export function diagnoseDesignStructure(
  measurements: Measurement[],
  options?: DiagnoseOptions,
): DesignDiagnosis {
  const warnings: string[] = [];
  const notes: string[] = [];

  // Filtragem de dados válidos
  const valid = measurements.filter((m) => {
    if (m.value === null || !Number.isFinite(m.value)) return false;
    if (m.refValue !== null && m.refValue !== undefined && Number.isFinite(m.refValue)) return false;
    return true;
  });

  const partMap = new Map<string, { analysts: Set<string>; days: Set<string>; count: number }>();

  for (const m of valid) {
    const part = (m.partId ?? '').trim();
    if (!part) continue;
    const analyst = (m.analyst || m.equipment || 'Operador').trim();
    const day = (m.day ?? '').trim();

    const entry = partMap.get(part) ?? { analysts: new Set(), days: new Set(), count: 0 };
    entry.analysts.add(analyst);
    if (day) entry.days.add(day);
    entry.count++;
    partMap.set(part, entry);
  }

  const partCoverage: PartCoverage[] = [...partMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map(([partId, data]) => ({
      partId,
      analysts: [...data.analysts].sort(),
      days: [...data.days].sort(),
      totalMeasurements: data.count,
      isSingleDay: data.days.size === 1,
      isSingleAnalyst: data.analysts.size === 1,
    }));

  const partsCount = partCoverage.length;
  const allAnalysts = new Set<string>();
  const allDays = new Set<string>();
  const allMfgs = new Set<string>();

  for (const m of valid) {
    const analyst = (m.analyst || m.equipment || 'Operador').trim();
    const day = (m.day ?? '').trim();
    const mfg = (m.manufacturer ?? m.lot ?? '').trim();
    if (analyst) allAnalysts.add(analyst);
    if (day) allDays.add(day);
    if (mfg) allMfgs.add(mfg);
  }

  const analystsCount = allAnalysts.size;
  const daysCount = allDays.size;
  const mfgsCount = allMfgs.size;

  const singleDayPartsCount = partCoverage.filter((p) => p.isSingleDay).length;
  const singleAnalystPartsCount = partCoverage.filter((p) => p.isSingleAnalyst).length;

  // Incidências fatoriais
  const partAnalystPairs = valid
    .filter((m) => (m.partId ?? '').trim() !== '')
    .map((m) => ({
      a: (m.partId ?? '').trim(),
      b: (m.analyst || m.equipment || 'Operador').trim(),
    }));

  const partAnalystIncidence = computeIncidence(partAnalystPairs, 'Peça', 'Analista');

  let partDayIncidence: FactorIncidence | undefined;
  if (daysCount >= 2) {
    const partDayPairs = valid
      .filter((m) => (m.partId ?? '').trim() !== '' && (m.day ?? '').trim() !== '')
      .map((m) => ({
        a: (m.partId ?? '').trim(),
        b: (m.day ?? '').trim(),
      }));
    partDayIncidence = computeIncidence(partDayPairs, 'Peça', 'Dia');
  }

  let analystDayIncidence: FactorIncidence | undefined;
  if (daysCount >= 2 && analystsCount >= 2) {
    const analystDayPairs = valid
      .filter((m) => (m.day ?? '').trim() !== '')
      .map((m) => ({
        a: (m.analyst || m.equipment || 'Operador').trim(),
        b: (m.day ?? '').trim(),
      }));
    analystDayIncidence = computeIncidence(analystDayPairs, 'Analista', 'Dia');
  }

  // Avaliação de casos insuficientes
  if (partsCount < 2 || (analystsCount < 2 && daysCount < 2)) {
    return {
      classification: 'insufficient_data',
      summary: `Dados insuficientes para estruturar estudo de repetibilidade e reprodutibilidade (${partsCount} peça(s), ${analystsCount} analista(s), ${daysCount} dia(s)).`,
      recommendation: 'Cadastre pelo menos 2 peças e pelo menos 2 analistas ou 2 dias com medições válidas.',
      suggestedModel: 'insufficient_data',
      warnings: ['Número insuficiente de peças ou fatores para análise de variância.'],
      notes: [],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      isBalanced: false,
      canRunCrossedGageRR: false,
      canRunNestedAnova: false,
      canRunMixedAnova: false,
    };
  }

  // Detecção de Delineamento 4 Fatores Misto (Tarefa B)
  const isCandidateMixed4Factor =
    mfgsCount >= 2 &&
    daysCount >= 2 &&
    analystsCount >= 2 &&
    partsCount >= 4 &&
    partAnalystIncidence.emptyCells === 0 &&
    partDayIncidence !== undefined &&
    partDayIncidence.emptyCells === 0;

  if (isCandidateMixed4Factor) {
    const isBalanced4F =
      partAnalystIncidence.minReplicates === partAnalystIncidence.maxReplicates &&
      partDayIncidence!.minReplicates === partDayIncidence!.maxReplicates;

    return {
      classification: isBalanced4F ? 'crossed_balanced' : 'crossed_unbalanced',
      summary: `Delineamento multifatorial hierárquico-cruzado (${mfgsCount} fabricantes, ${partsCount} peças, ${analystsCount} analistas, ${daysCount} dias).`,
      recommendation:
        'Recomenda-se o modelo de ANOVA Mista Aninhada-Cruzada (Fabricante > Agulha × Analista × Dia) com graus de liberdade por Satterthwaite.',
      suggestedModel: 'mixed_nested_crossed_4factor',
      warnings: isBalanced4F ? [] : ['Delineamento de 4 fatores contém contagens de réplicas desiguais.'],
      notes: ['Estrutura compatível com o módulo de ANOVA Mista de 4 fatores.'],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      isBalanced: isBalanced4F,
      canRunCrossedGageRR: false,
      canRunNestedAnova: false,
      canRunMixedAnova: isBalanced4F,
    };
  }

  // Detecção de Estrutura Aninhada (Dia > Peça ou Analista > Peça)
  // Regra formal: 100% das peças são medidas em um único Dia (ou único Analista)
  let nestedHierarchy: NestedHierarchy | undefined;

  const isNestedInDay =
    daysCount >= 2 &&
    partsCount >= 2 * daysCount &&
    singleDayPartsCount === partsCount &&
    partCoverage.every((p) => p.days.length === 1);

  const isNestedInAnalyst =
    analystsCount >= 2 &&
    partsCount >= 2 * analystsCount &&
    singleAnalystPartsCount === partsCount &&
    partCoverage.every((p) => p.analysts.length === 1);

  if (isNestedInDay) {
    const levelsPerParent: Record<string, string[]> = {};
    for (const p of partCoverage) {
      const d = p.days[0];
      levelsPerParent[d] = levelsPerParent[d] ?? [];
      levelsPerParent[d].push(p.partId);
    }

    nestedHierarchy = {
      nestedFactor: 'part',
      parentFactor: 'day',
      levelsPerParent,
      isStrictlyNested: true,
    };

    const isBalancedNested = Object.values(levelsPerParent).every(
      (parts) => parts.length === Object.values(levelsPerParent)[0].length,
    ) && partAnalystIncidence.minReplicates === partAnalystIncidence.maxReplicates;

    warnings.push(
      `Todas as ${partsCount} peças foram medidas em um único dia (${Object.entries(levelsPerParent)
        .map(([day, parts]) => `${parts.length} no ${day}`)
        .join(', ')}). O delineamento é aninhado (Dia > Peça), não cruzado.`,
    );
    warnings.push(
      'Executar o Gage R&R cruzado padrão neste conjunto gerará uma matriz esparsa desconexa e confundirá a variação entre peças com o erro de medição.',
    );

    return {
      classification: 'nested',
      summary: `Delineamento aninhado detectado: Peças aninhadas em Dias (Dia > Peça > Réplica), com ${partsCount} peças distribuídas em ${daysCount} dias.`,
      recommendation:
        'Recomenda-se a ANOVA aninhada (Dia > Peça > Réplica). No modelo aninhado, a repetibilidade é a variação intra-peça e a reprodutibilidade / precisão intermediária é a variação entre dias; a variação entre peças dentro do dia reflete o produto e não entra no erro do sistema.',
      suggestedModel: 'nested_anova_3level',
      warnings,
      notes: [
        'Modelo aninhado conforme Montgomery (2020), Cap. 14.',
        'O fator Dia é tratado como efeito aleatório com GL de Satterthwaite.',
      ],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      nestedHierarchy,
      isBalanced: isBalancedNested,
      canRunCrossedGageRR: false,
      canRunNestedAnova: true,
      canRunMixedAnova: false,
    };
  }

  if (isNestedInAnalyst) {
    const levelsPerParent: Record<string, string[]> = {};
    for (const p of partCoverage) {
      const op = p.analysts[0];
      levelsPerParent[op] = levelsPerParent[op] ?? [];
      levelsPerParent[op].push(p.partId);
    }

    nestedHierarchy = {
      nestedFactor: 'part',
      parentFactor: 'analyst',
      levelsPerParent,
      isStrictlyNested: true,
    };

    const isBalancedNested = Object.values(levelsPerParent).every(
      (parts) => parts.length === Object.values(levelsPerParent)[0].length,
    ) && partAnalystIncidence.minReplicates === partAnalystIncidence.maxReplicates;

    warnings.push(
      `Todas as ${partsCount} peças foram medidas por um único operador. O delineamento é aninhado (Operador > Peça), típico de ensaios destrutivos.`,
    );

    return {
      classification: 'nested',
      summary: `Delineamento aninhado detectado: Peças aninhadas em Analistas (${analystsCount} analistas, ${partsCount} peças no total).`,
      recommendation:
        'Recomenda-se a ANOVA aninhada (Operador > Peça > Réplica / Amostra), adequada para ensaios destrutivos ou onde peças não podem ser compartilhadas entre operadores.',
      suggestedModel: 'nested_anova_3level',
      warnings,
      notes: ['Modelo aninhado destrutivo conforme AIAG MSA 4ª ed. e ISO 5725-2.'],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      nestedHierarchy,
      isBalanced: isBalancedNested,
      canRunCrossedGageRR: false,
      canRunNestedAnova: true,
      canRunMixedAnova: false,
    };
  }

  // Avaliação de Conectividade do Grafo Peça × Analista
  if (!partAnalystIncidence.isConnected) {
    warnings.push(
      `O desenho é desconectado: existem ${partAnalystIncidence.connectedComponents.length} grupos isolados de peças e analistas sem medições em comum.`,
    );
    warnings.push(
      'Em desenhos desconectados, os operadores não mediram peças em comum, impossibilitando a estimativa não viesada da reprodutibilidade pelo Gage R&R cruzado.',
    );

    return {
      classification: 'disconnected',
      summary: `Delineamento desconectado: ${partAnalystIncidence.connectedComponents.length} componentes conexos identificados.`,
      recommendation:
        'O modelo cruzado não pode ser aplicado porque os operadores não compartilham peças em comum. Verifique o plano de amostragem ou configure um modelo aninhado se as peças foram alocadas a operadores distintos.',
      suggestedModel: 'unbalanced_gage_rr_type3_reml',
      warnings,
      notes: [],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      isBalanced: false,
      canRunCrossedGageRR: false,
      canRunNestedAnova: false,
      canRunMixedAnova: false,
    };
  }

  // Detecção de Parcialmente Cruzado
  // (Algumas peças medidas por múltiplos analistas, outras por apenas 1)
  const someSingleAnalyst = singleAnalystPartsCount > 0 && singleAnalystPartsCount < partsCount;
  const someSingleDay = daysCount >= 2 && singleDayPartsCount > 0 && singleDayPartsCount < partsCount;

  if (someSingleAnalyst || someSingleDay) {
    warnings.push(
      `Delineamento parcialmente cruzado: ${singleAnalystPartsCount} de ${partsCount} peças foram medidas por um único analista${
        daysCount >= 2 ? ` e ${singleDayPartsCount} de ${partsCount} peças em um único dia` : ''
      }.`,
    );

    return {
      classification: 'partially_crossed',
      summary: `Delineamento parcialmente cruzado (${partsCount} peças, ${analystsCount} analistas, ${partAnalystIncidence.emptyCells} células vazias de ${partAnalystIncidence.totalCells}).`,
      recommendation:
        'A estrutura é híbrida ou contém perda severa de dados. Recomenda-se avaliar se peças deveriam ter sido compartilhadas entre todos os analistas/dias ou adotar métodos de Máxima Verossimilhança Restrita (REML).',
      suggestedModel: 'unbalanced_gage_rr_type3_reml',
      warnings,
      notes: ['O modelo cruzado clássico assume que cada peça é medida por todos os analistas.'],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      isBalanced: false,
      canRunCrossedGageRR: false,
      canRunNestedAnova: false,
      canRunMixedAnova: false,
    };
  }

  // Delineamento Cruzado
  const isBalancedCrossed =
    partAnalystIncidence.emptyCells === 0 &&
    partAnalystIncidence.minReplicates === partAnalystIncidence.maxReplicates &&
    partAnalystIncidence.minReplicates >= 2;

  if (isBalancedCrossed) {
    return {
      classification: 'crossed_balanced',
      summary: `Delineamento cruzado balanceado regular: ${partsCount} peças × ${analystsCount} analistas com ${partAnalystIncidence.minReplicates} réplicas por célula (zero células vazias).`,
      recommendation:
        'Recomenda-se o Gage R&R cruzado padrão por ANOVA (AIAG MSA 4ª ed. / ISO 22514-7).',
      suggestedModel: 'gage_rr_crossed',
      warnings: [],
      notes: ['Estrutura ortogonal balanceada completa.'],
      partCoverage,
      partsCount,
      analystsCount,
      daysCount,
      singleDayPartsCount,
      singleAnalystPartsCount,
      partAnalystIncidence,
      partDayIncidence,
      analystDayIncidence,
      isBalanced: true,
      canRunCrossedGageRR: true,
      canRunNestedAnova: false,
      canRunMixedAnova: false,
    };
  }

  // Cruzado desbalanceado (todas as peças têm múltiplos analistas e o grafo é conexo, mas faltam réplicas ou células)
  const isConnectedUnbalanced = partAnalystIncidence.isConnected && partAnalystIncidence.emptyCells > 0;
  warnings.push(
    `Delineamento cruzado desbalanceado: ${partAnalystIncidence.emptyCells} célula(s) vazia(s) de ${partAnalystIncidence.totalCells} totais, ou réplicas desiguais (mínimo ${partAnalystIncidence.minReplicates}, máximo ${partAnalystIncidence.maxReplicates}).`,
  );

  return {
    classification: 'crossed_unbalanced',
    summary: `Delineamento cruzado desbalanceado conectado (${partsCount} peças × ${analystsCount} analistas).`,
    recommendation:
      'Recomenda-se o modelo de Gage R&R desbalanceado utilizando ANOVA Tipo III (Henderson Método 3) ou REML cruzado.',
    suggestedModel: 'unbalanced_gage_rr_type3_reml',
    warnings,
    notes: [
      'Como o grafo é conexo, o contraste entre operadores é estatisticamente identificável via soma de quadrados Tipo III ou REML.',
    ],
    partCoverage,
    partsCount,
    analystsCount,
    daysCount,
    singleDayPartsCount,
    singleAnalystPartsCount,
    partAnalystIncidence,
    partDayIncidence,
    analystDayIncidence,
    isBalanced: false,
    canRunCrossedGageRR: true,
    canRunNestedAnova: false,
    canRunMixedAnova: false,
  };
}
