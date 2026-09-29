/**
 * Documento -> HTML de email.
 *
 * O CSS já sai inline daqui: como somos nós que geramos o markup, inline é
 * questão de escrever `style=""` na origem, e não de rodar um inliner sobre
 * uma folha de estilo depois. Só sobra no `<head>` o que fisicamente não pode
 * ser inline — a media query de empilhamento no mobile.
 *
 * Regras que o markup respeita, e por quê:
 *  - layout em <table>, porque flex/grid não existem no Outlook;
 *  - margem vira padding de uma célula externa, porque margin em <td> é
 *    ignorada por vários clientes;
 *  - cada bloco é uma tabela autônoma, o que torna a pré-visualização do
 *    editor idêntica à saída final, sem uma segunda implementação;
 *  - toda imagem com width e alt.
 */

import type {
  EmailBlock,
  EmailButtonBlock,
  EmailColumnsBlock,
  EmailDividerBlock,
  EmailDocument,
  EmailDocumentSettings,
  EmailHeadingBlock,
  EmailHtmlBlock,
  EmailImageBlock,
  EmailRadius,
  EmailSides,
  EmailSpacerBlock,
  EmailTextBlock,
  EmailTypography,
} from './types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapa um valor para dentro de um atributo. `{{merge_tags}}` atravessam
 * intactas porque chaves não são caracteres especiais em HTML — elas são
 * resolvidas em PHP no momento do envio.
 */
function attr(value: string): string {
  return escapeHtml(value);
}

type Declarations = Record<string, string | number | undefined>;

function css(declarations: Declarations): string {
  return Object.entries(declarations)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([property, value]) => `${property}:${value}`)
    .join(';');
}

/**
 * Número cru vira px.
 *
 * Nem todo controle do builder compõe a unidade: o `RadiusValueControl` emite
 * `182`, que como `border-radius:182` é CSS inválido e some silenciosamente.
 * Normalizar na saída conserta também os documentos já salvos assim.
 */
function length(value: string): string {
  const trimmed = value.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

/** Lados vazios viram `0`, mas um conjunto inteiramente vazio some. */
function sidesToCss(value: EmailSides): string | undefined {
  const parts = [value.top, value.right, value.bottom, value.left];
  if (parts.every((part) => !part.trim())) return undefined;
  return parts.map((part) => (part.trim() ? length(part) : '0')).join(' ');
}

function radiusToCss(radius: EmailRadius): string | undefined {
  if (radius.mode === 'all') return radius.all.trim() ? length(radius.all) : undefined;

  const parts = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft];
  if (parts.every((part) => !part.trim())) return undefined;
  return parts.map((part) => (part.trim() ? length(part) : '0')).join(' ');
}

function borderToCss(block: EmailBlock): string | undefined {
  const { borderStyle, borderWidth, borderColor } = block.box;
  if (borderStyle === 'none' || !borderWidth.trim()) return undefined;
  return `${length(borderWidth)} ${borderStyle} ${borderColor.trim() || '#000000'}`;
}

function typographyToCss(typography: EmailTypography, settings: EmailDocumentSettings): Declarations {
  return {
    'font-family': typography.fontFamily || settings.fontFamily,
    'font-size': length(typography.fontSize),
    'font-weight': typography.fontWeight,
    // Altura de linha sem unidade é válida e proposital (`1.6`), então só o
    // espaçamento entre letras recebe a coerção.
    'line-height': typography.lineHeight,
    'letter-spacing': typography.letterSpacing ? length(typography.letterSpacing) : undefined,
    'text-transform': typography.textTransform !== 'none' ? typography.textTransform : undefined,
    color: typography.color || settings.textColor,
    'text-align': typography.align,
  };
}

/**
 * Estilo da caixa do bloco, compartilhado entre a exportação e o canvas.
 *
 * O canvas precisa dos mesmos valores para desenhar blocos que ele monta em
 * React (colunas) em vez de injetar como HTML. Sem isso, padding e fundo de
 * uma coluna só apareceriam na pré-visualização.
 */
