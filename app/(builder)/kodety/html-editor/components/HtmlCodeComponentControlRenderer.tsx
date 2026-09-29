'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { PropertyControlRenderArgs } from '@coday/property-inspector';
import {
  ControlType,
  type CodayBorder,
  type CodayBorderSide,
  type CodayEffects,
  type CodayFile,
  type CodayImage,
  type CodayLayout,
  type CodayLink,
  type CodayRadius,
  type CodayShadow,
  type CodaySpacing,
  type CodayTransform,
  type CodayTypography,
  type CSSUnit,
  type ControlDefinition,
  type JSONPrimitive,
  type JSONValue,
} from '@coday/control-schema';
import ColorPicker from '@/app/(builder)/kodety/components/ColorPicker';
import MarginPadding, { type SpacingValues } from '@/app/(builder)/kodety/components/MarginPadding';
import { RadiusValueControl } from '@/app/(builder)/kodety/components/RadiusValueControl';
import { Button } from '@/components/ui/button';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  ImageIcon,
  Plus,
  Trash2,
} from '@/components/ui/gravity-icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { codeComponentColorEditorValue } from '@/lib/html-editor/code-components';

const CSS_UNITS: CSSUnit[] = ['px', 'rem', 'em', '%', 'vw', 'vh'];
const BORDER_STYLES: CodayBorderSide['style'][] = ['none', 'solid', 'dashed', 'dotted', 'double'];
const LINK_TYPES: CodayLink['type'][] = ['url', 'page', 'section', 'email', 'phone', 'file'];

const surfaceClass = 'rounded-xl border border-border/60 bg-secondary/25 p-2.5 shadow-[0_1px_0_rgba(255,255,255,0.025)_inset]';

export function codeComponentDateInputValue(value: unknown, mode?: 'date' | 'datetime') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (mode !== 'datetime') return raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function codeComponentDateValue(value: string, mode?: 'date' | 'datetime') {
  if (!value || mode !== 'datetime') return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function NativeSelect({ value, options, titles, onChange, className }: { value: string; options: string[]; titles?: string[]; onChange(value: string): void; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full', className)}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((option, index) => <SelectItem key={option} value={option}>{titles?.[index] || option}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function LabeledField({ label, children, stacked = false }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? 'flex flex-col gap-1.5' : 'grid grid-cols-3 items-center gap-2'}>
      <Label variant="muted" className={stacked ? 'text-[10px]' : undefined}>{label}</Label>
      <div className={stacked ? 'min-w-0' : 'col-span-2 min-w-0'}>{children}</div>
    </div>
  );
}

function NumberField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Number) return null;
  const definition = args.definition;
  const value = Number(args.value ?? definition.defaultValue ?? 0);
  const input = (
    <Input
      stepper
      type="number"
      min={definition.min}
      max={definition.max}
      step={definition.step || 1}
      value={Number.isFinite(value) ? value : 0}
      onFocus={args.beginTransaction}
      onBlur={args.commitTransaction}
      onChange={(event) => args.onChange(Number(event.target.value))}
    />
  );
  if (!definition.display?.includes('slider')) {
    return <div className="flex items-center gap-1.5">{input}{definition.unit && <span className="shrink-0 text-[10px] text-muted-foreground">{definition.unit}</span>}</div>;
  }
  return (
    <Slider
      min={definition.min ?? 0}
      max={definition.max ?? 100}
      step={definition.step || 1}
      value={[value]}
      unit={definition.unit}
      onInputFocus={args.beginTransaction}
      onInputBlur={args.commitTransaction}
      onInputValueChange={(next) => args.onChange(Number(next))}
      onPointerDown={args.beginTransaction}
      onValueChange={([next]) => args.onChange(next)}
      onValueCommit={args.commitTransaction}
    />
  );
}

