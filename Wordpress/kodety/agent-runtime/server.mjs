#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDocumentText, extractDocxText, extractLegacyDocText, validateAttachmentMagic, attachmentText } from './attachment-content.mjs';
import { KODETY_BUILDER_INSTRUCTIONS } from './builder-instructions.mjs';

const BRIDGE_VERSION = '1.0.4';
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.KODETY_AGENT_PORT || '45871', 10);
const BRIDGE_SECRET_FILE = process.env.KODETY_AGENT_SECRET_FILE || '';
const BRIDGE_SECRET = process.env.KODETY_AGENT_SECRET
  || (BRIDGE_SECRET_FILE ? readFileSync(BRIDGE_SECRET_FILE, 'utf8').trim() : '');
const DATA_DIR = path.resolve(process.env.KODETY_AGENT_DATA_DIR || path.join(process.cwd(), '.kodety-agent-runtime'));
const CODEX_BINARY = process.env.KODETY_CODEX_BINARY || 'codex';
const CODEX_PERMISSION_PROFILE = 'kodety-agent';
const CODEX_PERMISSION_CONFIG = 'permissions.kodety-agent={ filesystem = { ":minimal" = "read", ":workspace_roots" = { "." = "read" } }, network = { enabled = false } }';
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_EVENT_COUNT = 4000;
const MAX_CLIENTS_TOTAL = 64;
const MAX_CLIENTS_PER_USER = 4;
const CODEX_START_BACKOFF_MS = 30000;
const CODEX_START_STALL_MS = 90000;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_FILES = 100;
const MAX_ATTACHMENTS_PER_TURN = 6;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 2_000_000;
const MAX_ATTACHMENT_EXCERPT_CHARS = 24000;
const MAX_ATTACHMENT_TOOL_CHARS = 50000;
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_SKILL_EXTENSIONS = new Set([
  '.md', '.json', '.yaml', '.yml', '.txt', '.toml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.sh', '.bash', '.zsh', '.css', '.html', '.svg', '.csv', '.xml', '.sql', '.graphql', '.gql',
]);
const IS_MAIN_MODULE = typeof process.argv[1] === 'string'
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_MAIN_MODULE && (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535)) throw new Error('KODETY_AGENT_PORT is invalid.');
if (IS_MAIN_MODULE && Buffer.byteLength(BRIDGE_SECRET) < 32) throw new Error('KODETY_AGENT_SECRET must contain at least 32 bytes.');

const clients = new Map();

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function equalSecret(candidate) {
  const expected = Buffer.from(BRIDGE_SECRET);
  const received = Buffer.from(candidate || '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function authorized(request) {
  const header = String(request.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && equalSecret(match[1]));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function safeUserId(value) {
  const userId = String(value || '');
  if (!/^[1-9][0-9]{0,18}$/.test(userId)) throw Object.assign(new Error('Invalid user identity.'), { status: 400 });
  return userId;
}

function safeThreadId(value) {
  const threadId = String(value || '');
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(threadId)) throw Object.assign(new Error('Invalid thread id.'), { status: 400 });
  return threadId;
}

function safeAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw Object.assign(new Error(`${label} must be an absolute path.`), { status: 400 });
  }
  return path.resolve(value);
}

function redactRuntimePaths(value, runtime) {
  const roots = [runtime.cwd, runtime.codexHome, runtime.uploadRoot, runtime.attachmentRoot, ...runtime.skillRoots]
    .filter((candidate) => typeof candidate === 'string' && path.isAbsolute(candidate))
    .map((candidate) => path.resolve(candidate));
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(Object.entries(candidate).map(([key, entry]) => [key, visit(entry)]));
    }
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return candidate;
    const resolved = path.resolve(candidate);
    return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)) ? '' : candidate;
  };
  return visit(value);
}

function normalizeRuntime(userId, value) {
  const runtime = value && typeof value === 'object' ? value : {};
  const cwd = safeAbsolutePath(runtime.cwd, 'Runtime cwd');
  const codexHome = path.join(DATA_DIR, `user-${userId}`, 'codex-home');
  const packagedRoots = Array.isArray(runtime.skillRoots)
    ? runtime.skillRoots.slice(0, 12).map((entry) => safeAbsolutePath(entry, 'Skill root'))
    : [];
  const uploadRoot = path.join(DATA_DIR, `user-${userId}`, 'uploaded-skills');
  const attachmentRoot = path.join(cwd, '.attachments');
  return {
    userId,
    cwd,
    codexHome,
    uploadRoot,
    attachmentRoot,
    skillRoots: [...new Set([...packagedRoots, uploadRoot])],
    projectName: String(runtime.projectName || 'Projeto atual').slice(0, 160),
    readOnly: runtime.readOnly === true,
  };
}

function runtimeSignature(runtime) {
  return createHash('sha256').update(JSON.stringify({
    cwd: runtime.cwd,
    codexHome: runtime.codexHome,
    roots: runtime.skillRoots,
    attachmentRoot: runtime.attachmentRoot,
    projectName: runtime.projectName,
    readOnly: runtime.readOnly,
  })).digest('hex');
}

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1200);
}

function loadNativeOperationCatalog(url = new URL('./native-operations.json', import.meta.url)) {
  try {
    const catalog = JSON.parse(readFileSync(url, 'utf8'));
    if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.operations) || !catalog.operations.length
      || new Set(catalog.operations.map(operation => operation?.name)).size !== catalog.operations.length
      || catalog.operations.some(operation => !/^[a-z][a-z0-9_]*$/.test(operation?.name || '')
        || typeof operation.readOnly !== 'boolean' || typeof operation.affectsWorkspace !== 'boolean'
        || !operation.inputSchema || typeof operation.route !== 'string')) {
      throw new Error('Unsupported or incomplete native operation catalog.');
    }
    return catalog;
  } catch (cause) {
    throw Object.assign(new Error('Onun Kodety native-operations.json is missing or invalid. Reinstall the complete Onun Kodety plugin package.', { cause }), {
      code: 'KODETY_NATIVE_CATALOG_UNAVAILABLE',
    });
  }
}
const KODETY_NATIVE_CATALOG = loadNativeOperationCatalog();
const KODETY_NATIVE_DYNAMIC_TOOLS = [
  {
    type: 'function',
    name: 'kodety_native_catalog',
    description: 'Discover the same native operations available through Onun Kodety MCP, with exact argument schemas, permissions and revision requirements. Available in every workspace. Filter by area such as cms, project, localization, optimizations, ai_settings, adobe_fonts or meta_capi. Read the relevant catalog before calling an operation.',
    inputSchema: { type: 'object', properties: { area: { type: 'string', maxLength: 80 } }, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'kodety_native_call',
    description: 'Execute a discovered native operation through the same authorized APIs and validation as Onun Kodety MCP and the UI. Use for CMS collections, fields, articles, imports, configuration and integrations without navigating or clicking controls. Read the current resource revision before a mutation. Browser editor lease and share context are supplied automatically; never invent context. An interrupted mutation may already be committed: inspect the resource before a new call.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: KODETY_NATIVE_CATALOG.operations.map(operation => operation.name) },
        arguments: { type: 'object', additionalProperties: true, description: 'Arguments matching the exact inputSchema returned by kodety_native_catalog.' },
      },
      required: ['operation', 'arguments'],
      additionalProperties: false,
    },
  },
];

