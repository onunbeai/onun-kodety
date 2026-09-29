import { parse } from 'parse5';
import { sha256 } from 'js-sha256';
import type { HtmlProject, HtmlProjectFile } from './types';
import {
  MEMBERSHIP_BRANCH_ATTRIBUTE,
  MEMBERSHIP_GATE_ATTRIBUTE,
  MEMBERSHIP_PROTECTED_DOWNLOAD_ATTRIBUTE,
  isLocalMembershipProtectedDownloadHref,
  isMembershipProtectedDownloadFileTypeSupported,
  membershipRuleIsProtected,
  membershipSettingsFromMetadata,
  normalizeMembershipPagePath,
  normalizeMembershipSettings,
  validateMembershipSettings,
  type MembershipAccessRule,
  type MembershipAudiencePageOverrides,
  type MembershipGateDefinition,
  type MembershipSettings,
} from './membership';

export const MEMBERSHIP_RUNTIME_PATH = '.incode/membership/runtime.json';
export const MEMBERSHIP_RUNTIME_VERSION = 1 as const;
export const MEMBERSHIP_PROTECTED_ASSET_ATTRIBUTE = 'data-kodety-protected-asset';
export const MEMBERSHIP_ASSET_ROOT = '.incode/membership/assets';
const MAX_MEMBERSHIP_RUNTIME_BYTES = 64 * 1024 * 1024;
const MAX_PROTECTED_ASSETS = 500;
// The editable project currently crosses WordPress REST as a base64 ZIP.
// Keep protected binaries within a budget that can be reopened on normal
// managed WordPress memory limits instead of advertising sizes that crash.
const MAX_PROTECTED_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_PROTECTED_ASSETS_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PROTECTED_ASSET_CONTEXTS = 100;
const MAX_PROTECTED_ASSET_RULES_PER_CONTEXT = 64;

interface SourceLocation {
  startOffset: number;
  endOffset: number;
  startTag?: SourceLocation;
  endTag?: SourceLocation;
  attrs?: Record<string, SourceLocation>;
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  sourceCodeLocation?: SourceLocation;
}

export interface MembershipRuntimeGate {
  id: string;
  gateId: string;
  rule: MembershipGateDefinition;
  protectedHtml: string;
  guestHtml: string;
  upgradeHtml: string;
}

export interface MembershipRuntimePage {
  /** Source path inside the editable/transport project. */
  path: string;
  /** Relative path used by the generated WordPress runtime. */
  runtimePath: string;
  /** Public authored page whose page-level rule this variant inherits. */
  authoredPath: string;
  /** Original authoring source used only when the private project is reopened. */
  editorHtml: string;
  /** Full authorized document for page-level access. */
  protectedHtml?: string;
  pageRule?: MembershipAccessRule;
  gates: Record<string, MembershipRuntimeGate>;
  /** Server-selected visual layers for guest/member/plan audiences. */
  audienceOverrides?: MembershipAudiencePageOverrides;
}

export interface MembershipRuntimeAssetContext {
  /** Every rule in one context is required; contexts themselves are OR. */
  allOf: MembershipAccessRule[];
}

export interface MembershipRuntimeAsset {
  id: string;
  sourcePath: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  contexts: MembershipRuntimeAssetContext[];
  encryption?: {
    algorithm: 'aes-256-gcm-chunked-v1';
    chunkSize: number;
  };
}

export interface MembershipRuntimeArtifact {
  version: typeof MEMBERSHIP_RUNTIME_VERSION;
  enabled: true;
  projectId: string;
  pages: Record<string, MembershipRuntimePage>;
  assets: Record<string, MembershipRuntimeAsset>;
}

function nodeAttribute(node: ParsedNode, name: string) {
  return node.attrs?.find(attribute => attribute.name === name)?.value || '';
}

function nodeHasAttribute(node: ParsedNode, name: string) {
  return Boolean(node.attrs?.some(attribute => attribute.name === name));
}

function elementChildren(node: ParsedNode) {
  return (node.childNodes || []).filter(child => Boolean(child.tagName));
}

