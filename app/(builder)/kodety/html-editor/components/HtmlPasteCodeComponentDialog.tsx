'use client';

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  compileCodeComponentProjectFile,
  pastedCodeComponentCandidate,
  pastedCodeComponentPath,
  type CodeComponentCompileState,
} from '@/lib/html-editor/code-component-authoring';
import type { FramerCodeComponentFetch } from '@/lib/html-editor/framer-code-component-import';
import {
  addTextFileForActiveExperimentDocument,
} from '@/lib/html-editor/editor-live-dom-helpers';
import { updateTextFile } from '@/lib/html-editor/project-io';
import type { HtmlProject } from '@/lib/html-editor/types';

export interface HtmlPasteCodeComponentDialogValue {
  source: string;
  suggestedName: string;
}

export interface HtmlPasteCodeComponentDialogProps {
  value: HtmlPasteCodeComponentDialogValue | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, source: string) => Promise<void>;
}

export async function preparePastedCodeComponent(
  project: HtmlProject,
  name: string,
  source: string,
) {
  const publicPath = pastedCodeComponentPath(name);
  if (Object.keys(project.files).some(path => (
    path.toLowerCase() === publicPath.toLowerCase()
    || path.toLowerCase().endsWith(`/${publicPath.toLowerCase()}`)
  ))) {
    throw new Error(`Já existe um Code Component chamado ${publicPath.split('/').pop()}.`);
  }
  const created = addTextFileForActiveExperimentDocument(project, publicPath);
  const draft = updateTextFile(created.project, created.storagePath, source);
  let compiled: Awaited<ReturnType<typeof compileCodeComponentProjectFile>>;
  try {
    compiled = await compileCodeComponentProjectFile(draft, created.storagePath, 'Kodety clipboard');
  } catch (error) {
    compiled = {
      project: draft,
      result: {
        success: false,
        dependencies: [],
        diagnostics: [{
          severity: 'error',
          code: 'compiler',
          message: error instanceof Error ? error.message : String(error),
          file: created.storagePath,
        }],
      },
    };
  }
  return { draft, compiled, storagePath: created.storagePath };
}

export interface HtmlPasteCodeComponentControllerProps {
  projectRef: MutableRefObject<HtmlProject | null>;
  mode: string;
  isPreviewing: boolean;
  workspaceReadOnly: boolean;
  sharedReadOnly: boolean;
  editingLocalizedPage: boolean;
  sourceLocale: string;
  commitProject: (project: HtmlProject) => void;
  openCodeFile: (path: string) => void;
  setCompileState: Dispatch<SetStateAction<Record<string, CodeComponentCompileState>>>;
  notifySharedReadOnly: (message: string) => void;
  framerComponentFetch?: FramerCodeComponentFetch;
}

