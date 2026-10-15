import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

/**
 * Tests de bout en bout : admin locale (`nohu-cms dev`, D1 et R2 locales)
 * → enregistrement → reconstruction du site → rendu des pages.
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx nohu-cms dev --port ${PORT}`,
    url: `http://localhost:${PORT}/admin/`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
