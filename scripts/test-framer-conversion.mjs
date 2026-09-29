import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { buildCodeComponentReactRuntime, codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const server = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
const textFile = (path, text, mimeType = 'text/html') => ({ path, text, mimeType });
const source = `<!doctype html><html><head><meta charset="utf-8"><style>.hero{color:rgb(200,0,0)}.mobile{display:none}@media(max-width:600px){.desktop{display:none}.mobile{display:block}.hero{color:rgb(0,0,200)}}</style><style id="injected-cssom"></style><link rel="stylesheet" href="../styles/theme.css"><link rel="modulepreload" href="../scripts/vendor/runtime.mjs"></head><body>
<div id="main" data-framer-hydrate-v2="{}" data-kodety-framer-node="root"><section class="desktop ssr-variant" data-kodety-framer-node="desktop"><h1 class="hero kodety-framer-motion-1" data-kodety-framer-node="title">Authored edit</h1></section><section class="mobile ssr-variant" data-kodety-framer-node="mobile">Mobile copy</section><img id="hero-image" src="../assets/hero.svg"><button id="custom-button">Click</button></div>
<script type="application/ld+json">{"@type":"WebPage","name":"Keep structured data","code":"data-framer-hydrate-v2"}</script>
<script>window.customRuns=(window.customRuns||0)+1;document.getElementById('custom-button').onclick=function(){this.textContent='Works'};</script>
<script type="application/json" data-kodety-framer-baseline>{"version":1}</script>
<script data-kodety-framer-edit-guard>window.__KODETY_FRAMER_RUNTIME_ACTIVE__=true;</script>
<script type="module" data-kodety-framer-compat-runtime src="../scripts/vendor/runtime.mjs"></script>
<script data-kodety-framer-responsive-runtime>window.responsiveRuns=(window.responsiveRuns||0)+1;</script>
</body></html>`;
const fixture = {
  name: 'Framer project', mainHtmlPath: 'pages/index.html', rootPath: '', openedAt: 23,
  files: {
    'pages/index.html': textFile('pages/index.html', source),
    'pages/about.html': textFile('pages/about.html', source.replace('Authored edit', 'About page')),
    'styles/theme.css': textFile('styles/theme.css', ':root{--theme-color:#aaf}.shared{padding:18px}@media(min-width:900px){.shared{padding:24px}}', 'text/css'),
    'assets/hero.svg': textFile('assets/hero.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>', 'image/svg+xml'),
    'scripts/vendor/runtime.mjs': textFile('scripts/vendor/runtime.mjs', `await new Promise(resolve=>setTimeout(resolve,250));const root=document.getElementById('main');const node=document.createElement('p');node.id='hydrated-node';node.textContent='Hydrated content';root.append(node);document.getElementById('injected-cssom').sheet.insertRule('.runtime-cssom { background-color: rgb(10, 20, 30); }');const style=document.createElement('style');document.head.append(style);style.sheet.insertRule('#hydrated-node{color:rgb(20,30,40)}');style.sheet.insertRule('@media(max-width:600px){#hydrated-node{color:rgb(40,50,60)}}',style.sheet.cssRules.length);document.querySelector('.mobile').remove();`, 'text/javascript'),
    '.incode/framer-import.json': textFile('.incode/framer-import.json', JSON.stringify({ version: 1, runtime: true, breakpoints: [{ id: 'mobile', label: 'Mobile', mode: 'max-width', width: 600 }], embedded: { localizedRuntimeEntrypoint: 'scripts/vendor/runtime.mjs' }, animations: [{ trigger: 'load', targetClass: 'kodety-framer-motion-1', frames: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }], timing: { duration: 400, iterations: 1 } }] }), 'application/json'),
    '.incode/url-import.json': textFile('.incode/url-import.json', JSON.stringify({ platform: 'framer', framerMode: 'animated', runtime: 'preserved-guarded', sourceUrl: 'https://source.example/' }), 'application/json'),
    '.incode/project.json': textFile('.incode/project.json', JSON.stringify({ version: 1, name: 'Framer project', projectId: 'persistent-identity', mainHtmlPath: 'pages/index.html', rootPath: '', breakpoints: [{ id: 'author-mobile', label: 'Author mobile', mode: 'max-width', width: 640 }], pageSettings: { 'pages/index.html': { title: 'SEO author title' } } }), 'application/json'),
  },
};