function availablePastedCodeComponentValue(
  project: HtmlProject,
  candidate: HtmlPasteCodeComponentDialogValue,
) {
  const baseName = candidate.suggestedName;
  let suggestedName = baseName;
  let suffix = 2;
  while (Object.keys(project.files).some(path => {
    const requested = pastedCodeComponentPath(suggestedName).toLowerCase();
    return path.toLowerCase() === requested || path.toLowerCase().endsWith(`/${requested}`);
  })) {
    suggestedName = `${baseName}${suffix}`;
    suffix += 1;
  }
  return { ...candidate, suggestedName };
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function looksLikeFramerCodeComponentUrl(value: string) {
  return /^https:\/\/(?:www\.)?framer\.com\/m\//.test(value.trim());
}

export function HtmlPasteCodeComponentController({
  projectRef,
  mode,
  isPreviewing,
  workspaceReadOnly,
  sharedReadOnly,
  editingLocalizedPage,
  sourceLocale,
  commitProject,
  openCodeFile,
  setCompileState,
  notifySharedReadOnly,
  framerComponentFetch,
}: HtmlPasteCodeComponentControllerProps) {
  const [value, setValue] = useState<HtmlPasteCodeComponentDialogValue | null>(null);

  const create = useCallback(async (name: string, source: string) => {
    if (sharedReadOnly) throw new Error('Este projeto está em uma sessão somente leitura.');
    if (editingLocalizedPage) {
      throw new Error(`Troque para o idioma-base ${sourceLocale} antes de criar o componente.`);
    }
    const current = projectRef.current;
    if (!current) throw new Error('Nenhum projeto está aberto no Kodety.');
    const { draft, compiled, storagePath } = await preparePastedCodeComponent(current, name, source);
    if (projectRef.current !== current) {
      throw new Error('O projeto mudou durante a compilação. Cole novamente para preservar as edições recentes.');
    }
    setCompileState(state => ({ ...state, [storagePath]: compiled.result }));
    if (!compiled.result.success || !compiled.result.componentManifest) {
      commitProject(draft);
      openCodeFile(storagePath);
      const firstError = compiled.result.diagnostics.find(item => item.severity === 'error');
      toast.error('O Code Component precisa de correção', {
        description: firstError?.line
          ? `Linha ${firstError.line}:${firstError.column || 1} · ${firstError.message}`
          : firstError?.message || 'Confira os diagnósticos em vermelho no editor.',
      });
      return;
    }
    commitProject(compiled.project);
    openCodeFile(storagePath);
    toast.success('Code Component criado e compilado', {
      description: `${compiled.result.componentManifest.name} · ${compiled.result.componentManifest.version}`,
    });
  }, [commitProject, editingLocalizedPage, openCodeFile, projectRef, setCompileState, sharedReadOnly, sourceLocale]);

  useEffect(() => {
    let importRevision = 0;
    let activeImport: { controller: AbortController; toastId: string | number } | null = null;
    const cancelActiveImport = () => {
      importRevision += 1;
      activeImport?.controller.abort();
      if (activeImport) toast.dismiss(activeImport.toastId);
      activeImport = null;
    };
    const pasteCodeComponent = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-kodety-onboarding-ui]')) return;
      if (target?.closest(
        'input, textarea, select, [role="textbox"], [data-html-editor-editing], [contenteditable]:not([contenteditable="false"])',
      )) return;
      const clipboardText = event.clipboardData?.getData('text/plain') || '';
      const candidate = pastedCodeComponentCandidate(clipboardText);
      const mayBeFramerUrl = !candidate && looksLikeFramerCodeComponentUrl(clipboardText);
      if (!candidate && !mayBeFramerUrl) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (mode !== 'design' || isPreviewing || workspaceReadOnly) {
        if (sharedReadOnly) {
          notifySharedReadOnly('Criar Code Components não está disponível neste link.');
          return;
        }
        toast.error('Volte ao modo Design para criar o Code Component.');
        return;
      }
      if (editingLocalizedPage) {
        toast.error('Crie o componente no idioma principal', {
          description: `Troque para ${sourceLocale} e cole o TSX novamente.`,
        });
        return;
      }
      const current = projectRef.current;
      if (!current) return;
      if (candidate) {
        cancelActiveImport();
        setValue(availablePastedCodeComponentValue(current, candidate));
        return;
      }
      cancelActiveImport();
      const controller = new AbortController();
      const revision = importRevision;
      const toastId = toast.loading('Importando Code Component do Framer…', {
        description: 'Validando o link e recuperando o TSX editável.',
      });
      activeImport = { controller, toastId };
      void import('@/lib/html-editor/framer-code-component-import').then(module => {
        controller.signal.throwIfAborted();
        const framerUrl = module.framerCodeComponentUrlCandidate(clipboardText);
        if (!framerUrl) {
          throw new module.FramerCodeComponentImportError(
            'framer-url-invalid',
            'Cole uma URL oficial no formato https://framer.com/m/Componente.js@versão.',
          );
        }
        return module.importFramerCodeComponentFromUrl(framerUrl.url, {
          fetch: framerComponentFetch,
          signal: controller.signal,
        });
      }).then(imported => {
        if (controller.signal.aborted || revision !== importRevision) return;
        const latestProject = projectRef.current;
        if (!latestProject) throw new Error('Nenhum projeto está aberto no Kodety.');
        setValue(availablePastedCodeComponentValue(latestProject, imported));
        toast.success('Code Component do Framer carregado', {
          id: toastId,
          description: `${imported.suggestedName} · versão ${imported.resolvedVersion}`,
        });
      }).catch(error => {
        if (controller.signal.aborted || revision !== importRevision || isAbortError(error)) return;
        toast.error('Não foi possível importar o Code Component do Framer', {
          id: toastId,
          description: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        if (activeImport?.controller === controller) activeImport = null;
      });
    };
    window.addEventListener('paste', pasteCodeComponent, true);
    return () => {
      window.removeEventListener('paste', pasteCodeComponent, true);
      cancelActiveImport();
    };
  }, [editingLocalizedPage, framerComponentFetch, isPreviewing, mode, notifySharedReadOnly, projectRef, sharedReadOnly, sourceLocale, workspaceReadOnly]);

  return (
    <HtmlPasteCodeComponentDialog
      value={value}
      onOpenChange={open => {
        if (!open) setValue(null);
      }}
      onConfirm={create}
    />
  );
}

export function HtmlPasteCodeComponentDialog({
  value,
  onOpenChange,
  onConfirm,
}: HtmlPasteCodeComponentDialogProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!value) return;
    setName(value.suggestedName);
    setError('');
    setSubmitting(false);
  }, [value]);

  const submit = async () => {
    if (!value || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(name, value.source);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar o Code Component.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(value)} onOpenChange={open => !submitting && onOpenChange(open)}>
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>Criar Code Component do clipboard</DialogTitle>
          <DialogDescription>
            O Kodety criará um TSX, compilará o manifest e registrará o componente na biblioteca.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Nome do componente</span>
            <div className="flex min-w-0 items-center rounded-md border border-border/80 bg-black/10 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <span className="shrink-0 whitespace-nowrap pl-3 font-mono text-[10px] text-muted-foreground">code-components/</span>
              <Input
                autoFocus
                value={name}
                onChange={event => setName(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent px-1 font-mono shadow-none focus-visible:ring-0"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'paste-code-component-error' : undefined}
              />
              <span className="shrink-0 whitespace-nowrap pr-3 font-mono text-[10px] text-muted-foreground">.tsx</span>
            </div>
          </label>
          <p className="text-[10px] leading-4 text-muted-foreground">
            Se houver erro, o arquivo será aberto no editor com a linha destacada em vermelho; a biblioteca só recebe versões compiladas.
          </p>
          {error ? (
            <p
              id="paste-code-component-error"
              role="alert"
              className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300"
            >
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="secondary" size="sm" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={submitting || !name.trim()} onClick={() => void submit()}>
            {submitting ? <Spinner /> : null}
            {submitting ? 'Compilando…' : 'Criar e compilar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
