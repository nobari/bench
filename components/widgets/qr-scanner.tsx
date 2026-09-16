"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  formatToLabel,
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
} from "zxing-wasm/reader";
import { Camera, ExternalLink, QrCode, ScanQrCode, Upload, X } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { classifyScan } from "@/lib/tools/image/qr-decode";
import { cn } from "@/lib/utils";

// Self-hosted WASM (copied to public/ on postinstall) — the default would
// fetch from a CDN, and Bench serves everything from its own origin.
const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path,
};
prepareZXingModule({ overrides: ZXING_OVERRIDES });

interface ScanItem {
  text: string;
  format: string;
  symbology: string;
}

interface ScanState {
  items: ScanItem[];
  source: "camera" | "image";
}

async function decode(img: ImageData): Promise<ReadResult[]> {
  const found = await readBarcodes(img, { maxNumberOfSymbols: 24 });
  return found.filter((r) => r.isValid && r.text);
}

function drawMarkers(ctx: CanvasRenderingContext2D, found: ReadResult[], color: string) {
  const lw = Math.max(2, ctx.canvas.width / 220);
  for (const [i, r] of found.entries()) {
    const { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } = r.position;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (const p of [b, c, d]) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();
    if (found.length > 1) {
      const cx = (a.x + b.x + c.x + d.x) / 4;
      const cy = (a.y + b.y + c.y + d.y) / 4;
      const rad = Math.max(10, ctx.canvas.width / 55);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#070806";
      ctx.font = `700 ${Math.round(rad * 1.1)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), cx, cy);
    }
  }
}

/** Decode a bitmap, retrying at full size if a capped pass finds nothing. */
async function decodeBitmap(
  bitmap: ImageBitmap,
): Promise<{ found: ReadResult[]; canvas: HTMLCanvasElement }> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const max = Math.max(bitmap.width, bitmap.height);
  const scales = [...new Set([Math.min(1, 1600 / max), Math.min(1, 2800 / max)])];
  let found: ReadResult[] = [];
  for (const scale of scales) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    found = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (found.length) break;
  }
  return { found, canvas };
}

export function QrScannerWidget() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accent = () =>
    (rootRef.current ? getComputedStyle(rootRef.current).getPropertyValue("--accent").trim() : "") || "#c8f135";

  // Warm the decoder while the user is still picking a source.
  useEffect(() => {
    void Promise.resolve(
      prepareZXingModule({ overrides: ZXING_OVERRIDES, fireImmediately: true }),
    ).catch(() => {});
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const startCamera = useCallback(async () => {
    setError(null);
    setResult(null);
    setPreview(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not available here (it requires a secure HTTPS connection) — scan from an image instead.");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      setScanning(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was denied — allow camera access in your browser's site settings, or scan from an image instead."
          : name === "NotFoundError"
            ? "No camera was found on this device — scan from an image instead."
            : "Could not start the camera — scan from an image instead.",
      );
    }
  }, []);

  const finish = useCallback(
    (found: ReadResult[], canvas: HTMLCanvasElement, source: "camera" | "image") => {
      drawMarkers(canvas.getContext("2d")!, found, accent());
      setPreview(canvas.toDataURL("image/png"));
      setResult({
        items: found.map((r) => ({
          text: r.text,
          format: formatToLabel(r.format) ?? r.format,
          symbology: r.symbology,
        })),
        source,
      });
    },
    [],
  );

  // While scanning, decode frames off the live video on an interval.
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});

    let cancelled = false;
    let busy = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const id = window.setInterval(() => {
      if (busy || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      const w = Math.min(video.videoWidth, 800);
      const h = Math.round(video.videoHeight * (w / video.videoWidth));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      decode(ctx.getImageData(0, 0, w, h))
        .then((found) => {
          if (cancelled || !found.length) return;
          finish(found, canvas, "camera");
          stopCamera();
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [scanning, stopCamera, finish]);

  const scanFile = useCallback(
    async (file: File) => {
      stopCamera();
      setError(null);
      setResult(null);
      setPreview(null);
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        setError("Could not read that file as an image.");
        return;
      }
      try {
        const { found, canvas } = await decodeBitmap(bitmap);
        if (found.length) finish(found, canvas, "image");
        else {
          setPreview(canvas.toDataURL("image/png"));
          setError("No QR code or barcode found in this image. Try a sharper or closer crop.");
        }
      } catch {
        setError("Decoding failed — the decoder could not be loaded. Check your connection and retry.");
      } finally {
        bitmap.close();
      }
    },
    [stopCamera, finish],
  );

  // Paste an image anywhere on the page to scan it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void scanFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [scanFile]);

  const reset = () => {
    stopCamera();
    setResult(null);
    setPreview(null);
    setError(null);
  };

  const items = result?.items ?? [];

  return (
    <div ref={rootRef} className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
      {/* source */}
      <div className="panel registered flex min-h-[380px] flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">Source</span>
          <div className="flex items-center gap-2">
            {scanning ? (
              <button onClick={stopCamera} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
                <X size={12} /> Stop camera
              </button>
            ) : (
              <>
                <button onClick={startCamera} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent">
                  <Camera size={13} /> Camera
                </button>
                <button onClick={() => fileInput.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent">
                  <Upload size={13} /> Image
                </button>
                {(preview || error) && (
                  <button onClick={reset} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
                    <X size={12} /> Clear
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanFile(f); e.target.value = ""; }} />

        <video
          ref={videoRef}
          muted
          playsInline
          className={cn("m-3 flex-1 rounded-[var(--radius)] border border-edge bg-base object-cover", !scanning && "hidden")}
        />
        {scanning && (
          <p className="readout blink px-3 pb-3 text-center">Scanning — point the camera at a QR code or barcode</p>
        )}

        {!scanning && preview && (
          <div className="registered m-3 flex flex-1 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-edge bg-base bg-ticks p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Scanned image" className="max-h-[420px] w-auto max-w-full rounded object-contain" />
          </div>
        )}

        {!scanning && !preview && (
          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void scanFile(f); }}
            className={cn(
              "m-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-edge bg-base bg-ticks p-8 text-center",
              dragOver && "border-accent",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent"><ScanQrCode size={20} /></span>
            <span className="font-display text-base font-semibold text-ink">Drop an image with QR codes or barcodes</span>
            <span className="max-w-xs font-mono text-xs text-faint">
              or click to browse, paste a screenshot (⌘/Ctrl+V), or use the camera. Finds every code in the frame — decoded locally, nothing is uploaded.
            </span>
          </button>
        )}

        {error && <p className="border-t border-edge px-3 py-2 font-mono text-xs text-danger">{error}</p>}
      </div>

      {/* results */}
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">
            Result {items.length > 1 && `· ${items.length} codes`}
          </span>
          {items.length > 1 && (
            <CopyButton value={items.map((it) => it.text).join("\n")} label="Copy all" />
          )}
        </div>

        {items.length > 0 ? (
          <div className="flex flex-1 flex-col divide-y divide-edge overflow-y-auto">
            {items.map((it, i) => {
              const c = classifyScan(it.text, it.symbology);
              return (
                <div key={i} className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
                    {items.length > 1 && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-bold text-on-accent">
                        {i + 1}
                      </span>
                    )}
                    <span className="rounded-full border border-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                      {it.format}
                    </span>
                    <span className="readout">{c.label}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="readout">{it.text.length} chars</span>
                      <CopyButton value={it.text} />
                    </span>
                  </div>

                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-sm leading-relaxed text-ink">{it.text}</pre>

                  {c.fields.length > 0 && (
                    <div className="divide-y divide-edge/60 border-t border-edge/60">
                      {c.fields.map((f, j) => (
                        <div key={`${f.label}-${j}`} className="grid grid-cols-[110px_1fr] gap-2 px-3 py-2">
                          <span className="readout self-center">{f.label}</span>
                          <span className="whitespace-pre-wrap break-all font-mono text-xs text-ink">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 p-3">
                    {c.href && (
                      <a
                        href={c.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110"
                      >
                        <ExternalLink size={13} /> Open
                      </a>
                    )}
                    <Link
                      href={`/generators/qr-code?i=${encodeURIComponent(it.text)}`}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                    >
                      <QrCode size={13} /> Make a QR of this
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="max-w-xs text-center font-mono text-xs text-faint">
              Decoded codes appear here — if several QR codes or barcodes are in view, each one is listed and numbered on the preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
