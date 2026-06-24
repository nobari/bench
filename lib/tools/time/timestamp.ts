/** Timestamp parsing & formatting for the Unix time converter. */

export interface TimeBreakdown {
  unixSec: number;
  unixMs: number;
  iso: string;
  utc: string;
  local: string;
  relative: string;
}

/** Parse epoch seconds/ms or any Date-parseable string into a Date (or null). */
export function parseTime(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;

  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // Heuristic: >= 1e12 is milliseconds, otherwise seconds.
    const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}

export function relativeTime(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [31536000000, "year"],
    [2592000000, "month"],
    [604800000, "week"],
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
    [1000, "second"],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const v = Math.round(abs / ms);
      const plural = v === 1 ? name : `${name}s`;
      return diff >= 0 ? `in ${v} ${plural}` : `${v} ${plural} ago`;
    }
  }
  return "just now";
}

export function breakdown(d: Date, now: number): TimeBreakdown {
  const ms = d.getTime();
  return {
    unixSec: Math.floor(ms / 1000),
    unixMs: ms,
    iso: d.toISOString(),
    utc: d.toUTCString(),
    local: d.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }),
    relative: relativeTime(ms, now),
  };
}
