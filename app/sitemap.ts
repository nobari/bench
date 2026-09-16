import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS } from "@/lib/tools/registry";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/suggest"), lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/about"), lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map((c) => ({
    url: absoluteUrl(`/${c.slug}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const toolPages: MetadataRoute.Sitemap = TOOLS.map((t) => ({
    url: absoluteUrl(`/${t.category}/${t.slug}`),
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticPages, ...categoryPages, ...toolPages];
}