const KODETY_DYNAMIC_TOOLS = [
  ...KODETY_NATIVE_DYNAMIC_TOOLS,
  {
    type: 'function',
    name: 'kodety_editor_context',
    description: 'Read the live Onun Kodety editor context, including the current page, breakpoint, locale, revision, selected section or element, and multi-selection. Call this before acting on a selection.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_panel_snapshot',
    description: 'Read visible controls, tabs, fields, dialogs and live panel revision. Prefer kodety_native_catalog and kodety_native_call for semantic CMS, settings and integration operations. Use panel tools for navigation and controls without a native operation; read the panel again after navigation or changing a field.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: 240,
          description: 'Optional label or value filter for large panels. Omit to read all visible controls.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_panel_action',
    description: 'Operate one exact live control from kodety_panel_snapshot through the native Onun Kodety visual panel. It triggers the same React handlers, validation, persistence, routes, dialogs, and APIs as the human UI. Use this instead of editing source code for Settings, redirects, custom scripts, CMS, Analytics, Localization, Members, Templates, and other panel features.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'controlId', 'action'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        controlId: { type: 'string', minLength: 1, maxLength: 160 },
        action: { type: 'string', enum: ['click', 'setValue', 'toggle', 'focus'] },
        value: {
          type: 'string',
          maxLength: 4000000,
          description: 'Complete value for an input, textarea, select, or editable region. It may contain a full custom-code script when the visible panel exposes that field.',
        },
        checked: { type: 'boolean', description: 'Required target state for toggle actions.' },
        confirmDestructive: {
          type: 'boolean',
          description: 'Set true only after the user explicitly requested the matching destructive action.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_localization_snapshot',
    description: 'Read a revisioned, semantic localization catalog directly from the Onun Kodety Languages workspace. It returns configured locales, page progress, and a bounded batch of exact translation targets with source/current values. Use this for mass translation; never scrape or click translation fields one by one.',
    inputSchema: {
      type: 'object',
      properties: {
        localeCode: {
          type: 'string',
          maxLength: 80,
          description: 'Configured destination locale. Omit on the first call to list available source and destination locales.',
        },
        pagePaths: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 20,
          description: 'Optional exact authored page paths. Omit to translate the complete site in batches.',
        },
        onlyMissing: {
          type: 'boolean',
          description: 'Return only empty translation targets. Defaults to true. Set false only for an explicit review or retranslation request.',
        },
        cursor: {
          type: 'integer',
          minimum: 0,
          maximum: 1000000,
          description: 'Opaque batch offset returned as nextCursor by the previous snapshot.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 120,
          description: 'Maximum targets in this semantic batch. Defaults to 60.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_localization_settings',
    description: 'Manage configured locales atomically through the same revisioned Localization persistence path as the native Languages UI. Use it to add, update, remove, enable, set fallback/direction/URL prefix, select the default locale, or update global localization preferences. Removing a locale requires confirmRemoval true and deletes only that locale translation collection.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'action', 'summary'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        action: {
          type: 'string',
          enum: ['add', 'update', 'remove', 'setDefault', 'updatePreferences'],
        },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        localeCode: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          description: 'Configured BCP 47 locale for update, remove, or setDefault.',
        },
        locale: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 80 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            region: { type: 'string', maxLength: 12 },
            slug: { type: 'string', maxLength: 120 },
            fallback: { type: 'string', minLength: 1, maxLength: 80 },
            enabled: { type: 'boolean' },
            direction: { type: 'string', enum: ['ltr', 'rtl'] },
          },
          additionalProperties: false,
        },
        patch: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            region: { type: 'string', maxLength: 12 },
            slug: { type: 'string', maxLength: 120 },
            fallback: { type: 'string', minLength: 1, maxLength: 80 },
            enabled: { type: 'boolean' },
            direction: { type: 'string', enum: ['ltr', 'rtl'] },
          },
          additionalProperties: false,
        },
        preferences: {
          type: 'object',
          properties: {
            automaticLocale: { type: 'boolean' },
            rememberLocale: { type: 'boolean' },
            translatePagePaths: { type: 'boolean' },
            includePathsInAi: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        confirmRemoval: {
          type: 'boolean',
          description: 'Required and true only when the user explicitly requested removing this locale and its translations.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_localization_translations',
    description: 'Apply a bounded batch of translations atomically to Onun Kodety localization metadata. Echo exact target ids from kodety_localization_snapshot; the host validates live targets, locale, routes, limits, revision, and persistence. Existing non-empty translations are preserved unless overwrite is explicitly true.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'localeCode', 'summary', 'translations'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        localeCode: { type: 'string', minLength: 1, maxLength: 80 },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        overwrite: {
          type: 'boolean',
          description: 'Replace existing non-empty translations. Keep false unless the user explicitly requested review/retranslation.',
        },
        translations: {
          type: 'array',
          minItems: 1,
          maxItems: 120,
          items: {
            type: 'object',
            required: ['target', 'value'],
            properties: {
              target: {
                type: 'string',
                minLength: 1,
                maxLength: 1200,
                description: 'Exact opaque target returned by kodety_localization_snapshot.',
              },
              value: { type: 'string', minLength: 1, maxLength: 20000 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_project_snapshot',
    description: 'Read the live Onun Kodety project structure. It can return pages, project settings, CMS collection summaries, requested page sources, and requested text files such as CSS or JavaScript. Use it instead of assuming files exist on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePaths: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 20,
          description: 'Optional page paths whose complete editable source should be included.',
        },
        filePaths: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 24,
          description: 'Optional text file paths whose editable content should be included. Use the returned project.files manifest to choose exact paths.',
        },
        includeCms: { type: 'boolean', description: 'Include CMS collection and item summaries.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_code_component_snapshot',
    description: 'Read React/TSX Code Component sources, compiler diagnostics, published manifests, controls, versions, and placed instances from the live Onun Kodety project. Use this before creating, editing, inserting, or configuring a Code Component. This is distinct from native reusable HTML components.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePaths: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 24,
          description: 'Optional exact Code Component source paths whose complete TSX/JSX source should be included.',
        },
        componentIds: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 180 },
          maxItems: 24,
          description: 'Optional component ids used to filter published manifests. Omit to list all.',
        },
        includeInstances: {
          type: 'boolean',
          description: 'Include placed instance props, responsive values, CMS bindings, slots, and sizing. Defaults to true.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_motion_snapshot',
    description: 'Read native Onun Kodety Interactions v2 documents for requested pages together with the current Builder motion library. Use this before proposing or changing page motion so the result stays consistent with existing animation.',
    inputSchema: {
      type: 'object',
      properties: {
        pagePaths: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 300 },
          maxItems: 20,
          description: 'Optional authored page paths whose complete Interactions v2 documents should be returned.',
        },
        includeLibrary: { type: 'boolean', description: 'Include the Builder motion library catalog. Defaults to true.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_attachment_read',
    description: 'Read another character range from a TXT, DOC, or DOCX file attached to the current conversation turn. The attachment manifest supplies valid attachment ids and the initial excerpt; call this only when more document content is needed.',
    inputSchema: {
      type: 'object',
      required: ['attachmentId'],
      properties: {
        attachmentId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        offset: { type: 'integer', minimum: 0, maximum: MAX_ATTACHMENT_TEXT_CHARS },
        maxChars: { type: 'integer', minimum: 1000, maximum: MAX_ATTACHMENT_TOOL_CHARS },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_component_snapshot',
    description: 'Read native Onun Kodety reusable components, variants, editable variables, variant interactions, and placed instances from the live project. Call this before creating or changing a component or variant.',
    inputSchema: {
      type: 'object',
      properties: {
        componentIds: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 160 },
          maxItems: 20,
          description: 'Optional component ids to inspect. Omit to list every component.',
        },
        includeSources: { type: 'boolean', description: 'Include editable variant root HTML plus bundle paths, complete scoped CSS, and parsed dependency manifest.' },
        includeInteractions: { type: 'boolean', description: 'Include each variant Interactions v2 document.' },
        includeInstances: { type: 'boolean', description: 'Include instances placed on authored pages.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_changes',
    description: 'Apply a revision-checked change set to the live Onun Kodety project. Page changes commit atomically; CMS operations are idempotent and should be requested in small batches. Prefer replacing only the selected element or one page; use CMS operations for articles and collection content.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'summary', 'changes'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: ['replaceSelectionHtml', 'replacePageSource', 'replaceTextFile', 'upsertCmsItem', 'deleteCmsItem'],
              },
              pagePath: { type: 'string', maxLength: 300 },
              filePath: { type: 'string', maxLength: 300 },
              selectionPath: { type: 'string', maxLength: 1200 },
              html: { type: 'string', maxLength: 2000000 },
              source: { type: 'string', maxLength: 4000000 },
              text: { type: 'string', maxLength: 4000000 },
              collectionId: { type: 'string', maxLength: 200 },
              itemId: { type: ['string', 'null'], maxLength: 200 },
              values: { type: 'object' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_code_component_changes',
    description: 'Create or replace a React/TSX Code Component source, compile and register it atomically, insert an instance, or configure an existing instance. Use only after kodety_code_component_snapshot and pass its exact revision. Destructive source or instance removal requires an explicit user request and confirmDestructive.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'summary', 'changes'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        confirmDestructive: {
          type: 'boolean',
          description: 'Set true only when the user explicitly requested removal of a source or placed instance.',
        },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: ['upsertSource', 'insertInstance', 'updateInstance', 'removeInstance', 'removeSource'],
              },
              filePath: { type: 'string', minLength: 1, maxLength: 300 },
              source: { type: 'string', minLength: 1, maxLength: 4000000 },
              componentId: { type: 'string', minLength: 1, maxLength: 180 },
              componentVersion: { type: 'string', minLength: 1, maxLength: 80 },
              instanceId: { type: 'string', minLength: 1, maxLength: 180 },
              pagePath: { type: 'string', minLength: 1, maxLength: 300 },
              selectionPath: { type: 'string', maxLength: 1200 },
              placement: { type: 'string', enum: ['before', 'after', 'inside'] },
              props: { type: 'object', additionalProperties: true },
              responsiveProps: { type: 'object', additionalProperties: true },
              bindings: { type: 'object', additionalProperties: true },
              slots: { type: 'object', additionalProperties: true },
              sizing: {
                type: 'object',
                properties: {
                  width: { type: 'number', exclusiveMinimum: 0 },
                  height: { type: 'number', exclusiveMinimum: 0 },
                  widthMode: { type: 'string', enum: ['fixed', 'fill', 'hug', 'intrinsic'] },
                  heightMode: { type: 'string', enum: ['fixed', 'fill', 'hug', 'intrinsic'] },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_motion',
    description: 'Apply revision-checked native Onun Kodety Interactions v2 documents to authored pages. Use the exact revision from kodety_motion_snapshot, preserve existing interactions outside the requested scope, and use the component tool for reusable component motion.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'summary', 'changes'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['pagePath', 'interactions'],
            properties: {
              pagePath: { type: 'string', minLength: 1, maxLength: 300 },
              interactions: {
                type: 'object',
                required: ['version', 'interactions'],
                properties: {
                  version: { type: 'integer', enum: [2] },
                  interactions: { type: 'array', maxItems: 300, items: { type: 'object' } },
                },
                additionalProperties: true,
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_progress_update',
    description: 'Show or update a compact real-time task checklist above the Onun Kodety Agent composer. Use it for section implementations, requested adjustments, audits, or other work with at least three meaningful steps. Do not use it for trivial one-step answers.',
    inputSchema: {
      type: 'object',
      required: ['steps'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 80 },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['id', 'label', 'status'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 80 },
              label: { type: 'string', minLength: 1, maxLength: 160 },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_apply_component_changes',
    description: 'Apply revision-checked native Onun Kodety component changes atomically. The Builder owns each component HTML/CSS/manifest bundle and keeps project asset URLs shared instead of copying media. Use this instead of hand-editing .incode metadata or component instance attributes.',
    inputSchema: {
      type: 'object',
      required: ['expectedRevision', 'summary', 'changes'],
      properties: {
        expectedRevision: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 300 },
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: [
                  'createComponent',
                  'insertComponentInstance',
                  'upsertComponentVariant',
                  'updateComponent',
                  'updateComponentInstance',
                  'detachComponentInstance',
                  'reorderComponentVariants',
                  'deleteComponentVariant',
                  'deleteComponent',
                ],
              },
              componentId: { type: 'string', maxLength: 160 },
              componentName: { type: 'string', maxLength: 160 },
              variantId: { type: 'string', maxLength: 160 },
              variantName: { type: 'string', maxLength: 160 },
              fromVariantId: { type: 'string', maxLength: 160 },
              pagePath: { type: 'string', maxLength: 300 },
              selectionPath: { type: 'string', maxLength: 1200 },
              parentPath: { type: 'string', maxLength: 1200 },
              html: { type: 'string', maxLength: 2000000 },
              css: { type: 'string', maxLength: 4000000 },
              overrides: {
                type: 'object',
                additionalProperties: { type: 'string', maxLength: 2000000 },
              },
              variables: {
                type: 'array',
                maxItems: 100,
                items: {
                  type: 'object',
                  required: ['id', 'name', 'type', 'defaultValue', 'bindings'],
                  properties: {
                    id: { type: 'string', minLength: 1, maxLength: 160 },
                    name: { type: 'string', minLength: 1, maxLength: 160 },
                    type: {
                      type: 'string',
                      enum: ['text', 'rich_text', 'number', 'image', 'link', 'audio', 'video', 'icon', 'variant'],
                    },
                    defaultValue: { type: 'string', maxLength: 2000000 },
                    placeholder: { type: 'string', maxLength: 300 },
                    bindings: {
                      type: 'array',
                      maxItems: 100,
                      items: {
                        type: 'object',
                        required: ['targetNodeId', 'attribute'],
                        properties: {
                          targetNodeId: { type: 'string', minLength: 1, maxLength: 160 },
                          attribute: { type: 'string', maxLength: 160 },
                        },
                        additionalProperties: false,
                      },
                    },
                  },
                  additionalProperties: false,
                },
              },
              interactions: {
                type: 'object',
                required: ['version', 'interactions'],
                properties: {
                  version: { type: 'integer', enum: [2] },
                  interactions: { type: 'array', items: { type: 'object' } },
                },
                additionalProperties: false,
              },
              variantIds: {
                type: 'array',
                items: { type: 'string', minLength: 1, maxLength: 160 },
                maxItems: 100,
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'kodety_focus_element',
    description: 'Navigate the live canvas to a page and focus a section or element so the user can inspect it.',
    inputSchema: {
      type: 'object',
      required: ['pagePath'],
      properties: {
        pagePath: { type: 'string', minLength: 1, maxLength: 300 },
        selectionPath: { type: ['string', 'null'], maxLength: 1200 },
      },
      additionalProperties: false,
    },
  },
];

function threadIdFromMessage(message) {
  const params = message?.params;
  if (typeof params?.threadId === 'string') return params.threadId;
  if (typeof params?.thread?.id === 'string') return params.thread.id;
  if (typeof params?.turn?.threadId === 'string') return params.turn.threadId;
  return null;
}

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function limitText(value, maximum) {
  return String(value || '').replace(/\0/g, '').slice(0, maximum);
}

function editorSelectionReference(value) {
  const context = ensurePlainObject(value);
  const selection = ensurePlainObject(context.selection);
  const selectionPath = limitText(selection.path, 1200).trim();
  if (!selectionPath) return null;
  const project = ensurePlainObject(context.project);
  const attributes = ensurePlainObject(selection.attributes);
  const classes = Array.isArray(selection.classes)
    ? selection.classes.map((entry) => limitText(entry, 160).trim()).filter(Boolean)
    : [];
  const tag = limitText(selection.tag, 80).trim().toLowerCase();
  const id = limitText(selection.id, 300).trim();
  return {
    path: selectionPath,
    pagePath: limitText(project.mainHtmlPath, 300).trim(),
    tag,
    id,
    label: limitText(attributes['data-label'] || classes[0] || tag.toUpperCase() || 'Elemento', 200).trim(),
    interactionId: limitText(attributes['data-kodety-interaction-id'], 300).trim(),
    sectionId: limitText(attributes['data-kodety-section-id'], 300).trim(),
  };
}

function embeddedJsonText(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
  })[character]);
}

const CODEX_AGENT_MODELS = new Set([
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
]);

function safeModel(value) {
  const model = limitText(value, 120);
  if (!CODEX_AGENT_MODELS.has(model)) {
    throw Object.assign(new Error('Only Astra, Sol, Terra, Luna, and GPT-5.5 are available in Onun Kodety.'), { status: 400 });
  }
  return model;
}

function safeEffort(value) {
  const effort = String(value || 'medium');
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) {
    throw Object.assign(new Error('Invalid reasoning effort.'), { status: 400 });
  }
  return effort;
}

function safeServiceTier(value) {
  const tier = String(value || '').trim();
  if (!tier) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(tier)) {
    throw Object.assign(new Error('Invalid service tier.'), { status: 400 });
  }
  return tier;
}

function safeSkillName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) return '';
  return name;
}

function safeSkillIdentifier(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(name)) return '';
  return name;
}

function isFigmaSkillIdentifier(value) {
  const name = safeSkillIdentifier(value);
  return /^figma(?:[:_-]|$)/i.test(name) || /(?:^|:)figma-/i.test(name);
}

function officialConnectionUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const allowed = ['chatgpt.com', 'openai.com', 'figma.com'].some((domain) => (
      host === domain || host.endsWith(`.${domain}`)
    ));
    return url.protocol === 'https:' && allowed && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeAttachmentId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(id) ? id : '';
}

