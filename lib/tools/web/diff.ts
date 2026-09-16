/**
 * Diff engine for the Diff Checker, built on jsdiff (Myers' algorithm).
 *
 * Line diffs run on arrays of lines with a comparator so whitespace / case
 * can be ignored while the original text is still what gets displayed.
 * Changed line pairs get intra-line word segments; long unchanged runs can be
 * folded to hunks with context; unified patches can be produced and applied.
 */

import { applyPatch, createTwoFilesPatch, diffArrays, diffChars, diffWords, diffWordsWithSpace } from "diff";

export type Granularity = "line" | "word" | "char";
export type WhitespaceMode = "none" | "trim" | "all";

export interface DiffOptions {
  whitespace: WhitespaceMode;
  ignoreCase: boolean;
}

export type SegmentType = "eq" | "add" | "del";
export interface Segment {
  type: SegmentType;
  text: string;
}

export interface LineRow {
  kind: "eq" | "add" | "del" | "mod";
  aNo?: number;
  bNo?: number;
  a?: string;
  b?: string;
  /** Intra-line segments for `mod` rows (old side / new side). */
  aSegs?: Segment[];
  bSegs?: Segment[];
}

export interface LineDiff {
  rows: LineRow[];
  aLines: number;
  bLines: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  /** 0–1, share of lines that are unchanged. */
  similarity: number;
}

/** Skip intra-line diffing for very long lines (minified code etc.). */
const INTRALINE_MAX = 2000;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function normalizeLine(s: string, opts: DiffOptions): string {
  let t = s;
  if (opts.whitespace === "trim") t = t.trim();
  else if (opts.whitespace === "all") t = t.replace(/\s+/g, "");
  if (opts.ignoreCase) t = t.toLowerCase();
  return t;
}

function toSegments(changes: { value: string; added?: boolean; removed?: boolean }[]): Segment[] {
  return changes
    .filter((c) => c.value !== "")
    .map((c) => ({ type: c.added ? "add" : c.removed ? "del" : "eq", text: c.value }));
}

/** Word-level segments for a changed line pair. */
export function intralineSegments(a: string, b: string, opts: DiffOptions): { aSegs: Segment[]; bSegs: Segment[] } | null {
  if (a.length > INTRALINE_MAX || b.length > INTRALINE_MAX) return null;
  const fn = opts.whitespace === "none" ? diffWordsWithSpace : diffWords;
  const segs = toSegments(fn(a, b, { ignoreCase: opts.ignoreCase }));
  // Common tokens carry the *new* text; rebuild the old side from the old string
  // by walking equal segments against `a` (only differs when case/space is ignored).
  const aSegs: Segment[] = [];
  const bSegs: Segment[] = [];
  let ai = 0;
  for (const s of segs) {
    if (s.type === "add") bSegs.push(s);
    else if (s.type === "del") {
      aSegs.push(s);
      ai += s.text.length;
    } else {
      bSegs.push(s);
      const slice = a.slice(ai, ai + s.text.length);
      aSegs.push({ type: "eq", text: slice });
      ai += s.text.length;
    }
  }
  if (ai < a.length) aSegs.push({ type: "eq", text: a.slice(ai) });
  return { aSegs, bSegs };
}

