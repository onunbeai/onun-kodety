import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = path.dirname(testDirectory);
const source = await fs.readFile(path.join(bridgeDirectory, 'dom-to-spec.js'), 'utf8');
const fixture = await fs.readFile(path.join(testDirectory, 'fixtures', 'extractor.html'), 'utf8');

test('browser extractor source is syntactically valid', () => {
  assert.doesNotThrow(() => new vm.Script(source));
});

test('component groups use a scene-global counter and conservative visual fingerprint', () => {
  assert.match(source, /const groups = new Map\(\)/);
  assert.match(source, /opts\.componentContext\.nextId\+\+/);
  assert.match(source, /namespace: 'kodety-scene-' \+ \(\+\+_componentSceneSequence\)/);
  assert.doesNotMatch(source, /let nextGroupId\s*=/);
  for (const marker of [
    'COMPONENT_VISUAL_PROPERTIES',
    'COMPONENT_PSEUDO_PROPERTIES',
    'allSemanticClasses(el.className)',
    "el.getAttribute('d')",
    'getTextValue(el)',
    "'object-fit', 'object-position'",
  ]) assert.ok(source.includes(marker), marker);
});

test('grid and unsafe flex ordering fall back to measured NONE layout', () => {
  assert.match(source, /cs\.display\.includes\('grid'\)\) return 'NONE'/);
  assert.match(source, /cs\.flexDirection === 'row-reverse'/);
  assert.match(source, /cs\.flexWrap === 'wrap-reverse'/);
  assert.match(source, /getComputedStyle\(child\)\.order/);
  assert.match(source, /cn\.x = Math\.round\(cr\.left - parentRect\.left\)/);
  assert.match(source, /rangeBoundsForNode\(node\)/);
  assert.match(source, /bounds: cr/);
  assert.match(source, /for \(const item of draft\)/);
  assert.doesNotMatch(source, /let idx = 0;\s*for \(const child of el\.children\)/);
  assert.ok(fixture.includes('grid-template-columns: 2fr 1fr'));
  assert.ok(fixture.includes('flex-direction: row-reverse'));
  assert.ok(fixture.includes('order: 2'));
  assert.ok(fixture.includes('mixed-absolute'));
});

test('safe flex metadata preserves directional gaps, stretch, grow, and content sizing', () => {
  assert.match(source, /verticalLayout \? cs\.rowGap : cs\.columnGap/);
  assert.match(source, /verticalLayout \? cs\.columnGap : cs\.rowGap/);
  assert.match(source, /cn\.layoutGrow = layoutGrowOf\(childCs\)/);
  assert.match(source, /cn\.layoutAlign = childLayoutAlign/);
  assert.match(source, /computedStyleMap/);
  assert.match(source, /primaryAxisSizingMode/);
  assert.match(source, /counterAxisSizingMode/);
});

test('fills, crop focus, font style, BR, and preserved whitespace are represented', () => {
  assert.match(source, /solidFillLayer\(bgColor, bgAlpha\)/);
  assert.match(source, /objectPosition: objectPositionOf\(cs, rect\)/);
  assert.match(source, /fontStyle: fontStyleOf/);
  assert.match(source, /fontFamily: style\.family !== parentFamily/);
  assert.match(source, /fontStyle: style\.style !== parentStyle/);
  assert.match(source, /forcedBreak: true/);
  assert.match(source, /\['pre', 'pre-wrap', 'break-spaces'\]/);
  assert.ok(fixture.includes('font-style: italic'));
  assert.ok(fixture.includes('white-space: pre-line'));
  assert.ok(fixture.includes('<br>'));
});

test('recognized CSS color variables are normalized to hex while other tokens stay raw', () => {
  assert.match(source, /out\[prop\] = colorToHexWithAlpha\(val\) \|\| val/);
  assert.match(source, /Math\.round\(channels\.a \* 255\)/);
  assert.ok(fixture.includes('--accent: oklch('));
  assert.ok(fixture.includes('--overlay: hsl('));
  assert.ok(fixture.includes('--spacing: 16px'));
});

test('textual buttons and links preserve flex alignment and nested rich-text ranges', () => {
  assert.match(source, /primaryAxisAlign: primaryAxisAlignOf\(cs, true\)/);
  assert.match(source, /counterAxisAlign: counterAxisAlignOf\(cs, true\)/);
  assert.match(source, /const ranges = collectStyleRanges\(el, cs\)/);
  assert.match(source, /ranges: ranges\.length \? ranges : undefined/);
  assert.ok(fixture.includes('justify-content: center'));
  assert.ok(fixture.includes('align-items: flex-end'));
  assert.ok(fixture.includes('<em>Italic action</em>'));
});
