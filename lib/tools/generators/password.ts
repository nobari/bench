/**
 * Password & passphrase generators — cryptographically random (Web Crypto),
 * unbiased rejection sampling. SSR-safe: no browser globals at module scope;
 * crypto is only touched inside the exported functions (called in the browser).
 */

/** ~120 common short English words for passphrase (Diceware-style) mode. */
export const WORDS = [
  "able", "acid", "aged", "also", "area", "army", "away", "baby", "back", "ball",
  "band", "bank", "base", "bath", "bear", "beat", "been", "beer", "bell", "belt",
  "bird", "blue", "boat", "body", "bone", "book", "boot", "born", "boss", "both",
  "bowl", "bulk", "burn", "bush", "busy", "cake", "call", "calm", "came", "camp",
  "card", "care", "cash", "cell", "chip", "city", "club", "coal", "coat", "code",
  "cold", "come", "cook", "cool", "cord", "core", "corn", "cost", "crew", "crop",
  "dark", "data", "date", "dawn", "days", "dead", "deal", "dean", "dear", "debt",
  "deck", "deep", "deer", "desk", "dial", "dirt", "dish", "dock", "does", "done",
  "door", "dose", "down", "draw", "drew", "drop", "drum", "dual", "duck", "dust",
  "duty", "each", "earn", "ease", "east", "easy", "edge", "else", "even", "ever",
  "face", "fact", "fade", "fail", "fair", "fall", "farm", "fast", "fate", "fear",
  "feed", "feel", "fell", "file", "fill", "film", "find", "fine", "fire", "fish",
] as const;

/** Character pools used for the "characters" mode. */
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?";
/** Visually ambiguous glyphs, stripped when "exclude ambiguous" is on. */
const AMBIGUOUS = new Set("Il1O0`|".split(""));

export interface CharOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  appendNumber: boolean;
}

/** Cryptographically-strong unbiased integer in [0, max) via rejection sampling. */
function randInt(max: number): number {
  if (max <= 0) return 0;
  const range = 256 - (256 % max); // largest multiple of max ≤ 256
  const buf = new Uint8Array(1);
  let x = 0;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= range);
  return x % max;
}

/** Build the active character pool for the given options. */
export function buildPool(opts: CharOptions): string {
  let pool = "";
  if (opts.lower) pool += LOWER;
  if (opts.upper) pool += UPPER;
  if (opts.digits) pool += DIGITS;
  if (opts.symbols) pool += SYMBOLS;
  if (opts.excludeAmbiguous)
    pool = [...pool].filter((c) => !AMBIGUOUS.has(c)).join("");
  return pool;
}

export function generatePassword(opts: CharOptions): string {
  const pool = buildPool(opts);
  if (!pool) return "";
  const len = Math.max(1, Math.floor(opts.length));
  let out = "";
  for (let i = 0; i < len; i++) out += pool[randInt(pool.length)];
  return out;
}

export function generatePassphrase(opts: PassphraseOptions): string {
  const n = Math.max(1, Math.floor(opts.words));
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    let w: string = WORDS[randInt(WORDS.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  let phrase = parts.join(opts.separator);
  if (opts.appendNumber) phrase += opts.separator + randInt(100);
  return phrase;
}

export interface Strength {
  bits: number;
  label: "Weak" | "Fair" | "Strong" | "Excellent";
  /** 0..1 fill ratio for the strength bar. */
  ratio: number;
}

/** Entropy (bits) = length × log2(poolSize). */
export function charEntropy(opts: CharOptions): number {
  const pool = buildPool(opts);
  if (!pool) return 0;
  return Math.max(1, Math.floor(opts.length)) * Math.log2(pool.length);
}

/** Passphrase entropy = words × log2(dict) (+ ~6.6 bits if a 0–99 number is added). */
export function passphraseEntropy(opts: PassphraseOptions): number {
  const n = Math.max(1, Math.floor(opts.words));
  let bits = n * Math.log2(WORDS.length);
  if (opts.appendNumber) bits += Math.log2(100);
  return bits;
}

export function rateStrength(bits: number): Strength {
  let label: Strength["label"];
  if (bits < 40) label = "Weak";
  else if (bits < 64) label = "Fair";
  else if (bits < 96) label = "Strong";
  else label = "Excellent";
  const ratio = Math.max(0, Math.min(1, bits / 128));
  return { bits: Math.round(bits), label, ratio };
}
