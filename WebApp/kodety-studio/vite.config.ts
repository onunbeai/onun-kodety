import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { codeComponentReactRuntimePlugin } from "../../scripts/vite-code-component-runtime.mjs";
import { htmlMcpToolCatalogPlugin } from "../../scripts/vite-html-mcp-tools.mjs";
import { browserAgentRuntimePlugin } from "../../scripts/vite-browser-agent.mjs";
import sharp from "sharp";
import { defineConfig, type Plugin } from "vite";
import { createKodetyStudioServer } from "./public/server.mjs";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");
const outputDirectory = path.join(webRoot, "dist");

function copyKodetyWebAssets(): Plugin {
  return {
    name: "copy-kodety-studio-web-assets",
    async configureServer(server) {
      const relay = createKodetyStudioServer();
      server.httpServer?.once("close", () => relay.emit("close"));
      const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      );
      const version = packageJson.kodety.wordpressVersion;
      const assets: Record<string, [string, string]> = {
        "kodety.zip": [
          path.join(
            repositoryRoot,
            `Wordpress/dist/${version.replaceAll(".", "_")}.zip`,
          ),
          "application/zip",
        ],
        "kodety-mark.svg": [
          path.join(repositoryRoot, "public/kodety-filled.svg"),
          "image/svg+xml",
        ],
        "kodety-logo.svg": [
          path.join(webRoot, "public/assets/kodety-logo.svg"),
          "image/svg+xml",
        ],
        "inter-latin-variable.woff2": [
          path.join(
            repositoryRoot,
            "Wordpress/kodety/admin/fonts/inter-latin-variable.woff2",
          ),
          "font/woff2",
        ],
        "kodety-icon-192.png": [
          path.join(outputDirectory, "assets/kodety-icon-192.png"),
          "image/png",
        ],
        "kodety-icon-512.png": [
          path.join(outputDirectory, "assets/kodety-icon-512.png"),
          "image/png",
        ],
      };
      server.middlewares.use((request, response, next) => {
        if (["/project-storage.html", "/project-storage"].includes(request.url?.split("?")[0] || "")) {
          // The helper shares the entry bundle, but receives its own isolation
          // policy in development. Serve it here because Vite's HTML middleware
          // otherwise reapplies the main document's COEP after our middleware.
          void fs.readFile(path.join(webRoot, "index.html"), "utf8")
            .then(html => server.transformIndexHtml("/project-storage.html", html))
            .then(html => {
              response.removeHeader("Cross-Origin-Embedder-Policy");
              response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
              response.setHeader("Document-Isolation-Policy", "isolate-and-credentialless");
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.setHeader("Cache-Control", "no-store");
              response.end(html);
            }, next);
          return;
        }
        if (request.url?.startsWith("/__kodety_mcp__/") || request.url?.startsWith("/__kodety_deploy__/") || request.url?.startsWith("/__kodety_agent__/network")) {
          relay.emit("request", request, response);
          return;
        }
        const name =
          request.url?.split("?")[0].replace(/^\/assets\//, "") || "";
        const asset = assets[name];
        if (!asset || !["GET", "HEAD"].includes(request.method || "")) {
          next();
          return;
        }
        response.setHeader("Content-Type", asset[1]);
        response.setHeader("Cache-Control", "no-store");
        const stream = createReadStream(asset[0]);
        stream.on("error", () => {
          if (!response.headersSent) response.statusCode = 404;
          response.end();
        });
        stream.pipe(response);
      });
    },
    async closeBundle() {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      ) as { kodety?: { wordpressVersion?: string } };
      const kodetyVersion = packageJson.kodety?.wordpressVersion;
      if (!kodetyVersion || !/^\d+\.\d+\.\d+$/.test(kodetyVersion)) {
        throw new Error(
          "package.json must declare kodety.wordpressVersion before building Onun Kodety Web.",
        );
      }

      const pluginArchive = path.join(
        repositoryRoot,
        `Wordpress/dist/${kodetyVersion.replaceAll(".", "_")}.zip`,
      );
      const sourceIcon = path.join(
        repositoryRoot,
        "public/kodety-favicon-180.png",
      );
      const assetDirectory = path.join(outputDirectory, "assets");
      await fs.mkdir(assetDirectory, { recursive: true });
      await Promise.all([
        fs.copyFile(path.join(repositoryRoot, "LICENSE"), path.join(outputDirectory, "LICENSE")),
        fs.copyFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), path.join(outputDirectory, "THIRD_PARTY_NOTICES.md")),
        fs.copyFile(path.join(repositoryRoot, "licenses/MOTION-LICENSE.md"), path.join(outputDirectory, "MOTION-LICENSE.md")),
        fs.copyFile(path.join(repositoryRoot, "licenses/YCODE-LICENSE.md"), path.join(outputDirectory, "YCODE-LICENSE.md")),
        fs.copyFile(pluginArchive, path.join(assetDirectory, "kodety.zip")),
        fs.copyFile(
          path.join(repositoryRoot, "public/kodety-filled.svg"),
          path.join(assetDirectory, "kodety-mark.svg"),
        ),
        fs.copyFile(
          path.join(
            repositoryRoot,
            "Wordpress/kodety/admin/fonts/inter-latin-variable.woff2",
          ),
          path.join(assetDirectory, "inter-latin-variable.woff2"),
        ),
        fs.copyFile(
          path.join(
            repositoryRoot,
            "node_modules/@wp-playground/client/LICENSE",
          ),
          path.join(outputDirectory, "WORDPRESS-PLAYGROUND-LICENSE.txt"),
        ),
        sharp(sourceIcon)
          .resize(192, 192)
          .png()
          .toFile(path.join(assetDirectory, "kodety-icon-192.png")),
        sharp(sourceIcon)
          .resize(512, 512)
          .extend({
            top: 64,
            bottom: 64,
            left: 64,
            right: 64,
            background: "#111111",
          })
          .resize(512, 512)
          .png()
          .toFile(path.join(assetDirectory, "kodety-icon-512.png")),
      ]);
      // Include every lazy editor chunk and runtime asset, not only the home
      // screen visited during installation. The same cache serves browser tabs
      // and the installed PWA.
      const files: string[] = [
        "./",
        "./index.html",
        "./project-storage.html",
        "./manifest.webmanifest",
        "./manifest.en.webmanifest",
      ];
      const digest = createHash("sha256");
      const integrity: Record<string, string> = {};
      async function collect(directory: string, prefix: string) {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          const relative = `${prefix}/${entry.name}`;
          if (entry.isDirectory())
            await collect(path.join(directory, entry.name), relative);
          else {
            files.push(`./${relative}`);
            const content = await fs.readFile(path.join(directory, entry.name));
            digest
              .update(relative)
              .update(content);
            integrity[`./${relative}`] = createHash("sha256").update(content).digest("hex");
          }
        }
      }
      await collect(assetDirectory, "assets");
      const indexContent = await fs.readFile(path.join(outputDirectory, "index.html"));
      await fs.writeFile(path.join(outputDirectory, "project-storage.html"), indexContent);
      digest.update(indexContent);
      digest.update("project-storage.html").update(indexContent);
      integrity["./"] = integrity["./index.html"] = integrity["./project-storage.html"] = createHash("sha256").update(indexContent).digest("hex");
      for (const file of [
        "service-worker.js",
        "manifest.webmanifest",
        "manifest.en.webmanifest",
      ]) {
        const content = await fs.readFile(path.join(outputDirectory, file));
        digest.update(file).update(content);
        if (file !== "service-worker.js") integrity[`./${file}`] = createHash("sha256").update(content).digest("hex");
      }
      const version = digest.digest("hex").slice(0, 16);
      await fs.writeFile(
        path.join(outputDirectory, "offline-manifest.json"),
        JSON.stringify({ version, files, integrity }),
      );
      const workerPath = path.join(outputDirectory, "service-worker.js");
      const worker = await fs.readFile(workerPath, "utf8");
      await fs.writeFile(
        workerPath,
        worker.replaceAll("__KODETY_BUILD_ID__", version),
      );
    },
  };
}

export default defineConfig({
  root: webRoot,
  cacheDir: path.join(repositoryRoot, 'node_modules/.vite/kodety-studio-web'),
  base: "./",
  plugins: [codeComponentReactRuntimePlugin(), htmlMcpToolCatalogPlugin(), browserAgentRuntimePlugin(), react(), copyKodetyWebAssets()],
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  resolve: { alias: { "@": repositoryRoot } },
  css: { postcss: { plugins: [tailwindcss({ base: repositoryRoot })] } },
  publicDir: path.join(webRoot, "public"),
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    target: "chrome109",
    rollupOptions: {
      output: {
        entryFileNames: "assets/studio.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? "assets/studio.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
