"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsFloat, parseAsString } from "nuqs";
import { ChevronLeft, ChevronRight, LocateFixed, Pause, Play } from "lucide-react";
import { PLACES } from "@/lib/tools/time/places";
import { altitudeSeries, compass, dayEvents, localAt, norm180, seasonAt, seasonsOf, skyAt, upcomingEvents, upcomingPhases, yearSeries, type Light } from "@/lib/tools/time/astro";
import { DAY_MS, MONTHS, UTC_ZONE, dayOfYear, daysInYear, fmtClock, fmtDateTime, fmtDay, fmtSpan, longitudeZone, zoneName, zoneOffsetMin, zoneParts, zoneToUtc, type Zone } from "@/lib/tools/time/zone";
import { Globe, countryAt, loadWorld, type GlobeLayers, type GlobeView, type Place, type World } from "./esm-globe";
import { DayChart, MoonDisk, OrbitDiagram, SkyDome, YearChart, localDate, type SkyPath } from "./esm-panels";
import { cn } from "@/lib/utils";

const ALL: Place[] = PLACES.map(([name, country, lat, lon, tz, popK, kind]) => ({ name, country, lat, lon, tz, popK, kind }));
const TOKYO = ALL.find((p) => p.name === "Tokyo") ?? ALL[0];
const optionLabel = (p: Place) => `${p.name}, ${p.country}`;
const BY_LABEL = new Map(ALL.map((p) => [optionLabel(p).toLowerCase(), p]));

const SPEEDS = [
  { id: "1", label: "Real time", rate: 1, step: false },
  { id: "60", label: "1 minute / s", rate: 60, step: false },
  { id: "600", label: "10 minutes / s", rate: 600, step: false },
  { id: "3600", label: "1 hour / s", rate: 3600, step: false },
  { id: "21600", label: "6 hours / s", rate: 21600, step: false },
  { id: "86400", label: "1 day / s (spinning)", rate: 86400, step: false },
  { id: "d5", label: "5 days / s · same clock time", rate: 5 * 86400, step: true },
  { id: "d30", label: "30 days / s · same clock time", rate: 30 * 86400, step: true },
];

const FOLLOWS = [
  ["free", "Free"],
  ["pin", "Pin"],
  ["sun", "From the Sun"],
  ["sunrise", "Sunrise line"],
  ["moon", "From the Moon"],
  ["north", "North pole"],
  ["south", "South pole"],
] as const;
type Follow = (typeof FOLLOWS)[number][0];

const LIGHT_LABEL: Record<Light, string> = { day: "Daylight", civil: "Civil twilight", nautical: "Nautical twilight", astronomical: "Astronomical twilight", night: "Night" };
const LIGHT_TONE: Record<Light, string> = {
  day: "bg-[#ffe08a] text-[#4d3400]",
  civil: "bg-[#f3b27a] text-[#452200]",
  nautical: "bg-[#6f84c4] text-white",
  astronomical: "bg-[#3b4a8a] text-white",
  night: "bg-[#161d45] text-white",
};
const LIGHT_STRIP = ["#161d45", "#3b4a8a", "#6f84c4", "#f3b27a", "#ffe08a"];
const stripIndex = (alt: number) => (alt > -0.833 ? 4 : alt > -6 ? 3 : alt > -12 ? 2 : alt > -18 ? 1 : 0);

const INPUT = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const CHIP = "h-7 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent";
const RANGE = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]";
const ICON_BTN = "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent";

const deg = (n: number, d = 1) => `${n.toFixed(d)}°`;
const latLon = (lat: number, lon: number, d = 2) => `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(d)}°${lon >= 0 ? "E" : "W"}`;
const until = (from: number, to: number) => {
  const d = (to - from) / DAY_MS;
  return d < 1 ? `${Math.max(0, Math.round(d * 24))} h` : `${Math.round(d)} days`;
};

