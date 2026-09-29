import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendPath = path.join(root, 'Wordpress/kodety/includes/class-kodety-search-console.php');
const bootstrapPath = path.join(root, 'Wordpress/kodety/kodety.php');
const uninstallPath = path.join(root, 'Wordpress/kodety/uninstall.php');
const shellPath = path.join(root, 'Wordpress/kodety/templates/editor-shell.php');
const componentPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlSearchConsoleSettings.tsx',
);
const settingsPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx',
);
const settingsHostPath = path.join(
  root,
  'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx',
);
const editorTypesPath = path.join(root, 'lib/html-editor/editor-types.ts');

const [backend, bootstrap, uninstall, shell, component, settings, settingsHost, editorTypes] =
  await Promise.all([
    readFile(backendPath, 'utf8'),
    readFile(bootstrapPath, 'utf8'),
    readFile(uninstallPath, 'utf8'),
    readFile(shellPath, 'utf8'),
    readFile(componentPath, 'utf8'),
    readFile(settingsPath, 'utf8'),
    readFile(settingsHostPath, 'utf8'),
    readFile(editorTypesPath, 'utf8'),
  ]);

function assertContainsAll(source, needles, message) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${message}: ausente ${needle}`);
  }
}

function routeWindow(route) {
  const suffix = route.replace('/seo/search-console', '');
  const markers = [
    `'${route}'`,
    `"${route}"`,
    ...(suffix ? [`'${suffix}'`, `"${suffix}"`] : []),
  ];
  const index = Math.max(...markers.map(marker => backend.indexOf(marker)));
  assert.notEqual(index, -1, `a rota ${route} deve ser registrada`);
  return backend.slice(Math.max(0, index - 180), index + 1_600);
}

function phpIntegerConstant(name) {
  const match = backend.match(new RegExp(`(?:private|public)\\s+const\\s+${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `a constante ${name} deve tornar o limite auditável`);
  return Number(match[1].replaceAll('_', ''));
}

function phpStringConstant(name) {
  const match = backend.match(new RegExp(`(?:private|public)\\s+const\\s+${name}\\s*=\\s*(['"])([^'"]+)\\1`));
  assert.ok(match, `a constante ${name} deve ser uma string auditável`);
  return match[2];
}

assert.match(backend, /final\s+class\s+Kodety_Search_Console\b/);
assert.match(bootstrap, /class-kodety-search-console\.php/);
assert.match(bootstrap, /Kodety_Search_Console::instance\(\)/);
assertContainsAll(
  uninstall,
  [
    'kodety_view_search_console',
    'kodety_manage_search_console',
    'kodety_search_console_daily_sync',
    'kodety_search_console_retry_sync',
    'kodety_search_console_access_token_',
    'kodety_search_console_pages',
  ],
  'a desinstalação deve remover capabilities, trabalhos e dados efêmeros do conector',
);

for (const suffix of ['', '/status', '/connect', '/oauth-client', '/property', '/sync']) {
  const route = `/seo/search-console${suffix}`;
  const window = routeWindow(route);
  assert.match(
    window,
    /permission_callback\s*['"]?\s*=>\s*(?!['"]__return_true['"])/,
    `${route} deve ter permission_callback privada`,
  );
  assert.doesNotMatch(window, /permission_callback\s*['"]?\s*=>\s*['"]__return_true['"]/);
}

assert.match(routeWindow('/seo/search-console'), /DELETE|DELETABLE/);
assert.match(routeWindow('/seo/search-console/status'), /GET|READABLE/);
const oauthClientRoute = routeWindow('/seo/search-console/oauth-client');
assert.match(oauthClientRoute, /GET|READABLE/);
assert.match(oauthClientRoute, /POST|CREATABLE|EDITABLE/);
assert.match(oauthClientRoute, /DELETE|DELETABLE/);
assertContainsAll(
  oauthClientRoute,
  ['rest_get_oauth_client', 'rest_save_oauth_client', 'rest_delete_oauth_client'],
  'a configuração OAuth deve ser gerenciada pelo backend do WordPress',
);
for (const route of [
  '/seo/search-console/connect',
  '/seo/search-console/property',
  '/seo/search-console/sync',
]) {
  assert.match(routeWindow(route), /POST|CREATABLE|EDITABLE/);
}

