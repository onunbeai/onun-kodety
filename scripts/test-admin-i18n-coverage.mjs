import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogDirectory = path.join(root, 'Wordpress/kodety/languages/admin-ui');
const debtSnapshotPath = path.join(root, 'scripts/fixtures/admin-i18n-debt-snapshot.json');
const readJson = async name => JSON.parse(await readFile(path.join(catalogDirectory, name), 'utf8'));
const [aliases, english, portuguese] = await Promise.all([
  readJson('aliases.json'),
  readJson('en.json'),
  readJson('pt-BR.json'),
]);

const sourceRoots = [
  'app/(builder)/kodety',
  'Wordpress/editor',
  'Wordpress/email-editor',
  'Wordpress/kodety/admin',
  'components',
  'hooks',
  // lib/apps was retired; its Builder surfaces now live under the app and
  // WordPress roots listed above. Keep every remaining production root strict.
  'lib/email-editor',
  'lib/figma',
  'lib/html-editor',
  'packages/asset-bridge',
  'packages/cms-bridge',
  'packages/component-compiler',
  'packages/component-runtime',
  'packages/component-sandbox',
  'packages/component-sdk',
  'packages/property-inspector',
  'stores',
];
const explicitProductionSourceFiles = [
  'lib/editor-platform-services.ts',
  'lib/color-variable-capability-context.tsx',
  'lib/install-next-editor-platform-services.ts',
  'lib/next-font-library-transport.ts',
];
assert.equal(sourceRoots.includes('lib'), false, 'The i18n scanner must not expand silently to the generic lib root.');
for (const file of explicitProductionSourceFiles) {
  assert.equal(
    existsSync(path.join(root, file)),
    true,
    `Required production i18n source disappeared: ${file}`,
  );
}
for (const directory of sourceRoots) {
  assert.ok(existsSync(path.join(root, directory)), `Required production i18n root disappeared: ${directory}`);
}
const discoveredSourceFiles = execFileSync('rg', [
  '--files',
  ...sourceRoots,
], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(file => /\.(?:[jt]sx?)$/.test(file) && !file.endsWith('/admin/i18n.js'));
const sourceFiles = [...new Set([...discoveredSourceFiles, ...explicitProductionSourceFiles])];
for (const file of explicitProductionSourceFiles) {
  assert.ok(sourceFiles.includes(file), `Required production i18n source is not scanned: ${file}`);
}

const phrases = new Map();
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
// Keep token boundaries explicit. The previous nested, overlapping quantifiers
// caused catastrophic backtracking on long comma-separated UI copy.
const technicalTokenList = /^[a-z]+(?:-[a-z]+)*(?:,\s*[a-z]+(?:-[a-z]+)*)*(?:,\s*)?$/i;
assert.equal(technicalTokenList.test('display-flex, align-center'), true);
assert.equal(technicalTokenList.test('Comportamento, responsividade, detalhes…'), false);
const technicalValue = value => (
  value.length < 2
  || value.length > 500
  || !/[A-Za-zÀ-ÿ]/.test(value)
  || /^(?:https?:|mailto:|tel:|\/|#|\.|--)/i.test(value)
  || /^(?:\*|:root\b|:host\b|window\.__|document\.)/.test(value)
  || /^<[^>]+>/.test(value)
  || /^%[a-z]+%(?:\s*[·|/-]\s*%[a-z]+%)*$/i.test(value)
  || /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/i.test(value)
  || /(?:tracking-|text-|font-|\[[^\]]+\]).*!/.test(value)
  || technicalTokenList.test(value)
  || /^(?:[a-z0-9_-]+\/)+[a-z0-9_./-]+$/i.test(value)
  || /^(?:flex|grid|block|inline|absolute|relative|fixed|sticky|hidden|visible|auto|none|true|false|null|undefined)$/i.test(value)
  || /\b(?:className|data-testid|application\/json|text\/html|image\/|font\/|rgba?\(|oklch\(|linear-gradient\()/.test(value)
);
const addPhrase = (raw, file, context) => {
  const source = normalize(raw);
  if (technicalValue(source)) return;
  const current = phrases.get(source) || { source, files: [], contexts: [], locations: [] };
  if (!current.files.includes(file)) current.files.push(file);
  if (!current.contexts.includes(context)) current.contexts.push(context);
  if (!current.locations.some(location => location.file === file && location.context === context)) {
    current.locations.push({ file, context });
  }
  phrases.set(source, current);
};
const expressionWrappers = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression']);
const expressionFingerprint = node => {
  if (!node || typeof node !== 'object') return String(node);
  if (expressionWrappers.has(node.type)) return expressionFingerprint(node.expression);
  if (node.type === 'Identifier') return `id:${node.name}`;
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return `${node.type}:${node.value}`;
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return `member:${expressionFingerprint(node.object)}:${node.computed ? expressionFingerprint(node.property) : (node.property?.name ?? node.property?.value)}`;
  }
  if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) {
    return `${node.type}:${node.operator}:${expressionFingerprint(node.left)}:${expressionFingerprint(node.right)}`;
  }
  if (node.type === 'UnaryExpression') return `unary:${node.operator}:${expressionFingerprint(node.argument)}`;
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    return `call:${expressionFingerprint(node.callee)}:${node.arguments.map(expressionFingerprint).join(',')}`;
  }
  return node.type;
};
const conditionFingerprint = node => {
  if (!node || typeof node !== 'object') return expressionFingerprint(node);
  if (expressionWrappers.has(node.type)) return conditionFingerprint(node.expression);
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return conditionFingerprint(node.object);
  }
  return expressionFingerprint(node);
};
const combineVariants = (left, right, separator = '') => {
  const combined = [];
  for (const first of left) {
    for (const second of right) {
      const conditions = new Map(first.conditions);
      let compatible = true;
      for (const [key, value] of second.conditions) {
        if (conditions.has(key) && conditions.get(key) !== value) {
          compatible = false;
          break;
        }
        conditions.set(key, value);
      }
      if (compatible) combined.push({ text: first.text + separator + second.text, conditions });
      if (combined.length >= 64) return combined;
    }
  }
  return combined;
};
const constrainVariants = (variants, key, choice) => variants.flatMap(variant => {
  if (variant.conditions.has(key) && variant.conditions.get(key) !== choice) return [];
  const conditions = new Map(variant.conditions);
  conditions.set(key, choice);
  return [{ ...variant, conditions }];
});
const containsStringCopy = node => {
  if (!node || typeof node !== 'object') return false;
  if (expressionWrappers.has(node.type)) return containsStringCopy(node.expression);
  if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') return true;
  if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) {
    return containsStringCopy(node.left) || containsStringCopy(node.right);
  }
  if (node.type === 'ConditionalExpression') {
    return containsStringCopy(node.consequent) || containsStringCopy(node.alternate);
  }
  return false;
};
const expandCopyExpression = (node, state) => {
  if (!node || typeof node !== 'object') return [{ text: '', conditions: new Map() }];
  if (expressionWrappers.has(node.type)) return expandCopyExpression(node.expression, state);
  if (node.type === 'StringLiteral') return [{ text: node.value, conditions: new Map() }];
  if (node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
    return [{ text: String(node.value), conditions: new Map() }];
  }
  if (node.type === 'TemplateLiteral') {
    let variants = [{ text: node.quasis[0]?.value.cooked || '', conditions: new Map() }];
    node.expressions.forEach((expression, index) => {
      variants = combineVariants(variants, expandCopyExpression(expression, state));
      variants.forEach(variant => { variant.text += node.quasis[index + 1]?.value.cooked || ''; });
    });
    return variants;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+' && containsStringCopy(node)) {
    return combineVariants(expandCopyExpression(node.left, state), expandCopyExpression(node.right, state));
  }
  if (node.type === 'ConditionalExpression') {
    const key = expressionFingerprint(node.test);
    return [
      ...constrainVariants(expandCopyExpression(node.consequent, state), key, 'truthy'),
      ...constrainVariants(expandCopyExpression(node.alternate, state), key, 'falsy'),
    ];
  }
  if (node.type === 'LogicalExpression') {
    const key = conditionFingerprint(node.left);
    if (node.operator === '&&') {
      return [
        { text: '', conditions: new Map([[key, 'falsy']]) },
        ...constrainVariants(expandCopyExpression(node.right, state), key, 'truthy'),
      ];
    }
    return [
      ...constrainVariants(expandCopyExpression(node.left, state), key, 'truthy'),
      ...constrainVariants(expandCopyExpression(node.right, state), key, 'falsy'),
    ];
  }
  return [{ text: `\u0000value${state.placeholder++}\u0000`, conditions: new Map() }];
};
const expandedCopyValues = node => {
  const state = { placeholder: 0 };
  return [...new Set(expandCopyExpression(node, state).map(variant => {
    let placeholder = 0;
    return variant.text.replace(/\u0000value\d+\u0000/g, () => `{value${placeholder++}}`);
  }))];
};
const collectExpressionCopy = (node, file, context) => {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ArrayExpression') return node.elements.forEach(child => collectExpressionCopy(child, file, context));
  expandedCopyValues(node).forEach(value => addPhrase(value, file, context));
};

