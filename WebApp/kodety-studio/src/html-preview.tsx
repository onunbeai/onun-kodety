import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HtmlProject } from '../../../lib/html-editor/types';
import type { HtmlProjectEditorProps } from '../../../lib/html-editor/editor-types';
import { configureHtmlFontLibrary, installHtmlFontLibrary, refreshHtmlFontLibrary } from './html-font-library';
import { mountHtmlEditorI18n } from './html-editor-i18n';
import { requestHtmlPreviewAction } from './html-preview-bridge';
import { htmlPreviewUrl, readHtmlPreview, type HtmlPreviewSnapshot } from './html-preview-store';
import './studio-shell.css';
import '../../../app/globals.css';
import '../../../Wordpress/editor/wordpress-editor.css';
import './html-workspace.css';

const SharedHtmlEditor = lazy(async () => {
  installHtmlFontLibrary();
  return import('../../../app/(builder)/kodety/html-editor/components/HtmlProjectEditor');
});
type Host = NonNullable<HtmlProjectEditorProps['workspace']>;
const noop = () => {};
const readOnly = async () => { throw new Error('This preview is read-only. Return to the Builder to edit the project.'); };
function closePreview() { window.close(); }
function PreviewStatus({ error, language = 'en' }: { error?: string; language?: 'en' | 'pt' }) {
  const pt = language === 'pt';
  return <div className="web-html-opening" role={error ? 'alert' : 'status'}>
    <h1>{error ? (pt ? 'Preview indisponível' : 'Preview unavailable') : (pt ? 'Abrindo preview…' : 'Opening preview…')}</h1>
    {error && <><p>{error}</p><button type="button" className="rounded-md border border-border bg-secondary px-4 py-2 text-foreground" onClick={closePreview}>{pt ? 'Fechar preview' : 'Close preview'}</button></>}
  </div>;
}
class PreviewBoundary extends Component<{ children: ReactNode; language: 'en' | 'pt' }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : 'The preview could not be opened.' }; }
  render() { return this.state.error ? <PreviewStatus error={this.state.error} language={this.props.language} /> : this.props.children; }
}

function HtmlPreview({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<HtmlPreviewSnapshot>();
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const language = snapshot?.language || 'en';
  useLayoutEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark');
    const wasEditor = document.body.classList.contains('kodety-wordpress-editor');
    const previousFont = document.body.style.getPropertyValue('--font-inter');
    document.documentElement.classList.add('dark');
    document.body.classList.add('kodety-wordpress-editor');
    document.body.style.setProperty('--font-inter', '"Kodety Inter", Inter, sans-serif');
    return () => {
      if (!wasDark) document.documentElement.classList.remove('dark');
      if (!wasEditor) document.body.classList.remove('kodety-wordpress-editor');
      if (previousFont) document.body.style.setProperty('--font-inter', previousFont);
      else document.body.style.removeProperty('--font-inter');
      configureHtmlFontLibrary('', null);
    };
  }, []);
  useLayoutEffect(() => mountHtmlEditorI18n(language), [language]);
  useEffect(() => {
    mounted.current = true;
    const request = ++generation.current;
    setError('');
    void readHtmlPreview(projectId).then(value => {
      if (!mounted.current || request !== generation.current) return;
      if (!value) throw new Error('No saved preview was found. Open the HTML project and choose Preview again.');
      configureHtmlFontLibrary(projectId, null);
      setSnapshot(value);
    }).catch(reason => {
      if (mounted.current && request === generation.current) setError(reason instanceof Error ? reason.message : 'The HTML preview could not be loaded.');
    });
    return () => { mounted.current = false; generation.current += 1; };
  }, [projectId]);
  const reloadPreview = useCallback(async (): Promise<HtmlProject> => {
    const request = ++generation.current;
    if (window.opener && !window.opener.closed) {
      const refreshed = await requestHtmlPreviewAction(projectId, 'refresh');
      if (!refreshed && mounted.current && window.opener && !window.opener.closed) throw new Error('The editor did not respond. Return to the Builder and try Preview again.');
    }
    const value = await readHtmlPreview(projectId);
    if (!mounted.current || request !== generation.current) throw new DOMException('A newer preview request replaced this one.', 'AbortError');
    if (!value) throw new Error('No saved preview was found. Prepare Preview again from the project.');
    setSnapshot(value);
    return value.project;
  }, [projectId]);
  const publish = useCallback(() => {
    void requestHtmlPreviewAction(projectId, 'publish').then(opened => {
      if (!mounted.current) return;
      if (!opened) throw new Error('The editor tab is unavailable. Reopen the HTML project to publish.');
      window.opener?.focus();
      closePreview();
    }).catch(reason => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The publication panel could not be opened.');
    });
  }, [projectId]);
  const host = useMemo<Host | undefined>(() => snapshot ? {
    initialProject: snapshot.project,
    activeExtensions: snapshot.activeExtensions,
    previewUrl: htmlPreviewUrl(projectId, window.location.href),
    reloadPreview,
    view: 'editor',
    onNavigateView: noop,
    saveProject: readOnly,
    exportProject: readOnly,
    onProjectChange: noop,
    onReady: () => { void refreshHtmlFontLibrary(projectId).catch(() => undefined); },
    onBack: closePreview,
    onPublish: publish,
    onWordPressFeature: noop,
  } : undefined, [projectId, publish, reloadPreview, snapshot]);
  return <div id="kodety-root" className="web-html-workspace">
    {error ? <PreviewStatus error={error} language={language} /> : host ? <PreviewBoundary language={language}><Suspense fallback={<PreviewStatus language={language} />}><SharedHtmlEditor workspace={host} /></Suspense></PreviewBoundary> : <PreviewStatus language={language} />}
  </div>;
}

let activeRoot: Root | undefined;
let stopListening: (() => void) | undefined;
/** Dedicated entry: only the shared Builder's query-driven preview UI mounts. */
export function renderHtmlPreview(): void {
  stopListening?.();
  activeRoot?.unmount();
  const container = document.getElementById('kodety-studio-root');
  if (!container) throw new Error('Onun Kodety root element was not found.');
  const query = new URLSearchParams(window.location.search);
  const projectId = query.get('kodety-html-preview') || '';
  const isReview = query.get('kodety-preview-review') === '1';
  const root = createRoot(container);
  activeRoot = root;
  const stop = () => {
    window.removeEventListener('pagehide', pagehide);
    root.unmount();
    if (activeRoot === root) activeRoot = undefined;
    if (stopListening === stop) stopListening = undefined;
  };
  const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) stop(); };
  stopListening = stop;
  window.addEventListener('pagehide', pagehide);
  root.render(isReview ? <HtmlPreview projectId={projectId} /> : <div id="kodety-root" className="web-html-workspace"><PreviewStatus error="This preview link is incomplete. Open Preview again from the HTML project." /></div>);
}
