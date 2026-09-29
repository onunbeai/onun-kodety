import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWordPressReleaseVersion,
  createDeterministicPluginArchive,
  readPluginFileRecords,
  sha256,
} from "./wordpress-package-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wordpress = path.join(root, "Wordpress");
const pluginSource = path.join(wordpress, "kodety");
const extensionSource = path.join(wordpress, "extensions");
const output = path.join(wordpress, "dist", "extensions");
const verifyDeterminism = process.argv.includes("--verify-determinism");
const supportedArguments = new Set(["--verify-determinism"]);
const unknownArguments = process.argv.slice(2).filter(argument => !supportedArguments.has(argument));
if (unknownArguments.length) throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(", ")}.`);
const localizationChunkManifestPath =
  process.env.KODETY_WORDPRESS_LOCALIZATION_CHUNK_MANIFEST?.trim() || "";

function buildLocalization() {
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "Wordpress/vite.localization.config.ts",
    ],
    { cwd: root, stdio: "inherit" },
  );
  return localizationChunkManifestPath
    ? readFileSync(localizationChunkManifestPath)
    : null;
}

function assertBuildRecordsEqual(firstRecords, secondRecords) {
  const firstByPath = new Map(firstRecords.map(record => [record.path, record]));
  const secondByPath = new Map(secondRecords.map(record => [record.path, record]));
  const paths = [...new Set([...firstByPath.keys(), ...secondByPath.keys()])].sort();
  const mismatches = paths.filter(recordPath => {
    const first = firstByPath.get(recordPath);
    const second = secondByPath.get(recordPath);
    return !first || !second || first.size !== second.size || !first.data.equals(second.data);
  });
  if (mismatches.length) {
    throw new Error(
      `Falha de determinismo entre duas compilacoes da extensao Localization: ${mismatches.join(", ")}.`,
    );
  }
}

const firstLocalizationChunkManifest = buildLocalization();
if (verifyDeterminism) {
  const localizationAssets = path.join(extensionSource, "kodety-localization", "assets");
  const firstBuildRecords = await readPluginFileRecords(localizationAssets);
  const secondLocalizationChunkManifest = buildLocalization();
  if (
    firstLocalizationChunkManifest
    && !firstLocalizationChunkManifest.equals(secondLocalizationChunkManifest)
  ) {
    throw new Error(
      "Falha de determinismo entre os sidecars de módulos da extensão Localization.",
    );
  }
  const secondBuildRecords = await readPluginFileRecords(localizationAssets);
  assertBuildRecordsEqual(firstBuildRecords, secondBuildRecords);
}

const [packageJson, packageLock] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "package-lock.json"), "utf8").then(JSON.parse),
]);
const version = assertWordPressReleaseVersion(packageJson, packageLock);
const pluginRecords = await readPluginFileRecords(pluginSource);
const pluginByPath = new Map(pluginRecords.map(record => [record.path, record]));
const embeddedLocalizationAsset = pluginRecords.find(record =>
  /(?:^|\/)WordPressLocalizationWorkspace-[^/]+\.js$/.test(record.path)
  || /(?:^|\/)localization\.js$/.test(record.path)
);
if (embeddedLocalizationAsset) {
  throw new Error(`O asset Multi-language vazou para o plugin principal: ${embeddedLocalizationAsset.path}.`);
}
const definitions = [
  {
    slug: "kodety-marketing",
    files: ["admin/email-marketing.css", "admin/email-marketing.js"],
    prefixes: ["includes/email/"],
  },
  {
    slug: "kodety-membership",
    files: [
      "includes/class-kodety-members.php",
      "theme-runtime/membership.php",
      "assets/membership-runtime.js",
    ],
  },
  {
    slug: "kodety-commerce",
    files: ["includes/class-kodety-checkouts.php"],
  },
  {
    slug: "kodety-localization",
    files: [],
  },
  {
    slug: "kodety-proposals",
    files: [],
  },
];

await mkdir(output, { recursive: true });
// Analytics became native in 1.1.04. Remove a stale artifact from an older
// local build so the distribution directory cannot advertise two runtimes.
await rm(path.join(output, "kodety-analytics.zip"), { force: true });
await rm(path.join(output, "kodety-analytics"), { recursive: true, force: true });
const packaged = [];
for (const definition of definitions) {
  const sourceRecords = (await readPluginFileRecords(path.join(extensionSource, definition.slug))).filter(
    record => !(definition.excludePrefixes || []).some(prefix => record.path.startsWith(prefix)),
  );
  const records = [...sourceRecords];
  for (const sourcePath of definition.files || []) {
    const record = pluginByPath.get(sourcePath);
    if (!record) throw new Error(`Fonte da extensão ausente: ${sourcePath}.`);
    records.push(record);
  }
  for (const prefix of definition.prefixes || []) {
    records.push(...pluginRecords.filter(record => record.path.startsWith(prefix)));
  }
  if (
    definition.slug === "kodety-localization"
    && !records.some(record => record.path === "assets/localization.js" && record.size > 100_000)
  ) {
    throw new Error("A extensão Multi-language não contém seu runtime compilado.");
  }
  const manifestIndex = records.findIndex(record => record.path === "kodety-extension.json");
  if (manifestIndex < 0) throw new Error(`Manifesto ausente em ${definition.slug}.`);
  const manifest = JSON.parse(records[manifestIndex].data.toString("utf8"));
  if (!definition.independentVersion) {
    manifest.version = version;
    manifest.requires = { ...(manifest.requires || {}), kodety: version };
  }
  const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  records[manifestIndex] = {
    ...records[manifestIndex],
    data: manifestData,
    size: manifestData.byteLength,
  };
  const uniqueRecords = [...new Map(records.map(record => [record.path, record])).values()];
  const archive = await createDeterministicPluginArchive(uniqueRecords, { topLevel: definition.slug });
  if (definition.maximumArchiveBytes && archive.byteLength > definition.maximumArchiveBytes) {
    throw new Error(
      `${definition.slug}.zip excede o limite compatível de ${definition.maximumArchiveBytes} bytes.`,
    );
  }
  if (verifyDeterminism) {
    const second = await createDeterministicPluginArchive([...uniqueRecords].reverse(), { topLevel: definition.slug });
    if (!archive.equals(second)) throw new Error(`Falha de determinismo em ${definition.slug}.`);
  }
  const destination = path.join(output, `${definition.slug}.zip`);
  await writeFile(destination, archive);
  packaged.push({ slug: definition.slug, archive, sha256: sha256(archive) });
  console.log(`Extension created: ${destination} (sha256 ${sha256(archive)})`);
}

const bundleManifest = Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  type: "bundle",
  packages: packaged.map(item => `packages/${item.slug}.zip`),
}, null, 2)}\n`);
const bundleRecords = [
  { path: "kodety-bundle.json", data: bundleManifest, size: bundleManifest.byteLength },
  ...packaged.map(item => ({
    path: `packages/${item.slug}.zip`,
    data: item.archive,
    size: item.archive.byteLength,
  })),
];
const bundle = await createDeterministicPluginArchive(bundleRecords, { topLevel: "kodety-extensions" });
if (verifyDeterminism) {
  const second = await createDeterministicPluginArchive([...bundleRecords].reverse(), { topLevel: "kodety-extensions" });
  if (!bundle.equals(second)) throw new Error("Falha de determinismo no bundle de extensões.");
}
await writeFile(path.join(output, "kodety-extensions.zip"), bundle);
console.log(`Extensions bundle created: ${path.join(output, "kodety-extensions.zip")} (sha256 ${sha256(bundle)})`);
