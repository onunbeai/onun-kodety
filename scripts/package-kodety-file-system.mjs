import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KODETY_FILE_SYSTEM_ARCHIVE,
  collectFileSystemPackageRecords,
  createFileSystemArchive,
  lintFileSystemPhp,
  readExpectedFileSystemVersion,
  validateFileSystemPackageRecords,
  verifyFileSystemArchive,
} from "./kodety-file-system-package-contracts.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const wordpress = path.join(root, "Wordpress");
const pluginDirectory = path.join(wordpress, "kodety-file-system");
const outputDirectory = path.join(wordpress, "dist");
const outputPath = path.join(outputDirectory, KODETY_FILE_SYSTEM_ARCHIVE);
const temporaryOutputPath = `${outputPath}.tmp-${process.pid}`;
const viteConfig = "Wordpress/vite.file-system.config.ts";
const skipBuild = process.argv.includes("--skip-build");
const verifyDeterminism = process.argv.includes("--verify-determinism");
const supportedArguments = new Set(["--skip-build", "--verify-determinism"]);
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => !supportedArguments.has(argument));

if (unknownArguments.length > 0) {
  throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(", ")}.`);
}

const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const expectedVersion = readExpectedFileSystemVersion(packageJson);

function buildAssets() {
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--config",
      viteConfig,
    ],
    { cwd: root, stdio: "inherit" },
  );
}

async function validateAndArchive() {
  const records = await collectFileSystemPackageRecords(pluginDirectory);
  const validation = validateFileSystemPackageRecords(records, expectedVersion);
  const phpFileCount = lintFileSystemPhp(records);
  if (phpFileCount !== validation.phpFileCount) {
    throw new Error("Nem todos os arquivos PHP passaram pelo lint.");
  }
  const archiveBuffer = await createFileSystemArchive(records);
  const archiveReport = await verifyFileSystemArchive(archiveBuffer, {
    records,
    expectedVersion,
  });
  return { records, validation, archiveBuffer, archiveReport };
}

if (!skipBuild) {
  console.log("Building Kodety File System assets...");
  buildAssets();
}

const first = await validateAndArchive();
if (verifyDeterminism) {
  if (!skipBuild) {
    console.log("Rebuilding Kodety File System to verify determinism...");
    buildAssets();
  }
  const second = await validateAndArchive();
  if (!first.archiveBuffer.equals(second.archiveBuffer)) {
    throw new Error(
      "Falha de determinismo: duas execucoes produziram ZIPs diferentes.",
    );
  }
}

await mkdir(outputDirectory, { recursive: true });
await rm(temporaryOutputPath, { force: true });
try {
  await writeFile(temporaryOutputPath, first.archiveBuffer);
  await rename(temporaryOutputPath, outputPath);
} finally {
  await rm(temporaryOutputPath, { force: true });
}

console.log(
  `Kodety File System created: ${outputPath} ` +
    `(v${expectedVersion}, ${first.archiveReport.fileCount} arquivos, ` +
    `${first.validation.phpFileCount} PHP lintados, ` +
    `sha256 ${first.archiveReport.sha256})`,
);
