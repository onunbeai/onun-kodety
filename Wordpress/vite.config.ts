import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { codeComponentReactRuntimePlugin } from '../scripts/vite-code-component-runtime.mjs';
import { browserAgentRuntimePlugin } from '../scripts/vite-browser-agent.mjs';

const sourceManifestPath = process.env.KODETY_WORDPRESS_SOURCE_MANIFEST;
const chunkManifestPath = process.env.KODETY_WORDPRESS_CHUNK_MANIFEST;
const sourceModules = new Set<string>();
const wordpressAssetsDirectory = path.resolve(__dirname, 'kodety/assets');

/**
 * `emptyOutDir` removes the fixed-path FreeType fallback before every Vite
 * build. Keep it beside the hashed browser asset as part of the build itself,
 * so the PHP social renderer also works between `wordpress:assets` and the
 * final packaging step.
 */
const socialImageRuntimeFontPlugin = {
  name: 'kodety-social-image-runtime-font',
  closeBundle() {
    const sourceDirectory = path.resolve(
      __dirname,
      '../lib/html-editor/fonts/geist',
    );
    const targetDirectory = path.join(wordpressAssetsDirectory, 'fonts');
    mkdirSync(targetDirectory, { recursive: true });
    copyFileSync(
      path.join(sourceDirectory, 'Geist-Regular.ttf'),
      path.join(targetDirectory, 'geist-regular.ttf'),
    );
    copyFileSync(
      path.join(sourceDirectory, 'OFL-1.1.txt'),
      path.join(targetDirectory, 'geist-license.txt'),
    );
    const licensesDirectory = path.join(wordpressAssetsDirectory, 'licenses');
    mkdirSync(licensesDirectory, { recursive: true });
    copyFileSync(
      path.resolve(__dirname, '../node_modules/wawoff2/LICENSE'),
      path.join(licensesDirectory, 'wawoff2-license.txt'),
    );
    copyFileSync(
      path.resolve(__dirname, '../node_modules/@jsquash/avif/LICENSE'),
      path.join(licensesDirectory, 'jsquash-avif-license.txt'),
    );
  },
};

/**
 * The published form runtime is source-controlled outside Vite's graph, but
 * it must be present immediately after `wordpress:assets`. Copy it in the
 * build itself so the post-build runtime contract never validates a stale
 * file left by packaging.
 */
const formsRuntimePlugin = {
  name: 'kodety-forms-runtime',
  closeBundle() {
    copyFileSync(
      path.resolve(__dirname, 'runtime-assets/forms-runtime.js'),
      path.join(wordpressAssetsDirectory, 'forms-runtime.js'),
    );
  },
};

/**
 * Keep the editor shell cacheable without making optional authoring runtimes
 * (Prettier and the component compiler) eager dependencies.
 * These groups are intentionally package-specific: a catch-all vendor chunk
 * would pull lazy-only modules into the initial WordPress editor request.
 */
