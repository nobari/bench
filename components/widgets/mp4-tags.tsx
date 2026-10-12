"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, FileVideo, Loader2, Save, Upload, X } from "lucide-react";
import { EMPTY_TAGS, MEDIA_KINDS, blobSource, inspectFile, keptName, kindLabel, planBytes, planTags, sameTags, type FileTags, type Inspection, type WritePlan } from "@/lib/tools/video/tags";
import { COPY_CHUNK, SaveTracker, estimateSave, fmtRough, type SaveProgress, type SaveRates, type SaveStage } from "@/lib/tools/video/tags-progress";
import { fmtBytes, fmtDelta, fmtDuration } from "@/lib/tools/video/progress";
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

/** Rates learned by this tool: how fast this machine writes a copy and reads the result back. */
const SAVE_RATES_KEY = "bench:video:tag-save:v1";
/** Shared with the video editor: the newest close rate from any export or save on this machine serves both. */
const EXPORT_SPEEDS_KEY = "bench:video:export-speeds:v1";
const SHARED_PROFILE = "mp4-tags";

function loadRates(): SaveRates {
  const out: SaveRates = {};
  try {
    const own = JSON.parse(localStorage.getItem(SAVE_RATES_KEY) ?? "null") as { copyBytesPerS?: number; verifyMs?: number; at: number } | null;
    if (own) {
      if (own.copyBytesPerS) out.copyBytesPerS = own.copyBytesPerS;
      if (own.verifyMs) out.verifyMs = own.verifyMs;
      out.label = `your last save (${new Date(own.at).toLocaleDateString()})`;
    }
    const all = JSON.parse(localStorage.getItem(EXPORT_SPEEDS_KEY) ?? "{}") as Record<string, { closeBytesPerS?: number; at: number }>;
    const close = Object.entries(all)
      .filter(([, x]) => x.closeBytesPerS)
      .sort((a, b) => b[1].at - a[1].at)[0];
    if (close) {
      out.closeBytesPerS = close[1].closeBytesPerS;
      out.closeLabel = `${close[0] === SHARED_PROFILE ? "your last save" : "an earlier video export"} (${new Date(close[1].at).toLocaleDateString()})`;
    }
  } catch {
    /* no storage (private window): defaults */
  }
  return out;
}

function storeRates(m: SaveRates) {
  try {
    if (m.copyBytesPerS || m.verifyMs) {
      const prev = JSON.parse(localStorage.getItem(SAVE_RATES_KEY) ?? "{}") as Record<string, number>;
      localStorage.setItem(SAVE_RATES_KEY, JSON.stringify({ ...prev, ...(m.copyBytesPerS ? { copyBytesPerS: m.copyBytesPerS } : {}), ...(m.verifyMs ? { verifyMs: m.verifyMs } : {}), at: Date.now() }));
    }
    if (m.closeBytesPerS) {
      const all = JSON.parse(localStorage.getItem(EXPORT_SPEEDS_KEY) ?? "{}") as Record<string, Record<string, number>>;
      all[SHARED_PROFILE] = { ...all[SHARED_PROFILE], closeBytesPerS: m.closeBytesPerS, at: Date.now() };
      localStorage.setItem(EXPORT_SPEEDS_KEY, JSON.stringify(all));
    }
  } catch {
    /* no storage: the next save starts from the defaults again */
  }
}

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
  /** Bytes written: the whole new file. */
  size: number;
  verified: boolean;
  /** The stages with their actual times, for the record. */
  stages: SaveStage[];
}

