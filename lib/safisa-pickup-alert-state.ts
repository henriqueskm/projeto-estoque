import type { SafisaPickupAlert } from "@/lib/safisa-pickup-alerts-contract";

export type SafisaPickupAlertsData = {
  alerts: SafisaPickupAlert[];
  alertCount: number;
  isComplete: boolean;
};

export type SafisaPickupAlertLoadResult = {
  data: SafisaPickupAlertsData;
  error: string | null;
};

export type SafisaPickupAlertReadState = SafisaPickupAlertLoadResult & {
  hasConfirmedData: boolean;
};

export const safisaPickupAlertUnavailableMessage =
  "Não foi possível atualizar as retiradas Safisa agora.";

const unknownSafisaPickupAlertsData: SafisaPickupAlertsData = {
  alerts: [],
  alertCount: 0,
  isComplete: false,
};

export function initializeSafisaPickupAlertReadState(
  result?: SafisaPickupAlertLoadResult,
): SafisaPickupAlertReadState {
  if (!result) {
    return {
      data: unknownSafisaPickupAlertsData,
      error: null,
      hasConfirmedData: false,
    };
  }

  return {
    ...result,
    hasConfirmedData: result.error === null,
  };
}

export function applySafisaPickupAlertRefreshSuccess(
  data: SafisaPickupAlertsData,
): SafisaPickupAlertReadState {
  return {
    data,
    error: null,
    hasConfirmedData: true,
  };
}

export function applySafisaPickupAlertRefreshFailure(
  previous: SafisaPickupAlertReadState,
): SafisaPickupAlertReadState {
  return {
    ...previous,
    error: safisaPickupAlertUnavailableMessage,
  };
}
