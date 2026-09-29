import * as React from "react";
import * as Gravity from "@gravity-ui/icons";

export type IconName =
  | "x" | "layers" | "database" | "plus" | "chevronCombo" | "chevronDown" | "chevronUp" | "check"
  | "textAlignLeft" | "textAlignRight" | "textAlignCenter" | "textAlignJustify" | "individualBorders"
  | "borders" | "borderTopLeft" | "letterSpacing" | "lineHeight" | "columns" | "rows" | "grid"
  | "alignStart" | "alignCenter" | "alignEnd" | "alignStretch" | "verticalGap" | "horizontalGap"
  | "link" | "paddingSide" | "block" | "section" | "container" | "separator" | "image" | "icon"
  | "video" | "text" | "layout" | "heading" | "type" | "file-text" | "edit" | "box"
  | "chevronRight" | "chevronLeft" | "minSize" | "maxSize" | "undo" | "redo" | "page"
  | "dynamicPage" | "homepage" | "folder" | "dotsHorizontal" | "refresh" | "more" | "copy"
  | "component" | "arrowLeft" | "bold" | "italic" | "underline" | "strikethrough"
  | "subscript" | "superscript" | "quote" | "listOrdered" | "listUnordered" | "code"
  | "pencil" | "eye" | "eye-off" | "trash" | "grip-vertical" | "upload" | "search"
  | "rich-text" | "audio" | "cursor-default" | "form" | "input" | "textarea" | "select"
  | "checkbox" | "radio" | "zap" | "zap-outline" | "loopAlternate" | "loopRepeat" | "globe"
  | "ease-linear" | "ease-in" | "ease-in-out" | "ease-out" | "ease-back-in"
  | "ease-back-in-out" | "ease-back-out" | "none" | "play" | "stop" | "info" | "preview"
  | "linear" | "radial" | "color" | "fill-image" | "eyedrop" | "calendar" | "hash"
  | "paintbrush" | "swatch" | "cube" | "triangle-down" | "triangle-right" | "plus-circle"
  | "plus-circle-solid" | "detach" | "email" | "phone" | "desktop" | "mobile" | "paperclip"
  | "unlink" | "map" | "paragraph" | "droplet" | "expand" | "collapse" | "filter"
  | "crosshair" | "lightbox" | "slider" | "slide" | "slides" | "slide-button-prev"
  | "slide-button-next" | "slide-bullets" | "slide-bullet" | "slide-navigation"
  | "slide-fraction" | "loop-alternate" | "loop-repeat" | "listItem" | "external-link"
  | "settings" | "center-block" | "code-block" | "table" | "table-row" | "table-cell"
  | "add-column" | "add-row" | "delete-column" | "delete-row" | "delete-table" | "header"
  | "body" | "webflow" | "figma" | "space" | "arrow-left-up" | "arrow-up"
  | "arrow-right-up" | "arrow-left" | "arrow-right" | "arrow-left-down" | "arrow-down"
  | "arrow-right-down" | "circle";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
}

type Glyph = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const CenterElementHorizontal = ({
  ...svgProps
}: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...svgProps}
  >
    <path
      d="M1.75 3.25v9.5M14.25 3.25v9.5M3 8h1.5M11.5 8H13"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <rect x="4.5" y="4.5" width="7" height="7" rx="1.75" fill="currentColor" />
  </svg>
);

