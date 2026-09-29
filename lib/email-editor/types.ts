/**
 * Modelo do construtor de email.
 *
 * Deliberadamente independente de `lib/html-editor`: um email não tem flex,
 * grid, breakpoints do builder nem folha de estilo externa. Forçar o modelo do
 * site aqui produziria HTML que quebra no Outlook.
 *
 * O documento é a fonte de verdade e fica salvo em `project_json`. O HTML
 * exportado (`render.ts`) é derivado — nunca editado à mão.
 */

export type EmailAlign = 'left' | 'center' | 'right';

/** Valores CSS completos com unidade (`'16px'`), como o MarginPadding espera. */
export interface EmailSides {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface EmailRadius {
  mode: 'all' | 'individual';
  all: string;
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
}

/**
 * Caixa do bloco. Margem existe, mas é aplicada na célula da tabela que
 * envolve o bloco — margin em <td> é ignorada por vários clientes.
 */
export interface EmailBox {
  padding: EmailSides;
  margin: EmailSides;
  /** Largura do bloco: px ou %. Vazio ocupa a largura disponível. */
  width: string;
  /**
   * Altura mínima do bloco, aplicada na célula da tabela.
   *
   * `height` em <td> é honrada pela maioria dos clientes; em <div> não. Por
   * isso ela vive na célula, e não no conteúdo.
   */
  height: string;
  backgroundColor: string;
  borderWidth: string;
  borderStyle: 'none' | 'solid' | 'dashed' | 'dotted';
  borderColor: string;
  radius: EmailRadius;
}

export interface EmailTypography {
  /** Vazio herda a fonte do documento. */
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  color: string;
  align: EmailAlign;
}

export interface EmailBlockBase {
  id: string;
  /** Nome exibido no painel de camadas. Vazio usa o rótulo do tipo. */
  name: string;
  box: EmailBox;
}

export interface EmailTextBlock extends EmailBlockBase {
  type: 'text';
  /** HTML restrito: só ênfase, links e quebras. */
  html: string;
  typography: EmailTypography;
}

export interface EmailHeadingBlock extends EmailBlockBase {
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
  typography: EmailTypography;
}

export interface EmailImageBlock extends EmailBlockBase {
  type: 'image';
  src: string;
  /** Obrigatório: o lint bloqueia exportação sem alt. */
  alt: string;
  href: string;
  width: string;
  align: EmailAlign;
}

export interface EmailButtonBlock extends EmailBlockBase {
  type: 'button';
  label: string;
  href: string;
  backgroundColor: string;
  typography: EmailTypography;
  paddingX: string;
  paddingY: string;
  radius: EmailRadius;
  fullWidth: boolean;
}

export interface EmailDividerBlock extends EmailBlockBase {
  type: 'divider';
  color: string;
  thickness: string;
  /** Largura da linha. Vazio ocupa toda a coluna. */
  lineWidth: string;
  align: EmailAlign;
}

export interface EmailSpacerBlock extends EmailBlockBase {
  type: 'spacer';
  height: string;
}

export interface EmailHtmlBlock extends EmailBlockBase {
  type: 'html';
  code: string;
}

/**
 * Colunas empilham no mobile por media query. Gmail app ignora media query,
 * então cada coluna também é fluida — é o comportamento aceitável nos dois.
 */
export interface EmailColumnsBlock extends EmailBlockBase {
  type: 'columns';
  gap: string;
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Pesos relativos por coluna; vazio distribui igualmente. */
  widths: number[];
  columns: EmailLeafBlock[][];
}

export type EmailLeafBlock =
  | EmailTextBlock
  | EmailHeadingBlock
  | EmailImageBlock
  | EmailButtonBlock
  | EmailDividerBlock
  | EmailSpacerBlock
  | EmailHtmlBlock;

export type EmailBlock = EmailLeafBlock | EmailColumnsBlock;
export type EmailBlockType = EmailBlock['type'];
export type EmailLeafType = EmailLeafBlock['type'];

export interface EmailDocumentSettings {
  /** Largura do container. 600px é o consenso que cabe em todo cliente. */
  width: string;
  backgroundColor: string;
  contentBackground: string;
  contentPadding: EmailSides;
  fontFamily: string;
  textColor: string;
  linkColor: string;
  linkUnderline: boolean;
}

export interface EmailDocument {
  version: 2;
  settings: EmailDocumentSettings;
  blocks: EmailBlock[];
}

export interface EmailTemplateRecord {
  id: number;
  name: string;
  html: string;
  projectJson: string | null;
  updatedAt: string;
  /**
   * Revisão opaca emitida pelo servidor. Ela impede que duas abas abertas no
   * mesmo template sobrescrevam silenciosamente o trabalho uma da outra.
   */
  revision: string;
}

export interface EmailLintIssue {
  level: 'error' | 'warning';
  code?: string;
  message: string;
  blockId?: string;
}

/**
 * Stacks seguras. Webfont não carrega no Outlook nem no Gmail app, então
 * oferecer o seletor de fontes do builder aqui só produziria decepção.
 */
export const EMAIL_FONT_STACKS: { label: string; value: string }[] = [
  { label: 'Arial', value: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', Times, serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, Georgia, serif" },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Tahoma, Arial, sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, Segoe, sans-serif' },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
];

export const EMAIL_FONT_WEIGHTS: { label: string; value: string }[] = [
  { label: 'Regular', value: '400' },
  { label: 'Médio', value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold', value: '700' },
];

export function sides(value: string): EmailSides {
  return { top: value, right: value, bottom: value, left: value };
}

export function emptyRadius(value = ''): EmailRadius {
  return { mode: 'all', all: value, topLeft: '', topRight: '', bottomRight: '', bottomLeft: '' };
}

export function createBox(overrides: Partial<EmailBox> = {}): EmailBox {
  return {
    padding: sides('16px'),
    margin: sides(''),
    width: '',
    height: '',
    backgroundColor: '',
    borderWidth: '',
    borderStyle: 'none',
    borderColor: '',
    radius: emptyRadius(),
    ...overrides,
  };
}

export function createTypography(overrides: Partial<EmailTypography> = {}): EmailTypography {
  return {
    fontFamily: '',
    fontSize: '15px',
    fontWeight: '400',
    lineHeight: '1.6',
    letterSpacing: '',
    textTransform: 'none',
    color: '#3c4043',
    align: 'left',
    ...overrides,
  };
}

export const DEFAULT_EMAIL_SETTINGS: EmailDocumentSettings = {
  width: '600px',
  backgroundColor: '#f4f6f8',
  contentBackground: '#ffffff',
  contentPadding: sides('0px'),
  fontFamily: EMAIL_FONT_STACKS[0].value,
  textColor: '#1c1e21',
  linkColor: '#2563eb',
  linkUnderline: true,
};

export function createEmptyDocument(): EmailDocument {
  return { version: 2, settings: { ...DEFAULT_EMAIL_SETTINGS }, blocks: [] };
}
