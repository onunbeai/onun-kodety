import type { ReactNode } from 'react';
import { ChartSquareIcon } from '@solar-icons/react/bold-duotone/chart-square';
import { CursorIcon } from '@solar-icons/react/bold-duotone/cursor';
import { DatabaseIcon } from '@solar-icons/react/bold-duotone/database';
import { WordPressWorkspaceLogoMenu } from './WordPressWorkspaceLogoMenu';
import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import { cn } from '@/lib/utils';
import { HtmlWorkspaceAgentDock } from '@/app/(builder)/kodety/html-editor/components/HtmlWorkspaceAgentDock';

export type WordPressWorkspaceArea = 'design' | 'cms' | 'insights' | null;

export function WordPressWorkspaceTopbar({
  config,
  activeArea,
}: {
  config: KodetyWordPressConfig;
  activeArea: WordPressWorkspaceArea;
}) {
  const itemClass = (active: boolean) => cn(
    'group flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3.5 text-[11px] font-medium outline-none transition-colors hover:bg-white/[0.07] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]',
    active ? 'bg-white/[0.11] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)]',
  );
  return (
    <header
      data-workspace-topbar
      className="relative z-30 flex h-[50px] shrink-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] bg-[var(--kodety-chrome)] pl-0 pr-2"
    >
      <WordPressWorkspaceLogoMenu config={config} />
      <nav data-workspace-primary-navigation aria-label="Área do projeto" className="flex min-w-0 items-center gap-0.5">
        <a
          href={config.editorUrl || '/kodety/editor/'}
          data-kodety-workspace-navigation="native"
          aria-current={activeArea === 'design' ? 'page' : undefined}
          className={itemClass(activeArea === 'design')}
        >
          <CursorIcon className="size-4 text-current" />
          <span>Design</span>
        </a>
        {(config.cmsItemsUrl || config.cmsUrl) && (
          <a
            href={config.cmsUrl || '/kodety/cms/'}
            data-kodety-workspace-navigation="native"
            aria-current={activeArea === 'cms' ? 'page' : undefined}
            className={itemClass(activeArea === 'cms')}
          >
            <DatabaseIcon className="size-4 text-current" />
            <span>CMS</span>
          </a>
        )}
        {config.analyticsUrl && config.canViewAnalytics && (
          <a
            href={config.analyticsUrl}
            data-kodety-workspace-navigation="native"
            aria-current={activeArea === 'insights' ? 'page' : undefined}
            className={itemClass(activeArea === 'insights')}
          >
            <ChartSquareIcon className="size-4 text-current" />
            <span>Insights</span>
          </a>
        )}
      </nav>
    </header>
  );
}

export function WordPressWorkspaceBody({
  surfaceLabel,
  children,
}: {
  surfaceLabel: string;
  children: ReactNode;
}) {
  return (
    <div data-workspace-with-agent={surfaceLabel} className="relative flex min-h-0 flex-1 overflow-hidden">
      <div
        data-kodety-agent-surface={surfaceLabel.toLocaleLowerCase('en-US')}
        className="relative min-w-0 flex-1 overflow-hidden"
      >
        {children}
      </div>
      <HtmlWorkspaceAgentDock surfaceLabel={surfaceLabel} />
    </div>
  );
}
