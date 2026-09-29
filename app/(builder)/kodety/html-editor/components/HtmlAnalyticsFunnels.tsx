'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronRight,
  Code2,
  Crosshair,
  Download,
  Filter,
  FlaskConical,
  FormInput,
  Globe,
  Loader2,
  LockKeyhole,
  Mail,
  Maximize2,
  Minus,
  MousePointerClick,
  Plug,
  Plus,
  Route,
  Save,
  Trash2,
  Upload,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { getAdminNumberFormatter } from '@/lib/admin-ui-locale';
import {
  createAnalyticsId,
  createEmptyFunnel,
  funnelToInput,
  normalizeFunnelWindowMinutes,
  parseFunnelImport,
  serializeFunnelExport,
  validateFunnelInput,
  MAX_FUNNEL_WINDOW_MINUTES,
  type AnalyticsFilterOperator,
  type AnalyticsFunnel,
  type AnalyticsFunnelConnection,
  type AnalyticsFunnelFilter,
  type AnalyticsFunnelInput,
  type AnalyticsFunnelStep,
  type AnalyticsFunnelStepType,
  type AnalyticsPeriod,
  type AnalyticsTrackingTarget,
} from '@/lib/html-editor/analytics';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  AnalyticsEmptyState,
  AnalyticsPlanBanner,
  AnalyticsPageHeader,
  AnalyticsPeriodPicker,
  AnalyticsSectionHeader,
  AnalyticsSurface,
  useAnalyticsFeatureAccess,
  type AnalyticsFeatureAccess,
} from './HtmlAnalyticsUi';
import { HtmlSettingsFieldControl } from './HtmlProjectSettingsFieldControl';

export interface AnalyticsPageOption {
  /** Canonical project file used by the editor and A/B authoring. */
  path: string;
  /** Public pathname emitted by the runtime tracker (for example `/about/`). */
  runtimePath?: string;
  label: string;
}

export interface AnalyticsExperimentOption {
  id: string;
  name: string;
  variants: Array<{ id: string; name: string }>;
}

export interface AnalyticsEmailAutomationOptions {
  lists: Array<{ id: number; name: string }>;
}

function describeStep(step: AnalyticsFunnelStep) {
  if (step.type === 'page') return step.pagePath || 'Página não selecionada';
  if (step.type === 'click') return step.trackingId || 'Tracking ID não selecionado';
  if (step.type === 'submit') return step.trackingId || 'Formulário não selecionado';
  if (step.type === 'experiment') return `${step.experimentId || 'Teste não selecionado'}${step.variantId ? ` · ${step.variantId}` : ''}`;
  if (step.type === 'email') return step.emailAction === 'add-to-list'
    ? `Adicionar à lista #${step.emailListId || '—'}`
    : 'Cadastrar ou atualizar contato';
  if (step.type === 'webhook') {
    if (!step.webhookUrl) return step.webhookEndpoint
      ? `${step.webhookMethod || 'POST'} · ${step.webhookEndpoint}`
      : 'Endpoint não informado';
    try {
      return `${step.webhookMethod || 'POST'} · ${new URL(step.webhookUrl).host}`;
    } catch {
      return step.webhookUrl;
    }
  }
  return step.eventName || 'Evento não informado';
}

function formatCount(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : getAdminNumberFormatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

const FUNNEL_EMPTY_FIELD_CLASS = 'flex min-h-12 items-center rounded-[9px] bg-white/[.035] px-3.5 py-3 text-balance text-[9px] leading-4 text-[var(--kodety-info-copy)]';

function SummaryMetric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'default' | 'danger' }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium uppercase tracking-[.06em] text-[var(--kodety-text-disabled)]">{label}</p>
      <p className={`mt-1 truncate text-[18px] font-semibold tabular-nums ${tone === 'danger' ? 'text-[var(--kodety-warning)]' : 'text-[var(--kodety-text)]'}`} title={value}>{value}</p>
      {hint && <p className="truncate text-[9px] text-[var(--kodety-text-tertiary)]" title={hint}>{hint}</p>}
    </div>
  );
}

