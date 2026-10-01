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
      aria-label={isSelected ? `${label} — adicionado` : label}
      className="nk-focus inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-brand-charcoal px-3 text-sm font-bold text-white disabled:cursor-default disabled:opacity-50"
    >
      {isSelected ? "Adicionado" : "Adicionar"}
    </button>
  );
}
