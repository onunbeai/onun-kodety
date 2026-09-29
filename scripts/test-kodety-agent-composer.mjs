import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  appType: 'custom',
  logLevel: 'silent',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});

try {
  const { restoreAgentSkillSelection, isFigmaDesignToCodeSkill, agentSkillDisplayName, parseFigmaDesignLink, buildAgentComposerPrompt } = await server.ssrLoadModule('/lib/html-editor/agent-composer.ts');

  for (const value of ['', 'invalid', '{}', 'null', '[]', '[null, 42, ""]']) {
    assert.deepEqual(restoreAgentSkillSelection(value), ['kodety-editor'], 'fresh or invalid preferences must select Editor only');
  }
  for (const names of [
    ['kodety-editor', 'kodety-widgets'],
    ['kodety-editor', 'figma:figma-design-to-code', 'kodety-widgets'],
    ['figma', 'kodety-widgets', 'kodety-editor'],
  ]) {
    assert.deepEqual(restoreAgentSkillSelection(JSON.stringify(names), true), ['kodety-editor'], 'legacy automatic choices must migrate');
    assert.deepEqual(restoreAgentSkillSelection(JSON.stringify(names)), names, 'new deliberate choices must survive reload');
  }
  const customized = ['kodety-editor', 'kodety-widgets', 'kodety-motion'];
  assert.deepEqual(restoreAgentSkillSelection(JSON.stringify(customized), true), customized, 'custom legacy combinations must survive migration');
  assert.deepEqual(restoreAgentSkillSelection('["kodety-editor", " kodety-motion ", "kodety-editor"]'), ['kodety-editor', 'kodety-motion']);
  assert.deepEqual(restoreAgentSkillSelection('["kodety-editor", "figma:figma-design-to-code"]'), ['kodety-editor', 'figma:figma-design-to-code']);

  for (const name of ['figma:figma-design-to-code', 'figma-design-to-code', 'figma']) assert.equal(isFigmaDesignToCodeSkill(name), true);
  for (const name of ['figma:figma-use', 'figma:figma-create-new-file', 'kodety-editor', 'kodety-widgets']) assert.equal(isFigmaDesignToCodeSkill(name), false);
  assert.equal(agentSkillDisplayName('figma:figma-design-to-code', 'Figma Design to Code'), 'Figma to Kodety', 'use a Builder-only display alias');
  assert.equal(agentSkillDisplayName('kodety-widgets', 'Kodety Widgets'), 'Kodety Widgets');
  assert.equal(agentSkillDisplayName('kodety-editor'), 'kodety-editor');

  const designLink = 'https://www.figma.com/design/AbC123/Landing?node-id=12-34&t=example';
  assert.deepEqual(parseFigmaDesignLink(designLink), { url: designLink, nodeId: '12:34' });
  assert.equal(parseFigmaDesignLink('  figma.com/file/AbC123/Page?node-id=4%3A9  ').url, 'https://figma.com/file/AbC123/Page?node-id=4%3A9');
  assert.equal(parseFigmaDesignLink('https://www.figma.com/proto/AbC123/Page').nodeId, '');
  for (const value of [
    '', 'not-a-link', 'https://www.figma.com', 'https://figma.com/design/',
    'https://figma.com.evil.test/design/AbC123', 'https://evil.test/figma.com/design/AbC123',
    'https://figma.com@evil.test/design/AbC123', 'https://user:secret@figma.com/design/AbC123',
    'http://figma.com/design/AbC123', 'javascript:alert(1)', 'https://figma.com:444/design/AbC123',
    'https://figma.com/community/file/AbC123',
  ]) assert.equal(parseFigmaDesignLink(value), null, `must reject invalid design reference: ${value}`);

  const complete = buildAgentComposerPrompt({
    text: 'Mantenha o comportamento no mobile.',
    figmaDesignToCode: true,
    figmaLink: designLink,
    referenceImages: ['hero-desktop.png', 'hero-mobile.png'],
  });
  assert.match(complete, /Link do Figma:\nhttps:\/\/www\.figma\.com\/design\/AbC123\/Landing\?node-id=12-34/);
  assert.match(complete, /Prints do elemento anexados como referência visual:\n- hero-desktop\.png\n- hero-mobile\.png/);
  assert.match(complete, /Instruções complementares:\nMantenha o comportamento no mobile\./);
  assert.match(buildAgentComposerPrompt({ text: '', figmaDesignToCode: true, figmaLink: designLink }), /Implemente o elemento/);
  assert.match(buildAgentComposerPrompt({ text: '', figmaDesignToCode: true, referenceImages: ['reference.png'] }), /reference\.png/);
  assert.equal(buildAgentComposerPrompt({ text: 'Ajuste a margem.', figmaDesignToCode: true }), 'Ajuste a margem.', 'follow-up instructions must not require re-uploading references');
  assert.equal(buildAgentComposerPrompt({ text: '  Texto normal.  ', figmaLink: designLink, referenceImages: ['ignored.png'] }), 'Texto normal.', 'deselecting Figma must keep its draft link out of ordinary turns');
  assert.equal(buildAgentComposerPrompt({ text: '', figmaDesignToCode: true }), '', 'empty references must not invent a task');
  assert.throws(() => buildAgentComposerPrompt({ text: '', figmaDesignToCode: true, figmaLink: 'https://evil.test' }), /link/);

  const panel = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentPanel.tsx', import.meta.url), 'utf8');
  const reference = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentFigmaReference.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/(builder)/kodety/html-editor/components/HtmlAgentComposer.module.css', import.meta.url), 'utf8');
  assert.match(panel, /figmaDesignToCode && \([\s\S]*?<HtmlAgentFigmaReference/, 'structured reference UI is conditional on Figma to Code');
  assert.match(panel, /onPaste=\{handleAttachmentPaste\}/, 'image pasting must work throughout the form');
  assert.match(panel, /const prompt = buildAgentComposerPrompt\([\s\S]*?rpc\('turn\/start', \{[\s\S]*?prompt,[\s\S]*?attachments: selectedAttachments\.map\(attachment => attachment\.id\)/, 'structured text and image IDs must use the real turn endpoint');
  assert.match(panel, /const turnResponse = record\(await rpc\('turn\/start',[\s\S]*?setInput\(''\)[\s\S]*?setFigmaDesignLink\(''\)/, 'drafts must only clear after a successful turn submission');
  assert.match(reference, /aria-label="Adicionar print do elemento"[\s\S]*?onClick=\{onAddImages\}/);
  assert.match(reference, /aria-label=\{`Remover print \$\{image.name\}`\}/);
  assert.match(reference, /aria-invalid=\{invalidLink \|\| undefined\}/);
  assert.match(css, /\.referenceUpload\s*\{[^}]*min-height: 48px;/, 'the empty upload control must not force excess vertical space');
  assert.match(css, /\.referenceUpload\s*\{[^}]*padding: 8px 10px;/, 'keep the empty upload compact vertically without changing its horizontal padding');
  assert.match(css, /\.referenceThumbnail img\s*\{[\s\S]*?object-fit: contain;/, 'screenshot previews must not crop the reference');
  assert.match(css, /\.referenceThumbnail img\s*\{[^}]*object-position: left center;/, 'the visible print must align with the left padding instead of adding a centered letterbox margin');
  assert.match(css, /\.referenceImage\s*\{[^}]*padding: 6px;/, 'image cards must keep equal padding on every side');
  assert.match(css, /\.referenceImageRemove\s*\{[^}]*align-self: flex-start;/, 'the remove action must align with the top of the card content');
  assert.match(reference, /referenceLinkField[\s\S]*?<FigmaLogo \/>/, 'the Figma link field must show the Figma logo');
  const figmaLogoSource = reference.match(/function FigmaLogo\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(figmaLogoSource, /width="10" height="14"/, 'the Figma mark must remain compact');
  assert.match(figmaLogoSource, /fill="none" stroke="currentColor"/, 'the Figma mark must use an unfilled outline');
  assert.doesNotMatch(figmaLogoSource, /fill="#/, 'the Figma mark must not reintroduce brand color fills');
  assert.match(css, /\.referenceLinkField > svg\s*\{[^}]*color: #b3b3b3;/, 'the Figma outline must be light gray');
  assert.doesNotMatch(css.match(/\.referenceImageRemove\s*\{[^}]*\}/)?.[0] || '', /position:\s*absolute/, 'image removal must align with file details, not float over the screenshot');
  assert.match(reference, /referenceImageAdd[\s\S]*?aria-label="Adicionar outro print"[\s\S]*?'Adicionar'/, 'the image add action must have a clear text label');
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.figmaReference/, 'respect reduced-motion preferences');
  assert.match(css, /\.frame\[data-figma\]\s*\{\s*gap: 18px;\s*\}/, 'Figma spacing must change only the vertical gap, not padding or the controls');
  assert.match(css, /\.figmaReference\s*\{[^}]*gap: 18px;/, 'leave more vertical space between the image and link fields');

  console.log('Agent composer tests passed: editor-only defaults, legacy migration, optional skills, Figma links and structured prompts.');
} finally {
  await server.close();
}
