import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeleteProjectDialog, ProjectWorkspace } from '../../../ChromeExtension/kodety-studio/src/main';
import { StudioI18nProvider } from '../../../ChromeExtension/kodety-studio/src/i18n';
import { loadStudioPreferences } from '../../../ChromeExtension/kodety-studio/src/storage';
import { destroyProjectData } from '../../../ChromeExtension/kodety-studio/src/playground-runtime';
import { browserProjectRepository, LibraryError, type StudioProject } from './project-library';
import { projectForDeletion } from './project-deletion';
import { finalizeR2WordPressRestore, restorePendingR2WordPress } from './r2-project-restore';
import { KodetyLoadingScreen } from '../../../components/ui/kodety-loading-screen';
import './studio-shell.css';
import './webapp.css';

const language = loadStudioPreferences('en').language;
const l = (pt: string, en: string) => language === 'pt' ? pt : en;
const repository = browserProjectRepository();
const opening = new URLSearchParams(window.location.search).get('action') === 'open';
const returnToLibrary = () => window.location.replace(new URL('./#local', window.location.href).href);

async function readProject(): Promise<StudioProject> {
  const id = new URLSearchParams(window.location.search).get('project');
  if (!id || !/^[a-z0-9-]{8,80}$/i.test(id)) throw new Error(l('Projeto inválido. Volte à biblioteca e tente novamente.', 'Invalid project. Return to the library and try again.'));
  const stored = repository.read().find(project => project.id === id);
  if (!stored) throw new Error(l('Este projeto não está mais na biblioteca.', 'This project is no longer in the library.'));
  const project = await projectForDeletion(stored);
  if (project.mode === 'html') throw new Error(l('Remova este projeto HTML pela biblioteca.', 'Remove this HTML project from the library.'));
  return project;
}

function storageError(reason: unknown): string {
  if (reason instanceof LibraryError) return l('Não foi possível atualizar a biblioteca. Verifique o armazenamento do navegador e tente novamente.', 'Could not update the library. Check browser storage and try again.');
  return reason instanceof Error ? reason.message : l('Não foi possível abrir este projeto.', 'Could not open this project.');
}

/** This top-level document has no COEP, so the persistent Playground origin
 * remains reachable. A URL only opens confirmation; it never deletes data. */
function ProjectStorage() {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void readProject().then(value => { if (!disposed) setProject(value); }, reason => { if (!disposed) setError(storageError(reason)); });
    return () => { disposed = true; };
  }, []);
  if (!project && !error) return <KodetyLoadingScreen className="h-dvh" label={l('Carregando projeto', 'Loading project')} />;
  return <StudioI18nProvider language={language}>
    {opening && project ? <div className="web-app web-project-storage">
    <ProjectWorkspace
      project={project}
      language={language}
      requireSecurityDirectory={project.storageMode !== 'browser'}
      manualBackup={project.storageMode === 'browser'}
      onBack={returnToLibrary}
      restoreFirstBoot={client => restorePendingR2WordPress(project.id, client)}
      onProjectReady={async ready => {
        const latest = await repository.patch(ready.id, {
          initialized: ready.initialized, phpVersion: ready.phpVersion,
          wordpressVersion: ready.wordpressVersion, kodetyVersion: ready.kodetyVersion,
          wordpressLocale: ready.wordpressLocale, runtimeRevision: ready.runtimeRevision,
          lastOpenedAt: ready.lastOpenedAt, updatedAt: ready.updatedAt,
          ...(ready.thumbnailDataUrl ? { thumbnailDataUrl: ready.thumbnailDataUrl, thumbnailUpdatedAt: ready.thumbnailUpdatedAt } : {}),
        });
        setProject(latest.find(item => item.id === ready.id)!);
        if (ready.initialized) await finalizeR2WordPressRestore(ready.id).catch(() => undefined);
      }}
    /></div> : <>
    <main className="web-fatal">
      <h1>{opening ? l('Abrir projeto', 'Open project') : l('Excluir projeto', 'Delete project')}</h1>
      <p role={error ? 'alert' : 'status'}>{error || (opening ? l('Carregando o ambiente…', 'Loading the environment…') : l('Preparando a exclusão…', 'Preparing deletion…'))}</p>
      <button className="web-button" onClick={returnToLibrary}>{l('Voltar à biblioteca', 'Back to library')}</button>
    </main>
    {project && <DeleteProjectDialog project={project} onClose={returnToLibrary} onDelete={async (iframe, onStage) => {
      // Revalidate the current catalog before deleting; another tab may have
      // removed or rebound the project while this confirmation was open.
      const current = await readProject();
      await destroyProjectData({ iframe, project: current, language, onStage });
      try { await repository.remove(current.id); }
      catch (reason) { throw new Error(storageError(reason), { cause: reason }); }
      returnToLibrary();
    }} />}
    </>}
  </StudioI18nProvider>;
}

export function renderProjectStorage(): void {
  const root = document.getElementById('kodety-studio-root');
  if (!root) throw new Error('Onun Kodety root element was not found.');
  createRoot(root).render(<ProjectStorage />);
}
