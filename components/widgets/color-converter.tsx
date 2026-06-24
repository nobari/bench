"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { Pipette, Plus, Shuffle, X } from "lucide-react";
import {
  contrastRatio,
  harmony,
  hsvToRgb,
  nearestNamed,
  parseHex,
  rgbToHex,
  rgbToHsv,
  shadeRamp,
  toFormats,
  type HSV,
  type RGBA,
} from "@/lib/tools/color/convert";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT: RGBA = { r: 255, g: 122, b: 92, a: 1 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Parse any CSS colour: hex first (pure), else via the browser. */
function parseAny(input: string): RGBA | null {
  const hex = parseHex(input);
  if (hex) return hex;
  if (typeof document === "undefined") return null;
  const el = document.createElement("span");
  el.style.color = "";
  el.style.color = input.trim();
  if (!el.style.color) return null;
  document.body.appendChild(el);
  const cs = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = cs.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}

const HARMONIES: { label: string; offsets: number[] }[] = [
  { label: "Complement", offsets: [0, 180] },
  { label: "Analogous", offsets: [-30, 0, 30] },
  { label: "Triadic", offsets: [0, 120, 240] },
  { label: "Tetradic", offsets: [0, 90, 180, 270] },
  { label: "Split", offsets: [0, 150, 210] },
];

export function ColorConverterWidget() {
  const [c, setC] = useQueryState(
    "c",
    parseAsString.withDefault("#ff7a5c").withOptions({ history: "replace", throttleMs: 200 }),
  );

  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(parseHex(c) ?? DEFAULT));
  const [alpha, setAlpha] = useState(() => parseHex(c)?.a ?? 1);
  const [text, setText] = useState(() => c);
  const [hasEyedropper, setHasEyedropper] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active && "EyeDropper" in window) setHasEyedropper(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const rgba: RGBA = { ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: alpha };
  const hex = rgbToHex(rgba);
  const formats = toFormats(rgba);
  const name = nearestNamed(rgba);
  const hueHex = rgbToHex({ ...hsvToRgb(hsv.h, 1, 1), a: 1 });
  const cWhite = contrastRatio(rgba, WHITE);
  const cBlack = contrastRatio(rgba, BLACK);

  /** Canonical setter — keeps hsv, alpha, URL and text in sync. */
  const apply = (h: number, s: number, v: number, a: number, sync = true) => {
    setHsv({ h, s, v });
    setAlpha(a);
    const hx = rgbToHex({ ...hsvToRgb(h, s, v), a });
    setC(hx);
    if (sync) setText(hx);
  };
  const applyRgb = (col: RGBA) => {
    const k = rgbToHsv(col);
    apply(k.h, k.s, k.v, col.a);
  };

  const onText = (raw: string) => {
    setText(raw);
    const col = parseAny(raw);
    if (col) {
      const k = rgbToHsv(col);
      setHsv(k);
      setAlpha(col.a);
      setC(rgbToHex(col));
    }
  };

  const random = () =>
    apply(Math.random() * 360, 0.45 + Math.random() * 0.5, 0.55 + Math.random() * 0.4, 1);

  const eyedrop = async () => {
    const ED = (window as unknown as {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
    }).EyeDropper;
    if (!ED) return;
    try {
      const res = await new ED().open();
      const col = parseHex(res.sRGBHex);
      if (col) applyRgb(col);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
        {/* ---------------------------------------------------- picker */}
        <div className="panel registered space-y-3 p-3">
          <SVArea hsv={hsv} hueHex={hueHex} onChange={(s, v) => apply(hsv.h, s, v, alpha)} />

          <Bar
            value={hsv.h / 360}
            onChange={(t) => apply(t * 360, hsv.s, hsv.v, alpha)}
            background="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
            thumb={hueHex}
          />
          <Bar
            value={alpha}
            onChange={(t) => apply(hsv.h, hsv.s, hsv.v, t)}
            background={`linear-gradient(to right, transparent, ${rgbToHex({ ...rgba, a: 1 })})`}
            thumb={hex}
            checker
          />

          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => onText(e.target.value)}
              spellCheck={false}
              placeholder="#ff7a5c, rgb(), hsl(), tomato…"
              className="input flex-1 font-mono"
            />
            {hasEyedropper && (
              <button
                onClick={eyedrop}
                title="Pick a colour from the screen"
                className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <Pipette size={15} />
              </button>
            )}
            <button
              onClick={random}
              title="Random colour"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Shuffle size={15} />
            </button>
          </div>
        </div>

        {/* ---------------------------------------------------- formats */}
        <div className="space-y-3">
          <div className="panel">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Formats · ~{name}</span>
              <ShareButton />
            </div>
            <div className="grid grid-cols-1 divide-y divide-edge sm:grid-cols-2 sm:divide-y-0">
              {(["hex", "rgb", "hsl", "hwb", "oklch", "cmyk"] as const).map((k) => (
                <div
                  key={k}
                  className="flex items-center gap-2 px-3 py-2.5 sm:odd:border-r sm:[&:nth-child(n+3)]:border-t sm:border-edge"
                >
                  <span className="readout w-12 shrink-0 uppercase">{k}</span>
                  <code className="flex-1 truncate font-mono text-[13px] text-ink">{formats[k]}</code>
                  <CopyButton value={formats[k]} label="" className="shrink-0" />
                </div>
              ))}
            </div>
          </div>

          {/* contrast */}
          <div className="panel grid grid-cols-2 gap-2 p-3">
            <ContrastChip bg="#ffffff" fg={hex} label="on white" ratio={cWhite} />
            <ContrastChip bg="#000000" fg={hex} label="on black" ratio={cBlack} />
          </div>
        </div>
      </div>

      {/* ----------------------------------------------- harmonies + shades */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <p className="readout mb-2.5">Harmonies</p>
          <div className="space-y-2">
            {HARMONIES.map((h) => (
              <div key={h.label} className="flex items-center gap-2">
                <span className="w-20 shrink-0 font-mono text-[11px] text-muted">{h.label}</span>
                <div className="flex flex-1 overflow-hidden rounded-[var(--radius-sm)]">
                  {harmony(hsv.h, hsv.s, hsv.v, h.offsets).map((hx, i) => (
                    <button
                      key={i}
                      onClick={() => applyRgb(parseHex(hx)!)}
                      title={hx}
                      className="h-8 flex-1 transition-transform hover:scale-y-110"
                      style={{ background: hx }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-3">
          <p className="readout mb-2.5">Tints & shades</p>
          <div className="flex overflow-hidden rounded-[var(--radius-sm)]">
            {shadeRamp(hsv.h, hsv.s, 11).map((hx, i) => (
              <button
                key={i}
                onClick={() => applyRgb(parseHex(hx)!)}
                title={hx}
                className="group relative h-16 flex-1 transition-transform hover:z-10 hover:scale-110"
                style={{ background: hx }}
              >
                <span className="absolute inset-x-0 bottom-1 text-center font-mono text-[8px] text-black/40 opacity-0 group-hover:opacity-100">
                  {hx.slice(1, 4)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- gradient builder */}
      <GradientBuilder seed={hex} accentComplement={harmony(hsv.h, hsv.s, hsv.v, [180])[0]} />
    </div>
  );
}

/* ------------------------------------------------------------- SV picker area */

function SVArea({
  hsv,
  hueHex,
  onChange,
}: {
  hsv: HSV;
  hueHex: string;
  onChange: (s: number, v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const s = clamp01((e.clientX - r.left) / r.width);
    const v = 1 - clamp01((e.clientY - r.top) / r.height);
    onChange(s, v);
  };

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => drag.current && fromEvent(e)}
      onPointerUp={() => (drag.current = false)}
      className="relative h-44 w-full cursor-crosshair touch-none overflow-hidden rounded-[var(--radius-sm)] border border-edge"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueHex}`,
      }}
    >
      <span
        className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
      />
    </div>
  );
}

function Bar({
  value,
  onChange,
  background,
  thumb,
  checker,
}: {
  value: number;
  onChange: (t: number) => void;
  background: string;
  thumb: string;
  checker?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(clamp01((e.clientX - r.left) / r.width));
  };
  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => drag.current && fromEvent(e)}
      onPointerUp={() => (drag.current = false)}
      className={cn(
        "relative h-3.5 w-full cursor-pointer touch-none rounded-full border border-edge",
        checker && "checker",
      )}
    >
      <div className="absolute inset-0 rounded-full" style={{ background }} />
      <span
        className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${value * 100}%`, background: thumb }}
      />
    </div>
  );
}

function ContrastChip({ bg, fg, label, ratio }: { bg: string; fg: string; label: string; ratio: number }) {
  const pass = ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA Large" : "Fail";
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-edge p-2">
      <span className="flex h-9 w-9 items-center justify-center rounded text-sm font-bold" style={{ background: bg, color: fg }}>
        Aa
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[13px] tabular text-ink">{ratio.toFixed(2)}</p>
        <p className="readout text-[10px]">{label} · {pass}</p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- gradient builder */

interface Stop {
  id: number;
  color: string;
  pos: number;
}

function GradientBuilder({ seed, accentComplement }: { seed: string; accentComplement: string }) {
  const [type, setType] = useState<"linear" | "radial">("linear");
  const [angle, setAngle] = useState(90);
  const [animate, setAnimate] = useState(false);
  const idRef = useRef(2);
  const [stops, setStops] = useState<Stop[]>([
    { id: 0, color: seed, pos: 0 },
    { id: 1, color: accentComplement, pos: 100 },
  ]);

  const css = useMemo(() => {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const list = sorted.map((s) => `${s.color} ${Math.round(s.pos)}%`).join(", ");
    return type === "linear"
      ? `linear-gradient(${angle}deg, ${list})`
      : `radial-gradient(circle, ${list})`;
  }, [stops, type, angle]);

  const update = (id: number, patch: Partial<Stop>) =>
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="panel registered p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="readout">Gradient</span>
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(["linear", "radial"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "h-7 rounded-[3px] px-2.5 font-mono text-xs capitalize transition-colors",
                type === t ? "bg-accent text-[#070806]" : "text-muted hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {type === "linear" && (
          <div className="flex items-center gap-2">
            <span className="readout">Angle</span>
            <input
              type="range"
              min={0}
              max={360}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
            <span className="font-mono text-xs tabular text-muted">{angle}°</span>
          </div>
        )}
        <button
          onClick={() => setAnimate((a) => !a)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors",
            animate ? "border-accent text-accent" : "border-edge text-muted hover:text-ink",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", animate ? "bg-accent" : "bg-faint")} />
          Animate
        </button>
        <div className="ml-auto">
          <CopyButton value={`background: ${css};`} label="Copy CSS" />
        </div>
      </div>

      <div
        className={cn("registered h-28 w-full rounded-[var(--radius)] border border-edge", animate && "gradient-animate")}
        style={{ background: css }}
      />

      <div className="mt-3 space-y-2">
        {stops.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <label className="relative h-7 w-7 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-edge">
              <input
                type="color"
                value={s.color.length === 7 ? s.color : "#000000"}
                onChange={(e) => update(s.id, { color: e.target.value })}
                className="absolute inset-[-4px] h-[calc(100%+8px)] w-[calc(100%+8px)] cursor-pointer"
              />
            </label>
            <code className="w-20 shrink-0 font-mono text-xs uppercase text-muted">{s.color}</code>
            <input
              type="range"
              min={0}
              max={100}
              value={s.pos}
              onChange={(e) => update(s.id, { pos: Number(e.target.value) })}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
            <span className="w-10 text-right font-mono text-xs tabular text-faint">{Math.round(s.pos)}%</span>
            {stops.length > 2 && (
              <button
                onClick={() => setStops((p) => p.filter((x) => x.id !== s.id))}
                className="text-faint hover:text-danger"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {stops.length < 6 && (
          <button
            onClick={() =>
              setStops((p) => [...p, { id: idRef.current++, color: seed, pos: 50 }])
            }
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Plus size={13} /> Add stop
          </button>
        )}
      </div>

      <code className="mt-3 block break-all rounded-[var(--radius-sm)] border border-edge bg-base p-2.5 font-mono text-[11px] text-muted">
        background: {css};
      </code>
    </div>
  );
}
