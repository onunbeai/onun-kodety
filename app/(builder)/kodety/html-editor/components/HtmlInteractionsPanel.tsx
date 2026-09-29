'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  ChevronLeft,
  CircleDot,
  Code2,
  Component,
  Copy,
  CornerUpLeft,
  Crosshair,
  Eye,
  Gauge,
  ImagePlay,
  Library,
  Monitor,
  MousePointer2,
  MousePointerClick,
  MoveVertical,
  Plus,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Variable,
  X,
  Zap,
} from '@/components/ui/gravity-icons';
import type { LucideIcon } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  VisualMeasurementControl,
  VisualSelectControl,
  type VisualStyleGlyph,
  type VisualStyleOption,
} from '@/app/(builder)/kodety/components/VisualStyleField';
import {
  INTERACTION_ACTION_CATALOG_FOCUS_PREFIX,
  addInteractionFromSavedPreset,
  addInteraction,
  customInteractionCodeBody,
  customInteractionCodeScaffold,
  ensureInteractionSelector,
  interactionMatchesSelection,
  interactionTriggerMatchesSelectionPath,
  interactionsInSelectionSubtree,
  readInteractionDocument,
  removeInteraction,
  updateInteraction,
  type InteractionDefinition,
  type InteractionActionKind,
  type InteractionBreakpoint,
  type InteractionReducedMotion,
  type SavedInteractionPreset,
  type InteractionTargetMode,
  type InteractionTrigger,
} from '@/lib/html-editor/interactions';
import type { SelectionSnapshot } from '@/lib/html-editor/types';
import {
  HtmlInteractionLibrary,
  HtmlLibraryBehaviorSettings,
} from './HtmlInteractionLibrary';

interface HtmlInteractionsPanelProps {
  source: string;
  selection: SelectionSnapshot;
  scrollSections?: Array<{ id: string; label: string }>;
  readOnly?: boolean;
  savedAnimations?: SavedInteractionPreset[];
  onSourceChange: (source: string) => void;
  onSaveAnimation?: (interaction: InteractionDefinition, name: string) => void;
  onRemoveSavedAnimation?: (presetId: string) => void;
  onOpenTimeline: (interactionId: string, actionId?: string) => void;
  onBeginTargetPick: (onPick: (selection: SelectionSnapshot) => void) => void;
  onOpenEffectsLibrary?: () => void;
}

const TRIGGERS: Array<{ value: InteractionTrigger; label: string; hint: string; defaultName: string; icon: LucideIcon }> = [
  { value: 'click', label: 'Clique', hint: 'Clique ou toque', defaultName: 'Click', icon: MousePointerClick },
  { value: 'click-start', label: 'Pressionar', hint: 'Ao pressionar', defaultName: 'Click Start', icon: MousePointerClick },
  { value: 'appear', label: 'Ao aparecer', hint: 'Primeira entrada', defaultName: 'Appear', icon: Eye },
  { value: 'mouse-enter', label: 'Cursor entra', hint: 'Entrada do cursor', defaultName: 'Mouse Enter', icon: CornerUpLeft },
  { value: 'mouse-leave', label: 'Cursor sai', hint: 'Saída do cursor', defaultName: 'Mouse Leave', icon: CornerUpLeft },
  { value: 'hover', label: 'Ao passar', hint: 'Entrada e saída', defaultName: 'Hover', icon: CornerUpLeft },
  { value: 'mouse-move', label: 'Movimento', hint: 'Segue o cursor', defaultName: 'Mouse move', icon: MousePointer2 },
  { value: 'load', label: 'Ao carregar', hint: 'Página pronta', defaultName: 'Page load', icon: Eye },
  { value: 'scroll', label: 'Rolagem', hint: 'Entrada ou progresso', defaultName: 'Scroll', icon: MoveVertical },
  { value: 'custom', label: 'Evento', hint: 'Evento JavaScript', defaultName: 'Custom event', icon: Code2 },
];

const TARGET_MODE_LABELS: Record<InteractionTargetMode, string> = {
  element: 'Elemento',
  class: 'Classe',
  selector: 'Seletor',
};

const triggerMeta = (trigger: InteractionTrigger) => TRIGGERS.find(item => item.value === trigger) || TRIGGERS[0];
const interactionUsesDefaultName = (interaction: InteractionDefinition) => (
  interaction.name.trim() === `${triggerMeta(interaction.trigger).defaultName} interaction`
  || interaction.name.trim() === `${triggerMeta(interaction.trigger).label} interaction`
);
const interactionDisplayName = (interaction: InteractionDefinition) => {
  return interactionUsesDefaultName(interaction) ? triggerMeta(interaction.trigger).label : interaction.name;
};
let actionCatalogFocusSequence = 0;

const TRIGGER_OPTIONS: VisualStyleOption[] = TRIGGERS.map(({ icon: Icon, ...item }) => ({
  value: item.value,
  label: item.label,
  description: item.hint,
  icon: <Icon className="size-3.5" />,
}));

const HOVER_IN_OPTIONS: VisualStyleOption[] = [
  { value: 'restart', label: 'Reiniciar' },
  { value: 'play', label: 'Reproduzir' },
];

const HOVER_OUT_OPTIONS: VisualStyleOption[] = [
  { value: 'reverse', label: 'Reverter' },
  { value: 'reset', label: 'Redefinir' },
  { value: 'pause', label: 'Pausar' },
  { value: 'none', label: 'Nenhuma ação' },
];

const CLICK_ACTION_OPTIONS: VisualStyleOption[] = [
  { value: 'toggle', label: 'Alternar sentido' },
  { value: 'restart', label: 'Reiniciar' },
  { value: 'play', label: 'Reproduzir' },
  { value: 'reverse', label: 'Reverter' },
];

const MOUSE_AXIS_OPTIONS: VisualStyleOption[] = [
  { value: 'both', label: 'Ambos os eixos' },
  { value: 'x', label: 'Horizontal (X)' },
  { value: 'y', label: 'Vertical (Y)' },
];

