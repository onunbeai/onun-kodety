"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  ChevronRight,
  Search,
  Sparkles,
  X,
} from "@/components/ui/gravity-icons";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComponentManifest } from "@coday/components";
import type { HtmlComponentDefinition } from "@/lib/html-editor/html-components";
import { HtmlComponentCard } from "./HtmlComponentSystem";
import { StructureIcon } from "@solar-icons/react/bold-duotone/structure";
import { BoxMinimalisticIcon } from "@solar-icons/react/bold-duotone/box-minimalistic";
import { TextFieldIcon } from "@solar-icons/react/bold-duotone/text-field";
import { GalleryIcon } from "@solar-icons/react/bold-duotone/gallery";
import { TextFieldFocusIcon } from "@solar-icons/react/bold-duotone/text-field-focus";
import { WindowFrameIcon } from "@solar-icons/react/bold-duotone/window-frame";
import { ProgrammingIcon } from "@solar-icons/react/bold-duotone/programming";
import { StarIcon } from "@solar-icons/react/bold-duotone/star";
import { WidgetIcon } from "@solar-icons/react/bold-duotone/widget";
import { DatabaseIcon } from "@solar-icons/react/bold-duotone/database";
import { BoxIcon } from "@solar-icons/react/bold-duotone/box";
import { PostsCarouselVerticalIcon } from "@solar-icons/react/bold-duotone/posts-carousel-vertical";
import { PostsCarouselHorizontalIcon } from "@solar-icons/react/bold-duotone/posts-carousel-horizontal";
import { Widget5Icon } from "@solar-icons/react/bold-duotone/widget-5";
import { Widget4Icon } from "@solar-icons/react/bold-duotone/widget-4";
import { GalleryWideIcon } from "@solar-icons/react/bold-duotone/gallery-wide";
import { HamburgerMenuIcon } from "@solar-icons/react/bold-duotone/hamburger-menu";
import { SidebarMinimalisticIcon } from "@solar-icons/react/bold-duotone/sidebar-minimalistic";
import { SidebarIcon } from "@solar-icons/react/bold-duotone/sidebar";
import { DocumentTextIcon } from "@solar-icons/react/bold-duotone/document-text";
import { ListIcon } from "@solar-icons/react/bold-duotone/list";
import { ListDownMinimalisticIcon } from "@solar-icons/react/bold-duotone/list-down-minimalistic";
import { ListArrowDownIcon } from "@solar-icons/react/bold-duotone/list-arrow-down";
import { ListDownIcon } from "@solar-icons/react/bold-duotone/list-down";
import { LinkSquareIcon } from "@solar-icons/react/bold-duotone/link-square";
import { LinkCircleIcon } from "@solar-icons/react/bold-duotone/link-circle";
import { CursorSquareIcon } from "@solar-icons/react/bold-duotone/cursor-square";
import { TextSquareIcon } from "@solar-icons/react/bold-duotone/text-square";
import { TextSelectionIcon } from "@solar-icons/react/bold-duotone/text-selection";
import { ChatSquareIcon } from "@solar-icons/react/bold-duotone/chat-square";
import { ChatSquareArrowIcon } from "@solar-icons/react/bold-duotone/chat-square-arrow";
import { ChatRoundDotsIcon } from "@solar-icons/react/bold-duotone/chat-round-dots";
import { ClapperboardPlayIcon } from "@solar-icons/react/bold-duotone/clapperboard-play";
import { PlayCircleIcon } from "@solar-icons/react/bold-duotone/play-circle";
import { VideoFramePlayHorizontalIcon } from "@solar-icons/react/bold-duotone/video-frame-play-horizontal";
import { StarsMinimalisticIcon } from "@solar-icons/react/bold-duotone/stars-minimalistic";
import { ObjectScanIcon } from "@solar-icons/react/bold-duotone/object-scan";
import { Tuning2Icon } from "@solar-icons/react/bold-duotone/tuning-2";
import { MusicNoteSliderIcon } from "@solar-icons/react/bold-duotone/music-note-slider";
import { FilterIcon } from "@solar-icons/react/bold-duotone/filter";
import { ShieldUserIcon } from "@solar-icons/react/bold-duotone/shield-user";
import { ShieldCheckIcon } from "@solar-icons/react/bold-duotone/shield-check";
import { LockKeyholeIcon } from "@solar-icons/react/bold-duotone/lock-keyhole";
import { LockPasswordIcon } from "@solar-icons/react/bold-duotone/lock-password";
import { LockPasswordUnlockedIcon } from "@solar-icons/react/bold-duotone/lock-password-unlocked";
import { UserPlusRoundedIcon } from "@solar-icons/react/bold-duotone/user-plus-rounded";
import { UserIdIcon } from "@solar-icons/react/bold-duotone/user-id";
import { Logout2Icon } from "@solar-icons/react/bold-duotone/logout-2";
import { UploadIcon } from "@solar-icons/react/bold-duotone/upload";
import { CheckSquareIcon } from "@solar-icons/react/bold-duotone/check-square";
import { RadioIcon } from "@solar-icons/react/bold-duotone/radio";
import { DialogIcon } from "@solar-icons/react/bold-duotone/dialog";
import { CartIcon } from "@solar-icons/react/bold-duotone/cart";
import { MinimalisticMagnifierIcon } from "@solar-icons/react/bold-duotone/minimalistic-magnifier";
import { CodeSquareIcon } from "@solar-icons/react/bold-duotone/code-square";
import { CodeFileIcon } from "@solar-icons/react/bold-duotone/code-file";
import { GlobalIcon } from "@solar-icons/react/bold-duotone/global";
import { SliderHorizontalIcon } from "@solar-icons/react/bold-duotone/slider-horizontal";
import { MapPointIcon } from "@solar-icons/react/bold-duotone/map-point";
import { RecordCircleIcon } from "@solar-icons/react/bold-duotone/record-circle";
import { DiagramUpIcon } from "@solar-icons/react/bold-duotone/diagram-up";
import { RouteIcon } from "@solar-icons/react/bold-duotone/route";
import { MinusIcon } from "@solar-icons/react/bold-duotone/minus";

