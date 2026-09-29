#!/usr/bin/env node

/** Onun Kodety MCP server — dependency-free STDIO bridge for Codex. */

const argv = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? String(argv[index + 1] || '') : fallback;
};

const site = option('site').replace(/\/+$/, '');
const token = option('token');
if (!site || !token) {
  process.stderr.write('Usage: node server.mjs --site https://example.com --token kodety_xxx\n');
  process.exit(2);
}

const endpoints = [
  `${site}/wp-json/kodety/v1/mcp/tool`,
  `${site}/index.php?rest_route=/kodety/v1/mcp/tool`,
];
const instructions = 'Onun Kodety controls a WordPress site, its CMS and its code-based visual project. Call get_site before writing and confirm target, connectionScope and workspaceRevision. A project-scoped connection only operates while its linked project remains open in the Builder; never bypass a project-target conflict. Preserve existing design and behavior; prefer upsert_section to construct or replace one complete page section with its CSS and Interactions in a single workspace revision; always pass the latest workspaceRevision from get_site as baseRevision. Use replace_in_file for other focused edits; use write_file for deliberate full-file or binary changes; upload_media for WordPress media; call publish only after requested changes are complete. Never invent file paths: list_files first. AI generation always returns an editable draft: inspect it, use upsert_content only when the user asked to save it, default new AI content to draft, and never publish generated content without explicit authorization. Project tools support HTML, CSS, JavaScript, JSON, SVG, fonts and media, while server-side executable files are intentionally blocked.';

