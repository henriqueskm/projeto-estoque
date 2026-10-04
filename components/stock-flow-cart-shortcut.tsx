"use client";

export function focusStockFlowCart(heading: HTMLElement | null) {
  if (!heading) return;
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "start",
  });
}

export function StockFlowCartShortcut({
  count,
  headingId,
}: {
  count: number;
  headingId: string;
}) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      aria-controls={headingId}
      onClick={() => focusStockFlowCart(document.getElementById(headingId))}
      className="nk-focus mt-3 inline-flex min-h-11 items-center rounded-xl border border-brand-gold-dark bg-brand-gold-soft px-3 text-sm font-bold text-brand-charcoal lg:hidden"
    >
      Ver carrinho ({count})
    </button>
  );
}
