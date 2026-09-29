'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { toast } from 'sonner';
import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  LogIn,
  MousePointer2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { OPEN_HTML_AGENT_PANEL_EVENT, type OpenHtmlAgentPanelDetail } from '@/lib/html-editor/agent-panel-events';
import { AGENT_NATIVE_CHANGED_EVENT } from '@/lib/html-editor/agent-native-events';
import {
  agentSkillDisplayName,
  buildAgentComposerPrompt,
  DEFAULT_AGENT_SKILL_NAMES,
  FIGMA_DESIGN_LINK_ERROR,
  isFigmaDesignToCodeSkill,
  parseFigmaDesignLink,
  restoreAgentSkillSelection,
} from '@/lib/html-editor/agent-composer';
import { wordpressConfig } from '@/lib/html-editor/editor-wordpress-helpers';
import { AgentTransport } from '@/lib/html-editor/agent-transport';
import type { AgentBackend, AgentBackendCallbacks, AgentBackendCapabilities } from '@/lib/html-editor/agent-backend';
import { useHtmlWorkspaceAgentHost } from '@/lib/html-editor/agent-host';
import { agentBrowserNotice } from '@/lib/html-editor/agent-browser-support';
import { HtmlAgentBrowserNotice } from './HtmlAgentBrowserNotice';
import { observeAgentAccount, subscribeAgentAccountChanged } from '@/lib/html-editor/agent-account-sync';
import {
  agentRuntimeFailure,
  agentRuntimeUnavailable,
  isAgentSetupAborted,
  prepareAgentRuntime,
  type AgentRuntimeDiagnostic,
  type AgentRuntimeProgress,
} from '@/lib/html-editor/agent-runtime-setup';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import composerStyles from './HtmlAgentComposer.module.css';
import { HtmlAgentFigmaReference } from './HtmlAgentFigmaReference';
import { HtmlAgentRuntimeStatus, isAgentRuntimeHostBlocked } from './HtmlAgentRuntimeStatus';
import { invokeHtmlAgentEditorTool, useHtmlAgentEditorBridgeStore, type HtmlAgentToolCallMeta } from '@/stores/useHtmlAgentEditorBridgeStore';

type InspectorMode = 'human' | 'agent';

interface AgentAccount {
  type?: string;
  email?: string | null;
  planType?: string;
}

interface AgentRateLimitWindow {
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

interface AgentRateLimitSnapshot {
  key: string;
  limitName: string;
  rateLimitReachedType: string;
  spendControlReached: boolean;
  primary: AgentRateLimitWindow | null;
  secondary: AgentRateLimitWindow | null;
}

interface AgentLaunchRequest {
  prompt: string;
  skills: string[];
}

interface AgentModel {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
  defaultReasoningEffort?: string;
  defaultServiceTier?: string | null;
  serviceTiers?: Array<{
    id?: string;
    name?: string;
    description?: string;
  }>;
}

interface AgentSkill {
  name: string;
  description?: string;
  shortDescription?: string | null;
  enabled?: boolean;
  path?: string;
  interface?: {
    displayName?: string;
    shortDescription?: string;
  } | null;
}

interface AgentThread {
  id: string;
  name?: string | null;
  preview?: string;
  updatedAt?: number;
  turns?: unknown[];
}

interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  target?: AgentElementReference;
  attachments?: AgentAttachment[];
}

type AgentAttachmentKind = 'image' | 'text' | 'doc' | 'docx';

interface AgentAttachment {
  id: string;
  name: string;
  mime: string;
  kind: AgentAttachmentKind;
  size: number;
  previewUrl?: string;
}

interface AgentElementReference {
  path: string;
  pagePath: string;
  tag: string;
  id: string;
  label: string;
  interactionId: string;
  sectionId: string;
  identifier: string;
}

interface AgentEventEnvelope {
  cursor?: number;
  message?: unknown;
}

interface AgentPendingRequest {
  requestId?: string;
  method?: string;
  params?: unknown;
}

interface AgentPromptRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

interface AgentToolApprovalRequest {
  requestId: string;
  pending: AgentPendingRequest;
  changeTypes: string[];
  summary: string;
}

type AgentProgressStatus = 'pending' | 'in_progress' | 'completed';

interface AgentProgressStep {
  id: string;
  label: string;
  status: AgentProgressStatus;
}

interface AgentProgress {
  title: string;
  steps: AgentProgressStep[];
}

interface FigmaStatus {
  installed: boolean;
  connected: boolean;
  connectUrl: string | null;
  plugin?: Record<string, unknown> | null;
  app?: Record<string, unknown> | null;
  runtimeApp?: Record<string, unknown> | null;
}

interface ToolResponseCacheEntry {
  result: {
    success: boolean;
    contentItems: Array<{ type: 'inputText'; text: string }>;
  };
  responding: boolean;
}

interface AgentHttpError extends Error {
  status?: number;
  code?: string;
  payload?: unknown;
  outcomeUnknown?: boolean;
}

const DEFAULT_MODEL = 'gpt-5.6-sol';
const CODEX_MODEL_CATALOG: AgentModel[] = [
  {
    id: 'gpt-6-astra',
    model: 'gpt-6-astra',
    displayName: 'Astra',
    description: 'Modelo avançado para tarefas complexas de código e uso de ferramentas.',
  },
  {
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'Sol',
    description: 'Capacidade máxima para mudanças complexas e tarefas longas.',
    isDefault: true,
  },
  {
    id: 'gpt-5.6-terra',
    model: 'gpt-5.6-terra',
    displayName: 'Terra',
    description: 'Equilíbrio entre qualidade, velocidade e uso de ferramentas.',
  },
  {
    id: 'gpt-5.6-luna',
    model: 'gpt-5.6-luna',
    displayName: 'Luna',
    description: 'Resposta rápida para edições diretas e iterações curtas.',
  },
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Modelo GPT-5.5 para trabalhos complexos, código e uso de ferramentas.',
    supportedReasoningEfforts: [
      { reasoningEffort: 'none' },
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      { reasoningEffort: 'xhigh' },
    ],
    defaultReasoningEffort: 'medium',
  },
];
const CODEX_MODEL_IDS = new Set(CODEX_MODEL_CATALOG.map(candidate => candidate.model));
const AGENT_PREVIEW_SKILLS: AgentSkill[] = [
  {
    name: 'figma:figma-design-to-code',
    description: 'Transforme seleções do Figma em código usando o contexto oficial do design.',
    interface: {
      displayName: 'Figma Design to Code',
      shortDescription: 'Design do Figma para código',
    },
  },
  {
    name: 'kodety-editor',
    description: 'Edite o projeto aberto usando as capacidades nativas do Kodety.',
    interface: {
      displayName: 'kodety-editor',
      shortDescription: 'Edição nativa do projeto aberto',
    },
  },
  {
    name: 'kodety-widgets',
    description: 'Crie, compile, insira e configure Code Components React no Builder.',
    interface: {
      displayName: 'Kodety Widgets',
      shortDescription: 'Code Components React completos no Builder',
    },
  },
  {
    name: 'kodety-motion',
    description: 'Crie motion nativo, expressivo e consistente no Builder.',
    interface: {
      displayName: 'Kodety Motion',
      shortDescription: 'Motion nativo e consistente no Builder',
    },
  },
  {
    name: 'kodety-performance',
    description: 'Analise e otimize desempenho, carregamento e Core Web Vitals.',
    interface: {
      displayName: 'Kodety Performance',
      shortDescription: 'Performance e carregamento no Builder',
    },
  },
  {
    name: 'kodety-languages',
    description: 'Traduza sites, páginas, SEO e rotas em massa no painel de idiomas.',
    interface: {
      displayName: 'Kodety Languages',
      shortDescription: 'Tradução em massa no painel de idiomas',
    },
  },
];
const AGENT_PREVIEW_SKILL_NAMES = new Set(AGENT_PREVIEW_SKILLS.map(skill => skill.name));
const DEFAULT_EFFORT = 'medium';
const AGENT_MODEL_PREFERENCE = 'kodety:agent:model';
const AGENT_EFFORT_PREFERENCE = 'kodety:agent:effort';
const AGENT_SERVICE_TIER_PREFERENCE = 'kodety:agent:service-tier';
const AGENT_SKILLS_PREFERENCE = 'kodety:agent:skills:v2';
const LEGACY_AGENT_SKILLS_PREFERENCE = 'kodety:agent:skills';
const MAX_AGENT_ATTACHMENTS = 6;
const MAX_AGENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const AGENT_ATTACHMENT_ACCEPT = '.txt,.doc,.docx,image/png,image/jpeg,image/webp,image/gif';
const AGENT_ATTACHMENT_TITLE = 'Anexar TXT, DOC, DOCX ou imagem';
const AGENT_MUTATING_TOOLS = new Set([
  'kodety_apply_changes',
  'kodety_apply_component_changes',
  'kodety_apply_code_component_changes',
  'kodety_apply_motion',
  'kodety_apply_localization_settings',
  'kodety_apply_localization_translations',
  'kodety_panel_action',
]);
const EFFORT_LABELS: Record<string, string> = {
  none: 'Nenhum',
  minimal: 'Mínimo',
  low: 'Leve',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo',
  ultra: 'Ultra',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : null;
}

function normalizedRateLimitWindow(value: unknown): AgentRateLimitWindow | null {
  const candidate = record(value);
  const usedPercent = finiteNumber(candidate.usedPercent);
  if (usedPercent === null) return null;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: finiteNumber(candidate.resetsAt),
    windowDurationMins: finiteNumber(candidate.windowDurationMins),
  };
}

function normalizedRateLimitSnapshots(value: unknown): AgentRateLimitSnapshot[] {
  const response = record(value);
  const buckets = Object.entries(record(response.rateLimitsByLimitId));
  const normalizeSources = (sources: Array<readonly [string, unknown]>) =>
    sources.flatMap(([key, rawSnapshot]) => {
    const snapshot = record(rawSnapshot);
    if (!Object.keys(snapshot).length) return [];
      return [
        {
      key,
      limitName: string(snapshot.limitName) || string(snapshot.limitId) || key,
      rateLimitReachedType: string(snapshot.rateLimitReachedType),
      spendControlReached: snapshot.spendControlReached === true,
      primary: normalizedRateLimitWindow(snapshot.primary),
      secondary: normalizedRateLimitWindow(snapshot.secondary),
        },
      ];
  });
  const bucketSnapshots = normalizeSources(buckets);
  if (bucketSnapshots.some(snapshot => snapshot.primary || snapshot.secondary)) return bucketSnapshots;
  return normalizeSources([['codex', response.rateLimits]]);
}

function rateLimitSnapshotReached(snapshot: AgentRateLimitSnapshot) {
  return Boolean(snapshot.rateLimitReachedType) || snapshot.spendControlReached;
}

function rateLimitWindowLabel(window: AgentRateLimitWindow) {
  const minutes = window.windowDurationMins;
  if (minutes === 24 * 60) return 'Limite diário';
  if (minutes === 7 * 24 * 60) return 'Limite semanal';
  if (minutes !== null && minutes > 0 && minutes % (24 * 60) === 0) {
    return `Limite de ${minutes / (24 * 60)} dias`;
  }
  if (minutes !== null && minutes > 0 && minutes % 60 === 0) return `Limite de ${minutes / 60} horas`;
  if (minutes !== null && minutes > 0) return `Limite de ${minutes} minutos`;
  return 'Janela informada pela conta';
}

function rateLimitResetLabel(resetsAt: number | null) {
  if (resetsAt === null) return 'Horário de reset não informado';
  return `Redefine em ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(resetsAt * 1000))}`;
}

function rateLimitUsageLabel(window: AgentRateLimitWindow) {
  const label = rateLimitWindowLabel(window).replace(/^Limite (?:de )?/i, '');
  return label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1);
}

function rateLimitCompactResetLabel(resetsAt: number | null) {
  if (resetsAt === null) return 'Reset não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(resetsAt * 1000));
}

function isUsageLimitError(value: unknown) {
  const error = record(value);
  return error.codexErrorInfo === 'usageLimitExceeded';
}

function readPreference(key: string, fallback = '') {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are optional in private/restricted browser contexts.
  }
}

function isCodexModel(value: string) {
  return CODEX_MODEL_IDS.has(value);
}

function codexModelLabel(value: string) {
  return CODEX_MODEL_CATALOG.find(candidate => candidate.model === value || candidate.id === value)?.displayName || 'Sol';
}

function effortLabel(value: string) {
  return EFFORT_LABELS[value] || value;
}

function codexModelsFromRuntime(values: AgentModel[]) {
  return CODEX_MODEL_CATALOG.map(fallback => {
    const runtime = values.find(candidate => candidate.model === fallback.model || candidate.id === fallback.id);
    return runtime
      ? {
          ...runtime,
          id: fallback.id,
          model: fallback.model,
          displayName: fallback.displayName,
          isDefault: fallback.isDefault === true,
        }
      : fallback;
  });
}

const THINKING_ORB_CELLS = Array.from({ length: 9 }, (_, index) => {
  const x = index % 3;
  const y = Math.floor(index / 3);
  return {
    key: `${x}-${y}`,
    left: x * 6,
    top: y * 6,
    delay: ((x + y) / 4) * 1500,
    middle: x === 1 && y === 1,
  };
});

function HtmlAgentThinkingOrb() {
  return (
    <span className={composerStyles.thinkingOrb} role="status" aria-live="polite">
      <span className={composerStyles.thinkingGlyph} aria-hidden="true">
        <span className={composerStyles.thinkingLattice}>
          {THINKING_ORB_CELLS.map(cell => (
            <span
              key={cell.key}
              className={composerStyles.thinkingCell}
              data-middle={cell.middle || undefined}
              style={{
                left: cell.left,
                top: cell.top,
                animationDelay: `${cell.delay}ms`,
              }}
            />
          ))}
        </span>
      </span>
      <span className={composerStyles.thinkingLabel}>Pensando</span>
    </span>
  );
}

function normalizedAgentProgress(value: unknown): AgentProgress | null {
  const candidate = record(value);
  const steps = array(candidate.steps)
    .map(stepValue => {
      const step = record(stepValue);
      const status = string(step.status) as AgentProgressStatus;
      const id = string(step.id).trim().slice(0, 80);
      const label = string(step.label).trim().slice(0, 160);
      if (!id || !label || !['pending', 'in_progress', 'completed'].includes(status)) return null;
      return { id, label, status };
    })
    .filter((step): step is AgentProgressStep => step !== null)
    .slice(0, 8);
  if (!steps.length) return null;
  return {
    title: string(candidate.title).trim().slice(0, 80) || 'To-dos',
    steps,
  };
}

