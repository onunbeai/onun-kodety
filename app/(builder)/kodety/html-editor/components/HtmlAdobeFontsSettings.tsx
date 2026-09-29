'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Unlink,
} from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';

export interface AdobeFontsSettingsState {
  configured: boolean;
  projectId: string;
  stylesheetUrl: string;
  fonts?: unknown[];
  familyCount: number;
  syncedAt?: string;
  stale: boolean;
  lastError?: string;
}

export interface HtmlAdobeFontsSettingsProps {
  licensed?: boolean;
  settingsUrl?: string;
  syncUrl?: string;
  nonce?: string;
  readOnly?: boolean;
}

type AdobeFontsOperation = 'load' | 'save' | 'sync' | 'disconnect';

class AdobeFontsRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdobeFontsRequestError';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeSettings(payload: unknown): AdobeFontsSettingsState {
  const outer = record(payload);
  const nested = record(outer.settings);
  const source = Object.keys(nested).length ? nested : outer;
  const fonts = Array.isArray(source.fonts) ? source.fonts : undefined;
  const projectId = text(source.projectId);

  return {
    configured: source.configured === true,
    projectId,
    stylesheetUrl: text(source.stylesheetUrl),
    fonts,
    familyCount:
      source.familyCount === undefined
        ? fonts?.length || 0
        : number(source.familyCount),
    syncedAt: text(source.syncedAt) || undefined,
    stale: source.stale === true,
    lastError: text(source.lastError) || undefined,
  };
}

function responseMessage(payload: unknown, fallback: string): string {
  const source = record(payload);
  const data = record(source.data);
  return (
    text(source.message) || text(source.error) || text(data.message) || fallback
  );
}

function sameOriginEndpoint(value: string): string {
  const endpoint = new URL(value, window.location.href);
  if (endpoint.origin !== window.location.origin) {
    throw new AdobeFontsRequestError(
      'O endpoint do Adobe Fonts precisa pertencer a este WordPress.',
    );
  }
  return endpoint.toString();
}

