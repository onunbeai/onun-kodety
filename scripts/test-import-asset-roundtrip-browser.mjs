import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';
const require = createRequire(import.meta.url);
import { chromium } from 'playwright';

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import JSZip from 'jszip';
import {buildPreview, resolvePreviewStylesheet} from './lib/html-editor/preview';
import {parseSrcsetCandidates, rewriteCssAssetUrls} from './lib/html-editor/asset-reference-syntax';
import {resolveProjectPath} from './lib/html-editor/project-path';
import {findProjectAssetReferences} from './lib/html-editor/asset-references';
import {importZip, projectToZipBlob, prepareProjectForTransport, renameProjectFile} from './lib/html-editor/project-io';
window.assetTest={JSZip,buildPreview,resolvePreviewStylesheet,parseSrcsetCandidates,rewriteCssAssetUrls,resolveProjectPath,findProjectAssetReferences,importZip,projectToZipBlob,prepareProjectForTransport,renameProjectFile};
` },
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
  plugins: [{ name: 'asset-roundtrip-browser', setup(builder) {
    builder.onResolve({ filter: /^virtual:coday-react-runtime$/ }, () => ({ path: 'runtime', namespace: 'test-runtime' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-runtime' }, async () => ({ contents: `export default ${JSON.stringify(await buildCodeComponentReactRuntime())}` }));
    builder.onResolve({ filter: /\?raw$/ }, args => ({
      path: args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path.slice(0, -4)) : require.resolve(args.path.slice(0, -4)), namespace: 'test-raw',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'test-raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://unavailable.test/**', route=>route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const fontBase64 = (await readFile('Wordpress/kodety/admin/fonts/inter-latin-variable.woff2')).toString('base64');
  const result = await page.evaluate(async fontBase64 => {
    const api = window.assetTest;
    const inline = 'data:image/svg+xml,%3Csvg,%3E';
    const srcset = inline + ' 1x, assets/hero,large.svg 2x';
    const candidates = api.parseSrcsetCandidates(srcset);
    const css = `/* url(missing-comment.svg) */ .label::after{content:'url(missing-text.svg)'} .hero{background:IMAGE-SET("assets/hero,large.svg" 1x type("image/svg+xml"),url("assets/hero(small).svg") 2x)} .escape{background:url(assets/hero\\(small\\).svg)}`;
    const bytes = base64 => Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
    const mixedImports = '@import "mixed-local.css"; @import "https://unavailable.test/remote.css";';
    const binaryCss = '@font-face{font-family:AssetFixture;src:url("assets/fixture.woff2") format("woff2")} h1{font-family:AssetFixture} .binary{width:400px;height:250px;background-image:url("assets/pixel.png")}';
    const file = (path,text,mimeType) => ({path,text,mimeType});
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>'+mixedImports+css+binaryCss+'</style><link rel="preload" as="image" imagesrcset="assets/hero,large.svg 1x, assets/hero(small).svg 2x"></head><body><main><h1>Editable import</h1><div class="hero" style="width:50px;height:50px"></div><div class="nested">Nested import</div><div class="binary"></div><img id="picture" src="assets/hero(small).svg" srcset="'+srcset+'"><div data-video-urls="assets/video.mp4,assets/video.webm" data-poster-url="assets/hero(small).svg"></div><svg><use href="assets/hero(small).svg#mark"></use></svg></main></body></html>';
    const project = {name:'Portable Webflow',mainHtmlPath:'index.html',rootPath:'',openedAt:1,files:{
      'index.html':file('index.html',html,'text/html'),
      'assets/hero,large.svg':file('assets/hero,large.svg',svg,'image/svg+xml'),
      'assets/hero(small).svg':file('assets/hero(small).svg',svg.replace('red','blue'),'image/svg+xml'),
      'mixed-local.css':file('mixed-local.css','@font-face{font-family:NestedFixture;src:url("assets/nested.woff2")} .nested{width:400px;height:200px;background-image:url("assets/nested.png");font-family:NestedFixture}','text/css'),
      'assets/nested.png':{path:'assets/nested.png',mimeType:'image/png',data:bytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=')},
      'assets/nested.woff2':{path:'assets/nested.woff2',mimeType:'font/woff2',data:bytes(fontBase64)},
      'assets/pixel.png':{path:'assets/pixel.png',mimeType:'image/png',data:bytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=')},
      'assets/fixture.woff2':{path:'assets/fixture.woff2',mimeType:'font/woff2',data:bytes(fontBase64)},
      'assets/video.mp4':file('assets/video.mp4','fixture-mp4','video/mp4'),
      'assets/video.webm':file('assets/video.webm','fixture-webm','video/webm'),
    }};
    window.assetProject = project;
    const before = JSON.stringify(project);
    const resolvedCss = api.resolvePreviewStylesheet(project,'index.html',mixedImports+css+binaryCss);
    const preview = api.buildPreview(project,true,[],false,[],false,null,'assets-roundtrip',1);
    const parsed = new DOMParser().parseFromString(preview.html,'text/html');
    const originalMarkers = {
      srcset: parsed.querySelector('#picture')?.getAttribute('data-html-editor-original-srcset'),
      preload: parsed.querySelector('[imagesrcset]')?.getAttribute('data-html-editor-original-imagesrcset'),
      videos: parsed.querySelector('[data-video-urls]')?.getAttribute('data-html-editor-original-data-video-urls'),
    };
    const draft = await api.projectToZipBlob(project);
    const reimported = await api.importZip(new File([draft],'portable-webflow.zip',{type:'application/zip'}));
    const transported = api.prepareProjectForTransport(reimported);
    const published = await api.projectToZipBlob(transported);
    const archive = await api.JSZip.loadAsync(await published.arrayBuffer());
    const archivedHtml = await archive.file('index.html').async('string');
    const renamed = api.renameProjectFile(project,'assets/hero,large.svg','assets/hero-renamed.svg');
    window.assetMessages=[];
    addEventListener('message', event=>{
      window.assetMessages.push(event.data);
      if (!['html-editor-runtime-assets-request','html-editor-runtime-assets-ready'].includes(event.data?.type)) return;
      // The real parent primes fonts when a buffered iframe announces ready;
      // visual assets remain demand-driven so the CSS scanner is exercised.
      const paths=event.data.type==='html-editor-runtime-assets-ready'?['assets/fixture.woff2','assets/nested.woff2']:event.data.paths;
      const assets = paths.flatMap(path=>{
        const file=project.files[path];
        return file?[{path,mimeType:file.mimeType,bytes:(file.data?file.data.slice():new TextEncoder().encode(file.text||'')).buffer}]:[];
      });
      event.source.postMessage({type:'html-editor-runtime-assets',generation:event.data.generation,assets,aliases:{}},'*',assets.map(asset=>asset.bytes));
    });
    const frame=document.createElement('iframe');frame.id='asset-preview';frame.style='width:900px;height:700px';frame.sandbox='allow-scripts';frame.srcdoc=preview.html;document.body.append(frame);
    return {
      candidates,
      queryPath:api.resolveProjectPath('styles/font.css','?v=2'),
      remotePaths:['//cdn.example/a.png','about:blank','urn:example:a'].map(url=>api.resolveProjectPath('index.html',url)),
      css:resolvedCss.cssText,missing:resolvedCss.missingAssets,
      markers:originalMarkers,
      archivedHtml,
      archivedPaths:Object.keys(archive.files),
      originalIntact:before===JSON.stringify(project),
      renamedHtml:renamed.files['index.html'].text,
      references:api.findProjectAssetReferences(project,'assets/hero,large.svg'),
      videoReferences:api.findProjectAssetReferences(project,'assets/video.webm'),
      largeCssWorks:api.rewriteCssAssetUrls('.x{background:url("data:image/png;base64,'+'A'.repeat(1024*1024)+'")} .y{background:url("next.webp")}',url=>url==='next.webp'?'local.webp':null).endsWith('.y{background:url("local.webp")}'),
    };
  }, fontBase64);
  assert.deepEqual(result.candidates, [{url:'data:image/svg+xml,%3Csvg,%3E',descriptor:'1x'},{url:'assets/hero,large.svg',descriptor:'2x'}]);
  assert.equal(result.queryPath, 'styles/font.css');
  assert.deepEqual(result.remotePaths, [null,null,null]);
  assert.deepEqual(result.missing, []);
  assert.match(result.css,/data:,kodety-runtime-asset-assets%2Fpixel.png/);
  assert.match(result.css,/data:,kodety-runtime-asset-assets%2Ffixture.woff2/);
  assert.match(result.css,/IMAGE-SET\("data:image\/svg\+xml;base64,/);
  assert.match(result.css,/type\("image\/svg\+xml"\)/);
  assert.match(result.css,/content:'url\(missing-text.svg\)'/);
  assert.equal(result.markers.srcset,'data:image/svg+xml,%3Csvg,%3E 1x, assets/hero,large.svg 2x');
  assert.equal(result.markers.preload,'assets/hero,large.svg 1x, assets/hero(small).svg 2x');
  assert.equal(result.markers.videos,'assets/video.mp4,assets/video.webm');
  assert.equal(result.originalIntact,true,'preview/export must not mutate canonical source');
  assert.match(result.archivedHtml,/assets\/hero,large.svg/);
  assert.match(result.archivedHtml,/data:image\/svg\+xml,%3Csvg,%3E/);
  assert.match(result.archivedHtml,/data-video-urls="assets\/video.mp4,assets\/video.webm"/);
  assert.doesNotMatch(result.archivedHtml,/kodety-runtime-asset-|blob:|data-html-editor-/);
  for (const asset of ['assets/hero,large.svg','assets/hero(small).svg','assets/video.mp4','assets/video.webm']) assert.ok(result.archivedPaths.includes(asset));
  assert.match(result.renamedHtml,/assets\/hero-renamed.svg/);
  assert.doesNotMatch(result.renamedHtml,/assets\/hero,large.svg/);
  assert.ok(result.references.some(reference=>reference.kind==='css-url'),'image-set protects referenced assets from deletion');
  assert.ok(result.references.some(reference=>reference.kind==='html-srcset'));
  assert.ok(result.videoReferences.some(reference=>reference.detail==='div[data-video-urls]'));
  assert.equal(result.largeCssWorks,true);
  const frame = page.frames().find(candidate=>candidate.parentFrame());
  assert.ok(frame);
  await frame.waitForSelector('main');
  await frame.waitForFunction(()=>document.querySelector('.hero') && getComputedStyle(document.querySelector('.hero')).backgroundImage.includes('data:image/svg+xml;base64,'));
  await frame.waitForFunction(()=>document.querySelector('#picture').getAttribute('srcset').includes('blob:'));
  await frame.waitForFunction(()=>getComputedStyle(document.querySelector('.binary')).backgroundImage.includes('blob:') && document.fonts.check('16px AssetFixture'));
  await frame.waitForFunction(()=>getComputedStyle(document.querySelector('.nested')).backgroundImage.includes('blob:') && document.fonts.check('16px NestedFixture'));
  const rendered = await frame.evaluate(()=>({
    srcset:document.querySelector('#picture').getAttribute('srcset'),
    preload:document.querySelector('[imagesrcset]').getAttribute('imagesrcset'),
    videos:document.querySelector('[data-video-urls]').getAttribute('data-video-urls'),
    content:getComputedStyle(document.querySelector('.hero')).backgroundImage,
  }));
  assert.match(rendered.srcset,/data:image\/svg\+xml,%3Csvg,%3E 1x, blob:/,'runtime preserves complete responsive srcset with data URLs');
  assert.match(rendered.preload,/(?:blob:|data:image\/svg\+xml;base64,)/);
  assert.equal(rendered.videos.split(',').filter(value=>value.startsWith('blob:')).length,2);
  await page.evaluate(()=>{
    const preview=window.assetTest.buildPreview(window.assetProject,true,[],false,[],true,null,'assets-design',2);
    const frame=document.createElement('iframe');frame.id='asset-design';frame.style='width:900px;height:700px';frame.sandbox='allow-scripts';frame.srcdoc=preview.html;document.body.append(frame);
  });
  const design = await page.locator('#asset-design').contentFrame();
  await design.locator('main').waitFor();
  await page.locator('#asset-design').scrollIntoViewIfNeeded();
  const designFrame = await (await page.locator('#asset-design').elementHandle()).contentFrame();
  await designFrame.waitForFunction(()=>getComputedStyle(document.querySelector('.binary')).backgroundImage.includes('blob:') && document.fonts.check('16px AssetFixture'));
  await designFrame.waitForFunction(()=>getComputedStyle(document.querySelector('.nested')).backgroundImage.includes('blob:') && document.fonts.check('16px NestedFixture'));
  const designState = await design.locator('#picture').evaluate(element=>({
    srcset:element.getAttribute('srcset'),
    original:element.getAttribute('data-html-editor-original-srcset'),
  }));
  assert.equal(designState.original,'data:image/svg+xml,%3Csvg,%3E 1x, assets/hero,large.svg 2x');
  assert.ok(!designState.srcset || designState.srcset.startsWith('data:image/svg+xml,%3Csvg,%3E'),'Design must not split the inline data URL into bogus asset candidates');
  assert.deepEqual(errors,[],'serialized runtime helpers must execute in Preview/Design without browser errors');
  console.log('Import asset roundtrip passed: CSS/image-set, srcset, query URLs, opaque Preview, canonical markers, asset references, rename and draft/publish ZIP.');
} finally { await browser.close(); }
