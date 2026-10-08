"use client";

import Link from "next/link";
import { createPortal, flushSync } from "react-dom";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useSemanticTransient, useSemanticWorkspaceState } from "@/components/semantic-back-provider";
import { useWorkspaceScroll } from "@/components/workspace-state-provider";
import { useRouteMutation, useRouteTransientCleanup } from "@/components/route-transient-state";
import { useDocumentScrollLock } from "@/lib/use-document-scroll-lock";
import { dismissSearchKeyboard } from "@/lib/search-input";
import { ArrowRightIcon, CloseIcon } from "@/components/icons";
import {
  createInventoryReportCsv, inventoryReportCategories, inventoryReportFileDate, inventoryReportLabels,
  inventoryReportTimestamp, moveReportCategory, orderedReportGroups,
  type InventoryReport, type InventoryReportCategory, type InventoryReportSettings,
} from "@/lib/inventory-report";
import { saveInventoryReportOrder } from "./actions";
import styles from "./report.module.css";

const buttonBase = "nk-focus min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";
const button = `${buttonBase} border-border-neutral bg-surface text-text-primary hover:bg-app-background`;
const formatQuantity = new Intl.NumberFormat("pt-BR");
const defaults = { query: "" };
const subscribeNothing = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

function ReportGroups({ report, order, search = "", print = false }: {
  report: InventoryReport; order: InventoryReportCategory[]; search?: string; print?: boolean;
}) {
  return orderedReportGroups(report, order, search).filter(group => group.lines.length > 0).map(group =>
    <section key={group.category} id={print ? undefined : `report-${group.category}`} className={styles.category} aria-label={group.label}>
      <h2 className="border-b border-border-neutral pb-2 text-base font-black text-text-primary sm:text-lg">{group.label}</h2>
      <table className={`${styles.table} w-full table-fixed text-sm`}>
        <caption className="sr-only">{group.label}: código e quantidade disponível</caption>
        <thead><tr className="text-xs text-text-muted"><th scope="col" className="py-2 text-left font-semibold">Código</th><th scope="col" className="w-40 py-2 text-right font-semibold">Quantidade</th></tr></thead>
        <tbody>{group.lines.map(line => <tr key={line.identity} className="border-t border-border-neutral/60">
          <th scope="row" className={`${styles.code} py-2 pr-3 text-left font-mono text-base font-black text-text-primary`}>{line.code}</th>
          <td className="py-2 text-right font-mono text-lg font-extrabold tabular-nums text-text-primary">{formatQuantity.format(line.quantity)}</td>
        </tr>)}</tbody>
      </table>
      {!print && <dl className={styles.mobileRows}>{group.lines.map(line => <div key={line.identity} className="flex min-h-12 items-center justify-between gap-3 border-b border-border-neutral/60 py-2">
        <dt className={`${styles.code} min-w-0 font-mono text-base font-black text-text-primary`}>{line.code}</dt>
        <dd className="shrink-0 font-mono text-xl font-extrabold tabular-nums text-text-primary" aria-label={`${line.quantity} unidades`}>{formatQuantity.format(line.quantity)}</dd>
      </div>)}</dl>}
    </section>);
}

