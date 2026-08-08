"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SafisaPickupAlertsResult } from "@/lib/safisa-pickup-alerts";
import {
  applySafisaPickupAlertRefreshFailure,
  applySafisaPickupAlertRefreshSuccess,
  initializeSafisaPickupAlertReadState,
  type SafisaPickupAlertReadState,
} from "@/lib/safisa-pickup-alert-state";

type SafisaPickupAlertsContextValue = SafisaPickupAlertReadState["data"] &
  Pick<SafisaPickupAlertReadState, "error" | "hasConfirmedData"> & {
  isRefreshing: boolean;
  refreshAlerts: () => Promise<void>;
};

const SafisaPickupAlertsContext =
  createContext<SafisaPickupAlertsContextValue | null>(null);

export function SafisaPickupAlertProvider({
  children,
  initialResult,
}: {
  children: ReactNode;
  initialResult: SafisaPickupAlertsResult;
}) {
  const [state, setState] = useState(() =>
    initializeSafisaPickupAlertReadState(initialResult),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);

  const refreshAlerts = useCallback(async () => {
    if (refreshInFlightRef.current) return;

    refreshInFlightRef.current = true;
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/safisa-pickup-alerts", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        setState((previous) => applySafisaPickupAlertRefreshFailure(previous));
        return;
      }

      const next = (await response.json()) as SafisaPickupAlertsResult["data"];
      if (
        !Array.isArray(next.alerts) ||
        !Number.isSafeInteger(next.alertCount) ||
        typeof next.isComplete !== "boolean"
      ) {
        setState((previous) => applySafisaPickupAlertRefreshFailure(previous));
        return;
      }

      setState(applySafisaPickupAlertRefreshSuccess(next));
    } catch {
      setState((previous) => applySafisaPickupAlertRefreshFailure(previous));
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshAlerts();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, 60_000);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, [refreshAlerts]);

  return (
    <SafisaPickupAlertsContext.Provider
      value={{
        ...state.data,
        error: state.error,
        hasConfirmedData: state.hasConfirmedData,
        isRefreshing,
        refreshAlerts,
      }}
    >
      {children}
    </SafisaPickupAlertsContext.Provider>
  );
}

export function useSafisaPickupAlerts() {
  const context = useContext(SafisaPickupAlertsContext);

  if (!context) {
    throw new Error("useSafisaPickupAlerts must be used within its provider.");
  }

  return context;
}
