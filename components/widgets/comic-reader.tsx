"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsInteger, parseAsStringLiteral } from "nuqs";
import { Archive } from "libarchive.js";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader,
  Lock,
  Maximize,
  Minimize,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COMIC_ACCEPT,
  archiveKind,
  comparePagePaths,
  formatBytes,
  imageMime,
  isComicPage,
} from "@/lib/tools/image/comic";

// libarchive runs in its own worker; both the worker bundle and the wasm it
// loads are self-hosted (copied by scripts/copy-vendor.mjs), never a CDN.
Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });

interface ArchiveEntry {
  file: File | { name: string };
  /** Directory prefix inside the archive ("" or "dir/sub/"). */
  path: string;
}

interface LoadedPage {
  path: string;
  name: string;
  size: number;
  url: string;
}

interface Meta {
  name: string;
  size: number;
  kind: string;
}

type Phase = "empty" | "loading" | "password" | "ready" | "error";

const FITS = ["fit", "width", "actual"] as const;
const FIT_LABELS: Record<(typeof FITS)[number], string> = {
  fit: "Fit",
  width: "Width",
  actual: "1:1",
};

const ARCHIVE_RE = /\.(cbz|cbr|cb7|cbt|zip|rar|7z|tar)$/i;

function looksEncrypted(message: string): boolean {
  return /passphrase|password|encrypt/i.test(message);
}

// The wasm libarchive build can't decrypt RAR: even with the right password,
// data-encrypted archives fail with checksum errors and header-encrypted ones
// list zero entries — so treat any encrypted RAR as unsupported outright.
const RAR_ENCRYPTED_MSG =
  "This RAR archive is encrypted, which this reader can't open — RAR decryption isn't supported. Encrypted CBZ (ZIP) archives do work.";

function friendlyError(message: string): string {
  if (/checksum|corrupt|damaged|truncated|unrecognized/i.test(message))
    return "The archive could not be decoded — it may be corrupt, or an encrypted RAR, which this reader can't open (encrypted CBZ/ZIP works).";
  return message || "Could not read this archive.";
}

