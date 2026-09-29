import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWordPressReleaseVersion,
  assertWordPressPluginVersion,
  synchronizeWordPressPluginVersion,
} from "./wordpress-package-contracts.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const packageJsonPath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const pluginEntryPath = resolve(root, "Wordpress/kodety/kodety.php");
const checkOnly = process.argv.includes("--check");
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check");

if (unknownArguments.length > 0)
  throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(", ")}.`);

const [packageJson, packageLock, source] = await Promise.all([
  readFile(packageJsonPath, "utf8").then(JSON.parse),
  readFile(packageLockPath, "utf8").then(JSON.parse),
  readFile(pluginEntryPath, "utf8"),
]);
const version = assertWordPressReleaseVersion(packageJson, packageLock);
const synchronized = synchronizeWordPressPluginVersion(source, version);

if (source !== synchronized) {
  if (checkOnly) {
    throw new Error(
      `Wordpress/kodety/kodety.php nao esta em ${version}. Execute "npm run wordpress:version:sync".`,
    );
  }
  await writeFile(pluginEntryPath, synchronized, "utf8");
  console.log(`Versao do plugin WordPress atualizada para ${version}.`);
} else {
  console.log(`Versao do plugin WordPress ja esta sincronizada em ${version}.`);
}

assertWordPressPluginVersion(synchronized, version);
