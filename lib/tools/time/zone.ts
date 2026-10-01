/**
 * Wall-clock helpers for a display zone: either a real IANA zone (with DST)
 * or a fixed offset — used for places with no known zone, where the offset is
 * taken from the longitude (the "nautical" time zone).
 */

import { partsIn, zonedToUtc } from "@/lib/tools/time/cron";

export type Zone = { kind: "iana"; tz: string } | { kind: "fixed"; offsetMin: number };

export interface ZParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export const DAY_MS = 86400000;
export const UTC_ZONE: Zone = { kind: "fixed", offsetMin: 0 };
export const longitudeZone = (lon: number): Zone => ({ kind: "fixed", offsetMin: Math.round(lon / 15) * 60 });

export function zoneParts(ms: number, zone: Zone): ZParts {
  if (zone.kind === "iana") return partsIn(new Date(ms), zone.tz);
  const d = new Date(ms + zone.offsetMin * 60000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay() };
}

/** Wall-clock time in the zone → epoch ms. Day/hour overflow is normalised; a DST gap rolls forward an hour. */
export function zoneToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: Zone): number {
  if (zone.kind === "fixed") return Date.UTC(y, mo - 1, d, h, mi, s) - zone.offsetMin * 60000;
  const n = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const a = [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), n.getUTCHours(), n.getUTCMinutes(), n.getUTCSeconds()] as const;
  const t = zonedToUtc(a[0], a[1], a[2], a[3], a[4], a[5], zone.tz) ?? zonedToUtc(a[0], a[1], a[2], a[3] + 1, a[4], a[5], zone.tz);
  return (t ?? n).getTime();
}

export function zoneOffsetMin(ms: number, zone: Zone): number {
  if (zone.kind === "fixed") return zone.offsetMin;
  const p = partsIn(new Date(ms), zone.tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

function offsetLabel(min: number): string {
  if (min === 0) return "UTC";
  const a = Math.abs(min);
  return `UTC${min > 0 ? "+" : "−"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

export function zoneName(ms: number, zone: Zone): string {
  return offsetLabel(zoneOffsetMin(ms, zone));
}

export const dayOfYear = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
export const daysInYear = (y: number) => Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS);

const pad = (n: number) => String(n).padStart(2, "0");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtClock(ms: number | null, zone: Zone, seconds = false): string {
  if (ms === null) return "—";
  const p = zoneParts(ms, zone);
  return `${pad(p.hour)}:${pad(p.minute)}${seconds ? `:${pad(p.second)}` : ""}`;
}

export function fmtDay(ms: number, zone: Zone, withYear = true): string {
  const p = zoneParts(ms, zone);
  return `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ""}`;
}

export function fmtDateTime(ms: number, zone: Zone): string {
  const p = zoneParts(ms, zone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

export function fmtSpan(msSpan: number): string {
  const m = Math.round(Math.abs(msSpan) / 60000);
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}
