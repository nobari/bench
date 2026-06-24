/**
 * Global site configuration. Single source of truth for branding, base URL,
 * and external links. Read by metadata, sitemap, robots, llms.txt, OG images.
 */

export const SITE = {
  name: "Bench",
  /** Used in <title> templates and wordmark. */
  wordmark: "BENCH",
  tagline: "A precision toolkit for the web",
  description:
    "Fast, private, no-nonsense developer utilities. Encode, decode, convert, inspect and generate — every tool runs entirely in your browser. No uploads, no tracking, no limits.",
  /** GitHub repo used by the “Suggest a tool” server action + footer link. */
  repo: "nobari/bench",
  links: {
    github: "https://github.com/nobari/bench",
    suggest: "/suggest",
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
