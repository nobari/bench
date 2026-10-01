"use client";

import type { AltitudeSeries, DayEvents, YearDay } from "@/lib/tools/time/astro";
import { DAY_MS, MONTHS, fmtClock, zoneParts, type Zone } from "@/lib/tools/time/zone";

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const SUN = "#e8a013";
const MOON = "#8b97b5";

/** Pointer position inside an SVG, in viewBox units. */
function svgPoint(e: React.PointerEvent<SVGSVGElement>, w: number, h: number): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
}

/* ------------------------------------------------------------ moon disk */

/**
 * The Moon's disk for an illuminated fraction, with the bright limb turned
 * `angle` degrees counter-clockwise from "up" (zenith for an observer, north otherwise).
 */
export function MoonDisk({ fraction, angle, size = 96, dim = false }: { fraction: number; angle: number; size?: number; dim?: boolean }) {
  const R = size / 2 - 2;
  const k = clamp(fraction, 0, 1);
  const b = R * Math.abs(1 - 2 * k);
  const theta = angle * DEG;
  const rot = Math.atan2(-Math.cos(theta), -Math.sin(theta)) / DEG;
  const lit = `M 0 ${-R} A ${R} ${R} 0 0 1 0 ${R} A ${b} ${R} 0 0 ${k < 0.5 ? 0 : 1} 0 ${-R} Z`;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="img" aria-label={`Moon ${Math.round(k * 100)}% illuminated`}>
      <circle r={R} fill="#252a37" stroke="#5b6274" strokeWidth={1} />
      <path d={lit} fill="#f2efe0" transform={`rotate(${rot})`} opacity={dim ? 0.5 : 1} />
    </svg>
  );
}

/* ------------------------------------------------------------- day chart */

const LIGHT_FILL = ["rgba(18, 26, 66, 0.62)", "rgba(40, 54, 112, 0.5)", "rgba(78, 96, 160, 0.42)", "rgba(240, 160, 90, 0.36)", "rgba(255, 214, 90, 0.3)"];
const lightIndex = (alt: number) => (alt > -0.833 ? 4 : alt > -6 ? 3 : alt > -12 ? 2 : alt > -18 ? 1 : 0);

export function DayChart({ series, events, dayStart, ms, zone, onScrub }: { series: AltitudeSeries; events: DayEvents; dayStart: number; ms: number; zone: Zone; onScrub: (ms: number) => void }) {
  const W = 720, H = 236, L = 34, R = 8, T = 10, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const x = (t: number) => L + ((t - dayStart) / DAY_MS) * pw;
  const y = (alt: number) => T + ((90 - clamp(alt, -60, 90)) / 150) * ph;
  const line = (alts: number[]) => alts.map((a, i) => `${i ? "L" : "M"}${x(series.t[i]).toFixed(1)} ${y(a).toFixed(1)}`).join(" ");
  const at = (alts: number[], t: number) => {
    const f = clamp(((t - dayStart) / DAY_MS) * (alts.length - 1), 0, alts.length - 1);
    const i = Math.floor(f), j = Math.min(alts.length - 1, i + 1);
    return alts[i] + (alts[j] - alts[i]) * (f - i);
  };
  const inDay = ms >= dayStart && ms <= dayStart + DAY_MS;
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => onScrub(dayStart + clamp((svgPoint(e, W, H).x - L) / pw, 0, 0.9999) * DAY_MS);
  const marks: { t: number | null; label: string; color: string; up: boolean }[] = [
    { t: events.sunrise, label: "sunrise", color: SUN, up: true },
    { t: events.sunset, label: "sunset", color: SUN, up: true },
    { t: events.moonrise, label: "moonrise", color: MOON, up: false },
    { t: events.moonset, label: "moonset", color: MOON, up: false },
  ];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-ew-resize touch-none select-none text-faint"
      role="img"
      aria-label="Sun and Moon altitude through the day"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && scrub(e)}
    >
      {series.t.slice(0, -1).map((t, i) => (
        <rect key={t} x={x(t)} y={T} width={x(series.t[i + 1]) - x(t) + 0.5} height={ph} fill={LIGHT_FILL[lightIndex((series.sunAlt[i] + series.sunAlt[i + 1]) / 2)]} />
      ))}
      <rect x={L} y={y(0)} width={pw} height={T + ph - y(0)} fill="rgba(0, 0, 0, 0.16)" />
      {[-30, 0, 30, 60, 90].map((a) => (
        <g key={a}>
          <line x1={L} x2={W - R} y1={y(a)} y2={y(a)} stroke="currentColor" strokeOpacity={a === 0 ? 0.9 : 0.25} strokeWidth={a === 0 ? 1.2 : 0.6} />
          <text x={L - 5} y={y(a) + 3.5} textAnchor="end" fontSize={10} fill="currentColor">
            {a}°
          </text>
        </g>
      ))}
      {Array.from({ length: 9 }, (_, i) => dayStart + (i * DAY_MS) / 8).map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor">
          {fmtClock(t, zone)}
        </text>
      ))}
      {series.moonAlt.length > 0 && <path d={line(series.moonAlt)} fill="none" stroke={MOON} strokeWidth={1.8} />}
      <path d={line(series.sunAlt)} fill="none" stroke={SUN} strokeWidth={2.2} />
      {marks.map(
        (m) =>
          m.t !== null && (
            <g key={m.label}>
              <line x1={x(m.t)} x2={x(m.t)} y1={y(0) - 5} y2={y(0) + 5} stroke={m.color} strokeWidth={2} />
              <text x={x(m.t)} y={m.up ? y(0) - 9 : y(0) + 16} textAnchor="middle" fontSize={9.5} fill={m.color} fontWeight={600}>
                {m.label} {fmtClock(m.t, zone)}
              </text>
            </g>
          ),
      )}
      {inDay && (
        <g>
          <line x1={x(ms)} x2={x(ms)} y1={T} y2={T + ph} stroke="currentColor" strokeOpacity={0.9} strokeWidth={1} />
          {series.moonAlt.length > 0 && <circle cx={x(ms)} cy={y(at(series.moonAlt, ms))} r={4.5} fill="#e8e6dc" stroke="#3b4257" strokeWidth={1.2} />}
          <circle cx={x(ms)} cy={y(at(series.sunAlt, ms))} r={5.5} fill="#ffd84a" stroke="#a86a12" strokeWidth={1.2} />
        </g>
      )}
    </svg>
  );
}

