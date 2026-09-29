import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { buildCodeComponentReactRuntime } from "./vite-code-component-runtime.mjs";
import {
  DETERMINISTIC_ARCHIVE_DATE,
  assertWordPressReleaseVersion,
  createDeterministicPluginArchive,
  synchronizeWordPressPluginVersion,
  validatePluginDirectory,
  verifyPluginArchive,
} from "./wordpress-package-contracts.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const wordpress = path.join(root, "Wordpress");
const plugin = path.join(wordpress, "kodety");
const output = path.join(wordpress, "dist");
const skipBuild = process.argv.includes("--skip-build");
const verifyDeterminism = process.argv.includes("--verify-determinism");
const supportedArguments = new Set(["--skip-build", "--verify-determinism"]);
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => !supportedArguments.has(argument));

if (unknownArguments.length > 0)
  throw new Error(`Argumentos desconhecidos: ${unknownArguments.join(", ")}.`);

const packageJsonPath = path.join(root, "package.json");
const packageLockPath = path.join(root, "package-lock.json");
const pluginEntryPath = path.join(plugin, "kodety.php");
const [packageJson, packageLock, pluginEntrySource] = await Promise.all([
  readFile(packageJsonPath, "utf8").then(JSON.parse),
  readFile(packageLockPath, "utf8").then(JSON.parse),
  readFile(pluginEntryPath, "utf8"),
]);
const packageVersion = assertWordPressReleaseVersion(packageJson, packageLock);
const archiveName = `${packageVersion.replaceAll(".", "_")}.zip`;
const archive = path.join(output, archiveName);
const temporaryArchive = path.join(output, `${archiveName}.tmp-${process.pid}`);
const observabilityRuntimePath = "includes/class-kodety-observability.php";
const synchronizedPluginEntry = synchronizeWordPressPluginVersion(
  pluginEntrySource,
  packageVersion,
);
if (pluginEntrySource !== synchronizedPluginEntry) {
  await writeFile(pluginEntryPath, synchronizedPluginEntry, "utf8");
  console.log(
    `Versao do plugin sincronizada com a release WordPress: ${packageVersion}.`,
  );
}

function buildWordPressAssets() {
  execFileSync(process.execPath, [path.join(root, "scripts/build-kodety-admin-runtime.mjs")], { cwd: root, stdio: "inherit" });
  execFileSync(
    process.execPath,
    [path.join(root, "scripts/build-kodety-admin-icons.mjs")],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const requestedChunkManifestPath =
    process.env.KODETY_WORDPRESS_CHUNK_MANIFEST?.trim() || "";
  const bundleAuditDirectory = requestedChunkManifestPath
    ? null
    : mkdtempSync(path.join(tmpdir(), "kodety-wordpress-bundle-"));
  const chunkManifestPath = requestedChunkManifestPath
    || path.join(bundleAuditDirectory, "chunks.json");
  mkdirSync(path.dirname(chunkManifestPath), { recursive: true });
  rmSync(chunkManifestPath, { force: true });
  const buildEnvironment = {
    ...process.env,
    KODETY_WORDPRESS_CHUNK_MANIFEST: chunkManifestPath,
    KODETY_FORMS_SOURCE_ONLY: "0",
  };
  let chunkManifestBytes;
  try {
    execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--config",
        "Wordpress/vite.config.ts",
      ],
      { cwd: root, env: buildEnvironment, stdio: "inherit" },
    );
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/test-forms-runtime.mjs")],
      { cwd: root, env: buildEnvironment, stdio: "inherit" },
    );
    execFileSync(
      process.execPath,
      [path.join(root, "scripts/test-wordpress-bundle-graph.mjs")],
      { cwd: root, env: buildEnvironment, stdio: "inherit" },
    );
    chunkManifestBytes = readFileSync(chunkManifestPath);
  } finally {
    if (bundleAuditDirectory) {
      rmSync(bundleAuditDirectory, { force: true, recursive: true });
    }
  }
  return chunkManifestBytes;
}

const CODEX_SKILL_FILES = Object.freeze([
  "SKILL.md",
  "references/component-system.md",
  "references/mcp-operations.md",
  "references/kodety-code-contract.md",
  "references/native-panels.md",
  "scripts/validate-kodety-site.mjs",
  "agents/openai.yaml",
]);

