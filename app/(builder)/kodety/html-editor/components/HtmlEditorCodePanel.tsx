"use client";

import { memo, useEffect, useRef } from "react";
import {
  ChevronDown,
  FileCode2,
  Maximize2,
  Minimize2,
  Paintbrush,
} from "@/components/ui/gravity-icons";
import { Button } from "@/components/ui/button";
import { CodeEditor, focusCodeEditorDiagnostic } from "@/components/ui/code-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canFormatCode } from "@/lib/html-editor/code-formatter";
import type { CodeComponentCompileState } from "@/lib/html-editor/code-component-authoring";
import { codeLanguage } from "@/lib/html-editor/editor-wordpress-helpers";
import type {
  EditorMode,
  HtmlProject,
  HtmlProjectFile,
} from "@/lib/html-editor/types";
import { cn } from "@/lib/utils";
import { useHtmlEditorChromeStore } from "@/stores/useHtmlEditorChromeStore";

export interface HtmlEditorCodePanelProps {
  mode: EditorMode;
  framerRuntimeReadOnly: boolean;
  isPreviewing: boolean;
  project: HtmlProject;
  source: string;
  textFiles: HtmlProjectFile[];
  sharedReadOnly: boolean;
  codeComponentCompileState: Record<string, CodeComponentCompileState>;
  openCodeFile: (path: string) => void;
  formatCodeFile: (path: string, quiet?: boolean) => Promise<void>;
  changeCodeFile: (path: string, value: string) => void;
}

