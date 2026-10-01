/**
 * Sun, Moon and Earth geometry for the simulator, built on astronomy-engine:
 * sub-solar / sub-lunar points, topocentric positions, rise/set and twilight
 * events, phases, seasons, eclipses and the year's daylight curve.
 * All times are epoch milliseconds (UTC); time zones are the caller's business.
 */

import {
  Body,
  EclipticGeoMoon,
  Equator,
  EquatorFromVector,
  GeoVector,
  Horizon,
  Illumination,
  Libration,
  MoonPhase,
  NextMoonQuarter,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SearchAltitude,
  SearchGlobalSolarEclipse,
  SearchHourAngle,
  SearchLunarApsis,
  SearchLunarEclipse,
  SearchMoonQuarter,
  SearchRiseSet,
  Seasons,
  SiderealTime,
  SunPosition,
  type AstroTime,
} from "astronomy-engine";

const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const SUN_RADIUS_KM = 695700;
export const SYNODIC_MONTH = 29.530588;
export const DAY_MS = 86400000;

export const norm360 = (d: number) => ((d % 360) + 360) % 360;
export const norm180 = (d: number) => norm360(d + 180) - 180;

/** Geocentric apparent equatorial coordinates of date (RA hours, Dec degrees, distance AU). */
function geocentric(body: Body, date: Date) {
  return EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date), GeoVector(body, date, true)));
}

export interface SubPoint {
  lat: number;
  lon: number;
}

export interface SunState extends SubPoint {
  ra: number;
  dec: number;
  /** Geocentric ecliptic longitude of the Sun (0 = March equinox). */
  eclLon: number;
  distanceAu: number;
  distanceKm: number;
  diameterDeg: number;
  /** Apparent minus mean solar time, in minutes. */
  equationOfTimeMin: number;
}

export interface MoonState extends SubPoint {
  ra: number;
  dec: number;
  eclLon: number;
  /** Ecliptic elongation from the Sun: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  elongation: number;
  /** Illuminated fraction of the disk, 0–1. */
  fraction: number;
  waxing: boolean;
  phaseName: string;
  ageDays: number;
  distanceKm: number;
  diameterDeg: number;
}

export interface Sky {
  ms: number;
  /** Greenwich apparent sidereal time, hours. */
  gast: number;
  sun: SunState;
  moon: MoonState;
}

export function phaseName(elongation: number): string {
  const e = norm360(elongation);
  const near = (x: number) => Math.abs(norm180(e - x)) < 6;
  if (near(0)) return "New Moon";
  if (near(90)) return "First Quarter";
  if (near(180)) return "Full Moon";
  if (near(270)) return "Last Quarter";
  return e < 90 ? "Waxing Crescent" : e < 180 ? "Waxing Gibbous" : e < 270 ? "Waning Gibbous" : "Waning Crescent";
}

/** Where the Sun and Moon are for the whole Earth at an instant. */
export function skyAt(ms: number): Sky {
  const date = new Date(ms);
  const gast = SiderealTime(date);
  const s = geocentric(Body.Sun, date);
  const m = geocentric(Body.Moon, date);
  const sunLon = norm180((s.ra - gast) * 15);
  const utHours = (((ms / 3600000) % 24) + 24) % 24;
  // Greenwich apparent solar time = Sun's hour angle + 12 h; the equation of time is its lead over UT.
  let eot = (-sunLon / 15 + 12 - utHours) * 60;
  eot = ((((eot + 720) % 1440) + 1440) % 1440) - 720;
  const elongation = MoonPhase(date);
  const lib = Libration(date);
  return {
    ms,
    gast,
    sun: {
      ra: s.ra,
      dec: s.dec,
      lat: s.dec,
      lon: sunLon,
      eclLon: SunPosition(date).elon,
      distanceAu: s.dist,
      distanceKm: s.dist * AU_KM,
      diameterDeg: (2 * Math.asin(SUN_RADIUS_KM / (s.dist * AU_KM))) / DEG,
      equationOfTimeMin: eot,
    },
    moon: {
      ra: m.ra,
      dec: m.dec,
      lat: m.dec,
      lon: norm180((m.ra - gast) * 15),
      eclLon: EclipticGeoMoon(date).lon,
      elongation,
      fraction: Illumination(Body.Moon, date).phase_fraction,
      waxing: elongation < 180,
      phaseName: phaseName(elongation),
      ageDays: (elongation / 360) * SYNODIC_MONTH,
      distanceKm: lib.dist_km,
      diameterDeg: lib.diam_deg,
    },
  };
}

