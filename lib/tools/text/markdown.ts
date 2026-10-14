/**
 * Markdown editor engine: GFM rendering with heading anchors and syntax
 * highlighting (marked + highlight.js), text statistics, the toolbar's
 * selection-editing operations, and a standalone HTML export. Sanitisation
 * is injected (DOMPurify in the browser) so this module stays DOM-free and
 * testable in Node.
 */

import { Marked, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS: Record<string, unknown> = {
  bash, sh: bash, shell: bash, zsh: bash, c, css, diff, go, java, javascript, js: javascript, jsx: javascript, json, markdown,
  md: markdown, python, py: python, rust, rs: rust, sql, typescript, ts: typescript, tsx: typescript, xml, html: xml, svg: xml,
  yaml, yml: yaml,
};
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang as Parameters<typeof hljs.registerLanguage>[1]);

export const HIGHLIGHT_LANGUAGES = Object.keys(LANGS);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "section";
}

export interface HeadingInfo {
  depth: number;
  text: string;
  id: string;
}

let slugCounts = new Map<string, number>();
let collected: HeadingInfo[] = [];

/** Highlighted code blocks, by language and source: while typing elsewhere every unchanged block is reused as is. */
const highlighted = new Map<string, string>();
const HIGHLIGHT_CACHE = 300;
function highlight(language: string, text: string): string {
  const key = `${language}\u0000${text}`;
  const hit = highlighted.get(key);
  if (hit !== undefined) return hit;
  const out = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  if (highlighted.size >= HIGHLIGHT_CACHE) highlighted.delete(highlighted.keys().next().value as string);
  highlighted.set(key, out);
  return out;
}

/** GitHub-style alerts: a blockquote opening with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION]. */
export const ALERT_KINDS: Record<string, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      // A Mermaid fence becomes a diagram in the browser; the source stays inside until it is drawn (and for exports).
      // (The source rides only in the <pre>: in an attribute, Mermaid's "-->" arrows would be stripped as unsafe markup.)
      if (language === "mermaid") return `<div class="md-mermaid" data-diagram="mermaid"><pre class="md-mermaid-src"><code>${escapeHtml(text)}</code></pre></div>\n`;
      const out = highlight(language, text);
      const cls = `hljs${language ? ` language-${escapeHtml(language)}` : ""}`;
      return `<div class="md-code"><div class="md-code-bar"><span class="md-lang">${escapeHtml(language || "code")}</span><button type="button" class="md-copy" data-copy aria-label="Copy this code">Copy</button></div><pre><code class="${cls}">${out}</code></pre></div>\n`;
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      const base = slugify(inner);
      const n = slugCounts.get(base) ?? 0;
      slugCounts.set(base, n + 1);
      const id = n ? `${base}-${n}` : base;
      collected.push({ depth, text: inner.replace(/<[^>]+>/g, ""), id });
      return `<h${depth} id="${id}">${inner}<a class="md-anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
    },
    blockquote({ tokens }: Tokens.Blockquote) {
      const body = this.parser.parse(tokens);
      const m = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\s*/i.exec(body);
      if (!m) return `<blockquote>\n${body}</blockquote>\n`;
      const kind = m[1].toLowerCase();
      const rest = body.slice(m[0].length);
      const inner = rest.startsWith("</p>") ? rest.slice(4) : `<p>${rest}`;
      return `<div class="md-alert md-alert-${kind}" role="note"><p class="md-alert-title">${ALERT_KINDS[kind]}</p>${inner}</div>\n`;
    },
    table({ header, rows }: Tokens.Table) {
      const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      const head = `<thead><tr>${header.map((c) => cell(c, "th")).join("")}</tr></thead>`;
      const body = rows.length ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("")}</tbody>` : "";
      return `<div class="md-table"><table>${head}${body}</table></div>\n`;
    },
    image({ href, title, text }: Tokens.Image) {
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy" decoding="async">`;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      const external = /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");
      const attrs = [`href="${escapeHtml(href)}"`];
      if (title) attrs.push(`title="${escapeHtml(title)}"`);
      if (external) attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      return `<a ${attrs.join(" ")}>${inner}</a>`;
    },
  },
});

export interface Rendered {
  html: string;
  headings: HeadingInfo[];
}

/** Render GFM to HTML. Pass a sanitiser (DOMPurify in the browser) — raw HTML in the source is passed through otherwise. */
export function renderMarkdown(md: string, sanitize?: (html: string) => string): Rendered {
  slugCounts = new Map();
  collected = [];
  const raw = marked.parse(md, { async: false }) as string;
  const headings = collected;
  return { html: sanitize ? sanitize(raw) : raw, headings };
}

