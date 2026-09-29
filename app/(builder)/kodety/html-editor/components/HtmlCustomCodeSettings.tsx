'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  ChevronDown,
  Code2,
  Copy,
  Ellipsis,
  Plus,
  Search,
  Trash2,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import type { CustomCodeEntry, CustomCodeSettings } from '@/lib/html-editor/custom-code';
import { ProjectSettingsFieldControl } from './HtmlProjectSettingsFieldControl';
import { HtmlSettingsFieldGlyph, HtmlSettingsToggleControl } from './HtmlSettingsControls';

interface HtmlCustomCodeSettingsProps {
  value: CustomCodeSettings;
  pages: string[];
  homePage: string;
  consentCategories?: Array<{ id: string; name: string; required?: boolean }>;
  cookieConsentEnabled?: boolean;
  onChange: (value: CustomCodeSettings) => void;
}

const SETTINGS_SEARCH_SURFACE_CLASS = 'group/settings-search relative flex h-9 min-w-0 flex-1 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055] transition-[border-color,background-color] hover:bg-white/[.07] focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.075]';
const SETTINGS_SEARCH_INPUT_CLASS = 'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0';

function createEntryId() {
  return globalThis.crypto?.randomUUID?.()
    || `custom-code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pageLabel(path: string, homePage: string) {
  if (path === homePage) return 'Home';
  return path.split('/').pop()?.replace(/\.html?$/i, '') || path;
}

function placementLabel(placement: CustomCodeEntry['placement']) {
  if (placement === 'head-start') return 'Início do head';
  if (placement === 'head-end') return 'Fim do head';
  if (placement === 'body-start') return 'Início do body';
  return 'Fim do body';
}

function runLabel(run: CustomCodeEntry['run']) {
  return run === 'navigation' ? 'A cada navegação' : 'Uma vez';
}

function starterCode(language: CustomCodeEntry['language']) {
  const englishUi = getAdminUiLocale().toLowerCase().startsWith('en');
  if (language === 'css') return englishUi ? '/* Add your CSS here */' : '/* Adicione seu CSS aqui */';
  if (language === 'javascript') return englishUi ? '// Add your JavaScript here' : '// Adicione seu JavaScript aqui';
  return englishUi ? '<!-- Add your code here -->' : '<!-- Adicione seu código aqui -->';
}

function localizedDefaultName(value: string) {
  return getAdminUiLocale().toLowerCase().startsWith('en') && value === 'Novo código'
    ? 'New code'
    : value;
}

function localizedStarterCode(value: string) {
  if (!getAdminUiLocale().toLowerCase().startsWith('en')) return value;
  return value
    .replace('/* Adicione seu CSS aqui */', '/* Add your CSS here */')
    .replace('// Adicione seu JavaScript aqui', '// Add your JavaScript here')
    .replace('<!-- Adicione seu código aqui -->', '<!-- Add your code here -->');
}

function newCustomCodeEntry(): CustomCodeEntry {
  return {
    id: createEntryId(),
    name: getAdminUiLocale().toLowerCase().startsWith('en') ? 'New code' : 'Novo código',
    code: starterCode('html'),
    placement: 'head-end',
    scope: 'all',
    pages: [],
    run: 'once',
    language: 'html',
    enabled: true,
    consent: 'always',
    consentCategory: undefined,
  };
}

function duplicateCustomCodeEntry(entry: CustomCodeEntry): CustomCodeEntry {
  return {
    ...entry,
    id: createEntryId(),
    name: `${entry.name || 'Código'} — cópia`,
  };
}

export function HtmlCustomCodeSettings({
  value,
  pages,
  homePage,
  consentCategories = [],
  cookieConsentEnabled = false,
  onChange,
}: HtmlCustomCodeSettingsProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(value.entries[0]?.id || '');

  useEffect(() => {
    if (selectedId && value.entries.some(entry => entry.id === selectedId)) return;
    setSelectedId(value.entries[0]?.id || '');
  }, [selectedId, value.entries]);

  const selectedEntry = value.entries.find(entry => entry.id === selectedId) || null;
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return value.entries;
    return value.entries.filter(entry => [
      localizedDefaultName(entry.name),
      localizedStarterCode(entry.code),
      placementLabel(entry.placement),
      runLabel(entry.run),
      entry.language,
      entry.consent === 'required' ? `consentimento ${entry.consentCategory || ''}` : 'sempre',
      entry.scope === 'all' ? 'todas as páginas site' : entry.pages.join(' '),
    ].some(field => field.toLocaleLowerCase().includes(normalized)));
  }, [query, value.entries]);

  const replaceEntries = (entries: CustomCodeEntry[]) => {
    onChange({ ...value, version: 1, entries });
  };

  const updateEntry = (id: string, update: Partial<CustomCodeEntry>) => {
    replaceEntries(value.entries.map(entry => entry.id === id ? { ...entry, ...update } : entry));
  };

  const addEntry = () => {
    const entry = newCustomCodeEntry();
    replaceEntries([...value.entries, entry]);
    setSelectedId(entry.id);
    setQuery('');
  };

  const removeEntry = (entry: CustomCodeEntry) => {
    if (!window.confirm(`Remover “${entry.name}”? Esta ação será aplicada ao salvar.`)) return;
    const index = value.entries.findIndex(item => item.id === entry.id);
    const entries = value.entries.filter(item => item.id !== entry.id);
    replaceEntries(entries);
    setSelectedId(entries[Math.min(index, entries.length - 1)]?.id || '');
  };

  const duplicateEntry = (entry: CustomCodeEntry) => {
    const copy = duplicateCustomCodeEntry(entry);
    const index = value.entries.findIndex(item => item.id === entry.id);
    const entries = [...value.entries];
    entries.splice(index + 1, 0, copy);
    replaceEntries(entries);
    setSelectedId(copy.id);
  };

  const moveEntry = (entry: CustomCodeEntry, direction: -1 | 1) => {
    const index = value.entries.findIndex(item => item.id === entry.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= value.entries.length) return;
    const entries = [...value.entries];
    [entries[index], entries[target]] = [entries[target], entries[index]];
    replaceEntries(entries);
  };

  if (value.entries.length === 0) {
    return (
      <div data-kodety-settings-subpanel className="flex min-h-[360px] flex-col items-center justify-center border-b border-[var(--kodety-divider)] px-5 py-14 text-center">
        <Braces aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="mt-4 text-sm font-semibold">Nenhum código adicionado</h2>
        <p className="mt-1.5 max-w-md text-[11px] leading-5 text-muted-foreground">
          Adicione scripts, estilos, tags de verificação ou integrações ao head ou ao body do site.
        </p>
        <Button className="mt-5" onClick={addEntry}>
          <Plus />
          Adicionar código
        </Button>
      </div>
    );
  }

  return (
    <div data-kodety-settings-subpanel className="border-b border-[var(--kodety-divider)]">
      <div className="flex flex-col gap-2 border-b border-[var(--kodety-divider)] py-3 sm:flex-row sm:items-center">
        <div data-kodety-settings-control className={SETTINGS_SEARCH_SURFACE_CLASS}>
          <span className="grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-hover/settings-search:text-white/55 group-focus-within/settings-search:text-[var(--kodety-accent-hover)]">
            <Search aria-hidden="true" className="size-3.5" />
          </span>
          <Input
            data-kodety-settings-control-inner
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar códigos…"
            aria-label="Buscar códigos personalizados"
            className={SETTINGS_SEARCH_INPUT_CLASS}
          />
        </div>
        <Button className="h-9 rounded-[9px]" onClick={addEntry}>
          <Plus />
          Adicionar código
        </Button>
      </div>

      <div className="min-h-[520px] lg:grid lg:grid-cols-[minmax(218px,0.32fr)_minmax(0,1fr)]">
        <div data-kodety-onboarding="settings-code-list" className="min-w-0 border-b border-[var(--kodety-divider)] lg:border-b-0 lg:border-r">
          <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain p-1.5 lg:max-h-[680px]">
            {filteredEntries.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-xs font-medium">Nenhum resultado</p>
                <p className="mt-1 text-[10px] text-muted-foreground">Tente outro nome, página ou conteúdo.</p>
              </div>
            ) : filteredEntries.map((entry) => {
              const active = entry.id === selectedEntry?.id;
              const index = value.entries.findIndex(item => item.id === entry.id);
              return (
                <div
                  key={entry.id}
                  className={`group flex min-h-14 items-stretch overflow-hidden rounded-[9px] border transition-[border-color,background-color] ${
                    active
                      ? 'border-white/[.045] bg-white/[.075] text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-white/[.045] hover:text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className="flex min-w-0 flex-1 items-stretch text-left outline-none focus-visible:bg-white/[.035]"
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.06] text-white/30 transition-colors group-hover:text-white/55 group-has-[button[aria-current=true]]:text-[var(--kodety-accent-hover)]">
                      <Code2 className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 px-2.5 py-2">
                      <span className="flex items-center gap-2">
                        <span className={`size-1.5 shrink-0 rounded-full ${entry.enabled ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
                        <span className="truncate text-[11px] font-medium">{localizedDefaultName(entry.name) || 'Sem nome'}</span>
                      </span>
                      <span className="mt-1 block truncate pl-3.5 text-[9px] text-muted-foreground">
                        {placementLabel(entry.placement)}
                        {' · '}
                        {entry.scope === 'all'
                          ? 'Todas as páginas'
                          : entry.pages.length === 1
                            ? pageLabel(entry.pages[0], homePage)
                            : `${entry.pages.length} páginas`}
                        {' · '}
                        {runLabel(entry.run)}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:data-[state=open]:opacity-100"
                        aria-label={`Ações de ${entry.name}`}
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => duplicateEntry(entry)}>
                        <Copy />
                        Duplicar
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={index === 0} onClick={() => moveEntry(entry, -1)}>
                        <ArrowUp />
                        Mover para cima
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={index === value.entries.length - 1} onClick={() => moveEntry(entry, 1)}>
                        <ArrowDown />
                        Mover para baixo
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => removeEntry(entry)}>
                        <Trash2 />
                        Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </div>

        {selectedEntry ? (
          <div className="min-w-0 px-3 py-4 sm:px-5 lg:px-6">
            <div className="flex items-start gap-3 border-b border-[var(--kodety-divider)] pb-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xs font-semibold">{localizedDefaultName(selectedEntry.name) || 'Sem nome'}</h2>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  A ordem da lista também define a ordem de inserção no documento.
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

            <div className="grid gap-3 border-b border-[var(--kodety-divider)] py-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`custom-code-name-${selectedEntry.id}`} className="text-[10px] font-medium">
                  Nome
                </Label>
                <ProjectSettingsFieldControl label="Nome" kind="text">
                  <Input
                    id={`custom-code-name-${selectedEntry.id}`}
                    value={localizedDefaultName(selectedEntry.name)}
                    onChange={event => updateEntry(selectedEntry.id, { name: event.target.value })}
                    placeholder="Ex.: Analytics, chat ou verificação"
                    aria-invalid={!selectedEntry.name.trim()}
                    className="text-xs"
                  />
                </ProjectSettingsFieldControl>
                {!selectedEntry.name.trim() && <p role="alert" className="text-[9px] text-destructive">Informe um nome.</p>}
              </div>

              <div data-kodety-onboarding="settings-code-placement" className="space-y-1.5">
                <Label className="text-[10px] font-medium">Inserir em</Label>
                <ProjectSettingsFieldControl label="Inserir em" kind="option">
                  <Select
                    value={selectedEntry.placement}
                    onValueChange={placement => updateEntry(selectedEntry.id, { placement: placement as CustomCodeEntry['placement'] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="head-start">Início do head</SelectItem>
                      <SelectItem value="head-end">Fim do head</SelectItem>
                      <SelectItem value="body-start">Início do body</SelectItem>
                      <SelectItem value="body-end">Fim do body</SelectItem>
                    </SelectContent>
                  </Select>
                </ProjectSettingsFieldControl>
              </div>

              <div data-kodety-onboarding="settings-code-pages" className="space-y-1.5">
                <Label className="text-[10px] font-medium">Páginas</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="input"
                      aria-invalid={selectedEntry.scope === 'selected' && selectedEntry.pages.length === 0}
                      data-kodety-settings-control
                      className="group/pages-trigger h-9 w-full gap-0 overflow-hidden rounded-[9px] border-transparent bg-white/[.055] !p-0 !pr-2.5 text-xs font-normal transition-[border-color,background-color] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0 data-[state=open]:border-[var(--kodety-focus)]/75 data-[state=open]:bg-white/[.075]"
                    >
                      <span className="mr-2 grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-hover/pages-trigger:text-white/55 group-data-[state=open]/pages-trigger:text-[var(--kodety-accent-hover)]">
                        <HtmlSettingsFieldGlyph kind="collection" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left">
                        {selectedEntry.scope === 'all'
                          ? 'Todas as páginas'
                          : selectedEntry.pages.length === 1
                            ? pageLabel(selectedEntry.pages[0], homePage)
                            : `${selectedEntry.pages.length} páginas`}
                      </span>
                      <ChevronDown aria-hidden="true" className="size-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuCheckboxItem
                      checked={selectedEntry.scope === 'all'}
                      onCheckedChange={() => updateEntry(selectedEntry.id, { scope: 'all', pages: [] })}
                    >
                      Todas as páginas
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {pages.map(page => {
                      const checked = selectedEntry.scope === 'selected' && selectedEntry.pages.includes(page);
                      return (
                        <DropdownMenuCheckboxItem
                          key={page}
                          checked={checked}
                          onSelect={event => event.preventDefault()}
                          onCheckedChange={() => {
                            const current = selectedEntry.scope === 'selected' ? selectedEntry.pages : [];
                            const nextPages = checked ? current.filter(item => item !== page) : [...current, page];
                            updateEntry(selectedEntry.id, { scope: 'selected', pages: nextPages });
                          }}
                        >
                          {pageLabel(page, homePage)}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                {selectedEntry.scope === 'selected' && selectedEntry.pages.length === 0 && (
                  <p role="alert" className="text-[9px] text-destructive">Selecione ao menos uma página.</p>
                )}
              </div>

              <div data-kodety-onboarding="settings-code-run" className="space-y-1.5">
                <Label className="text-[10px] font-medium">Executar</Label>
                <ProjectSettingsFieldControl label="Executar" kind="time">
                  <Select
                    value={selectedEntry.run}
                    onValueChange={run => updateEntry(selectedEntry.id, { run: run as CustomCodeEntry['run'] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Uma vez</SelectItem>
                      <SelectItem value="navigation">Em cada navegação</SelectItem>
                    </SelectContent>
                  </Select>
                </ProjectSettingsFieldControl>
                <p className="text-[9px] leading-4 text-muted-foreground">
                  Use “Uma vez” para listeners e scripts externos. Escolha “Em cada navegação” quando precisa rodar novamente ao trocar de página.
                </p>
              </div>

              <div data-kodety-onboarding="settings-code-language" className="space-y-1.5">
                <Label className="text-[10px] font-medium">Linguagem</Label>
                <ProjectSettingsFieldControl label="Linguagem" kind="code">
                  <Select
                    value={selectedEntry.language}
                    onValueChange={value => {
                      const language = value as CustomCodeEntry['language'];
                      const isStarter = (['html', 'css', 'javascript'] as const)
                        .some(candidate => localizedStarterCode(selectedEntry.code) === starterCode(candidate));
                      updateEntry(selectedEntry.id, {
                        language,
                        ...(isStarter ? { code: starterCode(language) } : {}),
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="html">HTML</SelectItem>
                      <SelectItem value="css">CSS</SelectItem>
                      <SelectItem value="javascript">JavaScript</SelectItem>
                    </SelectContent>
                  </Select>
                </ProjectSettingsFieldControl>
              </div>

              <div data-kodety-onboarding="settings-code-consent" className="space-y-1.5">
                <Label className="text-[10px] font-medium">Consentimento</Label>
                <ProjectSettingsFieldControl label="Consentimento" kind="toggle">
                  <Select
                    value={selectedEntry.consent}
                    onValueChange={consent => updateEntry(selectedEntry.id, {
                      consent: consent as CustomCodeEntry['consent'],
                      ...(consent === 'always' ? { consentCategory: undefined } : {}),
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Sempre executar</SelectItem>
                      <SelectItem value="required">Exigir consentimento</SelectItem>
                    </SelectContent>
                  </Select>
                </ProjectSettingsFieldControl>
                <p className="text-[9px] leading-4 text-muted-foreground">
                  O código protegido permanece inerte e só chega ao parser depois da autorização.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium">Categoria</Label>
                <ProjectSettingsFieldControl label="Categoria" kind="collection">
                  <Select
                    value={selectedEntry.consentCategory || '__none__'}
                    disabled={selectedEntry.consent !== 'required'}
                    onValueChange={consentCategory => updateEntry(selectedEntry.id, {
                      consentCategory: consentCategory === '__none__' ? undefined : consentCategory,
                    })}
                  >
                    <SelectTrigger aria-invalid={selectedEntry.consent === 'required' && !selectedEntry.consentCategory}>
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" disabled>Selecione…</SelectItem>
                      {consentCategories.filter(category => !category.required).map(category => (
                        <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ProjectSettingsFieldControl>
                {selectedEntry.consent === 'required' && !selectedEntry.consentCategory && (
                  <p role="alert" className="text-[9px] text-destructive">Escolha uma categoria.</p>
                )}
                {selectedEntry.consent === 'required' && !cookieConsentEnabled && (
                  <p className="text-[9px] leading-4 text-[var(--kodety-warning)]">
                    Ative Cookie Consent para que visitantes possam liberar este código.
                  </p>
                )}
              </div>
            </div>

            <div className="pt-4">
              <div
                data-kodety-code-editor-control
                data-kodety-onboarding="settings-code-editor"
                className="group/code-editor overflow-hidden rounded-[9px] border border-transparent bg-white/[.04] transition-[border-color,background-color] hover:bg-white/[.055] focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.055]"
              >
                <div className="flex h-9 items-center gap-2 border-b border-white/[.045] bg-black/[.06] px-2.5">
                  <Braces className="size-3.5 text-white/35 transition-colors group-focus-within/code-editor:text-[var(--kodety-accent-hover)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium">Código</p>
                    <p className="truncate text-[9px] text-muted-foreground">HTML, CSS ou JavaScript, incluindo as tags necessárias.</p>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
                    {localizedStarterCode(selectedEntry.code).split('\n').length} linhas · {localizedStarterCode(selectedEntry.code).length} caracteres
                  </span>
                </div>
                <CodeEditor
                  language={selectedEntry.language}
                  value={localizedStarterCode(selectedEntry.code)}
                  onValueChange={code => updateEntry(selectedEntry.id, { code })}
                  ariaLabel={`Código de ${selectedEntry.name || 'item sem nome'}`}
                  ariaInvalid={!selectedEntry.code.trim()}
                  className="min-h-[320px] max-h-[min(54vh,560px)] overflow-auto rounded-none border-0 bg-transparent text-xs shadow-none focus-within:ring-0 sm:min-h-[400px]"
                />
              </div>
              {!selectedEntry.code.trim() && <p role="alert" className="mt-1.5 text-[9px] text-destructive">Adicione o conteúdo do código.</p>}
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--kodety-divider)] pt-3">
              <p className="max-w-lg text-[9px] leading-4 text-muted-foreground">
                O código fica salvo no projeto e é materializado no HTML ao publicar.
              </p>
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeEntry(selectedEntry)}>
                <Trash2 />
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-80 items-center justify-center px-6 text-xs text-muted-foreground">
            Selecione um código para editar.
          </div>
        )}
      </div>
    </div>
  );
}
