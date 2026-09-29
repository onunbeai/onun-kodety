import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const aliases = {
  '@coday/components': path.join(root, 'packages/component-sdk/src/index.ts'),
  '@coday/control-schema': path.join(root, 'packages/control-schema/src/index.ts'),
  '@coday/component-runtime/vendor': path.join(root, 'packages/component-runtime/src/vendor.ts'),
  '@coday/component-runtime': path.join(root, 'packages/component-runtime/src/index.tsx'),
  '@coday/component-compiler': path.join(root, 'packages/component-compiler/src/index.ts'),
  '@coday/property-inspector': path.join(root, 'packages/property-inspector/src/index.tsx'),
  '@coday/canvas-bridge': path.join(root, 'packages/canvas-bridge/src/index.ts'),
  '@coday/asset-bridge': path.join(root, 'packages/asset-bridge/src/index.ts'),
  '@coday/cms-bridge': path.join(root, 'packages/cms-bridge/src/index.ts'),
  '@coday/component-registry': path.join(root, 'packages/component-registry/src/index.ts'),
  '@coday/component-sandbox': path.join(root, 'packages/component-sandbox/src/index.ts'),
};

const server = await createServer({ root, logLevel: 'silent', appType: 'custom', plugins: [codeComponentReactRuntimePlugin()], server: { middlewareMode: true }, resolve: { alias: aliases } });
try {
  const schema = await server.ssrLoadModule('/packages/control-schema/src/index.ts');
  const compilerModule = await server.ssrLoadModule('/packages/component-compiler/src/index.ts');
  const sdkModule = await server.ssrLoadModule('/packages/component-sdk/src/index.ts');
  const nodeCompilerModule = await server.ssrLoadModule('/packages/component-compiler/src/node.ts');
  const registryModule = await server.ssrLoadModule('/packages/component-registry/src/index.ts');
  const projectModule = await server.ssrLoadModule('/lib/html-editor/code-components.ts');
  const previewModule = await server.ssrLoadModule('/lib/html-editor/preview.ts');
  const projectIoModule = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const authoringModule = await server.ssrLoadModule('/lib/html-editor/code-component-authoring.ts');
  const framerImportModule = await server.ssrLoadModule('/lib/html-editor/framer-code-component-import.ts');
  const agentModule = await server.ssrLoadModule('/lib/html-editor/code-component-agent.ts');
  const previewSource = await readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');

  assert.match(
    previewSource,
    /const resolveRuntimeAssetPath = \(raw, allowUnregistered = false\)[\s\S]*?new URL\(document\.baseURI\)[\s\S]*?absolute\.origin !== base\.origin[\s\S]*?path\.startsWith\('assets\/'\) \|\| path\.includes\('\/assets\/'\)/,
    'a srcdoc-expanded same-base Code Component image URL must resolve only through the local project asset bridge',
  );
  assert.match(
    previewSource,
    /const resolveRuntimeAssetUrlForComponent = raw =>[\s\S]*?requestRuntimeAssetUrl\(raw, finish, true\)[\s\S]*?cancelRuntimeAssetUrlRequest\(raw, finish, true\)[\s\S]*?globalThis\.__KODETY_RESOLVE_RUNTIME_ASSET_URL__ = resolveRuntimeAssetUrlForComponent/,
    'the async component resolver must await fresh uploads and remove its waiter on bounded fail-open',
  );

  const canvasImports = previewModule.addPreviewBareModuleImports(
    {
      react: 'data:text/javascript,react-runtime',
      '@coday/components': 'data:text/javascript,coday-runtime',
      framer: 'data:text/javascript,coday-runtime',
    },
    new Set(['react', '@coday/components', 'framer', 'lodash']),
    { lodash: '4.17.21' },
  );
  assert.equal(
    canvasImports.react,
    'data:text/javascript,react-runtime',
    'the canvas must preserve its single embedded React runtime',
  );
  assert.equal(
    canvasImports['@coday/components'],
    'data:text/javascript,coday-runtime',
    'the private Code Component SDK must never be replaced by a public CDN URL',
  );
  assert.equal(
    canvasImports.framer,
    'data:text/javascript,coday-runtime',
    'the Framer compatibility API must reuse the private single React runtime',
  );
  assert.equal(
    canvasImports.lodash,
    'https://esm.sh/lodash@4.17.21?bundle',
    'ordinary project dependencies should still receive their CDN fallback',
  );

  assert.equal(schema.evaluateCondition({ property: 'layout.mode', operator: 'equals', value: 'grid' }, { layout: { mode: 'grid' } }), true);
  assert.equal(schema.evaluateCondition({ or: [{ property: 'enabled', operator: 'equals', value: false }, { property: 'mode', operator: 'not-equals', value: 'advanced' }] }, { enabled: true, mode: 'advanced' }), false);
  const responsive = { base: { gap: 24, columns: 4 }, overrides: { tablet: { columns: 2 }, mobile: { gap: 8 } } };
  const breakpoints = [{ id: 'base', width: 1920 }, { id: 'tablet', width: 810, parentId: 'base' }, { id: 'mobile', width: 410, parentId: 'tablet' }];
  assert.deepEqual(schema.resolveResponsiveValue(responsive, 'mobile', breakpoints), { gap: 8, columns: 2 });
  const uploadedImage = { id: 'assets/upload.svg', src: 'assets/upload.svg', alt: 'Upload' };
  assert.equal(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'image', defaultValue: './legacy.svg' },
      uploadedImage,
    ),
    'assets/upload.svg',
    'legacy image controls must receive the uploaded src string',
  );
  assert.deepEqual(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'image', defaultValue: { id: 'default', src: 'assets/default.svg', alt: '' } },
      uploadedImage,
    ),
    uploadedImage,
    'contract-compliant image controls must keep the CodayImage object',
  );
  assert.equal(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'image', framerValueType: 'url' },
      uploadedImage,
    ),
    'assets/upload.svg',
    'Framer Image controls must receive a URL even when they do not declare a default value',
  );
  assert.equal(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'image', framerValueType: 'responsive-image' },
      null,
    ),
    undefined,
    'clearing a Framer ResponsiveImage must omit the prop so its default parameter remains safe',
  );
  assert.equal(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'image' },
      null,
    ),
    null,
    'native Coday Image controls must preserve an intentional null value',
  );
  const framerClearedInstance = projectModule.normalizeCodeComponentInstanceForRuntime(
    {
      schemaVersion: '1.0.0', id: 'cleared-framer-image', componentId: 'test.framer-image', componentVersion: '1.0.0',
      props: { image: null }, responsiveProps: { image: { base: null, overrides: {} } },
      sizing: {}, metadata: {},
    },
    { manifest: { controls: { image: { type: 'image', framerValueType: 'responsive-image' } } } },
  );
  assert.equal(Object.hasOwn(framerClearedInstance.props, 'image'), false);
  assert.equal(Object.hasOwn(framerClearedInstance.responsiveProps, 'image'), false);
  const framerResponsiveFallback = projectModule.normalizeCodeComponentInstanceForRuntime(
    {
      schemaVersion: '1.0.0', id: 'responsive-framer-image', componentId: 'test.framer-image', componentVersion: '1.0.0',
      props: {}, responsiveProps: { image: { base: null, overrides: { mobile: uploadedImage } } },
      sizing: {}, metadata: {},
    },
    { manifest: { controls: { image: { type: 'image', framerValueType: 'responsive-image' } } } },
  );
  assert.equal(framerResponsiveFallback.responsiveProps.image.base, null);
  assert.deepEqual(framerResponsiveFallback.responsiveProps.image.overrides.mobile, uploadedImage);
  assert.equal(
    projectModule.codeComponentCssColorValue('#336699/40'),
    'rgba(51,102,153,0.4)',
    'the editor alpha notation must never reach a React inline style as invalid CSS',
  );
  assert.equal(
    projectModule.normalizeCodeComponentControlValueForRuntime(
      { type: 'color', defaultValue: '#000000' },
      '#336699/40',
    ),
    'rgba(51,102,153,0.4)',
  );
  assert.deepEqual(
    projectModule.codeComponentColorEditorValue(
      { value: '#000000', format: 'hex', tokenId: 'legacy-token' },
      '#336699/40',
    ),
    { value: 'rgba(51,102,153,0.4)', format: 'rgba', tokenId: 'legacy-token', alpha: 0.4 },
    'editing a structured color must preserve its object contract and metadata',
  );

  const source = `
import React from 'react'
import { ControlType, defineComponent, type CodayComponentProps } from '@coday/components'
export interface ContractProps extends CodayComponentProps { title: string; gap: number }
export default function Contract({ title, gap }: ContractProps) { return <div style={{ gap }}>{title}</div> }
export const componentDefinition = defineComponent({
  id: 'test.contract', name: 'Contract', version: '1.2.3', component: Contract,
  sizing: { width: 'fixed', height: 'hug', defaultWidth: 320 },
  controls: {
    title: { type: ControlType.String, defaultValue: 'Hello', bindable: true },
    gap: { type: ControlType.Number, defaultValue: 16, min: 0, max: 100, responsive: true }
  }
})`;
  const compiled = await new compilerModule.ComponentCompiler().compile({ fileName: 'components/Contract.tsx', source, typeCheck: true });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.componentManifest.id, 'test.contract');
  assert.equal(compiled.componentManifest.controls.gap.type, 'number');
  assert.match(compiled.code, /mountCodayComponent/);
  assert.match(
    compiled.code,
    /__codayGetRegisteredComponent\("test\.contract",\s*"1\.2\.3"\)/,
    'a mounted bundle must resolve the exact registered semantic version',
  );
  assert.match(
    compiled.code,
    /__CodayLastGoodBoundary[\s\S]*?__codayUseLayoutEffect[\s\S]*?request\.resolve\(true\)/,
    'a Property Control update must resolve only after React committed it',
  );
  assert.match(
    compiled.code,
    /let committedProps = initialProps[\s\S]*?componentDidCatch[\s\S]*?request\.resolve\(false\)[\s\S]*?registration\.component, componentProps\(committedProps/,
    'a failed render must retain the last committed props and reject the update',
  );
  assert.ok(compiled.hash.length === 64);
  assert.equal(authoringModule.isCodeComponentSource('Contract.tsx', source), true);
  assert.equal(authoringModule.isCodeComponentSource('scripts/component.ts', source), true);
  assert.equal(authoringModule.isCodeComponentSource('scripts/helpers.ts', 'export const sum = (a, b) => a + b'), false);
  assert.deepEqual(
    authoringModule.pastedCodeComponentCandidate(source),
    { source: source.trim(), suggestedName: 'Contract' },
    'a complete TSX component pasted in the workspace should be recognized and named from its manifest',
  );
  assert.equal(authoringModule.pastedCodeComponentCandidate('plain canvas text'), null);
  const framerShareUrl = 'https://www.framer.com/m/PaintReveal-EOPQJ9.js@f8qVQ6hNSiN3LKy6YCCH';
  const framerCanonicalUrl = 'https://framer.com/m/PaintReveal-EOPQJ9.js@f8qVQ6hNSiN3LKy6YCCH';
  const framerModuleUrl = 'https://framerusercontent.com/modules/A7KOdvxakBqhB9r167d6/f8qVQ6hNSiN3LKy6YCCH/PaintReveal.js';
  const framerSourceMapUrl = 'https://framerusercontent.com/modules/A7KOdvxakBqhB9r167d6/f8qVQ6hNSiN3LKy6YCCH/PaintReveal.map';
  const importedFramerSource = `
import { addPropertyControls, ControlType } from "framer"
export default function PaintReveal({ color = "#000" }) {
  return <div style={{ color }}>Paint</div>
}
addPropertyControls(PaintReveal, {
  color: { type: ControlType.Color, defaultValue: "#000" },
})`;
  assert.deepEqual(
    framerImportModule.framerCodeComponentUrlCandidate(framerShareUrl),
    {
      url: framerCanonicalUrl,
      slug: 'PaintReveal-EOPQJ9',
      requestedVersion: 'f8qVQ6hNSiN3LKy6YCCH',
    },
  );
  assert.deepEqual(
    framerImportModule.framerCodeComponentUrlCandidate('https://framer.com/m/PaintReveal-EOPQJ9.js'),
    { url: 'https://framer.com/m/PaintReveal-EOPQJ9.js', slug: 'PaintReveal-EOPQJ9' },
    'an unversioned Framer URL must be resolved and pinned by the validated wrapper response',
  );
  assert.equal(framerImportModule.framerCodeComponentUrlCandidate('http://framer.com/m/PaintReveal.js@version'), null);
  assert.equal(framerImportModule.framerCodeComponentUrlCandidate(`${framerCanonicalUrl}?download=1`), null);
  assert.equal(framerImportModule.framerCodeComponentUrlCandidate('https://evil.example/m/PaintReveal.js@version'), null);
  const framerResponses = new Map([
    [framerCanonicalUrl, {
      contentType: 'text/javascript; charset=utf-8',
      body: `/* export * from "https://evil.example/commented.js" */\n// export { default } from "https://evil.example/commented.js"\nexport * from "${framerModuleUrl}"\nexport { default } from "${framerModuleUrl}"`,
    }],
    [framerModuleUrl, {
      contentType: 'text/javascript; charset=utf-8',
      body: `export default function PaintReveal(){return null}\n//# sourceMappingURL=./PaintReveal.map`,
    }],
    [framerSourceMapUrl, {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        version: 3,
        sources: ['helper.ts', 'PaintReveal.tsx'],
        sourcesContent: ['export const helper = true', importedFramerSource],
        names: [],
        mappings: '',
      }),
    }],
  ]);
  const framerFetchCalls = [];
  const framerFetch = async (input, init) => {
    const url = String(input);
    framerFetchCalls.push({ url, init });
    const fixture = framerResponses.get(url);
    assert.ok(fixture, `unexpected Framer fixture request: ${url}`);
    return new Response(fixture.body, {
      status: 200,
      headers: {
        'content-type': fixture.contentType,
        'content-length': String(new TextEncoder().encode(fixture.body).byteLength),
      },
    });
  };
  const importedFramer = await framerImportModule.importFramerCodeComponentFromUrl(framerShareUrl, { fetch: framerFetch });
  assert.equal(importedFramer.source, importedFramerSource.trim());
  assert.equal(importedFramer.suggestedName, 'PaintReveal');
  assert.equal(importedFramer.sourceUrl, framerCanonicalUrl);
  assert.equal(importedFramer.moduleUrl, framerModuleUrl);
  assert.equal(importedFramer.sourceMapUrl, framerSourceMapUrl);
  assert.equal(importedFramer.resolvedVersion, 'f8qVQ6hNSiN3LKy6YCCH');
  assert.deepEqual(framerFetchCalls.map(call => call.url), [framerCanonicalUrl, framerModuleUrl, framerSourceMapUrl]);
  assert.ok(framerFetchCalls.every(call => (
    call.init.credentials === 'omit'
    && call.init.redirect === 'error'
    && call.init.referrerPolicy === 'no-referrer'
  )));
  const abortedFramerImport = new AbortController();
  abortedFramerImport.abort();
  let abortedFetchCalls = 0;
  await assert.rejects(
    framerImportModule.importFramerCodeComponentFromUrl(framerShareUrl, {
      signal: abortedFramerImport.signal,
      fetch: async () => {
        abortedFetchCalls += 1;
        throw new Error('fetch must not run after abort');
      },
    }),
    error => error?.name === 'AbortError',
  );
  assert.equal(abortedFetchCalls, 0);
  await assert.rejects(
    framerImportModule.importFramerCodeComponentFromUrl(framerShareUrl, {
      fetch: async () => new Response(
        'export * from "https://evil.example/component.js"\nexport { default } from "https://evil.example/component.js"',
        { status: 200, headers: { 'content-type': 'text/javascript' } },
      ),
    }),
    error => error?.code === 'framer-module-origin',
  );
  await assert.rejects(
    framerImportModule.importFramerCodeComponentFromUrl(framerShareUrl, {
      fetch: async input => {
        const url = String(input);
        if (url === framerCanonicalUrl) {
          return new Response(
            `export * from "${framerModuleUrl}"\nexport { default } from "${framerModuleUrl}"`,
            { status: 200, headers: { 'content-type': 'text/javascript' } },
          );
        }
        assert.equal(url, framerModuleUrl);
        return new Response(
          'export default function PaintReveal(){return null}\n//# sourceMappingURL=https://evil.example/PaintReveal.map',
          { status: 200, headers: { 'content-type': 'text/javascript' } },
        );
      },
    }),
    error => error?.code === 'framer-source-map-origin',
  );
  await assert.rejects(
    framerImportModule.importFramerCodeComponentFromUrl(framerShareUrl, {
      fetch: async () => new Response('', {
        status: 200,
        headers: { 'content-type': 'text/javascript', 'content-length': '64001' },
      }),
    }),
    error => error?.code === 'framer-resource-too-large',
  );
  assert.equal(authoringModule.pastedCodeComponentPath('ASCII image 02'), 'code-components/ASCIIImage02.tsx');
  assert.throws(() => authoringModule.pastedCodeComponentPath('../Broken'), /sem pastas/);
  const authorProject = { name: 'authoring', mainHtmlPath: 'index.html', rootPath: '', openedAt: Date.now(), files: {
    'index.html': { path: 'index.html', mimeType: 'text/html', text: '<!doctype html><body></body>' },
    'Contract.tsx': { path: 'Contract.tsx', mimeType: 'text/tsx', text: source },
  } };
  const authored = await authoringModule.compileCodeComponentProjectFile(authorProject, 'Contract.tsx');
  assert.equal(authored.result.success, true, JSON.stringify(authored.result.diagnostics));
  assert.equal(authoringModule.registeredCodeComponents(authored.project).length, 1);
  const authoredPublication = authoringModule.registeredCodeComponents(authored.project)[0];
  assert.equal(authoredPublication.sourcePath, 'Contract.tsx');
  assert.equal(authoredPublication.bundleHash, authored.result.hash);
  const unchangedAuthored = await authoringModule.compileCodeComponentProjectFile(authored.project, 'Contract.tsx');
  assert.equal(
    unchangedAuthored.project,
    authored.project,
    'an identical successful bundle must not republish metadata or rebuild the canvas',
  );
  const productionBundle = await new nodeCompilerModule.NodeComponentCompiler().compile({ fileName: 'components/Contract.tsx', source, typeCheck: true, production: true, maxBundleBytes: 2_000_000 });
  assert.equal(productionBundle.success, true, JSON.stringify(productionBundle.diagnostics));
  assert.doesNotMatch(productionBundle.code, /from\s+["']@coday\//);
  assert.match(productionBundle.code, /mountCodayComponent/);

  const framerSource = `
import { addPropertyControls, ControlType, RenderTarget } from 'framer'
/** @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 * @framerIntrinsicWidth 480
 * @framerIntrinsicHeight 270
 */
type FramerButtonProps = { text: string; enabled: boolean; cover: { src: string; srcSet?: string; alt?: string }; font: Record<string, unknown>; destructured: string; always: string }
export default function FramerButton(props: FramerButtonProps) {
  return <button data-target={RenderTarget.current()} style={{ color: props.enabled ? '#fff' : '#777' }}>
    <img src={props.cover?.src} srcSet={props.cover?.srcSet} crossOrigin="anonymous" alt={props.cover?.alt || ''} />
    {props.text}
  </button>
}
FramerButton.defaultProps = {
  text: 'My Title',
  enabled: true,
  cover: { src: '', alt: 'Cover' },
  font: { fontSize: '16px', fontFamily: 'Inter' },
}
addPropertyControls(FramerButton, {
  enabled: { title: 'Enabled', type: ControlType.Boolean },
  text: { title: 'Text', type: ControlType.String, hidden: props => !props.enabled },
  cover: { title: 'Cover', type: ControlType.ResponsiveImage },
  font: { title: 'Font', type: ControlType.Font, hidden(props) { return props.enabled === false } },
  destructured: { title: 'Destructured', type: ControlType.String, hidden: ({ enabled }) => !enabled },
  always: { title: 'Always', type: ControlType.String, hidden: () => true },
})`;
  const framerCompiled = await new compilerModule.ComponentCompiler().compile({
    fileName: 'code-components/FramerButton.tsx',
    source: framerSource,
    typeCheck: true,
  });
  assert.equal(framerCompiled.success, true, JSON.stringify(framerCompiled.diagnostics));
  assert.ok(framerCompiled.dependencies.includes('framer'));
  assert.doesNotMatch(
    framerCompiled.code,
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/,
    'the executable hot-reload artifact must not depend on a bare framer module specifier',
  );
  assert.match(
    framerCompiled.code,
    /from\s+["']@coday\/components["']/,
    'the executable hot-reload artifact must bind Framer imports to the Kodety SDK',
  );
  assert.equal(framerCompiled.componentManifest.exportName, 'FramerButton');
  assert.equal(framerCompiled.componentManifest.defaultProps.text, 'My Title');
  assert.equal(framerCompiled.componentManifest.defaultProps.enabled, true);
  assert.equal(framerCompiled.componentManifest.controls.cover.type, 'image');
  assert.equal(framerCompiled.componentManifest.controls.cover.framerValueType, 'responsive-image');
  assert.equal(framerCompiled.componentManifest.controls.font.type, 'object');
  assert.equal(framerCompiled.componentManifest.controls.font.controls.fontFamily.type, 'string');
  assert.equal(framerCompiled.componentManifest.controls.font.controls.fontSize.type, 'string');
  assert.deepEqual(framerCompiled.componentManifest.sizing, {
    width: 'fixed',
    height: 'fixed',
    defaultWidth: 480,
    defaultHeight: 270,
    minWidth: 1,
    minHeight: 1,
  });
  assert.deepEqual(framerCompiled.componentManifest.controls.text.hidden, {
    property: 'enabled',
    operator: 'equals',
    value: false,
  });
  assert.deepEqual(framerCompiled.componentManifest.controls.font.hidden, {
    property: 'enabled',
    operator: 'equals',
    value: false,
  });
  assert.deepEqual(framerCompiled.componentManifest.controls.destructured.hidden, {
    property: 'enabled',
    operator: 'equals',
    value: false,
  });
  assert.equal(framerCompiled.componentManifest.controls.always.hidden, undefined);
  assert.ok(
    framerCompiled.diagnostics.some(item => item.code === 'framer-control-callback' && item.severity === 'warning'),
    'an unsupported Framer callback must be omitted with a warning instead of failing compilation',
  );
  assert.doesNotMatch(JSON.stringify(framerCompiled.componentManifest), /=>|function/);
  const framerAssetInstance = {
    schemaVersion: '1.0.0',
    id: 'paint-reveal-like-instance',
    componentId: framerCompiled.componentManifest.id,
    componentVersion: framerCompiled.componentManifest.version,
    props: {
      ...framerCompiled.componentManifest.defaultProps,
      cover: {
        id: 'assets/reveal image.png',
        src: 'assets/reveal image.png',
        srcSet: 'assets/reveal image.png 1x, assets/reveal image@2x.png 2x',
        alt: 'Reveal image',
        width: 1200,
        height: 800,
        focalPoint: { x: 0.4, y: 0.6 },
      },
    },
    responsiveProps: {}, bindings: {}, slots: {},
    sizing: { widthMode: 'fixed', heightMode: 'fixed', width: 480, height: 270 },
    metadata: {},
  };
  const framerAssetRuntime = projectModule.compileCodeComponentRuntime(
    `<!doctype html><body>${projectModule.codeComponentMarkup(framerAssetInstance)}</body>`,
    {
      schemaVersion: '1.0.0',
      components: [{
        id: framerCompiled.componentManifest.id,
        version: framerCompiled.componentManifest.version,
        schemaVersion: '1.0.0',
        bundle: framerCompiled.code,
        manifest: framerCompiled.componentManifest,
        publishedAt: new Date(0).toISOString(),
        author: 'Code Components test',
        dependencies: framerCompiled.dependencies,
      }],
      instances: [framerAssetInstance],
    },
  );
  assert.match(
    framerAssetRuntime,
    /"controls":\{"[^"@]+@[^"@]+":\{[\s\S]*?"cover":\{[\s\S]*?"type":"image"[\s\S]*?"framerValueType":"responsive-image"/,
    'the iframe runtime must carry the exact control schema needed to recognize Framer ResponsiveImage props',
  );
  assert.match(
    framerAssetRuntime,
    /__KODETY_RESOLVE_RUNTIME_ASSET_URL__[\s\S]*?resolveRuntimeAssetSrcSet[\s\S]*?descriptorMatch=normalized\.match[\s\S]*?next\.src=await resolveRuntimeAssetValue\(source\)[\s\S]*?next\.srcSet=await resolveRuntimeAssetSrcSet\(value\.srcSet\)/,
    'a PaintReveal-like crossOrigin image must receive iframe-owned src and srcSet URLs while retaining its object metadata',
  );
  assert.match(
    framerAssetRuntime,
    /const sequence=\(element\.__codayUpdateSequence\|\|0\)\+1[\s\S]*?await resolveBindings\(candidate,element,breakpoint\)[\s\S]*?element\.__codayUpdateSequence!==sequence/,
    'a slower first image resolution must be discarded when a second Inspector image wins the update sequence',
  );
  const sanitizedFramerControls = sdkModule.normalizeFramerPropertyControls({
    title: { type: sdkModule.ControlType.String, defaultValue: 'Hello', hidden: () => true },
    image: { type: sdkModule.ControlType.ResponsiveImage, defaultValue: '' },
    link: { type: sdkModule.ControlType.Link, defaultValue: 'https://example.com' },
    nativeLink: { type: sdkModule.ControlType.Link, defaultValue: { type: 'url', value: 'https://example.com' } },
  });
  assert.equal(sanitizedFramerControls.title.hidden, undefined);
  assert.equal(sanitizedFramerControls.image.type, 'image');
  assert.equal(sanitizedFramerControls.link.type, 'string');
  assert.equal(sanitizedFramerControls.nativeLink.type, 'link');
  const framerProduction = await new nodeCompilerModule.NodeComponentCompiler().compile({
    fileName: 'code-components/FramerButton.tsx',
    source: framerSource,
    typeCheck: true,
    production: true,
    maxBundleBytes: 2_000_000,
  });
  assert.equal(framerProduction.success, true, JSON.stringify(framerProduction.diagnostics));
  assert.doesNotMatch(framerProduction.code, /from\s+["']framer["']/);

  const framerIntroductionSource = `
import "./FramerHelper"
import { addPropertyControls, ControlType } from "framer"
export default function Button(props) {
  return <div style={{ display: "inline-block", backgroundColor: "orange", padding: 8 }}>{props.text}</div>
}
Button.defaultProps = { text: "My Title" }
addPropertyControls(Button, {
  text: { title: "Text", type: ControlType.String },
})`;
  const framerIntroduction = await new compilerModule.ComponentCompiler().compile({
    fileName: 'code-components/Button.tsx',
    source: framerIntroductionSource,
    sources: {
      'code-components/FramerHelper.ts': `
import { RenderTarget } from "framer"
export const importedRenderTarget = RenderTarget.current()
`,
    },
    typeCheck: true,
  });
  assert.equal(framerIntroduction.success, true, JSON.stringify(framerIntroduction.diagnostics));
  assert.equal(Object.keys(framerIntroduction.moduleGraph || {}).length, 1);
  assert.doesNotMatch(
    [framerIntroduction.code, ...Object.values(framerIntroduction.moduleGraph || {})].join('\n'),
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/,
    'every executable module emitted by the browser compiler must resolve the Framer compatibility facade at compile time',
  );
  assert.equal(framerIntroduction.componentManifest.defaultProps.text, 'My Title');
  assert.equal(framerIntroduction.componentManifest.controls.text.type, 'string');

  const framerAuthorProject = {
    name: 'framer-authoring-publication',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<!doctype html><body></body>' },
      'code-components/Button.tsx': {
        path: 'code-components/Button.tsx',
        mimeType: 'text/tsx',
        text: framerIntroductionSource,
      },
      'code-components/FramerHelper.ts': {
        path: 'code-components/FramerHelper.ts',
        mimeType: 'text/typescript',
        text: `
import { RenderTarget } from "framer"
export const importedRenderTarget = RenderTarget.current()
`,
      },
    },
  };
  const framerAuthored = await authoringModule.compileCodeComponentProjectFile(
    framerAuthorProject,
    'code-components/Button.tsx',
  );
  assert.equal(framerAuthored.result.success, true, JSON.stringify(framerAuthored.result.diagnostics));
  const [framerAuthoredComponent] = authoringModule.registeredCodeComponents(framerAuthored.project);
  assert.ok(framerAuthoredComponent, 'authoring compilation must register the Framer-compatible component');
  const legacyFramerSpecifier = sourceText => sourceText
    .replaceAll('"@coday/components"', '"framer"')
    .replaceAll("'@coday/components'", "'framer'");
  const legacyFramerAuthoredComponent = {
    ...framerAuthoredComponent,
    bundle: legacyFramerSpecifier(framerAuthoredComponent.bundle),
    moduleGraph: Object.fromEntries(Object.entries(framerAuthoredComponent.moduleGraph || {}).map(
      ([moduleName, moduleSource]) => [moduleName, legacyFramerSpecifier(moduleSource)],
    )),
  };
  assert.match(
    [legacyFramerAuthoredComponent.bundle, ...Object.values(legacyFramerAuthoredComponent.moduleGraph)].join('\n'),
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/,
    'the publication regression must exercise a bundle persisted before compile-time Framer aliasing',
  );
  const legacyLexicalFixture = 'const documentation = \'from "framer"\'; /* import "framer" */\nimport { ControlType } from "framer";';
  const normalizedLegacyLexicalFixture = projectModule.normalizeCodeComponentRuntimeModule(legacyLexicalFixture);
  assert.match(normalizedLegacyLexicalFixture, /documentation = 'from "framer"'/);
  assert.match(normalizedLegacyLexicalFixture, /\/\* import "framer" \*\//);
  assert.match(normalizedLegacyLexicalFixture, /from "@coday\/components"/);
  const framerPublicationRegistry = new registryModule.ComponentRegistry();
  framerPublicationRegistry.publish(legacyFramerAuthoredComponent);
  const framerPublishedInstance = framerPublicationRegistry.createInstance(
    framerAuthoredComponent.id,
    framerAuthoredComponent.version,
    { id: 'framer-publication-instance' },
  );
  const framerPlacedProject = {
    ...framerAuthored.project,
    files: {
      ...framerAuthored.project.files,
      'index.html': {
        ...framerAuthored.project.files['index.html'],
        text: `<!doctype html><body>${projectModule.codeComponentMarkup(framerPublishedInstance)}</body>`,
      },
    },
  };
  const framerPreparedPublication = projectModule.prepareCodeComponentProject(
    framerPlacedProject,
    framerPublicationRegistry.snapshot(),
  );
  const framerPublishedModules = Object.entries(framerPreparedPublication.files).filter(
    ([filePath, file]) => /^\.coday\/components\/.+\.mjs$/.test(filePath) && typeof file.text === 'string',
  );
  assert.equal(
    framerPublishedModules.length,
    2,
    'publication must materialize the authored entry bundle and its Framer sidecar',
  );
  framerPublishedModules.forEach(([filePath, file]) => {
    assert.doesNotMatch(
      file.text,
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/,
      `${filePath} must not publish a bare Framer module specifier`,
    );
  });
  assert.ok(
    (framerPreparedPublication.files['.coday/runtime/react.mjs']?.text || '').length > 10_000,
    'Framer-compatible publication must include the private Code Component runtime',
  );
  assert.match(
    framerPreparedPublication.files['index.html'].text,
    /data-coday-code-components-importmap[\s\S]*?"framer"[\s\S]*?data-coday-code-components-runtime/,
    'Framer-compatible publication must install its import map before the executable runtime',
  );
  const legacyFramerTransportProject = projectIoModule.updateEditorMetadata(
    framerPlacedProject,
    metadata => ({
      ...metadata,
      codeComponents: framerPublicationRegistry.snapshot(),
    }),
  );
  const assertFinalFramerPublicationArchive = async (archive, label) => {
    const modulePaths = Object.keys(archive.files).filter(filePath => (
      /^\.coday\/components\/.+\.mjs$/.test(filePath)
    ));
    assert.equal(modulePaths.length, 2, `${label} must carry the entry and sidecar modules`);
    for (const filePath of modulePaths) {
      const moduleSource = await archive.file(filePath).async('string');
      assert.doesNotMatch(
        moduleSource,
        /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])framer\1/,
        `${label}:${filePath} must migrate the legacy bare Framer specifier`,
      );
    }
    assert.ok(archive.file('.coday/runtime/react.mjs'), `${label} must carry the private runtime`);
    const html = await archive.file('index.html').async('string');
    assert.match(
      html,
      /data-coday-code-components-importmap[\s\S]*?"framer"[\s\S]*?data-coday-code-components-runtime/,
      `${label} must preserve the import map before the runtime script`,
    );
  };
  const legacyFramerPublishPackage = await projectIoModule.projectToPublishPackage(
    legacyFramerTransportProject,
    { fast: true },
  );
  await assertFinalFramerPublicationArchive(
    await JSZip.loadAsync(await legacyFramerPublishPackage.zip.arrayBuffer()),
    'full WordPress/export ZIP',
  );
  const legacyFramerOverlayPackage = await projectIoModule.projectToMaterializedPublishOverlayPackage(
    legacyFramerTransportProject,
    { fast: true },
  );
  await assertFinalFramerPublicationArchive(
    await JSZip.loadAsync(await legacyFramerOverlayPackage.zip.arrayBuffer()),
    'materialized WordPress overlay',
  );

  const shorthandSource = `
import React from 'react'
import { ControlType, defineComponent } from '@coday/components'
export default defineComponent(
  {
    id: 'kodety.analog-clock',
    name: 'Analog Clock',
    controls: { label: { type: ControlType.String, defaultValue: 'São Paulo' } }
  },
  function AnalogClock({ label }: { label: string }) { return <time>{label}</time> }
)`;
  const shorthandCompiled = await new compilerModule.ComponentCompiler().compile({
    fileName: 'code-components/AnalogClock.tsx',
    source: shorthandSource,
    typeCheck: true,
  });
  assert.equal(shorthandCompiled.success, true, JSON.stringify(shorthandCompiled.diagnostics));
  assert.equal(shorthandCompiled.componentManifest.name, 'Analog Clock');
  assert.equal(shorthandCompiled.componentManifest.exportName, 'AnalogClock');
  assert.doesNotMatch(shorthandCompiled.code, /createElement\(Analog Clock/);
  assert.match(shorthandCompiled.code, /getRegisteredComponent/);
  const shorthandProduction = await new nodeCompilerModule.NodeComponentCompiler().compile({
    fileName: 'code-components/AnalogClock.tsx',
    source: shorthandSource,
    typeCheck: true,
    production: true,
    maxBundleBytes: 2_000_000,
  });
  assert.equal(shorthandProduction.success, true, JSON.stringify(shorthandProduction.diagnostics));
  assert.doesNotMatch(shorthandProduction.code, /createElement\(Analog Clock/);

  const robustSource = await readFile(path.join(root, 'code-components/SmartPricingConfigurator.tsx'), 'utf8');
  const robustCompiled = await new compilerModule.ComponentCompiler().compile({
    fileName: 'code-components/SmartPricingConfigurator.tsx',
    source: robustSource,
    typeCheck: true,
  });
  assert.equal(robustCompiled.success, true, JSON.stringify(robustCompiled.diagnostics));
  assert.equal(robustCompiled.componentManifest.id, 'kodety.smart-pricing-configurator');
  assert.equal(Object.keys(robustCompiled.componentManifest.controls).length, 24);
  assert.deepEqual(
    [...new Set(Object.values(robustCompiled.componentManifest.controls).map(control => control.type))].sort(),
    ['array', 'boolean', 'border', 'color', 'date', 'effects', 'enum', 'file', 'image', 'layout', 'link', 'number', 'object', 'radius', 'shadow', 'spacing', 'string', 'text', 'typography'].sort(),
  );

  const agentBaseProject = projectIoModule.updateTextFile(
    projectIoModule.createBlankProject('agent-widgets'),
    'index.html',
    '<!doctype html><html><body><main><section data-label="Widgets"></section></main></body></html>',
  );
  const agentMapsManifest = {
    schemaVersion: '1.0.0',
    id: 'test.agent-maps',
    name: 'AgentMaps',
    displayName: 'Agent maps',
    version: '1.0.0',
    exportName: 'AgentMaps',
    controls: {
      title: { type: 'string', defaultValue: 'Title', bindable: true },
      subtitle: { type: 'string', defaultValue: 'Subtitle', bindable: true },
      gap: { type: 'number', defaultValue: 16, responsive: true },
      columns: { type: 'number', defaultValue: 3, responsive: true },
      lead: { type: 'slot', accepts: ['test.lead'] },
      items: { type: 'slots', accepts: ['test.item'], minCount: 1, maxCount: 3 },
    },
    defaultProps: { title: 'Title', subtitle: 'Subtitle', gap: 16, columns: 3 },
    sizing: { width: 'fixed', height: 'hug', defaultWidth: 320 },
    dependencies: [],
    capabilities: ['responsive', 'cms', 'slots'],
  };
  const agentMapsProject = projectIoModule.updateEditorMetadata(agentBaseProject, metadata => ({
    ...metadata,
    codeComponents: {
      schemaVersion: '1.0.0',
      components: [{
        id: agentMapsManifest.id,
        version: agentMapsManifest.version,
        schemaVersion: agentMapsManifest.schemaVersion,
        bundle: 'export const agentMapsFixture = true',
        manifest: agentMapsManifest,
        publishedAt: new Date(0).toISOString(),
        author: 'Code Components test',
        dependencies: [],
      }],
      instances: [],
    },
  }));
  const agentMapsInserted = await agentModule.applyCodeComponentAgentChanges(agentMapsProject, [{
    type: 'insertInstance',
    componentId: agentMapsManifest.id,
    pagePath: 'index.html',
    selectionPath: '0/0',
    placement: 'inside',
    responsiveProps: {
      gap: { base: 16, overrides: { mobile: 8 } },
      columns: { base: 3, overrides: { mobile: 1 } },
    },
    bindings: {
      title: { type: 'global-variable', sourceId: 'site', fieldId: 'title' },
      subtitle: { type: 'global-variable', sourceId: 'site', fieldId: 'subtitle' },
    },
    slots: {
      lead: { instanceId: 'lead-instance', layerId: '0', componentId: 'test.lead' },
      items: [{ instanceId: 'item-instance', layerId: '0', componentId: 'test.item' }],
    },
  }], { createInstanceId: () => 'agent-maps-instance' });
  const agentMapsUpdated = await agentModule.applyCodeComponentAgentChanges(agentMapsInserted.project, [{
    type: 'updateInstance',
    instanceId: 'agent-maps-instance',
    responsiveProps: { gap: { base: 20, overrides: { mobile: 10 } } },
    bindings: { title: { type: 'global-variable', sourceId: 'site', fieldId: 'headline' } },
    slots: { lead: { instanceId: 'new-lead-instance', layerId: '1', componentId: 'test.lead' } },
  }]);
  const agentMapsInstance = agentModule.codeComponentAgentSnapshot(agentMapsUpdated.project).instances[0];
  assert.deepEqual(Object.keys(agentMapsInstance.responsiveProps).sort(), ['columns', 'gap']);
  assert.equal(agentMapsInstance.responsiveProps.gap.overrides.mobile, 10);
  assert.equal(agentMapsInstance.responsiveProps.columns.overrides.mobile, 1);
  assert.deepEqual(Object.keys(agentMapsInstance.bindings).sort(), ['subtitle', 'title']);
  assert.equal(agentMapsInstance.bindings.title.fieldId, 'headline');
  assert.equal(agentMapsInstance.bindings.subtitle.fieldId, 'subtitle');
  assert.deepEqual(Object.keys(agentMapsInstance.slots).sort(), ['items', 'lead']);
  assert.equal(agentMapsInstance.slots.lead.instanceId, 'new-lead-instance');
  assert.equal(agentMapsInstance.slots.items[0].instanceId, 'item-instance');
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentMapsUpdated.project, [{
      type: 'updateInstance', instanceId: 'agent-maps-instance', responsiveProps: { title: { base: 'Nope' } },
    }]),
    /title.*não aceita valores responsivos/,
  );
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentMapsUpdated.project, [{
      type: 'updateInstance', instanceId: 'agent-maps-instance', responsiveProps: { gap: { base: 'wide' } },
    }]),
    /gap\.base: Esperado número finito/,
  );
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentMapsUpdated.project, [{
      type: 'updateInstance', instanceId: 'agent-maps-instance', bindings: {
        columns: { type: 'global-variable', sourceId: 'site', fieldId: 'columns' },
      },
    }]),
    /columns.*não aceita binding/,
  );
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentMapsUpdated.project, [{
      type: 'updateInstance', instanceId: 'agent-maps-instance', slots: {
        title: { instanceId: 'title-instance', layerId: '0' },
      },
    }]),
    /title.*não é um controle Slot\/Slots/,
  );
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentMapsUpdated.project, [{
      type: 'updateInstance', instanceId: 'agent-maps-instance', slots: {
        lead: { instanceId: 'agent-maps-instance', layerId: '0', componentId: 'test.lead' },
      },
    }]),
    /não pode referenciar a própria instância/,
  );
  const agentAuthored = await agentModule.applyCodeComponentAgentChanges(agentBaseProject, [{
    type: 'upsertSource',
    filePath: 'code-components/SmartPricingConfigurator.tsx',
    source: robustSource,
  }], { author: 'Kodety Agent test', createInstanceId: () => 'pricing-instance' });
  const authoredSnapshot = agentModule.codeComponentAgentSnapshot(agentAuthored.project, {}, {
    sourcePaths: ['code-components/SmartPricingConfigurator.tsx'],
  });
  assert.equal(authoredSnapshot.components[0].id, 'kodety.smart-pricing-configurator');
  assert.equal(authoredSnapshot.sources[0].source, robustSource);

  const agentInserted = await agentModule.applyCodeComponentAgentChanges(agentAuthored.project, [{
    type: 'insertInstance',
    componentId: 'kodety.smart-pricing-configurator',
    componentVersion: '1.0.0',
    pagePath: 'index.html',
    selectionPath: '0/0',
    placement: 'inside',
    props: { seats: 12, billing: 'monthly' },
    responsiveProps: { seats: { base: 12, overrides: { mobile: 3 } } },
  }], { createInstanceId: () => 'pricing-instance' });
  assert.equal(agentInserted.results[0].selectionPath, '0/0/0');
  assert.match(agentInserted.project.files['index.html'].text, /data-coday-code-instance="pricing-instance"/);
  let insertedSnapshot = agentModule.codeComponentAgentSnapshot(agentInserted.project);
  assert.equal(insertedSnapshot.instances[0].props.seats, 12);
  assert.equal(insertedSnapshot.instances[0].responsiveProps.seats.overrides.mobile, 3);

  const agentConfigured = await agentModule.applyCodeComponentAgentChanges(agentInserted.project, [{
    type: 'updateInstance',
    instanceId: 'pricing-instance',
    props: { seats: 18, accent: '#35d0a0' },
    sizing: { widthMode: 'fill', heightMode: 'hug' },
  }]);
  insertedSnapshot = agentModule.codeComponentAgentSnapshot(agentConfigured.project);
  assert.equal(insertedSnapshot.instances[0].props.seats, 18);
  assert.equal(insertedSnapshot.instances[0].props.accent, '#35d0a0');
  assert.match(agentConfigured.project.files['index.html'].text, /width:100%/);
  await assert.rejects(
    () => agentModule.applyCodeComponentAgentChanges(agentConfigured.project, [{ type: 'removeInstance', instanceId: 'pricing-instance' }]),
    /confirmDestructive/,
  );

  const registry = new registryModule.ComponentRegistry();
  registry.publish({ id: 'test.contract', version: '1.2.3', schemaVersion: '1.0.0', bundle: compiled.code, sourceMap: compiled.sourceMap, sourcePath: 'components/Contract.tsx', bundleHash: compiled.hash, manifest: compiled.componentManifest, publishedAt: new Date().toISOString(), author: 'test', dependencies: compiled.dependencies });
  const instance = registry.createInstance('test.contract');
  assert.equal(instance.props.title, 'Hello');
  registry.updateInstance(instance.id, current => ({ ...current, responsiveProps: { gap: { base: 31, overrides: { tablet: 18, mobile: 7 } } } }));
  registry.publish({ id: 'test.contract', version: '2.0.0', schemaVersion: '1.0.0', bundle: compiled.code, manifest: { ...compiled.componentManifest, version: '2.0.0' }, publishedAt: new Date().toISOString(), author: 'test', dependencies: [] });
  registry.registerMigration('test.contract', { from: '1.2.3', to: '2.0.0', migrateProps: props => { const { gap, ...rest } = props; return { ...rest, spacing: gap }; } });
  assert.equal(registry.previewUpgrade(instance.id, '2.0.0').incompatible, false);

  const history = new registryModule.TransactionHistory({ gap: 10 });
  history.beginTransaction('Change gap'); history.update({ gap: 20 }); history.update({ gap: 30 }); history.commitTransaction();
  assert.deepEqual(history.undo(), { gap: 10 }); assert.deepEqual(history.redo(), { gap: 30 });

  const snapshot = registry.snapshot();
  const marker = projectModule.codeComponentMarkup(instance);
  assert.match(marker, /style="position:relative;/, 'the component wrapper must contain absolutely-positioned widget content');
  assert.match(marker, /height:fit-content/);
  assert.match(marker, /min-height:1px/);
  const project = { name: 'test', mainHtmlPath: 'index.html', rootPath: '', openedAt: Date.now(), files: { 'index.html': { path: 'index.html', mimeType: 'text/html', text: `<!doctype html><body>${marker}</body>` } } };
  const runtimeBreakpoints = projectModule.toCodeComponentBreakpoints(
    { id: 'base', label: 'Primary', mode: 'max-width', width: 1920 },
    [{ id: 'tablet', label: 'Tablet', mode: 'max-width', width: 810 }, { id: 'mobile', label: 'Mobile', mode: 'max-width', width: 410 }],
  );
  const published = projectModule.prepareCodeComponentProject(project, snapshot, runtimeBreakpoints);
  assert.match(published.files['index.html'].text, /data-coday-code-components-runtime/);
  assert.match(
    published.files['index.html'].text,
    /data-coday-code-components-render-target[^>]*>globalThis\.__CODAY_RENDER_TARGET__ \|\|= 'preview';<\/script>[\s\S]*?data-coday-code-components-importmap[\s\S]*?data-coday-code-components-runtime/,
    'publication must establish Preview RenderTarget before any component module evaluates',
  );
  assert.match(published.files['index.html'].text, /data-coday-code-components-importmap/);
  assert.match(published.files['index.html'].text, /react\/jsx-runtime/);
  assert.match(published.files['index.html'].text, /@coday\/components/);
  assert.match(published.files['index.html'].text, /resolvedInstanceProps/);
  assert.match(
    published.files['index.html'].text,
    /coday:code-component-instance-update/,
    'the mounted runtime must accept direct Inspector updates without rebuilding the iframe',
  );
  assert.match(
    published.files['index.html'].text,
    /Promise\.all\(elements\.map\(element=>updateMounted\(element,value\)\)\)[\s\S]*?applied\.every\(Boolean\)[\s\S]*?instances\.set\(value\.id,value\)/,
    'the runtime must publish an instance snapshot only after every mounted root committed it',
  );
  assert.match(
    published.files['index.html'].text,
    /__codayUpdateSequence[\s\S]*?resolveBindings[\s\S]*?__codayUpdateSequence!==sequence/,
    'late async bindings must not overwrite a newer Property Control value',
  );
  assert.match(
    published.files['index.html'].text,
    /await element\.__codayMount\.update\(props,breakpoint\)[\s\S]*?coday:code-component-instance-rejected[\s\S]*?coday:code-component-instance-applied/,
    'the runtime must await React, restore rejected props, and ACK only a committed update',
  );
  assert.match(
    published.files['index.html'].text,
    /editorUpdateSequence[\s\S]*?updateMounted\(element,current\)[\s\S]*?code-component-instance-rejected/,
    'a render failure must roll every duplicate mount back to the previous instance',
  );
  assert.match(published.files['index.html'].text, /"responsiveProps":\{"gap":\{"base":31/);
  assert.match(published.files['index.html'].text, /"id":"mobile","width":410,"mode":"max-width","parentId":"tablet"/);
  assert.ok((published.files['.coday/runtime/react.mjs']?.text || '').length > 10_000);
  assert.ok(Object.keys(published.files).some(file => file === `.coday/components/test.contract/1.2.3.${compiled.hash.slice(0, 16)}.mjs`));

  const legacyImageInstance = {
    schemaVersion: '1.0.0', id: 'legacy-image-instance', componentId: 'test.legacy-image', componentVersion: '1.0.0',
    props: { image: uploadedImage }, responsiveProps: {}, bindings: {}, slots: {},
    sizing: { widthMode: 'fixed', heightMode: 'fixed', width: 320, height: 180 }, metadata: {},
  };
  const legacyImageRuntime = projectModule.compileCodeComponentRuntime(
    `<!doctype html><body>${projectModule.codeComponentMarkup(legacyImageInstance)}</body>`,
    {
      schemaVersion: '1.0.0',
      components: [{
        id: 'test.legacy-image', version: '1.0.0', schemaVersion: '1.0.0', bundle: 'export const noop = true',
        manifest: {
          schemaVersion: '1.0.0', id: 'test.legacy-image', name: 'LegacyImage', displayName: 'Legacy Image',
          version: '1.0.0', exportName: 'LegacyImage', controls: { image: { type: 'image', defaultValue: './legacy.svg' } },
          defaultProps: { image: './legacy.svg' }, sizing: { width: 'fixed', height: 'fixed' }, dependencies: [], capabilities: ['assets'],
        },
        publishedAt: new Date().toISOString(), author: 'test', dependencies: [],
      }],
      instances: [legacyImageInstance],
    },
  );
  assert.match(legacyImageRuntime, /"props":\{"image":"assets\/upload\.svg"\}/);
  assert.doesNotMatch(legacyImageRuntime, /"props":\{"image":\{"id":"assets\/upload\.svg"/);
  assert.match(legacyImageRuntime, /:where\(\[data-coday-code-instance\]\)\{position:relative\}/);

  const nestedProject = { ...project, mainHtmlPath: 'site/index.html', rootPath: 'site', files: { 'site/index.html': { path: 'site/index.html', mimeType: 'text/html', text: `<!doctype html><body>${marker}</body>` } } };
  const nestedPublished = projectModule.prepareCodeComponentProject(nestedProject, snapshot, runtimeBreakpoints);
  assert.ok((nestedPublished.files['site/.coday/runtime/react.mjs']?.text || '').length > 10_000);
  assert.ok(Object.keys(nestedPublished.files).some(file => file.startsWith('site/.coday/components/test.contract/')));
  assert.match(nestedPublished.files['site/index.html'].text, /from "\.\/\.coday\/components\/test\.contract\//);

  const experimentPrefix = '.incode/experiments/home-test/variant-b/project/';
  const experimentProject = {
    ...project,
    files: {
      ...project.files,
      [`${experimentPrefix}index.html`]: {
        path: `${experimentPrefix}index.html`,
        mimeType: 'text/html',
        text: `<!doctype html><body>${marker}</body>`,
      },
    },
  };
  const experimentPublished = projectModule.prepareCodeComponentProject(
    experimentProject,
    snapshot,
    runtimeBreakpoints,
  );
  assert.ok(
    (experimentPublished.files[`${experimentPrefix}.coday/runtime/react.mjs`]?.text || '').length > 10_000,
    'each private variant must carry a relocatable local Code Component runtime',
  );
  assert.ok(
    Object.keys(experimentPublished.files)
      .some(file => file.startsWith(`${experimentPrefix}.coday/components/test.contract/`)),
    'each private variant must carry its component modules',
  );
  assert.match(
    experimentPublished.files[`${experimentPrefix}index.html`].text,
    /from "\.\/\.coday\/components\/test\.contract\//,
    'variant imports must remain valid after `.incode` is relocated to the runtime namespace',
  );
  assert.doesNotMatch(
    experimentPublished.files[`${experimentPrefix}index.html`].text,
    /(?:\.\.\/){2,}\.coday\/components/,
  );

  const transportProject = {
    ...project,
    files: {
      ...project.files,
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          mainHtmlPath: 'index.html',
          rootPath: '',
          primaryBreakpoint: { id: 'legacy-desktop', label: 'Desktop', width: 1440 },
          breakpoints: [{ id: 'mobile', label: 'Phone', width: 390 }],
          codeComponents: snapshot,
        }),
      },
    },
  };
  const publishPackage = await projectIoModule.projectToPublishPackage(transportProject, { fast: true });
  assert.match(publishPackage.cssDigest, /^[a-f0-9]{64}$/);
  const publishZip = await JSZip.loadAsync(await publishPackage.zip.arrayBuffer());
  assert.ok(publishZip.file('.coday/runtime/react.mjs'));
  const publishedHtml = await publishZip.file('index.html').async('string');
  assert.match(publishedHtml, /data-coday-code-components-runtime/);
  assert.match(publishedHtml, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(
    publishedHtml,
    /"id":"mobile","width":390,"mode":"max-width","parentId":"base"/,
    'published Code Components must consume the same normalized Mobile registry as the canvas',
  );

  console.log('Code Components contract tests passed');
} finally {
  await server.close();
}