try {
  const { convertHydratedFramerProject, framerConversionRootSelector } = await server.ssrLoadModule('/lib/html-editor/framer-conversion.ts');
  const { applyFramerImportManifest, isHydratedFramerProject, isFramerProject } = await server.ssrLoadModule('/lib/html-editor/framer-import.ts');
  const { readInteractionDocument, patchInteractionDocument } = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const { patchElementText, inspectSourceElements } = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
  const { prepareProjectForDraftTransport, readEditorMetadata, updateTextFile, importZip, ensureProjectIdentity } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const metadataFreeZip = new JSZip();
  Object.entries(fixture.files).forEach(([path, file]) => { if (path !== '.incode/project.json') metadataFreeZip.file(path, file.text); });
  const rawArchive = await metadataFreeZip.generateAsync({ type: 'uint8array' });
  const freshImport = await importZip(new File([rawArchive], 'fresh-framer.zip'));
  assert.equal(readEditorMetadata(applyFramerImportManifest(freshImport)).breakpoints[0].width, 600, 'a fresh ZIP must adopt captured source breakpoints');
  const generatedIdentity = ensureProjectIdentity(freshImport);
  assert.equal(readEditorMetadata(applyFramerImportManifest(generatedIdentity, { initializeGeneratedBreakpoints: true })).breakpoints[0].width, 600, 'WordPress identity bootstrapping cannot hide captured source breakpoints');
  const before = JSON.stringify(fixture);
  const sourceSnapshots = Object.fromEntries(['pages/index.html', 'pages/about.html'].map(path => [path, { version: 1, rootSelector: '#main', rootHtml: fixture.files[path].text.match(/<div id="main"[\s\S]*?<\/div>/)[0], styles: [] }]));
  assert.throws(() => convertHydratedFramerProject(fixture, { snapshot: sourceSnapshots['pages/index.html'] }), /todas as páginas/, 'unobserved pages must never lose hydration');
  assert.equal(framerConversionRootSelector(source), '#main');
  assert.throws(() => convertHydratedFramerProject(fixture, { readOnly: true }), /somente leitura/);
  assert.equal(JSON.stringify(fixture), before, 'read-only conversion must not mutate source');
  const result = convertHydratedFramerProject(fixture, { snapshots: sourceSnapshots });
  assert.equal(JSON.stringify(fixture), before, 'conversion must be an immutable transaction');
  assert.equal(result.report.pages, 2);
  assert.equal(result.report.removedScripts, 6);
  assert.equal(result.project.rootPath, fixture.rootPath);
  assert.equal(result.project.openedAt, fixture.openedAt);
  assert.equal(result.project.files['assets/hero.svg'], fixture.files['assets/hero.svg']);
  assert.equal(result.project.files['styles/theme.css'], fixture.files['styles/theme.css']);
  assert.equal(result.project.files['scripts/vendor/runtime.mjs'], fixture.files['scripts/vendor/runtime.mjs'], 'unused runtime stays archived without executable entrypoints');
  for (const htmlPath of ['pages/index.html', 'pages/about.html']) {
    const html = result.project.files[htmlPath].text;
    assert.doesNotMatch(html, /<[^>]+(?:data-kodety-framer-(?:baseline|edit-guard|compat-runtime)|data-framer-hydrate-v2)/);
    assert.doesNotMatch(html, /<link[^>]+modulepreload/);
    assert.match(html, /data-kodety-framer-responsive-runtime/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /window.customRuns/);
    assert.match(html, /\.hero\{color:rgb\(200,0,0\)\}/);
  }
  assert.equal(isHydratedFramerProject(result.project), false);
  assert.equal(convertHydratedFramerProject(result.project).project, result.project, 'conversion must be idempotent');
  const backup = JSON.parse(result.project.files[result.report.backupPath].text);
  assert.equal(backup.files['pages/index.html'].text, source);
  let native = applyFramerImportManifest(result.project);
  assert.deepEqual(readEditorMetadata(native).breakpoints, readEditorMetadata(fixture).breakpoints, 'custom breakpoints must survive native migration');
  let interactions = readInteractionDocument(native.files[native.mainHtmlPath].text);
  assert.equal(interactions.interactions[0].id, 'framer-load');
  interactions.interactions[0].actions[0].duration = 2.8;
  native = updateTextFile(native, native.mainHtmlPath, patchInteractionDocument(native.files[native.mainHtmlPath].text, interactions));
  assert.equal(readInteractionDocument(applyFramerImportManifest(native).files[native.mainHtmlPath].text).interactions[0].actions[0].duration, 2.8, 'reopening cannot overwrite native keyframe edits');
  native = updateTextFile(native, native.mainHtmlPath, patchInteractionDocument(native.files[native.mainHtmlPath].text, { version: 2, interactions: [] }));
  assert.equal(readInteractionDocument(applyFramerImportManifest(native).files[native.mainHtmlPath].text).interactions.length, 0, 'deleted imported motion must stay deleted');
  const title = inspectSourceElements(native.files[native.mainHtmlPath].text).find(node => node.tagName === 'h1');
  native = updateTextFile(native, native.mainHtmlPath, patchElementText(native.files[native.mainHtmlPath].text, title.path, 'Edited in Kodety'));
  const draft = prepareProjectForDraftTransport(native, '2026-09-06T00:00:00.000Z');
  assert.match(draft.files[native.mainHtmlPath].text, /Edited in Kodety/);
  assert.equal(isHydratedFramerProject(draft), false);
  assert.equal(readEditorMetadata(draft).projectId, 'persistent-identity');
  for (const platform of ['code', 'webflow', 'elementor']) {
    const generic = { ...fixture, files: { ...fixture.files, '.incode/url-import.json': textFile('.incode/url-import.json', JSON.stringify({ platform }), 'application/json') } };
    assert.equal(isFramerProject(generic), false);
    assert.equal(isHydratedFramerProject(generic), false);
    assert.equal(applyFramerImportManifest(generic), generic);
    assert.equal(convertHydratedFramerProject(generic).project, generic);
  }

  const bundle = await build({
    stdin: { contents: `import {buildPreview} from './lib/html-editor/preview';import {convertHydratedFramerProject} from './lib/html-editor/framer-conversion';import {requestFramerHydratedSnapshot,captureFramerHydratedSnapshot} from './lib/html-editor/framer-snapshot';import {captureFramerPagePreview} from './lib/html-editor/framer-conversion-preview';import {prepareProjectForTransport,projectToZipBlob,importZip} from './lib/html-editor/project-io';window.framerTest={buildPreview,captureFramerPagePreview,convertHydratedFramerProject,requestFramerHydratedSnapshot,captureFramerHydratedSnapshot,prepareProjectForTransport,projectToZipBlob,importZip};`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    plugins: [{ name: 'framer-test-runtime', setup(builder) {
      builder.onResolve({ filter: /^virtual:coday-react-runtime$/ }, () => ({ path: 'runtime', namespace: 'framer-runtime' }));
      builder.onLoad({ filter: /.*/, namespace: 'framer-runtime' }, async () => ({ contents: `export default ${JSON.stringify(await buildCodeComponentReactRuntime())}` }));
      builder.onResolve({ filter: /\?raw$/ }, options => ({ path: options.path.startsWith('.') ? path.resolve(options.resolveDir, options.path.slice(0, -4)) : require.resolve(options.path.slice(0, -4)), namespace: 'framer-raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'framer-raw' }, async options => ({ contents: await readFile(options.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://conversion.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://conversion.test/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(project => {
      window.project = project;
      window.messages = [];
      addEventListener('message', event => window.messages.push(event.data));
      const preview = window.framerTest.buildPreview(project, false, [], false, [], false, null, 'framer-test', 9);
      window.captureAssetAliases = preview.captureAssetAliases;
      const frame = document.createElement('iframe');
      frame.id = 'runtime';frame.setAttribute('sandbox', 'allow-scripts');frame.style.cssText = 'width:1000px;height:800px';frame.srcdoc = preview.html;
      document.body.append(frame);
    }, fixture);
    await page.waitForFunction(() => window.messages.some(message => message.type === 'html-editor-canvas-ready'));
    const runtime = page.frames().find(frame => frame.parentFrame());
    // Capture immediately after first paint; the bridge must wait for module hydration.
    // Exercise iframe-owned asset reversal, including historical Blob aliases.
    await runtime.evaluate(() => {
      const image = document.getElementById('hero-image');
      image.src = 'data:,kodety-runtime-asset-assets%2Fhero.svg';
    });
    const liveResult = await page.evaluate(async () => {
      const api = window.framerTest;
      const snapshot = await api.requestFramerHydratedSnapshot(document.getElementById('runtime').contentWindow, 'framer-test', 9, '#main', window, 12000, window.captureAssetAliases);
      const aboutSnapshot = await api.captureFramerPagePreview(window.project, 'pages/about.html', { width: 1000, revision: 9 });
      const result = api.convertHydratedFramerProject(window.project, { snapshots: { 'pages/index.html': snapshot, 'pages/about.html': aboutSnapshot } });
      window.converted = result.project;
      const publish = api.prepareProjectForTransport(result.project);
      const archive = await api.projectToZipBlob(result.project);
      const reopened = await api.importZip(new File([archive], 'converted.zip', { type: 'application/zip' }));
      return { snapshot, aboutHtml: result.project.files['pages/about.html'].text, html: result.project.files[result.project.mainHtmlPath].text, published: publish.files[result.project.mainHtmlPath].text, reopened: reopened.files[result.project.mainHtmlPath].text };
    });
    assert.match(liveResult.html, /Hydrated content/);
    assert.match(liveResult.aboutHtml, /Hydrated content/, 'every hydrated page must be materialized before the project transaction');
    assert.match(liveResult.html, /runtime-cssom/);
    assert.match(liveResult.html, /Mobile copy/, 'inactive SSR variants removed by hydration must survive conversion');
    assert.match(liveResult.html, /\.\.\/assets\/hero\.svg/);
    assert.doesNotMatch(liveResult.html, /blob:|data:,kodety-runtime-asset-|data-html-editor-/);
    assert.match(liveResult.published, /Hydrated content/);
    assert.match(liveResult.reopened, /Hydrated content/);
    assert.doesNotMatch(liveResult.reopened, /data-kodety-framer-compat-runtime/);
    await page.evaluate(() => {
      document.getElementById('runtime').remove();
      const preview = window.framerTest.buildPreview(window.converted, false, [], false, [], false, null, 'converted-preview', 10);
      const frame = document.createElement('iframe');frame.id = 'converted';frame.setAttribute('sandbox', 'allow-scripts');frame.style.cssText='width:375px;height:800px';frame.srcdoc = preview.html;document.body.append(frame);
    });
    const editable = page.frames().find(frame => frame.parentFrame());
    await editable.waitForSelector('#hydrated-node');
    assert.equal(await editable.locator('#hydrated-node').evaluate(element => getComputedStyle(element).color), 'rgb(40, 50, 60)', 'runtime CSSOM media queries must survive at a different viewport');
    assert.equal(await editable.locator('.mobile').evaluate(element => getComputedStyle(element).display), 'block');
    await editable.locator('#custom-button').click();
    assert.equal(await editable.locator('#custom-button').textContent(), 'Works', 'legitimate scripts must remain executable after conversion');
    assert.equal(await editable.evaluate(() => window.customRuns), 1);
    const timeout = await page.evaluate(async () => {
      try { await window.framerTest.requestFramerHydratedSnapshot(document.getElementById('converted').contentWindow, 'wrong-generation', 10, '#main', window, 30);return ''; } catch(error) { return error.message; }
    });
    assert.match(timeout, /não está pronto/, 'stale frame generations must time out without returning foreign snapshots');
    const special = await page.evaluate(() => {
      const source = '<!doctype html><html><head><style>.deleted{display:none}</style><style>.text-swap{color:red}</style><link rel="stylesheet" href="styles/external.css"></head><body><div id="main" data-framer-hydrate-v2><div class="deleted">Deleted CSS rule</div><div class="text-swap">Changed stylesheet text</div><code id="literal">blob:example</code><div id="videos"></div><div class="external">External CSSOM</div><div class="cascade">Cascade</div><input id="field"><textarea id="area"></textarea><select><option>A</option><option id="selected">B</option></select><input id="check" type="checkbox"><img id="changed-image" src="old.svg"><a id="changed-link" href="/old">Link</a><div id="entrance" data-kodety-framer-motion="load" style="opacity:1">Entry</div><div id="hidden-entry" hidden data-kodety-framer-motion="load" style="opacity:0">Intentional</div><style>.cascade{color:rgb(255,0,0)}</style><style id="closing-css"></style></div><script data-kodety-framer-compat-runtime></script></body></html>';
      document.head.innerHTML = '<style data-editor-embedded-source="0">.deleted{display:none}</style><style data-editor-embedded-source="1">.text-swap{color:red}</style><style data-editor-source="styles/external.css">.external{padding:22px}</style>';
      document.body.innerHTML = source.match(/<body>([\s\S]*)<\/body>/)[1];
      document.styleSheets[0].deleteRule(0);
      document.styleSheets[1].ownerNode.textContent='.text-swap{color:rgb(0,128,0)}';
      document.styleSheets[2].insertRule('.external{padding:44px}', 1);
      document.getElementById('videos').setAttribute('data-video-urls','blob:null/one,blob:null/two');
      const print = document.createElement('style');print.media='print';print.textContent='#main{display:none}';document.head.append(print);
      const disabled = document.createElement('style');disabled.textContent='#main{display:none}';document.head.append(disabled);disabled.sheet.disabled=true;
      const adopted = new CSSStyleSheet();adopted.replaceSync('.cascade{color:rgb(0,0,255)}');document.adoptedStyleSheets=[adopted];
      document.getElementById('field').value='Hydrated value';document.getElementById('area').value='Hydrated text';document.getElementById('selected').selected=true;document.getElementById('check').checked=true;
      const img=document.getElementById('changed-image');img.setAttribute('data-html-editor-original-src','old.svg');img.src='https://assets.example/new.svg';
      const link=document.getElementById('changed-link');link.setAttribute('data-html-editor-original-href','/old');link.href='https://destination.example/new';
      document.getElementById('closing-css').textContent='.quote::after{content:"</style><img id=not-real>"}.literal::after{content:"blob:example"}';
      const entrance=document.getElementById('entrance');entrance.style.opacity='0';entrance.animate([{opacity:0},{opacity:1}],{duration:5000,fill:'both'});
      document.getElementById('hidden-entry').animate([{opacity:0},{opacity:1}],{duration:5000,fill:'both'});
      const snapshot=window.framerTest.captureFramerHydratedSnapshot(document,'#main',{'blob:null/one':'assets/one.mp4','blob:null/two':'assets/two.mp4'},'index.html');
      const project={name:'Special capture',mainHtmlPath:'index.html',rootPath:'',openedAt:2,files:{'index.html':{path:'index.html',mimeType:'text/html',text:source},'styles/external.css':{path:'styles/external.css',mimeType:'text/css',text:'.external{padding:22px}'},'.incode/framer-import.json':{path:'.incode/framer-import.json',mimeType:'application/json',text:JSON.stringify({version:1,runtime:true})}}};
      const result=window.framerTest.convertHydratedFramerProject(project,{snapshot});
      const untouchedOpacity=getComputedStyle(entrance).opacity;
      const parsed=new DOMParser().parseFromString(result.project.files['index.html'].text,'text/html');
      const resultData={html:result.project.files['index.html'].text,field:parsed.getElementById('field').getAttribute('value'),area:parsed.getElementById('area').textContent,selected:parsed.getElementById('selected').hasAttribute('selected'),checked:parsed.getElementById('check').hasAttribute('checked'),image:parsed.getElementById('changed-image').getAttribute('src'),href:parsed.getElementById('changed-link').getAttribute('href'),entrance:parsed.getElementById('entrance').style.opacity,hidden:parsed.getElementById('hidden-entry').style.opacity,untouchedOpacity,literal:parsed.getElementById('literal').textContent,videos:parsed.getElementById('videos').getAttribute('data-video-urls'),escaped:parsed.querySelectorAll('#not-real').length};
      document.adoptedStyleSheets=[];
      document.head.innerHTML=parsed.head.innerHTML;document.body.innerHTML=parsed.body.innerHTML;
      return {...resultData,textSwap:getComputedStyle(document.querySelector('.text-swap')).color,display:getComputedStyle(document.getElementById('main')).display,deleted:getComputedStyle(document.querySelector('.deleted')).display,padding:getComputedStyle(document.querySelector('.external')).paddingTop,color:getComputedStyle(document.querySelector('.cascade')).color};
    });
    assert.equal(special.textSwap, 'rgb(0, 128, 0)', 'textContent replacement of an authored stylesheet must survive conversion');
    assert.equal(special.literal, 'blob:example');assert.equal(special.videos, 'assets/one.mp4,assets/two.mp4');
    assert.match(special.html, /content: \"blob:example\"/, 'CSS content strings must not be treated as resource URLs');
    assert.equal(special.display, 'block', 'print and disabled sheets must remain inactive');
    assert.equal(special.deleted, 'block', 'deleteRule must remove the original authored rule');
    assert.equal(special.padding, '44px', 'CSSOM changes to local linked styles must become editable source');
    assert.equal(special.color, 'rgb(0, 0, 255)', 'adopted sheets must preserve cascade after body styles');
    assert.equal(special.field, 'Hydrated value');assert.equal(special.area, 'Hydrated text');assert.equal(special.selected, true);assert.equal(special.checked, true);
    assert.equal(special.image, 'https://assets.example/new.svg');assert.equal(special.href, 'https://destination.example/new');
    assert.equal(special.entrance, '1');assert.equal(special.hidden, '0');assert.ok(Number(special.untouchedOpacity) < 1, 'capture must only settle the cloned animation state');
    assert.equal(special.escaped, 0, 'CSS text containing a closing style tag cannot create markup');

  } finally { await browser.close(); }
  console.log('Framer conversion: immutable drafts, native edit/reopen, runtime snapshot bridge, CSSOM/responsive, assets and publish/archive roundtrip passed.');
} finally { await server.close(); }