const translatableAttributes = new Set([
  'title', 'placeholder', 'aria-label', 'aria-description', 'alt',
  'label', 'description', 'hint', 'emptyText', 'helpText', 'confirmText', 'message',
]);
const translatableProperties = new Set([
  'label', 'title', 'description', 'hint', 'placeholder', 'subtitle', 'message',
  'empty', 'emptyText', 'help', 'helpText', 'confirmText', 'ariaLabel',
]);
const visibleCalls = new Set([
  'toast', 'alert', 'confirm', 'prompt', 'showToast', 'notify', 'announce',
  'setError', 'setFeedback', 'setMessage', 'setStatus',
]);
const visibleFallbackCallArguments = new Map([
  ['payloadMessage', 1],
]);
const visibleToastMethods = new Set(['success', 'error', 'info', 'warning', 'message', 'loading']);
const nativeDialogMethods = new Set(['alert', 'confirm', 'prompt']);
const textOutputProperties = new Set(['textContent', 'innerText']);

for (const file of sourceFiles) {
  const source = await readFile(path.join(root, file), 'utf8');
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy'] });
  } catch {
    continue;
  }
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    // Code samples and editable content are literal, matching admin/i18n.js.
    // Keep accessibility attributes eligible while excluding their contents.
    if (node.type === 'JSXElement' && ['code', 'pre', 'script', 'style', 'textarea'].includes(node.openingElement?.name?.name)) {
      visit(node.openingElement);
      return;
    }
    if (node.type === 'JSXText') addPhrase(node.value, file, 'jsx-text');
    if (node.type === 'JSXAttribute') {
      const name = node.name?.name;
      if (typeof name === 'string' && translatableAttributes.has(name)) {
        if (node.value?.type === 'StringLiteral') addPhrase(node.value.value, file, `attribute:${name}`);
        if (node.value?.type === 'JSXExpressionContainer') collectExpressionCopy(node.value.expression, file, `attribute:${name}`);
      }
      // Expression children are handled here only for attributes explicitly
      // known to contain copy; class names and technical values stay excluded.
      return;
    }
    if (node.type === 'JSXExpressionContainer') collectExpressionCopy(node.expression, file, 'jsx-expression');
    if (node.type === 'ObjectProperty' && !node.computed) {
      const key = node.key?.name ?? node.key?.value;
      if (translatableProperties.has(key)) {
        collectExpressionCopy(node.value, file, `property:${key}`);
      }
    }
    if (node.type === 'CallExpression') {
      if (node.callee?.type === 'Identifier' && visibleFallbackCallArguments.has(node.callee.name)) {
        const fallbackIndex = visibleFallbackCallArguments.get(node.callee.name);
        collectExpressionCopy(
          node.arguments?.[fallbackIndex],
          file,
          `call:${node.callee.name}:fallback`,
        );
      }
      if (node.callee?.type === 'Identifier' && visibleCalls.has(node.callee.name)) {
        collectExpressionCopy(node.arguments?.[0], file, `call:${node.callee.name}`);
      }
      if (
        node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier'
        && node.callee.object.name === 'toast'
      ) {
        const method = node.callee.property?.name ?? node.callee.property?.value;
        if (visibleToastMethods.has(method)) {
          collectExpressionCopy(node.arguments?.[0], file, `call:toast.${method}`);
        }
      }
      if (
        node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier'
        && node.callee.object.name === 'window'
      ) {
        const method = node.callee.property?.name ?? node.callee.property?.value;
        if (nativeDialogMethods.has(method)) {
          collectExpressionCopy(node.arguments?.[0], file, `call:window.${method}`);
        }
      }
      if (
        node.callee?.type === 'MemberExpression'
        && (node.callee.property?.name ?? node.callee.property?.value) === 'setAttribute'
        && node.arguments?.[0]?.type === 'StringLiteral'
        && translatableAttributes.has(node.arguments[0].value)
      ) {
        collectExpressionCopy(node.arguments?.[1], file, `setAttribute:${node.arguments[0].value}`);
      }
    }
    if (
      node.type === 'AssignmentExpression'
      && node.left?.type === 'MemberExpression'
      && textOutputProperties.has(node.left.property?.name ?? node.left.property?.value)
    ) {
      collectExpressionCopy(node.right, file, `assignment:${node.left.property?.name ?? node.left.property?.value}`);
    }
    if (
      node.type === 'NewExpression'
      && node.callee?.type === 'Identifier'
      && ['Error', 'TypeError', 'RangeError'].includes(node.callee.name)
    ) {
      collectExpressionCopy(node.arguments?.[0], file, `new:${node.callee.name}`);
    }
    if (node.type === 'ThrowStatement') {
      collectExpressionCopy(node.argument, file, 'throw');
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
}

