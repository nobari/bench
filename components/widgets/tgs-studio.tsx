"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web/build/player/lottie_canvas";
import type { AnimationItem } from "lottie-web";
import {
  Check,
  Download,
  Loader,
  Pause,
  Play,
  Repeat,
  Sticker,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/tools/bytes";
import {
  TGS_MAX_BYTES,
  applyColorMap,
  collectColors,
  gunzipBytes,
  isGzipData,
  isZipData,
  parseLottieInfo,
  sampleSticker,
  serializeTgs,
  telegramChecks,
  type LottieJson,
} from "@/lib/tools/image/tgs";

interface Source {
  /** The original (never-mutated) animation as loaded. */
  anim: LottieJson;
  name: string;
  /** Compressed size when the input was a .tgs, else null. */
  tgsSize: number | null;
}

const SPEEDS = [0.25, 0.5, 1, 2] as const;

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px",
};

export function TgsStudioWidget() {
  const [src, setSrc] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [resetCount, setResetCount] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState<null | "tgs" | "png" | "gif">(null);
  const [gifProgress, setGifProgress] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<AnimationItem | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const frameLabelRef = useRef<HTMLSpanElement>(null);
  const playingRef = useRef(true);
  const lastFrameRef = useRef(0);
  const colorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const urlsRef = useRef<string[]>([]);

  const anim = useMemo(
    () =>
      src ? (Object.keys(colorMap).length ? applyColorMap(src.anim, colorMap) : src.anim) : null,
    [src, colorMap],
  );
  const info = useMemo(() => (anim ? parseLottieInfo(anim) : null), [anim]);
  const baseColors = useMemo(() => (src ? collectColors(src.anim) : []), [src]);
  const checks = useMemo(
    () => (info ? telegramChecks(info, src?.tgsSize ?? null) : []),
    [info, src],
  );
  const baseName = src ? src.name.replace(/\.(tgs|json|lottie)$/i, "") || "sticker" : "sticker";

  /* ------------------------------------------------------------ player */

  useEffect(() => {
    const stage = stageRef.current;
    if (!anim || !stage) return;
    const instance = lottie.loadAnimation<"canvas">({
      container: stage,
      renderer: "canvas",
      loop,
      autoplay: false,
      animationData: structuredClone(anim),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
    });
    const start = Math.min(lastFrameRef.current, Math.max(0, instance.totalFrames - 1));
    if (playingRef.current) instance.goToAndPlay(start, true);
    else instance.goToAndStop(start, true);
    const onFrame = () => {
      lastFrameRef.current = instance.currentFrame;
      if (scrubRef.current) scrubRef.current.value = String(Math.round(instance.currentFrame));
      if (frameLabelRef.current)
        frameLabelRef.current.textContent = String(Math.round(instance.currentFrame));
    };
    instance.addEventListener("enterFrame", onFrame);
    playerRef.current = instance;
    return () => {
      playerRef.current = null;
      instance.destroy();
    };
  }, [anim, loop]);

  useEffect(() => {
    playerRef.current?.setSpeed(speed);
  }, [speed, anim, loop]);

  useEffect(() => {
    const urls = urlsRef.current;
    const timers = colorTimers.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const save = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }, []);

  /* ------------------------------------------------------------ loading */

  const applySource = (next: Source) => {
    lastFrameRef.current = 0;
    playingRef.current = true;
    setColorMap({});
    setResetCount((c) => c + 1);
    setNote(null);
    setPlaying(true);
    setSrc(next);
    setError(null);
  };

  const load = useCallback(async (file: File) => {
    setError(null);
    try {
      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
      let tgsSize: number | null = null;
      if (isGzipData(bytes)) {
        tgsSize = bytes.length;
        bytes = await gunzipBytes(bytes);
      } else if (isZipData(bytes)) {
        // dotLottie container: a zip holding animations/*.json
        const { Archive } = await import("libarchive.js");
        Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });
        const reader = await Archive.open(file);
        try {
          const entries = (await reader.getFilesArray()) as {
            file: { name: string };
            path: string;
          }[];
          const target =
            entries.find(
              (e) => e.path.startsWith("animations/") && e.file.name.endsWith(".json"),
            ) ?? entries.find((e) => e.file.name.endsWith(".json"));
          if (!target) throw new Error("No animation JSON found inside this .lottie file.");
          const extracted = await reader.extractSingleFile(target.path + target.file.name);
          bytes = new Uint8Array(await extracted.arrayBuffer());
        } finally {
          await reader.close().catch(() => undefined);
        }
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LottieJson;
      parseLottieInfo(parsed); // throws when it isn't a Lottie document
      applySource({ anim: parsed, name: file.name, tgsSize });
    } catch (e) {
      setError(
        e instanceof Error && !/JSON/.test(e.message)
          ? e.message
          : "Could not read this file — expected a .tgs sticker, a Lottie .json or a .lottie file.",
      );
    }
  }, []);

  const openFiles = useCallback(
    (files: FileList) => {
      if (files[0]) void load(files[0]);
    },
    [load],
  );

  const loadSample = () =>
    applySource({ anim: sampleSticker(), name: "bench-bounce.json", tgsSize: null });

  const clear = () => {
    setSrc(null);
    setColorMap({});
    setError(null);
    setNote(null);
  };

  /* ------------------------------------------------------------ recolor */

  const queueColor = (from: string, to: string) => {
    const prev = colorTimers.current.get(from);
    if (prev) clearTimeout(prev);
    colorTimers.current.set(
      from,
      setTimeout(() => setColorMap((m) => ({ ...m, [from]: to })), 120),
    );
  };

  /* ------------------------------------------------------------ exports */

  /**
   * Offscreen player drawing straight into a 2d context. `container` must be
   * OMITTED: the canvas renderer then sizes itself from the canvas element,
   * while a detached container measures 0×0 and renders nothing. The type
   * declarations wrongly require `container`, hence the cast. `dpr: 1` keeps
   * the output at exact pixel size on high-DPI screens.
   */
  const offscreenPlayer = (data: LottieJson, ctx: CanvasRenderingContext2D): AnimationItem =>
    lottie.loadAnimation({
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
      rendererSettings: {
        context: ctx,
        clearCanvas: true,
        preserveAspectRatio: "xMidYMid meet",
        dpr: 1,
      },
    } as unknown as Parameters<typeof lottie.loadAnimation>[0]);

  /** Render one frame onto a fresh canvas at the given width. */
  const renderFrame = (frame: number, width: number): { canvas: HTMLCanvasElement; done: () => void } => {
    if (!anim || !info) throw new Error("nothing loaded");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((width * info.height) / info.width));
    const instance = offscreenPlayer(anim, canvas.getContext("2d")!);
    instance.goToAndStop(frame, true);
    return {
      canvas,
      done: () => instance.destroy(),
    };
  };

  const exportTgs = async () => {
    if (!anim || busy) return;
    setBusy("tgs");
    try {
      const bytes = await serializeTgs(anim);
      save(new Blob([bytes as BlobPart], { type: "application/gzip" }), `${baseName}.tgs`);
      setNote(
        bytes.length > TGS_MAX_BYTES
          ? `Heads-up: ${(bytes.length / 1024).toFixed(1)} KB exceeds Telegram's 64 KB sticker limit.`
          : `.tgs exported at ${(bytes.length / 1024).toFixed(1)} KB — within Telegram's 64 KB limit.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const exportJson = () => {
    if (!anim) return;
    save(
      new Blob([JSON.stringify(anim, null, 2)], { type: "application/json" }),
      `${baseName}.json`,
    );
  };

  const exportPng = async () => {
    if (!anim || !info || busy) return;
    setBusy("png");
    try {
      const frame = Math.round(lastFrameRef.current);
      const { canvas, done } = renderFrame(frame, info.width || 512);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      done();
      if (blob) save(blob, `${baseName}-frame${frame}.png`);
    } finally {
      setBusy(null);
    }
  };

  const exportGif = async () => {
    if (!anim || !info || busy) return;
    setBusy("gif");
    setGifProgress(0);
    try {
      const fps = Math.min(30, info.frameRate);
      const step = info.frameRate / fps;
      const total = Math.max(1, Math.floor(info.frames / step));
      const W = 320;
      const H = Math.max(1, Math.round((W * info.height) / info.width));
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const compose = document.createElement("canvas");
      compose.width = W;
      compose.height = H;
      const ctx = compose.getContext("2d")!;
      const frames: ArrayBuffer[] = [];
      // Drive a hidden instance frame by frame on its own canvas.
      const off = offscreenPlayer(anim, canvas.getContext("2d")!);
      for (let i = 0; i < total; i++) {
        off.goToAndStop(i * step, true);
        ctx.fillStyle = "#ffffff"; // GIF has no real alpha — composite on white
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(canvas, 0, 0);
        frames.push(ctx.getImageData(0, 0, W, H).data.buffer as ArrayBuffer);
        if (i % 10 === 9) {
          setGifProgress((i / total) * 0.5);
          await new Promise((r) => setTimeout(r));
        }
      }
      off.destroy();
      const gifBytes = await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(new URL("./gif.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.onmessage = (
          e: MessageEvent<{ type: string; value?: number; bytes?: Uint8Array; message?: string }>,
        ) => {
          if (e.data.type === "progress") setGifProgress(0.5 + (e.data.value ?? 0) * 0.5);
          else if (e.data.type === "done") {
            worker.terminate();
            resolve(e.data.bytes!);
          } else {
            worker.terminate();
            reject(new Error(e.data.message ?? "GIF encoding failed"));
          }
        };
        worker.postMessage(
          { frames, width: W, height: H, delay: Math.round(1000 / fps), maxColors: 256, repeat: 0 },
          frames,
        );
      });
      save(new Blob([gifBytes as unknown as BlobPart], { type: "image/gif" }), `${baseName}.gif`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "GIF export failed.");
    } finally {
      setBusy(null);
      setGifProgress(0);
    }
  };

  /* ------------------------------------------------------------ render */

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".tgs,.json,.lottie"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) openFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!src && (
        <div className="space-y-3">
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
              openFiles(e.dataTransfer.files);
            }}
            className={cn(
              "panel registered bg-ticks flex min-h-[320px] w-full flex-col items-center justify-center gap-3 border-dashed p-8 text-center",
              dragOver && "border-accent",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
              <Sticker size={20} />
            </span>
            <span className="font-display text-base font-semibold text-ink">
              Drop a Telegram sticker here
            </span>
            <span className="max-w-sm font-mono text-xs text-faint">
              .tgs, Lottie .json or .lottie — previewed, recolored and converted locally. Nothing
              is uploaded.
            </span>
          </button>
          <div className="flex items-center justify-center">
            <button
              onClick={loadSample}
              className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-muted hover:border-accent hover:text-accent"
            >
              <Play size={12} /> Try the sample sticker
            </button>
          </div>
          {error && <p className="text-center font-mono text-xs text-danger">{error}</p>}
        </div>
      )}

      {src && info && (
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          {/* player */}
          <div className="panel registered flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge p-2">
              <Sticker size={15} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-ink">{src.name}</p>
                <p className="readout text-[10px]">
                  {info.width}×{info.height} · {info.frameRate} fps · {info.duration.toFixed(2)} s
                  {src.tgsSize !== null && ` · ${formatBytes(src.tgsSize)} packed`}
                </p>
              </div>
              <button
                onClick={() => fileInput.current?.click()}
                title="Open another file"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent"
              >
                <Upload size={14} />
              </button>
              <button
                onClick={clear}
                title="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-danger hover:text-danger"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center bg-base p-4" style={CHECKER}>
              <div ref={stageRef} className="aspect-square w-full max-w-[440px]" />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-edge px-3 py-2">
              <button
                onClick={() => {
                  const p = playerRef.current;
                  if (!p) return;
                  if (playing) p.pause();
                  else p.play();
                  playingRef.current = !playing;
                  setPlaying(!playing);
                }}
                title={playing ? "Pause" : "Play"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent text-on-accent"
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => setLoop(!loop)}
                title="Toggle loop"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
                  loop ? "border-accent text-accent" : "border-edge text-muted",
                )}
              >
                <Repeat size={14} />
              </button>
              <input
                ref={scrubRef}
                type="range"
                min={0}
                max={Math.max(0, info.frames - 1)}
                defaultValue={0}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  playerRef.current?.goToAndStop(f, true);
                  lastFrameRef.current = f;
                  playingRef.current = false;
                  setPlaying(false);
                }}
                aria-label="Scrub frames"
                className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
              />
              <span className="shrink-0 font-mono text-xs tabular text-muted">
                <span ref={frameLabelRef}>0</span>/{info.frames}
              </span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Playback speed"
                className="h-8 w-[72px] shrink-0 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-xs text-ink outline-none"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* side panels */}
          <div className="flex flex-col gap-3">
            <div className="panel registered p-4">
              <p className="readout mb-3">Telegram sticker checks</p>
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-2 font-mono text-xs">
                    {c.ok ? (
                      <Check size={13} className="shrink-0 text-positive" />
                    ) : (
                      <X size={13} className="shrink-0 text-danger" />
                    )}
                    <span className={c.ok ? "text-muted" : "text-ink"}>{c.label}</span>
                    <span className="ml-auto text-faint">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>

            {baseColors.length > 0 && (
              <div className="panel registered p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="readout">Colors · {baseColors.length}</p>
                  {Object.keys(colorMap).length > 0 && (
                    <button
                      onClick={() => {
                        setColorMap({});
                        setResetCount((c) => c + 1);
                      }}
                      className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-ink"
                    >
                      <Undo2 size={12} /> Reset
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {baseColors.map((c) => (
                    <label
                      key={`${c.hex}-${resetCount}`}
                      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-2 py-1.5 hover:border-accent"
                    >
                      <input
                        type="color"
                        defaultValue={colorMap[c.hex] ?? c.hex}
                        onChange={(e) => queueColor(c.hex, e.target.value)}
                        className="h-5 w-6 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                      />
                      <span className="truncate font-mono text-[11px] text-muted">
                        {colorMap[c.hex] ?? c.hex}
                      </span>
                      <span className="readout ml-auto shrink-0 text-[10px]">×{c.count}</span>
                    </label>
                  ))}
                </div>
                <p className="readout mt-2 text-[10px]">Gradients are not recolored</p>
              </div>
            )}

            <div className="panel registered space-y-3 p-4">
              <p className="readout">Export</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void exportTgs()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent font-mono text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110 disabled:opacity-40"
                >
                  {busy === "tgs" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  .tgs
                </button>
                <button
                  onClick={exportJson}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  <Download size={13} /> Lottie .json
                </button>
                <button
                  onClick={() => void exportPng()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {busy === "png" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  PNG frame
                </button>
                <button
                  onClick={() => void exportGif()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {busy === "gif" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  GIF{busy === "gif" && ` ${Math.round(gifProgress * 100)}%`}
                </button>
              </div>
              {note && <p className="font-mono text-xs text-muted">{note}</p>}
              {error && <p className="font-mono text-xs text-danger">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