function safeAttachmentExtension(value) {
  const extension = String(value || '').trim().toLowerCase();
  return ['txt', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ? extension : '';
}

async function readAttachmentRecord(runtime, value) {
  const id = safeAttachmentId(value);
  if (!id) throw Object.assign(new Error('Invalid attachment id.'), { status: 400 });
  const metadataPath = path.join(runtime.attachmentRoot, `${id}.json`);
  if (!metadataPath.startsWith(`${runtime.attachmentRoot}${path.sep}`)) {
    throw Object.assign(new Error('Unsafe attachment path.'), { status: 400 });
  }
  const metadataStat = await lstat(metadataPath).catch(() => null);
  if (!metadataStat?.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 8192) {
    throw Object.assign(new Error('The attachment is unavailable or expired.'), { status: 404 });
  }
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw Object.assign(new Error('The attachment metadata is invalid.'), { status: 400 });
  }
  const extension = safeAttachmentExtension(metadata?.extension);
  const kind = ['image', 'text', 'doc', 'docx'].includes(metadata?.kind) ? metadata.kind : '';
  const name = limitText(metadata?.name, 180).trim() || `attachment.${extension}`;
  const mime = limitText(metadata?.mime, 120).trim();
  const size = Number(metadata?.size);
  const sha256 = String(metadata?.sha256 || '').toLowerCase();
  const createdAt = Number(metadata?.createdAt) * 1000;
  const expectedKind = extension === 'txt'
    ? 'text'
    : extension === 'doc'
      ? 'doc'
      : extension === 'docx'
        ? 'docx'
        : 'image';
  if (
    safeAttachmentId(metadata?.id) !== id
    || !extension
    || kind !== expectedKind
    || !Number.isInteger(size)
    || size < 1
    || size > MAX_ATTACHMENT_BYTES
    || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isFinite(createdAt)
    || Date.now() - createdAt > ATTACHMENT_TTL_MS
    || createdAt - Date.now() > 5 * 60 * 1000
  ) {
    throw Object.assign(new Error('The attachment metadata failed validation.'), { status: 400 });
  }
  const filePath = path.join(runtime.attachmentRoot, `${id}.${extension}`);
  if (!filePath.startsWith(`${runtime.attachmentRoot}${path.sep}`)) {
    throw Object.assign(new Error('Unsafe attachment file path.'), { status: 400 });
  }
  const fileStat = await lstat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink() || fileStat.size !== size) {
    throw Object.assign(new Error('The attachment file is unavailable.'), { status: 404 });
  }
  const buffer = await readFile(filePath);
  if (createHash('sha256').update(buffer).digest('hex') !== sha256) {
    throw Object.assign(new Error('The attachment contents changed after upload.'), { status: 409 });
  }
  const record = { id, name, mime, kind, extension, size, filePath, buffer };
  validateAttachmentMagic(record);
  return record;
}

