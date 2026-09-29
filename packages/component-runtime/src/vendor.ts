import runtimeSource from 'virtual:coday-react-runtime';

export const CODE_COMPONENT_REACT_RUNTIME_PATH = '.coday/runtime/react.mjs';
export const CODE_COMPONENT_REACT_RUNTIME_SOURCE = runtimeSource;
export const CODE_COMPONENT_REACT_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@coday/components',
  'framer',
] as const;

export function codeComponentReactImportMap(runtimeUrl: string) {
  return Object.fromEntries(CODE_COMPONENT_REACT_SPECIFIERS.map(specifier => [specifier, runtimeUrl]));
}
