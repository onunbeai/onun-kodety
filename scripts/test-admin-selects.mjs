import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../Wordpress/kodety/admin/components/native-select.js', import.meta.url), 'utf8');
const context = { result: null };
runInNewContext(source.replaceAll('export function', 'function') + ';result={resolveSelectOption,mountNativeSelects,consumeSelectKey};', context);
const resolve = context.result.resolveSelectOption;
const group = { disabled: true, hidden: false };
const option = (label, settings = {}) => ({ label, textContent: label, disabled: false, hidden: false, closest: () => null, ...settings });
const options = [
  option('Choose', { disabled: true }),
  option('Português'),
  option('Hidden', { hidden: true }),
  option('Unavailable', { disabled: true }),
  option('English'),
  option('Español'),
  option('European Portuguese', { closest: () => group }),
  option('São Paulo'),
  option('  Français'),
  option('', { textContent: 'Deutsch' }),
];
const items = options.map((option, index) => ({ option, index }));
assert.equal(resolve(items, 0, 'ArrowDown'), items[1], 'Disabled placeholders never become the active option.');
assert.equal(resolve(items, 1, 'ArrowDown'), items[4], 'Arrow navigation skips hidden and disabled options.');
assert.equal(resolve(items, 4, 'ArrowUp'), items[1]);
assert.equal(resolve(items, -1, 'Home'), items[1]);
assert.equal(resolve(items, -1, 'End'), items[9]);
assert.equal(resolve(items, 9, 'ArrowDown'), items[9], 'The lower boundary remains stable.');
assert.equal(resolve(items, 1, 'ArrowUp'), items[1], 'The upper boundary remains stable.');
assert.equal(resolve(items, 1, 'e', 'e'), items[4]);
assert.equal(resolve(items, 4, 'e', 'ee'), items[5], 'Repeated letters cycle through enabled matching options.');
assert.equal(resolve(items, 5, 'e', 'eee'), items[4], 'Repeated-letter navigation wraps.');
assert.equal(resolve(items, 1, 'o', 'sao'), items[7], 'Typeahead ignores accents.');
assert.equal(resolve(items, 1, 'f', 'FR'), items[8], 'Typeahead ignores leading whitespace and letter case.');
assert.equal(resolve(items, 4, 'd', 'deu'), items[9], 'Native option text is used when label is empty.');
assert.equal(resolve(items, 4, 'z', 'unknown'), undefined);
assert.equal(resolve(items, 4, ' ', ''), undefined);
group.disabled = false;
assert.equal(resolve(items, 5, 'ArrowDown'), items[6], 'Group eligibility follows the current native disabled state.');
group.hidden = true;
assert.equal(resolve(items, 5, 'ArrowDown'), items[7], 'Hidden option groups are skipped.');
for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'x']) {
  assert.equal(resolve([], -1, key, 'x'), undefined);
  assert.equal(resolve([{ option: option('Disabled', { disabled: true }), index: 0 }], 0, key, 'd'), undefined);
}
// Execute actual popup event listeners with a minimal event target fixture.
// Native workspace dismisses a filter on document pointerdown; a portaled
// option must stop at its own surface while native change events stay separate.
const listeners = new Map();
let mountedPopup;
context.document = {
  body: { classList: { contains: name => name === 'kodety-os' }, append: node => { mountedPopup = node; } },
  createElement: () => ({ setAttribute() {}, remove() {}, addEventListener(type, handler) { listeners.set(type, handler); } }),
  querySelectorAll: () => [],
  addEventListener() {},
};
context.window = { addEventListener() {} };
context.MutationObserver = class { observe() {} disconnect() {} };
const controller = new AbortController();
context.result.mountNativeSelects({ config: { adminSurface: 'native' }, signal: controller.signal });
assert.ok(mountedPopup, 'The real mount created the popup event target.');
for (const type of ['pointerdown', 'mousedown', 'click']) {
  let dismissed = false;
  const event = { target: { closest: () => null }, stopped: false, canceled: false, preventDefault() { this.canceled = true; }, stopPropagation() { this.stopped = true; } };
  listeners.get(type)(event);
  if (!event.stopped) dismissed = true;
  assert.equal(dismissed, false, `${type} on a portaled option must not dismiss its filter or modal.`);
  assert.equal(event.canceled, type !== 'click', 'Pointer focus stays on the owning combobox.');
}
controller.abort();
// WordPress quick edit saves on td keydown Enter and closes on row keyup
// Escape without checking defaultPrevented. Reproduce those ancestor handlers.
const keyState = {};
let saves = 0, reverts = 0;
const dispatchKey = (type, key, consumed = false) => {
  const event = { type, key, which: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } };
  if (consumed || type === 'keyup') context.result.consumeSelectKey(event, keyState);
  if (!event.stopped && type === 'keydown' && event.which === 13) saves++;
  if (!event.stopped && type === 'keyup' && event.which === 27) reverts++;
  return event;
};
for (const action of ['open', 'commit']) {
  assert.equal(dispatchKey('keydown', 'Enter', true).stopped, true, `${action} must not save Quick Edit.`);
  assert.equal(dispatchKey('keyup', 'Enter').stopped, true);
}
assert.equal(saves, 0);
assert.equal(dispatchKey('keydown', 'Escape', true).stopped, true);
assert.equal(dispatchKey('keyup', 'Escape').stopped, true);
assert.equal(reverts, 0, 'Closing the popup must preserve the open editor.');
assert.equal(dispatchKey('keydown', 'Escape').stopped, false);
assert.equal(dispatchKey('keyup', 'Escape').stopped, false);
assert.equal(reverts, 1, 'A second Escape still reaches the original WordPress cancel handler.');
for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'p', ' ']) {
  assert.equal(dispatchKey('keydown', key, true).stopped, true);
  assert.equal(dispatchKey('keyup', key).stopped, true);
}
assert.equal(dispatchKey('keydown', 'Tab').stopped, false, 'Tab stays available to the enclosing focus trap.');
assert.equal(dispatchKey('keyup', 'Tab').stopped, false);
console.log('Admin selects: keyboard boundaries, native disabled/hidden options and groups, accent-insensitive typeahead, repeat cycling, empty lists and portaled event isolation and native Quick Edit key isolation passed.');
