/**
 * Track changes: a revision of a text shown as a redline — what was deleted struck through, what was inserted
 * underlined — with every change identified, so each one can be accepted (folded into the original), rejected
 * (undone in the revision) or commented on, and the whole exported as marked-up HTML, Markdown or plain text.
 *
 * The redline is a diff of the original and the revision (jsdiff, Myers' algorithm) at the granularity chosen:
 * words for prose, characters for small corrections, sentences or lines for a coarser view. Every piece carries
 * its offsets into both texts, which is what makes a single change reversible on either side.
 */

import { diffChars, diffLines, diffSentences, diffWords, diffWordsWithSpace } from "diff";

export type Granularity = "word" | "char" | "sentence" | "line";
export const GRANULARITIES: Granularity[] = ["word", "char", "sentence", "line"];
export const GRANULARITY_LABELS: Record<Granularity, string> = { word: "Words", char: "Characters", sentence: "Sentences", line: "Lines" };

export interface TrackOptions {
  granularity: Granularity;
  /** Words mode only: whitespace differences — reflowed lines, doubled spaces — are not changes. */
  ignoreWhitespace: boolean;
}
export const DEFAULT_OPTIONS: TrackOptions = { granularity: "word", ignoreWhitespace: false };

export type ChangeKind = "insert" | "delete" | "replace";

export interface Change {
  /** 0-based position in document order. */
  index: number;
  kind: ChangeKind;
  /** Text removed from the original ("" for an insertion). */
  del: string;
  /** Text added in the revision ("" for a deletion). */
  ins: string;
  /** Span of `del` in the original; an insertion has aStart === aEnd, the point where it goes. */
  aStart: number;
  aEnd: number;
  /** Span of `ins` in the revision; a deletion has bStart === bEnd. */
  bStart: number;
  bEnd: number;
  /** Survives other changes being accepted or rejected: made of the kind, both texts and which repeat this is. */
  key: string;
}

export type Piece = { type: "eq"; a: string; b: string } | { type: "change"; change: Change };

export interface Stats {
  inserts: number;
  deletes: number;
  replaces: number;
  total: number;
  /** Words inserted and words deleted. */
  wordsIn: number;
  wordsOut: number;
  /** 0–1: the share of the longer text's words that is not common to both. */
  changed: number;
}

export interface Redline {
  pieces: Piece[];
  changes: Change[];
  stats: Stats;
}

/* ----------------------------------------------------------------- redline */

export function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === " ";

/** The end of the stretch of `a` from `from` that reads as `text` once whitespace is ignored; null if there is none. */
function matchIgnoringWhitespace(a: string, from: number, text: string): number | null {
  let i = from;
  let k = 0;
  while (k < text.length) {
    if (isWs(text[k])) {
      // A whitespace run in the revision stands for whatever whitespace the original has here, maybe none.
      while (k < text.length && isWs(text[k])) k++;
      while (i < a.length && isWs(a[i])) i++;
      continue;
    }
    while (i < a.length && isWs(a[i])) i++;
    if (a[i] !== text[k]) return null;
    i++;
    k++;
  }
  return i;
}

/** FNV-1a over UTF-16 code units, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function changeKey(kind: ChangeKind, del: string, ins: string, repeat: number): string {
  return kind[0] + fnv(`${del}\u0000${ins}\u0000${repeat}`);
}

type Raw = { value: string; added?: boolean; removed?: boolean }[];

function rawDiff(a: string, b: string, opts: TrackOptions): Raw {
  switch (opts.granularity) {
    case "char":
      return diffChars(a, b);
    case "sentence":
      return diffSentences(a, b);
    case "line":
      return diffLines(a, b);
    default:
      return opts.ignoreWhitespace ? diffWords(a, b) : diffWordsWithSpace(a, b);
  }
}

/**
 * Turns jsdiff's change objects into pieces with offsets into both texts. Returns null when the offsets cannot be
 * made to agree with the texts (only possible in the whitespace-ignoring mode), so the caller can fall back.
 */
