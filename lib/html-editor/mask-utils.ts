import type {
  MaskComposite,
  MaskLayerDesign,
  MaskMode,
  MaskStop,
  MaskType,
} from '@/types';

const DEFAULT_STOPS: ReadonlyArray<Pick<MaskStop, 'position' | 'alpha'>> = [
  { position: 0, alpha: 0 },
  { position: 100, alpha: 100 },
];

const STANDARD_TO_WEBKIT_COMPOSITE: Record<MaskComposite, string> = {
  add: 'source-over',
  subtract: 'source-out',
  intersect: 'source-in',
  exclude: 'xor',
};

const WEBKIT_TO_STANDARD_COMPOSITE: Record<string, MaskComposite> = {
  'source-over': 'add',
  'source-out': 'subtract',
  'source-in': 'intersect',
  xor: 'exclude',
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const round = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

/** Split a CSS comma-list without breaking functions, quoted URLs or escapes. */
export function splitCssTopLevelList(source: string): string[] {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      const value = source.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function listValue(values: string[], index: number, fallback: string) {
  if (!values.length) return fallback;
  return values[index % values.length]?.trim() || fallback;
}

function stopId(layerIndex: number, stopIndex: number) {
  return `mask-${layerIndex}-stop-${stopIndex}`;
}

function defaultStops(layerIndex: number, invert = false): MaskStop[] {
  return DEFAULT_STOPS.map((stop, stopIndex) => ({
    id: stopId(layerIndex, stopIndex),
    position: stop.position,
    alpha: invert ? 100 - stop.alpha : stop.alpha,
  }));
}

export function createDefaultMaskLayer(
  index = 0,
  type: MaskType = 'linear',
): MaskLayerDesign {
  return {
    id: `mask-${index}`,
    type,
    stops: defaultStops(index, type === 'radial'),
    angle: 180,
    centerX: 50,
    centerY: 50,
    shape: 'circle',
    image: '',
    mode: type === 'image' ? 'match-source' : 'alpha',
    size: type === 'image' ? 'cover' : '100% 100%',
    position: '50% 50%',
    repeat: 'no-repeat',
    origin: 'border-box',
    clip: 'border-box',
    composite: 'add',
  };
}

function alphaFromColor(color: string) {
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return 0;

  const modernAlpha = normalized.match(/\/\s*(-?\d*\.?\d+)\s*(%)?\s*\)/);
  if (modernAlpha) {
    const value = Number.parseFloat(modernAlpha[1]);
    return clamp(modernAlpha[2] ? value : value * 100);
  }

  const functionMatch = normalized.match(/^(?:rgba|hsla)\((.*)\)$/);
  if (functionMatch) {
    const parts = splitCssTopLevelList(functionMatch[1]);
    if (parts.length >= 4) {
      const raw = parts[3];
      const value = Number.parseFloat(raw);
      return clamp(raw.includes('%') ? value : value * 100);
    }
  }

  const hex = normalized.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/)?.[1];
  if (hex) {
    const alphaHex = hex.length === 4 ? hex[3] + hex[3] : hex.slice(6, 8);
    return clamp((Number.parseInt(alphaHex, 16) / 255) * 100);
  }
  return 100;
}

function parseStop(value: string, layerIndex: number, stopIndex: number): MaskStop {
  const positionMatch = value.match(/\s(-?\d*\.?\d+)%\s*$/);
  const color = positionMatch ? value.slice(0, positionMatch.index).trim() : value.trim();
  return {
    id: stopId(layerIndex, stopIndex),
    position: positionMatch ? clamp(Number.parseFloat(positionMatch[1])) : Number.NaN,
    alpha: round(alphaFromColor(color)),
  };
}

function normalizeStopPositions(stops: MaskStop[]) {
  if (!stops.length) return stops;
  const normalized = stops.map(stop => ({ ...stop }));
  if (!Number.isFinite(normalized[0].position)) normalized[0].position = 0;
  if (!Number.isFinite(normalized[normalized.length - 1].position)) {
    normalized[normalized.length - 1].position = 100;
  }
  let index = 1;
  while (index < normalized.length - 1) {
    if (Number.isFinite(normalized[index].position)) {
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < normalized.length && !Number.isFinite(normalized[index].position)) index += 1;
    const runEnd = index - 1;
    const start = normalized[runStart - 1].position;
    const end = normalized[index]?.position ?? 100;
    const count = runEnd - runStart + 1;
    for (let offset = 0; offset < count; offset += 1) {
      normalized[runStart + offset].position = round(
        start + ((end - start) * (offset + 1)) / (count + 1),
      );
    }
  }
  return normalized;
}

