import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), "kodety-onboarding-test-"));
await build({
  entryPoints: [path.join(testRoot, "../src/onboarding-state.ts")],
  outfile: path.join(scratch, "onboarding.mjs"),
  platform: "node",
  format: "esm",
  bundle: true,
  logLevel: "silent",
});
const {
  WEB_ONBOARDING_KEY,
  WEB_ONBOARDING_VERSION,
  WEB_DEFAULT_PROJECT_MODE_KEY,
  shouldShowWebOnboarding,
  completeWebOnboarding,
  loadDefaultProjectMode,
  rememberDefaultProjectMode,
} = await import(pathToFileURL(path.join(scratch, "onboarding.mjs")).href);
after(() => rm(scratch, { recursive: true, force: true }));

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("first visit shows the guide without recording completion", () => {
  const storage = fixture();
  assert.equal(shouldShowWebOnboarding(storage), true);
  assert.equal(storage.data.size, 0);
  assert.equal(shouldShowWebOnboarding(storage), true);
});

test("existing users who completed the previous guide skip onboarding", () => {
  const storage = fixture({
    kodetyStudioPreferencesV1: JSON.stringify({
      language: "en",
      onboardingVersion: 1,
    }),
  });
  assert.equal(shouldShowWebOnboarding(storage), false);
});

test("completion persists across visits without modifying projects or preferences", () => {
  const storage = fixture({
    kodetyStudioProjectsV1: "original project data",
    kodetyStudioPreferencesV1: "original preferences",
  });
  completeWebOnboarding(storage);
  assert.equal(
    storage.getItem(WEB_ONBOARDING_KEY),
    String(WEB_ONBOARDING_VERSION),
  );
  assert.equal(shouldShowWebOnboarding(storage), false);
  assert.equal(
    storage.getItem("kodetyStudioProjectsV1"),
    "original project data",
  );
  assert.equal(
    storage.getItem("kodetyStudioPreferencesV1"),
    "original preferences",
  );
});

test("a newer completed guide is respected", () => {
  const storage = fixture({
    [WEB_ONBOARDING_KEY]: String(WEB_ONBOARDING_VERSION + 1),
  });
  assert.equal(shouldShowWebOnboarding(storage), false);
});

test("missing or invalid completion data keeps the guide available", () => {
  for (const version of ["", "0", "-1", "invalid", "NaN", "Infinity", "1.5"]) {
    assert.equal(
      shouldShowWebOnboarding(fixture({ [WEB_ONBOARDING_KEY]: version })),
      true,
    );
  }
});

test("blocked storage reads do not prevent opening the guide", () => {
  assert.equal(
    shouldShowWebOnboarding({
      getItem() {
        throw new Error("Storage blocked");
      },
    }),
    true,
  );
});

test("failed completion is surfaced, not silently recorded", () => {
  const storage = fixture();
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  assert.throws(() => completeWebOnboarding(storage), /Quota exceeded/);
  assert.equal(shouldShowWebOnboarding(storage), true);
});

test("the earlier WordPress-only guide still counts as completed", () => {
  assert.equal(
    shouldShowWebOnboarding(fixture({ [WEB_ONBOARDING_KEY]: "1" })),
    false,
  );
});

test("new projects default to HTML even with a legacy WordPress preference, without rewriting stored data", () => {
  for (const value of [undefined, "wordpress", "html", "", "invalid", "HTML", "null"]) {
    const storage = fixture(value === undefined ? {} : { [WEB_DEFAULT_PROJECT_MODE_KEY]: value });
    const before = [...storage.data];
    assert.equal(loadDefaultProjectMode(storage), "html");
    assert.deepEqual([...storage.data], before);
  }
});

test("completion survives reload and every mode preference is normalized to HTML", () => {
  const storage = fixture();
  assert.equal(shouldShowWebOnboarding(storage), true);
  assert.equal(loadDefaultProjectMode(storage), "html");
  for (const mode of ["wordpress", "html"]) {
    rememberDefaultProjectMode(mode, storage);
    completeWebOnboarding(storage);
    const reopened = fixture(Object.fromEntries(storage.data));
    assert.equal(shouldShowWebOnboarding(reopened), false);
    assert.equal(loadDefaultProjectMode(reopened), "html");
    assert.equal(reopened.getItem(WEB_DEFAULT_PROJECT_MODE_KEY), "html");
  }
});

test("remembering the mode alone does not finish an incomplete guide", () => {
  const storage = fixture();
  rememberDefaultProjectMode("wordpress", storage);
  assert.equal(loadDefaultProjectMode(storage), "html");
  assert.equal(shouldShowWebOnboarding(storage), true);
});

test("failed mode persistence is surfaced; a failed read safely defaults to HTML", () => {
  assert.equal(loadDefaultProjectMode({ getItem() { throw new Error("Blocked"); } }), "html");
  assert.throws(() => rememberDefaultProjectMode("wordpress", { setItem() { throw new Error("Blocked"); } }), /Blocked/);
});
