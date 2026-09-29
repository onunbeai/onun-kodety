/**
 * Catálogo de blocos e seus padrões.
 *
 * Todo bloco nasce com valores que já passam no lint (alt preenchido, link de
 * descadastro no rodapé), para o autor não precisar aprender as regras de
 * email antes de conseguir a primeira exportação válida.
 */

import {
  createBox,
  createTypography,
  emptyRadius,
  sides,
  type EmailBlock,
  type EmailBlockType,
  type EmailColumnsBlock,
  type EmailLeafBlock,
  type EmailLeafType,
  type EmailTextBlock,
} from './types';

export interface EmailBlockDefinition {
  type: EmailBlockType;
  label: string;
  description: string;
  /** Colunas não podem ser aninhadas dentro de colunas. */
  leafOnly: boolean;
}

export const EMAIL_BLOCK_CATALOG: EmailBlockDefinition[] = [
  { type: 'heading', label: 'Título', description: 'Cabeçalho da seção', leafOnly: true },
  { type: 'text', label: 'Texto', description: 'Parágrafo com links e ênfase', leafOnly: true },
  { type: 'image', label: 'Imagem', description: 'Da biblioteca de mídia', leafOnly: true },
  { type: 'button', label: 'Botão', description: 'Chamada para ação', leafOnly: true },
  { type: 'columns', label: 'Colunas', description: 'Empilham no mobile', leafOnly: false },
  { type: 'divider', label: 'Divisor', description: 'Linha separadora', leafOnly: true },
  { type: 'spacer', label: 'Espaço', description: 'Respiro vertical', leafOnly: true },
  { type: 'html', label: 'HTML', description: 'Código bruto', leafOnly: true },
];

export const EMAIL_LEAF_TYPES: EmailLeafType[] = [
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'html',
];

function id(): string {
  return `b${Math.random().toString(36).slice(2, 10)}`;
}

export function createBlock(type: EmailBlockType): EmailBlock {
  const base = { id: id(), name: '' };

  switch (type) {
    case 'heading':
      return {
        ...base,
        type: 'heading',
        text: 'Seu título aqui',
        level: 1,
        box: createBox({ padding: { top: '24px', right: '24px', bottom: '8px', left: '24px' } }),
        typography: createTypography({ fontSize: '26px', fontWeight: '700', lineHeight: '1.25', color: '#111111' }),
      };

    case 'text':
      return {
        ...base,
        type: 'text',
        html: 'Escreva aqui. Use <strong>negrito</strong>, <em>itálico</em> e <a href="https://exemplo.com">links</a>.',
        box: createBox(),
        typography: createTypography(),
      };

    case 'image':
      return {
        ...base,
        type: 'image',
        src: '',
        alt: 'Descreva a imagem',
        href: '',
        width: '552px',
        align: 'center',
        box: createBox(),
      };

    case 'button':
      return {
        ...base,
        type: 'button',
        label: 'Clique aqui',
        href: 'https://exemplo.com',
        backgroundColor: '#2563eb',
        paddingX: '28px',
        paddingY: '13px',
        radius: emptyRadius('6px'),
        fullWidth: false,
        box: createBox(),
        typography: createTypography({ fontSize: '15px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'center' }),
      };

    case 'divider':
      return {
        ...base,
        type: 'divider',
        color: '#e4e7eb',
        thickness: '1px',
        lineWidth: '',
        align: 'center',
        box: createBox({ padding: { top: '8px', right: '24px', bottom: '8px', left: '24px' } }),
      };

    case 'spacer':
      return { ...base, type: 'spacer', height: '24px', box: createBox({ padding: sides('0px') }) };

    case 'html':
      return { ...base, type: 'html', code: '<p style="margin:0;">HTML bruto</p>', box: createBox() };

    case 'columns':
      return {
        ...base,
        type: 'columns',
        gap: '16px',
        verticalAlign: 'top',
        widths: [],
        columns: [[createLeaf('text')], [createLeaf('text')]],
        box: createBox({ padding: sides('8px') }),
      };
  }
}

export function createLeaf(type: EmailLeafType): EmailLeafBlock {
  return createBlock(type) as EmailLeafBlock;
}

/**
 * Rodapé pronto com o que a lei e os provedores exigem: identificação do
 * remetente e link de descadastro.
 */
export function createFooterBlock(): EmailTextBlock {
  const block = createLeaf('text') as EmailTextBlock;
  return {
    ...block,
    name: 'Rodapé legal',
    html:
      'Você recebe este email porque se inscreveu em {{site.name}}.<br>' +
      '<a href="{{unsubscribe_url}}">Cancelar inscrição</a>',
    box: createBox({ padding: { top: '24px', right: '24px', bottom: '32px', left: '24px' } }),
    typography: createTypography({ fontSize: '12px', color: '#8a9099', align: 'center' }),
  };
}

export function isColumnsBlock(block: EmailBlock): block is EmailColumnsBlock {
  return block.type === 'columns';
}

export function blockLabel(type: EmailBlockType): string {
  return EMAIL_BLOCK_CATALOG.find((entry) => entry.type === type)?.label ?? type;
}

/** Nome exibido no painel de camadas. */
export function blockDisplayName(block: EmailBlock): string {
  if (block.name.trim()) return block.name.trim();

  // Um preview do conteúdo identifica a camada muito melhor que "Texto".
  if (block.type === 'heading') return truncate(block.text) || 'Título';
  if (block.type === 'text') return truncate(stripTags(block.html)) || 'Texto';
  if (block.type === 'button') return truncate(block.label) || 'Botão';
  if (block.type === 'image') return truncate(block.alt) || 'Imagem';
  if (block.type === 'columns') return `Colunas (${block.columns.length})`;
  return blockLabel(block.type);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, limit = 28): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Clona com ids novos, para duplicar sem colidir seleção. */
export function cloneBlock(block: EmailBlock): EmailBlock {
  if (isColumnsBlock(block)) {
    return {
      ...block,
      id: id(),
      columns: block.columns.map((column) => column.map((leaf) => ({ ...leaf, id: id() }))),
    };
  }
  return { ...block, id: id() };
}
