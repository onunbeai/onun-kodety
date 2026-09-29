import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export const WORDPRESS_PLUGIN_DIRECTORY = "kodety";
export const WORDPRESS_PLUGIN_ENTRY = "kodety.php";
export const WORDPRESS_ASSET_MANIFEST = "assets/manifest.json";

export const REQUIRED_WORDPRESS_PLUGIN_FILES = Object.freeze([
  WORDPRESS_PLUGIN_ENTRY,
  "admin/admin.css",
  "admin/admin.js",
  "admin/components/dashboard.css",
  "admin/components/dashboard.bundle.css",
  "admin/components/dashboard.js",
  "admin/components/design-system.css",
  "admin/components/design-system.bundle.css",
  "admin/components/editor-chrome.css",
  "admin/components/plugin-information.css",
  "admin/components/native-select.js",
  "admin/components/native-workspace.js",
  "admin/components/native-workspace.bundle.js",
  "admin/components/kodety-icons.bundle.js",
  "admin/components/lists.css",
  "admin/components/lists.js",
  "admin/components/media.css",
  "admin/components/media.js",
  "admin/components/native-plugin-surface.css",
  "admin/components/shell.css",
  "admin/components/shell.bundle.css",
  "admin/components/shell.js",
  "admin/components/shell.bundle.js",
  "admin/components/wp-admin-audit.css",
  "admin/components/wp-admin-audit.bundle.css",
  "admin/components/wp-admin-audit.standard.bundle.css",
  "admin/components/wp-admin-audit.dashboard.bundle.css",
  "admin/components/wp-admin-audit.comments.bundle.css",
  "admin/components/wp-admin-audit.plugins.bundle.css",
  "admin/components/wp-admin-audit.lists.bundle.css",
  "admin/components/wp-admin-audit.media.bundle.css",
  "admin/components/wp-admin-audit.apps.bundle.css",
  "admin/editor-os.css",
  "admin/email-marketing.css",
  "admin/email-marketing.js",
  "admin/emails.css",
  "admin/emails.js",
  "admin/fonts/inter-latin-variable.woff2",
  "admin/interface-toggle.css",
  "admin/interface-toggle.js",
  "admin/kodety-page.css",
  "admin/kodety-page.js",
  "admin/login.css",
  "admin/login.js",
  "admin/media-library.css",
  "admin/media-library.js",
  "admin/onboarding.css",
  "admin/onboarding.js",
  "admin/images/kodety-logo-full.svg",
  "admin/images/login-showcase.webp",
  "admin/os-shell.js",
  "admin/os.css",
  "admin/shell-os.css",
  "admin/special-os.css",
  "admin/updates.css",
  "assets/canvas.css",
  "assets/code-component-react-runtime.mjs",
  "assets/forms-runtime.js",
  "assets/public-routes-runtime.js",
  "assets/kodety-favicon-180.png",
  "assets/kodety-favicon.svg",
  "assets/membership-runtime.js",
  WORDPRESS_ASSET_MANIFEST,
  "assets/swiper-minimal.css",
  "assets/kodety-filled.svg",
  "assets/kodety-webclip.png",
  "agent-runtime/server.mjs",
  "agent-runtime/builder-instructions.mjs",
  "agent-runtime/attachment-content.mjs",
  "agent-runtime/runtime-manifest.json",
  "agent-runtime/native-operations.json",
  "agent-skills/kodety-editor/SKILL.md",
  "agent-skills/kodety-editor/SKILL.json",
  "agent-skills/kodety-editor/references/native-panels.md",
  "agent-skills/kodety-widgets/SKILL.md",
  "agent-skills/kodety-widgets/SKILL.json",
  "agent-skills/kodety-widgets/agents/openai.yaml",
  "agent-skills/kodety-widgets/references/agent-operations.md",
  "agent-skills/kodety-widgets/references/code-component-contract.md",
  "agent-skills/kodety-widgets/references/control-catalog.md",
  "agent-skills/kodety-motion/SKILL.md",
  "agent-skills/kodety-motion/SKILL.json",
  "agent-skills/kodety-motion/agents/openai.yaml",
  "agent-skills/kodety-motion/references/motion-engine.md",
  "agent-skills/kodety-performance/SKILL.md",
  "agent-skills/kodety-performance/SKILL.json",
  "agent-skills/kodety-performance/agents/openai.yaml",
  "agent-skills/kodety-performance/references/performance-playbook.md",
  "agent-skills/kodety-languages/SKILL.md",
  "agent-skills/kodety-languages/SKILL.json",
  "agent-skills/kodety-languages/agents/openai.yaml",
  "agent-skills/kodety-languages/references/bulk-translation-contract.md",
  "includes/class-kodety-agents.php",
  "includes/class-kodety-agent-network.php",
  "includes/class-kodety-ai.php",
  "includes/class-kodety-assets.php",
  "includes/class-kodety-publication-optimizer.php",
  "includes/class-kodety-analytics.php",
  "includes/class-kodety-emails.php",
  "includes/class-kodety-extension-api.php",
  "includes/class-kodety-extensions.php",
  "includes/class-kodety-meta-capi.php",
  "includes/class-kodety-search-console.php",
  "includes/class-kodety-adobe-fonts.php",
  "includes/class-kodety-observability.php",
  "includes/class-kodety-mcp.php",
  "includes/class-kodety-mcp-tool-contracts.php",
  "includes/class-kodety-native-operations.php",
  "includes/class-kodety-media.php",
  "includes/class-kodety-members.php",
  "includes/class-kodety-plugin.php",
  "includes/class-kodety-security.php",
  "includes/class-kodety-updates.php",
  "changelog.json",
  "docs/extensions.md",
  "docs/extensions/README.md",
  "docs/extensions/getting-started.md",
  "docs/extensions/manifest.md",
  "docs/extensions/lifecycle.md",
  "docs/extensions/hooks-events.md",
  "docs/extensions/routes.md",
  "docs/extensions/admin.md",
  "docs/extensions/storage.md",
  "docs/extensions/media.md",
  "docs/extensions/auth-ui.md",
  "docs/extensions/frontend.md",
  "docs/extensions/packaging.md",
  "docs/extensions/versioning.md",
  "docs/extensions/compatibility.md",
  "docs/extensions/ai-guide.md",
  "docs/extensions/examples/hello-kodety/README.md",
  "docs/extensions/examples/hello-kodety/extension.php",
  "docs/extensions/examples/hello-kodety/kodety-extension.json",
  "docs/agents.md",
  "docs/updates.md",
  "docs/kodety-agent-skills.json",
  "docs/kodety-agent-skills.zip",
  "docs/example-extension/README.md",
  "docs/example-extension/extension.php",
  "docs/example-extension/kodety-extension.json",
  "docs/kodety-site-code.zip",
  "docs/kodety-site-code/SKILL.md",
  "docs/kodety-site-code/agents/openai.yaml",
  "docs/kodety-site-code/references/component-system.md",
  "docs/kodety-site-code/references/kodety-code-contract.md",
  "docs/kodety-site-code/references/mcp-operations.md",
  "docs/kodety-site-code/references/native-panels.md",
  "docs/kodety-site-code/scripts/validate-kodety-site.mjs",
  "includes/email/class-kodety-email-admin-audience.php",
  "includes/email/class-kodety-email-admin-campaigns.php",
  "includes/email/class-kodety-email-admin-templates.php",
  "includes/email/class-kodety-email-admin.php",
  "includes/email/class-kodety-email-campaigns.php",
  "includes/email/class-kodety-email-contacts.php",
  "includes/email/class-kodety-email-health.php",
  "includes/email/class-kodety-email-queue.php",
  "includes/email/class-kodety-email-renderer.php",
  "includes/email/class-kodety-email-marketing.php",
  "includes/email/class-kodety-email-schema.php",
  "includes/email/class-kodety-email-scheduler.php",
  "includes/email/class-kodety-email-settings.php",
  "includes/email/class-kodety-email-tracking.php",
  "includes/email/class-kodety-email-transport.php",
  "mcp/server.mjs",
  "templates/editor-shell.php",
  "templates/email-editor-shell.php",
  "templates/onboarding.php",
  "theme-runtime/functions.php",
  "theme-runtime/index.php",
  "theme-runtime/performance.php",
  "theme-runtime/membership.php",
  "theme-runtime/redirects.php",
]);

