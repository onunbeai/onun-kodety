import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const sourceUrl = new URL('../Wordpress/kodety/agent-runtime/server.mjs', import.meta.url);
const virtualId = 'virtual:kodety-html-mcp-tools';
const allowed = new Set([
  'kodety_editor_context', 'kodety_panel_snapshot', 'kodety_panel_action',
  'kodety_project_snapshot', 'kodety_apply_changes', 'kodety_focus_element',
  'kodety_component_snapshot', 'kodety_apply_component_changes',
  'kodety_code_component_snapshot', 'kodety_apply_code_component_changes',
  'kodety_motion_snapshot', 'kodety_apply_motion', 'kodety_localization_snapshot',
  'kodety_apply_localization_settings', 'kodety_apply_localization_translations',
]);

// Compile literal tool schemas from the one authoritative Agent registry. No
// server executable, filesystem access or WordPress-only tools enter the browser.
function literal(node, nativeOperationNames = []) {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isCallExpression(node) && /^KODETY_NATIVE_CATALOG\.operations\.map\(operation => operation\.name\)$/.test(node.getText())) return nativeOperationNames;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => literal(value, nativeOperationNames));
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !('text' in property.name)) throw new Error('Non-literal MCP schema property.');
    return [property.name.text, literal(property.initializer, nativeOperationNames)];
  }));
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand, nativeOperationNames);
  throw new Error('The HTML MCP tool schema must use literal values.');
}

export async function readHtmlMcpToolCatalog({ agent = false } = {}) {
  const selected = agent ? new Set([...allowed, 'kodety_native_catalog', 'kodety_native_call', 'kodety_progress_update']) : allowed;
  const source = await readFile(sourceUrl, 'utf8');
  const tree = ts.createSourceFile('agent-runtime.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let registry;
  let nativeRegistry;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'KODETY_DYNAMIC_TOOLS') registry = node.initializer;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'KODETY_NATIVE_DYNAMIC_TOOLS') nativeRegistry = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!registry || !ts.isArrayLiteralExpression(registry)) throw new Error('Shared Agent tool registry was not found.');
  const nativeOperations = agent ? JSON.parse(await readFile(new URL('../Wordpress/kodety/agent-runtime/native-operations.json', import.meta.url), 'utf8')).operations.map(operation => operation.name) : [];
  const elements = [...registry.elements, ...(agent && nativeRegistry && ts.isArrayLiteralExpression(nativeRegistry) ? nativeRegistry.elements : [])];
  const tools = elements.filter(ts.isObjectLiteralExpression).flatMap(node => {
    const name = node.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(tree) === 'name');
    if (!name || !ts.isStringLiteral(name.initializer) || !selected.has(name.initializer.text)) return [];
    const tool = literal(node, nativeOperations);
    if (tool.name === 'kodety_project_snapshot') {
      delete tool.inputSchema.properties.includeCms;
      tool.description = 'Read the live HTML project pages, settings and requested page, CSS or JavaScript sources. Use the returned file manifest instead of assuming files exist on disk.';
    }
    if (tool.name === 'kodety_apply_changes') {
      const change = tool.inputSchema.properties.changes.items;
      change.properties.type.enum = change.properties.type.enum.filter(type => !type.endsWith('CmsItem'));
      for (const key of ['collectionId', 'itemId', 'values']) delete change.properties[key];
      tool.description = 'Apply revision-checked HTML, CSS and JavaScript edits through the live Builder. Prefer replacing only the selected element or one page. Changes are acknowledged after saving in the selected project folder.';
    }
    const readOnly = /(?:_snapshot|_context)$/.test(tool.name);
    return [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false, idempotentHint: readOnly } }];
  });
  if (tools.length !== selected.size) throw new Error('HTML MCP and the shared Agent tool registry are out of sync.');
  return tools;
}

export function htmlMcpToolCatalogPlugin() {
  return {
    name: 'kodety-html-mcp-shared-tool-catalog',
    resolveId(id) { if (id === virtualId) return `\0${virtualId}`; },
    async load(id) { if (id !== `\0${virtualId}`) return; this.addWatchFile(sourceUrl.pathname); return `export default ${JSON.stringify(await readHtmlMcpToolCatalog())};`; },
  };
}
