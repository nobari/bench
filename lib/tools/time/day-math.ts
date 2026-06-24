/** Date arithmetic for the Day Calculator (between / add-subtract / age). */

export type DayMode = "between" | "add" | "age";
export type AddUnit = "days" | "weeks" | "months" | "years";

export interface Duration {
  years: number;
  months: number;
  days: number;
}

export interface BetweenResult {
  totalDays: number;
  weeksDays: { weeks: number; days: number };
  months: number;
  ymd: Duration;
  businessDays: number;
  forward: boolean;
}

export interface AgeResult {
  ymd: Duration;
  totalDays: number;
  nextBirthdayDays: number;
  nextBirthdayDate: string;
}

const MS_PER_DAY = 86400000;

/** Parse a yyyy-mm-dd (or any Date-parseable) string into a Date or null. */
export function parseDay(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  // Anchor bare ISO dates to local midnight so day math is stable.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}

/** Whole calendar days between two dates (sign reflects direction a→b). */
export function diffDays(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / MS_PER_DAY);
}

/** Y/M/D breakdown between two ordered dates (lo <= hi). */
export function durationBetween(lo: Date, hi: Date): Duration {
  let years = hi.getFullYear() - lo.getFullYear();
  let months = hi.getMonth() - lo.getMonth();
  let days = hi.getDate() - lo.getDate();

  if (days < 0) {
    months -= 1;
    // Days in the month preceding hi.
    const prevMonth = new Date(hi.getFullYear(), hi.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Inclusive-exclusive count of weekdays (Mon–Fri) between two dates. */
export function businessDaysBetween(a: Date, b: Date): number {
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  let count = 0;
  const cur = new Date(lo.getFullYear(), lo.getMonth(), lo.getDate());
  const end = new Date(hi.getFullYear(), hi.getMonth(), hi.getDate());
  while (cur < end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function computeBetween(a: Date, b: Date): BetweenResult {
  const signed = diffDays(a, b);
  const forward = signed >= 0;
  const total = Math.abs(signed);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const wholeMonths = (hi.getFullYear() - lo.getFullYear()) * 12 + (hi.getMonth() - lo.getMonth()) -
    (hi.getDate() < lo.getDate() ? 1 : 0);
  return {
    totalDays: total,
    weeksDays: { weeks: Math.floor(total / 7), days: total % 7 },
    months: wholeMonths,
    ymd: durationBetween(lo, hi),
    businessDays: businessDaysBetween(a, b),
    forward,
  };
}

/** Add a signed amount of a unit to a date, returning a new Date. */
export function addToDate(d: Date, amount: number, unit: AddUnit): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (unit) {
    case "days":
      r.setDate(r.getDate() + amount);
      break;
    case "weeks":
      r.setDate(r.getDate() + amount * 7);
      break;
    case "months":
      r.setMonth(r.getMonth() + amount);
      break;
    case "years":
      r.setFullYear(r.getFullYear() + amount);
      break;
  }
  return r;
}

export function computeAge(birth: Date, now: Date): AgeResult {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ymd = durationBetween(birth, today);
  const totalDays = diffDays(birth, today);

  // Next birthday at or after today.
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  const nextBirthdayDays = diffDays(today, next);

  return {
    ymd,
    totalDays,
    nextBirthdayDays,
    nextBirthdayDate: next.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

/** yyyy-mm-dd in local time (for <input type="date"> and ISO display). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function humanDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
