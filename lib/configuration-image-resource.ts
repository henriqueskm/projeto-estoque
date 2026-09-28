export type ConfigurationImageSource =
  | { imageUrl: string | null; configurationId?: never; hasImage?: never }
  | { imageUrl?: never; configurationId: string; hasImage: boolean };

// Owned by one mounted photo control. No global/persistent URL cache.
export function createConfigurationImageResource(
  configurationId: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let cached: { imageUrl: string; safeUntil: number } | null = null;
  let pending: Promise<{ imageUrl: string; reused: boolean }> | null = null;
  return {
    invalidate() { cached = null; },
    async resolve() {
      if (cached && now() < cached.safeUntil) return { imageUrl: cached.imageUrl, reused: true };
      if (pending) return pending;
      const requestedAt = now();
      pending = (async () => {
        const response = await fetcher(`/api/catalog/configuration-image?configurationId=${encodeURIComponent(configurationId)}`,
          { cache: "no-store", credentials: "same-origin" });
        const body = await response.json();
        if (!response.ok || typeof body.imageUrl !== "string" || !body.imageUrl ||
          typeof body.expiresInSeconds !== "number" || !Number.isFinite(body.expiresInSeconds) || body.expiresInSeconds <= 0) {
          throw new Error("Não foi possível carregar a foto. Tente novamente.");
        }
        cached = { imageUrl: body.imageUrl, safeUntil: requestedAt + body.expiresInSeconds * 1000 - 60_000 };
        return { imageUrl: body.imageUrl, reused: false };
      })();
      try { return await pending; } finally { pending = null; }
    },
  };
}