function build(a: string, b: string, raw: Raw, loose: boolean): { pieces: Piece[]; changes: Change[] } | null {
  const pieces: Piece[] = [];
  let ai = 0, bi = 0;
  let del = "", ins = "";
  let aStart = 0, bStart = 0, open = false;

  const flush = () => {
    if (!open) return;
    open = false;
    if (!del && !ins) return;
    if (a.slice(aStart, aStart + del.length) !== del || b.slice(bStart, bStart + ins.length) !== ins) throw new Error("mismatch");
    pieces.push({ type: "change", change: { index: 0, kind: "replace", del, ins, aStart, aEnd: aStart + del.length, bStart, bEnd: bStart + ins.length, key: "" } });
    del = "";
    ins = "";
  };

  try {
    for (const c of raw) {
      if (c.value === "") continue;
      if (c.removed || c.added) {
        if (!open) {
          open = true;
          aStart = ai;
          bStart = bi;
        }
        if (c.removed) {
          del += c.value;
          ai += c.value.length;
        } else {
          ins += c.value;
          bi += c.value.length;
        }
        continue;
      }
      flush();
      let aEnd: number;
      if (loose) {
        const m = matchIgnoringWhitespace(a, ai, c.value);
        if (m === null) return null;
        aEnd = m;
      } else aEnd = ai + c.value.length;
      const aText = a.slice(ai, aEnd);
      if (!loose && aText !== c.value) return null;
      const last = pieces[pieces.length - 1];
      if (last && last.type === "eq") {
        last.a += aText;
        last.b += c.value;
      } else pieces.push({ type: "eq", a: aText, b: c.value });
      ai = aEnd;
      bi += c.value.length;
    }
    flush();
  } catch {
    return null;
  }
  if (ai !== a.length || bi !== b.length) return null;
  return finish(pieces);
}

const blank = (s: string) => s.trim() === "";

/**
 * Edits separated only by whitespace read as one edit — "improves the" → "makes exporting" rather than two words
 * replaced one after the other — so such neighbours are merged; then every change gets its kind, index and key.
 */
function finish(raw: Piece[]): { pieces: Piece[]; changes: Change[] } {
  const pieces: Piece[] = [];
  for (const p of raw) {
    const prev = pieces[pieces.length - 1];
    const gap = pieces[pieces.length - 2];
    if (p.type === "change" && prev?.type === "eq" && gap?.type === "change" && blank(prev.a) && blank(prev.b)) {
      const c = gap.change, d = p.change;
      pieces.splice(-2, 2, {
        type: "change",
        change: { ...c, del: c.del + prev.a + d.del, ins: c.ins + prev.b + d.ins, aEnd: d.aEnd, bEnd: d.bEnd },
      });
      continue;
    }
    pieces.push(p);
  }
  const changes: Change[] = [];
  const repeats = new Map<string, number>();
  for (const p of pieces) {
    if (p.type !== "change") continue;
    const c = p.change;
    c.kind = c.del && c.ins ? "replace" : c.del ? "delete" : "insert";
    c.index = changes.length;
    const base = `${c.kind}\u0000${c.del}\u0000${c.ins}`;
    const n = repeats.get(base) ?? 0;
    repeats.set(base, n + 1);
    c.key = changeKey(c.kind, c.del, c.ins, n);
    changes.push(c);
  }
  return { pieces, changes };
}

/** The redline of `revision` against `original`. */
export function redline(original: string, revision: string, opts: TrackOptions = DEFAULT_OPTIONS): Redline {
  const loose = opts.granularity === "word" && opts.ignoreWhitespace;
  let built = build(original, revision, rawDiff(original, revision, opts), loose);
  // The whitespace-ignoring diff is reconciled against the original by hand; if that ever fails, compare exactly.
  if (!built) built = build(original, revision, rawDiff(original, revision, { ...opts, ignoreWhitespace: false }), false);
  if (!built) {
    const whole = wholeChange(original, revision);
    built = original || revision ? { pieces: [{ type: "change", change: whole }], changes: [whole] } : { pieces: [], changes: [] };
  }

  let inserts = 0, deletes = 0, replaces = 0, wordsIn = 0, wordsOut = 0, eqWords = 0;
  for (const p of built.pieces) {
    if (p.type === "eq") {
      eqWords += countWords(p.b);
      continue;
    }
    const c = p.change;
    if (c.kind === "insert") inserts++;
    else if (c.kind === "delete") deletes++;
    else replaces++;
    wordsIn += countWords(c.ins);
    wordsOut += countWords(c.del);
  }
  const longest = Math.max(countWords(original), countWords(revision), 1);
  const changed = Math.min(1, Math.max(0, 1 - eqWords / longest));
  return {
    pieces: built.pieces,
    changes: built.changes,
    stats: { inserts, deletes, replaces, total: built.changes.length, wordsIn, wordsOut, changed: original === revision ? 0 : changed },
  };
}

