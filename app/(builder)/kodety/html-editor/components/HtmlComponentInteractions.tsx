'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Component,
  CornerUpLeft,
  Minus,
  MousePointerClick,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from '@/components/ui/gravity-icons';
import {
  addInteraction,
  createInteractionAction,
  interactionMatchesSelection,
  readInteractionDocument,
  removeInteraction,
  updateInteraction,
  type InteractionDefinition,
  type InteractionTrigger,
  type SavedInteractionPreset,
} from '@/lib/html-editor/interactions';
import {
  createHtmlComponentId,
  type HtmlComponentDefinition,
  type HtmlComponentInstanceContext,
} from '@/lib/html-editor/html-components';
import {
  inspectSourceElements,
  patchElementAttribute,
} from '@/lib/html-editor/source-patcher';
import type { SelectionSnapshot } from '@/lib/html-editor/types';
import { Button } from '../ycode-style/ui/button';
import { Input } from '../ycode-style/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ycode-style/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../ycode-style/ui/tabs';
import { HtmlInteractionsPanel } from './HtmlInteractionsPanel';

interface HtmlComponentInteractionsProps {
  component: HtmlComponentDefinition;
  instance?: HtmlComponentInstanceContext;
  activeVariantId?: string;
  /** Component state transitions always belong to the component root. */
  eventRootPath?: string;
  source: string;
  selection: SelectionSnapshot;
  readOnly?: boolean;
  savedAnimations?: SavedInteractionPreset[];
  onSourceChange: (source: string) => void;
  onSaveAnimation?: (interaction: InteractionDefinition, name: string) => void;
  onRemoveSavedAnimation?: (presetId: string) => void;
  onOpenTimeline: (interactionId: string, actionId?: string) => void;
  onBeginTargetPick: (onPick: (selection: SelectionSnapshot) => void) => void;
  onOpenEffectsLibrary?: () => void;
}

type ComponentEventTrigger = Extract<
  InteractionTrigger,
  'click' | 'click-start' | 'appear' | 'mouse-enter' | 'mouse-leave'
>;

const COMPONENT_EVENT_TRIGGERS: Array<{
  value: ComponentEventTrigger;
  label: string;
  hint: string;
}> = [
  { value: 'click', label: 'Click', hint: 'Ao clicar ou tocar' },
  { value: 'click-start', label: 'Click Start', hint: 'Ao pressionar o ponteiro' },
  { value: 'appear', label: 'Appear', hint: 'Na primeira entrada no viewport' },
  { value: 'mouse-enter', label: 'Mouse Enter', hint: 'Quando o cursor entrar' },
  { value: 'mouse-leave', label: 'Mouse Leave', hint: 'Quando o cursor sair' },
];

const componentEventTriggerLabel = (trigger: InteractionTrigger) => (
  COMPONENT_EVENT_TRIGGERS.find(option => option.value === trigger)?.label
  || (trigger === 'hover' ? 'Hover (legado)' : trigger)
);

const normalizedDelay = (value: number) => (
  Math.min(3_600, Math.max(0, Math.round(value * 10) / 10))
);

