import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, 'Wordpress/kodety/languages/admin-ui');
const readJson = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const [aliases, english, portuguese, schema, runtime, server, plugin, editorShell, emailShell, adminUiLocaleSource, globalStyles] = await Promise.all([
  readJson('aliases.json'),
  readJson('en.json'),
  readJson('pt-BR.json'),
  readJson('catalog.schema.json'),
  readFile(path.join(root, 'Wordpress/kodety/admin/i18n.js'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-admin-i18n.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/templates/editor-shell.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/templates/email-editor-shell.php'), 'utf8'),
  readFile(path.join(root, 'lib/admin-ui-locale.ts'), 'utf8'),
  readFile(path.join(root, 'app/globals.css'), 'utf8'),
]);
const adminFormattingSources = await Promise.all([
  'Wordpress/kodety/admin/email-marketing.js',
  'Wordpress/kodety/admin/media-library.js',
  'Wordpress/kodety/admin/components/dashboard.js',
  'Wordpress/kodety/admin/kodety-page.js',
].map(file => readFile(path.join(root, file), 'utf8')));
const cmsManagerSource = await readFile(
  path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCmsManager.tsx'),
  'utf8',
);
const printfTokens = value => [...String(value)
  .replaceAll('%%', '')
  .replace(/\{[A-Za-z][A-Za-z0-9_]*\}%/g, '')
  .matchAll(
  /%(?!%)(?:\d+\$)?[-+0#']*(?:\d+|\*)?(?:\.(?:\d+|\*))?[bcdeEfFgGosuxX]/g,
)].map(match => match[0]).sort();
const onboardingSource = await readFile(
  path.join(root, 'Wordpress/kodety/admin/onboarding.js'),
  'utf8',
);

assert.equal(english.locale, 'en');
assert.equal(portuguese.locale, 'pt-BR');
assert.deepEqual(Object.keys(english.messages).sort(), Object.keys(portuguese.messages).sort());
for (const [key, sources] of Object.entries(aliases)) {
  assert.ok(english.messages[key], `missing English message: ${key}`);
  assert.ok(portuguese.messages[key], `missing Portuguese message: ${key}`);
  assert.ok(Array.isArray(sources) && sources.length > 0, `alias ${key} needs a source phrase`);
}
for (const catalog of [english, portuguese]) {
  assert.ok(Object.values(catalog.messages).every(value => typeof value === 'string'));
  assert.ok(Object.values(catalog.direct).every(value => typeof value === 'string'));
  assert.equal(catalog.glossary, undefined, `${catalog.locale} must not ship fragment translations`);
  assert.equal(catalog.legacy, undefined, `${catalog.locale} must not ship the obsolete phrase inventory`);
  for (const [source, target] of Object.entries(catalog.direct)) {
    const sourcePlaceholders = [...source.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
    const targetPlaceholders = [...target.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(targetPlaceholders, sourcePlaceholders, `${catalog.locale} placeholder mismatch: ${source}`);
    assert.deepEqual(
      printfTokens(target),
      printfTokens(source),
      `${catalog.locale} printf placeholder mismatch: ${source}`,
    );
  }
}

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compileCatalog = catalog => {
  const exact = new Map();
  const patterns = [];
  let patternOrder = 0;
  const register = (sources, target) => {
    for (const source of Array.isArray(sources) ? sources : [sources]) {
      const names = [];
      const normalized = normalize(source);
      let expression = '';
      let cursor = 0;
      let match;
      const marker = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
      while ((match = marker.exec(normalized))) {
        expression += escapeRegex(normalized.slice(cursor, match.index)) + '(.+?)';
        names.push(match[1]);
        cursor = match.index + match[0].length;
      }
      if (!names.length) {
        exact.set(normalized, target);
        continue;
      }
      expression += escapeRegex(normalized.slice(cursor));
      patterns.push({
        regex: new RegExp(`^${expression}$`, 'u'),
        names,
        target,
        specificity: normalized.replace(marker, '').length,
        order: patternOrder++,
      });
    }
  };
  for (const [key, sources] of Object.entries(aliases)) register(sources, catalog.messages[key]);
  for (const [source, target] of Object.entries(catalog.direct)) register(source, target);
  patterns.sort((left, right) => (
    right.specificity - left.specificity
    || right.order - left.order
  ));
  return value => {
    const source = normalize(value);
    if (exact.has(source)) return exact.get(source);
    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (!match) continue;
      const replacements = Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]));
      return pattern.target.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (marker, name) => (
        Object.hasOwn(replacements, name) ? replacements[name] : marker
      ));
    }
    return value;
  };
};
for (const catalog of [english, portuguese]) {
  const translate = compileCatalog(catalog);
  for (const [source, target] of Object.entries(catalog.direct)) {
    const placeholderValues = new Map();
    const renderPlaceholders = value => value.replace(
      /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
      (_marker, name) => {
        if (!placeholderValues.has(name)) {
          placeholderValues.set(name, `KODETY_SENTINEL_${placeholderValues.size}_${name}`);
        }
        return placeholderValues.get(name);
      },
    );
    const renderedSource = renderPlaceholders(source);
    const expectedTarget = renderPlaceholders(target);
    assert.equal(
      normalize(translate(renderedSource)),
      normalize(expectedTarget),
      `${catalog.locale} direct copy was shadowed by another pattern: ${source}`,
    );
    const renderedTarget = target.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, 'KODETYVALUE');
    assert.equal(
      normalize(translate(renderedTarget)),
      normalize(renderedTarget),
      `${catalog.locale} translation must be idempotent: ${source}`,
    );
  }
}
const translateEnglish = compileCatalog(english);
assert.equal(english.messages['onboarding.step_counter'], '{current} of {total}');
assert.equal(portuguese.messages['onboarding.step_counter'], '{current} de {total}');
assert.equal(
  english.direct['{value0} de {value1}'],
  undefined,
  'a generic "x de y" DOM pattern can corrupt user data such as project names',
);
assert.match(onboardingSource, /counter\.textContent = message\('counter', \{ current, total: steps\.length \}\)/);
assert.match(plugin, /'messages' => array_map\(\$t, \$messages\)/,
  'o onboarding isolado deve receber mensagens já traduzidas pelo servidor');
