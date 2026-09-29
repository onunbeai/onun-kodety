import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const relativePaths = {
  context: 'lib/color-variable-capability-context.tsx',
  designTokens: 'lib/html-editor/design-token-context.tsx',
  nextAdapter: 'app/(builder)/kodety/components/NextColorVariableCapabilityProvider.tsx',
  nextPicker: 'app/(builder)/kodety/components/ColorPicker.tsx',
  nextBorder: 'app/(builder)/kodety/components/BorderControls.tsx',
  htmlPicker: 'app/(builder)/kodety/html-editor/ycode-style/ColorPicker.tsx',
  htmlBorder: 'app/(builder)/kodety/html-editor/ycode-style/BorderControls.tsx',
};
const sources = Object.fromEntries(await Promise.all(
  Object.entries(relativePaths).map(async ([key, relativePath]) => [
    key,
    await readFile(path.join(root, relativePath), 'utf8'),
  ]),
));

for (const key of ['nextPicker', 'nextBorder', 'htmlPicker', 'htmlBorder']) {
  assert.doesNotMatch(
    sources[key],
    /(?:useColorVariablesStore|colorVariablesApi|@\/lib\/api)/,
    `${relativePaths[key]} must stay independent from a store or API transport`,
  );
  assert.match(
    sources[key],
    /useOptionalColorVariableCapability/,
    `${relativePaths[key]} must accept the optional capability context`,
  );
}

for (const key of ['nextPicker', 'htmlPicker']) {
  assert.match(sources[key], /colorVariableCapability\?: ColorVariableCapability \| null/);
  assert.match(
    sources[key],
    /supportsColorVariables && activeTab !== 'image'[\s\S]*?<ColorVariablesSection/,
    'missing capability must hide the variable section',
  );
  assert.match(
    sources[key],
    /capabilities\.list[\s\S]*?capabilities\.get/,
    'read-only capabilities must still expose variable selection',
  );
  assert.match(sources[key], /canCreate=\{Boolean\(colorVariableCapability\?\.capabilities\.create\)\}/);
  assert.match(sources[key], /canUpdate=\{Boolean\(colorVariableCapability\?\.capabilities\.update\)\}/);
  assert.match(sources[key], /canDelete=\{Boolean\(colorVariableCapability\?\.capabilities\.delete\)\}/);
  assert.match(sources[key], /canReorder=\{Boolean\(colorVariableCapability\?\.capabilities\.reorder\)\}/);
  assert.match(sources[key], /<TabsTrigger\b[^>]*\bvalue="solid"/);
  assert.match(sources[key], /<TabsTrigger\b[^>]*\bvalue="linear"/);
  assert.match(sources[key], /<TabsTrigger\b[^>]*\bvalue="radial"/);
}

for (const key of ['nextBorder', 'htmlBorder']) {
  assert.match(sources[key], /useColorVariableCapabilitySnapshot\(colorVariableCapability\)/);
  assert.match(sources[key], /designTokenIdFromReference\(reference\)/);
}

