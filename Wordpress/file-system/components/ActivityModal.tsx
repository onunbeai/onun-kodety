import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, FileText, RefreshCw } from '../../../components/ui/gravity-icons';
import type { FileSystemApi } from '../api';
import type { ActivityEntry } from '../types';
import { formatDate } from '../utils';
import { Button, Modal, Pill, Spinner } from './ui';

function actionLabel(action: string) {
  return action.replace(/[-_]/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
}

function tone(action: string): 'neutral' | 'accent' | 'success' | 'danger' | 'warning' {
  if (/delete|trash|purge/i.test(action)) return 'danger';
  if (/create|upload|restore|complete/i.test(action)) return 'success';
  if (/visibility|private|public|share/i.test(action)) return 'warning';
  if (/write|edit|rename|move|copy/i.test(action)) return 'accent';
  return 'neutral';
}

export function ActivityModal({ api, open, onClose }: { api: FileSystemApi; open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await api.activity());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a atividade.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  // Reload every time the modal opens; activity is intentionally live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      title="Activity"
      description="Operações recentes registradas pelo File System."
      width="min(720px, calc(100vw - 32px))"
      onClose={onClose}
      footer={<><span className="kfs-activity__count">{entries.length} eventos</span><Button variant="quiet" onClick={() => void load()} disabled={loading}><RefreshCw size={13} />Atualizar</Button><Button onClick={onClose}>Fechar</Button></>}
    >
      <div className="kfs-activity">
        {loading && !entries.length ? <div className="kfs-modal-loading"><Spinner label="Carregando atividade" /><span>Carregando atividade…</span></div> : error ? <div className="kfs-inline-error" role="alert"><AlertTriangle size={13} /><span>{error}</span></div> : entries.length === 0 ? (
          <div className="kfs-activity__empty"><Activity size={22} /><strong>Nenhuma atividade ainda</strong><span>Operações com arquivos aparecerão aqui.</span></div>
        ) : (
          <ol className="kfs-activity__list">
            {entries.map(entry => (
              <li key={entry.id}>
                <span className="kfs-activity__icon"><FileText size={14} /></span>
                <div className="kfs-activity__copy">
                  <div><Pill tone={tone(entry.action)}>{actionLabel(entry.action)}</Pill><strong>{entry.assetName || entry.path?.split('/').pop() || entry.message || 'File System'}</strong></div>
                  <span>{entry.message || [entry.mount, entry.path].filter(Boolean).join(' / ') || entry.provider || 'Storage operation'}</span>
                </div>
                <div className="kfs-activity__meta"><strong>{entry.actor ? `User ${entry.actor}` : 'System'}</strong><time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time></div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
