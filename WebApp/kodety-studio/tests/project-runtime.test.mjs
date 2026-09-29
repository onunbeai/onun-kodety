import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const { kodety: { wordpressVersion: currentPluginVersion } } = JSON.parse(
  await readFile(path.resolve(testRoot, "../../../package.json"), "utf8"),
);
const scratch = await mkdtemp(path.join(tmpdir(), "kodety-web-runtime-test-"));
await build({
  entryPoints: {
    runtime: path.resolve(
      testRoot,
      "../../../ChromeExtension/kodety-studio/src/playground-runtime.ts",
    ),
    storage: path.resolve(testRoot, "../../../ChromeExtension/kodety-studio/src/storage.ts"),
  },
  outdir: scratch,
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  bundle: true,
  logLevel: "silent",
  plugins: [
    {
      name: "playground-test-double",
      setup(builder) {
        builder.onResolve({ filter: /^@wp-playground\/client$/ }, () => ({
          path: "playground",
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `
      export async function startPlaygroundWeb(options) { const f = globalThis.__studioRuntimeFixture; f.bootstrap(options); f.onStart?.(); return f.client; }
      export async function installPlugin() { const f = globalThis.__studioRuntimeFixture; f.install(); f.onInstall?.(); }
      export async function login() { globalThis.__studioRuntimeFixture.trace.push(['login']); }
      export async function setSiteLanguage() {}
    `,
        }));
      },
    },
  ],
});
const { bootProject, needsBundledPlugin, recoverInterruptedMaintenance } = await import(
  pathToFileURL(path.join(scratch, "runtime.mjs")).href
);
const { KODETY_STUDIO_RUNTIME_REVISION: currentRuntimeRevision } = await import(
  pathToFileURL(path.join(scratch, "storage.mjs")).href
);
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  delete globalThis.__studioRuntimeFixture;
});
after(() => rm(scratch, { recursive: true, force: true }));

const databasePath = "/wordpress/wp-content/database/.ht.sqlite";
const pluginPath = "/wordpress/wp-content/plugins/kodety/kodety.php";
const encode = (value) => new TextEncoder().encode(value);
function pluginFile(version = currentPluginVersion) {
  return encode(`<?php\n/**\n * Plugin Name: Kodety\n * Version: ${version}\n */`);
}
function wordpressFiles({ withPlugin = true, temporary = false, wordpressVersion = "7.1" } = {}) {
  const db = new Uint8Array(4096).fill(temporary ? 88 : 42);
  db.set(encode("SQLite format 3\0"));
  const files = new Map([
    ["/wordpress/wp-config.php", encode("<?php define('DB_NAME', 'wordpress');")],
    ["/wordpress/wp-load.php", encode("<?php require_once __DIR__ . '/wp-config.php';")],
    ["/wordpress/wp-includes/version.php", encode(`<?php $wp_version = '${wordpressVersion}';`)],
    [databasePath, db],
  ]);
  if (withPlugin) files.set(pluginPath, pluginFile());
  if (temporary) files.set("/wordpress/temporary-only.txt", encode("bootstrap only"));
  return files;
}

