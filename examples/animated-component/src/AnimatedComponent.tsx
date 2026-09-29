import React, { useEffect, useRef } from 'react';
import { ControlType, defineComponent, type CodayComponentProps } from '@coday/components';
export interface AnimatedComponentProps extends CodayComponentProps { label: string; duration: number; distance: number; autoplay: boolean }
export default function AnimatedComponent({ label, duration, distance, autoplay, style }: AnimatedComponentProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = root.current; if (!element || !autoplay || matchMedia('(prefers-reduced-motion: reduce)').matches) return; const animation = element.animate([{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: duration * 1000, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }); return () => animation.cancel() }, [autoplay, distance, duration]);
  return <div ref={root} style={style}>{label}</div>;
}
export const componentDefinition = defineComponent({ name: 'AnimatedComponent', id: 'coday.animated-component', version: '1.0.0', component: AnimatedComponent, capabilities: ['animation'], sizing: { width: 'hug', height: 'hug', defaultWidth: 220 }, controls: {
  label: { type: ControlType.String, title: 'Label', defaultValue: 'Animated content', bindable: true, category: 'Content' },
  autoplay: { type: ControlType.Boolean, title: 'Autoplay', defaultValue: true, category: 'Animation' },
  duration: { type: ControlType.Number, title: 'Duration', defaultValue: 0.6, min: 0, max: 10, step: 0.05, unit: 's', display: 'slider-input', category: 'Animation', disabled: { property: 'autoplay', operator: 'equals', value: false } },
  distance: { type: ControlType.Number, title: 'Distance', defaultValue: 24, min: -400, max: 400, unit: 'px', category: 'Animation', hidden: { property: 'autoplay', operator: 'equals', value: false } },
} });
