import type { EditorElement } from "./types";

export type HtmlLayerNameSource = "label" | "id" | "generated" | "class" | "content" | "type";

export interface HtmlLayerPresentation {
  name: string;
  type: string;
  showType: boolean;
  source: HtmlLayerNameSource;
  title?: string;
}

function compactLayerName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function humanizeHtmlLayerIdentity(value: string) {
  const compact = compactLayerName(value)
    .replace(/^[#.]+/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return `${compact.charAt(0).toUpperCase()}${compact.slice(1)}`;
}

/**
 * Assigns compact, presentation-only names to unnamed image layers.
 *
 * The numbering follows document order and ignores images that already have
 * an explicit layer label or ID. Classes remain untouched and available to
 * the selector UI; generated/technical class names no longer leak into Layers.
 */
export function resolveHtmlImageLayerNames(nodes: readonly EditorElement[]) {
  const names = new Map<string, string>();
  let nextImage = 1;

  const visit = (items: readonly EditorElement[]) => {
    items.forEach((node) => {
      const explicitLabel =
        node.attributes["data-label"]?.trim() ||
        node.attributes["data-kodety-label"]?.trim();
      const id = node.attributes.id?.trim() || node.id?.trim();
      if (node.tag.toLowerCase() === "img" && !explicitLabel && !id) {
        names.set(node.path, `Image_${nextImage}`);
        nextImage += 1;
      }
      visit(node.children);
    });
  };

  visit(nodes);
  return names;
}

export function resolveHtmlLayerPresentation(
  node: EditorElement,
  elementType: string,
  generatedName?: string,
): HtmlLayerPresentation {
  const explicitLabel =
    node.attributes["data-label"]?.trim() ||
    node.attributes["data-kodety-label"]?.trim();
  const id = node.attributes.id?.trim() || node.id?.trim();
  const primaryClass =
    node.classes.find((className) => className.trim())?.trim() ||
    node.attributes.class?.trim().split(/\s+/).find(Boolean);
  const fallbackLabel = compactLayerName(node.label || "");

  let name = elementType;
  let source: HtmlLayerNameSource = "type";
  let title: string | undefined;

  if (explicitLabel) {
    name = compactLayerName(explicitLabel);
    source = "label";
    title = `Nome da layer: ${name}`;
  } else if (id) {
    name = humanizeHtmlLayerIdentity(id);
    source = "id";
    title = `ID: #${id}`;
  } else if (generatedName) {
    name = generatedName;
    source = "generated";
  } else if (primaryClass) {
    name = humanizeHtmlLayerIdentity(primaryClass);
    source = "class";
    title = `Classe: .${primaryClass}`;
  } else if (
    fallbackLabel &&
    fallbackLabel.toLowerCase() !== node.tag.toLowerCase()
  ) {
    name = fallbackLabel;
    source = "content";
  }

  if (!name) name = elementType;

  return {
    name,
    type: elementType,
    showType:
      name.localeCompare(elementType, undefined, {
        sensitivity: "base",
      }) !== 0,
    source,
    title,
  };
}
