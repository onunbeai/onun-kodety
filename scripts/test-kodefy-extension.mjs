import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';

const root = path.resolve('extensions/kodefy');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'kodety-extension.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.type, 'extension');
assert.equal(manifest.slug, 'kodefy-shopify');
assert.equal(manifest.entry, 'extension.php');
assert.equal(manifest.version, '1.3.3');
assert.equal(manifest.requires.kodety, '>=1.36.12');

const requiredFiles = [
  'extension.php',
  'includes/class-kodefy-checkout.php',
  'assets/kodefy-runtime.js',
  'assets/kodefy-components.css',
  'kit/index.html',
  'kit/product.html',
  'kit/collection.html',
  'kit/cart.html',
  'kit/.incode/project.json',
  'theme/layout/theme.liquid.txt',
  'theme/templates/index.json',
  'theme/templates/product.json',
  'theme/sections/main-product.liquid.txt',
  'theme/sections/kodefy-cart-drawer.liquid.txt',
];
for (const file of requiredFiles) await fs.access(path.join(root, file));

const htmlFiles = [];
async function collectHtml(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectHtml(absolute);
    else if (entry.name.endsWith('.html')) htmlFiles.push(absolute);
  }
}
await collectHtml(path.join(root, 'kit'));
assert.ok(htmlFiles.length >= 10, 'The Kodety kit should include a complete page set.');
for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  parse(html);
  assert.match(html, /<!doctype html>/i, `${file} must be a complete HTML document.`);
  assert.match(html, /data-label=/, `${file} needs editable layer labels.`);
}
const starterHtmlCount = htmlFiles.length;
for (const file of ['index.html', 'cart.html']) {
  const html = await fs.readFile(path.join(root, 'kit', file), 'utf8');
  assert.match(html, /data-kodefy-checkout-overlay/, `${file} must ship with an editable checkout overlay.`);
  assert.match(html, /data-kodefy-checkout-confirm/, `${file} must expose the checkout confirmation action.`);
  assert.match(html, /data-kodefy-checkout-item data-kodefy-template hidden/, `${file} must keep the editable checkout sample out of the published UI.`);
}

const themeTemplates = await fs.readdir(path.join(root, 'theme/templates'));
for (const file of themeTemplates.filter((name) => name.endsWith('.json'))) {
  JSON.parse(await fs.readFile(path.join(root, 'theme/templates', file), 'utf8'));
}
for (const file of ['settings_schema.json', 'settings_data.json']) {
  JSON.parse(await fs.readFile(path.join(root, 'theme/config', file), 'utf8'));
}
const localesRoot = path.join(root, 'theme/locales');
const localeFiles = (await fs.readdir(localesRoot)).filter((name) => name.endsWith('.json')).sort();
assert.deepEqual(
  localeFiles.filter((name) => !name.endsWith('.schema.json')),
  ['en.default.json', 'pt-BR.json'],
  'The theme must expose one English default storefront locale and one valid Portuguese alternate locale.',
);
assert.deepEqual(
  localeFiles.filter((name) => name.endsWith('.schema.json')),
  ['en.default.schema.json', 'pt-BR.schema.json'],
  'Theme-editor copy must live in dedicated schema locale files.',
);
assert.equal(
  localeFiles.filter((name) => name.endsWith('.default.json')).length,
  1,
  'Shopify themes may have exactly one default storefront locale.',
);
assert.equal(
  localeFiles.filter((name) => name.endsWith('.default.schema.json')).length,
  1,
  'Shopify themes may have exactly one default schema locale.',
);

const readJson = async (file) => JSON.parse(await fs.readFile(path.join(localesRoot, file), 'utf8'));
const storefrontLocales = {
  en: await readJson('en.default.json'),
  ptBR: await readJson('pt-BR.json'),
};
const schemaLocales = {
  en: await readJson('en.default.schema.json'),
  ptBR: await readJson('pt-BR.schema.json'),
};
const leafPaths = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
  const next = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === 'object' && !Array.isArray(child) ? leafPaths(child, next) : [next];
}).sort();
const hasPath = (value, dottedPath) => dottedPath.split('.').every((segment) => {
  if (!value || typeof value !== 'object' || !(segment in value)) return false;
  value = value[segment];
  return true;
});
assert.deepEqual(
  leafPaths(storefrontLocales.ptBR),
  leafPaths(storefrontLocales.en),
  'English and Portuguese storefront locale catalogs must have exact key parity.',
);
assert.deepEqual(
  leafPaths(schemaLocales.ptBR),
  leafPaths(schemaLocales.en),
  'English and Portuguese schema locale catalogs must have exact key parity.',
);

