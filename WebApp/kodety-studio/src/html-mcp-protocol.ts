export interface HtmlMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint: boolean };
}

const versions = new Set(['2025-03-26', '2025-06-18', '2025-11-25']);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

/** Streamable HTTP: the connected browser owns authentication,
 * availability checks and the same editor callbacks used by the native Agent. */
export function createHtmlMcpRequestHandler(options: {
  siteUrl: string;
  projectId: string;
  tools: readonly HtmlMcpTool[];
  authorize(token: string): Promise<string>;
  available(): boolean;
  invoke(tool: string, args: Record<string, unknown>, identity: { connectionId: string; requestId: string }): Promise<unknown>;
  saveProject(): Promise<void>;
}) {
  const known = new Map(options.tools.map(tool => [tool.name, tool]));
  const sessions = new Map<string, { connectionId: string; expiresAt: number }>();
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(options.siteUrl).origin) return json(403, { error: 'MCP origin denied.' });
    let connectionId: string;
    try {
      const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') || '');
      if (!match) throw Object.assign(new Error('Invalid MCP credential.'), { status: 401 });
      connectionId = await options.authorize(match[1]);
    } catch (cause) {
      return json((cause as { status?: number }).status === 403 ? 403 : 401, { error: 'MCP access denied. Check the project connection and its access token.' });
    }
    const sessionId = request.headers.get('mcp-session-id') || '';
    const session = sessions.get(sessionId);
    if (request.method === 'DELETE') {
      if (!session || session.connectionId !== connectionId) return json(404, { error: 'Unknown MCP session.' });
      sessions.delete(sessionId);
      return new Response(null, { status: 204 });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE', 'Cache-Control': 'no-store' } });
    const version = request.headers.get('mcp-protocol-version');
    if (version && !versions.has(version)) return json(400, { error: 'Unsupported MCP protocol version.' });
    let message: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
    try {
      const text = await request.text();
      if (text.length > 6 * 1024 * 1024) return json(413, { error: 'MCP request is too large.' });
      message = JSON.parse(text);
      if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
        || message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number') throw new Error();
    } catch { return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } }); }
    if (message.method !== 'initialize') {
      if (!sessionId) return json(400, { error: 'Initialize an MCP session first.' });
      if (!session || session.connectionId !== connectionId || session.expiresAt < Date.now()) return json(404, { error: 'MCP session expired. Initialize again.' });
      session.expiresAt = Date.now() + 30 * 60_000;
    }
    if (message.id === undefined) return message.method.startsWith('notifications/')
      ? new Response(null, { status: 202 }) : json(400, { error: 'A request id is required.' });
    const id = message.id;
    const reply = (result: unknown) => json(200, { jsonrpc: '2.0', id, result });
    const failure = (code: number, message: string) => json(200, { jsonrpc: '2.0', id, error: { code, message } });
    if (message.method === 'initialize') {
      for (const [key, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(key);
      if (sessions.size >= 100) return json(429, { error: 'Too many MCP sessions. Close an existing connection.' });
      const nextSession = crypto.randomUUID();
      sessions.set(nextSession, { connectionId, expiresAt: Date.now() + 30 * 60_000 });
      return json(200, { jsonrpc: '2.0', id, result: {
      protocolVersion: versions.has(String(message.params?.protocolVersion)) ? message.params!.protocolVersion : '2025-11-25',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'kodety-html', title: 'Kodety HTML Builder', version: '1.0.0' },
      instructions: 'Edit only the currently open Kodety HTML project. First call kodety_editor_context, then read the relevant snapshot and use its exact revision. Native Builder tools validate edits and save them in the selected project folder. CMS, Analytics, WordPress APIs and external publication are not exposed. Keep the project open. A failed or interrupted write may have changed the editor: inspect before retrying.',
      } }, { 'MCP-Session-Id': nextSession });
    }
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools: options.tools });
    if (message.method !== 'tools/call') return failure(-32601, 'Method not found.');
    const tool = known.get(String(message.params?.name || ''));
    if (!tool) return failure(-32602, 'Unknown HTML Builder tool.');
    const args = message.params?.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) return failure(-32602, 'Tool arguments must be an object.');
    const changes = (args as Record<string, unknown>).changes;
    if (tool.name === 'kodety_apply_changes' && Array.isArray(changes) && changes.some(change => /CmsItem$/.test(String(change?.type)))) return failure(-32602, 'CMS operations require WordPress mode.');
    if (!options.available()) return reply({ content: [{ type: 'text', text: 'Open the HTML Builder before using this tool.' }], isError: true });
    try {
      const result = await options.invoke(tool.name, args as Record<string, unknown>, { connectionId, requestId: `${sessionId}:${String(id)}` });
      if (!tool.annotations.readOnlyHint) await options.saveProject();
      return reply({ content: [{ type: 'text', text: JSON.stringify(result ?? null) }], structuredContent: { result: result ?? null }, isError: false });
    } catch (cause) {
      return reply({ content: [{ type: 'text', text: cause instanceof Error ? cause.message : 'The Builder operation failed. Read the current state before trying again.' }], isError: true });
    }
  };
}
