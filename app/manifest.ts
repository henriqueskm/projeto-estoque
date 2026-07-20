import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Negócios K",
    short_name: "Negócios K",
    description: "Controle de estoque Negócios K",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5F1",
    theme_color: "#171D21",
    icons: [
      {
        src: "/icons/nk-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/nk-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/nk-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/nk-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
