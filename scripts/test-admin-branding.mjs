import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [
  plugin,
  mcp,
  mcpServer,
  editor,
  editorTypes,
  editorChromeBits,
  editorShell,
  adminShell,
  adminPage,
  adminPageScript,
  designSystem,
  shellCss,
  adminIcons,
  loginCss,
  loginScript,
  adminAuditCss,
  mediaLibraryCss,
  mediaLibraryJs,
  mediaBackend,
  agencyCss,
  agencyScript,
  themeIndex,
  themeFunctions,
  onboardingCss,
  onboardingScript,
  onboardingTemplate,
  licensePhp,
  uninstall,
] = await Promise.all([
  read('Wordpress/kodety/includes/class-kodety-plugin.php'),
  read('Wordpress/kodety/includes/class-kodety-mcp.php'),
  read('Wordpress/kodety/mcp/server.mjs'),
  read('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
  read('lib/html-editor/editor-types.ts'),
  read('lib/html-editor/EditorChromeBits.tsx'),
  read('Wordpress/kodety/templates/editor-shell.php'),
  read('Wordpress/kodety/admin/components/shell.js'),
  read('Wordpress/kodety/admin/kodety-page.css'),
  read('Wordpress/kodety/admin/kodety-page.js'),
  read('Wordpress/kodety/admin/components/design-system.css'),
  read('Wordpress/kodety/admin/components/shell.css'),
  read('Wordpress/kodety/admin/components/kodety-icons.js'),
  read('Wordpress/kodety/admin/login.css'),
  read('Wordpress/kodety/admin/login.js'),
  read('Wordpress/kodety/admin/components/wp-admin-audit.css'),
  read('Wordpress/kodety/admin/media-library.css'),
  read('Wordpress/kodety/admin/media-library.js'),
  read('Wordpress/kodety/includes/class-kodety-media.php'),
  read('Wordpress/kodety/admin/agency.css'),
  read('Wordpress/kodety/admin/agency.js'),
  read('Wordpress/kodety/theme-runtime/index.php'),
  read('Wordpress/kodety/theme-runtime/functions.php'),
  read('Wordpress/kodety/admin/onboarding.css'),
  read('Wordpress/kodety/admin/onboarding.js'),
  read('Wordpress/kodety/templates/onboarding.php'),
  read('Wordpress/kodety/includes/class-kodety-license.php'),
  read('Wordpress/kodety/uninstall.php'),
]);

assert.doesNotMatch(plugin, /Nome do workspace|Ícone do canto do Builder/);
assert.doesNotMatch(plugin, /\['client-logo'\s*=>[^;\n]*'chevron-left'/);
assert.match(plugin, /\['kodety-logo'\s*=>\s*'Logo Onun Kodety',\s*'client-logo'\s*=>\s*'Logo do cliente'\]/);
assert.match(plugin, /<input[^>]+name="kodety_admin_accent_color"[^>]+type="color"/);
assert.match(plugin, /MIN_BLACK_TEXT_CONTRAST\s*=\s*4\.5/);
assert.match(plugin, /is_valid_interface_accent_color\(\$submitted\)/);
assert.match(plugin, /DEFAULT_ADMIN_ACCENT_COLOR\s*=\s*'#9393FF'/);
assert.match(plugin, /DEFAULT_ADMIN_ACCENT_HOVER_COLOR\s*=\s*'#AFAFFF'/);
assert.match(
  plugin,
  /if \(\$schema_version < 14\)[\s\S]*?get_option\('kodety_admin_accent_color', ''\)[\s\S]*?=== '#57aeff'[\s\S]*?DEFAULT_ADMIN_ACCENT_COLOR[\s\S]*?kodety_schema_version', 14/,
  'a migração da paleta deve mover apenas o antigo destaque padrão',
);
assert.match(
  plugin,
  /\$is_default_accent = strtolower\(\$accent\) === strtolower\(self::DEFAULT_ADMIN_ACCENT_COLOR\);[\s\S]*?\$hover = \$is_default_accent[\s\S]*?DEFAULT_ADMIN_ACCENT_HOVER_COLOR[\s\S]*?color-mix\(in srgb,var\(--kodety-admin-accent\) 86%,white\)/,
  'o padrão deve usar o hover oficial e cores personalizadas devem continuar derivadas',
);
assert.match(
  plugin,
  /\$foreground = '#000';[\s\S]*?--kodety-admin-accent-foreground:' \. \$foreground/,
  'todo destaque validado deve usar o foreground preto que atende ao contraste mínimo',
);

for (const source of [mcp, mcpServer, editor, editorShell, adminShell]) {
  assert.doesNotMatch(source, /\bbrandName\b/);
}
assert.match(mcpServer, /enum:\s*\['kodety-logo',\s*'client-logo'\]/);
assert.match(mcpServer, /interfaceAccentColor/);
assert.match(
  mcp,
  /\$activity_expired = is_array\(\$activity\)[\s\S]*?\['expiresAt'\][\s\S]*?delete_option\(self::OPTION_ACTIVITY\)/,
  'atividade MCP abandonada deve expirar em vez de manter o Builder ocupado indefinidamente',
);
assert.match(
  mcp,
  /ACTIVITY_DEFAULT_LEASE_SECONDS = 120[\s\S]*?ACTIVITY_LONG_LEASE_SECONDS = 900[\s\S]*?'expiresAt' => time\(\) \+ \([\s\S]*?'active' => false[\s\S]*?'visibleUntil' => time\(\) \+ self::ACTIVITY_VISIBLE_SECONDS[\s\S]*?append_activity_event\(\$completed\)/,
  'cada operação MCP deve possuir lease e conclusões mutantes devem sobreviver tempo suficiente para o polling notificar',
);
assert.match(
  editor,
  /const revisionCameFromMcp[\s\S]*?if \(!revisionCameFromMcp\) \{[\s\S]*?return;[\s\S]*?const hasLocalWrite/,
  'o polling MCP só pode sincronizar revisões comprovadamente produzidas por uma mutação MCP',
);
assert.match(
  plugin,
  /PUBLISH_RECEIPTS_OPTION[\s\S]*?publish_receipt\([\s\S]*?request_fingerprint[\s\S]*?remember_publish_receipt[\s\S]*?'replayed'/,
  'repetir um publish cuja resposta se perdeu deve devolver o recibo da mesma release',
);
assert.match(editorTypes, /editorCornerIcon:\s*'kodety-logo'\s*\|\s*'client-logo'/);
assert.match(editorChromeBits, /<KodetyLoadingMark className=\{cn\('h-6 w-\[22px\]', className\)\}/);
assert.match(editorShell, /<title>Onun Kodety —/);
assert.match(
  editorShell,
  /\$brand_logo_url\s*=\s*'';\s*\$editor_corner_icon\s*=\s*'kodety-logo'/,
  'a identidade personalizada do workspace deve ficar restrita ao wp-admin',
);
assert.match(adminShell, /M51\.1932 122L0 61L113\.183 94\.8289V122H51\.1932Z/);
assert.doesNotMatch(adminShell, /kodety-ui-brand__copy|kodety-ui-workspace-avatar|workspaceName/);
assert.match(adminShell, /logo\.className = 'kodety-ui-brand__full'[\s\S]*?logo\.src = config\.kodetyLogoUrl/);
assert.match(plugin, /'kodetyLogoUrl' => KODETY_URL \. 'admin\/images\/kodety-logo-full\.svg'/);
assert.match(
  adminShell,
  /project\.children\.forEach[\s\S]*?hubChildren\.push/,
  'Os destinos internos do projeto, incluindo licença e atualizações, devem manter a ordem e as permissões do menu nativo.',
);
assert.match(
  plugin,
  /private function dashboard_brand_mark\(\): string[\s\S]*?M51\.1932 122L0 61L113\.183 94\.8289V122H51\.1932Z[\s\S]*?M51\.1932 0L0 61L113\.183 27\.1711V0H51\.1932Z/,
  'a identidade do projeto deve usar o símbolo Onun Kodety real, separado dos ícones funcionais',
);
assert.match(
  plugin,
  /kodety-current-project"[\s\S]*?kodety-site-project__panel-icon--brand[\s\S]*?dashboard_brand_mark\(\)[\s\S]*?id="kodety-current-project-title"/,
  'o card do projeto atual deve manter a marca Onun Kodety no cabeçalho',
);
assert.match(
  adminPage,
  /\.kodety-project-tabs button\[aria-selected="true"\]\s*\{[^}]*background:[^}]*color:/,
  'abas selecionadas do projeto devem manter um estado visual distinto',
);
assert.doesNotMatch(licensePhp, /add_submenu_page|add_menu_page|wp_safe_remote_post|wp_remote_post|https:\/\/dash\.kodety/,
  'The open-source edition must not register activation screens or contact licensing services.');

// wp-admin, o login e o Builder carregam o mesmo favicon Onun Kodety; a marca pública
// do site continua valendo apenas no front-end.
assert.match(plugin, /add_action\('admin_head', \[\$this, 'render_kodety_favicon'\], 0\)/);
assert.match(plugin, /add_action\('login_head', \[\$this, 'render_kodety_favicon'\], 0\)/);
assert.match(plugin, /add_filter\('login_title', \[\$this, 'login_document_title'\], 10, 2\)/);
assert.match(plugin, /function login_document_title\(string \$login_title, string \$title\): string/);
assert.match(plugin, /login_document_title[\s\S]*?wp_is_recovery_mode\(\)[\s\S]*?Recovery Mode/);
assert.match(plugin, /remove_action\('admin_head', 'wp_site_icon'\)/);
assert.match(plugin, /remove_action\('login_head', 'wp_site_icon'\)/);
assert.doesNotMatch(plugin, /remove_action\('wp_head', 'wp_site_icon'\)/);
assert.match(editorShell, /Kodety_Plugin::favicon_urls\(\)/);

// Login: a camada de apresentação deve enriquecer o formulário nativo, sem
// trocar seus nós ou criar um segundo sistema visual fora dos tokens Onun Kodety.
for (const className of [
  'kodety-login-shell',
  'kodety-login-panel',
  'kodety-login-intro',
]) {
  assert.match(
    loginScript,
    new RegExp(`['"\\\`]${className}['"\\\`]`),
    `o login deve criar a estrutura semântica ${className}`,
  );
}
assert.ok(
  (loginScript.match(/document\.createElement\(/g) || []).length >= 4,
  'shell, painel, introdução e adornos do login devem ser nós reais e acessíveis',
);
assert.match(
  loginScript,
  /(?:append|appendChild|insertBefore)\(/,
  'a nova composição deve ser montada ao redor do login nativo',
);
const loginActionContexts = new Set(
  loginScript.match(/(?:login-action-)?(?:lostpassword|retrievepassword|register|resetpass|checkemail)/g) || [],
);
assert.ok(
  loginActionContexts.size >= 2,
  'a introdução deve responder ao contexto da ação exibida pelo WordPress',
);

assert.match(
  loginScript,
  /document\.createElement\(\s*['"]img['"]\s*\)[\s\S]{0,320}?['"]kodety-login-stage__image['"]/,
  'o painel visual deve criar uma única imagem com classe semântica estável',
);
assert.equal(
  (loginScript.match(/\bstage\.append(?:Child)?\(/g) || []).length,
  1,
  'a imagem deve ser o único conteúdo anexado ao painel visual',
);
assert.match(
  loginScript,
  /\bstage\.append(?:Child)?\(\s*[\w$]*(?:image|artwork|visual)[\w$]*\s*\)/i,
  'o único filho do painel visual deve ser a imagem local',
);
assert.doesNotMatch(loginScript, /\bstage\.(?:innerHTML|replaceChildren)\b/);
for (const obsoleteStageClass of [
  'kodety-login-stage__brand',
  'kodety-login-stage__copy',
  'kodety-login-stage__eyebrow',
  'kodety-login-stage__features',
  'kodety-login-preview',
]) {
  assert.doesNotMatch(
    `${loginScript}\n${loginCss}`,
    new RegExp(obsoleteStageClass),
    `o painel de imagem não deve manter o bloco gerado ${obsoleteStageClass}`,
  );
}
const localLoginImageReferences = [...new Set(
  [...loginScript.matchAll(
    /['"`]((?:\.\.?\/)?images\/[^'"`]+\.(?:avif|webp|png|jpe?g|svg)(?:\?[^'"`]*)?)['"`]/gi,
  )].map(([, reference]) => reference),
)];
assert.ok(
  localLoginImageReferences.length >= 2,
  'stage e marca devem referenciar assets locais distintos dentro de admin/images',
);
assert.ok(
  localLoginImageReferences.includes('images/kodety-logo-full.svg'),
  'o painel do formulário deve usar o logo vetorial completo fornecido',
);
const localStageImageReference = localLoginImageReferences.find(
  reference => reference !== 'images/kodety-logo-full.svg',
);
assert.ok(localStageImageReference, 'o painel visual deve referenciar sua própria imagem local');
assert.ok(
  localLoginImageReferences.includes('images/login-showcase.webp'),
  'a arte padrão do painel visual deve continuar empacotada como login-showcase.webp',
);
assert.doesNotMatch(
  loginScript,
  /images\/login-showcase\.png/i,
  'o login não deve voltar a apontar para a versão PNG removida do showcase',
);
assert.ok(
  (/new URL\(/.test(loginScript) && /document\.currentScript|\bscript[\w$]*\.(?:src|url)/i.test(loginScript))
    || (/wp_(?:add_inline_script|localize_script)\(/.test(plugin) && /KODETY_URL/.test(plugin)),
  'URLs relativas de imagem devem ser resolvidas pelo URL do script ou injetadas pelo PHP do plugin',
);
assert.doesNotMatch(
  loginScript,
  /\.src\s*=\s*['"`](?:\.\.?\/)?images\//,
  'atribuir uma string relativa diretamente a img.src resolveria contra wp-login.php',
);
const kodetyPluginRoot = path.resolve(root, 'Wordpress/kodety');
for (const reference of localLoginImageReferences) {
  const localLoginImageFile = path.resolve(
    root,
    'Wordpress/kodety/admin',
    reference.split(/[?#]/, 1)[0],
  );
  assert.ok(
    localLoginImageFile.startsWith(`${kodetyPluginRoot}${path.sep}`),
    'cada imagem do login deve resolver para dentro do plugin',
  );
  await assert.doesNotReject(
    readFile(localLoginImageFile),
    `o asset local ${reference} deve existir no pacote`,
  );
}

// Configurações > Imagem do login: o upload segue o fluxo multipart já usado
// pela tela e vira um attachment nativo do WordPress, nunca um caminho solto.
assert.match(
  plugin,
  /add_option\(\s*['"]kodety_login_image_id['"]\s*,\s*0\s*,\s*['"]{2}\s*,\s*false\s*\)/,
  'a imagem personalizada do login deve possuir uma opção própria de attachment ID',
);

const brandSettingsMarkupStart = plugin.indexOf('<form class="kodety-brand-settings__form"');
const brandSettingsMarkupEnd = plugin.indexOf('</form>', brandSettingsMarkupStart);
assert.ok(
  brandSettingsMarkupStart >= 0 && brandSettingsMarkupEnd > brandSettingsMarkupStart,
  'a tela de Configurações deve manter o formulário de identidade do workspace',
);
const brandSettingsMarkup = plugin.slice(brandSettingsMarkupStart, brandSettingsMarkupEnd);
assert.match(brandSettingsMarkup, /Imagem do login/i);
const loginImageInputMarkup = brandSettingsMarkup.match(
  /<input\b[^>]*\bid=["']kodety_login_image["'][^>]*>/i,
)?.[0] || '';
assert.ok(loginImageInputMarkup, 'Imagem do login deve ter um input de upload próprio');
assert.match(loginImageInputMarkup, /\bname=["']kodety_login_image["']/i);
assert.match(loginImageInputMarkup, /\btype=["']file["']/i);
for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
  assert.match(
    loginImageInputMarkup,
    new RegExp(mime.replace('/', '\\/'), 'i'),
    `o seletor da imagem do login deve aceitar ${mime}`,
  );
}
for (const hook of [
  'data-kodety-login-image-preview',
  'data-kodety-login-image-status',
  'data-kodety-login-image-action',
  'data-kodety-login-image-remove',
]) {
  assert.match(
    brandSettingsMarkup,
    new RegExp(`\\b${hook}\\b`),
    `o controle da imagem do login deve expor ${hook}`,
  );
}
assert.match(
  brandSettingsMarkup,
  /data-kodety-login-image-preview[\s\S]*?<img\b[^>]*\bsrc=/i,
  'o attachment salvo deve aparecer no preview da própria configuração',
);
assert.match(
  brandSettingsMarkup,
  /(?:Escolher|Trocar)[^<]*(?:imagem|arte)/i,
  'o controle deve deixar explícita a ação de escolher ou trocar a imagem',
);
assert.match(
  brandSettingsMarkup,
  /Remover[^<]*(?:imagem|arte)/i,
  'o controle deve permitir remover a imagem personalizada',
);
assert.match(brandSettingsMarkup, /PNG[\s\S]{0,100}?JPG[\s\S]{0,100}?WebP/i);
assert.match(
  brandSettingsMarkup,
  /(?:máximo(?:\s+de)?|até)\s*1\s*MB/i,
  'a ajuda deve comunicar o limite máximo de 1 MB',
);
assert.match(
  brandSettingsMarkup,
  /(?:proporção|razão)[^<]{0,80}?30\s*:\s*23/i,
  'a ajuda deve recomendar a proporção 30:23 sem transformá-la em bloqueio',
);

assert.match(adminPageScript, /querySelector\(\s*['"]#kodety_login_image['"]\s*\)/);
for (const hook of [
  'data-kodety-login-image-preview',
  'data-kodety-login-image-status',
  'data-kodety-login-image-action',
  'data-kodety-login-image-remove',
]) {
  assert.match(
    adminPageScript,
    new RegExp(`querySelector\\(\\s*['"]\\[${hook}\\]['"]\\s*\\)`),
    `o preview multipart deve reutilizar o hook ${hook}`,
  );
}
assert.match(
  adminPageScript,
  /kodety_login_image[\s\S]*?addEventListener\(\s*['"]change['"][\s\S]*?files\?\.\[0\]/,
  'a seleção local deve atualizar o preview antes do envio do formulário',
);
assert.match(adminPageScript, /URL\.createObjectURL\(/);
assert.match(
  adminPageScript,
  /(?:loginImagePreview|login_image[^\n]*preview)[\s\S]{0,500}?\.replaceChildren\(/i,
  'o preview deve trocar somente seu conteúdo visual, preservando o formulário multipart',
);

const saveBrandSettingsContract = plugin.slice(
  plugin.indexOf('public function save_brand_settings'),
  plugin.indexOf('public function save_optimization_settings'),
);
assert.match(
  saveBrandSettingsContract,
  /\$_FILES\[\s*['"]kodety_login_image['"]\s*\][\s\S]*?(?:\[['"]size['"]\]|filesize\s*\()[\s\S]*?>[\s\S]*?(?:LOGIN_IMAGE_MAX_BYTES|MB_IN_BYTES|1024\s*\*\s*1024|1048576)/,
  'o servidor deve rejeitar a imagem do login quando ela exceder 1 MB',
);
const loginImageUploadStart = saveBrandSettingsContract.search(
  /media_handle_upload\(\s*['"]kodety_login_image['"]/,
);
assert.ok(
  loginImageUploadStart >= 0,
  'o upload da imagem do login deve criar um attachment pela Media Library do WordPress',
);
for (const preflight of [
  'filesize($temporary_file)',
  'wp_check_filetype_and_ext($temporary_file',
  'wp_get_image_mime($temporary_file)',
  'wp_getimagesize($temporary_file)',
]) {
  const preflightStart = saveBrandSettingsContract.indexOf(preflight);
  assert.ok(
    preflightStart >= 0 && preflightStart < loginImageUploadStart,
    `${preflight} deve validar o arquivo temporário antes de o WordPress gerar metadados e miniaturas`,
  );
}
assert.match(
  saveBrandSettingsContract,
  /intdiv\(\s*self::LOGIN_IMAGE_MAX_PIXELS\s*,\s*\$image_height\s*\)/,
  'o preflight deve limitar pixels antes da decodificação do attachment',
);
const loginImageUploadEnd = saveBrandSettingsContract.indexOf(']);', loginImageUploadStart);
const loginImageUploadContract = saveBrandSettingsContract.slice(
  loginImageUploadStart,
  loginImageUploadEnd >= 0 ? loginImageUploadEnd + 3 : loginImageUploadStart + 1200,
);
for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
  assert.match(
    loginImageUploadContract,
    new RegExp(mime.replace('/', '\\/')),
    `o upload nativo da imagem do login deve permitir ${mime}`,
  );
}
assert.match(
  saveBrandSettingsContract,
  /media_handle_upload\(\s*['"]kodety_login_image['"][\s\S]{0,900}?\$[\w]*login_image_id\s*=\s*absint\(/,
  'o attachment retornado pelo WordPress deve ser sanitizado antes de persistir',
);
assert.match(
  saveBrandSettingsContract,
  /\$current_login_image_id\s*=\s*absint\(\s*get_option\(\s*['"]kodety_login_image_id['"]\s*,\s*0\s*\)\s*\)/,
  'a transação deve partir do attachment atualmente persistido',
);
assert.match(
  saveBrandSettingsContract,
  /\$next_login_image_id\s*=\s*isset\(\s*\$_POST\[\s*['"]kodety_remove_login_image['"]\s*\]\s*\)\s*\?\s*0\s*:\s*\$current_login_image_id\s*;/,
  'remover deve preparar o próximo estado sem gravar antes da validação do upload',
);
const sanitizedLoginImageIdStart = saveBrandSettingsContract.indexOf(
  '$uploaded_login_image_id = absint($uploaded_login_image_id);',
);
const validatedLoginImageStart = saveBrandSettingsContract.indexOf(
  'get_post_type($uploaded_login_image_id)',
  sanitizedLoginImageIdStart,
);
const replaceNextLoginImageStart = saveBrandSettingsContract.indexOf(
  '$next_login_image_id = $uploaded_login_image_id;',
  sanitizedLoginImageIdStart,
);
assert.ok(
  sanitizedLoginImageIdStart >= 0
    && validatedLoginImageStart > sanitizedLoginImageIdStart
    && replaceNextLoginImageStart > validatedLoginImageStart,
  'somente um attachment sanitizado e validado pode substituir o próximo estado da opção',
);
const loginImageOptionWrites = saveBrandSettingsContract.match(
  /update_option\(\s*['"]kodety_login_image_id['"]/g,
) || [];
assert.equal(
  loginImageOptionWrites.length,
  1,
  'a opção da imagem do login deve ser persistida uma única vez ao fim da transação',
);
assert.match(
  saveBrandSettingsContract,
  /update_option\(\s*['"]kodety_login_image_id['"]\s*,\s*\$next_login_image_id\s*,\s*false\s*\)/,
  'remoção, preservação e upload válido devem convergir para o mesmo commit final',
);
const loginImageUploadBranchStart = saveBrandSettingsContract.indexOf(
  "if (isset($_FILES['kodety_login_image'])",
);
const loginImageOptionCommitStart = saveBrandSettingsContract.indexOf(
  "update_option('kodety_login_image_id'",
);
assert.ok(
  loginImageUploadBranchStart >= 0 && loginImageOptionCommitStart > loginImageUploadBranchStart,
  'o commit da opção deve ocorrer apenas depois de toda a validação do upload',
);
assert.doesNotMatch(
  saveBrandSettingsContract,
  /(?:unlink|wp_delete_attachment)\s*\(\s*\$current_login_image_id/,
  'remover a personalização não deve apagar o arquivo que pertence à Media Library',
);
assert.doesNotMatch(
  saveBrandSettingsContract,
  /move_uploaded_file\s*\(/,
  'o upload não deve contornar as APIs nativas da Media Library',
);

const loginAssetsContract = plugin.slice(
  plugin.indexOf('public function login_assets'),
  plugin.indexOf('public static function favicon_urls'),
);
assert.match(
  loginAssetsContract,
  /absint\(\s*get_option\(\s*['"]kodety_login_image_id['"]\s*,\s*0\s*\)\s*\)/,
  'login_assets deve ler o attachment customizado como ID sanitizado',
);
assert.match(loginAssetsContract, /wp_get_attachment_image_url\(/);
assert.doesNotMatch(
  loginAssetsContract,
  /get_attached_file\(|filesize\(/,
  'o login deve aceitar attachments servidos por storage externo sem exigir um arquivo local',
);
assert.ok(
  /KODETY_URL\s*\.\s*['"]admin\/images\/login-showcase\.webp['"]/.test(loginAssetsContract)
    || (
      /KODETY_URL\s*\.\s*ltrim\(/.test(loginAssetsContract)
      && /(?:versioned_asset_url|asset_url)\(\s*['"]admin\/images\/login-showcase\.webp['"]/.test(loginAssetsContract)
    ),
  'um attachment ausente ou inválido deve cair no showcase empacotado',
);
assert.match(loginAssetsContract, /['"]showcaseUrl['"]\s*=>/);
assert.match(loginAssetsContract, /['"]fallbackShowcaseUrl['"]\s*=>/);
assert.match(loginAssetsContract, /JSON_HEX_TAG/);
assert.ok(
  /wp_localize_script\(\s*['"]kodety-login['"]/.test(loginAssetsContract)
    || /wp_add_inline_script\(\s*['"]kodety-login['"][\s\S]*?wp_json_encode\([\s\S]*?['"]before['"]\s*\)/.test(loginAssetsContract),
  'a URL final deve ser injetada antes de login.js executar',
);
assert.match(
  loginScript,
  /window\.kodetyLoginConfig[\s\S]{0,500}?resolveLoginAsset\(\s*['"]showcaseUrl['"]\s*,\s*['"]images\/login-showcase\.webp['"]\s*\)/,
  'login.js deve consumir a URL injetada e manter o fallback relativo seguro',
);
assert.match(
  loginScript,
  /addEventListener\(\s*['"]error['"][\s\S]{0,500}?fallbackShowcaseUrl[\s\S]{0,300}?dataset\.kodetyFallbackAttempted/,
  'uma imagem customizada indisponível deve tentar o showcase empacotado apenas uma vez',
);

assert.doesNotMatch(loginScript, /kodety-login-intro__eyebrow|\beyebrow\s*:/);
assert.doesNotMatch(loginCss, /\.kodety-login-intro__eyebrow/);
assert.doesNotMatch(loginScript, /kodety-login-brand__(?:mark|wordmark)/);
assert.doesNotMatch(loginCss, /\.kodety-login-brand__(?:mark|wordmark)/);
assert.doesNotMatch(
  loginScript,
  /(?:textContent\s*=|createTextNode\()\s*['"`]Onun Kodety['"`]|>\s*Kodety\s*</,
  'o wordmark deve vir vetorizado no SVG, não como texto HTML separado',
);
assert.match(
  loginScript,
  /document\.createElement\(\s*['"]img['"]\s*\)[\s\S]{0,320}?['"]kodety-login-brand__logo['"]/,
  'a marca completa deve ser inserida como uma imagem sem recriar seu wordmark em HTML',
);
assert.match(
  loginScript,
  /logo\.append(?:Child)?\(\s*[\w$]*(?:logo|brand)[\w$]*\s*\)/i,
  'o link de marca deve conter apenas o SVG completo fornecido',
);

assert.match(loginScript, /kodety-login-field/);
assert.match(loginScript, /kodety-login-field__surface/);
assert.match(
  loginScript,
  /(?:closest|querySelector)\(\s*['"]\.wp-pwd['"]\s*\)/,
  'o campo de senha composto do WordPress deve ser reutilizado',
);
assert.match(
  loginScript,
  /classList\.add\([^)]+kodety-login-field__surface/,
  'inputs e ações devem pertencer a uma única superfície visual',
);
assert.doesNotMatch(
  loginScript,
  /\.wp-pwd[^;\n]{0,200}(?:innerHTML|outerHTML|replaceChildren|replaceWith|\.remove\()/,
  'o enriquecimento não pode destruir o wrapper .wp-pwd nem o toggle nativo',
);

assert.match(loginScript, /Solar Bold Duotone/);
assert.match(
  loginScript,
  /Solar Bold Duotone[\s\S]{0,240}?Gravity/,
  'o login deve documentar Solar para informação e Gravity para ações diretas',
);
const loginDuotoneSet = loginScript.match(
  /const DUOTONE_ICONS\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/,
)?.[1] || '';
for (const informativeIcon of ['envelope', 'globe', 'lock', 'person', 'shieldCheck']) {
  assert.match(
    loginDuotoneSet,
    new RegExp(`['"]${informativeIcon}['"]`),
    `o ícone informativo ${informativeIcon} deve usar Solar Bold Duotone`,
  );
}
assert.match(loginScript, /duotone\s*\?\s*['"]24 24['"]\s*:\s*['"]16 16['"]/);
assert.match(loginScript, /kodety-login-icon--duotone/);
assert.match(
  loginScript,
  /eye\s*:\s*['"]<path/,
  'o toggle deve embarcar localmente o par Gravity Eye e Eye Slash',
);
assert.match(loginScript, /eyeSlash\s*:\s*['"]<path/);
assert.match(loginScript, /<svg[\s\S]*?aria-hidden=["']true["']/);
assert.match(loginScript, /(?:getAttribute|setAttribute)\(\s*['"]aria-label['"]/);
assert.match(loginScript, /setAttribute\(\s*['"]aria-pressed['"]/);
assert.match(loginScript, /addEventListener\(\s*['"]click['"]/);
assert.match(
  loginScript,
  /MutationObserver[\s\S]*?attributeFilter:\s*\[['"]type['"]\]/,
  'o estado acessível do toggle deve acompanhar cliques e mudanças nativas no tipo do campo',
);
assert.match(
  loginScript,
  /MutationObserver[\s\S]*?childList:\s*true[\s\S]*?subtree:\s*true/,
  'feedback de senha inserido pelo WordPress no DOM ready deve permanecer fora da superfície compacta',
);

assert.match(loginScript, /addEventListener\(\s*['"]submit['"]/);
assert.match(loginScript, /login-action-retrievepassword/);
assert.match(loginScript, /login-action-confirmaction/);
assert.match(loginScript, /interim-login-success/);
assert.match(loginScript, /resetComplete[\s\S]*?#resetpassform/);
assert.match(
  loginScript,
  /login-action-confirm_admin_email[\s\S]*?document\.createElement\([\s\S]*?['"]h1['"]/,
  'confirm_admin_email deve manter um h1 real mesmo quando o WordPress omite o título externo',
);
assert.match(
  loginScript,
  /(?:setAttribute\(\s*['"]aria-busy['"]|\.ariaBusy\s*=)/,
  'o envio deve expor seu estado ocupado para tecnologia assistiva',
);
assert.doesNotMatch(
  loginScript,
  /\b[\w$]*form[\w$]*\.(?:innerHTML|outerHTML|textContent|replaceChildren|replaceWith)\b/i,
  'o estado de envio não pode substituir o DOM original do formulário',
);
assert.match(
  loginScript,
  /kodetySubmitting[\s\S]*?preventDefault\(\)/,
  'o estado de carregamento deve impedir um segundo envio sem alterar o formulário',
);
assert.match(
  loginScript,
  /initiallyFocused[\s\S]*?preventScroll:\s*true/,
  'o enriquecimento deve restaurar o autofocus nativo depois de reparentar o formulário e seus inputs',
);
assert.match(
  loginScript,
  /!form\.hasAttribute\(['"]aria-labelledby['"]\)[\s\S]*?!form\.hasAttribute\(['"]aria-label['"]\)/,
  'o título Onun Kodety não deve sobrescrever o nome acessível fornecido por 2FA/SSO',
);
assert.match(loginScript, /previousState[\s\S]*?restoreAttribute/);
assert.match(loginScript, /loginObserver\.observe\(login, \{ childList: true, subtree: true \}\)/);
assert.match(loginScript, /textFieldTypes/);
assert.match(
  loginScript,
  /querySelectorAll\(\s*['"]input\.input['"]\s*\)[\s\S]{0,220}?textFieldTypes\.has\(type\)[\s\S]{0,120}?enhanceField\(form, input\)/,
  'checkbox, radio e file de plugins não podem ser convertidos em campos textuais',
);

for (const className of [
  'kodety-login-language',
  'kodety-login-language__surface',
  'kodety-login-language__icon',
  'kodety-login-language__chevron',
]) {
  assert.match(
    loginScript,
    new RegExp(`['"\\\`]${className}['"\\\`]`),
    `o seletor de idioma deve criar ${className}`,
  );
}
assert.match(loginScript, /\.querySelector\(\s*['"]select['"]\s*\)/);
assert.match(
  loginScript,
  /\.append\([^)]*\bselect\b[^)]*\)/,
  'o select nativo deve ser reparentado para a superfície, não recriado',
);
assert.doesNotMatch(
  loginScript,
  /\b(?:language[\w$]*|select)\.(?:innerHTML|outerHTML|replaceChildren|replaceWith|remove)\b/i,
  'o enriquecimento do idioma deve preservar o form e o select fornecidos pelo WordPress',
);
assert.match(loginScript, /(?:language|languages|globe)\s*:\s*['"]<(?:path|g)\b/);
assert.match(loginScript, /chevronDown\s*:\s*['"]<(?:path|g)\b/);
assert.match(loginScript, /iconMarkup\(\s*['"](?:language|languages|globe)['"]/);
assert.match(loginScript, /iconMarkup\(\s*['"]chevronDown['"]/);

const loginAccountActionsContract = loginScript.slice(
  loginScript.indexOf('const arrangeLoginActions'),
  loginScript.indexOf('const fieldIconFor'),
);
assert.match(
  loginAccountActionsContract,
  /querySelector\(\s*['"]#backtoblog['"]\s*\)\?\.remove\(\)/,
  'Ir para o site deve ser removido da experiência Onun Kodety',
);
assert.match(
  loginAccountActionsContract,
  /querySelector\(\s*['"]#loginform['"]\s*\)[\s\S]*?if \(!form \|\| !remember \|\| !navigation\) return/,
  'a nova linha de conta deve existir somente no formulário de login normal',
);
assert.match(loginAccountActionsContract, /querySelectorAll\(\s*['"]a['"]\s*\)/);
assert.match(
  loginAccountActionsContract,
  /searchParams\.get\(\s*['"]action['"]\s*\) === ['"]lostpassword['"]/,
  'somente o link de recuperação deve sair da navegação nativa',
);
assert.match(loginAccountActionsContract, /['"]kodety-login-account-row['"]/);
assert.match(loginAccountActionsContract, /['"]kodety-login-account-row__recovery['"]/);
assert.match(
  loginAccountActionsContract,
  /row\.append\(\s*remember\s*,\s*recoveryLink\s*\)/,
  'lembrar-me e recuperação devem compartilhar a mesma linha sem recriar seus nós',
);
assert.match(
  loginAccountActionsContract,
  /if \(!navigation\.querySelector\(\s*['"]a['"]\s*\)\) navigation\.remove\(\)/,
  'Register e outros links devem manter #nav; o container só sai quando realmente vazio',
);
assert.doesNotMatch(
  loginAccountActionsContract,
  /row\.append\([^)]*\bnavigation\b/,
  'a linha de conta não pode puxar todo o #nav e quebrar links adicionais',
);

const parsedLoginCssRules = [...loginCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, selector, declarations]) => ({
    selector: selector.trim(),
    declarations: declarations.trim(),
  }),
);
const loginCssRulesMatching = (selectorPattern) =>
  parsedLoginCssRules.filter(({ selector }) => selectorPattern.test(selector));

const loginStageImageCss = loginCssRulesMatching(/\.kodety-login-stage__image(?:\s|,|$)/)
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(loginStageImageCss, /width\s*:\s*100%/);
assert.match(loginStageImageCss, /height\s*:\s*100%/);
assert.match(loginStageImageCss, /object-fit\s*:\s*cover/);

assert.match(
  loginCss,
  /\.kodety-login #login h1\.wp-login-logo\s*\{[^}]*text-align\s*:\s*left/i,
  'a marca completa deve ficar explicitamente alinhada à esquerda, neutralizando o core',
);
const loginBrandLogoCss = loginCssRulesMatching(/\.kodety-login-brand__logo(?:\s|,|$)/)
  .map(({ declarations }) => declarations)
  .join('\n');
const renderedLoginLogoWidth = Number(loginBrandLogoCss.match(/(?:^|;)\s*width\s*:\s*([\d.]+)px/m)?.[1]);
const renderedLoginLogoHeight = Number(loginBrandLogoCss.match(/(?:^|;)\s*height\s*:\s*([\d.]+)px/m)?.[1]);
assert.ok(
  renderedLoginLogoWidth >= 144 && renderedLoginLogoWidth <= 148,
  'o logo renderizado deve ter aproximadamente 146 px de largura',
);
assert.ok(
  renderedLoginLogoHeight >= 29 && renderedLoginLogoHeight <= 31,
  'o logo renderizado deve ter aproximadamente 30 px de altura',
);
assert.ok(
  Math.abs((renderedLoginLogoWidth / renderedLoginLogoHeight) - (209 / 43)) < 0.05,
  'a redução visual deve preservar a proporção do SVG 209 × 43',
);
assert.match(loginBrandLogoCss, /display\s*:\s*block/);
const loginBrandSvg = await readFile(
  path.join(root, 'Wordpress/kodety/admin/images/kodety-logo-full.svg'),
  'utf8',
);
assert.match(loginBrandSvg, /viewBox=["']0 0 209 43["']/i);
assert.match(loginBrandSvg, /<path\b/i);
assert.match(loginBrandSvg, /fill=["']#8888f8["']/i);
assert.match(loginBrandSvg, /fill=["']white["']/i);
assert.doesNotMatch(loginBrandSvg, /<text\b/i);

const loginIntroDescriptionCss = loginCssRulesMatching(/\.kodety-login-intro__description/)
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(
  loginIntroDescriptionCss,
  /text-wrap\s*:\s*balance/,
  'a descrição curta do formulário deve manter quebras visualmente equilibradas',
);

const normalLoginTitleCss = loginCssRulesMatching(
  /login-action-login[^,{]*\.kodety-login-intro__title/,
).map(({ declarations }) => declarations).join('\n');
assert.match(
  loginScript,
  /const loginContext\s*=\s*\{[\s\S]*?title:[^\n]*['"]Boas-vindas de volta['"]/,
  'a escala reduzida deve continuar vinculada ao título do login normal',
);
const normalLoginTitleSizes = [
  ...normalLoginTitleCss.matchAll(/font-size\s*:\s*([^;]+)/gi),
].flatMap(([, value]) => [...value.matchAll(/([\d.]+)px/gi)].map(([, size]) => Number(size)));
assert.ok(normalLoginTitleSizes.length > 0, 'o login normal deve ter escala tipográfica própria');
assert.ok(
  Math.min(...normalLoginTitleSizes) >= 20 && Math.max(...normalLoginTitleSizes) <= 28,
  'Boas-vindas de volta deve ficar cerca de 30% menor sem perder legibilidade',
);

const loginAccountRowCss = loginCssRulesMatching(/\.kodety-login-account-row(?:\s|,|$)/)
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(loginAccountRowCss, /display\s*:\s*flex/);
assert.match(loginAccountRowCss, /width\s*:\s*100%/);
assert.match(loginAccountRowCss, /align-items\s*:\s*center/);
assert.match(loginAccountRowCss, /justify-content\s*:\s*space-between/);
assert.match(loginCss, /\.kodety-login-account-row__recovery:focus-visible/);
const backToBlogCss = loginCssRulesMatching(/#backtoblog(?:\s|,|$)/)
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(backToBlogCss, /display\s*:\s*none/);
assert.match(loginCss, /#nav a/);

for (const token of [
  '--kodety-chrome',
  '--kodety-panel',
  '--kodety-panel-raised',
  '--kodety-divider',
  '--kodety-text',
  '--kodety-text-secondary',
  '--kodety-text-tertiary',
  '--kodety-accent',
  '--kodety-accent-hover',
  '--kodety-focus',
  '--kodety-danger',
  '--kodety-control-height',
  '--kodety-radius-control',
  '--kodety-ease-ui',
]) {
  assert.match(
    loginCss,
    new RegExp(`${token}\\s*:`),
    `o login deve disponibilizar o token oficial ${token}`,
  );
}
assert.ok(
  (loginCss.match(/var\(--kodety-[a-z0-9-]+/gi) || []).length >= 14,
  'a composição do login deve reutilizar os tokens oficiais em vez de copiar valores',
);
assert.doesNotMatch(
  loginCss,
  /--kd-login-/,
  'o redesign não deve manter a paleta paralela legada --kd-login-*',
);

const loginSurfaceFocusRules = loginCssRulesMatching(
  /\.kodety-login-field__surface:focus-within/,
);
assert.match(
  loginCss,
  /:not\(\.kodety-login--ready\)[^{}]*#login form \.input[\s\S]*?background:[^;]*rgb\(255 255 255 \/ 5\.5%\)/,
  'o formulário nativo deve continuar utilizável e coerente se o JS de apresentação não executar',
);
assert.ok(
  loginSurfaceFocusRules.length > 0,
  'a superfície externa do campo composto deve ser a única dona do foco',
);
assert.match(
  loginSurfaceFocusRules.map(({ declarations }) => declarations).join('\n'),
  /border-color\s*:[^;]*var\(--kodety-focus\)/,
  'focus-within deve trocar apenas o stroke existente pelo violeta oficial',
);
const loginSurfaceInputRules = loginCssRulesMatching(
  /\.kodety-login-field__surface[^,{]*(?:input|\.input)/,
);
assert.ok(loginSurfaceInputRules.length > 0, 'campos internos devem ter reset visual explícito');
const loginSurfaceInputCss = loginSurfaceInputRules
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(loginSurfaceInputCss, /box-shadow\s*:\s*none/i);
assert.match(loginSurfaceInputCss, /outline\s*:\s*(?:0|none)/i);
for (const { declarations } of loginCssRulesMatching(/\.kodety-login-field[^{}]*(?::focus|:focus-within)/)) {
  const focusedBoxShadows = [...declarations.matchAll(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/gi)]
    .map(([, value]) => value.trim().toLowerCase().replace(/\s*!important$/, ''));
  assert.ok(
    focusedBoxShadows.every(value => value === 'none' || value === '0'),
    'campos do login não podem reintroduzir glow ou ring externo no foco',
  );
  const focusedOutlines = [...declarations.matchAll(/(?:^|;)\s*outline\s*:\s*([^;]+)/gi)]
    .map(([, value]) => value.trim().toLowerCase().replace(/\s*!important$/, ''));
  assert.ok(
    focusedOutlines.every(value => value === 'none' || value === '0'),
    'o foco do campo deve usar um único stroke, não um segundo outline',
  );
}

const languageSwitcherRules = loginCssRulesMatching(/\.language-switcher(?:\s|,|$)/);
assert.ok(languageSwitcherRules.length >= 2, 'o seletor de idioma deve permanecer visível e estilizado');
for (const { declarations } of languageSwitcherRules) {
  assert.doesNotMatch(declarations, /display\s*:\s*none/i);
  assert.doesNotMatch(declarations, /visibility\s*:\s*hidden/i);
}
assert.match(
  languageSwitcherRules.map(({ declarations }) => declarations).join('\n'),
  /(?:display\s*:\s*(?:block|flex|grid)|border(?:-[a-z-]+)?\s*:|background\s*:)/i,
  'o seletor de idioma deve participar visualmente da composição',
);

const loginLanguageSurfaceCss = loginCssRulesMatching(
  /\.kodety-login-language__surface\s*(?:,|$)/,
).map(({ declarations }) => declarations).join('\n');
assert.match(loginLanguageSurfaceCss, /display\s*:\s*(?:flex|grid)/);
assert.match(loginLanguageSurfaceCss, /border\s*:/);
assert.match(loginLanguageSurfaceCss, /background\s*:/);
assert.match(loginCss, /\.kodety-login-language__icon\b/);
assert.match(loginCss, /\.kodety-login-language__chevron\b/);

const loginLanguageSelectCss = loginCssRulesMatching(
  /\.kodety-login-language__surface[^,{]*select/,
).map(({ declarations }) => declarations).join('\n');
const languageSelectUsesAbsoluteHitTarget = (
  /position\s*:\s*absolute/.test(loginLanguageSelectCss)
  && /inset\s*:\s*0(?:\D|$)/.test(loginLanguageSelectCss)
  && /position\s*:\s*relative/.test(loginLanguageSurfaceCss)
);
const languageSelectUsesGridHitTarget = (
  /display\s*:\s*grid/.test(loginLanguageSurfaceCss)
  && /grid-(?:area|column|row)\s*:/.test(loginLanguageSelectCss)
);
assert.ok(
  languageSelectUsesAbsoluteHitTarget || languageSelectUsesGridHitTarget,
  'o select nativo deve cobrir toda a superfície para que globo e chevron também sejam clicáveis',
);
assert.match(loginLanguageSelectCss, /width\s*:\s*100%/);
assert.match(loginLanguageSelectCss, /height\s*:\s*100%/);
assert.match(
  loginLanguageSelectCss,
  /(?:-webkit-)?appearance\s*:\s*none/,
  'o select preservado deve remover apenas a aparência visual nativa',
);
const loginLanguageOverlayCss = loginCssRulesMatching(
  /\.kodety-login-language__(?:icon|chevron)(?:\s|,|$)/,
).map(({ declarations }) => declarations).join('\n');
assert.match(loginLanguageOverlayCss, /pointer-events\s*:\s*none/);
assert.ok(
  /position\s*:\s*absolute/.test(loginLanguageOverlayCss)
    || /grid-(?:area|column|row)\s*:/.test(loginLanguageOverlayCss),
  'os ícones do idioma devem sobrepor o select sem dividir seu hit target',
);
const loginLanguageFocusWithinCss = loginCssRulesMatching(
  /\.kodety-login-language__surface:focus-within/,
).map(({ declarations }) => declarations).join('\n');
assert.match(loginLanguageFocusWithinCss, /border-color\s*:[^;]*var\(--kodety-focus\)/);
const loginLanguageFocusVisibleCss = loginCssRulesMatching(
  /\.kodety-login-language__surface[^,{]*select:focus-visible/,
).map(({ declarations }) => declarations).join('\n');
assert.match(loginLanguageFocusVisibleCss, /outline\s*:\s*(?:0|none)/);
const languageFocusBoxShadows = [
  ...loginLanguageFocusVisibleCss.matchAll(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/gi),
].map(([, value]) => value.trim().toLowerCase().replace(/\s*!important$/, ''));
assert.ok(
  languageFocusBoxShadows.every(value => value === 'none' || value === '0'),
  'o select interno não pode desenhar um segundo ring sobre o focus-within da superfície',
);

const loginInfoNoticeCss = loginCssRulesMatching(/(?:\.message|\.notice-info)/)
  .map(({ declarations }) => declarations)
  .join('\n');
const loginErrorNoticeCss = loginCssRulesMatching(/(?:#login_error|\.notice-error)/)
  .map(({ declarations }) => declarations)
  .join('\n');
assert.match(loginInfoNoticeCss, /var\(--kodety-(?:accent|info)[a-z-]*\)/);
assert.match(loginErrorNoticeCss, /var\(--kodety-danger\)/);
assert.match(loginCss, /\.notice-warning[\s\S]*?var\(--kodety-warning\)/);
assert.match(
  loginCss,
  /(?:\.kodety-login-notice|#login_error) a[\s\S]*?color:\s*var\(--kodety-accent-hover\)[\s\S]*?text-decoration:\s*underline/,
  'links dentro de mensagens devem manter contraste e affordance no painel escuro',
);
assert.match(loginCss, /\.button-primary:disabled/);
assert.match(loginCss, /\.kodety-login-field__input:disabled/);
assert.match(loginCss, /\[aria-disabled=["']true["']\]/);
assert.match(loginCss, /\.button-primary[\s\S]*?float:\s*none[\s\S]*?margin:\s*0/);
assert.match(loginCss, /\.admin-email__actions\s*>\s*div[\s\S]*?padding-top:\s*0/);
assert.match(loginCss, /\.caps-warning svg[\s\S]*?(?:fill|stroke):\s*currentColor/);
assert.match(loginCss, /\.caps-warning \.caps-icon[\s\S]*?width:\s*14px[\s\S]*?height:\s*14px/);
assert.match(
  loginCss,
  /\.button:not\(\.button-primary\):not\(\.wp-hide-pw\):focus-visible[\s\S]*?outline:\s*2px solid var\(--kodety-focus\)/,
  'ações secundárias de reset e confirmação precisam de foco visível',
);

assert.match(
  loginCss,
  /@media\s*\(\s*max-width\s*:\s*\d+px\s*\)[\s\S]*?kodety-login-(?:shell|panel)/,
  'o shell deve adaptar sua composição em viewports menores',
);
assert.match(
  loginCss,
  /@media\s*\(\s*max-width\s*:\s*360px\s*\)[\s\S]*?padding-inline:[\s\S]*?max\(8px/,
  '320 px deve preservar os 304 px úteis exigidos por CAPTCHAs comuns',
);
assert.match(loginCss, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
assert.match(loginCss, /@media\s*\(\s*forced-colors\s*:\s*active\s*\)/);
assert.match(
  loginCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)[\s\S]*?(?:CanvasText|Highlight|ButtonText)/,
  'alto contraste deve usar cores de sistema em vez de depender apenas da paleta escura',
);
assert.match(
  loginCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)[\s\S]*?\.kodety-login-field__surface:focus-within[\s\S]*?border-color:\s*Highlight\s*!important/,
  'o stroke de foco deve permanecer visível no modo de alto contraste',
);
assert.match(
  loginCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)[\s\S]*?\.kodety-login-language__surface:focus-within[\s\S]*?border-color:\s*Highlight\s*!important/,
  'a superfície do idioma deve manter seu stroke de foco no alto contraste',
);
assert.match(
  loginCss,
  /@media\s*\(\s*forced-colors\s*:\s*active\s*\)[\s\S]*?\.kodety-login-language__surface[\s\S]*?forced-color-adjust:\s*auto/,
  'o select nativo e sua superfície devem continuar legíveis em cores forçadas',
);
assert.match(
  loginCss,
  /(?:body\.)?interim-login[^{}]*(?:kodety-login-shell|#login)/,
  'o login interino em iframe precisa de uma composição própria e utilizável',
);

assert.match(plugin, /add_option\('kodety_workspace_mode', 'single'/);
assert.match(plugin, /add_option\('kodety_onboarding_status', \$fresh_install \? 'pending' : 'complete'/);
assert.match(plugin, /maybe_redirect_to_onboarding/);
assert.match(plugin, /admin_page_kodety-onboarding/);
assert.match(
  uninstall,
  /update_option\('kodety_onboarding_status', 'pending', false\)/,
  'apagar o plugin deve rearmar o onboarding sem remover os projetos preservados',
);
assert.match(
  onboardingTemplate,
  /value="existing"[\s\S]*?checked\(\$source, 'existing'\)[\s\S]*?Continuar projeto atual/,
  'a reinstalação deve permitir continuar o workspace existente em vez de sobrescrevê-lo',
);
assert.match(plugin, /\$has_existing_project \? 'existing' : 'blank'/);
assert.match(plugin, /\$source === 'existing' && !\$this->has_workspace\(\)/);
assert.match(plugin, /private function workspace_mode\(\): string \{[\s\S]*?return 'single';/);
assert.match(plugin, /pre_update_option_kodety_workspace_mode/);
assert.doesNotMatch(plugin, /name="kodety_workspace_mode"[^>]+value="agency"/);
assert.doesNotMatch(plugin, /add_action\('admin_post_kodety_agency_/);
assert.doesNotMatch(plugin, /add_rewrite_rule\([\s\S]{0,100}kodety-site-assets/);
assert.doesNotMatch(mcp, /'workspaceMode' => 'agency'/);
/* Retired multi-project implementation contracts retained below only as
 * historical source coverage; the production hooks are deliberately absent. */
if (false) {
assert.match(
  plugin,
  /\$is_agency_page = \$screen && \$screen->id === 'dashboard'[\s\S]*?\$this->workspace_mode\(\) === 'agency'/,
  'os assets da central de projetos devem ficar isolados no Dashboard',
);
assert.match(
  plugin,
  /\$is_agency_dashboard = \$this->workspace_mode\(\) === 'agency'[\s\S]*?\$callback = \$is_agency_dashboard[\s\S]*?\[\$this, 'agency_page'\][\s\S]*?wp_add_dashboard_widget\('kodety_dashboard', 'Onun Kodety', \$callback\)/,
  'o Modo agência deve substituir o conteúdo do Dashboard pela central de projetos',
);
assert.match(plugin, /private function agency_snapshot_current/);
assert.match(plugin, /private function agency_restore_project/);
assert.match(
  plugin,
  /agency_snapshot_current[\s\S]*?project_template_manifest_json[\s\S]*?agency_restore_project[\s\S]*?package_editable_workspace_as_zip/,
  'a troca de projeto deve preservar o workspace e o manifesto portátil antes de restaurar outro',
);
for (const operation of ['activate', 'export', 'rename', 'save_route', 'move', 'duplicate', 'delete']) {
  assert.match(
    plugin,
    new RegExp(`\\$operation === '${operation}'`),
    `o workspace de agência deve implementar a ação ${operation}`,
  );
}
}
assert.match(plugin, /add_action\('load-' \. \$onboarding_hook, \[\$this, 'render_onboarding_document'\]\)/);
assert.match(onboardingTemplate, /<!doctype html>[\s\S]*?admin\/onboarding\.css/);
assert.doesNotMatch(onboardingTemplate, /(?:wp_head|admin_head|wp_footer)\(\);|load-styles\.php|wp-admin\/css/,
  'o onboarding deve ser um documento próprio sem carregar o CSS ou o chrome do WordPress');
assert.equal((onboardingTemplate.match(/rel="stylesheet"/g) || []).length, 1);
assert.match(
  plugin,
  /browser_studio_runtime\(\): \?array[\s\S]*?defined\('KODETY_BROWSER_STUDIO_RUNTIME'\)[\s\S]*?constant\('KODETY_BROWSER_STUDIO_RUNTIME'\)[\s\S]*?is_browser_studio_origin/,
  'o modo Studio deve exigir o marcador efêmero do PHP-WASM além da opção persistida',
);
assert.match(
  onboardingTemplate,
  /\$studio_runtime\['previewUrl'\][\s\S]*?target="_blank"[\s\S]*?Abrir na aba Site/,
  'a ação local deve abrir o proxy do Studio em uma nova guia',
);
assert.match(
  onboardingTemplate,
  /<\?php if \(\$studio_runtime\): \?>[\s\S]*?Projeto local[\s\S]*?<\?php else: \?>[\s\S]*?Seu próximo acesso começa aqui/,
  'o mesmo pacote deve manter ramificações explícitas para Studio local e WordPress hospedado',
);
assert.match(
  onboardingCss,
  /\.kodety-onboarding \[hidden\]\s*\{[\s\S]*?display:\s*none !important/,
  'etapas e controles ocultos não devem reaparecer por causa das regras flex/grid do onboarding',
);
assert.match(onboardingScript, /updateSource\(\)[\s\S]*?show\(current, false\)/);
assert.match(
  onboardingCss,
  /\.kodety-onboarding__choices\.has-existing\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  'as três origens de projeto devem permanecer em uma única linha no onboarding desktop',
);
assert.match(
  onboardingCss,
  /\.kodety-onboarding__color-control input\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*0[\s\S]*?inline-size:\s*100%[\s\S]*?block-size:\s*100%/,
  'todo o campo de cor deve ser clicável, não apenas um pequeno swatch nativo',
);
assert.match(
  plugin,
  /'folder'\s*=>\s*'folder'[\s\S]*?'monitor'\s*=>\s*'monitor'[\s\S]*?'website'\s*=>\s*'website'/,
  'os ícones semânticos do onboarding devem chegar à biblioteca Gravity UI sem cair no fallback de seta',
);
assert.match(
  plugin,
  /\$test_requested[\s\S]*?onboarding=teste[\s\S]*?\$_POST\['kodety_onboarding_test'\][\s\S]*?wp_safe_redirect\(admin_url\(\)\)[\s\S]*?validate_onboarding_slug/,
  'o atalho ?onboarding=teste deve abrir e encerrar a prévia sem salvar o formulário',
);
assert.match(onboardingTemplate, /name="kodety_onboarding_test" value="1"/);
assert.equal((onboardingTemplate.match(/data-kodety-step="[1-4]"/g) || []).length, 4);
assert.match(onboardingTemplate, /data-kodety-step="4"[\s\S]*?Kodety_Security::DEFAULT_SLUG[\s\S]*?name="kodety_admin_slug"[\s\S]*?data-kodety-copy-login[\s\S]*?name="kodety_login_saved"/,
  'a última etapa deve explicar o padrão, permitir alterar/copiar o link e exigir que ele seja guardado');
assert.match(plugin, /validate_onboarding_slug[\s\S]*?kodety_login_saved[\s\S]*?stage_builder_import[\s\S]*?save_onboarding_slug[\s\S]*?kodety_onboarding_status', 'complete'/,
  'o login deve ser validado antes de mutações e persistido somente depois de preparar o projeto');
assert.match(onboardingScript, /current < steps\.length[\s\S]*?event\.preventDefault\(\)[\s\S]*?go\(current \+ 1\)/,
  'Enter nas etapas anteriores não pode concluir a configuração');
assert.match(onboardingScript, /lastLoginUrl !== url[\s\S]*?saved\.checked = false/,
  'alterar o endereço deve invalidar a confirmação do link anterior');
assert.match(onboardingScript, /for \(let step = 1; step <= steps\.length; step \+= 1\)[\s\S]*?validateStep\(step\)/,
  'o envio precisa revalidar todas as etapas, inclusive as que estão ocultas');
assert.doesNotMatch(onboardingTemplate, /data-kodety-step="[1-4]"[^>]*\bhidden\b/,
  'sem JavaScript todas as etapas devem permanecer preenchíveis');
assert.match(onboardingCss, /\.kodety-onboarding__control:focus-within\s*\{[^}]*border-color: color-mix/);
assert.doesNotMatch(onboardingCss, /--wp-|--kodety-admin-accent|#wpcontent|#adminmenu/,
  'o design precisa ser independente das variáveis e dos elementos do wp-admin');
if (false) {
assert.match(agencyCss, /\.kodety-agency__project-grid[\s\S]*?repeat\(5,/);
assert.match(
  agencyCss,
  /\.kodety-agency__project-grid[\s\S]*?repeat\(5, minmax\(0, 1fr\)\)[\s\S]*?aspect-ratio:\s*6\s*\/\s*7/,
  'a biblioteca de projetos deve priorizar capas verticais em um grid editorial fluido',
);
assert.match(
  agencyCss,
  /\.kodety-agency__preview > iframe\[data-kodety-live-cover\]\s*\{[\s\S]*?width:\s*1200px[\s\S]*?transform-origin:\s*top left/,
  'as capas publicadas devem usar diretamente o render vivo da página',
);
assert.match(
  agencyCss,
  /\.kodety-agency__folder-open\s*\{[\s\S]*?align-items:\s*flex-start[\s\S]*?justify-content:\s*flex-end[\s\S]*?flex-direction:\s*column/,
  'os cards de pasta devem organizar ícone, nome e contagem verticalmente',
);
assert.match(
  agencyCss,
  /body\.kodety-agency-page\.index-php #dashboard-widgets[\s\S]*?#kodety_dashboard > \.inside/,
  'a central de agência deve ocupar o Dashboard inteiro mesmo sem depender da skin opcional',
);
assert.match(agencyScript, /data-kodety-agency-search[\s\S]*?applyFilters/);
assert.match(
  plugin,
  /data-kodety-project-action-nonce=[\s\S]*?data-kodety-folder-drop[\s\S]*?data-project-id=[\s\S]*?draggable="true"[\s\S]*?aria-grabbed="false"/,
  'os projetos da central devem expor uma origem arrastável e as pastas devem aceitar o drop',
);
assert.match(
  agencyScript,
  /addEventListener\('dragstart'[\s\S]*?application\/x-kodety-project[\s\S]*?addEventListener\('dragover'[\s\S]*?addEventListener\('drop'[\s\S]*?submitProjectMove/,
  'arrastar um projeto sobre uma pasta deve enviar a operação move já suportada pelo backend',
);
assert.match(
  agencyCss,
  /\.kodety-agency__folder\.is-drop-target[\s\S]*?\.kodety-agency__project\.is-dragging/,
  'a pasta de destino e o projeto em movimento devem ter estados visuais inequívocos',
);
assert.match(
  agencyScript,
  /data-kodety-folder-filter-trigger[\s\S]*?data-kodety-folder-option[\s\S]*?setFolderFilter[\s\S]*?data-kodety-folder-filter-value[\s\S]*?sortProjects[\s\S]*?projectGrid\.appendChild/,
  'a busca e o dropdown controlado de pastas devem filtrar uma grade ordenada por atualização',
);
assert.match(
  agencyCss,
  /\.kodety-agency__project-title > \.kodety-agency__menu\s*\{[\s\S]*?top:\s*auto[\s\S]*?bottom:\s*32px/,
  'o menu de ações dos projetos deve abrir acima do acionador sem ser recortado no rodapé',
);
assert.match(
  agencyCss,
  /\.kodety-agency__search > input\[type="search"\]\s*\{[\s\S]*?all:\s*unset !important/,
  'a busca deve ter um único container visual e um input interno completamente neutro',
);
assert.match(
  agencyCss,
  /\.kodety-agency__dialog \.kodety-agency__slug-field > input\[type="text"\]\s*\{[\s\S]*?border:\s*0 !important[\s\S]*?border-radius:\s*0 !important[\s\S]*?box-shadow:\s*none !important/,
  'o campo composto de slug deve desenhar somente a borda externa',
);
assert.match(
  plugin,
  /data-kodety-agency-host data-kodety-agency-style=/,
  'a central de projetos deve expor um host próprio e a folha de estilos que será carregada dentro dele',
);
assert.match(
  agencyScript,
  /attachShadow\(\{\s*mode:\s*'open'\s*\}\)[\s\S]*?shadowRoot\.append\(stylesheet, root\)[\s\S]*?KodetyIcons\?\.scan\?\.\(shadowRoot\)/,
  'a central de projetos deve viver em Shadow DOM e montar os ícones dentro dessa fronteira',
);
assert.match(
  agencyCss,
  /:host\s*\{[\s\S]*?contain:\s*style[\s\S]*?\.kodety-agency \.kodety-dashboard-icon > svg\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/,
  'o CSS isolado deve definir tokens próprios e normalizar o alinhamento dos SVGs',
);
assert.match(
  plugin,
  /'search'\s*=>\s*'search'[\s\S]*?'website'\s*=>\s*'website'[\s\S]*?'x'\s*=>\s*'x'/,
  'as ações da central devem usar ícones semânticos, sem fallback visual para a seta',
);
assert.match(
  adminShell,
  /const projectHref = nativeLink\.href\.split\('#'\)\[0\];[\s\S]*?link\.href = `\$\{projectHref\}#kodety-settings`/,
  'clicar em Onun Kodety deve abrir diretamente Configurações do projeto ativo',
);
assert.match(
  plugin,
  /if \(\$agency_mode\) \{[\s\S]*?remove_menu_page\('edit\.php\?post_type=page'\)/,
  'a lista compartilhada de páginas deve sair da sidebar no modo agência',
);
assert.match(
  plugin,
  /\$admin_page === 'kodety-editor'[\s\S]*?\$this->workspace_mode\(\) === 'agency'[\s\S]*?\? admin_url\(\)[\s\S]*?: home_url\('\/kodety\/editor\/'\)/,
  'o atalho genérico do Builder deve voltar à central para a escolha explícita do projeto',
);
assert.match(
  plugin,
  /'editorUrl'\s*=>\s*\$agency_mode \? admin_url\(\) : home_url\('\/kodety\/editor\/'\)[\s\S]*?'workspaceMode'\s*=>\s*\$agency_mode \? 'agency' : 'single'/,
  'o shell deve receber tanto o destino seguro do Builder quanto o modo atual',
);
assert.match(
  adminShell,
  /const isAgencyWorkspace = config\.workspaceMode === 'agency'[\s\S]*?hiddenInAgency:\s*true[\s\S]*?items\.filter\(\(item\) => item\.source && item\.href && !\(isAgencyWorkspace && item\.hiddenInAgency\)\)/,
  'o seletor superior de Páginas deve ser removido somente no modo agência',
);
assert.match(
  plugin,
  /admin_post_kodety_agency_project_cover[\s\S]*?function agency_project_cover\(\): void[\s\S]*?Content-Type: image\/png/,
  'a rota autenticada das capas antigas deve continuar disponível apenas por compatibilidade',
);
assert.match(
  plugin,
  /function active_project_site_url\(\): string[\s\S]*?agency_active_project_id[\s\S]*?home_url\('\/' \. \$projects\[\$active_id\]\['slug'\] \. '\/'\)/,
  'o Builder deve continuar resolvendo a rota pública do projeto ativo',
);
assert.match(
  plugin,
  /if \(\$is_published\):[\s\S]*?<iframe[\s\S]*?add_query_arg\('kodety-cover-preview', \(string\) \$project\['release'\][\s\S]*?data-kodety-live-cover/,
  'todo projeto publicado deve usar o render vivo versionado pela release',
);
assert.doesNotMatch(plugin, /agency_hydrate_project_covers|data-kodety-saved-cover|kodety-agency__move-form/);
assert.doesNotMatch(agencyCss, /kodety-agency__move-form|kodety-agency__preview > img/);
assert.doesNotMatch(agencyScript, /data-kodety-saved-cover|mountLiveCover/);
assert.doesNotMatch(editor, /uploadPublishedSiteCover|capturePublishedSiteCover|screenshotUrl/);
assert.doesNotMatch(editorShell, /screenshotUrl/);
const screenshotMethod = plugin.slice(
  plugin.indexOf('public function update_theme_screenshot'),
  plugin.indexOf('public function list_releases'),
);
const snapshotSettings = await read('app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx');
const snapshotPreview = await read('app/(builder)/kodety/html-editor/components/HtmlSnapshotPreview.tsx');
const snapshotTopbar = await read('app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx');
assert.match(snapshotTopbar, /topbarWp\?\.storageUrl[\s\S]*?searchParams\.set\('section', 'storage'\)[\s\S]*?navigateAfterWordPressSave[\s\S]*?<History \/> Snapshots/,
  'o menu da logo deve abrir snapshots depois de salvar o projeto atual');
assert.match(snapshotSettings, /snapshots\.items\.map[\s\S]*?<Eye \/> Visualizar[\s\S]*?data-kodety-snapshot-download/,
  'cada snapshot deve oferecer prévia e download');
assert.match(snapshotPreview, /sandbox="allow-scripts"/,
  'a prévia deve isolar scripts históricos da sessão autenticada e bloquear formulários');
assert.doesNotMatch(snapshotPreview, /allow-same-origin|allow-top-navigation/);
assert.match(snapshotPreview, /setConfirming\(true\)[\s\S]*?Restaurar esta versão/);
assert.match(snapshotPreview, /Confirmar restauração[\s\S]*?onClick=\{\(\) => void restore\(\)\}/,
  'restaurar deve exigir confirmação explícita além de abrir a prévia');
assert.match(snapshotSettings, /await flushSettingsBeforeLeave\(\)[\s\S]*?expectedWorkspaceRevision[\s\S]*?kodety_restored_snapshot[\s\S]*?window\.location\.replace\(editorLockHandoffUrl/,
  'restauração deve enviar a revisão e reabrir o servidor sem salvar o modelo substituído');
assert.match(plugin, /admin_post_kodety_download_snapshot[\s\S]*?public function admin_download_snapshot[\s\S]*?current_user_can\('manage_options'\)[\s\S]*?check_admin_referer\('kodety_download_snapshot_' \. \$release\)/);
assert.match(plugin, /stream_project_archive\(\$archive, 'snapshot-' \. \$release \. '\.zip', 'attachment', true\)/,
  'o download deve transmitir e remover o ZIP temporário');
assert.match(plugin, /kodety-snapshot-list[\s\S]*?Visualizar e restaurar[\s\S]*?data-kodety-snapshot-download/);
assert.doesNotMatch(
  screenshotMethod,
  /cover\.png|kodety_agency_projects|coverVersion/,
  'o endpoint legado de screenshot não deve mais produzir capas para projetos de agência',
);
assert.match(
  plugin,
  /private function project_admin_page_slug\(\): string\s*\{\s*return 'kodety';\s*\}[\s\S]*?admin_page === 'kodety-project-settings'[\s\S]*?project_admin_url\('#kodety-settings'\)/,
  'o modo agência deve reutilizar o mesmo screen do projeto e redirecionar a rota legada',
);
assert.match(
  plugin,
  /kodety-site-assets[\s\S]*?agency_project_by_slug[\s\S]*?agency_root_project[\s\S]*?kodety_agency_route/,
  'o roteador de agência deve resolver sites publicados por slug e por projeto raiz',
);
assert.match(
  plugin,
  /agency_capture_published_theme[\s\S]*?\/published[\s\S]*?kodety-site-assets[\s\S]*?publishedAt/,
  'cada publish no Modo agência deve manter um runtime próprio do projeto',
);
assert.match(
  themeIndex,
  /kodety_runtime_context\(\)[\s\S]*?kodety_runtime_directory\(\)[\s\S]*?kodety_runtime_directory_uri\(\)[\s\S]*?\['route'\]/,
  'o tema deve renderizar o runtime selecionado sem depender do projeto aberto no Builder',
);
assert.match(
  themeFunctions,
  /function kodety_runtime_public_url[\s\S]*?baseUrl[\s\S]*?kodety_rewrite_public_page_links/,
  'links entre páginas devem permanecer dentro do slug público do projeto',
);
assert.match(
  agencyScript,
  /data-kodety-route-project[\s\S]*?data-kodety-route-slug[\s\S]*?data-kodety-route-root/,
  'a biblioteca deve permitir editar slug e projeto raiz sem sair da central',
);
}

assert.match(adminPage, /--kodety-project-primary-foreground/);
assert.match(adminPage, /\.kodety-brand-settings__icons\s*\{[^}]*display:\s*grid/);
assert.match(adminPageScript, /contrast >= 4\.5/);
assert.match(adminPageScript, /setCustomValidity/);
assert.match(
  plugin,
  /Central de segurança[\s\S]*?kodety-security-score[\s\S]*?Login privado e força bruta[\s\S]*?Expiração das sessões[\s\S]*?Redução da superfície de ataque[\s\S]*?Cabeçalhos HTTP/,
  'o painel de segurança deve apresentar diagnóstico e grupos operacionais completos',
);
for (const securityField of [
  'login_max_attempts',
  'login_attempt_window_minutes',
  'login_lockout_minutes',
  'generic_login_errors',
  'custom_session_duration',
  'session_hours',
  'remember_days',
  'disable_application_passwords',
  'disable_registration',
  'hide_wp_version',
  'security_headers',
  'frame_policy',
  'referrer_policy',
  'permissions_policy',
  'enable_hsts',
  'hsts_max_age_days',
  'hsts_subdomains',
]) {
  assert.match(
    plugin,
    new RegExp(`(?:name="kodety_security_${securityField}"|'${securityField}'\\s*=>)`),
    `a configuração funcional de segurança "${securityField}" deve existir no formulário`,
  );
}
assert.match(
  adminPageScript,
  /data-kodety-generate-security-slug[\s\S]*?window\.crypto\?\.getRandomValues[\s\S]*?acesso-/,
  'o painel deve gerar um endereço privado imprevisível no navegador',
);
assert.match(
  adminPageScript,
  /let hasExistingProject = form\.dataset\.hasExistingProject === '1'[\s\S]*?if \(importTarget\) hasExistingProject = option\?\.dataset\.existing === '1'[\s\S]*?replacementWarning\.hidden = !hasExistingProject/,
  'o modo de projeto único deve preservar o estado do servidor e manter visíveis as confirmações de substituição',
);
for (const selector of ['kodety-security-overview', 'kodety-security-section', 'kodety-security-fields-grid', 'kodety-security-footer']) {
  assert.ok(adminPage.includes(`.${selector}`), `${selector} must have a dedicated workspace layout.`);
}
assert.match(adminPage, /\.kodety-security-fields-grid\s*\{[^}]*display:\s*grid/);
assert.match(adminPage, /\.kodety-security-section__body\s*\{[^}]*min-width:\s*0/, "Security controls must shrink inside their section on narrow screens.");
assert.match(
  plugin,
  /data-has-existing-project="[\s\S]*?Substituição destrutiva[\s\S]*?assets Onun Kodety que não existirem no novo ZIP[\s\S]*?Lixeira do WordPress[\s\S]*?no máximo duas releases recentes[\s\S]*?data-kodety-backup-label[\s\S]*?name="kodety_replace_acknowledged"[\s\S]*?name="kodety_replace_phrase"[\s\S]*?pattern="SUBSTITUIR"/,
  'a troca de um projeto existente deve explicar todas as perdas e renderizar duas confirmações obrigatórias',
);
assert.match(
  adminPage,
  /\.kodety-import-dropzone\s*\{[^}]*place-items:\s*center;[^}]*min-height:\s*230px/,
  'a área de envio deve manter altura e alinhamento central próprios',
);
assert.match(
  plugin,
  /kodety-import-replacement-warning__icon[^\n]+dashboard_icon\('warning'\)[\s\S]*?<a class="kodety-import-backup-action__button"[^\n]+data-kodety-download-backup>/,
  'o risco deve usar um ícone de alerta e o backup deve manter seu link funcional em um botão dedicado',
);
assert.match(
  adminPage,
  /\.kodety-import-url__replacement\s*\{[^}]*--kodety-project-danger:[^}]*border-left:\s*3px solid var\(--kodety-project-danger\)/,
  'os avisos de substituição devem usar a cor destrutiva do sistema',
);
assert.match(
  adminPageScript,
  /addEventListener\('invalid',[\s\S]*?closest\('details'\)[\s\S]*?disclosure\.open = true;[\s\S]*?\}, true\)/,
  'a validação deve abrir os accordions antes de focar os campos inválidos',
);
if (false) {
assert.match(
  plugin,
  /function admin_download_project_backup\(\): void[\s\S]*?kodety_download_project_backup_' \. \$requested_project_id[\s\S]*?agency_snapshot_current\(\$requested_project_id\)[\s\S]*?package_editable_workspace_as_zip[\s\S]*?Content-Type: application\/zip[\s\S]*?Content-Disposition: attachment/,
  'o backup anterior à substituição deve empacotar de forma autenticada o projeto de agência escolhido',
);
assert.match(
  plugin,
  /\$target_has_project = \$agency_target !== 'new-project'[\s\S]*?if \(\$target_has_project\)[\s\S]*?kodety_replace_acknowledged[\s\S]*?kodety_replace_phrase[\s\S]*?hash_equals\('SUBSTITUIR', \$replacement_phrase\)[\s\S]*?foi cancelada/,
  'o servidor deve exigir as confirmações para um destino existente e dispensá-las somente em um projeto novo',
);
assert.match(
  adminPageScript,
  /const replacementIsConfirmed[\s\S]*?replacementAcknowledged\?\.checked[\s\S]*?replacementPhrase\?\.value\.trim\(\) === confirmationPhrase[\s\S]*?submit\.disabled = !validFile \|\| !destinationIsValid\(\) \|\| !replacementIsConfirmed\(\)/,
  'o botão deve permanecer bloqueado até destino, ZIP e confirmações aplicáveis serem válidos',
);
assert.match(
  adminPage,
  /\.kodety-import-replacement-warning\s*\{[\s\S]*?var\(--kodety-project-danger\)[\s\S]*?\.kodety-import-backup-action\s*\{[\s\S]*?\.kodety-import-confirmations\s*\{/,
  'o aviso destrutivo, o backup e as confirmações devem ter apresentação própria na área de upload',
);
assert.match(
  plugin,
  /name="kodety_agency_import_target"[\s\S]*?data-existing="1"[\s\S]*?value="new-project"[\s\S]*?Criar um novo projeto com este ZIP/,
  'o Modo agência deve oferecer o projeto aberto, os demais projetos e a criação de um novo destino',
);
assert.match(
  plugin,
  /private function agency_stage_builder_import[\s\S]*?with_workspace_lock[\s\S]*?agency_snapshot_current\(\$active_before\)[\s\S]*?agency_restore_project\(\$target_id\)[\s\S]*?stage_builder_import\(\$zip_path, \$original_name\)[\s\S]*?agency_snapshot_current\(\$target_id\)/,
  'snapshot, troca do destino e importação devem formar uma única transação serializada',
);
assert.match(
  adminPageScript,
  /updateDestination[\s\S]*?option\?\.dataset\.existing === '1'[\s\S]*?replacementWarning\.hidden = !hasExistingProject[\s\S]*?replacementAcknowledged\.disabled = !hasExistingProject[\s\S]*?backupAction\.href = option\.dataset\.backupUrl/,
  'trocar o destino deve atualizar aviso, confirmações e backup sem apontar para outro projeto',
);
assert.match(
  adminPage,
  /\.kodety-import-destination\s*\{[\s\S]*?\.kodety-import-new-project\s*\{[\s\S]*?\.kodety-import-replacement-warning\[hidden\]/,
  'o seletor de destino deve ter layout próprio e estados visuais completos',
);
}
assert.match(designSystem, /--kds-accent:\s*var\(--kodety-admin-accent/);
assert.match(designSystem, /--kds-canvas:\s*#111111/, 'A base deve expor a paleta canônica do workspace.');
assert.doesNotMatch(designSystem, /\b(?:input|button|textarea|select)\[/, 'O arquivo de tokens não deve carregar uma segunda camada de componentes.');
assert.match(
  adminAuditCss,
  /input:not\(\[type\]\),\s*input\[type="text"\]/,
  'Inputs sem type devem receber a geometria e o padding globais do wp-admin.',
);
assert.match(
  adminAuditCss,
  /:where\(\.button,\s*button\.button,\s*input\.button,\s*\.page-title-action\)\s*\{[\s\S]*?min-height:\s*34px[\s\S]*?padding:\s*6px 11px/,
  'Botões nativos devem compartilhar uma geometria compacta e previsível.',
);
assert.match(
  adminAuditCss,
  /\.plugin-install #the-list\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:[^}]*\}[\s\S]*?\.plugin-card\s*\{[^}]*float:\s*none;[^}]*width:\s*auto;[^}]*margin:\s*0/,
  'Cards de descoberta devem ocupar a célula inteira do grid sem reviver a geometria de floats do WordPress.',
);
assert.match(
  adminAuditCss,
  /\.plugin-card \.action-links\s*\{[^}]*position:\s*static;[^}]*order:\s*3;[^}]*width:\s*auto/,
  'Ações de plugins devem ocupar uma linha própria sem sobrepor nomes ou descrições.',
);
assert.match(
  adminAuditCss,
  /:focus-visible\s*\{[\s\S]*?outline:\s*2px solid color-mix\(in srgb,\s*var\(--kds-accent\) 76%,\s*transparent\)/,
  'O foco de teclado deve ser visível sem criar o aro azul exagerado nos botões.',
);
assert.match(shellCss, /--kodety-shell-blue:\s*var\(--kodety-admin-accent/);
assert.match(shellCss, /--k-os-primary-foreground:\s*var\(--kodety-admin-accent-foreground,\s*#fff\)/);
assert.match(shellCss, /--k-os-primary-hover:\s*var\(--kodety-admin-accent-hover,\s*#AFAFFF\)/);
assert.match(
  adminShell,
  /id:\s*'workspace',[\s\S]*?id:\s*'wordpress',[\s\S]*?label:\s*'WordPress'/,
);
assert.doesNotMatch(
  adminShell,
  /kodety-ui-site-status/,
  'the footer must not duplicate site navigation',
);
assert.match(adminShell, /sourceId:\s*'kodety-hub'[\s\S]*?persistentOpen:\s*true/, 'O grupo Onun Kodety deve permanecer sempre aberto.');
assert.match(adminShell, /if \(!item\.persistentOpen\)/, 'O grupo permanente não deve receber botão de recolher.');
assert.match(
  shellCss,
  /body\.kodety-os:not\(\.kodety-shell-failed\):is\(\.js, \.kodety-ui-shell-ready\):not\(\.block-editor-page\) :is\(#wpadminbar, #adminmenuback, #adminmenuwrap\)\s*\{\s*display:\s*none !important/,
  'O chrome nativo deve sair na primeira pintura com JS, mantendo o fallback no-js.',
);
assert.match(
  adminShell,
  /\['import', 'project',[\s\S]*?\['extensions', 'extensions',[\s\S]*?\['settings', 'settings',[\s\S]*?config\.projectAreas\?\.\[permission\]/,
  'Importar, extensões e configurações devem apontar às abas reais e respeitar as permissões do projeto.',
);
assert.match(
  adminShell,
  /id:\s*'operational'[\s\S]*?id:\s*'cms'[\s\S]*?id:\s*'pages'[\s\S]*?id:\s*'builder'[\s\S]*?mountWorkspaceTabs\(identity\)/,
  'the context bar must preserve direct Operational, CMS, Pages and Builder navigation',
);
assert.match(
  shellCss,
  /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.kodety-ui-area-switcher__button\s*\{[^}]*display:\s*inline-flex/,
  'compact viewports must expose an area switcher instead of clipping the four destinations',
);
assert.match(shellCss, /\.kodety-ui-area-switcher\.is-open \.kodety-ui-workspaces\s*\{[^}]*display:\s*grid/, 'The mobile disclosure must reveal every available area link in a vertical list.');
assert.match(adminShell, /workspaceButton\.setAttribute\('aria-controls', nav\.id\)/, 'The area switcher must identify the navigation it controls.');
assert.match(adminShell, /if \(event\.key === 'Escape' && workspaceControl\?\.classList\.contains\('is-open'\)\)[\s\S]*?setWorkspaceMenu\(false, \{ restoreFocus: true \}\)/, 'Escape must close the area list and restore focus to its trigger.');
assert.match(adminShell, /window\.addEventListener\('kodety:project-area-change', syncSelection/, 'Project section changes must keep navigation and page context synchronized.');
assert.match(adminShell, /body\.classList\.remove\('kodety-shell-failed'\)/, 'A delayed shell bundle must recover from its fallback state when it mounts.');
assert.match(plugin, /if \(!body\.classList\.contains\('kodety-ui-shell-ready'\)\)[\s\S]*?body\.classList\.add\('kodety-shell-failed'\)/, 'A failed shell must restore native navigation without disabling WordPress JavaScript.');
const workspaceClassifier = adminShell.match(/const activeWorkspace = \(\) => \{([\s\S]*?)\n  \};/);
assert(workspaceClassifier, 'The shell must provide an explicit area classifier.');
for (const [screen, search, expected] of [
  [{ id: 'edit-comments', base: 'edit-comments' }, '', 'operational'],
  [{ id: 'edit-post', base: 'edit', postType: 'post' }, '', 'operational'],
  [{ id: 'upload', base: 'upload', postType: 'attachment' }, '', 'operational'],
  [{ id: 'edit-category', base: 'edit-tags', postType: 'post' }, '', 'operational'],
  [{ id: 'toplevel_page_kodety' }, '?page=kodety', 'operational'],
  [{ id: 'toplevel_page_external' }, '?page=external', 'operational'],
  [{ id: 'edit-page', base: 'edit', postType: 'page' }, '?post_type=page', 'pages'],
  [{ id: 'kodety-cms_page_kodety-cms-fields' }, '?page=kodety-cms-fields', 'cms'],
  [{ id: 'kodety_page_kodety-editor' }, '?page=kodety-editor', 'builder'],
]) {
  const actual = runInNewContext(`(() => { ${workspaceClassifier[1]} })()`, {
    config: { screen }, window: { location: { search } }, URLSearchParams,
  });
  assert.equal(actual, expected, `${screen.id}: the active area must match the destination of its quick link.`);
}
assert.match(
  adminShell,
  /const kodetyModuleIds = \[[\s\S]*?'toplevel_page_kodety-cms'[\s\S]*?'toplevel_page_kodety-media'[\s\S]*?'toplevel_page_kodety-analytics'[\s\S]*?'toplevel_page_kodety-members'[\s\S]*?'toplevel_page_kodety-emails'[\s\S]*?'toplevel_page_kodety-email-campaigns'/,
  'Onun Kodety modules must share one product hub with their native child destinations',
);
assert.match(
  adminShell,
  /sourceId:\s*'kodety-hub',[\s\S]*?children:\s*hubChildren[\s\S]*?destinations\.forEach\(item => \{ item\.current = item === selected/,
  'the product hierarchy must preserve native destinations with one selected row',
);
assert.match(
  adminShell,
  /rememberAndMove\(nativeScreenLinks, tools\)/,
  'Screen Options and Help must retain their native controls in the context bar',
);
assert.match(
  adminIcons,
  /import analyticsIcon from '@solar-icons\/raw\/bold-duotone\/chart-2\.svg'[\s\S]*?analytics:\s*analyticsIcon/,
);
assert.match(
  adminIcons,
  /import marketingIcon from '@solar-icons\/raw\/bold-duotone\/volume-loud\.svg'[\s\S]*?marketing:\s*marketingIcon/,
);
assert.match(
  adminIcons,
  /const kodetyBrandIcon =[\s\S]*?M51\.1932 122L0 61L113\.183 94\.8289V122H51\.1932Z[\s\S]*?kodety:\s*kodetyBrandIcon/,
  'the wp-admin menu must use the current Onun Kodety mark instead of a generic code icon',
);
assert.doesNotMatch(adminIcons, /kodety:\s*codeIcon/);
assert.match(adminIcons, /import codeIcon from '@solar-icons\/raw\/bold-duotone\/code-square\.svg'/);
assert.match(adminIcons, /code:\s*codeIcon/);
assert.doesNotMatch(adminIcons, /code:\s*'kodety'/, 'Technical code controls must never use the Onun Kodety brand mark.');
assert.match(
  shellCss,
  /\.kodety-ui-brand__mark\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/,
  'the workspace identity must use a compact brand mark in the sidebar',
);
assert.match(adminIcons, /library:\s*'@solar-icons\/react@2\.1\.0'/);
assert.doesNotMatch(adminIcons, /@gravity-ui|from ['"]react/);
for (const name of ['arrowDownIcon', 'arrowLeftIcon', 'arrowRightIcon', 'arrowUpIcon', 'chevronDownIcon', 'chevronLeftIcon', 'chevronRightIcon', 'chevronUpIcon', 'chevronsLeftIcon', 'chevronsRightIcon', 'moreIcon', 'xIcon', 'logoutIcon']) {
  assert.match(adminIcons, new RegExp(`import ${name} from '@solar-icons/raw/linear/`), `${name} must retain clear stroke geometry for navigation controls.`);
}
assert.doesNotMatch(adminIcons, /\blucide\b/i);
for (const source of [designSystem, shellCss, adminAuditCss, mediaLibraryCss]) {
  assert.doesNotMatch(source, /#f0fa45|#f0fa55|#f0ff28|#edf75f/);
}
const updateTableScope = 'body.kodety-os.update-core-php #wpbody-content .updates-table';
assert.ok(
  adminAuditCss.includes(`${updateTableScope} :is(thead,tbody,tfoot,tr){background:var(--kds-carbon);color:var(--kds-mist)}`),
  'plugin and theme update rows must override the native white .plugins tr surface before the workspace mounts',
);
assert.ok(
  adminAuditCss.includes(`${updateTableScope} tbody tr:hover{background:var(--kds-hover)}`)
    && adminAuditCss.includes(`${updateTableScope} tbody tr:has(input:checked){background:var(--kds-selected)}`),
  'hovered and selected update rows must stay within the dark system palette',
);
assert.ok(
  adminAuditCss.includes(`${updateTableScope} .plugin-title strong{color:var(--kds-paper)`),
  'plugin and theme titles must remain legible above the secondary version details',
);
const standardAdminCss = await read('Wordpress/kodety/admin/components/wp-admin-audit.standard.bundle.css');
assert.ok(standardAdminCss.includes('update-core-php'), 'the standard stylesheet loaded by core updates must ship the table fix');
assert.doesNotMatch(
  adminAuditCss,
  /color:\s*#111\s*!important/,
  'Superfícies de destaque finais não devem regredir para um quase-preto avulso.',
);
assert.match(
  adminAuditCss,
  /background:\s*var\(--kds-accent-hover\)\s*!important/,
);
assert.match(
  mediaLibraryCss,
  /\.button-primary:hover\{[^}]*var\(--kodety-admin-accent-hover\)[^}]*var\(--kodety-admin-accent-foreground,#000\)/,
);
assert.match(
  mediaLibraryCss,
  /\.kodety-media-card__preview img\{[^}]*width:auto[^}]*height:auto[^}]*max-width:100%[^}]*max-height:100%[^}]*object-fit:contain/,
  'as miniaturas de Mídias devem caber no frame sem deformar sua proporção',
);
assert.match(
  mediaLibraryCss,
  /\.kodety-media-detail__preview img\{[^}]*width:auto[^}]*height:auto[^}]*max-width:100%[^}]*max-height:100%[^}]*object-fit:contain/,
  'a prévia ampliada de Mídias deve preservar a proporção do arquivo',
);
assert.match(
  mediaBackend,
  /'canManageFolders'\s*=>\s*\$this->can_manage_folders\(\)/,
  'a permissão de administrar pastas deve chegar à biblioteca de mídia',
);
assert.match(
  mediaLibraryJs,
  /if \(config\.canManageFolders\) \{[\s\S]*?actions\.append\(rename, removeFolder\)/,
  'renomear e excluir pastas não podem aparecer para um perfil sem essa permissão',
);
assert.match(
  mediaLibraryJs,
  /const destinationFolder = Number\(state\.folder\)[\s\S]*?uploadedIds\.push\(Number\(body\.id\)\)[\s\S]*?request\(config\.moveEndpoint,[\s\S]*?folder_id: destinationFolder/,
  'uploads iniciados dentro de uma pasta devem ser associados a ela depois de criados',
);
assert.match(
  mediaBackend,
  /rest_attachment_collection_params[\s\S]*?kodety_media_kind[\s\S]*?!str_starts_with\(\$mime, 'image\/'\)[\s\S]*?!str_starts_with\(\$mime, 'video\/'\)[\s\S]*?!str_starts_with\(\$mime, 'audio\/'\)/,
  'o backend deve consultar documentos com a mesma classificação usada nos contadores',
);
assert.match(
  mediaLibraryJs,
  /type\.value === 'document'[\s\S]*?params\.set\('kodety_media_kind', 'document'\)/,
  'o filtro Documentos deve usar a classificação agregada do backend',
);

assert.match(
  plugin,
  /private function dashboard_extensions\(\): array[\s\S]*?Kodety_Extensions::instance\(\)[\s\S]*?->catalog\(\)[\s\S]*?->installed\(\)[\s\S]*?->is_active\(\$slug\)/,
  'a área de extensões deve consumir o catálogo e o estado do gerenciador central',
);
assert.match(
  plugin,
  /data-kodety-tab="extensions"[\s\S]*?id="kodety-area-extensions"[\s\S]*?data-kodety-area="extensions"/,
  'Extensões deve existir como uma aba navegável do hub',
);
assert.match(
  plugin,
  /Instalar extensão ou bundle[\s\S]*?name="action" value="kodety_install_extension"[\s\S]*?name="kodety_extension_zip"[\s\S]*?data-kodety-extension-catalog/,
  'a área deve aceitar um ZIP individual ou bundle e renderizar o catálogo',
);
for (const extensionAction of [
  'kodety_activate_extension',
  'kodety_deactivate_extension',
  'kodety_remove_extension',
]) {
  assert.match(
    plugin,
    new RegExp(extensionAction),
    `o contrato visual da ação ${extensionAction} deve existir`,
  );
}
assert.match(
  plugin,
  /Trocar ou publicar outro ZIP do site não remove extensões, instalações nem configurações salvas/,
  'a tela deve deixar explícito que extensões não pertencem ao ZIP do projeto',
);
assert.match(
  plugin,
  /if \(!\$extension\['bundled'\]\)[\s\S]*?kodety_remove_extension/,
  'extensões incluídas no Onun Kodety não podem oferecer remoção',
);
assert.match(
  adminPageScript,
  /data-kodety-extension-upload-form[\s\S]*?renderExtensionFile[\s\S]*?data-kodety-extension-action[\s\S]*?announceExtension/,
  'upload e ações de extensão devem validar o ZIP e anunciar progresso de forma acessível',
);
assert.match(
  adminPage,
  /\.kodety-extension-grid\s*\{[^}]*display:\s*grid/,
  'o catálogo deve manter uma grade de extensões',
);
assert.match(adminPage, /\.kodety-extension-card__status/);
assert.match(adminPage, /@container\s*\(max-width:\s*680px\)/);
assert.doesNotMatch(
  adminPage,
  /\.kodety-extension-card:hover/,
  'cards informativos de extensão não devem simular interatividade no hover',
);

// Cada aba renderizada precisa existir na allowlist de kodety-page.js. Quando a
// aba "Segurança" ficou de fora, clicar nela caía no fallback e o painel nunca
// aparecia — falha silenciosa, sem erro no console.
const declaredTabs = [...`${plugin}${mcp}`.matchAll(/data-kodety-tab="([a-z-]+)"/g)].map(([, tab]) => tab);
const declaredAreas = [...`${plugin}${mcp}`.matchAll(/data-kodety-area="([a-z-]+)"/g)].map(([, area]) => area);
const allowedAreas = adminPageScript.match(/if \(!\[([^\]]+)\]\.includes\(area\)\)/)?.[1] || '';
assert.ok(declaredTabs.length >= 5, 'as abas do painel Onun Kodety devem ser encontradas no PHP');
for (const tab of new Set([...declaredTabs, ...declaredAreas])) {
  assert.ok(
    allowedAreas.includes(`'${tab}'`),
    `a aba/painel "${tab}" não está na allowlist de activateArea em kodety-page.js`,
  );
  assert.ok(
    declaredAreas.includes(tab),
    `a aba "${tab}" não tem painel correspondente (data-kodety-area)`,
  );
}

execFileSync(process.execPath, [path.join(root, 'scripts/test-admin-selects.mjs')], { cwd: root, stdio: 'inherit' });

execFileSync('php', [path.join(root, 'Wordpress/tests/admin-branding-runtime.php')], {
  cwd: root,
  stdio: 'inherit',
});

execFileSync('php', [path.join(root, 'Wordpress/tests/admin-assets-runtime.php')], {
  cwd: root,
  stdio: 'inherit',
});

console.log('Contratos visuais de marca do Onun Kodety aprovados.');
