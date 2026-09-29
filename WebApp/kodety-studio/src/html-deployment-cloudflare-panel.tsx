import { DeploymentField, DeploymentSelect } from "./html-deployment-field";
import { DisclosureSummary } from "../../../components/ui/disclosure-summary";
import { useId, useRef, useState } from "react";
import { Icon, Notice, Spinner } from "./ui";
import { HtmlDeploymentTabs } from "./html-deployment-tabs";
import { HtmlDeploymentError, type HtmlDeploymentFile } from "./html-deployment-github";
import { assertHtmlDirectFilesUnchanged, createHtmlCloudflareUpload, reviewHtmlDirectDeployment, type HtmlDirectReview } from "./html-deployment-direct";
import {
  createHtmlCloudflareProject, getHtmlCloudflareDeployment, listHtmlCloudflareProjects,
  publishHtmlCloudflareDeployment, validateHtmlCloudflareReview,
  type HtmlCloudflareConfig, type HtmlCloudflareDeployment, type HtmlCloudflareProject,
} from "./html-deployment-cloudflare";

export function HtmlCloudflareDeploymentPanel({ getFiles, language, onBusy }: {
  getFiles(): Promise<HtmlDeploymentFile[]>;
  language: string;
  onBusy(busy: boolean): void;
}) {
  const l = (pt: string, en: string) => language === "en" ? en : pt;
  const modeTabsId = useId();
  const [mode, setMode] = useState<"direct" | "zip">("direct");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [projects, setProjects] = useState<HtmlCloudflareProject[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [project, setProject] = useState<HtmlCloudflareProject | null>(null);
  const [branch, setBranch] = useState("");
  const [newName, setNewName] = useState("");
  const [newBranch, setNewBranch] = useState("main");
  const [review, setReview] = useState<HtmlDirectReview | null>(null);
  const [reviewConfig, setReviewConfig] = useState<HtmlCloudflareConfig | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [deployment, setDeployment] = useState<HtmlCloudflareDeployment | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const lock = useRef(false);
  const production = !!project && branch.trim() === project.productionBranch;

  function resetReview() {
    setReview(null); setReviewConfig(null); setAccepted(false);
    setError(""); setDeployment(null); setDownloaded(false);
  }
  function resetAccount() {
    setProjects([]); setNextPage(null); setLoaded(false); setProject(null); setBranch(""); resetReview();
  }
  function describe(error: unknown) {
    const messages: Record<string, [string, string]> = {
      "cloudflare-token": ["Informe um token válido da Cloudflare. Se expirou, crie outro.", "Enter a valid Cloudflare API token. Create another if it expired."],
      "cloudflare-permission": ["A Cloudflare recusou o acesso. Confira o ID da conta e a permissão Conta → Cloudflare Pages → Editar do token.", "Cloudflare denied access. Check the account ID and the token's Account → Cloudflare Pages → Edit permission."],
      "cloudflare-config": ["Confira o ID da conta, o nome do projeto e a branch. O nome do projeto deve usar letras minúsculas, números e hífens.", "Check the account ID, project name, and branch. Project names must use lowercase letters, numbers, and hyphens."],
      "cloudflare-config-size": ["Reduza os arquivos _headers e _redirects para até 1 MiB cada antes de publicar.", "Reduce _headers and _redirects to at most 1 MiB each before publishing."],
      "cloudflare-network": ["Não foi possível conectar à Cloudflare. Confira a conexão e tente novamente.", "Could not connect to Cloudflare. Check your connection and try again."],
      "cloudflare-unavailable": ["Este host não oferece o deploy direto. Use o servidor Node/Docker atualizado do Studio ou a opção Enviar ZIP manualmente.", "This host does not offer direct deployment. Use the updated Studio Node/Docker server or Upload ZIP manually."],
      "cloudflare-uncertain": ["A resposta foi interrompida. Confira os projetos e deploys na Cloudflare antes de tentar novamente; a solicitação pode ter sido aceita.", "The response was interrupted. Check Cloudflare projects and deployments before retrying; the request may have been accepted."],
      "cloudflare-request": ["A Cloudflare recusou a solicitação. Confira o projeto, as permissões e os limites no painel da Cloudflare.", "Cloudflare rejected the request. Check the project, permissions, and limits in the Cloudflare dashboard."],
      "cloudflare-project-exists": ["Já existe um projeto com esse nome. Carregue os projetos para selecioná-lo ou escolha outro nome.", "A project with this name already exists. Load projects to select it, or choose another name."],
      "cloudflare-rate-limit": ["O limite de solicitações da Cloudflare foi atingido. Aguarde antes de tentar novamente.", "Cloudflare's request limit was reached. Wait before trying again."],
      "cloudflare-functions": ["Este fluxo publica sites estáticos. Para Pages Functions ou Workers, use Wrangler ou a integração com Git.", "This workflow publishes static sites. For Pages Functions or Workers, use Wrangler or Git integration."],
      "local-changed": ["O projeto mudou desde a revisão. Revise os arquivos novamente.", "The project changed after review. Review the files again."],
      "direct-index": ["O site precisa de index.html na raiz para publicação estática.", "The site needs index.html at its root for static publishing."],
      "too-large": ["Use até 1.000 arquivos, 25 MiB por arquivo e 50 MiB no total nesta publicação.", "Use up to 1,000 files, 25 MiB per file, and 50 MiB total in this publisher."],
      "private-path": ["A exportação contém arquivos privados ou internos. Remova credenciais e metadados da publicação.", "The export contains private or internal files. Remove credentials and metadata from publishing."],
    };
    const match = error instanceof HtmlDeploymentError ? messages[error.code] : undefined;
    return match ? l(...match) : l("Não foi possível preparar a publicação. Confira os arquivos e tente novamente.", "Could not prepare publishing. Check the files and try again.");
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try { await action(); } catch (error) { setError(describe(error)); }
    finally { lock.current = false; setBusy(false); onBusy(false); setProgress(""); }
  }
  async function connect(more = false) {
    await run(async () => {
      const page = await listHtmlCloudflareProjects(token, accountId, more ? nextPage || 1 : 1);
      setProjects(previous => [...new Map([...(more ? previous : []), ...page.items].map(item => [item.name, item])).values()]);
      setNextPage(page.next); setLoaded(true);
      if (!more) { setProject(null); setBranch(""); resetReview(); }
    });
  }
  async function createProject() {
    await run(async () => {
      const created = await createHtmlCloudflareProject(token, accountId, newName, newBranch);
      setProjects(previous => [...previous.filter(item => item.name !== created.name), created]);
      setProject(created); setBranch(created.productionBranch); setNewName(""); resetReview();
    });
  }
  async function prepare() {
    resetReview();
    await run(async () => {
      const next = await reviewHtmlDirectDeployment(await getFiles());
      if (mode === "direct") validateHtmlCloudflareReview(next);
      if (mode === "direct" && project) setReviewConfig(Object.freeze({ accountId: accountId.trim(), project, branch: branch.trim() }));
      setReview(next);
    });
  }
  async function publish() {
    if (!review || !accepted) return;
    await run(async () => {
      try {
        await assertHtmlDirectFilesUnchanged(review, await getFiles());
        if (mode === "zip") {
          const blob = await createHtmlCloudflareUpload(review);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a"); link.href = url; link.download = "kodety-cloudflare-site.zip";
          document.body.appendChild(link); link.click(); link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
          setDownloaded(true);
        } else if (reviewConfig) {
          setProgress(l("Enviando site ao Cloudflare Pages…", "Uploading site to Cloudflare Pages…"));
          setDeployment(await publishHtmlCloudflareDeployment(review, reviewConfig, token, fetch, (done, total) => setProgress(l(`Enviando arquivos: ${done}/${total}…`, `Uploading files: ${done}/${total}…`))));
        }
      } finally { setAccepted(false); setReview(null); }
    });
  }
  const stateLabel = (state: HtmlCloudflareDeployment["state"]) => ({ READY: l("Publicado", "Ready"), ERROR: l("Falhou", "Failed"), CANCELED: l("Cancelado", "Canceled"), QUEUED: l("Na fila", "Queued"), BUILDING: l("Preparando", "Building") })[state];

  return <section className="web-html-deployment-body" aria-label="Cloudflare Pages">
    <p className="web-html-deployment-intro">{l("Publique seu site no Cloudflare Pages sem sair do Studio. Conecte sua conta, escolha um projeto e envie a versão revisada.", "Publish your site to Cloudflare Pages from Studio. Connect your account, choose a project, and deploy the reviewed version.")}</p>
    <HtmlDeploymentTabs
      id={modeTabsId}
      label={l("Modo Cloudflare", "Cloudflare mode")}
      className="web-html-deployment-modes"
      value={mode}
      disabled={busy}
      items={[{ id: "direct", label: l("Publicar direto", "Direct deployment") }, { id: "zip", label: l("Enviar ZIP manualmente", "Upload ZIP manually") }] as const}
      onChange={next => {
        if (next === mode) return;
        setMode(next);
        if (next === "zip") { setToken(""); resetAccount(); }
        else resetReview();
      }}
    />
    <div id={`${modeTabsId}-panel`} role="tabpanel" aria-labelledby={`${modeTabsId}-${mode}`} tabIndex={0} className="web-html-deployment-body web-html-deployment-tabpanel">
    {mode === "direct" ? <>
      <section className="web-html-deployment-section" aria-label={l("Conta Cloudflare", "Cloudflare account")}>
        <h3>{l("Conta Cloudflare", "Cloudflare account")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-fields">
          <DeploymentField label={l("Token da Cloudflare", "Cloudflare API token")} className="web-html-deployment-wide"><input type="password" value={token} placeholder={l("Cole seu token de API", "Paste your API token")} autoComplete="off" data-1p-ignore data-lpignore="true" onChange={event => { setToken(event.target.value); resetAccount(); }} /><small>{l("Usado somente nesta janela. O servidor do Studio encaminha as solicitações à Cloudflare sem salvar o token.", "Used only in this dialog. The Studio server forwards requests to Cloudflare without saving the token.")}</small></DeploymentField>
          <DeploymentField label={l("ID da conta", "Account ID")} className="web-html-deployment-wide"><input value={accountId} placeholder={l("Os 32 caracteres do Account ID", "The 32-character Account ID")} autoCapitalize="none" spellCheck={false} onChange={event => { setAccountId(event.target.value); resetAccount(); }} /><small>{l("Copie o Account ID da sua conta no painel da Cloudflare.", "Copy your Account ID from the Cloudflare dashboard.")}</small></DeploymentField>
          <div className="web-html-deployment-auth-actions web-html-deployment-wide"><button type="button" className="web-button" disabled={!token.trim() || !accountId.trim()} onClick={() => void connect()}>{l("Carregar projetos", "Load projects")}</button><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{l("Criar token", "Create token")} <Icon name="external" /></a></div>
        </fieldset>
        <details><DisclosureSummary>{l("Como configurar o token", "How to configure the token")}</DisclosureSummary>
          <ol className="web-html-deployment-steps"><li><span><strong>{l("Crie um token personalizado", "Create a custom token")}</strong><small>{l("Em API Tokens, escolha Criar token → Token personalizado.", "In API Tokens, choose Create Token → Custom token.")}</small></span></li><li><span><strong>{l("Permita editar o Cloudflare Pages", "Allow editing Cloudflare Pages")}</strong><small>{l("Em Permissões, selecione Conta → Cloudflare Pages → Editar. Em Recursos da conta, inclua a conta onde o site será publicado.", "Under Permissions, select Account → Cloudflare Pages → Edit. Under Account Resources, include the account where the site will be published.")}</small></span></li><li><span><strong>{l("Copie o token e o Account ID", "Copy the token and Account ID")}</strong><small>{l("Cole os dois campos acima e carregue seus projetos. O token não vai para os arquivos do site.", "Paste both fields above and load your projects. The token is not included in site files.")}</small></span></li></ol>
          <a href="https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/" target="_blank" rel="noreferrer">{l("Guia da Cloudflare", "Cloudflare guide")} <Icon name="external" /></a>
        </details>
      </section>
      <section className="web-html-deployment-section" aria-label={l("Destino da publicação", "Publishing destination")}>
        <h3>{l("Destino da publicação", "Publishing destination")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-fields">
          <DeploymentField label={l("Projeto", "Project")}><DeploymentSelect value={project?.name || ""} onValueChange={value => { const selected = projects.find(item => item.name === value) || null; setProject(selected); setBranch(selected?.productionBranch || ""); resetReview(); }}><option value="">{l("Selecione um projeto", "Select a project")}</option>{projects.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</DeploymentSelect></DeploymentField>
          <DeploymentField label={l("Branch do deploy", "Deployment branch")}><input value={branch} disabled={!project} autoCapitalize="none" spellCheck={false} placeholder={project?.productionBranch || "main"} onChange={event => { setBranch(event.target.value); resetReview(); }} /><small>{project ? production ? l("Produção: substitui a versão atual do site.", "Production: replaces the current site version.") : l(`Prévia: a produção usa ${project.productionBranch}.`, `Preview: production uses ${project.productionBranch}.`) : l("A branch de produção é preenchida ao selecionar o projeto.", "The production branch is filled when you select a project.")}</small></DeploymentField>
          {nextPage !== null && <button type="button" className="web-button" onClick={() => void connect(true)}>{l("Carregar mais projetos", "Load more projects")}</button>}
        </fieldset>
        {loaded && projects.length === 0 && <p className="web-html-deployment-help">{l("Nenhum projeto encontrado nesta conta. Crie um abaixo.", "No projects found in this account. Create one below.")}</p>}
        <details><DisclosureSummary>{l("Criar um projeto no Cloudflare Pages", "Create a Cloudflare Pages project")}</DisclosureSummary>
          <fieldset disabled={busy} className="web-html-deployment-fields">
            <DeploymentField label={l("Nome do novo projeto", "New project name")}><input value={newName} placeholder="meu-site" autoCapitalize="none" spellCheck={false} onChange={event => setNewName(event.target.value)} /></DeploymentField>
            <DeploymentField label={l("Branch de produção", "Production branch")}><input value={newBranch} autoCapitalize="none" spellCheck={false} onChange={event => setNewBranch(event.target.value)} /></DeploymentField>
            <p className="web-html-deployment-help web-html-deployment-wide">{l("Cria um projeto Direct Upload na sua conta. Os arquivos serão enviados após a revisão. Projetos Direct Upload não podem mudar para integração com Git.", "Creates a Direct Upload project in your account. Files are uploaded after review. Direct Upload projects cannot switch to Git integration.")}</p>
            <button type="button" className="web-button" disabled={!token.trim() || !accountId.trim() || !newName.trim() || !newBranch.trim()} onClick={() => void createProject()}>{l("Criar projeto", "Create project")}</button>
          </fieldset>
        </details>
      </section>
    </> : <section className="web-html-deployment-section">
      <h3>{l("Publicar com ZIP pelo painel", "Publish a ZIP from the dashboard")}</h3>
      <ol className="web-html-deployment-steps"><li><span><strong>{l("Revise e baixe os arquivos", "Review and download your files")}</strong><small>{l("Use Revisar arquivos e baixe o ZIP abaixo. Não é preciso informar um token.", "Use Review files and download the ZIP below. No token is needed.")}</small></span></li><li><span><strong>{l("Envie ao Cloudflare Pages", "Upload to Cloudflare Pages")}</strong><small>{l("No painel, crie um projeto Pages com Direct Upload ou abra um existente. Envie o ZIP e confirme o deploy.", "In the dashboard, create a Pages Direct Upload project or open an existing one. Upload the ZIP and confirm the deployment.")}</small></span></li></ol>
      <p className="web-html-deployment-help">{l("O download não publica o site. A publicação só acontece quando você confirma o deploy na Cloudflare.", "Downloading does not publish the site. Publishing happens when you confirm deployment in Cloudflare.")}</p>
      <a href="https://developers.cloudflare.com/pages/get-started/direct-upload/" target="_blank" rel="noreferrer">{l("Guia de upload manual", "Manual upload guide")} <Icon name="external" /></a>
    </section>}
    <div className="web-html-deployment-links"><a href="https://dash.cloudflare.com/?to=/:account/pages" target="_blank" rel="noreferrer">{l("Abrir Cloudflare Pages", "Open Cloudflare Pages")} <Icon name="external" /></a></div>
    {review && <section className="web-html-deployment-review">
      <h3>{l("Confira esta versão", "Review this version")}</h3>
      <p>{mode === "direct" ? `${reviewConfig?.project.name} · ${production ? l("Produção", "Production") : l("Prévia", "Preview")} · ${reviewConfig?.branch}` : "Cloudflare Pages · ZIP"}</p>
      {mode === "direct" && <p>{l("Conta", "Account")}: {reviewConfig?.accountId}</p>}
      <p>{review.files.length} {l("arquivos", "files")} · {(review.bytes / 1024 / 1024).toFixed(2)} MiB</p>
      <ul className="web-html-deployment-file-list">{review.files.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul>
      <label className="web-html-deployment-accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>{mode === "zip" ? l("Conferi os arquivos. Quero baixar esta versão para enviar ao Cloudflare.", "I reviewed the files. Download this version to upload to Cloudflare.") : production ? l("Conferi a conta, o projeto e os arquivos. Quero publicar em produção, substituindo a versão atual do site.", "I reviewed the account, project, and files. Publish to production, replacing the current site version.") : l("Conferi a conta, o projeto e os arquivos. Quero criar um deploy de prévia no Cloudflare Pages.", "I reviewed the account, project, and files. Create a preview deployment on Cloudflare Pages.")}</span></label>
    </section>}
    {error && <Notice>{error}</Notice>}
    {progress && <Notice tone="info">{progress}</Notice>}
    {downloaded && <Notice tone="info">{l("ZIP preparado. Envie o arquivo no painel do Cloudflare e confirme o deploy lá.", "ZIP prepared. Upload the file in Cloudflare and confirm deployment there.")}</Notice>}
    {deployment && <Notice tone={deployment.state === "READY" ? "success" : ["ERROR", "CANCELED"].includes(deployment.state) ? undefined : "info"}>
      <p>Cloudflare Pages · {stateLabel(deployment.state)}</p>
      <a href={deployment.url} target="_blank" rel="noreferrer">{l("Abrir endereço do deploy", "Open deployment URL")} <Icon name="external" /></a>
      {!["READY", "ERROR", "CANCELED"].includes(deployment.state) && <button type="button" className="web-button" disabled={busy} onClick={() => void run(async () => { if (reviewConfig) setDeployment(await getHtmlCloudflareDeployment(deployment.id, reviewConfig, token)); })}>{l("Atualizar status", "Refresh status")}</button>}
    </Notice>}
    <div className="web-html-deployment-actions">
      <button type="button" className="web-button" disabled={busy || mode === "direct" && (!token.trim() || !accountId.trim() || !project || !branch.trim())} onClick={() => void prepare()}>{busy && <Spinner />}{l("Revisar arquivos", "Review files")}</button>
      <button type="button" className="web-button is-primary" disabled={busy || !review || !accepted} onClick={() => void publish()}>{mode === "direct" ? l("Publicar no Cloudflare Pages", "Deploy to Cloudflare Pages") : l("Baixar ZIP para Cloudflare", "Download Cloudflare ZIP")}</button>
    </div>
    </div>
  </section>;
}
