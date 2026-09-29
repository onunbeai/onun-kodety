'use client';

import { useEffect, useState } from 'react';
import { getAdminDateTimeFormatter } from '@/lib/admin-ui-locale';
import { withRequestTimeout } from '@/lib/request-timeout';

interface SitemapStatus {
  generated: boolean;
  enabled: boolean;
  url: string;
  source: string;
  release: string;
  urlCount: number;
  generatedAt: string;
  validationErrors: string[];
  accessStatus: string;
  googleSubmissionStatus: string;
  googleProcessingStatus: string;
}

function parseStatus(value: unknown): SitemapStatus {
  if (!value || typeof value !== 'object') throw new Error('O diagnóstico do sitemap não respondeu corretamente.');
  const status = value as SitemapStatus;
  if (typeof status.generated !== 'boolean' || typeof status.enabled !== 'boolean'
    || typeof status.url !== 'string' || typeof status.release !== 'string'
    || typeof status.source !== 'string' || typeof status.generatedAt !== 'string'
    || (status.generatedAt !== '' && !Number.isFinite(Date.parse(status.generatedAt)))
    || (status.generated && status.generatedAt === '')
    || typeof status.accessStatus !== 'string' || typeof status.googleSubmissionStatus !== 'string'
    || typeof status.googleProcessingStatus !== 'string'
    || !Number.isSafeInteger(status.urlCount) || status.urlCount < 0
    || !Array.isArray(status.validationErrors) || !status.validationErrors.every(error => typeof error === 'string')) {
    throw new Error('O diagnóstico do sitemap não respondeu corretamente.');
  }
  const url = new URL(status.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A URL do sitemap não é válida.');
  return status;
}

export function HtmlSitemapSettings({ endpoint, nonce }: { endpoint: string; nonce: string }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ scope: string; status?: SitemapStatus; error?: string } | null>(null);
  const scope = JSON.stringify([endpoint, nonce, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    void withRequestTimeout(async signal => {
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': nonce }, signal });
      if (!response.ok) throw new Error('Não foi possível consultar o sitemap publicado.');
      return parseStatus(await response.json());
    }, { timeoutMs: 12_000, timeoutMessage: 'A consulta do sitemap demorou demais.', signal: controller.signal })
      .then(status => { if (!controller.signal.aborted) setState({ scope, status }); })
      .catch(error => { if (!controller.signal.aborted) setState({ scope, error: error instanceof Error ? error.message : 'Não foi possível consultar o sitemap.' }); });
    return () => controller.abort();
  }, [endpoint, nonce, scope]);
  const current = state?.scope === scope ? state : null;
  const status = current?.status;
  const generatedAt = status?.generated ? new Date(status.generatedAt) : null;
  return (
    <section aria-label="Sitemap publicado" className="mt-4 rounded-xl border border-border/60 p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xs font-medium">Sitemap publicado</h3>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setRevision(value => value + 1)}>Atualizar diagnóstico</button>
      </div>
      {current?.error ? <p role="alert" className="mt-2 text-xs text-muted-foreground">{current.error}</p>
        : !status ? <p role="status" className="mt-2 text-xs text-muted-foreground">Consultando sitemap…</p>
          : <div className="mt-3 space-y-3 text-xs">
            <p>{!status.enabled ? 'Sitemap desativado na publicação.' : status.generated ? 'Sitemap gerado com as URLs da publicação Kodety.' : 'O sitemap será gerado na próxima publicação.'}</p>
            <a href={status.url} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">{status.url}</a>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-muted-foreground">
              <dt>Origem do inventário</dt><dd className="break-all">{status.source === 'kodety-publication' ? 'Publicação Kodety' : status.source}</dd>
              <dt>URLs incluídas</dt><dd>{status.urlCount}</dd>
              <dt>Publicação</dt><dd className="break-all">{status.release || 'Ainda não publicada'}</dd>
              <dt>Gerado em</dt><dd>{generatedAt && <time dateTime={generatedAt.toISOString()}>{getAdminDateTimeFormatter({ dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt)}</time>}</dd>
              <dt>Acesso público</dt><dd>{status.accessStatus === 'verified' ? 'Verificado' : 'Não verificado'}</dd>
              <dt>Envio ao Google</dt><dd>{status.googleSubmissionStatus === 'submitted' ? 'Enviado' : 'Não verificado'}</dd>
              <dt>Processamento pelo Google</dt><dd>{status.googleProcessingStatus === 'processed' ? 'Processado' : 'Não verificado'}</dd>
            </dl>
            {status.validationErrors.length > 0 && <ul role="alert" className="list-inside list-disc text-destructive">{status.validationErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
          </div>}
    </section>
  );
}