function replaceRanges(
  source: string,
  baseOffset: number,
  replacements: Array<{ start: number; end: number; value: string }>,
) {
  let result = source;
  replacements
    .slice()
    .sort((left, right) => right.start - left.start)
    .forEach(replacement => {
      const start = replacement.start - baseOffset;
      const end = replacement.end - baseOffset;
      if (start < 0 || end < start || end > result.length) {
        throw new Error('Uma área de membros mudou de posição durante a publicação.');
      }
      result = result.slice(0, start) + replacement.value + result.slice(end);
    });
  return result;
}

function directBranch(node: ParsedNode, branch: 'content' | 'guest' | 'upgrade') {
  const matches = elementChildren(node).filter(
    child => nodeAttribute(child, MEMBERSHIP_BRANCH_ATTRIBUTE) === branch,
  );
  if (matches.length > 1) {
    throw new Error(`A área “${nodeAttribute(node, MEMBERSHIP_GATE_ATTRIBUTE)}” possui mais de um branch ${branch}.`);
  }
  return matches[0] || null;
}

function descendantsWithGate(node: ParsedNode, includeSelf = false): ParsedNode[] {
  const matches: ParsedNode[] = [];
  const visit = (candidate: ParsedNode, own: boolean) => {
    if ((includeSelf || !own) && nodeAttribute(candidate, MEMBERSHIP_GATE_ATTRIBUTE)) {
      matches.push(candidate);
      return;
    }
    (candidate.childNodes || []).forEach(child => visit(child, false));
  };
  visit(node, true);
  return matches;
}

function treeHasAttribute(node: ParsedNode, names: readonly string[]): boolean {
  if (names.some(name => Boolean(nodeAttribute(node, name)))) return true;
  return (node.childNodes || []).some(child => treeHasAttribute(child, names));
}

function topLevelGates(document: ParsedNode) {
  const matches: ParsedNode[] = [];
  const visit = (node: ParsedNode, insideGate: boolean) => {
    const gate = Boolean(nodeAttribute(node, MEMBERSHIP_GATE_ATTRIBUTE));
    if (gate && !insideGate) matches.push(node);
    (node.childNodes || []).forEach(child => visit(child, insideGate || gate));
  };
  visit(document, false);
  return matches;
}

function protectedDownloadNodes(node: ParsedNode, stopAtNestedGates: boolean) {
  const matches: ParsedNode[] = [];
  const visit = (candidate: ParsedNode, own: boolean) => {
    if (
      stopAtNestedGates
      && !own
      && nodeHasAttribute(candidate, MEMBERSHIP_GATE_ATTRIBUTE)
    ) return;
    if (nodeHasAttribute(candidate, MEMBERSHIP_PROTECTED_DOWNLOAD_ATTRIBUTE)) {
      matches.push(candidate);
    }
    (candidate.childNodes || []).forEach(child => visit(child, false));
  };
  visit(node, true);
  return matches;
}

function resolveProtectedAssetPath(
  pagePath: string,
  reference: string,
  projectRootPath: string,
) {
  const raw = reference.trim();
  if (!isLocalMembershipProtectedDownloadHref(raw)) return '';
  let decoded = '';
  try {
    decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  } catch {
    return '';
  }
  if (/[\u0000-\u001f\u007f\\<>]/.test(decoded)) return '';
  const normalizedPagePath = normalizeMembershipPagePath(pagePath);
  const normalizedRootPath = normalizeMembershipPagePath(projectRootPath);
  const variant = normalizedPagePath.match(
    /^(\.incode\/experiments\/[^/]+\/[^/]+\/project\/)(.+)$/,
  );
  const absoluteRoot = variant
    ? normalizeMembershipPagePath(`${variant[1]}${normalizedRootPath}`)
    : normalizedRootPath;
  const base = raw.startsWith('/')
    ? absoluteRoot.split('/').filter(Boolean)
    : normalizedPagePath.split('/').slice(0, -1);
  const stack = [...base];
  for (const part of decoded.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) return '';
      stack.pop();
      continue;
    }
    if (part.includes('\0')) return '';
    stack.push(part);
  }
  return stack.join('/');
}

