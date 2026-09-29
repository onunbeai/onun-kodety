'use client';

import React, { useMemo, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import {
  ControlType, evaluateCondition, getControlAdapter, resolveResponsiveValue, setResponsiveOverride,
  type BreakpointDescriptor, type CodayImage, type CodayLayout, type CodaySpacing, type ControlCategory,
  type ControlDefinition, type JSONValue, type ResponsiveValue, type ValidationIssue,
} from '@coday/control-schema';
import type { AssetProvider } from '@coday/asset-bridge';
import type { CmsFieldDescriptor, DataBinding } from '@coday/cms-bridge';
import { isFieldCompatible } from '@coday/cms-bridge';
import type { SlotReference } from '@coday/component-registry';
import {
  ArrowRotateLeft,
  ArrowUpRight,
  ChevronRight,
  Copy,
  Display,
  Frame,
  Grip,
  Link,
  Minus,
  Picture,
  Plus,
} from '@gravity-ui/icons';

const CATEGORIES: ControlCategory[] = ['Content', 'Layout', 'Style', 'Typography', 'Effects', 'Animation', 'Data', 'Events', 'Advanced'];
const STACKED_CONTROLS = new Set<ControlType>([
  ControlType.Text, ControlType.Image, ControlType.File, ControlType.Link,
  ControlType.Spacing, ControlType.Layout, ControlType.Radius, ControlType.Border,
  ControlType.Shadow, ControlType.Typography, ControlType.Transform, ControlType.Effects,
  ControlType.Object, ControlType.Array, ControlType.Slot, ControlType.Slots,
]);
function controlLayout(definition: ControlDefinition): 'inline' | 'stacked' {
  if (STACKED_CONTROLS.has(definition.type)) return 'stacked';
  if (definition.type === ControlType.Number && definition.display?.includes('slider')) return 'stacked';
  if (
    definition.type === ControlType.Enum
    && ['segmented', 'radio', 'icon-grid'].includes(definition.display || '')
  ) return 'stacked';
  return 'inline';
}
const css = `.cpi{--bg:#171719;--surface:#202023;--field:#28282c;--line:#35353a;--text:#f2f2f4;--muted:#9b9ba4;--accent:#9393FF;--accent-hover:#AFAFFF;--error:#ff6b78;background:var(--bg);color:var(--text);font:12px/1.35 Inter,ui-sans-serif,system-ui;width:100%;height:100%;overflow:auto}.cpi *{box-sizing:border-box}.cpi-search{padding:8px;position:sticky;top:0;background:var(--bg);z-index:3}.cpi input,.cpi select,.cpi textarea{width:100%;min-width:0;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:5px;padding:6px 7px;font:inherit;outline:none}.cpi input:focus,.cpi select:focus,.cpi textarea:focus{border-color:var(--accent)}.cpi button{color:inherit;font:inherit}.cpi-icon{border:0;background:transparent;padding:3px;color:var(--muted);cursor:pointer;line-height:1}.cpi-icon:hover,.cpi-icon:focus{color:var(--text)}.cpi-section{border-top:1px solid var(--line)}.cpi-section>summary{padding:9px 10px;font-weight:650;cursor:pointer;list-style:none}.cpi-row{padding:7px 10px;border-top:1px solid color-mix(in srgb,var(--line) 62%,transparent)}.cpi-rowhead{display:flex;align-items:center;gap:5px;margin-bottom:5px}.cpi-label{flex:1;color:#d7d7dc}.cpi-description{color:var(--muted)}.cpi-error{color:var(--error);font-size:11px;margin-top:4px}.cpi-inline{display:flex;align-items:center;gap:5px}.cpi-inline>*{flex:1}.cpi-segmented{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden}.cpi-segmented button{border:0;border-left:1px solid var(--line);background:transparent;padding:6px 4px}.cpi-segmented button:first-child{border-left:0}.cpi-segmented button[data-active=true]{background:var(--field);color:white}.cpi-array{border:1px solid var(--line);border-radius:6px;overflow:hidden}.cpi-card{padding:6px;border-top:1px solid var(--line)}.cpi-card:first-child{border-top:0}.cpi-thumb{width:48px;height:38px;object-fit:cover;border-radius:4px;background:var(--field)}.cpi-dot{width:6px;height:6px;border-radius:50%;background:var(--accent);display:inline-block}.cpi-muted{color:var(--muted)}.cpi-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}.cpi-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.cpi-check{display:flex;gap:6px;align-items:center}.cpi-check input{width:auto}.cpi-button{border:1px solid var(--line);border-radius:5px;background:transparent;padding:6px 8px;cursor:pointer}.cpi-button:hover{border-color:#55555d}.cpi-empty{padding:20px 12px;color:var(--muted);text-align:center}`;

const builderCss = `${css}
.cpi{--bg:transparent;--surface:var(--background,#202020);--field:var(--input,#262626);--line:var(--border,rgba(255,255,255,.05));--text:var(--foreground,#fafafa);--muted:var(--muted-foreground,#a1a1a1);--accent:var(--kodety-accent,var(--primary,#9393FF));--accent-hover:var(--kodety-accent-hover,#AFAFFF);--accent-muted:color-mix(in srgb,var(--accent) 14%,transparent);--accent-border:color-mix(in srgb,var(--accent) 28%,transparent);background:transparent;color:var(--text);font-family:inherit;font-size:12px;line-height:1.25;width:100%;height:auto;overflow:visible}
.cpi-search{position:relative;top:auto;z-index:auto;margin:0;padding:16px 0 20px;background:transparent;border-bottom:1px solid var(--line)}
.cpi-breakpoint{display:flex;align-items:center;gap:5px;margin-top:8px;color:var(--muted);font-size:10px;line-height:1}
.cpi-breakpoint:before{content:'';width:5px;height:5px;border-radius:50%;background:var(--accent-hover);box-shadow:0 0 0 3px var(--accent-muted)}
.cpi input,.cpi select,.cpi textarea{width:100%;min-width:0;min-height:32px;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:12px;font-weight:500;line-height:1.25;outline:none;transition:border-color .15s,color .15s}
.cpi select{appearance:none;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 13px) 13px,calc(100% - 9px) 13px;background-size:4px 4px,4px 4px;background-repeat:no-repeat;cursor:pointer}
.cpi select option{color:var(--text);background:var(--surface)}
.cpi textarea{min-height:72px;resize:vertical;line-height:1.45}
.cpi input:focus-visible,.cpi select:focus-visible,.cpi textarea:focus-visible{border-color:var(--ring,var(--accent));box-shadow:none}
.cpi input::placeholder,.cpi textarea::placeholder{color:var(--muted)}
.cpi input[type=search]::-webkit-search-cancel-button{opacity:.55}
.cpi input::-webkit-calendar-picker-indicator{filter:invert(1);opacity:.55;cursor:pointer}
.cpi input[type=number]{font-variant-numeric:tabular-nums}
.cpi input[type=number]::-webkit-inner-spin-button,.cpi input[type=number]::-webkit-outer-spin-button{appearance:none;margin:0}
.cpi input[type=range]{appearance:none;min-height:18px;height:18px;padding:7px 0;border:0;background:transparent}
.cpi input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:999px;background:color-mix(in srgb,var(--muted) 42%,transparent)}
.cpi input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5.5px;border:0;border-radius:50%;background:var(--accent);box-shadow:none}
.cpi input[type=checkbox]:not([role=switch]){appearance:none;width:16px;height:16px;min-height:16px;flex:0 0 16px;border:1px solid color-mix(in srgb,var(--muted) 55%,transparent);border-radius:4px;background:transparent;padding:0;cursor:pointer}
.cpi input[type=checkbox]:not([role=switch]):checked{border-color:var(--accent);background:var(--accent);box-shadow:inset 0 0 0 3px var(--surface)}
.cpi-section{border-top:1px solid var(--line)}
.cpi-section>summary{display:flex;align-items:center;min-height:52px;margin:0;padding:0;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;list-style:none;outline:none;user-select:none}
.cpi-section>summary::-webkit-details-marker{display:none}
.cpi-section-chevron{width:12px;height:12px;margin-right:8px;flex:0 0 12px;color:var(--muted);opacity:.65;transition:transform .15s}
.cpi-section[open]>summary>.cpi-section-chevron{transform:rotate(90deg)}
.cpi-section>summary:focus-visible{color:var(--text)}
.cpi-section[open]>.cpi-row:last-child{margin-bottom:20px}
.cpi-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:start;gap:8px;margin:0 0 8px;padding:0;border:0}
.cpi-row[data-layout=stacked]{grid-template-columns:minmax(0,1fr);gap:4px;margin-bottom:12px}
.cpi-rowhead{display:flex;align-items:center;min-width:0;min-height:32px;gap:5px;margin:0}
.cpi-rowbody{min-width:0}
.cpi-rowbody>fieldset{width:100%;min-width:0}
.cpi-row[data-control=boolean] .cpi-rowbody>fieldset{display:flex;align-items:center;justify-content:flex-end;min-height:32px}
.cpi-row-actions{display:inline-flex;align-items:center;gap:2px;margin-left:auto;flex:0 0 auto}
.cpi-label{min-width:0;overflow:hidden;color:var(--muted);font-size:12px;font-weight:500;line-height:1.2;text-overflow:ellipsis;white-space:nowrap}
.cpi-row[data-layout=stacked] .cpi-label,.cpi-section>summary{color:var(--text)}
.cpi-muted,.cpi-description{color:var(--muted);font-size:10px}
.cpi-description{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid color-mix(in srgb,var(--muted) 70%,transparent);border-radius:50%;font-size:9px;line-height:1;cursor:help}
.cpi-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;color:var(--muted);border:0;border-radius:0;background:transparent;cursor:pointer;line-height:1;opacity:.82}
.cpi-icon svg{width:13px;height:13px}
.cpi-icon:hover,.cpi-icon:focus-visible{color:var(--text);background:transparent;opacity:1;outline:none}
.cpi-inline{gap:8px}
.cpi-inline>*{min-width:0}
.cpi-segmented{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;height:32px;padding:3px;border:0;border-radius:8px;background:var(--field);gap:2px;overflow:hidden}
.cpi-segmented button{min-width:0;min-height:26px;padding:4px;border:0!important;border-radius:6px;background:transparent;color:var(--muted);font-size:11px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpi-segmented button[data-active=true]{background:var(--accent-muted);color:var(--accent-hover);box-shadow:inset 0 0 0 1px var(--accent-border)}
.cpi-number{display:flex;align-items:center;width:100%;height:32px;border:1px solid var(--line);border-radius:8px;background:transparent;overflow:hidden;transition:border-color .15s}
.cpi-number:focus-within{border-color:var(--ring,var(--accent))}
.cpi-number>input{height:30px;min-height:30px;border:0;border-radius:0;background:transparent;box-shadow:none!important}
.cpi-number>.cpi-unit{padding-right:8px;font-size:11px;white-space:nowrap}
.cpi-slider-line{display:flex;align-items:center;gap:8px}
.cpi-slider-line>input[type=range]{flex:1}
.cpi-slider-line>.cpi-number{flex:0 0 92px}
.cpi-grid4{gap:5px}.cpi-grid2{gap:8px}
.cpi-check{display:flex;gap:7px;align-items:center;min-height:32px;color:var(--muted);font-size:12px;font-weight:500}
.cpi-array{border:1px solid var(--line);border-radius:10px;background:color-mix(in srgb,var(--field) 35%,transparent);overflow:hidden}
.cpi-card{padding:8px;border-color:var(--line)}
.cpi-card .cpi-row{grid-template-columns:minmax(0,1fr);gap:4px}
.cpi-thumb{width:40px;height:32px;flex:0 0 40px;border-radius:7px;background:var(--field);object-fit:cover}
.cpi-dot{background:var(--accent-hover);box-shadow:0 0 0 3px var(--accent-muted)}
.cpi-button{min-height:32px;border:1px solid var(--line);border-radius:8px;background:transparent;padding:6px 9px;font-size:12px;font-weight:500;cursor:pointer}
.cpi-button:hover{border-color:color-mix(in srgb,var(--line) 72%,var(--text));background:transparent}
.cpi-native-switch{position:relative;width:32px;height:18px;flex:0 0 32px;border:1px solid transparent;border-radius:999px;background:var(--field);padding:0;cursor:pointer;transition:background-color .15s,border-color .15s}
.cpi-native-switch[data-checked=true]{background:var(--accent)}
.cpi-native-switch:focus-visible{border-color:var(--ring,var(--accent));outline:none}
.cpi-native-switch>span{position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--text);transition:transform .15s}
.cpi-native-switch[data-checked=true]>span{transform:translateX(14px);background:var(--primary-foreground,#fff)}
.cpi-color{display:flex;align-items:center;width:100%;height:32px;border:1px solid var(--line);border-radius:8px;background:transparent;overflow:hidden;transition:border-color .15s}
.cpi-color:focus-within{border-color:var(--ring,var(--accent))}
.cpi-color-swatch{position:relative;width:40px;height:32px;flex:0 0 40px;display:grid;place-items:center}
.cpi-color-swatch:before{content:'';position:absolute;width:20px;height:20px;border:1px solid color-mix(in srgb,var(--muted) 45%,transparent);border-radius:5px;background:var(--swatch,#000)}
.cpi-color-swatch>input{position:absolute;inset:0;width:100%;height:100%;padding:0;opacity:0;cursor:pointer}
.cpi-color>input[type=text]{height:30px;min-height:30px;border:0;border-radius:0;background:transparent;box-shadow:none!important}
.cpi-spacing{padding-top:4px}
.cpi-spacing-frame{position:relative;width:214px;height:196px;margin:0 auto 10px;border:1px dashed color-mix(in srgb,var(--muted) 55%,transparent);border-radius:12px}
.cpi-spacing-frame:before{content:'';position:absolute;inset:44px 42px;border:1px solid color-mix(in srgb,var(--muted) 55%,transparent);border-radius:10px}
.cpi-spacing-frame:after{content:'Padding';position:absolute;right:50px;bottom:49px;color:color-mix(in srgb,var(--muted) 65%,transparent);font-size:9px}
.cpi-spacing-center{position:absolute;left:calc(50% - 17px);top:calc(50% - 17px);width:34px;height:34px;border-radius:8px;background:var(--field)}
.cpi-spacing-input{position:absolute!important;width:42px!important;height:28px!important;min-height:28px!important;padding:0!important;border-color:transparent!important;background:transparent!important;text-align:center;font-variant-numeric:tabular-nums;z-index:2}
.cpi-spacing-input:hover,.cpi-spacing-input:focus{background:var(--field)!important}
.cpi-spacing-input[data-side=top]{left:calc(50% - 21px);top:30px}.cpi-spacing-input[data-side=right]{right:20px;top:calc(50% - 14px)}.cpi-spacing-input[data-side=bottom]{left:calc(50% - 21px);bottom:30px}.cpi-spacing-input[data-side=left]{left:20px;top:calc(50% - 14px)}
.cpi-spacing-tools{display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center}
.cpi-object-fields{display:flex;flex-direction:column;gap:8px}
.cpi-subrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);align-items:center;gap:8px}
.cpi-subrow>label{color:var(--muted);font-size:11px;font-weight:500;text-transform:capitalize}
.cpi-error{grid-column:2;margin-top:-3px;color:var(--destructive,#fb7185);font-size:10px}
.cpi-row[data-layout=stacked]>.cpi-error{grid-column:1}
.cpi fieldset:disabled{opacity:.55}
.cpi-empty{padding:24px 0;color:var(--muted);font-size:11px;text-align:center}
@media(max-width:340px){.cpi-row{grid-template-columns:minmax(0,42%) minmax(0,58%);gap:6px}.cpi-row-actions{gap:0}.cpi-icon{width:16px}.cpi-slider-line>.cpi-number{flex-basis:72px}}`;

function Icon({ name }: { name: 'reset' | 'bind' | 'responsive' | 'add' | 'remove' | 'drag' | 'slot' | 'asset' }) {
  const icons = {
    reset: ArrowRotateLeft,
    bind: Link,
    responsive: Display,
    add: Plus,
    remove: Minus,
    drag: Grip,
    slot: Frame,
    asset: Picture,
  };
  const Glyph = icons[name];
  return <Glyph aria-hidden width="14" height="14" focusable="false" />;
}
export function ControlPopover({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props}>{children}</div> }
export function ControlLabel({ children }: { children: ReactNode }) { return <span className="cpi-label">{children}</span> }
export function ControlDescription({ children }: { children: ReactNode }) { return <span className="cpi-description">{children}</span> }
export function ControlError({ issues }: { issues: ValidationIssue[] }) { return issues.length ? <div className="cpi-error" role="alert">{issues.map(issue => issue.message).join(' ')}</div> : null }
export function ControlResetButton({ onClick }: { onClick(): void }) { return <button className="cpi-icon" type="button" title="Restaurar valor" aria-label="Restaurar valor" onClick={onClick}><Icon name="reset" /></button> }
export function ControlBindingButton({ active, onClick }: { active: boolean; onClick(): void }) { return <button className="cpi-icon" type="button" title={active ? 'Editar conexão de dados' : 'Conectar dados'} aria-label={active ? 'Editar conexão de dados' : 'Conectar dados'} onClick={onClick} style={active ? { color: 'var(--accent)' } : undefined}><Icon name="bind" /></button> }
export function ControlResponsiveIndicator({ override, onClick }: { override: boolean; onClick(): void }) { return <button className="cpi-icon" type="button" title={override ? 'Este breakpoint possui override' : 'Herdado do breakpoint pai'} aria-label="Configuração responsiva" onClick={onClick} style={override ? { color: 'var(--accent)' } : undefined}><Icon name="responsive" /></button> }
export function ControlRow({ title, description, issues, actions, layout = 'inline', controlType, children }: { title: string; description?: string; issues?: ValidationIssue[]; actions?: ReactNode; layout?: 'inline' | 'stacked'; controlType?: ControlType; children: ReactNode }) { return <div className="cpi-row" data-layout={layout} data-control={controlType}><div className="cpi-rowhead"><ControlLabel>{title}</ControlLabel>{description && <ControlDescription><span title={description}>i</span></ControlDescription>}{actions && <span className="cpi-row-actions">{actions}</span>}</div><div className="cpi-rowbody">{children}</div><ControlError issues={issues || []} /></div> }
export function ControlSection({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) { return <details className="cpi-section" open={open}><summary><ChevronRight className="cpi-section-chevron" aria-hidden />{title}</summary>{children}</details> }
export function ControlSegmented({ options, titles, value, onChange }: { options: JSONValue[]; titles?: string[]; value: JSONValue; onChange(value: JSONValue): void }) { return <div className="cpi-segmented">{options.map((option, index) => <button type="button" key={JSON.stringify(option)} data-active={JSON.stringify(option) === JSON.stringify(value)} onClick={() => onChange(option)}>{titles?.[index] || String(option)}</button>)}</div> }
export function ControlSlider({ value, definition, onChange, onBegin, onCommit }: { value: number; definition: Extract<ControlDefinition, { type: ControlType.Number }>; onChange(value: number): void; onBegin(): void; onCommit(): void }) { return <div className="cpi-slider-line"><input aria-label={definition.title || 'Valor'} type="range" value={value} min={definition.min} max={definition.max} step={definition.step} onPointerDown={onBegin} onPointerUp={onCommit} onChange={event => onChange(Number(event.target.value))} /><ControlNumberInput value={value} definition={definition} onChange={onChange} onBegin={onBegin} onCommit={onCommit} /></div> }
export function ControlNumberInput({ value, definition, onChange, onBegin, onCommit }: { value: number; definition: Extract<ControlDefinition, { type: ControlType.Number }>; onChange(value: number): void; onBegin(): void; onCommit(): void }) {
  const start = useRef<{ x: number; value: number } | undefined>(undefined);
  return <div className="cpi-number"><input type="number" value={Number.isFinite(value) ? value : 0} min={definition.min} max={definition.max} step={definition.step} onChange={event => onChange(Number(event.target.value))} onFocus={onBegin} onBlur={onCommit} onPointerDown={event => { if (event.altKey) { start.current = { x: event.clientX, value }; event.currentTarget.setPointerCapture(event.pointerId); onBegin(); } }} onPointerMove={event => { if (start.current && event.currentTarget.hasPointerCapture(event.pointerId)) onChange(start.current.value + (event.clientX - start.current.x) * (definition.step || 1)); }} onPointerUp={() => { if (start.current) { start.current = undefined; onCommit(); } }} />{definition.unit && <span className="cpi-muted cpi-unit">{definition.unit}</span>}</div>;
}

export function ControlAssetPicker({ value, kind, provider, onChange }: { value?: CodayImage | JSONValue; kind: 'image' | 'file'; provider?: AssetProvider; onChange(value: JSONValue): void }) {
  const image = value && typeof value === 'object' && !Array.isArray(value) && 'src' in value ? value as CodayImage : undefined;
  const pick = async () => { const asset = kind === 'image' ? await provider?.selectImage() : await provider?.selectFile(); if (asset) onChange(asset as unknown as JSONValue) };
  return <div className="cpi-inline">{image && <img className="cpi-thumb" src={image.src} alt={image.alt || ''} />}<button className="cpi-button" type="button" onClick={pick} disabled={!provider}>{value ? 'Substituir' : 'Selecionar'}</button>{value != null && <button className="cpi-icon" type="button" title="Remover asset" aria-label="Remover asset" onClick={() => onChange(null)}><Icon name="remove" /></button>}</div>;
}

function SpacingEditor({ value, onChange }: { value: CodaySpacing; onChange(value: CodaySpacing): void }) {
  const update = (key: keyof CodaySpacing, next: number | boolean | string) => { const patch = { ...value, [key]: next }; if (value.linked && ['top', 'right', 'bottom', 'left'].includes(key)) Object.assign(patch, { top: next, right: next, bottom: next, left: next }); onChange(patch as CodaySpacing) };
  return <div className="cpi-spacing"><div className="cpi-spacing-frame"><div className="cpi-spacing-center" />{(['top', 'right', 'bottom', 'left'] as const).map(key => <input className="cpi-spacing-input" data-side={key} key={key} aria-label={`Padding ${key}`} type="number" value={value[key]} onChange={event => update(key, Number(event.target.value))} />)}</div><div className="cpi-spacing-tools"><select aria-label="Unidade" value={value.unit} onChange={event => update('unit', event.target.value)}>{['px', 'rem', 'em', '%', 'vw', 'vh'].map(unit => <option key={unit}>{unit}</option>)}</select><label className="cpi-check"><input type="checkbox" checked={value.linked} onChange={event => update('linked', event.target.checked)} />Vincular lados</label></div></div>;
}

function LayoutEditor({ value, onChange }: { value: CodayLayout; onChange(value: CodayLayout): void }) {
  const update = (patch: Partial<CodayLayout>) => onChange({ ...value, ...patch }); const diagonal = value.diagonal || { angle: 20, itemOffset: 12, direction: 'forward' as const, origin: 'start' as const, alignment: 'center' as const, rotateItems: false };
  return <><ControlSegmented options={['stack', 'grid', 'free', 'diagonal']} titles={['Stack', 'Grid', 'Free', 'Diagonal']} value={value.mode} onChange={mode => update({ mode: mode as CodayLayout['mode'] })} />
    {value.mode === 'stack' && <div className="cpi-grid2" style={{ marginTop: 5 }}><select value={value.direction || 'vertical'} onChange={event => update({ direction: event.target.value as CodayLayout['direction'] })}><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select><input type="number" aria-label="Gap" value={value.gap || 0} onChange={event => update({ gap: Number(event.target.value) })} /><select value={value.align || 'stretch'} onChange={event => update({ align: event.target.value as CodayLayout['align'] })}>{['start', 'center', 'end', 'stretch'].map(item => <option key={item}>{item}</option>)}</select><select value={value.justify || 'start'} onChange={event => update({ justify: event.target.value as CodayLayout['justify'] })}>{['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'].map(item => <option key={item}>{item}</option>)}</select><label className="cpi-check"><input type="checkbox" checked={Boolean(value.wrap)} onChange={event => update({ wrap: event.target.checked })} />Wrap</label></div>}
    {value.mode === 'grid' && <div className="cpi-grid2" style={{ marginTop: 5 }}><input type="number" aria-label="Colunas" value={value.columns || 1} min={1} onChange={event => update({ columns: Number(event.target.value) })} /><input type="number" aria-label="Largura mínima" value={value.minColumnWidth || 0} onChange={event => update({ minColumnWidth: Number(event.target.value) })} /><input type="number" aria-label="Gap horizontal" value={value.columnGap ?? value.gap ?? 0} onChange={event => update({ columnGap: Number(event.target.value) })} /><input type="number" aria-label="Gap vertical" value={value.rowGap ?? value.gap ?? 0} onChange={event => update({ rowGap: Number(event.target.value) })} /></div>}
    {value.mode === 'free' && <p className="cpi-muted">Os filhos usam posicionamento individual no canvas.</p>}
    {value.mode === 'diagonal' && <div className="cpi-grid2" style={{ marginTop: 5 }}><input type="number" aria-label="Ângulo" value={diagonal.angle} onChange={event => update({ diagonal: { ...diagonal, angle: Number(event.target.value) } })} /><input type="number" aria-label="Distância" value={diagonal.itemOffset} onChange={event => update({ diagonal: { ...diagonal, itemOffset: Number(event.target.value) } })} /><select value={diagonal.direction} onChange={event => update({ diagonal: { ...diagonal, direction: event.target.value as 'forward' | 'reverse' } })}><option value="forward">Avançar</option><option value="reverse">Reverter</option></select><select value={diagonal.origin} onChange={event => update({ diagonal: { ...diagonal, origin: event.target.value as 'start' | 'center' | 'end' } })}>{['start', 'center', 'end'].map(item => <option key={item}>{item}</option>)}</select><select value={diagonal.alignment} onChange={event => update({ diagonal: { ...diagonal, alignment: event.target.value as 'start' | 'center' | 'end' } })}>{['start', 'center', 'end'].map(item => <option key={item}>{item}</option>)}</select><label className="cpi-check"><input type="checkbox" checked={diagonal.rotateItems} onChange={event => update({ diagonal: { ...diagonal, rotateItems: event.target.checked } })} />Rotacionar itens</label></div>}</>;
}

function ObjectFields({ value, onChange }: { value: Record<string, JSONValue>; onChange(value: Record<string, JSONValue>): void }) { return <div className="cpi-object-fields">{Object.entries(value).map(([key, entry]) => typeof entry === 'number' ? <div className="cpi-subrow" key={key}><label>{key}</label><input aria-label={key} type="number" value={entry} onChange={event => onChange({ ...value, [key]: Number(event.target.value) })} /></div> : typeof entry === 'boolean' ? <div className="cpi-subrow" key={key}><label>{key}</label><label className="cpi-check"><input type="checkbox" checked={entry} onChange={event => onChange({ ...value, [key]: event.target.checked })} />Ativo</label></div> : typeof entry === 'string' ? <div className="cpi-subrow" key={key}><label>{key}</label><input aria-label={key} value={entry} onChange={event => onChange({ ...value, [key]: event.target.value })} /></div> : null)}</div> }

export interface ControlArrayEditorProps { values: JSONValue[]; definition: Extract<ControlDefinition, { type: ControlType.Array }>; onChange(values: JSONValue[]): void; renderItem(value: JSONValue, index: number, onChange: (value: JSONValue) => void): ReactNode }
export function ControlArrayEditor({ values, definition, onChange, renderItem }: ControlArrayEditorProps) {
  const move = (from: number, to: number) => { const next = [...values]; const [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next) };
  const drop = (event: DragEvent, to: number) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('coday/array-index')); if (Number.isInteger(from)) move(from, to) };
  return <div className="cpi-array">{values.map((value, index) => <div className="cpi-card" key={(value && typeof value === 'object' && !Array.isArray(value) && String(value.id || '')) || index} draggable onDragStart={event => event.dataTransfer.setData('coday/array-index', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, index)}><div className="cpi-rowhead"><span className="cpi-icon"><Icon name="drag" /></span><strong className="cpi-label">Item {index + 1}</strong><button className="cpi-icon" type="button" title="Duplicar item" aria-label="Duplicar item" disabled={values.length >= (definition.maxCount ?? Infinity)} onClick={() => onChange([...values.slice(0, index + 1), JSON.parse(JSON.stringify(value)), ...values.slice(index + 1)])}><Copy aria-hidden width="14" height="14" /></button><button className="cpi-icon" type="button" title="Remover item" aria-label="Remover item" disabled={values.length <= (definition.minCount || 0)} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}><Icon name="remove" /></button></div>{renderItem(value, index, next => onChange(values.map((item, itemIndex) => itemIndex === index ? next : item)))}</div>)}<button className="cpi-button" style={{ margin: 6 }} type="button" disabled={values.length >= (definition.maxCount ?? Infinity)} onClick={() => onChange([...values, (definition.control.defaultValue ?? (definition.control.type === ControlType.Object ? {} : '')) as JSONValue])}>Adicionar item</button></div>;
}