const REDUCED_MOTION_OPTIONS: VisualStyleOption[] = [
  { value: 'end', label: 'Finalizar', description: 'Mostra o estado final sem reproduzir' },
  { value: 'skip', label: 'Pular', description: 'Não executa esta interação' },
  { value: 'allow', label: 'Permitir', description: 'Mantém o movimento mesmo com redução ativa' },
];

const ACTION_KIND_META: Record<InteractionActionKind, { label: string; icon: LucideIcon }> = {
  animate: { label: 'Animar', icon: Sparkles },
  set: { label: 'Definir', icon: Zap },
  'class-add': { label: 'Adicionar classe', icon: Braces },
  'class-remove': { label: 'Remover classe', icon: Braces },
  'class-toggle': { label: 'Alternar classe', icon: Braces },
  variable: { label: 'Variável', icon: Variable },
  'component-variant': { label: 'Variante', icon: Component },
  lottie: { label: 'Lottie', icon: ImagePlay },
  rive: { label: 'Rive', icon: Gauge },
  spline: { label: 'Spline', icon: CircleDot },
  event: { label: 'Evento', icon: Code2 },
};

const BREAKPOINTS: Array<{ value: InteractionBreakpoint; label: string; icon: LucideIcon }> = [
  { value: 'desktop', label: 'PC', icon: Monitor },
  { value: 'tablet', label: 'Tablet', icon: Tablet },
  { value: 'mobile', label: 'Mobile', icon: Smartphone },
];

