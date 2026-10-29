/**
 * Rewriting the text-showing operators of a page in place: a line's glyphs replaced by other glyphs of the same font,
 * by text in a stand-in font, or by nothing but the room they took (so what follows on the line stays put). The
 * geometry — which glyphs, what they measured — comes from pdf.js on the main thread (lib/tools/files/pdf/textruns.ts);
 * this side finds the operators by ordinal (lib/tools/files/pdf/walk.ts), re-encodes bytes and writes the streams.
 */
import { PDFDict, PDFDocument, PDFName, PDFRef, type PDFFont } from "@cantoo/pdf-lib";
import { hexString, num, spliceBytes, type ContentOp, type Operand } from "./content";
import { walkPage, type TextSite, type WalkResult } from "./walk";
import { dropMissing, fontFor, type FontStyle, type FontSource } from "./fonts";

/** A piece of a rewritten operator. Adjustments are in TJ units (thousandths of the font size, positive = left). */
export type TextChunk =
  | { codes: number[] }
  | { adjust: number }
  /** Text in a stand-in font; `originalAdvance` is what the glyphs it replaces measured (text-space units). */
  | { text: string; style: FontStyle; originalAdvance: number }
  /** Put back here whatever the stand-in text changed in length, so what follows stays where it was. */
  | { settle: true };

export interface TextOpEdit {
  ordinal: number;
  /** Every glyph code of the operator, in order (to learn how the font's codes are written as bytes). */
  codes: number[];
  chunks: TextChunk[];
  /** The whole operator's advance in text-space units, for when its bytes cannot be matched to the codes. */
  advance: number;
}

/* ---------------------------------------------------------------- codes */

