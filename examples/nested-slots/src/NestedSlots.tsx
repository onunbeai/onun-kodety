import React, { type ReactNode } from 'react';
import { ControlType, defineComponent, type CodayComponentProps } from '@coday/components';
export interface NestedSlotsProps extends CodayComponentProps { header?: ReactNode; content?: ReactNode; actions?: ReactNode[]; gap: number }
export default function NestedSlots({ header, content, actions, gap, style }: NestedSlotsProps) { return <section style={{ ...style, display: 'grid', gap }}><header>{header}</header><div>{content}</div><footer style={{ display: 'flex', gap }}>{actions}</footer></section> }
export const componentDefinition = defineComponent({ name: 'NestedSlots', id: 'coday.nested-slots', version: '1.0.0', component: NestedSlots, capabilities: ['slots'], sizing: { width: 'fill', height: 'hug', defaultWidth: 640 }, controls: {
  header: { type: ControlType.Slot, title: 'Header', accepts: ['Text', 'Heading'], category: 'Content' },
  content: { type: ControlType.Slot, title: 'Content', category: 'Content' },
  actions: { type: ControlType.Slots, title: 'Actions', accepts: ['Button', 'Link'], maxCount: 4, category: 'Content' },
  gap: { type: ControlType.Number, title: 'Gap', defaultValue: 16, min: 0, max: 80, unit: 'px', responsive: true, category: 'Layout' },
} });
