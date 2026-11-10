/**
 * Módulo 3 — Delineamentos amostrais, mapa de execução e curva de poder.
 *
 * O desenho é sempre balanceado por construção. Quando o usuário impõe um
 * total manual, o número de réplicas é ajustado para cima para preservar o
 * balanceamento; a diferença é registrada como aviso e no relatório.
 */

import {
  DEFAULT_DESIGN_INPUT,
  PARAMETER_LABELS,
  type DesignInput,
  type DesignPlan,
  type DesignType,
  type ParameterPlan,
  type ParamKey,
  type PowerPoint,
  type RunRow,
} from '../lib/types';
import { mulberry32, shuffle } from './distributions';
import {
  iso5725SampleSize,
  meanCIPrecision,
  planForParameter,
  powerTTest,
  powerTOST,
  sampleSizeAnova,
} from './sampleSize';

export interface BuildDesignOptions {
  /** Parâmetros selecionados no checklist. */
  selectedParameters?: ParamKey[];
  /** Momento de criação (permite testes determinísticos). */
  now?: string;
}

const LEVEL_NAMES = ['Baixo', 'Médio', 'Alto', 'Muito alto', 'Extremo'];

function sanitize(input: DesignInput): DesignInput {
  const merged: DesignInput = { ...DEFAULT_DESIGN_INPUT, ...input };
  return {
    ...merged,
    confidence: clamp(merged.confidence, 0.5, 0.999),
    power: clamp(merged.power, 0.5, 0.999),
    alpha: clamp(merged.alpha, 0.001, 0.2),
    beta: clamp(merged.beta, 0.001, 0.5),
    sigma: Math.max(0, merged.sigma),
    effect: Math.max(0, merged.effect),
    margin: Math.max(0, merged.margin),
    targetPrecision: Math.max(0, merged.targetPrecision),
    relativeSdError: clamp(merged.relativeSdError, 0.01, 1),
    varianceRatio: Math.max(1.001, merged.varianceRatio),
    betweenLabRatio: Math.max(0, merged.betweenLabRatio),
    nLevels: int(merged.nLevels, 2, 12),
    nAnalysts: int(merged.nAnalysts, 1, 20),
    nDays: int(merged.nDays, 1, 30),
    nEquipments: int(merged.nEquipments, 1, 10),
    nLots: int(merged.nLots, 1, 30),
    nReplicates: int(merged.nReplicates, 1, 20),
    nLabs: int(merged.nLabs, 3, 50),
    nSamples: int(merged.nSamples, 1, 50),
    factors:
      merged.factors && merged.factors.length >= 2
        ? merged.factors.filter(Boolean).slice(0, 6)
        : DEFAULT_DESIGN_INPUT.factors,
    levels:
      merged.levels && merged.levels.length >= 2
        ? merged.levels.filter(Boolean).slice(0, 12)
        : LEVEL_NAMES.slice(0, Math.max(2, merged.nLevels)),
    seed: Math.abs(Math.round(merged.seed)) || 1,
    manualTotal:
      merged.manualTotal !== null && Number.isFinite(merged.manualTotal)
        ? Math.max(1, Math.round(merged.manualTotal))
        : null,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function int(x: number, lo: number, hi: number): number {
  return Math.round(clamp(x, lo, hi));
}

function makeLevels(input: DesignInput): string[] {
  const count = Math.max(2, input.nLevels);
  const provided = input.levels.filter(Boolean);
  if (provided.length >= count) return provided.slice(0, count);
  return Array.from({ length: count }, (_, i) =>
    provided[i] ?? `Nível ${i + 1}`,
  );
}

function product(values: number[]): number {
  return values.reduce((a, b) => a * b, 1);
}

function makeRows(
  designType: DesignType,
  input: DesignInput,
  reps: number,
): RunRow[] {
  const levels = makeLevels(input);
  const rows: RunRow[] = [];
  const push = (r: Omit<RunRow, 'runOrder'>) => {
    rows.push({ ...r, runOrder: rows.length + 1 });
  };

  if (designType === 'crd') {
    for (const level of levels) {
      for (let r = 1; r <= reps; r++) {
        push({
          level,
          analyst: 'A1',
          day: 'D1',
          equipment: 'E1',
          lot: 'L1',
          sample: `Amostra ${level}`,
          replicate: r,
          combination: `${level} · réplica ${r}`,
          factorValues: { nível: level },
        });
      }
    }
    return rows;
  }

  if (designType === 'rbd') {
    for (let d = 1; d <= input.nDays; d++) {
      for (const level of levels) {
        for (let r = 1; r <= reps; r++) {
          push({
            level,
            analyst: 'A1',
            day: `Dia ${d}`,
            equipment: 'E1',
            lot: 'L1',
            sample: `Amostra ${level}`,
            replicate: r,
            combination: `Dia ${d} · ${level} · réplica ${r}`,
            factorValues: { bloco: `Dia ${d}`, tratamento: level },
          });
        }
      }
    }
    return rows;
  }

  if (designType === 'factorial') {
    const factors = input.factors.slice(0, 6);
    const k = factors.length;
    const combos = 2 ** k;
    for (let c = 0; c < combos; c++) {
      const factorValues: Record<string, string> = {};
      factors.forEach((f, i) => {
        factorValues[f] = (c >> i) & 1 ? 'alto' : 'baixo';
      });
      for (let r = 1; r <= reps; r++) {
        push({
          level: 'Robustez',
          analyst: 'A1',
          day: 'D1',
          equipment: 'E1',
          lot: 'L1',
          sample: 'Amostra de robustez',
          replicate: r,
          combination: `${factors.map((f) => `${f}=${factorValues[f]}`).join(' · ')} · r${r}`,
          factorValues,
        });
      }
    }
    return rows;
  }

  if (designType === 'crossed') {
    for (let a = 1; a <= input.nAnalysts; a++) {
      for (let d = 1; d <= input.nDays; d++) {
        for (let e = 1; e <= input.nEquipments; e++) {
          for (const level of levels) {
            for (let r = 1; r <= reps; r++) {
              push({
                level,
                analyst: `Analista ${a}`,
                day: `Dia ${d}`,
                equipment: `Equip. ${e}`,
                lot: 'Lote 1',
                sample: `Amostra ${level}`,
                replicate: r,
                combination: `A${a} · D${d} · E${e} · ${level} · r${r}`,
                factorValues: {
                  analista: `A${a}`,
                  dia: `D${d}`,
                  equipamento: `E${e}`,
                  nível: level,
                },
              });
            }
          }
        }
      }
    }
    return rows;
  }

  if (designType === 'nested') {
    for (let lot = 1; lot <= input.nLots; lot++) {
      for (let s = 1; s <= input.nSamples; s++) {
        for (let r = 1; r <= reps; r++) {
          push({
            level: `Lote ${lot}`,
            analyst: 'A1',
            day: 'D1',
            equipment: 'E1',
            lot: `Lote ${lot}`,
            sample: `Amostra ${lot}-${s}`,
            replicate: r,
            combination: `Lote ${lot} · Amostra ${s} · r${r}`,
            factorValues: { lote: `Lote ${lot}`, amostra: `Amostra ${s}` },
          });
        }
      }
    }
    return rows;
  }

  // ISO 5725-2: p laboratórios × q níveis × n réplicas
  for (let lab = 1; lab <= input.nLabs; lab++) {
    for (const level of levels) {
      for (let r = 1; r <= reps; r++) {
        push({
          level,
          analyst: `Laboratório ${lab}`,
          day: 'D1',
          equipment: 'E1',
          lot: 'Lote 1',
          sample: `Material ${level}`,
          replicate: r,
          combination: `Lab ${lab} · ${level} · r${r}`,
          factorValues: { laboratorio: `Lab ${lab}`, nível: level },
        });
      }
    }
  }
  return rows;
}

function baseCells(designType: DesignType, input: DesignInput): number {
  const levels = Math.max(2, input.nLevels);
  switch (designType) {
    case 'crd':
      return levels;
    case 'rbd':
      return input.nDays * levels;
    case 'factorial':
      return 2 ** Math.min(6, Math.max(2, input.factors.length));
    case 'crossed':
      return input.nAnalysts * input.nDays * input.nEquipments * levels;
    case 'nested':
      return input.nLots * input.nSamples;
    case 'iso5725':
      return input.nLabs * levels;
    default:
      return levels;
  }
}

/** Monta os planos individuais de tamanho de amostra por parâmetro. */
export function buildParameterPlans(
  input: DesignInput,
  selectedParameters: ParamKey[],
): ParameterPlan[] {
  const keys: ParamKey[] =
    selectedParameters.length > 0
      ? selectedParameters
      : ['repeatability', 'accuracy'];
  return keys.map((key) => {
    const result = planForParameter(key, {
      sigma: input.sigma,
      effect: input.effect,
      margin: input.margin,
      confidence: input.confidence,
      power: input.power,
      alpha: input.alpha,
      relativeSdError: input.relativeSdError,
      varianceRatio: input.varianceRatio,
      betweenLabRatio: input.betweenLabRatio,
      nLevels: input.nLevels,
      nReplicates: input.nReplicates,
      nAnalysts: input.nAnalysts,
      nDays: input.nDays,
      nLabs: input.nLabs,
    });
    return {
      key,
      method: result.method,
      n: result.nPerGroup ?? result.total,
      nPerGroup: result.nPerGroup,
      groups: result.groups,
      total: result.total,
      achievedPower: result.power,
      achievedPrecision: result.precision,
      formula: result.formula,
      reference: result.reference,
      assumptions: result.assumptions,
      notes: result.notes,
    };
  });
}

function recommendTotal(
  input: DesignInput,
  parameterPlans: ParameterPlan[],
): { reps: number; total: number; manualAdjusted: boolean } {
  const maxParamTotal = Math.max(
    1,
    ...parameterPlans.map((p) => (Number.isFinite(p.total) ? p.total : 0)),
  );
  const cells = Math.max(1, baseCells(input.designType, input));
  let reps = Math.max(
    2,
    input.nReplicates,
    Math.ceil(maxParamTotal / cells),
  );
  if (input.designType === 'iso5725') reps = Math.max(2, reps);

  let manualAdjusted = false;
  if (input.manualOverride && input.manualTotal) {
    const targetReps = Math.max(1, Math.ceil(input.manualTotal / cells));
    if (targetReps !== reps) manualAdjusted = true;
    reps = targetReps;
  }
  return { reps, total: cells * reps, manualAdjusted };
}

function buildPowerCurve(
  input: DesignInput,
  total: number,
  selected: ParamKey[],
): PowerPoint[] {
  const maxN = Math.max(20, Math.min(500, total || 20));
  const step = Math.max(1, Math.floor(maxN / 30));
  const useTost = selected.includes('accuracy') && input.margin > 0;
  const points: PowerPoint[] = [];
  for (let n = 3; n <= maxN + step; n += step) {
    const nn = Math.min(n, maxN);
    const power = useTost
      ? powerTOST(nn, input.margin, input.sigma, {
          alpha: input.alpha,
          design: 'one_sample',
        })
      : powerTTest(nn, input.effect, input.sigma, {
          alpha: input.alpha,
          design: 'one_sample',
        });
    points.push({
      n: nn,
      power: Number.isFinite(power) ? power : 0,
      precision: meanCIPrecision(nn, input.sigma, input.confidence),
    });
    if (nn >= maxN) break;
  }
  if (points.length === 0) {
    points.push({ n: 3, power: 0, precision: meanCIPrecision(3, input.sigma, input.confidence) });
  }
  return points;
}

/** Resumo em linguagem simples, adequado a usuários não estatísticos. */
export function explainDesign(plan: DesignPlan): string {
  const r = plan.recommended;
  if (plan.input.designType === 'iso5725') {
    return `Você precisará de ${r.total} medições: ${r.labs} laboratórios × ${r.levels} níveis × ${r.replicates} réplicas.`;
  }
  if (plan.input.designType === 'factorial') {
    return `Você precisará de ${r.total} medições: ${2 ** Math.min(6, plan.input.factors.length)} combinações de fatores × ${r.replicates} réplicas.`;
  }
  if (plan.input.designType === 'nested') {
    return `Você precisará de ${r.total} medições: ${plan.input.nLots} lotes × ${plan.input.nSamples} amostras × ${r.replicates} réplicas.`;
  }
  if (plan.input.designType === 'crd') {
    return `Você precisará de ${r.total} medições: ${r.levels} níveis × ${r.replicates} réplicas.`;
  }
  if (plan.input.designType === 'rbd') {
    return `Você precisará de ${r.total} medições: ${r.days} dias (blocos) × ${r.levels} níveis × ${r.replicates} réplicas.`;
  }
  return `Você precisará de ${r.total} medições: ${r.analysts} analistas × ${r.days} dias × ${r.equipments} equipamento(s) × ${r.levels} níveis × ${r.replicates} réplicas.`;
}

/**
 * Constrói o plano completo do Módulo 3.
 * A ordem dos ensaios é aleatorizada com semente reprodutível.
 */
export function buildDesignPlan(
  rawInput: DesignInput,
  options: BuildDesignOptions = {},
): DesignPlan {
  const input = sanitize(rawInput);
  const selected = options.selectedParameters ?? [];
  const parameterPlans = buildParameterPlans(input, selected);
  const { reps, total, manualAdjusted } = recommendTotal(input, parameterPlans);
  const rows = makeRows(input.designType, input, reps);
  const randomized = shuffle(rows, input.seed).map((row, index) => ({
    ...row,
    runOrder: index + 1,
  }));
  const finalTotal = randomized.length;
  const levels = Math.max(2, input.nLevels);

  const warnings: string[] = [];
  if (input.sigma <= 0) {
    warnings.push(
      'O desvio-padrão esperado (σ) é zero ou inválido. Informe um valor piloto ou use a sugestão baseada na faixa de trabalho.',
    );
  }
  if (input.effect <= 0 && selected.some((k) => ['accuracy', 'repeatability', 'intermediate_precision'].includes(k))) {
    warnings.push(
      'A diferença mínima detectável é zero. Sem ela, o poder do teste não pode ser calculado.',
    );
  }
  if (selected.includes('accuracy') && input.margin <= 0) {
    warnings.push(
      'A margem de equivalência (TOST) não foi definida. O sistema usará o limite de aceitação de exatidão, se cadastrado.',
    );
  }
  if (selected.includes('linearity') && input.nLevels < 5) {
    warnings.push(
      'Linearidade requer pelo menos 5 níveis de concentração. O plano foi ajustado para 5 níveis.',
    );
  }
  if (input.designType === 'iso5725' && (input.nLabs < 6 || reps < 2)) {
    warnings.push(
      'A ISO 5725-2 recomenda pelo menos 6 laboratórios e 2 réplicas por nível. Revise o delineamento.',
    );
  }
  if (manualAdjusted) {
    warnings.push(
      `O total manual (${input.manualTotal}) não é múltiplo do número de células do desenho. Para manter o balanceamento, o total foi ajustado para ${finalTotal} (${reps} réplicas por célula).`,
    );
  }
  if (finalTotal > 500) {
    warnings.push(
      `O plano tem ${finalTotal} medições. Verifique a viabilidade operacional; considere reduzir níveis, dias ou réplicas e recalcular o poder.`,
    );
  }
  if (reps < 3 && selected.some((k) => ['repeatability', 'intermediate_precision', 'reproducibility'].includes(k))) {
    warnings.push(
      'Menos de 3 réplicas por célula limita a estimativa de variabilidade. O sistema recomenda pelo menos 3.',
    );
  }
  for (const p of parameterPlans) {
    if (p.achievedPower !== null && p.achievedPower < input.power - 1e-9) {
      warnings.push(
        `O poder alcançado para ${PARAMETER_LABELS[p.key]} é ${(p.achievedPower * 100).toFixed(1)}%, abaixo do alvo de ${(input.power * 100).toFixed(0)}%.`,
      );
    }
  }

  const assumptions = [
    `Confiança de ${(input.confidence * 100).toFixed(1)}% e poder de ${(input.power * 100).toFixed(0)}% (α = ${input.alpha}, β = ${(1 - input.power).toFixed(2)}).`,
    input.sigma > 0
      ? `σ esperado = ${input.sigma} (informado ou estimado por dados piloto).`
      : 'σ esperado não informado; o poder não pode ser calculado sem uma estimativa.',
    `Diferença mínima detectável = ${input.effect}; margem de equivalência = ${input.margin}.`,
    `Ordem dos ensaios aleatorizada com semente ${input.seed}; a mesma semente reproduz exatamente o mesmo mapa.`,
    'Delineamento balanceado; réplicas independentes dentro de cada condição.',
    'Arredondamento de n para cima, garantindo o poder nominal.',
    'Normalidade e independência assumidas para os cálculos de poder; verifique-as após a coleta.',
  ];
  if (input.designType === 'iso5725') {
    assumptions.push(
      `Delineamento ISO 5725-2: ${input.nLabs} laboratórios × ${levels} níveis × ${reps} réplicas; componentes s_r², s_L² e s_R².`,
    );
  }
  if (input.designType === 'crossed') {
    assumptions.push(
      'Modelo cruzado com fatores analista, dia, equipamento e nível; componentes de variância por ANOVA/REML.',
    );
  }
  if (input.designType === 'nested') {
    assumptions.push(
      'Estrutura aninhada lote → amostra → réplica; amostras são únicas dentro de cada lote.',
    );
  }
  if (input.designType === 'factorial') {
    assumptions.push(
      'Fatores em dois níveis (baixo/alto); efeitos principais e interações estimáveis com o fatorial completo.',
    );
  }
  assumptions.push(...parameterPlans.flatMap((p) => p.assumptions));
  assumptions.push('As suposições devem ser confirmadas na análise; desvios são registrados no relatório.');

  const plan: DesignPlan = {
    input,
    parameterPlans,
    recommended: {
      total: finalTotal,
      analysts: input.nAnalysts,
      days: input.nDays,
      equipments: input.nEquipments,
      replicates: reps,
      labs: input.nLabs,
      levels,
      samples: input.nSamples,
    },
    runs: randomized,
    powerCurve: buildPowerCurve(input, finalTotal, selected),
    summary: '',
    assumptions,
    warnings,
    createdAt: options.now ?? new Date().toISOString(),
  };
  plan.summary = explainDesign(plan);
  return plan;
}

/**
 * Calcula o poder para um total informado manualmente, sem reconstruir o mapa.
 * Usado no ajuste manual com recálculo imediato.
 */
export function powerForManualTotal(
  input: DesignInput,
  total: number,
  selected: ParamKey[],
): number {
  if (total <= 0) return 0;
  const useTost = selected.includes('accuracy') && input.margin > 0;
  return useTost
    ? powerTOST(total, input.margin, input.sigma, {
        alpha: input.alpha,
        design: 'one_sample',
      })
    : powerTTest(total, input.effect, input.sigma, {
        alpha: input.alpha,
        design: 'one_sample',
      });
}

/** Estimativa rápida de ANOVA para a etapa de robustez (opcional na UI). */
export function robustnessAnovaPower(
  nPerGroup: number,
  levels: number,
  effectSize: number,
  alpha: number,
): number {
  const result = sampleSizeAnova(levels, effectSize, alpha, 0.8);
  if (!result.nPerGroup) return 0;
  return Math.min(1, nPerGroup / result.nPerGroup);
}

/** Informação do delineamento para exibição no relatório. */
export function designNarrative(plan: DesignPlan): string {
  const i = plan.input;
  const r = plan.recommended;
  const base = `${plan.summary} O desenho é ${i.designType === 'iso5725' ? 'balanceado entre laboratórios' : 'balanceado'}, com ordem de execução aleatorizada (semente ${i.seed}).`;
  const power = plan.powerCurve.length
    ? ` A curva de poder mostra o poder do teste para diferentes totais, considerando σ = ${i.sigma} e diferença mínima detectável = ${i.effect}.`
    : '';
  const iso = plan.parameterPlans.find((p) => p.method === 'iso5725');
  const isoText = iso
    ? ` Para reprodutibilidade, a ISO 5725-2 estima s_r² = MSW, s_L² = (MSB − MSW)/n e s_R² = s_r² + s_L².`
    : '';
  return `${base}${power}${isoText} Total de ${r.total} medições em ${plan.runs.length} linhas de execução.`;
}

/** Exporta o mapa de execução em formato matricial para XLSX/CSV. */
export function runsToMatrix(plan: DesignPlan): Array<Array<string | number>> {
  const header = [
    'ordem_ensaio',
    'nivel',
    'analista',
    'dia',
    'equipamento',
    'lote',
    'amostra',
    'replica',
    'combinacao',
  ];
  const rows = plan.runs.map((r) => [
    r.runOrder,
    r.level,
    r.analyst,
    r.day,
    r.equipment,
    r.lot,
    r.sample,
    r.replicate,
    r.combination,
  ]);
  return [header, ...rows];
}

/** PRNG exportado para testes de reprodutibilidade. */
export function seededSequence(seed: number, n: number): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => rand());
}
