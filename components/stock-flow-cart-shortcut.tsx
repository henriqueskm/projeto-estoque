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
      className="nk-focus sticky bottom-3 z-10 mt-3 flex min-h-13 w-full items-center justify-center rounded-2xl border border-brand-gold-dark bg-brand-gold-soft px-4 text-base font-black text-brand-charcoal shadow-lg shadow-brand-charcoal/15 sm:static sm:inline-flex sm:min-h-11 sm:w-auto sm:rounded-xl sm:px-3 sm:text-sm sm:font-bold sm:shadow-none lg:hidden"
    >
      Ver carrinho ({count})
    </button>
  );
}
