/**
 * Page ranges as people type them — "1-3, 5, 8-" — against a page count. Pages are 1-based in and out, duplicates
 * are dropped and the order typed is kept; "all", "odd", "even" and "last" are understood, "-3" means from the
 * first page and "8-" to the last.
 */

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

export function parsePageRanges(text: string, count: number): RangeResult {
  const pages: number[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (!seen.has(n)) {
      seen.add(n);
      pages.push(n);
    }
  };
  const t = text.trim().toLowerCase();
  if (!t) return { ok: false, error: "Type the pages, like 1-3, 5, 8-" };
  if (count < 1) return { ok: false, error: "The document has no pages" };
  for (const raw of t.split(/[,\s;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "all") {
      for (let i = 1; i <= count; i++) add(i);
      continue;
    }
    if (part === "odd" || part === "even") {
      for (let i = part === "odd" ? 1 : 2; i <= count; i += 2) add(i);
      continue;
    }
    if (part === "last") {
      add(count);
      continue;
    }
    const m = /^(\d*)(?:(-)(\d*))?$/.exec(part);
    if (!m || (m[1] === "" && !m[3])) return { ok: false, error: `“${raw}” is not a page or a range` };
    const a = m[1] === "" ? 1 : Number(m[1]);
    const b = !m[2] ? a : m[3] ? Number(m[3]) : count;
    if (a < 1 || b < 1 || a > count || b > count) return { ok: false, error: `${raw} is outside 1–${count}` };
    if (a <= b) for (let i = a; i <= b; i++) add(i);
    else for (let i = a; i >= b; i--) add(i);
  }
  if (!pages.length) return { ok: false, error: "No pages" };
  return { ok: true, pages };
}

/** "1-3, 5, 8-10" for a set of 1-based pages, sorted. */
export function formatPageRanges(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j > i + 1) out.push(`${sorted[i]}-${sorted[j]}`);
    else if (j === i + 1) out.push(`${sorted[i]}, ${sorted[j]}`);
    else out.push(`${sorted[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** Pages 1…count in runs of `size`; the last run may be shorter. */
export function chunkPages(count: number, size: number): number[][] {
  const n = Math.max(1, Math.floor(size));
  const out: number[][] = [];
  for (let start = 1; start <= count; start += n) {
    const run: number[] = [];
    for (let p = start; p < start + n && p <= count; p++) run.push(p);
    out.push(run);
  }
  return out;
}

/**
 * Runs that start at the given pages (1-based, in any order, duplicates ignored); pages before the first start form
 * a run of their own, so every page lands in exactly one run.
 */
export function chunksFrom(count: number, starts: Iterable<number>): number[][] {
  const points = [...new Set([...starts].filter((p) => p >= 1 && p <= count))].sort((a, b) => a - b);
  if (!points.length) return count ? [chunkPages(count, count)[0]] : [];
  if (points[0] !== 1) points.unshift(1);
  const out: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const end = i + 1 < points.length ? points[i + 1] - 1 : count;
    const run: number[] = [];
    for (let p = points[i]; p <= end; p++) run.push(p);
    out.push(run);
  }
  return out;
}

/** A run of pages as a file-name suffix: "p3" or "p3-7". */
export function runLabel(run: number[]): string {
  if (!run.length) return "";
  const a = run[0], b = run[run.length - 1];
  return a === b ? `p${a}` : `p${a}-${b}`;
}
