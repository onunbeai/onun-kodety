import type { Plugin } from 'prettier';
import { getAdminUiLocale } from '../admin-ui-locale';

type PluginSet = 'html' | 'postcss' | 'babel' | 'typescript';

const FORMATTERS: Record<string, { parser: string; pluginSet: PluginSet }> = {
  html: { parser: 'html', pluginSet: 'html' },
  htm: { parser: 'html', pluginSet: 'html' },
  svg: { parser: 'html', pluginSet: 'html' },
  xml: { parser: 'html', pluginSet: 'html' },
  css: { parser: 'css', pluginSet: 'postcss' },
  scss: { parser: 'scss', pluginSet: 'postcss' },
  less: { parser: 'less', pluginSet: 'postcss' },
  js: { parser: 'babel', pluginSet: 'babel' },
  jsx: { parser: 'babel', pluginSet: 'babel' },
  mjs: { parser: 'babel', pluginSet: 'babel' },
  cjs: { parser: 'babel', pluginSet: 'babel' },
  ts: { parser: 'typescript', pluginSet: 'typescript' },
  tsx: { parser: 'typescript', pluginSet: 'typescript' },
  json: { parser: 'json', pluginSet: 'babel' },
  json5: { parser: 'json5', pluginSet: 'babel' },
};

// Prettier and its grammars account for several megabytes. Code editing loads
// instantly; the formatter chunk is fetched only after the user requests it,
// and each language family is cached independently thereafter.
type PrettierApi = Pick<typeof import('prettier/standalone'), 'format'>;
let prettierPromise: Promise<PrettierApi> | undefined;
const pluginPromises = new Map<PluginSet, Promise<Plugin[]>>();

function loadPrettier() {
  if (!prettierPromise) {
    const pending = import('prettier/standalone');
    prettierPromise = pending;
    pending.catch(() => {
      if (prettierPromise === pending) prettierPromise = undefined;
    });
  }
  return prettierPromise;
}

function loadPlugins(pluginSet: PluginSet) {
  const cached = pluginPromises.get(pluginSet);
  if (cached) return cached;
  const pending = (async (): Promise<Plugin[]> => {
    if (pluginSet === 'html') {
      const html = await import('prettier/plugins/html');
      return [html.default];
    }
    if (pluginSet === 'postcss') {
      const postcss = await import('prettier/plugins/postcss');
      return [postcss.default];
    }
    const estree = await import('prettier/plugins/estree');
    if (pluginSet === 'typescript') {
      const typescript = await import('prettier/plugins/typescript');
      return [typescript.default, estree.default];
    }
    const babel = await import('prettier/plugins/babel');
    return [babel.default, estree.default];
  })();
  pluginPromises.set(pluginSet, pending);
  pending.catch(() => pluginPromises.delete(pluginSet));
  return pending;
}

export const DEFAULT_MAX_FORMAT_SOURCE_LENGTH = 1_500_000;

export type CodeFormatErrorCode = 'unsupported-file' | 'source-too-large' | 'aborted';

export class CodeFormatError extends Error {
  constructor(
    readonly code: CodeFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodeFormatError';
  }
}

export interface FormatCodeOptions {
  signal?: AbortSignal;
  /** Set to Infinity to explicitly allow formatting sources of any size. */
  maxSourceLength?: number;
}

function extensionFromPath(path: string): string {
  const cleanPath = path.trim().split(/[?#]/, 1)[0].replaceAll('\\', '/');
  const filename = cleanPath.slice(cleanPath.lastIndexOf('/') + 1);
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : '';
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new CodeFormatError('aborted', 'A formatação foi cancelada.');
  }
}

let lastSuccessfulFormat:
  | { extension: string; source: string; formatted: string }
  | undefined;

export function canFormatCode(path: string): boolean {
  return Boolean(FORMATTERS[extensionFromPath(path)]);
}

export async function formatCode(
  path: string,
  source: string,
  options: FormatCodeOptions = {},
): Promise<string> {
  const extension = extensionFromPath(path);
  const formatter = FORMATTERS[extension];
  if (!formatter) {
    throw new CodeFormatError(
      'unsupported-file',
      'Este tipo de arquivo ainda não possui formatação automática.',
    );
  }

  assertNotAborted(options.signal);
  const configuredLimit = options.maxSourceLength ?? DEFAULT_MAX_FORMAT_SOURCE_LENGTH;
  const sourceLimit = Number.isNaN(configuredLimit)
    ? DEFAULT_MAX_FORMAT_SOURCE_LENGTH
    : Math.max(0, configuredLimit);
  if (source.length > sourceLimit) {
    throw new CodeFormatError(
      'source-too-large',
      `O arquivo excede o limite seguro de ${sourceLimit.toLocaleString(getAdminUiLocale())} caracteres para formatação automática.`,
    );
  }

  if (
    lastSuccessfulFormat?.extension === extension &&
    (lastSuccessfulFormat.source === source || lastSuccessfulFormat.formatted === source)
  ) {
    return lastSuccessfulFormat.formatted;
  }

  const [prettier, plugins] = await Promise.all([
    loadPrettier(),
    loadPlugins(formatter.pluginSet),
  ]);
  assertNotAborted(options.signal);
  const formatted = await prettier.format(source, {
    parser: formatter.parser,
    plugins,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    singleQuote: true,
    trailingComma: 'all',
  });
  assertNotAborted(options.signal);
  lastSuccessfulFormat = { extension, source, formatted };
  return formatted;
}
