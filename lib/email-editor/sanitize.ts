/**
 * Sanitização exclusiva das superfícies de edição e pré-visualização.
 *
 * O HTML original continua intacto no documento e na exportação. Isso evita
 * alterar templates existentes silenciosamente, mas impede que HTML bruto
 * execute código com os privilégios da sessão do WordPress enquanto o autor
 * está apenas editando ou conferindo uma campanha.
 */

const REMOVED_ELEMENTS = new Set([
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
]);

const ALLOWED_ELEMENTS = new Set([
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
  // Markup condicional usado pelo Outlook.
  'o:officedocumentsettings',
  'o:pixelsperinch',
  'v:rect',
  'v:fill',
  'v:textbox',
  'w:anchorlock',
]);

const URL_ATTRIBUTES = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href']);
const BLOCKED_ATTRIBUTES = new Set(['srcdoc', 'sandbox']);
const UNSAFE_CSS = /(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding\s*:)/i;
const CANVAS_ESCAPE_CSS =
  /(?:^|;)\s*(?:position\s*:\s*(?:fixed|sticky)|z-index\s*:|inset(?:-[a-z]+)?\s*:|(?:top|right|bottom|left)\s*:|pointer-events\s*:)/i;

/**
 * Remove comportamento ativo sem reescrever o documento salvo.
 *
 * Para fragmentos, devolve somente o conteúdo do `<body>`. Para documentos
 * completos, preserva a estrutura inteira para continuar servindo como
 * `srcDoc` do iframe de prévia.
 */
export function sanitizeEmailHtmlForPreview(input: string): string {
  return sanitizeEmailHtml(input, false);
}

/**
 * Variante usada dentro do DOM principal do construtor.
 *
 * Além de remover comportamento ativo, impede que um bloco bruto injete uma
 * folha global ou se posicione sobre a interface administrativa. O iframe de
 * prévia pode manter CSS normal porque vive em sandbox sem mesma origem.
 */
export function sanitizeEmailHtmlForCanvas(input: string): string {
  return sanitizeEmailHtml(input, true);
}

function sanitizeEmailHtml(input: string, canvasMode: boolean): string {
  if (!input) return '';

  if (typeof DOMParser === 'undefined') {
    return fallbackSanitize(input, canvasMode);
  }

  const isFullDocument = /<!doctype\b|<html(?:\s|>)/i.test(input);
  const parsed = new DOMParser().parseFromString(input, 'text/html');
  sanitizeChildren(parsed, canvasMode);

  if (isFullDocument) {
    return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  }

  return parsed.body.innerHTML;
}

function sanitizeChildren(root: ParentNode, canvasMode: boolean): void {
  Array.from(root.children).forEach((element) => {
    const tag = element.tagName.toLowerCase();

    if (REMOVED_ELEMENTS.has(tag) || (canvasMode && tag === 'style')) {
      element.remove();
      return;
    }

    if (!ALLOWED_ELEMENTS.has(tag)) {
      // Elementos desconhecidos não ganham comportamento, mas seu conteúdo
      // textual continua visível para o autor encontrar e corrigir o bloco.
      sanitizeChildren(element, canvasMode);
      const parent = element.parentNode;
      if (parent) {
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
      }
      return;
    }

    if (
      tag === 'meta'
      && element.getAttribute('http-equiv')?.trim().toLowerCase() === 'refresh'
    ) {
      element.remove();
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (
        name.startsWith('on')
        || BLOCKED_ATTRIBUTES.has(name)
        || (URL_ATTRIBUTES.has(name) && hasUnsafeUrl(value))
        || (name === 'style' && UNSAFE_CSS.test(value))
        || (canvasMode && name === 'style' && CANVAS_ESCAPE_CSS.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    });

    if (tag === 'style' && UNSAFE_CSS.test(element.textContent ?? '')) {
      element.remove();
      return;
    }

    if (tag === 'a') {
      element.setAttribute('rel', 'noopener noreferrer');
    }

    sanitizeChildren(element, canvasMode);
  });
}

/**
 * SSR e testes sem DOM recebem uma barreira conservadora. No navegador a
 * implementação estrutural acima é usada, pois regex não interpreta HTML.
 */
function fallbackSanitize(input: string, canvasMode: boolean): string {
  const removed = Array.from(REMOVED_ELEMENTS).join('|');
  let output = input
    .replace(new RegExp(`<\\s*(${removed})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\s*(${removed})\\b[^>]*\\/?>`, 'gi'), '')
    .replace(/(?:\s+|\/)on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:srcdoc|sandbox)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s+(href|src|srcset|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (attribute, _name: string, doubleQuoted: string, singleQuoted: string, unquoted: string) =>
        hasUnsafeUrl(doubleQuoted ?? singleQuoted ?? unquoted ?? '') ? '' : attribute,
    );

  if (canvasMode) {
    output = output
      .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
      .replace(
        /\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
        (attribute, doubleQuoted: string, singleQuoted: string) =>
          CANVAS_ESCAPE_CSS.test(doubleQuoted ?? singleQuoted ?? '') ? '' : attribute,
      );
  }

  return output;
}

function hasUnsafeUrl(value: string): boolean {
  const candidates = value.split(',');
  return candidates.some((candidate) =>
    /^(?:javascript|vbscript|data:text\/html)/i.test(
      decodeHtmlControls(candidate).replace(/[\u0000-\u0020]+/g, ''),
    ),
  );
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
