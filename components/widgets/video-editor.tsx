"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Clapperboard, Crop, Download, FolderOpen, Loader, Maximize2, Minimize2, Music, Pause, Play, Save, Scissors, SlidersHorizontal, Trash2, Type, Upload, Volume2 } from "lucide-react";
import {
  DEFAULT_CLIP_GAIN_DB,
  DEFAULT_EXPORT,
  NEUTRAL_GRADE,
  NEUTRAL_TRANSFORM,
  TITLE_FONTS,
  TITLE_POSITIONS,
  TRANSITIONS,
  addTransitionAt,
  appendMusic,
  applyAudioTo,
  applyGradeTo,
  applyTransitionToAll,
  clipAt,
  crossfades,
  dbToGain,
  effectiveMusicEnd,
  estimateExport,
  exportRange,
  fmtTime,
  moveItem,
  musicGainAt,
  musicLength,
  newId,
  newProject,
  newTitle,
  orderRecordings,
  placeClips,
  planExport,
  removeRange,
  reorderMusic,
  setTransition,
  splitClip,
  timelineDuration,
  titleLanes,
  transitionAt,
  transitionWindows,
  type Clip,
  type MediaRef,
  type MusicTrack,
  type Project,
  type ProxyHeight,
  type Title,
  type TitleFont,
  isFileLutKind,
  type FileLutKind,
  type LutKind,
  type MathLutKind,
  type TitlePosition,
  type Transition,
  type TransitionKind,
} from "@/lib/tools/video/project";
import { drawTransition } from "@/lib/tools/video/transitions";
import { LUT_OPTIONS, buildDlogLut, deriveLut, fetchOfficialLut, lutToCube, parseCube, type Lut3D } from "@/lib/tools/video/lut";
import { Grader, buildProxy, drawOverlays, encoderSupport, exportProject, probe } from "@/lib/tools/video/engine";
import { ProjectStore, hasFileSystemAccess, AUTOSAVE_FILE, PROJECT_FILE, PROXY_DIR } from "@/lib/tools/video/store";
import { cn } from "@/lib/utils";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const PRIMARY = "inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:opacity-40";
const RANGE = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]";
const LANE_COLORS = ["#8cc63f", "#5ab3d6", "#d9a400"];
const POSITION_NAMES: Record<TitlePosition, string> = { tl: "Top left", tc: "Top centre", tr: "Top right", ml: "Middle left", mc: "Centre", mr: "Middle right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };
const KIND_LABELS: Record<Title["kind"], string> = { intro: "Intro", title: "Title", lowerThird: "Lower third" };
const DEFAULT_PREVIEW_HEIGHT: ProxyHeight = 0;
const toHex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffffff");
type Tab = "trim" | "transform" | "colour" | "audio" | "titles" | "export";
const TABS: [Tab, string, typeof Scissors][] = [
  ["trim", "Trim", Scissors],
  ["transform", "Rotate & crop", Crop],
  ["colour", "Colour", SlidersHorizontal],
  ["audio", "Audio", Volume2],
  ["titles", "Titles & logo", Type],
  ["export", "Export", Download],
];

interface Job {
  kind: "proxy" | "export";
  label: string;
  fraction: number;
  message?: string;
  abort: AbortController;
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block text-[12.5px] text-muted">
      <span className="flex items-center justify-between">
        {label}
        <span className="font-mono tabular text-ink">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange((min + max) / 2 === 0.5 ? 1 : 0)} className={cn(RANGE, "mt-1")} />
    </label>
  );
}

