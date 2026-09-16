import { SITE, absoluteUrl } from "@/lib/site";
import { CATEGORIES } from "@/lib/tools/categories";
import { getToolsByCategory } from "@/lib/tools/registry";

/**
 * llms.txt — a concise, machine-readable index for AI answer engines.
 * Spec: https://llmstxt.org
 */
export function GET() {
  const lines: string[] = [];
  lines.push(`# ${SITE.name}`);
  lines.push("");
  lines.push(`> ${SITE.tagline}. ${SITE.description}`);
  lines.push("");
  lines.push(
    "Every tool runs entirely client-side in the browser — no uploads, no accounts, no rate limits. Inputs and settings are encoded in the URL so results are directly shareable.",
  );
  lines.push("");

  for (const cat of CATEGORIES) {
    const tools = getToolsByCategory(cat.slug);
    if (!tools.length) continue;
    lines.push(`## ${cat.name}`);
    lines.push("");
    for (const t of tools) {
      lines.push(
        `- [${t.title}](${absoluteUrl(`/${t.category}/${t.slug}`)}): ${t.description}`,
      );
    }
    lines.push("");
  }

  lines.push("## More");
  lines.push("");
  lines.push(`- [Suggest a tool](${absoluteUrl("/suggest")}): Request a new utility.`);
  lines.push(`- [Full details](${absoluteUrl("/llms-full.txt")}): Expanded descriptions, how-it-works and FAQs.`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
