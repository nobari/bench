/**
 * URL shortener storage — the only module that talks to Vercel Blob. Import
 * from route handlers only (never from widgets).
 *
 * One private blob per link: pathname `s/<code>`, body = the destination URL.
 * Codes are a base62 prefix of the URL's SHA-256, so shortening the same URL
 * twice returns the same link. Store size is tracked per instance and a full
 * `list()` scan (the expensive operation) runs only every SCAN_EVERY writes or
 * when the estimate crosses the cap; eviction is FIFO weighted by size.
 */

import { BlobNotFoundError, del, get, list, put } from "@vercel/blob";
import {
  CODE_RE,
  DEFAULT_MAX_STORE_BYTES,
  STORE_PREFIX,
  base62,
  codeCandidates,
  pathFor,
  planEviction,
  type StoreStats,
  type StoredLink,
} from "@/lib/tools/web/shortlink";

const SCAN_EVERY = 20;
const DEL_CHUNK = 100;

let stats: StoreStats | null = null;
let writesSinceScan = 0;

export function storageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function storeCap(): number {
  const n = Number(process.env.SHORTLINK_MAX_STORE_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_STORE_BYTES;
}

async function readLink(code: string, useCache: boolean): Promise<string | null> {
  try {
    const res = await get(pathFor(code), { access: "private", useCache });
    if (!res || res.statusCode !== 200) return null;
    return await new Response(res.stream).text();
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

/** Destination for a code, or null when unknown / evicted. */
export async function resolveShortLink(code: string): Promise<string | null> {
  if (!CODE_RE.test(code)) return null;
  return readLink(code, true);
}

export async function createShortLink(url: string): Promise<{ code: string; reused: boolean }> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  for (const code of codeCandidates(base62(digest))) {
    const existing = await readLink(code, false);
    if (existing === url) return { code, reused: true };
    if (existing !== null) continue; // taken by a different URL (prefix collision)
    try {
      await put(pathFor(code), url, {
        access: "private",
        addRandomSuffix: false,
        contentType: "text/plain; charset=utf-8",
      });
      if (stats) {
        stats.bytes += url.length;
        stats.links += 1;
      }
      writesSinceScan++;
      return { code, reused: false };
    } catch (e) {
      // Lost a race: something wrote this pathname between our read and write.
      const now = await readLink(code, false);
      if (now === url) return { code, reused: true };
      if (now === null) throw e;
    }
  }
  throw new Error("Could not allocate a short code.");
}

async function scan(): Promise<StoredLink[]> {
  const out: StoredLink[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: STORE_PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) out.push({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * Keep the store under its cap. Cheap unless a scan is due; returns the
 * current (estimated) stats either way.
 */
export async function maintainStore(force = false): Promise<StoreStats> {
  const capBytes = storeCap();
  const due = force || !stats || writesSinceScan >= SCAN_EVERY || stats.bytes > capBytes;
  if (!due) return stats as StoreStats;

  const links = await scan();
  const plan = planEviction(links, capBytes);
  for (let i = 0; i < plan.evict.length; i += DEL_CHUNK)
    await del(plan.evict.slice(i, i + DEL_CHUNK).map((l) => l.pathname));

  stats = { links: links.length - plan.evict.length, bytes: plan.afterBytes, capBytes };
  writesSinceScan = 0;
  return stats;
}