async function loadTurnAttachments(runtime, values) {
  const requested = Array.isArray(values) ? values : [];
  if (requested.length > MAX_ATTACHMENTS_PER_TURN) {
    throw Object.assign(new Error(`At most ${MAX_ATTACHMENTS_PER_TURN} attachments are allowed per turn.`), { status: 400 });
  }
  const ids = [...new Set(requested.map(safeAttachmentId))];
  if (ids.length !== requested.length || ids.some((id) => !id)) {
    throw Object.assign(new Error('The attachment list is invalid.'), { status: 400 });
  }
  const manifest = [];
  const imageItems = [];
  const documentItems = [];
  for (const id of ids) {
    const record = await readAttachmentRecord(runtime, id);
    if (record.kind === 'image') {
      manifest.push({ id, name: record.name, mime: record.mime, kind: record.kind, size: record.size });
      imageItems.push({ type: 'localImage', path: record.filePath, detail: 'auto' });
      continue;
    }
    const text = attachmentText(record);
    if (!text) throw Object.assign(new Error(`No readable text was found in ${record.name}.`), { status: 400 });
    const excerpt = text.slice(0, MAX_ATTACHMENT_EXCERPT_CHARS);
    manifest.push({
      id,
      name: record.name,
      mime: record.mime,
      kind: record.kind,
      size: record.size,
      characters: text.length,
      excerptCharacters: excerpt.length,
      hasMore: excerpt.length < text.length,
    });
    documentItems.push({
      type: 'text',
      text: [
        `<KODETY_ATTACHMENT id="${id}" untrusted="true">`,
        embeddedJsonText({
          id,
          name: record.name,
          mime: record.mime,
          content: excerpt,
          totalCharacters: text.length,
          excerptEnd: excerpt.length,
          hasMore: excerpt.length < text.length,
        }),
        '</KODETY_ATTACHMENT>',
      ].join('\n'),
      text_elements: [],
    });
  }
  return { ids, manifest, imageItems, documentItems };
}

async function readAttachmentRange(runtime, id, offsetValue, maxCharsValue) {
  const record = await readAttachmentRecord(runtime, id);
  const text = attachmentText(record);
  const offset = Math.min(text.length, Math.max(0, Number.isInteger(offsetValue) ? offsetValue : 0));
  const maxChars = Math.min(
    MAX_ATTACHMENT_TOOL_CHARS,
    Math.max(1000, Number.isInteger(maxCharsValue) ? maxCharsValue : MAX_ATTACHMENT_TOOL_CHARS),
  );
  const content = text.slice(offset, offset + maxChars);
  return {
    attachmentId: record.id,
    name: record.name,
    offset,
    nextOffset: offset + content.length,
    totalCharacters: text.length,
    hasMore: offset + content.length < text.length,
    content,
  };
}

async function existingDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function frontmatterName(source, fallback) {
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(source);
  if (!match) return fallback;
  const name = /^name:\s*["']?([^\n"']+)["']?\s*$/mi.exec(match[1])?.[1]?.trim();
  return safeSkillName(name) || fallback;
}

async function discoverSkills(roots) {
  const found = new Map();
  for (const root of roots) {
    if (!(await existingDirectory(root))) continue;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(root, entry.name, 'SKILL.md');
      let source;
      try {
        source = await readFile(skillFile, 'utf8');
      } catch {
        continue;
      }
      const name = frontmatterName(source, safeSkillName(entry.name));
      if (name && !found.has(name)) found.set(name, { name, path: skillFile });
    }
  }
  return found;
}

class CodexClient {
  constructor(runtime) {
    this.runtime = runtime;
    this.signature = runtimeSignature(runtime);
    this.process = null;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.events = [];
    this.nextId = 1;
    this.nextEventId = 1;
    this.stderr = [];
    this.ownedThreadIds = new Set();
    this.threadAttachmentIds = new Map();
    this.lastUsedAt = Date.now();
    this.startupActivityAt = Date.now();
    this.startupState = 'starting';
    this.startFailure = null;
    this.failedAt = 0;
    this.stopped = false;
    this.ready = this.start().then(() => {
      if (this.startFailure) throw this.startFailure;
      this.startupState = 'ready';
    }).catch((error) => {
      this.stop(error);
      throw this.startFailure || error;
    });
    // The readiness endpoint polls without waiting on initialization. Attach
    // a rejection handler immediately while keeping ready rejectable for RPC.
    this.ready.catch(() => {});
  }

