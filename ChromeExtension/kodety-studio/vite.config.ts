import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(extensionRoot, '../..');
const outputDirectory = path.join(extensionRoot, 'dist');

function copyKodetyRuntimeAssets(): Plugin {
  return {
    name: 'copy-kodety-studio-runtime-assets',
    async closeBundle() {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
      ) as { kodety?: { wordpressVersion?: string } };
      const kodetyVersion = packageJson.kodety?.wordpressVersion;
      if (!kodetyVersion || !/^\d+\.\d+\.\d+$/.test(kodetyVersion)) {
        throw new Error('package.json must declare kodety.wordpressVersion before building Onun Kodety.');
      }
      const pluginArchive = path.join(
        repositoryRoot,
        `Wordpress/dist/${kodetyVersion.replaceAll('.', '_')}.zip`,
      );
      const assetDirectory = path.join(outputDirectory, 'assets');
      await fs.mkdir(assetDirectory, { recursive: true });
      await Promise.all([
        fs.copyFile(
          pluginArchive,
          path.join(assetDirectory, 'kodety.zip'),
        ),
        fs.copyFile(
          path.join(repositoryRoot, 'public/kodety-favicon-180.png'),
          path.join(assetDirectory, 'kodety-icon.png'),
        ),
        fs.copyFile(
          path.join(repositoryRoot, 'public/kodety-filled.svg'),
          path.join(assetDirectory, 'kodety-mark.svg'),
        ),
        fs.copyFile(
          path.join(repositoryRoot, 'Wordpress/kodety/admin/fonts/inter-latin-variable.woff2'),
          path.join(assetDirectory, 'inter-latin-variable.woff2'),
        ),
        fs.copyFile(
          path.join(repositoryRoot, 'node_modules/@wp-playground/client/LICENSE'),
          path.join(outputDirectory, 'WORDPRESS-PLAYGROUND-LICENSE.txt'),
        ),
      ]);
    },
  };
}

export default defineConfig({
  root: extensionRoot,
  base: './',
  plugins: [react(), copyKodetyRuntimeAssets()],
  publicDir: path.join(extensionRoot, 'public'),
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome109',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/studio.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: assetInfo =>
          assetInfo.name?.endsWith('.css') ? 'assets/studio.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
