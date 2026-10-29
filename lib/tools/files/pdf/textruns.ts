/**
 * The text of a page as lines that can be edited or redacted, built from pdf.js's operator list: every `showText`
 * replayed with the same arithmetic as pdf.js's canvas, so each glyph gets its place on the page, and runs that sit
 * on one baseline next to each other are grouped into lines. The Nth `showText` is the Nth text operator the
 * worker's walk finds (lib/tools/files/pdf/walk.ts), which is how an edit here finds its bytes there. Pure: it
 * takes the operator codes, the list and the fonts, and touches no DOM.
 */
import { IDENTITY, compose, invert, type Matrix } from "./content";
import { glyphToUnicode } from "./glyphnames";
import type { TextChunk, TextOpEdit } from "./textops";
import type { FontStyle } from "./fonts";

export interface OpsConstants {
  save: number;
  restore: number;
  transform: number;
  beginText: number;
  endText: number;
  setFont: number;
  setTextMatrix: number;
  moveText: number;
  setLeadingMoveText: number;
  nextLine: number;
  setLeading: number;
  setCharSpacing: number;
  setWordSpacing: number;
  setHScale: number;
  setTextRise: number;
  setTextRenderingMode: number;
  showText: number;
  setFillRGBColor: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
}

/** What the indexer needs to know about a font pdf.js loaded. */
export interface FontInfo {
  key: string;
  fontMatrix: number[] | null;
  vertical: boolean;
  type3: boolean;
  /** Fractions of the font size. */
  ascent: number;
  descent: number;
  family: FontStyle["family"];
  bold: boolean;
  italic: boolean;
  name: string;
  /**
   * For a simple font that is not a subset: its encoding (glyph names by code) and widths, so every character the
   * font has can be typed, not only those on the page.
   */
  encoding?: { names: ArrayLike<string | undefined>; differences?: ArrayLike<string | undefined> | Record<string, string>; widths: Record<string, number> | ArrayLike<number> };
}

/** A glyph pdf.js produced for a `showText` (the fields this module reads). */
export interface PdfGlyph {
  originalCharCode: number;
  unicode: string;
  width: number;
  isSpace: boolean;
}

export interface GlyphCell {
  kind: "glyph";
  ch: string;
  code: number;
  /** Advance including spacing, in text-space units before horizontal scaling. */
  adv: number;
  isSpace: boolean;
  /** Position along the baseline in the operator's own frame. */
  x0: number;
  x1: number;
}

export interface GapCell {
  kind: "gap";
  /** TJ units (thousandths of the font size; positive pulls left). */
  adjust: number;
  adv: number;
  x0: number;
  x1: number;
  /** True when the gap reads as a space between words. */
  space: boolean;
}

export type Cell = GlyphCell | GapCell;

export interface OpRecord {
  ordinal: number;
  cells: Cell[];
  fontKey: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  advance: number;
}

export interface LineSegment {
  ordinal: number;
  /** The cells of the operator this line covers: [from, to). */
  from: number;
  to: number;
  /** Where the segment's first cell starts along the line's baseline (line frame units). */
  offset: number;
  /** A word break lies between the previous segment and this one. */
  gapBefore: boolean;
}

export interface TextLine {
  id: string;
  page: number;
  /** Frame → PDF user space. Frame x runs along the baseline in text-space units; y is up, in points of the font. */
  matrix: Matrix;
  x0: number;
  x1: number;
  ascent: number;
  descent: number;
  font: FontInfo;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hscale: number;
  /** CSS colour of the fill, when known. */
  color: string | null;
  text: string;
  segments: LineSegment[];
  editable: boolean;
  reason?: string;
  /** Invisible text (render mode 3 or clipping): OCR layers and the like. */
  hidden: boolean;
  inXObject: boolean;
}

export interface GlyphEntry {
  code: number;
  width: number;
  isSpace: boolean;
}

