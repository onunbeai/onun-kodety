import type { SetStateAction } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

type ChromeSetter<T> = (next: SetStateAction<T>) => void;

function resolveStateAction<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

interface HtmlEditorChromeState {
  insertPanelOpen: boolean;
  effectsLibraryOpen: boolean;
  variablesPanelOpen: boolean;
  variableEditorTokenId: string | null;
  cmsManagerOpen: boolean;
  cmsManagerMounted: boolean;
  membersManagerOpen: boolean;
  membersManagerMounted: boolean;
  publishPanelOpen: boolean;
  shareDialogOpen: boolean;
  showCode: boolean;
  codeFilePath: string;
  codeMaximized: boolean;
  isFormattingCode: boolean;
  setInsertPanelOpen: ChromeSetter<boolean>;
  setEffectsLibraryOpen: ChromeSetter<boolean>;
  setVariablesPanelOpen: ChromeSetter<boolean>;
  setVariableEditorTokenId: ChromeSetter<string | null>;
  setCmsManagerOpen: ChromeSetter<boolean>;
  setMembersManagerOpen: ChromeSetter<boolean>;
  setPublishPanelOpen: ChromeSetter<boolean>;
  setShareDialogOpen: ChromeSetter<boolean>;
  setShowCode: ChromeSetter<boolean>;
  setCodeFilePath: ChromeSetter<string>;
  setCodeMaximized: ChromeSetter<boolean>;
  setIsFormattingCode: ChromeSetter<boolean>;
  closeNavigatorOverlays: () => void;
  reset: () => void;
}

export const useHtmlEditorChromeStore = create<HtmlEditorChromeState>()(
  subscribeWithSelector((set) => ({
    insertPanelOpen: false,
    effectsLibraryOpen: false,
    variablesPanelOpen: false,
    variableEditorTokenId: null,
    cmsManagerOpen: false,
    cmsManagerMounted: false,
    membersManagerOpen: false,
    membersManagerMounted: false,
    publishPanelOpen: false,
    shareDialogOpen: false,
    showCode: false,
    codeFilePath: "",
    codeMaximized: false,
    isFormattingCode: false,
    setInsertPanelOpen: (next) =>
      set((state) => ({
        insertPanelOpen: resolveStateAction(next, state.insertPanelOpen),
      })),
    setEffectsLibraryOpen: (next) =>
      set((state) => ({
        effectsLibraryOpen: resolveStateAction(next, state.effectsLibraryOpen),
      })),
    setVariablesPanelOpen: (next) =>
      set((state) => ({
        variablesPanelOpen: resolveStateAction(next, state.variablesPanelOpen),
      })),
    setVariableEditorTokenId: (next) =>
      set((state) => ({
        variableEditorTokenId: resolveStateAction(
          next,
          state.variableEditorTokenId,
        ),
      })),
    setCmsManagerOpen: (next) =>
      set((state) => {
        const open = resolveStateAction(next, state.cmsManagerOpen);
        return {
          cmsManagerOpen: open,
          cmsManagerMounted: state.cmsManagerMounted || open,
        };
      }),
    setMembersManagerOpen: (next) =>
      set((state) => {
        const open = resolveStateAction(next, state.membersManagerOpen);
        return {
          membersManagerOpen: open,
          membersManagerMounted: state.membersManagerMounted || open,
        };
      }),
    setPublishPanelOpen: (next) =>
      set((state) => ({
        publishPanelOpen: resolveStateAction(next, state.publishPanelOpen),
      })),
    setShareDialogOpen: (next) =>
      set((state) => ({
        shareDialogOpen: resolveStateAction(next, state.shareDialogOpen),
      })),
    setShowCode: (next) =>
      set((state) => ({
        showCode: resolveStateAction(next, state.showCode),
      })),
    setCodeFilePath: (next) =>
      set((state) => ({
        codeFilePath: resolveStateAction(next, state.codeFilePath),
      })),
    setCodeMaximized: (next) =>
      set((state) => ({
        codeMaximized: resolveStateAction(next, state.codeMaximized),
      })),
    setIsFormattingCode: (next) =>
      set((state) => ({
        isFormattingCode: resolveStateAction(next, state.isFormattingCode),
      })),
    closeNavigatorOverlays: () =>
      set({
        insertPanelOpen: false,
        effectsLibraryOpen: false,
        variablesPanelOpen: false,
      }),
    reset: () =>
      set({
        insertPanelOpen: false,
        effectsLibraryOpen: false,
        variablesPanelOpen: false,
        variableEditorTokenId: null,
        cmsManagerOpen: false,
        cmsManagerMounted: false,
        membersManagerOpen: false,
        membersManagerMounted: false,
        publishPanelOpen: false,
        shareDialogOpen: false,
        showCode: false,
        codeFilePath: "",
        codeMaximized: false,
        isFormattingCode: false,
      }),
  })),
);
