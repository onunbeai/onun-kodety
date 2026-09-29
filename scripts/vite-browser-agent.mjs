import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHtmlMcpToolCatalog } from './vite-html-mcp-tools.mjs';
import { readBrowserAgentSkills } from './browser-agent-skill-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const virtualId = 'virtual:kodety-browser-agent-runtime';

/** Bundle dependencies as JavaScript once; users never install npm packages. */
export async function buildBrowserAgentRuntime() {
  const tools = await readHtmlMcpToolCatalog({ agent: true });
  const skills = await readBrowserAgentSkills();
  const result = await build({
    stdin: {
      resolveDir: root,
      sourcefile: 'kodety-browser-agent-entry.mjs',
      contents: `
import { createInterface } from 'node:readline';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { createBrowserAgentRuntime } from './lib/html-editor/browser-agent-runtime.mjs';
import { createBrowserAgentNetworkFetch } from './lib/html-editor/browser-agent-network-runtime.mjs';
// Pi's default OAuth loader deliberately hides its variable import from
// bundlers. Its standalone registration also works in WebContainer's Node.
registerBunOAuthFlows();
const tools = ${JSON.stringify(tools)};
const skills = ${JSON.stringify(skills)};
let runtime;
let initialization;
const emit = message => process.stdout.write(JSON.stringify({channel:'kodety-agent',...message})+'\\n');
const network = createBrowserAgentNetworkFetch(emit);
const credentialWrites = new Map();
function accessCredentials(action, details={}, signal) {
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();credentialWrites.delete(requestId);emit({kind:'credentials',action:'cancel',requestId:crypto.randomUUID(),cancelId:requestId});reject(Object.assign(new Error('Operação cancelada.'),{name:'AbortError',code:'agent_aborted'}));};
    const timer=setTimeout(()=>{cleanup();credentialWrites.delete(requestId);emit({kind:'credentials',action:'cancel',requestId:crypto.randomUUID(),cancelId:requestId});reject(Object.assign(new Error('Account storage unavailable.'),{code:'agent_browser_credentials_unavailable'}));},45000);
    credentialWrites.set(requestId,{resolve:value=>{cleanup();resolve(value);},reject:()=>{cleanup();reject(Object.assign(new Error('Account storage unavailable.'),{code:'agent_browser_credentials_unavailable'}));}});
    emit({kind:'credentials',requestId,action,...details});
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted) abort();
  });
}
const publicErrors = {
  agent_closed: 'Esta sessão do Agente foi encerrada.',
  agent_license_required: 'Ative o Kodety Pro para usar o Agente.',
  agent_read_only: 'Este projeto está em modo somente leitura.',
  agent_thread_not_found: 'Esta conversa não pertence ao projeto aberto.',
  agent_model_unavailable: 'Escolha um modelo disponível para o Agente.',
  agent_login_failed: 'Não foi possível conectar sua conta ChatGPT. Tente novamente.',
  agent_auth_required: 'Conecte sua conta ChatGPT para iniciar o Agente.',
  agent_auth_expired: 'A sessão ChatGPT expirou. Conecte sua conta novamente.',
  agent_turn_running: 'O Agente já está trabalhando nesta conversa.',
  agent_unsupported: 'Esta operação não está disponível no Agente do navegador.',
  agent_request_resolved: 'Esta solicitação não está mais pendente.',
  agent_aborted: 'Operação cancelada.',
  agent_network: 'Não foi possível conectar ao serviço da OpenAI. Confira a conexão e tente novamente.',
  agent_usage_unavailable: 'Não foi possível consultar os limites da conta. Tente atualizar novamente.',
  agent_browser_network_unavailable: 'O serviço de conexão do Agent não está disponível nesta hospedagem. Atualize o servidor do Studio ou o plugin WordPress.',
  agent_skill_invalid: 'A skill é inválida ou não está disponível. Confira os arquivos e tente novamente.',
  agent_attachment_invalid: 'O anexo é inválido ou não está disponível. Confira o arquivo e envie-o novamente.',
  agent_browser_attachments_storage: 'Não foi possível salvar o anexo neste navegador. Libere espaço e permita o armazenamento local.',
  agent_browser_credentials_unavailable: 'Não foi possível salvar a conta neste navegador. Permita o armazenamento local e tente novamente.',
  usage_limit_reached: 'O limite de uso desta conta ChatGPT foi atingido. Aguarde a renovação do limite.',
};
const publicError = error => ({
  code: Object.hasOwn(publicErrors,error?.code) ? error.code : 'agent_browser_error',
  message: Object.hasOwn(publicErrors,error?.code) ? publicErrors[error.code] : 'O Agent não conseguiu concluir a operação. Tente novamente.',
  status: Number.isInteger(error?.status) && error.status>=400 && error.status<=599 ? error.status : 500,
});
const lines = createInterface({input:process.stdin,crlfDelay:Infinity});
const attachmentWrites = new Map();
function persistAttachments(state) {
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();
    const fail=()=>{clearTimeout(timer);attachmentWrites.delete(requestId);reject(Object.assign(new Error('Attachment storage unavailable.'),{code:'agent_browser_attachments_storage'}));};
    const timer=setTimeout(fail,40000);
    attachmentWrites.set(requestId,{resolve:()=>{clearTimeout(timer);attachmentWrites.delete(requestId);resolve();},reject:fail});
    emit({kind:'attachments',requestId,state});
  });
}
lines.on('line', line => {
  let command;
  try { command=JSON.parse(line); } catch { return; }
  if (!command || typeof command.id !== 'string') return;
  void (async()=>{
    if(command.suffix==='__network') { network.receive(command.options?.body); return {ok:true}; }
    if(command.suffix==='__attachments/ack') {
      const body=command.options?.body;
      const pending=attachmentWrites.get(body?.requestId);
      if(pending) body.ok===true ? pending.resolve() : pending.reject();
      return {ok:true};
    }
    if(command.suffix==='__credentials/ack') {
      const body=command.options?.body;
      const pending=credentialWrites.get(body?.requestId);
      credentialWrites.delete(body?.requestId);
      if(pending) body.ok===true ? pending.resolve(body) : pending.reject();
      return {ok:true};
    }
    if (command.suffix==='__init') {
      if(runtime || initialization) throw new Error('O Agent já foi iniciado.');
      initialization = Promise.resolve().then(async()=>{
        if(command.options?.body?.networkBridge===true) globalThis.fetch=network.fetch;
        runtime=createBrowserAgentRuntime({projectId:command.options?.body?.projectId,tools,skills,
          licensed:command.policy?.licensed===true,readOnly:command.policy?.readOnly===true,
          ...(command.options?.body?.credentialPersistence===true ? {onCredentialsAccess:accessCredentials,onCredentialsChange:(credentials,context)=>accessCredentials('write',{credentials,...context})} : {}),
          ...(command.options?.body?.attachmentPersistence===true ? {onAttachmentsChange:persistAttachments} : {}),
          onSnapshot:snapshot=>emit({kind:'history',snapshot})});
        await runtime.restoreCredentials(command.options?.body?.credentials);
        await runtime.restoreAttachments(command.options?.body?.attachments);
        if(command.options?.body?.snapshot) await runtime.restore(command.options.body.snapshot);
      });
      await initialization;
      return {ready:true};
    }
    if(initialization) await initialization;
    if(!runtime) throw new Error('O Agent ainda está iniciando.');
    await runtime.setPolicy({licensed:command.policy?.licensed===true,readOnly:command.policy?.readOnly===true});
    if(command.suffix==='__policy') return {ok:true};
    return runtime.request(command.suffix, command.options || {});
  })().then(result=>emit({id:command.id,result}),error=>emit({id:command.id,error:publicError(error)}));
});
lines.on('close',()=>{network.dispose();for(const pending of credentialWrites.values())pending.reject();credentialWrites.clear();for(const pending of attachmentWrites.values())pending.reject();attachmentWrites.clear();void Promise.resolve(initialization).catch(()=>undefined).then(()=>runtime?.dispose()).finally(()=>process.exit(0));});
emit({kind:'ready'});
`,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: true,
    legalComments: 'inline',
    banner: { js: "import { createRequire as __kodetyCreateRequire } from 'node:module';const require=__kodetyCreateRequire(import.meta.url);" },
    external: ['canvas', 'fsevents'],
  });
  return result.outputFiles[0].text;
}

export function browserAgentRuntimePlugin() {
  let command;
  let artifact;
  let devRuntime;
  return {
    name: 'kodety-browser-agent-runtime',
    configResolved(config) { command = config.command; },
    async buildStart() {
      if (command !== 'build') return;
      artifact = this.emitFile({ type: 'asset', name: 'browser-agent-runtime.mjs', source: await buildBrowserAgentRuntime() });
    },
    resolveId(id) { if (id === virtualId) return '\0' + virtualId; },
    load(id) {
      if (id !== '\0' + virtualId) return;
      return command === 'build'
        ? `export default import.meta.ROLLUP_FILE_URL_${artifact};`
        : 'export default "/__kodety_agent__/runtime.mjs";';
    },
    configureServer(server) {
      server.middlewares.use('/__kodety_agent__/runtime.mjs', async (_request, response) => {
        try {
          devRuntime ||= buildBrowserAgentRuntime();
          response.setHeader('Content-Type', 'application/javascript');
          response.setHeader('Cache-Control', 'no-store');
          response.end(await devRuntime);
        } catch { devRuntime = undefined; response.statusCode = 503; response.end('Agent build unavailable'); }
      });
      server.watcher.on('change', file => { if (/browser-agent-|agent-skills|builder-instructions|vite-html-mcp-tools|agent-runtime\/server/.test(file)) devRuntime = undefined; });
    },
  };
}
