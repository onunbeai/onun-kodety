'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Pencil, X } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  classEditingSelector,
  comboSuggestions,
  countClassUsage,
} from '@/lib/html-editor/class-selector';
import type { CssEditingContext } from '@/lib/html-editor/css-patcher';
import type { SelectionSnapshot } from '@/lib/html-editor/types';
import { cn } from '@/lib/utils';

function isClassName(value: string) {
  return /^-?[A-Za-z_][\w-]*$/.test(value);
}

/**
 * A single class in the compound. `state` reflects its role in the current
 * editing target: `active` is the class being edited, `effect` are the classes
 * to its left that also apply (`.base` when a combo is active), `muted` are the
 * classes to its right that are excluded from the target for now.
 *
 * A plain click on the label SELECTS the class for editing; the chevron opens
 * the rename / duplicate / remove menu. Separating the two is what lets you pick
 * exactly which combo class to style instead of only ever hitting the base.
 */
function ClassChip({ name, state, reusable, onSelect, onRename, onDuplicate, onRemove }: {
  name: string;
  state: 'active' | 'effect' | 'muted';
  reusable: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name && isClassName(trimmed)) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  };
  return (
    <div
      data-class-state={state}
      data-reusable-class={reusable || undefined}
      className={cn(
        'flex h-6 max-w-full shrink-0 items-center overflow-hidden rounded-[5px] border-0 text-[9px] font-medium transition-colors motion-reduce:transition-none',
        state === 'active'
          ? 'bg-[var(--kodety-control-hover)] text-white hover:bg-white/[.16]'
          : 'bg-[var(--kodety-accent)] text-white hover:bg-[var(--kodety-accent-hover)]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={(event) => {
          event.preventDefault();
          setDraft(name);
          setOpen(true);
          setRenaming(true);
        }}
        title="Editar esta classe · duplo clique para renomear"
        className="flex h-full min-w-0 flex-1 items-center overflow-hidden py-0 pl-1.5 pr-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span data-kodety-no-i18n className="min-w-0 truncate">{name}</span>
      </button>
      <Popover
        open={open}
        onOpenChange={value => { setOpen(value); if (!value) setRenaming(false); }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Opções da classe"
            aria-label={`Opções da classe ${name}`}
            className={cn(
              'flex h-full shrink-0 items-center pl-0.5 pr-1 text-white outline-none focus-visible:ring-1 focus-visible:ring-ring',
              state === 'active' ? 'opacity-60 hover:opacity-100' : 'opacity-100',
            )}
          >
            <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-0.5">
        {renaming ? (
          <div className="flex items-center gap-1 p-0.5">
            <Input
              autoFocus value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setRenaming(false); }}
              className="h-6 text-[10px]"
            />
            <Button
              size="icon-xs" variant="ghost"
              className="shrink-0 text-emerald-400 hover:text-emerald-300" onClick={commitRename}
              title="Salvar"
            ><Check className="size-3" /></Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            <button
              type="button" onClick={() => setRenaming(true)}
              className="flex h-6 w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-left text-[10px] outline-none hover:bg-white/5 focus-visible:bg-white/5"
            ><Pencil className="size-3 text-muted-foreground" /> Rename class</button>
            <button
              type="button" onClick={() => { onDuplicate(); setOpen(false); }}
              className="flex h-6 w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-left text-[10px] outline-none hover:bg-white/5 focus-visible:bg-white/5"
            ><Copy className="size-3 text-muted-foreground" /> Duplicate class</button>
            <button
              type="button" onClick={() => { onRemove(); setOpen(false); }}
              className="flex h-6 w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-left text-[10px] text-red-400 outline-none hover:bg-red-500/10 focus-visible:bg-red-500/10"
            ><X className="size-3" /> Remove class</button>
          </div>
        )}
      </PopoverContent>
      </Popover>
    </div>
  );
}

interface HtmlClassSelectorProps {
  selection: SelectionSnapshot;
  cssContext: CssEditingContext;
  onCssContextChange: (context: CssEditingContext) => void;
  onAttributeChange: (name: string, value: string) => void;
  cssFiles: string[];
  source: string;
  onRenameClass: (oldName: string, newName: string) => void;
  onDuplicateClass: (sourceName: string) => void;
  reusableClasses: string[];
  onRegisterReusableClass: (name: string) => boolean | void;
}

/**
 * Webflow-style combo class editor: every class on the element is a chip;
 * typing after the last chip searches classes already combined with the base
 * class elsewhere in the project ("Existing Combo Classes") or creates a new
 * one. The compound selector (`.a.b.c`) always mirrors the current chip set —
 * interacting with chips is how you enter "class mode" for style editing.
 */
