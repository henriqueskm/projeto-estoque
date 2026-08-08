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

type SafisaPickupAlertsContextValue = {
  alerts: SafisaPickupAlertsResult["data"]["alerts"];
  alertCount: number;
  isComplete: boolean;
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
  const [data, setData] = useState(initialResult.data);
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

      if (!response.ok) return;

      const next = (await response.json()) as SafisaPickupAlertsResult["data"];
      if (
        !Array.isArray(next.alerts) ||
        !Number.isSafeInteger(next.alertCount) ||
        typeof next.isComplete !== "boolean"
      ) {
        return;
      }

      setData(next);
    } catch {
      // Keep the most recent safe server state. Alert refreshes are non-blocking.
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
        alerts: data.alerts,
        alertCount: data.alertCount,
        isComplete: data.isComplete,
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
