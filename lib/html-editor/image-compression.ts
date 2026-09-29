import type { HtmlProjectFile } from './types';

export interface ImageCompressionOptions {
  /** Visual quality retained by lossy encoders, from 1 to 100. */
  quality: number;
  /** Optional maximum width or height. Images are never enlarged. */
  maxDimension: number | null;
}

export type ImageCompressionSkipReason =
  | 'animated-image'
  | 'empty-file'
  | 'not-smaller'
  | 'unsupported-format';

export interface ImageCompressionResult {
  path: string;
  status: 'compressed' | 'failed' | 'skipped';
  originalBytes: number;
  compressedBytes: number;
  originalWidth?: number;
  originalHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  output?: Blob;
  reason?: ImageCompressionSkipReason;
  message?: string;
}

export interface ImageCompressionSummary {
  total: number;
  compressed: number;
  skipped: number;
  failed: number;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
}

export type ImageConversionFormat = 'avif' | 'webp';

export interface ImageConversionOptions extends ImageCompressionOptions {
  format: ImageConversionFormat;
}

export interface ImageConversionResult {
  path: string;
  status: 'converted' | 'failed' | 'protected' | 'unchanged';
  originalBytes: number;
  convertedBytes: number;
  originalWidth?: number;
  originalHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  output?: Blob;
  message?: string;
}

export interface ImageConversionSummary {
  total: number;
  converted: number;
  unchanged: number;
  protected: number;
  originalBytes: number;
  convertedBytes: number;
  savedBytes: number;
}

const COMPRESSION_MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const CONVERSION_MIME_BY_EXTENSION: Record<string, string> = {
  ...COMPRESSION_MIME_BY_EXTENSION,
  avif: 'image/avif',
};

export const IMAGE_CONVERSION_MIME_TYPES: Record<ImageConversionFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
};

let avifEncoderModulePromise:
  | Promise<import('@jsquash/avif/codec/enc/avif_enc.js').AVIFModule>
  | null = null;

function canonicalImageMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

export function projectImageCompressionMimeType(file: HtmlProjectFile) {
  const declared = canonicalImageMimeType(file.mimeType || '');
  if (Object.values(COMPRESSION_MIME_BY_EXTENSION).includes(declared)) return declared;
  // A declared image MIME type is stronger evidence than the extension. Do
  // not decode an animated/unsupported image with the wrong decoder merely
  // because an imported filename carries a familiar suffix.
  if (declared.startsWith('image/')) return null;
  const extension = file.path.split('.').pop()?.toLowerCase() || '';
  return COMPRESSION_MIME_BY_EXTENSION[extension] || null;
}

export function projectImageConversionMimeType(file: HtmlProjectFile) {
  const declared = canonicalImageMimeType(file.mimeType || '');
  if (Object.values(CONVERSION_MIME_BY_EXTENSION).includes(declared)) return declared;
  if (declared.startsWith('image/')) return null;
  const extension = file.path.split('.').pop()?.toLowerCase() || '';
  return CONVERSION_MIME_BY_EXTENSION[extension] || null;
}

export function projectImageByteLength(file: HtmlProjectFile) {
  if (file.data) return file.data.byteLength;
  if (file.text !== undefined) return new TextEncoder().encode(file.text).byteLength;
  return 0;
}

export function isCompressibleProjectImage(file: HtmlProjectFile) {
  return Boolean(projectImageCompressionMimeType(file) && file.data?.byteLength);
}

export function isConvertibleProjectImage(file: HtmlProjectFile) {
  return Boolean(projectImageConversionMimeType(file) && file.data?.byteLength);
}

export function convertedProjectImagePath(
  path: string,
  format: ImageConversionFormat,
) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? `${path.slice(0, dot)}.${format}` : `${path}.${format}`;
}

const CONVERTIBLE_IMAGE_EXTENSIONS = [
  'avif',
  'jpeg',
  'jfif',
  'jpg',
  'png',
  'webp',
] as const;

/**
 * Returns same-stem image paths that no longer exist and may therefore be
 * repaired to an existing converted target. A real file is never treated as a
 * dangling reference, including on case-insensitive filesystems.
 */
export function missingProjectImageSiblingPaths(
  files: Record<string, HtmlProjectFile>,
  targetPath: string,
) {
  const occupied = new Set(Object.keys(files).map(path => path.toLowerCase()));
  const slash = targetPath.lastIndexOf('/');
  const dot = targetPath.lastIndexOf('.');
  const stem = dot > slash ? targetPath.slice(0, dot) : targetPath;
  return CONVERTIBLE_IMAGE_EXTENSIONS
    .map(extension => `${stem}.${extension}`)
    .filter(path => (
      path.toLowerCase() !== targetPath.toLowerCase()
      && !occupied.has(path.toLowerCase())
    ));
}