assert.match(sources.context, /useSyncExternalStore/);
assert.match(sources.context, /EMPTY_COLOR_VARIABLES/);
assert.match(sources.nextAdapter, /useColorVariablesStore/);
assert.match(sources.nextAdapter, /kind: 'next-legacy'/);
assert.match(sources.designTokens, /kind: 'html-design-tokens'/);
assert.match(
  sources.designTokens,
  /<ColorVariableCapabilityProvider capability=\{colorVariableCapability\}>/,
);

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  for (const key of ['context', 'designTokens', 'nextAdapter', 'nextPicker', 'nextBorder', 'htmlPicker', 'htmlBorder']) {
    const transformed = await server.transformRequest(`/${relativePaths[key]}`);
    assert.ok(transformed?.code, `${relativePaths[key]} must compile through Vite`);
  }

  const { createHtmlDesignTokenColorVariableCapability } = await server.ssrLoadModule(
    '/lib/html-editor/design-token-context.tsx',
  );
  const document = {
    version: 1,
    collections: [{ id: 'base', name: 'Base' }],
    tokens: [
      { id: 'brand', collectionId: 'base', name: 'Brand', type: 'color', value: '#112233' },
      { id: 'space', collectionId: 'base', name: 'Space', type: 'size', value: '8px' },
      { id: 'accent', collectionId: 'base', name: 'Accent', type: 'color', value: '#abcdef' },
    ],
  };

  const changes = [];
  const capability = createHtmlDesignTokenColorVariableCapability(
    document,
    next => changes.push(next),
  );
  assert.equal(capability.kind, 'html-design-tokens');
  assert.deepEqual(capability.capabilities, {
    list: true,
    get: true,
    subscribe: true,
    create: true,
    update: true,
    delete: true,
    reorder: true,
    previewOverride: false,
  });
  assert.deepEqual(capability.list().map(variable => variable.id), ['brand', 'accent']);
  assert.equal(capability.get('brand')?.value, '#112233');
  assert.equal(capability.get('space'), undefined);

  let capabilityNotifications = 0;
  const unsubscribeCapability = capability.subscribe(() => { capabilityNotifications += 1; });
  await capability.update('brand', { name: 'Primary', value: '#010203' });
  assert.equal(capability.get('brand')?.value, '#010203');
  assert.deepEqual(
    changes.at(-1).tokens.find(token => token.id === 'brand'),
    { id: 'brand', collectionId: 'base', name: 'Primary', type: 'color', value: '#010203' },
  );
  await capability.reorder(['accent', 'brand']);
  assert.deepEqual(changes.at(-1).tokens.map(token => token.id), ['accent', 'space', 'brand']);
  assert.equal(
    changes.at(-1).tokens.find(token => token.id === 'brand')?.value,
    '#010203',
    'sequential mutations must build on the capability current snapshot',
  );
  assert.equal(await capability.delete('space'), false, 'non-color tokens are outside this capability');
  assert.equal(await capability.delete('accent'), true);
  assert.equal(changes.at(-1).tokens.some(token => token.id === 'accent'), false);
  const created = await capability.create('Highlight', '#fedcba');
  assert.equal(created?.name, 'Highlight');
  assert.equal(changes.at(-1).tokens.at(-1).id, created?.id);
  assert.doesNotThrow(() => capability.setPreviewOverride({ id: 'brand', value: '#ffffff' }));
  unsubscribeCapability();
  assert.equal(capabilityNotifications, 4, 'update, reorder, delete and create must notify subscribers');

  const { designTokenIdFromReference } = await server.ssrLoadModule(
    '/lib/html-editor/design-tokens.ts',
  );
  assert.equal(
    designTokenIdFromReference('var( --kodety-token-brand, #000000 )'),
    'brand',
    'border controls share the canonical fallback-aware token parser',
  );

  const nextModule = await server.ssrLoadModule(
    '/app/(builder)/kodety/components/NextColorVariableCapabilityProvider.tsx',
  );
  const storeModule = await server.ssrLoadModule('/stores/useColorVariablesStore.ts');
  const { nextColorVariableCapability } = nextModule;
  const { useColorVariablesStore } = storeModule;
  useColorVariablesStore.setState({
    colorVariables: [{
      id: 'legacy-brand',
      name: 'Legacy brand',
      value: '#334455',
      sort_order: 0,
      created_at: '',
      updated_at: '',
    }],
  });
  assert.equal(nextColorVariableCapability.list()[0].id, 'legacy-brand');
  assert.equal(nextColorVariableCapability.get('legacy-brand')?.value, '#334455');
  let notifications = 0;
  const unsubscribe = nextColorVariableCapability.subscribe(() => { notifications += 1; });
  useColorVariablesStore.setState({ previewOverride: { id: 'legacy-brand', value: '#ffffff' } });
  unsubscribe();
  assert.equal(notifications, 1);

  console.log('Color variable capability controls passed.');
} finally {
  await server.close();
}
