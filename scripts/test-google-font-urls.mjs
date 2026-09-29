import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';

// Primary API contracts:
// https://developers.google.com/fonts/docs/css2
// https://developers.google.com/fonts/docs/developer_api
// https://developers.google.com/fonts/docs/material_symbols
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'silent', appType: 'custom',
  resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => server.close());
const { buildGoogleFontUrl, getGoogleFontLinks } = await server.ssrLoadModule('/lib/font-utils.ts');
const font = (overrides = {}) => ({ id: 'fixture-font', name: 'fixture', family: 'Fixture Family', type: 'google',
  category: 'sans-serif', variants: [], weights: [], created_at: '', updated_at: '', deleted_at: null,
  is_published: false, ...overrides });
const spec = input => new URL(buildGoogleFontUrl(font(input))).searchParams.get('family');

test('static asymmetric variants produce only their actual style/weight pairs', () => {
  assert.equal(spec({ variants: ['regular', '700', '700italic', '900italic'], weights: ['400', '700', '900'] }),
    'Fixture Family:ital,wght@0,400;0,700;1,700;1,900');
});

test('a static italic-only family never implicitly requests an unavailable normal face', () => {
  assert.equal(spec({ variants: ['italic'], weights: ['400'] }), 'Fixture Family:ital,wght@1,400');
  assert.equal(spec({ variants: ['500italic', '700italic'], weights: ['500', '700'] }),
    'Fixture Family:ital,wght@1,500;1,700');
});

test('catalog variants take precedence over legacy aggregate weights', () => {
  assert.equal(spec({ variants: ['300', '300italic', '700'], weights: ['100', '300', '400', '700', '900'] }),
    'Fixture Family:ital,wght@0,300;0,700;1,300');
});

test('static tuples are deduplicated and sorted numerically, including weight1000', () => {
  assert.equal(spec({ variants: ['1000', '900', 'regular', '400', '0400', '700italic', '700italic'] }),
    'Fixture Family:ital,wght@0,400;0,900;0,1000;1,700');
});

test('weight-only legacy entries still load safely without inventing italic faces', () => {
  assert.equal(spec({ weights: ['900', '1000', '100', '400', '100', 'garbage', '0', '1001', '400&bad=1'] }),
    'Fixture Family:wght@100;400;900;1000');
});

test('static weights must never become an unsupported variable range', () => {
  const url = spec({ variants: ['200', '300', 'regular', '500', '600', '700', '800'] });
  assert.equal(url, 'Fixture Family:wght@200;300;400;500;600;700;800');
  assert.doesNotMatch(url, /\.\./);
});

test('normal and italic variable fonts keep the full available weight and optical-size ranges', () => {
  assert.equal(spec({ variants: ['regular', 'italic', '700', '700italic'], weights: ['400', '700'],
    axes: [{ tag: 'wght', start: 100, end: 900 }, { tag: 'opsz', start: 14, end: 32 }] }),
  'Fixture Family:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900');
});

test('italic-only variable families request only the supported italic range', () => {
  assert.equal(spec({ variants: ['italic'], axes: [{ tag: 'wght', start: 200, end: 900 }] }),
    'Fixture Family:ital,wght@1,200..900');
  assert.equal(spec({ axes: [{ tag: 'ital', start: 1, end: 1 }, { tag: 'wght', start: 500, end: 800 }] }),
    'Fixture Family:ital,wght@1,500..800');
});

test('variable fonts without a weight axis still expose their available axes', () => {
  assert.equal(spec({ axes: [{ tag: 'opsz', start: 8, end: 72 }] }), 'Fixture Family:opsz@8..72');
  assert.equal(spec({ variants: ['regular'], axes: [{ tag: 'MONO', start: 0, end: 1 }] }),
    'Fixture Family:wght,MONO@400,0..1');
  assert.equal(spec({ axes: [{ tag: 'ital', start: 1, end: 1 }] }), 'Fixture Family:ital@1');
});

test('static asymmetric styles stay asymmetric even with another variable axis', () => {
  assert.equal(spec({ variants: ['regular', '700italic'], axes: [{ tag: 'opsz', start: 10, end: 72 }] }),
    'Fixture Family:ital,opsz,wght@0,10..72,400;1,10..72,700');
});

test('custom axes follow registered axes in the documented CSS2 ordering', () => {
  assert.equal(spec({ variants: ['regular'], axes: [
    { tag: 'GRAD', start: -50, end: 200 }, { tag: 'wght', start: 100, end: 700 },
    { tag: 'FILL', start: 0, end: 1 }, { tag: 'opsz', start: 20, end: 48 },
  ] }), 'Fixture Family:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
});

test('fixed-axis coordinates serialize as values, not empty ranges, and duplicate axes are removed', () => {
  assert.equal(spec({ variants: ['regular'], axes: [
    { tag: 'opsz', start: 14, end: 14 }, { tag: 'wght', start: 400, end: 400 },
    { tag: 'opsz', start: 8, end: 72 }, { tag: 'wght', start: 100, end: 900 },
  ] }), 'Fixture Family:opsz,wght@14,400');
});

test('invalid metadata cannot inject query parameters or invalid range strings', () => {
  const input = font({ family: 'A&B?text=secret', variants: ['regular', '700italic;bad', '0', '1001', 'NaN'], axes: [
    { tag: 'wght&x=y', start: 1, end: 2 }, { tag: 'wght', start: 900, end: 100 },
    { tag: 'opsz', start: NaN, end: 100 }, { tag: 'wdth', start: 0, end: 100 },
    { tag: 'GRAD', start: 0, end: Infinity }, { tag: 'ital', start: -1, end: 2 },
  ] });
  const url = new URL(buildGoogleFontUrl(input));
  assert.deepEqual([...url.searchParams.keys()], ['family', 'display']);
  assert.equal(url.searchParams.get('family'), 'A&B?text=secret:wght@400');
  assert.equal(url.searchParams.get('display'), 'swap');
});

test('missing or invalid variants keep the ordinary default-family fallback', () => {
  assert.equal(spec({}), 'Fixture Family');
  assert.equal(spec({ variants: ['bold', 'italic&text=bad'], weights: ['NaN', '0', '1001'] }), 'Fixture Family');
});

test('URL generation and shared link helpers never mutate catalog entries', () => {
  const input = font({ variants: ['700italic', 'regular'], axes: [{ tag: 'wght', start: 100, end: 900 }] });
  const before = JSON.stringify(input);
  assert.deepEqual(getGoogleFontLinks([input]), [buildGoogleFontUrl(input)]);
  assert.equal(JSON.stringify(input), before);
});

test('official CSS2 endpoint accepts real asymmetric and variable requests', { skip: !process.argv.includes('--live') }, async () => {
  const inputs = [
    font({ family: 'Open Sans Condensed', variants: ['300', '300italic', '700'], weights: ['300', '700'] }),
    font({ family: 'Crimson Pro', variants: ['italic'], axes: [{ tag: 'wght', start: 200, end: 900 }] }),
    font({ family: 'Roboto Flex', variants: ['regular'], axes: [
      { tag: 'GRAD', start: -200, end: 150 }, { tag: 'wght', start: 100, end: 1000 }, { tag: 'opsz', start: 8, end: 144 },
    ] }),
  ];
  for (const input of inputs) {
    const response = await fetch(buildGoogleFontUrl(input), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, input.family);
    assert.match(await response.text(), /@font-face/);
  }
});
