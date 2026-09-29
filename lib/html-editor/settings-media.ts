import type { HtmlProject, HtmlProjectFile } from './types';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};

export function isSettingsImageFile(file: HtmlProjectFile) {
  return !/(?:^|\/)\.(?:incode|coday|kodety|git)(?:\/|$)/i.test(file.path)
    && (file.mimeType.startsWith('image/') || Boolean(IMAGE_TYPES[file.path.split('.').at(-1)?.toLowerCase() || '']));
}

/** Site-wide image settings must resolve equally from the home and nested pages. */
export function settingsImageAssetUrl(path: string, rootPath = '') {
  const root = rootPath.replace(/^\/+|\/+$/g, '');
  const publicPath = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.replace(/^\/+/, '');
  return `/${publicPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Read the image first; the caller assigns a collision-free name against the
 * latest project only after this asynchronous work finishes. */
export async function readSettingsImageUpload(file: File): Promise<HtmlProjectFile> {
  const name = file.name.replaceAll('\\', '/').split('/').at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || '';
  const extension = name.split('.').at(-1)?.toLowerCase() || '';
  const mimeType = IMAGE_TYPES[extension];
  if (!mimeType || !name || name === '.' || name === '..' || (file.type && !file.type.startsWith('image/'))) throw new Error('Selecione um arquivo de imagem compatível.');
  if (!file.size) throw new Error('A imagem está vazia. Selecione outro arquivo.');
  return { path: name, mimeType, data: new Uint8Array(await file.arrayBuffer()) };
}

export function addSettingsImageFile(project: HtmlProject, image: HtmlProjectFile) {
  const prefix = [project.rootPath.replace(/^\/+|\/+$/g, ''), 'assets'].filter(Boolean).join('/');
  const existingPaths = Object.keys(project.files).map(path => path.toLowerCase());
  const parents = prefix.split('/');
  if (parents.some((_part, index) => existingPaths.includes(parents.slice(0, index + 1).join('/').toLowerCase()))) {
    throw new Error('Um arquivo está ocupando a pasta de imagens do projeto. Renomeie esse arquivo antes de enviar a imagem.');
  }
  const dot = image.path.lastIndexOf('.');
  const stem = dot > 0 ? image.path.slice(0, dot) : image.path;
  const extension = dot > 0 ? image.path.slice(dot) : '';
  let path = `${prefix}/${image.path}`;
  let counter = 2;
  while (existingPaths.some(existing => existing === path.toLowerCase() || existing.startsWith(`${path.toLowerCase()}/`))) path = `${prefix}/${stem}-${counter++}${extension}`;
  const stored = { ...image, path };
  return { project: { ...project, files: { ...project.files, [path]: stored } }, file: stored };
}