const ICONS: Record<IconName, Glyph> = {
  x: Gravity.Xmark,
  layers: Gravity.Layers3Diagonal,
  database: Gravity.Database,
  plus: Gravity.Plus,
  chevronCombo: Gravity.CaretsExpandVertical,
  chevronDown: Gravity.ChevronDown,
  chevronUp: Gravity.ChevronUp,
  check: Gravity.Check,
  textAlignLeft: Gravity.TextAlignLeft,
  textAlignRight: Gravity.TextAlignRight,
  textAlignCenter: Gravity.TextAlignCenter,
  textAlignJustify: Gravity.TextAlignJustify,
  individualBorders: Gravity.Circles4Square,
  borders: Gravity.Square,
  borderTopLeft: Gravity.Frame,
  letterSpacing: Gravity.Text,
  lineHeight: Gravity.Bars,
  columns: Gravity.LayoutColumns,
  rows: Gravity.LayoutRows,
  grid: Gravity.LayoutCells,
  alignStart: Gravity.ObjectsAlignLeft,
  alignCenter: Gravity.ObjectsAlignCenterHorizontal,
  alignEnd: Gravity.ObjectsAlignRight,
  alignStretch: Gravity.ObjectsAlignJustifyHorizontal,
  verticalGap: Gravity.CaretsExpandVertical,
  horizontalGap: Gravity.ChevronsExpandHorizontal,
  link: Gravity.Link,
  paddingSide: Gravity.SquareDashed,
  block: Gravity.Square,
  section: Gravity.LayoutHeaderCellsLarge,
  container: Gravity.Frame,
  separator: Gravity.Minus,
  image: Gravity.Picture,
  icon: Gravity.Shapes3,
  video: Gravity.Video,
  text: Gravity.Text,
  layout: Gravity.LayoutCellsLarge,
  heading: Gravity.Heading,
  type: Gravity.Font,
  "file-text": Gravity.FileText,
  edit: Gravity.Pencil,
  box: Gravity.Box,
  chevronRight: Gravity.ChevronRight,
  chevronLeft: Gravity.ChevronLeft,
  minSize: Gravity.ChevronsCollapseHorizontal,
  maxSize: Gravity.ChevronsExpandHorizontal,
  undo: Gravity.ArrowRotateLeft,
  redo: Gravity.ArrowRotateRight,
  page: Gravity.File,
  dynamicPage: Gravity.FileCode,
  homepage: Gravity.House,
  folder: Gravity.Folder,
  dotsHorizontal: Gravity.Ellipsis,
  refresh: Gravity.ArrowsRotateRight,
  more: Gravity.Ellipsis,
  copy: Gravity.Copy,
  component: Gravity.Shapes4,
  arrowLeft: Gravity.ArrowLeft,
  bold: Gravity.Bold,
  italic: Gravity.Italic,
  underline: Gravity.Underline,
  strikethrough: Gravity.Strikethrough,
  subscript: Gravity.Text,
  superscript: Gravity.Superscript,
  quote: Gravity.QuoteOpen,
  listOrdered: Gravity.ListOl,
  listUnordered: Gravity.ListUl,
  code: Gravity.Code,
  pencil: Gravity.Pencil,
  eye: Gravity.Eye,
  "eye-off": Gravity.EyeSlash,
  trash: Gravity.TrashBin,
  "grip-vertical": Gravity.Grip,
  upload: Gravity.ArrowUpFromSquare,
  search: Gravity.Magnifier,
  "rich-text": Gravity.SquareDashedText,
  audio: Gravity.Volume,
  "cursor-default": Gravity.LayoutHeaderCursor,
  form: Gravity.SquareArticle,
  input: Gravity.FontCursor,
  textarea: Gravity.SquareDashedText,
  select: Gravity.LayoutList,
  checkbox: Gravity.SquareCheck,
  radio: Gravity.CircleCheck,
  zap: Gravity.ThunderboltFill,
  "zap-outline": Gravity.Thunderbolt,
  loopAlternate: Gravity.Shuffle,
  loopRepeat: Gravity.Arrows3RotateRight,
  globe: Gravity.Globe,
  "ease-linear": Gravity.ChartLine,
  "ease-in": Gravity.ChartLineArrowUp,
  "ease-in-out": Gravity.ChartLinePoints,
  "ease-out": Gravity.ChartLine,
  "ease-back-in": Gravity.ChartLinePoints,
  "ease-back-in-out": Gravity.ChartLinePoints,
  "ease-back-out": Gravity.ChartLinePoints,
  none: Gravity.Ban,
  play: Gravity.Play,
  stop: Gravity.Stop,
  info: Gravity.CircleInfo,
  preview: Gravity.Eye,
  linear: Gravity.Minus,
  radial: Gravity.CirclesConcentric,
  color: Gravity.Palette,
  "fill-image": Gravity.Picture,
  eyedrop: Gravity.Droplet,
  calendar: Gravity.Calendar,
  hash: Gravity.Hashtag,
  paintbrush: Gravity.Paintbrush,
  swatch: Gravity.Palette,
  cube: Gravity.Cube,
  "triangle-down": Gravity.TriangleDown,
  "triangle-right": Gravity.TriangleRight,
  "plus-circle": Gravity.CirclePlus,
  "plus-circle-solid": Gravity.CirclePlusFill,
  detach: Gravity.LinkSlash,
  email: Gravity.Envelope,
  phone: Gravity.Handset,
  desktop: Gravity.Display,
  mobile: Gravity.Smartphone,
  paperclip: Gravity.Paperclip,
  unlink: Gravity.LinkSlash,
  map: Gravity.Geo,
  paragraph: Gravity.Text,
  droplet: Gravity.Droplet,
  expand: Gravity.ArrowsExpand,
  collapse: Gravity.ChevronsCollapseUpRight,
  filter: Gravity.Funnel,
  crosshair: Gravity.Target,
  lightbox: Gravity.Picture,
  slider: Gravity.Sliders,
  slide: Gravity.LayoutCellsLarge,
  slides: Gravity.Layers,
  "slide-button-prev": Gravity.ChevronLeft,
  "slide-button-next": Gravity.ChevronRight,
  "slide-bullets": Gravity.Dots9,
  "slide-bullet": Gravity.Circle,
  "slide-navigation": Gravity.Bars,
  "slide-fraction": Gravity.Percent,
  "loop-alternate": Gravity.Shuffle,
  "loop-repeat": Gravity.Arrows3RotateRight,
  listItem: Gravity.SquareLineHorizontal,
  "external-link": Gravity.ArrowUpRightFromSquare,
  settings: Gravity.Gear,
  "center-block": CenterElementHorizontal,
  "code-block": Gravity.TerminalLine,
  table: Gravity.LayoutCells,
  "table-row": Gravity.LayoutRows,
  "table-cell": Gravity.LayoutCells,
  "add-column": Gravity.LayoutColumns3,
  "add-row": Gravity.LayoutRows3,
  "delete-column": Gravity.LayoutColumns,
  "delete-row": Gravity.LayoutRows,
  "delete-table": Gravity.TrashBin,
  header: Gravity.LayoutHeader,
  body: Gravity.LayoutSideContent,
  webflow: Gravity.Globe,
  figma: Gravity.LogoFigma,
  space: Gravity.SquareDashed,
  "arrow-left-up": Gravity.ArrowUpLeft,
  "arrow-up": Gravity.ArrowUp,
  "arrow-right-up": Gravity.ArrowUpRight,
  "arrow-left": Gravity.ArrowLeft,
  "arrow-right": Gravity.ArrowRight,
  "arrow-left-down": Gravity.ArrowDownLeft,
  "arrow-down": Gravity.ArrowDown,
  "arrow-right-down": Gravity.ArrowDownRight,
  circle: Gravity.Circle,
};

export const iconExists = (name: string): name is IconName => name in ICONS;

export const Icon = React.memo(function Icon({
  name,
  ...svgProps
}: IconProps) {
  const GlyphComponent = ICONS[name];
  return (
    <GlyphComponent
      aria-hidden={svgProps["aria-label"] ? undefined : true}
      focusable="false"
      {...svgProps}
    />
  );
});

export default Icon;
