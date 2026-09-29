import type { FileObject, SearchQuery, SortKey } from './types';

export const CODE_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'ts', 'tsx', 'json',
  'svg', 'xml', 'txt', 'md', 'php', 'yml', 'yaml', 'env', 'ini', 'conf', 'sql',
]);

const DANGEROUS_CODE_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'env', 'ini',
  'sh', 'bash', 'zsh', 'ps1', 'cgi', 'pl', 'py', 'rb',
]);

export function joinPath(base: string, child: string) {
  return `${base}/${child}`.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

export function parentPath(path: string) {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const parent = normalized.slice(0, normalized.lastIndexOf('/'));
  return parent || '';
}

export function pathSegments(path: string) {
  return path.split('/').filter(Boolean);
}

export function formatBytes(bytes?: number | null) {
  if (!Number.isFinite(bytes)) return '—';
  const value = Math.max(0, Number(bytes));
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[index]}`;
}

export function formatDate(value?: string | null, compact = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', compact
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(date);
}

function sizeToken(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) return undefined;
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  return Number(match[1]) * (1024 ** Math.max(0, units.indexOf(match[2] || 'b')));
}

export function parseSearchQuery(input: string): SearchQuery {
  const query: SearchQuery = { text: '' };
  const text: string[] = [];
  const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  tokens.forEach(raw => {
    const token = raw.replace(/^"|"$/g, '');
    const separator = token.indexOf(':');
    if (separator < 1) {
      if (token.startsWith('size:>')) query.minSize = sizeToken(token.slice(6));
      else if (token.startsWith('size:<')) query.maxSize = sizeToken(token.slice(6));
      else text.push(token);
      return;
    }
    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1);
    if (key === 'type') query.type = value.toLowerCase();
    else if (key === 'extension' || key === 'ext') query.extension = value.replace(/^\./, '').toLowerCase();
    else if (key === 'visibility' && ['public', 'private', 'shared'].includes(value)) query.visibility = value as SearchQuery['visibility'];
    else if (key === 'modified') query.modified = value;
    else if (key === 'tag') query.tags = [...(query.tags || []), value.toLowerCase()];
    else if (key === 'size' && value.startsWith('>')) query.minSize = sizeToken(value.slice(1));
    else if (key === 'size' && value.startsWith('<')) query.maxSize = sizeToken(value.slice(1));
    else text.push(token);
  });
  query.text = text.join(' ').toLowerCase();
  return query;
}

function fileCategory(file: FileObject) {
  const mime = file.mimeType || '';
  if (file.kind === 'folder') return 'folder';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('font/')) return 'font';
  if (mime === 'application/pdf') return 'pdf';
  return CODE_EXTENSIONS.has(extensionOf(file)) ? 'code' : 'document';
}

export function extensionOf(file: FileObject) {
  return (file.extension || file.name.split('.').pop() || '').toLowerCase();
}

export function matchesSearch(file: FileObject, query: SearchQuery) {
  if (query.text && !`${file.name} ${file.path} ${(file.tags || []).join(' ')}`.toLowerCase().includes(query.text)) return false;
  if (query.type && fileCategory(file) !== query.type) return false;
  if (query.extension && extensionOf(file) !== query.extension) return false;
  if (query.visibility && file.visibility !== query.visibility) return false;
  if (query.minSize !== undefined && (file.size || 0) <= query.minSize) return false;
  if (query.maxSize !== undefined && (file.size || 0) >= query.maxSize) return false;
  if (query.tags?.length && !query.tags.every(tag => (file.tags || []).map(item => item.toLowerCase()).includes(tag))) return false;
  if (query.modified) {
    const updated = file.updatedAt ? new Date(file.updatedAt) : null;
    const now = new Date();
    if (!updated || Number.isNaN(updated.getTime())) return false;
    if (query.modified === 'today' && updated.toDateString() !== now.toDateString()) return false;
    if (query.modified === 'this-week' && now.getTime() - updated.getTime() > 7 * 86400000) return false;
    if (query.modified === 'this-month' && (updated.getMonth() !== now.getMonth() || updated.getFullYear() !== now.getFullYear())) return false;
  }
  return true;
}

export function sortFiles(files: FileObject[], key: SortKey, direction: 'asc' | 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  return [...files].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    let comparison = 0;
    if (key === 'size') comparison = (a.size || 0) - (b.size || 0);
    else if (key === 'modified') comparison = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
    else if (key === 'type') comparison = extensionOf(a).localeCompare(extensionOf(b));
    else comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return comparison * factor;
  });
}

export function canPreview(file: FileObject) {
  if (file.kind === 'folder') return false;
  const mime = file.mimeType || '';
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf' || CODE_EXTENSIONS.has(extensionOf(file));
}

export function canEdit(file: FileObject) {
  return file.kind === 'file' && CODE_EXTENSIONS.has(extensionOf(file));
}

export function isDangerousCodeFile(file: FileObject) {
  return DANGEROUS_CODE_EXTENSIONS.has(extensionOf(file));
}

export function languageFor(file: FileObject) {
  const extension = extensionOf(file);
  if (['js', 'jsx'].includes(extension)) return 'javascript';
  if (['ts', 'tsx'].includes(extension)) return 'typescript';
  if (['html', 'htm', 'svg', 'xml'].includes(extension)) return 'markup';
  if (['css', 'scss', 'sass', 'less'].includes(extension)) return 'css';
  if (extension === 'json') return 'json';
  return 'plain';
}

export function fileKey(file: FileObject) {
  return file.id || `${file.mount}:${file.path}`;
}
