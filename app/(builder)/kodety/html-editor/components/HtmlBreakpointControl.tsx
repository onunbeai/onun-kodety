'use client';

import { ChevronDown, Play } from '@/components/ui/gravity-icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Breakpoint } from '@/lib/html-editor/css-patcher';
import { resolveBreakpointSelection } from '@/lib/html-editor/breakpoint-manager';
import { HtmlBreakpointDeviceIcon } from './HtmlBreakpointDeviceIcon';
import { BreakpointManager } from './HtmlInspector';

interface HtmlBreakpointControlProps {
  variant?: 'floating' | 'frame';
  agentActivityLabel?: string | null;
  primaryBreakpoint: Breakpoint;
  breakpoints: Breakpoint[];
  activeId: string;
  onSelect: (id: string) => void;
  onPreview?: (id: string) => void;
  onPrimaryChange: (next: Breakpoint) => void;
  onChange: (next: Breakpoint[]) => void;
}

export function HtmlBreakpointControl({
  variant = 'floating',
  agentActivityLabel = null,
  primaryBreakpoint,
  breakpoints,
  activeId,
  onSelect,
  onPreview,
  onPrimaryChange,
  onChange,
}: HtmlBreakpointControlProps) {
  const safeActiveId = resolveBreakpointSelection(activeId, breakpoints);
  const active = safeActiveId === 'base'
    ? primaryBreakpoint
    : breakpoints.find(breakpoint => breakpoint.id === safeActiveId) || primaryBreakpoint;
  const isFrame = variant === 'frame';
  const frameAgentActivityLabel = isFrame ? agentActivityLabel?.trim() || '' : '';

  return (
    <div
      className={isFrame
        ? 'flex h-7 w-full min-w-0 items-center rounded-t-[7px] bg-[var(--kodety-accent-muted)] text-[var(--kodety-accent-hover)] shadow-[0_-1px_0_rgba(255,255,255,.045)_inset]'
        : 'contents'}
    >
      {isFrame && !frameAgentActivityLabel && (
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-l-[7px] transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
          onClick={(event) => {
            event.stopPropagation();
            onPreview?.(safeActiveId);
          }}
          disabled={!onPreview}
          title={`Preview de ${active.label}`}
          aria-label={`Abrir preview de ${active.label}`}
        >
          <Play className="size-3 fill-current" />
        </button>
      )}
      {frameAgentActivityLabel && (
        <div
          data-agent-canvas-activity
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={frameAgentActivityLabel}
          className="flex h-7 min-w-0 max-w-[230px] shrink items-center gap-2 rounded-l-[7px] px-2 text-[9px] font-medium tracking-[0.01em] text-[#c8c4ff]"
        >
          <span className="min-w-0 truncate">{frameAgentActivityLabel}</span>
          <span aria-hidden="true" className="kodety-agent-frame-dots shrink-0">
            {[0, -140, -280, -420, -560, -350, -490, -630, -770, -910].map((delay, index) => (
              <span
                key={`${delay}-${index}`}
                className="kodety-agent-frame-dot"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        </div>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={isFrame
              ? 'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-r-[7px] px-1.5 text-[10px] transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]'
              : 'flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)]/95 px-2 text-[10px] text-[var(--kodety-text-secondary)] shadow-[0_6px_18px_rgba(0,0,0,.22)] backdrop-blur transition-colors hover:bg-[var(--kodety-control)] hover:text-[var(--kodety-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kodety-focus)]'}
            aria-label="Selecionar e gerenciar breakpoints"
          >
            {!frameAgentActivityLabel && (
              <>
                {!isFrame && <span className="text-[var(--kodety-text-tertiary)]"><HtmlBreakpointDeviceIcon width={active.width} className="size-3.5" /></span>}
                <span className="max-w-24 truncate font-medium">{active.label}</span>
                <span className={isFrame ? 'font-mono text-[9px] text-[var(--kodety-accent-hover)]/70' : 'font-mono text-[9px] text-[var(--kodety-text-tertiary)]'}>{active.width}</span>
              </>
            )}
            {isFrame ? (
              <>
                <span className="flex-1" />
                <span className="hidden truncate text-[9px] font-medium text-[var(--kodety-accent-hover)]/65 min-[380px]:inline">Breakpoint</span>
                <ChevronDown className="size-3 text-[var(--kodety-accent-hover)]/70" />
              </>
            ) : <ChevronDown className="size-3 text-[var(--kodety-text-tertiary)]" />}
          </button>
        </PopoverTrigger>
        <PopoverContent side={isFrame ? 'bottom' : 'top'} align="end" sideOffset={8} className="w-[330px] max-w-[calc(100vw-24px)] rounded-[10px] border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel-raised)] p-3 shadow-[var(--kodety-shadow-popover)]">
          <header className="mb-2.5 border-b border-[var(--kodety-divider)] pb-2.5">
            <h3 className="text-[11px] font-semibold tracking-[-0.01em] text-[var(--kodety-text)]">Breakpoints</h3>
            <p className="mt-1 text-[9px] leading-4 text-[var(--kodety-text-tertiary)]">O principal define o canvas base; os demais herdam a cascata e salvam apenas os próprios ajustes.</p>
          </header>
          <BreakpointManager
            primaryBreakpoint={primaryBreakpoint}
            onPrimaryChange={onPrimaryChange}
            breakpoints={breakpoints}
            onChange={onChange}
            activeId={safeActiveId}
            onSelect={onSelect}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