assert.equal(english.direct['Etapa {current} de {total}'], 'Step {current} of {total}');
assert.equal(portuguese.direct['Etapa {current} de {total}'], 'Etapa {current} de {total}');
assert.doesNotMatch(onboardingSource, /\$\{current\} de \$\{steps\.length\}/);

const messageRuntimeWindow = {
  kodetyAdminI18n: {
    locale: 'en',
    messages: english.messages,
    aliases: {},
    direct: {},
    attributes: [],
  },
};
vm.runInNewContext(runtime, {
  window: messageRuntimeWindow,
  document: { readyState: 'loading', addEventListener() {} },
});
assert.equal(
  messageRuntimeWindow.kodetyFormatMessage('onboarding.step_counter', { current: 2, total: 4 }),
  '2 of 4',
  'stable message keys must format dynamic copy without a global DOM pattern',
);
assert.equal(
  messageRuntimeWindow.kodetyFormatMessage('onboarding.step_counter', { current: '$&', total: 4 }),
  '$& of 4',
  'replacement values must be preserved literally',
);
assert.equal(
  messageRuntimeWindow.kodetyFormatMessage('onboarding.step_counter', { current: '{total}', total: '$&' }),
  '{total} of $&',
  'placeholder-looking user values must never expand recursively',
);
assert.equal(typeof messageRuntimeWindow.kodetyTranslate, 'function', 'translation must be available before DOMContentLoaded');