export function blockTableStyle(block: EmailBlock): Declarations {
  // Em imagem e botão, borda e arredondamento pertencem ao elemento visível,
  // não à tabela que o envolve: arredondar a tabela não recorta a imagem
  // (`overflow:hidden` não é confiável em cliente de email) e a borda ficaria
  // em volta do padding, longe do elemento.
  const ownsDecoration = block.type === 'image' || block.type === 'button';

  return {
    width: block.box.width.trim() ? length(block.box.width) : '100%',
    height: block.box.height.trim() ? length(block.box.height) : undefined,
    'border-collapse': 'separate',
    'background-color': block.box.backgroundColor || undefined,
    border: ownsDecoration ? undefined : borderToCss(block),
    'border-radius': ownsDecoration ? undefined : radiusToCss(block.box.radius),
  };
}

export function blockCellStyle(block: EmailBlock): Declarations {
  return {
    padding: sidesToCss(block.box.padding),
    height: block.box.height.trim() ? length(block.box.height) : undefined,
  };
}

export function blockMarginCss(block: EmailBlock): string | undefined {
  return sidesToCss(block.box.margin);
}

/** Converte declarações CSS em objeto de estilo React (camelCase). */
export function toReactStyle(declarations: Declarations): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [property, value] of Object.entries(declarations)) {
    if (value === undefined || value === '') continue;
    const key = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    style[key] = String(value);
  }
  return style;
}

/**
 * Um bloco é uma tabela autônoma. É o que permite o canvas do editor injetar
 * exatamente o mesmo HTML da exportação, bloco a bloco.
 */
export function renderBlock(block: EmailBlock, settings: EmailDocumentSettings): string {
  const width = block.box.width.trim();
  // Largura em px também vai no atributo: o Outlook ignora `width` em CSS.
  const widthAttr = width.endsWith('px') ? width.slice(0, -2) : '100%';

  const inner = [
    `<table role="presentation" width="${widthAttr}" cellpadding="0" cellspacing="0" border="0" style="` +
      css(blockTableStyle(block)) +
      '">',
    `<tr><td style="${css(blockCellStyle(block))}">`,
    renderBlockContent(block, settings),
    '</td></tr></table>',
  ].join('');

  const margin = blockMarginCss(block);
  if (!margin) return inner;

  // Margem só é confiável como padding de uma célula externa.
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
    `<tr><td style="padding:${margin};">${inner}</td></tr></table>`
  );
}

function renderBlockContent(block: EmailBlock, settings: EmailDocumentSettings): string {
  switch (block.type) {
    case 'heading':
      return renderHeading(block, settings);
    case 'text':
      return renderText(block, settings);
    case 'image':
      return renderImage(block);
    case 'button':
      return renderButton(block, settings);
    case 'divider':
      return renderDivider(block);
    case 'spacer':
      return renderSpacer(block);
    case 'html':
      return renderRawHtml(block);
    case 'columns':
      return renderColumns(block, settings);
  }
}

function renderHeading(block: EmailHeadingBlock, settings: EmailDocumentSettings): string {
  const style = css({ margin: 0, ...typographyToCss(block.typography, settings) });
  return `<h${block.level} style="${style}">${escapeHtml(block.text)}</h${block.level}>`;
}

function renderText(block: EmailTextBlock, settings: EmailDocumentSettings): string {
  const style = css({ margin: 0, ...typographyToCss(block.typography, settings) });
  const linkStyle = css({
    color: settings.linkColor,
    'text-decoration': settings.linkUnderline ? 'underline' : 'none',
  });

  // Links herdam a cor do documento: sem isso o cliente pinta de azul padrão.
  let body = block.html.replace(/<a\s/gi, `<a style="${linkStyle}" `);

  // O editor de texto rico emite parágrafos. Cliente de email não tem folha de
  // estilo, então a margem precisa ser inline em cada um — sem isso o Outlook
  // aplica a margem padrão dele e o espaçamento fica imprevisível.
  body = body
    .replace(/<p>/gi, '<p style="margin:0 0 12px;">')
    .replace(/<p\s+(?![^>]*style=)/gi, '<p style="margin:0 0 12px;" ');

  return `<div style="${style}">${body}</div>`;
}

