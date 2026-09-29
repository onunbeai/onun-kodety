/**
 * Biblioteca de seções pré-desenhadas.
 *
 * Cada preset monta blocos reais do modelo — não é HTML colado. Isso significa
 * que tudo que vem daqui é editável no inspetor, passa pelo mesmo lint e sai
 * pelo mesmo renderizador. Uma seção "pronta" que não pudesse ser estilizada
 * seria um beco sem saída.
 *
 * Imagens nascem sem arquivo de propósito: o canvas mostra um marcador e o
 * lint cobra a escolha antes do envio. Embutir uma imagem de exemplo faria a
 * campanha sair com a foto errada quando alguém esquecesse de trocar.
 */

import { createBlock, createLeaf } from './blocks';
import {
  createBox,
  createEmptyDocument,
  createTypography,
  emptyRadius,
  sides,
  type EmailBlock,
  type EmailButtonBlock,
  type EmailColumnsBlock,
  type EmailDividerBlock,
  type EmailDocument,
  type EmailHeadingBlock,
  type EmailImageBlock,
  type EmailLeafBlock,
  type EmailSpacerBlock,
  type EmailTextBlock,
  type EmailTypography,
} from './types';

export type EmailSectionCategory =
  | 'header'
  | 'hero'
  | 'content'
  | 'features'
  | 'commerce'
  | 'cta'
  | 'media'
  | 'social'
  | 'footer'
  | 'utility';

export interface EmailSectionPreset {
  id: string;
  label: string;
  description: string;
  category: EmailSectionCategory;
  build: () => EmailBlock[];
}

export const EMAIL_SECTION_CATEGORIES: { id: EmailSectionCategory; label: string }[] = [
  { id: 'header', label: 'Cabeçalho' },
  { id: 'hero', label: 'Destaque' },
  { id: 'content', label: 'Conteúdo' },
  { id: 'features', label: 'Recursos' },
  { id: 'commerce', label: 'Loja' },
  { id: 'cta', label: 'Chamada' },
  { id: 'media', label: 'Mídia' },
  { id: 'social', label: 'Social' },
  { id: 'footer', label: 'Rodapé' },
  { id: 'utility', label: 'Utilitários' },
];

// --- Construtores curtos -----------------------------------------------

const INK = '#111827';
const BODY = '#3c4043';
const MUTED = '#8a9099';
const ACCENT = '#2563eb';
const SOFT = '#f4f6f8';
const LINE = '#e4e7eb';

function pad(top: string, right = top, bottom = top, left = right) {
  return { top, right, bottom, left };
}

function heading(
  text: string,
  typography: Partial<EmailTypography> = {},
  box: Partial<Parameters<typeof createBox>[0]> = {},
): EmailHeadingBlock {
  const block = createLeaf('heading') as EmailHeadingBlock;
  return {
    ...block,
    text,
    typography: createTypography({ fontSize: '26px', fontWeight: '700', lineHeight: '1.25', color: INK, ...typography }),
    box: createBox({ padding: pad('24px', '24px', '8px'), ...box }),
  };
}

function text(
  html: string,
  typography: Partial<EmailTypography> = {},
  box: Partial<Parameters<typeof createBox>[0]> = {},
): EmailTextBlock {
  const block = createLeaf('text') as EmailTextBlock;
  return {
    ...block,
    html,
    typography: createTypography({ color: BODY, ...typography }),
    box: createBox({ padding: pad('12px', '24px'), ...box }),
  };
}

function button(
  label: string,
  href = 'https://exemplo.com',
  overrides: Partial<EmailButtonBlock> = {},
): EmailButtonBlock {
  const block = createLeaf('button') as EmailButtonBlock;
  return {
    ...block,
    label,
    href,
    box: createBox({ padding: pad('16px', '24px', '24px') }),
    ...overrides,
  };
}

function image(alt: string, overrides: Partial<EmailImageBlock> = {}): EmailImageBlock {
  const block = createLeaf('image') as EmailImageBlock;
  return {
    ...block,
    alt,
    box: createBox({ padding: pad('16px', '24px') }),
    ...overrides,
  };
}

function divider(overrides: Partial<EmailDividerBlock> = {}): EmailDividerBlock {
  const block = createLeaf('divider') as EmailDividerBlock;
  return { ...block, color: LINE, ...overrides };
}

function spacer(height: string): EmailSpacerBlock {
  const block = createLeaf('spacer') as EmailSpacerBlock;
  return { ...block, height };
}

