import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({ configFile: false, root, logLevel: 'silent', appType: 'custom', resolve: { alias: { '@': root } }, ssr: { noExternal: ['@gravity-ui/icons'] }, server: { middlewareMode: true, hmr: false } });
const { HtmlRedirectSettings } = await server.ssrLoadModule('/app/(builder)/kodety/html-editor/components/HtmlRedirectSettings.tsx');
after(() => server.close());
const render = props => renderToStaticMarkup(React.createElement(HtmlRedirectSettings, { value: { version: 1, entries: [] }, onChange() {}, ...props }));

test('HTML empty state defaults to English and explains provider export without promising generic HTTP status', () => {
  const html = render({ hostMode: 'html' });
  assert.match(html, /No redirects/);
  assert.match(html, /Add redirect/);
  assert.match(html, /Vercel and Cloudflare Pages/);
  assert.match(html, /vercel.json/);
  assert.match(html, /_redirects/);
  assert.match(html, /without returning the selected HTTP status/);
  assert.match(html, /text-balance/);
  assert.doesNotMatch(html, /WordPress|Nenhum redirecionamento/);
});

test('HTML Portuguese empty state retains direct localization and balanced description', () => {
  const html = render({ hostMode: 'html', language: 'pt' });
  assert.match(html, /Nenhum redirecionamento/);
  assert.match(html, /Adicionar redirecionamento/);
  assert.match(html, /sites HTML na Vercel e no Cloudflare Pages/);
  assert.match(html, /sem retornar o status HTTP selecionado/);
  assert.match(html, /data-kodety-no-i18n/);
});

test('WordPress remains the default and keeps its original copy without HTML hosting claims', () => {
  const original = render({});
  assert.match(original, /Encaminhe URLs antigas, campanhas e caminhos movidos sem perder visitantes ou autoridade de busca\./);
  assert.match(original, /Nenhum redirecionamento/);
  assert.doesNotMatch(original, /vercel.json|_redirects|data-kodety-html-redirect-hosting/);
  assert.equal(render({ hostMode: 'wordpress', language: 'en' }), original);
});

test('configured HTML redirects explain Cloudflare fallbacks only when these rules need them', () => {
  const entry = { id: 'rule-1', source: '/old', destination: '/new', status: 308, match: 'exact', preserveQuery: true, enabled: true };
  const direct = render({ hostMode: 'html', value: { version: 1, entries: [entry] } });
  assert.doesNotMatch(direct, /configure a Redirect Rule or Function/);
  const fallback = render({ hostMode: 'html', value: { version: 1, entries: [{ ...entry, preserveQuery: false }] } });
  assert.match(fallback, /configure a Redirect Rule or Function/);
  assert.match(fallback, /Save and deploy the exported files/);
});
