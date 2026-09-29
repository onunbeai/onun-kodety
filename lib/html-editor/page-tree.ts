export type HtmlPageTreeNodeKind = 'page' | 'folder';

export interface HtmlPageTreeNode {
  id: string;
  kind: HtmlPageTreeNodeKind;
  name: string;
  /** Physical HTML file when this route is an openable page. */
  pagePath?: string;
  /** Directory used when another page is nested below this node. */
  folderPath: string;
  children: HtmlPageTreeNode[];
}

export interface HtmlPageTreeDragItem {
  kind: 'page' | 'folder';
  /** HTML path for pages; directory path for folders/page subtrees. */
  path: string;
  /** Folder represented by the source node, used to reject self-nesting. */
  folderPath: string;
}

interface MutableDirectoryNode {
  path: string;
  name: string;
  pagePath?: string;
  directories: Map<string, MutableDirectoryNode>;
  loosePages: HtmlPageTreeNode[];
}

function normalizePath(path: string) {
  return path.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function pageStem(path: string) {
  return path.split('/').at(-1)?.replace(/\.html?$/i, '') || path;
}

function parentPath(path: string) {
  return path.split('/').slice(0, -1).join('/');
}

function joinPath(...parts: string[]) {
  return parts.map(normalizePath).filter(Boolean).join('/');
}

function ensureDirectory(root: MutableDirectoryNode, path: string) {
  const segments = normalizePath(path).split('/').filter(Boolean);
  let current = root;
  let accumulated = '';
  segments.forEach(segment => {
    accumulated = joinPath(accumulated, segment);
    let child = current.directories.get(segment);
    if (!child) {
      child = {
        path: accumulated,
        name: segment,
        directories: new Map(),
        loosePages: [],
      };
      current.directories.set(segment, child);
    }
    current = child;
  });
  return current;
}

function compareNodes(a: HtmlPageTreeNode, b: HtmlPageTreeNode) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function materializeDirectory(node: MutableDirectoryNode): HtmlPageTreeNode {
  const children = [
    ...Array.from(node.directories.values()).map(materializeDirectory),
    ...node.loosePages,
  ].sort(compareNodes);
  return {
    id: node.pagePath ? `page:${node.pagePath}` : `folder:${node.path}`,
    kind: node.pagePath ? 'page' : 'folder',
    name: node.name,
    pagePath: node.pagePath,
    folderPath: node.path,
    children,
  };
}

function assignDirectoryPage(node: MutableDirectoryNode, path: string) {
  if (!node.pagePath) {
    node.pagePath = path;
    return;
  }
  if (node.pagePath === path) return;
  // Two physical files can share one clean public route (`about.html` and
  // `about/index.html`). Keep both visible so the author can resolve the
  // collision; the route validator blocks publication separately.
  node.loosePages.push({
    id: `page:${path}`,
    kind: 'page',
    name: pageStem(path),
    pagePath: path,
    folderPath: joinPath(parentPath(path), pageStem(path)),
    children: [],
  });
}

/**
 * Derive the Pages panel hierarchy directly from authored HTML paths.
 *
 * - `about/index.html` is an openable page named About.
 * - `about/team.html` is rendered below About.
 * - `legal/privacy.html` produces a pure Legal folder when there is no
 *   `legal/index.html` or `legal.html` page.
 * - `about.html` and `about/team.html` merge into one openable About node.
 */
export function buildHtmlPageTree(
  paths: readonly string[],
  homePage: string,
): HtmlPageTreeNode[] {
  const normalizedHome = normalizePath(homePage);
  const pages = Array.from(new Set(paths.map(normalizePath)))
    .filter(path => path && path !== normalizedHome && /\.html?$/i.test(path))
    // Directory maps and collision primaries must not depend on API/object
    // insertion order. UTF-16 ordering is stable for the canonical paths and
    // consistently keeps `about.html` ahead of `about/index.html`.
    .sort();
  const root: MutableDirectoryNode = {
    path: '',
    name: '',
    directories: new Map(),
    loosePages: [],
  };

  // Directories must exist before leaf pages are assigned so `about.html`
  // can merge with an existing `about/` subtree regardless of input order.
  pages.forEach(path => {
    const directory = parentPath(path);
    if (directory) ensureDirectory(root, directory);
  });

  pages.forEach(path => {
    const directoryPath = parentPath(path);
    const fileName = path.split('/').at(-1) || path;
    const parent = ensureDirectory(root, directoryPath);
    if (/^index\.html?$/i.test(fileName) && directoryPath) {
      assignDirectoryPage(parent, path);
      return;
    }

    const stem = pageStem(path);
    const matchingDirectory = parent.directories.get(stem);
    if (matchingDirectory) {
      assignDirectoryPage(matchingDirectory, path);
      return;
    }
    parent.loosePages.push({
      id: `page:${path}`,
      kind: 'page',
      name: stem,
      pagePath: path,
      folderPath: joinPath(directoryPath, stem),
      children: [],
    });
  });

  return [
    ...Array.from(root.directories.values()).map(materializeDirectory),
    ...root.loosePages,
  ].sort(compareNodes);
}

export function filterHtmlPageTree(
  nodes: readonly HtmlPageTreeNode[],
  query: string,
): HtmlPageTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return nodes as HtmlPageTreeNode[];
  return nodes.flatMap(node => {
    const children = filterHtmlPageTree(node.children, normalizedQuery);
    const matches = [node.name, node.pagePath || '', node.folderPath]
      .some(value => value.toLowerCase().includes(normalizedQuery));
    return matches || children.length
      ? [{ ...node, children }]
      : [];
  });
}

