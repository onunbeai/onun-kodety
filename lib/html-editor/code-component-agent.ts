import type { ComponentManifest } from '@coday/components';
import type {
  CodeComponentInstance,
  DataBinding,
  InstanceSizing,
  SlotReference,
} from '@coday/component-registry';
import {
  ControlType,
  getControlAdapter,
  type JSONValue,
  type ResponsiveValue,
} from '@coday/control-schema';
import type { HtmlProject } from './types';
import {
  addProjectTextFile,
  readEditorMetadata,
  removeProjectFile,
  updateEditorMetadata,
  updateTextFile,
} from './project-io';
import {
  codeComponentMarkup,
  normalizeCodeComponentRegistry,
} from './code-components';
import {
  codeComponentSources,
  compileCodeComponentProjectFile,
  isCodeComponentSource,
  type CodeComponentCompileState,
} from './code-component-authoring';
import {
  inspectSourceElements,
  getElementChildCount,
  patchInsertAdjacentElement,
  patchInsertElement,
  patchRemoveElement,
  patchReplaceLocatedElementsOuterHtml,
} from './source-patcher';

const CODE_COMPONENT_SOURCE_PATH = /^(?:code-components|components)\/.+\.(?:tsx?|jsx?)$/i;

export type CodeComponentAgentChange =
  | {
      type: 'upsertSource';
      filePath: string;
      source: string;
    }
  | {
      type: 'insertInstance';
      componentId: string;
      componentVersion?: string;
      pagePath: string;
      selectionPath?: string;
      placement?: 'before' | 'after' | 'inside';
      props?: Record<string, JSONValue>;
      responsiveProps?: Record<string, ResponsiveValue<JSONValue>>;
      bindings?: Record<string, DataBinding>;
      slots?: Record<string, SlotReference | SlotReference[]>;
      sizing?: InstanceSizing;
    }
  | {
      type: 'updateInstance';
      instanceId: string;
      componentVersion?: string;
      props?: Record<string, JSONValue>;
      responsiveProps?: Record<string, ResponsiveValue<JSONValue>>;
      bindings?: Record<string, DataBinding>;
      slots?: Record<string, SlotReference | SlotReference[]>;
      sizing?: InstanceSizing;
    }
  | {
      type: 'removeInstance';
      instanceId: string;
    }
  | {
      type: 'removeSource';
      filePath: string;
    };

export interface ApplyCodeComponentAgentChangesOptions {
  author?: string;
  confirmDestructive?: boolean;
  createInstanceId?: () => string;
}

export interface CodeComponentAgentChangeResult {
  type: CodeComponentAgentChange['type'];
  filePath?: string;
  componentId?: string;
  componentVersion?: string;
  instanceId?: string;
  pagePath?: string;
  selectionPath?: string;
  diagnostics?: CodeComponentCompileState['diagnostics'];
}

