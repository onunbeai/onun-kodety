import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  Archive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
  Play,
  Type,
  VolumeX,
  X,
} from '../../../components/ui/gravity-icons';
import type { FileObject } from '../types';

export function KodetyMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 114 122" fill="none" aria-hidden="true">
      <path d="M51.1932 122 0 61l113.183 33.8289V122H51.1932Z" fill="currentColor" />
      <path d="M51.1932 0 0 61l113.183-33.8289V0H51.1932Z" fill="currentColor" />
    </svg>
  );
}

export function Button({
  variant = 'default',
  size = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'quiet' | 'primary' | 'danger';
  size?: 'default' | 'compact';
}) {
  return <button className={`kfs-button kfs-button--${variant} kfs-button--${size} ${className}`} {...props} />;
}

export function IconButton({
  label,
  active,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      className={`kfs-icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`kfs-input ${className}`} {...props} />;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }) {
  return <span className={`kfs-pill kfs-pill--${tone}`}>{children}</span>;
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  width = '480px',
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]');
    window.requestAnimationFrame(() => {
      if (dialog?.contains(document.activeElement)) return;
      (focusable || dialog)?.focus();
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab' && dialog) {
        const focusableItems = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]'));
        if (!focusableItems.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusableItems[0];
        const last = focusableItems[focusableItems.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape, true);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="kfs-modal-layer" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="kfs-modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="kfs-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Fechar" onClick={onClose}><X size={15} /></IconButton>
        </header>
        {children && <div className="kfs-modal__body">{children}</div>}
        {footer && <footer className="kfs-modal__footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <span className="kfs-spinner" role="status" aria-label={label}>
      <Loader2 size={15} />
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="kfs-empty">
      <div className="kfs-empty__icon">{icon || <Folder size={22} />}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function FileGlyph({ file, size = 18 }: { file: FileObject; size?: number }) {
  if (file.kind === 'folder') return <Folder size={size} className="kfs-glyph kfs-glyph--folder" />;
  const mime = file.mimeType || '';
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/')) return <ImageIcon size={size} className="kfs-glyph kfs-glyph--image" />;
  if (mime.startsWith('video/')) return <Play size={size} className="kfs-glyph kfs-glyph--video" />;
  if (mime.startsWith('audio/')) return <VolumeX size={size} className="kfs-glyph kfs-glyph--audio" />;
  if (mime.startsWith('font/') || ['woff', 'woff2', 'ttf', 'otf'].includes(extension)) {
    return <Type size={size} className="kfs-glyph kfs-glyph--font" />;
  }
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(extension)) return <Archive size={size} className="kfs-glyph kfs-glyph--archive" />;
  if (['csv', 'xls', 'xlsx'].includes(extension)) return <FileSpreadsheet size={size} className="kfs-glyph kfs-glyph--data" />;
  if (['html', 'css', 'js', 'ts', 'tsx', 'jsx', 'json', 'svg', 'xml', 'php', 'yml', 'yaml', 'env'].includes(extension)) {
    return <FileCode2 size={size} className="kfs-glyph kfs-glyph--code" />;
  }
  return <FileText size={size} className="kfs-glyph" />;
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="kfs-section-label">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function KeyValue({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`kfs-key-value ${className}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Surface({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`kfs-surface ${className}`} {...props} />;
}
