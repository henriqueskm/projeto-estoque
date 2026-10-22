"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadPhysicalCatalogPreview, managePhysicalCatalog } from "@/app/(authenticated)/estoque/catalog-actions";
import { DialogFrame, useAccessibleDialog } from "@/components/inventory-action-dialogs";
import { useRouteMutation, useRouteMutationPending, useRouteTransientCleanup } from "@/components/route-transient-state";
import { useSemanticTransient } from "@/components/semantic-back-provider";
import { notifyInventoryDataChanged } from "@/lib/inventory-ui-events";
import { physicalCatalogLabels, validatePhysicalCatalogRequest, type PhysicalCatalogRequest, type PhysicalCatalogSnapshot } from "@/lib/physical-catalog-management";
import type { PhysicalStockItemType } from "@/lib/stock-calculations";

type ServoOption = { id: string; code: string; description: string };
type Props = {
  operation: PhysicalCatalogRequest["operation"];
  itemId?: string; itemType?: PhysicalStockItemType; servoOptions?: ServoOption[];
  onClose: () => void; onSuccess: (message: string) => void;
  onBack?: () => void;
};
const inputClass = "nk-focus min-h-11 w-full min-w-0 rounded-xl border border-border-neutral bg-surface px-3 py-2 text-base text-text-primary disabled:bg-app-background";
const secondaryClass = "nk-focus min-h-11 rounded-xl border border-border-neutral px-4 py-2 text-sm font-bold text-text-primary hover:bg-app-background disabled:opacity-50";
const dependencyLabels = { configurations: "configurações", recipes: "receitas de conjuntos", compatibilities: "compatibilidades", applications: "aplicações", pendingOrders: "Pedidos ativos ou pendentes" };

