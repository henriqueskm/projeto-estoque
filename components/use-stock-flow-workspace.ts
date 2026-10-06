"use client";

import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import { useWorkspaceScroll, useWorkspaceState } from "@/components/workspace-state-provider";
import { stockFlowWorkspaceDefaults, type StockFlowDraft } from "@/lib/workspace-state";
import { reconcileStockFlowLines, serializeStockFlowLines, type StockFlowLine } from "@/lib/workspace-stock-draft";
import type { InboundCatalog, InboundCatalogOption } from "@/lib/inbound-types";
import { useSemanticCheckpoint } from "@/components/semantic-back-provider";

export function useStockFlowWorkspace<Option extends InboundCatalogOption>(mode: "entrada" | "saida", catalog: InboundCatalog) {
  const workspace = useWorkspaceState(mode, stockFlowWorkspaceDefaults);
  const { state, setState, hydrated } = workspace;
  const searchHistory = useSemanticCheckpoint(`${mode}:search`, { search: state.search }, value => {
    if (typeof value.search === "string") setState(current => ({ ...current, search: value.search as string }));
  }, hydrated);
  const commitSearch = searchHistory.commit;
  const [reconciliationNotice, setReconciliationNotice] = useState(false);
  const reconciled = useMemo(() => reconcileStockFlowLines(state.lines, catalog, mode), [state.lines, catalog, mode]);
  useEffect(() => {
    if (!hydrated || !reconciled.changed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState(current => ({ ...current, lines: serializeStockFlowLines(reconciled.lines), step: "editing", idempotencyKey: crypto.randomUUID() }));
      setReconciliationNotice(true);
    });
    return () => { cancelled = true; };
  }, [hydrated, reconciled, setState]);
  const setField = useCallback(<K extends keyof StockFlowDraft>(field: K, value: SetStateAction<StockFlowDraft[K]>) => {
    setState(current => {
      const next = { ...current, [field]: typeof value === "function" ? (value as (old: StockFlowDraft[K]) => StockFlowDraft[K])(current[field]) : value };
      if (field === "search") commitSearch({ search: current.search }, { search: next.search }, true);
      return next;
    });
  }, [setState, commitSearch]);
  const setLines = useCallback((update: SetStateAction<StockFlowLine<Option>[]>) => {
    setState(current => {
      const fresh = reconcileStockFlowLines(current.lines, catalog, mode).lines as StockFlowLine<Option>[];
      const next = typeof update === "function" ? update(fresh) : update;
      return { ...current, lines: serializeStockFlowLines(next) };
    });
  }, [setState, catalog, mode]);
  const cancelScrollRestore = useWorkspaceScroll(mode, stockFlowWorkspaceDefaults);
  return { ...workspace, lines: reconciled.lines as StockFlowLine<Option>[], setLines, setField, reconciliationNotice, needsReconciliation: reconciled.changed, cancelScrollRestore };
}
