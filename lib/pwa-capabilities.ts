export type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function isStandaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

export function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function canUseServiceWorker() {
  return (
    "serviceWorker" in navigator &&
    (window.isSecureContext || window.location.hostname === "localhost")
  );
}
