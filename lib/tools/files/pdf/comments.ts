/**
 * The comments of a document as one list, built from what pdf.js reads on each page: every markup annotation is an
 * entry, replies are threaded under their parent by /IRT, review states ("Completed") resolve a thread, and a text
 * markup carries the words under its quads when the page's text is given. Pure, so it runs in Node.
 */
import { parsePdfDate } from "./dates";

/** The fields of a pdf.js annotation this reads (page.getAnnotations({ intent: "any" })). */
export interface RawAnnotation {
  id: string;
  subtype?: string | null;
  rect?: ArrayLike<number> | null;
  contentsObj?: { str?: string } | null;
  titleObj?: { str?: string } | null;
  modificationDate?: string | null;
  creationDate?: string | null;
  /** RGB 0…255, or null. */
  color?: ArrayLike<number> | null;
  inReplyTo?: string | null;
  replyType?: string | null;
  state?: string | null;
  stateModel?: string | null;
  quadPoints?: ArrayLike<number> | null;
  popupRef?: string | null;
  hidden?: boolean;
  noView?: boolean;
  richText?: { str?: string } | null;
}

export type CommentKind = "note" | "highlight" | "underline" | "strikeout" | "squiggly" | "text" | "draw" | "stamp" | "shape" | "file" | "redact" | "other";

export interface PdfReply {
  id: string;
  author: string;
  date: Date | null;
  text: string;
}

export interface PdfComment {
  id: string;
  /** 0-based. */
  page: number;
  kind: CommentKind;
  author: string;
  date: Date | null;
  text: string;
  /** "#rrggbb" or null. */
  color: string | null;
  rect: [number, number, number, number];
  quads: number[] | null;
  /** The words under a text markup, when the page's text was given. */
  quote: string;
  replies: PdfReply[];
  resolved: boolean;
  /** Set on comments that exist only in the editor until the file is saved. */
  live?: boolean;
}

export const KIND_LABELS: Record<CommentKind, string> = {
  note: "Note",
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strike-out",
  squiggly: "Squiggle",
  text: "Text",
  draw: "Drawing",
  stamp: "Stamp",
  shape: "Shape",
  file: "Attached file",
  redact: "Redaction",
  other: "Mark",
};

const KINDS: Record<string, CommentKind> = {
  Text: "note",
  Highlight: "highlight",
  Underline: "underline",
  StrikeOut: "strikeout",
  Squiggly: "squiggly",
  FreeText: "text",
  Ink: "draw",
  Stamp: "stamp",
  Square: "shape",
  Circle: "shape",
  Line: "shape",
  Polygon: "shape",
  PolyLine: "shape",
  Caret: "other",
  FileAttachment: "file",
  Sound: "other",
  Redact: "redact",
};

export function kindOf(subtype: string | null | undefined): CommentKind | null {
  return subtype ? (KINDS[subtype] ?? null) : null;
}

