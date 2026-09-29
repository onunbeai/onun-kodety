"use client";

import { createHtmlLayerSelectionState, indexHtmlLayerSelection } from '@/lib/html-editor/layer-selection';
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BoxSelect,
  Clipboard,
  ClipboardPaste,
  Code2,
  Component,
  CornerUpLeft,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  Layers3,
  Lock,
  Paintbrush,
  PanelTopOpen,
  Pencil,
  Trash2,
  Unlock,
  ZapFill,
} from "@/components/ui/gravity-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Icon, { type IconProps } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  resolveHtmlImageLayerNames,
  resolveHtmlLayerPresentation,
} from "@/lib/html-editor/layer-presentation";
import {
  type ElementDropPosition,
} from "@/lib/html-editor/source-patcher";
import { BUILDER_HIDDEN_ATTRIBUTE } from "@/lib/html-editor/builder-visibility";
import type { EditorElement } from "@/lib/html-editor/types";

const ROW_HEIGHT = 32;
const TREE_INDENT = 14;
const TREE_OVERSCAN = 20;
const END_DROP_ID = "html-layers-end-drop-zone";
// Selected descendants use a muted mix of the Kodety accent so connected rows
// remain legible against the dark panel.
const SELECTED_DESCENDANT_BG =
  "color-mix(in srgb, var(--kodety-accent) 18%, var(--kodety-panel))";
const SELECTED_DESCENDANT_HOVER_BG =
  "color-mix(in srgb, var(--kodety-accent) 24%, var(--kodety-panel))";

const CONTAINER_ELEMENTS = new Set([
  "body",
  "main",
  "section",
  "div",
  "article",
  "aside",
  "nav",
  "header",
  "footer",
  "form",
  "ul",
  "ol",
  "li",
]);

type DropPosition = "above" | "below" | "inside";

interface FlattenedHtmlLayer {
  id: string;
  node: EditorElement;
  depth: number;
  parentPath: string | null;
  index: number;
  collapsed: boolean;
  canHaveChildren: boolean;
  previousSiblingPath: string | null;
  nextSiblingPath: string | null;
}

export interface HtmlLayersTreeProps {
  nodes: EditorElement[];
  /** Undefined until the active Canvas has published a complete snapshot. */
  effectiveHiddenPaths?: string[];
  search: string;
  width: number;
  selectedPath: string | null;
  selectedPaths: string[];
  lockedPaths: string[];
  interactionSelectors: string[];
  canPaste: boolean;
  canPasteStyles: boolean;
  onSelect: (path: string, additive?: boolean) => void;
  onToggleVisibility: (path: string, visible: boolean) => void;
  onToggleBuilderHidden: (path: string, hidden: boolean) => void;
  onLayerRename: (path: string, label: string) => void;
  onToggleLock: (path: string) => void;
  onRemove: (path: string) => void;
  onDuplicate: (path: string) => void;
  onCopy: (path: string) => void;
  onPaste: (path: string) => void;
  onCopyStyles: (path: string) => void;
  onPasteStyles: (path: string) => void;
  onWrap: (path: string) => void;
  onUnwrap: (path: string) => void;
  onCreateComponent?: (path: string) => void;
  onEditComponent?: (path: string) => void;
  onDetachComponent?: (path: string) => void;
  onResetComponentVariantLayerOverrides?: (path: string) => void;
  onMove: (
    sourcePath: string,
    targetPath: string,
    position: ElementDropPosition,
  ) => void;
}

interface DndInfo {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  setRowElement: (element: HTMLDivElement | null) => void;
}

const DndInfoContext = React.createContext<React.MutableRefObject<DndInfo>>(
  null!,
);

const pointerFirstCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

function dndId(path: string) {
  return `html-layer:${path || "__root__"}`;
}

function calcDropPosition(
  relativeY: number,
  isContainer: boolean,
  hasVisibleChildren: boolean,
): DropPosition {
  if (isContainer) {
    const edge = hasVisibleChildren ? 0.15 : 0.1;
    if (relativeY < edge) return "above";
    if (relativeY > 1 - edge) return "below";
    return "inside";
  }
  return relativeY < 0.5 ? "above" : "below";
}

function getHtmlElementIcon(node: EditorElement): IconProps["name"] {
  const tag = node.tag.toLowerCase();
  const identity =
    `${node.attributes.id || ""} ${node.attributes.class || ""}`.toLowerCase();
  if (tag === "body") return "body";
  if (tag === "main") return "layout";
  if (["section", "article", "aside", "nav", "header", "footer"].includes(tag))
    return "section";
  if (tag === "div" && /(container|wrapper|inner)/.test(identity))
    return "container";
  if (tag === "div") return "block";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (["p", "span", "strong", "em", "label"].includes(tag)) return "text";
  if (tag === "a") return "link";
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "form") return "form";
  if (tag === "input")
    return node.attributes.type === "checkbox"
      ? "checkbox"
      : node.attributes.type === "radio"
        ? "radio"
        : "input";
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (tag === "button") return "cursor-default";
  if (tag === "ul") return "listUnordered";
  if (tag === "ol") return "listOrdered";
  if (tag === "li") return "listItem";
  if (tag === "hr") return "separator";
  if (tag === "table") return "table";
  if (tag === "tr") return "table-row";
  if (tag === "td" || tag === "th") return "table-cell";
  return "box";
}

function isNativeOverlayRootNode(node: EditorElement) {
  return node.attributes["data-kodety-overlay"] !== undefined;
}

function isNativeOverlaySurfaceNode(node: EditorElement) {
  return node.attributes["data-kodety-overlay-surface"] !== undefined;
}

function isNativeOverlayBackdropNode(node: EditorElement) {
  return node.attributes["data-kodety-overlay-backdrop"] !== undefined;
}

const OVERLAY_CONTROL_ATTRIBUTES = [
  "data-kodety-overlay-target",
  "data-kodety-overlay-toggle",
  "data-kodety-overlay-open",
  "data-kodety-overlay-trigger",
] as const;

function hasNativeOverlayControl(node: EditorElement) {
  return (
    OVERLAY_CONTROL_ATTRIBUTES.some(
      (attribute) => node.attributes[attribute] !== undefined,
    ) || node.attributes["data-kodefy-checkout"] !== undefined
  );
}

function isNativeLocaleSelectorNode(node: EditorElement) {
  return (
    node.attributes["data-kodety-locale-selector"] !== undefined ||
    node.attributes["data-incode-component"] === "locales-list"
  );
}

function isNativeLocaleOverlayNode(node: EditorElement) {
  return node.attributes["data-kodety-locale-options"] !== undefined;
}

function isCodeComponentNode(node: EditorElement) {
  return Boolean(node.attributes["data-coday-code-instance"]);
}