/* -------------------------------------------------------------- sky dome */

export interface SkyPath {
  label: string;
  color: string;
  dash?: string;
  alt: number[];
  az: number[];
}

export function SkyDome({ paths, sun, moon }: { paths: SkyPath[]; sun: { alt: number; az: number }; moon: { alt: number; az: number } }) {
  const S = 280, c = S / 2, R = 116;
  const xy = (alt: number, az: number): [number, number] => {
    const r = ((90 - alt) / 90) * R;
    return [c + r * Math.sin(az * DEG), c - r * Math.cos(az * DEG)];
  };
  const trace = (p: SkyPath) => {
    let d = "", pen = false;
    for (let i = 0; i < p.alt.length; i++) {
      if (p.alt[i] < 0) {
        pen = false;
        continue;
      }
      const [px, py] = xy(p.alt[i], p.az[i]);
      d += `${pen ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)} `;
      pen = true;
    }
    return d;
  };
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[320px] text-faint" role="img" aria-label="Sky dome with the Sun and Moon paths">
      <circle cx={c} cy={c} r={R} fill="rgba(120, 170, 220, 0.14)" stroke="currentColor" strokeOpacity={0.7} />
      {[30, 60].map((a) => (
        <circle key={a} cx={c} cy={c} r={((90 - a) / 90) * R} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 4" />
      ))}
      <line x1={c - R} x2={c + R} y1={c} y2={c} stroke="currentColor" strokeOpacity={0.2} />
      <line x1={c} x2={c} y1={c - R} y2={c + R} stroke="currentColor" strokeOpacity={0.2} />
      {(
        [
          ["N", c, c - R - 7],
          ["E", c + R + 9, c + 4],
          ["S", c, c + R + 15],
          ["W", c - R - 9, c + 4],
        ] as const
      ).map(([t, tx, ty]) => (
        <text key={t} x={tx} y={ty} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">
          {t}
        </text>
      ))}
      <text x={c + 3} y={c - (R * 2) / 3 + 3} fontSize={8.5} fill="currentColor">
        30°
      </text>
      <text x={c + 3} y={c - R / 3 + 3} fontSize={8.5} fill="currentColor">
        60°
      </text>
      {paths.map((p) => (
        <path key={p.label} d={trace(p)} fill="none" stroke={p.color} strokeWidth={p.dash ? 1.2 : 2.2} strokeDasharray={p.dash} />
      ))}
      {moon.alt >= 0 && <circle cx={xy(moon.alt, moon.az)[0]} cy={xy(moon.alt, moon.az)[1]} r={5} fill="#e8e6dc" stroke="#3b4257" strokeWidth={1.2} />}
      {sun.alt >= 0 && <circle cx={xy(sun.alt, sun.az)[0]} cy={xy(sun.alt, sun.az)[1]} r={6.5} fill="#ffd84a" stroke="#a86a12" strokeWidth={1.2} />}
    </svg>
  );
}

