import { DeploymentField, DeploymentSelect } from "./html-deployment-field";
import { DisclosureSummary } from "../../../components/ui/disclosure-summary";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Icon, Notice, Spinner } from "./ui";
import {
  assertDeploymentFilesUnchanged,
  connectHtmlGitHub,
  HtmlDeploymentError,
  listHtmlGitHubBranches,
  listHtmlGitHubRepositories,
  loadDeploymentConfig,
  publishHtmlDeployment,
  reviewHtmlDeployment,
  saveDeploymentConfig,
  type HtmlDeploymentConfig,
  type HtmlDeploymentFile,
  type HtmlDeploymentReview,
  type HtmlGitHubAccount,
  type HtmlGitHubRepository,
} from "./html-deployment-github";
import { HtmlDirectDeploymentPanel } from "./html-deployment-direct-panel";
import { HtmlCloudflareDeploymentPanel } from "./html-deployment-cloudflare-panel";
import { HtmlFtpDeploymentPanel } from "./html-deployment-ftp-panel";
import { HtmlWordPressDeploymentPanel } from "./html-deployment-wordpress-panel";
import { HtmlDeploymentBrand } from "./html-deployment-brand";
import { HtmlDeploymentTabs } from "./html-deployment-tabs";
import { cancelHtmlGitHubLogin, htmlGitHubLoginAvailable, pollHtmlGitHubLogin, startHtmlGitHubLogin, type HtmlGitHubAuthSession } from "./html-deployment-auth";
import "./html-deployment.css";

export type { HtmlDeploymentFile } from "./html-deployment-github";
export type HtmlDeploymentWorkflow = "github" | "vercel" | "cloudflare" | "ftp" | "wordpress";

