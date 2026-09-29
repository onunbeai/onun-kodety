"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BoxSelect,
  Braces,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  CornerUpLeft,
  Copy,
  EyeOff,
  FileCode2,
  FileJson2,
  FileText,
  FileType2,
  Filter,
  FlaskConical,
  Folder,
  FolderOpen,
  Globe2,
  Home,
  Image,
  LayoutTemplate,
  Layers3,
  Languages,
  LockKeyhole,
  Loader2,
  Minimize2,
  MoreHorizontal,
  Paintbrush,
  PanelTopOpen,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  UnlockKeyhole,
  Upload,
  Zap,
} from "@/components/ui/gravity-icons";
import type { EditorElement, HtmlProjectFile } from "@/lib/html-editor/types";
import type { HtmlPagePublicationStatus } from "@/lib/html-editor/project-io";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import Icon from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisclosureChevron } from "@/components/ui/disclosure-summary";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileIcon } from "@solar-icons/react/bold-duotone/file";
import { GalleryRoundIcon } from "@solar-icons/react/bold-duotone/gallery-round";
import { LayersMinimalisticIcon } from "@solar-icons/react/bold-duotone/layers-minimalistic";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ElementDropPosition } from "@/lib/html-editor/source-patcher";
import type { HtmlExperimentPageGroup } from "@/lib/html-editor/experiments";
import type { BuilderTemplateProvider } from "@/lib/html-editor/editor-types";
import { localeFlagAssetUrl } from "@/lib/html-editor/locale-flag-assets";
import {
  assetTreeFolderIds,
  filterAssetTree,
  type AssetTreeDivergence,
  type AssetTreeFileFilter,
  type AssetTreeFolderNode,
  type AssetTreeNode,
} from "@/lib/html-editor/asset-tree";
import {
  isCompressibleProjectImage,
  isConvertibleProjectImage,
  projectImageByteLength,
  type ImageCompressionOptions,
  type ImageCompressionSummary,
  type ImageConversionFormat,
  type ImageConversionOptions,
  type ImageConversionSummary,
} from "@/lib/html-editor/image-compression";
import {
  materializeHtmlNavigatorModel,
  useHtmlNavigatorStore,
} from "@/stores/useHtmlNavigatorStore";
import { HtmlLayersTree } from "./HtmlLayersTree";
import {
  buildHtmlPageTree,
  canDropHtmlPageTreeItem,
  filterHtmlPageTree,
  flattenHtmlPageTree,
  htmlFolderParent,
  htmlPageNodeFolder,
  htmlPageParentFolder,
  renameHtmlFolderDestination,
  type HtmlPageTreeDragItem,
  type HtmlPageTreeNode,
} from "@/lib/html-editor/page-tree";

export type HtmlNavigatorActivePanel = "layers" | "pages" | "assets";

interface ImageOptimizationAccess {
  compressionLocked: boolean;
  conversionLocked: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
  onActivate?: () => void;
}

interface HtmlNavigatorLocale {
  code: string;
  name: string;
  language: string;
  region?: string;
  enabled: boolean;
}

function navigatorLocaleRegion(locale: HtmlNavigatorLocale) {
  const explicit = locale.region?.trim().toUpperCase() || "";
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  try {
    const inferred = new Intl.Locale(locale.code).maximize().region?.toUpperCase() || "";
    return /^[A-Z]{2}$/.test(inferred) ? inferred : "";
  } catch {
    return "";
  }
}

function NavigatorLocaleFlag({
  locale,
  className,
}: {
  locale?: HtmlNavigatorLocale;
  className?: string;
}) {
  if (!locale) return null;
  const assetUrl = localeFlagAssetUrl(navigatorLocaleRegion(locale));
  if (!assetUrl) {
    return (
      <Globe2
        data-kodety-locale-flag={locale.code}
        className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      data-kodety-locale-flag={locale.code}
      src={assetUrl}
      alt=""
      className={cn("h-3.5 w-[19px] shrink-0 rounded-[2px] object-cover", className)}
      draggable={false}
      aria-hidden="true"
    />
  );
}

export interface HtmlNavigatorProps {
  width: number;
  activePanel: HtmlNavigatorActivePanel;
  nodes: EditorElement[];
  /** Complete effective hidden set reported by the active painted canvas. */
  effectiveHiddenPaths?: string[];
  selectedPath: string | null;
  selectedPaths: string[];
  onSelect: (path: string, additive?: boolean) => void;
  locales?: HtmlNavigatorLocale[];
  activeLocale?: string;
  sourceLocale?: string;
  onLocaleChange?: (code: string) => void;
  onResetLocalePage?: (code: string) => void;
  localizationUrl?: string;
  pages: string[];
  pageExperimentGroups?: HtmlExperimentPageGroup[];
  activeExperimentId?: string;
  activeExperimentVariantId?: string;
  activePage: string;
  /** Optimistic selection shown while the canonical page canvas is loading. */
  visualActivePage?: string;
  homePage: string;
  pagePublicationStatuses: Record<string, HtmlPagePublicationStatus>;
  onPageSelect: (path: string) => void;
  onExperimentVariantSelect?: (experimentId: string, variantId: string) => void;
  onPageSetHome: (path: string) => void;
  onPagePublicationStatusChange: (path: string, status: HtmlPagePublicationStatus) => void;
  pageTemplateCollections: Array<{ slug: string; name: string }>;
  pageTemplates: Record<string, string>;
  onPageSetTemplate: (path: string, postType: string) => void;
  onPageRemoveTemplate: (postType: string) => void;
  templateProviders: BuilderTemplateProvider[];
  onPageSetExtensionTemplate: (providerId: string, path: string) => void;
  onPageRemoveExtensionTemplate: (providerId: string) => void;
  onPageAdd: () => void;
  onPageDuplicate: (path: string) => void;
  onPageRename: (path: string, nextPath: string) => void;
  onPageMove: (path: string, targetFolder: string) => void;
  onPageFolderMove: (folderPath: string, targetFolder: string) => void;
  onPageFolderRename: (folderPath: string, nextFolderPath: string) => void;
  onPageConvertFolder: (folderPath: string) => void;
  onPageRemove: (path: string) => void;
  onPageSettings: (path: string) => void;
  onPageOpenCode: (path: string) => void;
  assets: HtmlProjectFile[];
  onAssetReplace: (path: string, file: File) => void;
  onAssetAdd: (files: File[]) => void;
  onAssetRemove: (path: string) => void;
  imageOptimizationAccess: ImageOptimizationAccess;
  onAssetCompress: (
    paths: string[],
    options: ImageCompressionOptions,
  ) => Promise<ImageCompressionSummary>;
  convertibleAssetCount: number;
  convertibleAssetBytes: number;
  onAssetConvert: (
    paths: string[] | null,
    options: ImageConversionOptions,
  ) => Promise<ImageConversionSummary>;
  lockedPaths: string[];
  onToggleLock: (path: string) => void;
  onToggleVisibility: (path: string, visible: boolean) => void;
  onToggleBuilderHidden: (path: string, hidden: boolean) => void;
  onLayerRename: (path: string, label: string) => void;
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
  canPaste: boolean;
  canPasteStyles: boolean;
  onMove: (
    sourcePath: string,
    targetPath: string,
    position: ElementDropPosition,
  ) => void;
  interactionSelectors?: string[];
  assetTree: AssetTreeNode[];
  experimentAssetFolders: AssetTreeFolderNode[];
  activeCodeFile: string;
  onFileOpen: (path: string) => void;
  onFileCreate: (path: string) => void;
  onFileRename: (path: string, nextPath: string) => void;
  onFileRemove: (path: string) => void;
  componentVariantsSection?: ReactNode;
}

export type HtmlNavigatorBridgeProps = Omit<HtmlNavigatorProps, "activePanel"> & {
  /** Temporary compatibility input while the editor rail migrates to the store. */
  activePanel?: HtmlNavigatorActivePanel;
};

const DIVERGENCE_LABELS: Record<AssetTreeDivergence, string> = {
  added: "novo",
  changed: "alterado",
  removed: "removido",
};

const PROJECT_FILE_FILTERS: Array<{
  value: AssetTreeFileFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "javascript", label: "JS" },
  { value: "svg", label: "SVG" },
  { value: "image", label: "Imagens" },
  { value: "video", label: "Vídeos" },
  { value: "audio", label: "Áudio" },
  { value: "font", label: "Webfonts" },
  { value: "json", label: "JSON" },
  { value: "other", label: "Outros" },
];

const PROJECT_FILE_FILTER_LABELS = Object.fromEntries(
  PROJECT_FILE_FILTERS.map((filter) => [filter.value, filter.label]),
) as Record<AssetTreeFileFilter, string>;

