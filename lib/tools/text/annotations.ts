/**
 * Annotations on a Markdown preview: a stretch of the rendered text, highlighted in a colour, with an optional comment
 * and a resolved state. The stretch is remembered as offsets into the preview's text together with the quoted text
 * and a little of what surrounds it, so it is found again after the document changes around it; once the quoted
 * text is gone the annotation is kept, listed as lost, until it is deleted.
 */

export type MarkColor = "yellow" | "red" | "green" | "blue";
export const MARK_COLORS: MarkColor[] = ["yellow", "red", "green", "blue"];
export const MARK_LABELS: Record<MarkColor, string> = { yellow: "Yellow", red: "Red", green: "Green", blue: "Blue" };

export interface MdAnnotation {
  id: string;
  color: MarkColor;
  /** Where the quoted text was last found: offsets into the preview's text (blocks separated by one newline). */
  start: number;
  end: number;
  /** The highlighted text itself. */
  quote: string;
  /** Up to CONTEXT characters before and after it, used to tell repeated quotes apart. */
  prefix: string;
  suffix: string;
  /** The comment; empty for a bare highlight. */
  note: string;
  done: boolean;
}

export const CONTEXT = 32;
export const MAX_ANNOTATIONS = 300;
export const MAX_QUOTE = 2000;
export const MAX_NOTE = 2000;
const ID_RE = /^[a-z][a-z0-9]{3,15}$/;

export const newAnnotationId = () => "m" + Math.random().toString(36).slice(2, 9);

/** Builds an annotation for text[start, end) with its context. */
export function makeAnnotation(text: string, start: number, end: number, color: MarkColor, id = newAnnotationId()): MdAnnotation {
  const s = Math.max(0, Math.min(start, end)), e = Math.min(text.length, Math.max(start, end));
  return {
    id,
    color,
    start: s,
    end: e,
    quote: text.slice(s, e).slice(0, MAX_QUOTE),
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, e + CONTEXT),
    note: "",
    done: false,
  };
}

/** Keeps only well-formed annotations (a known colour, numeric offsets, a non-empty quote), capped in size and number. */
export function sanitizeAnnotations(input: unknown): MdAnnotation[] {
  if (!Array.isArray(input)) return [];
  const out: MdAnnotation[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const id = typeof a.id === "string" && ID_RE.test(a.id) ? a.id : null;
    const quote = typeof a.quote === "string" ? a.quote.slice(0, MAX_QUOTE) : "";
    const start = typeof a.start === "number" && Number.isFinite(a.start) && a.start >= 0 ? Math.floor(a.start) : null;
    if (!id || !quote || start === null || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      color: typeof a.color === "string" && (MARK_COLORS as string[]).includes(a.color) ? (a.color as MarkColor) : "yellow",
      start,
      end: start + quote.length,
      quote,
      prefix: typeof a.prefix === "string" ? a.prefix.slice(-CONTEXT) : "",
      suffix: typeof a.suffix === "string" ? a.suffix.slice(0, CONTEXT) : "",
      note: typeof a.note === "string" ? a.note.slice(0, MAX_NOTE) : "",
      done: a.done === true,
    });
    if (out.length >= MAX_ANNOTATIONS) break;
  }
  return out;
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * Where the annotation's text is in this (possibly changed) text: its remembered place when the quote is still there,
 * otherwise the occurrence whose surroundings match best, nearest to the old place on a tie; null when it is gone.
 */
export function locate(text: string, a: MdAnnotation): { start: number; end: number } | null {
  const q = a.quote;
  if (!q) return null;
  if (text.slice(a.start, a.start + q.length) === q) return { start: a.start, end: a.start + q.length };
  let best: { start: number; score: number; dist: number } | null = null;
  let from = 0, n = 0;
  for (;;) {
    const i = text.indexOf(q, from);
    if (i < 0 || n++ > 500) break;
    const before = text.slice(Math.max(0, i - CONTEXT), i), after = text.slice(i + q.length, i + q.length + CONTEXT);
    const score = commonSuffix(before, a.prefix) + commonPrefix(after, a.suffix);
    const dist = Math.abs(i - a.start);
    if (!best || score > best.score || (score === best.score && dist < best.dist)) best = { start: i, score, dist };
    from = i + 1;
  }
  return best ? { start: best.start, end: best.start + q.length } : null;
}

export interface Placed extends MdAnnotation {
  /** Position in the current text, or null when the quoted text is no longer there. */
  at: { start: number; end: number } | null;
  /** 1-based, in order of appearance (lost ones after the rest, in their old order). */
  n: number;
}

/** Every annotation located in the text and numbered in document order, lost ones last. */
export function placeAnnotations(text: string, list: MdAnnotation[]): Placed[] {
  const found: Placed[] = [], lost: Placed[] = [];
  for (const a of list) {
    const at = locate(text, a);
    (at ? found : lost).push({ ...a, at, n: 0 });
  }
  found.sort((x, y) => x.at!.start - y.at!.start || x.at!.end - y.at!.end || x.id.localeCompare(y.id));
  lost.sort((x, y) => x.start - y.start);
  return [...found, ...lost].map((p, i) => ({ ...p, n: i + 1 }));
}

/** The list with every found annotation's remembered place and context refreshed; the same array when nothing moved. */
export function reanchor(text: string, list: MdAnnotation[], placed: Placed[]): MdAnnotation[] {
  let changed = false;
  const byId = new Map(placed.map((p) => [p.id, p]));
  const next = list.map((a) => {
    const at = byId.get(a.id)?.at;
    if (!at || (at.start === a.start && at.end === a.end)) return a;
    changed = true;
    return { ...a, start: at.start, end: at.end, prefix: text.slice(Math.max(0, at.start - CONTEXT), at.start), suffix: text.slice(at.end, at.end + CONTEXT) };
  });
  return changed ? next : list;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const shortQuote = (q: string, max = 160) => {
  const one = q.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
};

/** The annotations as a numbered section for the exported or printed document. */
export function annotationsHtml(placed: Placed[]): string {
  if (!placed.length) return "";
  const items = placed
    .map(
      (p) =>
        `<li data-color="${p.color}"${p.done ? ' class="md-notes-done"' : ""}><span class="md-notes-n">${p.n}</span><q>${esc(shortQuote(p.quote))}</q>${p.note ? ` <span class="md-notes-text">${esc(p.note)}</span>` : ""}${p.done ? ' <em class="md-notes-state">Resolved</em>' : ""}${p.at ? "" : ' <em class="md-notes-state">Text no longer in the document</em>'}</li>`,
    )
    .join("");
  return `<section class="md-notes"><h2>Annotations</h2><ol>${items}</ol></section>`;
}

/** The annotations as a Markdown list to paste into a review or a message. */
export function annotationsMarkdown(placed: Placed[]): string {
  return placed
    .map((p) => {
      const parts = [`${p.n}. “${shortQuote(p.quote)}”`];
      if (p.note) parts.push(`— ${p.note.replace(/\s*\n\s*/g, " ")}`);
      if (p.done) parts.push("✓");
      if (!p.at) parts.push("(text no longer in the document)");
      return parts.join(" ");
    })
    .join("\n");
}
