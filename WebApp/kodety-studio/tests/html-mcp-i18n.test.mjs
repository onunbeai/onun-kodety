import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const source = await read('app/(builder)/kodety/html-editor/components/HtmlMcpSettingsContent.tsx');
const runtime = await read('Wordpress/kodety/admin/i18n.js');
const aliases = JSON.parse(await read('Wordpress/kodety/languages/admin-ui/aliases.json'));
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
const render = (type, props) => ({ type, props });
new Function('exports', 'require', code)(exports, name => name === 'react/jsx-runtime'
  ? { jsx: render, jsxs: render, Fragment: 'fragment' }
  : new Proxy({}, { get: (_target, property) => property }));
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [node] : [node, ...nodes(node.props?.children)];
const origin = 'https://studio.example.test:8443';
const props = { host: { mode: 'html', origin }, wordpress: { canManageIntegrations: true }, status: { enabled: true, browserStudio: true }, projectConnections: [] };
const text = hostProps => nodes(exports.HtmlMcpSettingsContent(hostProps)).filter(node => typeof node === 'string');
async function translator(locale) {
  const catalog = JSON.parse(await read(`Wordpress/kodety/languages/admin-ui/${locale}.json`));
  const window = { kodetyAdminI18n: { ...catalog, aliases } };
  vm.runInNewContext(runtime, { window, document: { readyState: 'loading', addEventListener() {} } });
  return window.kodetyTranslate;
}

test('the shared English runtime translates rendered HTML MCP copy and preserves the actual Studio origin', async () => {
  const translate = await translator('en');
  const translated = text(props).map(translate);
  for (const expected of [
    'Studio MCP connected',
    'Authorized connections use the Builder tools and save to your chosen folder. Keep the project open in your browser while working.',
    'Secure Studio MCP bridge',
    `The copied address uses ${origin} and reaches only this HTML project through the open tab. Keep this tab open while Codex, Claude or another MCP client is working.`,
    'Pages, components, animations and languages available in the Builder.',
    "No CMS, Analytics, PHP or external publishing. The connection requires the open tab and Studio's MCP server.",
  ]) assert.ok(translated.includes(expected), expected);
});

test('Portuguese MCP copy and the WordPress relay explanation remain available in the shared runtime', async () => {
  const translate = await translator('pt-BR');
  const originals = text(props);
  const translated = originals.map(translate);
  for (const expected of [
    'MCP do Studio conectado',
    'Conexões autorizadas usam as ferramentas do Builder e salvam na pasta escolhida. Mantenha o projeto aberto no navegador durante o trabalho.',
    'Ponte MCP segura do Studio',
    `O endereço copiado usa ${origin} e chega somente a este projeto HTML pela aba aberta. Mantenha esta aba aberta enquanto Codex, Claude ou outro cliente MCP estiver trabalhando.`,
    'Páginas, componentes, animações e idiomas disponíveis no Builder.',
    'Sem CMS, Análises, PHP ou publicação externa. A conexão depende da aba e do servidor MCP do Studio.',
  ]) assert.ok(translated.includes(expected), expected);
  const wordpress = text({ ...props, host: undefined, wordpress: { canManageIntegrations: true, projectConnectionUrl: '/wp-json/kodety/v1/connections', studio: { enabled: true } } });
  assert.ok(wordpress.includes('O Studio encaminha as chamadas externas para este WordPress local enquanto o projeto permanece aberto no navegador.'));
  assert.ok(wordpress.includes('O endereço copiado usa studio.kodety.com e chega a este projeto pelo navegador. Mantenha esta aba aberta enquanto Codex, Claude ou outro cliente MCP estiver trabalhando.'));
  assert.equal(wordpress.some(value => value.includes('este projeto HTML')), false);
});
