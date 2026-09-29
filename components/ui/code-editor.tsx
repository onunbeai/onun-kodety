'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useInsertionEffect,
  useMemo,
  useRef,
} from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-css-extras';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-typescript';
import { cn } from '@/lib/utils';

export type CodeEditorLanguage =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'plain';

export type CodeEditorHighlightStatus = 'syntax' | 'plain' | 'large-file' | 'fallback';

export interface CodeEditorCursor {
  selectionStart: number;
  selectionEnd: number;
  line: number;
  column: number;
}

export interface CodeEditorShortcutContext {
  cursor: CodeEditorCursor;
  event: React.KeyboardEvent<HTMLTextAreaElement>;
  textarea: HTMLTextAreaElement;
  value: string;
}

export interface CodeEditorShortcut {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Prevent the browser/editor default before invoking the handler. Defaults to true. */
  preventDefault?: boolean;
  handler: (context: CodeEditorShortcutContext) => void;
}

export interface CodeEditorStatus {
  message: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  busy?: boolean;
}

export interface CodeEditorProps {
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Exposes the internal textarea (e.g. to insert text at the cursor). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  language?: CodeEditorLanguage;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: React.AriaAttributes['aria-invalid'];
  /** Accessible status announced without changing the editor layout. */
  status?: CodeEditorStatus;
  /** Called after cursor or selection movement. Only observed when supplied. */
  onCursorChange?: (cursor: CodeEditorCursor) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  shortcuts?: readonly CodeEditorShortcut[];
  /** Prism is skipped above this size to keep editing responsive. */
  maxHighlightLength?: number;
  /** Prism is also skipped for very long/minified lines. */
  maxHighlightLineLength?: number;
  onHighlightStatusChange?: (status: CodeEditorHighlightStatus) => void;
  /** One-based source lines reported as compiler errors. */
  diagnosticLines?: readonly number[];
}

export const DEFAULT_MAX_HIGHLIGHT_LENGTH = 50_000;
export const DEFAULT_MAX_HIGHLIGHT_LINE_LENGTH = 10_000;

/** Renders leading spaces of each line as middle dots for visible indentation. */
function showIndentDots(html: string): string {
  return html.replace(/^ +/gm, (spaces) =>
    `<span class="code-editor-indent">${'·'.repeat(spaces.length)}</span>`,
  );
}

function escapeCode(code: string): string {
  return code.replace(/[&<>]/g, (character) => {
    if (character === '&') return '&amp;';
    return character === '<' ? '&lt;' : '&gt;';
  });
}

function hasLineLongerThan(code: string, limit: number): boolean {
  let lineStart = 0;
  while (lineStart <= code.length) {
    const lineEnd = code.indexOf('\n', lineStart);
    if (lineEnd === -1) return code.length - lineStart > limit;
    if (lineEnd - lineStart > limit) return true;
    lineStart = lineEnd + 1;
  }
  return false;
}

export function renderCodeHighlight(
  code: string,
  language: CodeEditorLanguage,
  maxHighlightLength = DEFAULT_MAX_HIGHLIGHT_LENGTH,
  maxHighlightLineLength = DEFAULT_MAX_HIGHLIGHT_LINE_LENGTH,
): { html: string; status: CodeEditorHighlightStatus } {
  const safeLimit = Number.isFinite(maxHighlightLength)
    ? Math.max(0, maxHighlightLength)
    : DEFAULT_MAX_HIGHLIGHT_LENGTH;
  const safeLineLimit = Number.isFinite(maxHighlightLineLength)
    ? Math.max(0, maxHighlightLineLength)
    : DEFAULT_MAX_HIGHLIGHT_LINE_LENGTH;

  // Prism has grammars whose worst-case regex behavior can block the UI. Large
  // files stay fully editable and legible, but intentionally skip token markup.
  if (code.length > safeLimit || hasLineLongerThan(code, safeLineLimit)) {
    return { html: escapeCode(code), status: 'large-file' };
  }

  if (language === 'plain') {
    return { html: showIndentDots(escapeCode(code)), status: 'plain' };
  }

  const prismLanguage = language === 'html' ? 'markup' : language;
  const grammar = Prism.languages[prismLanguage] || Prism.languages.markup;
  try {
    return {
      html: showIndentDots(Prism.highlight(code, grammar, prismLanguage)),
      status: 'syntax',
    };
  } catch {
    // A malformed/custom Prism grammar should never make the editor unusable.
    return { html: escapeCode(code), status: 'fallback' };
  }
}

