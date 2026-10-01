"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { geoCircle, geoOrthographic, geoPath } from "d3-geo";
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus } from "lucide-react";
import { norm180, skyAt, type Sky } from "@/lib/tools/time/astro";
import { AU_KM, BODIES, C_KM_S, MOON_ORBIT_INCLINATION, SYNODIC_MONTH_DAYS, fmtKm, fmtLength, fmtPeriod, lightTime, scaleBar, scaleModel, type BodyId } from "@/lib/tools/time/scale";
import { DAY_MS, MONTHS, UTC_ZONE, dayOfYear, daysInYear, fmtClock, fmtDay, zoneParts, zoneToUtc } from "@/lib/tools/time/zone";
import { loadWorld, type World } from "./esm-globe";
import { cn } from "@/lib/utils";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const SPACE = "#0b1020";
const MIN_PX: Record<BodyId, number> = { sun: 24, earth: 11, moon: 5.5 };
const IDS: BodyId[] = ["sun", "earth", "moon"];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const KPP_MIN = 12, KPP_MAX = 1.4e6;

const SPEEDS = [
  { id: "1", label: "Real time", rate: 1 },
  { id: "60", label: "1 minute / s", rate: 60 },
  { id: "3600", label: "1 hour / s", rate: 3600 },
  { id: "21600", label: "6 hours / s", rate: 21600 },
  { id: "86400", label: "1 day / s", rate: 86400 },
  { id: "432000", label: "5 days / s", rate: 432000 },
  { id: "2592000", label: "30 days / s", rate: 2592000 },
];

const INPUT = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const CHIP = "h-7 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent";
const RANGE = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]";
const ICON_BTN = "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent";

/* ------------------------------------------------------------- drawing */

type Ctx = CanvasRenderingContext2D;

/** Darkens the half of a ball that faces away from light arriving from ecliptic angle `sunDeg`. */
function shadeNight(ctx: Ctx, cx: number, cy: number, r: number, sunDeg: number, alpha = 0.62) {
  const a = -sunDeg * DEG;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a + Math.PI / 2, a + 1.5 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = `rgba(5, 8, 22, ${alpha})`;
  ctx.fill();
}

function drawSun(ctx: Ctx, cx: number, cy: number, r: number, ms: number) {
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#fff6c8");
  g.addColorStop(0.7, "#ffcf4a");
  g.addColorStop(1, "#f29a1f");
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(r, 0.6), 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  if (r < 6) return;
  const phase = ((ms / DAY_MS / BODIES.sun.rotationDays) % 1) * TAU;
  ctx.fillStyle = "rgba(120, 60, 10, 0.72)";
  for (const [rr, a0, size] of [[0.62, 0.2, 0.07], [0.78, 2.3, 0.05], [0.55, 4.1, 0.06], [0.84, 5.2, 0.04], [0.4, 3.2, 0.035]]) {
    const a = a0 + phase;
    ctx.beginPath();
    ctx.arc(cx + rr * r * Math.cos(a), cy - rr * r * Math.sin(a), size * r, 0, TAU);
    ctx.fill();
  }
}

function drawMoon(ctx: Ctx, cx: number, cy: number, r: number, sky: Sky) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(r, 0.6), 0, TAU);
  ctx.fillStyle = "#c9c6ba";
  ctx.fill();
  if (r >= 5) {
    // The near side (with its dark maria) always points back at the Earth.
    const face = (sky.moon.eclLon + 180) * DEG;
    ctx.fillStyle = "rgba(92, 94, 104, 0.78)";
    for (const [rr, off, size] of [[0.5, 0.36, 0.2], [0.55, -0.32, 0.16], [0.28, 0.05, 0.13], [0.74, 0.02, 0.1]]) {
      const a = face + off;
      ctx.beginPath();
      ctx.arc(cx + rr * r * Math.cos(a), cy - rr * r * Math.sin(a), size * r, 0, TAU);
      ctx.fill();
    }
  }
  if (r >= 1.5) shadeNight(ctx, cx, cy, r, sky.sun.eclLon);
}

