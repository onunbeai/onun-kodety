import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true }, resolve: { alias: { '@': root } }, logLevel: 'silent' });
try {
  const { renameClassInHtml } = await server.ssrLoadModule('/lib/html-editor/class-selector.ts');
  const measurements = [];
  for (const elements of [1000, 10_000]) {
    const prefix = '<!doctype html><html><body><main>';
    const suffix = '</main></body></html>';
    const element = '<div class="hero other"><span>Content</span></div>';
    const source = prefix + element.repeat(elements) + suffix;
    const expected = prefix + element.replace('hero other', 'banner other').repeat(elements) + suffix;
    const elapsedMs = [];
    for (let sample = 0; sample < 4; sample++) {
      const started = performance.now();
      const result = renameClassInHtml(source, 'hero', 'banner');
      elapsedMs.push(Math.round((performance.now() - started) * 100) / 100);
      assert.equal(result, expected);
    }
    const measured = elapsedMs.slice(1).sort((a, b) => a - b);
    measurements.push({ elements, bytes: Buffer.byteLength(source), warmupMs: elapsedMs[0], samplesMs: elapsedMs.slice(1), medianMs: measured[1] });
  }
  console.log(JSON.stringify({
    node: process.version,
    sourcePatcherSha256: createHash('sha256').update(await readFile(new URL('../lib/html-editor/source-patcher.ts', import.meta.url))).digest('hex'),
    scope: 'Local synchronous HTML rename in Node; three measured executions after one warmup. This is not installed Builder interaction latency.',
    measurements,
  }, null, 2));
} finally {
  await server.close();
}
