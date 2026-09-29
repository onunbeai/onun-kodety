import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StudioProjectMode } from "./project-library";
import type { StudioLanguage } from "../../../ChromeExtension/kodety-studio/src/storage";
import { Icon, type IconName } from "./ui";
import { OfflineAvailability } from "./offline";
import "../../../Wordpress/kodety/admin/onboarding.css";
import "./onboarding.css";

function Glyph({ name }: { name: IconName }) {
  return (
    <span className="kodety-dashboard-icon" aria-hidden="true">
      <Icon name={name} />
    </span>
  );
}
function Detail({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="web-studio-onboarding-detail">
      <Glyph name={icon} />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Onboarding({
  language,
  onLanguageChange,
  onComplete,
  onClose,
}: {
  language: StudioLanguage;
  initialMode: StudioProjectMode;
  onLanguageChange(language: StudioLanguage): void;
  onComplete(mode: StudioProjectMode): void;
  onClose(mode: StudioProjectMode): void;
}) {
  const l = (pt: string, en: string) => (language === "en" ? en : pt);
  const [step, setStep] = useState(0);
  const mode = "html";
  const [saveError, setSaveError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const steps = [
    {
      title: l("Crie seu site", "Create your site"),
      description: l("Seu espaço de criação", "Your creative workspace"),
    },
    {
      title: l("Armazenamento e backup", "Storage and backup"),
      description: l("Seu trabalho protegido", "Keep your work safe"),
    },
    {
      title: l("Publicação", "Publishing"),
      description: l("Leve seu site ao ar", "Take your site live"),
    },
  ];

  // Reuse the actual WordPress onboarding stylesheet and document tokens.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const hadHtml = html.classList.contains("kodety-onboarding-document");
    const hadBody = body.classList.contains("kodety-onboarding-page");
    html.classList.add("kodety-onboarding-document");
    body.classList.add("kodety-onboarding-page");
    return () => {
      if (!hadHtml) html.classList.remove("kodety-onboarding-document");
      if (!hadBody) body.classList.remove("kodety-onboarding-page");
    };
  }, []);
  useEffect(() => {
    screenRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const goToStep = (next: number) => {
    setSaveError(false);
    setStep(next);
  };
  const advance = () => {
    if (step < 2) return goToStep(step + 1);
    try {
      onComplete(mode);
    } catch {
      setSaveError(true);
    }
  };
  return (
    <div className="web-studio-onboarding" ref={screenRef}>
      <div className="kodety-onboarding is-enhanced">
        <aside className="kodety-onboarding__sidebar">
          <div className="kodety-onboarding__brand">
            <span style={{ fontSize: 21, fontWeight: 650, letterSpacing: "-0.6px" }}>Onun Kodety</span>
            <span>
              {l(
                "Seu próximo projeto começa aqui.",
                "Your next project starts here.",
              )}
            </span>
          </div>
          <nav
            className="kodety-onboarding__navigation"
            aria-label={l("Etapas da configuração", "Setup steps")}
          >
            <ol>
              {steps.map((item, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className={
                      "kodety-onboarding__nav-step" +
                      (index < step ? " is-complete" : "")
                    }
                    aria-current={index === step ? "step" : undefined}
                    aria-controls="web-onboarding-panel"
                    onClick={() => goToStep(index)}
                  >
                    <span
                      className="kodety-onboarding__step-number"
                      aria-hidden="true"
                    >
                      <span>{index + 1}</span>
                      <Glyph name="check" />
                    </span>
                    <span className="kodety-onboarding__step-copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="kodety-onboarding__sidebar-note">
            <Glyph name="settings" />
            <p>
              {l(
                "Você pode ajustar estas preferências depois, nas configurações.",
                "You can adjust these preferences later in Settings.",
              )}
            </p>
          </div>
          <div className="kodety-onboarding__site">
            <Glyph name="globe" />
            <span>Onun Kodety · Web App</span>
          </div>
        </aside>
        <main className="kodety-onboarding__main">
          <header className="kodety-onboarding__masthead">
            <span>{l("Configure seu espaço", "Set up your workspace")}</span>
            <div className="kodety-onboarding__progress">
              <span aria-live="polite">
                {l(`Etapa ${step + 1} de 3`, `Step ${step + 1} of 3`)}
              </span>
              <progress
                max="3"
                value={step + 1}
                aria-label={l("Progresso da configuração", "Setup progress")}
              />
            </div>
          </header>
          <div className="kodety-onboarding__form">
            <div className="kodety-onboarding__steps">
              <section
                id="web-onboarding-panel"
                className="kodety-onboarding__step is-active"
                key={step}
                aria-labelledby="web-onboarding-step-title"
              >
                <p className="kodety-onboarding__eyebrow">
                  {step === 0
                    ? l(
                        "Bem-vindo ao Onun Kodety",
                        "Welcome to Onun Kodety",
                      )
                    : step === 1
                      ? l("Seus projetos no dispositivo", "Your projects on this device")
                      : l("Pronto para publicar", "Ready to publish")}
                </p>
                <h1
                  id="web-onboarding-step-title"
                  tabIndex={-1}
                  ref={headingRef}
                >
                  {step === 0
                    ? l(
                        "Seu próximo site começa aqui.",
                        "Your next site starts here.",
                      )
                    : step === 1
                      ? l(
                          "Um lugar para o seu projeto.",
                          "A place for your project.",
                        )
                      : l(
                          "Seu site, onde você quiser.",
                          "Your site, wherever you want.",
                        )}
                </h1>
                <p className="kodety-onboarding__intro">
                  {step === 0
                    ? l(
                        "Crie e edite seu site no Kodety. Publique na Vercel, no Cloudflare Pages ou no WordPress, envie o código ao GitHub ou leve seus arquivos para outra hospedagem.",
                        "Build and edit your site in Kodety. Publish to Vercel, Cloudflare Pages or WordPress, push your code to GitHub, or take your files to another host.",
                      )
                    : step === 1
                      ? l(
                          "Salve seus projetos no navegador ou em uma pasta do computador. Exporte backups ZIP para continuar em outro dispositivo.",
                          "Save projects in your browser or a folder on your computer. Export ZIP backups to continue on another device.",
                        )
                      : l(
                          "Escolha onde colocar seu site no ar. O botão Publicar reúne todas as opções e orienta você em cada etapa.",
                          "Choose where to put your site online. The Publish button brings all the options together and guides you through each step.",
                        )}
                </p>
                {step === 0 && (
                  <>
                    <fieldset className="web-studio-onboarding-language">
                      <legend>
                        {l("Idioma da interface", "Interface language")}
                      </legend>
                      <div className="web-studio-language-tabs">
                        {([{ value: "en", label: "English" }, { value: "pt", label: "Português" }] as const).map(option => (
                          <label key={option.value}>
                            <input type="radio" name="web-onboarding-language" value={option.value} checked={language === option.value} onChange={() => onLanguageChange(option.value)} />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="web-studio-onboarding-after-choice">
                      <p className="web-studio-onboarding-library-note">
                        <Glyph name="folder" />
                        <span>
                          {l(
                            "Seus projetos ficam na mesma biblioteca, prontos para continuar de onde você parou.",
                            "Your projects stay in one library, ready to continue where you left off.",
                          )}
                        </span>
                      </p>
                      <OfflineAvailability language={language} />
                    </div>
                  </>
                )}
                {step === 1 && (
                  <>
                    <div className="web-studio-onboarding-details">
                      <Detail
                        icon="folder"
                        title={l(
                          "Seus arquivos",
                          "Your files",
                        )}
                      >
                        {l(
                          "Crie quantos projetos quiser, dentro do espaço disponível no seu dispositivo. Seus arquivos permanecem sob seu controle.",
                          "Create as many projects as your device can store. Your files remain under your control.",
                        )}
                      </Detail>
                      <Detail
                        icon="shield"
                        title={l(
                          "Uma cópia fora do navegador",
                          "A copy outside the browser",
                        )}
                      >
                        {l(
                          "Baixe o backup ZIP editável para guardar o projeto no seu dispositivo ou continuar em outro navegador.",
                          "Download an editable ZIP backup to keep your project on your device or continue in another browser.",
                        )}
                      </Detail>
                    </div>
                    <p className="kodety-onboarding__security-note">
                      <Glyph name="help" />
                      <span>
                        {l(
                          "Limpar os dados do navegador pode apagar os projetos salvos nele. Guarde cópias ZIP fora do navegador.",
                          "Clearing browser data can erase projects stored there. Keep ZIP copies outside the browser.",
                        )}
                      </span>
                    </p>
                  </>
                )}
                {step === 2 && (
                  <>
                    <div className="web-studio-onboarding-details">
                      <Detail
                        icon="globe"
                        title={l("Publicar online", "Publish online")}
                      >
                        {l(
                          "Publique na Vercel ou no Cloudflare Pages, envie seu código ao GitHub ou baixe os arquivos para subir por FTP na sua hospedagem.",
                          "Publish to Vercel or Cloudflare Pages, push your code to GitHub, or download the files to upload to your host via FTP.",
                        )}
                      </Detail>
                      <Detail
                        icon="server"
                        title="WordPress"
                      >
                        {l(
                          "Baixe o ZIP completo do projeto, instale o WordPress e o plugin Kodety na sua hospedagem e importe o ZIP no Kodety para continuar editando e publicar.",
                          "Download your complete project ZIP, install WordPress and the Kodety plugin on your hosting, and import the ZIP into Kodety to keep editing and publish.",
                        )}
                        <a className="web-studio-onboarding-plugin" href="./assets/kodety.zip" download target="_blank" rel="noopener noreferrer">{l("Baixar plugin Kodety", "Download Kodety plugin")} <Icon name="external" /></a>
                      </Detail>
                    </div>
                    <p className="kodety-onboarding__security-note">
                      <Glyph name="help" />
                      <span>
                        {l(
                          "O backup ZIP editável permite continuar seu projeto no Kodety. O ZIP do site contém os arquivos prontos para publicação.",
                          "The editable ZIP backup lets you continue your project in Kodety. The site ZIP contains the files ready to publish.",
                        )}
                      </span>
                    </p>
                  </>
                )}
                {saveError && (
                  <p className="kodety-onboarding__error-summary" role="alert">
                    {l(
                      "Não foi possível salvar a conclusão. Você pode abrir a biblioteca e continuar.",
                      "Could not save completion. You can open the library and continue.",
                    )}
                  </p>
                )}
              </section>
            </div>
            <footer className="kodety-onboarding__footer">
              <button
                type="button"
                className="kodety-onboarding__back"
                onClick={() =>
                  step === 0 || saveError ? onClose(mode) : goToStep(step - 1)
                }
              >
                {step > 0 && !saveError && (
                  <span className="web-studio-onboarding-back-icon">
                    <Glyph name="arrow" />
                  </span>
                )}
                <span>
                  {step === 0 || saveError
                    ? l("Abrir biblioteca", "Open library")
                    : l("Voltar", "Back")}
                </span>
              </button>
              <p>
                {step === 0
                  ? l("Crie com seus próprios arquivos.", "Create with your own files.")
                  : l(
                      "Seu projeto permanece privado até publicar.",
                      "Your project stays private until you publish.",
                    )}
              </p>
              <button
                type="button"
                className="kodety-onboarding__primary"
                onClick={advance}
              >
                <span>
                  {step === 2
                    ? l("Começar novo projeto", "Start a new project")
                    : l("Continuar", "Continue")}
                </span>
                <Glyph name="arrow" />
              </button>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