function fixture() {
  const calls = [];
  const trace = [];
  const f = {
    calls,
    trace,
    saved: wordpressFiles(),
    memory: wordpressFiles({ withPlugin: false, temporary: true }),
    constants: new Map(),
    bootOptions: [],
    bootstrapFiles: null,
    bootstrapVersion: null,
    options: null,
    onStart: null,
    onInstall: null,
    onFlush: null,
    onRun: null,
    bootstrap(options) {
      f.options = options;
      f.bootOptions.push(options);
      f.memory = wordpressFiles({
        withPlugin: false,
        temporary: true,
        wordpressVersion: f.bootstrapVersion || options.blueprint.preferredVersions.wp,
      });
      for (const step of options.blueprint.steps || []) {
        if (step.step === "writeFile") f.memory.set(step.path, encode(step.data));
      }
      f.bootstrapFiles = structuredClone(f.memory);
      trace.push(["bootstrap", options]);
    },
    install() {
      calls.push("install");
      trace.push(["install"]);
      f.memory.set(pluginPath, pluginFile());
    },
    client: {
      defineConstant: async (name, value) => {
        trace.push(["constant", name]);
        f.constants.set(name, value);
      },
      mountOpfs: async (descriptor) => {
        calls.push("mount");
        trace.push(["mount", descriptor]);
        assert.equal(descriptor.mountpoint, "/wordpress");
        if (descriptor.initialSyncDirection === "opfs-to-memfs") {
          f.memory = structuredClone(f.saved);
        } else {
          assert.equal(descriptor.initialSyncDirection, "memfs-to-opfs");
          f.saved = structuredClone(f.memory);
        }
      },
      unmountOpfs: async (mountpoint) => {
        assert.equal(mountpoint, "/wordpress");
        assert.deepEqual(f.memory, f.saved, "version retry must unmount before modifying the saved project");
        calls.push("unmount");
        trace.push(["unmount", mountpoint]);
      },
      flushOpfs: async () => {
        calls.push("flush");
        trace.push(["flush"]);
        await f.onFlush?.();
        f.saved = structuredClone(f.memory);
      },
      backfillStaticFilesRemovedFromMinifiedBuild: async () => {
        trace.push(['backfill']);
        await f.onBackfill?.();
        f.memory.set('/wordpress/wp-admin/css/offline-fixture.css', encode('body { color: black; }'));
      },
      isDir: async (directory) => [...f.memory.keys()].some(file => file.startsWith(`${directory}/`)),
      isFile: async (file) => f.memory.has(file),
      fileExists: async (file) => f.memory.has(file),
      readFileAsBuffer: async (file) => {
        trace.push(["read", file]);
        if (!f.memory.has(file)) throw new Error(`Missing file: ${file}`);
        return f.memory.get(file).slice();
      },
      readFileAsText: async (file) => {
        trace.push(["read", file]);
        if (!f.memory.has(file)) throw new Error(`Missing file: ${file}`);
        return new TextDecoder().decode(f.memory.get(file));
      },
      mkdir: async (directory) => { trace.push(["mkdir", directory]); },
      writeFile: async (file, contents) => {
        trace.push(["write", file]);
        f.memory.set(file, typeof contents === "string" ? encode(contents) : contents.slice());
      },
      mv: async (source, destination) => {
        trace.push(["move", source, destination]);
        assert.ok(f.memory.has(source));
        assert.equal(f.memory.has(destination), false);
        f.memory.set(destination, f.memory.get(source));
        f.memory.delete(source);
      },
      run: async ({ code }) => {
        trace.push(["php", code]);
        if (f.onRun) return f.onRun(code);
        if (f.memory.has("/wordpress/.maintenance")) {
          return { exitCode: 1, errors: "WordPress exited in maintenance mode", bytes: new Uint8Array() };
        }
        const installedVersion = new TextDecoder().decode(f.memory.get(pluginPath) || new Uint8Array())
          .match(/Version:\s*(\S+)/)?.[1] || "";
        const wordpressVersion = new TextDecoder().decode(f.memory.get("/wordpress/wp-includes/version.php") || new Uint8Array())
          .match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/)?.[1] || "";
        return {
          exitCode: 0,
          errors: "",
          bytes: encode(
            code.includes("KODETY_HEALTH:")
              ? "KODETY_HEALTH:" + btoa(JSON.stringify({
                  active: Boolean(installedVersion),
                  phpVersion: "8.3",
                  wordpressVersion,
                  kodetyVersion: installedVersion,
                  wordpressLocale: "en_US",
                }))
              : code.includes("get_locale()") ? "en_US" : "KODETY_STUDIO_RUNTIME_READY",
          ),
        };
      },
      goTo: async (route) => {
        calls.push(route);
        trace.push(["navigate", route]);
      },
    },
  };
  globalThis.__studioRuntimeFixture = f;
  globalThis.window = { location: { origin: "http://studio-test.local" } };
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
  return f;
}
function project(patch = {}) {
  return {
    id: "test-project-runtime-123",
    name: "Fixture",
    initialized: false,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
    phpVersion: "8.3",
    wordpressVersion: "7.1",
    kodetyVersion: currentPluginVersion,
    wordpressLocale: "en_US",
    runtimeRevision: currentRuntimeRevision,
    ...patch,
  };
}

