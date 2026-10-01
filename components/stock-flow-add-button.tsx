export function StockFlowAddButton({
  isSelected,
  onAdd,
  label,
}: {
  isSelected: boolean;
  onAdd: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={isSelected}
      onClick={onAdd}
      aria-label={isSelected ? `${label.replace(/^Adicionar\s+/i, "")} adicionado` : label}
      className="nk-focus -mx-2 inline-flex min-h-11 w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-brand-charcoal px-0 text-sm font-bold text-white disabled:cursor-default disabled:opacity-50 sm:mx-0 sm:w-auto sm:px-3"
    >
      <span aria-hidden="true" className="text-xl leading-none sm:hidden">{isSelected ? "✓" : "+"}</span>
      <span aria-hidden="true" className="hidden sm:inline">{isSelected ? "Adicionado" : "Adicionar"}</span>
    </button>
  );
}
