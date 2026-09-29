import { ChartSquareIcon } from '@solar-icons/react/bold-duotone/chart-square';
import { CursorIcon } from '@solar-icons/react/bold-duotone/cursor';
import { DatabaseIcon } from '@solar-icons/react/bold-duotone/database';
import { HtmlCmsManager } from '@/app/(builder)/kodety/html-editor/components/HtmlCmsManager';
import { HtmlWorkspaceAgentDock } from '@/app/(builder)/kodety/html-editor/components/HtmlWorkspaceAgentDock';
import { useWordPressNativePanelAgent } from './use-wordpress-native-panel-agent';
import { WordPressWorkspaceLogoMenu } from './WordPressWorkspaceLogoMenu';
import { cn } from '@/lib/utils';
import { Toaster } from 'sonner';
import {
  wordpressEntryConfig,
  wordpressEntryReadOnly,
  type KodetyWordPressEntryConfig,
} from './wordpress-entry-config';
import { WORDPRESS_WORKSPACE_TOASTER_PROPS } from './wordpress-workspace-toaster';
import { requestWorkspaceNavigationWithEditorLockHandoff } from './editor-lock-navigation';

type WorkspacePrimaryArea = 'design' | 'cms' | 'insights';

function navigate(href: string | undefined, fallback: string) {
  void requestWorkspaceNavigationWithEditorLockHandoff(href || fallback).catch(() => undefined);
}

function WorkspaceTopbar({ config }: { config: KodetyWordPressEntryConfig }) {
  const openArea = (area: WorkspacePrimaryArea) => {
    if (area === 'design') navigate(config.editorUrl, '/kodety/editor/');
    else if (area === 'cms') navigate(config.cmsUrl, '/kodety/cms/');
    else navigate(config.analyticsUrl, '/kodety/analytics/');
  };
  const itemClass = (active: boolean) =>
    cn(
      'group flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] px-3.5 text-[11px] font-medium outline-none transition-colors hover:bg-white/[0.07] hover:text-[var(--kodety-text)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]',
      active ? 'bg-white/[0.11] text-[var(--kodety-text)]' : 'text-[var(--kodety-text-tertiary)]',
    );
  return (
    <header
      data-workspace-topbar
      className="relative z-[10000] flex h-[50px] shrink-0 items-center gap-1.5 border-b border-[var(--kodety-divider)] bg-[var(--kodety-chrome)] pl-0 pr-2"
    >
      <WordPressWorkspaceLogoMenu config={config} />
      <nav data-workspace-primary-navigation aria-label="Área do projeto" className="flex min-w-0 items-center gap-0.5">
        <button type="button" className={itemClass(false)} onClick={() => openArea('design')}>
          <CursorIcon className="size-4 text-[var(--kodety-text-tertiary)] transition-colors group-hover:text-[var(--kodety-text-secondary)]" />
          <span>Design</span>
        </button>
        {(config.cmsItemsUrl || config.cmsUrl) && (
          <button type="button" aria-current="page" className={itemClass(true)} onClick={() => openArea('cms')}>
            <DatabaseIcon className="size-4 text-[var(--kodety-text-secondary)]" />
            <span>CMS</span>
          </button>
        )}
        {config.analyticsUrl && config.canViewAnalytics && (
          <button type="button" className={itemClass(false)} onClick={() => openArea('insights')}>
            <ChartSquareIcon className="size-4 text-[var(--kodety-text-tertiary)] transition-colors group-hover:text-[var(--kodety-text-secondary)]" />
            <span>Insights</span>
          </button>
        )}
      </nav>
    </header>
  );
}

export default function WordPressCmsWorkspace() {
  const config = wordpressEntryConfig();
  const readOnly = wordpressEntryReadOnly(config);
  useWordPressNativePanelAgent('cms', readOnly);

  if (!config?.cmsItemsUrl) {
    return (
      <main className="dark grid h-screen place-items-center bg-background p-8 text-center text-foreground">
        <div>
          <h1 className="text-sm font-semibold">CMS indisponível</h1>
          <p className="mt-1 text-xs text-muted-foreground">Esta conta não possui acesso ao CMS deste projeto.</p>
        </div>
      </main>
    );
  }

  return (
    <main
      data-kodety-read-only={readOnly ? 'true' : undefined}
      className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <WorkspaceTopbar config={config} />
      <div className="relative flex min-h-0 flex-1">
        <div data-kodety-agent-surface="cms" className="relative min-w-0 flex-1">
          <HtmlCmsManager
            open
            standalone
            readOnly={readOnly}
            backHref={config.editorUrl || config.dashboardUrl || '/wp-admin/'}
            onNavigate={requestWorkspaceNavigationWithEditorLockHandoff}
            onOpenChange={() => navigate(config.editorUrl || config.dashboardUrl, '/wp-admin/')}
            initialPostType={new URLSearchParams(window.location.search).get('collection') || undefined}
          />
        </div>
        <HtmlWorkspaceAgentDock surfaceLabel="CMS" />
      </div>
      <Toaster {...WORDPRESS_WORKSPACE_TOASTER_PROPS} />
    </main>
  );
}
