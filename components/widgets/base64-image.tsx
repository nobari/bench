"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, Download, Loader, Trash2, Upload } from "lucide-react";
import {
  bytesToBase64,
  parseBase64Input,
  sniffMime,
  svgToDataUri,
  makeSnippets,
  formatBytes,
  extensionFor,
  INLINE_ADVICE_BYTES,
} from "@/lib/tools/image/base64";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const GHOST =
  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const DISPLAY_LIMIT = 200_000;
const SHARE_LIMIT = 30_000;

const FORMATS: [string, string, string][] = [
  ["keep", "Keep original", ""],
  ["png", "PNG", "image/png"],
  ["jpeg", "JPG", "image/jpeg"],
  ["webp", "WebP", "image/webp"],
];

type Mode = "encode" | "decode";
type OutKind = "uri" | "html" | "css" | "md" | "svg";

interface Encoded {
  name: string;
  mime: string;
  originalBytes: number;
  bytes: number;
  base64: string;
  dataUri: string;
  svgUri: string | null;
  w: number;
  h: number;
  reencoded: boolean;
}

/** Decode-side text comes from the compressed hash (Share) or a plain `b` query param. */
function readInitial(): string {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const h = hash.get("b");
  if (h) {
    try {
      return decompressFromEncodedURIComponent(h) || "";
    } catch {
      /* fall through */
    }
  }
  return new URLSearchParams(window.location.search).get("b") ?? "";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not decodable"));
    img.src = url;
  });
}

