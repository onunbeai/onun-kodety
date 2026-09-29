/**
 * Transporte do construtor de email.
 *
 * O editor roda numa rota própria do WordPress e conversa com o REST do
 * plugin. Nenhuma dependência do transporte do editor de sites: os dois podem
 * evoluir sem se quebrar.
 */

import { createBlock } from './blocks';
import {
  createEmptyDocument,
  type EmailAlign,
  type EmailBlock,
  type EmailBox,
  type EmailDocument,
  type EmailLeafBlock,
  type EmailRadius,
  type EmailSides,
  type EmailTemplateRecord,
  type EmailTypography,
} from './types';

export interface EmailEditorConfig {
  templatesUrl: string;
  templateUrl: string;
  mediaUrl: string;
  campaignsUrl: string;
  nonce: string;
  templateId: number;
  canManage: boolean;
}

declare global {
  interface Window {
    kodetyEmailEditor?: EmailEditorConfig;
  }
}

export function readConfig(): EmailEditorConfig {
  const config = typeof window !== 'undefined' ? window.kodetyEmailEditor : undefined;
  if (!config) {
    throw new Error('Configuração do construtor de email não encontrada.');
  }
  return config;
}

async function request<T>(url: string, init: RequestInit, nonce: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': nonce, ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    // A mensagem do WordPress diz muito mais que "500" — vale extrair.
    const detail = await response.json().catch(() => null);
    const message =
      detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `Falha na requisição (${response.status}).`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function loadTemplate(
  config: EmailEditorConfig,
  id: number,
  signal?: AbortSignal,
): Promise<EmailTemplateRecord> {
  return request<EmailTemplateRecord>(
    config.templateUrl.replace('{id}', String(id)),
    { method: 'GET', signal },
    config.nonce,
  );
}

export interface SaveTemplatePayload {
  id: number;
  name: string;
  html: string;
  text: string;
  document: EmailDocument;
  expectedRevision?: string;
}

export async function saveTemplate(
  config: EmailEditorConfig,
  payload: SaveTemplatePayload,
  signal?: AbortSignal,
): Promise<EmailTemplateRecord> {
  const body = JSON.stringify({
    name: payload.name,
    html: payload.html,
    text_body: payload.text,
    project_json: JSON.stringify(payload.document),
    expected_revision: payload.expectedRevision ?? '',
  });

  return payload.id > 0
    ? request<EmailTemplateRecord>(
        config.templateUrl.replace('{id}', String(payload.id)),
        { method: 'POST', body, signal, headers: { 'Content-Type': 'application/json' } },
        config.nonce,
      )
    : request<EmailTemplateRecord>(
        config.templatesUrl,
        { method: 'POST', body, signal, headers: { 'Content-Type': 'application/json' } },
        config.nonce,
      );
}

export interface UploadedImage {
  url: string;
  width: number;
  alt: string;
}

/**
 * Sobe a imagem pela Media Library do WordPress. O email precisa de URL
 * absoluta e hospedagem estável — anexar base64 seria rejeitado por filtro de
 * spam e estouraria o limite de tamanho da mensagem.
 */
export async function uploadImage(
  config: EmailEditorConfig,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedImage> {
  const body = new FormData();
  body.append('file', file, file.name);

  const media = await request<{
    source_url: string;
    alt_text?: string;
    media_details?: { width?: number };
  }>(config.mediaUrl, { method: 'POST', body, signal }, config.nonce);

  return {
    url: media.source_url,
    width: Math.min(552, media.media_details?.width ?? 552),
    alt: media.alt_text ?? '',
  };
}

/**
 * Converte um template legado (HTML completo, sem project_json) em um
 * documento editável sem colocar um segundo html/head/body dentro do email
 * gerado pelo builder.
 *
 * O corpo é preservado como veio. Do head, só folhas de estilo sem recursos
 * ativos são mantidas; scripts, metas e demais elementos de documento não
 * fazem sentido dentro do bloco bruto e ficam de fora.
 */
export function importLegacyEmailDocument(html: string): EmailDocument {
  const document = createEmptyDocument();
  const block = createBlock('html');
  if (block.type !== 'html') return document;

  block.name = 'HTML importado';
  block.code = extractLegacyEmailContent(html);
  block.box = {
    ...block.box,
    padding: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
  };
  document.blocks = [block];
  return document;
}

export function extractLegacyEmailContent(html: string): string {
  const input = html.trim();
  if (!input || !/<!doctype\b|<(?:html|head|body)(?:\s|>)/i.test(input)) return input;

  const head = input.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? '';
  const bodyMatch = input.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  const styles = Array.from(head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))
    .map((match) => match[1] ?? '')
    .filter((css) => !legacyStyleIsUnsafe(css))
    .map((css) => `<style>${css}</style>`)
    .join('\n');

  const body = bodyMatch?.[1]
    ?? input
      .replace(/<!doctype[^>]*>/gi, '')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
      .replace(/<\/?(?:html|body)\b[^>]*>/gi, '');

  return [styles, body.trim()].filter(Boolean).join('\n');
}

function legacyStyleIsUnsafe(css: string): boolean {
  return /@import\b|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding\s*:/i.test(css);
}

export interface EmailEditorDraft {
  version: 1;
  templateId: number;
  name: string;
  document: EmailDocument;
  savedAt: number;
}

const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * Impressão do estado persistível. Comparar a impressão salva, em vez de
 * alternar um booleano imperativo, faz desfazer até a versão salva limpar o
 * estado sujo e impede uma resposta antiga de save de esconder edições novas.
 */
export function emailEditorFingerprint(name: string, document: EmailDocument): string {
  return JSON.stringify({ name, document });
}

export function readEmailEditorDraft(
  config: EmailEditorConfig,
  templateId: number,
  draftScope = '',
): EmailEditorDraft | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = draftKey(config, templateId, draftScope);
    let raw = window.localStorage.getItem(key);
    // Migra uma única vez o rascunho criado antes de templates novos terem
    // escopo por aba. A remoção síncrona impede que duas abas adotem a mesma
    // cópia legada.
    if (!raw && templateId <= 0 && draftScope !== '') {
      const legacyKey = draftKey(config, templateId);
      raw = window.localStorage.getItem(legacyKey);
      if (raw) {
        window.localStorage.setItem(key, raw);
        window.localStorage.removeItem(legacyKey);
      }
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<EmailEditorDraft> & { document?: unknown };
    if (
      parsed.version !== 1
      || typeof parsed.savedAt !== 'number'
      || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS
      || !parsed.document
      || typeof parsed.document !== 'object'
    ) {
      window.localStorage.removeItem(key);
      return null;
    }

    const document = normalizeDocument(parsed.document as { blocks?: unknown; settings?: unknown });
    return {
      version: 1,
      templateId,
      name: typeof parsed.name === 'string' ? parsed.name : 'Novo template',
      document,
      savedAt: parsed.savedAt,
    };
  } catch {
    // Navegação privada, quota e políticas de storage não podem derrubar o
    // editor. Nesse ambiente ele continua funcionando, apenas sem recuperação.
    return null;
  }
}

