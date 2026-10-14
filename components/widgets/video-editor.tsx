"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, Check, ChevronDown, ChevronRight, ChevronUp, Sparkles, Circle, Clapperboard, Crop, Download, FolderOpen, Loader, Maximize2, Minimize2, Music, Pause, Play, Repeat, Save, Scissors, SkipBack, SkipForward, SlidersHorizontal, StepBack, StepForward, Trash2, Type, Upload, Volume2, VolumeX, Keyboard, Search, Shuffle, X } from "lucide-react";
import { DEFAULT_CLIP_GAIN_DB, DEFAULT_EXPORT, NEUTRAL_GRADE, NEUTRAL_TRANSFORM, TITLE_ALIGNS, TITLE_FAMILIES, TITLE_FONTS, TITLE_POSITIONS, TITLE_SHADOWS, TITLE_WEIGHTS, TRANSITIONS, addTransitionAt, appendMusic, applyAudioTo, applyGradeTo, applyTransitionToAll, clipAt, crossfades, dbToGain, effectiveMusicEnd, estimateExport, exportRange, fmtTime, musicGainAt, musicLength, newId, newProject, newTitle, orderRecordings, placeClips, planExport, removeRange, reorderMusic, setTransition, splitClip, timelineDuration, titleLanes, transitionAt, transitionWindows, CLIP_SPEEDS, canMergeWithNext, clipLength, clipSpeed, groupOf, sourceTimeAt, mergeWithNext, moveClip, unjoin, updateClip, visibleCuts, type Clip, type MediaRef, type MusicTrack, type Project, type ProxyHeight, type Title, type TitleFont, isFileLutKind, type FileLutKind, type LutKind, type MathLutKind, type TitleAlign, type TitlePosition, type TitleShadow, type Transition, type TransitionKind, type ExportTags, type IntroSettings, reorderClip, parseTime, type SteadyLights, STEADY_FRAMES, clampMusicStart, musicUnused, shuffleFillMusic, describeWhere, type MediaWhere } from "@/lib/tools/video/project";
import { drawTransition } from "@/lib/tools/video/transitions";
import { LUT_OPTIONS, buildDlogLut, deriveLut, fetchOfficialLut, lutToCube, parseCube, type Lut3D } from "@/lib/tools/video/lut";
import { fmtBytes, fmtDelta, fmtDuration, fmtMs, type EstimateSource, type ExportProgress, type SpeedPriors, type StepProgress } from "@/lib/tools/video/progress";
import { buildProxy, drawOverlays, encoderSupport, exportProject, Grader, MAX_AUDIBLE_SPEED, MIN_AUDIBLE_SPEED, probe, renderFrame, renderSceneThumbs, scanMoments, scanMotion, Steadier } from "@/lib/tools/video/engine";
import { INTRO_STYLES, addSceneAt, buildIntro, describeIntro, drawIntroFx, hasIntro, introCandidates, introFrameAt, introLength, introRegion, introStyle, mainClips, moveScene, pickMoments, removeIntro, removeScene, restyleIntro, sceneSecondsFor, scoreMoments, setSceneSeconds, shiftAfterIntro, styledGrade, sceneFootage, minSceneSeconds, introBlendAt } from "@/lib/tools/video/intro";
import { ProjectStore, hasFileSystemAccess, AUTOSAVE_FILE, FRAMES_DIR, PROJECT_FILE, PROXY_DIR } from "@/lib/tools/video/store";
import { cn } from "@/lib/utils";
import { DEFAULT_STOPS, cutOutStops, stillRuns, stillThreshold, stopKey, stopsOnTimeline, stopsTotal, type Still, type StopScan } from "@/lib/tools/video/stops";
import { parseTemplateImport, videoTemplate } from "@/lib/tools/video/template";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { useKeepAwake } from "@/lib/keep-awake";
import { ENOUGH_SPACE, LOW_SPACE, estimateFree, overrideFreeSpace } from "@/lib/tools/video/space";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 text-[13px] text-ink outline-none focus:border-accent";
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const PRIMARY = "inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:opacity-40";
const RANGE = "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]";
const LANE_COLORS = ["#8a8f99", "#5ab3d6", "#d9a400"];
const POSITION_NAMES: Record<TitlePosition, string> = { tl: "Top left", tc: "Top centre", tr: "Top right", ml: "Middle left", mc: "Centre", mr: "Middle right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };
const KIND_LABELS: Record<Title["kind"], string> = { intro: "Intro", title: "Title", lowerThird: "Lower third" };
const DEFAULT_PREVIEW_HEIGHT: ProxyHeight = 0;
const toHex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffffff");
type Tab = "trim" | "intro" | "transform" | "colour" | "audio" | "titles" | "export";
const TABS: [Tab, string, typeof Scissors][] = [
  ["trim", "Trim", Scissors],
  ["intro", "Intro", Sparkles],
  ["transform", "Crop", Crop],
  ["colour", "Colour", SlidersHorizontal],
  ["audio", "Audio", Volume2],
  ["titles", "Titles", Type],
  ["export", "Export", Download],
];

interface Job {
  kind: "proxy" | "export" | "frame" | "intro" | "stops";
  label: string;
  fraction: number;
  message?: string;
  abort: AbortController;
  /** Export only: the live numbers, the output file, and whether it is paused. */
  progress?: ExportProgress;
  output?: { name: string; codec: string; width: number; height: number; bitrateMbps: number; preset: string; estimatedBytes: number };
  paused?: boolean;
  /** Export only: paused by the space watchdog (or a failed write) until the disk has room again. */
  lowSpace?: boolean;
  /** Free space as the browser last reported it. */
  freeBytes?: number | null;
}

/**
 * Speeds measured by earlier exports on this machine, per source→output profile,
 * so the next export's estimates start from experience rather than a guess.
 */
const SPEEDS_KEY = "bench:video:export-speeds:v1";
type LearnedSpeeds = Omit<SpeedPriors, "label"> & { at: number };
function loadPriors(profile: string, describe: string): SpeedPriors | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(SPEEDS_KEY) ?? "{}") as Record<string, LearnedSpeeds>;
    const got = all[profile];
    // How fast the browser closes a file depends on the machine, not the codec: the newest figure from any profile serves.
    const closeFrom = Object.values(all).filter((x) => x.closeBytesPerS).sort((a, b) => b.at - a.at)[0];
    if (!got && !closeFrom) return undefined;
    const { at, ...rest } = got ?? { at: closeFrom!.at };
    return { ...(closeFrom ? { closeBytesPerS: closeFrom.closeBytesPerS } : {}), ...rest, label: got ? `your last ${describe} export (${new Date(at).toLocaleDateString()})` : `an earlier export (${new Date(closeFrom!.at).toLocaleDateString()})` };
  } catch {
    return undefined;
  }
}
function savePriors(profile: string, measured: SpeedPriors) {
  try {
    const all = JSON.parse(localStorage.getItem(SPEEDS_KEY) ?? "{}") as Record<string, LearnedSpeeds>;
    // Keep what this run measured; earlier values stand in for kinds it did not exercise (no copy spans this time, say).
    all[profile] = { ...all[profile], ...measured, at: Date.now() };
    localStorage.setItem(SPEEDS_KEY, JSON.stringify(all));
  } catch {
    /* no storage (private window): the next export starts from the defaults again */
  }
}

/** The shortcut list behind the ? key. */
const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["Space (held)", "Double the preview speed while held"],
  ["Control (held)", "Skim the cuts: 3 s before and after each"],
  ["← / →", "Step one frame (⇧ for a second)"],
  ["↑ / ↓", "Jump to the previous or next cut"],
  ["Home / End", "Start or end of the timeline"],
  ["M", "Mute the preview"],
  ["S", "Save a thumbnail of the frame (⇧S full-size JPEG, ⌥S PNG)"],
  ["⌫", "Remove the selected transition"],
  ["⌘Z", "Undo"],
  ["⌘S", "Save the project"],
  ["T", "Timeline summary in full screen"],
  ["Esc", "Clear the selection; leave full screen or close a dialog"],
  ["⌘ + wheel", "Zoom the timeline around the pointer"],
  ["⌥ + drag", "Scrub without snapping to cuts"],
  ["?", "This list"],
];
/** Scrubbing snaps to a cut this close (pixels); hold Alt to scrub freely. */
const SNAP_PX = 6;
/** Timeline zoom range (× the fit-to-width scale). */
const ZOOM_MAX = 40;

/** Pointer handlers for a button that fires once on press and keeps firing while held (keyboard activation fires once). */
function useRepeat(fn: (shift: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const shift = e.shiftKey;
      fn(shift);
      const tick = () => {
        fn(shift);
        timer.current = setTimeout(tick, 60);
      };
      timer.current = setTimeout(tick, 350);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) fn(e.shiftKey);
    },
  };
}
type Picker = { showDirectoryPicker(opts?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle> };
const NOTIFY_KEY = "bench:video:notify";
/** A progress notification that replaces itself (same tag, silent), for a tab the user is not looking at. */
function notifyProgress(title: string, p: ExportProgress, final?: { body: string; failed?: boolean }) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (final) {
      new Notification(title, { body: final.body, tag: "bench-export-progress", silent: false });
      return;
    }
    const pct = Math.max(0, Math.min(1, p.fraction));
    const bar = "▓".repeat(Math.round(pct * 20)).padEnd(20, "░");
    const phase = p.phase === "video" && p.span?.kind === "copy" ? "Copying video" : PHASE_LABEL[p.phase];
    const finish = new Date(p.startedAt + p.elapsedMs + p.pausedMs + p.etaMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    new Notification(title, { body: `${bar} ${(pct * 100).toFixed(1)}%\n${phase} · about ${fmtDuration(p.etaMs)} left · done around ${finish}`, tag: "bench-export-progress", silent: true });
  } catch {
    /* no notifications */
  }
}
/** Get the user's attention: the tab title, a notification when allowed, and two short beeps. */
function alertUser(title: string, body: string) {
  document.title = `⚠️ ${title} · Bench`;
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag: "bench-export-space" });
  } catch {
    /* no notifications */
  }
  try {
    const ctx = new AudioContext();
    for (const at of [0, 0.25]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    }
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio */
  }
}
/** Holding Control skims the cuts: this many seconds before and after each one. */
const SKIM_S = 3;
/** What a navigation would abandon while a job runs. */
const JOB_WORK: Record<Job["kind"], string> = {
  export: "An export is running in the video editor; leaving now would abandon it.",
  proxy: "Proxies are still rendering in the video editor; leaving now would abandon them.",
  frame: "A frame is still being saved in the video editor.",
  intro: "The intro is still being made in the video editor; leaving now would abandon it.",
  stops: "The scan for stops is still running in the video editor; leaving now would abandon it.",
};
/** Holding Space this long (or the first key repeat) switches the preview to double speed instead of toggling play. */
const HOLD_MS = 250;
/** Browsers refuse playback rates above 16× on a video element, and silence the sound above 4×. */
const MAX_PREVIEW_RATE = 16;
const PREVIEW_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8, 12, 16];
/** Tests can watch every frame time the export hands to the encoder (see window.__benchVideo.traceFrames). */
let frameTrace: ((timelineT: number) => void) | null = null;