function wholeChange(a: string, b: string): Change {
  const kind: ChangeKind = a && b ? "replace" : a ? "delete" : "insert";
  return { index: 0, kind, del: a, ins: b, aStart: 0, aEnd: a.length, bStart: 0, bEnd: b.length, key: changeKey(kind, a, b, 0) };
}

/** True when the change still describes these texts (the redline may lag behind fast typing). */
export function changeFits(original: string, revision: string, c: Change): boolean {
  return original.slice(c.aStart, c.aEnd) === c.del && revision.slice(c.bStart, c.bEnd) === c.ins;
}

/** Accepting folds the change into the original: the original now reads as the revision does there. */
export function acceptChange(original: string, c: Change): string {
  return original.slice(0, c.aStart) + c.ins + original.slice(c.aEnd);
}

/** Rejecting undoes the change in the revision: it reads as the original does there. */
export function rejectChange(revision: string, c: Change): string {
  return revision.slice(0, c.bStart) + c.del + revision.slice(c.bEnd);
}

/** The key the same change would have with the texts swapped (a deletion becomes an insertion). */
export function swappedKey(c: Change, repeat: number): string {
  const kind: ChangeKind = c.kind === "insert" ? "delete" : c.kind === "delete" ? "insert" : "replace";
  return changeKey(kind, c.ins, c.del, repeat);
}

