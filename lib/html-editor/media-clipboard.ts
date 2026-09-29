'use client';

export type ClipboardImageReadErrorCode =
  | 'unsupported'
  | 'denied'
  | 'empty'
  | 'unreadable';

export class ClipboardImageReadError extends Error {
  readonly code: ClipboardImageReadErrorCode;

  constructor(code: ClipboardImageReadErrorCode, cause?: unknown) {
    super(`clipboard_image_${code}`, cause === undefined ? undefined : { cause });
    this.name = 'ClipboardImageReadError';
    this.code = code;
  }
}

export interface ClipboardImageItem {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
}

export interface ClipboardImageReader {
  read(): Promise<readonly ClipboardImageItem[]>;
}

interface ReadClipboardImageOptions {
  clipboard?: ClipboardImageReader | null;
  now?: () => number;
  createFile?: (
    parts: BlobPart[],
    name: string,
    options: FilePropertyBag,
  ) => File;
}

const IMAGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function imageExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  const known = IMAGE_EXTENSION_BY_MIME[normalized];
  if (known) return known;
  const subtype = normalized.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/g, '');
  return subtype || 'png';
}

function clipboardImageName(mimeType: string, timestamp: number): string {
  const date = new Date(timestamp);
  const stableTimestamp = Number.isFinite(date.getTime())
    ? date.toISOString().replace(/[:.]/g, '-')
    : String(timestamp);
  return `clipboard-image-${stableTimestamp}.${imageExtension(mimeType)}`;
}

function deniedClipboardRead(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'NotAllowedError' || name === 'SecurityError';
}

export async function readClipboardImageFile(
  options: ReadClipboardImageOptions = {},
): Promise<File> {
  const clipboard = options.clipboard === undefined
    ? (typeof navigator !== 'undefined' ? navigator.clipboard : null)
    : options.clipboard;
  if (!clipboard || typeof clipboard.read !== 'function') {
    throw new ClipboardImageReadError('unsupported');
  }

  let items: readonly ClipboardImageItem[];
  try {
    items = await clipboard.read();
  } catch (error) {
    throw new ClipboardImageReadError(deniedClipboardRead(error) ? 'denied' : 'unreadable', error);
  }

  let unreadableImage: unknown;
  for (const item of items) {
    const mimeType = item.types.find(type => type.toLowerCase().startsWith('image/'));
    if (!mimeType) continue;
    try {
      const blob = await item.getType(mimeType);
      const type = blob.type || mimeType;
      const now = (options.now || Date.now)();
      const createFile = options.createFile
        || ((parts: BlobPart[], name: string, fileOptions: FilePropertyBag) => new File(parts, name, fileOptions));
      return createFile([blob], clipboardImageName(type, now), {
        type,
        lastModified: now,
      });
    } catch (error) {
      unreadableImage = error;
    }
  }

  if (unreadableImage !== undefined) {
    throw new ClipboardImageReadError('unreadable', unreadableImage);
  }
  throw new ClipboardImageReadError('empty');
}
