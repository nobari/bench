/**
 * URL shortener — the pure, client-safe half. Validation, code derivation and
 * the eviction policy live here so they are unit-testable and shared by the
 * widget and the server module (`lib/server/shortlinks.ts`), which is the only
 * place that talks to Vercel Blob.
 *
 * Storage policy: links live in one private Blob store, capped well inside
 * Vercel's free allowance. When the cap is hit, entries are evicted FIFO
 * weighted by size — the score is bytes × age, so an old large link goes
 * before a young small one. No link is guaranteed to live forever.
 */

/** Longest destination URL accepted (characters). */
export const MAX_URL_LENGTH = 10_000;
/** Short code length range; codes are a base62 prefix of the URL's SHA-256. */
export const MIN_CODE_LENGTH = 7;
export const MAX_CODE_LENGTH = 12;
export const CODE_RE = /^[0-9A-Za-z]{6,16}$/;
/** Blob pathname prefix so the store can host other things later. */
export const STORE_PREFIX = "s/";
/** Default store cap: 500 MB — half of the Hobby-plan Blob storage allowance. */
export const DEFAULT_MAX_STORE_BYTES = 500 * 1024 * 1024;
/** Evict down to this fraction of the cap so eviction runs in batches. */
export const EVICT_TARGET_RATIO = 0.9;

export type Validation = { ok: true; value: string } | { ok: false; error: string };

/** Accept http(s) URLs only; returns the trimmed URL as typed (no normalisation). */
export function validateLongUrl(raw: string): Validation {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Paste a URL to shorten." };
  if (value.length > MAX_URL_LENGTH)
    return {
      ok: false,
      error: `That's ${value.length.toLocaleString()} characters — the limit is ${MAX_URL_LENGTH.toLocaleString()}.`,
    };
  if (/\s/.test(value)) return { ok: false, error: "URLs can't contain spaces or line breaks." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "That doesn't look like a full URL — include https://." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "Only http:// and https:// links can be shortened." };
  if (!url.hostname) return { ok: false, error: "The URL needs a host name." };
  return { ok: true, value };
}

export function pathFor(code: string): string {
  return STORE_PREFIX + code;
}

export function shortUrlFor(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/s/${code}`;
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Big-endian bytes → base62 string. */
export function base62(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  if (n === 0n) return "0";
  let out = "";
  while (n > 0n) {
    out = B62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

/**
 * Candidate codes for a URL, shortest first. The same URL always maps to the
 * same first candidate, so re-shortening is idempotent; longer candidates are
 * only used if a shorter one is already taken by a different URL.
 */
export function codeCandidates(hashB62: string): string[] {
  const out: string[] = [];
  for (let len = MIN_CODE_LENGTH; len <= MAX_CODE_LENGTH && len <= hashB62.length; len++)
    out.push(hashB62.slice(0, len));
  return out;
}

export interface StoredLink {
  pathname: string;
  size: number;
  uploadedAt: Date;
}

export interface EvictionPlan {
  totalBytes: number;
  evict: StoredLink[];
  /** Bytes remaining after eviction. */
  afterBytes: number;
}

/**
 * FIFO weighted by size: rank by bytes × age (byte-seconds) and drop the
 * highest-ranked entries until the store is back under the target.
 */
export function planEviction(links: StoredLink[], capBytes: number, now = Date.now()): EvictionPlan {
  const totalBytes = links.reduce((n, l) => n + l.size, 0);
  if (totalBytes <= capBytes) return { totalBytes, evict: [], afterBytes: totalBytes };
  const target = capBytes * EVICT_TARGET_RATIO;
  const ranked = [...links].sort((a, b) => score(b, now) - score(a, now));
  const evict: StoredLink[] = [];
  let remaining = totalBytes;
  for (const l of ranked) {
    if (remaining <= target) break;
    evict.push(l);
    remaining -= l.size;
  }
  return { totalBytes, evict, afterBytes: remaining };
}

function score(l: StoredLink, now: number): number {
  const ageSec = Math.max(1, (now - l.uploadedAt.getTime()) / 1000);
  return l.size * ageSec;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Shape returned by POST /api/shorten. */
export interface ShortenResponse {
  code: string;
  shortUrl: string;
  /** True when this URL had already been shortened — same code returned. */
  reused: boolean;
  store?: StoreStats;
}

export interface StoreStats {
  links: number;
  bytes: number;
  capBytes: number;
}
