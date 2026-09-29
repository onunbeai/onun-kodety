import { parse } from '@babel/parser';
import ts from 'typescript';
import { CONTROL_DEFINITION_SCHEMA_VERSION, ControlType, defaultValuesFromControls, serializeControlMap, validateDefaults, type ControlCondition, type ControlDefinition, type JSONValue } from '@coday/control-schema';
import type { ComponentCapability, ComponentManifest, ComponentSizing } from '@coday/components';

export type SourceLanguage = 'ts' | 'tsx' | 'js' | 'jsx';
export interface CompilerDiagnostic { severity: 'error' | 'warning' | 'info'; code: string; message: string; file?: string; line?: number; column?: number }
export interface CompileRequest {
  id?: string; fileName: string; source: string; language?: SourceLanguage; sources?: Record<string, string>;
  allowedImports?: string[]; importMap?: Record<string, string>; maxBundleBytes?: number; timeoutMs?: number; typeCheck?: boolean;
}
export interface CompileResult {
  success: boolean; code?: string; sourceMap?: string; componentManifest?: ComponentManifest;
  diagnostics: CompilerDiagnostic[]; dependencies: string[]; hash?: string; moduleGraph?: Record<string, string>;
}
interface AstNode { type: string; [key: string]: unknown }
const DEFAULT_ALLOWED = ['react', 'react-dom', 'react-dom/*', 'react/jsx-runtime', '@coday/components', 'framer'];
const COMPATIBILITY_IMPORT_MAP: Record<string, string> = {
  // `framer` is a source-authoring compatibility facade, not a runtime
  // dependency. Persist the executable module against Kodety's private SDK so
  // a newly compiled component also works in canvases/projects whose import
  // map predates Framer compatibility.
  framer: '@coday/components',
};
const VIRTUAL_MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

