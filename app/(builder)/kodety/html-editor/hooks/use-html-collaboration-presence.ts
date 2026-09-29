'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  applyHtmlCollaborationPayload,
  useHtmlCollaborationStore,
} from '@/stores/useHtmlCollaborationStore';
import { reloadWithEditorLockHandoff } from '@/Wordpress/editor/editor-lock-navigation';

interface UseHtmlCollaborationPresenceOptions {
  enabled: boolean;
  editorLockUrl?: string;
  nonce: string;
}

type EditorLockWindow = typeof window & {
  kodetyEditorSession?: string;
  kodetyEditorLease?: string;
};

type EditorLockPayload = Parameters<typeof applyHtmlCollaborationPayload>[0] & {
  message?: string;
  sessionId?: string;
  leaseId?: string;
  serverTime?: number;
};

// The server lease lives for 20 seconds. Bound every request well below that
// window so a stalled WordPress/PHP worker cannot stop the heartbeat loop
// forever, while still leaving enough time for a follow-up attempt.
const EDITOR_LOCK_HEARTBEAT_TIMEOUT_MS = 6_000;
const EDITOR_LOCK_FALLBACK_TTL_MS = 20_000;
const EDITOR_LOCK_MAX_CONFIRMED_TTL_MS = 60_000;
const EDITOR_LOCK_NOTICE_ID = 'kodety-editor-lock-conflict';

