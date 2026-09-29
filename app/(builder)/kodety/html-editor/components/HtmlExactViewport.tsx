'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Browser page zoom rounds an iframe viewport in device-independent pixels.
 * At 121%, a 480px frame becomes 581 / 1.21 = 480.165px: max-width:480px
 * stops matching even though innerWidth still reports 480. Measure that grid
 * with an empty, same-origin frame; devicePixelRatio cannot separate browser
 * zoom from the display's native density.
 */
function readViewportZoom(host: HTMLElement, onZoom: (zoom: number) => void): () => void {
  const probe = document.createElement('iframe');
  probe.setAttribute('data-html-viewport-probe', '');
  probe.setAttribute('aria-hidden', 'true');
  probe.tabIndex = -1;
  probe.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:1px;height:0;border:0;padding:0;visibility:hidden;pointer-events:none;';
  let finished = false;
  let deadline = 0;
  const cleanup = () => {
    finished = true;
    window.clearTimeout(deadline);
    probe.removeEventListener('load', measure);
    probe.remove();
  };
  const finish = (factor: number) => {
    if (finished) return;
    cleanup();
    onZoom(factor);
  };
  const measure = () => {
    if (finished) return;
    try {
      const frame = probe.contentWindow;
      const html = probe.contentDocument?.documentElement;
      if (!frame || !html) return;
      if (!CSS.supports('zoom', '1')) return finish(1);
      // Coprime widths distinguish whole zoom factors, which already preserve
      // every integer boundary. Tiny media-query widths are rounded in WebKit.
      const alreadyExact = [375, 376].every(width => {
        probe.style.width = `${width}px`;
        html.getBoundingClientRect();
        return frame.matchMedia(`(width: ${width}px)`).matches;
      });
      if (alreadyExact) return finish(1);
      for (let width = 1 / 64; width <= 8; width *= 2) {
        probe.style.width = `${width}px`;
        const actualWidth = html.getBoundingClientRect().width;
        if (actualWidth <= 0) continue;
        // The first nonzero viewport is exactly one quantization step. Round
        // float CSSOM noise, then validate both an odd and an even boundary.
        const factor = Math.round((1 / actualWidth) * 1_000_000) / 1_000_000;
        if (!Number.isFinite(factor) || factor < 0.05 || factor > 64) return finish(1);
        probe.style.zoom = String(1 / factor);
        for (const boundary of [375, 480]) {
          probe.style.width = `${boundary}px`;
          html.getBoundingClientRect();
          if (!frame.matchMedia(`(width: ${boundary}px)`).matches) return finish(1);
        }
        return finish(factor);
      }
      // If the engine still has no layout, the deadline releases this probe.
    } catch { finish(1); }
  };
  probe.addEventListener('load', measure);
  // Wait for the blank frame to load: WebKit can otherwise report a
  // provisional media-query viewport before its first layout.
  deadline = window.setTimeout(() => finish(1), 1000);
  host.appendChild(probe);
  return cleanup;
}

export function HtmlExactViewport({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let resolution: MediaQueryList | null = null;
    let cancelMeasurement = () => {};
    const refresh = () => {
      resolution?.removeEventListener('change', refresh);
      cancelMeasurement();
      cancelMeasurement = readViewportZoom(host, setZoom);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', refresh);
    };
    refresh();
    window.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      resolution?.removeEventListener('change', refresh);
      cancelMeasurement();
    };
  }, []);
  return (
    <div ref={hostRef} data-html-exact-viewport className="absolute left-0 top-0" style={{ width, height }}>
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width, height, zoom: 1 / zoom, transform: `scale(${zoom})` }}
      >
        {children}
      </div>
    </div>
  );
}
