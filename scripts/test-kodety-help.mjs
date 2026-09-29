import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
const skillArchivesSourceOnly = process.env.KODETY_SKILL_ARCHIVES_SOURCE_ONLY === '1';
const skipSkillArchiveParity = skillArchivesSourceOnly
  || process.argv.includes('--skip-skill-archive-parity');
const [
  bootstrap,
  php,
  css,
  js,
  shell,
  packageScript,
  packageContracts,
  skill,
  componentSystem,
  mcpOperations,
  nativePanels,
  codeContract,
  validator,
  editorSkill,
  metadata,
] = await Promise.all([
  readFile(resolve(root, 'Wordpress/kodety/kodety.php'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/includes/class-kodety-help.php'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/admin/help.css'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/admin/help.js'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/admin/components/shell.js'), 'utf8'),
  readFile(resolve(root, 'scripts/package-wordpress-plugin.mjs'), 'utf8'),
  readFile(resolve(root, 'scripts/wordpress-package-contracts.mjs'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/SKILL.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/references/component-system.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/references/mcp-operations.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/references/native-panels.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/references/kodety-code-contract.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/scripts/validate-kodety-site.mjs'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/agent-skills/kodety-editor/SKILL.md'), 'utf8'),
  readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code/agents/openai.yaml'), 'utf8'),
]);

assert.match(bootstrap, /class-kodety-help\.php/);
assert.match(bootstrap, /Kodety_Help::instance\(\)/);
assert.match(php, /add_menu_page\(/);
assert.match(php, /'Manual Kodety'/);
assert.match(php, /'read'/);
assert.match(php, /'kodety-manual'/);
assert.match(php, /dashicons-welcome-learn-more/);
assert.match(php, /\n\s+3\n\s+\)/);

const expectedSections = [
  'inicio',
  'primeiros-passos',
  'projeto-importacao',
  'builder',
  'design-responsivo',
  'paginas',
  'componentes',
  'interacoes-animacoes',
  'cms',
  'midias',
  'formularios',
  'membros-vendas',
  'marketing',
  'seo',
  'idiomas',
  'analytics',
  'publicacao',
  'usuarios-seguranca',
  'problemas',
  'referencia',
];
const expectedTaskModuleCount = expectedSections.length;

assert.match(php, /id="inicio"/, 'missing documentation introduction');
for (const section of expectedSections.slice(1)) {
  assert.match(php, new RegExp(`'id'\\s*=>\\s*'${section}'`), `missing documentation module ${section}`);
}
assert.match(php, /data-kodety-help-link="<\?php echo esc_attr\(\$id\); \?>"/);
assert.match(php, /data-kodety-help-view="manual"/);
assert.match(php, /data-kodety-help-view="skill"/);
assert.match(php, /data-kodety-skill-tab="<\?php echo esc_attr\(\$id\); \?>"/);
assert.match(php, /data-kodety-skill-panel="<\?php echo esc_attr\(\$id\); \?>"/);
assert.match(php, /docs\/kodety-site-code\.zip/);
assert.match(php, /download="kodety-site-code\.zip"/);
assert.match(php, /private function codex_skill_content/);
assert.match(php, /esc_html\(\$content\)/);
assert.doesNotMatch(php, /Parsedown|markdown_to_html/i, 'skill source must be escaped instead of interpreted as HTML');

for (const route of [
  '/kodety/editor/',
  '/kodety/cms/',
  '/kodety/members/',
  '/kodety/analytics/',
  '/kodety/localization/',
  'page=kodety-emails',
  'page=kodety-email-campaigns',
  'page=kodety-media',
]) {
  assert.ok(php.includes(route), `missing direct area route ${route}`);
}

