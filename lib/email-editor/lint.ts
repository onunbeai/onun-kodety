/**
 * Verificação de compatibilidade e segurança, no documento e não só no HTML
 * final.
 *
 * Trabalhar no documento permite apontar o bloco exato que causou o problema,
 * o que o lint em PHP (que só vê o HTML pronto) não consegue fazer. Os dois
 * coexistem de propósito: este orienta enquanto se edita, o do servidor é a
 * barreira final antes do disparo.
 */

import { renderEmailHtml } from './render';
import type { EmailBlock, EmailDocument, EmailLintIssue } from './types';

/** Acima disso o Gmail corta a mensagem e esconde o resto atrás de um link. */
const GMAIL_CLIP_BYTES = 102400;

const ACTIVE_TAGS = new Set([
  'script',
  'form',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'base',
  'link',
  'template',
  'svg',
  'math',
  'video',
  'audio',
  'source',
  'track',
  'portal',
]);

/** HTML amplamente aceito por clientes de email e pelo markup do Outlook. */
const EMAIL_SAFE_TAGS = new Set([
  'html',
  'head',
  'body',
  'meta',
  'title',
  'style',
  'noscript',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'colgroup',
  'col',
  'caption',
  'div',
  'span',
  'p',
  'a',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'blockquote',
  'center',
  'font',
  'small',
  'sub',
  'sup',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'del',
  'ins',
  'mark',
  'abbr',
  'cite',
  'q',
  'dl',
  'dt',
  'dd',
  'address',
  'figure',
  'figcaption',
  'o:officedocumentsettings',
  'o:pixelsperinch',
  'v:rect',
  'v:fill',
  'v:textbox',
  'w:anchorlock',
]);

const PLACEHOLDER_ALT = new Set([
  'alt',
  'image',
  'imagem',
  'placeholder',
  'texto alternativo',
  'descreva a imagem',
  'descrever imagem',
]);

const UNSAFE_STYLE = /(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding\s*:)/i;
const SENDABLE_LINK_MERGE_TAGS = new Set([
  'unsubscribe_url',
  'view_in_browser_url',
  'site.url',
]);

export function lintDocument(
  document: EmailDocument,
  renderedHtml = renderEmailHtml(document),
): EmailLintIssue[] {
  const issues: EmailLintIssue[] = [];
  const html = renderedHtml;

  if (document.blocks.length === 0) {
    issues.push({ level: 'error', code: 'empty_document', message: 'O email está vazio.' });
  }

  if (!hasFunctionalUnsubscribe(html)) {
    issues.push({
      level: 'error',
      code: 'missing_unsubscribe',
      message:
        'Falta um link de descadastro funcional. Use {{unsubscribe_url}} no endereço de um link visível.',
    });
  }

  const size = new TextEncoder().encode(html).length;
  if (size > GMAIL_CLIP_BYTES) {
    issues.push({
      level: 'warning',
      code: 'gmail_clip',
      message: `O email tem ${Math.round(size / 1024)} KB. Acima de 100 KB o Gmail trunca a mensagem.`,
    });
  }

  walk(document.blocks, (block) => {
    switch (block.type) {
      case 'image':
        if (!block.src) {
          issues.push({
            level: 'error',
            code: 'image_missing_src',
            message: 'Imagem sem arquivo selecionado.',
            blockId: block.id,
          });
        } else if (!isRemoteAsset(block.src)) {
          issues.push({
            level: 'error',
            code: 'image_invalid_src',
            message: 'Imagem com URL inválida. Em email ela precisa começar com http:// ou https://.',
            blockId: block.id,
          });
        }
        if (isPlaceholderAlt(block.alt)) {
          issues.push({
            level: 'error',
            code: 'image_missing_alt',
            message: 'Substitua o texto alternativo provisório por uma descrição real da imagem.',
            blockId: block.id,
          });
        }
        if (block.href && !isSendableLink(block.href)) {
          issues.push({
            level: 'error',
            code: 'image_invalid_link',
            message: 'O link da imagem não é um endereço válido para email.',
            blockId: block.id,
          });
        }
        break;

      case 'button':
        if (!isSendableLink(block.href)) {
          issues.push({
            level: 'error',
            code: 'button_invalid_link',
            message: 'Botão sem link válido.',
            blockId: block.id,
          });
        }
        break;

      case 'text':
        inspectMarkup(block.html, block.id, issues);
        break;

      case 'html':
        inspectMarkup(block.code, block.id, issues);
        if (/display\s*:\s*(flex|grid)/i.test(block.code)) {
          issues.push({
            level: 'warning',
            code: 'outlook_layout',
            message: 'Flex e grid não funcionam no Outlook. Use tabelas neste bloco.',
            blockId: block.id,
          });
        }
        break;

      default:
        break;
    }
  });

  return issues;
}

