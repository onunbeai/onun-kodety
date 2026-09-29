export type MediaFocusPoint = [number, number];

const DEFAULT_MEDIA_FOCUS: MediaFocusPoint = [50, 50];

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

function percentageToken(value: string) {
  const match = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%?$/);
  return match ? clampPercentage(Number(match[1])) : null;
}

/**
 * Converts the common CSS object-position forms into the two-axis focus model
 * used by the visual media control. Browsers normally expose percentages in
 * computed style, while authored rules often keep keywords such as
 * `center top` or `right bottom`.
 */
export function parseObjectPositionFocus(
  value: string,
  fallback: MediaFocusPoint = DEFAULT_MEDIA_FOCUS,
): MediaFocusPoint {
  const tokens = value
    .replace(/\s*!\s*important\b/gi, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return [...fallback];

  let x: number | null = null;
  let y: number | null = null;
  let centers = 0;

  tokens.slice(0, 2).forEach((token) => {
    if (token === 'left') {
      x = 0;
      return;
    }
    if (token === 'right') {
      x = 100;
      return;
    }
    if (token === 'top') {
      y = 0;
      return;
    }
    if (token === 'bottom') {
      y = 100;
      return;
    }
    if (token === 'center') {
      centers += 1;
      return;
    }
    const percentage = percentageToken(token);
    if (percentage === null) return;
    if (x === null) x = percentage;
    else if (y === null) y = percentage;
  });

  while (centers > 0) {
    if (x === null) x = 50;
    else if (y === null) y = 50;
    centers -= 1;
  }
  if (x === null && y !== null) x = 50;
  if (y === null && x !== null) y = 50;
  if (x === null || y === null) return [...fallback];
  return [clampPercentage(x), clampPercentage(y)];
}

export function normalizeMediaFocusPoint(
  point: MediaFocusPoint,
): MediaFocusPoint {
  return [
    Math.round(clampPercentage(point[0])),
    Math.round(clampPercentage(point[1])),
  ];
}

export function formatObjectPositionFocus(point: MediaFocusPoint) {
  const [x, y] = normalizeMediaFocusPoint(point);
  return `${x}% ${y}%`;
}
