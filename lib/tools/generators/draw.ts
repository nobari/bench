/**
 * Lucky-draw helpers — cryptographic Fisher–Yates shuffle + winner selection.
 * SSR-safe: crypto is only referenced inside exported functions.
 */

/** Unbiased integer in [0, max) via rejection sampling over 32-bit words. */
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

/** Parse a textarea into trimmed, non-empty entries (one per line). */
export function parseEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Cryptographic Fisher–Yates shuffle — returns a new array, input untouched. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randUint32Below(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick `count` winners from `entries`.
 * - withoutReplacement: distinct winners (capped at entries.length).
 * - else: independent draws, repeats allowed.
 */
export function pickWinners(
  entries: readonly string[],
  count: number,
  withoutReplacement: boolean,
): string[] {
  const n = entries.length;
  if (n === 0) return [];
  const want = Math.max(1, Math.floor(count));

  if (withoutReplacement) {
    return shuffle(entries).slice(0, Math.min(want, n));
  }
  const out: string[] = [];
  for (let i = 0; i < want; i++) out.push(entries[randUint32Below(n)]);
  return out;
}

/** A single random entry — used by the reveal/scramble animation. */
export function randomEntry(entries: readonly string[]): string {
  if (entries.length === 0) return "";
  return entries[randUint32Below(entries.length)];
}

/**
 * Split entries into `teamCount` groups as evenly and randomly as possible.
 * Entries are shuffled, then dealt round-robin so sizes differ by at most one.
 * Returns an array of teams (each a string[]); empty teams are kept so the
 * caller always gets exactly `teamCount` groups (unless teamCount <= 0).
 */
export function splitTeams(
  entries: readonly string[],
  teamCount: number,
): string[][] {
  const groups = Math.max(1, Math.floor(teamCount));
  const teams: string[][] = Array.from({ length: groups }, () => []);
  const shuffled = shuffle(entries);
  shuffled.forEach((entry, i) => {
    teams[i % groups].push(entry);
  });
  return teams;
}

/** De-duplicate entries (case-sensitive), preserving first-seen order. */
export function dedupeEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}