export function HtmlClassSelector({ selection, cssContext, onCssContextChange, onAttributeChange, cssFiles, source, onRenameClass, onDuplicateClass, reusableClasses, onRegisterReusableClass }: HtmlClassSelectorProps) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chips = selection.classes;
  const chipSignature = JSON.stringify(chips);
  const stableChips = useMemo(() => JSON.parse(chipSignature) as string[], [chipSignature]);
  const reusableSet = useMemo(() => new Set(reusableClasses), [reusableClasses]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const comboCandidates = useMemo(() => {
    // Suggestions are invisible while the field is closed. Avoid walking a
    // project-sized class index for selection/computed-style messages that do
    // not open this popover.
    if (!open || !stableChips.length) return [];
    return comboSuggestions(source, stableChips[0], stableChips)
      .filter(name => !reusableSet.has(name));
  }, [open, reusableSet, source, stableChips]);
  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    return comboCandidates
      .filter(name => name.toLowerCase().includes(query))
      .slice(0, 12);
  }, [comboCandidates, draft]);
  const reusableSuggestions = useMemo(() => {
    if (!open) return [];
    const excluded = new Set(stableChips);
    const query = draft.trim().toLowerCase();
    return reusableClasses
      .filter(name => !excluded.has(name) && name.toLowerCase().includes(query))
      .slice(0, 12);
  }, [draft, open, reusableClasses, stableChips]);

  // Which class in the compound is currently being edited. Derived from the
  // active selector: the longest chip prefix whose compound selector matches
  // it. Falls back to the rightmost chip (the newest combo) so a fresh
  // selection edits the combo, not the base — matching the parent's default.
  const activeIndex = useMemo(() => {
    for (let i = stableChips.length - 1; i >= 0; i -= 1) {
      if (classEditingSelector(stableChips, reusableSet, i) === cssContext.selector) return i;
    }
    return stableChips.length - 1;
  }, [cssContext.selector, reusableSet, stableChips]);

  // Point the style panel at a chip's compound prefix (`.base` … `.base.combo`).
  const editTarget = (upTo: number) => {
    const selector = classEditingSelector(chips, reusableSet, upTo);
    onCssContextChange({
      ...cssContext,
      target: 'rule',
      selector: selector || selection.tag,
      cssFilePath: cssContext.cssFilePath || cssFiles[0] || '',
    });
  };

  const setChips = (next: string[], target: 'attribute' | 'context' = 'context') => {
    onAttributeChange('class', next.join(' '));
    if (target === 'context') {
      onCssContextChange({
        ...cssContext,
        target: 'rule',
        selector: next.length ? classEditingSelector(next, reusableSet) : selection.tag,
        cssFilePath: cssContext.cssFilePath || cssFiles[0] || '',
      });
    }
  };

  const addChip = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !isClassName(trimmed) || chips.includes(trimmed)) return;
    setChips([...chips, trimmed]);
    setDraft('');
    inputRef.current?.focus();
  };

  const addReusableChip = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !isClassName(trimmed)) return;
    if (!reusableSet.has(trimmed) && onRegisterReusableClass(trimmed) === false) return;
    const next = chips.includes(trimmed) ? chips : [...chips, trimmed];
    onAttributeChange('class', next.join(' '));
    onCssContextChange({
      ...cssContext,
      target: 'rule',
      selector: classEditingSelector(next, new Set([...reusableSet, trimmed]), next.indexOf(trimmed)),
      cssFilePath: cssContext.cssFilePath || cssFiles[0] || '',
    });
    setDraft('');
    inputRef.current?.focus();
  };

  const removeChip = (name: string) => setChips(chips.filter(item => item !== name));

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addChip(draft);
    } else if (event.key === 'Backspace' && !draft && chips.length) {
      removeChip(chips[chips.length - 1]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const activeChain = useMemo(() => (
    reusableSet.has(stableChips[activeIndex])
      ? [stableChips[activeIndex]]
      : stableChips.slice(0, activeIndex + 1).filter(name => !reusableSet.has(name))
  ), [activeIndex, reusableSet, stableChips]);
  const usageCount = useMemo(
    () => activeChain.length ? countClassUsage(source, activeChain) : 0,
    [activeChain, source],
  );

  return (
    <div
      data-ycode-class-selector
      data-kodety-onboarding="design-classes"
      className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-start gap-2"
      ref={containerRef}
    >
      <Label variant="muted" className="pt-2 text-[10px]">Classes</Label>
      <div className="min-w-0 space-y-1.5">
        {chips.length > 0 && activeIndex >= 0 && (
          <div data-kodety-onboarding="classes-scope" className="truncate text-right text-[9px] text-muted-foreground" title={`Editing .${chips[activeIndex]}`}>
            Editing <span data-kodety-no-i18n className="font-medium text-[var(--kodety-accent-hover)]">.{chips[activeIndex]}</span>
            {reusableSet.has(chips[activeIndex])
              ? <span className="text-violet-300"> · reutilizável</span>
              : activeIndex > 0 && <span> em .{activeChain[0]}</span>}
          </div>
        )}
        <div className="relative min-w-0">
          <div
            className={cn(
              'flex min-h-7 min-w-0 flex-wrap items-center gap-1 rounded-[7px] border border-border/70 bg-transparent p-1.5 transition-colors motion-reduce:transition-none',
              open && 'border-[var(--kodety-accent)] bg-transparent',
            )}
          >
            {chips.map((name, index) => (
              <ClassChip
                key={name} name={name}
                reusable={reusableSet.has(name)}
                state={index === activeIndex ? 'active' : index < activeIndex ? 'effect' : 'muted'}
                onSelect={() => editTarget(index)}
                onRename={newName => onRenameClass(name, newName)}
                onDuplicate={() => onDuplicateClass(name)}
                onRemove={() => removeChip(name)}
              />
            ))}
            <input
              ref={inputRef}
              value={draft}
              onChange={event => { setDraft(event.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={chips.length ? '' : 'Adicionar classe…'}
              aria-label="Adicionar classe"
              aria-expanded={open}
              aria-haspopup="listbox"
              className="h-6 min-w-0 basis-0 flex-1 border-0 bg-transparent px-0 text-[9px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          {open && (
            <div
              role="listbox"
              aria-label="Classes disponíveis"
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[7px] border border-border/80 bg-popover p-1.5 shadow-xl"
            >
            <p className="px-1.5 pb-1.5 pt-1 text-[9px] font-medium text-muted-foreground">Criar classe</p>
            <div className="mx-1 overflow-hidden rounded-[5px] border border-white/[.08] bg-white/[.025]">
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => addChip(draft)}
                disabled={!draft.trim() || !isClassName(draft.trim())}
                className="flex min-h-10 w-full flex-col items-start justify-center gap-0.5 px-2 py-1.5 text-left text-[var(--kodety-accent-hover)] outline-none transition-colors hover:bg-white/[.055] focus-visible:bg-white/[.055] disabled:text-muted-foreground disabled:hover:bg-transparent"
              >
                <strong className="text-[9px] font-semibold leading-3">Combo class</strong>
                <span className="block text-[8px] leading-3 text-muted-foreground">Depende da classe base deste elemento.</span>
              </button>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => addReusableChip(draft)}
                disabled={!draft.trim() || !isClassName(draft.trim())}
                className="flex min-h-10 w-full flex-col items-start justify-center gap-0.5 border-t border-white/[.1] px-2 py-1.5 text-left text-violet-300 outline-none transition-colors hover:bg-violet-500/[.09] focus-visible:bg-violet-500/[.09] disabled:text-muted-foreground disabled:hover:bg-transparent"
              >
                <strong className="text-[9px] font-semibold leading-3">Reutilizável</strong>
                <span className="block text-[8px] leading-3 text-muted-foreground">Seletor próprio, aplicável em qualquer elemento.</span>
              </button>
            </div>
            {reusableSuggestions.length > 0 && (
              <>
                <p className="mt-2.5 px-2 pb-1.5 pt-0.5 text-[9px] font-medium text-violet-300/80">Classes reutilizáveis</p>
                <div className="flex flex-wrap gap-1 px-2 pb-2">
                  {reusableSuggestions.map(name => (
                    <button
                      key={name} type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => addReusableChip(name)}
                      className="flex min-h-6 max-w-full min-w-0 items-center rounded-[5px] border border-violet-400/25 bg-violet-500/[.07] px-2 py-1 text-[9px] font-normal leading-none text-violet-200 outline-none hover:border-violet-400/60 focus-visible:border-violet-400/60"
                    >
                      <span data-kodety-no-i18n className="min-w-0 truncate">{name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {suggestions.length > 0 && (
              <>
                <p className="mt-2 px-1.5 pb-1 text-[9px] font-medium text-muted-foreground">Combo classes existentes</p>
                <div className="flex flex-wrap gap-0.5 px-1.5 pb-1">
                  {suggestions.map(name => (
                    <button
                      key={name} type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => addChip(name)}
                      className="h-5 min-h-0 rounded-[4px] border border-border/80 bg-white/[.045] px-1.5 py-0 text-[8px] font-medium text-foreground/90 outline-none hover:border-[var(--kodety-accent-hover)]/60 hover:text-[var(--kodety-accent-hover)] focus-visible:border-[var(--kodety-focus)]/60"
                    ><span data-kodety-no-i18n>{name}</span></button>
                  ))}
                </div>
              </>
            )}
            </div>
          )}
        </div>
        {chips.length > 0 && (
          <p className="truncate text-[9px] text-muted-foreground">{usageCount} on this page.</p>
        )}
      </div>
    </div>
  );
}
