'use client';

import { memo, useEffect } from 'react';
import { BellIcon } from '@solar-icons/react/bold-duotone/bell';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Download, RefreshCw } from '@/components/ui/gravity-icons';
import {
  useKodetyUpdateStore,
  type KodetyUpdateClientConfig,
  type KodetyUpdateStatus,
} from '@/stores/useKodetyUpdateStore';

const UPDATE_AVAILABLE_TOAST_ID = 'kodety:update-available';

function showUpdateAvailableToast(
  status: Pick<KodetyUpdateStatus, 'latestVersion'>,
  onOpenUpdates: () => void,
) {
  toast.info(`Kodety ${status.latestVersion} está disponível`, {
    id: UPDATE_AVAILABLE_TOAST_ID,
    duration: Infinity,
    closeButton: false,
    action: {
      label: 'Atualizar',
      onClick: () => {
        toast.dismiss(UPDATE_AVAILABLE_TOAST_ID);
        onOpenUpdates();
      },
    },
    classNames: {
      actionButton:
        'h-8! rounded-lg! bg-[#9393FF]/15! px-3.5! text-[11px]! font-semibold! text-[#C4C4FF]! hover:bg-[#9393FF]/22! hover:text-white! [&_svg]:text-current! [&_svg]:opacity-100!',
    },
  });
}

function useUpdateConfig(config: KodetyUpdateClientConfig, nonce: string) {
  const configure = useKodetyUpdateStore(state => state.configure);
  const identity = checkConfigIdentity(config);
  useEffect(() => configure(config, nonce), [configure, identity, nonce]);
}

function checkConfigIdentity(config: KodetyUpdateClientConfig) {
  return `${config.currentVersion}|${config.checkUrl}|${config.pageUrl}`;
}

interface HtmlKodetyUpdateProps {
  config: KodetyUpdateClientConfig;
  nonce: string;
  onOpenUpdates: () => void;
  topbarClassName?: string;
}

/**
 * This subscriber checks once when the Builder opens. Discovery never adds
 * state to HtmlProjectEditor or wakes the monolith when only the badge changes.
 */
export const HtmlKodetyUpdateIndicator = memo(function HtmlKodetyUpdateIndicator({
  config,
  nonce,
  onOpenUpdates,
  topbarClassName,
}: HtmlKodetyUpdateProps) {
  useUpdateConfig(config, nonce);
  const available = useKodetyUpdateStore(state => state.updateAvailable);
  const latestVersion = useKodetyUpdateStore(state => state.latestVersion);
  const checkForUpdates = useKodetyUpdateStore(state => state.checkForUpdates);

  useEffect(() => {
    void checkForUpdates().catch(() => undefined);
  }, [checkForUpdates]);

  useEffect(() => {
    if (available) {
      showUpdateAvailableToast({ latestVersion }, onOpenUpdates);
      return;
    }
    toast.dismiss(UPDATE_AVAILABLE_TOAST_ID);
  }, [available, latestVersion, onOpenUpdates]);

  if (!available) return null;
  const tooltip = `Atualização Kodety ${latestVersion} disponível`;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="secondary"
      className={topbarClassName}
      data-tooltip={tooltip}
      aria-label={tooltip}
      onClick={onOpenUpdates}
    >
      <BellIcon />
    </Button>
  );
});

export const HtmlKodetyUpdateMenuItems = memo(function HtmlKodetyUpdateMenuItems({
  config,
  nonce,
  onOpenUpdates,
}: Omit<HtmlKodetyUpdateProps, 'topbarClassName'>) {
  useUpdateConfig(config, nonce);
  const available = useKodetyUpdateStore(state => state.updateAvailable);
  const latestVersion = useKodetyUpdateStore(state => state.latestVersion);
  const checking = useKodetyUpdateStore(state => state.checking);
  const checkForUpdates = useKodetyUpdateStore(state => state.checkForUpdates);

  const runCheck = async () => {
    try {
      const status = await checkForUpdates();
      if (status.updateAvailable) showUpdateAvailableToast(status, onOpenUpdates);
      else {
        toast.dismiss(UPDATE_AVAILABLE_TOAST_ID);
        toast.success('O Kodety já está atualizado');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível buscar atualizações');
    }
  };

  return (
    <>
      {available && (
        <DropdownMenuItem onSelect={event => {
          event.preventDefault();
          onOpenUpdates();
        }}>
          <Download className="text-[var(--kodety-accent-hover)]!" />
          Atualizar Kodety
          <span className="ml-auto text-[9px] font-medium text-[var(--kodety-accent-hover)]">v{latestVersion}</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        disabled={checking}
        onSelect={event => {
          event.preventDefault();
          void runCheck();
        }}
      >
        <RefreshCw className={checking ? 'animate-spin' : undefined} />
        {checking ? 'Buscando atualizações…' : 'Buscar atualizações'}
      </DropdownMenuItem>
    </>
  );
});

export type { KodetyUpdateClientConfig };
