import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceOwnedGeistPath = path.join(root, 'lib/html-editor/fonts/geist/Geist-Regular.ttf');
const sourceOwnedGeistLicensePath = path.join(root, 'lib/html-editor/fonts/geist/OFL-1.1.txt');
const SOURCE_OWNED_GEIST_BYTES = 125_956;
const SOURCE_OWNED_GEIST_SHA256 = 'bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76';
const SOURCE_OWNED_GEIST_LICENSE_BYTES = 4_368;
const SOURCE_OWNED_GEIST_LICENSE_SHA256 = '930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

try {
  const [socialImage, seoSettings, projectFonts] = await Promise.all([
    server.ssrLoadModule('/lib/html-editor/social-image.ts'),
    server.ssrLoadModule('/lib/html-editor/seo-settings.ts'),
    server.ssrLoadModule('/lib/html-editor/project-fonts.ts'),
  ]);
  assert.equal(await fileExists(sourceOwnedGeistPath), true, 'the canonical Geist TTF must live in repository source');
  assert.equal(await fileExists(sourceOwnedGeistLicensePath), true, 'the canonical Geist TTF must keep its OFL license adjacent');
  assert.equal(
    path.dirname(sourceOwnedGeistPath),
    path.dirname(sourceOwnedGeistLicensePath),
    'the canonical Geist font and license must remain adjacent',
  );
  const [sourceOwnedGeist, sourceOwnedGeistLicense] = await Promise.all([
    readFile(sourceOwnedGeistPath),
    readFile(sourceOwnedGeistLicensePath),
  ]);
  assert.equal(sourceOwnedGeist.byteLength, SOURCE_OWNED_GEIST_BYTES, 'the canonical Geist Regular bytes must not drift');
  assert.equal(sha256(sourceOwnedGeist), SOURCE_OWNED_GEIST_SHA256, 'the canonical Geist Regular hash must match preview/publication');
  assert.equal(sourceOwnedGeistLicense.byteLength, SOURCE_OWNED_GEIST_LICENSE_BYTES, 'the adjacent Geist OFL bytes must not drift');
  assert.equal(sha256(sourceOwnedGeistLicense), SOURCE_OWNED_GEIST_LICENSE_SHA256, 'the adjacent Geist OFL hash must remain canonical');
  assert.match(sourceOwnedGeistLicense.toString('utf8'), /^Copyright \(c\) 2023 Vercel, in collaboration with basement\.studio/m);
  assert.match(sourceOwnedGeistLicense.toString('utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);

  const lazyFontProject = {
    name: 'Lazy font fixture',
    rootPath: '',
    mainHtmlPath: 'index.html',
    openedAt: 0,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<link rel="stylesheet" href="styles.css">' },
      'styles.css': {
        path: 'styles.css',
        mimeType: 'text/css',
        text: '@font-face{font-family:"Fixture Brand";src:url("./assets/brand.woff2") format("woff2")}',
      },
      'assets/brand.woff2': { path: 'assets/brand.woff2', mimeType: 'font/woff2' },
    },
  };
  const lazyFontCatalog = projectFonts.discoverProjectFonts(lazyFontProject);
  assert.equal(lazyFontCatalog.fonts[0]?.family, 'Fixture Brand');
  assert.equal(lazyFontCatalog.fonts[0]?.faces[0]?.sources[0]?.filePath, 'assets/brand.woff2');
  const lazyFontRuntime = projectFonts.createProjectFontRuntime(lazyFontProject);
  assert.equal(lazyFontRuntime.fonts[0]?.family, 'Fixture Brand');
  assert.equal(lazyFontRuntime.css, '', 'a path descriptor must never create an empty binary blob URL');
  lazyFontRuntime.revoke();

  assert.equal(socialImage.SOCIAL_IMAGE_TEMPLATE_VERSION, 1);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_CANVAS_SIDE, 2_400);
  assert.equal(socialImage.SOCIAL_IMAGE_MIN_ELEMENT_SIDE, 1);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_ELEMENT_SIDE, 2_400);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_ELEMENT_POSITION, 2_400);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_TOTAL_LAYER_PIXELS, 24_000_000);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_SHADOW_BLUR, 64);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_SHADOW_OFFSET, 256);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES, 200);
  assert.equal(socialImage.SOCIAL_IMAGE_MIN_WIDTH_PERCENT, 1);
  assert.equal(socialImage.SOCIAL_IMAGE_MAX_WIDTH_PERCENT, 100);
  assert.deepEqual(socialImage.SOCIAL_IMAGE_FONT_FAMILIES, ['Geist']);
  assert.deepEqual(
    socialImage.SOCIAL_IMAGE_FONT_WEIGHTS,
    [100, 200, 300, 400, 500, 600, 700, 800, 900],
  );
  assert.equal(socialImage.SOCIAL_IMAGE_BROWSER_FONT_FACE, 'Kodety Social Geist');
  assert.equal(socialImage.SOCIAL_IMAGE_BROWSER_FONT_FAMILY, '"Kodety Social Geist", sans-serif');
  assert.equal(socialImage.normalizeSocialImageFontFamily('Georgia'), 'Georgia');
  assert.equal(socialImage.normalizeSocialImageFontFamily('\"Neue Haas\"'), 'Neue Haas');
  assert.equal(socialImage.normalizeSocialImageFontFile('../private.ttf'), '');
  assert.equal(socialImage.normalizeSocialImageFontFile('https://example.test/font.ttf'), '');
  assert.equal(
    socialImage.normalizeSocialImageFontFile(
      '.incode/experiments/home/a/project/fonts/private.ttf',
    ),
    '',
  );
  assert.equal(
    socialImage.normalizeSocialImageFontFile(
      'assets/%2e%2e/private.ttf',
    ),
    '',
  );
  assert.equal(
    socialImage.normalizeSocialImageFontFile('/assets/fonts/Neue Haas.otf'),
    'assets/fonts/Neue Haas.otf',
  );
  assert.equal(
    socialImage.normalizeSocialImageFontFile(
      `.kodety-social/fonts/${'a'.repeat(64)}.ttf`,
    ),
    `.kodety-social/fonts/${'a'.repeat(64)}.ttf`,
    'fontes preparadas para o renderer social devem manter o caminho canônico',
  );
  assert.equal(socialImage.normalizeSocialImageFontWeight(100), 100);
  assert.equal(socialImage.normalizeSocialImageFontWeight('medium'), 500);
  assert.equal(socialImage.normalizeSocialImageFontWeight('semi-bold'), 600);
  assert.equal(socialImage.normalizeSocialImageFontWeight('700'), 700);
  assert.equal(socialImage.normalizeSocialImageFontWeight(900), 900);
  assert.equal(socialImage.normalizeSocialImageFontWeight(950), 900);
  assert.equal(
    socialImage.inferSocialImageFontFileWeight('fonts/NeueHaas-75Bold.otf'),
    700,
  );
  assert.equal(
    socialImage.inferSocialImageFontFileWeight('fonts/Editorial_300.ttf'),
    300,
  );
  assert.equal(
    socialImage.normalizeSocialImageTemplateId(' Hero Card '),
    'hero-card',
  );
  assert.equal(socialImage.normalizeSocialImageTemplateId('__inherit__'), '');
  assert.deepEqual(
    socialImage.SOCIAL_IMAGE_DIMENSION_PRESETS.map(({ id, width, height }) => [id, width, height]),
    [
      ['open-graph', 1_200, 630],
      ['square', 1_080, 1_080],
      ['portrait', 1_080, 1_350],
      ['x-card', 1_200, 675],
    ],
    'the supported social presets must keep their publication dimensions',
  );

  const variableKeys = socialImage.SOCIAL_IMAGE_VARIABLE_GROUPS
    .flatMap(group => group.variables.map(variable => variable.key));
  assert.equal(new Set(variableKeys).size, variableKeys.length, 'variable keys must be unique');
  assert.deepEqual(variableKeys, [
    'page.title',
    'page.excerpt',
    'page.featured_image',
    'page.url',
    'page.date',
    'author.name',
    'author.avatar',
    'site.name',
    'site.logo',
    'product.price',
    'product.image',
    'category.name',
  ]);

  assert.equal(socialImage.normalizeSocialImageColor('#abc'), '#AABBCC');
  assert.equal(socialImage.normalizeSocialImageColor('#a1b2c3'), '#A1B2C3');
  assert.equal(socialImage.normalizeSocialImageColor('  #00ff7f  '), '#00FF7F');
  assert.equal(
    socialImage.normalizeSocialImageColor('rgb(1, 2, 3)', '#123456'),
    '#123456',
    'only serializable six-digit colors may enter a saved template',
  );
  assert.equal(socialImage.normalizeSocialImageColor(null), '#000000');

  const empty = socialImage.normalizeSocialImageTemplate(null);
  assert.match(empty.id, /^social-template-[a-z0-9]+$/);
  assert.deepEqual(empty, {
    version: 1,
    id: empty.id,
    name: 'Social Image',
    width: 1_200,
    height: 630,
    background: {
      color: '#0B1020',
      gradient: {
        enabled: false,
        angle: 135,
        from: '#0B1020',
        to: '#172A46',
      },
      image: '',
      imageFit: 'cover',
      imageOpacity: 1,
    },
    elements: [],
    stacks: [],
  });
  assert.equal(
    socialImage.normalizeSocialImageTemplate(null).id,
    empty.id,
    'legacy embedded templates without IDs must receive a deterministic stable ID',
  );
  for (const reservedId of ['__none__', '__inherit__']) {
    const normalizedReserved = socialImage.normalizeSocialImageTemplate({
      id: reservedId,
      name: 'Reserved sentinel',
    });
    assert.notEqual(
      normalizedReserved.id,
      reservedId,
      `the editor sentinel ${reservedId} must never be accepted as a template ID`,
    );
    assert.equal(
      socialImage.normalizeSocialImageTemplate({
        id: reservedId,
        name: 'Reserved sentinel',
      }).id,
      normalizedReserved.id,
      'rewriting an imported reserved ID must remain deterministic',
    );
  }

  const rawElements = [
    {
      id: 'hero title',
      type: 'text',
      name: 'T'.repeat(200),
      x: -99_999,
      y: 99_999,
      width: 99_999,
      height: -5,
      rotation: 999,
      opacity: -4,
      visible: false,
      locked: true,
      groupId: 'g'.repeat(140),
      border: { color: '#abc', width: 99, radius: -3 },
      shadow: {
        enabled: true,
        color: '#def',
        opacity: 3,
        blur: 999,
        offsetX: -999,
        offsetY: 999,
      },
      text: 'A'.repeat(4_100),
      color: '#123',
      fontFamily: 'F'.repeat(200),
      fontSize: 999,
      fontWeight: 50,
      lineHeight: 9,
      letterSpacing: -50,
      align: 'justify',
      verticalAlign: 'baseline',
      italic: true,
    },
    {
      id: 'hero title',
      type: 'image',
      source: 42,
      attachmentId: 87,
      fit: 'outside',
      focalX: -20,
      focalY: 120,
    },
    {
      id: '',
      type: 'shape',
      shape: 'triangle',
      fill: '#f09',
    },
    {
      id: 'brand-icon',
      type: 'icon',
      icon: 'unknown',
      color: 'transparent',
      strokeWidth: 99,
    },
    ...Array.from({ length: 106 }, (_, index) => ({
      id: `filler-${index}`,
      type: 'shape',
      shape: 'rectangle',
      fill: '#2997ff',
    })),
  ];
  const bounded = socialImage.normalizeSocialImageTemplate({
    version: 99,
    name: 'N'.repeat(200),
    width: 99_999.8,
    height: 10,
    background: {
      color: '#abc',
      gradient: {
        enabled: true,
        angle: -999,
        from: '#001122',
        to: 'invalid',
      },
      image: 'I'.repeat(4_100),
      imageFit: 'outside',
      imageOpacity: 12,
    },
    elements: rawElements,
  });

  assert.equal(bounded.version, 1, 'untrusted document versions normalize to the current schema');
  assert.match(bounded.id, /^social-template-[a-z0-9]+$/);
  assert.equal(bounded.name.length, 160);
  assert.equal(bounded.width, 2_400);
  assert.equal(bounded.height, 320);
  assert.deepEqual(bounded.background.gradient, {
    enabled: true,
    angle: -360,
    from: '#001122',
    to: '#172A46',
  });
  assert.equal(bounded.background.color, '#AABBCC');
  assert.equal(bounded.background.image.length, 4_000);
  assert.equal(bounded.background.imageFit, 'cover');
  assert.equal(bounded.background.imageOpacity, 1);
  assert.equal(bounded.elements.length, 100, 'templates must never retain more than 100 elements');
  assert.equal(
    new Set(bounded.elements.map(element => element.id)).size,
    bounded.elements.length,
    'normalization must deduplicate every element id',
  );

  const [text, image, shape, icon] = bounded.elements;
  assert.equal(text.id, 'hero-title');
  assert.equal(image.id, 'hero-title-2');
  assert.equal(shape.id, 'social-element-3');
  assert.deepEqual(
    {
      x: text.x,
      y: text.y,
      width: text.width,
      height: text.height,
      rotation: text.rotation,
      opacity: text.opacity,
    },
    {
      x: -2_400,
      y: 2_400,
      width: 2_400,
      height: 1,
      rotation: 360,
      opacity: 0,
    },
    'element geometry must remain inside the documented normalization envelope',
  );
  assert.equal(text.name.length, 160);
  assert.equal(text.groupId.length, 96);
  assert.deepEqual(text.border, { color: '#AABBCC', width: 40, radius: 0 });
  assert.deepEqual(text.shadow, {
    enabled: true,
    color: '#DDEEFF',
    opacity: 1,
    blur: 64,
    offsetX: -256,
    offsetY: 256,
  });
  assert.equal(text.text.length, 4_000);
  assert.equal(text.color, '#112233');
  assert.equal(text.fontFamily, 'Geist');
  assert.equal(text.fontSize, 400);
  assert.equal(text.fontWeight, 100);
  assert.equal(text.lineHeight, 3);
  assert.equal(text.letterSpacing, -20);
  assert.equal(text.align, 'left');
  assert.equal(text.verticalAlign, 'top');
  assert.equal(text.italic, false);
  assert.equal(text.visible, false);
  assert.equal(text.locked, true);
  assert.equal(text.widthUnit, 'px', 'legacy widths must remain pixel based');
  assert.equal(text.horizontalAnchor, 'left', 'legacy x coordinates must remain left anchored');
  assert.equal(text.verticalAnchor, 'top', 'legacy y coordinates must remain top anchored');
  assert.equal(text.autoHeight, false, 'legacy text boxes must retain fixed height');
  const projectFontTemplate = socialImage.normalizeSocialImageTemplate({
    elements: [{
      id: 'project-font',
      type: 'text',
      text: 'Projeto',
      fontFamily: 'Neue Haas Grotesk',
      fontFile: '/public/fonts/NeueHaas-75Bold.otf',
      fontFileWeight: 'bold',
    }],
  });
  assert.equal(projectFontTemplate.elements[0].fontFamily, 'Neue Haas Grotesk');
  assert.equal(projectFontTemplate.elements[0].fontFile, 'public/fonts/NeueHaas-75Bold.otf');
  assert.equal(projectFontTemplate.elements[0].fontFileWeight, 700);
  const missingProjectFontFile = socialImage.normalizeSocialImageTemplate({
    elements: [{
      id: 'host-font',
      type: 'text',
      text: 'Sem arquivo local',
      fontFamily: 'Georgia',
    }],
  });
  assert.equal(
    missingProjectFontFile.elements[0].fontFamily,
    'Geist',
    'a family without a portable project file must keep deterministic rendering',
  );
  assert.equal(image.source, '', 'non-string asset values must not leak into a serialized template');
  assert.equal(image.attachmentId, 87, 'Media Library attachment IDs must survive canonicalization');
  assert.equal(image.fit, 'cover');
  assert.equal(image.focalX, 0);
  assert.equal(image.focalY, 100);
  assert.equal(shape.shape, 'rectangle');
  assert.equal(shape.fill, '#FF0099');
  assert.equal(icon.icon, 'sparkles');
  assert.equal(icon.color, '#FFFFFF');
  assert.equal(icon.strokeWidth, 8);
  assert.deepEqual(
    socialImage.normalizeSocialImageTemplate(bounded),
    bounded,
    'template normalization must be idempotent so autosave echoes remain stable',
  );

  const anchoredLayout = socialImage.normalizeSocialImageTemplate({
    width: 1_200,
    height: 630,
    elements: [{
      id: 'anchored-copy',
      type: 'text',
      x: 64,
      y: 40,
      width: 50,
      widthUnit: 'percent',
      height: 80,
      horizontalAnchor: 'right',
      verticalAnchor: 'bottom',
      autoHeight: true,
      text: 'A responsive title',
    }],
  });
  const anchoredText = anchoredLayout.elements[0];
  assert.equal(anchoredText.widthUnit, 'percent');
  assert.equal(anchoredText.width, 50);
  assert.equal(anchoredText.horizontalAnchor, 'right');
  assert.equal(anchoredText.verticalAnchor, 'bottom');
  assert.equal(anchoredText.autoHeight, true);
  assert.equal(
    socialImage.socialImageElementWidthPixels(anchoredText, anchoredLayout.width),
    600,
    'percentage widths must resolve and round against the actual canvas width',
  );
  assert.deepEqual(
    socialImage.socialImageElementRect(
      anchoredText,
      anchoredLayout.width,
      anchoredLayout.height,
    ),
    { x: 536, y: 510, width: 600, height: 80 },
    'right/bottom offsets must resolve into the legacy top-left render rectangle',
  );

  const movedAnchoredText = socialImage.socialImageElementWithRect(
    anchoredText,
    { x: 546, y: 530, width: 600, height: 60 },
    anchoredLayout.width,
    anchoredLayout.height,
  );
  assert.deepEqual(
    {
      x: movedAnchoredText.x,
      y: movedAnchoredText.y,
      width: movedAnchoredText.width,
      widthUnit: movedAnchoredText.widthUnit,
    },
    { x: 54, y: 40, width: 50, widthUnit: 'percent' },
    'drag/resize must re-encode visual rectangles without breaking right/bottom pins',
  );

  const centeredAnchoredText = socialImage.reanchorSocialImageElement(
    anchoredText,
    'center',
    'center',
    anchoredLayout.width,
    anchoredLayout.height,
  );
  assert.deepEqual(
    socialImage.socialImageElementRect(
      centeredAnchoredText,
      anchoredLayout.width,
      anchoredLayout.height,
    ),
    socialImage.socialImageElementRect(
      anchoredText,
      anchoredLayout.width,
      anchoredLayout.height,
    ),
    'changing anchors must not move the element visually',
  );
  const percentAsPixels = socialImage.convertSocialImageElementWidthUnit(
    anchoredText,
    'px',
    anchoredLayout.width,
  );
  assert.equal(percentAsPixels.width, 600);
  assert.equal(percentAsPixels.widthUnit, 'px');
  assert.equal(
    socialImage.convertSocialImageElementWidthUnit(
      percentAsPixels,
      'percent',
      anchoredLayout.width,
    ).width,
    50,
    'px/percent conversion must preserve resolved width',
  );

  const widerCanvasRect = socialImage.socialImageElementRect(
    anchoredText,
    1_600,
    900,
  );
  assert.deepEqual(
    widerCanvasRect,
    { x: 736, y: 780, width: 800, height: 80 },
    'canvas preset changes must immediately re-resolve percentage width and trailing anchors',
  );
  const resizedFromPin = socialImage.socialImageElementRect(
    { ...anchoredText, width: 60, height: 140 },
    anchoredLayout.width,
    anchoredLayout.height,
  );
  assert.equal(resizedFromPin.x + resizedFromPin.width, 1_136);
  assert.equal(resizedFromPin.y + resizedFromPin.height, 590);
  assert.equal(
    socialImage.socialImageAutoHeightLimit(anchoredText, anchoredLayout.height),
    590,
  );
  assert.equal(
    socialImage.socialImageAutoHeightLimit(
      { ...anchoredText, y: 0, verticalAnchor: 'center' },
      anchoredLayout.height,
    ),
    630,
    'center-anchored fit-content must distribute its available height symmetrically',
  );
  assert.deepEqual(
    socialImage.socialImageLayerPixelBudget(
      [anchoredText],
      anchoredLayout.width,
      anchoredLayout.height,
    ),
    {
      limit: 24_000_000,
      used: 354_000,
      requested: 354_000,
      overflow: 0,
      rejectedElementIds: [],
    },
    'pixel budget must use resolved percent width and the maximum auto-height envelope',
  );

  const stackedLayout = socialImage.normalizeSocialImageTemplate({
    id: 'adaptive-stack',
    width: 1_200,
    height: 630,
    elements: [
      {
        id: 'stack-title',
        type: 'text',
        text: 'Título',
        x: 100,
        y: 100,
        width: 300,
        height: 40,
      },
      {
        id: 'stack-description',
        type: 'text',
        text: 'Descrição variável',
        x: 100,
        y: 160,
        width: 300,
        height: 40,
        autoHeight: true,
      },
    ],
    stacks: [{
      id: 'copy-stack',
      elementIds: ['stack-title', 'stack-description'],
      direction: 'vertical',
      gap: 20,
      align: 'start',
      anchor: 'center',
    }],
  });
  assert.equal(stackedLayout.stacks.length, 1);
  assert.deepEqual(stackedLayout.stacks[0], {
    id: 'copy-stack',
    elementIds: ['stack-title', 'stack-description'],
    direction: 'vertical',
    gap: 20,
    align: 'start',
    anchor: 'center',
  });
  assert.ok(
    stackedLayout.elements.every(element => element.groupId === 'copy-stack'),
    'stack members must remain an atomic selection while retaining individual geometry',
  );
  const expandedStackRects = socialImage.socialImageStackRects(
    stackedLayout,
    new Map([['stack-description', 120]]),
  );
  assert.deepEqual(expandedStackRects.get('stack-title'), {
    x: 100,
    y: 60,
    width: 300,
    height: 40,
  });
  assert.deepEqual(expandedStackRects.get('stack-description'), {
    x: 100,
    y: 120,
    width: 300,
    height: 120,
  });
  assert.equal(
    expandedStackRects.get('stack-description').y
      - expandedStackRects.get('stack-title').y
      - expandedStackRects.get('stack-title').height,
    20,
    'a vertical Stack must preserve its configured gap when description text gains lines',
  );
  const materializedStack = socialImage.materializeSocialImageStacks(
    stackedLayout,
    new Map([['stack-description', 120]]),
  );
  assert.equal(materializedStack.elements[0].y, 60);
  assert.equal(materializedStack.elements[1].y, 120);
  assert.equal(materializedStack.elements[1].height, 120);

  const withoutInvalidElements = socialImage.normalizeSocialImageTemplate({
    elements: [
      null,
      'text',
      { id: 'unknown', type: 'video' },
      { id: 'valid', type: 'shape' },
    ],
  });
  assert.deepEqual(
    withoutInvalidElements.elements.map(element => element.id),
    ['valid'],
    'malformed and unsupported element records must be discarded',
  );

  const oversizedLayers = Array.from({ length: 5 }, (_, index) => ({
    id: `oversized-${index + 1}`,
    type: 'shape',
    width: 2_400,
    height: 2_400,
  }));
  const layerBudget = socialImage.socialImageLayerPixelBudget(oversizedLayers);
  assert.deepEqual(layerBudget, {
    limit: 24_000_000,
    used: 23_040_000,
    requested: 28_800_000,
    overflow: 4_800_000,
    rejectedElementIds: ['oversized-5'],
  });
  assert.deepEqual(
    socialImage.normalizeSocialImageTemplate({ elements: oversizedLayers })
      .elements.map(element => element.id),
    ['oversized-1', 'oversized-2', 'oversized-3', 'oversized-4'],
    'normalization must apply the renderer cumulative layer-pixel budget in document order',
  );

  const attachmentTemplate = socialImage.normalizeSocialImageTemplate({
    background: {
      image: '/wp-content/uploads/social-background.webp',
      imageAttachmentId: '321',
    },
    elements: [
      {
        id: 'library-image',
        type: 'image',
        source: '/wp-content/uploads/social-card.webp',
        attachmentId: '123',
      },
      {
        id: 'dynamic-image',
        type: 'image',
        source: '{{page.featured_image}}',
        attachmentId: 999,
      },
    ],
  });
  assert.equal(attachmentTemplate.background.imageAttachmentId, 321);
  assert.equal(attachmentTemplate.elements[0].attachmentId, 123);
  assert.equal(
    attachmentTemplate.elements[1].attachmentId,
    undefined,
    'a dynamic image token must not retain a stale Media Library attachment ID',
  );
  assert.deepEqual(
    socialImage.normalizeSocialImageTemplate(attachmentTemplate),
    attachmentTemplate,
    'attachment-aware templates must remain idempotent',
  );

  const defaultTemplate = socialImage.createDefaultSocialImageTemplate();
  assert.equal(defaultTemplate.version, 1);
  assert.match(defaultTemplate.id, /^social-template-/);
  assert.equal(defaultTemplate.name, 'Social Image');
  assert.equal(defaultTemplate.width, 1_200);
  assert.equal(defaultTemplate.height, 630);
  assert.deepEqual(defaultTemplate.background, {
    color: '#FFFFFF',
    gradient: {
      enabled: false,
      angle: 135,
      from: '#FFFFFF',
      to: '#FFFFFF',
    },
    image: '',
    imageFit: 'cover',
    imageOpacity: 1,
  });
  assert.deepEqual(
    defaultTemplate.elements.map(element => element.type),
    ['text', 'text', 'text'],
    'the starter template must contain copy only, without decorative or image layers',
  );
  assert.deepEqual(
    defaultTemplate.elements.map(element => element.name),
    ['Nome do site', 'Título', 'Resumo'],
  );
  assert.deepEqual(
    defaultTemplate.elements
      .filter(element => element.type === 'text')
      .map(element => element.text),
    ['{{site.name}}', '{{page.title}}', '{{page.excerpt}}'],
  );
  assert.ok(
    defaultTemplate.elements.every(element =>
      element.type === 'text' && element.color === '#000000'),
    'every starter text layer must be black on the white canvas',
  );
  assert.ok(
    defaultTemplate.elements
      .filter(element => element.type === 'text')
      .every(element => element.autoHeight),
    'new text layers should opt into fit-content while legacy text remains fixed',
  );
  assert.ok(
    defaultTemplate.elements.every(element =>
      element.widthUnit === 'px'
      && element.horizontalAnchor === 'left'
      && element.verticalAnchor === 'top'),
    'new layers must serialize explicit layout defaults',
  );
  assert.equal(
    new Set(defaultTemplate.elements.map(element => element.id)).size,
    defaultTemplate.elements.length,
    'starter elements must have unique ids',
  );
  assert.deepEqual(
    socialImage.normalizeSocialImageTemplate(defaultTemplate),
    defaultTemplate,
    'the generated starter document must already satisfy its own schema',
  );
  const newTextElement = socialImage.createSocialImageElement('text', defaultTemplate);
  assert.equal(
    newTextElement.color,
    '#000000',
    'text added to the new white starter canvas must be visible by default',
  );
  const darkTemplate = socialImage.normalizeSocialImageTemplate({
    background: {
      color: '#0B1020',
      gradient: {
        enabled: true,
        from: '#0B1020',
        to: '#172A46',
      },
    },
  });
  assert.equal(
    socialImage.createSocialImageElement('text', darkTemplate).color,
    '#FFFFFF',
    'text added to a dark existing template must remain visible by default',
  );
  const normalizedLegacyText = socialImage.normalizeSocialImageTemplate({
    background: { color: '#0B1020' },
    elements: [{ type: 'text', text: 'Legacy text without a saved color' }],
  }).elements[0];
  assert.equal(
    normalizedLegacyText.color,
    '#FFFFFF',
    'normalization must retain the historic white fallback for existing documents',
  );

  const duplicatedTemplate = socialImage.duplicateSocialImageTemplate(
    defaultTemplate,
    'Card de produto',
  );
  assert.notEqual(duplicatedTemplate.id, defaultTemplate.id);
  assert.equal(duplicatedTemplate.name, 'Card de produto');
  assert.deepEqual(
    duplicatedTemplate.elements.map(({ type, name }) => ({ type, name })),
    defaultTemplate.elements.map(({ type, name }) => ({ type, name })),
    'page customization must duplicate content while receiving a new stable template ID',
  );

  const firstShared = socialImage.normalizeSocialImageTemplate({
    ...defaultTemplate,
    id: 'shared-card',
    name: 'Shared v1',
  });
  const updatedShared = socialImage.normalizeSocialImageTemplate({
    ...firstShared,
    name: 'Shared v2',
  });
  assert.deepEqual(
    socialImage.normalizeSocialImageTemplateLibrary([
      firstShared,
      duplicatedTemplate,
      updatedShared,
    ]).map(({ id, name }) => ({ id, name })),
    [
      { id: 'shared-card', name: 'Shared v2' },
      { id: duplicatedTemplate.id, name: 'Card de produto' },
    ],
    'catalog normalization must update a shared ID in place without duplicating assignments',
  );
  assert.deepEqual(
    socialImage.upsertSocialImageTemplateLibrary([firstShared], updatedShared),
    [updatedShared],
    'editing a catalog template must preserve its ID so every linked page sees the update',
  );
  const fullLibrary = Array.from(
    { length: socialImage.SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES },
    (_, index) => socialImage.normalizeSocialImageTemplate({
      id: `catalog-${index + 1}`,
      name: `Catalog ${index + 1}`,
      elements: [],
    }),
  );
  const overflowTemplate = socialImage.normalizeSocialImageTemplate({
    id: 'catalog-overflow',
    name: 'Must not dangle',
    elements: [],
  });
  const rejectedOverflow = socialImage.upsertSocialImageTemplateLibrary(
    fullLibrary,
    overflowTemplate,
  );
  assert.equal(rejectedOverflow.length, socialImage.SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES);
  assert.ok(
    !rejectedOverflow.some(template => template.id === overflowTemplate.id),
    'a full catalog must reject a new template instead of returning 201 entries',
  );
  const updatedAtCapacity = socialImage.normalizeSocialImageTemplate({
    ...fullLibrary[17],
    name: 'Updated at capacity',
  });
  assert.equal(
    socialImage.upsertSocialImageTemplateLibrary(fullLibrary, updatedAtCapacity)[17].name,
    'Updated at capacity',
    'an existing shared template must remain editable at the catalog limit',
  );
  const duplicateBeforeLastUnique = socialImage.normalizeSocialImageTemplateLibrary([
    ...fullLibrary.slice(0, -1),
    fullLibrary[0],
    fullLibrary.at(-1),
  ]);
  assert.equal(
    duplicateBeforeLastUnique.length,
    socialImage.SOCIAL_IMAGE_MAX_LIBRARY_TEMPLATES,
    'the catalog cap must count unique IDs rather than the first 200 raw rows',
  );
  assert.ok(
    duplicateBeforeLastUnique.some(template => template.id === fullLibrary.at(-1).id),
    'a duplicate migration row must not consume the final unique catalog slot',
  );
  const lateUpdate = socialImage.normalizeSocialImageTemplate({
    ...fullLibrary[0],
    name: 'Last write after capacity',
  });
  assert.equal(
    socialImage.normalizeSocialImageTemplateLibrary([...fullLibrary, lateUpdate])[0].name,
    'Last write after capacity',
    'last-write-wins updates must still apply after the unique catalog is full',
  );

  const baseSocialHtml = '<!doctype html><html><head></head><body></body></html>';
  const inheritedManualImageHtml = seoSettings.applySeoToHtml(
    baseSocialHtml,
    'about.html',
    {
      socialImage: 'https://example.com/site-social.jpg',
    },
    {},
  );
  assert.match(
    inheritedManualImageHtml,
    /<meta property="og:image" content="https:\/\/example\.com\/site-social\.jpg">/,
    'a page without its own manual image must inherit the site-wide Social Image',
  );
  assert.match(
    inheritedManualImageHtml,
    /<meta name="twitter:image" content="https:\/\/example\.com\/site-social\.jpg">/,
    'the inherited site-wide image must also feed Twitter/X metadata',
  );
  const overriddenManualImageHtml = seoSettings.applySeoToHtml(
    baseSocialHtml,
    'about.html',
    {
      socialImage: 'https://example.com/site-social.jpg',
    },
    {
      socialImage: 'https://example.com/about-social.jpg',
    },
  );
  assert.match(
    overriddenManualImageHtml,
    /<meta property="og:image" content="https:\/\/example\.com\/about-social\.jpg">/,
    'a page-level manual image must override the site-wide default',
  );
  assert.doesNotMatch(
    overriddenManualImageHtml,
    /site-social\.jpg/,
    'a page override must not leave stale site-wide Social Image metadata behind',
  );
  const danglingCardHtml = seoSettings.applySeoToHtml(
    baseSocialHtml,
    'index.html',
    {
      socialImageTemplates: [firstShared],
      socialImageTemplateId: 'missing-template',
    },
    {},
  );
  assert.match(
    danglingCardHtml,
    /<meta name="twitter:card" content="summary">/,
    'a dangling imported catalog reference must not advertise a generated large image',
  );
  const assignedCardHtml = seoSettings.applySeoToHtml(
    baseSocialHtml,
    'index.html',
    {
      socialImageTemplates: [firstShared],
      socialImageTemplateId: firstShared.id,
    },
    {},
  );
  assert.match(
    assignedCardHtml,
    /<meta name="twitter:card" content="summary_large_image">/,
    'a valid shared catalog assignment must advertise the generated social image',
  );
  const normalizedLegacyAssignmentHtml = seoSettings.applySeoToHtml(
    baseSocialHtml,
    'index.html',
    {
      socialImageTemplates: [firstShared],
      socialImageTemplateId: ' Shared Card ',
    },
    {},
  );
  assert.match(
    normalizedLegacyAssignmentHtml,
    /<meta name="twitter:card" content="summary_large_image">/,
    'legacy assignment IDs must normalize exactly like their catalog IDs',
  );

  const assetImageElement = socialImage.createSocialImageElement(
    'image',
    defaultTemplate,
  );
  const nestedAssetTemplate = socialImage.normalizeSocialImageTemplate({
    ...defaultTemplate,
    id: 'nested-assets',
    background: {
      ...defaultTemplate.background,
      image: '../../assets/social/background.png?v=4',
    },
    elements: [
      {
        ...assetImageElement,
        id: 'nested-local-image',
        source: '../../assets/social/hero.webp#focus',
      },
      {
        ...assetImageElement,
        id: 'wordpress-image',
        source: 'https://example.test/wp-content/uploads/card.webp',
        attachmentId: 456,
      },
      {
        ...assetImageElement,
        id: 'dynamic-image',
        source: '{{page.featured_image}}',
      },
    ],
  });
  const canonicalAssets = socialImage.canonicalizeSocialImageTemplateAssets(
    nestedAssetTemplate,
    'project/pages/products/item.html',
    'project',
  );
  assert.equal(canonicalAssets.background.image, '/project/assets/social/background.png?v=4');
  assert.equal(canonicalAssets.elements[0].source, '/project/assets/social/hero.webp#focus');
  assert.equal(
    canonicalAssets.elements[1].source,
    'https://example.test/wp-content/uploads/card.webp',
  );
  assert.equal(canonicalAssets.elements[1].attachmentId, 456);
  assert.equal(canonicalAssets.elements[2].source, '{{page.featured_image}}');
  assert.deepEqual(
    socialImage.canonicalizeSocialImageTemplateAssets(
      canonicalAssets,
      'project/another/deep/page.html',
      'project',
    ),
    canonicalAssets,
    'a project-root asset path must remain stable when the shared template is reused on another nested page',
  );

  const generatedElements = Array.from({ length: 80 }, (_, index) => (
    socialImage.createSocialImageElement(
      ['text', 'image', 'shape', 'icon'][index % 4],
      defaultTemplate,
    )
  ));
  assert.equal(
    new Set(generatedElements.map(element => element.id)).size,
    generatedElements.length,
    'newly inserted layers must not collide before the document is normalized',
  );
  for (const type of ['text', 'image', 'shape', 'icon']) {
    assert.ok(
      generatedElements.some(element => element.type === type && element.id.startsWith(`${type}-`)),
      `${type} insertions must receive a readable type-prefixed id`,
    );
  }

  const canonicalVariables = {
    'page.title': 'Canonical title',
    'page.excerpt': 'Canonical excerpt',
    'page.featured_image': 'https://example.test/featured.webp',
    'page.url': 'https://example.test/article',
    'page.date': '25/07/2026',
    'author.name': 'Ana',
    'author.avatar': 'https://example.test/ana.webp',
    'site.name': 'Kodety',
    'site.logo': 'https://example.test/logo.svg',
    'product.price': 'R$ 129,00',
    'product.image': 'https://example.test/product.webp',
    'category.name': 'Produto',
  };
  assert.equal(
    socialImage.resolveSocialImageValue(
      variableKeys.map(key => `{{${key}}}`).join('|'),
      canonicalVariables,
    ),
    Object.values(canonicalVariables).join('|'),
    'every documented namespaced variable must resolve in preview',
  );
  assert.equal(socialImage.socialImageVariableToken('page.title'), '{{page.title}}');
  assert.equal(
    socialImage.resolveSocialImageValue(
      '{{page.title}}|{{page.excerpt}}|{{page.featured_image}}|{{page.url}}|{{page.date}}|{{author.name}}|{{site.name}}|{{product.image}}',
      {
        title: 'Legacy title',
        description: 'Legacy description',
        featured_image: '/legacy.webp',
        permalink: '/legacy-page',
        date: 'yesterday',
        author: 'Legacy author',
        site_name: 'Legacy site',
      },
    ),
    'Legacy title|Legacy description|/legacy.webp|/legacy-page|yesterday|Legacy author|Legacy site|/legacy.webp',
    'legacy CMS bindings must remain valid aliases for namespaced templates',
  );
  assert.equal(
    socialImage.resolveSocialImageValue('{{page.title}}', {
      'page.title': 'Namespaced',
      title: 'Alias',
    }),
    'Namespaced',
    'a namespaced value must take precedence over its legacy alias',
  );
  assert.equal(
    socialImage.resolveSocialImageValue('{{page.title}}', {
      'page.title': null,
      title: 'Alias',
    }),
    '',
    'an explicit null namespaced value must not unexpectedly fall through to stale alias data',
  );
  assert.equal(
    socialImage.resolveSocialImageValue(
      '{{list}}|{{urlObject}}|{{valueObject}}|{{labelObject}}|{{emptyObject}}|{{zero}}|{{disabled}}|{{nil}}',
      {
        list: ['one', 2, false],
        urlObject: { url: '/asset.webp', value: 'ignored' },
        valueObject: { url: null, value: 42 },
        labelObject: { label: 'Label' },
        emptyObject: { nested: 'ignored' },
        zero: 0,
        disabled: false,
        nil: null,
      },
    ),
    'one, 2, false|/asset.webp|42|Label||0|false|',
    'arrays, supported object shapes and primitive falsy values must resolve predictably',
  );
  assert.equal(
    socialImage.resolveSocialImageValue('Before {{ unknown.value }} after', {}),
    'Before  after',
  );
  assert.equal(
    socialImage.resolveSocialImageValue('Before {{ unknown.value }} after', {}, true),
    'Before {{ unknown.value }} after',
    'the editor may preserve unknown tokens while the rendered image removes them',
  );
  assert.equal(
    socialImage.resolveSocialImageValue('{{missing}}', { missing: undefined }, true),
    '{{missing}}',
    'undefined data must follow the same unknown-token policy as an absent key',
  );
  assert.equal(
    socialImage.socialImageTemplateSignature(undefined),
    '',
    'an absent template must have a stable empty signature',
  );
  assert.equal(
    socialImage.socialImageTemplateSignature(bounded),
    JSON.stringify(bounded),
    'template signatures must be based on normalized persisted state',
  );

  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['social-image:test'],
    'node scripts/test-social-image-builder.mjs',
    'the focused suite must remain directly runnable',
  );
  assert.match(
    packageJson.scripts.test,
    /npm run html-editor:test[\s\S]*npm run social-image:test && npm run membership:test/,
    'the full suite must run social image contracts alongside the HTML editor contracts',
  );
  assert.equal(
    packageJson.scripts['wordpress:test-social-images'],
    'php Wordpress/tests/social-images-runtime.php',
    'the focused server renderer suite must remain directly runnable',
  );
  assert.match(
    packageJson.scripts['wordpress:test-runtime'],
    /npm run wordpress:test-checkouts && npm run wordpress:test-social-images && npm run wordpress:test-branding/,
    'the WordPress runtime suite must exercise social image generation',
  );

  const builderPath = path.join(
    root,
    'app/(builder)/kodety/html-editor/components/HtmlSocialImageBuilder.tsx',
  );
  if (await fileExists(builderPath)) {
    const [builderSource, cookieSettingsSource, settingsSource, settingsHostSource, editorSource, topbarSource, globalsSource] = await Promise.all([
      readFile(builderPath, 'utf8'),
      readFile(
        path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlCookieConsentSettings.tsx'),
        'utf8',
      ),
      readFile(
        path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettings.tsx'),
        'utf8',
      ),
      readFile(
        path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectSettingsHost.tsx'),
        'utf8',
      ),
      readFile(
        path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
        'utf8',
      ),
      readFile(
        path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorTopbar.tsx'),
        'utf8',
      ),
      readFile(path.join(root, 'app/globals.css'), 'utf8'),
    ]);
    assert.match(
      builderSource,
      /export function HtmlSocialImageBuilder/,
      'the dedicated editor must remain importable by project settings',
    );
    const socialColorPickerCalls = builderSource.match(/<ColorPicker\b[\s\S]*?\/>/g) || [];
    const cookieColorPickerCalls = cookieSettingsSource.match(/<ColorPicker\b[\s\S]*?\/>/g) || [];
    assert.equal(socialColorPickerCalls.length, 1, 'the shared social ColorField must keep one picker composition');
    assert.equal(cookieColorPickerCalls.length, 1, 'cookie settings must keep one picker composition');
    for (const [surface, calls] of [
      ['social image', socialColorPickerCalls],
      ['cookie settings', cookieColorPickerCalls],
    ]) {
      assert.ok(calls[0].includes('colorVariableCapability={null}'), `${surface} colors must not inherit a legacy variable repository`);
      assert.ok(calls[0].includes('solidOnly'), `${surface} must persist concrete solid colors`);
    }
    for (const [surface, source] of [
      ['social image', builderSource],
      ['cookie settings', cookieSettingsSource],
    ]) {
      assert.doesNotMatch(
        source,
        /(?:useColorVariablesStore|colorVariablesApi|nextColorVariableCapability|@\/lib\/api)/,
        `${surface} composition must not fetch or mutate the legacy color-variable repository`,
      );
    }
    assert.match(builderSource, /fixed inset-0 z-\[100\]/, 'the Social Image Builder must own its fullscreen layer');
    assert.match(
      builderSource,
      /data-kodety-fullscreen-surface="social-image-builder"/,
      'the Social Image Builder must participate in Agent-safe fullscreen layout',
    );
    assert.match(
      globalsSource,
      /data-workspace-agent-dock\]\[data-open=['"]false['"]\][\s\S]*?data-kodety-fullscreen-surface[\s\S]*?right: 2\.75rem !important[\s\S]*?data-open=['"]true['"][\s\S]*?right: max\(340px, min\(420px, 42vw\)\) !important/,
      'fullscreen workspace tools must reserve the collapsed and expanded Agent dock widths',
    );
    assert.match(
      `${editorSource}\n${topbarSource}`,
      /data-workspace-topbar[\s\S]*?z-30[\s\S]*?kodety-editor-topbar[^\n]*z-30/,
      'workspace bars must remain below fullscreen builders, dialogs and management surfaces',
    );
    assert.match(
      builderSource,
      /normalizeSocialImageTemplate/,
      'the editor must normalize untrusted persisted templates before editing or saving',
    );
    assert.match(
      builderSource,
      /createDefaultSocialImageTemplate/,
      'the editor must use the shared starter-template contract',
    );
    for (const label of [
      'Adicionar texto',
      'Adicionar imagem',
      'Adicionar forma',
      'Adicionar ícone',
      'Camadas',
      'Canvas',
      'Salvar',
      'Fechar',
    ]) {
      assert.ok(
        builderSource.includes(label),
        `the social image editor must expose the stable “${label}” control`,
      );
    }
    for (const label of [
      'Altura automática',
      'Ajustar canvas',
      'Área segura · 5%',
      'Âncora do elemento',
    ]) {
      assert.ok(
        builderSource.includes(label),
        `the responsive layout UI must expose “${label}”`,
      );
    }
    assert.match(
      builderSource,
      /function AnchorGrid/,
      'the inspector must expose one compact 3x3 anchor control',
    );
    assert.match(
      builderSource,
      /convertSocialImageElementWidthUnit\(current, widthUnit, canvasWidth\)/,
      'the px/percent switch must preserve resolved width',
    );
    assert.match(
      builderSource,
      /reanchorSocialImageElement\(/,
      'changing a pin must preserve the current visual rectangle',
    );
    assert.match(
      builderSource,
      /onAutoHeightChange=\{recordAutoTextHeight\}/,
      'fit-content text must feed its ephemeral browser measurement into selection geometry',
    );
    assert.match(
      builderSource,
      /materializeAutoTextHeights\(draftRef\.current\)/,
      'fit-content measurements must only enter the persisted fallback height when saving',
    );
    assert.match(
      builderSource,
      /socialImageLayerPixelBudget\(\s*draft\.elements,\s*draft\.width,\s*draft\.height,/,
      'the warning must evaluate percentage width and auto-height against the active canvas',
    );
    assert.match(
      builderSource,
      /Posição, tamanho e âncora continuam individuais/,
      'multi-selection must not collapse geometry to the primary element inspector values',
    );
    assert.match(
      builderSource,
      /whitespace-pre-wrap break-words/,
      'browser fit-content wrapping must include long-word fragmentation like the server',
    );
    assert.match(
      builderSource,
      /absolute bottom-4[\s\S]*<SelectionToolbar/,
      'the selection toolbar must stay at the bottom of the Social Builder viewport',
    );
    assert.match(
      builderSource,
      /selectedCount=\{selectedElements\.length\}/,
      'the toolbar count and gap controls must use the actual selected layers',
    );
    assert.match(
      builderSource,
      /key: `element:\$\{element\.id\}`/,
      'manual gap must operate on each selected layer instead of a collapsed group unit',
    );
    assert.ok(
      builderSource.includes('Stack H') && builderSource.includes('Stack V'),
      'the Social Builder must expose persistent horizontal and vertical Stack controls',
    );
    assert.match(
      builderSource,
      /materializeSocialImageStacks\(withStack, autoTextHeights\)/,
      'creating a Stack must materialize its first layout without a visual jump',
    );
    assert.match(
      settingsSource,
      /HtmlSocialImageBuilder/,
      'page settings must open the dedicated social image editor',
    );
    assert.match(
      settingsSource,
      /socialImageTemplate/,
      'page settings must keep the editable template separate from the generated image URL',
    );
    assert.match(
      settingsSource,
      /Social Image Builder/,
      'an empty social image setting must offer the builder entry point',
    );
    const generalSettingsSource = settingsSource.slice(
      settingsSource.indexOf("{section === 'general'"),
      settingsSource.indexOf("{section === 'seo'"),
    );
    const seoSettingsSource = settingsSource.slice(
      settingsSource.indexOf("{section === 'seo'"),
      settingsSource.indexOf("{section === 'code'"),
    );
    assert.match(
      generalSettingsSource,
      /title="Social Image padrão"/,
      'the General site settings must expose the site-wide Social Image default',
    );
    assert.match(
      generalSettingsSource,
      /value=\{siteDraft\.socialImage \|\| ''\}/,
      'the General section must edit the canonical site-wide manual image field',
    );
    assert.match(
      generalSettingsSource,
      /openSocialImageBuilder\('site'\)/,
      'the General section must provide direct access to the site-wide builder',
    );
    assert.doesNotMatch(
      seoSettingsSource,
      /value=\{siteDraft\.socialImage \|\| ''\}|openSocialImageBuilder\('site'\)/,
      'manual and builder controls must not be duplicated in SEO settings',
    );
    assert.match(
      settingsSource,
      /pageDraft\.socialImage \|\| siteDraft\.socialImage \|\| ''/,
      'page previews must resolve the manual Social Image through the site default',
    );
    assert.match(
      settingsSource,
      /pageInheritsManualSocialImage[\s\S]*Imagem padrão de Geral[\s\S]*Herdada/,
      'page settings must make inherited manual Social Images explicit',
    );
    assert.match(
      settingsSource,
      /Editar Social Image/,
      'a saved social image template must expose its edit action',
    );
    assert.match(
      settingsSource,
      /key: cmsSocialVariableKey\(field\.key\)/,
      'CMS fields must use the same field:* namespace understood by the WordPress renderer',
    );
    assert.match(
      settingsSource,
      /run: \(\) => onSaveSite\(next\)/,
      'saving a site template must persist immediately instead of depending on a later autosave timer',
    );
    assert.match(
      settingsSource,
      /run: \(\) => onSavePage\(path, next, nextPath\)/,
      'saving a page template must persist immediately instead of depending on a later autosave timer',
    );
    assert.match(
      builderSource,
      /importe a imagem antes de gerar no servidor/,
      'the editor must explain that arbitrary remote assets need to be imported before server rendering',
    );
    assert.match(
      builderSource,
      /resolveProjectPath/,
      'relative social-image assets must use the project preview path convention',
    );
    assert.match(
      builderSource,
      /URL\.createObjectURL/,
      'project-owned binary social-image assets must preview through a temporary blob URL',
    );
    assert.match(
      settingsSource,
      /assetPreview=\{\{/,
      'settings must pass project files, page context and the public site base to the builder',
    );
    assert.match(
      builderSource,
      /imageAttachmentId: selectedMedia\.id/,
      'backgrounds selected from WordPress must persist their attachment ID',
    );
    assert.match(
      builderSource,
      /attachmentId: selectedMedia\.id/,
      'image layers selected from WordPress must persist their attachment ID',
    );
    assert.match(
      builderSource,
      /media_details\?\.sizes\?\.medium\?\.source_url[\s\S]*?media_details\?\.sizes\?\.thumbnail\?\.source_url/,
      'the Builder media picker must prefer the uncropped proportional preview',
    );
    assert.match(
      builderSource,
      /max-h-full w-auto max-w-full object-contain/,
      'the Builder media picker must fit previews without stretching them',
    );
    assert.match(
      settingsSource,
      /max-h-full w-auto max-w-full object-contain/,
      'settings media pickers must fit previews without stretching them',
    );
    assert.doesNotMatch(
      builderSource,
      /shadow-\[0_25px_80px_rgba\(0,0,0,0\.45\)\]/,
      'the editor canvas must not add a large external drop shadow around the template',
    );
    assert.match(
      settingsSource,
      /socialImageTemplates: nextLibrary/,
      'saved templates must be upserted into the site-level reusable catalog',
    );
    assert.match(
      settingsSource,
      /socialImageTemplateId: canonicalTemplate\.id/,
      'site and page assignments must reference stable catalog IDs',
    );
    assert.match(
      settingsSource,
      /duplicateSocialImageTemplate\(/,
      'personalizing an inherited page template must create a new catalog identity',
    );
    assert.match(
      settingsSource,
      /value === '__inherit__' \? undefined : value/,
      'pages must be able to inherit or select any existing shared template',
    );
    assert.match(
      settingsSource,
      /canonicalizeSocialImageTemplateAssets\(/,
      'templates must canonicalize page-relative assets before entering the shared library',
    );
    assert.match(
      builderSource,
      /Ele continuará disponível na biblioteca/,
      'unlinking an assignment must explain that it does not delete the shared template',
    );
    assert.match(
      settingsSource,
      /for \(const templateToKeep of \[currentTemplate, selectedTemplate\]\)/,
      'unlinking or switching assignments must retain both the current legacy template and the selection',
    );
    assert.match(
      settingsSource,
      /await onSaveSite\(nextSite\);\s*await onSavePage\(path, nextPage, nextPath\);/,
      'catalog insertion and page assignment must share one failure-gated queued transaction',
    );
    assert.match(
      settingsSource,
      /const pendingIndex = request\.coalesceKey[\s\S]*pending\.coalesceKey === request\.coalesceKey/,
      'pending saves must coalesce by an explicit page-aware key instead of broad scope',
    );
    const compoundSaveSource = settingsSource.match(
      /const enqueueSocialImageSiteAndPageSave[\s\S]*?const openSocialImageBuilder/,
    )?.[0] || '';
    assert.match(compoundSaveSource, /scope: 'page'/);
    assert.doesNotMatch(
      compoundSaveSource,
      /coalesceKey:/,
      'the dependency-sensitive catalog/page transaction must remain non-coalescible',
    );
    assert.match(
      settingsSource,
      /nextLibrary\.some\(template => template\.id === canonicalTemplate\.id\)/,
      'a catalog-capacity rejection must abort before persisting a dangling assignment',
    );
    assert.match(
      settingsSource,
      /legacyTemplates\.filter\(template => !storedIds\.has\(template\.id\)\)/,
      'legacy embedded copies must never overwrite a newer persisted catalog template',
    );
    assert.match(
      settingsSource,
      /const normalizedId = normalizeSocialImageTemplateId\(id\)/,
      'editor lookups must resolve legacy assignment IDs with catalog normalization',
    );
    assert.match(
      `${settingsHostSource}\n${editorSource}`,
      /\.\.\.\(readEditorMetadata\(current\)\.siteSettings \|\| \{\}\)/,
      'page SEO writes must read the catalog committed by a preceding site save',
    );
    assert.match(
      builderSource,
      /import socialImageGeistUrl from '@\/lib\/html-editor\/fonts\/geist\/Geist-Regular\.ttf\?url';/,
      'the browser preview must load Geist Regular from repository-owned source',
    );
    assert.doesNotMatch(
      builderSource,
      /node_modules[\\/]next/,
      'the Social Image Builder must not pull Next internals into the WordPress chunk graph',
    );
    assert.doesNotMatch(
      builderSource,
      /(?:from\s+|import\()\s*['"](?:@\/)?(?:node_modules\/)?next(?:\/|['"])/,
      'the Social Image Builder must not import Next directly or through its compiled internals',
    );
    assert.match(
      builderSource,
      /new FontFace\(\s*SOCIAL_IMAGE_BROWSER_FONT_FACE,\s*`url\(\$\{JSON\.stringify\(socialImageGeistUrl\)\}\) format\("truetype"\)`,\s*\{ style: 'normal', weight: '400' \},\s*\)/,
      'the source-owned TTF must keep the browser preview on the shared regular 400 face',
    );
    assert.match(
      builderSource,
      /fontFamily: usesProjectFont[\s\S]*?: SOCIAL_IMAGE_BROWSER_FONT_FAMILY,[\s\S]*?fontWeight: usesProjectFont \? element\.fontWeight : 400/,
      'fallback social text must keep the shared Geist browser family and regular face',
    );
    assert.match(
      builderSource,
      /useFontsStore\(state => state\.projectFonts\)/,
      'the Social Image inspector must consume the same project font catalog as the Builder',
    );
    assert.match(
      builderSource,
      /useFontsStore\.getState\(\)\.syncProjectFonts\(\{/,
      'a fresh standalone Settings session must discover project fonts when the Social Image Builder opens',
    );
    assert.match(
      settingsHostSource,
      /sourceFile\.data === undefined && sourceFile\.text === undefined[\s\S]*?loadProjectFile\(fontFile\)/,
      'a lazy font descriptor must fetch its binary before conversion instead of short-circuiting on path presence',
    );
    assert.match(
      builderSource,
      /const selectedFace = socialFontFaceFor\(font, requestedWeight\)/,
      'selecting a project family must choose the face nearest to the requested weight',
    );
    assert.match(
      builderSource,
      /await onPrepareFontFile\(selectedFace\.path\)/,
      'selecting a project family must prepare its portable TTF/OTF source',
    );
    assert.match(
      builderSource,
      /fontFileWeight: selectedFace\.weight/,
      'the selected face’s real weight must be persisted beside its portable source',
    );
    assert.match(
      builderSource,
      /syntheticTextWeightShadow/,
      'the preview must mirror the renderer’s deterministic synthetic weights',
    );
    assert.doesNotMatch(
      builderSource,
      /label="Itálico"/,
      'the editor must not advertise an italic face that is absent from the package',
    );
  }

  const [packagingSource, viteSource, runtimeSource, pluginSource, uninstallSource] = await Promise.all([
    readFile(path.join(root, 'scripts/package-wordpress-plugin.mjs'), 'utf8'),
    readFile(path.join(root, 'Wordpress/vite.config.ts'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-social-images.php'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/kodety.php'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/uninstall.php'), 'utf8'),
  ]);
  assert.match(packagingSource, /Geist-Regular\.ttf/);
  assert.match(packagingSource, /geist-license\.txt/);
  assert.match(viteSource, /geist-regular\.ttf/);
  assert.match(viteSource, /geist-license\.txt/);
  assert.match(packagingSource, /wawoff2[\s\S]*wawoff2-license\.txt/);
  assert.match(
    runtimeSource,
    /CSS_PIXEL_TO_POINT = 0\.75/,
    'GD must convert CSS pixel sizes to FreeType points',
  );
  assert.match(runtimeSource, /assets\/fonts\/geist-regular\.ttf/);
  assert.match(
    runtimeSource,
    /local_asset_path\(\$project_font, \['ttf', 'otf'\]\)/,
    'the published renderer must resolve selected project fonts inside the generated theme',
  );
  assert.doesNotMatch(
    runtimeSource,
    /usr\/share\/fonts|System\/Library\/Fonts|Library\/Fonts/,
    'social-image typography must not vary with fonts installed on the host',
  );
  assert.match(
    pluginSource,
    /register_deactivation_hook\(__FILE__, \['Kodety_Social_Images', 'deactivate'\]\)/,
    'plugin deactivation must stop social-image background workers',
  );
  assert.match(runtimeSource, /public static function deactivate\(\): void/);
  for (const hook of ['kodety_social_images_generate', 'kodety_social_images_scan']) {
    assert.match(
      uninstallSource,
      new RegExp(`wp_unschedule_hook\\('${hook}'\\)`),
      `uninstall must remove the ${hook} jobs including events with payload arguments`,
    );
  }

  console.log('Social image builder regression tests passed.');
} finally {
  await server.close();
}