/** The strings an operator shows, concatenated (TJ arrays interleave numbers, which are skipped). */
function opStrings(op: ContentOp): Uint8Array {
  const last = op.args[op.args.length - 1];
  if (!last) return new Uint8Array(0);
  if (last.t === "str") return last.v;
  if (last.t === "arr") {
    const parts = last.v.filter((x): x is { t: "str"; v: Uint8Array } => x.t === "str").map((x) => x.v);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  return new Uint8Array(0);
}

/**
 * How many bytes each glyph's code took in the strings: the byte lengths that make the codes read back from the
 * bytes in order (1 for simple fonts, 2 for Identity CMaps, mixed for a few CJK encodings), or null when no
 * assignment works.
 */
export function alignCodes(bytes: Uint8Array, codes: number[]): number[] | null {
  const n = codes.length;
  const memo = new Map<string, number[] | null>();
  const solve = (i: number, pos: number, prevLen: number): number[] | null => {
    if (i === n) return pos === bytes.length ? [] : null;
    const key = `${i}:${pos}:${prevLen}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const lens = prevLen ? [prevLen, 1, 2, 3, 4].filter((v, k, arr) => arr.indexOf(v) === k) : [1, 2, 3, 4];
    let found: number[] | null = null;
    for (const L of lens) {
      if (pos + L > bytes.length) continue;
      let v = 0;
      for (let k = 0; k < L; k++) v = v * 256 + bytes[pos + k];
      if (v !== codes[i]) continue;
      const rest = solve(i + 1, pos + L, L);
      if (rest) {
        found = [L, ...rest];
        break;
      }
    }
    memo.set(key, found);
    return found;
  };
  return solve(0, 0, 0);
}

export function encodeCode(code: number, length: number): number[] {
  const out: number[] = [];
  for (let k = length - 1; k >= 0; k--) out.push((code >>> (8 * k)) & 0xff);
  return out;
}

/* ------------------------------------------------------------- rewrite */

interface Replacement {
  site: TextSite["site"];
  start: number;
  end: number;
  text: string;
}

function prefixFor(op: ContentOp): string {
  if (op.op === "'") return "T* ";
  if (op.op === '"') {
    const a = op.args;
    const aw = a[a.length - 3], ac = a[a.length - 2];
    return `${num(aw?.t === "num" ? aw.v : 0)} Tw ${num(ac?.t === "num" ? ac.v : 0)} Tc T* `;
  }
  return "";
}

interface FontSlot {
  /** The resource name in this stream. */
  name: string;
  font: PDFFont;
  simple: boolean;
}

/** Adds a font to the resources of a content stream (page or form XObject) and returns its name there. */
function fontResource(doc: PDFDocument, site: TextSite["site"], pageIndex: number, font: PDFFont, cache: Map<string, string>): string {
  const key = `${site.ref?.tag ?? "page"}:${font.ref.tag}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let name: string;
  if (site.kind === "page") {
    name = doc.getPage(pageIndex).node.newFontDictionary("Bench", font.ref).decodeText();
  } else {
    const dict = site.stream!.dict;
    let res = dict.lookup(PDFName.of("Resources"));
    if (!(res instanceof PDFDict)) {
      res = doc.context.obj({});
      dict.set(PDFName.of("Resources"), res);
    }
    let fonts = (res as PDFDict).lookup(PDFName.of("Font"));
    if (!(fonts instanceof PDFDict)) {
      fonts = doc.context.obj({});
      (res as PDFDict).set(PDFName.of("Font"), fonts);
    }
    let k = 1;
    while ((fonts as PDFDict).has(PDFName.of(`Bench${k}`))) k++;
    name = `Bench${k}`;
    (fonts as PDFDict).set(PDFName.of(name), font.ref);
  }
  cache.set(key, name);
  return name;
}

const nameOperand = (n: string) => `/${n.replace(/[^\x21-\x7e]|[#/()<>[\]{}%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, "0")}`)}`;

export interface RewriteResult {
  /** How many operators were rewritten. */
  count: number;
  /** Characters the stand-in font could not show. */
  missing: string[];
}

/**
 * Applies the edits to the page's content (and to the form XObjects it draws, when a line lives there). A missing
 * ordinal (the document changed underneath) throws.
 */
export async function rewriteTextOps(doc: PDFDocument, pageIndex: number, edits: TextOpEdit[], fonts: FontSource, walked?: WalkResult): Promise<RewriteResult> {
  const walk = walked ?? walkPage(doc, pageIndex);
  const byOrdinal = new Map(walk.texts.map((t) => [t.ordinal, t]));
  const replacements: Replacement[] = [];
  const fontNames = new Map<string, string>();
  const slots = new Map<string, FontSlot>();
  const missing = new Set<string>();
  for (const edit of edits) {
    const t = byOrdinal.get(edit.ordinal);
    if (!t) throw new Error("The text has changed since it was indexed — try again.");
    const bytes = opStrings(t.op);
    const lens = alignCodes(bytes, edit.codes);
    const fixed = lens && lens.length ? (lens.every((l) => l === lens[0]) ? lens[0] : null) : null;
    const Tfs = t.state.text.fontSize;
    const parts: string[] = [];
    let group: string[] = [];
    const flush = () => {
      if (group.length) parts.push(`[${group.join(" ")}] TJ`);
      group = [];
    };
    const pushCodes = (codes: number[]) => {
      if (!codes.length) return;
      const out: number[] = [];
      for (const c of codes) out.push(...encodeCode(c, fixed ?? (c > 0xffff ? 3 : c > 0xff ? 2 : 1)));
      group.push(hexString(Uint8Array.from(out)));
    };
    if (!lens) {
      // The bytes could not be matched to the glyphs: leave only the room the operator took.
      if (edit.chunks.some((c) => "text" in c)) throw new Error("This text's encoding could not be read back; it cannot be edited in place.");
      parts.push(`[${num(Tfs ? (-edit.advance * 1000) / Tfs : 0)}] TJ`);
    } else {
      let pending = 0;
      for (const chunk of edit.chunks) {
        if ("settle" in chunk) {
          if (pending) group.push(num(pending));
          pending = 0;
          continue;
        }
        if ("codes" in chunk) {
          if (fixed === null && chunk.codes.length) {
            // Mixed code lengths: only glyphs that were in the operator can be written back, as their own bytes.
            const spans = new Map<number, number[]>();
            let pos = 0;
            edit.codes.forEach((c, i) => {
              spans.set(c, Array.from(bytes.subarray(pos, pos + lens[i])));
              pos += lens[i];
            });
            const out: number[] = [];
            for (const c of chunk.codes) {
              const s = spans.get(c);
              if (!s) throw new Error("A character is not available in this font; the line was not changed.");
              out.push(...s);
            }
            group.push(hexString(Uint8Array.from(out)));
          } else pushCodes(chunk.codes);
        } else if ("adjust" in chunk) {
          if (chunk.adjust) group.push(num(chunk.adjust));
        } else {
          flush();
          const font = await fontFor(doc, fonts, chunk.text, chunk.style);
          font.missing.forEach((ch) => missing.add(ch));
          const slotKey = `${t.site.ref?.tag ?? "page"}:${font.font.ref.tag}`;
          let slot = slots.get(slotKey);
          if (!slot) {
            slot = { name: fontResource(doc, t.site, pageIndex, font.font, fontNames), font: font.font, simple: font.simple };
            slots.set(slotKey, slot);
          }
          const size = Tfs || 1;
          const text = dropMissing(chunk.text, font.missing);
          const encoded = slot.font.encodeText(text).toString();
          const width = slot.font.widthOfTextAtSize(text, size);
          const spaces = slot.simple ? (text.match(/ /g)?.length ?? 0) : 0;
          const newAdvance = width + t.state.text.charSpacing * [...text].length + t.state.text.wordSpacing * spaces;
          pending += Tfs ? ((newAdvance - chunk.originalAdvance) * 1000) / Tfs : 0;
          const restore = t.state.text.fontName ? ` ${nameOperand(t.state.text.fontName)} ${num(Tfs)} Tf` : "";
          parts.push(`${nameOperand(slot.name)} ${num(size)} Tf [${encoded}] TJ${restore}`);
        }
      }
      flush();
    }
    if (!parts.length) parts.push("[] TJ");
    replacements.push({ site: t.site, start: t.op.start, end: t.op.end, text: prefixFor(t.op) + parts.join(" ") });
  }
  // Write each touched stream once.
  const sites = new Map<TextSite["site"], Replacement[]>();
  for (const r of replacements) sites.set(r.site, [...(sites.get(r.site) ?? []), r]);
  for (const [site, list] of sites) {
    const bytes = spliceBytes(site.bytes, list.map((r) => ({ start: r.start, end: r.end, text: r.text })));
    writeStream(doc, pageIndex, site, bytes);
  }
  return { count: replacements.length, missing: [...missing] };
}

/** Replaces a walked stream's bytes: the page's content becomes one stream; a form XObject keeps its dictionary. */
export function writeStream(doc: PDFDocument, pageIndex: number, site: TextSite["site"], bytes: Uint8Array): void {
  const stream = doc.context.flateStream(bytes);
  if (site.kind === "page") {
    const ref = doc.context.register(stream);
    doc.getPage(pageIndex).node.set(PDFName.of("Contents"), ref);
    site.bytes = bytes;
    return;
  }
  const old = site.stream!;
  for (const [k, v] of old.dict.entries()) {
    const key = k.decodeText();
    if (key === "Filter" || key === "DecodeParms" || key === "Length") continue;
    stream.dict.set(k, v);
  }
  if (site.ref instanceof PDFRef) doc.context.assign(site.ref, stream);
  site.bytes = bytes;
}

/** The last string operand's bytes of an operator (for checks). */
export function operandBytes(op: ContentOp): Uint8Array {
  return opStrings(op);
}

export type { Operand };
