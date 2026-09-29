import assert from 'node:assert/strict';
import sharp from 'sharp';

const MINIMUM_FRAME_COUNT = 2;
const MAXIMUM_FRAME_COUNT = 4_096;
const MAXIMUM_FRAME_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TOTAL_FRAME_BYTES = 256 * 1024 * 1024;
const MAXIMUM_DURATION_SECONDS = 120;
const MAXIMUM_DIMENSION = 4_096;
const MAXIMUM_PIXELS = 8_388_608;
const COMPARISON_DIMENSION = 128;
const MAXIMUM_BASE64_CHARACTERS = Math.ceil(MAXIMUM_FRAME_BYTES / 3) * 4;
const SUPPORTED_FORMATS = new Set(['jpeg', 'png']);
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function validationError(message) {
  return new Error(`Speed Index inválido: ${message}`);
}

function decodedBase64Bytes(encoded) {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function validateFrameEnvelopes(frames) {
  if (!Array.isArray(frames)) {
    throw validationError('frames deve ser um array.');
  }
  if (frames.length < MINIMUM_FRAME_COUNT || frames.length > MAXIMUM_FRAME_COUNT) {
    throw validationError(
      `frames deve conter entre ${MINIMUM_FRAME_COUNT} e ${MAXIMUM_FRAME_COUNT} itens.`,
    );
  }

  let previousTimestamp = null;
  let totalFrameBytes = 0;
  for (const [index, frame] of frames.entries()) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw validationError(`frame ${index} deve ser um objeto.`);
    }
    const { timestampSeconds, data } = frame;
    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      throw validationError(`frame ${index} possui timestampSeconds inválido.`);
    }
    if (previousTimestamp !== null && timestampSeconds <= previousTimestamp) {
      throw validationError('timestampSeconds deve ser estritamente crescente.');
    }
    previousTimestamp = timestampSeconds;

    if (
      typeof data !== 'string'
      || data.length === 0
      || data.length > MAXIMUM_BASE64_CHARACTERS
      || !CANONICAL_BASE64.test(data)
    ) {
      throw validationError(`frame ${index} não contém base64 canônico.`);
    }
    const frameBytes = decodedBase64Bytes(data);
    if (!Number.isSafeInteger(frameBytes) || frameBytes <= 0 || frameBytes > MAXIMUM_FRAME_BYTES) {
      throw validationError(
        `frame ${index} excede o limite de ${MAXIMUM_FRAME_BYTES} bytes.`,
      );
    }
    totalFrameBytes += frameBytes;
    if (totalFrameBytes > MAXIMUM_TOTAL_FRAME_BYTES) {
      throw validationError(
        `frames excedem o limite total de ${MAXIMUM_TOTAL_FRAME_BYTES} bytes.`,
      );
    }
  }

  const durationSeconds = frames.at(-1).timestampSeconds - frames[0].timestampSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds > MAXIMUM_DURATION_SECONDS) {
    throw validationError(
      `duração deve ser no máximo ${MAXIMUM_DURATION_SECONDS} segundos.`,
    );
  }
}

