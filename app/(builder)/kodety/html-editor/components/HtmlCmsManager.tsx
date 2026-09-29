'use client';

import { cmsFetch, cmsHostConfig } from '@/lib/html-editor/cms-host';
import { initialCmsCollection, resolveCmsCollection } from '@/lib/html-editor/cms-selection';

import { DisclosureSummary } from '@/components/ui/disclosure-summary';

import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  AlignLeft,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Globe,
  Hash,
  ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ToggleLeft,
  Trash2,
  Type,
  Upload,
  X,
} from '@/components/ui/gravity-icons';
import { FolderWithFilesIcon } from '@solar-icons/react/bold-duotone/folder-with-files';
import { LayersIcon } from '@solar-icons/react/bold-duotone/layers';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { registerWorkspaceNavigationGuard, WORKSPACE_NAVIGATION_CANCELLED_EVENT } from '@/lib/html-editor/workspace-navigation';
import { notifyWorkspaceDraftChanged } from '@/lib/html-editor/workspace-draft';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CMS_SCHEMA_INVALIDATED_EVENT,
  CMS_SCHEMA_UPDATED_EVENT,
  fetchCmsSchema,
  invalidateCmsSchemaCache,
  type CmsField,
  type CmsItem,
  type CmsSchema,
  type CmsType,
} from './HtmlCmsBindings';
import { HtmlDatePicker as CmsDatePicker } from './HtmlDatePicker';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import { HtmlSettingsToggleControl } from './HtmlSettingsControls';

const CmsColorPicker = lazy(() => import('@/app/(builder)/kodety/components/ColorPicker'));
const HtmlCmsCsvImport = lazy(() =>
  import('./HtmlCmsCsvImport').then(module => ({ default: module.HtmlCmsCsvImport })),
);

function CmsColorPickerFallback() {
  return (
    <div
      aria-busy="true"
      className="flex h-9 items-center rounded-[9px] border border-white/[.055] bg-white/[.035] px-3 text-[10px] text-muted-foreground"
    >
      Carregando seletor de cor…
    </div>
  );
}

interface ManagerConfig {
  cmsRuntime?: 'static';
  settingsUrl?: string;
  cmsSchemaUrl?: string;
  cmsItemsUrl?: string;
  cmsCollectionsUrl?: string;
  cmsFieldsUrl?: string;
  mediaUploadUrl?: string;
  nonce?: string;
  aiGenerateUrl?: string;
  canManageCmsSchema?: boolean;
  canUseAi?: boolean;
  readOnly?: boolean;
  product?: {
    edition: 'pro';
    licensed: boolean;
    licenseStatus?: string;
    licensePlan?: string;
    features: Record<string, boolean>;
    limits: {
      collections: number | null;
      connectedCollections: number | null;
      itemsPerCollection: number | null;
    };
    upgradeUrl: string;
    licenseUrl: string;
  };
}

interface KodetyFieldDefinition {
  name: string;
  label: string;
  type: string;
  description: string;
  required: boolean;
  default: unknown;
  min?: number | '';
  max?: number | '';
  step?: number;
  unit?: string;
}

export const KODETY_FIELD_TYPES: Array<{
  value: string;
  label: string;
  description: string;
  icon: typeof Type;
}> = [
  {
    value: 'text',
    label: 'Texto simples',
    description: 'Nome, etiqueta ou frase curta',
    icon: Type,
  },
  {
    value: 'textarea',
    label: 'Texto longo',
    description: 'Descrições com várias linhas',
    icon: AlignLeft,
  },
  {
    value: 'richtext',
    label: 'Texto formatado',
    description: 'Conteúdo rico em HTML',
    icon: FileText,
  },
  {
    value: 'date',
    label: 'Data',
    description: 'Data de publicação ou evento',
    icon: Calendar,
  },
  {
    value: 'url',
    label: 'Link',
    description: 'URL externa ou interna',
    icon: Link2,
  },
  {
    value: 'image',
    label: 'Imagem',
    description: 'Imagem da Biblioteca de Mídia',
    icon: ImageIcon,
  },
  {
    value: 'color',
    label: 'Cor',
    description: 'Valor visual de cor',
    icon: Palette,
  },
  {
    value: 'boolean',
    label: 'Toggle',
    description: 'Opção ligada ou desligada',
    icon: ToggleLeft,
  },
  {
    value: 'number',
    label: 'Número',
    description: 'Preço, ordem ou quantidade',
    icon: Hash,
  },
];

function FieldTypeIcon({ type, className = 'size-3.5' }: { type: string; className?: string }) {
  const Icon = KODETY_FIELD_TYPES.find(option => option.value === type)?.icon || Type;
  return <Icon className={className} />;
}