export function PhysicalCatalogDialog({ operation, itemId, itemType, servoOptions = [], onClose, onSuccess, onBack }: Props) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<PhysicalCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(operation !== "CREATE");
  const [reload, setReload] = useState(0);
  const [code, setCode] = useState(""), [description, setDescription] = useState(""), [model, setModel] = useState("");
  const [reason, setReason] = useState(""), [compatible, setCompatible] = useState<string[]>([]);
  const [review, setReview] = useState(false), [stale, setStale] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const attempt = useRef<{ request: PhysicalCatalogRequest; key: string } | null>(null);
  const runMutation = useRouteMutation(startTransition, notifyInventoryDataChanged);
  useAccessibleDialog(dialogRef, inputRef, isPending, onClose);
  // Edit/archive fields mount only after the fresh preview finishes loading.
  useEffect(() => { if (!loading && !review) inputRef.current?.focus(); }, [loading, review]);
  useEffect(() => {
    if (!itemId || operation === "CREATE") return;
    let current = true;
    void loadPhysicalCatalogPreview(itemId).then(result => {
      if (!current) return;
      setLoading(false);
      if (result.ok) {
        setSnapshot(result.snapshot); setCode(result.snapshot.code); setDescription(result.snapshot.description);
      } else setError(result.error);
    });
    return () => { current = false; };
  }, [itemId, operation, reload]);
  const type = snapshot?.itemType ?? itemType ?? "LOOSE_PART";
  const blocked = operation === "ARCHIVE" && !!snapshot && Object.values(snapshot.dependencies).some(count => count > 0);
  const locked = isPending || uncertain;
  function request(): PhysicalCatalogRequest | null {
    const base = { reason: reason.trim() };
    if (operation === "CREATE") return { ...base, operation, itemType: type, code: code.trim(), description: description.trim(),
      ...(type === "SERVO" ? { model: model.trim() } : {}), ...(type === "REPAIR_KIT" ? { compatibleServoIds: compatible } : {}) };
    if (!snapshot) return null;
    return operation === "EDIT" ? { ...base, operation, itemId: snapshot.id, expectedVersion: snapshot.version, code: code.trim(), description: description.trim() }
      : { ...base, operation, itemId: snapshot.id, expectedVersion: snapshot.version, expectedQuantity: snapshot.quantity };
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending || blocked || stale || loading) return;
    const next = attempt.current?.request ?? request();
    if (!next) return;
    const invalid = validatePhysicalCatalogRequest(next);
    if (invalid) { setError(invalid); return; }
    if (!review) { setError(null); setReview(true); return; }
    attempt.current ??= { request: next, key: crypto.randomUUID() };
    const currentAttempt = attempt.current;
    runMutation(async isCurrentVisit => {
      let result;
      try { result = await managePhysicalCatalog(currentAttempt.request, currentAttempt.key); }
      catch { result = { ok: false as const, uncertain: true, error: "Não foi possível confirmar o resultado. Verifique a mesma tentativa." }; }
      if (!isCurrentVisit()) return;
      if (result.ok) {
        onSuccess(operation === "ARCHIVE" ? "Produto excluído do catálogo operacional. Histórico preservado."
          : operation === "CREATE" ? "Produto cadastrado com saldo inicial zero." : "Código e descrição atualizados. Histórico preservado.");
      } else {
        setError(result.error); setStale(!!result.stale); setUncertain(!!result.uncertain);
        if (!result.uncertain) attempt.current = null;
      }
    });
  }
  function refreshPreview() {
    if (locked) return;
    setSnapshot(null); setLoading(true); setError(null); setReview(false); setStale(false); attempt.current = null; setReload(n => n + 1);
  }
  return <DialogFrame dialogRef={dialogRef} titleId={titleId} descriptionId={descriptionId} isPending={isPending} onClose={onClose}
    title={operation === "CREATE" ? `Cadastrar ${physicalCatalogLabels[type]}` : operation === "EDIT" ? "Editar código/descrição" : "Excluir produto"}>
    <form onSubmit={submit} className="space-y-4 p-4 text-left sm:p-5">
      <p id={descriptionId} className="text-sm text-text-muted">
        {operation === "ARCHIVE" ? "O cadastro será inativado. O saldo livre será corrigido para zero, sem registrar venda. Todo o histórico será preservado."
          : operation === "CREATE" ? "Cadastro sem movimentação. Para receber unidades depois, use Entrada."
            : "A categoria, modelo, saldos e registros históricos não serão alterados."}
      </p>
      {loading ? <p role="status">Carregando prévia atual do servidor…</p> : null}
      {!loading && (operation === "CREATE" || snapshot) ? <>
        {snapshot ? <div className="break-words rounded-xl border border-border-neutral bg-app-background p-3 text-sm">
          <p className="break-all font-mono font-black">{snapshot.code}</p><p>{snapshot.description}</p>
          <p className="mt-1 font-bold">Saldo livre atual: {snapshot.quantity.toLocaleString("pt-BR")}</p>
          {snapshot.model ? <p>Modelo: {snapshot.model}</p> : null}
          <p className="mt-1 text-text-muted">{Object.entries(snapshot.dependencies).map(([key, count]) => `${count} ${dependencyLabels[key as keyof typeof dependencyLabels]}`).join(" · ")}</p>
        </div> : null}
        {operation !== "ARCHIVE" ? <fieldset disabled={locked || review} className="min-w-0 space-y-3 disabled:opacity-80">
          <label className="block text-sm font-bold">Código<input ref={inputRef} value={code} onChange={e => setCode(e.target.value)} maxLength={120} required autoCapitalize="none" autoCorrect="off" className={inputClass} /></label>
          <label className="block text-sm font-bold">Descrição<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} required rows={2} className={inputClass} /></label>
          {operation === "CREATE" && type === "SERVO" ? <label className="block text-sm font-bold">Modelo do Servo<input value={model} onChange={e => setModel(e.target.value)} required maxLength={120} className={inputClass} /></label> : null}
          {operation === "CREATE" && type === "REPAIR_KIT" ? <div><p className="text-sm font-bold">Compatibilidade com Servos (opcional)</p>
            <p className="text-xs text-text-muted">Marque apenas compatibilidades confirmadas. Nenhuma é presumida.</p>
            <div className="mt-1 max-h-36 overflow-y-auto overscroll-contain">{servoOptions.map(servo => <label key={servo.id} className="flex min-h-11 items-center gap-2 break-words text-sm">
              <input type="checkbox" checked={compatible.includes(servo.id)} onChange={e => setCompatible(ids => e.target.checked ? [...ids, servo.id] : ids.filter(id => id !== servo.id))} />
              {servo.code} — {servo.description}</label>)}</div>
          </div> : null}
        </fieldset> : null}
        <label className="block text-sm font-bold">Motivo<input ref={operation === "ARCHIVE" ? inputRef : undefined} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} required disabled={locked || review} className={inputClass} /></label>
        {review ? <div role="status" className="break-words rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-bold">Confira antes de confirmar</p>
          {operation === "ARCHIVE" ? <p>{snapshot?.code}: saldo livre {snapshot?.quantity} → 0. O produto deixará de aparecer nas buscas operacionais.</p>
            : <><p className="break-all">Código: {snapshot?.code ? `${snapshot.code} → ` : ""}{code.trim()}</p><p>Descrição: {description.trim()}</p><p>Saldo livre: {snapshot?.quantity ?? 0} (sem alteração)</p></>}
        </div> : null}
        {blocked ? <p role="alert" className="text-sm font-bold text-red-800">Exclusão bloqueada pelos vínculos acima. Nenhum saldo será alterado. Resolva a dependência no fluxo próprio.</p> : null}
      </> : null}
      {error ? <p role="alert" className="break-words text-sm font-semibold text-red-800">{error}</p> : null}
      {stale || (!loading && !snapshot && operation !== "CREATE") ? <button type="button" onClick={refreshPreview} disabled={locked} className={secondaryClass}>Atualizar prévia</button> : null}
      {uncertain ? <p className="text-sm text-amber-950">Os campos permanecem bloqueados. Verificar reutiliza a mesma chave e não duplica a operação.</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border-neutral pt-4">
        {operation === "CREATE" && onBack && !review && !locked ? <button type="button" onClick={onBack} className={secondaryClass}>Voltar às categorias</button> : null}
        <button type="button" onClick={onClose} disabled={isPending} className={secondaryClass}>{uncertain ? "Fechar" : "Cancelar"}</button>
        {review && !locked ? <button type="button" onClick={() => { setReview(false); attempt.current = null; }} className={secondaryClass}>Voltar à edição</button> : null}
        <button type="submit" disabled={isPending || loading || blocked || stale || (operation !== "CREATE" && !snapshot)}
          className={`nk-focus min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${operation === "ARCHIVE" ? "bg-red-700 hover:bg-red-800" : "bg-brand-charcoal hover:bg-brand-charcoal-soft"}`}>
          {isPending ? "Aguarde…" : uncertain ? "Verificar tentativa" : review ? operation === "ARCHIVE" ? "Confirmar exclusão" : "Confirmar alteração" : "Revisar alteração"}
        </button>
      </div>
    </form>
  </DialogFrame>;
}