function HtmlLayerIcon({
  node,
  className,
}: {
  node: EditorElement;
  className?: string;
}) {
  const iconClassName = cn("shrink-0 text-[var(--kodety-accent)]", className);
  if (isCodeComponentNode(node)) {
    return (
      <Code2
        aria-label="Code Component"
        className={cn(iconClassName, "!text-[#a8e986]")}
      />
    );
  }
  if (node.attributes["data-kodety-component-id"]) {
    return (
      <Component
        aria-label="Component"
        className={cn(iconClassName, "!text-purple-400")}
      />
    );
  }
  if (isNativeOverlaySurfaceNode(node)) {
    return (
      <PanelTopOpen aria-label="Surface de overlay" className={iconClassName} />
    );
  }
  if (isNativeOverlayRootNode(node) || isNativeOverlayBackdropNode(node)) {
    return (
      <Layers3
        aria-label={
          isNativeOverlayBackdropNode(node) ? "Backdrop de overlay" : "Overlay"
        }
        className={iconClassName}
      />
    );
  }
  if (isNativeLocaleSelectorNode(node) || isNativeLocaleOverlayNode(node)) {
    return (
      <Globe2
        aria-label={
          isNativeLocaleOverlayNode(node)
            ? "Overlay de idiomas"
            : "Seletor de idiomas"
        }
        className={iconClassName}
      />
    );
  }
  return <Icon name={getHtmlElementIcon(node)} className={iconClassName} />;
}

function getHtmlElementTypeName(node: EditorElement) {
  if (isCodeComponentNode(node)) return "Code Component";
  if (node.attributes["data-kodety-component-id"]) return "Component";
  if (isNativeOverlayRootNode(node)) return "Overlay";
  if (isNativeOverlaySurfaceNode(node)) return "Surface";
  if (isNativeOverlayBackdropNode(node)) return "Backdrop";
  const tag = node.tag.toLowerCase();
  const names: Record<string, string> = {
    body: "Body",
    main: "Main",
    section: "Section",
    article: "Article",
    aside: "Aside",
    nav: "Navigation",
    header: "Header",
    footer: "Footer",
    div: "Block",
    p: "Text",
    span: "Text",
    a: "Link",
    img: "Image",
    picture: "Picture",
    video: "Video",
    audio: "Audio",
    form: "Form",
    input: "Input",
    textarea: "Textarea",
    select: "Select",
    button: "Button",
    ul: "List",
    ol: "List",
    li: "List item",
    hr: "Separator",
    table: "Table",
    tr: "Row",
    td: "Cell",
    th: "Header cell",
  };
  if (/^h[1-6]$/.test(tag)) return "Heading";
  if (
    tag === "div" &&
    /(container|wrapper|inner)/i.test(
      `${node.attributes.id || ""} ${node.attributes.class || ""}`,
    )
  )
    return "Container";
  return names[tag] || tag.toUpperCase();
}

function nodeMatchesInteractionSelector(
  node: EditorElement,
  rawSelector: string,
) {
  const selector = rawSelector.trim();
  if (!selector) return false;
  const interactionId = node.attributes["data-kodety-interaction-id"]?.trim();
  if (
    interactionId &&
    (selector.includes(`data-kodety-interaction-id="${interactionId}"`) ||
      selector.includes(`data-kodety-interaction-id='${interactionId}'`))
  )
    return true;
  const componentInstanceId = node.attributes["data-kodety-component-instance"]?.trim();
  if (
    componentInstanceId &&
    (selector.includes(`data-kodety-component-instance="${componentInstanceId}"`) ||
      selector.includes(`data-kodety-component-instance='${componentInstanceId}'`))
  )
    return true;
  if (
    node.id &&
    (selector === `#${node.id}` ||
      selector.includes(`id="${node.id}"`) ||
      selector.includes(`id='${node.id}'`))
  )
    return true;
  return node.classes.some((className) => selector === `.${className}`);
}

function isLayerHidden(node: EditorElement, effectiveHidden?: boolean) {
  // A complete Canvas snapshot is authoritative in both directions: a class
  // rule can hide a source-visible node, while a responsive rule can also
  // reveal a node that the legacy HTML-only fallback would call hidden.
  if (effectiveHidden !== undefined) return effectiveHidden;
  return (
    node.attributes.hidden !== undefined ||
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test(
      node.attributes.style || "",
    )
  );
}

function isLayerBuilderHidden(node: EditorElement) {
  return node.attributes[BUILDER_HIDDEN_ATTRIBUTE]?.toLowerCase() === "true";
}

function collectBuilderHiddenDescendantPaths(
  nodes: EditorElement[],
  hiddenByParent = false,
  target = new Set<string>(),
) {
  nodes.forEach((node) => {
    if (hiddenByParent) target.add(node.path);
    collectBuilderHiddenDescendantPaths(
      node.children,
      hiddenByParent || isLayerBuilderHidden(node),
      target,
    );
  });
  return target;
}

function filterLayerNodes(
  nodes: EditorElement[],
  rawQuery: string,
  imageLayerNames: ReadonlyMap<string, string>,
): EditorElement[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterLayerNodes(node.children, query, imageLayerNames);
    const searchable = [
      resolveHtmlLayerPresentation(node, getHtmlElementTypeName(node), imageLayerNames.get(node.path)).name,
      node.tag,
      node.label,
      node.id,
      node.classes.join(" "),
      node.text,
      ...Object.values(node.attributes),
    ]
      .join(" ")
      .toLowerCase();
    return searchable.includes(query) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}

/**
 * A component instance is one layer on a page. Its materialized DOM children
 * exist for rendering, but exposing them here would let page editing mutate a
 * copy instead of the master. Component masters do not carry the instance
 * attribute, so their complete tree remains available while editing them.
 */
function projectComponentLayerNodes(nodes: EditorElement[]): EditorElement[] {
  return nodes.map((node) =>
    node.attributes["data-kodety-component-id"] || isCodeComponentNode(node)
      ? { ...node, children: [] }
      : { ...node, children: projectComponentLayerNodes(node.children) },
  );
}

