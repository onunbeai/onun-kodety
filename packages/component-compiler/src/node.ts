import path from 'node:path';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { ComponentCompiler, type CompileRequest, type CompileResult, type CompilerDiagnostic, type SourceLanguage } from './index';

export interface NodeCompileRequest extends CompileRequest {
  external?: string[];
  minify?: boolean;
  production?: boolean;
}

function loader(fileName: string, language?: SourceLanguage): esbuild.Loader {
  const extension = language || fileName.split('.').pop()?.toLowerCase();
  return extension === 'tsx' ? 'tsx' : extension === 'jsx' ? 'jsx' : ['js', 'mjs', 'cjs'].includes(extension || '') ? 'js' : 'ts';
}
function normalize(value: string) { return value.replaceAll('\\', '/').replace(/^\.\//, '') }
function esbuildDiagnostic(message: esbuild.Message): CompilerDiagnostic {
  return { severity: 'error', code: 'ESBUILD', message: message.text, file: message.location?.file, line: message.location?.line, column: message.location ? message.location.column + 1 : undefined };
}

export class NodeComponentCompiler {
  constructor(private readonly metadataCompiler = new ComponentCompiler()) {}

  async compile(request: NodeCompileRequest, signal?: AbortSignal): Promise<CompileResult> {
    signal?.throwIfAborted();
    const metadata = await this.metadataCompiler.compile({ ...request, maxBundleBytes: Number.MAX_SAFE_INTEGER }, signal);
    if (!metadata.success || !metadata.code || !metadata.componentManifest) return metadata;
    const entry = normalize(request.fileName);
    const entryDirectory = path.posix.dirname(entry);
    const virtualSources: Record<string, string> = Object.fromEntries(
      Object.entries(request.sources || {}).map(([sourcePath, source]) => [normalize(sourcePath), source]),
    );
    Object.entries(metadata.moduleGraph || {}).forEach(([modulePath, source]) => {
      virtualSources[normalize(path.posix.join(entryDirectory, modulePath))] = source;
    });
    virtualSources[entry] = metadata.code;
    const context = await esbuild.context({
      entryPoints: [`coday:${entry}`], bundle: true, platform: 'browser', format: 'esm', target: ['es2020'],
      outfile: 'component.js', write: false, sourcemap: 'external', metafile: true, minify: request.minify ?? request.production ?? false,
      legalComments: 'none', treeShaking: true, external: request.external || [],
      define: { 'process.env.NODE_ENV': JSON.stringify(request.production ? 'production' : 'development') },
      plugins: [{
        name: 'coday-virtual-components',
        setup(build) {
          build.onResolve({ filter: /^coday:/ }, args => ({ path: normalize(args.path.slice('coday:'.length)), namespace: 'coday-component' }));
          build.onResolve({ filter: /^\./, namespace: 'coday-component' }, args => {
            const resolved = normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
            const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`];
            const found = candidates.find(candidate => Object.hasOwn(virtualSources, candidate));
            return found ? { path: found, namespace: 'coday-component' } : undefined;
          });
          build.onResolve({ filter: /^[^.]/, namespace: 'coday-component' }, args => build.resolve(
            args.path === 'framer' ? '@coday/components' : args.path,
            { kind: args.kind, resolveDir: process.cwd() },
          ));
          build.onLoad({ filter: /.*/, namespace: 'coday-component' }, args => {
            const contents = virtualSources[args.path];
            if (contents === undefined) return { errors: [{ text: `Módulo virtual ${args.path} não encontrado.` }] };
            return { contents, loader: loader(args.path, args.path === entry ? request.language : undefined), resolveDir: process.cwd() };
          });
        },
      }],
    });
    const abort = () => { void context.cancel() };
    signal?.addEventListener('abort', abort, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const rebuild = context.rebuild();
      const result = await Promise.race([
        rebuild,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { void context.cancel(); reject(new Error('Compilação de produção excedeu o limite de tempo.')); }, request.timeoutMs ?? 15_000) }),
      ]);
      signal?.throwIfAborted();
      const output = result.outputFiles?.find(file => file.path.endsWith('.js'));
      const sourceMap = result.outputFiles?.find(file => file.path.endsWith('.js.map'));
      if (!output) throw new Error('O backend não gerou um bundle ESM.');
      const code = output.text;
      const bytes = output.contents.byteLength;
      if (bytes > (request.maxBundleBytes || 1_500_000)) return { success: false, diagnostics: [...metadata.diagnostics, { severity: 'error', code: 'bundle-size', message: `Bundle de produção com ${bytes} bytes excede o limite.` }], dependencies: metadata.dependencies };
      const hash = createHash('sha256').update(output.contents).digest('hex');
      const dependencies = [...new Set([...metadata.dependencies, ...Object.keys(result.metafile?.inputs || {})])];
      return { success: true, code, sourceMap: sourceMap?.text, componentManifest: { ...metadata.componentManifest, dependencies }, diagnostics: metadata.diagnostics, dependencies, hash };
    } catch (error) {
      signal?.throwIfAborted();
      if (error && typeof error === 'object' && 'errors' in error) return { success: false, diagnostics: [...metadata.diagnostics, ...((error as esbuild.BuildFailure).errors || []).map(esbuildDiagnostic)], dependencies: metadata.dependencies };
      return { success: false, diagnostics: [...metadata.diagnostics, { severity: 'error', code: 'bundle', message: error instanceof Error ? error.message : String(error), file: request.fileName }], dependencies: metadata.dependencies };
    } finally {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      await context.dispose();
    }
  }
}