export interface PageTextIndex {
  page: number;
  lines: TextLine[];
  ops: Map<number, OpRecord>;
  /** For each font, which characters the page already shows (or the font's whole table) and how they are coded. */
  glyphs: Map<string, Map<string, GlyphEntry>>;
  /** How many `showText` operators the list held (the worker must count the same). */
  count: number;
}

interface State {
  ctm: Matrix;
  fontKey: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hscale: number;
  leading: number;
  rise: number;
  renderMode: number;
  textMatrix: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  color: string | null;
}

const fresh = (): State => ({ ctm: IDENTITY, fontKey: null, fontSize: 0, charSpacing: 0, wordSpacing: 0, hscale: 1, leading: 0, rise: 0, renderMode: 0, textMatrix: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0, color: null });

const cssColor = (arg: unknown): string | null => {
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg) || ArrayBuffer.isView(arg)) {
    const a = arg as ArrayLike<number>;
    if (a.length >= 3) return `rgb(${Math.round(a[0])}, ${Math.round(a[1])}, ${Math.round(a[2])})`;
  }
  return null;
};

const sixNumbers = (args: unknown[] | null): Matrix | null => {
  if (!args) return null;
  const src = args.length === 1 && args[0] && typeof args[0] === "object" ? (args[0] as ArrayLike<number>) : (args as ArrayLike<number>);
  if (src.length < 6) return null;
  const m = [src[0], src[1], src[2], src[3], src[4], src[5]].map(Number);
  return m.every(Number.isFinite) ? (m as Matrix) : null;
};

/** A TJ gap wide enough to read as a word break: about a fifth of an em. */
const GAP_SPACE = 150;
/** A gap this wide separates columns: the line ends there. */
const GAP_BREAK = 1500;

interface Segment {
  ordinal: number;
  from: number;
  to: number;
  /** Frame of the segment's first cell. */
  matrix: Matrix;
  width: number;
  key: string;
  state: State;
  depth: number;
  font: FontInfo | undefined;
}

