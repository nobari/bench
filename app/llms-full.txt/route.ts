import { SITE, absoluteUrl } from "@/lib/site";
import { CATEGORIES } from "@/lib/tools/categories";
import { getToolsByCategory } from "@/lib/tools/registry";

/** llms-full.txt — expanded content (how-it-works + FAQ) for AI answer engines. */
export function GET() {
  const lines: string[] = [];
  lines.push(`# ${SITE.name} — Full Reference`);
  lines.push("");
  lines.push(`> ${SITE.description}`);
  lines.push("");

  for (const cat of CATEGORIES) {
    const tools = getToolsByCategory(cat.slug);
    if (!tools.length) continue;
    lines.push(`## ${cat.name}`);
    lines.push(`${cat.description}`);
    lines.push("");

    for (const t of tools) {
      lines.push(`### ${t.title}`);
      lines.push(`URL: ${absoluteUrl(`/${t.category}/${t.slug}`)}`);
      lines.push("");
      lines.push(t.description);
      if (t.howItWorks) {
        lines.push("");
        lines.push(`How it works: ${t.howItWorks}`);
      }
      if (t.faq?.length) {
        lines.push("");
        for (const f of t.faq) {
          lines.push(`Q: ${f.q}`);
          lines.push(`A: ${f.a}`);
        }
      }
      lines.push("");
    }
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
