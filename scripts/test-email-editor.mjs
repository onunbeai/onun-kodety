import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const lint = await server.ssrLoadModule('/lib/email-editor/lint.ts');
  const sanitize = await server.ssrLoadModule('/lib/email-editor/sanitize.ts');
  const storage = await server.ssrLoadModule('/lib/email-editor/storage.ts');
  const render = await server.ssrLoadModule('/lib/email-editor/render.ts');
  const blocks = await server.ssrLoadModule('/lib/email-editor/blocks.ts');
  const presets = await server.ssrLoadModule('/lib/email-editor/presets.ts');
  const types = await server.ssrLoadModule('/lib/email-editor/types.ts');

  const valid = types.createEmptyDocument();
  valid.blocks = [blocks.createFooterBlock()];
  assert.equal(
    lint.hasBlockingIssue(lint.lintDocument(valid)),
    false,
    'um rodapé visível com href de unsubscribe deve liberar o documento',
  );

  const tokenOnly = types.createEmptyDocument();
  const tokenText = blocks.createBlock('text');
  tokenText.html = '<p>{{unsubscribe_url}}</p>';
  tokenOnly.blocks = [tokenText];
  assert.ok(
    lint.lintDocument(tokenOnly).some((issue) => issue.code === 'missing_unsubscribe'),
    'token solto, sem link acionável, não atende o descadastro',
  );

  const hiddenUnsubscribeCases = [
    ['display none no link', '<a style="display:none" href="{{unsubscribe_url}}">Cancelar</a>'],
    ['visibility hidden no link', '<a style="visibility: hidden !important" href="{{unsubscribe_url}}">Cancelar</a>'],
    ['atributo hidden no link', '<a hidden href="{{unsubscribe_url}}">Cancelar</a>'],
    ['hidden=false continua booleano', '<a hidden="false" href="{{unsubscribe_url}}">Cancelar</a>'],
    ['aria-hidden no link', '<a aria-hidden="TRUE" href="{{unsubscribe_url}}">Cancelar</a>'],
    ['ancestral display none', '<table style="display&#58;none"><tr><td><a href="{{unsubscribe_url}}">Cancelar</a></td></tr></table>'],
    ['ancestral visibility hidden', '<div style="visibility:hidden"><a href="{{unsubscribe_url}}">Cancelar</a></div>'],
    ['ancestral hidden', '<section hidden><div><a href="{{unsubscribe_url}}">Cancelar</a></div></section>'],
    ['ancestral aria-hidden', '<div aria-hidden="true"><span><a href="{{unsubscribe_url}}">Cancelar</a></span></div>'],
    ['conteúdo inteiro oculto', '<a href="{{unsubscribe_url}}"><span hidden>Cancelar</span></a>'],
    ['ancestral transparente', '<div style="opacity:0"><a href="{{unsubscribe_url}}">Cancelar</a></div>'],
    ['ancestral não acionável', '<div style="pointer-events:none"><a href="{{unsubscribe_url}}">Cancelar</a></div>'],
    ['link aria-disabled', '<a aria-disabled="true" href="{{unsubscribe_url}}">Cancelar</a>'],
  ];

  for (const [description, markup] of hiddenUnsubscribeCases) {
    assert.equal(
      lint.hasFunctionalUnsubscribe(markup),
      false,
      `${description} não pode atender o descadastro`,
    );

    const hiddenDocument = types.createEmptyDocument();
    const hiddenBlock = blocks.createBlock('html');
    hiddenBlock.code = markup;
    hiddenDocument.blocks = [hiddenBlock];
    assert.ok(
      lint.lintDocument(hiddenDocument).some((issue) => issue.code === 'missing_unsubscribe'),
      `${description} precisa gerar missing_unsubscribe no documento`,
    );
  }

  const visibleNestedUnsubscribe =
    '<div class="hidden" data-note="hidden" aria-hidden="false"><a href="{{unsubscribe_url}}"><span hidden>Oculto</span><span>Cancelar inscrição</span></a></div>';
  assert.equal(
    lint.hasFunctionalUnsubscribe(visibleNestedUnsubscribe),
    true,
    'atributos com a palavra hidden e descendente oculto não escondem o texto irmão visível',
  );
  assert.equal(
    lint.hasFunctionalUnsubscribe(
      '<a href="{{unsubscribe_url}}"><img src="https://example.test/unsubscribe.png" alt="Cancelar inscrição"></a>',
    ),
    true,
    'imagem visível e descritiva torna o link acionável',
  );
  assert.equal(
    lint.hasFunctionalUnsubscribe(
      '<a href="{{unsubscribe_url}}"><img hidden src="https://example.test/unsubscribe.png" alt="Cancelar inscrição"></a>',
    ),
    false,
    'imagem oculta não torna um link vazio acionável',
  );

  const active = types.createEmptyDocument();
  const activeHtml = blocks.createBlock('html');
  activeHtml.code =
    '<script>alert(1)</script><a href="jav&#x61;script:alert(1)" onclick="run()">Abrir</a>';
  active.blocks = [activeHtml, blocks.createFooterBlock()];
  const activeIssues = lint.lintDocument(active);
  assert.ok(activeIssues.some((issue) => issue.code === 'active_html'));
  assert.ok(activeIssues.some((issue) => issue.code === 'event_handler'));
  assert.ok(activeIssues.some((issue) => issue.code === 'unsafe_url'));

  const imageDocument = types.createEmptyDocument();
  const image = blocks.createBlock('image');
  image.src = 'https://example.test/image.jpg';
  image.alt = 'Descreva a imagem';
  imageDocument.blocks = [image, blocks.createFooterBlock()];
  assert.ok(
    lint.lintDocument(imageDocument).some((issue) => issue.code === 'image_missing_alt'),
    'texto alternativo provisório deve bloquear a prontidão',
  );

  const unsupportedMergeDocument = types.createEmptyDocument();
  const unsupportedMergeButton = blocks.createBlock('button');
  unsupportedMergeButton.href = '{{contact.first_name}}';
  unsupportedMergeDocument.blocks = [unsupportedMergeButton, blocks.createFooterBlock()];
  assert.ok(
    lint.lintDocument(unsupportedMergeDocument).some((issue) => issue.code === 'button_invalid_link'),
    'href deve aceitar somente as merge tags de URL resolvidas pelo renderer PHP',
  );

  for (const href of ['{{unsubscribe_url}}', '{{view_in_browser_url}}', '{{site.url}}']) {
    const allowedMergeDocument = types.createEmptyDocument();
    const allowedMergeButton = blocks.createBlock('button');
    allowedMergeButton.href = href;
    allowedMergeDocument.blocks = [allowedMergeButton, blocks.createFooterBlock()];
    assert.ok(
      !lint.lintDocument(allowedMergeDocument).some((issue) => issue.code === 'button_invalid_link'),
      `${href} deve continuar aceita como href`,
    );
  }

  const unsafePreview =
    '<div onclick="steal()"><script>steal()</script><a href="javascript:steal()">Abrir</a><p>Seguro</p></div>';
  const sanitized = sanitize.sanitizeEmailHtmlForPreview(unsafePreview);
  assert.doesNotMatch(sanitized, /<script|onclick|javascript:/i);
  assert.match(sanitized, /Seguro/);
  const canvasSafe = sanitize.sanitizeEmailHtmlForCanvas(
    '<style>body{display:none}</style><div style="position:fixed;inset:0;z-index:99999">Conteúdo</div>',
  );
  assert.doesNotMatch(canvasSafe, /<style|position\s*:\s*fixed|z-index/i);
  assert.match(canvasSafe, /Conteúdo/);

  const storedButton = blocks.createBlock('button');
  storedButton.href = '';
  storedButton.label = '';
  const normalized = storage.parseDocument(
    JSON.stringify({ ...types.createEmptyDocument(), blocks: [storedButton] }),
  );
  assert.equal(normalized.blocks[0].href, '', 'href vazio não pode voltar ao link de exemplo');
  assert.equal(normalized.blocks[0].label, '', 'texto vazio não pode voltar ao CTA de exemplo');

  const legacyDocument = storage.importLegacyEmailDocument(
    '<!doctype html><html><head><style>.hero{color:red}</style><style>@import "https://evil.test/x.css";</style><script>bad()</script></head><body><table class="hero"><tr><td>Legado</td></tr></table></body></html>',
  );
  assert.equal(legacyDocument.blocks[0].type, 'html');
  assert.doesNotMatch(legacyDocument.blocks[0].code, /<!doctype|<html|<head|<body|<script|@import/i);
  assert.match(legacyDocument.blocks[0].code, /<style>\.hero\{color:red\}<\/style>/);
  assert.match(legacyDocument.blocks[0].code, /<table class="hero">/);
  assert.deepEqual(legacyDocument.blocks[0].box.padding, {
    top: '0px',
    right: '0px',
    bottom: '0px',
    left: '0px',
  });

  const textDocument = types.createEmptyDocument();
  const linkedText = blocks.createBlock('text');
  linkedText.html = '<p>Leia <a href=\'https://example.test/post\'>a matéria</a> agora.</p>';
  textDocument.blocks = [linkedText];
  const text = render.renderEmailText(textDocument);
  assert.match(text, /a matéria \(https:\/\/example\.test\/post\)/);

  const localValues = new Map();
  let generatedDraft = 0;
  const makeWindow = () => {
    const fakeWindow = {
      location: { href: 'https://example.test/kodety/email-editor/' },
      history: {
        replaceState(_state, _title, href) {
          fakeWindow.location.href = String(href);
        },
      },
      crypto: {
        randomUUID() {
          generatedDraft += 1;
          return `00000000-0000-4000-8000-${String(generatedDraft).padStart(12, '0')}`;
        },
      },
      localStorage: {
        getItem(key) {
          return localValues.get(key) ?? null;
        },
        setItem(key, value) {
          localValues.set(key, value);
        },
        removeItem(key) {
          localValues.delete(key);
        },
      },
    };
    return fakeWindow;
  };
  const config = {
    templatesUrl: 'https://example.test/wp-json/kodety/v1/email/templates',
    templateUrl: '',
    mediaUrl: '',
    campaignsUrl: '',
    nonce: '',
    templateId: 0,
    canManage: true,
  };

  globalThis.window = makeWindow();
  const firstDraftScope = storage.ensureEmailEditorDraftScope(0);
  storage.writeEmailEditorDraft(config, {
    templateId: 0,
    name: 'Primeira aba',
    document: types.createEmptyDocument(),
  }, firstDraftScope);

  globalThis.window = makeWindow();
  const secondDraftScope = storage.ensureEmailEditorDraftScope(0);
  storage.writeEmailEditorDraft(config, {
    templateId: 0,
    name: 'Segunda aba',
    document: types.createEmptyDocument(),
  }, secondDraftScope);

  assert.notEqual(firstDraftScope, secondDraftScope);
  assert.equal(storage.readEmailEditorDraft(config, 0, firstDraftScope).name, 'Primeira aba');
  assert.equal(storage.readEmailEditorDraft(config, 0, secondDraftScope).name, 'Segunda aba');
  storage.clearEmailEditorDraft(config, 0, firstDraftScope);
  assert.equal(storage.readEmailEditorDraft(config, 0, secondDraftScope).name, 'Segunda aba');
  delete globalThis.window;

  const editorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/email-editor/components/KodetyEmailEditor.tsx'),
    'utf8',
  );
  const librarySource = await readFile(
    path.join(root, 'app/(builder)/kodety/email-editor/components/EmailSectionLibrary.tsx'),
    'utf8',
  );
  const canvasSource = await readFile(
    path.join(root, 'app/(builder)/kodety/email-editor/components/EmailCanvas.tsx'),
    'utf8',
  );
  const canvasCss = await readFile(
    path.join(root, 'Wordpress/email-editor/email-editor.css'),
    'utf8',
  );
  const inspectorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/email-editor/components/EmailInspector.tsx'),
    'utf8',
  );
  const spacingSource = await readFile(
    path.join(root, 'app/(builder)/kodety/components/MarginPadding.tsx'),
    'utf8',
  );
  assert.doesNotMatch(
    editorSource,
    /Ocultar (?:conteúdo|propriedades)/,
    'os controles dos painéis não devem voltar para a barra superior',
  );
  assert.match(
    librarySource,
    /aria-label="Recolher painel de conteúdo"/,
    'o painel de conteúdo precisa oferecer recolhimento no próprio cabeçalho',
  );
  assert.match(
    editorSource,
    /aria-label="Recolher painel de propriedades"/,
    'o painel de propriedades precisa oferecer recolhimento no próprio cabeçalho',
  );
  assert.match(
    editorSource,
    /xl:grid-cols-\[40px_minmax\(0,1fr\)_40px\]/,
    'painéis recolhidos devem continuar como trilhos laterais acessíveis no desktop',
  );
  assert.match(
    editorSource,
    /xl:left-1\/2[\s\S]*xl:-translate-x-1\/2/,
    'os controles principais devem permanecer centralizados pelo eixo real do editor',
  );
  assert.match(
    editorSource,
    /label: 'Desktop', icon: 'desktop', iconOnly: true/,
    'a visualização desktop deve usar um controle compacto com ícone',
  );
  assert.match(
    editorSource,
    /label: 'Mobile', icon: 'mobile', iconOnly: true/,
    'a visualização mobile deve usar um controle compacto com ícone',
  );
  assert.match(
    editorSource,
    /width:\s*32,[\s\S]*height:\s*32,[\s\S]*borderRadius:\s*6/,
    'controles de dispositivo devem ser quadrados e levemente arredondados',
  );
  assert.doesNotMatch(
    editorSource,
    />\s*Construtor de email\s*</,
    'o cabeçalho não deve repetir um título decorativo acima do nome do template',
  );
  assert.doesNotMatch(
    canvasSource,
    /\+\s*Texto/,
    'colunas não devem oferecer apenas um atalho fixo de texto',
  );
  assert.match(
    canvasSource,
    /EMAIL_LEAF_TYPES\.map/,
    'o menu da coluna deve expor todos os tipos de bloco compatíveis',
  );
  assert.match(
    canvasCss,
    /\.kem-canvas__frame--mobile \.kem-columns[\s\S]*flex-direction:\s*column/,
    'o canvas mobile deve empilhar colunas como o HTML exportado',
  );
  assert.ok(
    (inspectorSource.match(/onBatchChange=/g) ?? []).length >= 2,
    'Option e Shift precisam aplicar os lados do bloco e do documento em uma única transação',
  );
  assert.match(
    spacingSource,
    /valuesRef\.current\s*=\s*\{\s*\.\.\.valuesRef\.current,\s*\.\.\.changes\s*\}/,
    'arrastes rápidos com modificador devem atualizar o snapshot local de todos os lados',
  );

  const presetIds = presets.EMAIL_SECTION_PRESETS.map((preset) => preset.id);
  assert.equal(
    new Set(presetIds).size,
    presetIds.length,
    'presets de seção precisam ter IDs únicos',
  );

  for (const preset of presets.EMAIL_SECTION_PRESETS) {
    const built = preset.build();
    assert.ok(built.length > 0, `${preset.id} precisa inserir conteúdo`);

    const seenIds = new Set();
    const inspect = (block) => {
      assert.ok(!seenIds.has(block.id), `${preset.id} não pode repetir IDs de bloco`);
      seenIds.add(block.id);

      if (block.type !== 'columns') return;
      assert.ok(block.columns.length > 0, `${preset.id} não pode criar colunas vazias`);
      assert.ok(
        block.widths.length === 0 || block.widths.length === block.columns.length,
        `${preset.id} precisa manter pesos e quantidade de colunas consistentes`,
      );
      assert.ok(
        block.widths.every((weight) => Number.isFinite(weight) && weight > 0),
        `${preset.id} não pode criar peso de coluna inválido`,
      );
      for (const column of block.columns) {
        assert.ok(column.length > 0, `${preset.id} não pode criar uma célula sem conteúdo`);
        column.forEach(inspect);
      }
    };
    built.forEach(inspect);

    const presetDocument = types.createEmptyDocument();
    presetDocument.blocks = built;
    const presetHtml = render.renderEmailHtml(presetDocument, preset.label);
    assert.doesNotMatch(
      presetHtml,
      /(?:NaN|undefined|style="[^"]*(?:;;|:\s*;))/,
      `${preset.id} precisa gerar HTML sem valores de layout inválidos`,
    );
  }
} finally {
  await server.close();
}

console.log('Contratos do construtor de email aprovados.');