export function buildTextIndex(page: number, OPS: OpsConstants, fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, fonts: Map<string, FontInfo>): PageTextIndex {
  const ops = new Map<number, OpRecord>();
  const glyphs = new Map<string, Map<string, GlyphEntry>>();
  const segments: Segment[] = [];
  const stack: State[] = [];
  let s = fresh();
  let ordinal = 0;
  let depth = 0;
  const n = fnArray.length;
  for (let i = 0; i < n; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push({ ...s });
        break;
      case OPS.restore:
        s = stack.pop() ?? s;
        break;
      case OPS.transform: {
        const m = sixNumbers(args);
        if (m) s = { ...s, ctm: compose(m, s.ctm) };
        break;
      }
      case OPS.beginText:
        s = { ...s, textMatrix: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0 };
        break;
      case OPS.setTextMatrix: {
        const m = sixNumbers(args);
        if (m) s = { ...s, textMatrix: m, x: 0, y: 0, lineX: 0, lineY: 0 };
        break;
      }
      case OPS.moveText:
        if (args) s = { ...s, x: s.lineX + Number(args[0]), lineX: s.lineX + Number(args[0]), y: s.lineY + Number(args[1]), lineY: s.lineY + Number(args[1]) };
        break;
      case OPS.setLeadingMoveText:
        if (args) s = { ...s, leading: -Number(args[1]), x: s.lineX + Number(args[0]), lineX: s.lineX + Number(args[0]), y: s.lineY + Number(args[1]), lineY: s.lineY + Number(args[1]) };
        break;
      case OPS.nextLine:
        s = { ...s, x: s.lineX, y: s.lineY + s.leading, lineY: s.lineY + s.leading };
        break;
      case OPS.setLeading:
        if (args) s = { ...s, leading: -Number(args[0]) };
        break;
      case OPS.setFont:
        if (args) s = { ...s, fontKey: String(args[0]), fontSize: Number(args[1]) };
        break;
      case OPS.setCharSpacing:
        if (args) s = { ...s, charSpacing: Number(args[0]) };
        break;
      case OPS.setWordSpacing:
        if (args) s = { ...s, wordSpacing: Number(args[0]) };
        break;
      case OPS.setHScale:
        if (args) s = { ...s, hscale: Number(args[0]) / 100 };
        break;
      case OPS.setTextRise:
        if (args) s = { ...s, rise: Number(args[0]) };
        break;
      case OPS.setTextRenderingMode:
        if (args) s = { ...s, renderMode: Number(args[0]) };
        break;
      case OPS.setFillRGBColor:
        if (args) s = { ...s, color: cssColor(args.length === 1 ? args[0] : args) };
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...s });
        const m = args && Array.isArray(args[0]) ? sixNumbers([args[0]]) : null;
        if (m) s = { ...s, ctm: compose(m, s.ctm) };
        depth++;
        break;
      }
      case OPS.paintFormXObjectEnd:
        s = stack.pop() ?? s;
        depth = Math.max(0, depth - 1);
        break;
      case OPS.showText: {
        const ord = ordinal++;
        const items = (args?.[0] ?? []) as (PdfGlyph | number)[];
        const font = s.fontKey ? fonts.get(s.fontKey) : undefined;
        const fm0 = font?.fontMatrix?.[0] ?? 0.001;
        const size = s.fontSize;
        const cells: Cell[] = [];
        let x = 0;
        let map = s.fontKey ? glyphs.get(s.fontKey) : null;
        if (s.fontKey && !map) {
          map = new Map<string, GlyphEntry>();
          glyphs.set(s.fontKey, map);
        }
        for (const it of items) {
          if (typeof it === "number") {
            const adv = (-it * size) / 1000;
            cells.push({ kind: "gap", adjust: it, adv, x0: x, x1: x + adv, space: -it >= GAP_SPACE });
            x += adv;
            continue;
          }
          if (!it || typeof it !== "object") continue;
          const spacing = (it.isSpace ? s.wordSpacing : 0) + s.charSpacing;
          const adv = it.width * fm0 * size + spacing;
          const ch = it.unicode ?? "";
          cells.push({ kind: "glyph", ch, code: it.originalCharCode, adv, isSpace: !!it.isSpace, x0: x, x1: x + adv });
          if (map && ch && !map.has(ch)) map.set(ch, { code: it.originalCharCode, width: it.width, isSpace: !!it.isSpace });
          x += adv;
        }
        const rec: OpRecord = { ordinal: ord, cells, fontKey: s.fontKey ?? "", fontSize: size, charSpacing: s.charSpacing, wordSpacing: s.wordSpacing, advance: x };
        ops.set(ord, rec);
        // The frame of this operator: translate to the text position, scale horizontally, then the text matrix and the CTM.
        const frame = compose([s.hscale, 0, 0, 1, 0, 0], compose([1, 0, 0, 1, s.x, s.y + s.rise], compose(s.textMatrix, s.ctm)));
        const key = `${s.fontKey}|${size}|${s.charSpacing}|${s.wordSpacing}|${s.hscale}|${s.rise}|${s.renderMode}|${s.color}|${depth}`;
        // Split the operator at column-wide gaps.
        let segStart = 0;
        for (let k = 0; k <= cells.length; k++) {
          const c = cells[k];
          const breakHere = k === cells.length || (c.kind === "gap" && Math.abs(c.adjust) >= GAP_BREAK);
          if (!breakHere) continue;
          if (k > segStart) {
            const first = cells[segStart], last = cells[k - 1];
            segments.push({ ordinal: ord, from: segStart, to: k, matrix: compose([1, 0, 0, 1, first.x0, 0], frame), width: last.x1 - first.x0, key, state: s, depth, font });
          }
          segStart = k + 1;
        }
        if (font?.vertical) s = { ...s, y: s.y - x };
        else s = { ...s, x: s.x + x * s.hscale };
        break;
      }
    }
  }

  /* ----------------------------------------------------------- lines */
  const lines: TextLine[] = [];
  let open: { line: TextLine; lastOrdinal: number; key: string; inv: Matrix | null } | null = null;
  for (const seg of segments) {
    const size = Math.abs(seg.state.fontSize) || 1;
    let merged = false;
    if (open && open.key === seg.key && open.inv && seg.ordinal <= open.lastOrdinal + 1) {
      const a = open.line.matrix, b = seg.matrix;
      const sameShape = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) < 1e-3 * (Math.hypot(a[0], a[1]) + Math.hypot(a[2], a[3]));
      if (sameShape) {
        const bx = open.inv[0] * b[4] + open.inv[2] * b[5] + open.inv[4];
        const by = open.inv[1] * b[4] + open.inv[3] * b[5] + open.inv[5];
        const end = open.line.x1;
        if (Math.abs(by) <= 0.2 * size && bx >= end - 0.35 * size && bx <= end + 0.8 * size) {
          open.line.segments.push({ ordinal: seg.ordinal, from: seg.from, to: seg.to, offset: bx, gapBefore: bx - end > 0.15 * size });
          open.line.x1 = Math.max(open.line.x1, bx + seg.width);
          open.lastOrdinal = seg.ordinal;
          merged = true;
        }
      }
    }
    if (merged) continue;
    if (open) lines.push(open.line);
    const st = seg.state;
    const font = seg.font;
    const hidden = st.renderMode === 3 || st.renderMode === 7;
    const reasons: string[] = [];
    if (!font) reasons.push("its font did not load");
    else if (font.vertical) reasons.push("it is vertical text");
    else if (font.type3) reasons.push("it uses a Type 3 font");
    if (st.fontSize <= 0) reasons.push("its size is not positive");
    if (hidden) reasons.push("it is invisible text");
    const line: TextLine = {
      id: `${page}:${seg.ordinal}:${seg.from}`,
      page,
      matrix: seg.matrix,
      x0: 0,
      x1: seg.width,
      ascent: (font?.ascent || 0.9) * size,
      descent: (font?.descent || -0.22) * size,
      font: font ?? { key: st.fontKey ?? "", fontMatrix: null, vertical: false, type3: false, ascent: 0.9, descent: -0.22, family: "sans", bold: false, italic: false, name: "" },
      fontSize: st.fontSize,
      charSpacing: st.charSpacing,
      wordSpacing: st.wordSpacing,
      hscale: st.hscale,
      color: st.color,
      text: "",
      segments: [{ ordinal: seg.ordinal, from: seg.from, to: seg.to, offset: 0, gapBefore: false }],
      editable: reasons.length === 0,
      reason: reasons.length ? `This text cannot be edited: ${reasons.join(", ")}.` : undefined,
      hidden,
      inXObject: seg.depth > 0,
    };
    open = { line, lastOrdinal: seg.ordinal, key: seg.key, inv: invert(seg.matrix) };
  }
  if (open) lines.push(open.line);
  for (const l of lines) l.text = lineText(l, ops);

  // A simple font's whole encoding is typeable, not only what the page shows.
  for (const [key, font] of fonts) {
    if (!font.encoding) continue;
    const table = encodingGlyphs(font);
    if (!table.size) continue;
    const map = glyphs.get(key) ?? new Map<string, GlyphEntry>();
    for (const [ch, g] of table) if (!map.has(ch)) map.set(ch, g);
    glyphs.set(key, map);
  }
  return { page, lines, ops, glyphs, count: ordinal };
}

