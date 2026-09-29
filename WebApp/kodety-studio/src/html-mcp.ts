import tools from 'virtual:kodety-html-mcp-tools';
import { invokeHtmlAgentEditorTool, useHtmlAgentEditorBridgeStore } from '../../../stores/useHtmlAgentEditorBridgeStore';
import { createHtmlMcpControllerCore, type HtmlMcpController } from './html-mcp-controller';

export type { HtmlMcpController } from './html-mcp-controller';

export function createHtmlMcpController(options: {
  projectId: string;
  projectName: string;
  siteUrl: string;
  assertAvailable(): Promise<void>;
  saveProject(): Promise<void>;
}): HtmlMcpController {
  const session = crypto.randomUUID();
  return createHtmlMcpControllerCore({ ...options, tools,
    available: () => useHtmlAgentEditorBridgeStore.getState().available,
    invoke: (tool, args, identity) => invokeHtmlAgentEditorTool(tool, args, {
      requestId: identity.requestId, callId: identity.requestId, threadId: identity.connectionId, turnId: session,
    }),
  });
}
