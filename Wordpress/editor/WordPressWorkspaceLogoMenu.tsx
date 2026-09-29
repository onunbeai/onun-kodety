import { House } from '@/components/ui/gravity-icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EditorCornerMenuGlyph } from '@/lib/html-editor/EditorChromeBits';
import { HtmlKodetyUpdateMenuItems } from '@/app/(builder)/kodety/html-editor/components/HtmlKodetyUpdates';
import { HtmlOnboardingMenuItem, useOnboardingMenuLaunch } from '@/app/(builder)/kodety/html-editor/components/HtmlOnboardingMenuItem';
import { requestWorkspaceNavigationWithEditorLockHandoff } from './editor-lock-navigation';
import type { KodetyWordPressEntryConfig } from './wordpress-entry-config';

export function WordPressWorkspaceLogoMenu({ config, onBack, onNavigate = requestWorkspaceNavigationWithEditorLockHandoff }: {
  config?: KodetyWordPressEntryConfig;
  onBack?: () => void;
  onNavigate?: (href: string) => Promise<boolean>;
}) {
  const onboardingMenu = useOnboardingMenuLaunch();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button ref={onboardingMenu.triggerRef} type="button" data-editor-corner-menu-trigger data-kodety-onboarding="onboarding-menu"
          aria-label="Abrir menu do Onun Kodety" title="Abrir menu do Onun Kodety"
          className="group grid size-[50px] shrink-0 place-items-center border-r border-[var(--kodety-divider)] bg-transparent text-[var(--kodety-text)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]">
          <span className="grid size-9 place-items-center rounded-[7px] transition-colors group-hover:bg-white/[.055] group-data-[state=open]:bg-white/[.09]">
            <EditorCornerMenuGlyph name={config?.editorCornerIcon} logoUrl={config?.brandLogoUrl} />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-kodety-logo-menu align="start" sideOffset={8} collisionPadding={12}
        onCloseAutoFocus={onboardingMenu.onCloseAutoFocus}
        className="kodety-editor-topbar-overlay z-[10010] w-64 rounded-[10px] border-white/[.08] bg-[var(--kodety-panel)] p-1 shadow-[var(--kodety-shadow-popover)]">
        {onBack ? <DropdownMenuItem onSelect={() => onBack()}><House /> Voltar ao painel</DropdownMenuItem> : <DropdownMenuItem asChild>
          <a href={config?.dashboardUrl || '/kodety/'} data-kodety-workspace-navigation="native"><House /> Voltar ao painel</a>
        </DropdownMenuItem>}
        <DropdownMenuSeparator />
        {config?.updates && <HtmlKodetyUpdateMenuItems config={config.updates} nonce={config.nonce}
          onOpenUpdates={() => { void onNavigate(config.updates!.pageUrl); }} />}
        <HtmlOnboardingMenuItem onRequest={onboardingMenu.requestOnboarding} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