function AssetField({ args, kind }: { args: PropertyControlRenderArgs; kind: 'image' | 'file' }) {
  const image = kind !== 'image' || !args.value
    ? null
    : typeof args.value === 'string'
      ? { id: args.value, src: args.value, alt: '' }
      : typeof args.value === 'object' && !Array.isArray(args.value)
        ? args.value as unknown as CodayImage
        : null;
  const file = kind === 'file' && args.value && typeof args.value === 'object' && !Array.isArray(args.value)
    ? args.value as unknown as CodayFile
    : null;
  const directlyPreviewable = image?.src && /^(?:data:|blob:|https?:|\/\/)/i.test(image.src) ? image.src : '';
  const [previewSrc, setPreviewSrc] = useState(directlyPreviewable);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setPreviewFailed(false);
    setPreviewSrc(directlyPreviewable);
    if (!image?.id || !args.assetProvider) return () => { current = false; };
    void args.assetProvider.resolveAsset(image.id).then(asset => {
      if (!current || asset?.kind !== 'image') return;
      setPreviewSrc(asset.src);
    }).catch(() => {
      if (current) setPreviewFailed(true);
    });
    return () => { current = false; };
  }, [args.assetProvider, directlyPreviewable, image?.id]);
  const pick = async () => {
    const asset = kind === 'image'
      ? await args.assetProvider?.selectImage({
          mimeTypes: args.definition.type === ControlType.Image ? args.definition.acceptedMimeTypes : undefined,
          maxBytes: args.definition.type === ControlType.Image ? args.definition.maxBytes : undefined,
          currentId: image?.id,
        })
      : await args.assetProvider?.selectFile({
          extensions: args.definition.type === ControlType.File ? args.definition.extensions : undefined,
          mimeTypes: args.definition.type === ControlType.File ? args.definition.mimeTypes : undefined,
          maxBytes: args.definition.type === ControlType.File ? args.definition.maxBytes : undefined,
          currentId: file?.id,
        });
    if (asset) args.onChange(asset as unknown as JSONValue);
  };
  return (
    <div className={cn(surfaceClass, 'flex flex-col overflow-hidden p-0')}>
      <div className={cn(
        'flex w-full items-center justify-center overflow-hidden bg-background/60 text-muted-foreground',
        kind === 'image' ? 'h-28 border-b border-border/60' : 'h-20',
      )}>
        {kind === 'image' && previewSrc && !previewFailed
          ? <img src={previewSrc} alt={image?.alt || ''} className="size-full object-cover" onError={() => setPreviewFailed(true)} />
          : <div className="flex flex-col items-center gap-1.5 text-center"><span className="flex size-8 items-center justify-center rounded-lg border border-border/60 bg-secondary/50">{kind === 'image' ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</span>{kind === 'image' && image && <span className="text-[9px]">{previewFailed ? 'Prévia indisponível' : 'Carregando prévia…'}</span>}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-foreground">{image?.alt || file?.name || (kind === 'image' ? 'Nenhuma imagem' : 'Nenhum arquivo')}</p>
          <p className="truncate text-[9px] text-muted-foreground">{image?.src || file?.mimeType || 'Selecione na biblioteca do projeto'}</p>
        </div>
        <Button variant="outline" size="icon-xs" onClick={() => void pick()} disabled={!args.assetProvider} aria-label={args.value ? 'Substituir asset' : 'Selecionar asset'}>
          {args.value ? <ImageIcon /> : <Plus />}
        </Button>
        {args.value != null && <Button variant="ghost" size="icon-xs" onClick={() => args.onChange(null)} aria-label="Remover asset"><Trash2 /></Button>}
      </div>
    </div>
  );
}

function LinkField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Link) return null;
  const value = (args.value && typeof args.value === 'object' && !Array.isArray(args.value)
    ? args.value
    : args.definition.defaultValue || { type: 'url', value: '' }) as unknown as CodayLink;
  const types = args.definition.allowedTypes || LINK_TYPES;
  return (
    <div className={cn(surfaceClass, 'flex flex-col gap-2')}>
      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
        <NativeSelect value={value.type} options={types} onChange={(type) => args.onChange({ ...value, type } as unknown as JSONValue)} />
        <Input value={value.value || ''} placeholder={value.type === 'url' ? 'https://…' : 'Destino'} onChange={(event) => args.onChange({ ...value, value: event.target.value } as unknown as JSONValue)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect value={value.target || '_self'} options={['_self', '_blank']} titles={['Mesma janela', 'Nova janela']} onChange={(target) => args.onChange({ ...value, target } as unknown as JSONValue)} />
        <Input value={value.rel || ''} placeholder="rel opcional" onChange={(event) => args.onChange({ ...value, rel: event.target.value } as unknown as JSONValue)} />
      </div>
    </div>
  );
}

