import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { codeComponentReactRuntimePlugin } from '../scripts/vite-code-component-runtime.mjs';

const localizationChunkManifestPath =
  process.env.KODETY_WORDPRESS_LOCALIZATION_CHUNK_MANIFEST;

function privateLocalizationChunksPlugin() {
  return {
    name: 'kodety-private-localization-chunks',
    renderDynamicImport({ format, targetModuleId }: { format: string; targetModuleId?: string | null }) {
      if (format !== 'es' || !targetModuleId) return null;
      return {
        left: 'globalThis.kodetyImportLocalizationChunk(',
        right: ')',
      };
    },
    generateBundle(
      this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void },
      _options: unknown,
      bundle: Record<string, { type: string; modules?: Record<string, unknown> }>,
    ) {
      const flagsDirectory = path.resolve(__dirname, '../lib/html-editor/locale-flags');
      readdirSync(flagsDirectory)
        .filter(file => /^[a-z]{2}\.svg$/i.test(file))
        .forEach(file => {
          this.emitFile({
            type: 'asset',
            fileName: `flags/${file.toLowerCase()}`,
            source: readFileSync(path.join(flagsDirectory, file)),
          });
        });
      if (localizationChunkManifestPath) {
        const chunks = Object.fromEntries(
          Object.entries(bundle)
            .filter(([, output]) => output.type === 'chunk')
            .map(([file, output]) => [file, Object.keys(output.modules || {}).sort()]),
        );
        mkdirSync(path.dirname(localizationChunkManifestPath), { recursive: true });
        writeFileSync(
          localizationChunkManifestPath,
          JSON.stringify(chunks, null, 2),
        );
      }
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  base: './',
  publicDir: false,
  plugins: [privateLocalizationChunksPlugin(), codeComponentReactRuntimePlugin(), react()],
  resolve: {
    alias: [
      {
        find: '@/lib/html-editor/locale-flag-assets',
        replacement: path.resolve(__dirname, 'editor/localization-flag-assets.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname, '..') },
    ],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: path.resolve(__dirname, 'extensions/kodety-localization/assets'),
    emptyOutDir: true,
    // Keep lazy component styles on the already authenticated stylesheet;
    // dynamic JavaScript chunks use the protected loader configured above.
    cssCodeSplit: false,
    manifest: 'manifest.json',
    rollupOptions: {
      input: path.resolve(__dirname, 'editor/localization-main.tsx'),
      output: {
        entryFileNames: 'localization.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
