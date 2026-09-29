'use client';

import { DisclosureChevron, DisclosureSummary } from '@/components/ui/disclosure-summary';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Ban, Braces, Check, ExternalLink, Gauge, Globe2, Image, Loader2, Rocket, X, Zap } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { OPEN_HTML_AGENT_PANEL_EVENT, type OpenHtmlAgentPanelDetail } from '@/lib/html-editor/agent-panel-events';

import {
  DEFAULT_PUBLISH_OPTIMIZATIONS, PUBLICATION_OPTIMIZATION_OPTIONS,
  parsePublishOptimizations, type PublishOptimizations,
} from '@/lib/html-editor/publish-optimizations';
export { DEFAULT_PUBLISH_OPTIMIZATIONS, type PublishOptimizations } from '@/lib/html-editor/publish-optimizations';

interface HtmlPublishPanelProps {
  pageUrl: string;
  displayUrl?: string;
  pageLabel: string;
  onOpenSite?: () => void;
  statusUrl?: string;
  saveUrl?: string;
  nonce: string;
  isPublishing: boolean;
  publishStage?: string;
  publishProgress?: number;
  hasChanges: boolean;
  onClose: () => void;
  onCancelPublish: () => void;
  onPublish: (optimizations: PublishOptimizations) => void;
}

const options = PUBLICATION_OPTIMIZATION_OPTIONS.map((option) => ({
  ...option,
  icon: ['optimizeImages', 'imageDimensions'].includes(option.key) ? <Image />
    : option.key === 'compressHtml' ? <Braces />
      : option.key === 'preconnect' ? <Globe2 /> : <Zap />,
}));

const PERFORMANCE_AUDIT_PROMPT = `Analise o desempenho e o carregamento do projeto atual no Kodety. Faça primeiro uma auditoria estática usando o contexto e o snapshot completos do projeto. Priorize os achados por impacto, evidência, confiança e risco, e sugira otimizações seguras para Core Web Vitals, imagens, fontes, CSS e JavaScript. Não aplique nenhuma alteração nesta etapa. Ao final, apresente um plano compacto e peça minha aprovação antes de aplicar qualquer mudança.`;