/* ------------------------------------------------------------- cells */

export interface LineCell {
  cell: Cell;
  /** The operator the cell belongs to; -1 for a word break between two positioned runs. */
  ordinal: number;
  index: number;
  x0: number;
  x1: number;
}

/** The cells a line covers, in order, with a synthetic gap where two runs leave a word break between them. */
export function lineCells(line: TextLine, ops: Map<number, OpRecord>): LineCell[] {
  const out: LineCell[] = [];
  for (const seg of line.segments) {
    const rec = ops.get(seg.ordinal);
    if (!rec) continue;
    if (seg.gapBefore) {
      const prevEnd = out.length ? out[out.length - 1].x1 : 0;
      out.push({ cell: { kind: "gap", adjust: 0, adv: 0, x0: 0, x1: 0, space: true }, ordinal: -1, index: -1, x0: prevEnd, x1: seg.offset });
    }
    const base = rec.cells[seg.from]?.x0 ?? 0;
    for (let k = seg.from; k < seg.to; k++) {
      const c = rec.cells[k];
      out.push({ cell: c, ordinal: seg.ordinal, index: k, x0: seg.offset + c.x0 - base, x1: seg.offset + c.x1 - base });
    }
  }
  return out;
}

/** What each cell shows: a glyph's characters, a space for a word gap (never two in a row), else nothing. */
export function displayStrings(cells: LineCell[]): string[] {
  const out: string[] = [];
  let last = "";
  for (const c of cells) {
    let s = "";
    if (c.cell.kind === "glyph") s = c.cell.ch;
    else if (c.cell.space && last !== " " && last !== "") s = " ";
    out.push(s);
    if (s) last = s[s.length - 1];
  }
  // A trailing gap shows nothing.
  for (let i = out.length - 1; i >= 0 && cells[i].cell.kind === "gap"; i--) out[i] = "";
  return out;
}