function readInitial(): { ms: number | null; pin: Place } {
  if (typeof window === "undefined") return { ms: null, pin: TOKYO };
  const q = new URLSearchParams(window.location.search);
  const parsed = q.get("t") ? Date.parse(q.get("t")!) : NaN;
  const name = q.get("p");
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  let pin = name ? ALL.find((p) => p.name === name) : undefined;
  if (!pin && q.has("lat") && q.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) {
    pin = { name: name || "Pinned point", country: "", lat, lon: norm180(lon), tz: "", popK: 0, kind: 4 };
  }
  return { ms: Number.isFinite(parsed) ? parsed : null, pin: pin ?? TOKYO };
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EarthSunMoonWidget() {
  const [initial] = useState(readInitial);
  const [ms, setMs] = useState<number | null>(initial.ms);
  const [touched, setTouched] = useState(initial.ms !== null);
  const [pin, setPin] = useState<Place>(initial.pin);
  const [query, setQuery] = useState(initial.pin.kind === 4 ? "" : optionLabel(initial.pin));
  const [playing, setPlaying] = useState(false);
  const [speedId, setSpeedId] = useState("3600");
  const [world, setWorld] = useState<World | null>(null);
  const [view, setView] = useState<GlobeView>({ lon: initial.pin.lon, lat: Math.max(-50, Math.min(50, initial.pin.lat)), zoom: 1 });
  const [layers, setLayers] = useState<GlobeLayers>({ countries: true, capitals: true, graticule: true, circles: true, twilight: true, moonZone: false });
  const [geoError, setGeoError] = useState<string | null>(null);
  const [browserTz] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });

  const [, setT] = useQueryState("t", parseAsString.withOptions({ history: "replace", throttleMs: 500 }));
  const [, setP] = useQueryState("p", parseAsString.withOptions({ history: "replace" }));
  const [, setLatParam] = useQueryState("lat", parseAsFloat.withOptions({ history: "replace" }));
  const [, setLonParam] = useQueryState("lon", parseAsFloat.withOptions({ history: "replace" }));
  const [zoneMode, setZoneMode] = useQueryState("z", parseAsString.withDefault("pin").withOptions({ history: "replace" }));
  const [followParam, setFollow] = useQueryState("f", parseAsString.withDefault("free").withOptions({ history: "replace" }));
  const [projParam, setProj] = useQueryState("proj", parseAsString.withDefault("globe").withOptions({ history: "replace" }));
  const follow = (FOLLOWS.some(([id]) => id === followParam) ? followParam : "free") as Follow;
  const projection = projParam === "map" ? "map" : "globe";
  const speed = SPEEDS.find((s) => s.id === speedId) ?? SPEEDS[3];

  // Start at the current moment unless the link carried a time.
  useEffect(() => {
    if (ms !== null) return;
    let active = true;
    queueMicrotask(() => active && setMs(Date.now()));
    return () => {
      active = false;
    };
  }, [ms]);

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
    if (!playing) return;
    let raf = 0, last: number | null = null, acc = 0;
    const tick = (now: number) => {
      if (last !== null) {
        const dt = Math.min(1, (now - last) / 1000);
        if (speed.step) {
          acc += (dt * speed.rate) / 86400;
          const whole = Math.floor(acc);
          if (whole) {
            acc -= whole;
            setMs((m) => (m ?? 0) + whole * DAY_MS);
          }
        } else setMs((m) => (m ?? 0) + dt * 1000 * speed.rate);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed.rate, speed.step]);

  // Keep the link shareable: time once the user has moved it, and the pinned place.
  useEffect(() => {
    if (ms === null || playing || !touched) return;
    void setT(`${new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)}Z`);
  }, [ms, playing, touched, setT]);
  useEffect(() => {
    if (pin.kind === 4) {
      void setP(pin.name === "My location" ? pin.name : null);
      void setLatParam(pin.lat);
      void setLonParam(pin.lon);
    } else {
      void setP(pin.name === "Tokyo" ? null : pin.name);
      void setLatParam(null);
      void setLonParam(null);
    }
  }, [pin, setP, setLatParam, setLonParam]);

  const now = ms ?? 0;
  const zone: Zone = useMemo(
    () => (zoneMode === "utc" ? UTC_ZONE : zoneMode === "local" ? { kind: "iana", tz: browserTz } : pin.tz ? { kind: "iana", tz: pin.tz } : longitudeZone(pin.lon)),
    [zoneMode, browserTz, pin.tz, pin.lon],
  );
  const parts = zoneParts(now, zone);
  const dayStart = zoneToUtc(parts.year, parts.month, parts.day, 0, 0, 0, zone);
  const doy = dayOfYear(parts.year, parts.month, parts.day);
  const nDays = daysInYear(parts.year);
  const minute = parts.hour * 60 + parts.minute;

  const sky = useMemo(() => skyAt(now), [now]);
  const local = useMemo(() => localAt(now, pin.lat, pin.lon), [now, pin.lat, pin.lon]);
  const events = useMemo(() => dayEvents(dayStart, pin.lat, pin.lon), [dayStart, pin.lat, pin.lon]);
  const series = useMemo(() => altitudeSeries(dayStart, pin.lat, pin.lon, 10), [dayStart, pin.lat, pin.lon]);
  const year = useMemo(() => yearSeries(parts.year, pin.lat, pin.lon), [parts.year, pin.lat, pin.lon]);
  const offsets = useMemo(() => year.map((d) => zoneOffsetMin(d.utcMidnight + 12 * 3600000, zone)), [year, zone]);
  const seasonDates = useMemo(() => seasonsOf(parts.year), [parts.year]);
  const season = useMemo(() => seasonAt(dayStart + DAY_MS - 1, pin.lat), [dayStart, pin.lat]);
  const phases = useMemo(() => upcomingPhases(dayStart, 4), [dayStart]);
  const upcoming = useMemo(() => upcomingEvents(dayStart), [dayStart]);
  const monthAngles = useMemo(() => Array.from({ length: 12 }, (_, m) => skyAt(Date.UTC(parts.year, m, 1)).sun.eclLon), [parts.year]);
  const seasonList = useMemo(
    () =>
      [
        ["Mar equinox", seasonDates.marEquinox],
        ["Jun solstice", seasonDates.junSolstice],
        ["Sep equinox", seasonDates.sepEquinox],
        ["Dec solstice", seasonDates.decSolstice],
      ] as [string, number][],
    [seasonDates],
  );
  const referencePaths: SkyPath[] = useMemo(() => {
    const colors = ["#9aa3ad", "#e2713a", "#9aa3ad", "#4b8fd6"];
    return seasonList
      .filter((_, i) => i !== 2)
      .map(([label, at], i) => {
        const p = zoneParts(at, zone);
        const s = altitudeSeries(zoneToUtc(p.year, p.month, p.day, 0, 0, 0, zone), pin.lat, pin.lon, 15, false);
        return { label, color: colors[i === 2 ? 3 : i], dash: "3 3", alt: s.sunAlt, az: s.sunAz };
      });
  }, [seasonList, zone, pin.lat, pin.lon]);

  if (ms === null) return <div className="panel p-6 text-[13.5px] text-muted">Setting the clock…</div>;

  const setInstant = (next: number, stop = true) => {
    setTouched(true);
    setMs(next);
    if (stop) setPlaying(false);
  };
  const setLocal = (y: number, mo: number, d: number, h: number, mi: number) => setInstant(zoneToUtc(y, mo, d, h, mi, 0, zone), false);
  const selectPlace = (p: Place, center: boolean) => {
    setPin(p);
    setQuery(p.kind === 4 ? "" : optionLabel(p));
    if (center && follow !== "pin") {
      void setFollow(null);
      setView((v) => ({ lon: p.lon, lat: Math.max(-60, Math.min(60, p.lat)), zoom: v.zoom }));
    }
  };

  const base = { zoom: view.zoom };
  const shown: GlobeView =
    follow === "pin"
      ? { lon: pin.lon, lat: pin.lat, ...base }
      : follow === "sun"
        ? { lon: sky.sun.lon, lat: sky.sun.lat, ...base }
        : follow === "sunrise"
          ? { lon: norm180(sky.sun.lon - 90), lat: 0, ...base }
          : follow === "moon"
            ? { lon: sky.moon.lon, lat: sky.moon.lat, ...base }
            : follow === "north"
              ? { lon: view.lon, lat: 90, ...base }
              : follow === "south"
                ? { lon: view.lon, lat: -90, ...base }
                : view;

  const dayIndex = doy - 1;
  const lengthDelta = dayIndex > 0 && year[dayIndex] ? (year[dayIndex].dayLengthHours - year[dayIndex - 1].dayLengthHours) * 3600 : null;
  const sunOver = world ? countryAt(world, sky.sun.lon, sky.sun.lat) : null;
  const moonOver = world ? countryAt(world, sky.moon.lon, sky.moon.lat) : null;
  const moonUp = local.moon.alt > 0;
  const moonNote = moonUp
    ? sky.moon.fraction < 0.02
      ? "Up, but lost in the Sun's glare (new moon)"
      : local.light === "day"
        ? "Up in daylight — look for a pale disk"
        : "Up in a dark sky — easy to see"
    : events.moonrise !== null && events.moonrise > ms
      ? `Below the horizon — rises ${fmtClock(events.moonrise, zone)}`
      : "Below the horizon";
  const zoneText = zoneMode === "pin" && !pin.tz ? `${zoneName(ms, zone)} (by longitude)` : zone.kind === "iana" ? `${zone.tz.replace(/_/g, " ")} · ${zoneName(ms, zone)}` : zoneName(ms, zone);
  const jump = (label: string, at: number | null) =>
    at !== null && (
      <button key={label} type="button" onClick={() => setInstant(at)} className={CHIP}>
        {label}
      </button>
    );
  const minAlt = Math.min(...series.sunAlt), maxAlt = Math.max(...series.sunAlt);
  const twilight = (dawn: number | null, dusk: number | null, limit: number) =>
    dawn !== null || dusk !== null ? `${fmtClock(dawn, zone)} – ${fmtClock(dusk, zone)}` : minAlt > limit ? "all night — it never gets this dark" : maxAlt < limit ? "none — it never gets this bright" : "—";
  const noonAlt = events.noonAltitude ?? 0;
  const todayPath: SkyPath = { label: "today", color: "#e8a013", alt: series.sunAlt, az: series.sunAz };
  const moonPath: SkyPath = { label: "moon", color: "#8b97b5", alt: series.moonAlt, az: series.moonAz };

  return (
    <div className="space-y-3">
      {/* place */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <input
          list="esm-places"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            const p = BY_LABEL.get(e.target.value.trim().toLowerCase());
            if (p) selectPlace(p, true);
          }}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="Pin a capital or city…"
          aria-label="Pin a place"
          className={cn(INPUT, "w-full sm:w-64")}
        />
        <datalist id="esm-places">
          {ALL.map((p) => (
            <option key={optionLabel(p)} value={optionLabel(p)} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => {
            setGeoError(null);
            if (!navigator.geolocation) return setGeoError("Location isn't available in this browser.");
            navigator.geolocation.getCurrentPosition(
              (pos) => selectPlace({ name: "My location", country: "", lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100, tz: browserTz, popK: 0, kind: 4 }, true),
              () => setGeoError("Couldn't get your location."),
            );
          }}
          className={cn(CHIP, "inline-flex h-8 items-center gap-1.5")}
        >
          <LocateFixed size={13} /> My location
        </button>
        <span className="text-[12.5px] text-muted">
          <span className="font-medium text-ink">{pin.name}</span>
          {pin.country && pin.kind !== 4 ? `, ${pin.country}` : ""} · {latLon(pin.lat, pin.lon)}
        </span>
        {geoError && <span className="text-[12.5px] text-danger">{geoError}</span>}
        <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
          Clock
          <select value={zoneMode} onChange={(e) => setZoneMode(e.target.value === "pin" ? null : e.target.value)} className={cn(INPUT, "pr-7")}>
            <option value="pin">{pin.name} time</option>
            <option value="utc">UTC</option>
            <option value="local">My time zone</option>
          </select>
        </label>
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
            <div className="font-mono text-[20px] leading-tight text-ink tabular">
              {fmtClock(ms, zone, true)} <span className="text-[12px] text-muted">{zoneText}</span>
            </div>
            <div className="text-[12.5px] text-muted">
              {fmtDay(ms, zone)} · day {doy} of {nDays}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-[12.5px] text-muted">
            <span>Day of the year — slide to move through the seasons</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                value={parts.year}
                min={1900}
                max={2100}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (y >= 1 && y <= 9999) setLocal(y, parts.month, parts.day, parts.hour, parts.minute);
                }}
                aria-label="Year"
                className={cn(INPUT, "h-7 w-[72px] font-mono text-[12.5px]")}
              />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous day" onClick={() => setLocal(parts.year, parts.month, parts.day - 1, parts.hour, parts.minute)} className={ICON_BTN}>
              <ChevronLeft size={14} />
            </button>
            <input type="range" min={1} max={nDays} value={doy} onChange={(e) => setLocal(parts.year, 1, Number(e.target.value), parts.hour, parts.minute)} className={RANGE} aria-label="Day of the year" />
            <button type="button" aria-label="Next day" onClick={() => setLocal(parts.year, parts.month, parts.day + 1, parts.hour, parts.minute)} className={ICON_BTN}>
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
          <div className="mb-1 text-[12.5px] text-muted">Time of day — slide to turn the Earth</div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Back one hour" onClick={() => setInstant(ms - 3600000, false)} className={ICON_BTN}>
              <ChevronLeft size={14} />
            </button>
            <div className="w-full">
              <input type="range" min={0} max={1439} value={minute} onChange={(e) => setLocal(parts.year, parts.month, parts.day, Math.floor(Number(e.target.value) / 60), Number(e.target.value) % 60)} className={RANGE} aria-label="Time of day" />
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
                {series.sunAlt.slice(0, -1).map((alt, i) => (
                  <span key={i} className="flex-1" style={{ backgroundColor: LIGHT_STRIP[stripIndex(alt)] }} />
                ))}
              </div>
            </div>
            <button type="button" aria-label="Forward one hour" onClick={() => setInstant(ms + 3600000, false)} className={ICON_BTN}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="mx-9 mt-1 flex justify-between text-[10.5px] text-faint">
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
              <span key={h}>{String(h).padStart(2, "0")}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-faint">Jump to</span>
          {jump("Sunrise", events.sunrise)}
          {jump("Solar noon", events.solarNoon)}
          {jump("Sunset", events.sunset)}
          {jump("Moonrise", events.moonrise)}
          {seasonList.map(([label, at]) => jump(label, at))}
          {jump(`Next ${phases.find((p) => p.name === "Full Moon") ? "full moon" : "phase"}`, phases.find((p) => p.name === "Full Moon")?.ms ?? null)}
          {jump("Next new moon", phases.find((p) => p.name === "New Moon")?.ms ?? null)}
        </div>
      </div>

      {/* globe + readouts */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="panel p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
              {(["globe", "map"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setProj(p === "globe" ? null : p)} className={cn("h-6 rounded-[3px] px-2.5 text-[12px] capitalize", projection === p ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}>
                  {p}
                </button>
              ))}
            </div>
            <span className="ml-1 text-[12px] text-faint">View</span>
            {FOLLOWS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setFollow(id === "free" ? null : id)} className={cn("h-7 rounded-[var(--radius-sm)] px-2 text-[12px]", follow === id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink")}>
                {label}
              </button>
            ))}
          </div>
          <Globe
            world={world}
            places={ALL}
            sun={sky.sun}
            moon={sky.moon}
            pin={pin}
            view={shown}
            projection={projection}
            layers={layers}
            onView={(v, kind) => {
              if (kind === "pan") {
                void setFollow(null);
                setView(v);
              } else setView((prev) => ({ ...prev, zoom: v.zoom }));
            }}
            onPin={(p) => selectPlace(p, false)}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
            {(
              [
                ["countries", "Country names"],
                ["capitals", "Capitals"],
                ["circles", "Equator, tropics & polar circles"],
                ["twilight", "Twilight bands"],
                ["moonZone", "Where the Moon is up"],
                ["graticule", "Grid"],
              ] as [keyof GlobeLayers, string][]
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers((l) => ({ ...l, [k]: e.target.checked }))} className="accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-faint">Drag to turn the globe · pinch or ⌘/Ctrl + scroll to zoom · click a country or a capital to pin it. The bright line is sunrise and sunset; each darker band is a deeper twilight.</p>
        </div>

        <div className="space-y-3">
          <div className="panel p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-ink">{pin.name}</div>
                <div className="text-[12.5px] text-muted">
                  {pin.kind === 1 ? `Capital of ${pin.country}` : pin.kind === 2 ? `A capital of ${pin.country}` : pin.kind === 3 ? "Research station, Antarctica" : pin.country || "Custom point"} · {fmtClock(ms, zone)} {zoneName(ms, zone)}
                </div>
              </div>
              <span className={cn("shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium", LIGHT_TONE[local.light])}>{LIGHT_LABEL[local.light]}</span>
            </div>
            <div className="mt-2">
              <KV
                rows={[
                  ["Sun", `${deg(Math.abs(local.sun.alt))} ${local.sun.alt >= 0 ? "above" : "below"} the horizon, toward ${compass(local.sun.az)} (${deg(local.sun.az, 0)})`],
                  ["Moon", moonNote],
                  ["Daylight today", events.polar === "day" ? "24 h — midnight sun" : events.polar === "night" ? "0 h — polar night" : fmtSpan(events.dayLengthMs)],
                  ["Season", `${season.season} (${season.hemisphere} hemisphere)`],
                ]}
              />
            </div>
          </div>

          <div className="panel p-3">
            <span className="readout">Sun</span>
            <div className="mt-2">
              <KV
                rows={[
                  ["Sunrise · sunset", events.polar ? (events.polar === "day" ? "Sun stays up all day" : "Sun stays down all day") : `${fmtClock(events.sunrise, zone)} · ${fmtClock(events.sunset, zone)}`],
                  ["Solar noon", events.solarNoon !== null ? `${fmtClock(events.solarNoon, zone)} · Sun ${noonAlt >= 0 ? `${deg(noonAlt)} high` : `${deg(-noonAlt)} below the horizon`}` : "—"],
                  [
                    "Day length",
                    <span key="len">
                      {fmtSpan(events.dayLengthMs)}
                      {lengthDelta !== null && Math.abs(lengthDelta) >= 1 && (
                        <span className="text-muted">
                          {" "}
                          ({lengthDelta > 0 ? "+" : "−"}
                          {Math.floor(Math.abs(lengthDelta) / 60)} min {Math.round(Math.abs(lengthDelta) % 60)} s vs yesterday)
                        </span>
                      )}
                    </span>,
                  ],
                  ["Civil twilight", twilight(events.civilDawn, events.civilDusk, -6)],
                  ["Nautical twilight", twilight(events.nauticalDawn, events.nauticalDusk, -12)],
                  ["Astronomical twilight", twilight(events.astroDawn, events.astroDusk, -18)],
                  ["Shadow of a 1 m stick", local.shadow !== null ? `${local.shadow.toFixed(2)} m, pointing ${compass(local.sun.az + 180)}` : "no shadow — Sun is down"],
                  ["Overhead at", `${latLon(sky.sun.lat, sky.sun.lon, 1)}${sunOver ? ` — ${sunOver}` : ""}`],
                  ["Declination", `${deg(sky.sun.dec, 2)} (the latitude where the Sun is overhead)`],
                  ["Equation of time", `${sky.sun.equationOfTimeMin >= 0 ? "+" : "−"}${Math.abs(sky.sun.equationOfTimeMin).toFixed(1)} min (sundial ${sky.sun.equationOfTimeMin >= 0 ? "ahead of" : "behind"} the clock)`],
                  ["Distance", `${(sky.sun.distanceKm / 1e6).toFixed(2)} million km (${sky.sun.distanceAu.toFixed(4)} AU) · light takes ${Math.floor(sky.sun.distanceKm / 299792.458 / 60)} min ${Math.round((sky.sun.distanceKm / 299792.458) % 60)} s`],
                  ["Apparent size", `${(sky.sun.diameterDeg * 60).toFixed(1)} arc-minutes`],
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <span className="readout">Moon</span>
          <div className="mt-2 flex flex-wrap items-start gap-4">
            <div className="flex flex-col items-center gap-1">
              <MoonDisk fraction={sky.moon.fraction} angle={local.moon.brightLimbZenith} size={104} dim={!moonUp} />
              <span className="text-[11px] text-faint">as seen from {pin.name}</span>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="text-[15px] font-medium text-ink">
                {sky.moon.phaseName} · {(sky.moon.fraction * 100).toFixed(0)}% lit
              </div>
              <div className="mb-2 text-[12.5px] text-muted">
                {sky.moon.ageDays.toFixed(1)} days into the cycle, {sky.moon.waxing ? "waxing" : "waning"}
              </div>
              <KV
                rows={[
                  ["Now", `${deg(Math.abs(local.moon.alt))} ${moonUp ? "above" : "below"} the horizon, toward ${compass(local.moon.az)} (${deg(local.moon.az, 0)})`],
                  ["Visibility", moonNote],
                  ["Rise · set", `${fmtClock(events.moonrise, zone)} · ${fmtClock(events.moonset, zone)}`],
                  ["Highest", events.moonTransit !== null ? `${fmtClock(events.moonTransit, zone)} at ${deg(events.moonTransitAltitude ?? 0)}` : "—"],
                  ["Distance", `${Math.round(sky.moon.distanceKm).toLocaleString()} km · ${(sky.moon.diameterDeg * 60).toFixed(1)}′ across`],
                  ["Overhead at", `${latLon(sky.moon.lat, sky.moon.lon, 1)}${moonOver ? ` — ${moonOver}` : ""}`],
                  ["Next", `${upcoming.apsis.kind} on ${localDate(upcoming.apsis.ms, zone)} (${Math.round(upcoming.apsis.distanceKm).toLocaleString()} km)`],
                ]}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-x-4 gap-y-1 border-t border-edge pt-2 text-[12.5px] sm:grid-cols-2">
            {phases.map((p) => (
              <button key={p.ms} type="button" onClick={() => setInstant(p.ms)} className="flex justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left text-muted hover:bg-raised hover:text-ink">
                <span>{p.name}</span>
                <span className="font-mono">{fmtDateTime(p.ms, zone)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setInstant(upcoming.lunarEclipse.ms)} className="flex justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left text-muted hover:bg-raised hover:text-ink">
              <span>Lunar eclipse ({upcoming.lunarEclipse.kind})</span>
              <span className="font-mono">{fmtDateTime(upcoming.lunarEclipse.ms, zone)}</span>
            </button>
            <button type="button" onClick={() => setInstant(upcoming.solarEclipse.ms)} className="flex justify-between gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left text-muted hover:bg-raised hover:text-ink">
              <span>Solar eclipse ({upcoming.solarEclipse.kind})</span>
              <span className="font-mono">{fmtDateTime(upcoming.solarEclipse.ms, zone)}</span>
            </button>
          </div>
        </div>

        <div className="panel p-3">
          <span className="readout">Seasons</span>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <OrbitDiagram
              sunEclLon={sky.sun.eclLon}
              moonEclLon={sky.moon.eclLon}
              monthAngles={monthAngles}
              onScrub={(target) => {
                let best = 0, bestD = 999;
                year.forEach((d, i) => {
                  const diff = Math.abs(norm180(d.eclLon - target));
                  if (diff < bestD) {
                    bestD = diff;
                    best = i;
                  }
                });
                setLocal(parts.year, 1, best + 1, parts.hour, parts.minute);
              }}
            />
            <div className="min-w-[200px] flex-1 space-y-2 text-[13px]">
              <div className="text-[15px] font-medium text-ink">
                {season.season} in the {season.hemisphere} hemisphere
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full bg-accent" style={{ width: `${Math.round(season.progress * 100)}%` }} />
              </div>
              <KV
                rows={[
                  ["Since", `${localDate(season.startedMs, zone)} (${season.startedBy})`],
                  ["Until", `${localDate(season.nextMs, zone)} — ${season.nextLabel}, in ${until(ms, season.nextMs)}`],
                  ["Sun overhead at", deg(Math.abs(sky.sun.lat), 1) + (sky.sun.lat >= 0 ? " N" : " S")],
                  ["Noon Sun here", year[dayIndex] ? deg(year[dayIndex].noonAltitude) : "—"],
                ]}
              />
              <p className="text-[12px] leading-relaxed text-faint">
                Seen from above the north pole, not to scale. The red line is Earth&apos;s axis: it leans 23.4° the same way all year, so the north tips toward the Sun in June and away in December. Distance isn&apos;t the cause — Earth is nearest the Sun in early January. Drag
                the Earth around the orbit to change the date.
              </p>
            </div>
          </div>
        </div>

        <div className="panel p-3">
          <span className="readout">
            Sun and Moon height above the horizon · {pin.name}, {fmtDay(ms, zone, false)}
          </span>
          <DayChart series={series} events={events} dayStart={dayStart} ms={ms} zone={zone} onScrub={(t) => setInstant(t, false)} />
          <p className="text-[12px] text-faint">
            <span style={{ color: "#e8a013" }}>━</span> Sun · <span style={{ color: "#8b97b5" }}>━</span> Moon · background shows daylight, the three twilights and night. Drag to set the time.
          </p>
        </div>

        <div className="panel p-3">
          <span className="readout">
            Daylight through {parts.year} · {pin.name}
          </span>
          <YearChart
            year={year}
            offsets={offsets}
            dayIndex={dayIndex}
            minute={minute}
            marks={seasonList.map(([label, at]) => {
              const p = zoneParts(at, zone);
              return { label, index: dayOfYear(p.year, p.month, p.day) - 1 };
            })}
            onScrub={(i, m) => setLocal(parts.year, 1, i + 1, Math.floor(m / 60), m % 60)}
          />
          <p className="text-[12px] text-faint">Yellow is daylight, orange civil twilight, blue night; the vertical axis is clock time in {zoneName(ms, zone)}. Drag anywhere: left–right changes the date, up–down the time.</p>
        </div>

        <div className="panel flex flex-wrap items-center gap-4 p-3 lg:col-span-2">
          <div className="flex flex-col">
            <span className="readout">Sky over {pin.name}</span>
            <SkyDome paths={[...referencePaths, moonPath, todayPath]} sun={local.sun} moon={local.moon} />
          </div>
          <div className="min-w-[240px] flex-1 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
            <p>
              A map of the sky with the horizon as the outer circle and the point overhead in the centre. <span style={{ color: "#e8a013" }}>━</span> is the Sun&apos;s path today and <span style={{ color: "#8b97b5" }}>━</span> the Moon&apos;s; the dashed arcs are the Sun&apos;s paths at the{" "}
              <span style={{ color: "#e2713a" }}>June</span> and <span style={{ color: "#4b8fd6" }}>December</span> solstices and the March equinox.
            </p>
            <p>
              Sun now: {local.sun.alt >= 0 ? `${deg(local.sun.alt)} up toward ${compass(local.sun.az)}` : `${deg(Math.abs(local.sun.alt))} below the horizon`}. Moon now: {moonUp ? `${deg(local.moon.alt)} up toward ${compass(local.moon.az)}` : `${deg(Math.abs(local.moon.alt))} below the horizon`}.
            </p>
            <p>
              Solstices and equinoxes in {parts.year}: {seasonList.map(([label, at]) => `${label} ${fmtDateTime(at, zone)}`).join(" · ")}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
