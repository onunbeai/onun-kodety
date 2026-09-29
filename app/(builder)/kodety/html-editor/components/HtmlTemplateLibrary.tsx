'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, FilePlus2, Search, Upload } from '@/components/ui/gravity-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface TemplateItem {
  slug: string;
  name: string;
  description: string;
  category: string;
  badge: string;
  pages: number;
  featured: boolean;
  sourceLabel: string;
}

interface TemplateCatalog {
  templates: TemplateItem[];
  hasWorkspace: boolean;
  categories: Record<string, string>;
}

interface HtmlTemplateLibraryProps {
  logoMenu?: ReactNode;
  backHref: string;
  catalogUrl: string;
  applyUrl: string;
  uploadUrl: string;
  nonce: string;
}

export function HtmlTemplateLibrary({ logoMenu, backHref, catalogUrl, applyUrl, uploadUrl, nonce }: HtmlTemplateLibraryProps) {
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const response = await fetch(catalogUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': nonce },
    });
    const payload = await response.json().catch(() => null) as TemplateCatalog & { message?: string } | null;
    if (!response.ok || !payload) throw new Error(payload?.message || 'Não foi possível carregar os templates.');
    setCatalog(payload);
  };

  useEffect(() => {
    void load().catch(error => toast.error('Templates indisponíveis', { description: error instanceof Error ? error.message : undefined }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogUrl]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (catalog?.templates || []).filter(template => (
      (category === 'all' || template.category === category)
      && (!normalized || `${template.name} ${template.description}`.toLocaleLowerCase().includes(normalized))
    ));
  }, [catalog?.templates, category, query]);

  const applyTemplate = async (template: TemplateItem) => {
    let replaceAcknowledged = false;
    let replacePhrase = '';
    if (catalog?.hasWorkspace) {
      replacePhrase = window.prompt(
        `O template “${template.name}” substituirá somente o rascunho editável atual. Digite APLICAR para continuar.`,
        '',
      ) || '';
      replaceAcknowledged = replacePhrase === 'APLICAR';
      if (!replaceAcknowledged) return;
    }
    setBusy(template.slug);
    try {
      const response = await fetch(applyUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        body: JSON.stringify({ template: template.slug, replaceAcknowledged, replacePhrase }),
      });
      const payload = await response.json().catch(() => null) as { builderUrl?: string; message?: string } | null;
      if (!response.ok || !payload?.builderUrl) throw new Error(payload?.message || 'Não foi possível abrir o template.');
      window.location.assign(payload.builderUrl);
    } catch (error) {
      toast.error('Template não aplicado', { description: error instanceof Error ? error.message : undefined });
      setBusy('');
    }
  };

  const uploadTemplate = async (file: File) => {
    const name = window.prompt('Nome deste template', file.name.replace(/\.zip$/i, ''))?.trim();
    if (name === undefined) return;
    const form = new FormData();
    form.set('template_zip', file);
    form.set('template_name', name || file.name.replace(/\.zip$/i, ''));
    form.set('template_category', 'other');
    form.set('template_description', 'Template completo enviado pela biblioteca do Builder.');
    setBusy('upload');
    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': nonce },
        body: form,
      });
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(payload?.message || 'Não foi possível adicionar o ZIP.');
      await load();
      toast.success('Template adicionado à biblioteca');
    } catch (error) {
      toast.error('Upload não concluído', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy('');
    }
  };

  return (
    <main data-kodety-onboarding="templates-workspace" className="flex h-screen flex-col overflow-hidden bg-[#0c0c0d] text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 sm:px-6">
        <div className="flex items-center gap-3">
          {logoMenu && <div className="-ml-4 shrink-0 sm:-ml-6">{logoMenu}</div>}
          <Button size="icon-sm" variant="ghost" asChild><a href={backHref} aria-label="Voltar ao Builder"><ChevronLeft /></a></Button>
          <div><p className="text-xs font-semibold">Templates</p><p className="text-[10px] text-zinc-500">Sites completos e reutilizáveis</p></div>
        </div>
        <Button data-kodety-onboarding="templates-import" size="sm" className="gap-2" disabled={busy === 'upload'} onClick={() => uploadRef.current?.click()}><Upload />{busy === 'upload' ? 'Enviando…' : 'Importar template ZIP'}</Button>
        <input ref={uploadRef} className="hidden" type="file" accept=".zip,application/zip" onChange={event => {
          const file = event.target.files?.[0];
          if (file) void uploadTemplate(file);
          event.target.value = '';
        }} />
      </header>

      <section className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--kodety-accent-hover)]">Biblioteca Kodety</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">Abra um site inteiro no Builder.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">Páginas, estilos, componentes, assets e Interactions entram como um projeto editável. Os ZIPs enviados ficam disponíveis para reutilização.</p>
          </div>

          <div data-kodety-onboarding="templates-filters" className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-zinc-500 focus-within:border-[var(--kodety-focus)]/60">
              <Search className="size-4" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar template" className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" />
            </label>
            <div className="flex max-w-full gap-1 overflow-auto rounded-lg bg-white/[0.035] p-1">
              <button className={`shrink-0 rounded-md px-3 py-2 text-[11px] ${category === 'all' ? 'bg-white/10 text-white' : 'text-zinc-500'}`} onClick={() => setCategory('all')}>Todos</button>
              {Object.entries(catalog?.categories || {}).map(([slug, label]) => <button key={slug} className={`shrink-0 rounded-md px-3 py-2 text-[11px] ${category === slug ? 'bg-white/10 text-white' : 'text-zinc-500'}`} onClick={() => setCategory(slug)}>{label}</button>)}
            </div>
          </div>

          {!catalog ? <div className="mt-10 text-sm text-zinc-500">Carregando biblioteca…</div> : (
            <div data-kodety-onboarding="templates-catalog" className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((template, index) => (
                <article key={template.slug} className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151516]">
                  <div className={`relative h-48 overflow-hidden p-6 ${index % 3 === 0 ? 'bg-[#d8ff64] text-black' : index % 3 === 1 ? 'bg-[var(--kodety-accent-hover)] text-white' : 'bg-[#f2a37f] text-black'}`}>
                    <span className="text-[10px] font-bold tracking-[0.14em]">{template.badge || 'KODETY'}</span>
                    <p className="mt-12 max-w-[80%] text-2xl font-semibold leading-none tracking-[-0.04em]">{template.name}</p>
                    <div className="absolute -bottom-10 -right-8 size-36 rounded-full border-[18px] border-black/10" />
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-zinc-500"><span>{catalog.categories[template.category] || 'Template'}</span>{template.featured && <span className="rounded-full bg-[var(--kodety-accent-hover)]/10 px-2 py-1 text-[var(--kodety-accent-hover)]">Destaque</span>}</div>
                    <h2 className="mt-3 text-lg font-semibold">{template.name}</h2>
                    <p className="mt-2 min-h-10 text-xs leading-5 text-zinc-400">{template.description}</p>
                    <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-500"><span>{template.pages} páginas</span><span>{template.sourceLabel}</span></div>
                    <Button className="mt-5 w-full justify-between" disabled={Boolean(busy)} onClick={() => void applyTemplate(template)}>
                      {busy === template.slug ? 'Abrindo…' : 'Usar este template'}<ArrowRight />
                    </Button>
                  </div>
                </article>
              ))}
              {!visible.length && <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-zinc-500"><FilePlus2 className="mx-auto mb-3 size-6" />Nenhum template encontrado.</div>}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
