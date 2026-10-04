function maximumTimeline(duration: string, delay: string) {
  const milliseconds = (value: string) =>
    Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000) || 0;
  const durations = duration.split(",").map(milliseconds);
  const delays = delay.split(",").map(milliseconds);
  return Math.max(0, ...durations.map((value, index) =>
    value + delays[index % delays.length],
  ));
}

// Follow the existing CSS exit. End events are primary; the computed timeline
// is a fallback for interrupted/missing events, never a fixed animation delay.
export function waitForDrawerExit(element: HTMLElement, onComplete: () => void) {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    onComplete();
    return () => {};
  }
  const media = view.matchMedia("(prefers-reduced-motion: reduce)");
  const style = view.getComputedStyle(element);
  const animationMs = maximumTimeline(style.animationDuration, style.animationDelay);
  const transitionMs = maximumTimeline(style.transitionDuration, style.transitionDelay);
  const durationMs = Math.max(animationMs, transitionMs);
  let finished = false;
  let timer: number | undefined;

  function cleanup() {
    if (timer !== undefined) view!.clearTimeout(timer);
    element.removeEventListener("animationend", handleEnd);
    element.removeEventListener("transitionend", handleEnd);
    media.removeEventListener("change", handlePreference);
  }
  function finish() {
    if (finished) return;
    finished = true;
    cleanup();
    onComplete();
  }
  function handleEnd(event: Event) {
    if (event.target !== element) return;
    if (event.type === "animationend" && animationMs >= transitionMs) finish();
    if (event.type === "transitionend" && transitionMs >= animationMs) finish();
  }
  function handlePreference() {
    if (media.matches) finish();
  }

  if (media.matches || durationMs <= 1) {
    finish();
  } else {
    element.addEventListener("animationend", handleEnd);
    element.addEventListener("transitionend", handleEnd);
    media.addEventListener("change", handlePreference);
    timer = view.setTimeout(finish, durationMs + 50);
  }

  return () => {
    finished = true;
    cleanup();
  };
}
