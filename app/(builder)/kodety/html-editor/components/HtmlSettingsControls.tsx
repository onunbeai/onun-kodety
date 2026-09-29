'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Box,
  Braces,
  Clock3,
  Code2,
  Component,
  Database,
  Hash,
  ImageIcon,
  Link2,
  List,
  Play,
  Repeat2,
  SlidersHorizontal,
  Smartphone,
  TextCursorInput,
  ToggleLeft,
  Type,
  VolumeX,
} from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';
import { Input } from '../ycode-style/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ycode-style/ui/select';
import { Switch } from '../ycode-style/ui/switch';
import { Textarea } from '../ycode-style/ui/textarea';

export type HtmlSettingsFieldKind =
  | 'text'
  | 'number'
  | 'id'
  | 'tag'
  | 'tracking'
  | 'link'
  | 'image'
  | 'video'
  | 'audio'
  | 'component'
  | 'collection'
  | 'code'
  | 'size'
  | 'time'
  | 'option'
  | 'toggle'
  | 'controls'
  | 'autoplay'
  | 'loop'
  | 'muted'
  | 'mobile';

type FieldIcon = ComponentType<{ className?: string }>;

const FIELD_ICONS: Record<HtmlSettingsFieldKind, FieldIcon> = {
  text: Type,
  number: Hash,
  id: Hash,
  tag: Braces,
  tracking: Hash,
  link: Link2,
  image: ImageIcon,
  video: Play,
  audio: Play,
  component: Component,
  collection: Database,
  code: Code2,
  size: Box,
  time: Clock3,
  option: SlidersHorizontal,
  toggle: ToggleLeft,
  controls: SlidersHorizontal,
  autoplay: Play,
  loop: Repeat2,
  muted: VolumeX,
  mobile: Smartphone,
};

function inferHtmlSettingsToggleKind(label?: string): HtmlSettingsFieldKind {
  const value = (label || '').toLocaleLowerCase();
  if (/controls?|controles?/.test(value)) return 'controls';
  if (/autoplay|auto play|reprodu(?:ção|cao) autom[aá]tica/.test(value)) return 'autoplay';
  if (/\bloop\b/.test(value)) return 'loop';
  if (/muted?|sound off|sem som|mudo/.test(value)) return 'muted';
  if (/mobile|inline|m[oó]vel|celular/.test(value)) return 'mobile';
  return 'toggle';
}

export function inferHtmlSettingsFieldKind(label?: string): HtmlSettingsFieldKind {
  const value = (label || '').toLocaleLowerCase();
  if (/tracking|rastreamento|analytics|search console|webmaster|verifica(?:ção|cao)/.test(value)) return 'tracking';
  if (/\b(id|for \/ input id)\b/.test(value)) return 'id';
  if (/tag|html|attribute|atributo|sandbox|allow\b/.test(value)) return 'tag';
  if (/image|imagem|picture|poster|thumbnail|favicon|logo|srcset|\balt\b/.test(value)) return 'image';
  if (/video|v[ií]deo|youtube|spline/.test(value)) return 'video';
  if (/audio|[aá]udio/.test(value)) return 'audio';
  if (/component|componente|variant|variante|property|properties|propriedade/.test(value)) return 'component';
  if (/collection|cole(?:ção|cao)|cms|binding|vincula(?:ção|cao)|repetition|repeti(?:ção|cao)/.test(value)) return 'collection';
  if (/code|c[oó]digo|script|json|schema|robots|language|embed/.test(value)) return 'code';
  if (/link|url|href|email|e-mail|phone|telefone|action|source|origem|destino|endpoint|dom[ií]nio|host|perfil|\bsrc\b/.test(value)) return 'link';
  if (/width|largura|height|altura|size|tamanho|aspect|rows|linhas|cols|colunas|length|comprimento/.test(value)) return 'size';
  if (/duration|dura(?:ção|cao)|delay|atraso|start|in[ií]cio|end|fim|time|tempo|interval/.test(value)) return 'time';
  if (/number|n[uú]mero|limit|limite|count|contagem|index|[ií]ndice|step|passo|m[aá]x\.?|m[ií]n\.?/.test(value)) return 'number';
  if (/loading|carregamento|preload|priority|prioridade|decoding|method|m[eé]todo|behavior|comportamento|position|posi(?:ção|cao)|placement|direction|dire(?:ção|cao)|activation|ativa(?:ção|cao)|referrer|fit|focus|foco|target|type|tipo|idioma|tom|modelo|provedor|integra(?:ção|cao)|experi[eê]ncia/.test(value)) return 'option';
  return 'text';
}