function SpacingField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Spacing) return null;
  const definition = args.definition;
  const value = (args.value || definition.defaultValue || { top: 0, right: 0, bottom: 0, left: 0, unit: 'px', linked: true }) as CodaySpacing;
  const spacingValues: SpacingValues = {
    marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0',
    paddingTop: String(value.top), paddingRight: String(value.right), paddingBottom: String(value.bottom), paddingLeft: String(value.left),
  };
  const changeSide = (property: keyof SpacingValues, raw: string) => {
    const side = property.replace('padding', '').toLowerCase() as 'top' | 'right' | 'bottom' | 'left';
    if (!['top', 'right', 'bottom', 'left'].includes(side)) return;
    const nextValue = Number(raw);
    const next = { ...value, [side]: Number.isFinite(nextValue) ? nextValue : 0 };
    if (value.linked) Object.assign(next, { top: next[side], right: next[side], bottom: next[side], left: next[side] });
    args.onChange(next as unknown as JSONValue);
  };
  return (
    <div className={cn(surfaceClass, 'flex flex-col gap-3')}>
      <MarginPadding mode="padding" values={spacingValues} onChange={changeSide} onInteractionStart={args.beginTransaction} onInteractionEnd={args.commitTransaction} />
      <div className="grid grid-cols-2 gap-2">
        <LabeledField label="Unidade" stacked><NativeSelect value={value.unit} options={(definition.units || CSS_UNITS) as string[]} onChange={(unit) => args.onChange({ ...value, unit } as unknown as JSONValue)} /></LabeledField>
        <LabeledField label="Vincular" stacked><div className="flex h-8 items-center justify-end"><Switch size="sm" checked={value.linked} onCheckedChange={(linked) => args.onChange({ ...value, linked } as unknown as JSONValue)} /></div></LabeledField>
      </div>
    </div>
  );
}

function RadiusField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Radius) return null;
  const definition = args.definition;
  const value = (args.value || definition.defaultValue || { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0, unit: 'px', linked: true }) as CodayRadius;
  const update = (key: keyof CodayRadius, raw: string | boolean) => {
    const nextValue = typeof raw === 'string' ? Number(raw) : raw;
    const next = { ...value, [key]: nextValue };
    if (key === 'topLeft' && value.linked) Object.assign(next, { topLeft: nextValue, topRight: nextValue, bottomRight: nextValue, bottomLeft: nextValue });
    args.onChange(next as unknown as JSONValue);
  };
  return (
    <div className={cn(surfaceClass, 'flex flex-col gap-3')}>
      <RadiusValueControl
        label="Radius"
        mode={value.linked ? 'all' : 'individual'}
        value={String(value.topLeft)}
        topLeft={String(value.topLeft)}
        topRight={String(value.topRight)}
        bottomRight={String(value.bottomRight)}
        bottomLeft={String(value.bottomLeft)}
        onValueChange={(raw) => update('topLeft', raw)}
        onTopLeftChange={(raw) => update('topLeft', raw)}
        onTopRightChange={(raw) => update('topRight', raw)}
        onBottomRightChange={(raw) => update('bottomRight', raw)}
        onBottomLeftChange={(raw) => update('bottomLeft', raw)}
        onInteractionStart={args.beginTransaction}
        onInteractionEnd={args.commitTransaction}
        onModeToggle={() => args.onChange(value.linked
          ? { ...value, linked: false } as unknown as JSONValue
          : { ...value, linked: true, topRight: value.topLeft, bottomRight: value.topLeft, bottomLeft: value.topLeft } as unknown as JSONValue)}
      />
      <LabeledField label="Unidade"><NativeSelect value={value.unit} options={(definition.units || CSS_UNITS) as string[]} onChange={(unit) => args.onChange({ ...value, unit } as unknown as JSONValue)} /></LabeledField>
    </div>
  );
}

