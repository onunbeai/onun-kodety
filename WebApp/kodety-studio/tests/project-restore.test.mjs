import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'kodety-project-restore-test-'));
await build({
  entryPoints: [path.resolve(testRoot, '../../../ChromeExtension/kodety-studio/src/project-restore.ts')],
  outfile: path.join(scratch, 'restore.mjs'),
  platform: 'node',
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
});
const { restorePersistedProject, ProjectRestoreError } = await import(
  pathToFileURL(path.join(scratch, 'restore.mjs')).href
);
after(() => rm(scratch, { recursive: true, force: true }));

const projectId = 'restore-project-123';
const databasePath = '/wordpress/wp-content/database/.ht.sqlite';
const coreFiles = ['/wordpress/wp-config.php', '/wordpress/wp-load.php', '/wordpress/wp-includes/version.php'];
const encode = (value) => new TextEncoder().encode(value);
const mount = () => ({
  mountpoint: '/wordpress',
  device: { type: 'opfs', path: `kodety-studio/projects/${projectId}` },
  initialSyncDirection: 'opfs-to-memfs',
});

function database(seed = 37) {
  const bytes = new Uint8Array(4096).fill(seed);
  bytes.set(encode('SQLite format 3\0'));
  return bytes;
}

function files() {
  return new Map([
    [coreFiles[0], encode("<?php define('DB_NAME', 'wordpress');")],
    [coreFiles[1], encode("<?php require_once __DIR__ . '/wp-config.php';")],
    [coreFiles[2], encode("<?php $wp_version = '7.1';")],
    [databasePath, database()],
  ]);
}

function fixture(saved = files()) {
  let memory = files();
  memory.set(databasePath, database(90));
  memory.set('/wordpress/temporary-only.php', encode('<?php echo "temporary";'));
  const calls = [];
  const storedBefore = structuredClone(saved);
  const client = {
    mountOpfs: async (descriptor) => {
      calls.push(['mount', descriptor]);
      assert.deepEqual(descriptor, mount());
      // The upstream restore mount deletes MEMFS /wordpress before copying OPFS.
      memory = structuredClone(saved);
    },
    isFile: async (file) => {
      calls.push(['isFile', file]);
      return memory.has(file);
    },
    readFileAsBuffer: async (file) => {
      calls.push(['read', file]);
      if (!memory.has(file)) throw new Error('File not found');
      return memory.get(file).slice();
    },
    listFiles: async (directory) => {
      calls.push(['listFiles', directory]);
      return [...new Set([...memory.keys()]
        .filter(file => file.startsWith(`${directory}/`))
        .map(file => file.slice(directory.length + 1).split('/')[0]))];
    },
  };
  for (const name of ['run', 'writeFile', 'unlink', 'mkdir', 'rmdir', 'flushOpfs', 'defineConstant']) {
    client[name] = async () => {
      calls.push([name]);
      throw new Error(`Restoration must not call ${name}`);
    };
  }
  return {
    client,
    calls,
    memory: () => memory,
    restore: (options = {}) => restorePersistedProject(client, mount(), { projectId, ...options }),
    unchanged() {
      assert.deepEqual(saved, storedBefore);
      assert.ok(calls.every(([name]) => ['mount', 'isFile', 'read', 'listFiles'].includes(name)));
    },
  };
}

async function rejectsWithoutWrites(f, code, options) {
  await assert.rejects(f.restore(options), error => {
    assert.ok(error instanceof ProjectRestoreError);
    assert.equal(error.code, code);
    assert.equal(error.projectId, projectId);
    return true;
  });
  f.unchanged();
}

test('restores the saved database byte for byte and discards temporary files', async () => {
  const saved = files();
  saved.set('/wordpress/wp-content/uploads/user-content.txt', encode('saved content'));
  const f = fixture(saved);
  assert.deepEqual(await f.restore(), { databasePath, databaseBytes: 4096, wordpressVersion: '7.1' });
  assert.equal(f.calls[0][0], 'mount');
  assert.deepEqual(f.memory(), saved);
  assert.equal(f.memory().has('/wordpress/temporary-only.php'), false);
  assert.equal(f.calls.some(([name]) => name === 'listFiles'), false);
  f.unchanged();
});

