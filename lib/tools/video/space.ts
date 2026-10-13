/**
 * Free space, as the browser reports it. The web platform has no disk API; navigator.storage.estimate() gives the
 * space the browser would still let this site store, which Chrome bounds by the disk's free space (less a reserve
 * of about 1 % of the disk), so it is a conservative lower bound of what is free. An override exists for tests.
 */
export const LOW_SPACE = 2e9;
export const ENOUGH_SPACE = 3e9;

let override: number | null = null;
export function overrideFreeSpace(bytes: number | null) {
  override = bytes;
}

export async function estimateFree(): Promise<number | null> {
  if (override !== null) return override;
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    if (e.quota === undefined) return null;
    return Math.max(0, e.quota - (e.usage ?? 0));
  } catch {
    return null;
  }
}

/** True when an error from a write most likely means the disk is full. */
export function isSpaceError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = String((e as { message?: string } | null)?.message ?? "").toLowerCase();
  return name === "QuotaExceededError" || name === "NotAllowedError" || /quota|space|disk|enospc/.test(msg);
}