type InsertCategory =
  | "Structure"
  | "Basic"
  | "Typography"
  | "CMS"
  | "Media"
  | "Forms"
  | "Overlays"
  | "Advanced"
  | "Other";

interface InsertItem {
  key: string;
  label: string;
  category: InsertCategory;
  hint: string;
  tag: string;
  icon: ComponentType<{ className?: string }>;
  featured?: boolean;
}

const INSERT_ITEMS: InsertItem[] = [
  {
    key: "section",
    label: "Section",
    category: "Structure",
    hint: "Seção semântica",
    tag: "section",
    icon: StructureIcon,
    featured: true,
  },
  {
    key: "frame",
    label: "Container",
    category: "Structure",
    hint: "Container fluido",
    tag: "div",
    icon: BoxIcon,
    featured: true,
  },
  {
    key: "stack",
    label: "Stack",
    category: "Structure",
    hint: "Flex vertical",
    tag: "flex",
    icon: PostsCarouselVerticalIcon,
    featured: true,
  },
  {
    key: "row",
    label: "Rows",
    category: "Structure",
    hint: "Flex horizontal",
    tag: "flex",
    icon: PostsCarouselHorizontalIcon,
  },
  {
    key: "grid",
    label: "Grid",
    category: "Structure",
    hint: "Grid responsivo",
    tag: "grid",
    icon: Widget5Icon,
    featured: true,
  },
  {
    key: "masonry",
    label: "Masonry",
    category: "Structure",
    hint: "Colunas tipo galeria",
    tag: "css",
    icon: GalleryWideIcon,
  },
  {
    key: "header",
    label: "Header",
    category: "Structure",
    hint: "Cabeçalho",
    tag: "header",
    icon: WindowFrameIcon,
  },
  {
    key: "nav",
    label: "Navigation",
    category: "Structure",
    hint: "Navegação",
    tag: "nav",
    icon: HamburgerMenuIcon,
    featured: true,
  },
  {
    key: "main",
    label: "Main",
    category: "Structure",
    hint: "Conteúdo principal",
    tag: "main",
    icon: SidebarMinimalisticIcon,
  },
  {
    key: "article",
    label: "Article",
    category: "Structure",
    hint: "Conteúdo independente",
    tag: "article",
    icon: DocumentTextIcon,
  },
  {
    key: "aside",
    label: "Aside",
    category: "Structure",
    hint: "Conteúdo lateral",
    tag: "aside",
    icon: SidebarIcon,
  },
  {
    key: "footer",
    label: "Footer",
    category: "Structure",
    hint: "Rodapé",
    tag: "footer",
    icon: WindowFrameIcon,
  },
  {
    key: "div",
    label: "Div Block",
    category: "Basic",
    hint: "Bloco neutro",
    tag: "div",
    icon: BoxMinimalisticIcon,
  },
  {
    key: "ul",
    label: "List",
    category: "Basic",
    hint: "Lista",
    tag: "ul",
    icon: ListIcon,
  },
  {
    key: "li",
    label: "List Item",
    category: "Basic",
    hint: "Item de lista",
    tag: "li",
    icon: ListDownMinimalisticIcon,
  },
  {
    key: "link-block",
    label: "Link Block",
    category: "Basic",
    hint: "Link em bloco",
    tag: "a",
    icon: LinkSquareIcon,
    featured: true,
  },
  {
    key: "button",
    label: "Button",
    category: "Basic",
    hint: "Botão",
    tag: "button",
    icon: CursorSquareIcon,
    featured: true,
  },
  {
    key: "h1",
    label: "Heading",
    category: "Typography",
    hint: "Título H1",
    tag: "h1",
    icon: TextSquareIcon,
    featured: true,
  },
  {
    key: "p",
    label: "Paragraph",
    category: "Typography",
    hint: "Parágrafo",
    tag: "p",
    icon: TextFieldIcon,
    featured: true,
  },
  {
    key: "text-block",
    label: "Text Block",
    category: "Typography",
    hint: "Texto inline",
    tag: "span",
    icon: TextSelectionIcon,
  },
  {
    key: "text-link",
    label: "Text Link",
    category: "Typography",
    hint: "Link textual",
    tag: "a",
    icon: LinkSquareIcon,
  },
  {
    key: "blockquote",
    label: "Block Quote",
    category: "Typography",
    hint: "Citação",
    tag: "blockquote",
    icon: ChatSquareIcon,
  },
  {
    key: "rich-text",
    label: "Rich Text",
    category: "Typography",
    hint: "Bloco rico editável",
    tag: "div",
    icon: DocumentTextIcon,
  },
  {
    key: "collection-list",
    label: "Collection List",
    category: "CMS",
    hint: "Lista base para CMS",
    tag: "div",
    icon: DatabaseIcon,
  },
  {
    key: "img",
    label: "Image",
    category: "Media",
    hint: "Imagem substituível",
    tag: "img",
    icon: GalleryIcon,
    featured: true,
  },
  {
    key: "picture",
    label: "Picture",
    category: "Media",
    hint: "Imagem adaptativa",
    tag: "picture",
    icon: GalleryWideIcon,
  },
  {
    key: "video",
    label: "Video",
    category: "Media",
    hint: "Player de vídeo",
    tag: "video",
    icon: ClapperboardPlayIcon,
    featured: true,
  },
  {
    key: "youtube",
    label: "YouTube",
    category: "Media",
    hint: "Player do YouTube",
    tag: "iframe",
    icon: PlayCircleIcon,
  },
  {
    key: "vimeo",
    label: "Vimeo",
    category: "Media",
    hint: "Player do Vimeo",
    tag: "iframe",
    icon: VideoFramePlayHorizontalIcon,
  },
  {
    key: "lottie",
    label: "Lottie",
    category: "Media",
    hint: "Animação Lottie",
    tag: "div",
    icon: StarsMinimalisticIcon,
  },
  {
    key: "spline",
    label: "Spline",
    category: "Media",
    hint: "Cena 3D",
    tag: "iframe",
    icon: ObjectScanIcon,
  },
  {
    key: "rive",
    label: "Rive",
    category: "Media",
    hint: "Animação interativa",
    tag: "canvas",
    icon: Tuning2Icon,
  },
  {
    key: "audio",
    label: "Audio",
    category: "Media",
    hint: "Player de áudio",
    tag: "audio",
    icon: MusicNoteSliderIcon,
  },
  {
    key: "form",
    label: "Form Block",
    category: "Forms",
    hint: "Formulário",
    tag: "form",
    icon: TextFieldFocusIcon,
    featured: true,
  },
  {
    key: "cms-filter",
    label: "CMS Filter",
    category: "Forms",
    hint: "Search, select and range filters",
    tag: "form",
    icon: FilterIcon,
    featured: true,
  },
  {
    key: "membership-gate",
    label: "Member Area",
    category: "Forms",
    hint: "Conteúdo, login e upgrade",
    tag: "section",
    icon: ShieldUserIcon,
    featured: true,
  },
  {
    key: "membership-login",
    label: "Member Login",
    category: "Forms",
    hint: "Entrar com e-mail e senha",
    tag: "form",
    icon: LockKeyholeIcon,
    featured: true,
  },
  {
    key: "membership-register",
    label: "Member Register",
    category: "Forms",
    hint: "Criar uma conta",
    tag: "form",
    icon: UserPlusRoundedIcon,
  },
  {
    key: "membership-forgot-password",
    label: "Forgot Password",
    category: "Forms",
    hint: "Solicitar recuperação",
    tag: "form",
    icon: LockPasswordUnlockedIcon,
  },
  {
    key: "membership-reset-password",
    label: "Reset Password",
    category: "Forms",
    hint: "Definir uma nova senha",
    tag: "form",
    icon: LockPasswordIcon,
  },
  {
    key: "membership-profile",
    label: "Member Profile",
    category: "Forms",
    hint: "Editar dados da conta",
    tag: "form",
    icon: UserIdIcon,
  },
  {
    key: "membership-logout",
    label: "Member Logout",
    category: "Forms",
    hint: "Encerrar a sessão",
    tag: "form",
    icon: Logout2Icon,
  },
  {
    key: "label",
    label: "Label",
    category: "Forms",
    hint: "Rótulo",
    tag: "label",
    icon: TextSquareIcon,
  },
  {
    key: "input",
    label: "Input",
    category: "Forms",
    hint: "Campo curto",
    tag: "input",
    icon: TextFieldFocusIcon,
    featured: true,
  },
  {
    key: "file-upload",
    label: "File Upload",
    category: "Forms",
    hint: "Upload de arquivo",
    tag: "input",
    icon: UploadIcon,
  },
  {
    key: "textarea",
    label: "Text Area",
    category: "Forms",
    hint: "Campo longo",
    tag: "textarea",
    icon: DocumentTextIcon,
  },
  {
    key: "checkbox",
    label: "Checkbox",
    category: "Forms",
    hint: "Campo booleano",
    tag: "input",
    icon: CheckSquareIcon,
  },
  {
    key: "radio",
    label: "Radio Button",
    category: "Forms",
    hint: "Escolha única",
    tag: "input",
    icon: RadioIcon,
  },
  {
    key: "select",
    label: "Select",
    category: "Forms",
    hint: "Lista de opções",
    tag: "select",
    icon: ListArrowDownIcon,
  },
  {
    key: "form-button",
    label: "Form Button",
    category: "Forms",
    hint: "Botão submit",
    tag: "button",
    icon: CursorSquareIcon,
  },
  {
    key: "overlay-modal",
    label: "Modal",
    category: "Overlays",
    hint: "Diálogo central",
    tag: "dialog",
    icon: DialogIcon,
    featured: true,
  },
  {
    key: "overlay-drawer",
    label: "Drawer",
    category: "Overlays",
    hint: "Painel lateral",
    tag: "aside",
    icon: SidebarIcon,
    featured: true,
  },
  {
    key: "overlay-popover",
    label: "Popover",
    category: "Overlays",
    hint: "Conteúdo contextual",
    tag: "div",
    icon: ChatSquareArrowIcon,
  },
  {
    key: "overlay-tooltip",
    label: "Tooltip",
    category: "Overlays",
    hint: "Ajuda compacta",
    tag: "tooltip",
    icon: ChatRoundDotsIcon,
  },
  {
    key: "checkout-overlay",
    label: "Checkout Overlay",
    category: "Overlays",
    hint: "Checkout editável",
    tag: "dialog",
    icon: CartIcon,
    featured: true,
  },
  {
    key: "cookie-consent",
    label: "Cookie Banner",
    category: "Overlays",
    hint: "Configurar consentimento",
    tag: "settings",
    icon: ShieldCheckIcon,
    featured: true,
  },
  {
    key: "search",
    label: "Search",
    category: "Advanced",
    hint: "Busca",
    tag: "form",
    icon: MinimalisticMagnifierIcon,
  },
  {
    key: "background-video",
    label: "Background Video",
    category: "Advanced",
    hint: "Vídeo visual",
    tag: "video",
    icon: VideoFramePlayHorizontalIcon,
  },
  {
    key: "dropdown",
    label: "Dropdown",
    category: "Advanced",
    hint: "Menu suspenso",
    tag: "details",
    icon: ListDownIcon,
  },
  {
    key: "code-embed",
    label: "Code Embed",
    category: "Advanced",
    hint: "Embed externo",
    tag: "iframe",
    icon: CodeSquareIcon,
  },
  {
    key: "lightbox",
    label: "Lightbox",
    category: "Advanced",
    hint: "Galeria simples",
    tag: "a",
    icon: GalleryWideIcon,
  },
  {
    key: "locales-list",
    label: "Locales List",
    category: "Advanced",
    hint: "Lista de idiomas",
    tag: "ul",
    icon: GlobalIcon,
  },
  {
    key: "navbar",
    label: "Navbar",
    category: "Advanced",
    hint: "Navbar pronta",
    tag: "nav",
    icon: HamburgerMenuIcon,
    featured: true,
  },
  {
    key: "slider",
    label: "Slider",
    category: "Advanced",
    hint: "Estrutura de slides",
    tag: "section",
    icon: SliderHorizontalIcon,
  },
  {
    key: "tabs",
    label: "Tabs",
    category: "Advanced",
    hint: "Abas acessíveis",
    tag: "div",
    icon: WindowFrameIcon,
  },
  {
    key: "map",
    label: "Map",
    category: "Advanced",
    hint: "Mapa embed",
    tag: "iframe",
    icon: MapPointIcon,
  },
  {
    key: "facebook",
    label: "Facebook",
    category: "Advanced",
    hint: "Link social",
    tag: "a",
    icon: LinkCircleIcon,
  },
  {
    key: "twitter",
    label: "X (Twitter)",
    category: "Advanced",
    hint: "Link social",
    tag: "a",
    icon: LinkCircleIcon,
  },
  {
    key: "custom-element",
    label: "Custom Element",
    category: "Advanced",
    hint: "Elemento custom",
    tag: "div",
    icon: CodeSquareIcon,
  },
  {
    key: "code-block",
    label: "Code Block",
    category: "Advanced",
    hint: "Bloco de código",
    tag: "pre",
    icon: CodeFileIcon,
  },
  {
    key: "grid",
    label: "Grid",
    category: "Other",
    hint: "Grid responsivo",
    tag: "grid",
    icon: Widget5Icon,
  },
  {
    key: "row",
    label: "Columns",
    category: "Other",
    hint: "Colunas flexíveis",
    tag: "flex",
    icon: PostsCarouselHorizontalIcon,
  },
  {
    key: "rectangle",
    label: "Rectangle",
    category: "Other",
    hint: "SVG retangular",
    tag: "svg",
    icon: Widget4Icon,
    featured: true,
  },
  {
    key: "oval",
    label: "Oval",
    category: "Other",
    hint: "SVG oval",
    tag: "svg",
    icon: RecordCircleIcon,
  },
  {
    key: "polygon",
    label: "Polygon",
    category: "Other",
    hint: "Polígono SVG",
    tag: "svg",
    icon: DiagramUpIcon,
  },
  {
    key: "star",
    label: "Star",
    category: "Other",
    hint: "Estrela SVG",
    tag: "svg",
    icon: StarIcon,
  },
  {
    key: "path",
    label: "Path",
    category: "Other",
    hint: "Caminho SVG",
    tag: "svg",
    icon: RouteIcon,
  },
  {
    key: "hr",
    label: "Divider",
    category: "Other",
    hint: "Separador",
    tag: "hr",
    icon: MinusIcon,
    featured: true,
  },
];

