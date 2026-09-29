/**
 * Operações imutáveis sobre o documento.
 *
 * Ficam fora dos componentes porque a árvore tem dois níveis (blocos de topo e
 * blocos dentro de colunas) e a busca recursiva precisa ser testável sem
 * montar React.
 */

import { cloneBlock } from './blocks';
import type { EmailBlock, EmailDocument, EmailLeafBlock } from './types';

export function findBlock(document: EmailDocument, id: string): EmailBlock | null {
  for (const block of document.blocks) {
    if (block.id === id) return block;
    if (block.type === 'columns') {
      for (const column of block.columns) {
        const found = column.find((leaf) => leaf.id === id);
        if (found) return found;
      }
    }
  }
  return null;
}

export function updateBlock(
  document: EmailDocument,
  id: string,
  patch: Partial<EmailBlock>,
): EmailDocument {
  const apply = (block: EmailBlock): EmailBlock =>
    block.id === id ? ({ ...block, ...patch } as EmailBlock) : block;

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.id === id) return apply(block);
      if (block.type !== 'columns') return block;
      return {
        ...block,
        columns: block.columns.map((column) => column.map((leaf) => apply(leaf) as EmailLeafBlock)),
      };
    }),
  };
}

export function appendBlock(document: EmailDocument, block: EmailBlock): EmailDocument {
  return { ...document, blocks: [...document.blocks, block] };
}

/**
 * Insere logo abaixo do bloco de topo selecionado, ou no fim quando nada está
 * selecionado. Inserir sempre no fim faria a seção nova aparecer depois do
 * rodapé, que é quase nunca o que se quer.
 */
export function insertBlocks(
  document: EmailDocument,
  blocks: EmailBlock[],
  afterId: string | null,
): EmailDocument {
  if (!blocks.length) return document;

  const index = afterId ? document.blocks.findIndex((block) => block.id === afterId) : -1;
  if (index < 0) return { ...document, blocks: [...document.blocks, ...blocks] };

  const next = [...document.blocks];
  next.splice(index + 1, 0, ...blocks);
  return { ...document, blocks: next };
}

/** Insere numa posição exata da lista de topo (0 = antes de tudo). */
export function insertBlocksAt(
  document: EmailDocument,
  blocks: EmailBlock[],
  index: number,
): EmailDocument {
  if (!blocks.length) return document;

  const next = [...document.blocks];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, ...blocks);
  return { ...document, blocks: next };
}

/**
 * Move um bloco de topo para uma posição.
 *
 * O índice recebido é medido na lista original. Como remover o bloco encolhe
 * a lista, o alvo é corrigido quando o bloco vinha de antes da posição — sem
 * isso, arrastar para baixo sempre pararia uma casa antes do pretendido.
 */
export function moveBlockTo(document: EmailDocument, id: string, index: number): EmailDocument {
  const from = document.blocks.findIndex((block) => block.id === id);
  if (from < 0) return document;

  const target = index > from ? index - 1 : index;
  if (target === from) return document;

  const next = [...document.blocks];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
  return { ...document, blocks: next };
}

export function appendToColumn(
  document: EmailDocument,
  columnsId: string,
  columnIndex: number,
  leaf: EmailLeafBlock,
): EmailDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.id !== columnsId || block.type !== 'columns') return block;
      return {
        ...block,
        columns: block.columns.map((column, index) =>
          index === columnIndex ? [...column, leaf] : column,
        ),
      };
    }),
  };
}

export function removeBlock(document: EmailDocument, id: string): EmailDocument {
  return {
    ...document,
    blocks: document.blocks
      .filter((block) => block.id !== id)
      .map((block) => {
        if (block.type !== 'columns') return block;
        return {
          ...block,
          columns: block.columns.map((column) => column.filter((leaf) => leaf.id !== id)),
        };
      }),
  };
}

export function duplicateBlock(document: EmailDocument, id: string): EmailDocument {
  const index = document.blocks.findIndex((block) => block.id === id);
  if (index >= 0) {
    const copy = cloneBlock(document.blocks[index]);
    const blocks = [...document.blocks];
    blocks.splice(index + 1, 0, copy);
    return { ...document, blocks };
  }

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== 'columns') return block;
      return {
        ...block,
        columns: block.columns.map((column) => {
          const position = column.findIndex((leaf) => leaf.id === id);
          if (position < 0) return column;
          const next = [...column];
          next.splice(position + 1, 0, cloneBlock(column[position]) as EmailLeafBlock);
          return next;
        }),
      };
    }),
  };
}

/** Move só entre irmãos: subir um bloco para dentro de uma coluna seria uma
 *  operação de arrastar, não de seta. */
export function moveBlock(document: EmailDocument, id: string, direction: -1 | 1): EmailDocument {
  const index = document.blocks.findIndex((block) => block.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= document.blocks.length) return document;
    const blocks = [...document.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    return { ...document, blocks };
  }

  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== 'columns') return block;
      return {
        ...block,
        columns: block.columns.map((column) => {
          const position = column.findIndex((leaf) => leaf.id === id);
          if (position < 0) return column;
          const target = position + direction;
          if (target < 0 || target >= column.length) return column;
          const next = [...column];
          [next[position], next[target]] = [next[target], next[position]];
          return next;
        }),
      };
    }),
  };
}

export function setColumnCount(
  document: EmailDocument,
  columnsId: string,
  count: number,
): EmailDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.id !== columnsId || block.type !== 'columns') return block;

      const columns = [...block.columns];
      while (columns.length < count) columns.push([]);
      // Remover colunas preserva o conteúdo: ele volta para a primeira coluna
      // em vez de sumir sem aviso.
      while (columns.length > count) {
        const dropped = columns.pop() ?? [];
        columns[0] = [...columns[0], ...dropped];
      }
      return { ...block, columns };
    }),
  };
}