const requiredProductionCopyCoverage = [
  {
    source: 'Failed to upload fonts',
    file: 'lib/next-font-library-transport.ts',
    context: 'call:payloadMessage:fallback',
  },
];
for (const required of requiredProductionCopyCoverage) {
  assert.ok(
    phrases.get(required.source)?.locations.some(location => (
      location.file === required.file && location.context === required.context
    )),
    `Required production copy is not covered by the i18n scanner: ${required.source} (${required.file})`,
  );
}

const aliasSources = new Set(Object.values(aliases).flat().map(normalize));
const hasExactTranslation = (catalog, source) => (
  aliasSources.has(source) || typeof catalog.direct?.[source] === 'string'
);
const portugueseSignal = /[ãõáéíóúâêôàç]|\b(?:acesso|acesse|abra|adicionar|adicionad[oa]s?|agora|aguarde|ajustar|alterar|alterad[oa]s?|animação|animações|apagar|aplicad[oa]s?|arquivo|arquivos|ativar|ativad[oa]s?|atualize|atributos|borda|buscar|campo|campos|carregando|clique|colad[oa]s?|coleção|componente|componentes|conecte|configurar|configuração|convidar|convite|convites|copiad[oa]s?|copie|cor|cores|criar|criad[oa]s?|defina|desativar|desativad[oa]s?|descrição|direita|disponível|duplicad[oa]s?|enviad[oa]s?|envolvid[oa]s?|escolha|escolher|esquerda|excluir|exportad[oa]s?|falha|falhas|fechar|fontes?|idioma|idiomas|imagem|imagens|importad[oa]s?|indisponível|inferior|informe|injete|insira|inserid[oa]s?|itens|localizad[oa]s?|mantenha|margem|membro|membros|mova|nenhum|nenhuma|neste|nesta|página|páginas|pasta|pastas|plano|planos|projeto|projetos|publicar|publicação|quando|remover|removid[oa]s?|renomead[oa]s?|repetição|salvar|salv[oa]s?|segurança|selecione|selecionar|selecionad[oa]s?|sincronização|sincronizad[oa]s?|superior|tente|texto|transformar|usar|valor|visualizar|voltar)\b/iu;
const englishSignal = /\b(?:add|adjust|animation|attributes|back|border|choose|click|close|collection|configure|create|custom|delete|description|edit|effects|external|field|hover|interactions|invite|language|layer|library|link|loading|member|mouse|open|page|project|publish|remove|save|scroll|security|select|settings|style|text|trigger|value|view|when)\b/iu;
const mixedPortugueseResidue = /\b(?:Preview|viewport|release|snapshots?|collections?|layers?|timeline|overlays?|triggers?|Interactions?|presets?|easing|hover|scroll|labels?|inputs?|buttons?|containers?|templates?|assets?|workspace|settings|build|runtime|fallback|checkout|landing|endpoint|bridge|Dashboard|topbar|breakpoints?|attachments?|background|realtime|rollback|upgrade|download|upload|drawer|popover|embed|schema|locale|Primary|Control|sticky|offset|playhead|headings?|footer|header|scrub|frames|wildcard|redirects?|gates?|entitlement|membership|newsletter|insights|Analytics|Custom event|Page load|Mouse move|Code Component|Storefront|server-side|lazy loading|stylesheet|font-family|Weight|Reply-To|rich text|toggle)\b/iu;
const allPhrases = [...phrases.values()];
const missingEnglish = allPhrases.filter(item => portugueseSignal.test(item.source) && !hasExactTranslation(english, item.source));
const missingPortuguese = allPhrases.filter(item => (
  englishSignal.test(item.source)
  && !portugueseSignal.test(item.source)
  && !hasExactTranslation(portuguese, item.source)
));
const unreviewedMixedPortuguese = allPhrases.filter(item => (
  mixedPortugueseResidue.test(item.source)
  && !hasExactTranslation(portuguese, item.source)
));
const compareCanonicalText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const canonicalDebtEntries = list => list
  .map(item => {
    const locations = new Map();
    for (const location of item.locations || []) {
      const key = `${location.file}\u0000${location.context}`;
      locations.set(key, { file: location.file, context: location.context });
    }
    return {
      source: item.source,
      locations: [...locations.values()].sort((left, right) => (
        compareCanonicalText(left.file, right.file)
        || compareCanonicalText(left.context, right.context)
      )),
    };
  })
  .sort((left, right) => compareCanonicalText(left.source, right.source));
