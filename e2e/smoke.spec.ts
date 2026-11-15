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
  await page.getByRole('tab', { name: /^Pressupostos/ }).click();
  await expect(page.getByText('Pressupostos da análise')).toBeVisible();
  await expect(page.getByText('Diagnóstico do estudo de atributo')).toHaveCount(0);
});

test('abas da análise expõem ARIA e navegam com o teclado', async ({ page }) => {
  await openDemoAnalysis(page);

  const parameters = page.getByRole('tab', { name: /^Parâmetros/ });
  const qc = page.getByRole('tab', { name: /^Controle de Qualidade/ });
  const panel = page.getByRole('tabpanel');

  await expect(parameters).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toHaveAttribute('aria-labelledby', 'analysis-tab-parameters');

  await parameters.focus();
  await page.keyboard.press('ArrowRight');
  await expect(qc).toBeFocused();
  await expect(qc).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toHaveAttribute('aria-labelledby', 'analysis-tab-qc');

  await page.keyboard.press('End');
  const assumptions = page.getByRole('tab', { name: /^Pressupostos/ });
  await expect(assumptions).toBeFocused();
  await expect(assumptions).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Home');
  await expect(parameters).toBeFocused();
  await expect(parameters).toHaveAttribute('aria-selected', 'true');
});
