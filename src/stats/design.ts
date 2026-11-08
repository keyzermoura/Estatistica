/**
 * Delineamento amostral: converte parâmetros estatísticos em um plano
 * executável, com aleatorização reprodutível e curva de poder.
 *
 * Referências: Montgomery (2020); ISO 5725-2:2019; Chow, Shao & Wang (2008).
 */

import type {
  DesignInput,
  DesignPlan,
  ParamKey,
  ParameterPlan,
  PowerPoint,
  RunRow,
} from '../lib/types';
import { DEFAULT_PROFILE_ID, getProfile } from '../profiles/index';
import type { MethodProfile } from '../profiles/types';
import { mulberry32, shuffle } from './distributions';
import { NESTED_DESTRUCTIVE_WARNING } from './nested';
import {
  meanCIPrecision,
  planForParameter,
  powerTTest,
  type SampleSizeResult,
} from './sampleSize';

export interface DesignBuildOptions {
  selected?: ParamKey[];
  maxRuns?: number;
  /** Perfil de método ativo. Ausente = perfil analítico. */
  profileId?: string;
}

export function sampleResultToParameterPlan(
  key: ParamKey,
  result: SampleSizeResult,
): ParameterPlan {
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
}

function buildRuns(input: DesignInput, total: number): { runs: RunRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const reps = Math.max(2, Math.round(input.nReplicates));
  const levels = input.levels.length ? input.levels : ['baixo', 'médio', 'alto'];
  const analysts = Math.max(2, Math.round(input.nAnalysts));
  const days = Math.max(2, Math.round(input.nDays));
  const equipment = Math.max(1, Math.round(input.nEquipments));
  const lots = Math.max(1, Math.round(input.nLots));
  const labs = Math.max(2, Math.round(input.nLabs));
  const samples = Math.max(2, Math.round(input.nSamples));
  const rows: Omit<RunRow, 'runOrder'>[] = [];

  const push = (
    combination: string,
    factorValues: Record<string, string>,
    level = '',
    extra: Partial<RunRow> = {},
  ) => {
    rows.push({
      level,
      analyst: factorValues.analista ?? '',
      day: factorValues.dia ?? '',
      equipment: factorValues.equipamento ?? '',
      lot: factorValues.lote ?? '',
      sample: factorValues.amostra ?? '',
      replicate: 0,
      combination,
      factorValues,
      ...extra,
    });
  };

  switch (input.designType) {
    case 'crd': {
      const perLevel = Math.max(1, Math.ceil(total / levels.length));
      for (const level of levels) {
        for (let r = 1; r <= perLevel; r++) {
          push(`Nível ${level} · réplica ${r}`, { nivel: level }, level, { replicate: r });
        }
      }
      break;
    }
    case 'rbd': {
      const perBlock = Math.max(1, Math.ceil(total / days));
      for (const day of Array.from({ length: days }, (_, i) => `D${i + 1}`)) {
        for (let r = 1; r <= perBlock; r++) {
          const level = levels[r % levels.length];
          push(`Bloco ${day} · ${level} · réplica ${r}`, { bloco: day, nivel: level }, level, {
            day,
            replicate: r,
          });
        }
      }
      break;
    }
    case 'factorial': {
      const factors = input.factors.length ? input.factors : ['A', 'B', 'C'];
      const combos = 1 << factors.length;
      for (let mask = 0; mask < combos; mask++) {
        const fv: Record<string, string> = {};
        factors.forEach((f, i) => {
          fv[f] = (mask >> i) & 1 ? '+1' : '−1';
        });
        for (let r = 1; r <= reps; r++) {
          push(
            `${factors.map((f) => `${f}=${fv[f]}`).join(' · ')} · réplica ${r}`,
            fv,
            '',
            { replicate: r },
          );
        }
      }
      break;
    }
    case 'nested': {
      for (let l = 1; l <= lots; l++) {
        for (let s = 1; s <= samples; s++) {
          for (let r = 1; r <= reps; r++) {
            const level = levels[(l - 1) % levels.length];
            push(
              `Lote L${l} · amostra A${s} · réplica ${r}`,
              { lote: `L${l}`, amostra: `A${s}`, nivel: level },
              level,
              { lot: `L${l}`, sample: `A${s}`, replicate: r },
            );
          }
        }
      }
      break;
    }
    case 'iso5725': {
      for (const level of levels) {
        for (let lab = 1; lab <= labs; lab++) {
          for (let r = 1; r <= reps; r++) {
            push(
              `Lab ${lab} · ${level} · réplica ${r}`,
              { laboratorio: `Lab ${lab}`, nivel: level },
              level,
              { analyst: `Lab ${lab}`, replicate: r },
            );
          }
        }
      }
      break;
    }
    case 'nested_destructive': {
      const destructiveOperators = Math.max(2, Math.round(input.nAnalysts));
      const destructiveSamples = Math.max(1, Math.round(input.nSamples));
      let specimenIndex = 1;
      for (let o = 1; o <= destructiveOperators; o++) {
        for (let s = 1; s <= destructiveSamples; s++) {
          for (let r = 1; r <= reps; r++) {
            const specimen = `CP-${String(specimenIndex).padStart(3, '0')}`;
            specimenIndex++;
            push(
              `Operador Op${o} · amostra A${s} · corpo de prova ${specimen}`,
              {
                lote: 'Lote',
                operador: `Op${o}`,
                amostra: `A${s}`,
                corpo_de_prova: specimen,
              },
              '',
              {
                analyst: `Op${o}`,
                lot: 'Lote',
                sample: `A${s}`,
                replicate: r,
                specimen,
              },
            );
          }
        }
      }
      break;
    }
    case 'attribute_agreement': {
      const raters = Math.max(2, Math.round(input.nAnalysts));
      const samples = Math.max(2, Math.round(input.nSamples));
      const width = Math.max(3, String(samples).length);
      // Códigos cegos: uma permutação reprodutível dos rótulos 1..amostras.
      // O avaliador vê apenas o código, nunca a referência ou o índice original.
      const codes = shuffle(
        Array.from({ length: samples }, (_, index) => index + 1),
        input.seed + 7919,
      ).map((code) => `A-${String(code).padStart(width, '0')}`);
      for (const code of codes) {
        for (let rater = 1; rater <= raters; rater++) {
          for (let r = 1; r <= reps; r++) {
            push(
              `Amostra ${code} · avaliador Op${rater} · réplica ${r}`,
              {
                amostra: code,
                avaliador: `Op${rater}`,
                replica: String(r),
                cego: 'sim',
              },
              '',
              { analyst: `Op${rater}`, sample: code, replicate: r },
            );
          }
        }
      }
      break;
    }
    case 'crossed':
    default: {
      for (const level of levels) {
        for (let a = 1; a <= analysts; a++) {
          for (let d = 1; d <= days; d++) {
            for (let e = 1; e <= equipment; e++) {
              for (let r = 1; r <= reps; r++) {
                push(
                  `${level} · analista A${a} · dia D${d} · equip. E${e} · réplica ${r}`,
                  {
                    nivel: level,
                    analista: `A${a}`,
                    dia: `D${d}`,
                    equipamento: `E${e}`,
                  },
                  level,
                  {
                    analyst: `A${a}`,
                    day: `D${d}`,
                    equipment: `E${e}`,
                    replicate: r,
                  },
                );
              }
            }
          }
        }
      }
      break;
    }
  }

  if (rows.length > total * 1.5 && total > 0) {
    warnings.push(
      `O desenho gera ${rows.length} execuções, acima do total calculado (${total}); avalie reduzir níveis/fatores.`,
    );
  }
  const randomized = shuffle(
    rows.map((r, i) => ({ ...r, _i: i })),
    input.seed,
  ).map((r, i) => ({ ...r, runOrder: i + 1 }));
  return { runs: randomized, warnings };
}