test('cloud restore runs only for a fresh project and completes before its first persistent mount', async () => {
  const f = fixture();
  const restoredPath = '/wordpress/wp-content/uploads/restored-copy.txt';
  await bootProject({
    iframe: {}, project: project(), language: 'en', onStage() {},
    restoreFirstBoot: async client => {
      assert.equal(f.calls.includes('mount'), false);
      f.trace.push(['cloud-restore']);
      await client.writeFile(restoredPath, 'Recovered content');
    },
    onPersisted: async () => {
      assert.equal(new TextDecoder().decode(f.saved.get(restoredPath)), 'Recovered content');
    },
  });
  assert.equal(f.trace.filter(([action]) => action === 'cloud-restore').length, 1);
  assert.ok(f.trace.findIndex(([action]) => action === 'cloud-restore') < f.trace.findIndex(([action]) => action === 'mount'));
  const savedDatabase = f.saved.get(databasePath).slice();
  await bootProject({
    iframe: {}, project: project({ initialized: true }), language: 'en', onStage() {},
    restoreFirstBoot: async () => { throw new Error('An existing local project must never be restored from R2'); },
  });
  assert.deepEqual(f.saved.get(databasePath), savedDatabase);
  assert.equal(new TextDecoder().decode(f.saved.get(restoredPath)), 'Recovered content');
});

test('a failed cloud restore cannot persist a partial project or report initialized metadata', async () => {
  const f = fixture();
  const previousSaved = structuredClone(f.saved);
  await assert.rejects(bootProject({
    iframe: {}, project: project(), language: 'en', onStage() {},
    restoreFirstBoot: async client => {
      await client.writeFile('/wordpress/wp-content/partial.txt', 'Incomplete recovery');
      throw new Error('Archive import failed');
    },
    onPersisted: async () => { throw new Error('Partial recovery must not be acknowledged'); },
  }), /Archive import failed/);
  assert.equal(f.calls.includes('mount'), false);
  assert.deepEqual(f.saved, previousSaved);
});

test("fresh install flushes files before reporting durable metadata", async () => {
  const f = fixture();
  const result = await bootProject({
    iframe: {},
    project: project(),
    language: "pt",
    onStage() {},
    onPersisted: async (durable) => {
      assert.equal(durable.initialized, true);
      assert.deepEqual(f.calls, ["install", "mount", "flush"]);
      f.calls.push("metadata");
    },
  });
  assert.equal(result.initializedNow, true);
  assert.deepEqual(f.calls, [
    "install",
    "mount",
    "flush",
    "metadata",
    "flush",
    "/wp-admin/",
  ]);
});

test("cancelled runtime does not install or overwrite project storage", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.onStart = () => controller.abort();
  await assert.rejects(
    bootProject({
      iframe: {},
      project: project(),
      language: "en",
      signal: controller.signal,
      onStage() {},
    }),
  );
  assert.deepEqual(f.calls, []);
});

test("cancellation during plugin installation prevents the first OPFS mount", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.onInstall = () => controller.abort();
  await assert.rejects(
    bootProject({
      iframe: {},
      project: project(),
      language: "en",
      signal: controller.signal,
      onStage() {},
    }),
  );
  assert.deepEqual(f.calls, ["install"]);
});

test("persisted retry restores OPFS instead of creating a second installation", async () => {
  const f = fixture();
  let durable;
  await assert.rejects(
    bootProject({
      iframe: {},
      project: project(),
      language: "en",
      onStage() {},
      onPersisted: async (value) => {
        durable = value;
        throw new Error("Metadata write failed");
      },
    }),
    /Metadata write failed/,
  );
  f.calls.length = 0;
  await bootProject({
    iframe: {},
    project: durable,
    language: "en",
    onStage() {},
  });
  assert.equal(f.options.wordpressInstallMode, "download-and-install");
  assert.equal(f.options.mounts, undefined);
  assert.equal(f.trace.filter(([action]) => action === "mount").at(-1)[1].initialSyncDirection, "opfs-to-memfs");
  assert.deepEqual(f.calls, ["mount", "flush", "/kodety/editor/"]);
});

