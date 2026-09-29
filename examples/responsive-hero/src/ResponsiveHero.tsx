import React from 'react';
import { ControlType, defineComponent, type CodayComponentProps, type CodayLayout, type CodaySpacing } from '@coday/components';
export interface ResponsiveHeroProps extends CodayComponentProps { eyebrow: string; heading: string; body: string; layout: CodayLayout; padding: CodaySpacing; headingSize: number }
export default function ResponsiveHero({ eyebrow, heading, body, layout, padding, headingSize, style }: ResponsiveHeroProps) {
  const layoutStyle: React.CSSProperties = layout.mode === 'grid' ? { display: 'grid', gridTemplateColumns: `repeat(${layout.columns || 2},minmax(0,1fr))`, gap: layout.gap } : { display: 'flex', flexDirection: layout.direction === 'horizontal' ? 'row' : 'column', gap: layout.gap, alignItems: layout.align };
  return <section style={{ ...style, ...layoutStyle, padding: `${padding.top}${padding.unit} ${padding.right}${padding.unit} ${padding.bottom}${padding.unit} ${padding.left}${padding.unit}` }}><div><small>{eyebrow}</small><h1 style={{ fontSize: headingSize }}>{heading}</h1></div><p>{body}</p></section>;
}
export const componentDefinition = defineComponent({ name: 'ResponsiveHero', id: 'coday.responsive-hero', version: '1.0.0', component: ResponsiveHero, sizing: { width: 'fill', height: 'hug', defaultWidth: 1200 }, controls: {
  eyebrow: { type: ControlType.String, title: 'Eyebrow', defaultValue: 'CODAY', bindable: true, category: 'Content' },
  heading: { type: ControlType.String, title: 'Heading', defaultValue: 'Build without limits', bindable: true, category: 'Content' },
  body: { type: ControlType.Text, title: 'Body', defaultValue: 'A responsive hero driven by property controls.', bindable: true, category: 'Content' },
  headingSize: { type: ControlType.Number, title: 'Heading size', defaultValue: 64, min: 20, max: 160, unit: 'px', display: 'slider-input', responsive: true, category: 'Typography' },
  layout: { type: ControlType.Layout, title: 'Layout', responsive: true, category: 'Layout', defaultValue: { mode: 'stack', direction: 'horizontal', gap: 32, align: 'center', justify: 'space-between' } },
  padding: { type: ControlType.Spacing, title: 'Padding', responsive: true, category: 'Layout', defaultValue: { top: 64, right: 48, bottom: 64, left: 48, unit: 'px', linked: false } },
} });
