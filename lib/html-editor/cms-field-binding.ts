import type { SelectionSnapshot } from './types';

export const CMS_FIELD_BINDING_TARGETS = ['content', 'title', 'href', 'src', 'alt'] as const;
export type CmsFieldBindingTarget = (typeof CMS_FIELD_BINDING_TARGETS)[number];
export type CmsFieldBindingKind = 'text' | 'image' | 'link';

/**
 * Read the binding that belongs to one property. The legacy binding pair is
 * deliberately target-aware so a content binding cannot expose CMS controls
 * beside unrelated properties such as title or alt.
 */
export function cmsFieldBindingForTarget(
  selection: Pick<SelectionSnapshot, 'tag' | 'attributes'>,
  target: CmsFieldBindingTarget,
) {
  const direct = selection.attributes[`data-kodety-bind-${target}`] || '';
  if (direct) return direct;
  const legacyTarget = selection.attributes['data-kodety-bind-target']
    || (selection.tag === 'a' ? 'href' : ['img', 'source', 'video'].includes(selection.tag) ? 'src' : 'content');
  return legacyTarget === target ? selection.attributes['data-kodety-bind'] || '' : '';
}

/** A data context, unlike cmsSchemaUrl, means the selected property can
 * actually resolve an item. Stale data-kodety-bind-type is intentionally not
 * accepted by itself because it may remain after a binding is disconnected.
 */
export function cmsFieldBindingContextType(
  selection: Pick<SelectionSnapshot, 'attributes'>,
  inheritedCollectionType = '',
  templatePostType = '',
) {
  return inheritedCollectionType
    || selection.attributes['data-kodety-collection']
    || templatePostType
    || '';
}

export function canShowCmsFieldBinding({
  endpointAvailable,
  contextType,
  activeBinding,
}: {
  endpointAvailable: boolean;
  contextType: string;
  activeBinding: string;
}) {
  // Keep an authored binding reachable even if its endpoint/context became
  // invalid, otherwise the user would have no way to repair or disconnect it.
  return Boolean(activeBinding || (endpointAvailable && contextType));
}

export function isCmsFieldCompatible(
  field: { type: string },
  kind: CmsFieldBindingKind,
) {
  if (kind === 'image') return ['image', 'url'].includes(field.type);
  if (kind === 'link') return ['url', 'page_link', 'link'].includes(field.type);
  return !['image', 'file', 'gallery'].includes(field.type);
}

export function shouldRenderCmsFieldBindingControl(
  activeBinding: string,
  compatibleFieldCount: number,
) {
  return Boolean(activeBinding || compatibleFieldCount > 0);
}