  async start() {
    const userRoot = path.dirname(this.runtime.codexHome);
    const temporaryRoot = path.join(userRoot, 'tmp');
    await mkdir(userRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.runtime.cwd, { recursive: true, mode: 0o700 });
    await mkdir(this.runtime.codexHome, { recursive: true, mode: 0o700 });
    await mkdir(this.runtime.uploadRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.runtime.attachmentRoot, { recursive: true, mode: 0o700 });
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    await Promise.all([
      chmod(userRoot, 0o700).catch(() => undefined),
      chmod(this.runtime.codexHome, 0o700).catch(() => undefined),
      chmod(this.runtime.uploadRoot, 0o700).catch(() => undefined),
      chmod(this.runtime.attachmentRoot, 0o700).catch(() => undefined),
      chmod(temporaryRoot, 0o700).catch(() => undefined),
    ]);

    const childEnvironment = { ...process.env };
    delete childEnvironment.KODETY_AGENT_SECRET;
    delete childEnvironment.KODETY_AGENT_SECRET_FILE;
    delete childEnvironment.KODETY_AGENT_PORT;
    delete childEnvironment.KODETY_AGENT_DATA_DIR;
    delete childEnvironment.KODETY_CODEX_BINARY;
    if (this.stopped) throw this.startFailure || new Error('Codex startup was cancelled.');
    const child = spawn(CODEX_BINARY, [
      'app-server',
      '-c', `default_permissions="${CODEX_PERMISSION_PROFILE}"`,
      '-c', CODEX_PERMISSION_CONFIG,
      '-c', 'features.shell_tool=false',
      '-c', 'agents.enabled=false',
      '-c', 'web_search="disabled"',
      '-c', 'tools.view_image=false',
    ], {
      cwd: this.runtime.cwd,
      env: {
        ...childEnvironment,
        HOME: userRoot,
        TMPDIR: temporaryRoot,
        CODEX_HOME: this.runtime.codexHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.startupActivityAt = Date.now();
    child.once('error', (error) => this.failAll(error));
    child.stdin.on('error', (error) => this.failAll(error));
    child.once('exit', (code, signal) => {
      const detail = this.stderr.slice(-6).join('\n');
      this.failAll(new Error(`Codex App Server stopped (${code ?? signal ?? 'unknown'}).${detail ? ` ${detail}` : ''}`));
    });
    createInterface({ input: child.stdout }).on('line', (line) => this.receive(line));
    createInterface({ input: child.stderr }).on('line', (line) => {
      this.stderr.push(limitText(line, 1000));
      if (this.stderr.length > 30) this.stderr.shift();
    });

    await this.request('initialize', {
      clientInfo: { name: 'kodety_builder', title: 'Onun Kodety Builder', version: BRIDGE_VERSION },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: true,
      },
    }, 0, true);
    this.send({ method: 'initialized' });
    const permissionProfiles = await this.request('permissionProfile/list', {
      cwd: this.runtime.cwd,
      limit: 100,
    }, 0, true);
    const profileReady = Array.isArray(permissionProfiles?.data)
      && permissionProfiles.data.some((profile) => profile?.id === CODEX_PERMISSION_PROFILE && profile?.allowed !== false);
    if (!profileReady) throw Object.assign(new Error('The restricted Onun Kodety permission profile is unavailable.'), {
      code: 'codex_permission_profile',
    });
    await this.request('skills/extraRoots/set', { extraRoots: this.runtime.skillRoots }, 0, true);
  }

  send(message) {
    if (!this.process?.stdin?.writable) throw new Error('Codex App Server is not writable.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message && Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      if (this.startupState === 'starting') this.startupActivityAt = Date.now();
      this.pending.delete(String(message.id));
      if (pending.timer) clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'Codex App Server request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (message && Object.hasOwn(message, 'id') && typeof message.method === 'string') {
      if (message.method === 'item/tool/call' && message.params?.tool === 'kodety_attachment_read') {
        void this.respondToAttachmentRead(message);
        return;
      }
      if (message.method === 'mcpServer/elicitation/request') {
        message = {
          ...message,
          params: {
            ...ensurePlainObject(message.params),
            url: officialConnectionUrl(message.params?.url),
          },
        };
      }
      const requestId = String(message.id);
      this.serverRequests.set(requestId, message);
      this.pushEvent(message, true);
      return;
    }
    if (message && typeof message.method === 'string') {
      if (message.method === 'serverRequest/resolved' && message.params?.requestId !== undefined) {
        this.serverRequests.delete(String(message.params.requestId));
      }
      this.pushEvent(message, false);
    }
  }

  async respondToAttachmentRead(message) {
    const params = ensurePlainObject(message.params);
    const args = ensurePlainObject(params.arguments);
    const threadId = typeof params.threadId === 'string' ? params.threadId : '';
    const attachmentId = safeAttachmentId(args.attachmentId);
    let result;
    try {
      if (!threadId || !attachmentId || !this.threadAttachmentIds.get(threadId)?.has(attachmentId)) {
        throw Object.assign(new Error('This attachment is not available in the current conversation.'), { status: 403 });
      }
      const output = await readAttachmentRange(this.runtime, attachmentId, args.offset, args.maxChars);
      result = {
        success: true,
        contentItems: [{ type: 'inputText', text: embeddedJsonText(output) }],
      };
    } catch (error) {
      result = {
        success: false,
        contentItems: [{ type: 'inputText', text: embeddedJsonText({ error: compactError(error) }) }],
      };
    }
    try {
      this.send({ id: message.id, result });
    } catch {
      // The App Server process is already gone; failAll handles pending turns.
    }
  }

  pushEvent(message, serverRequest) {
    this.events.push({
      cursor: this.nextEventId++,
      threadId: threadIdFromMessage(message),
      serverRequest,
      message,
      receivedAt: Date.now(),
    });
    if (this.events.length > MAX_EVENT_COUNT) this.events.splice(0, this.events.length - MAX_EVENT_COUNT);
  }

  request(method, params = {}, timeoutMs = 30000, skipReady = false) {
    const run = () => new Promise((resolve, reject) => {
      const id = `kodety-${this.nextId++}`;
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out.`));
        }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
    return skipReady ? run() : this.ready.then(run);
  }

  failAll(error) {
    if (!this.startFailure) {
      this.startFailure = error;
      this.failedAt = Date.now();
    }
    this.startupState = 'failed';
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(this.startFailure);
    }
    this.pending.clear();
    this.serverRequests.clear();
    // Keep the failed client briefly, so polling cannot spawn an unbounded
    // sequence of failing processes. Explicit retry or backoff can replace it.
  }

  stop(error = new Error('Codex App Server stopped.')) {
    this.stopped = true;
    const child = this.process;
    this.failAll(error);
    this.process = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const forceStop = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1500);
      forceStop.unref();
      child.once('exit', () => clearTimeout(forceStop));
    }
  }

  async skillItems(names) {
    const discovered = await discoverSkills(this.runtime.skillRoots);
    try {
      const response = await this.request('skills/list', {
        cwds: [this.runtime.cwd],
        forceReload: true,
        perCwdExtraUserRoots: [{ cwd: this.runtime.cwd, extraUserRoots: this.runtime.skillRoots }],
      });
      for (const entry of Array.isArray(response?.data) ? response.data : []) {
        for (const skill of Array.isArray(entry?.skills) ? entry.skills : []) {
          const name = safeSkillIdentifier(skill?.name);
          if (name && typeof skill?.path === 'string' && skill.enabled !== false) {
            discovered.set(name, { name, path: skill.path });
          }
        }
      }
    } catch {
      // The local roots above remain available on older app-server versions.
    }
    return names
      .map((name) => discovered.get(name))
      .filter(Boolean)
      .map((skill) => ({ type: 'skill', name: skill.name, path: skill.path }));
  }

  developerInstructions() {
    return [
      ...KODETY_BUILDER_INSTRUCTIONS,
      'Images attached to the turn are visual reference inputs. TXT, DOC, and DOCX attachments include a safe initial excerpt; when the manifest says hasMore and the task needs additional content, read only the necessary ranges with kodety_attachment_read.',
      'Figma capabilities come from the official Figma plugin/app installed in this Codex runtime. If its app is not connected, tell the host to show the Figma connection action instead of inventing credentials.',
      'The Figma and Onun Kodety skills may be active in the same turn: read design context through Figma, then apply the adapted result through kodety_apply_changes or kodety_apply_component_changes.',
      this.runtime.readOnly
        ? 'This Onun Kodety surface is read-only. You may inspect and explain, but you must not call either Onun Kodety apply tool.'
        : 'This Onun Kodety surface is editable through the revision-checked Onun Kodety apply tools.',
    ].join(' ');
  }

  async figmaPluginRecord() {
    const suggestions = await this.request('plugin/installed', {
      cwds: [this.runtime.cwd],
      installSuggestionPluginNames: ['figma'],
    });
    for (const marketplace of Array.isArray(suggestions?.marketplaces) ? suggestions.marketplaces : []) {
      for (const plugin of Array.isArray(marketplace?.plugins) ? marketplace.plugins : []) {
        if (String(plugin?.name || '').toLowerCase() === 'figma' || String(plugin?.id || '').toLowerCase() === 'figma') {
          return { marketplace, plugin };
        }
      }
    }
    return null;
  }

  async figmaStatus(forceRefresh = false) {
    const record = await this.figmaPluginRecord().catch(() => null);
    let detail = null;
    if (record?.plugin?.installed) {
      detail = await this.request('plugin/read', {
        ...(record.marketplace?.path
          ? { marketplacePath: record.marketplace.path }
          : { remoteMarketplaceName: record.marketplace?.name || 'openai-curated-remote' }),
        pluginName: record.plugin.name,
      }).catch(() => null);
    }
    const requiredApps = Array.isArray(detail?.plugin?.apps) ? detail.plugin.apps : [];
    const appIds = requiredApps.map((app) => String(app?.id || '')).filter(Boolean);
    const [runtimeApps, listedApps] = await Promise.all([
      this.request('app/installed', { forceRefresh }).catch(() => ({ apps: [] })),
      this.request('app/list', { limit: 100, forceRefetch: forceRefresh }).catch(() => ({ data: [] })),
    ]);
    const installed = Array.isArray(runtimeApps?.apps) ? runtimeApps.apps : [];
    const available = Array.isArray(listedApps?.data) ? listedApps.data : [];
    const figmaApps = available.filter((app) => (
      appIds.includes(String(app?.id || '')) || /figma/i.test(String(app?.name || ''))
    ));
    const app = figmaApps[0] || requiredApps[0] || null;
    const runtimeApp = installed.find((candidate) => String(candidate?.id || '') === String(app?.id || ''))
      || installed.find((candidate) => /figma/i.test(String(candidate?.runtimeName || '')))
      || null;
    const plugin = record?.plugin ? {
      id: limitText(record.plugin.id, 200),
      name: limitText(record.plugin.name, 120),
      version: record.plugin.version ?? null,
      localVersion: record.plugin.localVersion ?? null,
      installed: record.plugin.installed === true,
      enabled: record.plugin.enabled !== false,
      authPolicy: record.plugin.authPolicy ?? null,
      mustShowInstallationInterstitial: record.plugin.mustShowInstallationInterstitial === true,
      availability: record.plugin.availability ?? null,
      disabledReason: record.plugin.disabledReason ?? null,
    } : null;
    const publicApp = app ? {
      id: limitText(app.id, 200),
      name: limitText(app.name, 120),
      description: limitText(app.description, 500) || null,
      installUrl: officialConnectionUrl(app.installUrl),
      isAccessible: app.isAccessible === true,
      isEnabled: app.isEnabled !== false,
    } : null;
    const publicRuntimeApp = runtimeApp ? {
      id: limitText(runtimeApp.id, 200),
      runtimeName: limitText(runtimeApp.runtimeName, 120) || null,
      enabled: runtimeApp.enabled === true,
      callable: runtimeApp.callable === true,
    } : null;
    return {
      plugin,
      app: publicApp,
      runtimeApp: publicRuntimeApp,
      installed: record?.plugin?.installed === true,
      connected: runtimeApp?.callable === true,
      connectUrl: publicApp?.installUrl || null,
    };
  }

  rememberOwnedThreads(result) {
    const candidates = [
      ...(!Array.isArray(result?.data) ? [] : result.data),
      ...(result?.thread && typeof result.thread === 'object' ? [result.thread] : []),
    ];
    for (const thread of candidates) {
      const id = typeof thread?.id === 'string' ? thread.id : '';
      const cwd = typeof thread?.cwd === 'string' && path.isAbsolute(thread.cwd)
        ? path.resolve(thread.cwd)
        : '';
      if (id && cwd === this.runtime.cwd) this.ownedThreadIds.add(id);
    }
  }

  async assertThreadOwned(threadId) {
    if (this.ownedThreadIds.has(threadId)) return;
    let cursor = null;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.request('thread/list', {
        limit: 50,
        sortKey: 'recency_at',
        sortDirection: 'desc',
        archived: null,
        cwd: this.runtime.cwd,
        cursor,
      });
      this.rememberOwnedThreads(result);
      if (this.ownedThreadIds.has(threadId)) return;
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      if (!cursor) break;
    }
    throw Object.assign(new Error('This session belongs to a different Onun Kodety project.'), { status: 403 });
  }

  async readOwnedThread(threadId, includeTurns = false, shouldRead = true) {
    await this.assertThreadOwned(threadId);
    if (!shouldRead) return null;
    const result = await this.request('thread/read', { threadId, includeTurns });
    const thread = result?.thread && typeof result.thread === 'object' ? result.thread : result;
    const threadCwd = typeof thread?.cwd === 'string' && path.isAbsolute(thread.cwd)
      ? path.resolve(thread.cwd)
      : '';
    if (!threadCwd || threadCwd !== this.runtime.cwd) {
      throw Object.assign(new Error('This session belongs to a different Onun Kodety project.'), { status: 403 });
    }
    this.ownedThreadIds.add(threadId);
    return result;
  }

  async call(method, rawParams) {
    const params = ensurePlainObject(rawParams);
    switch (method) {
      case 'account/read':
        return this.request(method, { refreshToken: params.refreshToken === true });
      case 'account/rateLimits/read':
        return this.request('account/rateLimits/read', undefined);
      case 'account/login/start': {
        const login = await this.request(method, { type: 'chatgptDeviceCode' }, 30000);
        return {
          ...ensurePlainObject(login),
          authUrl: officialConnectionUrl(login?.authUrl),
          verificationUrl: officialConnectionUrl(login?.verificationUrl),
        };
      }
      case 'account/login/cancel':
        return this.request(method, { loginId: limitText(params.loginId, 160) });
      case 'account/logout':
        return this.request(method, undefined);
      case 'model/list': {
        const result = ensurePlainObject(await this.request(method, { limit: 100, includeHidden: false }));
        return {
          ...result,
          data: (Array.isArray(result.data) ? result.data : []).filter((value) => {
            const candidate = ensurePlainObject(value);
            return CODEX_AGENT_MODELS.has(limitText(candidate.model || candidate.id, 120));
          }),
        };
      }
      case 'skills/list':
        await this.request('skills/extraRoots/set', { extraRoots: this.runtime.skillRoots });
        return this.request(method, {
          cwds: [this.runtime.cwd],
          forceReload: params.forceReload !== false,
          perCwdExtraUserRoots: [{ cwd: this.runtime.cwd, extraUserRoots: this.runtime.skillRoots }],
        });
      case 'skills/config/write': {
        const requestedPath = safeAbsolutePath(params.path, 'Skill path');
        const allowed = this.runtime.skillRoots.some((root) => requestedPath === root || requestedPath.startsWith(`${root}${path.sep}`));
        if (!allowed) throw Object.assign(new Error('Skill path is outside the allowed roots.'), { status: 403 });
        return this.request(method, { path: requestedPath, enabled: params.enabled === true });
      }
      case 'thread/list': {
        const result = await this.request(method, {
          limit: Math.min(50, Math.max(1, Number(params.limit) || 30)),
          sortKey: 'recency_at',
          sortDirection: 'desc',
          archived: false,
          cwd: this.runtime.cwd,
        });
        this.rememberOwnedThreads(result);
        return redactRuntimePaths(result, this.runtime);
      }
      case 'thread/read': {
        const result = await this.readOwnedThread(safeThreadId(params.threadId), params.includeTurns !== false);
        return redactRuntimePaths({ ...ensurePlainObject(result), kodetyEventCursor: this.nextEventId - 1 }, this.runtime);
      }
      case 'thread/start': {
        const serviceTier = safeServiceTier(params.serviceTier);
        const result = await this.request(method, {
          model: safeModel(params.model || 'gpt-5.6-sol'),
          ...(serviceTier ? { serviceTier } : {}),
          cwd: this.runtime.cwd,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          permissions: CODEX_PERMISSION_PROFILE,
          runtimeWorkspaceRoots: [this.runtime.cwd, ...this.runtime.skillRoots],
          serviceName: 'kodety_builder',
          developerInstructions: this.developerInstructions(),
          dynamicTools: KODETY_DYNAMIC_TOOLS,
          personality: 'friendly',
          ephemeral: false,
          threadSource: 'kodetyBuilder',
        });
        this.rememberOwnedThreads(result);
        return redactRuntimePaths({ ...ensurePlainObject(result), kodetyEventCursor: this.nextEventId - 1 }, this.runtime);
      }
      case 'thread/resume': {
        const threadId = safeThreadId(params.threadId);
        const serviceTier = safeServiceTier(params.serviceTier);
        await this.readOwnedThread(threadId, false, false);
        const result = await this.request(method, {
          threadId,
          model: params.model ? safeModel(params.model) : null,
          ...(serviceTier ? { serviceTier } : {}),
          cwd: this.runtime.cwd,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          permissions: CODEX_PERMISSION_PROFILE,
          runtimeWorkspaceRoots: [this.runtime.cwd, ...this.runtime.skillRoots],
          developerInstructions: this.developerInstructions(),
          personality: 'friendly',
        });
        this.rememberOwnedThreads(result);
        return redactRuntimePaths(result, this.runtime);
      }
      case 'thread/name/set': {
        const threadId = safeThreadId(params.threadId);
        await this.readOwnedThread(threadId, false, false);
        return this.request(method, {
          threadId,
          name: limitText(params.name, 120).trim() || 'Nova sessão',
        });
      }
      case 'thread/archive': {
        const threadId = safeThreadId(params.threadId);
        await this.readOwnedThread(threadId, false, false);
        this.threadAttachmentIds.delete(threadId);
        return this.request(method, { threadId });
      }
      case 'turn/interrupt': {
        const threadId = safeThreadId(params.threadId);
        await this.readOwnedThread(threadId, false, false);
        return this.request(method, { threadId, turnId: limitText(params.turnId, 160) });
      }
      case 'turn/start': {
        const threadId = safeThreadId(params.threadId);
        const serviceTier = safeServiceTier(params.serviceTier);
        await this.readOwnedThread(threadId, false, false);
        const attachments = await loadTurnAttachments(this.runtime, params.attachments);
        const prompt = limitText(params.prompt, 24000).trim()
          || (attachments.ids.length ? 'Analise os anexos enviados e use-os como referência para esta tarefa.' : '');
        if (!prompt) throw Object.assign(new Error('A message or attachment is required.'), { status: 400 });
        const boundAttachments = new Set(this.threadAttachmentIds.get(threadId) || []);
        for (const attachmentId of attachments.ids) boundAttachments.add(attachmentId);
        this.threadAttachmentIds.set(threadId, boundAttachments);
        const context = ensurePlainObject(params.context);
        const contextText = limitText(JSON.stringify(context), 24000);
        const selectionReference = editorSelectionReference(context);
        const requestedSkills = Array.isArray(params.skills)
          ? [...new Set(params.skills.map(safeSkillIdentifier).filter(Boolean))].slice(0, 16)
          : [];
        const skillItems = await this.skillItems(requestedSkills);
        const appItems = [];
        if (requestedSkills.some(isFigmaSkillIdentifier)) {
          const figma = await this.figmaStatus(false).catch(() => null);
          if (figma?.connected && typeof figma?.app?.id === 'string') {
            appItems.push({
              type: 'mention',
              name: limitText(figma.app.name || 'Figma', 120),
              path: `app://${limitText(figma.app.id, 200)}`,
            });
          }
        }
        const markers = [
          ...skillItems.map((skill) => `$${skill.name}`),
          ...appItems.map(() => '$figma'),
        ].join(' ');
        const text = [
          markers,
          prompt,
          ...(attachments.manifest.length ? [
            '<KODETY_ATTACHMENTS_MANIFEST untrusted="true">',
            embeddedJsonText(attachments.manifest),
            '</KODETY_ATTACHMENTS_MANIFEST>',
          ] : []),
          ...(selectionReference ? [
            '<KODETY_SELECTION_REFERENCE untrusted="true">',
            embeddedJsonText(selectionReference),
            '</KODETY_SELECTION_REFERENCE>',
          ] : []),
          '<KODETY_EDITOR_CONTEXT untrusted="true">',
          contextText,
          '</KODETY_EDITOR_CONTEXT>',
        ].filter(Boolean).join('\n\n');
        return this.request(method, {
          threadId,
          input: [
            { type: 'text', text, text_elements: [] },
            ...attachments.imageItems,
            ...attachments.documentItems,
            ...skillItems,
            ...appItems,
          ],
          cwd: this.runtime.cwd,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          permissions: CODEX_PERMISSION_PROFILE,
          runtimeWorkspaceRoots: [this.runtime.cwd, ...this.runtime.skillRoots],
          model: safeModel(params.model || 'gpt-5.6-sol'),
          effort: safeEffort(params.effort),
          ...(serviceTier ? { serviceTier } : {}),
          summary: 'concise',
          personality: 'friendly',
        });
      }
      case 'figma/status':
        return this.figmaStatus(params.forceRefresh === true);
      case 'figma/install': {
        const current = await this.figmaPluginRecord();
        if (current?.plugin?.installed) return this.figmaStatus(true);
        if (current?.plugin?.mustShowInstallationInterstitial === true && params.confirmed !== true) {
          throw Object.assign(new Error('Confirm the official Figma plugin installation in the Onun Kodety UI first.'), { status: 409 });
        }
        const rawInstall = await this.request('plugin/install', {
          ...(current?.marketplace?.path
            ? { marketplacePath: current.marketplace.path }
            : { remoteMarketplaceName: current?.marketplace?.name || 'openai-curated-remote' }),
          pluginName: current?.plugin?.name || 'figma',
        }, 120000);
        const install = {
          authPolicy: rawInstall?.authPolicy ?? null,
          appsNeedingAuth: (Array.isArray(rawInstall?.appsNeedingAuth) ? rawInstall.appsNeedingAuth : []).map((app) => ({
            id: limitText(app?.id, 200),
            name: limitText(app?.name, 120),
            description: limitText(app?.description, 500),
            installUrl: officialConnectionUrl(app?.installUrl),
            category: limitText(app?.category, 120) || null,
          })),
        };
        const status = await this.figmaStatus(true).catch(() => null);
        return { install, status };
      }
      case 'app/list': {
        const threadId = params.threadId ? safeThreadId(params.threadId) : null;
        if (threadId) await this.readOwnedThread(threadId, false, false);
        return this.request(method, {
          cursor: typeof params.cursor === 'string' ? params.cursor : null,
          limit: Math.min(100, Math.max(1, Number(params.limit) || 50)),
          threadId,
          forceRefetch: params.forceRefetch === true,
        });
      }
      case 'app/read':
        return this.request(method, {
          appIds: Array.isArray(params.appIds)
            ? [...new Set(params.appIds.map((id) => limitText(id, 200)).filter(Boolean))].slice(0, 100)
            : [],
          includeTools: params.includeTools === true,
        });
      case 'app/installed': {
        const threadId = params.threadId ? safeThreadId(params.threadId) : null;
        if (threadId) await this.readOwnedThread(threadId, false, false);
        return this.request(method, {
          threadId,
          forceRefresh: params.forceRefresh === true,
        });
      }
      default:
        throw Object.assign(new Error('This App Server method is not exposed by the Onun Kodety bridge.'), { status: 403 });
    }
  }

  eventsSince(threadId, cursor) {
    const normalizedCursor = Math.max(0, Number(cursor) || 0);
    const events = this.events.filter((event) => (
      event.cursor > normalizedCursor && (event.threadId === threadId || event.threadId === null)
    )).map((event) => ({ ...event, message: redactRuntimePaths(event.message, this.runtime) }));
    const pending = [...this.serverRequests.entries()]
      .filter(([, request]) => threadIdFromMessage(request) === threadId)
      .map(([requestId, request]) => ({ requestId, method: request.method, params: request.params }));
    return {
      events,
      pending,
      nextCursor: events.length ? events.at(-1).cursor : normalizedCursor,
    };
  }

  normalizeServerResponse(request, rawResult) {
    const result = ensurePlainObject(rawResult);
    if (request.method === 'item/commandExecution/requestApproval' || request.method === 'item/fileChange/requestApproval') {
      // Filesystem and command execution are outside the Builder contract.
      // The Agent edits through kodety_* dynamic tools only, so the browser can
      // never approve a host-side command or patch even if App Server asks.
      return { decision: 'decline' };
    }
    if (request.method === 'item/tool/requestUserInput') {
      const answers = ensurePlainObject(result.answers);
      return { answers: Object.fromEntries(Object.entries(answers).slice(0, 20).map(([key, answer]) => [
        limitText(key, 120),
        { answers: Array.isArray(answer?.answers) ? answer.answers.slice(0, 10).map((value) => limitText(value, 1000)) : [] },
      ])) };
    }
    if (request.method === 'mcpServer/elicitation/request') {
      const action = ['accept', 'decline', 'cancel'].includes(result.action) ? result.action : 'decline';
      return { action, content: action === 'accept' ? ensurePlainObject(result.content) : null };
    }
    if (request.method === 'item/permissions/requestApproval') {
      // The browser is never allowed to widen the sidecar's filesystem or
      // network profile. Returning an empty turn-scoped grant safely declines
      // the escalation while keeping the App Server protocol satisfied.
      return { permissions: {}, scope: 'turn', strictAutoReview: true };
    }
    if (request.method === 'item/tool/call') {
      const success = result.success !== false;
      const contentItems = Array.isArray(result.contentItems)
        ? result.contentItems.slice(0, 20).map((item) => {
          if (item?.type === 'inputImage' && typeof item.imageUrl === 'string') {
            return { type: 'inputImage', imageUrl: limitText(item.imageUrl, 5000000) };
          }
          return { type: 'inputText', text: limitText(item?.text, 4000000) };
        })
        : [{ type: 'inputText', text: limitText(JSON.stringify(result.output ?? result), 4000000) }];
      return { contentItems, success };
    }
    throw Object.assign(new Error('Unsupported App Server request.'), { status: 409 });
  }

  respond(requestId, rawResult) {
    const request = this.serverRequests.get(String(requestId));
    if (!request) throw Object.assign(new Error('The approval request is no longer pending.'), { status: 409 });
    const result = this.normalizeServerResponse(request, rawResult);
    this.send({ id: request.id, result });
    this.serverRequests.delete(String(requestId));
    return { ok: true };
  }
}