export function HtmlComponentInteractions({
  component,
  instance,
  activeVariantId,
  eventRootPath,
  source,
  selection,
  readOnly = false,
  savedAnimations = [],
  onSourceChange,
  onSaveAnimation,
  onRemoveSavedAnimation,
  onOpenTimeline,
  onBeginTargetPick,
  onOpenEffectsLibrary,
}: HtmlComponentInteractionsProps) {
  const currentVariantId = activeVariantId || instance?.variantId || component.variants[0]?.id || '';
  const firstAlternativeVariant = component.variants.find(
    variant => variant.id !== currentVariantId,
  )?.id || component.variants[0]?.id || '';
  const [tab, setTab] = useState<'variants' | 'actions'>('variants');
  const [trigger, setTrigger] = useState<ComponentEventTrigger>('click');
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [variantId, setVariantId] = useState(firstAlternativeVariant);
  const eventSelection = useMemo<SelectionSnapshot>(() => ({
    ...selection,
    path: eventRootPath || instance?.rootPath || selection.path,
  }), [eventRootPath, instance?.rootPath, selection]);

  useEffect(() => {
    setVariantId(current => component.variants.some(variant => variant.id === current)
      ? current
      : firstAlternativeVariant);
  }, [component.id, component.variants, firstAlternativeVariant]);

  const componentVariantActions = useMemo(() => {
    const document = readInteractionDocument(source);
    return document.interactions.flatMap(interaction => {
      if (!interactionMatchesSelection(interaction, eventSelection, source)) return [];
      return interaction.actions.flatMap(action => (
        action.kind === 'component-variant' && action.componentId === component.id
          ? [{ interaction, action }]
          : []
      ));
    });
  }, [component.id, eventSelection, source]);

  const addVariantEvent = () => {
    if (readOnly || !variantId) return;
    let eventSource = source;
    let eventSelectionWithIdentity = eventSelection;
    if (instance) {
      const nodes = inspectSourceElements(eventSource);
      const root = nodes.find(node => node.path === eventSelection.path);
      const currentInstanceId = root?.attributes['data-kodety-component-instance'] || '';
      const duplicateCount = currentInstanceId
        ? nodes.filter(node => (
            node.attributes['data-kodety-component-instance'] === currentInstanceId
          )).length
        : 0;
      if (!currentInstanceId || duplicateCount !== 1) {
        const reservedIds = new Set(nodes.flatMap(node => {
          const id = node.attributes['data-kodety-component-instance'] || '';
          return id ? [id] : [];
        }));
        let nextInstanceId = '';
        do nextInstanceId = createHtmlComponentId('instance');
        while (reservedIds.has(nextInstanceId));
        eventSource = patchElementAttribute(
          eventSource,
          eventSelection.path,
          'data-kodety-component-instance',
          nextInstanceId,
        );
        eventSelectionWithIdentity = {
          ...eventSelection,
          attributes: {
            ...eventSelection.attributes,
            'data-kodety-component-instance': nextInstanceId,
          },
        };
      }
    }
    const result = addInteraction(
      eventSource,
      eventSelectionWithIdentity.path,
      eventSelectionWithIdentity,
      trigger,
      'element',
    );
    const variant = component.variants.find(candidate => candidate.id === variantId);
    const action = {
      ...createInteractionAction('component-variant'),
      name: `Trocar para ${variant?.name || 'variante'}`,
      start: normalizedDelay(delaySeconds),
      componentId: component.id,
      componentVariantId: variantId,
    };
    const nextSource = updateInteraction(result.source, result.interaction.id, interaction => ({
      ...interaction,
      name: `${componentEventTriggerLabel(trigger)} → ${variant?.name || 'variante'}`,
      // Component state events are one-way. Legacy `hover`/toggle definitions
      // remain readable, while every event created by this panel leaves the
      // component in its selected target variant.
      clickAction: trigger === 'click' ? 'restart' : interaction.clickAction,
      actions: [action],
    }));
    onSourceChange(nextSource);
  };

  const removeVariantAction = (interaction: InteractionDefinition, actionId: string) => {
    if (readOnly) return;
    if (interaction.actions.length === 1) {
      onSourceChange(removeInteraction(source, interaction.id));
      return;
    }
    onSourceChange(updateInteraction(source, interaction.id, current => ({
      ...current,
      actions: current.actions.filter(action => action.id !== actionId),
    })));
  };

  return (
    <Tabs
      value={tab}
      onValueChange={value => setTab(value as typeof tab)}
      data-component-interactions
      className="min-h-0 flex-1 gap-0 overflow-hidden"
    >
      <div className="shrink-0 border-b border-border px-3 pb-3 pt-3">
        <div className="mb-3 flex items-start gap-2 px-0.5">
          <Component className="mt-0.5 size-4 shrink-0 text-white/48" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">Eventos de {component.name}</p>
            <p className="text-[10px] leading-4 text-muted-foreground">Troque variantes ou execute uma ação.</p>
          </div>
        </div>
        <TabsList className="grid h-9 w-full grid-cols-2 gap-0.5 rounded-[10px] bg-white/[.055] p-[3px]">
          <TabsTrigger
            value="variants"
            className="rounded-[7px] border-transparent shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 data-[state=active]:border-transparent data-[state=active]:bg-white/[.13] data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >Variantes</TabsTrigger>
          <TabsTrigger
            value="actions"
            className="rounded-[7px] border-transparent shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 data-[state=active]:border-transparent data-[state=active]:bg-white/[.13] data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >Outras ações</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="variants"
        className="min-h-0 overflow-y-auto px-3 py-4 no-scrollbar data-[state=inactive]:hidden"
      >
        <section data-component-variant-event-editor className="space-y-3">
          <label className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-[11px] font-medium text-foreground">
            <span>Gatilho</span>
            <Select
              value={trigger}
              onValueChange={value => setTrigger(value as ComponentEventTrigger)}
              disabled={readOnly}
            >
              <SelectTrigger data-component-event-trigger className="w-full">
                <SelectValue>{componentEventTriggerLabel(trigger)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_EVENT_TRIGGERS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex min-w-0 flex-col">
                      <span>{option.label}</span>
                      <span className="text-[9px] text-muted-foreground">{option.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div data-component-event-delay className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
            <p className="text-[11px] font-medium text-foreground">Atraso</p>
            <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center overflow-hidden rounded-lg bg-input">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Diminuir delay em 0,1 segundo"
                disabled={readOnly || delaySeconds <= 0}
                onClick={() => setDelaySeconds(current => normalizedDelay(current - 0.1))}
                className="size-8 rounded-none"
              >
                <Minus />
              </Button>
              <div className="relative min-w-0 border-x border-border/55">
                <Input
                  type="number"
                  min={0}
                  max={3_600}
                  step={0.1}
                  inputMode="decimal"
                  aria-label="Delay em segundos"
                  value={delaySeconds}
                  disabled={readOnly}
                  onChange={event => setDelaySeconds(normalizedDelay(Number(event.target.value) || 0))}
                  className="h-8 rounded-none border-0 pr-7 text-center tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[9px] text-muted-foreground">s</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Aumentar delay em 0,1 segundo"
                disabled={readOnly || delaySeconds >= 3_600}
                onClick={() => setDelaySeconds(current => normalizedDelay(current + 0.1))}
                className="size-8 rounded-none"
              >
                <Plus />
              </Button>
            </div>
          </div>

          <label className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-[11px] font-medium text-foreground">
            <span>Trocar para</span>
            <Select value={variantId} onValueChange={setVariantId} disabled={readOnly || !component.variants.length}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Selecione uma variante" /></SelectTrigger>
              <SelectContent>
                {component.variants.map(variant => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {variant.name}{variant.id === currentVariantId ? ' (atual)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <Button
            type="button"
            className="w-full"
            disabled={readOnly || !variantId || component.variants.length < 2}
            onClick={addVariantEvent}
          >
            <Plus /> Adicionar evento de variante
          </Button>
          {component.variants.length < 2 && (
            <p className="kodety-info-copy text-[10px] leading-4">
              Crie uma segunda variante para configurar a troca de estado.
            </p>
          )}
        </section>

        <section className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-medium text-foreground">Eventos configurados</p>
              <p className="text-[9px] text-muted-foreground">Cada evento mantém o componente na variante escolhida.</p>
            </div>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">
              {componentVariantActions.length}
            </span>
          </div>
          {componentVariantActions.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {componentVariantActions.map(({ interaction, action }) => {
                const targetVariant = component.variants.find(variant => variant.id === action.componentVariantId);
                const TriggerIcon = interaction.trigger === 'hover' ? CornerUpLeft : MousePointerClick;
                return (
                  <div
                    key={`${interaction.id}:${action.id}`}
                    className="flex min-h-11 items-center gap-2 border-b border-border px-2.5 last:border-b-0"
                  >
                    <TriggerIcon className="size-3.5 shrink-0 text-purple-300" />
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onOpenTimeline(interaction.id, action.id)}
                      className="min-w-0 flex-1 text-left outline-none disabled:cursor-not-allowed"
                    >
                      <span className="block truncate text-[10px] text-foreground">
                        {componentEventTriggerLabel(interaction.trigger)}
                        {' → '}{targetVariant?.name || 'Variante'}
                      </span>
                      <span className="block text-[9px] text-muted-foreground">
                        Delay {normalizedDelay(action.start)}s · Editar na timeline
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Editar evento na timeline"
                      disabled={readOnly}
                      onClick={() => onOpenTimeline(interaction.id, action.id)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remover evento de variante"
                      disabled={readOnly}
                      onClick={() => removeVariantAction(interaction, action.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-10 items-center gap-2 rounded-[8px] bg-white/[.025] px-2.5">
              <Sparkles className="size-3 shrink-0 text-muted-foreground/60" />
              <p className="text-[10px] text-muted-foreground">Nenhum evento de variante.</p>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => setTab('actions')}
          >
            <Sparkles /> Animar ou executar outra ação
          </Button>
        </section>
      </TabsContent>

      <TabsContent
        value="actions"
        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
      >
        <HtmlInteractionsPanel
          source={source}
          selection={selection}
          readOnly={readOnly}
          savedAnimations={savedAnimations}
          onSourceChange={onSourceChange}
          onSaveAnimation={onSaveAnimation}
          onRemoveSavedAnimation={onRemoveSavedAnimation}
          onOpenTimeline={onOpenTimeline}
          onBeginTargetPick={onBeginTargetPick}
          onOpenEffectsLibrary={onOpenEffectsLibrary}
        />
      </TabsContent>
    </Tabs>
  );
}