function AssetTreeRow({
  node,
  depth,
  collapsed,
  forceExpanded,
  onToggle,
  activeCodeFile,
  search,
  onFileOpen,
  onFileRename,
  onFileRemove,
}: {
  node: AssetTreeNode;
  depth: number;
  collapsed: Set<string>;
  forceExpanded: boolean;
  onToggle: (id: string) => void;
  activeCodeFile: string;
  search: string;
  onFileOpen: (path: string) => void;
  onFileRename: (path: string, nextPath: string) => void;
  onFileRemove: (path: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node.name);
  useEffect(() => {
    setRenameDraft(node.name);
    setRenaming(false);
  }, [node.name, node.path]);
  const startRename = () => {
    if (node.kind !== "file" || node.file?.text === undefined) return;
    setRenameDraft(node.name);
    setRenaming(true);
  };
  const finishRename = () => {
    const name = renameDraft.trim().replaceAll("\\", "/");
    setRenaming(false);
    if (!name || name === node.name || name.includes("/")) return;
    const parent = node.path.split("/").slice(0, -1).join("/");
    onFileRename(node.path, parent ? `${parent}/${name}` : name);
  };
  const indent = { paddingLeft: `${depth * 12 + 8}px` };
  if (node.kind === "folder") {
    const open = forceExpanded || !collapsed.has(node.id);
    return (
      <div>
        <button
          type="button"
          style={indent}
          aria-expanded={open}
          onClick={() => onToggle(node.id)}
          className="flex h-7 w-full items-center gap-1.5 rounded-[5px] pr-2 text-left text-[11px] text-[var(--kodety-text-secondary)] outline-none hover:bg-white/[0.035] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          {node.variantId ? (
            <FlaskConical className="size-3.5 shrink-0 text-purple-400" />
          ) : open ? (
            <FolderOpen className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 text-[9px] tabular-nums text-[var(--kodety-text-tertiary)]">
            {node.fileCount}
          </span>
        </button>
        {open &&
          node.children.map((child) => (
            <AssetTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              forceExpanded={forceExpanded}
              onToggle={onToggle}
              activeCodeFile={activeCodeFile}
              search={search}
              onFileOpen={onFileOpen}
              onFileRename={onFileRename}
              onFileRemove={onFileRemove}
            />
          ))}
      </div>
    );
  }

  const editable = node.file?.text !== undefined;
  const matches =
    search && node.file?.text
      ? node.file.text.toLowerCase().split(search).length - 1
      : 0;
  return (
    <div className="group/file relative">
      {renaming ? (
        <div
          style={indent}
          className="flex h-7 w-full items-center gap-2 rounded-[5px] pr-8 text-[11px] text-[var(--kodety-text)]"
        >
          <ProjectFileIcon path={node.name} />
          <Input
            autoFocus
            value={renameDraft}
            aria-label={`Renomear ${node.name}`}
            className="h-6 min-w-0 flex-1 rounded-[4px] border-[var(--kodety-accent-hover)]/60 bg-black/25 px-1.5 text-[11px]"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setRenameDraft(node.name);
                setRenaming(false);
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          style={indent}
          disabled={!editable}
          onClick={() => editable && onFileOpen(node.path)}
          onDoubleClick={startRename}
          className={cn(
              "flex h-7 w-full items-center gap-2 rounded-[5px] pr-8 text-left text-[11px] text-[var(--kodety-text-secondary)] outline-none hover:bg-white/[0.035] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)] disabled:cursor-default disabled:opacity-55",
            activeCodeFile === node.path &&
              "bg-[var(--kodety-control-active)] text-[var(--kodety-text)]",
          )}
          title={
            node.divergence === "removed"
              ? `${node.name} não existe nesta variante`
              : editable
                ? `Abrir ${node.path} · duplo clique para renomear`
                : "Arquivo binário"
          }
        >
          <ProjectFileIcon path={node.name} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.divergence && (
            <span
              className={cn(
                "shrink-0 rounded-[3px] px-1 text-[8px] font-medium uppercase tracking-wide",
                node.divergence === "removed"
                  ? "bg-red-500/15 text-red-300"
                  : node.divergence === "added"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300",
              )}
            >
              {DIVERGENCE_LABELS[node.divergence]}
            </span>
          )}
          {matches > 0 && (
            <span className="shrink-0 text-[9px] tabular-nums text-[var(--kodety-accent-hover)]">
              {matches}
            </span>
          )}
        </button>
      )}
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações de ${node.path}`}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[5px] text-[var(--kodety-text-tertiary)] opacity-0 outline-none hover:bg-white/[0.06] hover:text-[var(--kodety-text)] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)] group-hover/file:opacity-100 data-[state=open]:bg-white/[0.06] data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-44">
            <DropdownMenuItem
              onClick={startRename}
            >
              <Pencil /> Renomear
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onFileRemove(node.path)}
            >
              <Trash2 /> Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ProjectFileIcon({ path }: { path: string }) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "json" || extension === "map")
    return <FileJson2 className="size-3.5 text-amber-400" />;
  if (["js", "mjs", "cjs", "ts", "tsx", "jsx"].includes(extension || ""))
    return <Braces className="size-3.5 text-yellow-400" />;
  if (extension === "css")
    return <FileType2 className="size-3.5 text-[var(--kodety-accent-hover)]" />;
  if (extension === "html" || extension === "htm" || extension === "svg")
    return <FileCode2 className="size-3.5 text-orange-400" />;
  return <FileCode2 className="size-3.5 text-muted-foreground" />;
}

function playAssetVideoPreview(video: HTMLVideoElement) {
  const playback = video.play();
  if (playback) void playback.catch(() => undefined);
}

function stopAssetVideoPreview(video: HTMLVideoElement) {
  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    // Some browsers reject seeking until metadata is available.
  }
}

function AssetPreview({ file }: { file: HtmlProjectFile }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const content = file.text ?? file.data ?? new Uint8Array();
    const hasContent =
      typeof content === "string" ? content.length > 0 : content.byteLength > 0;
    if (!hasContent) {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([content as BlobPart], { type: file.mimeType }),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;

  if (file.mimeType.startsWith("image/")) {
    return (
      // Blob URLs are local project files and cannot use Next's remote image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="size-full object-contain" />
    );
  }
  if (file.mimeType.startsWith("video/")) {
    return (
      <video
        src={url}
        muted
        loop
        playsInline
        preload="metadata"
        onPointerEnter={(event) => playAssetVideoPreview(event.currentTarget)}
        onPointerLeave={(event) => stopAssetVideoPreview(event.currentTarget)}
        className="size-full object-contain"
      />
    );
  }
  if (file.mimeType.startsWith("audio/")) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 px-2 text-zinc-400">
        <Icon name="audio" className="size-5" />
        <audio src={url} controls className="h-7 w-full" />
      </div>
    );
  }
  if (file.mimeType.startsWith("font/")) {
    return <Icon name="type" className="size-6 text-zinc-400" />;
  }
  return <FileCode2 className="size-6 text-zinc-400" />;
}

function isVisualAsset(file: HtmlProjectFile) {
  const hasContent =
    file.text !== undefined
      ? file.text.length > 0
      : Boolean(file.data?.byteLength);
  return (
    hasContent &&
    (file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/"))
  );
}

function CompactAssetCard({
  file,
  onReplace,
  onCompress,
  onConvert,
  onRemove,
}: {
  file: HtmlProjectFile;
  onReplace: (file: File) => void;
  onCompress?: () => void;
  onConvert?: () => void;
  onRemove: () => void;
}) {
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const name = file.path.split("/").pop() || file.path;

  return (
    <div className="group/asset overflow-hidden rounded-[7px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] transition-colors hover:border-[var(--kodety-divider-strong)]">
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-black/20 text-[var(--kodety-text-tertiary)]">
        <AssetPreview file={file} />
      </div>
      <div className="relative flex h-7 items-center px-2 pr-8">
        <span
          className="min-w-0 flex-1 truncate text-[10px] text-foreground/85"
          title={file.path}
        >
          {name}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações de ${name}`}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[5px] text-[var(--kodety-text-tertiary)] opacity-0 outline-none transition-colors hover:bg-white/[0.06] hover:text-[var(--kodety-text)] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)] group-hover/asset:opacity-100 data-[state=open]:bg-white/[0.06] data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-44">
            <DropdownMenuItem
              onSelect={() => replacementInputRef.current?.click()}
            >
              <Upload /> Substituir
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void navigator.clipboard?.writeText(file.path)}
            >
              <Clipboard /> Copiar caminho
            </DropdownMenuItem>
            {onCompress && (
              <DropdownMenuItem onSelect={onCompress}>
                <Minimize2 /> Comprimir imagem
              </DropdownMenuItem>
            )}
            {onConvert && (
              <DropdownMenuItem onSelect={onConvert}>
                <ArrowRight /> Converter formato…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 /> Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input
        ref={replacementInputRef}
        type="file"
        className="sr-only"
        accept={file.mimeType || undefined}
        onChange={(event) => {
          const replacement = event.target.files?.[0];
          if (replacement) onReplace(replacement);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

function ImageCompressionDialog({
  files,
  locked,
  licenseUrl,
  upgradeUrl,
  onActivate,
  onOpenChange,
  onCompress,
}: {
  files: HtmlProjectFile[];
  locked: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
  onActivate?: () => void;
  onOpenChange: (open: boolean) => void;
  onCompress: (
    options: ImageCompressionOptions,
  ) => Promise<ImageCompressionSummary>;
}) {
  const [quality, setQuality] = useState(82);
  const [preserveDimensions, setPreserveDimensions] = useState(true);
  const [maxDimension, setMaxDimension] = useState(1920);
  const [compressing, setCompressing] = useState(false);
  const totalBytes = files.reduce(
    (total, file) => total + projectImageByteLength(file),
    0,
  );
  const singleName =
    files.length === 1
      ? files[0].path.split("/").pop() || files[0].path
      : null;

  const runCompression = async () => {
    if (!files.length || compressing) return;
    setCompressing(true);
    try {
      const summary = await onCompress({
        quality,
        maxDimension: preserveDimensions
          ? null
          : Math.max(320, Math.min(8192, Math.round(maxDimension) || 1920)),
      });
      // Keep the controls available after a no-op so the author can lower the
      // quality or limit dimensions without having to select every file again.
      if (summary.compressed > 0) onOpenChange(false);
    } catch {
      // The project callback already reports the actionable error and the
      // dialog stays open so the author can retry with different settings.
    } finally {
      setCompressing(false);
    }
  };

  return (
    <Dialog
      open={files.length > 0}
      onOpenChange={(open) => {
        if (!compressing) onOpenChange(open);
      }}
    >
      <DialogContent
        className="w-[480px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden border-white/[0.1] bg-[#171717] p-0 shadow-2xl"
        showCloseButton={!compressing}
        onEscapeKeyDown={(event) => {
          if (compressing) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (compressing) event.preventDefault();
        }}
      >
        <div className="border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2">
            <Minimize2 className="size-4 text-zinc-300" />
            <DialogTitle className="text-[14px] font-semibold text-white">
              Comprimir {files.length === 1 ? "imagem" : "imagens"}
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1.5 text-[11px] leading-4 text-zinc-400">
            {singleName
              ? `${singleName} · ${formatFileSize(totalBytes)}`
              : `${files.length} imagens · ${formatFileSize(totalBytes)} no total`}
          </DialogDescription>
        </div>

        <div className="space-y-5 p-5">
          <section className="space-y-2.5">
            <div>
              <div>
                <p className="text-[11px] font-medium text-zinc-200">
                  Qualidade máxima
                </p>
                <p className="mt-0.5 text-[9px] leading-3.5 text-zinc-500">
                  JPEG e WebP começam neste valor e reduzem gradualmente só
                  quando necessário para gerar um arquivo menor. PNG continua
                  sem perda.
                </p>
              </div>
            </div>
            <Slider
              value={[quality]}
              min={40}
              max={100}
              step={1}
              unit="%"
              disabled={compressing}
              aria-label="Qualidade máxima"
              onValueChange={(values) => setQuality(values[0] || 82)}
            />
            <div className="flex justify-between text-[8px] text-zinc-600">
              <span>Arquivo menor</span>
              <span>Mais fidelidade</span>
            </div>
          </section>

          <section className="rounded-[9px] border border-white/[0.08] bg-white/[0.02] px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-zinc-200">
                  Preservar dimensões originais
                </p>
                <p className="mt-0.5 text-[9px] leading-3.5 text-zinc-500">
                  Desative para limitar imagens muito grandes.
                </p>
              </div>
              <Switch
                size="sm"
                checked={preserveDimensions}
                disabled={compressing}
                onCheckedChange={setPreserveDimensions}
                aria-label="Preservar dimensões originais"
              />
            </div>
            {!preserveDimensions && (
              <label className="mt-3 flex items-center gap-3 border-t border-white/[0.06] pt-3">
                <span className="min-w-0 flex-1 text-[10px] text-zinc-400">
                  Lado maior, no máximo
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={320}
                    max={8192}
                    step={160}
                    value={maxDimension}
                    disabled={compressing}
                    disableKeyboardStep
                    aria-label="Limite do lado maior em pixels"
                    onChange={(event) =>
                      setMaxDimension(Number(event.target.value))
                    }
                    className="h-7 w-20 border-white/[0.09] bg-black/20 px-2 text-right text-[10px] tabular-nums"
                  />
                  <span className="text-[9px] text-zinc-500">px</span>
                </div>
              </label>
            )}
          </section>

          <div className="flex gap-2 rounded-[9px] border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            <p className="text-[9px] leading-4 text-amber-100/70">
              Os bytes originais serão substituídos, mantendo formato e caminho.
              Imagens animadas e resultados maiores serão ignorados. Você pode
              desfazer a operação pelo histórico do Builder.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={compressing}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!files.length || compressing}
            onClick={() => void runCompression()}
          >
            {compressing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Minimize2 />
            )}
            {compressing
              ? "Comprimindo…"
              : `Comprimir ${files.length === 1 ? "imagem" : `${files.length} imagens`}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageConversionDialog({
  files,
  totalCount,
  totalBytes,
  entireProject,
  locked,
  licenseUrl,
  upgradeUrl,
  onActivate,
  onOpenChange,
  onConvert,
}: {
  files: HtmlProjectFile[];
  totalCount: number;
  totalBytes: number;
  entireProject: boolean;
  locked: boolean;
  licenseUrl?: string;
  upgradeUrl?: string;
  onActivate?: () => void;
  onOpenChange: (open: boolean) => void;
  onConvert: (
    options: ImageConversionOptions,
  ) => Promise<ImageConversionSummary>;
}) {
  const [format, setFormat] = useState<ImageConversionFormat>("webp");
  const [quality, setQuality] = useState(82);
  const [preserveDimensions, setPreserveDimensions] = useState(true);
  const [maxDimension, setMaxDimension] = useState(1920);
  const [converting, setConverting] = useState(false);
  const singleName =
    files.length === 1
      ? files[0].path.split("/").pop() || files[0].path
      : null;

  const selectFormat = (next: ImageConversionFormat) => {
    setFormat(next);
    setQuality(next === "avif" ? 68 : 82);
  };

  const runConversion = async () => {
    if (!totalCount || converting) return;
    setConverting(true);
    try {
      await onConvert({
        format,
        quality,
        maxDimension: preserveDimensions
          ? null
          : Math.max(320, Math.min(8192, Math.round(maxDimension) || 1920)),
      });
      onOpenChange(false);
    } catch {
      // The project callback reports the collision/encoding error. Keeping the
      // dialog open lets the author adjust the operation and retry.
    } finally {
      setConverting(false);
    }
  };

  return (
    <Dialog
      open={totalCount > 0}
      onOpenChange={(open) => {
        if (!converting) onOpenChange(open);
      }}
    >
      <DialogContent
        className="w-[520px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden border-white/[0.1] bg-[#171717] p-0 shadow-2xl"
        showCloseButton={!converting}
        onEscapeKeyDown={(event) => {
          if (converting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (converting) event.preventDefault();
        }}
      >
        <div className="border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowRight className="size-4 text-zinc-300" />
            <DialogTitle className="text-[14px] font-semibold text-white">
              Converter formato
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1.5 text-[11px] leading-4 text-zinc-400">
            {singleName
              ? `${singleName} · ${formatFileSize(totalBytes)}`
              : `${totalCount} imagens · ${formatFileSize(totalBytes)} no total`}
          </DialogDescription>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Novo formato
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                {
                  value: "webp",
                  title: "WebP",
                  badge: "Recomendado",
                  description:
                    "Compatibilidade ampla e conversão mais rápida.",
                },
                {
                  value: "avif",
                  title: "AVIF",
                  badge: "Menor arquivo",
                  description:
                    "Compressão mais eficiente; processamento mais demorado.",
                },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={converting}
                  onClick={() => selectFormat(option.value)}
                  className={cn(
                    "rounded-[9px] border p-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]",
                    format === option.value
                      ? "border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/[0.09]"
                      : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-zinc-100">
                      {option.title}
                    </span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                      {option.badge}
                    </span>
                  </div>
                  <span className="mt-1.5 block text-[9px] leading-3.5 text-zinc-500">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <div>
              <div>
                <p className="text-[11px] font-medium text-zinc-200">
                  Qualidade preservada
                </p>
                <p className="mt-0.5 text-[9px] leading-3.5 text-zinc-500">
                  Equilibra fidelidade visual e tamanho final.
                </p>
              </div>
            </div>
            <Slider
              value={[quality]}
              min={40}
              max={100}
              step={1}
              unit="%"
              disabled={converting}
              aria-label="Qualidade da conversão"
              onValueChange={(values) => setQuality(values[0] || 82)}
            />
          </section>

          <section className="rounded-[9px] border border-white/[0.08] bg-white/[0.02] px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-zinc-200">
                  Preservar dimensões originais
                </p>
                <p className="mt-0.5 text-[9px] leading-3.5 text-zinc-500">
                  Desative para limitar imagens muito grandes.
                </p>
              </div>
              <Switch
                size="sm"
                checked={preserveDimensions}
                disabled={converting}
                onCheckedChange={setPreserveDimensions}
                aria-label="Preservar dimensões na conversão"
              />
            </div>
            {!preserveDimensions && (
              <label className="mt-3 flex items-center gap-3 border-t border-white/[0.06] pt-3">
                <span className="min-w-0 flex-1 text-[10px] text-zinc-400">
                  Lado maior, no máximo
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={320}
                    max={8192}
                    step={160}
                    value={maxDimension}
                    disabled={converting}
                    disableKeyboardStep
                    aria-label="Limite do lado maior na conversão"
                    onChange={(event) =>
                      setMaxDimension(Number(event.target.value))
                    }
                    className="h-7 w-20 border-white/[0.09] bg-black/20 px-2 text-right text-[10px] tabular-nums"
                  />
                  <span className="text-[9px] text-zinc-500">px</span>
                </div>
              </label>
            )}
          </section>

          <div className="flex gap-2 rounded-[9px] border border-amber-400/15 bg-amber-400/[0.055] px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            <p className="text-[9px] leading-4 text-amber-100/70">
              {entireProject
                ? "A conversão cobre o projeto inteiro, inclusive variantes A/B. "
                : ""}
              A extensão será trocada em HTML, CSS, JavaScript, srcset,
              metadados e canvas. O lote só é aplicado se todas as conversões
              terminarem; animações são preservadas no formato original.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={converting}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!totalCount || converting}
            onClick={() => void runConversion()}
          >
            {converting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <ArrowRight />
            )}
            {converting
              ? `Convertendo para ${format.toUpperCase()}…`
              : `Converter para ${format.toUpperCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getPageDisplayName(path: string, homePage: string) {
  if (path === homePage) return "Home";
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1)?.replace(/\.html?$/i, "") || path;
  // Folder-based pages are stored as `about/index.html`. Showing every one
  // of them as “index” makes the Pages panel ambiguous, especially once an
  // A/B group is nested under its source page.
  return fileName.toLowerCase() === "index" && segments.length > 1
    ? segments.at(-2) || fileName
    : fileName;
}

function inlinePageRenamePath(path: string, value: string) {
  const requested = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!requested) return "";
  if (requested.includes("/") || /\.html?$/i.test(requested)) return requested;
  const segments = path.split("/").filter(Boolean);
  const fileName = segments.at(-1) || "index.html";
  const extension = fileName.match(/(\.html?)$/i)?.[1] || ".html";
  if (/^index\.html?$/i.test(fileName) && segments.length > 1) {
    segments[segments.length - 2] = requested;
    return segments.join("/");
  }
  segments[segments.length - 1] = `${requested}${extension}`;
  return segments.join("/");
}

interface PageRowProps {
  path: string;
  depth: number;
  hasHierarchyChildren: boolean;
  hierarchyExpanded: boolean;
  onToggleHierarchy: () => void;
  moveTargets: Array<{ label: string; folderPath: string }>;
  activePage: string;
  visualActivePage?: string;
  homePage: string;
  pagePublicationStatuses: Record<string, HtmlPagePublicationStatus>;
  assignedCollections: Array<{ slug: string; name: string }>;
  pageTemplateCollections: Array<{ slug: string; name: string }>;
  pageTemplates: Record<string, string>;
  experimentGroups: HtmlExperimentPageGroup[];
  activeExperimentId?: string;
  activeExperimentVariantId?: string;
  onPageSelect: (path: string) => void;
  onExperimentVariantSelect?: (experimentId: string, variantId: string) => void;
  onPageSetHome: (path: string) => void;
  onPagePublicationStatusChange: (path: string, status: HtmlPagePublicationStatus) => void;
  onPageSetTemplate: (path: string, postType: string) => void;
  onPageRemoveTemplate: (postType: string) => void;
  templateProviders: BuilderTemplateProvider[];
  onPageSetExtensionTemplate: (providerId: string, path: string) => void;
  onPageRemoveExtensionTemplate: (providerId: string) => void;
  onPageDuplicate: (path: string) => void;
  onPageRename: (path: string, nextPath: string) => void;
  onPageMove: (path: string, targetFolder: string) => void;
  onPageRemove: (path: string) => void;
  onPageSettings: (path: string) => void;
  onPageOpenCode: (path: string) => void;
  dragItem: HtmlPageTreeDragItem | null;
  dropTargetFolder: string | null;
  onTreePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: HtmlPageTreeDragItem,
  ) => void;
  shouldSuppressTreeClick: () => boolean;
}

const EXPERIMENT_STATUS_UI: Record<
  HtmlExperimentPageGroup["status"],
  { label: string; dotClassName: string; labelClassName: string }
> = {
  active: {
    label: "Ativo",
    dotClassName: "bg-[var(--kodety-success)]",
    labelClassName: "text-[var(--kodety-text-tertiary)]",
  },
  paused: {
    label: "Pausado",
    dotClassName: "bg-[var(--kodety-warning)]",
    labelClassName: "text-[var(--kodety-text-tertiary)]",
  },
  draft: {
    label: "Rascunho",
    dotClassName: "border border-[var(--kodety-text-disabled)] bg-transparent",
    labelClassName: "text-[var(--kodety-text-tertiary)]",
  },
  archived: {
    label: "Arquivado",
    dotClassName: "bg-[var(--kodety-text-disabled)]",
    labelClassName: "text-[var(--kodety-text-disabled)]",
  },
};

function PageRow({
  path,
  depth,
  hasHierarchyChildren,
  hierarchyExpanded,
  onToggleHierarchy,
  moveTargets,
  activePage,
  visualActivePage,
  homePage,
  pagePublicationStatuses,
  assignedCollections,
  pageTemplateCollections,
  pageTemplates,
  experimentGroups,
  activeExperimentId,
  activeExperimentVariantId,
  onPageSelect,
  onExperimentVariantSelect,
  onPageSetHome,
  onPagePublicationStatusChange,
  onPageSetTemplate,
  onPageRemoveTemplate,
  templateProviders,
  onPageSetExtensionTemplate,
  onPageRemoveExtensionTemplate,
  onPageDuplicate,
  onPageRename,
  onPageMove,
  onPageRemove,
  onPageSettings,
  onPageOpenCode,
  dragItem,
  dropTargetFolder,
  onTreePointerDown,
  shouldSuppressTreeClick,
}: PageRowProps) {
  const experimentPaths = useMemo(
    () => experimentGroups.flatMap(group => group.variants.map(variant => variant.pagePath)),
    [experimentGroups],
  );
  const activeExperimentVariant = useMemo(
    () => Boolean(
      activeExperimentId
      && activeExperimentVariantId
      && experimentGroups.some(group => (
        group.experimentId === activeExperimentId
        && group.variants.some(variant => variant.id === activeExperimentVariantId)
      )),
    ),
    [activeExperimentId, activeExperimentVariantId, experimentGroups],
  );
  const displayedActivePage = visualActivePage || activePage;
  const pageActive = displayedActivePage === path;
  const active = pageActive || activeExperimentVariant || experimentPaths.includes(displayedActivePage);
  const [expanded, setExpanded] = useState(
    () => activeExperimentVariant || experimentPaths.includes(displayedActivePage),
  );
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(
    () => getPageDisplayName(path, homePage),
  );

  useEffect(() => {
    if (activeExperimentVariant || experimentPaths.includes(displayedActivePage)) setExpanded(true);
  }, [activeExperimentVariant, displayedActivePage, experimentPaths]);

  useEffect(() => {
    setRenameDraft(getPageDisplayName(path, homePage));
    setRenaming(false);
  }, [homePage, path]);

  const canRename = homePage !== path;
  const publicationStatus = pagePublicationStatuses[path] === 'draft' ? 'draft' : 'active';
  const extensionTemplate = templateProviders.some(provider => provider.templatePath === path);
  const isTemplatePage = assignedCollections.length > 0 || extensionTemplate;
  const pageExperimentStatus =
    experimentGroups.find(group => group.status === "active")?.status
    ?? experimentGroups.find(group => group.status === "paused")?.status
    ?? experimentGroups.find(group => group.status === "draft")?.status
    ?? experimentGroups[0]?.status;
  const pageExperimentStatusUi = pageExperimentStatus
    ? EXPERIMENT_STATUS_UI[pageExperimentStatus]
    : null;
  const representedFolder = htmlPageNodeFolder(path);
  const sourceDragItem: HtmlPageTreeDragItem = hasHierarchyChildren
    ? { kind: "folder", path: representedFolder, folderPath: representedFolder }
    : { kind: "page", path, folderPath: representedFolder };
  const canAcceptDrop = Boolean(
    dragItem && canDropHtmlPageTreeItem(dragItem, representedFolder),
  );
  const iconClassName = cn(
    "size-3.5 shrink-0",
    isTemplatePage ? "text-violet-300" : "text-[var(--kodety-accent-hover)]",
  );
  const rowLeadingControls =
    (hasHierarchyChildren ? 18 : 0) + (experimentGroups.length > 0 ? 18 : 0);
  const rowContentInset = 8 + depth * 14 + rowLeadingControls;
  const startRename = () => {
    if (!canRename) return;
    setRenameDraft(getPageDisplayName(path, homePage));
    setRenaming(true);
  };
  const finishRename = () => {
    const nextPath = inlinePageRenamePath(path, renameDraft);
    setRenaming(false);
    if (nextPath && nextPath !== path) onPageRename(path, nextPath);
  };
  const pageRowClassName = cn(
    "flex h-7 w-full min-w-0 items-center gap-2 rounded-[5px] pr-9 text-left text-[11px] text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-white/[0.035] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]",
    active && "bg-white/[0.09] text-[var(--kodety-text)]",
    dropTargetFolder === representedFolder && canAcceptDrop && "bg-[var(--kodety-accent)]/15 ring-1 ring-inset ring-[var(--kodety-focus)]/70",
  );

  return (
    <div className="w-full">
      <div className="group relative w-full">
        {renaming ? (
          <div
            className={pageRowClassName}
            style={{ paddingLeft: rowContentInset }}
          >
            {homePage === path ? (
              <Home className={iconClassName} />
            ) : (
              <FileCode2 className={iconClassName} />
            )}
            <Input
              autoFocus
              value={renameDraft}
              aria-label={`Renomear ${getPageDisplayName(path, homePage)}`}
              className="h-6 min-w-0 flex-1 rounded-[4px] border-[var(--kodety-accent-hover)]/60 bg-black/25 px-1.5 text-[11px] font-medium"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenameDraft(getPageDisplayName(path, homePage));
                  setRenaming(false);
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            data-page-tree-drop-folder={representedFolder}
            aria-current={pageActive && !activeExperimentVariant ? "page" : undefined}
            onPointerDown={(event) => {
              if (homePage !== path) onTreePointerDown(event, sourceDragItem);
            }}
            onClick={() => {
              if (!shouldSuppressTreeClick()) onPageSelect(path);
            }}
            onDoubleClick={startRename}
            className={pageRowClassName}
            style={{ paddingLeft: rowContentInset }}
            title={canRename
              ? `${getPageDisplayName(path, homePage)} · duplo clique para renomear`
              : "Página inicial · a rota / é fixa"}
          >
            {homePage === path ? (
              <Home className={iconClassName} />
            ) : (
              <FileCode2 className={iconClassName} />
            )}
            <span
              className="min-w-0 flex-1 truncate font-medium"
              title={getPageDisplayName(path, homePage)}
            >
              {getPageDisplayName(path, homePage)}
            </span>
            {assignedCollections.length > 0 && (
              <span className="shrink-0 text-[9px] font-medium text-[var(--kodety-text-tertiary)]">
                CMS
              </span>
            )}
            {experimentGroups.length > 0 && (
              <span
                aria-label={`A/B · ${pageExperimentStatusUi?.label || "Experimento"}`}
                title={pageExperimentStatusUi?.label}
                className="inline-flex h-4 shrink-0 items-center gap-1 rounded-[4px] border border-violet-400/25 bg-violet-400/[.08] px-1.5 text-[8px] font-semibold uppercase tracking-[.07em] text-violet-300"
              >
                {pageExperimentStatusUi && (
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 rounded-full", pageExperimentStatusUi.dotClassName)}
                  />
                )}
                A/B
              </span>
            )}
            {publicationStatus === 'draft' && (
              <span className="shrink-0 rounded-[4px] bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[.08em] text-amber-300">
                Draft
              </span>
            )}
          </button>
        )}
        {hasHierarchyChildren && !renaming && (
          <button
            type="button"
            aria-label={hierarchyExpanded ? "Recolher subpáginas" : "Expandir subpáginas"}
            aria-expanded={hierarchyExpanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggleHierarchy();
            }}
            className="absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center text-[var(--kodety-text-tertiary)] hover:text-[var(--kodety-text)]"
            style={{ left: depth * 14 }}
          >
            {hierarchyExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
        {experimentGroups.length > 0 && (
          <button
            type="button"
            aria-label={expanded ? "Ocultar variantes" : "Mostrar variantes"}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(value => !value);
            }}
            className="absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center text-[var(--kodety-text-tertiary)] hover:text-[var(--kodety-text)]"
            style={{ left: depth * 14 + (hasHierarchyChildren ? 18 : 0) }}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Opções de ${getPageDisplayName(path, homePage)}`}
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              title="Opções da página"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-56">
            <DropdownMenuItem onClick={() => onPageSettings(path)}>
              <Settings2 /> Configurações
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canRename}
              onClick={startRename}
            >
              <Pencil /> Renomear e alterar URL
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPageDuplicate(path)}>
              <Copy /> Duplicar
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={homePage === path}>
                <Folder /> Mover para
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-52">
                <DropdownMenuItem
                  disabled={htmlPageParentFolder(path) === ""}
                  onClick={() => onPageMove(path, "")}
                >
                  <CornerUpLeft /> Raiz de Pages
                </DropdownMenuItem>
                {moveTargets.length > 0 && <DropdownMenuSeparator />}
                {moveTargets.map(target => (
                  <DropdownMenuItem
                    key={target.folderPath}
                    disabled={htmlPageParentFolder(path) === target.folderPath}
                    onClick={() => onPageMove(path, target.folderPath)}
                  >
                    <Folder /> <span className="truncate">{target.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={homePage === path || !htmlPageParentFolder(path)}
              onClick={() => onPageMove(path, htmlFolderParent(htmlPageParentFolder(path)))}
            >
              <CornerUpLeft /> Mover para fora
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void navigator.clipboard.writeText(path)}
            >
              <Clipboard /> Copiar caminho
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPageOpenCode(path)}>
              <Braces /> Ver código
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={homePage === path && publicationStatus === 'active'}
              onClick={() => onPagePublicationStatusChange(
                path,
                publicationStatus === 'draft' ? 'active' : 'draft',
              )}
            >
              {publicationStatus === 'draft' ? <Globe2 /> : <EyeOff />}
              {publicationStatus === 'draft' ? 'Ativar página' : 'Mover para Draft'}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={homePage === path || activePage === path}
              onClick={() => onPageRemove(path)}
            >
              <Trash2 /> Excluir
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={homePage === path || publicationStatus === 'draft'}
              onClick={() => onPageSetHome(path)}
            >
              <Home />{" "}
              {homePage === path ? "Página inicial" : "Definir como inicial"}
            </DropdownMenuItem>
            {pageTemplateCollections.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LayoutTemplate /> Página de template
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-56">
                  {pageTemplateCollections.map((collection) => {
                    const selected = pageTemplates[collection.slug] === path;
                    return (
                      <DropdownMenuItem
                        key={collection.slug}
                        disabled={selected}
                        onClick={() => onPageSetTemplate(path, collection.slug)}
                      >
                        <span className="flex size-3.5 items-center justify-center">
                          {selected ? (
                            <Icon name="check" className="size-3.5" />
                          ) : null}
                        </span>
                        <span className="truncate">{collection.name}</span>
                      </DropdownMenuItem>
                    );
                  })}
                  {assignedCollections.length > 0 && <DropdownMenuSeparator />}
                  {assignedCollections.map((collection) => (
                    <DropdownMenuItem
                      key={`remove-${collection.slug}`}
                      variant="destructive"
                      onClick={() => onPageRemoveTemplate(collection.slug)}
                    >
                      <Trash2 /> Remover de {collection.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {templateProviders.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <LayoutTemplate /> Template
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-56">
                  {templateProviders.map((provider) => {
                    const selected = provider.templatePath === path;
                    return (
                      <DropdownMenuItem
                        key={provider.id}
                        disabled={selected}
                        onClick={() => onPageSetExtensionTemplate(provider.id, path)}
                      >
                        <span className="flex size-3.5 items-center justify-center">
                          {selected ? <Icon name="check" className="size-3.5" /> : null}
                        </span>
                        <span className="truncate">{provider.name}</span>
                      </DropdownMenuItem>
                    );
                  })}
                  {templateProviders.some(provider => provider.templatePath === path) && (
                    <DropdownMenuSeparator />
                  )}
                  {templateProviders
                    .filter(provider => provider.templatePath === path)
                    .map(provider => (
                      <DropdownMenuItem
                        key={`remove-extension-${provider.id}`}
                        variant="destructive"
                        onClick={() => onPageRemoveExtensionTemplate(provider.id)}
                      >
                        <Trash2 /> Remover de {provider.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && experimentGroups.map(group => {
        const statusUi = EXPERIMENT_STATUS_UI[group.status];
        return (
          <div
            key={group.experimentId}
            role="group"
            aria-label={`Variantes de ${group.name}`}
            className="relative mt-1 overflow-hidden rounded-[7px] border border-[var(--kodety-divider)] bg-white/[.018] p-1"
            style={{ marginLeft: rowContentInset }}
          >
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-violet-400/40" />
            <div className="mb-1 flex h-6 min-w-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] px-1.5">
              <FlaskConical className="size-3 shrink-0 text-violet-300" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-[9px] font-medium text-[var(--kodety-text-secondary)]" title={group.name}>
                {group.name}
              </p>
              <span className={cn(
                "inline-flex shrink-0 items-center gap-1 text-[8px] font-medium",
                statusUi.labelClassName,
              )}>
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", statusUi.dotClassName)} />
                {statusUi.label}
              </span>
            </div>
            <div className="space-y-px">
              {group.variants.map((variant, index) => {
                const hasExactExperimentSelection = Boolean(
                  activeExperimentId && activeExperimentVariantId,
                );
                const variantActive = hasExactExperimentSelection
                  ? activeExperimentId === group.experimentId
                    && activeExperimentVariantId === variant.id
                  : displayedActivePage !== path && displayedActivePage === variant.pagePath;
                const weightLabel = `${Math.round(variant.weight * 10) / 10}%`;
                return (
                  <button
                    key={`${group.experimentId}:${variant.id}`}
                    type="button"
                    aria-current={variantActive ? "page" : undefined}
                    aria-label={`${variant.name}, ${weightLabel}`}
                    title={`${variant.name} · ${weightLabel}`}
                    onClick={() => onExperimentVariantSelect
                      ? onExperimentVariantSelect(group.experimentId, variant.id)
                      : onPageSelect(variant.pagePath)}
                    className={cn(
                      "relative flex h-7 w-full min-w-0 items-center gap-2 rounded-[5px] border border-transparent px-1.5 text-left text-[10px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-violet-400",
                      variantActive
                        ? "border-violet-400/35 bg-violet-400/[.11] text-[var(--kodety-text)]"
                        : "text-[var(--kodety-text-tertiary)] hover:border-white/[.045] hover:bg-white/[.035] hover:text-[var(--kodety-text-secondary)]",
                    )}
                  >
                    {variantActive && (
                      <span
                        aria-hidden="true"
                        className="absolute -left-px top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-r-full bg-violet-300"
                      />
                    )}
                    <span className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-[4px] border text-[8px] font-semibold",
                      variant.kind === "control"
                        ? "border-white/15 bg-white/[.04] text-[var(--kodety-text-tertiary)]"
                        : "border-violet-400/35 bg-violet-400/[.09] text-violet-300",
                      variantActive && "border-violet-400/55 bg-violet-400/[.16] text-violet-200",
                    )}>
                      {variant.kind === "control" ? "A" : String.fromCharCode(65 + Math.min(index, 25))}
                    </span>
                    <span className={cn(
                      "min-w-0 flex-1 truncate font-medium",
                      variantActive && "font-semibold",
                    )}>
                      {variant.name}
                    </span>
                    <span className={cn(
                      "min-w-[34px] shrink-0 rounded-[4px] bg-black/20 px-1.5 py-0.5 text-center text-[8px] font-medium tabular-nums text-[var(--kodety-text-disabled)]",
                      variantActive && "bg-violet-400/[.12] text-violet-300",
                    )}>
                      {weightLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface PageTreeProps {
  nodes: HtmlPageTreeNode[];
  collapsed: Set<string>;
  forceExpanded: boolean;
  moveTargets: Array<{ label: string; folderPath: string }>;
  depth?: number;
  onToggle: (id: string) => void;
  onPageFolderRename: (folderPath: string, nextFolderPath: string) => void;
  onPageFolderMove: (folderPath: string, targetFolder: string) => void;
  onPageConvertFolder: (folderPath: string) => void;
  dragItem: HtmlPageTreeDragItem | null;
  dropTargetFolder: string | null;
  onTreePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: HtmlPageTreeDragItem,
  ) => void;
  shouldSuppressTreeClick: () => boolean;
  pageRowProps: Omit<
    PageRowProps,
    | "path"
    | "depth"
    | "hasHierarchyChildren"
    | "hierarchyExpanded"
    | "onToggleHierarchy"
    | "moveTargets"
    | "assignedCollections"
    | "dragItem"
    | "dropTargetFolder"
    | "onTreePointerDown"
    | "shouldSuppressTreeClick"
  >;
}

function PurePageFolderRow({
  node,
  depth,
  expanded,
  moveTargets,
  onToggle,
  onPageFolderRename,
  onPageFolderMove,
  onPageConvertFolder,
  dragItem,
  dropTargetFolder,
  onTreePointerDown,
  shouldSuppressTreeClick,
}: {
  node: HtmlPageTreeNode;
  depth: number;
  expanded: boolean;
  moveTargets: Array<{ label: string; folderPath: string }>;
  onToggle: () => void;
  onPageFolderRename: (folderPath: string, nextFolderPath: string) => void;
  onPageFolderMove: (folderPath: string, targetFolder: string) => void;
  onPageConvertFolder: (folderPath: string) => void;
  dragItem: HtmlPageTreeDragItem | null;
  dropTargetFolder: string | null;
  onTreePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: HtmlPageTreeDragItem,
  ) => void;
  shouldSuppressTreeClick: () => boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(node.name);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    setRenameDraft(node.name);
    setRenaming(false);
  }, [node.name, node.folderPath]);
  const startRename = () => {
    setRenameDraft(node.name);
    setRenaming(true);
  };
  const sourceDragItem: HtmlPageTreeDragItem = {
    kind: "folder",
    path: node.folderPath,
    folderPath: node.folderPath,
  };
  const canAcceptDrop = Boolean(
    dragItem && canDropHtmlPageTreeItem(dragItem, node.folderPath),
  );
  const finishRename = () => {
    const nextPath = renameHtmlFolderDestination(node.folderPath, renameDraft);
    setRenaming(false);
    if (nextPath && nextPath !== node.folderPath)
      onPageFolderRename(node.folderPath, nextPath);
  };
  useEffect(() => {
    if (!contextMenuPosition) return;
    const close = () => setContextMenuPosition(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenuPosition]);
  return (
    <div className="group/page-folder relative w-full">
      {renaming ? (
        <div
          className="flex h-7 w-full items-center gap-2 rounded-[5px] pr-9 text-[11px] text-[var(--kodety-text)]"
          style={{ paddingLeft: 8 + depth * 14 + 18 }}
        >
          <FolderOpen className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
          <Input
            autoFocus
            value={renameDraft}
            aria-label={`Renomear pasta ${node.name}`}
            className="h-6 min-w-0 flex-1 rounded-[4px] border-[var(--kodety-accent-hover)]/60 bg-black/25 px-1.5 text-[11px] font-medium"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.preventDefault();
                setRenameDraft(node.name);
                setRenaming(false);
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          data-kodety-onboarding="pages-folder"
          data-page-tree-drop-folder={node.folderPath}
          aria-expanded={expanded}
          onPointerDown={(event) => onTreePointerDown(event, sourceDragItem)}
          onClick={() => {
            if (!shouldSuppressTreeClick()) onToggle();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenuPosition({
              x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
              y: Math.max(8, Math.min(event.clientY, window.innerHeight - 120)),
            });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            startRename();
          }}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-[5px] pr-9 text-left text-[11px] text-[var(--kodety-text-secondary)] outline-none hover:bg-white/[0.035] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]",
            dropTargetFolder === node.folderPath && canAcceptDrop && "bg-[var(--kodety-accent)]/15 ring-1 ring-inset ring-[var(--kodety-focus)]/70",
          )}
          style={{ paddingLeft: 8 + depth * 14 + 18 }}
          title={`${node.folderPath} · duplo clique para renomear`}
        >
          {expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-[var(--kodety-text-tertiary)]" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        </button>
      )}
      {!renaming && (
        <button
          type="button"
          aria-label={expanded ? "Recolher pasta" : "Expandir pasta"}
          aria-expanded={expanded}
          onClick={onToggle}
          className="absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center text-[var(--kodety-text-tertiary)] hover:text-[var(--kodety-text)]"
          style={{ left: depth * 14 }}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Opções da pasta ${node.name}`}
            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/page-folder:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="min-w-52">
          <DropdownMenuItem onClick={startRename}>
            <Pencil /> Renomear pasta
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folder /> Mover para
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-52">
              <DropdownMenuItem
                disabled={!htmlFolderParent(node.folderPath)}
                onClick={() => onPageFolderMove(node.folderPath, "")}
              >
                <CornerUpLeft /> Raiz de Pages
              </DropdownMenuItem>
              {moveTargets
                .filter(target => (
                  target.folderPath !== node.folderPath
                  && !target.folderPath.startsWith(`${node.folderPath}/`)
                ))
                .map(target => (
                  <DropdownMenuItem
                    key={target.folderPath}
                    disabled={htmlFolderParent(node.folderPath) === target.folderPath}
                    onClick={() => onPageFolderMove(node.folderPath, target.folderPath)}
                  >
                    <Folder /> <span className="truncate">{target.label}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={!htmlFolderParent(node.folderPath)}
            onClick={() => onPageFolderMove(
              node.folderPath,
              htmlFolderParent(htmlFolderParent(node.folderPath)),
            )}
          >
            <CornerUpLeft /> Mover para fora
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onPageConvertFolder(node.folderPath)}>
            <FileCode2 /> Converter em página
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {contextMenuPosition && (
        <div
          role="menu"
          aria-label={`Ações da pasta ${node.name}`}
          className="fixed z-[220] w-48 rounded-lg border border-white/10 bg-popover p-1 text-popover-foreground shadow-2xl shadow-black/40"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent"
            onClick={() => {
              startRename();
              setContextMenuPosition(null);
            }}
          >
            <Pencil className="size-3.5" /> Renomear pasta
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-accent"
            onClick={() => {
              onPageConvertFolder(node.folderPath);
              setContextMenuPosition(null);
            }}
          >
            <FileCode2 className="size-3.5" /> Converter em página
          </button>
        </div>
      )}
    </div>
  );
}

function PageTree({
  nodes,
  collapsed,
  forceExpanded,
  moveTargets,
  depth = 0,
  onToggle,
  onPageFolderRename,
  onPageFolderMove,
  onPageConvertFolder,
  dragItem,
  dropTargetFolder,
  onTreePointerDown,
  shouldSuppressTreeClick,
  pageRowProps,
}: PageTreeProps) {
  return (
    <>
      {nodes.map(node => {
        const expanded = forceExpanded || !collapsed.has(node.id);
        const hasChildren = node.children.length > 0;
        const row = node.kind === "page" && node.pagePath ? (
          <PageRow
            key={node.id}
            {...pageRowProps}
            path={node.pagePath}
            depth={depth}
            hasHierarchyChildren={hasChildren}
            hierarchyExpanded={expanded}
            onToggleHierarchy={() => onToggle(node.id)}
            moveTargets={moveTargets.filter(target => (
              target.folderPath !== node.folderPath
              && !target.folderPath.startsWith(`${node.folderPath}/`)
            ))}
            assignedCollections={pageRowProps.pageTemplateCollections.filter(
              collection => pageRowProps.pageTemplates[collection.slug] === node.pagePath,
            )}
            experimentGroups={pageRowProps.experimentGroups.filter(
              group => group.pagePath === node.pagePath,
            )}
            onPageRename={hasChildren
              ? (_path, nextPath) => onPageFolderRename(
                  node.folderPath,
                  htmlPageNodeFolder(nextPath),
                )
              : pageRowProps.onPageRename}
            onPageMove={hasChildren
              ? (_path, targetFolder) => onPageFolderMove(node.folderPath, targetFolder)
              : pageRowProps.onPageMove}
            dragItem={dragItem}
            dropTargetFolder={dropTargetFolder}
            onTreePointerDown={onTreePointerDown}
            shouldSuppressTreeClick={shouldSuppressTreeClick}
          />
        ) : (
          <PurePageFolderRow
            key={node.id}
            node={node}
            depth={depth}
            expanded={expanded}
            moveTargets={moveTargets}
            onToggle={() => onToggle(node.id)}
            onPageFolderRename={onPageFolderRename}
            onPageFolderMove={onPageFolderMove}
            onPageConvertFolder={onPageConvertFolder}
            dragItem={dragItem}
            dropTargetFolder={dropTargetFolder}
            onTreePointerDown={onTreePointerDown}
            shouldSuppressTreeClick={shouldSuppressTreeClick}
          />
        );
        return (
          <div key={node.id}>
            {row}
            {hasChildren && expanded && (
              <PageTree
                {...{
                  nodes: node.children,
                  collapsed,
                  forceExpanded,
                  moveTargets,
                  depth: depth + 1,
                  onToggle,
                  onPageFolderRename,
                  onPageFolderMove,
                  onPageConvertFolder,
                  dragItem,
                  dropTargetFolder,
                  onTreePointerDown,
                  shouldSuppressTreeClick,
                  pageRowProps,
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function HtmlNavigatorContent({
  width,
  activePanel,
  nodes,
  effectiveHiddenPaths,
  selectedPath,
  selectedPaths,
  onSelect,
  locales = [],
  activeLocale,
  sourceLocale,
  onLocaleChange,
  onResetLocalePage,
  localizationUrl,
  pages,
  pageExperimentGroups = [],
  activeExperimentId,
  activeExperimentVariantId,
  activePage,
  visualActivePage,
  homePage,
  pagePublicationStatuses,
  onPageSelect,
  onExperimentVariantSelect,
  onPageSetHome,
  onPagePublicationStatusChange,
  pageTemplateCollections,
  pageTemplates,
  onPageSetTemplate,
  onPageRemoveTemplate,
  templateProviders,
  onPageSetExtensionTemplate,
  onPageRemoveExtensionTemplate,
  onPageAdd,
  onPageDuplicate,
  onPageRename,
  onPageMove,
  onPageFolderMove,
  onPageFolderRename,
  onPageConvertFolder,
  onPageRemove,
  onPageSettings,
  onPageOpenCode,
  assets,
  onAssetReplace,
  onAssetAdd,
  onAssetRemove,
  imageOptimizationAccess,
  onAssetCompress,
  convertibleAssetCount,
  convertibleAssetBytes,
  onAssetConvert,
  lockedPaths,
  onToggleLock,
  onToggleVisibility,
  onToggleBuilderHidden,
  onLayerRename,
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
  canPaste,
  canPasteStyles,
  onMove,
  interactionSelectors = [],
  assetTree,
  experimentAssetFolders,
  activeCodeFile,
  onFileOpen,
  onFileCreate,
  onFileRename,
  onFileRemove,
  componentVariantsSection,
}: HtmlNavigatorProps) {
  const displayedActivePage = visualActivePage || activePage;
  const activeLocaleDefinition = locales.find((locale) => locale.code === activeLocale)
    || locales.find((locale) => locale.code === sourceLocale);
  const [layerSearch, setLayerSearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [projectFileFilter, setProjectFileFilter] =
    useState<AssetTreeFileFilter>("all");
  const [mediaExpanded, setMediaExpanded] = useState(true);
  const [projectFilesExpanded, setProjectFilesExpanded] = useState(true);
  const [experimentFilesExpanded, setExperimentFilesExpanded] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () =>
      new Set([
        ...assetTreeFolderIds(assetTree),
        ...assetTreeFolderIds(experimentAssetFolders),
      ]),
  );
  const [collapsedPageNodes, setCollapsedPageNodes] = useState<Set<string>>(
    () => new Set(),
  );
  const [pageTreeDragItem, setPageTreeDragItem] = useState<HtmlPageTreeDragItem | null>(null);
  const [pageTreeDropTarget, setPageTreeDropTarget] = useState<string | null>(null);
  const [showAllMedia, setShowAllMedia] = useState(false);
  const [compressionPaths, setCompressionPaths] = useState<string[]>([]);
  const [conversionRequest, setConversionRequest] = useState<{
    files: HtmlProjectFile[];
    paths: string[] | null;
  } | null>(null);
  const pageTreeDragItemRef = useRef<HtmlPageTreeDragItem | null>(null);
  const pageTreeSuppressClickRef = useRef(false);
  const pageTreeSuppressClickFrameRef = useRef<number | null>(null);
  const pageTreePointerCleanupRef = useRef<(() => void) | null>(null);
  const seenAssetFoldersRef = useRef<Set<string>>(
    new Set([
      ...assetTreeFolderIds(assetTree),
      ...assetTreeFolderIds(experimentAssetFolders),
    ]),
  );
  const pagesScrollRef = useRef<HTMLDivElement>(null);
  const normalizedFileSearch = fileSearch.trim().toLowerCase();
  const visiblePages = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    return pages.filter(path => (
      !query
      || path.toLowerCase().includes(query)
      || getPageDisplayName(path, homePage).toLowerCase().includes(query)
      || pageExperimentGroups
        .filter(group => group.pagePath === path)
        .some(group => (
          group.name.toLowerCase().includes(query)
          || group.variants.some(variant => variant.name.toLowerCase().includes(query))
        ))
    ));
  }, [homePage, pageExperimentGroups, pageSearch, pages]);
  const pageTree = useMemo(
    () => buildHtmlPageTree(pages, homePage),
    [homePage, pages],
  );
  const visiblePageTree = useMemo(
    () => filterHtmlPageTree(pageTree, pageSearch),
    [pageSearch, pageTree],
  );
  const pageMoveTargets = useMemo(
    () => flattenHtmlPageTree(pageTree).map(node => ({
      folderPath: node.folderPath,
      label: node.folderPath,
    })),
    [pageTree],
  );
  const finishPageTreeDrag = useCallback(() => {
    pageTreeDragItemRef.current = null;
    setPageTreeDragItem(null);
    setPageTreeDropTarget(null);
  }, []);
  const shouldSuppressPageTreeClick = useCallback(
    () => pageTreeSuppressClickRef.current,
    [],
  );
  const startPageTreePointerDrag = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    item: HtmlPageTreeDragItem,
  ) => {
    if (event.button !== 0) return;
    pageTreePointerCleanupRef.current?.();
    finishPageTreeDrag();
    const startX = event.clientX;
    const startY = event.clientY;
    let pointerX = startX;
    let pointerY = startY;
    let dragging = false;
    let currentTargetFolder: string | null = null;
    let autoScrollFrame: number | null = null;
    let bodyStylesChanged = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    const setTargetFolder = (next: string | null) => {
      currentTargetFolder = next;
      setPageTreeDropTarget(current => current === next ? current : next);
    };
    const updateDropAtPointer = () => {
      const scroll = pagesScrollRef.current;
      if (!scroll) {
        setTargetFolder(null);
        return;
      }
      const bounds = scroll.getBoundingClientRect();
      if (
        pointerX < bounds.left
        || pointerX > bounds.right
        || pointerY < bounds.top
        || pointerY > bounds.bottom
      ) {
        setTargetFolder(null);
        return;
      }
      const targetRow = document
        .elementFromPoint(pointerX, pointerY)
        ?.closest<HTMLElement>("[data-page-tree-drop-folder]");
      const targetFolder = targetRow?.dataset.pageTreeDropFolder;
      if (
        targetFolder === undefined
        || !canDropHtmlPageTreeItem(item, targetFolder)
      ) {
        setTargetFolder(null);
        return;
      }
      setTargetFolder(targetFolder);
    };
    const runAutoScroll = () => {
      if (!dragging) return;
      const scroll = pagesScrollRef.current;
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        const edge = 40;
        let delta = 0;
        if (pointerY < bounds.top + edge) {
          delta = -Math.ceil(((bounds.top + edge - pointerY) / edge) * 18);
        } else if (pointerY > bounds.bottom - edge) {
          delta = Math.ceil(((pointerY - (bounds.bottom - edge)) / edge) * 18);
        }
        if (delta !== 0) {
          const previousScrollTop = scroll.scrollTop;
          scroll.scrollTop += delta;
          if (scroll.scrollTop !== previousScrollTop) updateDropAtPointer();
        }
      }
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleEnd);
      document.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      if (autoScrollFrame !== null) window.cancelAnimationFrame(autoScrollFrame);
      if (bodyStylesChanged) {
        document.body.style.userSelect = previousUserSelect;
        document.body.style.cursor = previousCursor;
      }
      if (pageTreePointerCleanupRef.current === cleanup) {
        pageTreePointerCleanupRef.current = null;
      }
    };
    const suppressNextClick = () => {
      pageTreeSuppressClickRef.current = true;
      if (pageTreeSuppressClickFrameRef.current !== null) {
        window.cancelAnimationFrame(pageTreeSuppressClickFrameRef.current);
      }
      pageTreeSuppressClickFrameRef.current = window.requestAnimationFrame(() => {
        pageTreeSuppressClickRef.current = false;
        pageTreeSuppressClickFrameRef.current = null;
      });
    };
    const handleMove = (moveEvent: PointerEvent) => {
      if (
        !dragging
        && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5
      ) return;
      if (!dragging) {
        dragging = true;
        bodyStylesChanged = true;
        pageTreeDragItemRef.current = item;
        setPageTreeDragItem(item);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
      }
      moveEvent.preventDefault();
      pointerX = moveEvent.clientX;
      pointerY = moveEvent.clientY;
      updateDropAtPointer();
    };
    const handleEnd = () => {
      const targetFolder = currentTargetFolder;
      cleanup();
      if (!dragging) return;
      suppressNextClick();
      if (targetFolder !== null && canDropHtmlPageTreeItem(item, targetFolder)) {
        if (item.kind === "folder") onPageFolderMove(item.path, targetFolder);
        else onPageMove(item.path, targetFolder);
      }
      finishPageTreeDrag();
    };
    const handleCancel = () => {
      cleanup();
      finishPageTreeDrag();
    };

    pageTreePointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handleMove, { passive: false });
    document.addEventListener("pointerup", handleEnd, { once: true });
    document.addEventListener("pointercancel", handleCancel, { once: true });
    window.addEventListener("blur", handleCancel);
  }, [finishPageTreeDrag, onPageFolderMove, onPageMove]);
  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (file) =>
          !normalizedFileSearch ||
          file.path.toLowerCase().includes(normalizedFileSearch),
      ),
    [assets, normalizedFileSearch],
  );
  const visibleAssetTree = useMemo(
    () => filterAssetTree(assetTree, normalizedFileSearch, projectFileFilter),
    [assetTree, normalizedFileSearch, projectFileFilter],
  );
  const visibleExperimentFolders = useMemo(
    () =>
      filterAssetTree(
        experimentAssetFolders,
        normalizedFileSearch,
        projectFileFilter,
      ) as AssetTreeFolderNode[],
    [experimentAssetFolders, normalizedFileSearch, projectFileFilter],
  );
  const assetTreeFileCount = useMemo(
    () =>
      visibleAssetTree.reduce(
        (total, node) => total + (node.kind === "folder" ? node.fileCount : 1),
        0,
      ),
    [visibleAssetTree],
  );
  const experimentFileCount = useMemo(
    () =>
      visibleExperimentFolders.reduce(
        (total, folder) => total + folder.fileCount,
        0,
      ),
    [visibleExperimentFolders],
  );
  const toggleFolder = useCallback((id: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // A large imported project is unreadable when every directory starts open.
  // Collapse each folder the first time it appears, then preserve the author's
  // explicit toggles across file edits and tree recalculation.
  useEffect(() => {
    const folderIds = [
      ...assetTreeFolderIds(assetTree),
      ...assetTreeFolderIds(experimentAssetFolders),
    ];
    setCollapsedFolders((current) => {
      const next = new Set(current);
      let changed = false;
      folderIds.forEach((folderId) => {
        if (seenAssetFoldersRef.current.has(folderId)) return;
        seenAssetFoldersRef.current.add(folderId);
        next.add(folderId);
        changed = true;
      });
      return changed ? next : current;
    });
  }, [assetTree, experimentAssetFolders]);
  const visibleVisualAssets = useMemo(
    () => visibleAssets.filter(isVisualAsset),
    [visibleAssets],
  );
  const compressibleAssets = useMemo(
    () => assets.filter(isCompressibleProjectImage),
    [assets],
  );
  const compressionFiles = useMemo(() => {
    const requested = new Set(compressionPaths);
    return assets.filter(
      (file) => requested.has(file.path) && isCompressibleProjectImage(file),
    );
  }, [assets, compressionPaths]);
  const displayedAssets = showAllMedia
    ? visibleVisualAssets
    : visibleVisualAssets.slice(0, 6);

  useEffect(
    () => () => {
      pageTreePointerCleanupRef.current?.();
      if (pageTreeSuppressClickFrameRef.current !== null) {
        window.cancelAnimationFrame(pageTreeSuppressClickFrameRef.current);
      }
    },
    [],
  );
  return (
    <aside
      data-editor-sidebar-panel="left"
      data-kodety-onboarding={`design-${activePanel}-panel`}
      aria-label="Navegação do projeto"
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-[var(--kodety-panel)] px-2 pb-0 pt-2"
      style={{ width }}
    >
      <Tabs value={activePanel} className="flex h-full min-h-0 flex-col gap-0!">
        <div className="-mx-2 -mt-2 flex h-10 shrink-0 items-center border-b border-[var(--kodety-divider)] px-3 text-[11px] font-semibold text-[var(--kodety-text)]">
          {activePanel === "layers" ? "Layers" : activePanel === "pages" ? "Pages" : "Assets"}
        </div>
        {locales.filter((locale) => locale.enabled).length > 1 && (
          <div className="mt-2 flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[7px] bg-[var(--kodety-control)] px-2 text-left text-[10px] text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-[var(--kodety-control-hover)] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                >
                  <Languages className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {activeLocaleDefinition?.name || "Idioma"}
                  </span>
                  <NavigatorLocaleFlag locale={activeLocaleDefinition} />
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
              >
                {locales
                  .filter((locale) => locale.enabled)
                  .map((locale) => (
                    <DropdownMenuItem
                      key={locale.code}
                      onClick={() => onLocaleChange?.(locale.code)}
                    >
                      <span className="flex w-7 shrink-0 items-center">
                        <NavigatorLocaleFlag locale={locale} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {locale.name}
                      </span>
                      {locale.code === activeLocale && (
                        <Icon name="check" className="size-3.5" />
                      )}
                    </DropdownMenuItem>
                  ))}
                {activeLocale && activeLocale !== sourceLocale && onResetLocalePage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onResetLocalePage(activeLocale)}>
                      <RotateCcw />
                      Restaurar esta página ao fallback
                    </DropdownMenuItem>
                  </>
                )}
                {localizationUrl && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a
                        href={localizationUrl}
                        data-kodety-workspace-navigation="native"
                      >
                        <Settings2 /> Gerenciar traduções
                      </a>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {locales.filter((locale) => locale.enabled).length > 1 && activeLocale !== sourceLocale && (
          <p className="mt-1.5 border-l-2 border-[var(--kodety-accent-hover)]/60 pl-2 text-[8px] leading-3.5 text-[var(--kodety-accent-hover)]/55">
            Canvas localizado · mudanças visuais ficam apenas em {activeLocale}.
          </p>
        )}
        <TabsContent
          value="layers"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {componentVariantsSection}
          <div className="shrink-0 space-y-1.5 py-2">
            {!componentVariantsSection && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-[7px] bg-[var(--kodety-control)] px-2.5 text-left text-[10px] text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-[var(--kodety-control-hover)] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                  data-kodety-onboarding="layers-page"
                  title="Mudar de página"
                >
                  {displayedActivePage === homePage ? (
                    <Home className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {getPageDisplayName(displayedActivePage, homePage)}
                  </span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-52"
              >
                {pages.map((path) => (
                  <DropdownMenuItem
                    key={path}
                    onClick={() => onPageSelect(path)}
                  >
                    {path === homePage ? <Home /> : <FileCode2 />}
                    <span className="min-w-0 flex-1 truncate">
                      {getPageDisplayName(path, homePage)}
                    </span>
                    {path === displayedActivePage && (
                      <Icon name="check" className="size-3.5" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--kodety-text-tertiary)]" />
              <Input
                data-layer-search
                value={layerSearch}
                onChange={(event) => setLayerSearch(event.target.value)}
                placeholder="Buscar layers…"
                aria-label="Buscar layers"
                disableKeyboardStep
                size="sm"
                className="rounded-[8px] border border-[var(--kodety-divider)] bg-transparent pl-10 pr-3 text-[10px] text-[var(--kodety-text-secondary)] shadow-none placeholder:text-[var(--kodety-text-tertiary)]"
              />
            </div>
          </div>
          <HtmlLayersTree
            key={activePage}
            nodes={nodes}
            effectiveHiddenPaths={effectiveHiddenPaths}
            search={layerSearch}
            width={width}
            selectedPath={selectedPath}
            selectedPaths={selectedPaths}
            lockedPaths={lockedPaths}
            interactionSelectors={interactionSelectors}
            canPaste={canPaste}
            canPasteStyles={canPasteStyles}
            onSelect={onSelect}
            onToggleVisibility={onToggleVisibility}
            onToggleBuilderHidden={onToggleBuilderHidden}
            onLayerRename={onLayerRename}
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
        </TabsContent>
        <TabsContent
          value="pages"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--kodety-text-tertiary)]" />
              <Input
                value={pageSearch}
                onChange={(event) => setPageSearch(event.target.value)}
                data-kodety-onboarding="pages-search"
                placeholder="Buscar páginas…"
                aria-label="Buscar páginas"
                disableKeyboardStep
                className="h-7 rounded-[7px] border-0 bg-[var(--kodety-control)] pl-8 text-[10px] text-[var(--kodety-text-secondary)] shadow-none placeholder:text-[var(--kodety-text-tertiary)]"
              />
            </div>
          </div>
          <div ref={pagesScrollRef} data-kodety-onboarding="pages-tree" className="min-h-0 flex-1 overflow-auto no-scrollbar">
            <header className="flex h-9 items-center border-t border-[var(--kodety-divider)] px-1 text-[11px] font-semibold text-[var(--kodety-text)]">
              <span>Design</span>
            </header>
            <div className="mb-1 space-y-0.5">
              {visiblePages
                .filter((path) => path === homePage)
                .map((path) => {
                  const assignedCollections = pageTemplateCollections.filter(
                    (collection) => pageTemplates[collection.slug] === path,
                  );
                  return (
                    <PageRow
                      key={path}
                      {...{
                        path,
                        depth: 0,
                        hasHierarchyChildren: false,
                        hierarchyExpanded: true,
                        onToggleHierarchy: () => undefined,
                        moveTargets: pageMoveTargets,
                        activePage,
                        visualActivePage: displayedActivePage,
                        homePage,
                        pagePublicationStatuses,
                        assignedCollections,
                        pageTemplateCollections,
                        pageTemplates,
                        experimentGroups: pageExperimentGroups.filter(group => group.pagePath === path),
                        activeExperimentId,
                        activeExperimentVariantId,
                        onPageSelect,
                        onExperimentVariantSelect,
                        onPageSetHome,
                        onPagePublicationStatusChange,
                        onPageSetTemplate,
                        onPageRemoveTemplate,
                        templateProviders,
                        onPageSetExtensionTemplate,
                        onPageRemoveExtensionTemplate,
                        onPageDuplicate,
                        onPageRename,
                        onPageMove,
                        onPageRemove,
                        onPageSettings,
                        onPageOpenCode,
                        dragItem: pageTreeDragItem,
                        dropTargetFolder: pageTreeDropTarget,
                        onTreePointerDown: startPageTreePointerDrag,
                        shouldSuppressTreeClick: shouldSuppressPageTreeClick,
                      }}
                    />
                  );
                })}
            </div>
            <header className="flex h-9 items-center justify-between border-t border-[var(--kodety-divider)] px-1 text-[11px] font-semibold text-[var(--kodety-text)]">
              <span>Pages</span>
              <Button
                variant="ghost"
                size="icon-xs"
                data-kodety-onboarding="pages-add"
                aria-label="Adicionar página"
                title="Adicionar página"
                onClick={onPageAdd}
              >
                <Plus />
              </Button>
            </header>
            <div className="space-y-0.5 pb-2">
              {pageTreeDragItem && (
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label="Mover para a raiz de Pages"
                  data-page-tree-drop-folder=""
                  className={cn(
                    "mx-1 mb-1 flex h-8 items-center justify-center gap-2 rounded-md border border-dashed text-[10px] font-medium transition-colors",
                    pageTreeDropTarget === ""
                      ? "border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/15 text-[var(--kodety-accent-hover)]"
                      : "border-white/15 text-[var(--kodety-text-tertiary)]",
                  )}
                >
                  <CornerUpLeft className="size-3.5" /> Raiz de Pages
                </div>
              )}
              <PageTree
                nodes={visiblePageTree}
                collapsed={collapsedPageNodes}
                forceExpanded={Boolean(pageSearch.trim())}
                moveTargets={pageMoveTargets}
                onToggle={(id) => setCollapsedPageNodes(current => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
                onPageFolderRename={onPageFolderRename}
                onPageFolderMove={onPageFolderMove}
                onPageConvertFolder={onPageConvertFolder}
                dragItem={pageTreeDragItem}
                dropTargetFolder={pageTreeDropTarget}
                onTreePointerDown={startPageTreePointerDrag}
                shouldSuppressTreeClick={shouldSuppressPageTreeClick}
                pageRowProps={{
                  activePage,
                  visualActivePage: displayedActivePage,
                  homePage,
                  pagePublicationStatuses,
                  pageTemplateCollections,
                  pageTemplates,
                  experimentGroups: pageExperimentGroups,
                  activeExperimentId,
                  activeExperimentVariantId,
                  onPageSelect,
                  onExperimentVariantSelect,
                  onPageSetHome,
                  onPagePublicationStatusChange,
                  onPageSetTemplate,
                  onPageRemoveTemplate,
                  templateProviders,
                  onPageSetExtensionTemplate,
                  onPageRemoveExtensionTemplate,
                  onPageDuplicate,
                  onPageRename,
                  onPageMove,
                  onPageRemove,
                  onPageSettings,
                  onPageOpenCode,
                }}
              />
            </div>
            {visiblePages.length === 0 && (
              <p
                role="status"
                className="px-3 py-10 text-center text-[10px] leading-4 text-[var(--kodety-text-tertiary)]"
              >
                Nenhuma página encontrada.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="assets"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex shrink-0 items-center gap-1 py-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--kodety-text-tertiary)]" />
              <Input
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                data-kodety-onboarding="assets-search"
                placeholder="Buscar arquivos…"
                aria-label="Buscar mídia e arquivos do projeto"
                title="Buscar mídia e arquivos do projeto"
                disableKeyboardStep
                className="h-7 truncate rounded-[7px] border-0 bg-[var(--kodety-control)] pl-8 pr-2 text-[10px] text-[var(--kodety-text-secondary)] shadow-none placeholder:text-[var(--kodety-text-tertiary)]"
              />
            </div>
            <label
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--kodety-text-tertiary)] outline-none hover:bg-white/[0.04] hover:text-[var(--kodety-text)] focus-within:ring-1 focus-within:ring-[var(--kodety-focus)]"
              data-kodety-onboarding="assets-add"
              title="Adicionar mídia"
            >
              <Upload className="size-3.5" />
              <input
                type="file"
                multiple
                aria-label="Adicionar mídia"
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  if (files.length) onAssetAdd(files);
                  event.target.value = "";
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Criar arquivo"
              title="Criar arquivo"
              onClick={() => {
                const path = window.prompt(
                  "Caminho do novo arquivo",
                  "styles/new-file.css",
                );
                if (path) onFileCreate(path);
              }}
            >
              <Plus />
            </Button>
          </div>
          <div className="kodety-compact-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-0.5 pb-4">
            <section className="overflow-hidden rounded-[9px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] shadow-[inset_0_1px_rgba(255,255,255,0.015)]">
              <div
                className={cn(
                  "relative flex h-9 w-full items-center justify-between gap-1 pl-1 pr-7",
                  mediaExpanded && "border-b border-[var(--kodety-divider)]",
                )}
              >
                <button
                  type="button"
                  className="absolute inset-0 flex w-full items-center justify-end rounded-[6px] px-2 text-[var(--kodety-text)] outline-none hover:bg-white/[0.035] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                  data-kodety-onboarding="assets-media"
                  aria-label={`Mídia ${visibleVisualAssets.length}`}
                  aria-expanded={mediaExpanded}
                  onClick={() => setMediaExpanded((value) => !value)}
                >
                  <DisclosureChevron expanded={mediaExpanded} className="size-3" />
                </button>
                <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-[11px] font-semibold text-[var(--kodety-text)]">
                  <span className="min-w-0 flex-1">Mídia</span>
                  <span className="font-normal tabular-nums text-[var(--kodety-text-tertiary)]">
                    {visibleVisualAssets.length}
                  </span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="relative z-10 size-6 rounded-[5px] p-0"
                      disabled={compressibleAssets.length === 0}
                      data-kodety-onboarding="assets-compression"
                      aria-label="Comprimir imagens"
                      onClick={() =>
                        setCompressionPaths(
                          compressibleAssets.map((file) => file.path),
                        )
                      }
                    >
                      <Minimize2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    <p>Comprimir imagens</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="relative z-10 size-6 rounded-[5px] p-0"
                      disabled={convertibleAssetCount === 0}
                      aria-label="Converter formato das imagens"
                      onClick={() =>
                        setConversionRequest({ files: [], paths: null })
                      }
                    >
                      <Repeat2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    <p>Converter formato</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {mediaExpanded &&
                (visibleVisualAssets.length === 0 ? (
                  <p
                    role="status"
                    className="px-3 py-7 text-center text-[10px] leading-4 text-[var(--kodety-text-tertiary)]"
                  >
                    {normalizedFileSearch
                      ? "Nenhuma mídia encontrada."
                      : "Nenhuma mídia no projeto."}
                  </p>
                ) : (
                  <div className="space-y-1.5 p-1.5">
                    {displayedAssets.length > 0 && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {displayedAssets.map((file) => (
                          <CompactAssetCard
                            key={file.path}
                            file={file}
                            onReplace={(replacement) =>
                              onAssetReplace(file.path, replacement)
                            }
                            onCompress={
                              isCompressibleProjectImage(file)
                                ? () => setCompressionPaths([file.path])
                                : undefined
                            }
                            onConvert={
                              isConvertibleProjectImage(file)
                                ? () =>
                                    setConversionRequest({
                                      files: [file],
                                      paths: [file.path],
                                    })
                                : undefined
                            }
                            onRemove={() => onAssetRemove(file.path)}
                          />
                        ))}
                      </div>
                    )}
                    {visibleVisualAssets.length > 6 && (
                      <button
                        type="button"
                        className="h-7 w-full rounded-[5px] px-2 text-left text-[10px] font-medium text-[var(--kodety-accent)] outline-none hover:bg-white/[0.035] hover:text-[var(--kodety-accent-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                        onClick={() => setShowAllMedia((value) => !value)}
                      >
                        {showAllMedia
                          ? "Mostrar apenas 6"
                          : `Ver mais (${visibleVisualAssets.length})`}
                      </button>
                    )}
                  </div>
                ))}
            </section>
            <section className="overflow-hidden rounded-[9px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] shadow-[inset_0_1px_rgba(255,255,255,0.015)]">
              <div
                className={cn(
                  "relative flex h-9 items-center justify-between gap-1 pl-1 pr-7",
                  projectFilesExpanded && "border-b border-[var(--kodety-divider)]",
                )}
              >
                <button
                  type="button"
                  className="absolute inset-0 flex w-full items-center justify-end rounded-[6px] px-2 text-[var(--kodety-text)] outline-none hover:bg-white/[0.035] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                  data-kodety-onboarding="assets-files"
                  aria-label={`Arquivos do projeto ${assetTreeFileCount}`}
                  aria-expanded={projectFilesExpanded}
                  onClick={() => setProjectFilesExpanded((value) => !value)}
                >
                  <DisclosureChevron expanded={projectFilesExpanded} className="size-3" />
                </button>
                <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-[11px] font-semibold text-[var(--kodety-text)]">
                  <span className="min-w-0 flex-1 truncate">Arquivos do projeto</span>
                  <span className="shrink-0 font-normal tabular-nums text-[var(--kodety-text-tertiary)]">
                    {assetTreeFileCount}
                  </span>
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Filtrar arquivos por tipo: ${PROJECT_FILE_FILTER_LABELS[projectFileFilter]}`}
                      title="Filtrar arquivos por tipo"
                      className={cn(
                        "relative z-10 flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[9px] font-medium outline-none hover:bg-white/[0.05] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]",
                        projectFileFilter === "all"
                          ? "text-[var(--kodety-text-tertiary)]"
                          : "bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]",
                      )}
                    >
                      <Filter className="size-3" />
                      <span>{PROJECT_FILE_FILTER_LABELS[projectFileFilter]}</span>
                      <ChevronDown className="size-2.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-36">
                    <DropdownMenuRadioGroup
                      value={projectFileFilter}
                      onValueChange={(value) =>
                        setProjectFileFilter(value as AssetTreeFileFilter)
                      }
                    >
                      {PROJECT_FILE_FILTERS.map((filter) => (
                        <DropdownMenuRadioItem
                          key={filter.value}
                          value={filter.value}
                        >
                          {filter.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {projectFilesExpanded && (
                <div className="space-y-0.5 px-1 py-1.5">
                  {visibleAssetTree.map((node) => (
                    <AssetTreeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      collapsed={collapsedFolders}
                      forceExpanded={
                        Boolean(normalizedFileSearch) || projectFileFilter !== "all"
                      }
                      onToggle={toggleFolder}
                      activeCodeFile={activeCodeFile}
                      search={normalizedFileSearch}
                      onFileOpen={onFileOpen}
                      onFileRename={onFileRename}
                      onFileRemove={onFileRemove}
                    />
                  ))}
                  {assetTreeFileCount === 0 && (
                    <p
                      role="status"
                      className="px-3 py-7 text-center text-[10px] leading-4 text-[var(--kodety-text-tertiary)]"
                    >
                      {normalizedFileSearch
                        ? "Nenhum arquivo encontrado."
                        : projectFileFilter !== "all"
                          ? "Nenhum arquivo neste filtro."
                        : "Nenhum arquivo no projeto."}
                    </p>
                  )}
                </div>
              )}
            </section>
            {experimentAssetFolders.length > 0 && (
              <section className="overflow-hidden rounded-[9px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] shadow-[inset_0_1px_rgba(255,255,255,0.015)]">
                <div
                  className={cn(
                    "flex h-9 items-center px-1",
                    experimentFilesExpanded && "border-b border-[var(--kodety-divider)]",
                  )}
                >
                  <button
                    type="button"
                    className="flex h-7 w-full items-center justify-between gap-1.5 rounded-[6px] px-1.5 text-left text-[11px] font-semibold text-[var(--kodety-text)] outline-none hover:bg-white/[0.035] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                    aria-expanded={experimentFilesExpanded}
                    onClick={() => setExperimentFilesExpanded((value) => !value)}
                  >
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
                      <span>Testes A/B</span>
                      <span className="font-normal tabular-nums text-[var(--kodety-text-tertiary)]">
                        {experimentFileCount}
                      </span>
                    </span>
                    <DisclosureChevron expanded={experimentFilesExpanded} className="size-3" />
                  </button>
                </div>
                {experimentFilesExpanded && (
                  <div className="space-y-0.5 px-1 py-1.5">
                    <p className="px-2 pb-1 text-[9px] leading-3 text-[var(--kodety-text-tertiary)]">
                      Só o que cada variante alterou. O restante é herdado do
                      Controle.
                    </p>
                    {visibleExperimentFolders.map((folder) => (
                      <AssetTreeRow
                        key={folder.id}
                        node={folder}
                        depth={0}
                        collapsed={collapsedFolders}
                        forceExpanded={
                          Boolean(normalizedFileSearch) || projectFileFilter !== "all"
                        }
                        onToggle={toggleFolder}
                        activeCodeFile={activeCodeFile}
                        search={normalizedFileSearch}
                        onFileOpen={onFileOpen}
                        onFileRename={onFileRename}
                        onFileRemove={onFileRemove}
                      />
                    ))}
                    {experimentFileCount === 0 && (
                      <p
                        role="status"
                        className="px-3 py-7 text-center text-[10px] leading-4 text-[var(--kodety-text-tertiary)]"
                      >
                        Nenhuma variante divergiu do Controle.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <ImageCompressionDialog
        files={compressionFiles}
        locked={imageOptimizationAccess.compressionLocked}
        licenseUrl={imageOptimizationAccess.licenseUrl}
        upgradeUrl={imageOptimizationAccess.upgradeUrl}
        onActivate={imageOptimizationAccess.onActivate}
        onOpenChange={(open) => {
          if (!open) setCompressionPaths([]);
        }}
        onCompress={(options) =>
          onAssetCompress(
            compressionFiles.map((file) => file.path),
            options,
          )
        }
      />
      <ImageConversionDialog
        files={conversionRequest?.files || []}
        totalCount={
          conversionRequest
            ? conversionRequest.paths === null
              ? convertibleAssetCount
              : conversionRequest.files.length
            : 0
        }
        totalBytes={
          conversionRequest
            ? conversionRequest.paths === null
              ? convertibleAssetBytes
              : conversionRequest.files.reduce(
                  (total, file) => total + projectImageByteLength(file),
                  0,
                )
            : 0
        }
        entireProject={conversionRequest?.paths === null}
        locked={imageOptimizationAccess.conversionLocked}
        licenseUrl={imageOptimizationAccess.licenseUrl}
        upgradeUrl={imageOptimizationAccess.upgradeUrl}
        onActivate={imageOptimizationAccess.onActivate}
        onOpenChange={(open) => {
          if (!open) setConversionRequest(null);
        }}
        onConvert={(options) =>
          onAssetConvert(conversionRequest?.paths ?? null, options)
        }
      />
    </aside>
  );
}

export const HtmlNavigatorPanel = memo(function HtmlNavigatorPanel() {
  const sharedModel = useHtmlNavigatorStore(
    state => state.modelSlices?.shared || null,
  );
  const activeModel = useHtmlNavigatorStore(
    state => state.modelSlices?.[state.activePanel] || null,
  );
  const activePanel = useHtmlNavigatorStore(state => state.activePanel);
  const renderProps = useMemo(
    () => {
      if (!sharedModel || !activeModel) return null;
      const slices = useHtmlNavigatorStore.getState().modelSlices;
      if (!slices) return null;
      return {
        ...materializeHtmlNavigatorModel(slices),
        activePanel,
      };
    },
    [activeModel, activePanel, sharedModel],
  );
  if (!renderProps) return null;
  return <HtmlNavigatorContent {...renderProps} />;
});

/**
 * Compatibility bridge for the editor controller. Its props may be rebuilt by
 * the monolith, while the heavy panel only wakes when its stored model changes.
 */
export function HtmlNavigator(props: HtmlNavigatorBridgeProps) {
  const ownerId = useId();
  useLayoutEffect(() => {
    useHtmlNavigatorStore.getState().publish(ownerId, props);
  });
  useEffect(() => () => {
    useHtmlNavigatorStore.getState().resetOwner(ownerId);
  }, [ownerId]);
  return <HtmlNavigatorPanel />;
}

export const HtmlNavigatorBridge = HtmlNavigator;

export interface HtmlNavigatorRailTabProps {
  panel: HtmlNavigatorActivePanel;
  className?: string;
  navigationVisible?: boolean;
  onActivate?: () => void;
}

const NAVIGATOR_RAIL_LABELS: Record<HtmlNavigatorActivePanel, string> = {
  layers: "Layers",
  pages: "Pages",
  assets: "Assets",
};

/** Store-connected rail control; switching tabs does not subscribe the editor. */
export const HtmlNavigatorRailTab = memo(function HtmlNavigatorRailTab({
  panel,
  className,
  navigationVisible = true,
  onActivate,
}: HtmlNavigatorRailTabProps) {
  const selected = useHtmlNavigatorStore(state => state.activePanel === panel);
  const setActivePanel = useHtmlNavigatorStore(state => state.setActivePanel);
  const label = NAVIGATOR_RAIL_LABELS[panel];
  return (
    <button
      type="button"
      data-tooltip={label}
      data-kodety-onboarding={`design-${panel}`}
      data-kodety-onboarding-reveal
      aria-label={label}
      aria-pressed={navigationVisible && selected}
      className={cn(
        className,
        navigationVisible &&
          selected &&
          "bg-white/[0.09] text-[var(--kodety-accent-hover)]",
      )}
      onClick={() => {
        onActivate?.();
        setActivePanel(panel);
      }}
    >
      {panel === "layers" ? (
        <LayersMinimalisticIcon />
      ) : panel === "pages" ? (
        <FileIcon />
      ) : (
        <GalleryRoundIcon />
      )}
    </button>
  );
});
