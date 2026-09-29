/**
 * Canvas do construtor de email.
 *
 * Cada bloco é injetado com exatamente o HTML da exportação (`renderBlock`),
 * então o que se vê aqui é o que sai na caixa de entrada — não existe uma
 * segunda implementação visual para divergir da primeira.
 *
 * A única aproximação é o layout das colunas: no canvas elas usam flex para
 * ficarem clicáveis individualmente, enquanto a exportação usa inline-block
 * com tabela fantasma para o Outlook. A caixa do bloco (padding, fundo, borda)
 * é espelhada a partir das mesmas funções da exportação, para o que se edita
 * bater com o que se envia.
 */

import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon, { type IconProps } from '@/components/ui/icon';
import { EMAIL_LEAF_TYPES, blockLabel } from '@/lib/email-editor/blocks';
import {
  blockCellStyle,
  blockMarginCss,
  blockTableStyle,
  renderBlock,
  toReactStyle,
} from '@/lib/email-editor/render';
import { sanitizeEmailHtmlForCanvas } from '@/lib/email-editor/sanitize';
import {
  carriesEmailPayload,
  positionWithin,
  readPayload,
  type DropTarget,
} from '@/lib/email-editor/dnd';
import type {
  EmailBlock,
  EmailColumnsBlock,
  EmailDocument,
  EmailLeafBlock,
  EmailLeafType,
} from '@/lib/email-editor/types';

interface EmailCanvasProps {
  document: EmailDocument;
  selectedId: string | null;
  viewport: 'desktop' | 'mobile';
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAddToColumn: (columnsId: string, columnIndex: number, type: EmailLeafType) => void;
  /** Índice medido na lista original de blocos de topo. */
  onDropSection: (presetId: string, index: number) => void;
  onReorder: (blockId: string, index: number) => void;
}

/** Lados vazios viram `0`, espelhando `sidesToCss` da exportação. */
function contentPadding(value: EmailDocument['settings']['contentPadding']): string | undefined {
  const parts = [value.top, value.right, value.bottom, value.left];
  if (parts.every((part) => !part.trim())) return undefined;
  return parts.map((part) => (part.trim() ? part.trim() : '0')).join(' ');
}

export default function EmailCanvas({
  document,
  selectedId,
  viewport,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  onAddToColumn,
  onDropSection,
  onReorder,
}: EmailCanvasProps) {
  const { settings } = document;
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const indexFor = (target: DropTarget): number => {
    const position = document.blocks.findIndex((block) => block.id === target.blockId);
    if (position < 0) return document.blocks.length;
    return target.position === 'before' ? position : position + 1;
  };

  const handleDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDropTarget(null);
    setDraggingId(null);

    const payload = readPayload(event.dataTransfer);
    if (!payload) return;

    if (payload.kind === 'section') onDropSection(payload.value, index);
    else onReorder(payload.value, index);
  };

  return (
    <div className="kem-canvas" style={{ background: settings.backgroundColor }}>
      <div
        className={`kem-canvas__frame kem-canvas__frame--${viewport}`}
        style={{
          width: viewport === 'mobile' ? 375 : settings.width,
          background: settings.contentBackground,
          // O padding do documento é aplicado na célula do container na
          // exportação; sem espelhá-lo aqui, editar às cegas era a única opção.
          padding: contentPadding(settings.contentPadding),
        }}
      >
        {document.blocks.length === 0 && (
          <div
            className="kem-canvas__empty"
            onDragOver={(event) => {
              if (carriesEmailPayload(event.dataTransfer)) event.preventDefault();
            }}
            onDrop={(event) => handleDrop(event, 0)}
          >
            Arraste uma seção da coluna da esquerda, ou clique nela para inserir.
          </div>
        )}

        {document.blocks.map((block, index) => (
          <BlockShell
            key={block.id}
            block={block}
            selected={selectedId === block.id}
            canMoveUp={index > 0}
            canMoveDown={index < document.blocks.length - 1}
            dragging={draggingId === block.id}
            dropPosition={dropTarget?.blockId === block.id ? dropTarget.position : null}
            onSelect={onSelect}
            onMove={onMove}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            onDragStart={(event) => {
              setDraggingId(block.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-kodety-block', block.id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              if (!carriesEmailPayload(event.dataTransfer)) return;
              event.preventDefault();
              const position = positionWithin(event.currentTarget.getBoundingClientRect(), event.clientY);
              setDropTarget((current) =>
                current?.blockId === block.id && current.position === position
                  ? current
                  : { blockId: block.id, position },
              );
            }}
            onDragLeave={(event) => {
              // `dragleave` dispara ao passar sobre filhos; só limpa quando o
              // ponteiro realmente saiu do bloco.
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropTarget((current) => (current?.blockId === block.id ? null : current));
            }}
            onDrop={(event) => {
              const target = dropTarget ?? { blockId: block.id, position: 'after' as const };
              handleDrop(event, indexFor(target));
            }}
          >
            {block.type === 'columns' ? (
              <ColumnsShell block={block}>
                {block.columns.map((column, columnIndex) => (
                  <div
                    className="kem-columns__cell"
                    key={`${block.id}-${columnIndex}`}
                    style={{
                      flexBasis: 0,
                      flexGrow: columnWeight(block, columnIndex),
                    }}
                  >
                    {column.map((leaf) => (
                      <LeafShell
                        key={leaf.id}
                        leaf={leaf}
                        settings={document.settings}
                        selected={selectedId === leaf.id}
                        onSelect={onSelect}
                        onRemove={onRemove}
                      />
                    ))}
                    <ColumnAddMenu
                      columnIndex={columnIndex}
                      onAdd={(type) => onAddToColumn(block.id, columnIndex, type)}
                    />
                  </div>
                ))}
              </ColumnsShell>
            ) : (
              <RenderedBlock block={block} settings={document.settings} />
            )}
          </BlockShell>
        ))}
      </div>
    </div>
  );
}

