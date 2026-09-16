"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FastForward, Film, Loader2, Square, Upload, X } from "lucide-react";
import type { StreamTargetChunk } from "mediabunny";
import { probeVideo, retimeVideo, webCodecsSupported, type RetimeResult, type VideoInfo } from "@/lib/tools/image/retime";
import { estimateOutputBytes, fitSize, outputFpsChoices } from "@/lib/tools/image/retime-core";
import { formatBytes } from "@/lib/tools/bytes";
import { cn } from "@/lib/utils";

/** File System Access API (Chrome/Edge): lets the MP4 stream to disk instead of memory. */
interface SaveHandle {
  name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
  getFile(): Promise<File>;
}
declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<SaveHandle>;
  }
}

/** Browsers cap a single ArrayBuffer at ~2 GB; stay well under it when assembling in memory. */
const MEMORY_LIMIT = 1.5e9;

const SPEEDS = [2, 4, 8, 16] as const;
const PRESETS: { label: string; speed: number; hint: string }[] = [
  { label: "120 fps → 4×", speed: 4, hint: "Osmo Action / GoPro 120 fps slow-mo saved at 30 fps" },
  { label: "240 fps → 8×", speed: 8, hint: "Osmo Action / GoPro 240 fps slow-mo saved at 30 fps" },
  { label: "60 fps → 2×", speed: 2, hint: "60 fps recording played at 30 fps" },
];
const WINDOWS: [number, string][] = [
  [0.3, "light"],
  [0.6, "medium"],
  [1.2, "strong"],
];
const SIZES: [number, string][] = [
  [0, "keep"],
  [1920, "1080p"],
  [1280, "720p"],
];

const SEL = "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-1.5 pr-6 text-[12.5px] text-ink outline-none focus:border-accent";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