export function lineText(line: TextLine, ops: Map<number, OpRecord>): string {
  return displayStrings(lineCells(line, ops)).join("");
}

/** The characters a font can show and their codes, from its encoding (simple, non-subset fonts). */
export function encodingGlyphs(font: FontInfo): Map<string, GlyphEntry> {
  const out = new Map<string, GlyphEntry>();
  const enc = font.encoding;
  if (!enc) return out;
  const diffs = enc.differences as Record<string, string> | undefined;
  for (let code = 32; code < 256; code++) {
    const name = diffs?.[code] ?? enc.names[code];
    const ch = glyphToUnicode(name);
    if (!ch) continue;
    const w = (enc.widths as Record<string, number>)[code];
    if (typeof w !== "number" || (!(w > 0) && ch !== " ")) continue;
    if (!out.has(ch)) out.set(ch, { code, width: w || 0, isSpace: code === 32 });
  }
  return out;
}

/** Adds the entries of `from` that `into` lacks (characters seen on a page win over a font's table). */
export function mergeGlyphMaps(into: Map<string, Map<string, GlyphEntry>>, from: Map<string, Map<string, GlyphEntry>>): void {
  for (const [font, map] of from) {
    const target = into.get(font) ?? new Map<string, GlyphEntry>();
    for (const [ch, g] of map) if (!target.has(ch)) target.set(ch, g);
    into.set(font, target);
  }
}

/* ------------------------------------------------------------ editing */

export interface LineEdit {
  ops: TextOpEdit[];
  /** True when the new text is written in a stand-in font rather than the line's own. */
  fallback: boolean;
}

const cellsToChunks = (cells: Cell[]): TextChunk[] => {
  const out: TextChunk[] = [];
  for (const c of cells) {
    if (c.kind === "gap") {
      if (c.adjust) out.push({ adjust: c.adjust });
      continue;
    }
    const last = out[out.length - 1];
    if (last && "codes" in last) last.codes.push(c.code);
    else out.push({ codes: [c.code] });
  }
  return out;
};

/**
 * The operator edits that turn a line's text into `text`: the unchanged start and end keep their glyphs and
 * kerning; the changed middle is re-encoded in the line's font when every character is available in it, else
 * written in a stand-in font; the line's end stays where it was.
 */