export function ControlSlotConnector({ value, multiple, onConnect, onNavigate, onChange }: { value?: SlotReference | SlotReference[]; multiple: boolean; onConnect?: () => Promise<SlotReference | SlotReference[] | null>; onNavigate?: (reference: SlotReference) => void; onChange(value: SlotReference | SlotReference[] | undefined): void }) {
  const values = !value ? [] : Array.isArray(value) ? value : [value]; return <div>{values.map(reference => <div className="cpi-inline" key={`${reference.instanceId}:${reference.layerId}`}><span>{reference.layerId}</span><button className="cpi-icon" type="button" title="Ir para camada" aria-label="Ir para camada" onClick={() => onNavigate?.(reference)}><ArrowUpRight aria-hidden width="14" height="14" /></button><button className="cpi-icon" type="button" title="Desconectar" aria-label="Desconectar" onClick={() => { const next = values.filter(item => item !== reference); onChange(multiple ? next : undefined) }}><Icon name="remove" /></button></div>)}<button className="cpi-button" type="button" onClick={async () => { const next = await onConnect?.(); if (next) onChange(next) }}><span className="cpi-inline"><Icon name="slot" />Conectar camada</span></button></div>;
}

export interface PropertyControlRenderArgs {
  name: string;
  definition: ControlDefinition;
  value: JSONValue | undefined;
  onChange(value: JSONValue): void;
  beginTransaction(): void;
  commitTransaction(): void;
  assetProvider?: AssetProvider;
}

