/**
 * Relevance ranking for the command palette. Pure, so the order can be
 * unit-tested: what you type should bring the tool you mean to the top.
 *
 * Score tiers (higher wins; ties broken by registry order):
 *   exact title/short title/alias  >  title starts with the query
 *   >  a title word starts with it  >  an alias or keyword starts with it
 *   >  the title contains it  >  keywords/tagline contain it  >  fuzzy subsequence
 * Multi-word queries must match every word somewhere; each word scores
 * independently and the tiers add up.
 */

import type { ToolDef } from "./types";

export interface Scored {
  tool: ToolDef;
  score: number;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** True when every character of `q` appears in `text` in order (typo-tolerant "fuzzy"). */
function subsequence(q: string, text: string): boolean {
  let i = 0;
  for (const c of text) if (c === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/** Optimal-string-alignment edit distance, with adjacent transpositions. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const TASK_ALIASES: Record<string, string[]> = {
  "files/pdf-compress": ["make pdf smaller", "reduce pdf file size", "shrink pdf"],
  "files/pdf": ["edit a pdf", "fill pdf form"],
  "media/converter": ["change image format", "convert photo", "make image smaller"],
  "json/viewer": ["format json", "fix json formatting", "pretty print json", "inspect json"],
  "json/schema": ["generate schema from json", "validate json data"],
  "text/base64": ["decode base64", "encode text"],
  "web/diff": ["compare two texts", "find text differences"],
  "web/mermaid": ["draw a diagram", "make flowchart"],
};

interface Index {
  tool: ToolDef;
  title: string;
  short: string;
  slug: string;
  aliases: string[];
  keywords: string[];
  tagline: string;
  haystack: string;
}

let cache: { tools: ToolDef[]; index: Index[] } | null = null;

function indexOf(tools: ToolDef[]): Index[] {
  if (cache && cache.tools === tools) return cache.index;
  const index = tools.map((tool) => {
    const title = norm(tool.title);
    const short = norm(tool.short ?? "");
    const aliases = [...(tool.aliases ?? []), ...(TASK_ALIASES[`${tool.category}/${tool.slug}`] ?? [])].map(norm);
    const keywords = tool.keywords.map(norm);
    const tagline = norm(tool.tagline);
    return { tool, title, short, slug: norm(tool.slug), aliases, keywords, tagline, haystack: [title, short, norm(tool.slug), ...aliases, ...keywords, tagline, norm(tool.category), norm(tool.group)].join(" | ") };
  });
  cache = { tools, index };
  return index;
}

const T = { exact: 1000, titlePrefix: 600, titleWord: 400, aliasWord: 300, titleContains: 200, keywordContains: 100, fuzzy: 20 };

function scoreWord(ix: Index, w: string): number {
  if (ix.title === w || ix.short === w || ix.slug === w || ix.aliases.includes(w)) return T.exact;
  if (ix.title.startsWith(w) || ix.short.startsWith(w)) return T.titlePrefix;
  const wordStart = (s: string) => s.split(" ").some((part) => part.startsWith(w));
  if (wordStart(ix.title) || wordStart(ix.short)) return T.titleWord;
  if (ix.aliases.some(wordStart) || ix.keywords.some(wordStart) || wordStart(ix.slug)) return T.aliasWord;
  if (ix.title.includes(w) || ix.short.includes(w)) return T.titleContains;
  if (ix.haystack.includes(w)) return T.keywordContains;
  return 0;
}

/** Match common typos, including swapped letters; retain abbreviated subsequences. */
function fuzzyWord(ix: Index, w: string): number {
  if (w.length < 4) return 0;
  const names = [ix.title, ix.short, ...ix.aliases].map((s) => s.replace(/ /g, "")).filter((s) => s.length <= w.length * 3);
  const words = [ix.title, ix.short, ix.slug, ...ix.aliases].flatMap((s) => s.split(" "));
  if (w.length <= 64 && words.some((s) => Math.abs(s.length - w.length) <= 1 && editDistance(w, s) <= 1)) return T.fuzzy + 5;
  return names.some((s) => subsequence(w, s)) ? T.fuzzy : 0;
}

/** Tools matching `query`, best first (at most `limit`). An empty query returns every tool in registry order. */
export function searchTools(tools: ToolDef[], query: string, limit = 50): Scored[] {
  const words = norm(query).split(" ").filter(Boolean);
  const index = indexOf(tools);
  if (!words.length) return index.map((ix) => ({ tool: ix.tool, score: 0 }));
  const out: Scored[] = [];
  const collect = (scorer: (ix: Index, w: string) => number) =>
    index.forEach((ix, i) => {
      let score = 0;
      for (const w of words) {
        const s = scorer(ix, w);
        if (!s) return; // every word must match somewhere
        score += s;
      }
    // Whole phrase matching the title beats the same words scattered about.
    const phrase = words.join(" ");
    if (words.length > 1 && (ix.title.includes(phrase) || ix.short.includes(phrase) || ix.aliases.includes(phrase))) score += T.titleContains;
      // Shorter titles win ties: "Base64" over "Base64 Image Encoder & Decoder" for "base64".
      out.push({ tool: ix.tool, score: score * 1000 - ix.title.length - i / 1000 });
    });
  collect(scoreWord);
  if (!out.length) collect((ix, w) => scoreWord(ix, w) || fuzzyWord(ix, w));
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
