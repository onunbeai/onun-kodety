import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from '../../../scripts/vite-code-component-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true } });
const { prepareStaticHtmlProject, staticHtmlRoutes } = await server.ssrLoadModule('/lib/html-editor/static-project.ts');
const { updateEditorMetadata, readEditorMetadata } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
const { createLocale, defaultLocalization, normalizeLocalization } = await server.ssrLoadModule('/lib/html-editor/localization.ts');
const { prepareStaticRedirects, staticRedirectWarnings } = await server.ssrLoadModule('/lib/html-editor/static-redirects.ts');
after(() => server.close());

const selector = '<div data-kodety-locale-selector><span data-kodety-locale-current>Português</span><div data-kodety-locale-options><a class="language-option" href="#" data-kodety-locale-option>Português</a></div></div>';
const html = `<html lang="pt-BR"><head><title>Origem</title><meta name="description" content="Original"><link rel="stylesheet" href="style.css"></head><body><h1 data-kodety-l10n-id="heading">Olá</h1><a id="about" href="about.html?ref=menu#team">Sobre</a><a id="anchor" href="#heading">Aqui</a><img src="images/photo.png">${selector}<script type="module">import './module.js'</script></body></html>`;
function project(overrides = {}) {
  const files = Object.fromEntries(Object.entries({ 'index.html': html, 'about.html': html, 'draft.html': html, 'style.css': 'h1{color:red}', 'module.js': 'export const value=1', 'images/photo.png': undefined, ...overrides }).map(([path, text]) => [path, { path, mimeType: path.endsWith('.html') ? 'text/html' : 'text/plain', ...(text === undefined ? { data: Uint8Array.from([0, 255, 1]) } : { text }) }]));
  return { name: 'Site', mainHtmlPath: 'index.html', rootPath: '', openedAt: 1, files };
}
function localizedProject() {
  const localization = { ...defaultLocalization('pt-BR'), automaticLocale: true, rememberLocale: true, translatePagePaths: true, locales: [createLocale('pt-BR'), { ...createLocale('en-US'), slug: 'en' }, { ...createLocale('ar-SA'), slug: 'ar', fallback: 'en-US' }], translations: {
    'en-US': { siteTitle: 'Example', pages: { 'index.html': { entries: { 'id:heading:text': 'Hello' }, title: 'Home', description: 'English page', stylesheet: 'locale-en.css' }, 'about.html': { entries: { 'id:heading:text': 'About us' }, path: 'company/about', title: 'About' } } },
    'ar-SA': { pages: { 'index.html': { entries: { 'id:heading:text': 'مرحبا' } } } },
  } };
  return updateEditorMetadata(project({ 'locale-en.css': 'h1{color:blue}' }), metadata => ({ ...metadata, projectId: 'test-site', localization, siteSettings: { siteTitle: 'Exemplo', baseUrl: 'https://example.com/site', sitemapEnabled: true, googleSiteVerification: 'verification', robotsTxtRules: 'User-agent: *\nAllow: /' }, pageStatuses: { 'draft.html': 'draft' }, pageSettings: { 'index.html': { title: 'Início' }, 'about.html': { title: 'Sobre', includeInSitemap: false } } }));
}
function nodes(source) { const values=[]; const visit=node=>{values.push(node);node.childNodes?.forEach(visit)};visit(parse(source));return values; }
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const tag = (source, name, filter = () => true) => nodes(source).find(node => node.tagName === name && filter(node));
const content = (node) => (node.childNodes || []).map(child => child.value || content(child)).join('');

