'use client';

import { Monitor, Smartphone, Square } from '@/components/ui/gravity-icons';

interface HtmlBreakpointDeviceIconProps {
  width: number;
  className?: string;
}

/**
 * Use three distinct Gravity silhouettes. A rounded square reads as a tablet
 * slab without reusing the phone glyph or inventing a non-system icon.
 */
export function HtmlBreakpointDeviceIcon({
  width,
  className,
}: HtmlBreakpointDeviceIconProps) {
  if (width >= 1024) {
    return <Monitor aria-hidden className={className} />;
  }

  if (width >= 600) {
    return <Square aria-hidden className={className} />;
  }

  return <Smartphone aria-hidden className={className} />;
}
