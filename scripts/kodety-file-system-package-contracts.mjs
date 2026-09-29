import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export const KODETY_FILE_SYSTEM_DIRECTORY = "kodety-file-system";
export const KODETY_FILE_SYSTEM_ENTRY = "kodety-file-system.php";
export const KODETY_FILE_SYSTEM_ARCHIVE = "kodety-file-system.zip";
export const KODETY_FILE_SYSTEM_VERSION_FIELD = "fileSystemVersion";
export const DETERMINISTIC_ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEADER_VERSION_PATTERN =
  /^[ \t]*\*[ \t]+Version:[ \t]*([^\s*]+)[ \t]*$/gm;
const CONSTANT_VERSION_PATTERN =
  /\bdefine\(\s*(['"])KODETY_FS_VERSION\1\s*,\s*(['"])([^'"]+)\2\s*\)\s*;/g;
const PLUGIN_NAME_PATTERN =
  /^[ \t]*\*[ \t]+Plugin Name:[ \t]*Kodety File System[ \t]*$/m;
const MAX_FILE_COUNT = 10_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

const REQUIRED_FILES = Object.freeze([
  KODETY_FILE_SYSTEM_ENTRY,
  "templates/app-shell.php",
  "assets/app.js",
  "assets/app.css",
]);

const REQUIRED_BACKEND_CONTRACTS = Object.freeze([
  {
    label: "StorageProvider",
    pattern: /\binterface\s+Kodety_FS_Storage_Provider\b/,
  },
  {
    label: "PathGuard",
    pattern: /\b(?:final\s+)?class\s+Kodety_FS_Path_Guard\b/,
  },
  {
    label: "LocalProvider",
    pattern: /\b(?:final\s+)?class\s+Kodety_FS_Local_Provider\b/,
  },
  {
    label: "RemoteProvider",
    pattern: /\b(?:final\s+)?class\s+Kodety_FS_Remote_Provider\b/,
  },
  {
    label: "REST controller",
    pattern: /\b(?:final\s+)?class\s+Kodety_FS_REST_Controller\b/,
  },
]);

const SECRET_CONTENT_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
]);

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

export function assertFileSystemVersion(version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new Error(
      `Versao do Kodety File System invalida: ${JSON.stringify(version)}.`,
    );
  }
  return version;
}

export function readExpectedFileSystemVersion(packageJson) {
  return assertFileSystemVersion(
    packageJson?.kodety?.[KODETY_FILE_SYSTEM_VERSION_FIELD],
  );
}

export function extractFileSystemPluginVersions(source) {
  if (typeof source !== "string") {
    throw new TypeError("O bootstrap do Kodety File System deve ser texto.");
  }
  if (!PLUGIN_NAME_PATTERN.test(source)) {
    throw new Error('Cabecalho "Plugin Name: Kodety File System" ausente.');
  }
  return {
    header: singleMatch(
      source,
      HEADER_VERSION_PATTERN,
      "Cabecalho Version do Kodety File System",
      1,
    ),
    constant: singleMatch(
      source,
      CONSTANT_VERSION_PATTERN,
      "Constante KODETY_FS_VERSION",
      3,
    ),
  };
}

export function assertFileSystemPluginVersion(source, expectedVersion) {
  const expected = assertFileSystemVersion(expectedVersion);
  const versions = extractFileSystemPluginVersions(source);
  if (versions.header !== versions.constant) {
    throw new Error(
      `Versoes internas divergentes: cabecalho=${versions.header}, ` +
        `KODETY_FS_VERSION=${versions.constant}.`,
    );
  }
  if (versions.header !== expected) {
    throw new Error(
      `Kodety File System ${versions.header} diverge de ` +
        `package.json#kodety.${KODETY_FILE_SYSTEM_VERSION_FIELD} ${expected}.`,
    );
  }
  return versions;
}

export function normalizeFileSystemPackagePath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.includes("\0")
  ) {
    throw new Error(`Caminho de pacote invalido: ${JSON.stringify(filePath)}.`);
  }
  const normalized = filePath.replaceAll("\\", "/");
  if (/%(?:2e|2f|5c|25)/i.test(normalized)) {
    throw new Error(`Caminho percent-encoded proibido: ${filePath}.`);
  }
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`Caminho absoluto proibido: ${filePath}.`);
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`Caminho ambiguo ou com travessia: ${filePath}.`);
  }
  return segments.join("/");
}