const STYLE_ID = 'code-editor-prism-theme';
const prismCss = `
.code-editor-root {
  --kodety-code-accent: var(--kodety-accent-hover, #afafff);
  --kodety-code-accent-soft: #d0cfff;
  --kodety-code-blue: #91cfff;
  --kodety-code-mint: #9bd9b8;
  --kodety-code-warm: #e6c38f;
  --kodety-code-rose: #e7a6c4;
  --kodety-code-punctuation: rgb(244 244 245 / 68%);
  --kodety-code-comment: rgb(244 244 245 / 38%);
}
.code-editor-root .token.tag,
.code-editor-root .token.keyword { color: var(--kodety-code-accent); }
.code-editor-root .token.attr-name,
.code-editor-root .token.entity { color: var(--kodety-code-blue); }
.code-editor-root .token.attr-value { color: var(--kodety-code-mint); }
.code-editor-root .token.punctuation { color: var(--kodety-code-punctuation); }
.code-editor-root .token.comment { color: var(--kodety-code-comment); font-style: italic; }
.code-editor-root .token.doctype,
.code-editor-root .token.prolog,
.code-editor-root .token.cdata { color: var(--kodety-code-comment); }
.code-editor-root .token.boolean,
.code-editor-root .token.number,
.code-editor-root .token.constant { color: var(--kodety-code-warm); }
.code-editor-root .token.string,
.code-editor-root .token.char,
.code-editor-root .token.attr-value .token.value { color: var(--kodety-code-mint); }
.code-editor-root .token.function,
.code-editor-root .token.class-name { color: var(--kodety-code-accent-soft); }
.code-editor-root .token.operator,
.code-editor-root .token.property { color: var(--kodety-code-blue); }
.code-editor-root .token.selector { color: var(--kodety-code-accent-soft); }
.code-editor-root .token.selector .token.class,
.code-editor-root .token.selector .token.id { color: var(--kodety-code-warm); }
.code-editor-root .token.selector .token.pseudo-class,
.code-editor-root .token.selector .token.pseudo-element,
.code-editor-root .token.selector .token.attribute,
.code-editor-root .token.builtin { color: var(--kodety-code-blue); }
.code-editor-root .token.selector .token.combinator { color: var(--kodety-code-punctuation); }
.code-editor-root .token.regex,
.code-editor-root .token.important { color: var(--kodety-code-warm); }
.code-editor-root .token.variable,
.code-editor-root .token.parameter { color: var(--kodety-code-rose); }
.code-editor-root .token.function-variable { color: var(--kodety-code-accent-soft); }
.code-editor-root .code-editor-indent { color: rgb(244 244 245 / 20%); }
.code-editor-root .code-editor-diagnostic-line { position: relative; background: rgb(239 68 68 / 15%); }
.code-editor-root .code-editor-diagnostic-line::before { content: ''; position: absolute; left: -8px; top: 0; bottom: 0; width: 2px; background: rgb(248 113 113 / 90%); }
`;

function ensurePrismStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = prismCss;
  document.head.appendChild(style);
}

const noop = () => {};
const EMPTY_SHORTCUTS: readonly CodeEditorShortcut[] = [];
const EMPTY_DIAGNOSTIC_LINES: readonly number[] = [];

/** Focus a compiler position without changing source or its undo history. */
export function focusCodeEditorDiagnostic(textarea: HTMLTextAreaElement, line: number, column = 1) {
  if (!Number.isSafeInteger(line) || line < 1) return;
  const lines = textarea.value.split('\n');
  const index = Math.min(line, lines.length) - 1;
  const lineStart = lines.slice(0, index).reduce((offset, text) => offset + text.length + 1, 0);
  const character = Number.isFinite(column) ? Math.max(0, Math.trunc(column) - 1) : 0;
  const offset = lineStart + Math.min(character, lines[index].length);
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(offset, offset);
  const root = textarea.closest<HTMLElement>('.code-editor-root');
  if (!root) return;
  const marker = root.querySelector<HTMLElement>(`[data-code-editor-diagnostic-line="${index + 1}"]`);
  if (marker) {
    root.scrollTop += marker.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 2;
  } else {
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 17.6;
    root.scrollTop = Math.max(0, index * lineHeight - root.clientHeight / 2);
  }
}

