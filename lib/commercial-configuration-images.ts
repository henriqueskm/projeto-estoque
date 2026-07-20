import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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

  const { data, error } = await supabase.storage
    .from(commercialCatalogImagesBucket)
    .createSignedUrls(uniquePaths, signedUrlLifetimeSeconds);

  if (error || !data) {
    return signedUrlByPath;
  }

  data.forEach((image) => {
    if (!image.error && image.path && image.signedUrl) {
      signedUrlByPath.set(image.path, image.signedUrl);
    }
  });

  return signedUrlByPath;
}
