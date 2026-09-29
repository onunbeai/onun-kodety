import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const WORDPRESS_PERFORMANCE_ROOT = path.resolve(scriptDirectory, "..");
export const LARGE_ASSET_THRESHOLD_BYTES = 100 * 1024;
export const BROTLI_QUALITY = 6;

/**
 * These are rounded ceilings, not snapshots of the current byte counts.
 * JavaScript limits leave roughly 10–16% headroom from the 2026-08-29
 * baseline, while chunk-count limits allow a few intentional split points.
 * That is enough room for ordinary UI work without silently accepting a new
 * framework-sized dependency.
 */
export const WORDPRESS_ROUTE_BUDGETS = Object.freeze({
  shell: {
    label: "Editor shell",
    maxChunks: 7,
    maxLargestChunkRawBytes: 220_000,
    javascript: { rawBytes: 460_000, gzipBytes: 155_000, brotliBytes: 145_000 },
    maxStyleFiles: 3,
    styles: { rawBytes: 520_000, gzipBytes: 65_000, brotliBytes: 60_000 },
    rationale:
      "Small shared bootstrap; about 14% raw headroom and two spare split points.",
  },
  builder: {
    label: "Builder",
    maxChunks: 48,
    maxLargestChunkRawBytes: 1_900_000,
    javascript: {
      rawBytes: 6_600_000,
      gzipBytes: 1_900_000,
      brotliBytes: 1_750_000,
    },
    maxStyleFiles: 4,
    styles: { rawBytes: 540_000, gzipBytes: 70_000, brotliBytes: 65_000 },
    incremental: {
      maxChunks: 43,
      rawBytes: 6_100_000,
      gzipBytes: 1_750_000,
      brotliBytes: 1_600_000,
    },
    rationale:
      "Large authoring surface; rounded ceilings retain about 10–13% room without hiding a major dependency.",
  },
  settings: {
    label: "Settings",
    maxChunks: 31,
    maxLargestChunkRawBytes: 370_000,
    javascript: {
      rawBytes: 1_800_000,
      gzipBytes: 560_000,
      brotliBytes: 525_000,
    },
    maxStyleFiles: 4,
    styles: { rawBytes: 540_000, gzipBytes: 70_000, brotliBytes: 65_000 },
    incremental: {
      maxChunks: 26,
      rawBytes: 1_376_000,
      gzipBytes: 415_000,
      brotliBytes: 390_000,
    },
    rationale:
      "Standalone light workspace, including native Adobe Fonts discovery; retains a rounded ceiling without accepting a new large dependency.",
  },
  cms: {
    label: "CMS",
    maxChunks: 24,
    maxLargestChunkRawBytes: 300_000,
    javascript: {
      rawBytes: 1_200_000,
      gzipBytes: 365_000,
      brotliBytes: 345_000,
    },
    maxStyleFiles: 3,
    styles: { rawBytes: 520_000, gzipBytes: 65_000, brotliBytes: 60_000 },
    incremental: {
      maxChunks: 19,
      rawBytes: 725_000,
      gzipBytes: 215_000,
      brotliBytes: 200_000,
    },
    rationale:
      "Light workspace with a rounded 14–16% allowance for schema and field controls.",
  },
  analytics: {
    label: "Analytics",
    maxChunks: 24,
    maxLargestChunkRawBytes: 300_000,
    javascript: {
      rawBytes: 1_180_000,
      gzipBytes: 365_000,
      brotliBytes: 345_000,
    },
    maxStyleFiles: 3,
    styles: { rawBytes: 520_000, gzipBytes: 65_000, brotliBytes: 60_000 },
    incremental: {
      maxChunks: 19,
      rawBytes: 710_000,
      gzipBytes: 215_000,
      brotliBytes: 205_000,
    },
    rationale:
      "Overview route only; detailed funnels and experiments remain demand-loaded.",
  },
  email: {
    label: "Email Editor",
    maxChunks: 25,
    maxLargestChunkRawBytes: 1_250_000,
    javascript: {
      rawBytes: 3_550_000,
      gzipBytes: 1_100_000,
      brotliBytes: 1_020_000,
    },
    maxStyleFiles: 3,
    styles: { rawBytes: 490_000, gzipBytes: 62_000, brotliBytes: 56_000 },
    rationale:
      "Independent application; rounded limits leave about 12–14% for editor-specific growth.",
  },
  componentCompiler: {
    label: "Component compiler",
    maxChunks: 49,
    maxLargestChunkRawBytes: 4_000_000,
    javascript: {
      rawBytes: 10_600_000,
      gzipBytes: 3_050_000,
      brotliBytes: 2_750_000,
    },
    maxStyleFiles: 4,
    styles: { rawBytes: 540_000, gzipBytes: 70_000, brotliBytes: 65_000 },
    incremental: {
      maxChunks: 2,
      rawBytes: 4_000_000,
      gzipBytes: 1_150_000,
      brotliBytes: 1_020_000,
    },
    rationale:
      "Demand-loaded on top of Builder; the incremental ceiling isolates compiler growth from the editor closure.",
  },
});

/**
 * Large-output limits complement route closures by covering lazy WASM,
 * formatter chunks and copied media. They use rounded totals with 12–20%
 * headroom; the report still exposes every existing file above 100 KiB.
 */
export const WORDPRESS_OUTPUT_BUDGETS = Object.freeze({
  main: {
    label: "Main WordPress assets",
    maxFiles: 215,
    maxTotalBytes: 27_000_000,
    maxLargeFiles: 38,
    maxLargeFileBytes: 4_000_000,
    maxLargeFilesTotalBytes: 21_500_000,
    rationale:
      "Covers the complete Vite output, including optional compiler/AVIF/formatter payloads.",
  },

});

/**
 * Source-level limits preserve optimizations that cannot be asserted against
 * the intentionally stale compiled baseline. Each rounded ceiling leaves room
 * for deliberate visual refinement without accepting the former 367–534 KiB
 * Figma exports again.
 */
export const WORDPRESS_SOURCE_ASSET_BUDGETS = Object.freeze({
  spanishFlag: {
    label: "Spanish locale flag",
    path: "lib/html-editor/locale-flags/es.svg",
    rawBytes: 1_200,
    gzipBytes: 576,
    brotliBytes: 544,
    rationale:
      "Keeps the optimized flag and simplified coat of arms small while allowing deliberate visual refinement.",
  },
  mexicanFlag: {
    label: "Mexican locale flag",
    path: "lib/html-editor/locale-flags/mx.svg",
    rawBytes: 1_600,
    gzipBytes: 768,
    brotliBytes: 704,
    rationale:
      "Leaves substantial room for the simplified emblem without accepting the former exported path graph.",
  },
});

const OUTPUT_DEFINITIONS = Object.freeze([
  {
    id: "main",
    label: "Main WordPress assets",
    directory: "Wordpress/kodety/assets",
  },

]);

const toPosix = (value) => value.replaceAll(path.sep, "/");

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function normalizedManifestValue(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

const CHUNK_MODULE_SIDECAR_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "main",
    label: "Main WordPress bundle",
    environmentVariable: "KODETY_WORDPRESS_CHUNK_MANIFEST",
    defaultPath: "artifacts/kodety-hardening/front-06/wordpress-main-chunk-modules.json",
  }),

]);

const MODULE_BUNDLE_ORDER = new Map(
  CHUNK_MODULE_SIDECAR_DEFINITIONS.map((definition, index) => [
    definition.id,
    index,
  ]),
);

function stripModuleQueryAndFragment(value) {
  const separators = [value.indexOf("?"), value.indexOf("#")].filter(
    (index) => index >= 0,
  );
  return separators.length === 0
    ? value
    : value.slice(0, Math.min(...separators));
}