const translatePortuguese = compileCatalog(portuguese);
// Literal mode labels have a fixed space next to the numeric input. A
// one-word translation can still overflow it (Auto -> Automático).
for (const [source, maximum] of [['Auto', 4], ['Rel', 3], ['Fixed', 5], ['Normal', 6], ['Wrap', 6], ['None', 6], ['Default', 7]]) {
  for (const translate of [translateEnglish, translatePortuguese]) {
    const label = translate(source);
    assert.ok(label.length <= maximum, `compact control label exceeds its character budget: ${source} -> ${label}`);
    assert.equal(translate(label), label, `compact control label must stay stable: ${source}`);
  }
}
const reviewedCompactLabels = JSON.parse(await readFile(path.join(root, 'scripts/fixtures/admin-i18n-compact-labels.json'), 'utf8'));
// These nouns require a preposition or a two-word expression in natural PT.
// Keep meaning (and product names) rather than inventing misleading shorthand.
const compactExtraWordExceptions = new Set([
  'Project area', 'Untitled', 'Checkout Overlay', 'Code Block', 'Background Video',
  'Submitting label', 'Hover speed', 'Hover transition', 'Preparing Agent components',
  'Change image loading', 'Settings section', 'Access token', 'Session endpoint',
  'Preview item', 'Access plans', 'Members Area', 'Upgrade URL',
  'Use for upgrade', 'Per-project connections', 'Copy installation prompt',
]);
const labelWordCount = value => value.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
for (const [en, pt] of Object.entries(reviewedCompactLabels)) {
  assert.equal(translatePortuguese(en), pt, `reviewed compact label drifted: ${en}`);
  assert.equal(translatePortuguese(pt), pt, `compact label must be idempotent: ${en}`);
  if (!compactExtraWordExceptions.has(en)) {
    assert.ok(labelWordCount(pt) <= labelWordCount(en), `compact label adds words: ${en}`);
  }
}
const compactSourceLabels = JSON.parse(await readFile(path.join(root, 'scripts/fixtures/admin-i18n-compact-sources.json'), 'utf8'));
for (const { source, en, pt } of compactSourceLabels) {
  assert.equal(translateEnglish(source), en, `original UI source must translate to EN: ${source}`);
  assert.equal(translatePortuguese(source), pt, `original UI source must use compact PT: ${source}`);
  assert.equal(translatePortuguese(pt), pt, `compact source must remain stable: ${source}`);
}
const compactLabels = [
  ['Loading languages', 'Carregando idiomas'],
  ['Close notice', 'Fechar aviso'],
  ['Create variable', 'Criar variável'],
  ['Remove category', 'Remover categoria'],
  ['No page rules', 'Sem regras locais'],
  ['Create CMS item', 'Criar item CMS'],
  ['Pending invite', 'Convite pendente'],
];
for (const [en, pt] of compactLabels) {
  assert.equal(translateEnglish(en), en);
  assert.equal(translatePortuguese(en), pt);
  assert.equal(translateEnglish(pt), en);
  assert.equal(translatePortuguese(pt), pt);
  assert.ok(pt.split(/\s+/).length <= en.split(/\s+/).length, `compact label adds words: ${en}`);
  assert.ok(pt.length <= Math.ceil(en.length * 1.25), `compact label exceeds visual length budget: ${en}`);
}
assert.equal(translateEnglish('Conflito de revisão: a localização mudou para rev-3. Leia o catálogo novamente.'), 'Revision conflict: localization changed to rev-3. Read the catalog again.');
assert.equal(translatePortuguese('Revision conflict: localization changed to rev-3. Read the catalog again.'), 'Conflito de revisão: a localização mudou para rev-3. Leia o catálogo novamente.');
assert.equal(translatePortuguese('arguments.fields[0].name is required.'), 'arguments.fields[0].name é obrigatório.');
assert.equal(translateEnglish('O texto “{value1}” mudou ou não existe mais em $&.'), 'Text “{value1}” changed or no longer exists in $&.');

