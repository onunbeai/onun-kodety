import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, getSupportedThinkingLevels, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { readBrowserAgentSkills } from '../../scripts/browser-agent-skill-catalog.mjs';
import { createBrowserAgentSkills } from '../../lib/html-editor/browser-agent-skills.mjs';
import { createBrowserAgentRuntime } from '../../lib/html-editor/browser-agent-runtime.mjs';

const packages = await readBrowserAgentSkills();
const catalog = createModels();
catalog.setProvider(openaiCodexProvider());
const model = catalog.getModel('openai-codex', 'gpt-5.6-terra');
const credential = { type: 'oauth', access: `fixture.${Buffer.from(JSON.stringify({ email: 'skills@example.test' })).toString('base64url')}.signature`, refresh: 'fixture-refresh', expires: Date.now() + 3600000 };
const rpcFor = runtime => (method, params = {}) => runtime.request('rpc', { body: { method, params } });
const upload = (name, files) => ({ name, files: Object.entries(files).map(([path, content]) => ({ path, contentBase64: Buffer.from(content).toString('base64') })) });
async function until(read, predicate) {
  for (let i = 0; i < 200; i++) {
    const result = await read();
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected Agent state did not arrive');
}

test('browser catalog contains every server package with exact instructions, references and presentation metadata', () => {
  const skills = createBrowserAgentSkills(packages);
  const listed = skills.list();
  assert.deepEqual(listed.map(skill => skill.name).sort(), ['kodety-editor', 'kodety-languages', 'kodety-motion', 'kodety-performance', 'kodety-widgets']);
  for (const packaged of packages) {
    const skill = listed.find(entry => entry.name === packaged.name);
    const metadata = JSON.parse(packaged.files.find(file => file.path === 'SKILL.json').content);
    assert.deepEqual(skill.interface, metadata.interface);
    assert.equal(skill.enabled, true);
    for (const file of packaged.files) assert.equal(skills.read({ name: skill.name, path: file.path, maxChars: 50000 }).content, file.content);
  }
  assert.deepEqual(skills.selected([]), ['kodety-editor']);
  assert.deepEqual(skills.selected(['missing', 'kodety-motion', 'kodety-motion']), ['kodety-editor', 'kodety-motion']);
  assert.throws(() => skills.read({ name: 'kodety-editor', path: '../../auth.json' }), error => error.status === 404);
});

test('settings list, install, selection, disable, deletion and restore retain skills in HTML and WordPress browser runtime', async () => {
  const dependencies = { models: { getModels: () => [model], logout: async () => {} }, Agent, getSupportedThinkingLevels };
  const runtime = createBrowserAgentRuntime({ projectId: 'skills-project', licensed: true, skills: packages, dependencies });
  const restored = createBrowserAgentRuntime({ projectId: 'skills-project', licensed: true, skills: packages, dependencies });
  const rpc = rpcFor(runtime);
  try {
    const config = await runtime.request('config');
    assert.equal(config.capabilities.skills, true);
    assert.equal(config.canManageSkills, true);
    assert.deepEqual(config.enabledSkills, ['kodety-editor']);
    assert.equal((await rpc('skills/list')).data[0].skills.length, packages.length);
    const custom = upload('project-voice', { 'SKILL.md': '---\nname: project-voice\ndescription: Follow the project voice.\n---\nApply the voice described in references/voice.md.', 'references/voice.md': 'Use concrete verbs and short paragraphs.' });
    await runtime.request('skills', { body: custom });
    await runtime.request('config', { body: { enabledSkills: ['project-voice', 'kodety-performance', 'missing'] } });
    const performance = (await rpc('skills/list')).data[0].skills.find(skill => skill.name === 'kodety-performance');
    await rpc('skills/config/write', { path: performance.path, enabled: false });
    const before = runtime.snapshot();
    assert.deepEqual(before.settings.enabledSkills, ['kodety-editor', 'project-voice']);
    assert.equal(JSON.stringify(before.skills).includes('native-panels.md'), false, 'bundled files are not duplicated in persistent history');
    restored.restore(before);
    assert.deepEqual(await restored.request('config'), await runtime.request('config'));
    assert.deepEqual(await rpcFor(restored)('skills/list'), await rpc('skills/list'));
    assert.deepEqual(restored.snapshot().skills, before.skills);
    await assert.rejects(runtime.request('skills', { method: 'DELETE', body: { name: 'kodety-editor' } }), /não podem ser removidas/);
    await assert.rejects(rpc('skills/config/write', { path: '/outside/SKILL.md', enabled: true }), error => error.status === 403);
    await assert.rejects(runtime.request('skills', { body: upload('unsafe', { 'SKILL.md': '---\nname: unsafe\n---\nRead me', '../escape.md': 'escape' }) }), /caminho inválido/);
    await assert.rejects(runtime.request('skills', { body: upload('wrong-name', { 'SKILL.md': '---\nname: different\n---\nRead me' }) }), /nome da pasta/);
    await runtime.setPolicy({ readOnly: true });
    await assert.rejects(runtime.request('skills', { body: custom }), error => error.code === 'agent_read_only');
    await runtime.setPolicy({ readOnly: false });
    await runtime.request('skills', { method: 'DELETE', body: { name: 'project-voice' } });
    assert.deepEqual((await runtime.request('config')).enabledSkills, ['kodety-editor']);
    assert.equal((await rpc('skills/list')).data[0].skills.some(skill => skill.name === 'project-voice'), false);
  } finally { await runtime.dispose(); await restored.dispose(); }
});

test('real Pi Agent consumes selected skill, reads its reference, awaits Builder ACK, and refreshes skill instructions next turn', async () => {
  const conversations = [];
  const responses = [
    { type: 'toolCall', id: 'read-contract', name: 'kodety_skill_read', arguments: { name: 'kodety-motion', path: 'references/motion-engine.md' } },
    { type: 'toolCall', id: 'apply-motion', name: 'kodety_apply_changes', arguments: { expectedRevision: 'r1' } },
    { type: 'text', text: 'Motion aplicado e confirmado.' },
    { type: 'text', text: 'Performance conferida.' },
  ];
  const models = {
    getModels: () => [model], logout: async () => {},
    login: async (_provider, _method, interaction) => {
      interaction.notify({ type: 'device_code', userCode: 'SKILLS-TEST', verificationUri: 'https://auth.openai.com/codex/device', expiresInSeconds: 900 });
      return credential;
    },
    streamSimple(chosen, conversation) {
      conversations.push(JSON.parse(JSON.stringify(conversation)));
      const content = responses.shift();
      assert.ok(content, 'unexpected model request');
      const message = { role: 'assistant', content: [content], api: chosen.api, provider: chosen.provider, model: chosen.id, timestamp: Date.now(), stopReason: content.type === 'toolCall' ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: message.stopReason, message });
      return stream;
    },
  };
  const runtime = createBrowserAgentRuntime({ projectId: 'skills-turn', licensed: true, skills: packages, dependencies: { models, Agent, getSupportedThinkingLevels }, tools: [{ name: 'kodety_apply_changes', description: 'Apply change', inputSchema: { type: 'object', properties: { expectedRevision: { type: 'string' } }, required: ['expectedRevision'] } }] });
  const rpc = rpcFor(runtime);
  try {
    await rpc('account/login/start');
    await until(() => rpc('account/read'), value => value.account);
    const threadId = (await rpc('thread/start')).thread.id;
    await rpc('turn/start', { threadId, prompt: 'Adicione motion nesta seção.', skills: ['kodety-motion'] });
    const pending = await until(() => runtime.request('events', { body: { threadId } }), value => value.pending.length === 1);
    assert.equal(conversations.length, 2, 'reference is read locally; model cannot continue a mutation without ACK');
    assert.equal(pending.pending[0].params.tool, 'kodety_apply_changes');
    const motion = packages.find(entry => entry.name === 'kodety-motion');
    const motionSource = motion.files.find(file => file.path === 'SKILL.md').content;
    const reference = motion.files.find(file => file.path === 'references/motion-engine.md').content;
    assert.ok(conversations[0].systemPrompt.includes(JSON.stringify(motionSource).slice(1, -1)));
    assert.ok(conversations[0].tools.some(tool => tool.name === 'kodety_skill_read'));
    const readResult = conversations[1].messages.find(message => message.role === 'toolResult' && message.toolName === 'kodety_skill_read');
    assert.equal(JSON.parse(readResult.content[0].text).content, reference);
    await runtime.request('respond', { body: { requestId: pending.pending[0].requestId, result: { success: true, contentItems: [{ type: 'inputText', text: '{"revision":"r2"}' }] } } });
    await until(() => rpc('thread/read', { threadId }), value => value.thread.turns.at(-1).status === 'completed');
    await rpc('turn/start', { threadId, prompt: 'Agora confira a performance.', skills: ['kodety-performance'] });
    await until(() => rpc('thread/read', { threadId }), value => value.thread.turns.length === 2 && value.thread.turns.at(-1).status === 'completed');
    const performance = packages.find(entry => entry.name === 'kodety-performance').files.find(file => file.path === 'SKILL.md').content;
    assert.ok(conversations[3].systemPrompt.includes(JSON.stringify(performance).slice(1, -1)));
    assert.equal(conversations[3].systemPrompt.includes(JSON.stringify(motionSource).slice(1, -1)), false, 'old selected instructions are not retained by Agent state');
    assert.ok(JSON.stringify(conversations[3].messages.at(-1).content).includes('$kodety-performance'));
  } finally { await runtime.dispose(); }
});
