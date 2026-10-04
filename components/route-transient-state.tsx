"use client";

import { createContext, useContext, useEffectEvent, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { attachRouteVisit, createRouteMutationGate, createRouteVisit, startRouteMutation } from "@/lib/route-transient-state";

const MutationContext = createContext<ReturnType<typeof createRouteMutationGate> | null>(null);
const idle = () => false;
const subscribeNothing = () => () => {};

export function useRouteTransientCleanup(reset: () => void, enabled = true) {
  const [visit] = useState(createRouteVisit);
  const resetTransient = useEffectEvent(reset);
  useLayoutEffect(() => {
    if (!enabled) return;
    return attachRouteVisit(visit, () => resetTransient(), window);
  }, [visit, enabled]);
  return visit;
}

export function useRouteMutationPending() {
  const gate = useContext(MutationContext);
  return useSyncExternalStore(gate?.subscribe ?? subscribeNothing, gate?.isPending ?? idle, idle);
}

export function RouteMutationBoundary({ children }: { children: ReactNode }) {
  const [gate] = useState(createRouteMutationGate);
  const pending = useSyncExternalStore(gate.subscribe, gate.isPending, idle);
  return <MutationContext.Provider value={gate}>
    {pending ? <p role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Uma operação está em andamento. Aguarde o resultado antes de enviar outra.</p> : null}
    {children}
  </MutationContext.Provider>;
}

export function useRouteMutation(startTransition: (action: () => Promise<void>) => void, onInactiveSettled?: () => void) {
  const sharedGate = useContext(MutationContext);
  const [fallbackGate] = useState(createRouteMutationGate);
  const visit = useRouteTransientCleanup(() => {});
  const gate = sharedGate ?? fallbackGate;
  return (action: (isCurrentVisit: () => boolean) => Promise<void>) =>
    startRouteMutation(gate, visit, startTransition, action, onInactiveSettled);
}