export function colorHex(c: ArrayLike<number> | null | undefined): string | null {
  if (!c || c.length < 3) return null;
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

const str = (o: { str?: string } | null | undefined) => (o && typeof o.str === "string" ? o.str : "");

export interface TextItem {
  str: string;
  /** [a, b, c, d, e, f]: e, f is the baseline start in PDF user space. */
  transform: ArrayLike<number>;
  width: number;
  height: number;
}

/** The text items whose middle sits inside any of the quads, joined in reading order. */
export function quoteInQuads(items: TextItem[], quads: ArrayLike<number>): string {
  const boxes: [number, number, number, number][] = [];
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]], ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  if (!boxes.length) return "";
  const parts: string[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const cx = it.transform[4] + (it.width || 0) / 2;
    const cy = it.transform[5] + (it.height || 0) / 2;
    if (boxes.some(([x0, y0, x1, y1]) => cx >= x0 - 1 && cx <= x1 + 1 && cy >= y0 - 1 && cy <= y1 + 1)) parts.push(it.str);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export interface PageAnnotations {
  /** 0-based. */
  page: number;
  annots: RawAnnotation[];
  text?: TextItem[];
}

/** Every comment of the document, threaded and in page order, the highest on a page first. */
export function buildComments(pages: PageAnnotations[]): PdfComment[] {
  const roots = new Map<string, PdfComment>();
  const children: { page: number; a: RawAnnotation }[] = [];
  for (const { page, annots, text } of pages) {
    for (const a of annots) {
      const kind = kindOf(a.subtype);
      if (!kind) continue;
      if (a.inReplyTo) {
        children.push({ page, a });
        continue;
      }
      const rect = a.rect && a.rect.length >= 4 ? ([a.rect[0], a.rect[1], a.rect[2], a.rect[3]] as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]);
      const quads = a.quadPoints && a.quadPoints.length >= 8 ? Array.from(a.quadPoints) : null;
      roots.set(a.id, {
        id: a.id,
        page,
        kind,
        author: str(a.titleObj),
        date: parsePdfDate(a.modificationDate) ?? parsePdfDate(a.creationDate),
        text: str(a.contentsObj) || str(a.richText),
        color: colorHex(a.color),
        rect,
        quads,
        quote: quads && text ? quoteInQuads(text, quads) : "",
        replies: [],
        resolved: false,
      });
    }
  }
  // Replies may themselves be replied to; walk up to the root.
  const byId = new Map<string, RawAnnotation>();
  for (const c of children) byId.set(c.a.id, c.a);
  const rootOf = (a: RawAnnotation): PdfComment | null => {
    let cur: RawAnnotation | undefined = a;
    for (let hops = 0; cur && hops < 32; hops++) {
      const parent = cur.inReplyTo;
      if (!parent) return null;
      const root = roots.get(parent);
      if (root) return root;
      cur = byId.get(parent);
    }
    return null;
  };
  const states: { root: PdfComment; date: Date | null; resolved: boolean }[] = [];
  for (const { page, a } of children) {
    const root = rootOf(a);
    if (!root) {
      // An orphan reply: list it as its own comment rather than lose it.
      const kind = kindOf(a.subtype) ?? "other";
      roots.set(a.id, { id: a.id, page, kind, author: str(a.titleObj), date: parsePdfDate(a.modificationDate), text: str(a.contentsObj), color: colorHex(a.color), rect: [0, 0, 0, 0], quads: null, quote: "", replies: [], resolved: false });
      continue;
    }
    if (a.stateModel || a.state) {
      if ((a.stateModel ?? "Review") === "Review") states.push({ root, date: parsePdfDate(a.modificationDate) ?? parsePdfDate(a.creationDate), resolved: a.state === "Completed" });
      continue;
    }
    if (a.replyType === "Group") continue;
    root.replies.push({ id: a.id, author: str(a.titleObj), date: parsePdfDate(a.modificationDate) ?? parsePdfDate(a.creationDate), text: str(a.contentsObj) || str(a.richText) });
  }
  const latest = new Map<PdfComment, { date: number; resolved: boolean }>();
  for (const s of states) {
    const t = s.date?.getTime() ?? 0;
    const cur = latest.get(s.root);
    if (!cur || t >= cur.date) latest.set(s.root, { date: t, resolved: s.resolved });
  }
  for (const [root, s] of latest) root.resolved = s.resolved;
  const out = [...roots.values()];
  for (const c of out) c.replies.sort((x, y) => (x.date?.getTime() ?? 0) - (y.date?.getTime() ?? 0));
  out.sort((x, y) => x.page - y.page || y.rect[3] - x.rect[3] || x.rect[0] - y.rect[0] || x.id.localeCompare(y.id));
  return out;
}

const one = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

export function formatDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The comments as a Markdown list, grouped by page, to paste into a review. */
export function commentsMarkdown(list: PdfComment[], label: (page: number) => string = (p) => `Page ${p + 1}`): string {
  if (!list.length) return "";
  const lines: string[] = [];
  let page = -1;
  for (const c of list) {
    if (c.page !== page) {
      page = c.page;
      if (lines.length) lines.push("");
      lines.push(`## ${label(page)}`);
    }
    const head = [KIND_LABELS[c.kind], c.author && `by ${c.author}`, c.date && formatDate(c.date), c.resolved && "✓ resolved"].filter(Boolean).join(" · ");
    const body = [c.quote && `“${one(c.quote)}”`, c.text && one(c.text, 2000)].filter(Boolean).join(" — ");
    lines.push(`- ${head}${body ? `: ${body}` : ""}`);
    for (const r of c.replies) lines.push(`  - ${[r.author && `${r.author}`, r.date && formatDate(r.date)].filter(Boolean).join(" · ")}: ${one(r.text, 2000)}`);
  }
  return lines.join("\n");
}

export function commentsJson(list: PdfComment[], name: string): string {
  return JSON.stringify(
    {
      file: name,
      exported: new Date().toISOString(),
      comments: list.map((c) => ({
        id: c.id,
        page: c.page + 1,
        kind: c.kind,
        author: c.author,
        date: c.date?.toISOString() ?? null,
        text: c.text,
        quote: c.quote || undefined,
        color: c.color,
        rect: c.rect,
        resolved: c.resolved,
        replies: c.replies.map((r) => ({ id: r.id, author: r.author, date: r.date?.toISOString() ?? null, text: r.text })),
      })),
    },
    null,
    2,
  );
}
