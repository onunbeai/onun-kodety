'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { Sparkles, X } from '@/components/ui/gravity-icons';
import { cn } from '@/lib/utils';
import { OPEN_HTML_AGENT_PANEL_EVENT } from '@/lib/html-editor/agent-panel-events';

// The closed rail is part of every workspace, while the full Agent brings its
// chat/runtime dependencies. Load that graph only after the user opens it so
// Settings and Analytics can paint without paying for an unused panel.
const HtmlAgentPanel = lazy(() =>
  import('./HtmlAgentPanel').then(module => ({ default: module.HtmlAgentPanel })),
);

export function HtmlWorkspaceAgentDock({
  surfaceLabel,
  preferredSkill,
}: {
  surfaceLabel: string;
  preferredSkill?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openAgent = () => setOpen(true);
    window.addEventListener(OPEN_HTML_AGENT_PANEL_EVENT, openAgent);
    return () => window.removeEventListener(OPEN_HTML_AGENT_PANEL_EVENT, openAgent);
  }, []);

  return (
    <aside
      data-workspace-agent-dock
      data-kodety-onboarding="workspace-agent"
      data-open={open ? 'true' : 'false'}
      aria-label={`Agent · ${surfaceLabel}`}
      className={cn(
        'relative z-40 flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--kodety-divider)] bg-[#121212] text-foreground transition-[width] duration-200',
        open
          ? 'w-[min(420px,42vw)] min-w-[340px] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-[80] max-md:w-full max-md:min-w-0'
          : 'w-11',
      )}
    >
      <header className={cn('h-10 shrink-0 items-center gap-2 border-b border-white/[0.065] px-2.5', open ? 'flex' : 'hidden')}>
        <Sparkles className="size-3.5 text-[var(--kodety-accent-hover)]" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">Agent · {surfaceLabel}</span>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-[8px] text-muted-foreground outline-none transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-1 focus-visible:ring-white/20"
          aria-label="Recolher Agent"
          title="Recolher Agent"
          onClick={() => setOpen(false)}
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className={cn('min-h-0 flex-1', !open && 'hidden')}>
        {open ? (
          <Suspense
            fallback={(
              <div className="grid h-full place-items-center px-4 text-center text-[10px] text-muted-foreground" role="status">
                Carregando Agent…
              </div>
            )}
          >
            <HtmlAgentPanel visible preferredSkill={preferredSkill} />
          </Suspense>
        ) : null}
      </div>
      {!open && (
        <button
          type="button"
          className="group flex h-full w-full flex-col items-center gap-2 pt-3 text-muted-foreground outline-none transition-colors hover:bg-white/[0.035] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/20"
          aria-label={`Abrir Agent em ${surfaceLabel}`}
          title={`Abrir Agent · ${surfaceLabel} · ⌥6`}
          onClick={() => setOpen(true)}
        >
          <span className="grid size-7 place-items-center rounded-[8px] bg-white/[0.055] transition-colors group-hover:bg-white/[0.09]">
            <Sparkles className="size-3.5" />
          </span>
          <span className="text-[8px] font-medium uppercase tracking-[0.12em] [writing-mode:vertical-rl]">Agent</span>
        </button>
      )}
    </aside>
  );
}
