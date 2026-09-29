/** Browser behavior of native Elementor output; runs independently of WordPress. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const fixture = JSON.parse(execFileSync('php', [
  '-r',
  'define("KODETY_ELEMENTOR_FIXTURE_ONLY", true); require $argv[1]; echo json_encode(["advanced" => $advanced, "columns" => $columns], JSON_THROW_ON_ERROR);',
  path.join(import.meta.dirname, 'elementor-import-runtime.php'),
], { encoding: 'utf8' }));
const documentFor = result => result.html.replace('<link rel="stylesheet" href="css/elementor-converted.css">', `<style>${result.css}</style>`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent(documentFor(fixture.advanced));
  const computed = selector => page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { display: style.display, fontSize: style.fontSize, padding: style.padding, background: style.backgroundColor, columns: style.gridTemplateColumns, width: element.getBoundingClientRect().width };
  });
  assert.equal((await computed('#pricing')).display, 'grid');
  assert.equal((await computed('#pricing')).columns.split(' ').length, 3);
  assert.equal((await computed('#elementor-202-title h2')).fontSize, '48px');
  assert.equal((await computed('#elementor-202-cta')).padding, '3px');
  assert.equal((await computed('#elementor-202-cta > a')).padding, '12px 28px');
  assert.equal((await computed('#elementor-202-cta')).background, 'rgb(240, 240, 240)');
  assert.equal((await computed('#elementor-202-cta > a')).background, 'rgb(18, 52, 86)');
  const imageRatio = (await computed('#elementor-202-photo img')).width / (await computed('#elementor-202-photo')).width;
  assert.ok(Math.abs(imageRatio - 0.6) < 0.01, 'image width applies once within the separate Advanced wrapper width');

  await page.setViewportSize({ width: 900, height: 1000 });
  assert.equal((await computed('#pricing')).display, 'none', 'source tablet-only visibility interval');
  assert.equal((await computed('#elementor-202-title h2')).fontSize, '32px');
  await page.setViewportSize({ width: 600, height: 1000 });
  assert.equal((await computed('#pricing')).display, 'grid', 'mobile stays visible after a tablet hide control');
  assert.equal((await computed('#pricing')).columns.split(' ').length, 1);
  assert.equal((await computed('#elementor-202-title h2')).fontSize, '32px', 'mobile inherits tablet typography');
  assert.equal((await computed('#elementor-202-responsive-global h2')).fontSize, '26px', 'responsive Kit typography applies');
  assert.equal((await computed('#elementor-202-photo img')).width, (await computed('#elementor-202-photo')).width);
  assert.equal(await page.locator('#elementor-202-faq details[open]').count(), 1);
  await page.locator('#elementor-202-faq summary').nth(1).click();
  assert.equal(await page.locator('#elementor-202-faq details[open]').count(), 1, 'native accordion keeps exactly one open panel');
  assert.equal(await page.locator('#elementor-202-faq details').nth(1).getAttribute('open'), '');
  await page.locator('#elementor-202-toggle summary').click();
  assert.equal(await page.locator('#elementor-202-toggle details[open]').count(), 1, 'toggle works without Elementor scripts');

  // Saving an authored CSS change and reopening the portable document must keep
  // viewport rules and native interactions intact.
  const edited = JSON.parse(JSON.stringify(fixture.advanced));
  edited.css = edited.css.replace('background-color:#123456;', 'background-color:#c02030;');
  await page.setContent(documentFor(edited));
  assert.equal((await computed('#elementor-202-cta > a')).background, 'rgb(192, 32, 48)');
  assert.equal((await computed('#elementor-202-title h2')).fontSize, '32px');
  assert.equal(await page.locator('script').count(), 0);
  assert.equal(await page.locator('#elementor-202-custom-html button').isDisabled(), true);
  assert.deepEqual(errors, []);

  await page.setContent(documentFor(fixture.columns));
  await page.setViewportSize({ width: 1200, height: 1000 });
  assert.equal((await computed('#elementor-left')).width, 480, 'legacy source column ratio on desktop');
  assert.equal((await computed('#elementor-right')).width, 720);
  await page.setViewportSize({ width: 900, height: 1000 });
  assert.equal((await computed('#elementor-left')).width, 360, 'legacy columns remain in a row on tablet');
  await page.setViewportSize({ width: 600, height: 1000 });
  assert.equal((await computed('#elementor-left')).width, 600, 'default mobile column stacks');
  assert.equal((await computed('#elementor-right')).width, 300, 'explicit mobile width remains editable');
  console.log('Elementor native browser: source viewport cascade, widget targets, HTML interactions and portable CSS save/reopen passed.');
} finally {
  await browser.close();
}
