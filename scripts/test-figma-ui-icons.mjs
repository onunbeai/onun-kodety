import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ui = readFileSync(new URL('../FigmaPlugin/ui.html', import.meta.url), 'utf8');
const icons = [...ui.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(match => match[0]);
const solarIcons = icons.filter(icon => icon.includes('data-solar-icon='));

test('plugin icons embed genuine Solar Bold Duotone paths with their two-tone opacity', async () => {
  assert.equal(solarIcons.length, 15);
  for (const icon of solarIcons) {
    const name = icon.match(/data-solar-icon="([^"]+)"/)[1];
    assert.ok(name.endsWith('-bold-duotone'), name);
    const slug = name.replace(/-bold-duotone$/, '');
    const exportName = slug.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'Icon';
    const component = (await import(`@solar-icons/react/bold-duotone/${slug}`))[exportName];
    assert.ok(component, name);
    const original = renderToStaticMarkup(React.createElement(component));
    const children = markup => markup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    assert.equal(children(icon), children(original), `${name} must preserve the package's paths`);
    assert.match(icon, /opacity:var\(--solar-secondary-opacity, 0\.5\)/, name);
    assert.doesNotMatch(icon, /\bstroke=/, `${name} must be filled, not linear`);
  }
});

test('desktop, tablet and mobile preview controls each use a duotone filled icon', () => {
  for (const [device, icon] of [['desktop', 'monitor'], ['tablet', 'tablet'], ['mobile', 'smartphone']]) {
    const button = ui.match(new RegExp(`<button[^>]*data-preview-device="${device}"[^>]*>([\\s\\S]*?)<\\/button>`));
    assert.ok(button, device);
    assert.match(button[1], new RegExp(`data-solar-icon="${icon}-bold-duotone"`));
    assert.doesNotMatch(button[1], /\bstroke=/);
  }
});

test('only directional chevrons retain linear strokes', () => {
  const stroked = icons.filter(icon => /\bstroke=/.test(icon));
  assert.equal(stroked.length, 3);
  for (const icon of stroked) {
    assert.match(icon, /d="(?:m9 6 6 6-6 6|m8 10 4 4 4-4)"/);
  }
});

test('the real Kodety logo is preserved and icons remain decorative and offline', () => {
  const logo = icons.find(icon => icon.includes('viewBox="0 0 114 122"'));
  assert.ok(logo);
  assert.match(logo, /d="M51\.1932 122L0 61L113\.183 94\.8289V122H51\.1932Z"/);
  assert.match(logo, /d="M51\.1932 0L0 61L113\.183 27\.1711V0H51\.1932Z"/);
  for (const icon of solarIcons) {
    assert.match(icon, /aria-hidden="true"/);
    assert.match(icon, /focusable="false"/);
    assert.doesNotMatch(icon, /<(?:image|use|script)\b|https?:\/\//);
  }
});

test('the packaged third-party notice credits Solar Icons and its CC BY license', () => {
  const notices = readFileSync(new URL('../FigmaPlugin/THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  assert.match(notices, /Solar Icons[\s\S]*480 Design/);
  assert.match(notices, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(notices, /https:\/\/www\.figma\.com\/community\/file\/1166831539721848736/);
});