async function clientFor(userId, runtimeValue, { waitUntilReady = true, retry = false } = {}) {
  const runtime = normalizeRuntime(userId, runtimeValue);
  const signature = runtimeSignature(runtime);
  const key = `${userId}:${signature}`;
  let client = clients.get(key);
  const stalled = client?.startupState === 'starting'
    && Date.now() - client.startupActivityAt >= CODEX_START_STALL_MS;
  if (
    (client?.startupState === 'failed' && (retry || Date.now() - client.failedAt >= CODEX_START_BACKOFF_MS))
    || (client && stalled && retry)
  ) {
    clients.delete(key);
    client.stop();
    client = null;
  }
  if (!client) {
    const stopOldest = (entries) => {
      const oldest = entries.sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (!oldest) return;
      clients.delete(oldest[0]);
      oldest[1].stop();
    };
    const sameUser = [...clients.entries()].filter(([, candidate]) => candidate.runtime.userId === userId);
    if (sameUser.length >= MAX_CLIENTS_PER_USER) stopOldest(sameUser);
    if (clients.size >= MAX_CLIENTS_TOTAL) stopOldest([...clients.entries()]);
    client = new CodexClient(runtime);
    clients.set(key, client);
  }
  client.lastUsedAt = Date.now();
  if (waitUntilReady) {
    await client.ready;
    if (client.startFailure) throw client.startFailure;
  }
  return client;
}

