"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePushNotifications } from "@/components/push-notification-provider";
import { useSemanticTransient } from "@/components/semantic-back-provider";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";

const sessionDismissalKey = "negocios-k:push-prompt-dismissed";
// Give the install prompt time to claim the screen first; only one modal at a time.
const openDelayMs = 1500;

function readSessionDismissal() {
  try {
    return window.sessionStorage.getItem(sessionDismissalKey) === "true";
  } catch {
    return false;
  }
}

function storeSessionDismissal() {
  try {
    window.sessionStorage.setItem(sessionDismissalKey, "true");
  } catch {
    // Without storage the prompt simply closes for this page view.
  }
}

// Shown on entry, like the install prompt, only while this device has not
// turned notifications on yet. Devices with notifications active never see it.
export function PushNotificationPrompt({ blocked = false }: { blocked?: boolean }) {
  const { state, isWorking, operation, errorOperation, enable } =
    usePushNotifications();
  const [isReady, setIsReady] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [wasShown, setWasShown] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (readSessionDismissal()) return;
    const timer = window.setTimeout(() => setIsReady(true), openDelayMs);
    return () => window.clearTimeout(timer);
  }, []);

  const isEnabling = isWorking && operation === "enable";
  const enableFailed = state === "error" && errorOperation === "enable";
  // Opens only for "default" (never asked or turned off). Once open, it stays
  // while activating or after a failure so the person sees the result.
  const isOpen =
    isReady &&
    !blocked &&
    !isDismissed &&
    (state === "default" || (wasShown && (isEnabling || enableFailed)));

  // Adjusting state while rendering (not in an Effect) avoids an extra pass.
  if (isOpen && !wasShown) setWasShown(true);

  const dismissForSession = useCallback(() => {
    storeSessionDismissal();
    setIsDismissed(true);
  }, []);

  useDocumentScrollLock(isOpen);
  useSemanticTransient(isOpen, dismissForSession, isEnabling);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    window.requestAnimationFrame(() => primaryActionRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissForSession();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) return;

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
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement?.focus();
    };
  }, [dismissForSession, isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isEnabling) {
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
          Ativar notificações
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-base leading-6 text-text-muted"
        >
          Receba avisos neste celular quando houver itens prontos na Safisa.
        </p>

        {enableFailed ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-900"
          >
            Não foi possível ativar as notificações agora. Tente novamente.
          </p>
        ) : null}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            ref={primaryActionRef}
            type="button"
            onClick={() => void enable()}
            disabled={isEnabling}
            className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-charcoal px-5 text-base font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isEnabling ? "Ativando..." : "Ativar notificações"}
          </button>
          <button
            type="button"
            onClick={dismissForSession}
            disabled={isEnabling}
            className="nk-focus inline-flex min-h-12 items-center justify-center rounded-xl border border-brand-gold-dark bg-surface px-4 text-base font-bold text-brand-charcoal transition hover:bg-brand-gold-soft/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
