/**
 * Sun–Earth–Moon scale facts and helpers: physical constants, a scale-model
 * calculator ("if the Sun were 1 m wide…") and formatting for lengths, big
 * distances and light-travel times.
 */

export type BodyId = "sun" | "earth" | "moon";

export interface Body {
  id: BodyId;
  name: string;
  radiusKm: number;
  /** Sidereal rotation period, in days. */
  rotationDays: number;
  /** Tilt of the rotation axis from the perpendicular to its orbit (Sun: to the ecliptic). */
  tiltDeg: number;
  /** Speed of a point on the equator, km/s. */
  equatorKmS: number;
  /** Sidereal orbital period, days (Earth around the Sun, Moon around the Earth). */
  orbitDays?: number;
  orbitKmS?: number;
}

export const BODIES: Record<BodyId, Body> = {
  sun: { id: "sun", name: "Sun", radiusKm: 695700, rotationDays: 25.38, tiltDeg: 7.25, equatorKmS: 1.997 },
  earth: { id: "earth", name: "Earth", radiusKm: 6371, rotationDays: 0.99726968, tiltDeg: 23.44, equatorKmS: 0.4651, orbitDays: 365.25636, orbitKmS: 29.78 },
  moon: { id: "moon", name: "Moon", radiusKm: 1737.4, rotationDays: 27.321661, tiltDeg: 6.68, equatorKmS: 0.004627, orbitDays: 27.321661, orbitKmS: 1.022 },
};

export const AU_KM = 149597870.7;
export const MEAN_MOON_KM = 384400;
export const C_KM_S = 299792.458;
export const SYNODIC_MONTH_DAYS = 29.530589;
export const MOON_ORBIT_INCLINATION = 5.145;

export interface ScaleModel {
  /** Model metres per real kilometre. */
  metresPerKm: number;
  /** One model metre stands for this many real kilometres. */
  ratio: number;
  sunDiameter: number;
  earthDiameter: number;
  moonDiameter: number;
  sunToEarth: number;
  earthToMoon: number;
  /** Speed of light in the model, metres per second. */
  lightSpeed: number;
}

/** Shrink everything so that `ref` is `diameterM` metres across. */
export function scaleModel(ref: BodyId, diameterM: number, sunEarthKm = AU_KM, earthMoonKm = MEAN_MOON_KM): ScaleModel {
  const metresPerKm = diameterM / (2 * BODIES[ref].radiusKm);
  return {
    metresPerKm,
    ratio: 1 / metresPerKm,
    sunDiameter: 2 * BODIES.sun.radiusKm * metresPerKm,
    earthDiameter: 2 * BODIES.earth.radiusKm * metresPerKm,
    moonDiameter: 2 * BODIES.moon.radiusKm * metresPerKm,
    sunToEarth: sunEarthKm * metresPerKm,
    earthToMoon: earthMoonKm * metresPerKm,
    lightSpeed: C_KM_S * metresPerKm,
  };
}

const trim = (n: number, digits: number) => Number(n.toPrecision(digits)).toLocaleString(undefined, { maximumFractionDigits: 6 });

/** A model length in the most readable unit. */
export function fmtLength(metres: number): string {
  const a = Math.abs(metres);
  if (!Number.isFinite(a)) return "—";
  if (a < 1e-6) return `${trim(metres * 1e9, 3)} nm`;
  if (a < 1e-3) return `${trim(metres * 1e6, 3)} µm`;
  if (a < 0.01) return `${trim(metres * 1000, 3)} mm`;
  if (a < 1) return `${trim(metres * 100, 3)} cm`;
  if (a < 1000) return `${trim(metres, 4)} m`;
  return `${trim(metres / 1000, 4)} km`;
}

export function fmtKm(km: number): string {
  const a = Math.abs(km);
  if (a >= 1e9) return `${trim(km / 1e9, 4)} billion km`;
  if (a >= 1e6) return `${trim(km / 1e6, 4)} million km`;
  return `${Math.round(km).toLocaleString()} km`;
}

export function lightTime(km: number): string {
  const s = km / C_KM_S;
  if (s < 60) return `${s.toFixed(2)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function fmtPeriod(days: number): string {
  if (days < 1.5) {
    const h = days * 24;
    return `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;
  }
  return `${trim(days, 4)} days`;
}

/** A round scale-bar length (1, 2 or 5 × 10ⁿ km) close to `targetPx` on screen. */
export function scaleBar(kmPerPx: number, targetPx = 110): { km: number; px: number } {
  const raw = kmPerPx * targetPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const lead = raw / pow;
  const km = (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * pow;
  return { km, px: km / kmPerPx };
}
