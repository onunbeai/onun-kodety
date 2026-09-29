import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const {
  kodety: { wordpressVersion: currentPluginVersion },
} = JSON.parse(
  await readFile(path.resolve(testRoot, "../../../package.json"), "utf8"),
);
const scratch = await mkdtemp(path.join(tmpdir(), "kodety-web-library-test-"));
await build({
  entryPoints: [path.join(testRoot, "../src/project-library.ts")],
  outfile: path.join(scratch, "library.mjs"),
  platform: "node",
  format: "esm",
  bundle: true,
  logLevel: "silent",
});
const { createProjectRepository, parseLibrary, visibleProjects, LIBRARY_KEY, LibraryError } =
  await import(pathToFileURL(path.join(scratch, "library.mjs")).href);
after(() => rm(scratch, { recursive: true, force: true }));

function fixture(initial = null) {
  let raw = initial;
  let failure = false;
  let tail = Promise.resolve();
  const lock = (operation) => {
    const next = tail.then(operation);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const storage = {
    getItem: (key) => {
      assert.equal(key, LIBRARY_KEY);
      return raw;
    },
    setItem: (_key, value) => {
      if (failure) throw new DOMException("No space", "QuotaExceededError");
      raw = value;
    },
  };
  return {
    repository: createProjectRepository(storage, lock),
    otherTab: createProjectRepository(storage, lock),
    raw: () => raw,
    setFull: (value) => {
      failure = value;
    },
  };
}

test("first creation persists the correct project and product version", async () => {
  const f = fixture();
  const { project } = await f.repository.create(
    "  Portfólio   novo  ",
    "pt_BR",
  );
  assert.equal(project.name, "Portfólio novo");
  assert.equal(project.initialized, false);
  assert.equal(project.mode, "html");
  assert.equal(project.kodetyVersion, currentPluginVersion);
  assert.equal(project.wordpressLocale, "pt_BR");
  assert.equal(JSON.parse(f.raw())[0].id, project.id);
});

test("concurrent creations from two tabs do not lose records", async () => {
  const f = fixture();
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      (index % 2 ? f.repository : f.otherTab).create(
        `Project ${index}`,
        "en_US",
      ),
    ),
  );
  assert.equal(f.repository.read().length, 24);
  assert.equal(new Set(f.repository.read().map((item) => item.id)).size, 24);
});

test("duplicate names are checked inside the transaction, including accents and spacing", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([
    f.repository.create("Clínica nova", "pt_BR"),
    f.otherTab.create(" CLINICA  NOVA ", "en_US"),
  ]);
  assert.equal(
    outcomes.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.find((item) => item.status === "rejected").reason.code,
    "duplicate",
  );
  assert.equal(f.repository.read().length, 1);
});

test("quota failure preserves existing bytes and allows a retry", async () => {
  const f = fixture();
  await f.repository.create("Existing", "en_US");
  const original = f.raw();
  f.setFull(true);
  await assert.rejects(f.repository.create("New project", "en_US"), {
    code: "quota",
  });
  assert.equal(f.raw(), original);
  f.setFull(false);
  await f.repository.create("New project", "en_US");
  assert.equal(f.repository.read().length, 2);
});

test("corrupt metadata blocks writes instead of replacing the library", async () => {
  for (const original of ["{broken", "{}", '[{"id":"invalid"}]', "null"]) {
    const f = fixture(original);
    assert.throws(() => f.repository.read(), { code: "corrupt" });
    await assert.rejects(f.repository.create("Project", "en_US"), {
      code: "corrupt",
    });
    assert.equal(f.raw(), original);
  }
});

test("legacy project migration preserves ID, runtime association and stored versions", () => {
  const [project] = parseLibrary(
    JSON.stringify([
      {
        id: "legacy-project-123",
        name: "Legacy",
        initialized: true,
        createdAt: 1,
        updatedAt: 2,
        kodetyVersion: "1.1.30",
      },
    ]),
  );
  assert.equal(project.id, "legacy-project-123");
  assert.equal(project.wordpressLocale, "en_US");
  assert.equal(project.kodetyVersion, "1.1.30");
  assert.equal(project.runtimeRevision, 0);
  assert.equal(project.storageMode, "folder");
  assert.equal(project.manualBackupAcknowledgedAt, undefined);
});

test("manual ZIP choice and consent on existing projects survive reload, rename and runtime updates in both modes", async () => {
  for (const mode of ["html", "wordpress"]) {
    const acknowledgedAt = Date.now();
    const project = {
      id: "existing-manual-backup", name: "Manual backup", initialized: true,
      createdAt: 1, updatedAt: 2, wordpressLocale: "pt_BR",
      mode, storageMode: "browser", manualBackupAcknowledgedAt: acknowledgedAt,
    };
    const f = fixture(JSON.stringify([project]));
    await f.otherTab.patch(project.id, { name: "Renamed", initialized: true });
    const [restored] = parseLibrary(f.raw());
    assert.equal(restored.mode, mode);
    assert.equal(restored.storageMode, "browser");
    assert.equal(restored.manualBackupAcknowledgedAt, acknowledgedAt);
    assert.equal(restored.directoryName, undefined);
    assert.equal(restored.name, "Renamed");
  }
});