function diagnostic(error: unknown, file?: string): CompilerDiagnostic {
  const value = error as { message?: string; loc?: { line?: number; column?: number }; code?: string | number };
  return { severity: 'error', code: String(value.code || 'compile'), message: value.message || String(error), file, line: value.loc?.line, column: value.loc?.column === undefined ? undefined : value.loc.column + 1 };
}
function walk(node: unknown, visit: (node: AstNode) => void) {
  if (!node || typeof node !== 'object') return; const candidate = node as AstNode;
  if (typeof candidate.type === 'string') visit(candidate);
  Object.entries(candidate).forEach(([key, value]) => { if (!['loc', 'start', 'end', 'extra'].includes(key)) Array.isArray(value) ? value.forEach(item => walk(item, visit)) : walk(value, visit) });
}
function memberName(node: AstNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier') return String(node.name);
  if (node.type === 'StringLiteral') return String(node.value);
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return `${memberName(node.object as AstNode)}.${memberName(node.property as AstNode)}`;
  return '';
}
function componentExpressionName(node: AstNode | undefined): string {
  if (!node) return '';
  if (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(node.type)) {
    return componentExpressionName(node.expression as AstNode);
  }
  if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
    return memberName(node.id as AstNode);
  }
  return memberName(node);
}
function staticValue(node: AstNode): unknown {
  if (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(node.type)) return staticValue(node.expression as AstNode);
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'Identifier' && node.name === 'undefined') return undefined;
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+')) return Number(`${node.operator}${staticValue(node.argument as AstNode)}`);
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) return ((node.quasis as AstNode[])[0]?.value as { cooked?: string })?.cooked || '';
  if (node.type === 'ArrayExpression') return (node.elements as Array<AstNode | null>).map(item => item ? staticValue(item) : null);
  if (node.type === 'ObjectExpression') return Object.fromEntries((node.properties as AstNode[]).map(property => {
    if (property.type !== 'ObjectProperty' || property.computed || property.method) throw new Error('O manifest aceita apenas propriedades literais serializáveis.');
    return [memberName(property.key as AstNode), staticValue(property.value as AstNode)];
  }));
  if (node.type === 'MemberExpression') {
    const name = memberName(node); if (name.startsWith('ControlType.')) return name.slice('ControlType.'.length).replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`);
  }
  throw new Error(`Expressão ${node.type} não pode ser persistida no manifest.`);
}
const OMIT_STATIC_VALUE = Symbol('omit-static-value');

function unwrapExpression(node: AstNode): AstNode {
  if (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node.type)) {
    return unwrapExpression(node.expression as AstNode);
  }
  return node;
}

interface CallbackParameterScope {
  root?: string;
  bindings: Record<string, string>;
}

function callbackParameterScope(nodeValue: AstNode | undefined): CallbackParameterScope | null {
  if (!nodeValue) return null;
  const node = nodeValue.type === 'AssignmentPattern'
    ? nodeValue.left as AstNode
    : unwrapExpression(nodeValue);
  if (node.type === 'Identifier') return { root: String(node.name), bindings: {} };
  if (node.type !== 'ObjectPattern') return null;
  const bindings: Record<string, string> = {};
  const collect = (pattern: AstNode, prefix = ''): boolean => {
    for (const propertyNode of pattern.properties as AstNode[]) {
      if (propertyNode.type !== 'ObjectProperty' || propertyNode.computed) return false;
      const key = memberName(propertyNode.key as AstNode);
      if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      const path = prefix ? `${prefix}.${key}` : key;
      const valueNode = propertyNode.value as AstNode;
      if (valueNode.type === 'Identifier') {
        bindings[String(valueNode.name)] = path;
        continue;
      }
      if (valueNode.type === 'AssignmentPattern' && (valueNode.left as AstNode)?.type === 'Identifier') {
        bindings[String((valueNode.left as AstNode).name)] = path;
        continue;
      }
      if (valueNode.type === 'ObjectPattern' && collect(valueNode, path)) continue;
      return false;
    }
    return true;
  };
  return collect(node) ? { bindings } : null;
}

function callbackReturnExpression(nodeValue: AstNode): {
  expression: AstNode;
  parameter: CallbackParameterScope | null;
} | null {
  const node = unwrapExpression(nodeValue);
  if (!['ArrowFunctionExpression', 'FunctionExpression', 'ObjectMethod'].includes(node.type)) return null;
  const parameter = callbackParameterScope((node.params as AstNode[] | undefined)?.[0]);
  const body = node.body as AstNode;
  if (body?.type !== 'BlockStatement') return { expression: unwrapExpression(body), parameter };
  const returned = (body.body as AstNode[] | undefined)?.find(statement => statement.type === 'ReturnStatement');
  const argument = returned?.argument as AstNode | undefined;
  return argument ? { expression: unwrapExpression(argument), parameter } : null;
}

function callbackPropertyPath(nodeValue: AstNode, parameter: CallbackParameterScope): string | null {
  const node = unwrapExpression(nodeValue);
  if (node.type === 'Identifier') return parameter.bindings[String(node.name)] || null;
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) return null;
  const parts: string[] = [];
  let current: AstNode = node;
  while (['MemberExpression', 'OptionalMemberExpression'].includes(current.type)) {
    const propertyNode = current.property as AstNode;
    const key = memberName(propertyNode);
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) return null;
    parts.unshift(key);
    current = unwrapExpression(current.object as AstNode);
  }
  if (current.type !== 'Identifier') return null;
  const rootName = String(current.name);
  if (rootName === parameter.root && parts.length) return parts.join('.');
  const boundPath = parameter.bindings[rootName];
  return boundPath ? [boundPath, ...parts].join('.') : null;
}

function callbackCondition(expressionValue: AstNode, parameter: CallbackParameterScope): ControlCondition | null {
  const expression = unwrapExpression(expressionValue);
  const directPath = callbackPropertyPath(expression, parameter);
  if (directPath) return { property: directPath, operator: 'equals', value: true };
  if (expression.type === 'UnaryExpression' && expression.operator === '!') {
    const argument = unwrapExpression(expression.argument as AstNode);
    const path = callbackPropertyPath(argument, parameter);
    if (path) return { property: path, operator: 'equals', value: false };
    const nested = callbackCondition(argument, parameter);
    return nested ? { not: nested } : null;
  }
  if (expression.type === 'LogicalExpression') {
    const left = callbackCondition(expression.left as AstNode, parameter);
    const right = callbackCondition(expression.right as AstNode, parameter);
    if (!left || !right) return null;
    if (expression.operator === '&&') return { and: [left, right] };
    if (expression.operator === '||') return { or: [left, right] };
    return null;
  }
  if (expression.type === 'CallExpression') {
    const callee = unwrapExpression(expression.callee as AstNode);
    if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null;
    const propertyName = memberName(callee.property as AstNode);
    const path = callbackPropertyPath(callee.object as AstNode, parameter);
    const argument = (expression.arguments as AstNode[] | undefined)?.[0];
    if (!path || !argument || !['includes'].includes(propertyName)) return null;
    try {
      const value = staticValue(argument) as JSONValue;
      return { property: path, operator: 'includes', value };
    } catch {
      return null;
    }
  }
  if (expression.type !== 'BinaryExpression') return null;
  const left = unwrapExpression(expression.left as AstNode);
  const right = unwrapExpression(expression.right as AstNode);
  const leftPath = callbackPropertyPath(left, parameter);
  const rightPath = callbackPropertyPath(right, parameter);
  if (Boolean(leftPath) === Boolean(rightPath)) return null;
  const path = leftPath || rightPath as string;
  const valueNode = leftPath ? right : left;
  if (valueNode.type === 'Identifier' && valueNode.name === 'undefined') {
    if (['==', '==='].includes(String(expression.operator))) return { property: path, operator: 'exists', value: false };
    if (['!=', '!=='].includes(String(expression.operator))) return { property: path, operator: 'exists', value: true };
    return null;
  }
  if (valueNode.type === 'NullLiteral') {
    if (['==', '==='].includes(String(expression.operator))) return { property: path, operator: 'exists', value: false };
    if (['!=', '!=='].includes(String(expression.operator))) return { property: path, operator: 'exists', value: true };
    return null;
  }
  let value: JSONValue;
  try {
    value = staticValue(valueNode) as JSONValue;
  } catch {
    return null;
  }
  const operator = String(expression.operator);
  if (operator === '==' || operator === '===') return { property: path, operator: 'equals', value };
  if (operator === '!=' || operator === '!==') return { property: path, operator: 'not-equals', value };
  if (operator === '>' && leftPath) return { property: path, operator: 'greater-than', value };
  if (operator === '<' && leftPath) return { property: path, operator: 'less-than', value };
  if (operator === '>' && rightPath) return { property: path, operator: 'less-than', value };
  if (operator === '<' && rightPath) return { property: path, operator: 'greater-than', value };
  return null;
}

function framerStaticValue(
  nodeValue: AstNode,
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  path: string,
): unknown | typeof OMIT_STATIC_VALUE {
  const node = unwrapExpression(nodeValue);
  if (node.type === 'ObjectExpression') {
    const entries: Array<[string, unknown]> = [];
    for (const propertyNode of node.properties as AstNode[]) {
      if (propertyNode.type === 'ObjectMethod') {
        const key = memberName(propertyNode.key as AstNode);
        const callback = callbackReturnExpression(propertyNode);
        const condition = callback?.parameter && ['hidden', 'disabled'].includes(key)
          ? callbackCondition(callback.expression, callback.parameter)
          : null;
        if (condition) entries.push([key, condition]);
        else diagnostics.push({ severity: 'warning', code: 'framer-control-callback', message: `O callback “${path}.${key}” não é serializável e foi ignorado.`, file: fileName });
        continue;
      }
      if (propertyNode.type !== 'ObjectProperty' || propertyNode.computed || propertyNode.method) {
        throw new Error('O manifest aceita apenas propriedades literais serializáveis.');
      }
      const key = memberName(propertyNode.key as AstNode);
      const propertyValue = propertyNode.value as AstNode;
      const callback = callbackReturnExpression(propertyValue);
      if (callback) {
        const condition = callback.parameter && ['hidden', 'disabled'].includes(key)
          ? callbackCondition(callback.expression, callback.parameter)
          : null;
        if (condition) entries.push([key, condition]);
        else diagnostics.push({ severity: 'warning', code: 'framer-control-callback', message: `O callback “${path}.${key}” não é serializável e foi ignorado.`, file: fileName });
        continue;
      }
      const value = framerStaticValue(propertyValue, diagnostics, fileName, `${path}.${key}`);
      if (value !== OMIT_STATIC_VALUE) entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  }
  if (node.type === 'ArrayExpression') {
    const result: unknown[] = [];
    for (const [index, item] of (node.elements as Array<AstNode | null>).entries()) {
      if (!item) { result.push(null); continue; }
      const value = framerStaticValue(item, diagnostics, fileName, `${path}.${index}`);
      if (value !== OMIT_STATIC_VALUE) result.push(value);
    }
    return result;
  }
  if (['ArrowFunctionExpression', 'FunctionExpression', 'ObjectMethod'].includes(node.type)) {
    diagnostics.push({ severity: 'warning', code: 'framer-control-callback', message: `O callback “${path}” não é serializável e foi ignorado.`, file: fileName });
    return OMIT_STATIC_VALUE;
  }
  return staticValue(node);
}

function normalizeFramerControl(
  value: unknown,
  diagnostics: CompilerDiagnostic[],
  fileName: string,
  path: string,
): ControlDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const definition = { ...(value as Record<string, unknown>) };
  const originalType = String(definition.type || '').toLowerCase();
  const mappings: Record<string, ControlType | 'event-handler'> = {
    string: ControlType.String,
    text: ControlType.Text,
    number: ControlType.Number,
    boolean: ControlType.Boolean,
    enum: ControlType.Enum,
    'segmented-enum': ControlType.Enum,
    color: ControlType.Color,
    image: ControlType.Image,
    'responsive-image': ControlType.Image,
    file: ControlType.File,
    link: ControlType.String,
    date: ControlType.Date,
    object: ControlType.Object,
    array: ControlType.Array,
    'component-instance': ControlType.Slot,
    font: ControlType.Object,
    transition: ControlType.Object,
    'box-shadow': ControlType.String,
    'event-handler': 'event-handler',
  };
  const mapped = mappings[originalType];
  if (mapped === 'event-handler') {
    diagnostics.push({ severity: 'warning', code: 'framer-event-control', message: `O evento “${path}” não possui edição visual e foi omitido dos Property Controls.`, file: fileName });
    return null;
  }
  if (!mapped) {
    diagnostics.push({ severity: 'warning', code: 'framer-control-type', message: `ControlType “${originalType || 'desconhecido'}” em “${path}” foi adaptado para texto.`, file: fileName });
    definition.type = ControlType.String;
  } else definition.type = mapped;
  if (originalType === 'segmented-enum') definition.display = 'segmented';
  if (definition.type === ControlType.String && definition.displayTextArea === true) definition.type = ControlType.Text;
  if (definition.type === ControlType.Number && definition.displayStepper === true) definition.display = 'stepper';
  if (definition.type === ControlType.Enum && !Array.isArray(definition.options)) definition.options = [];
  if (originalType === 'image') definition.framerValueType = 'url';
  if (originalType === 'responsive-image') definition.framerValueType = 'responsive-image';
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
      ? definition.controls as Record<string, unknown>
      : {};
    definition.controls = Object.fromEntries(Object.entries(controls).flatMap(([name, child]) => {
      const normalized = normalizeFramerControl(child, diagnostics, fileName, `${path}.${name}`);
      return normalized ? [[name, normalized]] : [];
    }));
  }
  if (definition.type === ControlType.Array) {
    const child = normalizeFramerControl(definition.control, diagnostics, fileName, `${path}[]`);
    if (!child) return null;
    if (child.type === ControlType.Slot) {
      definition.type = ControlType.Slots;
      delete definition.control;
    } else definition.control = child;
  }
  return definition as unknown as ControlDefinition;
}

function framerSizingFromSource(source: string): ComponentSizing {
  const annotation = (name: string) => source.match(new RegExp(`@${name}\\s+([^\\s*]+)`, 'i'))?.[1]?.toLowerCase();
  const dimension = (name: string) => {
    const value = Number(annotation(name));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const widthSupport = annotation('framerSupportedLayoutWidth');
  const heightSupport = annotation('framerSupportedLayoutHeight');
  const width = widthSupport?.includes('auto') ? 'hug' : 'fixed';
  const height = heightSupport?.includes('auto') ? 'hug' : 'fixed';
  const defaultWidth = dimension('framerIntrinsicWidth') || 320;
  const defaultHeight = dimension('framerIntrinsicHeight') || (height === 'fixed' ? 320 : undefined);
  return {
    width,
    height,
    defaultWidth,
    ...(defaultHeight ? { defaultHeight } : {}),
    minWidth: 1,
    minHeight: 1,
  };
}
function callName(node: AstNode) { return node.type === 'CallExpression' ? memberName(node.callee as AstNode) : '' }
function property(object: AstNode, name: string) { return (object.properties as AstNode[]).find(item => item.type === 'ObjectProperty' && memberName(item.key as AstNode) === name)?.value as AstNode | undefined }
function literalString(node: AstNode | undefined, fallback: string) { if (!node) return fallback; const value = staticValue(node); return typeof value === 'string' ? value : fallback }
function safeId(value: string) { return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'component' }

function extractImports(program: AstNode) {
  const dependencies = new Set<string>();
  walk(program, node => {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const source = node.source as AstNode | undefined; if (source?.type === 'StringLiteral') dependencies.add(String(source.value));
    }
    if (node.type === 'CallExpression' && node.callee && (node.callee as AstNode).type === 'Import') {
      const source = (node.arguments as AstNode[])[0]; if (source?.type === 'StringLiteral') dependencies.add(String(source.value));
      else throw new Error('Imports dinâmicos precisam usar uma string literal.');
    }
  });
  return [...dependencies];
}
function allowed(specifier: string, rules: string[]) { return specifier.startsWith('.') || rules.some(rule => specifier === rule || (rule.endsWith('/*') && specifier.startsWith(rule.slice(0, -1)))) }

function normalizeVirtualPath(value: string) {
  const segments: string[] = [];
  value.replaceAll('\\', '/').split('/').forEach(segment => {
    if (!segment || segment === '.') return;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  });
  return segments.join('/');
}
function virtualModuleCandidates(importer: string, specifier: string) {
  const directory = normalizeVirtualPath(importer).split('/').slice(0, -1);
  const resolved = normalizeVirtualPath([...directory, ...specifier.split('/')].join('/'));
  return [
    resolved,
    ...VIRTUAL_MODULE_EXTENSIONS.map(extension => `${resolved}${extension}`),
    ...VIRTUAL_MODULE_EXTENSIONS.map(extension => `${resolved}/index${extension}`),
  ];
}
function resolveVirtualModule(importer: string, specifier: string, sources: Record<string, string>) {
  return virtualModuleCandidates(importer, specifier).find(candidate => Object.hasOwn(sources, candidate));
}
function sourceScriptKind(fileName: string) {
  return /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX
    : /\.(?:jsx|mjs|cjs)$/i.test(fileName) ? ts.ScriptKind.JSX
      : /\.js$/i.test(fileName) ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
}
function resolvedExtension(fileName: string) {
  return /\.tsx$/i.test(fileName) ? ts.Extension.Tsx
    : /\.jsx$/i.test(fileName) ? ts.Extension.Jsx
      : /\.(?:js|mjs|cjs)$/i.test(fileName) ? ts.Extension.Js
        : ts.Extension.Ts;
}

interface VirtualModuleGraph {
  entry: string;
  sources: Record<string, string>;
  modules: string[];
  astByModule: Map<string, AstNode>;
  resolutions: Map<string, Map<string, string>>;
  dependencies: string[];
  diagnostics: CompilerDiagnostic[];
}

function analyzeVirtualModuleGraph(fileName: string, source: string, sourceValues: Record<string, string>): VirtualModuleGraph {
  const entry = normalizeVirtualPath(fileName);
  const sources = Object.fromEntries(Object.entries(sourceValues).map(([path, value]) => [normalizeVirtualPath(path), value]));
  sources[entry] = source;
  const modules: string[] = [];
  const astByModule = new Map<string, AstNode>();
  const resolutions = new Map<string, Map<string, string>>();
  const dependencies = new Set<string>();
  const diagnostics: CompilerDiagnostic[] = [];
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length) {
    const modulePath = pending.shift() as string;
    if (visited.has(modulePath)) continue;
    visited.add(modulePath);
    modules.push(modulePath);
    let ast: AstNode;
    try {
      ast = parse(sources[modulePath], { sourceType: 'module', sourceFilename: modulePath, plugins: ['jsx', 'typescript', 'importAttributes', 'topLevelAwait'] }) as unknown as AstNode;
      astByModule.set(modulePath, ast);
    } catch (error) {
      diagnostics.push(diagnostic(error, modulePath));
      continue;
    }
    let imports: string[] = [];
    try { imports = extractImports(ast); }
    catch (error) { diagnostics.push(diagnostic(error, modulePath)); }
    const moduleResolutions = new Map<string, string>();
    imports.forEach(specifier => {
      if (!specifier.startsWith('.')) {
        dependencies.add(specifier);
        return;
      }
      const resolved = resolveVirtualModule(modulePath, specifier, sources);
      if (!resolved) {
        diagnostics.push({ severity: 'error', code: 'module-not-found', message: `Módulo local “${specifier}” não encontrado em sources.`, file: modulePath });
        return;
      }
      moduleResolutions.set(specifier, resolved);
      if (!visited.has(resolved)) pending.push(resolved);
    });
    resolutions.set(modulePath, moduleResolutions);
  }
  return { entry, sources, modules, astByModule, resolutions, dependencies: [...dependencies], diagnostics };
}

function extractPropKeys(program: AstNode) {
  const interfaces = new Map<string, Set<string>>();
  walk(program, node => {
    if (node.type !== 'TSInterfaceDeclaration' || !(node.id as AstNode)?.name) return;
    const keys = new Set<string>(); ((node.body as AstNode).body as AstNode[]).forEach(item => { if (item.type === 'TSPropertySignature') keys.add(memberName(item.key as AstNode)) });
    interfaces.set(String((node.id as AstNode).name), keys);
  });
  return interfaces;
}

function componentPropKeys(program: AstNode, componentName: string) {
  const interfaces = extractPropKeys(program); let parameter: AstNode | undefined;
  walk(program, node => {
    if (node.type === 'FunctionDeclaration' && memberName(node.id as AstNode) === componentName) parameter = (node.params as AstNode[])[0];
    if (node.type === 'VariableDeclarator' && memberName(node.id as AstNode) === componentName) {
      const initializer = node.init as AstNode | undefined;
      if (initializer && ['ArrowFunctionExpression', 'FunctionExpression'].includes(initializer.type)) parameter = (initializer.params as AstNode[])[0];
    }
  });
  if (!parameter) return new Set<string>();
  if (parameter.type === 'ObjectPattern') return new Set((parameter.properties as AstNode[]).map(item => memberName(item.key as AstNode)).filter(Boolean));
  const annotation = parameter.typeAnnotation as AstNode | undefined; const type = annotation?.type === 'TSTypeAnnotation' ? annotation.typeAnnotation as AstNode : annotation;
  if (type?.type === 'TSTypeReference') return interfaces.get(memberName(type.typeName as AstNode)) || new Set<string>();
  return new Set<string>();
}

function inferCapabilities(controls: Record<string, ControlDefinition>, hasEvents: boolean): ComponentCapability[] {
  const result = new Set<ComponentCapability>(); const visit = (control: ControlDefinition) => {
    if (control.responsive) result.add('responsive'); if (control.bindable) result.add('cms');
    if (control.type === ControlType.Image || control.type === ControlType.File) result.add('assets');
    if (control.type === ControlType.Slot || control.type === ControlType.Slots) result.add('slots');
    if (control.type === ControlType.Object) Object.values(control.controls).forEach(visit); if (control.type === ControlType.Array) visit(control.control);
  }; Object.values(controls).forEach(visit); if (hasEvents) result.add('events'); return [...result];
}

function manifestFromAst(program: AstNode, fileName: string, source: string, dependencies: string[], diagnostics: CompilerDiagnostic[]): ComponentManifest | undefined {
  let definition: AstNode | undefined; let definitionComponent: AstNode | undefined; let controlsNode: AstNode | undefined; let controlsComponent: AstNode | undefined; let componentName = fileName.replace(/\.[^.]+$/, '').split('/').pop() || 'CodeComponent';
  walk(program, node => {
    if (callName(node) === 'defineComponent') {
      const args = node.arguments as AstNode[];
      if (args[0]?.type === 'ObjectExpression') {
        definition = args[0];
        definitionComponent = args[1];
      }
    }
    if (callName(node) === 'addPropertyControls') {
      const args = node.arguments as AstNode[]; if (args[0]) { controlsComponent = args[0]; componentName = memberName(args[0]) || componentName; } if (args[1]?.type === 'ObjectExpression') controlsNode = args[1]; definition ||= args[2]?.type === 'ObjectExpression' ? args[2] : undefined;
    }
  });
  if (definition) {
    componentName = literalString(property(definition, 'name'), componentName);
    controlsNode ||= property(definition, 'controls');
  }
  if (!controlsNode || controlsNode.type !== 'ObjectExpression') { diagnostics.push({ severity: 'error', code: 'manifest-controls', message: 'Nenhum schema literal foi encontrado em defineComponent ou addPropertyControls.', file: fileName }); return undefined; }
  try {
    const framerCompatibility = dependencies.includes('framer');
    const rawControls = (framerCompatibility
      ? framerStaticValue(controlsNode, diagnostics, fileName, 'controls')
      : staticValue(controlsNode)) as Record<string, unknown>;
    const controls = framerCompatibility
      ? Object.fromEntries(Object.entries(rawControls).flatMap(([name, value]) => {
          const normalized = normalizeFramerControl(value, diagnostics, fileName, name);
          return normalized ? [[name, normalized]] : [];
        }))
      : rawControls as Record<string, ControlDefinition>;
    const componentDefaults: Record<string, JSONValue> = {};
    if (framerCompatibility) {
      const defaultPropsOwner = componentExpressionName(controlsComponent) || componentName;
      walk(program, node => {
        if (node.type !== 'AssignmentExpression' || node.operator !== '=') return;
        const left = node.left as AstNode;
        if (memberName(left) !== `${defaultPropsOwner}.defaultProps`) return;
        const right = node.right as AstNode;
        if (right?.type !== 'ObjectExpression') return;
        const value = framerStaticValue(right, diagnostics, fileName, `${defaultPropsOwner}.defaultProps`);
        if (value && value !== OMIT_STATIC_VALUE && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(componentDefaults, value as Record<string, JSONValue>);
        }
      });
      Object.entries(componentDefaults).forEach(([name, value]) => {
        const control = controls[name] as ControlDefinition | undefined;
        if (control && control.defaultValue === undefined) control.defaultValue = value;
      });
    }
    const defaultsValidation = validateDefaults(controls);
    diagnostics.push(...defaultsValidation.issues.map(item => ({ severity: item.severity, code: item.code, message: item.message, file: fileName })) as CompilerDiagnostic[]);
    const sizingNode = definition && property(definition, 'sizing'); const eventsNode = definition && property(definition, 'events');
    const events = eventsNode ? staticValue(eventsNode) as ComponentManifest['events'] : undefined;
    const exportName = componentExpressionName(definition && property(definition, 'component'))
      || componentExpressionName(definitionComponent)
      || componentExpressionName(controlsComponent)
      || fileName.replace(/\.[^.]+$/, '').split('/').pop()
      || 'CodeComponent';
    const propKeys = componentPropKeys(program, exportName); const reserved = new Set(['style', 'className', 'instanceId', 'breakpoint', 'children']);
    [...propKeys].filter(key => !reserved.has(key) && !(key in controls)).forEach(key => diagnostics.push({ severity: framerCompatibility ? 'warning' : 'error', code: 'missing-control', message: `A prop “${key}” não possui Property Control.`, file: fileName }));
    Object.keys(controls).filter(key => propKeys.size > 0 && !propKeys.has(key)).forEach(key => diagnostics.push({ severity: framerCompatibility ? 'warning' : 'error', code: 'unknown-control', message: `O controle “${key}” não existe na interface de props.`, file: fileName }));
    return {
      schemaVersion: CONTROL_DEFINITION_SCHEMA_VERSION,
      id: literalString(definition && property(definition, 'id'), `coday.${safeId(componentName)}`), name: componentName,
      displayName: literalString(definition && property(definition, 'displayName'), componentName),
      ...(definition && property(definition, 'description') ? { description: literalString(property(definition, 'description'), '') } : {}),
      version: literalString(definition && property(definition, 'version'), '1.0.0'), exportName,
      controls: serializeControlMap(controls), defaultProps: { ...componentDefaults, ...defaultValuesFromControls(controls) },
      sizing: sizingNode
        ? staticValue(sizingNode) as ComponentSizing
        : framerCompatibility
          ? framerSizingFromSource(source)
          : { width: 'fixed', height: 'hug', defaultWidth: 320 },
      ...(events ? { events } : {}), dependencies, capabilities: inferCapabilities(controls, Boolean(events)),
    };
  } catch (error) { diagnostics.push(diagnostic(error, fileName)); return undefined; }
}

function tsDiagnostics(values: readonly ts.Diagnostic[], sources: Record<string, string>): CompilerDiagnostic[] {
  return values.map((item): CompilerDiagnostic => {
    const start = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : undefined;
    return { severity: item.category === ts.DiagnosticCategory.Error ? 'error' : item.category === ts.DiagnosticCategory.Warning ? 'warning' : 'info', code: `TS${item.code}`, message: ts.flattenDiagnosticMessageText(item.messageText, '\n'), file: item.file?.fileName, line: start ? start.line + 1 : undefined, column: start ? start.character + 1 : undefined };
  }).filter(item => !item.file || Object.keys(sources).some(file => item.file?.endsWith(file)));
}
function typeCheck(graph: VirtualModuleGraph, framerCompatibility = false) {
  const all = Object.fromEntries(graph.modules.map(path => [path, graph.sources[path]]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, strict: true, noImplicitAny: !framerCompatibility, allowJs: true, checkJs: false, esModuleInterop: true, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const currentDirectoryPath = host.getCurrentDirectory().replaceAll('\\', '/').replace(/\/$/, '');
  const currentDirectory = normalizeVirtualPath(currentDirectoryPath);
  const absoluteVirtualPath = (path: string) => `${currentDirectoryPath}/${path}`;
  const virtualKey = (path: string) => {
    const normalized = normalizeVirtualPath(path);
    if (Object.hasOwn(all, normalized)) return normalized;
    const relative = currentDirectory && normalized.startsWith(`${currentDirectory}/`)
      ? normalized.slice(currentDirectory.length + 1)
      : normalized;
    return Object.hasOwn(all, relative) ? relative : undefined;
  };
  host.fileExists = path => Boolean(virtualKey(path)) || fileExists(path);
  host.readFile = path => {
    const key = virtualKey(path);
    return key ? all[key] : readFile(path);
  };
  host.getSourceFile = (path, language) => {
    const key = virtualKey(path);
    return key ? ts.createSourceFile(path, all[key], language, true, sourceScriptKind(key)) : getSourceFile(path, language);
  };
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map(specifier => {
    const importer = virtualKey(containingFile);
    if (specifier.startsWith('.') && importer) {
      const resolved = resolveVirtualModule(importer, specifier, all);
      return resolved ? { resolvedFileName: absoluteVirtualPath(resolved), extension: resolvedExtension(resolved), isExternalLibraryImport: false } : undefined;
    }
    return ts.resolveModuleName(
      specifier === 'framer' ? '@coday/components' : specifier,
      containingFile,
      options,
      host,
    ).resolvedModule;
  });
  return tsDiagnostics(ts.getPreEmitDiagnostics(ts.createProgram([absoluteVirtualPath(graph.entry)], options, host)), all);
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function rewriteImports(code: string, importMap: Record<string, string>) {
  if (!Object.keys(importMap).length) return code;
  try {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'importAttributes', 'topLevelAwait'] }) as unknown as AstNode;
    const replacements: Array<{ start: number; end: number; value: string }> = [];
    walk(ast, node => {
      let source: AstNode | undefined;
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') source = node.source as AstNode | undefined;
      if (node.type === 'CallExpression' && (node.callee as AstNode | undefined)?.type === 'Import') source = (node.arguments as AstNode[])[0];
      if (source?.type !== 'StringLiteral') return;
      const replacement = importMap[String(source.value)];
      if (replacement === undefined || typeof source.start !== 'number' || typeof source.end !== 'number') return;
      replacements.push({ start: source.start, end: source.end, value: JSON.stringify(replacement) });
    });
    return replacements.sort((left, right) => right.start - left.start).reduce(
      (result, replacement) => `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`,
      code,
    );
  } catch {
    return Object.entries(importMap).reduce((result, [specifier, replacement]) => result
      .replaceAll(`from \"${specifier}\"`, `from \"${replacement}\"`).replaceAll(`from '${specifier}'`, `from '${replacement}'`)
      .replaceAll(`import \"${specifier}\"`, `import \"${replacement}\"`).replaceAll(`import '${specifier}'`, `import '${replacement}'`)
      .replaceAll(`import(\"${specifier}\")`, `import(\"${replacement}\")`).replaceAll(`import('${specifier}')`, `import('${replacement}')`), code);
  }
}