function directionToAngle(value: string) {
  const normalized = value.trim().toLowerCase();
  const numeric = Number.parseFloat(normalized);
  if (normalized.endsWith('turn')) return round(numeric * 360);
  if (normalized.endsWith('rad')) return round((numeric * 180) / Math.PI);
  if (normalized.endsWith('grad')) return round(numeric * 0.9);
  if (normalized.endsWith('deg')) return round(numeric);
  const directionMap: Record<string, number> = {
    'to top': 0,
    'to top right': 45,
    'to right top': 45,
    'to right': 90,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom': 180,
    'to bottom left': 225,
    'to left bottom': 225,
    'to left': 270,
    'to top left': 315,
    'to left top': 315,
  };
  return directionMap[normalized] ?? 180;
}

function parseCenter(source: string) {
  const match = source.match(/\bat\s+(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%/i);
  return match
    ? { x: clamp(Number.parseFloat(match[1])), y: clamp(Number.parseFloat(match[2])) }
    : { x: 50, y: 50 };
}

function parseGradient(source: string, index: number): Partial<MaskLayerDesign> | null {
  const match = source.match(/^((?:repeating-)?(?:linear|radial|conic))-gradient\((.*)\)$/i);
  if (!match) return null;
  const type = match[1].replace('repeating-', '') as Exclude<MaskType, 'image'>;
  const args = splitCssTopLevelList(match[2]);
  let prelude = '';
  if (type === 'linear' && args[0] && /^(?:to\s|[-+]?\d*\.?\d+(?:deg|grad|rad|turn))/i.test(args[0])) {
    prelude = args.shift() || '';
  } else if (
    type === 'radial' &&
    args[0] &&
    /(?:circle|ellipse|closest|farthest|\bat\b)/i.test(args[0])
  ) {
    prelude = args.shift() || '';
  } else if (type === 'conic' && args[0] && /(?:\bfrom\b|\bat\b)/i.test(args[0])) {
    prelude = args.shift() || '';
  }
  let stops = normalizeStopPositions(args.map((value, stopIndex) => parseStop(value, index, stopIndex)));
  if (stops.length < 2) stops = defaultStops(index, type === 'radial');
  const center = parseCenter(prelude);
  const angleSource =
    type === 'conic' ? prelude.match(/\bfrom\s+([^\s]+)/i)?.[1] || '0deg' : prelude;
  return {
    type,
    stops,
    angle: type === 'radial' ? 0 : directionToAngle(angleSource || (type === 'conic' ? '0deg' : '180deg')),
    centerX: center.x,
    centerY: center.y,
    shape: /ellipse/i.test(prelude) ? 'ellipse' : 'circle',
    mode: 'alpha',
  };
}

function normalizeComposite(value: string): MaskComposite {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'subtract' || normalized === 'intersect' || normalized === 'exclude') {
    return normalized;
  }
  return WEBKIT_TO_STANDARD_COMPOSITE[normalized] || 'add';
}

function normalizeMode(value: string): MaskMode {
  return value === 'alpha' || value === 'luminance' ? value : 'match-source';
}

export function parseMaskLayers(values: Record<string, string>): MaskLayerDesign[] {
  const imageSource = values['mask-image'] || values['-webkit-mask-image'] || '';
  const images = splitCssTopLevelList(imageSource).filter(value => value && value !== 'none');
  if (!images.length) return [];

  const modes = splitCssTopLevelList(values['mask-mode'] || values['-webkit-mask-source-type'] || '');
  const sizes = splitCssTopLevelList(values['mask-size'] || values['-webkit-mask-size'] || '');
  const positions = splitCssTopLevelList(values['mask-position'] || values['-webkit-mask-position'] || '');
  const repeats = splitCssTopLevelList(values['mask-repeat'] || values['-webkit-mask-repeat'] || '');
  const origins = splitCssTopLevelList(values['mask-origin'] || values['-webkit-mask-origin'] || '');
  const clips = splitCssTopLevelList(values['mask-clip'] || values['-webkit-mask-clip'] || '');
  const composites = splitCssTopLevelList(values['mask-composite'] || values['-webkit-mask-composite'] || '');

  return images.map((image, index) => {
    const gradient = parseGradient(image, index);
    const type: MaskType = gradient?.type || 'image';
    return {
      ...createDefaultMaskLayer(index, type),
      ...gradient,
      id: `mask-${index}`,
      image: type === 'image' ? image : '',
      mode: normalizeMode(listValue(modes, index, type === 'image' ? 'match-source' : 'alpha')),
      size: listValue(sizes, index, type === 'image' ? 'cover' : '100% 100%'),
      position: listValue(positions, index, '50% 50%'),
      repeat: listValue(repeats, index, 'no-repeat'),
      origin: listValue(origins, index, 'border-box'),
      clip: listValue(clips, index, 'border-box'),
      composite: normalizeComposite(listValue(composites, index, 'add')),
    };
  });
}

