'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, Search, Upload, X } from '@/components/ui/gravity-icons';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface WordPressMediaItem {
  id: number;
  source_url: string;
  alt_text?: string;
  title?: { rendered?: string };
  media_details?: {
    sizes?: Record<string, { source_url?: string }>;
  };
}

interface WordPressMediaConnection {
  mediaUrl: string;
  nonce: string;
}

function getWordPressMediaConnection(): WordPressMediaConnection | null {
  if (typeof window === 'undefined') return null;
  const config = (window as typeof window & {
    kodetyWordPress?: { mediaUploadUrl?: string; nonce?: string };
  }).kodetyWordPress;
  const mediaUrl = config?.mediaUploadUrl?.trim() || '';
  if (!mediaUrl) return null;
  return { mediaUrl, nonce: config?.nonce || '' };
}

export function hasWordPressMediaLibrary() {
  return Boolean(getWordPressMediaConnection());
}

function mediaPreviewUrl(item: WordPressMediaItem) {
  return item.media_details?.sizes?.medium?.source_url
    || item.media_details?.sizes?.thumbnail?.source_url
    || item.source_url;
}

export default function WordPressBackgroundMediaDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(url: string): void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<WordPressMediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const connection = getWordPressMediaConnection();
    if (!open || !connection) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const endpoint = new URL(connection.mediaUrl, window.location.href);
      endpoint.searchParams.set('media_type', 'image');
      endpoint.searchParams.set('per_page', '48');
      endpoint.searchParams.set('orderby', 'date');
      endpoint.searchParams.set('order', 'desc');
      if (search.trim()) endpoint.searchParams.set('search', search.trim());
      setLoading(true);
      fetch(endpoint, {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection.nonce },
        signal: controller.signal,
      })
        .then(response => response.ok
          ? response.json()
          : Promise.reject(new Error('Não foi possível abrir a Biblioteca de Mídia.')))
        .then((media: WordPressMediaItem[]) => setItems(media))
        .catch(error => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            toast.error(error instanceof Error ? error.message : 'Biblioteca de Mídia indisponível.');
          }
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, search]);

  const upload = async (file?: File) => {
    const connection = getWordPressMediaConnection();
    if (!file || !connection) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('title', file.name.replace(/\.[^.]+$/, ''));
      const response = await fetch(connection.mediaUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': connection.nonce },
        body,
      });
      const media = (await response.json().catch(() => null)) as (WordPressMediaItem & { message?: string }) | null;
      if (!response.ok || !media?.source_url) {
        throw new Error(media?.message || 'Não foi possível enviar a imagem.');
      }
      setItems(current => [media, ...current.filter(item => item.id !== media.id)]);
      onSelect(media.source_url);
      onOpenChange(false);
      toast.success('Imagem enviada à Biblioteca de Mídia.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar imagem.');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[10020] bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          data-ycode-native-ui
          data-kodety-i18n-root
          className="fixed left-1/2 top-1/2 z-[10021] flex h-[min(76vh,720px)] w-[min(880px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-white/[.08] bg-[var(--kodety-panel)] text-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-white/[.07] px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-xs font-medium">Biblioteca de Mídia</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[10px] text-muted-foreground">
                Escolha uma imagem existente ou envie uma nova para o WordPress.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar Biblioteca de Mídia">
                <X className="size-3.5" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex shrink-0 items-center gap-2 border-b border-white/[.07] p-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar imagens…"
                aria-label="Buscar imagens na Biblioteca de Mídia"
                className="pl-8"
              />
            </div>
            <Button type="button" size="sm" disabled={uploading} onClick={() => uploadRef.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploading ? 'Enviando…' : 'Enviar imagem'}
            </Button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={event => { void upload(event.target.files?.[0]); }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Carregando biblioteca…
              </div>
            ) : items.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {items.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      onSelect(item.source_url);
                      onOpenChange(false);
                    }}
                    className="group min-w-0 overflow-hidden rounded-[9px] border border-white/[.055] bg-white/[.025] text-left outline-none transition-[border-color,background-color] hover:border-white/[.12] hover:bg-white/[.05] focus-visible:border-[var(--kodety-focus)]/75"
                  >
                    <span className="flex aspect-square items-center justify-center overflow-hidden bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaPreviewUrl(item)}
                        data-kodety-no-i18n
                        alt={item.alt_text || ''}
                        className="block size-full object-cover"
                      />
                    </span>
                    <span className="block truncate px-2 py-1.5 text-[10px]" data-kodety-no-i18n={item.title?.rendered ? true : undefined}>
                      {item.title?.rendered || `Imagem #${item.id}`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageIcon className="size-8" />
                <p className="text-xs">Nenhuma imagem encontrada.</p>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
