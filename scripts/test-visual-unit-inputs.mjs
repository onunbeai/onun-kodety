import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const relativePaths = {
  htmlTransition: 'app/(builder)/kodety/html-editor/ycode-style/TransitionControls.tsx',
  nextTransition: 'app/(builder)/kodety/components/TransitionControls.tsx',
  htmlTransform: 'app/(builder)/kodety/html-editor/ycode-style/TransformControls.tsx',
  nextTransform: 'app/(builder)/kodety/components/TransformControls.tsx',
  htmlAdapter: 'app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls.tsx',
  visualField: 'app/(builder)/kodety/components/VisualStyleField.tsx',
  htmlTypography: 'app/(builder)/kodety/html-editor/ycode-style/TypographyControls.tsx',
  nextTypography: 'app/(builder)/kodety/components/TypographyControls.tsx',
  letterSpacingUnits: 'lib/letter-spacing-units.ts',
};
const sources = Object.fromEntries(await Promise.all(
  Object.entries(relativePaths).map(async ([key, relativePath]) => [
    key,
    await readFile(path.join(root, relativePath), 'utf8'),
  ]),
));

for (const key of ['htmlTransition', 'nextTransition']) {
  assert.match(
    sources[key],
    /useControlledInputs\(\{ duration, delay \}, extractMillisecondsValue\)/,
    `${relativePaths[key]} must keep persisted CSS units outside the editable timing draft`,
  );
  assert.match(
    sources[key],
    /(?:suffix="ms"|<InputGroupAddon[\s\S]*?>ms<\/InputGroupAddon>)/,
    `${relativePaths[key]} must render milliseconds outside the editable value`,
  );
}

for (const key of ['htmlTransform', 'nextTransform']) {
  assert.match(
    sources[key],
    /const angleInputs = useControlledInputs\(\{[\s\S]*?rotate[\s\S]*?skew[XY][\s\S]*?\}, extractDegreesValue\)/,
    `${relativePaths[key]} must strip the persisted degree unit before rendering suffix controls`,
  );
  assert.match(sources[key], /const inputs = \{ \.\.\.measurementInputs, \.\.\.angleInputs \};/);
}

assert.match(
  sources.htmlAdapter,
  /category === "transitions"[\s\S]*?return `\$\{value\}ms`/,
  'the HTML adapter must continue persisting numeric timings as valid CSS milliseconds',
);

for (const key of ['htmlTypography', 'nextTypography']) {
  assert.match(
    sources[key],
    /useControlledInput\(letterSpacing, undefined, false\)/,
    `${relativePaths[key]} must keep advanced CSS letter-spacing drafts intact`,
  );
  assert.match(
    sources[key],
    /convertLetterSpacingUnit[\s\S]*?parseLetterSpacingValue[\s\S]*?serializeLetterSpacingDraft/,
    `${relativePaths[key]} must separate the letter-spacing draft from its selected unit`,
  );
  for (const unit of ['px', 'em', 'rem', '%']) {
    assert.match(
      sources[key],
      new RegExp(`value: '${unit.replace('%', '\\%')}'`),
      `${relativePaths[key]} must expose the ${unit} letter-spacing unit`,
    );
  }
  assert.doesNotMatch(
    sources[key],
    /extractLetterSpacingValue/,
    `${relativePaths[key]} must not echo a persisted unit into the editable draft`,
  );
}

