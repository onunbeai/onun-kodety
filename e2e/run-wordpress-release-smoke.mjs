import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', 'e2e/wordpress-installed-smoke.spec.mjs', ...process.argv.slice(2)],
  {
    cwd: root,
    env: {
      ...process.env,
      // This marks publication as mandatory but does not authorize it. The
      // operator must still opt in explicitly with KODETY_E2E_ALLOW_PUBLISH=1.
      KODETY_E2E_REQUIRE_PUBLISH: '1',
    },
    shell: false,
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
if (result.signal) throw new Error(`Smoke de release interrompido por ${result.signal}.`);
if (result.status !== 0) process.exitCode = result.status || 1;