interface Progress {
  phase: "analyse" | "render" | "finalize";
  done: number;
  total: number;
  etaSec: number | null;
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m} min ${Math.round(r)} s` : `${r.toFixed(r < 10 ? 1 : 0)} s`;
}

export function SlowMoWidget() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speedChoice, setSpeedChoice] = useState<number | "custom">(4);
  const [customSpeed, setCustomSpeed] = useState("3");
  const [fpsChoice, setFpsChoice] = useState<number | null>(null);
  const [blend, setBlend] = useState(false);
  const [stabilize, setStabilize] = useState(false);
  const [stabWindow, setStabWindow] = useState(0.6);
  const [maxSize, setMaxSize] = useState(0);
  const [quality, setQuality] = useState<"high" | "medium">("high");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<(RetimeResult & { url: string; name: string; bytes: number; savedAs?: string }) | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setSupported(webCodecsSupported());
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const speed = speedChoice === "custom" ? Math.max(0.25, Math.min(64, Number(customSpeed) || 1)) : speedChoice;
  const fpsChoices = useMemo(() => (info ? outputFpsChoices(info.fps, speed) : []), [info, speed]);
  const outputFps = fpsChoice !== null && fpsChoices.includes(fpsChoice) ? fpsChoice : (fpsChoices.find((f) => f === 60) ?? fpsChoices[fpsChoices.length - 1] ?? 30);

  const pick = async (f: File) => {
    setError(null);
    setResult(null);
    setInfo(null);
    setFile(f);
    setProbing(true);
    try {
      const i = await probeVideo(f);
      setInfo(i);
      if (!i.canDecode) setError(`This browser can't decode ${i.codec ?? "this"} video with WebCodecs. Try Chrome or Edge, or re-export the clip as H.264.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const outName = file ? `${file.name.replace(/\.[^.]+$/, "")}-normal-speed.mp4` : "video-normal-speed.mp4";
  const canStream = typeof window !== "undefined" && typeof window.showSaveFilePicker === "function";
  const outSize = info ? fitSize(info.width, info.height, maxSize) : { width: 0, height: 0 };
  const estimate = info ? estimateOutputBytes(outSize.width, outSize.height, outputFps, quality, info.duration / speed) : 0;

  const convert = async () => {
    if (!file || !info) return;
    setError(null);
    setResult(null);
    if (!canStream && estimate > MEMORY_LIMIT) {
      setError(
        `The result would be about ${formatBytes(estimate)}, more than this browser can assemble in memory (about 1.5 GB). Use Chrome or Edge, which save straight to disk, or choose a smaller size or lower quality.`,
      );
      return;
    }

    // Pick the destination first (it needs the click), then stream the MP4 to it while encoding.
    let handle: SaveHandle | null = null;
    let writable: WritableStream<StreamTargetChunk> | null = null;
    if (canStream) {
      try {
        handle = await window.showSaveFilePicker!({
          suggestedName: outName,
          types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        });
        writable = (await handle.createWritable()) as unknown as WritableStream<StreamTargetChunk>;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // dialog dismissed
        handle = null;
        writable = null; // fall back to memory
      }
    }

    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let started: number | null = null; // set on the first progress tick (the lint rule dislikes Date.now() here)
    try {
      const r = await retimeVideo(file, {
        speed,
        outputFps,
        blend,
        stabilize,
        stabilizeWindow: stabWindow,
        maxSize,
        quality,
        output: writable ? { writable } : undefined,
        signal: controller.signal,
        onProgress: (p) => {
          started ??= Date.now();
          const elapsed = (Date.now() - started) / 1000;
          const frac = p.total ? p.done / p.total : 0;
          // The analysis pass (when stabilising) is roughly a third of the work.
          const overall = stabilize ? (p.phase === "analyse" ? frac / 3 : 1 / 3 + (2 * frac) / 3) : frac;
          setProgress({ ...p, etaSec: overall > 0.02 ? (elapsed / overall) * (1 - overall) : null });
        },
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      // Streamed output is read back from disk for the preview; the File streams, nothing is loaded into memory.
      const blob = r.blob ?? (handle ? await handle.getFile() : null);
      if (!blob) throw new Error("The conversion finished but no output was produced.");
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setResult({ ...r, url, name: outName, bytes: blob.size, savedAs: handle?.name });
    } catch (e) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* already closed */
        }
      }
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setFile(null);
    setInfo(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const realFps = info ? info.fps * speed : 0;
  const outDuration = info ? info.duration / speed : 0;

  return (
    <div className="space-y-3">
      {supported === false && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-[13px] text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <span>
            This browser doesn&apos;t support WebCodecs, which this tool needs to decode and encode video. Use a
            current Chrome, Edge, Safari or Firefox.
          </span>
        </div>
      )}

      {/* file */}
      {!file ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) pick(f);
          }}
          className={cn(
            "panel flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-6 text-center transition-colors hover:border-accent",
            dragging && "border-accent bg-accent-soft",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
            }}
          />
          <Upload size={22} className="text-muted" />
          <span className="text-[14px] text-ink">Drop a slow-motion video here, or click to choose</span>
          <span className="text-[12.5px] text-muted">MP4, MOV, WebM or MKV. Processed on your device — nothing is uploaded.</span>
        </label>
      ) : (
        <div className="panel">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
            <Film size={15} className="text-muted" />
            <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{file.name}</span>
            <span className="text-[12.5px] text-muted">{formatBytes(file.size)}</span>
            {probing && (
              <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                <Loader2 size={13} className="animate-spin" /> reading…
              </span>
            )}
            {info && (
              <span className="text-[12.5px] text-muted">
                {info.width}×{info.height} · {info.fps.toFixed(2)} fps · {fmtDuration(info.duration)} · {info.frames.toLocaleString()} frames ·{" "}
                {info.codec ?? "unknown codec"}
                {info.hasAudio ? " · audio (dropped)" : ""}
              </span>
            )}
            <button onClick={reset} disabled={busy} className={cn(GHOST, "ml-auto")}>
              <X size={12} /> Change file
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* settings */}
      {info && info.canDecode && !result && (
        <div className="panel">
          <div className="border-b border-edge px-3 py-2">
            <span className="readout">Conversion</span>
          </div>
          <div className="space-y-4 p-3">
            <div>
              <p className="text-[13px] font-medium text-ink">Speed up by</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeedChoice(s)}
                      disabled={busy}
                      className={cn(
                        "h-7 rounded-[3px] px-3 text-[12.5px] transition-colors",
                        speedChoice === s ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
                      )}
                    >
                      {s}×
                    </button>
                  ))}
                  <button
                    onClick={() => setSpeedChoice("custom")}
                    disabled={busy}
                    className={cn(
                      "h-7 rounded-[3px] px-3 text-[12.5px] transition-colors",
                      speedChoice === "custom" ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
                    )}
                  >
                    custom
                  </button>
                </div>
                {speedChoice === "custom" && (
                  <input
                    value={customSpeed}
                    onChange={(e) => setCustomSpeed(e.target.value)}
                    inputMode="decimal"
                    className="h-7 w-20 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                )}
                <span className="text-[12.5px] text-muted">
                  file plays at {info.fps.toFixed(0)} fps → real motion was {realFps.toFixed(0)} fps · result {fmtDuration(outDuration)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.label} onClick={() => setSpeedChoice(p.speed)} disabled={busy} title={p.hint} className={GHOST}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted">
              <label className="flex items-center gap-1.5">
                Output frame rate
                <select value={outputFps} onChange={(e) => setFpsChoice(Number(e.target.value))} disabled={busy} className={SEL}>
                  {fpsChoices.map((f) => (
                    <option key={f} value={f}>
                      {f} fps{Math.abs(f - realFps) < 0.5 ? " (all frames)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Size
                <select value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} disabled={busy} className={SEL}>
                  {SIZES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Quality
                <select value={quality} onChange={(e) => setQuality(e.target.value as "high" | "medium")} disabled={busy} className={SEL}>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted">
              <label className="flex items-center gap-1.5" title="Average the source frames that fall into each output frame (adds natural motion blur)">
                <input type="checkbox" checked={blend} onChange={(e) => setBlend(e.target.checked)} disabled={busy} className="accent-[var(--accent)]" />
                Blend skipped frames (motion blur)
              </label>
              <label className="flex items-center gap-1.5" title="Smooth camera shake by tracking and cancelling frame-to-frame movement (crops ~5%)">
                <input type="checkbox" checked={stabilize} onChange={(e) => setStabilize(e.target.checked)} disabled={busy} className="accent-[var(--accent)]" />
                Reduce camera shake
              </label>
              {stabilize && (
                <label className="flex items-center gap-1.5">
                  smoothing
                  <select value={stabWindow} onChange={(e) => setStabWindow(Number(e.target.value))} disabled={busy} className={SEL}>
                    {WINDOWS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {realFps > 0 && outputFps < realFps - 0.5 && !blend && (
              <p className="text-[12.5px] text-faint">
                Every {(realFps / outputFps).toFixed(2)}th frame is kept, at an exactly even interval — motion stays smooth.
              </p>
            )}
            {speed < 1 && <p className="text-[12.5px] text-warn">Slowing down duplicates frames; it won&apos;t look smoother than the source.</p>}
            {info.width > 1920 && maxSize === 0 && (
              <p className="text-[12.5px] text-faint">4K encoding can be slow on some machines — choose 1080p if it drags.</p>
            )}
            <p className={cn("text-[12.5px]", !canStream && estimate > MEMORY_LIMIT ? "text-danger" : "text-faint")}>
              ≈ {formatBytes(estimate)} output ·{" "}
              {canStream
                ? "saved straight to a file you choose, so even hour-long 4K clips fit"
                : `assembled in memory — this browser holds about 1.5 GB; Chrome or Edge save to disk instead`}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {!busy ? (
                <button
                  onClick={convert}
                  disabled={supported === false}
                  className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-[13.5px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <FastForward size={15} /> Convert to normal speed
                </button>
              ) : (
                <button onClick={() => abortRef.current?.abort()} className={cn(GHOST, "h-9 px-3")}>
                  <Square size={13} /> Cancel
                </button>
              )}
              {busy && progress && (
                <div className="min-w-[240px] flex-1">
                  <div className="flex items-center justify-between text-[12px] text-muted">
                    <span>
                      {progress.phase === "analyse" ? "Analysing motion" : progress.phase === "render" ? "Rendering" : "Finishing"} · {progress.done}/{progress.total} frames
                    </span>
                    {progress.etaSec !== null && <span>~{fmtDuration(progress.etaSec)} left</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* result */}
      {result && (
        <div className="panel">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-edge px-3 py-2">
            <span className="readout">Result</span>
            <span className="text-[12.5px] text-muted">
              {result.width}×{result.height} · {result.fps} fps · {result.frames.toLocaleString()} frames · {fmtDuration(result.duration)} ·{" "}
              {formatBytes(result.bytes)} · {result.codec === "avc" ? "H.264" : "H.265"} MP4
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setResult(null)} className={GHOST}>
                Adjust & redo
              </button>
              {result.savedAs ? (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-positive/50 px-3 text-[13px] text-positive">
                  <Download size={14} /> Saved as {result.savedAs}
                </span>
              ) : (
                <a
                  href={result.url}
                  download={result.name}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)]"
                >
                  <Download size={14} /> Download
                </a>
              )}
            </div>
          </div>
          <video src={result.url} controls playsInline className="max-h-[480px] w-full bg-black" />
        </div>
      )}
    </div>
  );
}
