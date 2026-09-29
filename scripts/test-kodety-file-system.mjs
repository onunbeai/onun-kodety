import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KODETY_FILE_SYSTEM_ARCHIVE,
  KODETY_FILE_SYSTEM_DIRECTORY,
  KODETY_FILE_SYSTEM_ENTRY,
  collectFileSystemPackageRecords,
  createFileSystemArchive,
  forbiddenFileSystemPackagePathReason,
  lintFileSystemPhp,
  normalizeFileSystemPackagePath,
  readExpectedFileSystemVersion,
  validateFileSystemPackageRecords,
  verifyFileSystemArchive,
} from "./kodety-file-system-package-contracts.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const wordpress = path.join(root, "Wordpress");
const pluginDirectory = path.join(wordpress, KODETY_FILE_SYSTEM_DIRECTORY);
const sourceDirectory = path.join(wordpress, "file-system");
const archivePath = path.join(
  wordpress,
  "dist",
  KODETY_FILE_SYSTEM_ARCHIVE,
);

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function fileSystemSourceHash(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fileSystemSourceHash(absolute, relative));
    else if (entry.isFile()) files.push({ path: relative, data: await readFile(absolute) });
  }
  if (prefix) return files;
  const hash = createHash("sha256");
  files.sort((left, right) => left.path.localeCompare(right.path));
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.data);
    hash.update("\0");
  }
  return hash.digest("hex");
}

for (const invalidPath of [
  "../escape.php",
  "safe/../../escape.php",
  "/absolute.php",
  "C:\\absolute.php",
  "\\\\server\\share\\file.php",
  "safe//file.php",
  "safe/./file.php",
  "safe/\0file.php",
  "%2e%2e/escape.php",
  "%252e%252e/escape.php",
  "safe%2f..%2fescape.php",
]) {
  assert.throws(
    () => normalizeFileSystemPackagePath(invalidPath),
    undefined,
    `Caminho inseguro aceito no pacote: ${JSON.stringify(invalidPath)}.`,
  );
}
assert.equal(
  normalizeFileSystemPackagePath("includes/class-safe.php"),
  "includes/class-safe.php",
);
for (const zipSlipPath of [
  "../outside.php",
  "safe/../../outside.php",
  "safe\\..\\outside.php",
  "%2e%2e/outside.php",
]) {
  await assert.rejects(
    createFileSystemArchive([
      { path: zipSlipPath, data: Buffer.from("unsafe"), size: 6 },
    ]),
    undefined,
    `ZIP Slip aceito: ${zipSlipPath}.`,
  );
}
for (const [candidate, reason] of [
  ["node_modules/library/index.js", "desenvolvimento"],
  ["tests/runtime.php", "desenvolvimento"],
  ["assets/app.js.map", "source map"],
  [".env.production", "secreto"],
  ["credentials.json", "secreto"],
  ["private.pem", "privado"],
  ["src/app.tsx", "frontend"],
]) {
  assert.match(
    forbiddenFileSystemPackagePathReason(candidate) || "",
    new RegExp(reason, "i"),
    `Artefato proibido nao foi identificado: ${candidate}.`,
  );
}

const fixtureVersion = "1.2.3";
const fixtureBootstrap = Buffer.from(`<?php
/**
 * Plugin Name: Kodety File System
 * Version: ${fixtureVersion}
 */
define('KODETY_FS_VERSION', '${fixtureVersion}');
`);
const fixtureRecords = [
  {
    path: KODETY_FILE_SYSTEM_ENTRY,
    data: fixtureBootstrap,
    size: fixtureBootstrap.length,
  },
  { path: "assets/app.css", data: Buffer.from("body{}"), size: 6 },
];
const firstFixtureArchive = await createFileSystemArchive(fixtureRecords);
const secondFixtureArchive = await createFileSystemArchive(
  [...fixtureRecords].reverse(),
);
assert.ok(
  firstFixtureArchive.equals(secondFixtureArchive),
  "A ordem de leitura da arvore nao pode alterar o ZIP.",
);
await verifyFileSystemArchive(firstFixtureArchive, {
  records: fixtureRecords,
  expectedVersion: fixtureVersion,
});

