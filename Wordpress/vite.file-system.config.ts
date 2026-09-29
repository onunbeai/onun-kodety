import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const fileSystemRoot = path.resolve(__dirname, 'file-system');
const pluginAssets = path.resolve(__dirname, 'kodety-file-system/assets');

function sourceFiles(directory: string, prefix = ''): Array<{ path: string; data: Buffer }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute, relative);
    return entry.isFile() ? [{ path: relative, data: readFileSync(absolute) }] : [];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

const sourceHash = sourceFiles(fileSystemRoot).reduce((hash, file) => {
  hash.update(file.path);
  hash.update('\0');
  hash.update(file.data);
  hash.update('\0');
  return hash;
}, createHash('sha256')).digest('hex');

export default defineConfig({
  root: fileSystemRoot,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@file-system': fileSystemRoot,
    },
  },
  build: {
    outDir: pluginAssets,
    emptyOutDir: true,
    manifest: false,
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(fileSystemRoot, 'main.tsx'),
      output: {
        // The PHP shell intentionally uses a normal deferred script. A single
        // IIFE keeps it compatible without `type="module"`, preload graphs or
        // runtime chunk discovery.
        format: 'iife',
        name: 'KodetyFileSystemApp',
        // Keep the marker as executable metadata: esbuild may discard banner
        // comments while minifying, but an observable global assignment is kept.
        banner: `globalThis.KodetyFileSystemSourceHash="kodety-fs-source-sha256:${sourceHash}";`,
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: assetInfo => {
          const names = assetInfo.names || [];
          if (names.some(name => name.endsWith('.woff2'))) return 'inter-latin-variable.woff2';
          if (names.some(name => name.endsWith('.css'))) return 'app.css';
          return '[name][extname]';
        },
      },
    },
  },
});
