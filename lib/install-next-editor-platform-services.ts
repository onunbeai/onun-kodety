import {
  installFontLibraryTransport,
  type FontLibraryTransport,
} from './editor-platform-services';
import { createNextFontLibraryTransport } from './next-font-library-transport';

const nextFontLibraryTransport = createNextFontLibraryTransport({
  fetch: (input, init) => globalThis.fetch(input, init),
});

/** Install the web/Next platform leaves before importing a shared consumer. */
export function installNextEditorPlatformServices(): FontLibraryTransport {
  return installFontLibraryTransport(nextFontLibraryTransport);
}

/**
 * Dynamic-import boundary for an editor consumer whose module reads the
 * fail-closed platform registry during evaluation.
 */
export function loadNextEditorConsumer<T>(
  loadConsumer: () => Promise<T>,
): Promise<T> {
  installNextEditorPlatformServices();
  return loadConsumer();
}
