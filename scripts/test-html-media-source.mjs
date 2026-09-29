import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inspectorPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlInspector.tsx',
);
const editorPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx',
);
const uploadHelperPath = path.join(root, 'lib/html-editor/media-upload.ts');
const packagePath = path.join(root, 'package.json');
const [inspectorSource, editorSource, uploadHelperSource, packageSource] = await Promise.all([
  readFile(inspectorPath, 'utf8'),
  readFile(editorPath, 'utf8'),
  readFile(uploadHelperPath, 'utf8'),
  readFile(packagePath, 'utf8'),
]);

function boundedSource(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${label} must have a start marker`);
  assert.notEqual(end, -1, `${label} must have an end marker`);
  return source.slice(start, end);
}

function assertOrdered(source, snippets, label) {
  let cursor = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor + 1);
    assert.notEqual(next, -1, `${label} is missing ${snippet}`);
    assert.ok(next > cursor, `${label} must keep ${snippet} in order`);
    cursor = next;
  }
}

const mediaSourceRow = boundedSource(
  inspectorSource,
  'function MediaSourceRow({',
  '\nfunction CombinedTextEditor(',
  'MediaSourceRow',
);
const uploadApplication = boundedSource(
  editorSource,
  '  const uploadMediaAsset = async (file: File): Promise<string> => {',
  '\n  const uploadHtmlComponentAsset = async (',
  'uploadMediaAsset',
);
const assetSelection = boundedSource(
  editorSource,
  '  const selectMediaAsset = (path: string) => {',
  '\n  const uploadMediaAsset = async (',
  'selectMediaAsset',
);
const currentAssetResolution = boundedSource(
  editorSource,
  '  const currentMediaAssetPath = useMemo(() => {',
  '\n  const canvasLockedPaths = useMemo(',
  'currentMediaAssetPath',
);

assert.match(
  inspectorSource,
  /import \{[\s\S]*?readClipboardImageFile[\s\S]*?\} from '@\/lib\/html-editor\/media-clipboard';/,
  'the media picker must use the dedicated binary clipboard reader',
);
assert.match(
  mediaSourceRow,
  /const applyUploadedFile = async \(file: File\) => \{\s*const uploadedAssetPath = await onUpload\(file\);[\s\S]*?onAssetSelect\(uploadedAssetPath\);[\s\S]*?setOpen\(false\);\s*\};/,
  'file selection and clipboard paste must install and select the uploaded asset before closing',
);
assert.equal(
  (mediaSourceRow.match(/\bonUpload\(file\)/g) || []).length,
  1,
  'MediaSourceRow must dispatch exactly one upload through the shared path',
);
assert.match(
  mediaSourceRow,
  /const uploadSelectedFile = async[\s\S]*?await applyUploadedFile\(file\)/,
  'the file input must await the shared apply path',
);
assert.match(
  mediaSourceRow,
  /const pasteClipboardImage = async[\s\S]*?mediaKind !== 'image'[\s\S]*?await readClipboardImageFile\(\)[\s\S]*?await applyUploadedFile\(file\)/,
  'the image-only clipboard action must await the same apply path',
);
assert.match(
  mediaSourceRow,
  /mediaKind === 'image'[\s\S]*?data-media-clipboard-paste[\s\S]*?aria-label="Colar aqui"[\s\S]*?<ClipboardPaste[\s\S]*?Colar aqui/,
  'the image picker must expose an accessible clipboard button',
);
assert.match(
  mediaSourceRow,
  /data-media-upload-trigger[\s\S]*?onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\}/,
  'the visible upload action must open the persistent file input',
);
assert.match(
  mediaSourceRow,
  /data-media-upload-input[\s\S]*?disabled=\{mediaBusy\}[\s\S]*?void uploadSelectedFile\(file\)/,
  'the file input must block duplicate uploads and dispatch the selected file',
);
const popoverEnd = mediaSourceRow.indexOf('</YcodePopover>');
const uploadInput = mediaSourceRow.indexOf('data-media-upload-input');
assert.ok(popoverEnd >= 0 && uploadInput > popoverEnd,
  'the native file input must stay mounted outside the popover portal');
assert.equal(
  (mediaSourceRow.match(/data-media-upload-input/g) || []).length,
  1,
  'MediaSourceRow must own exactly one persistent native file input',
);
assert.doesNotMatch(
  mediaSourceRow,
  /clipboard\.readText|URL\.createObjectURL/,
  'clipboard media must not fall back to text or a temporary object URL',
);
assert.match(
  inspectorSource,
  /if \(cmsAvailable && cmsMediaSourceBinding\) return uploadCmsPropertyImage\(file\);\s*return onMediaUpload\(file\);/,
  'CMS and project media must return their canonical async upload pipeline',
);
assert.match(
  editorSource,
  /onMediaUpload=\{uploadMediaAsset\}/,
  'the inspector must receive the upload Promise instead of a detached fire-and-forget wrapper',
);

assertOrdered(uploadApplication, [
  'await addAssetForActiveDocument(base, file)',
  'latest.mainHtmlPath !== activePath',
  'rebaseUploadedProjectAsset(base, created, latest)',
  'commitProject(uploaded.project, false, false, true, false)',
  'const runtimeFrames = new Set<Window>()',
  'sendRuntimeAssetBatchToFrame(frame, [uploaded.storagePath], uploaded.project)',
  'return uploaded.publicPath',
], 'uploadMediaAsset');
assert.match(
  uploadApplication,
  /passiveCanvasFramesRef\.current\.forEach\(frame => runtimeFrames\.add\(frame\)\)/,
  'a newly uploaded image must be installed in active and retained breakpoint canvases',
);
assert.match(
  assetSelection,
  /const current = projectRef\.current;[\s\S]*?updateMediaSource\(relativePageHref\(current\.mainHtmlPath, experimentStoragePath\(current, path\)\)\)/,
  'automatic selection must reuse the same source-update path as a manual asset click',
);
assert.doesNotMatch(
  uploadApplication,
  /patchMediaSource|commitLocaleElementOverride|setSelection/,
  'the upload stage must not maintain a second source-application implementation',
);
assertOrdered(uploadHelperSource, [
  'rebaseProducedProjectFiles(base, created.project, latest)',
  'rebased.pathMap[created.storagePath] || created.storagePath',
  'activeExperimentEditSession(rebased.project)',
  'experimentPublicEditPath(session, storagePath)',
], 'rebaseUploadedProjectAsset');
assert.match(
  uploadHelperSource,
  /return \{\s*project: rebased\.project,\s*publicPath,\s*storagePath,/,
  'the upload helper must return the exact installed public and storage paths',
);
assert.match(
  currentAssetResolution,
  /selection\?\.attributes\.src[\s\S]*?resolveProjectPath[\s\S]*?selection\.attributes\.src[\s\S]*?projectPublicFilePath/,
  'the applied src must drive the selected asset check and preview',
);

const packageJson = JSON.parse(packageSource);
assert.equal(
  packageJson.scripts['html-media-source:test'],
  'node scripts/test-html-media-source.mjs',
  'the focused media-source regression must have a stable package script',
);
assert.match(
  packageJson.scripts['html-editor:test'],
  /npm run html-media-source:test/,
  'the HTML editor gate must execute the media-source regression',
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
    rebaseUploadedProjectAsset,
  } = await server.ssrLoadModule('/lib/html-editor/media-upload.ts');
  const {
    patchMediaSource,
  } = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
  const {
    ClipboardImageReadError,
    readClipboardImageFile,
  } = await server.ssrLoadModule('/lib/html-editor/media-clipboard.ts');

  const baseProject = {
    name: 'media-upload-fixture',
    openedAt: 1,
    mainHtmlPath: 'index.html',
    rootPath: '',
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<img src="old.png">',
      },
    },
  };
  const producedBytes = Uint8Array.of(1, 2, 3, 4);
  const createdAsset = {
    storagePath: 'assets/hero.png',
    project: {
      ...baseProject,
      files: {
        ...baseProject.files,
        'assets/hero.png': {
          path: 'assets/hero.png',
          mimeType: 'image/png',
          data: producedBytes,
        },
      },
    },
  };
  const latestProject = {
    ...baseProject,
    files: {
      ...baseProject.files,
      'assets/hero.png': {
        path: 'assets/hero.png',
        mimeType: 'image/png',
        data: Uint8Array.of(9),
      },
      'notes.txt': {
        path: 'notes.txt',
        mimeType: 'text/plain',
        text: 'concurrent edit',
      },
    },
  };
  const rebasedUpload = rebaseUploadedProjectAsset(
    baseProject,
    createdAsset,
    latestProject,
  );
  assert.equal(rebasedUpload.publicPath, 'assets/hero-2.png');
  assert.equal(rebasedUpload.storagePath, 'assets/hero-2.png');
  assert.deepEqual(
    rebasedUpload.project.files['assets/hero-2.png'].data,
    producedBytes,
    'the exact uploaded binary must be installed at the collision-safe path',
  );
  assert.equal(
    rebasedUpload.project.files['notes.txt'].text,
    'concurrent edit',
    'unrelated project changes must survive an async media upload',
  );

  const patchedPlaceholder = patchMediaSource(
    '<img data-kodety-empty-image aria-label="Image placeholder" style="display: block; background-color: #eeeeee; background-image: repeating-linear-gradient(135deg, transparent 0 20px, white 20px 22px); object-fit: cover;">',
    '0',
    'assets/bike.jpg',
  );
  assert.match(patchedPlaceholder, /src="assets\/bike\.jpg"/);
  assert.doesNotMatch(
    patchedPlaceholder,
    /repeating-linear-gradient|data-kodety-empty-image|aria-label="Image placeholder"/,
    'applying a real image must remove the striped empty-image placeholder',
  );
  assert.match(
    patchedPlaceholder,
    /background-color:\s*#eeeeee[;\s]/,
    'placeholder cleanup must preserve unrelated fallback paint',
  );
  assert.match(patchedPlaceholder, /object-fit:\s*cover\b/);
  const patchedPicture = patchMediaSource(
    '<picture><source srcset="old.webp 1x" style="color-scheme: dark"><img data-kodety-empty-image style="background-image: repeating-linear-gradient(135deg, transparent, white)"></picture>',
    '0/1',
    'assets/bike.jpg',
  );
  assert.match(
    patchedPicture,
    /<source style="color-scheme: dark">/,
    'cleaning the img placeholder must not copy its style onto picture sources',
  );

  let readCalls = 0;
  let requestedType = '';
  const pngBytes = Uint8Array.of(137, 80, 78, 71);
  const pngFile = await readClipboardImageFile({
    clipboard: {
      async read() {
        readCalls += 1;
        return [{
          types: ['text/plain', 'image/png'],
          async getType(type) {
            requestedType = type;
            return new Blob([pngBytes], { type });
          },
        }];
      },
    },
    now: () => Date.parse('2026-08-30T12:34:56.789Z'),
  });
  assert.equal(readCalls, 1, 'one click must read the clipboard exactly once');
  assert.equal(requestedType, 'image/png', 'the first image MIME must be requested');
  assert.equal(pngFile.type, 'image/png');
  assert.equal(pngFile.lastModified, Date.parse('2026-08-30T12:34:56.789Z'));
  assert.equal(
    pngFile.name,
    'clipboard-image-2026-08-30T12-34-56-789Z.png',
    'clipboard images must receive a safe deterministic filename',
  );
  assert.deepEqual(new Uint8Array(await pngFile.arrayBuffer()), pngBytes);

  const jpegFile = await readClipboardImageFile({
    clipboard: {
      async read() {
        return [
          { types: ['text/plain'], async getType() { throw new Error('must not read text'); } },
          {
            types: ['image/jpeg', 'image/png'],
            async getType(type) { return new Blob(['jpeg'], { type }); },
          },
        ];
      },
    },
    now: () => 0,
  });
  assert.equal(jpegFile.type, 'image/jpeg');
  assert.match(jpegFile.name, /\.jpg$/);

  const expectCode = async (promise, code) => {
    await assert.rejects(promise, error => (
      error instanceof ClipboardImageReadError && error.code === code
    ));
  };
  await expectCode(readClipboardImageFile({ clipboard: null }), 'unsupported');
  await expectCode(readClipboardImageFile({
    clipboard: { async read() { return [{ types: ['text/plain'], async getType() { return new Blob(); } }]; } },
  }), 'empty');
  await expectCode(readClipboardImageFile({
    clipboard: {
      async read() {
        const error = new Error('permission denied');
        error.name = 'NotAllowedError';
        throw error;
      },
    },
  }), 'denied');
  await expectCode(readClipboardImageFile({
    clipboard: {
      async read() {
        return [{ types: ['image/webp'], async getType() { throw new Error('decode failed'); } }];
      },
    },
  }), 'unreadable');
} finally {
  await server.close();
}

console.log('HTML media upload and clipboard contract passed.');