interface Job {
  progress: SaveProgress;
  /** Wall-clock finish, from the latest remaining estimate. */
  etaWall: number;
  cancel: () => void;
  cancelled: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtClock(s: number): string {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m} min ${Math.round(r)} s` : `${r.toFixed(r < 10 ? 1 : 0)} s`;
}

/** What a save does to the file, in words. The browser cannot change a file in place, so every save writes the whole file again. */
function describe(plan: WritePlan, fileSize: number): string {
  const { written, copied } = planBytes(plan);
  const whole = `The browser cannot change a file in place, so saving still writes a fresh copy of all ${fmtBytes(plan.size)} and reads it back once to check it before moving it into place.`;
  if (plan.mode === "tail") return `The index sits at the end of the file, so the new index replaces the last ${fmtBytes(written)} and the ${fmtBytes(fileSize - written)} of video and audio before it are copied as they are. ${whole}`;
  if (plan.mode === "fit") return `The index sits at the front with room to spare, so ${fmtBytes(written)} go over it in place and nothing else moves in the file. ${whole}`;
  return `The index sits at the front of the file with no room left, so the file is rewritten with the media (${fmtBytes(copied)}) moved ${fmtBytes(plan.delta)} later — plus 16 kB of spare room so the next edit fits in place. ${whole}`;
}

export function Mp4TagsWidget() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tags, setTags] = useState<FileTags>(EMPTY_TAGS);
  const [busy, setBusy] = useState<null | "reading" | "saving">(null);
  const [job, setJob] = useState<Job | null>(null);
  const [rates, setRates] = useState<SaveRates>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canWriteBack = !!openPicker();

  // Learned rates live in localStorage; read them once the widget is on screen.
  useEffect(() => {
    let on = true;
    queueMicrotask(() => {
      if (on) setRates(loadRates());
    });
    return () => {
      on = false;
    };
  }, []);

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
  const promise = useMemo(() => (plan && "plan" in plan ? estimateSave(plan.plan.size, rates) : null), [plan, rates]);

  const save = async () => {
    if (!loaded?.handle || !plan || "error" in plan) return;
    const { handle, file } = loaded;
    const { plan: p } = plan;
    setError(null);
    setSaved(null);
    setBusy("saving");
    const tracker = new SaveTracker(performance.now(), p.size, rates);
    const flags = { cancelled: false };
    const cancel = () => {
      flags.cancelled = true;
    };
    const prevTitle = document.title;
    const tick = () => {
      const progress = tracker.snapshot(performance.now());
      setJob({ progress, etaWall: Date.now() + progress.remainingMs, cancel, cancelled: flags.cancelled });
      document.title = `${(progress.fraction * 100).toFixed(0)}% · Saving tags · Bench`;
    };
    const timer = setInterval(tick, 250);
    tick();
    try {
      if (handle.requestPermission) {
        const perm = await handle.requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("The browser did not allow writing to this file. Download a tagged copy instead.");
      }
      // Measured: writing the copy ourselves in 64 MB pieces is faster than the browser's own keepExistingData copy, and it is the only way to see progress.
      tracker.begin("copy", performance.now());
      const w = await handle.createWritable();
      try {
        for (const part of p.parts) {
          if ("bytes" in part) {
            await w.write(part.bytes);
            tracker.advance(part.bytes.length);
            tick();
          } else {
            for (let o = part.from; o < part.to; o += COPY_CHUNK) {
              if (flags.cancelled) throw new DOMException("Save cancelled", "AbortError");
              const end = Math.min(part.to, o + COPY_CHUNK);
              await w.write(file.slice(o, end));
              tracker.advance(end - o);
              tick();
            }
          }
        }
      } catch (e) {
        await w.abort().catch(() => undefined);
        throw e;
      }
      tracker.end("copy", performance.now());
      tracker.begin("close", performance.now());
      tick();
      await w.close();
      tracker.end("close", performance.now());
      tracker.begin("verify", performance.now());
      tick();
      const after = await handle.getFile();
      const ins = await inspectFile(blobSource(after));
      tracker.end("verify", performance.now());
      const final = tracker.snapshot(performance.now());
      storeRates(tracker.measured(performance.now()));
      setRates(loadRates());
      const verified = sameTags(ins.tags, tags) && after.size === p.size;
      setLoaded({ ...loaded, file: after, ins });
      setTags(ins.tags);
      setSaved({ how: "file", mode: p.mode, ...planBytes(p), ms: final.elapsedMs, size: p.size, verified, stages: final.stages });
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "Save cancelled. The original file is untouched; the browser discarded the unfinished copy." : message(e));
    } finally {
      clearInterval(timer);
      setJob(null);
      setBusy(null);
      document.title = prevTitle;
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
    setSaved({ how: "download", mode: plan.plan.mode, ...planBytes(plan.plan), ms: 0, size: plan.plan.size, verified: false, stages: [] });
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
                {loaded.info.width}×{loaded.info.height} · {fmtClock(loaded.info.duration)} · {loaded.info.codec ?? "unknown codec"}
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
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-[13px] text-danger" role="alert" data-error>
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
              <select value={kindValue} onChange={(e) => setTag({ kind: e.target.value === "" ? null : Number(e.target.value) })} className={SEL} aria-label="Media kind" disabled={busy === "saving"}>
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
          <fieldset disabled={busy === "saving"} className="grid grid-cols-2 gap-2 p-3 text-[12.5px] sm:grid-cols-3">
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
          </fieldset>
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
            {job ? (
              <SaveProgressView job={job} fileName={loaded.file.name} />
            ) : (
              <>
                {loaded.handle && promise && !("error" in plan) && (
                  <p data-promise={promise.source}>
                    Saving should take <span className="font-medium text-ink">{fmtRough(promise.totalMs)}</span>: the copy, {fmtBytes(plan.plan.size)} at {fmtBytes(promise.copyRate)}/s ({rates.copyBytesPerS ? rates.label : "default guess"}), then the browser’s check at {fmtBytes(promise.closeRate)}/s ({rates.closeBytesPerS ? rates.closeLabel : "default guess until this machine has saved into a folder or exported a video once"}). The estimate firms up as it runs.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void save()} disabled={!loaded.handle || !dirty || busy !== null || "error" in plan} className={PRIMARY} data-save-button>
                    <Save size={14} /> Save into the file
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
                {saved && (
                  <div className={cn("space-y-1", saved.how === "file" && saved.verified ? "text-positive" : "text-ink")} data-saved={saved.how}>
                    <p className="inline-flex items-start gap-1.5">
                      <Check size={14} className="mt-0.5 shrink-0" />
                      <span>
                        {saved.how === "file" ? (
                          <>
                            Saved into {loaded.file.name}: {fmtBytes(saved.size)} written in {fmtDuration(saved.ms)}
                            {saved.verified ? ", and the tags read back as entered." : ". The file read back differently than expected — check it."}
                          </>
                        ) : (
                          <>Download started: a copy of {loaded.file.name} with the new tags. The original is untouched. The download manager shows its progress; nothing here can measure it.</>
                        )}
                      </span>
                    </p>
                    {saved.how === "file" && (
                      <ul className="ml-5 space-y-0.5 text-[12px] text-muted" data-saved-stages>
                        {saved.stages.map((s) => (
                          <li key={s.id}>
                            {s.title}: {fmtDuration(s.elapsedMs)}
                            {s.id === "verify" ? "" : ` · ${s.basis}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
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

const STATUS_DOT: Record<SaveStage["status"], string> = { pending: "bg-edge", running: "bg-accent", done: "bg-positive" };

function SaveProgressView({ job, fileName }: { job: Job; fileName: string }) {
  const p = job.progress;
  const current = p.stages.find((s) => s.id === p.current) ?? null;
  const pct = Math.min(100, Math.max(0, p.fraction * 100));
  return (
    <div className="space-y-3" data-save-progress data-stage={p.current ?? "none"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[13.5px] font-medium text-ink" data-stage-title>
          <Loader2 size={14} className="animate-spin text-accent" />
          {current ? current.title : "Starting"} — {fileName}
        </span>
        <span className="tabular text-[13px] text-ink" data-pct>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      {current && <p className="text-muted" data-stage-detail>{current.detail}.</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-5">
        <div>
          <dt className="readout">Elapsed</dt>
          <dd className="tabular text-ink" data-elapsed>{fmtDuration(p.elapsedMs)}</dd>
        </div>
        <div>
          <dt className="readout">Remaining</dt>
          <dd className="tabular text-ink" data-remaining>≈ {fmtDuration(p.remainingMs)}</dd>
        </div>
        <div>
          <dt className="readout">Expected finish</dt>
          <dd className="tabular text-ink">{new Date(job.etaWall).toLocaleTimeString()}</dd>
        </div>
        <div>
          <dt className="readout">Written</dt>
          <dd className="tabular text-ink" data-bytes>
            {fmtBytes(p.bytesDone)} / {fmtBytes(p.bytesTotal)}
          </dd>
        </div>
        <div>
          <dt className="readout">Speed</dt>
          <dd className="tabular text-ink" data-speed>{p.throughput ? `${fmtBytes(p.throughput)}/s` : current?.id === "copy" ? "measuring…" : "—"}</dd>
        </div>
      </dl>
      <ol className="space-y-1.5" data-stages>
        {p.stages.map((s) => (
          <li key={s.id} className={cn("flex items-start gap-2", s.status === "pending" && "text-faint")} data-stage-row={s.id} data-status={s.status}>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_DOT[s.status], s.status === "running" && "animate-pulse")} />
            <span className="min-w-0">
              <span className={cn("font-medium", s.status === "pending" ? "text-muted" : "text-ink")}>{s.title}</span>
              <span className="text-muted">
                {" · "}
                {s.status === "done" ? `${fmtDuration(s.elapsedMs)} (${fmtDelta(s.elapsedMs, s.estimateMs)} against the promise)` : s.status === "running" ? `${fmtDuration(s.elapsedMs)} so far, ≈ ${fmtDuration(s.remainingMs)} left` : `≈ ${fmtDuration(s.estimateMs)}`}
              </span>
              <span className="block text-[11.5px] text-faint" data-basis>
                {s.basis}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={job.cancel} disabled={job.cancelled || p.current !== "copy"} className={GHOST} data-cancel-button>
          <X size={12} /> {job.cancelled ? "Cancelling…" : "Cancel"}
        </button>
        <span className="text-[12px] text-faint">{p.current === "copy" ? "Cancelling discards the unfinished copy; the original is untouched." : "The browser is now checking the copy; this part cannot be interrupted."}</span>
      </div>
    </div>
  );
}
