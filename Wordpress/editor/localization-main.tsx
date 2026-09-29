import React, { Suspense } from 'react';
import { WordPressBuilderOnboarding } from './WordPressBuilderOnboarding';
import { WordPressAgentProvider } from './WordPressAgentProvider';
import { wordpressEntryConfig } from './wordpress-entry-config';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import { useWordPressLicenseRevision, WordPressTrialNotice } from './WordPressTrialNotice';

type LocalizationEntryWindow = typeof window & {
  kodetyLocalizationManualMount?: boolean;
  kodetyMountLocalization?: () => void;
  kodetyImportLocalizationChunk?: (file: string) => Promise<unknown>;
  kodetyWordPress?: {
    localizationFileUrl?: string;
  };
};

const extensionWindow = window as LocalizationEntryWindow;

// The extension stays private even after code splitting. Rollup redirects its
// generated imports here and WordPress resolves each file behind capability
// checks instead of exposing a public assets directory.
extensionWindow.kodetyImportLocalizationChunk = (file: string) => {
  const source = extensionWindow.kodetyWordPress?.localizationFileUrl || '';
  if (!source) return Promise.reject(new Error('O carregador privado da Localização não está disponível.'));
  let normalized = file.replace(/^\.\//, '');
  if (!normalized.includes('/')) normalized = `chunks/${normalized}`;
  // Keep the private module URL byte-identical to PHP's static-import rewrite
  // and modulepreload URL. Re-serializing the query through URLSearchParams
  // can reorder parameters or turn `%20` into `+`; browsers then evaluate the
  // same ESM chunk twice and isolate the Agent bridge store from the workspace.
  const separator = source.includes('?') ? '&' : '?';
  const url = `${source}${separator}file=${encodeURIComponent(normalized)}`;
  return import(/* @vite-ignore */ url);
};

// Start downloading the full workspace as soon as the small entry evaluates,
// while still allowing the loading screen to paint before its large graph is
// parsed. The project ZIP is prefetched independently by the core at the same
// time, so neither request waits for the other.
const localizationWorkspaceModule = import('./WordPressLocalizationWorkspace');
const WordPressLocalizationWorkspace = React.lazy(() => localizationWorkspaceModule);

function LocalizationWithLicense() {
  useWordPressLicenseRevision();
  return <WordPressAgentProvider><WordPressLocalizationWorkspace /><WordPressTrialNotice /><WordPressBuilderOnboarding config={wordpressEntryConfig()} /></WordPressAgentProvider>;
}

interface LocalizationErrorBoundaryState {
  error: Error | null;
}

class LocalizationErrorBoundary extends React.Component<React.PropsWithChildren, LocalizationErrorBoundaryState> {
  state: LocalizationErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): LocalizationErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error('A tela de localização encontrou um erro inesperado.'),
    };
  }

  componentDidCatch(error: Error) {
    console.error('[Onun Kodety Localization]', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="dark grid h-dvh place-items-center bg-background p-8 text-center text-foreground">
        <div className="max-w-sm" role="alert" aria-live="assertive">
          <h1 className="text-sm font-semibold">A localização não pôde continuar</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Seu projeto continua preservado. Recarregue esta tela para retomar a última versão salva.
          </p>
          <p className="mt-3 break-words rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
            {this.state.error.message}
          </p>
          <Button className="mt-4" size="sm" onClick={() => window.location.reload()}>
            Recarregar localização
          </Button>
        </div>
      </main>
    );
  }
}

const root = document.getElementById('kodety-root');
let localizationMounted = false;

export function mountLocalization() {
  if (localizationMounted) return;
  if (!root) throw new Error('O host da extensão Multi-language não foi encontrado.');
  localizationMounted = true;
  root.dataset.kodetyLocalizationMounted = 'true';
  createRoot(root).render(
    <React.StrictMode>
      <LocalizationErrorBoundary>
        <Suspense fallback={<KodetyLoadingScreen label="Carregando idiomas" className="h-screen min-h-0" />}>
          <LocalizationWithLicense />
        </Suspense>
      </LocalizationErrorBoundary>
    </React.StrictMode>,
  );
}

// Backward compatibility: an older Onun Kodety core does not know the manual mount
// handshake and expects importing the extension to start it immediately.
// Vite application entries may omit named ESM exports in production. The
// global handshake remains a stable mount contract for the independently
// packaged extension while the exported function helps source/dev consumers.
extensionWindow.kodetyMountLocalization = mountLocalization;
if (!extensionWindow.kodetyLocalizationManualMount) mountLocalization();
