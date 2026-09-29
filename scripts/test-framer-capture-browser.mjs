import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const php = await readFile(new URL('Wordpress/kodety/includes/class-kodety-plugin.php', root), 'utf8');
const captureMethod = php.slice(php.indexOf('private function prepare_capture_html('));
const probe = captureMethod.match(/\$probe = <<<'JS'\n([\s\S]*?)\nJS;/)?.[1];
assert.ok(probe, 'Exercise the actual capture bootstrap shipped by WordPress');
const bundle = await build({
  absWorkingDir: root.pathname, entryPoints: ['lib/html-editor/framer-visual-cleanup.ts'],
  bundle: true, write: false, format: 'iife', globalName: 'FramerCleanup', platform: 'browser',
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html data-kodety-breakpoint-capture><head>
    <style id="dynamic"></style><style id="disabled">.hero{width:1px}</style>
  </head><body>
    <div class="hero" data-framer-name="Hero">Hydrated content</div>
    <input id="name" value="initial"><input id="checked" type="checkbox">
    <textarea id="text">initial</textarea><select id="select"><option>One</option><option>Two</option></select>
    <img id="data-srcset" srcset="data:image/png;base64,aGVsbG8= 1x, data:image/png;base64,d29ybGQ= 2x">
    <img id="bad-srcset" srcset="data:image/png;base64,">
    <style>.hero{color:rgb(255,0,0)}</style>
  </body></html>`);
  await page.evaluate(() => {
    const sheet = document.querySelector('#dynamic').sheet;
    sheet.insertRule('.hero { width:600px; height:80px; display:flex; border:3px solid rgb(8,9,10) }');
    sheet.insertRule('@media (max-width:700px) { .hero { width:280px; height:120px } }', 1);
    document.querySelector('#disabled').sheet.disabled = true;
    const adopted = new CSSStyleSheet();
    adopted.replaceSync('.hero { color:rgb(10,20,30) }');
    document.adoptedStyleSheets = [adopted];
    document.querySelector('#name').value = 'hydrated value';
    document.querySelector('#checked').checked = true;
    document.querySelector('#text').value = 'hydrated text';
    document.querySelector('#select').selectedIndex = 1;
    window.captureResult = null;
    addEventListener('message', event => {
      if (event.source === window && event.data?.token === 'capture_browser_fixture') window.captureResult = event.data;
    });
  });
  const geometry = () => page.locator('.hero').evaluate(node => {
    const style = getComputedStyle(node);
    return { width: style.width, height: style.height, color: style.color, border: style.border };
  });
  const before = await geometry();
  await page.evaluate(probe.replace('__KODETY_TOKEN__', '"capture_browser_fixture"').replace('__KODETY_DELAY__', '0'));
  await page.waitForFunction(() => window.captureResult, null, { timeout: 10000 });
  const result = await page.evaluate(() => window.captureResult);
  assert.equal(result.type, 'kodety-rendered-capture');
  assert.match(result.html, /data-kodety-captured-stylesheet/);
  assert.match(result.html, /width: 600px/);
  await page.setContent(result.html);
  // Adopted sheets belong to the previous document in this harness; remove
  // them so the comparison proves the serialized CSS survives by itself.
  await page.evaluate(() => { document.adoptedStyleSheets = []; });
  assert.deepEqual(await geometry(), before, 'Removing hydration preserves CSSOM and constructed stylesheet layout/cascade');
  assert.equal(await page.locator('#name').inputValue(), 'hydrated value');
  assert.equal(await page.locator('#checked').isChecked(), true);
  assert.equal(await page.locator('#text').inputValue(), 'hydrated text');
  assert.equal(await page.locator('#select').inputValue(), 'Two');
  assert.match(await page.locator('#data-srcset').getAttribute('srcset'), /d29ybGQ= 2x/);
  assert.equal(await page.locator('#bad-srcset').getAttribute('srcset'), null);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal((await geometry()).width, '280px', 'Serialized styles retain the original responsive rules');
  assert.equal((await geometry()).height, '120px');

  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const outlined = '<!doctype html><html><head><style data-kodety-framer-visual-cleanup>html body [data-highlight]:not(:focus-visible){outline:none}</style></head><body>'
    + '<button id="tap" data-highlight="true" style="outline:rgb(0,153,255) solid 2px;border:3px solid rgb(23,24,25);box-shadow:rgb(0,0,0) 0px 2px 3px">Tap</button>'
    + '<div id="decoration" style="outline:4px solid rgb(255,0,0)">Authored outline</div>'
    + '<button id="keyboard" data-framer-highlight="true">Keyboard</button>'
    + '<style>#keyboard:focus-visible{outline:3px solid rgb(1,2,3)}</style></body></html>';
  const cleaned = await page.evaluate(html => {
    const first = FramerCleanup.ensureFramerVisualCleanup(html);
    const literal = '<script>const template = "<style data-kodety-framer-visual-cleanup>authored string</style>";</script>';
    const protectedSource = FramerCleanup.ensureFramerVisualCleanup('<html><head>' + literal + '</head><body>Page</body></html>');
    return { first, second: FramerCleanup.ensureFramerVisualCleanup(first), css: FramerCleanup.FRAMER_VISUAL_CLEANUP_CSS, preservedLiteral: protectedSource.includes(literal) };
  }, outlined);
  assert.equal(cleaned.first, cleaned.second, 'Visual repair must be idempotent on reopen');
  assert.equal(cleaned.preservedLiteral, true, 'Repair cannot rewrite matching markup inside legitimate script strings');
  assert.ok(php.includes(`'${cleaned.css}'`), 'WordPress and imported ZIP visual repair use the same scoped CSS');
  await page.setContent(cleaned.first);
  const style = id => page.locator(`#${id}`).evaluate(node => {
    const css = getComputedStyle(node);
    return { outline: css.outlineStyle, width: css.outlineWidth, border: css.borderWidth, shadow: css.boxShadow };
  });
  assert.equal((await style('tap')).outline, 'none', 'Idle captured inline blue outline is removed');
  assert.equal((await style('tap')).border, '3px', 'Real design borders survive');
  assert.notEqual((await style('tap')).shadow, 'none', 'Authored shadows survive');
  assert.equal((await style('decoration')).width, '4px', 'Elements without Framer highlight keep authored outlines');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#tap').evaluate(node => node.matches(':focus-visible')), true);
  assert.equal((await style('tap')).width, '2px', 'Keyboard focus remains visible');
  await page.keyboard.press('Tab');
  assert.equal((await style('keyboard')).width, '3px', 'Authored keyboard focus remains visible');
  await page.mouse.click(350, 700);
  assert.equal((await style('tap')).outline, 'none');
  assert.deepEqual(errors, []);
  console.log('Framer capture browser: CSSOM, adopted sheets, responsive layout, form state and blue-outline/focus regression passed.');
} finally {
  await browser.close();
}
