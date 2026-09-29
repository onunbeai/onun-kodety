import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const componentPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlAdobeFontsSettings.tsx',
);
const settingsPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx',
);
const hostPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx',
);
const editorTypesPath = path.join(root, 'lib/html-editor/editor-types.ts');

const [component, settings, host, editorTypes] = await Promise.all([
  readFile(componentPath, 'utf8'),
  readFile(settingsPath, 'utf8'),
  readFile(hostPath, 'utf8'),
  readFile(editorTypesPath, 'utf8'),
]);

function assertContainsAll(source, needles, message) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${message}: ausente ${needle}`);
  }
}

assert.match(component, /export\s+function\s+HtmlAdobeFontsSettings\b/);
assert.match(component, /export\s+function\s+adobeFontsProjectId\b/);
assert.match(component, /use\.typekit\.net/);
assertContainsAll(
  component,
  [
    "credentials: 'same-origin'",
    "'X-WP-Nonce'",
    "method: 'POST'",
    "method: 'DELETE'",
    'JSON.stringify({ projectId })',
  ],
  'o cliente deve autenticar as mutações e notificar o catálogo',
);
assert.match(
  component,
  /new CustomEvent\(\s*['"]kodety:adobe-fonts-changed['"]\s*,\s*\{\s*detail:\s*payload\s*\}\s*\)/,
  'mutações devem avisar o store/picker sem recarregar o Builder',
);
assertContainsAll(
  component,
  [
    'Web Project ID ou código de embed',
    'Salvar e sincronizar',
    'Ressincronizar',
    'Desconectar',
    'até 5 minutos',
    'autorizado a publicar',
    'licenciadas pela Adobe',
  ],
  'a interface deve explicar o fluxo e o licenciamento do Adobe Fonts',
);

assertContainsAll(
  settings,
  [
    "import { HtmlAdobeFontsSettings } from './HtmlAdobeFontsSettings'",
    'title="Adobe Fonts"',
    'collapseId="integrations-adobe-fonts"',
    'settingsUrl={wordpress?.adobeFontsSettingsUrl}',
    'syncUrl={wordpress?.adobeFontsSyncUrl}',
    'readOnly={readOnly || wordpress?.canManageIntegrations === false}',
  ],
  'Settings deve montar o conector somente com o contrato administrativo',
);

for (const field of [
  'adobeFontsUrl',
  'adobeFontsSettingsUrl',
  'adobeFontsSyncUrl',
]) {
  assert.match(settings, new RegExp(`${field}\\??\\s*:\\s*string`));
  assert.match(host, new RegExp(`${field}\\??\\s*:\\s*string`));
  assert.match(host, new RegExp(`${field}:\\s*wordpress\\.${field}`));
  assert.match(editorTypes, new RegExp(`${field}\\??\\s*:\\s*string`));
}

console.log('Adobe Fonts Settings source checks passed.');