export function writeEmailEditorDraft(
  config: EmailEditorConfig,
  draft: Omit<EmailEditorDraft, 'version' | 'savedAt'>,
  draftScope = '',
): void {
  if (typeof window === 'undefined') return;

  try {
    const value: EmailEditorDraft = {
      ...draft,
      version: 1,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(draftKey(config, draft.templateId, draftScope), JSON.stringify(value));
  } catch {
    // Recuperação é uma camada auxiliar: quota cheia não impede edição/save.
  }
}

export function clearEmailEditorDraft(
  config: EmailEditorConfig,
  templateId: number,
  draftScope = '',
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(draftKey(config, templateId, draftScope));
  } catch {
    // Ver comentário em writeEmailEditorDraft.
  }
}

/**
 * Cada aba de “Novo template” recebe uma identidade na própria URL. Assim ela
 * sobrevive a reload/restore da aba, mas nunca apaga a recuperação de outra
 * criação que esteja acontecendo em paralelo.
 */
export function ensureEmailEditorDraftScope(templateId: number): string {
  if (typeof window === 'undefined' || templateId > 0) return '';

  const url = new URL(window.location.href);
  const current = url.searchParams.get('draft') ?? '';
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(current)) return current;

  const generated =
    typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  url.searchParams.set('draft', generated);
  window.history.replaceState({}, '', url.toString());
  return generated;
}