function CmsCheckbox({
  checked,
  onCheckedChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <span className="inline-grid size-4 shrink-0 place-items-center">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={event => onCheckedChange(event.target.checked)}
        className={`col-start-1 row-start-1 size-4 appearance-none rounded-[4px] border transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--kodety-panel)] disabled:cursor-not-allowed disabled:opacity-40 ${
          checked
            ? 'border-[var(--kodety-accent-border)] bg-[var(--kodety-accent)]'
            : 'border-white/[.14] bg-white/[.035] hover:border-white/[.24] hover:bg-white/[.055]'
        }`}
      />
      {checked ? <Check aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 size-3 text-white" /> : null}
    </span>
  );
}

function CmsColumnHeader({
  field,
  activeSortField,
  sortOrder,
  canEdit,
  canHide,
  onEdit,
  onSort,
  onHide,
}: {
  field: CmsField;
  activeSortField: string;
  sortOrder: 'ASC' | 'DESC';
  canEdit: boolean;
  canHide: boolean;
  onEdit: () => void;
  onSort: (order: 'ASC' | 'DESC') => void;
  onHide: () => void;
}) {
  const ascendingLabel = field.key === 'status'
    ? 'Rascunho → Publicado'
    : field.type === 'number'
      ? 'Menor → maior'
      : field.type === 'date' || field.key === 'modified'
        ? 'Mais antigo → recente'
        : 'A → Z';
  const descendingLabel = field.key === 'status'
    ? 'Publicado → Rascunho'
    : field.type === 'number'
      ? 'Maior → menor'
      : field.type === 'date' || field.key === 'modified'
        ? 'Mais recente → antigo'
        : 'Z → A';
  const active = activeSortField === field.key;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group/cms-column flex h-11 w-full min-w-0 items-center gap-1.5 text-left outline-none focus-visible:text-foreground"
          aria-label={`Opções da coluna ${field.label}`}
        >
          <span className="min-w-0 flex-1 truncate">{field.label}</span>
          {active ? (
            sortOrder === 'ASC'
              ? <ChevronUp aria-hidden="true" className="size-3 shrink-0 text-white/48" />
              : <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-white/48" />
          ) : (
            <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-white/0 transition-colors group-hover/cms-column:text-white/30 group-focus-visible/cms-column:text-white/30" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-kodety-cms-surface
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="z-[10020] min-w-40 rounded-[10px] border-white/[.08] bg-[#1b1b1b] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.4)]"
      >
        {canEdit ? (
          <>
            <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={onEdit}>
              <Pencil className="size-3" /> Editar campo
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/[.055]" />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-8 rounded-[7px] text-[10px]">
            Ordenar por
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent
              collisionPadding={12}
              className="z-[10021] min-w-44 rounded-[10px] border-white/[.08] bg-[#1b1b1b] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,.4)]"
            >
              <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={() => onSort('ASC')}>
                <span className="min-w-0 flex-1">{ascendingLabel}</span>
                {active && sortOrder === 'ASC' ? <Check className="size-3 text-white/60" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={() => onSort('DESC')}>
                <span className="min-w-0 flex-1">{descendingLabel}</span>
                {active && sortOrder === 'DESC' ? <Check className="size-3 text-white/60" /> : null}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" disabled={!canHide} onSelect={onHide}>
          Ocultar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CmsSearchControl({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div
      data-kodety-cms-control
      data-kodety-cms-search
      data-kodety-settings-control
      className="group/cms-search relative flex h-9 min-w-0 overflow-hidden rounded-[9px] border border-white/[.035] bg-white/[.045] transition-[border-color,background-color] hover:bg-white/[.06] focus-within:border-[var(--kodety-focus)]/55 focus-within:bg-white/[.065]"
    >
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/28 transition-colors group-hover/cms-search:text-white/48 group-focus-within/cms-search:text-[var(--kodety-accent-hover)]"
      />
      <Input
        data-kodety-settings-control-inner
        type="search"
        disableKeyboardStep
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent pl-8 pr-3 text-[11px] shadow-none focus-visible:border-transparent focus-visible:ring-0"
      />
    </div>
  );
}

function CmsEmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
  }>;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-kodety-cms-card
      className="mx-auto my-10 flex w-[min(100%-32px,440px)] flex-col items-center rounded-[9px] border border-white/[.065] bg-white/[.025] px-6 py-9 text-center"
    >
      <span className="grid size-10 place-items-center rounded-[9px] bg-white/[.05] text-white/38">
        <Icon aria-hidden="true" className="size-[18px]" />
      </span>
      <p className="mt-3 text-xs font-semibold text-foreground">{title}</p>
      <p data-kodety-cms-description className="mt-1.5 max-w-sm text-[10px] leading-4 text-muted-foreground">
        {description}
      </p>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function FieldTypePicker({ onSelect }: { onSelect: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = KODETY_FIELD_TYPES.filter(option => `${option.label} ${option.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Popover
      open={open}
      onOpenChange={value => {
        setOpen(value);
        if (!value) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="secondary" className="shrink-0 rounded-[8px]" title="Adicionar campo" aria-label="Adicionar campo">
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-kodety-cms-surface
        align="start"
        className="flex max-h-[min(70vh,520px)] w-72 flex-col overflow-hidden rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-0 shadow-2xl"
      >
        <div className="shrink-0 p-2 pb-1.5">
          <CmsSearchControl value={query} onChange={setQuery} placeholder="Buscar tipo de campo…" label="Buscar tipo de campo" />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              className="group/field-type flex min-h-11 w-full items-stretch overflow-hidden rounded-[8px] border border-transparent bg-white/[.02] text-left text-muted-foreground transition-[border-color,background-color,color] hover:border-white/[.045] hover:bg-white/[.05] hover:text-foreground focus-visible:border-[var(--kodety-focus)]/70 focus-visible:outline-none"
            >
              <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.04] bg-black/[.06] text-white/28 transition-colors group-hover/field-type:text-white/55">
                <option.icon className="size-3.5" />
              </span>
              <span className="min-w-0 px-2.5 py-1.5">
                <span className="block text-xs font-medium">{option.label}</span>
                <span data-kodety-cms-description className="block text-[10px] leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
          {!options.length && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhum tipo encontrado.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function slugifyFieldName(label: string) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function managerConfig(): ManagerConfig | undefined {
  return cmsHostConfig((window as typeof window & { kodetyWordPress?: ManagerConfig }).kodetyWordPress);
}

const CMS_READ_REQUEST_TIMEOUT_MS = 12_000;

async function fetchCmsJsonWithDeadline<T>(url: string, init: RequestInit, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CMS_READ_REQUEST_TIMEOUT_MS);
  try {
    const response = await cmsFetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null) as (T & { message?: string }) | null;
    if (!response.ok) throw new Error(payload?.message || fallbackMessage);
    if (payload === null) throw new Error(fallbackMessage);
    return payload;
  } catch (error) {
    if (timedOut) throw new Error('O CMS demorou mais de 12 segundos para responder. Tente novamente.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

class CmsMutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'CmsMutationError';
  }
}

function cmsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isCmsRevisionToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

async function cmsMutationError(response: Response, fallbackMessage: string) {
  const payload = cmsRecord(await response.json().catch(() => null));
  const nested = cmsRecord(payload?.data);
  return new CmsMutationError(
    typeof payload?.message === 'string' ? payload.message : fallbackMessage,
    response.status,
    typeof payload?.code === 'string' ? payload.code : '',
    nested || payload,
  );
}

function isCmsRevisionError(error: unknown): error is CmsMutationError {
  return error instanceof CmsMutationError && (
    error.code === 'kodety_revision_conflict'
    || error.code === 'kodety_revision_required'
  );
}

/** Build a REST URL that works with pretty permalinks and ?rest_route= alike. */
export function restEndpoint(base: string, suffix: string, params?: Record<string, string>) {
  const url = new URL(base, window.location.href);
  const restRoute = url.searchParams.get('rest_route');
  if (restRoute) url.searchParams.set('rest_route', `${restRoute.replace(/\/$/, '')}${suffix}`);
  else url.pathname = `${url.pathname.replace(/\/$/, '')}${suffix}`;
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}

function urlWithParam(base: string, key: string, value: string) {
  const url = new URL(base, window.location.href);
  url.searchParams.set(key, value);
  return url.toString();
}

function summarizeCmsValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value);
  if (!raw) return '';
  if (typeof DOMParser === 'undefined' || !/<[a-z][\s\S]*>/i.test(raw)) return raw.replace(/\s+/g, ' ').trim().slice(0, 6000);
  const document = new DOMParser().parseFromString(raw, 'text/html');
  document.querySelectorAll('script, style, noscript, svg, template').forEach(node => node.remove());
  return (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
}

function formatCmsDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getAdminUiLocale());
}

const STATUS_LABELS: Record<string, string> = {
  publish: 'Publicado',
  draft: 'Rascunho',
  pending: 'Pendente',
  future: 'Agendado',
  private: 'Privado',
};

const READONLY_FIELDS = new Set(['permalink', 'date', 'author', 'featured_image']);

function notifyItemsChanged() {
  window.dispatchEvent(new Event('kodety-cms-items-changed'));
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'publish'
      ? 'border-transparent bg-emerald-500/10 text-emerald-300'
      : status === 'draft'
        ? 'border-transparent bg-amber-500/10 text-amber-300'
        : 'border-transparent bg-white/[0.055] text-muted-foreground';
  return (
    <Badge variant="outline" className={`rounded-[6px] px-1.5 py-0 text-[9px] font-medium ${tone}`}>
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}

function cmsValueLabels(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(entry => {
      if (entry === null || entry === undefined || entry === '') return '';
      if (typeof entry !== 'object') return String(entry);
      const record = entry as Record<string, unknown>;
      const label = record.label ?? record.name ?? record.title ?? record.value ?? record.url;
      return label === null || label === undefined ? '' : String(label);
    })
    .filter(Boolean);
}

function CmsTableCell({ field, item, onChange, canPublish }: { field: CmsField; item: CmsItem; onChange: (value: unknown) => void; canPublish: boolean }) {
  const value = field.key === 'status' ? item.status : field.key === 'title' ? (item.values.title ?? item.label) : item.values[field.key];
  const labels = cmsValueLabels(value);
  const text = labels.join(', ');
  const complexValue = value !== null && typeof value === 'object';
  const [draft, setDraft] = useState(text);
  const editOriginRef = useRef(text);
  useEffect(() => setDraft(text), [text]);
  if (field.key === 'featured_image' || field.type === 'image')
    return (
      <span className="flex h-12 items-center px-3">
        <span className="flex h-8 w-12 items-center justify-center overflow-hidden rounded-[6px] bg-white/[0.045]">
          {text ? <img src={text} alt="" className="size-full object-cover" /> : <ImageIcon className="size-3.5 text-muted-foreground" />}
        </span>
      </span>
    );
  if (field.key === 'status')
    return (
      <div className="flex h-12 items-center px-2.5" onClick={event => event.stopPropagation()}>
        <Select value={String(value || 'draft')} onValueChange={onChange}>
          <SelectTrigger
            data-cms-inline-status
            aria-label={`Status de ${item.label}`}
            className="h-6 w-auto min-w-0 gap-1 border-0 bg-transparent px-0 text-[10px] shadow-none hover:bg-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
          >
            <StatusBadge status={String(value || 'draft')} />
          </SelectTrigger>
          <SelectContent>
            {canPublish ? <SelectItem value="publish">Publicado</SelectItem> : null}
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            {canPublish ? <SelectItem value="private">Privado</SelectItem> : null}
          </SelectContent>
        </Select>
      </div>
    );
  if (['boolean', 'true_false'].includes(field.type))
    return (
      <span className="flex h-12 items-center px-3" onClick={event => event.stopPropagation()}>
        <Switch aria-label={`${field.label} de ${item.label}`} checked={value === true || value === 1 || value === '1'} onCheckedChange={onChange} />
      </span>
    );
  if (field.type === 'color')
    return (
      <span className="inline-flex h-12 items-center gap-2 px-3 text-[10px]">
        <span className="size-2.5 rounded-full border border-white/10" style={{ backgroundColor: text || 'transparent' }} />
        {text || '—'}
      </span>
    );
  if (READONLY_FIELDS.has(field.key) && field.type === 'date' && text) {
    const parsed = new Date(text);
    return (
      <span className="flex h-12 items-center px-3 text-[10px]">{Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleDateString(getAdminUiLocale())}</span>
    );
  }
  if (READONLY_FIELDS.has(field.key)) {
    const plain =
      field.type === 'richtext'
        ? text
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : text;
    return (
      <span className="flex h-12 max-w-56 items-center truncate px-3 text-[10px] text-muted-foreground" title={plain}>
        {plain || '—'}
      </span>
    );
  }
  if (complexValue) {
    return (
      <span data-cms-complex-value className="flex h-12 min-w-0 items-center gap-1 overflow-hidden px-3" title={labels.join(', ')}>
        {labels.length ? (
          labels.slice(0, 3).map((label, index) => (
            <span key={`${label}:${index}`} className="max-w-28 shrink truncate rounded-md bg-white/[0.055] px-1.5 py-0.5 text-[9px] text-foreground/80">
              {label}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
        {labels.length > 3 ? <span className="shrink-0 text-[9px] text-muted-foreground">+{labels.length - 3}</span> : null}
      </span>
    );
  }
  return (
    <input
      data-cms-inline-editor
      value={draft}
      aria-label={`Editar ${field.label}`}
      className={`h-12 w-full min-w-32 appearance-none rounded-none border-0 bg-transparent px-3 text-[11px] shadow-none outline-none ring-0 hover:bg-transparent focus:bg-transparent focus:outline-none focus:ring-0 focus-visible:outline-none ${field.key === 'title' ? 'font-medium text-foreground' : ''}`}
      onClick={event => event.stopPropagation()}
      onFocus={() => {
        editOriginRef.current = text;
      }}
      onBlur={() => {
        editOriginRef.current = draft;
      }}
      onChange={event => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          const origin = editOriginRef.current;
          setDraft(origin);
          onChange(origin);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function RichHtmlEditor({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor || editor.innerHTML === value) return;
    editor.innerHTML = value;
  }, [value]);
  const rememberSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  };
  const restoreSelection = () => {
    const selection = window.getSelection();
    const range = selectionRef.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const commit = () => onChange(editorRef.current?.innerHTML || '');
  const run = (command: string, commandValue?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, commandValue);
    rememberSelection();
    commit();
  };
  const applyTextStyle = (style: string) => {
    const styles: Record<string, { size: string; css: string }> = {
      p: { size: '3', css: 'font-size:1rem;font-weight:400;line-height:1.5' },
      h2: {
        size: '7',
        css: 'font-size:1.5rem;font-weight:700;line-height:1.2',
      },
      h3: {
        size: '6',
        css: 'font-size:1.25rem;font-weight:700;line-height:1.3',
      },
      blockquote: {
        size: '4',
        css: 'font-size:1rem;font-style:italic;line-height:1.6',
      },
    };
    const selected = styles[style] || styles.p;
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('fontSize', false, selected.size);
    editorRef.current?.querySelectorAll(`font[size="${selected.size}"]`).forEach(font => {
      const span = document.createElement('span');
      span.setAttribute('style', selected.css);
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
    rememberSelection();
    commit();
  };
  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    run('createLink', url);
    setLinkOpen(false);
    setLinkUrl('https://');
  };
  return (
    <div
      data-kodety-cms-card
      className="overflow-hidden rounded-[9px] border border-white/[.065] bg-white/[.025] transition-[border-color,background-color] hover:bg-white/[.035] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.04]"
    >
      <div
        className="flex min-h-9 flex-wrap items-center gap-0.5 border-b border-white/[.045] bg-black/[.06] px-1 py-1"
        onPointerDownCapture={rememberSelection}
        aria-label="Ferramentas de formatação"
      >
        <Select defaultValue="p" onValueChange={applyTextStyle}>
          <SelectTrigger className="h-7 w-28 rounded-[7px] border-0 bg-transparent text-[10px] shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="p">Parágrafo</SelectItem>
            <SelectItem value="h2">Título 2</SelectItem>
            <SelectItem value="h3">Título 3</SelectItem>
            <SelectItem value="blockquote">Citação</SelectItem>
          </SelectContent>
        </Select>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          className="rounded-sm bg-transparent"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Negrito"
          aria-label="Negrito"
          onClick={() => run('bold')}
        >
          <strong>B</strong>
        </Button>
        <Button
          className="rounded-sm bg-transparent"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Itálico"
          aria-label="Itálico"
          onClick={() => run('italic')}
        >
          <em>I</em>
        </Button>
        <Button
          className="rounded-sm bg-transparent"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Sublinhado"
          aria-label="Sublinhado"
          onClick={() => run('underline')}
        >
          <span className="underline">U</span>
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild>
            <Button
              className="rounded-sm bg-transparent"
              type="button"
              size="icon-xs"
              variant="ghost"
              title="Aplicar link à seleção"
              aria-label="Aplicar link à seleção"
            >
              <Link2 />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="mb-2">
              <p className="text-xs font-medium">Adicionar link</p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">A URL será aplicada ao texto selecionado.</p>
            </div>
            <div className="flex gap-1.5">
              <Input
                autoFocus
                aria-label="URL do link"
                value={linkUrl}
                onChange={event => setLinkUrl(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyLink();
                  }
                }}
              />
              <Button type="button" size="sm" disabled={!linkUrl.trim()} onClick={applyLink}>
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <Button
          className="rounded-sm bg-transparent"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Remover link da seleção"
          aria-label="Remover link da seleção"
          onClick={() => run('unlink')}
        >
          <span className="relative">
            <Link2 className="size-3.5" />
            <span className="absolute -right-1 -top-1 text-[8px]">×</span>
          </span>
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          className="rounded-sm bg-transparent text-[11px]"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Lista"
          aria-label="Lista com marcadores"
          onClick={() => run('insertUnorderedList')}
        >
          •
        </Button>
        <Button
          className="rounded-sm bg-transparent text-[10px]"
          type="button"
          size="icon-xs"
          variant="ghost"
          title="Lista numerada"
          aria-label="Lista numerada"
          onClick={() => run('insertOrderedList')}
        >
          1.
        </Button>
        <Button
          className="ml-auto rounded-sm bg-transparent"
          type="button"
          size="xs"
          variant="ghost"
          title="Remover formatação"
          onClick={() => run('removeFormat')}
        >
          Limpar
        </Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={placeholder || 'Conteúdo formatado'}
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={event => onChange(event.currentTarget.innerHTML)}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onBlur={rememberSelection}
        className="min-h-44 px-3 py-3 text-sm leading-6 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}

interface CmsImageValue {
  url: string;
  alt?: string;
  focalX?: number;
  focalY?: number;
  crop?: 'original' | 'square' | 'landscape' | 'portrait';
}

function normalizeCmsImage(value: unknown): CmsImageValue {
  if (value && typeof value === 'object') {
    const image = value as Record<string, unknown>;
    return {
      url: String(image.url || image.source_url || ''),
      alt: String(image.alt || ''),
      focalX: Number.isFinite(Number(image.focalX)) ? Number(image.focalX) : 50,
      focalY: Number.isFinite(Number(image.focalY)) ? Number(image.focalY) : 50,
      crop: ['square', 'landscape', 'portrait'].includes(String(image.crop)) ? (image.crop as CmsImageValue['crop']) : 'original',
    };
  }
  return {
    url: value ? String(value) : '',
    alt: '',
    focalX: 50,
    focalY: 50,
    crop: 'original',
  };
}

function CmsImageEditor({
  value,
  onChange,
  onUploadImage,
  uploading,
  label,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onUploadImage: (file: File, apply: (value: unknown) => void) => void;
  uploading: boolean;
  label: string;
}) {
  const normalized = normalizeCmsImage(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CmsImageValue>(normalized);
  useEffect(() => {
    if (!open) setDraft(normalizeCmsImage(value));
  }, [open, value]);
  const ratio =
    draft.crop === 'square' ? 'aspect-square' : draft.crop === 'portrait' ? 'aspect-[4/5]' : draft.crop === 'landscape' ? 'aspect-video' : 'aspect-[16/10]';
  const chooseFocalPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft.url) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDraft(current => ({
      ...current,
      focalX: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      focalY: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    }));
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(normalizeCmsImage(value));
          setOpen(true);
        }}
        data-kodety-cms-card
        className="group flex w-full items-stretch overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025] text-left transition-[border-color,background-color] hover:border-white/[.08] hover:bg-white/[.04] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:outline-none"
        aria-label={`Editar ${label}`}
      >
        <span className="flex w-20 shrink-0 items-center justify-center overflow-hidden border-r border-white/[.045] bg-black/[.07]">
          {normalized.url ? (
            <img
              src={normalized.url}
              alt={normalized.alt || ''}
              className="size-full object-cover"
              style={{
                objectPosition: `${normalized.focalX ?? 50}% ${normalized.focalY ?? 50}%`,
              }}
            />
          ) : (
            <ImageIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 px-3 py-2.5">
          <span className="block truncate text-xs font-medium">{normalized.url ? 'Editar imagem' : 'Escolher imagem'}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {normalized.url ? normalized.alt || 'Sem texto alternativo' : 'Biblioteca de Mídia ou URL'}
          </span>
        </span>
        <span className="self-center px-3 text-[10px] text-muted-foreground group-hover:text-foreground">{normalized.url ? 'Editar' : 'Adicionar'}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-kodety-cms-surface className="max-w-xl gap-0 overflow-hidden rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-0">
          <div className="border-b px-5 py-4">
            <DialogTitle>Imagem</DialogTitle>
            <DialogDescription>Escolha a mídia, descreva-a e ajuste o enquadramento sem sair do CMS.</DialogDescription>
          </div>
          <div className="space-y-4 px-5 pb-5 pt-4">
            <div
              className={`relative mx-auto w-full max-w-md overflow-hidden rounded-[9px] border border-white/[.065] bg-white/[.025] ${ratio}`}
              onPointerDown={chooseFocalPoint}
            >
              {draft.url ? (
                <>
                  <img
                    src={draft.url}
                    alt={draft.alt || ''}
                    className="size-full object-cover"
                    style={{
                      objectPosition: `${draft.focalX ?? 50}% ${draft.focalY ?? 50}%`,
                    }}
                  />
                  <span
                    className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--kodety-accent)] shadow"
                    style={{
                      left: `${draft.focalX ?? 50}%`,
                      top: `${draft.focalY ?? 50}%`,
                    }}
                  />
                </>
              ) : (
                <label className="flex size-full cursor-pointer flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:bg-accent">
                  <ImageIcon className="size-8" />
                  <span>Escolher imagem…</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={event => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file)
                        onUploadImage(file, uploaded =>
                          setDraft(current => ({
                            ...current,
                            ...normalizeCmsImage(uploaded),
                            alt: current.alt,
                          })),
                        );
                    }}
                  />
                </label>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label variant="muted">Imagem</Label>
                <div className="flex gap-2">
                  <Input
                    value={draft.url}
                    placeholder="URL da Biblioteca de Mídia"
                    onChange={event =>
                      setDraft(current => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                  />
                  <Button type="button" variant="secondary" asChild disabled={uploading}>
                    <label className="cursor-pointer">
                      {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file)
                            onUploadImage(file, uploaded =>
                              setDraft(current => ({
                                ...current,
                                ...normalizeCmsImage(uploaded),
                                alt: current.alt,
                              })),
                            );
                        }}
                      />
                    </label>
                  </Button>
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label variant="muted">Texto alternativo</Label>
                <Input
                  value={draft.alt || ''}
                  placeholder="Descreva a imagem…"
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      alt: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label variant="muted">Recorte</Label>
                <Select
                  value={draft.crop || 'original'}
                  onValueChange={crop =>
                    setDraft(current => ({
                      ...current,
                      crop: crop as CmsImageValue['crop'],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="original">Original</SelectItem>
                    <SelectItem value="square">Quadrado</SelectItem>
                    <SelectItem value="landscape">Paisagem</SelectItem>
                    <SelectItem value="portrait">Retrato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label variant="muted">Ponto focal</Label>
                <div className="flex h-9 items-center rounded-[9px] border border-transparent bg-white/[.055] px-3 text-xs text-muted-foreground">
                  {Math.round(draft.focalX ?? 50)}% × {Math.round(draft.focalY ?? 50)}%
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Clique sobre a prévia para posicionar o ponto focal. O recorte é não destrutivo e pode ser alterado depois.
            </p>
            <div className="flex items-center justify-between border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={!draft.url}
                onClick={() =>
                  setDraft({
                    url: '',
                    alt: '',
                    focalX: 50,
                    focalY: 50,
                    crop: 'original',
                  })
                }
              >
                Remover
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onChange(draft.url ? draft : '');
                    setOpen(false);
                  }}
                >
                  Aplicar imagem
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CmsFieldRow({ field, children, stacked = false }: { field: CmsField; children: React.ReactNode; stacked?: boolean }) {
  const label = (
    <>
      {field.label}
      {field.required ? <span className="ml-0.5 text-red-300">*</span> : null}
      {field.source === 'acf' ? <span className="ml-1 text-[8px] font-normal uppercase tracking-wide text-muted-foreground">ACF</span> : null}
    </>
  );
  if (stacked) {
    return (
      <div data-kodety-onboarding={`cms-item-field-${field.key}`} className="border-b border-white/[.055] py-4">
        <div className="mb-2">
          <Label variant="muted" className="text-balance">{label}</Label>
          {field.description ? (
            <p data-kodety-cms-description className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
              {field.description}
            </p>
          ) : null}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div data-kodety-onboarding={`cms-item-field-${field.key}`} className="grid grid-cols-1 gap-2 border-b border-white/[.055] py-3.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
      <div className="min-w-0 sm:pt-2">
        <Label variant="muted" className="text-balance">{label}</Label>
        {field.description ? (
          <p data-kodety-cms-description className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
            {field.description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function cmsSlugPreview(permalink: string, collectionSlug: string, slug: string) {
  const origin = typeof window === 'undefined' ? 'https://seusite.com' : window.location.origin;
  try {
    const url = new URL(permalink || `/${collectionSlug || 'collection'}/`, origin);
    const segments = url.pathname.split('/').filter(Boolean);
    if (permalink && segments.length) segments[segments.length - 1] = slug || 'slug';
    else segments.push(slug || 'slug');
    return `${url.host}/${segments.join('/')}`;
  } catch {
    return `seusite.com/${collectionSlug || 'collection'}/${slug || 'slug'}`;
  }
}

function FieldEditor({
  field,
  value,
  onChange,
  onUploadImage,
  uploading,
  permalink = '',
  collectionSlug = '',
}: {
  field: CmsField;
  value: unknown;
  onChange: (value: unknown) => void;
  onUploadImage: (file: File, apply: (value: unknown) => void) => void;
  uploading: boolean;
  permalink?: string;
  collectionSlug?: string;
}) {
  const text =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? String((value as Record<string, unknown>).url ?? (value as Record<string, unknown>).value ?? '')
        : String(value);
  if (['wysiwyg', 'richtext'].includes(field.type)) {
    return (
      <CmsFieldRow field={field} stacked>
        <RichHtmlEditor value={text} onChange={onChange} placeholder={`Escreva ${field.label.toLowerCase()}…`} />
      </CmsFieldRow>
    );
  }
  if (field.type === 'textarea') {
    return (
      <CmsFieldRow field={field}>
        <HtmlSettingsFieldControl label={field.label} kind="text">
          <Textarea aria-label={field.label} value={text} rows={4} onChange={event => onChange(event.target.value)} />
        </HtmlSettingsFieldControl>
      </CmsFieldRow>
    );
  }
  if (field.type === 'image') {
    return (
      <CmsFieldRow field={field} stacked>
        <CmsImageEditor value={value} onChange={onChange} onUploadImage={onUploadImage} uploading={uploading} label={field.label} />
      </CmsFieldRow>
    );
  }
  if (['true_false', 'boolean'].includes(field.type)) {
    const checked = value === true || value === '1' || value === 1;
    return (
      <CmsFieldRow field={field}>
        <div className="group/cms-toggle flex h-9 items-center overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/70">
          <span className="grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-hover/cms-toggle:text-white/50">
            <ToggleLeft aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 px-2.5 text-[10px] text-muted-foreground">{checked ? 'Ativado' : 'Desativado'}</span>
          <Switch aria-label={field.label} checked={checked} onCheckedChange={next => onChange(next)} />
          <span className="w-2.5" aria-hidden="true" />
        </div>
      </CmsFieldRow>
    );
  }
  if (field.type === 'number') {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
    const step = field.step && field.step > 0 ? field.step : 1;
    const minimum = field.min === '' || field.min === undefined ? undefined : Number(field.min);
    const maximum = field.max === '' || field.max === undefined ? undefined : Number(field.max);
    const update = (next: number) => onChange(Math.min(maximum ?? next, Math.max(minimum ?? next, next)));
    return (
      <CmsFieldRow field={field}>
        <div className="space-y-1.5">
          <div data-kodety-settings-control className="grid h-9 grid-cols-[36px_minmax(0,1fr)_36px] items-center overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.075]">
            <Button
              className="h-full! w-full! rounded-none bg-transparent"
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Diminuir ${field.label}`}
              onClick={() => update(numeric - step)}
              disabled={minimum !== undefined && numeric <= minimum}
            >
              −
            </Button>
            <div className="relative min-w-0 border-x border-white/[.045]">
              <Input
                data-kodety-settings-control-inner
                aria-label={field.label}
                type="number"
                value={value === '' || value === undefined ? '' : numeric}
                min={minimum}
                max={maximum}
                step={step}
                onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))}
                className={`rounded-none border-0 bg-transparent shadow-none ${field.unit ? 'pr-12' : ''}`}
              />
              {field.unit ? (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{field.unit}</span>
              ) : null}
            </div>
            <Button
              className="h-full! w-full! rounded-none bg-transparent"
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Aumentar ${field.label}`}
              onClick={() => update(numeric + step)}
              disabled={maximum !== undefined && numeric >= maximum}
            >
              +
            </Button>
          </div>
          {minimum !== undefined && maximum !== undefined && maximum > minimum ? (
            <Slider
              aria-label={`Faixa de ${field.label}`}
              value={[Math.min(maximum, Math.max(minimum, numeric))]}
              min={minimum}
              max={maximum}
              step={step}
              unit={field.unit}
              showValueInput={false}
              onValueChange={([value]) => onChange(value)}
            />
          ) : null}
        </div>
      </CmsFieldRow>
    );
  }
  if (field.type === 'date') {
    return (
      <CmsFieldRow field={field}>
        <CmsDatePicker label={field.label} value={text} onChange={onChange} />
      </CmsFieldRow>
    );
  }
  if (field.type === 'color') {
    return (
      <CmsFieldRow field={field}>
        <div data-kodety-cms-color-control className="min-w-0 *:w-full">
          <Suspense fallback={<CmsColorPickerFallback />}>
            <CmsColorPicker value={text} onChange={onChange} onImmediateChange={onChange} colorVariableCapability={null} solidOnly />
          </Suspense>
        </div>
      </CmsFieldRow>
    );
  }
  if (field.key === 'slug') {
    const preview = cmsSlugPreview(permalink, collectionSlug, text);
    return (
      <CmsFieldRow field={field}>
        <div className="space-y-2">
          <Input
            aria-label={field.label}
            value={text}
            placeholder="slug-do-item"
            onChange={event => onChange(event.target.value)}
          />
          <div className="flex min-w-0 items-center gap-2 px-0.5 text-[10px] text-muted-foreground" title={preview}>
            <Globe aria-hidden="true" className="size-3.5 shrink-0 text-white/38" />
            <span className="min-w-0 truncate">{preview}</span>
          </div>
        </div>
      </CmsFieldRow>
    );
  }
  return (
    <CmsFieldRow field={field}>
      <HtmlSettingsFieldControl label={field.label} kind={field.type === 'url' ? 'link' : 'text'}>
        <Input
          aria-label={field.label}
          value={text}
          type={field.type === 'url' ? 'url' : 'text'}
          placeholder={field.type === 'url' ? 'https://…' : undefined}
          onChange={event => onChange(event.target.value)}
        />
      </HtmlSettingsFieldControl>
    </CmsFieldRow>
  );
}

function FieldDefinitionSettings({
  field,
  onChange,
  onUploadImage,
  uploading,
}: {
  field: KodetyFieldDefinition;
  onChange: (patch: Partial<KodetyFieldDefinition>) => void;
  onUploadImage: (file: File, apply: (value: unknown) => void) => void;
  uploading: boolean;
}) {
  const defaultText = field.default === undefined || field.default === null ? '' : String(field.default);
  const changeType = (type: string) =>
    onChange({
      type,
      default: type === 'boolean' ? false : type === 'color' ? '#000000' : '',
    });
  const numberDefault = Number.isFinite(Number(field.default)) ? Number(field.default) : 0;
  const numberMin = field.min === '' || field.min === undefined ? undefined : Number(field.min);
  const numberMax = field.max === '' || field.max === undefined ? undefined : Number(field.max);
  const numberStep = field.step && field.step > 0 ? field.step : 1;
  const defaultControl =
    field.type === 'boolean' ? (
      <div className="group/cms-toggle flex h-9 items-center overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/70">
        <span className="grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-hover/cms-toggle:text-white/50">
          <ToggleLeft aria-hidden="true" className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 px-2.5 text-[11px] text-muted-foreground">{field.default ? 'Ativado' : 'Desativado'}</span>
        <Switch aria-label={`Valor padrão de ${field.label}`} checked={Boolean(field.default)} onCheckedChange={value => onChange({ default: value })} />
        <span className="w-2.5" aria-hidden="true" />
      </div>
    ) : field.type === 'color' ? (
      <div data-kodety-cms-color-control className="min-w-0 *:w-full">
        <Suspense fallback={<CmsColorPickerFallback />}>
          <CmsColorPicker value={defaultText} onChange={value => onChange({ default: value })} onImmediateChange={value => onChange({ default: value })} colorVariableCapability={null} solidOnly />
        </Suspense>
      </div>
    ) : field.type === 'image' ? (
      <div data-kodety-cms-card className="flex min-h-20 items-stretch overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025]">
        <span className="flex w-20 shrink-0 items-center justify-center overflow-hidden border-r border-white/[.045] bg-black/[.07]">
          {defaultText ? <img src={defaultText} alt="" className="size-full object-cover" /> : <ImageIcon className="size-[18px] text-white/30" />}
        </span>
        <div className="min-w-0 flex-1 space-y-2 px-3 py-2.5">
          <HtmlSettingsFieldControl label="Imagem padrão" kind="image">
            <Input value={defaultText} placeholder="URL ou imagem da biblioteca" onChange={event => onChange({ default: event.target.value })} />
          </HtmlSettingsFieldControl>
          <Button type="button" size="xs" variant="secondary" disabled={uploading} asChild>
            <label className="cursor-pointer">
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Enviar imagem
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onUploadImage(file, value => onChange({ default: value }));
                }}
              />
            </label>
          </Button>
        </div>
      </div>
    ) : field.type === 'number' ? (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label={`Diminuir valor padrão de ${field.label}`}
            onClick={() => onChange({ default: numberDefault - numberStep })}
          >
            −
          </Button>
          <div className="relative min-w-0 flex-1">
            <HtmlSettingsFieldControl label={`Valor padrão de ${field.label}`} kind="number">
              <Input
                aria-label={`Valor padrão de ${field.label}`}
                type="number"
                value={defaultText}
                min={numberMin}
                max={numberMax}
                step={numberStep}
                onChange={event =>
                  onChange({
                    default: event.target.value === '' ? '' : Number(event.target.value),
                  })
                }
                className={field.unit ? 'pr-12' : ''}
              />
            </HtmlSettingsFieldControl>
            {field.unit ? (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{field.unit}</span>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label={`Aumentar valor padrão de ${field.label}`}
            onClick={() => onChange({ default: numberDefault + numberStep })}
          >
            +
          </Button>
        </div>
        {numberMin !== undefined && numberMax !== undefined && numberMax > numberMin ? (
          <Slider
            aria-label={`Faixa padrão de ${field.label}`}
            value={[Math.min(numberMax, Math.max(numberMin, numberDefault))]}
            min={numberMin}
            max={numberMax}
            step={numberStep}
            unit={field.unit}
            showValueInput={false}
            onValueChange={([value]) => onChange({ default: value })}
          />
        ) : null}
      </div>
    ) : field.type === 'date' ? (
      <CmsDatePicker label={`Valor padrão de ${field.label}`} value={defaultText} onChange={value => onChange({ default: value })} />
    ) : field.type === 'richtext' ? (
      <RichHtmlEditor value={defaultText} onChange={value => onChange({ default: value })} placeholder="Conteúdo padrão formatado…" />
    ) : field.type === 'textarea' ? (
      <Textarea value={defaultText} rows={4} placeholder="Valor usado ao criar um novo item" onChange={event => onChange({ default: event.target.value })} />
    ) : (
      <Input
        value={defaultText}
        type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
        placeholder="Valor usado ao criar um novo item"
        onChange={event =>
          onChange({
            default: field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value,
          })
        }
      />
    );
  return (
    <div data-kodety-onboarding="cms-field-definition" className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-3 border-b border-white/[.055] pb-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-white/[.045] text-white/35">
          <FieldTypeIcon type={field.type} className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Configurar campo</p>
          <p data-kodety-cms-description className="text-[10px] leading-4 text-muted-foreground">
            Defina o dado, a ajuda editorial e o valor inicial dos novos itens.
          </p>
        </div>
      </div>
      <div className="divide-y divide-white/[0.07]">
        <label data-kodety-onboarding="cms-field-label" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-center">
          <span>
            <Label>Nome visível</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Rótulo usado no editor.
            </span>
          </span>
          <HtmlSettingsFieldControl label="Nome visível" kind="text">
            <Input
              autoFocus
              value={field.label}
              placeholder="Ex.: Capa Home"
              onChange={event =>
                onChange({
                  label: event.target.value,
                  ...(field.name ? {} : { name: slugifyFieldName(event.target.value) }),
                })
              }
            />
          </HtmlSettingsFieldControl>
        </label>
        <label data-kodety-onboarding="cms-field-id" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-center">
          <span>
            <Label>Identificador</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Usado nas conexões do Design.
            </span>
          </span>
          <HtmlSettingsFieldControl label="Identificador" kind="id">
            <Input
              value={field.name}
              placeholder="capa_home"
              onChange={event =>
                onChange({
                  name: slugifyFieldName(event.target.value) || event.target.value,
                })
              }
            />
          </HtmlSettingsFieldControl>
        </label>
        <label data-kodety-onboarding="cms-field-description" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-start">
          <span>
            <Label>Descrição</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Aparece como ajuda ao preencher itens.
            </span>
          </span>
          <HtmlSettingsFieldControl label="Descrição" kind="text">
            <Textarea
              value={field.description || ''}
              rows={3}
              placeholder="Explique o que deve ser informado e onde o valor será usado."
              onChange={event => onChange({ description: event.target.value })}
            />
          </HtmlSettingsFieldControl>
        </label>
        <div data-kodety-onboarding="cms-field-type" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-center">
          <span>
            <Label>Tipo</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Formato e controle de edição.
            </span>
          </span>
          <HtmlSettingsFieldControl label="Tipo" kind="option">
            <Select value={field.type} onValueChange={changeType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KODETY_FIELD_TYPES.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-2">
                      <option.icon className="size-3.5" />
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </HtmlSettingsFieldControl>
        </div>
        <div data-kodety-onboarding="cms-field-required" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-center">
          <span>
            <Label>Obrigatório</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Exige valor antes de salvar.
            </span>
          </span>
          <div className="group/cms-toggle flex h-9 items-center overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/70">
            <span className="grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 group-hover/cms-toggle:text-white/50">
              <ToggleLeft aria-hidden="true" className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 px-2.5 text-xs text-muted-foreground">{field.required ? 'Obrigatório' : 'Opcional'}</span>
            <Switch aria-label={`${field.label} obrigatório`} checked={Boolean(field.required)} onCheckedChange={value => onChange({ required: value })} />
            <span className="w-2.5" aria-hidden="true" />
          </div>
        </div>
        <div data-kodety-onboarding="cms-field-default" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-start">
          <span>
            <Label>Valor padrão</Label>
            <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
              Preenchido apenas na criação e continua editável.
            </span>
          </span>
          {['text', 'date', 'url', 'textarea'].includes(field.type) ? (
            <HtmlSettingsFieldControl label="Valor padrão" kind={field.type === 'date' ? 'time' : field.type === 'url' ? 'link' : 'text'}>
              {defaultControl}
            </HtmlSettingsFieldControl>
          ) : (
            defaultControl
          )}
        </div>
        {field.type === 'number' ? (
          <div data-kodety-onboarding="cms-field-number-limits" className="grid gap-2 py-4 sm:grid-cols-[minmax(124px,172px)_minmax(0,1fr)] sm:items-start">
            <span>
              <Label>Restrições</Label>
              <span data-kodety-cms-description className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">
                Limites, precisão e unidade exibida.
              </span>
            </span>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="space-y-1">
                <Label variant="muted">Mínimo</Label>
                <HtmlSettingsFieldControl label="Mínimo" kind="number">
                  <Input
                    type="number"
                    value={field.min ?? ''}
                    placeholder="Livre"
                    onChange={event =>
                      onChange({
                        min: event.target.value === '' ? '' : Number(event.target.value),
                      })
                    }
                  />
                </HtmlSettingsFieldControl>
              </label>
              <label className="space-y-1">
                <Label variant="muted">Máximo</Label>
                <HtmlSettingsFieldControl label="Máximo" kind="number">
                  <Input
                    type="number"
                    value={field.max ?? ''}
                    placeholder="Livre"
                    onChange={event =>
                      onChange({
                        max: event.target.value === '' ? '' : Number(event.target.value),
                      })
                    }
                  />
                </HtmlSettingsFieldControl>
              </label>
              <label className="space-y-1">
                <Label variant="muted">Passo</Label>
                <HtmlSettingsFieldControl label="Passo" kind="number">
                  <Input
                    type="number"
                    min={0.000001}
                    value={field.step || 1}
                    onChange={event =>
                      onChange({
                        step: Math.max(0.000001, Number(event.target.value) || 1),
                      })
                    }
                  />
                </HtmlSettingsFieldControl>
              </label>
              <label className="space-y-1">
                <Label variant="muted">Unidade</Label>
                <HtmlSettingsFieldControl label="Unidade" kind="option">
                  <Select value={field.unit || '__none'} onValueChange={value => onChange({ unit: value === '__none' ? '' : value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Nenhuma</SelectItem>
                      <SelectItem value="%">Percentual %</SelectItem>
                      <SelectItem value="°">Graus °</SelectItem>
                      <SelectItem value="px">Pixels px</SelectItem>
                      <SelectItem value="R$">Real R$</SelectItem>
                      <SelectItem value="kg">Quilos kg</SelectItem>
                    </SelectContent>
                  </Select>
                </HtmlSettingsFieldControl>
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function HtmlCmsManager({
  open,
  onOpenChange,
  initialPostType = '',
  standalone = false,
  backHref,
  onNavigate,
  onActivateLicense,
  readOnly: readOnlyOverride,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPostType?: string;
  standalone?: boolean;
  backHref?: string;
  onNavigate?: (href: string) => boolean | void | Promise<boolean | void>;
  onActivateLicense?: () => void;
  readOnly?: boolean;
}) {
  const wp = managerConfig();
  const staticRuntime = wp?.cmsRuntime === 'static';
  const readOnly = readOnlyOverride ?? Boolean(wp?.readOnly);
  const canManageSchema = Boolean(wp?.canManageCmsSchema) && !readOnly;
  const [schema, setSchema] = useState<CmsSchema | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [initialCollection] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('collection') || '' : '');
  // Native WordPress can load posts immediately. HTML must first confirm that
  // the requested collection actually exists in this project's saved schema.
  const [activeType, setActiveType] = useState(() => initialCmsCollection(staticRuntime, initialCollection, initialPostType));
  const [items, setItems] = useState<CmsItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const itemSearchInputRef = useRef<HTMLInputElement>(null);
  const [collectionSearch, setCollectionSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [sortField, setSortField] = useState('modified');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [refreshTick, setRefreshTick] = useState(0);
  const [editing, setEditing] = useState<CmsItem | 'new' | null>(null);
  const [editingExpectedRevision, setEditingExpectedRevision] = useState('');
  const itemEditorRef = useRef<HTMLElement>(null);
  const itemEditorReturnFocusRef = useRef<HTMLElement | null>(null);
  const itemEditorTitleId = useId();
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [featuredImage, setFeaturedImage] = useState<{
    id: number | null;
    url: string;
  }>({ id: null, url: '' });
  const [initialFeaturedImage, setInitialFeaturedImage] = useState<{
    id: number | null;
    url: string;
  }>({ id: null, url: '' });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(0);
  const [uploadingField, setUploadingField] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newCollection, setNewCollection] = useState({
    name: '',
    singular: '',
    slug: '',
  });
  const [editingCollection, setEditingCollection] = useState<{
    slug: string;
    name: string;
    singular: string;
    urlSlug: string;
    itemCount: number;
    revision: string;
  } | null>(null);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [view, setView] = useState<'collections' | 'fields'>('collections');
  const initialViewHandledRef = useRef(false);
  const initialActionHandledRef = useRef(false);
  const [fieldDefs, setFieldDefs] = useState<KodetyFieldDefinition[]>([]);
  const [initialFieldDefs, setInitialFieldDefs] = useState<KodetyFieldDefinition[]>([]);
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsSaving, setFieldsSaving] = useState(false);
  const [fieldsRevision, setFieldsRevision] = useState('');
  const [fieldsRefreshTick, setFieldsRefreshTick] = useState(0);
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTask, setAiTask] = useState<'article' | 'seo' | 'rewrite'>('article');
  const [aiBrief, setAiBrief] = useState('');
  const [aiTone, setAiTone] = useState('claro, humano e profissional');
  const [aiIncludeCurrent, setAiIncludeCurrent] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [leavingCms, setLeavingCms] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const schemaRequestRef = useRef(0);
  const cellMutationVersionsRef = useRef(new Map<string, number>());
  const cellMutationChainsRef = useRef(new Map<string, Promise<boolean>>());
  const itemRevisionsRef = useRef(new Map<number, string>());
  const cellMutationPendingCountRef = useRef(0);
  const saveItemInFlightRef = useRef<Promise<boolean> | null>(null);
  const saveFieldsInFlightRef = useRef<Promise<boolean> | null>(null);
  const itemDraftSignatureRef = useRef('');
  const fieldsDraftSignatureRef = useRef('');
  const leavingCmsRef = useRef(false);
  const leavePreparationPromiseRef = useRef<Promise<boolean> | null>(null);
  const prepareCmsLeaveRef = useRef<() => Promise<boolean>>(async () => true);
  const cmsLeaveDraftRef = useRef<{
    editingDirty: boolean;
    fieldsDirty: boolean;
    saveItem: () => Promise<boolean>;
    saveFields: () => Promise<boolean>;
  }>({
    editingDirty: false,
    fieldsDirty: false,
    saveItem: async () => true,
    saveFields: async () => true,
  });
  const [cellMutationsPending, setCellMutationsPending] = useState(0);

  const types = useMemo(() => (schema?.types || []).filter(type => type.slug !== 'page'), [schema]);
  const selectedType: CmsType | undefined = useMemo(() => types.find(type => type.slug === activeType), [activeType, types]);
  const collectionReady = !staticRuntime || Boolean(selectedType);
  const collectionLimit: number | null = null;
  const itemLimit: number | null = null;
  const licenseInactive = false;
  const licenseUrl = wp?.product?.licenseUrl || wp?.product?.upgradeUrl;
  const collectionCount = types.filter(type => type.collection).length;
  const collectionLimitReached = collectionLimit !== null && collectionCount >= collectionLimit;
  const itemLimitReached = Boolean(
    selectedType?.collection && itemLimit !== null && typeof selectedType.itemCount === 'number' && selectedType.itemCount >= itemLimit,
  );
  const filteredTypes = useMemo(() => {
    const query = collectionSearch.trim().toLocaleLowerCase();
    return query ? types.filter(type => type.name.toLocaleLowerCase().includes(query)) : types;
  }, [collectionSearch, types]);

  const loadSchema = useCallback(
    async (forceReload = false): Promise<CmsSchema | null> => {
      if (!wp?.cmsSchemaUrl) return null;
      if (forceReload) invalidateCmsSchemaCache();
      const request = ++schemaRequestRef.current;
      try {
        const data = await fetchCmsSchema(wp.cmsSchemaUrl, wp.nonce || '');
        if (schemaRequestRef.current === request) {
          setSchema(data);
          setSchemaError('');
        }
        return data;
      } catch (error) {
        if (schemaRequestRef.current === request) {
          setSchemaError(error instanceof Error ? error.message : 'Não foi possível carregar o CMS.');
        }
        return null;
      }
    },
    [wp?.cmsSchemaUrl, wp?.nonce],
  );

  const refreshAfterRevisionConflict = useCallback(async (message?: string) => {
    // Never retry a stale mutation automatically: doing so would overwrite the
    // winner from another tab. Keep drafts and their original revision intact
    // until the user explicitly chooses to discard them and reload.
    setRevisionConflict(true);
    if (!cmsLeaveDraftRef.current.fieldsDirty) setFieldsRefreshTick(tick => tick + 1);
    setRefreshTick(tick => tick + 1);
    await loadSchema(true);
    toast.error(message || 'O CMS mudou em outra sessão. Seu rascunho foi preservado; copie suas alterações antes de recarregar.');
  }, [loadSchema]);

  useEffect(() => {
    if (!open) return;
    const refreshFromAgent = () => {
      void loadSchema(true);
      setRefreshTick(tick => tick + 1);
      // Keep an open article/field draft intact. Its original revision remains
      // attached so a later save cannot overwrite a concurrent Agent edit.
      if (!cmsLeaveDraftRef.current.fieldsDirty) setFieldsRefreshTick(tick => tick + 1);
    };
    window.addEventListener('kodety-native-operation-completed', refreshFromAgent);
    return () => window.removeEventListener('kodety-native-operation-completed', refreshFromAgent);
  }, [loadSchema, open]);

  useEffect(() => {
    if (!open) return;
    loadSchema();
  }, [loadSchema, open]);

  useEffect(() => {
    if (!open) return;
    const refreshSchema = () => void loadSchema();
    window.addEventListener(CMS_SCHEMA_INVALIDATED_EVENT, refreshSchema);
    window.addEventListener(CMS_SCHEMA_UPDATED_EVENT, refreshSchema);
    return () => {
      window.removeEventListener(CMS_SCHEMA_INVALIDATED_EVENT, refreshSchema);
      window.removeEventListener(CMS_SCHEMA_UPDATED_EVENT, refreshSchema);
    };
  }, [loadSchema, open]);

  useEffect(() => {
    if (!open || initialViewHandledRef.current || (staticRuntime && (!schema || (types.length > 0 && !collectionReady)))) return;
    const requestedView = new URLSearchParams(window.location.search).get('view');
    if (requestedView === 'fields' && canManageSchema && collectionReady) setView(requestedView);
    initialViewHandledRef.current = true;
  }, [canManageSchema, collectionReady, open, schema, staticRuntime, types.length]);

  useEffect(() => {
    if (!schema) return;
    setActiveType(current => resolveCmsCollection(types, current, initialCollection, initialPostType, staticRuntime));
    if (staticRuntime && !types.length) setView('collections');
  }, [initialCollection, initialPostType, schema, staticRuntime, types]);

  useEffect(() => {
    if (!standalone || !open || (staticRuntime ? !schema || (types.length > 0 && !collectionReady) : !activeType)) return;
    const url = new URL(window.location.href);
    if (activeType && collectionReady) url.searchParams.set('collection', activeType);
    else url.searchParams.delete('collection');
    if (view === 'collections') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    if (url.toString() !== window.location.href) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, [activeType, collectionReady, open, schema, standalone, staticRuntime, types.length, view]);

  useEffect(() => {
    setPage(1);
  }, [activeType, search, statusFilter]);

  useEffect(() => {
    if (!open || !wp?.cmsFieldsUrl || !activeType || !collectionReady) return;
    const controller = new AbortController();
    let active = true;
    setFieldsLoading(true);
    fetchCmsJsonWithDeadline<{ fields?: KodetyFieldDefinition[]; revision?: string }>(
      restEndpoint(wp.cmsFieldsUrl, `/${encodeURIComponent(activeType)}`),
      {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': wp.nonce || '' },
        signal: controller.signal,
      },
      'Não foi possível carregar os campos.',
    )
      .then((data: { fields?: KodetyFieldDefinition[]; revision?: string }) => {
        if (!active) return;
        if (!isCmsRevisionToken(data.revision)) throw new Error('O CMS não confirmou a revisão atual dos campos.');
        const normalized = (data.fields || []).map(field => ({
          ...field,
          description: field.description || '',
          required: Boolean(field.required),
          default: field.default ?? (field.type === 'boolean' ? false : ''),
          min: field.min ?? '',
          max: field.max ?? '',
          step: field.step || 1,
          unit: field.unit || '',
        }));
        setFieldDefs(normalized);
        setInitialFieldDefs(normalized);
        setFieldsRevision(data.revision);
      })
      .catch(error => {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          toast.error(error instanceof Error ? error.message : 'Erro ao carregar os campos.');
        }
      })
      .finally(() => {
        if (active) setFieldsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeType, collectionReady, fieldsRefreshTick, open, wp?.cmsFieldsUrl, wp?.nonce]);

  useEffect(() => {
    if (!open || !wp?.cmsItemsUrl || !activeType || !collectionReady) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(
      () => {
        setItemsLoading(true);
        setItemsError('');
        fetchCmsJsonWithDeadline<{ items?: CmsItem[]; total?: number; totalPages?: number }>(
          restEndpoint(wp.cmsItemsUrl!, `/${encodeURIComponent(activeType)}`, {
            per_page: '20',
            page: String(page),
            search,
            status: statusFilter,
            orderby: ['title', 'date', 'modified'].includes(sortField) ? sortField : 'modified',
            order: sortOrder,
          }),
          {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': wp.nonce || '' },
            signal: controller.signal,
          },
          'Não foi possível carregar os itens.',
        )
          .then((data: { items?: CmsItem[]; total?: number; totalPages?: number }) => {
            if (!active) return;
            const nextItems = data.items || [];
            if (nextItems.some(item => !isCmsRevisionToken(item.revision))) {
              throw new Error('O CMS não confirmou a revisão atual dos itens.');
            }
            itemRevisionsRef.current = new Map(
              nextItems.map(item => [item.id, item.revision]),
            );
            setItems(nextItems);
            setTotal(data.total || 0);
            setTotalPages(Math.max(1, data.totalPages || 1));
          })
          .catch(error => {
            if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
            const message = error instanceof Error ? error.message : 'Erro ao carregar itens.';
            setItemsError(message);
          })
          .finally(() => {
            if (active) setItemsLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeType, collectionReady, open, page, refreshTick, search, sortField, sortOrder, statusFilter, wp?.cmsItemsUrl, wp?.nonce]);

  useEffect(() => {
    setSelectedItemIds([]);
  }, [activeType, page, search, sortField, statusFilter]);

  useEffect(() => {
    setSelectedItemIds(current => current.filter(id => items.some(item => item.id === id)));
  }, [items]);

  const editableFields = useMemo(() => {
    return (selectedType?.fields || []).filter(field => !READONLY_FIELDS.has(field.key));
  }, [selectedType]);
  const aiCurrentContext = useMemo(
    () =>
      Object.entries(formValues)
        .filter(([, value]) => value !== '' && value !== null && value !== undefined)
        .map(([key, value]) => `${editableFields.find(field => field.key === key)?.label || key}: ${summarizeCmsValue(value)}`)
        .filter(line => !line.endsWith(': '))
        .join('\n\n')
        .slice(0, 14000),
    [editableFields, formValues],
  );

  const supportsThumbnail = useMemo(() => (selectedType?.fields || []).some(field => field.key === 'featured_image'), [selectedType]);
  const columnCandidates = useMemo(() => {
    const priority = ['featured_image', 'status', 'title', 'excerpt', 'summary', 'date', 'slug'];
    return (selectedType?.fields || [])
      .filter(field => !['permalink', 'author', 'content'].includes(field.key))
      .sort((left, right) => {
        const leftRank = priority.indexOf(left.key);
        const rightRank = priority.indexOf(right.key);
        return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
      });
  }, [selectedType]);
  useEffect(() => {
    if (!activeType || !columnCandidates.length) return;
    // v2 removes the old five-column ceiling. A versioned preference key
    // prevents that legacy cap from keeping existing projects artificially
    // narrow after the denser, horizontally scrollable grid is introduced.
    const storageKey = `kodety:cms:columns:v2:${activeType}`;
    let stored: string[] = [];
    try {
      stored = JSON.parse(window.localStorage.getItem(storageKey) || '[]') as string[];
    } catch {
      stored = [];
    }
    const valid = stored.filter(key => columnCandidates.some(field => field.key === key));
    setVisibleFieldKeys(valid.length ? valid : columnCandidates.map(field => field.key));
  }, [activeType, columnCandidates]);
  const tableFields = useMemo(
    () => visibleFieldKeys.map(key => columnCandidates.find(field => field.key === key)).filter((field): field is CmsField => Boolean(field)),
    [columnCandidates, visibleFieldKeys],
  );
  const tableItems = useMemo(() => {
    const field = columnCandidates.find(candidate => candidate.key === sortField);
    const statusRank: Record<string, number> = { draft: 0, pending: 1, private: 2, future: 3, publish: 4 };
    const valueFor = (item: CmsItem) => {
      if (sortField === 'status') return statusRank[item.status] ?? 2;
      if (sortField === 'title') return String(item.values.title ?? item.label ?? '');
      if (sortField === 'modified') return Date.parse(item.modifiedIso || '') || 0;
      if (sortField === 'date') return Date.parse(item.dateIso || '') || 0;
      return cmsValueLabels(item.values[sortField]).join(', ');
    };
    const collator = new Intl.Collator(getAdminUiLocale(), { numeric: true, sensitivity: 'base' });
    return [...items].sort((left, right) => {
      const leftValue = valueFor(left);
      const rightValue = valueFor(right);
      let comparison = 0;
      if (field?.type === 'number' || typeof leftValue === 'number' || typeof rightValue === 'number') {
        comparison = Number(leftValue || 0) - Number(rightValue || 0);
      } else {
        comparison = collator.compare(String(leftValue), String(rightValue));
      }
      return sortOrder === 'ASC' ? comparison : -comparison;
    });
  }, [columnCandidates, items, sortField, sortOrder]);
  const deletableItems = useMemo(() => items.filter(item => item.capabilities?.delete !== false), [items]);
  const allVisibleItemsSelected = deletableItems.length > 0 && deletableItems.every(item => selectedItemIds.includes(item.id));
  const toggleAllVisibleItems = useCallback(() => {
    setSelectedItemIds(current => {
      const visibleIds = deletableItems.map(item => item.id);
      const everyVisibleItemIsSelected = visibleIds.length > 0 && visibleIds.every(id => current.includes(id));
      return everyVisibleItemIsSelected ? current.filter(id => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds]));
    });
  }, [deletableItems]);
  const toggleItemSelection = useCallback((item: CmsItem) => {
    if (item.capabilities?.delete === false) return;
    const itemId = item.id;
    setSelectedItemIds(current => (current.includes(itemId) ? current.filter(id => id !== itemId) : [...current, itemId]));
  }, []);
  const toggleVisibleField = useCallback(
    (key: string) => {
      setVisibleFieldKeys(current => {
        const next = current.includes(key) ? current.filter(candidate => candidate !== key) : [...current, key];
        if (activeType) window.localStorage.setItem(`kodety:cms:columns:v2:${activeType}`, JSON.stringify(next));
        return next;
      });
    },
    [activeType],
  );

  const startEditing = useCallback(
    (item: CmsItem | 'new') => {
      if (readOnly || !collectionReady) return;
      const revision = item === 'new' ? schema?.revision : item.revision;
      if (!isCmsRevisionToken(revision)) {
        toast.error('A revisão atual do CMS não está disponível. Recarregando os dados antes da edição.');
        void loadSchema(true);
        setRefreshTick(tick => tick + 1);
        return;
      }
      if (item === 'new' && itemLimitReached) {
        toast.error(`Esta collection atingiu o limite de ${itemLimit} itens configurado.`);
        return;
      }
      if (item === 'new' && selectedType?.capabilities?.create === false) {
        toast.error('Sua conta não pode criar itens nesta collection.');
        return;
      }
      itemEditorReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setEditing(item);
      setEditingExpectedRevision(revision);
      if (item === 'new') {
        const empty: Record<string, unknown> = { status: 'draft' };
        editableFields.forEach(field => {
          if (field.default !== '' && field.default !== null && field.default !== undefined) empty[field.key] = field.default;
        });
        setFormValues(empty);
        setInitialValues(empty);
        setFeaturedImage({ id: null, url: '' });
        setInitialFeaturedImage({ id: null, url: '' });
        return;
      }
      const values: Record<string, unknown> = { status: item.status };
      editableFields.forEach(field => {
        if (field.key in item.values) values[field.key] = item.values[field.key];
      });
      setFormValues(values);
      setInitialValues(values);
      const image = {
        id: item.featuredImageId || null,
        url: String(item.values.featured_image || ''),
      };
      setFeaturedImage(image);
      setInitialFeaturedImage(image);
    },
    [collectionReady, editableFields, itemLimit, itemLimitReached, loadSchema, readOnly, schema?.revision, selectedType?.capabilities?.create],
  );

  useEffect(() => {
    if (!open || (staticRuntime ? !schema : !activeType) || initialActionHandledRef.current) return;
    const action = new URLSearchParams(window.location.search).get('action');
    if (action === 'new-item' && !activeType && types.length) return;
    if (action === 'new-item' && activeType && collectionReady) startEditing('new');
    if (action === 'new-collection' && canManageSchema && !collectionLimitReached) setCreatingCollection(true);
    if (action === 'import-csv' && canManageSchema) setImportOpen(true);
    initialActionHandledRef.current = true;
  }, [activeType, canManageSchema, collectionLimitReached, collectionReady, open, schema, startEditing, staticRuntime, types.length]);

  const uploadImage = useCallback(
    async (file: File, apply: (value: unknown) => void, fieldKey: string) => {
      if (readOnly || !wp?.mediaUploadUrl) return;
      setUploadingField(fieldKey);
      try {
        const body = new FormData();
        body.append('file', file, file.name);
        body.append('title', file.name.replace(/\.[^.]+$/, ''));
        const response = await cmsFetch(wp.mediaUploadUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-WP-Nonce': wp.nonce || '' },
          body,
        });
        if (!response.ok) throw new Error('Não foi possível enviar a imagem.');
        const attachment = (await response.json()) as {
          id?: number;
          source_url?: string;
        };
        if (!attachment.id) throw new Error('Mídia inválida.');
        apply(fieldKey === 'featured_image' ? attachment : attachment.source_url || attachment.id);
        toast.success('Imagem enviada para a Biblioteca de Mídia.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível enviar a imagem.');
      } finally {
        setUploadingField('');
      }
    },
    [readOnly, wp?.mediaUploadUrl, wp?.nonce],
  );

  const generateWithAi = useCallback(async () => {
    if (readOnly || !wp?.aiGenerateUrl || !aiBrief.trim()) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiLoading(true);
    try {
      const context = aiIncludeCurrent ? aiCurrentContext : '';
      const prompt = `${aiBrief.trim()}\n\nRegra factual: use somente informações presentes neste briefing e no contexto autorizado. Não invente nomes, números, datas, preços, funcionalidades, resultados ou depoimentos. Quando faltar um dado, omita-o ou escreva de forma neutra.`;
      const response = await cmsFetch(wp.aiGenerateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wp.nonce || '',
        },
        body: JSON.stringify({
          task: aiTask,
          prompt,
          tone: aiTone,
          context,
          postType: activeType,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível gerar o conteúdo.');
      const draft = payload?.draft || {};
      setFormValues(current => ({
        ...current,
        ...(draft.title || draft.seoTitle ? { title: draft.title || draft.seoTitle } : {}),
        ...(draft.slug ? { slug: draft.slug } : {}),
        ...(draft.excerpt || draft.seoDescription ? { excerpt: draft.excerpt || draft.seoDescription } : {}),
        ...(draft.content ? { content: draft.content } : {}),
      }));
      setAiOpen(false);
      toast.success('Rascunho gerado', {
        description: 'Revise os campos antes de salvar ou publicar.',
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(error instanceof Error ? error.message : 'Falha ao gerar conteúdo.');
      }
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setAiLoading(false);
      }
    }
  }, [activeType, aiBrief, aiCurrentContext, aiIncludeCurrent, aiTask, aiTone, readOnly, wp?.aiGenerateUrl, wp?.nonce]);

  useEffect(() => {
    if (aiOpen) return;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiLoading(false);
  }, [aiOpen]);

  useEffect(
    () => () => {
      schemaRequestRef.current += 1;
      aiAbortRef.current?.abort();
    },
    [],
  );

  const itemDraftSignature = useMemo(
    () => JSON.stringify([editing === 'new' ? 'new' : editing?.id || null, formValues, featuredImage.id]),
    [editing, featuredImage.id, formValues],
  );
  const fieldsDraftSignature = useMemo(() => JSON.stringify(fieldDefs), [fieldDefs]);
  itemDraftSignatureRef.current = itemDraftSignature;
  fieldsDraftSignatureRef.current = fieldsDraftSignature;
  const editingDirty = useMemo(
    () => Boolean(editing) && (JSON.stringify(formValues) !== JSON.stringify(initialValues) || featuredImage.id !== initialFeaturedImage.id),
    [editing, featuredImage.id, formValues, initialFeaturedImage.id, initialValues],
  );
  const fieldsDirty = useMemo(() => fieldsDraftSignature !== JSON.stringify(initialFieldDefs), [fieldsDraftSignature, initialFieldDefs]);

  useEffect(() => {
    if (open && !readOnly && (editingDirty || fieldsDirty)) notifyWorkspaceDraftChanged();
  }, [editingDirty, fieldsDirty, fieldsDraftSignature, itemDraftSignature, open, readOnly]);

  useEffect(() => {
    if (!open || readOnly) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!editingDirty && !fieldsDirty && !saving && !fieldsSaving && !uploadingField && !collectionSaving && !creatingCollection && !editingCollection && !bulkDeleting && !deletingId && !cellMutationPendingCountRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [bulkDeleting, collectionSaving, creatingCollection, deletingId, editingCollection, editingDirty, fieldsDirty, fieldsSaving, open, readOnly, saving, uploadingField]);

  const saveItem = useCallback((): Promise<boolean> => {
    if (saveItemInFlightRef.current) return saveItemInFlightRef.current;
    const request = (async (): Promise<boolean> => {
      if (readOnly || !wp?.cmsItemsUrl || !activeType || !editing) return false;
      if (!editingExpectedRevision) {
        await refreshAfterRevisionConflict('A revisão deste item não está disponível. O CMS foi recarregado antes de salvar.');
        return false;
      }
      const changed: Record<string, unknown> = {};
      Object.entries(formValues).forEach(([key, value]) => {
        if (JSON.stringify(initialValues[key]) !== JSON.stringify(value)) changed[key] = value;
      });
      if (featuredImage.id !== initialFeaturedImage.id) changed.featured_image = featuredImage.id === null ? '' : featuredImage.id;
      if (editing !== 'new' && !Object.keys(changed).length) {
        setEditing(null);
        return true;
      }
      const submittedDraftSignature = itemDraftSignature;
      setSaving(true);
      try {
        const endpoint =
          editing === 'new'
            ? restEndpoint(wp.cmsItemsUrl, `/${encodeURIComponent(activeType)}`)
            : restEndpoint(wp.cmsItemsUrl, `/${encodeURIComponent(activeType)}/${editing.id}`);
        const response = await cmsFetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': wp.nonce || '',
          },
          body: JSON.stringify({
            values: editing === 'new' ? { ...formValues, ...(featuredImage.id !== null ? { featured_image: featuredImage.id } : {}) } : changed,
            expectedRevision: editingExpectedRevision,
          }),
        });
        if (!response.ok) throw await cmsMutationError(response, 'Não foi possível salvar o item.');
        const saved = (await response.json()) as CmsItem;
        if (!isCmsRevisionToken(saved.revision)) throw new Error('O CMS salvou o item sem confirmar sua nova revisão.');
        itemRevisionsRef.current.set(saved.id, saved.revision);
        if (editing === 'new') {
          const fresh = await loadSchema(true);
          if (fresh) setFieldsRevision(current => current ? fresh.revision : current);
        }
        window.dispatchEvent(new CustomEvent('kodety-cms-item-updated', { detail: saved }));
        notifyItemsChanged();
        setRefreshTick(tick => tick + 1);
        if (itemDraftSignatureRef.current === submittedDraftSignature) {
          setEditing(null);
        } else {
          // Preserve edits made after this request started. The acknowledged
          // snapshot becomes the next baseline and the saved item/revision
          // becomes the target for the follow-up POST (including new items).
          setEditing(saved);
          setEditingExpectedRevision(saved.revision);
          setInitialValues(formValues);
          setInitialFeaturedImage(featuredImage);
        }
        toast.success(editing === 'new' ? 'Item criado no CMS.' : 'Item salvo no CMS.');
        return true;
      } catch (error) {
        if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
        else toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o item.');
        return false;
      } finally {
        setSaving(false);
      }
    })();
    saveItemInFlightRef.current = request;
    void request.then(
      () => {
        if (saveItemInFlightRef.current === request) saveItemInFlightRef.current = null;
      },
      () => {
        if (saveItemInFlightRef.current === request) saveItemInFlightRef.current = null;
      },
    );
    return request;
  }, [activeType, editing, editingExpectedRevision, featuredImage, formValues, initialFeaturedImage, initialValues, itemDraftSignature, loadSchema, readOnly, refreshAfterRevisionConflict, wp?.cmsItemsUrl, wp?.nonce]);
  const closeItemEditor = useCallback(() => {
    if (saving) return;
    if (editingDirty && !window.confirm('Descartar as alterações deste item?')) return;
    setEditing(null);
  }, [editingDirty, saving]);
  const requestActiveType = useCallback(
    (nextType: string) => {
      if (!nextType || nextType === activeType) return;
      if (saving || fieldsSaving || uploadingField || cellMutationPendingCountRef.current > 0) {
        toast.info('Aguarde a operação atual antes de trocar de collection.');
        return;
      }
      if (editingDirty && !window.confirm('Descartar as alterações deste item e trocar de collection?')) return;
      if (view === 'fields' && fieldsDirty && !window.confirm('Descartar as alterações não salvas nos campos e trocar de collection?')) return;
      setEditing(null);
      setActiveType(nextType);
    },
    [activeType, editingDirty, fieldsDirty, fieldsSaving, saving, uploadingField, view],
  );
  const requestView = useCallback(
    (nextView: 'collections' | 'fields') => {
      if (nextView === 'fields' && (!canManageSchema || !collectionReady)) return;
      if (nextView === view) return;
      if (saving || fieldsSaving || uploadingField || cellMutationPendingCountRef.current > 0) {
        toast.info('Aguarde a operação atual antes de mudar de seção.');
        return;
      }
      if (editingDirty && !window.confirm('Descartar as alterações deste item e mudar de seção?')) return;
      if (view === 'fields' && fieldsDirty && !window.confirm('Descartar as alterações não salvas nos campos e mudar de seção?')) return;
      setEditing(null);
      setView(nextView);
    },
    [canManageSchema, collectionReady, editingDirty, fieldsDirty, fieldsSaving, saving, uploadingField, view],
  );
  const editCmsColumnField = useCallback(
    (field: CmsField) => {
      const fieldName = field.key.startsWith('field:') ? field.key.slice(6) : '';
      const index = fieldDefs.findIndex(definition => definition.name === fieldName);
      if (index < 0) return;
      setSelectedFieldIndex(index);
      requestView('fields');
    },
    [fieldDefs, requestView],
  );
  useEffect(() => {
    if (editing) {
      const frame = window.requestAnimationFrame(() => {
        itemEditorRef.current?.querySelector<HTMLButtonElement>('[data-item-editor-close]')?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const returnTarget = itemEditorReturnFocusRef.current;
    if (returnTarget?.isConnected) returnTarget.focus();
    itemEditorReturnFocusRef.current = null;
  }, [editing]);
  useEffect(() => {
    if (!editing || aiOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeItemEditor();
        return;
      }
      if (event.key !== 'Tab' || !itemEditorRef.current) return;
      const focusable = Array.from(
        itemEditorRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(element => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [aiOpen, closeItemEditor, editing]);

  const updateItemField = useCallback(
    async (item: CmsItem, key: string, value: unknown) => {
      if (readOnly || !wp?.cmsItemsUrl || !activeType) return;
      const cellMutationKey = `${activeType}:${item.id}:${key}`;
      const itemMutationKey = `${activeType}:${item.id}`;
      const version = (cellMutationVersionsRef.current.get(cellMutationKey) || 0) + 1;
      cellMutationVersionsRef.current.set(cellMutationKey, version);
      cellMutationPendingCountRef.current += 1;
      setCellMutationsPending(cellMutationPendingCountRef.current);
      setItems(current =>
        current.map(candidate =>
          candidate.id === item.id
            ? {
                ...candidate,
                status: key === 'status' ? String(value) : candidate.status,
                label: key === 'title' ? String(value) : candidate.label,
                values: { ...candidate.values, [key]: value },
              }
            : candidate,
        ),
      );
      // Different cells of one item still share a single CAS token. Serialize
      // them per item so the next local edit uses the revision returned by the
      // previous ACK instead of manufacturing a conflict with our own tab.
      const previous = cellMutationChainsRef.current.get(itemMutationKey) || Promise.resolve();
      const mutation = previous
        .catch(() => undefined)
        .then(async () => {
          // A queued value that was replaced before its request began never needs
          // to reach WordPress. Requests already in flight still finish in order,
          // so the newest value is always the last write observed by the server.
          try {
            if (cellMutationVersionsRef.current.get(cellMutationKey) !== version) return true;
            const expectedRevision = itemRevisionsRef.current.get(item.id) || item.revision;
            if (!isCmsRevisionToken(expectedRevision)) throw new Error('A revisão atual do item não está disponível.');
            const response = await cmsFetch(restEndpoint(wp.cmsItemsUrl!, `/${encodeURIComponent(activeType)}/${item.id}`), {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': wp.nonce || '',
              },
              body: JSON.stringify({ values: { [key]: value }, expectedRevision }),
            });
            if (!response.ok) throw await cmsMutationError(response, 'Não foi possível salvar a célula.');
            const saved = (await response.json()) as CmsItem;
            if (!isCmsRevisionToken(saved.revision)) throw new Error('O CMS não confirmou a nova revisão do item.');
            itemRevisionsRef.current.set(saved.id, saved.revision);
            if (cellMutationVersionsRef.current.get(cellMutationKey) !== version) return true;
            const hasSavedValue = Object.prototype.hasOwnProperty.call(saved.values, key);
            setItems(current =>
              current.map(candidate =>
                candidate.id === saved.id
                  ? {
                      ...saved,
                      // Preserve other optimistic cell edits that may still be in flight.
                      status: key === 'status' ? saved.status : candidate.status,
                      label: key === 'title' ? saved.label : candidate.label,
                      values: {
                        ...candidate.values,
                        [key]: hasSavedValue ? saved.values[key] : value,
                      },
                    }
                  : candidate,
              ),
            );
            notifyItemsChanged();
            return true;
          } catch (error) {
            if (cellMutationVersionsRef.current.get(cellMutationKey) !== version) return true;
            setItems(current =>
              current.map(candidate =>
                candidate.id === item.id
                  ? {
                      ...candidate,
                      status: key === 'status' ? item.status : candidate.status,
                      label: key === 'title' ? item.label : candidate.label,
                      values: {
                        ...candidate.values,
                        [key]: item.values[key],
                      },
                    }
                  : candidate,
              ),
            );
            if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
            else toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a célula.');
            return false;
          } finally {
            if (cellMutationVersionsRef.current.get(cellMutationKey) === version) {
              cellMutationVersionsRef.current.delete(cellMutationKey);
            }
            cellMutationPendingCountRef.current = Math.max(0, cellMutationPendingCountRef.current - 1);
            setCellMutationsPending(cellMutationPendingCountRef.current);
          }
        });
      cellMutationChainsRef.current.set(itemMutationKey, mutation);
      await mutation;
      if (cellMutationChainsRef.current.get(itemMutationKey) === mutation) {
        cellMutationChainsRef.current.delete(itemMutationKey);
      }
    },
    [activeType, readOnly, refreshAfterRevisionConflict, wp?.cmsItemsUrl, wp?.nonce],
  );

  const addField = useCallback(
    (type: string) => {
      if (readOnly) return;
      setFieldDefs(current => {
        const next: KodetyFieldDefinition[] = [
          ...current,
          {
            name: '',
            label: '',
            type,
            description: '',
            required: false,
            default: type === 'boolean' ? false : type === 'color' ? '#000000' : '',
            min: '',
            max: '',
            step: 1,
            unit: '',
          },
        ];
        setSelectedFieldIndex(next.length - 1);
        return next;
      });
      setView('fields');
    },
    [readOnly],
  );

  const moveField = useCallback(
    (index: number, direction: -1 | 1) => {
      if (readOnly) return;
      const targetIndex = index + direction;
      setFieldDefs(current => {
        if (targetIndex < 0 || targetIndex >= current.length) return current;
        const next = [...current];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      });
      setSelectedFieldIndex(current => (current === index ? targetIndex : current === targetIndex ? index : current));
    },
    [readOnly],
  );

  const deleteItem = useCallback(
    async (item: CmsItem) => {
      if (readOnly || !wp?.cmsItemsUrl || !activeType) return;
      if (!window.confirm(`Mover "${item.label}" para a lixeira do CMS?`)) return;
      setDeletingId(item.id);
      try {
        const expectedRevision = itemRevisionsRef.current.get(item.id) || item.revision;
        if (!isCmsRevisionToken(expectedRevision)) throw new Error('A revisão atual do item não está disponível.');
        const response = await cmsFetch(restEndpoint(wp.cmsItemsUrl, `/${encodeURIComponent(activeType)}/${item.id}`), {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': wp.nonce || '',
          },
          body: JSON.stringify({ expectedRevision }),
        });
        if (!response.ok) throw await cmsMutationError(response, 'Não foi possível excluir o item.');
        const deleted = (await response.json()) as { deleted?: number; status?: string; revision?: string };
        if (
          deleted.deleted !== item.id
          || deleted.status !== 'trash'
          || !isCmsRevisionToken(deleted.revision)
        ) throw new Error('O CMS não confirmou o item na lixeira.');
        itemRevisionsRef.current.delete(item.id);
        notifyItemsChanged();
        setRefreshTick(tick => tick + 1);
        if (editing !== 'new' && editing?.id === item.id) setEditing(null);
        toast.success('Item movido para a lixeira.');
      } catch (error) {
        if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
        else toast.error(error instanceof Error ? error.message : 'Não foi possível excluir o item.');
      } finally {
        setDeletingId(0);
      }
    },
    [activeType, editing, readOnly, refreshAfterRevisionConflict, wp?.cmsItemsUrl, wp?.nonce],
  );

  const deleteSelectedItems = useCallback(async () => {
    if (readOnly || !wp?.cmsItemsUrl || !activeType || !selectedItemIds.length || bulkDeleting) return;
    const selectedItems = items.filter(item => selectedItemIds.includes(item.id));
    if (!selectedItems.length) return;
    if (!window.confirm(`Mover ${selectedItems.length} ${selectedItems.length === 1 ? 'item' : 'itens'} para a lixeira do CMS?`)) return;
    setBulkDeleting(true);
    const failedIds: number[] = [];
    let deletedCount = 0;
    let hadRevisionConflict = false;
    try {
      for (const item of selectedItems) {
        try {
          const expectedRevision = itemRevisionsRef.current.get(item.id) || item.revision;
          if (!isCmsRevisionToken(expectedRevision)) throw new Error('A revisão atual do item não está disponível.');
          const response = await cmsFetch(restEndpoint(wp.cmsItemsUrl, `/${encodeURIComponent(activeType)}/${item.id}`), {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              'X-WP-Nonce': wp.nonce || '',
            },
            body: JSON.stringify({ expectedRevision }),
          });
          if (!response.ok) throw await cmsMutationError(response, 'Não foi possível excluir o item.');
          const deleted = (await response.json()) as { deleted?: number; status?: string; revision?: string };
          if (
            deleted.deleted !== item.id
            || deleted.status !== 'trash'
            || !isCmsRevisionToken(deleted.revision)
          ) throw new Error('O CMS não confirmou o item na lixeira.');
          itemRevisionsRef.current.delete(item.id);
          deletedCount += 1;
        } catch (error) {
          if (isCmsRevisionError(error)) hadRevisionConflict = true;
          failedIds.push(item.id);
        }
      }
      if (deletedCount) {
        setItems(current => current.filter(item => !selectedItemIds.includes(item.id) || failedIds.includes(item.id)));
        notifyItemsChanged();
        setRefreshTick(tick => tick + 1);
      }
      setSelectedItemIds(failedIds);
      if (hadRevisionConflict) {
        await refreshAfterRevisionConflict();
      } else if (failedIds.length) {
        toast.error(
          `${failedIds.length} ${failedIds.length === 1 ? 'item não pôde' : 'itens não puderam'} ser movido${failedIds.length === 1 ? '' : 's'} para a lixeira.`,
        );
      } else {
        toast.success(`${deletedCount} ${deletedCount === 1 ? 'item movido' : 'itens movidos'} para a lixeira.`);
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [activeType, bulkDeleting, items, readOnly, refreshAfterRevisionConflict, selectedItemIds, wp?.cmsItemsUrl, wp?.nonce]);

  const createCollection = useCallback(async () => {
    if (readOnly || !wp?.cmsCollectionsUrl || !newCollection.name.trim()) return;
    if (!isCmsRevisionToken(schema?.revision)) {
      await refreshAfterRevisionConflict('A revisão atual das collections não está disponível. O CMS foi recarregado antes de criar.');
      return;
    }
    if (collectionLimitReached) {
      toast.error(`O limite de collections é ${collectionLimit} collection.`);
      return;
    }
    setCollectionSaving(true);
    try {
      const response = await cmsFetch(wp.cmsCollectionsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': wp.nonce || '',
        },
        body: JSON.stringify({
          name: newCollection.name.trim(),
          singular: newCollection.singular.trim() || newCollection.name.trim(),
          slug: newCollection.slug.trim() || newCollection.name.trim(),
          expectedRevision: schema.revision,
        }),
      });
      if (!response.ok) throw await cmsMutationError(response, 'Não foi possível criar a collection.');
      const created = (await response.json()) as { slug?: string; revision?: string };
      const nextRevision = created.revision;
      if (!isCmsRevisionToken(nextRevision)) throw new Error('O CMS criou a collection sem confirmar a nova revisão.');
      setSchema(current => current ? { ...current, revision: nextRevision } : current);
      setFieldsRevision(current => current ? nextRevision : current);
      setCreatingCollection(false);
      setNewCollection({ name: '', singular: '', slug: '' });
      const refreshed = await loadSchema(true);
      if (created.slug && refreshed?.types.some(type => type.slug === created.slug)) {
        setActiveType(created.slug);
      }
      toast.success('Collection criada. Já é possível conectar campos e criar itens.');
    } catch (error) {
      if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
      else toast.error(error instanceof Error ? error.message : 'Não foi possível criar a collection.');
    } finally {
      setCollectionSaving(false);
    }
  }, [collectionLimit, collectionLimitReached, loadSchema, newCollection, readOnly, refreshAfterRevisionConflict, schema?.revision, wp?.cmsCollectionsUrl, wp?.nonce]);

  const beginEditingCollection = useCallback((type: CmsType) => {
    if (!canManageSchema || !type.collection || type.readOnly) return;
    if (!isCmsRevisionToken(schema?.revision)) {
      toast.error('A revisão atual da collection não está disponível. Recarregando o CMS antes de editar.');
      void loadSchema(true);
      return;
    }
    setCreatingCollection(false);
    setEditingCollection({
      slug: type.slug,
      name: type.name,
      singular: type.singular || type.name,
      urlSlug: type.urlSlug || type.slug.replace(/^kodety_/, '').replaceAll('_', '-'),
      itemCount: type.itemCount || 0,
      revision: schema.revision,
    });
  }, [canManageSchema, loadSchema, schema?.revision]);

  const updateCollection = useCallback(async () => {
    if (readOnly || !wp?.cmsCollectionsUrl || !editingCollection?.name.trim()) return;
    if (!isCmsRevisionToken(editingCollection.revision)) {
      await refreshAfterRevisionConflict('A revisão desta collection não está disponível. O CMS foi recarregado antes de salvar.');
      return;
    }
    setCollectionSaving(true);
    try {
      const response = await cmsFetch(
        restEndpoint(wp.cmsCollectionsUrl, `/${encodeURIComponent(editingCollection.slug)}`),
        {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': wp.nonce || '',
          },
          body: JSON.stringify({
            name: editingCollection.name.trim(),
            singular: editingCollection.singular.trim() || editingCollection.name.trim(),
            expectedRevision: editingCollection.revision,
          }),
        },
      );
      if (!response.ok) throw await cmsMutationError(response, 'Não foi possível renomear a collection.');
      const updated = (await response.json()) as { slug?: string; revision?: string };
      const nextRevision = updated.revision;
      if (!isCmsRevisionToken(nextRevision)) throw new Error('O CMS renomeou a collection sem confirmar a nova revisão.');
      const stableSlug = updated.slug || editingCollection.slug;
      setSchema(current => current ? { ...current, revision: nextRevision } : current);
      setFieldsRevision(current => current ? nextRevision : current);
      setEditingCollection(current => current && current.slug === editingCollection.slug
        ? { ...current, revision: nextRevision }
        : current);
      const refreshed = await loadSchema(true);
      if (refreshed?.types.some(type => type.slug === stableSlug)) setActiveType(stableSlug);
      setEditingCollection(null);
      toast.success('Collection renomeada sem alterar o identificador dos bindings.');
    } catch (error) {
      if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
      else toast.error(error instanceof Error ? error.message : 'Não foi possível renomear a collection.');
    } finally {
      setCollectionSaving(false);
    }
  }, [editingCollection, loadSchema, readOnly, refreshAfterRevisionConflict, wp?.cmsCollectionsUrl, wp?.nonce]);

  const deleteCollection = useCallback(async () => {
    if (readOnly || !wp?.cmsCollectionsUrl || !editingCollection) return;
    if (!isCmsRevisionToken(editingCollection.revision)) {
      await refreshAfterRevisionConflict('A revisão desta collection não está disponível. O CMS foi recarregado antes de excluir.');
      return;
    }
    if (editingCollection.itemCount > 0) {
      toast.error('Mova todos os itens desta collection para a lixeira antes de excluí-la.');
      return;
    }
    const confirmation = window.prompt(
      `Excluir a collection vazia “${editingCollection.name}”? Os bindings existentes manterão apenas o conteúdo estático. Digite ${editingCollection.slug} para confirmar.`,
    );
    if (confirmation?.trim() !== editingCollection.slug) return;
    setCollectionSaving(true);
    try {
      const response = await cmsFetch(
        restEndpoint(wp.cmsCollectionsUrl, `/${encodeURIComponent(editingCollection.slug)}`),
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': wp.nonce || '',
          },
          body: JSON.stringify({
            confirmation: editingCollection.slug,
            deleteItems: false,
            expectedRevision: editingCollection.revision,
          }),
        },
      );
      if (!response.ok) throw await cmsMutationError(response, 'Não foi possível excluir a collection.');
      const deleted = (await response.json()) as { revision?: string };
      const nextRevision = deleted.revision;
      if (!isCmsRevisionToken(nextRevision)) throw new Error('O CMS excluiu a collection sem confirmar a nova revisão.');
      const deletedSlug = editingCollection.slug;
      setSchema(current => current ? { ...current, revision: nextRevision } : current);
      setFieldsRevision(current => current ? nextRevision : current);
      setEditingCollection(null);
      window.localStorage.removeItem(`kodety:cms:columns:v2:${deletedSlug}`);
      const refreshed = await loadSchema(true);
      const nextType = refreshed?.types.find(type => type.slug !== 'page' && type.slug !== deletedSlug);
      setActiveType(nextType?.slug || (staticRuntime ? '' : 'post'));
      setSelectedItemIds([]);
      setItems([]);
      notifyItemsChanged();
      toast.success('Collection excluída.');
    } catch (error) {
      if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
      else toast.error(error instanceof Error ? error.message : 'Não foi possível excluir a collection.');
    } finally {
      setCollectionSaving(false);
    }
  }, [editingCollection, loadSchema, readOnly, refreshAfterRevisionConflict, staticRuntime, wp?.cmsCollectionsUrl, wp?.nonce]);

  const saveFields = useCallback((): Promise<boolean> => {
    if (saveFieldsInFlightRef.current) return saveFieldsInFlightRef.current;
    const request = (async (): Promise<boolean> => {
      if (readOnly || !wp?.cmsFieldsUrl || !activeType) return false;
      if (!fieldsRevision) {
        await refreshAfterRevisionConflict('A revisão atual dos campos não está disponível. O CMS foi recarregado antes de salvar.');
        return false;
      }
      const clean = fieldDefs
        .map(field => ({
          name: field.name.trim() || slugifyFieldName(field.label),
          label: field.label.trim() || field.name.trim(),
          type: field.type || 'text',
          description: (field.description || '').trim(),
          required: Boolean(field.required),
          default: field.default,
          min: field.min ?? '',
          max: field.max ?? '',
          step: field.step || 1,
          unit: field.unit || '',
        }))
        .filter(field => field.name !== '');
      const submittedDraftSignature = fieldsDraftSignature;
      setFieldsSaving(true);
      try {
        const response = await cmsFetch(restEndpoint(wp.cmsFieldsUrl, `/${encodeURIComponent(activeType)}`), {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': wp.nonce || '',
          },
          body: JSON.stringify({ fields: clean, expectedRevision: fieldsRevision }),
        });
        if (!response.ok) throw await cmsMutationError(response, 'Não foi possível salvar os campos.');
        const saved = (await response.json()) as {
          fields?: KodetyFieldDefinition[];
          revision?: string;
        };
        const nextRevision = saved.revision;
        if (!isCmsRevisionToken(nextRevision)) throw new Error('O CMS salvou os campos sem confirmar a nova revisão.');
        const nextFields = saved.fields || clean;
        if (fieldsDraftSignatureRef.current === submittedDraftSignature) {
          setFieldDefs(nextFields);
        }
        setInitialFieldDefs(nextFields);
        setFieldsRevision(nextRevision);
        setSchema(current => current ? { ...current, revision: nextRevision } : current);
        invalidateCmsSchemaCache();
        await loadSchema(true);
        notifyItemsChanged();
        setRefreshTick(tick => tick + 1);
        toast.success('Campos salvos. Eles já aparecem nas conexões e nos itens.');
        return true;
      } catch (error) {
        if (isCmsRevisionError(error)) await refreshAfterRevisionConflict();
        else toast.error(error instanceof Error ? error.message : 'Não foi possível salvar os campos.');
        return false;
      } finally {
        setFieldsSaving(false);
      }
    })();
    saveFieldsInFlightRef.current = request;
    void request.then(
      () => {
        if (saveFieldsInFlightRef.current === request) saveFieldsInFlightRef.current = null;
      },
      () => {
        if (saveFieldsInFlightRef.current === request) saveFieldsInFlightRef.current = null;
      },
    );
    return request;
  }, [activeType, fieldDefs, fieldsDraftSignature, fieldsRevision, loadSchema, readOnly, refreshAfterRevisionConflict, wp?.cmsFieldsUrl, wp?.nonce]);

  const waitForInlineMutations = useCallback(async (): Promise<boolean> => {
    let completed = true;
    while (cellMutationChainsRef.current.size > 0) {
      const pending = Array.from(cellMutationChainsRef.current.values());
      const outcomes = await Promise.allSettled(pending);
      if (outcomes.some(outcome => outcome.status === 'rejected' || outcome.value === false)) completed = false;
    }
    return completed && cellMutationPendingCountRef.current === 0;
  }, []);

  cmsLeaveDraftRef.current = { editingDirty, fieldsDirty, saveItem, saveFields };

  const waitForCmsStateCommit = useCallback(
    () => new Promise<void>(resolve => window.setTimeout(resolve, 0)),
    [],
  );

  const flushLatestCmsDrafts = useCallback(async (): Promise<boolean> => {
    if (!(await waitForInlineMutations())) {
      toast.error('Não foi possível confirmar todas as edições inline. A navegação foi cancelada.');
      return false;
    }

    // A save that was already in flight may acknowledge an older render. Yield
    // after every ACK, read the newest callbacks/dirty flags and keep draining
    // until the frozen CMS surface has no unacknowledged draft left.
    for (let pass = 0; pass < 3; pass += 1) {
      const activeSave = saveItemInFlightRef.current;
      if (activeSave && !(await activeSave)) return false;
      await waitForCmsStateCommit();
      const latest = cmsLeaveDraftRef.current;
      if (!latest.editingDirty) break;
      if (!(await latest.saveItem())) return false;
    }
    await waitForCmsStateCommit();
    if (saveItemInFlightRef.current && !(await saveItemInFlightRef.current)) return false;
    if (cmsLeaveDraftRef.current.editingDirty) {
      toast.error('O item continuou mudando durante o salvamento. Revise-o antes de sair.');
      return false;
    }

    for (let pass = 0; pass < 3; pass += 1) {
      const activeSave = saveFieldsInFlightRef.current;
      if (activeSave && !(await activeSave)) return false;
      await waitForCmsStateCommit();
      const latest = cmsLeaveDraftRef.current;
      if (!latest.fieldsDirty) break;
      if (!(await latest.saveFields())) return false;
    }
    await waitForCmsStateCommit();
    if (saveFieldsInFlightRef.current && !(await saveFieldsInFlightRef.current)) return false;
    if (cmsLeaveDraftRef.current.fieldsDirty) {
      toast.error('Os campos continuaram mudando durante o salvamento. Revise-os antes de sair.');
      return false;
    }
    return true;
  }, [waitForCmsStateCommit, waitForInlineMutations]);

  const saveBeforeWorkspaceNavigation = useCallback((): Promise<boolean> => {
    if (leavePreparationPromiseRef.current) return leavePreparationPromiseRef.current;
    leavingCmsRef.current = true;
    setLeavingCms(true);
    const preparation = (async (): Promise<boolean> => {
      if (uploadingField || collectionSaving || creatingCollection || bulkDeleting || deletingId > 0) {
        toast.info('Aguarde a operação atual antes de sair do CMS.');
        return false;
      }
      return flushLatestCmsDrafts();
    })().catch(error => {
      toast.error('Revise o CMS antes de sair.', {
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    });
    leavePreparationPromiseRef.current = preparation;
    void preparation.then(prepared => {
      if (!prepared && leavePreparationPromiseRef.current === preparation) {
        leavePreparationPromiseRef.current = null;
        leavingCmsRef.current = false;
        setLeavingCms(false);
      }
    });
    return preparation;
  }, [bulkDeleting, collectionSaving, creatingCollection, deletingId, flushLatestCmsDrafts, uploadingField]);
  prepareCmsLeaveRef.current = saveBeforeWorkspaceNavigation;

  useEffect(() => {
    if (!open) return;
    const resume = () => {
      leavePreparationPromiseRef.current = null;
      leavingCmsRef.current = false;
      setLeavingCms(false);
    };
    const unregister = registerWorkspaceNavigationGuard(async destination => {
      try { return await prepareCmsLeaveRef.current(); }
      finally { if (destination === 'backup') resume(); }
    });
    window.addEventListener(WORKSPACE_NAVIGATION_CANCELLED_EVENT, resume);
    return () => {
      unregister();
      window.removeEventListener(WORKSPACE_NAVIGATION_CANCELLED_EVENT, resume);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    leavePreparationPromiseRef.current = null;
    leavingCmsRef.current = false;
    setLeavingCms(false);
  }, [open]);

  const leaveManager = useCallback(async (href?: string) => {
    const prepared = await saveBeforeWorkspaceNavigation();
    if (!prepared) return;
    try {
      if (href && onNavigate) {
        const navigated = await onNavigate(href);
        if (navigated === false) {
          leavePreparationPromiseRef.current = null;
          leavingCmsRef.current = false;
          setLeavingCms(false);
        }
      } else if (href) throw new Error('A navegação segura do workspace não está disponível.');
      else onOpenChange(false);
    } catch (error) {
      leavePreparationPromiseRef.current = null;
      leavingCmsRef.current = false;
      setLeavingCms(false);
      toast.error('Não foi possível sair do CMS.', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [onNavigate, onOpenChange, saveBeforeWorkspaceNavigation]);

  const editingItem = editing !== 'new' ? editing : null;

  const managerContent = (
    <div
      data-kodety-cms-manager
      data-kodety-onboarding="cms-workspace"
      aria-busy={(leavingCms || saving || fieldsSaving) || undefined}
      inert={leavingCms || saving || fieldsSaving}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--kodety-panel)]"
    >
      {standalone ? (
        <>
          <h1 className="sr-only">{wp?.cmsRuntime === 'static' ? 'CMS do projeto' : 'CMS do WordPress'}</h1>
          <p className="sr-only">Collections, campos e conteúdo em um único lugar.</p>
        </>
      ) : (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] px-3">
          <DialogTitle className="sr-only">{wp?.cmsRuntime === 'static' ? 'CMS do projeto' : 'CMS do WordPress'}</DialogTitle>
          <DialogDescription className="sr-only">Collections, campos e conteúdo em um único lugar.</DialogDescription>
          {backHref ? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 rounded-[8px] bg-white/[.035] text-muted-foreground hover:bg-white/[.065] hover:text-foreground"
              asChild
            >
              <a
                href={backHref}
                onClick={event => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void leaveManager(backHref);
                }}
                title="Voltar ao Builder"
                aria-label="Voltar ao Builder"
              >
                <ChevronLeft className="size-4" />
              </a>
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              className="shrink-0 rounded-[8px] bg-white/[.035] text-muted-foreground hover:bg-white/[.065] hover:text-foreground"
              disabled={leavingCms}
              onClick={() => {
                void leaveManager();
              }}
              title="Voltar ao Builder"
              aria-label="Voltar ao Builder"
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white/[.045] text-[var(--kodety-accent-hover)]">
            <FolderWithFilesIcon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold leading-4">CMS</span>
            <span className="hidden truncate text-[9px] leading-3 text-muted-foreground sm:block">
              {selectedType?.name || (wp?.cmsRuntime === 'static' ? 'HTML' : 'WordPress')} · conteúdo conectado
            </span>
          </span>
          {readOnly && (
            <span className="ml-1 rounded-[7px] border border-[var(--kodety-accent-border)] bg-[var(--kodety-accent-muted)] px-2 py-1 text-[9px] font-medium text-[var(--kodety-accent-hover)]">
              Somente leitura
            </span>
          )}
          <div className="ml-auto" />
          {wp?.settingsUrl && (
            <Button size="icon-sm" variant="secondary" className="hidden rounded-[8px] sm:inline-flex" asChild>
              <a
                href={urlWithParam(wp.settingsUrl, 'section', 'mcp')}
                onClick={event => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void leaveManager(urlWithParam(wp.settingsUrl!, 'section', 'mcp'));
                }}
                title="Configurações e integrações do CMS"
                aria-label="Configurações e integrações do CMS"
              >
                <Settings2 />
              </a>
            </Button>
          )}
          <Select value={activeType || undefined} onValueChange={requestActiveType} disabled={!types.length}>
            <SelectTrigger className="h-9 w-40 rounded-[9px] sm:hidden">
              <SelectValue placeholder="Collection" />
            </SelectTrigger>
            <SelectContent>
              {types.map(type => (
                <SelectItem key={type.slug} value={type.slug}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>
      )}
      {revisionConflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[var(--kodety-divider-strong)] bg-white/[.04] px-4 py-3 text-xs">
          <p className="min-w-0 flex-1">O CMS mudou em outra sessão. Seu rascunho foi preservado; copie as alterações que deseja manter antes de recarregar.</p>
          <Button size="xs" variant="secondary" onClick={() => {
            if (!window.confirm('Descartar os rascunhos deste painel e recarregar os dados atuais do CMS?')) return;
            setEditing(null); setEditingExpectedRevision(''); setEditingCollection(null); setImportOpen(false);
            setFieldsRevision(''); setFieldsRefreshTick(tick => tick + 1); setRefreshTick(tick => tick + 1);
            setRevisionConflict(false); void loadSchema(true);
          }}>Descartar rascunho e recarregar</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 bg-[var(--kodety-panel)]">
        <aside data-kodety-onboarding="cms-navigation" className={`${staticRuntime && !types.length && creatingCollection ? 'flex w-full sm:w-[232px]' : 'hidden w-[232px] sm:flex'} shrink-0 flex-col border-r border-[var(--kodety-divider-strong)] bg-[#0f0f0f]`}>
          <div
            role="tablist"
            aria-label="Área do CMS"
            className="mx-3 my-2 grid h-8 shrink-0 grid-cols-2 rounded-[10px] bg-white/[0.065] p-[3px]"
          >
            {([
              { value: 'collections', label: 'Coleções' },
              { value: 'fields', label: 'Campos' },
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                role="tab"
                data-kodety-onboarding={`cms-${option.value}-tab`}
                data-kodety-onboarding-reveal={
                  !editingDirty && !fieldsDirty && !saving && !fieldsSaving && !uploadingField
                  && cellMutationPendingCountRef.current === 0
                  && (option.value !== 'fields' || canManageSchema)
                    ? '' : undefined
                }
                aria-selected={view === option.value}
                disabled={option.value === 'fields' && (!canManageSchema || !collectionReady)}
                onClick={() => requestView(option.value)}
                className={`rounded-[7px] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  view === option.value
                    ? 'bg-white/[0.13] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground/85'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {view === 'collections' && (
            <>
              <div data-kodety-onboarding="cms-collection-search" className="px-3 pb-2 pt-1">
                <CmsSearchControl value={collectionSearch} onChange={setCollectionSearch} placeholder="Buscar collection…" label="Buscar collection" />
              </div>
              <div data-kodety-onboarding="cms-collections" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                {filteredTypes.map(type => (
                  <div
                    key={type.slug}
                    className={`group/collection relative flex h-9 w-full items-center rounded-[7px] text-[11px] transition-[background-color,color] ${type.slug === activeType ? 'bg-[var(--kodety-accent-muted)] font-medium text-foreground' : 'text-muted-foreground hover:bg-white/[.045] hover:text-foreground'}`}
                  >
                    {type.slug === activeType && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--kodety-accent)]" />}
                    <button
                      type="button"
                      onClick={() => requestActiveType(type.slug)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2.5 text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--kodety-focus)]"
                    >
                      <Database
                        aria-hidden="true"
                        className={`size-3.5 shrink-0 ${type.slug === activeType ? 'text-[var(--kodety-accent-hover)]' : 'text-white/28 group-hover/collection:text-white/55'}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{type.name}</span>
                      {typeof type.itemCount === 'number' && <span className="text-[8px] tabular-nums text-muted-foreground">{type.itemCount}</span>}
                    </button>
                    {canManageSchema && type.collection && !type.readOnly ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Ações da collection ${type.name}`}
                            className="mr-1 grid size-7 shrink-0 place-items-center rounded-[6px] text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-white/[.07] hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/collection:opacity-100"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => beginEditingCollection(type)}>
                            <Pencil /> Renomear collection
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-300 focus:text-red-200"
                            onSelect={() => beginEditingCollection(type)}
                          >
                            <Trash2 /> Abrir exclusão…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                ))}
                {!types.length && !schemaError && <p className="px-2 py-6 text-center text-[10px] text-muted-foreground">{staticRuntime && schema ? 'Nenhuma coleção criada.' : 'Carregando collections…'}</p>}
                {types.length > 0 && !filteredTypes.length && (
                  <p className="px-3 py-6 text-center text-[10px] text-muted-foreground">Nenhuma collection encontrada.</p>
                )}
                {schemaError && (
                  <div role="alert" className="px-3 py-6 text-center">
                    <p className="text-[10px] leading-4 text-red-300">{schemaError}</p>
                    <Button size="xs" variant="ghost" className="mt-2" onClick={() => void loadSchema(true)}>
                      <RefreshCw /> Tentar novamente
                    </Button>
                  </div>
                )}
              </div>
              {canManageSchema && (
                <div className="border-t border-[var(--kodety-divider)] px-3 pb-4 pt-3">
                  {editingCollection ? (
                    <div data-kodety-cms-card className="space-y-2 rounded-[9px] border border-white/[.055] bg-white/[.025] p-2">
                      <p className="px-0.5 text-[10px] font-medium text-foreground">Editar collection</p>
                      <HtmlSettingsFieldControl label="Nome da collection" kind="text">
                        <Input
                          autoFocus
                          value={editingCollection.name}
                          onChange={event => setEditingCollection(current => current ? { ...current, name: event.target.value } : current)}
                        />
                      </HtmlSettingsFieldControl>
                      <HtmlSettingsFieldControl label="Nome singular" kind="text">
                        <Input
                          value={editingCollection.singular}
                          onChange={event => setEditingCollection(current => current ? { ...current, singular: event.target.value } : current)}
                        />
                      </HtmlSettingsFieldControl>
                      <HtmlSettingsFieldControl label="Slug público da URL (preservado)" kind="id">
                        <Input
                          value={editingCollection.urlSlug}
                          readOnly
                          disabled
                        />
                      </HtmlSettingsFieldControl>
                      <p className="px-0.5 text-[9px] leading-4 text-muted-foreground">
                        O ID <code>{editingCollection.slug}</code> e a URL permanecem estáveis para preservar bindings, templates e links publicados.
                      </p>
                      {editingCollection.itemCount > 0 ? (
                        <p className="rounded-[6px] bg-amber-400/[.07] px-2 py-1.5 text-[9px] leading-4 text-amber-200/80">
                          Esta collection ainda tem {editingCollection.itemCount} item(ns). Mova-os para a lixeira antes de excluir a collection.
                        </p>
                      ) : null}
                      <div className="flex gap-1.5">
                        <Button size="xs" className="flex-1" disabled={collectionSaving || !editingCollection.name.trim()} onClick={() => void updateCollection()}>
                          {collectionSaving ? <Loader2 className="animate-spin" /> : <Check />} Salvar
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={collectionSaving}
                          title="Cancelar edição da collection"
                          aria-label="Cancelar edição da collection"
                          onClick={() => setEditingCollection(null)}
                        >
                          <X />
                        </Button>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-8 w-full justify-center text-red-300 hover:text-red-200"
                        disabled={collectionSaving || editingCollection.itemCount > 0}
                        title={editingCollection.itemCount > 0 ? 'Esvazie a collection antes de excluí-la' : 'Excluir collection vazia'}
                        onClick={() => void deleteCollection()}
                      >
                        <Trash2 /> Excluir collection…
                      </Button>
                    </div>
                  ) : creatingCollection ? (
                    <div data-kodety-cms-card className="space-y-2 rounded-[9px] border border-white/[.055] bg-white/[.025] p-2">
                      <HtmlSettingsFieldControl label="Nome da collection" kind="text">
                        <Input
                          autoFocus
                          value={newCollection.name}
                          placeholder="Nome (ex.: Projetos)"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                      <HtmlSettingsFieldControl label="Nome singular" kind="text">
                        <Input
                          value={newCollection.singular}
                          placeholder="Singular (ex.: Projeto)"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              singular: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                      <HtmlSettingsFieldControl label="Slug da collection" kind="id">
                        <Input
                          value={newCollection.slug}
                          placeholder="Slug da URL (ex.: projetos)"
                          onChange={event =>
                            setNewCollection(current => ({
                              ...current,
                              slug: event.target.value,
                            }))
                          }
                        />
                      </HtmlSettingsFieldControl>
                      <div className="flex gap-1.5">
                        <Button size="xs" className="flex-1" disabled={collectionSaving || !newCollection.name.trim()} onClick={() => void createCollection()}>
                          {collectionSaving ? <Loader2 className="animate-spin" /> : <Plus />} Criar
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          title="Cancelar criação da collection"
                          aria-label="Cancelar criação da collection"
                          onClick={() => setCreatingCollection(false)}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        size="xs"
                        className="h-9 w-full justify-center rounded-[7px] px-3"
                        disabled={collectionLimitReached}
                        title={collectionLimitReached ? `Limite: ${collectionLimit} collection` : 'Nova collection'}
                        onClick={() => setCreatingCollection(true)}
                      >
                        <Plus /> Nova collection
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-9 w-full justify-center rounded-[7px] px-3 text-muted-foreground"
                        onClick={() => setImportOpen(true)}
                      >
                        <FileSpreadsheet /> Importar conteúdo CSV
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {view === 'fields' && collectionReady && (
            <>
              <div data-kodety-onboarding="cms-fields-collection" className="flex items-center gap-1.5 px-3 pb-3 pt-1">
                <div className="min-w-0 flex-1">
                  <HtmlSettingsFieldControl label="Collection" kind="collection">
                    <Select value={activeType || undefined} onValueChange={requestActiveType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Collection" />
                      </SelectTrigger>
                      <SelectContent>
                        {types.map(type => (
                          <SelectItem key={type.slug} value={type.slug}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </HtmlSettingsFieldControl>
                </div>
                <FieldTypePicker onSelect={addField} />
              </div>
              <div data-kodety-onboarding="cms-fields-list" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <p className="px-3 pb-1 pt-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">WordPress</p>
                {(selectedType?.fields || [])
                  .filter(field => ['title', 'content', 'status', 'featured_image', 'date', 'permalink'].includes(field.key))
                  .map(field => (
                    <div key={field.key} className="flex h-8 items-center gap-2 rounded-[7px] px-2 text-[11px] text-muted-foreground">
                      <FieldTypeIcon type={field.type} className="size-3 text-white/28" />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                      <span className="text-[8px] uppercase tracking-wide">Nativo</span>
                    </div>
                  ))}
                <div className="my-1.5 border-t border-white/[0.07]" />
                <p className="px-3 pb-1 pt-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Personalizados</p>
                {fieldDefs.map((field, index) => (
                  <div
                    key={`${field.name}:${index}`}
                    className={`group relative my-0.5 flex min-h-9 w-full items-center overflow-hidden rounded-[7px] text-[11px] transition-[background-color,color] ${selectedFieldIndex === index ? 'bg-[var(--kodety-accent-muted)] text-foreground' : 'text-muted-foreground hover:bg-white/[.045] hover:text-foreground'}`}
                  >
                    {selectedFieldIndex === index && (
                      <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--kodety-accent)]" />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedFieldIndex(index)}
                      data-kodety-onboarding="cms-field-select"
                      data-kodety-onboarding-reveal={!fieldsLoading && !fieldsSaving && !uploadingField ? '' : undefined}
                      aria-current={selectedFieldIndex === index ? 'true' : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2.5 text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(147_147_255/.65)]"
                    >
                      <FieldTypeIcon
                        type={field.type}
                        className={selectedFieldIndex === index ? 'size-3.5 text-[var(--kodety-accent-hover)]' : 'size-3.5 text-white/30'}
                      />
                      <span className="min-w-0 flex-1 truncate">{field.label || 'Novo campo'}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Mover ${field.label || 'campo'} para cima`}
                      disabled={index === 0}
                      onClick={() => moveField(index, -1)}
                      className="grid size-6 place-items-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-0 group-hover:opacity-100"
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Mover ${field.label || 'campo'} para baixo`}
                      disabled={index === fieldDefs.length - 1}
                      onClick={() => moveField(index, 1)}
                      className="grid size-6 place-items-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-0 group-hover:opacity-100"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remover ${field.label || 'campo'}`}
                      onClick={() => {
                        setFieldDefs(current => current.filter((_, candidateIndex) => candidateIndex !== index));
                        setSelectedFieldIndex(null);
                      }}
                      className="mr-1 grid size-6 place-items-center text-muted-foreground opacity-0 transition-opacity hover:text-red-300 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
                {!fieldDefs.length && (
                  <p className="px-3 py-6 text-center text-[10px] leading-4 text-muted-foreground">
                    Nenhum campo personalizado.
                    <br />
                    Use + para adicionar.
                  </p>
                )}
              </div>
              <div className="border-t border-white/[0.07] p-2">
                <Button size="xs" className="h-9 w-full rounded-[9px]" disabled={fieldsSaving} onClick={() => void saveFields()}>
                  {fieldsSaving ? <Loader2 className="animate-spin" /> : null} Salvar campos
                </Button>
              </div>
            </>
          )}
        </aside>

        <section data-kodety-onboarding="cms-content" data-kodety-onboarding-section={view} className={`relative ${staticRuntime && !types.length && creatingCollection ? 'hidden sm:flex' : 'flex'} min-h-0 min-w-0 flex-1 flex-col bg-[var(--kodety-panel)]`}>
          {view === 'fields' && collectionReady && (
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] p-2 sm:hidden">
              <Select value={activeType || undefined} onValueChange={requestActiveType}>
                <SelectTrigger className="h-7 min-w-0 flex-1">
                  <SelectValue placeholder="Collection" />
                </SelectTrigger>
                <SelectContent>
                  {types.map(type => (
                    <SelectItem key={type.slug} value={type.slug}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedFieldIndex === null ? '__none' : String(selectedFieldIndex)}
                onValueChange={value => setSelectedFieldIndex(value === '__none' ? null : Number(value))}
              >
                <SelectTrigger className="h-7 min-w-0 flex-1">
                  <SelectValue placeholder="Campo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Selecionar campo</SelectItem>
                  {fieldDefs.map((field, index) => (
                    <SelectItem key={`${field.name}:${index}`} value={String(index)}>
                      {field.label || 'Novo campo'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldTypePicker onSelect={addField} />
            </div>
          )}
          {staticRuntime && !selectedType ? (
            <div data-kodety-cms-first-collection className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
              {(!schema || types.length > 0) && !schemaError ? <p role="status" className="text-xs text-muted-foreground">Carregando coleções…</p> : (
                <div className="w-full max-w-sm text-center">
                  <h2 className="text-sm font-semibold">{schemaError ? 'Não foi possível carregar o CMS' : canManageSchema ? 'Crie sua primeira coleção' : 'Nenhuma coleção criada'}</h2>
                  <p className="mt-2 text-balance text-xs leading-5 text-muted-foreground">{schemaError ? 'Tente novamente para carregar as coleções deste projeto.' : 'Organize conteúdos como artigos, projetos ou produtos. Depois, conecte os campos ao seu site.'}</p>
                  {schemaError ? <Button className="mt-4" size="sm" variant="secondary" onClick={() => void loadSchema(true)}>Tentar novamente</Button>
                    : canManageSchema && <Button className="mt-4" size="sm" disabled={collectionLimitReached || creatingCollection} onClick={() => { setView('collections'); setCreatingCollection(true); }}>Criar primeira coleção</Button>}
                </div>
              )}
            </div>
          ) : false ? (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <Button size="icon-xs" variant="ghost" onClick={() => setEditing(null)} title="Voltar para a lista">
                  <ChevronLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{editing === 'new' ? `Novo item em ${selectedType?.name || activeType}` : editingItem?.label}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {editing === 'new' ? 'O item será criado no CMS.' : 'As alterações são salvas no CMS nativo.'}
                  </p>
                </div>
                {editingItem?.editUrl && (
                  <Button size="icon-xs" variant="ghost" asChild title="Abrir no wp-admin">
                    <a href={editingItem?.editUrl || '#'} target="_blank" rel="noreferrer">
                      <ExternalLink />
                    </a>
                  </Button>
                )}
                <Select value={String(formValues.status || 'draft')} onValueChange={value => setFormValues(current => ({ ...current, status: value }))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedType?.capabilities?.publish !== false ? <SelectItem value="publish">Publicado</SelectItem> : null}
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="pending">Pendente</SelectItem>
                    {selectedType?.capabilities?.publish !== false ? <SelectItem value="private">Privado</SelectItem> : null}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={saving} onClick={() => void saveItem()}>
                  {saving ? <Loader2 className="animate-spin" /> : null} {saving ? 'Salvando…' : 'Salvar'}
                </Button>
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {supportsThumbnail && (
                  <div className="space-y-1">
                    <Label variant="muted">Imagem destacada</Label>
                    <div className="flex items-center gap-3">
                      <span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-input">
                        {featuredImage.url ? (
                          <img src={featuredImage.url} alt="" className="size-full object-cover" />
                        ) : (
                          <ImageIcon className="size-5 text-muted-foreground" />
                        )}
                      </span>
                      <div className="flex flex-col gap-1.5">
                        <Button type="button" size="xs" variant="secondary" disabled={uploadingField === 'featured_image'} asChild>
                          <label className="cursor-pointer">
                            {uploadingField === 'featured_image' ? <Loader2 className="animate-spin" /> : <Upload />}{' '}
                            {featuredImage.url ? 'Trocar imagem' : 'Enviar imagem'}
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={event => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (!file) return;
                                void uploadImage(
                                  file,
                                  value => {
                                    const attachment = value as {
                                      id?: number;
                                      source_url?: string;
                                    };
                                    setFeaturedImage({
                                      id: attachment.id || null,
                                      url: attachment.source_url || '',
                                    });
                                  },
                                  'featured_image',
                                );
                              }}
                            />
                          </label>
                        </Button>
                        {featuredImage.url && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="text-red-300 hover:text-red-200"
                            onClick={() => setFeaturedImage({ id: null, url: '' })}
                          >
                            <Trash2 /> Remover
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {editableFields
                  .filter(field => field.key !== 'status')
                  .map(field => (
                    <FieldEditor
                      key={field.key}
                      field={field}
                      value={formValues[field.key]}
                      onChange={value =>
                        setFormValues(current => ({
                          ...current,
                          [field.key]: value,
                        }))
                      }
                      onUploadImage={(file, apply) => void uploadImage(file, apply, field.key)}
                      uploading={uploadingField === field.key}
                      permalink={String(editingItem?.values.permalink || '')}
                      collectionSlug={activeType}
                    />
                  ))}
              </div>
            </>
          ) : view === 'fields' ? (
            <>
              <header className="flex min-h-16 items-center gap-3 border-b border-[var(--kodety-divider)] bg-[#0d0d0d] px-4 sm:px-5">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="rounded-[7px] sm:hidden"
                  title="Voltar ao conteúdo"
                  aria-label="Voltar ao conteúdo"
                  onClick={() => requestView('collections')}
                >
                  <ChevronLeft />
                </Button>
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)]">
                  <LayersIcon aria-hidden="true" className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">Campos de {selectedType?.name || activeType}</span>
                  <span data-kodety-cms-description className="block text-[9px] text-muted-foreground">
                    Estrutura editorial · {fieldDefs.length} personalizado
                    {fieldDefs.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="hidden sm:inline-flex">
                  <FieldTypePicker onSelect={addField} />
                </span>
                <Button size="sm" disabled={fieldsSaving || fieldsLoading} onClick={() => void saveFields()}>
                  {fieldsSaving ? <Loader2 className="animate-spin" /> : null} Salvar campos
                </Button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
                {fieldsLoading ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">Carregando campos…</p>
                ) : selectedFieldIndex !== null && fieldDefs[selectedFieldIndex] ? (
                  <FieldDefinitionSettings
                    field={fieldDefs[selectedFieldIndex]}
                    onChange={patch => setFieldDefs(current => current.map((field, index) => (index === selectedFieldIndex ? { ...field, ...patch } : field)))}
                    onUploadImage={(file, apply) => void uploadImage(file, apply, `field-default:${selectedFieldIndex}`)}
                    uploading={uploadingField === `field-default:${selectedFieldIndex}`}
                  />
                ) : (
                  <CmsEmptyState
                    icon={LayersIcon}
                    title="Selecione ou crie um campo"
                    description="Os campos personalizados aparecem nas colunas, no editor dos itens e nas conexões do Design."
                  >
                    <div className="inline-flex items-center gap-2 text-[10px] text-muted-foreground">
                      <FieldTypePicker onSelect={addField} />
                      <span>Adicionar campo</span>
                    </div>
                  </CmsEmptyState>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col bg-[#0d0d0d]">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--kodety-panel)]">
                <header data-cms-items-toolbar data-kodety-onboarding="cms-toolbar" className="flex min-h-14 shrink-0 items-center gap-1 overflow-hidden border-b border-white/[.055] bg-[#101010] px-2 sm:px-4">
                  {!readOnly && selectedType?.capabilities?.create !== false && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="rounded-[8px]"
                      disabled={itemLimitReached}
                      title={itemLimitReached ? `Limite: ${itemLimit} itens` : 'Novo item'}
                      aria-label="Novo item"
                      data-kodety-onboarding="cms-new-item"
                      onClick={() => startEditing('new')}
                    >
                      <Plus />
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-[8px]"
                    title={`${columnCandidates.find(field => field.key === sortField)?.label || (sortField === 'modified' ? 'Atualizado' : sortField)}: ${sortOrder === 'DESC' ? 'ordem decrescente' : 'ordem crescente'}`}
                    aria-label="Inverter ordenação atual"
                    data-kodety-onboarding="cms-sort"
                    onClick={() => setSortOrder(current => (current === 'DESC' ? 'ASC' : 'DESC'))}
                  >
                    <ArrowUpDown />
                  </Button>
                  <Popover open={statusFilterOpen} onOpenChange={setStatusFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className={`relative rounded-[8px] ${statusFilter ? 'bg-white/[.065] text-foreground' : ''}`}
                        title={statusFilter ? `Filtro ativo: ${STATUS_LABELS[statusFilter] || statusFilter}` : 'Filtrar por status'}
                        aria-label={statusFilter ? `Filtrar por status. Filtro atual: ${STATUS_LABELS[statusFilter] || statusFilter}` : 'Filtrar por status'}
                        data-kodety-onboarding="cms-status-filter"
                      >
                        <Filter />
                        {statusFilter ? <span aria-hidden="true" className="absolute bottom-1 right-1 size-1 rounded-full bg-[var(--kodety-accent-hover)]" /> : null}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent data-kodety-cms-surface align="start" className="w-40 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-1.5">
                      {([
                        ['', 'Todos'],
                        ['publish', 'Publicados'],
                        ['draft', 'Rascunhos'],
                        ['pending', 'Pendentes'],
                      ] as const).map(([value, label]) => {
                        const active = statusFilter === value;
                        return (
                          <button
                            key={value || 'all'}
                            type="button"
                            className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[10px] outline-none transition-colors hover:bg-white/[.055] focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                            onClick={() => {
                              setStatusFilter(value);
                              setStatusFilterOpen(false);
                            }}
                          >
                            <span className="min-w-0 flex-1">{label}</span>
                            {active ? <Check aria-hidden="true" className="size-3 text-white/60" /> : null}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                  <div className={`flex h-9 min-w-0 items-center transition-[width] ${searchExpanded || search ? 'w-40 sm:w-56' : 'w-9'}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className={`shrink-0 rounded-[8px] ${searchExpanded || search ? 'bg-white/[.065] text-foreground' : ''}`}
                      title="Buscar itens"
                      aria-label="Buscar itens"
                      data-kodety-onboarding="cms-item-search"
                      aria-expanded={searchExpanded || Boolean(search)}
                      onClick={() => {
                        setSearchExpanded(true);
                        window.requestAnimationFrame(() => itemSearchInputRef.current?.focus());
                      }}
                    >
                      <Search />
                    </Button>
                    {searchExpanded || search ? (
                      <input
                        ref={itemSearchInputRef}
                        type="search"
                        value={search}
                        aria-label={`Buscar em ${selectedType?.name || 'itens'}`}
                        placeholder="Buscar…"
                        className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
                        onChange={event => setSearch(event.target.value)}
                        onBlur={() => {
                          if (!search) setSearchExpanded(false);
                        }}
                        onKeyDown={event => {
                          if (event.key !== 'Escape') return;
                          setSearch('');
                          setSearchExpanded(false);
                        }}
                      />
                    ) : null}
                  </div>
                  <span className={searchExpanded || search ? 'hidden sm:block sm:ml-auto' : 'ml-auto'} />
                  <div className={`${searchExpanded || search ? 'hidden' : 'w-28'} sm:hidden`}>
                    <Select value={activeType || undefined} onValueChange={requestActiveType} disabled={!types.length}>
                      <SelectTrigger aria-label="Collection atual">
                        <SelectValue placeholder="Collection" />
                      </SelectTrigger>
                      <SelectContent>
                        {types.map(type => (
                          <SelectItem key={type.slug} value={type.slug}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {canManageSchema && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="hidden rounded-[8px] sm:inline-flex"
                      title="Gerenciar campos"
                      aria-label="Gerenciar campos"
                      data-kodety-onboarding="cms-fields"
                      onClick={() => requestView('fields')}
                    >
                      <LayersIcon aria-hidden="true" className="size-3.5" />
                    </Button>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className={`rounded-[8px] ${searchExpanded || search ? 'hidden sm:inline-flex' : ''}`}
                        title={`Colunas visíveis (${tableFields.length})`}
                        aria-label={`Escolher colunas visíveis. ${tableFields.length} selecionadas`}
                        data-kodety-onboarding="cms-visible-columns"
                      >
                        <Columns3 />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent data-kodety-cms-surface align="end" className="w-72 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-2">
                      <div className="border-b px-2 pb-2">
                        <p className="text-xs font-medium">Colunas visíveis</p>
                        <p data-kodety-cms-description className="mt-0.5 text-[9px] leading-4 text-muted-foreground">
                          Escolha os campos exibidos na tabela. Role horizontalmente para ver todos.
                        </p>
                      </div>
                      <div className="max-h-72 space-y-0.5 overflow-y-auto pt-2">
                        {columnCandidates.map(field => {
                          const checked = visibleFieldKeys.includes(field.key);
                          return (
                            <label
                              key={field.key}
                              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-transparent px-2 py-1.5 text-[11px] hover:border-white/[.04] hover:bg-white/[.045]"
                            >
                              <CmsCheckbox
                                ariaLabel={`Exibir coluna ${field.label}`}
                                checked={checked}
                                onCheckedChange={() => toggleVisibleField(field.key)}
                              />
                              <FieldTypeIcon type={field.type} />
                              <span className="min-w-0 flex-1 truncate">{field.label}</span>
                              {checked && <span className="text-[8px] text-[var(--kodety-accent-hover)]">Visível</span>}
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="hidden rounded-[8px] sm:inline-flex"
                    title="Recarregar"
                    aria-label="Recarregar"
                    onClick={() => setRefreshTick(tick => tick + 1)}
                  >
                    <RefreshCw />
                  </Button>
                  {canManageSchema && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="hidden rounded-[8px] sm:inline-flex"
                      title="Importar itens de um arquivo CSV"
                      aria-label="Importar itens de um arquivo CSV"
                      data-kodety-onboarding="cms-import"
                      onClick={() => setImportOpen(true)}
                    >
                      <FileSpreadsheet />
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className={`${searchExpanded || search ? 'hidden' : 'inline-flex'} rounded-[8px] sm:hidden`}
                        title="Mais ações"
                        aria-label="Mais ações"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      data-kodety-cms-surface
                      align="end"
                      collisionPadding={12}
                      className="z-[10020] min-w-44 rounded-[10px] border-white/[.08] bg-[#1b1b1b] p-1.5"
                    >
                      {canManageSchema ? (
                        <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={() => requestView('fields')}>
                          <LayersIcon aria-hidden="true" className="size-3.5" /> Gerenciar campos
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={() => setRefreshTick(tick => tick + 1)}>
                        <RefreshCw className="size-3.5" /> Recarregar
                      </DropdownMenuItem>
                      {canManageSchema ? (
                        <DropdownMenuItem className="h-8 rounded-[7px] text-[10px]" onSelect={() => setImportOpen(true)}>
                          <FileSpreadsheet className="size-3.5" /> Importar CSV
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </header>
                {!readOnly && selectedItemIds.length > 0 && (
                  <div
                    data-kodety-cms-card
                    className="mx-2 mt-2 flex min-h-10 shrink-0 items-center gap-2 rounded-[9px] border border-white/[.055] bg-white/[.035] px-3"
                    aria-live="polite"
                  >
                    <span className="text-[11px] font-medium">
                      {selectedItemIds.length} selecionado
                      {selectedItemIds.length === 1 ? '' : 's'}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-red-300 hover:text-red-200"
                      disabled={bulkDeleting}
                      onClick={() => void deleteSelectedItems()}
                    >
                      {bulkDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      {bulkDeleting ? 'Movendo…' : 'Mover para lixeira'}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto"
                      title="Limpar seleção"
                      aria-label="Limpar seleção"
                      onClick={() => setSelectedItemIds([])}
                    >
                      <X />
                    </Button>
                  </div>
                )}
                {itemsError && (
                  <div
                    role="alert"
                    className="mx-2 mt-2 flex min-h-10 shrink-0 items-center gap-2 rounded-[9px] border border-red-400/20 bg-red-500/[.045] px-3 text-[10px] text-red-200"
                  >
                    <span className="min-w-0 flex-1 truncate">{itemsError}</span>
                    <Button size="xs" variant="ghost" className="text-red-100" onClick={() => setRefreshTick(tick => tick + 1)}>
                      <RefreshCw /> Tentar novamente
                    </Button>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  {itemsLoading && !items.length && !itemsError ? (
                    <p role="status" aria-live="polite" className="flex items-center justify-center gap-2 px-4 py-10 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Carregando itens…
                    </p>
                  ) : items.length ? (
                    <table data-cms-items-grid data-kodety-onboarding="cms-items" className="w-max min-w-full table-fixed border-collapse bg-[var(--kodety-panel)] text-left">
                      <thead data-kodety-onboarding="cms-item-columns" className="sticky top-0 z-10 bg-[#121212] shadow-[0_1px_0_rgb(255_255_255/.055)]">
                        <tr className="h-11 border-b border-white/[.055] text-[10px] font-medium normal-case tracking-normal text-foreground/70">
                          {!readOnly && (
                            <th className="w-10 border-r border-white/[.055] px-3">
                              <CmsCheckbox
                                ariaLabel="Selecionar todos os itens visíveis"
                                checked={allVisibleItemsSelected}
                                onCheckedChange={toggleAllVisibleItems}
                              />
                            </th>
                          )}
                          {tableFields.map(field => (
                            <th
                              key={field.key}
                              className={`${field.key === 'title' ? 'w-56' : field.key === 'featured_image' ? 'w-20' : field.key === 'status' ? 'w-32' : field.type === 'boolean' || field.type === 'true_false' ? 'w-24' : field.type === 'color' ? 'w-32' : 'w-48'} border-r border-white/[.055] px-3`}
                            >
                              <CmsColumnHeader
                                field={field}
                                activeSortField={sortField}
                                sortOrder={sortOrder}
                                canEdit={canManageSchema && field.key.startsWith('field:') && fieldDefs.some(definition => `field:${definition.name}` === field.key)}
                                canHide={tableFields.length > 1}
                                onEdit={() => editCmsColumnField(field)}
                                onSort={order => {
                                  setSortField(field.key);
                                  setSortOrder(order);
                                  setPage(1);
                                }}
                                onHide={() => toggleVisibleField(field.key)}
                              />
                            </th>
                          ))}
                          <th className="w-36 border-r border-white/[.055] px-3">
                            <CmsColumnHeader
                              field={{ key: 'modified', label: 'Atualizado', type: 'date', source: 'wordpress' }}
                              activeSortField={sortField}
                              sortOrder={sortOrder}
                              canEdit={false}
                              canHide={false}
                              onEdit={() => undefined}
                              onSort={order => {
                                setSortField('modified');
                                setSortOrder(order);
                                setPage(1);
                              }}
                              onHide={() => undefined}
                            />
                          </th>
                          {!readOnly && <th className="w-10 px-2" />}
                        </tr>
                      </thead>
                      <tbody>
                        {tableItems.map(item => (
                          <tr
                            key={item.id}
                            data-kodety-onboarding="cms-item-row"
                            className={`group h-12 cursor-pointer border-b border-white/[.055] transition-[background-color,box-shadow] hover:bg-white/[.018] ${selectedItemIds.includes(item.id) ? 'bg-[var(--kodety-accent-muted)] shadow-[inset_2px_0_0_var(--kodety-accent)]' : ''}`}
                            onClick={() => startEditing(item)}
                          >
                            {!readOnly && (
                              <td className="border-r border-white/[.055] px-3" onClick={event => event.stopPropagation()}>
                                <CmsCheckbox
                                  ariaLabel={`Selecionar ${item.label}`}
                                  checked={selectedItemIds.includes(item.id)}
                                  disabled={item.capabilities?.delete === false}
                                  onCheckedChange={() => toggleItemSelection(item)}
                                />
                              </td>
                            )}
                            {tableFields.map(field => (
                              <td
                                key={field.key}
                                data-cms-grid-cell={field.key}
                                className="border-r border-white/[.055] p-0 align-middle transition-[background-color,box-shadow] focus-within:bg-white/[0.025] focus-within:shadow-[inset_0_-1px_0_var(--kodety-accent)]"
                              >
                                <CmsTableCell
                                  field={field}
                                  item={item}
                                  canPublish={item.capabilities?.publish ?? selectedType?.capabilities?.publish ?? true}
                                  onChange={value => void updateItemField(item, field.key, value)}
                                />
                              </td>
                            ))}
                            <td className="border-r border-white/[.055] px-3 text-[10px] text-muted-foreground">{formatCmsDate(item.modifiedIso)}</td>
                            {!readOnly && (
                              <td className="px-1.5 text-center" onClick={event => event.stopPropagation()}>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      size="icon-xs"
                                      variant="ghost"
                                      className="opacity-70 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                                      title={`Ações de ${item.label}`}
                                      aria-label={`Abrir ações de ${item.label}`}
                                    >
                                      {deletingId === item.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    data-kodety-cms-surface
                                    align="end"
                                    className="w-48 rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)] p-1"
                                  >
                                    <button
                                      type="button"
                                      className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[11px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                      onClick={() => startEditing(item)}
                                    >
                                      <Pencil className="size-3.5 text-muted-foreground" />
                                      Editar
                                    </button>
                                    {item.editUrl ? (
                                      <a
                                        href={item.editUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[11px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                      >
                                        <ExternalLink className="size-3.5 text-muted-foreground" />
                                        Abrir no wp-admin
                                      </a>
                                    ) : null}
                                    {item.capabilities?.delete !== false ? (
                                      <button
                                        type="button"
                                        className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[11px] text-red-300 hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none disabled:opacity-50"
                                        disabled={deletingId === item.id}
                                        onClick={() => void deleteItem(item)}
                                      >
                                        <Trash2 className="size-3.5" />
                                        Mover para a lixeira
                                      </button>
                                    ) : null}
                                  </PopoverContent>
                                </Popover>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <CmsEmptyState
                      icon={FolderWithFilesIcon}
                      title={itemsError ? 'Não foi possível carregar os itens' : 'Nenhum item encontrado'}
                      description={
                        itemsError
                          ? 'Não foi possível carregar o conteúdo. Tente novamente.'
                          : search || statusFilter
                            ? 'Ajuste a busca ou o filtro de status.'
                            : 'Crie o primeiro item desta collection.'
                      }
                    >
                      {itemsError ? (
                        <Button size="sm" variant="secondary" onClick={() => setRefreshTick(tick => tick + 1)}>
                          <RefreshCw /> Tentar novamente
                        </Button>
                      ) : !readOnly && selectedType?.capabilities?.create !== false ? (
                        <div className="space-y-2">
                          <Button size="sm" disabled={itemLimitReached} onClick={() => startEditing('new')}>
                            <Plus /> {itemLimitReached ? `Limite ${itemLimit}/${itemLimit}` : 'Novo item'}
                          </Button>
                        </div>
                      ) : null}
                    </CmsEmptyState>
                  )}
                </div>
                <footer className="flex min-h-11 items-center justify-between gap-2 border-t border-[var(--kodety-divider-strong)] bg-black/[.08] px-3 py-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {cellMutationsPending
                      ? `Salvando ${cellMutationsPending} ${cellMutationsPending === 1 ? 'alteração' : 'alterações'}… · `
                      : itemsLoading && items.length
                        ? 'Atualizando… · '
                        : ''}
                    {total} item{total === 1 ? '' : 's'} · página {page} de {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Página anterior"
                      disabled={page <= 1 || itemsLoading}
                      onClick={() => setPage(current => Math.max(1, current - 1))}
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Próxima página"
                      disabled={page >= totalPages || itemsLoading}
                      onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </footer>
              </div>
            </div>
          )}
          {editing && (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 z-20 cursor-default bg-black/45 backdrop-blur-[1px]"
                onClick={closeItemEditor}
              />
              <aside
                ref={itemEditorRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={itemEditorTitleId}
                data-kodety-onboarding="cms-item-editor"
                data-kodety-cms-surface
                data-kodety-read-only={readOnly ? 'true' : undefined}
                className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] shadow-[-22px_0_56px_rgba(0,0,0,0.34)] sm:max-w-[480px] xl:max-w-[540px]"
              >
                <header className="flex min-h-14 items-center gap-4 border-b border-[var(--kodety-divider-strong)] px-4 py-2">
                  <Button
                    data-item-editor-close
                    className="rounded-[8px]"
                    size="icon-sm"
                    variant="secondary"
                    onClick={closeItemEditor}
                    title="Fechar painel"
                    aria-label="Fechar editor do item"
                  >
                    <X />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p id={itemEditorTitleId} className="truncate text-xs font-medium">
                      {editing === 'new' ? `Novo item em ${selectedType?.name || activeType}` : editingItem?.label}
                    </p>
                    {editingDirty || editing === 'new' ? (
                      <p aria-live="polite" className={`text-[9px] ${editingDirty ? 'text-amber-300' : 'text-muted-foreground'}`}>
                        {editingDirty ? 'Alterações ainda não salvas' : 'Rascunho local; nada foi criado ainda.'}
                      </p>
                    ) : null}
                  </div>
                  {!readOnly && editingItem?.editUrl && (
                    <Button className="rounded-[8px]" size="icon-sm" variant="ghost" asChild title="Abrir no wp-admin">
                      <a href={editingItem.editUrl} target="_blank" rel="noreferrer" aria-label="Abrir item no wp-admin">
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                  {!readOnly && wp?.aiGenerateUrl && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="rounded-[8px]"
                      title="Gerar rascunho assistido"
                      aria-label="Gerar rascunho assistido"
                      onClick={() => setAiOpen(true)}
                    >
                      <FileText />
                    </Button>
                  )}
                  <Button size="sm" disabled={readOnly || saving} className="disabled:cursor-not-allowed" onClick={() => void saveItem()}>
                    {saving ? <Loader2 className="animate-spin" /> : null}
                    {readOnly ? 'Somente leitura' : saving ? 'Salvando…' : 'Salvar'}
                  </Button>
                </header>
                <fieldset disabled={readOnly} className="min-h-0 min-w-0 flex-1 overflow-y-auto border-0 px-5 pb-8">
                  <div data-kodety-onboarding="cms-item-status" className="grid grid-cols-1 gap-2 border-b border-[var(--kodety-divider)] py-3.5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
                    <div className="sm:pt-2">
                      <Label variant="muted">Status</Label>
                    </div>
                    <HtmlSettingsFieldControl label="Status" kind="option">
                      <Select
                        value={String(formValues.status || 'draft')}
                        onValueChange={value =>
                          setFormValues(current => ({
                            ...current,
                            status: value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedType?.capabilities?.publish !== false ? <SelectItem value="publish">Publicado</SelectItem> : null}
                          <SelectItem value="draft">Rascunho</SelectItem>
                          <SelectItem value="pending">Pendente</SelectItem>
                          {selectedType?.capabilities?.publish !== false ? <SelectItem value="private">Privado</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    </HtmlSettingsFieldControl>
                  </div>
                  {supportsThumbnail && (
                    <div data-kodety-onboarding="cms-item-image" className="border-b border-[var(--kodety-divider)] py-4">
                      <div className="mb-2">
                        <Label variant="muted">Imagem destacada</Label>
                        <p data-kodety-cms-description className="mt-0.5 text-[9px] text-muted-foreground">
                          Usada nos templates e nas prévias sociais do item.
                        </p>
                      </div>
                      <div
                        data-kodety-cms-card
                        className="flex min-h-20 items-stretch overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025]"
                      >
                        <span className="flex w-24 shrink-0 items-center justify-center overflow-hidden border-r border-white/[.045] bg-black/[.07]">
                          {featuredImage.url ? (
                            <img src={featuredImage.url} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageIcon className="size-[18px] text-white/30" />
                          )}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2.5">
                          <p className="truncate text-xs font-medium">{featuredImage.url ? 'Imagem selecionada' : 'Nenhuma imagem'}</p>
                          <div className="mt-1.5 flex items-center gap-1">
                            <Button type="button" size="xs" variant="secondary" disabled={uploadingField === 'featured_image'} asChild>
                              <label className="cursor-pointer">
                                {uploadingField === 'featured_image' ? <Loader2 className="animate-spin" /> : <Upload />}
                                {featuredImage.url ? 'Trocar' : 'Escolher'}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  onChange={event => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (!file) return;
                                    void uploadImage(
                                      file,
                                      value => {
                                        const attachment = value as {
                                          id?: number;
                                          source_url?: string;
                                        };
                                        setFeaturedImage({
                                          id: attachment.id || null,
                                          url: attachment.source_url || '',
                                        });
                                      },
                                      'featured_image',
                                    );
                                  }}
                                />
                              </label>
                            </Button>
                            {featuredImage.url && (
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-red-200"
                                onClick={() => setFeaturedImage({ id: null, url: '' })}
                              >
                                Remover
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {editableFields
                    .filter(field => field.key !== 'status')
                    .map(field => (
                      <FieldEditor
                        key={field.key}
                        field={field}
                        value={formValues[field.key]}
                        onChange={value =>
                          setFormValues(current => ({
                            ...current,
                            [field.key]: value,
                          }))
                        }
                        onUploadImage={(file, apply) => void uploadImage(file, apply, field.key)}
                        uploading={uploadingField === field.key}
                        permalink={String(editingItem?.values.permalink || '')}
                        collectionSlug={activeType}
                      />
                    ))}
                </fieldset>
              </aside>
            </>
          )}
        </section>
        <Dialog open={aiOpen} onOpenChange={setAiOpen}>
          <DialogContent data-kodety-cms-surface className="max-w-xl gap-0 overflow-hidden rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-0">
            <div className="border-b border-[var(--kodety-divider-strong)] px-5 py-4">
              <DialogTitle>Rascunho assistido</DialogTitle>
              <DialogDescription data-kodety-cms-description>
                O resultado preenche este formulário para revisão. Nada é salvo ou publicado automaticamente.
              </DialogDescription>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                <Label>Tipo de rascunho</Label>
                <HtmlSettingsFieldControl label="Tipo de rascunho" kind="option">
                  <Select value={aiTask} onValueChange={value => setAiTask(value as typeof aiTask)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="article">Artigo completo</SelectItem>
                      <SelectItem value="seo">Título e descrição SEO</SelectItem>
                      <SelectItem value="rewrite">Reescrever conteúdo atual</SelectItem>
                    </SelectContent>
                  </Select>
                </HtmlSettingsFieldControl>
              </div>
              <div>
                <div className="mb-2">
                  <Label>Contexto confirmado</Label>
                  <p data-kodety-cms-description className="mt-0.5 text-[10px] text-muted-foreground">
                    Este briefing é a fonte de verdade da geração.
                  </p>
                </div>
                <HtmlSettingsFieldControl label="Contexto confirmado" kind="text">
                  <Textarea
                    value={aiBrief}
                    onChange={event => setAiBrief(event.target.value)}
                    className="min-h-32"
                    placeholder="Tema, público, objetivo, fatos obrigatórios, palavras-chave e informações que não podem ser inventadas…"
                  />
                </HtmlSettingsFieldControl>
              </div>
              <div>
                <HtmlSettingsToggleControl
                  label="Incluir os dados atuais do item"
                  description="Campos preenchidos são convertidos em texto limpo e enviados como contexto."
                  checked={aiIncludeCurrent}
                  onChange={setAiIncludeCurrent}
                  disabled={!aiCurrentContext}
                  kind="code"
                />
                {aiIncludeCurrent && aiCurrentContext && (
                  <details data-kodety-cms-card className="group mt-2 overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.02]">
                    <DisclosureSummary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 text-[10px] text-muted-foreground transition-colors hover:bg-white/[.035]">
                      Conferir contexto enviado
                    </DisclosureSummary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-white/[.045] px-3 py-2 text-[10px] leading-5 text-muted-foreground">
                      {aiCurrentContext}
                    </pre>
                  </details>
                )}
                {!aiCurrentContext && <p className="mt-2 text-[10px] text-muted-foreground">Este item está vazio; apenas o briefing será usado.</p>}
              </div>
              <div className="grid gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                <Label>Tom</Label>
                <HtmlSettingsFieldControl label="Tom" kind="option">
                  <Input value={aiTone} onChange={event => setAiTone(event.target.value)} placeholder="Claro, humano e profissional" />
                </HtmlSettingsFieldControl>
              </div>
              <p data-kodety-cms-description className="text-[10px] leading-5 text-muted-foreground">
                <strong className="font-medium text-foreground">Dados ausentes serão omitidos.</strong> O conteúdo gerado permanece como rascunho neste painel
                até você revisar e salvar.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--kodety-divider-strong)] px-5 py-3">
              <Button variant="secondary" onClick={() => setAiOpen(false)}>
                Cancelar
              </Button>
              <Button disabled={readOnly || aiLoading || !aiBrief.trim()} onClick={() => void generateWithAi()}>
                {aiLoading ? <Loader2 className="animate-spin" /> : null}
                {aiLoading ? 'Gerando…' : 'Gerar rascunho'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {canManageSchema && importOpen && schema?.revision && (
          <Suspense fallback={null}>
            <HtmlCmsCsvImport
              open
              onOpenChange={setImportOpen}
              wp={{
                cmsCollectionsUrl: wp?.cmsCollectionsUrl,
                cmsFieldsUrl: wp?.cmsFieldsUrl,
                cmsItemsUrl: wp?.cmsItemsUrl,
                nonce: wp?.nonce,
              }}
              types={types}
              initialType={activeType}
              schemaRevision={schema.revision}
              onRevisionConflict={refreshAfterRevisionConflict}
              onImported={(slug, revision) => {
                setSchema(current => current ? { ...current, revision } : current);
                setFieldsRevision(current => current ? revision : current);
                void loadSchema(true);
                setActiveType(slug);
                setView('collections');
                setRefreshTick(tick => tick + 1);
                notifyItemsChanged();
              }}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
  if (standalone) return <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-background">{managerContent}</div>;
  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          void leaveManager();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent variant="side" showCloseButton={false} className="h-dvh w-screen max-w-none gap-0 overflow-hidden border-0 p-0 sm:w-screen">
        {managerContent}
      </DialogContent>
    </Dialog>
  );
}
