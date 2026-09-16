"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  Download,
  Film,
  GripVertical,
  ImagePlus,
  Loader,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Frame {
  id: string;
  name: string;
  url: string;
  bitmap: ImageBitmap;
  w: number;
  h: number;
}

interface Result {
  url: string;
  size: number;
  width: number;
  height: number;
  frames: number;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function GifMakerWidget() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(10);
  const [colors, setColors] = useState(128);
  const [loopForever, setLoopForever] = useState(true);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [bg, setBg] = useState("#0b0d0e");
  const [reverse, setReverse] = useState(false);
  const [boomerang, setBoomerang] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const idRef = useRef(0);
  const dragIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const aspect = frames[0] ? frames[0].h / frames[0].w : 1;
  const height = Math.round(width * aspect);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const loaded: Frame[] = [];
    for (const file of imgs) {
      try {
        const bitmap = await createImageBitmap(file);
        loaded.push({
          id: `f${idRef.current++}`,
          name: file.name,
          url: URL.createObjectURL(file),
          bitmap,
          w: bitmap.width,
          h: bitmap.height,
        });
      } catch {
        /* skip undecodable file */
      }
    }
    if (loaded.length) {
      setFrames((prev) => {
        const next = [...prev, ...loaded];
        if (prev.length === 0) setWidth(Math.min(loaded[0].w, 600));
        return next;
      });
      setResult(null);
    }
  }, []);

  const removeFrame = (id: string) => {
    setFrames((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });
    setResult(null);
  };

  const reorder = (from: number, to: number) => {
    setFrames((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setResult(null);
  };

  const clearAll = () => {
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    setFrames([]);
    setResult(null);
  };

  useEffect(() => {
    return () => {
      frames.forEach((f) => URL.revokeObjectURL(f.url));
      if (result) URL.revokeObjectURL(result.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const encode = useCallback(async () => {
    if (!frames.length || busy) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);

    const W = Math.max(1, Math.round(width));
    const H = Math.max(1, Math.round(height));

    // Build playback order.
    let order = [...frames];
    if (reverse) order.reverse();
    if (boomerang && order.length > 2) {
      order = order.concat(order.slice(1, -1).reverse());
    }

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const buffers: ArrayBuffer[] = [];
    for (const f of order) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const scale =
        fit === "cover"
          ? Math.max(W / f.w, H / f.h)
          : Math.min(W / f.w, H / f.h);
      const dw = f.w * scale;
      const dh = f.h * scale;
      ctx.drawImage(f.bitmap, (W - dw) / 2, (H - dh) / 2, dw, dh);
      buffers.push(ctx.getImageData(0, 0, W, H).data.buffer);
    }

    // A classic worker: Turbopack's worker bootstrap loads chunks with importScripts, which module workers forbid.
    const worker = new Worker(new URL("./gif.worker.ts", import.meta.url));

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress(msg.value);
      } else if (msg.type === "done") {
        const blob = new Blob([msg.bytes], { type: "image/gif" });
        setResult({
          url: URL.createObjectURL(blob),
          size: blob.size,
          width: W,
          height: H,
          frames: order.length,
        });
        setBusy(false);
        worker.terminate();
      } else if (msg.type === "error") {
        setError(msg.message);
        setBusy(false);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      setError("The encoder worker failed to start.");
      setBusy(false);
    };

    worker.postMessage(
      {
        frames: buffers,
        width: W,
        height: H,
        delay: Math.round(1000 / fps),
        maxColors: colors,
        repeat: loopForever ? 0 : -1,
      },
      buffers,
    );
  }, [frames, busy, width, height, reverse, boomerang, fit, bg, fps, colors, loopForever, result]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
      {/* ----------------------------------------------------- frames pane */}
      <div className="panel registered flex min-h-[480px] flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">
            Frames {frames.length > 0 && `· ${frames.length}`}
          </span>
          {frames.length > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />

        {frames.length === 0 ? (
          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "m-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-edge bg-base bg-ticks p-8 text-center transition-colors",
              dragOver && "border-accent",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
              <Upload size={20} />
            </span>
            <span className="font-display text-base font-semibold text-ink">
              Drop images here
            </span>
            <span className="max-w-xs font-mono text-xs text-faint">
              or click to browse. PNG, JPG, WebP and GIF frames — they never
              leave your device.
            </span>
          </button>
        ) : (
          <div
            className="flex-1 overflow-auto p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {frames.map((f, i) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null && dragIndex.current !== i) {
                      reorder(dragIndex.current, i);
                    }
                    dragIndex.current = null;
                  }}
                  className="group registered relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-edge bg-base"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.name}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[10px] text-ink tabular">
                    {i + 1}
                  </span>
                  <span className="absolute right-1 top-1 cursor-grab text-ink/70 opacity-0 group-hover:opacity-100">
                    <GripVertical size={13} />
                  </span>
                  <button
                    onClick={() => removeFrame(f.id)}
                    className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded bg-black/70 text-ink/80 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    aria-label="Remove frame"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => fileInput.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-edge text-faint transition-colors hover:border-accent hover:text-accent"
              >
                <ImagePlus size={18} />
                <span className="font-mono text-[10px]">Add</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- settings pane */}
      <div className="flex flex-col gap-3">
        <div className="panel registered space-y-4 p-4">
          <p className="readout">Settings</p>

          <Slider label="Width" value={width} min={16} max={1000} step={2} suffix={`${width}×${height}`} onChange={setWidth} />
          <Slider label="Speed" value={fps} min={1} max={30} step={1} suffix={`${fps} fps`} onChange={setFps} />
          <Slider label="Quality" value={colors} min={2} max={256} step={1} suffix={`${colors} colors`} onChange={setColors} />

          <div className="grid grid-cols-2 gap-2">
            <Segmented
              label="Fit"
              value={fit}
              options={[
                ["cover", "Cover"],
                ["contain", "Contain"],
              ]}
              onChange={(v) => setFit(v as "cover" | "contain")}
            />
            <div>
              <p className="readout mb-1.5">Background</p>
              <label className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-2">
                <input
                  type="color"
                  value={bg}
                  onChange={(e) => setBg(e.target.value)}
                  className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="font-mono text-xs uppercase text-muted">{bg}</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Toggle label="Loop forever" active={loopForever} onClick={() => setLoopForever((v) => !v)} />
            <Toggle label="Reverse" active={reverse} onClick={() => setReverse((v) => !v)} />
            <Toggle label="Boomerang" active={boomerang} onClick={() => setBoomerang((v) => !v)} />
          </div>
        </div>

        {/* encode + result */}
        <div className="panel registered flex flex-1 flex-col p-4">
          <button
            onClick={encode}
            disabled={!frames.length || busy}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-on-accent transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader size={16} className="animate-spin" />
                Encoding… {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <Wand2 size={16} />
                {result ? "Re-encode GIF" : "Create GIF"}
              </>
            )}
          </button>

          {busy && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          {error && (
            <p className="mt-3 font-mono text-xs text-danger">{error}</p>
          )}

          {result && !busy && (
            <div className="mt-4 flex flex-1 flex-col">
              <div className="registered flex flex-1 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-edge bg-base bg-ticks p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.url}
                  alt="Generated GIF preview"
                  className="max-h-[260px] max-w-full rounded-[var(--radius-sm)]"
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="readout tabular">
                  {result.width}×{result.height} · {result.frames}f · {fmtBytes(result.size)}
                </span>
                <a
                  href={result.url}
                  download="bench.gif"
                  className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                >
                  <Download size={14} /> Download
                </a>
              </div>
            </div>
          )}

          {!result && !busy && !error && (
            <p className="mt-4 flex items-center gap-2 font-mono text-xs text-faint">
              <Film size={14} />
              {frames.length
                ? "Ready to encode."
                : "Add images to get started."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- controls */

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="readout">{label}</span>
        <span className="font-mono text-xs tabular text-muted">{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
      />
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="readout mb-1.5">{label}</p>
      <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
        {options.map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cn(
              "h-7 flex-1 rounded-[3px] font-mono text-xs transition-colors",
              value === val ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
            )}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 font-mono text-xs transition-colors",
        active
          ? "border-accent text-accent"
          : "border-edge text-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-accent" : "bg-faint",
        )}
      />
      {label}
    </button>
  );
}