test("unknown storage modes are not silently migrated into another storage location", async () => {
  const f = fixture();
  const { project } = await f.repository.create("Existing", "en_US");
  assert.throws(() => parseLibrary(JSON.stringify([{ ...project, storageMode: "unknown" }])), { code: "corrupt" });
});

test("runtime patches cannot undo a concurrent rename or favorite", async () => {
  const f = fixture();
  const { project } = await f.repository.create("Original", "en_US");
  await Promise.all([
    f.repository.patch(project.id, { name: "Renamed", favorite: true }),
    f.otherTab.patch(project.id, { initialized: true, runtimeRevision: 8 }),
  ]);
  const [latest] = f.repository.read();
  assert.equal(latest.name, "Renamed");
  assert.equal(latest.favorite, true);
  assert.equal(latest.initialized, true);
});

test("a late callback cannot resurrect a removed project", async () => {
  const f = fixture();
  const { project } = await f.repository.create("Disposable fixture", "en_US");
  await f.repository.remove(project.id);
  await assert.rejects(f.otherTab.patch(project.id, { initialized: true }), {
    code: "missing",
  });
  assert.deepEqual(f.repository.read(), []);
});

test("name validation rejects empty, too long, and control-character input", async () => {
  const f = fixture();
  for (const value of [" ", "a".repeat(81), "test\u0000name"])
    await assert.rejects(f.repository.create(value, "en_US"), { code: "name" });
  assert.equal(f.raw(), null);
});

test("search ignores accents, favorite filter and sorting preserve underlying records", async () => {
  const f = fixture();
  const { project } = await f.repository.create("Clínica", "pt_BR");
  await f.repository.create("Agência", "pt_BR");
  await f.repository.patch(project.id, { favorite: true });
  const projects = f.repository.read();
  const before = JSON.stringify(projects);
  assert.equal(
    visibleProjects(projects, "clinica", "all", "recent")[0].id,
    project.id,
  );
  assert.equal(visibleProjects(projects, "", "favorites", "recent").length, 1);
  assert.equal(visibleProjects(projects, "", "all", "name")[0].name, "Agência");
  assert.equal(visibleProjects(projects, "not found", "all", "name").length, 0);
  assert.equal(JSON.stringify(projects), before);
});

test("HTML mode persists across reopen and legacy records stay WordPress", async () => {
  const f = fixture();
  const { project } = await f.repository.create("Static portfolio", "pt_BR", {
    mode: "html",
    directoryName: "portfolio",
  });
  assert.equal(project.mode, "html");
  assert.equal(f.otherTab.read()[0].mode, "html");
  assert.equal(f.otherTab.read()[0].directoryName, "portfolio");
  const legacy = { ...project };
  delete legacy.mode;
  assert.equal(parseLibrary(JSON.stringify([legacy]))[0].mode, "wordpress");
  assert.throws(
    () => parseLibrary(JSON.stringify([{ ...project, mode: "invalid" }])),
    { code: "corrupt" },
  );
});

test("directory binding must complete before catalog insertion; failure keeps the library intact", async () => {
  const f = fixture();
  await f.repository.create("Existing", "pt_BR");
  const original = f.raw();
  await assert.rejects(
    f.repository.create("No permission", "pt_BR", {
      mode: "html",
      prepare: async () => {
        throw new Error("Folder access denied");
      },
    }),
    /Folder access denied/,
  );
  assert.equal(f.raw(), original);
  let preparedId;
  const { project } = await f.repository.create("Prepared", "pt_BR", {
    mode: "html",
    prepare: async (candidate) => {
      preparedId = candidate.id;
      assert.equal(
        f.repository.read().some((item) => item.id === candidate.id),
        false,
      );
    },
  });
  assert.equal(project.id, preparedId);
});