export type PropertyControlRenderer = (args: PropertyControlRenderArgs) => ReactNode | undefined;

interface RenderContext {
  allValues: Record<string, JSONValue>; assetProvider?: AssetProvider; breakpoint: string; breakpoints: BreakpointDescriptor[];
  bindings?: Record<string, DataBinding>; slots?: Record<string, SlotReference | SlotReference[]>;
  onRequestBinding?: (property: string, control: ControlDefinition) => Promise<{ binding: DataBinding; field?: CmsFieldDescriptor } | null>;
  onBindingChange?: (property: string, binding?: DataBinding) => void; onSlotConnect?: (property: string, multiple: boolean) => Promise<SlotReference | SlotReference[] | null>;
  onSlotNavigate?: (reference: SlotReference) => void; onSlotChange?: (property: string, value?: SlotReference | SlotReference[]) => void;
  beginTransaction?: (label: string) => void; commitTransaction?: () => void;
  hasResponsiveOverride?: (property: string) => boolean;
  resetResponsiveOverride?: (property: string) => void;
  renderControl?: PropertyControlRenderer;
}

function PrimitiveControl({ name, definition, value, onChange, context }: { name: string; definition: ControlDefinition; value: JSONValue | undefined; onChange(value: JSONValue): void; context: RenderContext }) {
  const begin = () => context.beginTransaction?.(`Alterar ${definition.title || name}`); const commit = () => context.commitTransaction?.();
  const rendered = context.renderControl?.({ name, definition, value, onChange, beginTransaction: begin, commitTransaction: commit, assetProvider: context.assetProvider });
  if (rendered !== undefined) return rendered;
  switch (definition.type) {
    case ControlType.String: return <input value={String(value ?? '')} placeholder={definition.placeholder} maxLength={definition.maxLength} onChange={event => onChange(event.target.value)} />;
    case ControlType.Text: return <textarea value={String(value ?? '')} placeholder={definition.placeholder} rows={definition.minRows || 3} maxLength={definition.maxLength} onChange={event => onChange(event.target.value)} />;
    case ControlType.Number: return definition.display?.includes('slider') ? <ControlSlider value={Number(value ?? 0)} definition={definition} onChange={next => onChange(next)} onBegin={begin} onCommit={commit} /> : <ControlNumberInput value={Number(value ?? 0)} definition={definition} onChange={next => onChange(next)} onBegin={begin} onCommit={commit} />;
    case ControlType.Boolean: return <button type="button" role="switch" aria-checked={Boolean(value)} aria-label={definition.title || name} title={Boolean(value) ? definition.enabledTitle : definition.disabledTitle} className="cpi-native-switch" data-checked={Boolean(value)} onClick={() => onChange(!Boolean(value))}><span /></button>;
    case ControlType.Enum: return definition.display === 'segmented' || definition.display === 'icon-grid' ? <ControlSegmented options={definition.options} titles={definition.optionTitles} value={value ?? null} onChange={onChange} /> : <select value={String(value ?? '')} onChange={event => { const option = definition.options.find(item => String(item) === event.target.value); onChange(option ?? event.target.value) }}>{definition.options.map((option, index) => <option key={String(option)} value={String(option)}>{definition.optionTitles?.[index] || String(option)}</option>)}</select>;
    case ControlType.Color: { const raw = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? String(value.value || '#000000') : '#000000'; const swatch = raw.startsWith('#') ? raw.slice(0, 7) : '#000000'; return <div className="cpi-color"><label className="cpi-color-swatch" style={{ '--swatch': swatch } as React.CSSProperties}><input aria-label="Selecionar cor" type="color" value={swatch} onChange={event => onChange(event.target.value)} /></label><input aria-label={definition.title || name} type="text" value={raw} onChange={event => onChange(event.target.value)} /></div>; }
    case ControlType.Image: return <ControlAssetPicker value={value} kind="image" provider={context.assetProvider} onChange={onChange} />;
    case ControlType.File: return <ControlAssetPicker value={value} kind="file" provider={context.assetProvider} onChange={onChange} />;
    case ControlType.Link: { const link = (value && typeof value === 'object' && !Array.isArray(value) ? value : { type: 'url', value: '' }) as Record<string, JSONValue>; return <div className="cpi-inline"><select value={String(link.type)} onChange={event => onChange({ ...link, type: event.target.value })}>{(definition.allowedTypes || ['url', 'page', 'section', 'email', 'phone', 'file']).map(type => <option key={type}>{type}</option>)}</select><input value={String(link.value || '')} onChange={event => onChange({ ...link, value: event.target.value })} /></div>; }
    case ControlType.Date: return <input type={definition.mode === 'datetime' ? 'datetime-local' : 'date'} value={String(value ?? '')} min={definition.min} max={definition.max} onChange={event => onChange(event.target.value)} />;
    case ControlType.Spacing: return <SpacingEditor value={(value || definition.defaultValue || { top: 0, right: 0, bottom: 0, left: 0, unit: 'px', linked: true }) as CodaySpacing} onChange={next => onChange(next as unknown as JSONValue)} />;
    case ControlType.Layout: return <LayoutEditor value={(value || definition.defaultValue || { mode: 'stack', direction: 'vertical' }) as CodayLayout} onChange={next => onChange(next as unknown as JSONValue)} />;
    case ControlType.Radius: case ControlType.Border: case ControlType.Typography: case ControlType.Transform: case ControlType.Effects: return <ObjectFields value={(value && typeof value === 'object' && !Array.isArray(value) ? value : definition.defaultValue || {}) as Record<string, JSONValue>} onChange={onChange} />;
    case ControlType.Shadow: { const array = Array.isArray(value) ? value : []; return <ControlArrayEditor values={array} definition={{ type: ControlType.Array, control: { type: ControlType.Object, controls: {} } }} onChange={onChange} renderItem={(item, _index, change) => <ObjectFields value={item as Record<string, JSONValue>} onChange={change} />} />; }
    case ControlType.Object: { const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JSONValue> : {}; return <div className="cpi-array">{Object.entries(definition.controls).map(([childName, child]) => <ControlRenderer key={childName} name={`${name}.${childName}`} definition={child} value={object[childName] ?? child.defaultValue as JSONValue} onChange={next => onChange({ ...object, [childName]: next })} context={{ ...context, allValues: { ...context.allValues, [name]: object } }} />)}</div>; }
    case ControlType.Array: { const values = Array.isArray(value) ? value : []; return <ControlArrayEditor values={values} definition={definition} onChange={onChange} renderItem={(item, index, change) => <PrimitiveControl name={`${name}.${index}`} definition={definition.control} value={item} onChange={change} context={context} />} />; }
    case ControlType.Slot: case ControlType.Slots: return <ControlSlotConnector value={context.slots?.[name]} multiple={definition.type === ControlType.Slots} onConnect={() => context.onSlotConnect?.(name, definition.type === ControlType.Slots) || Promise.resolve(null)} onNavigate={context.onSlotNavigate} onChange={next => context.onSlotChange?.(name, next)} />;
  }
}