test("older plugin is upgraded even when the runtime revision is unchanged", async () => {
  const f = fixture();
  f.saved.set(pluginPath, pluginFile("1.1.32"));
  await bootProject({
    iframe: {},
    project: project({ initialized: true, kodetyVersion: "1.1.32" }),
    language: "en",
    onStage() {},
  });
  assert.deepEqual(f.calls.slice(0, 2), ["mount", "install"]);
  assert.equal(f.options.mounts, undefined);
  assert.equal(f.trace.find(([action]) => action === "mount")[1].initialSyncDirection, "opfs-to-memfs");
});

test("the runtime revision reapplies the fixed package once for an existing plugin at the same version", async () => {
  const f = fixture();
  f.saved.set(pluginPath, pluginFile(currentPluginVersion));
  const result = await bootProject({
    iframe: {},
    project: project({ initialized: true, runtimeRevision: 8 }),
    language: "en",
    onStage() {},
  });
  assert.deepEqual(f.calls.slice(0, 2), ["mount", "install"]);
  assert.equal(result.runtimeRevision, currentRuntimeRevision);
  assert.equal(result.runtimeVersions.kodetyVersion, currentPluginVersion);
  f.calls.length = 0;
  await bootProject({
    iframe: {},
    project: project({ initialized: true, runtimeRevision: result.runtimeRevision }),
    language: "en",
    onStage() {},
  });
  assert.equal(f.calls.includes("install"), false);
});

test("missing plugin package fails before any project filesystem is mounted", async () => {
  const f = fixture();
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(
    bootProject({
      iframe: {},
      project: project(),
      language: "en",
      onStage() {},
    }),
    /404/,
  );
  assert.deepEqual(f.calls, []);
});

test("the WordPress installer never receives a saved project mount", async () => {
  for (const initialized of [false, true]) {
    const f = fixture();
    await bootProject({ iframe: {}, project: project({ initialized }), language: "en", onStage() {} });
    assert.equal(f.options.wordpressInstallMode, "download-and-install");
    assert.equal(f.options.mounts, undefined);
    if (initialized) {
      assert.equal(f.options.blueprint.login, false);
      assert.equal(f.options.blueprint.landingPage, "/wp-admin/kodety-studio-bootstrap.html");
      assert.deepEqual(f.options.blueprint.steps.map(step => step.step), ["writeFile"]);
      const placeholderPath = `/wordpress${f.options.blueprint.landingPage}`;
      const placeholder = new TextDecoder().decode(f.bootstrapFiles.get(placeholderPath));
      assert.match(placeholder, /^<!doctype html>/i);
      assert.doesNotMatch(placeholder, /<\?php|<script/i);
      assert.equal(f.memory.has(placeholderPath), false);
      assert.equal(f.saved.has(placeholderPath), false);
    } else {
      assert.equal(f.options.blueprint.landingPage, "/wp-admin/");
    }
  }
});

test("restoration and runtime identity precede plugin work and saved WordPress execution", async () => {
  const f = fixture();
  f.saved.set(pluginPath, pluginFile("1.1.32"));
  const originalDatabase = f.saved.get(databasePath).slice();
  await bootProject({
    iframe: {},
    project: project({ initialized: true, kodetyVersion: "1.1.32" }),
    language: "en",
    onStage() {},
  });
  const actions = f.trace.map(([action]) => action);
  assert.ok(actions.indexOf("constant") < actions.indexOf("mount"));
  assert.ok(actions.indexOf("mount") < actions.indexOf("install"));
  assert.ok(actions.indexOf("mount") < actions.indexOf("php"));
  assert.equal(f.constants.get("KODETY_BROWSER_STUDIO_RUNTIME"), project().id);
  assert.equal(f.memory.has("/wordpress/temporary-only.txt"), false);
  assert.deepEqual(f.saved.get(databasePath), originalDatabase);
});

