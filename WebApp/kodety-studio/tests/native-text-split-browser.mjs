import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const source = await readFile(new URL('../../../lib/animation-utils.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('animation-utils.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'splitAnimationText');
assert.ok(declaration);
const javascript = ts.transpileModule(declaration.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<p id="text" style="width:100px;font:20px Arial">Hello <strong>world</strong> 👨‍👩‍👧‍👦 café with several words on many lines.</p>');
  await page.addScriptTag({ content: javascript + '\nwindow.splitAnimationText=splitAnimationText;' });
  const result = await page.evaluate(() => {
    const element = document.getElementById('text');
    const originalText = element.textContent;
    const originalTextNode = element.firstChild;
    const originalStrong = element.querySelector('strong');
    let clicks = 0;
    originalStrong.addEventListener('click', () => clicks++);
    const chars = window.splitAnimationText(element, 'chars');
    const graphemes = chars.chars.map(node => node.textContent);
    originalStrong.click();
    const splitText = element.textContent;
    chars.revert(); chars.revert();
    const characterRestore = element.firstChild === originalTextNode && element.querySelector('strong') === originalStrong && element.textContent === originalText;
    const words = window.splitAnimationText(element, 'words');
    const wordCount = words.words.length;
    words.revert();
    const lines = window.splitAnimationText(element, 'lines');
    const lineCount = lines.lines.length;
    lines.revert(); originalStrong.click();
    return { originalText, splitText, graphemes, characterRestore, finalText: element.textContent, finalNode: element.firstChild === originalTextNode, clicks, wordCount, lineCount, markerCount: element.innerHTML.includes('onun-text') };
  });
  assert.equal(result.splitText, result.originalText);
  assert.ok(result.graphemes.includes('👨‍👩‍👧‍👦'), 'A grapheme must not be split inside its emoji sequence');
  assert.equal(result.characterRestore, true);
  assert.equal(result.finalNode, true);
  assert.equal(result.finalText, result.originalText);
  assert.equal(result.clicks, 2, 'Nested authored elements must retain event listeners');
  assert.ok(result.wordCount >= 10);
  assert.ok(result.lineCount > 1);
  assert.equal(result.markerCount, false);
  console.log('Native text split passed: graphemes, words, wrapped lines, DOM identity and listener preservation.');
} finally { await browser.close(); }
