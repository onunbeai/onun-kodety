import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import JSZip from "jszip";
import {
  DETERMINISTIC_ARCHIVE_DATE,
  REQUIRED_WORDPRESS_PLUGIN_FILES,
  assertPackageLockVersion,
  assertWordPressReleaseVersion,
  assertWordPressPluginVersion,
  collectManifestArtifactPaths,
  createDeterministicPluginArchive,
  forbiddenPluginPathReason,
  normalizePluginPath,
  sha256,
  synchronizeWordPressPluginVersion,
  validatePluginContract,
  verifyPluginArchive,
} from "./wordpress-package-contracts.mjs";

async function readJavaScriptTree(directoryUrl) {
  const sources = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) sources.push(await readJavaScriptTree(childUrl));
    else if (entry.name.endsWith(".js")) sources.push(await readFile(childUrl, "utf8"));
  }
  return sources.join("\n");
}

const [
  currentPackage,
  currentPackageLock,
  currentChangelog,
  builderCss,
  wordpressEditorCss,
  wordpressViteSource,
  pluginPackagingSource,
  extensionPackagingSource,
  distributionPackagingSource,
  localizationViteSource,
  sourceTestRunnerSource,
  helpTestSource,
  wordpressBootstrapSource,
  wordpressPluginSource,
  publishPanelSource,
  themeRuntimeFunctionsSource,
  themeRuntimeIndexSource,
] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../Wordpress/kodety/changelog.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/editor/wordpress-editor.css", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/vite.config.ts", import.meta.url), "utf8"),
  readFile(new URL("./package-wordpress-plugin.mjs", import.meta.url), "utf8"),
  readFile(new URL("./package-kodety-extensions.mjs", import.meta.url), "utf8"),
  readFile(new URL("./package-wordpress-distributions.mjs", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/vite.localization.config.ts", import.meta.url), "utf8"),
  readFile(new URL("./run-source-test-suite.mjs", import.meta.url), "utf8"),
  readFile(new URL("./test-kodety-help.mjs", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/kodety/kodety.php", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/kodety/includes/class-kodety-plugin.php", import.meta.url), "utf8"),
  readFile(new URL("../app/(builder)/kodety/html-editor/components/HtmlPublishPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/kodety/theme-runtime/functions.php", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/kodety/theme-runtime/index.php", import.meta.url), "utf8"),
]);
const currentWordPressVersion = assertWordPressReleaseVersion(currentPackage, currentPackageLock);
const [compiledEditorRuntime, compiledLocalizationRuntime] = await Promise.all([
  readJavaScriptTree(new URL("../Wordpress/kodety/assets/", import.meta.url)),
  readFile(
    new URL("../Wordpress/extensions/kodety-localization/assets/localization.js", import.meta.url),
    "utf8",
  ),
]);
assert.match(
  compiledEditorRuntime,
  /const [\w$]+="__kodety_figma__",[\w$]+=4,[\w$]+=5;/,
  "O runtime compilado deve reconhecer simultaneamente os pacotes Figma v4 e v5.",
);
assert.match(
  compiledEditorRuntime,
  /sceneFormat==="JSON_REST_V1"/,
  "O runtime compilado deve conter o receptor completo da cena Figma JSON_REST_V1.",
);
assert.match(
  compiledEditorRuntime,
  /editorLockUrl/,
  "O runtime compilado do WordPress deve carregar o lock exclusivo atual.",
);
assert.match(
  compiledEditorRuntime,
  /X-Kodety-Editor-Lease/,
  "O runtime compilado deve enviar a lease exata em toda mutação do Builder.",
);
for (const obsoleteRuntimeContract of [
  "collaborationTurnUrl",
  "collaborationChangesUrl",
  "collaborationSettingsUrl",
  "X-Kodety-Collaboration-Session",
  "Solicitar turno",
  "Passar para",
  "Conectando turno",
]) {
  assert.doesNotMatch(
    `${compiledEditorRuntime}\n${compiledLocalizationRuntime}`,
    new RegExp(obsoleteRuntimeContract),
    `Artefato compilado ainda contém o contrato multi-editor obsoleto: ${obsoleteRuntimeContract}.`,
  );
}
assert.equal(currentChangelog.releases.length, 1, "O changelog deve expor somente a versão atual.");
assert.equal(
  currentChangelog.releases[0]?.version,
  currentWordPressVersion,
  "A única release do changelog deve acompanhar a versão WordPress atual.",
);
const currentReleaseNotes = currentChangelog.releases[0]?.items?.join("\n") || "";
assert.ok(currentChangelog.releases[0]?.title?.includes(`Kodety ${currentWordPressVersion}`));
assert.ok(currentChangelog.releases[0]?.summary?.trim(), "A versão atual precisa de um resumo próprio.");
assert.ok(currentReleaseNotes.trim(), "A versão atual precisa de notas de alteração.");
// Previous release notes remain preserved when the active changelog rotates.
const changelogHistory = JSON.parse(await readFile(new URL("../Wordpress/kodety/changelog-history.json", import.meta.url), "utf8"));
const hotfixRelease = changelogHistory.releases.find(release => release.version === "1.1.36");
assert.ok(hotfixRelease, "O hotfix 1.1.36 deve permanecer no histórico após a próxima versão.");
const hotfixReleaseNotes = hotfixRelease.items?.join("\n") || "";
assert.match(hotfixRelease.title || "", /Hotfix geral/i);
assert.match(hotfixRelease.summary || "", /edição visual[\s\S]*?breakpoints[\s\S]*?canvas[\s\S]*?salvamento[\s\S]*?timeline/i);
assert.match(hotfixReleaseNotes, /classe selecionada[\s\S]*?ocultar uma imagem[\s\S]*?outras classes/i);
assert.match(hotfixReleaseNotes, /Enter[\s\S]*?variáveis[\s\S]*?eixos não editados/i);
assert.match(hotfixReleaseNotes, /gravação[\s\S]*?recuperação por projeto[\s\S]*?resposta de rede perdida/i);
assert.match(hotfixReleaseNotes, /sitemap XML[\s\S]*?CMS[\s\S]*?rollback[\s\S]*?Settings/i);
const trialRelease = changelogHistory.releases.find(release => release.version === "1.1.35");
assert.ok(trialRelease, "A release 1.1.35 deve permanecer no histórico após o hotfix.");
const trialReleaseNotes = trialRelease.items?.join("\n") || "";
assert.match(trialReleaseNotes, /única ativação vinculada ao site/i);
assert.match(trialReleaseNotes, /expiração assinada[\s\S]*?milissegundos[\s\S]*?falhas de conexão/i);
assert.match(trialReleaseNotes, /Builder aberto[\s\S]*?recursos gratuitos[\s\S]*?preservando o projeto/i);
assert.match(trialReleaseNotes, /português, inglês e espanhol[\s\S]*?licença paga/i);
assert.match(trialReleaseNotes, /Bloqueia novas ferramentas do Agent[\s\S]*?outro site/i);
const previousRelease = changelogHistory.releases.find(release => release.version === "1.1.34");
assert.ok(previousRelease, "A release anterior deve permanecer no histórico.");
const previousReleaseNotes = previousRelease.items?.join("\n") || "";
assert.match(
  previousRelease.title || "",
  /Kodety[\s\S]*?1\.1\.34[\s\S]*?Canvas Infinito[\s\S]*?íntegro[\s\S]*?fluido/i,
);
assert.match(
  previousRelease.summary || "",
  /Canvas Infinito[\s\S]*?abre corretamente[\s\S]*?página completa[\s\S]*?todos os breakpoints[\s\S]*?código interno do runtime/i,
);
assert.match(previousReleaseNotes, /contêiner[\s\S]*?Canvas Infinito[\s\S]*?zero pixel[\s\S]*?barra de ferramentas visível/i);
assert.match(previousReleaseNotes, /2%[\s\S]*?contêiner colapsado[\s\S]*?dimensões reais/i);
assert.match(previousReleaseNotes, /runtime[\s\S]*?fechamento estrutural real[\s\S]*?snippets HTML[\s\S]*?bridge/i);
assert.match(previousReleaseNotes, /JavaScript do editor[\s\S]*?interpretado[\s\S]*?texto[\s\S]*?breakpoints/i);
assert.match(previousReleaseNotes, /todos os breakpoints[\s\S]*?documento de referência leve[\s\S]*?breakpoint ativo[\s\S]*?edição/i);
assert.match(previousReleaseNotes, /seleção[\s\S]*?edição visual[\s\S]*?customização responsiva[\s\S]*?canvas único nativo/i);
assert.match(
  wordpressPluginSource,
  /add_action\('template_redirect', \[\$this, 'route_public_locale'\], -80\)/,
  "O redirect automático deve acontecer no hook oficial antes da renderização do tema.",
);
assert.match(
  wordpressPluginSource,
  /HTTP_CF_IPCOUNTRY[\s\S]*?wp_safe_redirect\(\$redirect_url, 302, 'Kodety Localization'\)/,
  "O redirect deve ler diretamente o país do edge e emitir somente um 302 seguro.",
);
assert.match(
  wordpressPluginSource,
  /public_locale_is_pagespeed_request[\s\S]*?HTTP_USER_AGENT[\s\S]*?Chrome-Lighthouse[\s\S]*?route_public_locale[\s\S]*?\$this->public_locale_is_pagespeed_request\(\)/,
  "O PageSpeed Insights deve sair antes de qualquer decisão de redirect automático.",
);
assert.doesNotMatch(
  wordpressPluginSource,
  /public_locale_redirect_preloads|header\('Link:|modulepreload; as=script|preload; as=style/,
  "O redirect geográfico não pode ler, alterar ou antecipar assets da página.",
);
assert.doesNotMatch(
  wordpressPluginSource,
  /Kodety_Analytics::current_request_country/,
  "A decisão de idioma não deve depender do runtime de Analytics.",
);
assert.doesNotMatch(
  `${wordpressPluginSource}\n${publishPanelSource}\n${themeRuntimeFunctionsSource}\n${themeRuntimeIndexSource}`,
  /browserCache|kodety_version_published_|kdy-release|write_cache_rules|KODETY_VERSIONED_ASSET/,
  "O mecanismo removido de versionamento por query não pode permanecer no pacote.",
);
assert.match(wordpressPluginSource, /public_upload_base_url[\s\S]*?\/wp-content/);
assert.match(wordpressPluginSource, /autoptimize_action_cachepurged/);
assert.doesNotMatch(
  `${wordpressPluginSource}\n${publishPanelSource}\n${compiledEditorRuntime}`,
  /responsiveImages|RESPONSIVE_IMAGES_SYNC_HOOK|Imagens responsivas automáticas|data-kodety-responsive-srcset/,
  "O pacote de rollback não pode reintroduzir o redimensionamento/srcset automático.",
);
assert.match(compiledEditorRuntime, /O projeto ainda está recebendo alterações\./, 'a navegação deve impedir a saída com alterações ainda não salvas');
assert.match(
  compiledEditorRuntime,
  /Building animations…[\s\S]*?Preparando animações…/,
  "O pacote do hotfix deve conter o fluxo atualizado de compilação das animações.",
);
assert.match(compiledEditorRuntime, /data-kodety-interactions-initial-paint/, "O ZIP deve conter a proteção da primeira exibição das animações.");
assert.match(compiledEditorRuntime, /data-html-editor-live-font-listening/, "O ZIP deve conter o carregamento de fontes no canvas sem reload.");
assert.match(compiledEditorRuntime, /data-kodety-google-font-classes/, "O ZIP deve materializar Google Fonts também no HTML publicado.");
assert.match(compiledEditorRuntime, /Preparing Google Fonts…[\s\S]*?Preparando Google Fonts…/, "O fluxo Publicar deve incluir projetos que usam somente Google Fonts.");
assert.match(pluginPackagingSource, /KODETY_WORDPRESS_CHUNK_MANIFEST/);
assert.match(
  wordpressViteSource,
  /\.\.\/lib\/html-editor\/fonts\/geist[\s\S]*?OFL-1\.1\.txt/,
  "O build deve copiar a fonte social e sua licença a partir do par source-owned.",
);
assert.doesNotMatch(
  wordpressViteSource,
  /node_modules\/next/,
  "O build WordPress não pode recuperar a fonte social do pacote Next.",
);
assert.match(
  pluginPackagingSource,
  /["']lib["'],\s*["']html-editor["'],\s*["']fonts["'],\s*["']geist["'],\s*["']Geist-Regular\.ttf["']/,
  "O empacotador deve usar a mesma fonte social source-owned do browser.",
);
assert.match(
  pluginPackagingSource,
  /["']lib["'],\s*["']html-editor["'],\s*["']fonts["'],\s*["']geist["'],\s*["']OFL-1\.1\.txt["']/,
  "O empacotador deve publicar a licença OFL adjacente à fonte social.",
);
assert.doesNotMatch(
  pluginPackagingSource,
  /["']next["']/,
  "O empacotador WordPress não pode depender do pacote Next.",
);
assert.match(
  pluginPackagingSource,
  /import \{[^}]*mkdirSync[^}]*\} from ["']node:fs["'];/,
  "O empacotador precisa importar o helper síncrono usado para criar o diretório do sidecar.",
);
assert.match(
  pluginPackagingSource,
  /rmSync\(chunkManifestPath, \{ force: true \}\);/,
  "O build principal precisa remover o sidecar anterior antes de recompilar.",
);
assert.match(
  pluginPackagingSource,
  /firstChunkModuleManifest\.equals\(secondChunkModuleManifest\)/,
  "O determinismo do build principal precisa incluir o sidecar de módulos.",
);
assert.match(pluginPackagingSource, /test-wordpress-bundle-graph\.mjs/);
assert.ok(
  pluginPackagingSource.indexOf("test-forms-runtime.mjs")
    < pluginPackagingSource.indexOf("test-wordpress-bundle-graph.mjs"),
  "O runtime de formulários copiado precisa ser validado antes da inspeção do bundle.",
);
assert.match(
  pluginPackagingSource,
  /KODETY_FORMS_SOURCE_ONLY:\s*["']0["']/,
  "O teste pós-build precisa comparar fonte e runtime copiado mesmo se o chamador estiver em modo source-only.",
);
assert.match(
  pluginPackagingSource,
  /requiredFiles:\s*\[observabilityRuntimePath\]/,
  "A verificação do ZIP precisa exigir o runtime de observabilidade.",
);
assert.ok(
  REQUIRED_WORDPRESS_PLUGIN_FILES.includes("includes/class-kodety-observability.php"),
  "O runtime de observabilidade deve ser obrigatório no pacote principal.",
);
assert.match(
  wordpressBootstrapSource,
  /require_once KODETY_DIR \. 'includes\/class-kodety-observability\.php';/,
  "O bootstrap precisa carregar a observabilidade antes do plugin principal.",
);
assert.match(
  wordpressBootstrapSource,
  /Kodety_Observability::register\(\);/,
  "O bootstrap precisa registrar a observabilidade fail-closed.",
);
assert.match(
  localizationViteSource,
  /KODETY_WORDPRESS_LOCALIZATION_CHUNK_MANIFEST[\s\S]*?writeFile/,
  "O build Localization precisa emitir o sidecar de módulos usado pelos budgets.",
);
assert.match(
  extensionPackagingSource,
  /if \(verifyDeterminism\)[\s\S]*?buildLocalization\(\);[\s\S]*?assertBuildRecordsEqual/,
  "O empacotamento precisa comparar duas compilações Localization byte a byte.",
);
assert.match(
  extensionPackagingSource,
  /firstLocalizationChunkManifest\.equals\(secondLocalizationChunkManifest\)/,
  "O determinismo de Localization precisa incluir o sidecar de módulos.",
);
for (const sidecarEnvironment of [
  "KODETY_WORDPRESS_CHUNK_MANIFEST",
  "KODETY_WORDPRESS_LOCALIZATION_CHUNK_MANIFEST",
]) {
  assert.match(
    distributionPackagingSource,
    new RegExp(sidecarEnvironment),
    `A distribuição final precisa preservar ${sidecarEnvironment} para auditoria.`,
  );
}
assert.match(
  distributionPackagingSource,
  /wordpress-performance\.json[\s\S]*?wordpress-performance\.md[\s\S]*?rmSync\(generatedArtifactPath, \{ force: true \}\);/,
  "A distribuição final precisa invalidar sidecars e relatórios anteriores antes do primeiro build.",
);
assert.match(
  currentPackage.scripts?.["ci:local"] || "",
  /ci:source-test[\s\S]*wordpress:zip -- --verify-determinism[\s\S]*wordpress:package:test/,
  "O CI local precisa repetir o contrato do pacote depois do build canônico, sem confiar em assets anteriores.",
);
assert.match(
  sourceTestRunnerSource,
  /KODETY_FORMS_SOURCE_ONLY:\s*['"]1['"]/,
  "A suíte pré-build precisa testar a fonte de Forms sem aprovar o asset compilado anterior.",
);
assert.match(
  sourceTestRunnerSource,
  /KODETY_SKILL_ARCHIVES_SOURCE_ONLY:\s*['"]1['"]/,
  "A suíte pré-build precisa validar a fonte do Skill sem aprovar ZIPs gerados por um build anterior.",
);
assert.doesNotMatch(
  sourceTestRunnerSource,
  /process\.env\.KODETY_(?:FORMS|SKILL_ARCHIVES)_SOURCE_ONLY\s*=/,
  "Os modos source-only devem existir somente no ambiente do subprocesso npm test.",
);
assert.match(sourceTestRunnerSource, /shell:\s*false/);
assert.match(
  helpTestSource,
  /process\.env\.KODETY_SKILL_ARCHIVES_SOURCE_ONLY\s*===\s*['"]1['"]/,
  "O teste do Skill deve reconhecer somente o modo source-only literal entregue ao subprocesso.",
);
assert.equal(
  helpTestSource.match(/KODETY_SKILL_ARCHIVES_SOURCE_ONLY/g)?.length,
  1,
  "O modo source-only do Skill deve ficar restrito ao gate de paridade dos arquivos gerados.",
);
assert.match(
  helpTestSource,
  /if \(!skipSkillArchiveParity\) \{[\s\S]*?stale standalone skill artifact/,
  "Somente a paridade entre a fonte canônica e os ZIPs gerados pode ser adiada até o pós-build.",
);
assert.match(
  currentPackage.scripts?.["wordpress:package:test"] || "",
  /^node scripts\/test-wordpress-package\.mjs && node scripts\/test-kodety-help\.mjs$/,
  "O gate pós-build do pacote precisa revalidar o Skill sem herdar o modo source-only do subprocesso.",
);
const distributionSteps = [
  "package-wordpress-plugin.mjs",
  "package-kodety-extensions.mjs",
  "package-kodety-file-system.mjs",
  "test-wordpress-browser-runtime-boundary.mjs",
  "report-wordpress-performance.mjs",
  "prepare-kodety-update.mjs",
].map(step => distributionPackagingSource.indexOf(step));
assert.ok(
  distributionSteps.every((offset, index) => (
    offset >= 0 && (index === 0 || offset > distributionSteps[index - 1])
  )),
  "A distribuição precisa compilar todos os pacotes antes do relatório e só então preparar o update.",
);
for (const nativeAnalyticsFile of [
  "includes/class-kodety-analytics.php",
  "includes/class-kodety-meta-capi.php",
  "includes/class-kodety-search-console.php",
]) {
  assert.ok(
    REQUIRED_WORDPRESS_PLUGIN_FILES.includes(nativeAnalyticsFile),
    `${nativeAnalyticsFile} deve ser obrigatório no ZIP principal.`,
  );
  assert.equal(
    pluginPackagingSource.includes(`"${nativeAnalyticsFile}"`),
    false,
    `${nativeAnalyticsFile} não pode ser filtrado do ZIP principal.`,
  );
  assert.ok(
    wordpressBootstrapSource.includes(`require_once KODETY_DIR . '${nativeAnalyticsFile}';`),
    `${nativeAnalyticsFile} deve ser carregado pelo bootstrap nativo.`,
  );
}
for (const nativeAnalyticsClass of ["Kodety_Analytics", "Kodety_Meta_CAPI", "Kodety_Search_Console"]) {
  assert.ok(
    wordpressBootstrapSource.includes(
      `register_activation_hook(__FILE__, ['${nativeAnalyticsClass}', 'activate']);`,
    ),
    `${nativeAnalyticsClass} deve participar da ativação do plugin principal.`,
  );
  assert.ok(
    wordpressBootstrapSource.includes(
      `register_deactivation_hook(__FILE__, ['${nativeAnalyticsClass}', 'deactivate']);`,
    ),
    `${nativeAnalyticsClass} deve participar da desativação do plugin principal.`,
  );
  assert.ok(
    wordpressBootstrapSource.includes(`${nativeAnalyticsClass}::instance();`),
    `${nativeAnalyticsClass} deve iniciar com o plugin principal.`,
  );
}
assert.doesNotMatch(
  extensionPackagingSource,
  /slug:\s*["']kodety-analytics["']/,
  "Analytics nativo não pode continuar sendo distribuído como extensão separada.",
);
assert.match(
  extensionPackagingSource,
  /rm\(path\.join\(output, ["']kodety-analytics\.zip["']\), \{ force: true \}\)/,
  "O build precisa remover um ZIP Analytics obsoleto deixado por versões anteriores.",
);
assert.match(
  extensionPackagingSource,
  /rm\(path\.join\(output, ["']kodety-analytics["']\), \{ recursive: true, force: true \}\)/,
  "O build precisa remover também o diretório Analytics obsoleto deixado por versões anteriores.",
);
for (const [surface, css] of [["Builder", builderCss], ["WordPress", wordpressEditorCss]]) {
  assert.match(
    css,
    /kodety-editor-inspector-tabs\s*\{[\s\S]*?height:\s*42px;[\s\S]*?padding:\s*5px 12px;[\s\S]*?> \[data-slot=(?:'|")tabs-trigger(?:'|")[\s\S]*?height:\s*32px;[\s\S]*?padding:\s*0 13px;[\s\S]*?font-size:\s*11px;/,
    `${surface}: Style, Settings e Interactions devem manter padding lateral e altura compacta.`,
  );
  assert.match(
    css,
    /kodety-editor-inspector-tabs[\s\S]*?\[data-state=(?:'|")active(?:'|")\]\s*\{[\s\S]*?background:\s*(?:color-mix\(in srgb, var\(--foreground\) 8%, transparent\)|rgb\(255 255 255 \/ 8%\)) !important;[\s\S]*?box-shadow:\s*none;[\s\S]*?color:\s*var\(--kodety-text(?:,|\))/,
    `${surface}: a aba ativa do Inspector deve ser cinza, sem stroke e sem usar o roxo da marca.`,
  );
}

const version = "2.4.6";
const [
  previewControllerSource,
  projectEditorSource,
  canvasStageSource,
  bufferedIframeSource,
  wordpressEntrySource,
  wordpressEntryConfigSource,
  projectSettingsSource,
  membersManagerSource,
  editorShellSource,
  sharingSource,
  editorTypesSource,
] = await Promise.all([
  readFile(new URL("../Wordpress/kodety/includes/class-kodety-plugin.php", import.meta.url), "utf8"),
  readFile(
    new URL("../app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../Wordpress/editor/main.tsx", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/editor/wordpress-entry-config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/(builder)/kodety/html-editor/components/HtmlMembersManager.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../Wordpress/kodety/templates/editor-shell.php", import.meta.url), "utf8"),
  readFile(new URL("../Wordpress/kodety/includes/class-kodety-sharing.php", import.meta.url), "utf8"),
  readFile(new URL("../lib/html-editor/editor-types.ts", import.meta.url), "utf8"),
]);
const focusedPreviewStart = projectEditorSource.indexOf("const enterFocusedPreview =");
const focusedPreviewEnd = projectEditorSource.indexOf("const leaveFocusedPreview =", focusedPreviewStart);
const focusedPreviewSource =
  focusedPreviewStart >= 0 && focusedPreviewEnd > focusedPreviewStart
    ? projectEditorSource.slice(focusedPreviewStart, focusedPreviewEnd)
    : "";
assert.ok(
  editorShellSource.indexOf("apply_filters('kodety_editor_shell_config'")
    < editorShellSource.indexOf('Kodety_Observability::enabled_for_shell($is_shared)'),
  "A flag de performance precisa ser decidida depois do filtro para que o filtro não possa habilitá-la.",
);
assert.match(
  editorShellSource,
  /Kodety_Observability::enabled_for_shell\(\$is_shared\)[\s\S]*?\$config\['performanceDebug'\][\s\S]*?unset\(\$config\['performanceDebug'\]\)/,
  "O shell deve expor performanceDebug somente pelo gate PHP literal e removê-la nos demais contextos.",
);
assert.match(
  previewControllerSource,
  /Kodety_Edition::assert_cookie_consent_activation\(\$html_files\);[\s\S]*?Kodety_Edition::assert_analytics_pro_activation\(\$html_files, \$root\);/,
  "Toda publicação precisa validar os artefatos Analytics Pro antes de trocar o tema ativo.",
);
assert.ok(focusedPreviewSource, "O fluxo de entrada no Preview precisa existir.");
assert.match(
  `${projectEditorSource}\n${canvasStageSource}`,
  /Hosted preview is an explicit sharing\/export capability[\s\S]*?const hostedPreviewAvailable =[\s\S]*?const preview = useMemo/,
  "A URL hospedada deve ser apenas uma capacidade explícita de compartilhamento.",
);
assert.match(
  focusedPreviewSource,
  /studioRuntimeRouteUrl\(topbarWp, '\/kodety\/editor\/'\)[\s\S]*?kodety-preview-review[\s\S]*?kodety-preview-viewport[\s\S]*?window\.open\('about:blank', '_blank'\)[\s\S]*?popupDocument\.body\.replaceChildren\(shell\)[\s\S]*?const savePromise =[\s\S]*?previewTab\.location\.replace\(latestRoute\)[\s\S]*?savePromise\.then\(openPersistedReview, error =>/,
  "O botão Preview deve reservar a aba no gesto do usuário, mostrar um shell e navegar uma única vez depois de persistir o estado atual.",
);
assert.match(
  focusedPreviewSource,
  /const prepareWorkspacePreview = workspaceRef\.current\?\.preparePreview;\s*const savePromise = prepareWorkspacePreview\s*\? prepareWorkspacePreview\(current\)\s*: saveProjectNow\(\{ notifySuccess: false \}\);/,
  "O Preview HTML deve aguardar a persistência do host; sem esse host, o WordPress deve manter o Save silencioso existente.",
);
assert.match(
  focusedPreviewSource,
  /savePromise\.then\(openPersistedReview, error => \{\s*if \(!prepareWorkspacePreview\) \{\s*openPersistedReview\(\);\s*return;\s*\}/,
  "Uma falha no Save WordPress deve preservar o fallback anterior para a rota de review, sem aplicar esse fallback ao host HTML.",
);
assert.match(
  focusedPreviewSource,
  /if \(previewReviewWindowRef\.current !== previewTab\) return;[\s\S]*?if \(focusedPreviewTabRef\.current === previewTab\) focusedPreviewTabRef\.current = null;\s*if \(previewReviewWindowRef\.current === previewTab\) previewReviewWindowRef\.current = null;\s*focusedPreviewRouteRef\.current = '';\s*try \{ previewTab\.close\(\); \}[\s\S]*?toast\.error[\s\S]*?\.finally\(\(\) => \{\s*if \(focusedPreviewSaveRef\.current === savePromise\) focusedPreviewSaveRef\.current = null;/,
  "Uma falha de persistência HTML deve fechar apenas a aba reservada, limpar a rota e os marcadores pendentes e informar o erro.",
);
const htmlPreviewFailureSource = focusedPreviewSource.slice(
  focusedPreviewSource.indexOf('if (previewReviewWindowRef.current !== previewTab) return;'),
  focusedPreviewSource.indexOf('}).finally(() => {'),
);
assert.doesNotMatch(
  htmlPreviewFailureSource,
  /openPersistedReview\(|\.location\.(?:replace|assign|href)/,
  "Uma falha no salvamento obrigatório HTML nunca deve navegar para um snapshot antigo.",
);
assert.ok(
  focusedPreviewSource.indexOf("window.open('about:blank', '_blank')")
    < focusedPreviewSource.indexOf('const prepareWorkspacePreview ='),
  "A reserva síncrona da aba deve acontecer antes de qualquer espera assíncrona para não acionar o bloqueador de pop-up.",
);
assert.doesNotMatch(
  focusedPreviewSource,
  /prepareHostedPreview|projectToPublishPackage/,
  "Entrar no Preview não pode iniciar carregamento hospedado nem empacotar o projeto novamente.",
);
assert.match(
  canvasStageSource,
  /title="Preview executável do projeto HTML"[\s\S]*?srcDoc=\{preview\.html\}[\s\S]*?onBufferedLoad=\{\(event, bufferedGeneration, _revision, _surfaceKey, semanticNavigation\) => \{[\s\S]*?sendRuntimeAssetsToFrame\([\s\S]*?semanticNavigation \? 'fonts' : 'all',[\s\S]*?bufferedGeneration/,
  "O Preview visual deve reutilizar o srcDoc e manter a transferência de assets ligada à geração em buffer.",
);
assert.match(
  bufferedIframeSource,
  /progressiveSemanticNavigation[\s\S]*?semanticNavigation[\s\S]*?markDocumentPaintReady\(document\.mountKey\)/,
  "A promoção no load precisa continuar atrás de um opt-in explícito do iframe.",
);
const packagedPageCanvasStart = canvasStageSource.indexOf('data-page-editor-canvas-surface');
const packagedComponentCanvasStart = canvasStageSource.indexOf('data-component-editor-canvas-surface');
assert.ok(
  packagedPageCanvasStart >= 0 && packagedComponentCanvasStart > packagedPageCanvasStart,
  "As superfícies isoladas de página e componente precisam existir.",
);
const packagedPageCanvasSource = canvasStageSource.slice(
  packagedPageCanvasStart,
  packagedComponentCanvasStart,
);
const packagedNonPageCanvasSource = canvasStageSource.slice(packagedComponentCanvasStart);
assert.match(
  canvasStageSource,
  /const localizedDesignCanvas = resolvedActiveLocale !== localizationSourceLocale;/,
  "Somente um locale não-fonte pode ativar o ciclo progressivo do Design.",
);
assert.match(
  packagedPageCanvasSource,
  /retainDocument=\{!localizedDesignCanvas\}[\s\S]*?pinRetainedDocument=\{!localizedDesignCanvas\}[\s\S]*?progressiveSemanticNavigation=\{localizedDesignCanvas\}/,
  "O Design traduzido precisa desmontar caches semânticos e assumir no load.",
);
assert.doesNotMatch(
  packagedNonPageCanvasSource,
  /progressiveSemanticNavigation/,
  "Design de componente e Preview executável não podem promover no load.",
);
assert.match(
  bufferedIframeSource,
  /function isBufferedDocumentPaintReadyMessage\(data: unknown\)[\s\S]*?return type === 'html-editor-buffer-visuals-ready';[\s\S]*?!isBufferedDocumentPaintReadyMessage\(event\.data\)[\s\S]*?markDocumentPaintReady\(document\.mountKey\);[\s\S]*?schedulePromotion\(\);/,
  "O caminho padrão de promoção deve continuar dependendo do sinal forte html-editor-buffer-visuals-ready.",
);
const packagePendingLoadStart = bufferedIframeSource.indexOf('  const handlePendingLoad = useCallback');
const packagePendingLoadEnd = bufferedIframeSource.indexOf(
  '  const retainedDocuments =',
  packagePendingLoadStart,
);
const packagePendingLoadSource =
  packagePendingLoadStart >= 0 && packagePendingLoadEnd > packagePendingLoadStart
    ? bufferedIframeSource.slice(packagePendingLoadStart, packagePendingLoadEnd)
    : '';
assert.ok(packagePendingLoadSource, "O callback de load do iframe em buffer deve existir.");
assert.doesNotMatch(
  packagePendingLoadSource,
  /schedulePromotion|promotePendingDocument|setTimeout/,
  "Load/timeout não podem promover a geração em buffer.",
);
assert.doesNotMatch(
  projectEditorSource,
  /title="Preview do site"/,
  "A superfície visual não pode voltar a depender do iframe hospedado.",
);
const membersManagerInvocationStart = projectEditorSource.indexOf('<HtmlMembersManager');
const membersManagerInvocation = membersManagerInvocationStart >= 0
  ? projectEditorSource.slice(membersManagerInvocationStart, membersManagerInvocationStart + 1_200)
  : '';
assert.match(
  membersManagerInvocation,
  /readOnly=\{sharedReadOnly\}/,
  "A Área de Membros deve receber o lock somente leitura da sessão do Builder.",
);
assert.match(
  membersManagerSource,
  /readOnly\?: boolean[\s\S]*?readOnly = false/,
  "O manager de Membership deve aceitar modo somente leitura sem quebrar hosts existentes.",
);
for (const capability of [
  'canManageMembers',
  'canCreateMembers',
  'canAssignPlans',
  'canManageCommerce',
  'canManagePlans',
  'canManageSettings',
]) {
  assert.match(
    membersManagerSource,
    new RegExp(`const ${capability} = !readOnly &&`),
    `O modo somente leitura deve neutralizar ${capability} na Área de Membros.`,
  );
}
assert.match(
  membersManagerSource,
  /canManageSettings=\{!readOnly && Boolean\(overview\?\.capabilities\.manageSettings\)\}/,
  "Uma sessão bloqueada não pode ativar a Área de Membros.",
);
assert.doesNotMatch(
  previewControllerSource,
  /preview_asset_proxy_reference|__asset\//,
  "O preview não pode transformar assets locais em um proxy opaco processado pelo PHP.",
);
assert.match(
  previewControllerSource,
  /header\('Access-Control-Allow-Origin: \*', true\)/,
  "Respostas do namespace público de preview devem continuar embutíveis fora do Builder.",
);
assert.match(wordpressEntrySource, /const editorLockEnabled = wordpressEntryEditorLockEnabled\(entryConfig\)/);
assert.match(wordpressEntryConfigSource, /wordpressEntryAppView\(config, location\) === 'editor' && Boolean\(config\?\.editorLockUrl\)/);
const editorLockHeadersSource = wordpressEntrySource.slice(
  wordpressEntrySource.indexOf('const execute ='),
  wordpressEntrySource.indexOf('if (shareToken)', wordpressEntrySource.indexOf('const execute =')),
);
assert.match(
  editorLockHeadersSource,
  /if \(editorLockEnabled\) \{[\s\S]*?'X-Kodety-Editor-Session'[\s\S]*?editorSession[\s\S]*?'X-Kodety-Editor-Lease'[\s\S]*?(?:kodetyEditorLease|editorLease)/,
  "Somente o editor visual deve identificar sessão e lease ao lock exclusivo.",
);
assert.match(
  editorTypesSource,
  /editorLockUrl\?: string/,
  "O contrato do Builder deve expor somente o endpoint do lock exclusivo.",
);
assert.match(
  editorShellSource,
  /'editorLockUrl' => \$resolved_app_view === 'editor' && \(\$can_edit_workspace \|\| \$is_shared\)[\s\S]*?rest_url\('kodety\/v1\/editor-lock'\)/,
  "O lock deve existir somente no editor visual, independentemente do plano de colaboração.",
);
for (const removedConfigKey of [
  'collaborationUrl',
  'collaborationTurnUrl',
  'collaborationChangesUrl',
  'collaborationSettingsUrl',
]) {
  assert.doesNotMatch(
    `${editorShellSource}\n${editorTypesSource}\n${wordpressEntryConfigSource}`,
    new RegExp(`\\b${removedConfigKey}\\b`),
    `A configuração removida ${removedConfigKey} não pode voltar ao shell do Builder.`,
  );
}
assert.match(
  sharingSource,
  /register_rest_route\('kodety\/v1', '\/editor-lock'[\s\S]*?'methods' => 'POST'[\s\S]*?'methods' => 'DELETE'/,
  "O WordPress deve adquirir, renovar e liberar um único lock de edição.",
);
for (const removedRoute of ['/collaboration/turn', '/collaboration/changes', '/collaboration/settings']) {
  assert.doesNotMatch(
    sharingSource,
    new RegExp(`register_rest_route\\('kodety\\/v1', '${removedRoute.replaceAll('/', '\\/')}'`),
    `A rota multi-editor removida ${removedRoute} não pode voltar ao pacote.`,
  );
}
const restLockBoundarySource = sharingSource.slice(
  sharingSource.indexOf('public function enforce_rest_boundary'),
  sharingSource.indexOf('public function grant_share_capabilities'),
);
assert.match(
  restLockBoundarySource,
  /!\$read[\s\S]*?!\$lock_exempt[\s\S]*?has_editor_lock\(\$request, false\)/,
  "Escritas do Builder devem exigir o lock da sessão exata; rotas compartilhadas com wp-admin respeitam seu próprio contexto.",
);
assert.doesNotMatch(
  restLockBoundarySource,
  /Kodety_Edition::has\('collaboration'\)|\$collaboration_enabled/,
  "A proteção de escrita não pode depender do entitlement de colaboração.",
);
assert.match(
  sharingSource,
  /trim\(\(string\) \$request->get_header\('x-kodety-editor-session'\)\) !== ''[\s\S]*?trim\(\(string\) \$request->get_header\('x-kodety-editor-lease'\)\) !== ''/,
  "Headers ausentes retornam null no WP_REST_Request e devem ser normalizados antes de detectar contexto do Builder.",
);
assert.doesNotMatch(
  restLockBoundarySource,
  /\$request->get_header\('x-kodety-editor-(?:session|lease)'\) !== ''/,
  "Comparar diretamente o header opcional com string vazia bloquearia POSTs públicos de Analytics, Membership e Commerce.",
);
assert.doesNotMatch(
  restLockBoundarySource,
  /has_active_editor_lock|\$workspace_route|\$workspace_prefix/,
  "A fronteira de sessão não deve tratar rotas administrativas ou workspaces não visuais como editor visual.",
);
assert.match(
  wordpressEntrySource,
  /refreshRestSession[\s\S]*?restNonceUrl[\s\S]*?rest_cookie_invalid_nonce[\s\S]*?execute\(renewedNonce\)/,
  "Uma sessão longa do Builder deve renovar o nonce REST e repetir a escrita recusada sem perder o projeto em memória.",
);
assert.match(
  previewControllerSource,
  /wp_ajax_kodety_refresh_rest_session[\s\S]*?refresh_rest_session\(\)[\s\S]*?wp_create_nonce\('wp_rest'\)[\s\S]*?projectDownloadUrl/,
  "O WordPress deve renovar tanto o nonce REST quanto a URL privada de download para o Builder aberto por muito tempo.",
);
const draftLockGuardSource = previewControllerSource.slice(
  previewControllerSource.indexOf('private function project_draft_editor_'),
  previewControllerSource.indexOf('/** Draft activation', previewControllerSource.indexOf('private function project_draft_editor_')),
);
assert.match(
  draftLockGuardSource,
  /has_editor_lock\(\$request\)/,
  "Salvar o rascunho pelo editor visual deve verificar a lease da sessão.",
);
assert.doesNotMatch(
  draftLockGuardSource,
  /Kodety_Edition|has_editor_seat|\$collaboration_enabled/,
  "O lock de rascunho deve valer para todas as edições, sem entitlement ou vaga multi-editor.",
);
assert.doesNotMatch(
  `${previewControllerSource}\n${sharingSource}`,
  /\bhas_editor_seat\b/,
  "O backend não pode manter a autorização antiga baseada em vaga multi-editor.",
);
assert.ok(
  (previewControllerSource.match(/project_draft_editor_lock_error\(\$request\)/g) || []).length >= 2,
  "O upload direto e o upload em blocos devem aplicar o mesmo lock exclusivo.",
);
assert.match(
  previewControllerSource,
  /public function admin_import\(\): void[\s\S]*?admin_import_editor_lock_error\(\)[\s\S]*?public function save_project_draft_chunk[\s\S]*?\$admin_import[\s\S]*?admin_import_editor_lock_error\(\$request\)[\s\S]*?public function admin_import_url\(\): void[\s\S]*?admin_import_editor_lock_error\(\)/,
  "Importações administrativas por ZIP direto, ZIP em blocos e URL devem respeitar somente locks realmente ativos.",
);
assert.match(
  previewControllerSource,
  /register_rest_route\('kodety\/v1', '\/project\/chunk'[\s\S]*?save_project_draft_chunk[\s\S]*?PROJECT_DRAFT_CHUNK_MAX_BYTES[\s\S]*?complete_chunked_admin_import/,
  "ZIPs grandes do Builder e do painel devem atravessar o servidor em blocos limitados.",
);
const publishProjectSource = previewControllerSource.slice(
  previewControllerSource.indexOf('public function publish_project'),
  previewControllerSource.indexOf('public function publish_status'),
);
assert.match(
  publishProjectSource,
  /x-kodety-publish-workspace[\s\S]*?with_workspace_lock[\s\S]*?package_editable_workspace_as_zip\(\s*\$workspace[\s\S]*?install_zip\(\s*\$publish_path/,
  "Publicar uma revisão salva deve empacotar o workspace vivo sob lock sem exigir outro ZIP do navegador.",
);
assert.doesNotMatch(
  publishProjectSource,
  /project_zip_cache_path|cached_path/,
  "O cache privado de download não pode ser tratado como autoridade de publicação.",
);
assert.match(
  publishProjectSource,
  /\$preserve_editable_workspace\s*=\s*\$publish_saved_workspace[\s\S]*?install_zip\([\s\S]*?\$preserve_editable_workspace/,
  "Publicar a revisão salva deve preservar o workspace autoritativo e sua revisão.",
);
assert.match(
  projectSettingsSource,
  /const expanded = forceOpen \|\| open;[\s\S]*?forceOpen=\{integrationsLocked\}[\s\S]*?collapseId="integrations-analytics"[\s\S]*?forceOpen=\{integrationsLocked\}[\s\S]*?collapseId="integrations-mcp"/,
  "Analytics e MCP bloqueados devem permanecer expandidos para demonstrar os recursos Pro.",
);
assert.match(
  projectSettingsSource,
  /\{\(integrationsLocked \|\| Boolean\(wordpress\?\.aiSettingsUrl\)\) && \([\s\S]*?title="IA de conteúdo"[\s\S]*?forceOpen=\{integrationsLocked\}/,
  "A configuração de IA deve continuar visível e expandida como demonstração sem licença.",
);
assert.match(
  projectSettingsSource,
  /const DEFAULT_AI_TEMPERATURE = 1;[\s\S]*?temperature: DEFAULT_AI_TEMPERATURE/,
  "A criatividade da IA deve iniciar em 1 antes da configuração remota carregar.",
);
assert.equal(
  (projectSettingsSource.match(/aiCanonicalRef\.current = normalizeAiSettingsTemperature\(payload\);\s*setAiSettings\(aiCanonicalRef\.current\)/g) || []).length,
  2,
  "Leitura e salvamento da IA devem normalizar respostas ausentes ou inválidas para o novo default.",
);
assert.match(
  projectSettingsSource,
  /<SettingsField label="Criatividade">[\s\S]*?<Slider[\s\S]*?value=\{\[aiSettings\.temperature\]\}[\s\S]*?onValueChange=\{\(\[temperature\]\)/,
  "A criatividade deve continuar editável depois de adotar o default 1.",
);
const bootstrap = `<?php
/**
 * Plugin Name: Kodety
 * Version: ${version}
 */
define('KODETY_VERSION', '${version}');
`;
const manifest = {
  "Wordpress/editor/main.tsx": {
    file: "assets/main-deadbeef.js",
    css: ["assets/main-deadbeef.css"],
    isEntry: true,
  },
};
const files = [
  ...REQUIRED_WORDPRESS_PLUGIN_FILES,
  "assets/assets/main-deadbeef.js",
  "assets/assets/main-deadbeef.css",
];
const sizes = new Map(files.map((filePath) => [filePath, 1]));
sizes.set("kodety.php", Buffer.byteLength(bootstrap));

assert.deepEqual(assertWordPressPluginVersion(bootstrap, version), {
  header: version,
  constant: version,
});
assert.equal(
  synchronizeWordPressPluginVersion(bootstrap, "3.0.1").includes(
    "define('KODETY_VERSION', '3.0.1');",
  ),
  true,
);
assert.throws(
  () => assertWordPressPluginVersion(bootstrap, "2.4.7"),
  /diverge do package\.json/,
);
assert.throws(
  () =>
    assertWordPressPluginVersion(
      bootstrap.replace(`'${version}'`, "'9.9.9'"),
      version,
    ),
  /Versoes internas divergentes/,
);
assert.equal(normalizePluginPath("assets\\main.js"), "assets/main.js");
assert.throws(() => normalizePluginPath("../secrets.env"), /travessia/);
assert.equal(
  forbiddenPluginPathReason("assets/app.js.map"),
  "source map de desenvolvimento",
);
assert.equal(
  forbiddenPluginPathReason(".env.production"),
  "arquivo de ambiente potencialmente secreto",
);
assert.equal(forbiddenPluginPathReason("assets/main.js"), null);

assert.deepEqual(collectManifestArtifactPaths(manifest), [
  "assets/main-deadbeef.css",
  "assets/main-deadbeef.js",
]);
assert.throws(
  () =>
    collectManifestArtifactPaths({
      entry: { file: "../outside.js", isEntry: true },
    }),
  /travessia/,
);
assert.throws(
  () => collectManifestArtifactPaths({ chunk: { file: "assets/chunk.js" } }),
  /entry point/,
);

const report = validatePluginContract({
  files,
  fileSizes: sizes,
  manifest,
  packageVersion: version,
  pluginSource: bootstrap,
});
assert.equal(report.fileCount, files.length);
assert.equal(report.manifestArtifactCount, 2);
assert.throws(
  () =>
    validatePluginContract({
      files: files.filter((filePath) => filePath !== "assets/forms-runtime.js"),
      fileSizes: sizes,
      manifest,
      packageVersion: version,
      pluginSource: bootstrap,
    }),
  /Artefato obrigatorio ausente: assets\/forms-runtime\.js/,
);
assert.throws(
  () =>
    validatePluginContract({
      files: [...files, ".DS_Store"],
      fileSizes: sizes,
      manifest,
      packageVersion: version,
      pluginSource: bootstrap,
    }),
  /Arquivo proibido \.DS_Store/,
);

const packageJson = { name: "kodety", version };
const packageLock = {
  name: "kodety",
  version,
  packages: { "": { name: "kodety", version } },
};
assert.equal(assertPackageLockVersion(packageJson, packageLock), version);
assert.equal(
  assertWordPressReleaseVersion(
    { ...packageJson, kodety: { wordpressVersion: "1.1.01" } },
    packageLock,
  ),
  "1.1.01",
);
assert.throws(
  () =>
    assertPackageLockVersion(packageJson, { ...packageLock, version: "0.0.1" }),
  /package\.json e package-lock\.json divergentes/,
);

const archiveRecords = [
  {
    path: "assets/main.js",
    data: Buffer.from('console.log("kodety")'),
    size: 20,
  },
  {
    path: "kodety.php",
    data: Buffer.from(bootstrap),
    size: Buffer.byteLength(bootstrap),
  },
];
const archiveA = await createDeterministicPluginArchive(archiveRecords);
const archiveB = await createDeterministicPluginArchive(
  [...archiveRecords].reverse(),
);
assert.equal(
  archiveA.equals(archiveB),
  true,
  "A ordem de entrada nao pode alterar o ZIP.",
);
assert.equal(sha256(archiveA), sha256(archiveB));
const archiveReport = await verifyPluginArchive(archiveA, {
  records: archiveRecords,
  expectedVersion: version,
});
assert.equal(archiveReport.fileCount, 2);
assert.match(archiveReport.sha256, /^[a-f0-9]{64}$/);

const parsedArchive = await JSZip.loadAsync(archiveA);
assert.equal(
  parsedArchive.file("kodety/kodety.php").date.toISOString(),
  DETERMINISTIC_ARCHIVE_DATE.toISOString(),
);
await assert.rejects(
  () =>
    createDeterministicPluginArchive([
      ...archiveRecords,
      { path: ".env", data: Buffer.from("SECRET=1") },
    ]),
  /Arquivo proibido no ZIP/,
);

console.log("Contratos de build e release WordPress aprovados.");
