"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs";
import { Check, Copy, Lock, LockOpen, Pipette, Shuffle, Upload, X } from "lucide-react";
import {
  EXPORT_FORMATS,
  SCHEMES,
  bestTextColor,
  contrastWith,
  describeColor,
  exportPalette,
  extractPalette,
  harmonyPalette,
  normalizeHex,
  randomPalette,
  scalePalette,
  type ExportFormat,
  type NamedColor,
  type Scheme,
} from "@/lib/tools/color/palette";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const MODES = ["harmony", "scale", "random", "image"] as const;
const SCHEME_IDS = ["analogous", "complementary", "split", "triadic", "tetradic", "monochromatic"] as const;
const FORMAT_IDS = ["css", "tailwind", "scss", "json"] as const;
const DEFAULT_BASE = "#5b8a3c";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const GHOST =
  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

function parseList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => normalizeHex(s))
    .filter((s): s is string => s !== null);
}

export function PaletteGeneratorWidget() {
  const [mode, setMode] = useQueryState("m", parseAsStringLiteral(MODES).withDefault("harmony").withOptions({ history: "replace" }));
  const [base, setBase] = useQueryState("base", parseAsString.withDefault(DEFAULT_BASE).withOptions({ history: "replace" }));
  const [scheme, setScheme] = useQueryState("scheme", parseAsStringLiteral(SCHEME_IDS).withDefault("analogous").withOptions({ history: "replace" }));
  const [count, setCount] = useQueryState("n", parseAsInteger.withDefault(5).withOptions({ history: "replace" }));
  const [listParam, setListParam] = useQueryState("c", parseAsString.withDefault("").withOptions({ history: "replace" }));
  const [fmt, setFmt] = useQueryState("fmt", parseAsStringLiteral(FORMAT_IDS).withDefault("css").withOptions({ history: "replace" }));
  const [baseInput, setBaseInput] = useState<string | null>(null);
  const [locks, setLocks] = useState<Set<number>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const n = Math.min(10, Math.max(3, count));
  const safeBase = normalizeHex(base) ?? DEFAULT_BASE;
  const list = useMemo(() => parseList(listParam), [listParam]);

  // Random mode starts with a palette; generating it in an effect keeps render pure.
  useEffect(() => {
    if (mode !== "random" || list.length) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setListParam(randomPalette(n).join(","));
    });
    return () => {
      active = false;
    };
  }, [mode, list.length, n, setListParam]);

  const colors: NamedColor[] = useMemo(() => {
    if (mode === "harmony") return harmonyPalette(safeBase, scheme as Scheme, n).map((hex, i) => ({ name: String(i + 1), hex }));
    if (mode === "scale") return scalePalette(safeBase).map((s) => ({ name: String(s.step), hex: s.hex }));
    return list.map((hex, i) => ({ name: String(i + 1), hex }));
  }, [mode, safeBase, scheme, n, list]);

  const shuffle = () => {
    const fresh = randomPalette(n);
    const next = fresh.map((hex, i) => (locks.has(i) && list[i] ? list[i] : hex));
    setListParam(next.join(","));
  };

  useEffect(() => {
    if (mode !== "random") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === " " && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.tagName === "BUTTON"))) {
        e.preventDefault();
        shuffle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // shuffle closes over the latest state; re-subscribing on each change keeps it current.
  });

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const fromImage = (file: File) => {
    setImageError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 96;
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const extracted = extractPalette(ctx.getImageData(0, 0, w, h).data, n);
      URL.revokeObjectURL(url);
      if (!extracted.length) {
        setImageError("Couldn't read any opaque pixels from that image.");
        return;
      }
      setImageName(file.name);
      setListParam(extracted.map((c) => c.hex).join(","));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setImageError("That file isn't an image this browser can decode.");
    };
    img.src = url;
  };

  const exported = useMemo(() => exportPalette(colors, fmt as ExportFormat, mode === "scale" ? "primary" : "palette"), [colors, fmt, mode]);
  const pickAsBase = (hex: string) => {
    setBase(hex);
    setBaseInput(null);
    if (mode === "random" || mode === "image") setMode("harmony");
  };

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["harmony", "Harmony"],
              ["scale", "Tints & shades"],
              ["random", "Random"],
              ["image", "From image"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cn(
                "h-7 rounded-[3px] px-3 text-[13px] transition-colors",
                mode === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {(mode === "harmony" || mode === "scale") && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Base
            <span className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-edge bg-base pl-1 pr-2 focus-within:border-accent">
              <input
                type="color"
                value={safeBase}
                onChange={(e) => {
                  setBase(e.target.value);
                  setBaseInput(null);
                }}
                aria-label="Pick base colour"
                className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <input
                value={baseInput ?? safeBase}
                onChange={(e) => {
                  setBaseInput(e.target.value);
                  const hex = normalizeHex(e.target.value);
                  if (hex) setBase(hex);
                }}
                onBlur={() => setBaseInput(null)}
                spellCheck={false}
                className={cn("h-8 w-24 bg-transparent font-mono text-[13px] outline-none", baseInput && !normalizeHex(baseInput) ? "text-danger" : "text-ink")}
              />
            </span>
          </label>
        )}

        {mode === "harmony" && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Scheme
            <select value={scheme} onChange={(e) => setScheme(e.target.value as (typeof SCHEME_IDS)[number])} className={SEL}>
              {SCHEMES.map((s) => (
                <option key={s.id} value={s.id} title={s.hint}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode !== "scale" && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Colours
            <select value={n} onChange={(e) => setCount(Number(e.target.value))} className={SEL}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "random" && (
          <button onClick={shuffle} className={cn(GHOST, "border-accent text-accent")} title="Generate a new palette (space bar)">
            <Shuffle size={13} /> Shuffle
          </button>
        )}
        {mode === "image" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) fromImage(f);
              }}
            />
            <button onClick={() => fileRef.current?.click()} className={cn(GHOST, "border-accent text-accent")}>
              <Upload size={13} /> {imageName ? "Another image" : "Choose an image"}
            </button>
            {imageName && <span className="max-w-[220px] truncate text-[12.5px] text-muted">{imageName}</span>}
          </>
        )}

        <span className="ml-auto text-[12px] text-faint">
          {mode === "harmony" && (SCHEMES.find((s) => s.id === scheme)?.hint ?? "")}
          {mode === "scale" && "Perceptually even steps in OKLCH; the base sits at its nearest step"}
          {mode === "random" && "Lock the ones you like, then shuffle the rest"}
          {mode === "image" && "Dominant colours by k-means in OKLab — processed on your device"}
        </span>
      </div>

      {imageError && (
        <div className="panel flex items-center gap-2 border-danger/50 p-3 text-[13px] text-danger">
          <X size={14} /> {imageError}
        </div>
      )}

      {/* swatches */}
      {colors.length === 0 ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) fromImage(f);
          }}
          className="panel flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-6 text-center hover:border-accent"
        >
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) fromImage(f);
            }}
          />
          <Upload size={22} className="text-muted" />
          <span className="text-[14px] text-ink">Drop an image here, or click to choose</span>
          <span className="text-[12.5px] text-muted">The image never leaves your browser.</span>
        </label>
      ) : (
        <div
          className={cn("grid gap-2", mode === "scale" ? "grid-cols-4 sm:grid-cols-6 lg:grid-cols-11" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5")}
        >
          {colors.map((c, i) => {
            const text = bestTextColor(c.hex);
            const cw = contrastWith(c.hex, "#ffffff"), cb = contrastWith(c.hex, "#000000");
            const locked = locks.has(i);
            return (
              <div
                key={`${i}-${c.hex}`}
                className="group relative flex flex-col overflow-hidden rounded-[var(--radius)] border border-edge"
                style={{ backgroundColor: c.hex, color: text }}
              >
                <button
                  onClick={() => copyHex(c.hex)}
                  title="Copy hex"
                  className={cn("flex flex-col items-start justify-end px-3 pb-2 pt-3 text-left", mode === "scale" ? "min-h-[88px]" : "min-h-[128px]")}
                >
                  <span className="text-[11px] opacity-75">{mode === "scale" ? c.name : `#${c.name}`}</span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium">
                    {c.hex}
                    {copied === c.hex ? <Check size={12} /> : <Copy size={12} className="opacity-0 transition-opacity group-hover:opacity-70" />}
                  </span>
                  {mode !== "scale" && (
                    <span className="mt-1 text-[10.5px] opacity-75">
                      {Math.max(cw, cb) >= 4.5 ? `AA ${cw >= cb ? "white" : "black"} text` : "low text contrast"}
                    </span>
                  )}
                </button>
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {mode === "random" && (
                    <button
                      onClick={() => setLocks((s) => { const next = new Set(s); if (next.has(i)) next.delete(i); else next.add(i); return next; })}
                      aria-label={locked ? "Unlock" : "Lock"}
                      className={cn("flex h-6 w-6 items-center justify-center rounded bg-black/25 hover:bg-black/40", locked && "opacity-100")}
                      style={{ color: text }}
                    >
                      {locked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </button>
                  )}
                  {mode !== "scale" && (
                    <button
                      onClick={() => pickAsBase(c.hex)}
                      aria-label="Use as base colour"
                      title="Use as base colour"
                      className="flex h-6 w-6 items-center justify-center rounded bg-black/25 hover:bg-black/40"
                      style={{ color: text }}
                    >
                      <Pipette size={12} />
                    </button>
                  )}
                </div>
                {locked && mode === "random" && (
                  <span className="pointer-events-none absolute left-1.5 top-1.5" style={{ color: text }}>
                    <Lock size={12} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {colors.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* details */}
          <div className="panel overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Hex</th>
                  <th className="px-3 py-2 font-medium">HSL</th>
                  <th className="px-3 py-2 font-medium">OKLCH</th>
                  <th className="px-3 py-2 font-medium">Contrast</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {colors.map((c, i) => {
                  const d = describeColor(c.hex);
                  const cw = contrastWith(c.hex, "#ffffff"), cb = contrastWith(c.hex, "#000000");
                  return (
                    <tr key={`${i}-${c.hex}`}>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3.5 w-3.5 rounded-sm border border-edge" style={{ backgroundColor: c.hex }} />
                          {mode === "scale" ? c.name : `#${c.name}`}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-ink">{d.hex}</td>
                      <td className="px-3 py-1.5 font-mono text-muted">{d.hsl}</td>
                      <td className="px-3 py-1.5 font-mono text-muted">{d.oklch}</td>
                      <td className="px-3 py-1.5 tabular text-muted">
                        <span title="against white">◻ {cw.toFixed(1)}</span> <span className="ml-2" title="against black">◼ {cb.toFixed(1)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* export */}
          <div className="panel flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <span className="readout">Export</span>
              <select value={fmt} onChange={(e) => setFmt(e.target.value as (typeof FORMAT_IDS)[number])} className={cn(SEL, "h-7 text-[12.5px]")}>
                {EXPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <div className="ml-auto">
                <CopyButton value={exported} />
              </div>
            </div>
            <textarea value={exported} readOnly spellCheck={false} className="min-h-[200px] flex-1 resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none" />
          </div>
        </div>
      )}
    </div>
  );
}
