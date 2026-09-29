/**
 * Construtor de email do Kodety.
 *
 * Aplicação independente do editor de sites: bundle próprio, rota própria,
 * modelo próprio. Compartilha apenas o design system, para os dois
 * construtores parecerem e se comportarem como o mesmo produto.
 */

import React from 'react';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';
import { Button } from '@/components/ui/button';
import Icon, { type IconProps } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { createBlock, createFooterBlock, createLeaf } from '@/lib/email-editor/blocks';
import { hasBlockingIssue, lintDocument } from '@/lib/email-editor/lint';
import {
  appendBlock,
  appendToColumn,
  insertBlocks,
  insertBlocksAt,
  moveBlockTo,
  duplicateBlock,
  findBlock,
  moveBlock,
  removeBlock,
  updateBlock,
} from '@/lib/email-editor/operations';
import { EMAIL_SECTION_PRESETS, type EmailSectionPreset } from '@/lib/email-editor/presets';
import { renderEmailHtml, renderEmailText } from '@/lib/email-editor/render';
import { sanitizeEmailHtmlForPreview } from '@/lib/email-editor/sanitize';
import {
  clearEmailEditorDraft,
  emailEditorFingerprint,
  ensureEmailEditorDraftScope,
  importLegacyEmailDocument,
  loadTemplate,
  parseDocument,
  readConfig,
  readEmailEditorDraft,
  saveTemplate,
  uploadImage,
  writeEmailEditorDraft,
  type EmailEditorDraft,
  type EmailEditorConfig,
} from '@/lib/email-editor/storage';
import {
  createEmptyDocument,
  type EmailBlock,
  type EmailBlockType,
  type EmailDocument,
  type EmailLeafType,
} from '@/lib/email-editor/types';
import { cn } from '@/lib/utils';
import EmailCanvas from './EmailCanvas';
import EmailInspector, { type EmailBlockPatch } from './EmailInspector';
import EmailLayers from './EmailLayers';
import EmailSectionLibrary, { LibraryTabs } from './EmailSectionLibrary';

type Viewport = 'desktop' | 'mobile';
type Mode = 'edit' | 'preview' | 'text' | 'code';

interface EmailAnalysisSnapshot {
  document: EmailDocument;
  name: string;
  fingerprint: string;
}