function codexReadiness(client) {
  const stalled = client.startupState === 'starting'
    && Date.now() - client.startupActivityAt >= CODEX_START_STALL_MS;
  const error = client.startFailure;
  const detail = String(error?.message || '');
  const code = error?.code === 'codex_permission_profile' || /permissionProfile|permission profile/i.test(detail)
    ? 'codex_permission_profile'
    : ['ENOENT', 'EACCES', 'ENOEXEC'].includes(error?.code)
      ? 'codex_exec_failed'
      : 'codex_start_failed';
  return {
    ok: client.startupState === 'ready',
    version: BRIDGE_VERSION,
    state: stalled ? 'stalled' : client.startupState,
    ...(stalled ? { code: 'codex_start_stalled' } : {}),
    ...(client.startupState === 'failed' ? { code } : {}),
  };
}

function safeSkillRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.length > 220 || normalized.startsWith('/') || normalized.includes('\0')) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  const extension = path.extname(normalized).toLowerCase();
  if (!ALLOWED_SKILL_EXTENSIONS.has(extension)) return '';
  return segments.join('/');
}

async function installSkill(userId, runtimeValue, body) {
  const runtime = normalizeRuntime(userId, runtimeValue);
  const name = safeSkillName(body.name);
  if (!name || ['figma', 'kodety-site-code', 'kodety-editor', 'kodety-widgets', 'kodety-motion', 'kodety-performance', 'kodety-languages'].includes(name)) {
    throw Object.assign(new Error('Use a unique skill name.'), { status: 400 });
  }
  const files = Array.isArray(body.files) ? body.files.slice(0, MAX_SKILL_FILES + 1) : [];
  if (!files.length || files.length > MAX_SKILL_FILES) throw Object.assign(new Error('The skill has an invalid file count.'), { status: 400 });
  const decoded = [];
  let totalBytes = 0;
  for (const file of files) {
    const relativePath = safeSkillRelativePath(file.path);
    if (!relativePath) throw Object.assign(new Error('The skill contains an unsafe file path or type.'), { status: 400 });
    let content;
    try {
      content = Buffer.from(String(file.contentBase64 || ''), 'base64');
    } catch {
      throw Object.assign(new Error('The skill contains invalid base64 data.'), { status: 400 });
    }
    totalBytes += content.length;
    if (totalBytes > MAX_SKILL_BYTES || content.includes(0)) throw Object.assign(new Error('The skill is too large or contains binary data.'), { status: 400 });
    decoded.push({ relativePath, content });
  }
  if (!decoded.some((file) => file.relativePath === 'SKILL.md')) {
    throw Object.assign(new Error('A skill must contain SKILL.md at its root.'), { status: 400 });
  }

  await mkdir(runtime.uploadRoot, { recursive: true, mode: 0o700 });
  const temporary = path.join(runtime.uploadRoot, `.install-${name}-${Date.now()}-${process.pid}`);
  const target = path.join(runtime.uploadRoot, name);
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    for (const file of decoded) {
      const destination = path.join(temporary, file.relativePath);
      if (!destination.startsWith(`${temporary}${path.sep}`)) throw new Error('Unsafe skill destination.');
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, { mode: 0o600 });
    }
    const source = await readFile(path.join(temporary, 'SKILL.md'), 'utf8');
    if (frontmatterName(source, name) !== name) {
      throw Object.assign(new Error('The uploaded folder name must match the skill frontmatter name.'), { status: 400 });
    }
    await rm(target, { recursive: true, force: true });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const sameUserClients = [...clients.values()].filter((client) => client.runtime.userId === userId);
  await Promise.allSettled(sameUserClients.map((client) => (
    client.request('skills/extraRoots/set', { extraRoots: client.runtime.skillRoots })
  )));
  return { ok: true, name, path: target, bytes: totalBytes, fileCount: decoded.length };
}

