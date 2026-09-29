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

const confirmationSource = extractSection(
  'const confirmReferencedAssetRemoval = (',
  '  const removeFile = (',
);
assert.match(
  confirmationSource,
  /reference\.label[\s\S]*?reference\.filePath[\s\S]*?reference\.detail/,
  'destructive confirmation must list each deterministic label, origin file and detail',
);

const handlers = [
  [
    'file tree',
    extractSection('const removeFile = (', '  const removeVisibleFile = ('),
  ],
  [
    'asset panel',
    extractSection('const removeAsset = (', '  const createPage = ('),
  ],
];

for (const [label, source] of handlers) {
  const guard = source.indexOf('projectAssetRemovalGuard(');
  const confirmation = source.indexOf('confirmReferencedAssetRemoval(');
  const latestSnapshot = source.indexOf('projectRef.current', confirmation);
  const revalidation = source.indexOf('projectAssetRemovalGuard(', guard + 1);
  const decision = source.indexOf('if (!decision.allowed) return;', revalidation);
  const removal = source.indexOf('removeProjectFile(', decision);
  assert.ok(
    guard >= 0
      && confirmation > guard
      && latestSnapshot > confirmation
      && revalidation > latestSnapshot
      && decision > revalidation
      && removal > decision,
    `${label} removal must order guard, explicit confirmation, latest-snapshot revalidation and mutation`,
  );
  assert.doesNotMatch(
    source.slice(guard, decision + 'if (!decision.allowed) return;'.length),
    /text\?*\.includes|toast\.success|commitProject\(/,
    `${label} cancellation must not mutate, persist or announce success`,
  );
}

assert.doesNotMatch(
  handlers.map(([, source]) => source).join('\n'),
  /text\?*\.includes/,
  'asset deletion must not keep a string-includes detector as a second source of truth',
);

console.log('HTML asset removal guard wiring passed.');
