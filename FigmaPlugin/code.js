/* Figma to Kodety — deliberately dependency-free so this folder can be
 * imported directly through Figma > Plugins > Development > Import plugin
 * from manifest without a build step. */

const SIGNATURE = '__kodety_figma__';
const VERSION = 5;
const ENGINE_VERSION = 5;
const SHARED_PLUGIN_NAMESPACE = 'kodety';
const SHARED_SEMANTIC_KEY = 'semantic';
const REST_SCENE_VERSION = 1;
const MAX_NODES = 100000;
const MAX_ASSETS = 10000;
const MAX_EXPORT_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_REST_SCENE_CHARACTERS = 16 * 1024 * 1024;
const MAX_NATIVE_CSS_NODES = 5000;
const MAX_RICH_TEXT_SEGMENTS = 50000;
const MAX_RICH_TEXT_SEGMENTS_PER_NODE = 10000;
const YIELD_EVERY = 80;
const COLLECT_YIELD_EVERY = 800;
// Paint-only sampling nodes never belong to the user's selection. Remember
// their IDs until delayed Figma nodechange notifications have been delivered.
const ignoredTransientNodeIds = new Set();
const activeTransientPaintNodes = new Map();

function cleanupTransientPaintNodes() {
  for (const [id, node] of activeTransientPaintNodes) {
    if (!node.removed) node.remove();
    activeTransientPaintNodes.delete(id);
  }
}

const I18N = Object.freeze({
  en: Object.freeze({
    windowTitle: 'Figma to Kodety',
    productName: 'Figma to Kodety',
    productSubtitle: 'Convert the selected Figma section into editable Kodety code.',
    tabCopy: 'Copy to Kodety',
    selectionTitle: 'Current selection',
    selectionCountOne: '{count} layer selected',
    selectionCountOther: '{count} layers selected',
    selectionReady: 'Selection ready',
    selectionNone: 'No selection',
    selectionDetail: 'Ready to become one editable section in the Kodety Builder.',
    selectionEmpty: 'Select a frame, component, or one or more layers.',
    copyLocalNote: 'Conversion happens locally and the Builder receives one versioned, transactional package.',
    heading: 'Copy design to Kodety',
    subtitle: 'Converts the selection into editable HTML, CSS, images, fonts, and variables.',
    stepSelectTitle: 'Select in Figma',
    stepSelectDetail: 'Frames, components, or multiple layers.',
    stepCopyTitle: 'Convert and review',
    stepCopyDetail: 'Copy only when you are ready.',
    stepPasteTitle: 'Paste in the Builder',
    stepPasteDetail: 'Use ⌘ V or Ctrl V on the canvas.',
    ready: 'Ready to convert',
    privacy: 'Nothing leaves this file without your action.',
    fontsTitle: 'Design fonts',
    fontsHelp: 'The Builder automatically configures recognized Google Fonts when you paste. Attach files only for private fonts or a specific licensed version.',
    selectFonts: 'Select .woff2, .woff, .ttf, or .otf',
    fontLicense: 'Files are only included in the copied package. Confirm that your license allows embedding them on the site.',
    convertCopy: 'Convert section',
    close: 'Close',
    downloadPackage: 'Download JSON',
    footer: 'Local by default · versioned transfer · editable output',
    converting: 'Converting…',
    copyBuilder: 'Copy to clipboard',
    matchingFace: 'Matching face for {name}',
    regular: 'Regular',
    missingInFigma: 'missing in Figma',
    prepareFontsCopy: 'Prepare fonts and copy',
    fontsTooLarge: 'The fonts exceed 48 MB. Reduce the set before copying.',
    associateFont: 'Could not associate “{name}” with a design face.',
    duplicateFont: 'More than one file is associated with {family} · {style}. Choose a different face for each file.',
    clipboardDenied: 'Figma blocked clipboard access.',
    preparingFonts: 'Preparing fonts',
    preparingPackage: 'Preparing package',
    copied: 'Copied to Kodety',
    pasteBuilder: 'Now paste into the Builder canvas with ⌘/Ctrl+V.',
    copyAgain: 'Copy again',
    copiedNotify: 'Design copied. Paste it into the Kodety canvas with ⌘/Ctrl+V.',
    clipboardFocus: 'Figma blocked the clipboard. Keep this window focused and try again.',
    analyzingSelection: 'Analyzing selection',
    largeLayouts: 'Large layouts are processed in batches to keep Figma responsive.',
    fileReadyOne: '{count} file ready. Check its assigned face and copy again.',
    fileReadyOther: '{count} files ready. Check each assigned face and copy again.',
    noFontAttached: 'Font families and styles are included. The Builder resolves Google Fonts automatically; private fonts may need licensed files.',
    convertFailed: 'Could not convert',
    faceCountOne: '{count} face',
    faceCountOther: '{count} faces',
    missingCountOne: '{count} missing',
    missingCountOther: '{count} missing',
    conversionComplete: 'Conversion complete',
    clipboardBlocked: 'The clipboard was blocked. Click “Copy to the Builder” to authorize it, or download the package.',
    stats: '{nodes} layers · {assets} assets. Now paste into the Builder canvas.',
    imageReadWarning: 'A Figma image could not be read ({hash}).',
    assetLimit: 'The design exceeds 10,000 assets.',
    assetBytesLimit: 'The exported assets exceed 64 MB.',
    clipboardPackageTooLarge: 'The final clipboard package exceeds 92 MB. Reduce images or attached fonts and try again.',
    imageConversionWarning: 'A Figma image failed to convert ({hash}).',
    exportCancelled: 'Export cancelled.',
    readingImages: 'Reading images',
    imageOriginalWarning: 'The exact PNG export failed for “{name}”. Review this layer; any available approximation may differ.',
    vectorSimplifiedWarning: 'The vector “{name}” did not produce a reliable SVG; Kodety used the safest high-fidelity fallback available.',
    nodeLimit: 'The design exceeds 100,000 layers.',
    convertingLayers: 'Converting {count} layers',
    variablesWarning: 'Local variables could not be exported.',
    selectionRequired: 'Select at least one layer or frame in Figma.',
    preparingImagesVariables: 'Preparing images and variables',
    preparingLayers: 'Preparing {count} layers',
    missingFontsWarning: 'The selection uses one or more fonts missing from Figma; Kodety kept the declared family and added a safe fallback.',
    figmaSelection: 'Figma selection',
    figmaDocument: 'Figma document',
    page: 'Page',
    richTextSimplifiedWarning: 'Text with too many styles was simplified to keep the export stable.',
    restSnapshotWarning: 'The REST V1 snapshot was unavailable for “{name}”; the live Plugin API fallback was used.',
    restSnapshotTooLargeWarning: 'The REST V1 scene exceeded 16 MB and was used during conversion without being embedded in the package.',
    responsiveFallbackWarning: '“{name}” has no Auto Layout or reliable layout inference. Its absolute geometry was preserved for pixel fidelity.',
    semanticApplied: 'Semantic tag applied to {count} selected layer(s).',
    semanticApplyFailed: 'Figma could not apply this semantic tag to the current selection.',
    responsivePixel: 'Pixel perfect',
    responsiveSafe: 'Auto Layout',
    responsiveSmart: 'Smart layout',
    restV1: 'Live REST V1 scene',
    restHelp: 'The live selection is normalized with Figma JSON_REST_V1. No access token is stored or required.',
    semanticTitle: 'Semantic layer',
    semanticHelp: 'Tag the selected layer so Kodety creates the correct HTML element.',
    semanticTagLabel: 'HTML tag',
    semanticNav: 'Navbar · nav',
    semanticHeader: 'Header',
    semanticMain: 'Main content',
    semanticSection: 'Section',
    semanticArticle: 'Article',
    semanticAside: 'Sidebar · aside',
    semanticFooter: 'Footer',
    semanticHeading1: 'Heading 1',
    semanticHeading2: 'Heading 2',
    semanticHeading3: 'Heading 3',
    semanticHeading4: 'Heading 4',
    semanticHeading5: 'Heading 5',
    semanticHeading6: 'Heading 6',
    semanticParagraph: 'Paragraph',
    semanticSpan: 'Inline text · span',
    semanticButton: 'Button',
    semanticLink: 'Link',
    semanticList: 'Unordered list',
    semanticOrderedList: 'Ordered list',
    semanticListItem: 'List item',
    semanticForm: 'Form',
    semanticLabelTag: 'Form label',
    semanticContainer: 'Generic container',
    applyTag: 'Apply to selection',
    optionsTitle: 'Conversion strategy',
    conversionDetails: 'Conversion details',
    responsiveTitle: 'Responsive output',
    responsiveHelp: 'Pixel perfect keeps the original dimensions. Auto Layout adapts widths, text wrapping and spacing for notebook, tablet and mobile, reorganizing wide content rows and grids. Smart also infers clear rows or columns in free layouts and scales large headings. Absolute artwork keeps its geometry.',
    convertFirstHelp: 'Conversion prepares the package only. Clipboard access always requires your explicit click.',
    convertedTitle: 'Package ready',
    convertedHelp: 'Review the diagnostics, then click Copy to clipboard.',
    diagnosticsTitle: 'Conversion diagnostics',
    warningCountOne: '{count} warning',
    warningCountOther: '{count} warnings',
    noWarnings: 'No fidelity warnings',
    restNodesStat: '{count} REST nodes',
    responsiveRulesStat: '{count} responsive rules',
    fallbackStat: '{count} rendered images',
    clipboardExplicit: 'Clipboard is only called from this button.',
    diagnosticAbsolute: 'Free layout preserved at its original geometry. Review the smaller viewports.',
    diagnosticInferred: 'A clear row or column was inferred from the layer positions.',
    diagnosticStacked: 'This row and its children adapt to a column on mobile.',
    diagnosticMissingFont: 'This font is missing in Figma. Its declared family is preserved; the Builder checks Google Fonts automatically. Private fonts may need licensed files.',
    diagnosticMinimum: 'The authored minimum width exceeds the mobile viewport and was preserved.',
    diagnosticReference: 'Preparing the Figma reference',
    diagnosticCropFallback: 'The precise crop could not be exported. Review the approximate original-image fallback.',
    diagnosticAnimationSnapshot: 'The exact crop preserves a still frame of this animated image. The animation is not included.',
    diagnosticBackgroundSvg: 'The complex background is preserved as SVG; the content and layout remain editable.',
    diagnosticBackgroundPng: 'The complex background needed PNG; the content and layout remain editable.',
    diagnosticBackgroundApproximate: 'The native background export was unavailable. Review the CSS approximation.',
    diagnosticBackgroundMode: 'A variable mode could not be copied to the background sample. Review its colors.',
    diagnosticBackdropBlend: 'This paint blends with content outside the layer. Review the result against its destination background.',
    diagnosticStrokeApproximate: 'This border uses a complex stroke. Review its dashed pattern or corner smoothing in the destination.',
    diagnosticStrokeSnapshot: 'An external painted border and clipped content require a native visual asset. Its contents are not separately editable.',
    diagnosticStrokeClipping: 'Native export failed for this external painted border. Its outer edge may be clipped; review this layer.',
    diagnosticRasterFallback: 'This layer needed a PNG snapshot to preserve its appearance.',
    previewTitle: 'Preview your section',
    previewLocal: 'Local preview',
    previewWidth: 'Preview width',
    previewDesktop: 'Desktop',
    previewTablet: 'Tablet',
    previewMobile: 'Mobile',
    previewSource: 'Preview source',
    previewFrameTitle: 'Converted section preview',
    previewReferenceAlt: 'Original Figma selection',
    previewUnavailable: 'Preview is unavailable here. Your converted package is still ready to copy.',
    previewScroll: 'Scroll inside the preview to explore your section.',
    previewFonts: 'Offline preview: attach fonts for exact typography. Google Fonts load in the Builder.',
    previewReference: 'Original selection from Figma. Responsive controls apply to the Kodety view.',
    diagnosticLayerDetails: 'Layer details',
    diagnosticFocus: 'Locate {name} in Figma',
  }),
  'pt-BR': Object.freeze({
    windowTitle: 'Figma to Kodety',
    productName: 'Figma to Kodety',
    productSubtitle: 'Converta a seção selecionada do Figma em código editável no Kodety.',
    tabCopy: 'Copiar para Kodety',
    selectionTitle: 'Seleção atual',
    selectionCountOne: '{count} camada selecionada',
    selectionCountOther: '{count} camadas selecionadas',
    selectionReady: 'Seleção pronta',
    selectionNone: 'Nenhuma seleção',
    selectionDetail: 'Pronta para virar uma seção editável no Builder do Kodety.',
    selectionEmpty: 'Selecione um frame, componente ou uma ou mais camadas.',
    copyLocalNote: 'A conversão acontece localmente e o Builder recebe um único pacote versionado e transacional.',
    heading: 'Copiar design para o Kodety',
    subtitle: 'Converte a seleção em HTML, CSS, imagens, fontes e variáveis editáveis.',
    stepSelectTitle: 'Selecione no Figma',
    stepSelectDetail: 'Frames, componentes ou múltiplas camadas.',
    stepCopyTitle: 'Converta e revise',
    stepCopyDetail: 'Copie só quando estiver pronto.',
    stepPasteTitle: 'Cole no Editor visual',
    stepPasteDetail: 'Use ⌘ V ou Ctrl V na área de edição.',
    ready: 'Pronto para converter',
    privacy: 'Nada sai deste arquivo sem a sua ação.',
    fontsTitle: 'Fontes do design',
    fontsHelp: 'O Builder configura automaticamente as Google Fonts reconhecidas ao colar. Anexe arquivos apenas para fontes privadas ou uma versão licenciada específica.',
    selectFonts: 'Selecionar .woff2, .woff, .ttf ou .otf',
    fontLicense: 'Os arquivos só entram no pacote copiado. Confirme que sua licença permite incorporá-los ao site.',
    convertCopy: 'Converter seção',
    close: 'Fechar',
    downloadPackage: 'Baixar JSON',
    footer: 'Local por padrão · transferência versionada · saída editável',
    converting: 'Convertendo…',
    copyBuilder: 'Copiar para Kodety',
    matchingFace: 'Face correspondente a {name}',
    regular: 'Regular',
    missingInFigma: 'ausente no Figma',
    prepareFontsCopy: 'Preparar fontes e copiar',
    fontsTooLarge: 'As fontes excedem 48 MB. Reduza o conjunto antes de copiar.',
    associateFont: 'Não foi possível associar “{name}” a uma face do design.',
    duplicateFont: 'Há mais de um arquivo associado a {family} · {style}. Escolha uma face diferente para cada arquivo.',
    clipboardDenied: 'O Figma bloqueou o acesso à área de transferência.',
    preparingFonts: 'Preparando fontes',
    preparingPackage: 'Preparando pacote',
    copied: 'Copiado para o Kodety',
    pasteBuilder: 'Agora cole na área de edição do Editor visual com ⌘/Ctrl+V.',
    copyAgain: 'Copiar novamente',
    copiedNotify: 'Design copiado. Cole na área de edição do Kodety com ⌘/Ctrl+V.',
    clipboardFocus: 'O Figma bloqueou a área de transferência. Mantenha esta janela em foco e tente novamente.',
    analyzingSelection: 'Analisando a seleção',
    largeLayouts: 'Leiautes grandes são processados em lotes para manter o Figma responsivo.',
    fileReadyOne: '{count} arquivo pronto. Confira a face e copie novamente.',
    fileReadyOther: '{count} arquivos prontos. Confira a face de cada um e copie novamente.',
    noFontAttached: 'Famílias e estilos estão incluídos. O Builder resolve Google Fonts automaticamente; fontes privadas podem precisar dos arquivos licenciados.',
    convertFailed: 'Não foi possível converter',
    faceCountOne: '{count} face',
    faceCountOther: '{count} faces',
    missingCountOne: '{count} ausente',
    missingCountOther: '{count} ausentes',
    conversionComplete: 'Conversão concluída',
    clipboardBlocked: 'A área de transferência foi bloqueada. Clique em “Copiar para o Editor visual” para autorizar ou baixe o pacote.',
    stats: '{nodes} camadas · {assets} recursos. Agora cole na área de edição do Editor visual.',
    imageReadWarning: 'Uma imagem do Figma não pôde ser lida ({hash}).',
    assetLimit: 'O design excede 10.000 recursos.',
    assetBytesLimit: 'Os recursos exportados excedem 64 MB.',
    clipboardPackageTooLarge: 'O pacote final da área de transferência excede 92 MB. Reduza as imagens ou fontes anexadas e tente novamente.',
    imageConversionWarning: 'Uma imagem do Figma falhou ao ser convertida ({hash}).',
    exportCancelled: 'Exportação cancelada.',
    readingImages: 'Lendo imagens',
    imageOriginalWarning: 'A exportação PNG exata falhou para “{name}”. Confira esta camada; a aproximação disponível pode ser diferente.',
    vectorSimplifiedWarning: 'O vetor “{name}” não gerou um SVG confiável; o Kodety usou o fallback seguro de maior fidelidade disponível.',
    nodeLimit: 'O design excede 100.000 camadas.',
    convertingLayers: 'Convertendo {count} camadas',
    variablesWarning: 'As variáveis locais não puderam ser exportadas.',
    selectionRequired: 'Selecione ao menos uma camada ou quadro no Figma.',
    preparingImagesVariables: 'Preparando imagens e variáveis',
    preparingLayers: 'Preparando {count} camadas',
    missingFontsWarning: 'A seleção usa uma ou mais fontes ausentes no Figma; o Kodety manteve a família declarada e adicionou uma alternativa segura.',
    figmaSelection: 'Seleção do Figma',
    figmaDocument: 'Documento do Figma',
    page: 'Página',
    richTextSimplifiedWarning: 'Um texto com estilos demais foi simplificado para manter a exportação estável.',
    restSnapshotWarning: 'O snapshot REST V1 não estava disponível para “{name}”; foi usado o fallback da Plugin API ao vivo.',
    restSnapshotTooLargeWarning: 'A cena REST V1 excedeu 16 MB e foi usada na conversão sem ser incorporada ao pacote.',
    responsiveFallbackWarning: '“{name}” não possui Auto Layout nem inferência confiável. A geometria absoluta foi preservada para fidelidade visual.',
    semanticApplied: 'Tag semântica aplicada a {count} camada(s) selecionada(s).',
    semanticApplyFailed: 'O Figma não conseguiu aplicar essa tag semântica à seleção atual.',
    responsivePixel: 'Pixel perfeito',
    responsiveSafe: 'Auto Layout',
    responsiveSmart: 'Inteligente',
    restV1: 'Cena REST V1 ao vivo',
    restHelp: 'A seleção ao vivo é normalizada com o JSON_REST_V1 do Figma. Nenhum token de acesso é armazenado ou exigido.',
    semanticTitle: 'Camada semântica',
    semanticHelp: 'Marque a camada selecionada para o Kodety criar o elemento HTML correto.',
    semanticTagLabel: 'Tag HTML',
    semanticNav: 'Navbar · nav',
    semanticHeader: 'Cabeçalho · header',
    semanticMain: 'Conteúdo principal · main',
    semanticSection: 'Seção · section',
    semanticArticle: 'Artigo · article',
    semanticAside: 'Barra lateral · aside',
    semanticFooter: 'Rodapé · footer',
    semanticHeading1: 'Título 1 · h1',
    semanticHeading2: 'Título 2 · h2',
    semanticHeading3: 'Título 3 · h3',
    semanticHeading4: 'Título 4 · h4',
    semanticHeading5: 'Título 5 · h5',
    semanticHeading6: 'Título 6 · h6',
    semanticParagraph: 'Parágrafo · p',
    semanticSpan: 'Texto inline · span',
    semanticButton: 'Botão · button',
    semanticLink: 'Link · a',
    semanticList: 'Lista sem ordem · ul',
    semanticOrderedList: 'Lista ordenada · ol',
    semanticListItem: 'Item de lista · li',
    semanticForm: 'Formulário · form',
    semanticLabelTag: 'Rótulo de campo · label',
    semanticContainer: 'Contêiner genérico · div',
    applyTag: 'Aplicar à seleção',
    optionsTitle: 'Estratégia de conversão',
    conversionDetails: 'Detalhes da conversão',
    responsiveTitle: 'Saída responsiva',
    responsiveHelp: 'Pixel perfeito mantém as dimensões originais. Auto Layout adapta larguras, quebras de texto e espaçamentos para notebook, tablet e celular, reorganizando linhas largas e grades de conteúdo. Inteligente também identifica linhas ou colunas claras em layouts livres e ajusta títulos grandes. Arte absoluta mantém sua geometria.',
    convertFirstHelp: 'A conversão apenas prepara o pacote. O clipboard sempre exige seu clique explícito.',
    convertedTitle: 'Pacote pronto',
    convertedHelp: 'Revise o diagnóstico e depois clique em Copiar para a área de transferência.',
    diagnosticsTitle: 'Diagnóstico da conversão',
    warningCountOne: '{count} aviso',
    warningCountOther: '{count} avisos',
    noWarnings: 'Nenhum aviso de fidelidade',
    restNodesStat: '{count} nós REST',
    responsiveRulesStat: '{count} regras responsivas',
    fallbackStat: '{count} imagens renderizadas',
    clipboardExplicit: 'O clipboard só é acionado por este botão.',
    diagnosticAbsolute: 'Layout livre preservado na geometria original. Confira os tamanhos menores.',
    diagnosticInferred: 'Uma linha ou coluna clara foi identificada pelas posições das camadas.',
    diagnosticStacked: 'Esta linha e seus filhos se adaptam para uma coluna no celular.',
    diagnosticMissingFont: 'Esta fonte está ausente no Figma. A família declarada foi preservada; o Builder consulta Google Fonts automaticamente. Fontes privadas podem precisar dos arquivos licenciados.',
    diagnosticMinimum: 'A largura mínima definida no Figma ultrapassa o celular e foi preservada.',
    diagnosticReference: 'Preparando a referência do Figma',
    diagnosticCropFallback: 'Não foi possível exportar o recorte exato. Confira a aproximação feita com a imagem original.',
    diagnosticAnimationSnapshot: 'O recorte exato preserva um quadro desta imagem animada. A animação não está incluída.',
    diagnosticBackgroundSvg: 'O fundo complexo foi preservado em SVG; o conteúdo e o layout continuam editáveis.',
    diagnosticBackgroundPng: 'O fundo complexo precisou de PNG; o conteúdo e o layout continuam editáveis.',
    diagnosticBackgroundApproximate: 'A exportação nativa do fundo não ficou disponível. Confira a aproximação em CSS.',
    diagnosticBackgroundMode: 'Um modo de variables não pôde ser copiado para a amostra do fundo. Confira as cores.',
    diagnosticBackdropBlend: 'Esta pintura se mistura com conteúdo fora da camada. Confira o resultado sobre o fundo de destino.',
    diagnosticStrokeApproximate: 'Esta borda usa um traço complexo. Confira o padrão tracejado ou a suavização dos cantos no destino.',
    diagnosticStrokeSnapshot: 'A borda externa pintada com conteúdo recortado exige um asset visual nativo. Seu conteúdo não fica editável separadamente.',
    diagnosticStrokeClipping: 'A exportação nativa desta borda externa falhou. Seu contorno externo pode ser recortado; confira esta camada.',
    diagnosticRasterFallback: 'Esta camada precisou de uma imagem PNG para preservar a aparência.',
    previewTitle: 'Prévia da sua seção',
    previewLocal: 'Prévia local',
    previewWidth: 'Largura da prévia',
    previewDesktop: 'Desktop',
    previewTablet: 'Tablet',
    previewMobile: 'Celular',
    previewSource: 'Origem da prévia',
    previewFrameTitle: 'Prévia da seção convertida',
    previewReferenceAlt: 'Seleção original do Figma',
    previewUnavailable: 'A prévia está indisponível aqui. Seu pacote convertido continua pronto para copiar.',
    previewScroll: 'Role dentro da prévia para explorar sua seção.',
    previewFonts: 'Prévia offline: anexe fontes para a tipografia exata. Google Fonts carregam no Builder.',
    previewReference: 'Seleção original do Figma. Os controles responsivos se aplicam à visualização Kodety.',
    diagnosticLayerDetails: 'Detalhes das camadas',
    diagnosticFocus: 'Localizar {name} no Figma',
  }),
});