function runtimeMountEntry(manifest: ComponentManifest) {
  return `
import { Component as __CodayReactComponent, createElement as __codayCreateElement, useLayoutEffect as __codayUseLayoutEffect } from "react";
import { createRoot as __codayCreateRoot } from "react-dom/client";
import { getRegisteredComponent as __codayGetRegisteredComponent } from "@coday/components";
export function mountCodayComponent(container, initialProps, context) {
  const registration = __codayGetRegisteredComponent(${JSON.stringify(manifest.id)}, ${JSON.stringify(manifest.version)});
  if (!registration?.component) throw new Error(${JSON.stringify(`Code Component ${manifest.id}@${manifest.version} não foi registrado pelo módulo.`)});
  const root = __codayCreateRoot(container);
  let committedProps = initialProps;
  let committedBreakpoint = context.breakpoint;
  let hasCommitted = false;
  let renderRevision = 0;
  let pendingUpdate = null;
  let disposed = false;
  const componentProps = (props, breakpoint) => ({ ...props, instanceId: context.instanceId, breakpoint, emit: context.emit });
  class __CodayLastGoodBoundary extends __CodayReactComponent {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) {
      container.dataset.codayComponentError = 'render';
      console.error('[Coday Code Component]', error);
      if (pendingUpdate?.revision === this.props.revision) {
        const request = pendingUpdate;
        pendingUpdate = null;
        request.resolve(false);
      }
    }
    componentDidUpdate(previous) {
      if (this.state.error && previous.revision !== this.props.revision) {
        this.setState({ error: null });
      }
    }
    render() {
      if (!this.state.error) return this.props.children;
      if (hasCommitted) {
        return __codayCreateElement(registration.component, componentProps(committedProps, committedBreakpoint));
      }
      return __codayCreateElement('div', { role: 'alert', 'data-coday-component-error': 'render' }, this.state.error.message || 'Code Component render failed.');
    }
  }
  function __CodayCommit(props) {
    __codayUseLayoutEffect(() => {
      hasCommitted = true;
      committedProps = props.value;
      committedBreakpoint = props.breakpoint;
      context.breakpoint = props.breakpoint;
      container.removeAttribute('data-coday-component-error');
      if (pendingUpdate?.revision === props.revision) {
        const request = pendingUpdate;
        pendingUpdate = null;
        request.resolve(true);
      }
    }, [props.value, props.breakpoint, props.revision]);
    return __codayCreateElement(registration.component, componentProps(props.value, props.breakpoint));
  }
  const render = (props, breakpoint, revision) => root.render(
    __codayCreateElement(
      __CodayLastGoodBoundary,
      { revision },
      __codayCreateElement(__CodayCommit, { value: props, breakpoint, revision }),
    ),
  );
  render(initialProps, context.breakpoint, renderRevision);
  return {
    update(nextProps, breakpoint) {
      if (disposed) return Promise.resolve(false);
      pendingUpdate?.resolve(false);
      const revision = ++renderRevision;
      return new Promise(resolve => {
        pendingUpdate = { revision, resolve };
        render(nextProps, breakpoint, revision);
      });
    },
    dispose() {
      disposed = true;
      pendingUpdate?.resolve(false);
      pendingUpdate = null;
      root.unmount();
    },
  };
}
`;
}