function BorderSideField({ side, value, onChange }: { side: string; value: CodayBorderSide; onChange(value: CodayBorderSide): void }) {
  const color = typeof value.color === 'string' ? value.color : value.color?.value || '#000000';
  return (
    <div className="grid grid-cols-[54px_62px_minmax(0,1fr)_36px] items-center gap-1.5">
      <Label variant="muted" className="capitalize">{side}</Label>
      <Input stepper type="number" min={0} value={value.width} onChange={(event) => onChange({ ...value, width: Number(event.target.value) })} />
      <NativeSelect value={value.style} options={BORDER_STYLES} onChange={(style) => onChange({ ...value, style: style as CodayBorderSide['style'] })} />
      <ColorPicker swatchOnly solidOnly value={color} onChange={(next) => onChange({ ...value, color: next })} onImmediateChange={(next) => onChange({ ...value, color: next })} />
    </div>
  );
}

function BorderField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Border) return null;
  const side: CodayBorderSide = { width: 1, style: 'solid', color: '#27272a' };
  const value = (args.value || args.definition.defaultValue || { enabled: true, linked: true, top: side, right: side, bottom: side, left: side }) as CodayBorder;
  const updateSide = (key: 'top' | 'right' | 'bottom' | 'left', nextSide: CodayBorderSide) => {
    args.onChange((value.linked
      ? { ...value, top: nextSide, right: nextSide, bottom: nextSide, left: nextSide }
      : { ...value, [key]: nextSide }) as unknown as JSONValue);
  };
  const sides = value.linked ? (['top'] as const) : (['top', 'right', 'bottom', 'left'] as const);
  return (
    <div className={cn(surfaceClass, 'flex flex-col gap-2.5')}>
      <div className="flex items-center justify-between">
        <div><p className="text-[11px] font-medium text-foreground">Borda</p><p className="text-[9px] text-muted-foreground">{value.linked ? 'Todos os lados' : 'Lados independentes'}</p></div>
        <div className="flex items-center gap-3"><Switch size="sm" checked={value.linked} onCheckedChange={(linked) => args.onChange({ ...value, linked } as unknown as JSONValue)} /><Switch size="sm" checked={value.enabled} onCheckedChange={(enabled) => args.onChange({ ...value, enabled } as unknown as JSONValue)} /></div>
      </div>
      {value.enabled && sides.map(key => <BorderSideField key={key} side={value.linked ? 'Todos' : key} value={value[key]} onChange={(next) => updateSide(key, next)} />)}
    </div>
  );
}

