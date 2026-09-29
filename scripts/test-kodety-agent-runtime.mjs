import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parse } from '@babel/parser';

import { REQUIRED_WORDPRESS_PLUGIN_FILES } from './wordpress-package-contracts.mjs';
import { KODETY_BUILDER_INSTRUCTIONS } from '../Wordpress/kodety/agent-runtime/builder-instructions.mjs';

const serverUrl = new URL('../Wordpress/kodety/agent-runtime/server.mjs', import.meta.url);
const serverPath = fileURLToPath(serverUrl);
const source = await readFile(serverUrl, 'utf8');
const runtimeManifestUrl = new URL('../Wordpress/kodety/agent-runtime/runtime-manifest.json', import.meta.url);
const runtimeManifest = JSON.parse(await readFile(runtimeManifestUrl, 'utf8'));
const agentsPhpUrl = new URL('../Wordpress/kodety/includes/class-kodety-agents.php', import.meta.url);
const agentsPhpSource = await readFile(agentsPhpUrl, 'utf8');
const agentPanelUrl = new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentPanel.tsx', import.meta.url);
const agentPanelSource = await readFile(agentPanelUrl, 'utf8');
const publishPanelUrl = new URL('../app/(builder)/kodety/html-editor/components/HtmlPublishPanel.tsx', import.meta.url);
const publishPanelSource = await readFile(publishPanelUrl, 'utf8');
const agentPanelEventsUrl = new URL('../lib/html-editor/agent-panel-events.ts', import.meta.url);
const agentPanelEventsSource = await readFile(agentPanelEventsUrl, 'utf8');
const agentSettingsUrl = new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentSettings.tsx', import.meta.url);
const agentSettingsSource = await readFile(agentSettingsUrl, 'utf8');
const agentDeviceCodeCardSource = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentDeviceCodeCard.tsx', import.meta.url), 'utf8');
const agentAccountSyncSource = await readFile(new URL('../lib/html-editor/agent-account-sync.ts', import.meta.url), 'utf8');
const agentSetupSource = await readFile(new URL('../lib/html-editor/agent-runtime-setup.ts', import.meta.url), 'utf8');
const agentRuntimeStatusSource = await readFile(
  new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentRuntimeStatus.tsx', import.meta.url),
  'utf8',
);
const editorShellUrl = new URL('../Wordpress/kodety/templates/editor-shell.php', import.meta.url);
const editorShellSource = await readFile(editorShellUrl, 'utf8');
const agentComposerStyleUrl = new URL(
  '../app/(builder)/kodety/html-editor/components/HtmlAgentComposer.module.css',
  import.meta.url,
);
const agentComposerStyleSource = await readFile(agentComposerStyleUrl, 'utf8');
const projectEditorUrl = new URL('../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx', import.meta.url);
const projectEditorSource = await readFile(projectEditorUrl, 'utf8');
const panelToolsUrl = new URL('../lib/html-editor/agent-panel-tools.ts', import.meta.url);
const panelToolsSource = await readFile(panelToolsUrl, 'utf8');
const workspaceAgentDockUrl = new URL(
  '../app/(builder)/kodety/html-editor/components/HtmlWorkspaceAgentDock.tsx',
  import.meta.url,
);
const workspaceAgentDockSource = await readFile(workspaceAgentDockUrl, 'utf8');
const socialImageBuilderUrl = new URL(
  '../app/(builder)/kodety/html-editor/components/HtmlSocialImageBuilder.tsx',
  import.meta.url,
);
const socialImageBuilderSource = await readFile(socialImageBuilderUrl, 'utf8');
const globalsUrl = new URL('../app/globals.css', import.meta.url);
const globalsSource = await readFile(globalsUrl, 'utf8');
const kodetySkillUrl = new URL('../Wordpress/kodety/agent-skills/kodety-editor/SKILL.md', import.meta.url);
const kodetySkillSource = await readFile(kodetySkillUrl, 'utf8');
const nativePanelsReferenceUrl = new URL(
  '../Wordpress/kodety/agent-skills/kodety-editor/references/native-panels.md',
  import.meta.url,
);
const nativePanelsReferenceSource = await readFile(nativePanelsReferenceUrl, 'utf8');
const motionSkillUrl = new URL('../Wordpress/kodety/agent-skills/kodety-motion/SKILL.md', import.meta.url);
const motionSkillSource = await readFile(motionSkillUrl, 'utf8');
const performanceSkillUrl = new URL('../Wordpress/kodety/agent-skills/kodety-performance/SKILL.md', import.meta.url);
const performanceSkillSource = await readFile(performanceSkillUrl, 'utf8');
const widgetsSkillUrl = new URL('../Wordpress/kodety/agent-skills/kodety-widgets/SKILL.md', import.meta.url);
const widgetsSkillSource = await readFile(widgetsSkillUrl, 'utf8');
const languagesSkillUrl = new URL('../Wordpress/kodety/agent-skills/kodety-languages/SKILL.md', import.meta.url);
const languagesSkillSource = await readFile(languagesSkillUrl, 'utf8');
const localizationWorkspaceUrl = new URL('../Wordpress/editor/WordPressLocalizationWorkspace.tsx', import.meta.url);
const localizationWorkspaceSource = await readFile(localizationWorkspaceUrl, 'utf8');
const wordpressManifestUrl = new URL('../Wordpress/kodety/assets/manifest.json', import.meta.url);
const wordpressManifest = JSON.parse(await readFile(wordpressManifestUrl, 'utf8'));

