/**
 * Date parsing plus multi-format, multi-calendar and multi-timezone rendering
 * for the Date Converter. Intl formatters are cached so live updates stay cheap.
 */

export interface Row {
  label: string;
  value: string;
}

/* ----------------------------------------------------------- formatter cache */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + "|" + JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    fmtCache.set(key, f);
  }
  return f;
}

/* ----------------------------------------------------------------- parsing */

export function parseDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const ms = Math.abs(n) >= 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = Date.parse(s);
  return isNaN(parsed) ? null : new Date(parsed);
}

/* --------------------------------------------------------------- helpers */

const pad = (n: number) => String(n).padStart(2, "0");

export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

export function isoWeek(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function relativeTime(target: number, now: number): string {
  const diff = target - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [31536000000, "year"], [2592000000, "month"], [604800000, "week"],
    [86400000, "day"], [3600000, "hour"], [60000, "minute"], [1000, "second"],
  ];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const v = Math.round(abs / ms);
      return diff >= 0 ? `in ${v} ${name}${v === 1 ? "" : "s"}` : `${v} ${name}${v === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

function localISO(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const ah = Math.floor(Math.abs(off) / 60), am = Math.abs(off) % 60;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(ah)}:${pad(am)}`;
}

const ZODIAC: [string, number, number][] = [
  ["Capricorn ♑", 1, 19], ["Aquarius ♒", 2, 18], ["Pisces ♓", 3, 20],
  ["Aries ♈", 4, 19], ["Taurus ♉", 5, 20], ["Gemini ♊", 6, 20],
  ["Cancer ♋", 7, 22], ["Leo ♌", 8, 22], ["Virgo ♍", 9, 22],
  ["Libra ♎", 10, 22], ["Scorpio ♏", 11, 21], ["Sagittarius ♐", 12, 21],
];
function zodiac(d: Date): string {
  const m = d.getMonth() + 1, day = d.getDate();
  for (const [sign, mm, dd] of ZODIAC) if (m < mm || (m === mm && day <= dd)) return sign;
  return "Capricorn ♑";
}

const ANIMALS = ["Rat", "Ox", "Tiger", "Rabbit", "Dragon", "Snake", "Horse", "Goat", "Monkey", "Rooster", "Dog", "Pig"];
const chineseAnimal = (y: number) => ANIMALS[((y - 4) % 12 + 12) % 12];

function season(d: Date): string {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 320 && md < 621) return "Spring";
  if (md >= 621 && md < 923) return "Summer";
  if (md >= 923 && md < 1221) return "Autumn";
  return "Winter";
}

/* ---------------------------------------------------------- standard formats */

export function standardFormats(d: Date, now: number): Row[] {
  const ms = d.getTime();
  const { week, year } = isoWeek(d);
  const jd = ms / 86400000 + 2440587.5;
  const jp = japaneseYears(d);
  return [
    { label: "ISO 8601 (UTC)", value: d.toISOString() },
    { label: "ISO 8601 (local)", value: localISO(d) },
    { label: "RFC 2822", value: d.toUTCString() },
    { label: "Unix seconds", value: String(Math.floor(ms / 1000)) },
    { label: "Unix milliseconds", value: String(ms) },
    { label: "US", value: fmt("en-US", { dateStyle: "long", timeStyle: "medium" }).format(d) },
    { label: "European", value: fmt("en-GB", { dateStyle: "long", timeStyle: "medium" }).format(d) },
    { label: "Day of week", value: fmt("en-US", { weekday: "long" }).format(d) },
    { label: "Day of year", value: `${dayOfYear(d)} / ${isLeap(d.getFullYear()) ? 366 : 365}` },
    { label: "ISO week", value: `${year}-W${pad(week)}` },
    { label: "Quarter", value: `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}` },
    { label: "Days in month", value: String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) },
    { label: "Leap year", value: isLeap(d.getFullYear()) ? "Yes" : "No" },
    { label: "Julian Date", value: jd.toFixed(5) },
    { label: "Modified Julian", value: (jd - 2400000.5).toFixed(5) },
    { label: "Japanese era", value: jp.era },
    { label: "Imperial year", value: jp.koki },
    { label: "Zodiac", value: zodiac(d) },
    { label: "Chinese zodiac", value: `${chineseAnimal(d.getFullYear())} (≈)` },
    { label: "Season (N.)", value: season(d) },
    { label: "Relative", value: relativeTime(ms, now) },
  ];
}

