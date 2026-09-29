"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CanonicalSettingsSaveLifecycle {
  onStart: () => void;
  onSuccess: () => void;
  onFailure: () => void;
}

export function canonicalSettingsSignature(value: unknown): string {
  const canonicalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    if (!candidate || typeof candidate !== "object") return candidate;
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  };
  return JSON.stringify(canonicalize(value));
}

const ABSENT_SETTING = Symbol('absent-setting');
const isSettingsObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Rebase a form onto a new canonical value. Only fields changed locally
 * override the remote value. Arrays are atomic: splicing arbitrary indexes
 * would corrupt ordered rules, scripts or breakpoint lists. Same-field
 * conflicts retain the local intent, including an explicit field deletion. */
export function mergeCanonicalSettingsDraft<T>(base: T, local: T, remote: T): T {
  const equal = (left: unknown, right: unknown) => left === right || (
    left !== ABSENT_SETTING && right !== ABSENT_SETTING
    && canonicalSettingsSignature(left) === canonicalSettingsSignature(right)
  );
  const merge = (previous: unknown, draft: unknown, incoming: unknown): unknown => {
    if (equal(draft, previous)) return incoming;
    if (equal(draft, incoming) || equal(incoming, previous)) return draft;
    if (isSettingsObject(draft) && isSettingsObject(incoming)
      && (isSettingsObject(previous) || previous === ABSENT_SETTING)) {
      const baseline = isSettingsObject(previous) ? previous : {};
      const keys = new Set([...Object.keys(baseline), ...Object.keys(draft), ...Object.keys(incoming)]);
      const read = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)
        && value[key] !== undefined ? value[key] : ABSENT_SETTING;
      return Object.fromEntries([...keys].flatMap(key => {
        const value = merge(read(baseline, key), read(draft, key), read(incoming, key));
        return value === ABSENT_SETTING ? [] : [[key, value]];
      }));
    }
    return draft;
  };
  return merge(base, local, remote) as T;
}

export function useCanonicalSettingsDraft<T>(canonical: T) {
  const canonicalSignature = canonicalSettingsSignature(canonical);
  const [draft, setDraft] = useState<T>(canonical);
  const [savedSignature, setSavedSignature] = useState(canonicalSignature);
  const canonicalSignatureRef = useRef(canonicalSignature);
  const savedSignatureRef = useRef(canonicalSignature);
  const draftBaselineRef = useRef(canonical);
  const pendingSaveRef = useRef<{
    draft: string;
    canonicalAtStart: string;
  } | null>(null);

  useEffect(() => {
    const previousCanonical = canonicalSignatureRef.current;
    if (previousCanonical === canonicalSignature) return;
    const previousSaved = savedSignatureRef.current;
    const previousBaseline = draftBaselineRef.current;
    const pendingDraft = pendingSaveRef.current?.draft || "";
    canonicalSignatureRef.current = canonicalSignature;
    savedSignatureRef.current = canonicalSignature;
    draftBaselineRef.current = canonical;
    setSavedSignature(canonicalSignature);
    setDraft((current) => {
      const currentSignature = canonicalSettingsSignature(current);
      // A pending save is not proof that an incoming canonical value belongs
      // to that save: Agent/MCP may have changed an independent field first.
      if (currentSignature === previousSaved
        || (currentSignature === pendingDraft && canonicalSignature === pendingDraft)) return canonical;
      return mergeCanonicalSettingsDraft(previousBaseline, current, canonical);
    });
  }, [canonical, canonicalSignature]);

  const saveLifecycle = useCallback(
    (signature: string): CanonicalSettingsSaveLifecycle => ({
      onStart: () => {
        pendingSaveRef.current = {
          draft: signature,
          canonicalAtStart: canonicalSignatureRef.current,
        };
      },
      onSuccess: () => {
        const pending = pendingSaveRef.current;
        if (pending?.draft === signature) pendingSaveRef.current = null;
        if (
          pending &&
          canonicalSignatureRef.current !== pending.canonicalAtStart
        )
          return;
        savedSignatureRef.current = signature;
        // A save can acknowledge before the parent supplies new props. Future
        // remote changes must compare against what was saved, not the older
        // canonical object that happened to be rendered at that time.
        try { draftBaselineRef.current = JSON.parse(signature) as T; } catch { /* Non-JSON roots retain the canonical baseline. */ }
        setSavedSignature(signature);
      },
      onFailure: () => {
        if (pendingSaveRef.current?.draft === signature)
          pendingSaveRef.current = null;
      },
    }),
    [],
  );

  const draftSignature = canonicalSettingsSignature(draft);
  const isSavedSignature = useCallback(
    (signature: string) => savedSignatureRef.current === signature,
    [],
  );
  return {
    draft,
    setDraft,
    draftSignature,
    savedSignature,
    dirty: draftSignature !== savedSignature,
    isSavedSignature,
    saveLifecycle,
  };
}
