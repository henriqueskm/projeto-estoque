"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useSemanticTransient } from "@/components/semantic-back-provider";
import { useRouteMutation, useRouteTransientCleanup } from "@/components/route-transient-state";
import { useSafisaPickupAlerts } from "@/components/safisa-pickup-alert-provider";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";
import { notifyInventoryDataChanged } from "@/lib/inventory-ui-events";
import { previewSafisaBulkPickup, confirmSafisaBulkPickup } from "@/lib/safisa-bulk-pickup-actions";
import { createBulkPickupAttempt, type BulkPickupPreview, type BulkPickupReceipt } from "@/lib/safisa-bulk-pickup";

const number = new Intl.NumberFormat("pt-BR");
const button = "nk-focus min-h-11 rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";

export function SafisaBulkPickupPreviewContent({ preview }: { preview: BulkPickupPreview }) {
  return <>
    <p className="font-bold text-text-primary">{number.format(preview.orderCount)} Pedidos · {number.format(preview.lineCount)} itens</p>
    <p className="mt-1 text-sm text-text-muted">{number.format(preview.totalQuantity)} unidades entrarão no estoque.</p>
    <ul className="mt-4 space-y-4">
      {preview.orders.map(order => <li key={order.supplierOrderId} className="min-w-0 rounded-xl border border-border-neutral p-3">
        <h3 className="break-words font-black">Pedido {order.negotiationNumber}</h3>
        <p className="text-xs text-text-muted">{order.orderDate.split("-").reverse().join("/")}</p>
        <ul className="mt-2 divide-y divide-border-neutral">
          {order.lines.map(line => <li key={line.supplierOrderItemId} className="flex min-w-0 items-start gap-3 py-2">
            <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
              <p className="font-mono text-sm font-black">Cód. {line.code}</p>
              <p className="text-sm text-text-muted">{line.descriptionSnapshot}</p>
            </div>
            <p className="shrink-0 font-mono font-black tabular-nums">{number.format(line.quantityToPickup)} <span className="text-xs font-normal">un.</span></p>
          </li>)}
        </ul>
      </li>)}
    </ul>
  </>;
}

function BulkDialog({ pending, onClose, children, success }: {
  pending: boolean; onClose: () => void; children: React.ReactNode; success: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Registration belongs to the mounted dialog, like Orders' DialogShell.
  // Unmount consumes the transient once; don't toggle a second registration.
  useSemanticTransient(true, onClose, pending);
  useDocumentScrollLock();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pending) onClose();
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? []);
      if (elements.length === 0) { event.preventDefault(); ref.current?.focus(); return; }
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, onClose]);
  return createPortal(<div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    onMouseDown={event => { if (event.currentTarget === event.target && !pending) onClose(); }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      className="nk-dialog-enter flex max-h-[calc(100dvh-1rem)] w-full max-w-xl min-w-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
      <header className="shrink-0 border-b border-border-neutral bg-brand-charcoal p-4 text-white">
        <h2 id={`${id}-title`} className="text-lg font-black">{success ? "Retirada concluída" : "Prévia da retirada Safisa"}</h2>
        <p id={`${id}-description`} className="mt-1 text-xs">{success ? "As unidades retiradas entraram no estoque." : "Confira todos os itens. Nada é alterado até confirmar."}</p>
      </header>
      {children}
    </section>
  </div>, document.body);
}

