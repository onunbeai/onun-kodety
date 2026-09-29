import type { CodayFile, CodayImage } from '@coday/control-schema';

export type CodayAsset = ({ kind: 'image' } & CodayImage) | ({ kind: 'file' } & CodayFile);
export interface ImageSelectOptions { mimeTypes?: string[]; maxBytes?: number; responsive?: boolean; currentId?: string }
export interface FileSelectOptions { extensions?: string[]; mimeTypes?: string[]; maxBytes?: number; currentId?: string }
export interface AssetProvider {
  selectImage(options?: ImageSelectOptions): Promise<CodayImage | null>;
  uploadImage(file: File, options?: ImageSelectOptions): Promise<CodayImage>;
  selectFile(options?: FileSelectOptions): Promise<CodayFile | null>;
  uploadFile(file: File, options?: FileSelectOptions): Promise<CodayFile>;
  resolveAsset(id: string): Promise<CodayAsset | null>;
  updateImageMetadata?(id: string, patch: Pick<CodayImage, 'alt' | 'focalPoint'>): Promise<CodayImage>;
}
export interface PublicAssetResolver { resolvePublicAsset(id: string, options?: { width?: number; quality?: number; format?: string }): Promise<CodayAsset | null> }

export function assertFileAllowed(file: File, options: FileSelectOptions | ImageSelectOptions = {}) {
  if (options.maxBytes !== undefined && file.size > options.maxBytes) throw new Error(`O arquivo ultrapassa ${options.maxBytes} bytes.`);
  if (options.mimeTypes?.length && !options.mimeTypes.some(type => type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type)) throw new Error(`Tipo ${file.type || 'desconhecido'} não permitido.`);
  if ('extensions' in options && options.extensions?.length) {
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!options.extensions.map(item => item.startsWith('.') ? item.toLowerCase() : `.${item.toLowerCase()}`).includes(extension)) throw new Error(`Extensão ${extension} não permitida.`);
  }
}

export class MemoryAssetProvider implements AssetProvider, PublicAssetResolver {
  private assets = new Map<string, CodayAsset>();
  constructor(initial: CodayAsset[] = [], private readonly picker?: (kind: 'image' | 'file') => Promise<CodayAsset | null>) { initial.forEach(asset => this.assets.set(asset.id, asset)) }
  async selectImage() { const asset = await this.picker?.('image'); return asset?.kind === 'image' ? asset : null }
  async selectFile() { const asset = await this.picker?.('file'); return asset?.kind === 'file' ? asset : null }
  async uploadImage(file: File, options?: ImageSelectOptions) {
    assertFileAllowed(file, options); if (!file.type.startsWith('image/')) throw new Error('Esperada uma imagem.');
    const id = crypto.randomUUID(); const image: CodayAsset = { kind: 'image', id, src: URL.createObjectURL(file), alt: file.name };
    this.assets.set(id, image); return image;
  }
  async uploadFile(file: File, options?: FileSelectOptions) {
    assertFileAllowed(file, options); const id = crypto.randomUUID(); const asset: CodayAsset = { kind: 'file', id, url: URL.createObjectURL(file), name: file.name, mimeType: file.type, size: file.size };
    this.assets.set(id, asset); return asset;
  }
  async resolveAsset(id: string) { return this.assets.get(id) || null }
  async resolvePublicAsset(id: string) { return this.resolveAsset(id) }
  async updateImageMetadata(id: string, patch: Pick<CodayImage, 'alt' | 'focalPoint'>) {
    const current = this.assets.get(id); if (!current || current.kind !== 'image') throw new Error('Imagem não encontrada.');
    const next = { ...current, ...patch }; this.assets.set(id, next); return next;
  }
}