async function deleteSkill(userId, runtimeValue, body) {
  const runtime = normalizeRuntime(userId, runtimeValue);
  const name = safeSkillName(body.name);
  if (!name || ['figma', 'kodety-site-code', 'kodety-editor', 'kodety-widgets', 'kodety-motion', 'kodety-performance', 'kodety-languages'].includes(name)) {
    throw Object.assign(new Error('This bundled skill cannot be removed.'), { status: 400 });
  }
  const target = path.join(runtime.uploadRoot, name);
  if (!target.startsWith(`${runtime.uploadRoot}${path.sep}`)) throw Object.assign(new Error('Unsafe skill path.'), { status: 400 });
  await rm(target, { recursive: true, force: true });
  const sameUserClients = [...clients.values()].filter((client) => client.runtime.userId === userId);
  await Promise.allSettled(sameUserClients.map((client) => (
    client.request('skills/extraRoots/set', { extraRoots: client.runtime.skillRoots })
  )));
  return { ok: true, name };
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { error: 'Unauthorized.' });
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, { ok: true, version: BRIDGE_VERSION, clients: clients.size });
    }
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    const body = await readJson(request);
    const userId = safeUserId(body.userId);
    if (url.pathname === '/ready') {
      const client = await clientFor(userId, body.runtime, { waitUntilReady: false, retry: body.retry === true });
      return json(response, 200, codexReadiness(client));
    }
    if (url.pathname === '/rpc') {
      const client = await clientFor(userId, body.runtime);
      const result = await client.call(String(body.method || ''), body.params);
      return json(response, 200, { result });
    }
    if (url.pathname === '/events') {
      const client = await clientFor(userId, body.runtime);
      return json(response, 200, client.eventsSince(safeThreadId(body.threadId), body.cursor));
    }
    if (url.pathname === '/respond') {
      const client = await clientFor(userId, body.runtime);
      return json(response, 200, client.respond(limitText(body.requestId, 180), body.result));
    }
    if (url.pathname === '/skills/install') {
      return json(response, 201, await installSkill(userId, body.runtime, body));
    }
    if (url.pathname === '/skills/delete') {
      return json(response, 200, await deleteSkill(userId, body.runtime, body));
    }
    return json(response, 404, { error: 'Not found.' });
  } catch (error) {
    return json(response, Number(error?.status) || 500, { error: compactError(error) });
  }
});

if (IS_MAIN_MODULE) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await chmod(DATA_DIR, 0o700).catch(() => undefined);
  server.listen(PORT, HOST, () => {
    process.stdout.write(`Onun Kodety Agent Bridge ${BRIDGE_VERSION} listening on ${HOST}:${PORT}\n`);
  });
}

function shutdown() {
  for (const client of clients.values()) client.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

if (IS_MAIN_MODULE) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export {
  CodexClient,
  clientFor,
  codexReadiness,
  extractDocxText,
  extractLegacyDocText,
  loadTurnAttachments,
  loadNativeOperationCatalog,
  normalizeDocumentText,
  KODETY_NATIVE_DYNAMIC_TOOLS,
  readAttachmentRange,
  redactRuntimePaths,
};
