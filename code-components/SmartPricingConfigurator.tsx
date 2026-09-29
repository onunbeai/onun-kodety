import React, { useEffect, useMemo, useState } from 'react';
import {
  ControlType,
  defineComponent,
  emitComponentEvent,
  type CodayBorder,
  type CodayColor,
  type CodayComponentProps,
  type CodayEffects,
  type CodayFile,
  type CodayImage,
  type CodayLayout,
  type CodayLink,
  type CodayRadius,
  type CodayShadow,
  type CodaySpacing,
  type CodayTypography,
} from '@coday/components';

interface PricingValues {
  monthly: number;
  annual: number;
  currency: string;
}

interface PricingFeature {
  id: string;
  label: string;
  included: boolean;
}

export interface SmartPricingConfiguratorProps extends CodayComponentProps {
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  showBadge: boolean;
  billing: 'monthly' | 'annual';
  seats: number;
  pricing: PricingValues;
  features: PricingFeature[];
  ctaLabel: string;
  ctaLink: CodayLink;
  launchDate: string;
  image?: CodayImage;
  download?: CodayFile;
  layout: CodayLayout;
  accent: CodayColor | string;
  surface: CodayColor | string;
  textColor: CodayColor | string;
  padding: CodaySpacing;
  radius: CodayRadius;
  border: CodayBorder;
  shadow: CodayShadow[];
  typography: CodayTypography;
  effects: CodayEffects;
}

function colorValue(value: CodayColor | string | undefined, fallback: string) {
  return typeof value === 'string' ? value : value?.value || fallback;
}

function spacingValue(value: CodaySpacing) {
  return `${value.top}${value.unit} ${value.right}${value.unit} ${value.bottom}${value.unit} ${value.left}${value.unit}`;
}

function radiusValue(value: CodayRadius) {
  return `${value.topLeft}${value.unit} ${value.topRight}${value.unit} ${value.bottomRight}${value.unit} ${value.bottomLeft}${value.unit}`;
}

function borderValue(value: CodayBorder) {
  if (!value.enabled) return 'none';
  const side = value.top;
  return `${side.width}px ${side.style} ${colorValue(side.color, 'transparent')}`;
}

function shadowValue(value: CodayShadow[]) {
  return value.map(item => `${item.inset ? 'inset ' : ''}${item.x}px ${item.y}px ${item.blur}px ${item.spread}px ${colorValue(item.color, '#00000033')}`).join(', ');
}

function linkHref(link: CodayLink) {
  if (link.type === 'email') return `mailto:${link.value}`;
  if (link.type === 'phone') return `tel:${link.value}`;
  if (link.type === 'section') return link.value.startsWith('#') ? link.value : `#${link.value}`;
  return link.value || '#';
}

