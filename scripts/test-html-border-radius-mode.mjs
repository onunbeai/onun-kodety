import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const adapter = await server.ssrLoadModule('/lib/html-editor/visual-style-adapter.ts');
  assert.equal(
    adapter.resolveHtmlBorderRadiusMode({ 'border-radius': '10px' }),
    'all',
  );
  assert.equal(
    adapter.resolveHtmlBorderRadiusMode({
      'border-top-left-radius': '10px',
      'border-top-right-radius': '10px',
      'border-bottom-right-radius': '10px',
      'border-bottom-left-radius': '10px',
    }),
    'individual',
  );
  assert.equal(
    adapter.resolveHtmlBorderRadiusMode({
      'border-radius': '6px',
      'border-top-left-radius': '10px',
    }),
    'individual',
  );
  assert.equal(
    adapter.resolveHtmlBorderRadiusMode({
      'border-top-left-radius': '10px',
      'border-radius': '6px',
    }),
    'all',
  );

  const controls = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/ycode-style/BorderControls.tsx'),
    'utf8',
  );
  assert.match(
    controls,
    /const radiusInputValues[\s\S]*?getCurrentValue:\s*\(prop: string\)[\s\S]*?radiusInputValues\[prop\]/,
    'radius mode changes must read the current local input draft',
  );
  assert.match(
    controls,
    /handleRadiusModeToggle[\s\S]*?cancelPendingDesignProperties\(radiusProperties\)[\s\S]*?radiusModeToggle\.handleToggle\(\)/,
    'radius mode changes must cancel delayed field writes first',
  );
  assert.match(
    controls,
    /scopeKey:\s*layer\?\.id/,
    'the HTML radius mode must be retained within the active selection only',
  );

  const inspector = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'),
    'utf8',
  );
  assert.match(
    inspector,
    /<HtmlKodetyBorderControls[\s\S]*?authoredValues=\{explicitStyles\}/,
    'radius mode inference must use authored declarations, not computed CSS fallbacks',
  );

  console.log('HTML border-radius mode regression tests passed.');
} finally {
  await server.close();
}