type InsertNavigationIcon = ComponentType<{ className?: string }>;

const CATEGORY_META: Record<
  InsertCategory,
  { label: string; hint: string; icon: InsertNavigationIcon }
> = {
  Structure: {
    label: "Structure",
    hint: "Seções e containers",
    icon: StructureIcon,
  },
  Basic: { label: "Basic", hint: "Blocos básicos", icon: BoxMinimalisticIcon },
  Typography: { label: "Typography", hint: "Texto e headings", icon: TextFieldIcon },
  CMS: { label: "CMS", hint: "Coleções", icon: DatabaseIcon },
  Media: { label: "Media", hint: "Imagem e vídeo", icon: GalleryIcon },
  Forms: { label: "Forms", hint: "Inputs e botões", icon: TextFieldFocusIcon },
  Overlays: {
    label: "Overlays",
    hint: "Modais e superfícies flutuantes",
    icon: WindowFrameIcon,
  },
  Advanced: { label: "Advanced", hint: "Widgets e embeds", icon: ProgrammingIcon },
  Other: { label: "Other", hint: "Outros layouts", icon: StarIcon },
};

const CATALOG_CARD_CLASS =
  "group flex aspect-[1.04] min-h-[122px] min-w-0 flex-col rounded-[12px] border border-white/[.075] bg-white/[.04] p-3 text-center outline-none transition-[border-color,background-color] motion-reduce:transition-none hover:border-[var(--kodety-accent-hover)]/70 hover:bg-white/[.055] focus-visible:border-[var(--kodety-accent-hover)]/70 focus-visible:bg-white/[.055]";
