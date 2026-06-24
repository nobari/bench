/**
 * Number-base conversion for the Base Converter.
 *
 * Pure & deterministic — given the same inputs it always returns the same
 * result, which is what makes results shareable via the URL. SSR-safe: no
 * `window`/`document`/`Date`/`Math.random` at module scope or in the functions.
 *
 * Works on arbitrarily large non-negative integers via `BigInt`, so there is no
 * 2^53 precision ceiling.
 */

/** Digits used for bases 2–36 (0-9 then a-z), index = digit value. */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** A base is valid for parsing/formatting when it is an integer in [2, 36]. */
export function isValidBase(base: number): boolean {
  return Number.isInteger(base) && base >= 2 && base <= 36;
}

/** Map a single character to its digit value, or -1 if it is not a digit. */
function digitValue(ch: string): number {
  const code = ch.charCodeAt(0);
  // 0-9
  if (code >= 48 && code <= 57) return code - 48;
  // a-z
  if (code >= 97 && code <= 122) return code - 97 + 10;
  // A-Z
  if (code >= 65 && code <= 90) return code - 65 + 10;
  return -1;
}

export type ParseResult =
  | { ok: true; value: bigint }
  | { ok: false; error: string };

/**
 * Parse a non-negative integer string written in `base` into a `BigInt`.
 *
 * Accepts surrounding whitespace, an optional leading `+`, and digit grouping
 * with spaces or underscores (e.g. `"1010 0110"`, `"FF_FF"`). Every remaining
 * character must be a valid digit strictly less than `base`. Negative numbers
 * are rejected (this tool handles non-negative integers only).
 */
export function parseInBase(input: string, base: number): ParseResult {
  if (!isValidBase(base)) {
    return { ok: false, error: `Base must be an integer between 2 and 36.` };
  }

  let s = input.trim();
  if (s.startsWith("+")) s = s.slice(1);
  // Allow grouping separators for readability.
  s = s.replace(/[\s_]/g, "");

  if (s === "") return { ok: false, error: "Enter a value." };
  if (s.startsWith("-")) {
    return { ok: false, error: "Only non-negative integers are supported." };
  }

  const bigBase = BigInt(base);
  let value = 0n;

  for (const ch of s) {
    const d = digitValue(ch);
    if (d < 0 || d >= base) {
      return {
        ok: false,
        error: `"${ch}" is not a valid digit in base ${base}.`,
      };
    }
    value = value * bigBase + BigInt(d);
  }

  return { ok: true, value };
}

/**
 * Format a non-negative `BigInt` in the given base (2–36).
 *
 * Letters are lowercase; callers that want uppercase (e.g. hex) should
 * `.toUpperCase()` the result.
 */
export function formatInBase(value: bigint, base: number): string {
  if (!isValidBase(base)) return "";
  if (value < 0n) return "";
  if (value === 0n) return "0";

  const bigBase = BigInt(base);
  let n = value;
  let out = "";
  while (n > 0n) {
    const rem = Number(n % bigBase);
    out = DIGITS[rem] + out;
    n /= bigBase;
  }
  return out;
}

/**
 * Group a binary string into nibbles of `size` (default 4), right-aligned, for
 * readability — e.g. `"110100110"` → `"1 1010 0110"`.
 */
export function groupBits(binary: string, size = 4): string {
  if (!binary) return binary;
  const groups: string[] = [];
  let i = binary.length;
  while (i > 0) {
    const start = Math.max(0, i - size);
    groups.unshift(binary.slice(start, i));
    i = start;
  }
  return groups.join(" ");
}
