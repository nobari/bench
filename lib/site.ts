/**
 * Global site configuration. Single source of truth for branding, base URL,
 * and external links. Read by metadata, sitemap, robots, llms.txt, OG images.
 */

export const SITE = {
  name: "Bench",
  /** Canonical production URL. */
  url: "https://bench.bozmoz.com",
  /** Used in <title> templates and wordmark. */
  wordmark: "Bench",
  tagline: "Everyday tools for text, data, media and the web",
  description:
    "Free browser tools for text, JSON, images, video, audio and more. Most processing stays on your device; sharing and network tools use online services.",
  /** GitHub repo used by the “Suggest a tool” server action + footer link. */
  repo: "nobari/bench",
  links: {
    github: "https://github.com/nobari/bench",
    suggest: "/suggest",
  },
  /** Optional ways to support the project, shown in the footer. */
  support: {
    bitcoin: "bc1quh9e83s8je65j5lr9jnew2r3et72874wdgj2lf",
  },
  author: "Bench",
  locale: "en_US",
} as const;

/** Canonicals identify the public site, never an automatic preview or localhost host. */
export function getBaseUrl(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || SITE.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be an origin without credentials, path, query or fragment",
    );
  }
  return url.origin;
}

export const isPreview = process.env.VERCEL_ENV === "preview";

/** Absolute URL builder for canonical tags, OG, sitemap, etc. */
export function absoluteUrl(path = "/"): string {
  const base = getBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
