'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { captureHtmlInspectorAction } from '@/stores/useHtmlInspectorPanelStore';

type StyleChangeHandler = (property: string, value: string) => void;
type StylePreviewHandler = (
  property: string,
  value: string,
  flushImmediately?: boolean,
) => void;

interface UseHtmlStylePreviewTransactionOptions {
  onCommit: StyleChangeHandler;
  onPreview?: StylePreviewHandler;
  onCancel?: () => void;
  scopeKey: string;
  /**
   * Declarations read from the canonical source for the active edit context.
   * Optimistic controls are released only when this source confirms them.
   */
  confirmedValues: Record<string, string>;
}

interface ActiveStylePreviewTransaction {
  scopeKey: string;
  commit: StyleChangeHandler;
  preview?: StylePreviewHandler;
  cancel?: () => void;
}

const EMPTY_OPTIMISTIC_VALUES: Record<string, string> = {};

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(target.type);
}

function comparableStyleValue(value: string) {
  return value
    .replace(/\s*!\s*important\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Coalesces visual-control samples into at most one preview per animation
 * frame. The authored source is changed only once, at the interaction boundary.
 */
export function useHtmlStylePreviewTransaction({
  onCommit,
  onPreview,
  onCancel,
  scopeKey,
  confirmedValues,
}: UseHtmlStylePreviewTransactionOptions) {
  const rootElementRef = useRef<HTMLElement | null>(null);
  const scopeKeyRef = useRef(scopeKey);
  const scopeVersionRef = useRef(0);
  const commitRef = useRef(onCommit);
  const previewRef = useRef(onPreview);
  const cancelRef = useRef(onCancel);
  const activeTransactionRef = useRef<ActiveStylePreviewTransaction | null>(null);
  const pendingRef = useRef(new Map<string, string>());
  const previewQueueRef = useRef(new Map<string, string>());
  const recentCommitRef = useRef(new Map<string, string>());
  const recentCommitScopeRef = useRef('');
  const frameRef = useRef<number | null>(null);
  const recentCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerActiveRef = useRef(false);
  const editableFocusRef = useRef(false);
  const externalActiveRef = useRef(false);
  const externalInteractionSequenceRef = useRef(0);
  const optimisticRef = useRef(new Map<string, string>());
  const optimisticScopeRef = useRef('');
  const optimisticVersionRef = useRef(new Map<string, number>());
  const optimisticSequenceRef = useRef(0);
  const [optimisticValues, setOptimisticValues] = useState<Record<string, string>>({});

  if (scopeKeyRef.current !== scopeKey) scopeVersionRef.current += 1;
  scopeKeyRef.current = scopeKey;
  const scopeVersion = scopeVersionRef.current;
  commitRef.current = onCommit;
  previewRef.current = onPreview;
  cancelRef.current = onCancel;

  const captureTransaction = useCallback(() => {
    const active = activeTransactionRef.current;
    if (active) return active;
    const snapshot: ActiveStylePreviewTransaction = {
      scopeKey: scopeKeyRef.current,
      commit: captureHtmlInspectorAction(commitRef.current),
      preview: captureHtmlInspectorAction(previewRef.current),
      cancel: captureHtmlInspectorAction(cancelRef.current),
    };
    activeTransactionRef.current = snapshot;
    return snapshot;
  }, []);

  const cancelFrame = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const publishOptimisticValues = useCallback(() => {
    setOptimisticValues(Object.fromEntries(optimisticRef.current));
  }, []);

  const retainOptimisticSample = useCallback((
    property: string,
    value: string,
    transactionScopeKey = scopeKeyRef.current,
  ) => {
    if (
      optimisticScopeRef.current
      && optimisticScopeRef.current !== transactionScopeKey
    ) {
      optimisticRef.current.clear();
      optimisticVersionRef.current.clear();
    }
    optimisticScopeRef.current = transactionScopeKey;
    optimisticRef.current.set(property, value);
    optimisticVersionRef.current.set(property, ++optimisticSequenceRef.current);
  }, []);

  const flushPreviewFrame = useCallback(() => {
    frameRef.current = null;
    const preview = activeTransactionRef.current?.preview;
    if (!preview) {
      previewQueueRef.current.clear();
      return;
    }
    const changes = Array.from(previewQueueRef.current);
    previewQueueRef.current.clear();
    changes.forEach(([property, value], index) => {
      preview(property, value, index === changes.length - 1);
    });
  }, []);

  const schedulePreview = useCallback((property: string, value: string) => {
    const transaction = captureTransaction();
    pendingRef.current.set(property, value);
    previewQueueRef.current.set(property, value);
    retainOptimisticSample(property, value, transaction.scopeKey);
    // Publish in the same input event as the control's local state. A deferred
    // RAF snapshot can otherwise overwrite a newer keystroke. Only the canvas
    // preview is throttled; source commits remain grouped by gesture.
    publishOptimisticValues();
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flushPreviewFrame);
    }
  }, [captureTransaction, flushPreviewFrame, publishOptimisticValues, retainOptimisticSample]);

  const flush = useCallback(() => {
    const transaction = activeTransactionRef.current;
    if (!pendingRef.current.size) {
      activeTransactionRef.current = null;
      return;
    }
    cancelFrame();

    const changes = Array.from(pendingRef.current);
    pendingRef.current.clear();
    previewQueueRef.current.clear();
    recentCommitScopeRef.current = transaction?.scopeKey || scopeKeyRef.current;
    changes.forEach(([property, value]) => recentCommitRef.current.set(property, value));
    if (recentCommitTimerRef.current !== null) clearTimeout(recentCommitTimerRef.current);
    recentCommitTimerRef.current = setTimeout(() => {
      recentCommitRef.current.clear();
      recentCommitTimerRef.current = null;
    }, 0);

    // Apply the last sample before persistence even when pointerup happens
    // before the scheduled animation frame.
    const preview = transaction?.preview;
    if (preview) {
      changes.forEach(([property, value], index) => {
        preview(property, value, index === changes.length - 1);
      });
    }
    publishOptimisticValues();
    if (transaction) {
      changes.forEach(([property, value]) => transaction.commit(property, value));
    }
    activeTransactionRef.current = null;
  }, [
    cancelFrame,
    publishOptimisticValues,
  ]);

  const cancel = useCallback(() => {
    const transaction = activeTransactionRef.current;
    const rollback = transaction?.cancel
      || (optimisticScopeRef.current === scopeKeyRef.current
        ? cancelRef.current
        : undefined);
    const hadPendingChanges = pendingRef.current.size > 0
      || previewQueueRef.current.size > 0
      || optimisticRef.current.size > 0;
    cancelFrame();
    pendingRef.current.clear();
    previewQueueRef.current.clear();
    optimisticRef.current.clear();
    optimisticVersionRef.current.clear();
    optimisticScopeRef.current = '';
    setOptimisticValues({});
    activeTransactionRef.current = null;
    pointerActiveRef.current = false;
    editableFocusRef.current = false;
    externalActiveRef.current = false;
    externalInteractionSequenceRef.current += 1;
    if (hadPendingChanges) rollback?.();
  }, [cancelFrame]);

  const change = useCallback<StyleChangeHandler>((property, value) => {
    if (scopeKeyRef.current !== scopeKey || scopeVersionRef.current !== scopeVersion) return;
    if (
      !previewRef.current
      || (!pointerActiveRef.current && !editableFocusRef.current && !externalActiveRef.current)
    ) {
      // Some native inputs re-assert their value in their own blur handler,
      // after the capture-phase transaction has already flushed it.
      if (
        recentCommitScopeRef.current === scopeKeyRef.current
        && recentCommitRef.current.get(property) === value
      ) return;
      retainOptimisticSample(property, value);
      publishOptimisticValues();
      previewRef.current?.(property, value, true);
      commitRef.current(property, value);
      return;
    }
    schedulePreview(property, value);
  }, [
    publishOptimisticValues,
    retainOptimisticSample,
    schedulePreview,
    scopeKey,
    scopeVersion,
  ]);

  useEffect(() => {
    if (
      optimisticScopeRef.current
      && optimisticScopeRef.current !== scopeKey
    ) return;
    let changed = false;
    optimisticRef.current.forEach((expected, property) => {
      if (pendingRef.current.has(property)) return;
      const confirmed = Object.prototype.hasOwnProperty.call(
        confirmedValues,
        property,
      );
      if (
        expected
          ? !confirmed
            || comparableStyleValue(confirmedValues[property] || '')
              !== comparableStyleValue(expected)
          : confirmed
      ) return;
      optimisticRef.current.delete(property);
      optimisticVersionRef.current.delete(property);
      changed = true;
    });
    if (changed) {
      if (!optimisticRef.current.size) optimisticScopeRef.current = '';
      publishOptimisticValues();
    }
  }, [confirmedValues, optimisticValues, publishOptimisticValues, scopeKey]);

  const onPointerDownCapture = useCallback((_event: ReactPointerEvent<HTMLElement>) => {
    captureTransaction();
    pointerActiveRef.current = true;
  }, [captureTransaction]);

  const onPointerUpCapture = useCallback((_event: ReactPointerEvent<HTMLElement>) => {
    const transaction = activeTransactionRef.current;
    // Capture establishes the boundary, but the microtask lets the target's
    // pointerup handler publish its final sample before we persist anything.
    queueMicrotask(() => {
      if (!pointerActiveRef.current || activeTransactionRef.current !== transaction) return;
      pointerActiveRef.current = false;
      if (!externalActiveRef.current) flush();
    });
  }, [flush]);

  const onPointerCancelCapture = useCallback((_event: ReactPointerEvent<HTMLElement>) => {
    const transaction = activeTransactionRef.current;
    queueMicrotask(() => {
      if (activeTransactionRef.current === transaction) cancel();
    });
  }, [cancel]);

  const onFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    if (!isEditableTarget(event.target)) return;
    captureTransaction();
    editableFocusRef.current = true;
  }, [captureTransaction]);

  const onBlurCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    if (!isEditableTarget(event.target)) return;

    const transaction = activeTransactionRef.current;
    // Target-level blur handlers may normalize/re-assert the final value. Flush
    // in a microtask so that final sample is included and committed only once.
    queueMicrotask(() => {
      if (activeTransactionRef.current !== transaction) return;
      // Focus may already have moved to another control before this task runs.
      // Flush the old field without turning the new field's typing into one
      // persisted edit per keystroke.
      editableFocusRef.current = isEditableTarget(document.activeElement)
        && Boolean(rootElementRef.current?.contains(document.activeElement));
      if (!externalActiveRef.current && !pointerActiveRef.current) flush();
    });
  }, [flush]);

  const onKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') cancel();
  }, [cancel]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.key !== 'Enter'
      || event.nativeEvent.isComposing
      || !(event.target instanceof HTMLInputElement)
      || !isEditableTarget(event.target)
    ) return;
    const transaction = activeTransactionRef.current;
    // A field can normalize its final value in its target-level Enter handler.
    // Commit that sample while retaining focus, then let later typing create
    // a fresh gesture. Scope changes/cancellation invalidate this queued work.
    queueMicrotask(() => {
      if (activeTransactionRef.current === transaction) flush();
    });
  }, [flush]);

  const setRootRef = useCallback((node: HTMLElement | null) => {
    rootElementRef.current = node;
  }, []);

  const beginExternalInteraction = useCallback(() => {
    captureTransaction();
    externalInteractionSequenceRef.current += 1;
    externalActiveRef.current = true;
  }, [captureTransaction]);

  const endExternalInteraction = useCallback(() => {
    if (!externalActiveRef.current) return;
    const sequence = externalInteractionSequenceRef.current;
    // Component-level pointerup/blur callbacks can run before the control
    // publishes its final onChange. Commit in the following microtask so that
    // last sample is included instead of briefly restoring the prior value.
    queueMicrotask(() => {
      if (
        !externalActiveRef.current
        || externalInteractionSequenceRef.current !== sequence
      ) return;
      externalActiveRef.current = false;
      flush();
    });
  }, [flush]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootElementRef.current;
      if (
        externalActiveRef.current
        || !pendingRef.current.size
        || !root
        || root.contains(event.target as Node)
      ) return;
      // Commit before an outside pointerdown can change the editor selection.
      editableFocusRef.current = false;
      flush();
    };
    const handlePointerUp = () => {
      if (!pointerActiveRef.current) return;
      pointerActiveRef.current = false;
      if (!externalActiveRef.current) flush();
    };
    const handlePointerCancel = () => {
      if (pointerActiveRef.current) cancel();
    };
    const handleWindowBlur = () => {
      pointerActiveRef.current = false;
      editableFocusRef.current = false;
      externalActiveRef.current = false;
      externalInteractionSequenceRef.current += 1;
      flush();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      pointerActiveRef.current = false;
      editableFocusRef.current = false;
      externalActiveRef.current = false;
      externalInteractionSequenceRef.current += 1;
      flush();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cancel, flush]);

  useLayoutEffect(() => {
    // React can retain a focused input when only its authoring scope changes.
    // Old callbacks are fenced by scopeVersion; future typing still needs a
    // new buffered gesture even though the browser emits no second focus event.
    editableFocusRef.current = isEditableTarget(document.activeElement)
      && Boolean(rootElementRef.current?.contains(document.activeElement));
    return () => {
      if (recentCommitTimerRef.current !== null) {
        clearTimeout(recentCommitTimerRef.current);
        recentCommitTimerRef.current = null;
      }
      recentCommitRef.current.clear();
      recentCommitScopeRef.current = '';

      // A scope switch invalidates the gesture before its writer can consult
      // the editor's live project/selection refs. Normal unmount still commits
      // when the original scope remains current.
      if (activeTransactionRef.current?.scopeKey === scopeKey) {
        if (scopeKeyRef.current === scopeKey) flush();
        else cancel();
      }
      cancelFrame();
      if (optimisticScopeRef.current === scopeKey) {
        optimisticRef.current.clear();
        optimisticVersionRef.current.clear();
        optimisticScopeRef.current = '';
        setOptimisticValues({});
      }
      pointerActiveRef.current = false;
      editableFocusRef.current = false;
      externalActiveRef.current = false;
      externalInteractionSequenceRef.current += 1;
    };
  }, [cancel, cancelFrame, flush, scopeKey]);

  const visibleOptimisticValues = optimisticScopeRef.current === scopeKey
    ? optimisticValues
    : EMPTY_OPTIMISTIC_VALUES;

  return {
    rootRef: setRootRef,
    change,
    flush,
    cancel,
    beginExternalInteraction,
    endExternalInteraction,
    optimisticValues: visibleOptimisticValues,
    interactionProps: {
      onPointerDownCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
      onFocusCapture,
      onBlurCapture,
      onKeyDownCapture,
      onKeyDown,
    },
  };
}
