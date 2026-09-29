import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const javascriptExtension = /\.(?:cjs|js|mjs)$/i;

/**
 * These roots mirror the browser JavaScript that the package scripts ship.
 * Node-only MCP/agent servers and external skill validators live elsewhere in
 * the main plugin and are deliberately outside this browser-runtime boundary.
 */
export const WORDPRESS_BROWSER_DISTRIBUTIONS = Object.freeze([
  Object.freeze({
    id: "plugin-main",
    label: "Main WordPress plugin",
    roots: Object.freeze([
      "Wordpress/kodety/assets",
      "Wordpress/kodety/admin",
    ]),
    singleFiles: Object.freeze([]),
    excludedFiles: Object.freeze([
      "Wordpress/kodety/assets/membership-runtime.js",
      "Wordpress/kodety/admin/email-marketing.js",
    ]),
    requiredFiles: Object.freeze([
      "Wordpress/kodety/assets/forms-runtime.js",
      "Wordpress/kodety/assets/public-routes-runtime.js",
      "Wordpress/kodety/assets/code-component-react-runtime.mjs",
    ]),
  }),

]);

/**
 * Patterns use canonical forward slashes. Before matching, escaped forward
 * slashes and Windows separators in string literals are normalized so emitted
 * code cannot bypass the boundary by spelling the same module or URL twice.
 */
