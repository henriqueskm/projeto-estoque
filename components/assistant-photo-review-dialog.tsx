"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSemanticTransient } from "@/components/semantic-back-provider";
import { useRouteTransientCleanup } from "@/components/route-transient-state";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";
import type { AssistantSupplierOrderPhotoPreviewLine } from "@/lib/assistant-supplier-order-photo-contract";
import { supplierOrderPhotoQuantityIsValid } from "@/lib/assistant-supplier-order-photo-preview";
import { isRealSupplierOrderPhotoDate } from "@/lib/assistant-supplier-order-photo-create-contract";

const button = "nk-focus min-h-11 w-full rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";

function PhotoReviewShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useSemanticTransient(true, onClose);
  useRouteTransientCleanup(onClose);
  useDocumentScrollLock();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    return () => { window.requestAnimationFrame(() => {
      // Switching to code correction mounts another dialog in the same commit.
      // Do not steal its initial focus back to the card behind it.
      if (!document.querySelector('[role="dialog"]') && previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    }); };
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); heading.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(<div role="presentation" className="fixed inset-0 z-[180] flex items-end justify-center bg-black/60 pt-[max(0.5rem,env(safe-area-inset-top))] sm:items-center sm:p-4"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      className="max-h-[92dvh] w-full min-w-0 overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-text-primary shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-6">
      <h3 ref={heading} tabIndex={-1} id={`${id}-title`} className="text-lg font-black outline-none">{title}</h3>
      <p id={`${id}-description`} className="mt-1 text-sm text-text-muted">Confira com a foto. Revisar não cria Pedido nem altera estoque.</p>
      {children}
    </section>
  </div>, document.body);
}

export function SupplierOrderPhotoLineReviewDialog({ line, canConfirmVisual, onConfirm, onSaveQuantity, onCorrect, onClose }: {
  line: AssistantSupplierOrderPhotoPreviewLine;
  canConfirmVisual: boolean;
  onConfirm: () => void;
  onSaveQuantity: (quantity: number) => void;
  onCorrect: () => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(line.quantity === null ? "" : String(line.quantity));
  const numericQuantity = /^[0-9]+$/.test(quantity) ? Number(quantity) : NaN;
  const validQuantity = supplierOrderPhotoQuantityIsValid(numericQuantity);
  const quantityChanged = numericQuantity !== line.quantity || line.blockingReasons.includes("QUANTITY_MISSING");
  const productBlocked = line.blockingReasons.some(reason => reason.startsWith("CODE_") || reason === "DESCRIPTION_CONFLICT");
  return <PhotoReviewShell title="Revisar item do Pedido" onClose={onClose}>
    <dl className="mt-4 space-y-3 break-words [overflow-wrap:anywhere]">
      <div><dt className="text-xs font-bold text-text-muted">Lido na foto</dt><dd className="mt-1 text-sm">{line.rawCode ?? "Código ilegível"} — {line.rawDescription ?? "Descrição ilegível"}</dd></div>
      <div><dt className="text-xs font-bold text-text-muted">Produto no catálogo oficial</dt><dd className="mt-1 font-bold">{line.displayCode ? `Cód. ${line.displayCode}` : "Produto ainda não identificado"}</dd><dd className="text-sm">{line.description ?? "Valide o código para identificar o produto."}</dd></div>
      <div><dt className="text-xs font-bold text-text-muted">Quantidade lida na foto/prévia</dt><dd className="font-mono font-bold">{line.quantity ?? "Não identificada"}</dd></div>
    </dl>
    {line.warning ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">{line.warning}</p> : null}
    <p className="mt-3 text-sm leading-6 text-text-muted">Se a anotação muda o produto, use Corrigir produto. Confirme somente se o produto oficial e a quantidade correspondem ao que foi pedido.</p>
    <button type="button" onClick={onCorrect} className={`${button} mt-3 border border-border-neutral hover:bg-app-background`}>Corrigir produto</button>
    <label className="mt-4 block text-sm font-bold">Quantidade no Pedido
      <input value={quantity} onChange={event => setQuantity(event.target.value)} inputMode="numeric" autoComplete="off" enterKeyHint="done" maxLength={10}
        className="nk-field mt-1 min-h-11 w-full rounded-xl border px-3 text-base" aria-invalid={!validQuantity} />
    </label>
    {!validQuantity ? <p role="status" className="mt-1 text-sm text-red-800">Informe uma quantidade inteira entre 1 e 2.147.483.647.</p> : null}
    {productBlocked ? <p className="mt-3 text-sm text-amber-950">O código ou a descrição ainda precisa de validação. Use Corrigir produto antes de confirmar.</p> : null}
    <div className="mt-5 flex flex-col gap-2">
      {quantityChanged ? <button type="button" disabled={!validQuantity} onClick={() => onSaveQuantity(numericQuantity)} className={`${button} bg-brand-charcoal text-white hover:bg-brand-charcoal-soft`}>Salvar quantidade</button>
        : canConfirmVisual ? <button type="button" onClick={onConfirm} className={`${button} bg-brand-charcoal text-white hover:bg-brand-charcoal-soft`}>Confirmar produto e quantidade</button> : null}
      <button type="button" onClick={onClose} className={`${button} border border-border-neutral hover:bg-app-background`}>Voltar à prévia</button>
    </div>
  </PhotoReviewShell>;
}

export function SupplierOrderPhotoHeaderReviewDialog({ negotiationNumber, orderDate, onSave, onClose }: {
  negotiationNumber: string | null; orderDate: string | null; onSave: (number: string, date: string) => void; onClose: () => void;
}) {
  const [number, setNumber] = useState(negotiationNumber ?? "");
  const [date, setDate] = useState(orderDate ?? "");
  const valid = /^[0-9]{1,120}$/.test(number.trim()) && isRealSupplierOrderPhotoDate(date);
  return <PhotoReviewShell title="Revisar dados do Pedido" onClose={onClose}>
    <div className="mt-4 space-y-4">
      <label className="block text-sm font-bold">Número da negociação
        <input value={number} onChange={event => setNumber(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={120} className="nk-field mt-1 min-h-11 w-full rounded-xl border px-3 text-base" />
      </label>
      <label className="block text-sm font-bold">Data do Pedido
        <input type="date" value={date} onChange={event => setDate(event.target.value)} className="nk-field mt-1 min-h-11 w-full min-w-0 rounded-xl border px-3 text-base" />
      </label>
      {!valid ? <p role="status" className="text-sm text-amber-950">Informe o número somente com dígitos e uma data válida. Preserve os zeros à esquerda.</p> : null}
    </div>
    <div className="mt-5 flex flex-col gap-2">
      <button type="button" disabled={!valid} onClick={() => onSave(number, date)} className={`${button} bg-brand-charcoal text-white hover:bg-brand-charcoal-soft`}>Salvar dados</button>
      <button type="button" onClick={onClose} className={`${button} border border-border-neutral hover:bg-app-background`}>Voltar à prévia</button>
    </div>
  </PhotoReviewShell>;
}
