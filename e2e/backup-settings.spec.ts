import { test, expect } from '@playwright/test';

test.describe('Configurações e persistência de dados', () => {
  test('exibe painel de dados, persistência e lembrete de backup', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();

    // Verifica presença da seção de dados e backup
    await expect(page.getByText('Dados e backup')).toBeVisible();
    await expect(page.getByText('Persistência do Navegador')).toBeVisible();
    await expect(page.getByText('Lembrete de Backup')).toBeVisible();
    await expect(page.getByLabel('Intervalo para lembrete de backup (dias)')).toBeVisible();

    // Verifica botão de exportar banco
    const exportBtn = page.getByRole('button', { name: /Exportar banco/ });
    await expect(exportBtn).toBeVisible();
  });
});