/**
 * Espelha a caixa do bloco de colunas.
 *
 * As colunas são montadas em React para cada filho ficar clicável, então elas
 * não passam por `renderBlock` — sem este espelho, padding, fundo e borda de
 * uma seção de colunas só apareceriam na pré-visualização.
 */
function ColumnsShell({ block, children }: { block: EmailBlock; children: React.ReactNode }) {
  const alignItems =
    block.type !== 'columns' || block.verticalAlign === 'top'
      ? 'flex-start'
      : block.verticalAlign === 'middle'
        ? 'center'
        : 'flex-end';

  return (
    <div style={{ padding: blockMarginCss(block) }}>
      <div style={toReactStyle({ ...blockTableStyle(block), display: 'block' })}>
        <div style={toReactStyle(blockCellStyle(block))}>
          <div
            className="kem-columns"
            style={{
              alignItems,
              gap: block.type === 'columns' ? block.gap : undefined,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function RenderedBlock({
  block,
  settings,
}: {
  block: EmailBlock;
  settings: EmailDocument['settings'];
}) {
  // Texto rico e HTML bruto fazem parte do documento e podem ter vindo de um
  // template importado. A exportação continua intacta, mas a superfície do
  // WordPress recebe uma versão sem scripts, eventos ou elementos ativos.
  const safeHtml = React.useMemo(
    () => sanitizeEmailHtmlForCanvas(renderBlock(block, settings)),
    [block, settings],
  );

  // Imagem sem arquivo não gera markup na exportação — nunca se envia um <img>
  // quebrado. No editor isso deixaria um bloco invisível e impossível de
  // clicar, então aqui ela aparece como marcador.
  if (block.type === 'image' && !block.src) {
    const requestedWidth = block.width.trim() || '100%';
    const numericWidth = Number.parseFloat(requestedWidth);
    const compact = Number.isFinite(numericWidth) && numericWidth <= 72;

    return (
      <div style={toReactStyle(blockCellStyle(block))}>
        <div
          className={`kem-image-placeholder${compact ? ' is-compact' : ''}`}
          style={{
            width: '100%',
            maxWidth: requestedWidth,
            marginLeft: block.align === 'left' ? 0 : 'auto',
            marginRight: block.align === 'right' ? 0 : 'auto',
          }}
          title={compact ? block.alt || 'Imagem' : undefined}
        >
          {compact ? (
            <Icon name="image" className="size-4" aria-label={block.alt || 'Imagem'} />
          ) : (
            <>
              <span>{block.alt || 'Imagem'}</span>
              <small>Escolha um arquivo no painel à direita</small>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClickCapture={(event) => {
        if ((event.target as Element | null)?.closest('a')) event.preventDefault();
      }}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

const COLUMN_BLOCK_ICON: Record<EmailLeafType, IconProps['name']> = {
  heading: 'heading',
  text: 'text',
  image: 'image',
  button: 'cursor-default',
  divider: 'separator',
  spacer: 'space',
  html: 'code-block',
};

function ColumnAddMenu({
  columnIndex,
  onAdd,
}: {
  columnIndex: number;
  onAdd: (type: EmailLeafType) => void;
}) {
  return (
    <div className="kem-columns__add" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="kem-columns__add-trigger"
            aria-label={`Adicionar bloco à coluna ${columnIndex + 1}`}
            title="Adicionar bloco"
          >
            <Icon name="plus" className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          sideOffset={5}
          className="min-w-40"
          onClick={(event) => event.stopPropagation()}
        >
          {EMAIL_LEAF_TYPES.map((type) => (
            <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
              <Icon name={COLUMN_BLOCK_ICON[type]} />
              {blockLabel(type)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function columnWeight(block: EmailColumnsBlock, columnIndex: number): number {
  if (block.widths.length !== block.columns.length) return 1;
  const weight = block.widths[columnIndex];
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

interface BlockShellProps {
  block: EmailBlock;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  dropPosition: 'before' | 'after' | null;
  children: React.ReactNode;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}

function BlockShell({
  block,
  selected,
  canMoveUp,
  canMoveDown,
  dragging,
  dropPosition,
  children,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: BlockShellProps) {
  return (
    <div
      className={[
        'kem-block',
        selected ? 'is-selected' : '',
        dragging ? 'is-dragging' : '',
        dropPosition ? `is-drop-${dropPosition}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(block.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(block.id);
        }
      }}
    >
      {selected && (
        <div className="kem-block__toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(block.id, -1)} aria-label="Mover para cima">↑</button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(block.id, 1)} aria-label="Mover para baixo">↓</button>
          <button type="button" onClick={() => onDuplicate(block.id)} aria-label="Duplicar">⧉</button>
          <button type="button" className="is-danger" onClick={() => onRemove(block.id)} aria-label="Remover">×</button>
        </div>
      )}
      {children}
    </div>
  );
}

function LeafShell({
  leaf,
  settings,
  selected,
  onSelect,
  onRemove,
}: {
  leaf: EmailLeafBlock;
  settings: EmailDocument['settings'];
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className={`kem-block kem-block--leaf${selected ? ' is-selected' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(leaf.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(leaf.id);
        }
      }}
    >
      {selected && (
        <div className="kem-block__toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="is-danger" onClick={() => onRemove(leaf.id)} aria-label="Remover">×</button>
        </div>
      )}
      <RenderedBlock block={leaf} settings={settings} />
    </div>
  );
}
