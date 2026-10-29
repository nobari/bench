/**
 * PDF content streams as tokens: the operators of a page (or a form XObject) with their operands and the byte span
 * each occupies, so a stream can be rewritten by splicing. Pure and framework-free; used by the worker (through
 * lib/tools/files/pdf/walk.ts) and by Node checks.
 */

export type Operand =
  | { t: "num"; v: number }
  /** A name without its slash. */
  | { t: "name"; v: string }
  /** A literal or hex string, as the bytes it stands for. */
  | { t: "str"; v: Uint8Array }
  | { t: "arr"; v: Operand[] }
  | { t: "dict"; v: Map<string, Operand> }
  | { t: "bool"; v: boolean }
  | { t: "null" };

export interface ContentOp {
  op: string;
  args: Operand[];
  /** Byte offset of the first operand (or of the operator when it has none). */
  start: number;
  /** Byte offset just past the operator. */
  end: number;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (b: number) => !WS.has(b) && !DELIM.has(b);
const isDigitish = (b: number) => (b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e;

class Lexer {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  skipSpace() {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** The next token: an operand, an operator (`{ t: "op" }`), or null at the end. */
  next(): Operand | { t: "op"; v: string } | null {
    this.skipSpace();
    const b = this.bytes;
    if (this.pos >= b.length) return null;
    const c = b[this.pos];
    if (isDigitish(c)) return this.number();
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literalString();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return this.dict();
      }
      return this.hexString();
    }
    if (c === 0x5b) {
      this.pos++;
      return this.array();
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      // A stray delimiter: step over it.
      this.pos++;
      return this.next();
    }
    const start = this.pos;
    while (this.pos < b.length && isRegular(b[this.pos])) this.pos++;
    if (this.pos === start) {
      this.pos++;
      return this.next();
    }
    const word = latin1(b, start, this.pos);
    if (word === "true") return { t: "bool", v: true };
    if (word === "false") return { t: "bool", v: false };
    if (word === "null") return { t: "null" };
    return { t: "op", v: word };
  }

  private number(): Operand {
    const b = this.bytes;
    const start = this.pos;
    while (this.pos < b.length && isDigitish(b[this.pos])) this.pos++;
    const text = latin1(b, start, this.pos);
    // PDF numbers never carry an exponent; tolerate oddities like "--5" or "3.4.5" the way readers do.
    const cleaned = text.replace(/^([+-])[+-]+/, "$1").replace(/(\.\d*)\./, "$1");
    const v = parseFloat(cleaned);
    return { t: "num", v: Number.isFinite(v) ? v : 0 };
  }

  private name(): Operand {
    const b = this.bytes;
    this.pos++; // the slash
    let out = "";
    while (this.pos < b.length && isRegular(b[this.pos])) {
      const c = b[this.pos];
      if (c === 0x23 && this.pos + 2 < b.length) {
        const hex = parseInt(latin1(b, this.pos + 1, this.pos + 3), 16);
        if (Number.isFinite(hex)) {
          out += String.fromCharCode(hex);
          this.pos += 3;
          continue;
        }
      }
      out += String.fromCharCode(c);
      this.pos++;
    }
    return { t: "name", v: out };
  }

  private literalString(): Operand {
    const b = this.bytes;
    this.pos++; // (
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      let c = b[this.pos++];
      if (c === 0x5c) {
        if (this.pos >= b.length) break;
        c = b[this.pos++];
        switch (c) {
          case 0x6e: out.push(0x0a); break; // n
          case 0x72: out.push(0x0d); break; // r
          case 0x74: out.push(0x09); break; // t
          case 0x62: out.push(0x08); break; // b
          case 0x66: out.push(0x0c); break; // f
          case 0x0d: if (b[this.pos] === 0x0a) this.pos++; break; // line continuation
          case 0x0a: break;
          default:
            if (c >= 0x30 && c <= 0x37) {
              let v = c - 0x30;
              for (let k = 0; k < 2 && this.pos < b.length && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) v = v * 8 + (b[this.pos++] - 0x30);
              out.push(v & 0xff);
            } else out.push(c);
        }
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else if (c === 0x0d) {
        if (b[this.pos] === 0x0a) this.pos++;
        out.push(0x0a);
      } else out.push(c);
    }
    return { t: "str", v: Uint8Array.from(out) };
  }

  private hexString(): Operand {
    const b = this.bytes;
    this.pos++; // <
    const out: number[] = [];
    let digit = -1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x3e) break;
      const h = hexVal(c);
      if (h < 0) continue;
      if (digit < 0) digit = h;
      else {
        out.push(digit * 16 + h);
        digit = -1;
      }
    }
    if (digit >= 0) out.push(digit * 16);
    return { t: "str", v: Uint8Array.from(out) };
  }

  private array(): Operand {
    const items: Operand[] = [];
    while (this.pos < this.bytes.length) {
      this.skipSpace();
      if (this.bytes[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const tok = this.next();
      if (!tok) break;
      if (tok.t === "op") continue; // operators do not belong in arrays; readers drop them
      items.push(tok);
    }
    return { t: "arr", v: items };
  }

  private dict(): Operand {
    const map = new Map<string, Operand>();
    while (this.pos < this.bytes.length) {
      this.skipSpace();
      if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const key = this.next();
      if (!key) break;
      if (key.t !== "name") continue;
      const val = this.next();
      if (!val || val.t === "op") break;
      map.set(key.v, val);
    }
    return { t: "dict", v: map };
  }
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

export function latin1(b: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Tokenise a content stream into operations with byte spans. Inline images become one `BI` operation. */
export function tokenizeContent(bytes: Uint8Array): ContentOp[] {
  const lx = new Lexer(bytes);
  const ops: ContentOp[] = [];
  let args: Operand[] = [];
  let argStart = -1;
  for (;;) {
    lx.skipSpace();
    const tokStart = lx.pos;
    const tok = lx.next();
    if (!tok) break;
    if (tok.t !== "op") {
      if (argStart < 0) argStart = tokStart;
      args.push(tok);
      if (args.length > 64) {
        // Runaway operands (a broken stream): keep the last few, the way readers do.
        args = args.slice(-32);
      }
      continue;
    }
    if (tok.v === "BI") {
      const end = skipInlineImage(bytes, lx.pos, (dict) => (args = [dict]));
      ops.push({ op: "BI", args, start: tokStart, end });
      lx.pos = end;
      args = [];
      argStart = -1;
      continue;
    }
    ops.push({ op: tok.v, args, start: argStart < 0 ? tokStart : argStart, end: lx.pos });
    args = [];
    argStart = -1;
  }
  return ops;
}

/** From just after `BI`, past the image's `EI`. The dictionary is handed to `onDict`. */
function skipInlineImage(bytes: Uint8Array, pos: number, onDict: (d: Operand) => void): number {
  const lx = new Lexer(bytes);
  lx.pos = pos;
  const dict = new Map<string, Operand>();
  for (;;) {
    const key = lx.next();
    if (!key) return bytes.length;
    if (key.t === "op" && key.v === "ID") break;
    if (key.t !== "name") continue;
    const val = lx.next();
    if (!val) return bytes.length;
    if (val.t === "op") {
      if (val.v === "ID") break;
      continue;
    }
    dict.set(key.v, val);
  }
  onDict({ t: "dict", v: dict });
  let p = lx.pos;
  if (p < bytes.length && WS.has(bytes[p])) p++;
  const num = (k1: string, k2: string): number | null => {
    const v = dict.get(k1) ?? dict.get(k2);
    return v?.t === "num" ? v.v : null;
  };
  const filters = dict.get("F") ?? dict.get("Filter");
  const unfiltered = !filters || (filters.t === "arr" && filters.v.length === 0);
  if (unfiltered) {
    const w = num("W", "Width"), h = num("H", "Height");
    const im = dict.get("IM") ?? dict.get("ImageMask");
    const mask = im?.t === "bool" && im.v;
    const bpc = mask ? 1 : (num("BPC", "BitsPerComponent") ?? 8);
    const cs = dict.get("CS") ?? dict.get("ColorSpace");
    let comps = 1;
    if (cs?.t === "name") comps = cs.v === "RGB" || cs.v === "DeviceRGB" || cs.v === "CalRGB" ? 3 : cs.v === "CMYK" || cs.v === "DeviceCMYK" ? 4 : 1;
    else if (cs?.t === "arr") comps = 1;
    if (w !== null && h !== null && w > 0 && h > 0) {
      const len = Math.ceil((w * bpc * comps) / 8) * h;
      const after = p + len;
      const ei = findEI(bytes, after, after + 32);
      if (ei >= 0) return ei;
    }
  }
  const ei = findEI(bytes, p, bytes.length);
  return ei >= 0 ? ei : bytes.length;
}

/** The offset just past an `EI` that sits between whitespace (and looks like the end of the data), or -1. */
function findEI(bytes: Uint8Array, from: number, to: number): number {
  const end = Math.min(to, bytes.length);
  for (let i = Math.max(from, 1); i + 1 < end + 1 && i + 1 < bytes.length + 1; i++) {
    if (bytes[i] !== 0x45 || bytes[i + 1] !== 0x49) continue;
    if (!WS.has(bytes[i - 1])) continue;
    if (i + 2 < bytes.length && !WS.has(bytes[i + 2])) continue;
    // What follows should read like content, not image data.
    let ok = true;
    for (let k = i + 2; k < Math.min(bytes.length, i + 24); k++) {
      const c = bytes[k];
      if (c > 0x7e || (c < 0x20 && !WS.has(c))) {
        ok = false;
        break;
      }
    }
    if (ok) return i + 2;
  }
  return -1;
}

/* ------------------------------------------------------------ writing */

/** A PDF literal string for bytes, escaping what must be escaped. */
export function literalString(bytes: Uint8Array): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b === 0x0d) s += "\\r";
    else if (b === 0x0a) s += "\\n";
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

export function hexString(bytes: Uint8Array): string {
  let s = "<";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s + ">";
}

/** A number the way content streams want it: no exponent, few decimals. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10000) / 10000);
}

/** The bytes with the given spans replaced (spans must not overlap). */
export function spliceBytes(bytes: Uint8Array, edits: { start: number; end: number; text: string }[]): Uint8Array {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let pos = 0;
  const enc = new TextEncoder();
  for (const e of sorted) {
    if (e.start < pos) continue;
    parts.push(bytes.subarray(pos, e.start));
    parts.push(enc.encode(e.text));
    pos = e.end;
  }
  parts.push(bytes.subarray(pos));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Joins content streams the way readers do: with a line break between them. */
export function joinStreams(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 0x0a;
  }
  return out;
}

/* ------------------------------------------------------------- matrices */

/** [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The matrix that applies `first`, then `then`. */
export function compose(first: Matrix, then: Matrix): Matrix {
  return [
    first[0] * then[0] + first[1] * then[2],
    first[0] * then[1] + first[1] * then[3],
    first[2] * then[0] + first[3] * then[2],
    first[2] * then[1] + first[3] * then[3],
    first[4] * then[0] + first[5] * then[2] + then[4],
    first[4] * then[1] + first[5] * then[3] + then[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

/** Axis-aligned bounds of a rectangle after a transform. */
export function transformedBounds(m: Matrix, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const pts = [applyMatrix(m, x0, y0), applyMatrix(m, x1, y0), applyMatrix(m, x0, y1), applyMatrix(m, x1, y1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
