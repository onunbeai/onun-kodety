import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const pluginCode = await readFile(new URL('../FigmaPlugin/code.js', import.meta.url), 'utf8');
const figma = { mixed: Symbol('mixed'), command: '', showUI() {}, on() {}, ui: { postMessage() {} }, root: { name: 'Gradient fixture' }, currentPage: { id: 'page', name: 'Page', selection: [], on() {} } };
const plugin = { figma, __html__: '', console, setTimeout, clearTimeout };
vm.runInNewContext(pluginCode, plugin, { filename: 'FigmaPlugin/code.js' });
const whiteFade = [
  { position: 0, color: { r: 1, g: 1, b: 1, a: .5 } },
  { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } },
];
const paint = (gradientTransform, extra = {}) => ({ type: 'GRADIENT_LINEAR', gradientTransform, gradientStops: whiteFade, ...extra });
const button = { width: 296, height: 64 };
const vertical = paint([[0, 1, 0], [-1, 0, 1]]);
assert.equal(plugin.gradient(vertical, button), 'linear-gradient(180deg, rgb(255 255 255 / 50%) 0%, rgb(255 255 255 / 0%) 100%)', 'The top highlight must fade all the way to transparent at the bottom');
assert.equal(plugin.gradient(paint([[1, 0, 0], [0, 1, 0]]), button), 'linear-gradient(90deg, rgb(255 255 255 / 50%) 0%, rgb(255 255 255 / 0%) 100%)');
assert.equal(plugin.gradient(paint([[0, -1, 1], [1, 0, 0]]), button), 'linear-gradient(0deg, rgb(255 255 255 / 50%) 0%, rgb(255 255 255 / 0%) 100%)');
assert.equal(plugin.gradient(paint([[2, 0, -.5], [0, 1, 0]]), button), 'linear-gradient(90deg, rgb(255 255 255 / 50%) 25%, rgb(255 255 255 / 0%) 75%)', 'Authored start/end offsets must not become a full-width fade');
assert.match(plugin.gradient(paint([[0, 2, -.2], [-1, 0, 1]]), button), /10%, rgb\(255 255 255 \/ 0%\) 60%/);
assert.equal(plugin.gradient({ ...vertical, opacity: .4 }, button), 'linear-gradient(180deg, rgb(255 255 255 / 20%) 0%, rgb(255 255 255 / 0%) 100%)', 'Paint opacity multiplies, rather than replaces, each stop alpha');
assert.equal(plugin.gradient({ ...vertical, opacity: 0 }, button), 'linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, rgb(255 255 255 / 0%) 100%)', 'Explicit zero opacity must never default to opaque');
const stopOffsets = paint([[1, 0, 0], [0, 1, 0]], { gradientStops: [whiteFade[0], { ...whiteFade[0], position: .32 }, { ...whiteFade[1], position: .32 }, whiteFade[1]] });
assert.match(plugin.gradient(stopOffsets, button), /50%\) 32%, rgb\(255 255 255 \/ 0%\) 32%/, 'Duplicate stop offsets preserve the authored hard edge');
const restVertical = { type: 'GRADIENT_LINEAR', gradientStops: whiteFade, gradientHandlePositions: [{ x: .5, y: 0 }, { x: .5, y: 1 }, { x: 0, y: 0 }] };
assert.equal(plugin.gradient(restVertical, button), plugin.gradient(vertical, button), 'REST handles and the native affine transform must agree');
assert.equal(plugin.gradient({ ...vertical, gradientHandlePositions: [{ x: 0, y: .5 }, { x: 1, y: .5 }, { x: 0, y: 1 }] }, button), plugin.gradient(vertical, button), 'Live transform takes priority over stale alternate handle metadata');
const sheared = paint([[1, .5, 0], [.3, 1, 0]]);
assert.equal(plugin.gradient(sheared, { width: 400, height: 100 }), 'linear-gradient(153.434949deg, rgb(255 255 255 / 50%) 0%, rgb(255 255 255 / 0%) 66.666667%)', 'A sheared, non-square gradient uses its true constant-color normal');

// Recover color parameters from the CSS gradient line using its independent
// center/corner geometry and compare with the Figma affine scalar at probes.
for (const shape of [{ width: 296, height: 64 }, { width: 64, height: 296 }, { width: 100, height: 100 }]) {
  for (const matrix of [vertical.gradientTransform, [[2, 0, -.5], [0, 1, 0]], sheared.gradientTransform, [[-1, .3, .8], [.4, 1, -.1]]]) {
    const source = paint(matrix);
    const css = plugin.gradient(source, shape);
    const angle = Number(css.match(/linear-gradient\(([-\d.]+)deg/)[1]) * Math.PI / 180;
    const endpoints = [...css.matchAll(/\) ([-\d.]+)%/g)].map(match => Number(match[1]) / 100);
    const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
    const lineLength = Math.abs(shape.width * direction.x) + Math.abs(shape.height * direction.y);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5], [.23, .71]]) {
      const cssPosition = .5 + ((x - .5) * shape.width * direction.x + (y - .5) * shape.height * direction.y) / lineLength;
      const parameter = (cssPosition - endpoints[0]) / (endpoints[1] - endpoints[0]);
      const expected = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2];
      assert.ok(Math.abs(parameter - expected) < 1e-6, `CSS must preserve Figma color parameter at ${x},${y} in ${shape.width}×${shape.height}`);
    }
  }
}
assert.equal(plugin.cssRepresentableGradient(vertical, button), true);
assert.equal(plugin.cssRepresentableGradient(paint([[2, 0, -.5], [0, 1, 0]]), button), true);
assert.equal(plugin.cssRepresentableGradient(restVertical, button), true);
assert.equal(plugin.cssRepresentableGradient(sheared, button), false, 'Changing aspect ratio would change a fixed CSS diagonal angle, so sample that paint natively');
for (const type of ['GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']) {
  assert.equal(plugin.cssRepresentableGradient({ ...vertical, type }, button), false, `${type} must retain the native sampling path`);
}
assert.equal(plugin.cssRepresentableGradient({ type: 'GRADIENT_LINEAR', gradientStops: whiteFade }, button), false, 'Missing geometry must not be advertised as exact');
assert.equal(plugin.cssRepresentableGradient(paint([[0, 0, .5], [0, 1, 0]]), button), false, 'Degenerate gradients need native handling');
console.log('Figma gradient fidelity: transparent highlight, stop alpha/offsets, native/REST geometry, shear, aspect ratio and safe sampling classification passed.');
