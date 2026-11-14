import { stat } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { openDemoAnalysis } from './helpers';

test('gera a prévia do relatório e exporta DOCX e pacote de evidências', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await openDemoAnalysis(page);
  await page.getByRole('button', { name: /Relatório/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Relatório e assinaturas' }),
  ).toBeVisible();
  await expect(page.getByText('Prévia ainda não gerada')).toBeVisible();

  await page.getByRole('button', { name: 'Gerar prévia do relatório' }).click();
  await expect(
    page.getByRole('heading', { name: /Relatório de Validação/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Hash SHA-256:')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Exportações' }),
  ).toBeVisible();

  const docxPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'DOCX', exact: true }).click();
  const docx = await docxPromise;
  expect(docx.suggestedFilename()).toMatch(/relatorio\.docx$/);
  expect(await docx.failure()).toBeNull();
  const docxPath = await docx.path();
  expect(docxPath).not.toBeNull();
  expect((await stat(docxPath!)).size).toBeGreaterThan(1_000);

  const zipPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page
    .getByRole('button', { name: 'Pacote de evidências' })
    .click();
  const zip = await zipPromise;
  expect(zip.suggestedFilename()).toMatch(/evidencias\.zip$/);
  expect(await zip.failure()).toBeNull();
  const zipPath = await zip.path();
  expect(zipPath).not.toBeNull();
  expect((await stat(zipPath!)).size).toBeGreaterThan(1_000);
});