function flattenLayerNodes(
  nodes: EditorElement[],
  collapsedPaths: ReadonlySet<string>,
  forceExpanded: boolean,
  parentPath: string | null = null,
  depth = 0,
): FlattenedHtmlLayer[] {
  const result: FlattenedHtmlLayer[] = [];
  nodes.forEach((node, index) => {
    const collapsed = collapsedPaths.has(node.path) && !forceExpanded;
    result.push({
      id: dndId(node.path),
      node,
      depth,
      parentPath,
      index,
      collapsed,
      canHaveChildren:
        !node.attributes["data-kodety-component-id"] &&
        !isCodeComponentNode(node) &&
        CONTAINER_ELEMENTS.has(node.tag.toLowerCase()),
      previousSiblingPath: index > 0 ? nodes[index - 1].path : null,
      nextSiblingPath: index < nodes.length - 1 ? nodes[index + 1].path : null,
    });
    if (node.children.length > 0 && !collapsed) {
      result.push(
        ...flattenLayerNodes(
          node.children,
          collapsedPaths,
          forceExpanded,
          node.path,
          depth + 1,
        ),
      );
    }
  });
  return result;
}

function collectDefaultCollapsedPaths(
  nodes: EditorElement[],
  depth = 0,
  target = new Set<string>(),
) {
  nodes.forEach((node) => {
    if (node.children.length > 0 && depth >= 2) target.add(node.path);
    collectDefaultCollapsedPaths(node.children, depth + 1, target);
  });
  return target;
}

function findAncestorPaths(
  nodes: EditorElement[],
  targetPath: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.path === targetPath) return ancestors;
    const found = findAncestorPaths(node.children, targetPath, [
      ...ancestors,
      node.path,
    ]);
    if (found) return found;
  }
  return null;
}

function VirtualLayerRow({
  id,
  disabled,
  translateY,
  children,
}: {
  id: string;
  disabled: boolean;
  translateY: number;
  children: ReactNode;
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id,
    disabled,
  });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(setDragRef);
  const dropRef = useRef(setDropRef);
  dragRef.current = setDragRef;
  dropRef.current = setDropRef;

  const setRowElement = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    dragRef.current(element);
    dropRef.current(element);
  }, []);

  const dndInfoRef = useRef<DndInfo>({
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown>,
    setRowElement,
  });
  dndInfoRef.current.attributes = attributes as unknown as Record<
    string,
    unknown
  >;
  dndInfoRef.current.listeners = listeners as unknown as Record<
    string,
    unknown
  >;

  useLayoutEffect(() => {
    if (!elementRef.current) return;
    setDragRef(elementRef.current);
    setDropRef(elementRef.current);
  }, [setDragRef, setDropRef]);

  return (
    <DndInfoContext.Provider value={dndInfoRef}>
      <div
        className="absolute left-0 w-full"
        style={{ top: translateY, height: ROW_HEIGHT }}
      >
        {children}
      </div>
    </DndInfoContext.Provider>
  );
}

function DropLine({
  position,
  depth,
}: {
  position: "above" | "below";
  depth: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute right-1 z-50 h-[1.5px] bg-[var(--kodety-accent)]",
        position === "above" ? "top-0" : "bottom-0",
      )}
      style={{ left: Math.max(4, (depth - 1) * TREE_INDENT + 17.5) }}
    >
      <span className="absolute -left-[4px] -top-[3px] size-2 rounded-full border-[1.5px] border-[var(--kodety-accent)] bg-[var(--kodety-panel)]" />
    </div>
  );
}

interface LayerContextMenuProps {
  entry: FlattenedHtmlLayer;
  hidden: boolean;
  builderHidden: boolean;
  directlyLocked: boolean;
  lockedByParent: boolean;
  locked: boolean;
  canPaste: boolean;
  canPasteStyles: boolean;
  onToggleVisibility: HtmlLayersTreeProps["onToggleVisibility"];
  onToggleBuilderHidden: HtmlLayersTreeProps["onToggleBuilderHidden"];
  onRenameStart: (path: string) => void;
  onToggleLock: HtmlLayersTreeProps["onToggleLock"];
  onRemove: HtmlLayersTreeProps["onRemove"];
  onDuplicate: HtmlLayersTreeProps["onDuplicate"];
  onCopy: HtmlLayersTreeProps["onCopy"];
  onPaste: HtmlLayersTreeProps["onPaste"];
  onCopyStyles: HtmlLayersTreeProps["onCopyStyles"];
  onPasteStyles: HtmlLayersTreeProps["onPasteStyles"];
  onWrap: HtmlLayersTreeProps["onWrap"];
  onUnwrap: HtmlLayersTreeProps["onUnwrap"];
  onCreateComponent?: HtmlLayersTreeProps["onCreateComponent"];
  onEditComponent?: HtmlLayersTreeProps["onEditComponent"];
  onDetachComponent?: HtmlLayersTreeProps["onDetachComponent"];
  onResetComponentVariantLayerOverrides?: HtmlLayersTreeProps["onResetComponentVariantLayerOverrides"];
  onMove: HtmlLayersTreeProps["onMove"];
  children: ReactNode;
}

