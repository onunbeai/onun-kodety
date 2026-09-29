import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const [projectDirectory, faviconSource, socialImageSource] = process.argv.slice(2);
if (!projectDirectory || !faviconSource || !socialImageSource) {
  throw new Error('Uso: node scripts/configure-project-seo.mjs <projeto> <favicon> <social-preview>');
}

const brand = 'Koria';
const title = 'Koria — Brand Sprints for Ambitious Companies';
const description = 'Brand sprints for ambitious companies ready to move beyond expectations and become what they’re meant to be.';
const faviconPath = 'images/koria-favicon.png';
const socialImagePath = 'images/koria-social-preview.png';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root: repositoryRoot,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

function pageTitle(file) {
  if (/^index\.html?$/i.test(file)) return title;
  const labels = {
    '401.html': `Authentication Required — ${brand}`,
    '404.html': `Page Not Found — ${brand}`,
    'about-us.html': `About Us — ${brand}`,
    'blog.html': `Blog — ${brand}`,
    'contact.html': `Contact — ${brand}`,
    'detail_blog.html': `Blog Article — ${brand}`,
    'feature.html': `Features — ${brand}`,
    'novo.html': `New — ${brand}`,
    'page-18.html': `Page 18 — ${brand}`,
    'pricing.html': `Pricing — ${brand}`,
    'privacy-policy.html': `Privacy Policy — ${brand}`,
    'refund-policy.html': `Refund Policy — ${brand}`,
    'terms-condition.html': `Terms & Conditions — ${brand}`,
  };
  const fallback = file
    .replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
  return labels[file] || `${fallback} — ${brand}`;
}

function removeImportedSeo(html) {
  return html
    .replace(/\s*<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<link\b(?=[^>]*\brel=["']apple-touch-icon["'])[^>]*>/gi, '');
}

function addAppleTouchIcon(html) {
  const tag = `<link rel="apple-touch-icon" href="${faviconPath}" data-kodety-seo="apple-touch-icon">`;
  return html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}

try {
  const seo = await server.ssrLoadModule('/lib/html-editor/seo-settings.ts');
  const metadataPath = path.join(projectDirectory, '.incode/project.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const siteSettings = {
    ...(metadata.siteSettings || {}),
    siteTitle: brand,
    description,
    language: 'en',
    titleTemplate: '%page%',
    socialImage: socialImagePath,
    faviconLight: faviconPath,
    faviconDark: faviconPath,
    organizationName: brand,
  };

  await mkdir(path.join(projectDirectory, 'images'), { recursive: true });
  await copyFile(faviconSource, path.join(projectDirectory, faviconPath));
  await copyFile(socialImageSource, path.join(projectDirectory, socialImagePath));

  const htmlFiles = (await readdir(projectDirectory)).filter(file => /\.html?$/i.test(file));
  const pageSettings = { ...(metadata.pageSettings || {}) };
  for (const file of htmlFiles) {
    const filePath = path.join(projectDirectory, file);
    const source = removeImportedSeo(await readFile(filePath, 'utf8'));
    const current = { ...seo.readPageSeoFromHtml(source), ...(pageSettings[file] || {}) };
    const next = {
      ...current,
      title: pageTitle(file),
      description,
      socialTitle: pageTitle(file),
      socialDescription: description,
      socialImage: socialImagePath,
      schemaType: 'WebPage',
    };
    pageSettings[file] = next;
    await writeFile(filePath, addAppleTouchIcon(seo.applySeoToHtml(source, file, siteSettings, next)));
  }

  await writeFile(metadataPath, JSON.stringify({
    ...metadata,
    updatedAt: new Date().toISOString(),
    siteSettings,
    pageSettings,
  }, null, 2));

  process.stdout.write(JSON.stringify({ brand, title, description, faviconPath, socialImagePath, htmlFiles }, null, 2));
} finally {
  await server.close();
}
