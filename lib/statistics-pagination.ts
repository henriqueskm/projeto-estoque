export type StatisticsPageResult<T> = {
  data: T[] | null;
  error: unknown;
};

export const statisticsPageSize = 1_000;

export async function fetchAllStatisticsRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<StatisticsPageResult<T>>,
  pageSize = statisticsPageSize,
): Promise<StatisticsPageResult<T>> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);

    if (result.error) {
      return { data: null, error: result.error };
    }

    const page = result.data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      return { data: rows, error: null };
    }
  }
}