function cursorFromTextarea(textarea: HTMLTextAreaElement): CodeEditorCursor {
  const selectionStart = textarea.selectionStart ?? 0;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  const source = textarea.value;
  const previousLineBreak = selectionStart === 0 ? -1 : source.lastIndexOf('\n', selectionStart - 1);
  let line = 1;
  for (let index = 0; index < selectionStart; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return {
    selectionStart,
    selectionEnd,
    line,
    column: selectionStart - previousLineBreak,
  };
}

function shortcutMatches(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  shortcut: CodeEditorShortcut,
): boolean {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.altKey === Boolean(shortcut.altKey) &&
    event.ctrlKey === Boolean(shortcut.ctrlKey) &&
    event.metaKey === Boolean(shortcut.metaKey) &&
    event.shiftKey === Boolean(shortcut.shiftKey)
  );
}

function shortcutAriaLabel(shortcut: CodeEditorShortcut): string {
  return [
    shortcut.ctrlKey && 'Control',
    shortcut.altKey && 'Alt',
    shortcut.shiftKey && 'Shift',
    shortcut.metaKey && 'Meta',
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ]
    .filter(Boolean)
    .join('+');
}

function setAttribute(
  element: HTMLElement,
  name: string,
  value: string | boolean | undefined,
) {
  if (value === undefined || value === false || value === '') {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, String(value));
}

function exposeTextareaRef(
  ref: React.Ref<HTMLTextAreaElement> | undefined,
  textarea: HTMLTextAreaElement,
): () => void {
  if (!ref) return noop;
  if (typeof ref === 'function') {
    const cleanup = ref(textarea);
    return typeof cleanup === 'function' ? cleanup : () => ref(null);
  }
  ref.current = textarea;
  return () => {
    if (ref.current === textarea) ref.current = null;
  };
}

