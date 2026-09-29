'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Monitor, RefreshCw, RotateCcw, Smartphone } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';

export interface PublicationSnapshot {
  id: string;
  modified: string;
  current: boolean;
  downloadUrl?: string;
  previewUrl?: string;
  restoreUrl?: string;
}

interface SnapshotPreviewData {
  release: string;
  url: string;
  expiresAt: string;
  pages: Array<{ path: string; url: string }>;
}

export function HtmlSnapshotPreview({
  snapshot,
  nonce,
  readOnly,
  restoring,
  onRestore,
  onClose,
}: {
  snapshot: PublicationSnapshot;
  nonce: string;
  readOnly: boolean;
  restoring: boolean;
  onRestore: () => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<SnapshotPreviewData | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [mobile, setMobile] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const selectedPageRef = useRef({ release: snapshot.id, path: '' });
  const [expired, setExpired] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setPageUrl('');
    setError('');
    setExpired(false);
    if (selectedPageRef.current.release !== snapshot.id) selectedPageRef.current = { release: snapshot.id, path: '' };
    const timer = window.setTimeout(() => {
      controller.abort();
      setError('A preparação da prévia demorou demais. Tente novamente.');
    }, 15_000);
    void (async () => {
      try {
        if (!snapshot.previewUrl) throw new Error('A prévia deste snapshot não está disponível.');
        const response = await fetch(snapshot.previewUrl, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'X-WP-Nonce': nonce },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Não foi possível carregar a prévia.');
        if (payload.release !== snapshot.id || typeof payload.url !== 'string' || !payload.url
          || !Array.isArray(payload.pages) || !payload.pages.length
          || !payload.pages.every((page: { path?: unknown; url?: unknown }) => typeof page?.path === 'string' && typeof page.url === 'string' && page.url)
          || !Number.isFinite(Date.parse(payload.expiresAt))) {
          throw new Error('A prévia recebida não corresponde ao snapshot escolhido.');
        }
        if (controller.signal.aborted) return;
        setPreview(payload);
        const selectedPage = payload.pages.find((page: { path: string }) => page.path === selectedPageRef.current.path)
          || payload.pages.find((page: { url: string }) => page.url === payload.url) || payload.pages[0];
        selectedPageRef.current = { release: snapshot.id, path: selectedPage.path };
        setPageUrl(selectedPage.url);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a prévia.');
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [snapshot.id, snapshot.previewUrl, nonce, attempt]);

  useEffect(() => {
    if (!preview) return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    if (remaining <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [preview]);

  useEffect(() => {
    setPageError('');
    setPageLoading(Boolean(pageUrl));
  }, [pageUrl]);

  useEffect(() => {
    if (!pageLoading) return;
    const timer = window.setTimeout(() => {
      setPageLoading(false);
      setPageError('A página ainda não respondeu. Recarregue a prévia para tentar novamente.');
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [pageUrl, pageLoading]);

  const restore = async () => {
    setRestoreError('');
    try {
      await onRestore();
    } catch (cause) {
      setRestoreError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o snapshot.');
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !restoring) onClose(); }}>
      <DialogContent
        width="1180px"
        className="z-[10030] h-[min(900px,92dvh)] gap-0 overflow-hidden p-0"
        overlayClassName="z-[10029]"
        showCloseButton={!restoring}
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (restoring) event.preventDefault(); }}
      >
        <header className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-sm">Prévia do snapshot</DialogTitle>
          <DialogDescription className="mt-1 break-all text-xs">
            {snapshot.id} · {new Date(snapshot.modified).toLocaleString(getAdminUiLocale())}
          </DialogDescription>
        </header>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            Página
            <select
              aria-label="Página do snapshot"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
              value={pageUrl}
              disabled={!preview || restoring || expired}
              onChange={event => {
                const page = preview?.pages.find(candidate => candidate.url === event.target.value);
                if (!page) return;
                selectedPageRef.current = { release: snapshot.id, path: page.path };
                setPageUrl(page.url);
              }}
            >
              {!preview && <option value="">Carregando…</option>}
              {preview?.pages.map(page => <option key={page.path} value={page.url}>{page.path}</option>)}
            </select>
          </label>
          <div className="flex gap-1" role="group" aria-label="Tamanho da prévia">
            <Button type="button" size="icon-sm" variant={!mobile ? 'secondary' : 'ghost'} aria-label="Desktop" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor /></Button>
            <Button type="button" size="icon-sm" variant={mobile ? 'secondary' : 'ghost'} aria-label="Celular" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone /></Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Recarregar prévia" disabled={restoring} onClick={() => setAttempt(value => value + 1)}><RefreshCw /></Button>
          </div>
        </div>
        {(expired || pageError || pageLoading) && <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {expired ? 'O link expirou. Recarregue a prévia para continuar navegando nesta versão.' : pageError || 'Carregando página…'}
        </p>}
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-black/20 p-3">
          {error ? (
            <div className="m-auto max-w-md p-6 text-center" role="alert">
              <p className="text-sm">{error}</p>
              <Button className="mt-4" variant="secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw /> Tentar novamente</Button>
            </div>
          ) : pageUrl ? (
            <iframe
              key={`${attempt}:${pageUrl}`}
              title={`Prévia do snapshot ${snapshot.id}`}
              src={pageUrl}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              onLoad={() => { setPageLoading(false); setPageError(''); }}
              onError={() => { setPageLoading(false); setPageError('Não foi possível carregar a página. Recarregue a prévia.'); }}
              className="h-full min-h-40 shrink-0 border-0 bg-white shadow-lg"
              style={{ width: mobile ? 390 : '100%', maxWidth: '100%' }}
            />
          ) : (
            <p className="m-auto flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" /> Preparando prévia…</p>
          )}
        </div>
        <footer className="max-h-[45vh] shrink-0 overflow-auto border-t border-border px-5 py-4">
          {confirming ? (
            <div className="space-y-3" role="alertdialog" aria-label="Confirmar restauração do snapshot">
              <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-amber-400" /> Restaurar esta versão?</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {`O projeto aberto e o site publicado serão substituídos pelo snapshot ${snapshot.id}. Alterações posteriores serão descartadas. Baixe o projeto atual antes de continuar se precisar guardá-las. Dados de CMS e integrações não fazem parte desta restauração.`}
              </p>
              {restoreError && <p className="text-xs text-destructive" role="alert">{restoreError}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button autoFocus variant="secondary" disabled={restoring} onClick={() => { setConfirming(false); setRestoreError(''); }}>Voltar à prévia</Button>
                <Button variant="destructive" disabled={restoring || readOnly} onClick={() => void restore()}>
                  {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  {restoring ? 'Restaurando…' : 'Confirmar restauração'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-[11px] leading-5 text-muted-foreground">Os arquivos são desta publicação; conteúdo dinâmico pode variar. A prévia expira em 15 minutos e não altera o projeto aberto.</p>
              <div className="flex flex-wrap gap-2">
                {snapshot.downloadUrl && <Button variant="secondary" asChild><a href={snapshot.downloadUrl} target="_blank" rel="noopener noreferrer"><Download /> Baixar ZIP</a></Button>}
                {snapshot.restoreUrl && <Button disabled={!preview || readOnly} onClick={() => setConfirming(true)}><RotateCcw /> Restaurar esta versão</Button>}
              </div>
            </div>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