/**
 * Changes only the final image extension when the filename stem matches one of
 * the converted assets. This deliberately does not depend on the old folder or
 * serialization shape: `./hero.png`, `..\/assets\/hero.jpg` and an element
 * snapshot containing `hero.webp` all follow `hero.avif` after a mass convert.
 */
export function rewriteImageExtensionsByBasename(
  source: string,
  targetPaths: string[],
  format: ImageConversionFormat,
) {
  const targetStems = new Set<string>();
  targetPaths.forEach(path => {
    const filename = path.replaceAll('\\', '/').split('/').pop() || '';
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    if (!stem) return;
    targetStems.add(stem.toLowerCase());
    targetStems.add(encodeURI(stem).toLowerCase());
  });
  if (!targetStems.size) return source;

  return source.replace(
    /([^/\\?#"'`<>{}\[\],;:=\s]+)\.(avif|jpeg|jfif|jpg|png|webp)(?=$|[?#\s"'`(){}\[\],;:=>\\/])/giu,
    (match, basename: string, _extension: string, offset: number) => {
      const normalized = basename.toLowerCase();
      let decoded = normalized;
      try {
        decoded = decodeURIComponent(basename).toLowerCase();
      } catch {
        // A literal percent sign is a valid filename character.
      }
      if (!targetStems.has(normalized) && !targetStems.has(decoded)) return match;

      // A local asset must never mutate an unrelated absolute CDN URL that
      // happens to use the same filename.
      const externalUrlPrefix =
        /(?:[a-z][a-z\d+.-]*:)?\/\/[^\s"'`()<>]*\/$/i.test(
          source
            .slice(Math.max(0, offset - 2048), offset)
            .replaceAll('\\/', '/'),
        );
      return externalUrlPrefix ? match : `${basename}.${format}`;
    },
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  let value = '';
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function uint32LittleEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000
  );
}

/**
 * Canvas re-encoding would flatten APNG and animated WebP files to one frame.
 * Detect those containers before decoding so animation is never destroyed.
 */
export function isAnimatedProjectImage(file: HtmlProjectFile) {
  const bytes = file.data;
  const mimeType = projectImageConversionMimeType(file);
  if (!bytes || !mimeType) return false;

  if (mimeType === 'image/png') {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < pngSignature.length
      || pngSignature.some((value, index) => bytes[index] !== value)
    ) return false;
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = uint32BigEndian(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      offset += 12 + length;
    }
    return false;
  }

  if (mimeType === 'image/webp') {
    if (
      bytes.length < 12
      || ascii(bytes, 0, 4) !== 'RIFF'
      || ascii(bytes, 8, 4) !== 'WEBP'
    ) return false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const length = uint32LittleEndian(bytes, offset + 4);
      if (type === 'ANIM' || type === 'ANMF') return true;
      offset += 8 + length + (length % 2);
    }
  }

  if (mimeType === 'image/avif') {
    // AVIF image sequences use the `avis` brand. A still AVIF uses `avif`.
    return ascii(bytes, 0, Math.min(bytes.length, 256)).includes('avis');
  }

  return false;
}