/* ------------------------------------------------------------------ stats */

export interface MdStats {
  words: number;
  chars: number;
  lines: number;
  /** Reading time in minutes at ~200 words per minute. */
  minutes: number;
}

export function markdownStats(md: string): MdStats {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|-]+/g, " ");
  const words = plain.trim() ? plain.trim().split(/\s+/).length : 0;
  return { words, chars: [...md].length, lines: md === "" ? 0 : md.split("\n").length, minutes: Math.max(1, Math.ceil(words / 200)) };
}

/* ------------------------------------------------------------ text editing */

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** Wrap the selection with `before`/`after`; unwrap if already wrapped; insert a placeholder when empty. */
export function wrapSelection(text: string, start: number, end: number, before: string, after: string, placeholder: string): Edit {
  const selected = text.slice(start, end);
  const outerBefore = text.slice(start - before.length, start);
  const outerAfter = text.slice(end, end + after.length);
  if (outerBefore === before && outerAfter === after) {
    return { text: text.slice(0, start - before.length) + selected + text.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const content = selected || placeholder;
  const next = text.slice(0, start) + before + content + after + text.slice(end);
  return { text: next, start: start + before.length, end: start + before.length + content.length };
}

/**
 * Add or remove a line prefix on every line touched by the selection.
 * `ordered` numbers the lines 1., 2., …; toggling off strips existing prefixes.
 */
export function prefixLines(text: string, start: number, end: number, prefix: string, ordered = false): Edit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", Math.max(end - (end > start ? 1 : 0), start));
  if (lineEnd < 0) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const strip = (l: string) => (ordered ? l.replace(/^\s*\d+\.\s+/, "") : l.startsWith(prefix) ? l.slice(prefix.length) : l);
  const allPrefixed = lines.every((l) => (ordered ? /^\s*\d+\.\s+/.test(l) : l.startsWith(prefix)));
  const next = lines.map((l, i) => (allPrefixed ? strip(l) : ordered ? `${i + 1}. ${strip(l)}` : prefix + strip(l))).join("\n");
  const out = text.slice(0, lineStart) + next + text.slice(lineEnd);
  return { text: out, start: lineStart, end: lineStart + next.length };
}

/** Insert a block on its own lines at the cursor. */
export function insertBlock(text: string, start: number, end: number, block: string): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const pre = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const post = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = pre + block + post;
  return { text: before + inserted + after, start: start + pre.length, end: start + pre.length + block.length };
}

