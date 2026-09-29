import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginDirectory } from "./wordpress-package-contracts.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const validation = await validatePluginDirectory({
  pluginDirectory: resolve(root, "Wordpress/kodety"),
  packageJsonPath: resolve(root, "package.json"),
  packageLockPath: resolve(root, "package-lock.json"),
});

console.log(
  `Preflight WordPress aprovado: v${validation.packageVersion}, ` +
    `${validation.report.fileCount} arquivos, ` +
    `${validation.report.manifestArtifactCount} artefatos do manifest.`,
);
