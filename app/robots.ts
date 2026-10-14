import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Explicitly welcome search crawlers and AI answer engines (GEO).
        userAgent: "*",
        allow: "/",
        // Embed pages are tools without the site around them, meant for frames, not for search.
        disallow: ["/embed/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
