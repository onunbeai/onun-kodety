import React from 'react';
import { ControlType, defineComponent, type CodayComponentProps, type CodayImage } from '@coday/components';
interface CmsRow { id: string; title: string; summary: string; image?: CodayImage }
export interface CmsListProps extends CodayComponentProps { heading: string; items: CmsRow[]; emptyMessage: string }
export default function CmsList({ heading, items, emptyMessage, style }: CmsListProps) { return <section style={style}><h2>{heading}</h2>{items.length ? <ul>{items.map(item => <li key={item.id}>{item.image && <img src={item.image.src} alt={item.image.alt || ''} width={64} />}<h3>{item.title}</h3><p>{item.summary}</p></li>)}</ul> : <p>{emptyMessage}</p>}</section> }
export const componentDefinition = defineComponent({ name: 'CmsList', id: 'coday.cms-list', version: '1.0.0', component: CmsList, capabilities: ['cms'], sizing: { width: 'fill', height: 'hug', defaultWidth: 720 }, controls: {
  heading: { type: ControlType.String, title: 'Heading', defaultValue: 'Latest items', bindable: true, category: 'Content' },
  items: { type: ControlType.Array, title: 'Items', bindable: true, category: 'Data', defaultValue: [], itemTitleAdapter: 'field:title', control: { type: ControlType.Object, controls: { id: { type: ControlType.String, title: 'ID' }, title: { type: ControlType.String, title: 'Title', bindable: true }, summary: { type: ControlType.Text, title: 'Summary', bindable: true }, image: { type: ControlType.Image, title: 'Image', bindable: true } } } },
  emptyMessage: { type: ControlType.String, title: 'Empty message', defaultValue: 'No items found.', category: 'Content' },
} });