const KODETY_AGENT_SKILL_PACKAGES = Object.freeze([
  {
    name: "kodety-site-code",
    title: "Kodety Site Code",
    description: "Cria, revisa e sincroniza sites editáveis com o Kodety Builder.",
    directory: path.join(plugin, "docs", "kodety-site-code"),
    files: CODEX_SKILL_FILES,
  },
  {
    name: "kodety-motion",
    title: "Kodety Motion",
    description: "Cria e ajusta animações nativas no Interactions v2.",
    directory: path.join(plugin, "agent-skills", "kodety-motion"),
    files: ["SKILL.md", "SKILL.json", "agents/openai.yaml", "references/motion-engine.md"],
  },
  {
    name: "kodety-widgets",
    title: "Kodety Widgets",
    description: "Cria, compila e configura Code Components React no Builder.",
    directory: path.join(plugin, "agent-skills", "kodety-widgets"),
    files: [
      "SKILL.md",
      "SKILL.json",
      "agents/openai.yaml",
      "references/agent-operations.md",
      "references/code-component-contract.md",
      "references/control-catalog.md",
    ],
  },
  {
    name: "kodety-performance",
    title: "Kodety Performance",
    description: "Audita e aplica melhorias seguras de desempenho e carregamento.",
    directory: path.join(plugin, "agent-skills", "kodety-performance"),
    files: [
      "SKILL.md",
      "SKILL.json",
      "agents/openai.yaml",
      "references/performance-playbook.md",
    ],
  },
]);

const KODETY_AGENT_SKILL_DISTRIBUTION = Object.freeze({
  distributionScope: "external-mcp-clients",
  nativeAgent: Object.freeze({
    managedBy: "kodety-builder",
    installRequired: false,
    updateCheckRequired: false,
  }),
});

async function prepareCodexSkillArchive() {
  const skillDirectory = path.join(plugin, "docs", "kodety-site-code");
  const archivePath = path.join(plugin, "docs", "kodety-site-code.zip");
  const zip = new JSZip();

  for (const relativePath of CODEX_SKILL_FILES) {
    zip.file(
      `kodety-site-code/${relativePath}`,
      await readFile(path.join(skillDirectory, relativePath)),
      {
        date: DETERMINISTIC_ARCHIVE_DATE,
        createFolders: false,
        unixPermissions: 0o100644,
      },
    );
  }

  await writeFile(
    archivePath,
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      platform: "UNIX",
    }),
  );
}

async function prepareKodetyAgentSkillsArchive() {
  const archivePath = path.join(plugin, "docs", "kodety-agent-skills.zip");
  const manifestPath = path.join(plugin, "docs", "kodety-agent-skills.json");
  const zip = new JSZip();
  const packages = [];

  for (const skill of KODETY_AGENT_SKILL_PACKAGES) {
    const files = [];
    let digestSource = "";
    for (const relativePath of skill.files) {
      const content = await readFile(path.join(skill.directory, relativePath));
      const sha256 = createHash("sha256").update(content).digest("hex");
      files.push({ path: relativePath, sha256, size: content.byteLength });
      digestSource += `${relativePath}\0${sha256}\0${content.byteLength}\n`;
      zip.file(
        `${skill.name}/${relativePath}`,
        content,
        {
          date: DETERMINISTIC_ARCHIVE_DATE,
          createFolders: false,
          unixPermissions: 0o100644,
        },
      );
    }
    const packageManifest = {
      name: skill.name,
      title: skill.title,
      description: skill.description,
      digest: `sha256:${createHash("sha256").update(digestSource).digest("hex")}`,
      manifestFile: "kodety.manifest.json",
      files,
    };
    packages.push(packageManifest);
    zip.file(
      `${skill.name}/kodety.manifest.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: "kodety-remote-mcp",
          version: packageVersion,
          ...KODETY_AGENT_SKILL_DISTRIBUTION,
          ...packageManifest,
        },
        null,
        2,
      )}\n`,
      {
        date: DETERMINISTIC_ARCHIVE_DATE,
        createFolders: false,
        unixPermissions: 0o100644,
      },
    );
  }

  const manifest = {
    schemaVersion: 1,
    source: "kodety-remote-mcp",
    version: packageVersion,
    ...KODETY_AGENT_SKILL_DISTRIBUTION,
    packages,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestJson, "utf8");
  zip.file("manifest.json", manifestJson, {
    date: DETERMINISTIC_ARCHIVE_DATE,
    createFolders: false,
    unixPermissions: 0o100644,
  });

  await writeFile(
    archivePath,
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      platform: "UNIX",
    }),
  );
}

