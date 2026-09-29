import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

try {
  const projectIo = await server.ssrLoadModule('/lib/html-editor/project-io.ts');
  const pageRename = await server.ssrLoadModule('/lib/html-editor/page-rename.ts');
  const localization = await server.ssrLoadModule('/lib/html-editor/localization.ts');
  const localizedCss = await server.ssrLoadModule('/lib/html-editor/localized-css.ts');
  const project = {
    name: 'Publication state',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: Date.now(),
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<!doctype html><title>Home</title>' },
      'about.html': { path: 'about.html', mimeType: 'text/html', text: '<!doctype html><title>About</title>' },
      '.incode/project.json': {
        path: '.incode/project.json',
        mimeType: 'application/json',
        text: JSON.stringify({ version: 1, mainHtmlPath: 'index.html', homeHtmlPath: 'index.html' }),
      },
    },
  };

  assert.equal(projectIo.getPagePublicationStatus(project, 'about.html'), 'active');
  const cachedMetadata = projectIo.readEditorMetadata(project);
  assert.equal(
    projectIo.readEditorMetadata(project),
    cachedMetadata,
    'unchanged metadata file objects reuse their parsed snapshot',
  );
  const metadataFile = project.files['.incode/project.json'];
  metadataFile.text = JSON.stringify({
    ...cachedMetadata,
    name: 'Metadata cache invalidated',
  });
  const reparsedMetadata = projectIo.readEditorMetadata(project);
  assert.notEqual(
    reparsedMetadata,
    cachedMetadata,
    'an in-place metadata text update invalidates the parse cache',
  );
  assert.equal(reparsedMetadata.name, 'Metadata cache invalidated');
  assert.equal(
    projectIo.readEditorMetadata(project),
    reparsedMetadata,
    'the updated text is cached after it is parsed once',
  );
  const replacementProject = {
    ...project,
    files: {
      ...project.files,
      '.incode/project.json': { ...metadataFile },
    },
  };
  assert.notEqual(
    projectIo.readEditorMetadata(replacementProject),
    reparsedMetadata,
    'replacing the metadata file object establishes a separate cache entry',
  );
  const drafted = projectIo.setPagePublicationStatus(project, 'about.html', 'draft');
  assert.equal(projectIo.getPagePublicationStatus(drafted, 'about.html'), 'draft');
  assert.equal(projectIo.readEditorMetadata(drafted).pageStatuses['about.html'], 'draft');
  assert.throws(
    () => projectIo.setPagePublicationStatus(drafted, 'index.html', 'draft'),
    /página inicial não pode virar Draft/i,
  );
  assert.throws(
    () => projectIo.setProjectHomePath(drafted, 'about.html'),
    /Ative a página antes/i,
  );

  const renamed = pageRename.renameProjectPage(drafted, 'about.html', 'company.html').project;
  assert.equal(projectIo.getPagePublicationStatus(renamed, 'company.html'), 'draft');
  assert.equal(projectIo.readEditorMetadata(renamed).pageStatuses['about.html'], undefined);
  const activated = projectIo.setPagePublicationStatus(renamed, 'company.html', 'active');
  assert.equal(projectIo.getPagePublicationStatus(activated, 'company.html'), 'active');
  assert.equal(projectIo.readEditorMetadata(activated).pageStatuses, undefined);

  const localeCode = 'pt-BR';
  const localizedPagePath = 'pages/about.html';
  const renamedLocalizedPagePath = 'company/team.html';
  const oldLocalizedCssPath = localizedCss.localizedPageStylesheetPath(localizedPagePath, localeCode);
  const nextLocalizedCssPath = localizedCss.localizedPageStylesheetPath(renamedLocalizedPagePath, localeCode);
  const baseLocalization = localization.defaultLocalization();
  const localizedSettings = {
    ...baseLocalization,
    locales: [
      ...baseLocalization.locales,
      {
        code: localeCode,
        language: 'Portuguese',
        region: 'BR',
        name: 'Português (Brasil)',
        slug: 'pt-br',
        enabled: true,
        fallback: baseLocalization.sourceLocale,
      },
    ],
    translations: {
      ...baseLocalization.translations,
      [localeCode]: {
        pages: {
          [localizedPagePath]: {
            entries: {},
            stylesheet: oldLocalizedCssPath,
          },
        },
      },
    },
  };
  const localizedRenameProject = projectIo.updateEditorMetadata({
    ...project,
    mainHtmlPath: localizedPagePath,
    files: {
      ...project.files,
      [localizedPagePath]: {
        path: localizedPagePath,
        mimeType: 'text/html',
        text: '<!doctype html><html><head></head><body></body></html>',
      },
      [oldLocalizedCssPath]: {
        path: oldLocalizedCssPath,
        mimeType: 'text/css',
        text: `${localizedCss.LOCALIZED_PAGE_STYLESHEET_HEADER}\n[data-kodety-l10n-id="hero"] { width: 80% !important; }`,
      },
    },
  }, metadata => ({ ...metadata, localization: localizedSettings }));
  const localizedRenamed = pageRename.renameProjectPage(
    localizedRenameProject,
    localizedPagePath,
    renamedLocalizedPagePath,
  ).project;
  const localizedRenamedMetadata = projectIo.readEditorMetadata(localizedRenamed);
  assert.equal(localizedRenamed.files[oldLocalizedCssPath], undefined);
  assert.match(localizedRenamed.files[nextLocalizedCssPath].text, /width:\s*80%\s*!important/);
  assert.equal(
    localizedRenamedMetadata.localization.translations[localeCode]
      .pages[renamedLocalizedPagePath].stylesheet,
    nextLocalizedCssPath,
  );

  const collisionProject = {
    ...localizedRenameProject,
    files: {
      ...localizedRenameProject.files,
      [nextLocalizedCssPath]: {
        path: nextLocalizedCssPath,
        mimeType: 'text/css',
        text: '/* user file */',
      },
    },
  };
  assert.throws(
    () => pageRename.renameProjectPage(collisionProject, localizedPagePath, renamedLocalizedPagePath),
    /já existe/i,
  );
  assert.match(collisionProject.files[nextLocalizedCssPath].text, /user file/);

  const sharedCssPath = 'styles/shared-locale.css';
  const nonManagedSettings = {
    ...localizedSettings,
    translations: {
      ...localizedSettings.translations,
      [localeCode]: {
        pages: {
          [localizedPagePath]: { entries: {}, stylesheet: sharedCssPath },
        },
      },
    },
  };
  const nonManagedProject = projectIo.updateEditorMetadata({
    ...localizedRenameProject,
    files: {
      ...localizedRenameProject.files,
      [sharedCssPath]: { path: sharedCssPath, mimeType: 'text/css', text: '.shared { color: red; }' },
    },
  }, metadata => ({ ...metadata, localization: nonManagedSettings }));
  const nonManagedRenamed = pageRename.renameProjectPage(
    nonManagedProject,
    localizedPagePath,
    renamedLocalizedPagePath,
  ).project;
  assert.equal(
    projectIo.readEditorMetadata(nonManagedRenamed).localization.translations[localeCode]
      .pages[renamedLocalizedPagePath].stylesheet,
    sharedCssPath,
  );
  assert.match(nonManagedRenamed.files[sharedCssPath].text, /color:\s*red/);

  const [navigatorSource, editorSource, overlaySource, phpSource] = await Promise.all([
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlNavigator.tsx'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'), 'utf8'),
    readFile(path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorChromeOverlays.tsx'), 'utf8'),
    readFile(path.join(root, 'Wordpress/kodety/includes/class-kodety-plugin.php'), 'utf8'),
  ]);
  assert.match(navigatorSource, /Mover para Draft/);
  assert.match(navigatorSource, /Ativar página/);
  assert.match(navigatorSource, /publicationStatus === 'draft'[\s\S]*?>\s*Draft\s*</);
  assert.match(editorSource, /openStandalonePageSettings[\s\S]*?searchParams\.set\('section', path\)[\s\S]*?navigateAfterWordPressSave/);
  assert.doesNotMatch(editorSource, /<HtmlProjectSettingsOverlayHost/);
  assert.doesNotMatch(overlaySource, /HtmlCmsManager|HtmlMembersManager/);
  assert.match(phpSource, /project_draft_page_paths[\s\S]*?Uma página Draft não pôde ser removida da árvore pública/);
  assert.match(phpSource, /array_filter\([\s\S]*?!isset\(\$draft_pages\[\$relative\]\)/);

  console.log('page-publication: ok');
} finally {
  await server.close();
}
