import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectWordPressPerformance,
  formatBytes,
  performanceFailureMessage,
  WORDPRESS_PERFORMANCE_ROOT,
} from "./wordpress-performance-budget.mjs";

const markdownEscape = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

function budgetStatus(report, routeId) {
  const checks = report.budgetEvaluation.checks.filter(
    (check) => check.scope === `route:${routeId}`,
  );
  return checks.every((check) => check.passed) ? "pass" : "FAIL";
}

export function renderWordPressPerformanceMarkdown(report) {
  const lines = [
    "# WordPress performance baseline",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Package: ${report.packageVersion}; WordPress: ${report.wordpressVersion}.`,
    "",
    `Environment: Node ${report.environment.node}; ${report.environment.platform}/${report.environment.architecture}; ` +
      `zlib ${report.environment.zlib}; Brotli ${report.environment.brotli}.`,
    "",
    `> Scope: ${report.measurementScope}`,
    "",
    `Compression: ${report.compression.gzip}; Brotli quality ${report.compression.brotliQuality}; ${report.compression.aggregation}.`,
    "",
    "## Compiled manifest identity",
    "",
    "| Manifest | Modified | Raw | SHA-256 |",
    "| --- | --- | ---: | --- |",
    ...report.compiledManifests.map(
      (manifest) =>
        `| ${markdownEscape(manifest.path)} | ${manifest.modifiedAt} | ${formatBytes(manifest.rawBytes)} | \`${manifest.sha256}\` |`,
    ),
    "",
    "## Chunk-module sidecar identity",
    "",
    "A final report is generated only when each sidecar exactly matches every JavaScript chunk in its compiled manifest.",
    "",
    "| Bundle | Environment variable | Path | Chunks | Module entries | Modified | Raw | SHA-256 |",
    "| --- | --- | --- | ---: | ---: | --- | ---: | --- |",
    ...report.compiledChunkModuleManifests.map(
      (sidecar) =>
        `| ${markdownEscape(sidecar.label)} | \`${sidecar.environmentVariable}\` | ${markdownEscape(sidecar.path)} | ` +
        `${sidecar.chunks} | ${sidecar.moduleEntries} | ${sidecar.modifiedAt} | ${formatBytes(sidecar.rawBytes)} | ` +
        `\`${sidecar.sha256}\` |`,
    ),
    "",
    "## Route closures",
    "",
    "| Route | Chunks | Raw | Gzip | Brotli | Incremental from | Incremental raw | Incremental gzip | Incremental Brotli | Largest chunk | Budget |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |",
  ];
  for (const route of report.routes) {
    const largest = route.largestChunk
      ? `${markdownEscape(route.largestChunk.path)} (${formatBytes(route.largestChunk.rawBytes)})`
      : "n/a";
    lines.push(
      `| ${markdownEscape(route.label)} | ${route.chunks} | ${formatBytes(route.javascript.rawBytes)} | ` +
        `${formatBytes(route.javascript.gzipBytes)} | ${formatBytes(route.javascript.brotliBytes)} | ` +
        `${markdownEscape(route.incrementalFrom)} | ${formatBytes(route.incrementalJavaScript.rawBytes)} | ` +
        `${formatBytes(route.incrementalJavaScript.gzipBytes)} | ${formatBytes(route.incrementalJavaScript.brotliBytes)} | ` +
        `${largest} | ${budgetStatus(report, route.id)} |`,
    );
  }

  lines.push(
    "",
    "## Protected source assets",
    "",
    "These checks remain valid even when the compiled baseline predates the current source tree.",
    "",
    "| Asset | Path | Raw | Gzip | Brotli | Raw ceiling | Budget |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const asset of report.sourceAssets) {
    const budget = report.budgets.sourceAssets[asset.id];
    const checks = report.budgetEvaluation.checks.filter(
      (check) => check.scope === `sourceAsset:${asset.id}`,
    );
    lines.push(
      `| ${markdownEscape(asset.label)} | ${markdownEscape(asset.path)} | ${formatBytes(asset.rawBytes)} | ` +
        `${formatBytes(asset.gzipBytes)} | ${formatBytes(asset.brotliBytes)} | ${formatBytes(budget.rawBytes)} | ` +
        `${checks.every((check) => check.passed) ? "pass" : "FAIL"} |`,
    );
  }

  lines.push(
    "",
    "## Budget ceilings",
    "",
    "| Route | Chunks | Raw | Gzip | Brotli | Largest raw | Incremental chunks | Incremental raw | Incremental gzip | Incremental Brotli | Rationale |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const budget of Object.values(report.budgets.routes)) {
    lines.push(
      `| ${markdownEscape(budget.label)} | ${budget.maxChunks} | ${formatBytes(budget.javascript.rawBytes)} | ` +
        `${formatBytes(budget.javascript.gzipBytes)} | ${formatBytes(budget.javascript.brotliBytes)} | ` +
        `${formatBytes(budget.maxLargestChunkRawBytes)} | ${budget.incremental?.maxChunks ?? "—"} | ` +
        `${budget.incremental ? formatBytes(budget.incremental.rawBytes) : "—"} | ` +
        `${budget.incremental ? formatBytes(budget.incremental.gzipBytes) : "—"} | ` +
        `${budget.incremental ? formatBytes(budget.incremental.brotliBytes) : "—"} | ` +
        `${markdownEscape(budget.rationale)} |`,
    );
  }

  lines.push(
    "",
    "## CSS ceilings by route",
    "",
    "| Route | Files | Raw | Gzip | Brotli |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const budget of Object.values(report.budgets.routes)) {
    lines.push(
      `| ${markdownEscape(budget.label)} | ${budget.maxStyleFiles} | ${formatBytes(budget.styles.rawBytes)} | ` +
        `${formatBytes(budget.styles.gzipBytes)} | ${formatBytes(budget.styles.brotliBytes)} |`,
    );
  }

  lines.push(
    "",
    "## Associated styles and referenced assets",
    "",
    "Referenced assets are manifest references, not a claim that the browser transfers every file during initial paint.",
    "",
    "| Route | CSS files | CSS raw | CSS gzip | CSS Brotli | Referenced files | Referenced raw | Referenced gzip | Referenced Brotli |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const route of report.routes) {
    lines.push(
      `| ${markdownEscape(route.label)} | ${route.styles.count} | ${formatBytes(route.styles.rawBytes)} | ` +
        `${formatBytes(route.styles.gzipBytes)} | ${formatBytes(route.styles.brotliBytes)} | ` +
        `${route.referencedAssets.count} | ${formatBytes(route.referencedAssets.rawBytes)} | ` +
        `${formatBytes(route.referencedAssets.gzipBytes)} | ${formatBytes(route.referencedAssets.brotliBytes)} |`,
    );
  }

  lines.push(
    "",
    `## Emitted files above ${formatBytes(report.largeAssetThresholdBytes)}`,
    "",
    "| Output | File | Kind | Raw | Gzip | Brotli | SHA-256 |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
  );
  for (const asset of report.largeAssets) {
    lines.push(
      `| ${markdownEscape(asset.output)} | ${markdownEscape(asset.path)} | ${asset.kind} | ` +
        `${formatBytes(asset.rawBytes)} | ${formatBytes(asset.gzipBytes)} | ${formatBytes(asset.brotliBytes)} | ` +
        `\`${asset.sha256}\` |`,
    );
  }

  lines.push("", "## Output inventory", "");
  lines.push(
    "| Output | Files | Total raw | Files above threshold | Large-file raw total | Largest large file | Budget |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- |");
  for (const output of report.outputs) {
    const outputChecks = report.budgetEvaluation.checks.filter(
      (check) => check.scope === `output:${output.id}`,
    );
    const status = outputChecks.every((check) => check.passed)
      ? "pass"
      : "FAIL";
    const largest = output.largestLargeFile
      ? `${markdownEscape(output.largestLargeFile.path)} (${formatBytes(output.largestLargeFile.rawBytes)})`
      : "n/a";
    lines.push(
      `| ${markdownEscape(output.label)} | ${output.files} | ${formatBytes(output.totalBytes)} | ` +
        `${output.largeFiles} | ${formatBytes(output.largeFilesRawBytes)} | ${largest} | ${status} |`,
    );
  }

  lines.push(
    "",
    "## Output ceilings",
    "",
    "| Output | All files | Total raw | Files above threshold | Large-file raw total | Largest large file | Rationale |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const budget of Object.values(report.budgets.outputs)) {
    lines.push(
      `| ${markdownEscape(budget.label)} | ${budget.maxFiles} | ${formatBytes(budget.maxTotalBytes)} | ` +
        `${budget.maxLargeFiles} | ${formatBytes(budget.maxLargeFilesTotalBytes)} | ` +
        `${formatBytes(budget.maxLargeFileBytes)} | ${markdownEscape(budget.rationale)} |`,
    );
  }

  lines.push("", "## Duplicate large files", "");
  lines.push(markdownEscape(report.duplicateAnalysis), "");
  if (report.duplicateLargeAssets.length === 0) {
    lines.push("No byte-identical files above the threshold were found.");
  } else {
    lines.push("| Raw | SHA-256 | Paths |", "| ---: | --- | --- |");
    for (const duplicate of report.duplicateLargeAssets) {
      lines.push(
        `| ${formatBytes(duplicate.rawBytes)} | \`${duplicate.sha256}\` | ` +
          `${duplicate.paths.map(markdownEscape).join("<br>")} |`,
      );
    }
  }

  const moduleDuplication = report.moduleDuplication;
  lines.push(
    "",
    "## Structural module duplication",
    "",
    markdownEscape(moduleDuplication.methodology),
    "",
    `Observed ${moduleDuplication.summary.normalizedOccurrences} normalized module occurrences across ` +
      `${moduleDuplication.summary.chunks} chunks and ${moduleDuplication.summary.bundles} bundles; ` +
      `${moduleDuplication.summary.duplicateModules} modules repeat structurally ` +
      `(${moduleDuplication.summary.withinBundleDuplicateModules} within a bundle; ` +
      `${moduleDuplication.summary.crossBundleDuplicateModules} across bundles).`,
    "",
    "| Bundle | Chunks | Raw module entries | Unique normalized modules |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const bundle of moduleDuplication.bundleSummaries) {
    lines.push(
      `| ${markdownEscape(bundle.label)} | ${bundle.chunks} | ${bundle.moduleEntries} | ${bundle.uniqueModules} |`,
    );
  }
  lines.push("");
  if (moduleDuplication.duplicateModules.length === 0) {
    lines.push("No repeated normalized module membership was found.");
  } else {
    lines.push(
      "| Module | Kind | Package / dependency chain | Bundles | Repeated within | Chunk occurrences |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const duplicate of moduleDuplication.duplicateModules) {
      const dependency = duplicate.packageName
        ? duplicate.dependencyChain.join(" → ")
        : "—";
      const within =
        duplicate.withinBundles.length > 0
          ? duplicate.withinBundles.join(", ")
          : "—";
      const occurrences = duplicate.occurrences
        .map(
          (occurrence) =>
            `${markdownEscape(occurrence.bundle)}: ${markdownEscape(occurrence.chunk)}`,
        )
        .join("<br>");
      lines.push(
        `| \`${markdownEscape(duplicate.module)}\` | ${duplicate.kind} | ${markdownEscape(dependency)} | ` +
          `${duplicate.bundles.map(markdownEscape).join(", ")} | ${markdownEscape(within)} | ${occurrences} |`,
      );
    }
  }

  lines.push("", "## Budget result", "");
  if (report.budgetEvaluation.passed) {
    lines.push(`All ${report.budgetEvaluation.checks.length} checks passed.`);
  } else {
    lines.push(`${report.budgetEvaluation.failures.length} checks failed:`, "");
    for (const failure of report.budgetEvaluation.failures) {
      lines.push(`- ${performanceFailureMessage(failure)}.`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function writeWordPressPerformanceReport({
  root = WORDPRESS_PERFORMANCE_ROOT,
} = {}) {
  const report = await collectWordPressPerformance({ root });
  const outputDirectory = path.join(
    root,
    "artifacts/kodety-hardening/front-06",
  );
  const jsonPath = path.join(outputDirectory, "wordpress-performance.json");
  const markdownPath = path.join(outputDirectory, "wordpress-performance.md");
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderWordPressPerformanceMarkdown(report), "utf8"),
  ]);
  return { report, jsonPath, markdownPath };
}

async function runStandalone() {
  const { report, jsonPath, markdownPath } =
    await writeWordPressPerformanceReport();
  console.log(`WordPress performance JSON: ${jsonPath}`);
  console.log(`WordPress performance Markdown: ${markdownPath}`);
  console.log(
    `${report.routes.length} routes, ${report.largeAssets.length} emitted files above ` +
      `${report.largeAssetThresholdBytes} bytes, ${report.budgetEvaluation.checks.length} budget checks.`,
  );
  if (!report.budgetEvaluation.passed) {
    for (const failure of report.budgetEvaluation.failures) {
      console.error(
        `Performance budget failed: ${performanceFailureMessage(failure)}.`,
      );
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runStandalone();
}