function normalizeFilesystemPath(value) {
  let normalized = value.replaceAll("\\", "/");
  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\//i, "");
  }
  normalized = normalized.replace(/^\/@fs\//, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  normalized = path.posix.normalize(normalized);
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = `${normalized[0].toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

/**
 * Module IDs are structural identities, not byte-attribution records. Vite and
 * Rollup can expose the same source with Windows separators, an /@fs/ prefix,
 * a virtual-module wrapper or a query suffix. Normalize only those transport
 * details; in particular, keep nested node_modules install paths distinct so
 * the report never claims that two potentially different package copies are
 * interchangeable.
 */
export function normalizeChunkModuleId(
  moduleId,
  { root = WORDPRESS_PERFORMANCE_ROOT } = {},
) {
  if (typeof moduleId !== "string" || moduleId.trim() === "") {
    throw new Error("Chunk module IDs must be non-empty strings.");
  }

  let normalized = moduleId.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/@id/__x00__")) {
    normalized = `\0${normalized.slice("/@id/__x00__".length)}`;
  } else if (normalized.startsWith("/@id/")) {
    normalized = normalized.slice("/@id/".length);
  }
  normalized = stripModuleQueryAndFragment(normalized);

  if (normalized.startsWith("\0") || normalized.startsWith("virtual:")) {
    const virtualIdentity = normalized
      .replace(/^\0+/, "")
      .replace(/^virtual:/, "");
    if (virtualIdentity === "") {
      throw new Error("Virtual chunk module IDs must include an identity.");
    }
    const normalizedVirtualIdentity =
      /^(?:file:\/\/|\/?[A-Za-z]:\/|\/|\/@fs\/)/i.test(virtualIdentity)
        ? normalizeChunkModuleId(virtualIdentity, { root })
        : path.posix
            .normalize(virtualIdentity.replace(/^\/+/, ""))
            .replace(/^\.\//, "");
    return `virtual:${normalizedVirtualIdentity}`;
  }

  normalized = normalizeFilesystemPath(normalized);
  const normalizedRoot = normalizeFilesystemPath(String(root));
  const caseInsensitive = /^[a-z]:\//i.test(normalizedRoot);
  const comparableModule = caseInsensitive ? normalized.toLowerCase() : normalized;
  const comparableRoot = caseInsensitive
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  if (comparableModule === comparableRoot) return ".";
  if (comparableModule.startsWith(`${comparableRoot}/`)) {
    const relative = normalized.slice(normalizedRoot.length + 1);
    return caseInsensitive ? relative.toLowerCase() : relative;
  }
  const portable = normalized.replace(/^\.\//, "");
  return caseInsensitive ? portable.toLowerCase() : portable;
}

function normalizeChunkFile(chunkFile) {
  if (typeof chunkFile !== "string" || chunkFile.trim() === "") {
    throw new Error("Chunk sidecar keys must be non-empty strings.");
  }
  const normalized = path.posix
    .normalize(chunkFile.trim().replaceAll("\\", "/"))
    .replace(/^\.\//, "");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`Chunk sidecar key must stay relative: ${chunkFile}.`);
  }
  return normalized;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bundleComparison(left, right) {
  const leftRank = MODULE_BUNDLE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = MODULE_BUNDLE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.localeCompare(right);
}

function moduleClassification(moduleId) {
  if (moduleId.startsWith("virtual:")) {
    return {
      kind: "virtual",
      packageName: null,
      dependencyChain: [],
    };
  }

  const segments = moduleId.split("/");
  const dependencyChain = [];
  let packageName = null;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== "node_modules") continue;
    const first = segments[index + 1];
    if (!first || first === ".pnpm") continue;
    packageName = first.startsWith("@")
      ? [first, segments[index + 2]].filter(Boolean).join("/")
      : first;
    dependencyChain.push(packageName);
  }
  return {
    kind: dependencyChain.length > 0 ? "dependency" : "source",
    packageName,
    dependencyChain,
  };
}

function validateChunkModuleMap(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object keyed by emitted chunk.`);
  }
  const chunks = {};
  for (const [rawChunk, rawModules] of Object.entries(value)) {
    const chunk = normalizeChunkFile(rawChunk);
    if (Object.hasOwn(chunks, chunk)) {
      throw new Error(
        `${label} contains colliding normalized chunk keys: ${rawChunk}.`,
      );
    }
    if (!Array.isArray(rawModules)) {
      throw new Error(`${label} entry ${rawChunk} must be an array of module IDs.`);
    }
    chunks[chunk] = rawModules.map((moduleId, index) => {
      if (typeof moduleId !== "string" || moduleId.trim() === "") {
        throw new Error(
          `${label} entry ${rawChunk}[${index}] must be a non-empty module ID.`,
        );
      }
      return moduleId.trim();
    });
  }
  return chunks;
}

function manifestJavaScriptChunks(manifest) {
  return [
    ...new Set(
      Object.values(manifest)
        .map((entry) => entry?.file)
        .filter(
          (file) => typeof file === "string" && /\.m?js$/i.test(file),
        )
        .map(normalizeChunkFile),
    ),
  ].sort();
}

function reportablePath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  return relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)
    ? toPosix(absolutePath)
    : toPosix(relative);
}

