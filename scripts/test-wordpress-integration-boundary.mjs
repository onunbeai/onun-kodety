import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

for (const removedPath of [
  'lib/apps/airtable/index.ts',
  'lib/apps/airtable/types.ts',
  'lib/apps/airtable/sync-service.ts',
  'lib/apps/airtable/field-mapping.ts',
  'lib/apps/airtable/markdown-to-tiptap.ts',
  'lib/client/thumbnail-capture.tsx',
  'lib/repositories/appSettingsRepository.ts',
]) {
  assert.equal(
    await exists(removedPath),
    false,
    `${removedPath} belongs to a non-WordPress legacy backend and must stay removed.`,
  );
}

const activeSourceRoots = [
  'app',
  'components',
  'hooks',
  'lib',
  'stores',
  'Wordpress/editor',
  'Wordpress/runtime-assets',
  'Wordpress/kodety/includes',
  'Wordpress/extensions',
  'extensions',
  'ChromeExtension',
  'FigmaPlugin',
];
const skippedDirectories = new Set(['assets', 'dist', 'node_modules', '.next']);
const sourceExtension = /\.(?:cjs|js|json|mjs|php|ts|tsx)$/i;

async function collectSourceFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...await collectSourceFiles(relativePath));
    } else if (entry.isFile() && sourceExtension.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

const activeSourceFiles = (await Promise.all(activeSourceRoots.map(collectSourceFiles))).flat();
const activeSource = await Promise.all(activeSourceFiles.map(async relativePath => [
  relativePath,
  await readFile(path.join(root, relativePath), 'utf8'),
]));

const forbiddenSourcePatterns = [
  ['Airtable module import', /(?:@\/|\b)lib\/apps\/airtable/],
  ['legacy thumbnail capture import', /thumbnail-capture/],
  ['legacy thumbnail upload helper', /uploadThumbnail/],
  ['legacy thumbnail API request', /\/kodety\/api\/components\/[^\n]*\/thumbnail/],
];

for (const [label, pattern] of forbiddenSourcePatterns) {
  const offenders = activeSource
    .filter(([relativePath, source]) => pattern.test(`${relativePath}\n${source}`))
    .map(([relativePath]) => relativePath);
  assert.deepEqual(offenders, [], `${label} remains in: ${offenders.join(', ')}`);
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(
  Object.hasOwn(packageJson.dependencies ?? {}, 'html-to-image'),
  false,
  'html-to-image was only used by the removed component thumbnail capture.',
);

console.log('WordPress-only integration boundary passed: legacy Airtable and component thumbnail backends are absent.');
