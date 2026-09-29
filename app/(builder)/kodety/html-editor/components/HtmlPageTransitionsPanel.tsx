'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Sparkles, Trash2 } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  PAGE_TRANSITION_EASINGS,
  PAGE_TRANSITION_EFFECTS,
  createPageTransitionRule,
  normalizePageTransitionDocument,
  type PageTransitionDocument,
  type PageTransitionEasing,
  type PageTransitionEffect,
  type PageTransitionMotion,
  type PageTransitionRule,
} from '@/lib/html-editor/page-transitions';

interface PageOption {
  path: string;
  label: string;
}

interface HtmlPageTransitionsPanelProps {
  document: PageTransitionDocument;
  pages: PageOption[];
  currentPage: string;
  homePage: string;
  readOnly?: boolean;
  onChange: (document: PageTransitionDocument) => void;
}

function MotionFields({
  value,
  disabled,
  onChange,
}: {
  value: PageTransitionMotion;
  disabled?: boolean;
  onChange: (patch: Partial<PageTransitionMotion>) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <label className="min-w-0 text-[10px] text-muted-foreground">
        Animation
        <Select
          value={value.effect}
          disabled={disabled}
          onValueChange={effect => onChange({ effect: effect as PageTransitionEffect })}
        >
          <SelectTrigger size="xs" className="mt-1 h-7 w-full min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_TRANSITION_EFFECTS.map(effect => (
              <SelectItem key={effect.value} value={effect.value}>{effect.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[10px] text-muted-foreground">
          Easing
          <Select
            value={value.easing}
            disabled={disabled}
            onValueChange={easing => onChange({ easing: easing as PageTransitionEasing })}
          >
            <SelectTrigger size="xs" className="mt-1 h-7 w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_TRANSITION_EASINGS.map(easing => (
                <SelectItem key={easing.value} value={easing.value}>{easing.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="min-w-0 text-[10px] text-muted-foreground">
          Duration
          <div className="relative mt-1">
            <Input
              type="number"
              min={0.1}
              max={3}
              step={0.05}
              disabled={disabled}
              value={value.duration}
              onChange={event => {
                const duration = Number(event.target.value);
                if (Number.isFinite(duration)) onChange({ duration });
              }}
              className="h-7 w-full rounded-[7px] pr-5"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[8px] text-muted-foreground">s</span>
          </div>
        </label>
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  pages,
  currentPage,
  readOnly,
  onChange,
  onRemove,
}: {
  rule: PageTransitionRule;
  pages: PageOption[];
  currentPage: string;
  readOnly: boolean;
  onChange: (patch: Partial<PageTransitionRule>) => void;
  onRemove: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-[9px] border border-border/55 bg-white/[.018]">
      <div className="flex min-h-9 items-center gap-2 border-b border-border/45 px-2.5">
        <ArrowRight className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]/70" />
        <span className="min-w-0 flex-1 truncate text-[9px] font-medium uppercase tracking-[.08em] text-muted-foreground">Destination rule</span>
        <Switch
          size="sm"
          checked={rule.enabled}
          disabled={readOnly}
          onCheckedChange={enabled => onChange({ enabled })}
          aria-label="Enable transition rule"
        />
        <button
          type="button"
          disabled={readOnly}
          onClick={onRemove}
          title="Remove rule"
          aria-label="Remove rule"
          className="inline-flex size-6 items-center justify-center text-muted-foreground outline-none hover:text-red-400 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-35"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="grid gap-2.5 p-2.5">
        <label className="min-w-0 text-[10px] text-muted-foreground">
          When navigating to
          <Select value={rule.to} disabled={readOnly} onValueChange={to => onChange({ to })}>
            <SelectTrigger size="xs" className="mt-1 h-7 w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pages.filter(page => page.path !== currentPage).map(page => (
                <SelectItem key={page.path} value={page.path}><span data-kodety-no-i18n>{page.label}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <MotionFields value={rule} disabled={readOnly} onChange={onChange} />
      </div>
    </section>
  );
}

export function HtmlPageTransitionsPanel({
  document,
  pages,
  currentPage,
  homePage,
  readOnly = false,
  onChange,
}: HtmlPageTransitionsPanelProps) {
  const isHome = currentPage === homePage;
  const [scope, setScope] = useState<'universal' | 'page'>(isHome ? 'universal' : 'page');
  useEffect(() => setScope(isHome ? 'universal' : 'page'), [currentPage, isHome]);

  const currentRules = useMemo(
    () => document.rules.filter(rule => rule.from === currentPage),
    [currentPage, document.rules],
  );
  const usedDestinations = useMemo(
    () => new Set(currentRules.map(rule => rule.to)),
    [currentRules],
  );
  const nextDestination = pages.find(page => (
    page.path !== currentPage && !usedDestinations.has(page.path)
  ));
  const commit = (next: PageTransitionDocument) => onChange(normalizePageTransitionDocument(next));
  const patchUniversal = (patch: Partial<typeof document.universal>) => commit({
    ...document,
    universal: { ...document.universal, ...patch },
  });
  const patchRule = (ruleId: string, patch: Partial<PageTransitionRule>) => commit({
    ...document,
    rules: document.rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule),
  });

  return (
    <div data-page-transitions-panel data-kodety-i18n-root className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/55 px-3 py-3">
        <div className="grid h-9 w-full grid-cols-2 items-stretch rounded-[10px] bg-white/[.065] p-[3px]" role="tablist" aria-label="Transition scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'universal'}
            onClick={() => setScope('universal')}
            className={`h-full w-full min-w-0 rounded-[7px] text-[9px] font-medium outline-none transition-all ${scope === 'universal' ? 'bg-white/[.13] text-foreground shadow-sm' : 'bg-transparent text-muted-foreground hover:bg-white/[.035] hover:text-foreground'}`}
          >Universal</button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'page'}
            onClick={() => setScope('page')}
            className={`h-full w-full min-w-0 rounded-[7px] text-[9px] font-medium outline-none transition-all ${scope === 'page' ? 'bg-white/[.13] text-foreground shadow-sm' : 'bg-transparent text-muted-foreground hover:bg-white/[.035] hover:text-foreground'}`}
          >This page</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-3 py-3">
        {scope === 'universal' ? (
          <div className="grid gap-3">
            {!isHome && (
              <div className="kodety-info-copy rounded-[9px] border border-white/[.07] bg-white/[.025] px-2.5 py-2 text-[9px] leading-4">
                The Universal transition belongs to the whole site. Open Home and select the Body to configure it.
              </div>
            )}
            <section className="rounded-[9px] border border-border/55 p-2.5">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium text-foreground">Universal transition</p>
                  <p className="mt-0.5 text-[8px] leading-3 text-muted-foreground">Fallback for all internal navigation.</p>
                </div>
                <Switch
                  size="sm"
                  checked={document.universal.enabled}
                  disabled={readOnly || !isHome}
                  onCheckedChange={enabled => patchUniversal({ enabled })}
                />
              </div>
              <div className="mt-3 border-t border-border/45 pt-3">
                <MotionFields
                  value={document.universal}
                  disabled={readOnly || !isHome || !document.universal.enabled}
                  onChange={patchUniversal}
                />
              </div>
              <div className="mt-3 flex min-h-7 items-center justify-between border-t border-border/45 pt-2.5">
                <span className="text-[10px] text-muted-foreground">Preload linked pages</span>
                <Switch
                  size="sm"
                  checked={document.universal.preload}
                  disabled={readOnly || !isHome || !document.universal.enabled}
                  onCheckedChange={preload => patchUniversal({ preload })}
                />
              </div>
            </section>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-[9px] border border-[var(--kodety-accent-hover)]/15 bg-[var(--kodety-accent-hover)]/[.035] px-2.5 py-2">
              <p className="text-[9px] leading-4 text-[var(--kodety-accent-hover)]/70">
                Create exceptions for links leaving <span data-kodety-no-i18n className="font-medium text-[var(--kodety-accent-hover)]">{pages.find(page => page.path === currentPage)?.label || currentPage}</span>. A page rule overrides the Universal transition.
              </p>
            </div>
            {currentRules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                pages={pages}
                currentPage={currentPage}
                readOnly={readOnly}
                onChange={patch => patchRule(rule.id, patch)}
                onRemove={() => commit({
                  ...document,
                  rules: document.rules.filter(candidate => candidate.id !== rule.id),
                })}
              />
            ))}
            {!currentRules.length && (
              <div className="flex flex-col items-center px-3 py-5 text-center">
                <Sparkles className="mb-2 size-4 text-muted-foreground/50" />
                <p className="text-[10px] font-medium text-foreground/85">No page rules</p>
                <p className="mt-1 text-[9px] leading-4 text-muted-foreground">This page uses the Universal transition when it is enabled.</p>
              </div>
            )}
            <Button
              type="button"
              size="xs"
              variant="input"
              className="h-8 w-full rounded-[7px]"
              disabled={readOnly || !nextDestination}
              onClick={() => {
                if (!nextDestination) return;
                commit({
                  ...document,
                  rules: [
                    ...document.rules,
                    createPageTransitionRule(currentPage, nextDestination.path, document.universal),
                  ],
                });
              }}
            >
              <Plus /> Add destination rule
            </Button>
            <p className="border-t border-border/45 pt-2.5 text-[8px] leading-3.5 text-muted-foreground/75">
              Page transitions use presets between documents and do not open the element timeline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