export function VideoEditorWidget() {
  const [status, setStatus] = useState<string>("");
  const [store] = useState(() => new ProjectStore(setStatus));
  const [project, setProjectState] = useState<Project>(() => newProject());
  const [folder, setFolder] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedMusic, setSelectedMusic] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  /** The incoming clip id of the selected cut's transition. */
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("trim");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [job, setJob] = useState<Job | null>(null);
  const [support, setSupport] = useState<{ hevc: boolean; avc: boolean } | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graderRef = useRef<Grader | null>(null);
  const proxyUrls = useRef<Map<string, string>>(new Map());
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<Project[]>([]);
  const [timelineWidth, setTimelineWidth] = useState(800);
  const [seekToken, setSeekToken] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const musicNodes = useRef<Map<string, { src: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const playheadRef = useRef(0);
  const previewRef = useRef(DEFAULT_PREVIEW_HEIGHT);
  // Second, silent video element for the clip on the other side of a transition.
  const altRef = useRef<HTMLVideoElement>(null);
  const scratchRef = useRef<{ a: OffscreenCanvas; b: OffscreenCanvas; s: OffscreenCanvas; w: number; h: number } | null>(null);
  const pendingUrls = useRef<Set<string>>(new Set());
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const cubeInput = useRef<HTMLInputElement>(null);
  // DJI's own LUT file, fetched the first time a clip asks for it; both file-based conversions derive from it.
  const [fileLuts, setFileLuts] = useState<Partial<Record<FileLutKind, Lut3D>> | null>(null);
  const needsFileLut = project.clips.some((c) => isFileLutKind(c.grade.lut));
  useEffect(() => {
    if (!needsFileLut || fileLuts) return;
    let active = true;
    fetchOfficialLut()
      .then((base) => {
        if (active) setFileLuts({ "dji-official": deriveLut(base, "dji-official"), "dji-official-study": deriveLut(base, "dji-official-study") });
      })
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [needsFileLut, fileLuts]);
  const customLut = useMemo(() => {
    try {
      return project.customLut ? parseCube(project.customLut.cube) : null;
    } catch {
      return null;
    }
  }, [project.customLut]);
  const loadCube = async (file: File, clipId: string) => {
    const cube = await file.text();
    try {
      const parsed = parseCube(cube);
      if (![17, 33, 65].includes(parsed.size)) throw new Error("size");
    } catch {
      return setError(`${file.name} is not a 3D .cube LUT this tool can read (17, 33 or 65 points).`);
    }
    setProject((p) => ({ ...p, customLut: { name: file.name, cube }, clips: p.clips.map((c) => (c.id === clipId ? { ...c, grade: { ...c.grade, lut: "custom" } } : c)) }));
    setStatus(`Loaded ${file.name}`);
  };
  // Clear-project dialog: forgetting is always in the browser only; deleting our own files from the folder is opt-in.
  const [clearOpen, setClearOpen] = useState(false);
  const [clearFiles, setClearFiles] = useState(false);
  const [clearProxies, setClearProxies] = useState(false);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!clearOpen) return;
    keepButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClearOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearOpen]);
  const clearProject = async () => {
    setPlaying(false);
    store.cancelAutosave();
    const notes: string[] = [];
    if (folder && clearFiles) {
      const removed = await store.removeProjectFiles();
      if (removed.length) notes.push(`deleted ${removed.join(" and ")}`);
    }
    if (folder && clearProxies && (await store.removeProxies())) notes.push(`deleted ${PROXY_DIR}/`);
    await store.forget();
    for (const url of proxyUrls.current.values()) URL.revokeObjectURL(url);
    proxyUrls.current.clear();
    pendingUrls.current.clear();
    musicBuffers.current.clear();
    if (altRef.current) {
      altRef.current.removeAttribute("src");
      delete altRef.current.dataset.src;
    }
    setProjectState(newProject());
    setHistory([]);
    setFolder(null);
    setSelected(null);
    setSelectedMusic(null);
    setSelectedTitle(null);
    setSelectedTransition(null);
    setLogo(null);
    setPlayhead(0);
    setError(null);
    setClearOpen(false);
    setClearFiles(false);
    setClearProxies(false);
    setStatus(`Project cleared${notes.length ? " — " + notes.join(", ") : ""}. Your recordings were not touched.`);
  };
  const selectedTransitionRef = useRef<string | null>(null);
  useEffect(() => {
    selectedTransitionRef.current = selectedTransition;
  }, [selectedTransition]);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const el = previewBoxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  };

  const duration = timelineDuration(project);
  const placed = useMemo(() => placeClips(project.clips), [project.clips]);
  const windows = useMemo(() => transitionWindows(placed), [placed]);
  const selectedWindow = useMemo(() => windows.find((w) => w.incoming.id === selectedTransition) ?? null, [windows, selectedTransition]);
  const titleLaneOf = useMemo(() => titleLanes(project.titles), [project.titles]);
  const spans = useMemo(() => planExport(project), [project]);
  const range = useMemo(() => exportRange(project), [project]);
  const setRange = (r: { from: number; to: number } | null) => setProject((p) => ({ ...p, export: { ...p.export, range: r } }));
  const estimate = useMemo(() => estimateExport(project, spans), [project, spans]);
  const current = selected ? project.clips.find((c) => c.id === selected) : undefined;
  const currentMusic = selectedMusic ? project.music.find((m) => m.id === selectedMusic) : undefined;
  const fades = useMemo(() => crossfades(project.music), [project.music]);

  // Every edit goes through here: history for undo, autosave to the folder.
  const setProject = useCallback(
    (update: Project | ((p: Project) => Project)) => {
      setProjectState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        setHistory((h) => [...h.slice(-49), prev]);
        store.autosave(next);
        return next;
      });
    },
    [store],
  );
  const undo = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setProjectState(prev);
      return h.slice(0, -1);
    });
  }, []);

  // Timeline scale needs the lane width; measured, never read from the ref during render.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setTimelineWidth(Math.max(200, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);
  useEffect(() => {
    previewRef.current = project.preview.proxyHeight;
  }, [project.preview.proxyHeight]);

  // Music for the preview is decoded once into Web Audio buffers; export mixes from the files independently.
  const decodeMusic = useCallback(async (mediaId: string, file: File) => {
    if (musicBuffers.current.has(mediaId)) return;
    const ctx = (audioCtxRef.current ??= new AudioContext());
    try {
      musicBuffers.current.set(mediaId, await ctx.decodeAudioData(await file.arrayBuffer()));
    } catch {
      /* undecodable in the browser: silent in the preview, still mixed on export */
    }
  }, []);
  const primeMusic = useCallback(
    async (p: Project) => {
      for (const m of p.music) {
        const f = await store.getFile(m.media);
        if (f) await decodeMusic(m.media, f);
      }
    },
    [store, decodeMusic],
  );
  const togglePlay = useCallback(() => {
    void audioCtxRef.current?.resume();
    setPlaying((p) => !p);
  }, []);

  // Preview URL for a media id: the proxy if there is one, else the original — created on first use.
  const previewUrlFor = useCallback(
    (id: string): string | undefined => {
      const url = proxyUrls.current.get(id);
      if (url || pendingUrls.current.has(id)) return url;
      pendingUrls.current.add(id);
      void store.getFile(id).then((f) => {
        if (f && !proxyUrls.current.has(id)) proxyUrls.current.set(id, URL.createObjectURL(f));
        pendingUrls.current.delete(id);
      });
      return undefined;
    },
    [store],
  );

  const loadProxies = useCallback(
    async (p: Project) => {
      // Proxies from another size setting (or the silent ones older versions made) are stale: preview the originals until they are rebuilt.
      const stale: string[] = [];
      for (const [id, px] of Object.entries(p.proxies)) {
        if (!px.ready || !px.file || proxyUrls.current.has(id)) continue;
        if (!px.file.includes(`.proxy${p.preview.proxyHeight}.`)) {
          stale.push(id);
          continue;
        }
        const f = await store.proxyFile(px.file);
        if (f) proxyUrls.current.set(id, URL.createObjectURL(f));
      }
      // Load-time housekeeping: no undo entry, and the flags are recomputed on every load anyway.
      if (stale.length) setProjectState((q) => ({ ...q, proxies: Object.fromEntries(Object.entries(q.proxies).map(([id, px]) => [id, stale.includes(id) ? { ready: false } : px])) }));
    },
    [store],
  );

  useEffect(() => {
    encoderSupport(7680, 4320).then(setSupport).catch(() => setSupport({ hevc: false, avc: false }));
    const onUnload = () => void store.flush();
    window.addEventListener("beforeunload", onUnload);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void store.save(project);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedTransitionRef.current && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        const id = selectedTransitionRef.current;
        setProject((p) => ({ ...p, clips: setTransition(p.clips, id, null) }));
        setSelectedTransition(null);
      } else if (e.key === " " && !(e.target as HTMLElement).closest("input, textarea, select")) {
        e.preventDefault();
        void audioCtxRef.current?.resume();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("keydown", onKey);
    };
  }, [store, undo, project, setProject]);

  // Try to reopen the last project folder silently.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!hasFileSystemAccess()) return;
      if (!(await store.reopenLast())) return;
      if (!active) return;
      setFolder(store.folderName);
      const loaded = await store.load();
      if (loaded && active) {
        setProjectState(loaded.project);
        setRecovered(loaded.recovered);
        for (const m of Object.values(loaded.project.media)) await store.resolveByName(m.id, m.name);
        await loadProxies(loaded.project);
        await primeMusic(loaded.project);
      }
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [store, loadProxies, primeMusic]);

  const chooseFolder = async () => {
    try {
      await store.pickFolder();
      setFolder(store.folderName);
      const loaded = await store.load();
      if (loaded) {
        setProjectState(loaded.project);
        setRecovered(loaded.recovered);
        for (const m of Object.values(loaded.project.media)) await store.resolveByName(m.id, m.name);
        await loadProxies(loaded.project);
        await primeMusic(loaded.project);
        setStatus(loaded.recovered ? "Recovered from autosave" : "Project opened");
      } else {
        await store.save(project);
      }
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addVideos = async (files: File[]) => {
    const refs: MediaRef[] = [];
    for (const f of files) {
      const id = newId();
      store.registerFile(id, f);
      try {
        const info = await probe(f);
        if (!info.canDecode) {
          setError(`${f.name}: this browser can't decode ${info.codec ?? "that codec"}.`);
          continue;
        }
        refs.push({ id, name: f.name, size: f.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, codec: info.codec ?? undefined, hasAudio: info.hasAudio, sampleRate: info.sampleRate });
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "couldn't read the file."}`);
      }
    }
    if (!refs.length) return;
    // Consecutive recordings in name order, butted together.
    const ordered = orderRecordings(refs);
    setProject((p) => ({
      ...p,
      media: { ...p.media, ...Object.fromEntries(ordered.map((m) => [m.id, m])) },
      clips: [...p.clips, ...ordered.map((m): Clip => ({ id: newId(), media: m.id, in: 0, out: m.duration, transform: { ...NEUTRAL_TRANSFORM, crop: { ...NEUTRAL_TRANSFORM.crop } }, grade: { ...NEUTRAL_GRADE }, gainDb: DEFAULT_CLIP_GAIN_DB, muted: false }))],
    }));
    // Proxies in the background, one at a time.
    if (store.hasFolder) for (const m of ordered) await makeProxy(m, files.find((f) => f.name === m.name)!, previewRef.current);
  };

  const makeProxy = async (m: MediaRef, file: File, height: ProxyHeight, force = false) => {
    if (!height) {
      proxyUrls.current.delete(m.id);
      setProject((p) => ({ ...p, proxies: { ...p.proxies, [m.id]: { ready: false } } }));
      return;
    }
    const name = `${m.id}.proxy${height}.mp4`;
    if (!force) {
      // A proxy at this size from earlier is reused as is.
      const existing = await store.proxyFile(name);
      if (existing && existing.size > 0) {
        proxyUrls.current.set(m.id, URL.createObjectURL(existing));
        setProject((p) => ({ ...p, proxies: { ...p.proxies, [m.id]: { ready: true, file: name } } }));
        return;
      }
    }
    const abort = new AbortController();
    setJob({ kind: "proxy", label: `${height}p proxy for ${m.name}`, fraction: 0, abort });
    try {
      const { writable } = await store.createWritable(name, "proxies");
      await buildProxy(file, writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, height, (f) => setJob((j) => (j ? { ...j, fraction: f } : j)), abort.signal);
      const pf = await store.proxyFile(name);
      if (pf) proxyUrls.current.set(m.id, URL.createObjectURL(pf));
      setProject((p) => ({ ...p, proxies: { ...p.proxies, [m.id]: { ready: true, file: name } } }));
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(`Proxy failed for ${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setJob(null);
    }
  };

  const rebuildProxies = async (height: ProxyHeight = previewRef.current, force = true) => {
    for (const id of [...new Set(project.clips.map((c) => c.media))]) {
      const f = await store.getFile(id), m = project.media[id];
      if (f && m) {
        proxyUrls.current.delete(id);
        await makeProxy(m, f, height, force);
      }
    }
  };

  const addMusic = async (files: File[]) => {
    for (const f of files) {
      const id = newId();
      store.registerFile(id, f);
      try {
        const info = await probe(f);
        const ref: MediaRef = { id, name: f.name, size: f.size, duration: info.duration, hasAudio: true, sampleRate: info.sampleRate };
        setProject((p) => ({ ...p, media: { ...p.media, [id]: ref }, music: [...p.music, appendMusic(p.music, { id: newId(), media: id, lane: 0, in: 0, out: info.duration, gainDb: -12, muted: false, fadeIn: 2, fadeOut: 3, keyframes: [] })] }));
        await decodeMusic(id, f);
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "couldn't read the file."}`);
      }
    }
  };

  const addLogo = async (f: File) => {
    const id = newId();
    store.registerFile(id, f);
    const bmp = await createImageBitmap(f);
    setLogo(bmp);
    setProject((p) => ({ ...p, media: { ...p.media, [id]: { id, name: f.name, size: f.size, duration: 0 } }, watermark: { ...p.watermark, media: id } }));
  };

  // Preview: proxy video element (or source file when no proxy) drawn through the grader.
  const under = useMemo(() => clipAt(project.clips, Math.min(playhead, Math.max(0, duration - 0.001))), [project.clips, playhead, duration]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!under) return setPreviewSrc(null);
      const id = under.clip.media;
      let url = proxyUrls.current.get(id);
      if (!url) {
        const f = await store.getFile(id);
        if (!f) return;
        url = URL.createObjectURL(f);
        proxyUrls.current.set(id, url);
      }
      if (active) setPreviewSrc(url);
    })();
    return () => {
      active = false;
    };
  }, [under?.clip.media, store, under]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !under || !previewSrc) return;
    if (v.src !== previewSrc) v.src = previewSrc;
    if (Math.abs(v.currentTime - under.sourceTime) > 0.3) v.currentTime = under.sourceTime;
    // The clip's own sound, at its gain (an element can't go above unity; export can).
    const gain = under.clip.muted ? 0 : Math.min(1, dbToGain(under.clip.gainDb));
    v.volume = gain;
    v.muted = gain === 0;
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [previewSrc, under, playing]);

  // Music in the preview: Web Audio sources started at the right offsets whenever playback (re)starts or the user seeks.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const nodes = musicNodes.current;
    const stopAll = () => {
      for (const node of nodes.values()) {
        try {
          node.src.stop();
        } catch {
          /* already stopped */
        }
      }
      nodes.clear();
    };
    if (!playing || !ctx) {
      stopAll();
      return;
    }
    const at = playheadRef.current;
    for (const m of project.music) {
      if (m.muted) continue;
      const buf = musicBuffers.current.get(m.media);
      if (!buf) continue;
      const end = effectiveMusicEnd(m, duration);
      if (at >= end) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(ctx.destination);
      const delay = Math.max(0, m.start - at), offset = m.in + Math.max(0, at - m.start);
      src.start(ctx.currentTime + delay, offset, Math.max(0.01, end - Math.max(at, m.start)));
      nodes.set(m.id, { src, gain });
    }
    return stopAll;
  }, [playing, seekToken, project.music, duration]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && under) {
        const t = under.clip.start + (v.currentTime - under.clip.in);
        if (v.currentTime >= under.clip.out - 0.05) {
          if (under.clip.end >= duration - 0.05) setPlaying(false);
          setPlayhead(Math.min(duration, under.clip.end + 0.001));
        } else setPlayhead(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, under, duration]);
  // Draw the graded frame + overlays each animation frame.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = videoRef.current, c = canvasRef.current;
      if (v && c && under && v.readyState >= 2) {
        const w = c.width, h = c.height;
        try {
          if (!graderRef.current || graderRef.current.canvas.width !== w) graderRef.current = new Grader(w, h);
          const grader = graderRef.current;
          grader.setCustomLut(customLut);
          if (fileLuts) for (const [k, l] of Object.entries(fileLuts)) if (l) grader.provideLut(k as LutKind, l);
          const ctx = c.getContext("2d")!;
          const alt = altRef.current;
          const tr = windows.length ? transitionAt(windows, playhead) : null;
          let composed = false;
          if (tr && alt) {
            const outgoingIsUnder = tr.window.outgoing.id === under.clip.id;
            const other = outgoingIsUnder ? tr.window.incoming : tr.window.outgoing;
            const url = previewUrlFor(other.media);
            if (url) {
              if (alt.dataset.src !== url) {
                alt.src = url;
                alt.dataset.src = url;
              }
              const want = Math.max(0, other.in + (playhead - other.start));
              if (playing) {
                if (alt.paused) void alt.play().catch(() => undefined);
                if (Math.abs(alt.currentTime - want) > 0.3) alt.currentTime = want;
              } else {
                if (!alt.paused) alt.pause();
                if (Math.abs(alt.currentTime - want) > 0.05) alt.currentTime = want;
              }
              if (alt.readyState >= 2) {
                if (!scratchRef.current || scratchRef.current.w !== w || scratchRef.current.h !== h) scratchRef.current = { a: new OffscreenCanvas(w, h), b: new OffscreenCanvas(w, h), s: new OffscreenCanvas(w, h), w, h };
                const sc = scratchRef.current;
                grader.draw(v, under.clip.grade, under.clip.transform, v.videoWidth, v.videoHeight);
                sc.a.getContext("2d")!.drawImage(grader.canvas, 0, 0);
                grader.draw(alt, other.grade, other.transform, alt.videoWidth, alt.videoHeight);
                sc.b.getContext("2d")!.drawImage(grader.canvas, 0, 0);
                drawTransition(ctx, outgoingIsUnder ? sc.a : sc.b, outgoingIsUnder ? sc.b : sc.a, w, h, tr.window.kind, tr.progress, sc.s);
                composed = true;
              }
            }
          } else if (alt) {
            if (!alt.paused) alt.pause();
            // Cue the next transition's other side while playing so it is decoded by the time the cut arrives.
            const next = playing ? windows.find((x) => x.start > playhead && x.start - playhead < 2) : undefined;
            if (next) {
              const url = previewUrlFor(next.incoming.media);
              if (url && alt.dataset.src !== url) {
                alt.src = url;
                alt.dataset.src = url;
                alt.currentTime = Math.max(0, next.incoming.in + (next.start - next.incoming.start));
              }
            }
          }
          if (!composed) {
            grader.draw(v, under.clip.grade, under.clip.transform, v.videoWidth, v.videoHeight);
            ctx.drawImage(grader.canvas, 0, 0);
          }
          drawOverlays(ctx as unknown as OffscreenCanvasRenderingContext2D, w, h, playhead, project, logo);
          // Music gains follow the playhead so fades and crossfades are audible in the preview.
          for (const [id, node] of musicNodes.current) {
            const m = project.music.find((x) => x.id === id);
            node.gain.gain.value = m ? musicGainAt(m, project.music, playhead, duration) : 0;
          }
        } catch {
          /* WebGL unavailable: fall back to the raw video element behind the canvas */
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [under, playhead, project, logo, duration, windows, playing, previewUrlFor, customLut, fileLuts]);

  const update = (id: string, patch: Partial<Clip>) => setProject((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const updateMusic = (id: string, patch: Partial<MusicTrack>) => setProject((p) => ({ ...p, music: p.music.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  // Transitions live on the cut they lead into; selecting one parks the playhead on the cut so the preview shows its middle.
  const focusTransition = (incomingId: string | null) => {
    setSelectedTransition(incomingId);
    const w = windows.find((x) => x.incoming.id === incomingId);
    if (w) {
      setPlayhead(w.cut);
      setSeekToken((x) => x + 1);
    }
  };
  const addTransitionAtPlayhead = () => {
    const r = addTransitionAt(project.clips, playhead, project.transition);
    if (!r) return setError("Move the playhead at least 0.2 s inside a clip, or onto a cut, to add a transition.");
    setProject((p) => ({ ...p, clips: r.clips }));
    setSelectedTransition(r.incomingId);
  };
  const changeTransition = (patch: Partial<Transition>) =>
    setProject((p) => {
      const tr = { ...p.transition, ...patch };
      return { ...p, transition: tr, clips: selectedTransition ? setTransition(p.clips, selectedTransition, tr) : p.clips };
    });
  // Opening a title also parks the playhead where it is fully faded in, so the preview shows what you are editing.
  const focusTitle = (t: Title | null) => {
    setSelectedTitle(t?.id ?? null);
    if (t) {
      setPlayhead(Math.min(duration, t.start + Math.min(t.fade, t.duration / 2)));
      setSeekToken((x) => x + 1);
    }
  };
  const addTitle = (kind: Title["kind"]) => {
    const t = newTitle(kind, kind === "intro" ? 0 : playhead, kind === "intro" ? project.name : kind === "lowerThird" ? "Location" : "Title", kind === "intro" ? new Date().toLocaleDateString() : "");
    setProject((p) => ({ ...p, titles: [...p.titles, t] }));
    focusTitle(t);
  };
  const removeTitle = (id: string) => {
    setProject((p) => ({ ...p, titles: p.titles.filter((x) => x.id !== id) }));
    setSelectedTitle((s) => (s === id ? null : s));
  };
  const patchTitle = (id: string, patch: Partial<Title>) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  // Exposed for automated tests, which cannot drive the folder picker. Re-registered whenever the handlers change.
  useEffect(() => {
    (window as unknown as { __benchVideo?: unknown }).__benchVideo = {
      useDirectory: (d: FileSystemDirectoryHandle) => {
        store.useDirectory(d);
        setFolder(d.name || "test");
      },
      addVideos,
      addMusic,
      getProject: () => project,
      audioState: () => ({ ctx: audioCtxRef.current?.state ?? null, nodes: musicNodes.current.size, buffers: musicBuffers.current.size, video: videoRef.current ? { muted: videoRef.current.muted, volume: videoRef.current.volume, paused: videoRef.current.paused } : null }),
    };
  });

  const runExport = async () => {
    if (!store.hasFolder) return setError("Pick a project folder first — the export is written there.");
    const abort = new AbortController();
    setJob({ kind: "export", label: "Exporting", fraction: 0, abort });
    try {
      const name = `${project.name.replace(/[^\w-]+/g, "-")}-${project.export.resolution === "source" ? "8K" : project.export.resolution + "p"}${range ? `-${Math.round(range.from)}s-${Math.round(range.to)}s` : ""}.mp4`;
      const { writable } = await store.createWritable(name);
      await exportProject({
        project,
        getFile: (id) => store.getFile(id),
        logo,
        writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
        signal: abort.signal,
        onProgress: ({ phase, fraction, span }) => setJob((j) => (j ? { ...j, fraction, message: phase === "video" ? `${span?.kind === "copy" ? "Copying" : "Rendering"} ${span ? fmtTime(span.start) : ""}` : phase === "audio" ? "Mixing audio" : "Finishing the file" } : j)),
      });
      setStatus(`Exported ${name}`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  const pxPerSec = (timelineWidth / Math.max(10, duration)) * zoom;
  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPlayhead(Math.max(0, Math.min(duration, (e.clientX - r.left + e.currentTarget.scrollLeft) / pxPerSec)));
    setSeekToken((t) => t + 1);
  };
  const first = project.media[project.clips[0]?.media ?? ""];
  const previewAspect = first?.width && first.height ? first.width / first.height : 16 / 9;

  return (
    <div className="space-y-3">
      {/* project bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <button type="button" onClick={chooseFolder} className={cn(GHOST, "h-9")} disabled={!hasFileSystemAccess()}>
          <FolderOpen size={14} /> {folder ? folder : "Choose project folder"}
        </button>
        <input value={project.name} onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))} className={cn(INPUT, "w-48")} aria-label="Project name" />
        <button type="button" onClick={() => void store.save(project)} disabled={!folder} className={GHOST}>
          <Save size={13} /> Save
        </button>
        <button type="button" onClick={undo} disabled={!history.length} className={GHOST}>
          Undo
        </button>
        <button type="button" onClick={() => setClearOpen(true)} className={cn(GHOST, "hover:border-danger hover:text-danger")} title="Start over: forget this project in the browser, optionally delete its files from the folder">
          <Trash2 size={13} /> Clear
        </button>
        <span className="text-[12px] text-faint">{status}</span>
        {recovered && <span className="rounded-[var(--radius-sm)] bg-accent-soft px-2 py-0.5 text-[12px] text-accent">Recovered unsaved work from the autosave</span>}
        {!hasFileSystemAccess() && <span className="text-[12px] text-warn">Needs Chrome or Edge for folder access, proxies and 8K export.</span>}
        {support && !support.hevc && <span className="text-[12px] text-warn">No hardware HEVC 8K encoder found here — exports will use H.264 or need a lower resolution.</span>}
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInput} type="file" accept="video/*,.mp4,.mov" multiple hidden onChange={(e) => e.target.files && void addVideos(Array.from(e.target.files))} />
          <button type="button" onClick={() => fileInput.current?.click()} className={cn(PRIMARY, "h-8 px-3 text-[13px]")}>
            <Upload size={13} /> Add recordings
          </button>
        </div>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertTriangle size={14} /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-faint hover:text-ink">
            dismiss
          </button>
        </p>
      )}
      {job && (
        <div className="panel flex items-center gap-3 p-2 text-[13px]">
          <Loader size={14} className="animate-spin text-accent" />
          <span className="text-ink">{job.label}</span>
          <span className="text-muted">{job.message}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(job.fraction * 100)}%` }} />
          </div>
          <span className="font-mono text-[12px] text-muted tabular">{Math.round(job.fraction * 100)}%</span>
          <button type="button" onClick={() => job.abort.abort()} className={GHOST}>
            Cancel
          </button>
        </div>
      )}

      {/* preview + inspector */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="panel p-2">
          <div
            ref={previewBoxRef}
            className={cn("group relative overflow-hidden rounded-[var(--radius-sm)] bg-black", dragOver && "ring-2 ring-accent")}
            style={{ aspectRatio: String(previewAspect) }}
            onDoubleClick={toggleFullscreen}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const fs = Array.from(e.dataTransfer.files);
              void addVideos(fs.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov)$/i.test(f.name)));
              void addMusic(fs.filter((f) => f.type.startsWith("audio/")));
            }}
          >
            <video ref={videoRef} playsInline className="absolute inset-0 h-full w-full object-contain opacity-0" />
            <video ref={altRef} muted playsInline className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0" />
            <canvas ref={canvasRef} width={1280} height={Math.round(1280 / previewAspect)} className="absolute inset-0 h-full w-full object-contain" />
            {project.clips.length > 0 && (
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen (Esc)" : "Full screen (double-click the preview)"} className="absolute top-2 right-2 rounded-[var(--radius-sm)] bg-black/50 p-1.5 text-white/90 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-black/70">
                {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            )}
            {fullscreen && (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pt-8 pb-3 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={togglePlay} className="flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-white/15 px-3 text-[13px] hover:bg-white/25">
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                  {playing ? "Pause" : "Play"}
                </button>
                <span className="font-mono text-[13px] tabular">
                  {fmtTime(playhead, first?.fps)} <span className="text-white/60">/ {fmtTime(duration)}</span>
                </span>
                {under && <span className="truncate text-[12px] text-white/60">{project.media[under.clip.media]?.name}</span>}
                <span className="ml-auto text-[12px] text-white/60">Space plays · Esc leaves full screen</span>
              </div>
            )}
            {!project.clips.length && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13.5px] text-white/80">
                <Clapperboard size={28} />
                <span className="text-[15px] font-medium">Drop your drive recordings here</span>
                <span className="max-w-sm text-[12.5px] text-white/60">8K at the original frame rate. Consecutive DJI files are joined in order. Choose a project folder first so proxies and autosaves have somewhere to live.</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={togglePlay} disabled={!project.clips.length} className={cn(PRIMARY, "h-8 px-3 text-[13px]")}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
              {playing ? "Pause" : "Play"}
            </button>
            <span className="font-mono text-[13px] text-ink tabular">
              {fmtTime(playhead, first?.fps)} <span className="text-faint">/ {fmtTime(duration)}</span>
            </span>
            {under && (
              <span className="truncate text-[12px] text-faint">
                {project.media[under.clip.media]?.name} · {project.proxies[under.clip.media]?.ready ? `${project.preview.proxyHeight}p proxy` : project.preview.proxyHeight ? "full-res (no proxy yet)" : "full-res"}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Smaller proxies render faster and scrub more smoothly; larger ones show the grade in more detail. Export always uses the originals.">
              Proxy
              <select
                value={project.preview.proxyHeight}
                onChange={(e) => {
                  const h = Number(e.target.value) as ProxyHeight;
                  previewRef.current = h;
                  setProject((p) => ({ ...p, preview: { ...p.preview, proxyHeight: h } }));
                  // Choosing a size renders the proxies straight away (existing ones at that size are reused).
                  void rebuildProxies(h, false);
                }}
                className={cn(SEL, "h-7 text-[12px]")}
              >
                <option value={1080}>1080p</option>
                <option value={720}>720p</option>
                <option value={360}>360p</option>
                <option value={0}>Off — play the originals</option>
              </select>
            </label>
            <button type="button" onClick={() => void rebuildProxies()} disabled={!project.clips.length || !!job || !folder} className={cn(GHOST, "h-7 text-[12px]")} title="Render the proxies again at the chosen size">
              Rebuild proxies
            </button>
            <button type="button" onClick={toggleFullscreen} disabled={!project.clips.length} className={cn(GHOST, "h-7 text-[12px]")} title="Watch the preview full screen">
              <Maximize2 size={12} /> Full screen
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
              Zoom
              <input type="range" min={1} max={40} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className={cn(RANGE, "w-28")} />
            </label>
          </div>
        </div>

        {/* The inspector never grows past the preview: it scrolls inside, so the timeline stays within reach. */}
        <div className="relative min-h-[360px]">
          <div className="panel flex min-w-0 flex-col max-lg:max-h-[60vh] lg:absolute lg:inset-0">
          <div className="flex flex-wrap gap-1 border-b border-edge px-2 py-1.5">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={cn("flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12.5px]", tab === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-[13px]">
            {tab === "trim" && (
              <>
                <p className="text-muted">{current ? `${project.media[current.media]?.name} · ${fmtTime(current.in)} → ${fmtTime(current.out)} (${fmtTime(current.out - current.in)})` : "Select a clip on the timeline, or move the playhead and use the buttons."}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={!under} onClick={() => under && setProject((p) => ({ ...p, clips: splitClip(p.clips, under.clip.id, playhead) }))} className={GHOST}>
                    <Scissors size={13} /> Split at playhead
                  </button>
                  <button type="button" disabled={!under} onClick={() => under && update(under.clip.id, { in: under.sourceTime })} className={GHOST}>
                    Trim start to here
                  </button>
                  <button type="button" disabled={!under} onClick={() => under && update(under.clip.id, { out: under.sourceTime })} className={GHOST}>
                    Trim end to here
                  </button>
                  <button type="button" disabled={!current} onClick={() => current && setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== current.id) }))} className={cn(GHOST, "hover:border-danger hover:text-danger")}>
                    <Trash2 size={13} /> Delete clip
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === 0} onClick={() => current && setProject((p) => ({ ...p, clips: moveItem(p.clips, current.id, -1) }))} className={GHOST} title="Play this clip before the previous one">
                    ◀ Move earlier
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === placed.length - 1} onClick={() => current && setProject((p) => ({ ...p, clips: moveItem(p.clips, current.id, 1) }))} className={GHOST} title="Play this clip after the next one">
                    Move later ▶
                  </button>
                </div>
                <RangeCut duration={duration} onCut={(a, b) => setProject((p) => ({ ...p, clips: removeRange(p.clips, a, b) }))} />
                <div className={cn("space-y-2 rounded-[var(--radius-sm)] border p-2", selectedWindow ? "border-accent" : "border-edge")} data-transition-box>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-ink">{selectedWindow ? `Transition at ${fmtTime(selectedWindow.cut)}` : "Transitions"}</span>
                    <span className="text-faint">{placed.length > 1 ? `${windows.length} of ${placed.length - 1} cut${placed.length === 2 ? "" : "s"}` : "no cuts yet"}</span>
                  </div>
                  <select value={selectedWindow?.kind ?? project.transition.kind} onChange={(e) => changeTransition({ kind: e.target.value as TransitionKind })} className={SEL} aria-label="Transition">
                    {TRANSITIONS.map((t) => (
                      <option key={t.kind} value={t.kind}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] text-faint">{TRANSITIONS.find((t) => t.kind === (selectedWindow?.kind ?? project.transition.kind))?.hint}</p>
                  <Slider label="Length" value={selectedWindow ? selectedWindow.incoming.transitionIn!.duration : project.transition.duration} min={0.25} max={3} step={0.25} onChange={(v) => changeTransition({ duration: v })} format={(v) => `${v} s, centred on the cut`} />
                  <div className="flex flex-wrap gap-1.5">
                    {selectedWindow ? (
                      <button
                        type="button"
                        onClick={() => {
                          setProject((p) => ({ ...p, clips: setTransition(p.clips, selectedWindow.incoming.id, null) }));
                          setSelectedTransition(null);
                        }}
                        className={cn(GHOST, "hover:border-danger hover:text-danger")}
                      >
                        <Trash2 size={13} /> Remove this transition
                      </button>
                    ) : (
                      <button type="button" onClick={addTransitionAtPlayhead} disabled={!project.clips.length} className={cn(GHOST, "border-accent text-accent")} title="Splits the clip at the playhead if it is not already on a cut">
                        + Add at playhead
                      </button>
                    )}
                    <button type="button" onClick={() => setProject((p) => ({ ...p, clips: applyTransitionToAll(p.clips, selectedWindow?.incoming.transitionIn ?? p.transition) }))} disabled={placed.length < 2} className={GHOST} title="Put this transition on every cut">
                      Apply to all cuts
                    </button>
                    {windows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setProject((p) => ({ ...p, clips: applyTransitionToAll(p.clips, null) }));
                          setSelectedTransition(null);
                        }}
                        className={GHOST}
                      >
                        Remove all
                      </button>
                    )}
                  </div>
                  <p className="text-[12px] text-faint">{selectedWindow ? "Changes here affect this cut only. Delete removes it." : "Adding at the playhead splits the clip there if it is not already on a cut. Click a ⋈ marker on the timeline to change or remove a transition."}</p>
                </div>
                {current && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[12.5px] text-muted">
                      In (s)
                      <input type="number" step={0.01} value={current.in} onChange={(e) => update(current.id, { in: Math.max(0, Math.min(current.out - 0.1, Number(e.target.value))) })} className={cn(INPUT, "mt-1 font-mono")} />
                    </label>
                    <label className="text-[12.5px] text-muted">
                      Out (s)
                      <input type="number" step={0.01} value={current.out} onChange={(e) => update(current.id, { out: Math.min(project.media[current.media]?.duration ?? current.out, Math.max(current.in + 0.1, Number(e.target.value))) })} className={cn(INPUT, "mt-1 font-mono")} />
                    </label>
                  </div>
                )}
              </>
            )}
            {tab === "transform" && (current ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted">Rotate</span>
                  {([0, 1, 2, 3] as const).map((q) => (
                    <button key={q} type="button" onClick={() => update(current.id, { transform: { ...current.transform, rotate: q } })} className={cn("h-7 rounded-[var(--radius-sm)] border px-2 text-[12.5px]", current.transform.rotate === q ? "border-accent bg-accent-soft text-accent" : "border-edge text-muted")}>
                      {q * 90}°
                    </button>
                  ))}
                </div>
                <Slider label="Straighten" value={current.transform.straighten} min={-10} max={10} step={0.1} onChange={(v) => update(current.id, { transform: { ...current.transform, straighten: v } })} format={(v) => `${v.toFixed(1)}°`} />
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <Slider key={k} label={{ x: "Crop left", y: "Crop top", w: "Crop width", h: "Crop height" }[k]} value={current.transform.crop[k]} min={k === "w" || k === "h" ? 0.1 : 0} max={1} step={0.005} onChange={(v) => update(current.id, { transform: { ...current.transform, crop: { ...current.transform.crop, [k]: v } } })} format={(v) => `${Math.round(v * 100)}%`} />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => update(current.id, { transform: { ...NEUTRAL_TRANSFORM, crop: { ...NEUTRAL_TRANSFORM.crop } } })} className={GHOST}>
                    Reset
                  </button>
                  <button type="button" onClick={() => setProject((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, transform: { ...current.transform, crop: { ...current.transform.crop } } })) }))} className={GHOST}>
                    Apply to all clips
                  </button>
                </div>
              </>
            ) : <p className="text-muted">Select a clip to rotate, straighten or crop it.</p>)}
            {tab === "colour" && (current ? (
              <>
                <label className="flex items-center justify-between gap-2 text-muted">
                  Conversion
                  <select
                    value={current.grade.lut}
                    onChange={(e) => {
                      const kind = e.target.value as LutKind;
                      if (kind === "custom" && !project.customLut) return cubeInput.current?.click();
                      update(current.id, { grade: { ...current.grade, lut: kind } });
                    }}
                    className={SEL}
                    aria-label="Conversion"
                  >
                    <option value="none">None (Rec.709 footage)</option>
                    {LUT_OPTIONS.map((o) => (
                      <option key={o.kind} value={o.kind}>
                        {o.name}
                      </option>
                    ))}
                    <option value="custom">{project.customLut ? `Your .cube — ${project.customLut.name}` : "Your own .cube file…"}</option>
                  </select>
                </label>
                <input ref={cubeInput} type="file" accept=".cube" hidden onChange={(e) => e.target.files?.[0] && void loadCube(e.target.files[0], current.id)} />
                <p className="text-[12px] text-faint">
                  {current.grade.lut === "custom"
                    ? `${project.customLut?.name ?? "No file yet"} is applied as-is: it should expect the camera's log in and give Rec.709 out. `
                    : (LUT_OPTIONS.find((o) => o.kind === current.grade.lut)?.hint ?? "Pick the conversion for the camera's log profile; the sliders below fine-tune on top of it. ")}
                  {isFileLutKind(current.grade.lut) && !fileLuts && " Loading DJI's LUT file… "}
                  {!isFileLutKind(current.grade.lut) && current.grade.lut !== "custom" && current.grade.lut !== "none" ? " " : ""}
                  <button type="button" onClick={() => cubeInput.current?.click()} className="underline decoration-dotted underline-offset-2 hover:text-accent">
                    {project.customLut ? "Replace the .cube" : "Load a .cube"}
                  </button>
                  {current.grade.lut !== "none" && current.grade.lut !== "custom" && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => {
                          const kind = current.grade.lut;
                          const lut = isFileLutKind(kind) ? fileLuts?.[kind] : buildDlogLut(kind as MathLutKind);
                          if (!lut) return setError("DJI's LUT file is still loading — try again in a moment.");
                          const blob = new Blob([lutToCube(lut)], { type: "text/plain" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `bench-${kind}.cube`;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                        }}
                        className="underline decoration-dotted underline-offset-2 hover:text-accent"
                        title="Save this conversion as a 33-point .cube for Resolve, Premiere or Final Cut"
                      >
                        Download as .cube
                      </button>
                    </>
                  )}
                  {" · "}
                  <a href="https://www.dji.com/lut" target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-accent">
                    DJI&apos;s official LUTs
                  </a>
                </p>
                <Slider label="Exposure" value={current.grade.exposure} min={-3} max={3} step={0.05} onChange={(v) => update(current.id, { grade: { ...current.grade, exposure: v } })} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`} />
                <Slider label="Temperature" value={current.grade.temperature} min={-100} max={100} step={1} onChange={(v) => update(current.id, { grade: { ...current.grade, temperature: v } })} format={(v) => (v > 0 ? `warm +${v}` : v < 0 ? `cool ${v}` : "neutral")} />
                <Slider label="Tint" value={current.grade.tint} min={-100} max={100} step={1} onChange={(v) => update(current.id, { grade: { ...current.grade, tint: v } })} format={(v) => (v > 0 ? `magenta +${v}` : v < 0 ? `green ${v}` : "neutral")} />
                <Slider label="Contrast" value={current.grade.contrast} min={0.5} max={1.8} step={0.01} onChange={(v) => update(current.id, { grade: { ...current.grade, contrast: v } })} format={(v) => v.toFixed(2)} />
                <Slider label="Saturation" value={current.grade.saturation} min={0} max={2} step={0.01} onChange={(v) => update(current.id, { grade: { ...current.grade, saturation: v } })} format={(v) => v.toFixed(2)} />
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => update(current.id, { grade: { ...NEUTRAL_GRADE } })} className={GHOST}>
                    Reset
                  </button>
                  <button type="button" onClick={() => setProject((p) => ({ ...p, clips: applyGradeTo(p.clips, current.id, "all") }))} className={cn(GHOST, "border-accent text-accent")}>
                    Apply this look to all clips
                  </button>
                </div>
                <p className="text-[12px] text-faint">Grading re-encodes that clip on export; with no grade, rotation or crop the clip is copied without re-encoding.</p>
              </>
            ) : <p className="text-muted">Select a clip to grade it. Apply the LUT once, then copy the look to every clip for a consistent drive.</p>)}
            {tab === "audio" && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input ref={musicInput} type="file" accept="audio/*" multiple hidden onChange={(e) => e.target.files && void addMusic(Array.from(e.target.files))} />
                  <button type="button" onClick={() => musicInput.current?.click()} className={GHOST}>
                    <Music size={13} /> Add music
                  </button>
                  {current && (
                    <>
                      <span className="ml-2 text-muted">Original audio</span>
                      <label className="flex items-center gap-1 text-muted">
                        <input type="checkbox" checked={current.muted} onChange={(e) => update(current.id, { muted: e.target.checked })} className="accent-[var(--accent)]" /> mute
                      </label>
                    </>
                  )}
                </div>
                {current && (
                  <>
                    <Slider label={`Original audio gain · ${project.media[current.media]?.name}`} value={current.gainDb} min={-60} max={12} step={0.5} onChange={(v) => update(current.id, { gainDb: v })} format={(v) => (v <= -60 ? "off" : `${v > 0 ? "+" : ""}${v} dB`)} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => setProject((p) => ({ ...p, clips: applyAudioTo(p.clips, current.id, "all") }))} disabled={project.clips.length < 2} className={cn(GHOST, "border-accent text-accent")} title="Give every clip this gain and mute setting">
                        Apply to all clips
                      </button>
                      <button type="button" onClick={() => update(current.id, { gainDb: DEFAULT_CLIP_GAIN_DB })} className={GHOST}>
                        Reset to {DEFAULT_CLIP_GAIN_DB} dB
                      </button>
                      <span className="text-[12px] text-faint">New clips start at {DEFAULT_CLIP_GAIN_DB} dB so road noise sits under the music.</span>
                    </div>
                  </>
                )}
                {currentMusic ? (
                  <div className="space-y-2 border-t border-edge pt-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{project.media[currentMusic.media]?.name}</span>
                      <button type="button" onClick={() => setProject((p) => ({ ...p, music: p.music.filter((m) => m.id !== currentMusic.id) }))} className="text-faint hover:text-danger">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setProject((p) => ({ ...p, music: reorderMusic(p.music, currentMusic.id, -1) }))} className={GHOST}>
                        ◀ Earlier on this lane
                      </button>
                      <button type="button" onClick={() => setProject((p) => ({ ...p, music: reorderMusic(p.music, currentMusic.id, 1) }))} className={GHOST}>
                        Later on this lane ▶
                      </button>
                    </div>
                    {effectiveMusicEnd(currentMusic, duration) < currentMusic.start + musicLength(currentMusic) && (
                      <p className="text-[12px] text-faint">
                        Runs past the end of the video, so it is cut at {fmtTime(duration)} and fades out over {currentMusic.fadeOut || 1} s before that.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[12.5px] text-muted">
                        Starts at (s)
                        <input type="number" step={0.1} value={currentMusic.start} onChange={(e) => updateMusic(currentMusic.id, { start: Math.max(0, Number(e.target.value)) })} className={cn(INPUT, "mt-1 font-mono")} />
                      </label>
                      <label className="text-[12.5px] text-muted">
                        Lane
                        <select value={currentMusic.lane} onChange={(e) => updateMusic(currentMusic.id, { lane: Number(e.target.value) })} className={cn(SEL, "mt-1 w-full")}>
                          {[0, 1, 2].map((l) => (
                            <option key={l} value={l}>
                              Music {l + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Slider label="Gain" value={currentMusic.gainDb} min={-60} max={12} step={0.5} onChange={(v) => updateMusic(currentMusic.id, { gainDb: v })} format={(v) => (v <= -60 ? "off" : `${v > 0 ? "+" : ""}${v} dB`)} />
                    <div className="grid grid-cols-2 gap-2">
                      <Slider label="Fade in" value={currentMusic.fadeIn} min={0} max={15} step={0.5} onChange={(v) => updateMusic(currentMusic.id, { fadeIn: v })} format={(v) => `${v} s`} />
                      <Slider label="Fade out" value={currentMusic.fadeOut} min={0} max={15} step={0.5} onChange={(v) => updateMusic(currentMusic.id, { fadeOut: v })} format={(v) => `${v} s`} />
                    </div>
                    <label className="flex items-center gap-1 text-muted">
                      <input type="checkbox" checked={currentMusic.muted} onChange={(e) => updateMusic(currentMusic.id, { muted: e.target.checked })} className="accent-[var(--accent)]" /> mute
                    </label>
                    <div>
                      <div className="flex items-center justify-between text-[12.5px] text-muted">
                        Volume keyframes
                        <button type="button" onClick={() => updateMusic(currentMusic.id, { keyframes: [...currentMusic.keyframes, { t: Math.max(0, playhead - currentMusic.start), db: currentMusic.gainDb }].sort((a, b) => a.t - b.t) })} className={GHOST}>
                          + at playhead
                        </button>
                      </div>
                      {currentMusic.keyframes.map((k, i) => (
                        <div key={i} className="mt-1 flex items-center gap-2 text-[12.5px]">
                          <span className="font-mono text-faint">{fmtTime(currentMusic.start + k.t)}</span>
                          <input type="range" min={-60} max={12} step={0.5} value={k.db} onChange={(e) => updateMusic(currentMusic.id, { keyframes: currentMusic.keyframes.map((x, j) => (j === i ? { ...x, db: Number(e.target.value) } : x)) })} className={RANGE} />
                          <span className="w-14 font-mono text-ink tabular">{k.db <= -60 ? "off" : `${k.db} dB`}</span>
                          <button type="button" onClick={() => updateMusic(currentMusic.id, { keyframes: currentMusic.keyframes.filter((_, j) => j !== i) })} className="text-faint hover:text-danger">
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    {fades.filter((f) => f.a === currentMusic.id || f.b === currentMusic.id).map((f) => (
                      <p key={f.a + f.b} className="text-[12px] text-faint">
                        Crossfades with the neighbouring track from {fmtTime(f.from)} to {fmtTime(f.to)} ({(f.to - f.from).toFixed(1)} s, equal-power).
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-faint">Music lands after the previous track on its lane, overlapping by 2 s for a crossfade. Select a track on the timeline to adjust it; tracks on different lanes play together.</p>
                )}
              </>
            )}
            {tab === "titles" && (
              <>
                <div className="sticky top-0 z-10 -mx-3 -mt-3 flex flex-wrap gap-1.5 bg-surface px-3 pt-3 pb-2">
                  <button type="button" onClick={() => addTitle("intro")} className={GHOST}>
                    + Intro card
                  </button>
                  <button type="button" onClick={() => addTitle("title")} className={GHOST}>
                    + Title at playhead
                  </button>
                  <button type="button" onClick={() => addTitle("lowerThird")} className={GHOST}>
                    + Lower third
                  </button>
                  <input ref={logoInput} type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={(e) => e.target.files?.[0] && void addLogo(e.target.files[0])} />
                  <button type="button" onClick={() => logoInput.current?.click()} className={GHOST}>
                    {logo ? "Replace logo" : "+ Logo watermark"}
                  </button>
                </div>
                {project.titles.length > 0 && <p className="text-[12px] text-faint">In time order. Open one to edit it; titles that overlap in time are all drawn, so give them different positions.</p>}
                {[...project.titles]
                  .sort((a, b) => a.start - b.start)
                  .map((t) => {
                    const open = selectedTitle === t.id;
                    return (
                  <div key={t.id} className={cn("rounded-[var(--radius-sm)] border", open ? "border-accent" : "border-edge")}>
                    <div className="flex items-center gap-1.5 pr-1.5">
                      <button type="button" onClick={() => focusTitle(open ? null : t)} aria-expanded={open} className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12.5px] hover:bg-raised">
                        <ChevronRight size={13} className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")} />
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{KIND_LABELS[t.kind]}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{t.text || "Untitled"}</span>
                        <span className="shrink-0 font-mono text-[11px] text-faint tabular">
                          {fmtTime(t.start)}–{fmtTime(t.start + t.duration)} · {POSITION_NAMES[t.position]}
                        </span>
                      </button>
                      <button type="button" onClick={() => removeTitle(t.id)} className="text-faint hover:text-danger" aria-label="Delete title">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {open && (
                    <div className="space-y-1.5 border-t border-edge p-2">
                    <input value={t.text} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? { ...x, text: e.target.value } : x)) }))} className={INPUT} aria-label="Title text" />
                    <input value={t.subtitle ?? ""} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? { ...x, subtitle: e.target.value } : x)) }))} placeholder="Subtitle (optional)" className={INPUT} aria-label="Subtitle" />
                    <div className="grid grid-cols-3 gap-2 text-[12px] text-muted">
                      <label>
                        Start (s)
                        <input type="number" step={0.1} value={t.start} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? { ...x, start: Math.max(0, Number(e.target.value)) } : x)) }))} className={cn(INPUT, "mt-0.5 font-mono")} />
                      </label>
                      <label>
                        Length (s)
                        <input type="number" step={0.5} value={t.duration} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? { ...x, duration: Math.max(0.5, Number(e.target.value)) } : x)) }))} className={cn(INPUT, "mt-0.5 font-mono")} />
                      </label>
                      <label>
                        Fade (s)
                        <input type="number" step={0.25} value={t.fade} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? { ...x, fade: Math.max(0, Number(e.target.value)) } : x)) }))} className={cn(INPUT, "mt-0.5 font-mono")} />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted">
                      <span className="grid grid-cols-3 gap-0.5" title="Position in the frame" role="group" aria-label="Position">
                        {TITLE_POSITIONS.map((pos) => (
                          <button key={pos} type="button" onClick={() => patchTitle(t.id, { position: pos })} aria-label={POSITION_NAMES[pos]} title={POSITION_NAMES[pos]} aria-pressed={t.position === pos} className={cn("h-4 w-4 rounded-[2px] border", t.position === pos ? "border-accent bg-accent" : "border-edge bg-base hover:border-accent")} />
                        ))}
                      </span>
                      <label className="flex items-center gap-1">
                        Text
                        <input type="color" value={toHex(t.color)} onChange={(e) => patchTitle(t.id, { color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-edge bg-base p-0" aria-label="Text colour" />
                      </label>
                      <label className="flex items-center gap-1">
                        Box
                        <select
                          value={t.background === "" ? "none" : t.background === "rgba(0,0,0,0.55)" ? "dark" : t.background === "rgba(255,255,255,0.85)" ? "light" : "custom"}
                          onChange={(e) => patchTitle(t.id, { background: e.target.value === "none" ? "" : e.target.value === "dark" ? "rgba(0,0,0,0.55)" : e.target.value === "light" ? "rgba(255,255,255,0.85)" : toHex(t.background) === "#ffffff" ? "#000000" : toHex(t.background) })}
                          className={cn(SEL, "h-6 text-[12px]")}
                          aria-label="Background"
                        >
                          <option value="none">none</option>
                          <option value="dark">dark</option>
                          <option value="light">light</option>
                          <option value="custom">custom…</option>
                        </select>
                        {t.background && !/^rgba/.test(t.background) && <input type="color" value={toHex(t.background)} onChange={(e) => patchTitle(t.id, { background: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-edge bg-base p-0" aria-label="Background colour" />}
                      </label>
                      <label className="flex items-center gap-1">
                        Font
                        <select value={t.font} onChange={(e) => patchTitle(t.id, { font: e.target.value as TitleFont })} className={cn(SEL, "h-6 text-[12px]")} aria-label="Font">
                          {(Object.keys(TITLE_FONTS) as TitleFont[]).map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex min-w-[140px] flex-1 items-center gap-1">
                        Size
                        <input type="range" min={0.02} max={0.16} step={0.005} value={t.size} onChange={(e) => patchTitle(t.id, { size: Number(e.target.value) })} className={RANGE} aria-label="Text size" />
                        <span className="font-mono tabular">{Math.round(t.size * 100)}%</span>
                      </label>
                    </div>
                    </div>
                    )}
                  </div>
                    );
                  })}
                {project.watermark.media && (
                  <div className="space-y-2 border-t border-edge pt-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-muted">
                      Logo corner
                      {(["tl", "tr", "bl", "br"] as const).map((c) => (
                        <button key={c} type="button" onClick={() => setProject((p) => ({ ...p, watermark: { ...p.watermark, corner: c } }))} className={cn("h-7 rounded-[var(--radius-sm)] border px-2 text-[12px] uppercase", project.watermark.corner === c ? "border-accent bg-accent-soft text-accent" : "border-edge")}>
                          {c}
                        </button>
                      ))}
                      <button type="button" onClick={() => { setLogo(null); setProject((p) => ({ ...p, watermark: { ...p.watermark, media: null } })); }} className="ml-auto text-faint hover:text-danger">
                        remove
                      </button>
                    </div>
                    <Slider label="Logo size" value={project.watermark.size} min={0.03} max={0.3} step={0.005} onChange={(v) => setProject((p) => ({ ...p, watermark: { ...p.watermark, size: v } }))} format={(v) => `${Math.round(v * 100)}% of width`} />
                    <Slider label="Opacity" value={project.watermark.opacity} min={0.1} max={1} step={0.05} onChange={(v) => setProject((p) => ({ ...p, watermark: { ...p.watermark, opacity: v } }))} format={(v) => `${Math.round(v * 100)}%`} />
                  </div>
                )}
              </>
            )}
            {tab === "export" && (
              <>
                <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2 text-[12.5px]" data-export-range>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">Range</span>
                    <span className="font-mono text-[12px] text-faint tabular">{range ? `${fmtTime(range.from)} → ${fmtTime(range.to)} · ${fmtTime(range.to - range.from)}` : `whole timeline · ${fmtTime(duration)}`}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="flex items-center gap-1 text-muted">
                      From
                      <input type="number" step={0.1} min={0} max={duration} value={project.export.range?.from ?? 0} onChange={(e) => setRange({ from: Number(e.target.value), to: project.export.range?.to ?? duration })} className={cn(INPUT, "w-24 font-mono")} aria-label="Export from (seconds)" />
                    </label>
                    <button type="button" onClick={() => setRange({ from: playhead, to: project.export.range?.to ?? duration })} className={GHOST} title="Start the export at the playhead">
                      ⇤ playhead
                    </button>
                    <label className="flex items-center gap-1 text-muted">
                      To
                      <input type="number" step={0.1} min={0} max={duration} value={project.export.range?.to ?? duration} onChange={(e) => setRange({ from: project.export.range?.from ?? 0, to: Number(e.target.value) })} className={cn(INPUT, "w-24 font-mono")} aria-label="Export to (seconds)" />
                    </label>
                    <button type="button" onClick={() => setRange({ from: project.export.range?.from ?? 0, to: playhead })} className={GHOST} title="End the export at the playhead">
                      playhead ⇥
                    </button>
                    {project.export.range && (
                      <button type="button" onClick={() => setRange(null)} className={GHOST}>
                        Whole timeline
                      </button>
                    )}
                  </div>
                  {project.export.range && !range && <p className="text-[12px] text-danger">From must come before To (inside the timeline), or the whole timeline is exported.</p>}
                  <p className="text-[12px] text-faint">Export just a part of the drive — to check a grade quickly, or to cut one section for a short.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[12.5px] text-muted">
                    Codec
                    <select value={project.export.codec} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, codec: e.target.value as "hevc" | "avc" } }))} className={cn(SEL, "mt-1 w-full")}>
                      <option value="hevc">HEVC / H.265 (recommended for 8K)</option>
                      <option value="avc">H.264 (compatibility)</option>
                    </select>
                  </label>
                  <label className="text-[12.5px] text-muted">
                    Resolution
                    <select value={String(project.export.resolution)} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, resolution: e.target.value === "source" ? "source" : (Number(e.target.value) as 2160 | 1440 | 1080) } }))} className={cn(SEL, "mt-1 w-full")}>
                      <option value="source">Source ({first?.width ?? "—"} × {first?.height ?? "—"})</option>
                      <option value="2160">4K (2160p)</option>
                      <option value="1440">1440p</option>
                      <option value="1080">1080p</option>
                    </select>
                  </label>
                  <label className="text-[12.5px] text-muted">
                    Encoder preset
                    <select value={project.export.preset} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, preset: e.target.value as "quality" | "balanced" | "fast" } }))} className={cn(SEL, "mt-1 w-full")}>
                      <option value="quality">Quality</option>
                      <option value="balanced">Balanced</option>
                      <option value="fast">Fast</option>
                    </select>
                  </label>
                  <label className="text-[12.5px] text-muted">
                    Audio bitrate
                    <select value={project.export.audioBitrateKbps} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, audioBitrateKbps: Number(e.target.value) } }))} className={cn(SEL, "mt-1 w-full")}>
                      {[128, 192, 256, 320].map((b) => (
                        <option key={b} value={b}>
                          {b} kbps AAC
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Slider label="Video bitrate" value={project.export.bitrateMbps} min={10} max={300} step={5} onChange={(v) => setProject((p) => ({ ...p, export: { ...p.export, bitrateMbps: v } }))} format={(v) => `${v} Mbps${v >= 80 && v <= 160 ? " · YouTube 8K range" : ""}`} />
                <label className="flex items-center gap-1.5 text-muted">
                  <input type="checkbox" checked={project.export.smartCopy} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, smartCopy: e.target.checked } }))} className="accent-[var(--accent)]" />
                  Smart copy — pass untouched footage through without re-encoding
                </label>
                <div className="rounded-[var(--radius-sm)] bg-base p-2 text-[12.5px]">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Copied <span className="font-mono text-ink">{fmtTime(estimate.copySeconds)}</span>
                    </span>
                    <span>
                      Re-encoded <span className="font-mono text-ink">{fmtTime(estimate.encodeSeconds)}</span>
                    </span>
                    <span>
                      About <span className="font-mono text-ink">{(estimate.bytes / 1e9).toFixed(1)} GB</span>
                    </span>
                    <span>
                      Roughly <span className="font-mono text-ink">{fmtTime(estimate.wallSeconds)}</span> to export
                    </span>
                  </div>
                  {spans.some((s) => s.kind === "encode") && <p className="mt-1 text-faint">Re-encoding because: {[...new Set(spans.flatMap((s) => s.reasons))].join(", ") || "titles"}.</p>}
                </div>
                <button type="button" onClick={() => void runExport()} disabled={!project.clips.length || !!job} className={PRIMARY}>
                  <Download size={14} /> Export to project folder
                </button>
                <p className="text-[12px] text-faint">Upload the file to YouTube as-is: HEVC in MP4 at 80–160 Mbps is what YouTube recommends for 8K. Keep the browser tab in front while exporting.</p>
              </>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div className="panel p-2">
        <div ref={timelineRef} className="relative overflow-x-auto" onPointerDown={seekFromEvent}>
          <div className="relative" style={{ width: Math.max(100, duration * pxPerSec + 40), minHeight: 150 }}>
            {/* ruler */}
            <div className="h-5 border-b border-edge text-[10px] text-faint">
              {Array.from({ length: Math.ceil(duration / rulerStep(duration, zoom)) + 1 }, (_, i) => i * rulerStep(duration, zoom)).map((t) => (
                <span key={t} className="absolute top-0" style={{ left: t * pxPerSec }}>
                  {fmtTime(t)}
                </span>
              ))}
            </div>
            {/* video lane */}
            <div className="relative mt-1 h-12">
              {placed.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setSelected(c.id);
                    setSelectedMusic(null);
                    setSelectedTransition(null);
                    setPlayhead(c.start);
                    setSeekToken((t) => t + 1);
                  }}
                  className={cn("absolute top-0 h-full overflow-hidden rounded-[var(--radius-sm)] border px-2 text-left text-[11.5px]", selected === c.id ? "border-accent bg-accent-soft text-ink" : "border-edge bg-raised text-muted")}
                  style={{ left: c.start * pxPerSec, width: Math.max(4, (c.end - c.start) * pxPerSec - 1) }}
                  title={`${project.media[c.media]?.name} ${fmtTime(c.in)}–${fmtTime(c.out)}`}
                >
                  <span className="block truncate font-medium">{project.media[c.media]?.name}</span>
                  <span className="block truncate text-faint">
                    {c.grade.lut !== "none" || c.grade.exposure || c.grade.saturation !== 1 ? "graded · " : ""}
                    {c.transform.rotate || c.transform.straighten || c.transform.crop.w !== 1 || c.transform.crop.h !== 1 ? "cropped · " : ""}
                    {fmtTime(c.end - c.start)}
                  </span>
                </button>
              ))}
              {range && <div className="pointer-events-none absolute top-0 h-full border-x-2 border-accent bg-accent/10" style={{ left: range.from * pxPerSec, width: (range.to - range.from) * pxPerSec }} title={`Export range ${fmtTime(range.from)} → ${fmtTime(range.to)}`} data-export-band />}
              {windows.map((w) => (
                <button
                  key={w.incoming.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setTab("trim");
                    focusTransition(w.incoming.id);
                  }}
                  className={cn("absolute top-0 flex h-full items-center justify-center border-x border-ink/60 bg-white/50 text-[11px] text-ink hover:bg-white/70", selectedTransition === w.incoming.id && "bg-accent-soft ring-2 ring-accent")}
                  style={{ left: w.start * pxPerSec, width: Math.max(8, (w.end - w.start) * pxPerSec) }}
                  title={`${TRANSITIONS.find((t) => t.kind === w.kind)?.name} · ${(w.end - w.start).toFixed(2)} s — click to change or remove`}
                  aria-label={`Transition at ${fmtTime(w.cut)}`}
                  data-transition
                >
                  ⋈
                </button>
              ))}
            </div>
            {/* title lanes: overlapping titles stack */}
            <div className="relative mt-1" style={{ height: titleLaneOf.count * 22 - 2 }}>
              {project.titles.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setTab("titles");
                    focusTitle(t);
                  }}
                  className={cn("absolute h-5 truncate rounded-[3px] bg-[#e5484d]/70 px-1 text-left text-[10.5px] text-white", selectedTitle === t.id && "ring-2 ring-white/90")}
                  style={{ left: t.start * pxPerSec, width: Math.max(4, t.duration * pxPerSec), top: (titleLaneOf.lanes[t.id] ?? 0) * 22 }}
                  title={t.text}
                >
                  {t.text}
                </button>
              ))}
            </div>
            {/* music lanes */}
            {[0, 1, 2].map((lane) => (
              <div key={lane} className="relative mt-1 h-7">
                {project.music.filter((m) => m.lane === lane).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setSelectedMusic(m.id);
                      setSelected(null);
                      setTab("audio");
                    }}
                    className={cn("absolute top-0 h-full truncate rounded-[3px] border px-1.5 text-left text-[11px]", selectedMusic === m.id ? "border-ink" : "border-transparent", m.muted && "opacity-40")}
                    style={{ left: m.start * pxPerSec, width: Math.max(4, (effectiveMusicEnd(m, duration) - m.start) * pxPerSec), backgroundColor: LANE_COLORS[lane] + "66" }}
                    title={project.media[m.media]?.name}
                  >
                    {project.media[m.media]?.name} {m.gainDb <= -60 ? "(off)" : `${m.gainDb} dB`}
                    {effectiveMusicEnd(m, duration) < m.start + musicLength(m) ? " · cut at the end" : ""}
                  </button>
                ))}
              </div>
            ))}
            {/* playhead */}
            <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#e5484d]" style={{ left: playhead * pxPerSec }} />
          </div>
        </div>
        <p className="mt-1 text-[11.5px] text-faint">Click the ruler to seek · space plays · ⌘Z undoes · ⌘S saves. Clips are shown in playback order; music lanes stack, and overlaps on one lane crossfade.</p>
      </div>
      {clearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="clear-project-title">
          <div className="absolute inset-0 bg-scrim" onClick={() => setClearOpen(false)} />
          <div className="relative w-full max-w-md space-y-3 rounded-[var(--radius)] border border-edge bg-base p-4 shadow-dialog">
            <h3 id="clear-project-title" className="text-[15px] font-semibold text-ink">
              Clear this project?
            </h3>
            <p className="text-[13px] text-muted">The editor forgets the project in this browser: the open timeline, its undo history and the remembered folder. Your recordings and music files are never deleted.</p>
            {folder ? (
              <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2 text-[13px]">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={clearFiles} onChange={(e) => setClearFiles(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>
                    Also delete the project file and autosave from <b>{folder}</b>
                    <span className="block text-[12px] text-faint">
                      {PROJECT_FILE} and {AUTOSAVE_FILE}. Leave this off to reopen the project later from the folder.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={clearProxies} onChange={(e) => setClearProxies(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>
                    Also delete the rendered proxies
                    <span className="block text-[12px] text-faint">The {PROXY_DIR}/ folder. They can be rendered again any time.</span>
                  </span>
                </label>
              </div>
            ) : (
              <p className="text-[12px] text-faint">No project folder is open, so nothing on disk changes.</p>
            )}
            <p className="text-[12px] text-faint">Nothing else in the folder is touched: the footage stays exactly where it is.</p>
            <div className="flex justify-end gap-2">
              <button ref={keepButtonRef} type="button" onClick={() => setClearOpen(false)} className={GHOST}>
                Keep project
              </button>
              <button type="button" onClick={() => void clearProject()} className={cn(PRIMARY, "bg-danger hover:bg-danger")} data-confirm-clear>
                <Trash2 size={13} /> Clear project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function rulerStep(duration: number, zoom: number): number {
  const target = Math.max(10, duration) / (8 * zoom);
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]) if (s >= target) return s;
  return 3600;
}

function RangeCut({ duration, onCut }: { duration: number; onCut: (a: number, b: number) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const parse = (s: string) => s.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
  const from = parse(a), to = parse(b);
  const valid = a && b && Number.isFinite(from) && Number.isFinite(to) && to > from && from >= 0 && to <= duration;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      Remove from
      <input value={a} onChange={(e) => setA(e.target.value)} placeholder="1:02:30" className={cn(INPUT, "w-24 font-mono")} aria-label="Remove from" />
      to
      <input value={b} onChange={(e) => setB(e.target.value)} placeholder="1:10:00" className={cn(INPUT, "w-24 font-mono")} aria-label="Remove to" />
      <button type="button" disabled={!valid} onClick={() => { onCut(from, to); setA(""); setB(""); }} className={GHOST}>
        Cut it out
      </button>
      <span className="text-faint">— e.g. a petrol stop; the footage stays continuous.</span>

    </div>
  );
}

export { DEFAULT_EXPORT };
