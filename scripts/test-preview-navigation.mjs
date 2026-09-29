import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
});

try {
  const navigation = await server.ssrLoadModule('/lib/html-editor/preview-navigation.ts');
  const classify = navigation.classifyPreviewNavigationHref;
  const hostedUrl = navigation.hostedPreviewNavigationUrl;
  const canvasProtocol = await server.ssrLoadModule('/lib/html-editor/canvas-protocol.ts');

  assert.deepEqual(classify('#pricing'), {
    kind: 'hash',
    href: '#pricing',
    hash: '#pricing',
  });
  assert.equal(classify('mailto:hello@example.com').kind, 'ignored');
  assert.equal(classify('javascript:alert(1)').kind, 'ignored');
  assert.equal(classify('https://elsewhere.example/path').kind, 'external');
  assert.deepEqual(
    classify('../empresa.html?from=nav#team', { siteUrl: 'https://example.test/wordpress/' }),
    {
      kind: 'project',
      href: '../empresa.html?from=nav#team',
      pathname: '../empresa.html',
      search: '?from=nav',
      hash: '#team',
      sameSiteAbsolute: false,
    },
    'relative paths must stay relative to the active project page, not the WordPress editor URL',
  );
  assert.deepEqual(
    classify('https://example.test/wordpress/pt/sobre/?ref=cms#bio', {
      siteUrl: 'https://example.test/wordpress/',
    }),
    {
      kind: 'project',
      href: 'https://example.test/wordpress/pt/sobre/?ref=cms#bio',
      pathname: '/pt/sobre/',
      search: '?ref=cms',
      hash: '#bio',
      sameSiteAbsolute: true,
    },
    'same-site absolute CMS/locale links must lose only the WordPress install prefix',
  );
  assert.equal(
    classify('//cdn.example.test/file', { siteUrl: 'https://example.test/wordpress/' }).kind,
    'external',
  );
  assert.deepEqual(
    classify('?campaign=preview#result'),
    {
      kind: 'project',
      href: '?campaign=preview#result',
      pathname: '',
      search: '?campaign=preview',
      hash: '#result',
      sameSiteAbsolute: false,
    },
    'query-only links must retain the active project document',
  );
  assert.equal(classify('about.html\u0000login').kind, 'ignored');

  const previewRootUrl = 'https://example.test/wordpress/kodety/preview/token/';
  const activePageUrl = `${previewRootUrl}pages/home.html`;
  assert.equal(
    hostedUrl(
      previewRootUrl,
      activePageUrl,
      classify('../empresa.html?from=nav#team', { siteUrl: 'https://example.test/wordpress/' }),
    ),
    `${previewRootUrl}empresa.html?from=nav#team`,
    'new browsing contexts must keep document-relative routing inside the token namespace',
  );
  assert.equal(
    hostedUrl(
      previewRootUrl,
      activePageUrl,
      classify('https://example.test/wordpress/pt/sobre/?ref=cms#bio', {
        siteUrl: 'https://example.test/wordpress/',
      }),
    ),
    `${previewRootUrl}pt/sobre/?ref=cms#bio`,
    'same-site absolute routes must restart at the hosted preview root',
  );
  assert.equal(
    hostedUrl(previewRootUrl, activePageUrl, classify('?campaign=preview#result')),
    `${activePageUrl}?campaign=preview#result`,
    'query-only links must retain the active hosted document',
  );
  assert.equal(
    hostedUrl(previewRootUrl, activePageUrl, classify('../../../../about.html')),
    `${previewRootUrl}about.html`,
    'dot segments must clamp at the token root instead of escaping into WordPress',
  );
  assert.equal(
    hostedUrl(previewRootUrl, activePageUrl, classify('/../../../../wp-login.php')),
    `${previewRootUrl}wp-login.php`,
    'root-relative dot segments must also remain inside the token namespace',
  );

  const generation = 'preview-navigation-generation';
  assert.equal(canvasProtocol.isCanvasToEditorMessage({
    type: 'html-editor-link',
    generation,
    href: 'about.html',
    disposition: 'self',
    trusted: true,
  }, generation), true);
  assert.equal(canvasProtocol.isCanvasToEditorMessage({
    type: 'html-editor-link',
    generation,
    href: 'about.html',
    disposition: 'new-context',
    trusted: true,
    requestId: 'preview-link-1-m1abc',
  }, generation), true);
  assert.equal(canvasProtocol.isCanvasToEditorMessage({
    type: 'html-editor-link',
    generation,
    href: 'files/report.pdf',
    disposition: 'download',
    trusted: true,
    download: 'report.pdf',
  }, generation), true);
  assert.equal(canvasProtocol.isCanvasToEditorMessage({
    type: 'html-editor-link',
    generation,
    href: 'about.html',
    disposition: 'new-context',
    trusted: true,
  }, generation), false, 'a hosted-window handoff must be correlated');

  const previewSource = await fs.readFile(path.join(root, 'lib/html-editor/preview.ts'), 'utf8');
  assert.match(
    previewSource,
    /anchor\.hasAttribute\('download'\) \|\| event\.altKey[\s\S]*?disposition: 'download'/,
    'relative downloads must be handed to the parent instead of escaping srcdoc',
  );
  assert.match(
    previewSource,
    /event\.metaKey[\s\S]*?event\.ctrlKey[\s\S]*?event\.shiftKey[\s\S]*?disposition: 'new-context'/,
    'Cmd/Ctrl/Shift clicks must request a safe hosted browsing context',
  );
  assert.match(
    previewSource,
    /const requestId = intent\.disposition === 'new-context' \? previewLinkRequestId\(\) : ''/,
    'modified navigation must carry one high-entropy context id to the parent',
  );
  assert.doesNotMatch(
    previewSource,
    /window\.open\('about:blank'/,
    'the child must not consume user activation before the parent validates the native gesture',
  );
  assert.match(
    previewSource,
    /\['click', 'auxclick'\][\s\S]*?capturePreviewLink[\s\S]*?finishCapturedPreviewLink/,
    'primary and middle-button project navigation must both stay isolated',
  );
  assert.match(
    previewSource,
    /scheme && !\/\^https\?\$\/i\.test\(scheme\)/,
    'mailto, tel, data, blob and custom protocols must not enter project navigation',
  );
  assert.match(
    previewSource,
    /typeof event\.composedPath === 'function'[\s\S]*?node\.matches\('a\[href\],area\[href\]'\)/,
    'open-Shadow-DOM links must be discovered from the composed event path',
  );
  assert.match(
    previewSource,
    /Element\.prototype\.setAttribute\.call\(link\.anchor, 'href', shield\);[\s\S]*?setTimeout\(\(\) => finishPreviewLink\(event, pending\), 0\)/,
    'capture must fail closed before an authored stopPropagation can expose the WordPress fallback base',
  );
  assert.match(
    previewSource,
    /const maskPreviewLinkShield[\s\S]*?authoredAbsoluteHref[\s\S]*?value === pending\.shield[\s\S]*?return pending\.href[\s\S]*?Element\.prototype\.setAttribute\.call\(link\.anchor, 'href', shield\)/,
    'authored handlers must continue observing the original href through normal DOM APIs while the browser default is shielded',
  );
  assert.match(
    previewSource,
    /const finishCapturedPreviewLink[\s\S]*?if \(event\.defaultPrevented\) \{[\s\S]*?pending\.handled = true;[\s\S]*?return;[\s\S]*?finishPreviewLink\(event, pending, true\);/,
    'the normal bubble path must still honor authored preventDefault handlers',
  );

  const editorSource = await fs.readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  assert.match(
    editorSource,
    /classifyPreviewNavigationHref\(href, \{[\s\S]*?siteUrl: topbarWp\?\.siteUrl/,
    'the parent must classify links against the public site rather than its authenticated location',
  );
  assert.match(
    editorSource,
    /destination\.sameSiteAbsolute[\s\S]*?openOutsidePreview\(rawDestination\)/,
    'unmaterialized same-site CMS routes must leave the isolated iframe safely',
  );
  assert.match(
    editorSource,
    /disposition === 'new-context'[\s\S]*?prepareHostedPreviewRef\.current\(project\)[\s\S]*?hostedPreviewNavigationUrl\(rootUrl, activePageUrl, destination\)/,
    'new browsing contexts must receive a hosted token URL rather than the Builder base',
  );
  assert.match(
    editorSource,
    /navigator\.userActivation[\s\S]*?trustedUserGesture[\s\S]*?const openHostedNewContext[\s\S]*?window\.open\('about:blank', '_blank'\)[\s\S]*?popup\.location\.replace\(url\)/,
    'the parent must open during real activation and navigate its retained WindowProxy without returning the token to srcdoc',
  );
  assert.match(
    editorSource,
    /disposition === 'download'[\s\S]*?isPublicPreviewDownloadPath\(path\)[\s\S]*?isPublicPreviewDownloadPath\(file\.path\)[\s\S]*?downloadPreviewProjectFile\(project\.files\[downloadPath\]/,
    'relative project downloads must be materialized by the parent without exposing hidden project files',
  );
  assert.match(
    editorSource,
    /if \(destination\.search\)[\s\S]*?prepareResolvedHostedUrl\(\)[\s\S]*?frame\.location\.replace\(nextUrl\)/,
    'query navigation must leave about:srcdoc for the same sandboxed token-scoped frame',
  );
  assert.match(
    editorSource,
    /pending\?\.signature === signature && pending\.page === publicPage[\s\S]*?return pending\.promise/,
    'simultaneous modified clicks must share one hosted-preview package instead of aborting each other',
  );
  assert.match(
    editorSource,
    /message\.type === 'ready'[\s\S]*?cached\?\.signature === signature && cached\.page === publicPage[\s\S]*?prepareHostedPreview\(current, false, false\)/,
    'the Preview topbar must never publish a hosted URL cached for another project page or surface an automatic clean-link failure as an opening error',
  );

  const wordpressSource = await fs.readFile(
    path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'),
    'utf8',
  );
  assert.match(
    wordpressSource,
    /send_project_preview_cors_headers[\s\S]*?header_remove\('X-Frame-Options'\)[\s\S]*?filter_project_preview_cors_headers[\s\S]*?unset\(\$headers\['X-Frame-Options'\]\)/,
    'token-scoped query navigation must remain embeddable even when the public site uses X-Frame-Options DENY',
  );
  assert.match(
    wordpressSource,
    /Content-Security-Policy: sandbox allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts/,
    'top-level hosted previews must retain an opaque project origin after the parent opens a modified-click tab',
  );
  assert.match(
    wordpressSource,
    /data-kodety-preview-boundary>try\{window\.opener=null\}catch\(e\)\{\}<\/script>[\s\S]*?preg_replace\('\/<head/,
    'hosted HTML must sever the retained Builder opener before authored head scripts run',
  );

  const hostedRuntime = execFileSync(
    'php',
    [path.join(root, 'Wordpress/tests/preview-navigation-runtime.php')],
    {
      encoding: 'utf8',
      env: { ...process.env, KODETY_PREVIEW_RUNTIME_DUMP: '1' },
    },
  );
  const hostedRuntimeSource = hostedRuntime
    .replace(/^<script\b[^>]*>/i, '')
    .replace(/<\/script>$/i, '');
  assert.doesNotThrow(
    () => new Function(hostedRuntimeSource),
    'the exact JavaScript emitted by PHP must remain parseable',
  );

  const token = 'a'.repeat(48);
  const previewDocument = {
    baseURI: `https://example.test/wordpress/kodety/preview/${token}/pages/home.html`,
    documentElement: {},
    anchors: [],
    querySelectorAll() { return this.anchors; },
  };
  const previewWindow = {
    listeners: new Map(),
    addEventListener(type, listener, capture) { this.listeners.set(type, { listener, capture }); },
  };
  class TestAnchor {
    constructor(href, attributes = {}, baseURI = previewDocument.baseURI) {
      this.attributes = { href, ...attributes };
      this.baseURI = baseURI;
      this.parentElement = null;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    get href() { return new URL(this.attributes.href, this.baseURI).href; }
    matches(selector) { return selector.includes('a[href]'); }
    querySelectorAll() { return []; }
    closest(selector) { return this.matches(selector) ? this : null; }
  }
  let mutationCallback = null;
  class TestMutationObserver {
    constructor(callback) { mutationCallback = callback; }
    observe() {}
  }
  previewDocument.anchors = [
    new TestAnchor('../about.html?from=nav#team'),
    new TestAnchor('/contact/'),
    new TestAnchor('https://example.test/wordpress/pt/sobre/?ref=cms#bio'),
    new TestAnchor('/kodety/preview/legacy-page'),
    new TestAnchor('#pricing'),
    new TestAnchor('mailto:hello@example.com'),
    new TestAnchor('https://external.example/path', { target: '_blank', download: 'file' }),
  ];
  new Function('document', 'window', 'location', 'MutationObserver', 'URL', hostedRuntimeSource)(
    previewDocument,
    previewWindow,
    { href: previewDocument.baseURI },
    TestMutationObserver,
    URL,
  );
  assert.equal(
    previewDocument.anchors[0].attributes.href,
    '../about.html?from=nav#team',
    'already-safe document-relative links should keep their authored spelling',
  );
  assert.equal(
    previewDocument.anchors[1].attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/contact/`,
  );
  assert.equal(
    previewDocument.anchors[2].attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/pt/sobre/?ref=cms#bio`,
    'WordPress subdirectory, locale, CMS query and hash must survive routing',
  );
  assert.equal(
    previewDocument.anchors[3].attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/legacy-page`,
  );
  assert.equal(previewDocument.anchors[4].attributes.href, '#pricing');
  assert.equal(previewDocument.anchors[5].attributes.href, 'mailto:hello@example.com');
  assert.equal(previewDocument.anchors[6].attributes.href, 'https://external.example/path');
  assert.equal(previewDocument.anchors[6].attributes.target, '_blank');
  assert.equal(previewDocument.anchors[6].attributes.download, 'file');
  assert.equal(previewWindow.listeners.get('click')?.capture, true);
  assert.equal(previewWindow.listeners.get('auxclick')?.capture, true);

  const dynamicAnchor = new TestAnchor('/cms/new-row?preview=1');
  mutationCallback?.([{ type: 'childList', addedNodes: [dynamicAnchor] }]);
  assert.equal(
    dynamicAnchor.attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/cms/new-row?preview=1`,
    'runtime-created CMS links must be scoped before they can navigate',
  );

  const shadowAnchor = new TestAnchor('/inside-shadow#section');
  previewWindow.listeners.get('click')?.listener({
    target: { closest: () => null },
    composedPath: () => [shadowAnchor, { closest: () => null }],
  });
  assert.equal(
    shadowAnchor.attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/inside-shadow#section`,
    'capture fallback must route an anchor exposed only through composedPath()',
  );

  const agencyRuntime = execFileSync(
    'php',
    [path.join(root, 'Wordpress/tests/preview-navigation-runtime.php')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        KODETY_PREVIEW_RUNTIME_DUMP: '1',
        KODETY_PREVIEW_RUNTIME_SITE_BASE: 'https://example.test/acme/',
      },
    },
  ).replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
  const agencyDocument = {
    baseURI: `https://example.test/wordpress/kodety/preview/${token}/index.html`,
    documentElement: {},
    anchors: [],
    querySelectorAll() { return this.anchors; },
  };
  const agencyAnchor = new TestAnchor('/acme/about?from=agency#team', {}, agencyDocument.baseURI);
  agencyDocument.anchors = [agencyAnchor];
  new Function('document', 'window', 'location', 'MutationObserver', 'URL', agencyRuntime)(
    agencyDocument,
    { addEventListener() {} },
    { href: agencyDocument.baseURI },
    TestMutationObserver,
    URL,
  );
  assert.equal(
    agencyAnchor.attributes.href,
    `https://example.test/wordpress/kodety/preview/${token}/about?from=agency#team`,
    'Agency project slugs must be removed before the token namespace is applied',
  );
} finally {
  await server.close();
}

console.log('Preview navigation tests passed.');
