import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import { AlertTriangle, Check, Code2, Loader2, Save } from '../../../components/ui/gravity-icons';
import type { FileSystemApi } from '../api';
import type { FileObject } from '../types';
import { extensionOf, formatBytes } from '../utils';
import { Button, Modal, Pill, Spinner } from './ui';

type EditorLanguage = 'markup' | 'css' | 'javascript' | 'typescript' | 'json' | 'php' | 'yaml' | 'markdown' | 'plain';

function editorLanguage(file: FileObject): EditorLanguage {
  const extension = extensionOf(file);
  if (['html', 'htm', 'svg', 'xml'].includes(extension)) return 'markup';
  if (['css', 'scss', 'sass', 'less'].includes(extension)) return 'css';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return 'javascript';
  if (['ts', 'tsx'].includes(extension)) return 'typescript';
  if (extension === 'json') return 'json';
  if (extension === 'php') return 'php';
  if (['yaml', 'yml'].includes(extension)) return 'yaml';
  if (['md', 'markdown'].includes(extension)) return 'markdown';
  return 'plain';
}

function escapeCode(value: string) {
  return value.replace(/[&<>]/g, character => character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;');
}

function highlightCode(value: string, language: EditorLanguage) {
  if (language === 'plain' || value.length > 250_000) return escapeCode(value);
  const grammar = Prism.languages[language];
  if (!grammar) return escapeCode(value);
  try {
    return Prism.highlight(value, grammar, language);
  } catch {
    return escapeCode(value);
  }
}

export function CodeEditorModal({
  api,
  file,
  canSave,
  maxBytes,
  onClose,
  onSaved,
}: {
  api: FileSystemApi;
  file: FileObject | null;
  canSave: boolean;
  maxBytes?: number;
  onClose: () => void;
  onSaved: (file: FileObject) => void;
}) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = content !== original;
  const language = useMemo(() => file ? editorLanguage(file) : 'plain', [file]);
  const overLimit = Boolean(file && maxBytes && file.size && file.size > maxBytes);

  useEffect(() => {
    let active = true;
    setContent('');
    setOriginal('');
    setError('');
    setSaved(false);
    setConfirmClose(false);
    if (!file || overLimit) return () => { active = false; };
    setLoading(true);
    api.content(file)
      .then(value => {
        if (!active) return;
        setContent(value);
        setOriginal(value);
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : 'Não foi possível abrir este arquivo.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api, file?.id, overLimit]);

  const save = useCallback(async () => {
    if (!file || !dirty || !canSave || saving) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await api.saveContent(file, content, file.checksum);
      setOriginal(content);
      setSaved(true);
      onSaved(next);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o arquivo.');
    } finally {
      setSaving(false);
    }
  }, [api, canSave, content, dirty, file, onSaved, saving]);

  useEffect(() => {
    if (!file) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [file, save]);

  const requestClose = () => dirty ? setConfirmClose(true) : onClose();

  return (
    <Modal
      open={Boolean(file)}
      title={file?.name || 'Code editor'}
      description={file ? `${language === 'plain' ? 'Text' : language} · ${formatBytes(file.size)} · ${file.mount || 'project'}` : undefined}
      width="min(1080px, calc(100vw - 32px))"
      onClose={() => confirmClose ? setConfirmClose(false) : requestClose()}
      footer={
        confirmClose ? (
          <div className="kfs-editor__discard">
            <span><AlertTriangle size={13} /> Descartar alterações não salvas?</span>
            <Button variant="quiet" onClick={() => setConfirmClose(false)}>Continuar editando</Button>
            <Button variant="danger" onClick={onClose}>Descartar</Button>
          </div>
        ) : (
          <>
            <span className={`kfs-editor__status ${saving ? 'is-saving' : ''}`} role="status">
              {saving ? <><Loader2 size={12} /> Salvando…</> : saved ? <><Check size={12} /> Salvo</> : dirty ? 'Alterações não salvas' : 'Sem alterações'}
            </span>
            <Button variant="quiet" onClick={requestClose}>Fechar</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || !canSave || loading || saving || overLimit}>
              {saving ? <Loader2 size={13} /> : <Save size={13} />} Salvar <kbd>⌘S</kbd>
            </Button>
          </>
        )
      }
    >
      <div className="kfs-editor">
        <div className="kfs-editor__toolbar">
          <span><Code2 size={13} /> {language}</span>
          <div>
            {dirty && <Pill tone="warning">Modified</Pill>}
            {!canSave && <Pill tone="danger">Read only</Pill>}
          </div>
        </div>
        {overLimit ? (
          <div className="kfs-editor__message is-error" role="alert">
            <AlertTriangle size={18} />
            <div><strong>Arquivo grande demais para edição</strong><span>O limite configurado é {formatBytes(maxBytes)}.</span></div>
          </div>
        ) : loading ? (
          <div className="kfs-editor__loading"><Spinner label="Carregando conteúdo" /><span>Carregando conteúdo…</span></div>
        ) : error && !content ? (
          <div className="kfs-editor__message is-error" role="alert"><AlertTriangle size={18} /><div><strong>Não foi possível abrir o arquivo</strong><span>{error}</span></div></div>
        ) : (
          <div className="kfs-editor__surface" data-language={language}>
            <Editor
              key={file?.id}
              value={content}
              onValueChange={value => { setContent(value); setSaved(false); setError(''); }}
              highlight={value => highlightCode(value, language)}
              padding={16}
              tabSize={2}
              insertSpaces
              ignoreTabKey={false}
              textareaId="kfs-code-editor-textarea"
              textareaClassName="kfs-editor__textarea"
              className="kfs-editor__control"
              autoFocus
              disabled={!canSave}
              aria-label={`Editor de ${file?.name || 'arquivo'}`}
              spellCheck={false}
            />
          </div>
        )}
        {error && content ? <div className="kfs-editor__error" role="alert"><AlertTriangle size={12} />{error}</div> : null}
      </div>
    </Modal>
  );
}