async function requestJson(
  url: string,
  nonce: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(sameOriginEndpoint(url), {
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AdobeFontsRequestError(
      responseMessage(payload, 'O Adobe Fonts não respondeu.'),
    );
  }
  return payload;
}

export function adobeFontsProjectId(value: string): string {
  const trimmed = value.trim();
  const embedMatch = trimmed.match(
    /use\.typekit\.net\/([a-z0-9]+)(?:\.(?:css|js))?/i,
  );
  const candidate = (embedMatch?.[1] || trimmed).trim().toLowerCase();
  return /^[a-z0-9]+$/.test(candidate) ? candidate : '';
}

function formatSyncedAt(value: string | undefined): string {
  if (!value) return 'Ainda não sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data de sincronização indisponível';
  return new Intl.DateTimeFormat(getAdminUiLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function notifyAdobeFontsChanged(payload: AdobeFontsSettingsState): void {
  window.dispatchEvent(
    new CustomEvent('kodety:adobe-fonts-changed', { detail: payload }),
  );
}

export function HtmlAdobeFontsSettings({
  licensed,
  settingsUrl,
  syncUrl,
  nonce = '',
  readOnly = false,
}: HtmlAdobeFontsSettingsProps) {
  const [status, setStatus] = useState<AdobeFontsSettingsState | null>(null);
  const [projectInput, setProjectInput] = useState('');
  const [operation, setOperation] = useState<AdobeFontsOperation | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const projectId = useMemo(
    () => adobeFontsProjectId(projectInput),
    [projectInput],
  );
  const busy = operation !== null;

  const applyPayload = useCallback(
    (payload: unknown, notify = false): AdobeFontsSettingsState => {
      const next = normalizeSettings(payload);
      setStatus(next);
      setProjectInput(next.projectId);
      if (notify) notifyAdobeFontsChanged(next);
      return next;
    },
    [],
  );

  useEffect(() => {
    setStatus(null);
    setProjectInput('');
    setError('');
    setNotice('');
    setConfirmDisconnect(false);
    if (!settingsUrl) return;

    const controller = new AbortController();
    let active = true;
    setOperation('load');
    void requestJson(settingsUrl, nonce, { signal: controller.signal })
      .then((payload) => {
        if (!active) return;
        applyPayload(payload);
      })
      .catch((caught) => {
        if (
          !active ||
          (caught instanceof DOMException && caught.name === 'AbortError')
        )
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Não foi possível consultar o Adobe Fonts.',
        );
      })
      .finally(() => {
        if (active) setOperation(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [applyPayload, nonce, settingsUrl]);

  const saveAndSync = async () => {
    if (!settingsUrl || !projectId || busy || readOnly) return;
    setOperation('save');
    setError('');
    setNotice('');
    setConfirmDisconnect(false);
    try {
      const payload = await requestJson(settingsUrl, nonce, {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });
      const next = applyPayload(payload, true);
      setNotice(
        next.familyCount > 0
          ? `${next.familyCount} ${next.familyCount === 1 ? 'família sincronizada' : 'famílias sincronizadas'} com o Builder.`
          : 'Web Project conectado. Adicione fontes nele pela Adobe e use Ressincronizar.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível conectar o Adobe Fonts.',
      );
    } finally {
      setOperation(null);
    }
  };

  const resync = async () => {
    if (!syncUrl || !status?.configured || busy || readOnly) return;
    setOperation('sync');
    setError('');
    setNotice('');
    setConfirmDisconnect(false);
    try {
      const payload = await requestJson(syncUrl, nonce, { method: 'POST' });
      const next = applyPayload(payload, true);
      setNotice(
        `${next.familyCount} ${next.familyCount === 1 ? 'família sincronizada' : 'famílias sincronizadas'} com o Builder.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível ressincronizar o Adobe Fonts.',
      );
    } finally {
      setOperation(null);
    }
  };

  const disconnect = async () => {
    if (!settingsUrl || busy || readOnly) return;
    setOperation('disconnect');
    setError('');
    setNotice('');
    try {
      const payload = await requestJson(settingsUrl, nonce, {
        method: 'DELETE',
      });
      applyPayload(payload, true);
      setProjectInput('');
      setConfirmDisconnect(false);
      setNotice('Web Project desconectado do Builder.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível desconectar o Adobe Fonts.',
      );
    } finally {
      setOperation(null);
    }
  };

  if (!settingsUrl) {
    return (
      <div
        data-kodety-adobe-fonts-settings
        data-kodety-settings-card
        className="flex items-start gap-3 p-4 text-[11px] leading-5 text-muted-foreground"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          {licensed === false ? (
            <>
              Atualize o plugin WordPress para habilitar a configuração nativa do Adobe Fonts.
            </>
          ) : licensed === true ? (
            <>Somente administradores do WordPress podem conectar ou ressincronizar o Adobe Fonts.</>
          ) : (
            <>A conexão com Adobe Fonts requer uma versão compatível do plugin WordPress.</>
          )}
        </p>
      </div>
    );
  }

  if (operation === 'load' && !status) {
    return (
      <div
        data-kodety-adobe-fonts-settings
        className="flex items-center gap-2 py-5 text-[11px] text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" /> Consultando o Adobe Fonts…
      </div>
    );
  }

  return (
    <div data-kodety-adobe-fonts-settings className="space-y-4">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--kodety-divider)] pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Web Project</p>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
            O Kodety lê as famílias publicadas no seu Web Project. Para
            adicionar ou remover fontes, altere o projeto na Adobe e
            ressincronize aqui.
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-[10px] ${status?.configured ? 'text-emerald-400' : 'text-muted-foreground'}`}
        >
          {status?.configured && <CheckCircle2 className="size-3" />}
          {status?.configured ? 'Conectado' : 'Não conectado'}
        </span>
      </div>

      <div data-kodety-settings-card className="space-y-3 p-4">
        <label className="block text-[10px] font-medium text-foreground">
          Web Project ID ou código de embed
          <Input
            className="mt-1 font-mono text-xs"
            value={projectInput}
            onChange={(event) => setProjectInput(event.target.value)}
            placeholder="abc1234 ou https://use.typekit.net/abc1234.css"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy || readOnly}
          />
          <span className="mt-1 block font-normal leading-4 text-muted-foreground">
            Cole o ID, a URL CSS ou o código {'<link>'} fornecido em Web
            Projects pelo Adobe Fonts.
          </span>
        </label>
        {projectInput.trim() && !projectId && (
          <p className="flex items-center gap-1.5 text-[10px] text-amber-300">
            <AlertTriangle className="size-3" /> Informe um Web Project ID ou
            embed válido.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--kodety-divider)] pt-3">
          <a
            href="https://fonts.adobe.com/my_fonts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[var(--kodety-accent-hover)] hover:underline"
          >
            Gerenciar Web Projects na Adobe{' '}
            <ExternalLink className="size-2.5" />
          </a>
          <Button
            type="button"
            size="sm"
            disabled={busy || readOnly || !projectId}
            onClick={() => void saveAndSync()}
          >
            {operation === 'save' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Salvar e sincronizar
          </Button>
        </div>
      </div>

      {status?.configured && (
        <div
          data-kodety-settings-card
          className="px-4 py-3 text-[11px] leading-5 text-muted-foreground"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <span className="font-medium text-foreground">
                {status.familyCount}{' '}
                {status.familyCount === 1
                  ? 'família disponível'
                  : 'famílias disponíveis'}
              </span>
              {' · '}
              {formatSyncedAt(status.syncedAt)}
            </p>
            {status.stale && (
              <span className="text-amber-300">
                Exibindo a última sincronização válida
              </span>
            )}
          </div>
          {status.lastError && (
            <p className="mt-2 flex items-start gap-1.5 text-amber-300">
              <AlertTriangle className="mt-1 size-3 shrink-0" />{' '}
              {status.lastError}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-2 text-[10px] leading-4 text-muted-foreground sm:grid-cols-2">
        <p data-kodety-settings-card className="p-3">
          Alterações feitas no Web Project podem levar até 5 minutos para
          aparecer no Kodety.
        </p>
        <p data-kodety-settings-card className="p-3">
          Use apenas projetos e fontes que você está autorizado a publicar. As
          fontes continuam hospedadas e licenciadas pela Adobe; o Kodety não
          baixa nem redistribui os arquivos.
        </p>
      </div>

      {(error || notice) && (
        <p
          className={`rounded-[9px] border px-3 py-2 text-[10px] leading-4 ${error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'}`}
          role={error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {error || notice}
        </p>
      )}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-end">
        {status?.configured &&
          (confirmDisconnect ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-[10px] text-muted-foreground">
                Remover a conexão e o catálogo sincronizado?
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy || readOnly}
                onClick={() => void disconnect()}
              >
                {operation === 'disconnect' ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Unlink />
                )}
                Confirmar desconexão
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || readOnly}
              onClick={() => setConfirmDisconnect(true)}
            >
              <Unlink /> Desconectar
            </Button>
          ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || readOnly || !status?.configured || !syncUrl}
          onClick={() => void resync()}
        >
          {operation === 'sync' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          Ressincronizar
        </Button>
      </div>
    </div>
  );
}