export function imageCompressionTargetSize(
  width: number,
  height: number,
  maxDimension: number | null,
) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const limit = maxDimension === null
    ? null
    : Math.max(1, Math.round(maxDimension));
  if (limit === null || Math.max(safeWidth, safeHeight) <= limit) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = limit / Math.max(safeWidth, safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function fileBytesBlob(file: HtmlProjectFile, mimeType: string) {
  if (!file.data?.byteLength) return null;
  // Copy the bytes so a mutable project buffer can never be retained by Blob.
  const bytes = new Uint8Array(file.data.byteLength);
  bytes.set(file.data);
  return new Blob([bytes.buffer], { type: mimeType });
}

async function decodeImage(blob: Blob, mimeType: string) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // AVIF decoding falls back to the same WASM codec used for encoding.
    }
  }

  if (mimeType === 'image/avif') {
    const { default: decodeAvif } = await import('@jsquash/avif/decode.js');
    const imageData = await decodeAvif(await blob.arrayBuffer());
    if (!imageData) {
      throw new Error('O codificador não conseguiu ler a imagem AVIF.');
    }
    const decodedCanvas = document.createElement('canvas');
    decodedCanvas.width = imageData.width;
    decodedCanvas.height = imageData.height;
    const decodedContext = decodedCanvas.getContext('2d');
    if (!decodedContext || !(imageData.data instanceof Uint8ClampedArray)) {
      throw new Error('O navegador não conseguiu decodificar a imagem AVIF.');
    }
    decodedContext.putImageData(imageData, 0, 0);
    return {
      source: decodedCanvas as CanvasImageSource,
      width: imageData.width,
      height: imageData.height,
      close: () => {
        decodedCanvas.width = 1;
        decodedCanvas.height = 1;
      },
    };
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

/**
 * Browser encoders do not interpret a quality value consistently. In
 * particular, re-encoding an image that was already saved around the requested
 * quality can produce a larger file. Treat the slider as the maximum quality
 * and retry lossy formats in small steps, stopping at the first result that is
 * actually smaller. PNG remains a single, lossless pass because its canvas
 * encoder ignores the quality argument.
 */
export function imageCompressionQualityCandidates(
  quality: number,
  mimeType: string,
) {
  const requested = Number.isFinite(quality) ? Math.round(quality) : 82;
  const maximum = Math.min(100, Math.max(1, requested));
  if (mimeType === 'image/png') return [1];

  const minimum = maximum <= 40 ? maximum : Math.max(40, maximum - 24);
  const candidates: number[] = [];
  for (let candidate = maximum; candidate >= minimum; candidate -= 8) {
    candidates.push(candidate / 100);
  }
  if (candidates.at(-1) !== minimum / 100) candidates.push(minimum / 100);
  return candidates;
}

async function compressedCanvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
  originalBytes: number,
) {
  let lastOutput: Blob | null = null;
  for (const candidate of imageCompressionQualityCandidates(quality, mimeType)) {
    const output = await canvasToBlob(canvas, mimeType, candidate);
    if (!output) continue;
    lastOutput = output;
    if (canonicalImageMimeType(output.type) !== mimeType) return output;
    if (output.size < originalBytes) return output;
  }
  return lastOutput;
}