// ZIP stores timestamps with a two-second resolution. A constant UTC date keeps
// identical sources byte-for-byte reproducible on every supported platform.
export const DETERMINISTIC_ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLUGIN_HEADER_VERSION_PATTERN =
  /^[ \t]*\*[ \t]+Version:[ \t]*([^\s*]+)[ \t]*$/gm;
const PLUGIN_CONSTANT_VERSION_PATTERN =
  /\bdefine\(\s*(['"])KODETY_VERSION\1\s*,\s*(['"])([^'"]+)\2\s*\)\s*;/g;

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function singleMatch(source, pattern, label, valueIndex) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${label}: esperado exatamente 1 valor, encontrados ${matches.length}.`,
    );
  }
  return matches[0][valueIndex];
}

export function assertReleaseVersion(version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(`Versao de release invalida: ${JSON.stringify(version)}.`);
  }
  return version;
}

export function extractWordPressPluginVersions(source) {
  if (typeof source !== "string")
    throw new TypeError("O arquivo principal do plugin deve ser texto.");
  return {
    header: singleMatch(
      source,
      PLUGIN_HEADER_VERSION_PATTERN,
      "Cabecalho Version do plugin",
      1,
    ),
    constant: singleMatch(
      source,
      PLUGIN_CONSTANT_VERSION_PATTERN,
      "Constante KODETY_VERSION",
      3,
    ),
  };
}

export function assertWordPressPluginVersion(source, expectedVersion) {
  const expected = assertReleaseVersion(expectedVersion);
  const versions = extractWordPressPluginVersions(source);
  if (versions.header !== versions.constant) {
    throw new Error(
      `Versoes internas divergentes: cabecalho=${versions.header}, KODETY_VERSION=${versions.constant}.`,
    );
  }
  if (versions.header !== expected) {
    throw new Error(
      `Plugin ${versions.header} diverge do package.json ${expected}.`,
    );
  }
  return versions;
}

export function synchronizeWordPressPluginVersion(source, nextVersion) {
  const version = assertReleaseVersion(nextVersion);
  // Validate cardinality before replacing so a malformed bootstrap cannot be
  // silently "fixed" while leaving a second declaration behind.
  extractWordPressPluginVersions(source);
  return source
    .replace(PLUGIN_HEADER_VERSION_PATTERN, (line) =>
      line.replace(/Version:[ \t]*[^\s*]+/, `Version: ${version}`),
    )
    .replace(
      PLUGIN_CONSTANT_VERSION_PATTERN,
      `define('KODETY_VERSION', '${version}');`,
    );
}

export function normalizePluginPath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.includes("\0")
  ) {
    throw new Error(`Caminho de plugin invalido: ${JSON.stringify(filePath)}.`);
  }
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Caminho absoluto proibido no plugin: ${filePath}.`);
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`Caminho ambiguo ou com travessia proibido: ${filePath}.`);
  }
  return segments.join("/");
}