test('emits source, translated paths, fallback translations and RTL using shared compiler without changing source', () => {
  const source = localizedProject();
  const original = JSON.stringify(source);
  const output = prepareStaticHtmlProject(source);
  assert.equal(JSON.stringify(source), original);
  assert.ok(output.files['index.html']);
  assert.ok(output.files['en/index.html']);
  assert.ok(output.files['en/company/about/index.html']);
  assert.ok(output.files['ar/index.html']);
  assert.equal(output.files['draft.html'], undefined);
  assert.equal(output.files['en/draft.html'], undefined);
  assert.equal(content(tag(output.files['en/index.html'].text, 'h1')), 'Hello');
  assert.equal(content(tag(output.files['ar/index.html'].text, 'h1')), 'مرحبا');
  assert.equal(attr(tag(output.files['ar/index.html'].text, 'html'), 'dir'), 'rtl');
  assert.equal(content(tag(output.files['ar/company/about/index.html'].text, 'h1')), 'About us');
  assert.deepEqual(output.files['images/photo.png'].data, source.files['images/photo.png'].data);
  assert.deepEqual(readEditorMetadata(output).localization, JSON.parse(JSON.stringify(normalizeLocalization(readEditorMetadata(source).localization))));
});

test('locale asset base preserves CSS, binary assets, inline imports and navigation with query/hash', () => {
  const output = prepareStaticHtmlProject(localizedProject());
  const source = output.files['en/index.html'].text;
  const url = 'https://example.com/site/en/index.html';
  const base = new URL(attr(tag(source, 'base'), 'href'), url);
  assert.equal(new URL(attr(tag(source, 'link', node => attr(node, 'rel') === 'stylesheet'), 'href'), base).href, 'https://example.com/site/style.css');
  assert.equal(new URL(attr(tag(source, 'img'), 'src'), base).href, 'https://example.com/site/images/photo.png');
  assert.equal(new URL(attr(tag(source, 'a', node => attr(node, 'id') === 'about'), 'href'), base).href, 'https://example.com/site/en/company/about/index.html?ref=menu#team');
  assert.equal(new URL(attr(tag(source, 'a', node => attr(node, 'id') === 'anchor'), 'href'), base).href, 'https://example.com/site/en/index.html#heading');
  const overlay = tag(source, 'link', node => (attr(node, 'href') || '').includes('locale-en.css'));
  assert.equal(new URL(attr(overlay, 'href'), base).href, 'https://example.com/site/locale-en.css');
  assert.match(source, /import '\.\/module\.js'/);
});