test("invalid saved database stops before PHP, plugin installation, writes, or metadata", async () => {
  for (const invalid of [null, new Uint8Array(), new Uint8Array(4096)]) {
    const f = fixture();
    if (invalid === null) f.saved.delete(databasePath);
    else f.saved.set(databasePath, invalid);
    f.saved.set("/wordpress/.maintenance", encode("<?php $upgrading = 1788912000;"));
    const original = structuredClone(f.saved);
    let metadataCalls = 0;
    await assert.rejects(bootProject({
      iframe: {},
      project: project({ initialized: true, kodetyVersion: "1.0.0" }),
      language: "en",
      onStage() {},
      onPersisted() { metadataCalls += 1; },
    }), error => {
      assert.equal(error.cause?.code, invalid === null ? "DATABASE_MISSING" : "DATABASE_INVALID");
      return true;
    });
    assert.equal(f.options.mounts, undefined, "the disposable installer must never see the saved database");
    assert.equal(metadataCalls, 0);
    assert.deepEqual(f.calls, ["mount"]);
    assert.ok(f.trace.every(([action]) => !["php", "write", "mkdir", "install", "move", "flush", "navigate"].includes(action)));
    assert.deepEqual(f.saved, original);
    assert.deepEqual(f.memory, original);
  }
});

test("standard interrupted maintenance is preserved under a new name before WordPress loads", async () => {
  const f = fixture();
  const marker = encode("<?php $upgrading = 1788912000; ?>\n");
  f.saved.set("/wordpress/.maintenance", marker);
  await bootProject({ iframe: {}, project: project({ initialized: true }), language: "en", onStage() {} });
  const moved = f.trace.find(([action]) => action === "move");
  assert.equal(moved[1], "/wordpress/.maintenance");
  assert.match(moved[2], /^\/wordpress\/\.maintenance\.kodety-interrupted-\d+-[a-f0-9-]+$/);
  assert.equal(f.saved.has("/wordpress/.maintenance"), false);
  assert.deepEqual(f.saved.get(moved[2]), marker);
  assert.ok(f.trace.indexOf(moved) < f.trace.findIndex(([action]) => action === "php"));
  assert.equal(f.calls.at(-1), "/kodety/editor/");
});

test("custom maintenance content is neither executed nor altered", async () => {
  const f = fixture();
  f.saved.set("/wordpress/.maintenance", encode("<?php require '/custom/maintenance.php';"));
  const original = structuredClone(f.saved);
  await assert.rejects(
    bootProject({ iframe: {}, project: project({ initialized: true }), language: "en", onStage() {} }),
    /custom maintenance mode/,
  );
  assert.deepEqual(f.saved, original);
  assert.deepEqual(f.memory, original);
  assert.ok(f.trace.every(([action]) => !["move", "php", "install", "write", "flush"].includes(action)));
});

test("maintenance recovery does nothing when the project has no marker", async () => {
  const f = fixture();
  const original = structuredClone(f.memory);
  await recoverInterruptedMaintenance(f.client, "pt");
  assert.deepEqual(f.memory, original);
  assert.deepEqual(f.trace, []);
});

test("a newer plugin on disk is retained despite old shell metadata and runtime revision", async () => {
  const f = fixture();
  const newerVersion = `${Number(currentPluginVersion.split(".")[0]) + 1}.0.0`;
  const newerPlugin = pluginFile(newerVersion);
  f.saved.set(pluginPath, newerPlugin);
  globalThis.fetch = async () => { throw new Error("The bundled package must not replace a newer native update"); };
  const result = await bootProject({
    iframe: {},
    project: project({ initialized: true, kodetyVersion: "1.0.0", runtimeRevision: 0 }),
    language: "en",
    onStage() {},
  });
  assert.equal(f.calls.includes("install"), false);
  assert.deepEqual(f.saved.get(pluginPath), newerPlugin);
  assert.equal(result.runtimeVersions.kodetyVersion, newerVersion);
});

test("bundled plugin decisions compare versions without downgrading a newer install", () => {
  const newerVersion = `${Number(currentPluginVersion.split(".")[0]) + 1}.0.0`;
  assert.equal(needsBundledPlugin(newerVersion, 0), false);
  assert.equal(needsBundledPlugin("0.0.1", Number.MAX_SAFE_INTEGER), true);
  assert.equal(needsBundledPlugin("", Number.MAX_SAFE_INTEGER), true);
  assert.equal(needsBundledPlugin(currentPluginVersion, 0), true);
  assert.equal(needsBundledPlugin(currentPluginVersion, Number.MAX_SAFE_INTEGER), false);
});