async function prepareRuntimeAssets() {
  await mkdir(path.join(plugin, "assets"), { recursive: true });
  await mkdir(path.join(plugin, "assets", "fonts"), { recursive: true });
  await copyFile(
    path.join(wordpress, "runtime-assets", "forms-runtime.js"),
    path.join(plugin, "assets", "forms-runtime.js"),
  );
  await copyFile(
    path.join(wordpress, "runtime-assets", "public-routes-runtime.js"),
    path.join(plugin, "assets", "public-routes-runtime.js"),
  );
  await copyFile(
    path.join(wordpress, "runtime-assets", "membership-runtime.js"),
    path.join(plugin, "assets", "membership-runtime.js"),
  );
  await writeFile(
    path.join(plugin, "assets", "code-component-react-runtime.mjs"),
    await buildCodeComponentReactRuntime(),
  );
  // GD/FreeType cannot render the WOFF2 used by the browser UI. Ship the
  // source-owned, licensed TTF used by the browser preview so Social Image
  // generation remains deterministic on ordinary WordPress hosts without
  // making the WordPress bundle depend on Next's runtime package.
  await copyFile(
    path.join(
      root,
      "lib",
      "html-editor",
      "fonts",
      "geist",
      "Geist-Regular.ttf",
    ),
    path.join(plugin, "assets", "fonts", "geist-regular.ttf"),
  );
  await copyFile(
    path.join(
      root,
      "lib",
      "html-editor",
      "fonts",
      "geist",
      "OFL-1.1.txt",
    ),
    path.join(plugin, "assets", "fonts", "geist-license.txt"),
  );
  await mkdir(path.join(plugin, "assets", "licenses"), { recursive: true });
  await copyFile(
    path.join(root, "node_modules", "wawoff2", "LICENSE"),
    path.join(plugin, "assets", "licenses", "wawoff2-license.txt"),
  );
  await copyFile(path.join(root, "licenses", "MOTION-LICENSE.md"), path.join(plugin, "assets", "licenses", "motion-license.txt"));
  await copyFile(path.join(root, "licenses", "YCODE-LICENSE.md"), path.join(plugin, "assets", "licenses", "ycode-license.txt"));
  await prepareCodexSkillArchive();
  await prepareKodetyAgentSkillsArchive();
}

async function createValidatedArchive() {
  await prepareRuntimeAssets();
  // These compiled assets style the isolated authoring interface, where a few
  // scoped priorities intentionally protect controls from WordPress admin CSS.
  // Public/project CSS is sanitized by the HTML editor and theme-runtime
  // pipelines and is covered separately by their regression contracts.
  const validation = await validatePluginDirectory({
    pluginDirectory: plugin,
    packageJsonPath,
    packageLockPath,
  });
  const records = validation.records.filter((record) => {
    const optionalExact = new Set([
      "assets/membership-runtime.js",
      "admin/email-marketing.css",
      "admin/email-marketing.js",
      "includes/class-kodety-members.php",
      "includes/class-kodety-checkouts.php",
      "theme-runtime/membership.php",
    ]);
    return !optionalExact.has(record.path) && !record.path.startsWith("includes/email/");
  });
  const observabilityRuntime = records.find(
    (record) => record.path === observabilityRuntimePath,
  );
  if (!observabilityRuntime || observabilityRuntime.size === 0) {
    throw new Error(
      `Runtime obrigatorio ausente depois dos filtros do ZIP: ${observabilityRuntimePath}.`,
    );
  }
  return {
    validation: { ...validation, records },
    archiveBuffer: await createDeterministicPluginArchive(records),
  };
}

let firstChunkModuleManifest = null;
if (!skipBuild) {
  console.log("Building WordPress plugin assets...");
  firstChunkModuleManifest = buildWordPressAssets();
}

const firstBuild = await createValidatedArchive();
if (verifyDeterminism) {
  let secondArchiveBuffer;
  if (skipBuild) {
    secondArchiveBuffer = await createDeterministicPluginArchive(
      [...firstBuild.validation.records].reverse(),
    );
  } else {
    console.log("Rebuilding assets to verify full-build determinism...");
    const secondChunkModuleManifest = buildWordPressAssets();
    if (!firstChunkModuleManifest.equals(secondChunkModuleManifest)) {
      throw new Error(
        "Falha de determinismo: duas compilações produziram sidecars de módulos diferentes.",
      );
    }
    secondArchiveBuffer = (await createValidatedArchive()).archiveBuffer;
  }
  if (!firstBuild.archiveBuffer.equals(secondArchiveBuffer)) {
    throw new Error(
      "Falha de determinismo: duas execucoes produziram ZIPs diferentes. " +
        "Confirme que nenhuma fonte mudou durante o teste e investigue a divergencia.",
    );
  }
}
const archiveReport = await verifyPluginArchive(firstBuild.archiveBuffer, {
  records: firstBuild.validation.records,
  expectedVersion: packageVersion,
  requiredFiles: [observabilityRuntimePath],
});

await mkdir(output, { recursive: true });
await rm(temporaryArchive, { force: true });
try {
  await writeFile(temporaryArchive, firstBuild.archiveBuffer);
  await rename(temporaryArchive, archive);
} finally {
  await rm(temporaryArchive, { force: true });
}

console.log(
  `WordPress plugin created: ${archive} ` +
    `(v${packageVersion}, ${archiveReport.fileCount} arquivos, sha256 ${archiveReport.sha256})`,
);
