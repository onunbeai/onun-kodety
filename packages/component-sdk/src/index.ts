import type { ComponentType, CSSProperties, ReactNode } from 'react';
import {
  CONTROL_DEFINITION_SCHEMA_VERSION,
  ControlType,
  defaultValuesFromControls,
  serializeControlMap,
  validateDefaults,
  type CodayFile,
  type CodayImage,
  type CodayLayout,
  type CodayLink,
  type CodaySpacing,
  type ControlCondition,
  type ControlDefinition,
  type JSONValue,
  type SerializableControlDefinition,
} from '@coday/control-schema';

export { ControlType } from '@coday/control-schema';
export type * from '@coday/control-schema';

export interface CodayComponentProps {
  style?: CSSProperties;
  className?: string;
  instanceId?: string;
  breakpoint?: string;
}

export interface ComponentSizing {
  width: 'fixed' | 'fill' | 'hug' | 'intrinsic';
  height: 'fixed' | 'fill' | 'hug' | 'intrinsic';
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
}

export interface ComponentEventDefinition {
  title: string;
  description?: string;
  payload?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
}
export type ComponentCapability = 'assets' | 'cms' | 'events' | 'slots' | 'responsive' | 'animation';
export interface ComponentManifest {
  schemaVersion: string;
  id: string;
  name: string;
  displayName: string;
  description?: string;
  version: string;
  exportName: string;
  controls: Record<string, SerializableControlDefinition>;
  defaultProps: Record<string, JSONValue>;
  sizing: ComponentSizing;
  events?: Record<string, ComponentEventDefinition>;
  dependencies: string[];
  capabilities: ComponentCapability[];
}

export interface ComponentDefinition<TProps extends object = Record<string, unknown>> {
  name: string;
  id?: string;
  displayName?: string;
  description?: string;
  version?: string;
  component: ComponentType<TProps>;
  controls: PropertyControls<TProps>;
  sizing?: Partial<ComponentSizing>;
  events?: Record<string, ComponentEventDefinition>;
  capabilities?: ComponentCapability[];
}

export type ComponentDefinitionMetadata<TProps extends object = Record<string, unknown>> =
  Omit<ComponentDefinition<TProps>, 'component'>;

type ControlFor<T> =
  T extends string ? Extract<ControlDefinition, { type: ControlType.String | ControlType.Text | ControlType.Enum | ControlType.Color | ControlType.Date }> :
  T extends number ? Extract<ControlDefinition, { type: ControlType.Number | ControlType.Enum }> :
  T extends boolean ? Extract<ControlDefinition, { type: ControlType.Boolean }> :
  T extends CodayImage ? Extract<ControlDefinition, { type: ControlType.Image }> :
  T extends CodayFile ? Extract<ControlDefinition, { type: ControlType.File }> :
  T extends CodayLink ? Extract<ControlDefinition, { type: ControlType.Link }> :
  T extends CodaySpacing ? Extract<ControlDefinition, { type: ControlType.Spacing }> :
  T extends CodayLayout ? Extract<ControlDefinition, { type: ControlType.Layout }> :
  T extends ReactNode ? ControlDefinition : ControlDefinition;
export type PropertyControls<TProps extends object> = { [K in Exclude<keyof TProps, keyof CodayComponentProps>]?: ControlFor<TProps[K]> } & Record<string, ControlDefinition>;

export interface RegisteredComponent<TProps extends object = Record<string, unknown>> {
  component: ComponentType<TProps>;
  manifest: ComponentManifest;
}

const registrations = new WeakMap<object, RegisteredComponent<object>>();
const byId = new Map<string, RegisteredComponent<object>>();
const byVersion = new Map<string, RegisteredComponent<object>>();
const DEFAULT_SIZING: ComponentSizing = { width: 'fixed', height: 'hug', defaultWidth: 320, minWidth: 1, minHeight: 1 };

function safeId(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'component';
}

function inferCapabilities(controls: Record<string, ControlDefinition>, events?: Record<string, ComponentEventDefinition>): ComponentCapability[] {
  const result = new Set<ComponentCapability>();
  const visit = (control: ControlDefinition) => {
    if (control.responsive) result.add('responsive');
    if (control.bindable) result.add('cms');
    if (control.type === ControlType.Image || control.type === ControlType.File) result.add('assets');
    if (control.type === ControlType.Slot || control.type === ControlType.Slots) result.add('slots');
    if (control.type === ControlType.Object) Object.values(control.controls).forEach(visit);
    if (control.type === ControlType.Array) visit(control.control);
  };
  Object.values(controls).forEach(visit);
  if (events && Object.keys(events).length) result.add('events');
  return [...result];
}

