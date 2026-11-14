import type { Locator, Page } from '@playwright/test';
import * as XLSX from 'xlsx';

/** Card (`.surface`) que contém o heading informado. */
export function cardByHeading(page: Page, name: string | RegExp): Locator {
  return page
    .locator('.surface')
    .filter({ has: page.getByRole('heading', { name }) })
    .first();
}

export async function openDemoAnalysis(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Validação HPLC-CAF-01 — 2026', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Análise estatística e incerteza' })
    .waitFor();
}

/**
 * Planilha de atributo com 4 itens, 2 avaliadores e 2 réplicas (16 linhas).
 *
 * A-2 tem referências conflitantes entre avaliadores e A-4 não tem referência,
 * para exercitar as ações em massa do gabarito.
 */
export function attributeWorkbook(): Buffer {
  const items = [
    { item: 'A-1', reference: 'conforme', category: 'conforme' },
    { item: 'A-2', reference: '', category: '' },
    { item: 'A-3', reference: 'não conforme', category: 'não conforme' },
    { item: 'A-4', reference: '', category: 'conforme' },
  ];
  const raters = ['R1', 'R2'];
  const rows: Array<Record<string, string | number>> = [];
  let order = 0;

  for (const item of items) {
    for (const rater of raters) {
      for (let replicate = 1; replicate <= 2; replicate++) {
        order += 1;
        const conflicting = item.item === 'A-2';
        const level = conflicting
          ? rater === 'R1'
            ? 'conforme'
            : 'não conforme'
          : item.reference;
        const category = conflicting
          ? rater === 'R1'
            ? 'conforme'
            : 'não conforme'
          : item.category;
        rows.push({
          Ordem: order,
          Nível: level,
          'Analista/Lab': rater,
          Dia: replicate === 1 ? 'D1' : 'D2',
          Equipamento: 'EQ-1',
          Lote: 'L-1',
          Amostra: item.item,
          Réplica: replicate,
          Categoria: category,
          Texto: '',
          Notas: '',
        });
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    'Medições',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