async function loadChunkModuleSidecar({
  root,
  definition,
  bundle,
  sidecarPath,
}) {
  if (typeof sidecarPath !== "string" || sidecarPath.trim() === "") {
    throw new Error(
      `Required chunk-module sidecar ${definition.environmentVariable} is not set. ` +
        "Run the canonical WordPress build before generating the final performance report.",
    );
  }
  const absolutePath = path.resolve(root, sidecarPath);
  let contents;
  let sidecarStat;
  try {
    [contents, sidecarStat] = await Promise.all([
      readFile(absolutePath),
      stat(absolutePath),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Required chunk-module sidecar ${definition.environmentVariable} is missing: ${absolutePath}.`,
        { cause: error },
      );
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Chunk-module sidecar ${definition.environmentVariable} contains malformed JSON: ${absolutePath}.`,
      { cause: error },
    );
  }
  const chunks = validateChunkModuleMap(
    parsed,
    `Chunk-module sidecar ${definition.environmentVariable}`,
  );
  const expectedChunks = manifestJavaScriptChunks(bundle.manifest);
  const actualChunks = Object.keys(chunks).sort();
  const expectedSet = new Set(expectedChunks);
  const actualSet = new Set(actualChunks);
  const missingChunks = expectedChunks.filter((chunk) => !actualSet.has(chunk));
  const unexpectedChunks = actualChunks.filter(
    (chunk) => !expectedSet.has(chunk),
  );
  if (missingChunks.length > 0 || unexpectedChunks.length > 0) {
    throw new Error(
      `Chunk-module sidecar ${definition.environmentVariable} is stale for ${definition.label}: ` +
        `missing [${missingChunks.join(", ") || "none"}]; ` +
        `unexpected [${unexpectedChunks.join(", ") || "none"}].`,
    );
  }

  const moduleEntries = Object.values(chunks).reduce(
    (count, modules) => count + modules.length,
    0,
  );
  return {
    id: definition.id,
    label: definition.label,
    environmentVariable: definition.environmentVariable,
    chunks,
    identity: {
      id: definition.id,
      label: definition.label,
      environmentVariable: definition.environmentVariable,
      path: reportablePath(root, absolutePath),
      rawBytes: contents.byteLength,
      modifiedAt: sidecarStat.mtime.toISOString(),
      sha256: createHash("sha256").update(contents).digest("hex"),
      chunks: actualChunks.length,
      moduleEntries,
    },
  };
}

/**
 * Report repeated normalized module membership across emitted chunks. This is
 * intentionally structural: Rollup's module map does not attribute a safe
 * removable byte count, so this function exposes occurrences and package
 * nesting without estimating savings.
 */
export function analyzeChunkModuleDuplication(
  sidecars,
  { root = WORDPRESS_PERFORMANCE_ROOT } = {},
) {
  if (!Array.isArray(sidecars) || sidecars.length === 0) {
    throw new Error("At least one chunk-module sidecar is required.");
  }
  const normalizedSidecars = sidecars
    .map((sidecar) => {
      if (!isPlainObject(sidecar) || typeof sidecar.id !== "string") {
        throw new Error("Chunk-module sidecars must include a bundle id.");
      }
      return {
        id: sidecar.id,
        label: sidecar.label ?? sidecar.id,
        chunks: validateChunkModuleMap(
          sidecar.chunks,
          `Chunk-module sidecar ${sidecar.id}`,
        ),
      };
    })
    .sort((left, right) => bundleComparison(left.id, right.id));

  const duplicateBundleIds = normalizedSidecars
    .map((sidecar) => sidecar.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateBundleIds.length > 0) {
    throw new Error(
      `Chunk-module sidecar bundle ids must be unique: ${[
        ...new Set(duplicateBundleIds),
      ].join(", ")}.`,
    );
  }

  const occurrencesByModule = new Map();
  const bundleSummaries = [];
  let moduleEntries = 0;
  let normalizedOccurrences = 0;
  for (const sidecar of normalizedSidecars) {
    const bundleModules = new Set();
    const chunkEntries = Object.entries(sidecar.chunks).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [chunk, modules] of chunkEntries) {
      moduleEntries += modules.length;
      const normalizedModules = [
        ...new Set(
          modules.map((moduleId) => normalizeChunkModuleId(moduleId, { root })),
        ),
      ].sort();
      normalizedOccurrences += normalizedModules.length;
      for (const moduleId of normalizedModules) {
        bundleModules.add(moduleId);
        const occurrences = occurrencesByModule.get(moduleId) ?? [];
        occurrences.push({ bundle: sidecar.id, chunk });
        occurrencesByModule.set(moduleId, occurrences);
      }
    }
    bundleSummaries.push({
      id: sidecar.id,
      label: sidecar.label,
      chunks: chunkEntries.length,
      moduleEntries: chunkEntries.reduce(
        (count, [, modules]) => count + modules.length,
        0,
      ),
      uniqueModules: bundleModules.size,
    });
  }

  const duplicateModules = [...occurrencesByModule.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([moduleId, unsortedOccurrences]) => {
      const occurrences = [...unsortedOccurrences].sort(
        (left, right) =>
          bundleComparison(left.bundle, right.bundle) ||
          left.chunk.localeCompare(right.chunk),
      );
      const bundles = [...new Set(occurrences.map(({ bundle }) => bundle))].sort(
        bundleComparison,
      );
      const withinBundles = bundles.filter(
        (bundle) =>
          occurrences.filter((occurrence) => occurrence.bundle === bundle)
            .length > 1,
      );
      return {
        module: moduleId,
        ...moduleClassification(moduleId),
        occurrenceCount: occurrences.length,
        bundles,
        withinBundles,
        crossBundle: bundles.length > 1,
        occurrences,
      };
    })
    .sort((left, right) => left.module.localeCompare(right.module));

  return {
    methodology:
      "Structural Rollup module membership after path/query normalization. " +
      "Occurrences do not imply that their bytes are identical or safely removable; no byte-savings estimate is calculated.",
    bundleSummaries,
    summary: {
      bundles: normalizedSidecars.length,
      chunks: bundleSummaries.reduce((count, bundle) => count + bundle.chunks, 0),
      moduleEntries,
      normalizedOccurrences,
      uniqueModules: occurrencesByModule.size,
      duplicateModules: duplicateModules.length,
      withinBundleDuplicateModules: duplicateModules.filter(
        (duplicate) => duplicate.withinBundles.length > 0,
      ).length,
      crossBundleDuplicateModules: duplicateModules.filter(
        (duplicate) => duplicate.crossBundle,
      ).length,
    },
    duplicateModules,
  };
}

export function findManifestEntry(manifest, label) {
  const normalizedLabel = normalizedManifestValue(label);
  const candidates = Object.entries(manifest).map(([key, entry]) => ({
    key,
    values: [key, entry?.name, entry?.src]
      .map(normalizedManifestValue)
      .filter(Boolean),
  }));
  const exact = candidates.filter((candidate) =>
    candidate.values.includes(normalizedLabel),
  );
  if (exact.length === 1) return exact[0].key;
  if (exact.length > 1) {
    throw new Error(
      `Manifest entry ${label} is ambiguous: ${exact.map((item) => item.key).join(", ")}.`,
    );
  }

  // Workspace-linked node_modules can make Vite expose an absolute source key.
  // A normalized suffix keeps the report portable across checkouts/worktrees.
  const suffix = `/${normalizedLabel.replace(/^\/+/, "")}`;
  const suffixMatches = candidates.filter((candidate) =>
    candidate.values.some((value) => value.endsWith(suffix)),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].key;
  throw new Error(
    `Expected exactly one manifest entry for ${label}, found ${suffixMatches.length}.`,
  );
}

export function staticManifestClosure(manifest, seedKeys) {
  const pending = [...seedKeys];
  const visited = new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    const entry = manifest[key];
    if (!entry)
      throw new Error(`Static import ${key} is missing from its manifest.`);
    visited.add(key);
    for (const importedKey of entry.imports ?? []) pending.push(importedKey);
  }
  return visited;
}

async function readJson(file, missingHint) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && missingHint) {
      throw new Error(`${missingHint} Missing file: ${file}.`, {
        cause: error,
      });
    }
    throw error;
  }
}

function safeOutputPath(directory, relativeFile) {
  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(resolvedDirectory, relativeFile);
  if (
    resolvedFile !== resolvedDirectory &&
    !resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)
  ) {
    throw new Error(
      `Manifest output escapes its asset directory: ${relativeFile}.`,
    );
  }
  return resolvedFile;
}

function fileKind(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".js" || extension === ".mjs") return "javascript";
  if (extension === ".css") return "css";
  if (extension === ".wasm") return "wasm";
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(extension)) return "font";
  if (
    [".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(
      extension,
    )
  )
    return "image";
  return extension.slice(1) || "file";
}

