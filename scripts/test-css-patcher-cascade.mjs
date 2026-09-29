import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { createServer } from "vite";
import { codeComponentReactRuntimePlugin } from "./vite-code-component-runtime.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

try {
  const [css, styleUtils] = await Promise.all([
    server.ssrLoadModule("/lib/html-editor/css-patcher.ts"),
    server.ssrLoadModule("/lib/html-editor/style-utils.ts"),
  ]);
  for (const [origin, active, expected] of [
    ['.shell .card', '.card', '.shell .card'],
    ['.shell .card, .sibling', '.card', '.shell .card'],
    ['.shell img.card.active', '.card', '.shell img.card.active'],
    ['.shell .base.extra', '.base.extra', '.shell .base.extra'],
    ['.shell .c\\61 rd', '.card', '.shell .c\\61 rd'],
    ['[data-label="a,b"] :is(.shell, .panel) > .card:not(.disabled), .sibling', '.card', '[data-label="a,b"] :is(.shell, .panel) > .card:not(.disabled)'],
    ['.shell/* , ignored */ .card, .sibling', '.card', '.shell/* , ignored */ .card'],
    ['.card img', '.card', null],
    ['img', '.card', null],
    ['.shell :not(.card)', '.card', null],
    ['.shell :is(.card, .other)', '.card', null],
    ['[data-label=".card"]', '.card', null],
    ['.cardinal', '.card', null],
    ['.base', '.base.extra', null],
    ['.shell .card::before', '.card', null],
    ['.shell .card:before', '.card', null],
    ['.card', '[data-bundle="one"] .card', null],
    ['[data-bundle="two"] .card', '[data-bundle="one"] .card', null],
    ['[data-bundle="one"] .card, .sibling', '[data-bundle="one"] .card', '[data-bundle="one"] .card'],
    ['.shell .a, .b', '.a, .b', null],
    ['.a, .b, .sibling', '.a, .b', '.a, .b'],
    ['.shell [data-kodety-style-id="element-000001"]', '[data-kodety-style-id="element-000001"]', '.shell [data-kodety-style-id="element-000001"]'],
    ['.shell [data-kodety-style-id="element-000002"]', '[data-kodety-style-id="element-000001"]', null],
  ]) assert.equal(css.cssAuthoringSelectorFromOrigin(origin, active), expected, `safe authored subject: ${origin} for ${active}`);
  const breakpoints = [
    { id: "notebook", label: "Notebook", mode: "max-width", width: 1200 },
    { id: "tablet", label: "Tablet", mode: "max-width", width: 810 },
    { id: "mobile", label: "Mobile", mode: "max-width", width: 410 },
    { id: "overlap-max", label: "Overlap max", mode: "max-width", width: 900 },
    { id: "overlap-min", label: "Overlap min", mode: "min-width", width: 600 },
  ];
  const base = {
    target: "rule",
    selector: ".card",
    cssFilePath: "styles.css",
    pseudo: "base",
    breakpoint: "base",
  };

  // Inspector reads of one immutable source share a parsed PostCSS snapshot,
  // while every patch must still start from a fresh tree. Besides protecting
  // the optimization contract, the final assertion proves a write cannot
  // mutate the cached read root for the original source.
  const nativePostcssParse = postcss.parse;
  let postcssParseCount = 0;
  postcss.parse = (...args) => {
    postcssParseCount += 1;
    return nativePostcssParse(...args);
  };
  try {
    const sharedReadSource = ".cache-contract-card { opacity: 0.25; color: teal; }";
    const sharedReadContext = { ...base, selector: ".cache-contract-card" };
    assert.equal(
      css.inspectCssRule(sharedReadSource, sharedReadContext, "opacity", breakpoints)
        .propertyOwner?.value,
      "0.25",
    );
    const countAfterFirstRead = postcssParseCount;
    assert.equal(countAfterFirstRead, 1, "the first read must parse its source once");
    assert.equal(
      css.inspectCssRuleDeclarations(sharedReadSource, sharedReadContext, breakpoints)
        .propertyOwners.opacity?.value,
      "0.25",
    );
    assert.equal(
      css.readCssRuleDeclarations(sharedReadSource, sharedReadContext, breakpoints).color,
      "teal",
    );
    assert.equal(
      css.readInheritedCssRuleDeclarations(
        sharedReadSource,
        sharedReadContext,
        1920,
        breakpoints,
      ).opacity,
      "0.25",
    );
    assert.equal(
      postcssParseCount,
      countAfterFirstRead,
      "all read-only projections of the same CSS must reuse one PostCSS root",
    );

    const patchedSharedReadSource = css.patchCssDeclaration(
      sharedReadSource,
      sharedReadContext,
      "opacity",
      "0.8",
      breakpoints,
      { authoritative: true },
    );
    assert.equal(
      postcssParseCount,
      countAfterFirstRead + 1,
      "a write must parse a fresh PostCSS root even when its source is cached for reads",
    );
    assert.equal(
      css.inspectCssRule(sharedReadSource, sharedReadContext, "opacity", breakpoints)
        .propertyOwner?.value,
      "0.25",
      "patching must not mutate the cached read snapshot",
    );
    assert.equal(
      css.inspectCssRule(patchedSharedReadSource, sharedReadContext, "opacity", breakpoints)
        .propertyOwner?.value,
      "0.8",
    );
  } finally {
    postcss.parse = nativePostcssParse;
  }

  const exactClassSource = [
    "/* before */",
    ".button {",
    "  display: inline-flex;",
    "  opacity: 0.4; /* exact declaration */",
    "  color: tomato;",
    "}",
    ".other { opacity: 0.9; }",
  ].join("\n");
  const exactClassPatched = css.patchCssDeclaration(
    exactClassSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.73",
    breakpoints,
    { authoritative: true },
  );
  assert.equal(
    (exactClassPatched.match(/\.button\s*\{/g) || []).length,
    1,
    "editing an existing class must not create a parallel selector",
  );
  assert.match(
    exactClassPatched,
    /\.button\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?opacity:\s*0\.73;\s*\/\* exact declaration \*\/[\s\S]*?color:\s*tomato;/,
    "the winning declaration must be replaced at its original source position",
  );
  assert.match(exactClassPatched, /\.other\s*\{\s*opacity:\s*0\.9;\s*\}/);

  const duplicateClassSource = [
    ".button { opacity: 0.25 !important; color: red; }",
    ".button { opacity: 0.5; color: blue; }",
  ].join("\n");
  const duplicateClassPatched = css.patchCssDeclaration(
    duplicateClassSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.8",
    breakpoints,
    { authoritative: true },
  );
  assert.match(duplicateClassPatched, /\.button\s*\{\s*opacity:\s*0\.8\s*!important;\s*color:\s*red;/);
  assert.match(duplicateClassPatched, /\.button\s*\{\s*opacity:\s*0\.5;\s*color:\s*blue;/);
  assert.equal(
    (duplicateClassPatched.match(/\bopacity\s*:/g) || []).length,
    2,
    "shadowed authored declarations stay in place; only the real winner changes",
  );
  assert.equal(
    css.inspectCssRule(duplicateClassPatched, { ...base, selector: ".button" }, "opacity", breakpoints)
      .propertyOwner?.value,
    "0.8",
  );
  const onePassInspection = css.inspectCssRuleDeclarations(
    duplicateClassPatched,
    { ...base, selector: ".button" },
    breakpoints,
  );
  assert.deepEqual(
    onePassInspection.propertyOwners.opacity,
    css.inspectCssRule(
      duplicateClassPatched,
      { ...base, selector: ".button" },
      "opacity",
      breakpoints,
    ).propertyOwner,
    "the one-parse Inspector path must preserve the exact !important owner",
  );
  assert.deepEqual(
    onePassInspection.propertyOwners.color,
    css.inspectCssRule(
      duplicateClassPatched,
      { ...base, selector: ".button" },
      "color",
      breakpoints,
    ).propertyOwner,
    "the one-parse Inspector path must preserve shadowed declaration ownership",
  );

  const groupedClassPatched = css.patchCssDeclaration(
    ".button, .link { color: red; opacity: 0.4; }",
    { ...base, selector: ".button" },
    "opacity",
    "0.7",
    breakpoints,
    { authoritative: true },
  );
  assert.match(groupedClassPatched, /\.link\s*\{[^}]*opacity:\s*0\.4/);
  assert.match(groupedClassPatched, /\.button\s*\{[^}]*opacity:\s*0\.7/);
  assert.doesNotMatch(groupedClassPatched, /\.button\s*,\s*\.link/);
  assert.equal(
    css.readCssRuleDeclarations(groupedClassPatched, { ...base, selector: ".button" }, breakpoints).opacity,
    "0.7",
  );
  assert.equal(
    css.readCssRuleDeclarations(groupedClassPatched, { ...base, selector: ".link" }, breakpoints).opacity,
    "0.4",
  );

  const inspectorShorthandCases = [
    {
      shorthand: "mask",
      longhand: "mask-image",
      before: "url(old-mask.svg)",
      owner: "url(owner-mask.svg) center / cover no-repeat",
      next: "linear-gradient(black, transparent)",
    },
    { shorthand: "scroll-margin", longhand: "scroll-margin-top", before: "8px", owner: "12px", next: "24px" },
    { shorthand: "scroll-padding", longhand: "scroll-padding-top", before: "8px", owner: "16px", next: "28px" },
    { shorthand: "overscroll-behavior", longhand: "overscroll-behavior-x", before: "auto", owner: "contain", next: "none" },
    { shorthand: "grid-area", longhand: "grid-row", before: "1 / span 1", owner: "2 / 3 / span 2 / span 1", next: "4 / span 2" },
    { shorthand: "border-image", longhand: "border-image-source", before: "url(old-border.svg)", owner: "url(owner-border.svg) 30 / 10px", next: "linear-gradient(red, blue)" },
  ];
  inspectorShorthandCases.forEach(({ shorthand, longhand, before, owner, next }) => {
    const conflicts = styleUtils.conflictingStyleProperties(longhand);
    assert.ok(conflicts.has(shorthand), `${longhand} must recognize ${shorthand} as a cascade owner`);
    const patched = css.patchCssDeclaration(
      `.button { ${longhand}: ${before}; ${shorthand}: ${owner}; color: teal; }`,
      { ...base, selector: ".button" },
      longhand,
      next,
      breakpoints,
      { authoritative: true },
    );
    const ownerIndex = patched.indexOf(`${shorthand}: ${owner}`);
    const insertedIndex = patched.indexOf(`${longhand}: ${next}`, ownerIndex);
    const followingIndex = patched.indexOf("color: teal", ownerIndex);
    assert.ok(ownerIndex >= 0, `${shorthand} owner must remain authored`);
    assert.ok(
      insertedIndex > ownerIndex && insertedIndex < followingIndex,
      `${longhand} must be inserted immediately after the winning ${shorthand}`,
    );
    assert.ok(
      patched.includes(`${longhand}: ${before}`),
      `the shadowed authored ${longhand} declaration must remain intact`,
    );
  });

  const layeredClassPatched = css.patchCssDeclaration(
    [
      "@layer components {",
      "  @supports (display: grid) {",
      "    .button { opacity: 0.45; color: teal; }",
      "  }",
      "}",
    ].join("\n"),
    { ...base, selector: ".button" },
    "opacity",
    "0.65",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    layeredClassPatched,
    /@layer components[\s\S]*?@supports \(display: grid\)[\s\S]*?\.button\s*\{\s*opacity:\s*0\.65;\s*color:\s*teal;/,
    "a class nested in @layer/@supports must be edited at its existing declaration",
  );
  assert.equal((layeredClassPatched.match(/\.button\s*\{/g) || []).length, 1);

  const unlayeredWinnerSource = [
    ".button { opacity: 0.8; color: black; }",
    "@layer widgets { .button { opacity: 0.4; color: teal; } }",
  ].join("\n");
  const unlayeredWinnerPatched = css.patchCssDeclaration(
    unlayeredWinnerSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.65",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    unlayeredWinnerPatched,
    /^\.button\s*\{\s*opacity:\s*0\.65;/,
    "normal unlayered declarations must win over every named layer",
  );
  assert.match(
    unlayeredWinnerPatched,
    /@layer widgets\s*\{\s*\.button\s*\{\s*opacity:\s*0\.4;/,
    "editing the real unlayered winner must leave the shadowed layer intact",
  );
  const unlayeredInspection = css.inspectCssRule(
    unlayeredWinnerSource,
    { ...base, selector: ".button" },
    "opacity",
    breakpoints,
  );
  assert.equal(unlayeredInspection.propertyOwner?.value, "0.8");
  assert.equal(unlayeredInspection.propertyOwner?.cascadeLayer, null);
  assert.deepEqual(unlayeredInspection.cascadeLayers, ["widgets"]);

  const namedLayerSource = [
    "@layer foundation, components;",
    "@layer foundation { .button { opacity: 0.2; } }",
    "@layer components { .button { opacity: 0.4; } }",
  ].join("\n");
  const namedLayerPatched = css.patchCssDeclaration(
    namedLayerSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.68",
    breakpoints,
    { authoritative: true },
  );
  assert.match(namedLayerPatched, /@layer foundation\s*\{[^}]*opacity:\s*0\.2/);
  assert.match(
    namedLayerPatched,
    /@layer components\s*\{\s*\.button\s*\{\s*opacity:\s*0\.68/,
    "later named layers must win for normal declarations",
  );

  const nestedLayerSource = [
    "@layer components {",
    "  @layer narrow, wide;",
    "  .button { opacity: 0.8; }",
    "  @layer narrow { .button { opacity: 0.2; } }",
    "  @layer wide { .button { opacity: 0.4; } }",
    "}",
  ].join("\n");
  const nestedLayerInspection = css.inspectCssRule(
    nestedLayerSource,
    { ...base, selector: ".button" },
    "opacity",
    breakpoints,
  );
  assert.equal(
    nestedLayerInspection.propertyOwner?.value,
    "0.8",
    "declarations directly in a parent layer outrank its nested normal layers",
  );
  assert.equal(nestedLayerInspection.propertyOwner?.cascadeLayer, "components");
  assert.deepEqual(
    nestedLayerInspection.cascadeLayers,
    ["components", "components.narrow", "components.wide"],
  );

  const importantLayerSource = [
    "@layer base, widgets;",
    "@layer base { .button { opacity: 0.2 !important; } }",
    "@layer widgets { .button { opacity: 0.4 !important; } }",
  ].join("\n");
  const importantLayerPatched = css.patchCssDeclaration(
    importantLayerSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.7",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    importantLayerPatched,
    /@layer base\s*\{\s*\.button\s*\{\s*opacity:\s*0\.7\s*!important;/,
    "important declarations must reverse the declared layer order",
  );
  assert.match(
    importantLayerPatched,
    /@layer widgets\s*\{\s*\.button\s*\{\s*opacity:\s*0\.4\s*!important;/,
  );
  const importantLayerInspection = css.inspectCssRule(
    importantLayerSource,
    { ...base, selector: ".button" },
    "opacity",
    breakpoints,
  );
  assert.equal(importantLayerInspection.propertyOwner?.value, "0.2");
  assert.equal(importantLayerInspection.propertyOwner?.cascadeLayer, "base");
  assert.deepEqual(importantLayerInspection.cascadeLayers, ["base", "widgets"]);

  const conditionalLayerOrderSource = [
    "@supports (display: made-up-value) { @layer late { .button { opacity: 0.9 !important; } } }",
    "@layer early { .button { opacity: 0.2 !important; } }",
    "@layer late { .button { opacity: 0.4 !important; } }",
  ].join("\n");
  const conditionalLayerInspection = css.inspectCssRule(
    conditionalLayerOrderSource,
    { ...base, selector: ".button" },
    "opacity",
    breakpoints,
  );
  assert.deepEqual(
    conditionalLayerInspection.cascadeLayers,
    ["early", "late"],
    "layers inside a false global condition must not establish document layer order",
  );
  assert.equal(conditionalLayerInspection.propertyOwner?.value, "0.2");
  const conditionalLayerPatched = css.patchCssDeclaration(
    conditionalLayerOrderSource,
    { ...base, selector: ".button" },
    "opacity",
    "0.72",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    conditionalLayerPatched,
    /@layer early\s*\{\s*\.button\s*\{\s*opacity:\s*0\.72\s*!important;/,
  );

  const inactiveSupportsPatched = css.patchCssDeclaration(
    [
      ".button { opacity: 0.8; }",
      "@supports (display: made-up-value) { .button { opacity: 0.4; } }",
    ].join("\n"),
    { ...base, selector: ".button" },
    "opacity",
    "0.6",
    breakpoints,
    { authoritative: true },
  );
  assert.match(inactiveSupportsPatched, /^\.button\s*\{\s*opacity:\s*0\.6;/);
  assert.match(
    inactiveSupportsPatched,
    /@supports \(display: made-up-value\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.4;/,
    "an inactive or unprovable @supports block cannot own the visual edit",
  );

  const nestedSelectorPatched = css.patchCssDeclaration(
    [
      ".button { opacity: 0.8; }",
      ".wrapper { .button { opacity: 0.4; } }",
    ].join("\n"),
    { ...base, selector: ".button" },
    "opacity",
    "0.6",
    breakpoints,
    { authoritative: true },
  );
  assert.match(nestedSelectorPatched, /^\.button\s*\{\s*opacity:\s*0\.6;/);
  assert.match(
    nestedSelectorPatched,
    /\.wrapper\s*\{\s*\.button\s*\{\s*opacity:\s*0\.4;/,
    "a nested .button represents .wrapper .button and is not the global class rule",
  );

  const nestedResponsivePatched = css.patchCssDeclaration(
    "@layer components { @media (max-width: 410px) { .button { opacity: 0.3; } } }",
    { ...base, selector: ".button", breakpoint: "mobile" },
    "opacity",
    "0.55",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    nestedResponsivePatched,
    /@layer components\s*\{\s*@media \(max-width: 410px\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.55;/,
  );
  assert.equal(
    css.readCssRuleDeclarations(
      nestedResponsivePatched,
      { ...base, selector: ".button", breakpoint: "mobile" },
      breakpoints,
    ).opacity,
    "0.55",
  );

  const nestedWidthSource =
    "@media (max-width: 810px) { @media (max-width: 410px) { .button { opacity: 0.3; } } }";
  const nestedTabletPatched = css.patchCssDeclaration(
    nestedWidthSource,
    { ...base, selector: ".button", breakpoint: "tablet" },
    "opacity",
    "0.55",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    nestedTabletPatched,
    /@media \(max-width: 810px\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.55;\s*\}\s*@media \(max-width: 410px\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.3;/,
    "editing tablet must create its own tier before, not mutate or override, a nested mobile tier",
  );
  assert.equal(
    css.readCssRuleDeclarations(
      nestedTabletPatched,
      { ...base, selector: ".button", breakpoint: "tablet" },
      breakpoints,
    ).opacity,
    "0.55",
  );
  assert.equal(
    css.readCssRuleDeclarations(
      nestedTabletPatched,
      { ...base, selector: ".button", breakpoint: "mobile" },
      breakpoints,
    ).opacity,
    "0.3",
  );

  const screenMediaPatched = css.patchCssDeclaration(
    "@media screen and (max-width: 810px) { .button { opacity: 0.4; color: teal; } }",
    { ...base, selector: ".button", breakpoint: "tablet" },
    "opacity",
    "0.62",
    breakpoints,
    { authoritative: true },
  );
  assert.equal(
    (screenMediaPatched.match(/\.button\s*\{/g) || []).length,
    1,
    "a screen-prefixed width query is the same breakpoint and must be edited in place",
  );
  assert.match(
    screenMediaPatched,
    /@media screen and \(max-width: 810px\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.62;\s*color:\s*teal;/,
  );

  const rangeMediaPatched = css.patchCssDeclaration(
    "@media (width <= 810px) { .button { opacity: 0.41; } }",
    { ...base, selector: ".button", breakpoint: "tablet" },
    "opacity",
    "0.63",
    breakpoints,
    { authoritative: true },
  );
  assert.equal((rangeMediaPatched.match(/\.button\s*\{/g) || []).length, 1);
  assert.match(
    rangeMediaPatched,
    /@media \(width <= 810px\)\s*\{\s*\.button\s*\{\s*opacity:\s*0\.63;/,
    "inclusive Media Queries 4 range syntax is equivalent to the registered breakpoint",
  );

  const cursorTokenCascade = css.patchCssDeclaration(
    [
      ":root { --interactive-cursor: pointer; }",
      ".unrelated { cursor: auto !important; }",
      ".card:hover { cursor: grab; }",
      "@media (max-width: 810px) { .card { cursor: crosshair; } }",
    ].join("\n"),
    base,
    "cursor",
    "var(--interactive-cursor)",
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    cursorTokenCascade,
    /:root\s*\{[^}]*--interactive-cursor:\s*pointer/i,
  );
  assert.match(
    cursorTokenCascade,
    /\.unrelated\s*\{[^}]*cursor:\s*auto\s*!important/i,
  );
  assert.match(
    cursorTokenCascade,
    /\.card\s*\{[^}]*cursor:\s*var\(--interactive-cursor\)(?!\s*!important)/i,
  );
  assert.match(cursorTokenCascade, /\.card:hover\s*\{[^}]*cursor:\s*grab/i);
  assert.doesNotMatch(cursorTokenCascade, /#__kodety_visual_authority_/);
  assert.ok(
    cursorTokenCascade.indexOf(".card {") <
      cursorTokenCascade.indexOf("@media (max-width: 810px)"),
    "new base declarations must precede responsive overrides",
  );
  assert.equal(
    css.readCssRuleDeclarations(cursorTokenCascade, base, breakpoints).cursor,
    "var(--interactive-cursor)",
  );

  const requestedPriority = css.patchCssDeclaration(
    ".card { color: red; }",
    base,
    "display",
    "grid !important",
    breakpoints,
    { authoritative: true, preservePriority: true },
  );
  assert.match(requestedPriority, /display:\s*grid/);
  assert.doesNotMatch(
    requestedPriority,
    /display:\s*grid\s*!important/i,
    "visual authoring must strip requested priority even through the legacy option",
  );

  const priorityResetSource = [
    ".card { all: revert !important; display: grid !important; row-gap: 48px !important; }",
    ".card { column-gap: 24px; color: red; }",
  ].join("\n");
  let priorityResetPatched = css.patchCssDeclaration(
    priorityResetSource,
    base,
    "display",
    "none",
    breakpoints,
    { authoritative: true },
  );
  priorityResetPatched = css.patchCssDeclaration(
    priorityResetPatched,
    base,
    "gap",
    "10px",
    breakpoints,
    { authoritative: true },
  );
  assert.match(priorityResetPatched, /all:\s*revert(?!\s*!important)/i);
  assert.match(priorityResetPatched, /display:\s*none\s*!important/i);
  assert.match(priorityResetPatched, /row-gap:\s*48px(?!\s*!important)/i);
  assert.match(priorityResetPatched, /column-gap:\s*24px/i);
  assert.match(priorityResetPatched, /gap:\s*10px(?!\s*!important)/i);
  assert.equal(
    (priorityResetPatched.match(/!\s*important/gi) || []).length,
    1,
    "only the existing exact display priority is unrelated to the later gap write",
  );
  assert.ok(
    styleUtils.conflictingStyleProperties("gap").has("row-gap"),
    "row-gap is a longhand blocker for an authoritative gap shorthand",
  );
  const priorityResetGapOwner = css.inspectCssRule(
    priorityResetPatched,
    base,
    "gap",
    breakpoints,
  ).propertyOwner;
  assert.equal(priorityResetGapOwner?.value, "10px");
  assert.equal(priorityResetGapOwner?.important, false);

  const importantPaddingShorthand = css.patchCssDeclaration(
    ".card { padding: 20px !important; padding-top: 3px; padding-right: 4px; }",
    base,
    "padding-left",
    "11px",
    breakpoints,
    { authoritative: true },
  );
  assert.equal(
    importantPaddingShorthand,
    ".card { padding: 20px !important; padding-left: 11px !important; padding-top: 3px; padding-right: 4px; }",
    "a derived longhand must retain its authored shorthand priority so unedited sides do not change",
  );
  assert.ok(
    styleUtils.conflictingStyleProperties("padding-left").has("padding"),
    "padding is a shorthand blocker for an authoritative padding-left write",
  );
  const paddingLeftOwner = css.inspectCssRule(
    importantPaddingShorthand,
    base,
    "padding-left",
    breakpoints,
  ).propertyOwner;
  assert.equal(paddingLeftOwner?.value, "11px");
  assert.equal(paddingLeftOwner?.important, true);
  const paddingTopOwner = css.inspectCssRule(importantPaddingShorthand, base, "padding-top", breakpoints).propertyOwner;
  assert.equal(paddingTopOwner?.property, "padding", "the unedited side must keep its original shorthand owner");
  assert.equal(paddingTopOwner?.value, "20px");
  assert.equal(paddingTopOwner?.important, true);

  const sameSelectorPriority = css.patchCssDeclaration(
    ".card { display: grid !important; }\n@media (max-width: 410px) { .card { display: block; } }",
    { ...base, breakpoint: "mobile" },
    "display",
    "none",
    breakpoints,
    { authoritative: true },
  );
  assert.doesNotMatch(sameSelectorPriority, /!\s*important/i);
  assert.equal(
    css.inspectCssRuleAtViewport(
      sameSelectorPriority,
      { ...base, breakpoint: "mobile" },
      "display",
      410,
      breakpoints,
    ).propertyOwner?.value,
    "none",
    "responsive authoring must consume a same-selector priority blocker and create a normal winner",
  );

  const tracedSelectorPriority = css.patchCssDeclaration(
    ".shell .card { width: 233px !important; }",
    { ...base, selector: ".shell .card", breakpoint: "mobile" },
    "width",
    "181px",
    breakpoints,
    { authoritative: true },
  );
  assert.equal(
    tracedSelectorPriority,
    [
      ".shell .card { width: 233px; }",
      "@media (max-width: 410px) {",
      " .shell .card { width: 181px; } }",
    ].join("\n"),
    "a traced selector keeps its specificity while base and new Mobile owners become normal priority",
  );
  assert.doesNotMatch(tracedSelectorPriority, /!\s*important|#__kodety_visual_authority_/i);
  const tracedDesktopOwner = css.inspectCssRuleAtViewport(
    tracedSelectorPriority,
    { ...base, selector: ".shell .card" },
    "width",
    1920,
    breakpoints,
  ).propertyOwner;
  assert.equal(tracedDesktopOwner?.value, "233px");
  assert.equal(tracedDesktopOwner?.important, false);
  const tracedMobileInspection = css.inspectCssRuleAtViewport(
    tracedSelectorPriority,
    { ...base, selector: ".shell .card", breakpoint: "mobile" },
    "width",
    410,
    breakpoints,
  );
  assert.equal(tracedMobileInspection.propertyOwner?.value, "181px");
  assert.equal(tracedMobileInspection.propertyOwner?.important, false);
  assert.equal(tracedMobileInspection.propertyOwnerBelongsToBreakpoint, true);

  const duplicateMobilePrioritySource = [
    "@media (max-width:410px) { .card { display: flex; gap: 24px; } }",
    ".card { display: grid !important; gap: 48px !important; }",
    "@media (max-width: 410px) { .card { display: block; gap: 32px; } }",
  ].join("\n");
  let duplicateMobilePriority = css.patchCssDeclaration(
    duplicateMobilePrioritySource,
    { ...base, breakpoint: "mobile" },
    "display",
    "none",
    breakpoints,
    { authoritative: true },
  );
  duplicateMobilePriority = css.patchCssDeclaration(
    duplicateMobilePriority,
    { ...base, breakpoint: "mobile" },
    "gap",
    "8px",
    breakpoints,
    { authoritative: true },
  );
  assert.equal(
    duplicateMobilePriority,
    [
      "@media (max-width:410px) { .card { display: flex; gap: 24px; } }",
      ".card { display: grid; gap: 48px; }",
      "@media (max-width: 410px) { .card { display: none; gap: 8px; } }",
    ].join("\n"),
    "equivalent Mobile wrappers keep source order while their later rule becomes the normal-priority owner",
  );
  assert.doesNotMatch(duplicateMobilePriority, /!\s*important/i);
  for (const [breakpoint, width, expected] of [
    ["base", 1920, { display: "grid", gap: "48px" }],
    ["mobile", 410, { display: "none", gap: "8px" }],
  ]) {
    for (const property of ["display", "gap"]) {
      const inspection = css.inspectCssRuleAtViewport(
        duplicateMobilePriority,
        { ...base, breakpoint },
        property,
        width,
        breakpoints,
      );
      assert.equal(inspection.propertyOwner?.value, expected[property]);
      assert.equal(inspection.propertyOwner?.important, false);
      assert.equal(inspection.propertyOwnerBelongsToBreakpoint, true);
    }
  }

  const layeredImportantResponsive = css.patchCssDeclaration(
    "@layer components { @media (max-width: 767px) { .card { color: royalblue !important; } } }",
    { ...base, breakpoint: "mobile" },
    "color",
    "salmon",
    breakpoints,
    { authoritative: true },
  );
  const layeredImportantViewport = css.inspectCssRuleAtViewport(
    layeredImportantResponsive,
    { ...base, breakpoint: "mobile" },
    "color",
    410,
    breakpoints,
  );
  assert.equal(layeredImportantViewport.propertyOwner?.value, "salmon");
  assert.equal(layeredImportantViewport.propertyOwner?.important, false);
  assert.equal(layeredImportantViewport.propertyOwnerBelongsToBreakpoint, true);
  assert.match(layeredImportantResponsive, /@media \(max-width: 410px\)[\s\S]*color:\s*salmon/i);
  assert.doesNotMatch(layeredImportantResponsive, /!\s*important/i);

  const legacyGuard =
    ":not(#__kodety_visual_authority_a#__kodety_visual_authority_b#__kodety_visual_authority_c#__kodety_visual_authority_d)";
  const legacyHealed = css.patchCssDeclaration(
    `.card${legacyGuard} { color: red; cursor: pointer; }\n.card:hover { cursor: grab; }`,
    base,
    "color",
    "blue",
    breakpoints,
    { authoritative: true },
  );
  assert.doesNotMatch(legacyHealed, /#__kodety_visual_authority_/);
  assert.match(
    legacyHealed,
    /\.card\s*\{[^}]*color:\s*blue[^}]*cursor:\s*pointer/i,
  );
  assert.match(legacyHealed, /\.card:hover\s*\{[^}]*cursor:\s*grab/i);

  const eofTruncatedSource = [
    '.hero__top { opacity: 0.4; width: 100%; }',
    '.hero__top:not(',
    '  #__kodety_visual_authority_a#__kodety_visual_authority_b#__kodety_visual_authority_c#__kodety_visual_authority_d',
    ') { display: flex !important; }',
    '@media (max-width: 410px) {',
    "  .testimonials__bg-img[data-slide='0'] { height:[Truncated]",
  ].join('\n');
  const eofTruncatedPatched = css.patchCssDeclaration(
    eofTruncatedSource,
    { ...base, selector: '.hero__top' },
    'opacity',
    '0.72',
    breakpoints,
    { authoritative: true },
  );
  assert.match(
    eofTruncatedPatched,
    /\.hero__top\s*\{\s*opacity:\s*0\.72;\s*width:\s*100%;/,
    'a valid class before a truncated EOF block must remain editable',
  );
  assert.doesNotMatch(
    eofTruncatedPatched,
    /#__kodety_visual_authority_/,
    'a formatted legacy authority guard must be healed during the same edit',
  );
  assert.match(eofTruncatedPatched, /height:\s*\[Truncated\][\s\S]*?\}\s*\}\s*$/);
  assert.equal(
    css.inspectCssRule(
      eofTruncatedPatched,
      { ...base, selector: '.hero__top' },
      'opacity',
      breakpoints,
    ).propertyOwner?.value,
    '0.72',
    'the repaired source must remain parseable and expose the edited declaration',
  );

  const overlappingSource = [
    "@media (max-width: 900px) { .card { color: tomato; } }",
    ".between-ranges { color: rebeccapurple; }",
    "@media (min-width: 600px) { .card { color: royalblue; } }",
  ].join("\n");
  const overlappingPatched = css.patchCssDeclaration(
    overlappingSource,
    { ...base, breakpoint: "overlap-max" },
    "color",
    "salmon",
    breakpoints,
    { authoritative: true },
  );
  assert.ok(
    overlappingPatched.indexOf("@media (max-width: 900px)") <
      overlappingPatched.indexOf(".between-ranges") &&
      overlappingPatched.indexOf(".between-ranges") <
        overlappingPatched.indexOf("@media (min-width: 600px)"),
    "editing max-width must preserve the authored winner in an overlapping min/max range",
  );
  assert.match(
    overlappingPatched,
    /@media \(max-width: 900px\)[\s\S]*?color:\s*salmon/,
  );
  assert.match(
    overlappingPatched,
    /@media \(min-width: 600px\)[\s\S]*?color:\s*royalblue/,
  );
  assert.ok(
    overlappingPatched.lastIndexOf("@media (max-width: 900px)") >
      overlappingPatched.indexOf("@media (min-width: 600px)"),
    "a terminal exact-tier override must be added when a later overlapping query owns the viewport",
  );
  const overlappingViewportInspection = css.inspectCssRuleAtViewport(
    overlappingPatched,
    { ...base, breakpoint: "overlap-max" },
    "color",
    900,
    breakpoints,
  );
  assert.equal(overlappingViewportInspection.propertyOwner?.value, "salmon");
  assert.equal(overlappingViewportInspection.propertyOwnerBelongsToBreakpoint, true);

  const mobileCascadePatched = css.patchCssDeclaration(
    [
      "@media (max-width: 410px) { .hero__copy { width: calc(100% - 1.5rem); } }",
      "@media (max-width: 767px) { .hero__copy { width: 90vw; } }",
    ].join("\n"),
    { ...base, selector: ".hero__copy", breakpoint: "mobile" },
    "width",
    "280px",
    breakpoints,
    { authoritative: true },
  );
  assert.ok(
    mobileCascadePatched.lastIndexOf("@media (max-width: 410px)") >
      mobileCascadePatched.indexOf("@media (max-width: 767px)"),
    "a saved mobile edit must come after a broader active mobile query that would otherwise mask it",
  );
  assert.equal(
    css.inspectCssRuleAtViewport(
      mobileCascadePatched,
      { ...base, selector: ".hero__copy", breakpoint: "mobile" },
      "width",
      410,
      breakpoints,
    ).propertyOwner?.value,
    "280px",
    "the declaration displayed on the 410px canvas must be the value just authored",
  );

  const notebookRangePriorityPatched = css.patchCssDeclaration(
    [
      "@media (max-width: 1200px) { .pricing-plan__meta--badges li { width: 100%; } }",
      "@media (min-width: 1101px) and (max-width: 1200px) { .pricing-plan__meta--badges li { width: auto !important; } }",
      "@media (max-width: 767px) { .pricing-plan__meta--badges li { width: auto !important; } }",
    ].join("\n"),
    {
      ...base,
      selector: ".pricing-plan__meta--badges li",
      breakpoint: "notebook",
    },
    "width",
    "200px",
    breakpoints,
    { authoritative: true, viewportWidth: 1200 },
  );
  assert.ok(
    notebookRangePriorityPatched.lastIndexOf("@media (max-width: 1200px)") >
      notebookRangePriorityPatched.indexOf("@media (min-width: 1101px) and (max-width: 1200px)"),
    "a Notebook edit must be emitted after an active compound range that otherwise keeps winning",
  );
  assert.ok(
    notebookRangePriorityPatched.lastIndexOf("@media (max-width: 1200px)") <
      notebookRangePriorityPatched.indexOf("@media (max-width: 767px)"),
    "a Notebook repair must stay before a later explicit Mobile child override",
  );
  const notebookRangePriorityInspection = css.inspectCssRuleAtViewport(
    notebookRangePriorityPatched,
    {
      ...base,
      selector: ".pricing-plan__meta--badges li",
      breakpoint: "notebook",
    },
    "width",
    1200,
    breakpoints,
  );
  assert.equal(notebookRangePriorityInspection.propertyOwner?.value, "200px");
  assert.equal(
    notebookRangePriorityInspection.propertyOwner?.important,
    false,
    "a new Notebook owner must remain normal priority",
  );
  assert.equal(notebookRangePriorityInspection.propertyOwnerBelongsToBreakpoint, true);
  const notebookRangeMobileInspection = css.inspectCssRuleAtViewport(
    notebookRangePriorityPatched,
    {
      ...base,
      selector: ".pricing-plan__meta--badges li",
      breakpoint: "mobile",
    },
    "width",
    410,
    breakpoints,
  );
  assert.equal(notebookRangeMobileInspection.propertyOwner?.value, "auto");
  assert.equal(notebookRangeMobileInspection.propertyOwner?.important, true);

  const primaryMediaPriorityPatched = css.patchCssDeclaration(
    "@media (max-width: 1920px) { .card { width: 100px !important; color: tomato; } }",
    base,
    "width",
    "200px",
    breakpoints,
    { authoritative: true, viewportWidth: 1920, editActiveWinner: true },
  );
  assert.match(
    primaryMediaPriorityPatched,
    /@media \(max-width: 1920px\)[\s\S]*?\.card\s*\{[^}]*width:\s*200px\s*!important/i,
    "an immediate Primary edit must update its active media winner and retain priority",
  );
  assert.equal(
    (() => {
      let declarations = 0;
      postcss.parse(primaryMediaPriorityPatched).walkDecls('width', () => {
        declarations += 1;
      });
      return declarations;
    })(),
    1,
    "an active Primary media winner must not leave a losing parallel base declaration",
  );

  const resizedOverlap = css.patchBreakpointMediaQueries(
    overlappingSource,
    breakpoints.slice(-2),
    [
      {
        id: "overlap-max",
        label: "Overlap max",
        mode: "max-width",
        width: 850,
      },
      breakpoints.at(-1),
    ],
  );
  assert.ok(
    resizedOverlap.indexOf("@media (max-width: 850px)") <
      resizedOverlap.indexOf(".between-ranges") &&
      resizedOverlap.indexOf(".between-ranges") <
        resizedOverlap.indexOf("@media (min-width: 600px)"),
    "resizing max-width must not sort overlapping media wrappers",
  );

  const collisionSource = [
    "@media (max-width: 900px) { .card { color: tomato; } }",
    ".card { color: black; }",
    "@media (max-width: 600px) { .card { color: royalblue; } }",
  ].join("\n");
  const collisionPatched = css.patchBreakpointMediaQueries(
    collisionSource,
    [
      { id: "large", label: "Large", mode: "max-width", width: 900 },
      { id: "small", label: "Small", mode: "max-width", width: 600 },
    ],
    [
      { id: "large", label: "Large", mode: "max-width", width: 600 },
      { id: "small", label: "Small", mode: "max-width", width: 600 },
    ],
  );
  assert.equal(
    (collisionPatched.match(/@media \(max-width: 600px\)/g) || []).length,
    2,
  );
  assert.ok(
    collisionPatched.indexOf("@media (max-width: 600px)") <
      collisionPatched.indexOf(".card { color: black; }") &&
      collisionPatched.indexOf(".card { color: black; }") <
        collisionPatched.lastIndexOf("@media (max-width: 600px)"),
    "colliding widths must keep both wrappers in place so the base rule does not move in the cascade",
  );

  console.log("CSS patcher cascade regression tests passed");
} finally {
  await server.close();
}
