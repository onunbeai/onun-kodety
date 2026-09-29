/** Versioned publication policy; no transforms are applied to the editable project. */
export const PUBLICATION_OPTIMIZATION_VERSION = 2 as const;
export const PUBLICATION_OPTIMIZATION_KEYS = [
  'compressHtml', 'compressAssets', 'optimizeImages', 'imageDimensions',
  'preloadFonts', 'preloadModules', 'preconnect',
] as const;
export type PublicationOptimizationKey = typeof PUBLICATION_OPTIMIZATION_KEYS[number];
export type PublishOptimizations = Record<PublicationOptimizationKey, boolean> & {
  version: typeof PUBLICATION_OPTIMIZATION_VERSION;
  enabled: boolean;
  exclusions: string[];
  /** Request-only concurrency guard; never persisted as a preference. */
  expectedRevision?: string;
};

// Product defaults. Saved v2 preferences still take precedence after loading.
export const DEFAULT_PUBLISH_OPTIMIZATIONS: PublishOptimizations = {
  version: PUBLICATION_OPTIMIZATION_VERSION, enabled: true,
  compressHtml: true, compressAssets: true, optimizeImages: true,
  imageDimensions: true, preloadFonts: true, preloadModules: true, preconnect: true,
  exclusions: [],
};

export function parsePublishOptimizations(value: unknown): PublishOptimizations | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.version !== PUBLICATION_OPTIMIZATION_VERSION || typeof input.enabled !== 'boolean') return null;
  if (PUBLICATION_OPTIMIZATION_KEYS.some((key) => typeof input[key] !== 'boolean')) return null;
  if (!Array.isArray(input.exclusions) || input.exclusions.length > 100
    || input.exclusions.some((path) => typeof path !== 'string' || path.length > 240)) return null;
  return {
    version: PUBLICATION_OPTIMIZATION_VERSION, enabled: input.enabled,
    ...Object.fromEntries(PUBLICATION_OPTIMIZATION_KEYS.map((key) => [key, input[key]])) as Record<PublicationOptimizationKey, boolean>,
    exclusions: [...input.exclusions] as string[],
  };
}

export const PUBLICATION_OPTIMIZATION_OPTIONS: Array<{
  key: PublicationOptimizationKey; title: string; description: string;
}> = [
  { key: 'compressHtml', title: 'Comprimir HTML', description: 'Reduz a transferência e preserva o código.' },
  { key: 'compressAssets', title: 'Comprimir CSS e JavaScript', description: 'Usa a compressão disponível na hospedagem.' },
  { key: 'optimizeImages', title: 'Otimizar imagens locais', description: 'WebP de alta qualidade quando fica menor.' },
  { key: 'imageDimensions', title: 'Estabilizar imagens', description: 'Reserva dimensões conhecidas sem adiar a imagem principal.' },
  { key: 'preloadFonts', title: 'Antecipar fontes essenciais', description: 'Prioriza a fonte usada no texto principal.' },
  { key: 'preloadModules', title: 'Antecipar módulos JavaScript', description: 'Mantém a ordem e o momento de execução.' },
  { key: 'preconnect', title: 'Preparar conexões externas', description: 'Somente origens já usadas pela página.' },
];
