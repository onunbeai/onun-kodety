import type { CssPseudoState } from './css-patcher';

interface InspectorStyleValueLayers {
  pseudo: CssPseudoState;
  computedFallback?: Record<string, string>;
  inheritedBreakpointStyles?: Record<string, string>;
  inlineStyles?: Record<string, string>;
  ruleStyles?: Record<string, string>;
  authoredProjectionStyles?: Record<string, string>;
  keyframeStyles?: Record<string, string>;
  liveStyles?: Record<string, string>;
  optimisticStyles?: Record<string, string>;
}

/**
 * Resolves the values presented by Inspector controls for one authoring state.
 *
 * The canvas snapshot describes the resting/base element. A pseudo-state rule
 * must therefore be applied after every base projection; otherwise an authored
 * viewport value from the normal state can hide the Hover/Focus override. Live
 * and optimistic edits stay last so typing and scrubbing remain immediate.
 */
export function resolveInspectorStyleValues({
  pseudo,
  computedFallback = {},
  inheritedBreakpointStyles = {},
  inlineStyles = {},
  ruleStyles = {},
  authoredProjectionStyles = {},
  keyframeStyles = {},
  liveStyles = {},
  optimisticStyles = {},
}: InspectorStyleValueLayers): Record<string, string> {
  if (pseudo === 'base') {
    return {
      ...computedFallback,
      ...inheritedBreakpointStyles,
      ...ruleStyles,
      ...inlineStyles,
      ...authoredProjectionStyles,
      ...keyframeStyles,
      ...liveStyles,
      ...optimisticStyles,
    };
  }

  return {
    ...computedFallback,
    ...authoredProjectionStyles,
    ...inheritedBreakpointStyles,
    ...ruleStyles,
    ...keyframeStyles,
    ...liveStyles,
    ...optimisticStyles,
  };
}

function splitCustomPropertyBody(body: string): { name: string; fallback: string } {
  let nesting = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '(') nesting += 1;
    else if (body[index] === ')') nesting = Math.max(0, nesting - 1);
    else if (body[index] === ',' && nesting === 0) {
      return {
        name: body.slice(0, index).trim(),
        fallback: body.slice(index + 1).trim(),
      };
    }
  }
  return { name: body.trim(), fallback: '' };
}

/**
 * Resolve CSS custom properties for Inspector display only. The authored value
 * remains untouched elsewhere, so viewing `var(--accent)` as its effective
 * colour never rewrites or detaches the variable binding.
 */
export function resolveInspectorCustomProperties(
  value: string,
  customProperties: Record<string, string>,
  depth = 0,
  resolving = new Set<string>(),
): string {
  if (!value.includes('var(') || depth >= 8) return value;
  let output = '';
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf('var(', cursor);
    if (start < 0) {
      output += value.slice(cursor);
      break;
    }
    output += value.slice(cursor, start);
    let index = start + 4;
    let nesting = 1;
    for (; index < value.length && nesting > 0; index += 1) {
      if (value[index] === '(') nesting += 1;
      else if (value[index] === ')') nesting -= 1;
    }
    if (nesting !== 0) {
      output += value.slice(start);
      break;
    }

    const body = value.slice(start + 4, index - 1);
    const { name, fallback } = splitCustomPropertyBody(body);
    const isCustomProperty = /^--[\w-]+$/.test(name);
    const customValue = isCustomProperty ? customProperties[name]?.trim() || '' : '';
    if (customValue && !resolving.has(name)) {
      const nextResolving = new Set(resolving);
      nextResolving.add(name);
      output += resolveInspectorCustomProperties(
        customValue,
        customProperties,
        depth + 1,
        nextResolving,
      );
    } else if (fallback) {
      output += resolveInspectorCustomProperties(fallback, customProperties, depth + 1, resolving);
    } else {
      output += `var(${body})`;
    }
    cursor = index;
  }

  return output === value
    ? value
    : resolveInspectorCustomProperties(output, customProperties, depth + 1, resolving);
}
