/**
 * Ponte entre as medições persistidas e o estudo de concordância de atributo.
 *
 * O motor em `attribute.ts` trabalha com observações no formato
 * `{ item, rater, category, replicate, reference }`. Este módulo traduz as
 * colunas da coleta (`sample`, `analyst`, `category`, `textValue`, `value`,
 * `level`, `referenceValue`, `replicate`) para esse formato, conta dados
 * ausentes e isola falhas do estudo (duplicidades, referências conflitantes)
 * para que a interface exiba “não avaliado” em vez de quebrar.
 *
 * Decisões de mapeamento:
 *  - item = amostra;
 *  - avaliador = analista;
 *  - categoria observada = categoria || texto || valor numérico;
 *  - referência = nível || valor de referência numérico;
 *  - réplica = réplica (inteiro positivo; inválida vira 1 com alerta).
 *
 * Referências: AIAG MSA (2010), 4. ed.; Cohen (1960); Fleiss (1971).
 */

import type { AcceptanceCriterion, Measurement } from '../lib/types';
import {
  attributeAgreementStudy,
  type AttributeAgreementCriteria,
  type AttributeObservation,
  type AttributeStudyOptions,
  type AttributeStudyResult,
} from './attribute';

export interface AttributeData {
  observations: AttributeObservation[];
  /** Referência conhecida por item, mesmo quando a categoria está ausente. */
  references: Record<string, string>;
  totalRows: number;
  validRows: number;
  missingCategory: number;
  missingItem: number;
  missingRater: number;
  missingReference: number;
  itemsWithoutReference: number;
  duplicateCells: number;
  invalidReplicates: number;
  referenceConflicts: string[];
  items: string[];
  raters: string[];
  categories: string[];
  warnings: string[];
}

export interface AttributeStudyOutcome {
  data: AttributeData;
  study: AttributeStudyResult | null;
  error: string | null;
}

/** Referência consolidada de um item para o gabarito de coleta. */
export interface AttributeReferenceItem {
  item: string;
  /** Número de linhas (avaliador × réplica) do item. */
  rows: number;
  /** Referência única quando todas as linhas concordam; nula se ausente ou conflitante. */
  reference: string | null;
  /** Referências distintas não vazias encontradas no item. */
  references: string[];
  /** Verdadeiro quando o item tem mais de uma referência distinta. */
  conflict: boolean;
}

export interface AttributeReferenceSheet {
  items: AttributeReferenceItem[];
  /** Categorias observadas e de referência, para sugestão no gabarito. */
  categories: string[];
}

/**
 * Consolida as referências por item para o gabarito da coleta.
 *
 * O gabarito é uma visão derivada: não cria coluna nova nem altera o schema.
 * A referência é lida de `level` e, na ausência dele, de `referenceValue`.
 */
export function attributeReferenceSheet(
  measurements: readonly Measurement[],
): AttributeReferenceSheet {
  const byItem = new Map<string, { rows: number; references: Set<string> }>();
  const categories = new Set<string>();

  for (const measurement of measurements) {
    const item = text(measurement.sample);
    if (!item) continue;
    const reference = attributeReferenceOf(measurement);
    const entry = byItem.get(item) ?? { rows: 0, references: new Set<string>() };
    entry.rows += 1;
    if (reference) {
      entry.references.add(reference);
      categories.add(reference);
    }
    const category = attributeCategoryOf(measurement);
    if (category) categories.add(category);
    byItem.set(item, entry);
  }

  const items = [...byItem.entries()]
    .map(([item, entry]) => {
      const references = [...entry.references].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      );
      return {
        item,
        rows: entry.rows,
        reference: references.length === 1 ? references[0] : null,
        references,
        conflict: references.length > 1,
      };
    })
    .sort((a, b) => a.item.localeCompare(b.item, 'pt-BR', { numeric: true }));

  return {
    items,
    categories: [...categories].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

function text(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function numericText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value);
}

/** Categoria observada, na ordem categoria → texto → valor numérico. */
export function attributeCategoryOf(measurement: Measurement): string {
  const category = text(measurement.category);
  if (category) return category;
  const textValue = text(measurement.textValue);
  if (textValue) return textValue;
  return numericText(measurement.value);
}

/** Categoria de referência, na ordem nível → valor de referência. */
export function attributeReferenceOf(measurement: Measurement): string {
  const level = text(measurement.level);
  if (level) return level;
  return numericText(measurement.referenceValue);
}

/**
 * Converte as medições em observações de atributo, contabilizando tudo o que
 * não pôde ser aproveitado. Nenhuma linha é removida em silêncio: cada descarte
 * vira um alerta no resultado.
 */
