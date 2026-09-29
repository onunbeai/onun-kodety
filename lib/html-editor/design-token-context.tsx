'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createHtmlDesignTokenId,
  normalizeHtmlDesignTokens,
  type HtmlDesignTokenDocument,
} from './design-tokens';
import {
  ColorVariableCapabilityProvider,
} from '@/lib/color-variable-capability-context';
import type { ColorVariableCapability } from '@/lib/editor-platform-services';

interface HtmlDesignTokenContextValue {
  document: HtmlDesignTokenDocument;
  onChange: (next: HtmlDesignTokenDocument) => void;
}

const HtmlDesignTokenContext = createContext<HtmlDesignTokenContextValue | null>(null);

export function createHtmlDesignTokenColorVariableCapability(
  document: HtmlDesignTokenDocument,
  onChange: (next: HtmlDesignTokenDocument) => void,
): ColorVariableCapability {
  let current = normalizeHtmlDesignTokens(document);
  let snapshot = colorVariableSnapshot(current);
  const listeners = new Set<() => void>();

  function commit(next: HtmlDesignTokenDocument) {
    current = normalizeHtmlDesignTokens(next);
    snapshot = colorVariableSnapshot(current);
    onChange(current);
    listeners.forEach(listener => listener());
  }

  return {
    kind: 'html-design-tokens',
    capabilities: {
      list: true,
      get: true,
      subscribe: true,
      create: true,
      update: true,
      delete: true,
      reorder: true,
      previewOverride: false,
    },
    list: () => snapshot,
    get: id => snapshot.find(variable => variable.id === id),
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    create: async (name, value) => {
      const token = {
        id: createHtmlDesignTokenId(),
        collectionId: current.collections[0].id,
        name,
        type: 'color' as const,
        value,
      };
      commit({ ...current, tokens: [...current.tokens, token] });
      return token;
    },
    update: async (id, changes) => {
      const existing = current.tokens.find(token => token.id === id);
      if (!existing || existing.type !== 'color') return null;
      const updated = { ...existing, ...changes };
      commit({
        ...current,
        tokens: current.tokens.map(token => token.id === id ? updated : token),
      });
      return updated;
    },
    delete: async (id) => {
      if (!current.tokens.some(token => token.id === id && token.type === 'color')) return false;
      commit({
        ...current,
        tokens: current.tokens.filter(token => token.id !== id),
      });
      return true;
    },
    reorder: async (orderedIds) => {
      const ordered = orderedIds
        .map(id => current.tokens.find(token => token.id === id && token.type === 'color'))
        .filter((token): token is NonNullable<typeof token> => Boolean(token));
      let colorIndex = 0;
      commit({
        ...current,
        tokens: current.tokens.map(token => (
          token.type === 'color' ? ordered[colorIndex++] || token : token
        )),
      });
    },
    setPreviewOverride: () => undefined,
  };
}

function colorVariableSnapshot(document: HtmlDesignTokenDocument) {
  return Object.freeze(document.tokens
    .filter(token => token.type === 'color')
    .map(token => Object.freeze({ id: token.id, name: token.name, value: token.value })));
}

export function HtmlDesignTokenProvider({
  document,
  onChange,
  children,
}: HtmlDesignTokenContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ document, onChange }), [document, onChange]);
  const colorVariableCapability = useMemo(
    () => createHtmlDesignTokenColorVariableCapability(document, onChange),
    [document, onChange],
  );
  return (
    <HtmlDesignTokenContext.Provider value={value}>
      <ColorVariableCapabilityProvider capability={colorVariableCapability}>
        {children}
      </ColorVariableCapabilityProvider>
    </HtmlDesignTokenContext.Provider>
  );
}

export function useOptionalHtmlDesignTokens() {
  return useContext(HtmlDesignTokenContext);
}
