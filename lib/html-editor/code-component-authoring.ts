import type { CompileResult, HotReloadCompiler, SourceLanguage } from '@coday/component-compiler';
import type { PublishedComponentVersion } from '@coday/component-registry';
import type { HtmlProject } from './types';
import { normalizeCodeComponentRegistry } from './code-components';
import { readEditorMetadata, updateEditorMetadata } from './project-io';

const compilerPromises = new Map<string, Promise<HotReloadCompiler>>();

function codeComponentCompiler(path: string) {
  let compiler = compilerPromises.get(path);
  if (!compiler) {
    compiler = import('@coday/component-compiler').then(module => new module.HotReloadCompiler());
    compilerPromises.set(path, compiler);
  }
  return compiler;
}

export function isCodeComponentSource(path: string, source?: string) {
  if (!/\.(?:tsx?|jsx?)$/i.test(path)) return false;
  if (/(?:^|\/)(?:code-components|components)\/.*\.(?:tsx?|jsx?)$/i.test(path)) return true;
  if (/\.(?:tsx|jsx)$/i.test(path)) return true;
  return source !== undefined && /\b(?:addPropertyControls|defineComponent)\s*\(/.test(source);
}

function language(path: string): SourceLanguage {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension === 'tsx' || extension === 'jsx' || extension === 'js' ? extension : 'ts';
}

export async function compileCodeComponentProjectFile(project: HtmlProject, path: string, author = 'Coday user') {
  const source = project.files[path]?.text;
  if (source === undefined || !isCodeComponentSource(path, source)) {
    throw new Error('O arquivo não é um Code Component editável.');
  }
  const sources = Object.fromEntries(
    Object.values(project.files)
      .filter(file => file.text !== undefined && /\.(?:tsx?|jsx?)$/i.test(file.path))
      .map(file => [file.path, file.text || '']),
  );
  // A source owns its hot-reload cancellation domain. Editing a second Code
  // Component must not abort an unrelated compile that is already in flight.
  const compiler = await codeComponentCompiler(path);
  const result = await compiler.compile({
    fileName: path,
    source,
    sources,
    language: language(path),
    typeCheck: typeof process !== 'undefined',
    maxBundleBytes: 1_500_000,
    timeoutMs: 8_000,
  });
  if (!result.success || !result.code || !result.componentManifest) return { project, result };
  const published: PublishedComponentVersion = {
    id: result.componentManifest.id,
    version: result.componentManifest.version,
    schemaVersion: result.componentManifest.schemaVersion,
    bundle: result.code,
    sourceMap: result.sourceMap,
    moduleGraph: result.moduleGraph,
    sourcePath: path,
    bundleHash: result.hash,
    manifest: result.componentManifest,
    publishedAt: new Date().toISOString(),
    author,
    dependencies: result.dependencies,
    changelog: `Development build from ${path} (${result.hash?.slice(0, 12) || 'unhashed'})`,
  };
  const existing = normalizeCodeComponentRegistry(readEditorMetadata(project).codeComponents).components.find(
    item => item.id === published.id && item.version === published.version,
  );
  if (
    existing?.bundleHash === published.bundleHash
    && existing?.sourcePath === published.sourcePath
  ) return { project, result };
  const next = updateEditorMetadata(project, metadata => {
    const snapshot = normalizeCodeComponentRegistry(metadata.codeComponents);
    const versions = snapshot.components.filter(
      item => !(item.id === published.id && item.version === published.version),
    );
    return {
      ...metadata,
      codeComponents: { ...snapshot, components: [...versions, published] },
    };
  });
  return { project: next, result };
}

export const MAX_PASTED_CODE_COMPONENT_SOURCE_LENGTH = 2_000_000;

export interface PastedCodeComponentCandidate {
  source: string;
  suggestedName: string;
}

function pascalCaseComponentName(value: string) {
  const words = value
    .replace(/\.(?:tsx?|jsx?)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  const joined = words
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join('');
  const safe = joined.replace(/^[^a-zA-Z_$]+/, '');
  return safe || 'CodeComponent';
}

export function suggestedCodeComponentName(source: string, fallback: string) {
  const manifestName = source.match(/\bname\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
  const exportedName = source.match(/\bexport\s+default\s+(?:function\s+)?([A-Z][$\w]*)/)?.[1];
  const functionName = source.match(/\b(?:function|const)\s+([A-Z][$\w]*)\b/)?.[1];
  return pascalCaseComponentName(manifestName || exportedName || functionName || fallback);
}

export function pastedCodeComponentCandidate(value: string): PastedCodeComponentCandidate | null {
  const source = value.trim();
  if (!source || source.length > MAX_PASTED_CODE_COMPONENT_SOURCE_LENGTH) return null;
  const hasRegistration = /\b(?:defineComponent|addPropertyControls)\s*\(/.test(source);
  const hasComponentSource = /\b(?:import|export)\b/.test(source)
    && /(?:<\s*[A-Za-z][^>]*>|\bReact\.(?:createElement|FC)\b|\bfunction\s+[A-Z][$\w]*\s*\()/.test(source);
  if (!hasRegistration || !hasComponentSource) return null;
  return {
    source,
    suggestedName: suggestedCodeComponentName(source, 'CodeComponent'),
  };
}

export function pastedCodeComponentPath(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Digite um nome para o Code Component.');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Use somente o nome do componente, sem pastas.');
  }
  const safeName = pascalCaseComponentName(trimmed);
  if (!/^[$A-Z_a-z][$\w]*$/.test(safeName)) {
    throw new Error('O nome precisa gerar um identificador TSX válido.');
  }
  return `code-components/${safeName}.tsx`;
}

export type CodeComponentCompileState = Pick<
  CompileResult,
  'success' | 'diagnostics' | 'hash' | 'componentManifest'
>;

export function codeComponentSources(project: HtmlProject) {
  return Object.values(project.files)
    .filter(file => file.text !== undefined && isCodeComponentSource(file.path, file.text))
    .map(file => file.path)
    .sort();
}

export function registeredCodeComponents(project: HtmlProject) {
  return normalizeCodeComponentRegistry(readEditorMetadata(project).codeComponents).components;
}
