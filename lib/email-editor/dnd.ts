/**
 * Transferência de arraste do construtor.
 *
 * Usa o drag nativo do HTML5 em vez de uma biblioteca: a árvore é uma lista
 * vertical de blocos, e `@dnd-kit` custaria 45 KB no bundle para resolver um
 * problema que `dataTransfer` já resolve.
 */

export const SECTION_MIME = 'application/x-kodety-section';
export const BLOCK_MIME = 'application/x-kodety-block';

export type DropPosition = 'before' | 'after';

export interface DropTarget {
  blockId: string;
  position: DropPosition;
}

/**
 * `dataTransfer.getData` só devolve valor no `drop`; durante o `dragover` o
 * navegador expõe apenas os tipos. Por isso a decisão de aceitar (ou não) o
 * arraste é feita pela lista de tipos.
 */
export function carriesEmailPayload(transfer: DataTransfer): boolean {
  return transfer.types.includes(SECTION_MIME) || transfer.types.includes(BLOCK_MIME);
}

export function readPayload(transfer: DataTransfer): { kind: 'section' | 'block'; value: string } | null {
  const section = transfer.getData(SECTION_MIME);
  if (section) return { kind: 'section', value: section };

  const block = transfer.getData(BLOCK_MIME);
  if (block) return { kind: 'block', value: block };

  return null;
}

/** Metade superior insere antes; inferior, depois. */
export function positionWithin(rect: DOMRect, clientY: number): DropPosition {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}
