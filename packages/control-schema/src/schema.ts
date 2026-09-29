import { ControlType, type ControlDefinition, type JSONValue, type SerializableControlDefinition, type ValidationIssue, type ValidationResult } from './types';
import { validateControlValue } from './adapters';

function jsonClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function assertSerializable(value: unknown, path: string, seen = new WeakSet<object>()): void {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || value === undefined) throw new Error(`${path} contém um valor não serializável.`);
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`${path} contém uma referência circular.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertSerializable(entry, `${path}.${index}`, seen));
  else Object.entries(value).forEach(([key, entry]) => assertSerializable(entry, `${path}.${key}`, seen));
  seen.delete(value);
}

export function serializeControlDefinition(definition: ControlDefinition): SerializableControlDefinition {
  assertSerializable(definition, 'control');
  if (definition.type === ControlType.Array && 'itemTitle' in definition) throw new Error('Use itemTitleAdapter em vez de funções em controles Array.');
  return jsonClone(definition);
}

export function serializeControlMap(controls: Record<string, ControlDefinition>) {
  return Object.fromEntries(Object.entries(controls).map(([key, definition]) => [key, serializeControlDefinition(definition)]));
}

export function defaultValuesFromControls(controls: Record<string, ControlDefinition>): Record<string, JSONValue> {
  const values: Record<string, JSONValue> = {};
  Object.entries(controls).forEach(([key, control]) => {
    if (control.defaultValue !== undefined) values[key] = jsonClone(control.defaultValue) as JSONValue;
    else if (control.type === ControlType.Object) values[key] = defaultValuesFromControls(control.controls);
    else if (control.type === ControlType.Array || control.type === ControlType.Slots) values[key] = [];
  });
  return values;
}

export function validateDefaults(controls: Record<string, ControlDefinition>): ValidationResult {
  const issues: ValidationIssue[] = [];
  Object.entries(controls).forEach(([key, definition]) => {
    if (definition.defaultValue !== undefined) issues.push(...validateControlValue(definition, definition.defaultValue, key).issues);
    if (definition.type === ControlType.Enum && definition.optionTitles && definition.optionTitles.length !== definition.options.length) issues.push({ path: key, code: 'option-titles', message: 'optionTitles deve ter o mesmo tamanho de options.', severity: 'error' });
    if (definition.type === ControlType.Enum && definition.optionIcons && definition.optionIcons.length !== definition.options.length) issues.push({ path: key, code: 'option-icons', message: 'optionIcons deve ter o mesmo tamanho de options.', severity: 'error' });
    if (definition.type === ControlType.Object) issues.push(...validateDefaults(definition.controls).issues.map(issue => ({ ...issue, path: `${key}.${issue.path}` })));
  });
  return { valid: !issues.some(issue => issue.severity === 'error'), issues };
}

export const CONTROL_DEFINITION_SCHEMA_VERSION = '1.0.0';