const debtFingerprint = (category, list) => ({
  count: list.length,
  sha256: createHash('sha256')
    .update(JSON.stringify({ category, entries: canonicalDebtEntries(list) }), 'utf8')
    .digest('hex'),
});
const debtCategories = [
  ['missingEnglish', 'PT→EN', missingEnglish],
  ['missingPortuguese', 'EN→PT', missingPortuguese],
  ['unreviewedMixedPortuguese', 'mistos sem revisão', unreviewedMixedPortuguese],
];
const snapshotVersion = 1;
const snapshotCanonicalization = 'sha256(JSON UTF-8 de categoria + source + pares únicos {file,context}, todos em ordem binária)';
const currentDebtSnapshot = {
  version: snapshotVersion,
  algorithm: 'sha256',
  canonicalization: snapshotCanonicalization,
  categories: Object.fromEntries(
    debtCategories.map(([category, , list]) => [category, debtFingerprint(category, list)]),
  ),
};
const assertDebtCategoryMatches = (frozen, current, label, details = '') => {
  assert.ok(
    frozen.count === current.count && frozen.sha256 === current.sha256,
    [
      `Known i18n debt drifted in ${label}.`,
      `Frozen: count=${frozen.count}, sha256=${frozen.sha256}`,
      `Current: count=${current.count}, sha256=${current.sha256}`,
      'Review the complete --report output and the catalogs before explicitly updating the snapshot.',
      details,
    ].filter(Boolean).join('\n'),
  );
};

