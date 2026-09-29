'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  SearchCheck,
  Unlink,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { HtmlSettingsFieldGlyph } from './HtmlSettingsControls';

export interface SearchConsoleProperty {
  url: string;
  label?: string;
  permissionLevel?: string;
}

export interface SearchConsoleSummary {
  clicks: number;
  impressions: number;
  /** Ratio from 0 to 1, matching the Search Console API. */
  ctr: number;
  position: number;
  totalUrls?: number;
  indexedUrls?: number;
  issueUrls?: number;
}

export interface SearchConsolePageRow {
  url: string;
  clicks: number;
  impressions: number;
  /** Ratio from 0 to 1, matching the Search Console API. */
  ctr: number;
  position: number;
  indexStatus?: string;
  indexIssue?: string;
  canonicalIssue?: string;
}

export interface SearchConsoleStatus {
  connected: boolean;
  accountEmail?: string;
  property?: string;
  properties: SearchConsoleProperty[];
  lastSyncAt?: string;
  syncStatus?: 'idle' | 'queued' | 'syncing' | 'success' | 'error';
  error?: string;
  proRequired?: boolean;
  summary?: SearchConsoleSummary;
  /** The backend returns the first bounded page of URL metrics. */
  rows: SearchConsolePageRow[];
}

export interface SearchConsoleOAuthClient {
  configured: boolean;
  source: 'wordpress' | 'server' | 'filter' | 'broker' | 'none';
  managedExternally: boolean;
  editable: boolean;
  clientIdHint?: string;
  hasClientSecret: boolean;
  callbackUrl: string;
  callbackUsable: boolean;
}

export interface HtmlSearchConsoleSettingsProps {
  baseUrl?: string;
  nonce?: string;
  readOnly?: boolean;
  locked?: boolean;
}

type SearchConsoleOperation = 'status' | 'connect' | 'property' | 'sync' | 'disconnect' | 'oauth-save' | 'oauth-delete';

class SearchConsoleRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SearchConsoleRequestError';
    this.status = status;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProperty(value: unknown): SearchConsoleProperty | null {
  if (typeof value === 'string') {
    const url = value.trim();
    return url ? { url } : null;
  }
  const source = record(value);
  const url = text(source.url || source.property || source.siteUrl);
  if (!url) return null;
  return {
    url,
    label: text(source.label) || undefined,
    permissionLevel: text(source.permissionLevel) || undefined,
  };
}

function normalizeSummary(value: unknown): SearchConsoleSummary | undefined {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  return {
    clicks: number(source.clicks),
    impressions: number(source.impressions),
    ctr: number(source.ctr),
    position: number(source.position),
    totalUrls: source.totalUrls === undefined ? undefined : number(source.totalUrls),
    indexedUrls: source.indexedUrls === undefined ? undefined : number(source.indexedUrls),
    issueUrls: source.issueUrls === undefined ? undefined : number(source.issueUrls),
  };
}

function normalizeRow(value: unknown): SearchConsolePageRow | null {
  const source = record(value);
  const url = text(source.url || source.page);
  if (!url) return null;
  return {
    url,
    clicks: number(source.clicks),
    impressions: number(source.impressions),
    ctr: number(source.ctr),
    position: number(source.position),
    indexStatus: text(source.indexStatus) || undefined,
    indexIssue: text(source.indexIssue || source.coverageState) || undefined,
    canonicalIssue: text(source.canonicalIssue) || undefined,
  };
}

