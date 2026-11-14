import { test, expect } from '@playwright/test';
import { cardByHeading, openDemoAnalysis } from './helpers';

test('critério específico da validação substitui o global na análise', async ({
  page,
}) => {
  await openDemoAnalysis(page);

  await page.getByRole('button', { name: /Parâmetros/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Parâmetros e critérios da validação' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /Repetibilidade/ }).first().click();
  await expect(
    page.getByText('Critérios globais do método', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('cv: ≤ 5 %')).toBeVisible();

  await page.getByRole('button', { name: 'Adicionar critério' }).click();
  await expect(
    page.getByText('Critério: Coeficiente de variação ≤ 2 %'),
  ).toBeVisible();

  await page.getByLabel('Limite', { exact: true }).fill('0.01');
  await expect(page.getByText('(substituído)')).toBeVisible();

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Parâmetros e critérios salvos.')).toBeVisible();

  await page.getByRole('button', { name: /Análise/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Análise estatística e incerteza' }),
  ).toBeVisible();

  const repeatability = cardByHeading(page, /Repetibilidade/);
  const cvRow = repeatability.locator('tbody tr', {
    hasText: 'Coeficiente de variação',
  });
  await expect(cvRow).toContainText('≤ 0,01 %');
  await expect(cvRow.getByText('Não conforme')).toBeVisible();
});