export function planLineEdit(index: PageTextIndex, line: TextLine, text: string, style: FontStyle, glyphs: Map<string, Map<string, GlyphEntry>> = index.glyphs): LineEdit {
  const cells = lineCells(line, index.ops);
  const shownPer = displayStrings(cells);
  const old = [...shownPer.join("")];
  const neu = [...text];
  // Common prefix and suffix, in displayed characters.
  let pre = 0;
  while (pre < old.length && pre < neu.length && old[pre] === neu[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < neu.length - pre && old[old.length - 1 - suf] === neu[neu.length - 1 - suf]) suf++;
  if (pre === old.length && suf === 0 && neu.length === old.length) return { ops: [], fallback: false };
  // Which cell shows each displayed character.
  const cellOfChar: number[] = [];
  shownPer.forEach((s, i) => {
    for (let k = 0; k < [...s].length; k++) cellOfChar.push(i);
  });
  let firstChanged = pre < cellOfChar.length ? cellOfChar[pre] : cells.length;
  let lastChanged = old.length - suf - 1 >= pre ? cellOfChar[old.length - suf - 1] : firstChanged - 1;
  // Keep partially covered cells whole: widen the changed span to cell boundaries.
  if (lastChanged >= firstChanged) {
    while (pre > 0 && cellOfChar[pre - 1] === firstChanged) pre--;
    while (old.length - suf < old.length && cellOfChar[old.length - suf] === lastChanged) suf--;
    firstChanged = cellOfChar[pre];
    lastChanged = cellOfChar[old.length - suf - 1];
  }
  const middle = neu.slice(pre, neu.length - suf).join("");

  const map = glyphs.get(line.font.key) ?? new Map<string, GlyphEntry>();
  const fm0 = line.font.fontMatrix?.[0] ?? 0.001;
  const size = line.fontSize;
  const gapWidth = medianGap(cells) ?? 250;
  // Encode the middle in the line's font when possible.
  const encoded: TextChunk[] = [];
  let encodedAdvance = 0;
  let ok = true;
  const keys = [...map.keys()].filter((k) => k.length > 1).sort((a, b) => b.length - a.length);
  let pos = 0;
  while (pos < middle.length) {
    let hit: string | null = null;
    for (const k of keys) {
      if (middle.startsWith(k, pos)) {
        hit = k;
        break;
      }
    }
    const ch = hit ?? String.fromCodePoint(middle.codePointAt(pos)!);
    pos += ch.length;
    const g = map.get(ch);
    if (g) {
      const last = encoded[encoded.length - 1];
      if (last && "codes" in last) last.codes.push(g.code);
      else encoded.push({ codes: [g.code] });
      encodedAdvance += g.width * fm0 * size + line.charSpacing + (g.isSpace ? line.wordSpacing : 0);
    } else if (ch === " ") {
      encoded.push({ adjust: -gapWidth });
      encodedAdvance += (gapWidth * size) / 1000;
    } else {
      ok = false;
      break;
    }
  }
  const fallback = !ok;
  const replacing = lastChanged >= firstChanged;

  // How much each operator loses, and which operator takes the new text (the first changed cell's; for an insertion,
  // the cell before the insertion point, else the one after it).
  const removedAdv = new Map<number, number>();
  if (replacing) for (let i = firstChanged; i <= lastChanged; i++) if (cells[i].ordinal >= 0) removedAdv.set(cells[i].ordinal, (removedAdv.get(cells[i].ordinal) ?? 0) + cells[i].cell.adv);
  let anchor = -1;
  let insertAfter: number | null = null;
  let insertBefore: number | null = null;
  if (replacing) {
    for (let i = firstChanged; i <= lastChanged; i++) if (cells[i].ordinal >= 0) { anchor = cells[i].ordinal; break; }
  } else {
    for (let i = Math.min(firstChanged, cells.length) - 1; i >= 0; i--) if (cells[i].ordinal >= 0) { anchor = cells[i].ordinal; insertAfter = cells[i].index; break; }
    if (anchor < 0) for (let i = firstChanged; i < cells.length; i++) if (cells[i].ordinal >= 0) { anchor = cells[i].ordinal; insertBefore = cells[i].index; break; }
  }
  if (anchor < 0) return { ops: [], fallback: false };
  const removedAnchor = removedAdv.get(anchor) ?? 0;
  const middleChunks: TextChunk[] = fallback ? (middle ? [{ text: middle, style, originalAdvance: removedAnchor }] : []) : encoded;
  const lineIndexOf = new Map<string, number>();
  cells.forEach((c, i) => c.ordinal >= 0 && lineIndexOf.set(`${c.ordinal}:${c.index}`, i));

  const ops: TextOpEdit[] = [];
  for (const seg of line.segments) {
    const rec = index.ops.get(seg.ordinal)!;
    const isAnchor = seg.ordinal === anchor;
    const removed = removedAdv.get(seg.ordinal) ?? 0;
    if (!isAnchor && !removed) continue;
    const chunks: TextChunk[] = [];
    chunks.push(...cellsToChunks(rec.cells.slice(0, seg.from)));
    let emitted = false;
    const pushMiddle = () => {
      chunks.push(...middleChunks);
      emitted = true;
    };
    for (let k = seg.from; k < seg.to; k++) {
      const li = lineIndexOf.get(`${seg.ordinal}:${k}`) ?? -1;
      const isChanged = replacing && li >= firstChanged && li <= lastChanged;
      if (isAnchor && insertBefore === k && !emitted) pushMiddle();
      if (isChanged) {
        if (isAnchor && !emitted) pushMiddle();
        continue;
      }
      chunks.push(...cellsToChunks([rec.cells[k]]));
      if (isAnchor && insertAfter === k && !emitted) pushMiddle();
    }
    if (isAnchor && !emitted) pushMiddle();
    // What follows the line in this operator (a column to the right) stays where it was.
    const post = rec.cells.slice(seg.to);
    if (post.length) {
      if (isAnchor && fallback) chunks.push({ settle: true });
      else {
        const delta = (isAnchor ? encodedAdvance : 0) - removed;
        if (delta && size) chunks.push({ adjust: (delta * 1000) / size });
      }
    }
    chunks.push(...cellsToChunks(post));
    ops.push({ ordinal: seg.ordinal, codes: rec.cells.filter((c): c is GlyphCell => c.kind === "glyph").map((c) => c.code), chunks: tidy(chunks), advance: rec.advance });
  }
  return { ops, fallback };
}

/** Merges runs of codes and of adjustments, which cellsToChunks emits one cell at a time. */
function tidy(chunks: TextChunk[]): TextChunk[] {
  const out: TextChunk[] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if ("codes" in c && last && "codes" in last) last.codes.push(...c.codes);
    else if ("adjust" in c && last && "adjust" in last) last.adjust += c.adjust;
    else out.push("codes" in c ? { codes: [...c.codes] } : "adjust" in c ? { adjust: c.adjust } : c);
  }
  return out.filter((c) => !("adjust" in c && !c.adjust) && !("codes" in c && !c.codes.length));
}