assert.match(backend, /CAP_(?:VIEW|MANAGE)[\s\S]{0,180}current_user_can|current_user_can\([\s\S]{0,180}CAP_(?:VIEW|MANAGE)/);
assert.match(
  backend,
  /Kodety_Edition::has\(\s*['"]advancedSeo['"]\s*\)/,
  'o gate Pro deve existir no servidor, não apenas na projeção da interface',
);
assert.match(backend, /get_header\(\s*['"]X-WP-Nonce['"]\s*\)/i);
assert.match(backend, /wp_verify_nonce\([\s\S]{0,180}['"]wp_rest['"]\s*\)/);
assert.match(
  backend,
  /function\s+rest_save_oauth_client[\s\S]{0,300}!\$this->licensed\(\)/,
  'salvar o cliente OAuth deve continuar protegido pelo recurso Pro',
);
const getOAuthClientStart = backend.indexOf('public function rest_get_oauth_client');
const getOAuthClientEnd = backend.indexOf('public function rest_save_oauth_client', getOAuthClientStart);
assert.ok(getOAuthClientStart >= 0 && getOAuthClientEnd > getOAuthClientStart, 'a leitura dos metadados OAuth deve existir');
assert.doesNotMatch(
  backend.slice(getOAuthClientStart, getOAuthClientEnd),
  /!\$this->licensed\(\)/,
  'metadados redigidos devem continuar consultáveis para permitir cleanup após o Pro expirar',
);
assert.match(
  oauthClientRoute,
  /rest_get_oauth_client['"]\s*\][\s\S]{0,260}permission_callback[\s\S]{0,120}oauth_client_(?:metadata|read|get)_permission/,
  'GET de metadados deve usar a permissão administrativa que não exige licença',
);
assert.match(
  backend,
  /function\s+oauth_client_(?:metadata|read|get)_permission[\s\S]{0,300}authorize_rest\(\s*\$request\s*,\s*true\s*,\s*false\s*\)/,
  'GET redigido deve exigir autenticação, capability e nonce, mas não licença',
);
assert.match(
  backend,
  /function\s+oauth_client_delete_permission[\s\S]{0,300}authorize_rest\(\s*\$request\s*,\s*true\s*,\s*false\s*\)/,
  'a limpeza do segredo OAuth deve continuar disponível ao administrador sem licença',
);

assertContainsAll(
  backend,
  [
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    'https://www.googleapis.com/webmasters/v3',
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ],
  'os destinos OAuth/Search Console devem permanecer fixos no servidor',
);
assert.doesNotMatch(
  backend,
  /https:\/\/www\.googleapis\.com\/auth\/webmasters(?!\.readonly)/,
  'a importação não precisa do escopo de escrita',
);

assert.match(backend, /random_bytes\(/, 'state e verifier precisam de entropia criptográfica');
assert.match(backend, /code_verifier/);
assert.match(backend, /code_challenge/);
assert.match(backend, /code_challenge_method[\s\S]{0,80}S256/);
assert.match(backend, /hash\(\s*['"]sha256['"]/i);
assert.match(
  backend,
  /kodety_search_console_oauth_broker_exchange[\s\S]{0,600}['"]codeVerifier['"]\s*=>\s*\$record\s*\[\s*['"]verifier['"]\s*\]/,
  'o broker precisa receber o verifier servidor-servidor para concluir o PKCE S256',
);
assert.match(backend, /hash_equals\(/, 'state OAuth deve usar comparação em tempo constante');
assert.match(backend, /(?:add_option|set_transient)\(/, 'state/verifier devem ficar somente no servidor e expirar');
assert.match(backend, /(?:delete_option|delete_transient)\(/, 'state OAuth deve ser single-use');
assert.match(
  backend,
  /get_current_user_id\(\)/,
  'state OAuth deve ser vinculado ao administrador que iniciou a conexão',
);

assert.match(backend, /aes-256-gcm/i, 'tokens OAuth devem ser cifrados e autenticados em repouso');
assert.match(backend, /openssl_encrypt\(/);
assert.match(backend, /openssl_decrypt\(/);
assert.match(backend, /wp_salt\(\s*['"]auth['"]\s*\)/);
assert.match(
  backend,
  /(?:access_token|refresh_token)/,
  'a integração precisa persistir o token recebido sem expô-lo ao cliente',
);

const oauthClientOption = phpStringConstant('OPTION_OAUTH_CLIENT');
const oauthStatePrefix = phpStringConstant('OPTION_OAUTH_PREFIX');
const oauthClientRevisionOption = phpStringConstant('OPTION_OAUTH_CLIENT_REVISION');
const connectionRevisionPrefix = phpStringConstant('OPTION_CONNECTION_REVISION_PREFIX');
assert.equal(
  oauthClientOption,
  'kodety_search_console_client_credentials',
  'o cliente OAuth deve usar a opção durável acordada para configuração no WordPress',
);
assert.ok(
  !oauthClientOption.startsWith(oauthStatePrefix),
  'a configuração durável do cliente OAuth não pode usar o prefixo apagado como state efêmero',
);
assert.ok(
  uninstall.includes(oauthClientOption),
  'o purge explícito da desinstalação deve conhecer a opção do cliente OAuth',
);
assert.ok(
  uninstall.includes(oauthClientRevisionOption) && uninstall.includes(connectionRevisionPrefix),
  'o purge da desinstalação deve incluir a revisão global e as revisões de conexão por site',
);

const saveOAuthClientStart = backend.indexOf('public function rest_save_oauth_client');
const saveOAuthClientEnd = backend.indexOf('public function rest_delete_oauth_client', saveOAuthClientStart);
assert.ok(saveOAuthClientStart >= 0 && saveOAuthClientEnd > saveOAuthClientStart, 'o salvamento OAuth deve existir');
const saveOAuthClientHandler = backend.slice(saveOAuthClientStart, saveOAuthClientEnd);
assert.match(
  saveOAuthClientHandler,
  /callback_url_usable\(\)/,
  'o backend não deve salvar um cliente OAuth local com callback público inseguro',
);
assert.match(
  saveOAuthClientHandler,
  /\$client_id\s*=\s*\$submitted_client_id\s*!==\s*['"]['"]\s*\?\s*\$submitted_client_id\s*:\s*\$current_client_id[\s\S]{0,240}\$client_secret\s*=\s*\$submitted_client_secret\s*!==\s*['"]['"]\s*\?\s*\$submitted_client_secret\s*:\s*\$current_client_secret/,
  'campos vazios numa atualização devem preservar o Client ID e o Client Secret atuais',
);
assert.match(saveOAuthClientHandler, /encrypt_secret\(\s*\$client_secret\s*,\s*['"]oauth-client-secret['"]\s*\)/);
assert.match(saveOAuthClientHandler, /['"]client_secret['"]\s*=>\s*\$protected/);
assert.doesNotMatch(
  saveOAuthClientHandler,
  /['"]client_secret['"]\s*=>\s*\$client_secret/,
  'o segredo em claro nunca deve ser gravado na opção do WordPress',
);
assert.match(
  saveOAuthClientHandler,
  /update_option\(\s*self::OPTION_OAUTH_CLIENT\s*,\s*\$next\s*,\s*false\s*\)/,
  'a credencial cifrada não deve ser carregada automaticamente em toda requisição WordPress',
);

function assertClientRevisionMutationUnderLock(handler, label) {
  const lockKey = handler.indexOf('oauth_client_lock_key()');
  const acquire = handler.indexOf('acquire_state_lock($lock_key)', lockKey);
  const bump = handler.indexOf('bump_oauth_client_revision()', acquire);
  const finallyIndex = handler.indexOf('finally', bump);
  const release = handler.indexOf('release_state_lock($lock_key, $owner)', finallyIndex);
  assert.ok(
    lockKey >= 0 && lockKey < acquire && acquire < bump && bump < finallyIndex && finallyIndex < release,
    `${label} deve incrementar a revisão global sob o mesmo lock e liberá-lo em finally`,
  );
}

assertClientRevisionMutationUnderLock(saveOAuthClientHandler, 'salvar o cliente OAuth');

const deleteOAuthClientStart = saveOAuthClientEnd;
const deleteOAuthClientEnd = backend.indexOf('public function rest_connect', deleteOAuthClientStart);
assert.ok(deleteOAuthClientEnd > deleteOAuthClientStart, 'a remoção do cliente OAuth deve existir');
const deleteOAuthClientHandler = backend.slice(deleteOAuthClientStart, deleteOAuthClientEnd);
assertClientRevisionMutationUnderLock(deleteOAuthClientHandler, 'remover o cliente OAuth');

const publicOAuthClientStart = backend.indexOf('private function public_oauth_client_configuration');
const publicOAuthClientEnd = backend.indexOf('private function validate_oauth_client_values', publicOAuthClientStart);
assert.ok(publicOAuthClientStart >= 0 && publicOAuthClientEnd > publicOAuthClientStart, 'a projeção OAuth redigida deve existir');
const publicOAuthClient = backend.slice(publicOAuthClientStart, publicOAuthClientEnd);
assertContainsAll(
  publicOAuthClient,
  [
    'configured',
    'managedExternally',
    'clientIdHint',
    'hasClientSecret',
    'callbackUrl',
    'callbackUsable',
    'kodety_search_console_oauth_broker_configured',
  ],
  'o payload OAuth deve expor apenas metadados úteis ao formulário',
);
assert.match(publicOAuthClient, /redact_client_id\(/, 'o Client ID deve ser projetado apenas como dica redigida');
assert.doesNotMatch(
  publicOAuthClient,
  /['"](?:clientSecret|client_secret)['"]\s*=>/,
  'o endpoint de configuração nunca deve devolver o Client Secret',
);
assert.match(
  backend,
  /function\s+oauth_broker_configured[\s\S]{0,800}kodety_search_console_oauth_broker_configured[\s\S]{0,800}has_filter\(\s*['"]kodety_search_console_oauth_broker_authorization_url['"]\s*\)/,
  'o status deve aceitar sinalização explícita do broker ou detectar seu hook de autorização',
);
assert.match(
  backend,
  /function\s+stored_oauth_client_credentials[\s\S]{0,1200}decrypt_secret\([\s\S]{0,180}['"]oauth-client-secret['"]/,
  'somente o backend deve decifrar o Client Secret salvo',
);

const connectOAuthStart = backend.indexOf('public function rest_connect');
const connectOAuthEnd = backend.indexOf('public function rest_select_property', connectOAuthStart);
assert.ok(connectOAuthStart >= 0 && connectOAuthEnd > connectOAuthStart, 'o início da autorização OAuth deve existir');
const connectOAuthHandler = backend.slice(connectOAuthStart, connectOAuthEnd);
assert.match(connectOAuthHandler, /kodety_search_console_oauth_broker_authorization_url/);
const callbackGuardIndex = connectOAuthHandler.indexOf('callback_url_usable()');
const oauthStateIndex = connectOAuthHandler.indexOf('create_oauth_state', callbackGuardIndex);
const brokerAuthorizationIndex = connectOAuthHandler.indexOf(
  'kodety_search_console_oauth_broker_authorization_url',
  oauthStateIndex,
);
assert.ok(
  callbackGuardIndex >= 0
    && callbackGuardIndex < oauthStateIndex
    && oauthStateIndex < brokerAuthorizationIndex,
  'callback inseguro deve bloquear antes de criar state ou iniciar OAuth local/broker',
);

const resolveOAuthClientStart = backend.indexOf('private function resolve_oauth_client_credentials');
const resolveOAuthClientEnd = backend.indexOf('private function public_oauth_client_configuration', resolveOAuthClientStart);
assert.ok(resolveOAuthClientStart >= 0 && resolveOAuthClientEnd > resolveOAuthClientStart, 'a precedência OAuth deve ser explícita');
const resolveOAuthClient = backend.slice(resolveOAuthClientStart, resolveOAuthClientEnd);
assertContainsAll(
  resolveOAuthClient,
  [
    'KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_ID',
    'KODETY_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET',
    'stored_oauth_client_credentials',
    'kodety_search_console_oauth_credentials',
    'managed_externally',
  ],
  'wp-config e filtros de implantação devem prevalecer sobre a opção editável',
);
assert.ok(
  resolveOAuthClient.indexOf('$constant_override') < resolveOAuthClient.indexOf('stored_oauth_client_credentials')
    && resolveOAuthClient.indexOf('stored_oauth_client_credentials') < resolveOAuthClient.indexOf("apply_filters('kodety_search_console_oauth_credentials'"),
  'constantes devem substituir o fallback do WordPress e filtros devem ser o override final',
);

assert.ok(
  phpIntegerConstant('SEARCH_ANALYTICS_PAGE_SIZE') <= 25_000,
  'Search Analytics deve respeitar o rowLimit máximo de 25 mil',
);
assert.ok(
  phpIntegerConstant('SEARCH_ANALYTICS_MAX_ROWS') <= 50_000,
  'a coleta diária não pode presumir mais de 50 mil linhas expostas por tipo',
);
assert.ok(
  phpIntegerConstant('INSPECTION_MAX_PER_DAY') <= 2_000,
  'URL Inspection deve ficar abaixo do teto oficial de 2 mil por propriedade/dia',
);
assert.ok(
  phpIntegerConstant('INSPECTION_MAX_PER_SYNC') <= 600,
  'um sync não pode ultrapassar o teto oficial de 600 inspeções por minuto',
);
assert.match(backend, /wp_next_scheduled\(/);
assert.match(backend, /wp_schedule_(?:single_)?event\(/);
assert.match(backend, /wp_clear_scheduled_hook\(/);
assert.match(backend, /OPTION_SYNC_LOCK_PREFIX/);
assert.match(backend, /function\s+acquire_sync_lock[\s\S]{0,1200}add_option\(/);
assert.match(backend, /function\s+release_sync_lock[\s\S]{0,600}hash_equals\([\s\S]{0,300}delete_option\(/);
assert.match(backend, /OPTION_STATE_LOCK_PREFIX/);
assert.match(backend, /function\s+acquire_state_lock[\s\S]{0,1400}add_option\(/);
assert.match(backend, /function\s+release_state_lock[\s\S]{0,700}hash_equals\([\s\S]{0,300}delete_option\(/);
assert.match(
  backend,
  /function\s+cleanup_ephemeral_options[\s\S]{0,1400}OPTION_STATE_LOCK_PREFIX/,
  'deactivate deve remover locks curtos de estado',
);
assert.ok(
  uninstall.includes('kodety_search_console_state_lock_'),
  'uninstall deve remover locks curtos de estado mesmo quando preserva relatórios',
);
assert.match(
  backend,
  /function\s+rest_sync[\s\S]{0,2400}acquire_state_lock\([\s\S]{0,1800}next_sync_generation\([\s\S]{0,1200}202\s*\)/,
  'refresh manual deve enfileirar uma geração atomicamente e continuar async 202',
);
assert.match(
  backend,
  /function\s+rest_select_property[\s\S]{0,5000}acquire_state_lock\([\s\S]{0,2200}next_sync_generation\(/,
  'troca de propriedade deve criar geração nova sob o lock curto de estado',
);
assert.match(
  backend,
  /function\s+finish_sync_snapshot[\s\S]{0,2600}current_generation\s*===\s*\$generation[\s\S]{0,800}hash_equals\([\s\S]{0,1800}clear_retries\(/,
  'worker só pode finalizar e limpar retries da geração/propriedade que capturou',
);

const disconnectStart = backend.indexOf('public function rest_disconnect');
const disconnectEnd = backend.indexOf('public function handle_oauth_callback', disconnectStart);
assert.ok(disconnectStart >= 0 && disconnectEnd > disconnectStart, 'o handler de disconnect deve existir');
const disconnectHandler = backend.slice(disconnectStart, disconnectEnd);
assert.doesNotMatch(
  disconnectHandler,
  /!\$this->licensed\(\)/,
  'expiração da licença não pode impedir o administrador de apagar a credencial Google',
);
assert.match(
  disconnectHandler,
  /acquire_sync_lock\(/,
  'disconnect deve adquirir o lock do site antes de revogar ou apagar credenciais',
);
assert.match(
  disconnectHandler,
  /finally\s*\{[\s\S]*release_sync_lock\(/,
  'disconnect deve liberar somente o lock que adquiriu, inclusive em falhas',
);
assert.doesNotMatch(
  disconnectHandler,
  /delete_option\(\s*self::OPTION_SYNC_LOCK_PREFIX/,
  'disconnect nunca deve apagar diretamente um lock que pode pertencer ao worker',
);
const disconnectSiteLock = disconnectHandler.indexOf("acquire_state_lock($site['key'])");
const disconnectRevisionBump = disconnectHandler.indexOf("bump_connection_revision($site['key'])");
const disconnectCredentialDelete = disconnectHandler.indexOf('OPTION_CREDENTIAL_PREFIX', disconnectRevisionBump);
assert.ok(
  disconnectSiteLock >= 0
    && disconnectSiteLock < disconnectRevisionBump
    && disconnectRevisionBump < disconnectCredentialDelete,
  'disconnect deve invalidar a revisão da conexão sob o lock do site antes de apagar credenciais',
);

assertContainsAll(
  backend,
  [
    'OPTION_CREDENTIAL_PREFIX',
    'OPTION_SITE_PREFIX',
    'OPTION_INSPECTION_USAGE_PREFIX',
    'TRANSIENT_ACCESS_TOKEN_PREFIX',
  ],
  'credenciais, estado, quota e cache devem ser particionados por site',
);
assert.match(backend, /active_project_site_url\(/);
assert.match(
  backend,
  /function\s+credential\s*\([^)]*\$site[^)]*\)[\s\S]{0,500}OPTION_CREDENTIAL_PREFIX\s*\.\s*\$site\s*\[\s*['"]key['"]\s*\]/,
);
assert.match(
  backend,
  /function\s+(?:cached_access_token|cache_access_token)\s*\([^)]*\$site[^)]*\)[\s\S]{0,700}TRANSIENT_ACCESS_TOKEN_PREFIX\s*\.\s*\$site\s*\[\s*['"]key['"]\s*\]/,
);
assert.match(
  backend,
  /function\s+reserve_inspection_slots\s*\([^)]*\$site[^)]*\)[\s\S]{0,700}OPTION_INSPECTION_USAGE_PREFIX\s*\.\s*\$site\s*\[\s*['"]key['"]\s*\]/,
);
assert.match(
  backend,
  /function\s+create_oauth_state[\s\S]{0,1800}['"]site_key['"]\s*=>\s*\$site\s*\[\s*['"]key['"]\s*\]/,
  'state OAuth deve permanecer vinculado ao site que iniciou a conexão',
);
const createOAuthStateStart = backend.indexOf('private function create_oauth_state');
const createOAuthStateEnd = backend.indexOf('private function consume_oauth_state', createOAuthStateStart);
assert.ok(createOAuthStateStart >= 0 && createOAuthStateEnd > createOAuthStateStart, 'a criação do state OAuth deve existir');
const createOAuthStateHandler = backend.slice(createOAuthStateStart, createOAuthStateEnd);
assert.match(
  createOAuthStateHandler,
  /['"]oauth_client_revision['"]\s*=>\s*\$this->oauth_client_revision\(\)/,
  'state deve registrar a revisão global do cliente OAuth',
);
assert.match(
  createOAuthStateHandler,
  /['"]connection_revision['"]\s*=>\s*\$this->connection_revision\(\s*\$site\s*\[\s*['"]key['"]\s*\]\s*\)/,
  'state deve registrar a revisão da conexão do site',
);

assert.match(
  backend,
  /function\s+oauth_state_revisions_current[\s\S]{0,900}oauth_client_revision[\s\S]{0,500}connection_revision[\s\S]{0,500}oauth_state_superseded/,
  'a validação do callback deve comparar as revisões global e do site e falhar fechada',
);

const oauthCallbackStart = backend.indexOf('public function handle_oauth_callback');
const oauthCallbackEnd = backend.indexOf('public function cron_sync', oauthCallbackStart);
assert.ok(oauthCallbackStart >= 0 && oauthCallbackEnd > oauthCallbackStart, 'o callback OAuth deve existir');
const oauthCallbackHandler = backend.slice(oauthCallbackStart, oauthCallbackEnd);
const callbackGlobalLock = oauthCallbackHandler.indexOf('acquire_state_lock($global_lock_key)');
const callbackSiteLock = oauthCallbackHandler.indexOf("acquire_state_lock($site['key'])", callbackGlobalLock);
const callbackRevisionCheck = oauthCallbackHandler.indexOf('oauth_state_revisions_current($record, $site)', callbackSiteLock);
const callbackSaveCredential = oauthCallbackHandler.indexOf('save_credential($site, $credential)', callbackRevisionCheck);
const callbackSaveState = oauthCallbackHandler.indexOf('save_site_state($site, $site_state)', callbackSaveCredential);
assert.ok(
  callbackGlobalLock >= 0
    && callbackGlobalLock < callbackSiteLock
    && callbackSiteLock < callbackRevisionCheck
    && callbackRevisionCheck < callbackSaveCredential
    && callbackSaveCredential < callbackSaveState,
  'callback deve adquirir lock global→site e validar revisões antes de persistir credencial ou estado',
);
const callbackFinally = oauthCallbackHandler.indexOf('finally', callbackRevisionCheck);
const callbackReleaseSite = oauthCallbackHandler.indexOf("release_state_lock($site['key'], $state_owner)", callbackFinally);
const callbackReleaseGlobal = oauthCallbackHandler.indexOf('release_state_lock($global_lock_key, $global_owner)', callbackReleaseSite);
assert.ok(
  callbackFinally >= 0 && callbackFinally < callbackReleaseSite && callbackReleaseSite < callbackReleaseGlobal,
  'callback deve liberar o lock do site e depois o global dentro de finally',
);
assert.match(
  oauthCallbackHandler,
  /\$revision_error\s*=\s*\$this->oauth_state_revisions_current\([\s\S]{0,240}\$persistence_error\s*=\s*\$revision_error/,
  'state superado deve seguir o caminho de erro de persistência',
);
assert.match(
  oauthCallbackHandler,
  /if\s*\(\s*is_wp_error\(\$persistence_error\)\s*\)[\s\S]{0,300}delete_transient\([\s\S]{0,220}if\s*\(\s*\$refresh_token\s*!==\s*['"]['"]\s*\)\s*\$this->revoke_token\(\s*\$refresh_token\s*\)\s*;[\s\S]{0,100}else\s+\$this->revoke_token\(\s*\$access_token\s*\)/,
  'callback superado deve limpar o access token local e revogar o refresh/access token retornado pelo Google',
);

assert.match(backend, /dbDelta\(/);
assert.match(backend, /kodety_search_console_(?:pages|urls)/);
assert.match(backend, /CREATE\s+TABLE[\s\S]{0,2500}\burl\b/i);
assert.match(backend, /CREATE\s+TABLE[\s\S]{0,2500}\bsite_key\b/i);
assert.match(backend, /UNIQUE\s+KEY[\s\S]{0,300}\bsite_key\b/i);
for (const [column, alternatives] of [
  ['clicks', 'clicks'],
  ['impressions', 'impressions'],
  ['ctr', 'ctr'],
  ['position', 'position'],
  ['inspection status', '(?:inspection_status|inspection_verdict|coverage_state)'],
  ['Google canonical', '(?:google_canonical|canonical_google)'],
  ['last sync timestamp', '(?:last_synced|synced_at|updated_at)'],
]) {
  assert.match(
    backend,
    new RegExp(`CREATE\\s+TABLE[\\s\\S]{0,2500}\\b${alternatives}\\b`, 'i'),
    `a tabela de páginas deve persistir ${column}`,
  );
}

assert.match(component, /export\s+function\s+HtmlSearchConsoleSettings|export\s+const\s+HtmlSearchConsoleSettings/);
assert.match(component, /X-WP-Nonce/);
assert.match(component, /credentials\s*:\s*['"]same-origin['"]/);
assert.match(component, /cache\s*:\s*['"]no-store['"]/);
assertContainsAll(
  component,
  ["'status'", "'connect'", "'oauth-client'", "'property'", "'sync'"],
  'o cliente deve consumir somente as subrotas publicadas pelo backend',
);
assert.match(component, /method\s*:\s*['"]DELETE['"]/);
assert.match(component, /method\s*:\s*['"]POST['"][\s\S]{0,180}clientId[\s\S]{0,120}clientSecret/);
assert.match(component, /type\s*=\s*['"]password['"]/);
assert.match(component, /autoComplete\s*=\s*['"]new-password['"]/);
assert.doesNotMatch(component, /(?:localStorage|sessionStorage)/, 'segredos OAuth não podem ser persistidos no navegador');
assert.match(component, /navigator\.clipboard\.writeText\(\s*oauthClient\.callbackUrl\s*\)/);
assert.match(
  component,
  /readOnly[\s\S]{0,220}(?:callbackUrl|URI de redirecionamento OAuth)|(?:callbackUrl|URI de redirecionamento OAuth)[\s\S]{0,220}readOnly/,
  'o callback calculado pelo WordPress deve ficar visível e copiável',
);
assert.match(
  component,
  /managedExternally[\s\S]{0,500}(?:servidor|editable)|editable[\s\S]{0,500}managedExternally/,
  'configuração fornecida por constante, filtro ou broker não pode parecer editável no Builder',
);
const callbackDisabledControls = component.match(
  /disabled=\{[^}\n]*oauthClient\??\.callbackUsable\s*===\s*false[^}\n]*\}/g,
) || [];
assert.ok(
  callbackDisabledControls.length >= 4,
  'callback inseguro deve desabilitar Client ID, Client Secret, salvar e conectar',
);
assert.match(component, /authUrl|authorizationUrl/);
assert.match(component, /window\.location|window\.open/);
assert.match(component, /property/i);
for (const metric of ['clicks', 'impressions', 'ctr', 'position']) {
  assert.match(component, new RegExp(`\\b${metric}\\b`, 'i'), `a tabela deve renderizar ${metric}`);
}
assert.match(component, /inspection|indexStatus/i, 'a tabela deve mostrar o diagnóstico de indexação');
assert.match(component, /indexIssue/, 'cobertura/indexação deve ser separada de divergência canônica');
assert.match(
  component,
  /page\s*<=\s*totalPages[\s\S]{0,240}setPage\(totalPages\)[\s\S]{0,120}loadStatus\(undefined,\s*totalPages\)/,
  'clamp de página deve avançar o cursor antes da rede para não repetir infinitamente em falhas',
);
assert.match(component, /sync/i, 'a interface deve permitir sincronização explícita');
assert.match(
  component,
  /const\s+busy\s*=\s*operation\s*!==\s*null\s*\|\|\s*oauthLoading/,
  'operações e leitura da configuração OAuth devem bloquear submissões concorrentes',
);
assert.match(
  component,
  /const\s+cleanupOperation\s*=\s*nextOperation\s*===\s*['"]disconnect['"]\s*\|\|\s*nextOperation\s*===\s*['"]oauth-delete['"][\s\S]{0,400}effectiveLocked\s*&&\s*!cleanupOperation/,
  'o gate Pro deve bloquear uso, mas preservar a remoção da autorização e do segredo OAuth',
);
const loadOAuthClientStart = component.indexOf('const loadOAuthClient');
const loadOAuthClientEnd = component.indexOf('const loadStatus', loadOAuthClientStart);
assert.ok(loadOAuthClientStart >= 0 && loadOAuthClientEnd > loadOAuthClientStart, 'a leitura OAuth da UI deve existir');
assert.doesNotMatch(
  component.slice(loadOAuthClientStart, loadOAuthClientEnd),
  /!baseUrl\s*\|\|\s*locked/,
  'a UI deve carregar metadados OAuth mesmo depois que a licença Pro expirar',
);
const disconnectedUiStart = component.indexOf(': !status?.connected ? (');
const lockedCleanupStart = component.indexOf('{effectiveLocked ? (', disconnectedUiStart);
const lockedCleanupEnd = component.indexOf(') : oauthLoading', lockedCleanupStart);
assert.ok(disconnectedUiStart >= 0 && lockedCleanupStart > disconnectedUiStart && lockedCleanupEnd > lockedCleanupStart);
assertContainsAll(
  component.slice(lockedCleanupStart, lockedCleanupEnd),
  ['oauthClient?.configured', 'oauthClient.editable', 'deleteOAuthClient', 'oauth-delete'],
  'a configuração existente e sua remoção devem continuar alcançáveis no bloqueio visual Pro',
);
assert.match(
  component,
  /effectiveLocked\s*=\s*locked\s*\|\|\s*status\?\.proRequired\s*===\s*true/,
  'expiração detectada pela API deve bloquear uso sem depender de recarregar o bootstrap',
);

const inspectionStart = backend.indexOf('private function inspect_priority_urls');
const inspectionEnd = backend.indexOf('private function fetch_properties', inspectionStart);
assert.ok(inspectionStart >= 0 && inspectionEnd > inspectionStart, 'o coletor de URL Inspection deve existir');
assert.doesNotMatch(
  backend.slice(inspectionStart, inspectionEnd),
  /\$canonical_issue\s*=\s*\$coverage/,
  'coverageState não pode ser rotulado como divergência canônica',
);

assert.match(settings, /HtmlSearchConsoleSettings/);
assert.match(settings, /searchConsoleUrl/);
assert.match(settings, /HtmlSearchConsoleSettings[\s\S]{0,300}locked=\{!advancedSeo\}/);
assert.match(settings, /wordpress\??\.nonce|wordpress\.nonce/);
assert.match(settings, /advancedSeo[\s\S]{0,2000}HtmlSearchConsoleSettings|HtmlSearchConsoleSettings[\s\S]{0,2000}advancedSeo/);
assert.match(settingsHost, /searchConsoleUrl/);
assert.match(editorTypes, /searchConsoleUrl\??\s*:\s*string/);
const shellSearchConsoleIndex = shell.search(/['"]searchConsoleUrl['"]\s*=>/);
assert.notEqual(shellSearchConsoleIndex, -1, 'o shell deve projetar searchConsoleUrl');
const shellSearchConsoleWindow = shell.slice(shellSearchConsoleIndex, shellSearchConsoleIndex + 500);
assert.match(shellSearchConsoleWindow, /\$can_manage_integrations/);
assert.match(shellSearchConsoleWindow, /rest_url\(\s*['"]kodety\/v1\/seo\/search-console['"]\s*\)/);
assert.match(
  shell,
  /\$can_manage_integrations\s*=\s*[\s\S]{0,300}current_user_can\(\s*(?:Kodety_Plugin::[A-Z0-9_]+|['"](?:kodety_manage_integrations|manage_options)['"])/,
  'o shell só deve projetar a integração a usuários que podem gerenciar integrações',
);

console.log('Search Console security, quota, persistence and frontend wiring contracts passed.');