/** Earth seen from above the north pole of its orbit, with real coastlines once it is big enough. */
function drawEarth(ctx: Ctx, cx: number, cy: number, r: number, sky: Sky, world: World | null) {
  if (r < 9 || !world) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(r, 0.6), 0, TAU);
    ctx.fillStyle = "#3f86ad";
    ctx.fill();
    if (r >= 3) {
      const a = sky.gast * 15 * DEG;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(a), cy - r * Math.sin(a));
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (r >= 1.5) shadeNight(ctx, cx, cy, r, sky.sun.eclLon);
    return;
  }
  // The point of the Earth under the north ecliptic pole (RA 18 h, Dec +66.56°) is the centre of the view.
  const poleLon = norm180((18 - sky.gast) * 15);
  const make = (gamma: number) => geoOrthographic().translate([cx, cy]).scale(r).rotate([-poleLon, -66.56, gamma]);
  const sunAngle = (gamma: number) => {
    const p = make(gamma).clipAngle(null)([sky.sun.lon, sky.sun.lat]);
    return p ? Math.atan2(-(p[1] - cy), p[0] - cx) / DEG : 0;
  };
  // Roll the view so the sub-solar point sits in the Sun's direction on screen.
  const d = norm180(sky.sun.eclLon - sunAngle(0));
  const gamma = Math.abs(norm180(sunAngle(d) - sky.sun.eclLon)) < Math.abs(norm180(sunAngle(-d) - sky.sun.eclLon)) ? d : -d;
  const path = geoPath(make(gamma).clipAngle(90).precision(0.6), ctx);
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.fillStyle = "#3f86ad";
  ctx.fill();
  ctx.beginPath();
  for (const c of world.countries) path(c);
  ctx.fillStyle = "#a9c98a";
  ctx.fill();
  ctx.beginPath();
  path(geoCircle().center([norm180(sky.sun.lon + 180), -sky.sun.lat]).radius(90).precision(3)());
  ctx.fillStyle = "rgba(5, 8, 22, 0.6)";
  ctx.fill();
}

function drawBody(ctx: Ctx, id: BodyId, x: number, y: number, r: number, sky: Sky, world: World | null) {
  if (id === "sun") drawSun(ctx, x, y, r, sky.ms);
  else if (id === "earth") drawEarth(ctx, x, y, r, sky, world);
  else drawMoon(ctx, x, y, r, sky);
}

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): Ctx | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

const FONT = "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif";

/* --------------------------------------------------------------- widget */