test("the actual library projection combines HTML and WordPress in overview, search, favorites and counts", async () => {
  const ts = await import('typescript').then(module => module.default);
  const source = await readFile(path.join(testRoot, '../src/app.tsx'), 'utf8');
  const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  // Execute the actual app expressions: a mode filter reintroduced before
  // visibleProjects must fail this regression, even if repository tests pass.
  const projectView = new Function('localProjects', 'query', 'view', 'sort', 'visibleProjects', 'useMemo', 'libraryMode', 'defaultProjectMode', `
    const projects = ${declarations.get('projects')};
    const visible = ${declarations.get('visible')};
    const displayed = ${declarations.get('displayed')};
    const favorites = ${declarations.get('favorites')};
    const readyCount = ${declarations.get('readyCount')};
    return { visible, displayed, favorites, readyCount };
  `);
  const projects = Array.from({ length: 8 }, (_, index) => ({
    id: `mixed-${index}`, name: `Mixed ${index}`, mode: index % 2 ? 'wordpress' : 'html',
    favorite: index < 4, initialized: index < 6, createdAt: index + 1, updatedAt: index + 1, lastOpenedAt: index + 1,
  }));
  const before = JSON.stringify(projects);
  for (const defaultMode of ['html', 'wordpress']) {
    const select = (view, query = '') => projectView(projects, query, view, 'recent', visibleProjects, callback => callback(), defaultMode, defaultMode);
    const all = select('projects');
    assert.equal(all.visible.length, 8);
    assert.deepEqual(new Set(all.visible.map(project => project.mode)), new Set(['html', 'wordpress']));
    assert.equal(all.favorites, 4);
    assert.equal(all.readyCount, 6);
    assert.equal(select('overview').displayed.length, 6);
    assert.equal(select('favorites').visible.length, 4);
    assert.equal(select('projects', 'Mixed 0').visible[0].mode, 'html');
    assert.equal(select('projects', 'Mixed 1').visible[0].mode, 'wordpress');
    assert.equal(select('local').visible.length, 8, 'Local and WordPress projects remain available without an account');
  }
  assert.equal(JSON.stringify(projects), before);
});

test("new WordPress creation is rejected before directory preparation and leaves legacy projects untouched", async () => {
  const legacy = { id: "legacy-wordpress", name: "Legacy", initialized: true, createdAt: 1, updatedAt: 2 };
  const f = fixture(JSON.stringify([legacy]));
  const original = f.raw();
  let prepared = false;
  await assert.rejects(f.repository.create("New WordPress", "pt_BR", {
    mode: "wordpress",
    prepare: async () => { prepared = true; },
  }), { code: "mode" });
  assert.equal(prepared, false);
  assert.equal(f.raw(), original);
  const { project } = await f.repository.create("New HTML", "pt_BR");
  assert.equal(project.mode, "html");
  assert.equal(f.repository.read().find(project => project.id === legacy.id).mode, "wordpress");
  await f.repository.patch(legacy.id, { name: "Legacy renamed" });
  assert.equal(f.repository.read().find(project => project.id === legacy.id).mode, "wordpress");
  await f.repository.remove(legacy.id);
  assert.deepEqual(f.repository.read().map(project => project.id), [project.id]);
});

test("explicit backup recovery retains WordPress mode and prepares a fresh copy before insertion", async () => {
  const f = fixture();
  await f.repository.create("Original HTML", "en_US");
  const before = f.repository.read();
  let prepared;
  const { project } = await f.repository.restore("Recovered WordPress", "pt_BR", {
    mode: "wordpress", storageMode: "browser",
    runtimeVersions: { phpVersion: "8.3", wordpressVersion: "6.7" },
    prepare: async candidate => {
      prepared = candidate.id;
      assert.deepEqual(f.repository.read(), before);
    },
  });
  assert.equal(project.id, prepared);
  assert.equal(project.mode, "wordpress");
  assert.equal(project.wordpressVersion, "6.7");
  assert.equal(project.initialized, false);
  assert.deepEqual(f.repository.read().filter(item => item.id !== project.id), before);
  const bytes = f.raw();
  await assert.rejects(f.repository.restore("Failed recovery", "en_US", {
    mode: "wordpress", prepare: async () => { throw new Error("Invalid archive"); },
  }), /Invalid archive/);
  assert.equal(f.raw(), bytes);
});

test("the actual create action rejects a stale WordPress mode and opens only new HTML projects", async () => {
  const ts = await import('typescript').then(module => module.default);
  const source = await readFile(path.join(testRoot, '../src/app.tsx'), 'utf8');
  const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submitSource;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submitProject') submitSource = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(submitSource);
  const compiled = ts.transpileModule(`const submit = ${submitSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const f = fixture();
  const prepared = [];
  let opened;
  const submit = new Function('repository', 'form', 'setProjects', 'setForm', 'enterProject', 'bindHtmlDirectory', 'createManagedHtmlDirectory', 'LibraryError', `${compiled}\nreturn submit;`)(f.repository, 'create', () => {}, () => {}, project => { opened = project; }, async (id, directory) => { prepared.push({ id, directory }); }, async id => { prepared.push({ id }); }, LibraryError);
  await assert.rejects(submit('Blocked WordPress', 'en_US', 'wordpress', { name: 'chosen-folder' }, 'folder'), { code: 'mode' });
  assert.equal(opened, undefined);
  assert.deepEqual(prepared, []);
  const directory = { name: 'chosen-folder' };
  await submit('New HTML folder project', 'en_US', 'html', directory, 'folder');
  assert.equal(opened.mode, 'html');
  assert.equal(opened.storageMode, 'folder');
  assert.deepEqual(prepared[0], { id: opened.id, directory });
  assert.equal(f.repository.read().length, 1);
  await submit('New HTML browser project', 'en_US', 'html', null, 'browser');
  assert.equal(opened.storageMode, 'browser');
  assert.deepEqual(prepared[1], { id: opened.id });
  assert.equal(f.repository.read().length, 2);
});