globalThis.KodetyFigmaI18n = I18N;
let activeLocale = 'en';
let commandExportPending = figma.command === 'copy-selection';

function normalizeLocale(value) {
  return /^pt(?:-|$)/i.test(String(value || '')) ? 'pt-BR' : 'en';
}

function translate(key, replacements = {}) {
  const template = I18N[activeLocale][key] || I18N.en[key] || key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => String(replacements[name] ?? `{${name}}`));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(activeLocale);
}

figma.showUI(__html__, { width: 460, height: 720, themeColors: true });

let cancelled = false;
let exportInFlight = false;
let activeExportSelectionKey = '';
let queuedExportSelectionKey = '';
let queuedExportOptions = null;
let documentRevision = 0;
let observedPage = null;
let lastDiagnosticNodes = new Map();
let lastDiagnosticPageId = '';

function currentSelectionKey() {
  return `${documentRevision}:${figma.currentPage.selection.map(node => node.id).join('\u001f')}`;
}

function post(type, payload) {
  const message = { type, ...payload };
  if (
    (type === 'progress' || type === 'payload' || type === 'error')
    && activeExportSelectionKey
    && message.selectionKey === undefined
  ) {
    message.selectionKey = activeExportSelectionKey;
  }
  figma.ui.postMessage(message);
}

function safe(value, fallback = 'layer') {
  const result = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 90);
  return result || fallback;
}

const SEMANTIC_TAGS = new Set([
  'div', 'section', 'header', 'nav', 'main', 'article', 'aside', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button',
  'ul', 'ol', 'li', 'form', 'label',
]);

function cleanLayerName(value) {
  return String(value || '')
    .replace(/(?:\s*#tag:(?:div|section|header|nav|main|article|aside|footer|h[1-6]|p|span|a|button|ul|ol|li|form|label)\b)+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function readSemanticMetadata(node) {
  if (!node || typeof node.getSharedPluginData !== 'function') return {};
  try {
    const raw = node.getSharedPluginData(SHARED_PLUGIN_NAMESPACE, SHARED_SEMANTIC_KEY);
    if (!raw || raw.length > 100000) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1) return {};
    const tag = String(parsed.tag || '').toLowerCase();
    return {
      schema: 1,
      ...(SEMANTIC_TAGS.has(tag) ? { tag } : {}),
      ...(typeof parsed.label === 'string' && parsed.label.trim()
        ? { label: parsed.label.trim().slice(0, 160) }
        : {}),
      ...(parsed.a11y && typeof parsed.a11y === 'object'
        ? {
            a11y: {
              ...(typeof parsed.a11y.label === 'string' && parsed.a11y.label.trim()
                ? { label: parsed.a11y.label.trim().slice(0, 240) }
                : {}),
              ...(typeof parsed.a11y.alt === 'string'
                ? { alt: parsed.a11y.alt.trim().slice(0, 1000) }
                : {}),
            },
          }
        : {}),
    };
  } catch {
    return {};
  }
}

function semanticTagFromName(node) {
  const name = String(node && node.name || '').toLowerCase();
  const explicit = name.match(/(?:#tag:|\[)(div|section|main|header|footer|nav|article|aside|button|a|h[1-6]|p|span|ul|ol|li|form|label)(?:\]|\b)/);
  return explicit ? explicit[1] : '';
}

function selectionSummary() {
  const selection = figma.currentPage.selection;
  return {
    selectionCount: selection.length,
    selectionKey: currentSelectionKey(),
    selectionNames: selection.slice(0, 8).map(node => cleanLayerName(node.name) || node.type),
    selectionTags: selection.slice(0, 8).map(node => (
      readSemanticMetadata(node).tag || semanticTagFromName(node) || ''
    )),
  };
}

function normalizeExportOptions(value) {
  const source = value && typeof value === 'object' ? value : {};
  const responsiveMode = ['pixel', 'safe', 'smart'].includes(source.responsiveMode)
    ? source.responsiveMode
    : 'safe';
  return {
    responsiveMode,
    includeRestScene: source.includeRestScene !== false,
  };
}

function currentFigmaFileKey() {
  try {
    const key = typeof figma.fileKey === 'string' ? figma.fileKey.trim() : '';
    return key || '';
  } catch {
    return '';
  }
}

function stableSourceId(selection) {
  const fileKey = currentFigmaFileKey();
  const identity = [
    fileKey || (figma.root && figma.root.name),
    figma.currentPage && (figma.currentPage.id || figma.currentPage.name),
    ...selection.map(node => node.id),
  ].join('\u001f');
  return `figma-${stableCssSuffix(identity)}`;
}

function indexRestNodes(value, target, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 120 || seen.has(value)) return;
  seen.add(value);
  if (typeof value.id === 'string' && typeof value.type === 'string') target.set(value.id, value);
  if (Array.isArray(value)) {
    value.forEach(entry => indexRestNodes(entry, target, seen, depth + 1));
    return;
  }
  Object.values(value).forEach(entry => indexRestNodes(entry, target, seen, depth + 1));
}

async function captureRestV1Scene(selection, context) {
  const roots = [];
  for (const node of selection) {
    if (cancelled) throw new Error(translate('exportCancelled'));
    if (!node || typeof node.exportAsync !== 'function') {
      context.warnings.push(translate('restSnapshotWarning', { name: node && node.name || node && node.type || 'layer' }));
      continue;
    }
    try {
      const snapshot = await node.exportAsync({ format: 'JSON_REST_V1' });
      if (!snapshot || typeof snapshot !== 'object') throw new Error('Empty REST snapshot');
      roots.push(snapshot);
      indexRestNodes(snapshot, context.restNodesById);
    } catch {
      context.warnings.push(translate('restSnapshotWarning', { name: node.name || node.type }));
    }
  }
  context.restSnapshotRoots = roots.length;
  if (!context.options.includeRestScene || !roots.length) return null;
  const serialized = JSON.stringify(roots);
  if (serialized.length > MAX_REST_SCENE_CHARACTERS) {
    context.warnings.push(translate('restSnapshotTooLargeWarning'));
    return null;
  }
  return {
    version: REST_SCENE_VERSION,
    format: 'JSON_REST_V1',
    roots,
  };
}

function applySemanticTag(tagValue) {
  const tag = String(tagValue || '').toLowerCase();
  if (!SEMANTIC_TAGS.has(tag)) throw new Error(translate('semanticApplyFailed'));
  const selection = figma.currentPage.selection;
  if (!selection.length) throw new Error(translate('selectionRequired'));
  let updated = 0;
  for (const node of selection) {
    const current = readSemanticMetadata(node);
    const label = current.label || cleanLayerName(node.name) || node.type;
    const next = {
      ...current,
      schema: 1,
      tag,
      label,
      a11y: {
        ...(current.a11y || {}),
        ...(['nav', 'header', 'main', 'aside', 'footer'].includes(tag) && !(current.a11y && current.a11y.label)
          ? { label }
          : {}),
      },
    };
    try {
      if (typeof node.setSharedPluginData === 'function') {
        node.setSharedPluginData(
          SHARED_PLUGIN_NAMESPACE,
          SHARED_SEMANTIC_KEY,
          JSON.stringify(next),
        );
      }
      if ('name' in node) node.name = `${cleanLayerName(node.name) || node.type} #tag:${tag}`;
      updated += 1;
    } catch {
      // Continue applying the annotation to the remaining selected layers.
    }
  }
  if (!updated) throw new Error(translate('semanticApplyFailed'));
  documentRevision += 1;
  return updated;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function escapeFigmaText(value) {
  // Figma uses Unicode line/paragraph separators for authored line breaks.
  // CSS pre-wrap preserves LF, but Chromium does not render U+2028/U+2029 as
  // those breaks. Normalize only text, after rich-text ranges are extracted.
  return escapeHtml(value).replace(/\r\n?|\u2028|\u2029/g, '\n');
}

// The Figma plugin main sandbox is not a browser window and does not expose
// TextEncoder/TextDecoder in every desktop release. Keep UTF-8 handling local
// so SVG export and large-payload statistics work on old and new runtimes.
function utf8ByteLength(value) {
  const text = String(value || '');
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index += 1;
      } else length += 3;
    } else length += 3;
  }
  return length;
}

function utf8Decode(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint;
    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xe0) === 0xc0) {
      const second = bytes[index++] || 0;
      codePoint = ((first & 0x1f) << 6) | (second & 0x3f);
    } else if ((first & 0xf0) === 0xe0) {
      const second = bytes[index++] || 0;
      const third = bytes[index++] || 0;
      codePoint = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
    } else {
      const second = bytes[index++] || 0;
      const third = bytes[index++] || 0;
      const fourth = bytes[index++] || 0;
      codePoint = ((first & 0x07) << 18)
        | ((second & 0x3f) << 12)
        | ((third & 0x3f) << 6)
        | (fourth & 0x3f);
    }
    if (codePoint <= 0xffff) result += String.fromCharCode(codePoint);
    else {
      const value = codePoint - 0x10000;
      result += String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
    }
  }
  return result;
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function px(value) {
  const rounded = Math.round(number(value) * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function percent(value) {
  return `${Math.round(number(value) * 10000) / 100}%`;
}

function ratioPercent(value, total) {
  const size = number(total);
  return size ? percent(number(value) / size) : '0%';
}

function color(value, opacity = 1) {
  if (!value || typeof value !== 'object') return 'transparent';
  const red = Math.round(number(value.r) * 255);
  const green = Math.round(number(value.g) * 255);
  const blue = Math.round(number(value.b) * 255);
  const alpha = Math.max(0, Math.min(1, number(value.a, 1) * number(opacity, 1)));
  return alpha >= 0.999
    ? `rgb(${red} ${green} ${blue})`
    : `rgb(${red} ${green} ${blue} / ${Math.round(alpha * 10000) / 100}%)`;
}

function cssName(value, fallback = 'variable', namespace = '') {
  return `--kodety-figma-${namespace ? `${safe(namespace, 'export')}-` : ''}${safe(value, fallback)}`;
}

function stableCssSuffix(value) {
  const source = String(value || 'variable');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${safe(source, 'variable').slice(-12)}-${(hash >>> 0).toString(36)}`;
}

function variableCssName(variable, collection, namespace) {
  const collectionLabel = collection ? collection.name : variable.variableCollectionId;
  const label = safe(`${collectionLabel || 'collection'}-${variable.name || 'variable'}`, 'variable').slice(0, 42);
  const identity = stableCssSuffix(`${variable.variableCollectionId}:${variable.id}`);
  return `--kodety-token-${safe(`figma-${namespace}-${label}-${identity}`, 'figma-variable').slice(0, 80)}`;
}

function variableReference(context, source, fallback, node) {
  const alias = source
    && source.boundVariables
    && source.boundVariables.color
    && source.boundVariables.color.type === 'VARIABLE_ALIAS'
    ? source.boundVariables.color.id
    : '';
  const variable = alias && context.variableCatalog && context.variableCatalog.get(alias);
  if (!variable || !node || variable.resolvedType !== 'COLOR') return fallback;
  const collection = context.variableCollections.get(variable.variableCollectionId);
  let modes = {};
  try { modes = node.resolvedVariableModes || {}; } catch { /* Older runtime. */ }
  let raw;
  // The native resolver includes every collection in an alias chain, as well
  // as explicit and inherited modes on this particular consuming node.
  if (typeof variable.resolveForConsumer === 'function') {
    try {
      const resolution = variable.resolveForConsumer(node);
      if (resolution && resolution.resolvedType === 'COLOR') raw = resolution.value;
    } catch { /* Resolve from the available mode graph below, or keep the literal. */ }
  }
  if (raw === undefined) {
    raw = resolvedVariableValue(variable, modes, context.variableCatalog, context.variableCollections);
  }
  if (!raw || typeof raw !== 'object' || !['r', 'g', 'b'].every(channel => Number.isFinite(raw[channel]))) return fallback;
  let value = color(raw);
  if (value !== fallback) value = color(raw, source.opacity);
  // A token must never override a different, already resolved Figma paint.
  // In particular, source opacity may already contain variable alpha.
  if (value !== fallback) return fallback;
  const modeId = modes[variable.variableCollectionId] || (collection && collection.defaultModeId) || '';
  const modeSignature = variableModeSignature(variable, modes, context.variableCatalog, context.variableCollections);
  const key = `${alias}\u0000${modeSignature}\u0000${value}`;
  let record = context.variableResolutionTokens.get(key);
  if (!record) {
    const base = context.variableBaseRecords.get(alias);
    const defaultSignature = variableModeSignature(variable, {}, context.variableCatalog, context.variableCollections);
    if (base && base.value === value && modeSignature === defaultSignature) record = base;
    else {
      const identity = stableCssSuffix(key);
      const baseName = variableCssName(variable, collection, context.sourceId).replace(/^--kodety-token-/, '');
      const cssName = `--kodety-token-${baseName.slice(0, 50)}-${identity}`;
      const modeName = variableModeName(variable, modes, context.variableCatalog, context.variableCollections);
      record = {
        id: `${alias}@${identity}`,
        name: `${variable.name}${modeName ? ` · ${modeName}` : ''}${base && base.value !== value && modeSignature === defaultSignature ? ' · paint' : ''}`,
        tokenId: cssName.replace(/^--kodety-token-/, ''), cssName,
        collectionId: collection ? collection.id : variable.variableCollectionId,
        collectionName: collection ? collection.name : 'Figma variables',
        modeId, modeName, type: 'color', value,
      };
      context.exportedVariables.push(record);
    }
    context.variableResolutionTokens.set(key, record);
  }
  return `var(${record.cssName},${fallback})`;
}

function cssString(value) {
  return `"${String(value || '')
    .replace(/\0/g, '\ufffd')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n|\f/g, '\\A ')
    .replace(/</g, '\\3C ')
    .replace(/>/g, '\\3E ')}"`;
}

function fontFamilyCss(family) {
  const name = String(family || '').trim();
  if (!name) return 'Arial, sans-serif';
  const quoted = cssString(name);
  if (/mono|code|console|courier/i.test(name)) return `${quoted}, ui-monospace, monospace`;
  if (/\bserif\b|times|georgia|garamond|baskerville|didot|bodoni/i.test(name)) {
    return `${quoted}, Georgia, serif`;
  }
  return `${quoted}, Arial, Helvetica, sans-serif`;
}

function ensureFontFallback(value) {
  const family = String(value || '').trim();
  if (!family) return 'Arial, sans-serif';
  if (/(?:^|,)\s*(?:sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-monospace)\s*(?:,|$)/i.test(family)) {
    return family;
  }
  if (/\bserif\b|times|georgia|garamond|baskerville|didot|bodoni/i.test(family)) {
    return `${family}, Georgia, serif`;
  }
  return `${family}, Arial, Helvetica, sans-serif`;
}

function fontWeightCss(weight, style) {
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    return Math.max(1, Math.min(1000, Math.round(weight)));
  }
  const normalized = String(style || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (/extrablack|ultrablack/.test(normalized)) return 950;
  if (/black|heavy/.test(normalized)) return 900;
  if (/extrabold|ultrabold/.test(normalized)) return 800;
  if (/semibold|demibold/.test(normalized)) return 600;
  if (/bold/.test(normalized)) return 700;
  if (/medium/.test(normalized)) return 500;
  if (/extralight|ultralight/.test(normalized)) return 200;
  if (/light/.test(normalized)) return 300;
  if (/thin|hairline/.test(normalized)) return 100;
  return 400;
}

function fontStyleCss(style) {
  if (/oblique/i.test(String(style || ''))) return 'oblique';
  if (/italic/i.test(String(style || ''))) return 'italic';
  return 'normal';
}

function textDecorationCss(value) {
  if (!value || value === 'NONE') return null;
  if (value === 'STRIKETHROUGH') return 'line-through';
  return String(value).toLowerCase();
}

function textDecorationMetric(value) {
  if (!value || value === 'AUTO') return null;
  if (typeof value === 'number') return px(value);
  if (typeof value !== 'object') return null;
  if (value.unit === 'PERCENT') return `${number(value.value)}%`;
  return px(value.value);
}

function appendTextDecorationDetails(result, source) {
  if (!source) return;
  if (!mixed(source.textDecorationStyle) && source.textDecorationStyle) {
    result.push(`text-decoration-style:${String(source.textDecorationStyle).toLowerCase()}`);
  }
  if (!mixed(source.textDecorationOffset)) {
    const offset = textDecorationMetric(source.textDecorationOffset);
    if (offset) result.push(`text-underline-offset:${offset}`);
  }
  if (!mixed(source.textDecorationThickness)) {
    const thickness = textDecorationMetric(source.textDecorationThickness);
    if (thickness) result.push(`text-decoration-thickness:${thickness}`);
  }
  if (!mixed(source.textDecorationColor) && source.textDecorationColor) {
    const decorationColor = source.textDecorationColor.color || source.textDecorationColor;
    result.push(`text-decoration-color:${color(decorationColor, source.textDecorationColor.opacity)}`);
  }
  if (!mixed(source.textDecorationSkipInk) && source.textDecorationSkipInk != null) {
    result.push(`text-decoration-skip-ink:${source.textDecorationSkipInk ? 'auto' : 'none'}`);
  }
}

function textCaseDeclarations(value) {
  if (!value || value === 'ORIGINAL') return [];
  if (value === 'SMALL_CAPS' || value === 'SMALL_CAPS_FORCED') {
    return ['font-variant-caps:small-caps'];
  }
  if (value === 'TITLE') return ['text-transform:capitalize'];
  return [`text-transform:${String(value).toLowerCase()}`];
}

function safeHref(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (/^(?:https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(href)) return href;
  return '';
}

function registerFont(context, fontName, weight, missing, characters = 0) {
  if (missing) context.hasMissingFont = true;
  if (!fontName || mixed(fontName) || !fontName.family) return;
  const family = String(fontName.family);
  const style = String(fontName.style || 'Regular');
  const normalizedWeight = fontWeightCss(weight, style);
  const key = `${family}:${style}:${normalizedWeight}`;
  context.fonts.set(key, {
    family,
    style,
    weight: normalizedWeight,
    missing: Boolean(missing),
  });
  const previous = context.fontUsage.get(key) || {
    family,
    style,
    weight: normalizedWeight,
    nodes: 0,
    characters: 0,
    missing: false,
  };
  previous.nodes += 1;
  previous.characters += Math.max(0, number(characters));
  previous.missing = previous.missing || Boolean(missing);
  context.fontUsage.set(key, previous);
}

function mixed(value) {
  return value === figma.mixed;
}

function isVisible(node) {
  return !('visible' in node) || node.visible !== false;
}

function paintList(value) {
  return Array.isArray(value) ? value.filter(paint => paint && paint.visible !== false) : [];
}

function blendModeCss(value) {
  const mode = String(value || 'NORMAL').toUpperCase();
  if (mode === 'LINEAR_DODGE') return 'plus-lighter';
  if (mode === 'LINEAR_BURN') return 'multiply';
  if (mode === 'PASS_THROUGH') return 'normal';
  return mode.toLowerCase().replace(/_/g, '-');
}

function gradientAffine(paint) {
  const matrix = paint && paint.gradientTransform;
  if (Array.isArray(matrix) && matrix.length === 2
    && matrix.every(row => Array.isArray(row) && row.length >= 3 && row.slice(0, 3).every(Number.isFinite))) {
    return matrix;
  }
  // REST supplies normalized start/end/width handles instead of the Plugin
  // API's node-to-gradient transform. Solve the same affine map from all
  // three handles, retaining skew rather than assuming perpendicular axes.
  const handles = paint && paint.gradientHandlePositions;
  if (!Array.isArray(handles) || handles.length < 3
    || !handles.slice(0, 3).every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const [start, end, width] = handles;
  const ux = end.x - start.x;
  const uy = end.y - start.y;
  const vx = width.x - start.x;
  const vy = width.y - start.y;
  const determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) < 1e-12) return null;
  const firstScale = paint.type === 'GRADIENT_LINEAR' ? 1 : 0.5;
  const a = firstScale * vy / determinant;
  const c = -firstScale * vx / determinant;
  const b = -0.5 * uy / determinant;
  const d = 0.5 * ux / determinant;
  const firstOrigin = paint.type === 'GRADIENT_LINEAR' ? 0 : 0.5;
  return [[a, c, firstOrigin - a * start.x - c * start.y], [b, d, 0.5 - b * start.x - d * start.y]];
}

function linearGradientGeometry(paint, node) {
  const matrix = gradientAffine(paint);
  if (!matrix) return null;
  const [a, c, translation] = matrix[0];
  const range = Math.abs(a) + Math.abs(c);
  if (range < 1e-12) return null;
  const width = Math.max(1e-12, number(node && node.width, 1));
  const height = Math.max(1e-12, number(node && node.height, 1));
  // Figma's color parameter is t=a*x/width+c*y/height+translation.
  // CSS's gradient line runs through the box center, normal to the constant-t
  // lines. Its scalar range over the box is |a|+|c|, even for sheared paints.
  const angle = ((Math.atan2(a / width, -c / height) * 180 / Math.PI) + 360) % 360;
  return { angle, start: (a + c) / 2 + translation - range / 2, range, a, c };
}

function cssRepresentableGradient(paint, node) {
  if (!paint || paint.type !== 'GRADIENT_LINEAR' || !Array.isArray(paint.gradientStops) || !paint.gradientStops.length) return false;
  if (!paint.gradientStops.every(stop => stop && Number.isFinite(stop.position) && stop.color
    && ['r', 'g', 'b'].every(channel => Number.isFinite(stop.color[channel])))) return false;
  const geometry = linearGradientGeometry(paint, node);
  if (!geometry) return false;
  // Only axial gradients keep the exact normalized map when responsive
  // resizing changes the box aspect ratio. Diagonal/complex fills retain
  // native sampling; gradient() still computes their correct source CSS.
  return Math.min(Math.abs(geometry.a), Math.abs(geometry.c)) <= geometry.range * 1e-7;
}