export function defineComponent<TProps extends object>(definition: ComponentDefinition<TProps>): RegisteredComponent<TProps>;
export function defineComponent<TProps extends object>(definition: ComponentDefinitionMetadata<TProps>, component: ComponentType<TProps>): RegisteredComponent<TProps>;
export function defineComponent<TProps extends object>(
  definition: ComponentDefinition<TProps> | ComponentDefinitionMetadata<TProps>,
  component?: ComponentType<TProps>,
): RegisteredComponent<TProps> {
  const resolvedComponent = component ?? ('component' in definition ? definition.component : undefined);
  if (!resolvedComponent) {
    throw new Error(`O Code Component ${definition.name} precisa informar component ou passar o componente como segundo argumento.`);
  }
  const controls = definition.controls as Record<string, ControlDefinition>;
  const validation = validateDefaults(controls);
  if (!validation.valid) throw new Error(`Controles inválidos em ${definition.name}: ${validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
  const manifest: ComponentManifest = {
    schemaVersion: CONTROL_DEFINITION_SCHEMA_VERSION,
    id: definition.id || `coday.${safeId(definition.name)}`,
    name: definition.name,
    displayName: definition.displayName || definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    version: definition.version || '1.0.0',
    exportName: resolvedComponent.name || definition.name,
    controls: serializeControlMap(controls),
    defaultProps: defaultValuesFromControls(controls),
    sizing: { ...DEFAULT_SIZING, ...definition.sizing },
    ...(definition.events ? { events: definition.events } : {}),
    dependencies: [],
    capabilities: [...new Set([...(definition.capabilities || []), ...inferCapabilities(controls, definition.events)])],
  };
  const registered = { component: resolvedComponent, manifest } as RegisteredComponent<TProps>;
  registrations.set(resolvedComponent, registered as RegisteredComponent<object>);
  byId.set(manifest.id, registered as RegisteredComponent<object>);
  byVersion.set(`${manifest.id}@${manifest.version}`, registered as RegisteredComponent<object>);
  const hook = (globalThis as { __CODAY_COMPONENT_REGISTRY__?: { registerRuntime?: (value: RegisteredComponent<TProps>) => void } }).__CODAY_COMPONENT_REGISTRY__;
  hook?.registerRuntime?.(registered);
  return registered;
}

export interface PropertyControlOptions extends Omit<Partial<ComponentManifest>, 'controls' | 'defaultProps' | 'sizing'> { sizing?: Partial<ComponentSizing> }

/**
 * Source-compatible shape for Framer Property Controls. The compiler lowers
 * supported callbacks to serializable ControlCondition objects; the runtime
 * sanitizer below is a second line of defence and never persists closures.
 */
export interface FramerPropertyControl<TProps extends object = Record<string, unknown>> {
  type: ControlType | string;
  title?: string;
  defaultValue?: unknown;
  hidden?: ControlCondition | ((props: TProps) => boolean);
  disabled?: ControlCondition | ((props: TProps) => boolean);
  [key: string]: unknown;
}
export type FramerPropertyControls<TProps extends object> = Record<string, FramerPropertyControl<TProps>>;

const OMIT_FRAMER_VALUE = Symbol('omit-framer-value');
function serializableFramerValue(value: unknown): unknown | typeof OMIT_FRAMER_VALUE {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) {
    return OMIT_FRAMER_VALUE;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      const next = serializableFramerValue(item);
      return next === OMIT_FRAMER_VALUE ? [] : [next];
    });
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const next = serializableFramerValue(item);
    return next === OMIT_FRAMER_VALUE ? [] : [[key, next]];
  }));
}

function normalizeFramerControlRuntime(value: FramerPropertyControl): ControlDefinition | null {
  const safe = serializableFramerValue(value);
  if (!safe || safe === OMIT_FRAMER_VALUE || typeof safe !== 'object' || Array.isArray(safe)) return null;
  const definition = safe as Record<string, unknown>;
  const originalType = String(definition.type || '').toLowerCase().replace(/[_\s]/g, '-');
  const typeMap: Record<string, ControlType | 'event-handler'> = {
    string: ControlType.String,
    text: ControlType.Text,
    number: ControlType.Number,
    boolean: ControlType.Boolean,
    enum: ControlType.Enum,
    segmentedenum: ControlType.Enum,
    'segmented-enum': ControlType.Enum,
    color: ControlType.Color,
    image: ControlType.Image,
    responsiveimage: ControlType.Image,
    'responsive-image': ControlType.Image,
    file: ControlType.File,
    link: ControlType.Link,
    date: ControlType.Date,
    object: ControlType.Object,
    array: ControlType.Array,
    componentinstance: ControlType.Slot,
    'component-instance': ControlType.Slot,
    font: ControlType.Object,
    transition: ControlType.Object,
    boxshadow: ControlType.String,
    'box-shadow': ControlType.String,
    eventhandler: 'event-handler',
    'event-handler': 'event-handler',
  };
  const mapped = typeMap[originalType] || (Object.values(ControlType).includes(originalType as ControlType) ? originalType as ControlType : ControlType.String);
  if (mapped === 'event-handler') return null;
  definition.type = mapped;
  if (['segmentedenum', 'segmented-enum'].includes(originalType)) definition.display = 'segmented';
  if (definition.type === ControlType.String && definition.displayTextArea === true) definition.type = ControlType.Text;
  if (definition.type === ControlType.Number && definition.displayStepper === true) definition.display = 'stepper';
  if (definition.type === ControlType.Enum && !Array.isArray(definition.options)) definition.options = [];
  if (originalType === 'link' && typeof definition.defaultValue === 'string') {
    definition.type = ControlType.String;
    definition.framerValueType = 'url';
  }
  if (originalType === 'image') definition.framerValueType = 'url';
  if (['responsiveimage', 'responsive-image'].includes(originalType)) definition.framerValueType = 'responsive-image';
  if (originalType === 'file') definition.framerValueType = 'url';
  if (originalType === 'font') {
    definition.controls = {
      fontFamily: { type: ControlType.String, title: 'Fonte' },
      fontSize: { type: ControlType.String, title: 'Tamanho' },
      fontWeight: { type: ControlType.String, title: 'Peso' },
      fontStyle: { type: ControlType.Enum, title: 'Estilo', options: ['normal', 'italic', 'oblique'] },
      letterSpacing: { type: ControlType.String, title: 'Espaçamento' },
      lineHeight: { type: ControlType.String, title: 'Altura da linha' },
      textAlign: { type: ControlType.Enum, title: 'Alinhamento', options: ['left', 'center', 'right', 'justify'] },
      textTransform: { type: ControlType.Enum, title: 'Caixa', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
      textDecoration: { type: ControlType.String, title: 'Decoração' },
    };
  }
  if (originalType === 'transition') {
    definition.controls = {
      type: { type: ControlType.Enum, title: 'Tipo', options: ['tween', 'spring', 'inertia'] },
      duration: { type: ControlType.Number, title: 'Duração', min: 0, step: 0.05 },
      delay: { type: ControlType.Number, title: 'Atraso', min: 0, step: 0.05 },
      ease: { type: ControlType.String, title: 'Easing' },
      stiffness: { type: ControlType.Number, title: 'Rigidez', min: 0 },
      damping: { type: ControlType.Number, title: 'Amortecimento', min: 0 },
      mass: { type: ControlType.Number, title: 'Massa', min: 0 },
    };
  }
  if (definition.type === ControlType.Object) {
    const controls = definition.controls && typeof definition.controls === 'object' && !Array.isArray(definition.controls)
      ? definition.controls as Record<string, FramerPropertyControl>
      : {};
    definition.controls = Object.fromEntries(Object.entries(controls).flatMap(([name, child]) => {
      const normalized = normalizeFramerControlRuntime(child);
      return normalized ? [[name, normalized]] : [];
    }));
  }
  if (definition.type === ControlType.Array) {
    const child = definition.control && typeof definition.control === 'object'
      ? normalizeFramerControlRuntime(definition.control as FramerPropertyControl)
      : null;
    if (!child) return null;
    if (child.type === ControlType.Slot) {
      definition.type = ControlType.Slots;
      delete definition.control;
    } else definition.control = child;
  }
  return definition as unknown as ControlDefinition;
}

export function normalizeFramerPropertyControls<TProps extends object>(
  controls: PropertyControls<TProps> | FramerPropertyControls<TProps>,
): PropertyControls<TProps> {
  return Object.fromEntries(Object.entries(controls).flatMap(([name, control]) => {
    const normalized = normalizeFramerControlRuntime(control as unknown as FramerPropertyControl);
    return normalized ? [[name, normalized]] : [];
  })) as PropertyControls<TProps>;
}

export function addPropertyControls<TProps extends object>(
  component: ComponentType<TProps>,
  controls: PropertyControls<TProps> | FramerPropertyControls<TProps>,
  options: PropertyControlOptions = {},
) {
  return defineComponent({
    name: options.name || component.name || 'CodeComponent',
    id: options.id,
    displayName: options.displayName,
    description: options.description,
    version: options.version,
    component,
    controls: normalizeFramerPropertyControls(controls),
    sizing: options.sizing,
    events: options.events,
    capabilities: options.capabilities,
  });
}

export const RenderTarget = Object.freeze({
  canvas: 'canvas',
  preview: 'preview',
  thumbnail: 'thumbnail',
  export: 'export',
  current() {
    const target = (globalThis as { __CODAY_RENDER_TARGET__?: string }).__CODAY_RENDER_TARGET__;
    return target === 'preview' || target === 'thumbnail' || target === 'export' ? target : 'canvas';
  },
});

export function useIsStaticRenderer() {
  const target = RenderTarget.current();
  return target === RenderTarget.thumbnail || target === RenderTarget.export;
}

export function getComponentRegistration(component: ComponentType<object>) { return registrations.get(component) }
export function getRegisteredComponent(id: string, version?: string) {
  return version ? byVersion.get(`${id}@${version}`) : byId.get(id);
}
export function listRegisteredComponents() { return [...byVersion.values()] }

export interface ComponentEvent<TPayload = unknown> { name: string; payload: TPayload; instanceId?: string }
export function emitComponentEvent<TPayload>(name: string, payload: TPayload, instanceId?: string) {
  globalThis.dispatchEvent?.(new CustomEvent<ComponentEvent<TPayload>>('coday:component-event', { detail: { name, payload, instanceId } }));
}