export function forbiddenPluginPathReason(filePath) {
  const normalized = normalizePluginPath(filePath);
  const segments = normalized.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const fileName = lowerSegments.at(-1);

  const forbiddenDirectory = lowerSegments.find((segment) =>
    [
      ".git",
      ".svn",
      ".hg",
      ".idea",
      ".vscode",
      "node_modules",
      "test",
      "tests",
      "__tests__",
    ].includes(segment),
  );
  if (forbiddenDirectory)
    return `diretorio de desenvolvimento (${forbiddenDirectory})`;
  if (
    [
      ".ds_store",
      "thumbs.db",
      "desktop.ini",
      ".gitignore",
      ".gitattributes",
    ].includes(fileName)
  ) {
    return `metadado local (${fileName})`;
  }
  if (fileName === ".env" || fileName.startsWith(".env."))
    return "arquivo de ambiente potencialmente secreto";
  if (
    /\.(?:pem|p12|pfx|key)$/i.test(fileName) ||
    fileName === "id_rsa" ||
    fileName === "id_ed25519"
  ) {
    return "chave ou certificado privado";
  }
  if (/\.map$/i.test(fileName)) return "source map de desenvolvimento";
  if (/(?:\.log|\.tmp|\.temp|\.bak|\.swp|~)$/i.test(fileName))
    return "arquivo temporario";
  return null;
}