assert.doesNotMatch(php, /<img\b|<svg\b|background-image\s*:/i, 'the guide must remain text-only');
for (const contractField of [
  "'code' =>",
  "'purpose' =>",
  "'prerequisites' =>",
  "'steps' =>",
  "'expected' =>",
  "'errors' =>",
  "'troubleshooting' =>",
  "'references' =>",
]) {
  const occurrences = php.split(contractField).length - 1;
  assert.equal(
    occurrences,
    expectedTaskModuleCount,
    `every task module must include ${contractField}`,
  );
}
for (const heading of [
  'Pré-requisitos',
  'Procedimento',
  'Resultado esperado',
  'Possíveis erros',
  'Solução de problemas',
  'Referências cruzadas',
]) {
  assert.ok(php.includes(heading), `missing operational documentation block: ${heading}`);
}
assert.match(php, /S1000D/);
assert.match(php, /ASD-STE100/);
assert.match(php, /não claim formal|does not claim formal|não reivindica conformidade formal/i);
assert.match(php, /Command \+ K[\s\S]*?Ctrl \+ K[\s\S]*?Command \+ Z[\s\S]*?Ctrl \+ Z/);
assert.match(php, /duplo clique[\s\S]*?Enter[\s\S]*?Esc[\s\S]*?refatora links internos[\s\S]*?URLs externas não são alteradas/i);
assert.match(php, /Click, Hover, Mouse move, Page load, Scroll ou Custom event/);
assert.match(php, /Animate[\s\S]*?Set[\s\S]*?Variable[\s\S]*?Class[\s\S]*?Event[\s\S]*?Spline, Lottie ou Rive/);
assert.match(js, /normalize\('NFD'\)/);
assert.match(js, /IntersectionObserver/);
assert.match(js, /data-kodety-help-search/);
assert.match(js, /a\[href\^="#"\]/);
assert.match(js, /scrollIntoView\(\{[\s\S]*?behavior: reducedMotion\.matches \? 'auto' : 'smooth'/);
assert.match(js, /window\.history\.pushState/);
assert.match(js, /activateHelpView/);
assert.match(js, /activateSkillDocument/);
assert.match(js, /data-kodety-skill-copy/);
assert.match(js, /navigator\.clipboard\?\.writeText/);
assert.match(js, /ArrowRight/);
assert.match(js, /activeView !== 'manual'/);
assert.match(css, /\.kodety-help-layout/);
assert.match(css, /\.kodety-help-primary-tabs/);
assert.match(css, /\.kodety-help-skill-workspace/);
assert.match(css, /\.kodety-help-skill-tabs/);
assert.match(css, /\.kodety-help-skill-source/);
assert.match(css, /\.kodety-help-skill-source\s*\{[^}]*max-height:\s*65dvh[^}]*overflow:\s*auto/);
assert.match(css, /\.toplevel_page_kodety-manual/);
assert.match(css, /\.kodety-help-module-meta/);
assert.match(css, /\.kodety-help-result/);
assert.match(css, /\.kodety-help-diagnostics/);
assert.match(css, /\.kodety-help-crossrefs/);
assert.match(
  css,
  /\.kodety-help-hero h1[^{}]*\{[^}]*font-size:\s*21px/,
  'the Manual hero title must keep the compact documentation scale',
);
assert.match(
  css,
  /\.kodety-help-lead\s*\{[^}]*font-size:\s*13px/,
  'the Manual hero introduction must remain visually subordinate to the title',
);
assert.match(css, /@media\s*\(max-width:\s*782px\)/);
assert.match(css, /@media print/);
assert.doesNotMatch(php, /Ir para a documentação/);
assert.doesNotMatch(css, /\.kodety-help-skip/);
assert.match(shell, /'toplevel_page_kodety-manual': 'book'/);
assert.match(shell, /toplevel_page_kodety-manual[\s\S]*?uiText\('Central de ajuda', 'Help center'\)/);

const siteSkillFiles = [
  'SKILL.md',
  'references/component-system.md',
  'references/mcp-operations.md',
  'references/kodety-code-contract.md',
  'references/native-panels.md',
  'scripts/validate-kodety-site.mjs',
  'agents/openai.yaml',
];

for (const packagedFile of [
  'docs/kodety-agent-skills.json',
  'docs/kodety-agent-skills.zip',
  'docs/kodety-site-code.zip',
  ...siteSkillFiles.map(file => `docs/kodety-site-code/${file}`),
]) {
  assert.ok(packageContracts.includes(`"${packagedFile}"`), `missing required package file ${packagedFile}`);
}
assert.match(packageScript, /prepareCodexSkillArchive/);
assert.match(packageScript, /prepareKodetyAgentSkillsArchive/);
assert.match(packageScript, /kodety\.manifest\.json/);
assert.match(packageScript, /createHash\("sha256"\)/);
assert.match(packageScript, /references\/native-panels\.md/);
assert.match(packageScript, /DETERMINISTIC_ARCHIVE_DATE/);
assert.match(packageScript, /compressionOptions:\s*\{\s*level:\s*9\s*\}/);

const agentSkillsManifest = JSON.parse(
  await readFile(resolve(root, 'Wordpress/kodety/docs/kodety-agent-skills.json'), 'utf8'),
);
const agentSkillsZip = await JSZip.loadAsync(
  await readFile(resolve(root, 'Wordpress/kodety/docs/kodety-agent-skills.zip')),
);
const archivedAgentSkillsManifest = JSON.parse(
  await agentSkillsZip.file('manifest.json').async('string'),
);
assert.deepEqual(
  archivedAgentSkillsManifest,
  agentSkillsManifest,
  'the hosted catalog and the catalog inside the agent skills ZIP must be identical',
);
assert.deepEqual(
  agentSkillsManifest.packages.map(agentSkill => agentSkill.name),
  ['kodety-site-code', 'kodety-motion', 'kodety-widgets', 'kodety-performance'],
  'the external MCP bundle must contain the four official Kodety skills',
);
if (!skipSkillArchiveParity) {
  const standaloneSkillZip = await JSZip.loadAsync(
    await readFile(resolve(root, 'Wordpress/kodety/docs/kodety-site-code.zip')),
  );
  const siteSkillManifest = agentSkillsManifest.packages.find(
    agentSkill => agentSkill.name === 'kodety-site-code',
  );
  assert.ok(siteSkillManifest, 'the external MCP catalog must describe kodety-site-code');
  assert.deepEqual(
    siteSkillManifest.files.map(file => file.path),
    siteSkillFiles,
    'the kodety-site-code manifest must list every canonical source file in order',
  );
  for (const relativePath of siteSkillFiles) {
    const canonical = await readFile(
      resolve(root, 'Wordpress/kodety/docs/kodety-site-code', relativePath),
    );
    const standalone = standaloneSkillZip.file(`kodety-site-code/${relativePath}`);
    const aggregated = agentSkillsZip.file(`kodety-site-code/${relativePath}`);
    assert.ok(standalone, `missing kodety-site-code/${relativePath} in the standalone skill ZIP`);
    assert.ok(aggregated, `missing kodety-site-code/${relativePath} in the external MCP bundle`);
    assert.deepEqual(
      await standalone.async('nodebuffer'),
      canonical,
      `stale standalone skill artifact: ${relativePath}`,
    );
    assert.deepEqual(
      await aggregated.async('nodebuffer'),
      canonical,
      `stale external MCP skill artifact: ${relativePath}`,
    );
    const manifestFile = siteSkillManifest.files.find(file => file.path === relativePath);
    assert.equal(
      manifestFile.sha256,
      createHash('sha256').update(canonical).digest('hex'),
      `stale source SHA-256 in skill manifest: ${relativePath}`,
    );
    assert.equal(
      manifestFile.size,
      canonical.byteLength,
      `stale source size in skill manifest: ${relativePath}`,
    );
  }
}
for (const agentSkill of agentSkillsManifest.packages) {
  let digestSource = '';
  for (const file of agentSkill.files) {
    const archivedFile = agentSkillsZip.file(`${agentSkill.name}/${file.path}`);
    assert.ok(archivedFile, `missing ${agentSkill.name}/${file.path} in the external MCP bundle`);
    const content = await archivedFile.async('nodebuffer');
    const sha256 = createHash('sha256').update(content).digest('hex');
    assert.equal(sha256, file.sha256, `stale SHA-256 for ${agentSkill.name}/${file.path}`);
    assert.equal(content.byteLength, file.size, `stale size for ${agentSkill.name}/${file.path}`);
    digestSource += `${file.path}\0${sha256}\0${content.byteLength}\n`;
  }
  assert.equal(
    agentSkill.digest,
    `sha256:${createHash('sha256').update(digestSource).digest('hex')}`,
    `stale package digest for ${agentSkill.name}`,
  );
  const packageManifest = JSON.parse(
    await agentSkillsZip.file(`${agentSkill.name}/kodety.manifest.json`).async('string'),
  );
  const { packages: _packages, ...catalogMetadata } = agentSkillsManifest;
  assert.deepEqual(packageManifest, {
    ...catalogMetadata,
    ...agentSkill,
  });
}

assert.match(skill, /name:\s*kodety-site-code/);
assert.match(skill, /references\/mcp-operations\.md/);
assert.match(skill, /references\/component-system\.md/);
assert.match(skill, /references\/native-panels\.md/);
for (const marker of ['kodety_panel_snapshot', 'kodety_panel_action', 'Settings', 'CMS', 'Analytics', 'Localization']) {
  assert.ok(nativePanels.includes(marker), `native panel skill contract missing ${marker}`);
}
assert.match(componentSystem, /kodety_apply_component_changes/);
assert.match(componentSystem, /data-kodety-component-state-variant/);
assert.match(componentSystem, /component-variant/);
assert.match(componentSystem, /base64url/);
assert.match(componentSystem, /component\.json/);
assert.match(componentSystem, /component\.css/);
assert.match(componentSystem, /projectFiles/);
assert.match(componentSystem, /Não crie `\.incode\/components\/<id>\/assets\/`/);
assert.match(mcpOperations, /MCP/i);
assert.match(codeContract, /responsive|responsiv/i);
assert.match(skill, /Never author `!important`/);
assert.match(codeContract, /Proibição absoluta de prioridade CSS/);
assert.match(validator, /!important é proibido/);
assert.match(editorSkill, /Never author or introduce `!important`/);
assert.match(editorSkill, /responsive overrides/);
assert.match(editorSkill, /updateComponent\.css[\s\S]*?!important/);
assert.match(validator, /validate/i);
assert.match(validator, /componentDefinitions/);
assert.match(validator, /data-kodety-component-instance/);
assert.match(metadata, /display_name:/);
assert.match(metadata, /painéis nativos do Kodety/);

const validatorFixture = await mkdtemp(join(tmpdir(), 'kodety-component-skill-'));
const validatorPath = resolve(
  root,
  'Wordpress/kodety/docs/kodety-site-code/scripts/validate-kodety-site.mjs',
);
const runValidator = () => spawnSync(
  process.execPath,
  [validatorPath, validatorFixture],
  { encoding: 'utf8' },
);
const assertPriorityRejected = (result, scenario) => {
  assert.equal(
    result.status,
    1,
    `${scenario} must be rejected\n${result.stderr}${result.stdout}`,
  );
  assert.match(result.stderr, /!important é proibido/);
};
try {
  const componentDirectory = join(validatorFixture, '.incode', 'components', 'component-card');
  const animationDirectory = join(validatorFixture, '.incode', 'animations');
  await mkdir(componentDirectory, { recursive: true });
  await mkdir(animationDirectory, { recursive: true });
  await writeFile(join(validatorFixture, '.incode', 'project.json'), JSON.stringify({
    version: 1,
    mainHtmlPath: 'index.html',
    components: {
      version: 1,
      components: [{
        id: 'component-card',
        name: 'Card',
        bundle: {
          version: 1,
          manifestFilePath: '.incode/components/component-card/component.json',
          styleFilePath: '.incode/components/component-card/component.css',
        },
        variants: [{
          id: 'variant-default',
          name: 'Default',
          filePath: '.incode/components/component-card/variant-default.html',
        }],
        variables: [{
          id: 'card-title',
          name: 'Title',
          type: 'text',
          bindings: [{ targetNodeId: 'card-title-node', attribute: '' }],
          targetNodeId: 'card-title-node',
          attribute: '',
          defaultValue: 'Hello',
        }],
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      }],
    },
  }, null, 2));
  await writeFile(
    join(componentDirectory, 'component.css'),
    '[data-kodety-component-scope="component-card"] { display: block; }\n@media (max-width: 767px) { [data-kodety-component-scope="component-card"] { width: 100%; } }\n',
  );
  await writeFile(join(componentDirectory, 'component.json'), JSON.stringify({
    version: 1,
    componentId: 'component-card',
    styleFilePath: '.incode/components/component-card/component.css',
    variants: [{
      id: 'variant-default',
      filePath: '.incode/components/component-card/variant-default.html',
    }],
    dependencies: {
      stylesheets: [],
      externalStylesheets: [],
      projectFiles: [],
      externalUrls: [],
    },
  }, null, 2));
  await writeFile(
    join(componentDirectory, 'variant-default.html'),
    '<!doctype html><html><head><title>Card</title><link rel="stylesheet" href="component.css" data-kodety-component-style></head><body data-kodety-component-editor="component-card" data-kodety-component-variant-editor="variant-default"><article data-label="Card" data-kodety-component-node="card-root" data-kodety-component-scope="component-card"><h2 data-kodety-component-node="card-title-node" data-kodety-interaction-id="card-trigger">Hello</h2></article></body></html>',
  );
  const componentInteraction = {
    version: 2,
    canonical: true,
    interactions: [{
      id: 'card-click',
      name: 'Card click',
      trigger: 'click',
      triggerSelector: '[data-kodety-interaction-id="card-trigger"]',
      triggerLabel: 'Card trigger',
      triggerTargetMode: 'element',
      actions: [{
        id: 'card-state-action',
        name: 'Keep default state',
        kind: 'component-variant',
        target: { selector: '', label: 'Trigger', scope: 'trigger', mode: 'element' },
        start: 0,
        duration: 0,
        componentId: 'component-card',
        componentVariantId: 'variant-default',
      }],
      reducedMotion: 'end',
      enabledBreakpoints: ['desktop', 'tablet', 'mobile'],
    }],
  };
  const componentInteractionPath = join(
    animationDirectory,
    '.incode%2Fcomponents%2Fcomponent-card%2Fvariant-default.html.json',
  );
  await writeFile(componentInteractionPath, JSON.stringify(componentInteraction, null, 2));
  const validPage = '<!doctype html><html><head><title>Home</title></head><body><article data-label="Card" data-kodety-component-node="card-root" data-kodety-component-scope="component-card" data-kodety-component-id="component-card" data-kodety-component-variant="variant-default" data-kodety-component-state-variant="variant-default" data-kodety-component-instance="card-home-1"><h2 data-kodety-component-node="card-title-node">Hello</h2></article></body></html>';
  await writeFile(join(validatorFixture, 'index.html'), validPage);
  const validResult = runValidator();
  assert.equal(
    validResult.status,
    0,
    `the skill validator must accept a complete native component project\n${validResult.stderr}${validResult.stdout}`,
  );
  assert.match(validResult.stdout, /1 componente\(s\)/);

  await writeFile(
    join(componentDirectory, 'component.css'),
    '[data-kodety-component-scope="component-card"] { display: block !important; }\n',
  );
  assertPriorityRejected(runValidator(), 'component CSS priority');
  await writeFile(
    join(componentDirectory, 'component.css'),
    '[data-kodety-component-scope="component-card"] { display: block; }\n@media (max-width: 410px) { [data-kodety-component-scope="component-card"] { width: 100%; } }\n',
  );

  const pageCssPath = join(validatorFixture, 'site.css');
  const pageScriptPath = join(validatorFixture, 'site.js');
  await writeFile(pageCssPath, '.card { width: 233px !important; }\n');
  assertPriorityRejected(runValidator(), 'base CSS priority');

  await writeFile(
    pageCssPath,
    '@media (max-width: 410px) { .card { width: 100% !/**/important; } }\n',
  );
  assertPriorityRejected(runValidator(), 'mobile 410 CSS priority with an intervening comment');

  await writeFile(pageCssPath, '.card { width: 100%; }\n');
  await writeFile(
    join(validatorFixture, 'index.html'),
    validPage.replace('<article ', '<article style="width: 233px !important" '),
  );
  assertPriorityRejected(runValidator(), 'inline style priority');

  await writeFile(
    join(validatorFixture, 'index.html'),
    validPage.replace(
      '</head>',
      '<style>@media (max-width: 410px) { .card { width: 100% !important; } }</style></head>',
    ),
  );
  assertPriorityRejected(runValidator(), 'style block priority');

  await writeFile(join(validatorFixture, 'index.html'), validPage);
  await writeFile(
    pageScriptPath,
    'card.style.setProperty("width", "233px", "important");\n',
  );
  assertPriorityRejected(runValidator(), 'CSSStyleDeclaration priority');

  await writeFile(
    pageScriptPath,
    'sheet.insertRule(".card { width: 233px !important; }");\n',
  );
  assertPriorityRejected(runValidator(), 'CSSStyleSheet rule priority');

  await writeFile(
    pageScriptPath,
    'styleElement.textContent = ".card { width: 233px !important; }";\n',
  );
  assertPriorityRejected(runValidator(), 'generated style element priority');

  await writeFile(
    pageCssPath,
    '/* A documentação pode mencionar !important. */\n.card::after { content: "!important"; }\n',
  );
  await writeFile(
    pageScriptPath,
    '// Não use !important em CSS autoral.\nconst priorityHelp = "!important";\nlifestyle.textContent = "!important";\n',
  );
  await writeFile(
    join(validatorFixture, 'index.html'),
    validPage.replace(
      '</body>',
      '<!-- !important em texto não é uma declaração --><p>O texto !important não é CSS.</p><span style="content: &quot;!important&quot;">Texto</span><script>const help = "!important";</script></body>',
    ),
  );
  const literalResult = runValidator();
  assert.equal(
    literalResult.status,
    0,
    `comments, strings, and HTML text must not be treated as CSS priority\n${literalResult.stderr}${literalResult.stdout}`,
  );

  await writeFile(pageCssPath, '.card { width: 100%; }\n');
  await writeFile(pageScriptPath, 'const ready = true;\n');
  await writeFile(join(validatorFixture, 'index.html'), validPage);

  await writeFile(
    join(validatorFixture, 'index.html'),
    validPage
      .replace('data-kodety-component-state-variant="variant-default"', 'data-kodety-component-state-variant="variant-missing"')
      .replace('data-kodety-component-instance="card-home-1"', 'data-kodety-component-instance="card-home-1" data-kodety-component-overrides="not+base64"'),
  );
  const invalidInteraction = structuredClone(componentInteraction);
  invalidInteraction.interactions[0].actions[0].componentVariantId = 'variant-missing';
  await writeFile(componentInteractionPath, JSON.stringify(invalidInteraction, null, 2));
  const invalidResult = runValidator();
  assert.equal(invalidResult.status, 1, 'the skill validator must reject broken component state and overrides');
  assert.match(invalidResult.stderr, /variante de estado inexistente/);
  assert.match(invalidResult.stderr, /base64url sem padding/);
  assert.match(invalidResult.stderr, /componentVariantId inexistente/);
} finally {
  await rm(validatorFixture, { recursive: true, force: true });
}

console.log(
  `Manual Kodety validado: ${expectedTaskModuleCount} módulos operacionais, workspace da Skill Codex, leitura por abas; ${skipSkillArchiveParity ? 'paridade dos ZIPs ignorada no modo focado' : 'ZIPs sincronizados com a fonte'}.`,
);