export function InventoryReportOrderDialog({ initialOrder, available, onClose, onSaved }: {
  initialOrder: InventoryReportCategory[]; available: boolean;
  onClose: () => void; onSaved: (order: InventoryReportCategory[]) => void;
}) {
  const [order, setOrder] = useState([...initialOrder]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const description = useId();
  const runMutation = useRouteMutation(startTransition);
  useSemanticTransient(true, onClose, pending);
  useDocumentScrollLock();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  function save() {
    if (busy.current || pending || !available) return;
    busy.current = true;
    setError(null);
    runMutation(async isCurrent => {
      try {
        const result = await saveInventoryReportOrder(order);
        if (!isCurrent()) return;
        if (result.success) onSaved(order);
        else setError(result.error ?? "Não foi possível salvar a ordem.");
      } catch { if (isCurrent()) setError("Não foi possível confirmar o salvamento. Tente novamente."); }
      finally { busy.current = false; }
    });
  }
  // Keep the overlay inside its route: Activity hides this DOM immediately,
  // even before queued transient-state cleanup can render again.
  return <div className={styles.overlay} onMouseDown={event => {
    if (event.target === event.currentTarget && !pending) onClose();
  }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={description} className={styles.sheet} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); if (!pending) onClose(); }
      if (event.key === "Tab") {
        const elements = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
        if (!elements.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
      }
    }}>
      <div className="flex items-center justify-between gap-2 border-b border-border-neutral pb-3">
        <h2 id={title} className="text-xl font-black text-text-primary">Organizar relatório</h2>
        <button type="button" className={`${button} flex size-11 shrink-0 items-center justify-center p-0`} aria-label="Fechar organização" disabled={pending} onClick={onClose}><CloseIcon className="size-5" /></button>
      </div>
      <p id={description} className="mt-3 text-sm leading-5 text-text-muted">A ordem salva vale para todos os usuários, na tela, na impressão e na planilha.</p>
      <ol className="mt-4 space-y-1">{order.map((category, index) => <li key={category} className="flex items-center justify-between gap-2 rounded-lg bg-app-background px-2 py-1">
        <span className="min-w-0 text-sm font-semibold text-text-primary"><span className="mr-2 text-text-muted">{index + 1}.</span>{inventoryReportLabels[category]}</span>
        <div className="flex shrink-0 gap-1">
          <button type="button" className={`${button} flex size-11 items-center justify-center p-0`} aria-label={`Mover ${inventoryReportLabels[category]} para cima`} disabled={pending || index === 0} onClick={() => setOrder(current => moveReportCategory(current, index, -1))}><ArrowRightIcon className="size-4 -rotate-90" /></button>
          <button type="button" className={`${button} flex size-11 items-center justify-center p-0`} aria-label={`Mover ${inventoryReportLabels[category]} para baixo`} disabled={pending || index === order.length - 1} onClick={() => setOrder(current => moveReportCategory(current, index, 1))}><ArrowRightIcon className="size-4 rotate-90" /></button>
        </div>
      </li>)}</ol>
      {!available && <p className="mt-3 text-sm text-text-muted">Salvamento indisponível até a aplicação autorizada da migration.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className={`${button} mr-auto`} disabled={pending} onClick={() => setOrder([...inventoryReportCategories])}>Restaurar padrão</button>
        <button type="button" className={button} disabled={pending} onClick={onClose}>Cancelar</button>
        <button type="button" className={`${buttonBase} border-brand-charcoal bg-brand-charcoal text-white hover:bg-brand-charcoal-soft`} disabled={pending || !available} onClick={save}>{pending ? "Salvando…" : "Salvar ordem"}</button>
      </div>
    </div>
  </div>;
}