export function forbiddenFileSystemPackagePathReason(filePath) {
  const normalized = normalizeFileSystemPackagePath(filePath);
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
      "coverage",
    ].includes(segment),
  );
  if (forbiddenDirectory) {
    return `diretorio de desenvolvimento (${forbiddenDirectory})`;
  }
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
  if (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === "wp-config.php" ||
    fileName === "auth.json" ||
    fileName === "credentials.json" ||
    fileName === "service-account.json" ||
    fileName === "id_rsa" ||
    fileName === "id_ed25519"
  ) {
    return "arquivo potencialmente secreto";
  }
  if (/\.(?:pem|p12|pfx|key)$/i.test(fileName)) {
    return "chave ou certificado privado";
  }
  if (/\.map$/i.test(fileName)) return "source map de desenvolvimento";
  if (/\.(?:ts|tsx|jsx|scss|sass|less)$/i.test(fileName)) {
    return "fonte de frontend nao compilada";
  }
  if (/(?:\.log|\.tmp|\.temp|\.bak|\.swp|~)$/i.test(fileName)) {
    return "arquivo temporario";
  }
  return null;
}

function assertNoEmbeddedSecret(record) {
  // Binary files do not need a content scan. PHP, JS, CSS, JSON, XML, SVG and
  // text-like documentation remain small enough for a deterministic audit.
  if (!/\.(?:php|m?js|css|json|xml|svg|txt|md|html?)$/i.test(record.path)) {
    return;
  }
  const source = record.data.toString("utf8");
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(`Segredo embutido detectado em ${record.path}.`);
    }
  }
}

async function walkFiles(directory, prefix, records) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => lexicalCompare(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const normalized = normalizeFileSystemPackagePath(relativePath);
    if (normalized !== relativePath) {
      throw new Error(`Nome de arquivo nao-portavel: ${relativePath}.`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Link simbolico proibido no plugin: ${relativePath}.`);
    }
    const reason = forbiddenFileSystemPackagePathReason(relativePath);
    if (reason) {
      throw new Error(`Arquivo proibido ${relativePath}: ${reason}.`);
    }
    if (entry.isDirectory()) {
      await walkFiles(absolutePath, relativePath, records);
      continue;
    }
    const stats = await lstat(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Entrada nao suportada no plugin: ${relativePath}.`);
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(
        `${relativePath} excede o limite de ${MAX_FILE_BYTES} bytes.`,
      );
    }
    const record = {
      path: relativePath,
      absolutePath,
      data: await readFile(absolutePath),
      size: stats.size,
    };
    assertNoEmbeddedSecret(record);
    records.push(record);
    if (records.length > MAX_FILE_COUNT) {
      throw new Error(`Plugin excede o limite de ${MAX_FILE_COUNT} arquivos.`);
    }
  }
}

