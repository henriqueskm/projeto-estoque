import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // HEIC decoding stays server-only and uses a terminable Node worker.
  serverExternalPackages: ["heic-decode", "libheif-js"],
  outputFileTracingIncludes: {
    "/api/assistant/order-photo/interpret": [
      "./node_modules/heic-decode/**/*", "./node_modules/libheif-js/**/*",
      "./node_modules/sharp/**/*", "./node_modules/@img/**/*",
    ],
  },
};

export default nextConfig;
