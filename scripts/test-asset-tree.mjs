import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { codeComponentReactRuntimePlugin } from './vite-code-component-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [codeComponentReactRuntimePlugin()],
  server: { middlewareMode: true },
});

function fixtureProject() {
  return {
    name: 'Asset tree fixture',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': {
        path: 'index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body><h1>Home</h1></body></html>',
      },
      'about/index.html': {
        path: 'about/index.html',
        mimeType: 'text/html',
        text: '<!doctype html><html><body>About</body></html>',
      },
      'styles/main.css': {
        path: 'styles/main.css',
        mimeType: 'text/css',
        text: 'body { color: black; }',
      },
      'src/main.js': {
        path: 'src/main.js',
        mimeType: 'text/javascript',
        text: 'window.fixture = true;',
      },
      'assets/img/hero.png': {
        path: 'assets/img/hero.png',
        mimeType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({
          version: 1,
          projectId: 'fixture-project',
          name: 'Asset tree fixture',
          mainHtmlPath: 'index.html',
          homeHtmlPath: 'index.html',
          rootPath: '',
        }),
      },
    },
  };
}

const names = (nodes) => nodes.map((node) => node.name);
const find = (nodes, name) => nodes.find((node) => node.name === name);

try {
  const experiments = await server.ssrLoadModule('/lib/html-editor/experiments.ts');
  const interactions = await server.ssrLoadModule('/lib/html-editor/interactions.ts');
  const assetTree = await server.ssrLoadModule('/lib/html-editor/asset-tree.ts');
  const pageTree = await server.ssrLoadModule('/lib/html-editor/page-tree.ts');

  const fixture = fixtureProject();
  const homeAnimationPath = interactions.interactionDocumentPath('index.html');
  fixture.files[homeAnimationPath] = {
    path: homeAnimationPath,
    mimeType: 'application/json',
    text: JSON.stringify({ version: 2, interactions: [{ id: 'fade' }] }),
  };

  // --- Derived folders -----------------------------------------------------
  const tree = assetTree.buildProjectAssetTree(
    experiments.visibleExperimentFiles(fixture),
    fixture,
  );
  assert.deepEqual(
    names(tree),
    ['about', 'assets', 'src', 'styles', 'index.html', 'index.html.animations.json'],
    'folders come first, then files, both sorted naturally',
  );
  assert.equal(
    find(tree, 'assets').children[0].name,
    'img',
    'nested folders are derived from the path the files already have',
  );
  assert.equal(
    find(tree, 'assets').fileCount,
    1,
    'a folder reports how many files it contains, however deep',
  );
  assert.equal(
    find(find(tree, 'assets').children, 'img').children[0].fileKind,
    'media',
    'binary media is classified so the panel can render it differently',
  );

  // --- Animation companions ------------------------------------------------
  const animationNode = find(tree, 'index.html.animations.json');
  assert.equal(
    animationNode.path,
    homeAnimationPath,
    'the animation node addresses its real flattened storage path, not the display name',
  );
  assert.equal(
    animationNode.fileKind,
    'animation',
    'animation documents are their own kind so the panel can label them',
  );
  assert.equal(
    find(find(tree, 'about').children, 'index.html.animations.json'),
    undefined,
    'a page without animations must not show an empty companion',
  );

  // --- Pages hierarchy ----------------------------------------------------
  const pages = pageTree.buildHtmlPageTree([
    'index.html',
    'proposta/index.html',
    'proposta/briefing.html',
    'legal/privacy.html',
    'studio.html',
    'studio/team.html',
  ], 'index.html');
  const proposal = find(pages, 'proposta');
  assert.equal(proposal.kind, 'page', 'a directory with index.html is an openable page');
  assert.equal(proposal.pagePath, 'proposta/index.html');
  assert.equal(find(proposal.children, 'briefing').pagePath, 'proposta/briefing.html');
  assert.equal(find(pages, 'legal').kind, 'folder', 'a directory without index.html stays a pure folder');
  assert.equal(find(pages, 'studio').pagePath, 'studio.html', 'a sibling page merges with its subpage directory');
  const collisionPaths = [
    'index.html',
    'about.html',
    'about/index.html',
  ];
  const collisionTree = pageTree.buildHtmlPageTree(collisionPaths, 'index.html');
  const reversedCollisionTree = pageTree.buildHtmlPageTree(
    [...collisionPaths].reverse(),
    'index.html',
  );
  assert.deepEqual(
    collisionTree,
    reversedCollisionTree,
    'route-collision representation must be byte-for-byte deterministic regardless of input order',
  );
  assert.deepEqual(
    pageTree.flattenHtmlPageTree(collisionTree)
      .map(node => node.pagePath)
      .filter(Boolean)
      .sort(),
    ['about.html', 'about/index.html'],
    'the Pages tree must keep both route-colliding files visible instead of hiding one or crashing the Navigator',
  );
  assert.equal(collisionTree[0].pagePath, 'about.html', 'the same physical file remains the deterministic collision primary');
  assert.equal(collisionTree[0].children[0].pagePath, 'about/index.html', 'the colliding index remains visible as a child');
  assert.notEqual(
    collisionTree[0].folderPath,
    collisionTree[0].children[0].folderPath,
    'a collision must not manufacture a parent and child with the same folder identity',
  );
  assert.equal(
    pageTree.htmlPageMoveDestination('proposta/index.html', 'clientes'),
    'clientes/proposta/index.html',
    'moving a directory page preserves its public route shape',
  );
  assert.equal(
    pageTree.htmlPageMoveDestination('proposta/briefing.html', ''),
    'briefing.html',
    'moving a leaf page out places it at the Pages root',
  );
  assert.equal(pageTree.htmlPageNodeFolder('studio.html'), 'studio');
  assert.equal(pageTree.htmlPageNodeFolder('proposta/index.html'), 'proposta');
  assert.equal(
    pageTree.canDropHtmlPageTreeItem(
      { kind: 'page', path: 'proposta/briefing.html', folderPath: 'proposta/briefing' },
      '',
    ),
    true,
    'a nested page can be dragged back to the Pages root',
  );
  assert.equal(
    pageTree.canDropHtmlPageTreeItem(
      { kind: 'page', path: 'briefing.html', folderPath: 'briefing' },
      'proposta',
    ),
    true,
    'a root page can be dragged into another page or folder',
  );
  assert.equal(
    pageTree.canDropHtmlPageTreeItem(
      { kind: 'folder', path: 'proposta', folderPath: 'proposta' },
      'proposta/clientes',
    ),
    false,
    'a page subtree cannot be dragged inside itself',
  );

  // --- A/B folders: nothing diverged yet -----------------------------------
  const created = experiments.createExperiment(fixture, {
    name: 'Hero copy',
    pagePath: 'index.html',
  });
  const withVariant = experiments.createExperimentVariant(
    created.project,
    created.experiment.id,
    { name: 'Variant A' },
  );
  assert.deepEqual(
    assetTree.buildExperimentAssetFolders(withVariant.project),
    [],
    'a freshly cloned variant is byte-identical, so it contributes no folder',
  );

  // --- A/B folders: a changed file ----------------------------------------
  const variantPrefix = experiments.experimentVariantPrefix(
    created.experiment.id,
    withVariant.variant.id,
  );
  const changedProject = {
    ...withVariant.project,
    files: {
      ...withVariant.project.files,
      [`${variantPrefix}styles/main.css`]: {
        path: `${variantPrefix}styles/main.css`,
        mimeType: 'text/css',
        text: 'body { color: red; }',
      },
    },
  };
  const changedFolders = assetTree.buildExperimentAssetFolders(changedProject);
  assert.deepEqual(names(changedFolders), ['Hero copy'], 'the folder carries the test name');
  const variantFolder = changedFolders[0].children[0];
  assert.equal(variantFolder.name, 'Variant A', 'each variant is a subfolder named after itself');
  assert.equal(variantFolder.fileCount, 1, 'only the diverged file is listed');
  const changedFile = find(find(variantFolder.children, 'styles').children, 'main.css');
  assert.equal(changedFile.divergence, 'changed', 'a file that exists in Control is marked as changed');
  assert.equal(
    changedFile.path,
    `${variantPrefix}styles/main.css`,
    'opening the node must edit the variant copy, never Control',
  );

  // --- A/B folders: an animation-only variant ------------------------------
  const variantAnimationPath = interactions.interactionDocumentPath(
    `${variantPrefix}index.html`,
  );
  const retimedProject = {
    ...withVariant.project,
    files: {
      ...withVariant.project.files,
      [variantAnimationPath]: {
        path: variantAnimationPath,
        mimeType: 'application/json',
        text: JSON.stringify({ version: 2, interactions: [{ id: 'fade', duration: 2 }] }),
      },
    },
  };
  const retimedFolders = assetTree.buildExperimentAssetFolders(retimedProject);
  const retimedVariant = retimedFolders[0].children[0];
  assert.equal(
    retimedVariant.fileCount,
    1,
    'a variant whose only change is an animation still surfaces in its test folder',
  );
  assert.equal(
    find(retimedVariant.children, 'index.html.animations.json').divergence,
    'changed',
    'the animation companion is compared against Control, not ignored',
  );

  // --- A/B folders: a file deleted in the variant --------------------------
  const prunedFiles = { ...withVariant.project.files };
  delete prunedFiles[`${variantPrefix}src/main.js`];
  const prunedFolders = assetTree.buildExperimentAssetFolders({
    ...withVariant.project,
    files: prunedFiles,
  });
  assert.equal(
    find(find(prunedFolders[0].children[0].children, 'src').children, 'main.js').divergence,
    'removed',
    'a file the variant dropped is reported instead of silently vanishing',
  );

  // --- Search --------------------------------------------------------------
  const filtered = assetTree.filterAssetTree(tree, 'hero');
  assert.deepEqual(
    names(filtered),
    ['assets'],
    'search keeps the folders that lead to a match so the result still reads as a tree',
  );
  assert.equal(
    find(find(filtered, 'assets').children, 'img').children[0].name,
    'hero.png',
    'the matching file survives at its original depth',
  );
  assert.equal(
    assetTree.filterAssetTree(tree, 'window.fixture')[0].children[0].name,
    'main.js',
    'file contents are searchable, not just names',
  );
  assert.deepEqual(
    assetTree.filterAssetTree(tree, ''),
    tree,
    'an empty query returns the tree untouched',
  );

  // --- File type filters --------------------------------------------------
  assert.deepEqual(
    names(assetTree.filterAssetTree(tree, '', 'html')),
    ['about', 'index.html'],
    'the HTML filter keeps root and nested pages while pruning unrelated folders',
  );
  assert.deepEqual(
    names(assetTree.filterAssetTree(tree, '', 'css')),
    ['styles'],
    'the CSS filter keeps only stylesheet branches',
  );
  assert.equal(
    find(assetTree.filterAssetTree(tree, '', 'javascript'), 'src').children[0].name,
    'main.js',
    'the JavaScript filter keeps scripts at their original depth',
  );
  assert.equal(
    find(find(assetTree.filterAssetTree(tree, '', 'image'), 'assets').children, 'img')
      .children[0].name,
    'hero.png',
    'the image filter preserves nested binary assets',
  );
  assert.equal(
    assetTree.filterAssetTree(tree, 'body', 'javascript').length,
    0,
    'search and file type filters compose instead of overriding one another',
  );
  assert.equal(assetTree.matchesAssetTreeFileFilter('icons/mark.svg', 'svg'), true);
  assert.equal(assetTree.matchesAssetTreeFileFilter('icons/mark.svg', 'image'), false);
  assert.equal(assetTree.matchesAssetTreeFileFilter('media/intro.mp4', 'video'), true);
  assert.equal(assetTree.matchesAssetTreeFileFilter('media/theme.flac', 'audio'), true);
  assert.equal(assetTree.matchesAssetTreeFileFilter('fonts/site.woff2', 'font'), true);
  assert.equal(assetTree.matchesAssetTreeFileFilter('data/site.json', 'json'), true);
  assert.equal(assetTree.matchesAssetTreeFileFilter('notes/readme.txt', 'other'), true);

  // --- Destino público de uma variante aberta ------------------------------
  assert.equal(
    experiments.activeExperimentVariantTarget(withVariant.project),
    null,
    'com o Controle aberto não há variante para publicar',
  );
  const slugged = experiments.setExperimentVariantSlug(
    withVariant.project,
    created.experiment.id,
    withVariant.variant.id,
    'caseb',
  );
  const openedVariant = experiments.openExperimentVariant(
    slugged.project ?? slugged,
    created.experiment.id,
    withVariant.variant.id,
  );
  const target = experiments.activeExperimentVariantTarget(
    openedVariant.project ?? openedVariant,
  );
  assert.equal(
    target.slug,
    'caseb',
    'a variante aberta publica sob a slug do painel de A/B, não sob seu caminho privado',
  );
  assert.equal(
    target.variantName,
    'Variant A',
    'o destino identifica a variante pelo nome que o autor deu',
  );
  assert.equal(
    target.experimentName,
    'Hero copy',
    'e pelo teste a que ela pertence',
  );

  console.log('Asset tree: pastas, filtros, animações, divergência e destino de variantes aprovados.');
} finally {
  await server.close();
}