export function flattenHtmlPageTree(
  nodes: readonly HtmlPageTreeNode[],
): HtmlPageTreeNode[] {
  return nodes.flatMap(node => [node, ...flattenHtmlPageTree(node.children)]);
}

export function htmlPageMoveDestination(
  pagePath: string,
  targetFolder: string,
) {
  const normalizedPage = normalizePath(pagePath);
  const target = normalizePath(targetFolder);
  const fileName = normalizedPage.split('/').at(-1) || normalizedPage;
  if (/^index\.html?$/i.test(fileName)) {
    const sourceFolder = parentPath(normalizedPage);
    const pageName = sourceFolder.split('/').at(-1) || 'page';
    return joinPath(target, pageName, fileName);
  }
  return joinPath(target, fileName);
}

export function htmlPageParentFolder(pagePath: string) {
  const normalizedPage = normalizePath(pagePath);
  const fileName = normalizedPage.split('/').at(-1) || normalizedPage;
  const directory = parentPath(normalizedPage);
  return /^index\.html?$/i.test(fileName) ? parentPath(directory) : directory;
}

export function htmlPageNodeFolder(pagePath: string) {
  const normalizedPage = normalizePath(pagePath);
  const fileName = normalizedPage.split('/').at(-1) || normalizedPage;
  return /^index\.html?$/i.test(fileName)
    ? parentPath(normalizedPage)
    : normalizedPage.replace(/\.html?$/i, '');
}

export function htmlFolderParent(folderPath: string) {
  return parentPath(normalizePath(folderPath));
}

export function htmlFolderMoveDestination(
  folderPath: string,
  targetFolder: string,
) {
  const normalizedFolder = normalizePath(folderPath);
  return joinPath(
    targetFolder,
    normalizedFolder.split('/').at(-1) || normalizedFolder,
  );
}

export function canDropHtmlPageTreeItem(
  item: HtmlPageTreeDragItem,
  targetFolder: string,
) {
  const target = normalizePath(targetFolder);
  const source = normalizePath(item.path);
  const sourceNodeFolder = normalizePath(item.folderPath);
  if (!source) return false;

  if (item.kind === 'folder') {
    if (target === source || target.startsWith(`${source}/`)) return false;
    return parentPath(source) !== target;
  }

  if (target === sourceNodeFolder) return false;
  return htmlPageParentFolder(source) !== target;
}

export function renameHtmlFolderDestination(
  folderPath: string,
  requestedName: string,
) {
  const normalizedFolder = normalizePath(folderPath);
  const name = normalizePath(requestedName);
  if (!name || name === '.' || name === '..' || name.includes('/')) return '';
  return joinPath(parentPath(normalizedFolder), name);
}