function buildPowerCurve(input: DesignInput, maxN: number): PowerPoint[] {
  const sigma = input.sigma > 0 ? input.sigma : 1;
  const effect = input.effect > 0 ? input.effect : sigma / 2;
  const max = Math.max(12, Math.min(120, maxN || 40));
  const curve: PowerPoint[] = [];
  for (let n = 2; n <= max; n++) {
    const power = powerTTest(n, effect, sigma, {
      alpha: input.alpha,
      sides: 2,
      design: 'two_sample',
    });
    curve.push({
      n,
      power,
      precision: meanCIPrecision(n, sigma, input.confidence),
    });
  }
  return curve;
}

function buildSummary(
  input: DesignInput,
  plans: ParameterPlan[],
  total: number,
  runs: RunRow[],
  profile: MethodProfile,
): string {
  const largest = plans.slice().sort((a, b) => b.total - a.total)[0];
  const designLabel =
    input.designType === 'attribute_agreement'
      ? 'Concordância de atributo'
      : input.designType.toUpperCase();
  const parts = [
    `Delineamento ${designLabel} com ${total} medições recomendadas`,
    `${runs.length} execuções aleatorizadas (semente ${input.seed})`,
  ];
  if (largest) {
    const label =
      profile.parameters.find((parameter) => parameter.key === largest.key)?.label ??
      largest.key;
    parts.push(
      `O parâmetro mais exigente é ${label} (${largest.total} medições)`,
    );
  }
  if (input.designType === 'iso5725') {
    parts.push(
      `${Math.max(2, input.nLabs)} laboratórios × ${Math.max(2, input.nReplicates)} réplicas × ${input.levels.length} níveis`,
    );
  }
  if (input.designType === 'nested_destructive') {
    const operators = Math.max(2, Math.round(input.nAnalysts));
    const samples = Math.max(1, Math.round(input.nSamples));
    const replicates = Math.max(2, Math.round(input.nReplicates));
    parts.push(
      `${operators} operadores × ${samples} amostras × ${replicates} corpos de prova = ${operators * samples * replicates} corpos de prova a retirar do lote`,
    );
  }
  if (input.designType === 'attribute_agreement') {
    const raters = Math.max(2, Math.round(input.nAnalysts));
    const samples = Math.max(2, Math.round(input.nSamples));
    const borderline = Math.min(
      samples,
      Math.max(0, Math.round(input.nBorderlineSamples ?? 0)),
    );
    const replicates = Math.max(2, Math.round(input.nReplicates));
    parts.push(
      `${samples} amostras (${borderline} limítrofes) × ${raters} avaliadores × ${replicates} réplicas, com referência conhecida e ordem/códigos cegados pela semente`,
    );
  }
  return `${parts.join('. ')}.`;
}

