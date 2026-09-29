import { useHtmlCollaborationStore } from '@/stores/useHtmlCollaborationStore';

export function WordPressEditorLockStatus() {
  const status = useHtmlCollaborationStore(state => state.status);
  const holder = useHtmlCollaborationStore(state => state.lock.name);
  if (status !== 'conflict' && status !== 'reconnecting') return null;
  const conflict = status === 'conflict';
  const label = conflict ? (holder ? `${holder} está editando` : 'Outra sessão editando') : 'Reconectando edição…';
  return <div
    role="status"
    data-editor-lock-status={conflict ? 'blocked' : 'reconnecting'}
    className="mx-1 flex items-center gap-2 rounded border border-amber-300/20 px-2 py-1 text-xs text-amber-200"
    title="Somente leitura até confirmar o acesso de edição."
  >
    <span className="max-w-48 truncate">{label}</span>
    <button type="button" className="shrink-0 underline" onClick={() => window.dispatchEvent(new Event('kodety-editor-lock-check'))}>Verificar agora</button>
  </div>;
}
