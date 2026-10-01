export type StockFlowCatalogSection = "separate" | "repair" | "commercial";

export function buildStockFlowSearch<T>(
  sections: Record<StockFlowCatalogSection, T[]>,
  search: string,
  manualOpenSection: StockFlowCatalogSection | null,
  searchText: (option: T) => string,
) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const query = normalize(search);
  return Object.fromEntries(
    Object.entries(sections).map(([section, options]) => {
      const results = query
        ? options.filter((option) =>
            normalize(searchText(option)).includes(query),
          )
        : options;
      return [
        section,
        {
          results,
          count: results.length,
          isOpen: query ? results.length > 0 : manualOpenSection === section,
        },
      ];
    }),
  ) as Record<
    StockFlowCatalogSection,
    { results: T[]; count: number; isOpen: boolean }
  >;
}
