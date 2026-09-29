import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../Wordpress/kodety/admin/components/navigation-loading.js', import.meta.url), 'utf8');
const classes = new Set();
const attributes = new Map();
const listeners = new Map();
const timers = new Map();
let serial = 0;
const root = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
const skeleton = { dataset: {} };
const status = { textContent: '' };
const content = { setAttribute: (key,value) => attributes.set(key,value), removeAttribute: key => attributes.delete(key) };
const listen = (type, handler) => { const handlers = listeners.get(type) || []; handlers.push(handler); listeners.set(type, handlers); };
const window = {
  location: { href: 'https://example.test/subsite/wp-admin/index.php' },
  addEventListener: listen,
  setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, {callback, delay}); return id; },
  clearTimeout: id => timers.delete(id),
};
const document = {
  documentElement: root, addEventListener: listen,
  querySelector: selector => ({ '#kodety-navigation-loading': skeleton, '#wpbody-content': content, '#kodety-navigation-status': status })[selector],
};
const context = { window, document, URL, result: null };
runInNewContext(source.replaceAll('export function', 'function') + ';result={navigationLayout,mountNavigationLoading};', context);
const { navigationLayout, mountNavigationLoading } = context.result;
const adminUrl = 'https://example.test/subsite/wp-admin/';
assert.equal(navigationLayout('users.php?role=administrator', adminUrl), 'list');
assert.equal(navigationLayout('admin.php?page=kodety#kodety-security', adminUrl), 'settings');
assert.equal(navigationLayout('export-personal-data.php', adminUrl), 'settings');
assert.equal(navigationLayout('erase-personal-data.php', adminUrl), 'settings');
for (const path of ['post.php?post=3&action=edit','customize.php','update.php?action=install-plugin','plugins.php?_wpnonce=x','export.php?download=1','admin.php?page=third-party','admin.php?page=kodety-editor','admin.php?page=kodety-cms','https://elsewhere.test/wp-admin/users.php','https://example.test/wp-admin/users.php']) {
  assert.equal(navigationLayout(path, adminUrl), null, `Original workflow: ${path}`);
}
const controller = new AbortController();
mountNavigationLoading({ config: {adminUrl}, signal: controller.signal, uiText: pt => pt });
const dispatch = (type,event={}) => listeners.get(type)?.forEach(listener=>listener(event));
const flush = delay => { for(const [id,timer] of [...timers]) if(timer.delay===delay && timers.delete(id))timer.callback(); };
const click = (path, options={}) => {
  const link = { href: new URL(path,adminUrl).href, target: options.target || '', hasAttribute: key => key === 'download' && options.download, matches: () => false, closest: () => null };
  const event = {button:0, defaultPrevented:false, target:{closest:()=>link}, ...options};
  dispatch('click',event); return event;
};
click('users.php'); flush(0);
assert.ok(classes.has('kodety-admin-navigating'));
assert.equal(skeleton.dataset.layout,'list');
assert.equal(attributes.get('aria-busy'),'true');
dispatch('pageshow');
assert.ok(!classes.has('kodety-admin-navigating') && !attributes.has('aria-busy'));
for(const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{target:'_blank'},{download:true}]) {
  click('users.php',options); flush(0); assert.ok(!classes.has('kodety-admin-navigating'));
}
click('index.php#local'); flush(0); assert.ok(!classes.has('kodety-admin-navigating'));
const intercepted = click('users.php'); intercepted.defaultPrevented=true; flush(0);
assert.ok(!classes.has('kodety-admin-navigating'),'A later plugin click handler can cancel navigation.');
click('users.php'); flush(0); dispatch('beforeunload',{defaultPrevented:true}); flush(0);
assert.ok(!classes.has('kodety-admin-navigating'),'Canceled unload restores the current screen.');
click('users.php'); flush(0); flush(8000);
assert.ok(!classes.has('kodety-admin-navigating'),'Interrupted requests never strand an overlay.');
click('users.php'); flush(0); controller.abort();
assert.ok(!classes.has('kodety-admin-navigating') && !attributes.has('aria-busy'));
click('users.php'); flush(0); assert.ok(!classes.has('kodety-admin-navigating'),'Destroyed shells cannot mount another overlay.');
console.log('Admin navigation: routing, native actions, event cancellation, history and recovery passed.');
