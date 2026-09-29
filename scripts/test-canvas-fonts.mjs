import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { "@": root } },
});
try {
  const { canvasFontResources, withCanvasFontResources, CANVAS_FONTS_RUNTIME } =
    await server.ssrLoadModule("/lib/html-editor/canvas-fonts.ts");
  const font = (family) => ({
    id: family,
    name: family.toLowerCase().replaceAll(" ", "-"),
    family,
    type: "google",
    variants: ["regular"],
    weights: ["400"],
    category: "serif",
  });
  const fonts = ["Adamina", "Abril Fatface", "Advent Pro"].map(font);
  assert.deepEqual(
    canvasFontResources(fonts, ["color:red"]),
    [],
    "unreferenced installed fonts must not load",
  );
  const adamina = canvasFontResources(fonts, ['font-family:"Adamina",serif']);
  assert.equal(adamina.length, 1);
  assert.equal(adamina[0].family, "Adamina");
  assert.match(adamina[0].href, /fonts\.googleapis\.com\/css2\?family=Adamina/);
  assert.match(adamina[0].classesCss, /font-family: "Adamina"/);
  for (const message of [
    {
      type: "html-editor-live-style",
      cssText: '.title{font-family:"Adamina",serif}',
    },
    {
      type: "html-editor-live-style",
      patches: [
        { path: "0.0", property: "font-family", value: '"Adamina",serif' },
      ],
    },
    {
      type: "html-editor-live-style",
      attributes: [{ path: "0.0", name: "class", value: "font-[Adamina]" }],
    },
    {
      type: "html-editor-view-state",
      state: {
        kind: "delta",
        stylesheets: [
          { path: "style.css", cssText: '.title{font-family:"Adamina"}' },
        ],
      },
    },
    {
      type: "html-editor-view-state",
      state: {
        kind: "snapshot",
        patches: [{ path: "0.0", property: "font-family", value: "Adamina" }],
      },
    },
    {
      type: "html-editor-live-structure",
      html: '<p style="font-family:Adamina">New</p>',
    },
    {
      type: "html-editor-inline-range-style",
      property: "font-family",
      value: "Adamina",
    },
  ]) {
    const before = JSON.stringify(message);
    assert.deepEqual(
      withCanvasFontResources(message, fonts).fontResources,
      adamina,
      `${message.type} must carry its required face`,
    );
    assert.equal(
      JSON.stringify(message),
      before,
      "adding font availability must not mutate the CSS command",
    );
  }
  const noStyles = { type: "html-editor-select", path: "0.0" };
  assert.equal(
    withCanvasFontResources(noStyles, fonts),
    noStyles,
    "selection-only messages remain cheap",
  );
  assert.deepEqual(
    withCanvasFontResources(
      { type: "html-editor-view-state", state: {} },
      fonts,
      [".title{font-family:Adamina}"],
    ).fontResources,
    adamina,
    "newly ready frames recover fonts from canonical source even with an empty delta journal",
  );

  const nodes = [];
  const createElement = (tag) => {
    const attributes = new Map();
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      textContent: "",
      media: "",
      sheet: null,
      setAttribute: (key, value) => attributes.set(key, String(value)),
      getAttribute: (key) => attributes.get(key) ?? null,
      hasAttribute: (key) => attributes.has(key),
      removeAttribute: (key) => attributes.delete(key),
      addEventListener: (type, fn) => listeners.set(type, fn),
      emit: (type) => listeners.get(type)?.(),
      remove() {
        const index = nodes.indexOf(this);
        if (index >= 0) nodes.splice(index, 1);
      },
    };
  };
  const refreshes = { paint: 0, controls: 0, visibility: 0, layout: 0 };
  let settleFonts;
  const document = {
    createElement,
    head: { appendChild: (node) => nodes.push(node) },
    documentElement: {
      isConnected: true,
      getBoundingClientRect() {
        refreshes.layout++;
        return {};
      },
    },
    fonts: {
      ready: new Promise((resolve) => {
        settleFonts = resolve;
      }),
    },
    querySelectorAll: () => nodes.filter((node) => node.tagName === "LINK"),
    querySelector: () => nodes.find((node) => node.tagName === "STYLE") || null,
  };
  const apply = new Function(
    "document",
    "URL",
    "scheduleLiveStylePaintRefresh",
    "refreshDirectControls",
    "scheduleCanvasVisibilitySnapshot",
    `${CANVAS_FONTS_RUNTIME}\nreturn applyCanvasFontResources;`,
  )(
    document,
    URL,
    () => refreshes.paint++,
    () => refreshes.controls++,
    () => refreshes.visibility++,
  );
  apply(adamina);
  const link = nodes.find((node) => node.tagName === "LINK");
  assert.equal(link.href, adamina[0].href);
  assert.equal(
    link.media,
    "all",
    "live selection must activate immediately, not wait for another ready/reload",
  );
  assert.equal(
    link.getAttribute("data-html-editor-google-font-state"),
    "pending",
  );
  apply(adamina);
  assert.equal(
    nodes.filter((node) => node.tagName === "LINK").length,
    1,
    "replaying CSS/ACK snapshots must not duplicate requests",
  );
  assert.equal(
    refreshes.controls,
    0,
    "selection geometry should wait for the font metrics",
  );
  link.emit("load");
  assert.equal(
    link.getAttribute("data-html-editor-google-font-state"),
    "loaded",
  );
  assert.equal(refreshes.controls, 0);
  settleFonts();
  await Promise.resolve();
  assert.equal(refreshes.controls, 1);
  assert.equal(refreshes.visibility, 1);
  assert.equal(refreshes.paint, 1);

  const abril = canvasFontResources(fonts, ["Abril Fatface"]);
  apply(abril);
  apply(adamina);
  assert.equal(nodes.filter((node) => node.tagName === "LINK").length, 2);
  assert.match(
    nodes.find((node) => node.tagName === "STYLE").textContent,
    /Adamina[\s\S]*?Abril Fatface/,
    "loading another family must preserve earlier font classes",
  );
  const abrilLink = nodes.find((node) => node.href === abril[0].href);
  abrilLink.emit("error");
  assert.equal(
    abrilLink.getAttribute("data-html-editor-google-font-state"),
    "error",
  );
  apply(abril);
  assert.ok(
    !nodes.includes(abrilLink),
    "explicit reselection retries a failed stylesheet",
  );
  assert.equal(nodes.filter((node) => node.tagName === "LINK").length, 2);

  const deferred = createElement("link");
  const advent = canvasFontResources(fonts, ["Advent Pro"]);
  deferred.href = advent[0].href;
  deferred.media = "print";
  deferred.setAttribute("data-html-editor-deferred-google-font", "");
  nodes.push(deferred);
  apply(advent);
  assert.equal(deferred.media, "all");
  assert.equal(
    deferred.hasAttribute("data-html-editor-deferred-google-font"),
    false,
  );
  assert.equal(
    nodes.filter((node) => node.tagName === "LINK").length,
    3,
    "reuse the preloaded srcdoc link",
  );
  apply([
    { family: "Bad", href: "https://example.com/track.css" },
    { family: "Bad", href: "javascript:alert(1)" },
  ]);
  assert.equal(nodes.filter((node) => node.tagName === "LINK").length, 3);

  const editor = await readFile(
    path.join(
      root,
      "app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx",
    ),
    "utf8",
  );
  const preview = await readFile(
    path.join(root, "lib/html-editor/preview.ts"),
    "utf8",
  );
  assert.match(
    editor,
    /postCanvasMessage = useCallback[\s\S]*?withCanvasFontResources/,
  );
  assert.match(
    editor,
    /postPassiveCanvasMessage = useCallback[\s\S]*?withCanvasFontResources/,
  );
  assert.match(
    editor,
    /postCanvasViewStateToFrame = useCallback[\s\S]*?withCanvasFontResources[\s\S]*?type: 'html-editor-view-state'/,
  );
  const editorAst = ts.createSourceFile("HtmlProjectEditor.tsx", editor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fontAvailabilityEffect;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(editorAst) === "useEffect"
      && node.arguments[0]?.getText(editorAst).includes("postCanvasViewStateToFrame(iframeRef.current?.contentWindow)")) {
      fontAvailabilityEffect = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(editorAst);
  assert.ok(fontAvailabilityEffect, "font availability must update retained canvas frames");
  const fontDependencies = fontAvailabilityEffect.arguments[1];
  assert.ok(fontDependencies && ts.isArrayLiteralExpression(fontDependencies));
  for (const dependency of ["installedFonts", "adobeFontsCatalog", "postCanvasViewStateToFrame"]) {
    assert.ok(fontDependencies.elements.some(element => element.getText(editorAst) === dependency), `${dependency} must refresh font availability`);
  }
  assert.match(fontAvailabilityEffect.arguments[0].getText(editorAst), /passiveCanvasFramesRef\.current\.forEach/);
  const previewMemo = editor.slice(
    editor.indexOf("const preview = useMemo("),
    editor.indexOf("let editorCanvasPreview ="),
  );
  assert.match(previewMemo, /useFontsStore\.getState\(\)\.getRenderableFonts\(\)/);
  assert.doesNotMatch(
    previewMemo,
    /\n\s+(?:installedFonts|adobeFontsCatalog),/,
    "font installation must not rebuild/reload retained canvas documents",
  );
  assert.match(
    preview,
    /if \(!validPortMessage && !isCurrentEditorMessage\(event\)\) return;\s*applyCanvasFontResources\(event.data\?\.fontResources\)/,
    "font updates obey the current generation and parent/channel checks",
  );
  console.log(
    "canvas-fonts: ok (live CSS, snapshots, deltas, active/passive frames, deduplication, loading, retry, no reload)",
  );
} finally {
  await server.close();
}