/* ------------------------------------------------------------ year chart */

export function YearChart({
  year,
  offsets,
  dayIndex,
  minute,
  marks,
  onScrub,
}: {
  year: YearDay[];
  /** Zone offset in minutes for each day (so DST shows up as a step). */
  offsets: number[];
  dayIndex: number;
  minute: number;
  marks: { label: string; index: number }[];
  onScrub: (dayIndex: number, minute: number) => void;
}) {
  const W = 720, H = 236, L = 34, R = 8, T = 16, B = 22;
  const pw = W - L - R, ph = H - T - B, n = year.length;
  const x = (i: number) => L + (i / n) * pw;
  const y = (hour: number) => T + (hour / 24) * ph;
  const dx = pw / n + 0.4;
  const band = (length: (d: YearDay) => number) => {
    let d = "";
    year.forEach((day, i) => {
      const len = length(day);
      if (len <= 0) return;
      const rect = (a: number, b: number) => (d += `M${x(i).toFixed(2)} ${y(a).toFixed(2)}h${dx.toFixed(2)}V${y(b).toFixed(2)}h${(-dx).toFixed(2)}Z`);
      if (len >= 24) return rect(0, 24);
      const noon = (((day.solarNoonUt + offsets[i] / 60) % 24) + 24) % 24;
      const a = noon - len / 2, b = noon + len / 2;
      if (a < 0) {
        rect(0, b);
        rect(a + 24, 24);
      } else if (b > 24) {
        rect(a, 24);
        rect(0, b - 24);
      } else rect(a, b);
    });
    return d;
  };
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e, W, H);
    onScrub(clamp(Math.floor(((p.x - L) / pw) * n), 0, n - 1), clamp(Math.round(((p.y - T) / ph) * 1440), 0, 1439));
  };
  const y0 = year[0] ? new Date(year[0].utcMidnight).getUTCFullYear() : 2000;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full cursor-crosshair touch-none select-none text-faint"
      role="img"
      aria-label="Daylight through the year"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && scrub(e)}
    >
      <rect x={L} y={T} width={pw} height={ph} fill="rgba(18, 26, 66, 0.62)" />
      <path d={band((d) => d.civilLengthHours)} fill="rgba(240, 160, 90, 0.55)" />
      <path d={band((d) => d.dayLengthHours)} fill="rgba(255, 221, 110, 0.95)" />
      {[0, 6, 12, 18, 24].map((h) => (
        <g key={h}>
          <line x1={L} x2={W - R} y1={y(h)} y2={y(h)} stroke="currentColor" strokeOpacity={0.3} strokeWidth={0.6} />
          <text x={L - 5} y={y(h) + 3.5} textAnchor="end" fontSize={10} fill="currentColor">
            {String(h).padStart(2, "0")}
          </text>
        </g>
      ))}
      {MONTHS.map((m, i) => {
        const idx = (Date.UTC(y0, i, 1) - Date.UTC(y0, 0, 1)) / DAY_MS;
        return (
          <g key={m}>
            <line x1={x(idx)} x2={x(idx)} y1={T} y2={T + ph} stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.6} />
            <text x={x(idx) + 3} y={H - 7} fontSize={10} fill="currentColor">
              {m}
            </text>
          </g>
        );
      })}
      {marks.map((m) => (
        <g key={m.label}>
          <line x1={x(m.index + 0.5)} x2={x(m.index + 0.5)} y1={T} y2={T + ph} stroke="#ffffff" strokeOpacity={0.85} strokeDasharray="3 3" strokeWidth={1} />
          <text x={x(m.index + 0.5)} y={T - 5} textAnchor="middle" fontSize={9.5} fill="currentColor">
            {m.label}
          </text>
        </g>
      ))}
      <line x1={x(dayIndex + 0.5)} x2={x(dayIndex + 0.5)} y1={T} y2={T + ph} stroke="#e5484d" strokeWidth={1.4} />
      <circle cx={x(dayIndex + 0.5)} cy={y(minute / 60)} r={4.5} fill="#e5484d" stroke="#ffffff" strokeWidth={1.4} />
    </svg>
  );
}