function LooseIconButton({ title, danger = false, disabled = false, onClick, children }: { title: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          disabled={disabled}
          onClick={onClick}
          className={danger
            ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-transparent text-[var(--kodety-text-tertiary)] outline-none transition-[border-color,background-color,color] motion-reduce:transition-none hover:bg-[var(--kodety-danger)]/[.08] hover:text-[var(--kodety-danger)] focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:opacity-30'
            : 'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-transparent text-[var(--kodety-text-tertiary)] outline-none transition-[border-color,background-color,color] motion-reduce:transition-none hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:opacity-30'}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}

function DecimalSettingInput({
  value,
  disabled,
  onCommit,
  glyph = 'value',
  suffix,
  step = 0.01,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
  glyph?: VisualStyleGlyph;
  suffix?: string;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelBlur = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  const commit = (candidate: string) => {
    const parsed = Number(candidate.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = Math.max(0, parsed);
    setDraft(String(normalized));
    onCommit(normalized);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:pointer-events-none disabled:opacity-45">
      <div
        onFocusCapture={() => { editing.current = true; }}
        onBlurCapture={event => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          editing.current = false;
          if (cancelBlur.current) {
            cancelBlur.current = false;
            setDraft(String(value));
            return;
          }
          commit(draft);
        }}
        onKeyDownCapture={event => {
          if (!(event.target instanceof HTMLInputElement)) return;
          if (event.key === 'Enter') event.target.blur();
          if (event.key === 'Escape') {
            cancelBlur.current = true;
            setDraft(String(value));
            event.target.blur();
          }
        }}
      >
        <VisualMeasurementControl
          glyph={glyph}
          value={draft}
          suffix={suffix}
          min={0}
          step={step}
          ariaLabel="Valor numérico"
          onChange={candidate => {
            const next = candidate.replace(/\s/g, '');
            if (!/^\d*(?:[.,]\d*)?$/.test(next)) return;
            setDraft(next);
            if (/^\d+(?:[.,]\d+)?$/.test(next)) {
              onCommit(Math.max(0, Number(next.replace(',', '.'))));
            }
          }}
        />
      </div>
    </fieldset>
  );
}

function TriggerChooser({
  readOnly,
  savedAnimations,
  onChoose,
  onApplySaved,
  onRemoveSaved,
  onOpenLibrary,
}: {
  readOnly: boolean;
  savedAnimations: SavedInteractionPreset[];
  onChoose: (trigger: InteractionTrigger) => void;
  onApplySaved: (preset: SavedInteractionPreset) => void;
  onRemoveSaved: (presetId: string) => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div data-interaction-trigger-chooser className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar">
      <div className="px-3 pb-2 pt-3">
        <h3 className="text-[11px] font-semibold leading-4 text-[var(--kodety-text)]">Como iniciar?</h3>
        <p className="text-[9px] leading-3.5 text-[var(--kodety-info-copy)]">Escolha um gatilho ou comece por um efeito.</p>
      </div>
      <button
        type="button"
        data-effects-panel-trigger
        aria-label="Biblioteca de efeitos"
        disabled={readOnly}
        onClick={onOpenLibrary}
        className="group mx-3 mb-2 flex h-10 min-w-0 items-center gap-2 rounded-[8px] border border-transparent bg-white/[.035] px-2 text-left outline-none transition-[background-color,border-color] hover:bg-white/[.06] focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)]">
          <Sparkles className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-medium text-[var(--kodety-text)]">Efeitos</span>
          <span className="block truncate text-[8px] leading-3 text-[var(--kodety-info-copy)]">Predefinições prontas</span>
        </span>
        <span className="text-[8px] text-[var(--kodety-accent-hover)]">Explorar</span>
      </button>
      {savedAnimations.length > 0 && (
        <section data-saved-animation-library className="mx-3 mb-2 overflow-hidden rounded-[8px] border border-white/[.055] bg-white/[.018]">
          <div className="flex h-8 items-center justify-between border-b border-white/[.055] px-2">
            <span className="text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--kodety-text-tertiary)]">Animações salvas</span>
            <span className="font-mono text-[8px] tabular-nums text-[var(--kodety-text-disabled)]">{savedAnimations.length}</span>
          </div>
          <div className="divide-y divide-white/[.045]">
            {savedAnimations.map(preset => {
              const meta = triggerMeta(preset.definition.trigger);
              const Icon = meta.icon;
              return (
                <div key={preset.id} className="group flex h-9 min-w-0 items-center">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => onApplySaved(preset)}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left outline-none transition-colors hover:bg-white/[.035] focus-visible:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Copy className="size-3 shrink-0 text-[var(--kodety-accent-hover)]/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9px] font-medium text-[var(--kodety-text-secondary)]">{preset.name}</span>
                      <span className="flex items-center gap-1 truncate text-[7px] text-[var(--kodety-text-tertiary)]"><Icon className="size-2.5 shrink-0" />{meta.label} · {preset.definition.actions.length} {preset.definition.actions.length === 1 ? 'ação' : 'ações'}</span>
                    </span>
                  </button>
                  <LooseIconButton
                    title={`Excluir animação salva ${preset.name}`}
                    danger
                    disabled={readOnly}
                    onClick={() => onRemoveSaved(preset.id)}
                  >
                    <Trash2 className="size-3 opacity-70" />
                  </LooseIconButton>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div data-interaction-trigger-grid className="mx-3 grid grid-cols-2 gap-1">
        {TRIGGERS.map(({ value, label, hint, icon: Icon }) => (
          <button
            key={value}
            type="button"
            disabled={readOnly}
            onClick={() => onChoose(value)}
            className="group flex h-[42px] w-full min-w-0 items-center gap-1.5 rounded-[8px] border border-transparent bg-white/[.025] px-1.5 text-left outline-none transition-[background-color,border-color] motion-reduce:transition-none hover:bg-white/[.05] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:bg-white/[.045] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-white/[.04] text-[var(--kodety-text-tertiary)] transition-colors group-hover:bg-white/[.065] group-hover:text-[var(--kodety-text-secondary)]">
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[9px] font-medium leading-3 text-[var(--kodety-text-secondary)]">{label}</span>
              <span className="block truncate text-[7px] leading-3 text-[var(--kodety-text-tertiary)]">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mx-3 mb-3 mt-2 flex items-center gap-1.5 border-t border-[var(--kodety-divider)] pt-2 text-[8px] leading-3 text-[var(--kodety-info-copy)]">
        <Code2 className="size-3 shrink-0" />
        <span className="truncate">Animações no código permanecem separadas.</span>
      </div>
    </div>
  );
}

function InteractionRow({ interaction, nested, canRemove, readOnly, onOpen, onToggle, onRemove }: { interaction: InteractionDefinition; nested?: boolean; canRemove: boolean; readOnly: boolean; onOpen: () => void; onToggle: (enabled: boolean) => void; onRemove: () => void }) {
  const meta = triggerMeta(interaction.trigger);
  const Icon = meta.icon;
  const displayName = interactionDisplayName(interaction);
  return (
    <div className="group flex h-11 min-w-0 items-center border-b border-white/[.05] bg-transparent transition-colors last:border-b-0 hover:bg-white/[.025] focus-within:bg-white/[.03]">
      <button type="button" data-kodety-onboarding="interaction-open-existing" data-kodety-onboarding-reveal onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left outline-none focus-visible:shadow-[inset_2px_0_0_var(--kodety-focus)]">
        <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-white/[.035] text-[var(--kodety-text-tertiary)] transition-colors group-hover:text-[var(--kodety-text-secondary)]">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-medium leading-3.5 text-[var(--kodety-text-secondary)]" title={displayName}>{displayName}</span>
          <span className="block truncate text-[8px] leading-3 text-[var(--kodety-text-tertiary)]">
            {nested ? 'Em um elemento filho · ' : ''}
            {interaction.behavior
              ? `Biblioteca · ${meta.label}`
              : interaction.actions.length
              ? `${interaction.actions.length} ${interaction.actions.length === 1 ? 'ação' : 'ações'} · ${interaction.trigger === 'scroll' && interaction.scrollTriggerSelector ? interaction.scrollTriggerLabel : interaction.triggerLabel}`
              : 'Sem ações'}
          </span>
        </span>
      </button>
      <div className="flex h-full shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="grid h-full w-8 place-items-center">
              <Switch
                size="sm"
                checked={interaction.enabled}
                disabled={readOnly}
                onCheckedChange={onToggle}
                aria-label={`${interaction.enabled ? 'Desativar' : 'Ativar'} ${displayName}`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{interaction.enabled ? 'Desativar interação' : 'Ativar interação'}</TooltipContent>
        </Tooltip>
        <span className="grid h-full w-8 place-items-center border-l border-white/[.045]">
        <LooseIconButton
          title={!canRemove
            ? 'Selecione o gatilho original para remover a interação inteira'
            : 'Remover interação'}
          danger
          disabled={readOnly || !canRemove}
          onClick={onRemove}
        >
          <Trash2 className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
        </LooseIconButton>
        </span>
      </div>
    </div>
  );
}

function InteractionSettings({
  interaction,
  selection,
  selectionIsTrigger,
  source,
  onSourceChange,
  onOpenTimeline,
  onBack,
  onBeginTargetPick,
  onSaveAnimation,
  readOnly,
  scrollSections,
}: {
  interaction: InteractionDefinition;
  selection: SelectionSnapshot;
  selectionIsTrigger: boolean;
  source: string;
  onSourceChange: (source: string) => void;
  onOpenTimeline: (actionId?: string) => void;
  onBack: () => void;
  onBeginTargetPick: HtmlInteractionsPanelProps['onBeginTargetPick'];
  onSaveAnimation?: HtmlInteractionsPanelProps['onSaveAnimation'];
  readOnly: boolean;
  scrollSections: Array<{ id: string; label: string }>;
}) {
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(interaction.name);
  useEffect(() => {
    setSaveOpen(false);
    setSaveName(interaction.name);
  }, [interaction.id]);
  const patch = (changes: Partial<InteractionDefinition>) => {
    if (readOnly) return;
    onSourceChange(updateInteraction(source, interaction.id, item => ({ ...item, ...changes })));
  };
  const changeTrigger = (trigger: InteractionTrigger) => {
    const changes: Partial<InteractionDefinition> = { trigger };
    if (interactionUsesDefaultName(interaction)) {
      changes.name = `${triggerMeta(trigger).defaultName} interaction`;
    }
    patch(changes);
  };
  const changeTargetMode = (mode: InteractionTargetMode) => {
    if (readOnly) return;
    if (mode === 'selector') {
      patch({ triggerTargetMode: 'selector' });
      return;
    }
    if (!selectionIsTrigger) return;
    const resolved = ensureInteractionSelector(source, selection.path, selection, mode);
    onSourceChange(updateInteraction(resolved.source, interaction.id, item => ({
      ...item,
      triggerSelector: resolved.selector,
      triggerLabel: resolved.label,
      triggerTargetMode: resolved.mode,
    })));
  };
  const pickTrigger = () => {
    if (readOnly) return;
    onBeginTargetPick(picked => {
      const currentSource = sourceRef.current;
      const resolved = ensureInteractionSelector(currentSource, picked.path, picked, 'element');
      onSourceChange(updateInteraction(resolved.source, interaction.id, item => ({
        ...item,
        triggerSelector: resolved.selector,
        triggerLabel: resolved.label,
        triggerTargetMode: 'element',
      })));
    });
  };
  const toggleBreakpoint = (breakpoint: InteractionBreakpoint) => {
    const selected = interaction.enabledBreakpoints.includes(breakpoint);
    patch({
      enabledBreakpoints: BREAKPOINTS
        .map(item => item.value)
        .filter(value => value !== breakpoint ? interaction.enabledBreakpoints.includes(value) : !selected),
    });
  };
  const displayName = interactionDisplayName(interaction);
  const usesDefaultName = interactionUsesDefaultName(interaction);
  const reducedMotionOption = REDUCED_MOTION_OPTIONS.find(option => option.value === interaction.reducedMotion);
  const scrollSectionOptions: VisualStyleOption[] = [
    { value: '__animated_element__', label: 'Este elemento', description: 'Usa o elemento animado como referência' },
    ...scrollSections.map(section => ({
      value: `[id="${section.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      label: `#${section.id}`,
      description: section.label && section.label !== section.id ? section.label : undefined,
    })),
  ];

  return (
    <div data-interaction-detail className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto no-scrollbar">
      <header data-interaction-detail-header className="sticky top-0 z-10 flex h-11 min-h-11 min-w-0 items-center border-y border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-2">
        <button
          type="button"
          onClick={onBack}
          title="Voltar para interações"
          className="group inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-transparent text-[var(--kodety-text-tertiary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.05] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:text-[var(--kodety-text)]"
          aria-label="Voltar para interações"
        >
          <ChevronLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />
        </button>
        <div className="ml-1 flex min-w-0 flex-1 items-center">
          <input
            value={usesDefaultName ? '' : interaction.name}
            placeholder={usesDefaultName ? displayName : undefined}
            title={displayName}
            aria-label="Nome da interação"
            disabled={readOnly}
            onChange={event => patch({ name: event.target.value })}
            className="h-7 min-w-0 flex-1 truncate rounded-[7px] border border-transparent bg-transparent px-1 text-[10px] font-medium text-[var(--kodety-text)] outline-none transition-[background-color,border-color] placeholder:text-[var(--kodety-text)] placeholder:opacity-100 hover:bg-white/[.025] focus:border-[var(--kodety-focus)]/65 focus:bg-white/[.035]"
          />
        </div>
        <div data-interaction-detail-actions className="ml-1.5 flex h-7 shrink-0 items-center gap-1 border-l border-[var(--kodety-divider)] pl-1.5">
          <button
            type="button"
            title={interaction.actions.length ? 'Salvar animação na biblioteca' : 'Adicione uma ação antes de salvar'}
            aria-label={interaction.actions.length ? 'Salvar animação na biblioteca' : 'Adicione uma ação antes de salvar'}
            disabled={readOnly || !onSaveAnimation || !interaction.actions.length}
            onClick={() => {
              setSaveName(displayName);
              setSaveOpen(true);
            }}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-transparent text-[var(--kodety-text-tertiary)] outline-none transition-[border-color,background-color,color] hover:bg-white/[.05] hover:text-[var(--kodety-text)] focus-visible:border-[var(--kodety-focus)]/70 disabled:cursor-not-allowed disabled:text-[var(--kodety-text-disabled)]"
          >
            <Library className="size-3.5" />
          </button>
          <Switch size="sm" disabled={readOnly} aria-label={interaction.enabled ? 'Desativar interação' : 'Ativar interação'} checked={interaction.enabled} onCheckedChange={enabled => patch({ enabled })} />
        </div>
      </header>

      {saveOpen && (
        <section data-save-animation-form className="border-b border-[var(--kodety-divider)] bg-white/[.018] px-3 py-2">
          <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[9px] font-medium text-[var(--kodety-text-secondary)]">Salvar como predefinição</p>
              <p className="truncate text-[7px] leading-3 text-[var(--kodety-info-copy)]">Gatilho e alvo podem mudar ao reutilizar.</p>
            </div>
            <LooseIconButton title="Cancelar" onClick={() => setSaveOpen(false)}>
              <X className="size-3" />
            </LooseIconButton>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <Input
              value={saveName}
              autoFocus
              aria-label="Nome da animação salva"
              onChange={event => setSaveName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') setSaveOpen(false);
                if (event.key === 'Enter' && saveName.trim()) {
                  onSaveAnimation?.(interaction, saveName.trim());
                  setSaveOpen(false);
                }
              }}
              className="h-8 min-w-0 flex-1 rounded-[8px] border-transparent bg-white/[.05] text-[10px] focus-visible:border-[var(--kodety-focus)]/65 focus-visible:ring-0"
            />
            <Button
              type="button"
              size="xs"
              variant="secondary"
              className="h-8 shrink-0 rounded-[8px] px-2.5 text-[9px]"
              disabled={!saveName.trim()}
              onClick={() => {
                onSaveAnimation?.(interaction, saveName.trim());
                setSaveOpen(false);
              }}
            >
              Salvar
            </Button>
          </div>
        </section>
      )}

      <section data-interaction-essentials className="space-y-3 border-b border-[var(--kodety-divider)] px-3 py-3.5">
        <div className="min-w-0 space-y-1.5">
          <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Gatilho</span>
          <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45">
            <VisualSelectControl
              value={interaction.trigger}
              options={TRIGGER_OPTIONS}
              onValueChange={value => changeTrigger(value as InteractionTrigger)}
              ariaLabel="Gatilho da interação"
              className="text-[10px]"
            />
          </fieldset>
        </div>
        <div data-interaction-trigger-target className="min-w-0 space-y-1.5">
          <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">{interaction.trigger === 'scroll' ? 'Elemento' : 'Alvo'}</span>
          <div className="flex h-8 min-w-0 overflow-hidden rounded-[8px] border border-transparent bg-white/[.05] transition-[border-color,background-color] focus-within:border-[var(--kodety-focus)]/65 focus-within:bg-white/[.065]">
            <input
              value={interaction.triggerTargetMode === 'selector' ? interaction.triggerSelector : interaction.triggerLabel}
              readOnly={interaction.triggerTargetMode !== 'selector'}
              disabled={readOnly}
              title={interaction.triggerTargetMode === 'selector' ? interaction.triggerSelector : interaction.triggerLabel}
              aria-label={interaction.triggerTargetMode === 'selector' ? 'Seletor do alvo' : 'Alvo da interação'}
              onChange={event => patch({ triggerSelector: event.target.value, triggerLabel: event.target.value || 'Seletor vazio' })}
              className={`h-full min-w-0 flex-1 bg-transparent px-2 text-[10px] text-[var(--kodety-text-secondary)] outline-none disabled:opacity-45 ${interaction.triggerTargetMode === 'selector' ? 'font-mono' : ''}`}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={pickTrigger}
                  aria-label="Selecionar alvo no canvas"
                  className="grid h-full w-8 shrink-0 place-items-center border-l border-white/[.055] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:bg-white/[.055] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.065] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Crosshair className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Selecionar no canvas</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="min-w-0 space-y-1.5">
          <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Vínculo</span>
          <div data-interaction-target-modes className="grid h-8 min-w-0 grid-cols-3 rounded-[8px] bg-white/[.05] p-0.5">
            {(['element', 'class', 'selector'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                disabled={
                  readOnly ||
                  (mode !== 'selector' && (
                    !selectionIsTrigger ||
                    (mode === 'class' && !selection.classes.length)
                  ))
                }
                onClick={() => changeTargetMode(mode)}
                aria-pressed={interaction.triggerTargetMode === mode}
                title={
                  mode !== 'selector' && !selectionIsTrigger
                    ? 'Escolha o gatilho com a mira para evitar um vínculo incorreto.'
                    : mode === 'class' && !selection.classes.length
                      ? 'Este elemento não possui classe'
                      : undefined
                }
                className={`min-w-0 truncate rounded-[6px] border border-transparent px-1 text-[8px] font-medium outline-none transition-[border-color,background-color,color] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-35 ${interaction.triggerTargetMode === mode ? 'bg-white/[.12] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.035] hover:text-[var(--kodety-text-secondary)]'} focus-visible:border-[var(--kodety-focus)]/65`}
              >
                {TARGET_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          {!selectionIsTrigger && (
            <p className="text-[8px] leading-3 text-[var(--kodety-info-copy)]">
              Esta interação usa outro gatilho. Use a mira para alterá-lo.
            </p>
          )}
        </div>
      </section>

      {(interaction.trigger === 'hover' || interaction.trigger === 'click') && (
        <section data-interaction-playback className="min-w-0 space-y-3 border-b border-[var(--kodety-divider)] px-3 py-3.5">
          {interaction.trigger === 'hover' ? <>
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Ao entrar</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualSelectControl value={interaction.hoverInAction} options={HOVER_IN_OPTIONS} onValueChange={value => patch({ hoverInAction: value as InteractionDefinition['hoverInAction'] })} ariaLabel="Ação ao passar o cursor" className="text-[10px]" /></fieldset>
            </div>
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Ao sair</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualSelectControl value={interaction.hoverOutAction} options={HOVER_OUT_OPTIONS} onValueChange={value => patch({ hoverOutAction: value as InteractionDefinition['hoverOutAction'] })} ariaLabel="Ação ao retirar o cursor" className="text-[10px]" /></fieldset>
            </div>
          </> : <>
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Ao clicar</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualSelectControl value={interaction.clickAction} options={CLICK_ACTION_OPTIONS} onValueChange={value => patch({ clickAction: value as InteractionDefinition['clickAction'] })} ariaLabel="Ação ao clicar" className="text-[10px]" /></fieldset>
            </div>
          </>}
        </section>
      )}

      {interaction.trigger === 'scroll' && (
        <section data-interaction-scroll-settings className="min-w-0 space-y-3 border-b border-[var(--kodety-divider)] px-3 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Referência</span>
            <fieldset data-scroll-section-trigger disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45">
              <VisualSelectControl
                value={interaction.scrollTriggerSelector || '__animated_element__'}
                options={scrollSectionOptions}
                onValueChange={value => {
                  if (value === '__animated_element__') {
                    patch({ scrollTriggerSelector: '', scrollTriggerLabel: 'Animated element' });
                    return;
                  }
                  const option = scrollSectionOptions.find(item => item.value === value);
                  patch({ scrollTriggerSelector: value, scrollTriggerLabel: option?.label || value });
                }}
                ariaLabel="Seção de referência da rolagem"
                className="text-[10px]"
              />
            </fieldset>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Início</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualMeasurementControl glyph="value" value={interaction.scrollStart} inputMode="text" ariaLabel="Início da rolagem" onChange={scrollStart => patch({ scrollStart })} className="font-mono text-[10px]" /></fieldset>
            </div>
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Fim</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualMeasurementControl glyph="value" value={interaction.scrollEnd} inputMode="text" ariaLabel="Fim da rolagem" onChange={scrollEnd => patch({ scrollEnd })} className="font-mono text-[10px]" /></fieldset>
            </div>
          </div>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Acompanhar progresso</span>
            <div className="flex h-8 items-center justify-between rounded-[8px] bg-white/[.05] px-2.5">
              <span className="text-[9px] text-[var(--kodety-text-secondary)]">Vincular à rolagem</span>
              <Switch size="sm" disabled={readOnly} checked={interaction.scrollScrub} onCheckedChange={scrollScrub => patch({ scrollScrub })} aria-label="Acompanhar progresso da rolagem" />
            </div>
          </div>
          {interaction.scrollScrub ? (
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Suavização</span>
              <DecimalSettingInput value={interaction.scrollSmoothing} disabled={readOnly} onCommit={scrollSmoothing => patch({ scrollSmoothing })} glyph="duration" suffix="s" />
            </div>
          ) : (
            <div className="min-w-0 space-y-1.5">
              <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Alternância</span>
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualMeasurementControl glyph="value" value={interaction.scrollToggleActions} inputMode="text" ariaLabel="Ações de alternância da rolagem" onChange={scrollToggleActions => patch({ scrollToggleActions })} className="font-mono text-[10px]" /></fieldset>
            </div>
          )}
        </section>
      )}

      {interaction.trigger === 'mouse-move' && (
        <section data-interaction-pointer-settings className="min-w-0 space-y-3 border-b border-[var(--kodety-divider)] px-3 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Eixo</span>
            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualSelectControl value={interaction.mouseMoveAxis} options={MOUSE_AXIS_OPTIONS} onValueChange={value => patch({ mouseMoveAxis: value as InteractionDefinition['mouseMoveAxis'] })} ariaLabel="Eixo do movimento" className="text-[10px]" /></fieldset>
          </div>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Suavização</span>
            <DecimalSettingInput value={interaction.mouseMoveSmoothing} disabled={readOnly} onCommit={mouseMoveSmoothing => patch({ mouseMoveSmoothing })} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Retorno</span>
            <div className="flex h-8 items-center justify-between rounded-[8px] bg-white/[.05] px-2.5">
              <span className="text-[9px] text-[var(--kodety-text-secondary)]">Voltar à posição inicial</span>
              <Switch size="sm" disabled={readOnly} checked={interaction.mouseMoveReverse} onCheckedChange={mouseMoveReverse => patch({ mouseMoveReverse })} aria-label="Retornar ao retirar o cursor" />
            </div>
          </div>
        </section>
      )}

      {interaction.trigger === 'custom' && (
        <section data-interaction-custom-settings className="min-w-0 space-y-3 border-b border-[var(--kodety-divider)] px-3 py-3.5">
          <div className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Evento</span>
            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45"><VisualMeasurementControl glyph="value" value={interaction.customEvent} inputMode="text" ariaLabel="Nome do evento" onChange={customEvent => patch({ customEvent })} className="font-mono text-[10px]" /></fieldset>
          </div>
          <div className="min-w-0" data-custom-interaction-code>
            <div className="mb-1.5 space-y-0.5">
              <p className="text-[9px] font-medium text-[var(--kodety-text-tertiary)]">Código da animação</p>
              <p className="text-[8px] leading-3 text-[var(--kodety-info-copy)]">Edite o corpo; alvo e evento permanecem sincronizados.</p>
            </div>
            <CodeEditor
              language="javascript"
              value={customInteractionCodeScaffold(interaction)}
              onValueChange={source => patch({
                customCode: customInteractionCodeBody(source, interaction.customCode),
              })}
              readOnly={readOnly}
              ariaLabel="Código da animação do evento personalizado"
              className="min-h-[160px] max-h-[260px] rounded-[8px] border-[var(--kodety-divider)] bg-black/20 text-[10px] leading-4"
            />
          </div>
        </section>
      )}

      <section data-interaction-availability className="border-b border-[var(--kodety-divider)] px-3 py-4">
        <div className="mb-3 space-y-0.5">
          <p className="text-[10px] font-medium leading-3.5 text-[var(--kodety-text-secondary)]">Disponibilidade</p>
          <p className="text-[8px] leading-3 text-[var(--kodety-info-copy)]">Defina os dispositivos e respeite as preferências do visitante.</p>
        </div>
        <div className="min-w-0 space-y-3">
          <div data-interaction-breakpoint-control className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Dispositivos</span>
              {interaction.enabledBreakpoints.length === 0 && (
                <span role="status" className="shrink-0 text-[8px] text-[var(--kodety-danger)]">Escolha ao menos um</span>
              )}
            </div>
            <div role="group" aria-label="Dispositivos da interação" className="grid h-8 min-w-0 grid-cols-3 gap-0.5 rounded-[8px] bg-white/[.05] p-0.5">
              {BREAKPOINTS.map(({ value, label, icon: BreakpointIcon }) => {
                const enabled = interaction.enabledBreakpoints.includes(value);
                return (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-pressed={enabled}
                        aria-label={`${enabled ? 'Desativar' : 'Ativar'} em ${label}`}
                        title={label}
                        onClick={() => toggleBreakpoint(value)}
                        className={`flex min-w-0 items-center justify-center gap-1.5 rounded-[6px] border border-transparent px-1 outline-none transition-[border-color,background-color,color] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? 'bg-white/[.12] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)] hover:bg-white/[.035] hover:text-[var(--kodety-text-secondary)]'} focus-visible:border-[var(--kodety-focus)]/65`}
                      >
                        <BreakpointIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        <span data-interaction-breakpoint-label className="min-w-0 truncate text-[8px] font-medium">{label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          <div data-interaction-reduced-motion-control className="min-w-0 space-y-1.5">
            <span className="block text-[9px] font-medium leading-3 text-[var(--kodety-text-tertiary)]">Movimento reduzido</span>
            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-45">
              <VisualSelectControl value={interaction.reducedMotion} options={REDUCED_MOTION_OPTIONS} onValueChange={value => patch({ reducedMotion: value as InteractionReducedMotion })} ariaLabel="Preferência de movimento reduzido" className="text-[10px]" />
            </fieldset>
            {reducedMotionOption?.description && (
              <p className="text-[8px] leading-3 text-[var(--kodety-info-copy)]">{reducedMotionOption.description}</p>
            )}
          </div>
        </div>
      </section>

      <section data-interaction-actions className="px-3 py-4">
        <div className="mb-2.5 flex h-7 items-center justify-between gap-2">
          <div className="min-w-0"><p className="text-[10px] font-medium text-[var(--kodety-text-secondary)]">Ações</p><p className="text-[8px] leading-3 text-[var(--kodety-info-copy)]">Linha do tempo</p></div>
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[.05] font-mono text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]">{interaction.actions.length}</span>
        </div>
        <div data-interaction-action-list className="overflow-hidden rounded-[8px] border border-[var(--kodety-divider)] bg-white/[.018]">
          {interaction.actions.length ? interaction.actions.map(action => {
            const actionMeta = ACTION_KIND_META[action.kind];
            const ActionIcon = actionMeta.icon;
            const actionEnd = action.start + action.duration;
            return (
              <button key={action.id} type="button" disabled={readOnly} onClick={() => onOpenTimeline(action.id)} title={`${action.name} · ${actionMeta.label}`} className="flex h-10 w-full min-w-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] px-2 text-left outline-none hover:bg-white/[.04] focus-visible:bg-white/[.055] disabled:cursor-not-allowed disabled:opacity-45">
                <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-white/[.04] text-[var(--kodety-text-tertiary)]"><ActionIcon className="size-3" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[9px] font-medium leading-3.5 text-[var(--kodety-text-secondary)]">{action.name}</span>
                  <span className="flex min-w-0 items-center gap-1 text-[8px] leading-3 text-[var(--kodety-text-tertiary)]">
                    <span className="min-w-0 flex-1 truncate">{actionMeta.label} · {action.target.label || 'Elemento do gatilho'}</span>
                    <span className="shrink-0 font-mono tabular-nums">{action.start.toFixed(2)}–{actionEnd.toFixed(2)}s</span>
                  </span>
                </span>
              </button>
            );
          }) : (
            <div className="flex h-9 items-center border-b border-[var(--kodety-divider)] px-2.5">
              <p className="text-[9px] text-[var(--kodety-text-tertiary)]">Nenhuma ação nesta interação</p>
            </div>
          )}
          <button
            type="button"
            data-add-interaction-action
            disabled={readOnly}
            onClick={() => {
              actionCatalogFocusSequence += 1;
              onOpenTimeline(
                `${INTERACTION_ACTION_CATALOG_FOCUS_PREFIX}${Date.now()}-${actionCatalogFocusSequence}`,
              );
            }}
            className="flex h-8 w-full min-w-0 items-center justify-center gap-1.5 px-2 text-[9px] font-medium text-[var(--kodety-text-secondary)] outline-none transition-colors hover:bg-white/[.04] hover:text-[var(--kodety-text)] focus-visible:bg-white/[.055] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="size-3 shrink-0" />
            <span className="min-w-0 truncate">Adicionar ação</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export function HtmlInteractionsPanel({
  source,
  selection,
  scrollSections = [],
  readOnly = false,
  savedAnimations = [],
  onSourceChange,
  onSaveAnimation,
  onRemoveSavedAnimation,
  onOpenTimeline,
  onBeginTargetPick,
  onOpenEffectsLibrary,
}: HtmlInteractionsPanelProps) {
  const document = useMemo(() => readInteractionDocument(source), [source]);
  const directlyMatchingInteractionIds = useMemo(
    () => new Set(
      document.interactions
        .filter(interaction => interactionMatchesSelection(interaction, selection, source))
        .map(interaction => interaction.id),
    ),
    [document.interactions, selection, source],
  );
  const matching = useMemo(() => {
    const exact = document.interactions.filter(interaction =>
      directlyMatchingInteractionIds.has(interaction.id));
    const subtree = selection.hasElementChildren
      ? interactionsInSelectionSubtree(
        source,
        document.interactions,
        selection.path,
      )
      : [];
    return Array.from(new Map(
      [...subtree, ...exact].map(interaction => [interaction.id, interaction]),
    ).values());
  }, [directlyMatchingInteractionIds, document.interactions, selection, source]);
  const matchingSignature = matching.map(interaction => interaction.id).join('\u0000');
  const availableScrollSections = useMemo(
    () => Array.from(new Map(scrollSections.filter(section => section.id).map(section => [section.id, section])).values()),
    [scrollSections],
  );
  const [mode, setMode] = useState<'list' | 'choose' | 'detail' | 'library'>(matching.length ? 'list' : 'choose');
  const [activeId, setActiveId] = useState<string | null>(null);
  const chooserRequested = useRef(false);
  const active = document.interactions.find(interaction => interaction.id === activeId) || null;

  useEffect(() => {
    if (activeId && !document.interactions.some(interaction => interaction.id === activeId)) {
      setActiveId(null);
      setMode(matching.length ? 'list' : 'choose');
    }
  }, [activeId, document.interactions, matching.length]);
  useEffect(() => {
    if (activeId || chooserRequested.current) return;
    setMode(matching.length ? 'list' : 'choose');
  }, [activeId, matching.length, matchingSignature]);
  useEffect(() => {
    chooserRequested.current = false;
    setActiveId(null);
    setMode(matching.length ? 'list' : 'choose');
  }, [selection.path]);

  const create = (trigger: InteractionTrigger) => {
    if (readOnly) return;
    const result = addInteraction(source, selection.path, selection, trigger, 'element');
    chooserRequested.current = false;
    onSourceChange(result.source);
    setActiveId(result.interaction.id);
    setMode('detail');
    onOpenTimeline(result.interaction.id);
  };
  const applySaved = (preset: SavedInteractionPreset) => {
    if (readOnly) return;
    const result = addInteractionFromSavedPreset(
      source,
      selection.path,
      selection,
      preset,
    );
    chooserRequested.current = false;
    onSourceChange(result.source);
    setActiveId(result.interaction.id);
    setMode('detail');
    onOpenTimeline(result.interaction.id);
  };
  const openEffectsLibrary = () => {
    if (onOpenEffectsLibrary) {
      onOpenEffectsLibrary();
      return;
    }
    setMode('library');
  };

  if (mode === 'detail' && active?.behavior) return (
    <HtmlLibraryBehaviorSettings
      interaction={active}
      source={source}
      selection={selection}
      scrollSections={availableScrollSections}
      readOnly={readOnly}
      onSourceChange={onSourceChange}
      onBack={() => { setActiveId(null); setMode('list'); }}
      onUpdated={interaction => setActiveId(interaction.id)}
      onBeginTargetPick={onBeginTargetPick}
    />
  );

  if (mode === 'detail' && active) return (
    <InteractionSettings
      interaction={active}
      selection={selection}
      selectionIsTrigger={interactionTriggerMatchesSelectionPath(
        source,
        active,
        selection.path,
      )}
      source={source}
      onSourceChange={onSourceChange}
      onOpenTimeline={actionId => onOpenTimeline(active.id, actionId)}
      onBack={() => { setActiveId(null); setMode('list'); }}
      onBeginTargetPick={onBeginTargetPick}
      onSaveAnimation={onSaveAnimation}
      readOnly={readOnly}
      scrollSections={availableScrollSections}
    />
  );

  if (mode === 'library') return (
    <HtmlInteractionLibrary
      source={source}
      selection={selection}
      scrollSections={availableScrollSections}
      readOnly={readOnly}
      onSourceChange={onSourceChange}
      onBack={() => setMode(matching.length ? 'list' : 'choose')}
      onApplied={interaction => {
        setActiveId(interaction.id);
        setMode(interaction.behavior ? 'detail' : 'list');
        if (!interaction.behavior) onOpenTimeline(interaction.id);
      }}
      onBeginTargetPick={onBeginTargetPick}
    />
  );

  if (mode === 'choose') return (
    <div className="flex min-h-0 flex-1 flex-col">
      {matching.length > 0 && (
        <button type="button" onClick={() => { chooserRequested.current = false; setMode('list'); }} className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] px-3 text-left text-[9px] text-[var(--kodety-text-tertiary)] outline-none transition-colors hover:text-[var(--kodety-text)] focus-visible:text-[var(--kodety-text)]"><ChevronLeft className="size-3.5" /> Voltar para interações</button>
      )}
      <TriggerChooser
        readOnly={readOnly}
        savedAnimations={savedAnimations}
        onChoose={create}
        onApplySaved={applySaved}
        onRemoveSaved={presetId => {
          if (!readOnly) onRemoveSavedAnimation?.(presetId);
        }}
        onOpenLibrary={openEffectsLibrary}
      />
    </div>
  );

  return (
    <div data-interaction-list className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
      <section className="px-3 py-3">
        <header className="mb-2 flex h-8 items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[10px] font-medium leading-3 text-[var(--kodety-text-secondary)]">Interações</h3>
            <p className="truncate text-[8px] leading-3 text-[var(--kodety-info-copy)]">Gatilhos deste elemento</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              type="button"
              data-effects-panel-trigger
              title="Biblioteca de efeitos"
              aria-label="Biblioteca de efeitos"
              disabled={readOnly}
              onClick={openEffectsLibrary}
              className="h-7 rounded-[7px] border border-transparent px-2 text-[9px] text-[var(--kodety-text-tertiary)] hover:bg-white/[.045] hover:text-[var(--kodety-text-secondary)] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:ring-0"
            ><Sparkles className="size-3 text-[var(--kodety-accent-hover)]/70" /> Efeitos</Button>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              title="Nova interação"
              aria-label="Nova interação"
              disabled={readOnly}
              onClick={() => { chooserRequested.current = true; setMode('choose'); }}
              className="size-7 rounded-[7px] border border-transparent text-[var(--kodety-text-tertiary)] hover:bg-white/[.045] hover:text-[var(--kodety-text-secondary)] focus-visible:border-[var(--kodety-focus)]/70 focus-visible:ring-0"
            ><Plus className="size-3.5" /></Button>
          </div>
        </header>
        <div className="overflow-hidden rounded-[8px] border border-[var(--kodety-divider)] bg-white/[.012]">
          {matching.map(interaction => {
            const canonical = document.interactions.find(
              candidate => candidate.id === interaction.id,
            ) || interaction;
            const nested = Boolean(
              selection.hasElementChildren
              && !directlyMatchingInteractionIds.has(interaction.id),
            );
            const selectionOwnsTrigger = interactionTriggerMatchesSelectionPath(
              source,
              canonical,
              selection.path,
            );
            return (
              <InteractionRow
                key={interaction.id}
                interaction={canonical}
                nested={nested}
                canRemove={selectionOwnsTrigger}
                readOnly={readOnly}
                onOpen={() => { setActiveId(interaction.id); setMode('detail'); }}
                onToggle={enabled => {
                  if (!readOnly) {
                    onSourceChange(updateInteraction(source, canonical.id, item => ({ ...item, enabled })));
                  }
                }}
                onRemove={() => {
                  if (!readOnly && selectionOwnsTrigger) {
                    onSourceChange(removeInteraction(source, interaction.id));
                  }
                }}
              />
            );
          })}
          {!matching.length && <div className="flex h-11 items-center justify-center px-3 text-center text-[9px] text-[var(--kodety-text-tertiary)]">Nenhuma interação.</div>}
        </div>
      </section>
    </div>
  );
}
