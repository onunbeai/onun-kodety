'use client';

import React, { Component, createElement, useEffect, useMemo, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { ControlType, getControlAdapter, resolveResponsiveValue, type BreakpointDescriptor, type ControlDefinition, type JSONValue } from '@coday/control-schema';
import type { ComponentManifest } from '@coday/components';
import type { CodeComponentInstance, SlotReference } from '@coday/component-registry';
import { resolveBindings, type CmsContext, type CmsProvider, type DataBinding } from '@coday/cms-bridge';
import { observeComponentSize, type CanvasBridge } from '@coday/canvas-bridge';

export interface RuntimeComponent { component: ComponentType<any>; manifest: ComponentManifest }
export interface RuntimeRegistration extends RuntimeComponent { readonly registrationRevision: number }
export class RuntimeRegistry {
  private components = new Map<string, RuntimeRegistration>();
  private nextRegistrationRevision = 1;
  register(component: RuntimeComponent) {
    const registration: RuntimeRegistration = {
      ...component,
      registrationRevision: this.nextRegistrationRevision++,
    };
    this.components.set(`${component.manifest.id}@${component.manifest.version}`, registration);
    return registration;
  }
  get(id: string, version: string) { return this.components.get(`${id}@${version}`) }
  remove(id: string, version: string) { return this.components.delete(`${id}@${version}`) }
}

export interface ComponentErrorBoundaryProps {
  instanceId: string;
  registrationIdentity?: unknown;
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}
interface BoundaryState { error?: Error }
export class ComponentErrorBoundary extends Component<ComponentErrorBoundaryProps, BoundaryState> {
  state: BoundaryState = {};
  static getDerivedStateFromError(error: Error): BoundaryState { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError?.(error, info) }
  componentDidUpdate(previous: ComponentErrorBoundaryProps) {
    if (
      this.state.error
      && (
        previous.instanceId !== this.props.instanceId
        || previous.registrationIdentity !== this.props.registrationIdentity
      )
    ) this.setState({ error: undefined });
  }
  render() { return this.state.error ? this.props.fallback ?? <div role="alert" data-coday-component-error>{this.state.error.message}</div> : this.props.children }
}

export interface SlotRenderer { render(reference: SlotReference, ancestry: string[]): ReactNode; validate(reference: SlotReference, ancestry: string[]): boolean }
export interface RuntimeHostProps {
  instance: CodeComponentInstance; registry: RuntimeRegistry; breakpoints: BreakpointDescriptor[]; activeBreakpoint: string;
  cms?: { provider: CmsProvider; context: CmsContext }; slots?: SlotRenderer; canvasBridge?: CanvasBridge;
  selected?: boolean; fallback?: ReactNode; onEvent?: (name: string, payload: JSONValue) => void;
}

function validateRuntimeProps(controls: Record<string, ControlDefinition>, values: Record<string, JSONValue>) {
  return Object.entries(controls).flatMap(([key, definition]) => {
    const value = values[key] ?? definition.defaultValue;
    if (value === undefined) return [];
    return getControlAdapter(definition.type).validate(value, definition, key).issues;
  });
}

function slotProps(instance: CodeComponentInstance, renderer: SlotRenderer | undefined, ancestry: string[]) {
  if (!renderer || !instance.slots) return {};
  return Object.fromEntries(Object.entries(instance.slots).map(([name, references]) => {
    const list = Array.isArray(references) ? references : [references];
    const rendered = list.filter(reference => renderer.validate(reference, ancestry)).map(reference => renderer.render(reference, ancestry));
    return [name, Array.isArray(references) ? rendered : rendered[0] ?? null];
  }));
}

export function ComponentHost({ instance, registry, breakpoints, activeBreakpoint, cms, slots, canvasBridge, selected = false, fallback, onEvent }: RuntimeHostProps) {
  const root = useRef<HTMLDivElement>(null); const registered = registry.get(instance.componentId, instance.componentVersion);
  const responsive = useMemo(() => Object.fromEntries(Object.entries(instance.responsiveProps || {}).map(([key, value]) => [key, resolveResponsiveValue(value, activeBreakpoint, breakpoints)])), [instance.responsiveProps, activeBreakpoint, breakpoints]);
  const [bound, setBound] = useState<Record<string, JSONValue>>({}); const [bindingErrors, setBindingErrors] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    if (!registered) return () => controller.abort();
    resolveBindings({ ...registered.manifest.defaultProps, ...instance.props, ...responsive }, instance.bindings as Record<string, DataBinding> | undefined, registered.manifest.controls, cms?.provider, cms?.context || {}, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setBound(result.values); setBindingErrors(result.errors); } });
    return () => controller.abort();
  }, [registered, instance.props, instance.bindings, responsive, cms]);
  useEffect(() => root.current ? observeComponentSize(root.current, (size, box) => canvasBridge?.send('resize', { instanceId: instance.id, size, box })) : undefined, [canvasBridge, instance.id]);
  useEffect(() => { canvasBridge?.send('state', { instanceId: instance.id, selected, loading: !registered, breakpoint: activeBreakpoint }) }, [canvasBridge, instance.id, selected, registered, activeBreakpoint]);
  if (!registered) return <div ref={root} data-coday-component-missing>{fallback || `Componente ${instance.componentId}@${instance.componentVersion} indisponível.`}</div>;
  const issues = validateRuntimeProps(registered.manifest.controls, bound);
  const props = {
    ...bound, ...slotProps(instance, slots, [instance.id]), instanceId: instance.id, breakpoint: activeBreakpoint,
    emit: (name: string, payload: JSONValue) => { canvasBridge?.send('event', { instanceId: instance.id, name, payload }); onEvent?.(name, payload) },
  };
  return <div ref={root} data-coday-code-component={instance.componentId} data-coday-component-instance={instance.id} data-coday-invalid={issues.length || bindingErrors.length ? 'true' : undefined}>
    <ComponentErrorBoundary instanceId={instance.id} registrationIdentity={registered} fallback={fallback} onError={(error, info) => canvasBridge?.send('error', { instanceId: instance.id, message: error.message, stack: info.componentStack || error.stack, recoverable: true })}>
      {createElement(registered.component, props)}
    </ComponentErrorBoundary>
  </div>;
}