export type Light = "day" | "civil" | "nautical" | "astronomical" | "night";

export interface Local {
  sun: { alt: number; az: number };
  moon: {
    alt: number;
    az: number;
    /** Position angle of the bright limb, counter-clockwise from celestial north. */
    brightLimbNorth: number;
    /** The same, measured from the direction of the zenith — how the Moon looks to this observer. */
    brightLimbZenith: number;
  };
  light: Light;
  /** Shadow length of a 1 m vertical stick, or null when the Sun is down. */
  shadow: number | null;
}

export function lightFor(trueAltitude: number): Light {
  if (trueAltitude > -0.833) return "day";
  if (trueAltitude > -6) return "civil";
  if (trueAltitude > -12) return "nautical";
  if (trueAltitude > -18) return "astronomical";
  return "night";
}

/** Sun and Moon as seen from a place on the ground. */
export function localAt(ms: number, lat: number, lon: number): Local {
  const date = new Date(ms);
  const obs = new Observer(lat, lon, 0);
  const se = Equator(Body.Sun, date, obs, true, true);
  const sh = Horizon(date, obs, se.ra, se.dec, "normal");
  const sTrue = Horizon(date, obs, se.ra, se.dec);
  const me = Equator(Body.Moon, date, obs, true, true);
  const mh = Horizon(date, obs, me.ra, me.dec, "normal");
  const sd = se.dec * DEG, md = me.dec * DEG;
  const dRa = (se.ra - me.ra) * 15 * DEG;
  const chi = Math.atan2(Math.cos(sd) * Math.sin(dRa), Math.sin(sd) * Math.cos(md) - Math.cos(sd) * Math.sin(md) * Math.cos(dRa));
  const hourAngle = (SiderealTime(date) + lon / 15 - me.ra) * 15 * DEG;
  const q = Math.atan2(Math.sin(hourAngle), Math.tan(lat * DEG) * Math.cos(md) - Math.sin(md) * Math.cos(hourAngle));
  return {
    sun: { alt: sh.altitude, az: sh.azimuth },
    moon: { alt: mh.altitude, az: mh.azimuth, brightLimbNorth: norm360(chi / DEG), brightLimbZenith: norm360((chi - q) / DEG) },
    light: lightFor(sTrue.altitude),
    shadow: sh.altitude > 0.1 ? 1 / Math.tan(sh.altitude * DEG) : null,
  };
}

export interface DayEvents {
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number | null;
  noonAltitude: number | null;
  civilDawn: number | null;
  civilDusk: number | null;
  nauticalDawn: number | null;
  nauticalDusk: number | null;
  astroDawn: number | null;
  astroDusk: number | null;
  moonrise: number | null;
  moonset: number | null;
  moonTransit: number | null;
  moonTransitAltitude: number | null;
  dayLengthMs: number;
  /** Set when the Sun neither rises nor sets during the day. */
  polar: "day" | "night" | null;
}

/** Rise, set, transit and twilight events in the 24 hours starting at `dayStartMs`. */
export function dayEvents(dayStartMs: number, lat: number, lon: number): DayEvents {
  const obs = new Observer(lat, lon, 0);
  const start = new Date(dayStartMs);
  const end = dayStartMs + DAY_MS;
  const ms = (t: AstroTime | null) => (t && t.date.getTime() < end ? t.date.getTime() : null);
  const riseSet = (body: Body, dir: number) => ms(SearchRiseSet(body, obs, dir, start, 1));
  const twilight = (dir: number, alt: number) => ms(SearchAltitude(Body.Sun, obs, dir, start, 1, alt));
  const sunrise = riseSet(Body.Sun, +1);
  const sunset = riseSet(Body.Sun, -1);
  const noon = SearchHourAngle(Body.Sun, obs, 0, start);
  const noonMs = noon.time.date.getTime();
  const moonUp = SearchHourAngle(Body.Moon, obs, 0, start);
  const moonMs = moonUp.time.date.getTime();
  let dayLengthMs: number;
  let polar: DayEvents["polar"] = null;
  if (sunrise !== null && sunset !== null) dayLengthMs = sunset > sunrise ? sunset - sunrise : DAY_MS - (sunrise - sunset);
  else if (sunrise !== null) dayLengthMs = end - sunrise;
  else if (sunset !== null) dayLengthMs = sunset - dayStartMs;
  else {
    polar = noon.hor.altitude > -0.833 ? "day" : "night";
    dayLengthMs = polar === "day" ? DAY_MS : 0;
  }
  return {
    sunrise,
    sunset,
    solarNoon: noonMs < end ? noonMs : null,
    noonAltitude: noonMs < end ? noon.hor.altitude : null,
    civilDawn: twilight(+1, -6),
    civilDusk: twilight(-1, -6),
    nauticalDawn: twilight(+1, -12),
    nauticalDusk: twilight(-1, -12),
    astroDawn: twilight(+1, -18),
    astroDusk: twilight(-1, -18),
    moonrise: riseSet(Body.Moon, +1),
    moonset: riseSet(Body.Moon, -1),
    moonTransit: moonMs < end ? moonMs : null,
    moonTransitAltitude: moonMs < end ? moonUp.hor.altitude : null,
    dayLengthMs,
    polar,
  };
}

