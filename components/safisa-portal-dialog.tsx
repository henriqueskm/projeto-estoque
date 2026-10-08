"use client";

import { useEffect, useRef, type ReactNode } from "react";

let openDialogs = 0;
let originalOverflow = "";

// Visual shell only: no order, permission, action, or history knowledge.
export function SafisaPortalDialog({
  titleId, descriptionId, title, children, onClose, pending = false,
  covered = false, compact = false, footer,
}: {
  titleId: string;
  descriptionId: string;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  covered?: boolean;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onClose, pending, covered });
  useEffect(() => { latest.current = { onClose, pending, covered }; });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (openDialogs++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (latest.current.covered || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!latest.current.pending) latest.current.onClose();
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
      )].filter(element => element.getClientRects().length > 0 && !element.closest("[inert]"));
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener("keydown", keydown);
    return () => {
      dialog.removeEventListener("keydown", keydown);
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-slate-950/65 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4 ${compact ? "z-50" : "z-40"}`}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !pending && !covered) onClose();
      }}
    >
      <section
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={descriptionId} tabIndex={-1} inert={covered || undefined}
        className={`flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none sm:max-h-[min(46rem,calc(100dvh-2rem))] ${compact ? "max-w-md" : "max-w-[61.25rem]"}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-blue-950 to-blue-800 px-3 py-2 text-white sm:px-5">
          <h2 id={titleId} className="min-w-0 text-lg leading-tight font-black break-words sm:text-xl">{title}</h2>
          <button ref={closeRef} type="button" disabled={pending || covered} onClick={onClose}
            aria-label={compact ? "Fechar confirmação" : "Fechar pedido"}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? <div className="shrink-0">{footer}</div> : null}
      </section>
    </div>
  );
}
