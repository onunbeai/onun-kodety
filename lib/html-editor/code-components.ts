import type { ComponentRegistrySnapshot, CodeComponentInstance, PublishedComponentVersion } from '@coday/component-registry';
import type { BreakpointDescriptor } from '@coday/control-schema';
import type { HtmlProject, HtmlProjectFile } from './types';
import { DEFAULT_BREAKPOINTS, DEFAULT_PRIMARY_BREAKPOINT, type Breakpoint, type BreakpointMode } from './css-patcher';
import {
  CODE_COMPONENT_REACT_RUNTIME_PATH,
  CODE_COMPONENT_REACT_RUNTIME_SOURCE,
  codeComponentReactImportMap,
} from '@coday/component-runtime/vendor';
import { rewriteJavaScriptModuleSpecifierAliases } from './coded-project';

const RUNTIME_ATTRIBUTE = 'data-coday-code-components-runtime';
const RENDER_TARGET_ATTRIBUTE = 'data-coday-code-components-render-target';
function safeSegment(value: string) { return value.replace(/[^a-z0-9._-]+/gi, '-') }
function escapeAttribute(value: string) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function normalizedPath(value: string) { return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/^\.\//, '') }
function runtimeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Convert the editor's compact alpha notation to a browser-valid CSS color. */
export function codeComponentCssColorValue(value: string, allowAlpha = true) {
  const normalized = value.trim();
  const compactAlpha = normalized.match(/^#([0-9a-f]{6})\/(\d{1,3})$/i);
  if (compactAlpha) {
    const hex = compactAlpha[1];
    const alpha = Math.max(0, Math.min(100, Number(compactAlpha[2]))) / 100;
    if (!allowAlpha || alpha >= 1) return `#${hex}`;
    return `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${alpha})`;
  }
  const hexAlpha = normalized.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hexAlpha) {
    const alpha = parseInt(hexAlpha[2], 16) / 255;
    if (!allowAlpha || alpha >= 1) return `#${hexAlpha[1]}`;
    return `rgba(${parseInt(hexAlpha[1].slice(0, 2), 16)},${parseInt(hexAlpha[1].slice(2, 4), 16)},${parseInt(hexAlpha[1].slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
  }
  if (normalized.startsWith('color:var(')) return normalized.slice('color:'.length);
  return normalized;
}

export function codeComponentColorEditorValue(
  current: unknown,
  next: string,
  allowAlpha = true,
): unknown {
  const value = codeComponentCssColorValue(next, allowAlpha);
  const record = runtimeRecord(current);
  if (!record || typeof record.value !== 'string') return value;
  const format = value.startsWith('rgba(')
    ? 'rgba'
    : value.startsWith('rgb(')
      ? 'rgb'
      : value.startsWith('var(')
        ? 'variable'
        : value.startsWith('#')
          ? 'hex'
          : record.format;
  const rgbaAlpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  const alpha = rgbaAlpha
    ? Math.max(0, Math.min(1, Number(rgbaAlpha[1])))
    : value.startsWith('#')
      ? 1
      : record.alpha;
  return {
    ...record,
    value,
    ...(typeof format === 'string' ? { format } : {}),
    ...(typeof alpha === 'number' && Number.isFinite(alpha) ? { alpha } : {}),
  };
}

/**
 * Early Code Components accepted string defaults for image/file controls.
 * Keep those manifests operational while preserving the object contract for
 * correctly-authored components.
 */
export function normalizeCodeComponentControlValueForRuntime(definitionValue: unknown, value: unknown): unknown {
  const definition = runtimeRecord(definitionValue);
  if (!definition) return value;
  const current = runtimeRecord(value);
  // Framer clears asset controls by removing the prop. Persisting `null` is the
  // closest JSON representation in the editor, but passing that value through
  // breaks components that intentionally rely on a default parameter such as
  // `image = { src: '' }`. Native Coday controls keep their explicit-null
  // semantics; only the compatibility values are lowered to `undefined`.
  if (
    value === null
    && (definition.type === 'image' || definition.type === 'file')
    && typeof definition.framerValueType === 'string'
  ) return undefined;
  if (definition.type === 'color') {
    if (typeof value === 'string') return codeComponentCssColorValue(value, definition.allowAlpha !== false);
    if (current && typeof current.value === 'string') {
      const normalized = codeComponentCssColorValue(current.value, definition.allowAlpha !== false);
      return typeof definition.defaultValue === 'string'
        ? normalized
        : { ...current, value: normalized };
    }
  }
  if (
    definition.type === 'image'
    && (typeof definition.defaultValue === 'string' || definition.framerValueType === 'url')
    && current
  ) {
    return typeof current.src === 'string'
      ? current.src
      : typeof current.id === 'string'
        ? current.id
        : value;
  }
  if (
    definition.type === 'file'
    && (typeof definition.defaultValue === 'string' || definition.framerValueType === 'url')
    && current
  ) {
    return typeof current.url === 'string'
      ? current.url
      : typeof current.id === 'string'
        ? current.id
        : value;
  }
  if (definition.type === 'object' && current) {
    const controls = runtimeRecord(definition.controls) || {};
    return Object.fromEntries(Object.entries(current).map(([name, nested]) => [
      name,
      normalizeCodeComponentControlValueForRuntime(controls[name], nested),
    ]));
  }
  if (definition.type === 'array' && Array.isArray(value)) {
    return value.map(item => normalizeCodeComponentControlValueForRuntime(definition.control, item));
  }
  return value;
}

export function normalizeCodeComponentInstanceForRuntime(
  instance: CodeComponentInstance,
  component: PublishedComponentVersion | undefined,
): CodeComponentInstance {
  const controls = component?.manifest.controls || {};
  const props = Object.fromEntries(Object.entries(instance.props).flatMap(([name, value]) => {
    const normalized = normalizeCodeComponentControlValueForRuntime(controls[name], value);
    return normalized === undefined ? [] : [[name, normalized]];
  })) as CodeComponentInstance['props'];
  const responsiveProps = Object.fromEntries(Object.entries(instance.responsiveProps || {}).flatMap(([name, responsive]) => {
    const base = normalizeCodeComponentControlValueForRuntime(controls[name], responsive.base);
    const overrides = Object.fromEntries(Object.entries(responsive.overrides || {}).flatMap(([breakpoint, value]) => {
      const normalized = normalizeCodeComponentControlValueForRuntime(controls[name], value);
      return normalized === undefined ? [] : [[breakpoint, normalized]];
    }));
    if (base === undefined && !Object.keys(overrides).length) return [];
    return [[name, {
      ...responsive,
      // Null is a transient runtime sentinel for an omitted Framer base when
      // another breakpoint still has a value. hydrateControlValue converts it
      // back to undefined before React sees the prop.
      base: base === undefined ? null : base,
      overrides,
    }]];
  })) as CodeComponentInstance['responsiveProps'];
  return { ...instance, props, responsiveProps };
}

export interface CodeComponentBreakpointDescriptor extends BreakpointDescriptor { mode: BreakpointMode }

export function toCodeComponentBreakpoints(
  primary: Breakpoint = DEFAULT_PRIMARY_BREAKPOINT,
  breakpoints: Breakpoint[] = DEFAULT_BREAKPOINTS,
): CodeComponentBreakpointDescriptor[] {
  const result: CodeComponentBreakpointDescriptor[] = [{ id: primary.id, width: primary.width, mode: primary.mode }];
  const descending = breakpoints.filter(item => item.mode === 'max-width').sort((left, right) => right.width - left.width);
  descending.forEach((item, index) => result.push({ id: item.id, width: item.width, mode: item.mode, parentId: index ? descending[index - 1].id : primary.id }));
  breakpoints.filter(item => item.mode === 'min-width').sort((left, right) => left.width - right.width).forEach(item => result.push({ id: item.id, width: item.width, mode: item.mode, parentId: primary.id }));
  return result;
}

export function normalizeCodeComponentRegistry(value: unknown): ComponentRegistrySnapshot {
  if (!value || typeof value !== 'object') return { schemaVersion: '1.0.0', components: [], instances: [] };
  const candidate = value as Partial<ComponentRegistrySnapshot>;
  const components = Array.isArray(candidate.components) ? candidate.components.filter((item): item is PublishedComponentVersion => Boolean(item && typeof item.id === 'string' && typeof item.version === 'string' && typeof item.bundle === 'string' && item.manifest)) : [];
  const instances = Array.isArray(candidate.instances) ? candidate.instances.filter((item): item is CodeComponentInstance => Boolean(item && typeof item.id === 'string' && typeof item.componentId === 'string' && typeof item.componentVersion === 'string' && item.props && typeof item.props === 'object')) : [];
  return { schemaVersion: typeof candidate.schemaVersion === 'string' ? candidate.schemaVersion : '1.0.0', components: clone(components), instances: clone(instances) };
}

export function codeComponentMarkup(instance: CodeComponentInstance) {
  const width = Number.isFinite(instance.sizing.width) && Number(instance.sizing.width) > 0
    ? Number(instance.sizing.width)
    : undefined;
  const height = Number.isFinite(instance.sizing.height) && Number(instance.sizing.height) > 0
    ? Number(instance.sizing.height)
    : undefined;
  const sizing = ['position:relative', 'display:block', 'box-sizing:border-box', 'min-width:1px', 'min-height:1px'];
  if (instance.sizing.widthMode === 'fixed' && width) sizing.push(`width:${width}px`);
  else if (instance.sizing.widthMode === 'fill') sizing.push('width:100%');
  else if (instance.sizing.widthMode === 'hug' || instance.sizing.widthMode === 'intrinsic') sizing.push('width:fit-content');
  if (instance.sizing.heightMode === 'fixed' && height) sizing.push(`height:${height}px`);
  else if (instance.sizing.heightMode === 'fill') sizing.push('height:100%');
  else if (instance.sizing.heightMode === 'hug' || instance.sizing.heightMode === 'intrinsic') sizing.push('height:fit-content');
  return `<div data-label="Code Component" data-coday-code-component="${escapeAttribute(instance.componentId)}" data-coday-code-version="${escapeAttribute(instance.componentVersion)}" data-coday-code-instance="${escapeAttribute(instance.id)}" style="${sizing.join(';')}"></div>`;
}

function modulePath(component: PublishedComponentVersion) {
  // Development builds can intentionally reuse a semantic version. Make the
  // browser module URL follow bundle content so hot reload cannot reuse the
  // previous module from its URL cache.
  const bundleHash = component.bundleHash?.trim() || '';
  const hash = /^[a-f0-9]{64}$/i.test(bundleHash)
    ? bundleHash.slice(0, 16).toLowerCase()
    : component.manifest.dependencies.join('-').length.toString(36);
  return `.coday/components/${safeSegment(component.id)}/${safeSegment(component.version)}.${hash}.mjs`;
}

function compiledModuleEntries(component: PublishedComponentVersion) {
  return Object.entries(component.moduleGraph || {}).filter(
    (entry): entry is [string, string] => /^module-[a-f0-9]{64}\.mjs$/.test(entry[0]) && typeof entry[1] === 'string',
  );
}

/** `framer` is an authoring compatibility facade backed by Kodety's SDK.
 * Normalize persisted development bundles while materializing them so projects
 * compiled by an older Kodety publish without requiring a reset or reimport. */
export function normalizeCodeComponentRuntimeModule(source: string) {
  return rewriteJavaScriptModuleSpecifierAliases(source, {
    framer: '@coday/components',
  });
}

function projectRuntimePath(rootPath: string, path: string) {
  const root = normalizedPath(rootPath);
  return root ? `${root}/${path}` : path;
}

function experimentVariantProjectRoot(htmlPath: string, publicRootPath: string) {
  const match = normalizedPath(htmlPath).match(
    /^(\.incode\/experiments\/[^/]+\/[^/]+\/project)(?:\/|$)/i,
  );
  if (!match) return null;
  const root = normalizedPath(publicRootPath);
  return root ? `${match[1]}/${root}` : match[1];
}

function relativeRootPrefix(htmlPath: string, rootPath: string) {
  const from = normalizedPath(htmlPath).split('/').slice(0, -1).filter(Boolean);
  const to = normalizedPath(rootPath).split('/').filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  const prefix = `${'../'.repeat(from.length)}${to.length ? `${to.join('/')}/` : ''}`;
  return prefix || './';
}

export function compileCodeComponentRuntime(
  source: string,
  snapshotValue: ComponentRegistrySnapshot,
  rootPrefix = '',
  breakpoints: CodeComponentBreakpointDescriptor[] = toCodeComponentBreakpoints(),
) {
  const sourceWithoutRuntime = source
    .replace(new RegExp(`\\s*<script\\b[^>]*${RUNTIME_ATTRIBUTE}[^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '')
    .replace(new RegExp(`\\s*<script\\b[^>]*${RENDER_TARGET_ATTRIBUTE}[^>]*>[\\s\\S]*?<\\/script>`, 'gi'), '')
    .replace(/\s*<script\b[^>]*data-coday-code-components-importmap[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<style\b[^>]*data-coday-code-components-layout[^>]*>[\s\S]*?<\/style>/gi, '');
  const snapshot = normalizeCodeComponentRegistry(snapshotValue);
  const usedIds = new Set(Array.from(sourceWithoutRuntime.matchAll(/\bdata-coday-code-instance\s*=\s*["']([^"']+)["']/gi), match => match[1]));
  const instances = snapshot.instances.filter(instance => usedIds.has(instance.id));
  if (!instances.length) return sourceWithoutRuntime;
  const versions = snapshot.components.filter(component => instances.some(instance => instance.componentId === component.id && instance.componentVersion === component.version));
  const versionByKey = new Map(versions.map(component => [`${component.id}@${component.version}`, component]));
  const runtimeInstances = instances.map(instance => normalizeCodeComponentInstanceForRuntime(
    instance,
    versionByKey.get(`${instance.componentId}@${instance.componentVersion}`),
  ));
  const payload = JSON.stringify({
    instances: runtimeInstances,
    breakpoints,
    modules: Object.fromEntries(versions.map((component, index) => [`${component.id}@${component.version}`, index])),
    controls: Object.fromEntries(versions.map(component => [
      `${component.id}@${component.version}`,
      component.manifest.controls,
    ])),
  }).replaceAll('</', '<\\/');
  const imports = versions.map((component, index) => `import * as __codayModule${index} from ${JSON.stringify(`${rootPrefix}${modulePath(component)}`)};`).join('\n');
  const moduleList = `[${versions.map((_, index) => `__codayModule${index}`).join(',')}]`;
  const runtimeImportMap = JSON.stringify({ imports: codeComponentReactImportMap(`${rootPrefix}${CODE_COMPONENT_REACT_RUNTIME_PATH}`) }).replaceAll('</', '<\\/');
  const runtime = `\n<style data-coday-code-components-layout>:where([data-coday-code-instance]){position:relative}</style>\n<script ${RENDER_TARGET_ATTRIBUTE}>globalThis.__CODAY_RENDER_TARGET__ ||= 'preview';</script>\n<script type="importmap" data-coday-code-components-importmap>${runtimeImportMap}</script>\n<script type="module" ${RUNTIME_ATTRIBUTE}>\n${imports}\nconst config=${payload};\nconst instances=new Map(config.instances.map(value=>[value.id,value]));\nconst loadedModules=${moduleList};\nconst breakpointById=new Map(config.breakpoints.map(value=>[value.id,value]));\nconst baseBreakpoint=config.breakpoints.find(value=>!value.parentId)||config.breakpoints[0]||{id:'base',width:1920,mode:'max-width'};\nconst readPath=(value,path)=>path.split('.').reduce((current,key)=>current&&typeof current==='object'?current[key]:undefined,value);\nconst mergeResponsiveValue=(base,override)=>base&&override&&typeof base==='object'&&typeof override==='object'&&!Array.isArray(base)&&!Array.isArray(override)?{...base,...override}:override;\nconst breakpointLineage=id=>{const result=[];const seen=new Set();let current=breakpointById.get(id);while(current&&!seen.has(current.id)){seen.add(current.id);result.unshift(current.id);current=current.parentId?breakpointById.get(current.parentId):undefined}return result};\nconst activeBreakpoint=()=>{const forced=document.documentElement.dataset.codayBreakpoint;if(forced&&breakpointById.has(forced))return forced;const width=innerWidth;const max=config.breakpoints.filter(value=>value.id!==baseBreakpoint.id&&value.mode==='max-width'&&width<=value.width).sort((a,b)=>a.width-b.width)[0];if(max)return max.id;const min=config.breakpoints.filter(value=>value.id!==baseBreakpoint.id&&value.mode==='min-width'&&width>=value.width).sort((a,b)=>b.width-a.width)[0];return min?.id||baseBreakpoint.id};\nconst resolveResponsiveValue=(value,id)=>{if(!value||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,'base'))return value;return breakpointLineage(id).reduce((resolved,key)=>value.overrides?.[key]===undefined?resolved:mergeResponsiveValue(resolved,value.overrides[key]),value.base)};\nconst resolvedInstanceProps=(instance,id)=>{const props={...instance.props};for(const [name,value] of Object.entries(instance.responsiveProps||{}))props[name]=resolveResponsiveValue(value,id);return props};\nconst resolveBindings=async(instance,element,id)=>{const props=resolvedInstanceProps(instance,id);for(const [name,binding] of Object.entries(instance.bindings||{})){try{const provider=globalThis.__CODAY_CMS__;const value=provider?.resolve?await provider.resolve(binding,{element}):readPath(element.closest('[data-coday-cms-item]')?.__codayData||{},binding.fieldId||'');props[name]=value??binding.fallback??props[name]}catch(error){console.warn('[Coday Code Component]',name,error)}}return props};\nconst mount=async element=>{const instance=instances.get(element.dataset.codayCodeInstance);if(!instance)return;const key=instance.componentId+'@'+instance.componentVersion;const module=loadedModules[config.modules[key]];if(!module){element.dataset.codayComponentError='bundle-missing';return}try{const start=module.mountCodayComponent||module.mount;if(typeof start!=='function')throw new Error('Bundle não exporta mountCodayComponent.');const breakpoint=activeBreakpoint();const props=await resolveBindings(instance,element,breakpoint);const mounted=await start(element,props,{instanceId:instance.id,breakpoint,emit:(name,payload)=>element.dispatchEvent(new CustomEvent('coday:'+name,{detail:payload,bubbles:true}))});element.__codayMount=mounted;element.__codayBreakpoint=breakpoint}catch(error){element.dataset.codayComponentError='runtime';console.error('[Coday Code Component]',error)}};\nconst updateMounted=async element=>{const instance=instances.get(element.dataset.codayCodeInstance);if(!instance||!element.__codayMount?.update)return;const breakpoint=activeBreakpoint();const props=await resolveBindings(instance,element,breakpoint);element.__codayBreakpoint=breakpoint;element.__codayMount.update(props,breakpoint)};\ndocument.querySelectorAll('[data-coday-code-instance]').forEach(mount);\naddEventListener('coday:cms-updated',()=>document.querySelectorAll('[data-coday-code-instance]').forEach(updateMounted));\naddEventListener('coday:breakpoint-changed',()=>document.querySelectorAll('[data-coday-code-instance]').forEach(updateMounted));\nlet resizeFrame=0;const onResize=()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>document.querySelectorAll('[data-coday-code-instance]').forEach(element=>{if(element.__codayBreakpoint!==activeBreakpoint())updateMounted(element)}))};addEventListener('resize',onResize,{passive:true});\naddEventListener('pagehide',()=>{removeEventListener('resize',onResize);cancelAnimationFrame(resizeFrame);document.querySelectorAll('[data-coday-code-instance]').forEach(element=>element.__codayMount?.dispose?.())},{once:true});\n</script>`;
  const assetHydrationSource = `const resolveRuntimeAssetValue=async value=>{
  if(typeof value!=='string'||!value)return value;
  const resolver=globalThis.__KODETY_RESOLVE_RUNTIME_ASSET_URL__;
  if(typeof resolver!=='function')return value;
  try{const resolved=await resolver(value);return typeof resolved==='string'&&resolved?resolved:value}catch{return value}
};
const resolveRuntimeAssetSrcSet=async value=>{
  if(typeof value!=='string'||!value||/^data:/i.test(value.trim()))return value;
  const candidates=value.split(',');
  const resolved=await Promise.all(candidates.map(async candidate=>{
    const normalized=candidate.trim();
    const descriptorMatch=normalized.match(/\\s+(\\d+(?:\\.\\d+)?[wx])$/i);
    const authored=descriptorMatch?normalized.slice(0,descriptorMatch.index).trim():normalized;
    if(!authored)return normalized;
    return await resolveRuntimeAssetValue(authored)+(descriptorMatch?' '+descriptorMatch[1]:'');
  }));
  return resolved.join(', ');
};
const hydrateControlValue=async(definition,value)=>{
  if(!definition||typeof definition!=='object')return value;
  if(definition.type==='image'){
    if(value==null)return typeof definition.framerValueType==='string'?undefined:value;
    if(typeof value==='string')return resolveRuntimeAssetValue(value);
    if(typeof value!=='object'||Array.isArray(value))return value;
    const next={...value};
    const source=typeof value.src==='string'&&value.src?value.src:typeof value.id==='string'?value.id:'';
    if(source)next.src=await resolveRuntimeAssetValue(source);
    if(typeof value.srcSet==='string'&&value.srcSet)next.srcSet=await resolveRuntimeAssetSrcSet(value.srcSet);
    return next;
  }
  if(definition.type==='file'){
    if(value==null)return typeof definition.framerValueType==='string'?undefined:value;
    if(typeof value==='string')return resolveRuntimeAssetValue(value);
    if(typeof value!=='object'||Array.isArray(value))return value;
    const next={...value};
    const source=typeof value.url==='string'&&value.url?value.url:typeof value.id==='string'?value.id:'';
    if(source)next.url=await resolveRuntimeAssetValue(source);
    return next;
  }
  if(definition.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value)){
    const controls=definition.controls||{};
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async([name,nested])=>[
      name,
      await hydrateControlValue(controls[name],nested),
    ])));
  }
  if(definition.type==='array'&&Array.isArray(value)){
    return Promise.all(value.map(item=>hydrateControlValue(definition.control,item)));
  }
  return value;
};
const hydrateAssetProps=async(instance,props)=>{
  const controls=config.controls?.[instance.componentId+'@'+instance.componentVersion]||{};
  return Object.fromEntries(await Promise.all(Object.entries(props).map(async([name,value])=>[
    name,
    await hydrateControlValue(controls[name],value),
  ])));
};`;
  const runtimeWithAssetHydration = runtime.replace(
    /\nconst resolveBindings=async[\s\S]*?(?=\nconst mount=)/,
    `\n${assetHydrationSource}\nconst resolveBindings=async(instance,element,id)=>{const props=resolvedInstanceProps(instance,id);for(const [name,binding] of Object.entries(instance.bindings||{})){try{const provider=globalThis.__CODAY_CMS__;const value=provider?.resolve?await provider.resolve(binding,{element}):readPath(element.closest('[data-coday-cms-item]')?.__codayData||{},binding.fieldId||'');props[name]=value??binding.fallback??props[name]}catch(error){console.warn('[Coday Code Component]',name,error)}}return hydrateAssetProps(instance,props)};`,
  );
  const updateMountedSource = "const updateMounted=async element=>{const instance=instances.get(element.dataset.codayCodeInstance);if(!instance||!element.__codayMount?.update)return;const breakpoint=activeBreakpoint();const props=await resolveBindings(instance,element,breakpoint);element.__codayBreakpoint=breakpoint;element.__codayMount.update(props,breakpoint)};";
  const liveUpdateSource = "const editorUpdateSequence=new Map();\nconst updateMounted=async(element,candidate=instances.get(element.dataset.codayCodeInstance))=>{if(!candidate||!element.__codayMount?.update)return false;const sequence=(element.__codayUpdateSequence||0)+1;element.__codayUpdateSequence=sequence;const breakpoint=activeBreakpoint();const props=await resolveBindings(candidate,element,breakpoint);if(element.__codayUpdateSequence!==sequence)return false;const applied=await element.__codayMount.update(props,breakpoint);if(element.__codayUpdateSequence!==sequence||applied===false)return false;element.__codayBreakpoint=breakpoint;return true};\nconst updateInstanceFromEditor=async event=>{const detail=event?.detail;const value=detail?.instance;const revision=Number.isSafeInteger(detail?.revision)&&detail.revision>=0?detail.revision:null;if(revision===null||!value||typeof value!=='object'||typeof value.id!=='string'||typeof value.componentId!=='string'||typeof value.componentVersion!=='string'||!value.props||typeof value.props!=='object'||Array.isArray(value.props))return;const current=instances.get(value.id);if(!current||current.componentId!==value.componentId||current.componentVersion!==value.componentVersion)return;const elements=Array.from(document.querySelectorAll('[data-coday-code-instance]')).filter(element=>element.dataset.codayCodeInstance===value.id);if(!elements.length)return;const sequence=(editorUpdateSequence.get(value.id)||0)+1;editorUpdateSequence.set(value.id,sequence);const applied=await Promise.all(elements.map(element=>updateMounted(element,value)));if(editorUpdateSequence.get(value.id)!==sequence)return;if(!applied.every(Boolean)){await Promise.all(elements.map(element=>updateMounted(element,current)));if(editorUpdateSequence.get(value.id)===sequence)dispatchEvent(new CustomEvent('coday:code-component-instance-rejected',{detail:{instanceId:value.id,revision}}));return}instances.set(value.id,value);dispatchEvent(new CustomEvent('coday:code-component-instance-applied',{detail:{instanceId:value.id,revision}}))};\naddEventListener('coday:code-component-instance-update',updateInstanceFromEditor);";
  const pageHideSource = "addEventListener('pagehide',()=>{removeEventListener('resize',onResize);cancelAnimationFrame(resizeFrame);document.querySelectorAll('[data-coday-code-instance]').forEach(element=>element.__codayMount?.dispose?.())},{once:true});";
  const liveRuntime = runtimeWithAssetHydration
    .replace(updateMountedSource, liveUpdateSource)
    .replace(
      pageHideSource,
      "addEventListener('pagehide',()=>{removeEventListener('resize',onResize);removeEventListener('coday:code-component-instance-update',updateInstanceFromEditor);cancelAnimationFrame(resizeFrame);document.querySelectorAll('[data-coday-code-instance]').forEach(element=>element.__codayMount?.dispose?.())},{once:true});",
    );
  return /<\/body\s*>/i.test(sourceWithoutRuntime) ? sourceWithoutRuntime.replace(/<\/body\s*>/i, `${liveRuntime}\n</body>`) : `${sourceWithoutRuntime}${liveRuntime}`;
}

export function prepareCodeComponentProject(
  project: HtmlProject,
  snapshotValue: ComponentRegistrySnapshot,
  breakpoints: CodeComponentBreakpointDescriptor[] = toCodeComponentBreakpoints(),
): HtmlProject {
  const snapshot = normalizeCodeComponentRegistry(snapshotValue); if (!snapshot.instances.length) return project;
  const files: Record<string, HtmlProjectFile> = { ...project.files };
  const htmlFiles = Object.values(files).filter(
    file => /\.html?$/i.test(file.path) && file.text !== undefined,
  );
  const runtimeRoots = new Set<string>([normalizedPath(project.rootPath)]);
  htmlFiles.forEach(file => {
    if (!/\bdata-coday-code-instance\s*=/i.test(file.text || '')) return;
    const privateRoot = experimentVariantProjectRoot(file.path, project.rootPath);
    if (privateRoot) runtimeRoots.add(privateRoot);
  });
  runtimeRoots.forEach(rootPath => {
    const runtimePath = projectRuntimePath(rootPath, CODE_COMPONENT_REACT_RUNTIME_PATH);
    files[runtimePath] = { path: runtimePath, mimeType: 'text/javascript', text: CODE_COMPONENT_REACT_RUNTIME_SOURCE };
    snapshot.components.forEach(component => {
      const path = projectRuntimePath(rootPath, modulePath(component));
      files[path] = {
        path,
        mimeType: 'text/javascript',
        text: normalizeCodeComponentRuntimeModule(component.bundle),
      };
      const directory = path.split('/').slice(0, -1).join('/');
      compiledModuleEntries(component).forEach(([moduleName, source]) => {
        const moduleFilePath = `${directory}/${moduleName}`;
        files[moduleFilePath] = {
          path: moduleFilePath,
          mimeType: 'text/javascript',
          text: normalizeCodeComponentRuntimeModule(source),
        };
      });
      if (component.sourceMap) files[`${path}.map`] = { path: `${path}.map`, mimeType: 'application/json', text: component.sourceMap };
    });
  });
  htmlFiles.forEach(file => {
    const runtimeRoot = experimentVariantProjectRoot(file.path, project.rootPath)
      || project.rootPath;
    const prefix = relativeRootPrefix(file.path, runtimeRoot);
    files[file.path] = {
      ...file,
      text: compileCodeComponentRuntime(file.text || '', snapshot, prefix, breakpoints),
    };
  });
  return { ...project, files };
}
