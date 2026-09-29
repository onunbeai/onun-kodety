import type { ControlCondition, JSONValue } from './types';

export function valueAtPath(values: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, values);
}

function same(left: unknown, right: JSONValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateCondition(condition: ControlCondition | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return false;
  if ('and' in condition) return condition.and.every(item => evaluateCondition(item, values));
  if ('or' in condition) return condition.or.some(item => evaluateCondition(item, values));
  if ('not' in condition) return !evaluateCondition(condition.not, values);
  const actual = valueAtPath(values, condition.property);
  switch (condition.operator) {
    case 'equals': return same(actual, condition.value);
    case 'not-equals': return !same(actual, condition.value);
    case 'includes': return Array.isArray(actual) ? actual.some(item => same(item, condition.value)) : String(actual ?? '').includes(String(condition.value ?? ''));
    case 'not-includes': return !(Array.isArray(actual) ? actual.some(item => same(item, condition.value)) : String(actual ?? '').includes(String(condition.value ?? '')));
    case 'greater-than': return Number(actual) > Number(condition.value);
    case 'less-than': return Number(actual) < Number(condition.value);
    case 'exists': return condition.value === false ? actual == null : actual != null;
  }
}
