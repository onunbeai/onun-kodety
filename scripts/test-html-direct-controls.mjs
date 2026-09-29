import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const protocol = await server.ssrLoadModule(
    "/lib/html-editor/canvas-protocol.ts",
  );
  const spatial = await server.ssrLoadModule(
    "/lib/html-editor/spatial-controls.ts",
  );
  const generation = "direct-controls-test";
  const positionBatch = protocol.withCanvasGeneration(generation, {
    type: "html-editor-direct-style-batch",
    breakpointId: "mobile",
    path: "0/2",
    gestureId: "direct:1",
    styles: [
      {
        property: "left",
        sourceProperty: "left",
        value: "-18.5px",
        startPx: 0,
        valuePx: -18.5,
      },
      {
        property: "top",
        sourceProperty: "top",
        value: "42px",
        startPx: 24,
        valuePx: 42,
      },
    ],
  });
  assert.equal(
    protocol.isCanvasToEditorMessage(positionBatch, generation),
    true,
  );
  assert.equal(
    protocol.isCanvasToEditorMessage(
      {
        ...positionBatch,
        styles: [...positionBatch.styles, positionBatch.styles[0]],
      },
      generation,
    ),
    false,
  );
  assert.equal(
    protocol.isCanvasToEditorMessage(
      protocol.withCanvasGeneration(generation, {
        type: "html-editor-direct-style-preview",
        breakpointId: "mobile",
        path: "0/2",
        values: { left: "-18.5px", top: "42px" },
      }),
      generation,
    ),
    true,
  );
  assert.equal(
    spatial.preserveSpatialUnit("2rem", 32, -16, "-16px", {
      allowNegative: true,
    }),
    "-1rem",
  );

  const preview = await readFile(
    path.join(root, "lib/html-editor/preview.ts"),
    "utf8",
  );
  const editor = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx",
    ),
    "utf8",
  );
  const styleAdapter = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/components/HtmlKodetyStyleControls.tsx",
    ),
    "utf8",
  );
  const backgroundControls = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/ycode-style/BackgroundsControls.tsx",
    ),
    "utf8",
  );
  const backgroundImageSettings = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/ycode-style/BackgroundImageSettings.tsx",
    ),
    "utf8",
  );
  const wordpressMediaDialog = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/ycode-style/WordPressBackgroundMediaDialog.tsx",
    ),
    "utf8",
  );
  const visualStyleField = await readFile(
    path.join(root, "app/(builder)/kodety/components/VisualStyleField.tsx"),
    "utf8",
  );
  const updates = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/components/HtmlKodetyUpdates.tsx",
    ),
    "utf8",
  );
  assert.match(preview, /--kodety-direct-selection-color:\s*#00d1b8/);
  assert.match(
    preview,
    /data-html-editor-agent-selection-active[\s\S]*?--kodety-direct-selection-color:\s*#a78bfa/,
  );
  assert.match(
    preview,
    /data-spacing-kind\^="padding-"[\s\S]*?rgba\(255, 111, 224, \.25\)/,
  );
  assert.match(
    preview,
    /data-spacing-kind\^="margin-"[\s\S]*?rgba\(254, 156, 7, \.25\)/,
  );
  assert.match(
    preview,
    /data-rotate-corner="top-left"[\s\S]*?data-rotate-corner="bottom-left"/,
  );
  assert.match(
    preview,
    /kind: 'position'[\s\S]*?type: 'html-editor-direct-style-batch'/,
  );
  assert.match(
    editor,
    /message\.type === 'html-editor-direct-style-batch'[\s\S]*?message\.styles\.forEach/,
  );
  assert.match(
    editor,
    /allowNegative: DIRECT_POSITION_STYLE_PROPERTIES\.has\(property\)/,
  );
  assert.match(
    styleAdapter,
    /onChange\("background-image", nextBackgroundImage\)/,
  );
  assert.match(
    backgroundControls,
    /WordPressBackgroundMediaDialog[\s\S]*?handleBackgroundImageChange\(url, true\)/,
  );
  assert.match(
    backgroundControls,
    /processedValue && !currentBg\.backgroundSize[\s\S]*?backgroundSize: 'cover'/,
    "new background images must persist cover unless the user already chose another size",
  );
  assert.match(
    backgroundControls,
    /processedValue \? \{ bgGradientVars: removeVarEntry\(currentBg\.bgGradientVars, varName\) \} : \{\}/,
    "choosing a style-panel image must replace the active gradient placeholder",
  );
  assert.match(
    backgroundImageSettings,
    /data-background-image-upload[\s\S]*?<UploadIcon[\s\S]*?Upload/,
    "the media source must expose a neutral, always-visible upload surface",
  );
  assert.doesNotMatch(
    backgroundImageSettings,
    /DEFAULT_ASSETS|Background image preview|Choose file|Change file/,
    "the background picker must not render the old placeholder or preview cover",
  );
  assert.match(
    wordpressMediaDialog,
    /mediaUploadUrl[\s\S]*?media_type', 'image'/,
  );
  assert.match(
    visualStyleField,
    /DropdownMenuContent[\s\S]*?className=(?:"z-\[110\]|\{cn\([\s\S]*?['"]z-\[110\])/,
  );
  assert.match(updates, /BellIcon[\s\S]*?variant="secondary"/);
  assert.match(
    updates,
    /Kodety \$\{status\.latestVersion\} está disponível[\s\S]*?label: 'Atualizar'/,
    "the in-editor update notification must expose an explicit localized update action",
  );
  assert.match(
    editor,
    /const openKodetyUpdates = useCallback[\s\S]*?void navigateAfterWordPressSave\(destination\)/,
    "the in-editor update action must save pending changes before navigating in the current tab",
  );
  const openUpdatesSource = editor.slice(
    editor.indexOf("const openKodetyUpdates = useCallback"),
    editor.indexOf("const commitProject = useCallback"),
  );
  assert.doesNotMatch(
    openUpdatesSource,
    /_blank|window\.open|window\.close|document\.createElement\('a'\)/,
    "the update action must not leave an obsolete Builder tab open or attempt to force-close a tab",
  );
  assert.doesNotMatch(
    updates.slice(
      updates.indexOf("export const HtmlKodetyUpdateIndicator"),
      updates.indexOf("export const HtmlKodetyUpdateMenuItems"),
    ),
    /rounded-full bg-\[var\(--kodety-accent\)\]/,
  );

  console.log("HTML direct controls tests passed");
} finally {
  await server.close();
}
