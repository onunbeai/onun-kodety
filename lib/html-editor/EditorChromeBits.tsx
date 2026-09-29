import { useId } from 'react';
import { KodetyLoadingMark, KodetyLoadingScreen } from '@/components/ui/kodety-loading-screen';
import { AlertTriangle } from '@/components/ui/gravity-icons';
import type { KodetyWordPressConfig } from '@/lib/html-editor/editor-types';
import { cn } from '@/lib/utils';

export function LazyPanelFallback({ label, overlay = false }: { label: string; overlay?: boolean }) {
  return (
    <KodetyLoadingScreen
      label={label}
      className={overlay ? 'fixed inset-0 z-[590] min-h-0' : 'h-full min-h-0'}
    />
  );
}

export function EditorCornerIcon({ name, logoUrl, className }: { name?: KodetyWordPressConfig['editorCornerIcon']; logoUrl?: string; className?: string }) {
  if (name === 'client-logo' && logoUrl)
    return <img src={logoUrl} alt="" className={cn('h-6 max-w-7 rounded-sm object-contain', className)} />;
  return <KodetyLoadingMark className={cn('h-6 w-[22px]', className)} />;
}

export function EditorCornerMenuGlyph({
  name,
  logoUrl,
  menuOnly = false,
}: {
  name?: KodetyWordPressConfig['editorCornerIcon'];
  logoUrl?: string;
  /** The Studio shell already owns the product mark. Keep this trigger as a
   * clear menu affordance instead of rendering the Kodety logo twice. */
  menuOnly?: boolean;
}) {
  return (
    <span className="relative grid size-5 place-items-center" aria-hidden="true">
      {!menuOnly ? (
        <EditorCornerIcon
          name={name}
          logoUrl={logoUrl}
          className="h-5! w-auto! max-w-5! transition-opacity group-hover:opacity-0 group-data-[state=open]:opacity-0"
        />
      ) : null}
      <span
        data-editor-corner-hamburger
        className={cn(
          'absolute inset-0 flex-col items-center justify-center gap-1',
          menuOnly ? 'flex' : 'hidden group-hover:flex group-data-[state=open]:flex',
        )}
      >
        <span className="h-px w-[18px] bg-current" />
        <span className="h-px w-[18px] bg-current" />
        <span className="h-px w-[18px] bg-current" />
      </span>
    </span>
  );
}

export function MissingAssetsIndicator({
  assets,
  floating = false,
  align = 'left',
}: {
  assets: string[];
  floating?: boolean;
  align?: 'left' | 'right';
}) {
  const detailsId = useId();
  if (!assets.length) return null;
  const countLabel = `${assets.length} asset${assets.length === 1 ? '' : 's'} ausente${assets.length === 1 ? '' : 's'}`;
  return (
    <div
      className={cn(
        'group pointer-events-auto relative',
        floating && 'absolute left-3 top-3 z-40',
      )}
    >
      <button
        type="button"
        aria-describedby={detailsId}
        className={cn(
          'flex items-center gap-1.5 text-amber-400 outline-none',
          floating && 'h-7 rounded-[6px] border border-amber-400/20 bg-[#211d16]/95 px-2 text-[10px] text-amber-300 shadow-lg backdrop-blur',
          !floating && 'text-[10px]',
        )}
      >
        <AlertTriangle className="size-3 shrink-0" />
        <span>{countLabel}</span>
      </button>
      <div
        id={detailsId}
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute top-full z-[120] mt-2 w-[min(420px,calc(100vw-48px))] rounded-[8px] border border-amber-400/20 bg-[#171717]/98 p-3 text-left opacity-0 shadow-2xl backdrop-blur transition-opacity',
          'group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <p className="text-[10px] font-semibold text-amber-300">Arquivos não encontrados</p>
        <p className="mt-1 text-[9px] leading-3.5 text-zinc-400">Estes caminhos foram referenciados, mas não existem no projeto:</p>
        <ul className="mt-2 max-h-52 space-y-1.5 overflow-auto pr-1">
          {assets.map(asset => (
            <li key={asset} className="break-all rounded bg-white/[0.04] px-2 py-1.5 font-mono text-[9px] leading-3.5 text-zinc-200">
              {asset}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
