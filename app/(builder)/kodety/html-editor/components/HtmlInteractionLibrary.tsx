'use client';

import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  Hand,
  Hash,
  Image,
  ImagePlay,
  Infinity,
  MousePointer2,
  MoveVertical,
  Plus,
  Scan,
  Search,
  Sparkles,
  Trash2,
  X,
} from '@/components/ui/gravity-icons';
import type { LucideIcon } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StarsMinimalisticIcon } from '@solar-icons/react/bold-duotone/stars-minimalistic';
import { EyeIcon as SolarEyeIcon } from '@solar-icons/react/bold-duotone/eye';
import { HandStarsIcon } from '@solar-icons/react/bold-duotone/hand-stars';
import { CursorSquareIcon } from '@solar-icons/react/bold-duotone/cursor-square';
import { RepeatIcon as SolarRepeatIcon } from '@solar-icons/react/bold-duotone/repeat';
import { RoundTransferVerticalIcon } from '@solar-icons/react/bold-duotone/round-transfer-vertical';
import { MagicWand3Icon } from '@solar-icons/react/bold-duotone/magic-wand-3';
import { TextFieldIcon as SolarTextFieldIcon } from '@solar-icons/react/bold-duotone/text-field';
import { PlaybackSpeedIcon } from '@solar-icons/react/bold-duotone/playback-speed';
import { MouseMinimalisticIcon } from '@solar-icons/react/bold-duotone/mouse-minimalistic';
import { ChartSquareIcon } from '@solar-icons/react/bold-duotone/chart-square';
import {
  INTERACTION_LIBRARY_CATALOG,
  addInteractionFromLibrary,
  createInteractionLibraryDraft,
  interactionLibraryDraftFromDefinition,
  retargetInteractionLibraryDraft,
  sectionMilestone,
  sectionSelector,
  updateInteractionFromLibrary,
  type InteractionLibraryActivation,
  type InteractionLibraryCatalogItem,
  type InteractionLibraryCategory,
  type InteractionLibraryDraft,
  type InteractionLibraryEffectId,
} from '@/lib/html-editor/interaction-library';
import type { InteractionDefinition, InteractionScrollMilestone } from '@/lib/html-editor/interactions';
import type { SelectionSnapshot } from '@/lib/html-editor/types';
import { cn } from '@/lib/utils';

interface LibrarySharedProps {
  source: string;
  selection: SelectionSnapshot;
  scrollSections: Array<{ id: string; label: string }>;
  readOnly?: boolean;
  onSourceChange: (source: string) => void;
  onBack: () => void;
  onBeginTargetPick: (onPick: (selection: SelectionSnapshot) => void) => void;
}

interface HtmlInteractionLibraryProps extends LibrarySharedProps {
  onApplied: (interaction: InteractionDefinition) => void;
  /** When set, the Library uses the same two-column surface as Insert. */
  panelWidth?: number;
  onOpenInsert?: () => void;
}

interface HtmlLibraryBehaviorSettingsProps extends LibrarySharedProps {
  interaction: InteractionDefinition;
  onUpdated: (interaction: InteractionDefinition) => void;
}

const CATEGORY_ORDER: Array<'All' | InteractionLibraryCategory> = [
  'All', 'Reveal', 'Text', 'Scroll', 'Pointer', 'Data',
];

const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  All: 'Todos os tipos', Reveal: 'Reveal', Text: 'Texto', Scroll: 'Scroll', Pointer: 'Pointer', Data: 'Dados',
};

type ActivationFilter = 'all' | InteractionLibraryActivation;

const EFFECT_ACTIVATION_ORDER: InteractionLibraryActivation[] = [
  'entrance', 'hover', 'cursor', 'continuous', 'scroll',
];

const ACTIVATION_ORDER: ActivationFilter[] = ['all', ...EFFECT_ACTIVATION_ORDER];

