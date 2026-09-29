/**
 * Local visual review of the real WordPress application build. The page uses
 * the production entry/manifest unchanged; only WordPress transport is mocked.
 * The project contains an empty body. Nothing is saved or published to a site.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(import.meta.dirname, '..');
const assets = path.join(root, 'Wordpress/kodety/assets');
const projectId = 'kodety-local-onboarding-preview';
const digest = 'a'.repeat(64);
const sourceFiles = {
  'index.html': '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página inicial</title><link rel="stylesheet" href="styles.css"></head><body></body></html>',
  'styles.css': '*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fff}body{min-height:100vh}',
  '.incode/project.json': JSON.stringify({ version: 1, projectId, name: 'Projeto vazio', mainHtmlPath: 'index.html', homeHtmlPath: 'index.html', rootPath: '',
    createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', breakpointSchemaVersion: 2,
    primaryBreakpoint: { id: 'base', label: 'Primary', mode: 'max-width', width: 1440 },
    breakpoints: [{ id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 }, { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 480 }],
    siteSettings: { betaFeatures: { infiniteCanvas: true } } }),
};
const project = { name: 'Projeto vazio', mainHtmlPath: 'index.html', rootPath: '', files: Object.fromEntries(Object.entries(sourceFiles).map(([file, text]) => [file, {
  path: file, mimeType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/json', text,
}])) };
const zip = new JSZip();
for (const [name, text] of Object.entries(sourceFiles)) zip.file(name, text);
const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
const preferences = new Map();
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const json = (response, payload, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(payload));
const readBody = async request => { const parts = []; for await (const part of request) parts.push(part); return Buffer.concat(parts); };

function configFor(url) {
  const origin = url.origin;
  const appView = url.pathname.split('/').filter(Boolean)[1] || 'editor';
  const endpoint = name => `${origin}/__preview/${name}`;
  return {
    appView, nonce: 'local-preview-only', siteUrl: origin, projectId, projectName: 'Projeto vazio', initialHtmlPath: 'index.html',
    editorUrl: `${origin}/kodety/editor/`, cmsUrl: `${origin}/kodety/cms/`, settingsUrl: `${origin}/kodety/settings/`,
    analyticsUrl: `${origin}/kodety/analytics/`,
    dashboardUrl: `${origin}/kodety/editor/`, projectUrl: endpoint('project'), projectDownloadUrl: endpoint('project.zip'), projectSurfaceUrl: endpoint('project-surface'),
    publishUrl: endpoint('publish'), cmsSchemaUrl: endpoint('cms/schema'), cmsItemsUrl: endpoint('cms/items'),
    cmsCollectionsUrl: endpoint('cms/collections'), cmsFieldsUrl: endpoint('cms/fields'), canManageCmsSchema: true,
    googleFontsUrl: endpoint('fonts/google'), adobeFontsUrl: endpoint('fonts/adobe'),
    analyticsOverviewUrl: endpoint('analytics/overview'), analyticsFunnelsUrl: endpoint('analytics/funnels'),
    analyticsPageInsightsUrl: endpoint('analytics/page-insights'), analyticsExperimentsUrl: endpoint('analytics/experiments'),
    canViewAnalytics: true, analyticsDemoMode: false, adobeFontsLicensed: true,
    product: { edition: 'pro', licensed: true, licenseStatus: 'active', features: { analytics: true, analyticsAdvanced: true, analyticsAbTests: true, localization: false, cms: true, customCode: true, imageCompression: true, imageConversion: true }, limits: {}, upgradeUrl: endpoint('unavailable'), licenseUrl: endpoint('unavailable') },
    updates: { currentVersion: 'preview', latestVersion: 'preview', updateAvailable: false, checkedAt: '', pageUrl: endpoint('updates'), statusUrl: endpoint('updates'), checkUrl: endpoint('updates') },
    onboarding: { userId: 17, preference: preferences.get(17) || 'unseen', preferenceUrl: endpoint('onboarding') },
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    if (url.pathname.startsWith('/__preview/')) {
      const route = url.pathname.slice('/__preview/'.length);
      if (!['GET', 'HEAD'].includes(request.method) && !['project', 'onboarding'].includes(route)) {
        return json(response, { success: false, message: 'Esta prévia não grava alterações nem executa ações externas.' }, 403);
      }
      if (route === 'onboarding') {
        if (request.method === 'POST') {
          const body = JSON.parse((await readBody(request)).toString() || '{}');
          const order = ['unseen', 'started', 'completed', 'dismissed'];
          if (order.includes(body.preference)) preferences.set(17, order[Math.max(order.indexOf(preferences.get(17) || 'unseen'), order.indexOf(body.preference))]);
        }
        return json(response, { success: true, preference: preferences.get(17) || 'unseen' });
      }
      if (route === 'updates') return json(response, { currentVersion: 'preview', latestVersion: 'preview', updateAvailable: false, checkedAt: '' });
      if (route === 'fonts/google') return json(response, { items: [], fonts: [] });
      if (route === 'fonts/adobe') return json(response, { projects: [], fonts: [], configured: false });
      if (route === 'cms/schema') return json(response, { types: [{ slug: 'post', name: 'Posts', singular: 'Post', restBase: 'posts', itemCount: 0, fields: [
        { key: 'title', label: 'Título', type: 'text', source: 'wordpress' },
        { key: 'content', label: 'Conteúdo', type: 'richtext', source: 'wordpress' },
        { key: 'slug', label: 'Slug', type: 'text', source: 'wordpress' },
      ], capabilities: { create: true, publish: true } }], customFields: { active: false, plugin: '' }, templates: {}, revision: 'preview' });
      if (route.startsWith('cms/items')) return json(response, { items: [], total: 0, totalPages: 1, page: 1 });
      if (route.startsWith('cms/fields')) return json(response, { fields: [], revision: 'preview' });
      if (route === 'project' && request.method === 'GET') return json(response, { success: true, zip: archive.toString('base64'), name: project.name, workspaceRevision: 1, templateDigest: digest, cssDigest: digest });
      if (route === 'project' && request.method === 'POST') {
        await readBody(request);
        // Exercise the editor's navigation acknowledgement without writing a
        // project to disk or contacting WordPress. Reload always starts empty.
        return json(response, { success: true, projectId, workspaceRevision: 1, templateDigest: digest, cssDigest: digest });
      }
      if (route.startsWith('analytics/')) return json(response, { success: true, data: [], items: [], pages: [], events: [], totals: {}, funnels: [] });
      if (route === 'members/overview') return json(response, { enabled: true, memberCount: 0, activeMemberCount: 0, planCount: 0, capabilities: { manageMembers: true, createMembers: true, assignPlans: true, manageCommerce: true, managePlans: true, manageSettings: true } });
      if (route === 'members/settings') return json(response, { settings: { enabled: true, enabledProjects: [projectId], registrationEnabled: false, defaultRole: 'subscriber', auditRetentionDays: 180, eventRetentionDays: 180 } });
      if (route.startsWith('members/')) return json(response, { items: [], members: [], plans: [], providers: [], connections: [], mappings: [], total: 0, totalPages: 1, page: 1 });
      if (route === 'templates') return json(response, { items: [], templates: [] });
      return json(response, { success: false, message: 'Ação indisponível nesta prévia local.' }, 403);
    }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/kodety/assets/')) {
      const relative = decodeURIComponent(url.pathname.replace(/^\/kodety\/assets\//, '/').slice(1));
      const file = path.resolve(assets, relative);
      if (!file.startsWith(`${assets}${path.sep}`) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(file)); return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
    const entry = manifest['Wordpress/editor/main.tsx'];
    if (!entry) throw new Error('Execute npm run wordpress:assets antes de abrir esta prévia.');
    const styles = new Set();
    const visited = new Set();
    function collect(key) {
      if (visited.has(key)) return;
      visited.add(key);
      const chunk = manifest[key];
      for (const css of chunk?.css || []) styles.add(css);
      for (const dependency of chunk?.imports || []) collect(dependency);
    }
    collect('Wordpress/editor/main.tsx');
    const config = JSON.stringify(configFor(url)).replaceAll('<', '\\u003c');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html lang="pt-BR" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kodety — prévia local do Builder</title>${[...styles].map(css => `<link rel="stylesheet" href="/${css}">`).join('')}</head><body class="kodety-wordpress-editor"><div id="kodety-root"></div><script>window.kodetyWordPress=${config};window.kodetyOnboardingLocalPreview=true;</script><script type="module" src="/${entry.file}"></script></body></html>`);
  } catch (error) {
    if (!response.headersSent) json(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    else response.end();
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.KODETY_ONBOARDING_PREVIEW_PORT) || 0, '127.0.0.1', resolve); });
console.log(`REAL Builder preview: http://127.0.0.1:${server.address().port}/kodety/editor/`);
console.log('Uses the WordPress production entry and real editor controls. Empty HTML body; local mock transport only. Rebuild wordpress:assets and reload to review source changes.');
await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
await new Promise(resolve => server.close(resolve));