async function fileRecord(root, absoluteFile, metricCache) {
  const cacheKey = path.resolve(absoluteFile);
  if (metricCache.has(cacheKey)) return metricCache.get(cacheKey);
  const contents = await readFile(cacheKey);
  const record = {
    path: toPosix(path.relative(root, cacheKey)),
    kind: fileKind(cacheKey),
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
    brotliBytes: brotliCompressSync(contents, {
      params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    }).byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  metricCache.set(cacheKey, record);
  return record;
}

async function manifestBundle(root, id, manifestPath) {
  const absoluteManifest = path.resolve(root, manifestPath);
  const manifest = await readJson(
    absoluteManifest,
    "Build the WordPress assets before running the performance budget.",
  );
  const [manifestContents, manifestStat] = await Promise.all([
    readFile(absoluteManifest),
    stat(absoluteManifest),
  ]);
  return {
    id,
    manifestPath: toPosix(path.relative(root, absoluteManifest)),
    directory: path.dirname(absoluteManifest),
    manifest,
    identity: {
      path: toPosix(path.relative(root, absoluteManifest)),
      rawBytes: manifestContents.byteLength,
      modifiedAt: manifestStat.mtime.toISOString(),
      sha256: createHash("sha256").update(manifestContents).digest("hex"),
    },
  };
}

function uniqueManifestFiles(manifest, closure, field) {
  const values = [...closure].flatMap((key) => {
    const entry = manifest[key];
    return field === "file" ? [entry.file] : (entry[field] ?? []);
  });
  return [
    ...new Set(
      values.filter((value) => typeof value === "string" && value !== ""),
    ),
  ].sort();
}

async function recordsForManifestFiles(root, bundle, files, metricCache) {
  return Promise.all(
    files.map((file) =>
      fileRecord(root, safeOutputPath(bundle.directory, file), metricCache),
    ),
  );
}

async function collectManifestSegment(root, bundle, seedLabels, metricCache) {
  const seedKeys = seedLabels.map((label) =>
    findManifestEntry(bundle.manifest, label),
  );
  const closure = staticManifestClosure(bundle.manifest, seedKeys);
  const emittedFiles = uniqueManifestFiles(bundle.manifest, closure, "file");
  const javascriptFiles = emittedFiles.filter((file) => /\.m?js$/i.test(file));
  const styleFiles = [
    ...new Set([
      ...emittedFiles.filter((file) => /\.css$/i.test(file)),
      ...uniqueManifestFiles(bundle.manifest, closure, "css"),
    ]),
  ].sort();
  const referencedAssetFiles = uniqueManifestFiles(
    bundle.manifest,
    closure,
    "assets",
  );

  return {
    id: `${bundle.id}:${seedLabels.join("+")}`,
    bundle: bundle.id,
    manifestPath: bundle.manifestPath,
    seeds: seedLabels,
    manifestEntries: closure.size,
    javascriptFiles: await recordsForManifestFiles(
      root,
      bundle,
      javascriptFiles,
      metricCache,
    ),
    styleFiles: await recordsForManifestFiles(
      root,
      bundle,
      styleFiles,
      metricCache,
    ),
    referencedAssetFiles: await recordsForManifestFiles(
      root,
      bundle,
      referencedAssetFiles,
      metricCache,
    ),
  };
}

function uniqueRecords(segments, field) {
  const byPath = new Map();
  for (const segment of segments) {
    for (const record of segment[field] ?? []) byPath.set(record.path, record);
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function metricSummary(records) {
  return records.reduce(
    (summary, record) => ({
      count: summary.count + 1,
      rawBytes: summary.rawBytes + record.rawBytes,
      gzipBytes: summary.gzipBytes + record.gzipBytes,
      brotliBytes: summary.brotliBytes + record.brotliBytes,
    }),
    { count: 0, rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
}

function largestRecord(records) {
  return records.reduce(
    (largest, record) =>
      !largest || record.rawBytes > largest.rawBytes ? record : largest,
    null,
  );
}

function routeSummary({
  id,
  label,
  segments,
  baselineSegments = [],
  incrementalFrom,
}) {
  const javascriptFiles = uniqueRecords(segments, "javascriptFiles");
  const baselinePaths = new Set(
    uniqueRecords(baselineSegments, "javascriptFiles").map(
      (record) => record.path,
    ),
  );
  const incrementalFiles = javascriptFiles.filter(
    (record) => !baselinePaths.has(record.path),
  );
  const styleFiles = uniqueRecords(segments, "styleFiles");
  const referencedAssetFiles = uniqueRecords(segments, "referencedAssetFiles");
  return {
    id,
    label,
    incrementalFrom,
    segments: segments.map((segment) => ({
      bundle: segment.bundle,
      manifestPath: segment.manifestPath,
      seeds: segment.seeds,
      manifestEntries: segment.manifestEntries,
    })),
    manifestEntries: segments.reduce(
      (total, segment) => total + segment.manifestEntries,
      0,
    ),
    chunks: javascriptFiles.length,
    javascript: metricSummary(javascriptFiles),
    incrementalChunks: incrementalFiles.length,
    incrementalJavaScript: metricSummary(incrementalFiles),
    largestChunk: largestRecord(javascriptFiles),
    styles: metricSummary(styleFiles),
    referencedAssets: metricSummary(referencedAssetFiles),
    javascriptFiles,
  };
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function collectOutputInventories(root, metricCache) {
  const inventories = [];
  const largeAssets = [];
  for (const definition of OUTPUT_DEFINITIONS) {
    const directory = path.resolve(root, definition.directory);
    let files;
    try {
      files = await walkFiles(directory);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `Build output ${definition.directory} is missing. Run the corresponding asset build first.`,
          { cause: error },
        );
      }
      throw error;
    }
    let totalBytes = 0;
    const outputLargeAssets = [];
    for (const file of files) {
      const fileStat = await stat(file);
      totalBytes += fileStat.size;
      if (fileStat.size > LARGE_ASSET_THRESHOLD_BYTES) {
        const record = await fileRecord(root, file, metricCache);
        outputLargeAssets.push(record);
        largeAssets.push({ ...record, output: definition.id });
      }
    }
    const largeSummary = metricSummary(outputLargeAssets);
    inventories.push({
      id: definition.id,
      label: definition.label,
      directory: definition.directory,
      files: files.length,
      totalBytes,
      largeFiles: outputLargeAssets.length,
      largeFilesRawBytes: largeSummary.rawBytes,
      largestLargeFile: largestRecord(outputLargeAssets),
    });
  }
  largeAssets.sort(
    (left, right) =>
      right.rawBytes - left.rawBytes || left.path.localeCompare(right.path),
  );
  const duplicateGroups = new Map();
  for (const asset of largeAssets) {
    const group = duplicateGroups.get(asset.sha256) ?? [];
    group.push(asset);
    duplicateGroups.set(asset.sha256, group);
  }
  const duplicateLargeAssets = [...duplicateGroups.entries()]
    .filter(([, assets]) => assets.length > 1)
    .map(([sha256, assets]) => ({
      sha256,
      rawBytes: assets[0].rawBytes,
      paths: assets.map((asset) => asset.path).sort(),
    }))
    .sort((left, right) => right.rawBytes - left.rawBytes);
  return { inventories, largeAssets, duplicateLargeAssets };
}

function addCheck(checks, { scope, metric, actual, limit, rationale }) {
  const hasValidMeasurement =
    typeof actual === "number" && Number.isFinite(actual) && actual >= 0;
  checks.push({
    scope,
    metric,
    actual,
    limit,
    passed: hasValidMeasurement && actual <= limit,
    rationale,
  });
}

export function evaluateWordPressPerformance(report) {
  const checks = [];
  for (const [routeId, budget] of Object.entries(WORDPRESS_ROUTE_BUDGETS)) {
    const route = report.routes.find((candidate) => candidate.id === routeId);
    if (!route) {
      checks.push({
        scope: `route:${routeId}`,
        metric: "present",
        actual: 0,
        limit: 1,
        passed: false,
        rationale:
          "Every protected route must be present in the generated report.",
      });
      continue;
    }
    const scope = `route:${routeId}`;
    addCheck(checks, {
      scope,
      metric: "chunks",
      actual: route.chunks,
      limit: budget.maxChunks,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "javascript.rawBytes",
      actual: route.javascript.rawBytes,
      limit: budget.javascript.rawBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "javascript.gzipBytes",
      actual: route.javascript.gzipBytes,
      limit: budget.javascript.gzipBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "javascript.brotliBytes",
      actual: route.javascript.brotliBytes,
      limit: budget.javascript.brotliBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "largestChunk.rawBytes",
      actual: route.largestChunk?.rawBytes ?? 0,
      limit: budget.maxLargestChunkRawBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "styles.count",
      actual: route.styles.count,
      limit: budget.maxStyleFiles,
      rationale: budget.rationale,
    });
    for (const metric of ["rawBytes", "gzipBytes", "brotliBytes"]) {
      addCheck(checks, {
        scope,
        metric: `styles.${metric}`,
        actual: route.styles[metric],
        limit: budget.styles[metric],
        rationale: budget.rationale,
      });
    }
    if (budget.incremental) {
      addCheck(checks, {
        scope,
        metric: "incrementalChunks",
        actual: route.incrementalChunks,
        limit: budget.incremental.maxChunks,
        rationale: budget.rationale,
      });
      addCheck(checks, {
        scope,
        metric: "incremental.rawBytes",
        actual: route.incrementalJavaScript.rawBytes,
        limit: budget.incremental.rawBytes,
        rationale: budget.rationale,
      });
      addCheck(checks, {
        scope,
        metric: "incremental.gzipBytes",
        actual: route.incrementalJavaScript.gzipBytes,
        limit: budget.incremental.gzipBytes,
        rationale: budget.rationale,
      });
      addCheck(checks, {
        scope,
        metric: "incremental.brotliBytes",
        actual: route.incrementalJavaScript.brotliBytes,
        limit: budget.incremental.brotliBytes,
        rationale: budget.rationale,
      });
    }
  }

  for (const [outputId, budget] of Object.entries(WORDPRESS_OUTPUT_BUDGETS)) {
    const output = report.outputs.find(
      (candidate) => candidate.id === outputId,
    );
    if (!output) {
      checks.push({
        scope: `output:${outputId}`,
        metric: "present",
        actual: 0,
        limit: 1,
        passed: false,
        rationale:
          "Every protected compiled output must be present in the generated report.",
      });
      continue;
    }
    const scope = `output:${outputId}`;
    addCheck(checks, {
      scope,
      metric: "files",
      actual: output.files,
      limit: budget.maxFiles,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "totalBytes",
      actual: output.totalBytes,
      limit: budget.maxTotalBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "largeFiles",
      actual: output.largeFiles,
      limit: budget.maxLargeFiles,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "largeFilesRawBytes",
      actual: output.largeFilesRawBytes,
      limit: budget.maxLargeFilesTotalBytes,
      rationale: budget.rationale,
    });
    addCheck(checks, {
      scope,
      metric: "largestLargeFile.rawBytes",
      actual: output.largestLargeFile?.rawBytes ?? 0,
      limit: budget.maxLargeFileBytes,
      rationale: budget.rationale,
    });
  }

  for (const [assetId, budget] of Object.entries(
    WORDPRESS_SOURCE_ASSET_BUDGETS,
  )) {
    const asset = report.sourceAssets?.find(
      (candidate) => candidate.id === assetId,
    );
    if (!asset) {
      checks.push({
        scope: `sourceAsset:${assetId}`,
        metric: "present",
        actual: 0,
        limit: 1,
        passed: false,
        rationale: "Every protected source asset must be measured.",
      });
      continue;
    }
    const scope = `sourceAsset:${assetId}`;
    for (const metric of ["rawBytes", "gzipBytes", "brotliBytes"]) {
      addCheck(checks, {
        scope,
        metric,
        actual: asset[metric],
        limit: budget[metric],
        rationale: budget.rationale,
      });
    }
  }
  const failures = checks.filter((check) => !check.passed);
  return { passed: failures.length === 0, checks, failures };
}

export async function collectWordPressPerformance({
  root = WORDPRESS_PERFORMANCE_ROOT,
  chunkModuleManifestPaths,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const metricCache = new Map();
  const [packageJson, mainBundle] = await Promise.all([
    readJson(path.join(resolvedRoot, "package.json")),
    manifestBundle(
      resolvedRoot,
      "main",
      "Wordpress/kodety/assets/manifest.json",
    ),
  ]);
  const manifestBundles = new Map([
    [mainBundle.id, mainBundle],
  ]);
  const chunkModuleSidecars = await Promise.all(
    CHUNK_MODULE_SIDECAR_DEFINITIONS.map((definition) =>
      loadChunkModuleSidecar({
        root: resolvedRoot,
        definition,
        bundle: manifestBundles.get(definition.id),
        sidecarPath:
          chunkModuleManifestPaths &&
          Object.hasOwn(chunkModuleManifestPaths, definition.id)
            ? chunkModuleManifestPaths[definition.id]
            : process.env[definition.environmentVariable]?.trim()
              || definition.defaultPath,
      }),
    ),
  );
  const moduleDuplication = analyzeChunkModuleDuplication(
    chunkModuleSidecars,
    { root: resolvedRoot },
  );

  const shell = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    ["Wordpress/editor/main.tsx"],
    metricCache,
  );
  const builder = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    ["Wordpress/editor/main.tsx", "HtmlProjectEditor"],
    metricCache,
  );
  const settings = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    [
      "Wordpress/editor/main.tsx",
      "WordPressSettingsWorkspace",
      "HtmlProjectSettingsHost",
      "HtmlProjectSettings",
    ],
    metricCache,
  );
  const cms = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    ["Wordpress/editor/main.tsx", "WordPressCmsWorkspace"],
    metricCache,
  );
  const analytics = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    ["Wordpress/editor/main.tsx", "WordPressAnalyticsWorkspace"],
    metricCache,
  );
  const email = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    ["Wordpress/email-editor/main.tsx"],
    metricCache,
  );
  const componentCompiler = await collectManifestSegment(
    resolvedRoot,
    mainBundle,
    [
      "Wordpress/editor/main.tsx",
      "HtmlProjectEditor",
      "packages/component-compiler/src/index.ts",
    ],
    metricCache,
  );
  const routes = [
    routeSummary({
      id: "shell",
      label: "Editor shell",
      segments: [shell],
      incrementalFrom: "standalone",
    }),
    routeSummary({
      id: "builder",
      label: "Builder",
      segments: [builder],
      baselineSegments: [shell],
      incrementalFrom: "Editor shell",
    }),
    routeSummary({
      id: "settings",
      label: "Settings",
      segments: [settings],
      baselineSegments: [shell],
      incrementalFrom: "Editor shell",
    }),
    routeSummary({
      id: "cms",
      label: "CMS",
      segments: [cms],
      baselineSegments: [shell],
      incrementalFrom: "Editor shell",
    }),
    routeSummary({
      id: "analytics",
      label: "Analytics",
      segments: [analytics],
      baselineSegments: [shell],
      incrementalFrom: "Editor shell",
    }),
    routeSummary({
      id: "email",
      label: "Email Editor",
      segments: [email],
      incrementalFrom: "standalone",
    }),
    routeSummary({
      id: "componentCompiler",
      label: "Component compiler",
      segments: [componentCompiler],
      baselineSegments: [builder],
      incrementalFrom: "Builder",
    }),
  ];
  const outputInventory = await collectOutputInventories(
    resolvedRoot,
    metricCache,
  );
  const sourceAssets = await Promise.all(
    Object.entries(WORDPRESS_SOURCE_ASSET_BUDGETS).map(
      async ([id, budget]) => ({
        id,
        label: budget.label,
        ...(await fileRecord(
          resolvedRoot,
          path.resolve(resolvedRoot, budget.path),
          metricCache,
        )),
      }),
    ),
  );
  const report = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    packageVersion: packageJson.version,
    wordpressVersion: packageJson.kodety?.wordpressVersion ?? "",
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      zlib: process.versions.zlib ?? "unknown",
      brotli: process.versions.brotli ?? "unknown",
    },
    measurementScope:
      "This report measures the compiled output tree currently present on disk. " +
      "It does not prove that those generated files are up to date with the current source tree. " +
      "Source-asset budgets use the current sources, so stale compiled files may fail until the authorized final rebuild. " +
      "Chunk-module sidecars must exactly match the JavaScript chunks in the main compiled manifest.",
    compiledManifests: [mainBundle.identity],
    compiledChunkModuleManifests: chunkModuleSidecars.map(
      (sidecar) => sidecar.identity,
    ),
    compression: {
      gzip: "node:zlib default level",
      brotliQuality: BROTLI_QUALITY,
      aggregation: "sum of individually compressed response files",
    },
    largeAssetThresholdBytes: LARGE_ASSET_THRESHOLD_BYTES,
    routes,
    outputs: outputInventory.inventories,
    sourceAssets,
    largeAssets: outputInventory.largeAssets,
    duplicateLargeAssets: outputInventory.duplicateLargeAssets,
    duplicateAnalysis:
      "duplicateLargeAssets detects only byte-identical emitted files above the large-asset threshold. " +
      "Structural dependency/module duplication is reported separately from chunk-module sidecars and does not infer removable bytes.",
    moduleDuplication,
    budgets: {
      routes: WORDPRESS_ROUTE_BUDGETS,
      outputs: WORDPRESS_OUTPUT_BUDGETS,
      sourceAssets: WORDPRESS_SOURCE_ASSET_BUDGETS,
    },
  };
  report.budgetEvaluation = evaluateWordPressPerformance(report);
  return report;
}