function HtmlAgentProgress({ progress }: { progress: AgentProgress }) {
  const completed = progress.steps.filter(step => step.status === 'completed').length;
  return (
    <div
      className={composerStyles.progressCard}
      role="status"
      aria-live="polite"
      aria-label={`${progress.title}: ${completed} de ${progress.steps.length}`}
    >
      <div className={composerStyles.progressHeader}>
        <span className={composerStyles.progressHeaderMark} aria-hidden="true" />
        <span className={composerStyles.progressTitle}>{progress.title}</span>
        <span className={composerStyles.progressCount}>
          {completed}/{progress.steps.length}
        </span>
      </div>
      <div className={composerStyles.progressSteps}>
        {progress.steps.map(step => (
          <div key={step.id} className={composerStyles.progressStep} data-status={step.status}>
            <span className={composerStyles.progressStepMark} aria-hidden="true">
              {step.status === 'completed' && <Check size={9} strokeWidth={2.5} />}
            </span>
            <span className={composerStyles.progressStepLabel}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function safeMarkdownHref(value: string) {
  const href = value.trim();
  if (/^(?:https?:|mailto:|tel:)/i.test(href) || /^(?:\/|#)/.test(href)) return href;
  return undefined;
}

function renderInlineMarkdown(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'text':
        return [token.tokens?.length ? renderInlineMarkdown(token.tokens, key) : token.text];
      case 'strong':
        return [<strong key={key}>{renderInlineMarkdown(token.tokens || [], key)}</strong>];
      case 'em':
        return [<em key={key}>{renderInlineMarkdown(token.tokens || [], key)}</em>];
      case 'del':
        return [<del key={key}>{renderInlineMarkdown(token.tokens || [], key)}</del>];
      case 'codespan':
        return [<code key={key}>{token.text}</code>];
      case 'link': {
        const href = safeMarkdownHref(token.href);
        const content = renderInlineMarkdown(token.tokens || [], key);
        return href
          ? [
              <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
                {content}
              </a>,
            ]
          : [<span key={key}>{content}</span>];
      }
      case 'image': {
        const href = safeMarkdownHref(token.href);
        return href
          ? [
              <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
                {token.text || 'Imagem'}
              </a>,
            ]
          : [token.text || 'Imagem'];
      }
      case 'br':
        return [<br key={key} />];
      case 'escape':
        return [token.text];
      default:
        return ['text' in token && typeof token.text === 'string' ? token.text : token.raw];
    }
  });
}

function renderMarkdownBlocks(tokens: Token[], keyPrefix: string): ReactNode[] {
  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case 'paragraph':
        return [<p key={key}>{renderInlineMarkdown(token.tokens || [], key)}</p>];
      case 'text':
        return [<p key={key}>{renderInlineMarkdown(token.tokens || [token], key)}</p>];
      case 'heading':
        return [
          <div key={key} role="heading" aria-level={token.depth} className={composerStyles.markdownHeading}>
            {renderInlineMarkdown(token.tokens || [], key)}
          </div>,
        ];
      case 'blockquote':
        return [<blockquote key={key}>{renderMarkdownBlocks(token.tokens || [], key)}</blockquote>];
      case 'list': {
        const items = token.items.map((item: Tokens.ListItem, itemIndex: number) => (
          <li key={`${key}-${itemIndex}`}>{renderMarkdownBlocks(item.tokens || [], `${key}-${itemIndex}`)}</li>
        ));
        return token.ordered
          ? [
              <ol key={key} start={token.start || 1}>
                {items}
              </ol>,
            ]
          : [<ul key={key}>{items}</ul>];
      }
      case 'code':
        return [
          <pre key={key}>
            <code>{token.text}</code>
          </pre>,
        ];
      case 'hr':
        return [<hr key={key} />];
      case 'space':
        return [];
      case 'html':
        return [<p key={key}>{token.raw}</p>];
      default:
        return ['text' in token && typeof token.text === 'string' ? <p key={key}>{token.text}</p> : null];
    }
  });
}

function HtmlAgentMarkdown({ text }: { text: string }) {
  const content = useMemo(() => {
    try {
      const tokens = marked.lexer(text, { gfm: true, breaks: true });
      const rendered = renderMarkdownBlocks(tokens, 'agent-md');
      return rendered.length ? rendered : <span className={composerStyles.markdownFallback}>{text}</span>;
    } catch {
      return <span className={composerStyles.markdownFallback}>{text}</span>;
    }
  }, [text]);
  return <div className={composerStyles.markdown}>{content}</div>;
}

function threadFromResult(value: unknown): AgentThread | null {
  const candidate = record(value);
  const thread = record(candidate.thread);
  return string(thread.id) ? (thread as unknown as AgentThread) : null;
}

function messageTextFromContent(value: unknown) {
  return array(value)
    .map(item => {
      const content = record(item);
      return string(content.text) || string(content.input_text) || string(content.output_text);
    })
    .filter(Boolean)
    .join('\n');
}

function agentMessageText(value: unknown) {
  const item = record(value);
  return string(item.text) || messageTextFromContent(item.content);
}

function embeddedJson(value: unknown, tagName: string) {
  const source = string(value);
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(source);
  if (!match?.[1]) return {};
  try {
    return record(JSON.parse(match[1].trim()));
  } catch {
    return {};
  }
}

function embeddedJsonArray(value: unknown, tagName: string) {
  const source = string(value);
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(source);
  if (!match?.[1]) return [];
  try {
    return array(JSON.parse(match[1].trim()));
  } catch {
    return [];
  }
}

function normalizedAttachment(value: unknown): AgentAttachment | null {
  const candidate = record(value);
  const id = string(candidate.id).trim().toLowerCase();
  const kind = string(candidate.kind) as AgentAttachmentKind;
  if (!/^[a-f0-9]{32}$/.test(id) || !['image', 'text', 'doc', 'docx'].includes(kind)) return null;
  return {
    id,
    name: string(candidate.name).trim().slice(0, 180) || 'Anexo',
    mime: string(candidate.mime).trim().slice(0, 120),
    kind,
    size: Math.max(0, Number(candidate.size) || 0),
  };
}

function attachmentsFromPrompt(value: unknown) {
  return embeddedJsonArray(value, 'KODETY_ATTACHMENTS_MANIFEST')
    .map(normalizedAttachment)
    .filter((attachment): attachment is AgentAttachment => attachment !== null)
    .slice(0, MAX_AGENT_ATTACHMENTS);
}

function attachmentSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 102.4) / 10)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function normalizeElementReference(value: unknown): AgentElementReference | null {
  const candidate = record(value);
  const path = string(candidate.path).trim();
  if (!path) return null;
  const id = string(candidate.id).trim();
  const interactionId = string(candidate.interactionId).trim();
  const sectionId = string(candidate.sectionId).trim();
  const tag = string(candidate.tag).trim().toLowerCase();
  const identifier = id ? `#${id}` : interactionId ? interactionId : sectionId ? sectionId : path;
  return {
    path,
    pagePath: string(candidate.pagePath).trim(),
    tag,
    id,
    label: string(candidate.label).trim() || (tag ? tag.toUpperCase() : 'Elemento'),
    interactionId,
    sectionId,
    identifier,
  };
}

function elementReferenceFromContext(value: unknown) {
  const context = record(value);
  const selection = record(context.selection);
  const attributes = record(selection.attributes);
  const classes = array(selection.classes).map(string).filter(Boolean);
  return normalizeElementReference({
    path: selection.path,
    pagePath: record(context.project).mainHtmlPath,
    tag: selection.tag,
    id: selection.id,
    label: string(attributes['data-label']) || classes[0] || string(selection.tag).toUpperCase() || 'Elemento',
    interactionId: attributes['data-kodety-interaction-id'],
    sectionId: attributes['data-kodety-section-id'],
  });
}

function elementReferenceFromPrompt(value: unknown) {
  const embedded = normalizeElementReference(embeddedJson(value, 'KODETY_SELECTION_REFERENCE'));
  if (embedded) return embedded;
  return elementReferenceFromContext(embeddedJson(value, 'KODETY_EDITOR_CONTEXT'));
}

function userFacingPrompt(value: unknown) {
  const withoutContext = string(value)
    .replace(/\s*<KODETY_ATTACHMENT\b[^>]*>[\s\S]*?<\/KODETY_ATTACHMENT>\s*/gi, '\n\n')
    .replace(/\s*<KODETY_ATTACHMENTS_MANIFEST\b[^>]*>[\s\S]*?<\/KODETY_ATTACHMENTS_MANIFEST>\s*/gi, '\n\n')
    .replace(/\s*<KODETY_SELECTION_REFERENCE\b[^>]*>[\s\S]*?<\/KODETY_SELECTION_REFERENCE>\s*/gi, '\n\n')
    .replace(/\s*<KODETY_EDITOR_CONTEXT\b[^>]*>[\s\S]*?<\/KODETY_EDITOR_CONTEXT>\s*/gi, '\n\n')
    .trim();
  const paragraphs = withoutContext.split(/\n\s*\n/);
  if (/^(?:\$[A-Za-z0-9][A-Za-z0-9._:-]*)(?:\s+\$[A-Za-z0-9][A-Za-z0-9._:-]*)*$/.test(paragraphs[0] || '')) {
    paragraphs.shift();
  }
  return paragraphs.join('\n\n').trim();
}

function messagesFromThread(value: unknown): AgentChatMessage[] {
  const thread = record(value);
  const messages: AgentChatMessage[] = [];
  array(thread.turns).forEach(turnValue => {
    const turn = record(turnValue);
    array(turn.items).forEach(itemValue => {
      const item = record(itemValue);
      const type = string(item.type);
      const id = string(item.id) || `${type}-${messages.length}`;
      if (type === 'userMessage') {
        const rawText = messageTextFromContent(item.content);
        const text = userFacingPrompt(rawText);
        const target = elementReferenceFromPrompt(rawText);
        const attachments = attachmentsFromPrompt(rawText);
        if (text || attachments.length)
          messages.push({
          id,
          role: 'user',
          text: text || 'Anexos enviados',
          ...(target ? { target } : {}),
          ...(attachments.length ? { attachments } : {}),
        });
      }
      if (type === 'agentMessage') {
        const text = agentMessageText(item);
        if (text) messages.push({ id, role: 'assistant', text });
      }
    });
  });
  return messages;
}

function normalizedFigmaStatus(value: unknown): FigmaStatus {
  const status = record(value);
  return {
    installed: status.installed === true,
    connected: status.connected === true,
    connectUrl: string(status.connectUrl) || null,
    plugin: record(status.plugin),
    app: record(status.app),
    runtimeApp: record(status.runtimeApp),
  };
}

function skillLabel(skill: AgentSkill) {
  return agentSkillDisplayName(skill.name, skill.interface?.displayName);
}

function isFigmaSkill(name: string) {
  return /^figma(?:[-_:]|$)/i.test(name) || /figma/i.test(name);
}

function isKodetyEditorSkill(name: string) {
  return /(?:^|:)kodety-editor$/i.test(name) || /kodety-editor/i.test(name);
}

function isKodetyMotionSkill(name: string) {
  return /(?:^|:)kodety-motion$/i.test(name) || /kodety-motion/i.test(name);
}

function isKodetyPerformanceSkill(name: string) {
  return /(?:^|:)kodety-performance$/i.test(name) || /kodety-performance/i.test(name);
}

function isKodetyWidgetsSkill(name: string) {
  return /(?:^|:)kodety-widgets$/i.test(name) || /kodety-widgets/i.test(name);
}

function isKodetyLanguagesSkill(name: string) {
  return /(?:^|:)kodety-languages$/i.test(name) || /kodety-languages/i.test(name);
}

function isEssentialAgentSkill(name: string) {
  return (
    isFigmaSkill(name) ||
    isKodetyEditorSkill(name) ||
    isKodetyMotionSkill(name) ||
    isKodetyPerformanceSkill(name) ||
    isKodetyWidgetsSkill(name) ||
    isKodetyLanguagesSkill(name)
  );
}

function defaultAgentSkillNames(skills: AgentSkill[]) {
  const editor = skills.find(skill => isKodetyEditorSkill(skill.name));
  return editor ? [editor.name] : [...DEFAULT_AGENT_SKILL_NAMES];
}

function primaryFigmaSkill(skills: AgentSkill[]) {
  return (
    skills.find(skill => /(?:^|:)figma-design-to-code$/i.test(skill.name)) ||
    skills.find(skill => skill.name.toLowerCase() === 'figma') ||
    skills.find(skill => /(?:^|:)figma-use$/i.test(skill.name)) ||
    skills.find(skill => isFigmaSkill(skill.name))
  );
}

function primaryKodetySkill(skills: AgentSkill[]) {
  return skills.find(skill => isKodetyEditorSkill(skill.name));
}

function orderedAgentSkills(skills: AgentSkill[]) {
  const figma = primaryFigmaSkill(skills) || {
    name: 'figma:figma-design-to-code',
    description: 'Transforme seleções do Figma em código usando o contexto oficial do design.',
    interface: {
      displayName: 'Figma Design to Code',
      shortDescription: 'Design do Figma para código',
    },
  };
  const kodety = primaryKodetySkill(skills) || {
    name: 'kodety-editor',
    description: 'Edite o projeto aberto usando as capacidades nativas do Kodety.',
    interface: {
      displayName: 'Kodety',
      shortDescription: 'Edição nativa do projeto aberto',
    },
  };
  const motion = skills.find(skill => isKodetyMotionSkill(skill.name));
  const performance = skills.find(skill => isKodetyPerformanceSkill(skill.name));
  const widgets = skills.find(skill => isKodetyWidgetsSkill(skill.name));
  const pinned = [figma, kodety, widgets, motion, performance].filter((skill): skill is AgentSkill => Boolean(skill));
  const pinnedNames = new Set(pinned.map(skill => skill.name));
  const remaining = skills
    .filter(skill => !pinnedNames.has(skill.name))
    .sort((left, right) => skillLabel(left).localeCompare(skillLabel(right), 'pt-BR'));
  return [...pinned, ...remaining];
}

