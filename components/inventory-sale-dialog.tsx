"use client";

import { useId, useRef, useState, useTransition } from "react";
import { submitInventorySale } from "@/app/(authenticated)/saida/actions";
import { DialogFrame, useAccessibleDialog } from "@/components/inventory-action-dialogs";
import type { InventoryActionTarget } from "@/lib/inventory-action-types";
import {
  buildInventorySaleRequest, createInventorySaleAttempt, formatInventorySaleFeedback,
  inventorySaleAvailable, inventorySaleCodes,
} from "@/lib/inventory-sale";

export function InventorySaleDialog({ target, onClose, onSuccess, onStale }: {
  target: InventoryActionTarget;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [isPending, startTransition] = useTransition();
  const [attempt] = useState(createInventorySaleAttempt);
  const codes = inventorySaleCodes(target);
  const [codeId, setCodeId] = useState(codes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const available = inventorySaleAvailable(target);
  const code = target.kind === "ITEM" ? target.code : codes.find((alias) => alias.id === codeId)?.code;
  const canSell = available > 0 && Boolean(code);
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) > 0 && Number(quantity) <= available;
  useAccessibleDialog(dialogRef, canSell ? quantityRef : descriptionRef, isPending, onClose);

  function confirm() {
    const request = attempt.request ?? buildInventorySaleRequest(
      target, codeId, Number(quantity), description, crypto.randomUUID(),
    );
    if (!request || !code) return;
    setLocked(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await attempt.submit(request, submitInventorySale);
        if (!result) return;
        if (result.ok) onSuccess(formatInventorySaleFeedback(target, code, result.receipt));
        else if (result.stale) {
          onStale(result.error);
          onClose();
        } else setError(result.error);
      } catch {
        setError("Não foi possível confirmar o resultado. Tente novamente neste dialog com a mesma chave, ou atualize o Estoque para conferir a venda.");
      }
    });
  }

  return (
    <DialogFrame title="Registrar venda" titleId={`${id}-title`} descriptionId={`${id}-description`}
      dialogRef={dialogRef} isPending={isPending} onClose={onClose}>
      <div className="min-w-0 space-y-4 p-4 sm:p-5">
        <div id={`${id}-description`} className="min-w-0 break-words">
          <p className="font-mono text-lg font-black text-text-primary">{code ?? target.description}</p>
          <p className="text-sm text-text-muted">{target.description}</p>
          <p className="mt-2 text-sm font-bold">Disponível para venda: {available}</p>
          <p className="mt-1 text-xs text-text-muted">Somente saldo livre/pronto. Esta venda não monta nem desmonta componentes.</p>
        </div>
        {codes.length > 1 ? <label className="block text-sm font-bold">
          Código da venda
          <select value={codeId} disabled={isPending || locked} onChange={(event) => setCodeId(event.target.value)}
            className="nk-focus mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border-neutral bg-surface px-3">
            {codes.map((alias) => <option key={alias.id} value={alias.id}>{alias.code}</option>)}
          </select>
        </label> : null}
        <label className="block text-sm font-bold">
          Quantidade
          <input ref={quantityRef} type="number" inputMode="numeric" min="1" max={available} step="1"
            value={quantity} disabled={!canSell || isPending || locked} onChange={(event) => setQuantity(event.target.value)}
            className="nk-focus mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border-neutral px-3 font-mono" />
        </label>
        <label className="block text-sm font-bold">
          Observação opcional
          <textarea ref={descriptionRef} value={description} maxLength={500} rows={2} disabled={isPending || locked}
            onChange={(event) => setDescription(event.target.value)}
            className="nk-focus mt-1 w-full min-w-0 resize-y rounded-lg border border-border-neutral p-3 font-normal" />
        </label>
        {!canSell ? <p role="status" className="text-sm font-semibold text-red-700">
          {available === 0 ? "Não há saldo disponível para venda." : "Não há código comercial ativo válido para esta venda."}
        </p> : null}
        {error ? <p role="alert" className="break-words text-sm font-semibold text-red-700">{error}</p> : null}
        {locked && error ? <p className="text-xs text-text-muted">Os dados desta tentativa foram mantidos para permitir retry seguro.</p> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border-neutral pt-4">
          <button type="button" disabled={isPending} onClick={onClose}
            className="nk-focus min-h-11 rounded-lg border border-border-neutral px-4 text-sm font-bold disabled:opacity-50">Cancelar</button>
          <button type="button" disabled={isPending || !canSell || !validQuantity} onClick={confirm}
            className="nk-focus min-h-11 rounded-lg bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">
            {isPending ? "Confirmando…" : "Confirmar venda"}
          </button>
        </div>
      </div>
    </DialogFrame>
  );
}
