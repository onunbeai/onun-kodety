/**
 * Painel de camadas.
 *
 * Não reusa `HtmlNavigator` (2.185 linhas) porque aquele navega a árvore do
 * DOM de um projeto HTML, com componentes reutilizáveis, slots e CMS. A árvore
 * de um email tem dois níveis — blocos e colunas — e cabe num painel enxuto
 * com a mesma linguagem visual.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon, { type IconProps } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EMAIL_BLOCK_CATALOG, EMAIL_LEAF_TYPES, blockDisplayName, blockLabel } from '@/lib/email-editor/blocks';
import { cn } from '@/lib/utils';
import type { EmailBlock, EmailBlockType, EmailDocument, EmailLeafType } from '@/lib/email-editor/types';

const BLOCK_ICON: Record<EmailBlockType, IconProps['name']> = {
  heading: 'heading',
  text: 'text',
  image: 'image',
  button: 'cursor-default',
  columns: 'columns',
  divider: 'separator',
  spacer: 'space',
  html: 'code-block',
};

interface EmailLayersProps {
  document: EmailDocument;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddBlock: (type: EmailBlockType) => void;
  onAddToColumn: (columnsId: string, columnIndex: number, type: EmailLeafType) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export default function EmailLayers({
  document,
  selectedId,
  onSelect,
  onAddBlock,
  onAddToColumn,
  onMove,
  onDuplicate,
  onRemove,
  onRename,
}: EmailLayersProps) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border/70 px-3">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Icon name="layers" className="size-3.5 text-muted-foreground" />
          Camadas
        </span>
        <AddMenu
          label="Adicionar bloco"
          types={EMAIL_BLOCK_CATALOG.map((entry) => entry.type)}
          onPick={(type) => onAddBlock(type)}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {document.blocks.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nenhum bloco ainda. Use o + para começar.
          </p>
        )}

        {document.blocks.map((block, index) => (
          <div key={block.id}>
            <LayerRow
              block={block}
              depth={0}
              selected={selectedId === block.id}
              canMoveUp={index > 0}
              canMoveDown={index < document.blocks.length - 1}
              expandable={block.type === 'columns'}
              collapsed={Boolean(collapsed[block.id])}
              onToggle={() =>
                setCollapsed((current) => ({ ...current, [block.id]: !current[block.id] }))
              }
              onSelect={onSelect}
              onMove={onMove}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              onRename={onRename}
            />

            {block.type === 'columns' && !collapsed[block.id] && (
              <div>
                {block.columns.map((column, columnIndex) => (
                  <div key={`${block.id}-${columnIndex}`}>
                    <div
                      className="flex min-h-7 items-center justify-between gap-1 rounded-md pr-1 text-[11px] text-muted-foreground"
                      style={{ paddingLeft: 24 }}
                    >
                      <span className="truncate">Coluna {columnIndex + 1}</span>
                      <AddMenu
                        label={`Adicionar na coluna ${columnIndex + 1}`}
                        types={EMAIL_LEAF_TYPES}
                        onPick={(type) => onAddToColumn(block.id, columnIndex, type as EmailLeafType)}
                      />
                    </div>

                    {column.map((leaf, leafIndex) => (
                      <LayerRow
                        key={leaf.id}
                        block={leaf}
                        depth={2}
                        selected={selectedId === leaf.id}
                        canMoveUp={leafIndex > 0}
                        canMoveDown={leafIndex < column.length - 1}
                        expandable={false}
                        collapsed={false}
                        onToggle={() => undefined}
                        onSelect={onSelect}
                        onMove={onMove}
                        onDuplicate={onDuplicate}
                        onRemove={onRemove}
                        onRename={onRename}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddMenu({
  label,
  types,
  onPick,
}: {
  label: string;
  types: EmailBlockType[];
  onPick: (type: EmailBlockType) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={label}>
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        {types.map((type) => (
          <DropdownMenuItem key={type} onSelect={() => onPick(type)}>
            <Icon name={BLOCK_ICON[type]} className="size-3.5" />
            {blockLabel(type)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface LayerRowProps {
  block: EmailBlock;
  depth: number;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  expandable: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function LayerRow({
  block,
  depth,
  selected,
  canMoveUp,
  canMoveDown,
  expandable,
  collapsed,
  onToggle,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
  onRename,
}: LayerRowProps) {
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const startRename = () => {
    setDraft(block.name || blockDisplayName(block));
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    onRename(block.id, draft.trim());
  };

  return (
    <div
      className={cn(
        'group/layer flex min-h-8 items-center gap-1 rounded-md pr-1 text-xs',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
      )}
      style={{ paddingLeft: 4 + depth * 10 }}
    >
      {expandable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={collapsed ? 'Expandir' : 'Recolher'}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
        </Button>
      ) : (
        <span className="w-6 shrink-0" />
      )}

      <Icon name={BLOCK_ICON[block.type]} className="size-3.5 shrink-0 text-muted-foreground" />

      {renaming ? (
        <Input
          autoFocus
          className="h-6 min-w-0 flex-1 px-1 text-xs"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate py-1 text-left"
          onClick={() => onSelect(block.id)}
          onDoubleClick={startRename}
          title={blockDisplayName(block)}
        >
          {blockDisplayName(block)}
        </button>
      )}

      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/layer:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={!canMoveUp}
          aria-label="Mover para cima"
          onClick={() => onMove(block.id, -1)}
        >
          <Icon name="chevronUp" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={!canMoveDown}
          aria-label="Mover para baixo"
          onClick={() => onMove(block.id, 1)}
        >
          <Icon name="chevronDown" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Mais ações">
              <Icon name="dotsHorizontal" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={startRename}>
              <Icon name="pencil" className="size-3.5" />
              Renomear
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(block.id)}>
              <Icon name="copy" className="size-3.5" />
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onRemove(block.id)}>
              <Icon name="trash" className="size-3.5" />
              Remover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
