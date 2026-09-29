import { CanvasBridge } from '@coday/canvas-bridge';
import type { JSONValue } from '@coday/control-schema';
import {
  CODE_COMPONENT_REACT_RUNTIME_SOURCE,
  codeComponentReactImportMap,
} from '@coday/component-runtime/vendor';

export interface SandboxPolicy {
  allowedModulePrefixes: string[]; maxBundleBytes: number; maxLogs: number; maxMessagesPerSecond: number;
  connectSources?: string[]; imageSources?: string[]; fontSources?: string[];
}
export interface SandboxMount { moduleUrl: string; exportName?: string; props: Record<string, JSONValue>; instanceId: string; breakpoint: string }
export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  allowedModulePrefixes: ['blob:', '/_next/', '/coday-components/'], maxBundleBytes: 1_500_000, maxLogs: 100, maxMessagesPerSecond: 120,
  connectSources: [], imageSources: ['data:', 'blob:', 'https:'], fontSources: ['data:', 'https:'],
};

function nonce() { return crypto.randomUUID() }
function moduleDataUrl(source: string) {
  const bytes = new TextEncoder().encode(source); let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte) });
  return `data:text/javascript;base64,${btoa(binary)}`;
}
function html(sessionId: string, token: string, policy: SandboxPolicy) {
  const csp = ["default-src 'none'", `script-src 'nonce-${token}' blob: data:`, `img-src ${policy.imageSources?.join(' ') || "'none'"}`, `font-src ${policy.fontSources?.join(' ') || "'none'"}`, `connect-src ${policy.connectSources?.join(' ') || "'none'"}`, "style-src 'unsafe-inline'", "base-uri 'none'", "form-action 'none'"].join('; ');
  const importMap = JSON.stringify({ imports: codeComponentReactImportMap(moduleDataUrl(CODE_COMPONENT_REACT_RUNTIME_SOURCE)) }).replaceAll('</', '<\\/');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script type="importmap" nonce="${token}">${importMap}</script><style>html,body,#root{margin:0;min-height:100%;}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" nonce="${token}">
const sessionId=${JSON.stringify(sessionId)}, token=${JSON.stringify(token)};
let mounted=null, logCount=0;
const send=(type,payload)=>parent.postMessage({protocol:'1.0.0',sessionId,token,sequence:Date.now(),type,payload},'*');
for(const level of ['debug','info','warn','error']){const original=console[level];console[level]=(...entries)=>{if(logCount++<${policy.maxLogs}) send('logs',{level,entries:entries.map(value=>{try{return JSON.parse(JSON.stringify(value))}catch{return String(value)}})});original(...entries)}}
addEventListener('error',event=>send('error',{message:event.message,stack:event.error?.stack,recoverable:true}));
addEventListener('unhandledrejection',event=>send('error',{message:String(event.reason?.message||event.reason),stack:event.reason?.stack,recoverable:true}));
addEventListener('message',async event=>{const data=event.data;if(data?.protocol!=='1.0.0'||data.sessionId!==sessionId||data.token!==token)return;
 if(data.type==='props'){if(mounted?.update) mounted.update(data.payload.props,data.payload.breakpoint);return}
 if(data.type==='dispose'){try{mounted?.dispose?.()}finally{mounted=null}return}
 if(data.type!=='mount')return;
 try{mounted?.dispose?.();const module=await import(data.payload.moduleUrl);const mount=module.mountCodayComponent||module.mount;if(typeof mount!=='function')throw new Error('O módulo precisa exportar mountCodayComponent ou mount.');mounted=await mount(document.getElementById('root'),data.payload.props,{instanceId:data.payload.instanceId,breakpoint:data.payload.breakpoint,emit:(name,payload)=>send('event',{instanceId:data.payload.instanceId,name,payload})});send('ready',{capabilities:['props','resize','events']})}catch(error){send('error',{instanceId:data.payload.instanceId,message:error.message||String(error),stack:error.stack,recoverable:true})}
});
</script></body></html>`;
}

export class ComponentSandbox {
  readonly iframe: HTMLIFrameElement; readonly bridge: CanvasBridge;
  private moduleUrls = new Set<string>(); private disposed = false;
  private readonly policy: SandboxPolicy; private readonly sessionId = nonce(); private readonly token = nonce();
  constructor(container: HTMLElement, policy: Partial<SandboxPolicy> = {}) {
    this.policy = { ...DEFAULT_SANDBOX_POLICY, ...policy }; this.iframe = document.createElement('iframe');
    this.iframe.sandbox.add('allow-scripts'); this.iframe.referrerPolicy = 'no-referrer'; this.iframe.srcdoc = html(this.sessionId, this.token, this.policy);
    this.iframe.title = 'Coday Code Component sandbox'; container.appendChild(this.iframe);
    if (!this.iframe.contentWindow) throw new Error('Não foi possível criar o sandbox.');
    this.bridge = new CanvasBridge(this.iframe.contentWindow, window, { sessionId: this.sessionId, token: this.token, targetOrigin: '*', maxMessagesPerSecond: this.policy.maxMessagesPerSecond });
  }
  createModuleUrl(code: string) {
    const bytes = new TextEncoder().encode(code).byteLength; if (bytes > this.policy.maxBundleBytes) throw new Error('Bundle excede o limite do sandbox.');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); this.moduleUrls.add(url); return url;
  }
  mount(request: SandboxMount) {
    if (this.disposed) throw new Error('Sandbox descartado.');
    if (!this.policy.allowedModulePrefixes.some(prefix => request.moduleUrl.startsWith(prefix))) throw new Error('Origem do módulo não permitida.');
    this.iframe.contentWindow?.postMessage({ protocol: '1.0.0', sessionId: this.sessionId, token: this.token, sequence: Date.now(), type: 'mount', payload: request }, '*');
  }
  update(instanceId: string, props: Record<string, JSONValue>, breakpoint: string) { this.bridge.send('props', { instanceId, props, breakpoint }) }
  dispose() { if (this.disposed) return; this.disposed = true; this.bridge.dispose(); this.moduleUrls.forEach(URL.revokeObjectURL); this.moduleUrls.clear(); this.iframe.remove() }
}