/* ---------------------------------------------------------------- calendars */

export interface CalendarDef {
  key: string;
  name: string;
  note: string;
  /** Locale to render this calendar in (defaults to "en"). */
  locale?: string;
}

export const CALENDARS: CalendarDef[] = [
  { key: "gregory", name: "Gregorian", note: "Civil standard" },
  { key: "islamic-umalqura", name: "Hijri — Umm al-Qura", note: "Saudi official" },
  { key: "islamic-civil", name: "Hijri — Civil", note: "Tabular" },
  { key: "persian", name: "Persian (Solar Hijri)", note: "Iran / Afghanistan" },
  { key: "hebrew", name: "Hebrew", note: "Jewish" },
  { key: "indian", name: "Indian National", note: "Śaka era" },
  { key: "buddhist", name: "Buddhist", note: "Thai" },
  { key: "japanese", name: "Japanese (和暦)", note: "Imperial era · 令和", locale: "ja-JP" },
  { key: "chinese", name: "Chinese", note: "Lunisolar" },
  { key: "coptic", name: "Coptic", note: "Egyptian Christian" },
  { key: "ethiopic", name: "Ethiopic", note: "Ge'ez" },
  { key: "roc", name: "Minguo (ROC)", note: "Taiwan" },
];

/** Render the date in every supported calendar system (local time). */
export function calendarRows(d: Date): (Row & { note: string })[] {
  return CALENDARS.map((c) => {
    let value: string;
    try {
      value = fmt(`${c.locale ?? "en"}-u-ca-${c.key}`, { dateStyle: "long" }).format(d);
    } catch {
      value = "—";
    }
    return { label: c.name, value, note: c.note };
  });
}

/** Japanese era (wareki) breakdown + Imperial (Kōki) year. */
export function japaneseYears(d: Date): { era: string; full: string; koki: string } {
  try {
    const jp = fmt("ja-JP-u-ca-japanese", { era: "long", year: "numeric" }).formatToParts(d);
    const en = fmt("en-u-ca-japanese", { era: "long", year: "numeric" }).formatToParts(d);
    const eraJa = jp.find((p) => p.type === "era")?.value ?? "";
    const yearJa = jp.find((p) => p.type === "year")?.value ?? "";
    const eraEn = en.find((p) => p.type === "era")?.value ?? "";
    const yearEn = en.find((p) => p.type === "year")?.value ?? "";
    return {
      era: `${eraJa}${yearJa}年 · ${eraEn} ${yearEn}`,
      full: fmt("ja-JP-u-ca-japanese", { dateStyle: "long" }).format(d),
      koki: `皇紀 ${d.getFullYear() + 660}`,
    };
  } catch {
    return { era: "—", full: "—", koki: "—" };
  }
}

/* ---------------------------------------------------------------- timezones */

export const MAJOR_ZONES: { zone: string; label: string }[] = [
  { zone: "UTC", label: "UTC" },
  { zone: "America/Los_Angeles", label: "Los Angeles" },
  { zone: "America/New_York", label: "New York" },
  { zone: "America/Sao_Paulo", label: "São Paulo" },
  { zone: "Europe/London", label: "London" },
  { zone: "Europe/Paris", label: "Paris" },
  { zone: "Africa/Cairo", label: "Cairo" },
  { zone: "Asia/Dubai", label: "Dubai" },
  { zone: "Asia/Kolkata", label: "Kolkata" },
  { zone: "Asia/Shanghai", label: "Shanghai" },
  { zone: "Asia/Tokyo", label: "Tokyo" },
  { zone: "Australia/Sydney", label: "Sydney" },
];

export function allTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return MAJOR_ZONES.map((z) => z.zone);
  }
}

export function zoneTime(d: Date, zone: string): string {
  return fmt("en-GB", { timeZone: zone, dateStyle: "medium", timeStyle: "medium" }).format(d);
}

export function zoneOffset(d: Date, zone: string): string {
  const parts = fmt("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(d);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
