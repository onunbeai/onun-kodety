import {
  EXPERIMENT_INTERNAL_ROOT,
  activeExperimentEditSession,
  experimentVariantPrefix,
  projectFileDigest,
  readExperimentSettings,
} from './experiments';
import {
  interactionDocumentPath,
  interactionDocumentPathCandidates,
} from './interactions';
import type { HtmlProject, HtmlProjectFile } from './types';

/**
 * The assets panel used to be two flat lists. Real projects nest their media,
 * stylesheets and scripts in folders, and an A/B test adds a second document
 * tree on top of that. Both are presented here as one derived hierarchy: the
 * folders come from the paths the files already have, so nothing is moved and
 * no reference in HTML/CSS/JS can break.
 */

export type AssetTreeFileKind =
  | 'page'
  | 'style'
  | 'script'
  | 'media'
  | 'animation'
  | 'other';

export type AssetTreeFileFilter =
  | 'all'
  | 'html'
  | 'css'
  | 'javascript'
  | 'svg'
  | 'image'
  | 'video'
  | 'audio'
  | 'font'
  | 'json'
  | 'other';

/** Why a variant file shows up inside its test folder. */
export type AssetTreeDivergence = 'added' | 'changed' | 'removed';

export interface AssetTreeFileNode {
  kind: 'file';
  id: string;
  name: string;
  /** Path the editor reads and writes. Never a display-only value. */
  path: string;
  file: HtmlProjectFile | null;
  fileKind: AssetTreeFileKind;
  divergence?: AssetTreeDivergence;
}

export interface AssetTreeFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  children: AssetTreeNode[];
  fileCount: number;
  /** Set on the synthetic folders that mirror an A/B test. */
  experimentId?: string;
  variantId?: string;
}

export type AssetTreeNode = AssetTreeFolderNode | AssetTreeFileNode;

const ANIMATION_SUFFIX = '.animations.json';

export function assetTreeFileKind(path: string): AssetTreeFileKind {
  if (path.endsWith(ANIMATION_SUFFIX)) return 'animation';
  if (/\.html?$/i.test(path)) return 'page';
  if (/\.(css|scss|sass|less)$/i.test(path)) return 'style';
  if (/\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(path)) return 'script';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot)$/i.test(path)) {
    return 'media';
  }
  return 'other';
}

export function matchesAssetTreeFileFilter(
  path: string,
  filter: AssetTreeFileFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'html') return /\.html?$/i.test(path);
  if (filter === 'css') return /\.(css|scss|sass|less)$/i.test(path);
  if (filter === 'javascript') return /\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(path);
  if (filter === 'svg') return /\.svg$/i.test(path);
  if (filter === 'image') return /\.(png|jpe?g|gif|webp|avif|apng|bmp|ico)$/i.test(path);
  if (filter === 'video') return /\.(mp4|webm|mov|m4v|ogv)$/i.test(path);
  if (filter === 'audio') return /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i.test(path);
  if (filter === 'font') return /\.(woff2?|ttf|otf|eot)$/i.test(path);
  if (filter === 'json') return /\.(json|map)$/i.test(path);
  return !(
    matchesAssetTreeFileFilter(path, 'html')
    || matchesAssetTreeFileFilter(path, 'css')
    || matchesAssetTreeFileFilter(path, 'javascript')
    || matchesAssetTreeFileFilter(path, 'svg')
    || matchesAssetTreeFileFilter(path, 'image')
    || matchesAssetTreeFileFilter(path, 'video')
    || matchesAssetTreeFileFilter(path, 'audio')
    || matchesAssetTreeFileFilter(path, 'font')
    || matchesAssetTreeFileFilter(path, 'json')
  );
}

function compareNodes(left: AssetTreeNode, right: AssetTreeNode) {
  if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true });
}

function sortTree(nodes: AssetTreeNode[]): AssetTreeNode[] {
  nodes.sort(compareNodes);
  nodes.forEach(node => {
    if (node.kind === 'folder') sortTree(node.children);
  });
  return nodes;
}