function gradientNumber(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function gradient(paint, node, context) {
  const geometry = paint.type === 'GRADIENT_LINEAR' ? linearGradientGeometry(paint, node) : null;
  const stops = (paint.gradientStops || []).map(stop => {
    const position = geometry ? (number(stop.position) - geometry.start) / geometry.range : number(stop.position);
    return `${color(stop.color, paint.opacity)} ${gradientNumber(position * 100)}%`;
  }).join(', ');
  if (!stops) return 'none';
  // These remain conservative fallbacks only. cssRepresentableGradient()
  // keeps radial/angular/diamond paints on the native sampling path.
  if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(circle, ${stops})`;
  if (paint.type === 'GRADIENT_ANGULAR') return `conic-gradient(${stops})`;
  if (paint.type === 'GRADIENT_DIAMOND') {
    return `radial-gradient(ellipse at center, ${stops})`;
  }
  return `linear-gradient(${gradientNumber(geometry ? geometry.angle : 180)}deg, ${stops})`;
}

function imagePaintPosition(paint) {
  const transform = paint && paint.imageTransform;
  if (!Array.isArray(transform) || !transform[0] || !transform[1]) return 'center';
  // CSS backgrounds cannot express Figma's complete crop matrix without an
  // extra layer, but retaining its translated focal point avoids the much
  // more visible error of centering every cropped image.
  const x = Math.max(0, Math.min(1, 0.5 - number(transform[0][2])));
  const y = Math.max(0, Math.min(1, 0.5 - number(transform[1][2])));
  return `${percent(x)} ${percent(y)}`;
}

function fillCss(paints, context, node) {
  const visible = paintList(paints);
  if (!visible.length) return null;
  const nativeBackground = node && context.backgroundAssets && context.backgroundAssets.get(node.id);
  if (nativeBackground) {
    context.declarations.push(`background-image:url("figma-asset://${nativeBackground}")`,
      'background-size:100% 100%', 'background-repeat:no-repeat', 'background-position:center',
      'background-origin:border-box', 'background-clip:border-box');
    return null;
  }
  const imageLayers = [];
  const imageSizes = [];
  const imageRepeats = [];
  const imagePositions = [];
  const imageBlendModes = [];
  let backgroundColor = null;
  for (const [index, paint] of visible.entries()) {
    if (paint.type === 'SOLID') {
      const literal = variableReference(context, paint, color(paint.color, paint.opacity), node);
      if (index === visible.length - 1 && (!paint.blendMode || paint.blendMode === 'NORMAL')) {
        backgroundColor = literal;
      } else {
        // A translucent solid above another paint is an actual layer, not
        // background-color (which CSS always places underneath all images).
        imageLayers.push(`linear-gradient(${literal},${literal})`);
        imageSizes.push('auto');
        imageRepeats.push('no-repeat');
        imagePositions.push('center');
        imageBlendModes.push(blendModeCss(paint.blendMode));
      }
    } else if (String(paint.type).startsWith('GRADIENT_')) {
      imageLayers.push(gradient(paint, node, context));
      imageSizes.push('auto');
      imageRepeats.push('no-repeat');
      imagePositions.push('center');
      imageBlendModes.push(blendModeCss(paint.blendMode));
    } else if (paint.type === 'IMAGE' && paint.imageHash) {
      const assetId = context.imageHashes.get(paint.imageHash);
      if (assetId) {
        imageLayers.push(`url("figma-asset://${assetId}")`);
        const mode = paint.scaleMode || 'FILL';
        imageSizes.push(
          mode === 'FIT' ? 'contain' :
          mode === 'TILE' ? tiledImageSize(paint, context) :
              mode === 'STRETCH' ? '100% 100%' :
                'cover',
        );
        imageRepeats.push(mode === 'TILE' ? 'repeat' : 'no-repeat');
        imagePositions.push(mode === 'CROP' ? imagePaintPosition(paint) : 'center');
        imageBlendModes.push(blendModeCss(paint.blendMode));
      } else {
        context.pendingImageHashes.add(paint.imageHash);
      }
    }
  }
  if (imageLayers.length) {
    // Figma and CSS both order paint layers front-to-back, so no reversal is
    // necessary. Emit one synchronized value per background layer.
    context.declarations.push(`background-image:${imageLayers.join(',')}`);
    context.declarations.push(`background-size:${imageSizes.join(',')}`);
    context.declarations.push(`background-repeat:${imageRepeats.join(',')}`);
    context.declarations.push(`background-position:${imagePositions.join(',')}`);
    context.declarations.push('background-origin:border-box');
    if (imageBlendModes.some(mode => mode !== 'normal')) {
      context.declarations.push(`background-blend-mode:${imageBlendModes.join(',')}`);
    }
  }
  return backgroundColor ? `background-color:${backgroundColor}` : null;
}

function shouldMaterializeComplexBackground(node) {
  if (!node || node.type === 'TEXT' || !(number(node.width) > 0 && number(node.height) > 0)) return false;
  return paintList(node.fills).some(paint => (
    (String(paint.type).startsWith('GRADIENT_') && !cssRepresentableGradient(paint, node))
    || ['PATTERN', 'SHADER'].includes(paint.type)
    || (paint.type === 'IMAGE' && (paint.scaleMode === 'CROP' || number(paint.rotation) !== 0
      || number(paint.opacity, 1) !== 1
      || Object.values(paint.filters || {}).some(value => number(value) !== 0)))
  ));
}

async function materializeComplexBackground(node, context, paintOptions = {}) {
  if (!paintOptions.force && !shouldMaterializeComplexBackground(node)) return null;
  if (!context.backgroundAssets) context.backgroundAssets = new Map();
  if (!context.backgroundPaintCache) context.backgroundPaintCache = new Map();
  const backgroundKey = paintOptions.key || node.id;
  const existing = context.backgroundAssets.get(backgroundKey);
  if (existing) return existing;
  let sample;
  try {
    if (cancelled) throw new Error(translate('exportCancelled'));
    if (typeof figma.createRectangle !== 'function') throw new Error('Paint sampling is unavailable');
    const fills = paintList(paintOptions.paints || node.fills);
    const modes = node.resolvedVariableModes || {};
    const key = JSON.stringify([number(node.width), number(node.height), fills, modes]);
    let id = context.backgroundPaintCache.get(key);
    let modeFailed = false;
    if (!id) {
      // Sample ONLY the fills. Never clone, remove, reparent, hide, or flatten
      // source children. Figma handles crop matrices, diamond/elliptical
      // gradients, image adjustments, and new paint types itself.
      sample = figma.createRectangle();
      ignoredTransientNodeIds.add(sample.id);
      activeTransientPaintNodes.set(sample.id, sample);
      if (ignoredTransientNodeIds.size > 20000) {
        ignoredTransientNodeIds.delete(ignoredTransientNodeIds.values().next().value);
      }
      sample.name = 'Kodety background';
      sample.resize(number(node.width), number(node.height));
      sample.strokes = [];
      sample.effects = [];
      sample.opacity = 1;
      sample.fills = fills;
      // Preserve the selected frame's variable modes in the page-level sample.
      if (typeof sample.setExplicitVariableModeForCollection === 'function') {
        if (!context.backgroundVariableCollections) context.backgroundVariableCollections = new Map();
        for (const [collectionId, modeId] of Object.entries(modes)) {
          try {
            let collection = collectionId;
            if (figma.variables && typeof figma.variables.getVariableCollectionByIdAsync === 'function') {
              if (!context.backgroundVariableCollections.has(collectionId)) {
                context.backgroundVariableCollections.set(collectionId,
                  await figma.variables.getVariableCollectionByIdAsync(collectionId));
              }
              collection = context.backgroundVariableCollections.get(collectionId);
              if (!collection) throw new Error('Unavailable variable collection');
            }
            if (cancelled) throw new Error(translate('exportCancelled'));
            sample.setExplicitVariableModeForCollection(collection, modeId);
          } catch (error) {
            if (cancelled) throw error;
            modeFailed = true;
            emitConversionDiagnostic(context, node, 'background-mode', 'warning', 'diagnosticBackgroundMode');
          }
        }
      }
      // Complex paints are ordinary high-resolution image assets. Keep only
      // the paint in this sample: source text and layout remain editable.
      id = await exportPngNode(sample, context, preferredPngScale(node), false);
      if (!id) throw new Error('No usable native background');
      // A partially resolved mode must not become a silently reused sample.
      if (!modeFailed) context.backgroundPaintCache.set(key, id);
    }
    if (cancelled) throw new Error(translate('exportCancelled'));
    context.backgroundAssets.set(backgroundKey, id);
    const asset = context.assets.find(entry => entry.id === id);
    const raster = asset && asset.mimeType !== 'image/svg+xml';
    if (raster) context.backgroundRasterizedNodes = number(context.backgroundRasterizedNodes) + 1;
    const base = fills[fills.length - 1];
    const opaqueBase = base && base.type === 'SOLID' && number(base.opacity, 1) === 1
      && (!base.blendMode || base.blendMode === 'NORMAL');
    if (!opaqueBase && fills.some(paint => paint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(paint.blendMode))) {
      emitConversionDiagnostic(context, node, 'backdrop-blend', 'warning', 'diagnosticBackdropBlend');
    }
    await warnCroppedAnimationSnapshot(node, context);
    return id;
  } catch (error) {
    if (cancelled || (error && error.name === 'ExportAssetLimitError')) throw error;
    emitConversionDiagnostic(context, node, 'background-approximate', 'warning', 'diagnosticBackgroundApproximate');
    return null;
  } finally {
    if (sample) {
      const sampleId = sample.id;
      if (!sample.removed) sample.remove();
      activeTransientPaintNodes.delete(sampleId);
    }
  }
}

function effectsCss(effects) {
  const visible = Array.isArray(effects) ? effects.filter(effect => effect.visible !== false) : [];
  const shadows = [];
  const filters = [];
  for (const effect of visible) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      shadows.push(
        `${effect.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(effect.offset && effect.offset.x)} `
        + `${px(effect.offset && effect.offset.y)} ${px(effect.radius)} ${px(effect.spread || 0)} `
        + color(effect.color),
      );
    } else if (effect.type === 'LAYER_BLUR') {
      filters.push(`blur(${px(effect.radius)})`);
    }
  }
  return {
    shadow: shadows.length ? shadows.join(',') : null,
    filter: filters.length ? filters.join(' ') : null,
    backdrop: visible.find(effect => effect.type === 'BACKGROUND_BLUR'),
  };
}

function borderRadius(node) {
  if ('topLeftRadius' in node && !mixed(node.topLeftRadius)) {
    return [
      px(node.topLeftRadius),
      px(node.topRightRadius),
      px(node.bottomRightRadius),
      px(node.bottomLeftRadius),
    ].join(' ');
  }
  if ('cornerRadius' in node && !mixed(node.cornerRadius)) return px(node.cornerRadius);
  return null;
}

function nodeBounds(node) {
  const bounds = node && node.absoluteBoundingBox;
  if (
    bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
  ) return bounds;
  return {
    x: number(node && node.x),
    y: number(node && node.y),
    width: number(node && node.width),
    height: number(node && node.height),
  };
}

function restNodeFor(node, context) {
  if (!node || !context || !context.restNodesById) return null;
  return context.restNodesById.get(node.id) || null;
}

function structuralValue(node, context, property) {
  const restNode = restNodeFor(node, context);
  if (
    restNode
    && Object.prototype.hasOwnProperty.call(restNode, property)
    && restNode[property] !== undefined
  ) return restNode[property];
  return node ? node[property] : undefined;
}

function validNodeTransform(matrix) {
  return Array.isArray(matrix) && matrix.length === 2
    && matrix.every(row => Array.isArray(row) && row.length >= 3 && row.slice(0, 3).every(Number.isFinite));
}

function transformRelativeTo(matrix, parentMatrix) {
  const [[a, c, x], [b, d, y]] = parentMatrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) return null;
  const [[na, nc, nx], [nb, nd, ny]] = matrix;
  return [[(d * na - c * nb) / determinant, (d * nc - c * nd) / determinant,
    (d * (nx - x) - c * (ny - y)) / determinant],
  [(-b * na + a * nb) / determinant, (-b * nc + a * nd) / determinant,
    (-b * (nx - x) + a * (ny - y)) / determinant]];
}

function immediateParentTransform(node, parent) {
  // Figma x/y and relativeTransform skip GROUP/BOOLEAN_OPERATION ancestors;
  // HTML positioned children do not. Rebase into the actual DOM parent.
  if (parent && ['GROUP', 'BOOLEAN_OPERATION'].includes(parent.type)) {
    if (validNodeTransform(node.absoluteTransform) && validNodeTransform(parent.absoluteTransform)) {
      const matrix = transformRelativeTo(node.absoluteTransform, parent.absoluteTransform);
      if (matrix) return matrix;
    }
    if (validNodeTransform(node.relativeTransform) && validNodeTransform(parent.relativeTransform)) {
      const matrix = transformRelativeTo(node.relativeTransform, parent.relativeTransform);
      if (matrix) return matrix;
    }
    return [[1, 0, number(node.x) - number(parent.x)], [0, 1, number(node.y) - number(parent.y)]];
  }
  if (validNodeTransform(node.relativeTransform)) return node.relativeTransform;
  return [[1, 0, number(node.x)], [0, 1, number(node.y)]];
}

function axisConstraintDeclarations(node, parent, axis, context, box) {
  const horizontal = axis === 'horizontal';
  const startProperty = horizontal ? 'left' : 'top';
  const endProperty = horizontal ? 'right' : 'bottom';
  const sizeProperty = horizontal ? 'width' : 'height';
  const matrix = immediateParentTransform(node, parent);
  const start = box ? number(horizontal ? box.x : box.y) : matrix[horizontal ? 0 : 1][2];
  const size = number(horizontal ? (box || node).width : (box || node).height);
  const parentSize = number(horizontal ? parent.width : parent.height);
  const constraints = structuralValue(node, context, 'constraints');
  const constraint = constraints && constraints[axis]
    ? constraints[axis]
    : 'MIN';
  if (!parentSize) {
    return { declarations: [`${startProperty}:${px(start)}`], controlsSize: false };
  }
  const end = parentSize - start - size;
  if (constraint === 'MAX') {
    return { declarations: [`${endProperty}:${px(end)}`], controlsSize: false };
  }
  if (constraint === 'CENTER') {
    const offset = start + (size / 2) - (parentSize / 2);
    const positionedOffset = offset - (size / 2);
    return {
      declarations: [
        `${startProperty}:calc(50% ${positionedOffset < 0 ? '-' : '+'} ${px(Math.abs(positionedOffset))})`,
      ],
      controlsSize: false,
    };
  }
  if (constraint === 'STRETCH') {
    return {
      declarations: [`${startProperty}:${px(start)}`, `${endProperty}:${px(end)}`],
      controlsSize: true,
    };
  }
  if (constraint === 'SCALE') {
    return {
      declarations: [
        `${startProperty}:${ratioPercent(start, parentSize)}`,
        `${sizeProperty}:${ratioPercent(size, parentSize)}`,
      ],
      controlsSize: true,
    };
  }
  return { declarations: [`${startProperty}:${px(start)}`], controlsSize: false };
}

function numericSpread(values) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function inferredCrossAxisAlignment(boxes, horizontal) {
  const starts = boxes.map(box => horizontal ? box.y : box.x);
  const sizes = boxes.map(box => horizontal ? box.height : box.width);
  const centers = starts.map((start, index) => start + sizes[index] / 2);
  const ends = starts.map((start, index) => start + sizes[index]);
  const tolerance = 2;
  if (numericSpread(starts) <= tolerance) return 'MIN';
  if (numericSpread(centers) <= tolerance) return 'CENTER';
  if (numericSpread(ends) <= tolerance) return 'MAX';
  return '';
}

function gapsAreUniform(gaps) {
  if (gaps.length < 2) return true;
  return numericSpread(gaps) <= 2;
}

function hasHorizontalOverflowChild(node) {
  if (!node || !Array.isArray(node.children)) return false;
  const parentWidth = Math.max(0, number(node.width));
  return node.children.some(child => (
    isVisible(child)
    && (number(child.x) < -1 || number(child.x) + Math.max(0, number(child.width)) > parentWidth + 1)
  ));
}

function preservesHorizontalRail(node, layout) {
  if (!node || !layout || layout.layoutMode !== 'HORIZONTAL' || layout.layoutWrap === 'WRAP') return false;
  const namedRail = /carousel|slider|track|marquee|ticker|rail|scroller/i.test(String(node.name || ''));
  return namedRail || Boolean(node.clipsContent && hasHorizontalOverflowChild(node));
}

function geometryInferredAutoLayout(node, context) {
  if (
    !node
    || !context
    || context.options.responsiveMode !== 'smart'
    || !('children' in node)
    || !Array.isArray(node.children)
  ) return null;
  if (context.geometryLayoutCache.has(node.id)) return context.geometryLayoutCache.get(node.id);
  const children = node.children.filter(child => (
    isVisible(child) && structuralValue(child, context, 'layoutPositioning') !== 'ABSOLUTE'
  ));
  if (children.length < 2 || children.length > 200) {
    context.geometryLayoutCache.set(node.id, null);
    return null;
  }
  const boxes = children.map(child => ({
    node: child,
    x: number(child.x),
    y: number(child.y),
    width: Math.max(0, number(child.width)),
    height: Math.max(0, number(child.height)),
  }));
  const byX = [...boxes].sort((left, right) => left.x - right.x || left.y - right.y);
  const byY = [...boxes].sort((left, right) => left.y - right.y || left.x - right.x);
  const rowGaps = byX.slice(1).map((box, index) => box.x - (byX[index].x + byX[index].width));
  const columnGaps = byY.slice(1).map((box, index) => box.y - (byY[index].y + byY[index].height));
  const rowAlignment = inferredCrossAxisAlignment(boxes, true);
  const columnAlignment = inferredCrossAxisAlignment(boxes, false);
  const row = Boolean(rowAlignment)
    && rowGaps.every(gap => gap >= -2)
    && gapsAreUniform(rowGaps);
  const column = Boolean(columnAlignment)
    && columnGaps.every(gap => gap >= -2)
    && gapsAreUniform(columnGaps);
  if (row === column) {
    context.geometryLayoutCache.set(node.id, null);
    return null;
  }
  const horizontal = row;
  if (horizontal && preservesHorizontalRail(node, { layoutMode: 'HORIZONTAL', layoutWrap: 'NO_WRAP' })) {
    context.geometryLayoutCache.set(node.id, null);
    return null;
  }
  const ordered = horizontal ? byX : byY;
  const gaps = horizontal ? rowGaps : columnGaps;
  const averageGap = gaps.length
    ? gaps.reduce((sum, gap) => sum + Math.max(0, gap), 0) / gaps.length
    : 0;
  const minX = Math.min(...boxes.map(box => box.x));
  const minY = Math.min(...boxes.map(box => box.y));
  const maxX = Math.max(...boxes.map(box => box.x + box.width));
  const maxY = Math.max(...boxes.map(box => box.y + box.height));
  const inferred = {
    layoutMode: horizontal ? 'HORIZONTAL' : 'VERTICAL',
    layoutWrap: 'NO_WRAP',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: horizontal ? rowAlignment : columnAlignment,
    itemSpacing: Math.max(0, Math.round(averageGap * 1000) / 1000),
    paddingTop: Math.max(0, minY),
    paddingRight: Math.max(0, number(node.width) - maxX),
    paddingBottom: Math.max(0, number(node.height) - maxY),
    paddingLeft: Math.max(0, minX),
    __kodetyInference: 'geometry',
    __kodetyChildOrder: ordered.map(box => box.node.id),
  };
  context.geometryLayoutCache.set(node.id, inferred);
  context.geometryInferredLayoutIds.add(node.id);
  return inferred;
}

function effectiveAutoLayout(node, context) {
  if (!node) return null;
  const restNode = restNodeFor(node, context);
  const hasRestLayout = Boolean(
    restNode
    && Object.prototype.hasOwnProperty.call(restNode, 'layoutMode')
    && restNode.layoutMode !== undefined
  );
  if (!hasRestLayout && !('layoutMode' in node)) return null;
  const layoutMode = hasRestLayout ? restNode.layoutMode : node.layoutMode;
  if (layoutMode && layoutMode !== 'NONE') {
    if (!restNode) return node;
    const layout = { layoutMode };
    for (const property of [
      'layoutWrap', 'primaryAxisSizingMode', 'counterAxisSizingMode',
      'primaryAxisAlignItems', 'counterAxisAlignItems', 'counterAxisAlignContent',
      'itemSpacing', 'counterAxisSpacing', 'paddingTop', 'paddingRight',
      'paddingBottom', 'paddingLeft', 'strokesIncludedInLayout', 'itemReverseZIndex',
      'gridColumnCount', 'gridRowCount', 'gridColumnSizes', 'gridRowSizes',
      'gridColumnsSizing', 'gridRowsSizing', 'gridColumnGap', 'gridRowGap',
      'gridItemsPositioning', 'gridAutoTracks',
    ]) {
      layout[property] = structuralValue(node, context, property);
    }
    return layout;
  }
  // Frames without explicit Auto Layout use layer/z-order rather than flow
  // order. Turning Figma's broad inferredAutoLayout hint directly into flex
  // can therefore move headings after cards, collapse intentional carousel
  // offsets and remove clipped edge items. Safe mode always preserves their
  // absolute geometry. Smart mode only promotes a frame when our geometry
  // check proves one clear row or column and supplies a spatial child order.
  if (!context || context.options.responsiveMode !== 'smart') return null;
  return geometryInferredAutoLayout(node, context);
}

function sizingMode(node, parent, axis, isAbsolute, context) {
  if (!parent) return 'FIXED';
  const property = axis === 'horizontal' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
  const direct = structuralValue(node, context, property);
  if (direct === 'HUG' || direct === 'FILL' || direct === 'FIXED') return direct;

  const nodeLayout = effectiveAutoLayout(node, context);
  if (nodeLayout) {
    const primary = (nodeLayout.layoutMode === 'HORIZONTAL' && axis === 'horizontal')
      || (nodeLayout.layoutMode === 'VERTICAL' && axis === 'vertical');
    const legacy = primary ? nodeLayout.primaryAxisSizingMode : nodeLayout.counterAxisSizingMode;
    if (legacy === 'AUTO') return 'HUG';
  }
  if (node.type === 'TEXT') {
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') return 'HUG';
    if (axis === 'vertical' && node.textAutoResize === 'HEIGHT') return 'HUG';
  }
  const parentLayout = effectiveAutoLayout(parent, context);
  if (!isAbsolute && parentLayout) {
    const parentPrimary = (parentLayout.layoutMode === 'HORIZONTAL' && axis === 'horizontal')
      || (parentLayout.layoutMode === 'VERTICAL' && axis === 'vertical');
    if (parentPrimary && number(structuralValue(node, context, 'layoutGrow')) > 0) return 'FILL';
    if (!parentPrimary && structuralValue(node, context, 'layoutAlign') === 'STRETCH') return 'FILL';
  }
  return 'FIXED';
}

function hugNeedsResolvedSize(node, axis, context) {
  if (!effectiveAutoLayout(node, context) || !Array.isArray(node.children)) return false;
  // Mixed legacy/API sizing can describe Hug frames with Fill children even
  // though Figma has already resolved their size. CSS intrinsic sizing lets
  // those percentage-sized children contribute their text's max-content,
  // which can turn a 385px card into a 900px card. Use the frame's resolved
  // source dimension only for this cyclic Hug/Fill dependency; ordinary Hug
  // labels, buttons and content groups must keep their intrinsic sizing.
  return node.children.some(child => child.visible !== false
    && structuralValue(child, context, 'layoutPositioning') !== 'ABSOLUTE'
    && sizingMode(child, node, axis, false, context) === 'FILL');
}

function alignmentCss(value, fallback) {
  return {
    MIN: 'flex-start',
    CENTER: 'center',
    MAX: 'flex-end',
    SPACE_BETWEEN: 'space-between',
    SPACE_EVENLY: 'space-evenly',
    SPACE_AROUND: 'space-around',
    BASELINE: 'baseline',
  }[value] || fallback;
}

function gridTrackCss(track) {
  if (!track || typeof track !== 'object') return '1fr';
  if (track.type === 'FIXED') return px(track.value);
  if (track.type === 'HUG') return 'max-content';
  return `${Math.max(0.001, number(track.value, 1))}fr`;
}

function layoutDeclarations(node, parent, context) {
  const result = ['box-sizing:border-box'];
  if ('opacity' in node && node.opacity !== 1) result.push(`opacity:${number(node.opacity, 1)}`);
  if ('rotation' in node && number(node.rotation)) result.push(`transform:rotate(${number(node.rotation)}deg)`);
  if ('blendMode' in node && node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    result.push(`mix-blend-mode:${blendModeCss(node.blendMode)}`);
  }

  const parentLayout = effectiveAutoLayout(parent, context);
  const parentAutoLayout = Boolean(parentLayout);
  const isAbsolute = !parent
    || Boolean(parent && !parentAutoLayout)
    || Boolean(parent && structuralValue(node, context, 'layoutPositioning') === 'ABSOLUTE');
  let horizontalControlsSize = false;
  let verticalControlsSize = false;
  if (!parent && context.rootBounds) {
    const bounds = nodeBounds(node);
    result.push('position:absolute');
    result.push(`left:${px(bounds.x - context.rootBounds.x)}`, `top:${px(bounds.y - context.rootBounds.y)}`);
  } else if (parent && isAbsolute) {
    result.push('position:absolute');
    const horizontal = axisConstraintDeclarations(node, parent, 'horizontal', context);
    const vertical = axisConstraintDeclarations(node, parent, 'vertical', context);
    result.push(...horizontal.declarations, ...vertical.declarations);
    horizontalControlsSize = horizontal.controlsSize;
    verticalControlsSize = vertical.controlsSize;
  }

  const nodeLayout = effectiveAutoLayout(node, context);
  if (nodeLayout) {
    // node.width/height already include the frame's padding, regardless of
    // whether strokes participate in Auto Layout. Content-box would add that
    // padding a second time. Stroke reservation is handled by the paint code.
    if (nodeLayout.layoutMode === 'GRID') {
      const columns = Math.max(1, Math.round(number(nodeLayout.gridColumnCount, 1)));
      const rows = Math.max(1, Math.round(number(nodeLayout.gridRowCount, 1)));
      const columnTracks = Array.isArray(nodeLayout.gridColumnSizes)
        ? nodeLayout.gridColumnSizes.map(gridTrackCss)
        : [];
      const rowTracks = Array.isArray(nodeLayout.gridRowSizes)
        ? nodeLayout.gridRowSizes.map(gridTrackCss)
        : [];
      const restColumnTracks = typeof nodeLayout.gridColumnsSizing === 'string'
        ? nodeLayout.gridColumnsSizing.trim()
        : '';
      const restRowTracks = typeof nodeLayout.gridRowsSizing === 'string'
        ? nodeLayout.gridRowsSizing.trim()
        : '';
      result.push('display:grid');
      result.push(`grid-template-columns:${restColumnTracks || (columnTracks.length ? columnTracks.join(' ') : `repeat(${columns},minmax(0,1fr))`)}`);
      result.push(`grid-template-rows:${restRowTracks || (rowTracks.length ? rowTracks.join(' ') : `repeat(${rows},minmax(0,1fr))`)}`);
      result.push(`column-gap:${px(nodeLayout.gridColumnGap != null ? nodeLayout.gridColumnGap : nodeLayout.itemSpacing)}`);
      result.push(`row-gap:${px(nodeLayout.gridRowGap != null ? nodeLayout.gridRowGap : nodeLayout.counterAxisSpacing)}`);
      if (nodeLayout.gridItemsPositioning === 'ROW_AUTO_FLOW' || nodeLayout.gridAutoTracks === 'ROWS') {
        result.push('grid-auto-flow:row');
      }
    } else {
      result.push('display:flex');
      result.push(`flex-direction:${nodeLayout.layoutMode === 'HORIZONTAL' ? 'row' : 'column'}`);
      if (nodeLayout.layoutWrap === 'WRAP') {
        result.push('flex-wrap:wrap');
        const rowGap = nodeLayout.layoutMode === 'HORIZONTAL' ? nodeLayout.counterAxisSpacing : nodeLayout.itemSpacing;
        const columnGap = nodeLayout.layoutMode === 'HORIZONTAL' ? nodeLayout.itemSpacing : nodeLayout.counterAxisSpacing;
        result.push(`row-gap:${px(rowGap)}`, `column-gap:${px(columnGap)}`);
        result.push(`align-content:${alignmentCss(nodeLayout.counterAxisAlignContent, 'flex-start')}`);
      } else if (nodeLayout.itemSpacing != null) {
        result.push(`gap:${px(nodeLayout.itemSpacing)}`);
      }
      result.push(
        `justify-content:${alignmentCss(nodeLayout.primaryAxisAlignItems, 'flex-start')}`,
        `align-items:${alignmentCss(nodeLayout.counterAxisAlignItems, 'stretch')}`,
      );
    }
    result.push(
      `padding:${px(nodeLayout.paddingTop)} ${px(nodeLayout.paddingRight)} ${px(nodeLayout.paddingBottom)} ${px(nodeLayout.paddingLeft)}`,
    );
    if (!isAbsolute) result.push('position:relative');
  } else if ('children' in node && node.children && node.children.length && !isAbsolute) {
    result.push('position:relative');
  }

  if (parentLayout && parentLayout.layoutMode === 'GRID' && !isAbsolute) {
    const gridColumnAnchorIndex = structuralValue(node, context, 'gridColumnAnchorIndex');
    const gridRowAnchorIndex = structuralValue(node, context, 'gridRowAnchorIndex');
    const gridColumnSpan = structuralValue(node, context, 'gridColumnSpan');
    const gridRowSpan = structuralValue(node, context, 'gridRowSpan');
    const gridChildHorizontalAlign = structuralValue(node, context, 'gridChildHorizontalAlign');
    const gridChildVerticalAlign = structuralValue(node, context, 'gridChildVerticalAlign');
    if (gridColumnAnchorIndex != null) result.push(`grid-column-start:${Math.max(1, number(gridColumnAnchorIndex) + 1)}`);
    if (gridRowAnchorIndex != null) result.push(`grid-row-start:${Math.max(1, number(gridRowAnchorIndex) + 1)}`);
    if (gridColumnSpan != null) result.push(`grid-column-end:span ${Math.max(1, number(gridColumnSpan, 1))}`);
    if (gridRowSpan != null) result.push(`grid-row-end:span ${Math.max(1, number(gridRowSpan, 1))}`);
    if (gridChildHorizontalAlign && gridChildHorizontalAlign !== 'AUTO') {
      result.push(`justify-self:${alignmentCss(gridChildHorizontalAlign, 'stretch').replace('flex-', '')}`);
    }
    if (gridChildVerticalAlign && gridChildVerticalAlign !== 'AUTO') {
      result.push(`align-self:${alignmentCss(gridChildVerticalAlign, 'stretch').replace('flex-', '')}`);
    }
  }
  if (
    parentLayout
    && parentLayout.itemReverseZIndex
    && Array.isArray(parent.children)
  ) {
    const childIndex = parent.children.indexOf(node);
    if (childIndex >= 0) result.push(`z-index:${parent.children.length - childIndex}`);
  }

  if (number(structuralValue(node, context, 'layoutGrow')) > 0 && !isAbsolute) {
    result.push('flex-grow:1', 'flex-basis:0', 'min-width:0', 'min-height:0');
  }
  if (structuralValue(node, context, 'layoutAlign') === 'STRETCH' && !isAbsolute) result.push('align-self:stretch');
  for (const [property, cssProperty] of [
    ['minWidth', 'min-width'], ['maxWidth', 'max-width'],
    ['minHeight', 'min-height'], ['maxHeight', 'max-height'],
  ]) {
    const value = structuralValue(node, context, property);
    if (value != null) result.push(`${cssProperty}:${px(value)}`);
  }

  const widthMode = sizingMode(node, parent, 'horizontal', isAbsolute, context);
  const heightMode = sizingMode(node, parent, 'vertical', isAbsolute, context);
  if (!isAbsolute && parentLayout && parentLayout.layoutMode !== 'GRID') {
    const primaryMode = parentLayout.layoutMode === 'HORIZONTAL' ? widthMode : heightMode;
    if (primaryMode === 'FILL') {
      // REST layoutSizing is authoritative; legacy layoutGrow is not always
      // supplied. Every Fill item must share the available primary-axis space.
      result.push('flex-grow:1', 'flex-shrink:1', 'flex-basis:0');
    }
    if (
      (primaryMode === 'FIXED' || primaryMode === 'HUG')
      && number(structuralValue(node, context, 'layoutGrow')) <= 0
    ) result.push('flex-grow:0', 'flex-shrink:0', 'flex-basis:auto');
  }
  if ('width' in node && !horizontalControlsSize
    && (widthMode !== 'HUG' || hugNeedsResolvedSize(node, 'horizontal', context))) {
    result.push(`width:${widthMode === 'FILL' && !isAbsolute ? '100%' : px(node.width)}`);
  }
  if ('height' in node && !verticalControlsSize
    && (heightMode !== 'HUG' || hugNeedsResolvedSize(node, 'vertical', context))) {
    result.push(`height:${heightMode === 'FILL' && !isAbsolute ? '100%' : px(node.height)}`);
  }
  if (widthMode === 'FILL' && !isAbsolute && structuralValue(node, context, 'minWidth') == null) result.push('min-width:0');
  if (heightMode === 'FILL' && !isAbsolute && structuralValue(node, context, 'minHeight') == null) result.push('min-height:0');
  if ('clipsContent' in node && node.clipsContent) result.push('overflow:hidden');
  return result;
}

function hasLayeredStroke(node) {
  if (!node || node.type === 'TEXT' || mixed(node.strokes)) return false;
  const paints = paintList(node.strokes);
  return paints.length > 1 || paints.some(paint => paint.type !== 'SOLID'
    || (paint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(paint.blendMode)));
}

function strokeSideWeights(node) {
  const sides = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'];
  if (sides.every(property => node[property] != null && !mixed(node[property]))) {
    return sides.map(property => Math.max(0, number(node[property])));
  }
  const weight = !mixed(node.strokeWeight) ? Math.max(0, number(node.strokeWeight, 1)) : 1;
  return [weight, weight, weight, weight];
}

async function prepareGradientStroke(node, context, className) {
  if (!hasLayeredStroke(node)) return null;
  if (!context.strokePaints) context.strokePaints = new Map();
  if (context.strokePaints.has(node.id)) return context.strokePaints.get(node.id);
  const weights = strokeSideWeights(node);
  if (!weights.some(weight => weight > 0)) return null;
  const paints = paintList(node.strokes);
  const paintDeclarations = [];
  const cssPaints = paints.every(paint => paint.type === 'SOLID' || cssRepresentableGradient(paint, node));
  if (cssPaints) {
    // A stroke's paint stack is independent of the container's fills. It must
    // not resolve to the container's background asset or replace its opacity.
    const local = { ...context, declarations: paintDeclarations, backgroundAssets: null };
    const fill = fillCss(paints, local, node);
    if (fill) paintDeclarations.push(fill);
  } else {
    const id = await materializeComplexBackground(node, context, {
      paints, key: `${node.id}:stroke`, force: true,
    });
    if (id) {
      paintDeclarations.push(`background-image:url("figma-asset://${id}")`,
        'background-size:100% 100%', 'background-repeat:no-repeat');
    } else {
      for (const paint of paints) {
        if (paint.type === 'IMAGE' && paint.imageHash) await materializeImageHash(paint.imageHash, context);
      }
      const local = { ...context, declarations: paintDeclarations, backgroundAssets: null };
      const fill = fillCss(paints, local, node);
      if (fill) paintDeclarations.push(fill);
    }
  }
  if (!paintDeclarations.length) return null;
  const outside = node.strokeAlign === 'OUTSIDE' ? 1 : node.strokeAlign === 'CENTER' ? 0.5 : 0;
  const reserve = structuralValue(node, context, 'strokesIncludedInLayout') === true ? weights : [0, 0, 0, 0];
  const insets = weights.map((weight, index) => -weight * outside - reserve[index]);
  const ring = [
    'content:""', 'position:absolute', 'display:block', 'box-sizing:border-box',
    `inset:${insets.map(px).join(' ')}`, `padding:${weights.map(px).join(' ')}`,
    'border:0', 'margin:0', 'pointer-events:none',
    // This pseudo-element is paint only, never a flex item or editable child.
    'z-index:1',
  ];
  const radius = borderRadius(node);
  if (!outside || !radius || node.type === 'ELLIPSE') ring.push('border-radius:inherit');
  else {
    const corners = radius.split(' ').map(value => number(parseFloat(value)));
    while (corners.length < 4) corners.push(corners[corners.length - 1]);
    const horizontal = [weights[3], weights[1], weights[1], weights[3]];
    const vertical = [weights[0], weights[0], weights[2], weights[2]];
    const radii = extensions => corners.map((value, index) => px(value > 0 ? value + extensions[index] * outside : 0)).join(' ');
    const horizontalRadii = radii(horizontal);
    const verticalRadii = radii(vertical);
    ring.push(`border-radius:${horizontalRadii}${horizontalRadii === verticalRadii ? '' : ` / ${verticalRadii}`}`);
  }
  ring.push(...paintDeclarations,
    '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)',
    '-webkit-mask-composite:xor',
    'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)',
    'mask-composite:exclude');
  context.rules.push(`.${className}::after{${ring.join(';')}}`);
  const plan = { weights, reserve };
  context.strokePaints.set(node.id, plan);
  if ((Array.isArray(node.dashPattern) && node.dashPattern.length) || number(node.cornerSmoothing) > 0) {
    emitConversionDiagnostic(context, node, 'stroke-approximate', 'warning', 'diagnosticStrokeApproximate');
  }
  if (paints.some(paint => paint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(paint.blendMode))) {
    emitConversionDiagnostic(context, node, 'backdrop-blend', 'warning', 'diagnosticBackdropBlend');
  }
  return plan;
}

function visualDeclarations(node, context) {
  const result = [];
  const local = { ...context, declarations: result };
  // A TextNode fill paints glyphs, not the element box. Treating it as a
  // background makes light Figma typography inherit black in HTML and vanish
  // on dark sections.
  if (node.type !== 'TEXT' && 'fills' in node && !mixed(node.fills)) {
    const fill = fillCss(node.fills, local, node);
    if (fill) result.push(fill);
  }
  const strokePlan = context.strokePaints && context.strokePaints.get(node.id);
  if (strokePlan) {
    result.push('box-sizing:border-box', 'border-style:solid', 'border-color:transparent',
      `border-width:${strokePlan.reserve.map(px).join(' ')}`);
  } else if ('strokes' in node && !mixed(node.strokes)) {
    const stroke = paintList(node.strokes).find(paint => paint.type === 'SOLID');
    if (stroke) {
      const strokeColor = variableReference(context, stroke, color(stroke.color, stroke.opacity), node);
      const strokeStyle = Array.isArray(node.dashPattern) && node.dashPattern.length ? 'dashed' : 'solid';
      const hasIndividualWeights = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight']
        .every(property => property in node && !mixed(node[property]));
      if (hasIndividualWeights) {
        result.push(`border-top:${px(node.strokeTopWeight)} ${strokeStyle} ${strokeColor}`);
        result.push(`border-right:${px(node.strokeRightWeight)} ${strokeStyle} ${strokeColor}`);
        result.push(`border-bottom:${px(node.strokeBottomWeight)} ${strokeStyle} ${strokeColor}`);
        result.push(`border-left:${px(node.strokeLeftWeight)} ${strokeStyle} ${strokeColor}`);
      } else {
        const weight = 'strokeWeight' in node && !mixed(node.strokeWeight) ? number(node.strokeWeight, 1) : 1;
        result.push(`border:${px(weight)} ${strokeStyle} ${strokeColor}`);
        if ('strokeAlign' in node && node.strokeAlign === 'OUTSIDE') {
          result.push(`outline:${px(weight)} ${strokeStyle} ${strokeColor}`);
          result.push('border-color:transparent');
        }
      }
    }
  }
  const radius = borderRadius(node);
  if (radius) result.push(`border-radius:${radius}`);
  const effects = 'effects' in node && !mixed(node.effects) ? effectsCss(node.effects) : {};
  if (effects.shadow) result.push(`box-shadow:${effects.shadow}`);
  if (effects.filter) result.push(`filter:${effects.filter}`);
  if (effects.backdrop) result.push(`backdrop-filter:blur(${px(effects.backdrop.radius)})`);
  return result;
}

function fontVariationDeclarations(fontName) {
  const settings = fontName && !mixed(fontName) && fontName.variationSettings;
  if (!settings || typeof settings !== 'object') return [];
  const axes = Object.entries(settings)
    .filter(([tag, value]) => /^[a-zA-Z0-9 ]{4}$/.test(tag) && Number.isFinite(value))
    .map(([tag, value]) => `${cssString(tag)} ${value}`);
  return axes.length ? [`font-variation-settings:${axes.join(',')}`] : [];
}

function openTypeDeclarations(features) {
  if (!features || mixed(features) || typeof features !== 'object') return [];
  const settings = Object.entries(features)
    .filter(([name, enabled]) => /^[a-zA-Z0-9]{4}$/.test(name) && typeof enabled === 'boolean')
    .map(([name, enabled]) => `${cssString(name.toLowerCase())} ${enabled ? 1 : 0}`);
  return settings.length ? [`font-feature-settings:${settings.join(',')}`] : [];
}

function textDeclarations(node, context) {
  const result = ['white-space:pre-wrap', 'overflow-wrap:break-word', 'margin:0'];
  if (!mixed(node.fills)) {
    const fills = paintList(node.fills);
    const solid = fills.find(fill => fill.type === 'SOLID');
    const gradientFill = fills.find(fill => String(fill.type).startsWith('GRADIENT_'));
    if (solid) result.push(`color:${variableReference(context, solid, color(solid.color, solid.opacity), node)}`);
    else if (gradientFill) {
      result.push(`background:${gradient(gradientFill, node, context)}`);
      result.push('background-clip:text', '-webkit-background-clip:text');
      result.push('color:transparent');
    }
  }
  if (!mixed(node.fontName) && node.fontName) {
    result.push(`font-family:${fontFamilyCss(node.fontName.family)}`);
    const style = fontStyleCss(node.fontName.style);
    if (style !== 'normal') result.push(`font-style:${style}`);
    result.push(...fontVariationDeclarations(node.fontName));
  }
  result.push(...openTypeDeclarations(node.openTypeFeatures));
  if (node.textWrapStyle === 'BALANCE' || node.textWrapStyle === 'PRETTY') {
    result.push(`text-wrap-style:${node.textWrapStyle.toLowerCase()}`);
  }
  if (!mixed(node.fontSize)) result.push(`font-size:${px(node.fontSize)}`);
  if (!mixed(node.fontWeight)) {
    result.push(`font-weight:${fontWeightCss(node.fontWeight, !mixed(node.fontName) && node.fontName ? node.fontName.style : '')}`);
  }
  if (!mixed(node.letterSpacing) && node.letterSpacing) {
    result.push(`letter-spacing:${node.letterSpacing.unit === 'PERCENT'
      ? `${node.letterSpacing.value / 100}em`
      : px(node.letterSpacing.value)}`);
  }
  if (!mixed(node.lineHeight) && node.lineHeight) {
    result.push(`line-height:${node.lineHeight.unit === 'AUTO'
      ? 'normal'
      : node.lineHeight.unit === 'PERCENT'
        ? `${node.lineHeight.value}%`
        : px(node.lineHeight.value)}`);
  }
  if (!mixed(node.textAlignHorizontal)) {
    const alignment = String(node.textAlignHorizontal).toUpperCase();
    result.push(`text-align:${alignment === 'JUSTIFIED' ? 'justify' : alignment.toLowerCase()}`);
  }
  if (!mixed(node.textAlignVertical) && node.textAlignVertical && node.textAlignVertical !== 'TOP') {
    result.push(`align-content:${node.textAlignVertical === 'BOTTOM' ? 'end' : 'center'}`);
  }
  if (!mixed(node.textCase)) result.push(...textCaseDeclarations(node.textCase));
  if (!mixed(node.textDecoration)) {
    const decoration = textDecorationCss(node.textDecoration);
    if (decoration) result.push(`text-decoration:${decoration}`);
  }
  appendTextDecorationDetails(result, node);
  if (!mixed(node.paragraphIndent) && number(node.paragraphIndent)) {
    result.push(`text-indent:${px(node.paragraphIndent)}`);
  }
  if (!mixed(node.textAutoResize)) {
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
      result.push('width:max-content', 'height:auto', 'max-width:none', 'white-space:pre');
    } else if (node.textAutoResize === 'HEIGHT') {
      result.push('height:auto');
    }
  }
  if (!mixed(node.textTruncation) && node.textTruncation === 'ENDING') {
    result.push('overflow:hidden', 'text-overflow:ellipsis');
    if (!mixed(node.maxLines) && number(node.maxLines) > 1) {
      result.push(
        'display:-webkit-box',
        `-webkit-line-clamp:${Math.max(1, Math.floor(number(node.maxLines)))}`,
        '-webkit-box-orient:vertical',
      );
    } else {
      result.push('white-space:nowrap');
    }
  }
  return result;
}

const FIGMA_CSS_OMITTED_PROPERTIES = new Set([
  // Node dimensions already include padding; Dev Mode content-box must not
  // re-expand an authored box after layoutDeclarations has sized it.
  'box-sizing',
  // Kodety calculates these against the real imported parent. Dev Mode CSS can
  // express them against a synthetic selection wrapper, or include Figma's
  // inferred Auto Layout, and move/reflow nested nodes.
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'z-index',
  'display',
  'order',
  'gap',
  'row-gap',
  'column-gap',
  'justify-content',
  'align-content',
  'align-items',
  'align-self',
  'justify-items',
  'justify-self',
  'place-content',
  'place-items',
  'place-self',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  // Paints are converted deliberately by visualDeclarations(). A shorthand
  // returned later by getCSSAsync() would otherwise erase an image/gradient
  // layer that was already translated from Figma.
  'background',
  'background-color',
  'background-image',
  'background-size',
  'background-repeat',
  'background-position',
  'background-blend-mode',
  'background-clip',
  'background-origin',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
]);

async function nativeCssDeclarations(node, context, parent) {
  if (
    context.nodeCount > MAX_NATIVE_CSS_NODES
    || typeof node.getCSSAsync !== 'function'
  ) return [];
  try {
    const nativeCss = await node.getCSSAsync();
    const omittedProperties = new Set(FIGMA_CSS_OMITTED_PROPERTIES);
    const authoredStrokes = !mixed(node.strokes) && paintList(node.strokes).length > 0;
    const strokePlan = context.strokePaints && context.strokePaints.get(node.id);
    // A later Dev Mode shorthand can simplify a gradient stroke to one color
    // or collapse the stack of inset/drop shadows. Keep the explicit paints.
    if (strokePlan) omittedProperties.add('box-sizing');
    if (Array.isArray(node.effects) && node.effects.some(effect => effect.visible !== false
      && ['INNER_SHADOW', 'DROP_SHADOW'].includes(effect.type))) omittedProperties.add('box-shadow');
    const parentAutoLayout = Boolean(effectiveAutoLayout(parent, context));
    const isAbsolute = !parent
      || Boolean(parent && !parentAutoLayout)
      || Boolean(parent && structuralValue(node, context, 'layoutPositioning') === 'ABSOLUTE');
    const constraints = structuralValue(node, context, 'constraints');
    const horizontalConstraint = constraints && constraints.horizontal;
    const verticalConstraint = constraints && constraints.vertical;
    if (
      (!isAbsolute && sizingMode(node, parent, 'horizontal', false, context) !== 'FIXED')
      || (isAbsolute && (horizontalConstraint === 'STRETCH' || horizontalConstraint === 'SCALE'))
    ) omittedProperties.add('width');
    if (
      (!isAbsolute && sizingMode(node, parent, 'vertical', false, context) !== 'FIXED')
      || (isAbsolute && (verticalConstraint === 'STRETCH' || verticalConstraint === 'SCALE'))
    ) omittedProperties.add('height');
    return Object.entries(nativeCss || {}).flatMap(([property, value]) => {
      const normalizedProperty = String(property).trim().toLowerCase();
      const normalizedValue = String(value).trim();
      if (
        !/^(?:--[a-z0-9_-]+|[a-z-]+)$/i.test(normalizedProperty)
        || omittedProperties.has(normalizedProperty)
        || (authoredStrokes && (/^border(?:-|$)/.test(normalizedProperty)
          && normalizedProperty !== 'border-radius' && !/-radius$/.test(normalizedProperty)))
        || (authoredStrokes && /^outline(?:-|$)/.test(normalizedProperty))
        || normalizedProperty.startsWith('flex-')
        || normalizedProperty.startsWith('grid-')
        || !normalizedValue
        || /[;}]/.test(normalizedValue)
        || /!\s*important/i.test(normalizedValue)
        || /url\s*\(/i.test(normalizedValue)
        || /javascript:/i.test(normalizedValue)
      ) return [];
      return `${normalizedProperty}:${normalizedProperty === 'font-family'
        ? ensureFontFallback(normalizedValue)
        : normalizedValue}`;
    });
  } catch {
    // getCSSAsync is absent in some old Figma desktop builds and can reject
    // individual unsupported nodes. The manual converter remains the fallback.
    return [];
  }
}

function semanticTag(node) {
  const metadata = readSemanticMetadata(node);
  if (metadata.tag) return metadata.tag;
  const explicit = semanticTagFromName(node);
  if (explicit) return explicit;
  const name = String(node.name || '').toLowerCase();
  if (node.type === 'TEXT') {
    if (/\bh1\b|heading\s*1|display\s*1/.test(name)) return 'h1';
    if (/\bh2\b|heading\s*2|display\s*2/.test(name)) return 'h2';
    if (/\bh3\b|heading\s*3/.test(name)) return 'h3';
    return 'p';
  }
  if (/^(header|footer|nav|main|section|article|aside)(\b|[ _-])/.test(name)) {
    return name.match(/^[a-z]+/)[0];
  }
  // "Rectangle" contains "cta", but a painted rectangle is not a CTA.
  // Only complete name tokens may infer an interactive element.
  if (/(?:^|[^a-z0-9])(?:button|cta)(?:$|[^a-z0-9])/.test(name)) return 'button';
  return 'div';
}

function semanticLabel(node) {
  const metadata = readSemanticMetadata(node);
  return metadata.label || cleanLayerName(node.name) || node.type;
}

function htmlPhrasingContext(ancestorTags) {
  // Links are transparent: a link inside a paragraph still cannot contain a
  // div. A span used to preserve a Figma group keeps this restriction for all
  // of its descendants, even when the original button is several levels up.
  for (let index = ancestorTags.length - 1; index >= 0; index -= 1) {
    const tag = ancestorTags[index];
    if (tag === 'a') continue;
    return ['button', 'span', 'p', 'label'].includes(tag) || /^h[1-6]$/.test(tag);
  }
  return false;
}

function elementBaseDeclarations(tag) {
  // A semantic HTML tag must not add browser chrome to a Figma layer. Keep
  // these defaults in the node's own class and before the authored layout,
  // paints and text, so explicit fills, strokes and padding always win.
  const result = ['margin:0', 'padding:0', 'border:0'];
  if (tag === 'button') {
    result.push('appearance:none', '-webkit-appearance:none', 'background:none',
      'border-radius:0', 'box-shadow:none', 'font:inherit', 'color:inherit',
      'text-align:inherit', 'text-transform:none');
    // Do not reset outline: keyboard focus must remain visible.
  } else if (/^h[1-6]$/.test(tag)) result.push('font:inherit');
  if (tag === 'a') result.push('color:inherit', 'text-decoration:none');
  if (['ul', 'ol', 'li'].includes(tag)) result.push('list-style:none');
  return result;
}

function rootSourceIdentifier(node, context) {
  return `${context.sourceId}-${stableCssSuffix(node.id)}`.slice(0, 160);
}

function semanticAttributes(node, tag, context, isRoot) {
  const metadata = readSemanticMetadata(node);
  const label = semanticLabel(node);
  const attributes = [];
  if (isRoot && ['section', 'header', 'nav', 'main', 'article', 'aside', 'footer'].includes(tag)) {
    attributes.push(`data-kodety-section-id="${escapeAttribute(rootSourceIdentifier(node, context))}"`);
  }
  if (['nav', 'aside'].includes(tag)) {
    attributes.push(`aria-label="${escapeAttribute(metadata.a11y && metadata.a11y.label || label)}"`);
  }
  return attributes;
}

function orderedChildren(node, layout) {
  if (!node || !Array.isArray(node.children)) return [];
  if (!layout || !Array.isArray(layout.__kodetyChildOrder)) return node.children;
  const order = new Map(layout.__kodetyChildOrder.map((id, index) => [id, index]));
  return [...node.children].sort((left, right) => (
    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function pushResponsiveRule(context, breakpoint, className, declarations) {
  if (!declarations.length) return;
  context.responsiveRules[breakpoint].push(`.${className}{${declarations.join(';')}}`);
}

function emitConversionDiagnostic(context, node, code, severity, messageKey) {
  if (!context.diagnostics) context.diagnostics = [];
  if (!context.diagnosticKeys) context.diagnosticKeys = new Set();
  if (!context.diagnosticNodes) context.diagnosticNodes = new Map();
  const key = `${node.id}:${code}`;
  if (context.diagnosticKeys.has(key)) return;
  if (context.diagnostics.length >= 256) {
    const replaceable = severity === 'warning'
      ? context.diagnostics.findIndex(entry => entry.severity !== 'warning') : -1;
    if (replaceable < 0) return;
    context.diagnostics.splice(replaceable, 1);
  }
  context.diagnosticKeys.add(key);
  context.diagnosticNodes.set(node.id, node);
  context.diagnostics.push({
    nodeId: String(node.id),
    nodeName: semanticLabel(node),
    code,
    severity: severity === 'warning' ? 'warning' : 'info',
    message: translate(messageKey),
  });
}

function recordNodeDiagnostics(node, parent, context, tag) {
  const atomic = tag === 'img' || tag === 'atomic-media';
  const layout = effectiveAutoLayout(node, context);
  if (node.type === 'TEXT' && node.hasMissingFont) {
    emitConversionDiagnostic(context, node, 'missing-font', 'warning', 'diagnosticMissingFont');
  }
  if (context.options.responsiveMode !== 'pixel' && number(structuralValue(node, context, 'minWidth')) > 410) {
    emitConversionDiagnostic(context, node, 'authored-minimum', 'warning', 'diagnosticMinimum');
  }
  if (atomic || node.type === 'TEXT') return;
  if (layout && layout.__kodetyInference === 'geometry') {
    emitConversionDiagnostic(context, node, 'inferred-layout', 'info', 'diagnosticInferred');
  }
  if (smartStacksOnMobile(node, layout, context)) {
    emitConversionDiagnostic(context, node, 'mobile-stack', 'info', 'diagnosticStacked');
  }
  if (!layout && Array.isArray(node.children) && node.children.some(isVisible)
    && context.options.responsiveMode !== 'pixel') {
    emitConversionDiagnostic(context, node, 'absolute-layout', 'info', 'diagnosticAbsolute');
  }
}

function smartStacksOnMobile(node, layout, context) {
  return Boolean(responsiveRowPlan(node, layout, context));
}

function compactResponsiveControl(node) {
  const tag = semanticTag(node);
  return tag === 'button' || tag === 'nav'
    || /(?:^|[\s_/-])(?:navigation|nav|menu|toolbar|pagination|breadcrumb|tabs?)(?:$|[\s_/-])/i.test(String(node.name || ''))
    || (node.type !== 'TEXT' && number(node.height) <= 80 && number(node.width) <= 360);
}

function responsiveRowPlan(node, layout, context) {
  if (context.options.responsiveMode === 'pixel' || !node || !layout
    || layout.layoutMode !== 'HORIZONTAL' || compactResponsiveControl(node)
    || preservesHorizontalRail(node, layout)) return null;
  const children = Array.isArray(node.children) ? node.children.filter(child => isVisible(child)
    && structuralValue(child, context, 'layoutPositioning') !== 'ABSOLUTE') : [];
  if (children.length < 2 || number(node.width) <= 410) return null;
  const content = children.filter(child => !compactResponsiveControl(child)
    && number(child.width) >= 160 && (number(child.height) >= 64
      || (child.type === 'TEXT' && number(child.width) > 260 && String(child.characters || '').length > 32)));
  if (!content.length) return null;
  const widths = content.map(child => number(child.width));
  const repeatedCards = content.length >= 3 && content.length === children.length
    && Math.max(...widths) <= Math.min(...widths) * 1.2;
  return repeatedCards ? 'cards' : 'stack';
}

function gridColumnCount(layout) {
  return Math.max(1, Array.isArray(layout.gridColumnSizes) && layout.gridColumnSizes.length
    ? layout.gridColumnSizes.length : Math.round(number(layout.gridColumnCount, 1)));
}

function registerResponsiveRules(node, parent, context, className, tag) {
  recordNodeDiagnostics(node, parent, context, tag);
  if (context.options.responsiveMode === 'pixel') return;
  const atomicMedia = tag === 'img' || tag === 'atomic-media';
  const layout = effectiveAutoLayout(node, context);
  const parentLayout = effectiveAutoLayout(parent, context);
  const compactControl = compactResponsiveControl(node);
  const preserveCompactHeight = compactControl
    && sizingMode(node, parent, 'vertical', false, context) === 'FIXED';
  const preserveCompactInternalSpacing = preserveCompactHeight
    && number(node.width) <= 360 && number(node.height) <= 80;
  const inFlow = parent && parentLayout
    && structuralValue(node, context, 'layoutPositioning') !== 'ABSOLUTE';
  // Free-positioned artwork is a composition, not a responsive content stack.
  // Protect its complete subtree, even when an inner frame uses Auto Layout.
  if (!context.responsiveProtectedNodes) context.responsiveProtectedNodes = new Set();
  if (parent && (!inFlow || context.responsiveProtectedNodes.has(parent.id))) {
    context.responsiveProtectedNodes.add(node.id);
    return;
  }
  const parentRail = inFlow && preservesHorizontalRail(parent, parentLayout);
  if (inFlow && !parentRail) {
    const bounds = [];
    if (structuralValue(node, context, 'maxWidth') == null) bounds.push('max-width:100%');
    if (structuralValue(node, context, 'minWidth') == null) bounds.push('min-width:0');
    // Keep the original desktop composition, including intentional bleed.
    pushResponsiveRule(context, 'notebook', className, bounds);
    if (atomicMedia && !compactControl) {
      const proportional = ['height:auto'];
      if (number(node.width) > 0 && number(node.height) > 0) {
        proportional.push(`aspect-ratio:${number(node.width)} / ${number(node.height)}`);
      }
      pushResponsiveRule(context, 'notebook', className, proportional);
    }
  }
  const parentPlan = inFlow && responsiveRowPlan(parent, parentLayout, context);
  if (parentPlan && !compactResponsiveControl(node)) {
    const childMobile = ['width:100%', 'flex-grow:0', 'flex-shrink:0', 'flex-basis:auto'];
    if (structuralValue(node, context, 'minWidth') == null) childMobile.push('min-width:0');
    if (atomicMedia) {
      childMobile.push('height:auto');
      if (number(node.width) > 0 && number(node.height) > 0) {
        childMobile.push(`aspect-ratio:${number(node.width)} / ${number(node.height)}`);
      }
    } else if (node.type === 'TEXT' || layout) childMobile.push('height:auto');
    pushResponsiveRule(context, parentPlan === 'cards' ? 'notebook' : 'tablet', className, childMobile);
    pushResponsiveRule(context, 'mobile', className, childMobile);
  }
  if (inFlow && parentLayout.layoutMode === 'GRID') {
    const columns = gridColumnCount(parentLayout);
    // Changing the template without resetting desktop placements creates
    // implicit columns (e.g. a child still at column 4 in a one-column grid).
    const childGrid = ['grid-column-start:auto', 'grid-column-end:auto',
      'grid-row-start:auto', 'grid-row-end:auto'];
    // Reposition small icons/controls without expanding them to a whole track.
    if (!compactControl) childGrid.unshift('width:100%');
    if (structuralValue(node, context, 'minWidth') == null) childGrid.push('min-width:0');
    if (atomicMedia && !compactControl) {
      childGrid.push('height:auto');
      if (number(node.width) > 0 && number(node.height) > 0) {
        childGrid.push(`aspect-ratio:${number(node.width)} / ${number(node.height)}`);
      }
    } else if (!compactControl && (node.type === 'TEXT' || layout)) childGrid.push('height:auto');
    if (columns > 2) pushResponsiveRule(context, 'tablet', className, childGrid);
    if (columns > 1) pushResponsiveRule(context, 'mobile', className, childGrid);
  }
  if (inFlow && !parentRail && node.type === 'TEXT') {
    const wrapping = ['height:auto'];
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
      wrapping.push('white-space:pre-wrap', 'flex-shrink:1');
      if (parentLayout.layoutMode !== 'HORIZONTAL' || parentPlan) wrapping.push('width:100%');
    }
    pushResponsiveRule(context, 'notebook', className, wrapping);
  }
  if (context.options.responsiveMode === 'smart' && inFlow && node.type === 'TEXT' && number(node.fontSize) > 32) {
    if (!context.responsiveTextNodes) context.responsiveTextNodes = new Set();
    context.responsiveTextNodes.add(node.id);
    const headingMobile = [
      `font-size:clamp(28px,8vw,${px(node.fontSize)})`,
      'height:auto',
    ];
    if (node.lineHeight && !mixed(node.lineHeight) && node.lineHeight.unit === 'PIXELS') {
      headingMobile.push(`line-height:${number(node.lineHeight.value) / number(node.fontSize)}`);
    }
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
      headingMobile.push('width:100%', 'white-space:pre-wrap');
      const authoredMaximum = structuralValue(node, context, 'maxWidth');
      // Preserve a smaller authored limit while capping HUG text to its parent.
      headingMobile.push(authoredMaximum == null ? 'max-width:100%'
        : `max-width:${px(authoredMaximum)}`);
      if (structuralValue(node, context, 'minWidth') == null) headingMobile.push('min-width:0');
    }
    pushResponsiveRule(context, 'mobile', className, headingMobile);
  }
  const root = !parent;
  if (root && context.selectionCount === 1) {
    // A selected section represents the Builder container, not a desktop-only
    // cap. Keep authored min/max constraints on the node itself, but let the
    // section use the available width. Pixel mode returns before here.
    context.responsiveRootClass = className;
    // Adapt as soon as the viewport is narrower than the authored desktop,
    // rather than leaving wide-source padding fixed until 1200px.
    context.responsiveNotebookMaxWidth = Math.max(1200, Math.ceil(number(node.width)) - 1);
    const rootDeclarations = ['position:relative', 'left:auto', 'top:auto', 'width:100%'];
    if (atomicMedia) {
      rootDeclarations.push('height:auto');
      const width = number(node.width);
      const height = number(node.height);
      if (width > 0 && height > 0) rootDeclarations.push(`aspect-ratio:${width} / ${height}`);
    }
    context.baseOverrides.push(`.${className}{${rootDeclarations.join(';')}}`);
    if (layout && !atomicMedia) pushResponsiveRule(context, 'notebook', className,
      preserveCompactHeight ? ['width:100%'] : ['width:100%', 'height:auto']);
  }
  // A bitmap or SVG already contains the rendered result of the node. It can
  // participate in its parent's layout, but must never become a flex/grid
  // container or receive a second responsive padding of its own.
  if (atomicMedia) return;
  // A fixed 24px icon frame or vertical button must not collapse to the size
  // of its inner glyph/label merely because it also uses Auto Layout.
  if (preserveCompactInternalSpacing) return;
  if (!layout) {
    if (root) context.absoluteRootNames.push(semanticLabel(node));
    return;
  }
  const mobile = [];
  const originalPadding = [number(layout.paddingTop), number(layout.paddingRight),
    number(layout.paddingBottom), number(layout.paddingLeft)];
  for (const [breakpoint, vertical, horizontal, gap] of [
    ['notebook', 96, 48, 48], ['tablet', 64, 32, 32], ['mobile', 24, 20, 24],
  ]) {
    const spacing = [];
    const padding = originalPadding.map((value, index) => Math.min(value, index % 2 ? horizontal : vertical));
    if (padding.some((value, index) => value !== originalPadding[index])) {
      spacing.push(`padding:${padding.map(px).join(' ')}`);
    }
    if (!preservesHorizontalRail(node, layout) && number(layout.itemSpacing) > gap) spacing.push(`gap:${px(gap)}`);
    if (layout.layoutMode === 'VERTICAL' && !preserveCompactHeight) spacing.push('height:auto');
    pushResponsiveRule(context, breakpoint, className, spacing);
  }
  if (layout.layoutMode === 'HORIZONTAL') {
    const plan = responsiveRowPlan(node, layout, context);
    if (plan === 'cards') {
      pushResponsiveRule(context, 'notebook', className, ['display:grid',
        'grid-template-columns:repeat(2,minmax(0,1fr))', 'align-items:start', 'height:auto']);
      mobile.push('grid-template-columns:minmax(0,1fr)', 'height:auto');
    } else if (plan === 'stack') {
      pushResponsiveRule(context, 'notebook', className, ['flex-wrap:wrap', 'height:auto']);
      pushResponsiveRule(context, 'tablet', className, ['flex-direction:column', 'align-items:stretch', 'height:auto']);
      mobile.push('flex-direction:column', 'align-items:stretch', 'height:auto');
    } else if (layout.layoutWrap === 'WRAP' && !preserveCompactHeight) {
      pushResponsiveRule(context, 'tablet', className, ['height:auto']);
    }
  } else if (layout.layoutMode === 'VERTICAL') {
    if (!preserveCompactHeight) mobile.push('height:auto');
  } else if (layout.layoutMode === 'GRID') {
    const columns = gridColumnCount(layout);
    const tablet = preserveCompactHeight ? [] : ['height:auto'];
    if (columns > 2) {
      tablet.unshift('grid-template-columns:repeat(2,minmax(0,1fr))');
    }
    pushResponsiveRule(context, 'tablet', className, tablet);
    if (columns > 1) {
      mobile.push('grid-template-columns:minmax(0,1fr)');
    }
    if (!preserveCompactHeight) mobile.push('height:auto');
  }
  pushResponsiveRule(context, 'mobile', className, mobile);
}

function reactionUrl(node) {
  const reactions = Array.isArray(node.reactions) ? node.reactions : [];
  for (const reaction of reactions) {
    const action = reaction && reaction.action;
    if (action && action.type === 'URL' && action.url) return safeHref(action.url);
  }
  return '';
}

function directHyperlinkUrl(node) {
  const hyperlink = node && node.hyperlink;
  if (!hyperlink || mixed(hyperlink) || hyperlink.type !== 'URL') return '';
  return safeHref(hyperlink.value);
}

function styledText(node, context, allowHyperlinks = true) {
  const fields = [
    'fontName', 'fontSize', 'fontWeight', 'fontStyle', 'fills',
    'letterSpacing', 'lineHeight', 'textCase', 'textDecoration',
    'textDecorationStyle', 'textDecorationOffset', 'textDecorationThickness',
    'textDecorationColor', 'textDecorationSkipInk',
    'hyperlink', 'openTypeFeatures', 'indentation', 'paragraphIndent',
    'paragraphSpacing', 'listOptions', 'listSpacing',
  ];
  let segments = [];
  try {
    segments = node.getStyledTextSegments(fields);
  } catch {
    // Older Figma runtimes support rich segments but not every newer field.
    try {
      segments = node.getStyledTextSegments([
        'fontName', 'fontSize', 'fontWeight', 'fills', 'letterSpacing',
        'lineHeight', 'textCase', 'textDecoration', 'hyperlink', 'openTypeFeatures',
      ]);
    } catch {
      try { segments = node.getStyledTextSegments(['fontName', 'fontSize', 'fills']); }
      catch { segments = []; }
    }
  }
  if (!segments.length) {
    registerFont(
      context,
      mixed(node.fontName) ? null : node.fontName,
      mixed(node.fontWeight) ? undefined : node.fontWeight,
      node.hasMissingFont,
      String(node.characters || '').length,
    );
    return escapeFigmaText(node.characters || '');
  }
  if (
    segments.length > MAX_RICH_TEXT_SEGMENTS_PER_NODE
    || context.richTextSegments + segments.length > MAX_RICH_TEXT_SEGMENTS
  ) {
    if (!context.richTextLimitWarned) {
      context.warnings.push(translate('richTextSimplifiedWarning'));
      context.richTextLimitWarned = true;
    }
    registerFont(
      context,
      mixed(node.fontName) ? null : node.fontName,
      mixed(node.fontWeight) ? undefined : node.fontWeight,
      node.hasMissingFont,
      String(node.characters || '').length,
    );
    return escapeFigmaText(node.characters || '');
  }
  context.richTextSegments += segments.length;
  return segments.map((segment, index) => {
    const declarations = [];
    if (segment.fontName && !mixed(segment.fontName)) {
      declarations.push(`font-family:${fontFamilyCss(segment.fontName.family)}`);
      declarations.push(...fontVariationDeclarations(segment.fontName));
      registerFont(
        context,
        segment.fontName,
        segment.fontWeight,
        node.hasMissingFont,
        String(segment.characters || '').length,
      );
      const style = fontStyleCss(segment.fontStyle || segment.fontName.style);
      if (style !== 'normal') declarations.push(`font-style:${style}`);
    }
    const responsiveText = context.responsiveTextNodes && context.responsiveTextNodes.has(node.id);
    if (!mixed(segment.fontSize) && Number.isFinite(segment.fontSize)) {
      declarations.push(`font-size:${responsiveText && number(node.fontSize) > 0
        ? `${segment.fontSize / node.fontSize}em`
        : px(segment.fontSize)}`);
    }
    if (!mixed(segment.fontWeight)) {
      declarations.push(`font-weight:${fontWeightCss(segment.fontWeight, segment.fontName && segment.fontName.style)}`);
    }
    const fills = paintList(segment.fills);
    const solid = fills.find(fill => fill.type === 'SOLID');
    const gradientFill = fills.find(fill => String(fill.type).startsWith('GRADIENT_'));
    if (solid) declarations.push(`color:${variableReference(context, solid, color(solid.color, solid.opacity), node)}`);
    else if (gradientFill) {
      declarations.push(
        `background:${gradient(gradientFill, node, context)}`,
        'background-clip:text',
        '-webkit-background-clip:text',
        'color:transparent',
      );
    }
    if (!mixed(segment.letterSpacing) && segment.letterSpacing) {
      declarations.push(`letter-spacing:${segment.letterSpacing.unit === 'PERCENT'
        ? `${segment.letterSpacing.value / 100}em`
        : px(segment.letterSpacing.value)}`);
    }
    if (!mixed(segment.lineHeight) && segment.lineHeight && segment.lineHeight.unit !== 'AUTO') {
      declarations.push(`line-height:${segment.lineHeight.unit === 'PERCENT'
        ? `${segment.lineHeight.value}%`
        : responsiveText && number(segment.fontSize) > 0
          ? String(segment.lineHeight.value / segment.fontSize)
        : px(segment.lineHeight.value)}`);
    }
    if (!mixed(segment.textCase)) declarations.push(...textCaseDeclarations(segment.textCase));
    if (!mixed(segment.textDecoration)) {
      const decoration = textDecorationCss(segment.textDecoration);
      if (decoration) declarations.push(`text-decoration:${decoration}`);
    }
    appendTextDecorationDetails(declarations, segment);
    if (!mixed(segment.paragraphIndent) && number(segment.paragraphIndent)) {
      declarations.push(`text-indent:${px(segment.paragraphIndent)}`);
    }
    if (!mixed(segment.indentation) && number(segment.indentation)) {
      declarations.push(`padding-inline-start:${px(segment.indentation)}`);
    }
    declarations.push(...openTypeDeclarations(segment.openTypeFeatures));
    const text = escapeFigmaText(segment.characters || '');
    let content = declarations.length
      ? `<span data-figma-segment="${index}" style="${escapeAttribute(declarations.join(';'))}">${text}</span>`
      : text;
    const hyperlink = !mixed(segment.hyperlink)
      && segment.hyperlink
      && segment.hyperlink.type === 'URL'
      ? safeHref(segment.hyperlink.value)
      : '';
    if (hyperlink && allowHyperlinks) {
      content = `<a href="${escapeAttribute(hyperlink)}"${/^https?:/i.test(hyperlink) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${content}</a>`;
    }
    return content;
  }).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function sniffMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) return 'image/gif';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return 'image/webp';
  return 'image/png';
}

function imageExtension(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function imageBytesDimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    const uint32 = offset => bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100 + bytes[offset + 3];
    return { width: uint32(16), height: uint32(20) };
  }
  if (mimeType === 'image/gif' && bytes.length >= 10) {
    return { width: bytes[6] + bytes[7] * 256, height: bytes[8] + bytes[9] * 256 };
  }
  return null;
}

function isAnimatedGif(bytes) {
  if (sniffMime(bytes) !== 'image/gif' || bytes.length < 13) return false;
  let cursor = 13 + ((bytes[10] & 0x80) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0);
  let frames = 0;
  const skipBlocks = () => {
    while (cursor < bytes.length) {
      const size = bytes[cursor++];
      if (!size) return true;
      cursor += size;
    }
    return false;
  };
  while (cursor < bytes.length) {
    const block = bytes[cursor++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      cursor += 1;
      if (!skipBlocks()) return false;
    } else if (block === 0x2c) {
      if (cursor + 9 >= bytes.length) return false;
      const packed = bytes[cursor + 8];
      cursor += 9 + ((packed & 0x80) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
      cursor += 1; // LZW minimum code size precedes the image data blocks.
      if (!skipBlocks()) return false;
      frames += 1;
      if (frames > 1) return true;
    } else return false;
  }
  return false;
}

async function warnCroppedAnimationSnapshot(node, context) {
  if (typeof emitConversionDiagnostic !== 'function') return;
  if (!context.imageAnimations) context.imageAnimations = new Map();
  for (const paint of paintList(node.fills)) {
    if (paint.type !== 'IMAGE' || !paint.imageHash || paint.scaleMode !== 'CROP') continue;
    try {
      if (!context.imageAnimations.has(paint.imageHash)) {
        const image = figma.getImageByHash(paint.imageHash);
        const bytes = image ? await image.getBytesAsync() : null;
        context.imageAnimations.set(paint.imageHash, Boolean(bytes && isAnimatedGif(bytes)));
      }
      if (context.imageAnimations.get(paint.imageHash)) {
        emitConversionDiagnostic(context, node, 'animation-snapshot', 'warning', 'diagnosticAnimationSnapshot');
        return;
      }
    } catch { /* An unreadable source does not invalidate a usable native export. */ }
  }
}

function tiledImageSize(paint, context) {
  const dimensions = context.imageDimensions && context.imageDimensions.get(paint.imageHash);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return 'auto';
  const scale = Math.max(0.0001, number(paint.scalingFactor, 1));
  // scalingFactor multiplies the source pixel size, never the frame width.
  return `${px(dimensions.width * scale)} ${px(dimensions.height * scale)}`;
}

function mediaAssetFingerprint(mimeType, content) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
  }
  return `${mimeType}:${content.length}:${hash >>> 0}`;
}

function matchingMediaAsset(context, mimeType, content, field) {
  if (!context.mediaAssetCache) context.mediaAssetCache = new Map();
  const bucket = context.mediaAssetCache.get(mediaAssetFingerprint(mimeType, content)) || [];
  // The fingerprint only narrows candidates: compare the bytes/text to avoid
  // ever replacing a real image on a hash collision.
  return bucket.find(asset => asset[field] === content) || null;
}

function rememberMediaAsset(context, asset) {
  if (!context.mediaAssetCache) context.mediaAssetCache = new Map();
  const key = mediaAssetFingerprint(asset.mimeType, asset.text || asset.dataBase64 || '');
  const bucket = context.mediaAssetCache.get(key) || [];
  bucket.push(asset);
  context.mediaAssetCache.set(key, bucket);
}

function exportAssetLimitError(key) {
  const error = new Error(translate(key));
  error.name = 'ExportAssetLimitError';
  return error;
}

function reserveExportAsset(context, byteLength) {
  if (context.assets.length >= MAX_ASSETS) throw exportAssetLimitError('assetLimit');
  const size = Math.max(0, Number.isFinite(byteLength) ? Math.floor(byteLength) : 0);
  const current = Math.max(0, Number.isFinite(context.assetBytes) ? context.assetBytes : 0);
  if (current + size > MAX_EXPORT_ASSET_BYTES) throw exportAssetLimitError('assetBytesLimit');
  context.assetBytes = current + size;
}

async function materializeImageHash(hash, context) {
  if (context.imageHashes.has(hash)) return context.imageHashes.get(hash);
  if (context.failedImageHashes.has(hash)) return null;
  const image = figma.getImageByHash(hash);
  if (!image) {
    context.failedImageHashes.add(hash);
    context.warnings.push(translate('imageReadWarning', { hash: hash.slice(0, 8) }));
    return null;
  }
  try {
    const bytes = await image.getBytesAsync();
    const mimeType = sniffMime(bytes);
    if (!context.imageAnimations) context.imageAnimations = new Map();
    context.imageAnimations.set(hash, mimeType === 'image/gif' && isAnimatedGif(bytes));
    let dimensions = imageBytesDimensions(bytes, mimeType);
    if (typeof image.getSizeAsync === 'function') {
      try { dimensions = await image.getSizeAsync(); } catch { /* The bytes remain usable. */ }
    }
    if (dimensions && Number.isFinite(dimensions.width) && Number.isFinite(dimensions.height)
      && dimensions.width > 0 && dimensions.height > 0) {
      if (!context.imageDimensions) context.imageDimensions = new Map();
      context.imageDimensions.set(hash, dimensions);
    } else dimensions = null;
    const dataBase64 = bytesToBase64(bytes);
    const existing = matchingMediaAsset(context, mimeType, dataBase64, 'dataBase64');
    if (existing) {
      context.imageHashes.set(hash, existing.id);
      return existing.id;
    }
    const id = `image-${context.assets.length + 1}`;
    reserveExportAsset(context, bytes.byteLength);
    const asset = {
      id,
      name: `${id}.${imageExtension(mimeType)}`,
      mimeType,
      dataBase64,
      ...(dimensions || {}),
    };
    context.assets.push(asset);
    rememberMediaAsset(context, asset);
    context.imageHashes.set(hash, id);
    return id;
  } catch (error) {
    if (error && error.name === 'ExportAssetLimitError') throw error;
    context.failedImageHashes.add(hash);
    context.warnings.push(translate('imageConversionWarning', { hash: hash.slice(0, 8) }));
    return null;
  }
}

async function materializeImageHashes(context) {
  const hashes = [...context.pendingImageHashes];
  for (let index = 0; index < hashes.length; index += 1) {
    if (cancelled) throw new Error(translate('exportCancelled'));
    await materializeImageHash(hashes[index], context);
    post('progress', { progress: 8 + Math.round(((index + 1) / Math.max(1, hashes.length)) * 12), label: translate('readingImages') });
  }
}

function shouldExportSvg(node) {
  const arc = node && node.type === 'ELLIPSE' && node.arcData;
  const arcSweep = arc ? Math.abs(number(arc.endingAngle) - number(arc.startingAngle)) : Math.PI * 2;
  const partialEllipse = Boolean(
    arc
    && (number(arc.innerRadius) > 0 || arcSweep < (Math.PI * 2) - 0.0001),
  );
  const imageFilledEllipse = Boolean(
    node
    && node.type === 'ELLIPSE'
    && 'fills' in node
    && !mixed(node.fills)
    && paintList(node.fills).some(paint => paint.type === 'IMAGE' && paint.imageHash),
  );
  return ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'TEXT_PATH'].includes(node.type)
    || isVectorArtworkGroup(node)
    || partialEllipse
    || imageFilledEllipse
    || Boolean(node.isMask)
    || Boolean('children' in node && Array.isArray(node.children) && node.children.some(child => child.isMask));
}

function isVectorArtworkGroup(node) {
  if (!node || node.type !== 'GROUP' || !Array.isArray(node.children)) return false;
  if (semanticTagFromName(node) || readSemanticMetadata(node).tag || reactionUrl(node)) return false;
  const stack = node.children.filter(isVisible);
  let leaves = 0;
  let vectorLeaves = 0;
  let visited = 0;
  while (stack.length && visited < 512) {
    const child = stack.pop();
    visited += 1;
    if (semanticTagFromName(child) || readSemanticMetadata(child).tag || reactionUrl(child)) return false;
    if (child.type === 'GROUP' && Array.isArray(child.children)) {
      stack.push(...child.children.filter(isVisible));
    } else if (['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE', 'ELLIPSE', 'RECTANGLE', 'TEXT_PATH'].includes(child.type)
      && !nodeHasImagePaint(child)) {
      leaves += 1;
      if (!['RECTANGLE', 'ELLIPSE'].includes(child.type)) vectorLeaves += 1;
    } else return false;
  }
  return leaves > 0 && vectorLeaves > 0 && stack.length === 0;
}

function shouldKeepSmallVectorSvg(node) {
  const geometry = snapshotRenderGeometry(node) || node;
  if (!(number(node.width) <= 24 && number(node.height) <= 24
    && number(geometry.width) <= 24 && number(geometry.height) <= 24)) return false;
  const stack = [node];
  let visited = 0;
  while (stack.length && visited < 32) {
    const current = stack.pop();
    visited += 1;
    if (!current || !isVisible(current)) continue;
    if (current.isMask || current.type === 'TEXT' || current.type === 'TEXT_PATH'
      || (current.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(current.blendMode))
      || (Array.isArray(current.effects) && current.effects.some(effect => effect.visible !== false))
      || (Array.isArray(current.dashPattern) && current.dashPattern.length)
      || shouldMaterializeComplexBackground(current)) return false;
    for (const paints of [current.fills, current.strokes]) {
      if (paintList(paints).some(paint => paint.type !== 'SOLID'
        || (paint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(paint.blendMode)))) return false;
    }
    if (Array.isArray(current.children)) stack.push(...current.children.filter(isVisible));
  }
  return visited > 0 && stack.length === 0;
}

function shouldRasterizeImageNode(node) {
  const hasImage = nodeHasImagePaint(node);
  const hasVisibleChildren = 'children' in node
    && Array.isArray(node.children)
    && node.children.some(isVisible);
  return hasImage && !hasVisibleChildren && node.type !== 'TEXT';
}

function nodeHasImagePaint(node) {
  return Boolean(
    node
    && 'fills' in node
    && !mixed(node.fills)
    && paintList(node.fills).some(paint => paint.type === 'IMAGE' && paint.imageHash),
  );
}

const ATOMIC_MEDIA_CONTAINER_PROPERTIES = new Set([
  'display',
  'flex-direction',
  'flex-wrap',
  'gap',
  'row-gap',
  'column-gap',
  'justify-content',
  'align-content',
  'align-items',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
]);

function declarationProperty(declaration) {
  const separator = declaration.indexOf(':');
  return separator < 0 ? '' : declaration.slice(0, separator).trim().toLowerCase();
}

function hasDeclaration(declarations, property) {
  return declarations.some(declaration => declarationProperty(declaration) === property);
}

function stretchedAtomicSize(node, parent, axis) {
  if (!parent) return 'auto';
  const horizontal = axis === 'horizontal';
  const start = immediateParentTransform(node, parent)[horizontal ? 0 : 1][2];
  const size = number(horizontal ? node.width : node.height);
  const parentSize = number(horizontal ? parent.width : parent.height);
  if (!parentSize) return 'auto';
  const end = parentSize - start - size;
  const insets = start + end;
  return `calc(100% ${insets < 0 ? '+' : '-'} ${px(Math.abs(insets))})`;
}

function atomicMediaDeclarations(node, parent, context, options = {}) {
  const result = layoutDeclarations(node, parent, context)
    .filter(declaration => {
      const property = declarationProperty(declaration);
      if (ATOMIC_MEDIA_CONTAINER_PROPERTIES.has(property)) return false;
      // exportAsync already bakes the node's opacity and rotation into SVG/PNG.
      // Original image bytes have not been flattened and still need both.
      return options.snapshot === false || !['opacity', 'transform'].includes(property);
    });
  const parentLayout = effectiveAutoLayout(parent, context);
  const isAbsolute = !parent
    || Boolean(parent && !parentLayout)
    || Boolean(parent && structuralValue(node, context, 'layoutPositioning') === 'ABSOLUTE');
  const constraints = structuralValue(node, context, 'constraints') || {};
  const local = immediateParentTransform(node, parent);
  if (parent && isAbsolute && options.snapshot !== false
    && (options.snapshotBox || (Math.abs(local[0][1]) < 1e-7 && Math.abs(local[1][0]) < 1e-7
      && (local[0][0] < 0 || local[1][1] < 0)))) {
    // Figma x/y is the transformed origin, which is the opposite corner for
    // a flipped icon. Native SVG/PNG already bakes that flip into its pixels.
    // Position the exported box at its minimum corner, not at that origin.
    const box = options.snapshotBox || { x: local[0][2] + Math.min(0, local[0][0] * number(node.width)),
      y: local[1][2] + Math.min(0, local[1][1] * number(node.height)),
      width: Math.abs(local[0][0]) * number(node.width),
      height: Math.abs(local[1][1]) * number(node.height) };
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (['left', 'right', 'top', 'bottom', 'width', 'height'].includes(declarationProperty(result[index]))) result.splice(index, 1);
    }
    for (const axis of ['horizontal', 'vertical']) {
      const positioned = axisConstraintDeclarations(node, parent, axis, context, box);
      result.push(...positioned.declarations);
      const size = axis === 'horizontal' ? 'width' : 'height';
      if (!positioned.controlsSize) result.push(`${size}:${px(box[size])}`);
    }
  }
  if (!hasDeclaration(result, 'width')) {
    result.push(
      isAbsolute && constraints.horizontal === 'STRETCH'
        ? `width:${stretchedAtomicSize(node, parent, 'horizontal')}`
        : `width:${px(node.width)}`,
    );
  }
  if (!hasDeclaration(result, 'height')) {
    result.push(
      isAbsolute && constraints.vertical === 'STRETCH'
        ? `height:${stretchedAtomicSize(node, parent, 'vertical')}`
        : `height:${px(node.height)}`,
    );
  }
  if (!hasDeclaration(result, 'max-width')) result.push('max-width:none');
  if (!hasDeclaration(result, 'max-height')) result.push('max-height:none');
  // SVG and PNG exports are complete snapshots of the Figma node. Reset every
  // box paint that could duplicate the snapshot, then make the asset occupy
  // the exact CSS box without contain-letterboxing.
  result.push(
    'box-sizing:border-box',
    'display:block',
    'margin:0',
    'padding:0',
    'border:0',
    'outline:0',
    'background:none',
    `object-fit:${options.objectFit || 'fill'}`,
    `object-position:${options.objectPosition || 'center'}`,
  );
  const strokeSize = 'strokeWeight' in node && !mixed(node.strokeWeight)
    ? Math.max(1, number(node.strokeWeight, 1))
    : 1;
  const snapshotBox = options.snapshotBox || node;
  if (number(snapshotBox.width) <= 0) result.push(`min-width:${px(strokeSize)}`);
  if (number(snapshotBox.height) <= 0) result.push(`min-height:${px(strokeSize)}`);
  return result;
}

function imagePaintObjectFit(paint) {
  const mode = paint && paint.scaleMode || 'FILL';
  if (mode === 'FIT') return 'contain';
  if (mode === 'FILL' || mode === 'CROP') return 'cover';
  return 'fill';
}

function imagePaintObjectPosition(paint) {
  return paint && paint.scaleMode === 'CROP' ? imagePaintPosition(paint) : 'center';
}

function singleImagePaint(node) {
  if (!('fills' in node) || mixed(node.fills)) return null;
  const paints = paintList(node.fills);
  return paints.length === 1 && paints[0].type === 'IMAGE' ? paints[0] : null;
}

function shouldUseOriginalImageNode(node) {
  const paint = singleImagePaint(node);
  if (!paint) return false;
  if (hasLayeredStroke(node)) return false;
  // CROP is an affine sampling transform, not CSS cover + object-position.
  // Let Figma export the real clipping/matrix instead of guessing its focal point.
  if (paint.scaleMode === 'CROP') return false;
  if (!['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(node.type)) return false;
  if (paint.opacity != null && number(paint.opacity, 1) !== 1) return false;
  if (paint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(paint.blendMode)) return false;
  if (number(paint.rotation)) return false;
  if (
    paint.filters
    && typeof paint.filters === 'object'
    && Object.values(paint.filters).some(value => Math.abs(number(value)) > 0.0001)
  ) return false;
  if ('strokes' in node && !mixed(node.strokes)) {
    const unsupportedStroke = paintList(node.strokes).some(stroke => stroke.type !== 'SOLID');
    if (unsupportedStroke) return false;
  }
  return true;
}

function canRepresentOriginalImageFallback(node) {
  return nodeHasImagePaint(node)
    && ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE', 'SECTION', 'ELLIPSE'].includes(node.type);
}

function preferredPngScale(node) {
  const geometry = snapshotRenderGeometry(node) || node;
  const width = Math.max(1, number(geometry.width));
  const height = Math.max(1, number(geometry.height));
  // Crisp at ordinary device pixel ratios without unbounded bitmap exports.
  // Render bounds include shadows and strokes, not just the layout footprint.
  for (const scale of [4, 2]) {
    if (width * scale <= 4096 && height * scale <= 4096
      && width * height * scale * scale <= 16_000_000) return scale;
  }
  return 1;
}

function exportUsesAbsoluteBounds(node) {
  // LINE bounds exclude caps and arrowheads that can extend beyond the
  // geometry box, even when a diagonal line has two non-zero axes.
  return node.type !== 'LINE' && !snapshotRenderGeometry(node)
    && number(node.width) > 0 && number(node.height) > 0;
}

function snapshotRenderGeometry(node) {
  const render = node && node.absoluteRenderBounds;
  const bounds = node && node.absoluteBoundingBox;
  if (!render || !bounds || number(node.rotation)) return null;
  const transform = node.absoluteTransform;
  // Absolute rectangles cannot be treated as local rectangles under a
  // rotated/skewed ancestor. Leave that case to Figma's bounded export.
  if (Array.isArray(transform) && transform[0] && transform[1]
    && (Math.abs(number(transform[0][1])) > 0.00001
      || Math.abs(number(transform[1][0])) > 0.00001
      || number(transform[0][0], 1) <= 0 || number(transform[1][1], 1) <= 0)) return null;
  if (![render.x, render.y, render.width, render.height, bounds.x, bounds.y, bounds.width, bounds.height]
    .every(Number.isFinite) || render.width <= 0 || render.height <= 0) return null;
  const changed = Math.abs(render.x - bounds.x) > 0.01 || Math.abs(render.y - bounds.y) > 0.01
    || Math.abs(render.width - bounds.width) > 0.01 || Math.abs(render.height - bounds.height) > 0.01;
  if (!changed) return null;
  // Cropped export can also remove intentional empty vector space. Keep the
  // layout footprint and position the painted rectangle inside/around it.
  const scaleX = bounds.width > 0 ? number(node.width) / bounds.width : 1;
  const scaleY = bounds.height > 0 ? number(node.height) / bounds.height : 1;
  return {
    x: (render.x - bounds.x) * scaleX,
    y: (render.y - bounds.y) * scaleY,
    width: render.width * scaleX,
    height: render.height * scaleY,
  };
}

function rotatedLineSnapshotGeometry(node, parent, context) {
  if (!node || node.type !== 'LINE' || !parent) return null;
  const local = immediateParentTransform(node, parent);
  if (!number(node.rotation) && Math.abs(local[0][1]) < 1e-7 && Math.abs(local[1][0]) < 1e-7
    && local[0][0] >= 0 && local[1][1] >= 0) return null;
  // Native line exports already contain their own rotation. Limit this
  // correction to positioned lines inside an axis-aligned parent: a rotated
  // ancestor or an Auto Layout flow requires a different coordinate model.
  if (effectiveAutoLayout(parent, context)
    && structuralValue(node, context, 'layoutPositioning') !== 'ABSOLUTE') return null;
  let parentMatrix = parent.absoluteTransform;
  if (!validNodeTransform(parentMatrix)) {
    if (number(parent.rotation)) return null;
    const bounds = nodeBounds(parent);
    parentMatrix = [[1, 0, bounds.x], [0, 1, bounds.y]];
  }
  if (Math.abs(parentMatrix[0][1]) > 1e-7 || Math.abs(parentMatrix[1][0]) > 1e-7
    || parentMatrix[0][0] <= 0 || parentMatrix[1][1] <= 0) return null;
  const bounds = node.absoluteBoundingBox;
  const render = node.absoluteRenderBounds;
  if (!bounds || !render || ![bounds.x, bounds.y, bounds.width, bounds.height,
    render.x, render.y, render.width, render.height].every(Number.isFinite)
    || bounds.width < 0 || bounds.height < 0 || render.width <= 0 || render.height <= 0) return null;
  const zero = value => Math.abs(value) < 1e-7 ? 0 : value;
  const layoutBox = {
    x: (bounds.x - parentMatrix[0][2]) / parentMatrix[0][0],
    y: (bounds.y - parentMatrix[1][2]) / parentMatrix[1][1],
    width: zero(bounds.width / parentMatrix[0][0]),
    height: zero(bounds.height / parentMatrix[1][1]),
  };
  return {
    layoutBox,
    x: (render.x - bounds.x) / parentMatrix[0][0],
    y: (render.y - bounds.y) / parentMatrix[1][1],
    width: render.width / parentMatrix[0][0],
    height: render.height / parentMatrix[1][1],
  };
}

function renderSnapshotAsset(node, parent, context, className, label, assetId, phrasingOnly = false) {
  const geometry = rotatedLineSnapshotGeometry(node, parent, context) || snapshotRenderGeometry(node);
  const layoutBox = geometry && geometry.layoutBox || node;
  const declarations = atomicMediaDeclarations(node, parent, context, {
    snapshotBox: geometry && geometry.layoutBox,
  });
  const identity = `data-label="${label}" data-figma-id="${escapeAttribute(node.id)}" data-kodety-source-node="${escapeAttribute(node.id)}"`;
  if (!geometry) {
    context.rules.push(`.${className}{${declarations.join(';')}}`);
    registerResponsiveRules(node, parent, context, className, 'img');
    return `<img class="${className}" ${identity} src="figma-asset://${assetId}" alt="${escapeAttribute(atomicImageAlt(node))}"${atomicImageAttributes(node)}>`;
  }
  if (!hasDeclaration(declarations, 'position')) declarations.push('position:relative');
  declarations.push('overflow:visible');
  // A horizontal/vertical line occupies zero space on one layout axis. Its
  // visible stroke lives on the absolutely positioned paint layer instead.
  if (number(layoutBox.width) <= 0) declarations.push('min-width:0');
  if (number(layoutBox.height) <= 0) declarations.push('min-height:0');
  context.rules.push(`.${className}{${declarations.join(';')}}`);
  registerResponsiveRules(node, parent, context, className, 'atomic-media');
  const assetClass = `${className}-paint`;
  const relative = (value, size) => size > 0 ? ratioPercent(value, size) : px(value);
  const assetDeclarations = [
    'position:absolute', 'display:block', 'box-sizing:border-box', 'padding:0', 'margin:0',
    'border:0', 'outline:0', 'background:none', 'max-width:none', 'max-height:none',
    'object-fit:fill', 'object-position:center',
    `left:${relative(geometry.x, number(layoutBox.width))}`,
    `top:${relative(geometry.y, number(layoutBox.height))}`,
    `width:${relative(geometry.width, number(layoutBox.width))}`,
    `height:${relative(geometry.height, number(layoutBox.height))}`,
  ];
  context.rules.push(`.${assetClass}{${assetDeclarations.join(';')}}`);
  const wrapperTag = phrasingOnly ? 'span' : 'div';
  return `<${wrapperTag} class="${className}" ${identity}><img class="${assetClass}" data-label="${label}" src="figma-asset://${assetId}" alt="${escapeAttribute(atomicImageAlt(node))}"${atomicImageAttributes(geometry)}></${wrapperTag}>`;
}

function atomicImageAttributes(node) {
  const attributes = [];
  const width = number(node.width);
  const height = number(node.height);
  if (width > 0) attributes.push(`width="${Math.max(1, Math.round(width))}"`);
  if (height > 0) attributes.push(`height="${Math.max(1, Math.round(height))}"`);
  return attributes.length ? ` ${attributes.join(' ')}` : '';
}

function atomicImageAlt(node) {
  const metadata = readSemanticMetadata(node);
  return metadata.a11y && typeof metadata.a11y.alt === 'string' ? metadata.a11y.alt : '';
}

async function materializeNodeImagePaints(node, context) {
  const resolved = [];
  if (!('fills' in node) || mixed(node.fills)) return resolved;
  for (const paint of paintList(node.fills)) {
    if (paint.type === 'IMAGE' && paint.imageHash) {
      const id = await materializeImageHash(paint.imageHash, context);
      if (id) resolved.push({ id, paint });
    }
  }
  return resolved;
}

async function exportPngNode(node, context, scale = 1, allowOriginalAssetFallback = false) {
  const scales = [...new Set([scale, ...(scale > 2 ? [2] : []), ...(scale > 1 ? [1] : [])])];
  let lastError = null;
  for (const candidateScale of scales) {
    if (cancelled) throw new Error(translate('exportCancelled'));
    try {
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: candidateScale },
        contentsOnly: true,
        // LINE strokes/caps/arrowheads can live outside their geometry bounds.
        useAbsoluteBounds: exportUsesAbsoluteBounds(node),
      });
      if (cancelled) throw new Error(translate('exportCancelled'));
      const dataBase64 = bytesToBase64(bytes);
      const existing = matchingMediaAsset(context, 'image/png', dataBase64, 'dataBase64');
      if (existing) return existing.id;
      if (!exportAssetFits(context, bytes.byteLength)) {
        lastError = exportAssetLimitError(
          context.assets.length >= MAX_ASSETS ? 'assetLimit' : 'assetBytesLimit',
        );
        continue;
      }
      const id = `render-${context.assets.length + 1}`;
      reserveExportAsset(context, bytes.byteLength);
      const geometry = snapshotRenderGeometry(node) || node;
      const asset = {
        id,
        name: `${safe(node.name, id)}.png`,
        mimeType: 'image/png',
        dataBase64,
        width: number(geometry.width),
        height: number(geometry.height),
      };
      context.assets.push(asset);
      rememberMediaAsset(context, asset);
      return id;
    } catch (error) {
      if (cancelled) throw error;
      if (error && error.name === 'ExportAssetLimitError') lastError = error;
      else lastError = error || new Error('PNG export failed');
    }
  }
  if (lastError && lastError.name === 'ExportAssetLimitError' && !allowOriginalAssetFallback) {
    throw lastError;
  }
  context.warnings.push(translate('imageOriginalWarning', { name: node.name }));
  return null;
}

function nodeTreeHasImagePaint(node) {
  const stack = [node];
  let visited = 0;
  while (stack.length && visited < MAX_NODES) {
    const current = stack.pop();
    visited += 1;
    if (!current || !isVisible(current)) continue;
    try {
      if (
        'fills' in current
        && !mixed(current.fills)
        && paintList(current.fills).some(paint => paint.type === 'IMAGE' && paint.imageHash)
      ) return true;
    } catch {
      // Unsupported fill access cannot contribute a usable embedded bitmap.
    }
    if (current && 'children' in current && Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return false;
}

function svgAttribute(tag, name) {
  const escapedName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function svgDefinitionBodies(text, tagName) {
  const definitions = new Map();
  const expression = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  for (const match of text.matchAll(expression)) {
    const id = svgAttribute(match[1], 'id');
    if (id) definitions.set(id, match[2]);
  }
  return definitions;
}

function svgReferencedIds(text, property) {
  const ids = new Set();
  const reference = `url\\(\\s*["']?#([^\\s)"']+)["']?\\s*\\)`;
  const attributeExpression = new RegExp(`\\b${property}\\s*=\\s*["']\\s*${reference}`, 'gi');
  const styleExpression = new RegExp(`\\b${property}\\s*:\\s*${reference}`, 'gi');
  for (const expression of [attributeExpression, styleExpression]) {
    for (const match of text.matchAll(expression)) ids.add(match[1]);
  }
  return ids;
}

function svgHasUsableReferencedFilters(text) {
  const referenced = svgReferencedIds(text, 'filter');
  if (!referenced.size) return true;
  const filters = svgDefinitionBodies(text, 'filter');
  for (const id of referenced) {
    const body = filters.get(id);
    if (!body || !/<fe[a-z]+\b/i.test(body)) return false;
  }
  return true;
}

function svgHasUsableEmbeddedImage(text) {
  const imageTags = text.match(/<image\b[^>]*>/gi) || [];
  const usableImageIds = new Set();
  const images = imageTags.map(tag => ({
    tag,
    href: svgAttribute(tag, 'href') || svgAttribute(tag, 'xlink:href'),
    id: svgAttribute(tag, 'id'),
  }));
  let hasUsableImage = images.some(image => /^data:image\//i.test(image.href));
  for (const image of images) {
    if (/^data:image\//i.test(image.href) && image.id) usableImageIds.add(image.id);
  }
  // Resolve the uncommon but valid case where one <image> references another
  // embedded image. A dangling fragment must never count as image content.
  let discoveredReference = true;
  while (discoveredReference) {
    discoveredReference = false;
    for (const image of images) {
      if (!image.id || usableImageIds.has(image.id) || !image.href.startsWith('#')) continue;
      if (!usableImageIds.has(image.href.slice(1))) continue;
      usableImageIds.add(image.id);
      hasUsableImage = true;
      discoveredReference = true;
    }
  }
  if (!hasUsableImage) return false;

  const imageTagHasUsableSource = tag => {
    const href = svgAttribute(tag, 'href') || svgAttribute(tag, 'xlink:href');
    return /^data:image\//i.test(href)
      || (href.startsWith('#') && usableImageIds.has(href.slice(1)));
  };

  const patterns = svgDefinitionBodies(text, 'pattern');
  const linearGradients = svgDefinitionBodies(text, 'linearGradient');
  const radialGradients = svgDefinitionBodies(text, 'radialGradient');
  const paintReferences = new Set([
    ...svgReferencedIds(text, 'fill'),
    ...svgReferencedIds(text, 'stroke'),
  ]);
  const referencedPatterns = [];
  for (const id of paintReferences) {
    if (patterns.has(id)) {
      referencedPatterns.push(id);
      continue;
    }
    if (linearGradients.has(id) || radialGradients.has(id)) continue;
    // A paint server referenced by fill/stroke but absent from <defs> produces
    // an invisible region. Reject the SVG instead of accepting a partial icon.
    return false;
  }
  if (referencedPatterns.length) {
    for (const id of referencedPatterns) {
      const body = patterns.get(id);
      if (!body || !body.trim()) return false;
      const bodyImages = body.match(/<image\b[^>]*>/gi) || [];
      if (bodyImages.some(imageTagHasUsableSource)) continue;
      const uses = [...body.matchAll(/<use\b[^>]*>/gi)];
      const connected = uses.some(match => {
        const href = svgAttribute(match[0], 'href') || svgAttribute(match[0], 'xlink:href');
        return href.startsWith('#') && usableImageIds.has(href.slice(1));
      });
      if (!connected) return false;
    }
    return true;
  }

  // An image outside <defs> is directly rendered (usually under a clipPath).
  const withoutDefinitions = text.replace(/<defs\b[\s\S]*?<\/defs>/gi, '');
  const directImages = withoutDefinitions.match(/<image\b[^>]*>/gi) || [];
  if (directImages.some(imageTagHasUsableSource)) return true;
  return [...withoutDefinitions.matchAll(/<use\b[^>]*>/gi)].some(match => {
    const href = svgAttribute(match[0], 'href') || svgAttribute(match[0], 'xlink:href');
    return href.startsWith('#') && usableImageIds.has(href.slice(1));
  });
}

function usableSvgText(value, requiresEmbeddedImage) {
  if (typeof value !== 'string' || !/<svg(?:\s|>)/i.test(value.slice(0, 2048))) return false;
  const graph = svgReferenceGraph(value);
  return graph.valid && (!requiresEmbeddedImage || graph.hasEmbeddedImage);
}

function svgReferenceGraph(value) {
  const document = { tag: '#document', attributes: '', children: [] };
  const parents = [document];
  const ids = new Map();
  // A small read-only XML walk works in Figma's JS sandbox without DOMParser.
  // Keep quoted > characters intact and ignore comments/CDATA while checking
  // the structure and local reference graph of Figma's own SVG output.
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?([a-z][\w:.-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  for (const match of value.matchAll(tags)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      if (parents.length <= 1 || parents[parents.length - 1].tag !== tag) return { valid: false };
      const element = parents.pop();
      element.body = value.slice(element.bodyStart, match.index);
      continue;
    }
    const element = { tag, attributes: match[0], children: [], bodyStart: match.index + match[0].length, body: '' };
    const id = svgAttribute(match[0], 'id');
    if (id) {
      if (ids.has(id)) return { valid: false };
      ids.set(id, element);
    }
    parents[parents.length - 1].children.push(element);
    if (!/\/\s*>$/.test(match[0])) parents.push(element);
  }
  if (parents.length !== 1 || document.children.length !== 1 || document.children[0].tag !== 'svg') return { valid: false };

  const paintTags = new Set(['lineargradient', 'radialgradient', 'pattern']);
  const graphicTags = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'foreignobject']);
  const resourceProperties = ['fill', 'stroke', 'mask', 'clip-path', 'filter', 'marker-start', 'marker-mid', 'marker-end'];
  const validated = new Set();
  let hasEmbeddedImage = false;
  const hrefFor = element => svgAttribute(element.attributes, 'href') || svgAttribute(element.attributes, 'xlink:href');
  const inherited = element => {
    const href = hrefFor(element);
    return href.startsWith('#') ? ids.get(href.slice(1)) : null;
  };
  const hasContent = (element, predicate, seen = new Set()) => {
    if (!element || seen.has(element)) return false;
    seen.add(element);
    if (predicate(element)) return true;
    if (element.children.some(child => hasContent(child, predicate, seen))) return true;
    return Boolean(inherited(element) && hasContent(inherited(element), predicate, seen));
  };
  const usableResource = (element, property) => {
    if (!element) return false;
    if (property === 'fill' || property === 'stroke') {
      if (!paintTags.has(element.tag)) return false;
      return hasContent(element, entry => element.tag === 'pattern'
        ? graphicTags.has(entry.tag)
        : entry.tag === 'stop');
    }
    if (property === 'filter') return element.tag === 'filter'
      && hasContent(element, entry => /^fe[a-z]+$/.test(entry.tag));
    if (property === 'mask' || property === 'clip-path' || property.startsWith('marker-')) {
      const expected = property === 'clip-path' ? 'clippath' : property === 'mask' ? 'mask' : 'marker';
      return element.tag === expected && hasContent(element, entry => graphicTags.has(entry.tag));
    }
    return true;
  };
  const walk = (element, visiting = new Set()) => {
    if (visiting.has(element)) return false;
    if (validated.has(element)) return true;
    // The Builder deliberately removes active/HTML SVG content and nested
    // SVG data URLs. Reject them here so the native PNG fallback preserves
    // their appearance instead of handing off a partially blank SVG.
    if (['script', 'foreignobject'].includes(element.tag)) return false;
    const next = new Set(visiting);
    next.add(element);
    const referenceSource = element.tag === 'style' ? element.body : element.attributes;
    for (const property of resourceProperties) {
      for (const id of svgReferencedIds(referenceSource, property)) {
        const target = ids.get(id);
        if (!usableResource(target, property) || !walk(target, next)) return false;
      }
    }
    const href = hrefFor(element);
    if (['use', 'image', 'feimage', 'lineargradient', 'radialgradient', 'pattern', 'filter'].includes(element.tag)) {
      if (href.startsWith('#')) {
        const target = ids.get(href.slice(1));
        if (!target || !walk(target, next)) return false;
        if (element.tag === 'use' && !hasRenderedContent(target)) return false;
      } else if (element.tag === 'image' || element.tag === 'feimage') {
        if (!/^data:image\/(?:png|jpe?g|gif|webp)(?:;|,)/i.test(href)) return false;
        hasEmbeddedImage = true;
      } else if (element.tag === 'use' || href) return false;
    }
    for (const child of element.children) {
      // Unused definitions are irrelevant. A reference walks the complete
      // target on demand, including chained uses/patterns/gradients.
      if (child.tag !== 'defs' && !walk(child, next)) return false;
    }
    validated.add(element);
    return true;
  };
  const hasRenderedContent = (element, seen = new Set()) => {
    if (!element || seen.has(element)) return false;
    seen.add(element);
    if (graphicTags.has(element.tag)) return true;
    if (element.tag === 'use' && hasRenderedContent(inherited(element), seen)) return true;
    return element.children.some(child => !['defs', 'clippath', 'mask', 'pattern', 'filter', 'marker', 'lineargradient', 'radialgradient', 'style', 'metadata', 'title', 'desc'].includes(child.tag)
      && hasRenderedContent(child, seen));
  };
  const root = document.children[0];
  return { valid: walk(root) && hasRenderedContent(root), hasEmbeddedImage };
}

function exportAssetFits(context, byteLength) {
  const size = Math.max(0, Number.isFinite(byteLength) ? Math.floor(byteLength) : 0);
  return context.assets.length < MAX_ASSETS
    && Math.max(0, Number(context.assetBytes) || 0) + size <= MAX_EXPORT_ASSET_BYTES;
}

function stretchSvgBackground(svg) {
  // A sampled paint fills its CSS background box, even after responsive
  // resizing changes the aspect ratio. Only change the outer viewport;
  // nested image/shape coordinates and ordinary artwork stay untouched.
  return svg.replace(/<svg\b(?:"[^"]*"|'[^']*'|[^'">])*>/i, root => root
    .replace(/\s+preserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi, '')
    .replace(/\/?>$/, closing => ` preserveAspectRatio="none"${closing}`));
}

async function exportSvgNode(node, context, stretch = false, quiet = false) {
  try {
    const useAbsoluteBounds = exportUsesAbsoluteBounds(node);
    const requiresEmbeddedImage = nodeTreeHasImagePaint(node);
    const preciseSettings = {
      // This branch is already an image fallback for masks/vectors. Outlining
      // text avoids a second fidelity loss when the Figma typeface is not yet
      // installed in the destination project.
      contentsOnly: true,
      svgOutlineText: true,
      svgIdAttribute: true,
      svgSimplifyStroke: false,
      useAbsoluteBounds,
    };
    const compatibilitySettings = {
      contentsOnly: true,
      svgOutlineText: true,
      useAbsoluteBounds,
    };
    let text = '';
    for (const attempt of [
      { format: 'SVG_STRING', settings: preciseSettings },
      { format: 'SVG', settings: preciseSettings },
      { format: 'SVG_STRING', settings: compatibilitySettings },
      { format: 'SVG', settings: compatibilitySettings },
    ]) {
      try {
        // SVG_STRING avoids an unnecessary UTF-8 round trip. The byte and
        // reduced-option attempts preserve compatibility with older desktop
        // builds while keeping PNG as the true last resort.
        const result = await node.exportAsync({ format: attempt.format, ...attempt.settings });
        const exported = typeof result === 'string' ? result : utf8Decode(result);
        const candidate = stretch ? stretchSvgBackground(exported) : exported;
        const candidateBytes = utf8ByteLength(candidate);
        const existing = matchingMediaAsset(context, 'image/svg+xml', candidate, 'text');
        if (usableSvgText(candidate, requiresEmbeddedImage) && (existing || exportAssetFits(context, candidateBytes))) {
          if (existing) return existing.id;
          text = candidate;
          break;
        }
      } catch (error) {
        if (error && error.name === 'ExportAssetLimitError') throw error;
      }
    }
    if (!text) throw new Error('No usable SVG export');
    const id = `vector-${context.assets.length + 1}`;
    reserveExportAsset(context, utf8ByteLength(text));
    const geometry = snapshotRenderGeometry(node) || node;
    const asset = {
      id,
      name: `${safe(node.name, id)}.svg`,
      mimeType: 'image/svg+xml',
      text,
      width: number(geometry.width),
      height: number(geometry.height),
    };
    context.assets.push(asset);
    rememberMediaAsset(context, asset);
    return id;
  } catch (error) {
    if (error && error.name === 'ExportAssetLimitError') throw error;
    if (!quiet) context.warnings.push(translate('vectorSimplifiedWarning', { name: node.name }));
    return null;
  }
}

async function renderOriginalImageFallback(node, parent, context, className, label, phrasingOnly = false) {
  const resolved = await materializeNodeImagePaints(node, context);
  if (!resolved.length) return '';
  const imagePaint = singleImagePaint(node);
  if (imagePaint && imagePaint.scaleMode === 'CROP'
    && typeof emitConversionDiagnostic === 'function') {
    emitConversionDiagnostic(context, node, 'crop-fallback', 'warning', 'diagnosticCropFallback');
  }
  const matchingAsset = imagePaint
    ? resolved.find(entry => entry.paint.imageHash === imagePaint.imageHash)
    : null;
  if (
    imagePaint
    && matchingAsset
    && imagePaint.scaleMode !== 'TILE'
    && shouldUseOriginalImageNode(node)
  ) {
    const declarations = atomicMediaDeclarations(node, parent, context, {
      objectFit: imagePaintObjectFit(imagePaint),
      objectPosition: imagePaintObjectPosition(imagePaint),
      snapshot: false,
    });
    // The source bitmap is not a flattened snapshot, so retain authored
    // stroke/radius/effects while excluding the duplicate CSS background.
    declarations.push(...visualDeclarations(node, context).filter(
      declaration => !declarationProperty(declaration).startsWith('background'),
    ));
    context.rules.push(`.${className}{${declarations.join(';')}}`);
    registerResponsiveRules(node, parent, context, className, 'img');
    return `<img class="${className}" data-label="${label}" data-figma-id="${escapeAttribute(node.id)}" data-kodety-source-node="${escapeAttribute(node.id)}" src="figma-asset://${matchingAsset.id}" alt="${escapeAttribute(atomicImageAlt(node))}"${atomicImageAttributes(node)}>`;
  }

  // Multiple paint layers cannot be represented by one <img>. Keep them as
  // an atomic background box so gradients/blends/tiles survive, without ever
  // restoring the frame's internal Auto Layout or padding.
  const strokePlan = await prepareGradientStroke(node, context, className);
  const declarations = [
    ...atomicMediaDeclarations(node, parent, context, { snapshot: false }),
    ...visualDeclarations(node, context),
  ];
  if (strokePlan && !hasDeclaration(declarations, 'position')) declarations.push('position:relative');
  if (imagePaint && imagePaint.opacity != null && number(imagePaint.opacity, 1) !== 1) {
    declarations.push(`opacity:${number(node.opacity, 1) * number(imagePaint.opacity, 1)}`);
  }
  if (imagePaint && imagePaint.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(imagePaint.blendMode)) {
    declarations.push(`mix-blend-mode:${blendModeCss(imagePaint.blendMode)}`);
  }
  if (node.type === 'ELLIPSE') declarations.push('border-radius:50%');
  context.rules.push(`.${className}{${declarations.join(';')}}`);
  registerResponsiveRules(node, parent, context, className, 'atomic-media');
  const alt = atomicImageAlt(node);
  const wrapperTag = phrasingOnly ? 'span' : 'div';
  return `<${wrapperTag} class="${className}" data-label="${label}" data-figma-id="${escapeAttribute(node.id)}" data-kodety-source-node="${escapeAttribute(node.id)}" role="img"${alt ? ` aria-label="${escapeAttribute(alt)}"` : ' aria-hidden="true"'}></${wrapperTag}>`;
}

async function renderNode(node, parent, context, renderedParentTag = '', renderedAncestors = []) {
  if (cancelled) throw new Error(translate('exportCancelled'));
  if (!isVisible(node)) return '';
  context.nodeCount += 1;
  if (context.nodeCount > MAX_NODES) throw new Error(translate('nodeLimit'));
  if (context.nodeCount % YIELD_EVERY === 0) {
    post('progress', {
      progress: Math.min(96, 20 + Math.round((context.nodeCount / Math.max(context.estimatedNodes, context.nodeCount)) * 70)),
      label: translate('convertingLayers', { count: formatNumber(context.nodeCount) }),
    });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const resolvedNodeLayout = effectiveAutoLayout(node, context);
  if (node.layoutMode === 'NONE' && resolvedNodeLayout) {
    if (resolvedNodeLayout.__kodetyInference === 'geometry') context.geometryInferredAutoLayoutNodes += 1;
    else context.inferredAutoLayoutNodes += 1;
  }

  const labelText = semanticLabel(node);
  const label = escapeAttribute(labelText);
  const classIdentityParts = stableCssSuffix(`${context.sourceId}:${node.id}`).split('-');
  const className = `kf-${safe(labelText, 'layer').slice(0, 46)}-${classIdentityParts[classIdentityParts.length - 1]}-${safe(context.exportId, 'export')}`;
  let tag = semanticTag(node);
  const parentTag = renderedParentTag || (parent ? semanticTag(parent) : '');
  const ancestorTags = renderedAncestors.length ? renderedAncestors : parentTag ? [parentTag] : [];
  const phrasingOnly = htmlPhrasingContext(ancestorTags);
  const interactiveAncestor = ancestorTags.some(ancestor => ancestor === 'a' || ancestor === 'button');
  if ((parentTag === 'ul' || parentTag === 'ol') && !semanticTagFromName(node) && !readSemanticMetadata(node).tag) {
    tag = 'li';
  }
  const url = interactiveAncestor ? '' : reactionUrl(node) || directHyperlinkUrl(node);
  if (url) tag = 'a';
  if (phrasingOnly && !['span', 'a', 'button', 'label'].includes(tag)) tag = 'span';
  if (interactiveAncestor && ['a', 'button', 'label'].includes(tag)) tag = 'span';
  if (ancestorTags.includes('label') && tag === 'label') tag = 'span';
  if (ancestorTags.includes('form') && tag === 'form') tag = phrasingOnly ? 'span' : 'div';
  if (parentTag === 'a' && node.type === 'TEXT' && tag !== 'a') {
    tag = 'span';
  }
  // CSS overflow clips pseudo-elements as well as children. Figma clips only
  // the children, keeping its own outside/center stroke visible. Preserve that
  // exceptional combination natively instead of silently cutting the border
  // or allowing source children to bleed outside their frame.
  const clippedOuterStroke = node.clipsContent === true && hasLayeredStroke(node)
    && ['OUTSIDE', 'CENTER'].includes(node.strokeAlign);
  const vectorAssetCandidate = shouldExportSvg(node) || clippedOuterStroke;
  if (vectorAssetCandidate) {
    // Only small, simple icons remain SVG. Medium/large artwork, masks,
    // gradients and effects use one native bitmap per composition by default.
    const id = !clippedOuterStroke && shouldKeepSmallVectorSvg(node)
      ? await exportSvgNode(node, context, false, true) : null;
    if (id) {
      if (clippedOuterStroke) emitConversionDiagnostic(context, node, 'stroke-snapshot', 'warning', 'diagnosticStrokeSnapshot');
      if (nodeHasImagePaint(node)) await warnCroppedAnimationSnapshot(node, context);
      return renderSnapshotAsset(node, parent, context, className, label, id, phrasingOnly);
    }
    const pngId = await exportPngNode(
      node,
      context,
      preferredPngScale(node),
      // A group/mask with bitmap descendants, or a non-rectangular vector,
      // cannot be reconstructed from a plain background image. Only suppress
      // a budget error when the original paint can preserve the visible box.
      canRepresentOriginalImageFallback(node),
    );
    if (pngId) {
      if (clippedOuterStroke) emitConversionDiagnostic(context, node, 'stroke-snapshot', 'warning', 'diagnosticStrokeSnapshot');
      context.rasterizedNodes = number(context.rasterizedNodes) + 1;
      if (nodeHasImagePaint(node)) await warnCroppedAnimationSnapshot(node, context);
      return renderSnapshotAsset(node, parent, context, className, label, pngId, phrasingOnly);
    }
    if (clippedOuterStroke) emitConversionDiagnostic(context, node, 'stroke-clipping', 'warning', 'diagnosticStrokeClipping');
    if (canRepresentOriginalImageFallback(node)) {
      const originalImage = await renderOriginalImageFallback(node, parent, context, className, label, phrasingOnly);
      if (originalImage) {
        context.vectorFallbackNodes += 1;
        return originalImage;
      }
    }
  }
  if (!vectorAssetCandidate && shouldRasterizeImageNode(node)) {
    if (shouldUseOriginalImageNode(node)) {
      const originalImage = await renderOriginalImageFallback(node, parent, context, className, label, phrasingOnly);
      if (originalImage) return originalImage;
    }
    const croppedPaint = paintList(node.fills).some(paint => paint.type === 'IMAGE' && paint.scaleMode === 'CROP');
    const id = await exportPngNode(node, context, preferredPngScale(node), true);
    if (id) {
      // The PNG is already a complete crop/composite of the Figma box. Do not
      // crop it a second time when its CSS box changes at a breakpoint.
      context.rasterizedNodes += 1;
      if (croppedPaint) await warnCroppedAnimationSnapshot(node, context);
      return renderSnapshotAsset(node, parent, context, className, label, id, phrasingOnly);
    }
    // If exact rasterization fails, materialize the original image paint now.
    // Leaf image paints are intentionally skipped during the initial pass to
    // avoid duplicating every bitmap in successful exports.
    const originalImage = await renderOriginalImageFallback(node, parent, context, className, label, phrasingOnly);
    if (originalImage) {
      context.imageFallbackNodes += 1;
      return originalImage;
    }
  }

  const backgroundAsset = await materializeComplexBackground(node, context);
  if (!backgroundAsset && shouldMaterializeComplexBackground(node)) {
    // Complex fills were intentionally skipped during image collection: only
    // materialize source bitmaps if the native background really failed.
    await materializeNodeImagePaints(node, context);
  }
  const strokePlan = await prepareGradientStroke(node, context, className);
  const declarations = [
    ...elementBaseDeclarations(tag),
    ...layoutDeclarations(node, parent, context),
    ...visualDeclarations(node, context),
  ];
  declarations.push(...await nativeCssDeclarations(node, context, parent));
  if (strokePlan && !hasDeclaration(declarations, 'position')) declarations.push('position:relative');

  if (node.type === 'TEXT') declarations.push(...textDeclarations(node, context));
  if (node.type === 'ELLIPSE') declarations.push('border-radius:50%');
  context.rules.push(`.${className}{${declarations.join(';')}}`);
  registerResponsiveRules(node, parent, context, className, tag);
  if (tag !== 'div' && tag !== 'span' && tag !== 'p') context.semanticNodes += 1;

  let content = '';
  if (node.type === 'TEXT') {
    content = styledText(
      node,
      context,
      !['a', 'button'].includes(tag) && !interactiveAncestor,
    );
  } else if ('children' in node && Array.isArray(node.children)) {
    const children = [];
    for (const child of orderedChildren(node, resolvedNodeLayout)) {
      children.push(await renderNode(child, node, context, tag, [...ancestorTags, tag]));
    }
    content = children.join('');
  }

  const attributes = [
    `class="${className}"`,
    `data-label="${label}"`,
    `data-figma-id="${escapeAttribute(node.id)}"`,
    `data-kodety-source-node="${escapeAttribute(node.id)}"`,
    ...semanticAttributes(node, tag, context, !parent),
  ];
  if (url) {
    attributes.push(`href="${escapeAttribute(url)}"`);
    if (/^https?:/i.test(url)) attributes.push('target="_blank"', 'rel="noopener noreferrer"');
  } else if (tag === 'button') {
    attributes.push('type="button"');
  } else if (tag === 'a') {
    attributes.push('href="#"');
  }
  return `<${tag} ${attributes.join(' ')}>${content}</${tag}>`;
}

function estimateNodes(roots) {
  let total = 0;
  const stack = [...roots];
  while (stack.length && total <= MAX_NODES) {
    const node = stack.pop();
    total += 1;
    if (node && 'children' in node && Array.isArray(node.children)) stack.push(...node.children);
  }
  return total;
}

function selectionBounds(roots) {
  const boxes = roots.map(nodeBounds);
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return {
    x: Number.isFinite(left) ? left : 0,
    y: Number.isFinite(top) ? top : 0,
    width: Math.max(1, Number.isFinite(right - left) ? right - left : 1),
    height: Math.max(1, Number.isFinite(bottom - top) ? bottom - top : 1),
  };
}

function collectVariableAliases(value, target, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') {
    target.add(value.id);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectVariableAliases(entry, target, depth + 1);
    return;
  }
  for (const entry of Object.values(value)) collectVariableAliases(entry, target, depth + 1);
}

async function collectImageHashes(roots, context) {
  const stack = [...roots];
  let visited = 0;
  while (stack.length) {
    if (cancelled) throw new Error(translate('exportCancelled'));
    const node = stack.pop();
    visited += 1;
    if (isVisible(node)) {
      for (const field of ['boundVariables', 'fills', 'strokes', 'effects']) {
        try {
          const value = node[field];
          if (!mixed(value)) collectVariableAliases(value, context.usedVariableIds);
        } catch {
          // A field unavailable for this node type cannot contain a usable binding.
        }
      }
      if (
        'fills' in node
        && !mixed(node.fills)
        && (!shouldRasterizeImageNode(node) || shouldUseOriginalImageNode(node))
        && !shouldMaterializeComplexBackground(node)
      ) {
        for (const paint of paintList(node.fills)) {
          if (paint.type === 'IMAGE' && paint.imageHash) context.pendingImageHashes.add(paint.imageHash);
        }
      }
      if ('children' in node && Array.isArray(node.children)) stack.push(...node.children);
    }
    if (visited % COLLECT_YIELD_EVERY === 0) {
      post('progress', {
        progress: Math.min(7, 2 + Math.round((visited / Math.max(context.estimatedNodes, visited)) * 5)),
        label: translate('preparingLayers', { count: formatNumber(visited) }),
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

function resolvedVariableValue(variable, modes, variableById, collectionById, seen = new Set()) {
  if (!variable || seen.has(variable.id)) return undefined;
  seen.add(variable.id);
  const collection = collectionById.get(variable.variableCollectionId);
  const modeId = modes[variable.variableCollectionId] || (collection && collection.defaultModeId);
  const raw = variable.valuesByMode && variable.valuesByMode[modeId];
  if (raw && raw.type === 'VARIABLE_ALIAS' && raw.id) {
    return resolvedVariableValue(variableById.get(raw.id), modes, variableById, collectionById, seen);
  }
  if (raw && typeof raw === 'object' && !['r', 'g', 'b'].every(channel => Number.isFinite(raw[channel]))) return undefined;
  return raw;
}

function variableModeEntries(variable, modes, variableById, collectionById) {
  const entries = new Map();
  const seen = new Set();
  let current = variable;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const collection = collectionById.get(current.variableCollectionId);
    const modeId = modes[current.variableCollectionId] || (collection && collection.defaultModeId) || '';
    entries.set(current.variableCollectionId, modeId);
    const raw = current.valuesByMode && current.valuesByMode[modeId];
    if (!raw || raw.type !== 'VARIABLE_ALIAS') break;
    current = variableById.get(raw.id);
    if (!current) {
      // Native resolution can still succeed for a library alias whose
      // definition is unavailable. Include actual node modes to isolate it.
      for (const [id, mode] of Object.entries(modes)) entries.set(id, mode);
    }
  }
  return [...entries.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function variableModeSignature(variable, modes, variableById, collectionById) {
  return JSON.stringify(variableModeEntries(variable, modes, variableById, collectionById));
}

function variableModeName(variable, modes, variableById, collectionById) {
  return variableModeEntries(variable, modes, variableById, collectionById).map(([id, modeId]) => {
    const collection = collectionById.get(id);
    const mode = collection && Array.isArray(collection.modes)
      ? collection.modes.find(entry => entry.modeId === modeId) : null;
    return mode && mode.name || '';
  }).filter(Boolean).join(' / ');
}

async function localVariables(context) {
  if (!figma.variables || !figma.variables.getLocalVariablesAsync) return [];
  try {
    const variables = await figma.variables.getLocalVariablesAsync();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collectionById = new Map(collections.map(collection => [collection.id, collection]));
    const variableById = new Map(variables.map(variable => [variable.id, variable]));
    const included = new Set(context.usedVariableIds);
    const pending = [...included];
    while (pending.length && variableById.size <= MAX_NODES) {
      const id = pending.pop();
      let variable = variableById.get(id);
      if (!variable && typeof figma.variables.getVariableByIdAsync === 'function') {
        try {
          variable = await figma.variables.getVariableByIdAsync(id);
          if (variable) variableById.set(variable.id, variable);
        } catch { /* The paint literal remains authoritative for unavailable libraries. */ }
      }
      if (!variable) continue;
      if (!collectionById.has(variable.variableCollectionId)
        && typeof figma.variables.getVariableCollectionByIdAsync === 'function') {
        try {
          const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
          if (collection) collectionById.set(collection.id, collection);
        } catch { /* Do not assume a missing collection's default mode. */ }
      }
      for (const raw of Object.values(variable.valuesByMode || {})) {
        if (raw && raw.type === 'VARIABLE_ALIAS' && raw.id && !included.has(raw.id)) {
          included.add(raw.id);
          pending.push(raw.id);
        }
      }
    }
    const exported = [...variableById.values()].filter(variable => included.has(variable.id)).map(variable => {
      const collection = collectionById.get(variable.variableCollectionId);
      const modeId = collection && collection.defaultModeId;
      const resolved = resolvedVariableValue(variable, {}, variableById, collectionById);
      const raw = resolved && typeof resolved === 'object' ? color(resolved) : resolved;
      const cssName = variableCssName(variable, collection, context.sourceId);
      const type = variable.resolvedType === 'COLOR'
        ? 'color'
        : variable.resolvedType === 'FLOAT'
          ? 'number'
          : variable.resolvedType === 'BOOLEAN'
            ? 'boolean'
            : 'string';
      return {
        id: variable.id,
        name: variable.name,
        tokenId: cssName.replace(/^--kodety-token-/, ''),
        cssName,
        collectionId: collection ? collection.id : variable.variableCollectionId,
        collectionName: collection ? collection.name : 'Figma variables',
        modeId: modeId || '',
        modeName: collection && Array.isArray(collection.modes)
          ? (collection.modes.find(mode => mode.modeId === modeId) || {}).name || ''
          : '',
        type,
        value: raw == null ? '' : raw,
      };
    }).filter(variable => variable.value !== '');
    context.variableCatalog = variableById;
    context.variableCollections = collectionById;
    context.variableResolutionTokens = new Map();
    context.variableBaseRecords = new Map(exported.map(variable => [variable.id, variable]));
    // renderNode appends actual-mode variants to this same returned array.
    context.exportedVariables = exported;
    return exported;
  } catch {
    context.warnings.push(translate('variablesWarning'));
    return [];
  }
}

async function captureConversionPreview(selection, context) {
  const preview = { width: context.rootBounds.width, height: context.rootBounds.height };
  // The reference is a bounded, UI-only aid, never a replacement for the
  // editable conversion and never part of the clipboard asset package.
  if (selection.length !== 1 || context.estimatedNodes > 5000) return preview;
  const node = selection[0];
  if (!(number(node.width) > 0 && number(node.height) > 0)) return preview;
  let timer;
  try {
    const scale = Math.min(1, 1200 / node.width, 2000 / node.height);
    const capture = node.exportAsync({
      format: 'PNG', constraint: { type: 'SCALE', value: scale },
      contentsOnly: true, useAbsoluteBounds: true,
    });
    // An optional reference cannot indefinitely delay an already-built export.
    // Promise.race also handles a late rejection after the timeout safely.
    const bytes = await Promise.race([capture, new Promise(resolve => {
      timer = setTimeout(() => resolve(null), 4000);
    })]);
    if (bytes && bytes.byteLength > 0 && bytes.byteLength <= 2 * 1024 * 1024) {
      preview.referenceDataUrl = `data:image/png;base64,${bytesToBase64(bytes)}`;
    }
  } catch {
    // A reference failure must never invalidate a complete editable export.
  } finally {
    if (timer != null) clearTimeout(timer);
  }
  return preview;
}

async function focusDiagnosticNode(nodeId) {
  const node = lastDiagnosticNodes.get(String(nodeId || ''));
  if (!node || node.removed || figma.currentPage.id !== lastDiagnosticPageId) return;
  if (figma.viewport && typeof figma.viewport.scrollAndZoomIntoView === 'function') {
    // Preserve the source selection so locating an issue doesn't invalidate
    // the package the user is inspecting or change the next conversion.
    figma.viewport.scrollAndZoomIntoView([node]);
  }
}

async function buildPayload(requestedOptions = {}) {
  cancelled = false;
  const sourcePage = figma.currentPage;
  const selection = sourcePage.selection.filter(isVisible);
  if (!selection.length) throw new Error(translate('selectionRequired'));

  const options = normalizeExportOptions(requestedOptions);
  const exportId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fileKey = currentFigmaFileKey();
  const sourceId = stableSourceId(selection);
  const context = {
    exportId,
    sourceId,
    options,
    selectionCount: selection.length,
    assets: [],
    assetBytes: 0,
    rules: [],
    baseOverrides: [],
    responsiveRules: { notebook: [], tablet: [], mobile: [] },
    fonts: new Map(),
    fontUsage: new Map(),
    hasMissingFont: false,
    warnings: [],
    diagnostics: [],
    diagnosticKeys: new Set(),
    diagnosticNodes: new Map(),
    nodeCount: 0,
    inferredAutoLayoutNodes: 0,
    geometryInferredAutoLayoutNodes: 0,
    geometryInferredLayoutIds: new Set(),
    geometryLayoutCache: new Map(),
    absoluteRootNames: [],
    responsiveRootClass: '',
    semanticNodes: 0,
    rasterizedNodes: 0,
    vectorFallbackNodes: 0,
    imageFallbackNodes: 0,
    restNodesById: new Map(),
    restSnapshotRoots: 0,
    variableCssNames: new Map(),
    richTextSegments: 0,
    richTextLimitWarned: false,
    estimatedNodes: estimateNodes(selection),
    rootBounds: selectionBounds(selection),
    pendingImageHashes: new Set(),
    imageHashes: new Map(),
    failedImageHashes: new Set(),
    usedVariableIds: new Set(),
  };
  if (context.estimatedNodes > MAX_NODES) throw new Error(translate('nodeLimit'));

  post('progress', { progress: 2, label: translate('restV1') });
  const scene = await captureRestV1Scene(selection, context);
  // Collect image hashes before rendering so every CSS reference is stable.
  await collectImageHashes(selection, context);
  post('progress', { progress: 5, label: translate('preparingImagesVariables') });
  await materializeImageHashes(context);
  const variables = await localVariables(context);
  context.variableCssNames = new Map(variables.map(variable => [variable.id, variable.cssName]));

  const roots = [];
  for (const node of selection) roots.push(await renderNode(node, null, context));
  const wrapperClass = `kf-${sourceId}-${safe(exportId, 'export')}-selection`;
  const wrapperDeclarations = [
    'box-sizing:border-box',
    'position:relative',
    'isolation:isolate',
    `width:${context.responsiveRootClass ? '100%' : px(context.rootBounds.width)}`,
    `height:${context.responsiveRootClass ? 'auto' : px(context.rootBounds.height)}`,
    'font-family:Arial,Helvetica,sans-serif',
  ];
  const html = `<div class="${wrapperClass}" data-kodety-figma-export="${exportId}" data-kodety-figma-source="${sourceId}" data-label="${escapeAttribute(translate('figmaSelection'))}">${roots.join('')}</div>`;
  const mediaRules = [
    context.responsiveRules.notebook.length
      ? `@media (max-width:${context.responsiveNotebookMaxWidth || 1200}px){${context.responsiveRules.notebook.join('')}}`
      : '',
    context.responsiveRules.tablet.length
      ? `@media (max-width:810px){${context.responsiveRules.tablet.join('')}}`
      : '',
    context.responsiveRules.mobile.length
      ? `@media (max-width:410px){${context.responsiveRules.mobile.join('')}}`
      : '',
  ];
  const css = [
    `.${wrapperClass}{${wrapperDeclarations.join(';')}}`,
    ...context.rules,
    ...context.baseOverrides,
    ...mediaRules,
  ].filter(Boolean).join('\n');

  if (context.hasMissingFont) {
    context.warnings.push(translate('missingFontsWarning'));
  }
  if (options.responsiveMode !== 'pixel') {
    for (const name of context.absoluteRootNames) {
      context.warnings.push(translate('responsiveFallbackWarning', { name }));
    }
  }

  const bytes = context.assets.reduce((sum, asset) => {
    if (asset.dataBase64) return sum + Math.floor(asset.dataBase64.length * 0.75);
    return sum + utf8ByteLength(asset.text || '');
  }, utf8ByteLength(html + css + (scene ? JSON.stringify(scene) : '')));
  post('progress', { progress: 97, label: translate('diagnosticReference') });
  const preview = await captureConversionPreview(selection, context);
  if (cancelled) throw new Error(translate('exportCancelled'));
  lastDiagnosticNodes = context.diagnosticNodes;
  lastDiagnosticPageId = sourcePage.id;
  return {
    signature: SIGNATURE,
    version: VERSION,
    source: 'figma-plugin',
    engine: { version: ENGINE_VERSION, sceneFormat: 'JSON_REST_V1' },
    exportId,
    sourceId,
    provenance: {
      ...(fileKey ? { fileKey } : {}),
      pageId: sourcePage.id,
      nodeIds: selection.map(node => node.id),
      sourceBounds: { ...context.rootBounds },
    },
    exportedAt: new Date().toISOString(),
    documentName: figma.root.name || translate('figmaDocument'),
    pageName: sourcePage.name || translate('page'),
    html,
    css,
    scene,
    options,
    preview,
    diagnostics: context.diagnostics.sort((left, right) => Number(right.severity === 'warning') - Number(left.severity === 'warning')),
    assets: context.assets,
    fonts: [...context.fonts.values()],
    fontUsage: [...context.fontUsage.values()],
    hasMissingFont: context.hasMissingFont,
    variables,
    stats: {
      nodes: context.nodeCount,
      assets: context.assets.length,
      bytes,
      richTextSegments: context.richTextSegments,
      inferredAutoLayoutNodes: context.inferredAutoLayoutNodes,
      geometryInferredAutoLayoutNodes: context.geometryInferredAutoLayoutNodes,
      missingFonts: [...context.fontUsage.values()].filter(font => font.missing).length,
      semanticNodes: context.semanticNodes,
      rasterizedNodes: context.rasterizedNodes,
      backgroundRasterizedNodes: number(context.backgroundRasterizedNodes),
      vectorFallbackNodes: context.vectorFallbackNodes,
      imageFallbackNodes: context.imageFallbackNodes,
      responsiveRules: Object.values(context.responsiveRules).reduce((sum, rules) => sum + rules.length, 0),
      restSnapshotRoots: context.restSnapshotRoots,
      restSnapshotNodes: context.restNodesById.size,
    },
    warnings: context.warnings,
  };
}

async function runExport(requestedSelectionKey = '', requestedOptions = {}) {
  const selectionKey = currentSelectionKey();
  if (requestedSelectionKey && requestedSelectionKey !== selectionKey) return;
  if (exportInFlight) {
    queuedExportSelectionKey = selectionKey;
    queuedExportOptions = requestedOptions;
    return;
  }
  exportInFlight = true;
  activeExportSelectionKey = selectionKey;
  try {
    post('progress', { progress: 1, label: translate('analyzingSelection') });
    const payload = await buildPayload(requestedOptions);
    const completedSelectionKey = currentSelectionKey();
    if (selectionKey !== completedSelectionKey) {
      queuedExportSelectionKey = completedSelectionKey;
      queuedExportOptions = requestedOptions;
      return;
    }
    post('payload', { payload });
  } catch (error) {
    post('error', { message: error instanceof Error ? error.message : String(error) });
  } finally {
    exportInFlight = false;
    activeExportSelectionKey = '';
    const queued = queuedExportSelectionKey;
    const queuedOptions = queuedExportOptions;
    queuedExportSelectionKey = '';
    queuedExportOptions = null;
    if (queued && queued === currentSelectionKey()) void runExport(queued, queuedOptions || {});
  }
}

figma.ui.onmessage = message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'locale') {
    activeLocale = normalizeLocale(message.locale);
    post('i18n', {
      locale: activeLocale,
      messages: I18N[activeLocale],
      ...selectionSummary(),
      restFormat: 'JSON_REST_V1',
    });
    if (commandExportPending) {
      commandExportPending = false;
      void runExport();
    }
  }
  if (message.type === 'export') {
    void runExport(String(message.selectionKey || ''), message.options || {});
  }
  if (message.type === 'focus-node') {
    void focusDiagnosticNode(message.nodeId).catch(() => {});
  }
  if (message.type === 'apply-semantic') {
    try {
      const count = applySemanticTag(message.tag);
      post('semantic-result', {
        ok: true,
        message: translate('semanticApplied', { count: formatNumber(count) }),
        ...selectionSummary(),
      });
    } catch (error) {
      post('semantic-result', {
        ok: false,
        message: error instanceof Error ? error.message : translate('semanticApplyFailed'),
        ...selectionSummary(),
      });
    }
  }
  if (message.type === 'cancel') cancelled = true;
  if (message.type === 'close') {
    cancelled = true;
    cleanupTransientPaintNodes();
    figma.closePlugin();
  }
  if (message.type === 'notify') figma.notify(message.message || translate('copied'));
};

function handleCurrentPageNodeChange(event) {
  if (event && Array.isArray(event.nodeChanges)
    && event.nodeChanges.every(change => ignoredTransientNodeIds.has(change.id || (change.node && change.node.id)))) return;
  documentRevision += 1;
  post('selection', selectionSummary());
}

function observeCurrentPage() {
  const nextPage = figma.currentPage;
  if (observedPage === nextPage) return;
  if (observedPage && typeof observedPage.off === 'function') {
    try { observedPage.off('nodechange', handleCurrentPageNodeChange); } catch { /* page was unloaded */ }
  }
  observedPage = nextPage;
  if (observedPage && typeof observedPage.on === 'function') {
    try { observedPage.on('nodechange', handleCurrentPageNodeChange); } catch { /* unsupported old runtime */ }
  }
}

if (figma.on) {
  try {
    // Closing the native plugin window can terminate pending async exports
    // before their finally blocks. Clean only our temporary paint nodes now.
    figma.on('close', cleanupTransientPaintNodes);
  } catch { /* Older runtimes still clean up through the UI close handler. */ }
  figma.on('selectionchange', () => {
    post('selection', selectionSummary());
  });
  observeCurrentPage();
  try {
    figma.on('currentpagechange', () => {
      documentRevision += 1;
      observeCurrentPage();
      post('selection', selectionSummary());
    });
  } catch {
    // Older Figma desktop builds may not expose currentpagechange.
  }
}

post('i18n', {
  locale: activeLocale,
  messages: I18N[activeLocale],
  ...selectionSummary(),
  restFormat: 'JSON_REST_V1',
});
if (commandExportPending) {
  setTimeout(() => {
    if (!commandExportPending) return;
    commandExportPending = false;
    void runExport();
  }, 250);
} else post('ready', {
  ...selectionSummary(),
  restFormat: 'JSON_REST_V1',
});