export function HtmlSettingsFieldGlyph({
  kind,
  className,
}: {
  kind: HtmlSettingsFieldKind;
  className?: string;
}) {
  const Icon = FIELD_ICONS[kind] || TextCursorInput;
  return <Icon aria-hidden="true" className={cn('size-3.5', className)} />;
}

function fieldKindIsScrubbable(kind: HtmlSettingsFieldKind) {
  return kind === 'number' || kind === 'size' || kind === 'time';
}

interface HtmlSettingsTextControlProps {
  value: string;
  onChange(value: string): void;
  onCommit?(value: string): void;
  label: string;
  kind?: HtmlSettingsFieldKind;
  glyph?: FieldIcon;
  placeholder?: string;
  multiline?: boolean;
  scrubbable?: boolean;
  disabled?: boolean;
  inherited?: boolean;
  connected?: boolean;
  className?: string;
  inputClassName?: string;
  action?: ReactNode;
}

export function HtmlSettingsTextControl({
  value,
  onChange,
  onCommit,
  label,
  kind = inferHtmlSettingsFieldKind(label),
  glyph: Glyph,
  placeholder,
  multiline = false,
  scrubbable = fieldKindIsScrubbable(kind),
  disabled = false,
  inherited = false,
  connected = false,
  className,
  inputClassName,
  action,
}: HtmlSettingsTextControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    suffix: string;
    moved: boolean;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);
  const lastRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const focusEditor = () => {
    const editor = inputRef.current || textareaRef.current;
    editor?.focus();
    editor?.select();
  };

  useEffect(() => {
    lastRef.current = value;
  }, [value]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const scheduleValue = (next: string) => {
    if (lastRef.current === next) return;
    lastRef.current = next;
    pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) onChange(pending);
    });
  };
  const flushValue = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) onChange(pending);
    onCommit?.(lastRef.current);
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (!scrubbable) {
      focusEditor();
      return;
    }
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    scrubRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: match ? Number.parseFloat(match[1]) : 0,
      suffix: match?.[2] || '',
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    const delta = event.clientX - scrub.startX;
    if (!scrub.moved && Math.abs(delta) < 3) return;
    if (!scrub.moved) {
      scrub.moved = true;
      setDragging(true);
    }
    const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const next = scrub.startValue + Math.round(delta / 2) * multiplier;
    const normalized = Number.isInteger(next) ? String(next) : String(Number(next.toFixed(2)));
    scheduleValue(`${normalized}${scrub.suffix}`);
  };
  const finishScrub = (event: PointerEvent<HTMLButtonElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (scrub.moved) flushValue();
    else focusEditor();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (!scrubbable || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(.*)$/);
    if (!match) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    const next = Number.parseFloat(match[1]) + (event.key === 'ArrowUp' ? amount : -amount);
    onChange(`${Number.isInteger(next) ? next : Number(next.toFixed(2))}${match[2] || ''}`);
  };

  const frameClass = cn(
    'group/settings-field relative flex min-w-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color]',
    'hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.075]',
    connected && 'bg-[var(--kodety-accent-muted)]',
    disabled && 'pointer-events-none opacity-45',
    multiline ? 'min-h-24 flex-col items-stretch' : 'h-9 items-stretch',
    className,
  );
  const icon = (
    <button
      type="button"
      tabIndex={-1}
      aria-label={scrubbable ? `Arraste para ajustar ${label.toLocaleLowerCase()}` : `Editar ${label.toLocaleLowerCase()}`}
      title={scrubbable ? `${label} · arraste para ajustar · Shift = ×10 · Alt = ×0,1` : label}
      className={cn(
        'shrink-0 touch-none select-none border-0 bg-black/[.07] p-0 text-white/30 outline-none transition-colors',
        multiline
          ? 'flex h-8 w-full items-center justify-start border-b border-white/[.045] px-2.5'
          : 'grid w-9 place-items-center border-r border-white/[.045]',
        scrubbable ? 'cursor-ew-resize' : 'cursor-text',
        'group-hover/settings-field:text-white/48 group-focus-within/settings-field:text-[var(--kodety-accent-hover)]',
        dragging && 'bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)]',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishScrub}
      onPointerCancel={finishScrub}
      onContextMenu={event => event.preventDefault()}
    >
      {Glyph ? <Glyph className="size-3.5" /> : <HtmlSettingsFieldGlyph kind={kind} />}
    </button>
  );

  if (multiline) {
    return (
      <div data-html-settings-control data-field-kind={kind} className={frameClass}>
        {icon}
        <Textarea
          ref={textareaRef}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
          onBlur={event => onCommit?.(event.currentTarget.value)}
          className={cn('min-h-20 w-full flex-1 resize-y rounded-none border-0 bg-transparent px-2.5 py-2 text-[11px] leading-4 shadow-none outline-none focus-visible:ring-0', inputClassName)}
        />
        {action}
      </div>
    );
  }

  return (
    <div data-html-settings-control data-field-kind={kind} className={frameClass}>
      {icon}
      <Input
        ref={inputRef}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={scrubbable ? 'decimal' : undefined}
        disableKeyboardStep
        onChange={event => onChange(event.target.value)}
        onBlur={event => onCommit?.(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-[11px] shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0',
          inherited && 'text-muted-foreground',
          inputClassName,
        )}
      />
      {inherited && <span className="pointer-events-none my-auto mr-2 size-1.5 shrink-0 rounded-full bg-amber-400" title="Computed or inherited value" />}
      {action}
    </div>
  );
}

