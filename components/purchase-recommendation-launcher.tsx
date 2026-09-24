"use client";

import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PurchaseRecommendationPanel } from "@/components/purchase-recommendation-panel";
import type { PurchaseRecommendationsData } from "@/lib/purchase-recommendation-types";
import { inventoryDataChangedEvent } from "@/lib/inventory-ui-events";

const recommendationsView = "purchase-recommendations";
const recommendationHistoryMarker = "nkPurchaseRecommendations";
const recentResultWindowMs = 15_000;

type RequestMode = "foreground" | "background" | "warm";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRecommendations(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.buyNow) ||
    !Array.isArray(value.alreadyOrdered) ||
    !Array.isArray(value.missingMinimum) ||
    !isRecord(value.summary) ||
    !Number.isSafeInteger(value.summary.buyNowCount) ||
    !Number.isSafeInteger(value.summary.alreadyOrderedCount) ||
    !Number.isSafeInteger(value.summary.missingMinimumCount)
  ) {
    return null;
  }

  return value as PurchaseRecommendationsData;
}

function recommendationUrl(isOpen: boolean) {
  const url = new URL(window.location.href);

  if (isOpen) {
    url.searchParams.set("view", recommendationsView);
  } else {
    url.searchParams.delete("view");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function PurchaseRecommendationLauncher({
  initiallyOpen,
}: {
  initiallyOpen: boolean;
}) {
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [data, setData] = useState<PurchaseRecommendationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(initiallyOpen);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dataRef = useRef<PurchaseRecommendationsData | null>(null);
  const confirmedAtRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const requestInFlightRef = useRef<Promise<void> | null>(null);
  const reloadAfterFlightRef = useRef(false);
  const isOpenRef = useRef(initiallyOpen);
  const isMountedRef = useRef(true);
  const loadRef = useRef<(mode: RequestMode) => Promise<void>>(
    async () => undefined,
  );
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const urlRequestsOpen =
    searchParams.get("view") === recommendationsView;

  const loadRecommendations = useCallback((mode: RequestMode) => {
    if (
      mode === "warm" &&
      dataRef.current &&
      Date.now() - confirmedAtRef.current <= recentResultWindowMs
    ) {
      return Promise.resolve();
    }

    if (requestInFlightRef.current) {
      return requestInFlightRef.current;
    }

    const requestGeneration = requestGenerationRef.current;
    const hasConfirmedData = dataRef.current !== null;

    if (mode !== "foreground" && hasConfirmedData) {
      setIsRefreshing(true);
    } else if (!hasConfirmedData) {
      setIsLoading(true);
    }
    setError(null);
    setRefreshError(null);

    const request = (async () => {
      try {
        const response = await fetch("/api/purchase-recommendations", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const message =
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "Não foi possível carregar a lista recomendada.";
          throw new Error(message);
        }

        const parsed = parseRecommendations(payload);
        if (!parsed) {
          throw new Error("Não foi possível validar a lista recomendada.");
        }

        if (
          !isMountedRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }

        dataRef.current = parsed;
        confirmedAtRef.current = Date.now();
        setData(parsed);
        setError(null);
        setRefreshError(null);
      } catch (requestError) {
        if (
          !isMountedRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }

        const message =
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar a lista recomendada.";

        if (hasConfirmedData) {
          setRefreshError(message);
        } else {
          setError(message);
        }
      } finally {
        requestInFlightRef.current = null;

        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }

        if (reloadAfterFlightRef.current && isMountedRef.current) {
          reloadAfterFlightRef.current = false;
          window.setTimeout(() => {
            if (isMountedRef.current) {
              void loadRef.current("foreground");
            }
          }, 0);
        }
      }
    })();

    requestInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    loadRef.current = loadRecommendations;
  }, [loadRecommendations]);

  const close = useCallback(() => {
    setIsOpen(false);
    isOpenRef.current = false;

    const historyState = window.history.state as
      | Record<string, unknown>
      | null;

    if (historyState?.[recommendationHistoryMarker] === true) {
      window.history.back();
      return;
    }

    window.history.replaceState(
      historyState,
      "",
      recommendationUrl(false),
    );
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    isOpenRef.current = true;

    if (
      new URL(window.location.href).searchParams.get("view") !==
      recommendationsView
    ) {
      const historyState = isRecord(window.history.state)
        ? window.history.state
        : {};
      window.history.pushState(
        { ...historyState, [recommendationHistoryMarker]: true },
        "",
        recommendationUrl(true),
      );
    }

    if (!dataRef.current) {
      void loadRecommendations("foreground");
    } else if (Date.now() - confirmedAtRef.current > recentResultWindowMs) {
      void loadRecommendations("background");
    }
  }, [loadRecommendations]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const historySyncTimer = window.setTimeout(() => {
      const nextIsOpen =
        new URL(window.location.href).searchParams.get("view") ===
        recommendationsView;
      setIsOpen(nextIsOpen);
      isOpenRef.current = nextIsOpen;

      if (nextIsOpen && !dataRef.current) {
        void loadRecommendations("foreground");
      }
    }, 0);

    return () => window.clearTimeout(historySyncTimer);
  }, [loadRecommendations, urlRequestsOpen]);

  useEffect(() => {
    const warm = () => void loadRecommendations("warm");
    const idleWindow = window as Window & {
      requestIdleCallback?: Window["requestIdleCallback"];
      cancelIdleCallback?: Window["cancelIdleCallback"];
    };
    let fallbackTimer: number | null = null;
    let idleHandle: number | null = null;

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleHandle = idleWindow.requestIdleCallback(warm, { timeout: 2_000 });
    } else {
      fallbackTimer = window.setTimeout(warm, 1_200);
    }

    return () => {
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [loadRecommendations]);

  useEffect(() => {
    function invalidateRecommendations() {
      requestGenerationRef.current += 1;
      dataRef.current = null;
      confirmedAtRef.current = 0;
      setData(null);
      setError(null);
      setRefreshError(null);

      if (requestInFlightRef.current) {
        reloadAfterFlightRef.current = true;
      } else if (isOpenRef.current) {
        void loadRecommendations("foreground");
      }
    }

    window.addEventListener(
      inventoryDataChangedEvent,
      invalidateRecommendations,
    );

    return () => {
      window.removeEventListener(
        inventoryDataChangedEvent,
        invalidateRecommendations,
      );
    };
  }, [loadRecommendations]);

  return (
    <>
      <a
        ref={triggerRef}
        href="/estoque?view=purchase-recommendations"
        onClick={(event) => {
          event.preventDefault();
          open();
        }}
        onPointerEnter={() => void loadRecommendations("warm")}
        onFocus={() => void loadRecommendations("warm")}
        className="nk-focus inline-flex min-h-11 items-center rounded-xl border border-brand-gold-dark bg-white px-3 text-sm font-black text-brand-gold-ink transition hover:bg-brand-gold-soft"
      >
        Lista recomendada
      </a>

      {isOpen ? (
        <PurchaseRecommendationPanel
          data={data}
          error={error}
          refreshError={refreshError}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          onClose={close}
          onRetry={() => void loadRecommendations("foreground")}
        />
      ) : null}
    </>
  );
}