export function HtmlPublishPanel({ pageUrl, displayUrl, pageLabel, onOpenSite, statusUrl, saveUrl, nonce, isPublishing, publishStage, publishProgress = 0, hasChanges, onClose, onCancelPublish, onPublish }: HtmlPublishPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const saveDefaultsAbortRef = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState(DEFAULT_PUBLISH_OPTIMIZATIONS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [revision, setRevision] = useState('');
  const [supported, setSupported] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [applyingPublished, setApplyingPublished] = useState(false);
  const [report, setReport] = useState<{ images?: number; bytesSaved?: number; compressionBytesSaved?: number; settings?: { enabled?: boolean }; skipped?: Record<string, number>; findings?: { code: string; path: string; message: string }[] } | null>(null);
  const [release, setRelease] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [loading, setLoading] = useState(Boolean(statusUrl));
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const safeProgress = Number.isFinite(publishProgress)
    ? Math.max(0, Math.min(100, publishProgress))
    : 0;
  const formattedPublishedAt = (() => {
    if (!publishedAt) return '';
    const date = new Date(publishedAt);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(getAdminUiLocale());
  })();

  useEffect(() => {
    if (!isPublishing) { setElapsedSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isPublishing]);

  useEffect(() => () => {
    saveDefaultsAbortRef.current?.abort();
    saveDefaultsAbortRef.current = null;
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (savingDefaults || applyingPublished) return;
      const target = event.target;
      if (!(target instanceof Node) || panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-publish-trigger], [data-kodety-onboarding-ui]')) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingDefaults && !applyingPublished) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, savingDefaults, applyingPublished]);

  useEffect(() => {
    if (!statusUrl) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch(statusUrl, { credentials: 'same-origin', headers: { 'X-WP-Nonce': nonce }, signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Status unavailable')))
      .then((payload: { engineVersion?: number; settings?: unknown; revision?: string; release?: string; publishedAt?: string; canSave?: boolean; report?: typeof report }) => {
        if (!active) return;
        const parsed = parsePublishOptimizations(payload.settings);
        if (payload.engineVersion === 2 && (!parsed || !payload.revision)) throw new Error('As opções recebidas estão incompletas. Recarregue antes de publicar.');
        setSupported(payload.engineVersion === 2 && Boolean(parsed));
        setCanSave(payload.canSave === true);
        setSettings(parsed || { ...DEFAULT_PUBLISH_OPTIMIZATIONS, enabled: false });
        setRevision(payload.revision || '');
        setStatusError('');
        setRelease(payload.release || '');
        setPublishedAt(payload.publishedAt || '');
        setReport(payload.report || null);
      }).catch(() => {
        if (active) setStatusError('Não foi possível carregar as opções de publicação. Tente novamente.');
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [nonce, statusUrl, loadAttempt]);

  const saveAsDefault = async (applyPublished = false) => {
    if (!saveUrl || !supported || !canSave || loading || savingDefaults || applyingPublished) return;
    saveDefaultsAbortRef.current?.abort();
    const controller = new AbortController();
    saveDefaultsAbortRef.current = controller;
    setSavingDefaults(!applyPublished);
    setApplyingPublished(applyPublished);
    try {
      const response = await fetch(saveUrl, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ settings, expectedRevision: revision, expectedRelease: release, applyPublished }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) setLoadAttempt((value) => value + 1);
        throw new Error(payload?.message || 'Não foi possível salvar as otimizações.');
      }
      if (saveDefaultsAbortRef.current !== controller) return;
      const parsed = parsePublishOptimizations(payload.settings);
      if (!parsed || !payload.revision) throw new Error('A confirmação está incompleta. Recarregue as opções.');
      setSettings(parsed);
      setRevision(payload.revision);
      setRelease(payload.release || '');
      setPublishedAt(payload.publishedAt || '');
      setReport(payload.report || null);
      toast.success(applyPublished ? 'Otimizações aplicadas ao site publicado' : 'Preferências de publicação salvas');
      if (payload.syncPending) toast.info('O site está publicado. A sincronização do WordPress continua em segundo plano.');
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar as otimizações.');
      // The server may have committed before the connection was interrupted.
      // Refresh its receipt before allowing another publication operation.
      setStatusError('Verificando as preferências salvas…');
      setLoadAttempt((value) => value + 1);
    } finally {
      if (saveDefaultsAbortRef.current === controller) {
        saveDefaultsAbortRef.current = null;
        setSavingDefaults(false);
        setApplyingPublished(false);
      }
    }
  };

  const analyzePerformanceWithAgent = () => {
    onClose();
    window.dispatchEvent(new CustomEvent<OpenHtmlAgentPanelDetail>(OPEN_HTML_AGENT_PANEL_EVENT, {
      detail: {
        prompt: PERFORMANCE_AUDIT_PROMPT,
        skill: 'kodety-performance',
        autoSubmit: true,
      },
    }));
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      data-kodety-onboarding="design-publish-panel"
      aria-labelledby={titleId}
      aria-busy={loading || isPublishing || savingDefaults || applyingPublished}
      className="fixed right-2 top-[54px] z-[90] flex max-h-[calc(100dvh-62px)] w-[min(360px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[8px] border border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] shadow-[var(--kodety-shadow-popover)]"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--kodety-divider)] px-3.5">
        <Rocket className="size-3.5 shrink-0 text-[var(--kodety-text-secondary)]" />
        <h1 id={titleId} className="text-[12px] font-semibold tracking-[-0.01em]">Publicar site</h1>
        <span className={`ml-auto flex items-center gap-1.5 text-[9px] font-medium ${hasChanges ? 'text-amber-300' : 'text-[var(--kodety-text-secondary)]'}`}>
          {hasChanges ? <span className="size-1.5 rounded-full bg-amber-400" aria-hidden="true" /> : <Check className="size-2.5" aria-hidden="true" />}
          {hasChanges ? 'Alterações pendentes' : 'Tudo atualizado'}
        </span>
        {loading && <Loader2 className="size-3 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Carregando opções de publicação" />}
        <button type="button" onClick={onClose} disabled={savingDefaults || applyingPublished} className="kodety-icon-action ml-0.5 disabled:opacity-40" title="Fechar publicação" aria-label="Fechar publicação">
          <X className="size-3.5" />
        </button>
      </header>

      <div className="kodety-compact-scrollbar min-h-0 overflow-y-auto overscroll-contain">
      <section data-kodety-onboarding="publish-destination" className="px-3 py-2.5">
        <div className="rounded-[9px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] px-2.5 py-2.5 shadow-[inset_0_1px_rgba(255,255,255,0.015)]">
          <div className="mb-1.5 text-[8px] font-medium uppercase tracking-[0.08em] text-[var(--kodety-text-tertiary)]">Destino</div>
          {onOpenSite ? (
            <button type="button" onClick={onOpenSite} title="Abrir a prévia local na aba Site" className="flex w-full min-w-0 items-center gap-1.5 text-left text-[10px] font-medium text-foreground transition-colors hover:text-[var(--kodety-accent-hover)]">
              <Globe2 className="size-3 shrink-0 text-[var(--kodety-text-secondary)]" />
              <span className="truncate">{displayUrl || pageUrl}</span>
              <ArrowRight className="size-2.5 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-foreground transition-colors hover:text-[var(--kodety-accent-hover)]">
              <Globe2 className="size-3 shrink-0 text-[var(--kodety-text-secondary)]" />
              <span className="truncate">{displayUrl || pageUrl}</span>
              <ExternalLink className="size-2.5 shrink-0 text-muted-foreground" />
            </a>
          )}
          <p className="mt-1 text-[8px] text-[var(--kodety-text-tertiary)]">Site completo · “{pageLabel}”</p>
        </div>
      </section>

      {isPublishing && (
        <section aria-live="polite" className="border-y border-[var(--kodety-accent)]/15 bg-[var(--kodety-accent)]/[0.045] px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[10px]">
            <Loader2 className="size-3 animate-spin text-[var(--kodety-accent-hover)]" />
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--kodety-accent-hover)]">{publishStage || 'Publicando…'}</span>
            <span className="tabular-nums text-muted-foreground">{elapsedSeconds}s</span>
          </div>
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-black/30"
            role="progressbar"
            aria-label="Progresso da publicação"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(safeProgress)}
          >
            <div className="h-full rounded-full bg-[var(--kodety-accent)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${safeProgress}%` }} />
          </div>
        </section>
      )}

      {statusError && <div role="alert" className="mx-3 mb-3 rounded-md border border-amber-500/20 px-3 py-2 text-[10px] leading-relaxed text-amber-200">{statusError}<button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mt-2 block underline">Recarregar opções</button></div>}

      {!isPublishing && (
        <div className="px-3 pb-3">
          <section className="overflow-hidden rounded-[9px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel-raised)] shadow-[inset_0_1px_rgba(255,255,255,0.015)]">
            <button
              type="button"
              aria-expanded={advancedOpen}
              data-kodety-onboarding="publish-optimizations-toggle"
              data-kodety-onboarding-reveal
              data-kodety-onboarding-toggle
              disabled={loading}
              onClick={() => setAdvancedOpen((value) => !value)}
              className="flex h-9 w-full items-center justify-between gap-2 px-2 text-left text-[10px] font-semibold text-[var(--kodety-text)] outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)] disabled:cursor-wait disabled:opacity-60"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1">Otimizações</span>
                <span className="text-[8px] font-normal text-[var(--kodety-text-tertiary)]">{settings.enabled && supported ? 'Ativadas' : 'Desativadas'}</span>
              </span>
              <DisclosureChevron expanded={advancedOpen} />
            </button>

            {advancedOpen && (
              <div data-kodety-onboarding="publish-optimizations" className="border-t border-[var(--kodety-divider)] p-2">
                <div className="rounded-[7px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-2.5 py-2 text-[8px] leading-[1.45] text-[var(--kodety-text-secondary)]">
                  {supported ? 'As otimizações são aplicadas à publicação. O projeto editável permanece preservado.' : 'Atualize o plugin WordPress para usar as otimizações automáticas.'}
                </div>

                <button
                  type="button"
                  onClick={analyzePerformanceWithAgent}
                  disabled={savingDefaults || applyingPublished}
                  className="group mt-2 flex min-h-12 w-full items-center gap-2.5 rounded-[7px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-2.5 py-2 text-left outline-none transition-colors hover:border-[var(--kodety-divider-strong)] hover:bg-[var(--kodety-panel-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--kodety-focus)]"
                  aria-label="Analisar desempenho com o Agent"
                >
                  <Gauge className="size-3.5 shrink-0 text-[var(--kodety-text-secondary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-medium text-foreground">Analisar desempenho</span>
                    <span className="mt-0.5 block text-[8px] leading-[1.35] text-[var(--kodety-text-tertiary)]">Auditoria com o Agent antes de qualquer alteração.</span>
                  </span>
                  <ArrowRight className="size-3 shrink-0 text-[var(--kodety-text-tertiary)] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </button>

                <div className="mt-2 flex items-center gap-3 rounded-[7px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel)] px-3 py-3">
                  <label htmlFor={`${titleId}-optimization-enabled`} className="min-w-0 flex-1 text-[10px] font-medium">Otimizações automáticas</label>
                  <Switch id={`${titleId}-optimization-enabled`} size="sm" checked={settings.enabled} disabled={!supported || loading || savingDefaults || applyingPublished} onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))} />
                </div>
                <div className="mt-2 overflow-hidden rounded-[7px] border border-[var(--kodety-divider)] bg-[var(--kodety-panel)]">
                  {options.map((option) => (
                    <div key={option.key} className={`flex min-h-11 items-center gap-2.5 border-b border-[var(--kodety-divider)] px-2.5 py-2 last:border-b-0 ${settings.enabled && supported ? '' : 'opacity-55'}`}>
                      <span className="shrink-0 text-[var(--kodety-text-tertiary)] [&>svg]:size-3">{option.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[9px] font-medium text-foreground">{option.title}</span>
                        <span className="mt-0.5 block text-[8px] leading-snug text-[var(--kodety-text-tertiary)]">{option.description}</span>
                      </span>
                      <Switch
                        size="sm"
                        checked={settings[option.key]}
                        disabled={!supported || !settings.enabled || loading || savingDefaults || applyingPublished}
                        onCheckedChange={(checked) => setSettings((current) => ({ ...current, [option.key]: checked }))}
                        aria-label={option.title}
                      />
                    </div>
                  ))}
                </div>

                {supported && <label className="mt-3 block text-[9px] text-[var(--kodety-text-secondary)]">Arquivos preservados
                  <textarea value={settings.exclusions.join('\n')} onChange={(event) => setSettings((current) => ({ ...current, exclusions: event.target.value.split('\n') }))} disabled={savingDefaults || applyingPublished} rows={2} placeholder="assets/vendor/*" className="mt-1.5 w-full resize-y rounded-md border border-[var(--kodety-divider)] bg-[var(--kodety-panel)] p-2 text-[10px] outline-none focus-visible:border-[var(--kodety-focus)]" />
                  <span className="mt-1 block text-[8px]">Um caminho por linha. Use * para um grupo de arquivos.</span>
                </label>}
                {saveUrl && supported && canSave && (
                  <div className="mt-2 grid gap-1.5">
                    <button type="button" disabled={loading || savingDefaults || applyingPublished} onClick={() => void saveAsDefault()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] text-[9px] text-[var(--kodety-text-secondary)] hover:bg-white/[0.035] disabled:opacity-50">
                      {savingDefaults ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      {savingDefaults ? 'Salvando…' : 'Salvar preferências'}
                    </button>
                    {release && <button type="button" disabled={loading || savingDefaults || applyingPublished} onClick={() => void saveAsDefault(true)} className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded-[6px] border border-[var(--kodety-divider)] px-2 text-[9px] text-[var(--kodety-text-secondary)] hover:bg-white/[0.035] disabled:opacity-50">
                      {applyingPublished ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                      {applyingPublished ? 'Aplicando à versão publicada…' : 'Aplicar ao site publicado'}
                    </button>}
                    <p className="text-[8px] leading-relaxed text-[var(--kodety-text-tertiary)]">Aplicar atualiza a versão publicada e preserva os rascunhos. Publicar agora inclui as alterações do projeto.</p>
                  </div>
                )}
                {report && <div className="mt-3 border-t border-[var(--kodety-divider)] pt-2 text-[9px] leading-relaxed text-[var(--kodety-text-tertiary)]">
                  <p className="font-medium text-[var(--kodety-text-secondary)]">{report.settings?.enabled ? 'Última publicação com otimizações' : 'Última publicação sem otimizações adicionais'}</p>
                  <p className="mt-1">{report.images || 0} imagens otimizadas · {Math.round((report.bytesSaved || 0) / 1024)} KB economizados em imagens.</p>
                  <p className="mt-1">Compressão disponível: {Math.round((report.compressionBytesSaved || 0) / 1024)} KB. A entrega depende da hospedagem.</p>
                  {Object.keys(report.skipped || {}).length > 0 && <p className="mt-1">Recursos incompatíveis ou com comportamento próprio foram preservados.</p>}
                  {report.findings && report.findings.length > 0 && <details className="mt-2"><DisclosureSummary className="cursor-pointer text-[var(--kodety-text-secondary)]">Pontos para revisar no projeto</DisclosureSummary><ul className="mt-2 space-y-2">{report.findings.map((finding) => <li key={`${finding.code}:${finding.path}`}><span className="block break-all font-medium">{finding.path}</span>{finding.message}</li>)}</ul></details>}
                </div>}
              </div>
            )}
          </section>
        </div>
      )}

      </div>
      <footer data-kodety-onboarding="publish-release" className="shrink-0 border-t border-[var(--kodety-divider)] px-3.5 pb-3.5 pt-3">
        <div className="mb-2 truncate text-[9px] text-muted-foreground">
          {release ? (
            <span className="flex items-center gap-1"><Check className="size-2.5 text-[var(--kodety-text-secondary)]" /> Release {release}{formattedPublishedAt ? ` · ${formattedPublishedAt}` : ''}</span>
          ) : 'Primeira publicação'}
        </div>
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" onClick={onClose} disabled={savingDefaults || applyingPublished}>{isPublishing ? 'Continuar no editor' : 'Cancelar'}</Button>
          {isPublishing ? (
            <Button size="xs" variant="destructive" onClick={onCancelPublish}><Ban className="size-3" /> Cancelar publicação</Button>
          ) : (
            <Button
              size="xs"
              className="bg-[var(--kodety-accent)] px-4 text-white hover:bg-[var(--kodety-accent-hover)]"
              disabled={loading || Boolean(statusError) || savingDefaults || applyingPublished}
              onClick={() => onPublish({ ...settings, expectedRevision: supported ? revision : undefined })}
            >
              <Rocket className="size-3" /> Publicar agora
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
