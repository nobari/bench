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
    const aliases = (tool.aliases ?? []).map(norm);
    const keywords = tool.keywords.map(norm);
    const tagline = norm(tool.tagline);
    return { tool, title, short, slug: norm(tool.slug), aliases, keywords, tagline, haystack: [title, short, norm(tool.slug), ...aliases, ...keywords, tagline, norm(tool.category)].join(" | ") };
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

/** Typo fallback: the query is a subsequence of a short name (so "mermiad" still finds Mermaid). */
function fuzzyWord(ix: Index, w: string): number {
  if (w.length < 4) return 0;
  const names = [ix.title, ix.short, ...ix.aliases].map((s) => s.replace(/ /g, "")).filter((s) => s.length <= w.length * 3);
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
  if (!out.length) collect(fuzzyWord);
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
