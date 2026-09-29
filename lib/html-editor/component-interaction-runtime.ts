import {
  readInteractionDocumentFile,
  type InteractionActionTarget,
  type InteractionBehavior,
  type InteractionDefinition,
  type InteractionDocument,
} from './interactions';
import {
  type HtmlComponentLibrary,
} from './html-components';
import { inspectSourceElements, type SourceElementSnapshot } from './source-patcher';
import type { HtmlProject } from './types';

const COMPONENT_ID_ATTRIBUTE = 'data-kodety-component-id';
const COMPONENT_INSTANCE_ATTRIBUTE = 'data-kodety-component-instance';
const COMPONENT_STATE_VARIANT_ATTRIBUTE = 'data-kodety-component-state-variant';

function cssAttributeValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function componentRootSelector(
  node: SourceElementSnapshot,
  stateVariantId = '',
) {
  const instanceId = node.attributes[COMPONENT_INSTANCE_ATTRIBUTE] || '';
  const componentId = node.attributes[COMPONENT_ID_ATTRIBUTE] || '';
  if (!instanceId || !componentId) return '';
  return `[${COMPONENT_INSTANCE_ATTRIBUTE}="${cssAttributeValue(instanceId)}"]`
    + `[${COMPONENT_ID_ATTRIBUTE}="${cssAttributeValue(componentId)}"]`
    + (stateVariantId
      ? `[${COMPONENT_STATE_VARIANT_ATTRIBUTE}="${cssAttributeValue(stateVariantId)}"]`
      : '');
}

function componentAncestryIndex(nodes: SourceElementSnapshot[]) {
  const ancestry = new Map<string, SourceElementSnapshot[]>();
  const stack: SourceElementSnapshot[] = [];
  nodes.forEach(node => {
    while (
      stack.length
      && !node.path.startsWith(`${stack[stack.length - 1].path}/`)
    ) stack.pop();
    const lineage = [...stack, node];
    ancestry.set(node.path, lineage);
    stack.push(node);
  });
  return ancestry;
}

