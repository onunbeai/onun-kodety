import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const tokens = await server.ssrLoadModule('/lib/html-editor/design-tokens.ts');
  assert.equal(tokens.designTokenTypeForProperty('transition-duration'), 'duration');
  assert.equal(tokens.designTokenTypeForProperty('transition-delay'), 'duration');
  assert.equal(tokens.designTokenTypeForProperty('animation-duration'), 'duration');
  assert.equal(tokens.designTokenTypeForProperty('animation-delay'), 'duration');
  assert.equal(tokens.designTokenDefaultValue('duration'), '0ms');

  for (const valid of ['180ms', '.25s', '-120ms', '120ms, 0.4s']) {
    assert.equal(tokens.isDesignTokenDurationValue(valid), true, `${valid} should be valid CSS time`);
  }
  for (const invalid of ['24px', '50%', '0', 'fast', '120ms, 2px']) {
    assert.equal(tokens.isDesignTokenDurationValue(invalid), false, `${invalid} must not be a duration`);
  }

  const durationToken = {
    id: 'motion-fast', collectionId: 'base', name: 'Motion / Fast',
    type: 'duration', value: '180ms',
  };
  assert.equal(tokens.isDesignTokenCompatible(durationToken, 'transition-duration'), true);
  assert.equal(tokens.isDesignTokenCompatible(durationToken, 'width'), false);
  assert.equal(tokens.isDesignTokenCompatible(
    { ...durationToken, id: 'legacy', type: 'size', value: '.25s' },
    'animation-delay',
  ), true);
  assert.equal(tokens.isDesignTokenCompatible(
    { ...durationToken, id: 'legacy-px', type: 'size', value: '24px' },
    'animation-delay',
  ), false);
  assert.equal(tokens.normalizeHtmlDesignTokens({
    version: 1,
    collections: [{ id: 'base', name: 'Base collection' }],
    tokens: [{ ...durationToken, id: 'legacy', type: 'size', value: '.25s' }],
  }).tokens[0].type, 'size', 'legacy token types must not be silently migrated');

  const uiSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlDesignTokens.tsx'),
    'utf8',
  );
  assert.match(uiSource, /duration:\s*Clock3/);
  assert.match(uiSource, /draft\.type === 'duration'[\s\S]*?isDesignTokenDurationValue/);
  assert.match(uiSource, /inputMode=\{draft\.type === 'duration' \? 'text' : 'decimal'\}/);

  console.log('Design token duration regression tests passed');
} finally {
  await server.close();
}
