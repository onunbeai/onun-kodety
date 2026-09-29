import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifyDeterminism = process.argv.includes("--verify-determinism");
const supportedArguments = new Set(["--verify-determinism"]);
const unknownArguments = process.argv.slice(2).filter(argument => !supportedArguments.has(argument));
if (unknownArguments.length) throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(", ")}.`);
const deterministicArgument = verifyDeterminism ? ["--verify-determinism"] : [];
const performanceArtifactDirectory = path.join(
  root,
  "artifacts",
  "kodety-hardening",
  "front-06",
);
mkdirSync(performanceArtifactDirectory, { recursive: true });
const mainChunkManifestPath = path.join(
  performanceArtifactDirectory,
  "wordpress-main-chunk-modules.json",
);
for (const generatedArtifactPath of [
  mainChunkManifestPath,
  path.join(performanceArtifactDirectory, "wordpress-performance.json"),
  path.join(performanceArtifactDirectory, "wordpress-performance.md"),
]) {
  rmSync(generatedArtifactPath, { force: true });
}
const buildEnvironment = {
  ...process.env,
  KODETY_WORDPRESS_CHUNK_MANIFEST: mainChunkManifestPath,
};

function run(script, args = []) {
  execFileSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    env: buildEnvironment,
    stdio: "inherit",
  });
}

run("package-wordpress-plugin.mjs", deterministicArgument);
run("test-wordpress-browser-runtime-boundary.mjs");
run("report-wordpress-performance.mjs");
