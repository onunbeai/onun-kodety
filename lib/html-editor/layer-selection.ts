export interface HtmlLayerSelectionEntry {
  path: string;
  depth: number;
  canHaveChildren: boolean;
  hasVisibleChildren: boolean;
}

export interface HtmlLayerSelectionIndexEntry extends HtmlLayerSelectionEntry {
  index: number;
  lastVisibleDescendant: string | null;
}

/** Build once for a visible tree projection, independently of selection. */
export function indexHtmlLayerSelection(entries: readonly HtmlLayerSelectionEntry[]) {
  const byPath = new Map<string, HtmlLayerSelectionIndexEntry>();
  const ancestors: HtmlLayerSelectionIndexEntry[] = [];
  let previous: HtmlLayerSelectionIndexEntry | undefined;
  const closeAncestor = () => {
    const ancestor = ancestors.pop()!;
    if (previous && previous !== ancestor) ancestor.lastVisibleDescendant = previous.path;
  };
  entries.forEach((entry, index) => {
    while (ancestors.length && !entry.path.startsWith(`${ancestors.at(-1)!.path}/`)) closeAncestor();
    const indexed = { ...entry, index, lastVisibleDescendant: null };
    byPath.set(entry.path, indexed);
    ancestors.push(indexed);
    previous = indexed;
  });
  while (ancestors.length) closeAncestor();
  return byPath;
}

/** Resolve only rendered rows; work per selection scales with selected paths. */
export function createHtmlLayerSelectionState(
  index: ReadonlyMap<string, HtmlLayerSelectionIndexEntry>,
  selectedPaths: ReadonlySet<string>,
) {
  const ranks = new Map<string, number>();
  const depths = new Set<number>();
  selectedPaths.forEach(path => {
    ranks.set(path, ranks.size);
    const entry = index.get(path);
    if (entry?.canHaveChildren) depths.add(entry.depth);
  });
  return {
    highlightedDepths: `,${Array.from(depths).sort((a, b) => a - b).join(',')},`,
    get(path: string) {
      const entry = index.get(path);
      let selectedAncestor: string | undefined;
      let ancestorRank = Infinity;
      // Source paths already encode ancestry. Keep the first selected
      // ancestor's rank so overlapping multi-selections retain their rails.
      for (let separator = path.lastIndexOf('/'); separator >= 0; separator = path.lastIndexOf('/', separator - 1)) {
        const ancestor = path.slice(0, separator);
        const rank = ranks.get(ancestor);
        if (rank !== undefined && rank < ancestorRank) {
          selectedAncestor = ancestor;
          ancestorRank = rank;
        }
        if (separator === 0) break;
      }
      return {
        isSelected: selectedPaths.has(path),
        isChildOfSelected: selectedAncestor !== undefined,
        isLastVisibleDescendant: selectedAncestor !== undefined
          && index.get(selectedAncestor)?.lastVisibleDescendant === path,
        hasVisibleChildren: entry?.hasVisibleChildren ?? false,
      };
    },
  };
}
