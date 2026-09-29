import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { buildCodeComponentReactRuntime } from './vite-code-component-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const browserName = process.env.KODETY_TEST_BROWSER || 'chromium';
const browserType = new Map(Object.entries({ chromium, firefox, webkit })).get(browserName);
assert.ok(browserType, `Unsupported KODETY_TEST_BROWSER: ${browserName}`);
const globalsPath = path.join(root, 'app/globals.css');
// Compile the real editor CSS so this regression does not depend on an existing
// release build or silently omit the WordPress topbar's reserved stacking layer.
const css = (await postcss([tailwindcss({ base: root })]).process(await readFile(globalsPath, 'utf8'), { from: globalsPath })).css
  + '\n' + await readFile(path.join(root, 'Wordpress/editor/wordpress-editor.css'), 'utf8');
const bundle = await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import ColorPicker from './app/(builder)/kodety/html-editor/ycode-style/ColorPicker';
    const variables = Object.freeze([]);
    const capability = {kind:'html-design-tokens',capabilities:{list:true,get:true,create:true},list:()=>variables,get:()=>null};
    function App() {
      const [value,setValue] = useState('#f012ae');
      window.value = value;
      return <main><header className="kodety-editor-topbar" style={{height:50,background:'black',color:'white'}}>
        <button style={{position:'absolute',right:0,top:0,height:'100%',width:300}}>Publish</button>
      </header><aside id="sidebar" style={{position:'absolute',right:0,top:50,bottom:0,width:270,overflow:'auto'}}>
        <div style={{height:500}}/><ColorPicker value={value} onChange={next=>{window.edits.push(next);setValue(next)}} colorVariableCapability={capability}/><div style={{height:200}}/>
      </aside></main>;
    }
    window.edits=[];
    createRoot(document.getElementById('kodety-root')).render(<App/>);
  `, resolveDir: root, sourcefile: 'color-picker-viewport-fixture.tsx', loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', alias: { '@': root },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  plugins: [{ name: 'color-picker-browser', setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({
      path: args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path.slice(0, -4)) : require.resolve(args.path.slice(0, -4)), namespace: 'test-raw',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'test-raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
    builder.onResolve({ filter: /^virtual:coday-react-runtime$/ }, () => ({ path: 'runtime', namespace: 'test-runtime' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-runtime' }, async () => ({ contents: `export default ${JSON.stringify(await buildCodeComponentReactRuntime())}` }));
  } }],
});
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html class="dark"><head><style>${css}</style></head><body class="kodety-wordpress-editor"><div id="kodety-root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await browserType.launch({ headless: true });
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 640 }, { width: 320, height: 480 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger = page.locator('[data-slot="popover-trigger"]');
    const popup = page.locator('[data-slot="popover-content"]');
    const close = page.getByLabel('Fechar seletor de cor');
    await trigger.click();
    await page.waitForFunction(() => {
      const popup = document.querySelector('[data-slot="popover-content"]');
      return popup && popup.getBoundingClientRect().top >= 65;
    });
    const rect = await popup.boundingBox();
    assert.ok(rect.x >= 15 && rect.x + rect.width <= viewport.width - 15, `picker stays within horizontal viewport padding: ${JSON.stringify({viewport,rect})}`);
    assert.ok(rect.y >= 65 && rect.y + rect.height <= viewport.height - 15, 'picker fits the available space below the topbar');
    await close.click({ timeout: 2000 });
    await popup.waitFor({ state: 'hidden' });
    await trigger.click();
    // Both the inspector and the popup can scroll while the picker remains
    // open. The close control must scroll back into view and still receive clicks.
    await page.locator('#sidebar').evaluate(element => { element.scrollTop += 35; });
    await popup.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await close.click({ timeout: 2000 });
    await popup.waitFor({ state: 'hidden' });
    await trigger.click();
    await page.locator('header').evaluate(element => { element.style.height = '70px'; });
    await page.waitForFunction(() => document.querySelector('[data-slot="popover-content"]')?.getBoundingClientRect().top >= 85);
    await close.click({ timeout: 2000 });
    await popup.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => ({ value: window.value, edits: window.edits })), { value: '#f012ae', edits: [] }, 'positioning and close never change color or create history entries');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Color picker viewport passed (${browserName}): actual WordPress CSS, tall picker, narrow viewports, scrolling, resized topbar and click close without color edits.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
