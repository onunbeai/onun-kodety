import { defineConfig, devices } from '@playwright/test';

const artifactRoot = 'artifacts/kodety-hardening/front-06/e2e';

export default defineConfig({
  testDir: './e2e',
  testMatch: /wordpress-installed-smoke\.spec\.mjs/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 4 * 60_000,
  expect: { timeout: 30_000 },
  outputDir: `${artifactRoot}/test-results`,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // O smoke atravessa login e DOM autenticado. Artefatos nativos não passam
    // pelo redator fail-closed usado pelo HAR reduzido, então ficam desligados.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
