import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { unstable_cache, revalidateTag } from "next/cache";
import { cache } from "react";
import { requireActiveProfile } from "@/lib/auth";
import { logPerformanceAudit, measurePerformanceAudit, performancePayloadBytes } from "@/lib/performance-audit";
import { createClient } from "@/lib/supabase/server";
import { fetchAllSupabaseRows } from "@/lib/supabase-read-pagination";
import type { PhysicalStockItemType } from "@/lib/stock-calculations";

export type SharedCatalogItemRow = {
  id: string;
  code: string;
  description: string;
  item_type: PhysicalStockItemType;
  is_active: boolean;
};

export type SharedCatalogServoModelRow = {
  item_id: string;
  model: string | null;
};

export type SharedCatalogConfigurationRow = {
  id: string;
  description: string | null;
  servo_id: string;
  installation_kit_id: string;
  is_active: boolean;
  image_path: string | null;
};

export type SharedCatalogCommercialCodeRow = {
  id: string;
  configuration_id: string;
  code: string;
  is_active: boolean;
};

export type SharedCatalogSnapshot = {
  items: SharedCatalogItemRow[];
  servoModels: SharedCatalogServoModelRow[];
  configurations: SharedCatalogConfigurationRow[];
  commercialCodes: SharedCatalogCommercialCodeRow[];
};

type CatalogClient = Awaited<ReturnType<typeof createClient>>;

const nkCatalogCacheTag = "nk-shared-catalog-v1";
const catalogCacheFallbackSeconds = 60 * 60;

export class SharedCatalogError extends Error {
  constructor() {
    super("Shared catalog data is unavailable.");
    this.name = "SharedCatalogError";
  }
}

export async function readSharedCatalogSnapshot(
  supabase: Pick<CatalogClient, "from">,
): Promise<SharedCatalogSnapshot> {
  const startedAt = performance.now();
  const [itemsResult, servoModelsResult, configurationsResult, codesResult] =
    await Promise.all([
      fetchAllSupabaseRows<SharedCatalogItemRow>(
        (from, to) =>
          supabase
            .from("items")
            .select("id, code, description, item_type, is_active")
            .order("id")
            .range(from, to),
        (row) => row.id,
      ),
      fetchAllSupabaseRows<SharedCatalogServoModelRow>(
        (from, to) =>
          supabase
            .from("servo_models")
            .select("item_id, model")
            .order("item_id")
            .range(from, to),
        (row) => row.item_id,
      ),
      fetchAllSupabaseRows<SharedCatalogConfigurationRow>(
        (from, to) =>
          supabase
            .from("commercial_configurations")
            .select(
              "id, description, servo_id, installation_kit_id, is_active, image_path",
            )
            .order("id")
            .range(from, to),
        (row) => row.id,
      ),
      fetchAllSupabaseRows<SharedCatalogCommercialCodeRow>(
        (from, to) =>
          supabase
            .from("commercial_configuration_codes")
            .select("id, configuration_id, code, is_active")
            .order("id")
            .range(from, to),
        (row) => row.id,
      ),
    ]);

  if (
    itemsResult.error ||
    servoModelsResult.error ||
    configurationsResult.error ||
    codesResult.error
  ) {
    throw new SharedCatalogError();
  }

  const snapshot = {
    items: (itemsResult.data ?? []) as SharedCatalogItemRow[],
    servoModels: (servoModelsResult.data ?? []) as SharedCatalogServoModelRow[],
    configurations: (configurationsResult.data ??
      []) as SharedCatalogConfigurationRow[],
    commercialCodes: (codesResult.data ??
      []) as SharedCatalogCommercialCodeRow[],
  };
  logPerformanceAudit({
    loader: "shared_catalog",
    phase: "structural_read",
    durationMs: Math.round(performance.now() - startedAt),
    streamCount: 4,
    rowCount: snapshot.items.length + snapshot.servoModels.length + snapshot.configurations.length + snapshot.commercialCodes.length,
    payloadBytes: performancePayloadBytes(snapshot),
  });
  return snapshot;
}

export async function loadSharedCatalogForCurrentRequest() {
  const gateStartedAt = performance.now();
  // This gate runs once per render/request (React cache), before any persistent
  // cache lookup. A logged-out or inactive profile can never receive a hit.
  const profile = await requireActiveProfile();
  const requestClient = await createClient();
  const { data: sessionData, error: sessionError } = await measurePerformanceAudit(
    "shared_catalog", "session", () => requestClient.auth.getSession(),
  );
  const session = sessionData.session;

  if (
    sessionError ||
    !session?.access_token ||
    session.user.id !== profile.id
  ) {
    throw new SharedCatalogError();
  }
  logPerformanceAudit({ loader: "shared_catalog", phase: "auth_gate", durationMs: Math.round(performance.now() - gateStartedAt) });

  // Resolve request-only cookies before entering unstable_cache. The cached
  // callback receives a token-bound client with no cookie adapter, so misses
  // still execute under this user's JWT/RLS while hits stay user-scoped.
  const catalogClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    },
  );
  let readExecuted = false;
  const loadUserCatalog = unstable_cache(
    () => {
      readExecuted = true;
      return readSharedCatalogSnapshot(catalogClient);
    },
    ["nk-shared-catalog", profile.id],
    {
      tags: [nkCatalogCacheTag],
      revalidate: catalogCacheFallbackSeconds,
    },
  );

  const cacheStartedAt = performance.now();
  const snapshot = await loadUserCatalog();
  logPerformanceAudit({
    loader: "shared_catalog",
    phase: "cache_lookup",
    durationMs: Math.round(performance.now() - cacheStartedAt),
    catalogReadFromSource: readExecuted,
    rowCount: snapshot.items.length + snapshot.servoModels.length + snapshot.configurations.length + snapshot.commercialCodes.length,
  });
  return snapshot;
}

// React cache is request-scoped deduplication. unstable_cache above is the
// distinct, persistent, user-scoped catalog cache used across navigations.
// Next does not guarantee coalescing separate requests that cold-miss after
// invalidation; those reads are idempotent and may refill concurrently. A
// process-local lock would not be Vercel-wide, so none is introduced here.
export const loadSharedCatalogSnapshot = cache(
  loadSharedCatalogForCurrentRequest,
);

export function invalidateNkCatalog() {
  // Catalog writes require read-your-own-writes. The next read blocks for a
  // fresh fill instead of serving one stale catalog response.
  revalidateTag(nkCatalogCacheTag, { expire: 0 });
}
