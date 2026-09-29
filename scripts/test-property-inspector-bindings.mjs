import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: {
    alias: {
      '@gravity-ui/icons': path.join(
        root,
        'scripts/fixtures/property-inspector-icons-stub.ts',
      ),
    },
  },
  server: { middlewareMode: true },
});

try {
  const { PropertyInspector } = await server.ssrLoadModule(
    '/packages/property-inspector/src/index.tsx',
  );
  const schema = {
    implicit: { type: 'string', title: 'Implicit', defaultValue: '' },
    disabled: {
      type: 'string',
      title: 'Disabled',
      defaultValue: '',
      bindable: false,
    },
    enabled: {
      type: 'string',
      title: 'Enabled',
      defaultValue: '',
      bindable: true,
    },
  };
  const render = (extra = {}) => renderToStaticMarkup(React.createElement(
    PropertyInspector,
    {
      schema,
      values: {},
      breakpoint: 'base',
      onChange() {},
      onBindingChange() {},
      async onRequestBinding() { return null; },
      ...extra,
    },
  ));

  const fresh = render();
  assert.equal(
    (fresh.match(/aria-label="Conectar dados"/g) || []).length,
    1,
    'CMS binding must be opt-in through bindable: true',
  );
  assert.match(fresh, /Enabled[\s\S]*?aria-label="Conectar dados"/);
  assert.doesNotMatch(fresh, /Implicit[\s\S]*?aria-label="Conectar dados"[\s\S]*?Disabled/);

  const legacy = render({
    bindings: {
      implicit: {
        type: 'cms-field',
        sourceId: 'posts',
        fieldId: 'title',
      },
    },
  });
  assert.match(
    legacy,
    /Implicit[\s\S]*?aria-label="Editar conexão de dados"/,
    'legacy bindings stay removable after the control becomes opt-in',
  );
  assert.match(legacy, /Conectado a posts · title/);

  console.log('property-inspector-bindings: ok');
} finally {
  await server.close();
}