function wordpressEditorChunk(id: string): string | undefined {
  const moduleId = id.replace(/\\/g, '/');
  if (
    /\/node_modules\/@solar-icons\/react\/dist\/icons\/bold-duotone\/(?:archive-minimalistic|bot|danger-triangle|file-text|home-2|minimalistic-magnifier|route|shield-check|sidebar-code|settings-minimalistic|stars-minimalistic)\.mjs$/.test(moduleId)
  ) {
    // Settings and the Builder reuse these navigation glyphs. Without a small
    // shared boundary Rollup can place an individual icon in HtmlProjectEditor
    // or SettingsHost, making the lightweight Settings entry import that
    // owner's complete static closure just to render one sidebar glyph.
    return 'settings-solar-icons';
  }
  if (moduleId.endsWith('/components/ui/code-editor.tsx')) {
    // Rollup otherwise co-locates this standalone Prism wrapper with editor
    // stores, turning the first Custom Code visit into a project-io download.
    return 'code-editor-core';
  }
  if (moduleId.endsWith('/lib/utils.ts')) {
    // `cn()` is needed by the loading shell itself. Keep it out of the larger
    // Settings boundary so parse5/SEO helpers remain lazy until Settings or
    // the Builder is actually opened.
    return 'ui-shared';
  }
  if (
    /\/(?:lib\/html-editor\/(?:custom-code|framer-project-detection|project-metadata|project-path|seo-settings|social-image|workspace-draft)|stores\/useHtmlProjectSettingsStore)\.ts$/.test(moduleId)
  ) {
    // These tiny modules are shared by the standalone Settings route and the
    // Builder. Without an explicit boundary Rollup may place them inside the
    // first large dynamic owner (project-io/preview/SettingsHost), turning one
    // lightweight import into megabytes of unrelated editor dependencies.
    return 'settings-shared';
  }
  if (!moduleId.includes('/node_modules/')) return undefined;

  if (/\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(moduleId)) {
    return 'react-vendor';
  }
  if (moduleId.includes('/node_modules/@tiptap/') || moduleId.includes('/node_modules/prosemirror-')) {
    return 'rich-text-vendor';
  }
  if (moduleId.includes('/node_modules/@radix-ui/') || moduleId.includes('/node_modules/@gravity-ui/icons/')) {
    return 'ui-vendor';
  }
  if (moduleId.includes('/node_modules/@dnd-kit/')) return 'drag-drop-vendor';
  if (moduleId.includes('/node_modules/motion/') || moduleId.includes('/node_modules/swiper/')) {
    return 'motion-vendor';
  }
  if (
    moduleId.includes('/node_modules/zustand/') ||
    moduleId.includes('/node_modules/sonner/') ||
    moduleId.includes('/node_modules/lodash') ||
    moduleId.includes('/node_modules/clsx/') ||
    moduleId.includes('/node_modules/tailwind-merge/') ||
    moduleId.includes('/node_modules/class-variance-authority/')
  ) {
    return 'editor-utilities-vendor';
  }
  return undefined;
}

const sourceManifestPlugin = sourceManifestPath
  ? {
      name: 'kodety-wordpress-source-manifest',
      moduleParsed(info: { id: string }) {
        sourceModules.add(info.id);
      },
      closeBundle() {
        writeFileSync(sourceManifestPath, JSON.stringify([...sourceModules].sort(), null, 2));
      },
    }
  : null;

const chunkManifestPlugin = chunkManifestPath
  ? {
      name: 'kodety-wordpress-chunk-manifest',
      generateBundle(_options: unknown, bundle: Record<string, { type: string; modules?: Record<string, unknown> }>) {
        const chunks = Object.fromEntries(
          Object.entries(bundle)
            // Prebundled Node programs are emitted as assets for WebContainer,
            // not browser imports. Account for them without inventing modules.
            .filter(([file, output]) => output.type === 'chunk' || (output.type === 'asset' && /\.m?js$/.test(file)))
            .map(([file, output]) => [file, Object.keys(output.modules || {}).sort()]),
        );
        mkdirSync(path.dirname(chunkManifestPath), { recursive: true });
        writeFileSync(chunkManifestPath, JSON.stringify(chunks, null, 2));
      },
    }
  : null;

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  // The editor is served from wp-content/plugins/kodety/assets/, not from the
  // WordPress site root. Relative chunk URLs keep lazy imports anchored to the
  // entry module regardless of subdirectory, domain or permalink structure.
  base: './',
  plugins: [
    browserAgentRuntimePlugin(),
    codeComponentReactRuntimePlugin(),
    react(),
    socialImageRuntimeFontPlugin,
    formsRuntimePlugin,
    ...(sourceManifestPlugin ? [sourceManifestPlugin] : []),
    ...(chunkManifestPlugin ? [chunkManifestPlugin] : []),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, '..') } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: wordpressAssetsDirectory,
    emptyOutDir: true,
    manifest: 'manifest.json',
    rollupOptions: {
      // Duas aplicações independentes no mesmo manifest. O construtor de
      // email tem bundle próprio de propósito: nada dele entra no
      // carregamento do editor de sites, e vice-versa.
      input: {
        editor: path.resolve(__dirname, 'editor/main.tsx'),
        'email-editor': path.resolve(__dirname, 'email-editor/main.tsx'),
      },
      output: { manualChunks: wordpressEditorChunk },
    },
  },
});