export function createSlotRenderer(resolve: (reference: SlotReference, ancestry: string[]) => ReactNode): SlotRenderer {
  return {
    validate(reference, ancestry) { return !ancestry.includes(reference.instanceId) && Boolean(reference.layerId) },
    render(reference, ancestry) { if (ancestry.includes(reference.instanceId)) return null; return resolve(reference, [...ancestry, reference.instanceId]) },
  };
}

export function cssForLayout(layout: import('@coday/control-schema').CodayLayout): React.CSSProperties {
  if (layout.mode === 'free') return { position: 'relative' };
  if (layout.mode === 'grid') return { display: 'grid', gridTemplateColumns: layout.minColumnWidth ? `repeat(auto-fit,minmax(${layout.minColumnWidth}px,1fr))` : `repeat(${layout.columns || 1},minmax(0,1fr))`, columnGap: layout.columnGap ?? layout.gap, rowGap: layout.rowGap ?? layout.gap, alignItems: layout.align };
  if (layout.mode === 'diagonal') return { display: 'flex', flexDirection: layout.diagonal?.direction === 'reverse' ? 'row-reverse' : 'row', gap: layout.gap };
  return { display: 'flex', flexDirection: layout.direction === 'horizontal' ? 'row' : 'column', gap: layout.gap, flexWrap: layout.wrap ? 'wrap' : 'nowrap', alignItems: layout.align, justifyContent: layout.justify };
}

export function styleForControl(type: ControlType, value: unknown): React.CSSProperties {
  if (type === ControlType.Layout) return cssForLayout(value as import('@coday/control-schema').CodayLayout);
  return {};
}
