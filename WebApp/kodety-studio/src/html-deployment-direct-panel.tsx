import { DeploymentField, DeploymentSelect } from "./html-deployment-field";
import { useRef, useState } from "react";
import { Icon, Notice, Spinner } from "./ui";
import { HtmlDeploymentError, type HtmlDeploymentFile } from "./html-deployment-github";
import { assertHtmlDirectFilesUnchanged, getHtmlVercelDeployment, listHtmlVercelProjects, publishHtmlVercelDeployment, reviewHtmlDirectDeployment, type HtmlDirectReview, type HtmlVercelConfig, type HtmlVercelDeployment, type HtmlVercelProject } from "./html-deployment-direct";

export function HtmlDirectDeploymentPanel({ getFiles, language, onBusy }: { getFiles(): Promise<HtmlDeploymentFile[]>; language: string; onBusy(busy: boolean): void }) {
  const l = (pt: string, en: string) => language === "en" ? en : pt;
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projects, setProjects] = useState<HtmlVercelProject[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [project, setProject] = useState<HtmlVercelProject | null>(null);
  const [target, setTarget] = useState<"preview" | "production">("preview");
  const [review, setReview] = useState<HtmlDirectReview | null>(null);
  const [reviewConfig, setReviewConfig] = useState<HtmlVercelConfig | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [deployment, setDeployment] = useState<HtmlVercelDeployment | null>(null);
  const lock = useRef(false);

  function resetReview() { setReview(null); setReviewConfig(null); setAccepted(false); setError(""); setDeployment(null); }
  function describe(error: unknown) {
    const code = error instanceof HtmlDeploymentError ? error.code : "";
    const messages: Record<string, [string, string]> = {
      "vercel-token": ["O token da Vercel está ausente, é inválido ou expirou.", "The Vercel token is missing, invalid, or expired."],
      "vercel-permission": ["A Vercel recusou o acesso. Confira a equipe e as permissões do token.", "Vercel denied access. Check the team and token permissions."],
      "vercel-config": ["Selecione um projeto e confira o ID da equipe na Vercel.", "Select a project and check the Vercel team ID."],
      "vercel-network": ["Não foi possível conectar à Vercel. Confira a conexão e as restrições do navegador.", "Could not connect to Vercel. Check your connection and browser restrictions."],
      "vercel-uncertain": ["A resposta foi interrompida. Confira os deploys na Vercel antes de tentar novamente; o envio pode ter sido aceito.", "The response was interrupted. Check Vercel deployments before retrying; the request may have been accepted."],
      "vercel-request": ["A Vercel recusou a solicitação. Confira o projeto, os limites e as permissões no painel da Vercel.", "Vercel rejected the request. Check the project, limits, and permissions in the Vercel dashboard."],
      "local-changed": ["O projeto mudou desde a revisão. Revise os arquivos novamente.", "The project changed after review. Review the files again."],
      "direct-index": ["O site precisa de index.html na raiz para publicação estática.", "The site needs index.html at its root for static publishing."],
      "too-large": ["Use até 1.000 arquivos, 25 MiB por arquivo e 50 MiB no total nesta publicação.", "Use up to 1,000 files, 25 MiB per file, and 50 MiB total in this publisher."],
      "private-path": ["A exportação contém arquivos privados ou internos. Remova credenciais e metadados da publicação.", "The export contains private or internal files. Remove credentials and metadata from publishing."],
    };
    return messages[code] ? l(...messages[code]) : l("Não foi possível preparar a publicação. Confira os arquivos exportados e tente novamente.", "Could not prepare publishing. Check the exported files and try again.");
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError("");
    try { await action(); } catch (error) { setError(describe(error)); }
    finally { lock.current = false; setBusy(false); onBusy(false); setProgress(""); }
  }
  async function connect(more = false) {
    await run(async () => {
      const page = await listHtmlVercelProjects(token, teamId, more ? nextPage : null);
      setProjects(previous => [...new Map([...(more ? previous : []), ...page.items].map(item => [item.id, item])).values()]);
      setNextPage(page.next);
    });
  }
  async function prepare() {
    resetReview();
    await run(async () => {
      const files = await getFiles();
      const next = await reviewHtmlDirectDeployment(files);
      setReview(next);
      if (project) setReviewConfig(Object.freeze({ project, teamId, target }));
    });
  }
  async function publish() {
    if (!review || !accepted) return;
    await run(async () => {
      try {
        await assertHtmlDirectFilesUnchanged(review, await getFiles());
        if (reviewConfig) {
          const result = await publishHtmlVercelDeployment(review, reviewConfig, token, fetch, (done, total) => setProgress(l(`Enviando arquivos: ${done}/${total}…`, `Uploading files: ${done}/${total}…`)));
          setDeployment(result);
        }
      } finally { setAccepted(false); setReview(null); }
    });
  }
  const stateLabel = (state: string) => ({ READY: l("Publicado", "Ready"), ERROR: l("Falhou", "Failed"), CANCELED: l("Cancelado", "Canceled"), QUEUED: l("Na fila", "Queued"), INITIALIZING: l("Iniciando", "Initializing"), BUILDING: l("Preparando", "Building") } as Record<string, string>)[state] || state;

  return <section className="web-html-deployment-body" aria-label={l("Deploy direto na Vercel", "Direct Vercel deployment")}>
      <p className="web-html-deployment-intro">{l("Publique seu site diretamente na Vercel. Conecte sua conta, escolha um projeto e envie uma prévia ou a versão de produção.", "Publish your site directly to Vercel. Connect your account, choose a project, and publish a preview or the production version.")}</p>
      <section className="web-html-deployment-section" aria-label={l("Conta Vercel", "Vercel account")}>
        <h3>{l("Conta Vercel", "Vercel account")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-fields">
          <DeploymentField label={l("Token da Vercel", "Vercel token")} className="web-html-deployment-wide"><input type="password" value={token} placeholder={l("Cole seu token de acesso", "Paste your access token")} autoComplete="off" data-1p-ignore data-lpignore="true" onChange={event => { setToken(event.target.value); setProjects([]); setProject(null); setNextPage(null); resetReview(); }} /><small>{l("Usado somente nesta janela e enviado diretamente à Vercel. Ao fechar, a conexão é encerrada.", "Used only in this dialog and sent directly to Vercel. Closing ends the connection.")}</small></DeploymentField>
          <DeploymentField label={l("ID da equipe (opcional)", "Team ID (optional)")} className="web-html-deployment-wide"><input value={teamId} placeholder="team_…" autoCapitalize="none" spellCheck={false} onChange={event => { setTeamId(event.target.value); setProjects([]); setProject(null); setNextPage(null); resetReview(); }} /></DeploymentField>
          <div className="web-html-deployment-auth-actions web-html-deployment-wide"><button type="button" className="web-button" disabled={!token.trim()} onClick={() => void connect()}>{l("Carregar meus projetos", "Load my projects")}</button><a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">{l("Criar token", "Create token")} <Icon name="external" /></a></div>
        </fieldset>
      </section>
      <section className="web-html-deployment-section" aria-label={l("Destino da publicação", "Publishing destination")}>
        <h3>{l("Destino da publicação", "Publishing destination")}</h3>
        <fieldset disabled={busy} className="web-html-deployment-fields">
          <DeploymentField label={l("Projeto", "Project")}><DeploymentSelect value={project?.id || ""} onValueChange={value => { setProject(projects.find(item => item.id === value) || null); resetReview(); }}><option value="">{l("Selecione um projeto", "Select a project")}</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</DeploymentSelect></DeploymentField>
          <DeploymentField label={l("Ambiente", "Environment")}><DeploymentSelect value={target} onValueChange={value => { setTarget(value as typeof target); resetReview(); }}><option value="preview">{l("Prévia", "Preview")}</option><option value="production">{l("Produção", "Production")}</option></DeploymentSelect></DeploymentField>
          {nextPage !== null && <button type="button" className="web-button" onClick={() => void connect(true)}>{l("Carregar mais projetos", "Load more projects")}</button>}
        </fieldset>
        <p className="web-html-deployment-help">{l("Use um projeto dedicado a este site. A publicação configura a raiz do site como saída, sem instalação de dependências ou comando de build.", "Use a project dedicated to this site. Publishing sets the site root as the output, with no dependency installation or build command.")}</p>
        <p className="web-html-deployment-links"><a href="https://vercel.com/new" target="_blank" rel="noreferrer">{l("Criar projeto na Vercel", "Create a Vercel project")} <Icon name="external" /></a></p>
      </section>
    {review && <section className="web-html-deployment-review">
      <h3>{l("Confira esta versão", "Review this version")}</h3>
      <p>{`${reviewConfig?.project.name} · ${target === "production" ? l("Produção", "Production") : l("Prévia", "Preview")} · ${teamId || l("Conta do token", "Token account")}`}</p>
      <p>{review.files.length} {l("arquivos", "files")} · {(review.bytes / 1024 / 1024).toFixed(2)} MiB</p>
      <ul className="web-html-deployment-file-list">{review.files.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul>
      <label className="web-html-deployment-accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>{target === "production" ? l("Conferi o projeto e os arquivos. Quero publicar esta versão em produção, substituindo a versão atual do site.", "I reviewed the project and files. Publish this version to production, replacing the current site version.") : l("Conferi o projeto e os arquivos. Quero criar um deploy de prévia na Vercel.", "I reviewed the project and files. Create a preview deployment on Vercel.")}</span></label>
    </section>}
    {error && <Notice>{error}</Notice>}
    {progress && <Notice tone="info">{progress}</Notice>}
    {deployment && <Notice tone={deployment.state === "READY" ? "success" : deployment.state === "ERROR" || deployment.state === "CANCELED" ? undefined : "info"}><p>Vercel · {stateLabel(deployment.state)}</p><a href={deployment.url} target="_blank" rel="noreferrer">{l("Abrir endereço do deploy", "Open deployment URL")} <Icon name="external" /></a>{!["READY", "ERROR", "CANCELED"].includes(deployment.state) && <button type="button" className="web-button" disabled={busy} onClick={() => void run(async () => { setDeployment(await getHtmlVercelDeployment(deployment.id, token, reviewConfig?.teamId || "")); })}>{l("Atualizar status", "Refresh status")}</button>}</Notice>}
    <div className="web-html-deployment-actions"><button type="button" className="web-button" disabled={busy || !token.trim() || !project} onClick={() => void prepare()}>{busy && <Spinner />}{l("Revisar arquivos", "Review files")}</button><button type="button" className="web-button is-primary" disabled={busy || !review || !accepted} onClick={() => void publish()}>{l("Publicar na Vercel", "Deploy to Vercel")}</button></div>
  </section>;
}