export const FORBIDDEN_WORDPRESS_BROWSER_PATTERNS = Object.freeze([
  Object.freeze({
    id: "legacy-api-prefix",
    label: "legacy /kodety/api/ browser route prefix",
    pattern: /\/kodety\/api(?:\/|["'`]\s*\+\s*["'`]\/)/i,
    selfTestSource: 'fetch("/kodety/api/" + operation);\n',
  }),
  Object.freeze({
    id: "airtable-runtime",
    label: "Airtable browser module or runtime string",
    pattern: /airtable/i,
    selfTestSource: 'fetch("https://api.airtable.com/v0/base");\n',
  }),
  Object.freeze({
    id: "legacy-thumbnail-runtime",
    label: "legacy component thumbnail capture runtime",
    pattern: /(?:thumbnail-capture|uploadThumbnail|\/kodety\/api\/components\/[^\n;]{0,200}\/thumbnail)/i,
    selfTestSource: 'import("lib/client/thumbnail-capture.tsx");\n',
  }),
  Object.freeze({
    id: "app-settings-repository",
    label: "legacy appSettingsRepository browser module",
    pattern: /(?:lib\/repositories\/)?appSettingsRepository(?:\.[cm]?[jt]sx?)?/i,
    selfTestSource: 'import("lib/repositories/appSettingsRepository.ts");\n',
  }),
  Object.freeze({
    id: "supabase-runtime",
    label: "Supabase browser module or runtime string",
    pattern: /supabase/i,
    selfTestSource: 'import("node_modules/@supabase/supabase-js");\n',
  }),
  Object.freeze({
    id: "realtime-channel-module",
    label: "legacy realtime-channel browser module",
    pattern: /(?:lib\/)?realtime-channel(?:\.[cm]?[jt]sx?)?/i,
    selfTestSource: 'import("lib/realtime-channel.ts");\n',
  }),
  Object.freeze({
    id: "browser-auth-store",
    label: "legacy browser authentication store/runtime",
    pattern: /(?:stores\/useAuthStore(?:\.[cm]?[jt]sx?)?|\buseAuthStore\b|\bonAuthStateChange\b)/i,
    selfTestSource: 'import("stores/useAuthStore.ts");\n',
  }),
  Object.freeze({
    id: "next-browser-module",
    label: "Next.js browser module",
    pattern: /(?:node_modules\/next\/|(?:^|["'`\s(])next\/(?:client|dist|headers|image|link|navigation|router|script|server)\b)/im,
    selfTestSource: 'import("next/navigation");\n',
  }),
  Object.freeze({
    id: "next-browser-runtime",
    label: "Next.js emitted browser runtime string",
    pattern: /(?:\b__NEXT_DATA__\b|\/_next\/(?:image|static)\/)/i,
    selfTestSource: 'window.__NEXT_DATA__ = {};\n',
  }),
]);

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveInside(rootDirectory, relativePath) {
  const absoluteRoot = path.resolve(rootDirectory);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const fromRoot = path.relative(absoluteRoot, absolutePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`Runtime boundary path escapes its root: ${relativePath}.`);
  }
  return absolutePath;
}

async function collectJavaScriptTree(rootDirectory, relativeDirectory) {
  const absoluteDirectory = resolveInside(rootDirectory, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { files: [], missing: true };
    throw error;
  }

  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files = [];
  for (const entry of entries) {
    const relativePath = toPortablePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      const nested = await collectJavaScriptTree(rootDirectory, relativePath);
      files.push(...nested.files);
    } else if (entry.isFile() && javascriptExtension.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return { files, missing: false };
}

async function inspectRequiredArtifact(rootDirectory, relativePath) {
  try {
    const details = await stat(resolveInside(rootDirectory, relativePath));
    if (!details.isFile()) return "not a regular file";
    if (details.size === 0) return "empty";
    return null;
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

function canonicalizeBrowserSource(source) {
  return source
    .replaceAll("\\/", "/")
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/");
}

export async function scanWordPressBrowserRuntime({
  rootDirectory = root,
  distributions = WORDPRESS_BROWSER_DISTRIBUTIONS,
} = {}) {
  const files = [];
  const missingArtifacts = [];

  for (const distribution of distributions) {
    const excluded = new Set(distribution.excludedFiles ?? []);
    const distributionFiles = new Set();

    for (const relativeRoot of distribution.roots ?? []) {
      const collected = await collectJavaScriptTree(rootDirectory, relativeRoot);
      if (collected.missing) {
        missingArtifacts.push({
          distribution: distribution.id,
          distributionLabel: distribution.label,
          file: relativeRoot,
          reason: "missing distribution root",
        });
      }
      for (const relativePath of collected.files) distributionFiles.add(relativePath);
    }
    for (const relativePath of distribution.singleFiles ?? []) distributionFiles.add(relativePath);
    for (const relativePath of excluded) distributionFiles.delete(relativePath);

    for (const relativePath of distribution.requiredFiles ?? []) {
      const reason = await inspectRequiredArtifact(rootDirectory, relativePath);
      if (reason) {
        missingArtifacts.push({
          distribution: distribution.id,
          distributionLabel: distribution.label,
          file: relativePath,
          reason,
        });
      }
    }

    for (const relativePath of [...distributionFiles].sort()) {
      if (!javascriptExtension.test(relativePath)) continue;
      const absolutePath = resolveInside(rootDirectory, relativePath);
      let source;
      try {
        source = await readFile(absolutePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          if (!(distribution.requiredFiles ?? []).includes(relativePath)) {
            missingArtifacts.push({
              distribution: distribution.id,
              distributionLabel: distribution.label,
              file: relativePath,
              reason: "missing distributed file",
            });
          }
          continue;
        }
        throw error;
      }
      files.push({
        distribution: distribution.id,
        distributionLabel: distribution.label,
        file: relativePath,
        source,
      });
    }
  }

  const offenders = [];
  for (const file of files) {
    const canonicalSource = canonicalizeBrowserSource(file.source);
    for (const forbidden of FORBIDDEN_WORDPRESS_BROWSER_PATTERNS) {
      if (!forbidden.pattern.test(canonicalSource)) continue;
      offenders.push({
        distribution: file.distribution,
        distributionLabel: file.distributionLabel,
        file: file.file,
        pattern: forbidden.id,
        patternLabel: forbidden.label,
      });
    }
  }

  offenders.sort((left, right) => {
    const leftKey = `${left.distribution}\0${left.file}\0${left.pattern}`;
    const rightKey = `${right.distribution}\0${right.file}\0${right.pattern}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  missingArtifacts.sort((left, right) => {
    const leftKey = `${left.distribution}\0${left.file}\0${left.reason}`;
    const rightKey = `${right.distribution}\0${right.file}\0${right.reason}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  return {
    files: files.map(({ source: _source, ...file }) => file),
    missingArtifacts,
    offenders,
  };
}

export function assertWordPressBrowserRuntimeBoundary(result) {
  if (result.missingArtifacts.length === 0 && result.offenders.length === 0) return;

  const details = [
    ...result.missingArtifacts.map(item =>
      `- ${item.distributionLabel}: ${item.file} [artifact: ${item.reason}]`,
    ),
    ...result.offenders.map(item =>
      `- ${item.distributionLabel}: ${item.file} [pattern: ${item.pattern} — ${item.patternLabel}]`,
    ),
  ];
  throw new Error(
    `WordPress distributed browser runtime boundary failed:\n${details.join("\n")}`,
  );
}

async function writeFixture(rootDirectory, relativePath, source = "export const clean = true;\n") {
  const absolutePath = resolveInside(rootDirectory, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
}

async function runSelfTest() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "kodety-browser-runtime-boundary-"));
  const fixtureTargets = [
    "Wordpress/kodety/admin/runtime-boundary-fixture.js",
  ];

  try {
    for (const distribution of WORDPRESS_BROWSER_DISTRIBUTIONS) {
      for (const relativeRoot of distribution.roots) {
        await mkdir(resolveInside(fixtureRoot, relativeRoot), { recursive: true });
      }
      for (const requiredFile of distribution.requiredFiles) {
        await writeFixture(fixtureRoot, requiredFile);
      }
    }
    for (const target of fixtureTargets) await writeFixture(fixtureRoot, target);

    const clean = await scanWordPressBrowserRuntime({ rootDirectory: fixtureRoot });
    assert.deepEqual(clean.missingArtifacts, [], "Clean fixture has all prepared artifacts.");
    assert.deepEqual(clean.offenders, [], "Clean fixture must pass the runtime boundary.");
    assert.ok(
      clean.files.some(file => file.file.endsWith("forms-runtime.js")),
      "Forms runtime must belong to the scanned set.",
    );
    assert.ok(
      clean.files.some(file => file.file.endsWith("public-routes-runtime.js")),
      "Public routes runtime must belong to the scanned set.",
    );
    assert.ok(
      clean.files.some(file => file.file.endsWith("code-component-react-runtime.mjs")),
      "Code Component React runtime must belong to the scanned set.",
    );

    let checks = 3;
    for (const [index, forbidden] of FORBIDDEN_WORDPRESS_BROWSER_PATTERNS.entries()) {
      const target = fixtureTargets[index % fixtureTargets.length];
      await writeFixture(fixtureRoot, target, forbidden.selfTestSource);
      const result = await scanWordPressBrowserRuntime({ rootDirectory: fixtureRoot });
      const offender = result.offenders.find(item =>
        item.file === target && item.pattern === forbidden.id,
      );
      assert.ok(offender, `${forbidden.id} fixture was not rejected in ${target}.`);
      let failureMessage = "";
      assert.throws(
        () => assertWordPressBrowserRuntimeBoundary(result),
        error => {
          failureMessage = String(error?.message ?? error);
          return failureMessage.includes("WordPress distributed browser runtime boundary failed");
        },
      );
      assert.ok(
        failureMessage.includes(target)
          && failureMessage.includes(forbidden.id)
          && failureMessage.includes(forbidden.label),
        "Failure diagnostics must identify file, pattern, and label.",
      );
      await writeFixture(fixtureRoot, target);
      checks += 2;
    }

    await writeFixture(
      fixtureRoot,
      fixtureTargets[0],
      'const route = "\\/kodety\\/api\\/" + operation;\n',
    );
    const escapedRoute = await scanWordPressBrowserRuntime({ rootDirectory: fixtureRoot });
    assert.ok(
      escapedRoute.offenders.some(item => item.pattern === "legacy-api-prefix"),
      "Escaped/concatenated legacy API prefixes must be rejected.",
    );
    checks += 1;
    await writeFixture(fixtureRoot, fixtureTargets[0]);

    await writeFixture(
      fixtureRoot,
      fixtureTargets[0],
      'const route = "/kodety/api" + "/" + operation;\n',
    );
    const splitRoute = await scanWordPressBrowserRuntime({ rootDirectory: fixtureRoot });
    assert.ok(
      splitRoute.offenders.some(item => item.pattern === "legacy-api-prefix"),
      "Split legacy API prefixes must be rejected before a variable suffix is appended.",
    );
    checks += 1;
    await writeFixture(fixtureRoot, fixtureTargets[0]);

    await rm(
      resolveInside(fixtureRoot, "Wordpress/kodety/assets/forms-runtime.js"),
      { force: true },
    );
    const missingRuntime = await scanWordPressBrowserRuntime({ rootDirectory: fixtureRoot });
    assert.ok(
      missingRuntime.missingArtifacts.some(item =>
        item.file === "Wordpress/kodety/assets/forms-runtime.js" && item.reason === "missing",
      ),
      "A missing prepared standalone runtime must fail closed.",
    );
    checks += 1;

    console.log(`WordPress browser runtime boundary self-test passed: ${checks} checks.`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function main() {
  const supportedArguments = new Set(["--self-test"]);
  const unknownArguments = process.argv.slice(2).filter(argument => !supportedArguments.has(argument));
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}.`);
  }
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }

  const result = await scanWordPressBrowserRuntime();
  assertWordPressBrowserRuntimeBoundary(result);
  const distributionCount = new Set(result.files.map(file => file.distribution)).size;
  console.log(
    `WordPress browser runtime boundary passed: ${result.files.length} JavaScript files across ${distributionCount} distributions.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  await main();
}
