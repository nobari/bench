/**
 * Fonts for text PDF Studio writes itself (replaced lines, added text, watermarks, headers): one of the standard
 * fourteen when the text fits WinAnsi, else Liberation Sans (metric-compatible with Arial; Latin, Greek and
 * Cyrillic), embedded from pdf.js's own font folder. Font bytes come through a `FontSource` so the worker fetches
 * them and Node checks read them from node_modules.
 */
import fontkit from "@cantoo/fontkit";
import { PDFDocument, StandardFonts, type PDFFont } from "@cantoo/pdf-lib";

export interface FontStyle {
  family: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
}

export type LiberationFace = "LiberationSans-Regular" | "LiberationSans-Bold" | "LiberationSans-Italic" | "LiberationSans-BoldItalic";

export interface FontSource {
  bytes(face: LiberationFace): Promise<Uint8Array>;
}

export interface ChosenFont {
  font: PDFFont;
  /** A simple (single-byte) font: word spacing applies to its spaces. */
  simple: boolean;
  /** Characters the font cannot show, if any. */
  missing: string[];
}

const STANDARD: Record<FontStyle["family"], [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

const cache = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

function cached(doc: PDFDocument, key: string, make: () => Promise<PDFFont>): Promise<PDFFont> {
  let m = cache.get(doc);
  if (!m) {
    m = new Map();
    cache.set(doc, m);
  }
  let p = m.get(key);
  if (!p) {
    p = make();
    m.set(key, p);
  }
  return p;
}

const styleIndex = (s: FontStyle) => (s.bold ? 1 : 0) + (s.italic ? 2 : 0);

const charSets = new WeakMap<PDFFont, Set<number>>();

/** Whether every character of the text is in the font (pdf-lib writes "?" for the rest rather than throwing). */
function canEncode(font: PDFFont, text: string): boolean {
  let set = charSets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charSets.set(font, set);
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 32) continue;
    if (!set.has(cp)) return false;
  }
  return true;
}

/** The standard font for a style (WinAnsi text only). */
export function standardFont(doc: PDFDocument, style: FontStyle): Promise<PDFFont> {
  const name = STANDARD[style.family][styleIndex(style)];
  return cached(doc, `std:${name}`, () => doc.embedFont(name));
}

export function liberationFace(style: FontStyle): LiberationFace {
  return (["LiberationSans-Regular", "LiberationSans-Bold", "LiberationSans-Italic", "LiberationSans-BoldItalic"] as const)[styleIndex(style)];
}

/** Liberation Sans in a style, embedded (subset) through fontkit. */
export function liberationFont(doc: PDFDocument, source: FontSource, style: FontStyle): Promise<PDFFont> {
  const face = liberationFace(style);
  return cached(doc, `lib:${face}`, async () => {
    doc.registerFontkit(fontkit);
    const bytes = await source.bytes(face);
    return doc.embedFont(bytes, { subset: true, customName: face });
  });
}

/** The font to write `text` with: standard when it can, Liberation Sans otherwise. */
export async function fontFor(doc: PDFDocument, source: FontSource, text: string, style: FontStyle): Promise<ChosenFont> {
  const std = await standardFont(doc, style);
  if (canEncode(std, text)) return { font: std, simple: true, missing: [] };
  const lib = await liberationFont(doc, source, style);
  let set = charSets.get(lib);
  if (!set) {
    set = new Set(lib.getCharacterSet());
    charSets.set(lib, set);
  }
  const have = set;
  const missing = [...new Set([...text].filter((ch) => !/\s/.test(ch) && !have.has(ch.codePointAt(0) ?? -1)))];
  return { font: lib, simple: false, missing };
}

/** The text without the characters the chosen font cannot show (they would print as boxes). */
export function dropMissing(text: string, missing: string[]): string {
  if (!missing.length) return text;
  const set = new Set(missing);
  return [...text].filter((ch) => !set.has(ch)).join("");
}

/** A font source reading pdf.js's font folder over HTTP (the worker and the page). */
export function httpFontSource(base: string): FontSource {
  const memo = new Map<string, Promise<Uint8Array>>();
  return {
    bytes(face) {
      let p = memo.get(face);
      if (!p) {
        p = fetch(`${base}standard_fonts/${face}.ttf`).then(async (r) => {
          if (!r.ok) throw new Error(`The font ${face} could not be loaded (${r.status})`);
          return new Uint8Array(await r.arrayBuffer());
        });
        memo.set(face, p);
      }
      return p;
    },
  };
}