function alphaColor(alpha: number) {
  const value = round(clamp(alpha) / 100, 3);
  return `rgb(0 0 0 / ${value})`;
}

function serializeStops(stops: MaskStop[]) {
  const normalized = stops.length >= 2 ? stops : defaultStops(0);
  return [...normalized]
    .sort((left, right) => left.position - right.position)
    .map(stop => `${alphaColor(stop.alpha)} ${round(clamp(stop.position))}%`)
    .join(', ');
}

function serializeImage(layer: MaskLayerDesign) {
  const stops = serializeStops(layer.stops);
  if (layer.type === 'linear') return `linear-gradient(${round(layer.angle)}deg, ${stops})`;
  if (layer.type === 'radial') {
    return `radial-gradient(${layer.shape} at ${round(layer.centerX)}% ${round(layer.centerY)}%, ${stops})`;
  }
  if (layer.type === 'conic') {
    return `conic-gradient(from ${round(layer.angle)}deg at ${round(layer.centerX)}% ${round(layer.centerY)}%, ${stops})`;
  }
  const source = layer.image.trim();
  // Keep the element visible while the user is still choosing an image.
  if (!source) return 'linear-gradient(rgb(0 0 0 / 1), rgb(0 0 0 / 1))';
  // CSS keywords and variable bindings remain CSS values. Treating them as
  // asset paths triggers bogus thumbnail requests and corrupts mask edits.
  if (/^(?:none|initial|inherit|unset|revert(?:-layer)?)$/i.test(source)) return source;
  if (/^(?:url|image|(?:-webkit-)?image-set|cross-fade|element|var)\(/i.test(source)) return source;
  return `url(${JSON.stringify(source)})`;
}

export function serializeMaskLayers(layers: MaskLayerDesign[]): Record<string, string> {
  const properties = [
    'mask-image', 'mask-mode', 'mask-size', 'mask-position', 'mask-repeat',
    'mask-origin', 'mask-clip', 'mask-composite', '-webkit-mask-image',
    '-webkit-mask-size', '-webkit-mask-position', '-webkit-mask-repeat',
    '-webkit-mask-origin', '-webkit-mask-clip', '-webkit-mask-composite',
    '-webkit-mask-source-type',
  ] as const;
  if (!layers.length) return Object.fromEntries(properties.map(property => [property, '']));

  const images = layers.map(serializeImage);
  const modes = layers.map(layer => layer.type === 'image' ? layer.mode : 'alpha');
  const sizes = layers.map(layer => layer.size || (layer.type === 'image' ? 'cover' : '100% 100%'));
  const positions = layers.map(layer => layer.position || '50% 50%');
  const repeats = layers.map(layer => layer.repeat || 'no-repeat');
  const origins = layers.map(layer => layer.origin || 'border-box');
  const clips = layers.map(layer => layer.clip || 'border-box');
  const composites = layers.map((layer, index) => index === layers.length - 1 ? 'add' : layer.composite || 'add');
  const webkitComposites = composites.map(composite => STANDARD_TO_WEBKIT_COMPOSITE[composite]);

  return {
    '-webkit-mask-image': images.join(', '),
    '-webkit-mask-size': sizes.join(', '),
    '-webkit-mask-position': positions.join(', '),
    '-webkit-mask-repeat': repeats.join(', '),
    '-webkit-mask-origin': origins.join(', '),
    '-webkit-mask-clip': clips.join(', '),
    '-webkit-mask-composite': webkitComposites.join(', '),
    '-webkit-mask-source-type': modes.join(', '),
    'mask-image': images.join(', '),
    'mask-mode': modes.join(', '),
    'mask-size': sizes.join(', '),
    'mask-position': positions.join(', '),
    'mask-repeat': repeats.join(', '),
    'mask-origin': origins.join(', '),
    'mask-clip': clips.join(', '),
    'mask-composite': composites.join(', '),
  };
}

export function maskPreviewBackground(layer: MaskLayerDesign) {
  return serializeImage(layer);
}
