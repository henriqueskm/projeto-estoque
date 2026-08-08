"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { BellIcon, CloseIcon } from "@/components/icons";
import { useSafisaPickupAlerts } from "@/components/safisa-pickup-alert-provider";

const quantityFormatter = new Intl.NumberFormat("pt-BR");

function orderLabel(count: number) {
  return `${quantityFormatter.format(count)} ${count === 1 ? "Pedido" : "Pedidos"}`;
}

export function SafisaPickupAlertBell() {
  const {
    alerts,
    alertCount,
    error,
    hasConfirmedData,
    isComplete,
    isRefreshing,
    refreshAlerts,
  } =
    useSafisaPickupAlerts();
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function closeFromOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const badge = isComplete && (hasConfirmedData || alertCount > 0)
    ? alertCount > 99
      ? "99+"
      : String(alertCount)
    : null;
  const buttonLabel = alertCount
    ? isComplete
      ? `${orderLabel(alertCount)} aguardando retirada Safisa`
      : "Pedidos Safisa com unidades aguardando retirada"
    : "Retiradas Safisa";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
        className="nk-focus relative inline-flex size-11 items-center justify-center rounded-xl border border-white/20 text-white transition hover:border-brand-gold hover:bg-white/10"
      >
        <BellIcon className="size-5" />
        {badge && alertCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full border-2 border-brand-charcoal bg-brand-gold px-1 text-[0.6rem] leading-4 font-black text-brand-charcoal">
            {badge}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Retiradas Safisa"
          className="fixed top-[calc(3.5rem+0.5rem)] right-3 left-3 z-[70] max-h-[min(34rem,calc(100dvh-5rem))] overflow-y-auto rounded-2xl border border-border-neutral bg-surface p-3 text-text-primary shadow-2xl sm:absolute sm:top-[calc(100%+0.5rem)] sm:right-0 sm:left-auto sm:w-[min(25rem,calc(100vw-2rem))] lg:right-auto lg:left-0"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border-neutral pb-2.5">
            <div>
              <h2 className="text-sm font-black">Retiradas Safisa</h2>
              <p className="mt-0.5 text-xs font-semibold text-text-muted">
                {error
                  ? error
                  : alertCount
                  ? isComplete
                    ? `${orderLabel(alertCount)} aguardando retirada`
                    : "Há Pedidos com unidades aguardando retirada."
                  : "Nenhum Pedido aguardando retirada."}
              </p>
            </div>
            <button
              type="button"
              aria-label="Fechar retiradas Safisa"
              onClick={() => {
                setIsOpen(false);
                window.requestAnimationFrame(() => buttonRef.current?.focus());
              }}
              className="nk-focus inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-neutral text-text-muted transition hover:bg-app-background hover:text-text-primary"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>

          {alerts.length ? (
            <div className="mt-2.5 space-y-2">
              {alerts.slice(0, 10).map((alert) => (
                <article
                  key={alert.supplierOrderId}
                  className="rounded-xl border border-border-neutral bg-white px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-mono text-sm font-black text-text-primary">
                      Pedido {alert.negotiationNumber}
                    </p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.62rem] font-black ${
                        alert.kind === "FULLY_READY"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-sky-200 bg-sky-50 text-sky-900"
                      }`}
                    >
                      {alert.kind === "FULLY_READY"
                        ? "Pronto para retirada"
                        : "Parcialmente pronto"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-text-muted">
                    {quantityFormatter.format(
                      alert.readyWaitingPickupQuantity,
                    )}{" "}
                    {alert.readyWaitingPickupQuantity === 1
                      ? "unidade aguardando retirada"
                      : "unidades aguardando retirada"}
                  </p>
                  <Link
                    href={`/pedidos?order=${encodeURIComponent(alert.supplierOrderId)}`}
                    onClick={() => setIsOpen(false)}
                    className="nk-focus mt-2 inline-flex min-h-9 items-center rounded-lg border border-border-neutral px-2.5 text-xs font-black text-text-primary transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/25"
                  >
                    Ver pedido
                  </Link>
                </article>
              ))}
            </div>
          ) : error ? (
            <div className="py-5">
              <p className="text-center text-sm font-semibold text-text-muted">
                Não foi possível confirmar o estado das retiradas Safisa agora.
              </p>
              <button
                type="button"
                onClick={() => void refreshAlerts()}
                disabled={isRefreshing}
                className="nk-focus mx-auto mt-3 inline-flex min-h-9 items-center rounded-lg border border-border-neutral px-3 text-xs font-black text-text-primary transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <p className="py-5 text-center text-sm font-semibold text-text-muted">
              Nenhum Pedido aguardando retirada.
            </p>
          )}

          {alerts.length > 10 ? (
            <Link
              href="/pedidos"
              onClick={() => setIsOpen(false)}
              className="nk-focus mt-3 inline-flex min-h-10 items-center text-sm font-black text-brand-gold-ink hover:underline"
            >
              Ver todos os Pedidos
            </Link>
          ) : null}
          {isRefreshing ? (
            <p className="sr-only" role="status">Atualizando retiradas Safisa.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function SafisaPickupAlertHomeSummary() {
  const { alerts, alertCount, error, hasConfirmedData, isComplete } =
    useSafisaPickupAlerts();

  if (alertCount === 0 || (!hasConfirmedData && error)) return null;

  return (
    <section
      aria-labelledby="safisa-pickup-home-heading"
      className="mt-4 rounded-xl border border-border-neutral bg-surface px-3 py-2.5 shadow-sm sm:mt-5 sm:px-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2
            id="safisa-pickup-home-heading"
            className="text-sm font-black text-text-primary"
          >
            Retiradas Safisa
          </h2>
          <p className="text-xs font-semibold text-text-muted">
            {isComplete
              ? `${orderLabel(alertCount)} aguardando retirada`
              : "Pedidos com unidades aguardando retirada"}
          </p>
        </div>
        <Link
          href="/pedidos"
          className="nk-focus rounded text-xs font-black text-brand-gold-ink hover:underline"
        >
          Ver todos
        </Link>
      </div>
      <ul className="mt-2 space-y-1.5">
        {alerts.slice(0, 3).map((alert) => (
          <li key={alert.supplierOrderId}>
            <Link
              href={`/pedidos?order=${encodeURIComponent(alert.supplierOrderId)}`}
              className="nk-focus flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-semibold text-text-primary transition hover:bg-app-background"
            >
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${
                  alert.kind === "FULLY_READY" ? "bg-emerald-600" : "bg-sky-600"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">
                Pedido {alert.negotiationNumber}
              </span>
              <span className="shrink-0 text-text-muted">
                {quantityFormatter.format(alert.readyWaitingPickupQuantity)} prontas
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
