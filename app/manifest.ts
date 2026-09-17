import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — ${SITE.tagline}`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#faf7ef",
    theme_color: "#68a52a",
    categories: ["productivity", "utilities", "developer"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