function HtmlLayerContextMenu({
  entry,
  hidden,
  builderHidden,
  directlyLocked,
  lockedByParent,
  locked,
  canPaste,
  canPasteStyles,
  onToggleVisibility,
  onToggleBuilderHidden,
  onRenameStart,
  onToggleLock,
  onRemove,
  onDuplicate,
  onCopy,
  onPaste,
  onCopyStyles,
  onPasteStyles,
  onWrap,
  onUnwrap,
  onCreateComponent,
  onEditComponent,
  onDetachComponent,
  onResetComponentVariantLayerOverrides,
  onMove,
  children,
}: LayerContextMenuProps) {
  const body = entry.node.tag.toLowerCase() === "body";
  const componentInstance = Boolean(entry.node.attributes["data-kodety-component-id"]);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52 [&_[role=menuitem]]:text-xs">
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onRenameStart(entry.node.path)}
        >
          <Pencil /> Renomear layer
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onToggleVisibility(entry.node.path, hidden)}
        >
          {hidden ? <Eye /> : <EyeOff />}
          {hidden ? "Mostrar" : "Ocultar"}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onToggleBuilderHidden(entry.node.path, !builderHidden)}
          title="Oculta somente no canvas do Builder; permanece visível no site."
        >
          <EyeOff /> Hidden on Builder
          {builderHidden && <ContextMenuShortcut>✓</ContextMenuShortcut>}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onDuplicate(entry.node.path)}
        >
          <Copy /> Duplicar
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={body}
          onSelect={() => onCopy(entry.node.path)}
        >
          <Clipboard /> Copiar elemento
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={locked || !canPaste}
          onSelect={() => onPaste(entry.node.path)}
        >
          <ClipboardPaste /> Colar elemento aqui
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2">
            <Paintbrush /> Estilo
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-52 [&_[role=menuitem]]:text-xs">
            <ContextMenuItem
              disabled={body}
              onSelect={() => onCopyStyles(entry.node.path)}
            >
              <Paintbrush /> Copiar estilos
              <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={locked || !canPasteStyles}
              onSelect={() => onPasteStyles(entry.node.path)}
            >
              <ClipboardPaste /> Colar estilos
              <ContextMenuShortcut>⌘⇧V</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onWrap(entry.node.path)}
        >
          <BoxSelect /> Envolver em div
        </ContextMenuItem>
        <ContextMenuItem
          disabled={body || locked}
          onSelect={() => onUnwrap(entry.node.path)}
        >
          <CornerUpLeft /> Remover wrapper
        </ContextMenuItem>
        {(onCreateComponent || onEditComponent || onDetachComponent) && (
          <>
            <ContextMenuSeparator />
            {componentInstance ? (
              <>
                <ContextMenuItem
                  disabled={locked || !onEditComponent}
                  onSelect={() => onEditComponent?.(entry.node.path)}
                >
                  <Component /> Edit master component
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={locked || !onDetachComponent}
                  onSelect={() => onDetachComponent?.(entry.node.path)}
                >
                  <Icon name="detach" /> Detach component
                </ContextMenuItem>
              </>
            ) : (
              <ContextMenuItem
                disabled={body || locked || !onCreateComponent}
                onSelect={() => onCreateComponent?.(entry.node.path)}
              >
                <Component /> Create component
              </ContextMenuItem>
            )}
          </>
        )}
        {onResetComponentVariantLayerOverrides && !body && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={locked}
              onSelect={() => onResetComponentVariantLayerOverrides(entry.node.path)}
            >
              <CornerUpLeft /> Resetar overrides da layer
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className="gap-2" disabled={body || locked}>
            <ArrowUpDown /> Mover para
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-52 [&_[role=menuitem]]:text-xs">
            <ContextMenuItem
              disabled={!entry.previousSiblingPath}
              onSelect={() =>
                entry.previousSiblingPath &&
                onMove(entry.node.path, entry.previousSiblingPath, "before")
              }
            >
              <ArrowUp /> Cima
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!entry.nextSiblingPath}
              onSelect={() =>
                entry.nextSiblingPath &&
                onMove(entry.node.path, entry.nextSiblingPath, "after")
              }
            >
              <ArrowDown /> Baixo
            </ContextMenuItem>
            <ContextMenuItem
              disabled={entry.parentPath === null}
              onSelect={() =>
                entry.parentPath !== null &&
                onMove(entry.node.path, entry.parentPath, "after")
              }
            >
              <CornerUpLeft /> Fora do container
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          disabled={body || lockedByParent}
          onSelect={() => onToggleLock(entry.node.path)}
        >
          {directlyLocked ? <Unlock /> : <Lock />}
          {directlyLocked ? "Desbloquear" : "Bloquear"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={body || locked}
          onSelect={() => onRemove(entry.node.path)}
        >
          <Trash2 /> Remover
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface HtmlLayerRowProps {
  entry: FlattenedHtmlLayer;
  effectiveHidden?: boolean;
  builderHiddenByParent: boolean;
  isSelected: boolean;
  isChildOfSelected: boolean;
  isLastVisibleDescendant: boolean;
  hasVisibleChildren: boolean;
  isOver: boolean;
  isDragging: boolean;
  isDragActive: boolean;
  dropPosition: DropPosition | null;
  highlightedDepths: string;
  directlyLocked: boolean;
  lockedByParent: boolean;
  locked: boolean;
  imageLayerName: string;
  interactionSelectors: string[];
  canPaste: boolean;
  canPasteStyles: boolean;
  isRenaming: boolean;
  onSelect: HtmlLayersTreeProps["onSelect"];
  onToggle: (path: string) => void;
  onToggleVisibility: HtmlLayersTreeProps["onToggleVisibility"];
  onToggleBuilderHidden: HtmlLayersTreeProps["onToggleBuilderHidden"];
  onRenameStart: (path: string) => void;
  onRenameConfirm: (path: string, label: string | null) => void;
  onToggleLock: HtmlLayersTreeProps["onToggleLock"];
  onRemove: HtmlLayersTreeProps["onRemove"];
  onDuplicate: HtmlLayersTreeProps["onDuplicate"];
  onCopy: HtmlLayersTreeProps["onCopy"];
  onPaste: HtmlLayersTreeProps["onPaste"];
  onCopyStyles: HtmlLayersTreeProps["onCopyStyles"];
  onPasteStyles: HtmlLayersTreeProps["onPasteStyles"];
  onWrap: HtmlLayersTreeProps["onWrap"];
  onUnwrap: HtmlLayersTreeProps["onUnwrap"];
  onCreateComponent?: HtmlLayersTreeProps["onCreateComponent"];
  onEditComponent?: HtmlLayersTreeProps["onEditComponent"];
  onDetachComponent?: HtmlLayersTreeProps["onDetachComponent"];
  onResetComponentVariantLayerOverrides?: HtmlLayersTreeProps["onResetComponentVariantLayerOverrides"];
  onMove: HtmlLayersTreeProps["onMove"];
}

const HtmlLayerRow = memo(function HtmlLayerRow({
  entry,
  effectiveHidden,
  builderHiddenByParent,
  isSelected,
  isChildOfSelected,
  isLastVisibleDescendant,
  hasVisibleChildren,
  isOver,
  isDragging,
  isDragActive,
  dropPosition,
  highlightedDepths,
  directlyLocked,
  lockedByParent,
  locked,
  imageLayerName,
  interactionSelectors,
  canPaste,
  canPasteStyles,
  isRenaming,
  onSelect,
  onToggle,
  onToggleVisibility,
  onToggleBuilderHidden,
  onRenameStart,
  onRenameConfirm,
  onToggleLock,
  onRemove,
  onDuplicate,
  onCopy,
  onPaste,
  onCopyStyles,
  onPasteStyles,
  onWrap,
  onUnwrap,
  onCreateComponent,
  onEditComponent,
  onDetachComponent,
  onResetComponentVariantLayerOverrides,
  onMove,
}: HtmlLayerRowProps) {
  const { attributes, listeners, setRowElement } =
    React.useContext(DndInfoContext).current;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const node = entry.node;
  const body = node.tag.toLowerCase() === "body";
  const componentInstance = Boolean(node.attributes["data-kodety-component-id"]);
  const codeComponentInstance = isCodeComponentNode(node);
  const solidAccentSelection =
    isSelected && !componentInstance && !codeComponentInstance;
  const builderHidden = isLayerBuilderHidden(node);
  // The canvas snapshot sees Builder-hidden layers as display:none. Preserve
  // the independent public visibility control by falling back to authored
  // visibility while this editor-only marker is active.
  const hidden = isLayerHidden(
    node,
    builderHidden || builderHiddenByParent ? undefined : effectiveHidden,
  );
  const presentation = resolveHtmlLayerPresentation(
    node,
    getHtmlElementTypeName(node),
    imageLayerName || undefined,
  );
  const hasChildren = node.children.length > 0;
  const scrollSectionId = node.attributes.id?.trim() || "";
  const hasInteraction = interactionSelectors.some((selector) =>
    nodeMatchesInteractionSelector(node, selector),
  );
  const hasOverlay = hasNativeOverlayControl(node);
  const rowBg = isSelected
    ? codeComponentInstance
      ? "color-mix(in srgb, #9fe47a 28%, var(--kodety-panel))"
      : componentInstance
      ? "color-mix(in srgb, rgb(147 51 234) 46%, var(--kodety-panel))"
      : "var(--primary)"
    : isChildOfSelected
      ? SELECTED_DESCENDANT_BG
      : "transparent";
  const rowHoverBg = isSelected
    ? rowBg
    : isChildOfSelected
      ? SELECTED_DESCENDANT_HOVER_BG
      : "color-mix(in oklch, var(--kodety-text) 8%, var(--kodety-panel))";
  const iconBg = rowBg === "transparent" ? "var(--kodety-panel)" : rowBg;
  const iconHoverBg =
    rowHoverBg === "transparent" ? "var(--kodety-panel)" : rowHoverBg;

  useEffect(() => {
    if (!isRenaming) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isRenaming]);

  return (
    <HtmlLayerContextMenu
      entry={entry}
      hidden={hidden}
      builderHidden={builderHidden}
      directlyLocked={directlyLocked}
      lockedByParent={lockedByParent}
      locked={locked}
      canPaste={canPaste}
      canPasteStyles={canPasteStyles}
      onToggleVisibility={onToggleVisibility}
      onToggleBuilderHidden={onToggleBuilderHidden}
      onRenameStart={onRenameStart}
      onToggleLock={onToggleLock}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
      onCopy={onCopy}
      onPaste={onPaste}
      onCopyStyles={onCopyStyles}
      onPasteStyles={onPasteStyles}
      onWrap={onWrap}
      onUnwrap={onUnwrap}
      onCreateComponent={onCreateComponent}
      onEditComponent={onEditComponent}
      onDetachComponent={onDetachComponent}
      onResetComponentVariantLayerOverrides={onResetComponentVariantLayerOverrides}
      onMove={onMove}
    >
      <div
        className="group/row relative flex"
        style={{ width: "100%", minWidth: "100%" }}
        onContextMenu={() => {
          if (!isSelected && !locked) onSelect(node.path);
        }}
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className={cn(
              "sticky left-0 h-full bg-(--row-bg) group-hover/row:bg-(--row-hover-bg)",
              isSelected && !hasVisibleChildren && "rounded-lg",
              isSelected && hasVisibleChildren && "rounded-t-lg",
              !isSelected &&
                isChildOfSelected &&
                !isLastVisibleDescendant &&
                "rounded-none",
              !isSelected &&
                isChildOfSelected &&
                isLastVisibleDescendant &&
                "rounded-b-lg",
              !isSelected && !isChildOfSelected && "rounded-lg",
            )}
            style={
              {
                width: "var(--tree-available-width)",
                "--row-bg": rowBg,
                "--row-hover-bg": rowHoverBg,
              } as CSSProperties
            }
          />
        </div>

        {isOver && dropPosition === "inside" && (
          <div className="pointer-events-none absolute inset-0 z-40">
            <div
              className="sticky left-0 h-full rounded-lg border-[1.5px] border-[var(--kodety-accent)]"
              style={{ width: "var(--tree-available-width)" }}
            />
          </div>
        )}

        <div className="relative z-10 flex w-full min-w-full flex-1">
          {entry.depth > 0 &&
            Array.from({ length: entry.depth }).map((_, depth) => {
              const highlighted =
                (isSelected || isChildOfSelected) &&
                highlightedDepths.includes(`,${depth},`);
              return (
                <div
                  key={depth}
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute bottom-0 top-0 z-10 w-px",
                    highlighted
                      ? "bg-white/30"
                      : isChildOfSelected || isSelected
                        ? "bg-white/10"
                        : "bg-white/[0.055]",
                  )}
                  style={{ left: depth * TREE_INDENT + 16 }}
                />
              );
            })}

          {isOver && dropPosition === "above" && (
            <DropLine position="above" depth={entry.depth} />
          )}
          {isOver && dropPosition === "below" && (
            <DropLine
              position="below"
              depth={hasVisibleChildren ? entry.depth + 1 : entry.depth}
            />
          )}

          <div
            ref={setRowElement}
            {...(isRenaming ? {} : attributes)}
            {...(isRenaming ? {} : listeners)}
            data-layer-id={node.path}
            data-layer-path={node.path}
            data-layer-can-contain={entry.canHaveChildren ? "true" : "false"}
            data-layer-locked={locked ? "true" : "false"}
            data-layer-builder-hidden={builderHidden ? "true" : undefined}
            data-layer-builder-hidden-by-parent={
              builderHiddenByParent ? "true" : undefined
            }
            data-drag-active={isDragActive}
            aria-selected={isSelected}
            className={cn(
              "group relative flex h-8 items-center outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]",
              locked
                ? cn("cursor-not-allowed", !solidAccentSelection && "opacity-60")
                : "cursor-pointer",
              isSelected ? "text-white" : "text-[var(--kodety-text-secondary)]",
              solidAccentSelection && "[&_svg]:text-current [&_svg]:opacity-100",
              isSelected && codeComponentInstance && "text-[#efffe7]",
              isSelected && componentInstance && "text-purple-50",
              isChildOfSelected && !isSelected && "text-white/70",
              isDragging && "opacity-40",
            )}
            style={{ width: "max-content", minWidth: "100%" }}
            tabIndex={0}
            onClick={(event) => {
              if (isRenaming || locked) return;
              onSelect(
                node.path,
                event.metaKey || event.ctrlKey || event.shiftKey,
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (!locked)
                  onSelect(
                    node.path,
                    event.metaKey || event.ctrlKey || event.shiftKey,
                  );
              }
              if (!hasChildren) return;
              if (event.key === "ArrowRight" && entry.collapsed) {
                event.preventDefault();
                onToggle(node.path);
              }
              if (event.key === "ArrowLeft" && !entry.collapsed) {
                event.preventDefault();
                onToggle(node.path);
              }
            }}
          >
            <div
              style={{ width: entry.depth * TREE_INDENT + 8, flex: "none" }}
            />

            <div
              className="flex flex-1 items-center"
              style={{ maxWidth: "var(--tree-available-width)" }}
            >
              {entry.canHaveChildren ? (
                hasChildren ? (
                  <button
                    type="button"
                    data-layer-action
                    aria-label={
                      entry.collapsed ? "Expandir layer" : "Recolher layer"
                    }
                    aria-expanded={!entry.collapsed}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(node.path);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center",
                      !entry.collapsed && "rotate-90",
                    )}
                  >
                    <Icon
                      name="chevronRight"
                      className={cn(
                        "size-2.5 opacity-50",
                        isSelected && "opacity-80",
                        solidAccentSelection && "opacity-100",
                      )}
                    />
                  </button>
                ) : (
                  <div className="size-4 shrink-0" />
                )
              ) : (
                <div className="flex size-4 shrink-0 items-center justify-center" />
              )}

              <HtmlLayerIcon
                node={node}
                className={cn(
                  "mx-1.5 size-3 shrink-0 text-[var(--kodety-accent)]",
                  isSelected && !componentInstance && "text-[var(--kodety-accent-hover)]",
                  solidAccentSelection && "text-white opacity-100",
                  isSelected && componentInstance && "!text-purple-200",
                )}
              />

              {isRenaming ? (
                <Input
                  ref={renameInputRef}
                  data-renaming
                  defaultValue={
                    node.attributes["data-label"] ||
                    node.attributes["data-kodety-label"] ||
                    ""
                  }
                  placeholder={presentation.name}
                  aria-label={`Renomear layer ${presentation.name}`}
                  className="mr-2 h-6 min-w-24 grow border-white/25 bg-black/25 px-1.5 text-xs text-white"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    onRenameConfirm(node.path, value || null);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      const value = event.currentTarget.value.trim();
                      onRenameConfirm(node.path, value || null);
                    }
                    if (event.key === "Escape") {
                      onRenameConfirm(
                        node.path,
                        node.attributes["data-label"] ||
                          node.attributes["data-kodety-label"] ||
                          null,
                      );
                    }
                  }}
                />
              ) : (
                <span
                  data-layer-name-source={presentation.source}
                  title={presentation.title}
                  className="min-w-0 flex-1 select-none truncate text-xs font-medium"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!body && !locked) onRenameStart(node.path);
                  }}
                >
                  {presentation.name}
                </span>
              )}
            </div>

            <div
              className="pointer-events-none absolute bottom-0 right-0 top-0 flex justify-end"
              style={{ left: entry.depth * TREE_INDENT + 44 }}
            >
              <div
                className="pointer-events-auto sticky right-0 flex h-full items-center gap-0.5 rounded-r-lg bg-(--icon-bg) px-1 group-hover/row:bg-(--icon-hover-bg)"
                style={
                  {
                    "--icon-bg": iconBg,
                    "--icon-hover-bg": iconHoverBg,
                  } as CSSProperties
                }
              >
                {scrollSectionId && (
                  <span
                    data-layer-indicator="scroll-section"
                    aria-label={`Scroll section #${scrollSectionId}`}
                    title={`Scroll section #${scrollSectionId}`}
                    className={cn(
                      "grid size-4 place-items-center font-mono text-[10px]",
                      solidAccentSelection ? "text-white" : "text-white/45",
                    )}
                  >
                    #
                  </span>
                )}
                {hasInteraction && (
                  <span
                    data-layer-indicator="interaction"
                    aria-label="Possui animação em Interactions"
                    title="Possui animação em Interactions"
                    className={cn(
                      "grid size-4 place-items-center",
                      solidAccentSelection
                        ? "text-white"
                        : "text-[var(--kodety-accent-hover)]",
                    )}
                  >
                    <ZapFill className="size-3" />
                  </span>
                )}
                {hasOverlay && (
                  <span
                    data-layer-indicator="overlay"
                    aria-label="Possui overlay conectado"
                    title="Possui overlay conectado"
                    className={cn(
                      "grid size-4 place-items-center",
                      solidAccentSelection ? "text-white" : "text-[#72b5a3]",
                    )}
                  >
                    <Layers3 className="size-3" />
                  </span>
                )}
                {directlyLocked && (
                  <Lock
                    className={cn(
                      "mx-1 size-3",
                      solidAccentSelection
                        ? "text-white opacity-100"
                        : "text-white/45",
                    )}
                    aria-label="Layer bloqueada"
                  />
                )}
                {!body && !isRenaming && builderHidden && (
                  <button
                    type="button"
                    data-layer-action
                    data-layer-indicator="builder-hidden"
                    aria-label="Mostrar no Builder"
                    title="Hidden on Builder — clique para mostrar"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleBuilderHidden(node.path, false);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    className={cn(
                      "mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--kodety-accent-hover)] opacity-70 hover:bg-white/10 hover:opacity-100",
                      solidAccentSelection && "text-white opacity-100",
                    )}
                  >
                    <EyeOff className="size-3" />
                  </button>
                )}
                {!body && !isRenaming && !builderHidden && (
                  <button
                    type="button"
                    data-layer-action
                    aria-label={
                      hidden ? "Mostrar elemento" : "Ocultar elemento"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleVisibility(node.path, hidden);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    className={cn(
                      "mr-1 shrink-0 cursor-pointer items-center justify-center rounded",
                      hidden
                        ? cn(
                            "flex size-6 opacity-60 hover:opacity-100",
                            solidAccentSelection && "opacity-100",
                          )
                        : cn(
                            "hidden size-0 group-hover/row:flex group-hover/row:size-6 group-hover/row:opacity-40 hover:opacity-100!",
                            solidAccentSelection && "group-hover/row:opacity-100!",
                          ),
                    )}
                  >
                    <Icon
                      name={hidden ? "eye-off" : "eye"}
                      className="size-3"
                    />
                  </button>
                )}
                {!body && !isRenaming && onResetComponentVariantLayerOverrides && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-layer-action
                        aria-label={`Ações da layer ${presentation.name}`}
                        title="Ações da layer"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        className={cn(
                          "hidden size-6 shrink-0 items-center justify-center rounded opacity-50 hover:bg-white/10 hover:opacity-100 group-hover/row:flex",
                          solidAccentSelection && "opacity-100",
                        )}
                      >
                        <Icon name="more" className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52">
                      <DropdownMenuItem
                        onSelect={() => onResetComponentVariantLayerOverrides(node.path)}
                      >
                        <CornerUpLeft /> Resetar overrides da layer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </HtmlLayerContextMenu>
  );
});

function EndDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: END_DROP_ID });
  if (!active) return null;
  return (
    <div ref={setNodeRef} className="relative h-8">
      {isOver && <DropLine position="above" depth={0} />}
    </div>
  );
}

export const HtmlLayersTree = memo(function HtmlLayersTree({
  nodes,
  effectiveHiddenPaths,
  search,
  width,
  selectedPath,
  selectedPaths,
  lockedPaths,
  interactionSelectors,
  canPaste,
  canPasteStyles,
  onSelect,
  onToggleVisibility,
  onToggleBuilderHidden,
  onLayerRename,
  onToggleLock,
  onRemove,
  onDuplicate,
  onCopy,
  onPaste,
  onCopyStyles,
  onPasteStyles,
  onWrap,
  onUnwrap,
  onCreateComponent,
  onEditComponent,
  onDetachComponent,
  onResetComponentVariantLayerOverrides,
  onMove,
}: HtmlLayersTreeProps) {
  const projectedNodes = useMemo(() => projectComponentLayerNodes(nodes), [nodes]);
  const effectiveHiddenPathSet = useMemo(
    () => effectiveHiddenPaths === undefined ? null : new Set(effectiveHiddenPaths),
    [effectiveHiddenPaths],
  );
  const builderHiddenDescendantPathSet = useMemo(
    () => collectBuilderHiddenDescendantPaths(projectedNodes),
    [projectedNodes],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() =>
    collectDefaultCollapsedPaths(projectedNodes),
  );
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const pointerYRef = useRef(0);
  const ghostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const previousSelectedPathRef = useRef<string | null>(null);
  const searchActive = Boolean(search.trim());
  // Resolve display identities from the complete projected tree, so filtering
  // Image_35 neither loses its displayed name nor renumbers it to Image_1.
  const imageLayerNames = useMemo(
    () => resolveHtmlImageLayerNames(projectedNodes),
    [projectedNodes],
  );
  const visibleNodes = useMemo(
    () => filterLayerNodes(projectedNodes, search, imageLayerNames),
    [imageLayerNames, projectedNodes, search],
  );
  const flattenedNodes = useMemo(
    () => flattenLayerNodes(visibleNodes, collapsedPaths, searchActive),
    [collapsedPaths, searchActive, visibleNodes],
  );
  const flattenedById = useMemo(
    () => new Map(flattenedNodes.map((entry) => [entry.id, entry])),
    [flattenedNodes],
  );
  const selectedSet = useMemo(() => {
    const next = new Set(selectedPaths);
    if (selectedPath) next.add(selectedPath);
    return next;
  }, [selectedPath, selectedPaths]);
  const selectionIndex = useMemo(() => indexHtmlLayerSelection(flattenedNodes.map(entry => ({
    path: entry.node.path,
    depth: entry.depth,
    canHaveChildren: entry.canHaveChildren,
    hasVisibleChildren: entry.node.children.length > 0 && !entry.collapsed,
  }))), [flattenedNodes]);
  const selectionData = useMemo(
    () => createHtmlLayerSelectionState(selectionIndex, selectedSet),
    [selectionIndex, selectedSet],
  );
  const highlightedDepths = selectionData.highlightedDepths;

  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => flattenedNodes[index]?.node.path ?? index,
    overscan: TREE_OVERSCAN,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (!activeId) return;
    const handlePointerMove = (event: PointerEvent) => {
      pointerYRef.current = event.clientY;
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${event.clientX + 12}px, ${event.clientY}px)`;
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ left: 0 });
  }, [search]);

  useEffect(() => {
    const path = selectedPath || selectedPaths.at(-1) || null;
    if (!path || previousSelectedPathRef.current === path) return;
    previousSelectedPathRef.current = path;
    const ancestors = findAncestorPaths(projectedNodes, path) || [];
    if (ancestors.length > 0) {
      setCollapsedPaths((current) => {
        const next = new Set(current);
        let changed = false;
        ancestors.forEach((ancestor) => {
          if (!next.delete(ancestor)) return;
          changed = true;
        });
        return changed ? next : current;
      });
    }
  }, [projectedNodes, selectedPath, selectedPaths]);

  useEffect(() => {
    const path = selectedPath || selectedPaths.at(-1);
    if (!path) return;
    const index = selectionIndex.get(path)?.index;
    if (index === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(index, { align: "auto", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectionIndex, selectedPath, selectedPaths, virtualizer]);

  const handleToggle = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleRenameConfirm = useCallback(
    (path: string, label: string | null) => {
      setRenamingPath(null);
      if (label) onLayerRename(path, label);
    },
    [onLayerRename],
  );

  const computeDropPosition = useCallback(
    (rect: { top: number; height: number }, target: FlattenedHtmlLayer) => {
      if (target.node.tag.toLowerCase() === "body") return "inside" as const;
      const offset = pointerYRef.current - rect.top;
      const ratio = Math.max(0, Math.min(1, offset / Math.max(1, rect.height)));
      return calcDropPosition(
        ratio,
        target.canHaveChildren,
        target.node.children.length > 0 && !target.collapsed,
      );
    },
    [],
  );

  const validDrop = useCallback(
    (
      source: FlattenedHtmlLayer,
      target: FlattenedHtmlLayer,
      position: DropPosition,
    ) => {
      if (
        target.node.path === source.node.path ||
        target.node.path.startsWith(`${source.node.path}/`)
      )
        return false;
      if (position === "inside" && !target.canHaveChildren) return false;
      if (
        position === "inside" &&
        lockedPaths.some(
          (locked) =>
            target.node.path === locked ||
            target.node.path.startsWith(`${locked}/`),
        )
      )
        return false;
      return true;
    },
    [lockedPaths],
  );

  const updateDragOver = useCallback(
    (
      overIdValue: string | null,
      rect: { top: number; height: number } | null,
    ) => {
      if (!activeId || !overIdValue) {
        setOverId(null);
        setDropPosition(null);
        return;
      }
      if (overIdValue === END_DROP_ID) {
        setOverId(END_DROP_ID);
        setDropPosition("below");
        return;
      }
      const source = flattenedById.get(activeId);
      const target = flattenedById.get(overIdValue);
      if (!source || !target || !rect) {
        setOverId(null);
        setDropPosition(null);
        return;
      }
      const position = computeDropPosition(rect, target);
      if (!validDrop(source, target, position)) {
        setOverId(null);
        setDropPosition(null);
        return;
      }
      setOverId(overIdValue);
      setDropPosition(position);
    },
    [activeId, computeDropPosition, flattenedById, validDrop],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      const entry = flattenedById.get(id);
      if (!entry || entry.node.tag.toLowerCase() === "body") return;
      setActiveId(id);
      onSelect(entry.node.path);
    },
    [flattenedById, onSelect],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      updateDragOver(
        event.over ? String(event.over.id) : null,
        event.over?.rect || null,
      );
    },
    [updateDragOver],
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      updateDragOver(
        event.over ? String(event.over.id) : null,
        event.over?.rect || null,
      );
    },
    [updateDragOver],
  );

  const resetDrag = useCallback(() => {
    setActiveId(null);
    setOverId(null);
    setDropPosition(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const source = flattenedById.get(String(event.active.id));
      if (!source || !event.over || !dropPosition) {
        resetDrag();
        return;
      }
      const targetId = String(event.over.id);
      if (targetId === END_DROP_ID) {
        const body = flattenedNodes.find(
          (entry) => entry.node.tag.toLowerCase() === "body",
        );
        const bodyChildren = body
          ? flattenedNodes.filter(
              (entry) => entry.parentPath === body.node.path,
            )
          : [];
        const lastChild = bodyChildren.at(-1);
        if (lastChild && lastChild.node.path !== source.node.path)
          onMove(source.node.path, lastChild.node.path, "after");
        else if (body) onMove(source.node.path, body.node.path, "inside");
        resetDrag();
        return;
      }
      const target = flattenedById.get(targetId);
      if (target && validDrop(source, target, dropPosition)) {
        onMove(
          source.node.path,
          target.node.path,
          dropPosition === "above"
            ? "before"
            : dropPosition === "below"
              ? "after"
              : "inside",
        );
      }
      resetDrag();
    },
    [dropPosition, flattenedById, flattenedNodes, onMove, resetDrag, validDrop],
  );

  const maxDepth = useMemo(
    () =>
      flattenedNodes.reduce(
        (maximum, entry) => Math.max(maximum, entry.depth),
        0,
      ),
    [flattenedNodes],
  );
  const treeAvailableWidth = Math.max(0, width - 16);
  const activeEntry = activeId ? flattenedById.get(activeId) || null : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirstCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDrag}
    >
      <div
        ref={scrollRef}
        data-ycode-layers-tree
        className="h-full min-h-0 overflow-auto bg-[var(--kodety-panel)] pb-2 no-scrollbar"
        style={
          {
            "--tree-available-width": `${treeAvailableWidth}px`,
          } as CSSProperties
        }
      >
        {flattenedNodes.length > 0 ? (
          <div
            ref={wrapperRef}
            data-layer-virtual-list
            className="relative"
            style={{
              height: virtualizer.getTotalSize(),
              minWidth:
                maxDepth > 0
                  ? maxDepth * TREE_INDENT + 8 + treeAvailableWidth
                  : undefined,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = flattenedNodes[virtualRow.index];
              const data = selectionData.get(entry.node.path)!;
              const directlyLocked = lockedPaths.includes(entry.node.path);
              const lockedByParent = lockedPaths.some(
                (path) =>
                  path !== entry.node.path &&
                  entry.node.path.startsWith(`${path}/`),
              );
              const locked = directlyLocked || lockedByParent;
              return (
                <VirtualLayerRow
                  key={entry.node.path}
                  id={entry.id}
                  disabled={
                    renamingPath === entry.node.path ||
                    locked ||
                    entry.node.tag.toLowerCase() === "body"
                  }
                  translateY={virtualRow.start}
                >
                  <HtmlLayerRow
                    entry={entry}
                    effectiveHidden={
                      effectiveHiddenPathSet === null
                        ? undefined
                        : effectiveHiddenPathSet.has(entry.node.path)
                    }
                    builderHiddenByParent={builderHiddenDescendantPathSet.has(
                      entry.node.path,
                    )}
                    isSelected={data.isSelected}
                    isChildOfSelected={data.isChildOfSelected}
                    isLastVisibleDescendant={data.isLastVisibleDescendant}
                    hasVisibleChildren={data.hasVisibleChildren}
                    isOver={overId === entry.id}
                    isDragging={activeId === entry.id}
                    isDragActive={Boolean(activeId)}
                    dropPosition={overId === entry.id ? dropPosition : null}
                    highlightedDepths={
                      data.isSelected || data.isChildOfSelected
                        ? highlightedDepths
                        : ",,"
                    }
                    directlyLocked={directlyLocked}
                    lockedByParent={lockedByParent}
                    locked={locked}
                    imageLayerName={imageLayerNames.get(entry.node.path) || ""}
                    interactionSelectors={interactionSelectors}
                    canPaste={canPaste}
                    canPasteStyles={canPasteStyles}
                    isRenaming={renamingPath === entry.node.path}
                    onSelect={onSelect}
                    onToggle={handleToggle}
                    onToggleVisibility={onToggleVisibility}
                    onToggleBuilderHidden={onToggleBuilderHidden}
                    onRenameStart={setRenamingPath}
                    onRenameConfirm={handleRenameConfirm}
                    onToggleLock={onToggleLock}
                    onRemove={onRemove}
                    onDuplicate={onDuplicate}
                    onCopy={onCopy}
                    onPaste={onPaste}
                    onCopyStyles={onCopyStyles}
                    onPasteStyles={onPasteStyles}
                    onWrap={onWrap}
                    onUnwrap={onUnwrap}
                    onCreateComponent={onCreateComponent}
                    onEditComponent={onEditComponent}
                    onDetachComponent={onDetachComponent}
                    onResetComponentVariantLayerOverrides={onResetComponentVariantLayerOverrides}
                    onMove={onMove}
                  />
                </VirtualLayerRow>
              );
            })}
            <div
              className="absolute left-0 w-full"
              style={{ top: virtualizer.getTotalSize() }}
            >
              <EndDropZone active={Boolean(activeId)} />
            </div>
          </div>
        ) : (
          <p
            role="status"
            className="px-3 py-8 text-center text-[10px] leading-4 text-[var(--kodety-text-tertiary)]"
          >
            Nenhuma layer encontrada.
          </p>
        )}
      </div>

      <DragOverlay dropAnimation={null}>{null}</DragOverlay>
      {activeEntry && (
        <div
          ref={ghostRef}
          className="pointer-events-none fixed left-0 top-0 z-[300] flex h-8 items-center rounded-lg border border-[var(--kodety-accent-hover)]/30 bg-[linear-gradient(rgb(147_147_255/.14),rgb(147_147_255/.14)),rgb(20_20_22/.94)] px-2 text-xs font-medium text-[var(--kodety-accent-hover)] shadow-xl backdrop-blur-sm"
          style={{ transform: "translate(-9999px, -9999px)" }}
        >
          <HtmlLayerIcon
            node={activeEntry.node}
            className="mr-2 size-3 shrink-0 text-[var(--kodety-accent-hover)]"
          />
          <span className="max-w-52 truncate">
            {
              resolveHtmlLayerPresentation(
                activeEntry.node,
                getHtmlElementTypeName(activeEntry.node),
                imageLayerNames.get(activeEntry.node.path) || undefined,
              ).name
            }
          </span>
        </div>
      )}
    </DndContext>
  );
});