/* --------------------------------------------------------- orbit diagram */

export function OrbitDiagram({
  sunEclLon,
  moonEclLon,
  monthAngles,
  onScrub,
}: {
  /** Geocentric ecliptic longitude of the Sun, degrees. */
  sunEclLon: number;
  moonEclLon: number;
  /** The Sun's ecliptic longitude on the 1st of each month. */
  monthAngles: number[];
  onScrub: (sunEclLon: number) => void;
}) {
  const S = 360, c = S / 2, R = 128, RM = 26;
  const pos = (earthLon: number, r = R): [number, number] => [c + r * Math.cos(earthLon * DEG), c - r * Math.sin(earthLon * DEG)];
  const [ex, ey] = pos(sunEclLon + 180);
  const mx = ex + RM * Math.cos(moonEclLon * DEG), my = ey - RM * Math.sin(moonEclLon * DEG);
  const half = (r: number) => `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} Z`;
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e, S, S);
    const earthLon = Math.atan2(-(p.y - c), p.x - c) / DEG;
    onScrub((((earthLon - 180) % 360) + 360) % 360);
  };
  const seasons: [string, string, number][] = [
    ["March equinox", "", 180],
    ["June solstice", "north leans to the Sun", 270],
    ["September equinox", "", 0],
    ["December solstice", "north leans away", 90],
  ];
  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className="w-full max-w-[380px] cursor-grab touch-none select-none text-faint"
      role="img"
      aria-label="Earth's orbit around the Sun with the Moon's orbit, seen from above the north pole"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && scrub(e)}
    >
      <circle cx={c} cy={c} r={R} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} />
      {monthAngles.map((a, i) => {
        const [x1, y1] = pos(a + 180, R - 4), [x2, y2] = pos(a + 180, R + 4), [tx, ty] = pos(a + 180 + 14, R + 15);
        return (
          <g key={MONTHS[i]}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeOpacity={0.7} />
            <text x={tx} y={ty + 3} textAnchor="middle" fontSize={9.5} fill="currentColor">
              {MONTHS[i]}
            </text>
          </g>
        );
      })}
      {seasons.map(([name, note, lon]) => {
        const [sx, sy] = pos(lon, R - 34);
        return (
          <g key={name}>
            <circle cx={pos(lon)[0]} cy={pos(lon)[1]} r={2.5} fill="currentColor" />
            <text x={sx} y={sy} textAnchor="middle" fontSize={9.5} fill="currentColor" fontWeight={600}>
              {name}
            </text>
            {note && (
              <text x={sx} y={sy + 11} textAnchor="middle" fontSize={8.5} fill="currentColor">
                {note}
              </text>
            )}
          </g>
        );
      })}
      <circle cx={c} cy={c} r={26} fill="rgba(255, 214, 90, 0.22)" />
      <circle cx={c} cy={c} r={15} fill="#ffd84a" stroke="#a86a12" strokeWidth={1.2} />
      <line x1={c} y1={c} x2={ex} y2={ey} stroke="#e8a013" strokeOpacity={0.45} strokeDasharray="2 4" />
      <circle cx={ex} cy={ey} r={RM} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeDasharray="2 3" />
      {/* Earth: night side dark, day side toward the Sun, axis leaning toward ecliptic longitude 90° all year. */}
      <line x1={ex} y1={ey + 13} x2={ex} y2={ey - 17} stroke="#e5484d" strokeWidth={1.6} />
      <text x={ex + 4} y={ey - 15} fontSize={9} fill="#e5484d" fontWeight={700}>
        N
      </text>
      <circle cx={ex} cy={ey} r={9} fill="#1d3557" stroke="#0e1b2c" strokeWidth={1} />
      <path d={half(9)} transform={`translate(${ex} ${ey}) rotate(${-sunEclLon})`} fill="#6fb3e0" />
      <circle cx={mx} cy={my} r={4.5} fill="#3a3f4e" stroke="#1c2030" strokeWidth={0.8} />
      <path d={half(4.5)} transform={`translate(${mx} ${my}) rotate(${-sunEclLon})`} fill="#f2efe0" />
    </svg>
  );
}

/** Clock label helper shared with the main widget. */
export function localDate(ms: number, zone: Zone): string {
  const p = zoneParts(ms, zone);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}
