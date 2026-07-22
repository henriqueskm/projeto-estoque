"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const dismissForSession = useCallback(() => {
    window.sessionStorage.setItem(sessionDismissalKey, "true");
    setInstallEvent(null);
    setInstallMode(null);
  }, []);

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

  useEffect(() => {
    if (!installMode) {
      return;
    }

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => primaryActionRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissForSession();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [dismissForSession, installMode]);

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
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          dismissForSession();
        }
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/55 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-brand-gold/45 bg-surface p-5 shadow-2xl sm:p-6"
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full border border-brand-gold/70 bg-brand-charcoal font-black tracking-[-0.12em] shadow-sm"
        >
          <span className="text-white">N</span>
          <span className="pr-0.5 text-brand-gold">K</span>
        </span>
        <h2
          id={titleId}
          className="mt-4 text-xl font-black tracking-tight text-brand-charcoal sm:text-2xl"
        >
          Instalar Negócios K
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm leading-6 text-text-muted"
        >
          Adicione o Negócios K ao seu celular para acessar mais rapidamente.
        </p>

        {installMode === "ios" && showIosInstructions ? (
          <div className="mt-4 rounded-2xl bg-brand-gold-soft/45 p-4">
            <p className="text-sm font-black text-brand-charcoal">
              Adicionar à Tela de Início
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm font-semibold leading-6 text-text-primary">
              <li>Toque no botão Compartilhar do Safari.</li>
              <li>Escolha “Adicionar à Tela de Início”.</li>
            </ol>
          </div>
        ) : null}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {installMode === "browser" ? (
            <button
              ref={primaryActionRef}
              type="button"
              onClick={requestInstallation}
              disabled={isInstalling}
              className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-sm font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isInstalling ? "Abrindo..." : "Instalar"}
            </button>
          ) : (
            <button
              ref={primaryActionRef}
              type="button"
              onClick={() => setShowIosInstructions(true)}
              className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-charcoal px-4 text-sm font-black text-white transition hover:bg-brand-charcoal-soft"
            >
              {showIosInstructions
                ? "Instruções exibidas"
                : "Como instalar"}
            </button>
          )}

          <button
            type="button"
            onClick={dismissForSession}
            className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl border border-brand-gold-dark bg-surface px-4 text-sm font-bold text-brand-charcoal transition hover:bg-brand-gold-soft/40"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
