import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPluginFileRecords } from "./wordpress-package-contracts.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const pluginDirectory = resolve(root, "Wordpress/kodety");
const phpFiles = (await readPluginFileRecords(pluginDirectory))
  .map((record) => record.path)
  .filter((filePath) => filePath.endsWith(".php"));

for (const filePath of phpFiles) {
  execFileSync("php", ["-l", resolve(pluginDirectory, filePath)], {
    cwd: root,
    stdio: "pipe",
  });
}

console.log(`PHP lint aprovado em ${phpFiles.length} arquivos do plugin.`);