export interface AltitudeSeries {
  t: number[];
  sunAlt: number[];
  sunAz: number[];
  moonAlt: number[];
  moonAz: number[];
}

/** Sun and Moon altitude/azimuth through a day, for the charts. */
export function altitudeSeries(dayStartMs: number, lat: number, lon: number, stepMin = 10, withMoon = true): AltitudeSeries {
  const obs = new Observer(lat, lon, 0);
  const out: AltitudeSeries = { t: [], sunAlt: [], sunAz: [], moonAlt: [], moonAz: [] };
  for (let m = 0; m <= 1440; m += stepMin) {
    const ms = dayStartMs + m * 60000;
    const date = new Date(ms);
    const se = Equator(Body.Sun, date, obs, true, true);
    const sh = Horizon(date, obs, se.ra, se.dec, "normal");
    out.t.push(ms);
    out.sunAlt.push(sh.altitude);
    out.sunAz.push(sh.azimuth);
    if (withMoon) {
      const me = Equator(Body.Moon, date, obs, true, true);
      const mh = Horizon(date, obs, me.ra, me.dec, "normal");
      out.moonAlt.push(mh.altitude);
      out.moonAz.push(mh.azimuth);
    }
  }
  return out;
}

export interface YearDay {
  /** 0-based day of the year. */
  index: number;
  /** 00:00 UTC of that calendar day. */
  utcMidnight: number;
  declination: number;
  /** Geocentric ecliptic longitude of the Sun that day. */
  eclLon: number;
  equationOfTimeMin: number;
  /** Hours after that day's 00:00 UTC (can fall outside 0–24); null = no such event. */
  solarNoonUt: number;
  sunriseUt: number | null;
  sunsetUt: number | null;
  civilDawnUt: number | null;
  civilDuskUt: number | null;
  dayLengthHours: number;
  /** Hours with the Sun above −6° (civil twilight or brighter). */
  civilLengthHours: number;
  noonAltitude: number;
}

/** Daylight through a whole year at one place (analytic rise/set from the day's declination). */
export function yearSeries(year: number, lat: number, lon: number): YearDay[] {
  const days: YearDay[] = [];
  const count = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  const phi = lat * DEG;
  for (let i = 0; i < count; i++) {
    const utcMidnight = Date.UTC(year, 0, 1 + i);
    const s = skyAt(utcMidnight + (12 - lon / 15) * 3600000);
    const dec = s.sun.dec * DEG;
    const noon = 12 - lon / 15 - s.sun.equationOfTimeMin / 60;
    const halfArc = (h0: number): number | null => {
      const c = (Math.sin(h0 * DEG) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (c > 1) return null; // never reaches that altitude
      if (c < -1) return 12; // never drops below it
      return Math.acos(c) / DEG / 15;
    };
    const day = halfArc(-0.833);
    const civil = halfArc(-6);
    const up = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) > Math.sin(-0.833 * DEG);
    days.push({
      index: i,
      utcMidnight,
      declination: s.sun.dec,
      eclLon: s.sun.eclLon,
      equationOfTimeMin: s.sun.equationOfTimeMin,
      solarNoonUt: noon,
      sunriseUt: day === null || day === 12 ? null : noon - day,
      sunsetUt: day === null || day === 12 ? null : noon + day,
      civilDawnUt: civil === null || civil === 12 ? null : noon - civil,
      civilDuskUt: civil === null || civil === 12 ? null : noon + civil,
      dayLengthHours: day === null ? (up ? 24 : 0) : day * 2,
      civilLengthHours: civil === null ? 0 : civil * 2,
      noonAltitude: 90 - Math.abs(lat - s.sun.dec),
    });
  }
  return days;
}