function ControlRenderer({ name, definition, value, onChange, context }: { name: string; definition: ControlDefinition; value: JSONValue | undefined; onChange(value: JSONValue): void; context: RenderContext }) {
  if (evaluateCondition(definition.hidden, context.allValues)) return null;
  const actual = value ?? definition.defaultValue as JSONValue; const validation = actual === undefined ? { issues: [] } : getControlAdapter(definition.type).validate(actual, definition, name);
  const changed = definition.defaultValue !== undefined && JSON.stringify(actual) !== JSON.stringify(definition.defaultValue); const binding = context.bindings?.[name];
  const responsiveOverride = Boolean(definition.responsive && context.hasResponsiveOverride?.(name));
  const canManageBinding = binding
    ? Boolean(context.onBindingChange)
    : definition.bindable === true && Boolean(context.onRequestBinding);
  const actions = <>{definition.responsive && <ControlResponsiveIndicator override={responsiveOverride} onClick={() => { if (responsiveOverride) context.resetResponsiveOverride?.(name) }} />}{canManageBinding && <ControlBindingButton active={Boolean(binding)} onClick={async () => { if (binding) { context.onBindingChange?.(name, undefined); return; } const result = await context.onRequestBinding?.(name, definition); if (result?.binding && (!result.field || isFieldCompatible(definition, result.field))) context.onBindingChange?.(name, result.binding); }} />}{changed && <ControlResetButton onClick={() => onChange(definition.defaultValue as JSONValue)} />}</>;
  const control = <fieldset disabled={evaluateCondition(definition.disabled, context.allValues) || Boolean(binding)} style={{ border: 0, padding: 0, margin: 0 }}><PrimitiveControl name={name} definition={definition} value={actual} onChange={onChange} context={context} /></fieldset>;
  const metadata = <>{definition.responsive && !responsiveOverride && <div className="cpi-muted" style={{ marginTop: 4 }}>Herdado</div>}{binding && <div className="cpi-muted" style={{ marginTop: 4 }}>Conectado a {binding.sourceId}{binding.fieldId ? ` · ${binding.fieldId}` : ''}</div>}</>;
  return <ControlRow title={definition.title || name.split('.').at(-1) || name} description={definition.description} issues={validation.issues} actions={actions} layout={controlLayout(definition)} controlType={definition.type}>{control}{metadata}</ControlRow>;
}

