import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => fs.readFileSync(path, 'utf8');
const helperPath = 'lib/html-editor/text-gradient.ts';
const helperSource = read(helperPath);
const adapterSource = read('app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls.tsx');
const typographyControlsSource = read('app/(builder)/kodety/html-editor/ycode-style/TypographyControls.tsx');
const pickerPaths = [
  'app/(builder)/kodety/components/ColorPicker.tsx',
  'app/(builder)/kodety/html-editor/ycode-style/ColorPicker.tsx',
];

const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
  fileName: helperPath,
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: helperPath });
const {
  hasTextGradientRecipe,
  readTextPaintValue,
  textPaintDeclarationChanges,
} = module.exports;

const gradient = 'linear-gradient(135deg, rgba(255,0,0,.5) 0%, #000 100%)';
const recipe = {
  'background-image': gradient,
  'background-clip': 'text',
  '-webkit-background-clip': 'text',
  color: 'transparent',
  '-webkit-text-fill-color': 'transparent',
};

assert.equal(hasTextGradientRecipe(recipe), true, 'complete text-gradient recipe must be detected');
assert.equal(readTextPaintValue(recipe), gradient, 'Inspector picker must read the gradient, not transparent');
assert.equal(
  readTextPaintValue({ color: 'radial-gradient(circle,#fff 0%,#000 100%)' }),
  'radial-gradient(circle,#fff 0%,#000 100%)',
  'legacy invalid color gradients must remain recoverable for migration',
);

assert.deepEqual(
  Array.from(textPaintDeclarationChanges(gradient, {}), change => ({ ...change })),
  [
    { property: 'background-image', value: gradient },
    { property: 'background-clip', value: 'text' },
    { property: '-webkit-background-clip', value: 'text' },
    { property: 'color', value: 'transparent' },
    { property: '-webkit-text-fill-color', value: 'transparent' },
  ],
  'gradient selection must emit valid cross-browser text paint CSS',
);

assert.deepEqual(
  Array.from(textPaintDeclarationChanges('#123456', recipe), change => ({ ...change })),
  [
    { property: 'color', value: '#123456' },
    { property: 'background-image', value: '' },
    { property: 'background-clip', value: '' },
    { property: '-webkit-background-clip', value: '' },
    { property: '-webkit-text-fill-color', value: '' },
  ],
  'switching to a solid colour must remove only the text-gradient recipe',
);

assert.deepEqual(
  Array.from(textPaintDeclarationChanges('#abcdef', {
    color: '#111111',
    'background-image': 'url(hero.webp)',
    'background-clip': 'padding-box',
  }), change => ({ ...change })),
  [{ property: 'color', value: '#abcdef' }],
  'solid text edits must preserve unrelated authored backgrounds',
);

assert.match(adapterSource, /color:\s*readTextPaintValue\(values\)/);
assert.match(
  adapterSource,
  /category === "typography" && property === "color"[\s\S]*?textPaintDeclarationChanges\([\s\S]*?values,[\s\S]*?forEach\(change => onChange\(change\.property, change\.value\)\)/,
  'the HTML adapter must write the complete recipe through the active CSS scope',
);
assert.match(
  typographyControlsSource,
  /<ColorPropertyField[\s\S]*?solidOnly=\{isIcon\}[\s\S]*?value=\{color\}/,
  'an SVG icon Fill control must stay solid so currentColor never receives a text-gradient recipe',
);

for (const pickerPath of pickerPaths) {
  const picker = read(pickerPath);
  assert.match(picker, /function generateGradientPreviewCSS\(/);
  assert.match(picker, /type === 'radial'[\s\S]*?radial-gradient\(circle,[\s\S]*?linear-gradient\(\$\{angle\}deg/);
  assert.match(picker, /data-gradient-preview=\{type\}[\s\S]*?role="img"[\s\S]*?aria-labelledby=\{labelledBy\}/);
  assert.equal(
    (picker.match(/<GradientPreview/g) || []).length,
    2,
    `${pickerPath}: linear and radial modes need a full-size preview`,
  );
  assert.equal(
    (picker.match(/aria-label="Remover ponto do gradiente"/g) || []).length,
    2,
    `${pickerPath}: both gradient modes need an accessible remove button`,
  );
  assert.equal(
    (picker.match(/<Icon name="trash" \/>/g) || []).length,
    2,
    `${pickerPath}: gradient stop removal must use the trash icon instead of the close icon`,
  );
  assert.equal(
    (picker.match(/disabled=\{!selectedStopId \|\| (?:linear|radial)Stops\.length <= 2\}/g) || []).length,
    2,
    `${pickerPath}: remove buttons must preserve the final two stops`,
  );
  assert.match(
    picker,
    /const stops = activeTab === 'linear' \? linearStops : radialStops;\s*if \(stops\.length <= 2\) return;/,
    `${pickerPath}: Delete/Backspace must not consume input at the two-stop minimum`,
  );
}

console.log('HTML text gradients: recipe, solid restoration, previews and stop deletion passed.');