export function CodeEditor({
  value,
  onValueChange,
  readOnly = false,
  placeholder = '',
  className,
  autoFocus = false,
  textareaRef,
  language = 'html',
  ariaLabel = readOnly ? 'Visualização de código' : 'Editor de código',
  ariaDescribedBy,
  ariaInvalid,
  status,
  onCursorChange,
  onKeyDown,
  shortcuts = EMPTY_SHORTCUTS,
  maxHighlightLength = DEFAULT_MAX_HIGHLIGHT_LENGTH,
  maxHighlightLineLength = DEFAULT_MAX_HIGHLIGHT_LINE_LENGTH,
  onHighlightStatusChange,
  diagnosticLines = EMPTY_DIAGNOSTIC_LINES,
}: CodeEditorProps) {
  useInsertionEffect(ensurePrismStyles, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightStatusRef = useRef<CodeEditorHighlightStatus>('plain');
  const reportedHighlightStatusRef = useRef<{
    callback?: (status: CodeEditorHighlightStatus) => void;
    status?: CodeEditorHighlightStatus;
  }>({});
  const editorId = useId();
  const statusId = `${editorId}-status`;
  const safeHighlightLength = Number.isFinite(maxHighlightLength)
    ? Math.max(0, maxHighlightLength)
    : DEFAULT_MAX_HIGHLIGHT_LENGTH;
  const safeHighlightLineLength = Number.isFinite(maxHighlightLineLength)
    ? Math.max(0, maxHighlightLineLength)
    : DEFAULT_MAX_HIGHLIGHT_LINE_LENGTH;
  const describedBy = [ariaDescribedBy, status?.message ? statusId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
  const ariaKeyShortcuts = shortcuts.length
    ? shortcuts.map(shortcutAriaLabel).join(' ')
    : undefined;
  const diagnosticOverlay = useMemo(() => {
    const selected = new Set(diagnosticLines.filter(line => Number.isSafeInteger(line) && line > 0));
    if (!selected.size) return null;
    const result: React.ReactNode[] = [];
    const lines = value.split('\n');
    let plain = '';
    lines.forEach((line, index) => {
      if (selected.has(index + 1)) {
        if (plain) result.push(plain);
        plain = '';
        result.push(<span key={index} data-code-editor-diagnostic-line={index + 1} className="code-editor-diagnostic-line border-red-400/90 bg-red-500/15">{line || ' '}</span>);
      } else plain += line;
      if (index < lines.length - 1) plain += '\n';
    });
    if (plain) result.push(plain);
    return result;
  }, [diagnosticLines, value]);

  const highlight = useMemo(() => {
    let previousCode: string | undefined;
    let previousHtml = '';
    let previousStatus: CodeEditorHighlightStatus = 'plain';

    return (code: string) => {
      if (code !== previousCode) {
        const result = renderCodeHighlight(
          code,
          language,
          safeHighlightLength,
          safeHighlightLineLength,
        );
        previousCode = code;
        previousHtml = result.html;
        previousStatus = result.status;
      }
      highlightStatusRef.current = previousStatus;
      return previousHtml;
    };
  }, [language, safeHighlightLength, safeHighlightLineLength]);

  useEffect(() => {
    const textarea = rootRef.current?.querySelector('textarea') ?? null;
    internalTextareaRef.current = textarea;
    if (!textarea) return;
    const cleanupRef = exposeTextareaRef(textareaRef, textarea);
    return () => {
      cleanupRef();
      if (internalTextareaRef.current === textarea) internalTextareaRef.current = null;
    };
  }, [textareaRef]);

  useEffect(() => {
    const textarea = internalTextareaRef.current;
    if (!textarea) return;
    setAttribute(textarea, 'aria-label', ariaLabel);
    setAttribute(textarea, 'aria-describedby', describedBy);
    setAttribute(textarea, 'aria-invalid', ariaInvalid ?? (status?.tone === 'error' || undefined));
    setAttribute(textarea, 'aria-busy', status?.busy);
    setAttribute(textarea, 'aria-keyshortcuts', ariaKeyShortcuts);
    setAttribute(textarea, 'aria-multiline', true);
  }, [ariaDescribedBy, ariaInvalid, ariaKeyShortcuts, ariaLabel, describedBy, status]);

  useEffect(() => {
    const currentStatus = highlightStatusRef.current;
    const previous = reportedHighlightStatusRef.current;
    if (
      onHighlightStatusChange &&
      (previous.callback !== onHighlightStatusChange || previous.status !== currentStatus)
    ) {
      onHighlightStatusChange(currentStatus);
    }
    reportedHighlightStatusRef.current = {
      callback: onHighlightStatusChange,
      status: currentStatus,
    };
  }, [
    language,
    onHighlightStatusChange,
    safeHighlightLength,
    safeHighlightLineLength,
    value,
  ]);

  useEffect(() => {
    const textarea = internalTextareaRef.current;
    if (!textarea || !onCursorChange) return;
    const reportCursor = () => onCursorChange(cursorFromTextarea(textarea));
    let animationFrame: number | undefined;
    const scheduleCursorReport = () => {
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined;
        reportCursor();
      });
    };
    textarea.addEventListener('input', scheduleCursorReport);
    textarea.addEventListener('keyup', scheduleCursorReport);
    textarea.addEventListener('pointerup', scheduleCursorReport);
    textarea.addEventListener('select', scheduleCursorReport);
    reportCursor();
    return () => {
      textarea.removeEventListener('input', scheduleCursorReport);
      textarea.removeEventListener('keyup', scheduleCursorReport);
      textarea.removeEventListener('pointerup', scheduleCursorReport);
      textarea.removeEventListener('select', scheduleCursorReport);
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    };
  }, [onCursorChange]);

  const handleKeyDown = useCallback<React.KeyboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const shortcut = shortcuts.find((candidate) => shortcutMatches(event, candidate));
      if (!shortcut) return;
      if (shortcut.preventDefault !== false) event.preventDefault();
      shortcut.handler({
        cursor: cursorFromTextarea(event.currentTarget),
        event,
        textarea: event.currentTarget,
        value: event.currentTarget.value,
      });
    },
    [onKeyDown, shortcuts],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        'code-editor-root rounded-lg border border-border/70 bg-transparent overflow-auto font-mono text-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        readOnly && 'cursor-default',
        className,
      )}
    >
      <label className="sr-only" htmlFor={editorId}>
        {ariaLabel}
      </label>
      <div style={{ position: 'relative', minHeight: 'inherit' }}>
      {diagnosticOverlay && (
        <pre
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            margin: 0, padding: 12, border: 0, boxSizing: 'border-box',
            color: 'transparent',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'break-word',
          }}
        >
          {diagnosticOverlay}
        </pre>
      )}
      <Editor
        value={value}
        onValueChange={onValueChange ?? noop}
        highlight={highlight}
        padding={12}
        readOnly={readOnly}
        placeholder={placeholder}
        autoFocus={autoFocus}
        textareaId={editorId}
        onKeyDown={
          handleKeyDown as React.KeyboardEventHandler<HTMLDivElement> &
            React.KeyboardEventHandler<HTMLTextAreaElement>
        }
        textareaClassName="outline-none !min-h-[inherit]"
        preClassName="!min-h-[inherit]"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '11px',
          lineHeight: '1.6',
          minHeight: 'inherit',
        }}
      />
      </div>
      {status?.message ? (
        <span
          id={statusId}
          className="sr-only"
          role={status.tone === 'error' ? 'alert' : 'status'}
          aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
        >
          {status.message}
        </span>
      ) : null}
    </div>
  );
}