const mutationProbe = [
  { source: 'Primeira frase ausente', locations: [{ file: 'probe/a.tsx', context: 'jsx-text' }] },
  { source: 'Segunda frase ausente', locations: [{ file: 'probe/b.tsx', context: 'attribute:title' }] },
];
const mutationBaseline = debtFingerprint('mutation-probe', mutationProbe);
const mutationWithInsertion = debtFingerprint('mutation-probe', [
  ...mutationProbe,
  { source: 'Nova frase ausente', locations: [{ file: 'probe/c.tsx', context: 'call:toast.error' }] },
]);
const mutationWithReplacement = debtFingerprint('mutation-probe', [
  { ...mutationProbe[0], source: 'Frase ausente substituída' },
  mutationProbe[1],
]);
const mutationWithMovedContext = debtFingerprint('mutation-probe', [
  { ...mutationProbe[0], locations: [{ file: 'probe/other.tsx', context: 'property:label' }] },
  mutationProbe[1],
]);
assert.doesNotThrow(
  () => assertDebtCategoryMatches(mutationBaseline, mutationBaseline, 'mutation probe'),
  'the frozen debt gate must accept an identical canonical snapshot',
);
assert.throws(
  () => assertDebtCategoryMatches(mutationBaseline, mutationWithInsertion, 'mutation probe'),
  /Known i18n debt drifted/,
  'inserting a new missing phrase must invalidate the frozen debt gate',
);
assert.equal(mutationWithReplacement.count, mutationBaseline.count, 'the replacement mutation must preserve count to exercise the hash gate');
assert.throws(
  () => assertDebtCategoryMatches(mutationBaseline, mutationWithReplacement, 'mutation probe'),
  /Known i18n debt drifted/,
  'replacing a missing phrase at the same count must invalidate the frozen debt gate',
);
assert.equal(mutationWithMovedContext.count, mutationBaseline.count, 'the context mutation must preserve count to exercise the hash gate');
assert.throws(
  () => assertDebtCategoryMatches(mutationBaseline, mutationWithMovedContext, 'mutation probe'),
  /Known i18n debt drifted/,
  'moving a missing phrase between file/context pairs must invalidate the frozen debt gate',
);

