"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import jsQR, { type QRCode } from "jsqr";
import { Camera, ExternalLink, QrCode, ScanQrCode, Upload, X } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { classifyQr } from "@/lib/tools/image/qr-decode";
import { cn } from "@/lib/utils";

interface ScanResult {
  text: string;
  version: number;
  source: "camera" | "image";
}

function strokeLocation(ctx: CanvasRenderingContext2D, code: QRCode, color: string) {
  const { topLeftCorner: a, topRightCorner: b, bottomRightCorner: c, bottomLeftCorner: d } = code.location;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, ctx.canvas.width / 220);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (const p of [b, c, d]) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.stroke();
}

/** Try decoding a bitmap at a few scales; returns the canvas it was drawn on. */
function decodeBitmap(bitmap: ImageBitmap): { code: QRCode | null; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const max = Math.max(bitmap.width, bitmap.height);
  const scales = [
    ...new Set([Math.min(1, 1400 / max), Math.min(1, 800 / max), max < 260 ? 640 / max : 1]),
  ];
  for (const scale of scales) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
    if (code?.data) return { code, canvas };
  }
  return { code: null, canvas };
}

export function QrScannerWidget() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accent = () =>
    (rootRef.current ? getComputedStyle(rootRef.current).getPropertyValue("--accent").trim() : "") || "#c8f135";

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

  // While scanning, decode frames off the live video on an interval.
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const id = window.setInterval(() => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const w = Math.min(video.videoWidth, 800);
      const h = Math.round(video.videoHeight * (w / video.videoWidth));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
      if (code?.data) {
        strokeLocation(ctx, code, accent());
        setPreview(canvas.toDataURL("image/png"));
        setResult({ text: code.data, version: code.version, source: "camera" });
        stopCamera();
      }
    }, 180);
    return () => window.clearInterval(id);
  }, [scanning, stopCamera]);

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
      const { code, canvas } = decodeBitmap(bitmap);
      bitmap.close();
      if (code) strokeLocation(canvas.getContext("2d")!, code, accent());
      setPreview(canvas.toDataURL("image/png"));
      if (code) setResult({ text: code.data, version: code.version, source: "image" });
      else setError("No QR code found in this image. Try a sharper or closer crop.");
    },
    [stopCamera],
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

  const classified = result ? classifyQr(result.text) : null;

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
          <p className="readout blink px-3 pb-3 text-center">Scanning — point the camera at a QR code</p>
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
            <span className="font-display text-base font-semibold text-ink">Drop a QR code image here</span>
            <span className="max-w-xs font-mono text-xs text-faint">
              or click to browse, paste a screenshot (⌘/Ctrl+V), or use the camera. Decoded locally — nothing is uploaded.
            </span>
          </button>
        )}

        {error && <p className="border-t border-edge px-3 py-2 font-mono text-xs text-danger">{error}</p>}
      </div>

      {/* result */}
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">Result</span>
          {result && <CopyButton value={result.text} />}
        </div>

        {result && classified ? (
          <div className="flex flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2.5">
              <span className="rounded-full border border-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                {classified.label}
              </span>
              <span className="readout ml-auto">
                v{result.version} · {result.text.length} chars · {result.source}
              </span>
            </div>

            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-sm leading-relaxed text-ink">{result.text}</pre>

            {classified.fields.length > 0 && (
              <div className="divide-y divide-edge border-t border-edge">
                {classified.fields.map((f, i) => (
                  <div key={`${f.label}-${i}`} className="grid grid-cols-[110px_1fr] gap-2 px-3 py-2">
                    <span className="readout self-center">{f.label}</span>
                    <span className="whitespace-pre-wrap break-all font-mono text-xs text-ink">{f.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-2 border-t border-edge p-3">
              {classified.href && (
                <a
                  href={classified.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-[#070806] transition-[filter] hover:brightness-110"
                >
                  <ExternalLink size={13} /> Open
                </a>
              )}
              <Link
                href={`/generators/qr-code?i=${encodeURIComponent(result.text)}`}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <QrCode size={13} /> Make a QR of this
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="max-w-xs text-center font-mono text-xs text-faint">
              The decoded content appears here — links, Wi-Fi credentials, contact cards and events are parsed into fields.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