function ShadowField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Shadow) return null;
  const values = (Array.isArray(args.value) ? args.value : args.definition.defaultValue || []) as unknown as CodayShadow[];
  const update = (index: number, patch: Partial<CodayShadow>) => args.onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) as unknown as JSONValue);
  const remove = (index: number) => args.onChange(values.filter((_, itemIndex) => itemIndex !== index) as unknown as JSONValue);
  const add = () => args.onChange([...values, { id: `shadow-${Date.now().toString(36)}`, x: 0, y: 8, blur: 24, spread: 0, color: '#00000033', inset: false }] as unknown as JSONValue);
  return (
    <div className="flex flex-col gap-2">
      {values.map((shadow, index) => (
        <div key={shadow.id || index} className={cn(surfaceClass, 'flex flex-col gap-2')}>
          <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-foreground">Sombra {index + 1}</span><Button variant="ghost" size="icon-xs" onClick={() => remove(index)} aria-label="Remover sombra"><Trash2 /></Button></div>
          <div className="grid grid-cols-4 gap-1.5">
            {(['x', 'y', 'blur', 'spread'] as const).map(key => <LabeledField key={key} label={key} stacked><Input stepper type="number" value={shadow[key]} onChange={(event) => update(index, { [key]: Number(event.target.value) })} /></LabeledField>)}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2"><ColorPicker solidOnly value={typeof shadow.color === 'string' ? shadow.color : shadow.color.value} onChange={(color) => update(index, { color })} onImmediateChange={(color) => update(index, { color })} /><div className="flex items-center justify-end gap-2"><Label variant="muted">Inset</Label><Switch size="sm" checked={shadow.inset} onCheckedChange={(inset) => update(index, { inset })} /></div></div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={add} disabled={values.length >= (args.definition.maxCount ?? Infinity)}><Plus />Adicionar sombra</Button>
    </div>
  );
}

function LayoutField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Layout) return null;
  const value = (args.value || args.definition.defaultValue || { mode: 'stack', direction: 'vertical', gap: 0 }) as CodayLayout;
  const update = (patch: Partial<CodayLayout>) => args.onChange({ ...value, ...patch } as unknown as JSONValue);
  const diagonal = value.diagonal || { angle: 20, itemOffset: 12, direction: 'forward' as const, origin: 'start' as const, alignment: 'center' as const, rotateItems: false };
  return (
    <div className={cn(surfaceClass, 'flex flex-col gap-3')}>
      <Tabs value={value.mode} onValueChange={(mode) => update({ mode: mode as CodayLayout['mode'] })}><TabsList className="w-full">{['stack', 'grid', 'free', 'diagonal'].map(mode => <TabsTrigger key={mode} value={mode}>{mode}</TabsTrigger>)}</TabsList></Tabs>
      {value.mode === 'stack' && <div className="grid grid-cols-2 gap-2"><LabeledField label="Direção" stacked><NativeSelect value={value.direction || 'vertical'} options={['horizontal', 'vertical']} onChange={(direction) => update({ direction: direction as CodayLayout['direction'] })} /></LabeledField><LabeledField label="Gap" stacked><Input stepper type="number" value={value.gap || 0} onChange={(event) => update({ gap: Number(event.target.value) })} /></LabeledField><LabeledField label="Alinhar" stacked><NativeSelect value={value.align || 'stretch'} options={['start', 'center', 'end', 'stretch']} onChange={(align) => update({ align: align as CodayLayout['align'] })} /></LabeledField><LabeledField label="Distribuir" stacked><NativeSelect value={value.justify || 'start'} options={['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly']} onChange={(justify) => update({ justify: justify as CodayLayout['justify'] })} /></LabeledField><LabeledField label="Quebrar" stacked><div className="flex h-8 items-center justify-end"><Switch size="sm" checked={Boolean(value.wrap)} onCheckedChange={(wrap) => update({ wrap })} /></div></LabeledField></div>}
      {value.mode === 'grid' && <div className="grid grid-cols-2 gap-2"><LabeledField label="Colunas" stacked><Input stepper type="number" min={1} value={value.columns || 1} onChange={(event) => update({ columns: Number(event.target.value) })} /></LabeledField><LabeledField label="Largura mínima" stacked><Input stepper type="number" min={0} value={value.minColumnWidth || 0} onChange={(event) => update({ minColumnWidth: Number(event.target.value) })} /></LabeledField><LabeledField label="Gap X" stacked><Input stepper type="number" value={value.columnGap ?? value.gap ?? 0} onChange={(event) => update({ columnGap: Number(event.target.value) })} /></LabeledField><LabeledField label="Gap Y" stacked><Input stepper type="number" value={value.rowGap ?? value.gap ?? 0} onChange={(event) => update({ rowGap: Number(event.target.value) })} /></LabeledField></div>}
      {value.mode === 'free' && <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">Os filhos usam posicionamento livre no canvas.</p>}
      {value.mode === 'diagonal' && <div className="grid grid-cols-2 gap-2"><LabeledField label="Ângulo" stacked><Input stepper type="number" value={diagonal.angle} onChange={(event) => update({ diagonal: { ...diagonal, angle: Number(event.target.value) } })} /></LabeledField><LabeledField label="Distância" stacked><Input stepper type="number" value={diagonal.itemOffset} onChange={(event) => update({ diagonal: { ...diagonal, itemOffset: Number(event.target.value) } })} /></LabeledField><LabeledField label="Direção" stacked><NativeSelect value={diagonal.direction} options={['forward', 'reverse']} onChange={(direction) => update({ diagonal: { ...diagonal, direction: direction as 'forward' | 'reverse' } })} /></LabeledField><LabeledField label="Origem" stacked><NativeSelect value={diagonal.origin} options={['start', 'center', 'end']} onChange={(origin) => update({ diagonal: { ...diagonal, origin: origin as 'start' | 'center' | 'end' } })} /></LabeledField><LabeledField label="Alinhamento" stacked><NativeSelect value={diagonal.alignment} options={['start', 'center', 'end']} onChange={(alignment) => update({ diagonal: { ...diagonal, alignment: alignment as 'start' | 'center' | 'end' } })} /></LabeledField><LabeledField label="Rotacionar" stacked><div className="flex h-8 items-center justify-end"><Switch size="sm" checked={diagonal.rotateItems} onCheckedChange={(rotateItems) => update({ diagonal: { ...diagonal, rotateItems } })} /></div></LabeledField></div>}
    </div>
  );
}

const COMPOSITE_FIELDS: Record<'typography' | 'transform' | 'effects', Array<{ key: string; label: string; kind: 'text' | 'number' | 'boolean' | 'select'; options?: string[] }>> = {
  typography: [
    { key: 'family', label: 'Fonte', kind: 'text' }, { key: 'weight', label: 'Peso', kind: 'number' }, { key: 'size', label: 'Tamanho', kind: 'number' }, { key: 'unit', label: 'Unidade', kind: 'select', options: CSS_UNITS },
    { key: 'lineHeight', label: 'Altura da linha', kind: 'number' }, { key: 'letterSpacing', label: 'Espaçamento', kind: 'number' }, { key: 'align', label: 'Alinhamento', kind: 'select', options: ['left', 'center', 'right', 'justify'] },
    { key: 'transform', label: 'Caixa', kind: 'select', options: ['none', 'uppercase', 'lowercase', 'capitalize'] }, { key: 'decoration', label: 'Decoração', kind: 'select', options: ['none', 'underline', 'line-through'] },
  ],
  transform: [
    { key: 'translateX', label: 'Mover X', kind: 'number' }, { key: 'translateY', label: 'Mover Y', kind: 'number' }, { key: 'translateZ', label: 'Mover Z', kind: 'number' }, { key: 'rotateX', label: 'Rotação X', kind: 'number' }, { key: 'rotateY', label: 'Rotação Y', kind: 'number' }, { key: 'rotateZ', label: 'Rotação Z', kind: 'number' },
    { key: 'scaleX', label: 'Escala X', kind: 'number' }, { key: 'scaleY', label: 'Escala Y', kind: 'number' }, { key: 'scaleZ', label: 'Escala Z', kind: 'number' }, { key: 'skewX', label: 'Inclinação X', kind: 'number' }, { key: 'skewY', label: 'Inclinação Y', kind: 'number' }, { key: 'origin', label: 'Origem', kind: 'text' }, { key: 'perspective', label: 'Perspectiva', kind: 'number' },
  ],
  effects: [
    { key: 'opacity', label: 'Opacidade', kind: 'number' }, { key: 'blur', label: 'Desfoque', kind: 'number' }, { key: 'backdropBlur', label: 'Desfoque fundo', kind: 'number' }, { key: 'brightness', label: 'Brilho', kind: 'number' }, { key: 'contrast', label: 'Contraste', kind: 'number' }, { key: 'saturation', label: 'Saturação', kind: 'number' }, { key: 'hueRotate', label: 'Matiz', kind: 'number' }, { key: 'blendMode', label: 'Mesclagem', kind: 'text' },
  ],
};

function CompositeField({ args, type }: { args: PropertyControlRenderArgs; type: keyof typeof COMPOSITE_FIELDS }) {
  const value = (args.value || args.definition.defaultValue || {}) as Partial<CodayTypography & CodayTransform & CodayEffects>;
  const record = value as Record<string, JSONValue | undefined>;
  const update = (key: string, next: JSONValue | undefined) => {
    const result = { ...record };
    if (next === undefined || next === '') delete result[key];
    else result[key] = next;
    args.onChange(result as JSONValue);
  };
  return (
    <div className={cn(surfaceClass, 'grid grid-cols-2 gap-2')}>
      {COMPOSITE_FIELDS[type].map(field => <LabeledField key={field.key} label={field.label} stacked>{field.kind === 'select'
        ? <NativeSelect value={String(record[field.key] ?? field.options?.[0] ?? '')} options={field.options || []} onChange={(next) => update(field.key, next)} />
        : field.kind === 'boolean'
          ? <div className="flex h-8 items-center justify-end"><Switch size="sm" checked={Boolean(record[field.key])} onCheckedChange={(next) => update(field.key, next)} /></div>
          : <Input stepper={field.kind === 'number'} type={field.kind === 'number' ? 'number' : 'text'} value={record[field.key] === undefined ? '' : String(record[field.key])} placeholder="—" onChange={(event) => update(field.key, field.kind === 'number' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} />}</LabeledField>)}
    </div>
  );
}

function defaultControlValue(definition: ControlDefinition): JSONValue {
  if (definition.defaultValue !== undefined) return definition.defaultValue as JSONValue;
  if (definition.type === ControlType.Boolean) return false;
  if (definition.type === ControlType.Number) return 0;
  if (definition.type === ControlType.Enum) return definition.options[0] ?? null;
  if (definition.type === ControlType.Object) return Object.fromEntries(Object.entries(definition.controls).map(([name, control]) => [name, defaultControlValue(control)]));
  if (definition.type === ControlType.Array || definition.type === ControlType.Shadow || definition.type === ControlType.Slots) return [];
  return '';
}

function NestedField({ parentArgs, definition, value, onChange }: { parentArgs: PropertyControlRenderArgs; definition: ControlDefinition; value: JSONValue | undefined; onChange(value: JSONValue): void }) {
  const rendered = renderHtmlCodeComponentControl({ ...parentArgs, definition, value, onChange });
  return rendered === undefined ? <p className="rounded-lg border border-dashed border-border/60 p-2 text-[10px] text-muted-foreground">Configure este slot na árvore de layers.</p> : rendered;
}

function ObjectField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Object) return null;
  const value = (args.value && typeof args.value === 'object' && !Array.isArray(args.value) ? args.value : args.definition.defaultValue || {}) as Record<string, JSONValue>;
  return <div className={cn(surfaceClass, 'flex flex-col gap-3')}>{Object.entries(args.definition.controls).map(([name, definition]) => <LabeledField key={name} label={definition.title || name} stacked><NestedField parentArgs={{ ...args, name: `${args.name}.${name}` }} definition={definition} value={value[name] ?? defaultControlValue(definition)} onChange={(next) => args.onChange({ ...value, [name]: next })} /></LabeledField>)}</div>;
}

