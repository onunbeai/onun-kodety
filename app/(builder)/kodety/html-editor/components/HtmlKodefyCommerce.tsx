'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Download, ExternalLink, Plug, ShoppingCart } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';

interface KodefySettings {
  shopDomain: string;
  storefrontTokenType: 'public' | 'private';
  hasStorefrontToken: boolean;
  hasAdminToken: boolean;
  country: string;
  language: string;
  routes: Record<string, string>;
  templates: Record<string, string>;
  apiVersion: string;
}

interface HtmlKodefyCommerceProps {
  backHref: string;
  templatesHref?: string;
  settingsUrl: string;
  connectionTestUrl: string;
  builderDataUrl?: string;
  downloadKitUrl?: string;
  downloadThemeUrl?: string;
  nonce: string;
}

interface KodefySyncSummary {
  configured: boolean;
  syncedAt?: string;
  productCount?: number;
  hasMoreProducts?: boolean;
  error?: string;
}

const routeLabels: Record<string, string> = {
  shop: 'Loja', product: 'Produto', collection: 'Coleção', cart: 'Carrinho', search: 'Busca', wishlist: 'Favoritos',
};

export function HtmlKodefyCommerce(props: HtmlKodefyCommerceProps) {
  const [settings, setSettings] = useState<KodefySettings | null>(null);
  const [storefrontToken, setStorefrontToken] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<KodefySyncSummary | null>(null);

  const loadSync = async (force = false) => {
    if (!props.builderDataUrl) return null;
    setSyncing(true);
    try {
      const response = await fetch(props.builderDataUrl, {
        method: force ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-WP-Nonce': props.nonce },
      });
      const payload = await response.json().catch(() => null) as {
        configured?: boolean;
        syncedAt?: string;
        products?: { nodes?: unknown[]; pageInfo?: { hasNextPage?: boolean } };
        message?: string;
      } | null;
      if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível sincronizar o catálogo.');
      const summary = {
        configured: Boolean(payload.configured),
        syncedAt: payload.syncedAt || '',
        productCount: payload.products?.nodes?.length || 0,
        hasMoreProducts: Boolean(payload.products?.pageInfo?.hasNextPage),
      };
      setSync(summary);
      return summary;
    } finally {
      setSyncing(false);
    }
  };

  const load = async () => {
    const response = await fetch(props.settingsUrl, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': props.nonce } });
    const payload = await response.json().catch(() => null) as KodefySettings & { message?: string } | null;
    if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível carregar a integração.');
    setSettings(payload);
  };

  useEffect(() => {
    void load().catch(error => toast.error('Kodefy indisponível', { description: error instanceof Error ? error.message : undefined }));
    void loadSync().catch(error => setSync({ configured: false, error: error instanceof Error ? error.message : 'Falha na sincronização.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settingsUrl, props.builderDataUrl]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await fetch(props.settingsUrl, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': props.nonce },
        body: JSON.stringify({ ...settings, storefrontToken, adminToken }),
      });
      const payload = await response.json().catch(() => null) as { message?: string; sync?: KodefySyncSummary } | null;
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível salvar.');
      if (payload?.sync) setSync(payload.sync);
      setStorefrontToken(''); setAdminToken(''); await load();
      if (payload?.sync?.error) {
        toast.warning('Conexão salva; sincronização pendente', { description: payload.sync.error });
      } else {
        toast.success('Shopify configurada no Kodefy', {
          description: payload?.sync?.configured
            ? `${payload.sync.productCount || 0} produtos sincronizados com o Builder.`
            : undefined,
        });
      }
    } catch (error) {
      toast.error('Configuração não salva', { description: error instanceof Error ? error.message : undefined });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const response = await fetch(props.connectionTestUrl, { method: 'POST', credentials: 'same-origin', headers: { 'X-WP-Nonce': props.nonce } });
      const payload = await response.json().catch(() => null) as { shop?: string; currency?: string; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || 'A Shopify recusou a conexão.');
      toast.success(`Conectado a ${payload?.shop || 'Shopify'}`, { description: payload?.currency ? `Moeda: ${payload.currency}` : undefined });
    } catch (error) {
      toast.error('Falha no teste', { description: error instanceof Error ? error.message : undefined });
    } finally { setTesting(false); }
  };

  const refreshCatalog = async () => {
    try {
      const result = await loadSync(true);
      toast.success('Catálogo sincronizado', {
        description: `${result?.productCount || 0} produtos disponíveis no Builder.`,
      });
    } catch (error) {
      toast.error('Falha na sincronização', { description: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#0c0c0d] text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 sm:px-6">
        <div className="flex items-center gap-3"><Button size="icon-sm" variant="ghost" asChild><a href={props.backHref} aria-label="Voltar ao Builder"><ChevronLeft /></a></Button><div><p className="text-xs font-semibold">Kodefy Commerce</p><p className="text-[10px] text-zinc-500">WordPress × Shopify</p></div></div>
        <span className={`rounded-full border px-3 py-1.5 text-[10px] ${settings?.hasStorefrontToken ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'}`}>{settings?.hasStorefrontToken ? 'Storefront conectado' : 'Configuração pendente'}</span>
      </header>
      <section className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
          <div className="rounded-2xl border border-white/[0.08] bg-[#151516] p-6 sm:p-8">
            <div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#95bf47] text-black"><Plug className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#95bf47]">Backend Shopify</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Conectar loja</h1><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-400">Produtos, variantes, estoque, carrinho e checkout vêm da Storefront API. O token fica criptografado no WordPress e o checkout continua oficial da Shopify.</p></div></div>
            {!settings ? <p className="mt-8 text-sm text-zinc-500">Carregando configuração…</p> : <div className="mt-8 space-y-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs"><span>Domínio permanente</span><Input value={settings.shopDomain} onChange={event => setSettings({ ...settings, shopDomain: event.target.value })} placeholder="minha-loja.myshopify.com" /></label>
                <label className="space-y-2 text-xs"><span>Tipo do token Storefront</span><select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-xs" value={settings.storefrontTokenType} onChange={event => setSettings({ ...settings, storefrontTokenType: event.target.value as 'public' | 'private' })}><option value="public">Público</option><option value="private">Privado via WordPress</option></select></label>
                <label className="space-y-2 text-xs sm:col-span-2"><span>Storefront API token {settings.hasStorefrontToken && <em className="ml-1 not-italic text-emerald-400">· salvo</em>}</span><Input type="password" value={storefrontToken} onChange={event => setStorefrontToken(event.target.value)} autoComplete="new-password" placeholder="Deixe vazio para preservar o atual" /></label>
                <label className="space-y-2 text-xs"><span>País (ISO)</span><Input maxLength={2} value={settings.country} onChange={event => setSettings({ ...settings, country: event.target.value.toUpperCase() })} /></label>
                <label className="space-y-2 text-xs"><span>Idioma (ISO)</span><Input maxLength={2} value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value.toUpperCase() })} /></label>
              </div>
              <div><h2 className="text-sm font-semibold">Rotas no WordPress</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(routeLabels).map(([key, label]) => <label key={key} className="space-y-1.5 text-[10px] text-zinc-400"><span>{label}</span><Input value={settings.routes[key] || `/${key}/`} onChange={event => setSettings({ ...settings, routes: { ...settings.routes, [key]: event.target.value } })} /></label>)}</div></div>
              <div><h2 className="text-sm font-semibold">Templates dinâmicos</h2><p className="mt-1 text-[11px] leading-5 text-zinc-500">Rota da página do Builder usada para renderizar cada produto ou coleção.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-[10px] text-zinc-400"><span>Produto</span><Input value={settings.templates?.product || 'product'} onChange={event => setSettings({ ...settings, templates: { ...(settings.templates || {}), product: event.target.value } })} placeholder="product" /></label><label className="space-y-1.5 text-[10px] text-zinc-400"><span>Coleção</span><Input value={settings.templates?.collection || 'collection'} onChange={event => setSettings({ ...settings, templates: { ...(settings.templates || {}), collection: event.target.value } })} placeholder="collection" /></label></div></div>
              <div><h2 className="text-sm font-semibold">Admin API opcional</h2><p className="mt-1 text-[11px] leading-5 text-zinc-500">Necessário somente para enviar um tema de rascunho à Shopify. Requer permissão <code>write_themes</code>.</p><label className="mt-3 block space-y-2 text-xs"><span>Admin API token {settings.hasAdminToken && <em className="ml-1 not-italic text-emerald-400">· salvo</em>}</span><Input type="password" value={adminToken} onChange={event => setAdminToken(event.target.value)} autoComplete="new-password" placeholder="Deixe vazio para preservar o atual" /></label></div>
              <div className="flex flex-wrap gap-2"><Button onClick={() => void save()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar conexão'}</Button><Button variant="secondary" onClick={() => void test()} disabled={testing || !settings.hasStorefrontToken}>{testing ? 'Testando…' : 'Testar conexão'}</Button>{props.builderDataUrl && <Button variant="secondary" onClick={() => void refreshCatalog()} disabled={syncing || !settings.hasStorefrontToken}>{syncing ? 'Sincronizando…' : 'Sincronizar catálogo'}</Button>}</div>
              {sync && <div className={`rounded-xl border px-4 py-3 text-[11px] ${sync.error ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200' : 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'}`}>{sync.error || (sync.configured ? `${sync.productCount || 0}${sync.hasMoreProducts ? '+' : ''} produtos sincronizados com o Builder${sync.syncedAt ? ` · ${new Date(sync.syncedAt).toLocaleString(getAdminUiLocale())}` : ''}.` : 'Conecte a Shopify para sincronizar o catálogo com o Builder.')}</div>}
            </div>}
          </div>
          <aside className="space-y-5">
            <div className="rounded-2xl bg-[#d8ff64] p-6 text-black"><ShoppingCart className="size-6" /><h2 className="mt-5 text-xl font-semibold tracking-[-0.03em]">Começar com a loja pronta</h2><p className="mt-2 text-xs leading-5 text-black/65">O template Kodefy Commerce já traz produto, coleção, busca, favoritos, carrinho lateral e checkout Shopify.</p>{props.templatesHref && <Button className="mt-5 w-full justify-between bg-black text-white hover:bg-black/85" asChild><a href={props.templatesHref}>Abrir templates<ArrowRight /></a></Button>}</div>
            <div className="rounded-2xl border border-white/[0.08] bg-[#151516] p-6"><h2 className="text-sm font-semibold">Pacotes</h2><div className="mt-4 space-y-2">{props.downloadKitUrl && <Button variant="secondary" className="w-full justify-start gap-2" asChild><a href={props.downloadKitUrl}><Download />Kit editável Kodety</a></Button>}{props.downloadThemeUrl && <Button variant="secondary" className="w-full justify-start gap-2" asChild><a href={props.downloadThemeUrl}><Download />Tema Shopify Liquid</a></Button>}</div></div>
            <div className="rounded-2xl border border-white/[0.08] bg-[#151516] p-6"><div className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-emerald-400" /><p className="text-xs leading-5 text-zinc-400">O cliente compra no front WordPress; o botão final usa <code>checkoutUrl</code> e leva ao checkout seguro da Shopify. Pedido e rastreio permanecem lá.</p></div><a className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--kodety-accent-hover)]" href="https://admin.shopify.com" target="_blank" rel="noreferrer">Abrir Shopify Admin <ExternalLink className="size-3" /></a></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
