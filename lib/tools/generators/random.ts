/**
 * Random generators — integers, decimals, strings, bytes, dice, coins.
 * All cryptographically random (Web Crypto), unbiased via rejection sampling.
 * SSR-safe: crypto is only referenced inside exported functions.
 */

/** Unbiased integer in [0, max) using rejection sampling over 32-bit words. */
function randUint32Below(max: number): number {
  if (max <= 0) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x = 0;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/** Inclusive integer in [min, max]. */
export function randInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + randUint32Below(hi - lo + 1);
}

/** Float in [0, 1) with 53 bits of entropy. */
function randFloat(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 26 bits from hi + 27 bits from lo → 53-bit mantissa
  return (buf[0] >>> 6) * 2 ** 27 + (buf[1] >>> 5);
}

const FLOAT_DENOM = 2 ** 53;

export function generateIntegers(
  min: number,
  max: number,
  count: number,
  unique: boolean,
): number[] {
  const n = Math.max(1, Math.floor(count));
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  const span = hi - lo + 1;

  if (unique) {
    const take = Math.min(n, span);
    // Partial Fisher–Yates over a sparse map — no full array for huge ranges.
    const swapped = new Map<number, number>();
    const at = (i: number) => swapped.get(i) ?? lo + i;
    const out: number[] = [];
    for (let i = 0; i < take; i++) {
      const j = i + randUint32Below(span - i);
      out.push(at(j));
      swapped.set(j, at(i));
    }
    return out;
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + randUint32Below(span));
  return out;
}

export function generateDecimals(
  min: number,
  max: number,
  places: number,
  count: number,
): string[] {
  const n = Math.max(1, Math.floor(count));
  const p = Math.max(0, Math.min(10, Math.floor(places)));
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = lo + (randFloat() / FLOAT_DENOM) * (hi - lo);
    out.push(v.toFixed(p));
  }
  return out;
}

export type Charset = "alphanumeric" | "hex" | "letters" | "digits";

const CHARSETS: Record<Charset, string> = {
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  hex: "0123456789abcdef",
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
};

export function generateStrings(
  length: number,
  charset: Charset,
  count: number,
): string[] {
  const n = Math.max(1, Math.floor(count));
  const len = Math.max(1, Math.floor(length));
  const pool = CHARSETS[charset];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let s = "";
    for (let j = 0; j < len; j++) s += pool[randUint32Below(pool.length)];
    out.push(s);
  }
  return out;
}

export interface BytesResult {
  hex: string;
  base64: string;
}

export function generateBytes(n: number): BytesResult {
  const len = Math.max(1, Math.min(4096, Math.floor(n)));
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let hex = "";
  let bin = "";
  for (let i = 0; i < len; i++) {
    hex += buf[i].toString(16).padStart(2, "0");
    bin += String.fromCharCode(buf[i]);
  }
  const base64 =
    typeof btoa === "function" ? btoa(bin) : bufferToBase64(buf);
  return { hex, base64 };
}

/** Fallback base64 (no btoa, e.g. SSR) — not used in the browser path. */
function bufferToBase64(buf: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < buf.length; i += 3) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const b2 = buf[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < buf.length ? chars[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "=";
    out += i + 2 < buf.length ? chars[b2 & 63] : "=";
  }
  return out;
}

export interface DiceResult {
  rolls: number[];
  sum: number;
  notation: string;
}

export function rollDice(count: number, sides: number): DiceResult {
  const c = Math.max(1, Math.min(100, Math.floor(count)));
  const s = Math.max(2, Math.min(1000, Math.floor(sides)));
  const rolls: number[] = [];
  let sum = 0;
  for (let i = 0; i < c; i++) {
    const r = 1 + randUint32Below(s);
    rolls.push(r);
    sum += r;
  }
  return { rolls, sum, notation: `${c}d${s}` };
}

export interface CoinResult {
  flips: ("H" | "T")[];
  heads: number;
  tails: number;
}

export function flipCoins(count: number): CoinResult {
  const c = Math.max(1, Math.min(1000, Math.floor(count)));
  const flips: ("H" | "T")[] = [];
  let heads = 0;
  for (let i = 0; i < c; i++) {
    const h = randUint32Below(2) === 0;
    flips.push(h ? "H" : "T");
    if (h) heads++;
  }
  return { flips, heads, tails: c - heads };
}