const syntaxCheck = spawnSync(process.execPath, ['--check', serverPath], {
  encoding: 'utf8',
});
assert.equal(
  syntaxCheck.status,
  0,
  `server.mjs must pass node --check without starting the bridge.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
);

const ast = parse(source, {
  sourceType: 'module',
  sourceFilename: serverPath,
  plugins: ['topLevelAwait'],
});
const agentPanelAst = parse(agentPanelSource, {
  sourceType: 'module',
  sourceFilename: fileURLToPath(agentPanelUrl),
  plugins: ['typescript', 'jsx'],
});

function visit(root, callback) {
  if (!root || typeof root !== 'object') return;
  if (typeof root.type === 'string') callback(root);
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, callback);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      visit(value, callback);
    }
  }
}

function collect(root, predicate) {
  const matches = [];
  visit(root, node => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function propertyName(property) {
  if (!property || property.computed) return null;
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'StringLiteral') return property.key.value;
  return null;
}

function objectProperty(objectExpression, name, label) {
  assert.equal(objectExpression?.type, 'ObjectExpression', `${label} must be an object literal.`);
  const property = objectExpression.properties.find(candidate => propertyName(candidate) === name);
  assert.ok(property, `${label} must define ${name}.`);
  assert.equal(property.type, 'ObjectProperty', `${label}.${name} must be a data property.`);
  return property;
}

function objectValue(objectExpression, name, label) {
  return objectProperty(objectExpression, name, label).value;
}

function staticString(node) {
  return node?.type === 'StringLiteral' ? node.value : null;
}

function memberName(node) {
  if (node?.type !== 'MemberExpression' || node.computed) return null;
  return node.property?.type === 'Identifier' ? node.property.name : null;
}

function containsString(root, value) {
  return collect(root, node => node.type === 'StringLiteral' && node.value === value).length > 0;
}

function variableInitializer(name) {
  const declarations = collect(
    ast,
    node => node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === name,
  );
  assert.equal(declarations.length, 1, `${name} must have one declaration.`);
  return declarations[0].init;
}

function switchCaseNode(method) {
  const cases = collect(ast, node => node.type === 'SwitchCase' && staticString(node.test) === method);
  assert.equal(cases.length, 1, `The bridge must expose one ${method} case.`);
  return cases[0];
}

function switchCaseRequest(method) {
  const switchCase = switchCaseNode(method);
  const requests = collect(switchCase, node => node.type === 'CallExpression' && memberName(node.callee) === 'request');
  assert.equal(requests.length, 1, `${method} must forward one App Server request.`);
  return requests[0];
}

function classMethod(name) {
  const methods = collect(ast, node => node.type === 'ClassMethod' && propertyName(node) === name);
  assert.equal(methods.length, 1, `The bridge must define one ${name}() method.`);
  return methods[0];
}

function namedVariable(root, name, label = name) {
  const declarations = collect(
    root,
    node => node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === name,
  );
  assert.equal(declarations.length, 1, `${label} must have one declaration.`);
  return declarations[0];
}

function callbackBody(declaration, label) {
  assert.equal(declaration.init?.type, 'CallExpression', `${label} must be initialized by a hook call.`);
  const callback = declaration.init.arguments[0];
  assert.ok(
    callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression',
    `${label} must expose a callback body.`,
  );
  return callback.body;
}

function assertOfficialUrlProperty(root, name, label) {
  const properties = collect(root, node => node.type === 'ObjectProperty' && propertyName(node) === name);
  assert.equal(properties.length, 1, `${label} must expose exactly one ${name}.`);
  const call = properties[0].value;
  assert.equal(call?.type, 'CallExpression', `${label}.${name} must be sanitized by a function call.`);
  assert.equal(call.callee?.type, 'Identifier', `${label}.${name} must use the URL allow-list helper.`);
  assert.equal(call.callee.name, 'officialConnectionUrl', `${label}.${name} must use officialConnectionUrl().`);
}

function assertRestrictedRequest(params, label) {
  const permissions = objectValue(params, 'permissions', label);
  assert.equal(permissions?.type, 'Identifier', `${label}.permissions must reference the restricted profile.`);
  assert.equal(permissions.name, 'CODEX_PERMISSION_PROFILE', `${label} must use CODEX_PERMISSION_PROFILE.`);
  assert.equal(
    params.properties.some(candidate => propertyName(candidate) === 'sandbox'),
    false,
    `${label} must not override the restricted profile with a broad sandbox mode.`,
  );

  const roots = objectValue(params, 'runtimeWorkspaceRoots', label);
  assert.equal(roots?.type, 'ArrayExpression', `${label}.runtimeWorkspaceRoots must be an array literal.`);
  assert.equal(roots.elements.length, 2, `${label} must expose only cwd and the approved skill roots.`);
  const cwd = roots.elements[0];
  assert.equal(cwd?.type, 'MemberExpression', `${label} must expose runtime.cwd first.`);
  assert.equal(memberName(cwd), 'cwd', `${label} must expose runtime.cwd first.`);
  const skillRoots = roots.elements[1];
  assert.equal(skillRoots?.type, 'SpreadElement', `${label} must append the approved skill roots.`);
  assert.equal(memberName(skillRoots.argument), 'skillRoots', `${label} must append runtime.skillRoots.`);
}

const dynamicToolsDeclaration = collect(
  ast,
  node => node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === 'KODETY_DYNAMIC_TOOLS',
);
assert.equal(dynamicToolsDeclaration.length, 1, 'KODETY_DYNAMIC_TOOLS must have one declaration.');

const dynamicToolsArray = dynamicToolsDeclaration[0].init;
assert.equal(dynamicToolsArray?.type, 'ArrayExpression', 'KODETY_DYNAMIC_TOOLS must be an array literal.');
assert.ok(dynamicToolsArray.elements.length > 0, 'At least one native Kodety dynamic tool is required.');
const nativeToolsDeclaration = collect(ast, node => node.type === 'VariableDeclarator'
  && node.id?.type === 'Identifier' && node.id.name === 'KODETY_NATIVE_DYNAMIC_TOOLS')[0];
dynamicToolsArray.elements = dynamicToolsArray.elements.flatMap(element => element?.type === 'SpreadElement'
  && element.argument?.name === 'KODETY_NATIVE_DYNAMIC_TOOLS' ? nativeToolsDeclaration.init.elements : [element]);

const expectedToolNames = [
  'kodety_apply_changes',
  'kodety_apply_code_component_changes',
  'kodety_apply_component_changes',
  'kodety_apply_localization_settings',
  'kodety_apply_localization_translations',
  'kodety_apply_motion',
  'kodety_attachment_read',
  'kodety_code_component_snapshot',
  'kodety_component_snapshot',
  'kodety_editor_context',
  'kodety_focus_element',
  'kodety_localization_snapshot',
  'kodety_motion_snapshot',
  'kodety_native_call',
  'kodety_native_catalog',
  'kodety_panel_action',
  'kodety_panel_snapshot',
  'kodety_progress_update',
  'kodety_project_snapshot',
];
const toolNames = dynamicToolsArray.elements.map((tool, index) => {
  const label = `KODETY_DYNAMIC_TOOLS[${index}]`;
  assert.equal(tool?.type, 'ObjectExpression', `${label} must be an object literal.`);
  assert.equal(staticString(objectValue(tool, 'type', label)), 'function', `${label}.type must be function.`);
  const name = staticString(objectValue(tool, 'name', label));
  assert.match(name || '', /^kodety_[a-z0-9_]+$/, `${label}.name must use the native kodety_ namespace.`);
  assert.ok(staticString(objectValue(tool, 'description', label))?.trim(), `${label} needs a description.`);

  const inputSchema = objectValue(tool, 'inputSchema', label);
  assert.equal(inputSchema?.type, 'ObjectExpression', `${label}.inputSchema must be an object literal.`);
  assert.equal(
    staticString(objectValue(inputSchema, 'type', `${label}.inputSchema`)),
    'object',
    `${label}.inputSchema.type must be object.`,
  );
  const additionalProperties = objectValue(inputSchema, 'additionalProperties', `${label}.inputSchema`);
  assert.equal(additionalProperties?.type, 'BooleanLiteral', `${label}.inputSchema.additionalProperties must be boolean.`);
  assert.equal(additionalProperties.value, false, `${label}.inputSchema must reject undeclared arguments.`);
  return name;
});
assert.equal(new Set(toolNames).size, toolNames.length, 'Dynamic tool names must be unique.');
assert.deepEqual([...toolNames].sort(), expectedToolNames, 'The native Kodety dynamic tool set changed unexpectedly.');

const componentApplyTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_apply_component_changes')];
for (const operation of [
  'createComponent',
  'insertComponentInstance',
  'upsertComponentVariant',
  'updateComponent',
  'updateComponentInstance',
  'detachComponentInstance',
  'reorderComponentVariants',
  'deleteComponentVariant',
  'deleteComponent',
]) {
  assert.ok(containsString(componentApplyTool, operation), `The native component transaction schema must expose ${operation}.`);
}
assert.ok(
  containsString(componentApplyTool, 'expectedRevision'),
  'Native component writes must require optimistic revision control.',
);
assert.ok(
  collect(componentApplyTool, node => node.type === 'ObjectProperty' && propertyName(node) === 'css').length >= 1,
  'Native component transactions must accept complete bundle CSS.',
);
const motionApplyTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_apply_motion')];
for (const field of ['expectedRevision', 'pagePath', 'interactions']) {
  assert.ok(
    collect(motionApplyTool, node => node.type === 'ObjectProperty' && propertyName(node) === field).length >= 1,
    `Native Motion transactions must declare ${field}.`,
  );
}
const projectSnapshotTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_project_snapshot')];
assert.ok(
  collect(projectSnapshotTool, node => node.type === 'ObjectProperty' && propertyName(node) === 'filePaths').length >= 1,
  'Performance audits must be able to request exact project text files.',
);
const panelActionTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_panel_action')];
for (const action of ['click', 'setValue', 'toggle', 'focus']) {
  assert.ok(containsString(panelActionTool, action), `The visual panel bridge must expose ${action}.`);
}
const localizationSettingsTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_apply_localization_settings')];
for (const action of ['add', 'update', 'remove', 'setDefault', 'updatePreferences']) {
  assert.ok(containsString(localizationSettingsTool, action), `The locale settings transaction must expose ${action}.`);
}
for (const field of ['expectedRevision', 'localeCode', 'fallback', 'confirmRemoval']) {
  assert.ok(
    collect(localizationSettingsTool, node => node.type === 'ObjectProperty' && propertyName(node) === field).length >= 1,
    `The locale settings transaction schema must declare ${field}.`,
  );
}
for (const field of ['expectedRevision', 'controlId', 'confirmDestructive']) {
  assert.ok(
    collect(panelActionTool, node => node.type === 'ObjectProperty' && propertyName(node) === field).length >= 1,
    `The visual panel action schema must declare ${field}.`,
  );
}
const progressTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_progress_update')];
for (const status of ['pending', 'in_progress', 'completed']) {
  assert.ok(containsString(progressTool, status), `The task progress schema must expose ${status}.`);
}
const attachmentReadTool = dynamicToolsArray.elements[toolNames.indexOf('kodety_attachment_read')];
for (const field of ['attachmentId', 'offset', 'maxChars']) {
  assert.ok(
    collect(attachmentReadTool, node => node.type === 'ObjectProperty' && propertyName(node) === field).length >= 1,
    `The private attachment reader must declare ${field}.`,
  );
}
for (const marker of [
  'loadTurnAttachments',
  'readAttachmentRecord',
  'extractDocxText',
  'extractLegacyDocText',
  'respondToAttachmentRead',
  'KODETY_ATTACHMENTS_MANIFEST',
  "type: 'localImage'",
]) {
  assert.ok(source.includes(marker), `The App Server attachment bridge is incomplete; missing ${marker}.`);
}
for (const marker of [
  'AGENT_ATTACHMENT_ACCEPT',
  'transport.uploadAttachment(file)',
  'attachments: selectedAttachments.map',
  'Anexar TXT, DOC, DOCX ou imagem',
  'handleAttachmentPaste',
  'handleAttachmentDrop',
]) {
  assert.ok(agentPanelSource.includes(marker), `The Agent attachment composer is incomplete; missing ${marker}.`);
}
assert.match(
  KODETY_BUILDER_INSTRUCTIONS.join(' '),
  /For reusable components, also call kodety_component_snapshot[\s\S]*?Use kodety_apply_component_changes/,
  'The embedded Agent must read components before using the semantic component writer.',
);
for (const marker of [
  'const agentComponentSnapshot',
  'const applyAgentComponentChanges',
  "tool === 'kodety_component_snapshot'",
  "tool === 'kodety_apply_component_changes'",
  'refreshProjectHtmlComponentInstances(next, library)',
]) {
  assert.ok(projectEditorSource.includes(marker), `The live Builder component bridge is incomplete; missing ${marker}.`);
}
for (const marker of [
  'const agentMotionSnapshot',
  'const applyAgentMotionChanges',
  "tool === 'kodety_motion_snapshot'",
  "tool === 'kodety_apply_motion'",
  "type === 'replaceTextFile'",
  "filePath.startsWith('.incode/')",
]) {
  assert.ok(projectEditorSource.includes(marker), `The live Builder Motion/performance bridge is incomplete; missing ${marker}.`);
}
for (const marker of [
  'kodety_component_snapshot',
  'kodety_apply_component_changes',
  'kodety_attachment_read',
  'KODETY_ATTACHMENTS_MANIFEST',
  'upsertComponentVariant',
  'updateComponentInstance',
  'component-variant',
  'component.css',
  'project assets',
  'kodety_panel_snapshot',
  'kodety_panel_action',
  'nativePanel.required',
]) {
  assert.ok(kodetySkillSource.includes(marker), `The packaged Kodety Agent skill is incomplete; missing ${marker}.`);
}
for (const marker of ['Settings', 'redirects', 'code/scripts', 'CMS', 'Analytics', 'Localization', 'Members', 'Templates']) {
  assert.ok(nativePanelsReferenceSource.includes(marker), `The native panel skill contract must cover ${marker}.`);
}
for (const marker of [
  'kodety_progress_update',
  'kodety_motion_snapshot',
  'kodety_apply_motion',
  'Interactions v2',
  'reducedMotion',
]) {
  assert.ok(motionSkillSource.includes(marker), `The packaged Kodety Motion skill is incomplete; missing ${marker}.`);
}
for (const marker of ['kodety_progress_update', 'filePaths', 'replaceTextFile', 'PageSpeed', 'Never invent']) {
  assert.ok(performanceSkillSource.includes(marker), `The packaged Kodety Performance skill is incomplete; missing ${marker}.`);
}
for (const marker of [
  'kodety_localization_snapshot',
  'kodety_apply_localization_settings',
  'kodety_apply_localization_translations',
  'Never click translation rows one by one',
  'overwrite',
  'external AI translation endpoint',
  'do not require Languages to be open',
]) {
  assert.ok(languagesSkillSource.includes(marker), `The packaged Kodety Languages skill is incomplete; missing ${marker}.`);
}
for (const marker of [
  'HtmlWorkspaceAgentDock',
  'preferredSkill="kodety-languages"',
  "tool === 'kodety_localization_snapshot'",
  "tool === 'kodety_apply_localization_settings'",
  "tool !== 'kodety_apply_localization_translations'",
  'applyAgentLocalizationSettings',
  'applyAgentLocalizationChanges',
  'workspaceRevisionRef.current',
]) {
  assert.ok(localizationWorkspaceSource.includes(marker), `The Languages Agent bridge is incomplete; missing ${marker}.`);
}
assert.match(
  publishPanelSource,
  /skill: 'kodety-performance'[\s\S]*?autoSubmit: true/,
  'The lossless publish panel must offer a focused Kodety Performance Agent audit.',
);
assert.match(publishPanelSource, /aria-label="Analisar desempenho com o Agent"/);
assert.match(
  publishPanelSource,
  /Não aplique nenhuma alteração nesta etapa[\s\S]*?peça minha aprovação antes de aplicar qualquer mudança/,
  'The publish performance audit must remain analysis-only until the user approves its plan.',
);
assert.match(
  publishPanelSource,
  /disabled=\{loading \|\| Boolean\(statusError\) \|\| savingDefaults \|\| applyingPublished\}[\s\S]*?onClick=\{\(\) => onPublish/,
  'The primary Publish action must wait for authoritative status and for preference or published-release writes to finish.',
);
assert.match(
  agentPanelEventsSource,
  /OpenHtmlAgentPanelDetail[\s\S]*?prompt\?: string[\s\S]*?skill\?: string[\s\S]*?autoSubmit\?: boolean/,
  'Agent launch events must carry an optional focused prompt, skill, and submit intent.',
);
assert.match(
  agentPanelSource,
  /OPEN_HTML_AGENT_PANEL_EVENT[\s\S]*?pendingAgentLaunch[\s\S]*?sendMessage\(undefined, launch\)/,
  'The Agent panel must consume focused launch requests and submit them through the normal composer flow.',
);
assert.match(
  agentPanelSource,
  /kodety_apply_component_changes[\s\S]*?detachComponentInstance[\s\S]*?deleteComponentVariant[\s\S]*?deleteComponent/,
  'Destructive component operations must remain approval-gated in the Agent panel.',
);

const initializeRequests = collect(
  ast,
  node =>
    node.type === 'CallExpression' && memberName(node.callee) === 'request' && staticString(node.arguments[0]) === 'initialize',
);
assert.equal(initializeRequests.length, 1, 'The bridge must initialize Codex App Server exactly once.');
const initializeParams = initializeRequests[0].arguments[1];
const capabilities = objectValue(initializeParams, 'capabilities', 'initialize params');
const experimentalApi = objectValue(capabilities, 'experimentalApi', 'initialize capabilities');
assert.equal(experimentalApi?.type, 'BooleanLiteral', 'experimentalApi must be a boolean literal.');
assert.equal(experimentalApi.value, true, 'Dynamic tools require experimentalApi: true.');

const turnStartCase = switchCaseNode('turn/start');
const threadStartParams = switchCaseRequest('thread/start').arguments[1];
const dynamicToolsValue = objectValue(threadStartParams, 'dynamicTools', 'thread/start params');
assert.equal(dynamicToolsValue?.type, 'Identifier', 'thread/start.dynamicTools must reference the native tool registry.');
assert.equal(dynamicToolsValue.name, 'KODETY_DYNAMIC_TOOLS', 'thread/start must register KODETY_DYNAMIC_TOOLS.');
assertRestrictedRequest(threadStartParams, 'thread/start params');
assertRestrictedRequest(switchCaseRequest('thread/resume').arguments[1], 'thread/resume params');
assertRestrictedRequest(switchCaseRequest('turn/start').arguments[1], 'turn/start params');
assert.ok(
  collect(
    turnStartCase,
    node =>
      node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'editorSelectionReference',
  ).length === 1,
  'turn/start must persist one compact reference to the selected Kodety element.',
);
assert.ok(
  containsString(turnStartCase, '<KODETY_SELECTION_REFERENCE untrusted="true">'),
  'turn/start must keep the selected element reference in the App Server thread history.',
);

const permissionProfile = variableInitializer('CODEX_PERMISSION_PROFILE');
assert.equal(
  staticString(permissionProfile),
  'kodety-agent',
  'The bridge must use the dedicated kodety-agent permission profile.',
);
const permissionConfig = staticString(variableInitializer('CODEX_PERMISSION_CONFIG'));
assert.ok(permissionConfig, 'CODEX_PERMISSION_CONFIG must be a static config override.');
assert.match(permissionConfig, /filesystem\s*=\s*\{/, 'The permission profile must define filesystem access.');
assert.match(permissionConfig, /":minimal"\s*=\s*"read"/, 'The permission profile must restrict minimal reads.');
assert.match(
  permissionConfig,
  /":workspace_roots"\s*=\s*\{\s*"\."\s*=\s*"read"\s*\}/,
  'The permission profile must restrict reads to runtime workspace roots.',
);
assert.match(
  permissionConfig,
  /network\s*=\s*\{\s*enabled\s*=\s*false\s*\}/,
  'The permission profile must disable network access.',
);

const permissionProfileRequests = collect(
  ast,
  node =>
    node.type === 'CallExpression' &&
    memberName(node.callee) === 'request' &&
    staticString(node.arguments[0]) === 'permissionProfile/list',
);
assert.equal(permissionProfileRequests.length, 1, 'Startup must probe the restricted permission profile exactly once.');
const permissionProfileCwd = objectValue(permissionProfileRequests[0].arguments[1], 'cwd', 'permissionProfile/list params');
assert.equal(permissionProfileCwd?.type, 'MemberExpression', 'permissionProfile/list must be scoped to runtime.cwd.');
assert.equal(memberName(permissionProfileCwd), 'cwd', 'permissionProfile/list must be scoped to runtime.cwd.');

const readOnlySandboxPolicies = collect(
  ast,
  node =>
    node.type === 'ObjectProperty' &&
    propertyName(node) === 'sandboxPolicy' &&
    node.value?.type === 'ObjectExpression' &&
    staticString(objectValue(node.value, 'type', 'sandboxPolicy')) === 'readOnly',
);
for (const property of readOnlySandboxPolicies) {
  assert.ok(
    property.value.properties.some(candidate => propertyName(candidate) === 'access'),
    'A readOnly sandboxPolicy without access silently grants broad filesystem reads.',
  );
}

const normalizeServerResponse = classMethod('normalizeServerResponse');
const toolCallBranches = collect(
  normalizeServerResponse.body,
  node => node.type === 'IfStatement' && containsString(node.test, 'item/tool/call'),
);
assert.equal(toolCallBranches.length, 1, 'The bridge must normalize item/tool/call exactly once.');
const toolCallResults = collect(
  toolCallBranches[0].consequent,
  node =>
    node.type === 'ReturnStatement' &&
    node.argument?.type === 'ObjectExpression' &&
    node.argument.properties.some(property => propertyName(property) === 'contentItems') &&
    node.argument.properties.some(property => propertyName(property) === 'success'),
);
assert.equal(toolCallResults.length, 1, 'item/tool/call must return { contentItems, success }.');

const hostExecutionApprovalBranches = collect(
  normalizeServerResponse.body,
  node =>
    node.type === 'IfStatement' &&
    containsString(node.test, 'item/commandExecution/requestApproval') &&
    containsString(node.test, 'item/fileChange/requestApproval'),
);
assert.equal(hostExecutionApprovalBranches.length, 1, 'Host command and file approvals must share one fail-closed branch.');
const hostExecutionApprovalReturns = collect(
  hostExecutionApprovalBranches[0].consequent,
  node => node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression',
);
assert.equal(hostExecutionApprovalReturns.length, 1, 'Host command and file approvals must return one static denial.');
assert.equal(
  staticString(objectValue(hostExecutionApprovalReturns[0].argument, 'decision', 'host execution approval response')),
  'decline',
  'The browser must never approve App Server commands or filesystem patches.',
);
const permissionApprovalBranches = collect(
  normalizeServerResponse.body,
  node => node.type === 'IfStatement' && containsString(node.test, 'item/permissions/requestApproval'),
);
assert.equal(permissionApprovalBranches.length, 1, 'Permission escalation requests must have one fail-closed branch.');
const permissionApprovalReturns = collect(
  permissionApprovalBranches[0].consequent,
  node => node.type === 'ReturnStatement' && node.argument?.type === 'ObjectExpression',
);
assert.equal(permissionApprovalReturns.length, 1, 'Permission escalation requests must return one static denial envelope.');
const permissionApprovalResult = permissionApprovalReturns[0].argument;
assert.deepEqual(
  permissionApprovalResult.properties.map(propertyName).sort(),
  ['permissions', 'scope', 'strictAutoReview'],
  'The browser must not add fields to a permission grant.',
);
const deniedPermissions = objectValue(permissionApprovalResult, 'permissions', 'permission escalation response');
assert.equal(deniedPermissions?.type, 'ObjectExpression', 'Permission escalation must return an empty permissions object.');
assert.equal(deniedPermissions.properties.length, 0, 'Browser-provided permissions must never reach App Server.');
assert.equal(
  staticString(objectValue(permissionApprovalResult, 'scope', 'permission escalation response')),
  'turn',
  'Permission escalation must remain turn-scoped.',
);
const strictAutoReview = objectValue(permissionApprovalResult, 'strictAutoReview', 'permission escalation response');
assert.equal(strictAutoReview?.type, 'BooleanLiteral', 'strictAutoReview must be a static boolean.');
assert.equal(strictAutoReview.value, true, 'Permission escalation must preserve strict auto-review.');

const safeSkillIdentifierFunctions = collect(
  ast,
  node => node.type === 'FunctionDeclaration' && node.id?.name === 'safeSkillIdentifier',
);
assert.equal(safeSkillIdentifierFunctions.length, 1, 'The bridge must validate App Server skill identifiers once.');
const skillIdentifierPatterns = collect(safeSkillIdentifierFunctions[0].body, node => node.type === 'RegExpLiteral').map(
  node => node.pattern,
);
assert.ok(
  skillIdentifierPatterns.some(pattern => pattern.includes('._:-')),
  'Namespaced plugin skills such as figma:figma-design-to-code must be accepted.',
);
assert.ok(
  collect(turnStartCase, node => node.type === 'Identifier' && node.name === 'safeSkillIdentifier').length >= 1,
  'turn/start must normalize namespaced App Server skill identifiers.',
);
assert.ok(
  collect(turnStartCase, node => node.type === 'Identifier' && node.name === 'isFigmaSkillIdentifier').length >= 1,
  'turn/start must recognize the official figma: skill namespace.',
);
const safeServiceTierFunctions = collect(ast, node => node.type === 'FunctionDeclaration' && node.id?.name === 'safeServiceTier');
assert.equal(safeServiceTierFunctions.length, 1, 'The bridge must validate App Server service tiers once.');
for (const method of ['thread/start', 'thread/resume', 'turn/start']) {
  const methodSource = source.slice(switchCaseNode(method).start, switchCaseNode(method).end);
  assert.match(methodSource, /safeServiceTier\(params\.serviceTier\)/, `${method} must validate its speed tier.`);
  assert.match(methodSource, /\{ serviceTier \}/, `${method} must pass the selected speed tier to App Server.`);
}

const clientForFunctions = collect(ast, node => node.type === 'FunctionDeclaration' && node.id?.name === 'clientFor');
assert.equal(clientForFunctions.length, 1, 'The bridge must define one clientFor() factory.');
const clientForFunction = clientForFunctions[0];
const clientKeyDeclarations = collect(
  clientForFunction.body,
  node => node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === 'key',
);
assert.equal(clientKeyDeclarations.length, 1, 'clientFor() must build one composite client key.');
assert.equal(
  clientKeyDeclarations[0].init?.type,
  'TemplateLiteral',
  'The client key must combine identity and runtime signature.',
);
const clientKeyInputs = new Set(
  collect(clientKeyDeclarations[0].init, node => node.type === 'Identifier' && ['userId', 'signature'].includes(node.name)).map(
    node => node.name,
  ),
);
assert.deepEqual([...clientKeyInputs].sort(), ['signature', 'userId'], 'Clients must be isolated by user and runtime signature.');
for (const operation of ['get', 'set']) {
  const calls = collect(
    clientForFunction.body,
    node =>
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.callee.object?.type === 'Identifier' &&
      node.callee.object.name === 'clients' &&
      memberName(node.callee) === operation &&
      node.arguments[0]?.type === 'Identifier' &&
      node.arguments[0].name === 'key',
  );
  assert.ok(calls.length >= 1, `clientFor() must address clients.${operation}() with the composite key.`);
}

const readOwnedThread = classMethod('readOwnedThread');
const ownedThreadReads = collect(
  readOwnedThread.body,
  node =>
    node.type === 'CallExpression' && memberName(node.callee) === 'request' && staticString(node.arguments[0]) === 'thread/read',
);
assert.equal(ownedThreadReads.length, 1, 'readOwnedThread() must resolve ownership from App Server thread/read.');
for (const method of ['thread/read', 'thread/resume', 'thread/name/set', 'thread/archive', 'turn/interrupt', 'turn/start']) {
  const ownershipChecks = collect(
    switchCaseNode(method),
    node => node.type === 'CallExpression' && memberName(node.callee) === 'readOwnedThread',
  );
  assert.equal(ownershipChecks.length, 1, `${method} must verify that the thread belongs to the active runtime.`);
}

const receiveMethod = classMethod('receive');
const resolvedRequestBranches = collect(
  receiveMethod.body,
  node => node.type === 'IfStatement' && containsString(node.test, 'serverRequest/resolved'),
);
assert.equal(resolvedRequestBranches.length, 1, 'receive() must handle serverRequest/resolved exactly once.');
const resolvedRequestDeletes = collect(
  resolvedRequestBranches[0].consequent,
  node =>
    node.type === 'CallExpression' &&
    memberName(node.callee) === 'delete' &&
    memberName(node.callee?.object) === 'serverRequests',
);
assert.equal(resolvedRequestDeletes.length, 1, 'serverRequest/resolved must remove the pending server request.');
assert.ok(
  collect(resolvedRequestDeletes[0].arguments[0], node => node.type === 'Identifier' && node.name === 'requestId').length >= 1,
  'serverRequest/resolved must delete the requestId supplied by App Server.',
);

const loginStartCase = switchCaseNode('account/login/start');
assertOfficialUrlProperty(loginStartCase, 'authUrl', 'account/login/start response');
assertOfficialUrlProperty(loginStartCase, 'verificationUrl', 'account/login/start response');
const rateLimitsReadCase = switchCaseNode('account/rateLimits/read');
assert.equal(
  collect(
    rateLimitsReadCase,
    node =>
      node.type === 'CallExpression' &&
      memberName(node.callee) === 'request' &&
      staticString(node.arguments[0]) === 'account/rateLimits/read',
  ).length,
  1,
  'The bridge must expose the native account/rateLimits/read snapshot without synthesizing quota data.',
);
assert.ok(
  agentsPhpSource.includes("'account/rateLimits/read' => true"),
  'The authenticated WordPress facade must allow the read-only account limit snapshot.',
);
const elicitationBranches = collect(
  receiveMethod.body,
  node => node.type === 'IfStatement' && containsString(node.test, 'mcpServer/elicitation/request'),
);
assert.equal(elicitationBranches.length, 1, 'Elicitation requests must have one URL-sanitization branch.');
assertOfficialUrlProperty(elicitationBranches[0].consequent, 'url', 'elicitation request');
assertOfficialUrlProperty(classMethod('figmaStatus'), 'installUrl', 'Figma status');
assertOfficialUrlProperty(switchCaseNode('figma/install'), 'installUrl', 'Figma installation response');

const respondMethods = collect(ast, node => node.type === 'ClassMethod' && propertyName(node) === 'respond');
assert.equal(respondMethods.length, 1, 'The bridge must have one server-request response method.');
const responseSends = collect(
  respondMethods[0].body,
  node => node.type === 'CallExpression' && memberName(node.callee) === 'send',
);
assert.equal(responseSends.length, 1, 'respond() must send one reply to App Server.');
const responseEnvelope = responseSends[0].arguments[0];
const responseId = objectValue(responseEnvelope, 'id', 'App Server response');
assert.equal(responseId?.type, 'MemberExpression', 'The response id must come from the pending request.');
assert.equal(responseId.object?.type, 'Identifier');
assert.equal(responseId.object.name, 'request');
assert.equal(memberName(responseId), 'id', 'The response must reuse request.id.');
const responseResult = objectValue(responseEnvelope, 'result', 'App Server response');
assert.equal(responseResult?.type, 'Identifier');
assert.equal(responseResult.name, 'result', 'The normalized dynamic-tool result must be sent back.');

const appServerSpawns = collect(
  ast,
  node =>
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'spawn' &&
    node.arguments[1]?.type === 'ArrayExpression' &&
    node.arguments[1].elements.some(argument => staticString(argument) === 'app-server'),
);
assert.equal(appServerSpawns.length, 1, 'The bridge must launch the Codex app-server process exactly once.');
const appServerArguments = appServerSpawns[0].arguments[1].elements;
assert.equal(staticString(appServerArguments[0]), 'app-server', 'The Codex process must start directly in app-server mode.');
assert.ok(
  appServerArguments.filter(argument => staticString(argument) === '-c').length >= 6,
  'The Codex process must receive all required isolation config overrides.',
);
assert.ok(
  appServerArguments.some(argument => argument?.type === 'Identifier' && argument.name === 'CODEX_PERMISSION_CONFIG'),
  'The Codex process must install the restricted permission profile.',
);
for (const override of ['features.shell_tool=false', 'agents.enabled=false', 'web_search="disabled"', 'tools.view_image=false']) {
  assert.ok(
    appServerArguments.some(argument => staticString(argument) === override),
    `Missing isolation override: ${override}`,
  );
}

assert.doesNotMatch(
  source,
  /CODEX_START_TIMEOUT_MS|Codex startup timed out/,
  'A live Codex process must remain in starting state without an artificial global deadline.',
);
assert.match(
  source,
  /CODEX_START_STALL_MS = 90000[\s\S]*?startupActivityAt[\s\S]*?state: stalled \? 'stalled'/,
  'An inactive startup must become an actionable stalled state without being killed automatically.',
);
assert.match(
  source,
  /this\.request\('initialize',[\s\S]*?\}, 0, true\)[\s\S]*?this\.request\('permissionProfile\/list',[\s\S]*?\}, 0, true\)/,
  'Native initialization probes must stay pending until the process answers or exits.',
);
assert.doesNotMatch(
  agentsPhpSource,
  /wait_for_bridge_start/,
  'WordPress requests must poll bridge readiness asynchronously instead of killing a slow startup.',
);
assert.match(
  agentsPhpSource,
  /START_STALL_SECONDS = 90[\s\S]*?kodety_agents_start_stalled[\s\S]*?codex_start_stalled/,
  'A host that cannot sustain persistent processes must leave progress and expose the shared-host fallback.',
);
assert.match(
  agentSetupSource,
  /runtime_download_dns[\s\S]*?DEFAULT_MAX_TRANSIENT_FAILURES = 12[\s\S]*?MAX_AUTOMATIC_RETRY_DELAY_MS[\s\S]*?maxSteps = Number\.POSITIVE_INFINITY[\s\S]*?maxTransientFailures/,
  'Transient downloads must use bounded automatic retries without imposing a deadline on active preparation.',
);

assert.equal(source.includes('KODETY_MCP'), false, 'The native App Server runtime must not depend on KODETY_MCP.');
assert.equal(source.includes('mcpConfig'), false, 'thread/start must not inject an MCP configuration.');

const refreshRuntime = namedVariable(agentPanelAst, 'refreshRuntime', 'Agent UI refreshRuntime');
const refreshRuntimeBody = callbackBody(refreshRuntime, 'Agent UI refreshRuntime');
const runtimeSetupCalls = collect(
  refreshRuntimeBody,
  node => node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'prepareAgentRuntime',
);
assert.equal(runtimeSetupCalls.length, 1, 'Bootstrap and recovery must share one cancellable staged installer.');
assert.equal(runtimeSetupCalls[0].arguments[0]?.name, 'request', 'Runtime setup must use the authenticated WordPress requester.');
for (const field of ['force', 'signal', 'onProgress']) {
  assert.ok(
    objectValue(runtimeSetupCalls[0].arguments[1], field, 'runtime setup options'),
    `Runtime setup must receive ${field}.`,
  );
}
for (const field of ['available']) {
  assert.ok(
    collect(refreshRuntimeBody, node => node.type === 'MemberExpression' && memberName(node) === field).length >= 1,
    `refreshRuntime must inspect config.${field}.`,
  );
}
assert.ok(
  collect(
    refreshRuntimeBody,
    node => node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'readAccount',
  ).length >= 1,
  'A successful runtime retry must continue into account/read.',
);
const refreshAccountCalls = collect(
  refreshRuntimeBody,
  node => node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'readAccount',
);
assert.ok(
  runtimeSetupCalls[0].start < refreshAccountCalls[0].start,
  'All preparation and native-readiness steps must complete before account/read.',
);

const bootstrap = namedVariable(agentPanelAst, 'bootstrap', 'Agent UI bootstrap');
assert.ok(
  bootstrap.init?.type === 'ArrowFunctionExpression' || bootstrap.init?.type === 'FunctionExpression',
  'Agent UI bootstrap must be a local function.',
);
const bootstrapRefreshCalls = collect(
  bootstrap.init.body,
  node => node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'refreshRuntime',
);
assert.equal(bootstrapRefreshCalls.length, 1, 'Normal bootstrap must call refreshRuntime once.');
assert.equal(bootstrapRefreshCalls[0].arguments.length, 0, 'Normal bootstrap must not force POST config/retry.');

const readAccount = namedVariable(agentPanelAst, 'readAccount', 'Agent UI readAccount');
assert.ok(
  containsString(callbackBody(readAccount, 'Agent UI readAccount'), 'account/read'),
  'The sidebar must revalidate the native account/read result through the selected transport.',
);
assert.match(
  agentPanelSource,
  /method: 'account\/read', params: \{ refreshToken: false \}/,
  'Sidebar status reads must not compete with Settings token refresh or login.',
);
const openAccountSettings = namedVariable(agentPanelAst, 'openAccountSettings', 'Agent UI account settings navigation');
const openAccountSettingsBody = callbackBody(openAccountSettings, 'Agent UI account settings navigation');
assert.ok(containsString(openAccountSettingsBody, 'agents'), 'Connect must open the Agents settings section.');
assert.ok(
  collect(openAccountSettingsBody, node => node.type === 'CallExpression' && node.callee?.name === 'onNavigate').length === 1,
  'Account navigation must use the editor callback so pending project changes are saved before leaving.',
);
for (const method of ['account/login/start', 'account/login/cancel', 'account/logout']) {
  assert.equal(containsString(agentPanelAst, method), false, `The sidebar must leave ${method} exclusively to Settings.`);
}
assert.match(
  agentSettingsSource,
  /onClick=\{\(\) => void loadAll\(true\)\}[\s\S]*?Tentar novamente/,
  'Settings must own explicit runtime recovery together with account connection.',
);

const agentButtons = collect(
  agentPanelAst,
  node =>
    node.type === 'JSXElement' &&
    node.openingElement?.name?.type === 'JSXIdentifier' &&
    ['Button', 'button'].includes(node.openingElement.name.name),
);
function buttonWithLabel(label) {
  return agentButtons.filter(button => agentPanelSource.slice(button.start, button.end).includes(label));
}
const connectButtons = buttonWithLabel('Conectar conta OpenAI');
assert.ok(connectButtons.length >= 1, 'The signed-out Agent panel must keep a visible “Conectar conta OpenAI” CTA.');
assert.ok(
  connectButtons.some(
    button => collect(button, node => node.type === 'Identifier' && node.name === 'openAccountSettings').length >= 1,
  ),
  'The connect CTA must navigate to Settings > Agents.',
);
assert.match(
  agentPanelSource,
  /viewBox="0 0 24 24"[\s\S]*?fill-white\/90/,
  'The signed-out panel must use the supplied white OpenAI mark without a decorative icon card.',
);
assert.doesNotMatch(agentPanelSource, /Ver diagnóstico/, 'The Agent UI must not expose internal runtime diagnostics.');
assert.doesNotMatch(agentSettingsSource, /Ver diagnóstico/, 'Settings > Agents must not expose internal runtime diagnostics.');
assert.match(
  agentSettingsSource,
  /accountLogin && agentAccountLoginUrl\(accountLogin\.url\)[\s\S]*?HtmlAgentDeviceCodeCard[\s\S]*?userCode=\{accountLogin\.userCode\}/,
  'Settings must show the device code only alongside a validated official login URL.',
);
assert.doesNotMatch(
  agentPanelSource,
  /\)\s*:\s*unavailable\s*\?\s*\([\s\S]*?\)\s*:\s*!account\s*\?\s*\(/,
  'The unavailable branch must not mask the signed-out account CTA.',
);
assert.match(agentPanelSource, /agentRuntimeFailure/, 'The panel must use the shared safe runtime diagnostics.');
assert.match(agentSettingsSource, /agentRuntimeFailure/, 'Settings must use the same runtime diagnostics.');
assert.match(
  agentSetupSource,
  /sidecar_unavailable/,
  'The shared UI diagnostics must translate the packaged sidecar_unavailable reason.',
);
assert.ok(
  agentRuntimeStatusSource.includes('Preparando o Agent') && agentPanelSource.includes('<HtmlAgentRuntimeStatus'),
  'The connect state must report preparation of the selected Agent runtime.',
);
assert.match(
  agentRuntimeStatusSource,
  /role="progressbar"[\s\S]*?Em partes · retomada automática/,
  'Runtime downloads must use the native compact progress treatment and explain resumable parts.',
);
assert.match(
  agentRuntimeStatusSource,
  /runtime_download_dns[\s\S]*?runtime_download_blocked[\s\S]*?Hospedagens compartilhadas[\s\S]*?Motivo detectado:[\s\S]*?Conectar via MCP/,
  'A blocked local host must show its reason and let the user choose a local or MCP connection.',
);
const networkBlockCodes = agentRuntimeStatusSource.match(/const HOST_NETWORK_BLOCK_CODES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
assert.doesNotMatch(
  networkBlockCodes,
  /runtime_range_unsupported/,
  'A server that ignores Range must use the compatible download fallback instead of being labeled as a shared-host block.',
);
assert.match(
  agentRuntimeStatusSource,
  /sidecar_start_stalled[\s\S]*?codex_start_stalled/,
  'A stalled local process must use the same justified shared-host and MCP fallback state.',
);
assert.match(
  agentPanelSource,
  /const openMcpSettings[\s\S]*?searchParams\.set\('section', 'mcp'\)[\s\S]*?onNavigate/,
  'The MCP fallback must open Settings on the MCP section through the editor-safe navigation callback.',
);
assert.match(
  agentPanelSource,
  /runtimeBlockedByHosting \? 'Escolha como conectar o Agent'[\s\S]*?Conecte um cliente de IA via MCP[\s\S]*?ponte MCP/,
  'The blocked local state must offer an explicit choice and explain the Studio MCP alternative.',
);
assert.match(
  agentSettingsSource,
  /const connectOrSwitchAccount[\s\S]*?rpc\('account\/logout'\)[\s\S]*?rpc\('account\/login\/start'\)[\s\S]*?agentAccountLoginUrl[\s\S]*?if \(!deviceCode\)[\s\S]*?openAgentAccountLoginPage/,
  'Settings > Agents must show the connected account and complete a safe logout-to-login account switch.',
);
assert.match(
  agentSettingsSource,
  /Conta OpenAI e Agente[\s\S]*?Trocar a conta OpenAI conectada\?[\s\S]*?account\?\.email[\s\S]*?Trocar conta/,
  'Settings > Agents must display the current account and expose an explicit switch confirmation.',
);
assert.match(
  agentSettingsSource,
  /notifyAgentAccountChanged\(agentUrl, true\)[\s\S]*?notifyAgentAccountChanged\(agentUrl, false\)/,
  'Account switching must notify the mounted Agent panel at logout and after the new login completes.',
);
assert.match(
  agentPanelSource,
  /const clearAccountSession[\s\S]*?setThreadId\(''\)[\s\S]*?setMessages\(\[\]\)[\s\S]*?subscribeAgentAccountChanged\(agentUrl, connected =>[\s\S]*?connected === false[\s\S]*?clearAccountSession\(\)[\s\S]*?accountRefreshRef\.current\(\)/,
  'The Agent panel must discard account-bound session state and refresh after Settings changes account.',
);
assert.match(
  agentAccountSyncSource,
  /addEventListener\('storage', stored\)[\s\S]*?removeEventListener\('storage', stored\)/,
  'Account invalidation must work across tabs and remove its subscriptions on cleanup.',
);
assert.match(
  agentPanelSource,
  /observeAgentAccount\(\{\s*read: readAccount,[\s\S]*?onAccount: nextAccount[\s\S]*?setAccount\(nextAccount\)/,
  'An account-change notification must trigger an authoritative read, not authorize a supplied account payload.',
);
assert.match(agentPanelSource, /selected: 'local'/, 'The sidebar must default to this server before reading the saved transport.');
assert.match(agentRuntimeStatusSource, /browser_runtime_unsupported/, 'Studio runtime blocks must use the same explicit local or MCP choice.');
assert.match(
  agentPanelSource,
  /aria-label="Agente"[\s\S]*?flex h-full min-h-0 flex-col bg-transparent/,
  'The Agent surface must inherit the same sidebar background as Canvas mode.',
);
assert.doesNotMatch(
  agentPanelSource,
  /data-enhancing/,
  'Sending a message must not flash the decorative purple composer border.',
);
assert.match(
  agentComposerStyleSource,
  /\.frame\[data-dragging\]::after[\s\S]*?conic-gradient/,
  'The animated composer border must remain limited to the file drop target.',
);
assert.match(
  workspaceAgentDockSource,
  /OPEN_HTML_AGENT_PANEL_EVENT[\s\S]*?data-workspace-agent-dock[\s\S]*?<HtmlAgentPanel visible(?:=\{open\})?(?: preferredSkill=\{preferredSkill\})? \/>/,
  'Standalone workspaces must reuse the protected Agent panel in a collapsible right dock that Option 6 can open.',
);
assert.match(
  socialImageBuilderSource,
  /data-kodety-fullscreen-surface="social-image-builder"/,
  'The Social Image Builder must identify itself as an Agent-safe fullscreen surface.',
);
assert.match(
  globalsSource,
  /data-workspace-agent-dock\]\[data-open=['"]false['"]\][\s\S]*?data-kodety-fullscreen-surface[\s\S]*?right: 2\.75rem !important[\s\S]*?data-open=['"]true['"][\s\S]*?right: max\(340px, min\(420px, 42vw\)\) !important/,
  'Fullscreen workspace tools must reserve both collapsed and expanded Agent dock widths.',
);
for (const surface of ['Templates', 'CMS', 'Analytics', 'Members', 'Localization', 'Settings']) {
  assert.ok(
    projectEditorSource.includes(`standaloneWorkspaceBody('${surface}'`),
    `The ${surface} workspace must expose the shared right-side Agent dock.`,
  );
}
assert.match(
  projectEditorSource,
  /editor: \{[\s\S]*?workspace: appView,[\s\S]*?nativePanel:[\s\S]*?directSourceMutationAllowed: false/,
  'Agent context must identify the active standalone workspace.',
);
assert.match(
  projectEditorSource,
  /localization: \{[\s\S]*?tools: localizationTools,[\s\S]*?workspaceRequired: false/,
  'Localization semantic tools must be advertised independently from the visible workspace.',
);
assert.doesNotMatch(
  projectEditorSource,
  /Abra Localização para (?:ler|aplicar)/,
  'The Agent localization API must not require the Languages screen to be open.',
);
assert.match(
  KODETY_BUILDER_INSTRUCTIONS.join(' '),
  /Localization semantic tools are independent from the visible workspace:[\s\S]*?same native revisioned Localization API/,
  'The embedded Agent must use the native localization transaction from every workspace.',
);
for (const marker of [
  'data-kodety-agent-surface',
  "tool === 'kodety_panel_snapshot'",
  "tool === 'kodety_panel_action'",
  'alterações diretas no código estão bloqueadas aqui',
]) {
  assert.ok(projectEditorSource.includes(marker), `The visual panel Agent bridge is incomplete; missing ${marker}.`);
}
for (const marker of [
  '[data-kodety-agent-surface]',
  '[role="dialog"], [role="menu"], [role="listbox"]',
  'expectedRevision !== before.revision',
  'confirmDestructive',
  "['settings', 'kodefy', 'cms', 'analytics', 'localization', 'members', 'templates']",
]) {
  assert.ok(panelToolsSource.includes(marker), `The generic native panel controller is incomplete; missing ${marker}.`);
}
assert.match(
  agentPanelSource,
  /mode === 'human' \? 'Canvas' : 'Agent'/,
  'The visible editor mode switch must label the direct editing surface as Canvas.',
);
assert.match(
  agentDeviceCodeCardSource,
  /readOnly[\s\S]*?value=\{userCode\}[\s\S]*?select-all[\s\S]*?Copiado[\s\S]*?Continuar na OpenAI[\s\S]*?href=\{fallbackUrl\}[\s\S]*?noopener noreferrer/,
  'The shared login card must keep a selectable code, visible copy status, explicit Continue, and safe official fallback.',
);
assert.match(
  agentPanelSource,
  /messageAutoScrollRef\.current[\s\S]*?scrollHeight - list\.scrollTop - list\.clientHeight <= 72/,
  'Conversation streaming must preserve manual history scrolling unless the reader remains near the bottom.',
);
assert.match(
  agentPanelSource,
  /if \(!messageAutoScrollRef\.current\) return;[\s\S]*?scrollTop = messageListRef\.current\.scrollHeight/,
  'Automatic scrolling must stop after the reader moves up in conversation history.',
);
assert.match(
  agentPanelSource,
  />Uso restante<[\s\S]*?100 - item\.window\.usedPercent[\s\S]*?rateLimitCompactResetLabel\(item\.window\.resetsAt\)/,
  'The model menu must show backend-derived remaining usage and reset timestamps.',
);
assert.match(
  agentPanelSource,
  /onOpenChange=\{open => \{[\s\S]*?if \(open && !licenseRequired\) void loadRateLimits\(\)/,
  'Opening the model menu must retry the native rate-limit read only for licensed users.',
);
assert.match(
  agentPanelSource,
  /Consultando sua conta…[\s\S]*?Limites não informados pela conta\./,
  'The usage section must remain visible while native limits load or are unavailable.',
);
assert.match(
  agentPanelSource,
  /function rateLimitUsageLabel[\s\S]*?rateLimitWindowLabel\(window\)/,
  'Usage rows must preserve the actual App Server window duration labels.',
);
assert.match(
  agentComposerStyleSource,
  /\.usageRow\s*\{[\s\S]*?grid-template-columns:[\s\S]*?\.usagePercent[\s\S]*?\.usageReset/,
  'Remaining usage must have a compact model-menu layout.',
);
assert.doesNotMatch(
  agentPanelSource,
  /aria-label="Agente"[\s\S]*?flex h-full min-h-0 flex-col bg-background/,
  'The Agent surface must not paint a darker nested background over the shared sidebar.',
);
assert.match(
  agentPanelSource,
  /aria-label="Sessão do agente"[\s\S]*?aria-label="Nova sessão"/,
  'The Agent header must expose the refined session picker beside its matching new-session button.',
);
assert.doesNotMatch(
  agentPanelSource,
  /<select[\s\S]*?aria-label="(?:Modelo do agente|Nível de pensamento|Sessão do agente)"/,
  'Session, model and reasoning controls must use the custom Agent menus instead of native selects.',
);
assert.match(
  agentPanelSource,
  /aria-label="Selecionar modelo"[\s\S]*?>Modelo<[\s\S]*?role="menuitemradio"[\s\S]*?aria-checked=\{checked\}/,
  'The composer must expose the compact custom Sol, Terra, Luna, and GPT-5.5 model menu.',
);
assert.match(
  agentPanelSource,
  />Esforço<[\s\S]*?effortOptions\.map[\s\S]*?aria-label=\{`Esforço \$\{effortLabel\(option\)\}`\}/,
  'The compact model menu must retain the reasoning-effort selector.',
);
assert.match(
  agentComposerStyleSource,
  /\.modelInfo\s*\{[\s\S]*?right:\s*calc\(100% \+ 6px\);[\s\S]*?left:\s*auto;/,
  'Model descriptions must open to the left of the model menu.',
);
assert.match(
  agentPanelSource,
  /function orderedAgentSkills[\s\S]*?const pinned = \[figma, kodety, widgets, motion, performance\]/,
  'Figma, Kodety, Kodety Widgets, Kodety Motion and Kodety Performance must stay pinned as essential skills.',
);
assert.match(
  agentPanelSource,
  /function isEssentialAgentSkill[\s\S]*?isKodetyMotionSkill\(name\)[\s\S]*?isKodetyPerformanceSkill\(name\)[\s\S]*?isKodetyWidgetsSkill\(name\)/,
  'Kodety Widgets, Motion and Performance must receive the same essential treatment as Figma and Kodety.',
);
assert.match(
  agentPanelSource,
  /className=\{composerStyles\.chips\}[\s\S]*?selectedSkills\.map[\s\S]*?className=\{composerStyles\.skillAdd\}[\s\S]*?aria-label="Adicionar skills"[\s\S]*?placeholder="Pesquisar skill…"/,
  'The skills menu must open from the add button beside the selected skill pills.',
);
assert.match(
  agentComposerStyleSource,
  /\.skillAdd\s*\{[\s\S]*?background:\s*rgb\(147 147 255 \/ 0\.13\);[\s\S]*?color:\s*var\(--kodety-accent-hover\);/,
  'The inline add button must share the purple selected-skill styling.',
);
assert.doesNotMatch(
  agentPanelSource,
  /selectFigmaDefaults|defaultFigmaSkillNames|loadRuntimeData\(true\)/,
  'Catalog refresh must not automatically activate Figma or Widgets.',
);
assert.doesNotMatch(
  agentSettingsSource,
  /selectDefaultFigmaSkills|defaultFigmaSkillNames/,
  'Connecting Figma from settings must not change the selected skills.',
);
assert.doesNotMatch(
  agentsPhpSource,
  /if \(!in_array\('kodety-widgets', \$(?:enabled_skills|skills)/,
  'The server must not inject optional Widgets into preferences or turns.',
);
assert.match(agentsPhpSource, /private const DEFAULT_SKILLS = \['kodety-editor'\];/, 'The server must default to Editor only.');
assert.match(
  agentPanelSource,
  /collisionPadding=\{16\}[\s\S]*?w-\[min\(286px,calc\(100vw-32px\)\)\]/,
  'The skills panel must preserve comfortable horizontal margins inside narrow Agent sidebars.',
);
assert.doesNotMatch(
  agentPanelSource,
  /aria-label="Selecionar skills"/,
  'The redundant standalone skills icon must stay removed.',
);
assert.doesNotMatch(agentPanelSource, /Aprimorar prompt|Reverter/, 'The redundant prompt-enhancement control must stay removed.');
assert.match(
  editorShellSource,
  /\$can_preview_agent\s*=\s*!\$is_shared[\s\S]*?'agentUrl'\s*=>\s*\$can_preview_agent[\s\S]*?'agentNonce'\s*=>\s*\$can_preview_agent/,
  'Editors must receive the safe Agent preview endpoint even when the Pro entitlement is inactive.',
);
assert.doesNotMatch(agentsPhpSource, /kodety_license_agents_required/, 'Agent authorization must not require a product license.');
assert.match(agentPanelSource, /const licenseRequired = false;/, 'The public Agent has no product-license lock.');
assert.doesNotMatch(agentPanelSource, /Disponível apenas para usuários Pro|Ativar licença/, 'The Agent must not sell access.');
assert.doesNotMatch(agentSettingsSource, /Agent disponível apenas no Kodety Pro|Ativar licença|value: 'remote'/, 'Settings offer local execution and provider authentication.');
assert.match(
  agentPanelSource,
  /AGENT_PREVIEW_SKILLS[\s\S]*?figma:figma-design-to-code[\s\S]*?kodety-editor[\s\S]*?kodety-widgets[\s\S]*?kodety-motion[\s\S]*?kodety-performance[\s\S]*?kodety-languages/,
  'The locked Agent preview must advertise only the essential Figma and Kodety skills.',
);
assert.match(
  agentPanelSource,
  /rpc\('account\/rateLimits\/read'\)/,
  'The Agent must use native rate-limit snapshots and App Server limit notifications.',
);
assert.match(
  agentPanelSource,
  /account\/rateLimits\/updated[\s\S]*?loadRateLimits\(\)/,
  'Rolling App Server limit updates must refresh the native snapshot.',
);
assert.match(
  agentPanelSource,
  /codexErrorInfo === 'usageLimitExceeded'/,
  'Only the native usage-limit error code may trigger the usage-exhausted fallback.',
);
assert.match(
  agentPanelSource,
  /minutes === 24 \* 60[\s\S]*?Limite diário[\s\S]*?minutes === 7 \* 24 \* 60[\s\S]*?Limite semanal[\s\S]*?Limite de \$\{minutes \/ 60\} horas/,
  'Daily, weekly, and five-hour labels must come from the exact App Server window duration.',
);
assert.match(
  agentPanelSource,
  /function rateLimitSnapshotReached[\s\S]*?rateLimitReachedType[\s\S]*?spendControlReached[\s\S]*?\}/,
  'The exhausted state must require an explicit backend-reported limit condition.',
);
assert.doesNotMatch(
  agentPanelSource.match(/function rateLimitSnapshotReached[\s\S]*?\n\}/)?.[0] || '',
  /usedPercent/,
  'A displayed 100% value alone must not be treated as proof that the account is blocked.',
);
assert.match(
  agentPanelSource,
  /Limite da conta atingido[\s\S]*?aguardar o reset abaixo ou trocar de conta[\s\S]*?Trocar conta[\s\S]*?Atualizar limite/,
  'When the App Server reports exhaustion, the Agent must offer the real reset and account-switch paths.',
);
assert.match(
  agentPanelSource,
  /role="checkbox"[\s\S]*?aria-checked=\{checked\}/,
  'The skills menu must expose an accessible custom checkbox.',
);
assert.doesNotMatch(
  agentPanelSource,
  /selectedSkills\.length \|\| ''/,
  'The compact skills action must not render an active-count badge.',
);
assert.match(
  agentPanelSource,
  /Peça uma alteração ou envie uma referência…[\s\S]*?aria-label="Adicionar imagem, arquivo ou skill"[\s\S]*?aria-label="Selecionar modelo"[\s\S]*?aria-label="Enviar mensagem"/,
  'The Codex composer must keep prompt, attachments, skills, and send controls in one accessible flow.',
);
assert.match(
  agentComposerStyleSource,
  /\.field\s*\{[\s\S]*?border:\s*0\s*!important;[\s\S]*?background:\s*transparent;[\s\S]*?\.field:focus,[\s\S]*?outline:\s*none\s*!important;/,
  'The replacement composer field must not reintroduce a nested input stroke.',
);
assert.match(
  agentPanelSource,
  /function HtmlAgentThinkingOrb[\s\S]*?role="status"[\s\S]*?thinkingLattice[\s\S]*?>Pensando<[\s\S]*?message\.streaming \? <HtmlAgentThinkingOrb \/>[\s\S]*?running && !messages\.some[\s\S]*?<HtmlAgentThinkingOrb \/>/,
  'The Agent must use the accessible S2 lattice orb before response streaming starts.',
);
assert.match(
  agentPanelSource,
  /function renderInlineMarkdown[\s\S]*?case 'strong':[\s\S]*?<strong[\s\S]*?function HtmlAgentMarkdown[\s\S]*?marked\.lexer[\s\S]*?catch[\s\S]*?markdownFallback[\s\S]*?<HtmlAgentMarkdown text=\{message\.text\} \/>/,
  'Assistant messages must render safe Markdown instead of exposing formatting markers.',
);
assert.match(
  agentPanelSource,
  /function agentMessageText[\s\S]*?string\(item\.text\) \|\| messageTextFromContent\(item\.content\)[\s\S]*?method === 'item\/completed'[\s\S]*?completedText \|\| current/,
  'Completed Agent events must accept content arrays and must never erase streamed response text.',
);
assert.doesNotMatch(
  agentPanelSource,
  /dangerouslySetInnerHTML/,
  'Agent Markdown must remain token-rendered and must not inject raw HTML.',
);
assert.match(
  agentComposerStyleSource,
  /\.thinkingCell\s*\{[\s\S]*?thinkingOrbWave 1\.7s[\s\S]*?@keyframes thinkingOrbWave[\s\S]*?\.thinkingCell\[data-middle\]/,
  'The S2 thinking orb must keep its diagonal wave and reduced-motion resting frame.',
);
assert.match(
  agentPanelSource,
  /function HtmlAgentProgress[\s\S]*?role="status"[\s\S]*?progress\.steps\.map[\s\S]*?kodety_progress_update[\s\S]*?setAgentProgress\(progress\)[\s\S]*?<HtmlAgentProgress progress=\{agentProgress\} \/>/,
  'The Agent must render real tool-driven progress above the composer.',
);
assert.match(
  agentComposerStyleSource,
  /\.progressCard\s*\{[\s\S]*?\.progressStep\[data-status="in_progress"\][\s\S]*?progressShimmer[\s\S]*?prefers-reduced-motion/,
  'The progress card must preserve active, completed, pending, and reduced-motion states.',
);
for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']) {
  assert.ok(agentPanelSource.includes(model), `The Codex composer must advertise ${model}.`);
  assert.ok(source.includes(model), `The Codex bridge must allow ${model}.`);
}
assert.match(
  source,
  /const CODEX_AGENT_MODELS = new Set\([\s\S]*?case 'model\/list'[\s\S]*?CODEX_AGENT_MODELS\.has/,
  'The bridge must filter model discovery through the Astra, Sol, Terra, Luna, and GPT-5.5 allow-list.',
);
assert.match(
  agentPanelSource,
  /id: 'gpt-5\.5'[\s\S]*?supportedReasoningEfforts:[\s\S]*?'none'[\s\S]*?'low'[\s\S]*?'medium'[\s\S]*?'high'[\s\S]*?'xhigh'[\s\S]*?defaultReasoningEffort: 'medium'/,
  'GPT-5.5 must expose only the reasoning efforts supported by the official model.',
);
assert.match(
  agentPanelSource,
  /function elementReferenceFromPrompt[\s\S]*?KODETY_SELECTION_REFERENCE[\s\S]*?KODETY_EDITOR_CONTEXT/,
  'Agent history must restore the selected element reference from persisted turns.',
);
assert.match(
  agentPanelSource,
  /const target = elementReferenceFromContext\(context\);[\s\S]*?role: 'user'[\s\S]*?\{ target \}/,
  'A new user message must snapshot the selected element instead of reading the later canvas selection.',
);
assert.match(
  agentPanelSource,
  /aria-label=\{`Focar elemento \$\{message\.target\.identifier\} no canvas`\}[\s\S]*?message\.target\.identifier/,
  'The user message box must show the selected element identifier and let the user focus it again.',
);

assert.equal(runtimeManifest.schemaVersion, 1, 'The managed runtime manifest must use schema version 1.');
assert.equal(runtimeManifest.node?.version, '24.14.0', 'The private Node.js runtime must be version-pinned.');
assert.equal(
  runtimeManifest.codex?.version,
  '0.147.0-alpha.6.5',
  'The private Codex runtime must match the App Server contract version.',
);
const managedTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];
assert.deepEqual(
  Object.keys(runtimeManifest.node?.targets || {}).sort(),
  managedTargets,
  'Node.js must cover every supported server target.',
);
assert.deepEqual(
  Object.keys(runtimeManifest.codex?.targets || {}).sort(),
  managedTargets,
  'Codex must cover every supported server target.',
);
for (const target of managedTargets) {
  const nodeArtifact = runtimeManifest.node.targets[target];
  const codexArtifact = runtimeManifest.codex.targets[target];
  assert.match(nodeArtifact.url, /^https:\/\/nodejs\.org\//, `${target} Node.js must come from nodejs.org.`);
  assert.match(nodeArtifact.sha256, /^[a-f0-9]{64}$/, `${target} Node.js must pin SHA-256.`);
  assert.match(
    codexArtifact.url,
    /^https:\/\/registry\.npmjs\.org\/@openai\/codex\//,
    `${target} Codex must come from the official package.`,
  );
  assert.equal(Buffer.from(codexArtifact.sha512, 'base64').length, 64, `${target} Codex must pin SHA-512.`);
}
for (const marker of [
  'ensure_managed_runtime()',
  'wp_remote_get($url',
  'hash_file($algorithm',
  'managed_runtime_root()',
  'KODETY_AGENT_MANAGED_RUNTIME',
  'KODETY_AGENT_RUNTIME_DIR',
  'select_executable_runtime_root()',
  'process_execution_available()',
  'runtime_execution_error(',
]) {
  assert.ok(agentsPhpSource.includes(marker), `The WordPress runtime provisioner is incomplete; missing ${marker}.`);
}
assert.doesNotMatch(
  agentsPhpSource,
  /\)\s*:\s*true\s*[|{]/,
  'The Agent facade must not require PHP 8.2 literal types when the plugin declares PHP 8.0.',
);
for (const marker of [
  "'/agents/attachments'",
  'validate_attachment_upload',
  "'/.attachments'",
  'MAX_USER_ATTACHMENT_BYTES',
  'ATTACHMENT_TTL_SECONDS',
]) {
  assert.ok(agentsPhpSource.includes(marker), `The private attachment facade is incomplete; missing ${marker}.`);
}
assert.doesNotMatch(
  agentsPhpSource,
  /install\.sh\s*\|\s*(?:ba)?sh/,
  'WordPress must install verified artifacts directly instead of piping a remote script into a shell.',
);

for (const artifact of [
  'agent-runtime/server.mjs',
  'agent-runtime/builder-instructions.mjs',
  'agent-runtime/runtime-manifest.json',
  'agent-skills/kodety-editor/SKILL.md',
  'agent-skills/kodety-editor/SKILL.json',
  'agent-skills/kodety-editor/references/native-panels.md',
  'agent-skills/kodety-widgets/SKILL.md',
  'agent-skills/kodety-widgets/SKILL.json',
  'agent-skills/kodety-widgets/agents/openai.yaml',
  'agent-skills/kodety-widgets/references/agent-operations.md',
  'agent-skills/kodety-widgets/references/code-component-contract.md',
  'agent-skills/kodety-widgets/references/control-catalog.md',
  'agent-skills/kodety-motion/SKILL.md',
  'agent-skills/kodety-motion/SKILL.json',
  'agent-skills/kodety-motion/agents/openai.yaml',
  'agent-skills/kodety-motion/references/motion-engine.md',
  'agent-skills/kodety-performance/SKILL.md',
  'agent-skills/kodety-performance/SKILL.json',
  'agent-skills/kodety-performance/agents/openai.yaml',
  'agent-skills/kodety-performance/references/performance-playbook.md',
  'agent-skills/kodety-languages/SKILL.md',
  'agent-skills/kodety-languages/SKILL.json',
  'agent-skills/kodety-languages/agents/openai.yaml',
  'agent-skills/kodety-languages/references/bulk-translation-contract.md',
  'includes/class-kodety-agents.php',
]) {
  assert.ok(REQUIRED_WORDPRESS_PLUGIN_FILES.includes(artifact), `The WordPress package contract must include ${artifact}.`);
}

for (const marker of [
  'kodety_code_component_snapshot',
  'kodety_apply_code_component_changes',
  'upsertSource',
  'insertInstance',
  'updateInstance',
]) {
  assert.ok(source.includes(marker), `The native Code Component Agent contract is incomplete; missing ${marker}.`);
}
for (const marker of [
  'defineComponent',
  'kodety_code_component_snapshot',
  'kodety_apply_code_component_changes',
  'references/control-catalog.md',
]) {
  assert.ok(widgetsSkillSource.includes(marker), `Kodety Widgets skill is incomplete; missing ${marker}.`);
}

const htmlProjectEditorEntries = Object.values(wordpressManifest).filter(
  entry => entry && typeof entry === 'object' && entry.name === 'HtmlProjectEditor' && typeof entry.file === 'string',
);
assert.equal(htmlProjectEditorEntries.length, 1, 'The WordPress manifest must expose one packaged HtmlProjectEditor chunk.');
async function readPackagedChunkGraph(entry) {
  const visited = new Set();
  const chunks = [];
  const visit = async current => {
    assert.ok(current && typeof current.file === 'string', 'Every packaged import must resolve in the manifest.');
    if (visited.has(current.file)) return;
    visited.add(current.file);
    chunks.push(await readFile(new URL(`../Wordpress/kodety/assets/${current.file}`, import.meta.url), 'utf8'));
    for (const key of [...(current.imports || []), ...(current.dynamicImports || [])]) await visit(wordpressManifest[key]);
  };
  await visit(entry);
  return chunks.join('\n');
}

// The Agent is shared with standalone workspaces and can live in a lazy chunk.
const packagedEditorChunk = await readPackagedChunkGraph(htmlProjectEditorEntries[0]);
for (const marker of [
  'Conectar conta OpenAI',
  'Tentar novamente',
  'sidecar_unavailable',
  'config/retry',
  'Preparando o Agent',
  'Hospedagens compartilhadas',
  'Conectar via MCP',
  'Escolha como conectar o Agent',
  'Pesquisar skill',
  'Adicionar skills',
  'Figma to Kodety',
  'Print do elemento',
  'Adicionar outro print',
  'Link do Figma',
  'Instruções complementares',
  'Selecionar modelo',
  'Esforço',
  'Pensando',
  'noopener noreferrer nofollow',
  'Elemento selecionado:',
  'kodety_component_snapshot',
  'kodety_apply_component_changes',
  'kodety_motion_snapshot',
  'kodety_apply_motion',
  'kodety_panel_snapshot',
  'kodety_panel_action',
  'To-dos',
  'Anexar TXT, DOC, DOCX ou imagem',
  'Preparando anexo',
  'Limite da conta atingido',
  'Atualizar limite',
  'Canvas',
  'Uso restante',
  'Atualizar uso restante',
  'Consultando sua conta',
  'Limites não informados pela conta',
]) {
  assert.ok(packagedEditorChunk.includes(marker), `The packaged Agent UI is stale or incomplete; missing marker: ${marker}`);
}

const htmlProjectSettingsEntries = Object.values(wordpressManifest).filter(
  entry => entry && typeof entry === 'object' && entry.name === 'HtmlProjectSettings' && typeof entry.file === 'string',
);
assert.equal(htmlProjectSettingsEntries.length, 1, 'The WordPress manifest must expose one packaged HtmlProjectSettings chunk.');
const packagedSettingsChunk = await readPackagedChunkGraph(htmlProjectSettingsEntries[0]);
for (const marker of [
  'Trocar a conta OpenAI conectada?',
  'Aguardando login',
  'Copie seu código de acesso',
  'Copiado',
  'Continuar na OpenAI',
  'kodety-agent-account-changed',
]) {
  assert.ok(
    packagedSettingsChunk.includes(marker),
    `The packaged Agent account settings are stale or incomplete; missing marker: ${marker}`,
  );
}

console.log('Runtime e recuperação do agente Kodety aprovados (App Server + UI + pacote, sem MCP).');