export default function KodetyEmailEditor() {
  const [config] = React.useState<EmailEditorConfig | null>(() => {
    try {
      return readConfig();
    } catch {
      return null;
    }
  });

  const initialDocument = React.useMemo(() => createEmptyDocument(), []);
  const wideLayout = useMediaQuery('(min-width: 1280px)');
  const [document, setDocument] = React.useState<EmailDocument>(initialDocument);
  const [name, setName] = React.useState('Novo template');
  const [templateId, setTemplateId] = React.useState(config?.templateId ?? 0);
  const [draftScope] = React.useState(() =>
    ensureEmailEditorDraftScope(config?.templateId ?? 0),
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [viewport, setViewport] = React.useState<Viewport>('desktop');
  const [mode, setMode] = React.useState<Mode>('edit');
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  // Mesmo um template novo passa pelo gate inicial: assim o efeito de
  // autosave não apaga um rascunho local antes de a recuperação ser lida.
  const [loading, setLoading] = React.useState(Boolean(config));
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);
  const [recovery, setRecovery] = React.useState<EmailEditorDraft | null>(null);
  const [serverRevision, setServerRevision] = React.useState('');
  const [savedFingerprint, setSavedFingerprint] = React.useState(() =>
    emailEditorFingerprint('Novo template', initialDocument),
  );
  const [analysisSnapshot, setAnalysisSnapshot] = React.useState<EmailAnalysisSnapshot>(() => ({
    document: initialDocument,
    name: 'Novo template',
    fingerprint: emailEditorFingerprint('Novo template', initialDocument),
  }));
  const [showIssues, setShowIssues] = React.useState(false);
  const [leftPanel, setLeftPanel] = React.useState<'layers' | 'library'>('layers');
  const [leftPanelOpen, setLeftPanelOpen] = React.useState(wideLayout);
  const [rightPanelOpen, setRightPanelOpen] = React.useState(wideLayout);

  /**
   * Histórico de desfazer.
   *
   * As pilhas vivem em refs e são manipuladas fora do updater do `useState`:
   * em StrictMode o React invoca o updater duas vezes, o que empilharia cada
   * passo em duplicidade se a lógica morasse lá dentro.
   */
  const documentRef = React.useRef(document);
  documentRef.current = document;
  const nameRef = React.useRef(name);
  nameRef.current = name;
  const past = React.useRef<EmailDocument[]>([]);
  const future = React.useRef<EmailDocument[]>([]);
  const lastCommitAt = React.useRef(0);
  const loadRequest = React.useRef(0);
  const saveInFlight = React.useRef(false);
  const saveAbort = React.useRef<AbortController | null>(null);
  const uploadInFlight = React.useRef(false);
  const uploadAbort = React.useRef<AbortController | null>(null);
  const serverRevisionRef = React.useRef(serverRevision);
  serverRevisionRef.current = serverRevision;
  const previousWideLayout = React.useRef(wideLayout);
  const [historyTick, setHistoryTick] = React.useState(0);

  React.useEffect(() => {
    if (previousWideLayout.current === wideLayout) return;
    previousWideLayout.current = wideLayout;
    setLeftPanelOpen(wideLayout);
    setRightPanelOpen(wideLayout);
  }, [wideLayout]);

  React.useEffect(() => {
    if (!config) return undefined;

    const requestId = ++loadRequest.current;
    const controller = new AbortController();
    setError('');
    setLoadFailed(false);
    setRecovery(null);

    if (config.templateId <= 0) {
      const draft = readEmailEditorDraft(config, 0, draftScope);
      if (
        draft
        && emailEditorFingerprint(draft.name, draft.document)
          !== emailEditorFingerprint(nameRef.current, documentRef.current)
      ) {
        setRecovery(draft);
      }
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    loadTemplate(config, config.templateId, controller.signal)
      .then((template) => {
        if (controller.signal.aborted || requestId !== loadRequest.current) return;

        const parsed = parseDocument(template.projectJson);
        // Template importado de fora tem HTML mas não tem documento. O import
        // remove o invólucro html/head/body para ele não ficar aninhado dentro
        // do documento que o builder passará a gerar.
        const loaded = parsed
          ?? (template.html ? importLegacyEmailDocument(template.html) : createEmptyDocument());

        // Carregar não é uma edição: o histórico começa deste ponto, para
        // desfazer nunca voltar ao documento vazio inicial.
        past.current = [];
        future.current = [];
        lastCommitAt.current = 0;
        documentRef.current = loaded;
        nameRef.current = template.name;
        setDocument(loaded);
        setName(template.name);
        setTemplateId(template.id);
        setServerRevision(template.revision);
        const fingerprint = emailEditorFingerprint(template.name, loaded);
        setSavedFingerprint(fingerprint);
        setAnalysisSnapshot({ document: loaded, name: template.name, fingerprint });
        setHistoryTick((tick) => tick + 1);

        const draft = readEmailEditorDraft(config, template.id, draftScope);
        if (draft && emailEditorFingerprint(draft.name, draft.document) !== fingerprint) {
          setRecovery(draft);
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || requestId !== loadRequest.current) return;
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o template.');
        setRecovery(readEmailEditorDraft(config, config.templateId, draftScope));
        setLoadFailed(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [config, draftScope, reloadTick]);

  const currentFingerprint = React.useMemo(
    () => emailEditorFingerprint(name, document),
    [name, document],
  );
  const dirty = currentFingerprint !== savedFingerprint;
  const lintPending = currentFingerprint !== analysisSnapshot.fingerprint;

  // Lint e HTML diagnóstico são trabalhos pesados e não precisam rodar a
  // cada tecla. A versão visível é atualizada após uma curta pausa; save e
  // download continuam renderizando o snapshot atual diretamente.
  React.useEffect(() => {
    if (!lintPending) return undefined;
    const timeout = window.setTimeout(() => {
      setAnalysisSnapshot({
        document,
        name,
        fingerprint: currentFingerprint,
      });
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [currentFingerprint, document, lintPending, name]);

  // Mantém uma cópia local curta para recuperar queda de rede, recarregamento
  // acidental ou uma aba fechada. Ela nunca substitui o servidor sem escolha.
  React.useEffect(() => {
    if (!config || loading || recovery) return undefined;

    if (!dirty) {
      clearEmailEditorDraft(config, templateId, draftScope);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      writeEmailEditorDraft(config, {
        templateId,
        name,
        document,
      }, draftScope);
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [config, dirty, document, draftScope, loading, name, recovery, templateId]);

  React.useEffect(
    () => () => {
      const activeSave = saveAbort.current;
      const activeUpload = uploadAbort.current;
      saveAbort.current = null;
      uploadAbort.current = null;
      saveInFlight.current = false;
      uploadInFlight.current = false;
      activeSave?.abort();
      activeUpload?.abort();
    },
    [],
  );

  // Fechar a aba com alteração não salva perde trabalho — avisa antes.
  React.useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      if (config) {
        writeEmailEditorDraft(config, {
          templateId,
          name,
          document,
        }, draftScope);
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [config, dirty, document, draftScope, name, templateId]);

  const analysisHtml = React.useMemo(
    () => renderEmailHtml(analysisSnapshot.document, analysisSnapshot.name),
    [analysisSnapshot],
  );
  const issues = React.useMemo(
    () => lintDocument(analysisSnapshot.document, analysisHtml),
    [analysisHtml, analysisSnapshot.document],
  );
  const modeHtml = React.useMemo(
    () => (mode === 'preview' || mode === 'code' ? renderEmailHtml(document, name) : ''),
    [document, mode, name],
  );
  const text = React.useMemo(
    () => (mode === 'text' ? renderEmailText(document) : ''),
    [document, mode],
  );
  const safePreviewHtml = React.useMemo(
    () => (mode === 'preview' ? sanitizeEmailHtmlForPreview(modeHtml) : ''),
    [mode, modeHtml],
  );
  const selected = React.useMemo(
    () => (selectedId ? findBlock(document, selectedId) : null),
    [document, selectedId],
  );

  const commit = React.useCallback((next: EmailDocument) => {
    const current = documentRef.current;
    if (next === current) return;

    const now = Date.now();
    // Arrastar o controle de espaçamento dispara dezenas de alterações por
    // segundo. Sem coalescência, desfazer teria de ser clicado uma vez por
    // pixel arrastado.
    if (now - lastCommitAt.current > 600 || past.current.length === 0) {
      past.current.push(current);
      if (past.current.length > 100) past.current.shift();
    }
    lastCommitAt.current = now;
    future.current = [];

    documentRef.current = next;
    setDocument(next);
    setStatus('');
    setHistoryTick((tick) => tick + 1);
  }, []);

  const mutate = commit;

  const undo = React.useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;

    future.current.push(documentRef.current);
    documentRef.current = previous;
    setDocument(previous);
    // Evita que o próximo passo seja fundido com o que acabou de ser desfeito.
    lastCommitAt.current = 0;
    setHistoryTick((tick) => tick + 1);
  }, []);

  const redo = React.useCallback(() => {
    const next = future.current.pop();
    if (!next) return;

    past.current.push(documentRef.current);
    documentRef.current = next;
    setDocument(next);
    lastCommitAt.current = 0;
    setHistoryTick((tick) => tick + 1);
  }, []);

  // Atalhos de desfazer/refazer.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;

      // Dentro de um campo de texto, o desfazer nativo do navegador é o
      // comportamento esperado — sequestrá-lo destruiria a digitação.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  React.useEffect(() => {
    if (wideLayout || (!leftPanelOpen && !rightPanelOpen)) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setLeftPanelOpen(false);
      setRightPanelOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [leftPanelOpen, rightPanelOpen, wideLayout]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  void historyTick;

  /** Resolve patches em função contra o bloco mais recente do documento. */
  const applyBlockPatch = React.useCallback(
    (blockId: string, patch: EmailBlockPatch) => {
      const live = findBlock(documentRef.current, blockId);
      if (!live) return;
      const resolved = typeof patch === 'function' ? patch(live) : patch;
      commit(updateBlock(documentRef.current, blockId, resolved));
    },
    [commit],
  );

  const selectBlockForEditing = React.useCallback(
    (blockId: string) => {
      setSelectedId(blockId);
      if (!wideLayout) {
        setLeftPanelOpen(false);
        setRightPanelOpen(true);
      }
    },
    [wideLayout],
  );

  const handleDownload = React.useCallback(() => {
    const snapshotName = nameRef.current;
    const exportedHtml = renderEmailHtml(documentRef.current, snapshotName);
    const blob = new Blob([exportedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(snapshotName) || 'email'}.html`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Sem o revoke o Blob fica retido em memória até a aba fechar.
    URL.revokeObjectURL(url);
  }, []);

  const handleAdd = (type: EmailBlockType) => {
    const block = createBlock(type);
    mutate(appendBlock(documentRef.current, block));
    selectBlockForEditing(block.id);
  };

  const handleInsertSection = (preset: EmailSectionPreset) => {
    const blocks = preset.build();
    const liveDocument = documentRef.current;
    // Só blocos de topo entram na âncora: inserir uma seção "dentro" de uma
    // coluna produziria aninhamento que o modelo de email não suporta.
    const anchor = selectedId && liveDocument.blocks.some((block) => block.id === selectedId)
      ? selectedId
      : null;

    mutate(insertBlocks(liveDocument, blocks, anchor));
    if (blocks.length > 0) selectBlockForEditing(blocks[0].id);
  };

  const handleDropSection = (presetId: string, index: number) => {
    const preset = EMAIL_SECTION_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;

    const blocks = preset.build();
    mutate(insertBlocksAt(documentRef.current, blocks, index));
    if (blocks.length > 0) selectBlockForEditing(blocks[0].id);
  };

  const handleReorder = (blockId: string, index: number) => {
    mutate(moveBlockTo(documentRef.current, blockId, index));
  };

  const handleApplyTemplate = (next: EmailDocument) => {
    mutate(next);
    setSelectedId(null);
    if (!wideLayout) setLeftPanelOpen(false);
  };

  const handleAddToColumn = (columnsId: string, columnIndex: number, type: EmailLeafType) => {
    const leaf = createLeaf(type);
    mutate(appendToColumn(documentRef.current, columnsId, columnIndex, leaf));
    selectBlockForEditing(leaf.id);
  };

  const handleRestoreRecovery = () => {
    if (!recovery) return;

    past.current = [];
    future.current = [];
    lastCommitAt.current = 0;
    documentRef.current = recovery.document;
    nameRef.current = recovery.name;
    const recoveryFingerprint = emailEditorFingerprint(recovery.name, recovery.document);
    setDocument(recovery.document);
    setName(recovery.name);
    setAnalysisSnapshot({
      document: recovery.document,
      name: recovery.name,
      fingerprint: recoveryFingerprint,
    });
    setSelectedId(null);
    setRecovery(null);
    setLoadFailed(false);
    setStatus('Rascunho local recuperado.');
    setHistoryTick((tick) => tick + 1);
  };

  const handleDiscardRecovery = () => {
    if (!config || !recovery) return;
    clearEmailEditorDraft(config, recovery.templateId, draftScope);
    setRecovery(null);
  };

  const handleAddLegalFooter = () => {
    const footer = createFooterBlock();
    mutate(appendBlock(documentRef.current, footer));
    selectBlockForEditing(footer.id);
    setMode('edit');
    setShowIssues(true);
  };

  const handleSave = async () => {
    if (!config || loading || saveInFlight.current) return;
    if (uploadInFlight.current) {
      setError('Aguarde o envio da imagem terminar antes de salvar.');
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    setError('');
    const controller = new AbortController();
    saveAbort.current = controller;
    const idAtStart = templateId;
    const snapshotDocument = documentRef.current;
    const snapshotName = nameRef.current;
    const snapshotFingerprint = emailEditorFingerprint(snapshotName, snapshotDocument);
    const expectedRevision = serverRevisionRef.current;

    try {
      const saved = await saveTemplate(config, {
        id: idAtStart,
        name: snapshotName,
        html: renderEmailHtml(snapshotDocument, snapshotName),
        text: renderEmailText(snapshotDocument),
        document: snapshotDocument,
        expectedRevision,
      }, controller.signal);
      if (controller.signal.aborted) return;

      setTemplateId(saved.id);
      setServerRevision(saved.revision);
      setSavedFingerprint(snapshotFingerprint);

      const liveFingerprint = emailEditorFingerprint(nameRef.current, documentRef.current);
      clearEmailEditorDraft(config, idAtStart, draftScope);
      if (liveFingerprint === snapshotFingerprint) {
        clearEmailEditorDraft(config, saved.id, draftScope);
        setStatus('Template salvo.');
      } else {
        writeEmailEditorDraft(config, {
          templateId: saved.id,
          name: nameRef.current,
          document: documentRef.current,
        }, draftScope);
        setStatus('Versão salva; há alterações mais novas.');
      }

      // Um template novo ganha id: a URL passa a apontar para ele, para
      // recarregar a página não criar uma cópia.
      if (idAtStart === 0 && saved.id > 0) {
        const url = new URL(window.location.href);
        url.searchParams.set('template', String(saved.id));
        url.searchParams.delete('draft');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (reason: unknown) {
      if (isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      if (saveAbort.current === controller) {
        saveAbort.current = null;
        saveInFlight.current = false;
        setSaving(false);
      }
    }
  };

  const handleUpload = async (file: File) => {
    if (!config || !selected || selected.type !== 'image' || uploadInFlight.current) return;
    if (saveInFlight.current) {
      setError('Aguarde o salvamento terminar antes de enviar uma imagem.');
      return;
    }

    uploadInFlight.current = true;
    setUploading(true);
    setError('');
    const controller = new AbortController();
    uploadAbort.current = controller;
    const blockId = selected.id;

    try {
      const uploaded = await uploadImage(config, file, controller.signal);
      if (controller.signal.aborted) return;

      const live = findBlock(documentRef.current, blockId);
      if (!live || live.type !== 'image') {
        setStatus('Imagem enviada à biblioteca; o bloco original não existe mais.');
        return;
      }

      mutate(
        updateBlock(documentRef.current, blockId, {
          src: uploaded.url,
          width: `${uploaded.width}px`,
          alt: isProvisionalAlt(live.alt) ? uploaded.alt : live.alt,
        } as Partial<EmailBlock>),
      );
      setStatus('Imagem enviada.');
    } catch (reason: unknown) {
      if (isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : 'Falha no envio da imagem.');
    } finally {
      if (uploadAbort.current === controller) {
        uploadAbort.current = null;
        uploadInFlight.current = false;
        setUploading(false);
      }
    }
  };

  if (!config) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Não foi possível carregar a configuração do construtor de email.
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="grid h-full place-items-center bg-background text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        Carregando template…
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <Icon name="info" className="text-destructive" />
          <p className="text-sm font-semibold">Não foi possível abrir o template.</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <div className="flex items-center gap-2">
            {recovery && (
              <Button type="button" variant="secondary" size="sm" onClick={handleRestoreRecovery}>
                Abrir rascunho local
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => setReloadTick((tick) => tick + 1)}>
              Tentar novamente
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => (window.location.href = config.campaignsUrl)}
            >
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (recovery) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <div className="flex max-w-lg flex-col items-center gap-3 text-center">
          <Icon name="info" className="text-primary" />
          <p className="text-sm font-semibold">Encontramos alterações locais não salvas.</p>
          <p className="text-xs text-muted-foreground">
            O rascunho é de{' '}
            {new Date(recovery.savedAt).toLocaleString(getAdminUiLocale(), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
            . Escolha qual versão abrir antes de continuar para nenhuma delas ser sobrescrita.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleDiscardRecovery}>
              Usar versão salva
            </Button>
            <Button type="button" size="sm" onClick={handleRestoreRecovery}>
              Recuperar rascunho
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const blocking = hasBlockingIssue(issues);
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  const editorGridColumns = leftPanelOpen
    ? rightPanelOpen
      ? 'xl:grid-cols-[240px_minmax(0,1fr)_300px]'
      : 'xl:grid-cols-[240px_minmax(0,1fr)_40px]'
    : rightPanelOpen
      ? 'xl:grid-cols-[40px_minmax(0,1fr)_300px]'
      : 'xl:grid-cols-[40px_minmax(0,1fr)_40px]';

  const toggleLeftPanel = () => {
    const next = !leftPanelOpen;
    setLeftPanelOpen(next);
    if (next && !wideLayout) setRightPanelOpen(false);
  };
  const toggleRightPanel = () => {
    const next = !rightPanelOpen;
    setRightPanelOpen(next);
    if (next && !wideLayout) setLeftPanelOpen(false);
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-3 py-2 xl:min-h-14 xl:flex-nowrap xl:px-4">
        <div className="flex min-w-48 flex-[1_1_220px] flex-col xl:max-w-64">
          <Input
            className="h-7 w-64 max-w-full border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setStatus('');
            }}
            aria-label="Nome do template"
          />
        </div>

        <div className="order-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-0.5 xl:absolute xl:left-1/2 xl:top-1/2 xl:order-none xl:w-auto xl:-translate-x-1/2 xl:-translate-y-1/2 xl:overflow-visible xl:pb-0">
          <Segmented
            value={mode}
            options={[
              { value: 'edit', label: 'Editar' },
              { value: 'preview', label: 'Prévia' },
              { value: 'text', label: 'Texto' },
              { value: 'code', label: 'HTML' },
            ]}
            onChange={setMode}
          />
          <Segmented
            value={viewport}
            options={[
              { value: 'desktop', label: 'Desktop', icon: 'desktop', iconOnly: true },
              { value: 'mobile', label: 'Mobile', icon: 'mobile', iconOnly: true },
            ]}
            onChange={setViewport}
          />
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {status && (
            <span className="hidden max-w-48 truncate text-xs text-emerald-400 min-[1700px]:inline">
              {status}
            </span>
          )}
          {!status && dirty && (
            <span className="hidden text-xs text-muted-foreground min-[1700px]:inline">
              Alterações não salvas
            </span>
          )}
          {error && (
            <span className="hidden max-w-48 truncate text-xs text-destructive min-[1700px]:inline">
              {error}
            </span>
          )}

          <Button
            type="button"
            variant={!lintPending && blocking ? 'destructive' : 'ghost'}
            size="sm"
            onClick={() => setShowIssues((current) => !current)}
            aria-busy={lintPending}
          >
            <Icon name={lintPending ? 'refresh' : blocking ? 'info' : 'check'} />
            {lintPending
              ? 'Verificando…'
              : issues.length === 0
                ? 'Sem problemas'
                : `${issues.length} ${issues.length === 1 ? 'aviso' : 'avisos'}`}
          </Button>

          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Desfazer"
              title="Desfazer (Ctrl+Z)"
              disabled={!canUndo}
              onClick={undo}
            >
              <Icon name="undo" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Refazer"
              title="Refazer (Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={redo}
            >
              <Icon name="redo" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Baixar HTML"
              title="Baixar HTML"
              onClick={handleDownload}
            >
              <Icon name="upload" className="rotate-180" />
            </Button>
          </div>

          <Button type="button" variant="ghost" size="sm" onClick={() => (window.location.href = config.campaignsUrl)}>
            Sair
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || uploading || !config.canManage}
          >
            {saving ? 'Salvando…' : 'Salvar template'}
          </Button>
        </div>
      </header>

      {(error || status || dirty) && (
        <div className="shrink-0 border-b border-border/70 px-3 py-1.5 text-xs min-[1700px]:hidden">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : status ? (
            <span className="text-emerald-400">{status}</span>
          ) : (
            <span className="text-muted-foreground">Alterações não salvas</span>
          )}
        </div>
      )}

      {showIssues && (
        <div
          className="max-h-48 shrink-0 overflow-auto border-b border-border/70 bg-muted/30 px-4 py-2"
          aria-live="polite"
          aria-busy={lintPending}
        >
          {lintPending ? (
            <p className="text-xs text-muted-foreground">
              Verificando links, descadastro, HTML e acessibilidade…
            </p>
          ) : issues.length === 0 ? (
            <p className="text-xs text-emerald-400">
              Estrutura, links, descadastro e acessibilidade estão prontos para campanha.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {issues.map((issue, index) => (
                <li key={`${issue.blockId ?? 'doc'}-${issue.code ?? index}-${index}`}>
                  <button
                    type="button"
                    className="flex items-start gap-2 text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (issue.blockId) {
                        setMode('edit');
                        selectBlockForEditing(issue.blockId);
                      }
                    }}
                  >
                    <span
                      className={cn(
                        'mt-px shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                        issue.level === 'error'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-amber-500/15 text-amber-400',
                      )}
                    >
                      {issue.level === 'error' ? 'erro' : 'aviso'}
                    </span>
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!lintPending && issues.some((issue) => issue.code === 'missing_unsubscribe') && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={handleAddLegalFooter}
            >
              Adicionar rodapé legal
            </Button>
          )}
          {!lintPending && errorCount > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Erros bloqueiam o disparo da campanha. Avisos, não.
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          'relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]',
          editorGridColumns,
        )}
      >
        {!wideLayout && (leftPanelOpen || rightPanelOpen) && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/35 backdrop-blur-[1px] xl:hidden"
            aria-label="Fechar painel lateral"
            onClick={() => {
              setLeftPanelOpen(false);
              setRightPanelOpen(false);
            }}
          />
        )}

        {!wideLayout && !leftPanelOpen && !rightPanelOpen && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute left-2 top-2 z-10 shadow-lg xl:hidden"
              aria-label="Abrir painel de conteúdo"
              aria-controls="email-editor-content-panel"
              aria-expanded={false}
              title="Abrir conteúdo"
              onClick={toggleLeftPanel}
            >
              <Icon name="layers" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-2 top-2 z-10 shadow-lg xl:hidden"
              aria-label="Abrir painel de propriedades"
              aria-controls="email-editor-properties-panel"
              aria-expanded={false}
              title="Abrir propriedades"
              onClick={toggleRightPanel}
            >
              <Icon name="settings" />
            </Button>
          </>
        )}

        <aside
          id="email-editor-content-panel"
          className={cn(
            'absolute inset-y-0 left-0 z-30 min-h-0 w-[min(280px,calc(100%-2rem))] flex-col border-r border-border/70 bg-background shadow-2xl xl:static xl:w-auto xl:shadow-none',
            leftPanelOpen ? 'flex' : 'hidden xl:flex',
          )}
        >
          {leftPanelOpen ? (
            <>
              <LibraryTabs
                value={leftPanel}
                onChange={setLeftPanel}
                onCollapse={() => setLeftPanelOpen(false)}
              />

              <div className="min-h-0 flex-1">
                {leftPanel === 'layers' ? (
                  <EmailLayers
                    document={document}
                    selectedId={selectedId}
                    onSelect={selectBlockForEditing}
                    onAddBlock={handleAdd}
                    onAddToColumn={handleAddToColumn}
                    onMove={(id, direction) => mutate(moveBlock(documentRef.current, id, direction))}
                    onDuplicate={(id) => mutate(duplicateBlock(documentRef.current, id))}
                    onRemove={(id) => {
                      mutate(removeBlock(documentRef.current, id));
                      setSelectedId(null);
                    }}
                    onRename={(id, next) =>
                      mutate(updateBlock(documentRef.current, id, { name: next } as Partial<EmailBlock>))
                    }
                  />
                ) : (
                  <EmailSectionLibrary
                    hasContent={document.blocks.length > 0}
                    onInsertSection={handleInsertSection}
                    onApplyTemplate={handleApplyTemplate}
                  />
                )}
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mx-auto mt-1.5 hidden xl:inline-flex"
              aria-label="Expandir painel de conteúdo"
              aria-controls="email-editor-content-panel"
              aria-expanded={false}
              title="Expandir conteúdo"
              onClick={() => setLeftPanelOpen(true)}
            >
              <Icon name="chevronRight" />
            </Button>
          )}
        </aside>

        <main className="min-h-0 min-w-0 overflow-auto" onClick={() => setSelectedId(null)}>
          {mode === 'edit' && (
            <EmailCanvas
              document={document}
              selectedId={selectedId}
              viewport={viewport}
              onSelect={selectBlockForEditing}
              onMove={(id, direction) => mutate(moveBlock(documentRef.current, id, direction))}
              onDuplicate={(id) => mutate(duplicateBlock(documentRef.current, id))}
              onRemove={(id) => {
                mutate(removeBlock(documentRef.current, id));
                setSelectedId(null);
              }}
              onAddToColumn={handleAddToColumn}
              onDropSection={handleDropSection}
              onReorder={handleReorder}
            />
          )}

          {mode === 'preview' && (
            <div className="flex justify-center p-6">
              <iframe
                title="Pré-visualização do email"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={safePreviewHtml}
                className="h-[max(420px,calc(100vh-230px))] max-w-full rounded-lg border border-border bg-white"
                style={{ width: viewport === 'mobile' ? 375 : '100%' }}
              />
            </div>
          )}

          {mode === 'text' && (
            <div className="flex h-full flex-col gap-2 p-6">
              <p className="text-xs text-muted-foreground">
                Versão em texto simples salva com o template para clientes sem HTML.
              </p>
              <textarea
                readOnly
                spellCheck={false}
                value={text}
                className="min-h-96 flex-1 resize-none rounded-lg border border-border bg-muted/20 p-4 font-mono text-xs leading-relaxed text-muted-foreground"
              />
            </div>
          )}

          {mode === 'code' && (
            <div className="flex h-full flex-col gap-2 p-6">
              <p className="text-xs text-muted-foreground">
                HTML exportado, com CSS já inline. É exatamente isto que sai para o destinatário.
              </p>
              <textarea
                readOnly
                spellCheck={false}
                value={modeHtml}
                className="min-h-96 flex-1 resize-none rounded-lg border border-border bg-muted/20 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground"
              />
            </div>
          )}
        </main>

        <aside
          id="email-editor-properties-panel"
          className={cn(
            'absolute inset-y-0 right-0 z-30 min-h-0 w-[min(320px,calc(100%-2rem))] flex-col border-l border-border/70 bg-background shadow-2xl xl:static xl:w-auto xl:shadow-none',
            rightPanelOpen ? 'flex' : 'hidden xl:flex',
          )}
        >
          {rightPanelOpen ? (
            <>
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/70 px-3">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Icon name="settings" className="size-3.5 text-muted-foreground" />
                  Propriedades
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Recolher painel de propriedades"
                  aria-controls="email-editor-properties-panel"
                  aria-expanded={true}
                  title="Recolher propriedades"
                  onClick={() => setRightPanelOpen(false)}
                >
                  <Icon name="chevronRight" />
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                {mode === 'edit' ? (
                  <EmailInspector
                    document={document}
                    block={selected}
                    uploading={uploading}
                    onChange={(patch: EmailBlockPatch) => selected && applyBlockPatch(selected.id, patch)}
                    onDocumentChange={mutate}
                    onUploadImage={handleUpload}
                  />
                ) : (
                  <p className="p-4 text-xs text-muted-foreground">
                    Volte para o modo Editar para alterar propriedades.
                  </p>
                )}
              </div>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mx-auto mt-1.5 hidden xl:inline-flex"
              aria-label="Expandir painel de propriedades"
              aria-controls="email-editor-properties-panel"
              aria-expanded={false}
              title="Expandir propriedades"
              onClick={() => setRightPanelOpen(true)}
            >
              <Icon name="chevronLeft" />
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Nome de arquivo seguro a partir do nome do template. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError';
}

function isProvisionalAlt(value: string): boolean {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return !normalized || normalized === 'descreva a imagem' || normalized === 'imagem';
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: {
    value: T;
    label: string;
    icon?: IconProps['name'];
    iconOnly?: boolean;
  }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size={option.iconOnly ? 'icon-sm' : 'sm'}
          variant={value === option.value ? 'secondary' : 'ghost'}
          className={option.iconOnly ? 'aspect-square rounded-md p-0' : undefined}
          style={option.iconOnly
            ? {
                width: 32,
                height: 32,
                minWidth: 32,
                minHeight: 32,
                borderRadius: 6,
                padding: 0,
              }
            : undefined}
          aria-label={option.iconOnly ? option.label : undefined}
          title={option.iconOnly ? option.label : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} />}
          {!option.iconOnly && option.label}
        </Button>
      ))}
    </div>
  );
}
