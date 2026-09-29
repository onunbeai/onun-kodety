import type { HtmlProject } from './types';

function readJsonObject(source: string | undefined): Record<string, unknown> | null {
  if (!source) return null;
  try {
    const parsed = JSON.parse(source) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Lightweight detection shared by the editor and standalone Settings. */
export function isFramerProject(project: HtmlProject): boolean {
  const imported = readJsonObject(project.files['.incode/url-import.json']?.text);
  // The generic browser recorder also produces a framer-import manifest for
  // Webflow/Elementor/code. Its filename alone is not platform provenance.
  if (typeof imported?.platform === 'string' && imported.platform !== 'auto') {
    return imported.platform === 'framer';
  }
  const manifest = readJsonObject(project.files['.incode/framer-import.json']?.text);
  if (typeof manifest?.platform === 'string' && manifest.platform !== 'auto') return manifest.platform === 'framer';
  if (manifest?.version === 1) return true;
  return Object.values(project.files).some(file => /\.html?$/i.test(file.path) && (
    /\bdata-kodety-framer-(?:compat-runtime|baseline)\b/i.test(file.text || '')
  ));
}

export function isHydratedFramerProject(project: HtmlProject): boolean {
  if (!isFramerProject(project)) return false;
  const imported = readJsonObject(project.files['.incode/url-import.json']?.text);
  if (
    imported?.platform === 'framer'
    && (imported.framerMode === 'static' || imported.runtime === 'static-editable')
  ) return false;
  const manifest = readJsonObject(project.files['.incode/framer-import.json']?.text);
  if (manifest?.version === 1 && manifest.runtime === true) return true;
  if (imported?.platform === 'framer' && imported.runtime === 'preserved-guarded') return true;
  return Object.values(project.files).some(file => {
    if (!/\.html?$/i.test(file.path)) return false;
    const html = file.text || '';
    return html.includes('data-kodety-framer-compat-runtime')
      || (html.includes('data-kodety-framer-baseline') && html.includes('data-framer-hydrate-v2'));
  });
}
