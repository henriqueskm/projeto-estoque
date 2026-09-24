import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logPerformanceAudit } from "@/lib/performance-audit";

const commercialCatalogImagesBucket = "commercial-catalog-images";
const signedUrlLifetimeSeconds = 10 * 60;

export async function createCommercialImageUrlMap(
  supabase: SupabaseClient,
  imagePaths: Array<string | null | undefined>,
) {
  const uniquePaths = Array.from(
    new Set(imagePaths.filter((path): path is string => Boolean(path))),
  );
  const signedUrlByPath = new Map<string, string>();

  if (uniquePaths.length === 0) {
    return signedUrlByPath;
  }

  const startedAt = performance.now();
  const { data, error } = await supabase.storage
    .from(commercialCatalogImagesBucket)
    .createSignedUrls(uniquePaths, signedUrlLifetimeSeconds);

  if (error || !data) {
    logPerformanceAudit({ loader: "images", phase: "signed_urls_error", durationMs: Math.round(performance.now() - startedAt), imagePathCount: uniquePaths.length });
    return signedUrlByPath;
  }

  data.forEach((image) => {
    if (!image.error && image.path && image.signedUrl) {
      signedUrlByPath.set(image.path, image.signedUrl);
    }
  });

  logPerformanceAudit({ loader: "images", phase: "signed_urls", durationMs: Math.round(performance.now() - startedAt), imagePathCount: uniquePaths.length, rowCount: signedUrlByPath.size });

  return signedUrlByPath;
}
