import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [inspector, cmsBindings, projectEditor] = await Promise.all([
  readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx'), 'utf8'),
  readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsBindings.tsx'), 'utf8'),
  readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8'),
]);

const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const bindingContext = await server.ssrLoadModule('/lib/html-editor/cms-field-binding.ts');
  const plainSelection = { tag: 'p', attributes: {} };
  const staleTypeSelection = { tag: 'p', attributes: { 'data-kodety-bind-type': 'post' } };

  assert.equal(
    bindingContext.cmsFieldBindingContextType(staleTypeSelection, '', ''),
    '',
    'a leftover binding type must not expose CMS controls without a collection, template, or active binding',
  );
  assert.equal(
    bindingContext.canShowCmsFieldBinding({ endpointAvailable: true, contextType: '', activeBinding: '' }),
    false,
    'the WordPress schema endpoint alone must not render the second plus button',
  );
  assert.equal(
    bindingContext.cmsFieldBindingContextType(
      { tag: 'section', attributes: { 'data-kodety-collection': 'projects' } },
      '',
      '',
    ),
    'projects',
    'a collection on the selected element must provide a CMS field context',
  );
  assert.equal(
    bindingContext.cmsFieldBindingContextType(plainSelection, 'articles', 'pages'),
    'articles',
    'the nearest collection must take precedence over the page template context',
  );
  assert.equal(
    bindingContext.cmsFieldBindingContextType(plainSelection, '', 'pages'),
    'pages',
    'a CMS page template must provide a field context without a repeated collection',
  );
  assert.equal(
    bindingContext.canShowCmsFieldBinding({ endpointAvailable: false, contextType: '', activeBinding: 'title' }),
    true,
    'an existing binding must remain reachable for repair or disconnect',
  );
  assert.equal(
    bindingContext.cmsFieldBindingForTarget(
      { tag: 'p', attributes: { 'data-kodety-bind-content': 'content' } },
      'title',
    ),
    '',
    'a content binding must not expose the CMS action beside title',
  );
  assert.equal(bindingContext.isCmsFieldCompatible({ type: 'image' }, 'text'), false);
  assert.equal(bindingContext.isCmsFieldCompatible({ type: 'image' }, 'image'), true);
  assert.equal(bindingContext.shouldRenderCmsFieldBindingControl('', 0), false);
  assert.equal(bindingContext.shouldRenderCmsFieldBindingControl('', 1), true);
  assert.equal(bindingContext.shouldRenderCmsFieldBindingControl('missing-field', 0), true);
} finally {
  await server.close();
}

assert.match(
  projectEditor,
  /cmsAvailable=\{Boolean\(topbarWp\?\.cmsSchemaUrl\)\}[\s\S]*?cmsTemplatePostType=\{currentTemplatePostType\}/,
  'the Inspector must receive the current CMS template independently from endpoint availability',
);
assert.match(
  inspector,
  /cmsFieldBindingContextType\(selection, inheritedCollection\?\.type \|\| '', cmsTemplatePostType\)/,
  'field actions must derive one real data context from the selection, its ancestors, or the current template',
);
assert.deepEqual(
  Array.from(inspector.matchAll(/cmsFieldBindingAction\('(title|content|href|src|alt)', '(text|image|link)'\)/g), match => match[1]).sort(),
  ['alt', 'content', 'href', 'src', 'title'],
  'all five property actions must use the contextual CMS visibility gate',
);
assert.match(
  inspector,
  /label=\{componentVariableLabel\('Title',[\s\S]*?action=\{cmsFieldBindingAction\('title', 'text'\)\}/,
  'the component-variable plus must remain independent from the gated CMS action',
);
assert.doesNotMatch(
  inspector,
  /(?:action=\{|\{)cmsAvailable\s*(?:\?|&&)\s*<HtmlCmsFieldBinding/,
  'the endpoint-only condition must never mount a CMS property action or reserve layout space',
);
assert.match(
  cmsBindings,
  /compatibleFields[\s\S]*?shouldRenderCmsFieldBindingControl\(activeBinding, compatibleFields\.length\)\) return null/,
  'the CMS action itself must stay unmounted until a compatible field exists, while preserving active bindings',
);

console.log('HTML CMS field binding visibility: contextual controls approved.');
