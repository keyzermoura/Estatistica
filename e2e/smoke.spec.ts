import { test, expect } from '@playwright/test';
import { openDemoAnalysis } from './helpers';

test('abre o painel com a validação de demonstração', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Validações em andamento' }),
  ).toBeVisible();
  await expect(page.getByText('Cafeína em bebidas por HPLC-UV')).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Validação HPLC-CAF-01 — 2026',
      exact: true,
    }),
  ).toBeVisible();
});

test('abre a análise da validação de demonstração', async ({ page }) => {
  await openDemoAnalysis(page);

  await expect(
    page.getByRole('heading', { name: /^Linearidade/ }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Pressupostos/ }).click();
  await expect(page.getByText('Pressupostos da análise')).toBeVisible();
  await expect(page.getByText('Diagnóstico do estudo de atributo')).toHaveCount(0);
});
