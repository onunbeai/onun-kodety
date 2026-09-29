import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import ts from 'typescript';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const server = await createServer({ root, configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
try {
  const css = await server.ssrLoadModule('/lib/html-editor/css-patcher.ts');
  const breakpoints = [
    { id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 },
    { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 480 },
  ];
  const context = { target: 'rule', selector: '.card', cssFilePath: 'styles.css', pseudo: 'base', breakpoint: 'base' };
  const options = width => ({ authoritative: true, viewportWidth: width, editActiveWinner: true });
  const toggle = (text, visible, display = 'grid', ctx = context, width = 1440) =>
    css.patchCssDisplayVisibility(text, ctx, visible, display, breakpoints, options(width)).source;
  const owner = (text, width = 1440, ctx = context) => css.inspectCssRuleAtViewport(text, ctx, 'display', width, breakpoints).propertyOwner;
  const state = (text, ctx = context, width = 1440) => css.readCssDisplayRestoreState(text, ctx, breakpoints, width);
  const canonical = text => {
    const rules = [];
    postcss.parse(text).walkRules(rule => rules.push({ selector: rule.selector, parents: rule.parent.type === 'atrule' ? rule.parent.params : '', declarations: rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value, Boolean(n.important)]) }));
    return rules;
  };
  for (const display of ['grid', 'inline-grid', 'flex', 'inline-flex', 'contents', 'var(--Display, grid)']) {
    for (const priority of ['', '!important']) {
      const initial = `@layer unused; .card{--Display:grid;display:${display}${priority};flex-direction:column-reverse;grid-template-columns:1fr 2fr;gap:31px} .other{display:flex}`;
      const hidden = toggle(initial, false);
      assert.equal(owner(hidden).value, 'none');
      assert.equal(owner(hidden).important, Boolean(priority));
      assert.equal(state(hidden).previousValue, display);
      assert.equal(state(hidden).previousImportant, Boolean(priority));
      // Only serialized project source survives the simulated save/reopen.
      const reopened = JSON.parse(JSON.stringify({ files: { 'styles.css': { text: hidden } } })).files['styles.css'].text;
      const shown = toggle(reopened, true, 'block');
      assert.deepEqual(canonical(shown), canonical(initial), `${display}${priority} restores the exact authored layout`);
      assert.match(shown, /@layer unused;/, 'unrelated empty layer ordering statements survive');
      assert.doesNotMatch(shown, /kodety-display-restore|visibility:/);
      assert.equal(toggle(hidden, false), hidden, 'repeated Hide creates no history-producing source change');
    }
  }
  const grouped = '.shell .card,.sibling{display:grid!important;gap:31px} .card{display:flex}';
  const scoped = { ...context, selector: '.shell .card' };
  const hiddenGroup = toggle(grouped, false, 'grid', scoped);
  assert.equal(owner(hiddenGroup, 1440, scoped).value, 'none');
  assert.equal(owner(hiddenGroup, 1440, { ...context, selector: '.sibling' }).value, 'grid');
  assert.equal(owner(hiddenGroup).value, 'flex');
  const shownGroup = toggle(hiddenGroup, true, 'block', scoped);
  assert.equal(owner(shownGroup, 1440, scoped).value, 'grid');
  assert.equal(owner(shownGroup, 1440, scoped).important, true);

  const tablet = { ...context, breakpoint: 'tablet' };
  const mobile = { ...context, breakpoint: 'mobile' };
  for (const priority of ['', '!important']) {
    const initial = `.card{--Display:grid;display:var(--Display, grid)${priority};flex-direction:column}@media(max-width:810px){.card{gap:20px}}`;
    const hiddenTablet = toggle(initial, false, 'grid', tablet, 810);
    assert.equal(owner(hiddenTablet, 1000).value, 'var(--Display, grid)', 'Tablet Hide preserves Primary');
    assert.equal(owner(hiddenTablet, 1000).important, Boolean(priority), 'Tablet Hide must not weaken inherited priority');
    assert.equal(owner(hiddenTablet, 810, tablet).value, 'none');
    assert.equal(state(hiddenTablet, tablet, 810).previousValue, null, 'snapshot records absent exact-tier declaration');
    const reopened = JSON.parse(JSON.stringify(hiddenTablet));
    const mobileShown = toggle(reopened, true, 'block', mobile, 480);
    assert.equal(owner(mobileShown, 810, tablet).value, 'none', 'Mobile Show must never restore the inherited Tablet snapshot');
    assert.equal(owner(mobileShown, 810, tablet).important, Boolean(priority));
    assert.equal(state(mobileShown, tablet, 810).previousValue, null, 'Tablet snapshot remains available');
    assert.equal(owner(mobileShown, 480, mobile).value, 'var(--Display, grid)', 'a child Show also keeps bindings inherited before the parent was hidden');
    assert.equal(owner(mobileShown, 480, mobile).important, Boolean(priority));
    const shownTablet = toggle(reopened, true, 'block', tablet, 810);
    assert.deepEqual(canonical(shownTablet), canonical(initial), 'Show on the original tier removes only its temporary override');
  }
  const ownTablet = '.card{display:block}@media(max-width:810px){.card{display:var(--Display, grid)!important;--Display:grid}}';
  const ownTabletHidden = toggle(ownTablet, false, 'grid', tablet, 810);
  const ownMobileShown = toggle(ownTabletHidden, true, 'block', mobile, 480);
  assert.equal(owner(ownMobileShown, 480, mobile).value, 'var(--Display, grid)', 'child Show retains the inherited authored variable binding');
  assert.equal(owner(ownMobileShown, 810, tablet).value, 'none');
  assert.deepEqual(canonical(toggle(ownTabletHidden, true, 'block', tablet, 810)), canonical(ownTablet));

  const hidden = toggle('.card{display:grid;gap:31px}', false);
  const manuallyEdited = hidden.replace(/display:\s*none/, 'display:flex');
  assert.equal(state(manuallyEdited), null);
  assert.equal(owner(toggle(manuallyEdited, true)).value, 'flex', 'manual display wins over stale restoration');
  assert.doesNotMatch(toggle(manuallyEdited, true), /kodety-display-restore/);
  const manuallyReprioritized = hidden.replace(/display:\s*none/, 'display:none!important');
  assert.equal(state(manuallyReprioritized), null, 'manual priority changes invalidate the snapshot');
  assert.equal(owner(toggle(manuallyReprioritized, true, 'inline-block')).value, 'inline-block');
  assert.equal(owner(toggle(manuallyReprioritized, true, 'inline-block')).important, true);
  assert.doesNotMatch(toggle(manuallyReprioritized, true, 'inline-block'), /kodety-display-restore/);
  assert.equal(owner(toggle('.card{display:none}', true, 'grid')).value, 'grid', 'imported hidden code without a snapshot uses a safe layout fallback');
  assert.equal(owner(toggle('.card{display:none}', true, 'none')).value, 'block');
  assert.equal(toggle('.card{display:flex}', true), '.card{display:flex}', 'Show on visible code is a no-op');
  for (const value of ['var(--Display)', 'var(--Missing, none)', 'inherit']) {
    const initial = `.parent{display:none}:root{--Display:none}.card,.other{display:${value}!important;gap:31px}`;
    const showOptions = { ...options(1440), computedDisplay: 'none' };
    assert.equal(css.patchCssDisplayVisibility(initial, context, false, 'grid', breakpoints, showOptions).source, initial, 'No on an already hidden binding is idempotent and creates no invalid snapshot');
    const shown = css.patchCssDisplayVisibility(initial, context, true, 'grid', breakpoints, showOptions).source;
    assert.equal(owner(shown).value, 'grid', `Show overrides a computed-hidden ${value} locally`);
    assert.equal(owner(shown).important, true);
    assert.equal(owner(shown, 1440, { ...context, selector: '.other' }).value, value);
    assert.equal(css.readCssRuleDeclarations(shown, { ...context, selector: ':root' })['--Display'], 'none', 'Show never changes the shared variable');
    assert.equal(owner(shown, 1440, { ...context, selector: '.parent' }).value, 'none', 'Show never changes the inherited parent');
    const reopened = JSON.parse(JSON.stringify(shown));
    assert.deepEqual(canonical(toggle(toggle(reopened, false), true)), canonical(shown), 'subsequent No/Yes restores the explicitly chosen display after reopen');
  }
  const visibleBinding = ':root{--Display:grid}.card{display:var(--Display)}';
  assert.equal(css.patchCssDisplayVisibility(visibleBinding, context, true, 'block', breakpoints, { ...options(1440), computedDisplay: 'grid' }).source, visibleBinding, 'clicking Yes on a visible binding must preserve the binding');
  const inheritedHiddenBinding = ':root{--Display:none}.card{display:grid}@media(max-width:810px){.card,.other{display:var(--Display)!important}}';
  const visibleMobileBinding = css.patchCssDisplayVisibility(inheritedHiddenBinding, mobile, true, 'inline-flex', breakpoints, { ...options(480), computedDisplay: 'none' }).source;
  assert.equal(owner(visibleMobileBinding, 480, mobile).value, 'inline-flex');
  assert.equal(owner(visibleMobileBinding, 480, mobile).important, true);
  assert.equal(owner(visibleMobileBinding, 810, tablet).value, 'var(--Display)');
  assert.equal(owner(visibleMobileBinding, 810, tablet).important, true);

  const hover = { ...context, pseudo: 'hover' };
  const initialHover = '.card{display:grid}.card:hover{display:flex!important}';
  const hiddenHover = toggle(initialHover, false, 'flex', hover);
  assert.equal(owner(hiddenHover).value, 'grid');
  assert.equal(owner(hiddenHover, 1440, hover).value, 'none');
  assert.deepEqual(canonical(toggle(hiddenHover, true, 'block', hover)), canonical(initialHover));
  assert.equal(typeof globalThis.document, 'undefined', 'all source restoration works without DOM/CSSOM');
  // Execute the actual parent callback to cover the shared Inspector/Layers
  // command, history boundary and optimistic snapshot independently of CSS.
  const editor = await readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
  const start = editor.indexOf('  const updateVisibility = (visible: boolean) => {');
  const end = editor.indexOf('  const updateLayerVisibility =', start);
  assert.ok(start >= 0 && end > start);
  const callback = ts.transpileModule(editor.slice(start, end) + '\nreturn updateVisibility;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let callbackSource = '.card{--Display:grid;display:var(--Display, grid)!important;flex-direction:column-reverse}';
  const originalCallbackSource = callbackSource;
  let selection = { path: '0', tag: 'div', attributes: {}, computedStyle: { display: 'grid' } };
  const history = [], commands = [], optimistic = [];
  const lastVisualStyleEditRef = { current: { key: 'previous-gap-gesture' } };
  const buildCallback = () => {
    const env = {
      selection, selectedPaths: ['0'], cssContextRef: { current: context }, viewportRef: { current: 'base' },
      cssRuleStyles: css.readCssRuleDeclarations(callbackSource, context), baseBreakpointRuleStyles: {},
      stripImportantPriority: value => value.replace(/\s*!important\s*$/i, ''), parseStyleDeclarations: () => ({}),
      canvasVisibilityRestoreDisplayRef: { current: new Map() }, projectRevisionRef: { current: history.length },
      optimisticallySetCanvasLayerVisibility: (paths, visible) => optimistic.push({ paths, visible }),
      canvasAuthoredStylesRef: { current: new Map() }, canvasSelectionRevisionFloorRef: { current: new Map() },
      setSelection: change => { selection = change(selection); },
      membershipPreviewLayer: 'base', resolvedActiveLocale: 'en', localization: { sourceLocale: 'en' },
      displayRestoreState: state(callbackSource), lastVisualStyleEditRef,
      updateStyle: (property, value, editOptions) => {
        assert.equal(lastVisualStyleEditRef.current, null, 'each visibility command starts its own history entry');
        assert.equal(property, 'display');
        commands.push({ property, value, editOptions });
        const changed = css.patchCssDisplayVisibility(callbackSource, context, editOptions.visibility.visible, editOptions.visibility.fallbackDisplay, breakpoints, { ...options(1440), computedDisplay: editOptions.visibility.computedDisplay });
        if (changed.source !== callbackSource) history.push(callbackSource);
        callbackSource = changed.source;
        return changed.display;
      },
    };
    return new Function(...Object.keys(env), callback)(...Object.values(env));
  };
  buildCallback()(false);
  assert.equal(selection.computedStyle.display, 'none');
  assert.equal(owner(callbackSource).value, 'none');
  assert.deepEqual(selection.attributes, {}, 'display visibility never adds hidden/ARIA attributes');
  callbackSource = JSON.parse(JSON.stringify(callbackSource)); // reopen; no volatile restore Map survives
  buildCallback()(true);
  assert.equal(selection.computedStyle.display, 'grid', 'variable restoration projects its known computed display immediately');
  assert.deepEqual(canonical(callbackSource), canonical(originalCallbackSource));
  assert.equal(commands[1].editOptions.visibility.fallbackDisplay, 'grid');
  assert.equal(history.length, 2);
  const shown = callbackSource;
  callbackSource = history.pop();
  assert.equal(owner(callbackSource).value, 'none', 'Undo Show returns to hidden source');
  callbackSource = shown;
  assert.equal(owner(callbackSource).value, 'var(--Display, grid)', 'Redo Show retains the binding');
  assert.deepEqual(optimistic, [{ paths: ['0'], visible: false }, { paths: ['0'], visible: true }]);
  callbackSource = ':root{--Display:none}.card{display:var(--Display);grid-template-columns:1fr 2fr}';
  selection = { path: '0', tag: 'div', attributes: {}, computedStyle: { display: 'none' } };
  buildCallback()(true);
  assert.equal(owner(callbackSource).value, 'grid', 'the actual Inspector/Eye callback forwards the target computed display');
  assert.equal(selection.computedStyle.display, 'grid');
  const effectStart = editor.indexOf('    const pending = pendingResponsiveLayerVisibilityRef.current;');
  const effectEnd = editor.indexOf('    // Identity arrives before computed layout.', effectStart);
  const flagStart = editor.indexOf('          const pendingVisibility = pendingResponsiveLayerVisibilityRef.current;');
  const flagEnd = editor.indexOf('          startTransition(', flagStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart && flagStart >= 0 && flagEnd > flagStart);
  const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const effect = new Function('pendingResponsiveLayerVisibilityRef', 'selection', 'updateVisibility', compile(editor.slice(effectStart, effectEnd)));
  const acceptComputed = new Function('pendingResponsiveLayerVisibilityRef', 'resolvedPrimary', compile(editor.slice(flagStart, flagEnd)));
  const pending = { current: { path: 'B', visible: false } };
  const eyeCommands = [];
  const runEffect = selected => effect(pending, selected, visible => eyeCommands.push({ visible, display: selected.computedStyle.display }));
  runEffect({ path: 'A', computedStyle: { display: 'grid' } });
  runEffect({ path: 'B', computedStyle: { display: 'grid' } }); // identity carrying an old provisional layout
  assert.equal(eyeCommands.length, 0);
  acceptComputed(pending, { path: 'A', computedStyle: { display: 'grid' } });
  runEffect({ path: 'B', computedStyle: { display: 'grid' } });
  assert.equal(eyeCommands.length, 0, 'another selection cannot authorize the pending eye command');
  acceptComputed(pending, { path: 'B', computedStyle: {} });
  runEffect({ path: 'B', computedStyle: {} });
  assert.equal(eyeCommands.length, 0, 'computed messages must include the target display');
  acceptComputed(pending, { path: 'B', computedStyle: { display: 'inline-flex' } });
  runEffect({ path: 'A', computedStyle: { display: 'grid' } });
  assert.equal(eyeCommands.length, 0);
  runEffect({ path: 'B', computedStyle: { display: 'inline-flex' } });
  runEffect({ path: 'B', computedStyle: { display: 'inline-flex' } });
  acceptComputed(pending, { path: 'B', computedStyle: { display: 'inline-flex' } });
  assert.deepEqual(eyeCommands, [{ visible: false, display: 'inline-flex' }], 'unselected Layers eye waits for its own computed display and commits exactly once');
  assert.equal(pending.current, null);
  console.log('Display visibility source restoration passed: exact values, priority, variables, scoped groups, breakpoints, reopen and manual edits.');
} finally { await server.close(); }