export class ComponentCompiler {
  private cache = new Map<string, CompileResult>(); private listeners = new Set<(result: CompileResult) => void>();
  async compile(request: CompileRequest, signal?: AbortSignal): Promise<CompileResult> {
    signal?.throwIfAborted(); const started = performance.now();
    const cacheKey = await hash(JSON.stringify({ ...request, timeoutMs: undefined }));
    signal?.throwIfAborted();
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, diagnostics: [...cached.diagnostics], ...(cached.moduleGraph ? { moduleGraph: { ...cached.moduleGraph } } : {}) };
    const graph = analyzeVirtualModuleGraph(request.fileName, request.source, request.sources || {});
    const diagnostics: CompilerDiagnostic[] = [...graph.diagnostics];
    const dependencies = [...graph.dependencies];
    if (!dependencies.includes('react-dom/client')) dependencies.push('react-dom/client');
    const rules = request.allowedImports || DEFAULT_ALLOWED;
    dependencies.filter(specifier => !allowed(specifier, rules)).forEach(specifier => diagnostics.push({ severity: 'error', code: 'import-not-allowed', message: `Import “${specifier}” não está na allowlist.`, file: request.fileName }));
    const entryAst = graph.astByModule.get(graph.entry);
    const manifest = entryAst ? manifestFromAst(entryAst, request.fileName, request.source, dependencies, diagnostics) : undefined;
    if (request.typeCheck !== false) diagnostics.push(...typeCheck(graph, dependencies.includes('framer')));
    signal?.throwIfAborted();
    const sidecarNames = new Map<string, string>();
    await Promise.all(graph.modules.filter(path => path !== graph.entry).map(async path => {
      sidecarNames.set(path, `module-${await hash(`${path}\0${graph.sources[path]}`)}.mjs`);
    }));
    const importMapForModule = (path: string) => {
      const local = Object.fromEntries([...graph.resolutions.get(path)?.entries() || []].flatMap(([specifier, target]) => {
        const sidecar = sidecarNames.get(target);
        if (sidecar) return [[specifier, `./${sidecar}`]];
        diagnostics.push({ severity: 'error', code: 'module-entry-cycle', message: 'Módulos locais não podem importar o entrypoint do Code Component.', file: path });
        return [];
      }));
      return { ...(request.importMap || {}), ...COMPATIBILITY_IMPORT_MAP, ...local };
    };
    const transpile = (path: string, source: string, sourceMap: boolean) => {
      const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, sourceMap, inlineSources: sourceMap, strict: true } });
      diagnostics.push(...tsDiagnostics(result.diagnostics || [], { [path]: source }));
      return { ...result, outputText: result.outputText.replace(/\/\/# sourceMappingURL=.*$/m, '') };
    };
    const transpiled = transpile(graph.entry, request.source, true);
    const runtimeEntry = manifest ? runtimeMountEntry(manifest) : '';
    const code = rewriteImports(transpiled.outputText + runtimeEntry, importMapForModule(graph.entry));
    const moduleGraph = Object.fromEntries(graph.modules.filter(path => path !== graph.entry).map(path => {
      const module = transpile(path, graph.sources[path], false);
      return [sidecarNames.get(path) as string, rewriteImports(module.outputText, importMapForModule(path))];
    }));
    const bytes = [code, ...Object.values(moduleGraph)].reduce((total, value) => total + new TextEncoder().encode(value).byteLength, 0);
    if (bytes > (request.maxBundleBytes || 1_500_000)) diagnostics.push({ severity: 'error', code: 'bundle-size', message: `Bundle de ${bytes} bytes excede o limite.`, file: request.fileName });
    if (performance.now() - started > (request.timeoutMs ?? 8_000)) diagnostics.push({ severity: 'error', code: 'compile-timeout', message: 'Compilação excedeu o limite de tempo.', file: request.fileName });
    signal?.throwIfAborted(); const bundleHash = await hash(JSON.stringify({ code, moduleGraph })); const success = !diagnostics.some(item => item.severity === 'error') && Boolean(manifest);
    const result: CompileResult = { success, ...(success ? { code, sourceMap: transpiled.sourceMapText, componentManifest: manifest, hash: bundleHash, moduleGraph } : {}), diagnostics, dependencies };
    if (success) this.cache.set(cacheKey, { ...result, diagnostics: [...diagnostics], moduleGraph: { ...moduleGraph } });
    this.listeners.forEach(listener => listener(result)); return result;
  }
  invalidate(predicate?: (key: string) => boolean) { if (!predicate) this.cache.clear(); else [...this.cache.keys()].filter(predicate).forEach(key => this.cache.delete(key)) }
  subscribe(listener: (result: CompileResult) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}

export class HotReloadCompiler {
  private controller?: AbortController; private revision = 0;
  constructor(private readonly compiler = new ComponentCompiler()) {}
  async compile(request: CompileRequest) { this.controller?.abort(); this.controller = new AbortController(); const revision = ++this.revision; const result = await this.compiler.compile(request, this.controller.signal); return revision === this.revision ? result : { success: false, diagnostics: [{ severity: 'info', code: 'stale', message: 'Compilação substituída por uma versão mais nova.' }], dependencies: [] } as CompileResult }
  dispose() { this.controller?.abort() }
}