export function SafisaBulkPickupAction({ enabled = true, onUnresolvedChange }: { enabled?: boolean; onUnresolvedChange?: (unresolved: boolean) => void }) {
  const router = useRouter();
  const { refreshAlerts } = useSafisaPickupAlerts();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<BulkPickupPreview | null>(null);
  const [receipt, setReceipt] = useState<BulkPickupReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ReturnType<typeof createBulkPickupAttempt> | null>(null);
  const loadSequence = useRef(0);
  const [isPending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    notifyInventoryDataChanged();
    void refreshAlerts();
    router.refresh();
  }, [refreshAlerts, router]);
  const runMutation = useRouteMutation(startTransition, refresh);
  const close = useCallback(() => {
    if (attempt?.phase() === "pending") return;
    loadSequence.current += 1;
    setLoading(false);
    setOpen(false);
  }, [attempt]);
  useRouteTransientCleanup(close);

  async function loadPreview() {
    // A previous uncertain commit must be resolved using its original identity.
    if (attempt?.phase() === "pending" || attempt?.phase() === "uncertain") {
      setOpen(true);
      return;
    }
    const sequence = ++loadSequence.current;
    setOpen(true); setLoading(true); setError(null); setReceipt(null); setPreview(null); setAttempt(null);
    try {
      const result = await previewSafisaBulkPickup();
      if (sequence !== loadSequence.current) return;
      if (!result.ok) { setError(result.error); return; }
      setPreview(result.preview);
      if (result.preview.orderCount > 0) setAttempt(createBulkPickupAttempt({
        orders: result.preview.orders.map(order => ({ supplierOrderId: order.supplierOrderId, expectedUpdatedAt: order.expectedUpdatedAt, expectedLineFingerprint: order.expectedLineFingerprint })),
        idempotencyKey: crypto.randomUUID(),
      }));
    } catch {
      if (sequence === loadSequence.current) setError("Não foi possível carregar a prévia. Tente novamente.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  function confirm() {
    if (!attempt || !["ready", "uncertain"].includes(attempt.phase())) return;
    setError(null);
    runMutation(async isCurrentVisit => {
      const result = await attempt.submit(confirmSafisaBulkPickup);
      if (!result) return;
      if (result.ok) {
        refresh();
        if (isCurrentVisit()) setReceipt(result.receipt);
      } else if (isCurrentVisit()) setError(result.error);
      if (!isCurrentVisit()) setOpen(false);
    });
  }
  const phase = attempt?.phase();
  useEffect(() => { onUnresolvedChange?.(phase === "pending" || phase === "uncertain"); }, [phase, onUnresolvedChange]);
  return <>
    {enabled || phase === "uncertain" ? <button type="button" onClick={() => void loadPreview()} className={`${button} mt-3 w-full bg-emerald-700 text-white hover:bg-emerald-800 sm:w-auto`}>
      {phase === "uncertain" ? "Verificar retirada pendente" : "Retirar todos os prontos"}
    </button> : null}
    {open ? <BulkDialog pending={isPending} onClose={close} success={Boolean(receipt)}>
      <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4">
        {loading ? <p role="status">Carregando prévia atual…</p> : null}
        {receipt ? <p role="status" className="break-words font-bold">{receipt.orderCount} Pedidos · {receipt.changedLineCount} itens · {number.format(receipt.totalStockEntryQuantity)} unidades adicionadas ao estoque.</p>
          : preview ? <SafisaBulkPickupPreviewContent preview={preview} /> : null}
        {preview?.orderCount === 0 ? <p role="status">Nenhuma unidade pronta aguardando retirada.</p> : null}
        {error ? <p role="alert" className="mt-3 break-words text-sm font-semibold text-red-700">{error}</p> : null}
        {phase === "stale" ? <p className="mt-2 text-sm">Atualize a prévia para conferir as novas quantidades antes de retirar.</p> : null}
        {phase === "uncertain" ? <p className="mt-2 text-sm">A mesma operação foi mantida para retry seguro. Não confirme uma nova retirada enquanto o resultado estiver incerto.</p> : null}
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-neutral p-3">
        <button type="button" onClick={close} disabled={isPending} className={`${button} border border-border-neutral`}>{receipt ? "Fechar" : "Cancelar"}</button>
        {receipt ? <Link href="/pedidos" onClick={close} className={`${button} inline-flex items-center bg-brand-charcoal text-white`}>Ver Pedidos</Link>
          : phase === "ready" || phase === "uncertain" || phase === "pending" ? <button type="button" onClick={confirm} disabled={isPending}
            className={`${button} min-w-0 bg-emerald-700 text-white hover:bg-emerald-800`}>
            {isPending ? "Confirmando…" : phase === "uncertain" ? "Tentar novamente" : "Confirmar retirada + entrada"}
          </button> : !loading ? <button type="button" onClick={() => void loadPreview()} className={`${button} bg-brand-charcoal text-white`}>Atualizar prévia</button> : null}
      </footer>
    </BulkDialog> : null}
  </>;
}