function manifestArtifacts(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("assets/manifest.json deve conter um objeto JSON.");
  }
  const artifacts = new Set();
  for (const [source, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Entrada invalida no manifest: ${source}.`);
    }
    if (typeof entry.file !== "string") {
      throw new Error(`Entrada ${source} nao declara file.`);
    }
    artifacts.add(normalizeFileSystemPackagePath(entry.file));
    for (const property of ["css", "assets"]) {
      if (entry[property] === undefined) continue;
      if (
        !Array.isArray(entry[property]) ||
        entry[property].some((value) => typeof value !== "string")
      ) {
        throw new Error(`Entrada ${source} possui ${property} invalido.`);
      }
      for (const value of entry[property]) {
        artifacts.add(normalizeFileSystemPackagePath(value));
      }
    }
  }
  return [...artifacts].sort(lexicalCompare);
}

export async function collectFileSystemPackageRecords(pluginDirectory) {
  const rootStats = await lstat(pluginDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("A raiz do plugin deve ser um diretorio real, nunca um link simbolico.");
  }
  const records = [];
  await walkFiles(pluginDirectory, "", records);
  records.sort((left, right) => lexicalCompare(left.path, right.path));
  const totalBytes = records.reduce((sum, record) => sum + record.size, 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error(
      `Plugin excede o limite descompactado de ${MAX_PACKAGE_BYTES} bytes.`,
    );
  }
  return records;
}

export function validateFileSystemPackageRecords(records, expectedVersion) {
  const byPath = new Map();
  for (const record of records) {
    const normalized = normalizeFileSystemPackagePath(record.path);
    if (byPath.has(normalized)) {
      throw new Error(`Caminho duplicado no plugin: ${normalized}.`);
    }
    if (record.size < 1) throw new Error(`Arquivo vazio: ${normalized}.`);
    const reason = forbiddenFileSystemPackagePathReason(normalized);
    if (reason) throw new Error(`Arquivo proibido ${normalized}: ${reason}.`);
    byPath.set(normalized, record);
  }

  for (const required of REQUIRED_FILES) {
    if (!byPath.has(required)) {
      throw new Error(`Artefato obrigatorio ausente: ${required}.`);
    }
  }
  const fonts = records.filter((record) =>
    /^assets\/(?:fonts\/)?[^/]+\.woff2$/i.test(record.path),
  );
  if (fonts.length === 0) {
    throw new Error("Nenhuma fonte WOFF2 foi empacotada em assets/.");
  }

  const phpSource = records
    .filter((record) => record.path.endsWith(".php"))
    .map((record) => record.data.toString("utf8"))
    .join("\n");
  for (const contract of REQUIRED_BACKEND_CONTRACTS) {
    if (!contract.pattern.test(phpSource)) {
      throw new Error(`Contrato PHP obrigatorio ausente: ${contract.label}.`);
    }
  }

  const bootstrap = byPath.get(KODETY_FILE_SYSTEM_ENTRY).data.toString("utf8");
  assertFileSystemPluginVersion(bootstrap, expectedVersion);

  const manifestRecord = byPath.get("assets/manifest.json");
  if (manifestRecord) {
    let manifest;
    try {
      manifest = JSON.parse(manifestRecord.data.toString("utf8"));
    } catch (error) {
      throw new Error(`assets/manifest.json invalido: ${error.message}`);
    }
    for (const artifact of manifestArtifacts(manifest)) {
      const candidate = artifact.startsWith("assets/")
        ? artifact
        : `assets/${artifact}`;
      if (!byPath.has(candidate)) {
        throw new Error(`Artefato do manifest ausente: ${candidate}.`);
      }
    }
  }
  return {
    fileCount: records.length,
    phpFileCount: records.filter((record) => record.path.endsWith(".php"))
      .length,
    version: expectedVersion,
  };
}

export function lintFileSystemPhp(records, { phpBinary = "php" } = {}) {
  const phpRecords = records.filter((record) => record.path.endsWith(".php"));
  if (phpRecords.length === 0) throw new Error("Plugin nao contem arquivos PHP.");
  for (const record of phpRecords) {
    execFileSync(phpBinary, ["-l", record.absolutePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return phpRecords.length;
}

export async function createFileSystemArchive(records) {
  const zip = new JSZip();
  const sorted = [...records].sort((left, right) =>
    lexicalCompare(left.path, right.path),
  );
  for (const record of sorted) {
    const relativePath = normalizeFileSystemPackagePath(record.path);
    zip.file(`${KODETY_FILE_SYSTEM_DIRECTORY}/${relativePath}`, record.data, {
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

export async function verifyFileSystemArchive(
  archiveBuffer,
  { records, expectedVersion },
) {
  const zip = await JSZip.loadAsync(archiveBuffer, {
    checkCRC32: true,
    createFolders: false,
  });
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      throw new Error(`Entrada de diretorio inesperada no ZIP: ${entry.name}.`);
    }
    if (
      typeof entry.unixPermissions === "number" &&
      (entry.unixPermissions & 0o170000) === 0o120000
    ) {
      throw new Error(`Link simbolico encontrado no ZIP: ${entry.name}.`);
    }
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const actualPaths = entries.map((entry) => entry.name).sort(lexicalCompare);
  const expectedPaths = records
    .map(
      (record) =>
        `${KODETY_FILE_SYSTEM_DIRECTORY}/${normalizeFileSystemPackagePath(record.path)}`,
    )
    .sort(lexicalCompare);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("A arvore do ZIP diverge da arvore validada do plugin.");
  }
  for (const archivePath of actualPaths) {
    if (!archivePath.startsWith(`${KODETY_FILE_SYSTEM_DIRECTORY}/`)) {
      throw new Error(`Raiz inesperada no ZIP: ${archivePath}.`);
    }
    const relativePath = archivePath.slice(
      KODETY_FILE_SYSTEM_DIRECTORY.length + 1,
    );
    const reason = forbiddenFileSystemPackagePathReason(relativePath);
    if (reason) throw new Error(`Arquivo proibido no ZIP: ${archivePath}.`);
  }
  const recordsByPath = new Map(
    records.map((record) => [
      `${KODETY_FILE_SYSTEM_DIRECTORY}/${record.path}`,
      record,
    ]),
  );
  for (const archivePath of actualPaths) {
    const extracted = await zip.file(archivePath).async("nodebuffer");
    if (!extracted.equals(recordsByPath.get(archivePath).data)) {
      throw new Error(`Conteudo corrompido no ZIP: ${archivePath}.`);
    }
  }
  const bootstrap = await zip
    .file(
      `${KODETY_FILE_SYSTEM_DIRECTORY}/${KODETY_FILE_SYSTEM_ENTRY}`,
    )
    .async("string");
  assertFileSystemPluginVersion(bootstrap, expectedVersion);
  return {
    fileCount: actualPaths.length,
    sha256: sha256(archiveBuffer),
  };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
