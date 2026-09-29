'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PropertyInspector } from '@coday/property-inspector';
import type { ComponentManifest } from '@coday/components';
import type { BreakpointDescriptor, ControlDefinition, JSONValue, ResponsiveValue } from '@coday/control-schema';
import type { AssetProvider } from '@coday/asset-bridge';
import type { CmsFieldDescriptor, DataBinding } from '@coday/cms-bridge';
import type { CodeComponentInstance, SlotReference } from '@coday/component-registry';
import { Code2, X } from '@/components/ui/gravity-icons';
import { useHtmlViewportStore } from '@/stores/useHtmlViewportStore';
import { renderHtmlCodeComponentControl } from './HtmlCodeComponentControlRenderer';

interface PendingBinding { property: string; control: ControlDefinition; resolve(value: { binding: DataBinding; field?: CmsFieldDescriptor } | null): void }
export interface HtmlCodeComponentControlsProps {
  manifest: ComponentManifest; instance: CodeComponentInstance; breakpoints: BreakpointDescriptor[];
  cmsSourceId?: string; cmsFields?: CmsFieldDescriptor[]; assetProvider?: AssetProvider;
  onPropChange(property: string, value: JSONValue): void;
  onResponsiveChange(property: string, value: ResponsiveValue<JSONValue>): void;
  onBindingChange(property: string, binding?: DataBinding): void;
  onSlotConnect(property: string, multiple: boolean): Promise<SlotReference | SlotReference[] | null>;
  onSlotNavigate(reference: SlotReference): void;
  onSlotChange(property: string, value?: SlotReference | SlotReference[]): void;
  history: { beginTransaction(label: string): void; commitTransaction(): void };
}

export function HtmlCodeComponentControls(props: HtmlCodeComponentControlsProps) {
  const breakpoint = useHtmlViewportStore(state => state.viewport);
  const [pending, setPending] = useState<PendingBinding | null>(null); const pendingRef = useRef(pending); pendingRef.current = pending;
  useEffect(() => () => pendingRef.current?.resolve(null), []);
  const requestBinding = (property: string, control: ControlDefinition) => new Promise<{ binding: DataBinding; field?: CmsFieldDescriptor } | null>(resolve => {
    pendingRef.current?.resolve(null);
    const next = { property, control, resolve };
    pendingRef.current = next;
    setPending(next);
  });
  const finish = (value: { binding: DataBinding; field?: CmsFieldDescriptor } | null) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  };
  return <section
    className="relative"
    style={{ '--primary': '#9fe47a', '--ring': '#9fe47a' } as CSSProperties}
  >
    <div className="flex items-center gap-2.5 border-b py-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#9fe47a]/20 bg-[#9fe47a]/10 text-[#a8e986]"><Code2 className="size-4" /></span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{props.manifest.displayName}</p>
        <p className="mt-0.5 text-[9px] uppercase tracking-[.12em] text-[#a8e986]/75">{props.manifest.version} · Code Component</p>
      </div>
    </div>
    <PropertyInspector
      schema={props.manifest.controls} values={props.instance.props} responsiveValues={props.instance.responsiveProps}
      bindings={props.instance.bindings as Record<string, DataBinding> | undefined} slots={props.instance.slots}
      breakpoint={breakpoint} breakpoints={props.breakpoints} assetProvider={props.assetProvider}
      onChange={props.onPropChange} onResponsiveChange={props.onResponsiveChange} onBindingChange={props.onBindingChange}
      onRequestBinding={requestBinding} onSlotConnect={props.onSlotConnect} onSlotNavigate={props.onSlotNavigate} onSlotChange={props.onSlotChange}
      history={props.history} renderControl={renderHtmlCodeComponentControl}
    />
    {pending && <div className="sticky bottom-2 z-20 mx-2 overflow-hidden rounded-[8px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)] shadow-[var(--kodety-shadow-popover)]">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--kodety-divider)] px-2.5"><div className="min-w-0"><p className="truncate text-[10px] font-semibold text-zinc-100">Conectar {pending.control.title || pending.property}</p><p className="text-[9px] text-zinc-500">Campo da coleção atual</p></div><button type="button" className="inline-flex size-7 items-center justify-center rounded-[5px] text-zinc-500 outline-none hover:text-white focus-visible:ring-1 focus-visible:ring-ring" aria-label="Fechar" title="Fechar" onClick={() => finish(null)}><X className="size-3.5" /></button></div>
      <div className="kodety-compact-scrollbar max-h-44 overflow-auto p-1">{props.cmsSourceId && props.cmsFields?.length ? props.cmsFields.map(field => <button key={field.id} type="button" className="flex min-h-8 w-full items-center justify-between gap-2 rounded-[5px] px-2 text-left text-[10px] text-zinc-300 outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => finish({ field, binding: { type: 'current-collection', sourceId: props.cmsSourceId!, fieldId: field.id, fallback: props.instance.props[pending.property] } })}><span className="truncate">{field.name}</span><span className="text-[8px] uppercase text-zinc-600">{field.type}</span></button>) : <p className="px-2 py-3 text-[10px] text-zinc-500">Selecione o componente dentro de uma coleção com campos disponíveis.</p>}</div>
    </div>}
  </section>;
}