export function HtmlDeploymentPanel({ projectId, getFiles, onExportWordPress, onClose, language = "pt", initialWorkflow = "cloudflare" }: {
  projectId: string;
  /** Flush the editor to its mandatory project folder and return only public site files. */
  getFiles(): Promise<HtmlDeploymentFile[]>;
  /** Save current edits and download the complete, editable project ZIP. */
  onExportWordPress(): Promise<void>;
  onClose(): void;
  language?: string;
  initialWorkflow?: HtmlDeploymentWorkflow;
}) {
  const l = (pt: string, en: string) => language === "en" ? en : pt;
  const workflowTabsId = useId();
  const [config, setConfig] = useState(() => loadDeploymentConfig(projectId, { getItem: (key) => window.localStorage.getItem(key) }));
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("Publish HTML site with Kodety");
  const [review, setReview] = useState<HtmlDeploymentReview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [published, setPublished] = useState<{ sha: string; url: string } | null>(null);
  const [workflow, setWorkflow] = useState<HtmlDeploymentWorkflow>(initialWorkflow);
  const [account, setAccount] = useState<HtmlGitHubAccount | null>(null);
  const [repositories, setRepositories] = useState<HtmlGitHubRepository[]>([]);
  const [nextRepositoryPage, setNextRepositoryPage] = useState<number | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [nextBranchPage, setNextBranchPage] = useState<number | null>(null);
  const [loginAvailable, setLoginAvailable] = useState(false);
  const [login, setLogin] = useState<HtmlGitHubAuthSession | null>(null);

  useEffect(() => {
    if (workflow !== "github") return;
    const controller = new AbortController();
    void htmlGitHubLoginAvailable(controller.signal).then(available => { if (!controller.signal.aborted) setLoginAvailable(available); });
    return () => controller.abort();
  }, [workflow]);

  useEffect(() => {
    if (!login) return;
    const controller = new AbortController();
    let timer = 0;
    let interval = login.interval;
    const poll = async () => {
      if (Date.now() >= login.expiresAt) { setError(l("O código expirou. Entre com GitHub novamente.", "The code expired. Sign in with GitHub again.")); setLogin(null); return; }
      try {
        const result = await pollHtmlGitHubLogin(login.sessionId, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === "complete") {
          setLogin(null); setToken(result.accessToken);
          await connect(result.accessToken);
          return;
        }
        interval = Math.max(interval, result.interval || (result.status === "slow_down" ? interval + 5 : interval));
        timer = window.setTimeout(() => void poll(), interval * 1000);
      } catch (error) { if (!controller.signal.aborted) { setError(describeError(error)); setLogin(null); } }
    };
    timer = window.setTimeout(() => void poll(), interval * 1000);
    return () => { controller.abort(); window.clearTimeout(timer); void cancelHtmlGitHubLogin(login.sessionId); };
  }, [login?.sessionId]);

  const describeError = (error: unknown): string => {
    const messages: Record<string, [string, string]> = {
      "invalid-owner": ["Informe o nome da conta ou organização no GitHub.", "Enter the GitHub account or organization name."],
      "invalid-repository": ["Informe apenas o nome do repositório, sem URL ou extensão .git.", "Enter only the repository name, without a URL or .git suffix."],
      "invalid-branch": ["Informe uma branch existente, como main.", "Enter an existing branch, such as main."],
      "invalid-path": ["Use caminhos relativos válidos, sem barras nas extremidades ou ..", "Use valid relative paths, without leading/trailing slashes or .."],
      "private-path": ["O projeto inclui arquivos privados ou internos que não podem ser publicados. Remova .env, credenciais e diretórios internos da exportação.", "The project includes private or internal files that cannot be published. Remove .env, credentials, and internal directories from the export."],
      "reserved-path": ["Remova .kodety-deployment.json da exportação do site. O Studio mantém esse arquivo para acompanhar publicações.", "Remove .kodety-deployment.json from the site export. Studio maintains this file to track publications."],
      "ownership-manifest": ["O histórico de arquivos publicados não pôde ser validado. Confira .kodety-deployment.json no GitHub ou escolha outra pasta de destino.", "The published file history could not be validated. Check .kodety-deployment.json on GitHub or choose another destination folder."],
      "owned-remote-changed": ["Um arquivo publicado anteriormente foi alterado ou removido diretamente no GitHub. Concilie essas mudanças pelo Git antes de publicar novamente, ou escolha outra pasta de destino.", "A previously published file was modified or removed directly on GitHub. Reconcile those changes through Git before publishing again, or choose another destination folder."],
      "missing-token": ["Informe um token do GitHub com permissão Contents de leitura e escrita.", "Enter a GitHub token with Contents read and write permission."],
      authentication: ["O token é inválido ou expirou. Gere um novo token no GitHub.", "The token is invalid or expired. Create a new GitHub token."],
      permission: ["O GitHub recusou o acesso. Confira as permissões Contents, a aprovação da organização e os limites da API.", "GitHub denied access. Check Contents permissions, organization approval, and API limits."],
      "missing-branch": ["Repositório ou branch não encontrado. Use um repositório acessível já inicializado com README e uma branch existente.", "Repository or branch not found. Use an accessible repository initialized with a README and an existing branch."],
      "branch-history-unavailable": ["O GitHub não conseguiu consultar o histórico desta branch (409). Se o repositório acabou de ser criado, adicione um README e faça o primeiro commit no GitHub. Depois selecione a branch criada e revise novamente. Nenhum arquivo foi enviado nesta revisão.", "GitHub could not read this branch's history (409). If the repository was just created, add a README and make the first commit on GitHub. Then select the new branch and review again. This review did not upload any files."],
      "invalid-github-query": ["O GitHub não aceitou a consulta (422). Confira a conta, o repositório e a branch. Essa falha aconteceu antes do envio do commit.", "GitHub did not accept the query (422). Check the account, repository, and branch. This failure happened before submitting a commit."],
      rejected: ["O GitHub não conseguiu criar o commit. Essa resposta não confirma um problema no token: pode envolver regras do repositório ou validação dos arquivos. O detalhe está na resposta da requisição graphql, em Network → Response → errors.", "GitHub could not create the commit. This response does not confirm a token problem: repository rules or file validation may be involved. Details are in the graphql request response under Network → Response → errors."],
      "remote-changed": ["A branch foi alterada desde a revisão. Revise novamente para conferir as mudanças remotas antes de publicar.", "The branch changed since review. Review again to check the remote changes before publishing."],
      "local-changed": ["O projeto mudou desde a revisão. Revise os arquivos atuais antes de publicar.", "The project changed since review. Review the current files before publishing."],
      "publish-uncertain": ["A resposta do GitHub foi interrompida. Confira o repositório e revise novamente antes de tentar publicar.", "The GitHub response was interrupted. Check the repository and review again before attempting to publish."],
      "rate-limit": ["O limite de acesso ao GitHub foi atingido. Aguarde e tente novamente.", "The GitHub API limit was reached. Wait before trying again."],
      "too-large": ["O envio pelo navegador suporta até 1.000 arquivos, 25 MiB por arquivo e 50 MiB no total. Para projetos maiores, use Git na pasta do projeto.", "Browser publishing supports up to 1,000 files, 25 MiB per file, and 50 MiB total. Use Git in the project folder for larger projects."],
      "truncated-tree": ["O repositório é grande demais para uma revisão completa pelo navegador. Use Git na pasta do projeto.", "The repository is too large to review completely in the browser. Use Git in the project folder."],
      "path-conflict": ["Um arquivo do projeto conflita com uma pasta, link, executável ou submódulo. Escolha outra pasta de destino no repositório.", "A project file conflicts with a directory, link, executable, or submodule. Choose another destination folder in the repository."],
      "duplicate-path": ["A exportação contém caminhos repetidos. Corrija os arquivos do projeto antes de publicar.", "The export includes duplicate paths. Fix the project files before publishing."],
      empty: ["Não há arquivos do site para publicar.", "There are no site files to publish."],
      unchanged: ["Os arquivos revisados já estão no GitHub.", "The reviewed files are already on GitHub."],
      network: ["Não foi possível conectar ao GitHub. Confira a conexão e tente novamente.", "Could not connect to GitHub. Check the connection and try again."],
      "github-login": ["Não foi possível concluir a entrada com GitHub. Tente novamente ou conecte com um token.", "Could not complete GitHub sign-in. Try again or connect with a token."],
      "github-login-expired": ["O código de entrada expirou. Entre com GitHub novamente.", "The sign-in code expired. Sign in with GitHub again."],
    };
    const match = error instanceof HtmlDeploymentError ? messages[error.code] : undefined;
    return match ? l(...match) : l("Não foi possível preparar ou confirmar a publicação. Confira a pasta do projeto e o repositório antes de tentar novamente.", "Could not prepare or confirm publishing. Check the project folder and repository before trying again.");
  };

  const updateConfig = <Key extends keyof HtmlDeploymentConfig>(key: Key, value: HtmlDeploymentConfig[Key]) => {
    setConfig((previous) => ({ ...previous, [key]: value }));
    if (key === "owner" || key === "repository") { setBranches([]); setNextBranchPage(null); }
    setReview(null);
    setAccepted(false);
    setPublished(null);
    setError("");
  };

  function disconnect() {
    setLogin(null); setToken(""); setAccount(null); setRepositories([]); setBranches([]); setNextRepositoryPage(null); setNextBranchPage(null); setReview(null); setAccepted(false); setPublished(null); setError("");
  }

  async function connect(credential = token, more = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const identity = more && account ? account : await connectHtmlGitHub(credential);
      const page = await listHtmlGitHubRepositories(credential, more ? nextRepositoryPage || 1 : 1);
      setAccount(identity);
      setRepositories(previous => [...new Map([...(more ? previous : []), ...page.items].map(item => [item.id, item])).values()]);
      setNextRepositoryPage(page.nextPage);
    } catch (error) { setError(describeError(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function selectRepository(fullName: string) {
    const repository = repositories.find(item => item.fullName === fullName);
    if (!repository || lock.current) return;
    const next = { ...config, owner: repository.owner, repository: repository.name, branch: repository.defaultBranch };
    setConfig(next); setReview(null); setAccepted(false); setPublished(null); setBranches([]); setNextBranchPage(null);
    await loadBranches(next);
  }

  async function loadBranches(next = config, more = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const page = await listHtmlGitHubBranches(next, token, more ? nextBranchPage || 1 : 1);
      setBranches(previous => [...new Set([...(more ? previous : []), ...page.items])]); setNextBranchPage(page.nextPage);
    } catch (error) { setError(describeError(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function signIn() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { setLogin(await startHtmlGitHubLogin()); }
    catch (error) { setError(describeError(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPublished(null);
    setReview(null);
    setAccepted(false);
    setProgress(l("Salvando arquivos e comparando com o GitHub…", "Saving files and comparing with GitHub…"));
    try {
      const next = await reviewHtmlDeployment(config, await getFiles(), token);
      setReview(next);
      setConfig({ ...next.config });
      try {
        saveDeploymentConfig(projectId, next.config, window.localStorage);
        setStorageWarning(false);
      } catch { setStorageWarning(true); }
    } catch (error) { setError(describeError(error)); }
    finally { lock.current = false; setBusy(false); setProgress(""); }
  }

  async function publish() {
    if (!review || !accepted || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setProgress(l("Conferindo os arquivos e enviando o commit…", "Checking files and sending the commit…"));
    try {
      await assertDeploymentFilesUnchanged(review, await getFiles());
      const result = await publishHtmlDeployment(review, token, message);
      setPublished(result);
      setReview(null);
    } catch (error) { setError(describeError(error)); setReview(null); }
    finally {
      // Keep credentials only while the user is reviewing; clear after every publish attempt.
      setToken("");
      setAccount(null); setRepositories([]); setBranches([]); setNextRepositoryPage(null); setNextBranchPage(null);
      setAccepted(false);
      lock.current = false;
      setBusy(false);
      setProgress("");
    }
  }

  return <Dialog title={l("Publicar HTML", "Publish HTML")} description={l("Escolha como colocar seu site no ar.", "Choose how to publish your site.")} className="web-html-deployment" busy={busy} onClose={onClose} closeLabel={l("Fechar publicação", "Close publishing")}>
    <div className="web-form-body web-html-deployment-body">
      <HtmlDeploymentTabs
        id={workflowTabsId}
        label={l("Forma de publicação", "Publishing workflow")}
        className="web-html-deployment-workflows"
        value={workflow}
        disabled={busy}
        onChange={item => { if (workflow !== item) { disconnect(); setWorkflow(item); } }}
        items={([
          { id: "cloudflare", label: "Cloudflare Pages" },
          { id: "github", label: "GitHub" },
          { id: "vercel", label: "Vercel" },
          { id: "ftp", label: "FTP / SFTP" },
          { id: "wordpress", label: "WordPress" },
        ] as const).map(item => ({ ...item, icon: <HtmlDeploymentBrand provider={item.id} /> }))}
      />
      <div id={`${workflowTabsId}-panel`} role="tabpanel" aria-labelledby={`${workflowTabsId}-${workflow}`} tabIndex={0} className="web-html-deployment-body web-html-deployment-tabpanel">
      {workflow === "wordpress" ? <HtmlWordPressDeploymentPanel onExportWordPress={onExportWordPress} language={language} onBusy={setBusy} /> : workflow === "ftp" ? <HtmlFtpDeploymentPanel getFiles={getFiles} language={language} onBusy={setBusy} /> : workflow === "cloudflare" ? <HtmlCloudflareDeploymentPanel getFiles={getFiles} language={language} onBusy={setBusy} /> : workflow === "vercel" ? <HtmlDirectDeploymentPanel getFiles={getFiles} language={language} onBusy={setBusy} /> : <>
      <p className="web-html-deployment-intro">{l("Envie uma versão do seu site ao GitHub. Se o repositório estiver conectado à Vercel ou ao Cloudflare, cada envio também pode atualizar o site online.", "Push a version of your site to GitHub. When the repository is connected to Vercel or Cloudflare, each push can also update your live site.")}</p>
      <section className="web-html-deployment-section" aria-label={l("Conta GitHub", "GitHub account")}>
        <h3>{l("Conta GitHub", "GitHub account")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-auth">
          {account ? <div className="web-html-deployment-account"><span className="web-html-deployment-account-mark"><Icon name="check" /></span><div><strong>{account.login}</strong><small>{l("Conta conectada nesta publicação", "Account connected for this publication")}</small></div><button type="button" className="web-button" onClick={disconnect}>{l("Desconectar", "Disconnect")}</button></div> : loginAvailable && !login ? <div className="web-html-deployment-auth-actions"><button type="button" className="web-button is-primary" onClick={() => void signIn()}>{l("Entrar com GitHub", "Sign in with GitHub")}<Icon name="external" /></button><span>{l("Autorize sua conta para escolher um repositório.", "Authorize your account to choose a repository.")}</span></div> : null}
          {login && <div className="web-html-deployment-login"><p>{l("Digite este código na página do GitHub para conectar sua conta.", "Enter this code on the GitHub page to connect your account.")}</p><div className="web-html-deployment-login-code"><strong className="web-html-deployment-user-code">{login.userCode}</strong><a href={login.verificationUri} target="_blank" rel="noreferrer">{l("Continuar no GitHub", "Continue on GitHub")} <Icon name="external" /></a></div><div className="web-html-deployment-auth-actions"><span role="status"><Spinner />{l("Aguardando sua autorização…", "Waiting for your authorization…")}</span><button type="button" className="web-button" onClick={() => setLogin(null)}>{l("Cancelar", "Cancel")}</button></div></div>}
          {!account && !login && <details className="web-html-deployment-token" open={!loginAvailable}><DisclosureSummary>{loginAvailable ? l("Usar um token de acesso", "Use an access token") : l("Conectar com token do GitHub", "Connect with a GitHub token")}</DisclosureSummary><div className="web-html-deployment-token-content"><DeploymentField label={l("Token do GitHub", "GitHub token")}><input type="password" value={token} onChange={(event) => { setToken(event.target.value); setReview(null); setAccepted(false); }} autoComplete="off" autoCapitalize="none" spellCheck={false} data-1p-ignore data-lpignore="true" placeholder={l("Cole seu token de acesso", "Paste your access token")} /><small>{l("Usado apenas nesta janela e enviado diretamente ao GitHub. Não é salvo no projeto nem no navegador.", "Used only in this dialog and sent directly to GitHub. It is not saved in the project or browser storage.")}</small></DeploymentField><div className="web-html-deployment-auth-actions"><button type="button" className="web-button" disabled={!token.trim()} onClick={() => void connect()}>{l("Conectar conta", "Connect account")}</button><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{l("Criar token", "Create token")} <Icon name="external" /></a></div><p className="web-html-deployment-help">{l("Ao criar o token, escolha este repositório e permita Contents: leitura e escrita.", "When creating the token, select this repository and allow Contents: read and write.")}</p></div></details>}
        </fieldset>
      </section>
      {(account || token.trim() || review) && <section className="web-html-deployment-section" aria-label={l("Destino da publicação", "Publishing destination")}>
        <h3>{l("Destino da publicação", "Publishing destination")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-fields">
          {account && <DeploymentField label={l("Repositório", "Repository")} className="web-html-deployment-wide"><DeploymentSelect value={repositories.some(item => item.fullName === `${config.owner}/${config.repository}`) ? `${config.owner}/${config.repository}` : ""} onValueChange={value => void selectRepository(value)}><option value="">{l("Selecione um repositório", "Select a repository")}</option>{repositories.map(item => <option key={item.id} value={item.fullName}>{item.fullName}{item.private ? l(" (privado)", " (private)") : ""}</option>)}</DeploymentSelect><small>{l("Repositórios autorizados nos quais você pode enviar código.", "Authorized repositories where you can push code.")}</small></DeploymentField>}
          {account && nextRepositoryPage !== null && <button type="button" className="web-button web-html-deployment-wide" onClick={() => void connect(token, true)}>{l("Carregar mais repositórios", "Load more repositories")}</button>}
          {!account && <><DeploymentField label={l("Conta ou organização", "Account or organization")}><input value={config.owner} onChange={(event) => updateConfig("owner", event.target.value)} placeholder="your-account" autoCapitalize="none" spellCheck={false} /></DeploymentField><DeploymentField label={l("Repositório", "Repository")}><input value={config.repository} onChange={(event) => updateConfig("repository", event.target.value)} placeholder="my-website" autoCapitalize="none" spellCheck={false} /></DeploymentField></>}
          <DeploymentField label="Branch">{branches.length ? <DeploymentSelect value={config.branch} onValueChange={value => updateConfig("branch", value)}>{!branches.includes(config.branch) && <option value={config.branch}>{config.branch}</option>}{branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</DeploymentSelect> : <input value={config.branch} onChange={(event) => updateConfig("branch", event.target.value)} placeholder="main" autoCapitalize="none" spellCheck={false} />}{nextBranchPage !== null && <button type="button" className="web-button" onClick={() => void loadBranches(config, true)}>{l("Mais branches", "More branches")}</button>}</DeploymentField>
          <DeploymentField label={l("Pasta no repositório", "Repository folder")}><input value={config.directory} onChange={(event) => updateConfig("directory", event.target.value)} placeholder={l("Raiz do repositório", "Repository root")} autoCapitalize="none" spellCheck={false} /></DeploymentField>
          <DeploymentField label={l("Hospedagem conectada ao GitHub", "Hosting connected to GitHub")} className="web-html-deployment-wide"><DeploymentSelect value={config.provider} onValueChange={value => updateConfig("provider", value as HtmlDeploymentConfig["provider"])}><option value="github">{l("Somente enviar o código", "Push code only")}</option><option value="vercel">Vercel</option><option value="cloudflare">Cloudflare Pages</option></DeploymentSelect></DeploymentField>
        </fieldset>
        <div className="web-html-deployment-links"><a href="https://github.com/new" target="_blank" rel="noreferrer">{l("Criar repositório", "Create repository")} <Icon name="external" /></a><span>{l("Use um repositório iniciado com README e uma branch existente.", "Use a repository initialized with a README and an existing branch.")}</span></div>
      </section>}
      {(account || token.trim() || review) && config.provider !== "github" && <div className="web-html-deployment-provider">
        <strong>{l("Conecte o repositório uma vez", "Connect the repository once")}</strong>
        <p>{config.provider === "vercel" ? l("Na Vercel, importe o repositório GitHub. Para HTML estático, selecione Other, deixe o comando de build vazio e use a pasta de destino como Root Directory. Configure esta branch como produção se desejar deploys de produção.", "In Vercel, import the GitHub repository. For static HTML, select Other, leave the build command empty, and use the destination folder as Root Directory. Set this branch as production if you want production deployments.") : l("No Cloudflare Pages, conecte o repositório GitHub, selecione esta branch, use exit 0 como comando de build e a pasta de destino (ou . para a raiz) como diretório de saída.", "In Cloudflare Pages, connect the GitHub repository, select this branch, use exit 0 as the build command and the destination folder (or . for root) as the output directory.")}</p>
        <p>{l("Depois de conectar, novos commits acionam o deploy conforme as regras do provedor. O Studio confirma o envio ao GitHub; acompanhe o resultado do deploy no provedor.", "Once connected, new commits trigger deployment according to the provider settings. Studio confirms the GitHub push; track deployment results with the provider.")}</p>
        <a href={config.provider === "vercel" ? "https://vercel.com/new" : "https://dash.cloudflare.com/?to=/:account/pages/new"} target="_blank" rel="noreferrer">{l("Abrir configuração", "Open setup")} <Icon name="external" /></a>
        <a href={config.provider === "vercel" ? "https://vercel.com/docs/git/vercel-for-github" : "https://developers.cloudflare.com/pages/get-started/git-integration/"} target="_blank" rel="noreferrer">{l("Guia oficial", "Official guide")} <Icon name="external" /></a>
      </div>}
      {review && <section className="web-html-deployment-review" aria-label={l("Revisão da publicação", "Publication review")}>
        <h3>{l("Confira esta versão", "Review this version")}</h3>
        <p><strong>{review.config.owner}/{review.config.repository}</strong> · {review.config.branch} · {review.config.directory || "/"} · {review.head.slice(0, 7)}</p>
        <p>{l(`${review.additions.length} novos · ${review.updates.length} alterados · ${review.deletions.length} removidos · ${review.unchanged.length} sem alterações`, `${review.additions.length} new · ${review.updates.length} modified · ${review.deletions.length} removed · ${review.unchanged.length} unchanged`)}</p>
        {(review.additions.length + review.updates.length + review.deletions.length > 0) && <ul className="web-html-deployment-file-list">{review.additions.map((path) => <li key={path} data-change="add"><span>{l("Novo", "New")}</span><code>{path}</code></li>)}{review.updates.map((path) => <li key={path} data-change="update"><span>{l("Substituir", "Replace")}</span><code>{path}</code></li>)}{review.deletions.map((path) => <li key={path} data-change="delete"><span>{l("Excluir", "Delete")}</span><code>{path}</code></li>)}</ul>}
        <p>{l(`Somente arquivos publicados antes pelo Studio e agora removidos do projeto podem ser excluídos. ${review.preserved.length} arquivo(s) de fora dessas publicações serão mantidos na pasta de destino.`, `Only files previously published by Studio and now removed from the project can be deleted. ${review.preserved.length} file(s) outside those publications will remain in the destination folder.`)}</p>
        {review.preserved.length > 0 && <details><DisclosureSummary>{l("Ver arquivos mantidos", "View preserved files")}</DisclosureSummary><ul className="web-html-deployment-file-list">{review.preserved.map((path) => <li key={path}><code>{path}</code></li>)}</ul></details>}
        {review.additions.length + review.updates.length + review.deletions.length > 0 ? <>
          <DeploymentField label={l("Mensagem do commit", "Commit message")}><input value={message} maxLength={200} disabled={busy} onChange={(event) => setMessage(event.target.value)} /></DeploymentField>
          <label className="web-html-deployment-accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={(event) => setAccepted(event.target.checked)} /><span>{l("Conferi o destino e os arquivos. Quero enviar esta versão, incluindo as substituições e exclusões indicadas, acionando os deploys conectados.", "I reviewed the destination and files. Publish this version, including the listed replacements and deletions, triggering connected deployments.")}</span></label>
        </> : <Notice tone="success">{l("Os arquivos do site já estão atualizados no GitHub.", "Site files are already up to date on GitHub.")}</Notice>}
      </section>}
      {storageWarning && <Notice tone="info">{l("A configuração não pôde ser guardada neste navegador; você pode continuar a publicação.", "The configuration could not be saved in this browser; you can still publish.")}</Notice>}
      {error && <Notice>{error}</Notice>}
      {progress && <Notice tone="info">{progress}</Notice>}
      {published && <Notice tone="success"><p>{l("Código enviado ao GitHub. Confira o deploy na hospedagem conectada.", "Code pushed to GitHub. Check deployment with the connected hosting provider.")}</p><a href={published.url} target="_blank" rel="noreferrer">{l("Ver commit", "View commit")} {published.sha.slice(0, 7)} <Icon name="external" /></a></Notice>}
      </>}
      </div>
    </div>
    {workflow === "github" && <footer className="web-dialog-footer">
      <button type="button" className="web-button" onClick={onClose} disabled={busy}>{l("Fechar", "Close")}</button>
      {(account || token.trim() || review) && <><button type="button" className="web-button" onClick={() => void prepare()} disabled={busy || !token.trim() || !!login}>{busy && <Spinner />}{l("Revisar arquivos", "Review files")}</button>
      <button type="button" className="web-button is-primary" onClick={() => void publish()} disabled={busy || !review || !accepted || !token.trim() || !message.trim() || !!login}><Icon name="globe" />{l("Publicar no GitHub", "Publish to GitHub")}</button></>}
    </footer>}
  </Dialog>;
}
