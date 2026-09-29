import { useEffect, useRef, useState } from "react";
import type { StudioLanguage } from "../../../ChromeExtension/kodety-studio/src/storage";
import { Icon } from "./ui";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type OfflineStatus =
  "checking" | "preparing" | "ready" | "error" | "development";

// The entry screen and each library mount this control separately. Browsers
// normally emit the install offer once, so retain it while navigating Studio.
let pendingInstallPrompt: InstallPrompt | null = null;

export function OfflineAvailability({
  language,
}: {
  language: StudioLanguage;
}) {
  const l = (pt: string, en: string) => (language === "en" ? en : pt);
  const [status, setStatus] = useState<OfflineStatus>(
    import.meta.env.DEV ? "development" : "checking",
  );
  const [progress, setProgress] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    () => pendingInstallPrompt,
  );
  const checkOffline = useRef<(prepare?: boolean) => Promise<void>>(
    async () => {},
  );
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches,
  );
  const [installHelp, setInstallHelp] = useState(false);
  useEffect(() => {
    let disposed = false;
    const pending = new Set<() => void>();
    const prompt = (event: Event) => {
      event.preventDefault();
      pendingInstallPrompt = event as InstallPrompt;
      setInstallPrompt(pendingInstallPrompt);
    };
    const done = () => {
      pendingInstallPrompt = null;
      setInstalled(true);
      setInstallPrompt(null);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        disposed ||
        data?.source !== "kodety-studio-offline" ||
        !["preparing", "ready", "error"].includes(data.status)
      )
        return;
      setStatus(data.status);
      if (
        Number.isFinite(data.total) &&
        data.total > 0 &&
        Number.isFinite(data.completed)
      )
        setProgress(
          Math.max(
            0,
            Math.min(100, Math.floor((data.completed * 100) / data.total)),
          ),
        );
    };
    const query = async (prepare = false) => {
      if (import.meta.env.DEV || disposed) return;
      if (!navigator.serviceWorker) {
        setStatus("error");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (disposed) return;
      // A first install has no controller yet; progress messages and
      // controllerchange complete the status check when installation succeeds.
      if (registration?.installing) return;
      const controller =
        navigator.serviceWorker.controller || registration?.active;
      if (!controller) return;
      const channel = new MessageChannel();
      const close = () => {
        clearTimeout(timeout);
        channel.port1.close();
        pending.delete(close);
      };
      const timeout = setTimeout(
        () => {
          close();
          if (!disposed) setStatus("error");
        },
        prepare ? 120_000 : 10_000,
      );
      pending.add(close);
      channel.port1.onmessage = (event) => {
        close();
        receive(event);
      };
      controller.postMessage(
        { type: prepare ? "kodety-offline-prepare" : "kodety-offline-status" },
        [channel.port2],
      );
    };
    checkOffline.current = query;
    const changed = () => {
      void query().catch(() => {
        if (!disposed) setStatus("error");
      });
    };
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", done);
    navigator.serviceWorker?.addEventListener("message", receive);
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    const failed = () => setStatus("error");
    window.addEventListener("kodety-studio:offline-cache-unavailable", failed);
    changed();
    return () => {
      disposed = true;
      for (const close of pending) close();
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", done);
      navigator.serviceWorker?.removeEventListener("message", receive);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
      window.removeEventListener(
        "kodety-studio:offline-cache-unavailable",
        failed,
      );
    };
  }, []);
  const retry = async () => {
    setStatus("preparing");
    setProgress(0);
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js",
        {
          updateViaCache: "none",
        },
      );
      await registration.update();
      await checkOffline.current(true);
    } catch {
      setStatus("error");
    }
  };
  const install = async () => {
    if (!installPrompt) {
      setInstallHelp((value) => !value);
      return;
    }
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } catch {
      setInstallHelp(true);
    } finally {
      pendingInstallPrompt = null;
      setInstallPrompt(null);
    }
  };
  return (
    <aside
      className="web-offline-availability"
      aria-label={l("PWA e acesso offline", "PWA and offline access")}
    >
      <div>
        <Icon name={status === "ready" ? "check" : "download"} />
        <p role="status">
          <strong>
            {status === "ready"
              ? l("Editor disponível offline", "Editor available offline")
              : status === "preparing"
                ? l(
                    `Preparando editor offline… ${progress}%`,
                    `Preparing offline editor… ${progress}%`,
                  )
                : status === "error"
                  ? l(
                      "Preparação offline incompleta",
                      "Offline preparation incomplete",
                    )
                  : status === "development"
                    ? l("Prévia de desenvolvimento", "Development preview")
                    : l(
                        "Verificando acesso offline…",
                        "Checking offline access…",
                      )}
          </strong>
          <small>
            {status === "development"
              ? l(
                  "O cache offline é gerado na versão compilada do Studio.",
                  "The offline cache is generated in the built version of Studio.",
                )
              : l(
                  "Continue editando sem internet, pelo site ou pelo aplicativo.",
                  "Keep editing offline, in your browser or in the app.",
                )}
          </small>
          {status !== "development" && (
            <small>
              {l(
                "Prepare o editor para uso offline enquanto estiver conectado. Para publicar, conecte-se à internet.",
                "Prepare the editor for offline use while connected. Connect to the internet when you are ready to publish.",
              )}
            </small>
          )}
        </p>
      </div>
      <div className="web-offline-actions">
        {status === "error" && (
          <button className="web-button" onClick={() => void retry()}>
            {l("Preparar novamente", "Prepare again")}
          </button>
        )}
        {!installed && (
          <button className="web-button" onClick={() => void install()}>
            <Icon name="download" />
            {l("Instalar aplicativo", "Install app")}
          </button>
        )}
        {installed && (
          <span className="web-badge">
            {l("PWA instalado", "PWA installed")}
          </span>
        )}
      </div>
      {installHelp && (
        <p className="web-install-help">
          {l(
            "No menu do Chrome ou Edge, escolha “Instalar Onun Kodety” ou “Instalar este site como aplicativo”. O modo offline também funciona sem instalar.",
            "In the Chrome or Edge menu, choose “Install Onun Kodety” or “Install this site as an app”. Offline mode also works without installing.",
          )}
        </p>
      )}
    </aside>
  );
}