function draftKey(config: EmailEditorConfig, templateId: number, draftScope = ''): string {
  // O hash separa instalações multisite que compartilham a mesma origem sem
  // colocar a URL REST inteira (potencialmente longa) na chave.
  let hash = 2166136261;
  for (let index = 0; index < config.templatesUrl.length; index += 1) {
    hash ^= config.templatesUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const scope = (hash >>> 0).toString(36);
  const identity = templateId > 0
    ? String(templateId)
    : `new${draftScope !== '' ? `:${draftScope}` : ''}`;
  return `kodety:email-editor:draft:${scope}:${identity}`;
}

/**
 * Lê o documento salvo e o normaliza contra os padrões atuais.
 *
 * A normalização roda SEMPRE, não só quando a versão é antiga. Confiar no
 * número da versão já quebrou uma vez: um documento gravado como v2 antes de
 * `box.width` existir passava intacto e derrubava o editor no primeiro
 * `width.trim()`. Reconstruir cada bloco a partir de um bloco novo torna
 * qualquer campo futuro seguro por construção.
 */
export function parseDocument(projectJson: string | null): EmailDocument | null {
  if (!projectJson) return null;
  try {
    const parsed = JSON.parse(projectJson) as { blocks?: unknown; settings?: unknown };
    if (!parsed || !Array.isArray(parsed.blocks)) return null;
    return normalizeDocument(parsed);
  } catch {
    // Documento corrompido não pode derrubar o editor: começa vazio.
    return null;
  }
}

function normalizeDocument(stored: { blocks?: unknown; settings?: unknown }): EmailDocument {
  const next = createEmptyDocument();
  const settings = (stored.settings ?? {}) as Record<string, unknown>;

  next.settings = {
    ...next.settings,
    width: numberToLength(settings.width, next.settings.width),
    backgroundColor: asString(settings.backgroundColor, next.settings.backgroundColor),
    contentBackground: asString(settings.contentBackground, next.settings.contentBackground),
    contentPadding: normalizeSides(settings.contentPadding, next.settings.contentPadding),
    fontFamily: asString(settings.fontFamily, next.settings.fontFamily),
    textColor: asString(settings.textColor, next.settings.textColor),
    linkColor: asString(settings.linkColor, next.settings.linkColor),
    linkUnderline: settings.linkUnderline === undefined ? true : Boolean(settings.linkUnderline),
  };

  next.blocks = (stored.blocks as Record<string, unknown>[])
    .map(normalizeBlock)
    .filter((block): block is EmailBlock => block !== null);

  return next;
}

function normalizeBlock(stored: Record<string, unknown>): EmailBlock | null {
  const type = String(stored.type ?? '');
  if (!EMAIL_BLOCK_TYPES.includes(type)) return null;

  const fresh = createBlock(type as EmailBlock['type']);
  const block = {
    ...fresh,
    id: asIdentifier(stored.id, fresh.id),
    name: asString(stored.name, ''),
    box: normalizeBox(stored, fresh.box),
  } as EmailBlock;

  if ('typography' in block) {
    block.typography = normalizeTypography(stored, block.typography);
  }

  switch (block.type) {
    case 'heading':
      block.text = asString(stored.text, block.text);
      block.level = [1, 2, 3].includes(Number(stored.level)) ? (Number(stored.level) as 1 | 2 | 3) : block.level;
      break;
    case 'text':
      block.html = asString(stored.html, block.html);
      break;
    case 'image':
      block.src = asString(stored.src, '');
      block.alt = asString(stored.alt, '');
      block.href = asString(stored.href, '');
      block.width = numberToLength(stored.width, block.width);
      block.align = asAlign(stored.align, block.align);
      break;
    case 'button':
      block.label = asString(stored.label, block.label);
      block.href = asString(stored.href, block.href);
      block.backgroundColor = asString(stored.backgroundColor, block.backgroundColor);
      block.paddingX = numberToLength(stored.paddingX, block.paddingX);
      block.paddingY = numberToLength(stored.paddingY, block.paddingY);
      block.radius = normalizeRadius(stored.radius, block.radius);
      block.fullWidth = Boolean(stored.fullWidth);
      break;
    case 'divider':
      block.color = asString(stored.color, block.color);
      block.thickness = numberToLength(stored.thickness, block.thickness);
      block.lineWidth = asString(stored.lineWidth, '');
      block.align = asAlign(stored.align, block.align);
      break;
    case 'spacer':
      block.height = numberToLength(stored.height, block.height);
      break;
    case 'html':
      block.code = asString(stored.code, block.code);
      break;
    case 'columns':
      block.gap = numberToLength(stored.gap, block.gap);
      block.verticalAlign = ['top', 'middle', 'bottom'].includes(String(stored.verticalAlign))
        ? (String(stored.verticalAlign) as 'top' | 'middle' | 'bottom')
        : block.verticalAlign;
      block.widths = Array.isArray(stored.widths) ? stored.widths.map(Number).filter(Number.isFinite) : [];
      block.columns = Array.isArray(stored.columns)
        ? (stored.columns as Record<string, unknown>[][]).map((column) =>
            (Array.isArray(column) ? column : [])
              .map(normalizeBlock)
              .filter((leaf): leaf is EmailLeafBlock => leaf !== null && leaf.type !== 'columns'),
          )
        : block.columns;
      break;
  }

  return block;
}

/**
 * Aceita tanto a caixa atual quanto o formato antigo, que guardava espaçamento
 * em dois números soltos no bloco (`paddingY`/`paddingX`).
 */
function normalizeBox(stored: Record<string, unknown>, fallback: EmailBox): EmailBox {
  const box = (stored.box ?? null) as Record<string, unknown> | null;

  if (!box) {
    const paddingY = numberToLength(stored.paddingY, fallback.padding.top);
    const paddingX = numberToLength(stored.paddingX, fallback.padding.right);
    return {
      ...fallback,
      padding: { top: paddingY, right: paddingX, bottom: paddingY, left: paddingX },
      backgroundColor: asString(stored.backgroundColor, ''),
    };
  }

  return {
    padding: normalizeSides(box.padding, fallback.padding),
    margin: normalizeSides(box.margin, fallback.margin),
    width: asString(box.width, ''),
    height: asString(box.height, ''),
    backgroundColor: asString(box.backgroundColor, ''),
    borderWidth: asString(box.borderWidth, ''),
    borderStyle: ['none', 'solid', 'dashed', 'dotted'].includes(String(box.borderStyle))
      ? (String(box.borderStyle) as EmailBox['borderStyle'])
      : 'none',
    borderColor: asString(box.borderColor, ''),
    radius: normalizeRadius(box.radius, fallback.radius),
  };
}

function normalizeTypography(stored: Record<string, unknown>, fallback: EmailTypography): EmailTypography {
  const typography = (stored.typography ?? null) as Record<string, unknown> | null;
  const source = typography ?? stored;

  return {
    fontFamily: asString(source.fontFamily, typography ? '' : fallback.fontFamily),
    fontSize: numberToLength(source.fontSize, fallback.fontSize),
    fontWeight: source.fontWeight !== undefined ? String(source.fontWeight) : fallback.fontWeight,
    lineHeight: source.lineHeight !== undefined ? String(source.lineHeight) : fallback.lineHeight,
    letterSpacing: asString(source.letterSpacing, ''),
    textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(String(source.textTransform))
      ? (String(source.textTransform) as EmailTypography['textTransform'])
      : 'none',
    color: asString(source.color, fallback.color),
    align: asAlign(source.align, fallback.align),
  };
}

function normalizeSides(value: unknown, fallback: EmailSides): EmailSides {
  const stored = (value ?? null) as Record<string, unknown> | null;
  if (!stored) return { ...fallback };

  return {
    top: numberToLength(stored.top, fallback.top),
    right: numberToLength(stored.right, fallback.right),
    bottom: numberToLength(stored.bottom, fallback.bottom),
    left: numberToLength(stored.left, fallback.left),
  };
}

function normalizeRadius(value: unknown, fallback: EmailRadius): EmailRadius {
  const stored = (value ?? null) as Record<string, unknown> | null;
  // A versão antiga guardava o raio como um número solto.
  if (typeof value === 'number') return { ...fallback, mode: 'all', all: `${value}px` };
  if (!stored) return { ...fallback };

  return {
    mode: stored.mode === 'individual' ? 'individual' : 'all',
    all: numberToLength(stored.all, fallback.all),
    topLeft: asString(stored.topLeft, ''),
    topRight: asString(stored.topRight, ''),
    bottomRight: asString(stored.bottomRight, ''),
    bottomLeft: asString(stored.bottomLeft, ''),
  };
}

const EMAIL_BLOCK_TYPES: string[] = ['heading', 'text', 'image', 'button', 'divider', 'spacer', 'html', 'columns'];

function asAlign(value: unknown, fallback: EmailAlign): EmailAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asIdentifier(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numberToLength(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`;
  if (typeof value === 'string') return value;
  return fallback;
}