const registrationCategories = [
  { type: "SERVO", label: "Servo sem kit" },
  { type: "INSTALLATION_KIT", label: "Kit de instalação" },
  { type: "REPAIR_KIT", label: "Jogo de reparo" },
  { type: "LOOSE_PART", label: "Peça avulsa" },
] as const satisfies readonly { type: PhysicalStockItemType; label: string }[];

export function PhysicalCatalogCategoryDialog({ onSelect, onClose }: {
  onSelect: (itemType: PhysicalStockItemType) => void; onClose: () => void;
}) {
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null), firstOption = useRef<HTMLButtonElement>(null);
  useAccessibleDialog(dialogRef, firstOption, false, onClose);
  return <DialogFrame dialogRef={dialogRef} titleId={titleId} descriptionId={descriptionId} title="Cadastrar produto" isPending={false} onClose={onClose}>
    <div className="space-y-4 p-4 text-left sm:p-5">
      <p id={descriptionId} className="text-sm text-text-muted">Qual categoria você deseja cadastrar? O produto começará com saldo zero.</p>
      <div className="grid gap-2">
        {registrationCategories.map((category, index) => <button key={category.type} ref={index === 0 ? firstOption : undefined} type="button"
          onClick={() => onSelect(category.type)}
          className="nk-focus min-h-14 w-full rounded-xl border border-border-neutral bg-surface px-4 py-3 text-left text-base font-bold text-text-primary hover:bg-app-background">
          {category.label}
        </button>)}
      </div>
      <div className="flex justify-end border-t border-border-neutral pt-4"><button type="button" onClick={onClose} className={secondaryClass}>Cancelar</button></div>
    </div>
  </DialogFrame>;
}

export function PhysicalCatalogCreateButton({ servoOptions, onCatalogSuccess }: { servoOptions: ServoOption[]; onCatalogSuccess?: (message: string) => void }) {
  const [open, setOpen] = useState(false), [feedback, setFeedback] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<PhysicalStockItemType | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter(), pending = useRouteMutationPending();
  const close = useCallback(() => { setOpen(false); setSelectedType(null); requestAnimationFrame(() => trigger.current?.focus()); }, []);
  useSemanticTransient(open, close, pending);
  useRouteTransientCleanup(() => { setOpen(false); setSelectedType(null); setFeedback(null); }, open || !!feedback);
  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" disabled={pending} onClick={() => { setSelectedType(null); setOpen(true); }}
      className="nk-focus inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-charcoal px-4 py-2 text-sm font-bold text-white hover:bg-brand-charcoal-soft disabled:opacity-50 sm:w-auto">Cadastrar produto</button>
    {open && !selectedType ? <PhysicalCatalogCategoryDialog onSelect={setSelectedType} onClose={close} /> : null}
    {open && selectedType ? <PhysicalCatalogDialog operation="CREATE" itemType={selectedType} servoOptions={servoOptions} onClose={close} onBack={() => setSelectedType(null)} onSuccess={message => {
      if (onCatalogSuccess) onCatalogSuccess(message); else setFeedback(message);
      close(); notifyInventoryDataChanged(); router.refresh();
    }} /> : null}
    {feedback ? <p role="status" className="fixed right-3 bottom-24 left-3 z-[70] mx-auto max-w-md rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">
      {feedback}<button type="button" onClick={() => setFeedback(null)} className="nk-focus ml-2 min-h-11 px-2 underline">Fechar</button></p> : null}
  </>;
}