function ArrayField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Array) return null;
  const definition = args.definition;
  const values = Array.isArray(args.value) ? args.value : definition.defaultValue || [];
  const change = (next: JSONValue[]) => args.onChange(next);
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    change(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {values.map((value, index) => {
        const key = value && typeof value === 'object' && !Array.isArray(value) && 'id' in value ? String(value.id) : String(index);
        return <div key={key} className={cn(surfaceClass, 'flex flex-col gap-2')}><div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-foreground">Item {index + 1}</span><Button variant="ghost" size="icon-xs" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Mover item para cima"><ArrowUp /></Button><Button variant="ghost" size="icon-xs" onClick={() => move(index, 1)} disabled={index === values.length - 1} aria-label="Mover item para baixo"><ArrowDown /></Button><Button variant="ghost" size="icon-xs" onClick={() => change([...values.slice(0, index + 1), JSON.parse(JSON.stringify(value)), ...values.slice(index + 1)])} disabled={values.length >= (definition.maxCount ?? Infinity)} aria-label="Duplicar item"><Copy /></Button><Button variant="ghost" size="icon-xs" onClick={() => change(values.filter((_, itemIndex) => itemIndex !== index))} disabled={values.length <= (definition.minCount || 0)} aria-label="Remover item"><Trash2 /></Button></div><NestedField parentArgs={{ ...args, name: `${args.name}.${index}` }} definition={definition.control} value={value} onChange={(next) => change(values.map((item, itemIndex) => itemIndex === index ? next : item))} /></div>;
      })}
      <Button variant="outline" size="sm" className="w-full" onClick={() => change([...values, defaultControlValue(definition.control)])} disabled={values.length >= (definition.maxCount ?? Infinity)}><Plus />Adicionar item</Button>
    </div>
  );
}

