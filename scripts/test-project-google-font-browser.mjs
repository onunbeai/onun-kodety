import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

// Opt-in real-network proof. It uses a fresh Chromium profile, serves all
// project files in memory and allows external requests to Google's font hosts
// only. Never sends the imported text as a Google Fonts `text` query parameter.
const payloadPath = process.argv[2];
if (!payloadPath) throw new Error('Pass the path to a Figma export JSON to run the browser proof.');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true, hmr: false } });
let browser;
try {
  const { importKodetyFigmaPayload } = await server.ssrLoadModule('/lib/figma/html-import.ts');
  const io = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const catalog = [
    { family: 'Sora', variants: ['100', '200', '300', 'regular', '500', '600', '700', '800'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 800 }] },
    { family: 'DM Sans', variants: ['regular', 'italic', '500', '500italic', '600'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 1000 }] },
    { family: 'Inter', variants: ['regular', '500', '600', '700'], category: 'sans-serif', axes: [{ tag: 'wght', start: 100, end: 900 }] },
  ];
  const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
  const imported = await importKodetyFigmaPayload(io.createBlankProject('Google font browser proof'), payload,
    { targetPath: '0', googleFontsCatalog: catalog });
  const project = io.prepareProjectForTransport(imported.project);
  const origin = 'https://kodety-font-check.invalid';
  const checks = [{ family: 'Sora', weight: 600 }, { family: 'DM Sans', weight: 400 }, { family: 'Inter', weight: 500 }];
  for (const check of checks) assert.ok(io.projectGoogleFonts(project).some(font => font.family === check.family));
  const failures = [];
  const remoteRequests = [];
  const blockedHosts = new Set();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      const path = decodeURIComponent(url.pathname.slice(1)) || project.mainHtmlPath;
      const file = project.files[path];
      if (!file) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: file.mimeType,
        headers: {
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'none'; connect-src 'none'",
        },
        body: file.text !== undefined ? file.text : Buffer.from(file.data || []),
      });
    }
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password
      && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
      && !url.searchParams.has('text')) {
      remoteRequests.push({ host: url.hostname, url: url.href });
      return route.continue();
    }
    blockedHosts.add(url.hostname);
    return route.abort();
  });
  page.on('requestfailed', request => {
    const host = new URL(request.url()).hostname;
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)) failures.push({ host, error: request.failure()?.errorText });
  });
  await page.goto(`${origin}/${project.mainHtmlPath}`, { waitUntil: 'networkidle', timeout: 45000 });
  const results = await page.evaluate(async checks => {
    return Promise.all(checks.map(async check => {
      const query = `${check.weight} 24px "${check.family}"`;
      try {
        const faces = await Promise.race([
          document.fonts.load(query, 'Aa'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Font loading timed out')), 15000)),
        ]);
        return { ...check, check: document.fonts.check(query, 'Aa'),
          faces: faces.map(face => ({ family: face.family, weight: face.weight, style: face.style, status: face.status })),
          loaded: faces.length > 0 && faces.every(face => face.status === 'loaded') };
      } catch (error) {
        return { ...check, check: document.fonts.check(query, 'Aa'), loaded: false, error: String(error) };
      }
    }));
  }, checks);
  console.log(JSON.stringify({ importedGoogleFonts: imported.googleFonts, missingFonts: imported.missingFonts,
    results, fontSetStatus: await page.evaluate(() => document.fonts.status),
    requests: remoteRequests.map(request => request.host), failures, blockedHosts: [...blockedHosts] }, null, 2));
  assert.ok(remoteRequests.some(request => request.host === 'fonts.gstatic.com'), 'Must fetch actual font binaries, not merely report CSS-family presence');
  assert.ok(results.every(result => result.loaded && result.check), 'All requested Google font faces must actually load');
} finally {
  await browser?.close();
  await server.close();
}
