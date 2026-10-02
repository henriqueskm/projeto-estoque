/** Search-only normalization: never changes stored or displayed catalog codes. */
export function normalizeCatalogSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").trim();
}

export function compactCatalogSearch(value: string) {
  return normalizeCatalogSearch(value).replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchesCatalogSearch(
  search: string,
  values: Array<string | null | undefined>,
) {
  const query = normalizeCatalogSearch(search);
  if (!query) return true;
  const compactQuery = compactCatalogSearch(query);
  return values.some((value) => value != null && (
    normalizeCatalogSearch(value).includes(query) ||
    (compactQuery.length > 0 && compactCatalogSearch(value).includes(compactQuery))
  ));
}
