import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx',
);
const source = await readFile(editorPath, 'utf8');

function extract(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing bounded source: ${startMarker}`);
  return sourceText.slice(start, end);
}

function assertNewProjectContract(sourceText) {
  const exactPersistence = extract(
    sourceText,
    '  const persistExactWordPressDraft = useCallback',
    '\n\n  const holdWordPressDraftDuringComponentEdit = useCallback',
  );
  const openBlankProject = extract(
    sourceText,
    '  const openBlankProject = useCallback',
    '\n\n  const createNewProject = useCallback',
  );
  const confirmation = extract(
    sourceText,
    '  const confirmCreateNewProject = useCallback',
    '\n\n  const renameCurrentProject = useCallback',
  );
  const dialog = extract(
    sourceText,
    '      <ConfirmDialog\n        open={!sharedSession && newProjectConfirmOpen}',
    '\n      {editorCanvasLoading && (',
  );
  const explicitCleanup = exactPersistence.slice(exactPersistence.indexOf('      if (replacePending) {'));

  assert.match(
    explicitCleanup,
    /if \(replacePending\) \{[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?if \(explicitWordPressDraftProjectRef\.current === next\) \{[\s\S]*?explicitWordPressDraftProjectRef\.current = null;/,
    'an exact pending snapshot must be released after ACK even when the live project changed during the request',
  );
  assert.doesNotMatch(
    explicitCleanup,
    /projectSignature\(projectRef\.current\) === signature/,
    'explicit cleanup must not retain the acknowledged A snapshot when the live project advanced to A-prime',
  );

  assert.match(
    openBlankProject,
    /const blankProject = ensureProjectIdentity\(sanitizeProjectPriorities\(createBlankProject\(\)\)\);/,
    'the replacement must use one exact normalized blank snapshot',
  );
  assert.match(
    openBlankProject,
    /if \(isWordPressRuntime\) \{[\s\S]*?const replacementFence = advanceWordPressWorkspaceWriteFence\(blankProject\);[\s\S]*?await persistExactWordPressDraft\([\s\S]*?blankProject,[\s\S]*?replaceWordPressWorkspace: true,[\s\S]*?\.\.\.replacementFence,[\s\S]*?\);/,
    'WordPress creation must await an explicit exact replacement ACK',
  );
  assert.ok(
    openBlankProject.indexOf('if (publishAbortControllerRef.current)')
      < openBlankProject.indexOf('advanceWordPressWorkspaceWriteFence(blankProject)'),
    'confirmation must recheck Publish before advancing or invalidating the active workspace fence',
  );
  assert.ok(
    openBlankProject.indexOf('await persistExactWordPressDraft(')
      < openBlankProject.indexOf('openProject(blankProject, null, true, null, false, true);'),
    'the old project must remain active until WordPress acknowledges the blank replacement',
  );
  assert.match(
    openBlankProject,
    /!isCurrentWorkspaceWrite\(replacementFence\)[\s\S]*?replacementFence\.projectId[\s\S]*?openProject\(blankProject, null, true, null, false, true\);[\s\S]*?setSavedAt\(confirmedSavedAt\);/,
    'the acknowledged replacement must open as already saved without scheduling another replacement',
  );
  const failedReplacement = openBlankProject.slice(openBlankProject.indexOf('      } catch (error) {'));
  assert.match(
    failedReplacement,
    /isCurrentWorkspaceWrite\(replacementFence\)[\s\S]*?advanceWordPressWorkspaceWriteFence\(preservedProject\)[\s\S]*?pendingTemplateImportRef\.current = preservedTemplateImport;[\s\S]*?lastWordPressDraftSignatureRef\.current = ''/,
    'failed creation must preserve the local session and its pending template-import marker',
  );
  assert.doesNotMatch(
    failedReplacement,
    /persistExactWordPressDraft\(/,
    'a lost ACK must never trigger an automatic destructive rollback ZIP',
  );
  assert.match(openBlankProject, /await persistLocalProjectSnapshot\(blankProject\);[\s\S]*?toast\.warning\(/,
    'a local snapshot failure after remote confirmation must be visible without undoing the new project');
  assert.match(
    openBlankProject,
    /const localSavedAt = await persistLocalProjectSnapshot\(blankProject\);[\s\S]*?setSavedAt\(localSavedAt\);/,
    'non-WordPress creation must retain its existing local-only persistence',
  );
  assert.doesNotMatch(openBlankProject, /window\.confirm|confirm\(/, 'creation must not add a second confirmation');
  assert.match(
    confirmation,
    /useCallback\(async \(\) => \{[\s\S]*?await openBlankProject\(\);/,
    'the one confirmation must remain pending until blank-project persistence finishes',
  );
  assert.match(dialog, /confirmLabel="Descartar e criar novo"/);
  assert.match(dialog, /onConfirm=\{confirmCreateNewProject\}/);
}

assertNewProjectContract(source);

assert.throws(
  () => assertNewProjectContract(
    source.replace(
      '        await persistExactWordPressDraft(\n          blankProject,',
      '        void persistExactWordPressDraft(\n          blankProject,',
    ),
  ),
  /explicit exact replacement ACK/,
  'mutation: a fire-and-forget WordPress save must fail the contract',
);

assert.throws(
  () => assertNewProjectContract(
    source.replace(
      'openProject(blankProject, null, true, null, false, true);',
      'openProject(blankProject, null, true);',
    ),
  ),
  /old project|acknowledged replacement/,
  'mutation: reopening as an unacknowledged replacement must fail the contract',
);

assert.throws(
  () => assertNewProjectContract(
    source.replace(
      '          if (explicitWordPressDraftProjectRef.current === next) {',
      '          if (explicitWordPressDraftProjectRef.current === next && projectRef.current && projectSignature(projectRef.current) === signature) {',
    ),
  ),
  /released after ACK|live project advanced/,
  'mutation: tying explicit cleanup to the old live signature must fail when A changes to A-prime during ACK',
);

assert.throws(
  () => assertNewProjectContract(
    source.replace(
      '            pendingTemplateImportRef.current = preservedTemplateImport;\n',
      '',
    ),
  ),
  /template-import marker/,
  'mutation: dropping the pending template-import marker during rollback must fail the contract',
);

console.log('PASS html new-project save contract');