function renderImage(block: EmailImageBlock): string {
  if (!block.src) return '';

  const width = block.width.trim() ? length(block.width) : '100%';
  const border = borderToCss(block);
  const style = css({
    display: 'block',
    width: '100%',
    'max-width': width,
    height: 'auto',
    // Arredondamento e borda vão no <img>: é o único jeito de a imagem sair
    // realmente arredondada. Outlook desktop ignora e mostra o canto reto.
    'border-radius': radiusToCss(block.box.radius),
    border: border ?? '0',
    'margin-left': block.align === 'left' ? '0' : 'auto',
    'margin-right': block.align === 'right' ? '0' : 'auto',
  });

  const numericWidth = width.endsWith('px') ? width.slice(0, -2) : '';
  const image = [
    `<img src="${attr(block.src)}"`,
    `alt="${attr(block.alt)}"`,
    numericWidth ? `width="${numericWidth}"` : '',
    `style="${style}">`,
  ]
    .filter(Boolean)
    .join(' ');

  return block.href
    ? `<a href="${attr(block.href)}" target="_blank" style="text-decoration:none;">${image}</a>`
    : image;
}

/**
 * Botão em tabela, não em <a> com padding: o Outlook desktop ignora padding
 * em elementos inline e o botão vira um link solto no meio do email.
 */
function renderButton(block: EmailButtonBlock, settings: EmailDocumentSettings): string {
  const radius = radiusToCss(block.radius);
  // A borda da caixa vai na célula do botão, o que torna possível o botão
  // vazado (fundo transparente com contorno), impossível de outro jeito.
  const cell = css({
    'background-color': block.backgroundColor,
    'border-radius': radius,
    border: borderToCss(block),
  });
  const link = css({
    display: block.fullWidth ? 'block' : 'inline-block',
    padding: `${length(block.paddingY) || '13px'} ${length(block.paddingX) || '28px'}`,
    ...typographyToCss(block.typography, settings),
    'text-decoration': 'none',
    'border-radius': radius,
  });

  const table = [
    `<table role="presentation" ${block.fullWidth ? 'width="100%" ' : ''}cellpadding="0" cellspacing="0" border="0" align="${block.typography.align}" style="${css(
      {
        'border-collapse': 'separate',
        width: block.fullWidth ? '100%' : undefined,
        // `align` em <table> é atributo obsoleto: o Outlook o respeita, mas
        // navegador moderno não é confiável. `inline-table` faz o
        // `text-align` do invólucro alinhar a tabela nos dois mundos.
        display: block.fullWidth ? undefined : 'inline-table',
      },
    )}">`,
    `<tr><td align="center" style="${cell}">`,
    `<a href="${attr(block.href)}" target="_blank" style="${link}">${escapeHtml(block.label)}</a>`,
    '</td></tr></table>',
  ].join('');

  return `<div style="text-align:${block.typography.align};">${table}</div>`;
}

function renderDivider(block: EmailDividerBlock): string {
  const thickness = block.thickness.trim() ? length(block.thickness) : '1px';
  const width = block.lineWidth.trim() ? length(block.lineWidth) : '100%';
  const style = css({
    width,
    'max-width': '100%',
    height: thickness,
    'line-height': thickness,
    'font-size': 0,
    'background-color': block.color,
    // Centralizar por margem automática funciona onde `text-align` não
    // alcança um elemento de bloco.
    'margin-left': block.align === 'left' ? '0' : 'auto',
    'margin-right': block.align === 'right' ? '0' : 'auto',
  });
  return `<div style="${style}">&nbsp;</div>`;
}

function renderSpacer(block: EmailSpacerBlock): string {
  const height = block.height.trim() ? length(block.height) : '24px';
  const style = css({ height, 'line-height': height, 'font-size': 0 });
  return `<div style="${style}">&nbsp;</div>`;
}

function renderRawHtml(block: EmailHtmlBlock): string {
  return block.code;
}

/**
 * Colunas lado a lado que empilham no mobile.
 *
 * `display:inline-block` com largura percentual funciona em quase todo lugar;
 * a tabela fantasma em conditional comment resolve o Outlook, que ignora
 * inline-block. A media query da folha do documento converte `.kodety-col` em
 * bloco de largura total abaixo de 600px.
 */