function normalizeStatus(payload: unknown): SearchConsoleStatus {
  const outer = record(payload);
  const source = Object.keys(record(outer.status)).length ? record(outer.status) : outer;
  const syncStatus = text(source.syncStatus);
  return {
    connected: source.connected === true,
    accountEmail: text(source.accountEmail) || undefined,
    property: text(source.property) || undefined,
    properties: (Array.isArray(source.properties) ? source.properties : [])
      .map(normalizeProperty)
      .filter((item): item is SearchConsoleProperty => Boolean(item)),
    lastSyncAt: text(source.lastSyncAt) || undefined,
    syncStatus: ['idle', 'queued', 'syncing', 'success', 'error'].includes(syncStatus)
      ? syncStatus as SearchConsoleStatus['syncStatus']
      : 'idle',
    error: text(source.error) || undefined,
    proRequired: source.proRequired === true,
    summary: normalizeSummary(source.summary),
    rows: (Array.isArray(source.rows) ? source.rows : [])
      .map(normalizeRow)
      .filter((item): item is SearchConsolePageRow => Boolean(item)),
  };
}

function normalizeOAuthClient(payload: unknown): SearchConsoleOAuthClient {
  const outer = record(payload);
  const source = Object.keys(record(outer.oauthClient)).length ? record(outer.oauthClient) : outer;
  const rawSource = text(source.source);
  const normalizedSource = ['wordpress', 'server', 'filter', 'broker', 'none'].includes(rawSource)
    ? rawSource as SearchConsoleOAuthClient['source']
    : 'none';
  return {
    configured: source.configured === true,
    source: normalizedSource,
    managedExternally: source.managedExternally === true,
    editable: source.editable !== false,
    clientIdHint: text(source.clientIdHint) || undefined,
    hasClientSecret: source.hasClientSecret === true,
    callbackUrl: text(source.callbackUrl),
    callbackUsable: source.callbackUsable !== false,
  };
}

function endpoint(baseUrl: string, suffix = ''): string {
  const url = new URL(baseUrl, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error('O endpoint do Search Console precisa pertencer a este WordPress.');
  }
  const normalizedSuffix = suffix ? `/${suffix.replace(/^\/+|\/+$/g, '')}` : '';
  const route = url.searchParams.get('rest_route');
  if (route) url.searchParams.set('rest_route', `${route.replace(/\/+$/, '')}${normalizedSuffix}`);
  else url.pathname = `${url.pathname.replace(/\/+$/, '')}${normalizedSuffix}`;
  return url.toString();
}

function responseMessage(payload: unknown, fallback: string): string {
  const source = record(payload);
  const data = record(source.data);
  return text(source.message) || text(source.error) || text(data.message) || fallback;
}

async function requestJson(
  url: string,
  nonce: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(nonce ? { 'X-WP-Nonce': nonce } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SearchConsoleRequestError(
      responseMessage(payload, 'O Google Search Console não respondeu.'),
      response.status,
    );
  }
  // Mutations may legitimately answer with 204. Keep that distinguishable from
  // an error so the caller can refresh the authoritative status afterwards.
  return payload ?? {};
}