function medianGap(cells: LineCell[]): number | null {
  const gaps = cells.filter((c) => c.cell.kind === "gap" && c.cell.space && c.cell.adjust).map((c) => -(c.cell as GapCell).adjust);
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/* ---------------------------------------------------------- redaction */

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The operator edits that remove every glyph whose box meets one of the rectangles (PDF user space), leaving the room
 * it took so the rest of the line stays put. Lines in a hidden layer (OCR text) count too.
 */
export function planRedaction(index: PageTextIndex, rects: Rect[]): TextOpEdit[] {
  const removed = new Map<number, Set<number>>();
  for (const line of index.lines) {
    for (const c of lineCells(line, index.ops)) {
      if (c.cell.kind !== "glyph" || c.ordinal < 0) continue;
      const box = cellBounds(line, c.x0, c.x1);
      // A glyph goes when a mark covers a real part of it (a loosely drawn edge does not take the neighbour).
      if (rects.some((r) => covers(box, r))) {
        const set = removed.get(c.ordinal) ?? new Set<number>();
        set.add(c.index);
        removed.set(c.ordinal, set);
      }
    }
  }
  const ops: TextOpEdit[] = [];
  for (const [ordinal, set] of removed) {
    const rec = index.ops.get(ordinal)!;
    const chunks: TextChunk[] = [];
    for (let k = 0; k < rec.cells.length; k++) {
      const c = rec.cells[k];
      if (c.kind === "gap") {
        if (c.adjust) chunks.push({ adjust: c.adjust });
        continue;
      }
      if (set.has(k)) {
        chunks.push({ adjust: rec.fontSize ? (-c.adv * 1000) / rec.fontSize : 0 });
        continue;
      }
      const last = chunks[chunks.length - 1];
      if (last && "codes" in last) last.codes.push(c.code);
      else chunks.push({ codes: [c.code] });
    }
    ops.push({ ordinal, codes: rec.cells.filter((c): c is GlyphCell => c.kind === "glyph").map((c) => c.code), chunks: mergeAdjusts(chunks), advance: rec.advance });
  }
  return ops;
}

function mergeAdjusts(chunks: TextChunk[]): TextChunk[] {
  const out: TextChunk[] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if ("adjust" in c && last && "adjust" in last) last.adjust += c.adjust;
    else out.push("adjust" in c ? { adjust: c.adjust } : c);
  }
  return out;
}

