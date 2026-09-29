import type { HtmlEditorMetadata } from './project-io';
import {
  sanitizePageSeoMediaForPersistence,
  sanitizeSiteSeoMediaForPersistence,
} from './seo-settings';
import type { HtmlProject, HtmlProjectFile } from './types';

interface MetadataCacheEntry {
  text: string;
  metadata: HtmlEditorMetadata | null;
}

const metadataCache = new WeakMap<HtmlProjectFile, MetadataCacheEntry>();

/**
 * Small project-metadata primitives for panels that already received their
 * text files. Keeping these operations outside project-io prevents ZIP,
 * compiler and binary-conversion code from entering a lightweight route.
 */
export function readEditorMetadata(project: HtmlProject): HtmlEditorMetadata {
  const file = project.files['.incode/project.json'];
  const text = file?.text;
  if (!file || !text) return { version: 1, name: project.name };
  const cached = metadataCache.get(file);
  if (cached?.text === text) return cached.metadata ?? { version: 1, name: project.name };
  let metadata: HtmlEditorMetadata | null = null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as HtmlEditorMetadata;
    }
  } catch {
    metadata = null;
  }
  metadataCache.set(file, { text, metadata });
  return metadata ?? { version: 1, name: project.name };
}

export function updateTextFile(project: HtmlProject, path: string, text: string): HtmlProject {
  if (project.files[path]?.text === text) return project;
  return {
    ...project,
    files: { ...project.files, [path]: { ...project.files[path], path, text } },
  };
}

export function updateEditorMetadata(
  project: HtmlProject,
  update: (metadata: HtmlEditorMetadata) => HtmlEditorMetadata,
): HtmlProject {
  const updated = update(readEditorMetadata(project));
  const metadata: HtmlEditorMetadata = {
    ...updated,
    ...(updated.siteSettings
      ? { siteSettings: sanitizeSiteSeoMediaForPersistence(updated.siteSettings) }
      : {}),
    ...(updated.pageSettings
      ? {
        pageSettings: Object.fromEntries(
          Object.entries(updated.pageSettings).map(([pagePath, settings]) => [
            pagePath,
            sanitizePageSeoMediaForPersistence(settings),
          ]),
        ),
      }
      : {}),
  };
  const path = '.incode/project.json';
  return {
    ...project,
    files: {
      ...project.files,
      [path]: { path, mimeType: 'application/json', text: JSON.stringify(metadata, null, 2) },
    },
  };
}
