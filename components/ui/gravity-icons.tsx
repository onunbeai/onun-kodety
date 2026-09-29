import * as React from "react";
import * as Gravity from "@gravity-ui/icons";

/**
 * Compatibility props for the icon components used throughout the editor.
 *
 * Gravity UI glyphs are regular SVG components. This thin renderer keeps the
 * familiar `size` prop and the CSS class API that the editor already uses,
 * while making Gravity UI the single source of icon artwork.
 */
export interface GravityIconProps extends React.SVGProps<SVGSVGElement> {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}

export type LucideIcon = React.ComponentType<GravityIconProps>;

type Glyph = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function createGravityIcon(
  GlyphComponent: Glyph,
  displayName: string,
): LucideIcon {
  const Component = React.memo(function GravityIconComponent({
    size,
    width,
    height,
    absoluteStrokeWidth: _absoluteStrokeWidth,
    ...props
  }: GravityIconProps) {
    const dimensions =
      size === undefined && width === undefined && height === undefined
        ? {}
        : {
            width: width ?? size,
            height: height ?? size,
          };
    return (
      <GlyphComponent
        aria-hidden={props["aria-label"] ? undefined : true}
        focusable="false"
        {...dimensions}
        {...props}
      />
    );
  });
  Component.displayName = displayName;
  return Component;
}

export const Activity = createGravityIcon(Gravity.Pulse, "Activity");
export const AlertTriangle = createGravityIcon(Gravity.TriangleExclamation, "AlertTriangle");
export const AlignCenter = createGravityIcon(Gravity.TextAlignCenter, "AlignCenter");
export const AlignLeft = createGravityIcon(Gravity.TextAlignLeft, "AlignLeft");
export const AlignRight = createGravityIcon(Gravity.TextAlignRight, "AlignRight");
export const AppWindow = createGravityIcon(Gravity.LayoutCellsLarge, "AppWindow");
export const Archive = createGravityIcon(Gravity.Archive, "Archive");
export const ArrowsExpandHorizontal = createGravityIcon(Gravity.ArrowsExpandHorizontal, "ArrowsExpandHorizontal");
export const ArrowDown = createGravityIcon(Gravity.ArrowDown, "ArrowDown");
export const ArrowLeft = createGravityIcon(Gravity.ArrowLeft, "ArrowLeft");
export const ArrowRight = createGravityIcon(Gravity.ArrowRight, "ArrowRight");
export const ArrowRightLeft = createGravityIcon(Gravity.ArrowRightArrowLeft, "ArrowRightLeft");
export const ArrowUp = createGravityIcon(Gravity.ArrowUp, "ArrowUp");
export const ArrowUpDown = createGravityIcon(Gravity.ArrowUpArrowDown, "ArrowUpDown");
export const ArrowUpRight = createGravityIcon(Gravity.ArrowUpRight, "ArrowUpRight");
export const BadgeCheck = createGravityIcon(Gravity.SealCheck, "BadgeCheck");
export const Ban = createGravityIcon(Gravity.Ban, "Ban");
export const BarChart3 = createGravityIcon(Gravity.ChartBar, "BarChart3");
export const Bot = createGravityIcon(Gravity.FaceRobot, "Bot");
export const Box = createGravityIcon(Gravity.Box, "Box");
export const BoxSelect = createGravityIcon(Gravity.SquareDashed, "BoxSelect");
export const Braces = createGravityIcon(Gravity.CurlyBrackets, "Braces");
export const Cable = createGravityIcon(Gravity.PlugWire, "Cable");
export const Calendar = createGravityIcon(Gravity.Calendar, "Calendar");
export const ChartNoAxesColumnIncreasing = createGravityIcon(Gravity.ChartColumn, "ChartNoAxesColumnIncreasing");
export const Check = createGravityIcon(Gravity.Check, "Check");
export const CheckCircle2 = createGravityIcon(Gravity.CircleCheck, "CheckCircle2");
export const CheckIcon = Check;
export const CheckSquare = createGravityIcon(Gravity.SquareCheck, "CheckSquare");
export const ChevronDown = createGravityIcon(Gravity.ChevronDown, "ChevronDown");
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = createGravityIcon(Gravity.ChevronLeft, "ChevronLeft");
export const ChevronRight = createGravityIcon(Gravity.ChevronRight, "ChevronRight");
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = createGravityIcon(Gravity.ChevronUp, "ChevronUp");
export const ChevronUpIcon = ChevronUp;
export const ChevronsExpandToLines = createGravityIcon(Gravity.ChevronsExpandToLines, "ChevronsExpandToLines");
export const Circle = createGravityIcon(Gravity.Circle, "Circle");
export const CircleDot = createGravityIcon(Gravity.SquareDot, "CircleDot");
export const CircleHelp = createGravityIcon(Gravity.CircleQuestion, "CircleHelp");
export const CircleIcon = Circle;
export const CirclePlay = createGravityIcon(Gravity.CirclePlay, "CirclePlay");
export const CircleUserRound = createGravityIcon(Gravity.Person, "CircleUserRound");
export const Clipboard = createGravityIcon(Gravity.SquareArticle, "Clipboard");
export const ClipboardCopy = createGravityIcon(Gravity.Copy, "ClipboardCopy");
export const ClipboardPaste = createGravityIcon(Gravity.CopyArrowRight, "ClipboardPaste");
export const Clock3 = createGravityIcon(Gravity.Clock, "Clock3");
export const Code2 = createGravityIcon(Gravity.Code, "Code2");
export const CodeXml = createGravityIcon(Gravity.Code, "CodeXml");
export const Columns3 = createGravityIcon(Gravity.LayoutColumns3, "Columns3");
/**
 * Component glyph used across the builder.
 *
 * Keep this as the familiar four-diamond mark used by visual design tools,
 * rather than a generic collection of shapes. Code Components deliberately
 * keep their own `Code2` glyph at their call sites.
 */
