import { build } from 'esbuild';

export const CODE_COMPONENT_RUNTIME_MODULE_ID = 'virtual:coday-react-runtime';
const RESOLVED_MODULE_ID = `\0${CODE_COMPONENT_RUNTIME_MODULE_ID}`;
let runtimeSourcePromise;

export function buildCodeComponentReactRuntime() {
  runtimeSourcePromise ||= build({
    stdin: {
      contents: `
        import React from 'react';
        import * as ReactDOM from 'react-dom';
        import * as ReactDOMClient from 'react-dom/client';
        import { jsx, jsxs } from 'react/jsx-runtime';
        export default { ...React, ...ReactDOM, ...ReactDOMClient };
        export const {
          Children, Component, Fragment, Profiler, PureComponent, StrictMode,
          Suspense, act, cache, captureOwnerStack, cloneElement, createContext,
          createElement, createRef, forwardRef, isValidElement, lazy, memo,
          startTransition, unstable_useCacheRefresh, use, useActionState,
          useCallback, useContext, useDebugValue, useDeferredValue, useEffect,
          useId, useImperativeHandle, useInsertionEffect, useLayoutEffect,
          useMemo, useOptimistic, useReducer, useRef, useState,
          useSyncExternalStore, useTransition, version
        } = React;
        export * from '@coday/components';
        export { jsx, jsxs };
        export const jsxDEV = jsx;
        export {
          createPortal, flushSync, preconnect, prefetchDNS, preinit,
          preinitModule, preload, preloadModule, requestFormReset,
          unstable_batchedUpdates, useFormState, useFormStatus
        } from 'react-dom';
        export { createRoot, hydrateRoot } from 'react-dom/client';
      `,
      loader: 'js',
      resolveDir: process.cwd(),
      sourcefile: 'coday-react-runtime.js',
    },
    bundle: true,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    format: 'esm',
    legalComments: 'none',
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    treeShaking: true,
    write: false,
  }).then(result => {
    const output = result.outputFiles?.[0]?.text;
    if (!output) throw new Error('Não foi possível gerar o runtime React dos Code Components.');
    return output;
  });
  return runtimeSourcePromise;
}

/** @returns {import('vite').Plugin} */
export function codeComponentReactRuntimePlugin() {
  return {
    name: 'coday-code-component-react-runtime',
    enforce: 'pre',
    resolveId(id) {
      return id === CODE_COMPONENT_RUNTIME_MODULE_ID ? RESOLVED_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_MODULE_ID) return null;
      return `export default ${JSON.stringify(await buildCodeComponentReactRuntime())};`;
    },
  };
}
