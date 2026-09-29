import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, 'Wordpress/kodety/languages/admin-ui');
const aliases = JSON.parse(await readFile(path.join(directory, 'aliases.json'), 'utf8'));
const styles = await readFile(path.join(root, 'app/globals.css'), 'utf8');
const inspectorStylesStart = styles.indexOf('/* Inspector navigation');
const inspectorStylesEnd = styles.lastIndexOf('[data-slot="tabs-list"]', styles.indexOf(':hover:not(:disabled)', inspectorStylesStart));
assert.ok(inspectorStylesStart >= 0 && inspectorStylesEnd > inspectorStylesStart);
const inspectorStyles = styles.slice(inspectorStylesStart, inspectorStylesEnd);
const font = (await readFile(path.join(root, 'Wordpress/kodety/admin/fonts/inter-latin-variable.woff2'))).toString('base64');
// Source contracts bind the DOM regression to real Inspector and portal boundaries.
const editorPath = 'app/(builder)/kodety/html-editor';
const settingsSource = await readFile(path.join(root, editorPath, 'components/HtmlProjectSettings.tsx'), 'utf8');
assert.match(settingsSource, /eyebrow="Site Settings"\s+eyebrowDetail=\{projectName\}/, 'the Site Settings breadcrumb must separate interface copy from the project name');
assert.match(settingsSource, /data-kodety-no-i18n>\{eyebrowDetail\}/, 'the project breadcrumb must protect authored names');
const visualQaSources = ['Editing', 'Justify', 'Wrap', 'Sizing', 'Geral', 'Redirects', 'Cookie Consent', 'Data de publicação', 'Texto alternativo da imagem', 'Atualizado'];
const compactSources = JSON.parse(await readFile(path.join(root, 'scripts/fixtures/admin-i18n-compact-sources.json'), 'utf8'));
const visualQaCases = visualQaSources.map(source => {
  const entry = compactSources.find(entry => entry.source === source);
  assert.ok(entry, `the final visual QA finding needs an explicit source fixture: ${source}`);
  return entry;
});
for (const file of [
  'components/HtmlInspector.tsx', 'components/HtmlPageTransitionsPanel.tsx',
  'ycode-style/WordPressBackgroundMediaDialog.tsx',
  ...['select', 'popover', 'dropdown-menu', 'context-menu', 'dialog', 'tooltip'].map(name => `ycode-style/ui/${name}.tsx`),
]) {
  const source = await readFile(path.join(root, editorPath, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0, `${file} must parse`);
  let roots = 0;
  const inspect = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const names = attributes.map(attribute => attribute.name.getText(ast));
      if (names.includes('data-kodety-i18n-root') || ['TabsList', 'TabsContent'].includes(node.tagName.getText(ast))) {
        roots++;
        assert.ok(!names.includes('data-kodety-no-i18n'), `${file}: UI container cannot opt out`);
        assert.ok(!attributes.some(attribute => attribute.name.getText(ast) === 'translate' && attribute.initializer?.getText(ast).match(/['"]no['"]/)), `${file}: UI container cannot disable translation`);
        assert.doesNotMatch(node.getText(ast), /\bnotranslate\b/, `${file}: UI container cannot inherit legacy suppression`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  assert.ok(roots > 0, `${file}: portaled/native UI needs an explicit translation root`);
}
for (const [file, authored] of [
  ['components/HtmlInspector.tsx', /data-kodety-no-i18n[^>]*>\{selection.tag\}/],
  ['components/HtmlClassSelector.tsx', /data-kodety-no-i18n[^>]*>\{name\}/],
  ['components/HtmlPageTransitionsPanel.tsx', /data-kodety-no-i18n[^>]*>\{page.label\}/],
  ['ycode-style/ColorPicker.tsx', /data-kodety-no-i18n[^>]*>\{variable.name\}/],
  ['ycode-style/FontPicker.tsx', /data-kodety-no-i18n[^>]*title=\{gFont.family\}/],
  ['components/HtmlSettingsControls.tsx', /data-kodety-no-i18n=\{option.authoredLabel \? true : undefined\}/],
]) {
  assert.match(await readFile(path.join(root, editorPath, file), 'utf8'), authored, `${file}: authored values stay literal`);
}
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['en', 'pt-BR']) {
    const catalog = JSON.parse(await readFile(path.join(directory, `${locale}.json`), 'utf8'));
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <main data-kodety-i18n-root>
        <button id="action" title="Create CMS item">Create CMS item</button>
        <p id="feedback">Conflito de revisão: a localização mudou para rev-3. Leia o catálogo novamente.</p>
        <textarea id="draft" placeholder="Create CMS item" aria-label="Create CMS item">Settings</textarea>
        <input id="name" value="Settings" placeholder="Create CMS item">
        <div data-kodety-no-i18n><strong id="authored">Settings</strong></div>
        <div contenteditable="true"><span id="editable">Settings</span></div>
        <pre><code><span id="snippet">Settings</span></code></pre>
        <svg><text id="svg-copy">Settings</text></svg>
        <div id="shadow-host"></div>
        <p id="project-breadcrumb"><span>Site Settings</span> · <span id="breadcrumb-project" data-kodety-no-i18n>Geral · Settings</span></p>
        <p id="class-editing" title="Editing .hero">Editing <span data-kodety-no-i18n>.hero</span></p>
        <div id="visual-qa">${visualQaCases.map(({ source }, index) => `<span id="visual-qa-${index}">${source}</span>`).join('')}</div>
        <aside data-ycode-html-inspector data-kodety-i18n-root>
          <div role="tablist" data-slot="tabs-list" class="kodety-editor-inspector-tabs"><button id="style" data-slot="tabs-trigger" data-value="design">Style</button><button id="settings" data-slot="tabs-trigger" data-value="settings">Settings</button><button id="interactions" data-slot="tabs-trigger" data-value="interactions">Interactions</button></div>
          <span id="class-name" data-kodety-no-i18n>Style</span><span id="element-id" data-kodety-no-i18n>#hero</span>
        </aside>
      </main>
      <div data-ycode-native-ui data-kodety-i18n-root><button id="portal-action" data-value="save">Save</button><span id="font-name" data-kodety-no-i18n>Settings</span><span id="variable-name" data-kodety-no-i18n>Style</span></div>
    </body></html>`);
    await page.addStyleTag({ content: `@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}); font-weight: 100 900; } * { box-sizing: border-box; } body, button { font-family: Inter, sans-serif; } aside { width: 248px; } ${inspectorStyles}` });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(({ catalog, aliases }) => {
      window.kodetyAdminI18n = { ...catalog, aliases, scope: 'document', attributes: ['title', 'placeholder', 'aria-label', 'value'] };
      const shadow = document.querySelector('#shadow-host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button>Create CMS item</button><div data-kodety-no-i18n><span>Settings</span></div><pre><span>Settings</span></pre>';
    }, { catalog, aliases });
    await page.addScriptTag({ path: path.join(root, 'Wordpress/kodety/admin/i18n.js') });
    const action = locale === 'en' ? 'Create CMS item' : 'Criar item CMS';
    assert.equal(await page.locator('#action').textContent(), action);
    assert.equal(await page.locator('#action').getAttribute('title'), action);
    assert.equal(await page.locator('#draft').getAttribute('placeholder'), action);
    assert.equal(await page.locator('#draft').getAttribute('aria-label'), action);
    assert.equal(await page.locator('#draft').inputValue(), 'Settings');
    assert.equal(await page.locator('#name').inputValue(), 'Settings');
    for (const [index, entry] of visualQaCases.entries()) assert.equal(await page.locator(`#visual-qa-${index}`).textContent(), locale === 'en' ? entry.en : entry.pt, `final visual QA: ${entry.source}`);
    assert.equal(await page.locator('#project-breadcrumb').textContent(), locale === 'en' ? 'Site Settings · Geral · Settings' : 'Ajustes gerais · Geral · Settings');
    assert.equal(await page.locator('#breadcrumb-project').textContent(), 'Geral · Settings');
    assert.equal(await page.locator('#class-editing').textContent(), locale === 'en' ? 'Editing .hero' : 'Editando .hero');
    assert.equal(await page.locator('#class-editing').getAttribute('title'), locale === 'en' ? 'Editing .hero' : 'Editando .hero');
    assert.deepEqual(await page.locator('[role="tablist"] button').allTextContents(), locale === 'en' ? ['Style', 'Settings', 'Interactions'] : ['Estilo', 'Ajustes', 'Interações']);
    const tabFit = await page.evaluate(() => {
      const tabs = document.querySelector('[role="tablist"]');
      const last = tabs.lastElementChild;
      return { width: tabs.getBoundingClientRect().width, contentWidth: last.getBoundingClientRect().right - tabs.getBoundingClientRect().left + 12 };
    });
    assert.ok(tabFit.contentWidth <= tabFit.width, `${locale} Inspector tabs overflow at 248px: ${JSON.stringify(tabFit)}`);
    console.log(`${locale} Inspector tabs: ${tabFit.contentWidth.toFixed(1)}px in ${tabFit.width}px with production CSS and Inter 11px/500.`);
    assert.equal(await page.locator('#portal-action').textContent(), locale === 'en' ? 'Save' : 'Salvar');
    assert.equal(await page.locator('#style').getAttribute('data-value'), 'design');
    assert.equal(await page.locator('#portal-action').getAttribute('data-value'), 'save');
    for (const [id, value] of Object.entries({ 'class-name': 'Style', 'element-id': '#hero', 'font-name': 'Settings', 'variable-name': 'Style' })) assert.equal(await page.locator(`#${id}`).textContent(), value);
    for (const id of ['authored', 'editable', 'snippet', 'svg-copy']) assert.equal(await page.locator(`#${id}`).textContent(), 'Settings');
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('#shadow-host').shadowRoot.querySelectorAll('button, span')].map(node => node.textContent)), [action, 'Settings', 'Settings']);
    const conflict = locale === 'en'
      ? 'Revision conflict: localization changed to rev-3. Read the catalog again.'
      : 'Conflito de revisão: a localização mudou para rev-3. Leia o catálogo novamente.';
    assert.equal(await page.locator('#feedback').textContent(), conflict);
    await page.evaluate(() => {
      document.querySelector('#action').textContent = 'Carregando idiomas';
      document.querySelector('#draft').setAttribute('placeholder', 'Carregando idiomas');
      const added = document.createElement('p');
      added.id = 'added';
      added.textContent = 'Create CMS item';
      document.querySelector('main').append(added);
    });
    const loading = locale === 'en' ? 'Loading languages' : 'Carregando idiomas';
    await page.waitForFunction(expected => document.querySelector('#action').textContent === expected, loading);
    assert.equal(await page.locator('#draft').getAttribute('placeholder'), loading);
    assert.equal(await page.locator('#added').textContent(), action);
    assert.equal(await page.evaluate(() => window.kodetyFormatMessage('onboarding.step_counter', { current: '{total}', total: '$&' })), locale === 'en' ? '{total} of $&' : '{total} de $&');
    await page.close();
  }
  console.log('Admin i18n DOM: EN/PT Inspector, native portals, shadow roots, dynamic copy, attributes and authored content verified.');
} finally {
  await browser.close();
}
