export type SupabaseReadPage<T> = {
  data: T[] | null;
  error: unknown;
};

export type SupabaseReadResult<T> = SupabaseReadPage<T>;

export const supabaseReadPageSize = 1_000;

const maxPageCount = 100_000;

export async function fetchAllSupabaseRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<SupabaseReadPage<T>>,
  rowKey: (row: T) => string,
  options: { rowLimit?: number } = {},
): Promise<SupabaseReadResult<T>> {
  const rows: T[] = [];
  const seenKeys = new Set<string>();

  for (let pageIndex = 0; pageIndex < maxPageCount; pageIndex += 1) {
    const from = pageIndex * supabaseReadPageSize;
    const remaining = options.rowLimit
      ? options.rowLimit - rows.length
      : supabaseReadPageSize;

    if (remaining <= 0) return { data: rows, error: null };

    const requestedSize = Math.min(supabaseReadPageSize, remaining);
    const result = await fetchPage(from, from + requestedSize - 1);

    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    if (page.length > requestedSize) {
      return {
        data: null,
        error: new Error("A leitura paginada retornou mais linhas que o solicitado."),
      };
    }

    for (const row of page) {
      const key = rowKey(row);
      if (!key || seenKeys.has(key)) {
        return {
          data: null,
          error: new Error(
            "A leitura paginada não avançou de forma estável. Tente novamente.",
          ),
        };
      }

      seenKeys.add(key);
      rows.push(row);
    }

    if (options.rowLimit && rows.length >= options.rowLimit) {
      return { data: rows, error: null };
    }

    if (page.length < requestedSize) return { data: rows, error: null };
  }

  return {
    data: null,
    error: new Error("A leitura paginada excedeu o limite de segurança."),
  };
}

export function chunkSupabaseFilterValues<T>(values: T[], size = 100) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("O tamanho do bloco deve ser um inteiro positivo.");
  }

  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

export async function fetchAllSupabaseRowsByChunks<TValue, TRow>(
  values: TValue[],
  fetchPage: (
    chunk: TValue[],
    from: number,
    to: number,
  ) => PromiseLike<SupabaseReadPage<TRow>>,
  rowKey: (row: TRow) => string,
  chunkSize = 100,
): Promise<SupabaseReadResult<TRow>> {
  const rows: TRow[] = [];
  const seenKeys = new Set<string>();

  for (const chunk of chunkSupabaseFilterValues(values, chunkSize)) {
    const result = await fetchAllSupabaseRows(
      (from, to) => fetchPage(chunk, from, to),
      rowKey,
    );
    if (result.error) return { data: null, error: result.error };

    for (const row of result.data ?? []) {
      const key = rowKey(row);
      if (seenKeys.has(key)) {
        return {
          data: null,
          error: new Error("A leitura em blocos retornou linhas duplicadas."),
        };
      }
      seenKeys.add(key);
      rows.push(row);
    }
  }

  return { data: rows, error: null };
}
