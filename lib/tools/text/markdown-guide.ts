/**
 * A guide for a language model that writes Markdown for the Bench editor: what the editor renders, the exact
 * syntax of its extensions (alerts, Mermaid, embedded tools), and every tool it can frame with a ready link.
 * Pure: the editor copies or downloads the text.
 */
import { TOOLS } from "@/lib/tools/registry";
import { CATEGORIES } from "@/lib/tools/categories";
import { BENCH_HOST } from "./markdown";

export function markdownGuide(): string {
  const origin = `https://${BENCH_HOST}`;
  const lines: string[] = [];
  lines.push(
    "# Writing Markdown for the Bench Markdown editor",
    "",
    `Instructions for a language model. The document you write is pasted into the Markdown editor at ${origin}/web/markdown, which renders GitHub-flavoured Markdown with a few extensions. Write plain Markdown; use the extensions below where they help. Everything renders in the browser; nothing is uploaded.`,
    "",
    "## Markdown the editor renders",
    "",
    "- CommonMark plus GitHub extensions: headings (each gets an anchor id made from its text, so `[see Lists](#lists)` links to a heading named “Lists”), emphasis, strikethrough, links, images (lazy-loaded), block quotes, ordered and bulleted lists, task lists (`- [ ]` and `- [x]`), tables with column alignment (`| :--- | :---: | ---: |`), horizontal rules, autolinked URLs, and inline HTML (sanitised: no scripts, no event handlers).",
    "- Fenced code blocks with a language get syntax highlighting, a language label and a copy button. Highlighted languages: JavaScript, TypeScript, JSON, Python, Go, Rust, Java, C, SQL, Bash, CSS, HTML/XML, YAML, Markdown and diff. Other languages render as plain code.",
    "- An outline of the headings, a fill-the-window reading mode and full screen are the reader's choices; nothing in the document controls them.",
    "",
    "## Alerts (callouts)",
    "",
    "A block quote whose first line is one of `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` renders as a titled callout:",
    "",
    "```markdown",
    "> [!TIP]",
    "> Keep headings short; the outline shows them verbatim.",
    "```",
    "",
    "## Diagrams (Mermaid)",
    "",
    "A fenced block with the language `mermaid` is drawn as a diagram (flowchart, sequence, class, state, ER, Gantt, pie, mindmap, timeline and the other Mermaid types), in the site's theme:",
    "",
    "```markdown",
    "```mermaid",
    "flowchart LR",
    "  A[Draft] --> B{Review}",
    "  B -->|approved| C[Publish]",
    "  B -->|changes| A",
    "```",
    "```",
    "",
    "## Embedding another Bench tool",
    "",
    "A fenced block with the language `embed` frames another Bench tool inside the document, live and interactive, in whatever state the link carries. The first line is the tool's link; optional lines set a title and a fixed height (200–2000 px; without it the frame fits its content):",
    "",
    "```markdown",
    "```embed",
    `${origin}/json/schema?m=design&s=%7B%22type%22%3A%22object%22%7D`,
    "title: The record schema",
    "height: 640",
    "```",
    "```",
    "",
    "Rules for the link:",
    "",
    `- It must point at a tool page on ${BENCH_HOST} (or a Bench short link \`${origin}/s/<code>\`). Any other link leaves the block as plain code.`,
    "- State goes in the link. Each tool reads its own query parameters, listed below with a working example; large inputs are usually plain query parameters too (`i=` for text, `s=`/`d=` for the JSON Schema tool), percent-encoded. Links made by a tool's own Share button also work and may carry compressed state in the hash.",
    "- Keep one tool per block. The reader sees a bar with the title and an “Open in Bench” link above the frame; in print the block becomes a link.",
    "",
    "## Tools you can embed",
    "",
    `Every link is \`${origin}/<path>?<parameters>\`. The example after each tool is a complete, working link.`,
    "",
  );
  for (const cat of CATEGORIES) {
    const tools = TOOLS.filter((t) => t.category === cat.slug && t.slug !== "markdown");
    if (!tools.length) continue;
    lines.push(`### ${cat.name}`, "");
    for (const t of tools) {
      const ex = t.examples?.[0];
      const link = ex?.query ? `${origin}/${t.category}/${t.slug}?${ex.query}` : `${origin}/${t.category}/${t.slug}`;
      lines.push(`- **${t.title}** (\`/${t.category}/${t.slug}\`): ${t.tagline}.${ex ? ` Example — ${ex.label}: <${link}>` : ` Link: <${link}>`}`);
      const more = (t.examples ?? []).slice(1, 3);
      for (const e of more) lines.push(`  - ${e.label}: <${origin}/${t.category}/${t.slug}?${e.query}>`);
    }
    lines.push("");
  }
  lines.push(
    "## Things the document cannot do",
    "",
    "- Annotations (highlights and comments on the preview) are made by readers in the editor, not written in the Markdown.",
    "- Raw HTML is sanitised: no `<script>`, no inline event handlers, no `javascript:` links, and only Bench embed frames are kept.",
    "- The editor keeps a draft in the browser; a Share link carries the whole document compressed, so very large embeds of state belong in the tool's own link, not pasted inline.",
    "",
  );
  return lines.join("\n");
}
