"use client";

import { useEffect, useRef, useState } from "react";
import { geoArea, geoCentroid, geoCircle, geoContains, geoDistance, geoEquirectangular, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import type { Feature, MultiLineString, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { Minus, Plus } from "lucide-react";
import { norm180, type SubPoint } from "@/lib/tools/time/astro";

export interface Place {
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** IANA zone, or "" when unknown. */
  tz: string;
  popK: number;
  /** 1 capital · 2 alternate capital · 3 research station · 0 city · 4 a point picked on the globe. */
  kind: 0 | 1 | 2 | 3 | 4;
}

export interface GlobeView {
  lon: number;
  lat: number;
  zoom: number;
}

export interface GlobeLayers {
  countries: boolean;
  capitals: boolean;
  graticule: boolean;
  circles: boolean;
  twilight: boolean;
  moonZone: boolean;
}

type CountryFeature = Feature<Polygon | MultiPolygon, { name: string }>;

export interface World {
  countries: CountryFeature[];
  borders: MultiLineString;
  labels: { name: string; lon: number; lat: number; area: number }[];
}

/** Country shapes (Natural Earth 1:110m via world-atlas), loaded on demand. */
export async function loadWorld(): Promise<World> {
  const [{ default: raw }, { feature, mesh }] = await Promise.all([import("world-atlas/countries-110m.json"), import("topojson-client")]);
  const topology = raw as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const countries = feature(topology, topology.objects.countries).features as CountryFeature[];
  const borders = mesh(topology, topology.objects.countries, (a, b) => a !== b);
  const labels = countries
    .map((c) => {
      // Label the largest landmass, so France isn't labelled in the Atlantic because of French Guiana.
      let best: Polygon = c.geometry.type === "Polygon" ? c.geometry : { type: "Polygon", coordinates: c.geometry.coordinates[0] };
      if (c.geometry.type === "MultiPolygon") {
        let bestArea = -1;
        for (const coordinates of c.geometry.coordinates) {
          const poly: Polygon = { type: "Polygon", coordinates };
          const a = geoArea(poly);
          if (a > bestArea) {
            bestArea = a;
            best = poly;
          }
        }
      }
      const [lon, lat] = geoCentroid(best);
      return { name: c.properties.name, lon, lat, area: geoArea(best) };
    })
    .sort((a, b) => b.area - a.area);
  return { countries, borders, labels };
}

const OCEAN = "#3f86ad";
const LAND = "#a9c98a";
const NIGHT = "rgba(6, 10, 30, 0.2)";
const TROPIC = 23.44;
const POLAR = 66.56;
const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function parallel(lat: number): GeoPermissibleObjects {
  const coordinates: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 3) coordinates.push([lon, lat]);
  return { type: "LineString", coordinates };
}

export function countryAt(world: World, lon: number, lat: number): string | null {
  for (const c of world.countries) if (geoContains(c, [lon, lat])) return c.properties.name;
  return null;
}

interface GlobeProps {
  world: World | null;
  places: Place[];
  sun: SubPoint;
  moon: SubPoint;
  pin: Place | null;
  view: GlobeView;
  onView: (view: GlobeView, kind: "pan" | "zoom") => void;
  onPin: (place: Place) => void;
  projection: "globe" | "map";
  layers: GlobeLayers;
}

export function Globe({ world, places, sun, moon, pin, view, onView, onPin, projection, layers }: GlobeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projRef = useRef<GeoProjection | null>(null);
  const latest = useRef({ view, onView });
  const drag = useRef<{ x: number; y: number; view: GlobeView; moved: boolean; pinch: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const height = projection === "globe" ? width : Math.round(width / 2);

  useEffect(() => {
    latest.current = { view, onView };
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom with pinch or ⌘/Ctrl + scroll, so plain scrolling still moves the page.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { view: v, onView: cb } = latest.current;
      cb({ ...v, zoom: clamp(v.zoom * Math.exp(-e.deltaY * 0.01), 1, 12) }, "zoom");
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const globe = projection === "globe";
    const proj = globe
      ? geoOrthographic().translate([width / 2, height / 2]).scale((width / 2 - 8) * view.zoom).rotate([-view.lon, -view.lat]).clipAngle(90).precision(0.3)
      : geoEquirectangular().translate([width / 2, height / 2]).scale((width / (2 * Math.PI)) * view.zoom).rotate([-view.lon, 0]).center([0, view.zoom > 1 ? view.lat : 0]);
    projRef.current = proj;
    const path = geoPath(proj, ctx);
    const center: [number, number] = [view.lon, view.lat];
    const visible = (lon: number, lat: number) => !globe || geoDistance(center, [lon, lat]) < Math.PI / 2 - 0.04;
    const at = (lon: number, lat: number) => proj([lon, lat]);
    const stroke = (obj: GeoPermissibleObjects, color: string, lw: number, dash: number[] = []) => {
      ctx.beginPath();
      path(obj);
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const fill = (obj: GeoPermissibleObjects, color: string) => {
      ctx.beginPath();
      path(obj);
      ctx.fillStyle = color;
      ctx.fill();
    };

    if (globe) {
      const r = proj.scale();
      const halo = ctx.createRadialGradient(width / 2, height / 2, r * 0.96, width / 2, height / 2, r + 9);
      halo.addColorStop(0, "rgba(120, 190, 255, 0.45)");
      halo.addColorStop(1, "rgba(120, 190, 255, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, r + 9, 0, 2 * Math.PI);
      ctx.fill();
    }
    fill({ type: "Sphere" }, OCEAN);
    if (layers.graticule) stroke(geoGraticule10(), "rgba(255, 255, 255, 0.16)", 0.6);
    if (world) {
      ctx.beginPath();
      for (const c of world.countries) path(c);
      ctx.fillStyle = LAND;
      ctx.fill();
      ctx.strokeStyle = "rgba(40, 70, 50, 0.45)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      stroke(world.borders, "rgba(255, 255, 255, 0.7)", 0.6);
    }
    if (layers.circles) {
      stroke(parallel(0), "rgba(255, 255, 255, 0.75)", 1);
      for (const lat of [TROPIC, -TROPIC]) stroke(parallel(lat), "rgba(255, 196, 87, 0.95)", 1, [5, 4]);
      for (const lat of [POLAR, -POLAR]) stroke(parallel(lat), "rgba(150, 225, 255, 0.95)", 1, [5, 4]);
    }

    // Night side: stacked translucent caps centred on the anti-solar point give the twilight bands.
    const anti: [number, number] = [norm180(sun.lon + 180), -sun.lat];
    const caps = layers.twilight ? [90, 84, 78, 72] : [90];
    for (const radius of caps) fill(geoCircle().center(anti).radius(radius).precision(2)(), layers.twilight ? NIGHT : "rgba(6, 10, 30, 0.55)");
    stroke(geoCircle().center([sun.lon, sun.lat]).radius(90).precision(2)(), "rgba(255, 226, 140, 0.75)", 1);
    if (layers.moonZone) stroke(geoCircle().center([moon.lon, moon.lat]).radius(90).precision(2)(), "rgba(226, 232, 255, 0.9)", 1, [2, 4]);
    stroke({ type: "Sphere" }, "rgba(255, 255, 255, 0.4)", 1);

    // Labels: countries by size, then capitals by population, skipping anything that would overlap.
    const boxes: [number, number, number, number][] = [];
    const claim = (x: number, y: number, w: number, h: number) => {
      if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) return false;
      for (const b of boxes) if (x < b[2] && x + w > b[0] && y < b[3] && y + h > b[1]) return false;
      boxes.push([x, y, x + w, y + h]);
      return true;
    };
    const text = (label: string, x: number, y: number, font: string, color = "#ffffff") => {
      ctx.font = font;
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(12, 22, 34, 0.6)";
      ctx.strokeText(label, x, y);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
    };
    const sans = "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif";
    // A marker label goes to the right of its point, or to the left when it would run off the canvas.
    const sideLabel = (label: string, x: number, y: number, gap: number, font: string, color?: string) => {
      ctx.font = font;
      const w = ctx.measureText(label).width;
      ctx.textAlign = "left";
      text(label, x + gap + w > width - 4 ? x - gap - w : x + gap, y, font, color);
    };
    ctx.textBaseline = "middle";

    const dot = (x: number, y: number, r: number, color: string, ring: string) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // Pin first so its label always wins a spot.
    const pinXY = pin && visible(pin.lon, pin.lat) ? at(pin.lon, pin.lat) : null;
    if (pin && pinXY) {
      ctx.font = `600 12px ${sans}`;
      const w = ctx.measureText(pin.name).width;
      claim(pinXY[0] + 9, pinXY[1] - 9, w + 4, 18);
    }
    if (world && layers.countries) {
      ctx.textAlign = "center";
      for (const l of world.labels) {
        if (l.area * view.zoom * view.zoom < 0.012 || !visible(l.lon, l.lat)) continue;
        const p = at(l.lon, l.lat);
        if (!p) continue;
        ctx.font = `600 11px ${sans}`;
        const w = ctx.measureText(l.name).width;
        if (claim(p[0] - w / 2 - 2, p[1] - 7, w + 4, 14)) text(l.name, p[0], p[1], `600 11px ${sans}`);
      }
    }
    if (layers.capitals) {
      ctx.textAlign = "left";
      for (const c of places) {
        if (c.kind !== 1 && c.kind !== 2 && c.kind !== 3) continue;
        if (!visible(c.lon, c.lat)) continue;
        const p = at(c.lon, c.lat);
        if (!p) continue;
        dot(p[0], p[1], c.kind === 3 ? 1.6 : 2, c.kind === 3 ? "#bfe9ff" : "#ffffff", "rgba(20, 30, 40, 0.8)");
        if (pin && c.name === pin.name) continue;
        if (view.zoom >= 2.4 || (c.popK >= 5000 && view.zoom >= 1.4)) {
          ctx.font = `10.5px ${sans}`;
          const w = ctx.measureText(c.name).width;
          if (claim(p[0] + 4, p[1] - 6, w + 3, 12)) text(c.name, p[0] + 5, p[1], `10.5px ${sans}`, "#f3f6f8");
        }
      }
    }

    // Sun and Moon overhead points.
    ctx.textAlign = "left";
    if (visible(moon.lon, moon.lat)) {
      const p = at(moon.lon, moon.lat);
      if (p) {
        dot(p[0], p[1], 6, "#e9e7dc", "rgba(30, 30, 40, 0.9)");
        sideLabel("Moon overhead", p[0], p[1], 10, `10.5px ${sans}`, "#e9ecf7");
      }
    }
    if (visible(sun.lon, sun.lat)) {
      const p = at(sun.lon, sun.lat);
      if (p) {
        const g = ctx.createRadialGradient(p[0], p[1], 2, p[0], p[1], 18);
        g.addColorStop(0, "rgba(255, 238, 150, 0.95)");
        g.addColorStop(1, "rgba(255, 205, 70, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 18, 0, 2 * Math.PI);
        ctx.fill();
        dot(p[0], p[1], 6, "#ffd84a", "#a86a12");
        sideLabel("Sun overhead", p[0], p[1], 11, `10.5px ${sans}`, "#fff3c4");
      }
    }
    if (layers.circles) {
      ctx.textAlign = "left";
      const lon = view.lon;
      const tag = (lat: number, label: string, color: string) => {
        if (!visible(lon, lat)) return;
        const p = at(lon, lat);
        if (p) text(label, p[0] + 4, p[1] - 7, `10px ${sans}`, color);
      };
      tag(TROPIC, "Tropic of Cancer", "#ffd28a");
      tag(-TROPIC, "Tropic of Capricorn", "#ffd28a");
      tag(POLAR, "Arctic Circle", "#bfeaff");
      tag(-POLAR, "Antarctic Circle", "#bfeaff");
      tag(0, "Equator", "#ffffff");
    }
    if (pin && pinXY) {
      ctx.beginPath();
      ctx.arc(pinXY[0], pinXY[1], 7, 0, 2 * Math.PI);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = "#e5484d";
      ctx.lineWidth = 2;
      ctx.stroke();
      dot(pinXY[0], pinXY[1], 2.5, "#e5484d", "#ffffff");
      sideLabel(pin.name, pinXY[0], pinXY[1], 11, `600 12px ${sans}`);
    }
  }, [world, places, sun.lat, sun.lon, moon.lat, moon.lon, pin, view.lon, view.lat, view.zoom, projection, layers, width, height]);

  function locate(clientX: number, clientY: number): { lon: number; lat: number; x: number; y: number } | null {
    const canvas = canvasRef.current, proj = projRef.current;
    if (!canvas || !proj?.invert) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    if (projection === "globe" && Math.hypot(x - width / 2, y - height / 2) > proj.scale()) return null;
    const ll = proj.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1]) || Math.abs(ll[1]) > 90) return null;
    return { lon: norm180(ll[0]), lat: ll[1], x, y };
  }

  function nearestCapital(x: number, y: number): Place | null {
    const proj = projRef.current;
    if (!proj) return null;
    let best: Place | null = null, bestD = 10;
    for (const c of places) {
      if (c.kind !== 1 && c.kind !== 2 && c.kind !== 3) continue;
      if (projection === "globe" && geoDistance([view.lon, view.lat], [c.lon, c.lat]) > Math.PI / 2 - 0.04) continue;
      const p = proj([c.lon, c.lat]);
      if (!p) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: height || undefined, touchAction: "none", cursor: "grab" }}
        className="block rounded-[var(--radius)]"
        role="img"
        aria-label="Globe showing day and night, the Sun and Moon overhead points, countries and capitals"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          drag.current = { x: e.clientX, y: e.clientY, view, moved: pointers.current.size > 1, pinch: pointers.current.size === 2 ? dist() : 0 };
          setTip(null);
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const d = drag.current;
          if (d && pointers.current.size === 2 && d.pinch) {
            d.moved = true;
            onView({ ...view, zoom: clamp((d.view.zoom * dist()) / d.pinch, 1, 12) }, "zoom");
            return;
          }
          if (d && pointers.current.size === 1) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            if (d.moved) {
              const k = 1 / DEG / (projRef.current?.scale() ?? 200);
              onView({ lon: norm180(d.view.lon - dx * k), lat: clamp(d.view.lat + dy * k, -90, 90), zoom: view.zoom }, "pan");
            }
            return;
          }
          const hit = locate(e.clientX, e.clientY);
          if (!hit) {
            setTip(null);
            return;
          }
          const cap = nearestCapital(hit.x, hit.y);
          const country = world ? countryAt(world, hit.lon, hit.lat) : null;
          const where = cap ? `${cap.name}${cap.kind === 3 ? "" : ` — ${cap.kind === 0 ? "" : "capital of "}${cap.country}`}` : (country ?? "Ocean");
          setTip({ x: hit.x, y: hit.y, text: `${where} · ${Math.abs(hit.lat).toFixed(1)}°${hit.lat >= 0 ? "N" : "S"} ${Math.abs(hit.lon).toFixed(1)}°${hit.lon >= 0 ? "E" : "W"}` });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          pointers.current.delete(e.pointerId);
          if (pointers.current.size === 0) drag.current = null;
          if (!d || d.moved) return;
          const hit = locate(e.clientX, e.clientY);
          if (!hit) return;
          const cap = nearestCapital(hit.x, hit.y);
          if (cap) onPin(cap);
          else {
            const country = world ? countryAt(world, hit.lon, hit.lat) : null;
            onPin({ name: country ? `Point in ${country}` : "Point at sea", country: country ?? "", lat: Math.round(hit.lat * 100) / 100, lon: Math.round(hit.lon * 100) / 100, tz: "", popK: 0, kind: 4 });
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          drag.current = null;
        }}
        onPointerLeave={() => setTip(null)}
      />
      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-[240px] rounded-[var(--radius-sm)] bg-ink px-2 py-1 text-[12px] text-canvas shadow-pop" style={{ left: Math.min(tip.x + 12, Math.max(0, width - 240)), top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button type="button" onClick={() => onView({ ...view, zoom: clamp(view.zoom * 1.5, 1, 12) }, "zoom")} aria-label="Zoom in" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-surface text-muted hover:text-ink">
          <Plus size={14} />
        </button>
        <button type="button" onClick={() => onView({ ...view, zoom: clamp(view.zoom / 1.5, 1, 12) }, "zoom")} aria-label="Zoom out" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-surface text-muted hover:text-ink">
          <Minus size={14} />
        </button>
      </div>
    </div>
  );
}
