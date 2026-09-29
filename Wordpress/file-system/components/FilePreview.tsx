import { useEffect, useState } from 'react';
import { Code2, Download, Eye, FileText } from '../../../components/ui/gravity-icons';
import type { FileSystemApi } from '../api';
import type { FileObject } from '../types';
import { canEdit, extensionOf, formatBytes } from '../utils';
import { Button, EmptyState, Spinner } from './ui';

export function FilePreview({
  file,
  api,
  expanded = false,
  onEdit,
  onDownload,
}: {
  file: FileObject | null;
  api: FileSystemApi;
  expanded?: boolean;
  onEdit?: (file: FileObject) => void;
  onDownload?: (file: FileObject) => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setContent('');
    setError('');
    if (!file || !canEdit(file) || file.size && file.size > 2_000_000) return () => { active = false; };
    setLoading(true);
    api.content(file)
      .then(value => active && setContent(value))
      .catch(reason => active && setError(reason instanceof Error ? reason.message : 'Preview indisponível.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, file?.id]);

  if (!file) {
    return <EmptyState icon={<Eye size={20} />} title="Nada selecionado" description="Selecione um arquivo para visualizar detalhes e conteúdo." />;
  }
  if (file.kind === 'folder') {
    return <EmptyState title={file.name} description="Abra a pasta para visualizar seu conteúdo." />;
  }

  const url = file.previewUrl || file.publicUrl || '';
  const mime = file.mimeType || '';
  const extension = extensionOf(file);
  let preview = null;

  if (mime.startsWith('image/') && url) {
    preview = <img className="kfs-preview__image" src={url} alt={file.name} draggable={false} />;
  } else if (mime.startsWith('video/') && url) {
    preview = <video className="kfs-preview__media" src={url} controls preload="metadata" />;
  } else if (mime.startsWith('audio/') && url) {
    preview = (
      <div className="kfs-preview__audio">
        <div className="kfs-preview__audio-disc" aria-hidden="true" />
        <strong>{file.name}</strong>
        <audio src={url} controls preload="metadata" />
      </div>
    );
  } else if (mime === 'application/pdf' && url) {
    preview = <iframe className="kfs-preview__pdf" src={url} title={`Preview de ${file.name}`} sandbox="" referrerPolicy="no-referrer" />;
  } else if (mime.startsWith('font/') || ['woff', 'woff2', 'ttf', 'otf'].includes(extension)) {
    preview = (
      <div className="kfs-preview__font">
        <span>Aa</span>
        <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
        <p>abcdefghijklmnopqrstuvwxyz</p>
        <p>0123456789</p>
      </div>
    );
  } else if (canEdit(file)) {
    preview = loading
      ? <div className="kfs-preview__loading"><Spinner label="Carregando conteúdo" /></div>
      : error
        ? <EmptyState icon={<FileText size={20} />} title="Preview indisponível" description={error} />
        : <pre className="kfs-preview__code"><code>{content || 'Arquivo vazio'}</code></pre>;
  } else {
    preview = <EmptyState icon={<FileText size={20} />} title={file.name} description={`${file.mimeType || 'Arquivo'} · ${formatBytes(file.size)}`} />;
  }

  return (
    <div className={`kfs-preview ${expanded ? 'is-expanded' : ''}`}>
      <div className="kfs-preview__stage">{preview}</div>
      {expanded && (
        <footer className="kfs-preview__footer">
          <div>
            <strong>{file.name}</strong>
            <span>{file.mimeType || extension.toUpperCase()} · {formatBytes(file.size)}</span>
          </div>
          <div className="kfs-preview__actions">
            {canEdit(file) && onEdit && <Button onClick={() => onEdit(file)}><Code2 size={14} /> Abrir editor</Button>}
            {onDownload && <Button onClick={() => onDownload(file)}><Download size={14} /> Baixar</Button>}
          </div>
        </footer>
      )}
    </div>
  );
}
