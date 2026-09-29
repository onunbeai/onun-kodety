declare module 'wawoff2/decompress' {
  const decompress: (source: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}