const formatMissing = list => list
  .slice(0, 80)
  .map(item => `- ${JSON.stringify(item.source)} (${item.files[0]})`)
  .join('\n');

const reportMode = process.argv.includes('--report');
const strictMode = process.argv.includes('--strict');
const printSnapshotMode = process.argv.includes('--print-debt-snapshot');
assert.ok(
  Number(reportMode) + Number(strictMode) + Number(printSnapshotMode) <= 1,
  'Use only one i18n coverage mode at a time: --report, --strict or --print-debt-snapshot.',
);

if (reportMode) {
  console.log(JSON.stringify({
    total: allPhrases.length,
    files: sourceFiles.length,
    debtSnapshot: currentDebtSnapshot,
    missingEnglish,
    missingPortuguese,
    unreviewedMixedPortuguese,
  }, null, 2));
} else if (printSnapshotMode) {
  console.log(JSON.stringify(currentDebtSnapshot, null, 2));
} else if (strictMode) {
  assert.equal(
    missingEnglish.length,
    0,
    `Strict i18n: Portuguese UI phrases missing from en.json (${missingEnglish.length}):\n${formatMissing(missingEnglish)}`,
  );
  assert.equal(
    missingPortuguese.length,
    0,
    `Strict i18n: English UI phrases missing from pt-BR.json (${missingPortuguese.length}):\n${formatMissing(missingPortuguese)}`,
  );
  assert.equal(
    unreviewedMixedPortuguese.length,
    0,
    `Strict i18n: mixed-language UI phrases missing an exact pt-BR review (${unreviewedMixedPortuguese.length}):\n${formatMissing(unreviewedMixedPortuguese)}`,
  );
  console.log(`Cobertura i18n estrita: nenhuma dívida em ${allPhrases.length} frases de ${sourceFiles.length} arquivos.`);
} else {
  const frozenDebtSnapshot = JSON.parse(await readFile(debtSnapshotPath, 'utf8'));
  assert.equal(frozenDebtSnapshot.version, snapshotVersion, 'The frozen i18n debt snapshot version is unsupported.');
  assert.equal(frozenDebtSnapshot.algorithm, 'sha256', 'The frozen i18n debt snapshot must use sha256.');
  assert.equal(
    frozenDebtSnapshot.canonicalization,
    snapshotCanonicalization,
    'The frozen i18n debt snapshot canonicalization contract changed.',
  );
  assert.deepEqual(
    Object.keys(frozenDebtSnapshot.categories || {}).sort(compareCanonicalText),
    debtCategories.map(([category]) => category).sort(compareCanonicalText),
    'The frozen i18n debt snapshot must contain exactly the scanner debt categories.',
  );
  for (const [category, label, list] of debtCategories) {
    const frozen = frozenDebtSnapshot.categories[category];
    const current = currentDebtSnapshot.categories[category];
    assertDebtCategoryMatches(frozen, current, label, formatMissing(list));
  }
  const debtSummary = debtCategories
    .map(([category, label]) => `${label}: ${currentDebtSnapshot.categories[category].count}`)
    .join('; ');
  console.log(`Dívida i18n conhecida (não aprovada): ${debtSummary}. Snapshot congelado íntegro; --strict continua exigindo zero.`);
}
