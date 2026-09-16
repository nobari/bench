/**
 * Global site configuration. Single source of truth for branding, base URL,
 * and external links. Read by metadata, sitemap, robots, llms.txt, OG images.
 */

export const SITE = {
  name: "Bench",
  /** Used in <title> templates and wordmark. */
  wordmark: "Bench",
  tagline: "Everyday tools for text, data, images and the web",
  description:
    "Fast, private utilities for text, JSON, images, files, hashing, time, color, math and the web. Every tool runs in your browser — no uploads, no accounts, no tracking.",
  /** GitHub repo used by the “Suggest a tool” server action + footer link. */
  repo: "nobari/bench",
  links: {
    github: "https://github.com/nobari/bench",
    suggest: "/suggest",
  },
  /** Optional ways to support the project, shown in the footer. */
  support: {
    bitcoin: "bc1qawue0yw963rx82cpl5l0y6tf7l4v8de7a9x0w5",
  },
  author: "Bench",
  locale: "en_US",
} as const;

/**
 * Resolve the canonical base URL across environments.
 * Priority: explicit env → Vercel production domain → Vercel preview → localhost.
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return stripTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

function stripTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Absolute URL builder for canonical tags, OG, sitemap, etc. */
export function absoluteUrl(path = "/"): string {
  const base = getBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
