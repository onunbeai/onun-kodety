import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'custom',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const editor = await server.ssrLoadModule('/components/ui/code-editor.tsx');
  const formatter = await server.ssrLoadModule('/lib/html-editor/code-formatter.ts');
  const fileSelection = await server.ssrLoadModule('/lib/html-editor/code-file-selection.ts');
  const editorPanelSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorCodePanel.tsx'),
    'utf8',
  );
  const projectEditorSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlProjectEditor.tsx'),
    'utf8',
  );
  const leftSidebarSource = await readFile(
    path.join(root, 'app/(builder)/kodety/html-editor/components/HtmlEditorLeftSidebar.tsx'),
    'utf8',
  );

  const syntax = editor.renderCodeHighlight('<main class="hero">Olá</main>', 'html');
  assert.equal(syntax.status, 'syntax');
  assert.match(syntax.html, /token tag/);

  const plain = editor.renderCodeHighlight('  <unsafe>&', 'plain');
  assert.equal(plain.status, 'plain');
  assert.match(plain.html, /code-editor-indent/);
  assert.match(plain.html, /&lt;unsafe&gt;&amp;/);

  const largeSource = '<section>&'.repeat(100);
  const large = editor.renderCodeHighlight(largeSource, 'html', 50);
  assert.equal(large.status, 'large-file');
  assert.doesNotMatch(large.html, /token tag/);
  assert.match(large.html, /^&lt;section&gt;&amp;/);

  const minified = editor.renderCodeHighlight('const value = 1;'.repeat(20), 'javascript', 1_000, 40);
  assert.equal(minified.status, 'large-file');
  assert.doesNotMatch(minified.html, /token keyword/);

  assert.equal(formatter.canFormatCode('templates\\Home.HTML?raw#preview'), true);
  assert.equal(formatter.canFormatCode('styles/theme.SCSS'), true);
  assert.equal(formatter.canFormatCode('README.md'), false);

  const formatted = await formatter.formatCode('scripts/example.JS', 'const value={ok:true}');
  assert.match(formatted, /const value = \{ ok: true \};/);

  await assert.rejects(
    formatter.formatCode('README.md', '# title'),
    (error) => error?.code === 'unsupported-file',
  );
  await assert.rejects(
    formatter.formatCode('index.html', '<main></main>', { maxSourceLength: 5 }),
    (error) => error?.code === 'source-too-large',
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    formatter.formatCode('index.html', '<main></main>', { signal: controller.signal }),
    (error) => error?.code === 'aborted',
  );

  const project = {
    name: 'Code fallback',
    mainHtmlPath: 'index.html',
    rootPath: '',
    openedAt: 1,
    files: {
      'index.html': { path: 'index.html', mimeType: 'text/html', text: '<main />' },
      'assets/logo.png': { path: 'assets/logo.png', mimeType: 'image/png', data: new Uint8Array([1]) },
      'styles/site.css': { path: 'styles/site.css', mimeType: 'text/css', text: '' },
    },
  };
  assert.equal(
    fileSelection.resolveGlobalCodeEditorPath(project, 'styles/site.css'),
    'styles/site.css',
    'a remembered editable file must remain selected, including an empty text file',
  );
  assert.equal(
    fileSelection.resolveGlobalCodeEditorPath(project, 'assets/logo.png'),
    'index.html',
    'a remembered binary asset must fall back to the editable main HTML document',
  );
  assert.equal(
    fileSelection.resolveGlobalCodeEditorPath(project, 'missing.js'),
    'index.html',
    'a stale remembered path must fall back to the editable main HTML document',
  );
  assert.equal(
    fileSelection.resolveGlobalCodeEditorPath(
      {
        ...project,
        mainHtmlPath: 'assets/logo.png',
        files: {
          '.incode/editor.json': { path: '.incode/editor.json', mimeType: 'application/json', text: '{}' },
          'z-last.txt': { path: 'z-last.txt', mimeType: 'text/plain', text: 'z' },
          'assets/logo.png': project.files['assets/logo.png'],
          'a-first.css': { path: 'a-first.css', mimeType: 'text/css', text: 'a{}' },
        },
      },
      'assets/logo.png',
    ),
    'a-first.css',
    'when the main path is not editable, the first deterministic user text file must be selected',
  );
  assert.equal(
    fileSelection.resolveGlobalCodeEditorPath(
      { ...project, mainHtmlPath: 'assets/logo.png', files: { 'assets/logo.png': project.files['assets/logo.png'] } },
      'assets/logo.png',
    ),
    '',
    'projects without text files must report that no code editor target exists',
  );

  assert.match(
    editorPanelSource,
    /const activePath = codeFilePath \|\| project\.mainHtmlPath;[\s\S]*?const activeFile = project\.files\[activePath\];[\s\S]*?key=\{`\$\{project\.openedAt\}:\$\{activePath\}`\}[\s\S]*?value=\{activeValue\}/,
    'switching code files must remount the editor with the active file value so undo history cannot cross paths or projects',
  );
  assert.doesNotMatch(
    editorPanelSource,
    /value=\{project\.files\[codeFilePath\]\?\.text \?\? source\}/,
    'the code panel must not combine an active fallback path with a value read through the stale raw store path',
  );
  assert.match(
    projectEditorSource,
    /const openGlobalCodeEditor = \(\) => \{[\s\S]*?resolveGlobalCodeEditorPath\([\s\S]*?codeFilePath[\s\S]*?openCodeFile\(path\);[\s\S]*?\};/,
    'the global Code command must resolve a safe editable target before opening the panel',
  );
  assert.match(
    projectEditorSource,
    /if \(optionArea === '4'\) \{[\s\S]*?openGlobalCodeEditor\(\);[\s\S]*?return;/,
    'Alt+4 must use the same safe global Code resolver as the sidebar button',
  );
  assert.match(
    leftSidebarSource,
    /showCode \? setShowCode\(false\) : openGlobalCodeEditor\(\)/,
    'the sidebar Code button must use the safe global Code resolver',
  );

  console.log('Code editor and formatter regression tests passed');
} finally {
  await server.close();
}