assert.match(
  sources.htmlTypography,
  /min=\{kind === 'letter-spacing' \? undefined : 0\}/,
  'negative letter spacing must remain available in the HTML inspector',
);
assert.doesNotMatch(
  sources.nextTypography,
  /<LetterSpacingControl(?:(?!\/>).)*\bmin="0"/s,
  'negative letter spacing must remain available in the legacy inspector',
);
assert.match(
  sources.htmlAdapter,
  /category === "transforms"[\s\S]*?property === "rotate"[\s\S]*?return `\$\{value\}deg`/,
  'the HTML adapter must continue persisting numeric rotations as valid CSS degrees',
);
assert.match(
  sources.visualField,
  /<input[\s\S]*?value=\{value\}[\s\S]*?onChange=\{event => onChange\(event\.target\.value\)\}[\s\S]*?\{suffix && \(/,
  'the visible unit must remain a separate, non-editable suffix rather than entering the draft text',
);

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const {
    extractDegreesValue,
    extractMillisecondsValue,
  } = await server.ssrLoadModule('/lib/measurement-utils.ts');
  const {
    convertLetterSpacingUnit,
    parseLetterSpacingValue,
    serializeLetterSpacingDraft,
  } = await server.ssrLoadModule('/lib/letter-spacing-units.ts');

  assert.equal(extractMillisecondsValue('4ms'), '4');
  assert.equal(extractMillisecondsValue('400ms'), '400');
  assert.equal(extractMillisecondsValue('0.4s'), '400');
  assert.equal(extractMillisecondsValue('.25s'), '250');
  assert.equal(extractMillisecondsValue('200ms, 400ms'), '200ms, 400ms');
  assert.equal(extractMillisecondsValue('var(--duration)'), 'var(--duration)');

  let timingDraft = '';
  for (const digit of ['4', '0', '0']) {
    timingDraft += digit;
    timingDraft = extractMillisecondsValue(`${timingDraft}ms`);
  }
  assert.equal(
    timingDraft,
    '400',
    'an external CSS echo after each keystroke must never turn 400 into 4ms00',
  );

  assert.equal(extractDegreesValue('4deg'), '4');
  assert.equal(extractDegreesValue('-12.5deg'), '-12.5');
  assert.equal(extractDegreesValue('90°'), '90');
  assert.equal(extractDegreesValue('0.5turn'), '0.5turn');
  assert.equal(extractDegreesValue('var(--angle)'), 'var(--angle)');

  let angleDraft = '';
  for (const digit of ['4', '5']) {
    angleDraft += digit;
    angleDraft = extractDegreesValue(`${angleDraft}deg`);
  }
  assert.equal(angleDraft, '45', 'rotation echoes must not produce a duplicated deg/degree suffix');

  assert.deepEqual(parseLetterSpacingValue('-2.0835px'), {
    numeric: '-2.0835',
    number: -2.0835,
    unit: 'px',
  });
  assert.equal(parseLetterSpacingValue('normal').numeric, 'normal');
  assert.equal(parseLetterSpacingValue('var(--tracking)').numeric, 'var(--tracking)');
  assert.equal(parseLetterSpacingValue('calc(1em + 2px)').numeric, 'calc(1em + 2px)');
  assert.equal(parseLetterSpacingValue('clamp(-1px, 0.1em, 4px)').numeric, 'clamp(-1px, 0.1em, 4px)');
  assert.equal(serializeLetterSpacingDraft('0', 'px'), '0');
  assert.equal(serializeLetterSpacingDraft('0.', 'px'), '0.');
  assert.equal(serializeLetterSpacingDraft('-2.5', 'rem'), '-2.5rem');
  assert.equal(serializeLetterSpacingDraft('calc(1em + 2px)', 'px'), 'calc(1em + 2px)');
  assert.equal(convertLetterSpacingUnit('16px', 'em', '16px'), '1em');
  assert.equal(convertLetterSpacingUnit('1em', 'px', '20px'), '20px');
  assert.equal(convertLetterSpacingUnit('normal', 'px', '16px'), 'normal');

  let letterSpacingDraft = '';
  for (const digit of ['4', '0', '0']) {
    letterSpacingDraft += digit;
    const persisted = serializeLetterSpacingDraft(letterSpacingDraft, 'px');
    letterSpacingDraft = parseLetterSpacingValue(persisted).numeric;
  }
  assert.equal(
    letterSpacingDraft,
    '400',
    'a persisted CSS echo after each keystroke must never turn 400 into 4px00',
  );

  console.log('Visual unit-input tests passed.');
} finally {
  await server.close();
}