const themeSchemaSources = [
  await fs.readFile(path.join(root, 'theme/config/settings_schema.json'), 'utf8'),
];
const themeLiquidSources = [];
for (const directory of ['layout', 'sections', 'snippets']) {
  for (const file of (await fs.readdir(path.join(root, 'theme', directory))).filter((name) => name.endsWith('.liquid.txt'))) {
    const source = await fs.readFile(path.join(root, 'theme', directory, file), 'utf8');
    themeLiquidSources.push(source);
    if (directory === 'sections') {
      const schema = source.match(/{% schema %}([\s\S]*?){% endschema %}/)?.[1] || '';
      if (schema) JSON.parse(schema);
      themeSchemaSources.push(schema);
    }
  }
}
const schemaTranslationKeys = [...new Set(
  themeSchemaSources.flatMap((source) => [...source.matchAll(/"t:([^"]+)"/g)].map((match) => match[1])),
)];
assert.ok(schemaTranslationKeys.length >= 30, 'Theme schemas should use the native Shopify translation catalog.');
for (const key of schemaTranslationKeys) {
  assert.ok(hasPath(schemaLocales.en, key), `Missing English schema translation: ${key}`);
  assert.ok(hasPath(schemaLocales.ptBR, key), `Missing Portuguese schema translation: ${key}`);
}
const storefrontTranslationKeys = [...new Set(
  themeLiquidSources.flatMap((source) => [...source.matchAll(/['"]([^'"]+)['"]\s*\|\s*t\b/g)].map((match) => match[1])),
)];
assert.ok(storefrontTranslationKeys.length >= 20, 'Liquid storefronts should translate visible theme copy.');
for (const key of storefrontTranslationKeys) {
  assert.ok(hasPath(storefrontLocales.en, key), `Missing English storefront translation: ${key}`);
  assert.ok(hasPath(storefrontLocales.ptBR, key), `Missing Portuguese storefront translation: ${key}`);
}
assert.doesNotMatch(
  themeLiquidSources.join('\n'),
  /\b(?:Carrinho|Continuar comprando|Produto|Coleção|Conta|Em estoque|Resumo|Anterior|Próximo|Catálogo|Paginação)\b/,
  'The English Liquid path must not contain fixed Portuguese storefront copy.',
);
const shopifyThemeRuntime = await fs.readFile(path.join(root, 'theme/assets/theme.js'), 'utf8');
assert.match(shopifyThemeRuntime, /KodefyThemeStrings/, 'Dynamic cart status copy must come from the active storefront locale.');
assert.doesNotMatch(
  shopifyThemeRuntime,
  /Não foi possível adicionar o produto|Produto adicionado ao carrinho/,
  'The English storefront runtime must not contain fixed Portuguese status copy.',
);

const productLiquid = await fs.readFile(path.join(root, 'theme/sections/main-product.liquid.txt'), 'utf8');
const cartLiquid = await fs.readFile(path.join(root, 'theme/sections/kodefy-cart-drawer.liquid.txt'), 'utf8');
const sliderLiquid = await fs.readFile(path.join(root, 'theme/sections/kodefy-featured-collection.liquid.txt'), 'utf8');
assert.match(productLiquid, /product-form-/);
assert.match(productLiquid, /ProductSelect-/);
assert.match(cartLiquid, /id="CartDrawer"/);
assert.match(cartLiquid, /id="CartDrawer-Form"/);
assert.match(sliderLiquid, /id="Slider-\{\{ section\.id \}\}"/);
assert.match(sliderLiquid, /id="Slide-\{\{ section\.id \}\}-\{\{ forloop\.index \}\}"/);

const runtime = await fs.readFile(path.join(root, 'assets/kodefy-runtime.js'), 'utf8');
for (const operation of ['cartCreate', 'cartLinesAdd', 'cartLinesUpdate', 'cartLinesRemove', 'checkoutUrl']) {
  assert.ok(runtime.includes(operation) || (await fs.readFile(path.join(root, 'includes/class-kodefy-storefront.php'), 'utf8')).includes(operation));
}
assert.doesNotMatch(runtime, /X-Shopify-(?:Access|Storefront-Access)-Token/i, 'Tokens must not enter the browser runtime.');

const extensionClass = await fs.readFile(path.join(root, 'includes/class-kodefy-extension.php'), 'utf8');
assert.match(extensionClass, /kodety_template_library_sources/, 'Kodefy Commerce must register in the general template library.');
assert.match(extensionClass, /'slug'\s*=>\s*'kodefy-commerce'/, 'The Kodefy template needs a stable catalog slug.');
assert.doesNotMatch(extensionClass, /kodefy-noise-shopify|themes\/noise/, 'Third-party themes must not be registered or distributed by the extension.');
assert.match(extensionClass, /kodety_builder_apps/, 'Kodefy must register a native Builder surface.');
assert.match(extensionClass, /kodefy\/v1', '\/settings|kodefy\/v1.*settings/s, 'Kodefy must expose Builder settings through authenticated REST.');
assert.match(extensionClass, /builder-data/, 'Kodefy must expose its synchronized catalog to the Builder.');
assert.match(extensionClass, /purge_cache_rest/, 'Saving Shopify settings must invalidate published page caches.');
assert.match(extensionClass, /maybe_upgrade_runtime/, 'Runtime updates must invalidate stale published HTML automatically.');
assert.match(extensionClass, /sync_builder_data\(true\)/, 'Saving Shopify settings must refresh the Builder catalog snapshot.');
assert.match(extensionClass, /detect_dynamic_route/, 'Dynamic Shopify handles must be captured before WordPress commits to a 404.');
assert.match(extensionClass, /managed_post_permalink/, 'Mirrored Shopify items must keep the configured storefront permalink.');
assert.match(extensionClass, /'products'\s*:\s*'collections'/, 'Canonical product and collection paths must remain compatible aliases.');
assert.match(extensionClass, /kodefy_product/, 'Shopify products must be mirrored into a real Kodety collection.');
assert.match(extensionClass, /readOnly/, 'Shopify-managed CMS collections must reject manual editing.');
assert.match(extensionClass, /wp_schedule_event/, 'The Shopify CMS mirror must refresh automatically.');
assert.match(extensionClass, /application\/ld\+json/, 'Mirrored products must expose Product structured data in the initial HTML.');
assert.match(extensionClass, /render_managed_seo_html/, 'Product content must be rendered server-side for crawlers.');
assert.match(extensionClass, /render_managed_product_lists/, 'Synced CMS products must render into catalog lists before browser hydration.');
assert.match(extensionClass, /data-kodefy-server-ready/, 'Fully synchronized product details must skip placeholder hydration.');
assert.match(extensionClass, /variant_id/, 'The synchronized CMS mirror must retain a directly usable primary variant ID.');
for (const key of ['shopDomain', 'storefrontTokenType', 'country', 'language']) {
  assert.match(extensionClass, new RegExp(`\\$current\\['${key}'\\]`), `Partial checkout updates must preserve ${key}.`);
}
const managedCollectionsMethod = extensionClass.match(
  /public function ensure_managed_collections\(\): void \{[\s\S]*?\n    \}\n\n    public function schedule_catalog_sync/,
)?.[0] || '';
assert.equal(
  [...managedCollectionsMethod.matchAll(/\$plugin->project_cms_option\(/g)].length,
  1,
  'Kodefy managed collections must derive their update from one CMS snapshot.',
);
assert.match(
  managedCollectionsMethod,
  /update_project_cms_option\(\s*'kodety_collections'\s*,\s*\$definitions\s*,\s*\$stored\s*\)/,
  'Kodefy managed collections must pass the exact read snapshot to the CMS CAS writer.',
);

const shopifyClass = await fs.readFile(path.join(root, 'includes/class-kodefy-shopify.php'), 'utf8');
assert.match(shopifyClass, /wp_safe_remote_post/, 'Shopify GraphQL must use WordPress safe HTTP protections.');
assert.match(shopifyClass, /'reject_unsafe_urls'\s*=>\s*true/, 'Shopify GraphQL must reject unsafe URLs at the HTTP boundary.');
assert.match(shopifyClass, /'limit_response_size'\s*=>/, 'Shopify GraphQL responses must have a bounded body size.');
const shopifyProbe = String.raw`
define('ABSPATH', __DIR__);
define('Kodefy\\Shopify\\API_VERSION', '2026-07');
class WP_Error {
  private string $code; private string $message; private array $data;
  public function __construct($code, $message, $data = []) { $this->code = (string) $code; $this->message = (string) $message; $this->data = (array) $data; }
  public function get_error_code() { return $this->code; }
  public function get_error_message() { return $this->message; }
  public function get_error_data() { return $this->data; }
}
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_json_encode($value) { return json_encode($value); }
function wp_remote_retrieve_response_code($response) { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_body($response) { return (string) ($response['body'] ?? ''); }
function kodefy_shopify_http_stub($url, $args) {
  $GLOBALS['kodefy_shopify_requests'][] = [$url, $args];
  if (!$GLOBALS['kodefy_shopify_responses']) return new WP_Error('missing_response', 'Missing HTTP fixture.');
  return array_shift($GLOBALS['kodefy_shopify_responses']);
}
function wp_remote_post($url, $args) { return kodefy_shopify_http_stub($url, $args); }
function wp_safe_remote_post($url, $args) { return kodefy_shopify_http_stub($url, $args); }
class KodefyShopifyCryptoStub { public static function decrypt($value) { return (string) $value; } }
class KodefyStatefulShopDomain {
  private int $reads = 0;
  public function __toString(): string { return $this->reads++ === 0 ? '' : 'example.com'; }
  public function reads(): int { return $this->reads; }
}
class_alias('KodefyShopifyCryptoStub', 'Kodefy\\Shopify\\Kodefy_Crypto');
require '${path.join(root, 'includes/class-kodefy-shopify.php').replaceAll('\\', '\\\\').replaceAll("'", "\\'")}';

$GLOBALS['kodefy_shopify_requests'] = [];
$GLOBALS['kodefy_shopify_responses'] = [];
$statefulDomain = new KodefyStatefulShopDomain();
$stateful = new Kodefy\Shopify\Kodefy_Shopify([
  'shopDomain' => $statefulDomain,
  'storefrontToken' => 'storefront-secret',
]);
$statefulResult = $stateful->storefront('query KodefyProbe { shop { name } }');
if (
  !is_wp_error($statefulResult)
  || $statefulResult->get_error_code() !== 'kodefy_shop_domain_invalid'
  || $statefulDomain->reads() !== 0
  || count($GLOBALS['kodefy_shopify_requests']) !== 0
) {
  throw new RuntimeException('Shopify domains must be coerced once so validation and HTTP use cannot disagree.');
}

$malicious = new Kodefy\Shopify\Kodefy_Shopify([
  'shopDomain' => 'trusted.myshopify.com@127.0.0.1',
  'storefrontToken' => 'storefront-secret',
  'adminToken' => 'admin-secret',
]);
$blockedStorefront = $malicious->storefront('query KodefyProbe { shop { name } }');
$blockedAdmin = $malicious->admin('query KodefyProbe { shop { name } }');
if (
  !is_wp_error($blockedStorefront)
  || $blockedStorefront->get_error_code() !== 'kodefy_shop_domain_invalid'
  || !is_wp_error($blockedAdmin)
  || $blockedAdmin->get_error_code() !== 'kodefy_shop_domain_invalid'
  || $malicious->domain() !== ''
  || $malicious->configured()
  || count($GLOBALS['kodefy_shopify_requests']) !== 0
) throw new RuntimeException('Manipulated persisted Shopify domains must fail before HTTP use.');

$client = new Kodefy\Shopify\Kodefy_Shopify([
  'shopDomain' => 'HTTPS://Demo-Store.MyShopify.Com/',
  'storefrontToken' => 'storefront-secret',
]);
$GLOBALS['kodefy_shopify_responses'][] = [
  'response' => ['code' => 200],
  'body' => json_encode(['data' => ['shop' => ['name' => 'Demo Store']]]),
];
$success = $client->storefront('query KodefyProbe { shop { name } }');
$request = $GLOBALS['kodefy_shopify_requests'][0] ?? [];
if (
  is_wp_error($success)
  || ($success['shop']['name'] ?? '') !== 'Demo Store'
  || $client->domain() !== 'demo-store.myshopify.com'
  || ($request[0] ?? '') !== 'https://demo-store.myshopify.com/api/2026-07/graphql.json'
  || ($request[1]['timeout'] ?? 0) !== 15
  || ($request[1]['redirection'] ?? -1) !== 0
  || ($request[1]['reject_unsafe_urls'] ?? false) !== true
  || ($request[1]['limit_response_size'] ?? 0) !== 2 * 1024 * 1024
) throw new RuntimeException('A valid legacy Shopify domain must use the bounded safe HTTP contract.');

$GLOBALS['kodefy_shopify_responses'][] = [
  'response' => ['code' => 200],
  'body' => json_encode([
    'data' => ['shop' => ['name' => 'Stale Store']],
    'errors' => [['message' => 'Token revogado; reconecte a loja.']],
  ]),
];
$graphqlError = $client->storefront('query KodefyProbe { shop { name } }');
if (
  !is_wp_error($graphqlError)
  || $graphqlError->get_error_code() !== 'kodefy_shopify_graphql'
  || !str_contains($graphqlError->get_error_message(), 'Token revogado')
) throw new RuntimeException('GraphQL errors in a 2xx response must remain actionable failures.');

$GLOBALS['kodefy_shopify_responses'][] = [
  'response' => ['code' => 200],
  'body' => json_encode(['extensions' => ['requestId' => 'request-redacted']]),
];
$missingData = $client->storefront('query KodefyProbe { shop { name } }');
if (!is_wp_error($missingData) || $missingData->get_error_code() !== 'kodefy_shopify_graphql_data') {
  throw new RuntimeException('GraphQL 2xx responses without data must fail closed.');
}

$GLOBALS['kodefy_shopify_responses'][] = [
  'response' => ['code' => 200],
  'body' => json_encode(['data' => ['shop' => ['name' => 'Stale Store']], 'errors' => 'malformed']),
];
$malformedErrors = $client->storefront('query KodefyProbe { shop { name } }');
if (!is_wp_error($malformedErrors) || $malformedErrors->get_error_code() !== 'kodefy_shopify_graphql') {
  throw new RuntimeException('Malformed non-empty GraphQL errors must not be ignored.');
}
`;
execFileSync('php', ['-r', shopifyProbe], { stdio: 'pipe' });
if (process.env.KODEFY_SHOPIFY_ONLY === '1') {
  console.log('Kodefy Shopify security checks passed.');
  process.exit(0);
}

const storefrontClass = await fs.readFile(path.join(root, 'includes/class-kodefy-storefront.php'), 'utf8');
assert.match(storefrontClass, /cached_storefront/, 'Published catalog reads need a last-known-good cache.');
assert.match(storefrontClass, /preg_match\('#\^gid:\/\/shopify\//, 'Shopify GIDs need a delimiter that remains valid when IDs contain a tilde.');
assert.match(storefrontClass, /kodefy_cart_warning/, 'Shopify cart inventory warnings must reach the customer instead of silently returning quantity zero.');
assert.match(storefrontClass, /register_rest_route\('kodefy\/v1', '\/checkout'/, 'Kodefy must expose a same-origin checkout resolver.');
assert.match(storefrontClass, /new Kodefy_Checkout\(\$settings\)/, 'Checkout must resolve from a freshly loaded authoritative Shopify cart.');
const checkoutClass = await fs.readFile(path.join(root, 'includes/class-kodefy-checkout.php'), 'utf8');
for (const provider of ['shopify', 'appmax_shopify', 'yampi', 'cartpanda', 'appmax', 'custom']) assert.match(checkoutClass, new RegExp(`'${provider}'`));
assert.match(checkoutClass, /wp_safe_remote_post/, 'Checkout session creation must use WordPress safe HTTP protections.');
assert.match(checkoutClass, /X-Kodefy-Signature/, 'Checkout sessions must sign the authoritative cart payload.');
assert.match(checkoutClass, /Idempotency-Key/, 'Checkout sessions must be idempotent.');
assert.match(checkoutClass, /host_is_allowed/, 'Checkout redirects must be restricted to an explicit host allowlist.');
assert.doesNotMatch(checkoutClass, /endpointSecret[^\n]*=>[^\n]*\$resolved/, 'Checkout credentials must never enter the public response.');
const cartCreateBranch = storefrontClass.match(/if \(\$action === 'create'\)[\s\S]*?return \$this->respond\(\$data, 'cartCreate'\);/)?.[0] || '';
assert.doesNotMatch(cartCreateBranch, /\$input\s*=\s*\['buyerIdentity'/, 'New carts must not be pinned to a catalog display market that can reject otherwise stocked inventory.');
assert.match(cartCreateBranch, /'lines'\s*=>\s*\[\['merchandiseId'/, 'Cart creation must send the selected stocked variant as a line.');
const gidProbe = String.raw`
define('ABSPATH', __DIR__);
require '${path.join(root, 'includes/class-kodefy-storefront.php').replaceAll('\\', '\\\\').replaceAll("'", "\\'")}';
$class = new ReflectionClass('Kodefy\\Shopify\\Kodefy_Storefront');
$instance = $class->newInstanceWithoutConstructor();
$method = $class->getMethod('gid');
$method->setAccessible(true);
$variant = $method->invoke($instance, 'gid://shopify/ProductVariant/48675515728126', 'ProductVariant');
$cart = $method->invoke($instance, 'gid://shopify/Cart/token~part?key=a1_b-2', 'Cart');
$invalid = $method->invoke($instance, 'gid://shopify/Cart/token/<script>', 'Cart');
if ($variant === '' || $cart === '' || $invalid !== '') exit(1);
`;
execFileSync('php', ['-r', gidProbe], { stdio: 'pipe' });
const checkoutProbe = String.raw`
define('ABSPATH', __DIR__);
class WP_Error {
  private string $code; private string $message; private array $data;
  public function __construct($code, $message, $data = []) { $this->code = (string) $code; $this->message = (string) $message; $this->data = (array) $data; }
  public function get_error_code() { return $this->code; }
  public function get_error_message() { return $this->message; }
  public function get_error_data() { return $this->data; }
}
function is_wp_error($value) { return $value instanceof WP_Error; }
function sanitize_key($value) { return strtolower(preg_replace('/[^a-z0-9_-]/', '', (string) $value)); }
function sanitize_title($value) { return strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', (string) $value), '-')); }
function sanitize_text_field($value) { return trim(strip_tags((string) $value)); }
function wp_parse_url($value, $component = -1) { return parse_url((string) $value, $component); }
function esc_url_raw($value, $protocols = null) { return str_starts_with((string) $value, 'https://') ? (string) $value : ''; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function home_url($path = '/') { return 'https://store.example.test' . ($path === '/' ? '/' : $path); }
class KodefyCryptoStub { public static function decrypt($value) { return $value === 'encrypted-secret' ? 'endpoint-secret' : ''; } }
class_alias('KodefyCryptoStub', 'Kodefy\\Shopify\\Kodefy_Crypto');
$GLOBALS['kodefy_checkout_request'] = null;
function wp_safe_remote_post($url, $args) {
  $GLOBALS['kodefy_checkout_request'] = [$url, $args];
  return ['response' => ['code' => 201], 'body' => json_encode(['checkoutUrl' => 'https://pay.example.test/session/abc'])];
}
function wp_remote_retrieve_response_code($response) { return (int) ($response['response']['code'] ?? 0); }
function wp_remote_retrieve_body($response) { return (string) ($response['body'] ?? ''); }
require '${path.join(root, 'includes/class-kodefy-checkout.php').replaceAll('\\', '\\\\').replaceAll("'", "\\'")}';
$cart = [
  'id' => 'gid://shopify/Cart/token~part?key=a1_b-2',
  'checkoutUrl' => 'https://checkout.store.example.test/c/abc',
  'cost' => ['totalAmount' => ['amount' => '199.90', 'currencyCode' => 'BRL']],
  'lines' => ['nodes' => [[
    'id' => 'gid://shopify/CartLine/1', 'quantity' => 2,
    'cost' => ['totalAmount' => ['amount' => '199.90', 'currencyCode' => 'BRL']],
    'merchandise' => ['id' => 'gid://shopify/ProductVariant/123', 'title' => 'Preto', 'sku' => 'SKU-1', 'availableForSale' => true, 'quantityAvailable' => 5, 'selectedOptions' => [['name' => 'Cor', 'value' => 'Preto']], 'product' => ['title' => 'Produto', 'handle' => 'produto']],
  ]]],
];
$native = (new Kodefy\Shopify\Kodefy_Checkout(['shopDomain' => 'store.myshopify.com', 'checkout' => ['provider' => 'shopify']]))->resolve($cart);
if (is_wp_error($native) || $native['provider'] !== 'shopify' || $native['url'] !== $cart['checkoutUrl']) exit(1);
$appmaxShopify = (new Kodefy\Shopify\Kodefy_Checkout(['shopDomain' => 'store.myshopify.com', 'checkout' => ['provider' => 'appmax_shopify']]))->resolve($cart);
if (is_wp_error($appmaxShopify) || $appmaxShopify['provider'] !== 'appmax_shopify' || $appmaxShopify['strategy'] !== 'native' || $appmaxShopify['url'] !== $cart['checkoutUrl']) exit(1);
$linkSettings = ['shopDomain' => 'store.myshopify.com', 'checkout' => ['provider' => 'yampi', 'strategy' => 'link', 'linkTemplate' => 'https://pay.example.test/start?cart={cart_id}&items={items_b64}', 'allowedHosts' => ['pay.example.test'], 'returnUrl' => 'https://store.example.test/', 'cancelUrl' => 'https://store.example.test/cart/']];
$link = (new Kodefy\Shopify\Kodefy_Checkout($linkSettings))->resolve($cart);
if (is_wp_error($link) || $link['provider'] !== 'yampi' || !str_starts_with($link['url'], 'https://pay.example.test/start?')) exit(1);
$inventorySettings = $linkSettings;
$inventorySettings['checkout']['fallbackToShopify'] = true;
$unavailableCart = $cart;
$unavailableCart['lines']['nodes'][0]['merchandise']['availableForSale'] = false;
$unavailable = (new Kodefy\Shopify\Kodefy_Checkout($inventorySettings))->resolve($unavailableCart);
if (
  !is_wp_error($unavailable)
  || $unavailable->get_error_code() !== 'kodefy_checkout_item_unavailable'
  || ($unavailable->get_error_data()['status'] ?? 0) !== 422
  || $unavailable->get_error_message() === ''
) exit(1);
$overQuantityCart = $cart;
$overQuantityCart['lines']['nodes'][0]['quantity'] = 4;
$overQuantityCart['lines']['nodes'][0]['merchandise']['quantityAvailable'] = 3;
$overQuantity = (new Kodefy\Shopify\Kodefy_Checkout($inventorySettings))->resolve($overQuantityCart);
if (
  !is_wp_error($overQuantity)
  || $overQuantity->get_error_code() !== 'kodefy_checkout_quantity_exceeded'
  || ($overQuantity->get_error_data()['status'] ?? 0) !== 422
  || ($overQuantity->get_error_data()['requestedQuantity'] ?? 0) !== 4
  || ($overQuantity->get_error_data()['availableQuantity'] ?? -1) !== 3
) exit(1);
$checkoutReflection = new ReflectionClass('Kodefy\\Shopify\\Kodefy_Checkout');
$idempotencyMethod = $checkoutReflection->getMethod('idempotency_key');
$idempotencyMethod->setAccessible(true);
$resolver = new Kodefy\Shopify\Kodefy_Checkout($inventorySettings);
$payloadA = '{"cart_id":"same","total":"199.90","items":[{"variant_id":"1","quantity":2}]}';
$payloadDifferentLine = '{"cart_id":"same","total":"199.90","items":[{"variant_id":"2","quantity":2}]}';
$payloadDifferentTotal = '{"cart_id":"same","total":"249.90","items":[{"variant_id":"1","quantity":2}]}';
$keyA = $idempotencyMethod->invoke($resolver, 'yampi', $payloadA);
$keyRepeat = $idempotencyMethod->invoke($resolver, 'yampi', $payloadA);
$keyDifferentLine = $idempotencyMethod->invoke($resolver, 'yampi', $payloadDifferentLine);
$keyDifferentTotal = $idempotencyMethod->invoke($resolver, 'yampi', $payloadDifferentTotal);
if (
  $keyA !== $keyRepeat
  || $keyA === $keyDifferentLine
  || $keyA === $keyDifferentTotal
  || !preg_match('/^kfy_[a-f0-9]{64}$/', $keyA)
) exit(1);
$linkSettings['checkout']['linkTemplate'] = 'https://evil.example.test/start?cart={cart_id}';
$blocked = (new Kodefy\Shopify\Kodefy_Checkout($linkSettings))->resolve($cart);
if (!is_wp_error($blocked) || $blocked->get_error_code() !== 'kodefy_checkout_url_host') exit(1);
$sessionSettings = ['shopDomain' => 'store.myshopify.com', 'checkout' => ['provider' => 'custom', 'strategy' => 'session', 'endpointUrl' => 'https://api.example.test/session', 'endpointSecret' => 'encrypted-secret', 'allowedHosts' => ['api.example.test', 'pay.example.test'], 'returnUrl' => 'https://store.example.test/', 'cancelUrl' => 'https://store.example.test/cart/']];
$session = (new Kodefy\Shopify\Kodefy_Checkout($sessionSettings))->resolve($cart);
$sessionRequest = $GLOBALS['kodefy_checkout_request'];
if (
  is_wp_error($session)
  || $session['url'] !== 'https://pay.example.test/session/abc'
  || ($sessionRequest[1]['headers']['Authorization'] ?? '') !== 'Bearer endpoint-secret'
  || !str_starts_with(($sessionRequest[1]['headers']['X-Kodefy-Signature'] ?? ''), 'sha256=')
  || !str_starts_with(($sessionRequest[1]['headers']['Idempotency-Key'] ?? ''), 'kfy_')
  || !str_contains((string) ($sessionRequest[1]['body'] ?? ''), 'gid://shopify/ProductVariant/123')
) exit(1);
`;
execFileSync('php', ['-r', checkoutProbe], { stdio: 'pipe' });
const serverRenderProbe = String.raw`
define('ABSPATH', __DIR__);
class WP_Post { public int $ID = 7; public string $post_name = 'oxygen'; }
function sanitize_text_field($value) { return trim(strip_tags((string) $value)); }
function sanitize_title($value) { return strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', (string) $value), '-')); }
function esc_url_raw($value) { return (string) $value; }
function get_the_title($post) { return 'Oxygen'; }
$GLOBALS['kodefy_meta'] = [
  'variants_json' => json_encode([[
    'id' => 'gid://shopify/ProductVariant/48675515728126',
    'title' => 'Padrão',
    'availableForSale' => true,
    'quantityAvailable' => 50,
    'price' => ['amount' => '1025.00', 'currencyCode' => 'USD'],
    'compareAtPrice' => ['amount' => '1100.00', 'currencyCode' => 'USD'],
    'image' => ['url' => 'https://cdn.example.test/oxygen.jpg', 'altText' => 'Oxygen'],
  ]]),
  'images_json' => json_encode([['url' => 'https://cdn.example.test/oxygen.jpg', 'altText' => 'Oxygen']]),
];
function get_post_meta($postId, $key, $single = false) { return $GLOBALS['kodefy_meta'][$key] ?? ''; }
require '${path.join(root, 'includes/class-kodefy-extension.php').replaceAll('\\', '\\\\').replaceAll("'", "\\'")}';
$class = new ReflectionClass('Kodefy\\Shopify\\Kodefy_Extension');
$instance = $class->newInstanceWithoutConstructor();
$method = $class->getMethod('render_product_detail_controls');
$method->setAccessible(true);
$document = new DOMDocument('1.0', 'UTF-8');
$document->loadHTML('<div data-kodefy-product-detail><span data-kodefy-product-price>PLACEHOLDER</span><s data-kodefy-product-compare-price>PLACEHOLDER</s><select data-kodefy-variant><option>Opção padrão</option></select><p data-kodefy-inventory>Verificando estoque…</p><button data-kodefy-add>Adicionar ao carrinho</button><img data-kodefy-gallery-main src="placeholder.svg"><div data-kodefy-gallery-thumbs><button>placeholder</button></div></div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
$xpath = new DOMXPath($document);
$rootNode = $xpath->query('//*[@data-kodefy-product-detail]')->item(0);
$rendered = $method->invoke($instance, $document, $xpath, $rootNode, new WP_Post());
$html = $document->saveHTML();
if (!$rendered
  || !str_contains($html, 'gid://shopify/ProductVariant/48675515728126')
  || !str_contains($html, 'USD 1.025,00')
  || !str_contains($html, 'Em estoque')
  || !str_contains($html, 'https://cdn.example.test/oxygen.jpg')
  || str_contains($html, 'Verificando estoque')) exit(1);
`;
execFileSync('php', ['-r', serverRenderProbe], { stdio: 'pipe' });
assert.match(runtime, /inflightReads/, 'The browser runtime must deduplicate identical catalog reads.');
assert.match(runtime, /\[408, 425, 429, 500, 502, 503, 504\]/, 'The browser runtime must retry transient catalog failures.');
assert.match(runtime, /data-kodefy-product-url/, 'Clicking a product card must open its dynamic product URL.');
assert.match(runtime, /api\('\/checkout'/, 'Checkout controls must resolve their provider on the server.');
assert.match(runtime, /data-kodefy-checkout-confirm/, 'The editable checkout overlay must have an explicit confirmation action.');
assert.match(runtime, /window\.KodetyOverlays\.open/, 'Kodefy must open the checkout through the shared authored-overlay runtime.');
assert.match(runtime, /fallbackToShopify/, 'Checkout must retain the configured Shopify fallback.');
assert.match(runtime, /loadCart\(true\)/, 'A browser fallback must re-read the Shopify cart before redirecting.');
assert.match(runtime, /transientFailure/, 'Authoritative 4xx checkout rejections must never be hidden by a browser fallback.');
assert.match(runtime, /checkoutOverlayRoot\(resolved\.overlaySelector, control\)/, 'The current server response must select the authored checkout overlay.');
assert.match(runtime, /async function startCheckout\(control\)\s*\{\s*await loadCart\(true\)/, 'Checkout must re-read the authoritative Shopify cart before rendering the order.');
assert.match(runtime, /function resetCheckoutOverlays[\s\S]*?async function init\(\)\s*\{\s*resetCheckoutOverlays\(\)/, 'Checkout overlays must start closed even when authored state is stale.');
assert.match(runtime, /data-kodefy-checkout-ready[\s\S]*?Number\(cart\.totalQuantity \|\| 0\) <= 0\) return false/, 'Checkout overlays must require a hydrated non-empty cart before opening.');
assert.match(runtime, /data-kodety-overlay-close[\s\S]*?resetCheckoutOverlay/, 'Kodefy must retain an independent close path for its checkout overlay.');
assert.doesNotMatch(runtime, /headers:\s*\{\s*'Idempotency-Key'/, 'The browser must not choose provider idempotency keys.');
assert.match(runtime, /hydrateServerProductDetails/, 'Server-rendered variants must remain interactive without a second product fetch.');
assert.match(runtime, /assertVariantInCart/, 'The browser must reject Shopify responses that silently reduce an added line to zero.');
assert.match(runtime, /emptyExisting[\s\S]*invalidExisting/, 'Empty carts created under an obsolete market context must recover automatically.');

const editorShell = await fs.readFile(path.resolve('Wordpress/kodety/templates/editor-shell.php'), 'utf8');
const editorSource = await fs.readFile(path.resolve('app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8');
const editorTopbarSource = await fs.readFile(path.resolve('app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx'), 'utf8');
const settingsSource = await fs.readFile(path.resolve('app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'), 'utf8');
const projectIo = await fs.readFile(path.resolve('lib/html-editor/project-io.ts'), 'utf8');
const corePlugin = await fs.readFile(path.resolve('Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8');
assert.match(editorShell, /templatesCatalogUrl/, 'The Builder shell must expose the template catalog.');
assert.match(editorShell, /kodefy_extension_active[\s\S]*kodefySettingsUrl/, 'The Builder shell must expose Kodefy whenever the extension is active.');
assert.match(editorShell, /kodefyBuilderDataUrl/, 'The Builder shell must expose the synchronized Shopify snapshot.');
assert.match(settingsSource, /wordpress\?\.shopifySettingsUrl\s*&&\s*\(/, 'Shopify settings must use the authenticated extension endpoint.');
assert.match(settingsSource, /title="Shopify"/, 'Shopify settings must live in Settings > Integrations and AI.');
assert.match(settingsSource, /title="Shopify"[\s\S]{0,400}defaultOpen=\{false\}[\s\S]{0,200}collapseId="integrations-shopify"/, 'Shopify settings must start collapsed.');
assert.match(settingsSource, /collapseId="integrations-ai"/, 'AI settings must use the collapsible integration section.');
assert.match(settingsSource, /SHOPIFY_CHECKOUT_PROVIDERS/, 'Shopify settings must expose the checkout provider catalog.');
assert.match(settingsSource, /Yampi[\s\S]*CartPanda[\s\S]*Appmax/, 'Brazilian checkout presets must be selectable.');
assert.match(settingsSource, /Checkout Overlay/, 'Settings must explain the editable checkout overlay flow.');
assert.doesNotMatch(editorSource, /Integrações[\s\S]{0,300}Kodefy Shopify/, 'Shopify must not keep a separate Builder menu entry.');
assert.match(editorShell, /kodefyUrl[\s\S]*add_query_arg\('section', 'mcp',[\s\S]*surface_url\('settings'\)/, 'Legacy Shopify links must open Settings > Integrations and AI.');
assert.doesNotMatch(editorSource, /Exportar tema Shopify/, 'Liquid projects must use the Builder standard export action.');
assert.match(editorTopbarSource, /<Download \/> Exportar projeto ZIP/, 'The standard Builder export label must stay identical for Liquid projects.');
assert.match(
  editorSource,
  /<HtmlEditorTopbar[\s\S]{0,600}exportProjectArchive=\{exportProjectArchive\}[\s\S]{0,200}exportProjectAsShopifyTheme=\{exportProjectAsShopifyTheme\}/,
  'The editor must keep the extracted topbar wired to the standard ZIP and Shopify export callbacks.',
);
assert.match(projectIo, /SHOPIFY_THEME_METADATA_PATH/, 'Shopify imports must preserve a maintenance manifest.');
assert.match(projectIo, /shopifyThemeToZipBlob/, 'Shopify maintenance projects must export back to a theme ZIP.');
assert.match(projectIo, /liquid \? await shopifyThemeToZipBlob\(transportProject\) : await projectToZipBlob\(transportProject\)/, 'The normal export function must automatically materialize Liquid projects.');
assert.match(projectIo, /injectNativeComponentsRuntime/, 'Normal HTML exports must include the authored overlay runtime.');
assert.match(projectIo, /prepareShopifyThemeFiles\(files, root\)/, 'Folder imports must accept Liquid projects through the normal flow.');
assert.match(projectIo, /materializeLiquidProject/, 'Liquid previews must be written back to their original source files.');
assert.match(projectIo, /sourceDigest: shopifySourceDigest/, 'Shopify imports must fingerprint original Liquid sources.');
assert.match(projectIo, /shopifySourceDigest\(currentSource\) !== source\.sourceDigest/, 'Direct Liquid edits must take priority during export.');
assert.match(corePlugin, /'html','htm','liquid'/, 'The secure project allowlist must accept Liquid source files.');
assert.match(corePlugin, /prepare_shopify_theme_workspace/, 'Server-side imports must prepare Shopify previews before opening the Builder.');
assert.match(corePlugin, /'kodefy'\s*=>\s*\[[^\]]*'kodefy-shopify'/, 'The Kodefy route must not depend on a late extension rewrite.');
assert.match(corePlugin, /protect_read_only_cms_items/, 'Integration-managed CMS items must be protected from manual edits.');
const themeRuntime = await fs.readFile(path.resolve('Wordpress/kodety/theme-runtime/functions.php'), 'utf8');
assert.match(themeRuntime, /apply_filters\('kodety_cms_item_permalink'/, 'CMS-rendered cards must allow managed integrations to provide their public permalink.');
assert.match(themeRuntime, /window\.KodetyOverlays/, 'Published WordPress pages must expose the native overlay controller.');
assert.match(themeRuntime, /data-kodety-overlay['"]\) === 'checkout'[\s\S]*?data-kodefy-checkout-ready/, 'Published WordPress must reject unhydrated checkout overlay opens.');

const nativeComponents = await fs.readFile(path.resolve('lib/html-editor/native-components.ts'), 'utf8');
for (const builder of ['buildNativeModalMarkup', 'buildNativeDrawerMarkup', 'buildNativePopoverMarkup', 'buildNativeTooltipMarkup', 'buildNativeCheckoutOverlayMarkup']) assert.match(nativeComponents, new RegExp(`export function ${builder}`));
assert.match(nativeComponents, /data-kodefy-checkout-overlay/, 'The checkout overlay must be discoverable by the Kodefy runtime.');
assert.match(nativeComponents, /data-kodefy-checkout-items/, 'The checkout overlay must expose an editable order summary binding.');
assert.match(nativeComponents, /data-kodefy-checkout-item data-kodefy-template hidden/, 'The checkout item template must never flash on the published page.');

const packageSource = await fs.readFile(path.resolve('scripts/package-kodefy-extension.mjs'), 'utf8');
assert.doesNotMatch(settingsSource, /shopifyDownloadThemeUrl|Baixar tema Liquid/, 'Settings must not expose a second Liquid export flow.');
assert.doesNotMatch(editorShell, /kodefyDownloadThemeUrl/, 'The Builder shell must not advertise a settings-based theme export.');
assert.match(packageSource, /excludeRoot:\s*\['theme', 'themes'\]/, 'The installable extension must exclude all Shopify theme sources.');
assert.doesNotMatch(packageSource, /packageDirectory\(path\.join\(root, 'themes\/noise'/, 'The build must not emit a distributable Noise theme archive.');

console.log(`Kodefy checks passed: ${starterHtmlCount} starter pages and ${themeTemplates.length} Shopify templates.`);
