export type EditorMode = 'design' | 'cms';

export interface HtmlProjectFile {
  path: string;
  mimeType: string;
  text?: string;
  data?: Uint8Array;
}

export interface HtmlProject {
  name: string;
  files: Record<string, HtmlProjectFile>;
  mainHtmlPath: string;
  rootPath: string;
  /**
   * Ephemeral asset-resolution root used by isolated editor surfaces.
   * It is deliberately ignored by transport metadata, so opening an A/B
   * variant can never replace the canonical public root during autosave.
   */
  previewRootPath?: string;
  openedAt: number;
}

export interface EditorElement {
  path: string;
  tag: string;
  label: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  hasElementChildren: boolean;
  children: EditorElement[];
}

/** Browser-resolved authored declaration that owns one selected CSS property. */
export interface SelectionStyleOrigin {
  /** Matching authored selector branch. Empty only for an inline declaration. */
  selector: string;
  /** Project CSS path. Empty for inline and embedded <style> declarations. */
  cssPath: string;
  /** Exact authored property, which may be a shorthand owning the selected longhand. */
  property: string;
  important: boolean;
  inline: boolean;
}

export interface SelectionSnapshot {
  path: string;
  tag: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  hasElementChildren: boolean;
  computedStyle: Record<string, string>;
  /** Winning authored viewport-unit declarations before canvas simulation resolves them to pixels. */
  authoredStyle?: Record<string, string>;
  /** Browser-resolved source owner for each authored/computed CSS property. */
  styleOrigins?: Record<string, SelectionStyleOrigin>;
  /** Computed display mode of the live parent in the canvas. */
  parentDisplay?: string;
  /** Computed positioning mode of the live parent in the canvas. */
  parentPosition?: string;
}
