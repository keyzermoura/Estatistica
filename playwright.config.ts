import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta no navegador real.
 *
 * O banco SQLite vive no IndexedDB, então cada contexto do Playwright começa
 * vazio e recebe o seed de demonstração. O servidor de desenvolvimento é
 * reutilizado quando já está rodando em 4173.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
