import React from 'react';
import { ControlType, defineComponent, type CodayComponentProps, type CodayImage, type CodaySpacing } from '@coday/components';

export interface ProductCardProps extends CodayComponentProps { title: string; description: string; image: CodayImage; price: number; featured: boolean; direction: 'horizontal' | 'vertical'; gap: number; padding: CodaySpacing }
export default function ProductCard({ title, description, image, price, featured, direction, gap, padding, style }: ProductCardProps) {
  return <article style={{ ...style, display: 'flex', flexDirection: direction === 'horizontal' ? 'row' : 'column', gap, padding: `${padding.top}${padding.unit} ${padding.right}${padding.unit} ${padding.bottom}${padding.unit} ${padding.left}${padding.unit}` }}>
    <img src={image.src} srcSet={image.srcSet} alt={image.alt || ''} style={{ maxWidth: '100%', objectFit: 'cover' }} />
    <div>{featured && <span>Featured</span>}<h3>{title}</h3><p>{description}</p><strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price)}</strong></div>
  </article>;
}
export const componentDefinition = defineComponent({
  id: 'coday.product-card', name: 'ProductCard', displayName: 'Product Card', version: '1.0.0', component: ProductCard,
  sizing: { width: 'fixed', height: 'hug', defaultWidth: 360 },
  controls: {
    title: { type: ControlType.String, title: 'Title', defaultValue: 'Product name', bindable: true, category: 'Content' },
    description: { type: ControlType.Text, title: 'Description', defaultValue: 'Product description', bindable: true, category: 'Content' },
    image: { type: ControlType.Image, title: 'Image', responsive: true, bindable: true, category: 'Content', defaultValue: { id: 'placeholder', src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/%3E', alt: '' } },
    price: { type: ControlType.Number, title: 'Price', defaultValue: 100, min: 0, max: 10000, step: 1, unit: 'BRL', bindable: true, category: 'Content' },
    featured: { type: ControlType.Boolean, title: 'Featured', defaultValue: false, category: 'Content' },
    direction: { type: ControlType.Enum, title: 'Direction', options: ['horizontal', 'vertical'], optionTitles: ['Horizontal', 'Vertical'], display: 'segmented', defaultValue: 'vertical', responsive: true, category: 'Layout' },
    gap: { type: ControlType.Number, title: 'Gap', defaultValue: 16, min: 0, max: 160, unit: 'px', display: 'slider-input', responsive: true, category: 'Layout' },
    padding: { type: ControlType.Spacing, title: 'Padding', defaultValue: { top: 24, right: 24, bottom: 24, left: 24, unit: 'px', linked: true }, responsive: true, category: 'Layout' },
  },
});
