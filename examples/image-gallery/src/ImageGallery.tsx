import React from 'react';
import { ControlType, defineComponent, type CodayComponentProps, type CodayImage } from '@coday/components';
interface GalleryItem { id: string; title: string; image: CodayImage }
export interface ImageGalleryProps extends CodayComponentProps { items: GalleryItem[]; columns: number; gap: number }
export default function ImageGallery({ items, columns, gap, style }: ImageGalleryProps) { return <div style={{ ...style, display: 'grid', gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gap }}>{items.map(item => <figure key={item.id}><img src={item.image.src} alt={item.image.alt || item.title} style={{ width: '100%', display: 'block' }} /><figcaption>{item.title}</figcaption></figure>)}</div> }
export const componentDefinition = defineComponent({ name: 'ImageGallery', id: 'coday.image-gallery', version: '1.0.0', component: ImageGallery, sizing: { width: 'fill', height: 'hug', defaultWidth: 960 }, controls: {
  items: { type: ControlType.Array, title: 'Images', category: 'Content', minCount: 1, maxCount: 40, itemTitleAdapter: 'field:title', defaultValue: [], control: { type: ControlType.Object, controls: { id: { type: ControlType.String, title: 'ID', defaultValue: 'item' }, title: { type: ControlType.String, title: 'Title', defaultValue: 'Image', bindable: true }, image: { type: ControlType.Image, title: 'Image', bindable: true } } } },
  columns: { type: ControlType.Number, title: 'Columns', defaultValue: 3, min: 1, max: 12, step: 1, display: 'stepper', responsive: true, category: 'Layout' },
  gap: { type: ControlType.Number, title: 'Gap', defaultValue: 16, min: 0, max: 80, unit: 'px', responsive: true, category: 'Layout' },
} });
