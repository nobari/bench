import { keccak256 } from "js-sha3";
import { romajiToKana, kanaToRomaji } from "./romaji";
import { finglishToPersian } from "./finglish";

/**
 * Text transform engine. Each transform is a pure `string -> string` function so
 * results are deterministic and fully shareable via the URL. Grouped for the
 * picker UI; individually addressable via `?t=<id>` on the text tool.
 */

export type TransformGroup =
  | "encode"
  | "case"
  | "width"
  | "lines"
  | "address"
  | "fun"
  | "script";

export interface Transform {
  id: string;
  label: string;
  group: TransformGroup;
  summary: string;
  fn: (input: string) => string;
  /** id of the reverse transform, if any (powers the swap button). */
  inverse?: string;
}

export const GROUP_LABELS: Record<TransformGroup, string> = {
  encode: "Encoding",
  case: "Case",
  width: "Width",
  lines: "Lines & Whitespace",
  address: "Addresses & Checksums",
  fun: "Ciphers & Fun",
  script: "Scripts & Transliteration",
};

/* ------------------------------------------------------------------ helpers */

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8ToBase64(str: string): string {
  let bin = "";
  for (const b of enc.encode(str)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToUtf8(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

const HTML_NAMED: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..", "0": "-----",
  "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....",
  "6": "-....", "7": "--...", "8": "---..", "9": "----.", ".": ".-.-.-",
  ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.",
  "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...", ";": "-.-.-.",
  "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-", '"': ".-..-.",
  $: "...-..-", "@": ".--.-.",
};
const MORSE_REV: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([k, v]) => [v, k]),
);

// Hankaku (half-width) katakana <-> Zenkaku (full-width) katakana.
const KATA_H2Z: Record<string, string> = {
  "｡": "。", "｢": "「", "｣": "」", "､": "、", "･": "・", "ｦ": "ヲ", "ｧ": "ァ",
  "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ", "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ",
  "ｯ": "ッ", "ｰ": "ー", "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
  "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ", "ｻ": "サ", "ｼ": "シ",
  "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ", "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ",
  "ﾄ": "ト", "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ", "ﾊ": "ハ",
  "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ", "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム",
  "ﾒ": "メ", "ﾓ": "モ", "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ", "ﾗ": "ラ", "ﾘ": "リ",
  "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ", "ﾜ": "ワ", "ﾝ": "ン", "ﾞ": "゛", "ﾟ": "゜",
};
const KATA_Z2H: Record<string, string> = Object.fromEntries(
  Object.entries(KATA_H2Z).map(([h, z]) => [z, h]),
);

/* --------------------------------------------------------------- transforms */