export function attributeObservationsFrom(
  measurements: readonly Measurement[],
): AttributeData {
  const observations: AttributeObservation[] = [];
  const references: Record<string, string> = {};
  const referenceConflicts = new Set<string>();
  const items = new Set<string>();
  const raters = new Set<string>();
  const categories = new Set<string>();
  const seen = new Set<string>();

  let missingCategory = 0;
  let missingItem = 0;
  let missingRater = 0;
  let missingReference = 0;
  let duplicateCells = 0;
  let invalidReplicates = 0;

  for (const measurement of measurements) {
    const item = text(measurement.sample);
    const rater = text(measurement.analyst);
    const category = attributeCategoryOf(measurement);
    const reference = attributeReferenceOf(measurement);

    if (!item) {
      missingItem += 1;
      continue;
    }
    if (!rater) {
      missingRater += 1;
      continue;
    }

    if (reference) {
      const existing = references[item];
      if (existing !== undefined && existing !== reference) {
        referenceConflicts.add(
          `Referência conflitante para o item "${item}": "${existing}" e "${reference}".`,
        );
      } else if (existing === undefined) {
        references[item] = reference;
      }
      categories.add(reference);
    } else {
      missingReference += 1;
    }

    if (!category) {
      missingCategory += 1;
      continue;
    }

    const rawReplicate = Number(measurement.replicate);
    let replicate = 1;
    if (Number.isInteger(rawReplicate) && rawReplicate >= 1) {
      replicate = rawReplicate;
    } else {
      invalidReplicates += 1;
    }

    const key = `${item}\u0000${rater}\u0000${replicate}`;
    if (seen.has(key)) duplicateCells += 1;
    seen.add(key);

    items.add(item);
    raters.add(rater);
    categories.add(category);
    observations.push({
      item,
      rater,
      category,
      replicate,
      reference: reference || null,
    });
  }

  const itemsWithoutReference = [...items].filter(
    (item) => references[item] === undefined,
  ).length;

  const warnings: string[] = [];
  if (missingItem > 0) {
    warnings.push(
      `${missingItem} linha(s) sem amostra foram ignoradas no estudo de atributo; preencha a coluna “Amostra”.`,
    );
  }
  if (missingRater > 0) {
    warnings.push(
      `${missingRater} linha(s) sem avaliador foram ignoradas; preencha a coluna “Analista / lab”.`,
    );
  }
  if (missingCategory > 0) {
    warnings.push(
      `${missingCategory} linha(s) sem categoria observada foram ignoradas; preencha “Categoria observada”, “Texto” ou “Valor”.`,
    );
  }
  if (missingReference > 0) {
    warnings.push(
      `${missingReference} linha(s) sem referência conhecida; a concordância com a referência usa apenas os itens com referência.`,
    );
  }
  if (itemsWithoutReference > 0) {
    warnings.push(
      `${itemsWithoutReference} item(ns) não possuem referência conhecida; eficácia, FAR, FRR e cobertura ficam limitadas.`,
    );
  }
  if (duplicateCells > 0) {
    warnings.push(
      `${duplicateCells} combinação(ões) item/avaliador/réplica duplicada(s); o estudo de atributo não será avaliado até que a duplicidade seja corrigida.`,
    );
  }
  if (invalidReplicates > 0) {
    warnings.push(
      `${invalidReplicates} réplica(s) inválida(s) foram tratadas como réplica 1; use inteiros positivos.`,
    );
  }
  for (const conflict of referenceConflicts) warnings.push(conflict);

  const sorted = (values: Set<string>) =>
    [...values].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return {
    observations,
    references,
    totalRows: measurements.length,
    validRows: observations.length,
    missingCategory,
    missingItem,
    missingRater,
    missingReference,
    itemsWithoutReference,
    duplicateCells,
    invalidReplicates,
    referenceConflicts: [...referenceConflicts],
    items: sorted(items),
    raters: sorted(raters),
    categories: sorted(categories),
    warnings,
  };
}

/**
 * Executa o estudo de atributo com tratamento de falhas. O chamador recebe
 * sempre os dados mapeados e, quando o cálculo é possível, o estudo completo.
 */
export function buildAttributeStudy(
  measurements: readonly Measurement[],
  options: AttributeStudyOptions = {},
): AttributeStudyOutcome {
  const data = attributeObservationsFrom(measurements);

  if (data.referenceConflicts.length > 0) {
    return {
      data,
      study: null,
      error: data.referenceConflicts.join(' '),
    };
  }
  if (data.observations.length === 0) {
    return {
      data,
      study: null,
      error:
        'Nenhuma observação de atributo válida. Informe amostra, avaliador e categoria observada.',
    };
  }

  try {
    const study = attributeAgreementStudy(
      { observations: data.observations, references: data.references },
      options,
    );
    return { data, study, error: null };
  } catch (error) {
    return {
      data,
      study: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extrai os limites do motor de atributo a partir dos critérios editáveis.
 *
 * O motor usa um único par κ (conforme/atenção) para todos os kappas; o
 * adaptador de parâmetro reavalia cada métrica com o seu próprio critério.
 * Aqui usamos o critério interavaliadores como referência e, na ausência dele,
 * o primeiro critério κ disponível.
 */
export function attributeStudyCriteria(
  criteria: readonly AcceptanceCriterion[],
): Partial<AttributeAgreementCriteria> {
  const first = (metric: string) =>
    criteria.find((criterion) => criterion.metric === metric);

  const kappa =
    first('kappa_inter') ?? first('kappa_reference') ?? first('kappa_intra');
  const kappaAccept =
    kappa?.operator === '>=' && Number.isFinite(kappa.limit)
      ? kappa.limit
      : 0.75;
  const kappaWarning =
    kappa?.limit2 !== undefined &&
    Number.isFinite(kappa.limit2) &&
    kappa.limit2 < kappaAccept
      ? kappa.limit2
      : Math.min(0.4, kappaAccept);

  const coverage = first('reference_coverage');
  const referenceCoverageMinimum =
    coverage?.operator === '>=' && Number.isFinite(coverage.limit)
      ? coverage.limit
      : 100;

  const effectiveness = first('effectiveness');
  const effectivenessMinimum =
    effectiveness?.operator === '>=' && Number.isFinite(effectiveness.limit)
      ? effectiveness.limit
      : null;

  const far = first('far');
  const farMaximum =
    far?.operator === '<=' && Number.isFinite(far.limit) ? far.limit : null;

  const frr = first('frr');
  const frrMaximum =
    frr?.operator === '<=' && Number.isFinite(frr.limit) ? frr.limit : null;

  return {
    kappaAccept,
    kappaWarning,
    referenceCoverageMinimum,
    effectivenessMinimum,
    farMaximum,
    frrMaximum,
  };
}