function countFiles(nodes: AssetTreeNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.kind === 'file') return total + 1;
    node.fileCount = countFiles(node.children);
    return total + node.fileCount;
  }, 0);
}

interface TreeEntry {
  path: string;
  file: HtmlProjectFile | null;
  divergence?: AssetTreeDivergence;
  /** Segments to display the entry under, when they differ from `path`. */
  displaySegments?: string[];
}

function buildTree(entries: TreeEntry[], idPrefix: string): AssetTreeNode[] {
  const root: AssetTreeNode[] = [];
  const folders = new Map<string, AssetTreeFolderNode>();

  const folderAt = (segments: string[]): AssetTreeNode[] => {
    let children = root;
    let walked = '';
    segments.forEach(segment => {
      walked = walked ? `${walked}/${segment}` : segment;
      let folder = folders.get(walked);
      if (!folder) {
        folder = {
          kind: 'folder',
          id: `${idPrefix}${walked}/`,
          name: segment,
          path: walked,
          children: [],
          fileCount: 0,
        };
        folders.set(walked, folder);
        children.push(folder);
      }
      children = folder.children;
    });
    return children;
  };

  entries.forEach(entry => {
    const segments = entry.displaySegments ?? entry.path.split('/');
    const name = segments[segments.length - 1] || entry.path;
    folderAt(segments.slice(0, -1)).push({
      kind: 'file',
      id: `${idPrefix}${entry.path}`,
      name,
      path: entry.path,
      file: entry.file,
      fileKind: assetTreeFileKind(name),
      ...(entry.divergence ? { divergence: entry.divergence } : {}),
    });
  });

  countFiles(root);
  return sortTree(root);
}

/**
 * The document tree of whatever is open right now (Control or an authored
 * variant), plus each page's animation document shown beside the page it
 * animates. The animation JSON is stored flattened under `.incode/animations`,
 * so without this the only place it existed was inside the A/B clone logic.
 */
export function buildProjectAssetTree(
  files: HtmlProjectFile[],
  project?: HtmlProject | null,
): AssetTreeNode[] {
  const entries: TreeEntry[] = files.map(file => ({ path: file.path, file }));
  if (project) {
    // `files` carries visible paths. While a variant is open its documents are
    // stored behind the private prefix, so the companion must be looked up
    // there instead of resolving to Control's animation document.
    const prefix = activeExperimentEditSession(project)?.variantPrefix ?? '';
    files
      .filter(file => /\.html?$/i.test(file.path))
      .forEach(file => {
        const documentPath = interactionDocumentPathCandidates(`${prefix}${file.path}`)
          .find(path => Boolean(project.files[path]))
          || interactionDocumentPath(`${prefix}${file.path}`);
        const document = project.files[documentPath];
        if (!document) return;
        const segments = file.path.split('/');
        entries.push({
          path: documentPath,
          file: document,
          // Flattened storage, but it belongs beside its page for the author.
          displaySegments: [
            ...segments.slice(0, -1),
            `${segments[segments.length - 1]}${ANIMATION_SUFFIX}`,
          ],
        });
      });
  }
  return buildTree(entries, '');
}

/**
 * One folder per A/B test, named after the test, holding only what each
 * variant actually changed. Files a variant merely inherited from Control are
 * left out: they are identical bytes, and listing them would drown the few
 * files the author is really testing.
 */
