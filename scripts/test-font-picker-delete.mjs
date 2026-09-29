import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pickerPath = path.join(root, 'app/(builder)/kodety/components/FontPicker.tsx');
const pickerSource = await readFile(pickerPath, 'utf8');

const start = pickerSource.indexOf('  const confirmDeleteFont = async () => {');
const end = pickerSource.indexOf('\n  };', start);
assert.notEqual(start, -1, 'FontPicker must define an async delete confirmation');
assert.notEqual(end, -1, 'FontPicker delete confirmation must have a bounded body');

const deleteConfirmation = pickerSource.slice(start, end);
const deleteCalls = deleteConfirmation.match(/\bdeleteFont\s*\(/g) || [];
assert.equal(
  deleteCalls.length,
  1,
  'one confirmation must dispatch at most one transport-backed removal',
);
assert.match(
  deleteConfirmation,
  /const wasSelected = isSelected\(fontToDelete\);\s*await deleteFont\(fontToDelete\.id\);\s*if \(wasSelected\) onChange\('inherit'\);/,
  'selection may change only after the removal ACK resolves',
);
assert.doesNotMatch(
  deleteConfirmation,
  /removeFont|useFontsStore\.getState|\bcatch\b|\.then\s*\(/,
  'unsupported and failed removals must reject without a fallback retry',
);
assert.match(
  pickerSource,
  /<ConfirmDialog[\s\S]*?onConfirm=\{confirmDeleteFont\}/,
  'the async operation must be returned to ConfirmDialog for loading and error feedback',
);

console.log('FontPicker delete acknowledgement contract passed.');