export function hasBlockingIssue(issues: EmailLintIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

/**
 * O token solto no texto não basta: ele precisa ser o `href` de um link que o
 * destinatário consiga enxergar e acionar.
 */
export function hasFunctionalUnsubscribe(html: string): boolean {
  const stack: VisibilityElement[] = [];

  const closesFunctionalAnchor = (element: VisibilityElement): boolean =>
    Boolean(
      element.anchor
      && element.anchor.unsubscribeHref
      && !element.hidden
      && element.anchor.hasVisibleContent,
    );

  for (const token of tokenizeHtml(html)) {
    if (token.type === 'text') {
      if (stack.at(-1)?.hidden || !hasVisibleText(token.value)) continue;
      const anchor = activeAnchor(stack);
      if (anchor) anchor.hasVisibleContent = true;
      continue;
    }

    const closing = token.value.match(/^<\s*\/\s*([a-z][\w:-]*)/i);
    if (closing) {
      const tag = (closing[1] ?? '').toLowerCase();
      const openingIndex = findOpeningElement(stack, tag);
      if (openingIndex < 0) continue;

      for (let index = stack.length - 1; index >= openingIndex; index -= 1) {
        if (closesFunctionalAnchor(stack[index])) return true;
      }
      stack.length = openingIndex;
      continue;
    }

    const opening = token.value.match(/^<\s*([a-z][\w:-]*)([\s\S]*?)\/?\s*>$/i);
    if (!opening) continue;

    const tag = (opening[1] ?? '').toLowerCase();
    const attributes = opening[2] ?? '';
    const parsedAttributes = parseHtmlAttributes(attributes);

    // HTML não permite <a> aninhado: abrir outro encerra implicitamente o
    // anterior. Espelhar essa regra impede conteúdo do segundo link de tornar
    // o primeiro falsamente "visível".
    if (tag === 'a') {
      const previousAnchorIndex = findOpeningElement(stack, 'a');
      if (previousAnchorIndex >= 0) {
        for (let index = stack.length - 1; index >= previousAnchorIndex; index -= 1) {
          if (closesFunctionalAnchor(stack[index])) return true;
        }
        stack.length = previousAnchorIndex;
      }
    }

    const parentHidden = stack.at(-1)?.hidden ?? false;
    const hidden = parentHidden || elementIsHidden(tag, parsedAttributes);
    const parentAnchor = activeAnchor(stack);

    if (tag === 'img' && parentAnchor && !hidden) {
      const src = readParsedAttribute(parsedAttributes, 'src')?.trim() ?? '';
      const alt = readParsedAttribute(parsedAttributes, 'alt') ?? '';
      if (src && !isPlaceholderAlt(alt)) parentAnchor.hasVisibleContent = true;
    }

    const element: VisibilityElement = {
      tag,
      hidden,
      anchor:
        tag === 'a'
          ? {
              unsubscribeHref:
                normalizeMergeTag(readParsedAttribute(parsedAttributes, 'href') ?? '')
                === '{{unsubscribe_url}}',
              hasVisibleContent: false,
            }
          : undefined,
    };

    const isSelfClosing = /\/\s*>$/.test(token.value) || VOID_ELEMENTS.has(tag);
    if (isSelfClosing) {
      if (closesFunctionalAnchor(element)) return true;
    } else {
      stack.push(element);
    }
  }

  // HTML tolera tags sem fechamento. O navegador estende o elemento até o
  // fim do documento, então o lint avalia também o que restou na pilha.
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (closesFunctionalAnchor(stack[index])) return true;
  }

  return false;
}

interface AnchorVisibility {
  unsubscribeHref: boolean;
  hasVisibleContent: boolean;
}

interface VisibilityElement {
  tag: string;
  hidden: boolean;
  anchor?: AnchorVisibility;
}

interface HtmlVisibilityToken {
  type: 'tag' | 'text';
  value: string;
}

type ParsedHtmlAttributes = Map<string, string | null>;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const NON_RENDERED_ELEMENTS = new Set([
  'head',
  'script',
  'style',
  'template',
  'title',
  'noscript',
]);

function activeAnchor(stack: VisibilityElement[]): AnchorVisibility | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].anchor) return stack[index].anchor ?? null;
  }
  return null;
}

function findOpeningElement(stack: VisibilityElement[], tag: string): number {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].tag === tag) return index;
  }
  return -1;
}