export function buildExperimentAssetFolders(project: HtmlProject): AssetTreeFolderNode[] {
  const settings = readExperimentSettings(project);
  return settings.experiments
    .map(experiment => {
      const variantFolders = experiment.variants
        .filter(variant => variant.kind === 'variant')
        .map(variant => {
          const prefix = experimentVariantPrefix(experiment.id, variant.id);
          const entries: TreeEntry[] = [];
          // Copy-on-write binaries are intentionally absent from the private
          // tree. Mark them as present so the divergence view does not report
          // every inherited image/font/video as deleted.
          const seen = new Set<string>(variant.inheritedFilePaths || []);

          Object.entries(project.files).forEach(([path, file]) => {
            if (!path.startsWith(prefix)) return;
            const publicPath = path.slice(prefix.length);
            if (!publicPath || publicPath.startsWith('.incode/')) return;
            seen.add(publicPath);
            const control = project.files[publicPath];
            if (projectFileDigest(file) === projectFileDigest(control)) return;
            entries.push({
              path,
              file,
              divergence: control ? 'changed' : 'added',
              displaySegments: publicPath.split('/'),
            });
          });

          // A variant that only retimed an animation has byte-identical HTML.
          // Its divergence lives entirely in the companion document.
          Object.keys(project.files)
            .filter(path => path.startsWith(prefix) && /\.html?$/i.test(path))
            .forEach(path => {
              const publicPath = path.slice(prefix.length);
              const variantDocumentPath = interactionDocumentPathCandidates(path)
                .find(candidate => Boolean(project.files[candidate]))
                || interactionDocumentPath(path);
              const controlDocumentPath = interactionDocumentPathCandidates(publicPath)
                .find(candidate => Boolean(project.files[candidate]))
                || interactionDocumentPath(publicPath);
              const variantDocument = project.files[variantDocumentPath];
              const controlDocument = project.files[controlDocumentPath];
              if (!variantDocument) return;
              if (projectFileDigest(variantDocument) === projectFileDigest(controlDocument)) return;
              entries.push({
                path: variantDocumentPath,
                file: variantDocument,
                divergence: controlDocument ? 'changed' : 'added',
                displaySegments: [
                  ...publicPath.split('/').slice(0, -1),
                  `${publicPath.split('/').pop()}${ANIMATION_SUFFIX}`,
                ],
              });
            });

          Object.keys(project.files)
            .filter(path => !path.startsWith('.incode/') && !seen.has(path))
            .forEach(path => {
              entries.push({
                path: `${prefix}${path}`,
                file: null,
                divergence: 'removed',
                displaySegments: path.split('/'),
              });
            });

          const children = buildTree(entries, `${prefix}#`);
          return {
            kind: 'folder' as const,
            id: `${EXPERIMENT_INTERNAL_ROOT}${experiment.id}/${variant.id}/`,
            name: variant.name,
            path: prefix,
            children,
            fileCount: countFiles(children),
            experimentId: experiment.id,
            variantId: variant.id,
          };
        })
        .filter(folder => folder.fileCount > 0);

      return {
        kind: 'folder' as const,
        id: `${EXPERIMENT_INTERNAL_ROOT}${experiment.id}/`,
        name: experiment.name,
        path: `${EXPERIMENT_INTERNAL_ROOT}${experiment.id}/`,
        children: variantFolders,
        fileCount: variantFolders.reduce((total, folder) => total + folder.fileCount, 0),
        experimentId: experiment.id,
      };
    })
    .filter(folder => folder.fileCount > 0)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

/** Collapse the tree to the nodes matching a query, keeping the folders that
 * lead to a match so the result still reads as a hierarchy. */
export function filterAssetTree(
  nodes: AssetTreeNode[],
  query: string,
  fileFilter: AssetTreeFileFilter = 'all',
): AssetTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized && fileFilter === 'all') return nodes;
  const walk = (items: AssetTreeNode[]): AssetTreeNode[] =>
    items.flatMap((node): AssetTreeNode[] => {
      if (node.kind === 'file') {
        if (!matchesAssetTreeFileFilter(node.path, fileFilter)) return [];
        const matchesQuery = !normalized
          || node.path.toLowerCase().includes(normalized)
          || node.name.toLowerCase().includes(normalized)
          || Boolean(node.file?.text?.toLowerCase().includes(normalized));
        return matchesQuery ? [node] : [];
      }
      const children = walk(node.children);
      if (!children.length) return [];
      return [{ ...node, children, fileCount: countFiles(children) }];
    });
  return walk(nodes);
}

/** Every folder path in the tree, for expand-all / collapse-all. */
export function assetTreeFolderIds(nodes: AssetTreeNode[]): string[] {
  return nodes.flatMap(node =>
    node.kind === 'folder' ? [node.id, ...assetTreeFolderIds(node.children)] : [],
  );
}