export default function SmartPricingConfigurator({
  eyebrow,
  title,
  description,
  badge,
  showBadge,
  billing,
  seats,
  pricing,
  features,
  ctaLabel,
  ctaLink,
  launchDate,
  image,
  download,
  layout,
  accent,
  surface,
  textColor,
  padding,
  radius,
  border,
  shadow,
  typography,
  effects,
  style,
  className,
  instanceId,
}: SmartPricingConfiguratorProps) {
  const [selectedBilling, setSelectedBilling] = useState(billing);

  useEffect(() => setSelectedBilling(billing), [billing]);

  const total = useMemo(() => {
    const unit = selectedBilling === 'annual' ? pricing.annual : pricing.monthly;
    return Math.max(0, unit) * Math.max(1, seats);
  }, [pricing.annual, pricing.monthly, seats, selectedBilling]);

  const accentColor = colorValue(accent, '#7868ff');
  const foreground = colorValue(textColor, '#f8fafc');
  const columns = layout.mode === 'grid' ? Math.max(1, layout.columns || 2) : 1;
  const gap = layout.gap ?? layout.columnGap ?? 18;
  const launch = new Date(launchDate);
  const validLaunch = Number.isFinite(launch.getTime());

  const chooseBilling = (next: 'monthly' | 'annual') => {
    setSelectedBilling(next);
    emitComponentEvent('billingChange', { billing: next, seats }, instanceId);
  };

  return (
    <section
      className={className}
      style={{
        ...style,
        boxSizing: 'border-box',
        width: '100%',
        padding: spacingValue(padding),
        border: borderValue(border),
        borderRadius: radiusValue(radius),
        background: colorValue(surface, '#111217'),
        boxShadow: shadowValue(shadow),
        color: foreground,
        fontFamily: typography.family || 'inherit',
        fontSize: typography.size ? `${typography.size}${typography.unit || 'px'}` : undefined,
        lineHeight: typography.lineHeight || 1.5,
        opacity: effects.opacity ?? 1,
        filter: `blur(${effects.blur || 0}px) brightness(${effects.brightness || 1}) contrast(${effects.contrast || 1}) saturate(${effects.saturation || 1}) hue-rotate(${effects.hueRotate || 0}deg)`,
        backdropFilter: effects.backdropBlur ? `blur(${effects.backdropBlur}px)` : undefined,
        mixBlendMode: effects.blendMode as React.CSSProperties['mixBlendMode'],
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: accentColor, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{eyebrow}</span>
              {showBadge && <span style={{ borderRadius: 999, background: `${accentColor}24`, color: accentColor, padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>{badge}</span>}
            </div>
            <h2 style={{ margin: '18px 0 0', fontSize: 'clamp(28px, 5vw, 58px)', lineHeight: 0.98, letterSpacing: '-0.055em' }}>{title}</h2>
            <p style={{ maxWidth: 620, margin: '18px 0 0', color: `${foreground}B8`, fontSize: 15, lineHeight: 1.6 }}>{description}</p>
            {image?.src && <img src={image.src} alt={image.alt || ''} style={{ display: 'block', width: '100%', maxHeight: 220, marginTop: 20, borderRadius: Math.max(8, radius.topLeft * 0.65), objectFit: 'cover' }} />}
          </div>

          <ul style={{ display: 'grid', margin: 0, padding: 0, gap: 10, listStyle: 'none' }}>
            {features.map(feature => <li key={feature.id} style={{ display: 'flex', alignItems: 'center', gap: 10, color: feature.included ? foreground : `${foreground}70`, fontSize: 13 }}><span aria-hidden style={{ display: 'grid', width: 20, height: 20, placeItems: 'center', borderRadius: 999, background: feature.included ? `${accentColor}26` : `${foreground}0D`, color: feature.included ? accentColor : `${foreground}60` }}>{feature.included ? '✓' : '—'}</span>{feature.label}</li>)}
          </ul>
        </div>

        <aside style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 18, border: `1px solid ${foreground}14`, borderRadius: Math.max(12, radius.topLeft * 0.8), background: `${foreground}08`, padding: 20 }}>
          <div role="group" aria-label="Período de cobrança" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, borderRadius: 12, background: `${foreground}0A`, padding: 4 }}>
            {(['monthly', 'annual'] as const).map(option => <button key={option} type="button" aria-pressed={selectedBilling === option} onClick={() => chooseBilling(option)} style={{ minHeight: 38, border: 0, borderRadius: 9, background: selectedBilling === option ? accentColor : 'transparent', color: selectedBilling === option ? '#fff' : `${foreground}A8`, font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{option === 'monthly' ? 'Mensal' : 'Anual'}</button>)}
          </div>

          <div>
            <p style={{ margin: 0, color: `${foreground}90`, fontSize: 12 }}>{seats} {seats === 1 ? 'assento' : 'assentos'} · {selectedBilling === 'annual' ? 'por ano' : 'por mês'}</p>
            <p style={{ margin: '6px 0 0', fontSize: 'clamp(34px, 6vw, 58px)', fontWeight: 760, lineHeight: 1, letterSpacing: '-0.05em' }}><span style={{ color: accentColor, fontSize: '0.42em', verticalAlign: 'top' }}>{pricing.currency}</span>{total.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
          </div>

          <a href={linkHref(ctaLink)} target={ctaLink.target} rel={ctaLink.rel} onClick={() => emitComponentEvent('ctaClick', { billing: selectedBilling, seats, total }, instanceId)} style={{ display: 'flex', minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: accentColor, color: '#fff', fontSize: 13, fontWeight: 750, textDecoration: 'none' }}>{ctaLabel}</a>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: `${foreground}80`, fontSize: 10 }}>
            {validLaunch && <time dateTime={launchDate}>Disponível em {launch.toLocaleDateString('pt-BR')}</time>}
            {download?.url && <a href={download.url} download={download.name} style={{ color: accentColor }}>Baixar {download.name}</a>}
          </div>
        </aside>
      </div>
    </section>
  );
}

export const componentDefinition = defineComponent({
  id: 'kodety.smart-pricing-configurator',
  name: 'SmartPricingConfigurator',
  displayName: 'Smart Pricing Configurator',
  description: 'Calculadora de preços interativa com conteúdo, layout, assets e estilo configuráveis.',
  version: '1.0.0',
  component: SmartPricingConfigurator,
  sizing: { width: 'fill', height: 'hug', defaultWidth: 980, minWidth: 280 },
  events: {
    billingChange: { title: 'Alterar cobrança', payload: { billing: 'string', seats: 'number' } },
    ctaClick: { title: 'Clicar no CTA', payload: { billing: 'string', seats: 'number', total: 'number' } },
  },
  controls: {
    eyebrow: { type: ControlType.String, title: 'Eyebrow', defaultValue: 'Plano recomendado', bindable: true, category: 'Content', order: 1 },
    title: { type: ControlType.String, title: 'Título', defaultValue: 'Cresça sem surpresas na fatura.', bindable: true, responsive: true, category: 'Content', order: 2 },
    description: { type: ControlType.Text, title: 'Descrição', defaultValue: 'Escolha o período, ajuste os assentos e veja o investimento em tempo real.', bindable: true, minRows: 3, category: 'Content', order: 3 },
    showBadge: { type: ControlType.Boolean, title: 'Mostrar badge', defaultValue: true, category: 'Content', order: 4 },
    badge: { type: ControlType.String, title: 'Badge', defaultValue: 'Economize 20%', bindable: true, hidden: { property: 'showBadge', operator: 'equals', value: false }, category: 'Content', order: 5 },
    billing: { type: ControlType.Enum, title: 'Cobrança inicial', options: ['monthly', 'annual'], optionTitles: ['Mensal', 'Anual'], defaultValue: 'annual', display: 'segmented', category: 'Content', order: 6 },
    seats: { type: ControlType.Number, title: 'Assentos', defaultValue: 8, min: 1, max: 100, step: 1, display: 'slider-input', responsive: true, category: 'Content', order: 7 },
    pricing: { type: ControlType.Object, title: 'Preços', category: 'Content', order: 8, defaultValue: { monthly: 79, annual: 63, currency: 'R$' }, controls: { monthly: { type: ControlType.Number, title: 'Mensal', defaultValue: 79, min: 0 }, annual: { type: ControlType.Number, title: 'Anual', defaultValue: 63, min: 0 }, currency: { type: ControlType.String, title: 'Moeda', defaultValue: 'R$', maxLength: 6 } } },
    features: { type: ControlType.Array, title: 'Recursos', category: 'Content', order: 9, minCount: 1, maxCount: 8, itemTitleAdapter: 'label', defaultValue: [{ id: 'analytics', label: 'Analytics em tempo real', included: true }, { id: 'automation', label: 'Automações ilimitadas', included: true }, { id: 'support', label: 'Suporte prioritário', included: true }], control: { type: ControlType.Object, controls: { id: { type: ControlType.String, title: 'ID', defaultValue: 'feature' }, label: { type: ControlType.String, title: 'Nome', defaultValue: 'Novo recurso' }, included: { type: ControlType.Boolean, title: 'Incluído', defaultValue: true } } } },
    ctaLabel: { type: ControlType.String, title: 'Texto do CTA', defaultValue: 'Começar agora', bindable: true, category: 'Content', order: 10 },
    ctaLink: { type: ControlType.Link, title: 'Link do CTA', defaultValue: { type: 'url', value: '#checkout', target: '_self' }, category: 'Content', order: 11 },
    launchDate: { type: ControlType.Date, title: 'Data de disponibilidade', mode: 'date', defaultValue: '2030-01-01', bindable: true, category: 'Content', order: 12 },
    image: { type: ControlType.Image, title: 'Imagem', category: 'Content', order: 13 },
    download: { type: ControlType.File, title: 'Material para download', category: 'Content', order: 14 },
    layout: { type: ControlType.Layout, title: 'Layout', responsive: true, category: 'Layout', defaultValue: { mode: 'grid', columns: 2, gap: 24, minColumnWidth: 280 } },
    padding: { type: ControlType.Spacing, title: 'Padding', responsive: true, category: 'Layout', defaultValue: { top: 36, right: 36, bottom: 36, left: 36, unit: 'px', linked: true } },
    accent: { type: ControlType.Color, title: 'Cor de destaque', allowAlpha: true, allowTokens: true, category: 'Style', defaultValue: '#7868FF' },
    surface: { type: ControlType.Color, title: 'Fundo', allowAlpha: true, allowTokens: true, category: 'Style', defaultValue: '#111217' },
    textColor: { type: ControlType.Color, title: 'Texto', allowTokens: true, category: 'Style', defaultValue: '#F8FAFC' },
    radius: { type: ControlType.Radius, title: 'Arredondamento', responsive: true, category: 'Style', defaultValue: { topLeft: 24, topRight: 24, bottomRight: 24, bottomLeft: 24, unit: 'px', linked: true } },
    border: { type: ControlType.Border, title: 'Borda', allowTokens: true, category: 'Style', defaultValue: { enabled: true, linked: true, top: { width: 1, style: 'solid', color: '#FFFFFF1A' }, right: { width: 1, style: 'solid', color: '#FFFFFF1A' }, bottom: { width: 1, style: 'solid', color: '#FFFFFF1A' }, left: { width: 1, style: 'solid', color: '#FFFFFF1A' } } },
    shadow: { type: ControlType.Shadow, title: 'Sombras', maxCount: 4, category: 'Effects', defaultValue: [{ id: 'ambient', x: 0, y: 24, blur: 80, spread: -24, color: '#00000080', inset: false }] },
    typography: { type: ControlType.Typography, title: 'Tipografia', allowTokens: true, responsive: true, category: 'Typography', defaultValue: { family: 'Inter, sans-serif', weight: 500, size: 16, unit: 'px', lineHeight: 1.5, letterSpacing: 0, align: 'left', transform: 'none', decoration: 'none' } },
    effects: { type: ControlType.Effects, title: 'Efeitos', category: 'Effects', defaultValue: { opacity: 1, blur: 0, backdropBlur: 0, brightness: 1, contrast: 1, saturation: 1, hueRotate: 0, blendMode: 'normal' } },
  },
});