/** Indent (or outdent with `outdent`) the selected lines by two spaces. */
export function indentLines(text: string, start: number, end: number, outdent: boolean): Edit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", Math.max(end - (end > start ? 1 : 0), start));
  if (lineEnd < 0) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const next = lines.map((l) => (outdent ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
  return { text: text.slice(0, lineStart) + next + text.slice(lineEnd), start: lineStart, end: lineStart + next.length };
}

/* ------------------------------------------------------------------ export */

export const EXPORT_CSS = `
:root{color-scheme:light}body{margin:0;background:#fff;color:#1e2419;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 24px}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em}h1{font-size:2em}h2{font-size:1.5em;border-bottom:1px solid #d6dccb;padding-bottom:.3em}h3{font-size:1.25em}
p,ul,ol,pre,table,blockquote{margin:0 0 1em}a{color:#2f2f36;text-decoration:underline}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#f0f3ea;padding:.15em .35em;border-radius:4px}
pre{background:#f3f5ee;border:1px solid #d6dccb;border-radius:6px;padding:14px 16px;overflow:auto}pre code{background:none;padding:0;font-size:.875em}
blockquote{border-left:3px solid #bec8ae;margin-left:0;padding:.2em 1em;color:#5c6854}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dccb;padding:.45em .7em;text-align:left}th{background:#f0f3ea}
img{max-width:100%}hr{border:0;border-top:1px solid #d6dccb;margin:2em 0}input[type=checkbox]{margin-right:.4em}
.md-code{margin:0 0 1em}.md-code pre{margin:0}.md-table{overflow:auto;margin:0 0 1em}.md-table table{margin:0}
.md-alert{border-left:3px solid #8a8f99;background:#f6f6f7;border-radius:6px;padding:.6em 1em;margin:0 0 1em}.md-alert p{margin:0 0 .4em}.md-alert-title{font-weight:600}
.md-alert-tip{border-color:#35688a}.md-alert-important{border-color:#6639ba}.md-alert-warning{border-color:#8a6720}.md-alert-caution{border-color:#b8342f}
.md-mermaid{text-align:center;margin:0 0 1em}.md-mermaid svg{max-width:100%;height:auto}.md-mermaid-src{text-align:left}
.hljs-comment,.hljs-quote{color:#6e7781;font-style:italic}.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in{color:#6639ba}.hljs-string,.hljs-regexp,.hljs-addition{color:#116329}.hljs-number,.hljs-meta{color:#953800}
.hljs-title,.hljs-name,.hljs-section,.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#0550ae}.hljs-type,.hljs-symbol,.hljs-bullet{color:#b45309}.hljs-deletion{color:#c0392b}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}
.md-ann{background:rgba(250,204,21,.45);border-radius:2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.md-ann[data-color=red]{background:rgba(248,113,113,.45)}.md-ann[data-color=green]{background:rgba(74,222,128,.45)}.md-ann[data-color=blue]{background:rgba(96,165,250,.45)}.md-ann[data-done]{text-decoration:line-through;opacity:.75}
.md-ann-n,.md-notes-n{display:inline-block;min-width:1.4em;padding:0 .3em;border-radius:999px;background:#facc15;color:#1e2419;font-size:.62em;font-weight:600;line-height:1.5;text-align:center;vertical-align:super;margin-left:.15em}
.md-ann-n[data-color=red],[data-color=red]>.md-notes-n{background:#f87171}.md-ann-n[data-color=green],[data-color=green]>.md-notes-n{background:#4ade80}.md-ann-n[data-color=blue],[data-color=blue]>.md-notes-n{background:#60a5fa}
.md-notes{margin-top:2.5em;border-top:1px solid #d6dccb;padding-top:1em;font-size:.95em}.md-notes h2{border:0;font-size:1.2em;margin-top:0}.md-notes ol{list-style:none;padding:0}.md-notes li{margin:.6em 0;padding-left:2.2em;position:relative}
.md-notes-n{position:absolute;left:0;top:.15em;font-size:.8em;vertical-align:baseline;margin:0}.md-notes q{font-style:italic;color:#5c6854}.md-notes-text{display:block;white-space:pre-wrap}.md-notes-state{color:#8a8f99;font-size:.9em}.md-notes-done q{text-decoration:line-through}
@media print{main{padding:0}.md-ann,.md-ann-n,.md-notes-n{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

/**
 * Preview HTML made fit for a file: the copy bars go, drawn diagrams stay (their source is dropped once drawn), and the
 * selection ring on an annotation is not part of the document.
 */
export function exportableHtml(html: string): string {
  return html
    .replace(/ data-selected="true"/g, "")
    .replace(/<div class="md-code-bar">[\s\S]*?<\/div>/g, "")
    .replace(/<a class="md-anchor"[^>]*>#<\/a>/g, "")
    .replace(/(<div class="md-mermaid"[^>]*data-state="done"[^>]*>)<pre class="md-mermaid-src">[\s\S]*?<\/pre>/g, "$1");
}

/** A complete HTML document for download or printing. */
export function toStandaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

/** Title for exports: the first heading, else the first non-empty line, else "Untitled". */
export function documentTitle(md: string): string {
  const h = md.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (h) return h[1].replace(/[*_`~]/g, "").trim();
  const line = md.split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 80) : "Untitled";
}

export const SAMPLE = `# Welcome to the Markdown editor

Type on the left, see the result on the right. **Bold**, *italic*, ~~strikethrough~~, \`inline code\` and [links](https://bench.bozmoz.com) all work, as do GitHub-flavoured extras.

## Lists

- Plain bullets
- With **emphasis**
  - Nested items

1. Ordered
2. Lists

- [x] Task lists
- [ ] Still to do

## Table

| Tool | Runs where | Free |
| --- | --- | :---: |
| Diff checker | browser | ✓ |
| JSON schema | browser | ✓ |

## Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`; // highlighted
}
\`\`\`

> [!TIP]
> Alerts like this one, plus **Note**, **Important**, **Warning** and **Caution**, render as callouts.

## Diagram

\`\`\`mermaid
flowchart LR
  Write[Write Markdown] --> Preview --> Share[Share the link]
\`\`\`

> Blockquotes for callouts, and a horizontal rule below.

---

Everything stays in your browser; drafts are saved locally. Use the toolbar or ⌘B / ⌘I / ⌘K.
`;