function formatDate(value: string | undefined): string {
  if (!value) return 'Ainda não sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat(getAdminUiLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

const INTEGER_FORMAT = new Intl.NumberFormat(getAdminUiLocale(), { maximumFractionDigits: 0 });
const DECIMAL_FORMAT = new Intl.NumberFormat(getAdminUiLocale(), {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PERCENT_FORMAT = new Intl.NumberFormat(getAdminUiLocale(), {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PAGE_SIZE = 50;

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function statusTone(value: string): string {
  const normalized = value.toLocaleLowerCase();
  if (!normalized) return 'text-muted-foreground';
  if (/not |n[aã]o|error|erro|excluded|exclu|blocked|bloque|issue|problema|invalid/.test(normalized)) {
    return 'text-red-300';
  }
  if (/indexed|indexad|valid|v[aá]lid|success|sucesso|^ok$/.test(normalized)) return 'text-emerald-400';
  return 'text-amber-300';
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-[9px] border border-white/[.045] bg-black/[.075] px-3 py-2.5">
      <p className="text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {detail && <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function HtmlSearchConsoleSettings({
  baseUrl,
  nonce = '',
  readOnly = false,
  locked = false,
}: HtmlSearchConsoleSettingsProps) {
  const [status, setStatus] = useState<SearchConsoleStatus | null>(null);
  const [oauthClient, setOAuthClient] = useState<SearchConsoleOAuthClient | null>(null);
  const [oauthLoading, setOAuthLoading] = useState(false);
  const [oauthEditorOpen, setOAuthEditorOpen] = useState(false);
  const [oauthClientId, setOAuthClientId] = useState('');
  const [oauthClientSecret, setOAuthClientSecret] = useState('');
  const [oauthNotice, setOAuthNotice] = useState('');
  const [confirmOAuthDelete, setConfirmOAuthDelete] = useState(false);
  const [callbackCopied, setCallbackCopied] = useState(false);
  const [operation, setOperation] = useState<SearchConsoleOperation | null>(null);
  const [error, setError] = useState('');
  const [propertyDraft, setPropertyDraft] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [page, setPage] = useState(1);
  const [statusRevision, setStatusRevision] = useState(0);
  const syncPollCount = useRef(0);
  const effectiveLocked = false;

  const loadOAuthClient = useCallback(async (signal?: AbortSignal) => {
    if (!baseUrl) return;
    setOAuthLoading(true);
    try {
      const payload = await requestJson(endpoint(baseUrl, 'oauth-client'), nonce, { signal });
      const next = normalizeOAuthClient(payload);
      setOAuthClient(next);
      setOAuthEditorOpen(!next.configured && !next.managedExternally);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar a configuração OAuth.');
    } finally {
      setOAuthLoading(false);
    }
  }, [baseUrl, nonce]);

  const loadStatus = useCallback(async (signal?: AbortSignal, targetPage = 1) => {
    if (!baseUrl) return;
    setOperation(current => current || 'status');
    setError('');
    try {
      let payload: unknown;
      try {
        const statusUrl = new URL(endpoint(baseUrl, 'status'));
        statusUrl.searchParams.set('page', String(targetPage));
        statusUrl.searchParams.set('perPage', String(PAGE_SIZE));
        payload = await requestJson(statusUrl.toString(), nonce, { signal });
      } catch (caught) {
        if (!(caught instanceof SearchConsoleRequestError) || ![404, 405].includes(caught.status)) throw caught;
        const fallbackUrl = new URL(endpoint(baseUrl));
        fallbackUrl.searchParams.set('page', String(targetPage));
        fallbackUrl.searchParams.set('perPage', String(PAGE_SIZE));
        payload = await requestJson(fallbackUrl.toString(), nonce, { signal });
      }
      const next = normalizeStatus(payload);
      setStatus(next);
      setPropertyDraft(next.property || '');
      setPage(targetPage);
      setStatusRevision(current => current + 1);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível consultar o Search Console.');
    } finally {
      setOperation(current => current === 'status' ? null : current);
    }
  }, [baseUrl, nonce]);

  useEffect(() => {
    setStatus(null);
    setOAuthClient(null);
    setOAuthClientId('');
    setOAuthClientSecret('');
    setOAuthNotice('');
    setOAuthEditorOpen(false);
    setPropertyDraft('');
    setError('');
    setPage(1);
    if (!baseUrl) return;
    const controller = new AbortController();
    void loadStatus(controller.signal);
    void loadOAuthClient(controller.signal);
    return () => controller.abort();
  }, [baseUrl, loadOAuthClient, loadStatus]);

  useEffect(() => {
    if (!baseUrl || !['queued', 'syncing'].includes(status?.syncStatus || '')) {
      syncPollCount.current = 0;
      return;
    }
    if (operation !== null) return;
    if (syncPollCount.current >= 40) return;
    const delay = Math.min(10_000, 3_500 + syncPollCount.current * 500);
    const timer = window.setTimeout(() => {
      syncPollCount.current += 1;
      void loadStatus(undefined, page);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [baseUrl, loadStatus, operation, page, status?.syncStatus, statusRevision]);

  const run = useCallback(async (
    nextOperation: Exclude<SearchConsoleOperation, 'status'>,
    path: string,
    init: RequestInit,
  ) => {
    const cleanupOperation = nextOperation === 'disconnect' || nextOperation === 'oauth-delete';
    if (!baseUrl || readOnly || operation || (effectiveLocked && !cleanupOperation)) return null;
    setOperation(nextOperation);
    setError('');
    try {
      return await requestJson(endpoint(baseUrl, path), nonce, init);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A operação não pôde ser concluída.');
      return null;
    } finally {
      setOperation(null);
    }
  }, [baseUrl, effectiveLocked, nonce, operation, readOnly]);

  const saveOAuthClient = async () => {
    if (oauthClient?.callbackUsable === false) {
      setError('Use HTTPS neste WordPress antes de salvar o Client Secret do Google.');
      return;
    }
    if (!oauthClient?.configured && !oauthClientId.trim()) {
      setError('Informe o Client ID fornecido pelo Google Cloud.');
      return;
    }
    if (!oauthClient?.hasClientSecret && !oauthClientSecret.trim()) {
      setError('Informe o Client Secret fornecido pelo Google Cloud.');
      return;
    }
    const payload = await run('oauth-save', 'oauth-client', {
      method: 'POST',
      body: JSON.stringify({
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret,
      }),
    });
    if (!payload) return;
    const next = normalizeOAuthClient(payload);
    setOAuthClient(next);
    setOAuthClientId('');
    setOAuthClientSecret('');
    setOAuthEditorOpen(false);
    setConfirmOAuthDelete(false);
    setOAuthNotice('Configuração salva com segurança no WordPress. Agora conecte a conta Google.');
  };

  const deleteOAuthClient = async () => {
    const payload = await run('oauth-delete', 'oauth-client', { method: 'DELETE' });
    if (!payload) return;
    const next = normalizeOAuthClient(payload);
    setOAuthClient(next);
    setOAuthClientId('');
    setOAuthClientSecret('');
    setOAuthEditorOpen(!next.managedExternally);
    setConfirmOAuthDelete(false);
    setOAuthNotice('Configuração OAuth removida deste WordPress.');
  };

  const copyCallbackUrl = async () => {
    if (!oauthClient?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(oauthClient.callbackUrl);
      setCallbackCopied(true);
      window.setTimeout(() => setCallbackCopied(false), 2_000);
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione a URL e copie manualmente.');
    }
  };

  const connect = async () => {
    if (oauthClient?.callbackUsable === false) {
      setError('A conexão com o Google exige que este WordPress use HTTPS.');
      return;
    }
    if (!oauthClient?.configured) {
      setOAuthEditorOpen(true);
      setError('Salve a configuração OAuth no WordPress antes de conectar.');
      return;
    }
    const payload = await run('connect', 'connect', {
      method: 'POST',
      body: JSON.stringify({ returnUrl: window.location.href }),
    });
    if (!payload) return;
    const authorizationUrl = text(record(payload).authorizationUrl);
    if (!authorizationUrl) {
      setError('O WordPress não retornou a URL de autorização do Google.');
      return;
    }
    try {
      const destination = new URL(authorizationUrl, window.location.href);
      const sameOriginHttp = destination.origin === window.location.origin && destination.protocol === window.location.protocol;
      if (destination.protocol !== 'https:' && !sameOriginHttp) {
        throw new Error('A autorização precisa usar HTTPS.');
      }
      window.location.assign(destination.toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A URL de autorização do Google é inválida.');
    }
  };

  const chooseProperty = async (property: string) => {
    setPropertyDraft(property);
    const payload = await run('property', 'property', {
      method: 'POST',
      body: JSON.stringify({ property }),
    });
    if (!payload) {
      setPropertyDraft(status?.property || '');
      return;
    }
    await loadStatus(undefined, 1);
  };

  const sync = async () => {
    const payload = await run('sync', 'sync', { method: 'POST' });
    if (payload) await loadStatus(undefined, 1);
  };

  const disconnect = async () => {
    const payload = await run('disconnect', '', { method: 'DELETE' });
    if (!payload) return;
    setConfirmDisconnect(false);
    await loadStatus(undefined, 1);
  };

  const metrics = useMemo(() => {
    if (!status?.summary) return [];
    const summary = status.summary;
    return [
      { label: 'Cliques', value: INTEGER_FORMAT.format(summary.clicks) },
      { label: 'Impressões', value: INTEGER_FORMAT.format(summary.impressions) },
      { label: 'CTR médio', value: PERCENT_FORMAT.format(summary.ctr) },
      { label: 'Posição média', value: DECIMAL_FORMAT.format(summary.position) },
      ...(summary.indexedUrls === undefined
        ? []
        : [{ label: 'URLs indexadas', value: INTEGER_FORMAT.format(summary.indexedUrls), detail: summary.totalUrls === undefined ? undefined : `inspeção gradual · ${INTEGER_FORMAT.format(summary.totalUrls)} URLs no inventário` }]),
      ...(summary.issueUrls === undefined
        ? []
        : [{ label: 'URLs com alerta', value: INTEGER_FORMAT.format(summary.issueUrls) }]),
    ];
  }, [status?.summary]);

  const syncPending = ['queued', 'syncing'].includes(status?.syncStatus || '');
  // The server versions queue mutations, so a stale/slow worker must not trap
  // the UI. Actual overlap is still rejected by the backend's owner lock.
  const busy = operation !== null || oauthLoading;
  const visibleError = error || ((oauthClient?.configured || status?.connected) ? status?.error || '' : '');
  const rows = status?.rows || [];
  const totalUrls = status?.summary?.totalUrls || rows.length;
  const totalPages = Math.max(1, Math.ceil(totalUrls / PAGE_SIZE));

  useEffect(() => {
    if (operation !== null || page <= totalPages) return;
    // Commit the clamped cursor before fetching so a transient request failure
    // does not retrigger this effect forever.
    setPage(totalPages);
    void loadStatus(undefined, totalPages);
  }, [loadStatus, operation, page, totalPages]);

  return (
    <section data-kodety-search-console className="border-t border-[var(--kodety-divider)]">
      <div className="grid gap-4 py-5 md:grid-cols-[minmax(148px,0.3fr)_minmax(0,1fr)] md:gap-8 lg:gap-10">
        <div className="flex min-w-0 flex-col items-start md:pt-0.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/35">
            <HtmlSettingsFieldGlyph kind="tracking" />
          </span>
          <div className="mt-3 min-w-0">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-foreground">
              Google Search Console
              <span className="rounded-full border border-[var(--kodety-accent)]/25 bg-[var(--kodety-accent)]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-[var(--kodety-accent-hover)]">
                Pro
              </span>
            </h2>
            <p className="mt-1.5 max-w-52 text-balance text-[11px] leading-[1.5] text-muted-foreground">
              Conecte a propriedade do site e traga desempenho, cobertura e problemas canônicos para o Kodety.
            </p>
          </div>
        </div>

        <div className="min-w-0">
          {!baseUrl ? (
            <div data-kodety-settings-card className="flex items-start gap-3 p-4 text-[11px] leading-5 text-muted-foreground">
              <SearchCheck className="mt-0.5 size-4 shrink-0" />
              <p>A conexão automática fica disponível quando este projeto usa o plugin WordPress compatível.</p>
            </div>
          ) : operation === 'status' && !status ? (
            <div className="flex items-center gap-2 py-5 text-[11px] text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" /> Consultando o Search Console…
            </div>
          ) : !status?.connected ? (
            <div className="space-y-3">
              {oauthLoading && !oauthClient ? (
                <div className="flex items-center gap-2 py-5 text-[11px] text-muted-foreground" role="status">
                  <Loader2 className="size-3.5 animate-spin" /> Consultando a configuração OAuth do WordPress…
                </div>
              ) : oauthClient?.configured && !oauthEditorOpen ? (
                <div data-kodety-settings-card className="p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-xs font-semibold">
                        <Link2 className="size-3.5 text-[var(--kodety-accent-hover)]" /> Conectar conta Google
                        <span className="text-[9px] font-normal text-emerald-400">OAuth configurado</span>
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        {oauthClient.managedExternally
                          ? 'As credenciais são gerenciadas pelo servidor deste WordPress.'
                          : `Credenciais protegidas no WordPress${oauthClient.clientIdHint ? ` · ${oauthClient.clientIdHint}` : ''}.`}
                      </p>
                      {oauthClient.callbackUsable === false && (
                        <p className="mt-1 text-[10px] leading-4 text-amber-300">
                          Publique este WordPress em HTTPS antes de conectar a conta Google.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {oauthClient.editable && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy || readOnly}
                          onClick={() => {
                            setOAuthNotice('');
                            setOAuthEditorOpen(true);
                          }}
                        >
                          Editar configuração
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={busy || readOnly || oauthClient.callbackUsable === false}
                        onClick={() => void connect()}
                      >
                        {operation === 'connect' ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                        Conectar com Google
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div data-kodety-settings-card data-kodety-search-console-oauth className="p-4">
                  <div className="flex items-start gap-3">
                    <Link2 className="mt-0.5 size-3.5 shrink-0 text-[var(--kodety-accent-hover)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">Configurar OAuth no WordPress</p>
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        Crie um cliente OAuth do tipo “Aplicativo da Web” no Google Cloud, ative a Search Console API e cadastre exatamente a URL de retorno abaixo. O segredo será cifrado no banco do WordPress.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--kodety-accent-hover)] hover:underline"
                        >
                          Criar credencial OAuth <ExternalLink className="size-2.5" />
                        </a>
                        <a
                          href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--kodety-accent-hover)] hover:underline"
                        >
                          Ativar Search Console API <ExternalLink className="size-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="min-w-0 text-[10px] font-medium text-foreground">
                      Client ID
                      <Input
                        className="mt-1 w-full"
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={oauthClientId}
                        placeholder={oauthClient?.clientIdHint || '000000000000-….apps.googleusercontent.com'}
                        disabled={busy || readOnly || oauthClient?.callbackUsable === false}
                        onChange={event => setOAuthClientId(event.target.value)}
                      />
                      {oauthClient?.configured && (
                        <span className="mt-1 block font-normal text-muted-foreground">Deixe vazio para manter o Client ID atual.</span>
                      )}
                    </label>
                    <label className="min-w-0 text-[10px] font-medium text-foreground">
                      Client Secret
                      <Input
                        className="mt-1 w-full"
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={oauthClientSecret}
                        placeholder={oauthClient?.hasClientSecret ? '••••••••••••••••' : 'GOCSPX-…'}
                        disabled={busy || readOnly || oauthClient?.callbackUsable === false}
                        onChange={event => setOAuthClientSecret(event.target.value)}
                      />
                      {oauthClient?.hasClientSecret && (
                        <span className="mt-1 block font-normal text-muted-foreground">Deixe vazio para manter o segredo cifrado atual.</span>
                      )}
                    </label>
                  </div>

                  <label className="mt-3 block min-w-0 text-[10px] font-medium text-foreground">
                    URI de redirecionamento autorizada
                    <span className="mt-1 flex min-w-0 gap-2">
                      <Input
                        className="min-w-0 flex-1 font-mono text-[9px]"
                        type="text"
                        readOnly
                        value={oauthClient?.callbackUrl || ''}
                        aria-label="URI de redirecionamento OAuth"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        disabled={!oauthClient?.callbackUrl}
                        onClick={() => void copyCallbackUrl()}
                      >
                        <Copy /> {callbackCopied ? 'Copiada' : 'Copiar'}
                      </Button>
                    </span>
                  </label>
                  {oauthClient?.callbackUsable === false && (
                    <p className="mt-2 text-[10px] leading-4 text-amber-300">
                      Publique o WordPress em HTTPS antes de autorizar uma conta Google.
                    </p>
                  )}

                  <div className="mt-4 flex flex-col-reverse gap-2 border-t border-white/[.045] pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      {oauthClient?.configured && oauthClient.editable && (
                        confirmOAuthDelete ? (
                          <>
                            <Button variant="ghost" size="xs" disabled={busy} onClick={() => setConfirmOAuthDelete(false)}>Cancelar remoção</Button>
                            <Button variant="destructive" size="xs" disabled={busy || readOnly} onClick={() => void deleteOAuthClient()}>
                              {operation === 'oauth-delete' ? <Loader2 className="animate-spin" /> : <Unlink />} Remover
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="xs" disabled={busy || readOnly} onClick={() => setConfirmOAuthDelete(true)}>
                            Remover configuração
                          </Button>
                        )
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {oauthClient?.configured && (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={() => {
                            setOAuthClientId('');
                            setOAuthClientSecret('');
                            setOAuthEditorOpen(false);
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={busy || readOnly || !oauthClient?.editable || oauthClient?.callbackUsable === false}
                        onClick={() => void saveOAuthClient()}
                      >
                        {operation === 'oauth-save' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                        Salvar no WordPress
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {oauthNotice && (
                <p role="status" className="rounded-[8px] border border-emerald-400/15 bg-emerald-400/[.045] px-3 py-2 text-[10px] text-emerald-300">
                  {oauthNotice}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div data-kodety-settings-card className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <CheckCircle2 className="size-3.5 text-emerald-400" /> Search Console conectado
                      <span className="text-[10px] font-normal text-emerald-400">Ativo</span>
                    </p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {status.accountEmail || 'Conta Google autorizada'} · {formatDate(status.lastSyncAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Atualizar status do Search Console"
                    disabled={operation !== null}
                    onClick={() => void loadStatus(undefined, page)}
                  >
                    <RefreshCw className={operation === 'status' ? 'animate-spin' : ''} />
                  </Button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Select
                    value={propertyDraft || undefined}
                    onValueChange={value => void chooseProperty(value)}
                    disabled={busy || readOnly || effectiveLocked || status.properties.length === 0}
                  >
                    <SelectTrigger aria-label="Propriedade do Search Console">
                      <SelectValue placeholder={status.properties.length ? 'Selecione a propriedade' : 'Nenhuma propriedade disponível'} />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {status.properties.map(property => (
                        <SelectItem key={property.url} value={property.url}>
                          {property.label || property.url}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || readOnly || effectiveLocked || !status.property}
                    onClick={() => void sync()}
                  >
                    {operation === 'sync' || syncPending
                      ? <Loader2 className="animate-spin" />
                      : <RefreshCw />}
                    Sincronizar agora
                  </Button>
                </div>

                {syncPending && (
                  <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--kodety-accent-hover)]" role="status">
                    <Loader2 className="size-3 animate-spin" />
                    {status.syncStatus === 'queued'
                      ? 'Sincronização agendada no WordPress…'
                      : 'Coletando URLs e métricas do Google…'}
                  </p>
                )}


                {confirmDisconnect ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-white/[.045] pt-3 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 text-[10px] leading-4 text-amber-300">
                      Os dados locais deixam de atualizar até uma nova autorização.
                    </p>
                    <Button variant="ghost" size="xs" disabled={operation !== null} onClick={() => setConfirmDisconnect(false)}>
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={operation !== null}
                      onClick={() => void disconnect()}
                    >
                      {operation === 'disconnect' ? <Loader2 className="animate-spin" /> : <Unlink />}
                      Confirmar desconexão
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end border-t border-white/[.045] pt-3">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={operation !== null || readOnly}
                      onClick={() => setConfirmDisconnect(true)}
                    >
                      <Unlink /> Desconectar
                    </Button>
                  </div>
                )}
              </div>

              {metrics.length > 0 && (Boolean(status.lastSyncAt) || totalUrls > 0) && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" aria-label="Resumo do Search Console">
                  {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
                </div>
              )}

              {totalUrls > 0 && (
                <div className="overflow-hidden rounded-[9px] border border-[var(--kodety-divider)] bg-white/[.018]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[.045] px-3 py-2.5">
                    <p className="text-[10px] font-semibold">URLs encontradas</p>
                    <span className="text-[9px] text-muted-foreground">
                      {rows.length > 0
                        ? `${INTEGER_FORMAT.format((page - 1) * PAGE_SIZE + 1)}–${INTEGER_FORMAT.format((page - 1) * PAGE_SIZE + rows.length)} de ${INTEGER_FORMAT.format(totalUrls)}`
                        : `Página ${INTEGER_FORMAT.format(page)} sem URLs`}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-left text-[10px]">
                      <thead className="bg-black/[.08] text-[9px] uppercase tracking-[0.06em] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">URL</th>
                          <th className="px-2 py-2 text-right font-medium">Cliques</th>
                          <th className="px-2 py-2 text-right font-medium">Impressões</th>
                          <th className="px-2 py-2 text-right font-medium">CTR</th>
                          <th className="px-2 py-2 text-right font-medium">Posição</th>
                          <th className="px-3 py-2 font-medium">Indexação</th>
                          <th className="px-3 py-2 font-medium">Canônica</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[.04]">
                        {rows.map((row, index) => {
                          const href = safeHttpUrl(row.url);
                          return (
                            <tr key={`${row.url}-${index}`} className="hover:bg-white/[.025]">
                              <td className="max-w-[280px] px-3 py-2.5">
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 truncate text-[var(--kodety-accent-hover)] hover:underline"
                                    title={row.url}
                                  >
                                    <span className="truncate">{row.url}</span><ExternalLink className="size-2.5 shrink-0" />
                                  </a>
                                ) : (
                                  <span className="block truncate" title={row.url}>{row.url}</span>
                                )}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums">{INTEGER_FORMAT.format(row.clicks)}</td>
                              <td className="px-2 py-2.5 text-right tabular-nums">{INTEGER_FORMAT.format(row.impressions)}</td>
                              <td className="px-2 py-2.5 text-right tabular-nums">{PERCENT_FORMAT.format(row.ctr)}</td>
                              <td className="px-2 py-2.5 text-right tabular-nums">{DECIMAL_FORMAT.format(row.position)}</td>
                              <td className={`max-w-[220px] px-3 py-2.5 ${statusTone(row.indexStatus || '')}`}>
                                <span className="block">{row.indexStatus || 'Não consultado'}</span>
                                {row.indexIssue && (
                                  <span className="mt-0.5 block truncate text-[9px] text-muted-foreground" title={row.indexIssue}>
                                    {row.indexIssue}
                                  </span>
                                )}
                              </td>
                              <td className={`max-w-[220px] px-3 py-2.5 ${row.canonicalIssue ? 'text-amber-300' : 'text-muted-foreground'}`}>
                                <span className="block truncate" title={row.canonicalIssue || 'Sem divergência'}>
                                  {row.canonicalIssue || 'Sem divergência'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-3 py-5 text-center text-muted-foreground">
                              Ajustando para a última página disponível…
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-end gap-2 border-t border-white/[.045] px-3 py-2">
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy || page <= 1}
                        onClick={() => void loadStatus(undefined, page - 1)}
                      >
                        Anterior
                      </Button>
                      <span className="text-[9px] tabular-nums text-muted-foreground">
                        Página {INTEGER_FORMAT.format(page)} de {INTEGER_FORMAT.format(totalPages)}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy || page >= totalPages}
                        onClick={() => void loadStatus(undefined, page + 1)}
                      >
                        Próxima
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {!status.lastSyncAt && status.property && !busy && (
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Selecione “Sincronizar agora” para carregar os dados desta propriedade.
                </p>
              )}
            </div>
          )}

          {visibleError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-[8px] border border-red-500/20 bg-red-500/[.045] px-3 py-2 text-[10px] leading-4 text-red-300"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{visibleError}</span>
              {baseUrl && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={operation !== null || oauthLoading}
                  onClick={() => {
                    void loadStatus(undefined, page);
                    void loadOAuthClient();
                  }}
                >
                  Tentar novamente
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