function EnumField({ args }: { args: PropertyControlRenderArgs }) {
  if (args.definition.type !== ControlType.Enum) return null;
  const definition = args.definition;
  const value = args.value ?? definition.defaultValue ?? definition.options[0] ?? null;
  const findValue = (raw: string) => definition.options.find(option => JSON.stringify(option) === raw) ?? raw;
  if (definition.display === 'segmented' || definition.display === 'icon-grid' || definition.display === 'radio') {
    return <div className={cn(definition.display === 'icon-grid' ? 'grid grid-cols-2 gap-1.5' : 'grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-secondary p-1')}>{definition.options.map((option, index) => { const active = JSON.stringify(option) === JSON.stringify(value); return <button key={JSON.stringify(option)} type="button" data-active={active} className={cn('min-h-7 rounded-md px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground', active && 'bg-background text-foreground shadow-sm', definition.display === 'icon-grid' && 'border border-border/60 py-2')} onClick={() => args.onChange(option)}>{definition.optionIcons?.[index] && <span className="mr-1 opacity-70">{definition.optionIcons[index]}</span>}{definition.optionTitles?.[index] || String(option)}</button>; })}</div>;
  }
  return <NativeSelect value={JSON.stringify(value)} options={definition.options.map(option => JSON.stringify(option))} titles={definition.optionTitles || definition.options.map(String)} onChange={(raw) => args.onChange(findValue(raw) as JSONPrimitive)} />;
}