class LoginRuntimeElement {
  constructor() {
    this.dataset = {};
    this.lang = '';
    this.dir = '';
    this.tagName = 'HTML';
    this.childNodes = [];
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  getRootNode() { return null; }
  hasAttribute() { return false; }
}
class LoginRuntimeInput extends LoginRuntimeElement {}
class LoginRuntimeDocument {
  constructor(documentElement, loginShell = null) {
    this.documentElement = documentElement;
    this.loginShell = loginShell;
    this.readyState = 'complete';
  }
  querySelector(selector) { return selector === '.kodety-login-shell' ? this.loginShell : null; }
  querySelectorAll() { return []; }
  addEventListener() {}
}
class LoginRuntimeFragment {
  querySelectorAll() { return []; }
}
class LoginRuntimeText {}
class LoginRuntimeMutationObserver {
  observe() {}
}
const loginDocumentElement = new LoginRuntimeElement();
const loginRuntimeDocument = new LoginRuntimeDocument(loginDocumentElement);
const loginRuntimeWindow = {
  kodetyAdminI18n: {
    locale: 'ar-test',
    direction: 'rtl',
    scope: 'login',
    documentLocale: true,
    // PHP encodes an empty associative subset as []; the runtime must accept
    // that compact representation just as it accepts an object.
    messages: [],
    aliases: [],
    direct: {},
    attributes: [],
  },
};
vm.runInNewContext(runtime, {
  window: loginRuntimeWindow,
  document: loginRuntimeDocument,
  Element: LoginRuntimeElement,
  HTMLInputElement: LoginRuntimeInput,
  Document: LoginRuntimeDocument,
  DocumentFragment: LoginRuntimeFragment,
  Text: LoginRuntimeText,
  MutationObserver: LoginRuntimeMutationObserver,
  Node: { TEXT_NODE: 3 },
});
assert.equal(loginDocumentElement.lang, 'ar-test', 'login scope must own the document language');
assert.equal(loginDocumentElement.dir, 'rtl', 'login scope must own the document direction');
assert.equal(loginDocumentElement.dataset.kodetyUiLocale, 'ar-test');

const unsupportedDocumentElement = new LoginRuntimeElement();
unsupportedDocumentElement.lang = 'ar';
unsupportedDocumentElement.dir = 'rtl';
const unsupportedLoginShell = new LoginRuntimeElement();
const unsupportedRuntimeDocument = new LoginRuntimeDocument(unsupportedDocumentElement, unsupportedLoginShell);
vm.runInNewContext(runtime, {
  window: {
    kodetyAdminI18n: {
      locale: 'en', direction: 'ltr', scope: 'login', documentLocale: false,
      messages: [], aliases: [], direct: {}, attributes: [],
    },
  },
  document: unsupportedRuntimeDocument,
  Element: LoginRuntimeElement,
  HTMLInputElement: LoginRuntimeInput,
  Document: LoginRuntimeDocument,
  DocumentFragment: LoginRuntimeFragment,
  Text: LoginRuntimeText,
  MutationObserver: LoginRuntimeMutationObserver,
  Node: { TEXT_NODE: 3 },
});
assert.equal(unsupportedDocumentElement.lang, 'ar', 'unsupported WordPress locale must keep the native document language');
assert.equal(unsupportedDocumentElement.dir, 'rtl', 'unsupported WordPress locale must keep the native document direction');
assert.equal(unsupportedLoginShell.lang, 'en', 'the Kodety shell still declares its own fallback language');
assert.equal(unsupportedLoginShell.dir, 'ltr', 'the Kodety shell still declares its own fallback direction');
const dynamicEnglishCopy = {
  '3 de 10 enviados': '3 of 10 sent',
  '2 falha(s) até agora. Você pode sair desta tela; a fila continua em segundo plano.': '2 failed so far. You can leave this screen; the queue will continue in the background.',
  'Remover permanentemente 1 tema inativo? O tema ativo será preservado.': 'Permanently remove 1 inactive theme? The active theme will be preserved.',
  'Remover permanentemente 4 temas inativos? O tema ativo será preservado.': 'Permanently remove 4 inactive themes? The active theme will be preserved.',
  'Salvando 1 alteração… ·': 'Saving 1 change… ·',
  'Salvando 3 alterações… ·': 'Saving 3 changes… ·',
  '1 tradução aplicada. Revise antes de publicar.': '1 translation applied. Review before publishing.',
  '2 traduções aplicadas. Revise antes de publicar.': '2 translations applied. Review before publishing.',
  '1 item importado para o WordPress.': '1 item imported into WordPress.',
  '2 itens importados para o WordPress.': '2 items imported into WordPress.',
  '1 snapshot removido em massa.': '1 snapshot removed in bulk.',
  '8 snapshots removidos em massa.': '8 snapshots removed in bulk.',
  '3 imagem(ns) animada(s) foi(ram) preservada(s).': 'Animated images preserved: 3.',
  '5 arquivo(s) ausente(s) recuperado(s)': 'Missing files recovered: 5',
};
for (const [source, target] of Object.entries(dynamicEnglishCopy)) {
  assert.equal(translateEnglish(source), target, `dynamic English copy did not render completely: ${source}`);
}

const criticalEnglishCopy = {
  'Projeto do site': 'Site project',
  'Abrir editor': 'Open editor',
  'Configurações': 'Settings',
  'Workspace do WordPress': 'WordPress workspace',
  'Prévia do onboarding': 'Onboarding preview',
  'Configuração inicial': 'Initial setup',
  'Etapa 1': 'Step 1',
  'Etapa 2': 'Step 2',
  'Etapa 3': 'Step 3',
  'Comece com um projeto': 'Start with a project',
  'Seu projeto foi preservado. Continue com ele ou escolha substituí-lo.': 'Your project was preserved. Continue with it or choose to replace it.',
  'Continuar projeto atual': 'Continue with current project',
  'Mantém o Builder, CMS e todas as configurações exatamente como estão.': 'Keeps the Builder, CMS, and all settings exactly as they are.',
  'Importar projeto': 'Import project',
  'Selecione um ZIP HTML, Vite ou exportado pelo Kodety.': 'Select an HTML, Vite, or Kodety-exported ZIP file.',
  'Escolher arquivo ZIP': 'Choose ZIP file',
  'Identidade do wp-admin': 'WordPress dashboard identity',
  'Cor do workspace': 'Workspace color',
  'Clique para alterar': 'Click to change',
  'Opcional · PNG, JPG ou WebP': 'Optional · PNG, JPG, or WebP',
  'Continuar': 'Continue',
  'Encerrar prévia': 'Close preview',
  'Concluir configuração': 'Complete setup',
  'Selecione um ZIP válido para importar.': 'Select a valid ZIP file to import.',
  'Transformar esta layer em link': 'Turn this layer into a link',
  'Quando a animação começa?': 'When does the animation start?',
  'Escolha um gatilho. A timeline abre em seguida para você animar.': 'Choose a trigger. The timeline opens next so you can animate.',
  'Convidar': 'Invite',
  '{value0} de {value1} enviados': '{value0} of {value1} sent',
  '{value0} falha(s) até agora. Você pode sair desta tela; a fila continua em segundo plano.': '{value0} failed so far. You can leave this screen; the queue will continue in the background.',
};
const criticalPortugueseCopy = {
  Builder: 'Builder',
  'Text content': 'Conteúdo de texto',
  Settings: 'Ajustes',
  Interactions: 'Interações',
  Margin: 'Margem',
  'Margin and padding': 'Margem e recuo',
  'Margin top': 'Margem acima',
  'Margin right': 'Margem direita',
  'Margin bottom': 'Margem abaixo',
  'Margin left': 'Margem esquerda',
  Padding: 'Recuo',
  'Padding top': 'Recuo acima',
  'Padding right': 'Recuo direito',
  'Padding bottom': 'Recuo abaixo',
  'Padding left': 'Recuo esquerdo',
  'Effects Library': 'Biblioteca: efeitos',
  Click: 'Clique',
  Hover: 'Ao passar',
  'Mouse move': 'Movimento',
  'Page load': 'Ao carregar',
  Scroll: 'Rolagem',
  'Custom event': 'Evento',
  'Animation code': 'Animação: código',
  'Edit the body. Target and event stay synced.': 'Edite o corpo. Alvo e evento ficam sincronizados.',
  Invite: 'Convidar',
  Publish: 'Publicar',
  'Add Link': 'Novo link',
  Attributes: 'Atributos',
};
for (const [source, target] of Object.entries(criticalEnglishCopy)) {
  assert.equal(english.direct[source], target, `critical English copy changed or disappeared: ${source}`);
}
for (const [source, target] of Object.entries(criticalPortugueseCopy)) {
  assert.equal(portuguese.direct[source], target, `critical Portuguese copy changed or disappeared: ${source}`);
}

assert.equal(portuguese.messages['nav.builder'], 'Builder', 'Builder is a product name and must not be translated');
assert.equal(portuguese.direct['Kodety Builder'], 'Kodety Builder', 'Kodety Builder branding must remain stable');
assert.doesNotMatch(
  [portuguese.messages['nav.builder'], portuguese.direct['Kodety Builder']].join('\n'),
  /Editor visual/,
  'Portuguese UI must keep the Builder product name in English',
);

const portugueseResidue = /\b(?:Workspace|snapshots?|templates?|Assets|Analytics|Insights|Desktop|Interactions?|layer|timeline|overlay|release|runtime|fallback|preset|container|scroll|Settings|Publish|Invite|Effects Library|Text content)\b/u;
const englishResidue = /\b(?:Adicionar|Configurações|Conteúdo|Projeto|Camada|Interações|Publicar|Convidar|Excluir|Salvar|Armazenamento|Restauração)\b/iu;
for (const [key, value] of Object.entries({ ...portuguese.messages, ...portuguese.direct })) {
  // Registered product names remain intact; ordinary Analytics labels translate.
  if (value === 'Google Analytics 4') continue;
  if (key === value && (
    /^\[[^\]]+\]$/.test(value)
    || /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(value)
    || /^\{\s*"@context"/.test(value)
  )) continue;
  assert.doesNotMatch(value, portugueseResidue, `English residue in Portuguese copy: ${key}`);
}
for (const [key, value] of Object.entries({ ...english.messages, ...english.direct })) {
  assert.doesNotMatch(value, englishResidue, `Portuguese residue in English copy: ${key}`);
}

assert.ok(schema.properties.legacy);
assert.doesNotMatch(runtime, /allowsGlossary|Object\.entries\(config\.glossary/);
assert.match(runtime, /Never translate fragments word by word/);
assert.match(runtime, /data-kodety-no-i18n/);
assert.match(runtime, /\[class\*="kodefy-"\]/);
assert.match(runtime, /\[id\^="kodefy-"\]/);
assert.match(runtime, /#toplevel_page_kodefy/);
assert.match(runtime, /document\.querySelector\(dialogScopeSelector\)/);
assert.match(runtime, /if \(hasTranslatableScope\(\)\) \{\s*translateNativeDialogs\(\);/);
assert.doesNotMatch(runtime, /canTranslateElement\(document\.body\)\) \{\s*translateNativeDialogs/);
assert.match(runtime, /\['button', 'reset', 'submit'\]\.includes\(element\.type\)/);
assert.match(runtime, /\['alert', 'confirm', 'prompt'\]/);
assert.match(
  runtime,
  /if \(!normalize\(original\)\) return;[\s\S]*?const next = leading \+ normalize\(translated\) \+ trailing;[\s\S]*?if \(next !== original\) node\.nodeValue = next;/,
  'the DOM observer must compare the final whitespace-preserving value to prevent an infinite mutation loop',
);
assert.doesNotMatch(
  runtime,
  /if \(translated !== original\) node\.nodeValue/,
  'the raw normalized translation must never control text-node writes',
);
assert.match(
  runtime,
  /config\.scope === 'document'[\s\S]*?config\.scope === 'login'[\s\S]*?config\.documentLocale !== false[\s\S]*?document\.documentElement\.lang = config\.locale;[\s\S]*?document\.documentElement\.dir = config\.direction \|\| 'ltr';/,
  'standalone login documents must expose the selected locale to browsers and assistive technology',
);
assert.match(server, /str_starts_with\(\$wordpress, 'pt'\) \? 'pt-BR' : 'en'/);
assert.match(server, /if \(\$scope === 'login'\)/);
assert.match(server, /LOGIN_DIRECT_SOURCES/);
assert.match(server, /LOGIN_WORDPRESS_COPY/);
assert.doesNotMatch(server, /add_options_page/);
assert.match(server, /kodety_admin_ui_catalog_dir/);
assert.match(plugin, /kodety-brand-settings__field kodety-admin-language-setting/);
assert.match(plugin, /name="kodety_admin_ui_locale"/);
assert.match(plugin, /update_option\(Kodety_Admin_I18n::OPTION, \$admin_ui_locale, false\)/);
assert.match(editorShell, /client_config\('document'\)/);
assert.match(editorShell, /JSON_HEX_TAG \| JSON_HEX_AMP \| JSON_UNESCAPED_UNICODE/);
assert.match(emailShell, /client_config\('document'\)/);
assert.match(
  globalStyles + await readFile(path.join(root, 'lib/html-editor/toast.css'), 'utf8'),
  /html\[data-kodety-ui-locale=['"]en['"]\][^{]+\[data-close-button\]::after\s*\{\s*content:\s*['"]Dismiss['"];/,
  'CSS-generated toast actions must provide English copy for the selected admin locale',
);

const compiledAdminUiLocale = ts.transpileModule(adminUiLocaleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadAdminUiLocale = ({ configured, documentLanguage, datasetLanguage } = {}) => {
  const module = { exports: {} };
  const window = { kodetyAdminI18n: configured === undefined ? undefined : { locale: configured } };
  const document = {
    documentElement: {
      lang: documentLanguage || '',
      dataset: { kodetyUiLocale: datasetLanguage || '' },
    },
  };
  vm.runInNewContext(compiledAdminUiLocale, {
    module,
    exports: module.exports,
    window,
    document,
    Intl,
  });
  return { api: module.exports, window, document };
};
assert.equal(
  loadAdminUiLocale({ configured: 'en', documentLanguage: 'pt-BR' }).api.getAdminUiLocale(),
  'en',
  'the configured admin locale must take precedence over document.lang',
);
assert.equal(
  loadAdminUiLocale({ configured: 'invalid_locale', documentLanguage: 'en-US' }).api.getAdminUiLocale(),
  'en-US',
  'an invalid configured locale must fall back to the document locale',
);
assert.equal(
  loadAdminUiLocale({ configured: 'invalid_locale', documentLanguage: 'also_invalid' }).api.getAdminUiLocale(),
  'pt-BR',
  'invalid configured and document locales must use the safe fallback',
);
const mutableLocale = loadAdminUiLocale({ configured: 'en', documentLanguage: 'pt-BR' });
assert.equal(mutableLocale.api.getAdminNumberFormatter().resolvedOptions().locale, 'en');
mutableLocale.window.kodetyAdminI18n.locale = 'pt-BR';
assert.equal(
  mutableLocale.api.getAdminNumberFormatter().resolvedOptions().locale,
  'pt-BR',
  'formatters must resolve the current admin locale instead of capturing the fallback at module load',
);
assert.doesNotMatch(adminUiLocaleSource, /new Intl\.(?:NumberFormat|DateTimeFormat)\(['"]pt-BR['"]/, 'formatters must not hardcode pt-BR');
for (const source of adminFormattingSources) {
  assert.match(source, /kodetyAdminI18n\?\.locale/, 'plain admin scripts must read the selected UI locale');
  assert.doesNotMatch(
    source,
    /(?:toLocaleString|Intl\.(?:NumberFormat|DateTimeFormat))\(['"]pt-BR['"]/,
    'plain admin number/date formatting must not hardcode pt-BR',
  );
}
assert.doesNotMatch(
  cmsManagerSource,
  /\.toLocale(?:Date)?String\(\s*\)/,
  'CMS administration dates must always receive the selected UI locale',
);

console.log('Catálogos administrativos do Kodety aprovados.');