export const TRANSFORMS: Transform[] = [
  // ---- Encoding ----
  { id: "base64-encode", label: "Base64 Encode", group: "encode", summary: "Text → Base64", fn: utf8ToBase64, inverse: "base64-decode" },
  { id: "base64-decode", label: "Base64 Decode", group: "encode", summary: "Base64 → Text", fn: base64ToUtf8, inverse: "base64-encode" },
  { id: "base64url-encode", label: "Base64URL Encode", group: "encode", summary: "URL-safe Base64", fn: (s) => utf8ToBase64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), inverse: "base64url-decode" },
  { id: "base64url-decode", label: "Base64URL Decode", group: "encode", summary: "URL-safe Base64 → Text", fn: (s) => base64ToUtf8(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), inverse: "base64url-encode" },
  { id: "url-encode", label: "URL Encode", group: "encode", summary: "Percent-encode for URLs", fn: (s) => encodeURIComponent(s), inverse: "url-decode" },
  { id: "url-decode", label: "URL Decode", group: "encode", summary: "Decode percent-encoding", fn: (s) => decodeURIComponent(s.replace(/\+/g, " ")), inverse: "url-encode" },
  { id: "html-encode", label: "HTML Entity Encode", group: "encode", summary: "Escape &, <, >, \" and '", fn: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"), inverse: "html-decode" },
  { id: "html-decode", label: "HTML Entity Decode", group: "encode", summary: "Unescape HTML entities", fn: (s) => s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&[a-zA-Z]+;|&#39;/g, (m) => HTML_NAMED[m] ?? m), inverse: "html-encode" },
  { id: "hex-encode", label: "Hex Encode", group: "encode", summary: "UTF-8 bytes → hex", fn: (s) => [...enc.encode(s)].map((b) => b.toString(16).padStart(2, "0")).join(""), inverse: "hex-decode" },
  { id: "hex-decode", label: "Hex Decode", group: "encode", summary: "Hex → UTF-8 text", fn: (s) => { const h = s.replace(/[^0-9a-fA-F]/g, ""); const bytes = new Uint8Array(h.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16); return dec.decode(bytes); }, inverse: "hex-encode" },
  { id: "binary-encode", label: "Binary Encode", group: "encode", summary: "Text → 8-bit binary", fn: (s) => [...enc.encode(s)].map((b) => b.toString(2).padStart(8, "0")).join(" "), inverse: "binary-decode" },
  { id: "binary-decode", label: "Binary Decode", group: "encode", summary: "Binary → text", fn: (s) => { const bits = s.replace(/[^01]/g, ""); const bytes = new Uint8Array(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.substr(i * 8, 8), 2); return dec.decode(bytes); }, inverse: "binary-encode" },
  { id: "unicode-escape", label: "Unicode Escape", group: "encode", summary: "Non-ASCII → \\uXXXX", fn: (s) => s.replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")), inverse: "unicode-unescape" },
  { id: "unicode-unescape", label: "Unicode Unescape", group: "encode", summary: "\\uXXXX → characters", fn: (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), inverse: "unicode-escape" },
  { id: "json-escape", label: "JSON String Escape", group: "encode", summary: "Escape & quote as JSON string", fn: (s) => JSON.stringify(s), inverse: "json-unescape" },
  { id: "json-unescape", label: "JSON String Unescape", group: "encode", summary: "Parse a JSON string literal", fn: (s) => { const t = s.trim(); return JSON.parse(t.startsWith('"') ? t : `"${t}"`); }, inverse: "json-escape" },

  // ---- Case ----
  { id: "uppercase", label: "UPPERCASE", group: "case", summary: "Convert to upper case", fn: (s) => s.toUpperCase(), inverse: "lowercase" },
  { id: "lowercase", label: "lowercase", group: "case", summary: "Convert to lower case", fn: (s) => s.toLowerCase(), inverse: "uppercase" },
  { id: "title-case", label: "Title Case", group: "case", summary: "Capitalize Each Word", fn: (s) => s.replace(/\w\S*/g, cap) },
  { id: "sentence-case", label: "Sentence case", group: "case", summary: "Capitalize first letter of sentences", fn: (s) => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase()) },
  { id: "camel-case", label: "camelCase", group: "case", summary: "Join words, lower first", fn: (s) => words(s).map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join("") },
  { id: "pascal-case", label: "PascalCase", group: "case", summary: "Join words, capitalize each", fn: (s) => words(s).map(cap).join("") },
  { id: "snake-case", label: "snake_case", group: "case", summary: "lower_words_with_underscores", fn: (s) => words(s).join("_").toLowerCase() },
  { id: "kebab-case", label: "kebab-case", group: "case", summary: "lower-words-with-dashes", fn: (s) => words(s).join("-").toLowerCase() },
  { id: "constant-case", label: "CONSTANT_CASE", group: "case", summary: "UPPER_WORDS_WITH_UNDERSCORES", fn: (s) => words(s).join("_").toUpperCase() },
  { id: "dot-case", label: "dot.case", group: "case", summary: "lower.words.with.dots", fn: (s) => words(s).join(".").toLowerCase() },
  { id: "toggle-case", label: "tOGGLE cASE", group: "case", summary: "Invert the case of each letter", fn: (s) => s.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())) },
  { id: "alternating-case", label: "aLtErNaTiNg", group: "case", summary: "Alternate upper/lower", fn: (s) => { let i = 0; return s.replace(/[a-z]/gi, (c) => (i++ % 2 ? c.toUpperCase() : c.toLowerCase())); } },

  // ---- Width ----
  { id: "to-fullwidth", label: "Half-width → Full-width", group: "width", summary: "ASCII → 全角 (zenkaku)", fn: (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, "　").replace(/[｡-ﾟ]/g, (c) => KATA_H2Z[c] ?? c), inverse: "to-halfwidth" },
  { id: "to-halfwidth", label: "Full-width → Half-width", group: "width", summary: "全角 (zenkaku) → ASCII", fn: (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ").replace(/[、。「」、・ァ-ー]/g, (c) => KATA_Z2H[c] ?? c), inverse: "to-fullwidth" },
  { id: "hiragana-to-katakana", label: "Hiragana → Katakana", group: "script", summary: "ひらがな → カタカナ", fn: (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)), inverse: "katakana-to-hiragana" },
  { id: "katakana-to-hiragana", label: "Katakana → Hiragana", group: "script", summary: "カタカナ → ひらがな", fn: (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)), inverse: "hiragana-to-katakana" },
  { id: "romaji-to-hiragana", label: "Romaji → Hiragana", group: "script", summary: "konnichiwa → こんにちは", fn: (s) => romajiToKana(s, "hiragana"), inverse: "kana-to-romaji" },
  { id: "romaji-to-katakana", label: "Romaji → Katakana", group: "script", summary: "ko-hi- → コーヒー", fn: (s) => romajiToKana(s, "katakana"), inverse: "kana-to-romaji" },
  { id: "kana-to-romaji", label: "Kana → Romaji (Hepburn)", group: "script", summary: "とうきょう → tōkyō", fn: (s) => kanaToRomaji(s, "hepburn"), inverse: "romaji-to-hiragana" },
  { id: "finglish-to-persian", label: "Finglish → Persian", group: "script", summary: "salam → سلام", fn: (s) => finglishToPersian(s) },

  // ---- Lines & Whitespace ----
  { id: "trim-lines", label: "Trim Lines", group: "lines", summary: "Strip leading/trailing spaces per line", fn: (s) => s.split("\n").map((l) => l.trim()).join("\n") },
  { id: "collapse-spaces", label: "Collapse Whitespace", group: "lines", summary: "Squeeze runs of spaces to one", fn: (s) => s.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n") },
  { id: "remove-line-breaks", label: "Remove Line Breaks", group: "lines", summary: "Join all lines with a space", fn: (s) => s.replace(/\s*\n\s*/g, " ").trim() },
  { id: "remove-empty-lines", label: "Remove Empty Lines", group: "lines", summary: "Drop blank lines", fn: (s) => s.split("\n").filter((l) => l.trim() !== "").join("\n") },
  { id: "sort-lines", label: "Sort Lines (A→Z)", group: "lines", summary: "Alphabetical sort", fn: (s) => s.split("\n").sort((a, b) => a.localeCompare(b)).join("\n") },
  { id: "sort-lines-desc", label: "Sort Lines (Z→A)", group: "lines", summary: "Reverse alphabetical sort", fn: (s) => s.split("\n").sort((a, b) => b.localeCompare(a)).join("\n") },
  { id: "reverse-lines", label: "Reverse Lines", group: "lines", summary: "Flip line order", fn: (s) => s.split("\n").reverse().join("\n") },
  { id: "dedupe-lines", label: "Deduplicate Lines", group: "lines", summary: "Remove repeated lines", fn: (s) => [...new Set(s.split("\n"))].join("\n") },
  { id: "number-lines", label: "Number Lines", group: "lines", summary: "Prefix each line with its index", fn: (s) => s.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") },
  { id: "slugify", label: "Slugify", group: "lines", summary: "URL-friendly slug", fn: (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") },

  // ---- Addresses & Checksums ----
  { id: "eip55-checksum", label: "Ethereum Address Checksum (EIP-55)", group: "address", summary: "Apply EIP-55 mixed-case checksum", fn: (s) => { const a = s.trim().toLowerCase().replace(/^0x/, ""); if (!/^[0-9a-f]{40}$/.test(a)) throw new Error("Enter a 40-character hex address (with or without 0x)."); const h = keccak256(a); let out = "0x"; for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i]; return out; } },
  { id: "address-lowercase", label: "Address → lowercase", group: "address", summary: "Normalize an address to lowercase", fn: (s) => s.trim().toLowerCase() },
  { id: "keccak256", label: "Keccak-256 Hash", group: "address", summary: "Keccak-256 of the input (hex)", fn: (s) => "0x" + keccak256(s) },

  // ---- Ciphers & Fun ----
  { id: "reverse", label: "Reverse Text", group: "fun", summary: "Reverse character order", fn: (s) => [...s].reverse().join(""), inverse: "reverse" },
  { id: "rot13", label: "ROT13", group: "fun", summary: "Rotate letters by 13", fn: (s) => s.replace(/[a-z]/gi, (c) => { const base = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base); }), inverse: "rot13" },
  { id: "rot47", label: "ROT47", group: "fun", summary: "Rotate printable ASCII by 47", fn: (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(33 + ((c.charCodeAt(0) - 33 + 47) % 94))), inverse: "rot47" },
  { id: "morse-encode", label: "Morse Encode", group: "fun", summary: "Text → Morse code", fn: (s) => s.toUpperCase().split("").map((c) => (c === " " ? "/" : MORSE[c] ?? "")).filter(Boolean).join(" "), inverse: "morse-decode" },
  { id: "morse-decode", label: "Morse Decode", group: "fun", summary: "Morse code → text", fn: (s) => s.trim().split(/\s+/).map((t) => (t === "/" ? " " : MORSE_REV[t] ?? "")).join(""), inverse: "morse-encode" },
];

const BY_ID = new Map(TRANSFORMS.map((t) => [t.id, t]));

export function getTransform(id: string): Transform | undefined {
  return BY_ID.get(id);
}

/** Run a transform, returning `{ ok, value }` so the UI can show errors inline. */
export function runTransform(
  id: string,
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const t = BY_ID.get(id);
  if (!t) return { ok: false, error: `Unknown transform: ${id}` };
  if (input === "") return { ok: true, value: "" };
  try {
    return { ok: true, value: t.fn(input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Transform failed" };
  }
}

/** Quick text statistics for the readout bar. */
export function textStats(s: string) {
  const chars = [...s].length;
  const words = s.trim() ? s.trim().split(/\s+/).length : 0;
  const lines = s === "" ? 0 : s.split("\n").length;
  const bytes = enc.encode(s).length;
  return { chars, words, lines, bytes };
}
