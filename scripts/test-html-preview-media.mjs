import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bufferedIframeSource, projectEditorSource, canvasStageSource, pluginSource, editorShellSource, previewSource] = await Promise.all([
  readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlBufferedIframe.tsx'),
    'utf8',
  ),
  readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  ),
  readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCanvasStage.tsx'),
    'utf8',
  ),
  readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  readFile(path.join(root, 'Wordpress/kodety/templates/editor-shell.php'), 'utf8'),
  readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8'),
]);

assert.match(
  bufferedIframeSource,
  /sandbox="allow-scripts"[\s\S]*?srcDoc=\{OPAQUE_DOCUMENT_FACTORY_HTML\}/,
  'the player rewriter must execute in an opaque sandbox that cannot read the Builder',
);
assert.match(
  bufferedIframeSource,
  /parent\.postMessage\(\{ channel, type: 'created', id, html \}, '\*'\)/,
  'the player rewriter must return HTML without changing the Preview document base URL',
);
assert.match(
  bufferedIframeSource,
  /const previewHtml = preparedForCurrentDocument && prepared \? prepared\.html : srcDoc[\s\S]*?const mountableDocument[\s\S]*?<HtmlBufferedIframe[\s\S]*?srcDoc=\{mountableDocument\.html\}[\s\S]*?sandbox=\{sandbox\}/,
  'the executable Preview must keep sandboxed srcDoc so relative assets and authored scripts work',
);
assert.match(
  bufferedIframeSource,
  /interface MountableOpaqueDocument \{[\s\S]*?documentRevision: number[\s\S]*?surfaceKey: string[\s\S]*?const lastMountableDocumentRef = useRef<[\s\S]*?lastMountableDocumentRef\.current = currentMountableDocument[\s\S]*?const mountableDocument = currentMountableDocument \|\| lastMountableDocumentRef\.current[\s\S]*?documentRevision=\{mountableDocument\.documentRevision\}[\s\S]*?surfaceKey=\{mountableDocument\.surfaceKey\}/,
  'switching to a player page must keep the outgoing Preview HTML and semantic identity mounted until preparation completes',
);
assert.match(
  bufferedIframeSource,
  /const requiresPlayerPreparation = \/<iframe[\s\S]*?youtube[\s\S]*?vimeo[\s\S]*?const previewCanMount = !requiresPlayerPreparation[\s\S]*?\|\| preparationFailed/,
  'ordinary pages must bypass optional player preparation and player failures must fail open',
);
assert.match(
  bufferedIframeSource,
  /setTimeout\(\(\) => \{[\s\S]*?setPreparationFailed\(true\)[\s\S]*?\}, 1200\)/,
  'a blocked player factory must not leave Preview stuck behind Design',
);
assert.match(
  bufferedIframeSource,
  /className="pointer-events-none absolute size-px opacity-0"/,
  'the isolated factory must remain loadable instead of using display:none',
);
assert.doesNotMatch(
  bufferedIframeSource,
  /sandboxTokens\.add\('allow-same-origin'\)|src=\{prepared\.url\}/,
  'authored Preview code must never become same-origin with the authenticated Builder',
);
assert.match(
  bufferedIframeSource,
  /youtube-nocookie/,
  'the isolated Preview must recognize YouTube privacy-enhanced embeds',
);
assert.match(
  bufferedIframeSource,
  /host === 'vimeo\.com'[\s\S]*?host\.endsWith\('\.vimeo\.com'\)/,
  'the isolated Preview must recognize Vimeo embeds',
);
assert.match(
  bufferedIframeSource,
  /frame\.setAttribute\('referrerpolicy', 'strict-origin-when-cross-origin'\)[\s\S]*?addPlayerPermissions\(frame\)/,
  'recognized players must receive a provider-compatible referrer policy and media permissions',
);
assert.match(
  bufferedIframeSource,
  /'accelerometer',[\s\S]*?'autoplay',[\s\S]*?'encrypted-media',[\s\S]*?'fullscreen',[\s\S]*?'picture-in-picture',[\s\S]*?'web-share'/,
  'recognized players must receive all playback permissions',
);
assert.match(
  bufferedIframeSource,
  /url\.searchParams\.set\('origin', clientOrigin\)[\s\S]*?url\.searchParams\.set\('widget_referrer', clientOrigin\)/,
  'YouTube embeds must receive explicit client identity when the Preview has an opaque origin',
);
assert.match(
  bufferedIframeSource,
  /const shellUrl = new URL\(youtubeEmbedUrl\)[\s\S]*?shellUrl\.searchParams\.set\('url', url\.toString\(\)\)[\s\S]*?frame\.setAttribute\('src', shellUrl\.toString\(\)\)/,
  'YouTube must use the trusted HTTP shell that can emit its required Referer',
);
assert.match(
  canvasStageSource,
  /data-page-editor-canvas-surface[\s\S]*?<HtmlBufferedIframe[\s\S]*?srcDoc=\{pageCanvasPreview\?\.html \|\| ''\}/,
  'Design must keep the isolated static page srcDoc canvas',
);
assert.match(
  canvasStageSource,
  /data-component-editor-canvas-surface[\s\S]*?<HtmlBufferedIframe[\s\S]*?srcDoc=\{componentCanvasPreview\.html\}/,
  'component editing must use its own isolated static srcDoc canvas',
);
assert.match(
  canvasStageSource,
  /data-runtime-preview-surface[\s\S]*?<HtmlOpaqueOriginBufferedIframe[\s\S]*?allow="accelerometer \*; autoplay \*; clipboard-write \*; encrypted-media \*; fullscreen \*; gyroscope \*; picture-in-picture \*; web-share \*"[\s\S]*?srcDoc=\{preview\.html\}[\s\S]*?youtubeEmbedUrl=\{wordpressConfig\(\)\?\.youtubeEmbedUrl\}/,
  'only executable Preview may delegate media permissions to nested third-party players',
);
assert.match(
  previewSource,
  /const externalPlayerPreview = !inspectionEnabled[\s\S]*?iframe\[src\][\s\S]*?host === 'vimeo\.com'[\s\S]*?host === 'youtube\.com'[\s\S]*?host === 'youtube-nocookie\.com'[\s\S]*?host === 'youtu\.be'/,
  'only executable Preview pages containing a recognized Vimeo/YouTube player may bypass an authored loader',
);
assert.match(
  previewSource,
  /if \(externalPlayerPreview\) \{[\s\S]*?previewPlayerLoadingGateClass[\s\S]*?entrance\|animation\|motion[\s\S]*?releasePreviewPlayerLoadingGate\(document\.documentElement\)[\s\S]*?data-html-editor-preview-player-loading-overlay[\s\S]*?display: none !important/,
  'player-dependent Preview pages must reuse Design loader-gate release without changing the project source',
);
assert.match(
  previewSource,
  /data-html-editor-preview-player-loading-bootstrap[\s\S]*?MutationObserver[\s\S]*?attributeFilter: \['class'\][\s\S]*?DOMContentLoaded[\s\S]*?observer\.disconnect\(\)/,
  'the player loader bypass must cover framework-created initial overlays and stop before later route loaders',
);
assert.match(
  projectEditorSource,
  /const runtimePreviewVisible = Boolean\(isPreviewing && preview\)/,
  'entering Preview must hide the editable iframe before optional runtime preparation finishes',
);
assert.match(
  projectEditorSource,
  /const canvasSandbox = 'allow-scripts allow-forms allow-modals allow-popups';/,
  'the default untrusted Canvas sandbox must remain opaque',
);
assert.match(
  editorShellSource,
  /'youtubeEmbedUrl' => home_url\('\/kodety\/player\/youtube\/'\)/,
  'WordPress must expose the trusted YouTube shell URL to the Builder',
);
assert.match(
  pluginSource,
  /\^kodety\/player\/youtube\/\?\$[\s\S]*?kodety_youtube_embed=1[\s\S]*?function serve_youtube_embed\(\): void/,
  'the trusted YouTube shell must have a public WordPress route',
);
assert.match(
  pluginSource,
  /\$allowed_hosts = \[[\s\S]*?'www\.youtube\.com'[\s\S]*?'www\.youtube-nocookie\.com'[\s\S]*?!in_array\(\$host, \$allowed_hosts, true\)[\s\S]*?\^\/embed\//,
  'the shell must reject arbitrary hosts and non-embed paths',
);
assert.match(
  pluginSource,
  /Referrer-Policy: strict-origin-when-cross-origin[\s\S]*?Content-Security-Policy: default-src 'none'[\s\S]*?frame-src https:\/\/youtube\.com/,
  'the shell must provide YouTube identity while allowing only trusted player frames',
);

console.log('Preview media isolation contracts passed.');