export function InventoryReportWorkspace({ report, settings, generatedAt }: {
  report: InventoryReport; settings: InventoryReportSettings; generatedAt: string;
}) {
  const workspace = useSemanticWorkspaceState("relatorio-estoque", defaults);
  const cancelScrollRestore = useWorkspaceScroll("relatorio-estoque", defaults);
  const [organize, setOrganize] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const hydrated = useSyncExternalStore(subscribeNothing, clientReady, serverReady);
  useRouteTransientCleanup(() => { setOrganize(false); setMessage(null); setPrinting(false); });
  // Activity disconnects this Effect when hidden. Only the currently visible
  // route may prepare a full print portal, including native Ctrl+P / Save PDF.
  useEffect(() => {
    const prepare = () => flushSync(() => setPrinting(true));
    const finish = () => setPrinting(false);
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", finish);
    return () => {
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", finish);
    };
  }, []);
  const order = settings.categoryOrder;
  const groups = orderedReportGroups(report, order, workspace.state.query);
  const visibleCount = groups.reduce((sum, group) => sum + group.lines.length, 0);
  function exportCsv() {
    const url = URL.createObjectURL(new Blob([createInventoryReportCsv(report, order)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `relatorio-estoque-${inventoryReportFileDate(generatedAt)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.workspace} data-inventory-report>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><Link href="/estoque" prefetch={false} className="nk-focus inline-flex min-h-11 items-center text-sm font-semibold text-text-muted hover:text-text-primary">Voltar ao Estoque</Link>
        <h1 className="text-2xl font-black tracking-tight text-text-primary sm:text-3xl">Relatório de estoque</h1>
        <p className="mt-1 text-xs text-text-muted">Gerado em {inventoryReportTimestamp(generatedAt)} (Brasília)</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setOrganize(true)}>Organizar</button>
        <button type="button" className={button} disabled={!hydrated} onClick={() => window.print()}>Imprimir / PDF</button>
        <button type="button" className={button} onClick={exportCsv}>Exportar planilha</button>
      </div>
    </header>
    <p className="mt-5 border-y border-border-neutral py-3 text-sm text-text-primary"><strong className="font-mono text-lg tabular-nums">{formatQuantity.format(report.codeCount)}</strong> códigos no estoque <span aria-hidden="true" className="mx-2 text-text-muted">·</span><strong className="font-mono text-lg tabular-nums">{formatQuantity.format(report.unitCount)}</strong> unidades físicas</p>
    <label className="mt-5 block max-w-xl"><span className="sr-only">Buscar código no relatório</span>
      <input type="search" value={workspace.state.query} maxLength={120} onChange={event => workspace.setState({ query: event.target.value })} enterKeyHint="search" onKeyDown={dismissSearchKeyboard} autoCapitalize="none" autoCorrect="off" placeholder="Buscar código…" className="nk-field min-h-12 w-full rounded-xl border px-3 text-base" />
    </label>
    <p className="mt-2 text-xs leading-5 text-text-muted">Impressão e planilha incluem o relatório completo, mesmo durante a pesquisa. Cada conjunto ou Servo com kit conta como uma unidade pronta, sem somar seus componentes novamente.</p>
    {settings.notice && <p role="status" className="mt-3 text-sm leading-5 text-text-muted">{settings.notice}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-900">{message}</p>}
    <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Categorias do relatório" className="hidden lg:block">
        <div className="sticky top-6 flex flex-col gap-1">{groups.map(group => <button key={group.category} type="button" className="nk-focus min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-text-primary hover:bg-border-neutral/30 disabled:opacity-40" disabled={!group.lines.length} onClick={() => {
          cancelScrollRestore();
          document.getElementById(`report-${group.category}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
        }}>{group.label}</button>)}</div>
      </nav>
      <div className="min-w-0">
        {visibleCount ? <ReportGroups report={report} order={order} search={workspace.state.query} /> : <p role="status" className="rounded-xl border border-border-neutral bg-surface p-5 text-sm text-text-muted">{report.codeCount ? "Nenhum código encontrado. Tente outro código ou limpe a pesquisa." : "Nenhum saldo positivo no estoque agora."}</p>}
      </div>
    </div>
    {organize && <InventoryReportOrderDialog initialOrder={order} available={settings.available} onClose={() => setOrganize(false)} onSaved={() => { setOrganize(false); setMessage("Ordem salva para todos os usuários."); }} />}
    {hydrated && printing && createPortal(<div data-inventory-report-print className={styles.printReport}>
      <header><p>NEGÓCIOS K</p><h1>RELATÓRIO DE ESTOQUE</h1><p>Gerado em {inventoryReportTimestamp(generatedAt)} (Brasília)</p></header>
      <ReportGroups report={report} order={order} print />
      <footer>{report.codeCount} códigos · {formatQuantity.format(report.unitCount)} unidades físicas</footer>
    </div>, document.body)}
  </div>;
}