/** Which repeat of its texts each change is, in document order — the number its key was made with. */
export function repeatIndex(changes: Change[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const c of changes) {
    const base = `${c.kind}\u0000${c.del}\u0000${c.ins}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(c.key, n);
  }
  return out;
}

const QUOTE_MAX = 48;

/** A short, single-line quote of a change's text for lists and titles. */
export function quote(text: string, max = QUOTE_MAX): string {
  const flat = text.replace(/\r?\n/g, "↵").replace(/\t/g, "⇥");
  if (!flat.trim()) return flat.length === 0 ? "" : flat.replace(/ /g, "␣");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case "insert":
      return `Inserted “${quote(c.ins)}”`;
    case "delete":
      return `Deleted “${quote(c.del)}”`;
    default:
      return `Replaced “${quote(c.del)}” with “${quote(c.ins)}”`;
  }
}

/* -------------------------------------------------------------------- meta */

export const MAX_COMMENT = 2000;
export const MAX_REVIEWER = 120;
export const MAX_NOTE = 5000;
export const MAX_COMMENTS = 500;
const KEY_RE = /^[idr][0-9a-f]{8}$/;

/** What travels with the texts: how they are compared, the comments on changes, and the reviewer's cover note. */
export interface TrackMeta extends TrackOptions {
  comments: Record<string, string>;
  reviewer: string;
  note: string;
}

export const DEFAULT_META: TrackMeta = { ...DEFAULT_OPTIONS, comments: {}, reviewer: "", note: "" };

/** Keeps only well-formed values, capped in size; anything unreadable falls back to the default. */
export function parseMeta(input: unknown): TrackMeta {
  const meta: TrackMeta = { ...DEFAULT_META, comments: {} };
  if (!input || typeof input !== "object") return meta;
  const m = input as Record<string, unknown>;
  if (GRANULARITIES.includes(m.granularity as Granularity)) meta.granularity = m.granularity as Granularity;
  meta.ignoreWhitespace = m.ignoreWhitespace === true;
  if (typeof m.reviewer === "string") meta.reviewer = m.reviewer.slice(0, MAX_REVIEWER);
  if (typeof m.note === "string") meta.note = m.note.slice(0, MAX_NOTE);
  if (m.comments && typeof m.comments === "object" && !Array.isArray(m.comments)) {
    let n = 0;
    for (const [k, v] of Object.entries(m.comments as Record<string, unknown>)) {
      if (!KEY_RE.test(k) || typeof v !== "string" || !v.trim()) continue;
      meta.comments[k] = v.slice(0, MAX_COMMENT);
      if (++n >= MAX_COMMENTS) break;
    }
  }
  return meta;
}

/** The comments whose change is no longer in the redline. */
export function orphanComments(meta: TrackMeta, changes: Change[]): string[] {
  const live = new Set(changes.map((c) => c.key));
  return Object.keys(meta.comments).filter((k) => !live.has(k));
}

/* ----------------------------------------------------------------- exports */

export interface ExportInput {
  redline: Redline;
  comments: Record<string, string>;
  title?: string;
  reviewer?: string;
  note?: string;
  /** ISO date of the export, for the byline. */
  date?: string;
}

/** Changes with a comment, numbered in document order. */
function commented(redline: Redline, comments: Record<string, string>): { n: number; change: Change; text: string }[] {
  const out: { n: number; change: Change; text: string }[] = [];
  for (const c of redline.changes) {
    const text = comments[c.key];
    if (text?.trim()) out.push({ n: out.length + 1, change: c, text: text.trim() });
  }
  return out;
}

export function summaryLine(stats: Stats): string {
  if (stats.total === 0) return "No changes";
  const parts: string[] = [];
  if (stats.inserts) parts.push(`${stats.inserts} ${stats.inserts === 1 ? "insertion" : "insertions"}`);
  if (stats.deletes) parts.push(`${stats.deletes} ${stats.deletes === 1 ? "deletion" : "deletions"}`);
  if (stats.replaces) parts.push(`${stats.replaces} ${stats.replaces === 1 ? "replacement" : "replacements"}`);
  return `${parts.join(", ")} — ${Math.round(stats.changed * 100)}% of the text changed`;
}

/** `[-deleted-]{+inserted+}`, the convention of git's word diff; comments are numbered notes at the end. */
export function toPlainMarkup({ redline, comments }: ExportInput): string {
  const notes = commented(redline, comments);
  const numbers = new Map(notes.map((x) => [x.change.key, x.n]));
  let out = "";
  for (const p of redline.pieces) {
    if (p.type === "eq") {
      out += p.b;
      continue;
    }
    const c = p.change;
    if (c.del) out += `[-${c.del}-]`;
    if (c.ins) out += `{+${c.ins}+}`;
    const n = numbers.get(c.key);
    if (n) out += `[${n}]`;
  }
  if (notes.length) out += `\n\n${notes.map((x) => `[${x.n}] ${x.text}`).join("\n")}\n`;
  return out;
}

/** Wraps every line's text in `mark`, leaving the surrounding whitespace outside so the emphasis still parses. */
function wrapMd(text: string, mark: string): string {
  return text
    .split("\n")
    .map((line) => {
      const m = /^(\s*)(.*?)(\s*)$/s.exec(line)!;
      return m[2] ? `${m[1]}${mark}${m[2].replace(/([*~])/g, "\\$1")}${mark}${m[3]}` : line;
    })
    .join("\n");
}

/** `~~deleted~~` and `**inserted**`, with comments as footnotes. */
export function toMarkdown({ redline, comments }: ExportInput): string {
  const notes = commented(redline, comments);
  const numbers = new Map(notes.map((x) => [x.change.key, x.n]));
  let out = "";
  for (const p of redline.pieces) {
    if (p.type === "eq") {
      out += p.b;
      continue;
    }
    const c = p.change;
    if (c.del) out += wrapMd(c.del, "~~");
    if (c.del && c.ins && !/\s$/.test(c.del) && !/^\s/.test(c.ins)) out += " ";
    if (c.ins) out += wrapMd(c.ins, "**");
    const n = numbers.get(c.key);
    if (n) out += `[^${n}]`;
  }
  if (notes.length) out += `\n\n${notes.map((x) => `[^${x.n}]: ${x.text.replace(/\n/g, "\n    ")}`).join("\n")}\n`;
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const DEL_STYLE = "color:#b3261e;text-decoration:line-through;background:#fbe9e7;";
const INS_STYLE = "color:#1b6e3b;text-decoration:underline;background:#e6f4ea;";

/** The redline as an HTML fragment with inline styles, so it pastes into Word, Google Docs and mail with its marks. */
export function toHtmlFragment({ redline, comments }: ExportInput): string {
  const notes = commented(redline, comments);
  const numbers = new Map(notes.map((x) => [x.change.key, x.n]));
  const text = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");
  let out = "";
  for (const p of redline.pieces) {
    if (p.type === "eq") {
      out += text(p.b);
      continue;
    }
    const c = p.change;
    if (c.del) out += `<del style="${DEL_STYLE}">${text(c.del)}</del>`;
    if (c.ins) out += `<ins style="${INS_STYLE}">${text(c.ins)}</ins>`;
    const n = numbers.get(c.key);
    if (n) out += `<sup style="color:#555;font-size:0.75em;">[${n}]</sup>`;
  }
  let html = `<div style="white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.7;">${out}</div>`;
  if (notes.length)
    html += `<ol style="margin-top:1.5em;padding-left:1.5em;font-family:Georgia,'Times New Roman',serif;font-size:14px;line-height:1.6;color:#333;">${notes
      .map((x) => `<li value="${x.n}"><span style="color:#777;">${escapeHtml(describeChange(x.change))}:</span> ${text(x.text)}</li>`)
      .join("")}</ol>`;
  return html;
}

/** A complete HTML document: title, byline, summary, the reviewer's note, the redline and its comments, print-ready. */
export function toStandaloneHtml(input: ExportInput): string {
  const title = input.title?.trim() || "Tracked changes";
  const by = [input.reviewer?.trim() && `Changes by ${input.reviewer.trim()}`, input.date && formatDate(input.date)].filter(Boolean).join(" · ");
  const note = input.note?.trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 40px 24px; color: #111; background: #fff; font-family: Georgia, 'Times New Roman', serif; }
  main { max-width: 42em; margin: 0 auto; }
  h1 { font-size: 1.6em; margin: 0 0 0.25em; }
  .by, .sum, .legend { color: #666; font-family: system-ui, sans-serif; font-size: 13px; margin: 0 0 0.4em; }
  blockquote { margin: 1.2em 0; padding: 0.6em 1em; border-left: 3px solid #ccc; background: #f6f6f6; white-space: pre-wrap; }
  del { ${DEL_STYLE} }
  ins { ${INS_STYLE} }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.5em 0; }
  @media print { body { padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${by ? `<p class="by">${escapeHtml(by)}</p>` : ""}
<p class="sum">${escapeHtml(summaryLine(input.redline.stats))}</p>
<p class="legend"><del>Struck through</del> was deleted, <ins>underlined</ins> was inserted.</p>
${note ? `<blockquote>${escapeHtml(note)}</blockquote>` : ""}
<hr>
${toHtmlFragment(input)}
</main>
</body>
</html>
`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

/* ------------------------------------------------------------------ sample */

export const SAMPLE_ORIGINAL = `Release notes — version 2.4

This release improves the export speed by about 30% and fixes a bug that caused the app to crash when opening very large files. We have also added a dark theme, which can be enabled from the settings menu.

Known issues: the search index may take a few minutes to rebuild after upgrading. We recommend to backup your data before installing.

Thanks to everyone who reported problems and sent suggestions!`;

export const SAMPLE_REVISION = `Release notes — version 2.4

This release makes exporting about 30% faster and fixes a crash when opening very large files. It also adds a dark theme, which you can turn on in Settings.

Known issue: the search index can take a few minutes to rebuild after the upgrade. Back up your data before installing.

Thank you to everyone who reported problems and sent suggestions.`;
