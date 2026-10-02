import { matchesCatalogSearch, normalizeCatalogSearch } from "@/lib/catalog-search";

export type StockFlowCatalogSection = "separate" | "repair" | "commercial" | "bundles";

export function buildStockFlowSearch<T>(
  sections: Record<StockFlowCatalogSection, T[]>,
  search: string,
  manualOpenSection: StockFlowCatalogSection | null,
  searchText: (option: T) => string,
) {
  const query = normalizeCatalogSearch(search);
  return Object.fromEntries(
    Object.entries(sections).map(([section, options]) => {
      const results = query
        ? options.filter((option) =>
            matchesCatalogSearch(query, [searchText(option)]),
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
