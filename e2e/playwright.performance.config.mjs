import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const artifactRoot = path.join(
  repositoryRoot,
  'artifacts/kodety-hardening/front-06/e2e/performance',
);

export default defineConfig({
  testDir: path.dirname(fileURLToPath(import.meta.url)),
  testMatch: /wordpress-performance-profile\.spec\.mjs/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90 * 60_000,
  expect: { timeout: 60_000 },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [['line']],
  projects: [
    {
      name: 'chromium-performance',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        headless: true,
        actionTimeout: 30_000,
        navigationTimeout: 90_000,
        serviceWorkers: 'block',
        trace: 'off',
        screenshot: 'off',
        video: 'off',
      },
    },
  ],
});
