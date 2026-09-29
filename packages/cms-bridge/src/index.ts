import { ControlType, type ControlDefinition, type JSONValue } from '@coday/control-schema';

export type DataSourceType = 'current-collection' | 'specific-item' | 'collection-query' | 'global-variable' | 'url-parameter' | 'authenticated-user' | 'server-function';
export interface DataBinding { type: DataSourceType; sourceId: string; fieldId?: string; query?: Record<string, JSONValue>; fallback?: JSONValue; transformId?: string }
export type PropValue<T> = { type: 'static'; value: T } | { type: 'binding'; binding: DataBinding };
export type CmsFieldType = 'string' | 'text' | 'number' | 'boolean' | 'color' | 'image' | 'file' | 'link' | 'date' | 'object' | 'array';
export interface CmsFieldDescriptor { id: string; name: string; type: CmsFieldType; collectionId?: string; nullable?: boolean; multiple?: boolean }
export interface CmsContext { collectionId?: string; itemId?: string; item?: Record<string, JSONValue>; url?: URL; user?: Record<string, JSONValue>; variables?: Record<string, JSONValue> }
export interface CmsProvider {
  listSources(type?: DataSourceType): Promise<Array<{ id: string; title: string; type: DataSourceType }>>;
  listFields(sourceId: string): Promise<CmsFieldDescriptor[]>;
  resolve(binding: DataBinding, context: CmsContext, signal?: AbortSignal): Promise<JSONValue | undefined>;
  subscribe?(binding: DataBinding, context: CmsContext, listener: (value: JSONValue | undefined) => void): () => void;
}

const compatibility: Partial<Record<ControlType, CmsFieldType[]>> = {
  [ControlType.String]: ['string', 'text', 'number', 'date'], [ControlType.Text]: ['string', 'text'],
  [ControlType.Number]: ['number', 'string'], [ControlType.Boolean]: ['boolean'], [ControlType.Enum]: ['string', 'number'],
  [ControlType.Color]: ['color', 'string'], [ControlType.Image]: ['image'], [ControlType.File]: ['file'],
  [ControlType.Link]: ['link', 'string'], [ControlType.Date]: ['date', 'string'], [ControlType.Array]: ['array'], [ControlType.Object]: ['object'],
};
export function isFieldCompatible(control: ControlDefinition, field: CmsFieldDescriptor) { return (compatibility[control.type] || ['object']).includes(field.type) }

export async function resolvePropValue<T extends JSONValue>(value: PropValue<T>, provider: CmsProvider, context: CmsContext, signal?: AbortSignal): Promise<T> {
  if (value.type === 'static') return value.value;
  const resolved = await provider.resolve(value.binding, context, signal);
  return (resolved === undefined ? value.binding.fallback : resolved) as T;
}

export async function resolveBindings(
  staticValues: Record<string, JSONValue>, bindings: Record<string, DataBinding> | undefined,
  controls: Record<string, ControlDefinition>, provider: CmsProvider | undefined, context: CmsContext, signal?: AbortSignal,
) {
  if (!provider || !bindings) return { values: { ...staticValues }, errors: [] as string[] };
  const values = { ...staticValues }; const errors: string[] = [];
  await Promise.all(Object.entries(bindings).map(async ([property, binding]) => {
    const control = controls[property]; if (!control) { errors.push(`Controle ${property} não existe.`); return; }
    try { const resolved = await provider.resolve(binding, context, signal); values[property] = (resolved === undefined ? binding.fallback : resolved) ?? values[property] ?? null; }
    catch (error) { errors.push(`${property}: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  return { values, errors };
}

export class ObjectCmsProvider implements CmsProvider {
  constructor(private readonly sources: Record<string, { title: string; type: DataSourceType; fields: CmsFieldDescriptor[]; data: Record<string, JSONValue> }>) {}
  async listSources(type?: DataSourceType) { return Object.entries(this.sources).filter(([, source]) => !type || source.type === type).map(([id, source]) => ({ id, title: source.title, type: source.type })) }
  async listFields(sourceId: string) { return this.sources[sourceId]?.fields || [] }
  async resolve(binding: DataBinding, context: CmsContext) {
    if (binding.type === 'current-collection') return binding.fieldId ? context.item?.[binding.fieldId] : context.item;
    if (binding.type === 'url-parameter') return binding.fieldId ? context.url?.searchParams.get(binding.fieldId) ?? undefined : undefined;
    if (binding.type === 'authenticated-user') return binding.fieldId ? context.user?.[binding.fieldId] : context.user as JSONValue | undefined;
    if (binding.type === 'global-variable') return binding.fieldId ? context.variables?.[binding.fieldId] : context.variables as JSONValue | undefined;
    const source = this.sources[binding.sourceId]; return binding.fieldId ? source?.data[binding.fieldId] : source?.data as JSONValue | undefined;
  }
}
