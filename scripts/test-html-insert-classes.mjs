import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});
const html = body => `<!doctype html><html><head><title>Test</title></head><body>${body}</body></html>`;
const nonVisual = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'noscript', 'template', 'br']);
const editableElements = markup => {
  const elements = [];
  const visit = node => {
    if (nonVisual.has(node.tagName)) return;
    if (node.tagName) elements.push(node);
    if (node.tagName !== 'svg') (node.childNodes || []).forEach(visit);
  };
  visit(parseFragment(markup));
  return elements;
};
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';

try {
  const [patcher, constants, native, liveDom, membership, components, codeComponents, selectors, css] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/source-patcher.ts'),
    server.ssrLoadModule('/lib/html-editor/editor-constants.ts'),
    server.ssrLoadModule('/lib/html-editor/native-components.ts'),
    server.ssrLoadModule('/lib/html-editor/editor-live-dom-helpers.ts'),
    server.ssrLoadModule('/lib/html-editor/membership.ts'),
    server.ssrLoadModule('/lib/html-editor/html-components.ts'),
    server.ssrLoadModule('/lib/html-editor/code-components.ts'),
    server.ssrLoadModule('/lib/html-editor/class-selector.ts'),
    server.ssrLoadModule('/lib/html-editor/css-patcher.ts'),
  ]);
  const prepare = patcher.ensureInsertedElementClasses;
  const fixtures = [
    ...Object.entries(constants.ELEMENT_MARKUP),
    ...Object.entries(constants.NATIVE_OVERLAY_BUILDERS).map(([key, builder]) => [key, builder({ id: `test-${key}` })]),
    ['localized-selector', native.buildNativeLocaleSelectorMarkup([{ code: 'pt-BR', name: 'Português', enabled: true }], 'pt-BR')],
    ...['text-block', 'image', 'video', 'stack', 'grid', 'masonry', 'frame'].map(key => [
      `drawn-${key}`, liveDom.drawnElementMarkup(key, { width: 320, height: 180 }),
    ]),
    ['membership-gate', membership.createMembershipGateMarkup(membership.createMembershipGate('Test', []))],
    ...Object.entries(constants.MEMBERSHIP_FORM_INSERTS).map(([key, purpose]) => [key, membership.createMembershipFormMarkup(purpose)]),
    ['code-component', codeComponents.codeComponentMarkup({
      id: 'test-instance', componentId: 'test-code', componentVersion: '1.0.0',
      sizing: { widthMode: 'fixed', width: 320, heightMode: 'fixed', height: 180 },
    })],
  ];

  let checkedElements = 0;
  const generated = new Set();
  for (const [key, template] of fixtures) {
    const markup = prepare(template);
    const before = editableElements(template);
    const after = editableElements(markup);
    assert.ok(after.length, `${key}: must contain editable layers`);
    assert.equal(after.length, before.length, `${key}: insertion must preserve the element tree`);
    assert.equal(prepare(markup), markup, `${key}: preparing an already prepared insertion must be a no-op`);
    after.forEach((node, index) => {
      checkedElements += 1;
      const classes = attribute(node, 'class').trim();
      assert.ok(classes, `${key}/${node.tagName}: editable layers must arrive with a class`);
      assert.deepEqual(
        node.attrs.filter(item => item.name !== 'class'),
        before[index].attrs.filter(item => item.name !== 'class'),
        `${key}/${node.tagName}: styles, runtime markers and accessibility must be preserved`,
      );
      const previousClass = attribute(before[index], 'class');
      if (previousClass.trim()) {
        assert.equal(classes, previousClass.trim(), `${key}: authored classes must not change`);
      } else {
        assert.match(classes, /^incode-[A-Za-z0-9_-]+$/, `${key}: generated classes must be valid CSS identifiers`);
        assert.ok(!generated.has(classes), `${key}: separate insertions must not share generated classes`);
        generated.add(classes);
      }
      const context = {
        target: 'rule', cssFilePath: 'styles.css', pseudo: 'base', breakpoint: 'base',
        selector: selectors.classEditingSelector(classes.split(/\s+/), []),
      };
      const baseCss = css.patchCssDeclaration('', context, 'opacity', '0.8', css.DEFAULT_BREAKPOINTS);
      assert.equal(css.readCssRuleDeclarations(baseCss, context, css.DEFAULT_BREAKPOINTS).opacity, '0.8');
      const mobileContext = { ...context, breakpoint: 'mobile', pseudo: 'hover' };
      const responsiveCss = css.patchCssDeclaration(baseCss, mobileContext, 'opacity', '0.5', css.DEFAULT_BREAKPOINTS);
      assert.equal(css.readCssRuleDeclarations(responsiveCss, mobileContext, css.DEFAULT_BREAKPOINTS).opacity, '0.5');
      assert.equal(css.readCssRuleDeclarations(responsiveCss, context, css.DEFAULT_BREAKPOINTS).opacity, '0.8');
    });
  }

  // Inserting before an existing node reuses its old structural path. Classes
  // must remain distinct, and exactly the prepared fragment must be persisted.
  const first = prepare('<button data-label="Button" style="padding: 12px">One</button>');
  const second = prepare('<button data-label="Button" style="padding: 12px">Two</button>');
  const source = patcher.patchInsertElement(html(''), null, first);
  const adjacent = patcher.patchInsertAdjacentElement(source, '0', second, 'before');
  assert.equal(patcher.getElementOuterHtml(adjacent.source, '0'), second);
  assert.equal(patcher.getElementOuterHtml(adjacent.source, '1'), first);
  assert.notEqual(attribute(editableElements(first)[0], 'class'), attribute(editableElements(second)[0], 'class'));
  const emptyClass = prepare('<section CLASS=" \t "><img src="placeholder.png"/><p class>Text</p></section>');
  assert.ok(editableElements(emptyClass).every(node => attribute(node, 'class').trim()));
  const technical = '<script>const template = "<div>untouched</div>";</script><style>.a { color: red }</style><template><div>Template</div></template><!-- <div>comment</div> -->';
  assert.equal(prepare(technical), technical, 'technical elements, templates and embedded text must remain untouched');
  const authored = '<div class="existing combo"><span class=child>Keep &amp; preserve</span></div>';
  assert.equal(prepare(authored), authored, 'existing markup must be preserved byte-for-byte');
  const nodeMarkup = '<div data-kodety-component-node="root"></div>';
  assert.equal(prepare(nodeMarkup, 'card'), prepare(nodeMarkup, 'card'), 'component node classes must be deterministic');
  assert.notEqual(prepare(nodeMarkup, 'card'), prepare(nodeMarkup, 'other-card'), 'component namespaces must isolate imported node IDs');
  const collision = prepare('<div data-kodety-component-node="root"></div><span class="incode-div-card-root">Keep</span>', 'card');
  assert.equal(attribute(editableElements(collision)[0], 'class'), 'incode-div-card-root-2');
  assert.equal(attribute(editableElements(collision)[1], 'class'), 'incode-div-card-root');

  // Reusable classes belong to persisted masters, not just one rendered
  // instance; matching node identities share their class across variants.
  const component = { id: 'card', variants: [{ id: 'base', filePath: '.incode/card/base.html' }, { id: 'hover', filePath: '.incode/card/hover.html' }] };
  const nested = { id: 'nested', variants: [{ id: 'base', filePath: '.incode/nested/base.html' }] };
  const other = { id: 'other', variants: [{ id: 'base', filePath: '.incode/other/base.html' }] };
  const master = html('<div data-kodety-component-node="root"><h2 data-kodety-component-node="title">Card</h2><div data-kodety-component-id="nested" data-kodety-component-node="nested-root"></div></div>');
  const project = { mainHtmlPath: 'index.html', files: {
    'index.html': { path: 'index.html', text: html('<main>Unchanged page</main>') },
    [component.variants[0].filePath]: { path: component.variants[0].filePath, text: master },
    [component.variants[1].filePath]: { path: component.variants[1].filePath, text: master },
    [nested.variants[0].filePath]: { path: nested.variants[0].filePath, text: html('<div data-kodety-component-node="nested-root">Nested</div>') },
    [other.variants[0].filePath]: { path: other.variants[0].filePath, text: html('<div>Other</div>') },
  } };
  const library = { version: 1, components: [component, nested, other] };
  const prepared = components.ensureHtmlComponentClasses(project, library, ['card']);
  assert.notStrictEqual(prepared, project);
  assert.strictEqual(prepared.files['index.html'], project.files['index.html']);
  assert.strictEqual(prepared.files[other.variants[0].filePath], project.files[other.variants[0].filePath]);
  assert.strictEqual(components.ensureHtmlComponentClasses(prepared, library, ['card']), prepared);
  const baseNodes = patcher.inspectSourceElements(prepared.files[component.variants[0].filePath].text);
  const hoverNodes = patcher.inspectSourceElements(prepared.files[component.variants[1].filePath].text);
  assert.deepEqual(baseNodes.map(node => node.attributes.class), hoverNodes.map(node => node.attributes.class));
  assert.ok(patcher.inspectSourceElements(prepared.files[nested.variants[0].filePath].text).every(node => node.attributes.class));
  assert.equal(project.files[component.variants[0].filePath].text, master, 'preparation must not mutate the previous history snapshot');

  const editor = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
  const insertion = editor.slice(editor.indexOf('const insertElementAt ='), editor.indexOf('const pointInPreview ='));
  assert.match(insertion, /const markup = ensureInsertedElementClasses\(template\)/);
  assert.ok(insertion.indexOf('ensureInsertedElementClasses(template)') < insertion.indexOf('resolvedActiveLocale !=='), 'locale and normal insertions must share preparation');
  assert.match(editor, /const markup = ensureInsertedElementClasses\([\s\S]*?createMembershipGateMarkup/);
  assert.match(editor, /ensureInsertedElementClasses\(codeComponentMarkup\(instance\)\)/);
  assert.match(editor, /ensureHtmlComponentClasses\(current, library, requestedIds\)/);
  assert.match(editor, /selection\?\.classes\.join\(' '\)/, 'a new class at the same path must refresh the editing selector');
  assert.match(editor, /selector: cssContextSelectionPathRef\.current === selection\.path && currentCssContext\.selector\.trim\(\)/, 'first edits must repair an empty or stale CSS context');
  assert.match(
    editor,
    /const needsStableSelector =\s*!useDedicatedElementStyle && \(\s*Boolean\(componentVariantCssScopeId\) \|\|\s*\(!primaryClasses\.length && !hasExplicitElementIdTarget\) \|\|/,
    'classless nodes need a stable target unless the active selector is their verified unique ID',
  );

  console.log(`Designer insertion class tests passed (${fixtures.length} templates, ${checkedElements} editable layers)`);
} finally {
  await server.close();
}