export const Component: LucideIcon = React.memo(function ComponentIcon({
  size,
  width,
  height,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...props
}: GravityIconProps) {
  const dimensions =
    size === undefined && width === undefined && height === undefined
      ? {}
      : {
          width: width ?? size,
          height: height ?? size,
        };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      {...dimensions}
      {...props}
    >
      <path
        d="M12 2.75 16.625 7.375 12 12 7.375 7.375 12 2.75Zm-4.625 4.625L12 12l-4.625 4.625L2.75 12l4.625-4.625Zm9.25 0L21.25 12l-4.625 4.625L12 12l4.625-4.625ZM12 12l4.625 4.625L12 21.25l-4.625-4.625L12 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
});
Component.displayName = "Component";
export const Container = createGravityIcon(Gravity.Frame, "Container");
export const Copy = createGravityIcon(Gravity.Copy, "Copy");
export const CornerUpLeft = createGravityIcon(Gravity.ArrowUturnCcwLeft, "CornerUpLeft");
export const Crosshair = createGravityIcon(Gravity.Target, "Crosshair");
export const Database = createGravityIcon(Gravity.Database, "Database");
export const Diamond = createGravityIcon(Gravity.Diamond, "Diamond");
export const Download = createGravityIcon(Gravity.ArrowDownToSquare, "Download");
export const Droplet = createGravityIcon(Gravity.Droplet, "Droplet");
export const Ellipsis = createGravityIcon(Gravity.Ellipsis, "Ellipsis");
export const ExternalLink = createGravityIcon(Gravity.ArrowUpRightFromSquare, "ExternalLink");
export const Eye = createGravityIcon(Gravity.Eye, "Eye");
export const EyeOff = createGravityIcon(Gravity.EyeSlash, "EyeOff");
export const FileCode2 = createGravityIcon(Gravity.FileCode, "FileCode2");
export const FileJson2 = createGravityIcon(Gravity.FileCode, "FileJson2");
export const FilePlus2 = createGravityIcon(Gravity.FilePlus, "FilePlus2");
export const FileSpreadsheet = createGravityIcon(Gravity.FileLetterX, "FileSpreadsheet");
export const FileText = createGravityIcon(Gravity.FileText, "FileText");
export const FileType2 = createGravityIcon(Gravity.FileText, "FileType2");
export const Filter = createGravityIcon(Gravity.Funnel, "Filter");
export const FlaskConical = createGravityIcon(Gravity.Flask, "FlaskConical");
export const Folder = createGravityIcon(Gravity.Folder, "Folder");
export const FolderOpen = createGravityIcon(Gravity.FolderOpen, "FolderOpen");
export const FormInput = createGravityIcon(Gravity.FontCursor, "FormInput");
export const Frames = createGravityIcon(Gravity.Frames, "Frames");
export const Funnel = createGravityIcon(Gravity.Funnel, "Funnel");
export const Gauge = createGravityIcon(Gravity.Speedometer, "Gauge");
export const Globe = createGravityIcon(Gravity.Globe, "Globe");
export const Globe2 = Globe;
export const Grid2X2 = createGravityIcon(Gravity.LayoutCells, "Grid2X2");
export const GripVertical = createGravityIcon(Gravity.Grip, "GripVertical");
export const Group = createGravityIcon(Gravity.Boxes3, "Group");
export const Hand = createGravityIcon(Gravity.Hand, "Hand");
export const Hash = createGravityIcon(Gravity.Hashtag, "Hash");
export const Heading = createGravityIcon(Gravity.Heading, "Heading");
export const Heart = createGravityIcon(Gravity.Heart, "Heart");
export const History = createGravityIcon(Gravity.ClockArrowRotateLeft, "History");
export const Home = createGravityIcon(Gravity.House, "Home");
export const House = createGravityIcon(Gravity.House, "House");
export const Image = createGravityIcon(Gravity.Picture, "Image");
export const ImageIcon = Image;
export const ImagePlay = createGravityIcon(Gravity.Video, "ImagePlay");
export const Infinity = createGravityIcon(Gravity.Arrows3RotateRight, "Infinity");
export const KeyRound = createGravityIcon(Gravity.Key, "KeyRound");
export const Keyboard = createGravityIcon(Gravity.Keyboard, "Keyboard");
export const Languages = createGravityIcon(Gravity.PlanetEarth, "Languages");
export const Laptop = createGravityIcon(Gravity.Display, "Laptop");
export const Layers3 = createGravityIcon(Gravity.Layers3Diagonal, "Layers3");
export const Library = createGravityIcon(Gravity.Books, "Library");
export const LayoutPanelTop = createGravityIcon(Gravity.LayoutHeaderCells, "LayoutPanelTop");
export const LayoutTemplate = createGravityIcon(Gravity.LayoutCellsLarge, "LayoutTemplate");
export const Link2 = createGravityIcon(Gravity.Link, "Link2");
export const List = createGravityIcon(Gravity.ListUl, "List");
export const Loader2 = createGravityIcon(Gravity.Arrows3RotateRight, "Loader2");
export const Loader2Icon = Loader2;
export const LoaderCircle = Loader2;
export const Lock = createGravityIcon(Gravity.Lock, "Lock");
export const LockKeyhole = createGravityIcon(Gravity.ShieldKeyhole, "LockKeyhole");
export const LogIn = createGravityIcon(Gravity.ArrowRightToSquare, "LogIn");
export const Mail = createGravityIcon(Gravity.Envelope, "Mail");
export const MapPin = createGravityIcon(Gravity.MapPin, "MapPin");
export const Maximize2 = createGravityIcon(Gravity.ArrowsExpand, "Maximize2");
export const Minimize2 = createGravityIcon(Gravity.ChevronsCollapseUpRight, "Minimize2");
export const Minus = createGravityIcon(Gravity.Minus, "Minus");
export const Monitor = createGravityIcon(Gravity.Display, "Monitor");
export const MonitorUp = createGravityIcon(Gravity.DisplayPulse, "MonitorUp");
export const MoreHorizontal = createGravityIcon(Gravity.Ellipsis, "MoreHorizontal");
export const MousePointer2 = createGravityIcon(Gravity.LayoutHeaderCursor, "MousePointer2");
export const MousePointerClick = createGravityIcon(Gravity.HandPointUp, "MousePointerClick");
export const MoveVertical = createGravityIcon(Gravity.CaretsExpandVertical, "MoveVertical");
export const Paintbrush = createGravityIcon(Gravity.Paintbrush, "Paintbrush");
export const Palette = createGravityIcon(Gravity.Palette, "Palette");
export const PanelTop = createGravityIcon(Gravity.LayoutHeader, "PanelTop");
export const PanelTopOpen = createGravityIcon(Gravity.LayoutHeaderCellsLarge, "PanelTopOpen");
export const Pause = createGravityIcon(Gravity.Pause, "Pause");
export const Pencil = createGravityIcon(Gravity.Pencil, "Pencil");
export const Pentagon = createGravityIcon(Gravity.NutHex, "Pentagon");
export const Play = createGravityIcon(Gravity.Play, "Play");
export const Plug = createGravityIcon(Gravity.PlugConnection, "Plug");
export const Plus = createGravityIcon(Gravity.Plus, "Plus");
export const ReceiptText = createGravityIcon(Gravity.Receipt, "ReceiptText");
export const Redo2 = createGravityIcon(Gravity.ArrowRotateRight, "Redo2");
export const RefreshCw = createGravityIcon(Gravity.ArrowsRotateRight, "RefreshCw");
export const Repeat2 = createGravityIcon(Gravity.Arrows3RotateRight, "Repeat2");
export const Rocket = createGravityIcon(Gravity.Rocket, "Rocket");
export const RotateCcw = createGravityIcon(Gravity.ArrowRotateLeft, "RotateCcw");
export const RotateCw = createGravityIcon(Gravity.ArrowRotateRight, "RotateCw");
export const Route = createGravityIcon(Gravity.Route, "Route");
export const Rows3 = createGravityIcon(Gravity.LayoutRows3, "Rows3");
export const Save = createGravityIcon(Gravity.FloppyDisk, "Save");
export const Scan = createGravityIcon(Gravity.Frame, "Scan");
export const ScanSearch = createGravityIcon(Gravity.FileMagnifier, "ScanSearch");
export const Search = createGravityIcon(Gravity.Magnifier, "Search");
export const SearchCheck = createGravityIcon(Gravity.ListCheck, "SearchCheck");
export const Send = createGravityIcon(Gravity.PaperPlane, "Send");
export const Settings2 = createGravityIcon(Gravity.Gear, "Settings2");
export const Share2 = createGravityIcon(Gravity.NodesRight, "Share2");
export const ShieldAlert = createGravityIcon(Gravity.ShieldExclamation, "ShieldAlert");
export const ShieldCheck = createGravityIcon(Gravity.ShieldCheck, "ShieldCheck");
export const ShoppingCart = createGravityIcon(Gravity.ShoppingCart, "ShoppingCart");
export const SlidersHorizontal = createGravityIcon(Gravity.Sliders, "SlidersHorizontal");
export const Smartphone = createGravityIcon(Gravity.Smartphone, "Smartphone");
export const Sparkles = createGravityIcon(Gravity.Sparkles, "Sparkles");
export const Square = createGravityIcon(Gravity.Square, "Square");
export const Star = createGravityIcon(Gravity.Star, "Star");
export const Tablet = createGravityIcon(Gravity.Smartphone, "Tablet");
export const TextCursorInput = createGravityIcon(Gravity.FontCursor, "TextCursorInput");
export const ToggleLeft = createGravityIcon(Gravity.ToggleOff, "ToggleLeft");
export const VolumeX = createGravityIcon(Gravity.VolumeXmark, "VolumeX");
export const Trash2 = createGravityIcon(Gravity.TrashBin, "Trash2");
export const Trophy = createGravityIcon(Gravity.Medal, "Trophy");
export const Type = createGravityIcon(Gravity.Font, "Type");
export const Undo2 = createGravityIcon(Gravity.ArrowRotateLeft, "Undo2");
export const Ungroup = createGravityIcon(Gravity.Shapes3, "Ungroup");
export const Unlink = createGravityIcon(Gravity.LinkSlash, "Unlink");
export const Unlock = createGravityIcon(Gravity.LockOpen, "Unlock");
export const UnlockKeyhole = createGravityIcon(Gravity.LockOpen, "UnlockKeyhole");
export const Upload = createGravityIcon(Gravity.ArrowUpFromSquare, "Upload");
export const UploadCloud = createGravityIcon(Gravity.CloudArrowUpIn, "UploadCloud");
export const UserRoundCheck = createGravityIcon(Gravity.PersonPlus, "UserRoundCheck");
export const UserRoundCog = createGravityIcon(Gravity.PersonGear, "UserRoundCog");
export const UserRoundX = createGravityIcon(Gravity.PersonXmark, "UserRoundX");
export const Users = createGravityIcon(Gravity.Persons, "Users");
export const UsersRound = Users;
export const Variable = createGravityIcon(Gravity.Function, "Variable");
export const WalletCards = createGravityIcon(Gravity.Wallet, "WalletCards");
export const Waypoints = createGravityIcon(Gravity.GraphNode, "Waypoints");
export const X = createGravityIcon(Gravity.Xmark, "X");
export const Zap = createGravityIcon(Gravity.Thunderbolt, "Zap");
export const ZapFill = createGravityIcon(Gravity.ThunderboltFill, "ZapFill");
export const ZoomIn = createGravityIcon(Gravity.MagnifierPlus, "ZoomIn");
export const ZoomOut = createGravityIcon(Gravity.MagnifierMinus, "ZoomOut");

