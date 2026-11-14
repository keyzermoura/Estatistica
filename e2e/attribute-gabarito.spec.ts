import { test, expect } from '@playwright/test';
import { attributeWorkbook, cardByHeading } from './helpers';

test('cria validação de atributo, importa coleta e aplica o gabarito', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Nova validação' })
    .click();
  await page.getByRole('tab', { name: 'Novo método' }).click();
  await page.getByLabel('Código').fill('ATR-E2E-01');
  await page.getByLabel('Nome do método').fill('Atributo E2E');
  await page.getByLabel('Família de ensaio').selectOption('attribute');
  await page.getByRole('button', { name: 'Criar método e validação' }).click();

  await expect(
    page.getByRole('heading', { name: 'Método e identificação' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /Coleta/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Coleta de dados' }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'coleta-atributo.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: attributeWorkbook(),
  });
  await expect(page.getByText(/16 linha\(s\) importadas/)).toBeVisible();

  const gabarito = cardByHeading(page, 'Gabarito de referência');
  await expect(gabarito).toBeVisible();
  await expect(gabarito.getByText('4 item(ns)')).toBeVisible();
  await expect(gabarito.getByText('1 sem referência')).toBeVisible();
  await expect(gabarito.getByText('1 em conflito')).toBeVisible();

  const rowA2 = gabarito.locator('tbody tr', { hasText: 'A-2' });
  await expect(rowA2.getByText('conflito')).toBeVisible();

  const bulk = page.getByLabel('Categoria para aplicação em massa');
  await bulk.fill('conforme');
  await page.getByRole('button', { name: 'Resolver conflitos' }).click();
  await expect(gabarito.getByText('1 em conflito')).toHaveCount(0);
  await expect(rowA2.getByText('conforme')).toBeVisible();

  await bulk.fill('não conforme');
  await page.getByRole('button', { name: 'Aplicar aos sem referência' }).click();
  await expect(gabarito.getByText('1 sem referência')).toHaveCount(0);
  const rowA4 = gabarito.locator('tbody tr', { hasText: 'A-4' });
  await expect(rowA4.getByText('não conforme')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar e analisar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Análise estatística e incerteza' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Diagnóstico do estudo de atributo' }),
  ).toBeVisible();
  await expect(page.getByText('Itens (amostras)')).toBeVisible();
  await expect(
    page.getByText('κ interavaliadores', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Estudo de atributo não avaliado'),
  ).toHaveCount(0);
});