// Flip the first compressed payload byte while preserving the central
// directory. JSZip's checkCRC32 must reject the damaged package.
const corruptedArchive = Buffer.from(firstFixtureArchive);
const localHeader = corruptedArchive.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
assert.ok(localHeader >= 0, "Fixture ZIP sem local file header.");
const fileNameLength = corruptedArchive.readUInt16LE(localHeader + 26);
const extraLength = corruptedArchive.readUInt16LE(localHeader + 28);
const payloadOffset = localHeader + 30 + fileNameLength + extraLength;
corruptedArchive[payloadOffset] ^= 0x01;
await assert.rejects(
  verifyFileSystemArchive(corruptedArchive, {
    records: fixtureRecords,
    expectedVersion: fixtureVersion,
  }),
  undefined,
  "CRC/conteudo corrompido deve ser recusado.",
);

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "kodety-file-system-package-test-"),
);
try {
  await writeFile(path.join(temporaryRoot, "safe.php"), "<?php\n");
  await symlink(
    path.join(temporaryRoot, "safe.php"),
    path.join(temporaryRoot, "linked.php"),
  );
  await assert.rejects(
    collectFileSystemPackageRecords(temporaryRoot),
    /Link simbolico proibido/,
  );

  await rm(path.join(temporaryRoot, "linked.php"));
  await mkdir(path.join(temporaryRoot, "nested"));
  await writeFile(
    path.join(temporaryRoot, "nested", "secret.php"),
    "<?php /* -----BEGIN PRIVATE KEY----- */\n",
  );
  await assert.rejects(
    collectFileSystemPackageRecords(temporaryRoot),
    /Segredo embutido/,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

if (!(await exists(pluginDirectory))) {
  console.log(
    "Kodety File System source not present yet; package fixtures passed and source checks were skipped.",
  );
  process.exit(0);
}

const runtimeTestPath = path.join(wordpress, "tests", "file-system-runtime.php");
const completionMarkers = [
  "templates/app-shell.php",
  "assets/app.js",
  "assets/app.css",
  "includes/class-kodety-fs-local-provider.php",
  "includes/class-kodety-fs-remote-provider.php",
  "includes/class-kodety-fs-rest-controller.php",
  "includes/class-kodety-fs-plugin.php",
];
const missingCompletionMarkers = [];
for (const marker of completionMarkers) {
  if (!(await exists(path.join(pluginDirectory, marker)))) {
    missingCompletionMarkers.push(marker);
  }
}
if (missingCompletionMarkers.length > 0) {
  const partialRecords = await collectFileSystemPackageRecords(pluginDirectory);
  lintFileSystemPhp(partialRecords);
  execFileSync("php", [runtimeTestPath], { cwd: root, stdio: "inherit" });
  console.log(
    "Kodety File System is still being assembled; partial source/security " +
      `contracts passed. Awaiting: ${missingCompletionMarkers.join(", ")}.`,
  );
  process.exit(0);
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const expectedVersion = readExpectedFileSystemVersion(packageJson);
const records = await collectFileSystemPackageRecords(pluginDirectory);
const validation = validateFileSystemPackageRecords(records, expectedVersion);
const appBundle = await readFile(path.join(pluginDirectory, "assets", "app.js"), "utf8");
const sourceMarker = appBundle.match(/kodety-fs-source-sha256:([a-f0-9]{64})/);
assert.ok(sourceMarker, "Bundle do File System não declara o hash das fontes.");
assert.equal(
  sourceMarker[1],
  await fileSystemSourceHash(sourceDirectory),
  "Bundle do File System está desatualizado em relação às fontes TS/CSS.",
);
assert.equal(
  lintFileSystemPhp(records),
  validation.phpFileCount,
  "Todo PHP distribuido deve passar por php -l.",
);

const bootstrap = records
  .find((record) => record.path === KODETY_FILE_SYSTEM_ENTRY)
  ?.data.toString("utf8");
assert.ok(bootstrap, "Bootstrap do plugin ausente.");
assert.doesNotMatch(
  bootstrap,
  /\brequire(?:_once)?\s*\(?\s*KODETY_(?:DIR|FILE)/,
  "O plugin independente nao pode carregar arquivos pelo bootstrap do Kodety Studio.",
);

if (await exists(archivePath)) {
  await verifyFileSystemArchive(await readFile(archivePath), {
    records,
    expectedVersion,
  });
}

execFileSync("php", [runtimeTestPath], {
  cwd: root,
  stdio: "inherit",
});

console.log(
  `Kodety File System contracts passed (${validation.fileCount} files, ` +
    `${validation.phpFileCount} PHP files).`,
);