export function renderHtmlCodeComponentControl(args: PropertyControlRenderArgs): ReactNode | undefined {
  switch (args.definition.type) {
    case ControlType.String:
      return <Input value={String(args.value ?? '')} placeholder={args.definition.placeholder} maxLength={args.definition.maxLength} onChange={(event) => args.onChange(event.target.value)} />;
    case ControlType.Text:
      return <Textarea value={String(args.value ?? '')} placeholder={args.definition.placeholder} rows={args.definition.minRows || 3} maxLength={args.definition.maxLength} onChange={(event) => args.onChange(event.target.value)} />;
    case ControlType.Number:
      return <NumberField args={args} />;
    case ControlType.Boolean:
      return <Switch size="md" checked={Boolean(args.value)} onCheckedChange={(checked) => args.onChange(checked)} />;
    case ControlType.Enum:
      return <EnumField args={args} />;
    case ControlType.Color: {
      const definition = args.definition;
      const value = typeof args.value === 'string' ? args.value : args.value && typeof args.value === 'object' && !Array.isArray(args.value) ? String(args.value.value || '') : '';
      const update = (next: string) => args.onChange(codeComponentColorEditorValue(
        args.value,
        next,
        definition.allowAlpha !== false,
      ) as JSONValue);
      return <ColorPicker value={value} onChange={update} onImmediateChange={update} solidOnly={definition.gradients !== 'future'} onInteractionStart={args.beginTransaction} onInteractionEnd={args.commitTransaction} />;
    }
    case ControlType.Image:
      return <AssetField args={args} kind="image" />;
    case ControlType.File:
      return <AssetField args={args} kind="file" />;
    case ControlType.Link:
      return <LinkField args={args} />;
    case ControlType.Date: {
      const mode = args.definition.mode;
      return <Input type={mode === 'datetime' ? 'datetime-local' : 'date'} value={codeComponentDateInputValue(args.value, mode)} min={codeComponentDateInputValue(args.definition.min, mode) || undefined} max={codeComponentDateInputValue(args.definition.max, mode) || undefined} onChange={(event) => args.onChange(codeComponentDateValue(event.target.value, mode))} />;
    }
    case ControlType.Spacing:
      return <SpacingField args={args} />;
    case ControlType.Radius:
      return <RadiusField args={args} />;
    case ControlType.Border:
      return <BorderField args={args} />;
    case ControlType.Shadow:
      return <ShadowField args={args} />;
    case ControlType.Typography:
      return <CompositeField args={args} type="typography" />;
    case ControlType.Transform:
      return <CompositeField args={args} type="transform" />;
    case ControlType.Effects:
      return <CompositeField args={args} type="effects" />;
    case ControlType.Layout:
      return <LayoutField args={args} />;
    case ControlType.Object:
      return <ObjectField args={args} />;
    case ControlType.Array:
      return <ArrayField args={args} />;
    case ControlType.Slot:
    case ControlType.Slots:
      return undefined;
  }
}