function FunnelVisualization({ funnel }: { funnel: AnalyticsFunnel }) {
  const results = funnel.results || [];
  const hasResults = results.length > 0;
  if (!funnel.steps.length) return (
    <div className="grid min-h-64 place-items-center border-y border-[var(--kodety-divider)] text-center">
      <div><Route className="mx-auto size-5 text-[var(--kodety-text-disabled)]" /><p className="mt-2 text-[11px] text-[var(--kodety-text-secondary)]">Adicione uma etapa para começar.</p></div>
    </div>
  );
  const visitorsFor = (id: string | undefined): number | null => {
    const found = results.find(result => result.stepId === id);
    return found ? found.visitors : null;
  };
  const firstVisitors = visitorsFor(funnel.steps[0]?.id) || 0;
  const lastVisitors = visitorsFor(funnel.steps[funnel.steps.length - 1]?.id) || 0;
  const overallRate = hasResults && firstVisitors > 0 ? (lastVisitors / firstVisitors) * 100 : null;
  // Biggest relative drop-off between consecutive steps — the weakest link.
  let biggestDropIndex = -1;
  let biggestDropPct = -1;
  for (let index = 1; index < funnel.steps.length; index += 1) {
    const previous = visitorsFor(funnel.steps[index - 1]?.id) ?? 0;
    const current = visitorsFor(funnel.steps[index]?.id) ?? 0;
    const pct = previous > 0 ? ((previous - current) / previous) * 100 : 0;
    if (previous > 0 && pct > biggestDropPct) {
      biggestDropPct = pct;
      biggestDropIndex = index;
    }
  }
  const formatPct = (value: number) => `${value.toFixed(1)}%`;
  return (
    <>
      {hasResults && (
        <section data-kodety-onboarding="analytics-funnel-results" className="grid grid-cols-2 gap-4 border-t border-[var(--kodety-divider)] py-4 sm:grid-cols-4" aria-label="Resumo do funil">
          <SummaryMetric label="Entraram" value={formatCount(firstVisitors)} hint={funnel.steps[0]?.name} />
          <SummaryMetric label="Converteram" value={formatCount(lastVisitors)} hint={funnel.steps[funnel.steps.length - 1]?.name} />
          <SummaryMetric label="Conversão geral" value={overallRate === null ? '—' : formatPct(overallRate)} hint="Última etapa ÷ primeira" />
          <SummaryMetric
            label="Maior abandono"
            value={biggestDropIndex < 0 ? '—' : formatPct(biggestDropPct)}
            hint={biggestDropIndex < 0 ? 'Sem quedas' : `${funnel.steps[biggestDropIndex - 1]?.name} → ${funnel.steps[biggestDropIndex]?.name}`}
            tone={biggestDropIndex >= 0 && biggestDropPct > 0 ? 'danger' : 'default'}
          />
        </section>
      )}
      <section className="border-y border-[var(--kodety-divider)] py-6" aria-label={`Etapas do funil ${funnel.name}`}>
        <div className="flex min-w-max items-stretch gap-3 overflow-x-auto pb-2">
          {funnel.steps.map((step, index) => {
            const result = results.find(item => item.stepId === step.id);
            const visitors = result?.visitors ?? null;
            const relativeWidth = hasResults && firstVisitors > 0 && result
              ? Math.max(30, (result.visitors / firstVisitors) * 100)
              : 100;
            const previousVisitors = index === 0 ? null : visitorsFor(funnel.steps[index - 1]?.id);
            const dropCount = previousVisitors !== null && visitors !== null ? Math.max(0, previousVisitors - visitors) : null;
            const dropPct = previousVisitors && previousVisitors > 0 && dropCount !== null ? (dropCount / previousVisitors) * 100 : null;
            const topPct = firstVisitors > 0 && visitors !== null ? (visitors / firstVisitors) * 100 : null;
            const isWeakest = index === biggestDropIndex && biggestDropPct > 0;
            return (
              <div key={step.id} className="flex items-center gap-3">
                <article className={`w-[min(260px,70vw)] rounded-md p-2 ${isWeakest ? 'bg-[var(--kodety-warning)]/[.08] ring-1 ring-[var(--kodety-warning)]/40' : ''}`}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[10px] font-medium text-[var(--kodety-text-secondary)]">{step.name}</span>
                    <span className="text-[16px] font-semibold tabular-nums text-[var(--kodety-text)]">{formatCount(visitors)}</span>
                  </div>
                  <div className="flex h-24 items-end border-b border-[var(--kodety-divider-strong)]">
                    {hasResults ? (
                      <div
                        className="min-h-2 bg-[var(--kodety-accent)] transition-[width,height] motion-reduce:transition-none"
                        style={{
                          height: `${Math.max(8, relativeWidth)}%`,
                          width: `${relativeWidth}%`,
                          opacity: Math.max(.35, 1 - index * .12),
                        }}
                      />
                    ) : (
                      <div className="w-full border-t border-dashed border-[var(--kodety-divider-strong)]" />
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-[var(--kodety-text-tertiary)]">
                    <span className="max-w-[55%] truncate" title={describeStep(step)}>{describeStep(step)}</span>
                    <span className="tabular-nums">
                      {hasResults && topPct !== null ? `${formatPct(topPct)} do topo` : (result?.conversionRate === null || result?.conversionRate === undefined ? 'Sem dados' : `${result.conversionRate.toFixed(1)}%`)}
                    </span>
                  </div>
                  {hasResults && index > 0 && dropCount !== null && (
                    <p className={`mt-1 flex items-center gap-1 text-[9px] tabular-nums ${isWeakest ? 'font-semibold text-[var(--kodety-warning)]' : 'text-[var(--kodety-text-disabled)]'}`}>
                      <ArrowDown className="size-2.5" />
                      {dropPct !== null ? `${formatPct(dropPct)} de abandono` : 'Sem base'}
                      <span className="text-[var(--kodety-text-disabled)]">({formatCount(dropCount)})</span>
                    </p>
                  )}
                </article>
                {index < funnel.steps.length - 1 && <ChevronRight className="size-4 shrink-0 text-[var(--kodety-text-disabled)]" />}
              </div>
            );
          })}
        </div>
        {!hasResults && <p className="mt-4 text-[10px] text-[var(--kodety-text-tertiary)]">O funil ainda não recebeu eventos no período selecionado.</p>}
      </section>
    </>
  );
}

const FUNNEL_NODE_WIDTH = 220;
const FUNNEL_NODE_HEIGHT = 116;
const FUNNEL_CONNECT_DRAG_THRESHOLD = 5;

interface FunnelConnectionDrag {
  pointerId: number;
  sourceStepId: string;
  startClientX: number;
  startClientY: number;
  point: { x: number; y: number };
  moved: boolean;
}

function FunnelNodeIcon({ type }: { type: AnalyticsFunnelStepType }) {
  if (type === 'page') return <Globe />;
  if (type === 'click') return <MousePointerClick />;
  if (type === 'submit') return <FormInput />;
  if (type === 'experiment') return <FlaskConical />;
  if (type === 'email') return <Mail />;
  if (type === 'webhook') return <Plug />;
  return <Code2 />;
}

function FunnelCanvas({
  funnel,
  experiments,
  emailOptions,
  selectedStepId,
  selectedConnectionId,
  onSelectStep,
  onSelectConnection,
  onChange,
}: {
  funnel: AnalyticsFunnel;
  experiments: AnalyticsExperimentOption[];
  emailOptions: AnalyticsEmailAutomationOptions;
  selectedStepId: string | null;
  selectedConnectionId: string | null;
  onSelectStep: (id: string | null) => void;
  onSelectConnection: (id: string | null) => void;
  onChange: (value: AnalyticsFunnelInput) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const input = funnel as AnalyticsFunnelInput;
  const canvas = input.canvas || { x: 0, y: 0, zoom: 1 };
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<FunnelConnectionDrag | null>(null);
  const [connectionTargetId, setConnectionTargetId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const connectionDragRef = useRef<FunnelConnectionDrag | null>(null);
  const pointerInsideRef = useRef(false);
  const panRef = useRef<null | { pointerId: number; x: number; y: number; originX: number; originY: number }>(null);
  const dragRef = useRef<null | { pointerId: number; stepId: string; x: number; y: number; originX: number; originY: number }>(null);
  const results = new Map((funnel.results || []).map(result => [result.stepId, result]));
  const connectionResults = new Map((funnel.connectionResults || []).map(result => [result.connectionId, result]));
  const updateCanvas = (next: Partial<AnalyticsFunnelInput['canvas']>) => onChange({
    ...input,
    canvas: { ...canvas, ...next },
  });
  useEffect(() => {
    const editableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || !pointerInsideRef.current || editableTarget(event.target)) return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      setSpacePressed(false);
    };
    const blur = () => {
      setSpacePressed(false);
      panRef.current = null;
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const canvasPoint = (clientX: number, clientY: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (bounds?.left || 0) - canvas.x) / canvas.zoom,
      y: (clientY - (bounds?.top || 0) - canvas.y) / canvas.zoom,
    };
  };
  const addNode = (type: AnalyticsFunnelStepType) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const centerX = ((bounds?.width || 720) / 2 - canvas.x) / canvas.zoom - FUNNEL_NODE_WIDTH / 2;
    const centerY = ((bounds?.height || 520) / 2 - canvas.y) / canvas.zoom - FUNNEL_NODE_HEIGHT / 2;
    const id = createAnalyticsId('step');
    const experiment = experiments[0];
    const step: AnalyticsFunnelStep = {
      id,
      name: type === 'page'
        ? 'Nova página'
        : type === 'click'
          ? 'Novo clique'
          : type === 'submit'
            ? 'Novo formulário'
            : type === 'experiment'
              ? 'Exposição A/B'
              : type === 'email'
                ? 'Ação de email'
                : type === 'webhook'
                  ? 'Disparar webhook'
                  : 'Novo evento',
      type,
      position: { x: centerX, y: centerY },
      ...(type === 'page' ? { pagePath: '/' } : {}),
      ...(type === 'custom' ? { eventName: '' } : {}),
      ...(type === 'experiment' && experiment ? { experimentId: experiment.id } : {}),
      ...(type === 'email' ? { emailAction: 'upsert-contact', emailField: 'email', nameField: 'name' } : {}),
      ...(type === 'webhook' ? {
        webhookUrl: '',
        webhookMethod: 'POST',
        webhookPayloadMode: 'submission',
        webhookEvent: 'form.submitted',
        webhookSecret: '',
        webhookSecretConfigured: false,
        webhookSecretClear: false,
      } : {}),
    };
    onChange({ ...input, steps: [...input.steps, step] });
    onSelectStep(id);
    onSelectConnection(null);
  };
  const connectSteps = (sourceStepId: string, targetStepId: string) => {
    if (sourceStepId === targetStepId) return;
    const duplicate = input.connections.some(connection =>
      connection.sourceStepId === sourceStepId && connection.targetStepId === targetStepId,
    );
    if (duplicate) return;
    const connection: AnalyticsFunnelConnection = {
      id: createAnalyticsId('connection'),
      sourceStepId,
      targetStepId,
      minDelayMinutes: 0,
      maxDelayMinutes: 0,
      filters: [],
    };
    onChange({ ...input, connections: [...input.connections, connection] });
    onSelectConnection(connection.id);
    onSelectStep(null);
  };
  const completeConnection = (targetStepId: string) => {
    if (!connectingFrom || connectingFrom === targetStepId) {
      setConnectingFrom(null);
      return;
    }
    connectSteps(connectingFrom, targetStepId);
    setConnectingFrom(null);
  };
  const fit = () => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || !input.steps.length) {
      updateCanvas({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const positions = input.steps.map((step, index) => step.position || { x: 80 + index * 280, y: 140 });
    const minX = Math.min(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y));
    const maxX = Math.max(...positions.map(position => position.x + FUNNEL_NODE_WIDTH));
    const maxY = Math.max(...positions.map(position => position.y + FUNNEL_NODE_HEIGHT));
    const zoom = Math.max(.35, Math.min(1.35, Math.min(
      (bounds.width - 96) / Math.max(1, maxX - minX),
      (bounds.height - 96) / Math.max(1, maxY - minY),
    )));
    updateCanvas({
      zoom,
      x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  };
  const focusSelection = () => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const selectedStep = input.steps.find(step => step.id === selectedStepId);
    const selectedConnection = input.connections.find(connection => connection.id === selectedConnectionId);
    const source = selectedConnection
      ? input.steps.find(step => step.id === selectedConnection.sourceStepId)
      : null;
    const target = selectedConnection
      ? input.steps.find(step => step.id === selectedConnection.targetStepId)
      : null;
    let center: { x: number; y: number } | null = null;
    if (selectedStep) {
      const position = selectedStep.position || { x: 0, y: 0 };
      center = {
        x: position.x + FUNNEL_NODE_WIDTH / 2,
        y: position.y + FUNNEL_NODE_HEIGHT / 2,
      };
    } else if (source && target) {
      const sourcePosition = source.position || { x: 0, y: 0 };
      const targetPosition = target.position || { x: 0, y: 0 };
      center = {
        x: (sourcePosition.x + targetPosition.x + FUNNEL_NODE_WIDTH) / 2,
        y: (sourcePosition.y + targetPosition.y + FUNNEL_NODE_HEIGHT) / 2,
      };
    }
    if (!center) return;
    const zoom = Math.max(1, Math.min(1.35, canvas.zoom));
    updateCanvas({
      zoom,
      x: bounds.width / 2 - center.x * zoom,
      y: bounds.height / 2 - center.y * zoom,
    });
  };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointX = event.clientX - bounds.left;
    const pointY = event.clientY - bounds.top;
    const nextZoom = Math.max(.25, Math.min(2, canvas.zoom * (event.deltaY > 0 ? .9 : 1.1)));
    const worldX = (pointX - canvas.x) / canvas.zoom;
    const worldY = (pointY - canvas.y) / canvas.zoom;
    updateCanvas({
      zoom: nextZoom,
      x: pointX - worldX * nextZoom,
      y: pointY - worldY * nextZoom,
    });
  };
  const connectionTargetAt = (clientX: number, clientY: number, sourceStepId: string) => {
    const element = document.elementFromPoint(clientX, clientY);
    const node = element instanceof HTMLElement
      ? element.closest<HTMLElement>('[data-funnel-node-id]')
      : null;
    const targetStepId = node?.dataset.funnelNodeId || null;
    return targetStepId && targetStepId !== sourceStepId ? targetStepId : null;
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeConnection = connectionDragRef.current;
    if (activeConnection?.pointerId === event.pointerId) {
      const point = canvasPoint(event.clientX, event.clientY);
      const moved = activeConnection.moved
        || Math.hypot(
          event.clientX - activeConnection.startClientX,
          event.clientY - activeConnection.startClientY,
        ) >= FUNNEL_CONNECT_DRAG_THRESHOLD;
      const next = { ...activeConnection, point, moved };
      connectionDragRef.current = next;
      setConnectionDrag(next);
      setConnectionTargetId(connectionTargetAt(event.clientX, event.clientY, activeConnection.sourceStepId));
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      const drag = dragRef.current;
      const dx = (event.clientX - drag.x) / canvas.zoom;
      const dy = (event.clientY - drag.y) / canvas.zoom;
      onChange({
        ...input,
        steps: input.steps.map(step => step.id === drag.stepId
          ? { ...step, position: { x: drag.originX + dx, y: drag.originY + dy } }
          : step),
      });
      return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      const pan = panRef.current;
      updateCanvas({
        x: pan.originX + event.clientX - pan.x,
        y: pan.originY + event.clientY - pan.y,
      });
    }
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeConnection = connectionDragRef.current;
    if (activeConnection?.pointerId === event.pointerId) {
      const targetStepId = connectionTargetAt(
        event.clientX,
        event.clientY,
        activeConnection.sourceStepId,
      );
      if (targetStepId) {
        connectSteps(activeConnection.sourceStepId, targetStepId);
        setConnectingFrom(null);
      } else if (!activeConnection.moved) {
        setConnectingFrom(current => current === activeConnection.sourceStepId ? null : activeConnection.sourceStepId);
      } else {
        setConnectingFrom(null);
      }
      connectionDragRef.current = null;
      setConnectionDrag(null);
      setConnectionTargetId(null);
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };
  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (connectionDragRef.current?.pointerId === event.pointerId) {
      connectionDragRef.current = null;
      setConnectionDrag(null);
      setConnectionTargetId(null);
      setConnectingFrom(null);
    }
    endPointer(event);
  };
  return (
    <section
      ref={containerRef}
      aria-label={`Canvas do funil ${funnel.name}`}
      aria-keyshortcuts="Space"
      className={cn(
        'relative h-full min-h-[480px] touch-none overflow-hidden bg-[var(--kodety-panel)] select-none',
        spacePressed && 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        backgroundImage: 'radial-gradient(circle, rgb(255 255 255 / .075) .65px, transparent .75px)',
        backgroundSize: `${20 * canvas.zoom}px ${20 * canvas.zoom}px`,
        backgroundPosition: `${canvas.x}px ${canvas.y}px`,
      }}
      onWheel={handleWheel}
      onPointerEnter={() => {
        pointerInsideRef.current = true;
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        if (!spacePressed && event.target !== event.currentTarget) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          originX: canvas.x,
          originY: canvas.y,
        };
        onSelectStep(null);
        onSelectConnection(null);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={cancelPointer}
    >
      <div className="absolute left-3 top-3 z-30 flex min-h-11 items-center gap-1.5 rounded-[10px] border border-white/[.065] bg-[var(--kodety-panel)]/95 p-1.5 backdrop-blur-md">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="xs"><Plus />Adicionar</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => addNode('page')}><Globe />Página do Builder</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('click')}><MousePointerClick />Clique rastreado</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('submit')}><FormInput />Envio de formulário</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('experiment')}><FlaskConical />Teste ou variante A/B</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('email')}><Mail />Ação de email marketing</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('webhook')}><Plug />Disparar webhook</DropdownMenuItem>
            <DropdownMenuItem onClick={() => addNode('custom')}><Code2 />Evento personalizado</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {connectionDrag
          ? <span className="px-2 text-[9px] text-[var(--kodety-accent-hover)]">Solte no próximo nó</span>
          : connectingFrom
            ? <span className="px-2 text-[9px] text-[var(--kodety-accent-hover)]">Selecione o próximo nó</span>
            : null}
        {!connectingFrom && !connectionDrag && <span className="hidden px-2 text-[8px] text-[var(--kodety-info-copy)] sm:inline">Space + arrastar para mover</span>}
      </div>
      <div className="absolute bottom-3 right-3 z-30 flex min-h-10 items-center rounded-[10px] border border-white/[.065] bg-[var(--kodety-panel)]/95 p-1 backdrop-blur-md">
        <Button variant="ghost" size="icon-xs" aria-label="Reduzir zoom" onClick={() => updateCanvas({ zoom: Math.max(.25, canvas.zoom - .1) })}><Minus /></Button>
        <span className="grid min-w-11 place-items-center text-[8px] tabular-nums text-[var(--kodety-text-tertiary)]">{Math.round(canvas.zoom * 100)}%</span>
        <Button variant="ghost" size="icon-xs" aria-label="Aumentar zoom" onClick={() => updateCanvas({ zoom: Math.min(2, canvas.zoom + .1) })}><Plus /></Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Enquadrar seleção"
          title="Aproximar seleção"
          disabled={!selectedStepId && !selectedConnectionId}
          onClick={focusSelection}
        ><Crosshair /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="Enquadrar funil" onClick={fit}><Maximize2 /></Button>
      </div>

      <div
        className="absolute left-0 top-0 size-full origin-top-left"
        style={{ transform: `translate(${canvas.x}px, ${canvas.y}px) scale(${canvas.zoom})` }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 h-[4000px] w-[6000px] overflow-visible">
          {input.connections.map(connection => {
            const source = input.steps.find(step => step.id === connection.sourceStepId);
            const target = input.steps.find(step => step.id === connection.targetStepId);
            if (!source || !target) return null;
            const sourcePosition = source.position || { x: 0, y: 0 };
            const targetPosition = target.position || { x: 0, y: 0 };
            const x1 = sourcePosition.x + FUNNEL_NODE_WIDTH;
            const y1 = sourcePosition.y + FUNNEL_NODE_HEIGHT / 2;
            const x2 = targetPosition.x;
            const y2 = targetPosition.y + FUNNEL_NODE_HEIGHT / 2;
            const bend = Math.max(55, Math.abs(x2 - x1) * .45);
            return <path
              key={connection.id}
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={selectedConnectionId === connection.id ? 'var(--kodety-accent)' : 'var(--kodety-divider-strong)'}
              strokeWidth={selectedConnectionId === connection.id ? 2 : 1.25}
              vectorEffect="non-scaling-stroke"
            />;
          })}
          {connectionDrag && (() => {
            const source = input.steps.find(step => step.id === connectionDrag.sourceStepId);
            if (!source) return null;
            const sourcePosition = source.position || { x: 0, y: 0 };
            const x1 = sourcePosition.x + FUNNEL_NODE_WIDTH;
            const y1 = sourcePosition.y + FUNNEL_NODE_HEIGHT / 2;
            const x2 = connectionDrag.point.x;
            const y2 = connectionDrag.point.y;
            const bend = Math.max(55, Math.abs(x2 - x1) * .45);
            return <g>
              <path
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--kodety-accent)"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={x2}
                cy={y2}
                r={5}
                fill={connectionTargetId ? 'var(--kodety-accent)' : 'var(--kodety-panel)'}
                stroke="var(--kodety-accent)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>;
          })()}
        </svg>

        {input.connections.map(connection => {
          const source = input.steps.find(step => step.id === connection.sourceStepId);
          const target = input.steps.find(step => step.id === connection.targetStepId);
          if (!source || !target) return null;
          const a = source.position || { x: 0, y: 0 };
          const b = target.position || { x: 0, y: 0 };
          const result = connectionResults.get(connection.id);
          return (
            <button
              key={`label-${connection.id}`}
              type="button"
              onClick={() => {
                onSelectConnection(connection.id);
                onSelectStep(null);
              }}
              className={cn(
                'absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[var(--kodety-panel)] px-2.5 py-1.5 text-[8px] tabular-nums transition-[border-color,background-color,color]',
                selectedConnectionId === connection.id
                  ? 'border-[var(--kodety-accent)] text-[var(--kodety-text)]'
                  : 'border-white/[.065] text-[var(--kodety-info-copy)] hover:border-white/[.1] hover:bg-white/[.035]',
              )}
              style={{ left: (a.x + FUNNEL_NODE_WIDTH + b.x) / 2, top: (a.y + b.y + FUNNEL_NODE_HEIGHT) / 2 }}
            >
              {result ? `${result.conversionRate?.toFixed(1) ?? 0}% · ${formatCount(result.visitors)}` : connection.label || 'Conexão'}
            </button>
          );
        })}

        {input.steps.map((step, index) => {
          const position = step.position || { x: 80 + index * 280, y: 140 };
          const result = results.get(step.id);
          const experiment = experiments.find(item => item.id === step.experimentId);
          return (
            <article
              key={step.id}
              data-funnel-node-id={step.id}
              data-kodety-analytics-card="interactive"
              className={cn(
                'absolute z-20 overflow-visible rounded-[10px] border bg-[var(--kodety-panel)] transition-[border-color,background-color]',
                selectedStepId === step.id
                  ? '!border-[var(--kodety-accent)] !bg-white/[.035]'
                  : connectionTargetId === step.id
                    ? '!border-[var(--kodety-accent)] !bg-white/[.035]'
                    : 'border-white/[.065]',
              )}
              style={{ left: position.x, top: position.y, width: FUNNEL_NODE_WIDTH, minHeight: FUNNEL_NODE_HEIGHT }}
              onPointerDown={event => {
                if (spacePressed) return;
                event.stopPropagation();
                if ((event.target as HTMLElement).closest('button')) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  pointerId: event.pointerId,
                  stepId: step.id,
                  x: event.clientX,
                  y: event.clientY,
                  originX: position.x,
                  originY: position.y,
                };
                onSelectStep(step.id);
                onSelectConnection(null);
              }}
            >
              <button
                type="button"
                aria-label={`Conectar a ${step.name}`}
                title="Entrada"
                data-funnel-input-id={step.id}
                onClick={() => {
                  if (!spacePressed) completeConnection(step.id);
                }}
                className={cn(
                  'absolute left-0 top-1/2 z-30 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--kodety-panel)] transition-[background-color,transform]',
                  connectingFrom || connectionDrag
                    ? 'bg-[var(--kodety-accent)] hover:scale-125'
                    : 'bg-[var(--kodety-text-disabled)] hover:bg-[var(--kodety-text-tertiary)]',
                )}
              />
              <button
                type="button"
                aria-label={`Criar conexão a partir de ${step.name}`}
                title="Arraste para conectar a outro nó"
                onPointerDown={event => {
                  if (spacePressed || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const drag: FunnelConnectionDrag = {
                    pointerId: event.pointerId,
                    sourceStepId: step.id,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    point: canvasPoint(event.clientX, event.clientY),
                    moved: false,
                  };
                  connectionDragRef.current = drag;
                  setConnectionDrag(drag);
                  setConnectionTargetId(null);
                  onSelectStep(step.id);
                  onSelectConnection(null);
                }}
                className={cn(
                  'absolute right-0 top-1/2 z-30 size-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--kodety-panel)] transition-[background-color,transform] hover:scale-125',
                  connectingFrom === step.id || connectionDrag?.sourceStepId === step.id
                    ? 'bg-[var(--kodety-accent)]'
                    : 'bg-[var(--kodety-text-disabled)] hover:bg-[var(--kodety-text-tertiary)]',
                )}
              />
              <header className="flex min-h-11 cursor-grab items-center gap-2.5 border-b border-white/[.055] px-3 active:cursor-grabbing">
                <span className="grid size-7 place-items-center rounded-[8px] bg-white/[.045] text-white/42 [&>svg]:size-3.5"><FunnelNodeIcon type={step.type} /></span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--kodety-text)]">{step.name}</span>
                <span className="text-[8px] font-medium uppercase tracking-[.08em] text-[var(--kodety-text-disabled)]">{step.type === 'experiment' ? 'A/B' : step.type}</span>
              </header>
              <div className="px-3 py-2.5">
                <p className="truncate text-[9px] text-[var(--kodety-info-copy)]" title={describeStep(step)}>
                  {step.type === 'experiment' && experiment ? `${experiment.name}${step.variantId ? ` · ${experiment.variants.find(variant => variant.id === step.variantId)?.name || step.variantId}` : ' · todas as variantes'}` : describeStep(step)}
                </p>
                <div className="mt-2.5 flex items-end justify-between border-t border-white/[.045] pt-2">
                  <span className="text-[8px] text-[var(--kodety-text-tertiary)]">Visitantes</span>
                  <strong className="text-[16px] font-semibold tracking-[-.025em] tabular-nums text-[var(--kodety-text)]">{formatCount(result?.visitors)}</strong>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StepEditor({
  step,
  index,
  total,
  pages,
  trackingTargets,
  experiments,
  emailOptions,
  onChange,
  onMove,
  onRemove,
}: {
  step: AnalyticsFunnelStep;
  index: number;
  total: number;
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  experiments: AnalyticsExperimentOption[];
  emailOptions: AnalyticsEmailAutomationOptions;
  onChange: (step: AnalyticsFunnelStep) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const trackingValue = (target: AnalyticsTrackingTarget) =>
    `${encodeURIComponent(target.pagePath || '*')}::${encodeURIComponent(target.id)}`;
  const selectedTrackingTarget = trackingTargets.find(
    target => target.id === step.trackingId && (!step.pagePath || target.pagePath === step.pagePath),
  );
  const setType = (type: AnalyticsFunnelStepType) => onChange({
    id: step.id,
    name: step.name,
    type,
    ...(type === 'page' ? { pagePath: step.pagePath || pages[0]?.runtimePath || pages[0]?.path || '/' } : {}),
    ...(type === 'click' || type === 'submit' ? (() => {
      const target = trackingTargets.find(candidate => candidate.type === type && candidate.enabled !== false);
      return {
        trackingId: step.trackingId || target?.id,
        pagePath: step.pagePath || target?.pagePath,
      };
    })() : {}),
    ...(type === 'custom' ? { eventName: step.eventName || '' } : {}),
    ...(type === 'experiment' ? { experimentId: step.experimentId || experiments[0]?.id } : {}),
    ...(type === 'email' ? { emailAction: step.emailAction || 'upsert-contact', emailField: step.emailField || 'email', nameField: step.nameField || 'name' } : {}),
    ...(type === 'webhook' ? {
      webhookUrl: step.webhookUrl || '',
      webhookMethod: step.webhookMethod || 'POST',
      webhookPayloadMode: step.webhookPayloadMode || 'submission',
      webhookEvent: step.webhookEvent || 'form.submitted',
      webhookSecret: '',
      webhookSecretConfigured: step.webhookSecretConfigured || false,
      webhookSecretClear: false,
    } : {}),
  });
  return (
    <article data-kodety-analytics-card="interactive" className="rounded-[10px] border border-white/[.065] bg-white/[.025] p-3">
      <header className="mb-3 flex min-h-10 items-start gap-2.5 border-b border-white/[.045] pb-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-white/[.05] text-white/42 [&>svg]:size-3.5"><FunnelNodeIcon type={step.type} /></span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block text-[10px] font-semibold text-[var(--kodety-text)]">Etapa {index + 1}</span>
          <span className="mt-0.5 block truncate text-[8px] text-[var(--kodety-info-copy)]">{step.name}</span>
        </span>
        <span className="ml-auto flex shrink-0 gap-0.5 rounded-[8px] bg-white/[.035] p-0.5">
          <Button variant="ghost" size="icon-xs" aria-label="Mover etapa para cima" title="Mover para cima" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Mover etapa para baixo" title="Mover para baixo" disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Remover etapa" title="Remover" onClick={onRemove}><Trash2 /></Button>
        </span>
      </header>
      <div className="space-y-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
          <Input aria-label={`Nome da etapa ${index + 1}`} value={step.name} onChange={event => onChange({ ...step, name: event.target.value })} className="h-8 text-[10px]" placeholder="Nome da etapa" />
          <Select value={step.type} onValueChange={value => setType(value as AnalyticsFunnelStepType)}>
            <SelectTrigger aria-label={`Tipo da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="page">Página</SelectItem>
              <SelectItem value="click">Click</SelectItem>
              <SelectItem value="submit">Formulário</SelectItem>
              <SelectItem value="experiment">Teste A/B</SelectItem>
              <SelectItem value="email">Email marketing</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="custom">Evento</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {step.type === 'page' && (
          <Select value={step.pagePath || ''} onValueChange={pagePath => onChange({ ...step, pagePath })}>
            <SelectTrigger aria-label={`Página da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue placeholder="Selecione uma página" /></SelectTrigger>
            <SelectContent>
              {pages.map(page => (
                <SelectItem key={page.path} value={page.runtimePath || page.path}>
                  {page.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(step.type === 'click' || step.type === 'submit') && (
          <Select
            value={selectedTrackingTarget ? trackingValue(selectedTrackingTarget) : ''}
            onValueChange={(value) => {
              const target = trackingTargets.find(candidate => trackingValue(candidate) === value);
              if (target) onChange({ ...step, trackingId: target.id, pagePath: target.pagePath });
            }}
          >
            <SelectTrigger aria-label={`Evento rastreado da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue placeholder="Selecione um evento rastreado" /></SelectTrigger>
            <SelectContent>
              {trackingTargets.filter(target => target.type === step.type && target.enabled !== false).map(target => (
                <SelectItem key={trackingValue(target)} value={trackingValue(target)}>
                  {target.label} · {target.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {step.type === 'experiment' && (
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={step.experimentId || ''}
              onValueChange={experimentId => onChange({ ...step, experimentId, variantId: undefined })}
            >
              <SelectTrigger aria-label={`Teste A/B da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue placeholder="Selecione o teste" /></SelectTrigger>
              <SelectContent>{experiments.map(experiment => <SelectItem key={experiment.id} value={experiment.id}>{experiment.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select
              value={step.variantId || '__all__'}
              disabled={!step.experimentId}
              onValueChange={variantId => onChange({ ...step, variantId: variantId === '__all__' ? undefined : variantId })}
            >
              <SelectTrigger aria-label={`Variante A/B da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as variantes</SelectItem>
                {experiments.find(experiment => experiment.id === step.experimentId)?.variants.map(variant => <SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {step.type === 'email' && (
          <div data-kodety-onboarding="analytics-funnel-email" className="space-y-2.5">
            <Select
              value={step.emailAction || 'upsert-contact'}
              onValueChange={emailAction => onChange({
                ...step,
                emailAction: emailAction as NonNullable<AnalyticsFunnelStep['emailAction']>,
              })}
            >
              <SelectTrigger aria-label={`Ação de email da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upsert-contact">Cadastrar ou atualizar contato</SelectItem>
                <SelectItem value="add-to-list">Cadastrar e adicionar à lista</SelectItem>
              </SelectContent>
            </Select>
            {step.emailAction === 'add-to-list' && <Select
              value={step.emailListId ? String(step.emailListId) : ''}
              onValueChange={value => onChange({ ...step, emailListId: Number(value) })}
            >
              <SelectTrigger aria-label={`Lista de email da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue placeholder="Selecione a lista" /></SelectTrigger>
              <SelectContent>{emailOptions.lists.map(list => <SelectItem key={list.id} value={String(list.id)}>{list.name}</SelectItem>)}</SelectContent>
            </Select>}
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="Campo de email do formulário" value={step.emailField || 'email'} onChange={event => onChange({ ...step, emailField: event.target.value })} className="h-8 text-[10px]" placeholder="campo de email" />
              <Input aria-label="Campo de nome do formulário" value={step.nameField || 'name'} onChange={event => onChange({ ...step, nameField: event.target.value })} className="h-8 text-[10px]" placeholder="campo de nome" />
            </div>
            <Input aria-label="Campo de consentimento do formulário" value={step.consentField || ''} onChange={event => onChange({ ...step, consentField: event.target.value || undefined })} className="h-8 text-[10px]" placeholder="campo de consentimento (opcional)" />
            <p className="text-[9px] leading-4 text-[var(--kodety-info-copy)]">Com consentimento, o contato só entra como inscrito quando o campo estiver marcado.</p>
          </div>
        )}
        {step.type === 'webhook' && (
          <div data-kodety-onboarding="analytics-funnel-webhook" className="space-y-2.5">
            <Input
              type="url"
              aria-label={`URL do webhook da etapa ${index + 1}`}
              value={step.webhookUrl || ''}
              onChange={event => onChange({ ...step, webhookUrl: event.target.value })}
              className="h-8 font-mono text-[10px]"
              placeholder="https://hooks.exemplo.com/kodety"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={step.webhookMethod || 'POST'}
                onValueChange={webhookMethod => onChange({
                  ...step,
                  webhookMethod: webhookMethod as NonNullable<AnalyticsFunnelStep['webhookMethod']>,
                })}
              >
                <SelectTrigger aria-label={`Método do webhook da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={step.webhookPayloadMode || 'submission'}
                onValueChange={webhookPayloadMode => onChange({
                  ...step,
                  webhookPayloadMode: webhookPayloadMode as NonNullable<AnalyticsFunnelStep['webhookPayloadMode']>,
                })}
              >
                <SelectTrigger aria-label={`Conteúdo do webhook da etapa ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="submission">Submissão completa</SelectItem>
                  <SelectItem value="fields">Somente campos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              aria-label={`Nome do evento do webhook da etapa ${index + 1}`}
              value={step.webhookEvent || 'form.submitted'}
              onChange={event => onChange({ ...step, webhookEvent: event.target.value })}
              className="h-8 font-mono text-[10px]"
              placeholder="form.submitted"
            />
            <Input
              type="password"
              autoComplete="new-password"
              aria-label={`Segredo de assinatura do webhook da etapa ${index + 1}`}
              value={step.webhookSecret || ''}
              onChange={event => onChange({
                ...step,
                webhookSecret: event.target.value,
                webhookSecretClear: false,
              })}
              className="h-8 font-mono text-[10px]"
              placeholder={step.webhookSecretConfigured ? 'Configurado — deixe vazio para manter' : 'Segredo HMAC opcional'}
            />
            {step.webhookSecretConfigured && (
              <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--kodety-divider)] px-2.5 py-2">
                <span className="text-[9px] text-[var(--kodety-text-secondary)]">Remover assinatura salva</span>
                <Switch
                  checked={Boolean(step.webhookSecretClear)}
                  onCheckedChange={webhookSecretClear => onChange({
                    ...step,
                    webhookSecret: '',
                    webhookSecretClear,
                  })}
                  aria-label="Remover segredo salvo do webhook"
                />
              </label>
            )}
            <p className="text-[9px] leading-4 text-[var(--kodety-info-copy)]">
              Dispara imediatamente após o formulário. Use HTTPS; com segredo, o corpo recebe assinatura SHA-256 em X-Kodety-Signature.
            </p>
          </div>
        )}
        {step.type === 'custom' && (
          <Input
            aria-label={`Evento da etapa ${index + 1}`}
            value={step.eventName || ''}
            onChange={event => onChange({ ...step, eventName: event.target.value })}
            className="h-8 font-mono text-[10px]"
            placeholder="checkout.completed"
          />
        )}
      </div>
    </article>
  );
}

const FILTER_FIELDS: Array<{ value: AnalyticsFunnelFilter['field']; label: string }> = [
  { value: 'page', label: 'Página' },
  { value: 'referrer', label: 'Origem do tráfego' },
  { value: 'country', label: 'País' },
  { value: 'device', label: 'Dispositivo' },
  { value: 'utm-source', label: 'UTM Source' },
  { value: 'utm-campaign', label: 'UTM Campaign' },
  { value: 'property', label: 'Propriedade' },
];

const FILTER_OPERATORS: Array<{ value: AnalyticsFilterOperator; label: string }> = [
  { value: 'equals', label: 'é igual a' },
  { value: 'not-equals', label: 'não é' },
  { value: 'contains', label: 'contém' },
  { value: 'not-contains', label: 'não contém' },
  { value: 'starts-with', label: 'começa com' },
  { value: 'ends-with', label: 'termina com' },
];

function FilterEditor({
  filter,
  index,
  onChange,
  onRemove,
}: {
  filter: AnalyticsFunnelFilter;
  index: number;
  onChange: (filter: AnalyticsFunnelFilter) => void;
  onRemove: () => void;
}) {
  return (
    <div data-kodety-analytics-card="interactive" className="space-y-2.5 rounded-[10px] border border-white/[.065] bg-white/[.025] p-3">
      <div className="flex min-h-7 items-center border-b border-white/[.045] pb-2">
        <span className="grid size-6 place-items-center rounded-[7px] bg-white/[.045] text-white/40"><Filter className="size-3" /></span>
        <span className="ml-2 text-[10px] font-medium text-[var(--kodety-text)]">Filtro {index + 1}</span>
        <Button className="ml-auto" variant="ghost" size="icon-xs" aria-label="Remover filtro" onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={filter.field} onValueChange={value => onChange({ ...filter, field: value as AnalyticsFunnelFilter['field'] })}>
          <SelectTrigger aria-label={`Campo do filtro ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTER_FIELDS.map(field => <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filter.operator} onValueChange={value => onChange({ ...filter, operator: value as AnalyticsFilterOperator })}>
          <SelectTrigger aria-label={`Operador do filtro ${index + 1}`} className="h-8 text-[10px]"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTER_OPERATORS.map(operator => <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {filter.field === 'property' && <Input aria-label={`Propriedade do filtro ${index + 1}`} value={filter.property || ''} onChange={event => onChange({ ...filter, property: event.target.value })} className="h-8 font-mono text-[10px]" placeholder="plan" />}
      <Input aria-label={`Valor do filtro ${index + 1}`} value={filter.value} onChange={event => onChange({ ...filter, value: event.target.value })} className="h-8 text-[10px]" placeholder="Valor" />
    </div>
  );
}

function FunnelEditor({
  value,
  pages,
  trackingTargets,
  experiments,
  emailOptions,
  selectedStepId,
  selectedConnectionId,
  onSelectStep,
  onSelectConnection,
  busy,
  persistenceAvailable,
  activationLocked,
  onChange,
  onSave,
  onDelete,
}: {
  value: AnalyticsFunnelInput;
  pages: AnalyticsPageOption[];
  trackingTargets: AnalyticsTrackingTarget[];
  experiments: AnalyticsExperimentOption[];
  emailOptions: AnalyticsEmailAutomationOptions;
  selectedStepId: string | null;
  selectedConnectionId: string | null;
  onSelectStep: (id: string | null) => void;
  onSelectConnection: (id: string | null) => void;
  busy: boolean;
  persistenceAvailable: boolean;
  activationLocked: boolean;
  onChange: (value: AnalyticsFunnelInput) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const validationError = validateFunnelInput(value);
  const selectedStepIndex = value.steps.findIndex(step => step.id === selectedStepId);
  const selectedStep = selectedStepIndex >= 0 ? value.steps[selectedStepIndex] : null;
  const selectedConnection = value.connections.find(connection => connection.id === selectedConnectionId) || null;
  const updateStep = (index: number, step: AnalyticsFunnelStep) => onChange({ ...value, steps: value.steps.map((item, itemIndex) => itemIndex === index ? step : item) });
  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.steps.length) return;
    const steps = [...value.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    onChange({ ...value, steps });
  };
  return (
    <aside data-kodety-analytics-fill-fields data-kodety-onboarding-navigation-draft="funnel" className="min-h-0 overflow-y-auto border-t border-[var(--kodety-divider)] bg-[var(--kodety-panel)] xl:border-l xl:border-t-0">
      <header className="sticky top-0 z-10 flex min-h-14 items-center border-b border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-4">
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold text-[var(--kodety-text)]">Configuração</h2>
          <p className="mt-0.5 text-[9px] text-[var(--kodety-info-copy)]">Estrutura e regras do funil</p>
        </div>
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-xs"
          aria-label="Salvar funil"
          title="Salvar"
          disabled={busy || Boolean(validationError) || !persistenceAvailable}
          onClick={onSave}
        >{busy ? <Loader2 className="animate-spin" /> : <Save />}</Button>
      </header>
      <div className="px-4 pb-5">
        <AnalyticsSurface onboardingId="analytics-funnel-identity" variant="section" className="space-y-3 py-4">
          <AnalyticsSectionHeader title="Funil" description="Identidade e janela de conversão" />
          <div className="space-y-1.5">
            <Label className="text-[10px] text-[var(--kodety-text-secondary)]">Nome</Label>
            <HtmlSettingsFieldControl label="Nome" kind="text"><Input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} /></HtmlSettingsFieldControl>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-[9px] bg-white/[.04] px-3">
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--kodety-text)]">Ativo {activationLocked ? <span className="inline-flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[.08em] text-[var(--kodety-accent-hover)]"><LockKeyhole className="size-2.5" />Pro</span> : null}</p>
              <p className="text-[9px] text-[var(--kodety-info-copy)]">{activationLocked ? 'Salve como rascunho; a coleta exige uma licença Pro ativa.' : 'Coleta conversões deste fluxo.'}</p>
            </div>
            <Switch
              checked={activationLocked ? false : value.enabled}
              disabled={activationLocked}
              onCheckedChange={enabled => {
                if (!activationLocked) onChange({ ...value, enabled });
              }}
              aria-label={activationLocked ? 'Ativação de funil disponível no Pro' : 'Funil ativo'}
              title={activationLocked ? 'Ative uma licença Pro para coletar conversões' : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-[var(--kodety-text-secondary)]">Janela de conversão</Label>
            <HtmlSettingsFieldControl label="Janela de conversão" kind="time"><Input
                type="number"
                min={0}
                max={MAX_FUNNEL_WINDOW_MINUTES}
                step={1}
                value={value.windowMinutes ?? 0}
                onChange={event => onChange({ ...value, windowMinutes: normalizeFunnelWindowMinutes(event.target.value) })}
                aria-label="Janela de conversão em minutos"
              /></HtmlSettingsFieldControl>
            <p className="text-[9px] leading-4 text-[var(--kodety-info-copy)]">Minutos entre entrada e conclusão. Use 0 para não limitar.</p>
          </div>
        </AnalyticsSurface>

        <AnalyticsSurface onboardingId={selectedStep ? 'analytics-funnel-step' : undefined} variant="section" className="py-4">
          <AnalyticsSectionHeader title="Nó selecionado" description="Evento, página ou ação deste passo" />
          {selectedStep ? (
            <StepEditor
              key={selectedStep.id}
              step={selectedStep}
              index={selectedStepIndex}
              total={value.steps.length}
              pages={pages}
              trackingTargets={trackingTargets}
              experiments={experiments}
              emailOptions={emailOptions}
              onChange={next => updateStep(selectedStepIndex, next)}
              onMove={direction => moveStep(selectedStepIndex, direction)}
              onRemove={() => {
                onChange({
                  ...value,
                  steps: value.steps.filter(step => step.id !== selectedStep.id),
                  connections: value.connections.filter(connection =>
                    connection.sourceStepId !== selectedStep.id && connection.targetStepId !== selectedStep.id,
                  ),
                });
                onSelectStep(null);
              }}
            />
          ) : <p className={FUNNEL_EMPTY_FIELD_CLASS}>Selecione um nó no canvas para editar seu evento, página ou variante.</p>}
        </AnalyticsSurface>

        <AnalyticsSurface onboardingId={selectedConnection ? 'analytics-funnel-connection' : undefined} variant="section" className="py-4">
          <AnalyticsSectionHeader icon={Route} title="Conexão" description="Prazo e condições entre dois nós" />
          {selectedConnection ? <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[9px]">Rótulo</Label>
              <Input
                value={selectedConnection.label || ''}
                onChange={event => onChange({
                  ...value,
                  connections: value.connections.map(connection => connection.id === selectedConnection.id
                    ? { ...connection, label: event.target.value }
                    : connection),
                })}
                placeholder="ex.: concluiu checkout"
                className="h-8 text-[10px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label className="text-[9px]">Aguardar no mínimo</Label><Input type="number" min={0} value={selectedConnection.minDelayMinutes || 0} onChange={event => onChange({
                ...value,
                connections: value.connections.map(connection => connection.id === selectedConnection.id
                  ? { ...connection, minDelayMinutes: normalizeFunnelWindowMinutes(event.target.value) }
                  : connection),
              })} className="h-8 text-[10px]" aria-label="Espera mínima da conexão em minutos" /></div>
              <div className="space-y-1.5"><Label className="text-[9px]">Concluir em até</Label><Input type="number" min={0} value={selectedConnection.maxDelayMinutes || 0} onChange={event => onChange({
                ...value,
                connections: value.connections.map(connection => connection.id === selectedConnection.id
                  ? { ...connection, maxDelayMinutes: normalizeFunnelWindowMinutes(event.target.value) }
                  : connection),
              })} className="h-8 text-[10px]" aria-label="Janela máxima da conexão em minutos" /></div>
            </div>
            <p className="text-[9px] leading-4 text-[var(--kodety-info-copy)]">Prazo 0 herda a janela geral do funil.</p>
            <div className="border-t border-white/[.045] pt-2">
              <div className="flex h-8 items-center">
                <span className="text-[9px] font-medium text-[var(--kodety-text-secondary)]">Condições da rota</span>
                <Button
                  className="ml-auto"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Adicionar condição à conexão"
                  onClick={() => onChange({
                    ...value,
                    connections: value.connections.map(connection => connection.id === selectedConnection.id
                      ? {
                        ...connection,
                        filters: [...(connection.filters || []), {
                          id: createAnalyticsId('filter'),
                          field: 'device',
                          operator: 'equals',
                          value: 'desktop',
                        }],
                      }
                      : connection),
                  })}
                ><Plus /></Button>
              </div>
              {(selectedConnection.filters || []).map((filter, index) => <FilterEditor
                key={filter.id}
                filter={filter}
                index={index}
                onChange={next => onChange({
                  ...value,
                  connections: value.connections.map(connection => connection.id === selectedConnection.id
                    ? { ...connection, filters: (connection.filters || []).map((item, itemIndex) => itemIndex === index ? next : item) }
                    : connection),
                })}
                onRemove={() => onChange({
                  ...value,
                  connections: value.connections.map(connection => connection.id === selectedConnection.id
                    ? { ...connection, filters: (connection.filters || []).filter((_, itemIndex) => itemIndex !== index) }
                    : connection),
                })}
              />)}
              {!selectedConnection.filters?.length && <p className={FUNNEL_EMPTY_FIELD_CLASS}>Sem condição: qualquer visitante que completar o próximo nó segue pela rota.</p>}
            </div>
            <div className="flex items-center">
              <span className="text-[9px] text-[var(--kodety-text-tertiary)]">
                {value.steps.find(step => step.id === selectedConnection.sourceStepId)?.name} → {value.steps.find(step => step.id === selectedConnection.targetStepId)?.name}
              </span>
              <Button className="ml-auto" variant="ghost" size="icon-xs" aria-label="Remover conexão" onClick={() => {
                onChange({ ...value, connections: value.connections.filter(connection => connection.id !== selectedConnection.id) });
                onSelectConnection(null);
              }}><Trash2 /></Button>
            </div>
          </div> : <p className={FUNNEL_EMPTY_FIELD_CLASS}>Selecione uma conexão no canvas para editar sua espera e prazo.</p>}
        </AnalyticsSurface>

        <AnalyticsSurface onboardingId="analytics-funnel-entry-filters" variant="section" className="py-4">
          <AnalyticsSectionHeader
            icon={Filter}
            title="Filtros de entrada"
            description="Limite quem pode iniciar este funil"
            action={<Button
              variant="ghost"
              size="icon-xs"
              aria-label="Adicionar filtro"
              title="Adicionar filtro"
              onClick={() => onChange({
                ...value,
                filters: [...value.filters, { id: createAnalyticsId('filter'), field: 'page', operator: 'equals', value: '' }],
              })}
            ><Plus /></Button>}
          />
          <div className="space-y-2.5">
          {value.filters.map((filter, index) => (
            <FilterEditor
              key={filter.id}
              filter={filter}
              index={index}
              onChange={next => onChange({ ...value, filters: value.filters.map((item, itemIndex) => itemIndex === index ? next : item) })}
              onRemove={() => onChange({ ...value, filters: value.filters.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))}
          {!value.filters.length && <p className={FUNNEL_EMPTY_FIELD_CLASS}>Sem filtros: todos os visitantes podem entrar neste funil.</p>}
          </div>
        </AnalyticsSurface>

        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-4 py-3">
          {(validationError || !persistenceAvailable) && (
            <div role="alert" className="mb-2.5 flex min-h-10 items-start gap-2 rounded-[9px] bg-[var(--kodety-warning)]/[.055] px-3 py-2.5 text-[9px] leading-4 text-[var(--kodety-text-tertiary)]">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--kodety-warning)]" />
              <span className="text-balance">
                {validationError || 'Conecte os callbacks de persistência para salvar alterações.'}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button className="h-9 flex-1" size="xs" disabled={busy || Boolean(validationError) || !persistenceAvailable} onClick={onSave}>{busy ? 'Salvando…' : 'Salvar funil'}</Button>
            {onDelete && <Button variant="ghost" size="icon-xs" aria-label="Excluir funil" title="Excluir funil" disabled={busy} onClick={onDelete}><Trash2 /></Button>}
          </div>
        </div>
      </div>
    </aside>
  );
}

export interface AnalyticsFunnelsPanelProps {
  funnels: AnalyticsFunnel[];
  period: AnalyticsPeriod;
  pages?: AnalyticsPageOption[];
  trackingTargets?: AnalyticsTrackingTarget[];
  experiments?: AnalyticsExperimentOption[];
  emailOptions?: AnalyticsEmailAutomationOptions;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  selectedId?: string | null;
  createRequestKey?: number;
  featureAccess?: AnalyticsFeatureAccess;
  onPeriodChange?: (period: AnalyticsPeriod) => void;
  onSelectedIdChange?: (id: string | null) => void;
  onRefresh?: () => void;
  onCreate?: (input: AnalyticsFunnelInput) => Promise<AnalyticsFunnel>;
  onUpdate?: (id: string, input: AnalyticsFunnelInput) => Promise<AnalyticsFunnel>;
  onDelete?: (id: string) => Promise<void>;
}

export function AnalyticsFunnelsPanel({
  funnels,
  period,
  pages = [],
  trackingTargets = [],
  experiments = [],
  emailOptions = { lists: [] },
  loading = false,
  saving = false,
  error,
  selectedId,
  createRequestKey = 0,
  featureAccess: featureAccessOverride,
  onPeriodChange,
  onSelectedIdChange,
  onRefresh,
  onCreate,
  onUpdate,
  onDelete,
}: AnalyticsFunnelsPanelProps) {
  const featureAccess = useAnalyticsFeatureAccess(featureAccessOverride);
  const activationLocked = !featureAccess.funnels;
  const selected = funnels.find(funnel => funnel.id === selectedId) || null;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AnalyticsFunnelInput>(() => createEmptyFunnel());
  const draftCache = useRef(new Map<string, AnalyticsFunnelInput>());
  const dirtyDrafts = useRef(new Set<string>());
  const activeDraftKey = creating ? '__new__' : selected?.id || '';
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selected) {
      const cached = draftCache.current.get(selected.id);
      const nextDraft = cached || funnelToInput(selected);
      const safeDraft = activationLocked ? { ...nextDraft, enabled: false } : nextDraft;
      setDraft(safeDraft);
      setDirty(dirtyDrafts.current.has(selected.id));
      setCreating(false);
      setConfirmDelete(false);
      setSelectedStepId(safeDraft.steps[0]?.id || null);
      setSelectedConnectionId(null);
      setImportNotice(null);
    }
  }, [activationLocked, selected?.id]);
  useEffect(() => {
    if (!createRequestKey) return;
    setCreating(true);
    const nextDraft = createEmptyFunnel();
    draftCache.current.set('__new__', nextDraft);
    dirtyDrafts.current.delete('__new__');
    setDraft(nextDraft);
    setDirty(false);
    setActionError(null);
    setConfirmDelete(false);
    setSelectedStepId(nextDraft.steps[0]?.id || null);
    setSelectedConnectionId(null);
    setImportNotice(null);
    onSelectedIdChange?.(null);
  }, [createRequestKey, onSelectedIdChange]);
  useEffect(() => {
    if (!selectedId && funnels.length && !creating) onSelectedIdChange?.(funnels[0].id);
  }, [creating, funnels, onSelectedIdChange, selectedId]);

  const shownFunnel = useMemo<AnalyticsFunnel | null>(() => selected ? {
    ...selected,
    ...draft,
  } : creating ? {
    id: '__draft__',
    ...draft,
  } : null, [creating, draft, selected]);
  const changeDraft = (next: AnalyticsFunnelInput) => {
    const safeDraft = activationLocked ? { ...next, enabled: false } : next;
    setDraft(safeDraft);
    if (activeDraftKey) {
      draftCache.current.set(activeDraftKey, safeDraft);
      dirtyDrafts.current.add(activeDraftKey);
    }
    setDirty(true);
  };

  const save = async () => {
    const validation = validateFunnelInput(draft);
    if (validation) {
      setActionError(validation);
      return;
    }
    setActionError(null);
    try {
      if (creating) {
        if (!onCreate) return;
        const created = await onCreate(activationLocked ? { ...draft, enabled: false } : draft);
        draftCache.current.delete('__new__');
        dirtyDrafts.current.delete('__new__');
        setDirty(false);
        setImportNotice(null);
        onSelectedIdChange?.(created.id);
      } else if (selected && onUpdate) {
        const updated = await onUpdate(selected.id, activationLocked ? { ...draft, enabled: false } : draft);
        draftCache.current.delete(selected.id);
        dirtyDrafts.current.delete(selected.id);
        setDirty(false);
        onSelectedIdChange?.(updated.id);
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível salvar o funil.');
    }
  };

  const remove = async () => {
    if (!selected || !onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setActionError(null);
    try {
      await onDelete(selected.id);
      draftCache.current.delete(selected.id);
      dirtyDrafts.current.delete(selected.id);
      onSelectedIdChange?.(null);
      setConfirmDelete(false);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível excluir o funil.');
    }
  };

  const importedReferenceIssues = (input: AnalyticsFunnelInput) => {
    const issues = new Set<string>();
    input.steps.forEach(step => {
      if (
        step.type === 'page'
        && step.pagePath
        && !pages.some(page => page.path === step.pagePath || page.runtimePath === step.pagePath)
      ) issues.add(`página de “${step.name}”`);
      if (
        (step.type === 'click' || step.type === 'submit')
        && step.trackingId
        && !trackingTargets.some(target => target.id === step.trackingId)
      ) issues.add(`Tracking ID de “${step.name}”`);
      if (step.type === 'experiment' && step.experimentId) {
        const experiment = experiments.find(candidate => candidate.id === step.experimentId);
        if (!experiment) issues.add(`teste A/B de “${step.name}”`);
        else if (step.variantId && !experiment.variants.some(variant => variant.id === step.variantId)) {
          issues.add(`variante de “${step.name}”`);
        }
      }
      if (
        step.type === 'email'
        && step.emailAction === 'add-to-list'
        && step.emailListId
        && !emailOptions.lists.some(list => list.id === step.emailListId)
      ) issues.add(`lista de email de “${step.name}”`);
    });
    return [...issues];
  };

  const importFunnelFile = async (file: File) => {
    setActionError(null);
    if (file.size > 2 * 1024 * 1024) {
      setActionError('O arquivo de funil precisa ter no máximo 2 MB.');
      return;
    }
    try {
      const imported = parseFunnelImport(await file.text());
      const issues = importedReferenceIssues(imported);
      setCreating(true);
      setDraft(imported);
      draftCache.current.set('__new__', imported);
      dirtyDrafts.current.add('__new__');
      setDirty(true);
      setConfirmDelete(false);
      setSelectedStepId(imported.steps[0]?.id || null);
      setSelectedConnectionId(null);
      setImportNotice(
        issues.length
          ? `Importado como rascunho pausado. Revise ${issues.slice(0, 3).join(', ')}${issues.length > 3 ? ` e mais ${issues.length - 3}` : ''} antes de salvar.`
          : 'Importado como rascunho pausado. Revise a configuração e ative quando estiver pronto.',
      );
      onSelectedIdChange?.(null);
    } catch (caught) {
      setImportNotice(null);
      setActionError(caught instanceof Error ? caught.message : 'Não foi possível importar o funil.');
    }
  };

  const exportFunnel = () => {
    if (!shownFunnel) return;
    const blob = new Blob([serializeFunnelExport(draft)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = (draft.name || 'funil')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'funil';
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}.kodety-funnel.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (loading && !funnels.length) return (
    <div className="grid h-full min-h-72 place-items-center bg-[var(--kodety-panel)] text-[10px] text-[var(--kodety-info-copy)]" role="status">
      <span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />Carregando funis…</span>
    </div>
  );

  return (
    <div data-kodety-onboarding="analytics-funnels-body" data-kodety-onboarding-draft={dirty ? 'funnel' : undefined} className="grid min-h-0 flex-1 bg-[var(--kodety-panel)] xl:grid-cols-[minmax(0,1fr)_360px]">
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.kodety-funnel.json,application/json"
        className="hidden"
        aria-label="Importar arquivo de funil"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) void importFunnelFile(file);
          event.currentTarget.value = '';
        }}
      />
      <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="px-4 pt-5 sm:px-6">
            {activationLocked ? (
              <AnalyticsPlanBanner
                access={featureAccess}
                compact
                showWhenLicensed
                title="Funis no plano Pro"
                description="Você pode montar e salvar rascunhos. A ativação, a coleta e os resultados ficam bloqueados até a licença Pro estar ativa."
              />
            ) : null}
            <AnalyticsPageHeader
              className={activationLocked ? 'mt-4' : undefined}
              icon={Route}
              title={shownFunnel?.name || 'Funis'}
              description="Conecte páginas, eventos e automações em jornadas mensuráveis."
              meta={<>
                <span><Calendar className="size-2.5 shrink-0" />{period.from} — {period.to}</span>
                {shownFunnel ? <span className="inline-flex items-center gap-1.5"><span className={cn('size-1.5 rounded-full', shownFunnel.enabled && !activationLocked ? 'bg-[var(--kodety-success)]' : 'bg-white/25')} />{shownFunnel.enabled && !activationLocked ? 'Ativo' : 'Rascunho pausado'}</span> : null}
                {dirty ? <span className="text-[var(--kodety-warning)]"><Save className="size-2.5 shrink-0" />Alterações não salvas</span> : null}
              </>}
              actions={<>
                {onPeriodChange ? <AnalyticsPeriodPicker period={period} onChange={onPeriodChange} compact featureAccess={featureAccess} /> : null}
                <Button variant="ghost" size="icon-xs" onClick={() => importInputRef.current?.click()} aria-label="Importar funil" title="Importar funil" disabled={!onCreate || saving}><Upload /></Button>
                {shownFunnel ? <Button variant="ghost" size="icon-xs" onClick={exportFunnel} aria-label="Exportar funil" title="Exportar funil"><Download /></Button> : null}
              </>}
            />
          </div>

          {(error || actionError) && <div role="alert" className="mx-4 mt-3 flex min-h-9 items-center rounded-[9px] border border-[var(--kodety-danger)]/20 bg-[var(--kodety-danger)]/[.06] px-3 text-[10px] text-[var(--kodety-info-copy)]">{actionError || error}</div>}
          {importNotice && <div role="status" className="mx-4 mt-3 flex min-h-9 items-center rounded-[9px] border border-white/[.065] bg-white/[.025] px-3 text-[10px] text-[var(--kodety-info-copy)]">{importNotice}</div>}
          {confirmDelete && <div role="alert" className="mx-4 mt-3 flex min-h-9 items-center justify-between gap-4 rounded-[9px] border border-[var(--kodety-warning)]/20 bg-[var(--kodety-warning)]/[.05] px-3 text-[10px] text-[var(--kodety-info-copy)]"><span>Clique em excluir novamente para confirmar.</span><Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>Cancelar</Button></div>}

          {shownFunnel ? <div className="m-4 min-h-0 flex-1 overflow-hidden rounded-[9px] border border-white/[.055] sm:mx-6"><FunnelCanvas
            funnel={shownFunnel}
            experiments={experiments}
            emailOptions={emailOptions}
            selectedStepId={selectedStepId}
            selectedConnectionId={selectedConnectionId}
            onSelectStep={setSelectedStepId}
            onSelectConnection={setSelectedConnectionId}
            onChange={changeDraft}
          /></div> : (
            <AnalyticsEmptyState
              icon={Route}
              className="min-h-0 flex-1"
              title="Crie seu primeiro funil"
              description="Conecte páginas, cliques rastreados e eventos personalizados em uma jornada visual."
              action={<div className="flex gap-2"><Button size="xs" onClick={() => {
                  setCreating(true);
                  const nextDraft = createEmptyFunnel();
                  draftCache.current.set('__new__', nextDraft);
                  dirtyDrafts.current.delete('__new__');
                  setDraft(nextDraft);
                  setDirty(false);
                  setImportNotice(null);
                  setSelectedStepId(nextDraft.steps[0]?.id || null);
                  onSelectedIdChange?.(null);
                }}><Plus />Novo funil</Button><Button variant="ghost" size="xs" disabled={!onCreate} onClick={() => importInputRef.current?.click()}><Upload />Importar</Button></div>}
            />
          )}
      </main>

      {shownFunnel ? (
        <FunnelEditor
          value={draft}
          pages={pages}
          trackingTargets={trackingTargets}
          experiments={experiments}
          emailOptions={emailOptions}
          selectedStepId={selectedStepId}
          selectedConnectionId={selectedConnectionId}
          onSelectStep={setSelectedStepId}
          onSelectConnection={setSelectedConnectionId}
          busy={saving}
          persistenceAvailable={creating ? Boolean(onCreate) : Boolean(onUpdate)}
          activationLocked={activationLocked}
          onChange={changeDraft}
          onSave={save}
          onDelete={selected && onDelete ? remove : undefined}
        />
      ) : (
        <aside className="hidden border-l border-[var(--kodety-divider)] bg-[var(--kodety-panel)] xl:block">
          <AnalyticsEmptyState icon={MousePointerClick} className="h-full" title="Nenhum funil selecionado" description="Selecione ou crie um funil para editar suas etapas." />
        </aside>
      )}
    </div>
  );
}
