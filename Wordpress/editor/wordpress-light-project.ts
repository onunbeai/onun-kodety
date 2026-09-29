import type { HtmlProject } from '@/lib/html-editor/types';

type LightEditorMetadata = Record<string, unknown>;

function normalizeProjectPath(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some(part => part === '..')) return '';
  return normalized;
}

/** Parse only the already-delivered metadata file. The full project-io module
 * also owns ZIP/compiler code and is intentionally kept out of panel startup. */
export function readLightEditorMetadata(project: HtmlProject): LightEditorMetadata {
  const source = project.files['.incode/project.json']?.text;
  if (!source) return { version: 1, name: project.name };
  try {
    const parsed = JSON.parse(source) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as LightEditorMetadata
      : { version: 1, name: project.name };
  } catch {
    return { version: 1, name: project.name };
  }
}

export function getLightProjectHomePath(project: HtmlProject) {
  const metadata = readLightEditorMetadata(project);
  const declared = normalizeProjectPath(metadata.homeHtmlPath || metadata.mainHtmlPath);
  if (declared && project.files[declared]?.text !== undefined && /\.html?$/i.test(declared)) return declared;
  const pages = Object.keys(project.files).filter(path => /\.html?$/i.test(path));
  return pages.find(path => path.toLowerCase() === 'index.html')
    || pages.find(path => path.toLowerCase().endsWith('/index.html'))
    || pages.sort((left, right) => left.split('/').length - right.split('/').length)[0]
    || project.mainHtmlPath;
}