function normalizedCodeComponentPath(value: string) {
  return value.trim().replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function assertCodeComponentSourcePath(value: string) {
  const path = normalizedCodeComponentPath(value);
  if (!CODE_COMPONENT_SOURCE_PATH.test(path) || path.startsWith('.incode/')) {
    throw new Error('Code Components devem ficar em code-components/ ou components/ e usar .tsx, .ts, .jsx ou .js.');
  }
  return path;
}

function compactDiagnostics(result: CodeComponentCompileState, path: string) {
  const diagnostics = result.diagnostics || [];
  const detail = diagnostics
    .slice(0, 12)
    .map(issue => `${issue.file || path}${issue.line ? `:${issue.line}` : ''} · ${issue.code}: ${issue.message}`)
    .join('\n');
  return detail || `O compiler rejeitou ${path} sem fornecer detalhes.`;
}

function publishedVersion(project: HtmlProject, componentId: string, requestedVersion?: string) {
  const versions = normalizeCodeComponentRegistry(readEditorMetadata(project).codeComponents).components
    .filter(component => component.id === componentId)
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  const published = requestedVersion
    ? versions.find(component => component.version === requestedVersion)
    : versions[0];
  if (!published) {
    throw new Error(
      requestedVersion
        ? `O Code Component ${componentId}@${requestedVersion} não está compilado e registrado.`
        : `O Code Component ${componentId} não está compilado e registrado.`,
    );
  }
  return published;
}

function validatedProps(
  manifest: ComponentManifest,
  base: Record<string, JSONValue>,
  patch?: Record<string, JSONValue>,
) {
  if (!patch) return { ...base };
  const next = { ...base };
  Object.entries(patch).forEach(([name, value]) => {
    const definition = manifest.controls[name];
    if (!definition) throw new Error(`A prop “${name}” não existe em ${manifest.id}@${manifest.version}.`);
    const validation = getControlAdapter(definition.type).validate(value, definition, name);
    if (!validation.valid) {
      throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    }
    next[name] = value;
  });
  return next;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertControlValue(
  manifest: ComponentManifest,
  name: string,
  value: unknown,
  path = name,
) {
  const definition = manifest.controls[name];
  if (!definition) throw new Error(`A prop “${name}” não existe em ${manifest.id}@${manifest.version}.`);
  const validation = getControlAdapter(definition.type).validate(value, definition, path);
  if (!validation.valid) {
    throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  }
  return definition;
}

function responsiveValidationValue(base: unknown, override: unknown) {
  const baseObject = objectValue(base);
  const overrideObject = objectValue(override);
  return baseObject && overrideObject ? { ...baseObject, ...overrideObject } : override;
}

function validatedResponsiveProps(
  manifest: ComponentManifest,
  base: Record<string, ResponsiveValue<JSONValue>> = {},
  patch?: Record<string, ResponsiveValue<JSONValue>>,
) {
  if (!patch) return { ...base };
  const next = { ...base };
  Object.entries(patch).forEach(([name, responsive]) => {
    const definition = manifest.controls[name];
    if (!definition) throw new Error(`A prop “${name}” não existe em ${manifest.id}@${manifest.version}.`);
    if (definition.responsive !== true) {
      throw new Error(`A prop “${name}” não aceita valores responsivos em ${manifest.id}@${manifest.version}.`);
    }
    const value = objectValue(responsive);
    if (!value || !Object.hasOwn(value, 'base')) {
      throw new Error(`A prop responsiva “${name}” exige { base, overrides? }.`);
    }
    const overrides = value.overrides === undefined ? undefined : objectValue(value.overrides);
    if (value.overrides !== undefined && !overrides) {
      throw new Error(`Os overrides responsivos de “${name}” precisam ser um objeto.`);
    }
    assertControlValue(manifest, name, value.base, `${name}.base`);
    Object.entries(overrides || {}).forEach(([breakpoint, override]) => {
      if (override === undefined) return;
      assertControlValue(
        manifest,
        name,
        responsiveValidationValue(value.base, override),
        `${name}.overrides.${breakpoint}`,
      );
    });
    next[name] = {
      base: value.base as JSONValue,
      ...(overrides ? { overrides: { ...overrides } as ResponsiveValue<JSONValue>['overrides'] } : {}),
    };
  });
  return next;
}

const DATA_BINDING_TYPES = new Set<DataBinding['type']>([
  'current-collection',
  'specific-item',
  'collection-query',
  'global-variable',
  'url-parameter',
  'authenticated-user',
  'server-function',
]);

function assertDataBinding(value: unknown, name: string): asserts value is DataBinding {
  const binding = objectValue(value);
  if (
    !binding
    || !DATA_BINDING_TYPES.has(binding.type as DataBinding['type'])
    || typeof binding.sourceId !== 'string'
    || !binding.sourceId.trim()
    || (binding.fieldId !== undefined && typeof binding.fieldId !== 'string')
    || (binding.transformId !== undefined && typeof binding.transformId !== 'string')
    || (binding.query !== undefined && !objectValue(binding.query))
  ) {
    throw new Error(`O binding de “${name}” não segue o contrato de DataBinding.`);
  }
}

function validatedBindings(
  manifest: ComponentManifest,
  base: Record<string, DataBinding> = {},
  patch?: Record<string, DataBinding>,
) {
  if (!patch) return { ...base };
  const next = { ...base };
  Object.entries(patch).forEach(([name, binding]) => {
    const definition = manifest.controls[name];
    if (!definition) throw new Error(`A prop “${name}” não existe em ${manifest.id}@${manifest.version}.`);
    if (definition.bindable !== true) {
      throw new Error(`A prop “${name}” não aceita binding em ${manifest.id}@${manifest.version}.`);
    }
    assertDataBinding(binding, name);
    next[name] = binding;
  });
  return next;
}

function assertSlotReference(
  value: unknown,
  name: string,
  instanceId: string,
  accepts: string[] | undefined,
): asserts value is SlotReference {
  const reference = objectValue(value);
  if (
    !reference
    || typeof reference.instanceId !== 'string'
    || !reference.instanceId.trim()
    || typeof reference.layerId !== 'string'
    || !reference.layerId.trim()
    || (reference.componentId !== undefined && typeof reference.componentId !== 'string')
  ) {
    throw new Error(`O slot “${name}” contém uma referência inválida.`);
  }
  if (reference.instanceId === instanceId) {
    throw new Error(`O slot “${name}” não pode referenciar a própria instância.`);
  }
  if (
    accepts?.length
    && typeof reference.componentId === 'string'
    && !accepts.includes(reference.componentId)
  ) {
    throw new Error(`O slot “${name}” não aceita o componente ${reference.componentId}.`);
  }
}

function validatedSlots(
  manifest: ComponentManifest,
  instanceId: string,
  base: Record<string, SlotReference | SlotReference[]> = {},
  patch?: Record<string, SlotReference | SlotReference[]>,
) {
  if (!patch) return { ...base };
  const next = { ...base };
  Object.entries(patch).forEach(([name, slot]) => {
    const definition = manifest.controls[name];
    if (!definition) throw new Error(`A prop “${name}” não existe em ${manifest.id}@${manifest.version}.`);
    if (definition.type !== ControlType.Slot && definition.type !== ControlType.Slots) {
      throw new Error(`A prop “${name}” não é um controle Slot/Slots em ${manifest.id}@${manifest.version}.`);
    }
    if (definition.type === ControlType.Slot && Array.isArray(slot)) {
      throw new Error(`O slot “${name}” aceita somente uma referência.`);
    }
    if (definition.type === ControlType.Slots && !Array.isArray(slot)) {
      throw new Error(`O slot “${name}” exige uma lista de referências.`);
    }
    const references = Array.isArray(slot) ? slot : [slot];
    if (definition.type === ControlType.Slots) {
      if (definition.minCount !== undefined && references.length < definition.minCount) {
        throw new Error(`O slot “${name}” exige no mínimo ${definition.minCount} referência(s).`);
      }
      if (definition.maxCount !== undefined && references.length > definition.maxCount) {
        throw new Error(`O slot “${name}” aceita no máximo ${definition.maxCount} referência(s).`);
      }
    }
    references.forEach(reference => assertSlotReference(
      reference,
      name,
      instanceId,
      definition.accepts,
    ));
    next[name] = slot;
  });
  return next;
}

function createInstance(
  manifest: ComponentManifest,
  id: string,
  change: Extract<CodeComponentAgentChange, { type: 'insertInstance' }>,
) {
  const now = new Date().toISOString();
  const responsiveProps = change.responsiveProps
    ? validatedResponsiveProps(manifest, {}, change.responsiveProps)
    : undefined;
  const bindings = change.bindings
    ? validatedBindings(manifest, {}, change.bindings)
    : undefined;
  const slots = change.slots
    ? validatedSlots(manifest, id, {}, change.slots)
    : undefined;
  return {
    schemaVersion: '1.0.0',
    id,
    componentId: manifest.id,
    componentVersion: manifest.version,
    props: validatedProps(manifest, manifest.defaultProps, change.props),
    ...(responsiveProps ? { responsiveProps } : {}),
    ...(bindings ? { bindings } : {}),
    ...(slots ? { slots } : {}),
    sizing: {
      widthMode: manifest.sizing.width,
      heightMode: manifest.sizing.height,
      width: manifest.sizing.defaultWidth,
      height: manifest.sizing.defaultHeight,
      ...(change.sizing || {}),
    },
    metadata: { createdAt: now, updatedAt: now },
  } satisfies CodeComponentInstance;
}

function replaceInstanceMarker(project: HtmlProject, instance: CodeComponentInstance) {
  let next = project;
  Object.values(project.files).forEach(file => {
    if (file.text === undefined || !/\.html?$/i.test(file.path)) return;
    const matches = inspectSourceElements(file.text).filter(
      element => element.attributes['data-coday-code-instance'] === instance.id,
    );
    if (!matches.length) return;
    const text = patchReplaceLocatedElementsOuterHtml(
      file.text,
      matches.map(match => ({
        startOffset: match.startOffset,
        endOffset: match.endOffset,
        markup: codeComponentMarkup(instance),
      })),
    );
    next = updateTextFile(next, file.path, text);
  });
  return next;
}

function removeInstanceMarkers(project: HtmlProject, instanceId: string) {
  let next = project;
  const removed: Array<{ pagePath: string; selectionPath: string }> = [];
  Object.values(project.files).forEach(file => {
    if (file.text === undefined || !/\.html?$/i.test(file.path)) return;
    const matches = inspectSourceElements(file.text)
      .filter(element => element.attributes['data-coday-code-instance'] === instanceId)
      .sort((left, right) => right.startOffset - left.startOffset);
    if (!matches.length) return;
    let text = file.text;
    matches.forEach(match => {
      text = patchRemoveElement(text, match.path);
      removed.push({ pagePath: file.path, selectionPath: match.path });
    });
    next = updateTextFile(next, file.path, text);
  });
  return { project: next, removed };
}

function updateRegistryInstance(
  project: HtmlProject,
  instanceId: string,
  updater: (instance: CodeComponentInstance) => CodeComponentInstance | null,
) {
  let found = false;
  const next = updateEditorMetadata(project, metadata => {
    const snapshot = normalizeCodeComponentRegistry(metadata.codeComponents);
    const instances = snapshot.instances.flatMap(instance => {
      if (instance.id !== instanceId) return [instance];
      found = true;
      const updated = updater(instance);
      return updated ? [updated] : [];
    });
    return { ...metadata, codeComponents: { ...snapshot, instances } };
  });
  if (!found) throw new Error(`A instância ${instanceId} não existe no projeto.`);
  return next;
}

export function codeComponentAgentSnapshot(
  project: HtmlProject,
  compileState: Record<string, CodeComponentCompileState> = {},
  options: { sourcePaths?: string[]; componentIds?: string[]; includeInstances?: boolean } = {},
) {
  const snapshot = normalizeCodeComponentRegistry(readEditorMetadata(project).codeComponents);
  const requestedSources = new Set((options.sourcePaths || []).map(normalizedCodeComponentPath));
  const requestedComponents = new Set(options.componentIds || []);
  return {
    sources: codeComponentSources(project).map(path => ({
      path,
      size: project.files[path]?.text?.length || 0,
      ...(requestedSources.has(path) ? { source: project.files[path]?.text || '' } : {}),
      compile: compileState[path] || null,
    })),
    components: snapshot.components
      .filter(component => !requestedComponents.size || requestedComponents.has(component.id))
      .map(component => ({
        id: component.id,
        version: component.version,
        publishedAt: component.publishedAt,
        author: component.author,
        manifest: component.manifest,
        dependencies: component.dependencies,
      })),
    ...(options.includeInstances === false ? {} : { instances: snapshot.instances }),
  };
}

export async function applyCodeComponentAgentChanges(
  project: HtmlProject,
  changes: CodeComponentAgentChange[],
  options: ApplyCodeComponentAgentChangesOptions = {},
) {
  if (!changes.length) throw new Error('Nenhuma alteração de Code Component foi informada.');
  let next = project;
  const results: CodeComponentAgentChangeResult[] = [];
  const changedFiles = new Set<string>();
  const createInstanceId = options.createInstanceId
    || (() => globalThis.crypto?.randomUUID?.() || `cci-${Date.now().toString(36)}`);

  for (const change of changes) {
    if (change.type === 'upsertSource') {
      const filePath = assertCodeComponentSourcePath(change.filePath);
      if (!isCodeComponentSource(filePath, change.source)) {
        throw new Error(`${filePath} não declara defineComponent ou addPropertyControls.`);
      }
      if (!next.files[filePath]) next = addProjectTextFile(next, filePath);
      next = updateTextFile(next, filePath, change.source);
      const compiled = await compileCodeComponentProjectFile(next, filePath, options.author || 'Kodety Agent');
      if (!compiled.result.success || !compiled.result.componentManifest) {
        throw new Error(compactDiagnostics(compiled.result, filePath));
      }
      next = compiled.project;
      changedFiles.add(filePath);
      results.push({
        type: change.type,
        filePath,
        componentId: compiled.result.componentManifest.id,
        componentVersion: compiled.result.componentManifest.version,
        diagnostics: compiled.result.diagnostics,
      });
      continue;
    }

    if (change.type === 'insertInstance') {
      const published = publishedVersion(next, change.componentId, change.componentVersion);
      const pagePath = change.pagePath.trim();
      const page = next.files[pagePath];
      if (page?.text === undefined || !/\.html?$/i.test(pagePath)) {
        throw new Error(`A página “${pagePath}” não existe no projeto.`);
      }
      const instance = createInstance(published.manifest, createInstanceId(), change);
      const placement = change.placement || 'after';
      const parentPath = change.selectionPath || null;
      const inserted = placement === 'inside'
        ? (() => {
            const index = getElementChildCount(page.text, parentPath);
            return {
              source: patchInsertElement(page.text, parentPath, codeComponentMarkup(instance)),
              path: parentPath ? `${parentPath}/${index}` : String(index),
            };
          })()
        : patchInsertAdjacentElement(
            page.text,
            change.selectionPath || '',
            codeComponentMarkup(instance),
            placement,
          );
      next = updateTextFile(next, pagePath, inserted.source);
      next = updateEditorMetadata(next, metadata => {
        const registry = normalizeCodeComponentRegistry(metadata.codeComponents);
        return {
          ...metadata,
          codeComponents: { ...registry, instances: [...registry.instances, instance] },
        };
      });
      changedFiles.add(pagePath);
      results.push({
        type: change.type,
        componentId: instance.componentId,
        componentVersion: instance.componentVersion,
        instanceId: instance.id,
        pagePath,
        selectionPath: inserted.path,
      });
      continue;
    }

    if (change.type === 'updateInstance') {
      next = updateRegistryInstance(next, change.instanceId, instance => {
        const published = publishedVersion(
          next,
          instance.componentId,
          change.componentVersion || instance.componentVersion,
        );
        return {
          ...instance,
          componentVersion: published.version,
          props: validatedProps(published.manifest, instance.props, change.props),
          ...(change.responsiveProps ? {
            responsiveProps: validatedResponsiveProps(
              published.manifest,
              instance.responsiveProps,
              change.responsiveProps,
            ),
          } : {}),
          ...(change.bindings ? {
            bindings: validatedBindings(published.manifest, instance.bindings, change.bindings),
          } : {}),
          ...(change.slots ? {
            slots: validatedSlots(
              published.manifest,
              instance.id,
              instance.slots,
              change.slots,
            ),
          } : {}),
          sizing: { ...instance.sizing, ...(change.sizing || {}) },
          metadata: { ...instance.metadata, updatedAt: new Date().toISOString() },
        };
      });
      const updatedInstance = normalizeCodeComponentRegistry(readEditorMetadata(next).codeComponents)
        .instances.find(instance => instance.id === change.instanceId);
      if (updatedInstance) next = replaceInstanceMarker(next, updatedInstance);
      Object.values(next.files).forEach(file => {
        if (/\.html?$/i.test(file.path) && project.files[file.path] !== file) changedFiles.add(file.path);
      });
      results.push({
        type: change.type,
        componentId: updatedInstance?.componentId,
        componentVersion: updatedInstance?.componentVersion,
        instanceId: change.instanceId,
      });
      continue;
    }

    if (change.type === 'removeInstance') {
      if (!options.confirmDestructive) {
        throw new Error('Remover uma instância exige confirmDestructive: true e um pedido explícito do usuário.');
      }
      const removed = removeInstanceMarkers(next, change.instanceId);
      next = updateRegistryInstance(removed.project, change.instanceId, () => null);
      removed.removed.forEach(item => changedFiles.add(item.pagePath));
      results.push({ type: change.type, instanceId: change.instanceId });
      continue;
    }

    if (change.type === 'removeSource') {
      if (!options.confirmDestructive) {
        throw new Error('Remover a fonte exige confirmDestructive: true e um pedido explícito do usuário.');
      }
      const filePath = assertCodeComponentSourcePath(change.filePath);
      if (!next.files[filePath]) throw new Error(`O arquivo ${filePath} não existe.`);
      next = removeProjectFile(next, filePath);
      changedFiles.add(filePath);
      results.push({ type: change.type, filePath });
    }
  }

  return { project: next, results, changedFiles: [...changedFiles] };
}