test("ready and navigation wait until final filesystem persistence has completed", async () => {
  const f = fixture();
  let finishFlush;
  let enteredFlush;
  const waiting = new Promise(resolve => { enteredFlush = resolve; });
  const flush = new Promise(resolve => { finishFlush = resolve; });
  f.onFlush = () => { enteredFlush(); return flush; };
  let ready = false;
  const boot = bootProject({
    iframe: {}, project: project({ initialized: true }), language: "en", onStage() {},
  }).then(result => { ready = true; return result; });
  await waiting;
  assert.equal(ready, false);
  assert.equal(f.trace.some(([action]) => action === "navigate"), false);
  finishFlush();
  await boot;
  assert.equal(ready, true);
  assert.deepEqual(f.calls.slice(-2), ["flush", "/kodety/editor/"]);
  assert.ok(f.saved.has("/wordpress/wp-content/mu-plugins/kodety-studio-storage-persistence.php"));
});

test("a final flush failure prevents ready and navigation", async () => {
  const f = fixture();
  f.onFlush = () => { throw new Error("Storage write failed"); };
  await assert.rejects(
    bootProject({ iframe: {}, project: project({ initialized: true }), language: "en", onStage() {} }),
    /Storage write failed/,
  );
  assert.equal(f.trace.some(([action]) => action === "navigate"), false);
});

test('Web App prepares omitted WordPress static files and flushes them before opening the project', async () => {
  const f = fixture();
  await bootProject({ iframe: {}, project: project({ initialized: true }), language: 'en', prepareOffline: true, onStage() {} });
  const actions = f.trace.map(([action]) => action);
  assert.ok(actions.indexOf('mount') < actions.indexOf('backfill'));
  assert.ok(actions.indexOf('backfill') < actions.indexOf('flush'));
  assert.ok(f.saved.has('/wordpress/wp-admin/css/offline-fixture.css'));
  const bridge = new TextDecoder().decode(f.saved.get('/wordpress/wp-content/mu-plugins/kodety-studio-storage-persistence.php'));
  assert.match(bridge, /assets-required-for-offline-mode\.json/);
  assert.match(bridge, /offline-cache/);
});

test('offline preparation failure retains existing files and does not announce readiness', async () => {
  const f = fixture();
  f.onBackfill = () => { throw new Error('Offline files unavailable'); };
  const originalDatabase = f.saved.get(databasePath).slice();
  await assert.rejects(bootProject({ iframe: {}, project: project({ initialized: true }), language: 'en', prepareOffline: true, onStage() {} }), /Offline files unavailable/);
  assert.deepEqual(f.saved.get(databasePath), originalDatabase);
  assert.equal(f.trace.some(([action]) => action === 'navigate'), false);
});

test('the installed bridge reports trusted wp-admin edits without treating page load or Builder input as changes', async () => {
  const f = fixture();
  await bootProject({ iframe: {}, project: project({ initialized: true }), language: 'en', onStage() {} });
  const bridge = new TextDecoder().decode(f.saved.get('/wordpress/wp-content/mu-plugins/kodety-studio-storage-persistence.php'));
  assert.match(bridge, /is_admin\(\) \? 'true' : 'false'/);
  const script = bridge.match(/<script id="kodety-studio-storage-persistence">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'execute the exact JavaScript emitted in the installed mu-plugin');
  async function runBridge(isAdmin) {
    const messages = [];
    const listeners = new Map();
    const window = { top: { postMessage: message => messages.push(message) }, addEventListener() {} };
    const document = { addEventListener(type, handler) { listeners.set(type, handler); } };
    const context = { window, document, navigator: {} };
    const markup = script.replaceAll('__KODETY_STUDIO_PROJECT_ID__', JSON.stringify('wordpress-edit-fixture'))
      .replaceAll('__KODETY_STUDIO_PHP_VERSION__', JSON.stringify('8.3'))
      .replaceAll('__KODETY_STUDIO_IS_ADMIN__', String(isAdmin));
    runInNewContext(markup, context);
    await Promise.resolve();
    const changes = () => messages.filter(message => message.type === 'project-changed');
    const documentReady = () => messages.filter(message => message.type === 'admin-document-ready');
    assert.equal(documentReady().length, 1, 'the new document replaces any earlier admin form without claiming a backup');
    assert.equal(documentReady()[0].projectId, 'wordpress-edit-fixture');
    assert.equal(changes().length, 0, 'loading or checking storage/cache does not invalidate a ZIP');
    for (const type of ['input', 'change', 'submit']) listeners.get(type)?.({ isTrusted: false });
    assert.equal(changes().length, 0, 'script-generated events do not count as user edits');
    for (const type of ['input', 'change', 'submit']) listeners.get(type)?.({ isTrusted: true });
    assert.equal(changes().length, isAdmin ? 3 : 0);
    for (const message of changes()) {
      assert.equal(message.projectId, 'wordpress-edit-fixture');
      assert.equal(message.source, 'kodety-studio-wordpress');
      assert.equal(message.version, 1);
      assert.equal(message.pendingAdminDraft, true, 'submitting does not acknowledge persistence before a server response');
    }
    // Duplicate injection can happen through WordPress/custom page hooks.
    runInNewContext(markup, context);
    assert.equal(changes().length, isAdmin ? 3 : 0);
    assert.equal(documentReady().length, 1, 'duplicate injection must not clear an edited form draft');
  }
  await runBridge(true);
  await runBridge(false);
});

