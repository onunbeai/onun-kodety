'use client';

import { useId, useRef, useState } from 'react';
import { Check, ImageIcon, Loader2, Plus, X } from '@/components/ui/gravity-icons';
import { FIGMA_DESIGN_LINK_ERROR, parseFigmaDesignLink } from '@/lib/html-editor/agent-composer';
import styles from './HtmlAgentComposer.module.css';

function FigmaLogo() {
  return (
    <svg width="10" height="14" viewBox="-1 -1 20 29" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 0H9V9H4.5a4.5 4.5 0 1 1 0-9Z" />
      <path d="M9 0h4.5a4.5 4.5 0 0 1 0 9H9V0Z" />
      <path d="M4.5 9H9v9H4.5a4.5 4.5 0 1 1 0-9Z" />
      <circle cx="13.5" cy="13.5" r="4.5" />
      <path d="M4.5 18H9v4.5A4.5 4.5 0 1 1 4.5 18Z" />
    </svg>
  );
}

interface ReferenceImage {
  id: string;
  name: string;
  previewUrl?: string;
  size?: number;
  mime?: string;
}

function referenceImageDetails(image: ReferenceImage) {
  const format = (image.mime?.split('/')[1] || image.name.split('.').at(-1) || 'Imagem').toUpperCase().replace('JPEG', 'JPG');
  const size = image.size
    ? image.size >= 1024 * 1024
      ? `${(image.size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
      : `${Math.max(1, Math.round(image.size / 1024))} KB`
    : '';
  return [format, size].filter(Boolean).join(' · ');
}

interface HtmlAgentFigmaReferenceProps {
  link: string;
  onLinkChange: (value: string) => void;
  images: ReferenceImage[];
  onAddImages: () => void;
  onDropImages: (files: File[]) => void;
  onRemoveImage: (image: ReferenceImage) => void;
  disabled: boolean;
  uploading: boolean;
  canAddImages: boolean;
}

export function HtmlAgentFigmaReference({
  link, onLinkChange, images, onAddImages, onDropImages, onRemoveImage,
  disabled, uploading, canAddImages,
}: HtmlAgentFigmaReferenceProps) {
  const id = useId();
  const [linkTouched, setLinkTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const parsedLink = parseFigmaDesignLink(link);
  const invalidLink = linkTouched && Boolean(link.trim()) && !parsedLink;
  const uploadDisabled = disabled || uploading || !canAddImages;

  return (
    <section className={styles.figmaReference} aria-label="Referência do Figma">
      <div>
        <div className={styles.referenceLabel}>
          <span>Print do elemento</span>
          {images.length > 0 && canAddImages ? (
            <button
              type="button"
              className={styles.referenceImageAdd}
              aria-label="Adicionar outro print"
              onClick={onAddImages}
              disabled={uploadDisabled}
            >
              {uploading ? <Loader2 size={11} className={styles.spinner} /> : <Plus size={11} />}
              {uploading ? 'Anexando…' : 'Adicionar'}
            </button>
          ) : <span className={styles.referenceMeta}>{images.length ? `${images.length} prints` : 'Até 10 MB'}</span>}
        </div>
        <div
          className={styles.referenceVisual}
          data-dragging={dragging || undefined}
          data-filled={images.length > 0 || undefined}
          aria-busy={uploading}
          onDragEnter={event => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            if (uploadDisabled) return;
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = uploadDisabled ? 'none' : 'copy';
          }}
          onDragLeave={event => {
            event.stopPropagation();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (!dragDepth.current) setDragging(false);
          }}
          onDrop={event => {
            event.preventDefault();
            event.stopPropagation();
            dragDepth.current = 0;
            setDragging(false);
            if (!uploadDisabled) onDropImages(Array.from(event.dataTransfer.files));
          }}
        >
          {images.length ? (
            <div className={styles.referenceImages}>
              {images.map(image => (
                <div key={image.id} className={styles.referenceImage}>
                  <span className={styles.referenceThumbnail}>
                    {image.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image.previewUrl} alt={`Print de referência: ${image.name}`} />
                    ) : <ImageIcon size={18} />}
                  </span>
                  <span className={styles.referenceImageInfo}>
                    <span className={styles.referenceImageName} title={image.name}>{image.name}</span>
                    <span className={styles.referenceMeta}>{referenceImageDetails(image)}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.referenceImageRemove}
                    aria-label={`Remover print ${image.name}`}
                    title="Remover print"
                    onClick={() => onRemoveImage(image)}
                    disabled={disabled || uploading}
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className={styles.referenceUpload}
              aria-label="Adicionar print do elemento"
              title="Arraste, cole ou escolha uma imagem PNG, JPG, WebP ou GIF de até 10 MB"
              onClick={onAddImages}
              disabled={uploadDisabled}
            >
              <span className={styles.referenceUploadIcon}>
                {uploading ? <Loader2 size={16} className={styles.spinner} /> : <ImageIcon size={16} />}
              </span>
              <span className={styles.referenceUploadCopy}>
                <span>{uploading ? 'Preparando anexo…' : dragging ? 'Solte o print aqui' : 'Adicionar print'}</span>
                <span className={styles.referenceUploadHint}>Arraste aqui ou cole uma imagem</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <div>
        <div className={styles.referenceLabel}>
          <label htmlFor={`${id}-link`}>Link do Figma</label>
          {parsedLink && <span className={styles.referenceLinked} role="status"><Check size={10} /> {parsedLink.nodeId ? 'Elemento vinculado' : 'Arquivo vinculado'}</span>}
        </div>
        <div className={styles.referenceLinkField} data-invalid={invalidLink || undefined}>
          <FigmaLogo />
          <input
            id={`${id}-link`}
            type="text"
            inputMode="url"
            value={link}
            onChange={event => onLinkChange(event.target.value)}
            onBlur={() => setLinkTouched(true)}
            placeholder="Cole o link do frame ou elemento…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={invalidLink || undefined}
            aria-describedby={`${id}-link-hint`}
          />
          {link && (
            <button type="button" className={styles.chipRemove} aria-label="Limpar link do Figma" disabled={disabled} onClick={() => onLinkChange('')}>
              <X size={11} />
            </button>
          )}
        </div>
        <p id={`${id}-link-hint`} className={styles.referenceHint} data-error={invalidLink || undefined} aria-live="polite">
          {invalidLink ? FIGMA_DESIGN_LINK_ERROR : 'No Figma, selecione o elemento e copie o link.'}
        </p>
      </div>
    </section>
  );
}