export function performanceFailureMessage(failure) {
  if (failure.metric === "present") {
    return `${failure.scope} is missing from the generated report`;
  }
  const formatter = failure.metric.toLowerCase().includes("bytes")
    ? formatBytes
    : String;
  if (
    typeof failure.actual !== "number" ||
    !Number.isFinite(failure.actual) ||
    failure.actual < 0
  ) {
    return `${failure.scope} ${failure.metric}: missing or invalid measurement; limit is ${formatter(failure.limit)}`;
  }
  return `${failure.scope} ${failure.metric}: ${formatter(failure.actual)} exceeds ${formatter(failure.limit)}`;
}

export async function runPerformanceCollectionSelfTest() {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "kodety-wordpress-performance-fixture-"),
  );
  try {
    const manifest = {
      "src/entry.ts": {
        name: "fixture-entry",
        src: "src/entry.ts",
        file: "assets/entry.js",
        imports: ["_shared.js", "style.css"],
        dynamicImports: ["_lazy.js"],
        css: ["assets/entry.css"],
        assets: ["assets/logo.svg"],
      },
      "_shared.js": {
        name: "fixture-shared",
        file: "assets/shared.js",
        imports: ["_cycle.js"],
        css: ["assets/shared.css"],
        assets: ["assets/font.woff2"],
      },
      "_cycle.js": {
        name: "fixture-cycle",
        file: "assets/cycle.js",
        imports: ["_shared.js"],
        assets: ["assets/logo.svg"],
      },
      "style.css": {
        src: "style.css",
        file: "assets/standalone.css",
      },
      "_lazy.js": {
        name: "fixture-lazy",
        file: "assets/lazy.js",
      },
      "../../linked/packages/component-compiler/src/index.ts": {
        src: "../../linked/packages/component-compiler/src/index.ts",
        file: "assets/compiler.js",
      },
    };
    const files = {
      "assets/entry.js": "export const entry = true;\n",
      "assets/shared.js": "export const shared = true;\n",
      "assets/cycle.js": "export const cycle = true;\n",
      "assets/lazy.js": "export const lazy = true;\n",
      "assets/compiler.js": "export const compiler = true;\n",
      "assets/entry.css": ".entry { color: red; }\n",
      "assets/shared.css": ".shared { color: blue; }\n",
      "assets/standalone.css": ".standalone { display: block; }\n",
      "assets/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
      "assets/font.woff2": "synthetic-font\n",
    };

    await mkdir(path.join(fixtureRoot, "assets"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(fixtureRoot, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      ),
      ...Object.entries(files).map(([relativeFile, contents]) =>
        writeFile(path.join(fixtureRoot, relativeFile), contents, "utf8"),
      ),
    ]);

    assert.equal(
      findManifestEntry(manifest, "src/entry.ts"),
      "src/entry.ts",
      "exact source labels must resolve their manifest entry",
    );
    assert.equal(
      findManifestEntry(manifest, "fixture-shared"),
      "_shared.js",
      "manifest names must resolve their entry",
    );
    assert.equal(
      findManifestEntry(manifest, "packages/component-compiler/src/index.ts"),
      "../../linked/packages/component-compiler/src/index.ts",
      "workspace-linked absolute sources must resolve through a portable suffix",
    );
    assert.throws(
      () => findManifestEntry(manifest, "src/missing.ts"),
      /found 0/,
      "missing manifest labels must fail closed",
    );
    assert.throws(
      () =>
        findManifestEntry(
          {
            first: { name: "ambiguous", file: "assets/first.js" },
            second: { name: "ambiguous", file: "assets/second.js" },
          },
          "ambiguous",
        ),
      /ambiguous: first, second/,
      "ambiguous manifest labels must fail closed",
    );

    const closure = staticManifestClosure(manifest, ["src/entry.ts"]);
    assert.deepEqual(
      [...closure].sort(),
      ["_cycle.js", "_shared.js", "src/entry.ts", "style.css"],
      "static closure must follow imports, tolerate cycles and exclude dynamic imports",
    );
    assert.throws(
      () =>
        staticManifestClosure(
          { entry: { file: "assets/entry.js", imports: ["missing"] } },
          ["entry"],
        ),
      /Static import missing is missing/,
      "a missing static import must fail closed",
    );

    const bundle = await manifestBundle(
      fixtureRoot,
      "fixture",
      "manifest.json",
    );
    const segment = await collectManifestSegment(
      fixtureRoot,
      bundle,
      ["src/entry.ts"],
      new Map(),
    );
    assert.equal(segment.manifestEntries, 4);
    assert.deepEqual(
      segment.javascriptFiles.map((record) => record.path),
      ["assets/cycle.js", "assets/entry.js", "assets/shared.js"],
      "collector must include every JavaScript file in the static closure only",
    );
    assert.deepEqual(
      segment.styleFiles.map((record) => record.path),
      ["assets/entry.css", "assets/shared.css", "assets/standalone.css"],
      "collector must combine manifest CSS references and emitted CSS entries",
    );
    assert.deepEqual(
      segment.referencedAssetFiles.map((record) => record.path),
      ["assets/font.woff2", "assets/logo.svg"],
      "collector must include and de-duplicate assets from the static closure",
    );
    assert.deepEqual(
      segment.referencedAssetFiles.map((record) => record.kind),
      ["font", "image"],
      "collector must retain asset kinds while measuring files",
    );

    return {
      manifestEntries: segment.manifestEntries,
      javascriptFiles: segment.javascriptFiles.length,
      styleFiles: segment.styleFiles.length,
      referencedAssetFiles: segment.referencedAssetFiles.length,
      detectedMissingEntry: true,
      detectedAmbiguousEntry: true,
      detectedMissingStaticImport: true,
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

export async function runModuleDuplicationSelfTest() {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "kodety-wordpress-module-duplication-fixture-"),
  );
  try {
    const mainManifest = {
      entry: { file: "assets/main-a.js", isEntry: true },
      shared: { file: "assets/main-z.js" },
    };
    const localizationManifest = {
      entry: { file: "assets/localization.js", isEntry: true },
    };
    const windowsFixtureRoot = fixtureRoot.replaceAll("/", "\\");
    const mainChunks = {
      "assets\\main-z.js": [
        `${fixtureRoot}/lib/shared.ts?raw`,
        `${fixtureRoot}/node_modules/@scope/pkg/dist/index.js?commonjs-proxy`,
        `${fixtureRoot}/node_modules/parent/node_modules/@scope/pkg/dist/index.js`,
        "\0fixture-helper?main-z",
      ],
      "assets/main-a.js": [
        `${windowsFixtureRoot}\\lib\\shared.ts#fragment`,
        `${fixtureRoot}/node_modules/@scope/pkg/dist/index.js`,
      ],
    };
    const localizationChunks = {
      "assets/localization.js": [
        `${windowsFixtureRoot}\\lib\\shared.ts?localization`,
        `${windowsFixtureRoot}\\node_modules\\@scope\\pkg\\dist\\index.js#localization`,
        "/@id/__x00__fixture-helper?localization",
      ],
    };
    const mainManifestPath = path.join(fixtureRoot, "main-manifest.json");
    const localizationManifestPath = path.join(
      fixtureRoot,
      "localization-manifest.json",
    );
    const mainSidecarPath = path.join(fixtureRoot, "main-chunks.json");
    const localizationSidecarPath = path.join(
      fixtureRoot,
      "localization-chunks.json",
    );
    await Promise.all([
      writeFile(mainManifestPath, JSON.stringify(mainManifest), "utf8"),
      writeFile(
        localizationManifestPath,
        JSON.stringify(localizationManifest),
        "utf8",
      ),
      writeFile(mainSidecarPath, JSON.stringify(mainChunks), "utf8"),
      writeFile(
        localizationSidecarPath,
        JSON.stringify(localizationChunks),
        "utf8",
      ),
    ]);

    assert.equal(
      normalizeChunkModuleId(
        "C:\\workspace\\node_modules\\@scope\\pkg\\dist\\index.js?raw",
        { root: "C:\\workspace" },
      ),
      "node_modules/@scope/pkg/dist/index.js",
      "Windows module IDs and queries must normalize to portable relative paths",
    );
    assert.equal(
      normalizeChunkModuleId(
        "/workspace/node_modules/parent/node_modules/@scope/pkg/dist/index.js",
        { root: "/workspace" },
      ),
      "node_modules/parent/node_modules/@scope/pkg/dist/index.js",
      "nested dependency install paths must remain distinct",
    );
    assert.equal(
      normalizeChunkModuleId("/@id/__x00__fixture-helper?query"),
      "virtual:fixture-helper",
      "encoded Vite virtual IDs and queries must normalize deterministically",
    );

    const [mainBundle, localizationBundle] = await Promise.all([
      manifestBundle(fixtureRoot, "main", "main-manifest.json"),
      manifestBundle(
        fixtureRoot,
        "localization",
        "localization-manifest.json",
      ),
    ]);
    const mainDefinition = CHUNK_MODULE_SIDECAR_DEFINITIONS.find(
      (definition) => definition.id === "main",
    );
    // A second synthetic bundle keeps cross-bundle duplication coverage
    // without requiring any separately distributed extension.
    const localizationDefinition = {
      id: "localization",
      label: "Secondary fixture bundle",
      environmentVariable: "KODETY_TEST_SECONDARY_CHUNK_MANIFEST",
    };
    const sidecars = await Promise.all([
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: mainSidecarPath,
      }),
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: localizationDefinition,
        bundle: localizationBundle,
        sidecarPath: localizationSidecarPath,
      }),
    ]);
    const analysis = analyzeChunkModuleDuplication(sidecars, {
      root: fixtureRoot,
    });
    assert.deepEqual(
      analysis.duplicateModules.map((duplicate) => duplicate.module),
      [
        "lib/shared.ts",
        "node_modules/@scope/pkg/dist/index.js",
        "virtual:fixture-helper",
      ],
      "within-bundle, cross-bundle and virtual duplicates must be ordered by normalized module ID",
    );
    const sharedDuplicate = analysis.duplicateModules[0];
    assert.deepEqual(sharedDuplicate.bundles, ["main", "localization"]);
    assert.deepEqual(sharedDuplicate.withinBundles, ["main"]);
    assert.deepEqual(sharedDuplicate.occurrences, [
      { bundle: "main", chunk: "assets/main-a.js" },
      { bundle: "main", chunk: "assets/main-z.js" },
      { bundle: "localization", chunk: "assets/localization.js" },
    ]);
    const scopedDuplicate = analysis.duplicateModules[1];
    assert.equal(scopedDuplicate.kind, "dependency");
    assert.equal(scopedDuplicate.packageName, "@scope/pkg");
    assert.deepEqual(scopedDuplicate.dependencyChain, ["@scope/pkg"]);
    assert.deepEqual(
      moduleClassification(
        "node_modules/parent/node_modules/@scope/pkg/dist/index.js",
      ).dependencyChain,
      ["parent", "@scope/pkg"],
      "nested and scoped package identities must remain explicit",
    );
    assert.deepEqual(analysis.summary, {
      bundles: 2,
      chunks: 3,
      moduleEntries: 9,
      normalizedOccurrences: 9,
      uniqueModules: 4,
      duplicateModules: 3,
      withinBundleDuplicateModules: 2,
      crossBundleDuplicateModules: 3,
    });
    const analysisKeys = [];
    const collectKeys = (value) => {
      if (Array.isArray(value)) {
        for (const entry of value) collectKeys(entry);
        return;
      }
      if (!isPlainObject(value)) return;
      for (const [key, entry] of Object.entries(value)) {
        analysisKeys.push(key);
        collectKeys(entry);
      }
    };
    collectKeys(analysis);
    assert.deepEqual(
      analysisKeys.filter((key) => /saving|recoverable|removable.*bytes/i.test(key)),
      [],
      "structural analysis must not invent a byte-savings metric",
    );

    const reversedSidecars = [...sidecars]
      .reverse()
      .map((sidecar) => ({
        ...sidecar,
        chunks: Object.fromEntries(
          Object.entries(sidecar.chunks)
            .reverse()
            .map(([chunk, modules]) => [chunk, [...modules].reverse()]),
        ),
      }));
    assert.deepEqual(
      analyzeChunkModuleDuplication(reversedSidecars, { root: fixtureRoot }),
      analysis,
      "module duplication output must not depend on sidecar, chunk or module order",
    );

    const malformedPath = path.join(fixtureRoot, "malformed.json");
    await writeFile(malformedPath, "{", "utf8");
    await assert.rejects(
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: malformedPath,
      }),
      /malformed JSON/,
      "malformed JSON must fail closed",
    );
    await writeFile(
      malformedPath,
      JSON.stringify({ "assets/main-a.js": "not-an-array" }),
      "utf8",
    );
    await assert.rejects(
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: malformedPath,
      }),
      /must be an array/,
      "malformed module maps must fail closed",
    );

    const stalePath = path.join(fixtureRoot, "stale.json");
    await writeFile(
      stalePath,
      JSON.stringify({
        "assets/main-a.js": [],
        "assets/orphan.js": [],
      }),
      "utf8",
    );
    await assert.rejects(
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: stalePath,
      }),
      /is stale[\s\S]*main-z\.js[\s\S]*orphan\.js/,
      "sidecars from another build must fail closed",
    );
    await assert.rejects(
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: undefined,
      }),
      /is not set/,
      "a missing sidecar path must fail closed",
    );
    await assert.rejects(
      loadChunkModuleSidecar({
        root: fixtureRoot,
        definition: mainDefinition,
        bundle: mainBundle,
        sidecarPath: path.join(fixtureRoot, "missing-sidecar.json"),
      }),
      /is missing/,
      "a missing sidecar file must fail closed",
    );

    return {
      duplicateModules: analysis.summary.duplicateModules,
      withinBundleDuplicateModules:
        analysis.summary.withinBundleDuplicateModules,
      crossBundleDuplicateModules: analysis.summary.crossBundleDuplicateModules,
      detectedMissingSidecar: true,
      detectedMalformedSidecar: true,
      detectedStaleSidecar: true,
      deterministicOrdering: true,
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function passingEvaluatorFixture() {
  const routes = Object.entries(WORDPRESS_ROUTE_BUDGETS).map(
    ([id, budget]) => ({
      id,
      chunks: Math.max(0, budget.maxChunks - 1),
      javascript: {
        rawBytes: Math.max(0, budget.javascript.rawBytes - 1),
        gzipBytes: Math.max(0, budget.javascript.gzipBytes - 1),
        brotliBytes: Math.max(0, budget.javascript.brotliBytes - 1),
      },
      incrementalChunks: Math.max(0, (budget.incremental?.maxChunks ?? 1) - 1),
      incrementalJavaScript: {
        rawBytes: Math.max(0, (budget.incremental?.rawBytes ?? 1) - 1),
        gzipBytes: Math.max(0, (budget.incremental?.gzipBytes ?? 1) - 1),
        brotliBytes: Math.max(0, (budget.incremental?.brotliBytes ?? 1) - 1),
      },
      largestChunk: {
        rawBytes: Math.max(0, budget.maxLargestChunkRawBytes - 1),
      },
      styles: {
        count: Math.max(0, budget.maxStyleFiles - 1),
        rawBytes: Math.max(0, budget.styles.rawBytes - 1),
        gzipBytes: Math.max(0, budget.styles.gzipBytes - 1),
        brotliBytes: Math.max(0, budget.styles.brotliBytes - 1),
      },
    }),
  );
  const outputs = Object.entries(WORDPRESS_OUTPUT_BUDGETS).map(
    ([id, budget]) => ({
      id,
      files: Math.max(0, budget.maxFiles - 1),
      totalBytes: Math.max(0, budget.maxTotalBytes - 1),
      largeFiles: Math.max(0, budget.maxLargeFiles - 1),
      largeFilesRawBytes: Math.max(0, budget.maxLargeFilesTotalBytes - 1),
      largestLargeFile: { rawBytes: Math.max(0, budget.maxLargeFileBytes - 1) },
    }),
  );
  const sourceAssets = Object.entries(WORDPRESS_SOURCE_ASSET_BUDGETS).map(
    ([id, budget]) => ({
      id,
      rawBytes: Math.max(0, budget.rawBytes - 1),
      gzipBytes: Math.max(0, budget.gzipBytes - 1),
      brotliBytes: Math.max(0, budget.brotliBytes - 1),
    }),
  );
  return { routes, outputs, sourceAssets };
}

export function runBudgetEvaluatorSelfTest() {
  const passing = passingEvaluatorFixture();
  const passingResult = evaluateWordPressPerformance(passing);
  if (!passingResult.passed)
    throw new Error("A valid performance-budget fixture did not pass.");

  const invalidMeasurement = structuredClone(passing);
  invalidMeasurement.routes.find(
    (route) => route.id === "settings",
  ).javascript.rawBytes = null;
  const invalidMeasurementResult = evaluateWordPressPerformance(
    invalidMeasurement,
  );
  if (
    invalidMeasurementResult.passed ||
    !invalidMeasurementResult.failures.some(
      (failure) =>
        failure.scope === "route:settings" &&
        failure.metric === "javascript.rawBytes",
    )
  ) {
    throw new Error(
      "The evaluator accepted a missing or invalid numeric measurement.",
    );
  }

  const overBudget = structuredClone(passing);
  overBudget.routes.find(
    (route) => route.id === "settings",
  ).javascript.rawBytes =
    WORDPRESS_ROUTE_BUDGETS.settings.javascript.rawBytes + 1;
  const overBudgetResult = evaluateWordPressPerformance(overBudget);
  if (
    overBudgetResult.passed ||
    !overBudgetResult.failures.some(
      (failure) =>
        failure.scope === "route:settings" &&
        failure.metric === "javascript.rawBytes",
    )
  ) {
    throw new Error(
      "The evaluator did not reject a route above its raw-byte ceiling.",
    );
  }

  const styleOverflow = structuredClone(passing);
  styleOverflow.routes.find((route) => route.id === "builder").styles.rawBytes =
    WORDPRESS_ROUTE_BUDGETS.builder.styles.rawBytes + 1;
  const styleOverflowResult = evaluateWordPressPerformance(styleOverflow);
  if (
    styleOverflowResult.passed ||
    !styleOverflowResult.failures.some(
      (failure) =>
        failure.scope === "route:builder" &&
        failure.metric === "styles.rawBytes",
    )
  ) {
    throw new Error(
      "The evaluator did not reject a route above its CSS raw-byte ceiling.",
    );
  }

  const missingRoute = structuredClone(passing);
  missingRoute.routes = missingRoute.routes.filter(
    (route) => route.id !== "cms",
  );
  const missingRouteResult = evaluateWordPressPerformance(missingRoute);
  if (
    missingRouteResult.passed ||
    !missingRouteResult.failures.some(
      (failure) =>
        failure.scope === "route:cms" && failure.metric === "present",
    )
  ) {
    throw new Error("The evaluator did not reject a missing protected route.");
  }

  const outputOverflow = structuredClone(passing);
  const overflowingOutput = outputOverflow.outputs.find(
    (output) => output.id === "main",
  );
  overflowingOutput.files = WORDPRESS_OUTPUT_BUDGETS.main.maxFiles + 1;
  overflowingOutput.totalBytes =
    WORDPRESS_OUTPUT_BUDGETS.main.maxTotalBytes + 1;
  overflowingOutput.largeFiles =
    WORDPRESS_OUTPUT_BUDGETS.main.maxLargeFiles + 1;
  const outputOverflowResult = evaluateWordPressPerformance(outputOverflow);
  if (
    outputOverflowResult.passed ||
    !["files", "totalBytes", "largeFiles"].every((metric) =>
      outputOverflowResult.failures.some(
        (failure) =>
          failure.scope === "output:main" && failure.metric === metric,
      ),
    )
  ) {
    throw new Error(
      "The evaluator did not reject an oversized output inventory.",
    );
  }

  const sourceAssetOverflow = structuredClone(passing);
  sourceAssetOverflow.sourceAssets.find(
    (asset) => asset.id === "mexicanFlag",
  ).rawBytes = WORDPRESS_SOURCE_ASSET_BUDGETS.mexicanFlag.rawBytes + 1;
  const sourceAssetOverflowResult =
    evaluateWordPressPerformance(sourceAssetOverflow);
  if (
    sourceAssetOverflowResult.passed ||
    !sourceAssetOverflowResult.failures.some(
      (failure) =>
        failure.scope === "sourceAsset:mexicanFlag" &&
        failure.metric === "rawBytes",
    )
  ) {
    throw new Error(
      "The evaluator did not reject an oversized protected source asset.",
    );
  }

  return {
    passingChecks: passingResult.checks.length,
    detectedInvalidMeasurement: true,
    detectedRouteOverflow: true,
    detectedStyleOverflow: true,
    detectedMissingRoute: true,
    detectedOutputOverflow: true,
    detectedSourceAssetOverflow: true,
  };
}

async function runStandalone() {
  const report = await collectWordPressPerformance();
  for (const route of report.routes) {
    console.log(
      `${route.label}: ${route.chunks} chunks, ${route.javascript.rawBytes} raw, ` +
        `${route.javascript.gzipBytes} gzip, ${route.javascript.brotliBytes} brotli; ` +
        `largest ${route.largestChunk?.path ?? "n/a"} (${route.largestChunk?.rawBytes ?? 0} raw).`,
    );
  }
  console.log(
    `Large emitted files: ${report.largeAssets.length} above ${LARGE_ASSET_THRESHOLD_BYTES} bytes.`,
  );
  if (!report.budgetEvaluation.passed) {
    for (const failure of report.budgetEvaluation.failures) {
      console.error(
        `Performance budget failed: ${performanceFailureMessage(failure)}.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `WordPress performance budgets passed (${report.budgetEvaluation.checks.length} checks).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--self-test")) {
    const evaluatorResult = runBudgetEvaluatorSelfTest();
    const [collectionResult, moduleDuplicationResult] = await Promise.all([
      runPerformanceCollectionSelfTest(),
      runModuleDuplicationSelfTest(),
    ]);
    console.log(
      `WordPress performance self-test passed (${evaluatorResult.passingChecks} budget checks; ` +
        `${collectionResult.manifestEntries} manifest entries, ${collectionResult.javascriptFiles} JS, ` +
        `${collectionResult.styleFiles} CSS and ${collectionResult.referencedAssetFiles} asset files collected; ` +
        `${moduleDuplicationResult.duplicateModules} structural module duplicates covering ` +
        `${moduleDuplicationResult.withinBundleDuplicateModules} within-bundle and ` +
        `${moduleDuplicationResult.crossBundleDuplicateModules} cross-bundle cases).`,
    );
  } else {
    await runStandalone();
  }
}