/** YouTube wants 1280×720 thumbnails under 2 MB; the frame is scaled to this height (never upscaled). */
const THUMB_HEIGHT = 720;
type FrameKind = "thumb" | "jpeg" | "png";
const FRAME_KINDS: Record<FrameKind, { label: string; note: string; height?: number; type: "image/jpeg" | "image/png"; quality?: number; ext: string }> = {
  thumb: { label: "YouTube thumbnail · JPEG", note: "1280×720-class, well under 2 MB (S)", height: THUMB_HEIGHT, type: "image/jpeg", quality: 0.92, ext: "jpg" },
  jpeg: { label: "Full size · JPEG", note: "source resolution, 95 % quality (Shift+S)", type: "image/jpeg", quality: 0.95, ext: "jpg" },
  png: { label: "Full size · PNG, lossless", note: "source resolution, large file (Alt+S)", type: "image/png", ext: "png" },
};

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block text-[12.5px] text-muted">
      <span className="flex items-center justify-between">
        {label}
        <span className="font-mono tabular text-ink">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange((min + max) / 2 === 0.5 ? 1 : 0)} title="Double-click to reset" className={cn(RANGE, "mt-1")} />
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
  const zoomRef = useRef(1);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const pxRef = useRef(80);
  const scrollAfterZoomRef = useRef<number | null>(null);
  /** A scrub in progress on the ruler or lanes (pointer captured). */
  const scrubRef = useRef<{ pointerId: number } | null>(null);
  const hoverLineRef = useRef<HTMLDivElement>(null);
  const hoverLabelRef = useRef<HTMLSpanElement>(null);
  /** A clip being dragged along the video lane to a new place. */
  const clipDragRef = useRef<{ id: string; startX: number; moved: boolean; pointerId: number; before: string | null | undefined } | null>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const [timeEdit, setTimeEdit] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  useUnsavedWork(job ? JOB_WORK[job.kind] : null);
  useKeepAwake(!!job, "bench-video-job");
  const [support, setSupport] = useState<{ hevc: boolean; avc: boolean } | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graderRef = useRef<Grader | null>(null);
  const steadyRef = useRef<Steadier | null>(null);
  const proxyUrls = useRef<Map<string, string>>(new Map());
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<Project[]>([]);
  const [timelineWidth, setTimelineWidth] = useState(800);
  const [seekToken, setSeekToken] = useState(0);
  // Bumped whenever files are (re)registered, so the preview tries again instead of staying blank.
  const [filesVersion, setFilesVersion] = useState(0);
  const [missingMedia, setMissingMedia] = useState<string[]>([]);
  // Preview transport: speed, looping (the export range when one is set), and a mute that silences clip audio and music.
  const [speed, setSpeed] = useState(1);
  // Holding Space doubles the speed for as long as it is held; a tap toggles play as before.
  const [boost, setBoost] = useState(false);
  const boostRef = useRef(false);
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  /** A Space press in flight: a short tap toggles play, a hold doubles the speed until release. */
  const spaceRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; boosted: boolean; startedPlayback: boolean } | null>(null);
  // A hold doubles the set speed, up to the 16× that browsers allow a video element.
  const rate = Math.min(MAX_PREVIEW_RATE, speed * (boost ? 2 : 1));
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  // Holding Control skims the cuts: the last seconds of each clip and the first of the next, skipping the middle.
  const [skim, setSkim] = useState(false);
  const skimRef = useRef<{ startedPlayback: boolean; skipped: string | null } | null>(null);
  // The frame the video element last showed: at a speed the decoder cannot keep up with, the clock would run ahead of
  // the picture and the clip would seem to jump to the next one, so the rate is eased down to what is being shown.
  const shownRef = useRef<{ mediaTime: number; at: number } | null>(null);
  const [frameMenu, setFrameMenu] = useState(false);
  // Intro: styled scene thumbnails (object URLs by clip id), the picker's settings, and where "Preview intro" stops.
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const [introCount, setIntroCount] = useState(6);
  const [introScan, setIntroScan] = useState(true);
  const stopAtRef = useRef<number | null>(null);
  const fxScratchRef = useRef<{ a: OffscreenCanvas; b: OffscreenCanvas; w: number; h: number } | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [fsTimeline, setFsTimeline] = useState(true);
  const fsTimelineRef = useRef(true);
  useEffect(() => {
    fsTimelineRef.current = fsTimeline;
  }, [fsTimeline]);
  const [localFonts, setLocalFonts] = useState<string[] | null>(null);
  const listLocalFonts = async () => {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (!q) return setError("This browser can't list installed fonts (Chrome and Edge can). Type a family name instead.");
    try {
      const fonts = await q.call(window);
      setLocalFonts([...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [loop, setLoop] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const loopRef = useRef(false);
  const previewMutedRef = useRef(false);
  useEffect(() => {
    loopRef.current = loop;
    previewMutedRef.current = previewMuted;
  }, [loop, previewMuted]);
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Stops: the scan lives on the project; which ones the user unticked lives here, keyed to that scan.
  const [stopDefaults, setStopDefaults] = useState({ minSeconds: DEFAULT_STOPS.minSeconds, margin: DEFAULT_STOPS.margin });
  // Fill the video with music: the crossfade between shuffled songs.
  const [fillOverlap, setFillOverlap] = useState(2);
  // Progress notifications while the tab is hidden (and one when a job finishes); remembered per browser.
  const [notify, setNotify] = useState(true);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const v = localStorage.getItem(NOTIFY_KEY);
        if (v === "0") setNotify(false);
      } catch {
        /* storage unavailable */
      }
      setNotifyPermission("Notification" in window ? Notification.permission : "unsupported");
    });
  }, []);
  const setNotifySetting = (on: boolean) => {
    setNotify(on);
    try {
      localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    if (on && "Notification" in window && Notification.permission === "default") void Notification.requestPermission().then((perm) => setNotifyPermission(perm));
  };
  const notifyAt = useRef(0);
  /** Every ten seconds while the tab is hidden, and on a phase change, replace the progress notification. */
  const maybeNotify = (title: string, p: ExportProgress) => {
    if (!notify || document.visibilityState === "visible") return;
    const now = p.startedAt + p.elapsedMs + p.pausedMs;
    if (now - notifyAt.current < 10000) return;
    notifyAt.current = now;
    notifyProgress(title, p);
  };
  /** The job is over: say so once, however the tab stands. */
  const notifyDone = (title: string, body: string, p?: ExportProgress) => {
    if (!notify || !p) return;
    notifyProgress(title, p, { body });
  };
  // Rendered preview: the real export at a small size on a chosen stretch, played in the preview box.
  const [previewOpts, setPreviewOpts] = useState<{ height: number; scope: "all" | "range" | "intro" | "around"; proxies: boolean }>({ height: 360, scope: "around", proxies: true });
  const [rendered, setRendered] = useState<{ url: string; width: number; height: number; from: number; to: number; proxies: boolean; bytes: number; ms: number } | null>(null);
  const renderedVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => () => {
    if (rendered) URL.revokeObjectURL(rendered.url);
  }, [rendered]);
  const [skippedStops, setSkippedStops] = useState<{ scannedAt: number; keys: string[] }>({ scannedAt: 0, keys: [] });
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
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShortcutsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOpen]);
  const clearProject = async () => {
    setPlaying(false);
    store.cancelAutosave();
    const notes: string[] = [];
    if (folder && clearFiles) {
      const removed = await store.removeProjectFiles();
      if (removed.length) notes.push(`deleted ${removed.join(" and ")}`);
    }
    if (folder && clearProxies && (await store.removeProxies())) notes.push(`deleted ${PROXY_DIR}/`);
    await store.forget(project.id);
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
  const windows = useMemo(() => transitionWindows(placed, project.media), [placed, project.media]);
  const selectedWindow = useMemo(() => windows.find((w) => w.incoming.id === selectedTransition) ?? null, [windows, selectedTransition]);
  const titleLaneOf = useMemo(() => titleLanes(project.titles), [project.titles]);
  const spans = useMemo(() => planExport(project), [project]);
  const range = useMemo(() => exportRange(project), [project]);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  const setRange = (r: { from: number; to: number } | null) => setProject((p) => ({ ...p, export: { ...p.export, range: r } }));
  const setTags = (patch: Partial<ExportTags>) => setProject((p) => ({ ...p, export: { ...p.export, tags: { ...p.export.tags, ...patch } } }));
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
    projectRef.current = project;
  }, [project]);
  // "Preview intro" stops at the end of the intro; any other stop forgets that.
  useEffect(() => {
    if (!playing) stopAtRef.current = null;
  }, [playing]);
  useEffect(() => {
    previewRef.current = project.preview.proxyHeight;
  }, [project.preview.proxyHeight]);
  useEffect(() => {
    durationRef.current = duration;
    fpsRef.current = Object.values(project.media).find((m) => m.fps)?.fps || 30;
  }, [duration, project.media]);

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
  const durationRef = useRef(0);
  const fpsRef = useRef(30);
  /** True when a key event comes from a text field, where editing keys must keep their meaning. */
  const inField = (e: KeyboardEvent) => e.target instanceof Element && !!e.target.closest("input, textarea, select");
  const togglePlay = useCallback(() => {
    void audioCtxRef.current?.resume();
    setPlaying((p) => {
      if (!p && playheadRef.current >= durationRef.current - 0.05) {
        setPlayhead(0);
        setSeekToken((x) => x + 1);
      }
      return !p;
    });
  }, []);
  /** Park the playhead at an exact time (paused), e.g. one frame on. */
  const stepTo = useCallback((t: number) => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(durationRef.current, t)));
    setSeekToken((x) => x + 1);
  }, []);
  /**
   * Space, held: double the preview speed (whatever it is set to) until the key is released. Held while paused, the
   * preview plays at double speed for the hold and parks again. These live outside the key effect so a re-render
   * mid-hold cannot cancel it.
   */
  const beginHold = useCallback(() => {
    const h = spaceRef.current;
    if (!h || h.boosted) return;
    h.boosted = true;
    boostRef.current = true;
    setBoost(true);
    if (!playingRef.current) {
      h.startedPlayback = true;
      togglePlay();
    }
  }, [togglePlay]);
  /** Space released (or the window lost): end a hold, or treat a short press as a play/pause tap. */
  const endHold = useCallback(
    (released: boolean) => {
      const h = spaceRef.current;
      if (!h) return;
      spaceRef.current = null;
      if (h.timer) clearTimeout(h.timer);
      if (h.boosted) {
        boostRef.current = false;
        setBoost(false);
        if (h.startedPlayback) setPlaying(false);
      } else if (released) togglePlay();
    },
    [togglePlay],
  );
  useEffect(() => () => endHold(false), [endHold]);
  /** Control, held: skim the cuts until released; held while paused, the preview plays for the hold and parks again. */
  const beginSkim = useCallback(() => {
    if (skimRef.current) return;
    skimRef.current = { startedPlayback: !playingRef.current, skipped: null };
    setSkim(true);
    if (!playingRef.current) togglePlay();
  }, [togglePlay]);
  const endSkim = useCallback(() => {
    const k = skimRef.current;
    if (!k) return;
    skimRef.current = null;
    setSkim(false);
    if (k.startedPlayback) setPlaying(false);
  }, []);
  useEffect(() => () => endSkim(), [endSkim]);

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

  /**
   * A still of the frame under the playhead, rendered from the source (never the proxy) with the grade, transitions and
   * titles: a YouTube-sized JPEG thumbnail by default, or the full frame as JPEG or lossless PNG.
   */
  const saveFrame = useCallback(
    async (kind: FrameKind = "thumb") => {
      if (!project.clips.length || job) return;
      const t = Math.min(playheadRef.current, Math.max(0, durationRef.current - 0.001));
      const spec = FRAME_KINDS[kind];
      setJob({ kind: "frame", label: "Saving frame", message: `${fmtMs(t)} · ${spec.label} — decoding the source frame, grading it and encoding…`, fraction: 0.5, abort: new AbortController() });
      try {
        const frame = await renderFrame({ project, getFile: (id) => store.getFile(id), logo, t, height: spec.height, type: spec.type, quality: spec.quality });
        const name = `${project.name.replace(/[^\w-]+/g, "-")}-${fmtMs(t).replace(/[:.]/g, "-")}${kind === "thumb" ? `-${frame.width}x${frame.height}` : ""}.${spec.ext}`;
        const facts = `${frame.width}×${frame.height} ${spec.type === "image/png" ? "PNG" : "JPEG"}, ${fmtBytes(frame.blob.size)}, from ${frame.clipName} at ${fmtMs(frame.sourceTime)}`;
        if (store.hasFolder) {
          const { writable } = await store.createWritable(name, FRAMES_DIR);
          await writable.write(frame.blob);
          await writable.close();
          setStatus(`Saved ${FRAMES_DIR}/${name} in the project folder — ${facts}`);
        } else {
          const url = URL.createObjectURL(frame.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          setStatus(`Downloaded ${name} — ${facts}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setJob(null);
      }
    },
    [project, job, store, logo],
  );

  useEffect(() => {
    let active = true;
    encoderSupport(7680, 4320)
      .then((s) => active && setSupport(s))
      .catch(() => active && setSupport({ hevc: false, avc: false }));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const onUnload = () => void store.flush();
    window.addEventListener("beforeunload", onUnload);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void store.save(project);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedTransitionRef.current && !inField(e)) {
        e.preventDefault();
        const id = selectedTransitionRef.current;
        setProject((p) => ({ ...p, clips: setTransition(p.clips, id, null) }));
        setSelectedTransition(null);
      } else if (e.key === "Control" && !inField(e)) {
        if (!e.repeat) beginSkim();
      } else if (e.key === " " && !inField(e)) {
        e.preventDefault();
        // A tap toggles play on release; a hold (a quarter second, or the first key repeat) doubles the speed until release.
        if (!e.repeat && !spaceRef.current) spaceRef.current = { timer: setTimeout(beginHold, HOLD_MS), boosted: false, startedPlayback: false };
        else if (e.repeat && spaceRef.current && !spaceRef.current.boosted) beginHold();
      } else if ((e.key === "t" || e.key === "T") && document.fullscreenElement && !inField(e)) {
        e.preventDefault();
        setFsTimeline(!fsTimelineRef.current);
      } else if (!inField(e) && !e.metaKey && !e.ctrlKey) {
        const t = playheadRef.current, frame = 1 / fpsRef.current;
        const cuts = visibleCuts(placeClips(project.clips));
        if (e.key === "ArrowLeft") stepTo(t - (e.shiftKey ? 1 : frame));
        else if (e.key === "ArrowRight") stepTo(t + (e.shiftKey ? 1 : frame));
        else if (e.key === "Home") stepTo(0);
        else if (e.key === "End") stepTo(durationRef.current);
        else if (e.key === "ArrowUp") stepTo([...cuts].reverse().find((c) => c < t - 0.01) ?? 0);
        else if (e.key === "ArrowDown") stepTo(cuts.find((c) => c > t + 0.01) ?? durationRef.current);
        else if (e.key === "?") setShortcutsOpen((v) => !v);
        else if (e.key === "Escape" && !document.fullscreenElement) {
          setSelected(null);
          setSelectedMusic(null);
          setSelectedTransition(null);
        }
        else if (e.key === "m" || e.key === "M") setPreviewMuted((m) => !m);
        else if (e.key === "s" || e.key === "S") void saveFrame(e.altKey ? "png" : e.shiftKey ? "jpeg" : "thumb");
        else return;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") endHold(true);
      else if (e.key === "Control") endSkim();
    };
    // Losing the window mid-hold must not leave the preview stuck at double speed or skimming.
    const onBlur = () => {
      endHold(false);
      endSkim();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [store, undo, project, setProject, togglePlay, stepTo, saveFrame, beginHold, endHold, beginSkim, endSkim]);

  /**
   * Find the files behind a project's media: remembered handles first (they
   * work for recordings anywhere on disk), then by name inside the folder.
   * Runs before the project is shown, so the preview never asks for a file
   * that is not there yet.
   */
  const resolveMedia = useCallback(
    async (p: Project, interactive: boolean) => {
      await store.restoreHandles(p.id, interactive);
      await store.loadFolders(p.id, interactive);
      for (const m of Object.values(p.media)) if (!store.hasFile(m.id) && m.where) await store.locateByPath(m.id, m.where);
      for (const m of Object.values(p.media)) if (!store.hasFile(m.id)) await store.resolveByName(m.id, m.name);
      setMissingMedia(store.missing(Object.keys(p.media)));
      setFilesVersion((v) => v + 1);
    },
    [store],
  );
  const openLoadedProject = useCallback(
    async (interactive: boolean) => {
      const loaded = await store.load();
      if (!loaded) return false;
      await resolveMedia(loaded.project, interactive);
      await loadProxies(loaded.project);
      await primeMusic(loaded.project);
      setProjectState(loaded.project);
      setRecovered(loaded.recovered);
      setPlayhead(0);
      setSeekToken((x) => x + 1);
      return true;
    },
    [store, resolveMedia, loadProxies, primeMusic],
  );

  // Try to reopen the last project folder silently.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!hasFileSystemAccess()) return;
      if (!(await store.reopenLast())) return;
      if (!active) return;
      setFolder(store.folderName);
      await openLoadedProject(false);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [store, openLoadedProject]);

  const chooseFolder = async () => {
    try {
      await store.pickFolder();
      setFolder(store.folderName);
      if (await openLoadedProject(true)) {
        setStatus("Project opened");
      } else {
        await store.save(project);
        await store.persistHandles(project.id);
      }
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addVideos = async (inputs: (File | FileSystemFileHandle)[]) => {
    const refs: MediaRef[] = [];
    const files: File[] = [];
    for (const h of inputs) {
      const id = newId();
      const f = h instanceof File ? h : await h.getFile();
      files.push(f);
      store.registerFile(id, h);
      try {
        const info = await probe(f);
        if (!info.canDecode) {
          setError(`${f.name}: this browser can't decode ${info.codec ?? "that codec"}.`);
          continue;
        }
        const where = (await store.whereIs(h)) ?? undefined;
        refs.push({ id, name: f.name, size: f.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, codec: info.codec ?? undefined, hasAudio: info.hasAudio, sampleRate: info.sampleRate, ...(where ? { where } : {}) });
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
    void store.persistHandles(project.id);
    setFilesVersion((v) => v + 1);
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

  /** Re-attach recordings the browser can no longer find: pick them again and match by name (then size). */
  /**
   * Match located files to the missing media: by name (then by size), and to every entry that matches — a song added
   * twice, or a recording imported again, has two media entries and both must come back from one located file.
   */
  const linkFiles = async (items: (File | FileSystemFileHandle)[]) => {
    const missing = store.missing(Object.keys(project.media)).map((id) => project.media[id]).filter(Boolean);
    const linked = new Set<string>();
    const placed_where = new Map<string, MediaWhere>();
    let files = 0;
    for (const h of items) {
      const f = h instanceof File ? h : await h.getFile();
      const byName = missing.filter((x) => x.name === f.name && !linked.has(x.id));
      const matches = byName.length ? byName : missing.filter((x) => x.size === f.size && !linked.has(x.id));
      if (!matches.length) continue;
      files++;
      const where = (await store.whereIs(h)) ?? undefined;
      for (const m of matches) {
        store.registerFile(m.id, h);
        linked.add(m.id);
        if (where) placed_where.set(m.id, where);
      }
    }
    if (placed_where.size) setProject((p) => ({ ...p, media: Object.fromEntries(Object.entries(p.media).map(([id, m]) => [id, placed_where.has(id) ? { ...m, where: placed_where.get(id) } : m])) }));
    await store.persistHandles(project.id);
    await resolveMedia(project, true);
    const uses = linked.size;
    setStatus(files ? `Linked ${files} file${files === 1 ? "" : "s"}${uses > files ? ` to ${uses} uses (the same file appears more than once)` : ""}` : "None of those matched a missing file by name or size");
    return uses;
  };
  /**
   * Remember a folder the files live in: every file already added from it gets its path recorded, missing files
   * with a matching name are found in it (one level deep), and next time its contents are located without asking.
   */
  const rememberFolder = async (picked?: FileSystemDirectoryHandle) => {
    const dirPicker = (window as unknown as Picker).showDirectoryPicker;
    try {
      const dir = picked ?? (await dirPicker({ id: "bench-video-folder", mode: "read" }));
      const key = await store.addFolder(project.id, dir);
      let recorded = 0, found = 0;
      const where = new Map<string, MediaWhere>();
      const live = new Set(["project", ...store.folderKeys()]);
      for (const m of Object.values(project.media)) {
        // A place whose folder is still known needs nothing; one whose folder handle was lost is tried again here.
        if (m.where && live.has(m.where.folder) && m.where.folder !== key) continue;
        if (store.hasFile(m.id)) {
          const f = store.handleOf(m.id);
          const w = f ? await store.whereIs(f) : null;
          if (w && (!m.where || w.folder !== m.where.folder || w.path !== m.where.path)) {
            where.set(m.id, w);
            recorded++;
          }
        } else {
          const byPath = m.where && (await store.locateByPath(m.id, { folder: key, path: m.where.path })) ? { folder: key, path: m.where.path } : null;
          const w = byPath ?? (await store.findInFolder(key, m.name, m.id));
          if (w) {
            where.set(m.id, w);
            found++;
          }
        }
      }
      setProject((p) => ({ ...p, folders: { ...(p.folders ?? {}), [key]: dir.name }, media: Object.fromEntries(Object.entries(p.media).map(([id, m]) => [id, where.has(id) ? { ...m, where: where.get(id) } : m])) }));
      await store.persistHandles(project.id);
      await resolveMedia({ ...project, media: Object.fromEntries(Object.entries(project.media).map(([id, m]) => [id, where.has(id) ? { ...m, where: where.get(id) } : m])) }, true);
      setStatus(`Remembered “${dir.name}”: ${found} missing file${found === 1 ? "" : "s"} found there, ${recorded} path${recorded === 1 ? "" : "s"} recorded — its files are located without asking from now on`);
      return key;
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const relinkFiles = async () => {
    const picker = (window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (!picker) return relinkInput.current?.click();
    try {
      const handles = await picker({ multiple: true, types: [{ description: "Recordings and music", accept: { "video/*": [".mp4", ".MP4", ".mov", ".MOV"], "audio/*": [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"] } }] });
      await linkFiles(handles);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Prefer the picker that hands back file handles (so files are remembered across reloads); fall back to the plain input. */
  const pickFiles = async (kind: "video" | "audio") => {
    const picker = (window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (!picker) return void (kind === "video" ? fileInput.current : musicInput.current)?.click();
    try {
      const handles = await picker({ multiple: true, types: [kind === "video" ? { description: "Recordings", accept: { "video/*": [".mp4", ".MP4", ".mov", ".MOV"] } } : { description: "Music", accept: { "audio/*": [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"] } }] });
      if (kind === "video") await addVideos(handles);
      else await addMusic(handles);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
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

  const addMusic = async (inputs: (File | FileSystemFileHandle)[]) => {
    for (const h of inputs) {
      const id = newId();
      const f = h instanceof File ? h : await h.getFile();
      store.registerFile(id, h);
      try {
        const info = await probe(f);
        const where = (await store.whereIs(h)) ?? undefined;
        const ref: MediaRef = { id, name: f.name, size: f.size, duration: info.duration, hasAudio: true, sampleRate: info.sampleRate, ...(where ? { where } : {}) };
        setProject((p) => ({ ...p, media: { ...p.media, [id]: ref }, music: [...p.music, appendMusic(p.music, { id: newId(), media: id, lane: 0, in: 0, out: info.duration, gainDb: -12, muted: false, fadeIn: 2, fadeOut: 3, keyframes: [] }, 2, timelineDuration(p))] }));
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
        if (!f) return setPreviewSrc(null);
        url = URL.createObjectURL(f);
        proxyUrls.current.set(id, url);
      }
      if (active) setPreviewSrc(url);
    })();
    return () => {
      active = false;
    };
  }, [under?.clip.media, store, under, filesVersion]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !under || !previewSrc) return;
    if (v.src !== previewSrc) v.src = previewSrc;
    // While playing, small drift is fine; paused, land on the exact frame so stepping works.
    if (Math.abs(v.currentTime - under.sourceTime) > (playing ? 0.3 : 0.5 / fpsRef.current)) v.currentTime = under.sourceTime;
    // The clip's own sound, at its gain (an element can't go above unity; export can).
    const gain = under.clip.muted ? 0 : Math.min(1, dbToGain(under.clip.gainDb));
    v.volume = gain;
    v.muted = gain === 0 || previewMuted;
    v.playbackRate = Math.min(MAX_PREVIEW_RATE, rate * clipSpeed(under.clip));
    if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [previewSrc, under, playing, rate, previewMuted]);

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
    // Above 4× the browser silences the video; pitch-shifted music at that speed is noise, so it goes quiet too.
    if (rate > 4) return stopAll;
    for (const m of project.music) {
      if (m.muted) continue;
      const buf = musicBuffers.current.get(m.media);
      if (!buf) continue;
      const end = effectiveMusicEnd(m, duration);
      if (at >= end) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(ctx.destination);
      const delay = Math.max(0, m.start - at), offset = m.in + Math.max(0, at - m.start);
      src.start(ctx.currentTime + delay, offset, Math.max(0.01, end - Math.max(at, m.start)));
      nodes.set(m.id, { src, gain });
    }
    return stopAll;
  }, [playing, seekToken, project.music, duration, rate]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    // Track the frame actually on screen (Chrome, Safari, recent Firefox); without it the throttle below stays off.
    const el = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (h: number) => void }) | null;
    let vfc = 0;
    const onFrame = (now: number, meta: { mediaTime: number }) => {
      shownRef.current = { mediaTime: meta.mediaTime, at: now };
      vfc = el?.requestVideoFrameCallback?.(onFrame) ?? 0;
    };
    if (el?.requestVideoFrameCallback) vfc = el.requestVideoFrameCallback(onFrame);
    const tick = () => {
      const v = videoRef.current;
      if (v && under) {
        const t = under.clip.start + (v.currentTime - under.clip.in) / clipSpeed(under.clip);
        const loopTo = rangeRef.current ? rangeRef.current.from : 0, loopEnd = rangeRef.current ? rangeRef.current.to : duration;
        // Skimming: once a clip has shown its first seconds, jump to its last ones; the next clip then shows its own start.
        const k = skimRef.current, skipTo = under.clip.end - SKIM_S;
        if (k && k.skipped !== under.clip.id && under.clip.end - under.clip.start > 2 * SKIM_S && t >= under.clip.start + SKIM_S && t < skipTo - 0.05) {
          k.skipped = under.clip.id;
          setPlayhead(skipTo);
          setSeekToken((x) => x + 1);
          raf = requestAnimationFrame(tick);
          return;
        }
        // A speed the decoder cannot keep up with: ease the rate down to what is being shown, and back up when it catches up.
        const shown = shownRef.current, target = Math.min(MAX_PREVIEW_RATE, rateRef.current * clipSpeed(under.clip));
        if (shown && target > 1 && v.src) {
          const lag = v.currentTime - shown.mediaTime;
          if (lag > 0.35 && v.playbackRate > 1) v.playbackRate = Math.max(1, v.playbackRate * 0.85);
          else if (lag < 0.15 && v.playbackRate < target) v.playbackRate = Math.min(target, v.playbackRate * 1.1);
        }
        const restart = () => {
          setPlayhead(loopTo);
          setSeekToken((x) => x + 1);
        };
        if (stopAtRef.current !== null && t >= stopAtRef.current - 0.03) {
          stopAtRef.current = null;
          setPlayhead(Math.min(duration, t));
          setPlaying(false);
        } else if (loopRef.current && t >= loopEnd - 0.03) restart();
        else if (v.currentTime >= under.clip.out - 0.05) {
          if (under.clip.end >= duration - 0.05) {
            if (loopRef.current) restart();
            else setPlaying(false);
          } else setPlayhead(Math.min(duration, under.clip.end + 0.001));
        } else setPlayhead(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (vfc) el?.cancelVideoFrameCallback?.(vfc);
      shownRef.current = null;
    };
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
          // Inside the intro the clips draw through the style's look, and its effects go on before the titles.
          const intro = introFrameAt(project, placed, playhead);
          const gradeFor = (clip: Clip) => (clip.introRole && intro ? styledGrade(clip.grade, intro.style) : clip.grade);
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
              const want = Math.max(0, sourceTimeAt(other, playhead));
              alt.playbackRate = Math.min(MAX_PREVIEW_RATE, rate * clipSpeed(other));
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
                grader.draw(v, gradeFor(under.clip), under.clip.transform, v.videoWidth, v.videoHeight);
                sc.a.getContext("2d")!.drawImage(grader.canvas, 0, 0);
                grader.draw(alt, gradeFor(other), other.transform, alt.videoWidth, alt.videoHeight);
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
                alt.currentTime = Math.max(0, sourceTimeAt(next.incoming, next.start));
              }
            }
          }
          if (!composed) {
            grader.draw(v, gradeFor(under.clip), under.clip.transform, v.videoWidth, v.videoHeight);
            ctx.drawImage(grader.canvas, 0, 0);
          }
          if (intro) {
            if (!fxScratchRef.current || fxScratchRef.current.w !== w || fxScratchRef.current.h !== h) fxScratchRef.current = { a: new OffscreenCanvas(w, h), b: new OffscreenCanvas(w, h), w, h };
            drawIntroFx(ctx, w, h, intro, project, fxScratchRef.current, introBlendAt(project, placed, tr, playhead));
          }
          drawOverlays(ctx as unknown as OffscreenCanvasRenderingContext2D, w, h, playhead, project, logo);
          // Steady lights, as the export will do it: only while playing, when frames arrive in order.
          const steadyFrames = STEADY_FRAMES[project.export.steadyLights ?? "off"];
          if (steadyFrames && playing) {
            if (!steadyRef.current || steadyRef.current.canvas.width !== w || steadyRef.current.canvas.height !== h || steadyRef.current.frames !== steadyFrames) steadyRef.current = new Steadier(w, h, steadyFrames);
            steadyRef.current.apply(c);
            ctx.drawImage(steadyRef.current.canvas, 0, 0, w, h);
          } else steadyRef.current?.reset();
          // Music gains follow the playhead so fades and crossfades are audible in the preview.
          for (const [id, node] of musicNodes.current) {
            const m = project.music.find((x) => x.id === id);
            node.gain.gain.value = m && !previewMutedRef.current ? musicGainAt(m, project.music, playhead, duration) : 0;
          }
        } catch {
          /* WebGL unavailable: fall back to the raw video element behind the canvas */
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [under, playhead, project, placed, logo, duration, windows, playing, rate, previewUrlFor, customLut, fileLuts]);

  // Grade, crop and audio changes reach every clip of a joined run, so a hidden cut stays invisible.
  const update = (id: string, patch: Partial<Clip>) => setProject((p) => ({ ...p, clips: updateClip(p.clips, id, patch) }));
  const mergeKind = current ? canMergeWithNext(project.clips, current.id) : null;
  const currentRun = current ? groupOf(project.clips, current.id) : [];
  const selectedRun = useMemo(() => new Set(selected ? groupOf(project.clips, selected) : []), [project.clips, selected]);
  /** For each clip bar: whether the next clip continues it, and how many clips its joined run spans (0 for a continuation). */
  const runInfo = useMemo(
    () =>
      placed.map((c, i) => {
        if (c.joinedToPrevious) return { joinsNext: !!placed[i + 1]?.joinedToPrevious, runCount: 0, runEnd: c.end };
        let k = i;
        while (placed[k + 1]?.joinedToPrevious) k++;
        return { joinsNext: k > i, runCount: k - i + 1, runEnd: placed[k].end };
      }),
    [placed],
  );
  const updateMusic = (id: string, patch: Partial<MusicTrack>) => setProject((p) => ({ ...p, music: p.music.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const songCount = new Set(project.music.map((m) => m.media)).size;
  /** Shuffle every song and lay them end to end over the whole video (replacing the music lanes). */
  const fillMusic = () => {
    const filled = shuffleFillMusic(project.music, duration, fillOverlap);
    if (filled === project.music) return;
    setProject((p) => ({ ...p, music: filled }));
    setSelectedMusic(null);
    setStatus(`${filled.length} song placements shuffled over ${fmtTime(duration)} from ${songCount} song${songCount === 1 ? "" : "s"}${fillOverlap ? `, ${fillOverlap} s crossfades` : ""} — Shuffle again for another order, ⌘Z to go back`);
  };
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
  const templateJsonInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const [importReplace, setImportReplace] = useState(false);
  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(videoTemplate(project), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w-]+/g, "-") || "video"}-template.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  /** A filled template: titles replace or join the current ones, and the intro section (if any) is applied too. */
  const importTemplateJson = async (file: File) => {
    try {
      const { titles, intro, warnings } = parseTemplateImport(await file.text(), project);
      let next: Project = titles.length ? { ...project, titles: importReplace ? titles : [...project.titles, ...titles] } : project;
      const notes: string[] = [];
      if (titles.length) notes.push(`${titles.length} title${titles.length === 1 ? "" : "s"}`);
      let makeScenes = 0;
      if (intro) {
        if (!intro.enabled) {
          if (hasIntro(next.clips)) notes.push("intro removed");
          next = { ...next, clips: removeIntro(next.clips) };
        } else {
          next = { ...next, intro: intro.settings };
          if (intro.moments.length) {
            next = { ...next, clips: buildIntro(next, intro.moments, sceneSecondsFor(next)) };
            notes.push(`intro from ${intro.moments.length} named moment${intro.moments.length === 1 ? "" : "s"}`);
          } else if (hasIntro(next.clips)) {
            next = { ...next, clips: restyleIntro(next) };
            notes.push(`intro restyled (${introStyle(next.intro.style).name})`);
          } else makeScenes = intro.scenes;
        }
      }
      const delta = introLength(next.clips) - introLength(project.clips);
      setProject(shiftAfterIntro(next, delta));
      if (titles[0]) setSelectedTitle(titles[0].id);
      if (makeScenes) {
        setIntroCount(makeScenes);
        notes.push(`intro of ${makeScenes} scenes being made`);
        void makeIntro(makeScenes, next);
      }
      if (intro && !titles.length) setTab("intro");
      setStatus(`Imported ${notes.join(", ") || "nothing new"} from ${file.name}${warnings.length ? ` with ${warnings.length} note${warnings.length === 1 ? "" : "s"}` : ""}`);
      if (warnings.length) setError(`Import notes: ${warnings.join(" · ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeTitle = (id: string) => {
    setProject((p) => ({ ...p, titles: p.titles.filter((x) => x.id !== id) }));
    setSelectedTitle((s) => (s === id ? null : s));
  };
  const patchTitle = (id: string, patch: Partial<Title>) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  /* ------------------------------------------------------------------ intro */
  const introReg = useMemo(() => introRegion(placed), [placed]);
  /** Scenes are read from the proxy when there is one (quick), else from the recording. */
  const fileForIntro = useCallback(
    async (mediaId: string) => {
      const px = projectRef.current?.proxies[mediaId];
      if (px?.ready && px.file) {
        const f = await store.proxyFile(px.file);
        if (f && f.size > 0) return f;
      }
      return store.getFile(mediaId);
    },
    [store],
  );
  /** What the picker can afford: scanning decodes small frames, cheap from proxies, slow from 8K originals. */
  const scanPlan = useMemo(() => {
    const main = mainClips(placed);
    if (!main.length) return null;
    const proxied = main.every((c) => project.proxies[c.media]?.ready);
    const maxH = Math.max(0, ...main.map((c) => project.media[c.media]?.height ?? 0));
    if (proxied) return { perWindow: 5, hint: "Scanned from the proxies, five candidates per scene — quick." };
    if (maxH <= 2160) return { perWindow: 3, hint: "No proxies yet: three candidates per scene are decoded from the recordings." };
    return { perWindow: 1, hint: "Without proxies, 8K recordings are too slow to scan, so the scenes are spaced evenly across the footage. Render proxies (in the preview's size menu) and make the intro again to pick the lively moments." };
  }, [placed, project.proxies, project.media]);
  /** Replace the clips through an intro operation; titles and the export range move with the drive. */
  const applyIntro = (fn: (p: Project) => Clip[] | null, failure?: string) => {
    const clips = fn(project);
    if (!clips) {
      if (failure) setError(failure);
      return;
    }
    const delta = introLength(clips) - introLength(project.clips);
    setProject((p) => shiftAfterIntro({ ...p, clips }, delta));
  };
  const setIntro = (patch: Partial<IntroSettings>) => {
    const next: Project = { ...project, intro: { ...project.intro, ...patch } };
    const clips = hasIntro(next.clips) ? restyleIntro(next) : next.clips;
    const delta = introLength(clips) - introLength(project.clips);
    setProject(shiftAfterIntro({ ...next, clips }, delta));
  };
  const stopMin = project.stops?.minSeconds ?? stopDefaults.minSeconds;
  const stopMargin = project.stops?.margin ?? stopDefaults.margin;
  const setStopSettings = (patch: Partial<{ minSeconds: number; margin: number }>) => {
    if (project.stops) setProject((p) => (p.stops ? { ...p, stops: { ...p.stops, ...patch } } : p));
    else setStopDefaults((d) => ({ ...d, ...patch }));
  };
  const stops = useMemo(() => (project.stops ? stopsOnTimeline(project.clips, project.stops) : []), [project.clips, project.stops]);
  const isSkipped = (key: string) => skippedStops.scannedAt === project.stops?.scannedAt && skippedStops.keys.includes(key);
  const activeStops = stops.filter((st) => !isSkipped(stopKey(st)));
  const toggleStop = (key: string) => {
    const at = project.stops?.scannedAt ?? 0;
    setSkippedStops((k) => {
      const keys = k.scannedAt === at ? k.keys : [];
      return { scannedAt: at, keys: keys.includes(key) ? keys.filter((x) => x !== key) : [...keys, key] };
    });
  };
  /** Scan every recording on the timeline for stretches where the picture stands still; proxies when there are any. */
  const scanStops = async () => {
    if (job) return;
    const ids = [...new Set(placed.filter((c) => !c.introRole).map((c) => c.media))];
    if (!ids.length) return setError("Add recordings first — stops are found in them.");
    const abort = new AbortController();
    const totals = ids.map((id) => project.media[id]?.duration ?? 0);
    const grand = totals.reduce((a, b) => a + b, 0) || 1;
    setJob({ kind: "stops", label: "Finding stops", message: "", fraction: 0, abort });
    const runs: Record<string, Still[]> = {}, thresholds: Record<string, number> = {};
    try {
      let before = 0;
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        const f = await fileForIntro(id);
        if (!f) continue;
        const name = project.media[id]?.name ?? id;
        const proxy = !!projectRef.current?.proxies[id]?.ready;
        const trace = await scanMotion(f, {
          step: DEFAULT_STOPS.step,
          signal: abort.signal,
          onProgress: (sec, total) => setJob((j) => (j ? { ...j, message: `${name}${proxy ? " (proxy)" : ""} · ${fmtTime(sec)} of ${fmtTime(total)}`, fraction: Math.min(1, (before + sec) / grand) } : j)),
        });
        thresholds[id] = stillThreshold(trace.scores);
        runs[id] = stillRuns(trace, thresholds[id]);
        before += totals[k];
      }
      const scan: StopScan = { step: DEFAULT_STOPS.step, runs, thresholds, minSeconds: stopMin, margin: stopMargin, scannedAt: Date.now() };
      const found = stopsOnTimeline(project.clips, scan);
      setProject((p) => ({ ...p, stops: scan }));
      setStatus(found.length ? `${found.length} stop${found.length === 1 ? "" : "s"} of ${stopMin} s or more, ${fmtTime(stopsTotal(found))} to cut — tick or untick them in Trim, then Cut out` : `No stops of ${stopMin} s or more found`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(`Couldn't scan for stops: ${(e as Error).message}`);
    } finally {
      setJob(null);
    }
  };
  const cutStops = () => {
    if (!activeStops.length) return;
    const total = stopsTotal(activeStops);
    setProject((p) => ({ ...p, clips: cutOutStops(p.clips, activeStops) }));
    setSelected(null);
    setSelectedTransition(null);
    setStatus(`Cut out ${activeStops.length} stop${activeStops.length === 1 ? "" : "s"}, ${fmtTime(total)} shorter`);
  };
  const makeIntro = async (count = introCount, base: Project = project) => {
    const main = mainClips(placeClips(base.clips));
    if (!main.length) return setError("Add recordings first — the intro is cut from them.");
    if (job) return;
    const seconds = sceneSecondsFor(base);
    const need = sceneFootage(introStyle(base.intro.style), seconds);
    const perWindow = introScan ? (scanPlan?.perWindow ?? 1) : 1;
    let windows = introCandidates(main, count, perWindow, need);
    if (perWindow > 1) {
      const abort = new AbortController();
      setJob({ kind: "intro", label: "Looking for lively moments", message: `${windows.flat().length} candidates`, fraction: 0, abort });
      try {
        const stats = await scanMoments(fileForIntro, base, windows, { signal: abort.signal, onProgress: (d, n) => setJob((j) => (j ? { ...j, fraction: d / n } : j)) });
        windows = scoreMoments(windows, stats);
      } catch (e) {
        if ((e as DOMException).name === "AbortError") {
          setJob(null);
          return;
        }
        setStatus("Couldn't scan the footage; spacing the scenes evenly instead.");
      } finally {
        setJob(null);
      }
    }
    const moments = pickMoments(windows);
    const clips = buildIntro(base, moments, seconds);
    const delta = introLength(clips) - introLength(base.clips);
    setProject((p) => shiftAfterIntro({ ...p, clips }, delta));
    setSelected(null);
    setSelectedTransition(null);
    setPlayhead(0);
    setSeekToken((x) => x + 1);
    setTab("intro");
    setStatus(`Intro: ${moments.length} scenes ${perWindow > 1 ? "picked for motion and contrast" : "spaced evenly across the footage"}, ${introStyle(base.intro.style).name} look — swap, reorder or retime them below.`);
  };
  const previewIntro = () => {
    if (!introReg) return;
    stopAtRef.current = introReg.end;
    setPlayhead(0);
    setSeekToken((x) => x + 1);
    setPlaying(true);
  };
  // Thumbnails of the scenes in the chosen look, re-rendered when a scene, the look or the card text changes.
  const thumbKey = introReg ? [...introReg.scenes, ...(introReg.card ? [introReg.card] : [])].map((c) => `${c.id}:${c.in.toFixed(2)}:${c.out.toFixed(2)}`).join("|") + `@${project.intro.style}@${project.intro.card.text}@${project.intro.card.subtitle}@${project.name}` : "";
  useEffect(() => {
    if (!thumbKey) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const p = projectRef.current;
      const region = p ? introRegion(placeClips(p.clips)) : null;
      if (!p || !region) return;
      renderSceneThumbs(fileForIntro, p, [...region.scenes, ...(region.card ? [region.card] : [])], 72, abort.signal)
        .then((m) => {
          if (abort.signal.aborted) {
            for (const u of m.values()) URL.revokeObjectURL(u);
            return;
          }
          setThumbs((old) => {
            for (const u of old.values()) URL.revokeObjectURL(u);
            return m;
          });
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [thumbKey, fileForIntro]);

  // Exposed for automated tests, which cannot drive the folder picker. Re-registered whenever the handlers change.
  useEffect(() => {
    (window as unknown as { __benchVideo?: unknown }).__benchVideo = {
      makeIntro,
      previewIntro,
      useDirectory: (d: FileSystemDirectoryHandle) => {
        store.useDirectory(d);
        setFolder(d.name || "test");
      },
      reopenDirectory: async (d: FileSystemDirectoryHandle) => {
        store.useDirectory(d);
        setFolder(d.name || "test");
        return openLoadedProject(false);
      },
      addVideos,
      addMusic,
      linkFiles,
      rememberFolder,
      overrideFreeSpace,
      missing: () => store.missing(Object.keys(project.media)),
      getProject: () => project,
      setProject: (fn: (p: Project) => Project) => setProject(fn),
      traceFrames: (fn: ((timelineT: number) => void) | null) => {
        frameTrace = fn;
      },
      audioState: () => ({ ctx: audioCtxRef.current?.state ?? null, nodes: musicNodes.current.size, buffers: musicBuffers.current.size, video: videoRef.current ? { muted: videoRef.current.muted, volume: videoRef.current.volume, paused: videoRef.current.paused } : null }),
    };
  });

  // The tab title shows export progress; this remembers what to put back.
  const pageTitleRef = useRef("");
  useEffect(() => {
    pageTitleRef.current = document.title;
  }, []);
  // Pause gate for the export: the engine awaits this between frames while paused.
  const pauseRef = useRef<{ paused: boolean; waiters: (() => void)[] }>({ paused: false, waiters: [] });
  const setExportPaused = (paused: boolean) => {
    pauseRef.current.paused = paused;
    if (!paused) {
      lowSpaceRef.current = false;
      for (const w of pauseRef.current.waiters) w();
      pauseRef.current.waiters = [];
    }
    setJob((j) => (j ? { ...j, paused, ...(paused ? {} : { lowSpace: false }) } : j));
  };
  const lowSpaceRef = useRef(false);
  /** Pause for lack of space and wait until the user resumes or the watchdog sees room again. */
  const pauseForSpace = (free: number | null, why: string) => {
    if (lowSpaceRef.current) return;
    lowSpaceRef.current = true;
    pauseRef.current.paused = true;
    setJob((j) => (j ? { ...j, paused: true, lowSpace: true, freeBytes: free } : j));
    alertUser("Disk almost full — export paused", `${why} Free some space and it continues on its own.`);
  };
  /**
   * While a job writes, watch the space the browser reports: under 2 GB it pauses the job and asks for attention;
   * once 3 GB are free again it resumes by itself. Returns a stop function.
   */
  const watchSpace = () => {
    const tick = async () => {
      const free = await estimateFree();
      if (free === null) return;
      setJob((j) => (j ? { ...j, freeBytes: free } : j));
      if (free < LOW_SPACE && !pauseRef.current.paused) pauseForSpace(free, `Only ${fmtBytes(free)} left as the browser reports it.`);
      else if (lowSpaceRef.current && free >= ENOUGH_SPACE) {
        setExportPaused(false);
        document.title = pageTitleRef.current;
        setStatus(`Space is back (${fmtBytes(free)} free) — continuing`);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 3000);
    return () => clearInterval(id);
  };
  /** A write just failed for lack of room: pause, and resolve when the export may try that chunk again. */
  const onWriteBlocked = async () => {
    const free = await estimateFree();
    pauseForSpace(free, "The disk refused a write.");
    pauseRef.current.paused = true;
    await new Promise<void>((r) => pauseRef.current.waiters.push(r));
  };
  /** Before an export: warn when the browser reports less room than the file needs; the choice stays with the user. */
  const spaceWarning = async (expectedBytes: number): Promise<boolean> => {
    const free = await estimateFree();
    if (free === null || expectedBytes <= free) return true;
    try {
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      /* ignore */
    }
    return window.confirm(`The file is expected to be about ${fmtBytes(expectedBytes)}, but the browser reports only ${fmtBytes(free)} free (it keeps a reserve, so the real figure may be a little higher).\n\nStart anyway? The export pauses itself when less than ${fmtBytes(LOW_SPACE)} remain and continues once you free space.`);
  };
  const runExport = async () => {
    if (!store.hasFolder) return setError("Pick a project folder first — the export is written there.");
    if (notify && "Notification" in window && Notification.permission === "default") void Notification.requestPermission().then((perm) => setNotifyPermission(perm));
    if (!(await spaceWarning(estimate.bytes))) return;
    notifyAt.current = 0;
    const abort = new AbortController();
    pauseRef.current = { paused: false, waiters: [] };
    lowSpaceRef.current = false;
    const stopWatch = watchSpace();
    const name = `${project.name.replace(/[^\w-]+/g, "-")}-${project.export.resolution === "source" ? "8K" : project.export.resolution + "p"}${range ? `-${Math.round(range.from)}s-${Math.round(range.to)}s` : ""}.mp4`;
    const outH = project.export.resolution === "source" ? (first?.height ?? 4320) : project.export.resolution;
    const outW = first?.width && first.height ? Math.round((first.width * (outH / first.height)) / 2) * 2 : Math.round((outH * 16) / 9);
    const output = { name, codec: project.export.codec.toUpperCase(), width: outW, height: outH, bitrateMbps: project.export.bitrateMbps, preset: project.export.preset, estimatedBytes: estimate.bytes };
    const profile = `${first?.height ?? 0}>${outH}:${project.export.codec}:${project.export.preset}`;
    setJob({ kind: "export", label: "Exporting", fraction: 0, abort, output, paused: false });
    try {
      const { writable } = await store.createWritable(name);
      const result = await exportProject({
        project,
        getFile: (id) => store.getFile(id),
        logo,
        writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
        signal: abort.signal,
        priors: loadPriors(profile, `${outH}p ${project.export.codec.toUpperCase()}`),
        whilePaused: () => (pauseRef.current.paused ? new Promise<void>((r) => pauseRef.current.waiters.push(r)) : undefined),
        onWriteBlocked,
        onFrame: (t) => frameTrace?.(t),
        onProgress: (progress) => {
          setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j));
          if (!lowSpaceRef.current) document.title = `${(progress.fraction * 100).toFixed(1)}% · ${progress.paused ? "Paused" : "Exporting"} · Bench`;
          lastProgress.current = progress;
          maybeNotify(`Exporting ${name}`, progress);
        },
      });
      notifyDone("Export finished", `${name} — ${fmtBytes(result.bytesWritten)} in ${fmtDuration(result.activeMs)}`, lastProgress.current ?? undefined);
      stopWatch();
      savePriors(profile, result.measured);
      const stepMs = (kind: StepProgress["kind"]) => result.steps.filter((s) => s.kind === kind).reduce((a, s) => a + s.elapsedMs, 0);
      setStatus(
        `Exported ${name} — ${fmtBytes(result.bytesWritten)} in ${fmtDuration(result.activeMs)}${result.pausedMs > 500 ? ` plus ${fmtDuration(result.pausedMs)} paused` : ""} (${(result.seconds / Math.max(0.001, result.activeMs / 1000)).toFixed(2)}× realtime) · prepare ${fmtDuration(stepMs("prepare"))} · video ${fmtDuration(stepMs("video"))} · audio ${fmtDuration(stepMs("audio"))} · finish ${fmtDuration(stepMs("finalize"))}`,
      );
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") {
        setError(e instanceof Error ? e.message : String(e));
        notifyDone("Export failed", e instanceof Error ? e.message : String(e), lastProgress.current ?? undefined);
      }
    } finally {
      stopWatch();
      document.title = pageTitleRef.current;
      setJob(null);
    }
  };
  const lastProgress = useRef<ExportProgress | null>(null);

  /** The stretch a rendered preview covers for the chosen scope, or null for the whole timeline. */
  const previewScope = (scope: typeof previewOpts.scope): { from: number; to: number } | null => {
    if (scope === "range") return range;
    if (scope === "intro") return introReg ? { from: 0, to: introReg.end } : null;
    if (scope === "around") return { from: Math.max(0, playhead - 15), to: Math.min(duration, playhead + 15) };
    return null;
  };
  /**
   * Run the real export — same spans, grades, transitions, intro effects, titles, steady lights — at a small size on a
   * stretch of the timeline into private browser storage, then play it in the preview box.
   */
  const renderPreview = async (opts = previewOpts) => {
    if (job || !placed.length) return;
    const scope = previewScope(opts.scope);
    if (scope && scope.to - scope.from < 0.1) return setError("Nothing to render in that stretch.");
    const abort = new AbortController();
    pauseRef.current = { paused: false, waiters: [] };
    const outH = Math.min(opts.height, first?.height ?? opts.height);
    const outW = first?.width && first.height ? Math.round((first.width * (outH / first.height)) / 2) * 2 : Math.round((outH * 16) / 9);
    const bitrateMbps = Math.max(1, Math.round(outH / 90));
    const seconds = scope ? scope.to - scope.from : duration;
    if (!(await spaceWarning((bitrateMbps * 1e6 * seconds) / 8))) return;
    lowSpaceRef.current = false;
    const stopWatch = watchSpace();
    const preview: Project = { ...project, export: { ...project.export, resolution: outH, codec: "avc", bitrateMbps, preset: "fast", smartCopy: false, range: scope } };
    const name = `preview-${outH}p.mp4`;
    setJob({ kind: "export", label: "Rendering preview", fraction: 0, abort, output: { name, codec: "AVC", width: outW, height: outH, bitrateMbps, preset: "fast", estimatedBytes: (bitrateMbps * 1e6 * seconds) / 8 }, paused: false });
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("bench-preview-renders", { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      const result = await exportProject({
        project: preview,
        getFile: opts.proxies ? fileForIntro : (id) => store.getFile(id),
        logo,
        writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
        signal: abort.signal,
        whilePaused: () => (pauseRef.current.paused ? new Promise<void>((r) => pauseRef.current.waiters.push(r)) : undefined),
        onWriteBlocked,
        onFrame: (t) => frameTrace?.(t),
        onProgress: (progress) => {
          setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j));
          if (!lowSpaceRef.current) document.title = `${(progress.fraction * 100).toFixed(1)}% · Rendering preview · Bench`;
          lastProgress.current = progress;
          maybeNotify("Rendering preview", progress);
        },
      });
      stopWatch();
      notifyDone("Rendered preview ready", `${outW}×${outH}, ${fmtTime(scope?.from ?? 0)}–${fmtTime(scope?.to ?? duration)} — playing in the editor`, lastProgress.current ?? undefined);
      const file = await fh.getFile();
      const url = URL.createObjectURL(file), ms = result.activeMs;
      setPlaying(false);
      // The previous render's URL is revoked by the effect that watches `rendered`.
      const usedProxies = opts.proxies && placed.some((c) => !!projectRef.current?.proxies[c.media]?.ready);
      setRendered({ url, width: outW, height: outH, from: scope?.from ?? 0, to: scope?.to ?? duration, proxies: usedProxies, bytes: file.size, ms });
      setStatus(`Rendered preview: ${outW}×${outH}, ${fmtTime(scope?.from ?? 0)}–${fmtTime(scope?.to ?? duration)}, ${fmtBytes(file.size)} in ${fmtDuration(ms)} — playing in the preview; Back to live preview to leave it`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      stopWatch();
      document.title = pageTitleRef.current;
      setJob(null);
    }
  };
  // Scrubbing the timeline while a rendered preview shows seeks it; playing it moves the playhead.
  useEffect(() => {
    const v = renderedVideoRef.current;
    if (!rendered || !v || !v.paused) return;
    const want = Math.max(0, Math.min(rendered.to - rendered.from, playheadRef.current - rendered.from));
    if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want;
  }, [seekToken, rendered]);

  const pxPerSec = (timelineWidth / Math.max(10, duration)) * zoom;
  useEffect(() => {
    pxRef.current = pxPerSec;
  }, [pxPerSec]);
  /** Where the longest track ends: lanes draw out to here so an unused tail is visible, hatched, past the video. */
  const musicFarEnd = project.music.reduce((a, m) => Math.max(a, m.start + musicLength(m)), 0);
  const underClipId = under?.clip.id ?? null;
  useEffect(() => {
    steadyRef.current?.reset();
  }, [seekToken, underClipId]);
  /** Timeline seconds under a pointer, snapped to a nearby cut unless told not to. */
  const timeAtPointer = (el: HTMLDivElement, clientX: number, snap: boolean) => {
    const r = el.getBoundingClientRect();
    let t = Math.max(0, Math.min(duration, (clientX - r.left + el.scrollLeft) / pxPerSec));
    if (snap) {
      for (const c of visibleCuts(placed)) {
        if (Math.abs(c - t) * pxPerSec <= SNAP_PX) {
          t = c;
          break;
        }
      }
    }
    return t;
  };
  const onTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    scrubRef.current = { pointerId: e.pointerId };
    setPlayhead(timeAtPointer(el, e.clientX, !e.altKey));
    setSeekToken((x) => x + 1);
  };
  const onTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const t = timeAtPointer(el, e.clientX, !e.altKey);
    if (scrubRef.current) setPlayhead(t);
    if (hoverLineRef.current) {
      hoverLineRef.current.style.left = `${t * pxPerSec}px`;
      hoverLineRef.current.style.display = clipDragRef.current?.moved ? "none" : "block";
    }
    if (hoverLabelRef.current) hoverLabelRef.current.textContent = fmtTime(t, first?.fps);
  };
  const onTimelinePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubRef.current) return;
    scrubRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setSeekToken((x) => x + 1);
  };
  const onTimelinePointerLeave = () => {
    if (hoverLineRef.current) hoverLineRef.current.style.display = "none";
  };
  /**
   * Change the zoom keeping the playhead where it is on screen (or centred if it was out of view); with an anchor
   * (the pointer, for wheel zoom) that point stays put instead and the playhead is only nudged into view.
   */
  const zoomTo = useCallback((z: number, anchor?: { t: number; x: number }) => {
    const el = timelineRef.current;
    const from = zoomRef.current;
    const next = Math.max(1, Math.min(ZOOM_MAX, z));
    if (next === from) return;
    const pxNow = pxRef.current, pxNext = (pxNow / from) * next;
    setZoom(next);
    if (!el) return;
    const view = el.clientWidth;
    const ph = playheadRef.current * pxNext;
    let left: number;
    if (anchor) {
      left = anchor.t * pxNext - anchor.x;
      if (ph < left + 16) left = ph - 16;
      else if (ph > left + view - 16) left = ph - view + 16;
    } else {
      const phNow = playheadRef.current * pxNow - el.scrollLeft;
      left = phNow >= 0 && phNow <= view ? ph - phNow : ph - view / 2;
    }
    scrollAfterZoomRef.current = Math.max(0, left);
  }, []);
  // The scroll position for a new zoom is applied once the wider lane is in the DOM, before it paints.
  useLayoutEffect(() => {
    const el = timelineRef.current, left = scrollAfterZoomRef.current;
    if (!el || left === null) return;
    scrollAfterZoomRef.current = null;
    el.scrollLeft = left;
  }, [zoom]);
  // ⌘/Ctrl + wheel over the timeline zooms around the pointer; a plain wheel scrolls as usual.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.005), { t: (x + el.scrollLeft) / pxRef.current, x });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);
  // While playing, the view follows the playhead: when it runs off the right edge the timeline scrolls on.
  useEffect(() => {
    if (!playing || scrubRef.current) return;
    const el = timelineRef.current;
    if (!el) return;
    const px = playhead * pxPerSec, view = el.clientWidth;
    if (px < el.scrollLeft || px > el.scrollLeft + view - 24) el.scrollLeft = Math.max(0, px - view * 0.2);
  }, [playhead, playing, pxPerSec]);
  const stepBack = useRepeat((shift) => stepTo(playheadRef.current - (shift ? 1 : 1 / fpsRef.current)));
  const stepForward = useRepeat((shift) => stepTo(playheadRef.current + (shift ? 1 : 1 / fpsRef.current)));
  /** Dragging a drive clip along the lane moves it before the clip the pointer is over (intro scenes stay put). */
  const beginClipDrag = (e: React.PointerEvent<HTMLButtonElement>, c: (typeof placed)[number]) => {
    if (e.button !== 0 || c.introRole) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clipDragRef.current = { id: c.id, startX: e.clientX, moved: false, pointerId: e.pointerId, before: undefined };
  };
  const moveClipDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = clipDragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 5) return;
    d.moved = true;
    const el = timelineRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = (e.clientX - r.left + el.scrollLeft) / pxPerSec;
    const main = placed.filter((c) => !c.introRole);
    let idx = main.findIndex((c) => t < (c.start + c.end) / 2);
    if (idx < 0) idx = main.length;
    d.before = idx < main.length ? main[idx].id : null;
    const x = idx < main.length ? main[idx].start : (main[main.length - 1]?.end ?? 0);
    if (dropLineRef.current) {
      dropLineRef.current.style.display = "block";
      dropLineRef.current.style.left = `${x * pxPerSec - 1}px`;
    }
  };
  const endClipDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = clipDragRef.current;
    if (!d) return;
    clipDragRef.current = null;
    if (dropLineRef.current) dropLineRef.current.style.display = "none";
    if (e.currentTarget.hasPointerCapture(d.pointerId)) e.currentTarget.releasePointerCapture(d.pointerId);
    if (!d.moved || d.before === undefined) return;
    suppressClickRef.current = true;
    const before = d.before;
    setProject((p) => ({ ...p, clips: reorderClip(p.clips, d.id, before) }));
    setSelected(d.id);
  };
  const first = project.media[project.clips[0]?.media ?? ""];
  const previewAspect = first?.width && first.height ? first.width / first.height : 16 / 9;
  const thumbH = Math.min(THUMB_HEIGHT, first?.height ?? THUMB_HEIGHT);
  const thumbSize = `${Math.round((previewAspect * thumbH) / 2) * 2}×${thumbH}`;

  return (
    <div className="space-y-3">
      {/* project bar */}
      <input ref={templateJsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importTemplateJson(e.target.files[0])} data-template-input />
      <input ref={relinkInput} type="file" accept="video/*,audio/*,.mp4,.mov,.mp3,.m4a,.wav,.aac,.flac,.ogg" multiple hidden onChange={(e) => e.target.files?.length && void linkFiles(Array.from(e.target.files))} data-relink-input />
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
          <button type="button" onClick={() => void pickFiles("video")} className={cn(PRIMARY, "h-8 px-3 text-[13px]")}>
            <Upload size={13} /> Add recordings
          </button>
        </div>
      </div>
      {missingMedia.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
          <AlertTriangle size={14} className="text-warn" />
          <span>
            {missingMedia.length === 1 ? "One recording can" : `${missingMedia.length} recordings can`}&apos;t be found right now: {missingMedia.map((id) => project.media[id]?.name ?? id).join(", ")}. The timeline is intact; pick the file{missingMedia.length === 1 ? "" : "s"} again to preview and export.
          </span>
          {missingMedia.some((id) => project.media[id]?.where) && (
            <span className="basis-full text-[12px] text-faint" data-missing-where>
              Last seen at {missingMedia.filter((id) => project.media[id]?.where).map((id) => describeWhere(project, project.media[id])).join(", ")}.
            </span>
          )}
          <button type="button" onClick={() => void rememberFolder()} disabled={!hasFileSystemAccess()} className={cn(GHOST, "ml-auto")} title="Point at the folder the files live in: their paths inside it are recorded, missing ones are found there by name, and next time they are located without asking" data-remember-folder>
            Remember a folder…
          </button>
          <button type="button" onClick={() => void relinkFiles()} className={cn(GHOST, "border-accent text-accent")}>
            Locate files…
          </button>
        </div>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertTriangle size={14} /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-faint hover:text-ink">
            dismiss
          </button>
        </p>
      )}
      {job?.kind === "export" && (
        <ExportPanel job={job} onPause={() => setExportPaused(true)} onResume={() => setExportPaused(false)} onCancel={() => job.abort.abort()} />
      )}
      {job && job.kind !== "export" && (
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
              // Handles (when the browser offers them) are remembered across reloads; plain Files are not.
              const items = Array.from(e.dataTransfer.items) as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })[];
              const pending = items.filter((i) => i.kind === "file").map((i) => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : Promise.resolve(i.getAsFile())));
              void (async () => {
                const got = (await Promise.all(pending)).filter((x): x is FileSystemFileHandle | File => !!x && (x instanceof File || x.kind === "file")) as (FileSystemFileHandle | File)[];
                const isVideo = (name: string, type: string) => type.startsWith("video/") || /\.(mp4|mov)$/i.test(name);
                const withNames = await Promise.all(got.map(async (h) => ({ h, f: h instanceof File ? h : await h.getFile() })));
                await addVideos(withNames.filter(({ f }) => isVideo(f.name, f.type)).map(({ h }) => h));
                await addMusic(withNames.filter(({ f }) => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|aac|flac|ogg)$/i.test(f.name)).map(({ h }) => h));
              })();
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
            {rendered && (
              <div className="absolute inset-0 z-20 flex flex-col bg-black" data-rendered-preview>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-black/70 px-3 py-1.5 text-[12px] text-white">
                  <span className="font-medium">Rendered preview</span>
                  <span className="text-white/70">
                    {rendered.width}×{rendered.height} · {fmtTime(rendered.from)}–{fmtTime(rendered.to)} · {rendered.proxies ? "from proxies" : "from the originals"} · {fmtBytes(rendered.bytes)} · {fmtDuration(rendered.ms)}
                  </span>
                  <span className="text-white/60">This is the export itself, small: transitions, looks, titles and steady lights as they will come out.</span>
                  <button type="button" onClick={() => setRendered(null)} className="ml-auto flex h-7 items-center gap-1 rounded-[var(--radius-sm)] bg-white/15 px-2.5 text-[12px] hover:bg-white/25" data-rendered-close>
                    <X size={12} /> Back to live preview
                  </button>
                </div>
                <video
                  ref={renderedVideoRef}
                  src={rendered.url}
                  controls
                  autoPlay
                  playsInline
                  className="min-h-0 flex-1 bg-black object-contain"
                  onTimeUpdate={(e) => {
                    if (!e.currentTarget.paused) setPlayhead(Math.min(duration, rendered.from + e.currentTarget.currentTime));
                  }}
                  data-rendered-video
                />
              </div>
            )}
            {(boost || skim || speed > 4) && (
              <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-[var(--radius-sm)] bg-black/60 px-2 py-1 text-[12px] text-white backdrop-blur-sm" data-preview-badge>
                {boost && <span data-boost>{rate}× while held{speed * 2 > MAX_PREVIEW_RATE ? ` · ${MAX_PREVIEW_RATE}× is the browser's ceiling` : ""}</span>}
                {skim && <span data-skim>skimming the cuts · {SKIM_S} s either side</span>}
                {!boost && !skim && speed > 4 && <span title="Browsers silence video above 4×, and the music preview stops too; export is unaffected">silent above 4×</span>}
              </div>
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
                <span className="text-[12px] text-white/60">
                  {rate}×{boost ? " held" : ""}
                  {skim ? " · skimming the cuts" : ""}
                  {loop ? " · loop" : ""}
                  {previewMuted ? " · muted" : ""}
                </span>
                <button type="button" onClick={() => setFsTimeline((v) => !v)} aria-pressed={fsTimeline} className={cn("h-8 rounded-[var(--radius-sm)] px-2.5 text-[12px]", fsTimeline ? "bg-white/25" : "bg-white/10 hover:bg-white/20")} title="Show or hide the timeline summary (T)">
                  Timeline
                </button>
                <button type="button" onClick={() => void saveFrame("thumb")} disabled={!!job} className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-white/10 px-2.5 text-[12px] hover:bg-white/20 disabled:opacity-50" title="Save this frame as a YouTube thumbnail JPEG (S); Shift+S full-size JPEG, Alt+S full-size PNG">
                  <Camera size={13} /> Save frame
                </button>
                <span className="ml-auto text-[12px] text-white/60">Space plays, hold for 2× · ←/→ step · T timeline · S saves a thumbnail · Esc leaves full screen</span>
              </div>
            )}
            {fullscreen && fsTimeline && project.clips.length > 0 && (
              <div className="absolute inset-x-0 bottom-16 px-4 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" data-fs-timeline>
                <div
                  className="relative h-16 cursor-pointer select-none overflow-hidden rounded-[var(--radius-sm)] bg-black/55 backdrop-blur-sm"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    stepTo(((e.clientX - r.left) / r.width) * duration);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title="Click to seek"
                >
                  {range && <div className="absolute inset-y-0 bg-accent/15" style={{ left: `${(range.from / duration) * 100}%`, width: `${((range.to - range.from) / duration) * 100}%` }} />}
                  {placed.map((c) => (
                    <div key={c.id} className="absolute top-1 h-5 truncate rounded-[3px] border-r border-black/40 bg-white/25 px-1 text-[10px] leading-5 text-white/90" style={{ left: `${(c.start / duration) * 100}%`, width: `${((c.end - c.start) / duration) * 100}%` }}>
                      {project.media[c.media]?.name}
                    </div>
                  ))}
                  {windows.map((w) => (
                    <div key={w.incoming.id} className="absolute top-1 h-5 bg-white/60" style={{ left: `${(w.start / duration) * 100}%`, width: `max(2px, ${((w.end - w.start) / duration) * 100}%)` }} />
                  ))}
                  {project.titles.map((t) => (
                    <div key={t.id} className="absolute h-2 truncate rounded-[2px] bg-[#e5484d]/80 px-0.5 text-[8px] leading-[8px] text-white" style={{ left: `${(t.start / duration) * 100}%`, width: `max(2px, ${(t.duration / duration) * 100}%)`, top: 28 + (titleLaneOf.lanes[t.id] ?? 0) * 9 }} title={t.text}>
                      {t.text}
                    </div>
                  ))}
                  {project.music.map((m) => (
                    <div key={m.id} className="absolute bottom-1 h-2 rounded-[2px]" style={{ left: `${(m.start / duration) * 100}%`, width: `max(2px, ${((effectiveMusicEnd(m, duration) - m.start) / duration) * 100}%)`, backgroundColor: LANE_COLORS[m.lane] + "cc", marginBottom: m.lane * 3 }} title={project.media[m.media]?.name} />
                  ))}
                  <div className="absolute inset-y-0 w-px bg-[#e5484d]" style={{ left: `${(Math.min(playhead, duration) / duration) * 100}%` }} />
                </div>
              </div>
            )}
            {under && !previewSrc && missingMedia.includes(under.clip.media) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13.5px] text-white/80">
                <AlertTriangle size={24} className="text-warn" />
                <span>Can&apos;t find {project.media[under.clip.media]?.name}</span>
                <button type="button" onClick={() => void relinkFiles()} className="rounded-[var(--radius-sm)] bg-white/15 px-3 py-1.5 text-[13px] hover:bg-white/25">
                  Locate the file…
                </button>
              </div>
            )}
            {!project.clips.length && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13.5px] text-white/80">
                <Clapperboard size={28} />
                <span className="text-[15px] font-medium">Drop your recordings here</span>
                <span className="max-w-sm text-[12.5px] text-white/60">Up to 8K at the original frame rate. Consecutive recordings from one camera are joined in order. Choose a project folder first so proxies and autosaves have somewhere to live.</span>
              </div>
            )}
          </div>
          {/* Transport: one fixed row (two on phones) whose members never come and go, so the timeline below never moves; transient state is a badge on the preview. */}
          <div className="mt-2 flex items-center gap-2 max-sm:flex-wrap" data-transport>
            <div className="flex items-center gap-0.5" role="group" aria-label="Transport">
              <button type="button" onClick={() => stepTo(0)} disabled={!project.clips.length} className={cn(GHOST, "h-8 px-1.5")} title="To the start (Home)" aria-label="To the start">
                <SkipBack size={13} />
              </button>
              <button type="button" {...stepBack} disabled={!project.clips.length} className={cn(GHOST, "h-8 px-1.5")} title="Back one frame (←, ⇧ for 1 s); hold to keep stepping" aria-label="Back one frame">
                <StepBack size={13} />
              </button>
              <button type="button" onClick={togglePlay} disabled={!project.clips.length} className={cn(PRIMARY, "h-8 px-3 text-[13px]")}>
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button type="button" {...stepForward} disabled={!project.clips.length} className={cn(GHOST, "h-8 px-1.5")} title="Forward one frame (→, ⇧ for 1 s); hold to keep stepping" aria-label="Forward one frame">
                <StepForward size={13} />
              </button>
              <button type="button" onClick={() => stepTo(duration)} disabled={!project.clips.length} className={cn(GHOST, "h-8 px-1.5")} title="To the end (End)" aria-label="To the end">
                <SkipForward size={13} />
              </button>
            </div>

            {timeEdit === null ? (
              <button type="button" onClick={() => setTimeEdit(fmtTime(playhead))} disabled={!project.clips.length} className="font-mono text-[13px] whitespace-nowrap text-ink tabular hover:text-accent" title="Click to type a time to go to" data-time>
                {fmtTime(playhead, first?.fps)} <span className="text-faint">/ {fmtTime(duration)}</span>
              </button>
            ) : (
              <input
                ref={(el) => el?.focus()}
                value={timeEdit}
                onChange={(e) => setTimeEdit(e.target.value)}
                onBlur={() => setTimeEdit(null)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    const t = parseTime(timeEdit);
                    if (Number.isFinite(t)) stepTo(t);
                    setTimeEdit(null);
                  } else if (e.key === "Escape") setTimeEdit(null);
                }}
                className={cn(INPUT, "h-8 w-28 font-mono text-[13px]")}
                aria-label="Go to time"
                placeholder="m:ss"
                data-time-edit
              />
            )}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Preview speed" title="Preview speed (export is unaffected). Hold Space to double it. Browsers silence the sound above 4× and cap playback at 16×.">
              {PREVIEW_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setLoop((l) => !l)} aria-pressed={loop} className={cn(GHOST, "h-8 px-2 text-[12px]", loop && "border-accent text-accent")} title={range ? "Loop the export range" : "Loop the whole timeline"} aria-label={range ? "Loop the export range" : "Loop the whole timeline"}>
              <Repeat size={13} />
            </button>
            <button type="button" onClick={() => setPreviewMuted((m) => !m)} aria-pressed={previewMuted} className={cn(GHOST, "h-8 px-2 text-[12px]", previewMuted && "border-accent text-accent")} title="Mute the preview (M) — export is unaffected" aria-label={previewMuted ? "Unmute preview" : "Mute preview"}>
              {previewMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={toggleFullscreen} disabled={!project.clips.length} className={cn(GHOST, "h-8 px-2 text-[12px]")} title="Watch the preview full screen (double-click the preview)" aria-label="Full screen">
              <Maximize2 size={13} />
            </button>
              <div
                className="relative flex"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFrameMenu(false);
                }}
            >
                <button type="button" onClick={() => void saveFrame("thumb")} disabled={!project.clips.length || !!job} className={cn(GHOST, "h-8 rounded-r-none text-[12px] whitespace-nowrap")} title={`Save this frame as a YouTube thumbnail: ${thumbSize} JPEG from the source, graded, through any transition, with titles — into the project's frames folder (S)`} data-save-frame>
                  <Camera size={12} /> Save frame
                </button>
                <button type="button" onClick={() => setFrameMenu((v) => !v)} disabled={!project.clips.length || !!job} aria-haspopup="menu" aria-expanded={frameMenu} aria-label="Other frame sizes" className={cn(GHOST, "h-8 rounded-l-none border-l-0 px-1")} data-save-frame-menu>
                  <ChevronDown size={12} />
                </button>
                {frameMenu && (
                  <div role="menu" className="panel absolute top-full right-0 z-20 mt-1 flex w-72 flex-col p-1 text-[12.5px] shadow-lg">
                    {(Object.keys(FRAME_KINDS) as FrameKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setFrameMenu(false);
                          void saveFrame(k);
                        }}
                        className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-raised"
                      >
                        <Camera size={13} className="mt-0.5 shrink-0 text-faint" />
                        <span>
                          <span className="text-ink">{FRAME_KINDS[k].label}</span>
                          <span className="block text-[11.5px] text-faint">
                            {k === "thumb" ? `${thumbSize} · ` : first?.width ? `${first.width}×${first.height} · ` : ""}
                            {FRAME_KINDS[k].note}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
            </div>
            </div>
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] sm:h-7 sm:flex-nowrap" data-clip-status>
            {under && (
              <span className="min-w-0 flex-1 truncate text-[12px] text-faint max-sm:basis-full">
                {project.media[under.clip.media]?.name} · {project.proxies[under.clip.media]?.ready ? `${project.preview.proxyHeight}p proxy` : project.preview.proxyHeight ? "full-res (no proxy yet)" : "full-res"}
              </span>
            )}
            {!under && <span className="min-w-0 flex-1 truncate text-[12px] text-faint max-sm:basis-full">{project.clips.length ? "Between clips" : "No recordings yet"}</span>}
            <button type="button" onClick={() => void renderPreview()} disabled={!placed.length || !!job} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Render the real export at a small size for 30 s around the playhead and play it here (settings in the Export tab)" data-render-preview>
              <Clapperboard size={12} /> Render preview
            </button>
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
                className={cn(SEL, "h-7 max-w-[12rem] text-[12px]")} aria-label="Proxy size"
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
          </div>
        </div>

        {/* The inspector never grows past the preview: it scrolls inside, so the timeline stays within reach. */}
        <div className="relative min-h-[360px]">
          <div className="panel flex min-w-0 flex-col max-lg:max-h-[60vh] lg:absolute lg:inset-0">
          <div role="tablist" aria-label="Inspector" className="flex shrink-0 overflow-x-auto border-b border-edge px-1 [scrollbar-width:none]">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="inspector-panel" onClick={() => setTab(id)} className={cn("-mb-px flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-b-2 px-1 text-[11px] leading-none whitespace-nowrap transition-colors", tab === id ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
                <Icon size={15} className={tab === id ? "text-accent" : undefined} />
                {label}
              </button>
            ))}
          </div>
          <div id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-[13px]">
            {tab === "trim" && (
              <>
                <p className="text-muted">{current ? `${project.media[current.media]?.name} · ${fmtTime(current.in)} → ${fmtTime(current.out)} (${fmtTime(current.out - current.in)})` : "Select a clip on the timeline, or move the playhead and use the buttons."}</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-trim-actions>
                  <button type="button" disabled={!under} onClick={() => under && setProject((p) => ({ ...p, clips: splitClip(p.clips, under.clip.id, playhead) }))} className={GHOST}>
                    <Scissors size={13} /> Split at playhead
                  </button>
                  <button
                    type="button"
                    disabled={!current || !mergeKind}
                    onClick={() => current && setProject((p) => ({ ...p, clips: mergeWithNext(p.clips, current.id) }))}
                    className={GHOST}
                    title={mergeKind === "merge" ? "The next clip is the rest of this recording: make them one clip again, with no cut" : mergeKind === "join" ? "Hide the cut to the next clip: no marker or transition, and it takes this clip's grade, crop and audio so the seam is invisible" : "Select a clip that has one after it"}
                    data-merge-next
                  >
                    {mergeKind === "join" ? "Join with next" : "Merge with next"}
                  </button>
                  {current?.joinedToPrevious && (
                    <button type="button" onClick={() => setProject((p) => ({ ...p, clips: unjoin(p.clips, current.id) }))} className={GHOST} title="Show the cut before this clip again" data-unjoin>
                      Unjoin from previous
                    </button>
                  )}
                  <button type="button" disabled={!under} onClick={() => under && update(under.clip.id, { in: under.sourceTime })} className={GHOST}>
                    Trim start to here
                  </button>
                  <button type="button" disabled={!under} onClick={() => under && update(under.clip.id, { out: under.sourceTime })} className={GHOST}>
                    Trim end to here
                  </button>
                  <button type="button" disabled={!current} onClick={() => current && setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== current.id) }))} className={cn(GHOST, "hover:border-danger hover:text-danger")}>
                    <Trash2 size={13} /> Delete clip
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === 0} onClick={() => current && setProject((p) => ({ ...p, clips: moveClip(p.clips, current.id, -1) }))} className={GHOST} title="Play this clip before the previous one">
                    ◀ Move earlier
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === placed.length - 1} onClick={() => current && setProject((p) => ({ ...p, clips: moveClip(p.clips, current.id, 1) }))} className={GHOST} title="Play this clip after the next one">
                    Move later ▶
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-edge p-2" data-speed-box>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    Speed
                    <select value={current ? clipSpeed(current) : 1} disabled={!current} onChange={(e) => current && update(current.id, { speed: Number(e.target.value) })} className={cn(SEL, "h-7 text-[12px]")} aria-label="Clip speed" title="Play this clip faster (time-lapse) or slower (slow motion); it gets shorter or longer on the timeline and the export follows">
                      {CLIP_SPEEDS.map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </label>
                  {current && clipSpeed(current) !== 1 && (
                    <span className="text-[12px] text-faint">
                      {fmtTime(current.out - current.in)} of footage plays in {fmtTime(clipLength(current))}
                      {clipSpeed(current) > MAX_AUDIBLE_SPEED || clipSpeed(current) < MIN_AUDIBLE_SPEED ? " · original sound off at this speed" : " · original sound follows (pitch shifts)"}
                    </span>
                  )}
                  <button type="button" disabled={!current || project.clips.length < 2} onClick={() => current && setProject((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, speed: clipSpeed(current) })) }))} className={cn(GHOST, "ml-auto h-7 text-[12px]")} title="Give every clip this clip's speed">
                    Apply speed to all
                  </button>
                </div>
                {currentRun.length > 1 && (
                  <p className="text-[12px] text-faint" data-run-note>
                    Part of a joined run of {currentRun.length} clips shown as one shot: grade, crop, audio and speed changes apply to all of them. Split or unjoin to break it up.
                  </p>
                )}
                <RangeCut duration={duration} onCut={(a, b) => setProject((p) => ({ ...p, clips: removeRange(p.clips, a, b) }))} />
                <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2" data-stops>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">Stops</span>
                    <span className="text-[12px] text-faint" data-stops-summary>
                      {project.stops ? (stops.length ? `${stops.length} found · ${fmtTime(stopsTotal(activeStops))} to cut` : "none found") : "not scanned yet"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                    Still for at least
                    <input type="number" min={0.5} step={0.5} value={stopMin} onChange={(e) => setStopSettings({ minSeconds: Math.max(0.5, Number(e.target.value) || 0.5) })} className={cn(INPUT, "w-16 font-mono")} aria-label="Minimum stop in seconds" />
                    s · keep
                    <input type="number" min={0} step={0.25} value={stopMargin} onChange={(e) => setStopSettings({ margin: Math.max(0, Number(e.target.value) || 0) })} className={cn(INPUT, "w-16 font-mono")} aria-label="Seconds kept at each end" />
                    s at each end
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => void scanStops()} disabled={!placed.length || !!job} className={GHOST} data-scan-stops>
                      <Search size={13} /> {project.stops ? "Scan again" : "Scan for stops"}
                    </button>
                    <button type="button" onClick={cutStops} disabled={!activeStops.length || !!job} className={cn(PRIMARY, "h-8 px-3 text-[13px]")} data-cut-stops>
                      <Scissors size={13} /> Cut out {activeStops.length || ""} {activeStops.length === 1 ? "stop" : "stops"}
                      {activeStops.length ? ` · −${fmtTime(stopsTotal(activeStops))}` : ""}
                    </button>
                    {project.stops && (
                      <button type="button" onClick={() => setProject((p) => ({ ...p, stops: null }))} disabled={!!job} className={GHOST} title="Drop the scan results">
                        Forget
                      </button>
                    )}
                  </div>
                  {stops.length > 0 && (
                    <ul className="max-h-44 space-y-0.5 overflow-y-auto text-[12.5px]" data-stop-list>
                      {stops.map((st, i) => {
                        const key = stopKey(st), skipped = isSkipped(key);
                        return (
                          <li key={key} className={cn("flex items-center gap-2", skipped && "opacity-50")} data-stop data-stop-from={st.stillFrom.toFixed(2)} data-stop-to={st.stillTo.toFixed(2)}>
                            <input type="checkbox" checked={!skipped} onChange={() => toggleStop(key)} aria-label={`Cut stop ${i + 1}`} className="accent-[var(--accent)]" />
                            <button type="button" onClick={() => stepTo(st.stillFrom)} className="font-mono text-ink tabular hover:text-accent" title="Jump to this stop">
                              {fmtTime(st.stillFrom)} → {fmtTime(st.stillTo)}
                            </button>
                            <span className="text-muted">{st.seconds.toFixed(1)} s still</span>
                            <span className="ml-auto font-mono text-faint tabular">−{(st.to - st.from).toFixed(1)} s</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-[12px] text-faint">Where the picture stands still — a paused talk, an idle camera, a red light — it barely changes from frame to frame, so every stretch stiller than the recording&apos;s own baseline counts. Scanning decodes the proxies when there are any and is many times faster with them; 8K originals take a while. The margin keeps the picture settling and moving again on either side of each cut.</p>
                </div>
                <div className={cn("space-y-2 rounded-[var(--radius-sm)] border p-2", selectedWindow ? "border-accent" : "border-edge")} data-transition-box>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-ink">{selectedWindow ? `Transition at ${fmtTime(selectedWindow.cut)}` : "Transitions"}</span>
                    <span className="text-faint">{visibleCuts(placed).length ? `${windows.length} of ${visibleCuts(placed).length} cut${visibleCuts(placed).length === 1 ? "" : "s"}` : "no cuts yet"}</span>
                  </div>
                  <select value={selectedWindow?.kind ?? project.transition.kind} onChange={(e) => changeTransition({ kind: e.target.value as TransitionKind })} className={SEL} aria-label="Transition">
                    {TRANSITIONS.map((t) => (
                      <option key={t.kind} value={t.kind}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] text-faint">{TRANSITIONS.find((t) => t.kind === (selectedWindow?.kind ?? project.transition.kind))?.hint}</p>
                  {selectedWindow?.note && (
                    <p className={cn("text-[12px]", selectedWindow.fit === "none" ? "text-danger" : "text-warn")} data-transition-note={selectedWindow.fit}>
                      {selectedWindow.note}
                    </p>
                  )}
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
            {tab === "intro" && (
              <>
                <div className="sticky top-0 z-10 -mx-3 -mt-3 flex flex-wrap items-center gap-1.5 bg-surface px-3 pt-3 pb-2">
                  <span className="order-last ml-auto flex items-center gap-1.5">
                    <button type="button" onClick={downloadTemplate} className={GHOST} title="One JSON for the intro and the titles, ready to hand to an LLM to fill in" data-template-download>
                      <Download size={12} /> Template JSON
                    </button>
                    <button type="button" onClick={() => templateJsonInput.current?.click()} className={GHOST} title="Load a filled template back in: intro and titles" data-template-import>
                      <Upload size={12} /> Import JSON
                    </button>
                  </span>
                  <button type="button" onClick={() => void makeIntro()} disabled={!placed.length || !!job} className={PRIMARY} data-make-intro>
                    <Sparkles size={14} /> {introReg ? "Make it again" : "Make an intro from this video"}
                  </button>
                  {introReg && (
                    <>
                      <button type="button" onClick={previewIntro} className={GHOST} data-preview-intro>
                        <Play size={12} /> Preview intro
                      </button>
                      <button type="button" onClick={() => applyIntro((p) => addSceneAt(p, playhead), "Move the playhead past the intro, into the main video, to lift a scene from there.")} className={GHOST} data-add-scene title="Lift a scene from the frame under the playhead">
                        + Use this moment
                      </button>
                      <button type="button" onClick={() => applyIntro((p) => removeIntro(p.clips))} className={cn(GHOST, "ml-auto hover:border-danger hover:text-danger")} data-remove-intro>
                        <Trash2 size={12} /> Remove intro
                      </button>
                    </>
                  )}
                </div>
                {!introReg && <p className="text-muted">A cold open: a few of the video’s liveliest moments cut together in a look, ending on a title card, before the video proper starts. One click builds a starter from the footage; then swap scenes, reorder them, retime them or change the look.</p>}
                <div className="grid grid-cols-2 gap-2 text-[12px] text-muted">
                  <label>
                    Scenes
                    <input type="number" min={2} max={20} step={1} value={introCount} onChange={(e) => setIntroCount(Math.max(2, Math.min(20, Math.round(Number(e.target.value) || 6))))} className={cn(INPUT, "mt-0.5 font-mono")} aria-label="Scenes" />
                  </label>
                  <label>
                    Seconds per scene
                    <input type="number" min={minSceneSeconds(introStyle(project.intro.style))} max={6} step={0.1} value={Number(sceneSecondsFor(project).toFixed(2))} onChange={(e) => setIntro({ sceneSeconds: Math.max(minSceneSeconds(introStyle(project.intro.style)), Math.min(6, Number(e.target.value) || 1)) })} className={cn(INPUT, "mt-0.5 font-mono")} aria-label="Seconds per scene" />
                  </label>
                  <label className="col-span-2 flex items-start gap-1.5">
                    <input type="checkbox" checked={introScan} onChange={(e) => setIntroScan(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                    <span>Look for lively moments (motion and contrast) rather than spacing the scenes evenly</span>
                  </label>
                  {introScan && scanPlan && <p className="col-span-2 text-faint">{scanPlan.hint}</p>}
                </div>
                <div>
                  <p className="mb-1 text-[12px] text-muted">Look</p>
                  <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Intro look">
                    {INTRO_STYLES.map((s) => (
                      <button key={s.id} type="button" role="radio" aria-checked={project.intro.style === s.id} onClick={() => setIntro({ style: s.id })} title={s.hint} className={cn("rounded-[var(--radius-sm)] border px-2 py-1 text-left", project.intro.style === s.id ? "border-accent bg-accent-soft text-ink" : "border-edge text-muted hover:border-accent")} data-intro-style={s.id}>
                        <span className="block text-[12.5px] font-medium">{s.name}</span>
                        <span className="block text-[11px] text-faint">{s.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {introReg && (
                  <>
                    <p className="text-[12px] text-faint" data-intro-summary>
                      {describeIntro(project)}. Titles and the export range moved with the main video; music stays where it is and plays under the intro.
                    </p>
                    <div className="space-y-1" data-intro-scenes>
                      {[...introReg.scenes, ...(introReg.card ? [introReg.card] : [])].map((c, i) => {
                        const isCard = c.introRole === "card";
                        const thumb = thumbs.get(c.id);
                        return (
                          <div key={c.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-edge p-1" data-intro-scene={isCard ? "card" : i}>
                            <button
                              type="button"
                              onClick={() => {
                                setPlayhead(c.start + Math.min(0.3, (c.end - c.start) / 2));
                                setSeekToken((x) => x + 1);
                              }}
                              className="shrink-0 overflow-hidden rounded-[3px] bg-black"
                              style={{ width: 96, height: 54 }}
                              title="Show it in the preview"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived object URL, not an asset */}
                              {thumb ? <img src={thumb} alt="" width={96} height={54} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[10px] text-white/50">…</span>}
                            </button>
                            <div className="min-w-0 flex-1 text-[12px]">
                              <div className="truncate text-ink">
                                {isCard ? "Title card" : `Scene ${i + 1}`} <span className="text-faint">· {project.media[c.media]?.name} at {fmtTime(c.in)}</span>
                              </div>
                              <label className="flex items-center gap-1 text-muted">
                                <input type="number" min={0.3} max={isCard ? 10 : 6} step={0.1} value={Number((c.end - c.start).toFixed(2))} onChange={(e) => applyIntro((p) => setSceneSeconds(p, c.id, Number(e.target.value) || 1))} className={cn(INPUT, "h-6 w-16 font-mono text-[11.5px]")} aria-label={isCard ? "Card seconds" : `Scene ${i + 1} seconds`} /> s{clipSpeed(c) !== 1 && <span className="text-faint">· {clipSpeed(c)}×</span>}
                              </label>
                            </div>
                            {!isCard && (
                              <>
                                <button type="button" onClick={() => applyIntro((p) => moveScene(p, c.id, -1))} disabled={i === 0} className="text-faint hover:text-ink disabled:opacity-30" aria-label="Move earlier">
                                  <ChevronUp size={14} />
                                </button>
                                <button type="button" onClick={() => applyIntro((p) => moveScene(p, c.id, 1))} disabled={i === introReg.scenes.length - 1} className="text-faint hover:text-ink disabled:opacity-30" aria-label="Move later">
                                  <ChevronDown size={14} />
                                </button>
                              </>
                            )}
                            <button type="button" onClick={() => (isCard ? setIntro({ card: { ...project.intro.card, seconds: 0 } }) : applyIntro((p) => removeScene(p, c.id)))} className="text-faint hover:text-danger" aria-label={isCard ? "Remove the title card" : `Remove scene ${i + 1}`}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2 text-[12px] text-muted" data-intro-card>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">Title card</span>
                        <label className="flex items-center gap-1">
                          <input type="number" min={0} max={10} step={0.5} value={project.intro.card.seconds} onChange={(e) => setIntro({ card: { ...project.intro.card, seconds: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })} className={cn(INPUT, "h-6 w-16 font-mono")} aria-label="Card seconds" /> s (0 for none)
                        </label>
                      </div>
                      <input value={project.intro.card.text} onChange={(e) => setIntro({ card: { ...project.intro.card, text: e.target.value } })} placeholder={project.name} className={INPUT} aria-label="Card title" />
                      <input value={project.intro.card.subtitle} onChange={(e) => setIntro({ card: { ...project.intro.card, subtitle: e.target.value } })} placeholder="Subtitle (optional): a place, a date" className={INPUT} aria-label="Card subtitle" />
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={project.intro.keepAudio} onChange={(e) => setIntro({ keepAudio: e.target.checked })} className="accent-[var(--accent)]" /> keep the scenes’ own sound (otherwise they play quiet under the music)
                      </label>
                    </div>
                  </>
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
            ) : <p className="text-muted">Select a clip to grade it. Apply the LUT once, then copy the look to every clip so the whole edit matches.</p>)}
            {tab === "audio" && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input ref={musicInput} type="file" accept="audio/*" multiple hidden onChange={(e) => e.target.files && void addMusic(Array.from(e.target.files))} />
                  <button type="button" onClick={() => void pickFiles("audio")} className={GHOST} title="Add one song or many at once">
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
                <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2" data-music-fill>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">Fill the video with music</span>
                    <span className="text-[12px] text-faint" data-music-fill-summary>
                      {songCount ? `${songCount} song${songCount === 1 ? "" : "s"}` : "no songs yet"} · video {fmtTime(duration)}
                    </span>
                    <label className="ml-auto flex items-center gap-1 text-[12px] text-muted">
                      crossfade
                      <input type="number" min={0} max={10} step={0.5} value={fillOverlap} onChange={(e) => setFillOverlap(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} className={cn(INPUT, "w-14 font-mono")} aria-label="Crossfade seconds" />
                      s
                    </label>
                  </div>
                  <button type="button" onClick={fillMusic} disabled={!songCount || !duration} className={cn(PRIMARY, "h-8 px-3 text-[13px]")} data-fill-music>
                    <Shuffle size={13} /> {project.music.length > songCount ? "Shuffle again" : "Shuffle & fill the video"}
                  </button>
                  <p className="text-[12px] text-faint">Add as many songs as you like, then shuffle: they are laid end to end in a random order from the start of the video to its end, crossfading between them; when the songs run out before the video does, a fresh shuffle follows (never the same song twice in a row). The last one fades out at the end. This replaces the music lanes; undo brings them back.</p>
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
                      <span className="text-[12px] text-faint">New clips start at {DEFAULT_CLIP_GAIN_DB} dB so the original sound sits under the music.</span>
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
                      <p className="text-[12px] text-warn" data-music-unused-note>
                        {currentMusic.start >= duration
                          ? "Starts after the video ends, so none of it is heard — move it earlier."
                          : `Runs ${fmtTime(musicUnused(currentMusic, duration))} past the end of the video: that part is not used, and the track fades out over ${currentMusic.fadeOut || 1} s before ${fmtTime(duration)}.`}
                      </p>
                    )}
                    {describeWhere(project, project.media[currentMusic.media]) && (
                      <p className="text-[12px] text-faint" data-music-where>
                        File: {describeWhere(project, project.media[currentMusic.media])}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[12.5px] text-muted">
                        Starts at (s)
                        <input type="number" step={0.1} min={0} max={Math.max(0, duration - 1).toFixed(1)} value={currentMusic.start} onChange={(e) => updateMusic(currentMusic.id, { start: clampMusicStart(Number(e.target.value) || 0, currentMusic, duration) })} className={cn(INPUT, "mt-1 font-mono")} aria-label="Music starts at" title="Music must begin inside the video" />
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
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={downloadTemplate} className={GHOST} title="One JSON for the intro and the titles, with this timeline and every property, ready to hand to ChatGPT or another LLM to fill in" data-template-download>
                      <Download size={12} /> Template JSON
                    </button>
                    <button type="button" onClick={() => templateJsonInput.current?.click()} className={GHOST} title="Load a filled template back in: titles and intro" data-template-import>
                      <Upload size={12} /> Import JSON
                    </button>
                    {project.titles.length > 0 && (
                      <label className="flex items-center gap-1 text-[12px] text-muted" title="Otherwise imported titles are added to the current ones">
                        <input type="checkbox" checked={importReplace} onChange={(e) => setImportReplace(e.target.checked)} className="accent-[var(--accent)]" /> replace current
                      </label>
                    )}
                  </span>
                </div>
                <p className="text-[12px] text-faint">Download the template (one file for the intro and the titles), give it to an LLM with your notes (places, people, dates), then import the JSON it returns: every title with its timing, position, colours, font and size arrives populated.</p>
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
                        <select
                          value={t.font in TITLE_FONTS || TITLE_FAMILIES.includes(t.font) || localFonts?.includes(t.font) ? t.font : "__other"}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__installed") return void listLocalFonts();
                            patchTitle(t.id, { font: v === "__other" ? "" : v });
                          }}
                          className={cn(SEL, "h-6 max-w-[160px] text-[12px]")}
                          aria-label="Font"
                        >
                          <optgroup label="Presets">
                            {(Object.keys(TITLE_FONTS) as TitleFont[]).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Common families">
                            {TITLE_FAMILIES.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </optgroup>
                          {localFonts ? (
                            <optgroup label={`Installed (${localFonts.length})`}>
                              {localFonts.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </optgroup>
                          ) : (
                            <option value="__installed">Installed fonts…</option>
                          )}
                          <option value="__other">Other family…</option>
                        </select>
                        {!(t.font in TITLE_FONTS || TITLE_FAMILIES.includes(t.font) || localFonts?.includes(t.font)) && <input value={t.font} onChange={(e) => patchTitle(t.id, { font: e.target.value })} placeholder="Family name" className={cn(INPUT, "h-6 w-32 text-[12px]")} aria-label="Font family name" style={{ fontFamily: t.font ? `"${t.font}"` : undefined }} />}
                      </label>
                      <label className="flex min-w-[140px] flex-1 items-center gap-1">
                        Size
                        <input type="range" min={0.02} max={0.16} step={0.005} value={t.size} onChange={(e) => patchTitle(t.id, { size: Number(e.target.value) })} className={RANGE} aria-label="Text size" />
                        <span className="font-mono tabular">{Math.round(t.size * 100)}%</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted" data-style-row>
                      <label className="flex items-center gap-1">
                        Weight
                        <select value={t.weight} onChange={(e) => patchTitle(t.id, { weight: Number(e.target.value) })} className={cn(SEL, "h-6 text-[12px]")} aria-label="Weight">
                          {TITLE_WEIGHTS.map((w) => (
                            <option key={w} value={w}>
                              {w === 300 ? "Light" : w === 400 ? "Regular" : w === 500 ? "Medium" : w === 600 ? "Semibold" : w === 700 ? "Bold" : "Black"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={t.italic} onChange={(e) => patchTitle(t.id, { italic: e.target.checked })} className="accent-[var(--accent)]" aria-label="Italic" /> italic
                      </label>
                      <label className="flex min-w-[120px] items-center gap-1">
                        Spacing
                        <input type="range" min={-0.05} max={0.3} step={0.01} value={t.letterSpacing} onChange={(e) => patchTitle(t.id, { letterSpacing: Number(e.target.value) })} className={RANGE} aria-label="Letter spacing" />
                        <span className="font-mono tabular">{t.letterSpacing.toFixed(2)}em</span>
                      </label>
                      <label className="flex items-center gap-1">
                        Shadow
                        <select value={t.shadow} onChange={(e) => patchTitle(t.id, { shadow: e.target.value as TitleShadow })} className={cn(SEL, "h-6 text-[12px]")} aria-label="Shadow">
                          {TITLE_SHADOWS.map((sh) => (
                            <option key={sh} value={sh}>
                              {sh}
                            </option>
                          ))}
                        </select>
                        {t.shadow !== "none" && <input type="color" value={toHex(t.shadowColor) === "#ffffff" && !/^#/.test(t.shadowColor) ? "#000000" : toHex(t.shadowColor)} onChange={(e) => patchTitle(t.id, { shadowColor: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-edge bg-base p-0" aria-label="Shadow colour" />}
                      </label>
                      <label className="flex items-center gap-1">
                        Align
                        <select value={t.align} onChange={(e) => patchTitle(t.id, { align: e.target.value as TitleAlign })} className={cn(SEL, "h-6 text-[12px]")} aria-label="Align">
                          {TITLE_ALIGNS.map((al) => (
                            <option key={al} value={al}>
                              {al}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted" data-box-row>
                      <span className="text-faint">Box</span>
                      <label className="flex min-w-[120px] items-center gap-1">
                        Padding
                        <input type="range" min={0} max={1.5} step={0.05} value={t.padding} onChange={(e) => patchTitle(t.id, { padding: Number(e.target.value) })} className={RANGE} aria-label="Box padding" />
                        <span className="font-mono tabular">{t.padding.toFixed(2)}</span>
                      </label>
                      <label className="flex min-w-[110px] items-center gap-1">
                        Corners
                        <input type="range" min={0} max={1} step={0.05} value={t.radius} onChange={(e) => patchTitle(t.id, { radius: Number(e.target.value) })} className={RANGE} aria-label="Corner radius" />
                        <span className="font-mono tabular">{t.radius.toFixed(2)}</span>
                      </label>
                      <label className="flex min-w-[110px] items-center gap-1">
                        Border
                        <input type="range" min={0} max={0.3} step={0.01} value={t.borderWidth} onChange={(e) => patchTitle(t.id, { borderWidth: Number(e.target.value) })} className={RANGE} aria-label="Border width" />
                        <span className="font-mono tabular">{t.borderWidth.toFixed(2)}</span>
                      </label>
                      {t.borderWidth > 0 && <input type="color" value={toHex(t.borderColor)} onChange={(e) => patchTitle(t.id, { borderColor: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-edge bg-base p-0" aria-label="Border colour" />}
                      <span className="text-faint">× text size; the border draws even without a background</span>
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
                  <p className="text-[12px] text-faint">Export just a part of the timeline — to check a grade quickly, or to cut one section for a short.</p>
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
                    <select value={String(project.export.resolution)} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, resolution: e.target.value === "source" ? "source" : Number(e.target.value) } }))} className={cn(SEL, "mt-1 w-full")}>
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
                <label className="flex flex-wrap items-center gap-1.5 text-muted">
                  LED flicker
                  <select value={project.export.steadyLights ?? "off"} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, steadyLights: e.target.value as SteadyLights } }))} className={SEL} aria-label="LED flicker">
                    <option value="off">Leave as recorded</option>
                    <option value="light">Steady lights — hold each light over 2 frames</option>
                    <option value="strong">Steady lights — hold each light over 3 frames</option>
                  </select>
                </label>
                <label className="flex flex-wrap items-center gap-1.5 text-muted" data-notify-setting>
                  <input type="checkbox" checked={notify} onChange={(e) => setNotifySetting(e.target.checked)} className="accent-[var(--accent)]" />
                  Notify about progress while this tab is hidden, and when an export finishes
                  {notifyPermission === "denied" && <span className="text-warn">— blocked in the browser; allow notifications for this site to get them</span>}
                  {notifyPermission === "unsupported" && <span className="text-faint">— not available in this browser</span>}
                </label>
                <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2" data-preview-render>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">Rendered preview</span>
                    <span className="text-[12px] text-faint">the export itself, small, played in the preview box</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
                    <label className="flex items-center gap-1.5">
                      Size
                      <select value={previewOpts.height} onChange={(e) => setPreviewOpts((o) => ({ ...o, height: Number(e.target.value) }))} className={SEL} aria-label="Rendered preview size">
                        {[180, 240, 360, 540, 720].map((h) => (
                          <option key={h} value={h}>
                            {h}p
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">
                      Stretch
                      <select value={previewOpts.scope} onChange={(e) => setPreviewOpts((o) => ({ ...o, scope: e.target.value as typeof previewOpts.scope }))} className={SEL} aria-label="Rendered preview stretch">
                        <option value="around">30 s around the playhead</option>
                        <option value="intro" disabled={!introReg}>The intro</option>
                        <option value="range" disabled={!range}>The export range</option>
                        <option value="all">The whole timeline</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5" title="Proxies decode many times faster; the originals show the true detail">
                      <input type="checkbox" checked={previewOpts.proxies} onChange={(e) => setPreviewOpts((o) => ({ ...o, proxies: e.target.checked }))} className="accent-[var(--accent)]" /> from proxies when there are any
                    </label>
                  </div>
                  <button type="button" onClick={() => void renderPreview()} disabled={!placed.length || !!job} className={GHOST} data-preview-render-button>
                    <Clapperboard size={13} /> Render preview
                  </button>
                  <p className="text-[12px] text-faint">Runs the real export — the same spans, grades, transitions, intro effects, titles and steady lights — at {previewOpts.height}p into the browser&apos;s private storage, then plays it in the preview box so you can check cuts frame by frame before the full export. The live preview is close, but this is exact.</p>
                </div>
                <p className="text-[12px] text-faint">LED lights — signs, displays, traffic and vehicle lights — pulse faster than the shutter and blink on camera. Steady lights keeps every bright or strongly coloured light at its brightest over the last two or three frames, so a light that drops out for a frame or two stays lit; the preview shows it while playing. Fast-moving lights at night can leave a short trail — prefer the 2-frame setting if they do.</p>
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
                    <span title="Chrome reads the whole file back to check it before moving it into place, so closing a big export takes a while; the export panel learns the real speed from your first export">
                      of which ≈ <span className="font-mono text-ink">{fmtTime(estimate.finishSeconds)}</span> closing the file
                    </span>
                  </div>
                  {spans.some((s) => s.kind === "encode") && <p className="mt-1 text-faint">Re-encoding because: {[...new Set(spans.flatMap((s) => s.reasons))].join(", ") || "titles"}.</p>}
                </div>
                <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2 text-[12.5px]" data-export-tags>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">File tags</span>
                    <select value={project.export.tags.kind} onChange={(e) => setTags({ kind: e.target.value as ExportTags["kind"] })} className={SEL} aria-label="Media kind">
                      <option value="music-video">Music video</option>
                      <option value="video">Plain video</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="col-span-2 text-muted">
                      Title
                      <input value={project.export.tags.title} onChange={(e) => setTags({ title: e.target.value })} placeholder={project.name} className={cn(INPUT, "mt-0.5")} aria-label="Tag title" />
                    </label>
                    <label className="text-muted">
                      Artist
                      <input value={project.export.tags.artist} onChange={(e) => setTags({ artist: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag artist" />
                    </label>
                    <label className="text-muted">
                      Album
                      <input value={project.export.tags.album} onChange={(e) => setTags({ album: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag album" />
                    </label>
                    <label className="text-muted">
                      Genre
                      <input value={project.export.tags.genre} onChange={(e) => setTags({ genre: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag genre" />
                    </label>
                    <label className="text-muted">
                      Year
                      <input value={project.export.tags.year} onChange={(e) => setTags({ year: e.target.value })} placeholder={String(new Date().getFullYear())} inputMode="numeric" className={cn(INPUT, "mt-0.5 font-mono")} aria-label="Tag year" />
                    </label>
                    <label className="col-span-2 text-muted">
                      Comment
                      <input value={project.export.tags.comment} onChange={(e) => setTags({ comment: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag comment" />
                    </label>
                  </div>
                  <p className="text-[12px] text-faint">
                    Written into the MP4 as the iTunes-style atoms ffmpeg writes from <span className="font-mono">-metadata</span> — title, artist, album, genre, year, comment, encoder — and, for a music video, the media kind ffmpeg sets with <span className="font-mono">media_type=6</span>. YouTube takes the title from the file; the Music category and the song credits are set on the upload page, and that is what YouTube Music lists by. To tag a file you already have, use the{" "}
                    <Link href="/media/mp4-tags" className="text-accent underline-offset-2 hover:underline">
                      MP4 tag editor
                    </Link>
                    .
                  </p>
                </div>
                <button type="button" onClick={() => void runExport()} disabled={!project.clips.length || !!job} className={PRIMARY}>
                  <Download size={14} /> Export to project folder
                </button>
                <p className="text-[12px] text-faint">The file is ready for YouTube or anywhere else: HEVC in MP4 at 80–160 Mbps is what YouTube recommends for 8K. You can switch tabs or minimise the window while it runs: the page holds a lock so the browser does not freeze it, keeps the display awake while it is visible, and the tab title carries the progress.</p>
              </>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div className="panel select-none p-2" data-timeline>
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="readout">Timeline</span>
          <span className="text-[11.5px] text-faint tabular">{placed.length ? `${placed.length} clip${placed.length === 1 ? "" : "s"} · ${fmtTime(duration)}` : "empty"}</span>
          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
            Zoom
            <input type="range" min={1} max={ZOOM_MAX} step={1} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} className={cn(RANGE, "w-28 max-sm:w-16")} aria-label="Timeline zoom" title="Zoom (⌘/Ctrl + wheel over the timeline zooms around the pointer)" />
          </label>
          <button type="button" onClick={() => zoomTo(1)} disabled={zoom === 1} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Fit the whole timeline in view">
            Fit
          </button>
          <button type="button" onClick={() => setShortcutsOpen(true)} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Every keyboard shortcut (?)" aria-label="Keyboard shortcuts" data-shortcuts>
            <Keyboard size={13} /> <span className="max-sm:hidden">Shortcuts</span>
          </button>
        </div>
        <div className="flex">
          <div className="w-14 shrink-0 pr-1.5 text-right text-[10.5px] leading-none text-faint select-none" aria-hidden>
            <div className="h-5" />
            <div className="mt-1 flex h-12 items-center justify-end">Video</div>
            <div className="mt-1 flex items-center justify-end" style={{ height: Math.max(0, titleLaneOf.count * 22 - 2) }}>Titles</div>
            {[0, 1, 2].map((lane) => (
              <div key={lane} className="mt-1 flex h-7 items-center justify-end">Music {lane + 1}</div>
            ))}
          </div>
        <div ref={timelineRef} className="relative min-w-0 flex-1 overflow-x-auto" onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerCancel={onTimelinePointerUp} onPointerLeave={onTimelinePointerLeave} data-timeline-scroll>
          <div className="relative" style={{ width: Math.max(100, Math.max(duration, musicFarEnd) * pxPerSec + 40), minHeight: 150 }}>
            {/* ruler */}
            <div className="h-5 cursor-ew-resize border-b border-edge text-[10px] text-faint" data-ruler title="Click or drag to scrub; snaps to cuts (hold ⌥ to scrub freely)">
              {Array.from({ length: Math.ceil(duration / rulerStep(duration, zoom)) + 1 }, (_, i) => i * rulerStep(duration, zoom)).map((t) => (
                <span key={t} className="absolute top-0" style={{ left: t * pxPerSec }}>
                  {fmtTime(t)}
                </span>
              ))}
            </div>
            {/* video lane */}
            <div className="relative mt-1 h-12">
              {placed.map((c, i) => {
                // Joined clips draw as one continuous bar: no edge or gap at the hidden cut, and only the first carries a label.
                const { joinsNext, runCount, runEnd } = runInfo[i];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      beginClipDrag(e, c);
                    }}
                    onPointerMove={moveClipDrag}
                    onPointerUp={endClipDrag}
                    onPointerCancel={endClipDrag}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setSelected(c.id);
                      setSelectedMusic(null);
                      setSelectedTransition(null);
                      setPlayhead(c.start);
                      setSeekToken((t) => t + 1);
                    }}
                    className={cn("absolute top-0 h-full overflow-hidden border text-left text-[11.5px]", c.joinedToPrevious ? "rounded-l-none border-l-0 pl-0" : "rounded-l-[var(--radius-sm)] pl-2", joinsNext ? "rounded-r-none border-r-0 pr-0" : "rounded-r-[var(--radius-sm)] pr-2", selectedRun.has(c.id) ? "border-accent bg-accent-soft text-ink" : c.introRole && introReg && i <= introReg.scenes.length ? "border-[#d9a400]/60 bg-[#d9a400]/15 text-muted" : "border-edge bg-raised text-muted")}
                    style={{ left: c.start * pxPerSec, width: Math.max(4, (c.end - c.start) * pxPerSec - (joinsNext ? 0 : 1)) }}
                    title={`${c.introRole === "card" ? "Intro title card · " : c.introRole ? "Intro scene · " : ""}${project.media[c.media]?.name} ${fmtTime(c.in)}–${fmtTime(c.out)}${c.joinedToPrevious ? " · joined to the previous clip" : ""}${describeWhere(project, project.media[c.media]) ? ` · ${describeWhere(project, project.media[c.media])}` : ""}${c.introRole ? "" : " · drag to move it"}`}
                    data-clip={c.id}
                    data-joined={c.joinedToPrevious ? "true" : undefined}
                    data-intro-clip={c.introRole}
                  >
                    {!c.joinedToPrevious && (
                      <>
                        <span className="block truncate font-medium">
                          {c.introRole === "card" ? "Title card" : c.introRole ? `Intro ${introReg ? introReg.scenes.findIndex((s) => s.id === c.id) + 1 : ""}` : project.media[c.media]?.name}
                          {runCount > 1 ? ` +${runCount - 1}` : ""}
                        </span>
                        <span className="block truncate text-faint">
                          {clipSpeed(c) !== 1 ? `${clipSpeed(c)}× · ` : ""}
                          {c.grade.lut !== "none" || c.grade.exposure || c.grade.saturation !== 1 ? "graded · " : ""}
                          {c.transform.rotate || c.transform.straighten || c.transform.crop.w !== 1 || c.transform.crop.h !== 1 ? "cropped · " : ""}
                          {runCount > 1 ? `${runCount} joined · ${fmtTime(runEnd - c.start)}` : fmtTime(c.end - c.start)}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
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
                  title={`${TRANSITIONS.find((t) => t.kind === w.kind)?.name} · ${(w.end - w.start).toFixed(2)} s${w.note ? ` — ${w.note}` : ""} — click to change or remove`}
                  aria-label={`Transition at ${fmtTime(w.cut)}`}
                  data-transition
                >
                  ⋈
                </button>
              ))}
              {activeStops.map((st) => (
                <button
                  key={stopKey(st)}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setTab("trim");
                    stepTo(st.stillFrom);
                  }}
                  className="absolute top-0 h-full border-x border-[#e5484d]/70 bg-[repeating-linear-gradient(135deg,rgba(229,72,77,0.35)_0_4px,transparent_4px_8px)] hover:bg-[#e5484d]/25"
                  style={{ left: st.from * pxPerSec, width: Math.max(3, (st.to - st.from) * pxPerSec) }}
                  title={`Stop: still for ${st.seconds.toFixed(1)} s — Cut out in Trim removes this part`}
                  aria-label={`Stop at ${fmtTime(st.stillFrom)}`}
                  data-stop-band
                />
              ))}
            </div>
            {/* title lanes: overlapping titles stack */}
            <div className="relative mt-1" style={{ height: Math.max(0, titleLaneOf.count * 22 - 2) }}>
              {!project.titles.length && project.clips.length > 0 && <div className="pointer-events-none absolute inset-0 rounded-[3px] border border-dashed border-edge px-2 text-[10.5px] leading-5 text-faint">Titles and lower thirds from the Titles tab land here</div>}
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
                {lane === 0 && !project.music.length && project.clips.length > 0 && <div className="pointer-events-none absolute inset-0 rounded-[3px] border border-dashed border-edge px-2 text-[10.5px] leading-7 text-faint">Drop music onto the preview, or add it from the Audio tab</div>}
                {project.music.filter((m) => m.lane === lane).map((m) => (
                  <Fragment key={m.id}>
                  <button
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
                    {musicUnused(m, duration) > 0 && m.start < duration ? " · cut at the end" : ""}
                  </button>
                  {musicUnused(m, duration) > 0 && (
                    <div
                      className="pointer-events-none absolute top-0 h-full truncate rounded-r-[3px] border border-l-0 border-dashed border-edge bg-[repeating-linear-gradient(135deg,rgba(128,128,128,0.28)_0_4px,transparent_4px_8px)] px-1.5 text-[10.5px] leading-7 text-faint"
                      style={{ left: Math.max(m.start, effectiveMusicEnd(m, duration)) * pxPerSec, width: Math.max(4, musicUnused(m, duration) * pxPerSec) }}
                      title={`${fmtTime(musicUnused(m, duration))} of ${project.media[m.media]?.name} runs past the end of the video and is not used`}
                      data-music-unused={m.id}
                    >
                      {m.start >= duration ? "not used — starts after the video ends" : `not used · ${fmtTime(musicUnused(m, duration))} past the end`}
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
            ))}
            {musicFarEnd > duration + 0.01 && (
              <div className="pointer-events-none absolute top-5 bottom-0 border-l border-dashed border-edge bg-ink/[0.04]" style={{ left: duration * pxPerSec, width: (musicFarEnd - duration) * pxPerSec + 40 }} data-beyond-video>
                <span className="absolute top-0.5 left-1.5 whitespace-nowrap text-[10px] text-faint">end of video — nothing past here is used</span>
              </div>
            )}
            {/* hover time, drop target, playhead */}
            <div ref={hoverLineRef} className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-ink/30" style={{ display: "none" }} data-hover-line>
              <span ref={hoverLabelRef} className="absolute top-0 left-1 rounded-[3px] bg-black/75 px-1 font-mono text-[10px] leading-4 text-white tabular" />
            </div>
            <div ref={dropLineRef} className="pointer-events-none absolute top-5 z-10 h-14 w-0.5 bg-accent" style={{ display: "none" }} data-drop-line />
            <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#e5484d]" style={{ left: playhead * pxPerSec }} />
            <div className="pointer-events-none absolute top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#e5484d]" style={{ left: playhead * pxPerSec - 5 }} data-playhead-handle />
          </div>
        </div>
        </div>
        <p className="mt-1.5 text-[11.5px] text-faint">
          Click the ruler to seek · Space plays, hold it for double speed · hold Control to skim the cuts · <kbd className="rounded border border-edge px-1 font-mono">?</kbd> lists every shortcut.
        </p>
      </div>
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" data-shortcuts-dialog>
          <div className="absolute inset-0 bg-scrim" onClick={() => setShortcutsOpen(false)} />
          <div className="panel relative w-full max-w-2xl p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="shortcuts-title" className="text-[15px] font-semibold text-ink">
                Keyboard shortcuts
              </h2>
              <button type="button" onClick={() => setShortcutsOpen(false)} className={cn(GHOST, "h-7 px-2 text-[12px]")}>
                Close (Esc)
              </button>
            </div>
            <div className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline justify-between gap-3 border-b border-edge/60 py-1">
                  <span className="text-muted">{what}</span>
                  <kbd className="shrink-0 rounded border border-edge bg-base px-1.5 font-mono text-[12px] text-ink">{keys}</kbd>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-faint">Also: click the ruler to seek, double-click the preview for full screen, drop recordings or music onto the preview, and click a cut&apos;s marker on the timeline to change or remove its transition.</p>
          </div>
        </div>
      )}
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

function Stat({ label, value, mono = true, title }: { label: string; value: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={cn("truncate text-[13.5px] text-ink", mono && "font-mono tabular")}>{value}</div>
    </div>
  );
}

const PHASE_LABEL: Record<ExportProgress["phase"], string> = { prepare: "Preparing", video: "Rendering video", audio: "Mixing audio", finalize: "Finishing the file", done: "Done" };
const SOURCE_LABEL: Record<EstimateSource, string> = { default: "default guess", learned: "from your last export", measured: "measured", actual: "actual" };

/** The export in full: what is being written, where it is, how fast, how long is left, and every step with its estimate. */
function ExportPanel({ job, onPause, onResume, onCancel }: { job: Job; onPause: () => void; onResume: () => void; onCancel: () => void }) {
  const [showSteps, setShowSteps] = useState(true);
  const p = job.progress;
  const out = job.output;
  const pct = ((p?.fraction ?? 0) * 100).toFixed(3);
  const running = p?.steps.find((s) => s.status === "running");
  const phaseLabel = !p ? "Starting…" : p.phase === "video" && p.span?.kind === "copy" ? "Copying video" : PHASE_LABEL[p.phase] + (running?.stage ? ` — ${running.stage}` : "");
  // Start + worked + paused + remaining, all from the snapshot: no clock reads while rendering.
  const finishAt = p ? new Date(p.startedAt + p.elapsedMs + p.pausedMs + p.etaMs).toLocaleTimeString() : "—";
  const steps = p?.steps ?? [];
  const doneSteps = steps.filter((s) => s.status === "done").length;
  const unfinished = steps.filter((s) => s.status !== "done");
  const bySource = (src: EstimateSource) => unfinished.filter((s) => s.source === src).length;
  const basisSummary = !p ? "starting…" : unfinished.length ? [bySource("measured") ? `${bySource("measured")} measured` : "", bySource("learned") ? `${bySource("learned")} from your last export` : "", bySource("default") ? `${bySource("default")} default guess${bySource("default") === 1 ? "" : "es"}` : ""].filter(Boolean).join(", ") : "all done";
  // Tick marks where each step is expected to hand over to the next, by estimated time.
  const ticks: { at: number; title: string }[] = [];
  if (p && p.totalEstimateMs > 0) {
    let acc = 0;
    for (const s of steps.slice(0, -1)) {
      acc += s.estimateMs;
      ticks.push({ at: acc / p.totalEstimateMs, title: `${s.title} → next` });
    }
  }
  return (
    <div className={cn("panel space-y-3 border-2 p-4", job.lowSpace ? "border-danger" : job.paused ? "border-warn" : "border-accent")} data-export-panel aria-live="polite">
      {job.lowSpace && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-danger/50 bg-danger/10 px-3 py-2 text-[13px]" role="alert" data-low-space>
          <AlertTriangle size={15} className="shrink-0 text-danger" />
          <span>
            <span className="font-medium text-ink">Paused: the disk is almost full</span>
            {job.freeBytes != null ? ` — ${fmtBytes(job.freeBytes)} free as the browser reports it.` : "."} Free at least {fmtBytes(ENOUGH_SPACE)} and it continues on its own, or press Resume to try now. Nothing written so far is lost.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {job.paused ? <Pause size={18} className="text-warn" /> : <Loader size={18} className="animate-spin text-accent" />}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink">
            {job.paused ? `${job.label} — paused` : job.label} · {out?.name}
          </div>
          <div className="text-[12.5px] text-muted">
            {phaseLabel}
            {p?.span && p.phase === "video" ? ` · span ${p.spanIndex} of ${p.spanCount}${p.span.reasons.length ? ` (${p.span.reasons.join(", ")})` : ""} · ${fmtMs(p.span.start)} → ${fmtMs(p.span.end)}` : ""}
            {p ? ` · step ${Math.min(steps.length, doneSteps + 1)} of ${steps.length}` : ""}
            {job.paused ? " · resume to continue — keep this tab open, the file stays open while paused" : ""}
          </div>
        </div>
        <span className="font-mono text-[26px] font-semibold tabular text-ink" data-export-pct>
          {pct}%
        </span>
        {job.paused ? (
          <button type="button" onClick={onResume} className={cn(PRIMARY, "h-9")}>
            <Play size={13} /> Resume
          </button>
        ) : (
          <button type="button" onClick={onPause} className={cn(GHOST, "h-9")} disabled={!p || p.phase === "prepare" || p.phase === "finalize" || p.phase === "done"}>
            <Pause size={13} /> Pause
          </button>
        )}
        <button type="button" onClick={onCancel} className={cn(GHOST, "h-9 hover:border-danger hover:text-danger")}>
          Cancel
        </button>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-raised" title="Overall progress, weighted by each step's estimated time — it can step back when an estimate is revised well upward; the marks are where one step is expected to hand over to the next">
        <div className={cn("h-full transition-[width] duration-200", job.paused ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (p?.fraction ?? 0) * 100)}%` }} />
        {ticks.map((t) => (
          <div key={t.title} className="absolute top-0 h-full w-px bg-ink/40" style={{ left: `${(t.at * 100).toFixed(2)}%` }} title={t.title} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        <Stat label="Position" value={p ? `${fmtMs(p.phase === "audio" ? p.audioT : p.timelineT)} / ${fmtMs(p.total)}` : "—"} title="Timeline time covered so far, out of the export range" />
        <Stat label="Frames" value={p ? `${p.frames.toLocaleString()} / ${p.framesTotal.toLocaleString()}` : "—"} />
        <Stat label="Speed" value={p && p.fps > 0 ? `${p.fps.toFixed(1)} fps · ${p.realtime.toFixed(3)}× realtime` : "—"} title="Frames per second over the last few seconds; timeline seconds per wall second spent on video" />
        <Stat label="Elapsed" value={p ? `${fmtDuration(p.elapsedMs)}${p.pausedMs > 500 ? ` (+${fmtDuration(p.pausedMs)} paused)` : ""}` : "0:00:00.0"} />
        <Stat label="Remaining" value={p ? `≈ ${fmtDuration(p.etaMs)} · ${SOURCE_LABEL[p.etaSource]}` : "estimating…"} title="The unfinished steps' estimates added up, and what most of that rests on" />
        <Stat label="Finish at" value={finishAt} title="Expected clock time when the file is closed" />
        <Stat label="Written" value={p ? `${fmtBytes(p.bytesWritten)}${out ? ` of ~${fmtBytes(out.estimatedBytes)}` : ""}` : "0 kB"} title="Bytes that reached the file so far, against the estimate" />
        {job.freeBytes != null && <Stat label="Free on disk" value={fmtBytes(job.freeBytes)} title="As the browser reports it; it keeps a reserve, so the real figure can be a little higher" />}
        <Stat label="Output" value={out ? `${out.codec} ${out.width}×${out.height}` : "—"} />
        <Stat label="Bitrate · preset" value={out ? `${out.bitrateMbps} Mbps · ${out.preset}` : "—"} />
        <Stat label="Started" value={p ? new Date(p.startedAt).toLocaleTimeString() : "—"} />
        <Stat label="Total expected" value={p ? `≈ ${fmtDuration(p.totalEstimateMs)} working` : "—"} title="Elapsed plus remaining, pauses excluded" />
        <Stat label="Progress" value={p ? `video ${Math.min(100, (p.timelineT / Math.max(1e-6, p.total)) * 100).toFixed(3)}% · audio ${Math.min(100, (p.audioT / Math.max(1e-6, p.total)) * 100).toFixed(3)}%` : "—"} title="Each phase on its own, to three decimals" />
      </div>
      <div className="rounded-[var(--radius-sm)] border border-line" data-export-steps>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12px] text-muted">
          <span className="font-medium text-ink">Steps</span>
          <span>
            {doneSteps} of {steps.length || "—"} done
          </span>
          <span title="Each unfinished step's estimate is a default guess until there is something to measure; a speed learned from your last export at these settings stands in between">estimates: {basisSummary}</span>
          <button type="button" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps} className="ml-auto text-accent hover:underline">
            {showSteps ? "Hide steps" : "Show steps"}
          </button>
        </div>
        {showSteps && steps.length > 0 && (
          <ol className="divide-y divide-line border-t border-line">
            {steps.map((s, i) => (
              <StepRow key={s.id} step={s} index={i} paused={!!job.paused} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** One export step: what it does, how far it is, what it was expected to take and what it actually took. */
function StepRow({ step: s, index, paused }: { step: StepProgress; index: number; paused: boolean }) {
  const running = s.status === "running", done = s.status === "done";
  const timed = s.kind === "video" || s.kind === "audio";
  const timing = done
    ? `took ${fmtDuration(s.elapsedMs)}${s.promisedMs != null && s.promisedMs > 0 ? ` · expected ${fmtDuration(s.promisedMs)} (${fmtDelta(s.elapsedMs, s.promisedMs)})` : ""}`
    : running
      ? `${fmtDuration(s.elapsedMs)} of ≈ ${fmtDuration(s.estimateMs)} · ≈ ${fmtDuration(s.remainingMs)} left · ${s.basis}`
      : `≈ ${fmtDuration(s.estimateMs)} · ${s.basis}`;
  const when = s.startedAt != null ? `${new Date(s.startedAt).toLocaleTimeString()}${s.endedAt != null ? ` → ${new Date(s.endedAt).toLocaleTimeString()}` : " → …"}` : "";
  return (
    <li className={cn("grid grid-cols-[20px_1fr] gap-x-2 px-3 py-2", running && "bg-accent-soft/40")} data-step={s.id} data-status={s.status}>
      <div className="pt-0.5">
        {done ? <Check size={15} className="text-accent" aria-label="done" /> : running ? paused ? <Pause size={15} className="text-warn" aria-label="paused" /> : <Loader size={15} className="animate-spin text-accent" aria-label="running" /> : <Circle size={13} className="mt-0.5 text-faint" aria-label="pending" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
          <span className={cn("font-medium", done || running ? "text-ink" : "text-muted")}>
            {index + 1}. {s.title}
          </span>
          {timed && (running || done) && (
            <span className="font-mono tabular text-ink" data-step-inner>
              {((s.fraction ?? 0) * 100).toFixed(3)}%
            </span>
          )}
          {timed && <span className="font-mono tabular text-muted">{running || done ? `${fmtMs(s.done)} / ${fmtMs(s.units)}` : `${fmtMs(s.units)} of timeline`}</span>}
          <span className="ml-auto font-mono text-[12px] tabular text-muted" data-step-timing>
            {timing}
          </span>
        </div>
        <div className="text-[12px] text-faint">
          {s.detail}
          {when ? ` · ${when}` : ""}
        </div>
        {running && s.stage && (
          <div className="mt-0.5 text-[12px] text-ink" data-step-stage>
            now: {s.stage}
          </div>
        )}
        {running && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
            {s.fraction != null ? <div className={cn("h-full transition-[width] duration-200", paused ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, s.fraction * 100)}%` }} /> : <div className={cn("h-full w-1/3 animate-pulse", paused ? "bg-warn" : "bg-accent")} />}
          </div>
        )}
      </div>
    </li>
  );
}