export function buildDesign(
  input: DesignInput,
  options: DesignBuildOptions = {},
): DesignPlan {
  const profile = getProfile(options.profileId ?? DEFAULT_PROFILE_ID);
  const selected =
    options.selected && options.selected.length
      ? options.selected
      : profile.parameters
          .filter((parameter) => parameter.defaultSelected)
          .map((parameter) => parameter.key);
  const plans = selected.map((key) =>
    sampleResultToParameterPlan(
      key,
      planForParameter(key, {
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
      }),
    ),
  );
  const calculatedTotal = Math.max(6, ...plans.map((p) => p.total));
  const total =
    input.manualOverride && input.manualTotal && input.manualTotal > 0
      ? Math.round(input.manualTotal)
      : calculatedTotal;
  const { runs, warnings } = buildRuns(input, total);
  const capped = runs.slice(0, options.maxRuns ?? 2000);
  if (capped.length < runs.length) {
    warnings.push(`Lista de execuções limitada a ${capped.length} linhas para desempenho.`);
  }
  const powerCurve = buildPowerCurve(input, Math.max(total, input.nReplicates * 10));
  const assumptions = [
    `Confiança de ${(input.confidence * 100).toFixed(1)}% e poder de ${(input.power * 100).toFixed(0)}%`,
    `σ assumido = ${input.sigma}${input.sigma === 0.5 ? ' (padrão; substitua por dado piloto)' : ''}`,
    `Efeito mínimo detectável = ${input.effect}; margem = ${input.margin}`,
    'Observações independentes; aleatorização executada na ordem gerada',
    'Dados faltantes serão tratados por análise de casos completos, com registro do n efetivo',
  ];
  if (input.sigma === 0.5) {
    warnings.push('σ = 0,5 é apenas um valor inicial. Use o desvio-padrão piloto do método.');
  }
  if (input.designType === 'iso5725' && Math.max(2, input.nLabs) < 6) {
    warnings.push('ISO 5725-2 recomenda pelo menos 6 laboratórios.');
  }
  if (input.designType === 'nested_destructive') {
    warnings.push(NESTED_DESTRUCTIVE_WARNING);
    if (Math.max(1, Math.round(input.nSamples)) < 2) {
      warnings.push(
        'Com uma amostra por operador (b = 1), a componente entre amostras não é estimável; use o modelo de dois níveis do ISO 5725-2.',
      );
    }
    if (Math.max(2, Math.round(input.nReplicates)) < 3) {
      warnings.push('Menos de 3 corpos de prova por amostra: a repetibilidade terá poucos graus de liberdade.');
    }
    assumptions.push(
      'Ensaio destrutivo: cada corpo de prova é medido uma única vez e é consumido pelo ensaio',
    );
    assumptions.push(
      'Amostras do mesmo lote são homogêneas; a repetibilidade inclui a variação entre corpos de prova',
    );
  }
  if (input.designType === 'attribute_agreement') {
    const rawAnalysts = Math.round(input.nAnalysts);
    const rawSamples = Math.round(input.nSamples);
    const rawBorderline = Math.round(input.nBorderlineSamples ?? 0);
    if (rawAnalysts < 2) {
      warnings.push(
        'O estudo de concordância exige pelo menos 2 avaliadores; o plano foi gerado com 2.',
      );
    }
    if (rawSamples < 2) {
      warnings.push(
        'O estudo de concordância exige pelo menos 2 amostras; o plano foi gerado com 2.',
      );
    }
    if (rawBorderline < 1) {
      warnings.push(
        'Nenhuma amostra limítrofe foi incluída; itens limítrofes são importantes para desafiar a discriminação entre categorias.',
      );
    }
    if (rawBorderline > rawSamples) {
      warnings.push(
        `O número de amostras limítrofes (${rawBorderline}) excede o total de amostras (${rawSamples}); o plano limita a ${Math.max(0, rawSamples)}.`,
      );
    }
    if (rawBorderline > 0 && rawBorderline === rawSamples) {
      warnings.push(
        'Todas as amostras são limítrofes; inclua também amostras claramente conformes e não conformes.',
      );
    }
    assumptions.push(
      'Estudo de concordância: cada avaliador classifica cada amostra sem conhecer a referência; a ordem de apresentação é aleatorizada pela semente',
    );
    assumptions.push(
      'Os códigos das amostras são uma permutação aleatória; a referência e a condição limítrofe não são exibidas ao avaliador',
    );
    assumptions.push(
      'As amostras incluem itens limítrofes, além de casos claramente conformes e não conformes',
    );
  }
  if (Math.max(2, input.nReplicates) < 2) warnings.push('Menos de 2 réplicas impede estimar repetibilidade.');
  const specimenConsumption =
    input.designType === 'nested_destructive'
      ? (() => {
          const operators = Math.max(2, Math.round(input.nAnalysts));
          const samples = Math.max(1, Math.round(input.nSamples));
          const replicates = Math.max(2, Math.round(input.nReplicates));
          return {
            operators,
            samplesPerOperator: samples,
            replicates,
            total: operators * samples * replicates,
          };
        })()
      : undefined;
  return {
    input: { ...input },
    parameterPlans: plans,
    recommended: {
      total,
      analysts: Math.max(2, Math.round(input.nAnalysts)),
      days: Math.max(2, Math.round(input.nDays)),
      equipments: Math.max(1, Math.round(input.nEquipments)),
      replicates: Math.max(2, Math.round(input.nReplicates)),
      labs: Math.max(2, Math.round(input.nLabs)),
      levels: Math.max(2, input.levels.length || input.nLevels),
      samples:
        input.designType === 'nested_destructive'
          ? Math.max(1, Math.round(input.nSamples))
          : Math.max(2, Math.round(input.nSamples)),
      borderlineSamples:
        input.designType === 'attribute_agreement'
          ? Math.min(
              Math.max(2, Math.round(input.nSamples)),
              Math.max(0, Math.round(input.nBorderlineSamples ?? 0)),
            )
          : undefined,
    },
    runs: capped,
    powerCurve,
    summary: buildSummary(input, plans, total, capped, profile),
    assumptions,
    warnings: [...new Set(warnings)],
    specimenConsumption,
    createdAt: new Date().toISOString(),
  };
}

/** Estimativa rápida de σ a partir da faixa (faixa/6 por padrão). */
export function sigmaFromRange(
  rangeMin: number | null,
  rangeMax: number | null,
  divisor = getProfile(DEFAULT_PROFILE_ID).defaultAssumptions.sigmaFromRangeDivisor,
): number | null {
  if (rangeMin === null || rangeMax === null || !(rangeMax > rangeMin)) return null;
  return (rangeMax - rangeMin) / divisor;
}

/** Reamostra a ordem de execução mantendo o mesmo conjunto de combinações. */
export function rerandomize(
  plan: DesignPlan,
  seed: number,
  profileId = DEFAULT_PROFILE_ID,
): DesignPlan {
  const runs = shuffle(plan.runs, seed).map((r, i) => ({ ...r, runOrder: i + 1 }));
  return {
    ...plan,
    input: { ...plan.input, seed },
    runs,
    summary: buildSummary(
      plan.input,
      plan.parameterPlans,
      plan.recommended.total,
      runs,
      getProfile(profileId),
    ),
  };
}

/** Gera um vetor reprodutível de números uniformes (para simulações). */
export function reproducibleUniforms(n: number, seed: number): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => rand());
}
