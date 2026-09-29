'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  GripVertical,
  Plus,
  Redo2,
  Route,
  Search,
  Trash2,
  Upload,
} from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ProjectSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import { HtmlSettingsToggleControl } from './HtmlSettingsControls';
import {
  MAX_REDIRECT_DESTINATION_BYTES,
  MAX_REDIRECT_ENTRIES,
  MAX_REDIRECT_SOURCE_BYTES,
  parseRedirectCsv,
  redirectCsvTemplate,
  validateRedirectSettings,
  type RedirectEntry,
  type RedirectSettings,
  type RedirectValidationIssue,
} from '@/lib/html-editor/redirects';

export interface HtmlRedirectSettingsProps {
  value: RedirectSettings;
  onChange: (value: RedirectSettings) => void;
  hostMode?: 'html' | 'wordpress';
  language?: 'en' | 'pt';
}

type RedirectStatus = RedirectEntry['status'];
type RedirectMatch = RedirectEntry['match'];

const SETTINGS_SEARCH_SURFACE_CLASS = 'group/settings-search relative flex h-9 min-w-0 flex-1 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.075]';
const SETTINGS_SEARCH_INPUT_CLASS = 'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0';

function createEntryId() {
  return globalThis.crypto?.randomUUID?.()
    || `redirect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newRedirectEntry(): RedirectEntry {
  return {
    id: createEntryId(),
    source: '',
    destination: '',
    status: 301,
    match: 'exact',
    preserveQuery: true,
    enabled: true,
  };
}

function duplicateRedirectEntry(entry: RedirectEntry): RedirectEntry {
  return {
    ...entry,
    id: createEntryId(),
  };
}

function compactUrl(value: string) {
  return value.trim() || 'Não definido';
}

function entryIssues(entry: RedirectEntry) {
  return validateRedirectSettings({ version: 1, entries: [entry] });
}

function rawSourceError(entry: RedirectEntry) {
  const source = entry.source.trim();
  if (!source) return 'Informe a URL de origem.';
  if (!source.startsWith('/') || source.startsWith('//')) {
    return 'A origem deve ser um caminho iniciado por “/”, sem domínio.';
  }
  if (/[?#]/.test(source)) {
    return 'A origem deve conter somente o caminho, sem query string ou fragmento.';
  }
  if (/\s/.test(source)) return 'A origem não pode conter espaços.';
  return '';
}

function fieldIssue(
  entry: RedirectEntry,
  codes: RedirectValidationIssue['code'][],
) {
  return entryIssues(entry).find(issue => codes.includes(issue.code))?.message || '';
}

function sourceError(entry: RedirectEntry) {
  return rawSourceError(entry) || fieldIssue(entry, [
    'source-required',
    'source-invalid',
    'source-too-long',
    'reserved-source',
    'wildcard-required',
    'wildcard-not-allowed',
  ]);
}

function destinationError(entry: RedirectEntry) {
  return fieldIssue(entry, ['destination-required', 'destination-invalid', 'destination-too-long']);
}

export function redirectEntryError(entry: RedirectEntry) {
  return rawSourceError(entry) || entryIssues(entry)[0]?.message || '';
}

function statusLabel(status: RedirectStatus) {
  if (status === 301) return '301 Permanente';
  if (status === 302) return '302 Temporário';
  if (status === 307) return '307 Temporário';
  return '308 Permanente';
}

function matchLabel(match: RedirectMatch) {
  if (match === 'prefix') return 'Prefixo';
  if (match === 'wildcard') return 'Curinga';
  return 'Exato';
}

interface SortableRedirectRowProps {
  entry: RedirectEntry;
  index: number;
  isLast: boolean;
  active: boolean;
  invalid: boolean;
  disabled: boolean;
  canDuplicate: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function SortableRedirectRow({
  entry,
  index,
  isLast,
  active,
  invalid,
  disabled,
  canDuplicate,
  onSelect,
  onToggle,
  onDuplicate,
  onMove,
  onRemove,
}: SortableRedirectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative grid min-h-14 grid-cols-[36px_minmax(0,1fr)_auto] items-stretch overflow-hidden rounded-[9px] border transition-[border-color,background-color] ${
        active
          ? 'border-white/[.045] bg-white/[.075] text-foreground'
          : 'border-transparent hover:bg-white/[.045]'
      } ${isDragging ? 'z-10 border-[var(--kodety-focus)]/60 bg-white/[.08]' : ''}`}
    >
      <button
        type="button"
        className="flex h-full cursor-grab touch-none items-center justify-center border-r border-white/[.045] bg-black/[.06] text-white/30 outline-none transition-colors hover:text-white/65 focus-visible:bg-[var(--kodety-accent-muted)] focus-visible:text-[var(--kodety-accent-hover)] active:cursor-grabbing disabled:cursor-default disabled:opacity-35"
        aria-label={`Reordenar redirecionamento ${index + 1}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="grid min-w-0 grid-cols-1 items-center gap-x-3 px-3 py-2.5 text-left outline-none focus-visible:bg-white/[.035] sm:grid-cols-[minmax(120px,0.9fr)_18px_minmax(150px,1.1fr)]"
        aria-current={active ? 'true' : undefined}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              invalid ? 'bg-destructive' : entry.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/35'
            }`}
            aria-hidden="true"
          />
          <span className={`truncate text-[11px] font-medium ${entry.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
            {compactUrl(entry.source)}
          </span>
        </span>
        <ArrowRight className="mt-1 hidden size-3.5 text-muted-foreground sm:mt-0 sm:block" aria-hidden="true" />
        <span className="mt-1 flex min-w-0 items-center gap-2 pl-3.5 sm:mt-0 sm:pl-0">
          <span className="truncate text-[10px] text-muted-foreground">{compactUrl(entry.destination)}</span>
          {/^https?:\/\//i.test(entry.destination.trim()) && (
            <ExternalLink className="size-3 shrink-0 text-muted-foreground/70" aria-label="Destino externo" />
          )}
        </span>
      </button>

      <div className="flex items-center gap-1 pr-2">
        <span className="hidden rounded-[6px] bg-white/[.055] px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground md:inline-flex">
          {entry.status}
        </span>
        <Switch
          size="sm"
          checked={entry.enabled}
          onCheckedChange={onToggle}
          aria-label={`${entry.enabled ? 'Desativar' : 'Ativar'} redirecionamento ${entry.source || index + 1}`}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:data-[state=open]:opacity-100"
              aria-label={`Ações do redirecionamento ${entry.source || index + 1}`}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem disabled={!canDuplicate} onClick={onDuplicate}>
              <Copy />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
              Mover para cima
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={() => onMove(1)}>
              <ArrowDown />
              Mover para baixo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 />
              Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function HtmlRedirectSettings({ value, onChange, hostMode = 'wordpress', language = 'en' }: HtmlRedirectSettingsProps) {
  const htmlHost = hostMode === 'html';
  const pt = language === 'pt';
  const cloudflareFallback = value.entries.some(entry => entry.enabled && (!entry.preserveQuery || entry.destination.includes('?') || entry.source.split('*').length > 2));
  const hostingNote = htmlHost ? <div data-kodety-no-i18n data-kodety-html-redirect-hosting className="space-y-1 text-[10px] leading-5 text-muted-foreground">
    <p className="text-balance">{pt
      ? 'A exportação inclui vercel.json para a Vercel e _redirects para o Cloudflare Pages. Em outras hospedagens, o redirecionamento ocorre no navegador, sem retornar o status HTTP selecionado.'
      : 'The export includes vercel.json for Vercel and _redirects for Cloudflare Pages. On other hosts, redirects run in the browser without returning the selected HTTP status.'}</p>
    {cloudflareFallback && <p className="text-balance">{pt
      ? 'Estas regras incluem alterações de parâmetros ou vários curingas. No Cloudflare Pages, elas usam o navegador; para retornar um status HTTP, configure uma Redirect Rule ou Function na hospedagem.'
      : 'These rules include query changes or multiple wildcards. On Cloudflare Pages, they use browser redirects; configure a Redirect Rule or Function on your host to return an HTTP status.'}</p>}
  </div> : null;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(value.entries[0]?.id || '');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (selectedId && value.entries.some(entry => entry.id === selectedId)) return;
    setSelectedId(value.entries[0]?.id || '');
  }, [selectedId, value.entries]);

  const selectedEntry = value.entries.find(entry => entry.id === selectedId) || null;
  const atEntryLimit = value.entries.length >= MAX_REDIRECT_ENTRIES;
  const validationIssues = useMemo(() => validateRedirectSettings(value), [value]);
  const invalidEntryIds = useMemo(
    () => new Set(validationIssues.map(issue => issue.entryId).filter(Boolean)),
    [validationIssues],
  );
  const selectedIssue = selectedEntry
    ? validationIssues.find(issue => issue.entryId === selectedEntry.id)
    : undefined;
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return value.entries;
    return value.entries.filter(entry => [
      entry.source,
      entry.destination,
      statusLabel(entry.status),
      matchLabel(entry.match),
      entry.enabled ? 'ativo' : 'inativo',
    ].some(field => field.toLocaleLowerCase().includes(normalized)));
  }, [query, value.entries]);

  const csvInput = useRef<HTMLInputElement | null>(null);

  const replaceEntries = (entries: RedirectEntry[]) => {
    onChange({ ...value, version: 1, entries });
  };

  const updateEntry = (id: string, update: Partial<RedirectEntry>) => {
    replaceEntries(value.entries.map(entry => entry.id === id ? { ...entry, ...update } : entry));
  };

  /**
   * Bulk import upserts by source instead of appending: a spreadsheet is the
   * author's full picture of a path, so importing "/old" twice must correct the
   * existing rule rather than create a duplicate the validator would reject.
   */
  const importCsv = async (file: File) => {
    try {
      const { entries: imported, skipped } = parseRedirectCsv(await file.text());
      if (!imported.length) {
        toast.error('Nenhum redirect importado', {
          description: skipped.length
            ? `${skipped.length} linha(s) inválida(s). Baixe o exemplo para conferir o formato.`
            : 'O arquivo não contém linhas com origem e destino.',
        });
        return;
      }
      const bySource = new Map(value.entries.map(entry => [entry.source, entry]));
      let updated = 0;
      imported.forEach(row => {
        const existing = bySource.get(row.source);
        if (existing) updated += 1;
        bySource.set(row.source, { ...row, id: existing?.id || createEntryId() });
      });
      const merged = [...bySource.values()];
      const overflow = Math.max(0, merged.length - MAX_REDIRECT_ENTRIES);
      replaceEntries(merged.slice(0, MAX_REDIRECT_ENTRIES));
      const added = imported.length - updated;
      toast.success('CSV importado', {
        description: [
          added ? `${added} novo(s)` : '',
          updated ? `${updated} atualizado(s)` : '',
          skipped.length ? `${skipped.length} ignorado(s) (linha ${skipped.slice(0, 3).map(issue => issue.line).join(', ')}${skipped.length > 3 ? '…' : ''})` : '',
          overflow ? `${overflow} acima do limite` : '',
        ].filter(Boolean).join(' · '),
      });
    } catch (error) {
      toast.error('Não foi possível ler o CSV', {
        description: error instanceof Error ? error.message : 'Verifique o arquivo e tente novamente.',
      });
    }
  };

  const downloadCsvTemplate = () => {
    const blob = new Blob([`\ufeff${redirectCsvTemplate()}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kodety-redirects-exemplo.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const addEntry = () => {
    if (atEntryLimit) return;
    const entry = newRedirectEntry();
    replaceEntries([...value.entries, entry]);
    setSelectedId(entry.id);
    setQuery('');
  };

  const removeEntry = (entry: RedirectEntry) => {
    if (!window.confirm(`Remover o redirecionamento “${entry.source || 'sem origem'}”? Esta ação será aplicada ao salvar.`)) return;
    const index = value.entries.findIndex(item => item.id === entry.id);
    const entries = value.entries.filter(item => item.id !== entry.id);
    replaceEntries(entries);
    setSelectedId(entries[Math.min(index, entries.length - 1)]?.id || '');
  };

  const duplicateEntry = (entry: RedirectEntry) => {
    if (atEntryLimit) return;
    const copy = duplicateRedirectEntry(entry);
    const index = value.entries.findIndex(item => item.id === entry.id);
    const entries = [...value.entries];
    entries.splice(index + 1, 0, copy);
    replaceEntries(entries);
    setSelectedId(copy.id);
    setQuery('');
  };

  const moveEntry = (entry: RedirectEntry, direction: -1 | 1) => {
    const index = value.entries.findIndex(item => item.id === entry.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= value.entries.length) return;
    replaceEntries(arrayMove(value.entries, index, target));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = value.entries.findIndex(entry => entry.id === active.id);
    const to = value.entries.findIndex(entry => entry.id === over.id);
    if (from < 0 || to < 0) return;
    replaceEntries(arrayMove(value.entries, from, to));
  };

  if (value.entries.length === 0) {
    return (
      <div data-kodety-settings-subpanel className="flex min-h-[360px] flex-col items-center justify-center border-b border-[var(--kodety-divider)] px-5 py-14 text-center">
        <Redo2 aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 data-kodety-no-i18n={htmlHost || undefined} className="mt-4 text-sm font-semibold">{htmlHost ? (pt ? 'Nenhum redirecionamento' : 'No redirects') : 'Nenhum redirecionamento'}</h2>
        <p data-kodety-no-i18n={htmlHost || undefined} className="mt-1.5 max-w-md text-balance text-[11px] leading-5 text-muted-foreground">
          {htmlHost
            ? (pt ? 'Redirecione URLs antigas em sites HTML na Vercel e no Cloudflare Pages. As regras entram no ar após publicar os arquivos exportados.' : 'Redirect old URLs on HTML sites hosted on Vercel and Cloudflare Pages. Rules go live when you deploy the exported files.')
            : 'Encaminhe URLs antigas, campanhas e caminhos movidos sem perder visitantes ou autoridade de busca.'}
        </p>
        <Button data-kodety-no-i18n={htmlHost || undefined} className="mt-5" onClick={addEntry}>
          <Plus />
          {htmlHost ? (pt ? 'Adicionar redirecionamento' : 'Add redirect') : 'Adicionar redirecionamento'}
        </Button>
        {hostingNote && <div className="mt-5 max-w-lg">{hostingNote}</div>}
      </div>
    );
  }

  return (
    <div data-kodety-settings-subpanel className="border-b border-[var(--kodety-divider)]">
      {hostingNote && <div className="border-b border-[var(--kodety-divider)] py-3">{hostingNote}</div>}
      <div className="flex flex-col gap-2 border-b border-[var(--kodety-divider)] py-3 sm:flex-row sm:items-center">
        <div data-kodety-settings-control className={SETTINGS_SEARCH_SURFACE_CLASS}>
          <span className="grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-hover/settings-search:text-white/55 group-focus-within/settings-search:text-[var(--kodety-accent-hover)]">
            <Search aria-hidden="true" className="size-3.5" />
          </span>
          <Input
            data-kodety-settings-control-inner
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filtrar redirecionamentos…"
            aria-label="Filtrar redirecionamentos"
            className={SETTINGS_SEARCH_INPUT_CLASS}
          />
        </div>
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            // Clear the input so re-picking the same file fires change again.
            event.target.value = '';
            if (file) void importCsv(file);
          }}
        />
        <Button className="h-9 rounded-[9px]" variant="secondary" onClick={downloadCsvTemplate} title="Baixar um CSV de exemplo">
          <Download />
          Exemplo
        </Button>
        <Button
          variant="secondary"
          className="h-9 rounded-[9px]"
          onClick={() => csvInput.current?.click()}
          disabled={atEntryLimit}
          title={atEntryLimit ? `Limite de ${MAX_REDIRECT_ENTRIES.toLocaleString(getAdminUiLocale())} redirects atingido` : 'Importar redirects de um CSV'}
        >
          <Upload />
          Importar CSV
        </Button>
        <Button
          className="h-9 rounded-[9px]"
          onClick={addEntry}
          disabled={atEntryLimit}
          title={atEntryLimit ? `Limite de ${MAX_REDIRECT_ENTRIES.toLocaleString(getAdminUiLocale())} redirects atingido` : undefined}
        >
          <Plus />
          Adicionar
        </Button>
      </div>

      <div className="min-h-[520px] lg:grid lg:grid-cols-[minmax(330px,0.95fr)_minmax(300px,0.72fr)]">
        <div className="min-w-0 border-b border-[var(--kodety-divider)] lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center border-b border-[var(--kodety-divider)] px-0 py-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">
            <span />
            <span className="px-0">Origem <span className="px-2">→</span> Destino</span>
            <span className="pr-10">Status</span>
          </div>

          {filteredEntries.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="text-xs font-medium">Nenhum resultado</p>
              <p className="mt-1 text-[10px] text-muted-foreground">Tente outro caminho, destino ou status.</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={filteredEntries.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
                <div className="max-h-[min(58vh,680px)] space-y-1 overflow-y-auto overscroll-contain p-1.5">
                  {filteredEntries.map(entry => {
                    const index = value.entries.findIndex(item => item.id === entry.id);
                    return (
                      <SortableRedirectRow
                        key={entry.id}
                        entry={entry}
                        index={index}
                        isLast={index === value.entries.length - 1}
                        active={entry.id === selectedEntry?.id}
                        invalid={invalidEntryIds.has(entry.id)}
                        disabled={value.entries.length < 2}
                        canDuplicate={!atEntryLimit}
                        onSelect={() => setSelectedId(entry.id)}
                        onToggle={enabled => updateEntry(entry.id, { enabled })}
                        onDuplicate={() => duplicateEntry(entry)}
                        onMove={direction => moveEntry(entry, direction)}
                        onRemove={() => removeEntry(entry)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-[var(--kodety-divider)] px-4 py-3 text-[9px] leading-4 text-muted-foreground">
            <p>A ordem define a prioridade. A primeira regra compatível será aplicada.</p>
            <span className="shrink-0 tabular-nums">
              {value.entries.length.toLocaleString(getAdminUiLocale())} / {MAX_REDIRECT_ENTRIES.toLocaleString(getAdminUiLocale())}
            </span>
          </div>
        </div>

        {selectedEntry ? (
          <div className="min-w-0 px-3 py-4 sm:px-5 lg:px-6">
            <div className="flex items-start gap-3 border-b border-[var(--kodety-divider)] pb-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xs font-semibold">
                  {selectedEntry.source.trim() || 'Novo redirecionamento'}
                </h2>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Regra de prioridade {value.entries.findIndex(entry => entry.id === selectedEntry.id) + 1}.
                </p>
              </div>
              <div className="min-w-[148px]">
                <HtmlSettingsToggleControl
                  label={selectedEntry.enabled ? 'Ativo' : 'Inativo'}
                  checked={selectedEntry.enabled}
                  onChange={enabled => updateEntry(selectedEntry.id, { enabled })}
                />
              </div>
            </div>

            <div className="space-y-4 border-b border-[var(--kodety-divider)] py-4">
              <div data-kodety-onboarding="settings-redirect-source" className="space-y-1.5">
                <Label htmlFor={`redirect-source-${selectedEntry.id}`} className="text-[10px] font-medium">
                  Origem
                </Label>
                <ProjectSettingsFieldControl label="Origem" kind="link">
                  <Input
                    id={`redirect-source-${selectedEntry.id}`}
                    value={selectedEntry.source}
                    onChange={event => updateEntry(selectedEntry.id, { source: event.target.value })}
                    maxLength={MAX_REDIRECT_SOURCE_BYTES}
                    placeholder="/pagina-antiga/"
                    aria-invalid={Boolean(sourceError(selectedEntry))}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </ProjectSettingsFieldControl>
                {sourceError(selectedEntry) ? (
                  <p role="alert" className="text-[9px] leading-4 text-destructive">{sourceError(selectedEntry)}</p>
                ) : (
                  <p className="text-[9px] leading-4 text-muted-foreground">Use apenas o caminho, começando por “/”.</p>
                )}
              </div>

              <div data-kodety-onboarding="settings-redirect-destination" className="space-y-1.5">
                <Label htmlFor={`redirect-destination-${selectedEntry.id}`} className="text-[10px] font-medium">
                  Destino
                </Label>
                <ProjectSettingsFieldControl label="Destino" kind="link">
                  <Input
                    id={`redirect-destination-${selectedEntry.id}`}
                    value={selectedEntry.destination}
                    onChange={event => updateEntry(selectedEntry.id, { destination: event.target.value })}
                    maxLength={MAX_REDIRECT_DESTINATION_BYTES}
                    placeholder="/pagina-nova/ ou https://…"
                    aria-invalid={Boolean(destinationError(selectedEntry))}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </ProjectSettingsFieldControl>
                {destinationError(selectedEntry) ? (
                  <p role="alert" className="text-[9px] leading-4 text-destructive">{destinationError(selectedEntry)}</p>
                ) : (
                  <p className="text-[9px] leading-4 text-muted-foreground">Aceita caminhos internos e URLs externas seguras.</p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div data-kodety-onboarding="settings-redirect-status" className="space-y-1.5">
                  <Label className="text-[10px] font-medium">Status HTTP</Label>
                  <ProjectSettingsFieldControl label="Status HTTP" kind="number">
                    <Select
                      value={String(selectedEntry.status)}
                      onValueChange={status => updateEntry(selectedEntry.id, { status: Number(status) as RedirectStatus })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="301">301 · Permanente</SelectItem>
                        <SelectItem value="302">302 · Temporário</SelectItem>
                        <SelectItem value="307">307 · Temporário, preserva método</SelectItem>
                        <SelectItem value="308">308 · Permanente, preserva método</SelectItem>
                      </SelectContent>
                    </Select>
                  </ProjectSettingsFieldControl>
                </div>

                <div data-kodety-onboarding="settings-redirect-match" className="space-y-1.5">
                  <Label className="text-[10px] font-medium">Correspondência</Label>
                  <ProjectSettingsFieldControl label="Correspondência" kind="option">
                    <Select
                      value={selectedEntry.match}
                      onValueChange={match => updateEntry(selectedEntry.id, { match: match as RedirectMatch })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">Caminho exato</SelectItem>
                        <SelectItem value="prefix">Caminho e subcaminhos</SelectItem>
                        <SelectItem value="wildcard">Curinga (*)</SelectItem>
                      </SelectContent>
                    </Select>
                  </ProjectSettingsFieldControl>
                </div>
              </div>

              <div className="flex gap-2.5 rounded-[9px] border border-white/[.045] bg-white/[.03] px-3 py-2.5 text-[9px] leading-4 text-muted-foreground">
                <Route className="mt-0.5 size-3.5 shrink-0 text-white/35" />
                <p>
                  {selectedEntry.status === 301 || selectedEntry.status === 308
                    ? 'Permanente: mecanismos de busca podem substituir a URL antiga pela nova.'
                    : 'Temporário: a URL original continua válida para mecanismos de busca.'}
                  {' '}
                  {selectedEntry.match === 'prefix'
                    ? 'A regra também alcança caminhos abaixo desta origem.'
                    : selectedEntry.match === 'wildcard'
                      ? 'Use * na origem e no destino para reaproveitar o trecho capturado.'
                      : 'Somente o caminho completo informado será aceito.'}
                </p>
              </div>
              {selectedIssue && ![
                'source-required',
                'source-invalid',
                'source-too-long',
                'reserved-source',
                'wildcard-required',
                'wildcard-not-allowed',
                'destination-required',
                'destination-invalid',
                'destination-too-long',
              ].includes(selectedIssue.code) && (
                <p role="alert" className="rounded-[9px] border border-destructive/25 bg-destructive/[.055] px-3 py-2 text-[9px] leading-4 text-destructive">
                  {selectedIssue.message}
                </p>
              )}
            </div>

            <div className="py-3">
              <HtmlSettingsToggleControl
                label="Preservar parâmetros"
                description="Mantém UTMs e query strings no destino."
                checked={selectedEntry.preserveQuery}
                onChange={preserveQuery => updateEntry(selectedEntry.id, { preserveQuery })}
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--kodety-divider)] pt-3">
              <p data-kodety-no-i18n={htmlHost || undefined} className="max-w-sm text-balance text-[9px] leading-4 text-muted-foreground">
                {htmlHost
                  ? (pt ? 'Salve e publique os arquivos exportados para aplicar as mudanças na hospedagem.' : 'Save and deploy the exported files to apply changes on your host.')
                  : 'Mudanças passam a valer após salvar e publicar o projeto.'}
              </p>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => removeEntry(selectedEntry)}
              >
                <Trash2 />
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-80 items-center justify-center px-6 text-xs text-muted-foreground">
            Selecione um redirecionamento para editar.
          </div>
        )}
      </div>
    </div>
  );
}