export function collectManifestArtifactPaths(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("assets/manifest.json deve conter um objeto JSON.");
  }
  const entries = Object.entries(manifest);
  if (entries.length === 0)
    throw new Error("assets/manifest.json nao possui entradas.");

  const artifacts = new Set();
  let entryPoints = 0;
  for (const [source, value] of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Entrada invalida no manifest: ${source}.`);
    }
    if (typeof value.file !== "string")
      throw new Error(`Entrada ${source} nao declara "file".`);
    artifacts.add(normalizePluginPath(value.file));
    if (value.isEntry === true) entryPoints += 1;
    for (const property of ["css", "assets"]) {
      if (value[property] === undefined) continue;
      if (
        !Array.isArray(value[property]) ||
        value[property].some((item) => typeof item !== "string")
      ) {
        throw new Error(`Entrada ${source} possui "${property}" invalido.`);
      }
      for (const artifact of value[property])
        artifacts.add(normalizePluginPath(artifact));
    }
  }
  if (entryPoints === 0)
    throw new Error("assets/manifest.json nao declara nenhum entry point.");
  return [...artifacts].sort(lexicalCompare);
}

export function assertPackageLockVersion(packageJson, packageLock) {
  const expectedVersion = assertReleaseVersion(packageJson?.version);
  const errors = [];
  if (packageLock?.name !== packageJson?.name)
    errors.push("nome raiz do package-lock.json");
  if (packageLock?.version !== expectedVersion)
    errors.push("versao raiz do package-lock.json");
  if (packageLock?.packages?.[""]?.name !== packageJson?.name)
    errors.push('nome packages[""] do package-lock.json');
  if (packageLock?.packages?.[""]?.version !== expectedVersion)
    errors.push('versao packages[""] do package-lock.json');
  if (errors.length > 0) {
    throw new Error(
      `package.json e package-lock.json divergentes em: ${errors.join(", ")}.`,
    );
  }
  return expectedVersion;
}

/** The private npm workspace remains valid SemVer while WordPress may use the
 * product's display sequence (for example 1.1.01). Keeping the override
 * explicit prevents npm from silently normalizing the plugin/ZIP version. */
export function assertWordPressReleaseVersion(packageJson, packageLock) {
  assertPackageLockVersion(packageJson, packageLock);
  return assertReleaseVersion(
    packageJson?.kodety?.wordpressVersion ?? packageJson?.version,
  );
}

export function validatePluginContract({
  files,
  fileSizes,
  manifest,
  packageVersion,
  pluginSource,
}) {
  const errors = [];
  const normalizedFiles = [];
  const seen = new Set();

  for (const candidate of files ?? []) {
    let normalized;
    try {
      normalized = normalizePluginPath(candidate);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    if (seen.has(normalized)) errors.push(`Caminho duplicado: ${normalized}.`);
    seen.add(normalized);
    normalizedFiles.push(normalized);
    const forbiddenReason = forbiddenPluginPathReason(normalized);
    if (forbiddenReason)
      errors.push(`Arquivo proibido ${normalized}: ${forbiddenReason}.`);
  }

  for (const required of REQUIRED_WORDPRESS_PLUGIN_FILES) {
    if (!seen.has(required))
      errors.push(`Artefato obrigatorio ausente: ${required}.`);
    if (
      seen.has(required) &&
      fileSizes instanceof Map &&
      fileSizes.get(required) === 0
    ) {
      errors.push(`Artefato obrigatorio vazio: ${required}.`);
    }
  }

  let manifestArtifacts = [];
  try {
    manifestArtifacts = collectManifestArtifactPaths(manifest);
    for (const artifact of manifestArtifacts) {
      const pluginArtifact = `assets/${artifact}`;
      if (!seen.has(pluginArtifact))
        errors.push(
          `Artefato referenciado pelo manifest ausente: ${pluginArtifact}.`,
        );
      if (
        seen.has(pluginArtifact) &&
        fileSizes instanceof Map &&
        fileSizes.get(pluginArtifact) === 0
      ) {
        errors.push(
          `Artefato referenciado pelo manifest vazio: ${pluginArtifact}.`,
        );
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  try {
    assertWordPressPluginVersion(pluginSource, packageVersion);
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length > 0) {
    throw new Error(`Plugin WordPress invalido:\n- ${errors.join("\n- ")}`);
  }
  return {
    fileCount: normalizedFiles.length,
    manifestArtifactCount: manifestArtifacts.length,
    version: packageVersion,
  };
}

async function walkPluginFiles(directory, prefix, records) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => lexicalCompare(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const normalizedPath = normalizePluginPath(relativePath);
    if (normalizedPath !== relativePath)
      throw new Error(`Nome de arquivo nao-portavel: ${relativePath}.`);
    if (entry.isSymbolicLink())
      throw new Error(`Link simbolico proibido no plugin: ${relativePath}.`);
    if (entry.isDirectory()) {
      await walkPluginFiles(absolutePath, relativePath, records);
      continue;
    }
    const stats = await lstat(absolutePath);
    if (!stats.isFile())
      throw new Error(
        `Tipo de entrada nao suportado no plugin: ${relativePath}.`,
      );
    records.push({
      path: relativePath,
      data: await readFile(absolutePath),
      size: stats.size,
    });
  }
}

export async function readPluginFileRecords(pluginDirectory) {
  const records = [];
  await walkPluginFiles(pluginDirectory, "", records);
  records.sort((left, right) => lexicalCompare(left.path, right.path));
  return records;
}

export async function validatePluginDirectory({
  pluginDirectory,
  packageJsonPath,
  packageLockPath,
}) {
  const [packageSource, packageLockSource, records] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    readFile(packageLockPath, "utf8"),
    readPluginFileRecords(pluginDirectory),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(packageLockSource);
  const packageVersion = assertWordPressReleaseVersion(packageJson, packageLock);
  const byPath = new Map(records.map((record) => [record.path, record]));
  const pluginEntry = byPath.get(WORDPRESS_PLUGIN_ENTRY);
  const manifestEntry = byPath.get(WORDPRESS_ASSET_MANIFEST);
  let manifest = null;
  if (manifestEntry) {
    try {
      manifest = JSON.parse(manifestEntry.data.toString("utf8"));
    } catch (error) {
      throw new Error(
        `assets/manifest.json possui JSON invalido: ${error.message}`,
      );
    }
  }
  const report = validatePluginContract({
    files: records.map((record) => record.path),
    fileSizes: new Map(records.map((record) => [record.path, record.size])),
    manifest,
    packageVersion,
    pluginSource: pluginEntry?.data.toString("utf8"),
  });
  return { packageJson, packageVersion, records, report };
}

export async function createDeterministicPluginArchive(records, options = {}) {
  const topLevel = normalizePluginPath(
    options.topLevel ?? WORDPRESS_PLUGIN_DIRECTORY,
  );
  if (topLevel.includes("/"))
    throw new Error("O diretorio raiz do ZIP deve ter somente um segmento.");
  const zip = new JSZip();
  const sortedRecords = [...records].sort((left, right) =>
    lexicalCompare(left.path, right.path),
  );
  const seen = new Set();
  for (const record of sortedRecords) {
    const relativePath = normalizePluginPath(record.path);
    if (seen.has(relativePath))
      throw new Error(`Caminho duplicado ao gerar ZIP: ${relativePath}.`);
    seen.add(relativePath);
    const forbiddenReason = forbiddenPluginPathReason(relativePath);
    if (forbiddenReason)
      throw new Error(
        `Arquivo proibido no ZIP ${relativePath}: ${forbiddenReason}.`,
      );
    zip.file(`${topLevel}/${relativePath}`, record.data, {
      binary: true,
      createFolders: false,
      date: DETERMINISTIC_ARCHIVE_DATE,
      unixPermissions: 0o100644,
    });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    streamFiles: false,
  });
}

export async function verifyPluginArchive(
  archiveBuffer,
  {
    records,
    expectedVersion,
    topLevel = WORDPRESS_PLUGIN_DIRECTORY,
    entry = WORDPRESS_PLUGIN_ENTRY,
    requiredFiles = [],
  },
) {
  const zip = await JSZip.loadAsync(archiveBuffer, {
    checkCRC32: true,
    createFolders: false,
  });
  const expected = [...records]
    .map((record) => `${topLevel}/${normalizePluginPath(record.path)}`)
    .sort(lexicalCompare);
  const actual = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort(lexicalCompare);
  const requiredArchivePaths = new Set(
    requiredFiles.map(
      (required) => `${topLevel}/${normalizePluginPath(required)}`,
    ),
  );
  for (const requiredArchivePath of requiredArchivePaths) {
    if (!actual.includes(requiredArchivePath)) {
      throw new Error(
        `Artefato obrigatorio ausente no ZIP final: ${requiredArchivePath}.`,
      );
    }
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "O conteudo final do ZIP diverge da arvore validada do plugin.",
    );
  }

  const recordsByArchivePath = new Map(
    records.map((record) => [
      `${topLevel}/${normalizePluginPath(record.path)}`,
      record,
    ]),
  );
  for (const archivePath of actual) {
    const extracted = await zip.file(archivePath).async("nodebuffer");
    if (requiredArchivePaths.has(archivePath) && extracted.byteLength === 0) {
      throw new Error(`Artefato obrigatorio vazio no ZIP final: ${archivePath}.`);
    }
    if (!extracted.equals(recordsByArchivePath.get(archivePath).data)) {
      throw new Error(`Conteudo corrompido apos compactacao: ${archivePath}.`);
    }
  }

  const bootstrap = await zip
    .file(`${topLevel}/${normalizePluginPath(entry)}`)
    .async("string");
  assertWordPressPluginVersion(bootstrap, expectedVersion);
  return { fileCount: actual.length, sha256: sha256(archiveBuffer) };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
