import { DisclosureSummary } from "../../../components/ui/disclosure-summary";
import { useEffect, useId, useRef, useState } from "react";
import type { StudioLanguage } from "../../../ChromeExtension/kodety-studio/src/storage";
import { Icon, Notice, Spinner } from "./ui";
import {
  connectR2, disconnectR2, getR2Connection, getR2ConnectionInfo,
  makeR2CorsPolicy, subscribeR2Connection, testR2Connection,
  type R2Config, type R2ConnectionInfo,
} from "./r2-storage";
import { getR2SyncState, listR2Projects, retryR2Sync, subscribeR2Sync, type R2RemoteProject } from "./r2-project-sync";
import { restoreR2ProjectAsCopy } from "./r2-project-restore";
import "./r2-storage-panel.css";

const blankConfig = (): R2Config => ({ accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "" });

/** Optional extra storage. This panel never changes a local project's directory or mode. */
export function R2StoragePanel({ language, embedded = false }: { language: StudioLanguage; embedded?: boolean }) {
  const l = (pt: string, en: string) => language === "en" ? en : pt;
  const prefix = useId();
  const [config, setConfig] = useState<R2Config>(blankConfig);
  const [connection, setConnection] = useState<R2ConnectionInfo | null>(() => getR2ConnectionInfo());
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "test" | "disconnect" | "list" | "restore" | "sync" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [remoteProjects, setRemoteProjects] = useState<R2RemoteProject[] | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [sync, setSync] = useState(() => getR2SyncState());
  const lock = useRef(false);
  const mounted = useRef(true);
  const accountId = config.accountId.trim();
  const endpoint = /^[a-f\d]{32}$/i.test(accountId) ? `https://${accountId}.r2.cloudflarestorage.com` : "https://<ACCOUNT_ID>.r2.cloudflarestorage.com";
  const cors = JSON.stringify(makeR2CorsPolicy(window.location.origin), null, 2);
  const pendingLabel = l(
    `${sync.pending} ${sync.pending === 1 ? "cópia aguardando" : "cópias aguardando"} sincronização. O trabalho local continua salvo.`,
    `${sync.pending} ${sync.pending === 1 ? "copy" : "copies"} waiting to sync. Local work remains saved.`,
  );

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      setConnection(getR2ConnectionInfo());
      setRemoteProjects(null);
    };
    const unsubscribe = subscribeR2Connection(refresh);
    const unsubscribeSync = subscribeR2Sync(() => setSync(getR2SyncState()));
    void getR2Connection().then(value => {
      if (!mounted.current) return;
      const info = getR2ConnectionInfo();
      setConnection(info);
      if (value) setConfig(value.config);
      setRemember(info?.remembered || false);
    }).catch(() => {
      if (mounted.current) setError(l("Não foi possível ler a conexão R2 deste navegador. Seus projetos locais continuam disponíveis.", "Could not read this browser's R2 connection. Your local projects remain available."));
    }).finally(() => { if (mounted.current) setLoading(false); });
    const network = () => setOnline(navigator.onLine);
    window.addEventListener("online", network); window.addEventListener("offline", network);
    return () => { mounted.current = false; unsubscribe(); unsubscribeSync(); window.removeEventListener("online", network); window.removeEventListener("offline", network); };
  }, []);

  function describe(reason: unknown) {
    const code = typeof reason === "object" && reason !== null && "code" in reason ? String(reason.code) : "";
    const messages: Record<string, [string, string]> = {
      "r2-invalid-config": ["Confira o Account ID, as duas chaves S3 e o nome exato do bucket.", "Check the Account ID, both S3 keys, and the exact bucket name."],
      "r2-auth": ["O R2 recusou o acesso. Confira as chaves e a permissão Object Read & Write para este bucket.", "R2 denied access. Check the keys and Object Read & Write permission for this bucket."],
      "r2-network": ["Não foi possível acessar o R2. Confira a conexão e aplique a política CORS abaixo ao bucket.", "Could not reach R2. Check your connection and apply the CORS policy below to the bucket."],
      "r2-not-found": ["O bucket ou a cópia não foi encontrado. Confira a conta e o nome do bucket.", "The bucket or copy was not found. Check the account and bucket name."],
      "r2-storage": ["O navegador não conseguiu guardar a conexão. Tente sem lembrar as chaves.", "The browser could not save the connection. Try without remembering the keys."],
      "r2-conflict": ["A cópia no R2 mudou. Atualize a lista antes de tentar novamente.", "The R2 copy changed. Refresh the list before trying again."],
      "r2-runtime": ["Não foi possível iniciar a conexão segura com R2 neste navegador. Tente novamente; seus projetos locais continuam disponíveis.", "Could not start the secure R2 connection in this browser. Try again; your local projects remain available."],
      "r2-limit": ["Esta cópia excede o limite de tamanho da conexão R2. Os dados locais foram preservados.", "This copy exceeds the R2 connection's size limit. Local data was preserved."],
      "r2-disconnected": ["A conexão R2 foi encerrada. Conecte novamente para continuar.", "The R2 connection ended. Connect again to continue."],
    };
    return messages[code] ? l(...messages[code]) : l("Não foi possível concluir a operação no R2. Confira as chaves, as permissões do bucket e o CORS. Seus projetos locais não foram alterados.", "Could not complete the R2 operation. Check the keys, bucket permissions, and CORS. Your local projects were not changed.");
  }
  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setError(""); setMessage("");
    try { await action(); } catch (reason) { if (mounted.current) setError(describe(reason)); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  const update = (key: keyof R2Config, value: string) => {
    setConfig(previous => ({ ...previous, [key]: value })); setError(""); setMessage("");
  };
  const connect = () => run("connect", async () => {
    await connectR2(config, { remember });
    if (!mounted.current) return;
    setConnection(getR2ConnectionInfo());
    setMessage(l("Conexão verificada. O R2 está pronto para receber cópias adicionais dos projetos; os originais locais permanecem no lugar.", "Connection verified. R2 is ready for additional project copies; local originals stay in place."));
  });
  const test = () => run("test", async () => {
    const current = await getR2Connection();
    if (!current) throw new Error("No R2 connection");
    await testR2Connection(current.config);
    if (mounted.current) setMessage(l("Leitura e gravação verificadas no bucket conectado.", "Reading and writing verified in the connected bucket."));
  });
  const disconnect = () => run("disconnect", async () => {
    await disconnectR2();
    if (!mounted.current) return;
    setConnection(null); setConfig(blankConfig()); setRemember(false); setRemoteProjects(null);
    setMessage(l("R2 desconectado. Os projetos locais e as cópias no bucket foram preservados.", "R2 disconnected. Local projects and copies in the bucket were preserved."));
  });
  const list = () => run("list", async () => {
    const projects = await listR2Projects();
    if (mounted.current) setRemoteProjects(projects);
  });
  const restore = (project: R2RemoteProject) => run("restore", async () => {
    await restoreR2ProjectAsCopy(project);
    if (mounted.current) setMessage(l(`“${project.name}” recuperado como uma nova cópia na biblioteca. Os projetos existentes foram preservados.`, `“${project.name}” recovered as a new copy in the library. Existing projects were preserved.`));
  });
  const copyCors = async () => {
    try { await navigator.clipboard.writeText(cors); setCopied(true); }
    catch { setCopied(false); setMessage(l("Selecione e copie o JSON da política CORS abaixo.", "Select and copy the CORS policy JSON below.")); }
  };

  return <section className={`web-settings-section web-r2-panel${embedded ? " is-embedded" : ""}`} aria-labelledby={`${prefix}-title`}>
    <header>
      <span className="web-tile-icon"><Icon name="server" /></span>
      <h2 id={`${prefix}-title`}>{l("Seu armazenamento R2", "Your R2 storage")}</h2>
      <p>{l("Uma cópia adicional na sua conta Cloudflare.", "An additional copy in your Cloudflare account.")}</p>
    </header>
    <div className="web-setting-fields web-r2-content">
      <div className="web-r2-local-note"><Icon name="shield" /><p>{l("Seus projetos continuam salvos localmente, na pasta ou neste navegador. Conectar o R2 não move, apaga ou substitui arquivos existentes. Se ficar offline, a cópia na nuvem fica pendente e o salvamento local continua.", "Your projects stay saved locally, in their folder or this browser. Connecting R2 does not move, delete, or replace existing files. Offline cloud copies stay pending while local saving continues.")}</p></div>
      <p className="web-r2-direct-note">{l("A conexão vai diretamente deste navegador ao seu bucket R2. As chaves e os arquivos não passam por um servidor do Kodety.", "The connection goes directly from this browser to your R2 bucket. Keys and files do not pass through a Kodety server.")}</p>
      <p className="web-r2-direct-note">{l("HTML sincroniza após salvar. No WordPress, as cópias são enviadas ao voltar à biblioteca.", "HTML syncs after saving. WordPress copies are sent when you return to the library.")}</p>
      {loading ? <p role="status"><Spinner /> {l("Verificando conexão salva…", "Checking saved connection…")}</p> : connection && <div className="web-r2-connection" role="status">
        <div><strong><Icon name="check" />{l("Bucket conectado", "Bucket connected")}</strong><span>{connection.bucket}</span></div>
        <dl><div><dt>Account ID</dt><dd>{connection.accountId}</dd></div><div><dt>{l("Conectado em", "Connected on")}</dt><dd>{new Date(connection.connectedAt).toLocaleString(language === "en" ? "en-US" : "pt-BR")}</dd></div><div><dt>{l("Chaves", "Keys")}</dt><dd>{connection.remembered ? l("Lembradas neste navegador", "Remembered in this browser") : l("Somente nesta aba", "Only in this tab")}</dd></div></dl>
        <div className="web-r2-actions"><button type="button" className="web-button" disabled={!!busy || !online} onClick={() => void test()}>{busy === "test" && <Spinner />}{l("Testar conexão", "Test connection")}</button><button type="button" className="web-button" disabled={!!busy} onClick={() => void disconnect()}>{l("Desconectar R2", "Disconnect R2")}</button></div>
      </div>}
      {!online && <Notice tone="info">{l("Você está offline. A sincronização com R2 aguarda conexão. Continue trabalhando nos projetos locais.", "You are offline. R2 synchronization is waiting for a connection. Keep working on local projects.")}</Notice>}
      {connection && <p className="web-r2-sync-status" role="status">{sync.active ? l("Enviando cópia adicional ao R2…", "Sending an additional copy to R2…") : sync.pending > 0 ? pendingLabel : sync.lastSyncedAt ? l(`Última cópia no R2: ${new Date(sync.lastSyncedAt).toLocaleString("pt-BR")}.`, `Last R2 copy: ${new Date(sync.lastSyncedAt).toLocaleString("en-US")}.`) : l("O R2 receberá cópias ao salvar seus projetos. Conectar não transfere nem modifica projetos existentes.", "R2 will receive copies as you save your projects. Connecting does not transfer or change existing projects.")}{sync.error && <span>{l(" A última tentativa não terminou. A cópia na nuvem continua pendente; os arquivos locais permanecem disponíveis.", " The last attempt did not finish. The cloud copy remains pending; local files stay available.")}</span>}</p>}
      {connection && (sync.pending > 0 || sync.error) && <div className="web-r2-actions"><button type="button" className="web-button" disabled={!!busy || sync.active || !online} onClick={() => void run("sync", async () => { await retryR2Sync(); })}>{busy === "sync" && <Spinner />}{l("Tentar sincronizar novamente", "Retry synchronization")}</button></div>}
      <details className="web-r2-guide">
        <DisclosureSummary>{l("Como preparar meu bucket e as chaves", "How to prepare my bucket and keys")}</DisclosureSummary>
        <ol>
          <li>{l("Na Cloudflare, abra R2 Object Storage e crie um bucket privado para seus projetos.", "In Cloudflare, open R2 Object Storage and create a private bucket for your projects.")}</li>
          <li>{l("Em R2 → Manage API Tokens, crie credenciais com Object Read & Write e limite o acesso a esse bucket.", "In R2 → Manage API Tokens, create credentials with Object Read & Write and limit access to this bucket.")}</li>
          <li>{l("Copie Account ID, Access Key ID e Secret Access Key. Informe o nome exato do bucket abaixo; não é preciso permitir listar todos os buckets.", "Copy the Account ID, Access Key ID, and Secret Access Key. Enter the exact bucket name below; permission to list all buckets is not needed.")}</li>
          <li>{l("No bucket, abra Settings → CORS Policy e salve o JSON abaixo. Ele permite o endereço deste WebApp.", "In the bucket, open Settings → CORS Policy and save the JSON below. It allows this WebApp's address.")}</li>
        </ol>
        <div className="web-r2-links"><a href="https://dash.cloudflare.com/?to=/:account/r2/overview" target="_blank" rel="noreferrer">{l("Abrir Cloudflare R2", "Open Cloudflare R2")} <Icon name="external" /></a><a href="https://developers.cloudflare.com/r2/api/tokens/" target="_blank" rel="noreferrer">{l("Guia de chaves R2", "R2 key guide")} <Icon name="external" /></a><a href="https://developers.cloudflare.com/r2/buckets/cors/" target="_blank" rel="noreferrer">{l("Guia de CORS", "CORS guide")} <Icon name="external" /></a></div>
        <label className="web-r2-cors"><span>{l("Política CORS para este WebApp", "CORS policy for this WebApp")}</span><textarea readOnly value={cors} rows={12} spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
        <button type="button" className="web-button" onClick={() => void copyCors()}>{copied ? l("CORS copiado", "CORS copied") : l("Copiar política CORS", "Copy CORS policy")}</button>
      </details>
      <fieldset className="web-r2-fields" disabled={loading || !!busy}>
        <legend className="web-r2-legend">{connection ? l("Atualizar conexão", "Update connection") : l("Conectar meu bucket", "Connect my bucket")}</legend>
        <label htmlFor={`${prefix}-account`}><span>Account ID</span><input id={`${prefix}-account`} value={config.accountId} onChange={event => update("accountId", event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={l("ID de 32 caracteres da conta", "32-character account ID")} /></label>
        <label htmlFor={`${prefix}-bucket`}><span>{l("Nome do bucket", "Bucket name")}</span><input id={`${prefix}-bucket`} value={config.bucket} onChange={event => update("bucket", event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="meus-projetos" /></label>
        <label htmlFor={`${prefix}-access`}><span>Access Key ID</span><input id={`${prefix}-access`} type="password" value={config.accessKeyId} onChange={event => update("accessKeyId", event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} data-1p-ignore data-lpignore="true" /></label>
        <label htmlFor={`${prefix}-secret`}><span>Secret Access Key</span><input id={`${prefix}-secret`} type="password" value={config.secretAccessKey} onChange={event => update("secretAccessKey", event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} data-1p-ignore data-lpignore="true" /></label>
        <dl className="web-r2-endpoint"><div><dt>Endpoint S3</dt><dd>{endpoint}</dd></div><div><dt>{l("Região", "Region")}</dt><dd>auto</dd></div></dl>
        <label className="web-r2-remember" htmlFor={`${prefix}-remember`}><input id={`${prefix}-remember`} type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>{l("Lembrar chaves neste navegador", "Remember keys in this browser")}<small>{l("Opcional. Marcado, as chaves ficam neste perfil até desconectar. Sem marcar, elas duram somente até fechar esta aba.", "Optional. When checked, keys stay in this profile until you disconnect. Otherwise, they last only until this tab closes.")}</small></span></label>
        <div className="web-r2-actions web-r2-wide"><button type="button" className="web-button is-primary" disabled={!online || !config.accountId.trim() || !config.bucket.trim() || !config.accessKeyId.trim() || !config.secretAccessKey.trim()} onClick={() => void connect()}>{busy === "connect" && <Spinner />}{connection ? l("Testar e atualizar conexão", "Test and update connection") : l("Testar e conectar", "Test and connect")}</button><small>{l("A conexão só é salva após verificar leitura e gravação no bucket.", "The connection is saved only after reading and writing in the bucket are verified.")}</small></div>
      </fieldset>
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="info">{message}</Notice>}
      {connection && <section className="web-r2-recovery" aria-label={l("Recuperar projetos do R2", "Recover projects from R2")}>
        <div><h3>{l("Projetos guardados no R2", "Projects saved in R2")}</h3><p>{l("Recupere uma nova cópia na biblioteca. Nenhum projeto local será sobrescrito.", "Recover a new copy in the library. No local project will be overwritten.")}</p></div>
        <button type="button" className="web-button" disabled={!!busy || !online} onClick={() => void list()}>{busy === "list" && <Spinner />}{remoteProjects ? l("Atualizar lista", "Refresh list") : l("Recuperar projetos do R2", "Recover projects from R2")}</button>
        {remoteProjects?.length === 0 && <p>{l("Nenhuma cópia de projeto foi encontrada neste bucket.", "No project copies were found in this bucket.")}</p>}
        {remoteProjects && remoteProjects.length > 0 && <ul>{remoteProjects.map(project => <li key={`${project.id}:${project.revision}`}><div><strong>{project.name}</strong><small>{project.mode === "wordpress" ? "WordPress" : "HTML"} · {new Date(project.updatedAt).toLocaleString(language === "en" ? "en-US" : "pt-BR")}</small></div><button type="button" className="web-button" disabled={!!busy || !online} onClick={() => void restore(project)}>{l("Recuperar como cópia", "Recover as a copy")}</button></li>)}</ul>}
      </section>}
    </div>
  </section>;
}
