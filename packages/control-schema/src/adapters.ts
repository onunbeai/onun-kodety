import { ControlType, type ControlAdapter, type ControlDefinition, type JSONValue, type ValidationIssue, type ValidationResult } from './types';

function result(issues: ValidationIssue[]): ValidationResult { return { valid: !issues.some(issue => issue.severity === 'error'), issues } }
function issue(path: string, code: string, message: string): ValidationIssue { return { path, code, message, severity: 'error' } }
function clone<T>(value: T): T { return value == null ? value : JSON.parse(JSON.stringify(value)) as T }
function json(value: unknown): JSONValue {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('O valor não é serializável em JSON.');
  return JSON.parse(serialized) as JSONValue;
}

const passthrough: ControlAdapter = {
  parse: raw => clone(raw),
  validate: (value, _definition, path = '') => result(value === undefined ? [issue(path, 'required-value', 'Valor ausente.')] : []),
  normalize: value => clone(value),
  serialize: value => json(value),
  deserialize: value => clone(value),
};

const stringAdapter: ControlAdapter<string> = {
  parse: raw => String(raw ?? ''),
  validate(value, definition, path = '') {
    const control = definition as Extract<ControlDefinition, { type: ControlType.String | ControlType.Text }>;
    const issues: ValidationIssue[] = [];
    if (typeof value !== 'string') issues.push(issue(path, 'type', 'Esperado texto.'));
    if (control.maxLength !== undefined && value.length > control.maxLength) issues.push(issue(path, 'max-length', `Máximo de ${control.maxLength} caracteres.`));
    if (control.type === ControlType.String && control.pattern) {
      try { if (!new RegExp(control.pattern).test(value)) issues.push(issue(path, 'pattern', 'O valor não corresponde ao formato esperado.')); }
      catch { issues.push(issue(path, 'invalid-pattern', 'A expressão regular do controle é inválida.')); }
    }
    return result(issues);
  },
  normalize: value => value,
  serialize: value => value,
  deserialize: value => String(value ?? ''),
};

const numberAdapter: ControlAdapter<number> = {
  parse: raw => Number(raw),
  validate(value, definition, path = '') {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Number }>;
    const issues = !Number.isFinite(value) ? [issue(path, 'number', 'Esperado número finito.')] : [];
    if (control.min !== undefined && value < control.min) issues.push(issue(path, 'min', `Mínimo: ${control.min}.`));
    if (control.max !== undefined && value > control.max) issues.push(issue(path, 'max', `Máximo: ${control.max}.`));
    return result(issues);
  },
  normalize(value, definition) {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Number }>;
    const stepped = control.step ? Math.round(value / control.step) * control.step : value;
    return Math.min(control.max ?? Infinity, Math.max(control.min ?? -Infinity, stepped));
  },
  serialize: value => value,
  deserialize: value => Number(value),
};

const booleanAdapter: ControlAdapter<boolean> = {
  parse: raw => raw === true || raw === 'true' || raw === 1,
  validate: (value, _definition, path = '') => result(typeof value === 'boolean' ? [] : [issue(path, 'type', 'Esperado booleano.')]),
  normalize: value => Boolean(value), serialize: value => value, deserialize: value => Boolean(value),
};

const enumAdapter: ControlAdapter<JSONValue> = {
  parse: raw => json(raw),
  validate(value, definition, path = '') {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Enum }>;
    return result(control.options.some(option => JSON.stringify(option) === JSON.stringify(value)) ? [] : [issue(path, 'enum', 'Opção não permitida.')]);
  },
  normalize: value => clone(value),
  serialize: value => clone(value),
  deserialize: value => clone(value),
};

const arrayAdapter: ControlAdapter<JSONValue[]> = {
  parse: raw => Array.isArray(raw) ? clone(raw) as JSONValue[] : [],
  validate(value, definition, path = '') {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Array | ControlType.Slots }>;
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(value)) return result([issue(path, 'type', 'Esperada lista.')]);
    if (control.minCount !== undefined && value.length < control.minCount) issues.push(issue(path, 'min-count', `Mínimo de ${control.minCount} itens.`));
    if (control.maxCount !== undefined && value.length > control.maxCount) issues.push(issue(path, 'max-count', `Máximo de ${control.maxCount} itens.`));
    if (control.type === ControlType.Array) value.forEach((entry, index) => issues.push(...getControlAdapter(control.control.type).validate(entry, control.control, `${path}.${index}`).issues));
    return result(issues);
  },
  normalize(value, definition) {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Array | ControlType.Slots }>;
    return value.slice(0, control.maxCount ?? value.length);
  },
  serialize: value => json(value), deserialize: value => Array.isArray(value) ? clone(value) : [],
};

const objectAdapter: ControlAdapter<Record<string, unknown>> = {
  parse: raw => raw && typeof raw === 'object' && !Array.isArray(raw) ? clone(raw as Record<string, unknown>) : {},
  validate(value, definition, path = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result([issue(path, 'type', 'Esperado objeto.')]);
    const control = definition as Extract<ControlDefinition, { type: ControlType.Object }>;
    const issues = Object.entries(control.controls).flatMap(([key, child]) => value[key] === undefined ? [] : getControlAdapter(child.type).validate(value[key], child, path ? `${path}.${key}` : key).issues);
    return result(issues);
  },
  normalize(value, definition) {
    const control = definition as Extract<ControlDefinition, { type: ControlType.Object }>;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      const child = control.controls[key];
      return [key, child ? getControlAdapter(child.type).normalize(entry, child) : entry];
    }));
  },
  serialize: value => json(value), deserialize: value => value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {},
};

const adapters = new Map<ControlType, ControlAdapter>();
[ControlType.String, ControlType.Text, ControlType.Date].forEach(type => adapters.set(type, stringAdapter));
adapters.set(ControlType.Number, numberAdapter);
adapters.set(ControlType.Boolean, booleanAdapter);
adapters.set(ControlType.Enum, enumAdapter);
adapters.set(ControlType.Object, objectAdapter);
adapters.set(ControlType.Array, arrayAdapter);
adapters.set(ControlType.Slots, arrayAdapter);
Object.values(ControlType).forEach(type => { if (!adapters.has(type)) adapters.set(type, passthrough); });

export function registerControlAdapter(type: ControlType, adapter: ControlAdapter) { adapters.set(type, adapter) }
export function getControlAdapter(type: ControlType): ControlAdapter {
  const adapter = adapters.get(type);
  if (!adapter) throw new Error(`Adapter não registrado para ${type}.`);
  return adapter;
}

export function validateControlValue(definition: ControlDefinition, value: unknown, path = ''): ValidationResult {
  if (value === undefined && definition.defaultValue === undefined && definition.type !== ControlType.Slot && definition.type !== ControlType.Slots) return result([]);
  return getControlAdapter(definition.type).validate(value, definition, path);
}

export function normalizeControlValue(definition: ControlDefinition, raw: unknown): JSONValue {
  const adapter = getControlAdapter(definition.type);
  const parsed = adapter.parse(raw, definition);
  const validation = adapter.validate(parsed, definition);
  if (!validation.valid) throw new ControlValidationError(validation);
  return adapter.serialize(adapter.normalize(parsed, definition), definition);
}

export class ControlValidationError extends Error {
  constructor(public readonly validation: ValidationResult) { super(validation.issues.map(item => item.message).join(' ')); this.name = 'ControlValidationError' }
}