async function encodeCanvas(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  format: ImageConversionFormat,
  quality: number,
) {
  const normalizedQuality = Math.min(100, Math.max(1, Math.round(quality)));
  if (format === 'webp') {
    const output = await canvasToBlob(
      canvas,
      IMAGE_CONVERSION_MIME_TYPES.webp,
      normalizedQuality / 100,
    );
    if (!output || canonicalImageMimeType(output.type) !== IMAGE_CONVERSION_MIME_TYPES.webp) {
      throw new Error('Este navegador não disponibilizou o codificador WebP.');
    }
    return output;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  if (!avifEncoderModulePromise) {
    avifEncoderModulePromise = Promise.all([
      import('@jsquash/avif/codec/enc/avif_enc.js'),
      import('@jsquash/avif/utils.js'),
    ]).then(([codec, utils]) => utils.initEmscriptenModule(codec.default));
  }
  const encoder = await avifEncoderModulePromise;
  const bytes = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  const encoded = encoder.encode(bytes, imageData.width, imageData.height, {
    quality: normalizedQuality,
    qualityAlpha: normalizedQuality,
    bitDepth: 8,
    chromaDeltaQ: false,
    denoiseLevel: 0,
    enableSharpYUV: false,
    sharpness: 0,
    speed: 6,
    subsample: 1,
    tileColsLog2: 0,
    tileRowsLog2: 0,
    tune: 0,
  });
  if (!encoded) throw new Error('O codificador AVIF não gerou uma imagem.');
  const outputBytes = new Uint8Array(encoded.byteLength);
  outputBytes.set(encoded);
  const output = new Blob(
    [outputBytes.buffer],
    { type: IMAGE_CONVERSION_MIME_TYPES.avif },
  );
  const header = new Uint8Array(await output.slice(0, 32).arrayBuffer());
  const brands = ascii(header, 0, header.length);
  if (!brands.includes('ftyp') || !/(?:avif|avis|mif1)/.test(brands)) {
    throw new Error('O codificador AVIF retornou um arquivo inválido.');
  }
  return output;
}

/**
 * Re-encodes a project image in the browser while preserving its file path and
 * format. The caller decides when to replace the original project bytes.
 */
export async function compressProjectImage(
  file: HtmlProjectFile,
  options: ImageCompressionOptions,
): Promise<ImageCompressionResult> {
  const originalBytes = projectImageByteLength(file);
  const mimeType = projectImageCompressionMimeType(file);
  const skipped = (reason: ImageCompressionSkipReason): ImageCompressionResult => ({
    path: file.path,
    status: 'skipped',
    reason,
    originalBytes,
    compressedBytes: originalBytes,
  });

  if (!mimeType) return skipped('unsupported-format');
  if (!originalBytes || !file.data) return skipped('empty-file');
  if (isAnimatedProjectImage(file)) return skipped('animated-image');

  const input = fileBytesBlob(file, mimeType);
  if (!input) return skipped('empty-file');

  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    decoded = await decodeImage(input, mimeType);
    const target = imageCompressionTargetSize(
      decoded.width,
      decoded.height,
      options.maxDimension,
    );
    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', {
      alpha: mimeType !== 'image/jpeg',
    });
    if (!context) throw new Error('O navegador não disponibilizou o codificador de imagem.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, target.width, target.height);

    const output = await compressedCanvasBlob(
      canvas,
      mimeType,
      options.quality,
      originalBytes,
    );
    if (!output) throw new Error('O navegador não conseguiu gerar a imagem comprimida.');
    if (canonicalImageMimeType(output.type) !== mimeType) {
      return skipped('unsupported-format');
    }
    if (output.size >= originalBytes) {
      return {
        ...skipped('not-smaller'),
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        outputWidth: target.width,
        outputHeight: target.height,
      };
    }

    return {
      path: file.path,
      status: 'compressed',
      originalBytes,
      compressedBytes: output.size,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      outputWidth: target.width,
      outputHeight: target.height,
      output,
    };
  } catch (error) {
    return {
      path: file.path,
      status: 'failed',
      originalBytes,
      compressedBytes: originalBytes,
      message: error instanceof Error ? error.message : 'Não foi possível comprimir a imagem.',
    };
  } finally {
    decoded?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

/**
 * Converts one still project image to WebP or AVIF. Paths are intentionally
 * left to the caller so bytes and every authored reference can be committed as
 * one transaction.
 */
export async function convertProjectImage(
  file: HtmlProjectFile,
  options: ImageConversionOptions,
): Promise<ImageConversionResult> {
  const originalBytes = projectImageByteLength(file);
  const sourceMimeType = projectImageConversionMimeType(file);
  const targetMimeType = IMAGE_CONVERSION_MIME_TYPES[options.format];
  const baseResult = {
    path: file.path,
    originalBytes,
    convertedBytes: originalBytes,
  };

  if (!sourceMimeType || !file.data?.byteLength) {
    return {
      ...baseResult,
      status: 'failed',
      message: 'Formato de origem não compatível.',
    };
  }
  if (sourceMimeType === targetMimeType) {
    return { ...baseResult, status: 'unchanged' };
  }
  if (isAnimatedProjectImage(file)) {
    return {
      ...baseResult,
      status: 'protected',
      message: 'Imagem animada preservada no formato original.',
    };
  }

  const input = fileBytesBlob(file, sourceMimeType);
  if (!input) {
    return { ...baseResult, status: 'failed', message: 'Arquivo vazio.' };
  }

  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    decoded = await decodeImage(input, sourceMimeType);
    const target = imageCompressionTargetSize(
      decoded.width,
      decoded.height,
      options.maxDimension,
    );
    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('O navegador não disponibilizou o codificador de imagem.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, target.width, target.height);
    const output = await encodeCanvas(context, canvas, options.format, options.quality);
    return {
      path: file.path,
      status: 'converted',
      originalBytes,
      convertedBytes: output.size,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      outputWidth: target.width,
      outputHeight: target.height,
      output,
    };
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Não foi possível converter a imagem.',
    };
  } finally {
    decoded?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

export function summarizeImageCompressionResults(
  results: ImageCompressionResult[],
): ImageCompressionSummary {
  return results.reduce<ImageCompressionSummary>(
    (summary, result) => {
      summary.total += 1;
      summary.originalBytes += result.originalBytes;
      summary.compressedBytes += result.compressedBytes;
      if (result.status === 'compressed') summary.compressed += 1;
      else if (result.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;
      summary.savedBytes += Math.max(0, result.originalBytes - result.compressedBytes);
      return summary;
    },
    {
      total: 0,
      compressed: 0,
      skipped: 0,
      failed: 0,
      originalBytes: 0,
      compressedBytes: 0,
      savedBytes: 0,
    },
  );
}

export function summarizeImageConversionResults(
  results: ImageConversionResult[],
): ImageConversionSummary {
  return results.reduce<ImageConversionSummary>(
    (summary, result) => {
      summary.total += 1;
      summary.originalBytes += result.originalBytes;
      summary.convertedBytes += result.convertedBytes;
      if (result.status === 'converted') summary.converted += 1;
      else if (result.status === 'protected') summary.protected += 1;
      else if (result.status === 'unchanged') summary.unchanged += 1;
      summary.savedBytes += result.originalBytes - result.convertedBytes;
      return summary;
    },
    {
      total: 0,
      converted: 0,
      unchanged: 0,
      protected: 0,
      originalBytes: 0,
      convertedBytes: 0,
      savedBytes: 0,
    },
  );
}
