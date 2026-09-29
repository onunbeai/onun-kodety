'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { PageTransitionMotion } from '@/lib/html-editor/page-transitions';

type PreviewTransitionPhase = 'idle' | 'waiting';

interface PreviewTransitionState {
  phase: PreviewTransitionPhase;
  motion: PageTransitionMotion | null;
}

const IDLE_STATE: PreviewTransitionState = { phase: 'idle', motion: null };

/**
 * Coordinates a project-page swap without animating the canvas surface itself.
 * The buffered iframe owns the visual transition so the complete outgoing
 * document stays painted below the complete incoming document at all times.
 */
export function usePageTransitionPreview(enabled: boolean) {
  const [state, setState] = useState<PreviewTransitionState>(IDLE_STATE);
  const stateRef = useRef(state);
  const failSafeTimerRef = useRef<number | null>(null);
  stateRef.current = state;

  const clearFailSafe = useCallback(() => {
    if (failSafeTimerRef.current !== null) window.clearTimeout(failSafeTimerRef.current);
    failSafeTimerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearFailSafe();
    stateRef.current = IDLE_STATE;
    setState(IDLE_STATE);
  }, [clearFailSafe]);

  useEffect(() => reset, [reset]);
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  const begin = useCallback((motion: PageTransitionMotion, navigate: () => void) => {
    if (!enabled) return false;
    // Every accepted navigation must execute. A newer destination supersedes
    // the pending one; the buffered surface rejects obsolete generations.
    clearFailSafe();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      reset();
      navigate();
      return true;
    }
    const waiting: PreviewTransitionState = { phase: 'waiting', motion };
    stateRef.current = waiting;
    setState(waiting);
    try {
      navigate();
    } catch (error) {
      reset();
      throw error;
    }
    // A malformed destination must never leave Preview permanently locked.
    failSafeTimerRef.current = window.setTimeout(reset, 15_000);
    return true;
  }, [clearFailSafe, enabled, reset]);

  const promote = useCallback(() => {
    if (stateRef.current.phase !== 'waiting') return;
    reset();
  }, [reset]);

  const surfaceStyle: CSSProperties | undefined = state.phase === 'waiting'
    ? { pointerEvents: 'none' }
    : undefined;

  return {
    begin,
    promote,
    reset,
    surfaceStyle,
    bufferedMotion: state.phase === 'waiting' ? state.motion : null,
    phase: state.phase,
  };
}