/**
 * Gravity does not currently expose notebook or wide-viewport glyphs. Keep
 * these two semantic viewport exceptions in the same filled 16px visual
 * language instead of substituting an unrelated Gravity metaphor.
 */
export const Notebook = React.memo(function Notebook({
  size,
  width,
  height,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...props
}: GravityIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      width={width ?? size ?? 16}
      height={height ?? size ?? 16}
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3.5 1.5h9A2.5 2.5 0 0 1 15 4v6.25a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75V4a2.5 2.5 0 0 1 2.5-2.5M3.5 3A1 1 0 0 0 2.5 4v5.5h11V4a1 1 0 0 0-1-1zM.75 12h14.5a.75.75 0 0 1 .67 1.085l-.25.5A1.65 1.65 0 0 1 14.194 14.5H1.806a1.65 1.65 0 0 1-1.476-.915l-.25-.5A.75.75 0 0 1 .75 12"
        clipRule="evenodd"
      />
    </svg>
  );
});
Notebook.displayName = "Notebook";

export const WideScreen = React.memo(function WideScreen({
  size,
  width,
  height,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...props
}: GravityIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      width={width ?? size ?? 16}
      height={height ?? size ?? 16}
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      {...props}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2.5 3.5h11A2.5 2.5 0 0 1 16 6v4a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 0 10V6a2.5 2.5 0 0 1 2.5-2.5M2.5 5A1 1 0 0 0 1.5 6v4a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
});
WideScreen.displayName = "WideScreen";
