import type { MetadataRoute } from "next";
import { absoluteUrl, isPreview } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Embeds and previews must be fetched for their noindex directives to be seen.
    // Use deployment protection for private content, not robots.txt.
    rules: { userAgent: "*", allow: "/" },
    ...(isPreview ? {} : { sitemap: absoluteUrl("/sitemap.xml") }),
  };
}
