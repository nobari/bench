"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { AlertTriangle, Archive, Download, FolderDown, Loader, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  AUDIO_CODEC_LABELS,
  AUDIO_KBPS,
  CONTAINERS,
  DEFAULT_SETTINGS,
  FRAME_RATES,
  HEIGHTS,
  PRESETS,
  QUALITY_LEVELS,
  RATE_LABELS,
  SAMPLE_RATES,
  VIDEO_CODEC_LABELS,
  VIDEO_CODEC_NOTES,
  containerById,
  convertMedia,
  encodableCodecs,
  estimateBytes,
  fmtBytes,
  fmtClock,
  outputName,
  outputSize,
  parseClock,
  pictureReencoded,
  probeMedia,
  soundReencoded,
  type ContainerId,
  type ConvertResult,
  type ConvertSettings,
  type Crop,
  type Fit,
  type Hardware,
  type MediaInfo,
  type RateMode,
  type Support,
} from "@/lib/tools/video/convert";
import { buildZip } from "@/lib/tools/files/zip-write";
import { cn } from "@/lib/utils";
import { useUnsavedWork } from "@/lib/unsaved-work";
import type { AudioCodec, Rotation, StreamTargetChunk, VideoCodec } from "mediabunny";
import { SplitPane } from "@/components/ui/split-pane";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const CONTAINER_IDS = CONTAINERS.map((c) => c.id) as [ContainerId, ...ContainerId[]];
const RATES = ["quality", "bitrate", "size"] as const;
const FITS = ["contain", "cover", "fill"] as const;
const HARDWARE = ["no-preference", "prefer-hardware", "prefer-software"] as const;
const VIDEO_CODECS = ["auto", "avc", "hevc", "av1", "vp9", "vp8"] as const;
const AUDIO_CODECS = ["auto", "aac", "opus", "mp3", "flac", "pcm-s16"] as const;
const ROTATIONS = [0, 90, 180, 270] as const;

interface Job {
  id: number;
  file: File;
  info?: MediaInfo;
  infoError?: string;
  status: "idle" | "converting" | "done" | "error" | "cancelled";
  progress: number;
  /** Seconds of media done and when it started, for the speed; the encoding pass under way. */
  processed?: number;
  startedAt?: number;
  pass?: number;
  result?: ConvertResult;
  url?: string;
  error?: string;
}

type Destination = "download" | "folder";

/** Where a batch goes instead of a picked folder: tests hand a directory in here. */
let testDirectory: FileSystemDirectoryHandle | null = null;

