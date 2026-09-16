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

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
      if (language && hljs.getLanguage(language)) {
        const out = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        return `<pre><code class="hljs language-${escapeHtml(language)}">${out}</code></pre>\n`;
      }
      return `<pre><code class="hljs${language ? ` language-${escapeHtml(language)}` : ""}">${escapeHtml(text)}</code></pre>\n`;
    },
    heading({ tokens, depth }: Tokens.Heading) {
      const inner = this.parser.parseInline(tokens);
      const base = slugify(inner);
      const n = slugCounts.get(base) ?? 0;
      slugCounts.set(base, n + 1);
      const id = n ? `${base}-${n}` : base;
      collected.push({ depth, text: inner.replace(/<[^>]+>/g, ""), id });
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
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
p,ul,ol,pre,table,blockquote{margin:0 0 1em}a{color:#5b8a3c}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:#f0f3ea;padding:.15em .35em;border-radius:4px}
pre{background:#f3f5ee;border:1px solid #d6dccb;border-radius:6px;padding:14px 16px;overflow:auto}pre code{background:none;padding:0;font-size:.875em}
blockquote{border-left:3px solid #bec8ae;margin-left:0;padding:.2em 1em;color:#5c6854}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d6dccb;padding:.45em .7em;text-align:left}th{background:#f0f3ea}
img{max-width:100%}hr{border:0;border-top:1px solid #d6dccb;margin:2em 0}input[type=checkbox]{margin-right:.4em}
.hljs-comment,.hljs-quote{color:#6e7781;font-style:italic}.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in{color:#6639ba}.hljs-string,.hljs-regexp,.hljs-addition{color:#116329}.hljs-number,.hljs-meta{color:#953800}
.hljs-title,.hljs-name,.hljs-section,.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#0550ae}.hljs-type,.hljs-symbol,.hljs-bullet{color:#b45309}.hljs-deletion{color:#c0392b}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}
@media print{main{padding:0}}`;

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

> Blockquotes for callouts, and a horizontal rule below.

---

Everything stays in your browser; drafts are saved locally. Use the toolbar or ⌘B / ⌘I / ⌘K.
`;