test('reports a failed OPFS read without retrying or losing its original cause', async () => {
  const f = fixture();
  const cause = new AggregateError([new Error('File could not be read')], 'All promises were rejected');
  let attempts = 0;
  f.client.mountOpfs = async () => { attempts++; throw cause; };
  await assert.rejects(f.restore(), error => {
    assert.ok(error instanceof ProjectRestoreError);
    assert.equal(error.code, 'PROJECT_FILES_UNREADABLE');
    assert.equal(error.path, '/wordpress');
    assert.equal(error.cause, cause);
    assert.match(error.message, /Não foi possível ler/);
    return true;
  });
  assert.equal(attempts, 1);
  assert.deepEqual(f.calls, []);
  f.unchanged();
});

test('accepts an existing legacy SQLite filename without renaming or migrating it', async () => {
  const saved = files();
  saved.set(`${databasePath}.php`, saved.get(databasePath));
  saved.delete(databasePath);
  const f = fixture(saved);
  assert.deepEqual(await f.restore(), { databasePath: `${databasePath}.php`, databaseBytes: 4096, wordpressVersion: '7.1' });
  assert.equal(f.memory().has(databasePath), false);
  f.unchanged();
});

test('does not replace a missing saved database with the temporary database', async () => {
  const saved = files();
  saved.delete(databasePath);
  const f = fixture(saved);
  await rejectsWithoutWrites(f, 'DATABASE_MISSING');
  assert.equal(f.memory().has(databasePath), false);
});

test('distinguishes missing configuration from an unavailable saved filesystem', async () => {
  const saved = files();
  saved.delete(coreFiles[0]);
  const missingConfig = fixture(saved);
  await assert.rejects(missingConfig.restore(), error => {
    assert.equal(error.code, 'PROJECT_FILES_MISSING');
    assert.match(error.message, /Arquivos ausentes: wp-config\.php\. Banco SQLite: encontrado\./);
    return true;
  });
  missingConfig.unchanged();
  const missingFilesystem = fixture(new Map());
  await assert.rejects(missingFilesystem.restore(), error => {
    assert.equal(error.code, 'PROJECT_FILES_MISSING');
    assert.match(error.message, /wp-config\.php, wp-load\.php, wp-includes\/version\.php/);
    assert.match(error.message, /Banco SQLite: não encontrado/);
    return true;
  });
  missingFilesystem.unchanged();
});

test('missing-core diagnostics distinguish an empty root from a nested WordPress without reading contents', async () => {
  for (const [saved, expected] of [
    [new Map(), /Conteúdo na raiz: vazia\./],
    [new Map([['/wordpress/wordpress/wp-config.php', encode('nested private content')]]), /Conteúdo na raiz: wordpress\./],
  ]) {
    const f = fixture(saved);
    await assert.rejects(f.restore(), error => {
      assert.equal(error.code, 'PROJECT_FILES_MISSING');
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /nested private content/);
      return true;
    });
    assert.deepEqual(f.calls.filter(([name]) => name === 'listFiles'), [['listFiles', '/wordpress']]);
    assert.equal(f.calls.some(([name]) => name === 'read'), false);
    f.unchanged();
  }
});

test('missing-core root inventory includes at most thirty names', async () => {
  const saved = new Map(Array.from({ length: 35 }, (_, index) => [`/wordpress/entry-${String(index).padStart(2, '0')}`, encode('private content')]));
  const f = fixture(saved);
  await assert.rejects(f.restore({ language: 'en' }), error => {
    assert.equal(error.code, 'PROJECT_FILES_MISSING');
    assert.match(error.message, /Root entries: entry-00/);
    assert.match(error.message, /entry-29, …/);
    assert.doesNotMatch(error.message, /entry-30|private content/);
    return true;
  });
  assert.equal(f.calls.some(([name]) => name === 'read'), false);
  f.unchanged();
});

test('an optional inventory failure preserves the original missing-files diagnostic', async () => {
  const f = fixture(new Map());
  f.client.listFiles = async () => { throw new Error('Inventory unavailable'); };
  await assert.rejects(f.restore(), error => {
    assert.equal(error.code, 'PROJECT_FILES_MISSING');
    assert.equal(error.path, coreFiles[0]);
    assert.match(error.message, /Arquivos ausentes: wp-config\.php/);
    assert.doesNotMatch(error.message, /Inventory unavailable/);
    return true;
  });
  f.unchanged();
});