function readInitialMs(): number | null {
  if (typeof window === "undefined") return null;
  const t = new URLSearchParams(window.location.search).get("t");
  const parsed = t ? Date.parse(t) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const PORT = 150;

/** Waits for the starting instant, so the canvas and its observers exist from the inner component's first effect. */
export function ScaleModelWidget() {
  const [start, setStart] = useState<number | null>(readInitialMs);
  const [fromLink] = useState(() => readInitialMs() !== null);
  useEffect(() => {
    if (start !== null) return;
    let active = true;
    queueMicrotask(() => active && setStart(Date.now()));
    return () => {
      active = false;
    };
  }, [start]);
  if (start === null) return <div className="panel p-6 text-[13.5px] text-muted">Setting the clock…</div>;
  return <ScaleModelScene startMs={start} fromLink={fromLink} />;
}

function ScaleModelScene({ startMs, fromLink }: { startMs: number; fromLink: boolean }) {
  const [ms, setMs] = useState(startMs);
  const [touched, setTouched] = useState(fromLink);
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState("3600");
  const [world, setWorld] = useState<World | null>(null);
  const [kpp, setKpp] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [layers, setLayers] = useState({ orbits: true, labels: true });
  const [width, setWidth] = useState(0);
  const [modelRef, setModelRef] = useState<BodyId>("sun");
  const [modelCm, setModelCm] = useState("100");
  const [, setT] = useQueryState("t", parseAsString.withOptions({ history: "replace", throttleMs: 500 }));
  const [focusParam, setFocusParam] = useQueryState("focus", parseAsString.withDefault("earth").withOptions({ history: "replace" }));
  const [modeParam, setModeParam] = useQueryState("mode", parseAsString.withDefault("true").withOptions({ history: "replace" }));
  const focus = (IDS.includes(focusParam as BodyId) ? focusParam : "earth") as BodyId;
  const real = modeParam !== "schematic";
  const speed = SPEEDS.find((s) => s.id === speedId) ?? SPEEDS[2];

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portRefs = useRef<Record<BodyId, HTMLCanvasElement | null>>({ sun: null, earth: null, moon: null });
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number }; pinch: number; kpp: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const latest = useRef({ kpp: 2200 });

  const height = Math.round(clamp(width * 0.62, 280, 560));
  const half = Math.max(60, Math.min(width, height) / 2 - 26);
  const fit = {
    orbit: (AU_KM * 1.06) / half,
    pair: 430000 / half,
    body: (id: BodyId) => (BODIES[id].radiusKm * 1.3) / half,
  };
  const kmPerPx = clamp(kpp ?? fit.pair, KPP_MIN, KPP_MAX);

  useEffect(() => {
    latest.current = { kpp: kmPerPx };
  });

  useEffect(() => {
    let active = true;
    loadWorld()
      .then((w) => active && setWorld(w))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        // Read the frame time now: a state updater runs later, after `last` has moved on.
        const step = Math.min(1, (now - last) / 1000) * 1000 * speed.rate;
        setMs((m) => m + step);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed.rate]);

  useEffect(() => {
    if (playing || !touched) return;
    void setT(`${new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)}Z`);
  }, [ms, playing, touched, setT]);

  // Pinch or ⌘/Ctrl + scroll zooms; plain scrolling still moves the page.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setKpp(clamp(latest.current.kpp * Math.exp(e.deltaY * 0.01), KPP_MIN, KPP_MAX));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const sky = useMemo(() => skyAt(ms), [ms]);
  const year = new Date(ms).getUTCFullYear();
  const orbit = useMemo(() => {
    const pts: [number, number][] = [];
    const start = Date.UTC(year, 0, 1), span = Date.UTC(year + 1, 0, 1) - start;
    for (let i = 0; i <= 120; i++) {
      const s = skyAt(start + (span * i) / 120).sun;
      const a = (s.eclLon + 180) * DEG;
      pts.push([s.distanceKm * Math.cos(a), s.distanceKm * Math.sin(a)]);
    }
    return pts;
  }, [year]);

  // Where everything is, in kilometres on the plane of Earth's orbit (Sun at the origin).
  const earthAngle = (sky.sun.eclLon + 180) * DEG;
  const earth = { x: sky.sun.distanceKm * Math.cos(earthAngle), y: sky.sun.distanceKm * Math.sin(earthAngle) };
  const moonAngle = sky.moon.eclLon * DEG;
  const moonShown = real ? sky.moon.distanceKm : Math.max(sky.moon.distanceKm, 48 * kmPerPx);
  const moon = { x: earth.x + moonShown * Math.cos(moonAngle), y: earth.y + moonShown * Math.sin(moonAngle) };
  const radiusPx = (id: BodyId) => (real ? BODIES[id].radiusKm / kmPerPx : Math.max(BODIES[id].radiusKm / kmPerPx, MIN_PX[id]));
  const at: Record<BodyId, { x: number; y: number }> = { sun: { x: 0, y: 0 }, earth, moon };
  const cam = { x: at[focus].x + pan.x, y: at[focus].y + pan.y };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = setupCanvas(canvas, width, height);
    if (!ctx) return;
    const sx = (p: { x: number; y: number }): [number, number] => [width / 2 + (p.x - cam.x) / kmPerPx, height / 2 - (p.y - cam.y) / kmPerPx];
    ctx.fillStyle = SPACE;
    ctx.fillRect(0, 0, width, height);

    const [ex, ey] = sx(earth);
    if (layers.orbits) {
      ctx.strokeStyle = "rgba(160, 190, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (AU_KM / kmPerPx > 30000) {
        // Zoomed far in: the orbit is a straight line through the Earth, at right angles to the Sun.
        const tx = -Math.sin(earthAngle), ty = Math.cos(earthAngle), far = (width + height) * kmPerPx;
        ctx.moveTo(...sx({ x: earth.x - tx * far, y: earth.y - ty * far }));
        ctx.lineTo(...sx({ x: earth.x + tx * far, y: earth.y + ty * far }));
      } else {
        orbit.forEach(([x, y], i) => (i ? ctx.lineTo(...sx({ x, y })) : ctx.moveTo(...sx({ x, y }))));
      }
      ctx.stroke();
      const mr = moonShown / kmPerPx;
      ctx.strokeStyle = "rgba(210, 214, 230, 0.45)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      if (mr > 30000) {
        const tx = -Math.sin(moonAngle), ty = Math.cos(moonAngle), far = (width + height) * kmPerPx;
        ctx.moveTo(...sx({ x: moon.x - tx * far, y: moon.y - ty * far }));
        ctx.lineTo(...sx({ x: moon.x + tx * far, y: moon.y + ty * far }));
      } else ctx.arc(ex, ey, mr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.textBaseline = "middle";
    const placed: [number, number][] = [];
    // Nudges a label down until it clears the ones already drawn (Earth and Moon often share a pixel).
    const clear = (x: number, y: number, lines: number) => {
      let yy = y;
      while (placed.some(([px, py]) => Math.abs(px - x) < 90 && Math.abs(py - yy) < 13 * lines + 2)) yy += 13 * lines + 2;
      placed.push([x, yy]);
      return yy;
    };
    for (const id of IDS) {
      const [x, y] = sx(at[id]);
      const r = radiusPx(id);
      const on = x > -r && x < width + r && y > -r && y < height + r;
      if (on) drawBody(ctx, id, x, y, r, sky, world);
      if (!layers.labels) continue;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = "#e8ecf8";
      if (!on) {
        // Off-screen: point at it from the edge.
        // Keep clear of the scale bar and zoom read-out along the bottom, and the mode label at the top.
        const px = clamp(x, 14, width - 14), py = clamp(y, 34, height - 58);
        const a = Math.atan2(y - height / 2, x - width / 2);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-4, -5);
        ctx.lineTo(-4, 5);
        ctx.closePath();
        ctx.fillStyle = id === "sun" ? "#ffd84a" : id === "earth" ? "#7fc3ee" : "#d4d2c8";
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#e8ecf8";
        ctx.textAlign = px > width / 2 ? "right" : "left";
        const lx = px + (px > width / 2 ? -14 : 14);
        ctx.fillText(BODIES[id].name, lx, clear(lx, py, 1));
        continue;
      }
      ctx.textAlign = "left";
      if (r < 2) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, TAU);
        ctx.strokeStyle = "rgba(232, 236, 248, 0.75)";
        ctx.lineWidth = 1;
        ctx.stroke();
        const ly = clear(x + 14, y, 2);
        ctx.fillText(BODIES[id].name, x + 14, ly - 6);
        ctx.font = `10.5px ${FONT}`;
        ctx.fillStyle = "rgba(232, 236, 248, 0.7)";
        ctx.fillText(`${(r * 2).toFixed(r < 0.05 ? 3 : 2)} px wide at this zoom`, x + 14, ly + 7);
      } else if (r < Math.min(width, height) * 0.4) ctx.fillText(BODIES[id].name, x + r + 6, clear(x + r + 6, y, 1));
    }

    // Scale bar and zoom read-out.
    const bar = scaleBar(kmPerPx);
    ctx.strokeStyle = "#e8ecf8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, height - 22);
    ctx.lineTo(14, height - 16);
    ctx.lineTo(14 + bar.px, height - 16);
    ctx.lineTo(14 + bar.px, height - 22);
    ctx.stroke();
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = "#e8ecf8";
    ctx.textAlign = "left";
    ctx.fillText(`${fmtKm(bar.km)} · light: ${lightTime(bar.km)}`, 14, height - 31);
    ctx.textAlign = "right";
    ctx.fillStyle = real ? "#b9f29b" : "#ffd28a";
    ctx.fillText(real ? "True scale — sizes and distances" : "Schematic — sizes and the Moon's distance are enlarged", width - 12, 16);
    ctx.fillStyle = "rgba(232, 236, 248, 0.7)";
    ctx.fillText(`1 px = ${fmtKm(kmPerPx)}`, width - 12, height - 16);
  });

  // The three close-ups: always big enough to see the spin, all in the same top-down orientation.
  useEffect(() => {
    for (const id of IDS) {
      const canvas = portRefs.current[id];
      if (!canvas) continue;
      const ctx = setupCanvas(canvas, PORT, PORT);
      if (!ctx) continue;
      const c = PORT / 2, r = 54;
      ctx.fillStyle = SPACE;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, TAU);
      ctx.fill();
      drawBody(ctx, id, c, c, r, sky, world);
      const pointer = (deg: number, color: string) => {
        const a = deg * DEG, x = c + (r + 11) * Math.cos(a), y = c - (r + 11) * Math.sin(a);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-a);
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-4, -5);
        ctx.lineTo(-4, 5);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      };
      if (id !== "sun") pointer(sky.sun.eclLon, "#ffd84a");
      if (id === "moon") pointer(sky.moon.eclLon + 180, "#7fc3ee");
      if (id === "earth") pointer(sky.moon.eclLon, "#d4d2c8");
    }
  });

  const parts = zoneParts(ms, UTC_ZONE);
  const doy = dayOfYear(parts.year, parts.month, parts.day);
  const nDays = daysInYear(parts.year);
  const minute = parts.hour * 60 + parts.minute;
  const setInstant = (next: number) => {
    setTouched(true);
    setMs(next);
  };
  const setUtc = (y: number, mo: number, d: number, h: number, mi: number) => setInstant(zoneToUtc(y, mo, d, h, mi, 0, UTC_ZONE));
  const view = (f: BodyId, zoom: number, mode?: "true" | "schematic") => {
    void setFocusParam(f === "earth" ? null : f);
    setPan({ x: 0, y: 0 });
    setKpp(zoom);
    if (mode) void setModeParam(mode === "true" ? null : mode);
  };
  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const cm = Number(modelCm);
  const model = cm > 0 ? scaleModel(modelRef, cm / 100, sky.sun.distanceKm, sky.moon.distanceKm) : null;
  const sunD = 2 * BODIES.sun.radiusKm, earthD = 2 * BODIES.earth.radiusKm, moonD = 2 * BODIES.moon.radiusKm;
  const zoomSlider = Math.round((Math.log(kmPerPx / KPP_MIN) / Math.log(KPP_MAX / KPP_MIN)) * 1000);
  // Earth–Moon strip, to scale.
  const stripPx = 650 / sky.moon.distanceKm;
  const stripEarth = BODIES.earth.radiusKm * stripPx, stripMoon = BODIES.moon.radiusKm * stripPx;
  const lightSeconds = sky.moon.distanceKm / C_KM_S;
  const cssMetres = (px: number) => (px * 0.0254) / 96;

  return (
    <div className="space-y-3">
      {/* view controls */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["true", "True scale"],
              ["schematic", "Schematic"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setModeParam(id === "true" ? null : id)} className={cn("h-7 rounded-[3px] px-3 text-[13px]", (real ? "true" : "schematic") === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">Show</span>
        <button type="button" onClick={() => view("sun", fit.orbit)} className={CHIP}>
          Whole orbit
        </button>
        <button type="button" onClick={() => view("earth", fit.pair)} className={CHIP}>
          Earth &amp; Moon
        </button>
        {IDS.map((id) => (
          <button key={id} type="button" onClick={() => view(id, fit.body(id))} className={cn(CHIP, focus === id && kmPerPx < fit.body(id) * 3 && "border-accent text-accent")}>
            {BODIES[id].name} close-up
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          Centre on
          {IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                void setFocusParam(id === "earth" ? null : id);
                setPan({ x: 0, y: 0 });
              }}
              className={cn("h-7 rounded-[var(--radius-sm)] px-2", focus === id ? "bg-accent-soft font-medium text-accent" : "hover:bg-raised hover:text-ink")}
            >
              {BODIES[id].name}
            </button>
          ))}
        </div>
      </div>

      {/* the scene */}
      <div className="panel p-3">
        <div ref={wrapRef} className="relative w-full select-none">
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height, touchAction: "none", cursor: "grab" }}
            className="block rounded-[var(--radius)]"
            role="img"
            aria-label="The Sun, Earth and Moon seen from above the plane of Earth's orbit"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              drag.current = { x: e.clientX, y: e.clientY, pan, pinch: pointers.current.size === 2 ? dist() : 0, kpp: kmPerPx };
            }}
            onPointerMove={(e) => {
              if (!pointers.current.has(e.pointerId)) return;
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              const d = drag.current;
              if (!d) return;
              if (pointers.current.size === 2 && d.pinch) setKpp(clamp((d.kpp * d.pinch) / Math.max(1, dist()), KPP_MIN, KPP_MAX));
              else if (pointers.current.size === 1) setPan({ x: d.pan.x - (e.clientX - d.x) * kmPerPx, y: d.pan.y + (e.clientY - d.y) * kmPerPx });
            }}
            onPointerUp={(e) => {
              pointers.current.delete(e.pointerId);
              if (pointers.current.size === 0) drag.current = null;
            }}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              drag.current = null;
            }}
          />
          <div className="absolute right-2 top-8 flex flex-col gap-1">
            <button type="button" onClick={() => setKpp(clamp(kmPerPx / 1.6, KPP_MIN, KPP_MAX))} aria-label="Zoom in" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-surface text-muted hover:text-ink">
              <Plus size={14} />
            </button>
            <button type="button" onClick={() => setKpp(clamp(kmPerPx * 1.6, KPP_MIN, KPP_MAX))} aria-label="Zoom out" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-surface text-muted hover:text-ink">
              <Minus size={14} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted">
          <label className="flex min-w-[220px] flex-1 items-center gap-2">
            Zoom
            <input type="range" min={0} max={1000} value={1000 - zoomSlider} onChange={(e) => setKpp(KPP_MIN * Math.exp(((1000 - Number(e.target.value)) / 1000) * Math.log(KPP_MAX / KPP_MIN)))} className={RANGE} aria-label="Zoom" />
          </label>
          {(
            [
              ["orbits", "Orbits"],
              ["labels", "Labels"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} className="accent-[var(--accent)]" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-faint">
          Seen from above the north pole of Earth&apos;s orbit, so everything turns counter-clockwise. Drag to pan · pinch or ⌘/Ctrl + scroll to zoom. In true scale a ring marks anything narrower than a couple of pixels — which, when the whole orbit is in view, is
          everything, even the Sun.
        </p>
      </div>

      {/* time */}
      <div className="panel space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPlaying((p) => !p)} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)]">
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause" : "Play"}
          </button>
          <select value={speedId} onChange={(e) => setSpeedId(e.target.value)} className={cn(INPUT, "pr-7")} aria-label="Speed">
            {SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setTouched(false);
              setPlaying(false);
              void setT(null);
              queueMicrotask(() => setMs(Date.now()));
            }}
            className={cn(CHIP, "h-8")}
          >
            Now
          </button>
          <div className="ml-auto text-right">
            <div className="font-mono text-[18px] leading-tight text-ink tabular">
              {fmtClock(ms, UTC_ZONE, true)} <span className="text-[12px] text-muted">UTC</span>
            </div>
            <div className="text-[12.5px] text-muted">{fmtDay(ms, UTC_ZONE)}</div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[12.5px] text-muted">Day of the year — one orbit of the Sun</div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous day" onClick={() => setInstant(ms - DAY_MS)} className={ICON_BTN}>
                <ChevronLeft size={14} />
              </button>
              <input type="range" min={1} max={nDays} value={doy} onChange={(e) => setUtc(parts.year, 1, Number(e.target.value), parts.hour, parts.minute)} className={RANGE} aria-label="Day of the year" />
              <button type="button" aria-label="Next day" onClick={() => setInstant(ms + DAY_MS)} className={ICON_BTN}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mx-9 mt-1 flex justify-between text-[10.5px] text-faint">
              {MONTHS.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[12.5px] text-muted">Time of day — one turn of the Earth</div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Back one hour" onClick={() => setInstant(ms - 3600000)} className={ICON_BTN}>
                <ChevronLeft size={14} />
              </button>
              <input type="range" min={0} max={1439} value={minute} onChange={(e) => setUtc(parts.year, parts.month, parts.day, Math.floor(Number(e.target.value) / 60), Number(e.target.value) % 60)} className={RANGE} aria-label="Time of day" />
              <button type="button" aria-label="Forward one hour" onClick={() => setInstant(ms + 3600000)} className={ICON_BTN}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="mx-9 mt-1 flex justify-between text-[10.5px] text-faint">
              {[0, 6, 12, 18, 24].map((h) => (
                <span key={h}>{String(h).padStart(2, "0")}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* rotation close-ups */}
      <div className="panel p-3">
        <span className="readout">How each one turns — magnified, same viewpoint</span>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["sun", `One turn in about ${BODIES.sun.rotationDays} days at the equator; the poles take about 35, because the Sun is gas, not solid.`],
              ["earth", `One turn in ${fmtPeriod(BODIES.earth.rotationDays)}. Noon to noon takes 24 h because Earth has also moved along its orbit. Yellow arrow: to the Sun; grey: to the Moon.`],
              ["moon", `One turn in ${fmtPeriod(BODIES.moon.rotationDays)} — exactly one per orbit, so the same face (the dark patches) always points at Earth, shown by the blue arrow.`],
            ] as [BodyId, string][]
          ).map(([id, text]) => (
            <div key={id} className="flex flex-col items-center gap-2 text-center">
              <canvas
                ref={(el) => {
                  portRefs.current[id] = el;
                }}
                style={{ width: PORT, height: PORT }}
                className="shrink-0 rounded-full"
                role="img"
                aria-label={`${BODIES[id].name} rotating`}
              />
              <div className="max-w-[280px] text-[12.5px] leading-relaxed text-muted">
                <div className="text-[14px] font-medium text-ink">{BODIES[id].name}</div>
                {text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* sizes */}
        <div className="panel p-3">
          <span className="readout">Sizes to scale</span>
          <svg viewBox="0 0 720 170" className="mt-2 w-full" role="img" aria-label="The Sun, Earth and Moon drawn at their true relative sizes">
            <defs>
              <radialGradient id="sm-sun" cx="100%" cy="50%" r="100%">
                <stop offset="0" stopColor="#ffcf4a" />
                <stop offset="1" stopColor="#f29a1f" />
              </radialGradient>
            </defs>
            <rect width="720" height="170" rx="6" fill={SPACE} />
            <circle cx={150 - 1092} cy={85} r={1092} fill="url(#sm-sun)" />
            <circle cx={300} cy={85} r={10} fill="#3f86ad" />
            <circle cx={420} cy={85} r={2.73} fill="#c9c6ba" />
            <g fontSize={12} fill="#e8ecf8" fontFamily="inherit">
              <text x={16} y={24} fontWeight={600} fill="#3a2500">
                Sun
              </text>
              <text x={16} y={40} fontSize={10.5} fill="#3a2500">
                {fmtKm(sunD)} wide
              </text>
              <text x={300} y={58} textAnchor="middle" fontWeight={600}>
                Earth
              </text>
              <text x={300} y={116} textAnchor="middle" fontSize={10.5}>
                {fmtKm(earthD)}
              </text>
              <text x={420} y={58} textAnchor="middle" fontWeight={600}>
                Moon
              </text>
              <text x={420} y={116} textAnchor="middle" fontSize={10.5}>
                {fmtKm(moonD)}
              </text>
            </g>
          </svg>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            The Sun is {(sunD / earthD).toFixed(0)} Earths wide — only a sliver of its edge fits here — and could hold about 1.3 million Earths. The Moon is {((moonD / earthD) * 100).toFixed(0)}% of Earth&apos;s width.
          </p>
        </div>

        {/* earth–moon distance */}
        <div className="panel p-3">
          <span className="readout">Earth to Moon, to scale — right now</span>
          <svg viewBox="0 0 720 100" className="mt-2 w-full" role="img" aria-label="Earth and Moon at their true relative sizes and separation">
            <rect width="720" height="100" rx="6" fill={SPACE} />
            {Array.from({ length: Math.floor(sky.moon.distanceKm / earthD) }, (_, i) => (
              <line key={i} x1={35 + (i + 1) * earthD * stripPx} x2={35 + (i + 1) * earthD * stripPx} y1={47} y2={53} stroke="rgba(232, 236, 248, 0.35)" />
            ))}
            <circle cx={35} cy={50} r={stripEarth} fill="#3f86ad" />
            <circle cx={685} cy={50} r={stripMoon} fill="#c9c6ba" />
            <circle r={2.2} cy={50} fill="#ffe27a">
              <animate attributeName="cx" values={`${35 + stripEarth};${685 - stripMoon};${35 + stripEarth}`} dur={`${(lightSeconds * 2).toFixed(2)}s`} repeatCount="indefinite" />
            </circle>
            <g fontSize={11} fill="#e8ecf8" fontFamily="inherit">
              <text x={35} y={22} textAnchor="middle" fontWeight={600}>
                Earth
              </text>
              <text x={685} y={22} textAnchor="middle" fontWeight={600}>
                Moon
              </text>
              <text x={360} y={84} textAnchor="middle" fontSize={10.5}>
                {fmtKm(sky.moon.distanceKm)} · {(sky.moon.distanceKm / earthD).toFixed(1)} Earth-widths · each tick is one Earth
              </text>
            </g>
          </svg>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            The yellow dot is light, moving at its real speed: {lightSeconds.toFixed(2)} s each way. On this same scale the Sun would be a disc {fmtLength(cssMetres(sunD * stripPx))} wide, about {fmtLength(cssMetres(sky.sun.distanceKm * stripPx))} off to the side of your screen
            — {(sky.sun.distanceKm / sky.moon.distanceKm).toFixed(0)} times farther than the Moon.
          </p>
        </div>

        {/* scale model */}
        <div className="panel space-y-3 p-3">
          <span className="readout">Build a scale model</span>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            If the
            <select value={modelRef} onChange={(e) => setModelRef(e.target.value as BodyId)} className={cn(INPUT, "pr-7")} aria-label="Reference body">
              {IDS.map((id) => (
                <option key={id} value={id}>
                  {BODIES[id].name}
                </option>
              ))}
            </select>
            were
            <input value={modelCm} onChange={(e) => setModelCm(e.target.value)} inputMode="decimal" className={cn(INPUT, "w-20 font-mono")} aria-label="Model diameter in centimetres" />
            cm wide…
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["Sun = 1 m ball", "sun", "100"],
                ["Sun = football", "sun", "22"],
                ["Earth = basketball", "earth", "24"],
                ["Earth = marble", "earth", "1.6"],
                ["Moon = pea", "moon", "0.8"],
              ] as [string, BodyId, string][]
            ).map(([label, id, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setModelRef(id);
                  setModelCm(value);
                }}
                className={CHIP}
              >
                {label}
              </button>
            ))}
          </div>
          {model ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              {(
                [
                  ["Sun", `${fmtLength(model.sunDiameter)} across`],
                  ["Earth", `${fmtLength(model.earthDiameter)} across, ${fmtLength(model.sunToEarth)} from the Sun`],
                  ["Moon", `${fmtLength(model.moonDiameter)} across, ${fmtLength(model.earthToMoon)} from the Earth`],
                  ["Light", `crawls at ${fmtLength(model.lightSpeed)} per second`],
                  ["Scale", `1 : ${Math.round(model.ratio * 1000).toLocaleString()}`],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-faint">{k}</dt>
                  <dd className="font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] text-muted">Enter a size in centimetres.</p>
          )}
        </div>

        {/* facts */}
        <div className="panel overflow-x-auto p-3">
          <span className="readout">The numbers</span>
          <table className="mt-2 w-full min-w-[420px] text-left text-[12.5px]">
            <thead className="text-faint">
              <tr>
                <th className="py-1 pr-3 font-normal"></th>
                <th className="py-1 pr-3 font-medium text-ink">Sun</th>
                <th className="py-1 pr-3 font-medium text-ink">Earth</th>
                <th className="py-1 font-medium text-ink">Moon</th>
              </tr>
            </thead>
            <tbody className="font-mono text-ink">
              {(
                [
                  ["Width", fmtKm(sunD), fmtKm(earthD), fmtKm(moonD)],
                  ["In Earths", `${(sunD / earthD).toFixed(1)}×`, "1×", `${(moonD / earthD).toFixed(2)}×`],
                  ["One turn", `~${BODIES.sun.rotationDays} days`, fmtPeriod(BODIES.earth.rotationDays), fmtPeriod(BODIES.moon.rotationDays)],
                  ["Axis tilt", `${BODIES.sun.tiltDeg}°`, `${BODIES.earth.tiltDeg}°`, `${BODIES.moon.tiltDeg}°`],
                  ["Equator speed", `${(BODIES.sun.equatorKmS * 3600).toFixed(0)} km/h`, `${(BODIES.earth.equatorKmS * 3600).toFixed(0)} km/h`, `${(BODIES.moon.equatorKmS * 3600).toFixed(1)} km/h`],
                  ["One orbit", "—", fmtPeriod(BODIES.earth.orbitDays ?? 0), `${fmtPeriod(BODIES.moon.orbitDays ?? 0)} (${SYNODIC_MONTH_DAYS.toFixed(2)} between full moons)`],
                  ["Orbit speed", "—", `${BODIES.earth.orbitKmS} km/s`, `${BODIES.moon.orbitKmS} km/s`],
                  ["Distance now", "—", `${fmtKm(sky.sun.distanceKm)} from the Sun`, `${fmtKm(sky.moon.distanceKm)} from Earth`],
                  ["Light takes", "—", lightTime(sky.sun.distanceKm), lightTime(sky.moon.distanceKm)],
                  ["Size in our sky", `${(sky.sun.diameterDeg * 60).toFixed(1)}′`, "—", `${(sky.moon.diameterDeg * 60).toFixed(1)}′`],
                ] as string[][]
              ).map(([k, ...cells]) => (
                <tr key={k} className="border-t border-edge">
                  <th className="py-1 pr-3 font-sans font-normal text-faint">{k}</th>
                  {cells.map((c, i) => (
                    <td key={i} className="py-1 pr-3 align-top">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            The Sun is {(sunD / moonD).toFixed(0)} times wider than the Moon and, right now, {(sky.sun.distanceKm / sky.moon.distanceKm).toFixed(0)} times farther away — so they look almost the same size in our sky, which is why total solar eclipses are possible. The Moon&apos;s
            orbit is tipped {MOON_ORBIT_INCLINATION}° from Earth&apos;s, which is why they don&apos;t happen every month.
          </p>
        </div>
      </div>
    </div>
  );
}
