/**
 * Where tools and categories used to live. Every entry becomes a permanent redirect in next.config.ts,
 * so links that were indexed or shared before a move keep working. Query strings pass through.
 * Keep this file dependency-free: next.config.ts imports it.
 */
export const MOVED_CATEGORIES: { from: string; to: string }[] = [{ from: "image", to: "media" }];

/** Individual tools that changed category (checked before the category-wide rules). */
export const MOVED_TOOLS: { from: string; to: string }[] = [
  { from: "image/comic-reader", to: "files/comic-reader" },
  { from: "generators/qr-code", to: "media/qr-code" },
  { from: "text/eip55-checksum", to: "crypto/eip55-checksum" },
  { from: "text/markdown", to: "web/markdown" },
];

/** The redirect rules, most specific first. */
export function movedRedirects(): { source: string; destination: string; permanent: true }[] {
  return [
    ...MOVED_TOOLS.map((m) => ({ source: `/${m.from}`, destination: `/${m.to}`, permanent: true as const })),
    ...MOVED_CATEGORIES.flatMap((m) => [
      { source: `/${m.from}`, destination: `/${m.to}`, permanent: true as const },
      { source: `/${m.from}/:slug`, destination: `/${m.to}/:slug`, permanent: true as const },
    ]),
  ];
}