export function useHtmlCollaborationPresence({
  enabled,
  editorLockUrl,
  nonce,
}: UseHtmlCollaborationPresenceOptions) {
  const limitedNoticeRef = useRef(false);
  const nonceRef = useRef(nonce);
  nonceRef.current = nonce;

  useEffect(() => {
    if (!enabled || !editorLockUrl) {
      useHtmlCollaborationStore.getState().resetPresence();
      return;
    }
    const lockUrl = editorLockUrl;
    const editorWindow = window as EditorLockWindow;
    const sessionId = editorWindow.kodetyEditorSession || '';
    if (!sessionId) {
      useHtmlCollaborationStore.getState().setConnectionStatus(
        'reconnecting',
        'A identidade desta sessão do editor não está disponível.',
      );
      return;
    }
    // React Strict Mode mounts effects twice in development. A lease per mount
    // makes a delayed DELETE from the discarded mount unable to release the
    // replacement mount's editor lock.
    const leaseId = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    editorWindow.kodetyEditorLease = leaseId;

    const controller = new AbortController();
    let stopped = false;
    let timer: number | null = null;
    let authorityExpiryTimer: number | null = null;
    let confirmedAuthorityDeadline = 0;
    let heartbeatInFlight = false;
    let confirmedEdit = false;
    let confirmedServerMode: 'view' | 'edit' | null = null;
    // Only a successful server response is authoritative. In particular, a
    // network timeout or a locally elapsed TTL must never impersonate a real
    // server-reported conflict with another editing session.

    const isCurrentLease = () => (
      !stopped && editorWindow.kodetyEditorLease === leaseId
    );

    const connectionError = (error: unknown) => (
      error instanceof Error && error.message
        ? error.message
        : 'Não foi possível confirmar o acesso de edição.'
    );

    const clearAuthorityExpiry = () => {
      if (authorityExpiryTimer !== null) window.clearTimeout(authorityExpiryTimer);
      authorityExpiryTimer = null;
      confirmedAuthorityDeadline = 0;
    };

    const armAuthorityExpiry = (
      payload: EditorLockPayload,
      response: Response,
      elapsedMs: number,
    ) => {
      clearAuthorityExpiry();
      if (payload.mode !== 'edit' && !payload.limited) return;
      const reportedExpiry = Number(payload.lock?.expiresAt);
      const reportedServerNow = Number(payload.serverTime) || Date.parse(response.headers.get('Date') || '');
      const remaining = Number.isFinite(reportedExpiry) && reportedExpiry > 0
        ? reportedExpiry - (Number.isFinite(reportedServerNow) ? reportedServerNow : Date.now())
        : EDITOR_LOCK_FALLBACK_TTL_MS;
      const boundedRemaining = Math.min(
        EDITOR_LOCK_MAX_CONFIRMED_TTL_MS,
        Math.max(0, remaining - elapsedMs),
      );
      const deadline = Date.now() + boundedRemaining;
      confirmedAuthorityDeadline = deadline;
      authorityExpiryTimer = window.setTimeout(() => {
        authorityExpiryTimer = null;
        if (
          !isCurrentLease()
          || confirmedAuthorityDeadline !== deadline
        ) return;
        confirmedEdit = false;
        limitedNoticeRef.current = false;
        toast.dismiss(EDITOR_LOCK_NOTICE_ID);
        useHtmlCollaborationStore.getState().setConnectionStatus(
          'reconnecting',
          'A confirmação do acesso de edição expirou. Reconectando…',
        );
        heartbeatNow();
      }, boundedRemaining + 25);
    };

    const scheduleHeartbeat = (delay: number) => {
      if (!isCurrentLease()) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void heartbeat();
      }, delay);
    };

    function heartbeatNow() {
      if (!isCurrentLease()) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (heartbeatInFlight) return;
      void heartbeat();
    }

    async function heartbeat() {
      if (!isCurrentLease() || heartbeatInFlight) return;
      heartbeatInFlight = true;
      const requestStartedAt = performance.now();
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      const requestDeadline = window.setTimeout(
        () => requestController.abort(),
        EDITOR_LOCK_HEARTBEAT_TIMEOUT_MS,
      );
      try {
        const response = await fetch(lockUrl, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': nonceRef.current,
            'X-Kodety-Editor-Session': sessionId,
            'X-Kodety-Editor-Lease': leaseId,
          },
          body: JSON.stringify({ sessionId, leaseId }),
          signal: requestController.signal,
        });
        if (!isCurrentLease()) return;
        const payload = (await response.json().catch(() => ({}))) as EditorLockPayload;
        if (!isCurrentLease()) return;
        if (!response.ok) {
          throw new Error(payload.message || 'Não foi possível confirmar o acesso de edição.');
        }
        if (String(payload.sessionId || '') !== sessionId || String(payload.leaseId || '') !== leaseId) {
          throw new Error('O servidor respondeu com uma identidade de sessão obsoleta.');
        }
        if (payload.mode !== 'edit' && payload.mode !== 'view') {
          throw new Error('O servidor respondeu sem confirmar o modo desta sessão.');
        }

        const previousConfirmedMode = confirmedServerMode;
        const nextConfirmedMode = payload.mode;
        applyHtmlCollaborationPayload(payload);
        confirmedServerMode = nextConfirmedMode;
        confirmedEdit = nextConfirmedMode === 'edit';
        armAuthorityExpiry(payload, response, performance.now() - requestStartedAt);

        // A real server handoff can expose a workspace snapshot written by the
        // former holder. Reload through the one-navigation identity handoff so
        // this tab refreshes that snapshot without becoming its own rival.
        if (previousConfirmedMode === 'view' && nextConfirmedMode === 'edit') {
          reloadWithEditorLockHandoff();
          stopped = true;
          return;
        }

        if (payload.limited && !limitedNoticeRef.current) {
          limitedNoticeRef.current = true;
          const holderName = String(payload.lock?.holderName || '').trim();
          toast.info('Projeto em uso', {
            id: EDITOR_LOCK_NOTICE_ID,
            description: holderName
              ? `${holderName} está editando. Esta sessão ficará somente leitura até a edição ser liberada.`
              : 'Outra sessão está editando. Esta sessão ficará somente leitura até a edição ser liberada.',
          });
        } else if (!payload.limited) {
          limitedNoticeRef.current = false;
          toast.dismiss(EDITOR_LOCK_NOTICE_ID);
        }
      } catch (error) {
        if (!isCurrentLease()) return;
        // Preserve a still-valid confirmed lease through transient failures.
        // Before the first confirmation, or after its TTL elapsed, remain
        // fail-closed as `reconnecting` without claiming another editor exists.
        if (useHtmlCollaborationStore.getState().mode === null) {
          useHtmlCollaborationStore.getState().setConnectionStatus(
            'reconnecting',
            connectionError(error),
          );
        }
      } finally {
        window.clearTimeout(requestDeadline);
        controller.signal.removeEventListener('abort', abortRequest);
        heartbeatInFlight = false;
        if (isCurrentLease()) {
          scheduleHeartbeat(document.visibilityState === 'hidden' ? 8000 : 3500);
        }
      }
    }

    const leave = () => {
      // A hidden/unloading document cannot keep renewing a lease it released.
      // BFCache restores mount a fresh lease through the handoff below.
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      clearAuthorityExpiry();
      toast.dismiss(EDITOR_LOCK_NOTICE_ID);
      void fetch(lockUrl, {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-WP-Nonce': nonceRef.current,
          'X-Kodety-Editor-Session': sessionId,
          'X-Kodety-Editor-Lease': leaseId,
        },
        body: JSON.stringify({ sessionId, leaseId }),
      }).catch(() => undefined);
    };

    const resumeFromBackForwardCache = (event: PageTransitionEvent) => {
      // pagehide released this exact lease. A BFCache restore would otherwise
      // spend several seconds heartbeating a tombstone before it can reacquire.
      // Reload through the explicit handoff so the revived page keeps the same
      // logical tab identity while mounting a fresh lease.
      if (event.persisted) reloadWithEditorLockHandoff();
    };

    const heartbeatWhenVisible = () => {
      if (document.visibilityState === 'visible') heartbeatNow();
    };

    useHtmlCollaborationStore.getState().setConnectionStatus('checking');
    heartbeatNow();
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', resumeFromBackForwardCache);
    window.addEventListener('focus', heartbeatNow);
    window.addEventListener('online', heartbeatNow);
    window.addEventListener('kodety-editor-lock-check', heartbeatNow);
    document.addEventListener('visibilitychange', heartbeatWhenVisible);
    return () => {
      stopped = true;
      confirmedEdit = false;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      clearAuthorityExpiry();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', resumeFromBackForwardCache);
      window.removeEventListener('focus', heartbeatNow);
      window.removeEventListener('online', heartbeatNow);
      window.removeEventListener('kodety-editor-lock-check', heartbeatNow);
      document.removeEventListener('visibilitychange', heartbeatWhenVisible);
      leave();
    };
  }, [editorLockUrl, enabled]);

  useEffect(
    () => () => {
      useHtmlCollaborationStore.getState().resetPresence();
    },
    [],
  );
}