/** A span of the line's baseline as a box in PDF user space (axis-aligned bounds of the frame rectangle). */
export function cellBounds(line: TextLine, x0: number, x1: number): Rect {
  const m = line.matrix;
  const pts = [
    [x0, line.descent],
    [x1, line.descent],
    [x0, line.ascent],
    [x1, line.ascent],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export const lineBounds = (line: TextLine): Rect => cellBounds(line, line.x0, line.x1);

/** True when `r` overlaps more than a quarter of the glyph box `g` in both directions, or holds its centre. */
const covers = (g: Rect, r: Rect) => {
  const ox = Math.min(g.x1, r.x1) - Math.max(g.x0, r.x0);
  const oy = Math.min(g.y1, r.y1) - Math.max(g.y0, r.y0);
  if (ox <= 0 || oy <= 0) return false;
  const cx = (g.x0 + g.x1) / 2, cy = (g.y0 + g.y1) / 2;
  if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) return true;
  return ox > 0.25 * (g.x1 - g.x0) && oy > 0.25 * (g.y1 - g.y0);
};

/* -------------------------------------------------------------- fonts */

/** A FontInfo from the object pdf.js hands out for a font (with fontExtraProperties on). */
export function fontInfoFrom(key: string, f: Record<string, unknown> | null): FontInfo {
  const cls = classifyFont((f ?? {}) as never);
  const name = String(f?.name ?? "");
  const subset = /^[A-Z]{6}\+/.test(name);
  const simple = !f?.composite && !f?.isType3Font;
  const encodable = simple && !subset && !f?.isSymbolicFont && Array.isArray(f?.defaultEncoding) && !!f?.widths && typeof f.widths === "object";
  return {
    key,
    fontMatrix: Array.isArray(f?.fontMatrix) ? (f!.fontMatrix as number[]) : null,
    vertical: !!f?.vertical,
    type3: !!f?.isType3Font,
    ascent: Number(f?.ascent) || 0.9,
    descent: Number(f?.descent) || -0.22,
    name,
    ...cls,
    encoding: encodable ? { names: f!.defaultEncoding as string[], differences: f!.differences as Record<string, string> | undefined, widths: f!.widths as Record<string, number> } : undefined,
  };
}

/** Which font family a pdf.js font reads as, from its flags and name. */
export function classifyFont(f: { name?: string; isSerifFont?: boolean; isMonospace?: boolean; bold?: boolean; italic?: boolean; black?: boolean }): Pick<FontInfo, "family" | "bold" | "italic"> {
  const name = (f.name ?? "").toLowerCase();
  const mono = f.isMonospace || /mono|courier|consolas|menlo|code/.test(name);
  const serif = !mono && (/times|georgia|garamond|cambria|book|serif|roman|minion|palatino|century|baskerville|caslon|didot|bodoni/.test(name) || (f.isSerifFont && !/arial|helvetica|verdana|calibri|segoe|tahoma|roboto|open ?sans|lato|inter|dejavusans|liberationsans|noto ?sans/.test(name)));
  const bold = !!(f.bold || f.black) || /bold|black|heavy|semibold|demibold/.test(name);
  const italic = !!f.italic || /italic|oblique/.test(name);
  return { family: mono ? "mono" : serif ? "serif" : "sans", bold, italic };
}