function officialConnectionUrl(value: unknown) {
  try {
    const url = new URL(string(value));
    const host = url.hostname.toLowerCase();
    const officialHost = ['chatgpt.com', 'openai.com', 'figma.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
    return url.protocol === 'https:' && officialHost && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
}

function dangerousToolChanges(pending: AgentPendingRequest) {
  if (pending.method !== 'item/tool/call') return [];
  const params = record(pending.params);
  const tool = string(params.tool);
  if (!['kodety_apply_changes', 'kodety_apply_component_changes', 'kodety_apply_code_component_changes'].includes(tool)) return [];
  const args = record(params.arguments);
  return array(args.changes)
    .map(change => string(record(change).type))
    .filter(type =>
      [
      'replacePageSource',
      'replaceTextFile',
      'deleteCmsItem',
      'detachComponentInstance',
      'deleteComponentVariant',
      'deleteComponent',
      'removeInstance',
      'removeSource',
      ].includes(type),
    );
}

export function HtmlHumanAgentToggle({ value, onChange, inspectorAvailable = true }: { value: InspectorMode; onChange: (mode: InspectorMode) => void; inspectorAvailable?: boolean }) {
  return (
    <div
      role="tablist"
      aria-label="Modo do painel lateral"
      data-kodety-onboarding="design-agent"
      className="mx-3 my-2 grid h-8 shrink-0 grid-cols-2 rounded-[10px] bg-white/[0.065] p-[3px]"
    >
      {(['human', 'agent'] as const).map(mode => (
        <button
          key={mode}
          type="button"
          data-kodety-onboarding={`design-${mode}-mode`}
          data-kodety-onboarding-reveal={mode === 'agent' || inspectorAvailable ? '' : undefined}
          role="tab"
          aria-selected={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'rounded-[7px] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            value === mode ? 'bg-white/[0.13] text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/85',
          )}
        >
          {mode === 'human' ? 'Canvas' : 'Agent'}
        </button>
      ))}
    </div>
  );
}

export function HtmlAgentPanel(props: { visible: boolean; preferredSkill?: string; onNavigate?: (href: string) => void }) {
  const host = useHtmlWorkspaceAgentHost();
  if (host?.agent && agentBrowserNotice()) return props.visible ? <HtmlAgentBrowserNotice /> : null;
  if (!host || host.agent || host.kind === 'wordpress') return <ConnectedHtmlAgentPanel {...props} />;
  if (!props.visible) return null;
  const english = getAdminUiLocale().toLowerCase().startsWith('en');
  return <section className="flex h-full flex-col gap-4 px-5 py-6 text-sm" aria-label="Agent">
    <div className="flex items-center gap-2 font-medium"><Sparkles className="size-4 text-[var(--kodety-accent-hover)]" />Agent</div>
    <p className="text-xs leading-6 text-muted-foreground">{english
      ? 'The Agent connection is unavailable. Open Agent settings to try again.'
      : 'A conexão do Agent está indisponível. Abra as configurações do Agent para tentar novamente.'}</p>
    <Button onClick={() => host.onOpenSettings('agents')}>
      <Link2 className="size-4" />{english ? 'Open Agent settings' : 'Abrir configurações do Agent'}
    </Button>
  </section>;
}

function ConnectedHtmlAgentPanel({
  visible,
  preferredSkill = '',
  onNavigate,
}: {
  visible: boolean;
  preferredSkill?: string;
  onNavigate?: (href: string) => void;
}) {
  const editorAvailable = useHtmlAgentEditorBridgeStore(state => state.available);
  const editorReadOnly = useHtmlAgentEditorBridgeStore(state => state.readOnly);
  const host = useHtmlWorkspaceAgentHost();
  const createBackend = host?.agent?.createBackend;
  const browserLicense = true;
  const browserLicenseRef = useRef(browserLicense);
  browserLicenseRef.current = browserLicense;
  const checkHostLicense = host?.checkLicense;
  const openHostSettings = host?.onOpenSettings;
  const wp = wordpressConfig();
  const agentUrl = host?.agent?.key || wp?.agentUrl || '';
  const nonce = host?.agent ? '' : wp?.agentNonce || wp?.nonce || '';
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [capabilities, setCapabilities] = useState<AgentBackendCapabilities>({});
  const [historyWarning, setHistoryWarning] = useState('');
  const capabilitiesRef = useRef<AgentBackendCapabilities>({});
  const [transportOptions, setTransportOptions] = useState<{ canChange: boolean; selected: string }>({ canChange: false, selected: 'local' });
  const [runtimeDiagnostic, setRuntimeDiagnostic] = useState<AgentRuntimeDiagnostic | null>(null);
  const [runtimeProgress, setRuntimeProgress] = useState<AgentRuntimeProgress | null>(null);
  const runtimeTransport = host?.agent || transportOptions.selected === 'webcontainer' ? 'webcontainer' : transportOptions.selected === 'remote' ? 'remote' : 'local';
  const runtimeBlockedByHosting = runtimeTransport === 'local' && isAgentRuntimeHostBlocked(runtimeDiagnostic);
  const browserStudio = Boolean(host && host.kind !== 'wordpress') || wp?.studio?.enabled === true;
  const useMcpFallback = runtimeBlockedByHosting && Boolean(openHostSettings || wp?.mcpSettingsUrl || wp?.settingsUrl);
  const runtimePreparationRef = useRef<AbortController | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [runtimeLicenseRequired, setLicenseRequired] = useState(() => host ? !host.licensed : wp?.product?.licensed === false);
  // Browser access comes from the same live product state as the Builder.
  // Native WordPress still enforces access through its server configuration.
  const licenseRequired = false;
  const [licenseChecking, setLicenseChecking] = useState(false);
  const licenseCheckingRef = useRef(false);
  const [licenseCheckMessage, setLicenseCheckMessage] = useState('');
  const [agentLicenseUrl, setAgentLicenseUrl] = useState(() => wp?.product?.licenseUrl || wp?.product?.upgradeUrl || '');
  const accountRecoveryHref = agentLicenseUrl || wp?.settingsUrl || '';
  const openAccountSettings = useCallback(() => {
    if (openHostSettings) { openHostSettings('agents'); return; }
    const url = new URL(wp?.settingsUrl || '/kodety/settings/', window.location.href);
    url.searchParams.set('section', 'agents');
    url.hash = '';
    if (onNavigate) onNavigate(url.toString());
    else window.location.assign(url.toString());
  }, [onNavigate, openHostSettings, wp?.settingsUrl]);
  const openAccountRecovery = useCallback(() => {
    if (openHostSettings) { openHostSettings('agents'); return; }
    if (!accountRecoveryHref) return;
    if (onNavigate) onNavigate(accountRecoveryHref);
    else window.location.assign(accountRecoveryHref);
  }, [accountRecoveryHref, onNavigate, openHostSettings]);
  const [accountLoading, setAccountLoading] = useState(true);
  const [account, setAccount] = useState<AgentAccount | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const [rateLimits, setRateLimits] = useState<AgentRateLimitSnapshot[]>([]);
  const [rateLimitStatus, setRateLimitStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [usageLimitBlocked, setUsageLimitBlocked] = useState(false);
  const [models, setModels] = useState<AgentModel[]>(createBackend ? [] : CODEX_MODEL_CATALOG);
  const [skills, setSkills] = useState<AgentSkill[]>(createBackend ? [] : AGENT_PREVIEW_SKILLS);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [threadId, setThreadId] = useState('');
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [figmaDesignLink, setFigmaDesignLink] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [model, setModel] = useState(() => {
    const preferred = readPreference(AGENT_MODEL_PREFERENCE, DEFAULT_MODEL);
    return isCodexModel(preferred) ? preferred : DEFAULT_MODEL;
  });
  const [effort, setEffort] = useState(() => readPreference(AGENT_EFFORT_PREFERENCE, DEFAULT_EFFORT));
  const [serviceTier, setServiceTier] = useState(() => readPreference(AGENT_SERVICE_TIER_PREFERENCE));
  const [selectedSkills, setSelectedSkills] = useState<string[]>(() => {
    const stored = readPreference(AGENT_SKILLS_PREFERENCE);
    return stored ? restoreAgentSkillSelection(stored) : restoreAgentSkillSelection(readPreference(LEGACY_AGENT_SKILLS_PREFERENCE), true);
  });
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [hoveredModel, setHoveredModel] = useState('');
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [slashSkillIndex, setSlashSkillIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [turnElapsedSeconds, setTurnElapsedSeconds] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [figma, setFigma] = useState<FigmaStatus | null>(null);
  const [figmaBusy, setFigmaBusy] = useState(false);
  const [figmaInstallConfirmation, setFigmaInstallConfirmation] = useState(false);
  const [promptRequests, setPromptRequests] = useState<AgentPromptRequest[]>([]);
  const [toolApprovalRequests, setToolApprovalRequests] = useState<AgentToolApprovalRequest[]>([]);
  const [promptAnswers, setPromptAnswers] = useState<Record<string, Record<string, string>>>({});
  const [agentProgress, setAgentProgress] = useState<AgentProgress | null>(null);
  const [pendingAgentLaunch, setPendingAgentLaunch] = useState<AgentLaunchRequest | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageAutoScrollRef = useRef(true);
  const cursorRef = useRef(0);
  const runningRef = useRef(false);
  const handledToolCallsRef = useRef(new Map<string, ToolResponseCacheEntry>());
  const processingRequestsRef = useRef(new Set<string>());
  const localToolApprovalIdsRef = useRef(new Set<string>());
  const activeTurnIdRef = useRef('');
  const agentMutationOccurredRef = useRef(false);
  useEffect(() => {
    const recordNativeMutation = () => { agentMutationOccurredRef.current = true; };
    window.addEventListener(AGENT_NATIVE_CHANGED_EVENT, recordNativeMutation);
    return () => window.removeEventListener(AGENT_NATIVE_CHANGED_EVENT, recordNativeMutation);
  }, []);
  const notifiedTurnIdsRef = useRef(new Set<string>());
  const figmaAutoInstallAttemptedRef = useRef(false);
  const figmaPollRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentObjectUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(
    () => () => {
    attachmentObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    attachmentObjectUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    writePreference(AGENT_MODEL_PREFERENCE, model);
  }, [model]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 36), 160)}px`;
  }, [input]);

  useEffect(() => {
    writePreference(AGENT_EFFORT_PREFERENCE, effort);
  }, [effort]);

  useEffect(() => {
    writePreference(AGENT_SERVICE_TIER_PREFERENCE, serviceTier);
  }, [serviceTier]);

  useEffect(() => {
    writePreference(AGENT_SKILLS_PREFERENCE, JSON.stringify(selectedSkills));
  }, [selectedSkills]);

  const openMcpSettings = useCallback(() => {
    if (openHostSettings) { openHostSettings('mcp'); return; }
    const settingsHref = wp?.mcpSettingsUrl || wp?.settingsUrl || '';
    if (!settingsHref) return;
    const url = new URL(settingsHref, window.location.href);
    url.searchParams.set('section', 'mcp');
    if (onNavigate) onNavigate(url.toString());
    else window.location.assign(url.toString());
  }, [onNavigate, openHostSettings, wp?.mcpSettingsUrl, wp?.settingsUrl]);

  useEffect(() => {
    const requested = preferredSkill.trim();
    if (!requested) return;
    const matched = skills.find(skill => skill.name === requested || (requested === 'kodety-languages' && isKodetyLanguagesSkill(skill.name)));
    if (!matched || selectedSkills.includes(matched.name)) return;
    setSelectedSkills(current => (current.includes(matched.name) ? current : [...current, matched.name]));
  }, [preferredSkill, selectedSkills, skills]);

  useEffect(() => {
    const refreshPreferences = (event: Event) => {
      const detail = record((event as CustomEvent).detail);
      const nextModel = string(detail.defaultModel);
      const nextEffort = string(detail.defaultEffort);
      const nextSkills = array(detail.enabledSkills).map(string).filter(Boolean);
      if (nextModel) setModel(nextModel);
      if (nextEffort) setEffort(nextEffort);
      if (nextSkills.length)
        setSelectedSkills(current =>
          current.length === nextSkills.length && current.every((name, index) => name === nextSkills[index]) ? current : nextSkills,
        );
    };
    window.addEventListener('kodety-agent-preferences-changed', refreshPreferences);
    return () => window.removeEventListener('kodety-agent-preferences-changed', refreshPreferences);
  }, []);

  useEffect(() => {
    if (!messageAutoScrollRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, promptRequests, running, toolApprovalRequests]);

  const transport = useMemo<AgentBackend>(() => {
    const callbacks: AgentBackendCallbacks = {
    onConfig: config => {
      // Runtime configuration is authoritative; the page bootstrap may be stale.
      capabilitiesRef.current = record(config.capabilities);
      setCapabilities(capabilitiesRef.current);
      setHistoryWarning(string(config.historyWarning));
      if (capabilitiesRef.current.skills === false) setSelectedSkills([]);
      if (typeof config.enabled === 'boolean') {
        setLicenseRequired(config.enabled === false || config.licenseRequired === true);
        setAgentLicenseUrl(string(config.licenseUrl) || string(config.upgradeUrl) || wordpressConfig()?.product?.licenseUrl || wordpressConfig()?.product?.upgradeUrl || '');
      }
      const options = record(config.transportOptions);
      setTransportOptions({ canChange: options.canChange === true, selected: string(options.selected) || string(config.transport) || 'local' });
    },
    onDenied: cause => {
      if (figmaPollRef.current !== null) { window.clearTimeout(figmaPollRef.current); figmaPollRef.current = null; }
      setRuntimeReady(false);
      setAccount(null);
      setRunning(false);
      setPendingAgentLaunch(null);
      setRuntimeDiagnostic(agentRuntimeFailure(cause));
      if (/license|agent_disabled/.test(cause.code || '')) setLicenseRequired(true);
      useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
    },
    };
    return createBackend ? createBackend(callbacks) : new AgentTransport({
      agentUrl, nonce,
      pageUrl: typeof window === 'undefined' ? 'http://localhost' : window.location.href,
      ...callbacks,
    });
  }, [agentUrl, nonce, createBackend]);
  useEffect(() => () => transport.cancelAll(), [transport]);
  const request = transport.request;

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}) => request('rpc', { body: { method, params } }), [request]);

  const addAttachmentFiles = useCallback(
    async (values: FileList | File[]) => {
    if (capabilitiesRef.current.attachments === false || licenseRequired || !agentUrl || attachmentsUploading || sending || running) return;
    const slots = MAX_AGENT_ATTACHMENTS - attachments.length;
    if (slots <= 0) {
      setError(`Envie no máximo ${MAX_AGENT_ATTACHMENTS} anexos por mensagem.`);
      return;
    }
    const files = Array.from(values).slice(0, slots);
    if (!files.length) return;
    setAttachmentsUploading(true);
    setError('');
    const uploaded: AgentAttachment[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (file.size < 1 || file.size > MAX_AGENT_ATTACHMENT_BYTES) {
        errors.push(`${file.name}: use um arquivo de até 10 MB.`);
        continue;
      }
      try {
        const payload = await transport.uploadAttachment(file);
        const attachment = normalizedAttachment(record(payload).attachment);
        if (!attachment) throw new Error(`O servidor não confirmou o anexo ${file.name}.`);
        if (attachment.kind === 'image') {
          const previewUrl = URL.createObjectURL(file);
          attachment.previewUrl = previewUrl;
          attachmentObjectUrlsRef.current.add(previewUrl);
        }
        uploaded.push(attachment);
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : `Não foi possível anexar ${file.name}.`);
      }
    }
    if (uploaded.length) setAttachments(current => [...current, ...uploaded].slice(0, MAX_AGENT_ATTACHMENTS));
    if (errors.length) setError(errors.join(' '));
    setAttachmentsUploading(false);
    },
    [agentUrl, attachments.length, attachmentsUploading, licenseRequired, running, sending, transport],
  );

  const removeAttachment = useCallback(
    (attachment: AgentAttachment) => {
    setAttachments(current => current.filter(candidate => candidate.id !== attachment.id));
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
      attachmentObjectUrlsRef.current.delete(attachment.previewUrl);
    }
    void request('attachments', {
      method: 'DELETE',
      body: { attachmentId: attachment.id },
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Não foi possível remover o anexo.'));
    },
    [request],
  );

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addAttachmentFiles(event.target.files);
    event.target.value = '';
  };

  const handleAttachmentPaste = (event: ClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(event.clipboardData.files || []).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addAttachmentFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttachmentDragActive(false);
    if (event.dataTransfer.files?.length) void addAttachmentFiles(event.dataTransfer.files);
  };

  useEffect(() => {
    if (!runtimeReady || !preferencesLoaded) return;
    const timer = window.setTimeout(() => {
      void request('config', {
        body: {
          model,
          effort,
          enabledSkills: selectedSkills,
        },
      }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [effort, model, preferencesLoaded, request, runtimeReady, selectedSkills]);

  const respond = useCallback((requestId: string, result: unknown) => request('respond', { body: { requestId, result } }), [request]);

  const loadFigmaStatus = useCallback(async () => {
    if (capabilitiesRef.current.figma === false) { setFigma(null); return null; }
    try {
      const status = normalizedFigmaStatus(await rpc('figma/status', { forceRefresh: true }));
      setFigma(status);
      return status;
    } catch {
      setFigma(null);
      return null;
    }
  }, [rpc]);

  const readAccount = useCallback(async (signal?: AbortSignal) => {
    const response = record(await request('rpc', { signal, body: { method: 'account/read', params: { refreshToken: false } } }));
    signal?.throwIfAborted();
    const nextAccount = Object.keys(record(response.account)).length ? (record(response.account) as AgentAccount) : null;
    return nextAccount;
  }, [request]);

  const loadRateLimits = useCallback(async () => {
    setRateLimitStatus(current => (current === 'ready' ? current : 'loading'));
    try {
      const response = await rpc('account/rateLimits/read');
      const snapshots = normalizedRateLimitSnapshots(response);
      setRateLimits(snapshots);
      setRateLimitStatus(snapshots.some(snapshot => snapshot.primary || snapshot.secondary) ? 'ready' : 'unavailable');
      if (snapshots.length && !snapshots.some(rateLimitSnapshotReached)) setUsageLimitBlocked(false);
      return snapshots;
    } catch (cause) {
      setRateLimitStatus('unavailable');
      throw cause;
    }
  }, [rpc]);

  const loadRuntimeData = useCallback(async () => {
    const [modelResponse, skillResponse, threadResponse] = await Promise.all([
      rpc('model/list'),
      capabilitiesRef.current.skills === false ? Promise.resolve({ data: [] }) : rpc('skills/list', { forceReload: true }),
      rpc('thread/list', { limit: 30 }),
    ]);
    const runtimeModels = array(record(modelResponse).data)
      .map(value => record(value) as unknown as AgentModel)
      .filter(value => value.id && value.model && value.displayName);
    const nextModels = createBackend ? runtimeModels : codexModelsFromRuntime(runtimeModels);
    const nextSkills = array(record(skillResponse).data)
      .flatMap(value => array(record(value).skills))
      .map(value => record(value) as unknown as AgentSkill)
      .filter(value => value.name && value.enabled !== false);
    const nextThreads = array(record(threadResponse).data)
      .map(value => record(value) as unknown as AgentThread)
      .filter(value => value.id);
    setModels(nextModels);
    setSkills(nextSkills);
    setThreads(nextThreads);
    setModel(current =>
      nextModels.some(candidate => candidate.model === current || candidate.id === current)
        ? current
        : nextModels.find(candidate => candidate.isDefault)?.model ||
          nextModels.find(candidate => /sol/i.test(candidate.displayName))?.model ||
          nextModels[0]?.model ||
          (createBackend ? '' : DEFAULT_MODEL),
    );
    setSelectedSkills(current => {
      if (capabilitiesRef.current.skills === false) return [];
      const available = new Set(nextSkills.map(skill => skill.name));
      const retained = current.filter(name => available.has(name));
      return retained.length ? retained : defaultAgentSkillNames(nextSkills);
    });
    await loadFigmaStatus();
  }, [createBackend, loadFigmaStatus, rpc]);

  const applyRuntimeConfig = useCallback(
    (runtimeConfig: Record<string, unknown>) => {
    const locked = runtimeConfig.enabled === false || runtimeConfig.licenseRequired === true;
    capabilitiesRef.current = record(runtimeConfig.capabilities);
    setCapabilities(capabilitiesRef.current);
    const configuredModel = string(runtimeConfig.defaultModel);
    const configuredEffort = string(runtimeConfig.defaultEffort);
    const configuredSkills = array(runtimeConfig.enabledSkills).map(string).filter(Boolean);
    setLicenseRequired(locked);
    setAgentLicenseUrl(
        string(runtimeConfig.licenseUrl) || string(runtimeConfig.upgradeUrl) || wp?.product?.licenseUrl || wp?.product?.upgradeUrl || '',
    );
    if (configuredModel && (createBackend || isCodexModel(configuredModel))) setModel(configuredModel);
    if (configuredEffort) setEffort(configuredEffort);
    if (locked) {
      setModels(createBackend ? [] : CODEX_MODEL_CATALOG);
      setSkills(createBackend ? [] : AGENT_PREVIEW_SKILLS);
        setSelectedSkills(current => {
          const retained = current.filter(name => AGENT_PREVIEW_SKILL_NAMES.has(name));
          return retained.length ? retained : defaultAgentSkillNames(AGENT_PREVIEW_SKILLS);
        });
    } else if (capabilitiesRef.current.skills === false) setSelectedSkills([]);
    else if (configuredSkills.length) setSelectedSkills(configuredSkills);
    setPreferencesLoaded(true);
    },
    [createBackend, wp?.product?.licenseUrl, wp?.product?.upgradeUrl],
  );

  const reportConnectionFailure = useCallback((cause: unknown) => {
    if (isAgentSetupAborted(cause)) return;
    setRuntimeReady(false);
    setAccount(null);
    setRuntimeDiagnostic(agentRuntimeFailure(cause));
    setError('');
  }, []);

  const refreshRuntime = useCallback(
    async (force = false) => {
      runtimePreparationRef.current?.abort();
      const controller = new AbortController();
      runtimePreparationRef.current = controller;
      setRuntimeDiagnostic(null);
    setError('');
      const runtimeConfig = await prepareAgentRuntime(request, {
        force,
        signal: controller.signal,
        onProgress: setRuntimeProgress,
      });
    applyRuntimeConfig(runtimeConfig);
    if (runtimeConfig.enabled === false || runtimeConfig.licenseRequired === true) {
      setRuntimeReady(false);
      setAccount(null);
      setRateLimits([]);
      setRateLimitStatus('idle');
      if (browserLicenseRef.current === true) throw agentRuntimeUnavailable(runtimeConfig);
      return false;
    }
    if (runtimeConfig.available === false) {
        throw agentRuntimeUnavailable(runtimeConfig);
    }
    setRuntimeReady(true);
    const nextAccount = await readAccount(controller.signal);
    setAccount(nextAccount);
    if (nextAccount) void Promise.allSettled([loadRuntimeData(), loadRateLimits()]);
    return true;
    },
    [applyRuntimeConfig, readAccount, loadRateLimits, loadRuntimeData, request],
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setPreferencesLoaded(false);
      setAccountLoading(true);
      try {
        await refreshRuntime();
      } catch (cause) {
        if (!cancelled) reportConnectionFailure(cause);
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      runtimePreparationRef.current?.abort();
    };
  }, [agentUrl, browserLicense, refreshRuntime, reportConnectionFailure]);

  const licenseRefreshActiveRef = useRef(false);
  const recheckLicense = useCallback(async () => {
    if (accountLoading || running || licenseRefreshActiveRef.current) return;
    licenseRefreshActiveRef.current = true;
    setAccountLoading(true);
    try {
      await refreshRuntime();
    } catch (cause) {
      reportConnectionFailure(cause);
    } finally {
      licenseRefreshActiveRef.current = false;
      setAccountLoading(false);
    }
  }, [accountLoading, refreshRuntime, reportConnectionFailure, running]);

  const licensePanelWasVisibleRef = useRef(visible);
  useEffect(() => {
    const reopened = visible && !licensePanelWasVisibleRef.current;
    licensePanelWasVisibleRef.current = visible;
    if (reopened && (licenseRequired || !runtimeReady)) void recheckLicense();
  }, [licenseRequired, recheckLicense, runtimeReady, visible]);

  useEffect(() => {
    const onReturn = () => {
      if (visible && (licenseRequired || !runtimeReady) && document.visibilityState !== 'hidden') void recheckLicense();
    };
    // Browser license changes restart preparation through React, including
    // changes arriving during loading. The server still uses this event.
    const onLicenseChange = () => { if (!createBackend) void recheckLicense(); };
    window.addEventListener('focus', onReturn);
    window.addEventListener('pageshow', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('kodety:license-changed', onLicenseChange);
    return () => {
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pageshow', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('kodety:license-changed', onLicenseChange);
    };
  }, [createBackend, licenseRequired, recheckLicense, runtimeReady, visible]);

  const clearAccountSession = useCallback(() => {
      setThreadId('');
      setThreads([]);
      setMessages([]);
      setAgentProgress(null);
      setRateLimits([]);
      setUsageLimitBlocked(false);
      setPromptRequests([]);
      setToolApprovalRequests([]);
      cursorRef.current = 0;
      activeTurnIdRef.current = '';
      setRunning(false);
      agentMutationOccurredRef.current = false;
      useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
      useHtmlAgentEditorBridgeStore.getState().clearActivity();
      setTurnStartedAt(null);
      setTurnElapsedSeconds(null);
  }, []);

  // Settings is the sole login owner. Read the server again on return/reopen,
  // or when Settings signals a change (including from another browser tab).
  const accountRefreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!visible || accountLoading || !runtimeReady || licenseRequired) return;
    const observer = observeAgentAccount({
      read: readAccount,
      onAccount: nextAccount => {
        setError(current => current === 'Não foi possível atualizar a conexão. Verifique novamente em Settings → Agentes.' ? '' : current);
        const previousAccount = accountRef.current;
        if (previousAccount && (!nextAccount || previousAccount.email !== nextAccount.email || previousAccount.type !== nextAccount.type)) clearAccountSession();
        accountRef.current = nextAccount;
        setAccount(nextAccount);
        if (nextAccount && !previousAccount) void Promise.allSettled([loadRuntimeData(), loadRateLimits()]);
      },
      onError: cause => {
        // Transport handles access denial. A transient read failure must not
        // turn a previously confirmed account into a logged-out account.
        if (!isAgentSetupAborted(cause)) setError('Não foi possível atualizar a conexão. Verifique novamente em Settings → Agentes.');
      },
    });
    accountRefreshRef.current = observer.refresh;
    observer.refresh();
    return () => {
      accountRefreshRef.current = null;
      observer.stop();
    };
  }, [accountLoading, clearAccountSession, licenseRequired, loadRateLimits, loadRuntimeData, readAccount, runtimeReady, visible]);

  useEffect(() => {
    const handleTransportChange = () => {
      runtimePreparationRef.current?.abort();
      transport.cancelAll();
      setAccount(null);
      setRuntimeReady(false);
      setRuntimeDiagnostic(null);
      setAttachments([]);
      attachmentObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      attachmentObjectUrlsRef.current.clear();
      handledToolCallsRef.current.clear();
      processingRequestsRef.current.clear();
      localToolApprovalIdsRef.current.clear();
      if (figmaPollRef.current !== null) { window.clearTimeout(figmaPollRef.current); figmaPollRef.current = null; }
      clearAccountSession();
      // The next return to the sidebar re-reads the selected environment.
    };
    const unsubscribe = subscribeAgentAccountChanged(agentUrl, connected => {
      if (connected === false) {
        transport.cancelAll();
        setAccount(null);
        clearAccountSession();
      }
      if (accountRefreshRef.current) accountRefreshRef.current();
      else if (visible) void recheckLicense();
    });
    window.addEventListener('kodety-agent-transport-changed', handleTransportChange);
    return () => {
      unsubscribe();
      window.removeEventListener('kodety-agent-transport-changed', handleTransportChange);
    };
  }, [agentUrl, clearAccountSession, recheckLicense, transport, visible]);

  useEffect(() => {
    if (visible && !runtimeReady && !accountLoading && !runtimeDiagnostic && !licenseRequired) void recheckLicense();
  }, [accountLoading, licenseRequired, recheckLicense, runtimeDiagnostic, runtimeReady, visible]);

  useEffect(() => () => {
    if (figmaPollRef.current !== null) window.clearTimeout(figmaPollRef.current);
  }, []);

  const pollFigmaConnection = useCallback(() => {
    if (figmaPollRef.current !== null) window.clearTimeout(figmaPollRef.current);
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const status = await loadFigmaStatus();
      if (status?.connected) {
        await loadRuntimeData().catch(() => undefined);
        return;
      }
      if (attempts < 90) figmaPollRef.current = window.setTimeout(() => void poll(), 2000);
    };
    figmaPollRef.current = window.setTimeout(() => void poll(), 1200);
  }, [loadFigmaStatus, loadRuntimeData]);

  const installFigma = useCallback(
    async (confirmed = false, openConnection = true) => {
    const popup = openConnection ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    setFigmaBusy(true);
    setError('');
    try {
      const result = record(await rpc('figma/install', { confirmed }));
      const rawStatus = Object.keys(record(result.status)).length ? result.status : result;
      const status = normalizedFigmaStatus(rawStatus);
      const install = record(result.install);
      const authApp = record(array(install.appsNeedingAuth)[0]);
      const connectUrl = status.connectUrl || string(authApp.installUrl) || null;
      const nextStatus = { ...status, connectUrl };
      setFigma(nextStatus);
      setFigmaInstallConfirmation(false);
        await loadRuntimeData().catch(() => undefined);
      if (openConnection && nextStatus.installed && !nextStatus.connected && connectUrl) {
        if (popup) popup.location.href = connectUrl;
        else window.open(connectUrl, '_blank', 'noopener,noreferrer');
        pollFigmaConnection();
      } else popup?.close();
    } catch (cause) {
      popup?.close();
      const requestError = cause as AgentHttpError;
      if (requestError?.status === 409 && !confirmed) {
        setFigmaInstallConfirmation(true);
        setError('');
      } else {
        setError(cause instanceof Error ? cause.message : 'Não foi possível instalar o Figma oficial.');
      }
    } finally {
      setFigmaBusy(false);
    }
    },
    [loadRuntimeData, pollFigmaConnection, rpc],
  );

  useEffect(() => {
    if (!account || !runtimeReady || !figma || figma.installed || figmaBusy || figmaAutoInstallAttemptedRef.current) return;
    figmaAutoInstallAttemptedRef.current = true;
    void installFigma(false, false);
  }, [account, figma, figmaBusy, installFigma, runtimeReady]);

  useEffect(() => {
    if (turnStartedAt === null) return;
    const updateElapsed = () => setTurnElapsedSeconds(Math.max(0, Math.round((Date.now() - turnStartedAt) / 1000)));
    updateElapsed();
    if (!running) return;
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [running, turnStartedAt]);

  const connectFigma = useCallback(() => {
    if (!figma?.connectUrl) return;
    window.open(figma.connectUrl, '_blank', 'noopener,noreferrer');
    pollFigmaConnection();
  }, [figma?.connectUrl, pollFigmaConnection]);

  const openThread = useCallback(
    async (nextThreadId: string) => {
    messageAutoScrollRef.current = true;
    setAgentProgress(null);
    if (!nextThreadId) {
      setThreadId('');
      setMessages([]);
      cursorRef.current = 0;
      activeTurnIdRef.current = '';
      setTurnStartedAt(null);
      setTurnElapsedSeconds(null);
      localToolApprovalIdsRef.current.clear();
      setToolApprovalRequests([]);
        agentMutationOccurredRef.current = false;
        useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
      return;
    }
    setError('');
    setSending(true);
    try {
        await rpc('thread/resume', {
          threadId: nextThreadId,
          model,
          serviceTier: serviceTier || null,
        });
        const response = record(
          await rpc('thread/read', {
            threadId: nextThreadId,
            includeTurns: true,
          }),
        );
      const turns = array(record(response.thread).turns).map(record);
      const latestTurn = turns.at(-1);
      const turnInProgress = string(latestTurn?.status) === 'inProgress';
        const resumedTurnId = turnInProgress ? string(latestTurn?.id) : '';
      setThreadId(nextThreadId);
      setMessages(messagesFromThread(response.thread));
        activeTurnIdRef.current = resumedTurnId;
      setRunning(turnInProgress);
      setTurnStartedAt(turnInProgress ? Date.now() : null);
      setTurnElapsedSeconds(null);
      cursorRef.current = Math.max(0, Number(response.kodetyEventCursor) || 0);
      setPromptRequests([]);
      localToolApprovalIdsRef.current.clear();
      setToolApprovalRequests([]);
        agentMutationOccurredRef.current = false;
        if (resumedTurnId) {
          useHtmlAgentEditorBridgeStore
            .getState()
            .startTurnActivity(resumedTurnId, getAdminUiLocale().toLowerCase().startsWith('en') ? 'Agent is working' : 'Agente trabalhando');
        } else {
          useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
        }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a sessão.');
    } finally {
      setSending(false);
    }
    },
    [model, rpc, serviceTier],
  );

  const startThread = useCallback(async () => {
    if (createBackend && !models.some(candidate => candidate.model === model)) throw new Error('Nenhum modelo está disponível nesta conexão. Atualize o Agent.');
    messageAutoScrollRef.current = true;
    setAgentProgress(null);
    const response = await rpc('thread/start', {
      model,
      serviceTier: serviceTier || null,
    });
    const thread = threadFromResult(response);
    if (!thread) throw new Error('O Agente não criou uma sessão válida.');
    setThreadId(thread.id);
    setThreads(current => [thread, ...current.filter(candidate => candidate.id !== thread.id)]);
    setMessages([]);
    cursorRef.current = Math.max(0, Number(record(response).kodetyEventCursor) || 0);
    activeTurnIdRef.current = '';
    setTurnStartedAt(null);
    setTurnElapsedSeconds(null);
    localToolApprovalIdsRef.current.clear();
    setToolApprovalRequests([]);
    return thread.id;
  }, [createBackend, model, models, rpc, serviceTier]);

  const respondToPrompt = useCallback(
    async (requestId: string, result: unknown) => {
    try {
      await respond(requestId, result);
      setPromptRequests(current => current.filter(request => request.requestId !== requestId));
      setPromptAnswers(current => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível responder ao agente.');
    }
    },
    [respond],
  );

  const executeDynamicTool = useCallback(
    async (pending: AgentPendingRequest) => {
    if (licenseRequired) return;
    const requestId = string(pending.requestId);
    if (!requestId) return;
    const params = record(pending.params);
    const cached = handledToolCallsRef.current.get(requestId);
    if (cached?.responding) return;
    let entry = cached;
    if (!entry) {
      const meta: HtmlAgentToolCallMeta = {
        requestId,
        callId: string(params.callId) || requestId,
        threadId: string(params.threadId),
        turnId: string(params.turnId),
      };
        const tool = string(params.tool);
      let result: ToolResponseCacheEntry['result'];
      try {
          if (AGENT_MUTATING_TOOLS.has(tool)) {
            useHtmlAgentEditorBridgeStore
              .getState()
              .updateTurnActivity(getAdminUiLocale().toLowerCase().startsWith('en') ? 'Agent is applying changes' : 'Agente aplicando alterações');
          }
          const output =
            tool === 'kodety_progress_update'
          ? (() => {
              const progress = normalizedAgentProgress(params.arguments);
              if (!progress) throw new Error('O progresso precisa de pelo menos uma etapa válida.');
              setAgentProgress(progress);
                  const activeStep = progress.steps.find(step => step.status === 'in_progress');
                  if (activeStep?.label) {
                    useHtmlAgentEditorBridgeStore.getState().updateTurnActivity(activeStep.label);
                  }
              return {
                visible: true,
                completed: progress.steps.filter(step => step.status === 'completed').length,
                total: progress.steps.length,
              };
            })()
              : await invokeHtmlAgentEditorTool(tool, record(params.arguments), meta);
          if (AGENT_MUTATING_TOOLS.has(tool)) agentMutationOccurredRef.current = true;
          if (tool === 'kodety_native_call' && record(output).committed === true) agentMutationOccurredRef.current = true;
        result = {
          success: true,
          contentItems: [{ type: 'inputText', text: JSON.stringify(output ?? null) }],
        };
      } catch (cause) {
        result = {
          success: false,
            contentItems: [
              {
            type: 'inputText',
            text: JSON.stringify({
              error: cause instanceof Error ? cause.message : 'A alteração não pôde ser aplicada.',
              code: record(cause).code,
              status: record(cause).status,
              data: record(cause).data,
              retryable: typeof record(cause).retryable === 'boolean'
                ? record(cause).retryable
                : /revision|mudou|conflito/i.test(cause instanceof Error ? cause.message : ''),
            }),
              },
            ],
        };
      }
      entry = { result, responding: false };
      handledToolCallsRef.current.set(requestId, entry);
      if (handledToolCallsRef.current.size > 200) {
        const oldest = handledToolCallsRef.current.keys().next().value;
        if (oldest) handledToolCallsRef.current.delete(oldest);
      }
    }
    entry.responding = true;
    try {
      await respond(requestId, entry.result);
    } catch {
      // Keep the computed result so the next poll retries the response without
      // executing a mutating callback twice.
      entry.responding = false;
    }
    },
    [licenseRequired, respond],
  );

  const processPending = useCallback(
    (pendingValues: unknown[]) => {
    if (licenseRequired) return;
    const pendingIds = new Set(pendingValues.map(value => string(record(value).requestId)).filter(Boolean));
    setToolApprovalRequests(current => current.filter(request => pendingIds.has(request.requestId)));
    setPromptRequests(current => current.filter(request => pendingIds.has(request.requestId)));
    [...localToolApprovalIdsRef.current].forEach(requestId => {
      if (!pendingIds.has(requestId)) localToolApprovalIdsRef.current.delete(requestId);
    });
    pendingValues.forEach(value => {
      const pending = record(value) as unknown as AgentPendingRequest;
      const requestId = string(pending.requestId);
      const method = string(pending.method);
      if (!requestId || !method) return;
      if (method === 'item/tool/call') {
        if (processingRequestsRef.current.has(requestId)) return;
        if (handledToolCallsRef.current.has(requestId)) {
          processingRequestsRef.current.add(requestId);
          void executeDynamicTool(pending).finally(() => processingRequestsRef.current.delete(requestId));
          return;
        }
        const params = record(pending.params);
        if (
            editorReadOnly &&
            ['kodety_apply_changes', 'kodety_apply_component_changes', 'kodety_apply_code_component_changes', 'kodety_apply_motion'].includes(
              string(params.tool),
            )
        ) {
          handledToolCallsRef.current.set(requestId, {
            responding: false,
            result: {
              success: false,
                contentItems: [
                  {
                type: 'inputText',
                text: JSON.stringify({
                  error: 'O projeto está em modo somente leitura; nenhuma alteração foi executada.',
                  retryable: false,
                }),
                  },
                ],
            },
          });
          processingRequestsRef.current.add(requestId);
          void executeDynamicTool(pending).finally(() => processingRequestsRef.current.delete(requestId));
          return;
        }
        const dangerousChanges = dangerousToolChanges(pending);
        if (dangerousChanges.length) {
          if (localToolApprovalIdsRef.current.has(requestId)) return;
          localToolApprovalIdsRef.current.add(requestId);
            setToolApprovalRequests(current => [
              ...current,
              {
            requestId,
            pending,
            changeTypes: [...new Set(dangerousChanges)],
            summary: string(record(params.arguments).summary),
              },
            ]);
          return;
        }
        processingRequestsRef.current.add(requestId);
        void executeDynamicTool(pending).finally(() => processingRequestsRef.current.delete(requestId));
        return;
      }
        setPromptRequests(current =>
          current.some(request => request.requestId === requestId) ? current : [...current, { requestId, method, params: record(pending.params) }],
        );
    });
    },
    [editorReadOnly, executeDynamicTool, licenseRequired],
  );

  const resolveToolApproval = useCallback(
    (approval: AgentToolApprovalRequest, accepted: boolean) => {
    const { requestId, pending } = approval;
    setToolApprovalRequests(current => current.filter(request => request.requestId !== requestId));
    localToolApprovalIdsRef.current.delete(requestId);
    if (!accepted) {
      handledToolCallsRef.current.set(requestId, {
        responding: false,
        result: {
          success: false,
            contentItems: [
              {
            type: 'inputText',
            text: JSON.stringify({
              error: 'A alteração destrutiva foi recusada pelo usuário no editor Kodety.',
              retryable: false,
            }),
              },
            ],
        },
      });
    }
    processingRequestsRef.current.add(requestId);
    void executeDynamicTool(pending).finally(() => processingRequestsRef.current.delete(requestId));
    },
    [executeDynamicTool],
  );

  const upsertAssistantMessage = useCallback((id: string, update: (current: string) => string, streaming: boolean) => {
    setMessages(current => {
      const index = current.findIndex(message => message.id === id);
      if (index < 0) return [...current, { id, role: 'assistant', text: update(''), streaming }];
      const next = [...current];
      next[index] = {
        ...next[index],
        text: update(next[index].text),
        streaming,
      };
      return next;
    });
  }, []);

  const processEvents = useCallback(
    (values: unknown[]) => {
    values.forEach(value => {
      const envelope = record(value) as unknown as AgentEventEnvelope;
      const message = record(envelope.message);
      const method = string(message.method);
      const params = record(message.params);
      if (method === 'turn/started') {
        // Activity belongs to one turn. Clear the previous footprint before
        // streamed tool calls start accumulating the next set of canvas paths.
          const activityStore = useHtmlAgentEditorBridgeStore.getState();
          const startedTurnId = string(record(params.turn).id) || string(params.turnId);
          activityStore.clearActivity();
          agentMutationOccurredRef.current = false;
          activeTurnIdRef.current = startedTurnId;
          if (startedTurnId) {
            activityStore.startTurnActivity(
              startedTurnId,
              getAdminUiLocale().toLowerCase().startsWith('en') ? 'Agent is working' : 'Agente trabalhando',
            );
          }
        setTurnStartedAt(Date.now());
        setTurnElapsedSeconds(0);
        setRunning(true);
      }
      if (method === 'turn/completed') {
        const turn = record(params.turn);
        const completedTurnId = string(turn.id) || string(params.turnId);
          const turnStatus = string(turn.status).toLowerCase();
          const turnError = turn.error;
          const hasTurnError =
            typeof turnError === 'string'
              ? turnError.trim().length > 0
              : turnError !== null && typeof turnError === 'object'
                ? Object.keys(record(turnError)).length > 0
                : Boolean(turnError);
          const failed = hasTurnError || /fail|error/.test(turnStatus);
          const cancelled = /cancel|interrupt/.test(turnStatus);
          const activityStore = useHtmlAgentEditorBridgeStore.getState();
          const notificationId = completedTurnId || activityStore.turnActivity?.id || `completed-${Date.now()}`;
          if (agentMutationOccurredRef.current && !notifiedTurnIdsRef.current.has(notificationId)) {
            notifiedTurnIdsRef.current.add(notificationId);
            if (notifiedTurnIdsRef.current.size > 100) {
              const oldest = notifiedTurnIdsRef.current.values().next().value;
              if (oldest) notifiedTurnIdsRef.current.delete(oldest);
            }
            const english = getAdminUiLocale().toLowerCase().startsWith('en');
            if (failed) {
              toast.error(english ? 'Agent could not apply the changes' : 'O Agente não conseguiu aplicar as alterações', {
                id: `kodety-agent-turn-${notificationId}`,
              });
            } else if (!cancelled) {
              toast.success(english ? 'Agent changes applied' : 'Alterações do Agente aplicadas', {
                id: `kodety-agent-turn-${notificationId}`,
              });
            }
          }
        if (!completedTurnId || activeTurnIdRef.current === completedTurnId) activeTurnIdRef.current = '';
        setTurnElapsedSeconds(current => current ?? 0);
        setRunning(false);
          activityStore.finishTurnActivity();
          activityStore.clearActivity();
          agentMutationOccurredRef.current = false;
        if (isUsageLimitError(turn.error)) {
          setUsageLimitBlocked(true);
          setError('O limite de uso desta conta foi atingido. Aguarde o reset informado ou troque de conta.');
          void loadRateLimits().catch(() => undefined);
        } else if (createBackend && failed && !cancelled) {
          setError(string(record(turn.error).message) || 'O Agent não conseguiu concluir esta tarefa. Tente novamente.');
        }
      }
      if (method === 'error' && isUsageLimitError(params.error)) {
        setUsageLimitBlocked(true);
        setRunning(false);
          useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
          useHtmlAgentEditorBridgeStore.getState().clearActivity();
          agentMutationOccurredRef.current = false;
        setError('O limite de uso desta conta foi atingido. Aguarde o reset informado ou troque de conta.');
        void loadRateLimits().catch(() => undefined);
      }
      if (method === 'account/rateLimits/updated') {
        void loadRateLimits().catch(() => undefined);
      }
      if (method === 'item/agentMessage/delta') {
        const itemId = string(params.itemId) || `assistant-${string(params.turnId)}`;
        const delta = string(params.delta);
        if (delta) upsertAssistantMessage(itemId, current => current + delta, true);
      }
      if (method === 'item/started') {
        const item = record(params.item);
        if (item.type === 'agentMessage') {
          const itemId = string(item.id) || `assistant-${string(params.turnId)}`;
          const startedText = agentMessageText(item);
          upsertAssistantMessage(itemId, current => startedText || current, true);
        }
      }
      if (method === 'item/completed') {
        const item = record(params.item);
        if (item.type === 'agentMessage') {
          const itemId = string(item.id) || `assistant-${string(params.turnId)}`;
          const completedText = agentMessageText(item);
          upsertAssistantMessage(itemId, current => completedText || current, false);
        }
      }
    });
    },
    [createBackend, loadRateLimits, upsertAssistantMessage],
  );

  useEffect(() => {
    if (!threadId || !runtimeReady || !account || licenseRequired) return;
    let stopped = false;
    let failures = 0;
    let timer: number | null = null;
    const controller = new AbortController();
    const poll = async () => {
      let delay = transport.remote ? 0 : runningRef.current ? 300 : 1200;
      try {
        const payload = record(await request('events', {
          body: { threadId, cursor: cursorRef.current },
          signal: controller.signal,
        }));
        if (stopped) return;
        processEvents(array(payload.events));
        processPending(array(payload.pending));
        const nextCursor = Number(payload.nextCursor);
        if (Number.isFinite(nextCursor)) cursorRef.current = Math.max(cursorRef.current, nextCursor);
        failures = 0;
      } catch (cause) {
        if (stopped) return;
        const failure = cause as AgentHttpError;
        if (transport.remote && (failure.status === 403 || failure.status === 401)) { stopped = true; return; }
        if (transport.remote && failure.code === 'agent_events_reset') {
          try {
            const snapshot = record(await request('rpc', {
              body: { method: 'thread/read', params: { threadId, includeTurns: true } },
              signal: controller.signal,
            }));
            if (stopped) return;
            setMessages(messagesFromThread(snapshot.thread));
            const latestTurn = array(record(snapshot.thread).turns).map(record).at(-1);
            const active = latestTurn?.status === 'inProgress';
            activeTurnIdRef.current = active ? string(latestTurn.id) : '';
            setRunning(active);
            if (!active) useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
            const resetCursor = Number(snapshot.kodetyEventCursor ?? record(failure.payload).nextCursor);
            if (!Number.isFinite(resetCursor) || resetCursor < 0) throw new Error('Não foi possível recuperar os eventos do Agent.');
            cursorRef.current = resetCursor;
            failures = 0;
          } catch (recoveryError) {
            if (stopped) return;
            failures += 1;
            setError(recoveryError instanceof Error ? recoveryError.message : 'Não foi possível recuperar a conversa do Agent.');
          }
        } else if (!isAgentSetupAborted(cause)) {
          failures += 1;
        }
        // Remote polls wait in Docker for up to 20s. A connection error backs off
        // without dropping the cursor or repeating a client-owned tool mutation.
        delay = transport.remote ? (failures ? Math.min(15_000, 1_000 * 2 ** Math.min(failures - 1, 4)) : 100) : delay;
      } finally {
        if (!stopped && !(transport.remote && controller.signal.aborted)) timer = window.setTimeout(() => void poll(), delay);
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [account, licenseRequired, processEvents, processPending, request, runtimeReady, threadId, transport]);

  const rateLimitReached = useMemo(() => usageLimitBlocked || rateLimits.some(rateLimitSnapshotReached), [rateLimits, usageLimitBlocked]);
  const rateLimitWindows = useMemo(
    () =>
      rateLimits.flatMap(snapshot =>
        [snapshot.primary, snapshot.secondary].flatMap((window, index) =>
          window
            ? [
                {
        id: `${snapshot.key}-${index}`,
        limitName: snapshot.limitName,
        window,
                },
              ]
            : [],
        ),
      ),
    [rateLimits],
  );

  useEffect(() => {
    if (!account || !rateLimitReached) return;
    const timer = window.setInterval(() => {
      void loadRateLimits().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [account, loadRateLimits, rateLimitReached]);

  const selectedModel = useMemo(() => models.find(candidate => candidate.model === model || candidate.id === model) || null, [model, models]);
  const activeThread = useMemo(() => threads.find(thread => thread.id === threadId) || null, [threadId, threads]);
  const activeThreadLabel = activeThread?.name || userFacingPrompt(activeThread?.preview) || 'Nova sessão';
  const effortOptions = useMemo(() => {
    const supported = selectedModel?.supportedReasoningEfforts?.map(option => string(option.reasoningEffort)).filter(Boolean) || [];
    return supported.length ? supported : createBackend ? [selectedModel?.defaultReasoningEffort].filter((value): value is string => Boolean(value)) : ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  }, [createBackend, selectedModel]);
  useEffect(() => {
    if (effortOptions.length && !effortOptions.includes(effort)) {
      setEffort(selectedModel?.defaultReasoningEffort || effortOptions[0] || DEFAULT_EFFORT);
    }
  }, [effort, effortOptions, selectedModel?.defaultReasoningEffort]);

  const serviceTierOptions = useMemo(() => {
    const advertised = (selectedModel?.serviceTiers || [])
      .map(tier => ({
        id: string(tier.id),
        name: string(tier.name),
        description: string(tier.description),
      }))
      .filter(tier => tier.id && !/^(?:default|standard)$/i.test(tier.id));
    if (
      !createBackend && !advertised.some(tier => tier.id === 'fast') &&
      /gpt-5\.[456]/i.test(`${selectedModel?.model || model} ${selectedModel?.displayName || ''}`)
    ) {
      advertised.push({
        id: 'fast',
        name: 'Rápido',
        description: 'Respostas até 1,5× mais rápidas com maior consumo de créditos.',
      });
    }
    const unique = new Map(advertised.map(tier => [tier.id, tier]));
    return [
      {
        id: '',
        name: 'Padrão',
        description: 'Velocidade e consumo padrão.',
        multiplier: '1×',
      },
      ...Array.from(unique.values()).map(tier => ({
        ...tier,
        name: tier.name || (tier.id === 'fast' ? 'Rápido' : tier.id),
        multiplier: tier.id === 'fast' ? '1,5×' : '',
      })),
    ];
  }, [createBackend, model, selectedModel]);
  useEffect(() => {
    if (!selectedModel || !serviceTier) return;
    if (!serviceTierOptions.some(option => option.id === serviceTier)) setServiceTier('');
  }, [selectedModel, serviceTier, serviceTierOptions]);

  const orderedSkills = useMemo(() => orderedAgentSkills(skills), [skills]);
  const visibleSkills = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase('pt-BR');
    if (!query) return orderedSkills;
    return orderedSkills.filter(skill =>
      `${skillLabel(skill)} ${skill.name} ${skill.shortDescription || ''} ${skill.interface?.shortDescription || ''}`
        .toLocaleLowerCase('pt-BR')
        .includes(query),
    );
  }, [orderedSkills, skillQuery]);
  const essentialSkillNames = useMemo(
    () => new Set(orderedSkills.filter(skill => isEssentialAgentSkill(skill.name)).map(skill => skill.name)),
    [orderedSkills],
  );
  const visibleEssentialSkills = visibleSkills.filter(skill => essentialSkillNames.has(skill.name));
  const visibleOtherSkills = visibleSkills.filter(skill => !essentialSkillNames.has(skill.name));
  const slashSkillMatch = capabilities.skills === false ? null : /(?:^|\s)\/([^\s/]*)$/.exec(input);
  const slashSkills = useMemo(() => {
    const query = slashSkillMatch?.[1]?.toLocaleLowerCase('pt-BR') || '';
    if (!slashSkillMatch) return [];
    return orderedSkills.filter(skill => `${skillLabel(skill)} ${skill.name}`.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 6);
  }, [orderedSkills, slashSkillMatch]);

  const selectedFigmaSkill = capabilities.figma !== false && selectedSkills.some(isFigmaSkill);
  const figmaDesignToCode = capabilities.figma !== false && selectedSkills.some(isFigmaDesignToCodeSkill);
  const figmaReferenceImages = attachments.filter(attachment => attachment.kind === 'image');
  const invalidFigmaDesignLink = figmaDesignToCode && Boolean(figmaDesignLink.trim()) && !parseFigmaDesignLink(figmaDesignLink);
  const hasComposerContent = Boolean(input.trim() || attachments.length || (figmaDesignToCode && figmaDesignLink.trim()));
  const figmaGate = selectedFigmaSkill && (!figma?.installed || !figma.connected);

  const sendMessage = useCallback(
    async (event?: FormEvent, launch?: AgentLaunchRequest) => {
    event?.preventDefault();
    const typedPrompt = (launch?.prompt ?? input).trim();
    const activeSkills = capabilitiesRef.current.skills === false ? [] : launch?.skills ?? selectedSkills;
    const selectedAttachments = launch || capabilitiesRef.current.attachments === false ? [] : attachments;
      const useFigmaReference = !launch && activeSkills.some(isFigmaDesignToCodeSkill);
      const referenceLink = useFigmaReference ? figmaDesignLink.trim() : '';
      if ((!typedPrompt && !selectedAttachments.length && !referenceLink) || attachmentsUploading || sending || running) return;
      if (referenceLink && !parseFigmaDesignLink(referenceLink)) {
        setError(FIGMA_DESIGN_LINK_ERROR);
        return;
      }
    if (rateLimitReached) {
      setError('O limite de uso desta conta foi atingido. Aguarde o reset informado ou troque de conta.');
      return;
    }
      const prompt = buildAgentComposerPrompt({
        text: typedPrompt,
        figmaDesignToCode: useFigmaReference,
        figmaLink: referenceLink,
        referenceImages: selectedAttachments.filter(attachment => attachment.kind === 'image').map(attachment => attachment.name),
      }) || 'Analise os anexos enviados e use-os como referência para esta tarefa.';
    const activeFigmaGate = activeSkills.some(isFigmaSkill) && (!figma?.installed || !figma.connected);
    if (activeFigmaGate) {
      setError('Conecte o Figma antes de enviar uma tarefa que usa uma skill Figma.');
      return;
    }
    setSending(true);
    setError('');
    setAgentProgress(null);
    messageAutoScrollRef.current = true;
    useHtmlAgentEditorBridgeStore.getState().clearActivity();
      agentMutationOccurredRef.current = false;
    let submittedThreadId = '';
    let turnSubmitted = false;
    try {
        const activeThreadId = threadId || (await startThread());
        submittedThreadId = activeThreadId;
      const context = editorAvailable
          ? await invokeHtmlAgentEditorTool(
              'kodety_editor_context',
              {},
              {
          requestId: `composer-${Date.now()}`,
          callId: `composer-${Date.now()}`,
          threadId: activeThreadId,
          turnId: '',
              },
            )
        : {};
      const target = elementReferenceFromContext(context);
      const localId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages(current => [
        ...current,
        {
          id: localId,
          role: 'user',
          text: prompt,
          ...(target ? { target } : {}),
          ...(selectedAttachments.length ? { attachments: selectedAttachments } : {}),
        },
      ]);
      setComposerMenuOpen(false);
      setSkillsOpen(false);
      setModelMenuOpen(false);
      setTurnStartedAt(Date.now());
      setTurnElapsedSeconds(0);
      setRunning(true);
        useHtmlAgentEditorBridgeStore
          .getState()
          .startTurnActivity(`pending-${localId}`, getAdminUiLocale().toLowerCase().startsWith('en') ? 'Agent is working' : 'Agente trabalhando');
      turnSubmitted = true;
      const turnResponse = record(await rpc('turn/start', {
        threadId: activeThreadId,
        prompt,
        context,
        skills: activeSkills,
        attachments: selectedAttachments.map(attachment => attachment.id),
        model,
        effort,
        serviceTier: serviceTier || null,
      }));
        if (!launch) {
          setInput('');
          setAttachments([]);
          setFigmaDesignLink('');
        }
      activeTurnIdRef.current = string(record(turnResponse.turn).id) || string(turnResponse.turnId);
        if (activeTurnIdRef.current) {
          useHtmlAgentEditorBridgeStore
            .getState()
            .startTurnActivity(
              activeTurnIdRef.current,
              getAdminUiLocale().toLowerCase().startsWith('en') ? 'Agent is working' : 'Agente trabalhando',
            );
        }
      window.setTimeout(() => {
        void rpc('thread/list', { limit: 30 })
            .then(response =>
              setThreads(
                array(record(response).data)
            .map(value => record(value) as unknown as AgentThread)
                  .filter(value => value.id),
              ),
            )
          .catch(() => undefined);
      }, 800);
    } catch (cause) {
      setRunning(false);
      useHtmlAgentEditorBridgeStore.getState().clearActivity();
        useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
        agentMutationOccurredRef.current = false;
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.');
      if (transport.remote && turnSubmitted && (cause as AgentHttpError).outcomeUnknown) {
        setError('A conexão caiu durante o envio. Confira a conversa antes de reenviar; a tarefa pode ter sido iniciada.');
        try {
          const snapshot = record(await rpc('thread/read', { threadId: submittedThreadId, includeTurns: true }));
          setMessages(messagesFromThread(snapshot.thread));
          const latestTurn = array(record(snapshot.thread).turns).map(record).at(-1);
          const active = latestTurn?.status === 'inProgress';
          activeTurnIdRef.current = active ? string(latestTurn.id) : '';
          setRunning(active);
          const snapshotCursor = Number(snapshot.kodetyEventCursor);
          if (Number.isFinite(snapshotCursor)) cursorRef.current = Math.max(cursorRef.current, snapshotCursor);
          if (active) {
            if (!launch) { setInput(''); setAttachments([]); setFigmaDesignLink(''); }
            useHtmlAgentEditorBridgeStore.getState().startTurnActivity(activeTurnIdRef.current, 'Agente trabalhando');
          }
        } catch {
          // The remote service may still be unavailable. Keep the uncertain-send
          // notice and the draft so the user can inspect the conversation later.
        }
      }
    } finally {
      setSending(false);
    }
    },
    [
      attachments,
      attachmentsUploading,
      editorAvailable,
      effort,
      figma,
      figmaDesignLink,
      input,
      licenseRequired,
      model,
      rateLimitReached,
      rpc,
      running,
      selectedSkills,
      sending,
      serviceTier,
      startThread,
      threadId,
      transport,
    ],
  );

  useEffect(() => {
    const handleAgentLaunch = (event: Event) => {
      const detail = (event as CustomEvent<OpenHtmlAgentPanelDetail>).detail || {};
      const prompt = detail.prompt?.trim() || '';
      if (!prompt) return;
      const requestedSkill = detail.skill?.trim() || '';
      const matchedSkill = skills.find(
        skill =>
          skill.name === requestedSkill ||
          (requestedSkill === 'kodety-performance' && isKodetyPerformanceSkill(skill.name)) ||
          (requestedSkill === 'kodety-languages' && isKodetyLanguagesSkill(skill.name)),
      );
      const launchSkills = matchedSkill ? [matchedSkill.name] : requestedSkill ? [requestedSkill] : selectedSkills;
      setSelectedSkills(launchSkills);
      setInput(prompt);
      setError('');
      setPendingAgentLaunch(detail.autoSubmit === true ? { prompt, skills: launchSkills } : null);
      window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
    };
    window.addEventListener(OPEN_HTML_AGENT_PANEL_EVENT, handleAgentLaunch);
    return () => window.removeEventListener(OPEN_HTML_AGENT_PANEL_EVENT, handleAgentLaunch);
  }, [selectedSkills, skills]);

  useEffect(() => {
    if (!pendingAgentLaunch || accountLoading || !runtimeReady || !account || licenseRequired) return;
    if (running || sending || attachmentsUploading) {
      setPendingAgentLaunch(null);
      setError('A análise de desempenho ficou pronta no campo. Finalize a tarefa atual e envie quando quiser.');
      return;
    }
    const launch = pendingAgentLaunch;
    setPendingAgentLaunch(null);
    setInput('');
    void sendMessage(undefined, launch);
  }, [account, accountLoading, attachmentsUploading, licenseRequired, pendingAgentLaunch, running, runtimeReady, sendMessage, sending]);

  const focusMessageTarget = useCallback(
    async (target: AgentElementReference) => {
    if (!editorAvailable || !target.pagePath || !target.path) return;
    const operationId = `message-target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setError('');
    try {
        await invokeHtmlAgentEditorTool(
          'kodety_focus_element',
          {
        pagePath: target.pagePath,
        selectionPath: target.path,
          },
          {
        requestId: operationId,
        callId: operationId,
        threadId,
        turnId: '',
          },
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível localizar o elemento no canvas.');
    }
    },
    [editorAvailable, threadId],
  );

  const interruptTurn = useCallback(async () => {
    if (!threadId) return;
    const activePrompt = promptRequests.find(request => string(request.params.turnId));
    const turnId = activeTurnIdRef.current || (activePrompt ? string(activePrompt.params.turnId) : '');
    if (!turnId) {
      setError('Aguarde o identificador do turno para interromper.');
      return;
    }
    try {
      await rpc('turn/interrupt', { threadId, turnId });
      activeTurnIdRef.current = '';
      setRunning(false);
      useHtmlAgentEditorBridgeStore.getState().clearActivity();
      useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
      agentMutationOccurredRef.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível interromper o turno.');
    }
  }, [promptRequests, rpc, threadId]);

  useEffect(() => {
    useHtmlAgentEditorBridgeStore.getState().clearActivity();
    agentMutationOccurredRef.current = false;
    return () => {
      useHtmlAgentEditorBridgeStore.getState().clearActivity();
      useHtmlAgentEditorBridgeStore.getState().finishTurnActivity();
      agentMutationOccurredRef.current = false;
    };
  }, [threadId]);

  const applySlashSkill = (skill: AgentSkill) => {
    if (!selectedSkills.includes(skill.name)) toggleSkill(skill.name);
    if (slashSkillMatch) setInput(current => current.replace(/\/[^\s/]*$/, ''));
    setSlashSkillIndex(0);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashSkillMatch && slashSkills.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setSlashSkillIndex(current => (current + direction + slashSkills.length) % slashSkills.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySlashSkill(slashSkills[Math.min(slashSkillIndex, slashSkills.length - 1)]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setInput(current => current.replace(/\/[^\s/]*$/, ''));
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const toggleSkill = (name: string) => {
    if (sending || running) return;
    setSelectedSkills(current => (current.includes(name) ? current.filter(candidate => candidate !== name) : [...current, name]));
  };

  const renderPrompt = (request: AgentPromptRequest) => {
    if (request.method === 'item/tool/requestUserInput') {
      const questions = array(request.params.questions).map(record);
      const answers = promptAnswers[request.requestId] || {};
      const complete = questions.every(question => answers[string(question.id)]?.trim());
      return (
        <div key={request.requestId} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <p className="text-[10px] font-medium text-foreground">O agente precisa de uma escolha</p>
          <div className="mt-2 space-y-3">
            {questions.map(question => {
              const id = string(question.id);
              const options = array(question.options).map(record);
              return (
                <div key={id}>
                  <p className="text-[10px] leading-4 text-muted-foreground">{string(question.question)}</p>
                  {options.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {options.map(option => {
                        const label = string(option.label);
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              setPromptAnswers(current => ({
                              ...current,
                                [request.requestId]: {
                                  ...(current[request.requestId] || {}),
                                  [id]: label,
                                },
                              }))
                            }
                            className={cn(
                              'rounded-md border px-2 py-1 text-[9px]',
                              answers[id] === label
                                ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]'
                                : 'border-white/10 text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      value={answers[id] || ''}
                      onChange={event =>
                        setPromptAnswers(current => ({
                        ...current,
                          [request.requestId]: {
                            ...(current[request.requestId] || {}),
                            [id]: event.target.value,
                          },
                        }))
                      }
                      className="mt-1.5 h-7 w-full rounded-md border border-white/10 bg-transparent px-2 text-[10px] outline-none focus:border-[var(--kodety-focus)]/50"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => void respondToPrompt(request.requestId, { answers: {} })}>
              Cancelar
            </Button>
            <Button
              size="xs"
              disabled={!complete}
              onClick={() =>
                void respondToPrompt(request.requestId, {
                answers: Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answers: [answer] }])),
                })
              }
            >
              Continuar
            </Button>
          </div>
        </div>
      );
    }
    if (request.method === 'item/permissions/requestApproval') {
      return (
        <div key={request.requestId} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-3">
          <p className="text-[10px] font-medium text-amber-200">Permissão fora do editor bloqueada</p>
          <p className="mt-1 break-words text-[9px] leading-4 text-muted-foreground">
            O Agent só pode editar pelo estado canônico do Kodety e usar a conexão oficial do Figma.
          </p>
          <div className="mt-2 flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void respondToPrompt(request.requestId, {
                  permissions: {},
                  scope: 'turn',
                })
              }
            >
              Fechar e recusar
            </Button>
          </div>
        </div>
      );
    }
    if (request.method.includes('requestApproval')) {
      const command = string(request.params.command);
      const reason = string(request.params.reason);
      return (
        <div key={request.requestId} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-3">
          <p className="text-[10px] font-medium text-amber-200">Ação externa bloqueada</p>
          <p className="mt-1 break-words text-[9px] leading-4 text-muted-foreground">
            {reason || command || 'O Agent só pode alterar o projeto pelas ferramentas nativas do Kodety.'}
          </p>
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="ghost" onClick={() => void respondToPrompt(request.requestId, { decision: 'decline' })}>
              Fechar e recusar
            </Button>
          </div>
        </div>
      );
    }
    if (request.method === 'mcpServer/elicitation/request') {
      const mode = string(request.params.mode);
      const connectUrl = mode === 'url' ? officialConnectionUrl(request.params.url) : '';
      return (
        <div key={request.requestId} className="rounded-xl border border-violet-400/20 bg-violet-400/[0.055] p-3">
          <p className="text-[10px] font-medium text-violet-200">Conexão solicitada</p>
          <p className="mt-1 break-words text-[9px] leading-4 text-muted-foreground">
            {string(request.params.message) || 'O agente precisa reconectar uma integração para continuar.'}
          </p>
          {!connectUrl && mode === 'url' && (
            <p className="mt-1.5 text-[9px] leading-4 text-red-300">A URL recebida não pertence a um domínio oficial permitido.</p>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void respondToPrompt(request.requestId, {
                  action: 'cancel',
                  content: null,
                })
              }
            >
              Cancelar
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void respondToPrompt(request.requestId, {
                  action: 'decline',
                  content: null,
                })
              }
            >
              Recusar
            </Button>
            {connectUrl && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  window.open(connectUrl, '_blank', 'noopener,noreferrer');
                  pollFigmaConnection();
                  void respondToPrompt(request.requestId, {
                    action: 'accept',
                    content: {},
                  });
                }}
              >
                <ExternalLink /> Conectar
              </Button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div key={request.requestId} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
        <p className="text-[10px] text-muted-foreground">O agente aguarda uma confirmação externa.</p>
        <div className="mt-2 flex justify-end">
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              void respondToPrompt(request.requestId, {
                action: 'decline',
                content: null,
              })
            }
          >
            Recusar
          </Button>
        </div>
      </div>
    );
  };

  const renderToolApproval = (approval: AgentToolApprovalRequest) => {
    const replacesPage = approval.changeTypes.includes('replacePageSource');
    const deletesCms = approval.changeTypes.includes('deleteCmsItem');
    const detachesInstance = approval.changeTypes.includes('detachComponentInstance');
    const deletesVariant = approval.changeTypes.includes('deleteComponentVariant');
    const deletesComponent = approval.changeTypes.includes('deleteComponent');
    const removesCodeComponentInstance = approval.changeTypes.includes('removeInstance');
    const removesCodeComponentSource = approval.changeTypes.includes('removeSource');
    const componentChange = detachesInstance || deletesVariant || deletesComponent || removesCodeComponentInstance || removesCodeComponentSource;
    const sensitiveDescription = [
      ...(replacesPage ? ['substituir o código completo de uma página'] : []),
      ...(deletesCms ? ['excluir conteúdo do CMS'] : []),
      ...(detachesInstance ? ['desvincular uma instância de componente'] : []),
      ...(deletesVariant ? ['excluir uma variante de componente'] : []),
      ...(deletesComponent ? ['excluir um componente e destacar suas instâncias'] : []),
      ...(removesCodeComponentInstance ? ['remover uma instância de Code Component'] : []),
      ...(removesCodeComponentSource ? ['excluir o arquivo-fonte de um Code Component'] : []),
    ];
    return (
      <div key={approval.requestId} className="rounded-xl border border-red-400/25 bg-red-400/[0.055] p-3">
        <p className="text-[10px] font-medium text-red-200">Confirmar alteração sensível</p>
        <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
          {`O agente quer ${sensitiveDescription.join(' e ')}.`}
          {(replacesPage || componentChange) && ' Revise o resumo antes de continuar; o histórico do Builder preserva as alterações de projeto.'}
          {deletesCms && ' Exclusões do CMS não são desfeitas pelo histórico do canvas.'}
        </p>
        {approval.summary && <p className="mt-1.5 break-words text-[9px] text-foreground/80">{approval.summary}</p>}
        <div className="mt-2 flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => resolveToolApproval(approval, false)}>
            Recusar
          </Button>
          <Button size="xs" variant="destructive" onClick={() => resolveToolApproval(approval, true)}>
            Confirmar alteração
          </Button>
        </div>
      </div>
    );
  };

  const renderSkillChoice = (skill: AgentSkill) => {
    const checked = selectedSkills.includes(skill.name);
    const figmaSkill = isFigmaSkill(skill.name);
    const essentialSkill = isEssentialAgentSkill(skill.name);
    return (
      <button
        key={skill.name}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={sending || running}
        onClick={() => toggleSkill(skill.name)}
        className="group flex w-full items-start gap-2.5 rounded-[10px] px-2 py-2 text-left outline-none transition-colors hover:bg-white/[0.055] focus-visible:bg-white/[0.055]"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
            checked
              ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/14 text-[var(--kodety-accent-hover)] shadow-[0_0_0_2px_rgb(147_147_255/.08)]'
              : 'border-white/[0.15] bg-white/[0.035] group-hover:border-white/25',
          )}
        >
          {checked && <Check className="size-2.5" strokeWidth={2.5} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[10px] font-medium text-foreground/90">{skillLabel(skill)}</span>
            {essentialSkill && (
              <span className="shrink-0 rounded-full bg-white/[0.055] px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Essencial
              </span>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[8px] leading-3 text-muted-foreground">
            {skill.interface?.shortDescription || skill.shortDescription || skill.description || skill.name}
          </span>
          {figmaSkill && figma?.connected && (
            <span className="mt-1 flex items-center gap-1 text-[8px] text-emerald-300/85">
              <CheckCircle2 className="size-2.5" /> Figma conectado
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <section data-kodety-onboarding="agent-panel" aria-label="Agente" aria-hidden={!visible} className={cn('flex h-full min-h-0 flex-col bg-transparent', !visible && 'hidden')}>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-y border-white/[0.055] p-2">
        <Popover open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-kodety-onboarding="agent-session"
              aria-label="Sessão do agente"
              aria-expanded={sessionMenuOpen}
              disabled={running || sending || (!account && !licenseRequired)}
              className="flex h-9 min-w-0 flex-1 items-center justify-between gap-3 rounded-[11px] bg-white/[0.055] px-3 text-left text-[10px] font-medium text-foreground/90 outline-none transition-colors hover:bg-white/[0.075] focus-visible:ring-1 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="truncate">{activeThreadLabel}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={6}
            className="w-[var(--radix-popover-trigger-width)] min-w-[220px] rounded-[14px] border-white/[0.08] bg-[#242424] p-1.5 shadow-[0_18px_55px_rgba(0,0,0,.5)]"
          >
            <button
              type="button"
              onClick={() => {
                setSessionMenuOpen(false);
                void openThread('');
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[10px] outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07]',
                !threadId && 'bg-white/[0.065] text-foreground',
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-white/[0.06] text-muted-foreground">
                <Plus className="size-3" />
              </span>
              <span className="truncate font-medium">Nova sessão</span>
              {!threadId && <Check className="ml-auto size-3.5 text-foreground/70" />}
            </button>
            {threads.length > 0 && <div className="mx-2 my-1 h-px bg-white/[0.07]" />}
            <div className="max-h-64 overflow-y-auto">
              {threads.map(thread => {
                const label = thread.name || userFacingPrompt(thread.preview) || 'Sessão sem título';
                const selected = thread.id === threadId;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setSessionMenuOpen(false);
                      void openThread(thread.id);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[10px] outline-none transition-colors hover:bg-white/[0.07] focus-visible:bg-white/[0.07]',
                      selected && 'bg-white/[0.065] text-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {selected && <Check className="size-3.5 shrink-0 text-foreground/70" />}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label="Nova sessão"
          disabled={running || sending || (!account && !licenseRequired)}
          onClick={() => {
            if (licenseRequired) return;
            void startThread().catch(cause => setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sessão.'));
          }}
          className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-white/[0.055] text-muted-foreground outline-none transition-colors hover:bg-white/[0.085] hover:text-foreground focus-visible:ring-1 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div
        ref={messageListRef}
        onScroll={event => {
          const list = event.currentTarget;
          messageAutoScrollRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= 72;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {historyWarning && <p role="status" className="mb-3 rounded-lg border border-amber-400/15 bg-amber-400/[.04] px-3 py-2 text-[10px] leading-4 text-muted-foreground">{historyWarning}</p>}
        {!account ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-2 text-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="mb-4 size-6 fill-white/90">
              <path d="M22.282 9.821a6 6 0 0 0-.516-4.91 6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9 6.05 6.05 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206 6 6 0 0 0 3.997-2.9 6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023-.141-.085-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
            </svg>
            <p className="text-xs font-medium tracking-[-0.01em]">
              {runtimeBlockedByHosting ? 'Escolha como conectar o Agent' : 'Conectar conta OpenAI'}
            </p>
            <p className="mt-1.5 max-w-60 text-[10px] leading-[1.55] text-muted-foreground">
              {runtimeBlockedByHosting
                ? host?.execution
                  ? 'Esta hospedagem não pôde iniciar o Agent. Você pode executá-lo no navegador.'
                  : transportOptions.canChange
                  ? 'O Agent local não pôde iniciar. Conecte um cliente de IA via MCP.'
                  : browserStudio
                  ? 'O Agent local exige um processo de servidor; neste ambiente, a conexão acontece pela ponte MCP.'
                  : 'Confira o motivo abaixo e conecte um cliente de IA via MCP, se disponível.'
                : runtimeReady
                ? 'Conecte sua conta e configure as skills em Settings → Agentes.'
                  : transportOptions.selected === 'remote'
                    ? 'Abra as configurações para conectar sua conta OpenAI.'
                    : 'O Agent precisa ser preparado antes de conectar sua conta.'}
            </p>
            <HtmlAgentRuntimeStatus
              className="mt-4 w-full max-w-72"
              progress={runtimeProgress}
              diagnostic={runtimeDiagnostic}
              active={accountLoading}
              browserStudio={browserStudio}
              transport={runtimeTransport}
              onUseBrowser={runtimeBlockedByHosting && host?.execution?.selected === 'server' && !editorReadOnly ? () => void host.execution?.select('browser') : undefined}
              cloudBusy={accountLoading || host?.execution?.changing}
              onUseMcp={useMcpFallback ? openMcpSettings : undefined}
              onConfigure={openHostSettings || accountRecoveryHref ? openAccountRecovery : undefined}
            />
            {!useMcpFallback && (
            <button
              type="button"
              className="mt-5 inline-flex h-8 items-center justify-center rounded-[8px] border border-white/[0.1] bg-white/[0.075] px-4 text-[10px] font-medium text-foreground/90 outline-none transition-colors hover:bg-white/[0.11] hover:text-foreground focus-visible:ring-1 focus-visible:ring-white/20 disabled:cursor-wait disabled:opacity-45"
              onClick={openAccountSettings}
            >
              Conectar conta OpenAI
            </button>
            )}
            {runtimeReady && error && <p className="mt-3 text-[9px] leading-4 text-red-300">{error}</p>}
          </div>
        ) : (
          <>
            {!editorAvailable && (
              <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.055] px-2.5 py-2 text-[9px] leading-4 text-amber-100/80">
                O chat está conectado, mas o editor ainda não publicou seus callbacks.
              </div>
            )}
            {rateLimitReached && (
              <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3" role="alert">
                <div className="flex items-center gap-2 text-[10px] font-medium text-amber-100">
                  <RefreshCw className="size-3.5" /> Limite da conta atingido
                </div>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  O App Server informou que esta conta não pode iniciar outra tarefa agora. Você pode aguardar o reset abaixo ou trocar de conta.
                </p>
                {rateLimitWindows.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {rateLimitWindows.map(item => (
                      <div key={item.id} className="rounded-lg bg-black/10 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2 text-[9px]">
                          <span className="font-medium text-foreground/85">{rateLimitWindowLabel(item.window)}</span>
                          <span className="text-muted-foreground">{Math.round(item.window.usedPercent)}% utilizado</span>
                        </div>
                        <p className="mt-0.5 text-[8px] text-muted-foreground">{rateLimitResetLabel(item.window.resetsAt)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[8px] leading-3 text-muted-foreground">A conta não informou a duração nem o horário desta janela.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="xs" variant="secondary" onClick={openAccountSettings}>
                    <LogIn /> Trocar conta
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void loadRateLimits().catch(() => undefined)}>
                    <RefreshCw /> Atualizar limite
                  </Button>
                </div>
              </div>
            )}
            {capabilities.figma !== false && figma && (!figma.installed || (!figma.connected && figma.connectUrl)) && !figmaGate && (
              <div className="mb-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.045] p-3">
                <div className="flex items-center gap-2 text-[10px] font-medium text-violet-200">
                  <Link2 className="size-3.5" /> Figma oficial
                </div>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  {figma.installed
                    ? 'Conecte sua conta para usar Figma e Kodety na mesma tarefa. O chat continua disponível sem ela.'
                    : 'Instale a integração para usar Figma e Kodety na mesma tarefa. O chat continua disponível sem ela.'}
                </p>
                {figmaInstallConfirmation ? (
                  <div className="mt-2 rounded-lg border border-violet-300/20 bg-black/10 p-2">
                    <p className="text-[9px] leading-4 text-violet-100/85">Confirme a instalação do plugin oficial do Figma.</p>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="xs" variant="ghost" onClick={() => setFigmaInstallConfirmation(false)}>
                        Cancelar
                      </Button>
                      <Button size="xs" variant="secondary" disabled={figmaBusy} onClick={() => void installFigma(true)}>
                        {figmaBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar instalação
                      </Button>
                    </div>
                  </div>
                ) : !figma.installed ? (
                  <Button className="mt-2" size="xs" variant="secondary" disabled={figmaBusy} onClick={() => void installFigma()}>
                    {figmaBusy ? <Loader2 className="animate-spin" /> : <Plus />} Instalar Figma oficial
                  </Button>
                ) : (
                  <Button className="mt-2" size="xs" variant="secondary" onClick={connectFigma}>
                    <ExternalLink /> Conectar Figma
                  </Button>
                )}
              </div>
            )}
            {figmaGate && (
              <div className="mb-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-3">
                <div className="flex items-center gap-2 text-[10px] font-medium text-violet-200">
                  <Link2 className="size-3.5" /> Figma necessário para esta tarefa
                </div>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  A skill Figma está selecionada, mas a integração oficial ainda não está pronta.
                </p>
                {figmaInstallConfirmation ? (
                  <div className="mt-2 rounded-lg border border-violet-300/20 bg-black/10 p-2">
                    <p className="text-[9px] leading-4 text-violet-100/85">O plugin oficial do Figma exige sua confirmação antes da instalação.</p>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="xs" variant="ghost" onClick={() => setFigmaInstallConfirmation(false)}>
                        Cancelar
                      </Button>
                      <Button size="xs" variant="secondary" disabled={figmaBusy} onClick={() => void installFigma(true)}>
                        {figmaBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar instalação
                      </Button>
                    </div>
                  </div>
                ) : !figma?.installed ? (
                  <Button className="mt-2" size="xs" variant="secondary" disabled={figmaBusy} onClick={() => void installFigma()}>
                    {figmaBusy ? <Loader2 className="animate-spin" /> : <Plus />} Instalar Figma oficial
                  </Button>
                ) : figma.connectUrl ? (
                  <Button className="mt-2" size="xs" variant="secondary" onClick={connectFigma}>
                    <ExternalLink /> Conectar Figma
                  </Button>
                ) : (
                  <Button className="mt-2" size="xs" variant="secondary" onClick={() => void loadFigmaStatus()}>
                    <RefreshCw /> Atualizar Figma
                  </Button>
                )}
              </div>
            )}
            {!messages.length && !running ? (
              <div className="flex min-h-[52%] flex-col items-center justify-center px-5 text-center">
                <p className="text-xs font-medium">O que vamos construir?</p>
                <p className="mt-1 max-w-56 text-[10px] leading-4 text-muted-foreground">
                  Peça mudanças, selecione uma seção no canvas ou gere conteúdo. O agente já sabe que está dentro do Kodety.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {turnElapsedSeconds !== null && !running && (
                  <p className="text-[9px] font-medium text-muted-foreground">Pensou {turnElapsedSeconds}s</p>
                )}
                {messages.map(message =>
                  message.role === 'user' ? (
                  <div key={message.id} className="rounded-[14px] bg-white/[0.055] px-3 py-2.5">
                    <div className="text-[9px] font-medium text-muted-foreground">Você</div>
                    {message.target && (
                      <button
                        type="button"
                        onClick={() => void focusMessageTarget(message.target!)}
                        disabled={!editorAvailable || !message.target.pagePath}
                        aria-label={`Focar elemento ${message.target.identifier} no canvas`}
                        title={`Elemento selecionado: ${message.target.label} · ${message.target.identifier}`}
                        className="mt-1.5 flex h-6 max-w-full items-center gap-1.5 rounded-[7px] bg-white/[0.055] px-2 text-left text-[9px] text-muted-foreground outline-none transition-colors hover:bg-white/[0.085] hover:text-foreground/85 focus-visible:ring-1 focus-visible:ring-white/20 disabled:cursor-default disabled:opacity-70"
                      >
                        <MousePointer2 className="size-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{message.target.label}</span>
                        <span className="max-w-[58%] shrink-0 truncate font-mono text-foreground/75" title={message.target.identifier}>
                          {message.target.identifier}
                        </span>
                      </button>
                    )}
                    {!!message.attachments?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {message.attachments.map(attachment => (
                          <div
                            key={attachment.id}
                            title={`${attachment.name} · ${attachmentSizeLabel(attachment.size)}`}
                            className="flex min-w-0 max-w-full items-center gap-2 rounded-[9px] bg-white/[0.055] p-1.5 pr-2"
                          >
                            {attachment.kind === 'image' && attachment.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={attachment.previewUrl} alt="" className="size-8 shrink-0 rounded-[6px] object-cover" />
                            ) : (
                              <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-white/[0.06] text-muted-foreground">
                                {attachment.kind === 'image' ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block max-w-40 truncate text-[9px] text-foreground/85">{attachment.name}</span>
                              <span className="block text-[8px] text-muted-foreground">{attachmentSizeLabel(attachment.size)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                      <p
                        className={cn(
                          'whitespace-pre-wrap break-words text-[11px] leading-[1.55] text-foreground/90',
                          message.target || message.attachments?.length ? 'mt-2' : 'mt-1',
                        )}
                      >
                      {message.text}
                    </p>
                  </div>
                ) : (
                  <div key={message.id}>
                      {message.text ? <HtmlAgentMarkdown text={message.text} /> : message.streaming ? <HtmlAgentThinkingOrb /> : null}
                      {message.streaming && message.text && <span className="mt-1.5 block size-1 animate-pulse rounded-full bg-foreground/45" />}
                  </div>
                  ),
                )}
                {toolApprovalRequests.map(renderToolApproval)}
                {promptRequests.map(renderPrompt)}
                {running && !messages.some(message => message.streaming) && <HtmlAgentThinkingOrb />}
              </div>
            )}
            {error && <p className="mt-3 rounded-lg bg-red-500/[0.07] px-2.5 py-2 text-[9px] leading-4 text-red-300">{error}</p>}
          </>
        )}
      </div>

      {((account && runtimeReady) || licenseRequired) && (
        <>
        {agentProgress && <HtmlAgentProgress progress={agentProgress} />}
        <form
          onSubmit={sendMessage}
          onDragEnter={event => {
            if (capabilities.attachments !== false && !licenseRequired && event.dataTransfer.types.includes('Files')) setAttachmentDragActive(true);
          }}
          onDragOver={event => {
            if (capabilities.attachments === false || licenseRequired || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setAttachmentDragActive(true);
          }}
          onDragLeave={() => setAttachmentDragActive(false)}
          onDrop={handleAttachmentDrop}
            onPaste={handleAttachmentPaste}
          className={composerStyles.wrap}
        >
            {capabilities.attachments !== false && <input ref={attachmentInputRef} type="file" accept={AGENT_ATTACHMENT_ACCEPT} multiple hidden onChange={handleAttachmentChange} />}
            <div className={composerStyles.frame} data-dragging={attachmentDragActive || undefined} data-figma={figmaDesignToCode || undefined}>
              {attachmentDragActive && <div className={composerStyles.dropOverlay}>Solte para anexar ao Codex</div>}

              <div className={composerStyles.chips}>
                {capabilities.skills !== false && selectedSkills.map(name => {
                  const skill = orderedSkills.find(candidate => candidate.name === name);
                  return (
                    <span key={name} className={composerStyles.skillPill} title={name}>
                      <span className={composerStyles.skillPillLabel}>/{skill ? skillLabel(skill) : name}</span>
                      <button
                        type="button"
                        className={composerStyles.chipRemove}
                        aria-label={`Remover skill ${skill ? skillLabel(skill) : name}`}
                        onClick={() => toggleSkill(name)}
                        disabled={sending || running}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
                {capabilities.skills !== false && <Popover
                  open={skillsOpen}
                  onOpenChange={open => {
                    setSkillsOpen(open);
                    if (!open) setSkillQuery('');
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={composerStyles.skillAdd}
                      aria-label="Adicionar skills"
                      title="Adicionar skills"
                      aria-expanded={skillsOpen}
                      disabled={sending || running}
                    >
                      <Plus size={13} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={8}
                    collisionPadding={16}
                    className="w-[min(286px,calc(100vw-32px))] rounded-[16px] border-white/[0.09] bg-[#252525] p-2 shadow-[0_22px_70px_rgba(0,0,0,.56)]"
                  >
                    <div className="px-1 pb-2 pt-0.5">
                      <p className="text-[10px] font-medium text-foreground/90">Skills desta tarefa</p>
                      <p className="mt-0.5 text-[8px] leading-3 text-muted-foreground">Combine várias capacidades no mesmo turno.</p>
                    </div>
                    <div className="flex h-8 items-center gap-2 rounded-[10px] bg-white/[0.055] px-2.5">
                      <Search className="size-3 shrink-0 text-muted-foreground" />
                      <input
                        type="search"
                        value={skillQuery}
                        onChange={event => setSkillQuery(event.target.value)}
                        placeholder="Pesquisar skill…"
                        aria-label="Pesquisar skills"
                        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[9px] text-foreground/90 outline-none placeholder:text-muted-foreground/75 focus:ring-0"
                      />
                    </div>
                    <div className="mt-2 max-h-[330px] overflow-y-auto">
                      {visibleEssentialSkills.length > 0 && (
                        <div>
                          <div className="px-2 pb-1 pt-0.5 text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            Essenciais
                          </div>
                          {visibleEssentialSkills.map(renderSkillChoice)}
                        </div>
                      )}
                      {visibleOtherSkills.length > 0 && (
                        <div className={cn(visibleEssentialSkills.length > 0 && 'mt-1 border-t border-white/[0.07] pt-1.5')}>
                          <div className="px-2 pb-1 pt-0.5 text-[8px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            Outras skills
                          </div>
                          {visibleOtherSkills.map(renderSkillChoice)}
                        </div>
                      )}
                      {!visibleSkills.length && <p className="px-2 py-5 text-center text-[9px] text-muted-foreground">Nenhuma skill encontrada.</p>}
                    </div>
                  </PopoverContent>
                </Popover>}
                {attachments
                  .filter(attachment => !figmaDesignToCode || attachment.kind !== 'image')
                  .map(attachment => (
                  <span key={attachment.id} className={composerStyles.chip} title={`${attachment.name} · ${attachmentSizeLabel(attachment.size)}`}>
                    <span className={composerStyles.chipIcon}>
                      {attachment.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
                    </span>
                    <span className={composerStyles.chipName}>{attachment.name}</span>
                    <button
                      type="button"
                      className={composerStyles.chipRemove}
                      aria-label={`Remover ${attachment.name}`}
                      onClick={() => removeAttachment(attachment)}
                      disabled={sending || running}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {attachmentsUploading && !figmaDesignToCode && (
                  <span className={composerStyles.uploading}>
                    <Loader2 size={12} /> Preparando anexo…
                  </span>
                )}
              </div>

              {figmaDesignToCode && (
                <HtmlAgentFigmaReference
                  link={figmaDesignLink}
                  onLinkChange={setFigmaDesignLink}
                  images={figmaReferenceImages}
                  onAddImages={() => {
                    if (attachmentInputRef.current) attachmentInputRef.current.accept = 'image/png,image/jpeg,image/webp,image/gif';
                    attachmentInputRef.current?.click();
                  }}
                  onDropImages={files => {
                    setAttachmentDragActive(false);
                    const images = files.filter(file => file.type.startsWith('image/'));
                    if (!images.length) setError('Adicione uma imagem como print de referência.');
                    else void addAttachmentFiles(images);
                  }}
                  onRemoveImage={image => {
                    const attachment = attachments.find(candidate => candidate.id === image.id);
                    if (attachment) removeAttachment(attachment);
                  }}
                  disabled={licenseRequired || sending || running || rateLimitReached}
                  uploading={attachmentsUploading}
                  canAddImages={attachments.length < MAX_AGENT_ATTACHMENTS}
                />
            )}

              <div className={cn(composerStyles.editorWrap, figmaDesignToCode && composerStyles.complementaryInput)}>
                {figmaDesignToCode && (
                  <div className={composerStyles.referenceLabel}>
                    <span>Instruções complementares</span>
                    <span className={composerStyles.referenceMeta}>Opcional</span>
                  </div>
                )}
              <textarea
                ref={composerTextareaRef}
                value={input}
                rows={1}
                onChange={event => {
                  setInput(event.target.value);
                  setSlashSkillIndex(0);
                }}
                onKeyDown={handleComposerKeyDown}
                  placeholder={
                    rateLimitReached
                      ? 'Aguarde o reset ou troque de conta…'
                      : figmaDesignToCode
                        ? 'Comportamento, responsividade, detalhes…'
                        : 'Peça uma alteração ou envie uma referência…'
                  }
                data-kodety-onboarding="agent-message"
                aria-label="Mensagem para o Codex"
                  disabled={licenseRequired || sending || rateLimitReached}
                className={composerStyles.field}
              />
              {slashSkillMatch && (
                <div className={composerStyles.slashMenu} role="listbox" aria-label="Skills">
                  <div className={composerStyles.menuLabel}>Skills</div>
                    {slashSkills.length ? (
                      slashSkills.map((skill, index) => (
                    <button
                      key={skill.name}
                      type="button"
                      role="option"
                      aria-selected={index === slashSkillIndex}
                      className={cn(composerStyles.menuItem, index === slashSkillIndex && composerStyles.menuItemActive)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => applySlashSkill(skill)}
                    >
                      <span className={composerStyles.menuName}>{skillLabel(skill)}</span>
                      {selectedSkills.includes(skill.name) && <Check size={13} />}
                    </button>
                      ))
                    ) : (
                      <div className={composerStyles.menuEmpty}>Nenhuma skill encontrada</div>
                    )}
                </div>
              )}
            </div>

            <div className={composerStyles.row}>
              <div className={composerStyles.leftActions}>
                {(capabilities.attachments !== false || capabilities.skills !== false) && <Popover open={composerMenuOpen} onOpenChange={setComposerMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(composerStyles.iconBtn, composerStyles.plus)}
                      data-open={composerMenuOpen || undefined}
                      data-kodety-onboarding="agent-references"
                      aria-label="Adicionar imagem, arquivo ou skill"
                      aria-expanded={composerMenuOpen}
                      disabled={running || sending || attachmentsUploading || rateLimitReached}
                    >
                        <span className={composerStyles.plusIcon}>
                          <Plus size={14} />
                        </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" sideOffset={6} className={composerStyles.actionMenu}>
                    {capabilities.attachments !== false && <>
                    <button
                      type="button"
                      className={composerStyles.menuItem}
                      disabled={licenseRequired}
                      
                      onClick={() => {
                        if (attachmentInputRef.current) attachmentInputRef.current.accept = 'image/*';
                        attachmentInputRef.current?.click();
                        setComposerMenuOpen(false);
                      }}
                    >
                      <ImageIcon size={14} /> <span className={composerStyles.menuName}>Adicionar imagens</span>
                    </button>
                    <button
                      type="button"
                      className={composerStyles.menuItem}
                      disabled={licenseRequired}
                      title={AGENT_ATTACHMENT_TITLE}
                      onClick={() => {
                        if (attachmentInputRef.current) attachmentInputRef.current.accept = AGENT_ATTACHMENT_ACCEPT;
                        attachmentInputRef.current?.click();
                        setComposerMenuOpen(false);
                      }}
                    >
                      <FilePlus2 size={14} /> <span className={composerStyles.menuName}>Anexar arquivos</span>
                    </button>
                    </>}
                    {capabilities.skills !== false && <>
                    {capabilities.attachments !== false && <div className={composerStyles.menuDivider} />}
                    <button
                      type="button"
                      className={composerStyles.menuItem}
                      onClick={() => {
                        setComposerMenuOpen(false);
                        setSkillsOpen(true);
                      }}
                    >
                      <Sparkles size={14} /> <span className={composerStyles.menuName}>Skills</span>
                      <ChevronRight size={13} />
                    </button>
                    </>}
                  </PopoverContent>
                </Popover>}

              <Popover
                open={modelMenuOpen}
                onOpenChange={open => {
                  setModelMenuOpen(open);
                  if (open && !licenseRequired) void loadRateLimits().catch(() => undefined);
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-kodety-onboarding="agent-model"
                    aria-label="Selecionar modelo"
                    aria-expanded={modelMenuOpen}
                    disabled={running || sending}
                    className={composerStyles.modelButton}
                  >
                    <span className="truncate">{selectedModel?.displayName || (createBackend ? 'Modelo indisponível' : codexModelLabel(model))}</span>
                    <ChevronDown className="size-3 shrink-0" />
                  </button>
                </PopoverTrigger>
                    <PopoverContent side="top" align="start" sideOffset={6} className={composerStyles.modelMenu}>
                  <div className={composerStyles.menuLabel}>Modelo</div>
                  {models.map(candidate => {
                    const checked = candidate.model === model || candidate.id === model;
                    return (
                      <div
                        key={candidate.id}
                        className={composerStyles.modelOptionWrap}
                        onMouseEnter={() => setHoveredModel(candidate.id)}
                        onMouseLeave={() => setHoveredModel('')}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={checked}
                          onClick={() => {
                            setModel(candidate.model);
                            setModelMenuOpen(false);
                          }}
                          className={composerStyles.menuItem}
                        >
                              <span className={composerStyles.modelMark}>
                                <Sparkles size={12} />
                              </span>
                          <span className={composerStyles.menuName}>{candidate.displayName}</span>
                          {checked && <Check size={14} />}
                        </button>
                        {hoveredModel === candidate.id && candidate.description && (
                          <div className={composerStyles.modelInfo} role="tooltip">
                            <div className={composerStyles.modelInfoTitle}>{candidate.displayName}</div>
                            <p className={composerStyles.modelInfoText}>{candidate.description}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className={composerStyles.menuDivider} />
                  <div className={composerStyles.menuLabel}>Esforço</div>
                  {effortOptions.map(option => {
                    const checked = effort === option;
                    const isDefault = selectedModel?.defaultReasoningEffort === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="menuitemradio"
                        aria-checked={checked}
                        aria-label={`Esforço ${effortLabel(option)}`}
                        onClick={() => {
                          setEffort(option);
                          setModelMenuOpen(false);
                        }}
                        className={composerStyles.menuItem}
                      >
                        <span className={composerStyles.menuCheck}>{checked && <Check size={14} />}</span>
                        <span className={composerStyles.menuName}>{effortLabel(option)}</span>
                        {isDefault && <span className={composerStyles.menuMeta}>Padrão</span>}
                      </button>
                    );
                  })}
                  <div className={composerStyles.menuDivider} />
                  <div className={composerStyles.usageHeader}>
                    <span>Uso restante</span>
                    <button
                      type="button"
                      aria-label="Atualizar uso restante"
                      className={composerStyles.usageRefresh}
                      disabled={licenseRequired || rateLimitStatus === 'loading'}
                      onClick={() => void loadRateLimits().catch(() => undefined)}
                    >
                          {rateLimitStatus === 'loading' ? <Loader2 className={composerStyles.usageSpinner} size={11} /> : <RefreshCw size={11} />}
                    </button>
                  </div>
                  {rateLimitWindows.length > 0 ? (
                      <div className={composerStyles.usageRows}>
                        {rateLimitWindows.map(item => {
                          const remaining = Math.max(0, Math.min(100, 100 - item.window.usedPercent));
                          return (
                            <div key={item.id} className={composerStyles.usageRow}>
                              <span className={composerStyles.usageWindow}>{rateLimitUsageLabel(item.window)}</span>
                              <strong className={composerStyles.usagePercent}>{Math.round(remaining)}%</strong>
                              <time
                                className={composerStyles.usageReset}
                                dateTime={item.window.resetsAt === null ? undefined : new Date(item.window.resetsAt * 1000).toISOString()}
                              >
                                {rateLimitCompactResetLabel(item.window.resetsAt)}
                              </time>
                            </div>
                          );
                        })}
                      </div>
                  ) : (
                    <p className={composerStyles.usageEmpty} aria-live="polite">
                      {rateLimitStatus === 'loading'
                        ? 'Consultando sua conta…'
                        : 'Limites não informados pela conta.'}
                    </p>
                  )}
                </PopoverContent>
              </Popover>
              </div>

              <div data-kodety-onboarding="agent-send" className={composerStyles.rightActions}>
              {running ? (
                    <button
                      type="button"
                      className={cn(composerStyles.iconBtn, composerStyles.stopButton)}
                      aria-label="Interromper agente"
                      onClick={() => void interruptTurn()}
                    >
                  <span className={composerStyles.stopIcon} />
                </button>
              ) : (
                <button
                      className={cn(
                        composerStyles.iconBtn,
                        composerStyles.sendButton,
                        hasComposerContent && !invalidFigmaDesignLink && composerStyles.sendButtonActive,
                      )}
                  aria-label="Enviar mensagem"
                      disabled={licenseRequired || !hasComposerContent || invalidFigmaDesignLink || attachmentsUploading || sending || figmaGate || rateLimitReached || Boolean(createBackend && !selectedModel)}
                  type="submit"
                >
                  {sending ? <Loader2 className={composerStyles.spinner} size={14} /> : <ArrowUp size={14} />}
                </button>
              )}
              </div>
            </div>
          </div>
        </form>
        </>
      )}
    </section>
  );
}
