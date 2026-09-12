"use client";

import { usePushNotifications } from "@/components/push-notification-provider";

export function PushNotificationControl({
  className = "mt-3 rounded-xl border border-border-neutral bg-app-background/65 p-3",
}: {
  className?: string;
}) {
  const {
    state,
    isWorking,
    operation,
    errorOperation,
    enable,
    disable,
  } = usePushNotifications();

  const message = isWorking && operation === "disable"
    ? "Desativando as notificações neste dispositivo..."
    : state === "granted"
    ? "Notificações ativadas neste dispositivo."
    : state === "denied"
      ? "As notificações foram bloqueadas neste navegador. Reative-as nas configurações do site."
      : state === "unsupported"
        ? "Este navegador não oferece notificações push compatíveis."
        : state === "not_configured"
          ? "As notificações push ainda não estão configuradas."
          : state === "ios_install_required"
            ? "Para receber notificações no iPhone, adicione o NK à Tela de Início."
            : state === "error" && errorOperation === "disable"
              ? "As notificações ficaram desativadas localmente, mas a sincronização está pendente. Tente desativar novamente."
              : state === "error"
                ? "Não foi possível ativar as notificações agora. Tente novamente."
              : state === "checking"
                ? "Verificando este dispositivo..."
                : "Receba um aviso quando um Pedido ficar totalmente pronto.";

  const showDisable =
    state === "granted" ||
    (isWorking && operation === "disable") ||
    (state === "error" && errorOperation === "disable");
  const showEnable =
    state === "default" ||
    (isWorking && operation === "enable") ||
    (state === "error" && errorOperation !== "disable");

  return (
    <div className={className}>
      <p className="text-xs font-black text-text-primary">
        Notificações neste dispositivo
      </p>
      <p className="mt-1 text-xs font-semibold leading-5 text-text-muted" aria-live="polite">
        {message}
      </p>
      {showDisable ? (
        <button
          type="button"
          onClick={() => void disable()}
          disabled={isWorking}
          className="nk-focus mt-2 inline-flex min-h-9 items-center rounded-lg border border-border-neutral bg-surface px-3 text-xs font-black text-text-primary transition hover:border-brand-gold-dark hover:bg-brand-gold-soft/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isWorking
            ? "Desativando..."
            : errorOperation === "disable"
              ? "Tentar desativar novamente"
              : "Desativar"}
        </button>
      ) : showEnable ? (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={isWorking}
          className="nk-focus mt-2 inline-flex min-h-9 items-center rounded-lg bg-brand-charcoal px-3 text-xs font-black text-white transition hover:bg-brand-charcoal-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isWorking ? "Ativando..." : "Ativar notificações"}
        </button>
      ) : null}
    </div>
  );
}