test('translated SEO, canonical, hreflang, social tags and sitemap point to physical static routes', () => {
  const output = prepareStaticHtmlProject(localizedProject());
  const source = output.files['en/index.html'].text;
  assert.match(content(tag(source, 'title')), /Home.*Example/);
  assert.equal(attr(tag(source, 'link', node => attr(node, 'rel') === 'canonical'), 'href'), 'https://example.com/site/en/');
  assert.equal(attr(tag(source, 'meta', node => attr(node, 'property') === 'og:description'), 'content'), 'English page');
  assert.equal(attr(tag(source, 'meta', node => attr(node, 'name') === 'google-site-verification'), 'content'), 'verification');
  const alternates = nodes(source).filter(node => node.tagName === 'link' && attr(node, 'rel') === 'alternate');
  assert.deepEqual(alternates.map(node => attr(node, 'hreflang')), ['pt-BR', 'en-US', 'ar-SA', 'x-default']);
  assert.match(output.files['sitemap.xml'].text, /https:\/\/example.com\/site\/en\//);
  assert.doesNotMatch(output.files['sitemap.xml'].text, /about|draft/);
  assert.match(output.files['robots.txt'].text, /Sitemap: https:\/\/example.com\/site\/sitemap.xml/);
});

test('native locale selectors keep styling and link directly to matching pages, including default locale', () => {
  const output = prepareStaticHtmlProject(localizedProject());
  const source = output.files['en/company/about/index.html'].text;
  const base = new URL(attr(tag(source, 'base'), 'href'), 'https://example.com/site/en/company/about/index.html');
  const options = nodes(source).filter(node => node.tagName === 'a' && attr(node, 'data-kodety-locale-option') !== undefined);
  assert.equal(options.length, 3);
  assert.equal(attr(options[1], 'class'), 'language-option');
  assert.equal(attr(options[1], 'aria-current'), 'page');
  assert.equal(new URL(attr(options[0], 'href'), base).href, 'https://example.com/site/about.html');
  assert.equal(new URL(attr(options[2], 'href'), base).href, 'https://example.com/site/ar/company/about/index.html');
});

test('automatic locale runtime supports remembered selection, query opt-in and blocked storage', () => {
  const output = prepareStaticHtmlProject(localizedProject());
  const script = tag(output.files['index.html'].text, 'script', node => attr(node, 'data-kodety-static-localization') !== undefined);
  const config = attr(script, 'data-config');
  const execute = ({ remembered = '', blocked = false, search = '', languages = ['en-GB'] } = {}) => {
    let redirected;
    const location = { href: `https://example.com/site/index.html${search}#heading`, search, hash: '#heading', replace: value => redirected = value };
    const context = { document: { currentScript: { dataset: { config } }, baseURI: 'https://example.com/site/index.html', addEventListener() {} }, URL, URLSearchParams, location, navigator: { languages }, localStorage: { getItem() { if (blocked) throw new Error('blocked'); return remembered; } } };
    vm.runInNewContext(content(script), context);
    return redirected;
  };
  assert.equal(execute(), 'https://example.com/site/en/index.html#heading');
  assert.equal(execute({ remembered: 'pt-BR' }), undefined);
  assert.equal(execute({ blocked: true, search: '?campaign=hello' }), 'https://example.com/site/en/index.html?campaign=hello#heading');
  assert.equal(execute({ search: '?lang=ar-SA&campaign=hello' }), 'https://example.com/site/ar/index.html?campaign=hello#heading');
});

test('changing default locale compiles translated root, keeps source under prefix, excludes disabled locales', () => {
  const source = updateEditorMetadata(localizedProject(), metadata => ({ ...metadata, localization: { ...metadata.localization, defaultLocale: 'en-US', locales: metadata.localization.locales.map(locale => ({ ...locale, enabled: locale.code !== 'ar-SA', slug: locale.code === 'pt-BR' ? 'pt' : locale.slug })) } }));
  const output = prepareStaticHtmlProject(source);
  assert.equal(content(tag(output.files['index.html'].text, 'h1')), 'Hello');
  assert.equal(content(tag(output.files['pt/index.html'].text, 'h1')), 'Olá');
  assert.equal(output.files['ar/index.html'], undefined);
  assert.equal(output.mainHtmlPath, 'index.html');
});

test('colliding locale URLs are rejected instead of silently overwriting pages', () => {
  const source = updateEditorMetadata(localizedProject(), metadata => ({ ...metadata, localization: { ...metadata.localization, translations: { ...metadata.localization.translations, 'en-US': { pages: { 'index.html': { entries: {}, path: 'same' }, 'about.html': { entries: {}, path: 'same' } } } } } }));
  assert.throws(() => staticHtmlRoutes(source), /mesma URL/);
});

test('unconfigured imports preserve source HTML and disabled sitemap does not generate an empty file', () => {
  const source = project();
  const output = prepareStaticHtmlProject(source);
  assert.match(output.files['index.html'].text, /<title>Origem<\/title>/);
  assert.equal(output.files['sitemap.xml'], undefined);
  const configured = updateEditorMetadata(project(), metadata => ({ ...metadata, siteSettings: { baseUrl: 'https://example.com', sitemapEnabled: false, defaultIndex: false } }));
  const hidden = prepareStaticHtmlProject(configured);
  assert.equal(hidden.files['sitemap.xml'], undefined);
  assert.match(hidden.files['robots.txt'].text, /Disallow: \//);
  assert.doesNotMatch(hidden.files['robots.txt'].text, /Sitemap:/);
});

const redirect = (source, destination, overrides = {}) => ({ id: source, source, destination, match: 'exact', status: 301, preserveQuery: true, enabled: true, ...overrides });
const redirectSettings = entries => ({ version: 1, entries });
function executeRedirect(source, href) {
  const script = tag(source, 'script', node => attr(node, 'data-kodety-static-redirects') !== undefined);
  let target;
  vm.runInNewContext(content(script), { URL, Set, RegExp, decodeURIComponent, document: { currentScript: { dataset: { config: attr(script, 'data-config') } } }, location: { href, replace: value => target = value } });
  return target;
}

test('redirect export merges native provider configuration without overwriting existing author rules', () => {
  const source = project({ '_redirects': '# My redirects\n/authored /kept 302\n', 'vercel.json': JSON.stringify({ headers: [{ source: '/assets', headers: [] }], redirects: [{ source: '/authored', destination: '/kept', statusCode: 302 }] }) });
  const original = JSON.stringify(source);
  const output = prepareStaticRedirects(source, redirectSettings([redirect('/old', '/about.html', { status: 308 }), redirect('/blog', '/news', { match: 'prefix' }), redirect('/docs/*/old/*', '/docs/*/new/*', { match: 'wildcard' })]));
  assert.equal(JSON.stringify(source), original);
  assert.match(output.files['_redirects'].text, /\/authored \/kept 302/);
  assert.match(output.files['_redirects'].text, /\/old \/about.html 308/);
  assert.match(output.files['_redirects'].text, /\/blog\/\* \/news\/:splat 301/);
  const config = JSON.parse(output.files['vercel.json'].text);
  assert.equal(config.headers[0].source, '/assets');
  assert.equal(config.redirects[0].destination, '/kept');
  assert.ok(config.redirects.some(entry => entry.source === '/docs/:kodety0(.*)/old/:kodety1(.*)' && entry.destination === '/docs/:kodety0/new/:kodety1'));
  assert.ok(output.files['old/index.html']);
  assert.ok(output.files['404.html']);
  assert.match(output.files['kodety-hosting-notes.txt'].text, /Cloudflare/);
});

test('portable redirect fallbacks preserve/drop query, retain destination keys, and resolve .html on generic hosts', () => {
  const settings = redirectSettings([redirect('/old', '/about?fixed=yes'), redirect('/private', '/about', { preserveQuery: false })]);
  const output = prepareStaticRedirects(project(), settings, 'https://example.com/site');
  assert.equal(executeRedirect(output.files['old/index.html'].text, 'https://example.com/site/old/?fixed=no&campaign=x#team'), 'https://example.com/site/about.html?fixed=yes&campaign=x#team');
  assert.equal(executeRedirect(output.files['private/index.html'].text, 'https://example.com/site/private/?secret=x'), 'https://example.com/site/about.html');
  assert.equal(executeRedirect(output.files['index.html'].text, 'https://example.com/site/index.html'), undefined);
  const config = JSON.parse(output.files['vercel.json'].text);
  assert.equal(config.routes[0].headers.Location, '/about');
  assert.equal(config.routes[0].status, 301);
  assert.match(staticRedirectWarnings(settings).join(' '), /parâmetros/);
});

test('portable 404 fallback handles prefix and multiple wildcard captures without a WordPress server', () => {
  const output = prepareStaticRedirects(project(), redirectSettings([redirect('/blog', '/news', { match: 'prefix' }), redirect('/docs/*/old/*', 'https://docs.example.com/*/new/*', { match: 'wildcard' })]), 'https://example.com/site');
  assert.equal(executeRedirect(output.files['404.html'].text, 'https://example.com/site/blog/2026/post?ref=x'), 'https://example.com/site/news/2026/post?ref=x');
  assert.equal(executeRedirect(output.files['404.html'].text, 'https://example.com/site/docs/en/old/setup?ref=x'), 'https://docs.example.com/en/new/setup?ref=x');
  assert.equal(executeRedirect(output.files['404.html'].text, 'https://example.com/site/missing'), undefined);
});

test('invalid redirect cycles, malformed authored config and Cloudflare limits fail before producing changed files', () => {
  assert.throws(() => prepareStaticRedirects(project(), redirectSettings([redirect('/a', '/b'), redirect('/b', '/a')])), /ciclo|cycle/i);
  assert.throws(() => prepareStaticRedirects(project({ 'vercel.json': '{bad json' }), redirectSettings([redirect('/a', '/about')])) , /vercel.json/);
  const rules = Array.from({ length: 101 }, (_, index) => redirect(`/source${index}/*`, `/target${index}/*`, { match: 'wildcard' }));
  assert.throws(() => prepareStaticRedirects(project(), redirectSettings(rules)), /Cloudflare Pages/);
});
