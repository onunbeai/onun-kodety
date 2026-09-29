import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../../components/ui/dialog';
import { Download } from '../../../components/ui/gravity-icons';

export function HtmlWordPressFeatureDialog({ feature, language, busy, onClose, onExport }: {
  feature: 'CMS' | 'Analytics';
  language: 'en' | 'pt';
  busy: boolean;
  onClose(): void;
  onExport(): Promise<void>;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState('');
  const pt = language === 'pt';
  const download = async () => {
    setError('');
    try { await onExport(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (pt ? 'Não foi possível exportar o projeto.' : 'Could not export the project.')); }
  };
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent
        width="440px"
        className="z-[20001] w-[calc(100vw-24px)] gap-0 p-0"
        overlayClassName="z-[20000]"
        showCloseButton={!busy}
        onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={event => { if (busy) event.preventDefault(); }}
      >
        <div className="px-5 pb-5 pt-5">
          <DialogTitle ref={title} tabIndex={-1} className="pr-8 outline-none">
            {pt ? `${feature} requer WordPress` : `${feature} requires WordPress`}
          </DialogTitle>
          <DialogDescription className="mt-3 text-balance text-[12px]">
            {pt
              ? `${feature} está disponível com o plugin Onun Kodety instalado no seu WordPress.`
              : `${feature} is available with the Onun Kodety plugin installed on your WordPress site.`}
          </DialogDescription>
          <p className="mt-3 text-balance text-[11px] leading-[1.65] text-[var(--kodety-info-copy)]">
            {pt
              ? 'Instale o WordPress na sua hospedagem e ative o plugin Onun Kodety. Depois, baixe o ZIP editável abaixo e importe pelo Kodety para continuar com suas páginas, arquivos e configurações.'
              : 'Install WordPress on your hosting and activate the Onun Kodety plugin. Then download the editable ZIP below and import it through Kodety to continue with your pages, files, and settings.'}
          </p>
          <a className="mt-3 inline-block text-xs underline" href="./assets/kodety.zip" download target="_blank" rel="noopener noreferrer">{pt ? 'Baixar plugin Onun Kodety para WordPress' : 'Download the Onun Kodety plugin for WordPress'}</a>
          {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="border-t border-[var(--kodety-divider)] px-5 py-4">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {pt ? 'Voltar ao editor' : 'Back to editor'}
          </Button>
          <Button disabled={busy} onClick={() => void download()}>
            <Download />
            {busy ? (pt ? 'Exportando…' : 'Exporting…') : (pt ? 'Exportar ZIP editável' : 'Export editable ZIP')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