export function lineDiff(aText: string, bText: string, opts: DiffOptions): LineDiff {
  const a = splitLines(aText);
  const b = splitLines(bText);
  const changes = diffArrays(a, b, {
    comparator: (x: string, y: string) => normalizeLine(x, opts) === normalizeLine(y, opts),
  });

  const rows: LineRow[] = [];
  let ai = 0;
  let bi = 0;
  let dels: { text: string; no: number }[] = [];
  let adds: { text: string; no: number }[] = [];
  let added = 0, removed = 0, modified = 0, unchanged = 0;

  const flush = () => {
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const d = dels[k], ad = adds[k];
      const segs = intralineSegments(d.text, ad.text, opts);
      rows.push({ kind: "mod", aNo: d.no, bNo: ad.no, a: d.text, b: ad.text, ...(segs ?? {}) });
      modified++;
    }
    for (let k = pairs; k < dels.length; k++) {
      rows.push({ kind: "del", aNo: dels[k].no, a: dels[k].text });
      removed++;
    }
    for (let k = pairs; k < adds.length; k++) {
      rows.push({ kind: "add", bNo: adds[k].no, b: adds[k].text });
      added++;
    }
    dels = [];
    adds = [];
  };

  for (const c of changes) {
    const n = c.value.length;
    if (c.removed) {
      for (let k = 0; k < n; k++) {
        dels.push({ text: a[ai], no: ai + 1 });
        ai++;
      }
    } else if (c.added) {
      for (let k = 0; k < n; k++) {
        adds.push({ text: b[bi], no: bi + 1 });
        bi++;
      }
    } else {
      flush();
      for (let k = 0; k < n; k++) {
        rows.push({ kind: "eq", aNo: ai + 1, bNo: bi + 1, a: a[ai], b: b[bi] });
        ai++;
        bi++;
        unchanged++;
      }
    }
  }
  flush();

  const denom = Math.max(a.length, b.length, 1);
  return { rows, aLines: a.length, bLines: b.length, added, removed, modified, unchanged, similarity: unchanged / denom };
}

export interface InlineDiff {
  segments: Segment[];
  added: number;
  removed: number;
  /** 0–1, share of unchanged characters. */
  similarity: number;
}

/** Word- or character-level diff of the whole texts as one stream. */
export function inlineDiff(aText: string, bText: string, granularity: "word" | "char", opts: DiffOptions): InlineDiff {
  const o = { ignoreCase: opts.ignoreCase };
  const changes =
    granularity === "char"
      ? diffChars(aText, bText, o)
      : opts.whitespace === "none"
        ? diffWordsWithSpace(aText, bText, o)
        : diffWords(aText, bText, o);
  const segments = toSegments(changes);
  let added = 0, removed = 0, eq = 0;
  for (const c of changes) {
    if (c.added) added += c.count ?? 1;
    else if (c.removed) removed += c.count ?? 1;
    else eq += c.value.length;
  }
  return { segments, added, removed, similarity: eq / Math.max(aText.length, bText.length, 1) };
}

/* ------------------------------------------------------------------ folding */

export type Block = { kind: "rows" | "fold"; rows: LineRow[]; start: number };

/** Fold runs of unchanged rows, keeping `context` rows around every change. */
export function foldRows(rows: LineRow[], context: number): Block[] {
  if (!Number.isFinite(context)) return [{ kind: "rows", rows, start: 0 }];
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === "eq") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  }
  const blocks: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    const kind = keep[i] ? "rows" : "fold";
    let j = i;
    while (j < rows.length && (keep[j] ? "rows" : "fold") === kind) j++;
    blocks.push({ kind, rows: rows.slice(i, j), start: i });
    i = j;
  }
  return blocks;
}

/* ------------------------------------------------------------------ patches */

export function makePatch(aText: string, bText: string, context = 3, aName = "original", bName = "changed"): string {
  return createTwoFilesPatch(aName, bName, aText, bText, "", "", { context });
}

export function applyPatchText(
  source: string,
  patch: string,
  fuzz = 0,
): { ok: true; value: string } | { ok: false; error: string } {
  if (!patch.trim()) return { ok: false, error: "Paste a unified diff first." };
  try {
    const out = applyPatch(source, patch, { fuzzFactor: fuzz });
    if (out === false)
      return { ok: false, error: "The patch doesn't apply cleanly — a hunk's context didn't match the original. Try a higher fuzz." };
    return { ok: true, value: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* --------------------------------------------------------------------- json */

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Pretty-print JSON with sorted keys so formatting and key order don't show as changes; null if not JSON. */
export function normalizeJsonText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.stringify(sortKeys(JSON.parse(t)), null, 2);
  } catch {
    return null;
  }
}