export interface HtmlSettingsSelectOption {
  value: string;
  authoredLabel?: boolean;
  label: string;
  disabled?: boolean;
}

export function HtmlSettingsSelectControl({
  value,
  onChange,
  options,
  label,
  kind = inferHtmlSettingsFieldKind(label),
  glyph: Glyph,
  placeholder = '—',
  allowUnset = true,
  disabled = false,
  className,
}: {
  value: string;
  onChange(value: string): void;
  options: HtmlSettingsSelectOption[];
  label: string;
  kind?: HtmlSettingsFieldKind;
  glyph?: FieldIcon;
  placeholder?: string;
  allowUnset?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const selectedValue = value || (allowUnset ? '__kodety_unset__' : value);
  return (
    <Select
      value={selectedValue}
      onValueChange={next => onChange(next === '__kodety_unset__' ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger
        data-html-settings-control
        data-field-kind={kind}
        aria-label={label}
        className={cn(
          'group h-9 w-full gap-0 overflow-hidden rounded-[9px] border-transparent bg-white/[.055] p-0 pr-2.5 text-[11px]',
          'hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] data-[state=open]:border-[var(--kodety-focus)]/75 data-[state=open]:bg-white/[.075]',
          className,
        )}
      >
        <span className="mr-2 grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-data-[state=open]:text-[var(--kodety-accent-hover)]">
          {Glyph ? <Glyph className="size-3.5" /> : <HtmlSettingsFieldGlyph kind={kind} />}
        </span>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[var(--radix-select-trigger-width)]">
        {allowUnset && <SelectItem value="__kodety_unset__">{placeholder}</SelectItem>}
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            <span data-kodety-no-i18n={option.authoredLabel ? true : undefined}>{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function HtmlSettingsToggleControl({
  label,
  description,
  checked,
  onChange,
  kind = inferHtmlSettingsToggleKind(label),
  glyph: Glyph,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
  kind?: HtmlSettingsFieldKind;
  glyph?: FieldIcon;
  disabled?: boolean;
}) {
  return (
    <div
      data-html-settings-control
      data-project-settings-control
      data-kodety-settings-control
      data-field-kind={kind}
      className={cn(
        'group/settings-toggle flex min-h-10 min-w-0 items-center overflow-hidden rounded-[9px] border border-transparent bg-white/[.04] transition-colors hover:bg-white/[.06] focus-within:border-[var(--kodety-focus)]/65',
        disabled && 'pointer-events-none opacity-45',
      )}
    >
      <span className="grid min-h-10 w-9 self-stretch place-items-center border-r border-white/[.045] bg-black/[.06] text-white/28 transition-colors group-hover/settings-toggle:text-white/45">
        {Glyph ? <Glyph className="size-3.5" /> : <HtmlSettingsFieldGlyph kind={kind} />}
      </span>
      <span className="min-w-0 flex-1 px-2.5 py-2">
        <span className="block truncate text-[11px] font-medium text-foreground/88">{label}</span>
        {description && <span data-kodety-settings-description className="mt-0.5 block text-[9px] leading-3.5 text-muted-foreground/80">{description}</span>}
      </span>
      <Switch
        className="relative mr-2.5 shrink-0 before:absolute before:-inset-2"
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

export function HtmlSettingsActionSlot({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-full w-9 shrink-0 place-items-center border-l border-white/[.045] bg-black/[.06] [&>button]:size-full [&>button]:rounded-none">
      {children}
    </span>
  );
}

export function HtmlSettingsInlineListGlyph() {
  return <List aria-hidden="true" className="size-3.5" />;
}
