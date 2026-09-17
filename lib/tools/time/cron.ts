/**
 * Cron expressions: parsing, plain-English descriptions, next run times in
 * any IANA timezone (DST-safe), and a builder model that round-trips.
 *
 * Standard 5-field cron (minute hour day-of-month month day-of-week) plus an
 * optional leading seconds field, the @aliases, names (JAN–DEC, SUN–SAT),
 * ranges, lists and steps. As in POSIX cron, when both day-of-month and
 * day-of-week are restricted, a day matches when EITHER does.
 */

export interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

export const FIELD_SPECS: FieldSpec[] = [
  { name: "second", min: 0, max: 59 },
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  { name: "day of week", min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
];

export const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/** Largest distinct value: day of week accepts 7 for Sunday but it duplicates 0. */
export const effectiveMax = (spec: FieldSpec) => (spec.name === "day of week" ? 6 : spec.max);
/** Sensible "every n" default per field. */
const defaultStep = (spec: FieldSpec) => (spec.max === 59 ? 5 : spec.max === 23 ? 6 : 2);

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ParsedField {
  text: string;
  /** Allowed values (day of week normalised to 0–6). */
  values: number[];
  /** True when the field is unrestricted (`*`). */
  any: boolean;
  spec: FieldSpec;
}

export interface ParsedCron {
  ok: true;
  expression: string;
  hasSeconds: boolean;
  /** In order: [second?], minute, hour, dom, month, dow. */
  fields: ParsedField[];
  alias?: string;
}

export interface CronError {
  ok: false;
  error: string;
  /** Index of the offending field, when known. */
  field?: number;
}

function nameToNumber(token: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  if (spec.names) {
    const i = spec.names.indexOf(token.toUpperCase());
    if (i >= 0) return spec.min + i;
  }
  return null;
}

function parseField(text: string, spec: FieldSpec): { values: number[]; any: boolean } | string {
  const set = new Set<number>();
  let any = false;
  for (const part of text.split(",")) {
    if (part === "") return `empty item in "${text}"`;
    const m = part.match(/^([^/]+)(?:\/(\d+))?$/);
    if (!m) return `can't read "${part}"`;
    const [, rangeText, stepText] = m;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return `step must be at least 1 in "${part}"`;
    let lo: number, hi: number;
    if (rangeText === "*") {
      lo = spec.min;
      hi = spec.max;
      if (step === 1) any = true;
    } else {
      const r = rangeText.split("-");
      if (r.length > 2) return `can't read "${part}"`;
      const a = nameToNumber(r[0], spec);
      if (a === null) return `"${r[0]}" isn't a valid ${spec.name}`;
      if (r.length === 2) {
        const b = nameToNumber(r[1], spec);
        if (b === null) return `"${r[1]}" isn't a valid ${spec.name}`;
        lo = a;
        hi = b;
        if (lo > hi) return `range "${part}" runs backwards`;
      } else {
        lo = a;
        hi = stepText === undefined ? a : spec.max;
      }
    }
    if (lo < spec.min || hi > spec.max) return `"${part}" is outside ${spec.min}–${spec.max} for ${spec.name}`;
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  // Day of week: 7 means Sunday too.
  const values = [...set].map((v) => (spec.name === "day of week" && v === 7 ? 0 : v));
  return { values: [...new Set(values)].sort((a, b) => a - b), any: any && text.split(",").length === 1 };
}

export function parseCron(input: string): ParsedCron | CronError {
  let expression = input.trim().replace(/\s+/g, " ");
  if (!expression) return { ok: false, error: "empty" };
  let alias: string | undefined;
  const lower = expression.toLowerCase();
  if (lower === "@reboot") return { ok: false, error: "@reboot runs once at startup — it has no schedule to show." };
  if (ALIASES[lower]) {
    alias = lower;
    expression = ALIASES[lower];
  }
  const parts = expression.split(" ");
  if (parts.length !== 5 && parts.length !== 6)
    return { ok: false, error: `Expected 5 fields (minute hour day month weekday) or 6 with seconds, got ${parts.length}.` };
  const hasSeconds = parts.length === 6;
  const specs = hasSeconds ? FIELD_SPECS : FIELD_SPECS.slice(1);
  const fields: ParsedField[] = [];
  for (let i = 0; i < parts.length; i++) {
    const r = parseField(parts[i], specs[i]);
    if (typeof r === "string") return { ok: false, error: `${capitalize(specs[i].name)}: ${r}.`, field: i };
    fields.push({ text: parts[i], values: r.values, any: r.any, spec: specs[i] });
  }
  return { ok: true, expression, hasSeconds, fields, alias };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------ description */

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "*", "*​/n", "a-b", "a-b/n", "a", "a,b,c" → phrase; null for "*". */
function describeField(f: ParsedField, unit: string, plural: string, nameOf?: (v: number) => string): string | null {
  const t = f.text;
  const label = (v: number) => (nameOf ? nameOf(v) : String(v));
  if (t === "*") return null;
  const step = t.match(/^\*\/(\d+)$/);
  if (step) return `every ${ordinal(Number(step[1]))} ${unit}`;
  const rangeStep = t.match(/^([^,/]+)-([^,/]+)\/(\d+)$/);
  if (rangeStep) {
    const a = nameToNumber(rangeStep[1], f.spec)!, b = nameToNumber(rangeStep[2], f.spec)!;
    return `every ${ordinal(Number(rangeStep[3]))} ${unit} from ${label(a)} through ${label(b)}`;
  }
  const startStep = t.match(/^(\d+)\/(\d+)$/);
  if (startStep) return `every ${ordinal(Number(startStep[2]))} ${unit} from ${label(Number(startStep[1]))} through ${label(effectiveMax(f.spec))}`;
  let ranged = false;
  const parts = t.split(",").map((p) => {
    const r = p.split("-");
    if (r.length === 2) {
      ranged = true;
      return `${label(nameToNumber(r[0], f.spec)!)} through ${label(nameToNumber(r[1], f.spec)!)}`;
    }
    return label(nameToNumber(p, f.spec)!);
  });
  return `${parts.length > 1 || ranged ? plural : unit} ${list(parts)}`;
}

/** "every 5th minute" → "every 5 minutes" for a leading phrase. */
const everyN = (s: string, unit: string) => s.replace(new RegExp(`^every (\\d+)(st|nd|rd|th) ${unit}$`), `every $1 ${unit}s`);

type Split = [ParsedField | null, ParsedField, ParsedField, ParsedField, ParsedField, ParsedField];
const splitFields = (p: ParsedCron): Split =>
  p.hasSeconds ? (p.fields as Split) : [null, ...(p.fields as [ParsedField, ParsedField, ParsedField, ParsedField, ParsedField])];

/** Plain-English description, e.g. "At 09:30 on Monday through Friday". */
export function describeCron(p: ParsedCron): string {
  const [sec, min, hour, dom, mon, dow] = splitFields(p);
  const single = (f: ParsedField | null) => f !== null && /^\d+$/.test(f.text);
  // A list or range that covers every value is the same as "*".
  const full = (f: ParsedField) => f.values.length === effectiveMax(f.spec) - f.spec.min + 1;
  const fieldOrNull = (f: ParsedField, unit: string, plural: string, nameOf?: (v: number) => string) => (full(f) ? null : describeField(f, unit, plural, nameOf));

  // Seconds only matter when present and not the plain "0".
  const secPhrase = sec && sec.text !== "0" ? (full(sec) ? "every second" : everyN(describeField(sec, "second", "seconds")!, "second")) : null;
  const m = fieldOrNull(min, "minute", "minutes");
  const h = fieldOrNull(hour, "hour", "hours");
  const atOrEvery = (s: string) => (s.startsWith("every") ? s : `at ${s}`);
  const past = (s: string) => `past ${s}`;

  let time: string;
  if (single(min) && single(hour)) {
    const clock = `${pad(Number(hour.text))}:${pad(Number(min.text))}`;
    if (sec && single(sec) && sec.text !== "0") time = `At ${clock}:${pad(Number(sec.text))}`;
    else if (secPhrase) time = `${capitalize(secPhrase)} during ${clock}`;
    else time = `At ${clock}`;
  } else if (secPhrase) {
    time = capitalize(atOrEvery(secPhrase));
    if (m) time += secPhrase.startsWith("every") ? `, ${atOrEvery(m)}` : ` ${past(m)}`;
    if (h) time += secPhrase.startsWith("every") && !m ? `, ${past(h)}` : ` ${past(h)}`;
  } else if (single(min) && !hour.any && hour.text.split(",").every((x) => /^\d+$/.test(x))) {
    time = `At ${list(hour.text.split(",").map((x) => `${pad(Number(x))}:${pad(Number(min.text))}`))}`;
  } else if (!m && !h) {
    time = "Every minute";
  } else if (!h) {
    time = capitalize(atOrEvery(everyN(m!, "minute")));
  } else if (!m) {
    time = `Every minute ${past(h)}`;
  } else if (min.text === "0" && hour.text.startsWith("*/")) {
    time = capitalize(everyN(h, "hour"));
  } else {
    time = `${capitalize(atOrEvery(m))} ${past(h)}`;
  }

  const parts = [time];
  const domText = fieldOrNull(dom, "day", "days")?.replace(/^(every \S+ day)$/, "$1 of the month").replace(/^(days?) (.+)$/, "$1 $2 of the month");
  const dowText = fieldOrNull(dow, "day", "days", (v) => DAY_NAMES[v === 7 ? 0 : v])?.replace(/^days? /, "");
  const monText = fieldOrNull(mon, "month", "months", (v) => MONTH_NAMES[v - 1])?.replace(/^months? /, "");
  if (domText && dowText) parts.push(`on ${domText} or on ${dowText}`);
  else if (domText) parts.push(`on ${domText}`);
  else if (dowText) parts.push(`on ${dowText}`);
  if (monText) parts.push(monText.startsWith("every") ? monText : `in ${monText}`);
  return parts.join(" ");
}

/* --------------------------------------------------------------- schedule */

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function partsIn(date: Date, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WD.indexOf(out.weekday),
  };
}

/** Wall-clock time in `tz` → instant. Returns null for times that don't exist (DST gap). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date | null {
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), tz);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (got === wanted) return new Date(guess);
    guess += wanted - got;
  }
  const p = partsIn(new Date(guess), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wanted ? new Date(guess) : null;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The next `count` run instants strictly after `from`, evaluated in `tz`. Searches up to ~8 years. */
export function nextRuns(p: ParsedCron, from: Date, count: number, tz: string): Date[] {
  const [sec, min, hour, dom, mon, dow] = splitFields(p);
  const seconds = sec ? sec.values : [0];
  const runs: Date[] = [];
  const start = partsIn(from, tz);
  const monthSet = new Set(mon.values), domSet = new Set(dom.values), dowSet = new Set(dow.values);
  const dayOk = (d: Parts) => {
    if (!monthSet.has(d.month)) return false;
    const domMatch = domSet.has(d.day), dowMatch = dowSet.has(d.weekday);
    if (dom.any && dow.any) return true;
    if (dom.any) return dowMatch;
    if (dow.any) return domMatch;
    return domMatch || dowMatch;
  };
  const fromMs = from.getTime();
  // Walk days as UTC dates (year/month/day only); each is checked in the target zone.
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const limit = cursor + 8 * 366 * 86400000;
  while (cursor <= limit && runs.length < count) {
    const cd = new Date(cursor);
    const y = cd.getUTCFullYear(), m = cd.getUTCMonth() + 1, d = cd.getUTCDate();
    // Weekday of this calendar date (zone-independent for a calendar day).
    const weekday = cd.getUTCDay();
    if (dayOk({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0, weekday })) {
      for (const h of hour.values) {
        for (const mi of min.values) {
          for (const s of seconds) {
            const t = zonedToUtc(y, m, d, h, mi, s, tz);
            if (!t || t.getTime() <= fromMs) continue;
            runs.push(t);
            if (runs.length >= count) return runs;
          }
        }
      }
    }
    cursor += 86400000;
  }
  return runs;
}

/* ------------------------------------------------------------------ builder */

export type FieldMode = "every" | "specific" | "step" | "range";

export interface BuilderField {
  mode: FieldMode;
  /** Chosen values for `specific`. */
  values: number[];
  /** Step and its start for `step`; from/to for `range`. */
  step: number;
  start: number;
  from: number;
  to: number;
}

export interface BuilderState {
  seconds: boolean;
  fields: BuilderField[]; // [second], minute, hour, dom, month, dow
}

export function defaultBuilder(seconds = false): BuilderState {
  const specs = seconds ? FIELD_SPECS : FIELD_SPECS.slice(1);
  return {
    seconds,
    fields: specs.map((s, i) => ({
      mode: i < (seconds ? 2 : 1) ? "specific" : "every",
      values: [s.min],
      step: defaultStep(s),
      start: s.min,
      from: s.min,
      to: effectiveMax(s),
    })),
  };
}

export function fieldToText(f: BuilderField, spec: FieldSpec): string {
  switch (f.mode) {
    case "every":
      return "*";
    case "specific":
      return (f.values.length ? [...f.values].sort((a, b) => a - b) : [spec.min]).join(",");
    case "step":
      return f.start === spec.min ? `*/${f.step}` : `${f.start}/${f.step}`;
    case "range":
      return f.from === f.to ? String(f.from) : `${Math.min(f.from, f.to)}-${Math.max(f.from, f.to)}`;
  }
}

export function buildExpression(b: BuilderState): string {
  const specs = b.seconds ? FIELD_SPECS : FIELD_SPECS.slice(1);
  return b.fields.map((f, i) => fieldToText(f, specs[i])).join(" ");
}

/** Best-effort mapping of a parsed expression into builder fields (lists/ranges/steps become their modes). */
export function builderFromParsed(p: ParsedCron): BuilderState {
  const fields = p.fields.map((f): BuilderField => {
    const spec = f.spec;
    const base: BuilderField = { mode: "specific", values: f.values, step: defaultStep(spec), start: spec.min, from: spec.min, to: effectiveMax(spec) };
    if (f.text === "*") return { ...base, mode: "every" };
    const step = f.text.match(/^(\*|\d+)\/(\d+)$/);
    if (step) return { ...base, mode: "step", step: Number(step[2]), start: step[1] === "*" ? spec.min : Number(step[1]) };
    const range = f.text.match(/^([^,/-]+)-([^,/-]+)$/);
    if (range) {
      const a = nameToNumber(range[1], spec), b = nameToNumber(range[2], spec);
      if (a !== null && b !== null) return { ...base, mode: "range", from: a, to: b };
    }
    return base;
  });
  return { seconds: p.hasSeconds, fields };
}

export const PRESETS: { label: string; expression: string }[] = [
  { label: "Every minute", expression: "* * * * *" },
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at midnight", expression: "0 0 * * *" },
  { label: "Daily at 09:00", expression: "0 9 * * *" },
  { label: "Weekdays at 09:00", expression: "0 9 * * 1-5" },
  { label: "Mondays at 08:00", expression: "0 8 * * 1" },
  { label: "First day of the month", expression: "0 0 1 * *" },
  { label: "Days 28–31 (month-end check)", expression: "0 0 28-31 * *" },
  { label: "Quarterly on the 1st", expression: "0 0 1 1,4,7,10 *" },
  { label: "Yearly on 1 January", expression: "0 0 1 1 *" },
  { label: "Every 30 seconds (6 fields)", expression: "*/30 * * * * *" },
];

/** Human relative time, e.g. "in 2 h 5 min". */
export function relative(target: Date, now: number): string {
  const diff = target.getTime() - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 864e5, "y"], [30 * 864e5, "mo"], [7 * 864e5, "w"], [864e5, "d"], [36e5, "h"], [6e4, "min"], [1e3, "s"],
  ];
  const out: string[] = [];
  let rest = abs;
  for (const [ms, label] of units) {
    if (rest >= ms && out.length < 2) {
      const n = Math.floor(rest / ms);
      out.push(`${n} ${label}`);
      rest -= n * ms;
    }
  }
  if (!out.length) return "now";
  return diff >= 0 ? `in ${out.join(" ")}` : `${out.join(" ")} ago`;
}