function elementIsHidden(tag: string, attributes: ParsedHtmlAttributes): boolean {
  if (NON_RENDERED_ELEMENTS.has(tag)) return true;
  if (attributes.has('hidden') || attributes.has('inert')) return true;

  const ariaHidden = readParsedAttribute(attributes, 'aria-hidden')?.trim().toLowerCase();
  if (ariaHidden === 'true') return true;
  if (
    tag === 'a'
    && readParsedAttribute(attributes, 'aria-disabled')?.trim().toLowerCase() === 'true'
  ) {
    return true;
  }

  const style = decodeHtmlControls(readParsedAttribute(attributes, 'style') ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return /(?:^|;)\s*display\s*:\s*none\b/i.test(style)
    || /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\b/i.test(style)
    || /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(?:;|$)/i.test(style)
    || /(?:^|;)\s*pointer-events\s*:\s*none\b/i.test(style);
}

function hasVisibleText(value: string): boolean {
  const normalized = decodeHtmlControls(value)
    .replace(/&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj|lrm|rlm|zerowidthspace);/gi, ' ')
    .replace(/[\s\u00a0\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
  return normalized.length > 0;
}

/**
 * Tokenizador mínimo, mas consciente de aspas e comentários. Regex simples
 * encerra uma tag no `>` de um atributo e perde a hierarquia; aqui precisamos
 * dela para saber se o link está dentro de um ancestral oculto.
 */
function tokenizeHtml(html: string): HtmlVisibilityToken[] {
  const tokens: HtmlVisibilityToken[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart < 0) {
      tokens.push({ type: 'text', value: html.slice(cursor) });
      break;
    }

    if (tagStart > cursor) {
      tokens.push({ type: 'text', value: html.slice(cursor, tagStart) });
    }

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4);
      if (commentEnd < 0) break;
      cursor = commentEnd + 3;
      continue;
    }

    let quote = '';
    let tagEnd = -1;
    for (let index = tagStart + 1; index < html.length; index += 1) {
      const character = html[index];
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        tagEnd = index;
        break;
      }
    }

    if (tagEnd < 0) {
      tokens.push({ type: 'text', value: html.slice(tagStart) });
      break;
    }

    const candidate = html.slice(tagStart, tagEnd + 1);
    if (/^<\s*\/?\s*[a-z]/i.test(candidate) || /^<\s*!/i.test(candidate)) {
      tokens.push({ type: 'tag', value: candidate });
    } else {
      tokens.push({ type: 'text', value: candidate });
    }
    cursor = tagEnd + 1;
  }

  return tokens;
}