function columns(
  cells: EmailLeafBlock[][],
  overrides: Partial<EmailColumnsBlock> = {},
): EmailColumnsBlock {
  const block = createBlock('columns') as EmailColumnsBlock;
  return {
    ...block,
    name: '',
    gap: '20px',
    verticalAlign: 'top',
    widths: [],
    columns: cells,
    box: createBox({ padding: pad('16px') }),
    ...overrides,
  };
}

/** Bloco de texto compacto, usado dentro de colunas. */
function cellText(html: string, typography: Partial<EmailTypography> = {}): EmailTextBlock {
  return text(html, typography, { padding: pad('8px', '4px') });
}

function cellHeading(value: string, typography: Partial<EmailTypography> = {}): EmailHeadingBlock {
  return heading(value, { fontSize: '17px', ...typography }, { padding: pad('8px', '4px', '2px') });
}

// --- Seções -------------------------------------------------------------

export const EMAIL_SECTION_PRESETS: EmailSectionPreset[] = [
  // Cabeçalho
  {
    id: 'header-logo',
    label: 'Logo centralizado',
    description: 'Marca no topo, com respiro',
    category: 'header',
    build: () => [
      image('Logo', { width: '160px', align: 'center', box: createBox({ padding: pad('28px', '24px', '20px') }) }),
      divider(),
    ],
  },
  {
    id: 'header-logo-menu',
    label: 'Logo e menu',
    description: 'Marca à esquerda, links à direita',
    category: 'header',
    build: () => [
      columns(
        [
          [image('Logo', { width: '130px', align: 'left', box: createBox({ padding: pad('4px') }) })],
          [
            cellText(
              '<a href="https://exemplo.com">Novidades</a> &nbsp; <a href="https://exemplo.com">Loja</a> &nbsp; <a href="https://exemplo.com">Contato</a>',
              { fontSize: '13px', align: 'right' },
            ),
          ],
        ],
        { verticalAlign: 'middle', box: createBox({ padding: pad('22px', '24px') }) },
      ),
      divider(),
    ],
  },
  {
    id: 'header-preheader',
    label: 'Barra de aviso',
    description: 'Faixa colorida acima do conteúdo',
    category: 'header',
    build: () => [
      text('<a href="{{view_in_browser_url}}">Não está vendo direito? Abra no navegador</a>', {
        fontSize: '12px',
        align: 'center',
        color: MUTED,
      }, { padding: pad('12px', '24px'), backgroundColor: SOFT }),
    ],
  },

  // Destaque
  {
    id: 'hero-basic',
    label: 'Título, texto e botão',
    description: 'O destaque clássico de newsletter',
    category: 'hero',
    build: () => [
      heading('Uma manchete que prende', { fontSize: '32px', align: 'center' }, { padding: pad('40px', '24px', '12px') }),
      text(
        'Explique em uma ou duas frases o que a pessoa ganha ao continuar lendo.',
        { fontSize: '16px', align: 'center', color: MUTED },
        { padding: pad('0px', '32px', '8px') },
      ),
      button('Quero saber mais', 'https://exemplo.com', {
        typography: createTypography({ fontSize: '15px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'center' }),
      }),
    ],
  },
  {
    id: 'hero-image',
    label: 'Imagem grande',
    description: 'Imagem de topo com título abaixo',
    category: 'hero',
    build: () => [
      image('Imagem de destaque', { width: '600px', align: 'center', box: createBox({ padding: sides('0px') }) }),
      heading('Sua manchete aqui', { fontSize: '28px' }, { padding: pad('28px', '24px', '10px') }),
      text('Complete a ideia da imagem com um parágrafo curto.', {}, { padding: pad('0px', '24px', '24px') }),
    ],
  },
  {
    id: 'hero-split',
    label: 'Imagem e texto lado a lado',
    description: 'Empilha no mobile',
    category: 'hero',
    build: () => [
      columns(
        [
          [image('Imagem', { width: '260px', align: 'left', box: createBox({ padding: pad('4px') }) })],
          [
            cellHeading('Título da seção', { fontSize: '22px' }),
            cellText('Um parágrafo curto explicando o destaque.'),
            button('Ver detalhes', 'https://exemplo.com', {
              box: createBox({ padding: pad('12px', '4px', '4px') }),
              typography: createTypography({ fontSize: '14px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'left' }),
            }),
          ],
        ],
        { verticalAlign: 'middle', box: createBox({ padding: pad('24px', '20px') }) },
      ),
    ],
  },
  {
    id: 'hero-boxed',
    label: 'Caixa colorida',
    description: 'Destaque com fundo e cantos arredondados',
    category: 'hero',
    build: () => [
      columns(
        [[
          heading(
            'Novidade da semana',
            { fontSize: '24px', align: 'center', color: '#ffffff' },
            { padding: pad('28px', '28px', '8px') },
          ),
          text(
            'Descreva o anúncio em uma frase.',
            { align: 'center', color: '#dbeafe' },
            { padding: pad('0px', '28px', '28px') },
          ),
        ]],
        {
          gap: '0px',
          box: createBox({
            padding: sides('0px'),
            margin: pad('16px', '24px'),
            backgroundColor: ACCENT,
            radius: emptyRadius('12px'),
          }),
        },
      ),
    ],
  },

  // Conteúdo
  {
    id: 'content-paragraph',
    label: 'Parágrafo',
    description: 'Bloco de texto simples',
    category: 'content',
    build: () => [text('Escreva aqui o corpo da sua mensagem.')],
  },
  {
    id: 'content-title-paragraph',
    label: 'Título e parágrafo',
    description: 'Subtítulo com texto de apoio',
    category: 'content',
    build: () => [
      heading('Subtítulo da seção', { fontSize: '20px' }, { padding: pad('24px', '24px', '6px') }),
      text('O texto que desenvolve a ideia do subtítulo acima.'),
    ],
  },
  {
    id: 'content-two-columns',
    label: 'Duas colunas de texto',
    description: 'Dois assuntos lado a lado',
    category: 'content',
    build: () => [
      columns([
        [cellHeading('Primeiro assunto'), cellText('Resumo do primeiro assunto em duas linhas.')],
        [cellHeading('Segundo assunto'), cellText('Resumo do segundo assunto em duas linhas.')],
      ]),
    ],
  },
  {
    id: 'content-text-image',
    label: 'Texto e imagem',
    description: 'Texto à esquerda, imagem à direita',
    category: 'content',
    build: () => [
      columns(
        [
          [cellHeading('Título'), cellText('Parágrafo de apoio ao lado da imagem.')],
          [image('Imagem', { width: '250px', align: 'right', box: createBox({ padding: pad('4px') }) })],
        ],
        { verticalAlign: 'middle' },
      ),
    ],
  },
  {
    id: 'content-quote',
    label: 'Citação',
    description: 'Depoimento com barra lateral',
    category: 'content',
    build: () => [
      columns(
        [[
          text(
            '“Uma frase curta de quem usou o seu produto e gostou.”',
            { fontSize: '17px', lineHeight: '1.7', color: INK },
            { padding: pad('20px', '24px', '8px') },
          ),
          text(
            '<strong>Nome da pessoa</strong><br>Cargo, Empresa',
            { fontSize: '13px', color: MUTED },
            { padding: pad('0px', '24px', '20px') },
          ),
        ]],
        {
          gap: '0px',
          box: createBox({
            padding: sides('0px'),
            margin: pad('16px', '24px'),
            backgroundColor: SOFT,
            radius: emptyRadius('8px'),
          }),
        },
      ),
    ],
  },
  {
    id: 'content-article-list',
    label: 'Lista de artigos',
    description: 'Três chamadas com divisores',
    category: 'content',
    build: () => [
      heading('Nesta edição', { fontSize: '20px' }, { padding: pad('24px', '24px', '4px') }),
      text('<a href="https://exemplo.com"><strong>Título do primeiro artigo</strong></a><br>Resumo em uma linha.'),
      divider(),
      text('<a href="https://exemplo.com"><strong>Título do segundo artigo</strong></a><br>Resumo em uma linha.'),
      divider(),
      text('<a href="https://exemplo.com"><strong>Título do terceiro artigo</strong></a><br>Resumo em uma linha.'),
    ],
  },

  // Recursos
  {
    id: 'features-two',
    label: 'Dois recursos',
    description: 'Ícone, título e texto em duas colunas',
    category: 'features',
    build: () => [
      columns([
        [
          image('Ícone', { width: '48px', align: 'left', box: createBox({ padding: pad('4px') }) }),
          cellHeading('Primeiro recurso'),
          cellText('Uma frase explicando o benefício.'),
        ],
        [
          image('Ícone', { width: '48px', align: 'left', box: createBox({ padding: pad('4px') }) }),
          cellHeading('Segundo recurso'),
          cellText('Uma frase explicando o benefício.'),
        ],
      ]),
    ],
  },
  {
    id: 'features-three',
    label: 'Três recursos',
    description: 'Grade de três colunas',
    category: 'features',
    build: () => [
      columns(
        [
          [cellHeading('Rápido', { align: 'center' }), cellText('Benefício em uma linha.', { align: 'center' })],
          [cellHeading('Simples', { align: 'center' }), cellText('Benefício em uma linha.', { align: 'center' })],
          [cellHeading('Seguro', { align: 'center' }), cellText('Benefício em uma linha.', { align: 'center' })],
        ],
        { gap: '12px' },
      ),
    ],
  },
  {
    id: 'features-steps',
    label: 'Passo a passo',
    description: 'Três etapas numeradas',
    category: 'features',
    build: () => [
      heading('Como funciona', { fontSize: '20px', align: 'center' }, { padding: pad('28px', '24px', '4px') }),
      text('<strong>1.</strong> Descreva a primeira etapa.'),
      text('<strong>2.</strong> Descreva a segunda etapa.'),
      text('<strong>3.</strong> Descreva a terceira etapa.'),
    ],
  },

  // Loja
  {
    id: 'commerce-product',
    label: 'Produto',
    description: 'Imagem, nome, preço e botão',
    category: 'commerce',
    build: () => [
      image('Foto do produto', { width: '552px', align: 'center' }),
      heading('Nome do produto', { fontSize: '20px', align: 'center' }, { padding: pad('8px', '24px', '4px') }),
      text('<strong>R$ 199,00</strong>', { align: 'center', fontSize: '17px', color: INK }, { padding: pad('0px', '24px', '4px') }),
      button('Comprar agora', 'https://exemplo.com'),
    ],
  },
  {
    id: 'commerce-grid',
    label: 'Dois produtos',
    description: 'Grade com preço e botão',
    category: 'commerce',
    build: () => [
      columns([
        [
          image('Produto', { width: '250px', align: 'center', box: createBox({ padding: pad('4px') }) }),
          cellHeading('Produto um', { align: 'center', fontSize: '16px' }),
          cellText('<strong>R$ 99,00</strong>', { align: 'center' }),
          button('Ver', 'https://exemplo.com', {
            box: createBox({ padding: pad('8px', '4px') }),
            typography: createTypography({ fontSize: '13px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'center' }),
          }),
        ],
        [
          image('Produto', { width: '250px', align: 'center', box: createBox({ padding: pad('4px') }) }),
          cellHeading('Produto dois', { align: 'center', fontSize: '16px' }),
          cellText('<strong>R$ 149,00</strong>', { align: 'center' }),
          button('Ver', 'https://exemplo.com', {
            box: createBox({ padding: pad('8px', '4px') }),
            typography: createTypography({ fontSize: '13px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'center' }),
          }),
        ],
      ]),
    ],
  },
  {
    id: 'commerce-order',
    label: 'Resumo do pedido',
    description: 'Itens e total com divisores',
    category: 'commerce',
    build: () => [
      heading('Resumo do pedido', { fontSize: '18px' }, { padding: pad('24px', '24px', '8px') }),
      columns([[cellText('Produto um')], [cellText('R$ 99,00', { align: 'right' })]], {
        box: createBox({ padding: pad('4px', '20px') }),
      }),
      columns([[cellText('Produto dois')], [cellText('R$ 149,00', { align: 'right' })]], {
        box: createBox({ padding: pad('4px', '20px') }),
      }),
      divider(),
      columns(
        [[cellText('<strong>Total</strong>')], [cellText('<strong>R$ 248,00</strong>', { align: 'right' })]],
        { box: createBox({ padding: pad('4px', '20px', '20px') }) },
      ),
    ],
  },

  // Chamada
  {
    id: 'cta-button',
    label: 'Botão',
    description: 'Chamada única centralizada',
    category: 'cta',
    build: () => [button('Clique aqui')],
  },
  {
    id: 'cta-banner',
    label: 'Faixa com botão',
    description: 'Fundo suave, título e ação',
    category: 'cta',
    build: () => [
      columns(
        [[
          heading(
            'Pronto para começar?',
            { fontSize: '22px', align: 'center' },
            { padding: pad('28px', '24px', '6px') },
          ),
          text(
            'Uma frase para reforçar o convite.',
            { align: 'center', color: MUTED },
            { padding: pad('0px', '24px', '4px') },
          ),
          button('Começar agora', 'https://exemplo.com', {
            box: createBox({ padding: pad('12px', '24px', '28px') }),
          }),
        ]],
        {
          gap: '0px',
          box: createBox({
            padding: sides('0px'),
            margin: pad('16px', '24px'),
            backgroundColor: SOFT,
            radius: emptyRadius('10px'),
          }),
        },
      ),
    ],
  },
  {
    id: 'cta-double',
    label: 'Duas ações',
    description: 'Botão principal e secundário',
    category: 'cta',
    build: () => [
      columns(
        [
          [
            button('Ação principal', 'https://exemplo.com', {
              box: createBox({ padding: pad('4px') }),
              typography: createTypography({ fontSize: '14px', fontWeight: '600', lineHeight: '1', color: '#ffffff', align: 'center' }),
            }),
          ],
          [
            button('Saiba mais', 'https://exemplo.com', {
              backgroundColor: '#ffffff',
              box: createBox({ padding: pad('4px') }),
              radius: emptyRadius('6px'),
              typography: createTypography({ fontSize: '14px', fontWeight: '600', lineHeight: '1', color: ACCENT, align: 'center' }),
            }),
          ],
        ],
        { gap: '12px', box: createBox({ padding: pad('16px', '24px') }) },
      ),
    ],
  },

  // Mídia
  {
    id: 'media-single',
    label: 'Imagem',
    description: 'Imagem única com link',
    category: 'media',
    build: () => [image('Descreva a imagem', { width: '552px', align: 'center' })],
  },
  {
    id: 'media-pair',
    label: 'Duas imagens',
    description: 'Par lado a lado',
    category: 'media',
    build: () => [
      columns([
        [image('Imagem um', { width: '260px', align: 'center', box: createBox({ padding: pad('4px') }) })],
        [image('Imagem dois', { width: '260px', align: 'center', box: createBox({ padding: pad('4px') }) })],
      ]),
    ],
  },
  {
    id: 'media-trio',
    label: 'Três imagens',
    description: 'Galeria de três colunas',
    category: 'media',
    build: () => [
      columns(
        [
          [image('Imagem um', { width: '170px', align: 'center', box: createBox({ padding: pad('4px') }) })],
          [image('Imagem dois', { width: '170px', align: 'center', box: createBox({ padding: pad('4px') }) })],
          [image('Imagem três', { width: '170px', align: 'center', box: createBox({ padding: pad('4px') }) })],
        ],
        { gap: '10px' },
      ),
    ],
  },
  {
    id: 'media-caption',
    label: 'Imagem com legenda',
    description: 'Foto e texto de apoio',
    category: 'media',
    build: () => [
      image('Descreva a imagem', { width: '552px', align: 'center', box: createBox({ padding: pad('20px', '24px', '4px') }) }),
      text('Legenda da imagem.', { fontSize: '12px', align: 'center', color: MUTED }, { padding: pad('0px', '24px', '20px') }),
    ],
  },

  // Social
  {
    id: 'social-links',
    label: 'Redes sociais',
    description: 'Links de perfil centralizados',
    category: 'social',
    build: () => [
      text(
        '<a href="https://instagram.com/">Instagram</a> &nbsp;·&nbsp; <a href="https://facebook.com/">Facebook</a> &nbsp;·&nbsp; <a href="https://linkedin.com/">LinkedIn</a>',
        { fontSize: '13px', align: 'center', color: MUTED },
        { padding: pad('20px', '24px') },
      ),
    ],
  },
  {
    id: 'social-icons',
    label: 'Ícones sociais',
    description: 'Três ícones em colunas',
    category: 'social',
    build: () => [
      columns(
        [
          [image('Instagram', { width: '28px', align: 'center', href: 'https://instagram.com/', box: createBox({ padding: pad('4px') }) })],
          [image('Facebook', { width: '28px', align: 'center', href: 'https://facebook.com/', box: createBox({ padding: pad('4px') }) })],
          [image('LinkedIn', { width: '28px', align: 'center', href: 'https://linkedin.com/', box: createBox({ padding: pad('4px') }) })],
        ],
        // Padding fixo muito grande esmagava as três colunas no preview
        // mobile. 120px mantém o grupo compacto no desktop e ainda deixa
        // largura real para os ícones em containers estreitos.
        { gap: '8px', box: createBox({ padding: pad('16px', '120px') }) },
      ),
    ],
  },

  // Rodapé
  {
    id: 'footer-simple',
    label: 'Rodapé simples',
    description: 'Descadastro e identificação',
    category: 'footer',
    build: () => [
      divider(),
      text(
        'Você recebe este email porque se inscreveu em {{site.name}}.<br><a href="{{unsubscribe_url}}">Cancelar inscrição</a>',
        { fontSize: '12px', align: 'center', color: MUTED },
        { padding: pad('24px', '24px', '32px') },
      ),
    ],
  },
  {
    id: 'footer-full',
    label: 'Rodapé completo',
    description: 'Endereço, preferências e descadastro',
    category: 'footer',
    build: () => [
      divider(),
      text('<strong>{{site.name}}</strong><br>Rua Exemplo, 123 — Cidade, Estado, CEP', {
        fontSize: '12px',
        align: 'center',
        color: MUTED,
      }, { padding: pad('24px', '24px', '6px') }),
      text(
        '<a href="{{view_in_browser_url}}">Ver no navegador</a> &nbsp;·&nbsp; <a href="{{unsubscribe_url}}">Cancelar inscrição</a>',
        { fontSize: '12px', align: 'center', color: MUTED },
        { padding: pad('0px', '24px', '32px') },
      ),
    ],
  },
  {
    id: 'footer-dark',
    label: 'Rodapé escuro',
    description: 'Faixa escura com descadastro',
    category: 'footer',
    build: () => [
      text(
        '{{site.name}}<br><a href="{{unsubscribe_url}}">Cancelar inscrição</a>',
        { fontSize: '12px', align: 'center', color: '#9aa1ab' },
        { padding: pad('28px', '24px'), backgroundColor: '#16181b' },
      ),
    ],
  },

  // Utilitários
  {
    id: 'utility-divider',
    label: 'Divisor',
    description: 'Linha separadora',
    category: 'utility',
    build: () => [divider()],
  },
  {
    id: 'utility-spacer',
    label: 'Espaço',
    description: 'Respiro vertical',
    category: 'utility',
    build: () => [spacer('32px')],
  },
  {
    id: 'utility-browser',
    label: 'Ver no navegador',
    description: 'Link de fallback no topo',
    category: 'utility',
    build: () => [
      text('<a href="{{view_in_browser_url}}">Ver esta mensagem no navegador</a>', {
        fontSize: '11px',
        align: 'center',
        color: MUTED,
      }, { padding: pad('10px', '24px') }),
    ],
  },
];

// --- Templates completos -------------------------------------------------

export interface EmailStarterTemplate {
  id: string;
  label: string;
  description: string;
  build: () => EmailDocument;
}

function documentFrom(sectionIds: string[]): EmailDocument {
  const document = createEmptyDocument();
  document.blocks = sectionIds.flatMap((id) => {
    const preset = EMAIL_SECTION_PRESETS.find((entry) => entry.id === id);
    return preset ? preset.build() : [];
  });
  return document;
}

/**
 * Todos terminam em rodapé com `{{unsubscribe_url}}`: começar de um template
 * já válido no lint evita o erro de descadastro que trava o disparo.
 */
export const EMAIL_STARTER_TEMPLATES: EmailStarterTemplate[] = [
  {
    id: 'newsletter',
    label: 'Newsletter',
    description: 'Cabeçalho, destaque, lista de artigos e rodapé',
    build: () => documentFrom(['header-logo', 'hero-basic', 'content-article-list', 'social-links', 'footer-full']),
  },
  {
    id: 'announcement',
    label: 'Anúncio',
    description: 'Imagem grande, benefícios e chamada',
    build: () => documentFrom(['header-logo', 'hero-image', 'features-three', 'cta-banner', 'footer-simple']),
  },
  {
    id: 'welcome',
    label: 'Boas-vindas',
    description: 'Saudação, passo a passo e ação',
    build: () => documentFrom(['header-logo', 'hero-basic', 'features-steps', 'cta-button', 'footer-simple']),
  },
  {
    id: 'product',
    label: 'Lançamento de produto',
    description: 'Produto em destaque e grade de itens',
    build: () => documentFrom(['header-logo-menu', 'commerce-product', 'commerce-grid', 'cta-banner', 'footer-full']),
  },
  {
    id: 'digest',
    label: 'Resumo semanal',
    description: 'Duas colunas de conteúdo e depoimento',
    build: () => documentFrom(['header-preheader', 'header-logo', 'content-two-columns', 'content-quote', 'footer-simple']),
  },
  {
    id: 'blank',
    label: 'Em branco',
    description: 'Só o rodapé obrigatório',
    build: () => documentFrom(['footer-simple']),
  },
];