export interface SeasonDates {
  marEquinox: number;
  junSolstice: number;
  sepEquinox: number;
  decSolstice: number;
}

export function seasonsOf(year: number): SeasonDates {
  const s = Seasons(year);
  return { marEquinox: s.mar_equinox.date.getTime(), junSolstice: s.jun_solstice.date.getTime(), sepEquinox: s.sep_equinox.date.getTime(), decSolstice: s.dec_solstice.date.getTime() };
}

const NORTH_SEASONS = { mar: "Spring", jun: "Summer", sep: "Autumn", dec: "Winter" } as const;
const SOUTH_SEASONS = { mar: "Autumn", jun: "Winter", sep: "Spring", dec: "Summer" } as const;
const EVENT_LABEL = { mar: "March equinox", jun: "June solstice", sep: "September equinox", dec: "December solstice" } as const;

export interface SeasonInfo {
  season: string;
  hemisphere: "northern" | "southern";
  startedMs: number;
  startedBy: string;
  nextMs: number;
  nextLabel: string;
  /** 0–1 through the current season. */
  progress: number;
}

/** Astronomical season at a latitude. */
export function seasonAt(ms: number, lat: number): SeasonInfo {
  const year = new Date(ms).getUTCFullYear();
  const events: { ms: number; kind: keyof typeof EVENT_LABEL }[] = [];
  for (const y of [year - 1, year, year + 1]) {
    const s = seasonsOf(y);
    events.push({ ms: s.marEquinox, kind: "mar" }, { ms: s.junSolstice, kind: "jun" }, { ms: s.sepEquinox, kind: "sep" }, { ms: s.decSolstice, kind: "dec" });
  }
  let i = 0;
  while (i + 1 < events.length && events[i + 1].ms <= ms) i++;
  const cur = events[i], next = events[i + 1];
  const north = lat >= 0;
  return {
    season: (north ? NORTH_SEASONS : SOUTH_SEASONS)[cur.kind],
    hemisphere: north ? "northern" : "southern",
    startedMs: cur.ms,
    startedBy: EVENT_LABEL[cur.kind],
    nextMs: next.ms,
    nextLabel: EVENT_LABEL[next.kind],
    progress: (ms - cur.ms) / (next.ms - cur.ms),
  };
}

const QUARTER_NAMES = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"];

export function upcomingPhases(ms: number, count = 4): { name: string; ms: number }[] {
  const out: { name: string; ms: number }[] = [];
  let q = SearchMoonQuarter(new Date(ms));
  for (let i = 0; i < count; i++) {
    out.push({ name: QUARTER_NAMES[q.quarter], ms: q.time.date.getTime() });
    q = NextMoonQuarter(q);
  }
  return out;
}

export interface Upcoming {
  lunarEclipse: { ms: number; kind: string };
  solarEclipse: { ms: number; kind: string; lat: number | null; lon: number | null };
  apsis: { ms: number; kind: "perigee" | "apogee"; distanceKm: number };
}

export function upcomingEvents(ms: number): Upcoming {
  const date = new Date(ms);
  const lunar = SearchLunarEclipse(date);
  const solar = SearchGlobalSolarEclipse(date);
  const apsis = SearchLunarApsis(date);
  return {
    lunarEclipse: { ms: lunar.peak.date.getTime(), kind: String(lunar.kind) },
    solarEclipse: { ms: solar.peak.date.getTime(), kind: String(solar.kind), lat: solar.latitude ?? null, lon: solar.longitude ?? null },
    apsis: { ms: apsis.time.date.getTime(), kind: apsis.kind === 0 ? "perigee" : "apogee", distanceKm: apsis.dist_km },
  };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (az: number) => COMPASS[Math.round(norm360(az) / 22.5) % 16];

/** Great-circle angle between two points, in degrees. */
export function angularDistance(a: SubPoint, b: SubPoint): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  return Math.acos(Math.max(-1, Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl)))) / DEG;
}
