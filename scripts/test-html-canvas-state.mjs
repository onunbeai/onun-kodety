import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const editorSource = readFileSync(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  'utf8',
);
const previewSource = readFileSync(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
const liveDomHelpersSource = readFileSync(
  path.join(root, 'lib/html-editor/editor-live-dom-helpers.ts'),
  'utf8',
);
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

function pathsById(sourcePatcher, html) {
  return new Map(
    sourcePatcher
      .inspectSourceElements(html)
      .filter(element => element.attributes.id)
      .map(element => [element.attributes.id, element.path]),
  );
}

function assertPathsFollowRemap(sourcePatcher, before, after, remapPath, removedIds = []) {
  const beforePaths = pathsById(sourcePatcher, before);
  const afterPaths = pathsById(sourcePatcher, after);
  const removed = new Set(removedIds);
  beforePaths.forEach((pathBefore, id) => {
    const expected = remapPath(pathBefore);
    if (removed.has(id)) {
      assert.equal(expected, null, `${id} must lose its positional address`);
      assert.equal(afterPaths.has(id), false, `${id} must be absent after the mutation`);
      return;
    }
    assert.equal(afterPaths.get(id), expected, `${id} must keep its identity through the path transaction`);
  });
}

try {
  const sourcePatcher = await server.ssrLoadModule('/lib/html-editor/source-patcher.ts');
  const canvasProtocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');
  const fixture = `<!doctype html><html><body>
  <main id="main">
    <section id="hero"><h1 id="title">Title</h1><p id="lead">Lead</p></section>
    <section id="features"><article id="feature-a">A</article><article id="feature-b">B</article></section>
    <footer id="footer">Footer</footer>
  </main>
  <aside id="aside"><span id="badge">Badge</span></aside>
</body></html>`;

  const moved = sourcePatcher.patchMoveElement(fixture, '0/0/1', '0/1/0', 'before');
  assert.equal(moved.path, '0/1/0');
  assertPathsFollowRemap(
    sourcePatcher,
    fixture,
    moved.source,
    pathBefore => sourcePatcher.remapPathAfterMove(pathBefore, '0/0/1', moved.path),
  );
  const lockedBeforeMove = ['title', 'feature-b', 'footer']
    .map(id => pathsById(sourcePatcher, fixture).get(id));
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths(
      lockedBeforeMove,
      pathBefore => sourcePatcher.remapPathAfterMove(pathBefore, '0/0/1', moved.path),
    ),
    ['title', 'feature-b', 'footer'].map(id => pathsById(sourcePatcher, moved.source).get(id)),
    'locked layers must stay attached to element identity after a positional move',
  );

  const codeComponentFixture = `<!doctype html><html><body>
  <section id="origin"><div data-coday-code-component="test.card" data-coday-code-version="1.0.0" data-coday-code-instance="instance-card"></div></section>
  <section id="destination"><p id="destination-copy">Copy</p></section>
</body></html>`;
  const movedCodeComponent = sourcePatcher.patchMoveElement(
    codeComponentFixture,
    '0/0',
    '1',
    'inside',
  );
  assert.equal(movedCodeComponent.path, '1/1', 'cross-section move must calculate the new parent path');
  assert.equal(
    movedCodeComponent.movedAttributes['data-coday-code-instance'],
    'instance-card',
    'the patcher must expose identity from the exact moved source root',
  );
  const movedCodeComponentNodes = sourcePatcher.inspectSourceElements(movedCodeComponent.source)
    .filter(element => element.attributes['data-coday-code-instance'] === 'instance-card');
  assert.equal(movedCodeComponentNodes.length, 1, 'a cross-section move must not duplicate the runtime identity');
  assert.equal(movedCodeComponentNodes[0].path, movedCodeComponent.path);
  assert.equal(
    sourcePatcher.remapPathAfterMove('0/0', '0/0', movedCodeComponent.path),
    movedCodeComponent.path,
    'selection must follow the Code Component root into its new section',
  );

  const inserted = sourcePatcher.patchInsertAdjacentElement(
    fixture,
    '0/1',
    '<section id="inserted">Inserted</section>',
    'before',
  );
  assert.equal(pathsById(sourcePatcher, inserted.source).get('inserted'), inserted.path);
  assertPathsFollowRemap(
    sourcePatcher,
    fixture,
    inserted.source,
    pathBefore => sourcePatcher.remapPathAfterInsert(pathBefore, inserted.path),
  );

  const removedPath = '0/0/0';
  const removed = sourcePatcher.patchRemoveElement(fixture, removedPath);
  assertPathsFollowRemap(
    sourcePatcher,
    fixture,
    removed,
    pathBefore => sourcePatcher.remapPathAfterRemove(pathBefore, removedPath),
    ['title'],
  );

  const wrappedPath = '0/1';
  const wrapped = sourcePatcher.patchWrapElement(fixture, wrappedPath);
  assertPathsFollowRemap(
    sourcePatcher,
    fixture,
    wrapped.source,
    pathBefore => sourcePatcher.remapPathAfterWrap(pathBefore, wrappedPath),
  );

  const wrappedChildCount = sourcePatcher.getElementChildCount(fixture, wrappedPath);
  const unwrapped = sourcePatcher.patchUnwrapElement(fixture, wrappedPath);
  assertPathsFollowRemap(
    sourcePatcher,
    fixture,
    unwrapped.source,
    pathBefore => sourcePatcher.remapPathAfterUnwrap(pathBefore, wrappedPath, wrappedChildCount),
    ['features'],
  );

  const textOnlyFixture = `<!doctype html><html><body>
  <p id="text-wrapper">Plain text</p>
  <section id="after-text"><span id="after-text-child">Still selectable</span></section>
</body></html>`;
  const textOnlyPath = '0';
  const textOnlyChildCount = sourcePatcher.getElementChildCount(textOnlyFixture, textOnlyPath);
  assert.equal(textOnlyChildCount, 0);
  const textOnlyUnwrapped = sourcePatcher.patchUnwrapElement(textOnlyFixture, textOnlyPath);
  assertPathsFollowRemap(
    sourcePatcher,
    textOnlyFixture,
    textOnlyUnwrapped.source,
    pathBefore => sourcePatcher.remapPathAfterUnwrap(
      pathBefore,
      textOnlyPath,
      textOnlyChildCount,
    ),
    ['text-wrapper'],
  );

  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths([''], pathBefore => pathBefore),
    [''],
    'the body path is valid selection state and must survive a transparent canvas rebuild',
  );
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths([], pathBefore => pathBefore, ''),
    [''],
    'a pending body selection must remain distinct from the null no-selection sentinel',
  );
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths(
      ['1/0', '0/2', '1/0', ''],
      pathBefore => pathBefore,
    ),
    ['1/0', '0/2', ''],
    'multi-selection restore must preserve order, deduplicate paths and retain the body path',
  );
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths(
      ['0/0/1', '1/0'],
      pathBefore => sourcePatcher.remapPathAfterMove(pathBefore, '0/0/1', moved.path),
      moved.path,
    ),
    [moved.path],
    'a move must synchronously make the moved element primary before another shortcut can run',
  );
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths(
      ['0/0/0', '0/0/1', '0/2'],
      pathBefore => sourcePatcher.remapPathAfterRemove(pathBefore, '0/0/0'),
    ),
    ['0/0/0', '0/2'],
    'removed selections must disappear while surviving siblings keep their deterministic addresses',
  );
  assert.deepEqual(
    canvasProtocol.reconcileStructuralSelectionPaths(['0/1'], pathBefore => pathBefore, null),
    [],
    'unwrapping a text-only element must clear selection instead of selecting the next sibling',
  );

  const pending = new Map([
    ['structure-7', { mutationId: 'structure-7', revision: 7, generation: 'canvas-a' }],
    ['structure-8', { mutationId: 'structure-8', revision: 8, generation: 'canvas-a' }],
  ]);
  assert.deepEqual(
    canvasProtocol.matchingCanvasRevisionMutation(
      pending,
      { mutationId: 'structure-8', revision: 8 },
    ),
    pending.get('structure-8'),
    'only the exact structural command may advance the applied canvas revision',
  );
  assert.equal(
    canvasProtocol.matchingCanvasRevisionMutation(
      pending,
      { mutationId: 'structure-8', revision: 7 },
    ),
    null,
    'a delayed ACK with a mismatched revision must not acknowledge the current structure',
  );
  assert.equal(
    canvasProtocol.matchingCanvasRevisionMutation(
      pending,
      { mutationId: 'structure-9', revision: 9 },
    ),
    null,
    'an unknown ACK must not suppress canonical recovery',
  );
  assert.equal(
    canvasProtocol.canvasRevisionNeedsCanonicalRecovery(8, 9, 0),
    true,
    'a canvas behind the project revision must recover canonically',
  );
  assert.equal(
    canvasProtocol.canvasRevisionNeedsCanonicalRecovery(9, 9, 1),
    true,
    'a later ACK must not hide an exact structural acknowledgement that is still missing',
  );
  assert.equal(
    canvasProtocol.canvasRevisionNeedsCanonicalRecovery(9, 9, 0),
    false,
    'an exact applied revision with no structural journal is already synchronized',
  );

  const restoreSelectionStart = editorSource.indexOf('const restoreCanvasSelectionWithoutReveal = useCallback(');
  const restoreSelectionEnd = editorSource.indexOf(
    '  const postPassiveCanvasMessage = useCallback(',
    restoreSelectionStart,
  );
  assert.ok(
    restoreSelectionStart >= 0 && restoreSelectionEnd > restoreSelectionStart,
    'the canonical selection restore must remain discoverable',
  );
  const restoreSelectionSection = editorSource.slice(restoreSelectionStart, restoreSelectionEnd);
  assert.match(
    restoreSelectionSection,
    /const selectedPaths = reconcileStructuralSelectionPaths\(\s*selectedPathsRef\.current,\s*path => path,\s*\);[\s\S]*?const primaryPath = selectedPaths\.length \? selectedPaths\.at\(-1\)! : null;[\s\S]*?const hasPendingPath = pendingPath !== null;[\s\S]*?hasPendingPath && pendingPath !== primaryPath[\s\S]*?paths\.forEach\(\(path, index\) => \{[\s\S]*?path,[\s\S]*?additive: index > 0,[\s\S]*?fallbackToAncestor: true,[\s\S]*?reveal: false/,
    'canonical restore must preserve body/null semantics and replay multi-selection without reveal',
  );
  assert.doesNotMatch(
    restoreSelectionSection,
    /filter\(Boolean\)|pendingPath &&/,
    'truthiness must never erase the valid empty-string body path',
  );

  const changeSourceStart = editorSource.indexOf('const changeSource = useCallback(');
  const changeSourceEnd = editorSource.indexOf(
    '  const synchronizeLiveStructure = useCallback(',
    changeSourceStart,
  );
  assert.ok(
    changeSourceStart >= 0 && changeSourceEnd > changeSourceStart,
    'the canonical source transaction must remain discoverable',
  );
  const changeSourceSection = editorSource.slice(changeSourceStart, changeSourceEnd);
  assert.match(
    changeSourceSection,
    /if \(structuralRemap\) \{[\s\S]*?const currentLocks = metadata\.lockedLayers\?\.\[current\.mainHtmlPath\] \|\| \[\];[\s\S]*?const nextLocks = reconcileStructuralSelectionPaths\(currentLocks, structuralRemap\);[\s\S]*?next = updateEditorMetadata\(next,[\s\S]*?\[current\.mainHtmlPath\]: nextLocks,[\s\S]*?commitProject\(next, record, refreshCanvas, canvasAlreadySynchronized\);/,
    'source and remapped locks must enter the same project/history commit',
  );

  const liveStructureStart = editorSource.indexOf('const synchronizeLiveStructure = useCallback(');
  const liveStructureEnd = editorSource.indexOf(
    '  const changeInteractionSource = useCallback(',
    liveStructureStart,
  );
  assert.ok(
    liveStructureStart >= 0 && liveStructureEnd > liveStructureStart,
    'the live structural transaction must remain discoverable',
  );
  const liveStructureSection = editorSource.slice(liveStructureStart, liveStructureEnd);
  assert.match(
    liveStructureSection,
    /pendingCanvasLiveStructuresRef\.current\.set\(liveMessage\.mutationId,[\s\S]*?const canvasMutationPosted = Boolean\([\s\S]*?postCanvasMessage\(liveMessage\)[\s\S]*?if \(!canvasMutationPosted\) \{\s*pendingCanvasLiveStructuresRef\.current\.delete\(liveMessage\.mutationId\);\s*\}[\s\S]*?return canvasMutationPosted;/,
    'posting must create a pending journal entry and return delivery, never an acknowledgement',
  );
  assert.match(
    liveStructureSection,
    /reconcileCanvasSelectionForStructure\(nextSource, remapPath, preferredPrimaryPath\);[\s\S]*?pendingCanvasLiveStructuresRef\.current\.set\(liveMessage\.mutationId,[\s\S]*?postCanvasMessage\(liveMessage\)/,
    'structural history must remap editor selection before journaling or posting the new generation',
  );
  assert.doesNotMatch(
    liveStructureSection.slice(0, liveStructureSection.indexOf('const commitLiveStructure')),
    /canvasAppliedRevisionRef\.current\s*=/,
    'sending a structural message must never advance the applied revision',
  );
  assert.match(
    liveStructureSection,
    /const canvasMutationPosted = synchronizeLiveStructure\(nextSource, message, remapPath\);\s*changeSource\(nextSource, true, !canvasMutationPosted, false, remapPath\);[\s\S]*?if \(canvasMutationPosted && previousProject && nextProject && nextProject !== previousProject && inverse\) \{[\s\S]*?liveHistoryTransitionsRef\.current\.set\(nextProject,[\s\S]*?return canvasMutationPosted;/,
    'missing delivery must rebuild canonically and reversible live history must require a posted mutation',
  );

  const appliedAckStart = editorSource.indexOf(
    "if (message.type === 'html-editor-live-structure-applied')",
  );
  const rejectedAckEnd = editorSource.indexOf(
    "if (message.type === 'html-editor-live-style-rejected')",
    appliedAckStart,
  );
  assert.ok(
    appliedAckStart >= 0 && rejectedAckEnd > appliedAckStart,
    'the structural acknowledgement boundary must remain discoverable',
  );
  const structuralAckSection = editorSource.slice(appliedAckStart, rejectedAckEnd);
  assert.match(
    structuralAckSection,
    /html-editor-live-structure-applied[\s\S]*?matchingCanvasRevisionMutation\([\s\S]*?if \(!pending \|\| pending\.generation !== message\.generation\) return;[\s\S]*?pendingCanvasLiveStructuresRef\.current\.delete\(message\.mutationId\);[\s\S]*?canvasAppliedRevisionRef\.current = Math\.max/,
    'only an exact mutation/revision/generation ACK may advance the applied revision',
  );
  assert.match(
    structuralAckSection,
    /html-editor-live-structure-rejected[\s\S]*?matchingCanvasRevisionMutation\([\s\S]*?if \(!pending \|\| pending\.generation !== message\.generation\) return;[\s\S]*?pendingCanvasLiveStructuresRef\.current\.delete\(message\.mutationId\);[\s\S]*?forceCanonicalCanvasRefresh\(\);/,
    'an exact rejection must recover from canonical source instead of rolling history back',
  );

  const structureRecoveryStart = editorSource.indexOf('const scheduleCanvasStructureRecovery = useCallback');
  const structureRecoveryEnd = editorSource.indexOf(
    '  const shouldDeferCanvasRefresh = useCallback',
    structureRecoveryStart,
  );
  assert.ok(
    structureRecoveryStart >= 0 && structureRecoveryEnd > structureRecoveryStart,
    'the structural recovery timeout must remain discoverable',
  );
  assert.match(
    editorSource.slice(structureRecoveryStart, structureRecoveryEnd),
    /window\.setTimeout\([\s\S]*?pendingCanvasLiveStructuresRef\.current\.size\) forceCanonicalCanvasRefresh\(\);[\s\S]*?CANVAS_CANONICAL_FALLBACK_MS/,
    'a posted structural mutation must retain canonical recovery until its exact ACK clears the journal',
  );

  const commitProjectStart = editorSource.indexOf('const commitProject = useCallback(');
  const commitProjectEnd = editorSource.indexOf('  const designTokens = useMemo(', commitProjectStart);
  assert.ok(
    commitProjectStart >= 0 && commitProjectEnd > commitProjectStart,
    'the project commit recovery contract must remain discoverable',
  );
  const commitProjectSource = editorSource.slice(commitProjectStart, commitProjectEnd);
  assert.match(
    commitProjectSource,
    /else if \(canvasAlreadySynchronized && !pendingCanvasLiveStructuresRef\.current\.size\) \{[\s\S]*?canvasAppliedRevisionRef\.current = projectRevisionRef\.current;[\s\S]*?\} else \{[\s\S]*?canvasCanonicalFallbackTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?canvasRevisionNeedsCanonicalRecovery\([\s\S]*?canvasAppliedRevisionRef\.current,[\s\S]*?projectRevisionRef\.current,[\s\S]*?pendingCanvasLiveStructuresRef\.current\.size,[\s\S]*?forceCanonicalCanvasRefresh\(\);[\s\S]*?CANVAS_CANONICAL_FALLBACK_MS/,
    'a caller that passes canvasAlreadySynchronized=false must retain the pending journal and canonical timeout',
  );

  const agentSnapshotStart = editorSource.indexOf(
    'const activePageChanged = changedPages.has(current.mainHtmlPath);',
  );
  const agentSnapshotEnd = editorSource.indexOf(
    '      return {\n        applied: next !== current,',
    agentSnapshotStart,
  );
  assert.ok(
    agentSnapshotStart >= 0 && agentSnapshotEnd > agentSnapshotStart,
    'the Agent whole-page snapshot transaction must remain discoverable',
  );
  const agentSnapshotSource = editorSource.slice(agentSnapshotStart, agentSnapshotEnd);
  assert.match(
    agentSnapshotSource,
    /canvasLiveBodyReplacement\([\s\S]*?const inverse = liveStructureInverse\(beforeRenderedSource, liveBody\.message\);[\s\S]*?const canvasSynchronized = synchronizeLiveStructure\([\s\S]*?nextRenderedSource,[\s\S]*?liveBody\.message,[\s\S]*?\(\) => null,[\s\S]*?\);[\s\S]*?editorSourceRef\.current = nextRenderedSource;[\s\S]*?commitProject\(next, true, !canvasSynchronized, false\);/,
    'a safe Agent body replacement must treat post as pending and never mark the canvas revision applied',
  );
  assert.match(
    agentSnapshotSource,
    /const committedProject = projectRef\.current;[\s\S]*?if \([\s\S]*?canvasSynchronized[\s\S]*?&& inverse[\s\S]*?&& committedProject[\s\S]*?&& committedProject !== current[\s\S]*?\) \{[\s\S]*?liveHistoryTransitionsRef\.current\.set\(committedProject,[\s\S]*?previous: current,[\s\S]*?forward: \{[\s\S]*?source: nextRenderedSource,[\s\S]*?message: liveBody\.message,[\s\S]*?remapPath: \(\) => null,[\s\S]*?backward: \{ source: beforeRenderedSource, \.\.\.inverse \},/,
    'Agent body history must retain its inverse only when the structural mutation was actually posted',
  );
  assert.match(
    agentSnapshotSource,
    /\} else \{\s*commitProject\(next, true, true\);\s*\}/,
    'an unsafe Agent page snapshot must bypass live projection and rebuild canonically',
  );
  assert.doesNotMatch(
    agentSnapshotSource,
    /commitProject\(next, true, !canvasSynchronized, canvasSynchronized\)/,
    'postMessage delivery must never be forwarded as an applied-revision acknowledgement',
  );

  const undoStart = editorSource.indexOf('const undo = useCallback(() => {');
  const redoStart = editorSource.indexOf('const redo = useCallback(() => {', undoStart);
  const commandStart = editorSource.indexOf('editorCommandRef.current = (command) => {', redoStart);
  assert.ok(
    undoStart >= 0 && redoStart > undoStart && commandStart > redoStart,
    'Undo and Redo history transactions must remain independently testable',
  );
  const undoSource = editorSource.slice(undoStart, redoStart);
  const redoSource = editorSource.slice(redoStart, commandStart);
  assert.match(
    undoSource,
    /const index = historyIndexRef\.current - 1;[\s\S]*?liveHistoryTransitionsRef\.current\.get\(currentProject\)[\s\S]*?liveTransition\?\.previous === snapshot && currentProject\s*&& canReplayLiveStructureHistory\(currentProject, snapshot, liveTransition\.surfaceKey, canvasSemanticSurfaceKeyRef\.current\)\s*\? liveTransition\.backward : null/,
    'Undo must restore the exact backward transition only within its recorded canvas surface',
  );
  assert.match(
    redoSource,
    /const index = historyIndexRef\.current \+ 1;[\s\S]*?liveHistoryTransitionsRef\.current\.get\(snapshot\)[\s\S]*?liveTransition\?\.previous === currentProject && currentProject\s*&& canReplayLiveStructureHistory\(currentProject, snapshot, liveTransition\.surfaceKey, canvasSemanticSurfaceKeyRef\.current\)\s*\? liveTransition\.forward : null/,
    'Redo must restore the exact forward transition only within its recorded canvas surface',
  );
  for (const [label, historySource] of [
    ['Undo', undoSource],
    ['Redo', redoSource],
  ]) {
    assert.match(
      historySource,
      /const structureMutationPosted = liveProjection[\s\S]*?synchronizeLiveStructure\(liveProjection\.source, liveProjection\.message, liveProjection\.remapPath\)[\s\S]*?: false;[\s\S]*?const visualProjection = !liveProjection && currentProject[\s\S]*?prepareLiveVisualHistoryProjection\(currentProject, snapshot\)[\s\S]*?: null;[\s\S]*?const canvasProjected = structureMutationPosted \|\| Boolean\(visualProjection\);/,
      `${label} must distinguish a posted structural mutation from a visual projection`,
    );
    assert.match(
      historySource,
      /historyIndexRef\.current = index;[\s\S]*?setHistoryIndex\(index\);[\s\S]*?projectRevisionRef\.current \+= 1;[\s\S]*?if \(!canvasProjected\) resetCanvasViewStateRef\.current\(projectRevisionRef\.current\);[\s\S]*?projectRef\.current = snapshot;[\s\S]*?canvasProjectRef\.current = snapshot;[\s\S]*?canvasProjectRevisionRef\.current = projectRevisionRef\.current;/,
      `${label} must commit one history index and project revision before projecting the canvas`,
    );
    assert.equal(
      historySource.match(/projectRevisionRef\.current \+= 1;/g)?.length,
      1,
      `${label} must advance the project revision exactly once`,
    );
    assert.equal(
      historySource.match(/setProject\(snapshot\);/g)?.length,
      1,
      `${label} must install the historical project snapshot exactly once`,
    );
    assert.match(
      historySource,
      /if \(liveProjection\) \{[\s\S]*?editorSourceRef\.current = liveProjection\.source;[\s\S]*?\} else if \(visualProjection\) \{[\s\S]*?editorSourceRef\.current = visualProjection\.source;[\s\S]*?if \(visualProjection\.message\) \{[\s\S]*?enqueueCanvasLiveStyle\(visualProjection\.message\);/,
      `${label} must project reversible structure or enqueue the supported visual delta`,
    );
    assert.match(
      historySource,
      /if \(!canvasProjected\) \{[\s\S]*?canvasReadyRef\.current = null;[\s\S]*?pendingCanvasLiveStylesRef\.current\.clear\(\);[\s\S]*?pendingCanvasLiveStructuresRef\.current\.clear\(\);[\s\S]*?canvasLiveStyleJournalRef\.current\.texts\.clear\(\);/,
      `${label} must discard stale realtime journals before a canonical rebuild`,
    );
    assert.match(
      historySource,
      /setProject\(snapshot\);[\s\S]*?if \(liveProjection\) \{[\s\S]*?if \(!structureMutationPosted\) setCanvasProject\(snapshot\);[\s\S]*?\} else if \(visualProjection\) \{[\s\S]*?pendingSelectionPathRef\.current = null;[\s\S]*?\} else \{[\s\S]*?setCanvasProject\(snapshot\);[\s\S]*?selectedPathsRef\.current = \[\];[\s\S]*?setSelection\(null\);[\s\S]*?setSelectedPaths\(\[\]\);/,
      `${label} must preserve remapped/live selection and clear it only for a canonical surface rebuild`,
    );
    assert.match(
      historySource,
      /if \(structureMutationPosted\) scheduleCanvasStructureRecovery\(\);[\s\S]*?else if \(!canvasProjected\) forceCanonicalCanvasRefresh\(\);/,
      `${label} must wait for an exact structural ACK and rebuild immediately only when no projection exists`,
    );
    assert.doesNotMatch(
      historySource,
      /canvasSynchronized/,
      `${label} must never treat successful postMessage delivery as a canvas acknowledgement`,
    );
  }

  const moveLayerStart = editorSource.indexOf('const moveLayer = (');
  const moveLayerEnd = editorSource.indexOf(
    '  const moveSelectedLayer = (',
    moveLayerStart,
  );
  assert.ok(
    moveLayerStart >= 0 && moveLayerEnd > moveLayerStart,
    'the reorder transaction must remain discoverable',
  );
  const moveLayerSection = editorSource.slice(moveLayerStart, moveLayerEnd);
  assert.match(
    moveLayerSection,
    /const latestSource = editorSourceRef\.current;[\s\S]*?const result = patchMoveElement\(latestSource, sourcePath, targetPath, position\);[\s\S]*?const remapPath = \(candidate: string\) => remapPathAfterMove\(candidate, sourcePath, result\.path\);[\s\S]*?const movedCodeComponentInstanceId = result\.movedAttributes[\s\S]*?\['data-coday-code-instance'\][\s\S]*?if \(movedCodeComponentInstanceId\) \{[\s\S]*?commitLiveStructure\([\s\S]*?operation: 'move',[\s\S]*?movedPath: result\.path,[\s\S]*?selectPath: result\.path,[\s\S]*?codeComponentInstanceId: movedCodeComponentInstanceId,[\s\S]*?remapPath,[\s\S]*?return;[\s\S]*?reconcileCanvasSelectionForStructure\(result\.source, remapPath, result\.path\);[\s\S]*?changeSource\(result\.source, true, true, false, remapPath\);/,
    'Code Component moves must preserve root identity and runtime-owned reorder fallback must retain the canonical path transaction',
  );
  assert.doesNotMatch(
    moveLayerSection,
    /synchronizeLiveStructure\(|updateCurrentPageLocks\(|postCanvasMessage\(/,
    'the specialized move must still use the ACK-tracked transaction instead of posting directly or committing locks separately',
  );
  assert.match(
    previewSource,
    /const applyLiveElementMove = message => \{[\s\S]*?const codeComponentInstanceId =[\s\S]*?sources\.some\(source => source\.getAttribute\('data-coday-code-instance'\) !== codeComponentInstanceId\)[\s\S]*?if \(position === 'inside'\) target\.append\(source\);[\s\S]*?remapAllEditorPathState\(path => remapEditorPathAfterMove\(path, sourcePath, movedPath\)\)[\s\S]*?finalizeLiveStructure\(message\)/,
    'the canvas must validate instance identity and reparent the same mounted root instead of recreating it',
  );
  assert.match(
    liveDomHelpersSource,
    /if \(operation === 'move'\)[\s\S]*?const codeComponentInstanceId =[\s\S]*?operation: 'relocate',[\s\S]*?\.\.\.\(codeComponentInstanceId \? \{ codeComponentInstanceId \} : \{\}\)/,
    'undo must preserve the Code Component identity guard while relocating the mounted root back',
  );

  console.log('HTML canvas state tests passed');
} finally {
  await server.close();
}