/** Read the file, optionally re-encode it through a canvas, and Base64 it. */
async function produce(file: File, fmt: string, quality: number, maxWidth: number): Promise<Encoded> {
  const original = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffMime(original);
  let mime = file.type || sniffed?.mime || "application/octet-stream";
  let bytes = original;
  let w = 0, h = 0;
  const target = FORMATS.find((f) => f[0] === fmt)?.[2] ?? "";
  const isSvg = mime === "image/svg+xml";

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url).catch(() => null);
    if (img) {
      w = img.naturalWidth;
      h = img.naturalHeight;
      const needsResize = maxWidth > 0 && w > maxWidth;
      if (img && (target || needsResize) && w && h) {
        const scale = needsResize ? maxWidth / w : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const outMime = target || (isSvg ? "image/png" : mime === "image/jpeg" || mime === "image/webp" ? mime : "image/png");
        const lossy = outMime !== "image/png";
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, outMime, lossy ? quality / 100 : undefined));
        if (blob) {
          bytes = new Uint8Array(await blob.arrayBuffer());
          mime = blob.type || outMime;
          w = canvas.width;
          h = canvas.height;
        }
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  const base64 = bytesToBase64(bytes);
  return {
    name: file.name || "image",
    mime,
    originalBytes: original.length,
    bytes: bytes.length,
    base64,
    dataUri: `data:${mime};base64,${base64}`,
    svgUri: isSvg && bytes === original ? svgToDataUri(new TextDecoder().decode(original)) : null,
    w,
    h,
    reencoded: bytes !== original,
  };
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Base64ImageWidget() {
  const [mode, setMode] = useQueryState("m", parseAsString.withDefault("encode").withOptions({ history: "replace" }));
  const [fmt, setFmt] = useQueryState("fmt", parseAsString.withDefault("keep").withOptions({ history: "replace" }));
  const [quality, setQuality] = useQueryState("q", parseAsInteger.withDefault(85).withOptions({ history: "replace" }));
  const [maxWidth, setMaxWidth] = useQueryState("w", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [out, setOut] = useState<OutKind>("uri");
  const [encoded, setEncoded] = useState<Encoded | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(readInitial);
  const [decodedDims, setDecodedDims] = useState<{ w: number; h: number } | null>(null);
  const dText = useDeferredValue(text);
  const m: Mode = mode === "decode" ? "decode" : "encode";

  function takeFile(file: File | null | undefined) {
    if (!file) return;
    fileRef.current = file;
    setLoadError(null);
    setFileVersion((v) => v + 1);
  }

  // Re-run the encoder whenever the file or the re-encode options change.
  useEffect(() => {
    const file = fileRef.current;
    if (!file) return;
    let active = true;
    queueMicrotask(() => active && setBusy(true));
    produce(file, fmt, quality, maxWidth)
      .then((r) => {
        if (!active) return;
        setEncoded(r);
        if (out === "svg" && !r.svgUri) setOut("uri");
      })
      .catch((e: unknown) => active && setLoadError(e instanceof Error ? e.message : "Couldn't read that file."))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
    // `out` is only read to reset an SVG tab; it shouldn't retrigger encoding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileVersion, fmt, quality, maxWidth]);

  // Paste an image anywhere on the page to encode it.
  useEffect(() => {
    if (m !== "encode") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        takeFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [m]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (m === "decode" && text && text.length <= SHARE_LIMIT) h.set("b", compressToEncodedURIComponent(text));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h.size ? `#${h}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [m, text]);

  const parsed = dText.trim() ? parseBase64Input(dText) : null;
  const decodedMime = parsed ? (parsed.sniffed?.mime ?? parsed.declaredMime ?? "application/octet-stream") : "";
  const decodedUri = parsed ? `data:${decodedMime};base64,${parsed.base64}` : "";
  const decodedIsImage = decodedMime.startsWith("image/");
  const mismatch = parsed?.declaredMime && parsed.sniffed && parsed.declaredMime !== parsed.sniffed.mime;

  function downloadDecoded() {
    if (!parsed) return;
    const url = URL.createObjectURL(new Blob([parsed.bytes as BlobPart], { type: decodedMime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `decoded.${parsed.sniffed?.ext ?? extensionFor(decodedMime)}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const snippets = encoded ? makeSnippets({ dataUri: encoded.dataUri, alt: encoded.name.replace(/\.[^.]+$/, ""), width: encoded.w || undefined, height: encoded.h || undefined }) : null;
  const outputText = !snippets || !encoded ? "" : out === "html" ? snippets.html : out === "css" ? snippets.css : out === "md" ? snippets.markdown : out === "svg" ? (encoded.svgUri ?? "") : snippets.dataUri;
  const truncated = outputText.length > DISPLAY_LIMIT;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["encode", "Image → Base64"],
              ["decode", "Base64 → image"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id === "encode" ? null : id)}
              className={cn("h-7 rounded-[3px] px-3 text-[13px] transition-colors", m === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[12.5px] text-faint">Nothing is uploaded — files stay in your browser.</span>
      </div>

      {m === "encode" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* source + options */}
          <div className="flex flex-col gap-3">
            <div className="panel flex min-h-[220px] flex-col">
              <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <span className="readout">Image</span>
                {encoded && (
                  <button
                    type="button"
                    onClick={() => {
                      fileRef.current = null;
                      setEncoded(null);
                    }}
                    className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                )}
              </div>
              <input ref={inputRef} type="file" accept="image/*,.svg" hidden onChange={(e) => takeFile(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  takeFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "m-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-edge bg-base p-4 text-center",
                  dragOver && "border-accent",
                )}
              >
                {encoded ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={encoded.dataUri} alt="" className="max-h-56 max-w-full rounded-[var(--radius-sm)] object-contain" />
                    <span className="font-mono text-[12px] text-muted">
                      {encoded.name} · {encoded.mime}
                      {encoded.w ? ` · ${encoded.w}×${encoded.h}` : ""}
                    </span>
                    <span className="text-[12px] text-faint">Drop or paste another image to replace it</span>
                  </>
                ) : busy ? (
                  <Loader className="animate-spin text-accent" size={20} />
                ) : (
                  <>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-edge text-accent">
                      <Upload size={18} />
                    </span>
                    <span className="text-[15px] font-medium text-ink">Drop an image here</span>
                    <span className="max-w-xs text-[12.5px] text-faint">or click to browse, or paste from the clipboard — PNG, JPG, WebP, GIF, SVG, AVIF.</span>
                  </>
                )}
              </button>
              {loadError && (
                <p className="flex items-center gap-1.5 px-3 pb-3 text-[13px] text-danger">
                  <AlertTriangle size={14} /> {loadError}
                </p>
              )}
            </div>

            <div className="panel space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span className="readout">Re-encode before embedding</span>
                {busy && <Loader className="animate-spin text-accent" size={14} />}
              </div>
              <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
                {FORMATS.map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setFmt(val === "keep" ? null : val)}
                    className={cn("h-7 flex-1 rounded-[3px] text-[12.5px] transition-colors", fmt === val ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {fmt !== "keep" && fmt !== "png" && (
                <label className="block">
                  <span className="flex items-center justify-between text-[12.5px] text-muted">
                    Quality <span className="font-mono tabular">{quality}%</span>
                  </span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
                  />
                </label>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                Max width
                <select value={maxWidth} onChange={(e) => setMaxWidth(Number(e.target.value) || null)} className={cn(SEL, "h-7 text-[12.5px]")}>
                  <option value={0}>original</option>
                  {[64, 128, 256, 512, 1024, 2048].map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[12px] text-faint">Smaller output means a smaller data URI. Keep original leaves the bytes untouched (animated GIFs stay animated).</p>
            </div>
          </div>

          {/* output */}
          <div className="panel flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["uri", "Data URI"],
                    ["html", "HTML <img>"],
                    ["css", "CSS"],
                    ["md", "Markdown"],
                    ...(encoded?.svgUri ? [["svg", "SVG (URL-encoded)"]] : []),
                  ] as [OutKind, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOut(id)}
                    className={cn("h-7 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] transition-colors", out === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => encoded && downloadText(outputText, `${encoded.name.replace(/\.[^.]+$/, "")}.${out === "html" ? "html" : out === "css" ? "css" : out === "md" ? "md" : "txt"}`)} disabled={!encoded} className={GHOST}>
                  <Download size={13} /> Download
                </button>
                <CopyButton value={outputText} label="Copy" className="h-8 px-3 text-[13px]" disabled={!encoded} />
              </div>
            </div>
            <textarea
              readOnly
              value={truncated ? `${outputText.slice(0, DISPLAY_LIMIT)}\n\n… ${formatBytes(outputText.length - DISPLAY_LIMIT)} more not shown. Copy or download for the full text.` : outputText}
              placeholder="The encoded image appears here."
              spellCheck={false}
              className="min-h-[260px] flex-1 resize-y break-all bg-transparent p-3 font-mono text-[12px] leading-relaxed text-ink outline-none"
            />
            {encoded && (
              <div className="border-t border-edge px-3 py-2 text-[12.5px] text-muted">
                <dl className="flex flex-wrap gap-x-4 gap-y-1">
                  <div>
                    <dt className="inline text-faint">Image </dt>
                    <dd className="inline font-mono tabular">{formatBytes(encoded.bytes)}</dd>
                    {encoded.reencoded && <dd className="inline font-mono tabular text-faint"> (was {formatBytes(encoded.originalBytes)})</dd>}
                  </div>
                  <div>
                    <dt className="inline text-faint">Base64 </dt>
                    <dd className="inline font-mono tabular">
                      {formatBytes(encoded.base64.length)} · +{Math.round((encoded.base64.length / Math.max(1, encoded.bytes) - 1) * 100)}%
                    </dd>
                  </div>
                  {encoded.svgUri && (
                    <div>
                      <dt className="inline text-faint">URL-encoded SVG </dt>
                      <dd className="inline font-mono tabular">{formatBytes(encoded.svgUri.length)}</dd>
                    </div>
                  )}
                </dl>
                {encoded.bytes > INLINE_ADVICE_BYTES && (
                  <p className="mt-1 text-faint">Above ~50 KB an inlined image usually loads slower than a separate cached file — consider re-encoding smaller.</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="panel flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Base64 or data URI</span>
              {text && (
                <button type="button" onClick={() => setText("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Paste a data URI, raw Base64, or a CSS url(\"data:…\") / <img src> fragment."}
              spellCheck={false}
              className="min-h-[260px] flex-1 resize-y break-all bg-transparent p-3 font-mono text-[12px] leading-relaxed text-ink outline-none"
            />
          </div>
          <div className="panel flex min-h-[260px] flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Decoded</span>
              <button type="button" onClick={downloadDecoded} disabled={!parsed} className={GHOST}>
                <Download size={13} /> Download
              </button>
            </div>
            {!dText.trim() ? (
              <p className="p-3 text-[13.5px] text-muted">The image appears here.</p>
            ) : !parsed ? (
              <p className="flex items-start gap-1.5 p-3 text-[13.5px] text-danger">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> That isn&apos;t valid Base64. Check for stray characters or a truncated paste.
              </p>
            ) : (
              <div className="flex flex-1 flex-col">
                <div className="flex flex-1 items-center justify-center p-3">
                  {decodedIsImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={decodedUri.length + decodedMime}
                      src={decodedUri}
                      alt="Decoded"
                      onLoad={(e) => setDecodedDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                      onError={() => setDecodedDims(null)}
                      className="max-h-[420px] max-w-full rounded-[var(--radius-sm)] object-contain"
                    />
                  ) : (
                    <p className="text-[13.5px] text-muted">Valid Base64, but the bytes don&apos;t look like an image ({decodedMime}). You can still download them.</p>
                  )}
                </div>
                <div className="border-t border-edge px-3 py-2 text-[12.5px] text-muted">
                  <span className="font-mono">{decodedMime}</span> · <span className="font-mono tabular">{formatBytes(parsed.bytes.length)}</span>
                  {decodedIsImage && decodedDims ? <span className="font-mono tabular"> · {decodedDims.w}×{decodedDims.h}</span> : null}
                  {parsed.declaredMime === null && parsed.sniffed && <span className="text-faint"> · type detected from the bytes</span>}
                  {mismatch && (
                    <span className="text-warn">
                      {" "}
                      · declared as {parsed.declaredMime} but the bytes are {parsed.sniffed?.mime}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