const ACTIVATION_META: Record<ActivationFilter, {
  label: string;
  description: string;
  icon: LucideIcon;
  activeClass: string;
  badgeClass: string;
  iconClass: string;
}> = {
  all: {
    label: 'Todos os efeitos',
    description: 'Todos os momentos',
    icon: Sparkles,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
  entrance: {
    label: 'Entrada',
    description: 'Ao entrar na tela',
    icon: Eye,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
  hover: {
    label: 'Hover',
    description: 'Ao passar o cursor',
    icon: Hand,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
  cursor: {
    label: 'Cursor',
    description: 'Segue o ponteiro',
    icon: MousePointer2,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
  continuous: {
    label: 'Loop contínuo',
    description: 'Movimento ambiente',
    icon: Infinity,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
  scroll: {
    label: 'Scroll contínuo',
    description: 'Ligado ao progresso',
    icon: MoveVertical,
    activeClass: 'border-transparent bg-white/[.13] text-[var(--kodety-text)]',
    badgeClass: 'border-white/[.08] bg-white/[.055] text-[var(--kodety-text-secondary)]',
    iconClass: 'border-white/[.07] bg-white/[.05] text-[var(--kodety-text-secondary)]',
  },
};

const searchableLibraryText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR');

const EFFECT_ICONS: Record<InteractionLibraryEffectId, LucideIcon> = {
  'fade-in': Sparkles,
  'fade-up': Sparkles,
  'fade-down': Sparkles,
  'fade-left': Sparkles,
  'fade-right': Sparkles,
  'scale-in': Scan,
  'zoom-out': Scan,
  'rotate-in': Scan,
  'blur-reveal': Activity,
  'mask-reveal': Scan,
  'clip-up': Scan,
  'text-words': Hash,
  'text-chars': Hash,
  'text-lines': Hash,
  'text-blur-words': Hash,
  'text-roll-whole': Hand,
  'text-roll-words': Hand,
  'text-roll-chars': Hand,
  'stagger-children': Activity,
  'hover-lift': Hand,
  'hover-scale': Hand,
  'parallax-y': Activity,
  'scroll-scale': Activity,
  'scroll-rotate': Activity,
  'count-up': Hash,
  magnetic: Hand,
  'ticker-infinite': Infinity,
  'ticker-infinite-reverse': Infinity,
  'image-sequence': Image,
  'video-scrub': ImagePlay,
};

type LibraryPanelSection = ActivationFilter | InteractionLibraryCategory;

const PANEL_MOMENT_SECTIONS: LibraryPanelSection[] = [
  'all', 'entrance', 'hover', 'cursor', 'continuous', 'scroll',
];

const PANEL_TYPE_SECTIONS: LibraryPanelSection[] = [
  'Reveal', 'Text', 'Scroll', 'Pointer', 'Data',
];

type EffectsNavigationIcon = ComponentType<{ className?: string }>;

const PANEL_NAVIGATION_ICONS: Record<LibraryPanelSection, EffectsNavigationIcon> = {
  all: StarsMinimalisticIcon,
  entrance: SolarEyeIcon,
  hover: HandStarsIcon,
  cursor: CursorSquareIcon,
  continuous: SolarRepeatIcon,
  scroll: RoundTransferVerticalIcon,
  Reveal: MagicWand3Icon,
  Text: SolarTextFieldIcon,
  Scroll: PlaybackSpeedIcon,
  Pointer: MouseMinimalisticIcon,
  Data: ChartSquareIcon,
};

const PANEL_CATEGORY_META: Record<InteractionLibraryCategory, {
  label: string;
  description: string;
  icon: LucideIcon;
}> = {
  Reveal: { label: 'Reveals', description: 'Entradas e aparições', icon: Sparkles },
  Text: { label: 'Texto', description: 'Palavras, letras e linhas', icon: Hash },
  Scroll: { label: 'Scroll', description: 'Progresso e sequências', icon: MoveVertical },
  Pointer: { label: 'Pointer', description: 'Hover e cursor', icon: MousePointer2 },
  Data: { label: 'Dados', description: 'Números e valores', icon: Activity },
};

const panelSectionMeta = (section: LibraryPanelSection) => {
  if (section in PANEL_CATEGORY_META) return PANEL_CATEGORY_META[section as InteractionLibraryCategory];
  return ACTIVATION_META[section as ActivationFilter];
};

function EffectPreview({ item }: { item: InteractionLibraryCatalogItem }) {
  const textRoll = item.id === 'text-roll-whole'
    || item.id === 'text-roll-words'
    || item.id === 'text-roll-chars';
  if (textRoll) {
    const units = item.id === 'text-roll-whole'
      ? ['Motion']
      : item.id === 'text-roll-words'
        ? ['Motion', 'Studio']
        : 'Motion'.split('');
    return (
      <div className="flex h-full items-center justify-center overflow-hidden px-3" aria-hidden="true">
        <span className="flex gap-x-1 text-[17px] font-semibold tracking-[-0.04em] text-zinc-200">
          {units.map((unit, index) => (
            <span key={`${unit}-${index}`} className="relative inline-grid h-6 overflow-hidden">
              <span
                className="col-start-1 row-start-1 transition-transform duration-[360ms] ease-out group-hover:-translate-y-full motion-reduce:transform-none"
                style={{ transitionDelay: `${index * (item.id === 'text-roll-whole' ? 0 : item.id === 'text-roll-words' ? 45 : 28)}ms` }}
              >{unit}</span>
              <span
                className="col-start-1 row-start-1 translate-y-full text-[var(--kodety-accent-hover)] transition-transform duration-[360ms] ease-out group-hover:translate-y-0 motion-reduce:transform-none"
                style={{ transitionDelay: `${index * (item.id === 'text-roll-whole' ? 0 : item.id === 'text-roll-words' ? 45 : 28)}ms` }}
              >{unit}</span>
            </span>
          ))}
        </span>
      </div>
    );
  }

  if (item.id === 'stagger-children') return (
    <div className="flex h-full items-center justify-center gap-1.5 px-4" aria-hidden="true">
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="h-9 w-7 translate-y-3 rounded-[4px] border border-white/15 bg-white/[0.07] opacity-20 transition-all duration-[580ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transform-none"
          style={{ transitionDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );

  if (item.category === 'Text') {
    const units = item.id === 'text-chars'
      ? 'Motion'.split('')
      : item.id === 'text-lines'
        ? ['Motion', 'preview']
        : ['Motion', 'design'];
    const stagger = item.id === 'text-chars' ? 22 : item.id === 'text-lines' ? 90 : item.id === 'text-words' ? 55 : 60;
    return (
      <div className={cn('flex h-full items-center justify-center overflow-hidden px-3', item.id === 'text-lines' ? 'flex-col gap-0' : 'gap-1.5')} aria-hidden="true">
        {units.map((unit, index) => (
          <span key={`${unit}-${index}`} className="overflow-hidden">
            <span
              className={cn(
                'inline-block translate-y-full opacity-0 text-[16px] font-semibold tracking-[-0.04em] text-zinc-200 transition-all duration-[550ms] ease-out group-hover:translate-y-0 group-hover:rotate-0 group-hover:opacity-100 group-hover:blur-none motion-reduce:transform-none',
                item.id === 'text-chars' && 'rotate-3',
                item.id === 'text-blur-words' && 'translate-y-3 blur-[4px]',
                item.id === 'text-lines' && 'text-[13px] leading-4',
              )}
              style={{ transitionDelay: `${index * stagger}ms` }}
            >{unit}</span>
          </span>
        ))}
      </div>
    );
  }

  if (item.id === 'count-up') return (
    <div className="relative flex h-full items-center justify-center overflow-hidden" aria-hidden="true">
      <span className="absolute text-[20px] font-semibold tabular-nums tracking-[-0.04em] text-zinc-500 transition-all duration-[700ms] ease-out group-hover:-translate-y-5 group-hover:opacity-0 motion-reduce:transform-none">0</span>
      <span className="absolute translate-y-5 text-[20px] font-semibold tabular-nums tracking-[-0.04em] text-[var(--kodety-accent-hover)] opacity-0 transition-all duration-[700ms] ease-out group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transform-none">12K</span>
    </div>
  );

  if (item.id === 'magnetic') return (
    <div className="relative h-full overflow-hidden" aria-hidden="true">
      <span className="absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25 bg-white/[0.035] transition-all duration-500 ease-out group-hover:translate-x-[calc(-50%+8px)] group-hover:translate-y-[calc(-50%-5px)] group-hover:border-[var(--kodety-accent-hover)]/70 motion-reduce:transform-none" />
      <MousePointer2 className="absolute left-[24%] top-[63%] size-4 text-zinc-400 transition-all duration-500 ease-out group-hover:left-[58%] group-hover:top-[33%] group-hover:text-[var(--kodety-accent-hover)]" />
    </div>
  );

  if (item.id === 'ticker-infinite' || item.id === 'ticker-infinite-reverse') return (
    <div className="flex h-full items-center overflow-hidden pl-2" aria-hidden="true">
      <div
        className={cn(
          'kodety-effect-card-ticker-track flex w-max items-center gap-2',
          item.id === 'ticker-infinite-reverse' && 'kodety-effect-card-ticker-track--reverse',
        )}
      >
        {[0, 1].map(copy => (
          <span key={copy} className="flex shrink-0 items-center gap-2">
            {['Studio', 'Motion', 'Loop'].map(label => (
              <span key={`${copy}-${label}`} className="rounded-full border border-white/[.1] bg-white/[.05] px-2.5 py-1 text-[8px] font-medium text-[var(--kodety-text-secondary)]">{label}</span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );

  if (item.id === 'image-sequence') return (
    <div className="relative flex h-full items-center justify-center overflow-hidden" aria-hidden="true">
      <span className="absolute h-11 w-[72px] -rotate-3 rounded-[5px] border border-white/10 bg-white/[0.035] transition-all duration-700 group-hover:rotate-3 group-hover:opacity-0" />
      <span className="absolute h-11 w-[72px] translate-x-1 translate-y-1 rotate-3 rounded-[5px] border border-[var(--kodety-accent-hover)]/30 bg-gradient-to-br from-[var(--kodety-accent-hover)]/15 to-transparent opacity-25 transition-all duration-700 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:rotate-0 group-hover:opacity-100"><Image className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-[var(--kodety-accent-hover)]/70" /></span>
    </div>
  );

  if (item.id === 'video-scrub') return (
    <div className="flex h-full items-center justify-center" aria-hidden="true">
      <span className="relative block h-11 w-[78px] overflow-hidden rounded-[5px] border border-white/15 bg-white/[0.035]"><ImagePlay className="absolute left-1/2 top-[44%] size-4 -translate-x-1/2 -translate-y-1/2 text-zinc-400" /><span className="absolute inset-x-2 bottom-1.5 h-0.5 overflow-hidden rounded bg-white/10"><span className="block h-full w-[12%] rounded bg-[var(--kodety-accent-hover)] transition-[width] duration-1000 ease-linear group-hover:w-full" /></span></span>
    </div>
  );

  const visualClass: Partial<Record<InteractionLibraryEffectId, string>> = {
    'fade-in': 'opacity-0 group-hover:opacity-100',
    'fade-up': 'translate-y-5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
    'fade-down': '-translate-y-5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
    'fade-left': 'translate-x-6 opacity-0 group-hover:translate-x-0 group-hover:opacity-100',
    'fade-right': '-translate-x-6 opacity-0 group-hover:translate-x-0 group-hover:opacity-100',
    'scale-in': 'scale-[.88] opacity-0 group-hover:scale-100 group-hover:opacity-100',
    'zoom-out': 'scale-[1.12] opacity-0 group-hover:scale-100 group-hover:opacity-100',
    'rotate-in': '-rotate-6 scale-[.96] opacity-0 group-hover:rotate-0 group-hover:scale-100 group-hover:opacity-100',
    'blur-reveal': 'translate-y-3 blur-[6px] opacity-0 group-hover:translate-y-0 group-hover:blur-none group-hover:opacity-100',
    'mask-reveal': '[clip-path:inset(0_100%_0_0)] group-hover:[clip-path:inset(0_0_0_0)]',
    'clip-up': 'translate-y-4 opacity-0 [clip-path:inset(100%_0_0_0)] group-hover:translate-y-0 group-hover:opacity-100 group-hover:[clip-path:inset(0_0_0_0)]',
    'hover-lift': 'shadow-none group-hover:-translate-y-2 group-hover:shadow-[0_14px_30px_rgba(0,0,0,.35)]',
    'hover-scale': 'scale-100 group-hover:scale-[1.035]',
    'parallax-y': '-translate-y-4 group-hover:translate-y-4',
    'scroll-scale': 'scale-[.86] group-hover:scale-[1.06]',
    'scroll-rotate': '-rotate-[7deg] group-hover:rotate-[7deg]',
  };
  return (
    <div className="flex h-full items-center justify-center overflow-hidden px-5" aria-hidden="true">
      <span className={cn(
        'relative block h-8 w-full max-w-[92px] rounded-[5px] border border-white/15 bg-gradient-to-br from-white/15 to-white/[0.035] transition-all duration-700 ease-out motion-reduce:transform-none',
        visualClass[item.id],
      )}>
        <span className="absolute inset-x-2 top-2 h-px bg-white/55" />
        <span className="absolute inset-x-2 top-4 h-px bg-white/25" />
        <span className="absolute left-2 top-6 h-px w-7 bg-[var(--kodety-accent-hover)]/60" />
      </span>
    </div>
  );
}

const numeric = (value: string, fallback = 0) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const LIBRARY_CONTROL_CLASS =
  'h-8 rounded-[8px] border-transparent bg-white/[.05] text-[10px] shadow-none hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.065] focus-visible:ring-0';

const LIBRARY_SELECT_CLASS =
  `${LIBRARY_CONTROL_CLASS} min-w-0 [&>svg]:size-3`;

const LIBRARY_SELECT_CONTENT_CLASS =
  'z-[120] rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]';

function SettingField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-medium text-[var(--kodety-text-secondary)]">{label}</span>
      {hint && <span className="ml-1 text-[8px] text-[var(--kodety-info-copy)]">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function TargetPicker({ target, label, disabled, onPick }: { target: SelectionSnapshot; label?: string; disabled?: boolean; onPick: () => void }) {
  const identity = label || (target.id
    ? `#${target.id}`
    : target.classes[0]
      ? `.${target.classes[0]}`
      : target.tag.toLowerCase());
  return (
    <div data-library-target className="flex min-w-0 items-center gap-2 rounded-[9px] border border-white/[.07] bg-white/[.025] p-2">
      <Crosshair className="size-3.5 shrink-0 text-[var(--kodety-accent-hover)]/75" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[9px] font-medium text-[var(--kodety-text)]">Target</span>
        <span className="block truncate font-mono text-[8px] text-[var(--kodety-info-copy)]">{identity}</span>
      </span>
      <Button type="button" size="xs" variant="ghost" className="rounded-[7px] border border-transparent bg-white/[.04] shadow-none hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:ring-0" disabled={disabled} onClick={onPick}>
        Selecionar
      </Button>
    </div>
  );
}

function MilestoneEditor({
  draft,
  setDraft,
  scrollSections,
  disabled,
}: {
  draft: InteractionLibraryDraft;
  setDraft: React.Dispatch<React.SetStateAction<InteractionLibraryDraft>>;
  scrollSections: Array<{ id: string; label: string }>;
  disabled?: boolean;
}) {
  const isVideo = draft.effectId === 'video-scrub';
  const startValue = isVideo ? draft.videoStartTime : draft.imageStartIndex;
  const endValue = isVideo ? draft.videoEndTime : draft.imageEndIndex;
  const patchMilestone = (index: number, changes: Partial<InteractionScrollMilestone>) => {
    setDraft(current => ({
      ...current,
      milestones: current.milestones.map((milestone, milestoneIndex) => (
        milestoneIndex === index ? { ...milestone, ...changes } : milestone
      )),
    }));
  };
  const addMilestone = () => {
    setDraft(current => ({
      ...current,
      milestones: (() => {
        const section = scrollSections[Math.min(current.milestones.length, scrollSections.length - 1)];
        if (!section) return current.milestones;
        return [
          ...current.milestones,
          sectionMilestone(
            section,
            current.milestones.length ? endValue : startValue,
            current.milestones.length ? 0.5 : 0.85,
          ),
        ];
      })(),
    }));
  };
  return (
    <section data-library-scroll-milestones className="mt-3 overflow-hidden rounded-[9px] border border-white/[.07] bg-white/[.018]">
      <div className="flex min-h-9 items-center justify-between border-b border-white/[.055] px-2.5">
        <span>
          <span className="block text-[9px] font-medium text-foreground">Scroll checkpoints</span>
          <span className="block text-[8px] text-muted-foreground">Section + anchor → {isVideo ? 'segundo' : 'frame'}</span>
        </span>
        <Button type="button" size="xs" variant="ghost" disabled={disabled || !scrollSections.length} onClick={addMilestone}>
          <Plus /> Marco
        </Button>
      </div>
      {!scrollSections.length && (
        <p className="kodety-info-copy px-2.5 py-3 text-[8px] leading-3.5">Adicione IDs às seções ou headings que devem dirigir a sequência.</p>
      )}
      {scrollSections.length > 0 && !draft.milestones.length && (
        <p className="px-2.5 py-3 text-[8px] leading-3.5 text-muted-foreground">Adicione pelo menos dois marcos. A mesma Section pode aparecer mais de uma vez com anchors diferentes.</p>
      )}
      <div className="divide-y divide-white/[.055]">
        {draft.milestones.map((milestone, index) => {
          const sectionId = scrollSections.find(section => sectionSelector(section.id) === milestone.selector)?.id || '';
          return (
            <div key={milestone.id} className="space-y-2 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 font-mono text-[8px] text-muted-foreground">{index + 1}</span>
                <Select
                  value={sectionId}
                  disabled={disabled}
                  onValueChange={value => {
                    const section = scrollSections.find(item => item.id === value);
                    if (section) patchMilestone(index, { selector: sectionSelector(section.id), label: section.label || `#${section.id}` });
                  }}
                >
                  <SelectTrigger aria-label={`Scroll Section do checkpoint ${index + 1}`} className="h-7 min-w-0 flex-1 rounded-[7px] text-[9px]"><SelectValue placeholder="Scroll Section" /></SelectTrigger>
                  <SelectContent className={LIBRARY_SELECT_CONTENT_CLASS}>
                    {scrollSections.map(section => <SelectItem key={section.id} value={section.id}>{section.label} · #{section.id}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step={isVideo ? 0.1 : 1}
                  value={milestone.value}
                  disabled={disabled}
                  onChange={event => patchMilestone(index, { value: numeric(event.target.value, milestone.value) })}
                  className="h-7 w-[66px] rounded-[7px] text-[9px]"
                  aria-label={isVideo ? 'Segundo do vídeo' : 'Frame da sequência'}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setDraft(current => ({ ...current, milestones: current.milestones.filter((_, milestoneIndex) => milestoneIndex !== index) }))}
                  className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-red-300 disabled:opacity-35"
                  aria-label={`Remover checkpoint ${index + 1}`}
                ><Trash2 className="size-3" /></button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 pl-[22px]">
                <Select value={String(milestone.elementAnchor)} disabled={disabled} onValueChange={value => patchMilestone(index, { elementAnchor: Number(value) })}>
                  <SelectTrigger aria-label={`Anchor do elemento no checkpoint ${index + 1}`} className="h-7 rounded-[7px] text-[8px]"><SelectValue /></SelectTrigger>
                  <SelectContent className={LIBRARY_SELECT_CONTENT_CLASS}>
                    <SelectItem value="0">Elemento · topo</SelectItem>
                    <SelectItem value="0.5">Elemento · centro</SelectItem>
                    <SelectItem value="1">Elemento · base</SelectItem>
                  </SelectContent>
                </Select>
                <label className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(milestone.viewportAnchor * 100)}
                    disabled={disabled}
                    onChange={event => patchMilestone(index, { viewportAnchor: Math.max(0, Math.min(1, numeric(event.target.value) / 100)) })}
                    className="h-7 rounded-[7px] pr-5 text-[8px]"
                    aria-label="Posição na viewport em porcentagem"
                  />
                  <span className="pointer-events-none absolute right-2 top-[7px] text-[8px] text-muted-foreground">%</span>
                </label>
                <label className="relative">
                  <Input
                    type="number"
                    step={1}
                    value={milestone.offsetPx}
                    disabled={disabled}
                    onChange={event => patchMilestone(index, { offsetPx: numeric(event.target.value) })}
                    className="h-7 rounded-[7px] pr-5 text-[8px]"
                    aria-label="Offset em pixels"
                  />
                  <span className="pointer-events-none absolute right-2 top-[7px] text-[8px] text-muted-foreground">px</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EffectConfiguration({
  item,
  draft,
  setDraft,
  scrollSections,
  disabled,
}: {
  item: InteractionLibraryCatalogItem;
  draft: InteractionLibraryDraft;
  setDraft: React.Dispatch<React.SetStateAction<InteractionLibraryDraft>>;
  scrollSections: Array<{ id: string; label: string }>;
  disabled?: boolean;
}) {
  if (item.id === 'count-up') return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <SettingField label="De"><Input type="number" value={draft.countFrom} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countFrom: numeric(event.target.value) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Até"><Input type="number" value={draft.countTo} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countTo: numeric(event.target.value) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Duração" hint="s"><Input type="number" min={0.01} step={0.1} value={draft.countDuration} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countDuration: numeric(event.target.value, current.countDuration) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Decimais"><Input type="number" min={0} max={8} value={draft.countDecimals} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countDecimals: Math.max(0, Math.min(8, Math.floor(numeric(event.target.value)))) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Prefixo"><Input value={draft.countPrefix} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countPrefix: event.target.value }))} className="h-7 rounded-[7px]" placeholder="R$ " /></SettingField>
      <SettingField label="Sufixo"><Input value={draft.countSuffix} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countSuffix: event.target.value }))} className="h-7 rounded-[7px]" placeholder="%" /></SettingField>
      <div className="col-span-2"><SettingField label="Locale"><Input value={draft.countLocale} disabled={disabled} onChange={event => setDraft(current => ({ ...current, countLocale: event.target.value }))} className="h-7 rounded-[7px]" placeholder="pt-BR" /></SettingField></div>
    </div>
  );
  if (item.id === 'magnetic') return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <SettingField label="Força" hint="0–1"><Input type="number" min={0} max={1} step={0.05} value={draft.magneticStrength} disabled={disabled} onChange={event => setDraft(current => ({ ...current, magneticStrength: numeric(event.target.value, current.magneticStrength) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Raio" hint="px"><Input type="number" min={0} step={10} value={draft.magneticRadius} disabled={disabled} onChange={event => setDraft(current => ({ ...current, magneticRadius: numeric(event.target.value, current.magneticRadius) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Suavidade" hint="s"><Input type="number" min={0.01} step={0.05} value={draft.magneticSmoothing} disabled={disabled} onChange={event => setDraft(current => ({ ...current, magneticSmoothing: numeric(event.target.value, current.magneticSmoothing) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Retorno" hint="s"><Input type="number" min={0.01} step={0.05} value={draft.magneticReturnDuration} disabled={disabled} onChange={event => setDraft(current => ({ ...current, magneticReturnDuration: numeric(event.target.value, current.magneticReturnDuration) }))} className="h-7 rounded-[7px]" /></SettingField>
    </div>
  );
  if (item.id === 'text-roll-whole' || item.id === 'text-roll-words' || item.id === 'text-roll-chars') return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <SettingField label="Duração" hint="s"><Input type="number" min={0.05} step={0.02} value={draft.textRollDuration} disabled={disabled} onChange={event => setDraft(current => ({ ...current, textRollDuration: Math.max(0.05, numeric(event.target.value, current.textRollDuration)) }))} className="h-7 rounded-[7px]" /></SettingField>
      <SettingField label="Stagger" hint="s"><Input type="number" min={0} max={0.5} step={0.005} value={draft.textRollStagger} disabled={disabled || draft.textRollSplit === 'whole'} onChange={event => setDraft(current => ({ ...current, textRollStagger: Math.max(0, Math.min(0.5, numeric(event.target.value, current.textRollStagger))) }))} className="h-7 rounded-[7px]" /></SettingField>
      <div className="col-span-2"><SettingField label="Distância" hint="% da linha"><Input type="number" min={20} max={200} step={1} value={draft.textRollDistance} disabled={disabled} onChange={event => setDraft(current => ({ ...current, textRollDistance: Math.max(20, Math.min(200, numeric(event.target.value, current.textRollDistance))) }))} className="h-7 rounded-[7px]" /></SettingField></div>
    </div>
  );
  if (item.id === 'ticker-infinite' || item.id === 'ticker-infinite-reverse') return (
    <div data-library-ticker-settings className="mt-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <SettingField label="Direção">
          <Select
            value={draft.tickerDirection}
            disabled={disabled}
            onValueChange={value => setDraft(current => ({
              ...current,
              effectId: value === 'right' ? 'ticker-infinite-reverse' : 'ticker-infinite',
              tickerDirection: value as 'left' | 'right',
            }))}
          >
            <SelectTrigger className={LIBRARY_SELECT_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent className={LIBRARY_SELECT_CONTENT_CLASS}>
              <SelectItem value="left">Para a esquerda</SelectItem>
              <SelectItem value="right">Para a direita</SelectItem>
            </SelectContent>
          </Select>
        </SettingField>
        <SettingField label="Velocidade" hint="px/s">
          <Input type="number" min={4} max={1000} step={1} value={draft.tickerSpeed} disabled={disabled} onChange={event => setDraft(current => ({ ...current, tickerSpeed: Math.max(4, Math.min(1000, numeric(event.target.value, current.tickerSpeed))) }))} className={LIBRARY_CONTROL_CLASS} />
        </SettingField>
        <SettingField label="Espaçamento" hint="px">
          <Input type="number" min={0} max={1024} step={1} value={draft.tickerGap} disabled={disabled} onChange={event => setDraft(current => ({ ...current, tickerGap: Math.max(0, Math.min(1024, numeric(event.target.value, current.tickerGap))) }))} className={LIBRARY_CONTROL_CLASS} />
        </SettingField>
        <SettingField label="No hover">
          <Select value={draft.tickerHoverBehavior} disabled={disabled} onValueChange={value => setDraft(current => ({ ...current, tickerHoverBehavior: value as 'none' | 'pause' | 'slow' }))}>
            <SelectTrigger className={LIBRARY_SELECT_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent className={LIBRARY_SELECT_CONTENT_CLASS}>
              <SelectItem value="slow">Desacelerar</SelectItem>
              <SelectItem value="pause">Pausar</SelectItem>
              <SelectItem value="none">Manter velocidade</SelectItem>
            </SelectContent>
          </Select>
        </SettingField>
        <SettingField label="Velocidade no hover" hint="%">
          <Input type="number" min={2} max={100} step={1} value={Math.round(draft.tickerHoverSlowdown * 100)} disabled={disabled || draft.tickerHoverBehavior !== 'slow'} onChange={event => setDraft(current => ({ ...current, tickerHoverSlowdown: Math.max(0.02, Math.min(1, numeric(event.target.value, current.tickerHoverSlowdown * 100) / 100)) }))} className={LIBRARY_CONTROL_CLASS} />
        </SettingField>
        <SettingField label="Transição do hover" hint="s">
          <Input type="number" min={0.01} max={2} step={0.01} value={draft.tickerHoverTransition} disabled={disabled || draft.tickerHoverBehavior === 'none'} onChange={event => setDraft(current => ({ ...current, tickerHoverTransition: Math.max(0.01, Math.min(2, numeric(event.target.value, current.tickerHoverTransition))) }))} className={LIBRARY_CONTROL_CLASS} />
        </SettingField>
      </div>

      <div className="rounded-[9px] border border-white/[.07] bg-white/[.025] p-2.5">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[9px] font-medium text-[var(--kodety-text)]">Segurar e arrastar</span>
            <span className="mt-0.5 block text-[8px] leading-3 text-[var(--kodety-info-copy)]">Pointer e toque movem a faixa; um drag não ativa links.</span>
          </span>
          <Switch
            size="sm"
            disabled={disabled}
            checked={draft.tickerDraggable}
            aria-label="Permitir arraste do ticker"
            onCheckedChange={tickerDraggable => setDraft(current => ({ ...current, tickerDraggable }))}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/[.055] pt-2">
          <SettingField label="Sensibilidade" hint="×">
            <Input type="number" min={0.1} max={4} step={0.1} value={draft.tickerDragSensitivity} disabled={disabled || !draft.tickerDraggable} onChange={event => setDraft(current => ({ ...current, tickerDragSensitivity: Math.max(0.1, Math.min(4, numeric(event.target.value, current.tickerDragSensitivity))) }))} className={LIBRARY_CONTROL_CLASS} />
          </SettingField>
          <SettingField label="Inércia" hint="%">
            <Input type="number" min={0} max={98} step={1} value={Math.round(draft.tickerMomentum * 100)} disabled={disabled || !draft.tickerDraggable} onChange={event => setDraft(current => ({ ...current, tickerMomentum: Math.max(0, Math.min(0.98, numeric(event.target.value, current.tickerMomentum * 100) / 100)) }))} className={LIBRARY_CONTROL_CLASS} />
          </SettingField>
        </div>
      </div>
      <p className="px-0.5 text-[8px] leading-3.5 text-[var(--kodety-info-copy)]">
        O runtime mede o conteúdo, cria cópias inacessíveis suficientes para cobrir a viewport e mantém o fluxo contínuo durante resize e carregamento de fontes.
      </p>
    </div>
  );
  if (item.id === 'image-sequence') return (
    <>
      <div className="mt-3 space-y-2">
        <SettingField label="URL dos frames" hint="use {index}"><Input value={draft.imageUrlTemplate} disabled={disabled} onChange={event => setDraft(current => ({ ...current, imageUrlTemplate: event.target.value }))} className="h-7 rounded-[7px] font-mono text-[9px]" placeholder="https://site.com/frames/frame_{index}.webp" /></SettingField>
        <div className="grid grid-cols-2 gap-2">
          <SettingField label="Primeiro frame"><Input type="number" min={0} step={1} value={draft.imageStartIndex} disabled={disabled} onChange={event => setDraft(current => ({ ...current, imageStartIndex: Math.max(0, Math.floor(numeric(event.target.value))) }))} className="h-7 rounded-[7px]" /></SettingField>
          <SettingField label="Último frame"><Input type="number" min={0} step={1} value={draft.imageEndIndex} disabled={disabled} onChange={event => setDraft(current => ({ ...current, imageEndIndex: Math.max(0, Math.floor(numeric(event.target.value))) }))} className="h-7 rounded-[7px]" /></SettingField>
          <SettingField label="Zero padding" hint="ex.: 4 → 0001"><Input type="number" min={0} max={12} step={1} value={draft.imageZeroPad} disabled={disabled} onChange={event => setDraft(current => ({ ...current, imageZeroPad: Math.max(0, Math.min(12, Math.floor(numeric(event.target.value)))) }))} className="h-7 rounded-[7px]" /></SettingField>
          <SettingField label="Preload" hint="± frames"><Input type="number" min={0} max={24} step={1} value={draft.imagePreloadRadius} disabled={disabled} onChange={event => setDraft(current => ({ ...current, imagePreloadRadius: Math.max(0, Math.min(24, Math.floor(numeric(event.target.value)))) }))} className="h-7 rounded-[7px]" /></SettingField>
        </div>
      </div>
      <MilestoneEditor draft={draft} setDraft={setDraft} scrollSections={scrollSections} disabled={disabled} />
    </>
  );
  if (item.id === 'video-scrub') return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SettingField label="Tempo inicial" hint="s"><Input type="number" min={0} step={0.1} value={draft.videoStartTime} disabled={disabled} onChange={event => setDraft(current => ({ ...current, videoStartTime: Math.max(0, numeric(event.target.value)) }))} className="h-7 rounded-[7px]" /></SettingField>
        <SettingField label="Tempo final" hint="s"><Input type="number" min={0} step={0.1} value={draft.videoEndTime} disabled={disabled} onChange={event => setDraft(current => ({ ...current, videoEndTime: Math.max(0, numeric(event.target.value)) }))} className="h-7 rounded-[7px]" /></SettingField>
        <div className="col-span-2"><SettingField label="Suavidade do seek" hint="0 = direto"><Input type="number" min={0} max={1} step={0.02} value={draft.videoSmoothing} disabled={disabled} onChange={event => setDraft(current => ({ ...current, videoSmoothing: Math.max(0, numeric(event.target.value)) }))} className="h-7 rounded-[7px]" /></SettingField></div>
      </div>
      <MilestoneEditor draft={draft} setDraft={setDraft} scrollSections={scrollSections} disabled={disabled} />
    </>
  );
  return (
    <div className="mt-3 rounded-[8px] border border-border/45 bg-white/[.018] px-2.5 py-2 text-[8px] leading-3.5 text-muted-foreground">
      Esse preset cria uma timeline editável com o gatilho adequado. Depois de aplicar, ajuste duração, easing e propriedades normalmente na Timeline.
    </div>
  );
}

function EffectWizard({
  item,
  draft,
  setDraft,
  scrollSections,
  readOnly,
  showEnabled = false,
  error,
  applyLabel,
  onBack,
  onPick,
  onApply,
}: {
  item: InteractionLibraryCatalogItem;
  draft: InteractionLibraryDraft;
  setDraft: React.Dispatch<React.SetStateAction<InteractionLibraryDraft>>;
  scrollSections: Array<{ id: string; label: string }>;
  readOnly?: boolean;
  showEnabled?: boolean;
  error: string;
  applyLabel: string;
  onBack: () => void;
  onPick: () => void;
  onApply: () => void;
}) {
  const Icon = EFFECT_ICONS[item.id];
  const activation = ACTIVATION_META[item.activation];
  const ActivationIcon = activation.icon;
  return (
    <div data-interaction-library-wizard className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-11 items-center gap-2 border-b border-[var(--kodety-divider)] px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Voltar" onClick={onBack} className="grid size-7 place-items-center rounded-[7px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.06] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]"><ChevronLeft className="size-3.5" /></button>
          </TooltipTrigger>
          <TooltipContent side="right" className="z-[120]">Voltar</TooltipContent>
        </Tooltip>
        <Icon className="size-3.5 text-[var(--kodety-text-tertiary)]" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--kodety-text)]">{item.name}</span>
        <span data-library-activation-badge={item.activation} className={`rounded-full border px-1.5 py-0.5 text-[7px] font-medium ${activation.badgeClass}`}>{activation.label}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 no-scrollbar">
        <p className="mb-1 text-[9px] leading-3.5 text-[var(--kodety-text-secondary)]">{item.description}</p>
        <p className="mb-3 text-[8px] leading-3 text-[var(--kodety-info-copy)]">Target recomendado: {item.targetHint}</p>
        <div data-library-activation-summary={item.activation} className="mb-2 flex min-h-10 items-center gap-2 rounded-[9px] border border-white/[.07] bg-white/[.025] px-2.5">
          <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] border ${activation.iconClass}`}><ActivationIcon className="size-3.5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-medium text-[var(--kodety-text)]">{activation.label}</span>
            <span className="block text-[8px] text-[var(--kodety-info-copy)]">{activation.description}</span>
          </span>
          <span className="max-w-[76px] text-right text-[7px] leading-3 text-[var(--kodety-info-copy)]">{item.engine === 'timeline' ? 'Editável na Timeline' : 'Configuração própria'}</span>
        </div>
        {showEnabled && (
          <div className="mb-2 flex min-h-8 items-center justify-between rounded-[9px] border border-white/[.07] bg-white/[.025] px-2.5">
            <span className="text-[9px] font-medium text-[var(--kodety-text-secondary)]">Efeito ativo</span>
            <Switch
              size="sm"
              disabled={readOnly}
              checked={draft.enabled}
              aria-label="Ativar efeito da Library"
              onCheckedChange={enabled => setDraft(current => ({ ...current, enabled }))}
            />
          </div>
        )}
        <TargetPicker target={draft.target} label={draft.targetLabel} disabled={readOnly} onPick={onPick} />
        <EffectConfiguration item={item} draft={draft} setDraft={setDraft} scrollSections={scrollSections} disabled={readOnly} />
        {error && <p role="alert" className="mt-3 rounded-[7px] border border-red-400/20 bg-red-500/[.06] px-2.5 py-2 text-[8px] leading-3.5 text-red-200">{error}</p>}
      </div>
      <footer className="border-t border-[var(--kodety-divider)] p-2.5">
        <Button type="button" className="w-full rounded-[8px] shadow-none" size="sm" disabled={readOnly} onClick={onApply}><Sparkles /> {applyLabel}</Button>
      </footer>
    </div>
  );
}

function HtmlInteractionLibraryImpl({
  source,
  selection,
  scrollSections,
  readOnly = false,
  onSourceChange,
  onBack,
  onApplied,
  onBeginTargetPick,
  panelWidth,
  onOpenInsert,
}: HtmlInteractionLibraryProps) {
  const [activation, setActivation] = useState<ActivationFilter>('all');
  const [category, setCategory] = useState<(typeof CATEGORY_ORDER)[number]>('All');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<InteractionLibraryDraft | null>(null);
  const [error, setError] = useState('');
  const [panelSection, setPanelSection] = useState<LibraryPanelSection>('entrance');
  const panelRef = useRef<HTMLElement>(null);
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const panelMode = typeof panelWidth === 'number';
  const detailWidth = panelMode ? Math.max(310, Math.min(370, panelWidth + 42)) : 0;
  const items = useMemo(() => {
    const query = searchableLibraryText(search.trim());
    return INTERACTION_LIBRARY_CATALOG.filter(item => (
      (activation === 'all' || item.activation === activation)
      && (category === 'All' || item.category === category)
      && (
        !query
        || searchableLibraryText([
          item.name,
          item.description,
          item.category,
          ACTIVATION_META[item.activation].label,
          ACTIVATION_META[item.activation].description,
        ].join(' ')).includes(query)
      )
    ));
  }, [activation, category, search]);
  const visibleCategories = useMemo(() => CATEGORY_ORDER.filter(categoryFilter => (
    categoryFilter === 'All'
    || INTERACTION_LIBRARY_CATALOG.some(item => (
      (activation === 'all' || item.activation === activation)
      && item.category === categoryFilter
    ))
  )), [activation]);
  const groups = useMemo(() => (
    (activation === 'all' ? EFFECT_ACTIVATION_ORDER : [activation]).flatMap(groupActivation => {
      const groupItems = items.filter(item => item.activation === groupActivation);
      return groupItems.length ? [{ activation: groupActivation, items: groupItems }] : [];
    })
  ), [activation, items]);
  const chooseActivation = (nextActivation: ActivationFilter) => {
    setActivation(nextActivation);
    if (
      category !== 'All'
      && !INTERACTION_LIBRARY_CATALOG.some(item => (
        (nextActivation === 'all' || item.activation === nextActivation)
        && item.category === category
      ))
    ) setCategory('All');
  };
  const panelItems = useMemo(() => {
    const query = searchableLibraryText(search.trim());
    return INTERACTION_LIBRARY_CATALOG.filter(item => {
      const sectionMatch = Boolean(query) || panelSection === 'all'
        || (EFFECT_ACTIVATION_ORDER.includes(panelSection as InteractionLibraryActivation)
          ? item.activation === panelSection
          : item.category === panelSection);
      return sectionMatch && (!query || searchableLibraryText([
        item.name,
        item.description,
        item.category,
        ACTIVATION_META[item.activation].label,
      ].join(' ')).includes(query));
    });
  }, [panelSection, search]);
  const choosePanelSection = (nextSection: LibraryPanelSection) => {
    setPanelSection(nextSection);
    setSearch('');
    setDraft(null);
    setError('');
    requestAnimationFrame(() => {
      if (catalogScrollRef.current) catalogScrollRef.current.scrollTop = 0;
    });
  };
  const panelSectionCount = (section: LibraryPanelSection) => {
    if (section === 'all') return INTERACTION_LIBRARY_CATALOG.length;
    if (EFFECT_ACTIVATION_ORDER.includes(section as InteractionLibraryActivation)) {
      return INTERACTION_LIBRARY_CATALOG.filter(item => item.activation === section).length;
    }
    return INTERACTION_LIBRARY_CATALOG.filter(item => item.category === section).length;
  };
  const beginPanelEffect = (item: InteractionLibraryCatalogItem) => {
    if (readOnly) return;
    setDraft(createInteractionLibraryDraft(item.id, selection, scrollSections));
    setError('');
  };
  useEffect(() => {
    if (!panelMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (
        target instanceof Element
        && target.closest('[data-effects-panel-trigger], [data-slot="select-content"], [data-radix-popper-content-wrapper], [data-kodety-onboarding-ui]')
      ) return;
      onBack();
    };
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    };
  }, [onBack, panelMode]);

  if (panelMode) {
    const sectionMeta = panelSectionMeta(panelSection);
    const panelDraftItem = draft
      ? INTERACTION_LIBRARY_CATALOG.find(candidate => candidate.id === draft.effectId)
      : null;
    return (
      <section
        ref={panelRef}
        id="html-editor-effects-panel"
        data-interaction-effects-library
        data-kodety-onboarding="design-effects-panel"
        className="absolute inset-y-0 left-0 z-[80] grid min-h-0 overflow-hidden border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]"
        style={{ gridTemplateColumns: `${panelWidth}px ${detailWidth}px`, width: panelWidth + detailWidth }}
        aria-label="Effects Library"
      >
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-[var(--kodety-divider)] bg-[var(--kodety-panel)]">
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--kodety-divider)] px-3">
            <div>
              <h2 className="text-[12px] font-semibold tracking-[-0.01em] text-foreground">Effects Library</h2>
              <p className="text-[9px] leading-3 text-muted-foreground">Passe o mouse para visualizar</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onBack}
                  className="grid size-7 place-items-center rounded-[7px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.06] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.07] focus-visible:text-[var(--kodety-accent-hover)]"
                  aria-label="Fechar Effects Library"
                ><X className="size-3.5" /></button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-[120]">Fechar Effects Library</TooltipContent>
            </Tooltip>
          </header>

          <div className="shrink-0 space-y-2 border-b border-[var(--kodety-divider)] p-3">
            <div
              data-kodety-effects-search-control
              className="group/effects-search flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] hover:bg-white/[.065] focus-within:border-[var(--kodety-focus)]/70 focus-within:bg-white/[.065]"
            >
              <span className="grid w-8 shrink-0 place-items-center border-r border-white/[.055] bg-black/[.06] text-white/32 transition-colors group-focus-within/effects-search:text-[var(--kodety-accent-hover)]">
                <Search className="size-3.5" />
              </span>
              <Input
                data-kodety-effects-search-inner
                value={search}
                onChange={event => { setSearch(event.target.value); setDraft(null); setError(''); }}
                placeholder="Buscar efeitos…"
                className="h-full min-w-0 flex-1 !rounded-none !border-0 !bg-transparent px-2.5 text-[11px] !shadow-none !outline-none placeholder:text-white/30 focus-visible:!border-0 focus-visible:!shadow-none focus-visible:!outline-none focus-visible:!ring-0"
                autoFocus
                aria-label="Buscar na Effects Library"
              />
              {search && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => setSearch('')} className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] bg-black/[.05] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-accent-hover)]" aria-label="Limpar busca">
                      <X className="size-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="z-[120]">Limpar busca</TooltipContent>
                </Tooltip>
              )}
            </div>
            {onOpenInsert && (
              <button
                type="button"
                onClick={onOpenInsert}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] border border-transparent bg-white/[.035] px-2 text-left text-[10px] text-[var(--kodety-text-secondary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065]"
              >
                <Plus className="size-3.5" />
                <span className="flex-1">Alternar para Insert</span>
                <ChevronRight className="size-3" />
              </button>
            )}
          </div>

          <div className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
            <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">Momento</h3>
            <div className="space-y-0.5">
              {PANEL_MOMENT_SECTIONS.map(section => {
                const meta = panelSectionMeta(section);
                const Icon = PANEL_NAVIGATION_ICONS[section];
                const active = !search && panelSection === section;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => choosePanelSection(section)}
                    aria-current={active ? 'page' : undefined}
                    className={cn('group flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left text-[var(--kodety-text-secondary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065]', active && 'bg-white/[.075] text-[var(--kodety-text)]')}
                  >
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-[7px] bg-white/[.05] text-[var(--kodety-text-tertiary)] transition-[background-color,color] group-hover:bg-white/[.075] group-hover:text-[var(--kodety-text-secondary)]', active && 'bg-white/[.13] text-[var(--kodety-text)]')}>
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium leading-4">{meta.label}</span>
                      <span className="block truncate text-[9px] leading-3.5 text-muted-foreground">{meta.description}</span>
                    </span>
                    <span className="text-[9px] tabular-nums text-muted-foreground/70">{panelSectionCount(section)}</span>
                    <ChevronRight className="size-3 shrink-0 text-[var(--kodety-text-tertiary)] transition-[color,transform] group-aria-[current=page]:translate-x-0.5 group-aria-[current=page]:text-[var(--kodety-text-secondary)]" />
                  </button>
                );
              })}
            </div>
            <div className="my-3 border-t border-[var(--kodety-divider)]" />
            <h3 className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">Tipos</h3>
            <div className="space-y-0.5">
              {PANEL_TYPE_SECTIONS.map(section => {
                const meta = panelSectionMeta(section);
                const Icon = PANEL_NAVIGATION_ICONS[section];
                const active = !search && panelSection === section;
                return (
                  <button key={section} type="button" onClick={() => choosePanelSection(section)} aria-current={active ? 'page' : undefined} className={cn('group flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-1.5 text-left text-[var(--kodety-text-secondary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:bg-white/[.065]', active && 'bg-white/[.075] text-[var(--kodety-text)]')}>
                    <span className={cn('grid size-8 shrink-0 place-items-center rounded-[7px] bg-white/[.05] text-[var(--kodety-text-tertiary)] transition-[background-color,color] group-hover:bg-white/[.075] group-hover:text-[var(--kodety-text-secondary)]', active && 'bg-white/[.13] text-[var(--kodety-text)]')}>
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium leading-4">{meta.label}</span><span className="block truncate text-[9px] leading-3.5 text-muted-foreground">{meta.description}</span></span>
                    <span className="text-[9px] tabular-nums text-muted-foreground/70">{panelSectionCount(section)}</span>
                    <ChevronRight className="size-3 shrink-0 text-[var(--kodety-text-tertiary)] transition-[color,transform] group-aria-[current=page]:translate-x-0.5 group-aria-[current=page]:text-[var(--kodety-text-secondary)]" />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col bg-[var(--kodety-panel)]">
          {draft && panelDraftItem ? (
            <EffectWizard
              item={panelDraftItem}
              draft={draft}
              setDraft={update => {
                setError('');
                setDraft(current => {
                  if (!current) return current;
                  return typeof update === 'function'
                    ? (update as (value: InteractionLibraryDraft) => InteractionLibraryDraft)(current)
                    : update;
                });
              }}
              scrollSections={scrollSections}
              readOnly={readOnly}
              error={error}
              applyLabel="Aplicar efeito"
              onBack={() => { setDraft(null); setError(''); }}
              onPick={() => onBeginTargetPick(target => {
                setError('');
                setDraft(current => current ? retargetInteractionLibraryDraft(current, target) : current);
              })}
              onApply={() => {
                try {
                  const result = addInteractionFromLibrary(source, draft);
                  setError('');
                  onSourceChange(result.source);
                  onApplied(result.interaction);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar o efeito.');
                }
              }}
            />
          ) : (
            <>
              <header className="shrink-0 border-b border-[var(--kodety-divider)] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h2 className="truncate text-[12px] font-semibold text-foreground">{search ? 'Resultados' : sectionMeta.label}</h2><p className="mt-0.5 truncate text-[9px] leading-3.5 text-muted-foreground">{search ? `Correspondências para “${search.trim()}”` : sectionMeta.description}</p></div>
                  <span className="shrink-0 rounded-full bg-white/[.06] px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">{panelItems.length}</span>
                </div>
              </header>
              <div ref={catalogScrollRef} className="kodety-compact-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                {panelItems.length ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {panelItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={readOnly}
                        data-library-effect-card={item.id}
                        onClick={() => beginPanelEffect(item)}
                        className="group flex aspect-[1.04] min-h-[132px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-white/[.075] bg-white/[.04] text-left outline-none transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5 hover:border-white/[.13] hover:bg-white/[.065] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.065] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transform-none"
                      >
                        <span className="block min-h-0 flex-1 border-b border-[var(--kodety-divider)] bg-black/[.08]"><EffectPreview item={item} /></span>
                        <span className="block shrink-0 px-3 py-2.5"><span className="block truncate text-[11px] font-medium text-foreground">{item.name}</span><span className="mt-0.5 block line-clamp-2 text-[9px] leading-3.5 text-muted-foreground">{item.description}</span></span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid h-full min-h-40 place-items-center text-center"><div><Search className="mx-auto size-5 text-muted-foreground/45" /><p className="mt-2 text-[10px] font-medium">Nenhum efeito encontrado</p><button type="button" className="mt-2 text-[9px] text-[var(--kodety-accent-hover)] hover:text-[var(--kodety-accent-hover)]" onClick={() => { setSearch(''); setPanelSection('all'); }}>Limpar busca</button></div></div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }
  if (draft) {
    const item = INTERACTION_LIBRARY_CATALOG.find(candidate => candidate.id === draft.effectId)!;
    return (
      <EffectWizard
        item={item}
        draft={draft}
        setDraft={update => {
          setError('');
          setDraft(current => {
            if (!current) return current;
            return typeof update === 'function'
              ? (update as (value: InteractionLibraryDraft) => InteractionLibraryDraft)(current)
              : update;
          });
        }}
        scrollSections={scrollSections}
        readOnly={readOnly}
        error={error}
        applyLabel="Aplicar efeito"
        onBack={() => { setDraft(null); setError(''); }}
        onPick={() => onBeginTargetPick(target => {
          setError('');
          setDraft(current => (
            current ? retargetInteractionLibraryDraft(current, target) : current
          ));
        })}
        onApply={() => {
          try {
            const result = addInteractionFromLibrary(source, draft);
            setError('');
            onSourceChange(result.source);
            onApplied(result.interaction);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar o efeito.');
          }
        }}
      />
    );
  }
  return (
    <div data-interaction-effects-library data-kodety-onboarding="design-effects-panel" className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-10 items-center gap-2 border-b border-border/55 px-2">
        <button type="button" title="Voltar para interações" aria-label="Voltar para interações" onClick={onBack} className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground"><ChevronLeft className="size-3.5" /></button>
        <Sparkles className="size-3.5 text-[var(--kodety-accent-hover)]/80" />
        <span className="min-w-0 flex-1 text-[11px] font-medium">Effects Library</span>
        <span className="rounded-full border border-border/50 px-1.5 py-0.5 font-mono text-[7px] text-muted-foreground">{items.length}/{INTERACTION_LIBRARY_CATALOG.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <div className="space-y-3 border-b border-border/45 px-3 py-3">
          <label className="relative block">
            <span className="sr-only">Buscar efeitos</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              data-library-effect-search
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar efeitos…"
              className="h-8 rounded-[8px] pl-8 text-[9px]"
            />
          </label>
          <section>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <span>
                <span className="block text-[9px] font-medium text-foreground">Quando acontece?</span>
                <span className="block text-[8px] text-muted-foreground">Escolha pelo gatilho do efeito</span>
              </span>
            </div>
            <div data-library-activation-filters role="group" aria-label="Filtrar pelo momento da interação" className="grid grid-cols-2 gap-1.5">
              {ACTIVATION_ORDER.map(filter => {
                const meta = ACTIVATION_META[filter];
                const FilterIcon = meta.icon;
                const count = filter === 'all'
                  ? INTERACTION_LIBRARY_CATALOG.length
                  : INTERACTION_LIBRARY_CATALOG.filter(item => item.activation === filter).length;
                const selected = activation === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    data-library-activation-filter={filter}
                    aria-pressed={selected}
                    aria-label={`${meta.label}: ${meta.description}. ${count} efeitos`}
                    onClick={() => chooseActivation(filter)}
                    className={`${filter === 'all' ? 'col-span-2 min-h-8' : 'min-h-[52px]'} flex items-center gap-2 rounded-[8px] border px-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${selected ? meta.activeClass : 'border-border/50 bg-white/[.015] text-muted-foreground hover:border-border hover:bg-white/[.035] hover:text-foreground'}`}
                  >
                    <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] border ${meta.iconClass}`}><FilterIcon className="size-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9px] font-medium">{meta.label}</span>
                      <span className="block truncate text-[7px] opacity-70">{meta.description}</span>
                    </span>
                    <span className="font-mono text-[7px] opacity-65">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <span className="mb-1.5 block text-[9px] font-medium text-foreground">Tipo de efeito</span>
            <div data-library-category-filters role="group" aria-label="Filtrar pelo tipo de efeito" className="flex flex-wrap gap-1">
              {visibleCategories.map(categoryFilter => {
                const count = INTERACTION_LIBRARY_CATALOG.filter(item => (
                  (activation === 'all' || item.activation === activation)
                  && (categoryFilter === 'All' || item.category === categoryFilter)
                )).length;
                return (
                  <button
                    key={categoryFilter}
                    type="button"
                    data-library-category-filter={categoryFilter}
                    aria-pressed={category === categoryFilter}
                    onClick={() => setCategory(categoryFilter)}
                    className={`rounded-full border px-2 py-1 text-[8px] outline-none focus-visible:ring-1 focus-visible:ring-ring ${category === categoryFilter ? 'border-[var(--kodety-accent-hover)]/35 bg-[var(--kodety-accent)]/10 text-[var(--kodety-accent-hover)]' : 'border-border/45 text-muted-foreground hover:text-foreground'}`}
                  >{CATEGORY_LABELS[categoryFilter]} <span className="font-mono text-[7px] opacity-60">{count}</span></button>
                );
              })}
            </div>
          </section>
        </div>
        <div className="space-y-4 p-3">
          {groups.map(group => {
            const meta = ACTIVATION_META[group.activation];
            const GroupIcon = meta.icon;
            return (
              <section key={group.activation} data-library-activation={group.activation}>
                <div className="mb-1.5 flex min-h-7 items-center gap-2">
                  <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] border ${meta.iconClass}`}><GroupIcon className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-medium text-foreground">{meta.label}</span>
                    <span className="block text-[7px] text-muted-foreground">{meta.description}</span>
                  </span>
                  <span className="font-mono text-[7px] text-muted-foreground">{group.items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {group.items.map(item => {
                    const Icon = EFFECT_ICONS[item.id];
                    const itemActivation = ACTIVATION_META[item.activation];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={readOnly}
                        data-library-effect-card={item.id}
                        data-library-effect-activation={item.activation}
                        onClick={() => { setDraft(createInteractionLibraryDraft(item.id, selection, scrollSections)); setError(''); }}
                        className="group flex min-h-[76px] w-full items-center gap-2.5 rounded-[9px] border border-border/55 bg-white/[.018] p-2.5 text-left outline-none transition-colors hover:border-[var(--kodety-accent-hover)]/30 hover:bg-[var(--kodety-accent)]/[.045] focus-visible:border-[var(--kodety-focus)]/45 disabled:opacity-40"
                      >
                        <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border ${itemActivation.iconClass}`}><Icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground">{item.name}</span>
                            <span data-library-activation-badge={item.activation} className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[6px] font-medium ${itemActivation.badgeClass}`}>{itemActivation.label}</span>
                          </span>
                          <span className="mt-0.5 block text-[8px] leading-3 text-muted-foreground">{item.description}</span>
                          <span className="mt-1 block text-[7px] text-muted-foreground/65">{CATEGORY_LABELS[item.category]}</span>
                        </span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!items.length && (
            <div data-library-empty-state className="rounded-[9px] border border-dashed border-border/60 px-4 py-8 text-center">
              <Search className="mx-auto size-5 text-muted-foreground/45" />
              <p className="mt-2 text-[9px] font-medium text-foreground">Nenhum efeito encontrado</p>
              <p className="mt-1 text-[8px] leading-3.5 text-muted-foreground">Tente outro termo ou limpe os filtros.</p>
              <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => { setActivation('all'); setCategory('All'); setSearch(''); }}>Limpar filtros</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HtmlLibraryBehaviorSettings({
  interaction,
  source,
  selection,
  scrollSections,
  readOnly = false,
  onSourceChange,
  onBack,
  onUpdated,
  onBeginTargetPick,
}: HtmlLibraryBehaviorSettingsProps) {
  const [draft, setDraft] = useState(() => interactionLibraryDraftFromDefinition(interaction, selection));
  const [error, setError] = useState('');
  const interactionSignature = JSON.stringify(interaction);
  useEffect(() => {
    setDraft(current => interactionLibraryDraftFromDefinition(interaction, current.target));
    setError('');
  }, [interactionSignature]);
  const item = INTERACTION_LIBRARY_CATALOG.find(candidate => candidate.id === draft.effectId)
    || INTERACTION_LIBRARY_CATALOG.find(candidate => candidate.id === interaction.behavior?.kind);
  if (!item) return null;
  return (
    <EffectWizard
      item={item}
      draft={draft}
      setDraft={update => {
        setError('');
        setDraft(update);
      }}
      scrollSections={scrollSections}
      readOnly={readOnly}
      showEnabled
      error={error}
      applyLabel="Salvar configurações"
      onBack={onBack}
      onPick={() => onBeginTargetPick(target => {
        setError('');
        setDraft(current => retargetInteractionLibraryDraft(current, target));
      })}
      onApply={() => {
        try {
          const result = updateInteractionFromLibrary(source, interaction.id, draft);
          setError('');
          setDraft(current => interactionLibraryDraftFromDefinition(result.interaction, current.target));
          onSourceChange(result.source);
          onUpdated(result.interaction);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o efeito.');
        }
      }}
    />
  );
}

export const HtmlInteractionLibrary = memo(HtmlInteractionLibraryImpl);
