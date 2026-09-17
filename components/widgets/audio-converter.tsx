"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { AlertTriangle, Download, Loader, Trash2, Upload } from "lucide-react";
import {
  OUTPUT_FORMATS,
  SAMPLE_RATES,
  WAV_DEPTHS,
  convertAudio,
  encodableFormats,
  probeAudio,
  type AudioInfo,
  type ConvertResult,
  type OutputId,
} from "@/lib/tools/audio/convert";
import { formatBytes, formatDuration } from "@/lib/tools/audio/music";
import type { AudioCodec, MetadataTags } from "mediabunny";
import { cn } from "@/lib/utils";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";

interface Job {
  id: number;
  file: File;
  info?: AudioInfo;
  infoError?: string;
  status: "idle" | "converting" | "done" | "error";
  progress: number;
  result?: ConvertResult;
  url?: string;
  error?: string;
}

function parseTime(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function AudioConverterWidget() {
  const [fmt, setFmt] = useQueryState("fmt", parseAsString.withDefault("mp3").withOptions({ history: "replace" }));
  const [br, setBr] = useQueryState("br", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [sr, setSr] = useQueryState("sr", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [ch, setCh] = useQueryState("ch", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [depth, setDepth] = useQueryState("bd", parseAsString.withDefault("pcm-s16").withOptions({ history: "replace" }));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [support, setSupport] = useState<Record<OutputId, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [gain, setGain] = useState(0);
  const [normalize, setNormalize] = useState(false);
  const [stripTags, setStripTags] = useState(false);
  const [tagEdits, setTagEdits] = useState<{ title: string; artist: string; album: string }>({ title: "", artist: "", album: "" });
  const idRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  const def = OUTPUT_FORMATS.find((f) => f.id === fmt) ?? OUTPUT_FORMATS[0];
  const bitrate = br || def.defaultBitrate;

  useEffect(() => {
    let active = true;
    encodableFormats().then((s) => active && setSupport(s)).catch(() => active && setSupport(null));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  const patch = (id: number, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    const files = Array.from(list);
    const fresh: Job[] = files.map((file) => ({ id: ++idRef.current, file, status: "idle", progress: 0 }));
    setJobs((js) => [...js, ...fresh]);
    for (const j of fresh) {
      probeAudio(j.file)
        .then((info) => patch(j.id, { info }))
        .catch((e: unknown) => patch(j.id, { infoError: e instanceof Error ? e.message : "Couldn't read this file." }));
    }
  }

  async function convertAll() {
    setBusy(true);
    const single = jobs.length === 1;
    for (const job of jobs) {
      if (job.status === "converting") continue;
      patch(job.id, { status: "converting", progress: 0, error: undefined, result: undefined, url: undefined });
      try {
        const edits: MetadataTags = {};
        if (single) {
          if (tagEdits.title.trim()) edits.title = tagEdits.title.trim();
          if (tagEdits.artist.trim()) edits.artist = tagEdits.artist.trim();
          if (tagEdits.album.trim()) edits.album = tagEdits.album.trim();
        }
        const result = await convertAudio(
          job.file,
          {
            format: def.id,
            bitrateKbps: bitrate,
            sampleRate: sr || undefined,
            channels: ch || undefined,
            wavCodec: depth as AudioCodec,
            trimStart: single ? parseTime(trimStart) : 0,
            trimEnd: single ? parseTime(trimEnd) : 0,
            gainDb: gain,
            normalize,
            tags: stripTags ? null : Object.keys(edits).length ? edits : undefined,
          },
          (p) => patch(job.id, { progress: p }),
        );
        const url = URL.createObjectURL(result.blob);
        urlsRef.current.push(url);
        patch(job.id, { status: "done", progress: 1, result, url });
      } catch (e) {
        patch(job.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
  }

  function downloadJob(job: Job) {
    if (!job.url || !job.result) return;
    const a = document.createElement("a");
    a.href = job.url;
    a.download = job.result.name;
    a.click();
  }

  const done = jobs.filter((j) => j.status === "done");
  const canConvert = jobs.length > 0 && !busy && (support ? support[def.id] : true);
  const singleInfo = jobs.length === 1 ? jobs[0].info : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* sources & results */}
      <div className="panel flex min-h-[280px] flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Files {jobs.length > 0 && `· ${jobs.length}`}</span>
          {jobs.length > 0 && (
            <button type="button" onClick={() => setJobs([])} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger disabled:opacity-40">
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="audio/*,video/*,.flac,.ogg,.opus,.m4a,.aac,.wav,.aiff,.mp3,.webm,.mp4,.mov,.mkv" multiple hidden onChange={(e) => addFiles(e.target.files)} />
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
            addFiles(e.dataTransfer.files);
          }}
          className={cn("m-3 flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-edge bg-base p-5 text-center", jobs.length === 0 && "flex-1", dragOver && "border-accent")}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-edge text-accent">
            <Upload size={17} />
          </span>
          <span className="text-[15px] font-medium text-ink">{jobs.length ? "Add more files" : "Drop audio or video files here"}</span>
          <span className="max-w-sm text-[12.5px] text-faint">MP3, WAV, FLAC, AAC/M4A, Ogg, Opus, WebM, MP4/MOV (audio track) — converted in your browser, nothing uploaded.</span>
        </button>

        {jobs.length > 0 && (
          <ul className="divide-y divide-edge border-t border-edge">
            {jobs.map((job) => (
              <li key={job.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{job.file.name}</span>
                  <span className="font-mono text-[12px] text-faint">{formatBytes(job.file.size)}</span>
                  <button type="button" onClick={() => setJobs((js) => js.filter((j) => j.id !== job.id))} disabled={busy} className="ml-auto text-faint hover:text-danger disabled:opacity-40" aria-label="Remove">
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="mt-0.5 font-mono text-[12px] text-muted">
                  {job.info
                    ? `${job.info.container} · ${job.info.codec ?? "unknown codec"} · ${job.info.sampleRate.toLocaleString()} Hz · ${job.info.channels === 1 ? "mono" : job.info.channels === 2 ? "stereo" : `${job.info.channels} ch`} · ${formatDuration(job.info.duration)}${job.info.bitrateKbps ? ` · ${Math.round(job.info.bitrateKbps)} kbps` : ""}${job.info.hasVideo ? " · video track dropped" : ""}`
                    : job.infoError
                      ? job.infoError
                      : "Reading…"}
                </p>
                {job.info?.tags.title || job.info?.tags.artist ? (
                  <p className="text-[12px] text-faint">
                    {[job.info.tags.artist, job.info.tags.title].filter(Boolean).join(" — ")}
                    {job.info.tags.album ? ` · ${job.info.tags.album}` : ""}
                  </p>
                ) : null}
                {job.status === "converting" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                )}
                {job.status === "error" && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-danger">
                    <AlertTriangle size={13} /> {job.error}
                  </p>
                )}
                {job.status === "done" && job.result && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <audio controls preload="metadata" src={job.url} className="h-8 max-w-full" />
                    <span className="font-mono text-[12px] text-muted">
                      {job.result.name} · {formatBytes(job.result.bytes)}
                      {job.result.peakDb !== null ? ` · peak was ${job.result.peakDb.toFixed(1)} dBFS` : ""}
                    </span>
                    <button type="button" onClick={() => downloadJob(job)} className={cn(GHOST, "h-7 px-2.5 text-[12.5px]")}>
                      <Download size={12} /> Download
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* settings */}
      <div className="flex flex-col gap-3">
        <div className="panel space-y-3 p-3">
          <span className="readout">Output</span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
            {OUTPUT_FORMATS.map((f) => {
              const ok = support ? support[f.id] : true;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFmt(f.id === "mp3" ? null : f.id);
                    setBr(null);
                  }}
                  disabled={!ok}
                  title={ok ? f.note : "Not supported by this browser"}
                  className={cn(
                    "flex flex-col items-start rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors disabled:opacity-40",
                    def.id === f.id ? "border-accent bg-accent-soft" : "border-edge hover:border-edge-bright",
                  )}
                >
                  <span className="text-[13px] font-medium text-ink">{f.label}</span>
                  <span className="text-[11.5px] text-faint">{ok ? f.note : "Not available here"}</span>
                </button>
              );
            })}
          </div>
          {def.lossy ? (
            <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
              Bitrate
              <select value={bitrate} onChange={(e) => setBr(Number(e.target.value) === def.defaultBitrate ? null : Number(e.target.value))} className={SEL}>
                {def.bitrates.map((b) => (
                  <option key={b} value={b}>
                    {b} kbps
                  </option>
                ))}
              </select>
            </label>
          ) : def.id === "wav" ? (
            <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
              Bit depth
              <select value={depth} onChange={(e) => setDepth(e.target.value === "pcm-s16" ? null : e.target.value)} className={SEL}>
                {WAV_DEPTHS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
            Sample rate
            <select value={sr} onChange={(e) => setSr(Number(e.target.value) || null)} className={SEL}>
              <option value={0}>keep source</option>
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString()} Hz
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
            Channels
            <select value={ch} onChange={(e) => setCh(Number(e.target.value) || null)} className={SEL}>
              <option value={0}>keep source</option>
              <option value={1}>mono</option>
              <option value={2}>stereo</option>
            </select>
          </label>
        </div>

        <details className="panel p-3" open={jobs.length === 1}>
          <summary className="readout cursor-pointer select-none">Trim, level & tags</summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12.5px] text-muted">
                Start (m:ss)
                <input value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="0:00" disabled={jobs.length > 1} className={cn(INPUT, "mt-1 font-mono")} />
              </label>
              <label className="text-[12.5px] text-muted">
                End (m:ss)
                <input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder={singleInfo ? formatDuration(singleInfo.duration) : "end"} disabled={jobs.length > 1} className={cn(INPUT, "mt-1 font-mono")} />
              </label>
            </div>
            <label className="block text-[12.5px] text-muted">
              <span className="flex items-center justify-between">
                Gain <span className="font-mono tabular">{gain > 0 ? "+" : ""}{gain} dB</span>
              </span>
              <input type="range" min={-24} max={12} step={0.5} value={gain} onChange={(e) => setGain(Number(e.target.value))} className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="accent-[var(--accent)]" />
              Normalise peaks to −1 dBFS (adds a measuring pass)
            </label>
            <div className="grid gap-2">
              {(["title", "artist", "album"] as const).map((k) => (
                <label key={k} className="text-[12.5px] capitalize text-muted">
                  {k}
                  <input
                    value={tagEdits[k]}
                    onChange={(e) => setTagEdits((t) => ({ ...t, [k]: e.target.value }))}
                    placeholder={singleInfo?.tags[k] ?? (jobs.length > 1 ? "kept per file" : "keep")}
                    disabled={jobs.length > 1 || stripTags}
                    className={cn(INPUT, "mt-1")}
                  />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={stripTags} onChange={(e) => setStripTags(e.target.checked)} className="accent-[var(--accent)]" />
              Strip all metadata (tags, cover art)
            </label>
            {jobs.length > 1 && <p className="text-[12px] text-faint">Trim and tag edits apply when converting a single file.</p>}
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void convertAll()} disabled={!canConvert} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:opacity-40">
            {busy ? <Loader size={14} className="animate-spin" /> : null}
            Convert {jobs.length > 1 ? `${jobs.length} files` : ""} to {def.label.split(" ·")[0]}
          </button>
          {done.length > 1 && (
            <button type="button" onClick={() => done.forEach(downloadJob)} className={GHOST}>
              <Download size={13} /> Download all
            </button>
          )}
          {support && !support[def.id] && <span className="text-[12.5px] text-warn">This browser can&apos;t encode {def.label} — pick another format.</span>}
        </div>
      </div>
    </div>
  );
}
