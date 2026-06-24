/**
 * ASCII & character-code reference + encode/decode engine.
 *
 * Pure, deterministic, SSR-safe (no window/document, no Date/Math.random). All
 * output is a deterministic function of the input so results are shareable via
 * the URL.
 */

/* ------------------------------------------------------------------ table */

export interface AsciiRow {
  /** Decimal code point (0–255 in this table). */
  dec: number;
  /** Renderable glyph: a control-picture (␀…␡) for C0/DEL, else the char. */
  char: string;
  /** Lowercase 2+ digit hex, e.g. "0a", "ff". */
  hex: string;
  /** Octal, e.g. "012". */
  oct: string;
  /** 8-bit binary, e.g. "00001010". */
  bin: string;
  /** Numeric HTML entity, e.g. "&#10;". */
  html: string;
  /** Named HTML entity where one exists (e.g. "&amp;"), else "". */
  entity: string;
  /** Control / special name (NUL, SOH … DEL, SP, NBSP …) or "" for normal glyphs. */
  name: string;
  /** True for C0 controls (0–31), DEL (127) and C1 controls (128–159). */
  control: boolean;
}

/** Abbreviated names for the 33 C0 control characters plus DEL. */
const C0_NAMES = [
  "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL",
  "BS", "HT", "LF", "VT", "FF", "CR", "SO", "SI",
  "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB",
  "CAN", "EM", "SUB", "ESC", "FS", "GS", "RS", "US",
];

/** Abbreviated names for the C1 control block (128–159). */
const C1_NAMES = [
  "PAD", "HOP", "BPH", "NBH", "IND", "NEL", "SSA", "ESA",
  "HTS", "HTJ", "VTS", "PLD", "PLU", "RI", "SS2", "SS3",
  "DCS", "PU1", "PU2", "STS", "CCH", "MW", "SPA", "EPA",
  "SOS", "SGC", "SCI", "CSI", "ST", "OSC", "PM", "APC",
];

/** Named HTML entities for the common printable specials. */
const NAMED_ENTITIES: Record<number, string> = {
  34: "&quot;",
  38: "&amp;",
  39: "&apos;",
  60: "&lt;",
  62: "&gt;",
  160: "&nbsp;",
  161: "&iexcl;",
  162: "&cent;",
  163: "&pound;",
  164: "&curren;",
  165: "&yen;",
  166: "&brvbar;",
  167: "&sect;",
  168: "&uml;",
  169: "&copy;",
  170: "&ordf;",
  171: "&laquo;",
  172: "&not;",
  173: "&shy;",
  174: "&reg;",
  175: "&macr;",
  176: "&deg;",
  177: "&plusmn;",
  178: "&sup2;",
  179: "&sup3;",
  180: "&acute;",
  181: "&micro;",
  182: "&para;",
  183: "&middot;",
  184: "&cedil;",
  185: "&sup1;",
  186: "&ordm;",
  187: "&raquo;",
  188: "&frac14;",
  189: "&frac12;",
  190: "&frac34;",
  191: "&iquest;",
  215: "&times;",
  247: "&divide;",
};

/** Friendly names for a couple of otherwise-invisible printables. */
const SPECIAL_NAMES: Record<number, string> = {
  32: "SP",
  160: "NBSP",
  173: "SHY",
};

/** Return a renderable glyph for a code point (control-picture for C0/DEL). */
export function displayChar(dec: number): string {
  if (dec >= 0 && dec <= 31) return String.fromCodePoint(0x2400 + dec); // ␀…␟
  if (dec === 127) return "␡"; // ␡
  if (dec === 32) return "␠"; // ␠ (visible space marker)
  return String.fromCodePoint(dec);
}

/** Control / special name for a code point, or "" for an ordinary glyph. */
export function charName(dec: number): string {
  if (dec >= 0 && dec <= 31) return C0_NAMES[dec];
  if (dec === 127) return "DEL";
  if (dec >= 128 && dec <= 159) return C1_NAMES[dec - 128];
  return SPECIAL_NAMES[dec] ?? "";
}