export function VideoConverterWidget() {
  const [container, setContainer] = useQueryState("fmt", parseAsStringLiteral(CONTAINER_IDS).withDefault("mp4").withOptions({ history: "replace" }));
  const [videoCodec, setVideoCodec] = useQueryState("vc", parseAsStringLiteral(VIDEO_CODECS).withDefault("auto").withOptions({ history: "replace" }));
  const [audioCodec, setAudioCodec] = useQueryState("ac", parseAsStringLiteral(AUDIO_CODECS).withDefault("auto").withOptions({ history: "replace" }));
  const [rate, setRate] = useQueryState("rate", parseAsStringLiteral(RATES).withDefault("quality").withOptions({ history: "replace" }));
  const [quality, setQuality] = useQueryState("q", parseAsInteger.withDefault(DEFAULT_SETTINGS.quality).withOptions({ history: "replace" }));
  const [videoKbps, setVideoKbps] = useQueryState("vb", parseAsInteger.withDefault(DEFAULT_SETTINGS.videoKbps).withOptions({ history: "replace" }));
  const [targetMb, setTargetMb] = useQueryState("mb", parseAsInteger.withDefault(DEFAULT_SETTINGS.targetMb).withOptions({ history: "replace" }));
  const [height, setHeight] = useQueryState("h", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [width, setWidth] = useQueryState("w", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [fit, setFit] = useQueryState("fit", parseAsStringLiteral(FITS).withDefault("contain").withOptions({ history: "replace" }));
  const [fps, setFps] = useQueryState("fps", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [rotate, setRotate] = useQueryState("rot", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [keyframeSeconds, setKeyframeSeconds] = useQueryState("kf", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [hardware, setHardware] = useQueryState("hw", parseAsStringLiteral(HARDWARE).withDefault("no-preference").withOptions({ history: "replace" }));
  const [noVideo, setNoVideo] = useQueryState("nov", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const [noAudio, setNoAudio] = useQueryState("noa", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const [forceTranscode, setForceTranscode] = useQueryState("force", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const [audioKbps, setAudioKbps] = useQueryState("ab", parseAsInteger.withDefault(DEFAULT_SETTINGS.audioKbps).withOptions({ history: "replace" }));
  const [sampleRate, setSampleRate] = useQueryState("sr", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [channels, setChannels] = useQueryState("ch", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [tagsMode, setTagsMode] = useQueryState("tags", parseAsString.withDefault("keep").withOptions({ history: "replace" }));
  // Per-file things stay out of the link.
  const [crop, setCrop] = useState<Crop | null>(null);
  const [cropOn, setCropOn] = useState(false);
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [gainDb, setGainDb] = useState(0);
  const [normalize, setNormalize] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [destination, setDestination] = useState<Destination>("download");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [support, setSupport] = useState<Support | null>(null);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;
  useUnsavedWork(busy ? "A conversion is running; leaving now would abandon it." : jobs.length ? "The loaded files and their conversions would be lost." : null);

  const def = containerById(container);
  const canPickFolder = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const settings: ConvertSettings = useMemo(
    () => ({
      container,
      videoCodec: videoCodec as ConvertSettings["videoCodec"],
      audioCodec: audioCodec as ConvertSettings["audioCodec"],
      rate: rate as RateMode,
      quality: Math.min(5, Math.max(1, quality)),
      videoKbps: Math.max(100, videoKbps),
      targetMb: Math.max(1, targetMb),
      height,
      width,
      fit: fit as Fit,
      fps,
      rotate: (ROTATIONS as readonly number[]).includes(rotate) ? (rotate as Rotation) : 0,
      crop: cropOn && crop && crop.width > 0 && crop.height > 0 ? crop : null,
      keyframeSeconds,
      hardware: hardware as Hardware,
      noVideo,
      noAudio,
      forceTranscode,
      audioKbps,
      sampleRate,
      channels,
      gainDb,
      normalize,
      trimStart: parseClock(trimStart),
      trimEnd: parseClock(trimEnd),
      tags: tagsMode === "strip" ? "strip" : "keep",
      title,
      artist,
    }),
    [container, videoCodec, audioCodec, rate, quality, videoKbps, targetMb, height, width, fit, fps, rotate, cropOn, crop, keyframeSeconds, hardware, noVideo, noAudio, forceTranscode, audioKbps, sampleRate, channels, gainDb, normalize, trimStart, trimEnd, tagsMode, title, artist],
  );

  useEffect(() => {
    let active = true;
    encodableCodecs()
      .then((s) => active && setSupport(s))
      .catch(() => active && setSupport(null));
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
  useEffect(() => {
    const hooks = {
      addFiles: (files: File[]) => addFiles(files),
      convertAll: () => convertAll(),
      cancel: () => abortRef.current?.abort(),
      getJobs: () => jobsRef.current,
      getSettings: () => settings,
      support: () => support,
      setCrop: (c: Crop | null) => {
        setCrop(c);
        setCropOn(!!c);
      },
      setTrim: (start: string, end: string) => {
        setTrimStart(start);
        setTrimEnd(end);
      },
      setGain: (db: number, norm: boolean) => {
        setGainDb(db);
        setNormalize(norm);
      },
      useDirectory: (dir: FileSystemDirectoryHandle | null) => {
        testDirectory = dir;
        setDestination(dir ? "folder" : "download");
      },
    };
    (window as unknown as { __benchConvert?: unknown }).__benchConvert = hooks;
  });

  const patch = (id: number, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    const fresh: Job[] = Array.from(list).map((file) => ({ id: ++idRef.current, file, status: "idle", progress: 0 }));
    setJobs((js) => [...js, ...fresh]);
    for (const j of fresh) {
      probeMedia(j.file)
        .then((info) => patch(j.id, { info }))
        .catch((e: unknown) => patch(j.id, { infoError: e instanceof Error ? e.message : "Couldn't read this file." }));
    }
  }

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const s = { ...DEFAULT_SETTINGS, ...p.patch };
    // The smallest-file preset takes the best codec this browser encodes.
    if (p.id === "small" && support) s.videoCodec = support.video.av1 ? "av1" : support.video.hevc ? "hevc" : "vp9";
    if (p.id === "small" && s.videoCodec === "vp9") {
      s.container = "webm";
      s.audioCodec = "opus";
    }
    void setContainer(s.container);
    void setVideoCodec(s.videoCodec as (typeof VIDEO_CODECS)[number]);
    void setAudioCodec(s.audioCodec as (typeof AUDIO_CODECS)[number]);
    void setRate(s.rate);
    void setQuality(s.quality);
    void setVideoKbps(s.videoKbps);
    void setHeight(s.height);
    void setWidth(0);
    void setFps(s.fps);
    void setRotate(s.rotate);
    void setNoVideo(s.noVideo);
    void setNoAudio(s.noAudio);
    void setForceTranscode(s.forceTranscode);
    void setAudioKbps(s.audioKbps);
    setCropOn(false);
    setGainDb(s.gainDb);
    setNormalize(s.normalize);
  };

  const pickFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (testDirectory) return testDirectory;
    try {
      return await (window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return null;
    }
  };

  async function convertAll() {
    const todo = jobsRef.current.filter((j) => j.status !== "converting");
    if (!todo.length || busy) return;
    let dir: FileSystemDirectoryHandle | null = null;
    if (destination === "folder") {
      dir = await pickFolder();
      if (!dir) setNote("No folder was chosen — the files stay in memory and download when done.");
    }
    setBusy(true);
    setNote(null);
    const abort = new AbortController();
    abortRef.current = abort;
    const single = todo.length === 1;
    try {
      for (const job of todo) {
        if (abort.signal.aborted) break;
        if (!job.info) {
          patch(job.id, { status: "error", error: job.infoError ?? "The file is still being read — try again in a moment." });
          continue;
        }
        patch(job.id, { status: "converting", progress: 0, processed: 0, startedAt: performance.now(), error: undefined, result: undefined, url: undefined });
        const s: ConvertSettings = single ? settings : { ...settings, trimStart: 0, trimEnd: 0, crop: null, title: "", artist: "" };
        try {
          let writable: FileSystemWritableFileStream | null = null;
          if (dir) {
            const handle = await dir.getFileHandle(outputName(job.file.name, def), { create: true });
            writable = await handle.createWritable();
          }
          const result = await convertMedia(
            job.file,
            job.info,
            s,
            writable ? { kind: "stream", writable: writable as unknown as WritableStream<StreamTargetChunk> } : { kind: "memory" },
            (p, t, pass) => patch(job.id, { progress: p, processed: t, pass }),
            abort.signal,
          );
          let url: string | undefined;
          if (result.blob) {
            url = URL.createObjectURL(result.blob);
            urlsRef.current.push(url);
          }
          patch(job.id, { status: "done", progress: 1, result, url });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") patch(job.id, { status: "cancelled", error: "Cancelled." });
          else patch(job.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function downloadJob(job: Job) {
    if (!job.url || !job.result) return;
    const a = document.createElement("a");
    a.href = job.url;
    a.download = job.result.name;
    a.click();
  }

  async function downloadZip() {
    const done = jobsRef.current.filter((j) => j.status === "done" && j.result?.blob);
    if (!done.length) return;
    setZipping(true);
    try {
      const entries = await Promise.all(done.map(async (j) => ({ name: j.result!.name, data: new Uint8Array(await j.result!.blob!.arrayBuffer()), mtime: Date.now() })));
      const zip = await buildZip(entries);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      urlsRef.current.push(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = "converted.zip";
      a.click();
    } finally {
      setZipping(false);
    }
  }

  const done = jobs.filter((j) => j.status === "done");
  const inMemory = done.filter((j) => j.result?.blob);
  const first = jobs.find((j) => j.info)?.info ?? null;
  const single = jobs.length === 1 ? jobs[0].info : undefined;
  const videoOk = (c: VideoCodec) => (support ? support.video[c] : true);
  const audioOk = (c: AudioCodec) => (support ? support.audio[c] !== false : true);
  const chosenVideo = videoCodec !== "auto" && def.kind === "video" && !noVideo ? (videoCodec as VideoCodec) : null;
  const chosenAudio = audioCodec !== "auto" && !noAudio ? (audioCodec as AudioCodec) : null;
  const codecProblem =
    chosenVideo && !def.video.includes(chosenVideo)
      ? `${def.label} does not take ${VIDEO_CODEC_LABELS[chosenVideo]}`
      : chosenVideo && !videoOk(chosenVideo)
        ? `This browser cannot encode ${VIDEO_CODEC_LABELS[chosenVideo]}`
        : chosenAudio && !def.audio.includes(chosenAudio)
          ? `${def.label} does not take ${AUDIO_CODEC_LABELS[chosenAudio] ?? chosenAudio}`
          : chosenAudio && !audioOk(chosenAudio)
            ? `This browser cannot encode ${AUDIO_CODEC_LABELS[chosenAudio] ?? chosenAudio}`
            : null;
  const estimate = first ? estimateBytes(first, settings, def) : null;
  const outSize = first ? outputSize(first, settings) : null;
  const pictureCopied = !!first && def.kind === "video" && !noVideo && !!first.video && !pictureReencoded(settings, first, def);
  const soundCopied = !!first && !noAudio && !!first.audio && !soundReencoded(settings, first, def);
  const canConvert = jobs.length > 0 && !busy && !codecProblem;
  const speedOf = (j: Job) => (j.processed && j.startedAt ? j.processed / Math.max(0.001, (performance.now() - j.startedAt) / 1000) : null);

  return (
    <SplitPane id="video-converter" defaultRatio={0.600} minFirst={260} minSecond={260} collapsible="both" firstLabel="files" secondLabel="settings" stackBelow="lg" gap={12} first={<><div className="panel flex min-h-[320px] flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Files {jobs.length > 0 && `· ${jobs.length}`}</span>
          <div className="flex items-center gap-3">
            {busy && (
              <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger" data-convert-cancel>
                <X size={12} /> Cancel
              </button>
            )}
            {jobs.length > 0 && (
              <button type="button" onClick={() => setJobs([])} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger disabled:opacity-40">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.ts,.mts,.m2ts,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
          data-convert-input
        />
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
          <span className="text-[15px] font-medium text-ink">{jobs.length ? "Add more files" : "Drop video or audio files here"}</span>
          <span className="max-w-sm text-[12.5px] text-faint">MP4, MOV, MKV, WebM, MPEG-TS, MP3, WAV, FLAC, Ogg… converted in your browser, nothing uploaded. Large files welcome: with a folder as the destination they stream straight to disk.</span>
        </button>

        {jobs.length > 0 && (
          <ul className="divide-y divide-edge border-t border-edge" data-convert-jobs>
            {jobs.map((job) => (
              <li key={job.id} className="px-3 py-2.5" data-convert-job={job.status}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{job.file.name}</span>
                  <span className="font-mono text-[12px] text-faint">{fmtBytes(job.file.size)}</span>
                  <button type="button" onClick={() => setJobs((js) => js.filter((j) => j.id !== job.id))} disabled={busy} className="ml-auto text-faint hover:text-danger disabled:opacity-40" aria-label="Remove">
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="mt-0.5 font-mono text-[12px] text-muted" data-convert-info>
                  {job.info
                    ? [
                        job.info.container,
                        job.info.video
                          ? `${job.info.video.codec ? VIDEO_CODEC_LABELS[job.info.video.codec] : "unknown picture"} ${job.info.video.width}×${job.info.video.height}${job.info.video.fps ? ` ${job.info.video.fps} fps` : ""}${job.info.video.rotation ? ` ↻${job.info.video.rotation}°` : ""}`
                          : "no picture",
                        job.info.audio
                          ? `${job.info.audio.codec ? (AUDIO_CODEC_LABELS[job.info.audio.codec] ?? job.info.audio.codec) : "sound"} ${job.info.audio.sampleRate.toLocaleString()} Hz ${job.info.audio.channels === 1 ? "mono" : job.info.audio.channels === 2 ? "stereo" : `${job.info.audio.channels} ch`}`
                          : "no sound",
                        fmtClock(job.info.duration),
                        job.info.bitrateKbps ? `${(job.info.bitrateKbps / 1000).toFixed(job.info.bitrateKbps >= 1000 ? 1 : 2)} Mbit/s` : null,
                        job.info.video && !job.info.video.canDecode ? "picture not decodable here" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : job.infoError
                      ? job.infoError
                      : "Reading…"}
                </p>
                {job.status === "converting" && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                    </div>
                    <p className="mt-1 font-mono text-[11.5px] text-faint" data-convert-progress>
                      {Math.round(job.progress * 100)}%{job.processed ? ` · ${fmtClock(job.processed)}` : ""}
                      {speedOf(job) ? ` · ${speedOf(job)!.toFixed(1)}× realtime` : ""}
                      {job.pass && job.pass > 1 ? ` · pass ${job.pass}: correcting the size` : ""}
                    </p>
                  </div>
                )}
                {(job.status === "error" || job.status === "cancelled") && (
                  <p className={cn("mt-1.5 flex items-center gap-1.5 text-[12.5px]", job.status === "error" ? "text-danger" : "text-muted")}>
                    {job.status === "error" && <AlertTriangle size={13} />} {job.error}
                  </p>
                )}
                {job.status === "done" && job.result && (
                  <div className="mt-2 space-y-1.5" data-convert-result>
                    {job.url &&
                      (job.result.video ? (
                        <video controls preload="metadata" src={job.url} className="max-h-48 max-w-full rounded-[var(--radius-sm)] bg-black" />
                      ) : (
                        <audio controls preload="metadata" src={job.url} className="h-8 max-w-full" />
                      ))}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-muted" data-convert-summary>
                        {job.result.name} · {fmtBytes(job.result.bytes)} ({Math.round((job.result.bytes / job.file.size) * 100)}% of the source)
                        {job.result.video ? ` · ${job.result.video.copied ? "picture copied" : `picture ${VIDEO_CODEC_LABELS[job.result.video.codec as VideoCodec] ?? job.result.video.codec}`}` : ""}
                        {job.result.audio ? ` · ${job.result.audio.copied ? "sound copied" : `sound ${AUDIO_CODEC_LABELS[job.result.audio.codec as AudioCodec] ?? job.result.audio.codec}`}` : ""}
                        {job.result.peakDb !== null ? ` · peak was ${job.result.peakDb.toFixed(1)} dBFS` : ""}
                        {job.result.passes > 1 ? ` · ${job.result.passes} passes` : ""}
                        {!job.url ? " · written to the folder" : ""}
                      </span>
                      {job.url && (
                        <button type="button" onClick={() => downloadJob(job)} className={cn(GHOST, "h-7 px-2.5 text-[12.5px]")} data-convert-download>
                          <Download size={12} /> Download
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div></>} second={<><div className="flex flex-col gap-3">
        <div className="panel space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-1.5" data-convert-presets>
            <span className="readout mr-1">Presets</span>
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id)} title={p.note} className={cn(GHOST, "h-7 px-2 text-[12px]")} data-preset={p.id}>
                <Sparkles size={11} /> {p.label}
              </button>
            ))}
          </div>
          <span className="readout">Output</span>
          <div className="grid grid-cols-3 gap-1.5" data-convert-containers>
            {CONTAINERS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void setContainer(c.id)}
                title={c.note}
                className={cn("flex flex-col items-start rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors", def.id === c.id ? "border-accent bg-accent-soft" : "border-edge hover:border-edge-bright")}
                data-container={c.id}
              >
                <span className="text-[13px] font-medium text-ink">{c.label}</span>
                <span className="text-[11px] text-faint">{c.kind === "audio" ? "audio only" : c.note}</span>
              </button>
            ))}
          </div>
          {def.kind === "video" && (
            <>
              <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
                Picture codec
                <select value={videoCodec} onChange={(e) => void setVideoCodec(e.target.value as (typeof VIDEO_CODECS)[number])} className={SEL} disabled={noVideo} aria-label="Video codec" data-convert-vcodec>
                  <option value="auto">keep when it fits, else {VIDEO_CODEC_LABELS[def.video[0]]}</option>
                  {def.video.map((c) => (
                    <option key={c} value={c} disabled={!videoOk(c)}>
                      {VIDEO_CODEC_LABELS[c]}
                      {!videoOk(c) ? " — not in this browser" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {videoCodec !== "auto" && !noVideo && <p className="text-[12px] text-faint">{VIDEO_CODEC_NOTES[videoCodec as VideoCodec]}.</p>}
              <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5" data-convert-rate>
                {RATES.map((r) => (
                  <button key={r} type="button" onClick={() => void setRate(r)} className={cn("h-6 flex-1 rounded-[3px] px-2 text-[12.5px] transition-colors", rate === r ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")} data-rate={r}>
                    {RATE_LABELS[r]}
                  </button>
                ))}
              </div>
              {rate === "quality" && (
                <label className="block text-[12.5px] text-muted">
                  <span className="flex items-center justify-between">
                    Quality <span className="font-mono tabular">{QUALITY_LEVELS.find((q) => q.value === settings.quality)?.label}</span>
                  </span>
                  <input type="range" min={1} max={5} step={1} value={settings.quality} onChange={(e) => void setQuality(Number(e.target.value))} className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" aria-label="Quality level" />
                </label>
              )}
              {rate === "bitrate" && (
                <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
                  Video bitrate
                  <span className="flex items-center gap-1">
                    <input type="number" min={100} step={100} value={videoKbps} onChange={(e) => void setVideoKbps(Number(e.target.value) || 100)} className={cn(INPUT, "w-28 font-mono")} aria-label="Video bitrate (kbit/s)" data-convert-kbps />
                    <span className="text-faint">kbit/s</span>
                  </span>
                </label>
              )}
              {rate === "size" && (
                <label className="flex items-center justify-between gap-2 text-[13px] text-muted">
                  Target size
                  <span className="flex items-center gap-1">
                    <input type="number" min={1} step={1} value={targetMb} onChange={(e) => void setTargetMb(Number(e.target.value) || 1)} className={cn(INPUT, "w-24 font-mono")} aria-label="Target size (MB)" data-convert-mb />
                    <span className="text-faint">MB per file</span>
                  </span>
                </label>
              )}
              {rate === "size" && <p className="text-[12px] text-faint">Encoders hold a bitrate loosely, so a file kept in memory that lands more than 10 % off gets a second, corrected pass; a file streamed to a folder keeps its first pass.</p>}
              {pictureCopied && rate === "quality" && <p className="text-[12px] text-faint">With the codec left to “keep”, a picture that fits the container is copied as it is — pick a codec, a bitrate or a target size to re-encode it.</p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12.5px] text-muted">
                  Size
                  <select value={height} onChange={(e) => void setHeight(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noVideo} aria-label="Output height" data-convert-height>
                    <option value={0}>keep{first?.video ? ` (${first.video.width}×${first.video.height})` : ""}</option>
                    {HEIGHTS.map((h) => (
                      <option key={h} value={h}>
                        {h}p
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] text-muted">
                  Frame rate
                  <select value={fps} onChange={(e) => void setFps(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noVideo} aria-label="Frame rate" data-convert-fps>
                    <option value={0}>keep{first?.video?.fps ? ` (${first.video.fps})` : ""}</option>
                    {FRAME_RATES.map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
                {height > 0 && (
                  <>
                    <label className="text-[12.5px] text-muted">
                      Width
                      <input type="number" min={0} step={2} value={width} onChange={(e) => void setWidth(Math.max(0, Number(e.target.value) || 0))} placeholder="auto" className={cn(INPUT, "mt-1 font-mono")} aria-label="Output width (0 keeps the aspect)" />
                    </label>
                    <label className="text-[12.5px] text-muted">
                      Fit
                      <select value={fit} onChange={(e) => void setFit(e.target.value as Fit)} className={cn(SEL, "mt-1 w-full")} aria-label="Fit">
                        <option value="contain">letterbox (contain)</option>
                        <option value="cover">crop to fill (cover)</option>
                        <option value="fill">stretch (fill)</option>
                      </select>
                    </label>
                  </>
                )}
                <label className="text-[12.5px] text-muted">
                  Rotate
                  <select value={rotate} onChange={(e) => void setRotate(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noVideo} aria-label="Rotate" data-convert-rotate>
                    {ROTATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r === 0 ? "none" : `${r}° clockwise`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] text-muted">
                  Keyframe every
                  <select value={keyframeSeconds} onChange={(e) => void setKeyframeSeconds(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noVideo} aria-label="Keyframe interval">
                    <option value={0}>encoder default</option>
                    {[1, 2, 4, 5, 10].map((k) => (
                      <option key={k} value={k}>
                        {k} s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-muted">
                <input
                  type="checkbox"
                  checked={cropOn}
                  onChange={(e) => {
                    setCropOn(e.target.checked);
                    if (e.target.checked && !crop && first?.video) setCrop({ left: 0, top: 0, width: first.video.width, height: first.video.height });
                  }}
                  disabled={noVideo || jobs.length > 1}
                  className="accent-[var(--accent)]"
                  data-convert-crop-on
                />
                Crop (pixels of the source; single file)
              </label>
              {cropOn && crop && (
                <div className="grid grid-cols-4 gap-1.5" data-convert-crop>
                  {(["left", "top", "width", "height"] as const).map((k) => (
                    <label key={k} className="text-[12px] capitalize text-muted">
                      {k}
                      <input type="number" min={0} step={2} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: Math.max(0, Number(e.target.value) || 0) })} className={cn(INPUT, "mt-0.5 font-mono")} aria-label={`Crop ${k}`} />
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={noVideo} onChange={(e) => void setNoVideo(e.target.checked)} className="accent-[var(--accent)]" data-convert-novideo /> Drop the picture
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={forceTranscode} onChange={(e) => void setForceTranscode(e.target.checked)} className="accent-[var(--accent)]" data-convert-force /> Always re-encode
                </label>
                <label className="flex items-center gap-1.5">
                  Encoder
                  <select value={hardware} onChange={(e) => void setHardware(e.target.value as Hardware)} className={SEL} aria-label="Encoder preference">
                    <option value="no-preference">any</option>
                    <option value="prefer-hardware">prefer hardware</option>
                    <option value="prefer-software">prefer software</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <span className="readout">Sound</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12.5px] text-muted">
              Codec
              <select value={audioCodec} onChange={(e) => void setAudioCodec(e.target.value as (typeof AUDIO_CODECS)[number])} className={cn(SEL, "mt-1 w-full")} disabled={noAudio} aria-label="Audio codec" data-convert-acodec>
                <option value="auto">keep when it fits, else {AUDIO_CODEC_LABELS[def.audio[0]] ?? def.audio[0]}</option>
                {def.audio.map((c) => (
                  <option key={c} value={c} disabled={!audioOk(c)}>
                    {AUDIO_CODEC_LABELS[c] ?? c}
                    {!audioOk(c) ? " — not in this browser" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12.5px] text-muted">
              Bitrate
              <select value={audioKbps} onChange={(e) => void setAudioKbps(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noAudio || audioCodec === "flac" || audioCodec === "pcm-s16"} aria-label="Audio bitrate" data-convert-akbps>
                {AUDIO_KBPS.map((b) => (
                  <option key={b} value={b}>
                    {b} kbit/s
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12.5px] text-muted">
              Sample rate
              <select value={sampleRate} onChange={(e) => void setSampleRate(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noAudio} aria-label="Sample rate">
                <option value={0}>keep</option>
                {SAMPLE_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r.toLocaleString()} Hz
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12.5px] text-muted">
              Channels
              <select value={channels} onChange={(e) => void setChannels(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} disabled={noAudio} aria-label="Channels">
                <option value={0}>keep</option>
                <option value={1}>mono</option>
                <option value={2}>stereo</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={noAudio} onChange={(e) => void setNoAudio(e.target.checked)} className="accent-[var(--accent)]" data-convert-noaudio /> Drop the sound
          </label>
        </div>

        <details className="panel p-3" open={jobs.length === 1}>
          <summary className="readout cursor-pointer select-none">Trim, level & tags</summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12.5px] text-muted">
                Start (m:ss)
                <input value={trimStart} onChange={(e) => setTrimStart(e.target.value)} placeholder="0:00" disabled={jobs.length > 1} className={cn(INPUT, "mt-1 font-mono")} data-convert-trim-start />
              </label>
              <label className="text-[12.5px] text-muted">
                End (m:ss)
                <input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder={single ? fmtClock(single.duration) : "end"} disabled={jobs.length > 1} className={cn(INPUT, "mt-1 font-mono")} data-convert-trim-end />
              </label>
            </div>
            <label className="block text-[12.5px] text-muted">
              <span className="flex items-center justify-between">
                Sound gain{" "}
                <span className="font-mono tabular">
                  {gainDb > 0 ? "+" : ""}
                  {gainDb} dB
                </span>
              </span>
              <input type="range" min={-24} max={12} step={0.5} value={gainDb} onChange={(e) => setGainDb(Number(e.target.value))} disabled={noAudio} className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} disabled={noAudio} className="accent-[var(--accent)]" />
              Normalise peaks to −1 dBFS (a measuring pass first)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12.5px] text-muted">
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={single?.tags.title ?? (jobs.length > 1 ? "kept per file" : "keep")} disabled={jobs.length > 1 || tagsMode === "strip"} className={cn(INPUT, "mt-1")} />
              </label>
              <label className="text-[12.5px] text-muted">
                Artist
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder={single?.tags.artist ?? (jobs.length > 1 ? "kept per file" : "keep")} disabled={jobs.length > 1 || tagsMode === "strip"} className={cn(INPUT, "mt-1")} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" checked={tagsMode === "strip"} onChange={(e) => void setTagsMode(e.target.checked ? "strip" : null)} className="accent-[var(--accent)]" />
              Strip all metadata (tags, cover art)
            </label>
            {jobs.length > 1 && <p className="text-[12px] text-faint">Trim, crop and tag edits apply when converting a single file; gain and normalising apply to every file.</p>}
          </div>
        </details>

        <div className="panel space-y-2 p-3" data-convert-run>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
            <span className="readout">Destination</span>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="dest" checked={destination === "download"} onChange={() => setDestination("download")} className="accent-[var(--accent)]" /> keep in memory, download when done
            </label>
            <label className={cn("flex items-center gap-1.5", !canPickFolder && "opacity-50")} title={canPickFolder ? "Each file streams straight to disk as it converts — no size limit" : "Needs the File System Access API (Chrome, Edge)"}>
              <input type="radio" name="dest" checked={destination === "folder"} onChange={() => setDestination("folder")} disabled={!canPickFolder} className="accent-[var(--accent)]" /> stream to a folder I pick
            </label>
          </div>
          {first && (
            <p className="font-mono text-[12px] text-muted" data-convert-estimate>
              {outSize && def.kind === "video" && !noVideo ? `${outSize.width}×${outSize.height}` : "sound only"}
              {estimate !== null ? ` · about ${fmtBytes(estimate)} ${jobs.length > 1 ? "for the first file " : ""}(${Math.round((estimate / first.size) * 100)}% of the source)` : ""}
              {pictureCopied ? " · picture copied as it is" : ""}
              {soundCopied ? " · sound copied as it is" : ""}
            </p>
          )}
          {codecProblem && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-warn" data-convert-problem>
              <AlertTriangle size={13} /> {codecProblem}.
            </p>
          )}
          {note && <p className="text-[12.5px] text-faint">{note}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void convertAll()} disabled={!canConvert} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:opacity-40" data-convert-start>
              {busy ? <Loader size={14} className="animate-spin" /> : destination === "folder" ? <FolderDown size={14} /> : null}
              Convert {jobs.length > 1 ? `${jobs.length} files` : ""} to {def.label}
            </button>
            {inMemory.length > 1 && (
              <button type="button" onClick={() => void downloadZip()} disabled={zipping} className={GHOST} data-convert-zip>
                {zipping ? <Loader size={13} className="animate-spin" /> : <Archive size={13} />} Download all as ZIP
              </button>
            )}
          </div>
          <p className="text-[12px] text-faint">Streams whose codec already fits the container are copied as they are unless something about them changes, so a remux or a trim is lossless and takes seconds; re-encoding runs at the speed of this device&apos;s encoders.</p>
        </div>
      </div></>} />
  );
}