const CATALOG_ICON_CLASS =
  "size-8 shrink-0 text-white/40 transition-colors group-hover:text-[var(--kodety-accent-hover)] group-focus-visible:text-[var(--kodety-accent-hover)]";

function CatalogElement({
  item,
  onInsert,
  onDragStart,
  onDragEnd,
}: {
  item: InsertItem;
  onInsert: (key: string) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, key: string) => void;
  onDragEnd: () => void;
}) {
  const ItemIcon = item.icon;

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => onDragStart(event, item.key)}
      onDragEnd={onDragEnd}
      onClick={() => onInsert(item.key)}
      title={`${item.label} — ${item.hint}`}
      className={CATALOG_CARD_CLASS}
    >
      <span className="flex min-h-0 flex-1 items-center justify-center">
        <ItemIcon className={CATALOG_ICON_CLASS} />
      </span>
      <span className="mt-2 block w-full min-w-0 shrink-0">
        <span className="block truncate text-[11px] font-medium leading-4 text-foreground/90">
          {item.label}
        </span>
        <span className="mt-0.5 block truncate text-[9px] leading-3.5 text-muted-foreground">
          {item.hint}
        </span>
      </span>
    </button>
  );
}

function CatalogComponent({
  name,
  description,
  version,
  tone = "default",
  onClick,
}: {
  name: string;
  description?: string;
  version?: string;
  tone?: "default" | "code";
  onClick: () => void;
}) {
  const ItemIcon = tone === "code" ? ProgrammingIcon : WidgetIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Inserir ${name}`}
      className={CATALOG_CARD_CLASS}
    >
      <span className="flex min-h-0 flex-1 items-center justify-center">
        <ItemIcon className={CATALOG_ICON_CLASS} />
      </span>
      <span className="mt-2 block w-full min-w-0 shrink-0">
        <span className="block truncate text-[11px] font-medium leading-4 text-foreground/90">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-[9px] leading-3.5 text-muted-foreground">
          {description ||
            (tone === "code"
              ? "Componente de código"
              : "Componente do projeto")}
        </span>
        {version && (
          <span className="mt-1 block truncate font-mono text-[8px] leading-3 text-muted-foreground/70">
            v{version}
          </span>
        )}
      </span>
    </button>
  );
}

type CatalogSection =
  | InsertCategory
  | "Components"
  | "CodeComponents";

const ELEMENT_SECTIONS: InsertCategory[] = [
  "Structure",
  "Basic",
  "Typography",
  "Media",
  "Forms",
  "Overlays",
  "Advanced",
  "Other",
];

function HtmlInsertMenuImpl({
  width,
  onClose,
  onInsert,
  membershipEnabled = false,
  codeComponents = [],
  components = [],
  componentPreviews = {},
  onInsertCodeComponent,
  onInsertComponent,
  onEditComponent,
  onRenameComponent,
  onDeleteComponent,
  onOpenEffects,
}: {
  width: number;
  onClose: () => void;
  onInsert: (key: string) => void;
  membershipEnabled?: boolean;
  codeComponents?: ComponentManifest[];
  components?: HtmlComponentDefinition[];
  componentPreviews?: Record<string, string>;
  onInsertCodeComponent?: (componentId: string, version: string) => void;
  onInsertComponent?: (componentId: string) => void;
  onEditComponent?: (componentId: string) => void;
  onRenameComponent?: (componentId: string) => void;
  onDeleteComponent?: (componentId: string) => void;
  onOpenEffects?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] =
    useState<CatalogSection>("Basic");
  const panelRef = useRef<HTMLElement>(null);
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const detailWidth = Math.max(310, Math.min(370, width + 42));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(
          "[data-insert-panel-trigger], [data-html-insert-menu-portal], [data-kodety-onboarding-ui]",
        )
      )
        return;
      onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointer,
        true,
      );
  }, [onClose]);

  const allItems = useMemo(
    () =>
      INSERT_ITEMS.filter(
        (item) => membershipEnabled || !item.key.startsWith("membership-"),
      ),
    [membershipEnabled],
  );

  const searchedItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter((item) =>
      `${item.label} ${item.hint} ${item.category} ${item.tag}`
        .toLowerCase()
        .includes(query),
    );
  }, [allItems, search]);

  const visibleCodeComponents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return codeComponents.filter(
      (component) =>
        !query ||
        `${component.displayName} ${component.name} ${component.description || ""}`
          .toLowerCase()
          .includes(query),
    );
  }, [codeComponents, search]);
  const visibleComponents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return components.filter(
      component => !query || component.name.toLowerCase().includes(query),
    );
  }, [components, search]);

  const insert = (key: string) => {
    onInsert(key);
  };

  const startDrag = (event: ReactDragEvent<HTMLElement>, key: string) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-incode-insert", key);
    event.dataTransfer.setData("text/plain", key);
    window.dispatchEvent(
      new CustomEvent("html-editor-insert-drag-start", { detail: { key } }),
    );
  };
  const endDrag = () =>
    window.dispatchEvent(new CustomEvent("html-editor-insert-drag-end"));

  const chooseSection = (section: CatalogSection) => {
    setActiveSection(section);
    setSearch("");
    requestAnimationFrame(() => {
      if (catalogScrollRef.current) catalogScrollRef.current.scrollTop = 0;
    });
  };

  const sectionItems = search
    ? searchedItems
    : activeSection === "CodeComponents" || activeSection === "Components"
      ? []
      : searchedItems.filter((item) => item.category === activeSection);
  const sectionCodeComponents =
    search || activeSection === "CodeComponents" ? visibleCodeComponents : [];
  const sectionComponents =
    search || activeSection === "Components" ? visibleComponents : [];
  const resultCount = sectionItems.length + sectionCodeComponents.length + sectionComponents.length;

  const sectionTitle = search
    ? "Resultados"
    : activeSection === "Components"
      ? "Components"
    : activeSection === "CodeComponents"
      ? "Code Components"
      : CATEGORY_META[activeSection].label;
  const sectionDescription = search
    ? `Correspondências para “${search.trim()}”`
    : activeSection === "Components"
      ? "Reusable components and variants from this project."
    : activeSection === "CodeComponents"
      ? "Componentes publicados a partir de código."
      : CATEGORY_META[activeSection].hint;

  const categoryRow = (
    section: CatalogSection,
    label: string,
    hint: string,
    Icon: InsertNavigationIcon,
    count: number,
  ) => {
    const active = !search && activeSection === section;
    return (
      <button
        key={section}
        type="button"
        onClick={() => chooseSection(section)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left text-[var(--kodety-text-secondary)] outline-none transition-[border-color,background-color,color] motion-reduce:transition-none hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065]",
          active && "bg-white/[.075] text-[var(--kodety-text)]",
        )}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[7px] bg-white/[.05] text-[var(--kodety-text-tertiary)] transition-[background-color,color] group-hover:bg-white/[.075] group-hover:text-[var(--kodety-text-secondary)]",
            active && "bg-white/[.13] text-[var(--kodety-text)]",
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium leading-4">
            {label}
          </span>
          <span className="block truncate text-[9px] leading-3.5 text-muted-foreground">
            {hint}
          </span>
        </span>
        <span className="text-[9px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
        <ChevronRight className="size-3 shrink-0 text-[var(--kodety-text-tertiary)] transition-[color,transform] group-aria-[current=page]:translate-x-0.5 group-aria-[current=page]:text-[var(--kodety-text-secondary)]" />
      </button>
    );
  };

  return (
    <section
      ref={panelRef}
      id="html-editor-insert-panel"
      data-kodety-onboarding="design-insert-panel"
      className="absolute inset-y-0 left-0 z-[80] grid min-h-0 overflow-hidden border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]"
      style={{
        gridTemplateColumns: `${width}px ${detailWidth}px`,
        width: width + detailWidth,
      }}
      aria-label="Painel Insert"
    >
      <aside className="flex min-h-0 min-w-0 flex-col border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--kodety-divider)] px-3">
          <div>
            <h2 className="text-[12px] font-semibold tracking-[-0.01em] text-foreground">
              Insert
            </h2>
            <p className="text-[9px] leading-3 text-muted-foreground">
              Clique ou arraste para o canvas
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className="grid size-7 place-items-center rounded-[7px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.06] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]"
                aria-label="Fechar Insert"
              >
                <X className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="z-[120]">Fechar Insert</TooltipContent>
          </Tooltip>
        </header>

        <div className="shrink-0 border-b border-[var(--kodety-divider)] p-3">
          <div
            data-kodety-insert-search-control
            className="flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
          >
            <span className="grid w-8 shrink-0 place-items-center border-r border-white/[.055] bg-black/[.06] text-white/35 transition-colors">
              <Search className="size-3.5" />
            </span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar…"
              className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-[11px] shadow-none outline-none placeholder:text-white/30 focus-visible:border-transparent focus-visible:ring-0"
              disableKeyboardStep
              autoFocus
              aria-label="Buscar no Insert"
            />
            {search && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="grid h-full w-8 shrink-0 place-items-center border-0 border-l border-white/[.055] bg-black/[.05] p-0 text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)]"
                    aria-label="Limpar busca"
                  >
                    <X className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="z-[120]">Limpar busca</TooltipContent>
              </Tooltip>
            )}
          </div>
          {onOpenEffects && (
            <button
              type="button"
              data-effects-panel-trigger
              onClick={onOpenEffects}
              className="mt-2 flex h-8 w-full items-center gap-2 rounded-[8px] border border-transparent bg-white/[.035] px-2 text-left text-[10px] text-[var(--kodety-text-secondary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065]"
            >
              <Sparkles className="size-3.5" />
              <span className="flex-1">Effects Library</span>
              <ChevronRight className="size-3" />
            </button>
          )}
        </div>

        <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
          <section data-kodety-onboarding="insert-elements">
            <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              Elements
            </h3>
            <div className="space-y-0.5">
              {ELEMENT_SECTIONS.map((section) => {
                const meta = CATEGORY_META[section];
                return categoryRow(
                  section,
                  meta.label,
                  meta.hint,
                  meta.icon,
                  allItems.filter((item) => item.category === section).length,
                );
              })}
            </div>
          </section>

          <div className="my-3 border-t border-[var(--kodety-divider)]" />

          <section data-kodety-onboarding="insert-components">
            <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              Components
            </h3>
            {categoryRow(
              "Components",
              "Components",
              "Reusable project components",
              WidgetIcon,
              components.length,
            )}
          </section>

          <div className="my-3 border-t border-[var(--kodety-divider)]" />

          <section data-kodety-onboarding="insert-cms">
            <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              CMS
            </h3>
            {categoryRow(
              "CMS",
              CATEGORY_META.CMS.label,
              CATEGORY_META.CMS.hint,
              CATEGORY_META.CMS.icon,
              allItems.filter((item) => item.category === "CMS").length,
            )}
          </section>

          {codeComponents.length > 0 && (
            <>
              <div className="my-3 border-t border-[var(--kodety-divider)]" />
              <section>
                <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Code Components
                </h3>
                <div className="space-y-0.5">
                  {categoryRow(
                    "CodeComponents",
                    "Code",
                    "Componentes de código",
                    ProgrammingIcon,
                    codeComponents.length,
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-[var(--kodety-panel)]">
        <header className="shrink-0 border-b border-[var(--kodety-divider)] px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-[12px] font-semibold text-foreground">
                {sectionTitle}
              </h2>
              <p className="mt-0.5 truncate text-[9px] leading-3.5 text-muted-foreground">
                {sectionDescription}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">
              {resultCount}
            </span>
          </div>
        </header>

        <div
          ref={catalogScrollRef}
          data-kodety-onboarding="insert-catalog"
          className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
        >
          {resultCount > 0 ? (
            <div className="grid grid-cols-2 gap-2.5">
              {sectionItems.map((item) => (
                <CatalogElement
                  key={`${item.category}-${item.key}`}
                  item={item}
                  onInsert={insert}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                />
              ))}
              {sectionCodeComponents.map((component) => (
                <CatalogComponent
                  key={`${component.id}@${component.version}`}
                  name={component.displayName}
                  description={component.description}
                  version={component.version}
                  tone="code"
                  onClick={() => {
                    onInsertCodeComponent?.(component.id, component.version);
                  }}
                />
              ))}
              {sectionComponents.map(component => (
                <div key={component.id} className="col-span-2">
                  <HtmlComponentCard
                    component={component}
                    previewDocument={componentPreviews[component.id] || "<!doctype html><html><body></body></html>"}
                    onInsert={() => {
                      onInsertComponent?.(component.id);
                    }}
                    onEdit={() => {
                      onEditComponent?.(component.id);
                    }}
                    onRename={() => {
                      onRenameComponent?.(component.id);
                    }}
                    onDelete={() => onDeleteComponent?.(component.id)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <p className="text-[11px] font-medium text-foreground">
                  {search
                    ? "Nenhum resultado encontrado"
                    : "Nenhum item nesta categoria"}
                </p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                  {search
                    ? "Tente um termo mais curto ou outra categoria."
                    : "Os itens disponíveis aparecerão aqui."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export const HtmlInsertMenu = memo(HtmlInsertMenuImpl);