function isControl(dec: number): boolean {
  return (dec >= 0 && dec <= 31) || dec === 127 || (dec >= 128 && dec <= 159);
}

/** Build a single ASCII reference row for a code point. */
export function asciiRow(dec: number): AsciiRow {
  return {
    dec,
    char: displayChar(dec),
    hex: dec.toString(16).padStart(2, "0"),
    oct: dec.toString(8).padStart(3, "0"),
    bin: dec.toString(2).padStart(8, "0"),
    html: `&#${dec};`,
    entity: NAMED_ENTITIES[dec] ?? "",
    name: charName(dec),
    control: isControl(dec),
  };
}

/**
 * Build the ASCII reference table.
 * @param extended when true returns codes 0–255, otherwise 0–127.
 */
export function buildAsciiTable(extended = false): AsciiRow[] {
  const max = extended ? 255 : 127;
  const rows: AsciiRow[] = [];
  for (let i = 0; i <= max; i++) rows.push(asciiRow(i));
  return rows;
}

/** Filter table rows by a free-text query (matches char, name, dec/hex/oct/bin). */
export function filterRows(rows: AsciiRow[], query: string): AsciiRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if (r.char.toLowerCase() === q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    if (String(r.dec) === q || r.dec.toString(16) === q || r.dec.toString(8) === q)
      return true;
    if (r.hex.includes(q) || r.oct.includes(q) || r.bin.includes(q)) return true;
    if (`0x${r.hex}`.includes(q)) return true;
    return false;
  });
}

/* ----------------------------------------------------------------- encode */

export type EncodeFormat = "dec" | "hex" | "oct" | "bin" | "html" | "escape";
export type Separator = "space" | "comma" | "none";

export const ENCODE_FORMATS: [EncodeFormat, string][] = [
  ["dec", "Decimal"],
  ["hex", "Hex"],
  ["oct", "Octal"],
  ["bin", "Binary"],
  ["html", "HTML entity"],
  ["escape", "\\x escape"],
];

export const SEPARATORS: [Separator, string][] = [
  ["space", "Space"],
  ["comma", "Comma"],
  ["none", "None"],
];

const SEP_CHARS: Record<Separator, string> = {
  space: " ",
  comma: ", ",
  none: "",
};

/** Decompose a string into Unicode code points. */
export function toCodePoints(input: string): number[] {
  return Array.from(input, (ch) => ch.codePointAt(0)!);
}

/** Format one code point in the requested representation. */
export function formatCode(dec: number, format: EncodeFormat): string {
  switch (format) {
    case "dec":
      return String(dec);
    case "hex":
      return dec.toString(16).padStart(2, "0").toUpperCase();
    case "oct":
      return dec.toString(8);
    case "bin":
      return dec.toString(2).padStart(8, "0");
    case "html":
      return `&#${dec};`;
    case "escape":
      return dec <= 0xff
        ? `\\x${dec.toString(16).padStart(2, "0").toUpperCase()}`
        : `\\u${dec.toString(16).padStart(4, "0").toUpperCase()}`;
  }
}

/** Encode text into per-character codes joined by the chosen separator. */
export function encodeText(
  input: string,
  format: EncodeFormat,
  separator: Separator,
): string {
  if (!input) return "";
  const codes = toCodePoints(input).map((c) => formatCode(c, format));
  // HTML entities and escapes carry their own delimiters; "none" packs tightly.
  if (format === "html" || format === "escape") {
    return separator === "none" ? codes.join("") : codes.join(SEP_CHARS[separator]);
  }
  return codes.join(separator === "none" ? "" : SEP_CHARS[separator]);
}

/* ----------------------------------------------------------------- decode */

export type DecodeBase = "auto" | "dec" | "hex" | "oct" | "bin";

export const DECODE_BASES: [DecodeBase, string][] = [
  ["auto", "Auto-detect"],
  ["dec", "Decimal"],
  ["hex", "Hex"],
  ["oct", "Octal"],
  ["bin", "Binary"],
];

export interface DecodeResult {
  ok: boolean;
  value: string;
  error?: string;
}

