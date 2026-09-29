import JSZip from 'jszip';

export const PERFORMANCE_PROFILES = {
  medium: { pages: 6, sections: 12, cardsPerSection: 8, cssRules: 2500 },
  large: { pages: 10, sections: 32, cardsPerSection: 20, cssRules: 9000 },
};

/** Deterministic, local-only catalog/editor workloads; no external resources. */
export async function createPerformanceProject(profile) {
  const dimensions = PERFORMANCE_PROFILES[profile];
  if (!dimensions) throw new Error(`Unknown performance profile: ${profile}`);
  const pagePaths = Array.from({ length: dimensions.pages }, (_, index) => index ? `page-${String(index + 1).padStart(2, '0')}.html` : 'index.html');
  const baseCss = `*{box-sizing:border-box}html{scroll-behavior:auto}body{margin:0;font-family:Arial,sans-serif;color:#233047;background:#fff}.site-header{padding:16px 48px;background:#edf3fc}.site-header nav{display:flex;gap:20px}.site-header a{color:#243d67}main{padding:32px 48px}.hero{padding:24px;background:#edf3fc;margin-bottom:32px}.hero h1{font-size:44px;color:#173344;margin:0 0 16px}.hero p{font-size:18px;color:#445577;margin:0}.catalog-section{padding:24px 0;border-top:1px solid #ccd5e4}.section-heading{display:flex;justify-content:space-between;align-items:center}.card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.product-card{border:1px solid #d3dbe7;border-radius:12px;overflow:hidden;background:#fff}.card-media{display:block;height:120px;background:#f3f6fa}.card-media svg{height:100%;width:100%}.card-body{padding:16px}.card-title{font-size:18px;margin:8px 0}.card-title a{color:inherit}.card-body ul{font-size:12px;padding-left:20px}.card-footer{display:flex;justify-content:space-between;align-items:center}.card-footer button{padding:8px;border:0;border-radius:6px;background:#264f99;color:white}.site-footer{padding:32px 48px;background:#edf3fc}@media(max-width:900px){.card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:500px){.card-grid{grid-template-columns:1fr}main{padding:20px}.hero h1{font-size:30px}}`;
  const generatedCss = Array.from({ length: dimensions.cssRules }, (_, index) => {
    const section = index % dimensions.sections;
    const tone = index % 24;
    const selector = `.site-page .catalog-section.s-${section} .product-card.t-${tone} .card-title,.theme-${index % 7} .catalog-section.s-${section}>.card-grid>.product-card.t-${tone} .card-body`;
    const rule = `${selector}{--catalog-rule-${index}:${index % 100};letter-spacing:${index % 3 / 100}em;border-color:hsl(${index % 360} 24% 82%);}`;
    return index % 5 === 0 ? `@media(min-width:${640 + index % 8 * 80}px){${rule}}` : rule;
  }).join('\n');
  const css = `${baseCss}\n${generatedCss}`;
  const files = { 'styles.css': css, 'script.js': '// Fixture contains no authored runtime work.\n' };
  for (const [pageIndex, pagePath] of pagePaths.entries()) {
    const sections = Array.from({ length: dimensions.sections }, (_, section) => {
      const cards = Array.from({ length: dimensions.cardsPerSection }, (_, card) => {
        const number = section * dimensions.cardsPerSection + card;
        return `<article class="product-card t-${number % 24}" data-label="Product ${number}"><a class="card-media" href="${pagePaths[(pageIndex + 1) % pagePaths.length]}"><svg viewBox="0 0 300 120" role="img" aria-label="Local product illustration ${number}"><rect width="300" height="120" fill="hsl(${number % 360} 35% 90%)"/><circle cx="150" cy="60" r="35" fill="hsl(${number % 360} 45% 60%)"/></svg></a><div class="card-body"><p class="eyebrow"><span>Collection ${section + 1}</span></p><h3 class="card-title"><a href="${pagePaths[(pageIndex + 1) % pagePaths.length]}">Product ${number + 1}</a></h3><p>Editable catalog content with nested structure, local illustration and reusable classes.</p><ul><li>Durable material</li><li>Multiple sizes</li><li>Local delivery</li></ul><footer class="card-footer"><button type="button"><span>Learn more</span></button><small>Item ${number + 1}</small></footer></div></article>`;
      }).join('');
      return `<section id="section-${section}" class="catalog-section s-${section}" data-label="Section ${section + 1}"><header class="section-heading"><h2>Collection ${section + 1}</h2><p>${dimensions.cardsPerSection} editable products</p></header><div class="card-grid">${cards}</div></section>`;
    }).join('');
    files[pagePath] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${profile} catalog page ${pageIndex + 1}</title><link rel="stylesheet" href="styles.css"></head><body class="site-page theme-${pageIndex % 7}" data-perf-page="${pagePath}"><header class="site-header"><nav>${pagePaths.map((target, index) => `<a href="${target}">Catalog ${index + 1}</a>`).join('')}</nav></header><main><section id="hero" class="hero" data-label="Page hero"><h1 id="probe-title" data-label="Title probe">${profile} catalog page ${pageIndex + 1}</h1><p id="probe-copy" data-label="Copy probe">Choose a collection, edit the content and compare page layouts.</p></section>${sections}</main><footer class="site-footer"><p>Local benchmark fixture. No network assets or client content.</p></footer><script src="script.js"></script></body></html>`;
  }
  files['.incode/project.json'] = JSON.stringify({ version: 1, projectId: `kst-performance-${profile}`, name: `Performance ${profile} catalog`, createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', mainHtmlPath: 'index.html', homeHtmlPath: 'index.html', rootPath: '', breakpointSchemaVersion: 2, primaryBreakpoint: { id: 'base', label: 'Primary', mode: 'max-width', width: 1440 }, breakpoints: [{ id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 }, { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 480 }], siteSettings: { betaFeatures: { infiniteCanvas: true } } }, null, 2);
  const zip = new JSZip();
  for (const [filePath, source] of Object.entries(files)) zip.file(filePath, source);
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return { files, archive, manifest: { profile, ...dimensions, pagePaths, files: Object.keys(files).length, cssBytes: Buffer.byteLength(css), htmlBytesPerPage: Buffer.byteLength(files['index.html']), sourceElementsPerPage: (files['index.html'].match(/<[a-z][a-z0-9-]*(?:\s|>)/gi) || []).length, archiveBytes: archive.byteLength, generatedCssRules: dimensions.cssRules, cssIncludesDescendantSelectors: true, externalResources: 0, authoredJavaScript: 'empty', representativeFeatures: ['multi-page catalog', 'nested semantic sections', 'cards with inline SVG', 'reusable class combinations', 'responsive media queries', 'substantial CSSOM'] } };
}