function inspectMarkup(markup: string, blockId: string, issues: EmailLintIssue[]): void {
  const uncommented = markup.replace(/<!--[\s\S]*?-->/g, '');
  const foundActive = new Set<string>();
  const foundUnknown = new Set<string>();

  for (const match of uncommented.matchAll(/<\s*\/?\s*([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = (match[1] ?? '').toLowerCase();
    if (ACTIVE_TAGS.has(tag)) foundActive.add(tag);
    else if (!EMAIL_SAFE_TAGS.has(tag)) foundUnknown.add(tag);
  }

  if (foundActive.size > 0) {
    issues.push({
      level: 'error',
      code: 'active_html',
      message: `HTML ativo não é permitido: ${Array.from(foundActive).join(', ')}.`,
      blockId,
    });
  }

  if (foundUnknown.size > 0) {
    issues.push({
      level: 'error',
      code: 'unknown_html',
      message: `Tag HTML não reconhecida para email: ${Array.from(foundUnknown).join(', ')}.`,
      blockId,
    });
  }

  if (/(?:\s|\/)on[a-z][\w:-]*\s*=/i.test(uncommented)) {
    issues.push({
      level: 'error',
      code: 'event_handler',
      message: 'Atributos de evento (como onclick) não são permitidos em emails.',
      blockId,
    });
  }

  if (/\bsrcdoc\s*=/i.test(uncommented)) {
    issues.push({
      level: 'error',
      code: 'active_attribute',
      message: 'O atributo srcdoc não é permitido em emails.',
      blockId,
    });
  }

  if (
    findTags(uncommented, 'meta', false).some(
      (meta) => readAttribute(meta.attributes, 'http-equiv')?.trim().toLowerCase() === 'refresh',
    )
  ) {
    issues.push({
      level: 'error',
      code: 'meta_refresh',
      message: 'Redirecionamento automático por meta refresh não é permitido em emails.',
      blockId,
    });
  }

  if (UNSAFE_STYLE.test(uncommented)) {
    issues.push({
      level: 'error',
      code: 'unsafe_css',
      message: 'O bloco contém CSS ativo ou inseguro.',
      blockId,
    });
  }

  for (const anchor of findTags(uncommented, 'a', false)) {
    const href = readAttribute(anchor.attributes, 'href') ?? '';
    if (!isSendableLink(href)) {
      issues.push({
        level: 'error',
        code: 'invalid_link',
        message: href.trim()
          ? `O link "${shorten(href)}" não é válido. Use uma URL absoluta ou merge tag de URL.`
          : 'Há um link sem endereço neste bloco.',
        blockId,
      });
    }
  }

  for (const image of findTags(uncommented, 'img', false)) {
    const src = readAttribute(image.attributes, 'src') ?? '';
    const alt = readAttribute(image.attributes, 'alt') ?? '';

    if (!isRemoteAsset(src)) {
      issues.push({
        level: 'error',
        code: 'raw_image_invalid_src',
        message: 'Uma imagem do HTML bruto não tem URL http:// ou https:// válida.',
        blockId,
      });
    }
    if (isPlaceholderAlt(alt)) {
      issues.push({
        level: 'error',
        code: 'raw_image_missing_alt',
        message: 'Uma imagem do HTML bruto precisa de texto alternativo descritivo.',
        blockId,
      });
    }
  }

  for (const attribute of findUrlAttributes(uncommented)) {
    if (hasUnsafeScheme(attribute.value)) {
      issues.push({
        level: 'error',
        code: 'unsafe_url',
        message: `O protocolo usado em ${attribute.name} não é permitido.`,
        blockId,
      });
      break;
    }
  }
}

function isSendableLink(href: string): boolean {
  const value = href.trim();
  if (!value || hasUnsafeScheme(value)) return false;
  const mergeTag = value.match(/^\{\{\s*([a-z0-9_.-]+)\s*\}\}$/i);
  if (mergeTag) return SENDABLE_LINK_MERGE_TAGS.has((mergeTag[1] ?? '').toLowerCase());
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return true;
  if (/^tel:\+?[\d().\s-]{5,}$/i.test(value)) return true;

  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isRemoteAsset(src: string): boolean {
  const value = src.trim();
  if (!value || hasUnsafeScheme(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function hasUnsafeScheme(value: string): boolean {
  const compact = decodeHtmlControls(value).replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return /^(?:javascript|vbscript|data):/.test(compact);
}

function decodeHtmlControls(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replace(/&#([0-9]+);?/g, (_match, code: string) => decodeCodePoint(code, 10))
    .replace(/&(colon|tab|newline);/gi, (_match, entity: string) => {
      if (entity.toLowerCase() === 'colon') return ':';
      return entity.toLowerCase() === 'tab' ? '\t' : '\n';
    });
}

function decodeCodePoint(value: string, radix: number): string {
  const point = Number.parseInt(value, radix);
  return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
}

function isPlaceholderAlt(value: string): boolean {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return !normalized || PLACEHOLDER_ALT.has(normalized);
}

interface FoundTag {
  attributes: string;
  content?: string;
}

function findTags(html: string, tag: string, paired: boolean): FoundTag[] {
  const results: FoundTag[] = [];
  const expression = paired
    ? new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi')
    : new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi');

  for (const match of html.matchAll(expression)) {
    results.push({ attributes: match[1] ?? '', content: paired ? match[2] ?? '' : undefined });
  }
  return results;
}

function readAttribute(attributes: string, name: string): string | null {
  return readParsedAttribute(parseHtmlAttributes(attributes), name);
}

function readParsedAttribute(attributes: ParsedHtmlAttributes, name: string): string | null {
  const normalized = name.toLowerCase();
  if (!attributes.has(normalized)) return null;
  return attributes.get(normalized) ?? '';
}

function parseHtmlAttributes(source: string): ParsedHtmlAttributes {
  const attributes: ParsedHtmlAttributes = new Map();
  let cursor = 0;

  while (cursor < source.length) {
    while (cursor < source.length && /[\s/]/.test(source[cursor])) cursor += 1;
    if (cursor >= source.length || source[cursor] === '>') break;

    const nameStart = cursor;
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }

    const name = source.slice(nameStart, cursor).toLowerCase();
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;

    let value: string | null = null;
    if (source[cursor] === '=') {
      cursor += 1;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;

      const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : '';
      if (quote) {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }

    // O parser HTML preserva o primeiro atributo quando há duplicatas.
    if (!attributes.has(name)) attributes.set(name, value);
  }

  return attributes;
}

function findUrlAttributes(html: string): Array<{ name: string; value: string }> {
  const attributes: Array<{ name: string; value: string }> = [];
  const expression =
    /\b(href|src|srcset|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

  for (const match of html.matchAll(expression)) {
    attributes.push({
      name: (match[1] ?? '').toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? '',
    });
  }
  return attributes;
}

function normalizeMergeTag(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function shorten(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

function walk(blocks: EmailBlock[], visit: (block: EmailBlock) => void): void {
  blocks.forEach((block) => {
    visit(block);
    if (block.type === 'columns') {
      block.columns.forEach((column) => walk(column, visit));
    }
  });
}
