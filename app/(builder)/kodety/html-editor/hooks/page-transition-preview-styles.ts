import type { CSSProperties } from 'react';
import { pageTransitionKeyframes, type PageTransitionMotion } from '@/lib/html-editor/page-transitions';

/** Initial/final paints; Motion owns interpolation on the two buffered frames. */
export function previewPageTransitionFrameStyle(
  motion: PageTransitionMotion,
  role: 'outgoing' | 'incoming',
  active: boolean,
  baseStyle?: CSSProperties,
): CSSProperties {
  const frames = pageTransitionKeyframes(motion.effect)[role];
  const visual = Object.fromEntries(Object.entries(frames).map(([key, values]) => [key, values[active ? 1 : 0]]));
  return {
    ...baseStyle,
    opacity: 1,
    transform: 'none',
    filter: 'none',
    clipPath: 'none',
    ...visual,
    transformOrigin: 'center center',
    willChange: 'opacity, transform, clip-path, filter',
    transition: 'none',
  };
}
