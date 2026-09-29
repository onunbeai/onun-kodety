type RgbaChannels = { r: number; g: number; b: number; a: number };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const byteHex = (value: number) =>
  Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0').toUpperCase();

const alphaHex = (value: number) => byteHex(clamp(value, 0, 1) * 255);

const channel = (value: string): number | null => {
  const input = value.trim();
  if (!input) return null;
  const percentage = input.endsWith('%');
  const numeric = Number.parseFloat(percentage ? input.slice(0, -1) : input);
  if (!Number.isFinite(numeric)) return null;
  return percentage ? (clamp(numeric, 0, 100) / 100) * 255 : clamp(numeric, 0, 255);
};

const alpha = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return 1;
  const input = value.trim();
  const percentage = input.endsWith('%');
  const numeric = Number.parseFloat(percentage ? input.slice(0, -1) : input);
  if (!Number.isFinite(numeric)) return null;
  return percentage ? clamp(numeric, 0, 100) / 100 : clamp(numeric, 0, 1);
};

const rgbaToDisplayHex = ({ r, g, b, a }: RgbaChannels) => {
  const base = `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
  return a >= 1 ? base : `${base}${alphaHex(a)}`;
};

/**
 * Formats a solid CSS color for Builder controls without changing the authored
 * value. Alpha is represented with standard eight-digit HEX (#RRGGBBAA).
 */
export function cssColorToHex(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  const opacitySuffix = input.match(/^#([0-9a-f]{6})\/(\d{1,3})$/i);
  if (opacitySuffix) {
    const opacity = clamp(Number.parseInt(opacitySuffix[2], 10), 0, 100) / 100;
    const base = `#${opacitySuffix[1].toUpperCase()}`;
    return opacity >= 1 ? base : `${base}${alphaHex(opacity)}`;
  }

  const hex = input.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const expanded = hex.length <= 4
      ? Array.from(hex).map(character => character.repeat(2)).join('')
      : hex;
    return `#${expanded.toUpperCase()}`;
  }

  const rgb = input.match(/^rgba?\((.*)\)$/i)?.[1];
  if (rgb === undefined) return null;

  let channels: string[];
  let rawAlpha: string | undefined;
  if (rgb.includes(',')) {
    const parts = rgb.split(',').map(part => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    rawAlpha = parts[3];
  } else {
    const slash = rgb.split('/');
    if (slash.length > 2) return null;
    channels = slash[0].trim().split(/\s+/);
    rawAlpha = slash[1]?.trim();
  }
  if (channels.length !== 3) return null;

  const parsedChannels = channels.map(channel);
  const parsedAlpha = alpha(rawAlpha);
  if (parsedChannels.some(item => item === null) || parsedAlpha === null) return null;
  return rgbaToDisplayHex({
    r: parsedChannels[0] as number,
    g: parsedChannels[1] as number,
    b: parsedChannels[2] as number,
    a: parsedAlpha,
  });
}
