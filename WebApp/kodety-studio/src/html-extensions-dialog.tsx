import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Globe, Upload, Trash2 } from '../../../components/ui/gravity-icons';
import { HTML_LOCALIZATION_EXTENSION, htmlExtensions, htmlExtensionErrorMessage, type HtmlExtensionSummary } from './html-extensions';

/** The WordPress extension catalogue is server-rendered PHP. This HTML host
 * uses the same install → activate lifecycle and shared Builder UI primitives;
 * the editor and Localization workspace remain the shared implementations. */
export function HtmlExtensionsDialog({ projectId, language, onClose, onChange }: {
  projectId: string;
  language: 'pt' | 'en';
  onClose(): void;
  onChange(extensions: HtmlExtensionSummary[]): void;
}) {
  const l = (pt: string, en: string) => language === 'pt' ? pt : en;
  const [extensions, setExtensions] = useState<HtmlExtensionSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let current = true;
    void htmlExtensions.list(projectId).then(items => {
      if (current) setExtensions(items);
    }).catch(cause => {
      if (current) setError(htmlExtensionErrorMessage(cause, language));
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [projectId, language]);
  const extension = extensions.find(item => item.manifest.slug === HTML_LOCALIZATION_EXTENSION);
  const run = async (operation: () => Promise<HtmlExtensionSummary[]>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const items = await operation();
      setExtensions(items);
      onChange(items);
      setFeedback(message);
      setFile(null);
      if (input.current) input.current.value = '';
    } catch (cause) {
      setError(htmlExtensionErrorMessage(cause, language));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent width="560px" className="max-h-[calc(100dvh-32px)] overflow-y-auto gap-5" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{l('Extensões', 'Extensions')}</DialogTitle>
          <DialogDescription className="text-balance">
            {l('Instale recursos adicionais neste workspace.', 'Install additional features in this workspace.')}
          </DialogDescription>
        </DialogHeader>
        <section className="grid gap-3 rounded-[9px] border border-white/[.065] bg-white/[.018] p-4" aria-labelledby="html-extension-upload-heading">
          <div>
            <h2 id="html-extension-upload-heading" className="text-[12px] font-semibold">{l('Instalar extensão por ZIP', 'Install extension ZIP')}</h2>
            <p className="mt-1 text-balance text-[11px] leading-[1.65] text-[var(--kodety-info-copy)]">
              {l('Use o mesmo ZIP da extensão Localization distribuído para WordPress. Após instalar, ative a extensão abaixo.', 'Use the same Localization extension ZIP distributed for WordPress. After installing, activate it below.')}
            </p>
          </div>
          <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-label={l('ZIP da extensão', 'Extension ZIP')} disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setFeedback(''); }} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}><Upload />{l('Escolher ZIP', 'Choose ZIP')}</Button>
            <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--kodety-text-tertiary)]" title={file?.name}>{file?.name || l('Nenhum arquivo selecionado', 'No file selected')}</span>
            <Button disabled={busy || !file} onClick={() => file && void run(() => htmlExtensions.install(projectId, file), l('Extensão instalada. Ative-a para usar.', 'Extension installed. Activate it to begin.'))}>{l('Instalar ZIP', 'Install ZIP')}</Button>
          </div>
        </section>
        <article className="overflow-hidden rounded-[9px] border border-white/[.065]">
          <div className="flex items-start gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[.045] text-white/45"><Globe className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[12px] font-semibold">Kodety Multi-language</h2>
              {extension && <p className="mt-0.5 text-[10px] text-[var(--kodety-text-tertiary)]">v{extension.manifest.version}</p>}
              <p className="mt-2 text-balance text-[11px] leading-[1.65] text-[var(--kodety-info-copy)]">{l('Idiomas, traduções e rotas localizadas no mesmo Builder. Compatível com exportação HTML estática.', 'Languages, translations and localized routes in the same Builder. Compatible with static HTML exports.')}</p>
            </div>
            <span className="shrink-0 rounded-full bg-white/[.045] px-2 py-1 text-[9px] text-[var(--kodety-text-secondary)]">{extension ? extension.active ? l('Ativa', 'Active') : l('Inativa', 'Inactive') : l('Não instalada', 'Not installed')}</span>
          </div>
          {extension && <footer className="flex items-center justify-between gap-3 border-t border-white/[.055] px-4 py-3">
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => void run(() => htmlExtensions.remove(projectId, HTML_LOCALIZATION_EXTENSION), l('Extensão removida. As traduções foram preservadas.', 'Extension removed. Translations were preserved.'))}><Trash2 />{l('Remover', 'Remove')}</Button>
            <Button variant={extension.active ? 'secondary' : 'default'} disabled={busy} onClick={() => void run(() => htmlExtensions.setActive(projectId, HTML_LOCALIZATION_EXTENSION, !extension.active), extension.active ? l('Extensão desativada. As traduções foram preservadas.', 'Extension deactivated. Translations were preserved.') : l('Extensão ativada neste workspace.', 'Extension activated in this workspace.'))}>{extension.active ? l('Desativar', 'Deactivate') : l('Ativar', 'Activate')}</Button>
          </footer>}
        </article>
        <p className="text-balance text-[10px] leading-[1.65] text-[var(--kodety-info-copy)]">{l('A instalação fica salva neste navegador, por workspace. Desativar ou remover preserva as traduções existentes no projeto e na exportação.', 'Installation is saved in this browser, per workspace. Deactivating or removing preserves existing translations in the project and its exports.')}</p>
        {busy && <p role="status" className="text-[11px] text-[var(--kodety-info-copy)]">{l('Aguarde…', 'Please wait…')}</p>}
        {error && <p role="alert" className="text-balance text-[11px] leading-[1.65] text-[#ff8190]">{error}</p>}
        {feedback && <p role="status" className="text-balance text-[11px] leading-[1.65] text-[var(--kodety-accent-hover)]">{feedback}</p>}
      </DialogContent>
    </Dialog>
  );
}