export function ComicReaderWidget() {
  const [pRaw, setP] = useQueryState(
    "p",
    parseAsInteger.withDefault(1).withOptions({ history: "replace", throttleMs: 200 }),
  );
  const [fit, setFit] = useQueryState(
    "fit",
    parseAsStringLiteral(FITS).withDefault("fit").withOptions({ history: "replace" }),
  );

  const [phase, setPhase] = useState<Phase>("empty");
  const [pages, setPages] = useState<LoadedPage[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [passwordBad, setPasswordBad] = useState(false);
  const [password, setPassword] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [isFs, setIsFs] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const urlsRef = useRef<string[]>([]);

  const count = pages.length;
  const page = count ? Math.min(Math.max(pRaw, 1), count) : 1;
  const current = pages[page - 1];

  const load = useCallback(
    async (file: File, pw?: string) => {
      setPhase("loading");
      setFileCount(null);
      setError(null);
      const isRar = /\.(cbr|rar)$/i.test(file.name);
      try {
        const reader = await Archive.open(file);
        try {
          if (pw) await reader.usePassword(pw);
          else if ((await reader.hasEncryptedData()) === true) {
            await reader.close().catch(() => undefined);
            if (isRar) {
              setError(RAR_ENCRYPTED_MSG);
              setPhase("error");
            } else {
              setPendingFile(file);
              setPasswordBad(false);
              setPhase("password");
            }
            return;
          }
          const listing = (await reader.getFilesArray()) as ArchiveEntry[];
          if (listing.length === 0)
            throw new Error(
              "No file entries could be read — the archive may use encrypted file names (RAR header encryption), which this reader can't open.",
            );
          setFileCount(listing.length);
          await reader.extractFiles();
          const extracted = (await reader.getFilesArray()) as ArchiveEntry[];
          const found = extracted
            .filter(
              (e): e is { file: File; path: string } =>
                e.file instanceof File && isComicPage(e.path + e.file.name),
            )
            .sort((a, b) => comparePagePaths(a.path + a.file.name, b.path + b.file.name))
            .map((e) => {
              const path = e.path + e.file.name;
              return {
                path,
                name: e.file.name,
                size: e.file.size,
                url: URL.createObjectURL(new Blob([e.file], { type: imageMime(path) })),
              };
            });
          if (found.length === 0) {
            found.forEach((f) => URL.revokeObjectURL(f.url));
            throw new Error("No images found inside this archive.");
          }
          urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
          urlsRef.current = found.map((f) => f.url);
          setPages(found);
          setMeta({ name: file.name, size: file.size, kind: archiveKind(file.name) });
          setPendingFile(null);
          setPassword("");
          setP(1);
          setPhase("ready");
        } catch (e) {
          await reader.close().catch(() => undefined);
          throw e;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (looksEncrypted(msg) && !isRar) {
          setPendingFile(file);
          setPasswordBad(Boolean(pw));
          setPhase("password");
        } else {
          setError(looksEncrypted(msg) ? RAR_ENCRYPTED_MSG : friendlyError(msg));
          setPhase("error");
        }
      }
    },
    [setP],
  );

  const openFiles = useCallback(
    (files: FileList | File[]) => {
      const file = Array.from(files).find((f) => ARCHIVE_RE.test(f.name)) ?? Array.from(files)[0];
      if (file) void load(file);
    },
    [load],
  );

  const clear = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    setPages([]);
    setMeta(null);
    setPendingFile(null);
    setPassword("");
    setError(null);
    setP(1);
    setPhase("empty");
  }, [setP]);

  useEffect(() => {
    const onFsChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // Keyboard paging: ←/→, PgUp/PgDn, space, Home/End.
  useEffect(() => {
    if (phase !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const step = (d: number) => setP((prev) => Math.min(Math.max((prev ?? 1) + d, 1), count));
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setP(1);
      } else if (e.key === "End") {
        e.preventDefault();
        setP(count);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, count, setP]);

  // On page turn: rewind the viewer scroll and keep the active thumb in view.
  useEffect(() => {
    viewerRef.current?.scrollTo({ top: 0, left: 0 });
    stripRef.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [page, phase]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  };

  const step = (d: number) => setP(Math.min(Math.max(page + d, 1), count));

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept={COMIC_ACCEPT}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) openFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {phase === "empty" && (
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
            "panel registered bg-ticks flex min-h-[380px] w-full flex-col items-center justify-center gap-3 border-dashed p-8 text-center",
            dragOver && "border-accent",
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
            <BookOpen size={20} />
          </span>
          <span className="font-display text-base font-semibold text-ink">
            Drop a comic archive here
          </span>
          <span className="max-w-sm font-mono text-xs text-faint">
            or click to browse — CBZ, CBR, CB7, CBT (and plain ZIP / RAR / 7z / TAR of images).
            Extracted locally, nothing is uploaded.
          </span>
        </button>
      )}

      {phase === "loading" && (
        <div className="panel registered flex min-h-[380px] flex-col items-center justify-center gap-4 p-8">
          <Loader size={22} className="animate-spin text-accent" />
          <p className="readout">
            {fileCount === null ? "Reading archive…" : `Extracting ${fileCount} files…`}
          </p>
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-raised">
            <div className="h-full w-full animate-pulse bg-accent" />
          </div>
        </div>
      )}

      {phase === "password" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingFile && password) void load(pendingFile, password);
          }}
          className="panel registered flex min-h-[380px] flex-col items-center justify-center gap-4 p-8"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
            <Lock size={18} />
          </span>
          <p className="font-display text-base font-semibold text-ink">
            This archive is password-protected
          </p>
          {passwordBad && (
            <p className="font-mono text-xs text-danger">Wrong password — try again.</p>
          )}
          <div className="flex w-full max-w-sm gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Archive password"
              className="input h-10 flex-1"
              autoFocus
            />
            <button
              type="submit"
              disabled={!password}
              className="inline-flex h-10 items-center rounded-[var(--radius)] bg-accent px-4 font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              Unlock
            </button>
          </div>
          <button
            type="button"
            onClick={clear}
            className="font-mono text-xs text-faint hover:text-ink"
          >
            Choose a different file
          </button>
        </form>
      )}

      {phase === "error" && (
        <div className="panel registered flex min-h-[380px] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-display text-base font-semibold text-danger">
            Could not open this archive
          </p>
          <p className="max-w-md font-mono text-xs text-muted">{error}</p>
          <button
            onClick={() => fileInput.current?.click()}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-edge px-3 font-mono text-xs text-ink hover:border-accent hover:text-accent"
          >
            <Upload size={13} /> Try another file
          </button>
        </div>
      )}

      {phase === "ready" && meta && current && (
        <div
          ref={rootRef}
          className={cn("panel registered flex flex-col overflow-hidden bg-base", isFs && "h-full")}
        >
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge p-2">
            <BookOpen size={15} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-ink">{meta.name}</p>
              <p className="readout text-[10px]">
                {meta.kind} · {count} pages · {formatBytes(meta.size)}
              </p>
            </div>
            <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
              {FITS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFit(f)}
                  className={cn(
                    "h-7 rounded-[3px] px-2.5 font-mono text-xs transition-colors",
                    fit === f ? "bg-accent text-[#070806]" : "text-muted hover:text-ink",
                  )}
                >
                  {FIT_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <a
                href={current.url}
                download={current.name}
                title="Download this page"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent"
              >
                <Download size={14} />
              </a>
              <button
                onClick={toggleFullscreen}
                title={isFs ? "Exit fullscreen" : "Fullscreen"}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent"
              >
                {isFs ? <Minimize size={14} /> : <Maximize size={14} />}
              </button>
              <button
                onClick={() => fileInput.current?.click()}
                title="Open another archive"
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
          </div>

          {/* page view */}
          <div
            ref={viewerRef}
            className={cn("bg-ticks relative overflow-auto", isFs ? "min-h-0 flex-1" : "h-[72vh]")}
          >
            <div
              className={cn(
                "flex min-h-full min-w-full",
                fit === "fit" ? "h-full items-center justify-center" : "items-start justify-center",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={`Page ${page} of ${meta.name}`}
                draggable={false}
                className={cn(
                  "select-none",
                  fit === "fit" && "max-h-full max-w-full object-contain",
                  fit === "width" && "h-auto w-full",
                  fit === "actual" && "max-w-none",
                )}
              />
            </div>
            <button
              onClick={() => step(-1)}
              disabled={page <= 1}
              aria-label="Previous page"
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-base/80 text-ink backdrop-blur transition-opacity hover:border-accent hover:text-accent disabled:opacity-0"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => step(1)}
              disabled={page >= count}
              aria-label="Next page"
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-base/80 text-ink backdrop-blur transition-opacity hover:border-accent hover:text-accent disabled:opacity-0"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* scrubber */}
          <div className="flex items-center gap-3 border-t border-edge px-3 py-2">
            <span className="readout shrink-0 tabular">
              {page} / {count}
            </span>
            <input
              type="range"
              min={1}
              max={count}
              value={page}
              onChange={(e) => setP(Number(e.target.value))}
              aria-label="Go to page"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
            <span className="readout hidden shrink-0 text-[10px] sm:inline">← → · space</span>
          </div>

          {/* thumbnails */}
          <div ref={stripRef} className="flex gap-1.5 overflow-x-auto border-t border-edge p-2">
            {pages.map((pg, i) => (
              <button
                key={pg.path}
                data-page={i + 1}
                onClick={() => setP(i + 1)}
                title={pg.name}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded-[var(--radius-sm)] border transition-opacity",
                  i + 1 === page
                    ? "border-accent"
                    : "border-edge opacity-50 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pg.url}
                  alt={`Page ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  className="h-20 w-14 object-cover"
                />
                <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 font-mono text-[9px] tabular text-ink">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