function exactAttributeSelector(selector: string) {
  const match = selector.trim().match(
    /^\[\s*([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["'])((?:\\.|(?!\2)[\s\S])*)\2\s*\]$/,
  );
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    value: match[3].replace(/\\([\\"'])/g, '$1'),
  };
}

function selectorTargetsComponentRoot(
  selector: string,
  rootAttributes: Record<string, string>,
) {
  const normalized = selector.trim();
  if (!normalized || /^(?:html|body|:root)$/i.test(normalized)) return true;
  const attribute = exactAttributeSelector(normalized);
  if (attribute) return rootAttributes[attribute.name] === attribute.value;
  const id = normalized.match(/^#([-_a-zA-Z0-9]+)$/)?.[1] || '';
  return Boolean(id && rootAttributes.id === id);
}

function splitSelectorList(selector: string) {
  const selectors: string[] = [];
  let start = 0;
  let squareDepth = 0;
  let roundDepth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (character === ',' && !squareDepth && !roundDepth) {
      const part = selector.slice(start, index).trim();
      if (part) selectors.push(part);
      start = index + 1;
    }
  }
  const tail = selector.slice(start).trim();
  if (tail) selectors.push(tail);
  return selectors;
}

function rebaseMasterDocumentPrefix(selector: string) {
  let remainder = selector.trim();
  let rebased = false;
  while (remainder) {
    const anchor = remainder.match(/^(?::root|html|body)(?=$|\s|[>+~.#:]|\[)/i);
    if (!anchor) break;
    rebased = true;
    remainder = remainder.slice(anchor[0].length).trimStart();
    if (/^[>+~]/.test(remainder)) remainder = remainder.slice(1).trimStart();
  }
  return { rebased, selector: remainder };
}

function scopeOneDocumentSelector(
  selector: string,
  rootScope: string,
  rootAttributes: Record<string, string>,
) {
  if (/^(?:(?:html|:root)\s*>\s*)?body\s*>\s*:first-child$/i.test(selector.trim())) {
    return rootScope;
  }
  const rebased = rebaseMasterDocumentPrefix(selector);
  const normalized = rebased.selector.trim();
  if (!normalized || selectorTargetsComponentRoot(normalized, rootAttributes)) {
    return rootScope;
  }
  return `${rootScope}:is(${normalized}), ${rootScope} :is(${normalized})`;
}

function scopeDocumentSelector(
  selector: string,
  rootScope: string,
  rootAttributes: Record<string, string>,
) {
  const normalized = selector.trim();
  if (!normalized) return rootScope;
  const selectors = splitSelectorList(normalized);
  return Array.from(new Set(selectors.map(item => (
    scopeOneDocumentSelector(item, rootScope, rootAttributes)
  )))).join(', ');
}

function scopeRelativeSelector(selector: string, rootScope: string) {
  const normalized = selector.trim();
  const containment = `:is(${rootScope}, ${rootScope} *)`;
  return normalized ? `:is(${normalized})${containment}` : containment;
}

function scopeTarget(
  target: InteractionActionTarget,
  rootScope: string,
  rootAttributes: Record<string, string>,
): InteractionActionTarget {
  if (target.scope === 'trigger' || target.scope === 'children' || target.scope === 'descendants') {
    return { ...target };
  }
  if (target.scope === 'document') {
    return {
      ...target,
      selector: scopeDocumentSelector(target.selector, rootScope, rootAttributes),
      mode: 'selector',
    };
  }
  // Relative traversal such as parent/closest/siblings can otherwise leave the
  // component and mutate a neighbouring page element. Keep the authored
  // traversal semantics, but require the resolved element to remain in this
  // concrete component instance.
  return {
    ...target,
    selector: scopeRelativeSelector(target.selector, rootScope),
    mode: 'selector',
  };
}

function scopeBehavior(
  behavior: InteractionBehavior | null,
  rootScope: string,
  rootAttributes: Record<string, string>,
): InteractionBehavior | null {
  if (!behavior) return null;
  const target = scopeTarget(behavior.target, rootScope, rootAttributes);
  if (behavior.kind !== 'image-sequence' && behavior.kind !== 'video-scrub') {
    return { ...behavior, target };
  }
  return {
    ...behavior,
    target,
    milestones: behavior.milestones.map(milestone => ({
      ...milestone,
      selector: scopeDocumentSelector(
        milestone.selector,
        rootScope,
        rootAttributes,
      ),
    })),
  };
}

function namespacedId(namespace: string, id: string, fallback: string) {
  return `${namespace}:${id || fallback}`;
}

function compileInteractionForInstance(
  interaction: InteractionDefinition,
  namespace: string,
  rootScope: string,
  rootAttributes: Record<string, string>,
): InteractionDefinition {
  return {
    ...interaction,
    id: namespacedId(namespace, interaction.id, 'interaction'),
    triggerSelector: scopeDocumentSelector(
      interaction.triggerSelector,
      rootScope,
      rootAttributes,
    ),
    triggerTargetMode: 'selector',
    scrollTriggerSelector: interaction.scrollTriggerSelector
      ? scopeDocumentSelector(
          interaction.scrollTriggerSelector,
          rootScope,
          rootAttributes,
        )
      : '',
    actions: interaction.actions.map((action, actionIndex) => ({
      ...action,
      id: namespacedId(namespace, action.id, `action-${actionIndex + 1}`),
      target: scopeTarget(action.target, rootScope, rootAttributes),
      from: { ...action.from },
      to: { ...action.to },
      keyframes: action.keyframes.map((keyframe, keyframeIndex) => ({
        ...keyframe,
        id: namespacedId(
          namespace,
          keyframe.id,
          `keyframe-${actionIndex + 1}-${keyframeIndex + 1}`,
        ),
        values: { ...keyframe.values },
      })),
    })),
    enabledBreakpoints: [...interaction.enabledBreakpoints],
    behavior: scopeBehavior(interaction.behavior, rootScope, rootAttributes),
  };
}

/**
 * Compile interactions authored on component masters into a page runtime.
 *
 * Every variant companion remains a source of truth. Runtime definitions are
 * cloned per rendered instance and per state, receive collision-free IDs, and
 * have every document-level selector constrained to that exact instance and
 * its current state (including component ancestry for nested masters). This is
 * essential for event chains: after A switches to B, B's click/hover listeners
 * must already exist in the published document and become active immediately.
 * Page interactions are retained unchanged at the front of the merged document.
 */
export function compileHtmlComponentInstanceInteractions(
  project: HtmlProject,
  hydratedPageSource: string,
  library: HtmlComponentLibrary,
  pageDocument: InteractionDocument,
): InteractionDocument {
  if (
    !library.components.length
    || !hydratedPageSource.includes(COMPONENT_ID_ATTRIBUTE)
  ) return pageDocument;

  const nodes = inspectSourceElements(hydratedPageSource);
  const componentNodes = nodes.filter(node => (
    Boolean(node.attributes[COMPONENT_ID_ATTRIBUTE])
    && Boolean(node.attributes[COMPONENT_INSTANCE_ATTRIBUTE])
  ));
  if (!componentNodes.length) return pageDocument;

  const components = new Map(library.components.map(component => [component.id, component]));
  // Component snapshots are emitted in document preorder. Build ancestry once
  // with a stack instead of scanning every component node for every instance.
  const ancestryByPath = componentAncestryIndex(componentNodes);
  // Many instances share the same variants. Companion JSON is immutable for
  // this compilation pass, so parse each variant companion at most once.
  const companionDocuments = new Map<string, InteractionDocument>();
  const compiled = componentNodes.flatMap(node => {
    const componentId = node.attributes[COMPONENT_ID_ATTRIBUTE] || '';
    const component = components.get(componentId);
    if (!component) return [];
    const ancestors = ancestryByPath.get(node.path) || [node];
    const namespaceParts = ancestors.map(ancestor => (
      `${ancestor.attributes[COMPONENT_ID_ATTRIBUTE]}@${ancestor.attributes[COMPONENT_INSTANCE_ATTRIBUTE]}`
    ));
    return component.variants.flatMap(variant => {
      if (!variant.filePath) return [];
      let masterDocument = companionDocuments.get(variant.filePath);
      if (!masterDocument) {
        masterDocument = readInteractionDocumentFile(project, variant.filePath);
        companionDocuments.set(variant.filePath, masterDocument);
      }
      if (!masterDocument.interactions.length) return [];
      const rootScope = ancestors.map((ancestor, index) => (
        componentRootSelector(
          ancestor,
          index === ancestors.length - 1 ? variant.id : '',
        )
      )).filter(Boolean).join(' ');
      if (!rootScope) return [];
      // Include both state and structural path as collision guards for old
      // projects that duplicated an instance identity before that invariant
      // was enforced by the source patcher.
      const namespace = `component:${namespaceParts.join('/')}:variant@${variant.id}:${node.path.replaceAll('/', '.')}`;
      return masterDocument.interactions.map(interaction => (
        compileInteractionForInstance(
          interaction,
          namespace,
          rootScope,
          node.attributes,
        )
      ));
    });
  });

  if (!compiled.length) return pageDocument;
  return {
    ...pageDocument,
    interactions: [...pageDocument.interactions, ...compiled],
  };
}
