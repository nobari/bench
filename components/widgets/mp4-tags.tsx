"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, FileVideo, Loader2, Save, Upload, X } from "lucide-react";
import { EMPTY_TAGS, MEDIA_KINDS, blobSource, inspectFile, keptName, kindLabel, planBytes, planTags, sameTags, type FileTags, type Inspection, type WritePlan } from "@/lib/tools/video/tags";
import { probeVideo, type VideoInfo } from "@/lib/tools/image/retime";
import { formatBytes } from "@/lib/tools/bytes";
import { cn } from "@/lib/utils";

/** File System Access API (Chrome/Edge): a handle lets the tags be written back into the file itself. */
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
type OpenPicker = (o: { id?: string; multiple?: boolean; types?: { description?: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle[]>;
const openPicker = () => (typeof window === "undefined" ? undefined : (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker);

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const PRIMARY = "inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40";

interface Loaded {
  file: File;
  handle: FileHandle | null;
  ins: Inspection;
  info: VideoInfo | null;
}

interface Saved {
  how: "file" | "download";
  mode: WritePlan["mode"];
  written: number;
  copied: number;
  ms: number;
  verified: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m} min ${Math.round(r)} s` : `${r.toFixed(r < 10 ? 1 : 0)} s`;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** What a save does to the file, in words. */
function describe(plan: WritePlan, fileSize: number): string {
  const { written, copied } = planBytes(plan);
  if (plan.mode === "tail") return `The index sits at the end of the file, so only the last ${formatBytes(written)} are rewritten; the ${formatBytes(fileSize - written)} of video and audio before it stay where they are.`;
  if (plan.mode === "fit") return `The index sits at the front with room to spare, so ${formatBytes(written)} are written over it in place; nothing else moves.`;
  return `The index sits at the front of the file with no room left, so the whole file (${formatBytes(copied + written)}) is rewritten with the media moved ${formatBytes(plan.delta)} later — plus 16 kB of spare room so the next edit fits in place.`;
}

export function Mp4TagsWidget() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tags, setTags] = useState<FileTags>(EMPTY_TAGS);
  const [busy, setBusy] = useState<null | "reading" | "saving" | "verifying">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canWriteBack = !!openPicker();

  const load = useCallback(async (file: File, handle: FileHandle | null) => {
    setError(null);
    setSaved(null);
    setBusy("reading");
    try {
      const ins = await inspectFile(blobSource(file));
      const info = await probeVideo(file).catch(() => null);
      setLoaded({ file, handle, ins, info });
      setTags(ins.tags);
    } catch (e) {
      setLoaded(null);
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // Other tools (and tests) can hand a File or a file handle over: window.dispatchEvent(new CustomEvent("bench:open-file", { detail }))
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<File | FileHandle>).detail;
      if (d instanceof File) void load(d, null);
      else if (d && typeof d === "object" && "getFile" in d) void d.getFile().then((f) => load(f, d));
    };
    window.addEventListener("bench:open-file", onOpen);
    return () => window.removeEventListener("bench:open-file", onOpen);
  }, [load]);

  const open = async () => {
    const pick = openPicker();
    if (!pick) {
      inputRef.current?.click();
      return;
    }
    try {
      const [h] = await pick({ id: "bench-mp4-tags", multiple: false, types: [{ description: "MP4 or MOV video", accept: { "video/mp4": [".mp4", ".m4v", ".m4a"], "video/quicktime": [".mov"] } }] });
      if (h) await load(await h.getFile(), h);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(message(e));
    }
  };

  const reset = () => {
    setLoaded(null);
    setTags(EMPTY_TAGS);
    setSaved(null);
    setError(null);
  };

  const setTag = (patch: Partial<FileTags>) => setTags((t) => ({ ...t, ...patch }));

  const dirty = !!loaded && !sameTags(loaded.ins.tags, tags);
  const plan = useMemo<{ plan: WritePlan } | { error: string } | null>(() => {
    if (!loaded) return null;
    try {
      return { plan: planTags(loaded.ins, tags) };
    } catch (e) {
      return { error: message(e) };
    }
  }, [loaded, tags]);

  const save = async () => {
    if (!loaded?.handle || !plan || "error" in plan) return;
    const { handle, file } = loaded;
    setError(null);
    setSaved(null);
    setBusy("saving");
    const t0 = performance.now();
    try {
      if (handle.requestPermission) {
        const p = await handle.requestPermission({ mode: "readwrite" });
        if (p !== "granted") throw new Error("The browser did not allow writing to this file. Download a tagged copy instead.");
      }
      const w = await handle.createWritable({ keepExistingData: !!plan.plan.patch });
      try {
        if (plan.plan.patch) {
          await w.seek(plan.plan.patch.at);
          await w.write(plan.plan.patch.bytes);
          if (plan.plan.patch.truncateTo !== null) await w.truncate(plan.plan.patch.truncateTo);
        } else {
          for (const part of plan.plan.parts) await w.write("bytes" in part ? part.bytes : file.slice(part.from, part.to));
        }
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
      await w.close();
      setBusy("verifying");
      const after = await handle.getFile();
      const ins = await inspectFile(blobSource(after));
      const verified = sameTags(ins.tags, tags) && after.size === plan.plan.size;
      setLoaded({ ...loaded, file: after, ins });
      setTags(ins.tags);
      setSaved({ how: "file", mode: plan.plan.mode, ...planBytes(plan.plan), ms: performance.now() - t0, verified });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    if (!loaded || !plan || "error" in plan) return;
    const blob = new Blob(
      plan.plan.parts.map((p) => ("bytes" in p ? p.bytes : loaded.file.slice(p.from, p.to))),
      { type: loaded.file.type || "video/mp4" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loaded.file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setSaved({ how: "download", mode: plan.plan.mode, ...planBytes(plan.plan), ms: 0, verified: false });
  };

  const kindValue = tags.kind === null ? "" : String(tags.kind);
  const otherKind = tags.kind !== null && !MEDIA_KINDS.some((k) => k.value === tags.kind) ? tags.kind : null;

  return (
    <div className="space-y-3">
      {!loaded ? (
        <label
          onClick={(e) => {
            if (openPicker()) {
              e.preventDefault();
              void open();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (!f) return;
            const item = e.dataTransfer.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<{ kind: string } | null> }) | undefined;
            const pending = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null);
            void pending.then((h) => load(f, h && h.kind === "file" ? (h as FileHandle) : null));
          }}
          className={cn(
            "panel flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-6 text-center transition-colors hover:border-accent",
            dragging && "border-accent bg-accent-soft",
          )}
          data-dropzone
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.m4v,.m4a,.mov"
            className="sr-only"
            data-file-input
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f, null);
            }}
          />
          {busy === "reading" ? (
            <span className="inline-flex items-center gap-2 text-[14px] text-ink">
              <Loader2 size={16} className="animate-spin" /> reading the file’s index…
            </span>
          ) : (
            <>
              <Upload size={22} className="text-muted" />
              <span className="text-[14px] text-ink">Drop an MP4 or MOV here, or click to choose</span>
              <span className="max-w-md text-[12.5px] text-muted">
                {canWriteBack ? "The tags are written back into the file itself — nothing is re-encoded and nothing is uploaded." : "This browser cannot write into a file in place, so a tagged copy is downloaded instead. Chrome and Edge save into the file itself. Nothing is uploaded."}
              </span>
            </>
          )}
        </label>
      ) : (
        <div className="panel" data-file>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
            <FileVideo size={15} className="text-muted" />
            <span className="min-w-0 truncate text-[13.5px] font-medium text-ink" data-file-name>
              {loaded.file.name}
            </span>
            <span className="text-[12.5px] text-muted tabular">{formatBytes(loaded.file.size)}</span>
            {loaded.info && (
              <span className="text-[12.5px] text-muted">
                {loaded.info.width}×{loaded.info.height} · {fmtDuration(loaded.info.duration)} · {loaded.info.codec ?? "unknown codec"}
                {loaded.info.hasAudio ? " · audio" : ""}
              </span>
            )}
            <span className="text-[12.5px] text-faint" data-layout>
              index {loaded.ins.layout === "tail" ? "at the end" : "at the front"}
              {loaded.ins.fragmented ? ", fragmented" : ""}
            </span>
            <button type="button" onClick={reset} disabled={busy !== null} className={cn(GHOST, "ml-auto")}>
              <X size={12} /> Change file
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-[13px] text-danger" role="alert">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loaded && (
        <div className="panel" data-tags>
          <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
            <span className="readout">Tags</span>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              Media kind
              <select value={kindValue} onChange={(e) => setTag({ kind: e.target.value === "" ? null : Number(e.target.value) })} className={SEL} aria-label="Media kind">
                <option value="">Not set</option>
                {MEDIA_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
                {otherKind !== null && <option value={otherKind}>{kindLabel(otherKind)}</option>}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3 text-[12.5px] sm:grid-cols-3">
            <label className="col-span-2 text-muted sm:col-span-3">
              Title
              <input value={tags.title} onChange={(e) => setTag({ title: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag title" />
            </label>
            <label className="text-muted">
              Artist
              <input value={tags.artist} onChange={(e) => setTag({ artist: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag artist" />
            </label>
            <label className="text-muted">
              Album artist
              <input value={tags.albumArtist} onChange={(e) => setTag({ albumArtist: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag album artist" />
            </label>
            <label className="text-muted">
              Album
              <input value={tags.album} onChange={(e) => setTag({ album: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag album" />
            </label>
            <label className="text-muted">
              Genre
              <input value={tags.genre} onChange={(e) => setTag({ genre: e.target.value })} placeholder="Music" className={cn(INPUT, "mt-0.5")} aria-label="Tag genre" />
            </label>
            <label className="text-muted">
              Year
              <input value={tags.year} onChange={(e) => setTag({ year: e.target.value })} placeholder={String(new Date().getFullYear())} inputMode="numeric" className={cn(INPUT, "mt-0.5 font-mono")} aria-label="Tag year" />
            </label>
            <label className="col-span-2 text-muted sm:col-span-1">
              Comment
              <input value={tags.comment} onChange={(e) => setTag({ comment: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag comment" />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-edge px-3 py-2 text-[12px] text-faint">
            <span>
              Media kind: <span className="text-muted">{kindLabel(tags.kind)}</span>
              {tags.kind === 6 ? " (ffmpeg’s media_type=6)" : ""}
            </span>
            {loaded.ins.encoder && (
              <span>
                Encoder: <span className="text-muted">{loaded.ins.encoder}</span> (kept)
              </span>
            )}
            {loaded.ins.kept.length > 0 && (
              <span>
                Kept as they are: <span className="text-muted">{loaded.ins.kept.map(keptName).join(", ")}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {loaded && plan && (
        <div className="panel" data-save>
          <div className="border-b border-edge px-3 py-2">
            <span className="readout">Save</span>
          </div>
          <div className="space-y-3 p-3 text-[12.5px] text-muted">
            {"error" in plan ? (
              <p className="text-danger" data-plan-error>
                {plan.error}
              </p>
            ) : (
              <p data-plan={plan.plan.mode}>{describe(plan.plan, loaded.file.size)}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void save()} disabled={!loaded.handle || !dirty || busy !== null || "error" in plan} className={PRIMARY} data-save-button>
                {busy === "saving" ? <Loader2 size={14} className="animate-spin" /> : busy === "verifying" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {busy === "saving" ? "Saving…" : busy === "verifying" ? "Reading back…" : "Save into the file"}
              </button>
              <button type="button" onClick={download} disabled={busy !== null || "error" in plan} className={GHOST} data-download-button>
                <Download size={13} /> Download a tagged copy
              </button>
              {!dirty && !saved && <span className="text-faint">Nothing changed yet.</span>}
            </div>
            {!loaded.handle && (
              <p className="text-faint">
                {canWriteBack ? "This file came in without a handle the browser may write to; pick it with the chooser above (or drop it) to save into the file itself." : "Saving into the file itself needs Chrome or Edge; here the tagged copy is downloaded instead."}
              </p>
            )}
            {loaded.handle && <p className="text-faint">Chrome checks the whole file before it moves the saved version into place, so saving a big file takes a moment even when only the tail changes.</p>}
            {saved && (
              <p className={cn("inline-flex items-start gap-1.5", saved.how === "file" && saved.verified ? "text-positive" : "text-ink")} data-saved={saved.how}>
                <Check size={14} className="mt-0.5 shrink-0" />
                <span>
                  {saved.how === "file" ? (
                    <>
                      Saved into {loaded.file.name}: {saved.mode === "shift" ? `${formatBytes(saved.copied + saved.written)} rewritten` : `${formatBytes(saved.written)} written`} in {fmtMs(saved.ms)}
                      {saved.verified ? ", and the tags read back as entered." : ". The file read back differently than expected — check it."}
                    </>
                  ) : (
                    <>Download started: a copy of {loaded.file.name} with the new tags. The original is untouched.</>
                  )}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      <p className="text-[12px] text-faint">
        The tags are the iTunes-style atoms ffmpeg writes from <span className="font-mono">-metadata</span>: title, artist, album_artist, album, genre, date, comment, and media_type for the kind. YouTube takes the title from the file; the Music category and the song credits are set on the upload page, and that is what YouTube Music lists by. Exports from the{" "}
        <Link href="/image/editor" className="text-accent underline-offset-2 hover:underline">
          8K drive video editor
        </Link>{" "}
        carry these tags already.
      </p>
    </div>
  );
}