test("a restored WordPress PHP failure retains its actual cause instead of a generic SQLite error", async () => {
  const f = fixture();
  f.onRun = () => ({ exitCode: 1, errors: "Fatal error: Missing restored plugin dependency", bytes: new Uint8Array() });
  await assert.rejects(
    bootProject({ iframe: {}, project: project({ initialized: true }), language: "en", onStage() {} }),
    /Missing restored plugin dependency/,
  );
  assert.equal(f.calls.includes("flush"), false);
  assert.equal(f.trace.some(([action]) => action === "navigate"), false);
});

test("a native WordPress update rebuilds the temporary runtime once before touching saved content", async () => {
  const f = fixture();
  const original = structuredClone(f.saved);
  f.onStart = () => {
    assert.equal(f.options.mounts, undefined);
    if (f.bootOptions.length === 2) {
      assert.deepEqual(f.saved, original);
      assert.ok(f.trace.every(([action]) => !["php", "install", "write", "move", "flush", "navigate"].includes(action)));
      assert.deepEqual(f.calls, ["mount", "unmount"]);
    }
  };
  const result = await bootProject({
    iframe: {},
    project: project({ initialized: true, wordpressVersion: "7.0" }),
    language: "en",
    onStage() {},
  });
  assert.deepEqual(f.bootOptions.map(options => options.blueprint.preferredVersions.wp), ["7.0", "7.1"]);
  assert.ok(f.bootOptions.every(options => options.wordpressInstallMode === "download-and-install" && options.mounts === undefined));
  assert.deepEqual(f.calls, ["mount", "unmount", "mount", "flush", "/kodety/editor/"]);
  assert.deepEqual(f.saved.get(databasePath), original.get(databasePath));
  assert.equal(result.runtimeVersions.wordpressVersion, "7.1");
  assert.equal(f.saved.has("/wordpress/temporary-only.txt"), false);
});

test("a persistent runtime version mismatch stops after one retry without changing the saved project", async () => {
  const f = fixture();
  f.bootstrapVersion = "7.0";
  f.saved.set("/wordpress/.maintenance", encode("<?php $upgrading = 1788912000;"));
  const original = structuredClone(f.saved);
  let metadataCalls = 0;
  await assert.rejects(bootProject({
    iframe: {},
    project: project({ initialized: true, wordpressVersion: "7.0" }),
    language: "pt",
    onStage() {},
    onPersisted() { metadataCalls += 1; },
  }), /versão do WordPress carregada não corresponde aos arquivos salvos/);
  assert.deepEqual(f.bootOptions.map(options => options.blueprint.preferredVersions.wp), ["7.0", "7.1"]);
  assert.ok(f.bootOptions.every(options => options.mounts === undefined));
  assert.deepEqual(f.calls, ["mount", "unmount", "mount", "unmount"]);
  assert.equal(metadataCalls, 0);
  assert.deepEqual(f.saved, original);
  assert.deepEqual(f.memory, original);
  assert.ok(f.trace.every(([action]) => !["php", "install", "write", "move", "flush", "navigate"].includes(action)));
});
