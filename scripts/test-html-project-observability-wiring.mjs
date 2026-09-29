import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const editorSource = readFileSync(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);

function extractSection(startMarker, endMarker) {
  const start = editorSource.indexOf(startMarker);
  const end = editorSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing ${startMarker} integration section`);
  return editorSource.slice(start, end);
}

function assertAllProjectResponseBodyReadsObserved(source) {
  const allReads = [...source.matchAll(/response\.(blob|json)\(\)/g)]
    .map(match => match[1]);
  assert.deepEqual(
    allReads,
    ['json', 'blob', 'json'],
    'the project download must contain exactly the legacy-error, ZIP and legacy-success body reads',
  );

  const observedReadPattern = /observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.(blob|json)\(\),\s*\)/g;
  const observedReads = [...source.matchAll(observedReadPattern)]
    .map(match => match[1]);
  assert.deepEqual(
    observedReads,
    allReads,
    'every project response body read must be the signal-aware callback of its observer',
  );
  assert.doesNotMatch(
    source.replace(observedReadPattern, ''),
    /response\.(?:blob|json)\(\)/,
    'no direct or discarded project response body read may survive outside the observer',
  );
}

const bodyObserver = extractSection(
  'async function observeWordPressProjectDownloadBody',
  'function observeWordPressProjectDownloadCacheHit',
);
assert.match(
  bodyObserver,
  /bridge\?\.begin\('project_download_body', cache\)[\s\S]*?const result = await readBody\(\);[\s\S]*?bridge\?\.finish\(token, 'ok'\);/,
  'the body phase must include only the actual body read and close successfully once',
);
assert.match(
  bodyObserver,
  /catch \(error\) \{[\s\S]*?wordPressProjectPhaseFailureOutcome\(error, signal\)[\s\S]*?throw error;/,
  'body errors must emit only a technical outcome and preserve the original rejection',
);

const download = extractSection(
  'async function downloadWordPressProjectSnapshot(',
  'const HtmlCmsManager = lazy(',
);
const responseIndex = download.indexOf('const response = await fetch(');
const startIndex = download.indexOf(
  "projectObservability?.start(response.headers.get('X-Kodety-Operation-Id'));",
);
const cacheBranchIndex = download.indexOf('if (response.status === 304 && reusableCache)');
assert.ok(
  responseIndex >= 0 && startIndex > responseIndex && cacheBranchIndex > startIndex,
  'the lifecycle must start from the response operation id before any cache/body branch',
);
assert.match(
  download,
  /if \(response\.status === 304 && reusableCache\) \{\s*observeWordPressProjectDownloadCacheHit\(projectObservability\);/,
  'a real 304 must record a content-free cache hit without opening unzip/parse',
);
assertAllProjectResponseBodyReadsObserved(download);
assert.match(
  download,
  /if \(!response\.ok\) \{[\s\S]*?const payload = !binaryDownload[\s\S]*?observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.json\(\),\s*\)\.catch\(\(\) => null\)/,
  'the non-binary error payload must read JSON inside the observed body phase',
);
assert.match(
  download,
  /if \(binaryDownload\) \{[\s\S]*?const archive = await observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.blob\(\),\s*\);/,
  'the ZIP payload must read its blob inside the observed body phase',
);
assert.match(
  download,
  /const payload = \(await observeWordPressProjectDownloadBody\(\s*projectObservability,\s*bodyCacheState,\s*signal,\s*\(\) => response\.json\(\),\s*\)\) as/,
  'the legacy success payload must read JSON inside the observed body phase',
);
const bodyReadMutationMarker = 'const projectObservability = wordpressProjectObservabilityBridge();';
assert.ok(download.includes(bodyReadMutationMarker));
assert.throws(
  () => assertAllProjectResponseBodyReadsObserved(download.replace(
    bodyReadMutationMarker,
    `void response.blob();\n  ${bodyReadMutationMarker}`,
  )),
  /exactly the legacy-error, ZIP and legacy-success body reads/,
  'the guard must reject a discarded body read injected before the cache-hit branches',
);
assert.doesNotMatch(
  download,
  /project_(?:unzip|parse)/,
  'the editor boundary must not duplicate importer-owned phases',
);

const visualBegin = extractSection(
  'const beginWordPressFirstCanvasVisualReady = useCallback(',
  '  useEffect(\n    () => () => finishWordPressFirstCanvasVisualReady',
);
assert.match(
  visualBegin,
  /finishWordPressFirstCanvasVisualReady\('aborted'\);[\s\S]*?bridge\?\.begin\('project_first_canvas_visual_ready', 'bypass'\)[\s\S]*?minimumRevision: projectRevisionRef\.current/,
  'a newer project lifecycle must abort the old token and bind readiness to its revision floor',
);

const iframeLoad = extractSection(
  'const handleEditorCanvasIframeLoad = (',
  '  const acceptEditorVisualReady = (',
);
assert.doesNotMatch(
  iframeLoad,
  /finishWordPressFirstCanvasVisualReady|project_first_canvas_visual_ready/,
  'iframe load must never masquerade as visual readiness',
);

const strongReady = extractSection(
  'const handleEditorInitialVisualReady = (',
  '  const handleRuntimePreviewIframeLoad = (',
);
assert.match(
  strongReady,
  /if \(!acceptEditorVisualReady\(node, generation, revision, surfaceKey\)\) return false;[\s\S]*?revision >= observation\.minimumRevision[\s\S]*?finishWordPressFirstCanvasVisualReady\('ok'\);/,
  'only the validated strong signal for the applied revision may finish first visual readiness',
);

const promotion = extractSection(
  'const handleEditorCanvasPromotion = (',
  '  const handleRuntimePreviewPromotion = (',
);
assert.doesNotMatch(
  promotion,
  /finishWordPressFirstCanvasVisualReady|project_first_canvas_visual_ready/,
  'ordinary promotion/reactivation must not finish the strong-signal phase',
);

console.log('HTML project observability wiring passed.');
