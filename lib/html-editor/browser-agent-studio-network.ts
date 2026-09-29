import { fetchAgentNetwork, relayAgentNetworkResponse, validAgentNetworkRequest, type AgentNetworkMessage } from './browser-agent-network';

/** Called only after the Studio validates the current Playground frame, origin
 * and project. A transferred port scopes each stream to that exact requester. */
export function createStudioAgentNetworkBridge() {
  const active = new Set<AbortController>();
  return {
    receive(event: MessageEvent) {
      const port = event.ports[0];
      const message = event.data as AgentNetworkMessage;
      if (!port || message.action !== 'request' || typeof message.requestId !== 'string' || message.requestId.length > 100 || !validAgentNetworkRequest(message.request)) return;
      if (active.size >= 8) { port.postMessage({ requestId: message.requestId, action: 'error' }); port.close(); return; }
      const controller = new AbortController();
      active.add(controller);
      const timer = setTimeout(() => controller.abort(), 300_000);
      let acknowledge: (() => void) | undefined;
      port.onmessage = event => {
        if (event.data?.action === 'cancel') controller.abort();
        if (event.data?.action === 'ack') { acknowledge?.(); acknowledge = undefined; }
      };
      const send = (response: AgentNetworkMessage) => new Promise<void>((resolve, reject) => {
        const abort = () => { acknowledge = undefined; reject(new Error('Agent connection closed.')); };
        controller.signal.addEventListener('abort', abort, { once: true });
        acknowledge = () => { controller.signal.removeEventListener('abort', abort); resolve(); };
        port.postMessage(response);
        if (controller.signal.aborted) abort();
      });
      void (async () => {
        const response = await fetchAgentNetwork(message.request!, {}, controller.signal);
        await relayAgentNetworkResponse(message.requestId, response, send, controller.signal);
      })().catch(error => { port.postMessage({ action: 'error', requestId: message.requestId, ...(error?.code === 'agent_browser_network_unavailable' ? { code: error.code } : {}) }); })
        .finally(() => { clearTimeout(timer); port.close(); active.delete(controller); });
    },
    dispose() { for (const controller of active) controller.abort(); active.clear(); },
  };
}