const BASE_RADIX: Record<Exclude<DecodeBase, "auto">, number> = {
  dec: 10,
  hex: 16,
  oct: 8,
  bin: 2,
};

/** Parse a single token to a code point for an explicit base. */
function parseToken(raw: string, base: Exclude<DecodeBase, "auto">): number | null {
  let token = raw.trim();
  if (!token) return null;
  // Strip common prefixes / HTML-entity wrappers.
  token = token
    .replace(/^&#x/i, "")
    .replace(/^&#/, "")
    .replace(/;$/, "")
    .replace(/^0x/i, "")
    .replace(/^\\x/i, "")
    .replace(/^\\u/i, "")
    .replace(/^0o/i, "")
    .replace(/^0b/i, "");
  if (!token) return null;
  const valid =
    base === "hex"
      ? /^[0-9a-f]+$/i
      : base === "dec"
        ? /^[0-9]+$/
        : base === "oct"
          ? /^[0-7]+$/
          : /^[01]+$/;
  if (!valid.test(token)) return null;
  const n = parseInt(token, BASE_RADIX[base]);
  return Number.isFinite(n) ? n : null;
}

/** Guess the base of a token from its prefix / digit shape. */
function detectToken(raw: string): number | null {
  let token = raw.trim();
  if (!token) return null;
  // Explicit numeric/hex HTML entities.
  if (/^&#x[0-9a-f]+;?$/i.test(token)) return parseToken(token, "hex");
  if (/^&#[0-9]+;?$/.test(token)) return parseToken(token, "dec");
  if (/^(0x|\\x)/i.test(token)) return parseToken(token, "hex");
  if (/^\\u/i.test(token)) return parseToken(token, "hex");
  if (/^0b/i.test(token)) return parseToken(token, "bin");
  if (/^0o/i.test(token)) return parseToken(token, "oct");
  token = token.replace(/;$/, "");
  if (/^[01]{8,}$/.test(token) && token.length % 8 === 0) return parseToken(token, "bin");
  if (/^[0-9a-f]+$/i.test(token) && /[a-f]/i.test(token)) return parseToken(token, "hex");
  if (/^[0-9]+$/.test(token)) return parseToken(token, "dec");
  if (/^[0-9a-f]+$/i.test(token)) return parseToken(token, "hex");
  return null;
}

/**
 * Decode a whitespace/comma/separator-delimited list of numeric codes back to
 * text. `base` "auto" inspects each token's prefix and shape.
 */
export function decodeCodes(input: string, base: DecodeBase): DecodeResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: "" };

  // Split on commas, whitespace and entity boundaries; keep escape markers attached.
  const tokens = trimmed
    .replace(/&#x?[0-9a-f]+;/gi, (m) => ` ${m} `)
    .replace(/\\x[0-9a-f]{2}/gi, (m) => ` ${m} `)
    .replace(/\\u[0-9a-f]{4}/gi, (m) => ` ${m} `)
    .split(/[\s,]+/)
    .filter(Boolean);

  if (tokens.length === 0) return { ok: true, value: "" };

  const points: number[] = [];
  for (const tok of tokens) {
    const cp = base === "auto" ? detectToken(tok) : parseToken(tok, base);
    if (cp === null) {
      return { ok: false, value: "", error: `Couldn't parse "${tok}"` };
    }
    if (cp > 0x10ffff) {
      return { ok: false, value: "", error: `Code point out of range: ${cp}` };
    }
    points.push(cp);
  }

  try {
    return { ok: true, value: String.fromCodePoint(...points) };
  } catch {
    return { ok: false, value: "", error: "Invalid code point sequence" };
  }
}

/* ------------------------------------------------------------------ stats */

/** Char / byte counts for the encode readout (SSR-safe, no TextEncoder reuse). */
export function textStatsSafe(s: string): { chars: number; bytes: number } {
  const chars = toCodePoints(s).length;
  let bytes = 0;
  for (const cp of toCodePoints(s)) {
    if (cp <= 0x7f) bytes += 1;
    else if (cp <= 0x7ff) bytes += 2;
    else if (cp <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return { chars, bytes };
}