test('rejects empty, truncated, and non-SQLite databases without running PHP', async () => {
  for (const invalid of [new Uint8Array(), database().slice(0, 99), new Uint8Array(4096)]) {
    const saved = files();
    saved.set(databasePath, invalid);
    await rejectsWithoutWrites(fixture(saved), 'DATABASE_INVALID');
  }
});

test('does not hide a corrupt current database by selecting a valid legacy database', async () => {
  const saved = files();
  saved.set(`${databasePath}.php`, database());
  saved.set(databasePath, new Uint8Array());
  await rejectsWithoutWrites(fixture(saved), 'DATABASE_INVALID');
});

test('rejects each missing core file instead of filling gaps from the temporary site', async () => {
  for (const missing of coreFiles) {
    const saved = files();
    saved.delete(missing);
    const f = fixture(saved);
    await rejectsWithoutWrites(f, 'PROJECT_FILES_MISSING');
    assert.equal(f.memory().has(missing), false);
  }
});

test('rejects empty or invalid core files before any WordPress execution', async () => {
  for (const invalidPath of coreFiles) {
    for (const source of ['', '404 Not Found', '<?php ']) {
      const saved = files();
      saved.set(invalidPath, encode(source));
      await rejectsWithoutWrites(fixture(saved), 'PROJECT_FILES_INVALID');
    }
  }
  const saved = files();
  saved.set(coreFiles[2], encode('<?php /* Truncated version file */'));
  await rejectsWithoutWrites(fixture(saved), 'PROJECT_FILES_INVALID');
});

test('rejects explicit custom database locations even when a default database exists', async () => {
  for (const statement of [
    "define('DB_DIR', '/custom');",
    'define ( /* comment */ "DB_FILE", "custom.sqlite" );',
    "const DB_FILE = 'custom.sqlite';",
    "define('WP_CONTENT_DIR', '/custom-content');",
    "define('FQDB', '/custom.sqlite');",
  ]) {
    const saved = files();
    saved.set(coreFiles[0], encode(`<?php ${statement}`));
    await rejectsWithoutWrites(fixture(saved), 'CUSTOM_DATABASE_PATH');
  }
});

test('does not mistake commented custom path examples for active definitions', async () => {
  const saved = files();
  saved.set(coreFiles[0], encode(`<?php
    // define('DB_DIR', '/custom');
    /* define('DB_FILE', 'custom.sqlite'); */
    # const DB_FILE = 'custom.sqlite';
    define('WP_HOME', 'https://example.test');
    define('DB_NAME', 'wordpress');
  `));
  const f = fixture(saved);
  await f.restore();
  f.unchanged();
});

test('reports failed reads without trying to repair files', async () => {
  const f = fixture();
  const cause = new Error('Storage unavailable');
  f.client.readFileAsBuffer = async () => { throw cause; };
  await assert.rejects(f.restore(), error => {
    assert.equal(error.code, 'PROJECT_FILES_UNREADABLE');
    assert.equal(error.cause, cause);
    return true;
  });
  f.unchanged();
});

test('rejects incorrect mount directions and project paths before mounting or reading', async () => {
  for (const descriptor of [
    { ...mount(), initialSyncDirection: 'memfs-to-opfs' },
    { ...mount(), mountpoint: '/' },
    { ...mount(), device: { type: 'opfs', path: 'another-project' } },
  ]) {
    const f = fixture();
    await assert.rejects(
      restorePersistedProject(f.client, descriptor, { projectId }),
      { code: 'INVALID_RESTORE_MOUNT' },
    );
    assert.deepEqual(f.calls, []);
    f.unchanged();
  }
});

test('provides an English diagnostic while preserving its stable error code', async () => {
  const saved = files();
  saved.delete(databasePath);
  const f = fixture(saved);
  await assert.rejects(f.restore({ language: 'en' }), error => {
    assert.equal(error.code, 'DATABASE_MISSING');
    assert.match(error.message, /database was not found/);
    return true;
  });
  f.unchanged();
});
