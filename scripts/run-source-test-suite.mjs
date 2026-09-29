import { spawnSync } from 'node:child_process';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmExecutable, ['test'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    KODETY_FORMS_SOURCE_ONLY: '1',
    KODETY_SKILL_ARCHIVES_SOURCE_ONLY: '1',
  },
  shell: false,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`A suíte de fontes foi interrompida por ${result.signal}.`);
}
if (result.status !== 0) {
  throw new Error(`A suíte de fontes falhou com status ${result.status}.`);
}