function projectFileBytes(file: HtmlProjectFile) {
  return file.data ?? new TextEncoder().encode(file.text || '');
}

function membershipPagePaths(path: string) {
  const sourcePath = normalizeMembershipPagePath(path);
  const variant = sourcePath.match(
    /^\.incode\/experiments\/([^/]+)\/([^/]+)\/project\/(.+)$/,
  );
  if (!variant) {
    return { sourcePath, authoredPath: sourcePath, runtimePath: sourcePath };
  }
  return {
    sourcePath,
    authoredPath: normalizeMembershipPagePath(variant[3]),
    runtimePath: normalizeMembershipPagePath(
      `.kodety-experiments/${variant[1]}/${variant[2]}/${variant[3]}`,
    ),
  };
}

function defaultBranch(branch: 'guest' | 'upgrade') {
  const message = branch === 'guest'
    ? 'Entre para acessar este conteúdo.'
    : 'Faça upgrade para acessar este conteúdo.';
  return `<div ${MEMBERSHIP_BRANCH_ATTRIBUTE}="${branch}"><p>${message}</p></div>`;
}

function protectedPageShell(source: string, pagePath: string) {
  const htmlAttributes = source.match(/<html\b([^>]*)>/i)?.[1] || '';
  const lang = htmlAttributes.match(/\blang\s*=\s*(["'])(.*?)\1/i)?.[2] || 'pt-BR';
  return `<!doctype html>
<html lang="${lang.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Conteúdo protegido</title>
</head>
<body>
  <main data-kodety-page-access-placeholder="${pagePath.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" hidden></main>
</body>
</html>`;
}

type RegisterProtectedAsset = (
  node: ParsedNode,
  pagePath: string,
  rules: MembershipAccessRule[],
) => { start: number; end: number; value: string };

function compileHtmlPage(
  source: string,
  path: string,
  settings: MembershipSettings,
  editorHtml = source,
  registerProtectedAsset?: RegisterProtectedAsset,
): { html: string; runtime: MembershipRuntimePage | null } {
  const document = parse(source, { sourceCodeLocationInfo: true }) as ParsedNode;
  if (treeHasAttribute(document, [
    'data-kodety-access-placeholder',
    'data-kodety-page-access-placeholder',
    MEMBERSHIP_PROTECTED_ASSET_ATTRIBUTE,
  ])) {
    throw new Error(
      `A página “${path}” contém um marcador interno reservado da Área de Membros.`,
    );
  }
  const gates: Record<string, MembershipRuntimeGate> = {};
  let occurrence = 0;
  const { sourcePath, authoredPath, runtimePath } = membershipPagePaths(path);
  const pageRule = settings.pages[authoredPath];
  const protectedPage = Boolean(pageRule && membershipRuleIsProtected(pageRule));
  const pageRules = protectedPage && pageRule ? [pageRule] : [];
  const audienceOverrides = settings.audienceOverrides?.[authoredPath] || {};
  const hasAudienceOverrides = Object.keys(audienceOverrides).length > 0;

  const compileGate = (
    node: ParsedNode,
    ancestorRules: MembershipAccessRule[] = [],
  ): string => {
    const location = node.sourceCodeLocation;
    const gateId = nodeAttribute(node, MEMBERSHIP_GATE_ATTRIBUTE);
    if (!location || !gateId) throw new Error('Uma área de membros não possui uma localização válida no HTML.');
    const rule = settings.gates[gateId];
    if (!rule) throw new Error(`A página “${path}” referencia a regra de acesso inexistente “${gateId}”.`);
    if (!membershipRuleIsProtected(rule)) {
      throw new Error(`A regra “${gateId}” está marcada como pública. Remova o gate ou escolha um requisito protegido.`);
    }

    const content = directBranch(node, 'content');
    const guest = directBranch(node, 'guest');
    const upgrade = directBranch(node, 'upgrade');
    if (!content?.sourceCodeLocation) {
      throw new Error(`A área “${rule.label}” precisa de um branch content editável.`);
    }
    if (treeHasAttribute(content, ['data-coday-code-instance'])) {
      throw new Error(
        `A área “${rule.label}” contém um Code Component. `
        + 'Converta a instância em HTML comum antes de proteger este bloco.',
      );
    }
    const nestedInsideContent = new Set(descendantsWithGate(content));
    if (descendantsWithGate(node).some(child => !nestedInsideContent.has(child))) {
      throw new Error(
        `A área “${rule.label}” contém um gate fora do branch content. `
        + 'Mova o gate aninhado para dentro do conteúdo protegido.',
      );
    }
    for (const fallbackNode of [guest, upgrade]) {
      if (fallbackNode && descendantsWithGate(fallbackNode).length) {
        throw new Error(`A área “${rule.label}” não pode conter outro gate dentro de um fallback.`);
      }
      if (fallbackNode && protectedDownloadNodes(fallbackNode, false).length) {
        throw new Error(
          `A área “${rule.label}” contém download protegido em um fallback público.`,
        );
      }
    }

    const nested = topLevelGates(content);
    const nestedReplacements = nested.map(child => {
      const childLocation = child.sourceCodeLocation;
      if (!childLocation) throw new Error('Uma área aninhada não possui localização válida.');
      return {
        start: childLocation.startOffset,
        end: childLocation.endOffset,
        value: compileGate(child, [...ancestorRules, rule]),
      };
    });
    const assetReplacements = registerProtectedAsset
      ? protectedDownloadNodes(content, true).map(asset => registerProtectedAsset(
        asset,
        sourcePath,
        [...pageRules, ...ancestorRules, rule],
      ))
      : [];

    const original = source.slice(location.startOffset, location.endOffset);
    const removeFallbacks = [guest, upgrade]
      .filter((branch): branch is ParsedNode => Boolean(branch?.sourceCodeLocation))
      .map(branch => ({
        start: branch.sourceCodeLocation!.startOffset,
        end: branch.sourceCodeLocation!.endOffset,
        value: '',
      }));
    const protectedHtml = replaceRanges(
      original,
      location.startOffset,
      [...nestedReplacements, ...removeFallbacks, ...assetReplacements],
    );
    const guestBranchHtml = guest?.sourceCodeLocation
      ? source.slice(guest.sourceCodeLocation.startOffset, guest.sourceCodeLocation.endOffset)
      : defaultBranch('guest');
    const upgradeBranchHtml = upgrade?.sourceCodeLocation
      ? source.slice(upgrade.sourceCodeLocation.startOffset, upgrade.sourceCodeLocation.endOffset)
      : defaultBranch('upgrade');
    const wrapFallback = (branchHtml: string) => {
      const startTag = location.startTag;
      const endTag = location.endTag;
      if (!startTag || !endTag) {
        return `<div ${MEMBERSHIP_GATE_ATTRIBUTE}="${gateId.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${branchHtml}</div>`;
      }
      return source.slice(startTag.startOffset, startTag.endOffset)
        + branchHtml
        + source.slice(endTag.startOffset, endTag.endOffset);
    };
    const id = `${gateId}:${++occurrence}`;
    gates[id] = {
      id,
      gateId,
      rule,
      protectedHtml,
      guestHtml: wrapFallback(guestBranchHtml),
      upgradeHtml: wrapFallback(upgradeBranchHtml),
    };
    return `<div data-kodety-access-placeholder="${id.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" hidden></div>`;
  };

  const replacements = topLevelGates(document).map(node => {
    const location = node.sourceCodeLocation;
    if (!location) throw new Error('Uma área de membros não possui localização válida.');
    return {
      start: location.startOffset,
      end: location.endOffset,
      value: compileGate(node),
    };
  });
  const pageAssetNodes = protectedDownloadNodes(document, true);
  if (pageAssetNodes.length && !protectedPage) {
    throw new Error(
      `A página “${sourcePath}” contém download protegido fora de um gate.`,
    );
  }
  const pageAssetReplacements = registerProtectedAsset && protectedPage
    ? pageAssetNodes.map(asset => registerProtectedAsset(asset, sourcePath, pageRules))
    : [];
  const compiled = replaceRanges(source, 0, [...replacements, ...pageAssetReplacements]);
  if (!replacements.length && !protectedPage && !hasAudienceOverrides) {
    return { html: source, runtime: null };
  }

  return {
    html: protectedPage ? protectedPageShell(source, runtimePath) : compiled,
    runtime: {
      path: sourcePath,
      runtimePath,
      authoredPath,
      editorHtml,
      ...(protectedPage ? { protectedHtml: compiled, pageRule } : {}),
      gates,
      ...(hasAudienceOverrides ? { audienceOverrides } : {}),
    },
  };
}

function runtimeArtifact(project: HtmlProject): MembershipRuntimeArtifact | null {
  const text = project.files[MEMBERSHIP_RUNTIME_PATH]?.text;
  if (!text) return null;
  try {
    const value = JSON.parse(text) as MembershipRuntimeArtifact;
    return value?.version === MEMBERSHIP_RUNTIME_VERSION && value.enabled === true
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Restores the private authoring representation after a published workspace is
 * downloaded. Public HTML remains scrubbed in the generated theme.
 */
export function hydrateMembershipProject(project: HtmlProject): HtmlProject {
  const runtime = runtimeArtifact(project);
  if (!runtime) return project;
  const files = { ...project.files };
  Object.values(runtime.pages).forEach(page => {
    if (!files[page.path] || typeof page.editorHtml !== 'string') return;
    files[page.path] = { ...files[page.path], text: page.editorHtml };
  });
  Object.values(runtime.assets || {}).forEach(asset => {
    const stored = files[asset.storagePath];
    if (!stored || files[asset.sourcePath]) return;
    files[asset.sourcePath] = {
      ...stored,
      path: asset.sourcePath,
      mimeType: asset.mimeType || stored.mimeType,
    };
    delete files[asset.storagePath];
  });
  delete files[MEMBERSHIP_RUNTIME_PATH];
  return { ...project, files };
}

/**
 * Compiles protected branches out of public HTML before the ZIP reaches
 * WordPress. Projects without an explicitly enabled membership contract take
 * the original fast path byte-for-byte.
 */
export function prepareMembershipProjectForTransport(
  project: HtmlProject,
  metadata: unknown,
  authoringProject: HtmlProject = project,
): HtmlProject {
  const metadataRecord = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  // Projects created before Membership may legitimately contain similarly
  // named data attributes. Until the user explicitly creates the versioned
  // membership contract, publishing must remain byte-for-byte compatible.
  if (!Object.prototype.hasOwnProperty.call(metadataRecord, 'membership')) {
    if (project.files[MEMBERSHIP_RUNTIME_PATH]) {
      const files = { ...project.files };
      delete files[MEMBERSHIP_RUNTIME_PATH];
      return { ...project, files };
    }
    return project;
  }
  // A prepared project can legitimately pass through the transport pipeline a
  // second time (publish package + ZIP serialization). Never trust or retain
  // its prior runtime blindly: restore the authored HTML and compile a fresh,
  // validated artifact from the current metadata.
  const sourceProject = project.files[MEMBERSHIP_RUNTIME_PATH]?.text
    ? hydrateMembershipProject(project)
    : project;
  const authorSourceProject = authoringProject.files[MEMBERSHIP_RUNTIME_PATH]?.text
    ? hydrateMembershipProject(authoringProject)
    : authoringProject;
  const rawSettings = metadataRecord.membership;
  const settings = membershipSettingsFromMetadata(metadata);
  const projectHasGateMarkup = Object.values(sourceProject.files).some(
    file => file.text !== undefined
      && /\.html?$/i.test(file.path)
      && file.text.includes(MEMBERSHIP_GATE_ATTRIBUTE),
  );
  const hasPageRules = Object.values(settings.pages).some(membershipRuleIsProtected);
  const hasAudienceOverrides = Object.keys(settings.audienceOverrides || {}).length > 0;
  if (!settings.enabled) {
    if (
      projectHasGateMarkup
      || hasPageRules
      || Object.keys(settings.gates).length
      || hasAudienceOverrides
    ) {
      throw new Error('O projeto contém regras de membros, mas a Área de Membros está desativada.');
    }
    return sourceProject;
  }

  const issues = validateMembershipSettings(rawSettings).filter(issue => issue.severity === 'error');
  if (issues.length) throw new Error(issues[0].message);
  for (const [pagePath, rule] of Object.entries(settings.pages)) {
    if (!membershipRuleIsProtected(rule)) continue;
    const page = sourceProject.files[pagePath];
    if (!page || page.text === undefined || !/\.html?$/i.test(page.path)) {
      throw new Error(
        `A regra protegida da página “${pagePath}” não possui um arquivo HTML correspondente.`,
      );
    }
  }

  const files: Record<string, HtmlProjectFile> = { ...sourceProject.files };
  const pages: Record<string, MembershipRuntimePage> = {};
  const assets: Record<string, MembershipRuntimeAsset> = {};
  const assetIdsByPath = new Map<string, string>();
  let protectedAssetBytes = 0;
  const registerProtectedAsset: RegisterProtectedAsset = (node, pagePath, rules) => {
    if (node.tagName?.toLowerCase() !== 'a') {
      throw new Error('Downloads protegidos precisam ser links <a>.');
    }
    if (!rules.length || rules.some(rule => !membershipRuleIsProtected(rule))) {
      throw new Error('Um download protegido não possui uma política de acesso válida.');
    }
    if (rules.length > MAX_PROTECTED_ASSET_RULES_PER_CONTEXT) {
      throw new Error('Um download protegido excede o limite seguro de regras aninhadas.');
    }
    const href = nodeAttribute(node, 'href');
    const sourcePath = resolveProtectedAssetPath(pagePath, href, sourceProject.rootPath);
    const variantAsset = /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/.+/.test(sourcePath);
    if (!sourcePath || (sourcePath.startsWith('.incode/') && !variantAsset)) {
      throw new Error(`O download protegido “${href || '(sem arquivo)'}” precisa apontar para um arquivo local.`);
    }
    const sourceFile = sourceProject.files[sourcePath];
    if (!sourceFile) {
      throw new Error(`O arquivo protegido “${sourcePath}” não existe no projeto.`);
    }
    if (!isMembershipProtectedDownloadFileTypeSupported(sourcePath)) {
      throw new Error(
        `O arquivo “${sourcePath}” não pode ser servido como download protegido. Compacte-o em ZIP.`,
      );
    }
    const hrefLocation = node.sourceCodeLocation?.attrs?.href;
    if (!hrefLocation) {
      throw new Error(`O link protegido de “${sourcePath}” não possui um href editável.`);
    }
    let id = assetIdsByPath.get(sourcePath);
    if (!id) {
      if (assetIdsByPath.size >= MAX_PROTECTED_ASSETS) {
        throw new Error(`A publicação aceita no máximo ${MAX_PROTECTED_ASSETS} downloads protegidos.`);
      }
      const bytes = projectFileBytes(sourceFile);
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PROTECTED_ASSET_BYTES) {
        throw new Error(`O arquivo protegido “${sourcePath}” está vazio ou excede 64 MB.`);
      }
      protectedAssetBytes += bytes.byteLength;
      if (protectedAssetBytes > MAX_PROTECTED_ASSETS_TOTAL_BYTES) {
        throw new Error('Os downloads protegidos excedem o limite total de 64 MB.');
      }
      const digest = sha256(bytes);
      id = `asset-${sha256(`${sourcePath}\0${digest}`).slice(0, 24)}`;
      const storagePath = `${MEMBERSHIP_ASSET_ROOT}/${id}.bin`;
      assets[id] = {
        id,
        sourcePath,
        storagePath,
        filename: sourcePath.split('/').pop() || 'download',
        mimeType: sourceFile.mimeType || 'application/octet-stream',
        size: bytes.byteLength,
        sha256: digest,
        contexts: [],
      };
      assetIdsByPath.set(sourcePath, id);
    }
    const context: MembershipRuntimeAssetContext = { allOf: rules };
    const encodedContext = JSON.stringify(context);
    if (!assets[id].contexts.some(candidate => JSON.stringify(candidate) === encodedContext)) {
      if (assets[id].contexts.length >= MAX_PROTECTED_ASSET_CONTEXTS) {
        throw new Error('Um download protegido excede o limite seguro de contextos de acesso.');
      }
      assets[id].contexts.push(context);
    }
    return {
      start: hrefLocation.startOffset,
      end: hrefLocation.endOffset,
      value: `href="#kodety-protected-download" ${MEMBERSHIP_PROTECTED_ASSET_ATTRIBUTE}="${id}"`,
    };
  };
  Object.values(sourceProject.files)
    .filter(file => file.text !== undefined && /\.html?$/i.test(file.path))
    .forEach(file => {
      const authoringHtml = authorSourceProject.files[file.path]?.text;
      const compiled = compileHtmlPage(
        file.text || '',
        file.path,
        normalizeMembershipSettings(settings),
        typeof authoringHtml === 'string' ? authoringHtml : file.text || '',
        registerProtectedAsset,
      );
      if (!compiled.runtime) return;
      files[file.path] = { ...file, text: compiled.html };
      pages[compiled.runtime.runtimePath] = compiled.runtime;
    });

  if (!Object.keys(pages).length) {
    // Enabling the manager alone must not change a normal institutional site.
    return sourceProject;
  }
  if (Object.keys(assets).length) {
    const protectedPaths = new Set(Object.values(assets).map(asset => asset.sourcePath));
    const protectedHashes = new Map(
      Object.values(assets).map(asset => [asset.sha256, asset.sourcePath]),
    );
    for (const file of Object.values(files)) {
      // Experiment project clones are materialized below `/site/.kodety-experiments`
      // by WordPress. Treat them as public even though their transport source
      // lives under `.incode`; a stale clone must never retain a protected blob
      // merely because its current variant HTML stopped linking to it.
      const experimentPublicFile =
        /^\.incode\/experiments\/[^/]+\/[^/]+\/project\/.+/.test(file.path);
      if (
        (file.path.startsWith('.incode/') && !experimentPublicFile)
        || protectedPaths.has(file.path)
      ) continue;
      if (file.text !== undefined) {
        for (const asset of Object.values(assets)) {
          const basename = asset.sourcePath.split('/').pop() || asset.sourcePath;
          if (file.text.includes(asset.sourcePath) || file.text.includes(basename)) {
            throw new Error(
              `O arquivo protegido “${asset.sourcePath}” também é referenciado por conteúdo público em “${file.path}”.`,
            );
          }
        }
      }
      const duplicate = protectedHashes.get(sha256(projectFileBytes(file)));
      if (duplicate) {
        throw new Error(
          `O mesmo conteúdo de “${duplicate}” também existe publicamente em “${file.path}”.`,
        );
      }
    }
    Object.values(assets).forEach(asset => {
      const source = files[asset.sourcePath];
      if (!source) throw new Error(`O arquivo protegido “${asset.sourcePath}” desapareceu durante a publicação.`);
      files[asset.storagePath] = {
        ...source,
        path: asset.storagePath,
        mimeType: 'application/octet-stream',
      };
      delete files[asset.sourcePath];
    });
  }
  const projectId = typeof (metadata as { projectId?: unknown })?.projectId === 'string'
    ? (metadata as { projectId: string }).projectId.trim().toLocaleLowerCase()
    : '';
  if (!projectId || projectId.length > 96 || !/^[a-z0-9][a-z0-9_-]*$/.test(projectId)) {
    throw new Error('A Área de Membros precisa de uma identidade de projeto válida.');
  }
  const artifact: MembershipRuntimeArtifact = {
    version: MEMBERSHIP_RUNTIME_VERSION,
    enabled: true,
    projectId,
    pages,
    assets,
  };
  const serialized = JSON.stringify(artifact);
  if (new TextEncoder().encode(serialized).byteLength > MAX_MEMBERSHIP_RUNTIME_BYTES) {
    throw new Error('O conteúdo privado da Área de Membros ultrapassa o limite seguro de 64 MB por publicação.');
  }
  files[MEMBERSHIP_RUNTIME_PATH] = {
    path: MEMBERSHIP_RUNTIME_PATH,
    mimeType: 'application/json',
    text: serialized,
  };
  return { ...sourceProject, files };
}
