import { installFontLibraryTransport, type FontLibraryFont } from '../../../lib/editor-platform-services';
import { createWordPressFontLibraryTransport } from '../../../Wordpress/editor/wordpress-font-library-transport';

let activeProject = '';
let uploadToProject: ((files: readonly File[]) => Promise<FontLibraryFont[]>) | null = null;
const base = createWordPressFontLibraryTransport({}, {
  fetch: (input, init) => fetch(input, init),
  storage: {
    getItem: () => activeProject ? localStorage.getItem(`kodetyStudioHtmlFontsV1:${activeProject}`) : null,
    setItem: (_key, value) => { if (activeProject) localStorage.setItem(`kodetyStudioHtmlFontsV1:${activeProject}`, value); },
  },
});
const transport = {
  ...base,
  kind: 'html' as const,
  capabilities: { ...base.capabilities, uploadCustomFonts: true },
  async uploadCustomFonts(files: readonly File[], installed: readonly FontLibraryFont[]) {
    if (!uploadToProject) throw new Error('Abra o projeto para importar fontes.');
    const uploadedFonts = await uploadToProject(files);
    const installedFonts = base.replaceInstalledFonts([...installed.filter(font => !uploadedFonts.some(upload => upload.id === font.id)), ...uploadedFonts]);
    return { installedFonts, uploadedFonts };
  },
};
let installed = false;
export function installHtmlFontLibrary() {
  if (!installed) { installFontLibraryTransport(transport); installed = true; }
}
export function configureHtmlFontLibrary(projectId: string, upload: typeof uploadToProject) {
  activeProject = projectId;
  uploadToProject = upload;
}

export async function refreshHtmlFontLibrary(projectId: string) {
  const fonts = base.readInstalledFontsSnapshot();
  const { useFontsStore } = await import('../../../stores/useFontsStore');
  if (activeProject === projectId) useFontsStore.getState().setFonts(fonts);
}
