import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bootstrap, plugin, importer, adminJs, adminCss, onboarding, onboardingJs, onboardingCss] = await Promise.all([
  readFile(path.join(root, 'Wordpress/kodety/kodety.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-elementor-importer.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/admin/kodety-page.js'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/admin/kodety-page.css'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/templates/onboarding.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/admin/onboarding.js'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/admin/onboarding.css'), 'utf8'),
]);

const handler = plugin.match(
  /public function admin_import_url\(\): void \{[\s\S]*?\n    public function can_import_from_url\(/,
)?.[0] || '';
const stageSelected = plugin.match(
  /private function stage_elementor_import\(int \$post_id\): int \{[\s\S]*?\n    \}\n\n    public function render_onboarding_document\(/,
)?.[0] || '';
const snapshotRenderer = bootstrap.match(
  /function kodety_render_elementor_document_for_snapshot\(int \$post_id, string \$source_url\): string \{[\s\S]*?\n\}\n\n\/\*\*[\s\S]*?function kodety_capture_elementor_rendered_snapshot_before_deactivation/,
)?.[0] || '';
const deactivationRoutine = bootstrap.match(
  /function kodety_deactivate_elementor_pro_before_activation\(\): void \{[\s\S]*?\n\}\n\n\/\*\* Stop wp-admin/,
)?.[0] || '';

assert.match(
  plugin,
  /'elementor'\s*=>\s*\['Elementor'[\s\S]*?data-kodety-url-elementor-mode[\s\S]*?name="kodety_elementor_mode" value="visual"[\s\S]*?name="kodety_elementor_mode" value="native"/,
  'the admin importer must expose both Elementor modes',
);
assert.match(
  plugin,
  /Página publicada completa[\s\S]*?HTML renderizado, CSS, JavaScript[\s\S]*?Conversão estrutural[\s\S]*?Nenhum dos modos publica automaticamente/,
  'the mode picker must offer the complete published Elementor page and state the draft-only safety boundary',
);
assert.match(
  adminJs,
  /selectedElementorMode = \(\) =>[\s\S]*?\|\| 'visual'[\s\S]*?inputNode\.disabled = platform !== 'elementor'/,
  'the published-page mode must remain available for local or remote Elementor URLs after automatic deactivation',
);
assert.doesNotMatch(adminJs, /visualUnavailable|elementorRuntimeActive\s*=/, 'Elementor deactivation must not disable URL import');
assert.match(
  adminJs,
  /elementorMode:\s*selectedElementorMode\(\)[\s\S]*?detectedPlatform === 'elementor'[\s\S]*?Elementor detectado\.[\s\S]*?HTML, CSS, JavaScript e widgets[\s\S]*?return;/,
  'automatic detection must stop before commit, explain the published runtime and let the user confirm a mode',
);
assert.match(
  adminJs,
  /platform !== 'auto' && \(platform !== 'framer' \|\| delay === 0\)[\s\S]*?const requestGeneration = \+\+importRequestGeneration/,
  'automatic detection must run even when capture delay is immediate',
);
assert.match(
  adminJs,
  /invalidateUrlImportRequest[\s\S]*?importAbortController\?\.abort\(\)[\s\S]*?signal: requestController\.signal[\s\S]*?requestIsCurrent\(\)[\s\S]*?error\?\.name === 'AbortError'/,
  'URL/platform changes must cancel stale detection responses before commit',
);
assert.match(
  adminJs,
  /Converter para rascunho[\s\S]*?Importar página publicada[\s\S]*?HTML, CSS, JavaScript, assets e widgets[\s\S]*?Nenhuma alteração será publicada/,
  'both Elementor calls to action must describe the imported runtime and draft outcome',
);
assert.match(
  adminJs,
  /URL da página publicada no WordPress\/Elementor[\s\S]*?HTML publicado, CSS, JavaScript, imagens, fontes e arquivos usados pelos widgets/,
  'selecting Elementor must explain the URL-specific published-page import',
);
assert.match(
  adminCss,
  /\.kodety-import-url__segmented,[\s\S]*?\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/,
  'source and capture tabs must wrap without truncating labels on narrow panels',
);
assert.match(
  adminCss,
  /\.kodety-import-url__mode-list\s*\{[^}]*gap:\s*4px;[^}]*padding:\s*4px;[^}]*border-radius:\s*9px;[^}]*background:\s*var\(--kodety-shell-bg,/,
  'import selectors must share the topbar switcher grouped surface and spacing',
);
assert.match(
  adminCss,
  /label:has\(input:checked\)\s*\{[^}]*background:\s*var\(--kodety-shell-elevated,[^}]*box-shadow:\s*inset 0 0 0 1px var\(--kodety-shell-border,/,
  'selected import tabs must use the same filled active state as the topbar',
);
assert.match(
  adminCss,
  /label:has\(input:focus-visible\)\s*\{[^}]*outline:\s*2px solid/,
  'keyboard focus must remain visible on the tab-shaped native controls',
);
assert.match(
  plugin,
  /name="kodety_platform"[\s\S]*?type="checkbox" name="kodety_breakpoints\[\]"/,
  'tab styling must retain native single-source and multiple-breakpoint form semantics',
);
assert.match(
  adminCss,
  /\.kodety-import-url__footer > p\.is-draft/,
  'draft-only status must keep its contextual style',
);

assert.match(
  handler,
  /\$elementor_request && \$rendered_html !== ''[\s\S]*?\$elementor_request && \$result_platform !== 'elementor'/,
  'a forged Elementor label must not accept Framer capture or a generic ZIP',
);
assert.match(
  handler,
  /if \(!\$this->can_publish\(\)\) throw new RuntimeException\('Sem permissão para publicar o site\.'\);[\s\S]*?\$this->install_zip\(/,
  'publishing must be reauthorized immediately before theme installation',
);
assert.match(
  handler,
  /stage_builder_import\(\$zip_path, 'elementor-' \. \$post_id \. '-nativo\.zip', true, true\)[\s\S]*?stage_builder_import\([\s\S]*?true,\s*true\s*\)/,
  'structural and published Elementor imports must enforce the editor lock and reset portable identity',
);
assert.match(handler, /kodety_elementor_import[\s\S]*?home_url\('\/kodety\/editor\/'\)/);
assert.doesNotMatch(handler, /kodety_open_publish/);
assert.match(
  plugin,
  /current_user_can\('edit_post', \$post_id\)[\s\S]*?get_post_meta\(\$post_id, '_elementor_data'/,
  'native conversion must authorize the source page before reading private Elementor metadata',
);
assert.doesNotMatch(importer, /'projectId'\s*=>/, 'portable Elementor projects must not invent an identity');
assert.match(importer, /'breakpointSchemaVersion'\s*=>\s*2/);
assert.match(importer, /wp_kses_post\(\$html\)[\s\S]*?class_exists\('DOMDocument'\)/);

const deactivationHook = bootstrap.indexOf(
  "register_activation_hook(__FILE__, 'kodety_deactivate_elementor_pro_before_activation')",
);
const kodetyActivationHook = bootstrap.indexOf(
  "register_activation_hook(__FILE__, ['Kodety_Plugin', 'activate'])",
);
assert.ok(deactivationHook >= 0 && kodetyActivationHook > deactivationHook, 'Elementor Pro layers must be deactivated before Kodety migrations run');
assert.match(
  snapshotRenderer,
  /Plugin::instance\(\)[\s\S]*?get_builder_content_for_display\(\$post_id, true\)[\s\S]*?wp_print_styles\(\)[\s\S]*?wp_print_head_scripts\(\)[\s\S]*?wp_print_footer_scripts\(\)/,
  'conversion must render the real widget DOM and its queued Elementor CSS/JavaScript through the frontend API',
);
const isolateQueuesAt = snapshotRenderer.indexOf("unset($GLOBALS['wp_scripts'], $GLOBALS['wp_styles'])");
const renderWidgetsAt = snapshotRenderer.indexOf('get_builder_content_for_display($post_id, true)');
const restoreScriptsAt = snapshotRenderer.lastIndexOf("$GLOBALS['wp_scripts'] = $previous_scripts");
const restoreStylesAt = snapshotRenderer.lastIndexOf("$GLOBALS['wp_styles'] = $previous_styles");
assert.ok(
  isolateQueuesAt >= 0
    && renderWidgetsAt > isolateQueuesAt
    && restoreScriptsAt > renderWidgetsAt
    && restoreStylesAt > renderWidgetsAt
    && snapshotRenderer.includes('finally {'),
  'the Elementor renderer must use isolated dependency queues and restore the wp-admin queues in finally',
);
assert.match(
  snapshotRenderer,
  /foreach \(\['concatenate_scripts', 'compress_scripts', 'compress_css'\] as \$flag\)[\s\S]*?\$GLOBALS\['concatenate_scripts'\] = false;[\s\S]*?\$GLOBALS\['compress_scripts'\] = false;[\s\S]*?\$GLOBALS\['compress_css'\] = false;[\s\S]*?finally \{[\s\S]*?foreach \(\$dependency_output_flags as \$flag => \$state\)[\s\S]*?if \(\$state\['exists'\]\) \$GLOBALS\[\$flag\] = \$state\['value'\];[\s\S]*?else unset\(\$GLOBALS\[\$flag\]\)/,
  'snapshot dependencies must bypass load-scripts/load-styles concatenation and restore every WordPress output flag',
);
assert.match(
  snapshotRenderer,
  /\$previous_user_id = function_exists\('get_current_user_id'\)[\s\S]*?wp_set_current_user\(0\);[\s\S]*?finally \{[\s\S]*?if \(\$user_was_switched\) wp_set_current_user\(\$previous_user_id\)/,
  'the public Elementor snapshot must render as visitor user 0 and restore the activating administrator in finally',
);
assert.match(
  snapshotRenderer,
  /get_builder_content_for_display\(\$post_id, true\)[\s\S]*?\$query->is_page = true;[\s\S]*?\$query->is_singular = true;[\s\S]*?\$query->queried_object_id = \$post_id;[\s\S]*?enqueue_scripts\(\)/,
  'the queued frontend config must receive the published page context only after the recursion-safe widget render',
);
assert.match(
  bootstrap,
  /function kodety_is_elementor_pro_layer[\s\S]*?'elementor-pro\/elementor-pro\.php'[\s\S]*?'pro-elements\/pro-elements\.php'[\s\S]*?function kodety_deactivate_elementor_pro_before_activation[\s\S]*?deactivate_plugins\(\$active, true, false\)[\s\S]*?kodety_elementor_pro_deactivated_on_activation[\s\S]*?elementorFreeKeptActive/,
  'activation must disable Elementor Pro and Pro Elements while recording that Elementor Free stays available',
);
assert.doesNotMatch(
  deactivationRoutine,
  /kodety_capture_elementor_rendered_snapshot_before_deactivation\(\)/,
  'activation must not render while a Pro layer is still loaded in the current PHP request',
);
assert.match(
  bootstrap,
  /kodety_prevent_elementor_pro_activation_request[\s\S]*?'activate-selected'[\s\S]*?kodety_is_elementor_pro_layer[\s\S]*?ativação bloqueada com segurança[\s\S]*?kodety_deactivate_elementor_pro_after_external_activation/,
  'wp-admin and external activation paths must not leave a Pro layer active beside Kodety',
);
assert.match(
  bootstrap,
  /\$html === '' && function_exists\('wp_safe_remote_get'\)[\s\S]*?wp_safe_remote_get/,
  'a successful local Elementor render must not trigger one loopback HTTP request per page',
);
assert.match(
  snapshotRenderer,
  /wp_style_is\('elementor-post-' \. \$post_id, 'registered'\)[\s\S]*?wp_enqueue_style\('elementor-post-' \. \$post_id\)[\s\S]*?wp_style_is\('elementor-frontend', 'registered'\)/,
  'every snapshot must retain its post-specific stylesheet and shared Elementor frontend CSS',
);
assert.match(deactivationRoutine, /deactivate_plugins\(\$active, true, false\)[\s\S]*?is_plugin_active\('elementor\/elementor\.php'\)/);
assert.match(
  bootstrap,
  /did_action\('plugins_loaded'\)[\s\S]*?get_option\('active_plugins'[\s\S]*?During first activation[\s\S]*?add_action\('plugins_loaded', \$kodety_bootstrap, -100\)/,
  'the first activation request must not boot the Kodety runtime before incompatible Pro layers are removed',
);
assert.match(
  onboarding,
  /data-kodety-elementor-warning[\s\S]*?Elementor Pro\/Pro Elements foi desativado[\s\S]*?Elementor gratuito continua ativo[\s\S]*?data-kodety-elementor-inspect[\s\S]*?Examinar páginas do Elementor[\s\S]*?name="kodety_project_source" value="elementor"/,
  'the first onboarding screen must explain Pro-only deactivation and open the page inventory without converting',
);
assert.match(
  onboarding,
  /data-kodety-elementor-pages[\s\S]*?Páginas encontradas no Elementor[\s\S]*?name="kodety_elementor_post_id"[\s\S]*?data-snapshot-ready[\s\S]*?data-kodety-elementor-confirm[\s\S]*?Converter página selecionada/,
  'onboarding must list detected pages, expose capture readiness and require a second explicit conversion action',
);
assert.doesNotMatch(onboarding, /disabled\(!\$snapshot_ready\)/, 'a missing old snapshot must not block a page that can be rendered on demand');
assert.doesNotMatch(onboardingJs, /snapshotReady\s*===\s*'true'/, 'page selection must not be gated by an activation-time snapshot');
assert.match(
  onboardingJs,
  /data-kodety-elementor-inspect[\s\S]*?elementorSource\.checked = true[\s\S]*?updateSource\(\);[\s\S]*?show\(2\)[\s\S]*?event\.submitter\?\.matches\('\[data-kodety-elementor-confirm\]'\)[\s\S]*?validateElementorSelection\(\)/,
  'examining must navigate to the selector, while conversion validates the selected captured page',
);
assert.match(onboardingCss, /\.kodety-onboarding__elementor-action\s*\{[\s\S]*?focus-visible/);
assert.match(
  onboardingCss,
  /\.kodety-onboarding__choices\.has-elementor:not\(\.has-existing\)\s*\{\s*grid-template-columns:\s*repeat\(3,/,
  'Elementor, blank and ZIP choices must share one three-column row',
);
assert.match(
  onboardingCss,
  /@media \(max-width: 520px\)[\s\S]*?\.kodety-onboarding__choices\.has-existing,[\s\S]*?\.kodety-onboarding__choices\.has-elementor:not\(\.has-existing\),[\s\S]*?grid-template-columns:\s*1fr/,
  'all onboarding choice-grid variants must collapse cleanly on narrow screens',
);
assert.doesNotMatch(
  onboarding,
  /data-kodety-url-elementor-mode|name="kodety_platform"/,
  'remote Elementor URL import belongs to the dashboard URL importer, not onboarding',
);
assert.match(
  stageSelected,
  /elementor_published_project_zip\(\$post_id, \$source_url\)[\s\S]*?if \(is_wp_error\(\$zip_path\)\)[\s\S]*?throw new RuntimeException[\s\S]*?Nenhuma conversão estrutural incompleta foi aplicada[\s\S]*?stage_builder_import\(\$zip_path, \$filename, true, true\)/,
  'the selected-page converter must either stage the real published runtime or report the capture failure clearly',
);
assert.doesNotMatch(
  stageSelected,
  /elementor_native_project_zip|elementor-.*-nativo\.zip/,
  'the selected onboarding conversion must never replace a failed render with structural placeholders',
);
assert.doesNotMatch(plugin, /stage_default_elementor_import/, 'onboarding must never guess and immediately convert a default Elementor page');
assert.match(
  plugin,
  /import_source_is_same_wordpress\(\$source_url\)[\s\S]*?kodety_render_elementor_document_for_snapshot\(\$post_id, \$source_url\)[\s\S]*?elementor_rendered_snapshot_for_post\(\$post_id\)[\s\S]*?kodety_elementor_snapshot_missing[\s\S]*?fetch_external_project\(\$source_url/,
  'local conversion must render on demand with Elementor Free before consulting an old snapshot or external host policy',
);
assert.match(
  plugin,
  /data-e-type[\s\S]*?atomic-widget[\s\S]*?data-kodety-elementor-preserved[\s\S]*?import_remove_elementor_lenis_runtime/,
  'published conversion must recognize atomic widgets and remove only the incompatible Lenis scroll owner',
);
assert.match(importer, /preservedWidgetCount[\s\S]*?data-kodety-elementor-preserved/);
assert.match(importer, /\$preserved_mode = 'rendered-html'/, 'rendered widget fallbacks retain their provenance marker');
assert.match(
  plugin,
  /admin_post_kodety_convert_elementor_onboarding[\s\S]*?public function convert_elementor_onboarding\(\): void[\s\S]*?'kodety_elementor_import' => 'published'[\s\S]*?'kodety_html' => 'index\.html'/,
  'the successful onboarding action must open the staged published Elementor document',
);
assert.match(
  plugin,
  /\$elementor_post_id = absint\(\$posted\('kodety_elementor_post_id'\)\)[\s\S]*?kodety_elementor_convert_now[\s\S]*?stage_elementor_import\(\$elementor_post_id\)[\s\S]*?elseif \(\$source === 'elementor'\) \{\s*\$this->stage_elementor_import\(\$elementor_post_id\);/,
  'both the explicit selector button and normal completion must convert only the chosen page ID',
);

console.log('Contratos da interface e do commit Elementor aprovados.');
