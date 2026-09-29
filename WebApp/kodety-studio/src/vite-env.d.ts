/// <reference types="vite/client" />

declare module 'virtual:kodety-browser-agent-runtime' {
  const url: string;
  export default url;
}

declare module 'virtual:kodety-html-mcp-tools' {
  const tools: import('./html-mcp-protocol').HtmlMcpTool[];
  export default tools;
}
