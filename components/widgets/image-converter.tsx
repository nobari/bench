"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { Download, ImagePlus, Loader, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Src {
  id: string;
  name: string;
  url: string;
  bitmap: ImageBitmap;
  w: number;
  h: number;
  size: number;
}
interface Out {
  id: string;
  name: string;
  url: string;
  size: number;
  w: number;
  h: number;
}

const FORMATS: [string, string, string][] = [
  ["png", "PNG", "image/png"],
  ["jpeg", "JPG", "image/jpeg"],
  ["webp", "WebP", "image/webp"],
];

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageConverterWidget() {
  const [format, setFormat] = useQueryState(
    "fmt",
    parseAsString.withDefault("webp").withOptions({ history: "replace" }),
  );
  const [quality, setQuality] = useQueryState(
    "q",
    parseAsInteger.withDefault(90).withOptions({ history: "replace" }),
  );
  const [maxWidth, setMaxWidth] = useQueryState(
    "w",
    parseAsInteger.withDefault(0).withOptions({ history: "replace" }),
  );

  const [srcs, setSrcs] = useState<Src[]>([]);
  const [outs, setOuts] = useState<Out[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const idRef = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const lossy = format !== "png";
  const mime = FORMATS.find((f) => f[0] === format)?.[2] ?? "image/webp";

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const loaded: Src[] = [];
    for (const file of imgs) {
      try {
        const bitmap = await createImageBitmap(file);
        loaded.push({
          id: `s${idRef.current++}`,
          name: file.name,
          url: URL.createObjectURL(file),
          bitmap,
          w: bitmap.width,
          h: bitmap.height,
          size: file.size,
        });
      } catch {
        /* skip */
      }
    }
    if (loaded.length) {
      setSrcs((p) => [...p, ...loaded]);
      setOuts([]);
    }
  }, []);

  const clearAll = () => {
    srcs.forEach((s) => URL.revokeObjectURL(s.url));
    outs.forEach((o) => URL.revokeObjectURL(o.url));
    setSrcs([]);
    setOuts([]);
  };

  useEffect(() => {
    return () => {
      srcs.forEach((s) => URL.revokeObjectURL(s.url));
      outs.forEach((o) => URL.revokeObjectURL(o.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const convert = useCallback(async () => {
    if (!srcs.length || busy) return;
    setBusy(true);
    outs.forEach((o) => URL.revokeObjectURL(o.url));
    const results: Out[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    for (const s of srcs) {
      const scale = maxWidth > 0 && s.w > maxWidth ? maxWidth / s.w : 1;
      const W = Math.round(s.w * scale);
      const H = Math.round(s.h * scale);
      canvas.width = W;
      canvas.height = H;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(s.bitmap, 0, 0, W, H);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res, mime, lossy ? quality / 100 : undefined),
      );
      if (blob) {
        results.push({
          id: s.id,
          name: s.name.replace(/\.[^.]+$/, "") + "." + format,
          url: URL.createObjectURL(blob),
          size: blob.size,
          w: W,
          h: H,
        });
      }
    }
    setOuts(results);
    setBusy(false);
  }, [srcs, busy, maxWidth, mime, lossy, quality, format, outs]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
      {/* sources */}
      <div className="panel registered flex min-h-[440px] flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">Source {srcs.length > 0 && `· ${srcs.length}`}</span>
          {srcs.length > 0 && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        {srcs.length === 0 ? (
          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={cn("m-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-edge bg-base bg-ticks p-8 text-center", dragOver && "border-accent")}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent"><Upload size={20} /></span>
            <span className="font-display text-base font-semibold text-ink">Drop images here</span>
            <span className="max-w-xs font-mono text-xs text-faint">or click to browse — PNG, JPG, WebP, AVIF, GIF. Converted locally.</span>
          </button>
        ) : (
          <div className="grid flex-1 grid-cols-3 gap-2 overflow-auto p-3 sm:grid-cols-4">
            {srcs.map((s) => (
              <div key={s.id} className="registered relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-edge bg-base">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name} className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-ink tabular">
                  {s.w}×{s.h}
                </span>
              </div>
            ))}
            <button onClick={() => fileInput.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-edge text-faint hover:border-accent hover:text-accent">
              <ImagePlus size={18} />
              <span className="font-mono text-[10px]">Add</span>
            </button>
          </div>
        )}
      </div>

      {/* settings + results */}
      <div className="flex flex-col gap-3">
        <div className="panel registered space-y-4 p-4">
          <p className="readout">Output</p>
          <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
            {FORMATS.map(([val, lbl]) => (
              <button key={val} onClick={() => setFormat(val)} className={cn("h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors", format === val ? "bg-accent text-on-accent" : "text-muted hover:text-ink")}>
                {lbl}
              </button>
            ))}
          </div>

          {lossy && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="readout">Quality</span>
                <span className="font-mono text-xs tabular text-muted">{quality}%</span>
              </div>
              <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="readout">Max width</span>
              <span className="font-mono text-xs tabular text-muted">{maxWidth === 0 ? "original" : `${maxWidth}px`}</span>
            </div>
            <input type="range" min={0} max={3000} step={50} value={maxWidth} onChange={(e) => setMaxWidth(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
          </div>

          <button onClick={convert} disabled={!srcs.length || busy} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-on-accent transition-[filter] hover:brightness-110 disabled:opacity-40">
            {busy ? <><Loader size={15} className="animate-spin" /> Converting…</> : "Convert"}
          </button>
        </div>

        {outs.length > 0 && (
          <div className="panel flex-1 divide-y divide-edge">
            {outs.map((o) => (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-ink">{o.name}</p>
                  <p className="readout text-[10px]">{o.w}×{o.h} · {fmtBytes(o.size)}</p>
                </div>
                <a href={o.url} download={o.name} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent">
                  <Download size={13} /> Save
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