export interface PropertyInspectorProps {
  schema: Record<string, ControlDefinition>; values: Record<string, JSONValue>; breakpoint: string; breakpoints?: BreakpointDescriptor[];
  responsiveValues?: Record<string, ResponsiveValue<JSONValue>>; bindings?: Record<string, DataBinding>; slots?: Record<string, SlotReference | SlotReference[]>;
  assetProvider?: AssetProvider; onChange(property: string, value: JSONValue, options?: { breakpoint?: string; continuous?: boolean }): void;
  onResponsiveChange?: (property: string, value: ResponsiveValue<JSONValue>) => void;
  onBindingChange?: (property: string, binding?: DataBinding) => void; onRequestBinding?: RenderContext['onRequestBinding'];
  onSlotConnect?: RenderContext['onSlotConnect']; onSlotNavigate?: RenderContext['onSlotNavigate']; onSlotChange?: RenderContext['onSlotChange'];
  history?: { beginTransaction(label: string): void; commitTransaction(): void }; renderControl?: PropertyControlRenderer; className?: string;
}

export function PropertyInspector(props: PropertyInspectorProps) {
  const [search, setSearch] = useState(''); const breakpointList = props.breakpoints || [];
  const baseBreakpoint = breakpointList.find(item => !item.parentId)?.id || breakpointList[0]?.id || 'primary';
  const resolved = useMemo(() => Object.fromEntries(Object.entries(props.schema).map(([key, definition]) => {
    const responsive = props.responsiveValues?.[key]; return [key, definition.responsive && responsive ? resolveResponsiveValue(responsive, props.breakpoint, breakpointList) : props.values[key] ?? definition.defaultValue as JSONValue];
  })), [props.schema, props.values, props.responsiveValues, props.breakpoint, breakpointList]);
  const grouped = useMemo(() => {
    const result = new Map<ControlCategory, Array<[string, ControlDefinition]>>(); CATEGORIES.forEach(category => result.set(category, []));
    Object.entries(props.schema).filter(([name, definition]) => !search || `${name} ${definition.title || ''} ${definition.description || ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (a[1].order || 0) - (b[1].order || 0)).forEach(entry => result.get(entry[1].category || 'Content')?.push(entry)); return result;
  }, [props.schema, search]);
  const context: RenderContext = { allValues: resolved, assetProvider: props.assetProvider, breakpoint: props.breakpoint, breakpoints: breakpointList, bindings: props.bindings, slots: props.slots, onRequestBinding: props.onRequestBinding, onBindingChange: props.onBindingChange, onSlotConnect: props.onSlotConnect, onSlotNavigate: props.onSlotNavigate, onSlotChange: props.onSlotChange, beginTransaction: label => props.history?.beginTransaction(label), commitTransaction: () => props.history?.commitTransaction(), hasResponsiveOverride: name => props.breakpoint !== baseBreakpoint && props.responsiveValues?.[name]?.overrides?.[props.breakpoint] !== undefined, resetResponsiveOverride: name => { const current = props.responsiveValues?.[name]; if (current) props.onResponsiveChange?.(name, setResponsiveOverride(current, props.breakpoint, undefined)) }, renderControl: props.renderControl };
  const change = (name: string, definition: ControlDefinition, value: JSONValue) => {
    if (definition.responsive && props.onResponsiveChange) {
      const current = props.responsiveValues?.[name] || { base: (props.values[name] ?? definition.defaultValue ?? null) as JSONValue };
      props.onResponsiveChange(name, props.breakpoint === baseBreakpoint ? { ...current, base: value } : setResponsiveOverride(current, props.breakpoint, value));
      return;
    }
    props.onChange(name, value, { breakpoint: props.breakpoint });
  };
  return <aside className={`cpi ${props.className || ''}`} aria-label="Propriedades do Code Component"><style>{builderCss}</style><div className="cpi-search"><input type="search" value={search} placeholder="Buscar propriedades" aria-label="Buscar propriedades" onChange={event => setSearch(event.target.value)} /><div className="cpi-breakpoint">Breakpoint · {props.breakpoint}</div></div>{CATEGORIES.map(category => { const items = grouped.get(category) || []; return items.length ? <ControlSection key={category} title={category}>{items.map(([name, definition]) => <ControlRenderer key={name} name={name} definition={definition} value={resolved[name]} onChange={value => change(name, definition, value)} context={context} />)}</ControlSection> : null })}{![...grouped.values()].some(items => items.length) && <div className="cpi-empty">Nenhuma propriedade encontrada.</div>}</aside>;
}