function renderColumns(block: EmailColumnsBlock, settings: EmailDocumentSettings): string {
  const count = Math.max(1, block.columns.length);
  const weights = block.widths.length === count ? block.widths : Array(count).fill(1);
  const total = weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 1), 0);
  const gap = block.gap.trim() ? length(block.gap) : '0px';

  const cells = block.columns
    .map((column, index) => {
      const share = Math.floor(((weights[index] > 0 ? weights[index] : 1) / total) * 10000) / 100;
      const content = column.map((leaf) => renderBlock(leaf, settings)).join('');
      const style = css({
        display: 'inline-block',
        width: `${share}%`,
        'max-width': '100%',
        'vertical-align': block.verticalAlign,
        // O gap vira padding lateral: gap real não existe em cliente de email.
        'padding-left': index === 0 ? undefined : gap,
        'box-sizing': 'border-box',
      });

      return [
        `<!--[if mso]><td valign="${block.verticalAlign}" width="${share}%"><![endif]-->`,
        `<div class="kodety-col" style="${style}">${content}</div>`,
        '<!--[if mso]></td><![endif]-->',
      ].join('');
    })
    .join('');

  return [
    '<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->',
    `<div style="font-size:0;line-height:0;">${cells}</div>`,
    '<!--[if mso]></tr></table><![endif]-->',
  ].join('');
}

/** Documento completo, pronto para enviar. */
export function renderEmailHtml(document: EmailDocument, title = ''): string {
  const { settings } = document;
  const body = document.blocks.map((block) => renderBlock(block, settings)).join('');
  const width = settings.width.trim() ? length(settings.width) : '600px';
  const numericWidth = width.endsWith('px') ? width.slice(0, -2) : '600';

  const bodyStyle = css({
    margin: 0,
    padding: 0,
    width: '100%',
    'background-color': settings.backgroundColor,
    '-webkit-font-smoothing': 'antialiased',
  });
  const containerStyle = css({
    width,
    'max-width': '100%',
    'background-color': settings.contentBackground,
    'border-collapse': 'collapse',
  });

  return `<!doctype html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="format-detection" content="telephone=no">
<title>${escapeHtml(title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
/* Único CSS que não pode ser inline: media query e correções por cliente. */
@media only screen and (max-width:600px){
  .kodety-col{display:block;width:100%;min-width:100%;padding-left:0;}
  .kodety-container{width:100%;}
}
body{margin:0;padding:0;}
table{border-collapse:collapse;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
/* Impede o iOS de transformar datas e endereços em links azuis. */
a[x-apple-data-detectors]{color:inherit;text-decoration:none;}
</style>
</head>
<body style="${bodyStyle}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${settings.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${numericWidth}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="kodety-container" width="${numericWidth}" cellpadding="0" cellspacing="0" border="0" style="${containerStyle}">
<tr><td style="${css({ padding: sidesToCss(settings.contentPadding) ?? '0' })}">${body}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Versão texto derivada do documento — mais fiel do que converter o HTML
 * final, porque conhece a intenção de cada bloco.
 */
export function renderEmailText(document: EmailDocument): string {
  const lines: string[] = [];

  const walk = (blocks: EmailBlock[]): void => {
    blocks.forEach((block) => {
      switch (block.type) {
        case 'heading':
          lines.push(block.text, '');
          break;
        case 'text':
          lines.push(stripTags(block.html), '');
          break;
        case 'button':
          lines.push(`${block.label}: ${block.href}`, '');
          break;
        case 'image':
          if (block.alt) lines.push(`[${block.alt}]`, '');
          break;
        case 'divider':
          lines.push('---', '');
          break;
        case 'html':
          lines.push(stripTags(block.code), '');
          break;
        case 'columns':
          block.columns.forEach((column) => walk(column));
          break;
        default:
          break;
      }
    });
  };

  walk(document.blocks);

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (
        _match,
        doubleQuoted: string,
        singleQuoted: string,
        unquoted: string,
        label: string,
      ) => {
        const href = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
        const text = label.replace(/<[^>]+>/g, '').trim();
        // Parênteses sobrevivem à remoção de tags abaixo; usar `<url>` faria
        // o próprio sanitizador interpretar a URL como markup e apagá-la.
        return text ? `${text} (${href})` : href;
      },
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