function HtmlEditorCodePanelImpl({
  mode,
  framerRuntimeReadOnly,
  isPreviewing,
  project,
  source,
  textFiles,
  sharedReadOnly,
  codeComponentCompileState,
  openCodeFile,
  formatCodeFile,
  changeCodeFile,
}: HtmlEditorCodePanelProps) {
  const showCode = useHtmlEditorChromeStore((state) => state.showCode);
  const setShowCode = useHtmlEditorChromeStore((state) => state.setShowCode);
  const codeFilePath = useHtmlEditorChromeStore((state) => state.codeFilePath);
  const codeMaximized = useHtmlEditorChromeStore(
    (state) => state.codeMaximized,
  );
  const setCodeMaximized = useHtmlEditorChromeStore(
    (state) => state.setCodeMaximized,
  );
  const isFormattingCode = useHtmlEditorChromeStore(
    (state) => state.isFormattingCode,
  );

  const activePath = codeFilePath || project.mainHtmlPath;
  const activeFile = project.files[activePath];
  const activeValue =
    activeFile?.text ?? (activePath === project.mainHtmlPath ? source : "");
  const diagnostics = codeComponentCompileState[activePath]?.diagnostics || [];
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingDiagnosticRef = useRef<{ path: string; line: number; column: number; session: number } | null>(null);
  const diagnosticPath = (file?: string) => {
    if (!file) return activePath;
    const normalized = file.replaceAll('\\', '/');
    if (project.files[normalized]?.text !== undefined) return normalized;
    const candidates = textFiles.filter(candidate => normalized.endsWith(`/${candidate.path}`));
    return candidates.length === 1 ? candidates[0].path : null;
  };
  const focusDiagnostic = (item: (typeof diagnostics)[number]) => {
    const path = diagnosticPath(item.file);
    if (!path || !item.line || item.line < 1) return;
    if (path === activePath && textareaRef.current) {
      focusCodeEditorDiagnostic(textareaRef.current, item.line, item.column || 1);
      return;
    }
    pendingDiagnosticRef.current = { path, line: item.line, column: item.column || 1, session: project.openedAt };
    openCodeFile(path);
  };
  useEffect(() => {
    const pending = pendingDiagnosticRef.current;
    if (pending && pending.session !== project.openedAt) {
      pendingDiagnosticRef.current = null;
      return;
    }
    if (!pending || pending.path !== activePath || !textareaRef.current) return;
    pendingDiagnosticRef.current = null;
    focusCodeEditorDiagnostic(textareaRef.current, pending.line, pending.column);
  }, [activePath, activeValue, project.openedAt]);

  return (
    <>
      {showCode &&
        mode === "design" &&
        !framerRuntimeReadOnly &&
        !isPreviewing && (
          <div
            data-kodety-onboarding="design-code-panel"
            className={cn(
              "absolute inset-x-0 bottom-0 z-40 border-t border-[var(--kodety-divider-strong)] bg-[var(--kodety-panel)] shadow-[0_-16px_44px_rgba(0,0,0,.2)]",
              codeMaximized ? "top-0 h-auto" : "h-[46%]",
            )}
          >
            <div className="flex h-10 items-center justify-between border-b border-[var(--kodety-divider)] px-2.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-kodety-onboarding="code-file"
                    size="xs"
                    variant="input"
                    className="max-w-72 justify-between"
                  >
                    <FileCode2 />
                    <span className="truncate">{activePath}</span>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-72 min-w-64 overflow-y-auto"
                >
                  {textFiles.map((file) => (
                    <DropdownMenuItem
                      key={file.path}
                      onClick={() => openCodeFile(file.path)}
                    >
                      <FileCode2 /> {file.path}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="hidden text-[9px] text-muted-foreground xl:block">
                HTML, CSS, JavaScript, SVG e arquivos de texto
              </span>
              <div data-kodety-onboarding="code-tools" className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isFormattingCode || !canFormatCode(activePath)}
                  onClick={() => {
                    void formatCodeFile(activePath);
                  }}
                >
                  <Paintbrush /> {isFormattingCode ? "Formatando…" : "Formatar"}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title={
                    codeMaximized ? "Restaurar editor" : "Maximizar editor"
                  }
                  onClick={() => setCodeMaximized((value) => !value)}
                >
                  {codeMaximized ? <Minimize2 /> : <Maximize2 />}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setShowCode(false);
                    setCodeMaximized(false);
                  }}
                >
                  Fechar
                </Button>
              </div>
            </div>
            <CodeEditor
              // react-simple-code-editor owns an internal undo stack. Reusing
              // the same instance for another path lets Cmd/Ctrl+Z replay the
              // previous file's contents into the active file. A document key
              // gives every opened path a fresh, file-local history boundary.
              key={`${project.openedAt}:${activePath}`}
              value={activeValue}
              textareaRef={textareaRef}
              diagnosticLines={diagnostics.filter(item => item.severity === 'error' && diagnosticPath(item.file) === activePath).map(item => item.line || 0)}
              ariaInvalid={diagnostics.some(item => item.severity === 'error' && diagnosticPath(item.file) === activePath)}
              readOnly={sharedReadOnly}
              onValueChange={(value) => changeCodeFile(activePath, value)}
              language={codeLanguage(activePath)}
              className={cn(
                "rounded-none border-0 bg-[var(--kodety-panel)] text-[var(--kodety-text-secondary)]",
                diagnostics.length
                  ? "h-[calc(100%-116px)]"
                  : "h-[calc(100%-40px)]",
              )}
            />
            {diagnostics.length ? (
              <div
                className="max-h-[76px] overflow-auto border-t border-[var(--kodety-divider)] bg-black/15 px-2.5 py-1.5"
                role="status"
                aria-label="Diagnósticos do Code Component"
              >
                {diagnostics.map((item, index) => (
                  <button
                    type="button"
                    key={`${item.code}:${item.line}:${index}`}
                    onClick={() => focusDiagnostic(item)}
                    disabled={!item.line || !diagnosticPath(item.file)}
                    className={cn(
                      "block w-full text-left text-[10px] leading-4 enabled:hover:underline disabled:cursor-default",
                      item.severity === "error"
                        ? "text-red-300"
                        : item.severity === "warning"
                          ? "text-amber-300"
                          : "text-zinc-400",
                    )}
                  >
                    <span className="font-mono">
                      {item.line
                        ? `${item.line}:${item.column || 1}`
                        : item.code}
                    </span>{" "}
                    · {item.message}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
    </>
  );
}

export const HtmlEditorCodePanel = memo(HtmlEditorCodePanelImpl);