async function decodeComparableFrame(frame, index) {
  const input = Buffer.from(frame.data, 'base64');
  if (input.toString('base64') !== frame.data) {
    throw validationError(`frame ${index} não contém base64 canônico.`);
  }

  const image = sharp(input, {
    failOn: 'error',
    limitInputPixels: MAXIMUM_PIXELS,
    sequentialRead: true,
  });
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    throw validationError(`frame ${index} não é uma imagem JPEG/PNG válida.`);
  }

  if (!SUPPORTED_FORMATS.has(metadata.format)) {
    throw validationError(`frame ${index} deve usar JPEG ou PNG.`);
  }
  if (
    !Number.isSafeInteger(metadata.width)
    || !Number.isSafeInteger(metadata.height)
    || metadata.width <= 0
    || metadata.height <= 0
    || metadata.width > MAXIMUM_DIMENSION
    || metadata.height > MAXIMUM_DIMENSION
    || metadata.width * metadata.height > MAXIMUM_PIXELS
  ) {
    throw validationError(`frame ${index} possui dimensões inválidas.`);
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw validationError(`frame ${index} deve conter exatamente uma imagem.`);
  }
  if (metadata.orientation && metadata.orientation !== 1) {
    throw validationError(`frame ${index} não pode depender de orientação EXIF.`);
  }

  let comparable;
  try {
    comparable = await image
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace('srgb')
      .removeAlpha()
      .resize({
        width: COMPARISON_DIMENSION,
        height: COMPARISON_DIMENSION,
        fit: 'inside',
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw validationError(`frame ${index} não pôde ser decodificado com segurança.`);
  }

  if (
    comparable.info.channels !== 3
    || comparable.data.length
      !== comparable.info.width * comparable.info.height * comparable.info.channels
  ) {
    throw validationError(`frame ${index} não pôde ser normalizado para RGB.`);
  }
  return {
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    width: comparable.info.width,
    height: comparable.info.height,
    pixels: comparable.data,
  };
}

function visualDifference(frame, finalFrame, index) {
  if (
    frame.originalWidth !== finalFrame.originalWidth
    || frame.originalHeight !== finalFrame.originalHeight
    || frame.width !== finalFrame.width
    || frame.height !== finalFrame.height
    || frame.pixels.length !== finalFrame.pixels.length
  ) {
    throw validationError(`frame ${index} possui dimensão diferente do frame final.`);
  }

  let difference = 0;
  for (let offset = 0; offset < frame.pixels.length; offset += 1) {
    difference += Math.abs(frame.pixels[offset] - finalFrame.pixels[offset]);
  }
  return difference / (frame.pixels.length * 255);
}

/**
 * Calculates visual Speed Index in milliseconds. Timestamps are treated as a
 * monotonic clock and normalized to the first captured frame. Every image is
 * decoded and compared in memory; raw or encoded frame data is never persisted
 * or included in diagnostics.
 */
export async function calculateSpeedIndex(frames) {
  validateFrameEnvelopes(frames);

  const finalIndex = frames.length - 1;
  const finalFrame = await decodeComparableFrame(frames[finalIndex], finalIndex);
  const differences = [];
  for (let index = 0; index < finalIndex; index += 1) {
    const frame = await decodeComparableFrame(frames[index], index);
    differences.push(visualDifference(frame, finalFrame, index));
  }
  differences.push(0);

  const maximumDifference = Math.max(...differences);
  if (!Number.isFinite(maximumDifference) || maximumDifference < 0) {
    throw validationError('diferença visual não finita.');
  }
  if (maximumDifference === 0) return 0;

  let speedIndexMs = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const intervalMs = (
      frames[index].timestampSeconds - frames[index - 1].timestampSeconds
    ) * 1_000;
    const visualIncompleteness = Math.min(1, Math.max(
      0,
      differences[index - 1] / maximumDifference,
    ));
    speedIndexMs += intervalMs * visualIncompleteness;
  }

  if (!Number.isFinite(speedIndexMs) || speedIndexMs < 0) {
    throw validationError('resultado não finito.');
  }
  return speedIndexMs;
}

async function syntheticFrame(width, height, value, format = 'png') {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: value, g: value, b: value },
    },
  });
  const encoded = format === 'jpeg'
    ? await image.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
    : await image.png().toBuffer();
  return encoded.toString('base64');
}

export async function runSpeedIndexSelfTest() {
  const [
    white,
    gray,
    black,
    blackJpeg,
    wrongDimension,
    oversizedDimension,
    unsupported,
  ] = await Promise.all([
    syntheticFrame(2, 2, 255),
    syntheticFrame(2, 2, 128),
    syntheticFrame(2, 2, 0),
    syntheticFrame(2, 2, 0, 'jpeg'),
    syntheticFrame(3, 2, 0),
    syntheticFrame(MAXIMUM_DIMENSION + 1, 1, 0),
    sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).webp().toBuffer().then(buffer => buffer.toString('base64')),
  ]);

  const speedIndexMs = await calculateSpeedIndex([
    { timestampSeconds: 10, data: white },
    { timestampSeconds: 11, data: gray },
    { timestampSeconds: 12, data: black },
  ]);
  const expectedSpeedIndexMs = (1 + 128 / 255) * 1_000;
  assert.ok(
    Math.abs(speedIndexMs - expectedSpeedIndexMs) < 0.001,
    'Sequência branco→cinza→preto deve integrar a incompletude visual.',
  );
  assert.ok(Number.isFinite(speedIndexMs), 'Speed Index deve ser finito.');

  const jpegSpeedIndexMs = await calculateSpeedIndex([
    { timestampSeconds: 0, data: white },
    { timestampSeconds: 1, data: blackJpeg },
  ]);
  assert.equal(jpegSpeedIndexMs, 1_000, 'Frames JPEG devem ser aceitos.');

  await assert.rejects(
    calculateSpeedIndex([
      { timestampSeconds: Number.NaN, data: white },
      { timestampSeconds: 1, data: black },
    ]),
    /timestampSeconds inválido/,
  );
  await assert.rejects(
    calculateSpeedIndex([
      { timestampSeconds: 1, data: white },
      { timestampSeconds: 1, data: black },
    ]),
    /estritamente crescente/,
  );
  await assert.rejects(
    calculateSpeedIndex([
      { timestampSeconds: 0, data: white },
      { timestampSeconds: 1, data: wrongDimension },
    ]),
    /dimensão diferente do frame final/,
  );
  await assert.rejects(
    calculateSpeedIndex([
      { timestampSeconds: 0, data: white },
      { timestampSeconds: 1, data: oversizedDimension },
    ]),
    /dimensões inválidas/,
  );
  await assert.rejects(
    calculateSpeedIndex([
      { timestampSeconds: 0, data: white },
      { timestampSeconds: 1, data: unsupported },
    ]),
    /deve usar JPEG ou PNG/,
  );

  return Object.freeze({ checks: 8, speedIndexMs });
}