const tools = [
  {
    name: 'kodety_get_site',
    description: 'Get the Onun Kodety target project, connection scope, WordPress, active theme, release and MCP status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_get_settings',
    description: 'Read Onun Kodety logo and editor interface settings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_update_settings',
    description: 'Choose the Onun Kodety or client logo for the Builder and update the interface accent color. Accent colors must meet WCAG AA contrast with black text.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        editorCornerIcon: { type: 'string', enum: ['kodety-logo', 'client-logo'] },
        interfaceAccentColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
      },
      anyOf: [{ required: ['editorCornerIcon'] }, { required: ['interfaceAccentColor'] }],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_list_files',
    description: 'List project files recursively. Use before reading or creating files.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional project-relative directory.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_read_file',
    description: 'Read a project file. Text returns UTF-8; images, fonts and other binary assets return base64.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_write_file',
    description: 'Create or overwrite a project file and synchronize it with the editable project ZIP.',
    inputSchema: {
      type: 'object', required: ['path', 'content'], additionalProperties: false,
      properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_replace_in_file',
    description: 'Make a focused exact text replacement in HTML, CSS, JavaScript, JSON or SVG.',
    inputSchema: {
      type: 'object', required: ['path', 'search', 'replacement'], additionalProperties: false,
      properties: { path: { type: 'string' }, search: { type: 'string' }, replacement: { type: 'string' }, replaceAll: { type: 'boolean', default: false } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_upsert_section',
    description: 'Create or replace one complete editable page section and apply its HTML, CSS and Onun Kodety Interactions together as one workspace revision.',
    inputSchema: {
      type: 'object', required: ['page', 'sectionId', 'html', 'baseRevision'], additionalProperties: false,
      properties: {
        page: { type: 'string', description: 'Project-relative HTML path, for example index.html.' },
        sectionId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,79}$' },
        html: { type: 'string', description: 'Complete root element with data-kodety-section-id matching sectionId.' },
        css: { type: 'string', description: 'Optional CSS owned by this section.' },
        interactions: { type: 'array', items: { type: 'object' }, description: 'Optional version-2 interaction entries whose ids start with sectionId plus a hyphen.' },
        baseRevision: { type: 'integer', minimum: 0, description: 'Latest workspaceRevision returned by kodety_get_site.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_delete_file',
    description: 'Delete a project file from the live project and native editable workspace.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_list_content',
    description: 'List WordPress posts, pages or a Onun Kodety collection.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { postType: { type: 'string', default: 'post' }, status: { type: 'string', default: 'any' }, search: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_get_content',
    description: 'Read one WordPress content item including content, excerpt and public custom fields.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_upsert_content',
    description: 'Create or update a WordPress post, page or Onun Kodety collection item.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'integer' }, postType: { type: 'string', default: 'post' }, title: { type: 'string' }, content: { type: 'string' }, excerpt: { type: 'string' }, slug: { type: 'string' }, status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private', 'future'] }, meta: { type: 'object' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_get_ai_status',
    description: 'Check whether the server-side CMS AI provider is configured and list its model and generation capabilities. Never returns the API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_generate_ai_content',
    description: 'Generate an editable CMS draft with the server-side AI provider. This tool does not save or publish anything; use kodety_upsert_content after review when requested.',
    inputSchema: {
      type: 'object', required: ['task', 'prompt'], additionalProperties: false,
      properties: {
        task: { type: 'string', enum: ['article', 'title', 'description', 'excerpt', 'seo', 'schema', 'social', 'rewrite'] },
        prompt: { type: 'string', minLength: 1, maxLength: 12000 },
        context: { type: 'string', description: 'Optional existing copy or factual context that must be respected.' },
        language: { type: 'string' },
        tone: { type: 'string' },
        postType: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'kodety_delete_content',
    description: 'Move WordPress content to trash, or permanently delete it when force is true.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, force: { type: 'boolean', default: false } }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_create_collection',
    description: 'Create a native WordPress custom post type managed as a Onun Kodety CMS collection.',
    inputSchema: {
      type: 'object', required: ['name'], additionalProperties: false,
      properties: { name: { type: 'string' }, singular: { type: 'string' }, slug: { type: 'string' }, fields: { type: 'array', items: { type: 'object' } } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_list_collections',
    description: 'List Onun Kodety CMS collections with URL slugs and their complete editable field schemas. Use before creating items or changing fields.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_update_collection_fields',
    description: 'Replace the editable field schema of a Onun Kodety CMS collection. Supports text, textarea, richtext, image, url, number, boolean, date and color fields.',
    inputSchema: {
      type: 'object', required: ['postType', 'fields'], additionalProperties: false,
      properties: {
        postType: { type: 'string' },
        fields: { type: 'array', maxItems: 80, items: { type: 'object', required: ['name', 'label', 'type'], properties: { name: { type: 'string' }, label: { type: 'string' }, type: { type: 'string', enum: ['text', 'textarea', 'richtext', 'image', 'url', 'number', 'boolean', 'date', 'color'] }, description: { type: 'string' }, required: { type: 'boolean' }, default: {}, min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, unit: { type: 'string' } }, additionalProperties: false } },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_list_media',
    description: 'List WordPress Media Library items and their public URLs.',
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'kodety_upload_media',
    description: 'Upload a base64 asset to WordPress Media; optionally also write it into a project path.',
    inputSchema: {
      type: 'object', required: ['filename', 'base64'], additionalProperties: false,
      properties: { filename: { type: 'string' }, base64: { type: 'string' }, title: { type: 'string' }, alt: { type: 'string' }, projectPath: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'kodety_publish',
    description: 'Validate the synchronized native workspace, create a release and publish it as the active Onun Kodety WordPress theme.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

const remoteNames = Object.fromEntries(tools.map((tool) => [tool.name, tool.name.replace(/^kodety_/, '')]));

async function callWordPress(name, args) {
  let lastFailure = null;
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ tool: remoteNames[name], arguments: args || {} }),
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (response.ok && body?.ok) return body.result;
    lastFailure = new Error(body?.message || body?.data?.message || `WordPress returned HTTP ${response.status}`);
    if (![404, 405].includes(response.status)) break;
  }
  throw lastFailure || new Error('WordPress MCP endpoint is unavailable.');
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.id === undefined) return;
  try {
    let result;
    if (message.method === 'initialize') {
      result = { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'kodety-wordpress', title: 'Onun Kodety WordPress OS', version: '1.0.0' }, instructions };
    } else if (message.method === 'ping') {
      result = {};
    } else if (message.method === 'tools/list') {
      result = { tools };
    } else if (message.method === 'tools/call') {
      const name = String(message.params?.name || '');
      if (!remoteNames[name]) throw new Error(`Unknown tool: ${name}`);
      const data = await callWordPress(name, message.params?.arguments || {});
      result = { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { result: data }, isError: false };
    } else {
      throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: Number(error?.code) || -32000, message: error instanceof Error ? error.message : String(error) } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)); }
    catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  }
});
