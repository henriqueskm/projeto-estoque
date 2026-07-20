"use client";

import { useEffect, useState } from "react";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type InstallMode = "browser" | "ios" | null;

const sessionDismissalKey = "negocios-k:pwa-install-dismissed";

function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>(null);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const canRegisterServiceWorker =
      "serviceWorker" in navigator &&
      (window.isSecureContext || window.location.hostname === "localhost");

    if (canRegisterServiceWorker) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    if (
      isStandaloneMode() ||
      window.sessionStorage.getItem(sessionDismissalKey) === "true"
    ) {
      return;
    }

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setInstallMode("browser");
    }

    function handleAppInstalled() {
      window.sessionStorage.setItem(sessionDismissalKey, "true");
      setInstallEvent(null);
      setInstallMode(null);
    }

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt,
    );
    window.addEventListener("appinstalled", handleAppInstalled);

    const iosDetectionTimer = isIosDevice()
      ? window.setTimeout(() => setInstallMode("ios"), 0)
      : null;

    return () => {
      if (iosDetectionTimer !== null) {
        window.clearTimeout(iosDetectionTimer);
      }
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  function dismissForSession() {
    window.sessionStorage.setItem(sessionDismissalKey, "true");
    setInstallEvent(null);
    setInstallMode(null);
  }

  async function requestInstallation() {
    if (!installEvent || isInstalling) {
      return;
    }

    setIsInstalling(true);

    try {
      await installEvent.prompt();
      await installEvent.userChoice;
      dismissForSession();
    } finally {
      setIsInstalling(false);
    }
  }

  if (!installMode) {
    return null;
  }

  return (
    <aside
      aria-label="Instalação do aplicativo Negócios K"
      className="mx-auto mt-5 w-full max-w-6xl px-4 sm:px-6 lg:px-8"
    >
      <div className="rounded-2xl border border-brand-gold/45 bg-brand-gold-soft/40 p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-brand-gold/70 bg-brand-charcoal font-black tracking-[-0.12em] shadow-sm"
          >
            <span className="text-white">N</span>
            <span className="pr-0.5 text-brand-gold">K</span>
          </span>
          <div className="min-w-0">
            <p className="font-black text-brand-charcoal">
              {installMode === "ios"
                ? "Adicionar à Tela de Início"
                : "Instalar Negócios K"}
            </p>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              {installMode === "ios"
                ? "Tenha o estoque sempre à mão no seu iPhone ou iPad."
                : "Instale o Negócios K no seu celular para acessar o estoque mais rápido."}
            </p>

            {installMode === "ios" && showIosInstructions ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm font-semibold leading-6 text-text-primary">
                <li>Toque no botão Compartilhar do Safari.</li>
                <li>Escolha “Adicionar à Tela de Início”.</li>
              </ol>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0">
          {installMode === "browser" ? (
            <button
              type="button"
              onClick={requestInstallation}
              disabled={isInstalling}
              className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isInstalling ? "Abrindo..." : "Instalar"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowIosInstructions(true)}
              className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
            >
              {showIosInstructions
                ? "Instruções exibidas"
                : "Adicionar à Tela de Início"}
            </button>
          )}

          <button
            type="button"
            onClick={dismissForSession}
            className="nk-focus inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-gold-dark bg-surface px-4 text-sm font-bold text-brand-charcoal transition hover:bg-white"
          >
            Agora não
          </button>
        </div>
      </div>
    </aside>
  );
}
