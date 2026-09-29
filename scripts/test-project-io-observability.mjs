import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

function fileLike(name, bytes) {
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function recordingBridge() {
  const begins = [];
  const finishes = [];
  return {
    begins,
    finishes,
    bridge: {
      begin(...args) {
        begins.push(args);
        return Object.freeze({ phase: args[0], ordinal: begins.length });
      },
      finish(...args) {
        finishes.push(args);
      },
    },
  };
}

try {
  const { importZip } = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const validZip = new JSZip();
  validZip.file('index.html', '<!doctype html><title>Private title</title>');
  validZip.file('.incode/project.json', JSON.stringify({ version: 1, name: 'Private project' }));
  const validBytes = await validZip.generateAsync({ type: 'uint8array' });

  const success = recordingBridge();
  globalThis.__kodetyWordPressProjectObservability = success.bridge;
  const imported = await importZip(fileLike('private-customer-name.zip', validBytes));
  assert.equal(imported.name, 'Private project');
  assert.deepEqual(success.begins, [
    ['project_unzip', 'bypass'],
    ['project_parse', 'bypass'],
  ]);
  assert.deepEqual(success.finishes.map(([, outcome]) => outcome), ['ok', 'ok']);
  const successSignals = JSON.stringify([success.begins, success.finishes]);
  for (const forbidden of ['private-customer-name', 'Private project', 'Private title', 'index.html']) {
    assert.equal(successSignals.includes(forbidden), false, `observability leaked ${forbidden}`);
  }

  const invalidProjectZip = new JSZip();
  invalidProjectZip.file('readme.txt', 'no html document');
  const invalidProjectBytes = await invalidProjectZip.generateAsync({ type: 'uint8array' });
  const parseFailure = recordingBridge();
  globalThis.__kodetyWordPressProjectObservability = parseFailure.bridge;
  await assert.rejects(() => importZip(fileLike('parse-failure.zip', invalidProjectBytes)));
  assert.deepEqual(parseFailure.begins.map(([phase]) => phase), ['project_unzip', 'project_parse']);
  assert.deepEqual(parseFailure.finishes.map(([, outcome]) => outcome), ['ok', 'error']);

  const unzipFailure = recordingBridge();
  globalThis.__kodetyWordPressProjectObservability = unzipFailure.bridge;
  await assert.rejects(() => importZip(fileLike('unzip-failure.zip', new Uint8Array([1, 2, 3]))));
  assert.deepEqual(unzipFailure.begins.map(([phase]) => phase), ['project_unzip']);
  assert.deepEqual(unzipFailure.finishes.map(([, outcome]) => outcome), ['error']);

  const originalLoadAsync = JSZip.loadAsync;
  try {
    JSZip.loadAsync = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    const aborted = recordingBridge();
    globalThis.__kodetyWordPressProjectObservability = aborted.bridge;
    await assert.rejects(() => importZip(fileLike('aborted.zip', validBytes)));
    assert.deepEqual(aborted.begins.map(([phase]) => phase), ['project_unzip']);
    assert.deepEqual(aborted.finishes.map(([, outcome]) => outcome), ['aborted']);
  } finally {
    JSZip.loadAsync = originalLoadAsync;
  }

  delete globalThis.__kodetyWordPressProjectObservability;
  const withoutBridge = await importZip(fileLike('private-customer-name.zip', validBytes));
  assert.equal(withoutBridge.name, imported.name);
  assert.deepEqual(Object.keys(withoutBridge.files), Object.keys(imported.files));

  globalThis.__kodetyWordPressProjectObservability = {
    begin() { throw new Error('observer unavailable'); },
    finish() { throw new Error('must not run'); },
  };
  const beginUnavailable = await importZip(fileLike('private-customer-name.zip', validBytes));
  assert.equal(beginUnavailable.name, imported.name);

  globalThis.__kodetyWordPressProjectObservability = {
    begin(phase) { return { phase }; },
    finish() { throw new Error('observer unavailable'); },
  };
  const finishUnavailable = await importZip(fileLike('private-customer-name.zip', validBytes));
  assert.equal(finishUnavailable.name, imported.name);

  console.log('Project I/O observability wiring passed.');
} finally {
  delete globalThis.__kodetyWordPressProjectObservability;
  await server.close();
}
