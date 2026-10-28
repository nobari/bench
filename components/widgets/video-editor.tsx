"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, ChevronDown, ChevronRight, ChevronUp, Sparkles, Clapperboard, Crop, Download, FolderOpen, Gauge, Loader, Maximize2, Minimize2, Music, Pause, Play, Repeat, Save, Scissors, SkipBack, SkipForward, SlidersHorizontal, Smartphone, StepBack, StepForward, Trash2, Type, Upload, Volume2, VolumeX, Keyboard, Search, Shuffle, X } from "lucide-react";
import { newShort, timelineDuration as shortTimelineDuration, type EditorMode, type Short } from "@/lib/tools/video/project";
import { DEFAULT_SHORT_SECONDS, MIN_SHORT_SECONDS, SHORTS_FOLDER, clampShort, seamCandidates, seamScore, shortBytes, shortChecks, shortFileName, shortPostText, shortProject, shortsFromMoments, suggestWindows, viewFor } from "@/lib/tools/video/short-mode";
import { scoreMoments as scoreShortMoments } from "@/lib/tools/video/intro";
import { ShortsPanel, type SeamState } from "@/components/widgets/short-mode-panel";
import { SafeGhost } from "@/components/widgets/shorts-parts";
import { carryKeys, describeKeys, keyAround, keyFor, keyIndexAt, keysFromSamples, movedKey, removeKeyAt, setKey, smoothKeys, thinKeys, windowInPicture, zoomedKey } from "@/lib/tools/video/window-keys";
import { ROAD_CONFIDENCE, greyOf, vanishingPoint } from "@/lib/tools/video/road";
import { framed, pictureAspect, reframeAt } from "@/lib/tools/video/reframe";
import { scanMotionTrack } from "@/lib/tools/video/engine";
import { TITLE_ENTER_NAMES, TITLE_ENTERS, TITLE_EXIT_NAMES, TITLE_EXITS, type TitleEnter, type TitleExit } from "@/lib/tools/video/project";
import { TITLE_PRESETS, applyTitlePreset, copyTitlesToShorts } from "@/lib/tools/video/title-tools";
import { beatPeriod, cutToBeats, nearestBeat, punchIns, slowStretch, timelineBeats } from "@/lib/tools/video/beat-tools";
import { analyseBeats } from "@/lib/tools/video/beats";
import { decodeMono } from "@/lib/tools/video/engine";
import { DEFAULT_EXPORT, NEUTRAL_GRADE, NEUTRAL_TRANSFORM, TITLE_ALIGNS, TITLE_FAMILIES, TITLE_FONTS, TITLE_POSITIONS, TITLE_SHADOWS, TITLE_WEIGHTS, TRANSITIONS, addTransitionAt, appendMusic, applyAudioTo, applyGradeTo, applyTransitionToAll, clipAt, crossfades, dbToGain, effectiveMusicEnd, estimateExport, exportRange, fmtTime, musicGainAt, musicLength, newId, newProject, newTitle, orderRecordings, placeClips, planExport, removeRange, reorderMusic, setTransition, splitClip, timelineDuration, titleLanes, transitionAt, transitionWindows, CLIP_SPEEDS, canMergeWithNext, clipLength, clipSpeed, groupOf, sourceTimeAt, mergeWithNext, moveClip, unjoin, updateClip, visibleCuts, type Clip, type MediaRef, type MusicTrack, type Project, type ProxyHeight, type Title, type TitleFont, isFileLutKind, FILE_LUT_KINDS, type FileLutKind, type LutKind, type MathLutKind, type TitleAlign, type TitlePosition, type TitleShadow, type Transition, type TransitionKind, type ExportTags, type IntroSettings, type IntroCard, DEFAULT_CARD, cardSettings, hasCard, reorderClip, parseTime, type SteadyLights, STEADY_FRAMES, clampMusicStart, musicUnused, shuffleFillMusic, describeWhere, nameSome, whereSummary, type MediaWhere, exportFingerprint, SOUND_MODES, SOUND_LABELS, soundLevels, applySoundLevels, soundState, type SoundMode, type SoundLevels, FRAMES, FRAME_LABELS, MAX_REFRAME_ZOOM, MIN_CLIP_SPEED, MAX_CLIP_SPEED, type Frame, type Layout, type ReframeKey } from "@/lib/tools/video/project";
import { gainToReach, YOUTUBE_LUFS, type Loudness } from "@/lib/tools/video/loudness";
import { drawTransition } from "@/lib/tools/video/transitions";
import { LUT_OPTIONS, buildDlogLut, deriveLut, fetchOfficialLut, lutToCube, parseCube, type Lut3D } from "@/lib/tools/video/lut";
import { fmtBytes, fmtDuration, fmtMs, type ExportProgress, type SpeedPriors, type StepProgress } from "@/lib/tools/video/progress";
import { buildProxy, drawOverlays, encoderSupport, exportProject, fixLevel, FrameComposer, MAX_AUDIBLE_SPEED, measureFile, measureLoudness, MIN_AUDIBLE_SPEED, probe, probeKeyframes, renderFrame, renderSceneThumbs, scanMoments, scanMotion, Steadier, type ExportFault, type ExportManifest, type PartStore, type JoinInfo } from "@/lib/tools/video/engine";
import { INTRO_STYLES, addSceneAt, buildIntro, describeIntro, drawIntroFx, hasIntro, introCandidates, introFrameAt, introLength, introRegion, introStyle, mainClips, moveScene, pickMoments, removeIntro, removeScene, restyleIntro, sceneSecondsFor, scoreMoments, setSceneSeconds, shiftAfterIntro, styledGrade, sceneFootage, minSceneSeconds, introBlendAt } from "@/lib/tools/video/intro";
import { ProjectStore, hasFileSystemAccess, AUTOSAVE_FILE, FRAMES_DIR, PROJECT_FILE, PROXY_DIR } from "@/lib/tools/video/store";
import { cn } from "@/lib/utils";
import { DEFAULT_STOPS, cutOutStops, stillRuns, stillThreshold, stopKey, stopsOnTimeline, stopsTotal, type Still, type StopScan } from "@/lib/tools/video/stops";
import { parseTemplateImport, videoTemplate } from "@/lib/tools/video/template";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { useKeepAwake } from "@/lib/keep-awake";
import { audioBytesFor, isSpaceError, joinMode, joinNeed, partNeed, roomAdvice, SpaceStop } from "@/lib/tools/video/space";
import { describeBrowser, exportReport, reportFileName, type ReportInput } from "@/lib/tools/video/export-report";
import pkg from "@/package.json";
import { PART_SECONDS } from "@/lib/tools/video/engine";
import { GHOST, INPUT, PRIMARY, RANGE, SEL } from "./video-styles";
import { ExportDone, ExportFiles, ExportRun, ExportSummary, PHASE_LABEL, Preflight, PresetsRow, Section, type DoneResult, type ExportJobView, type FileEntry, type FixState, type ResumableView, type RunEvent, type Skip, ExportReview } from "./video-export";
import { applyPreset, matchPreset } from "@/lib/tools/video/export-presets";
import { frameAspect, outputSize, sizeText } from "@/lib/tools/video/reframe";
import { preflight, preflightBlocks } from "@/lib/tools/video/preflight";
import { applyRepair, planRepair } from "@/lib/tools/video/check";
import { diagnose, type DoctorDepth, type DoctorProgress, type DoctorReport, type Finding, type FixKind } from "@/lib/tools/video/doctor";
import { allTicked, reviewProject } from "@/lib/tools/video/review";
import { SplitPane } from "@/components/ui/split-pane";
import { useFocusMode } from "@/lib/focus-mode";
import { defaultSpeeds } from "@/lib/tools/video/progress";

/** A key hint at the end of a button label. */
const Key = ({ k }: { k: string }) => <kbd className="ml-auto rounded border border-edge px-1 font-mono text-[10px] leading-4 text-faint max-sm:hidden">{k}</kbd>;
const LANE_COLORS = ["#8a8f99", "#5ab3d6", "#d9a400"];
const POSITION_NAMES: Record<TitlePosition, string> = { tl: "Top left", tc: "Top centre", tr: "Top right", ml: "Middle left", mc: "Centre", mr: "Middle right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };
const KIND_LABELS: Record<Title["kind"], string> = { intro: "Intro", title: "Title", lowerThird: "Lower third", hook: "Hook", caption: "Caption", words: "Word by word", badge: "Part badge", place: "Place & date", cta: "Call to action", counter: "Counter" };
/** The Picture section's one layout control: which panes fill a vertical, square or portrait frame. */
const LAYOUT_CHOICES: { id: string; label: string; layout: Layout | null }[] = [
  { id: "fill", label: "The window fills the frame", layout: null },
  { id: "fit-blur", label: "Whole picture over a blurred copy", layout: { kind: "fit", background: "blur" } },
  { id: "fit-black", label: "Whole picture over black", layout: { kind: "fit", background: "black" } },
  { id: "stack-top", label: "Whole picture above the window", layout: { kind: "stack", wideAt: "top" } },
  { id: "stack-bottom", label: "Whole picture below the window", layout: { kind: "stack", wideAt: "bottom" } },
];
const layoutChoice = (l: Layout | null | undefined) => (!l || l.kind === "fill" ? "fill" : l.kind === "fit" ? (l.background === "blur" || !l.background ? "fit-blur" : "fit-black") : l.wideAt === "bottom" ? "stack-bottom" : "stack-top");
const DEFAULT_PREVIEW_HEIGHT: ProxyHeight = 0;
const fmtDb = (v: number) => (v <= -60 ? "off" : `${v > 0 ? "+" : ""}${v} dB`);
const describeLoudness = (r: Loudness) => (r.integrated === null ? "silent" : `${r.integrated.toFixed(1)} LUFS · peaks ${r.peakDb.toFixed(1)} dBFS`);
/** The export panel's one-line account of which clips and tracks sit at the mode's levels. */
function describeSoundState(st: ReturnType<typeof soundState>, levels: SoundLevels): string {
  const clips = st.clipsAt + st.clipsOff + st.clipsOther, music = st.musicAt + st.musicOff + st.musicOther;
  if (!clips && !music) return "No clips or music yet.";
  const part = (at: number, off: number, other: number, total: number, level: number, what: string) => {
    if (!total) return `no ${what}`;
    const bits = [`${at} of ${total} ${what} at ${fmtDb(level)}`];
    if (other) bits.push(`${other} at another level`);
    if (off) bits.push(`${off} off`);
    return bits.join(", ");
  };
  return `${part(st.clipsAt, st.clipsOff, st.clipsOther, clips, levels.camera, "clips")} · ${part(st.musicAt, st.musicOff, st.musicOther, music, levels.music, "tracks")}.`;
}
const toHex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffffff");
type Tab = "trim" | "intro" | "transform" | "colour" | "audio" | "titles" | "shorts" | "export";
const TABS: [Tab, string, typeof Scissors][] = [
  ["trim", "Trim", Scissors],
  ["intro", "Intro", Sparkles],
  ["transform", "Crop", Crop],
  ["colour", "Colour", SlidersHorizontal],
  ["audio", "Audio", Volume2],
  ["titles", "Titles", Type],
  ["shorts", "Shorts", Smartphone],
  ["export", "Export", Download],
];

/** A running job; the export fields (progress, output, pause, faults, parts) are what the run view shows. */
interface Job extends ExportJobView {
  kind: "proxy" | "export" | "frame" | "intro" | "stops" | "loudness" | "fix" | "check" | "shorts" | "beats";
  fraction: number;
  message?: string;
  abort: AbortController;
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
  ["Q / W", "Trim the clip under the playhead to start or end here"],
  ["C", "Split the clip at the playhead"],
  ["J", "Merge or join the selected clip with the next (⇧J unjoins it from the previous)"],
  ["[ / ]", "Move the selected clip earlier or later"],
  ["I / O", "Short mode: start or end the short at the playhead (a new short when there is none)"],
  ["N", "A new short at the playhead"],
  ["L", "Loop the short in Short mode, else the export range or the whole timeline"],
  [", / .", "Short mode: the short's start a frame earlier or later (⇧ for its end, ⌥ for a second)"],
  ["K", "Key the window here (⇧K deletes the key here)"],
  ["⌥ ← / →", "The previous or next window key"],
  ["M", "Mute the preview"],
  ["S", "Save a thumbnail of the frame (⇧S full-size JPEG, ⌥S PNG)"],
  ["⌫", "Delete the selected clip or transition"],
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
  loudness: "A loudness measurement is running in the video editor; leaving now would abandon it.",
  fix: "A fixed copy of a file is being written in the video editor; leaving now would abandon it.",
  check: "A file's index is being checked or repaired in the video editor.",
  shorts: "Shorts are being planned in the video editor; leaving now would abandon it.",
  beats: "The music's beats are being analysed in the video editor; leaving now would abandon it.",
};
/** Which export sections are open, remembered per browser. */
const SECTIONS_KEY = "bench:video:export-sections";
/** Holding Space this long (or the first key repeat) switches the preview to double speed instead of toggling play. */
const HOLD_MS = 250;
/** Browsers refuse playback rates above 16× on a video element, and silence the sound above 4×. */
const MAX_PREVIEW_RATE = 16;
const PREVIEW_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8, 12, 16];
/** Tests can watch every frame time the export hands to the encoder (see window.__benchVideo.traceFrames). */
let frameTrace: ((timelineT: number) => void) | null = null;
/** Tests can shorten the parts and make the drive refuse writes (window.__benchVideo.exportOptions). */
const testExportOptions: { partSeconds?: number; joinMode?: "keep" | "remove"; failJoinAfter?: number; noParts?: boolean; refuseAfterBytes?: number; refuseFinalAfterBytes?: number } = {};
/** Tests: a writable that refuses like a full disk once this many bytes have gone through a run's writables (all of them, or the file alone). */
const testBytes = { all: 0, final: 0 };
const refusingAfter = (target: WritableStream<import("mediabunny").StreamTargetChunk>, limit: number, count: "all" | "final"): WritableStream<import("mediabunny").StreamTargetChunk> => {
  const writer = target.getWriter();
  return new WritableStream<import("mediabunny").StreamTargetChunk>({
    write: async (chunk) => {
      testBytes.all += chunk.data.byteLength;
      if (count === "final") testBytes.final += chunk.data.byteLength;
      if (testBytes[count] > limit) throw new DOMException("Test: the disk is full", "QuotaExceededError");
      await writer.write(chunk);
    },
    close: () => writer.close(),
    abort: (reason) => writer.abort(reason),
  });
};
const testWritable = (w: WritableStream<import("mediabunny").StreamTargetChunk>, final = false) => {
  if (final && testExportOptions.refuseFinalAfterBytes !== undefined) return refusingAfter(w, testExportOptions.refuseFinalAfterBytes, "final");
  return testExportOptions.refuseAfterBytes === undefined ? w : refusingAfter(w, testExportOptions.refuseAfterBytes, "all");
};

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
  // The export views: set-up or the Files list; the file name when the user typed one; which sections are open.
  const [exportView, setExportView] = useState<"setup" | "files">("setup");
  // Focus mode (lib/focus-mode): only the preview, the tools and the timeline, filling the viewport.
  const { focus } = useFocusMode();
  const [exportName, setExportName] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  /** How the last export ended, shown as a card until dismissed; the run's log; stretches skipped; the live frame. */
  const [done, setDone] = useState<DoneResult | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const eventsRef = useRef<RunEvent[]>([]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const [skipped, setSkipped] = useState<Skip[]>([]);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  /** What the pre-flight needs from the machine: power, learned speeds. */
  const [onBattery, setOnBattery] = useState<boolean | null>(null);
  const [priors, setPriors] = useState<SpeedPriors | undefined>(undefined);
  /** Videos in the project folder besides the recordings, for the Files view. */
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  /** The mix's measured loudness, keyed to the sound state it was measured in; predicted after a level change. */
  const [loudness, setLoudness] = useState<{ fingerprint: string; result: Loudness; predicted?: boolean } | null>(null);
  const [fixFile, setFixFile] = useState<{ file: File; loudness: Loudness } | null>(null);
  const [fixTarget, setFixTarget] = useState(YOUTUBE_LUFS);
  const [fixed, setFixed] = useState<{ name: string; bytes: number; gainDb: number } | null>(null);
  const progressAt = useRef(0);
  useUnsavedWork(job ? JOB_WORK[job.kind] : null);
  useKeepAwake(!!job, "bench-video-job");
  const [support, setSupport] = useState<{ hevc: boolean; avc: boolean } | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graderRef = useRef<{ key: string; composer: FrameComposer } | null>(null);
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
  /** Remembered files the browser will hand back only after a click (after a restart, say). */
  const [reconnectable, setReconnectable] = useState(0);
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
  // Short mode: the short being worked on, the export's extra file, the phone ghost and the loop's seam.
  const [currentShort, setCurrentShort] = useState<string | null>(null);
  const [withoutMusic, setWithoutMusic] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [seam, setSeam] = useState<SeamState | null>(null);
  // The window on the frame: the whole-picture view with the window drawn over it, a drag in progress, the key actions.
  const [windowView, setWindowView] = useState(false);
  const [snapBeats, setSnapBeats] = useState(true);
  const [dragKey, setDragKey] = useState<ReframeKey | null>(null);
  const windowDragRef = useRef<{ startX: number; startY: number; key: ReframeKey; clipId: string; moved: boolean } | null>(null);
  const windowOverlayRef = useRef<HTMLDivElement>(null);
  const windowActionsRef = useRef<{ keyHere: () => void; removeKey: () => void; jumpKey: (dir: -1 | 1) => void }>({ keyHere: () => undefined, removeKey: () => undefined, jumpKey: () => undefined });
  const shortActionsRef = useRef<{ markIn: () => void; markOut: () => void; newAt: () => void; nudge: (end: "from" | "to", delta: number) => void }>({ markIn: () => undefined, markOut: () => undefined, newAt: () => undefined, nudge: () => undefined });
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
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  /** Height of the lane column's horizontal scrollbar (0 with overlay scrollbars); the label column leaves that room. */
  const [scrollbarH, setScrollbarH] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The editor fills the viewport below whatever sits above it (the site header and the page title); the row
  // split and the timeline share that height.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const set = () => el.style.setProperty("--editor-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY + 16)}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [focus]);
  const cubeInput = useRef<HTMLInputElement>(null);
  // DJI's own LUT file, fetched the first time a clip asks for it; both file-based conversions derive from it.
  const [fileLuts, setFileLuts] = useState<Partial<Record<FileLutKind, Lut3D>> | null>(null);
  const needsFileLut = project.clips.some((c) => isFileLutKind(c.grade.lut));
  useEffect(() => {
    if (!needsFileLut || fileLuts) return;
    let active = true;
    fetchOfficialLut()
      .then((base) => {
        if (active) setFileLuts(Object.fromEntries(FILE_LUT_KINDS.map((kind) => [kind, deriveLut(base, kind)])));
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
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const v = localStorage.getItem(SECTIONS_KEY);
        if (v) setOpenSections(JSON.parse(v) as Record<string, boolean>);
      } catch {
        /* storage unavailable or unreadable */
      }
    });
  }, []);
  const toggleSection = (id: string) =>
    setOpenSections((o) => {
      const next = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  // Battery state, where the browser tells (Chrome does): a long export on battery deserves a word.
  useEffect(() => {
    type Battery = EventTarget & { charging: boolean };
    const nav = navigator as Navigator & { getBattery?: () => Promise<Battery> };
    if (!nav.getBattery) return;
    let battery: Battery | null = null;
    const update = () => setOnBattery(battery ? !battery.charging : null);
    let active = true;
    nav
      .getBattery()
      .then((b) => {
        if (!active) return;
        battery = b;
        b.addEventListener("chargingchange", update);
        update();
      })
      .catch(() => {});
    return () => {
      active = false;
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);
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
  /* ------------------------------------------------------------ Short mode: the shorts on this timeline */
  const shorts = useMemo(() => project.shorts ?? [], [project.shorts]);
  const shortMode = project.mode === "short";
  const activeShort = useMemo(() => shorts.find((x) => x.id === currentShort) ?? (shortMode ? (shorts[0] ?? null) : null), [shorts, currentShort, shortMode]);
  const shortIndex = activeShort ? shorts.indexOf(activeShort) + 1 : 0;
  /** What the preview shows and a saved frame renders: the short's titles alone in Short mode, the landscape edit's otherwise. */
  const view = useMemo(() => viewFor(project, shortMode ? activeShort : null), [project, shortMode, activeShort]);
  /** What the landscape export renders: never a short's titles. */
  const landscape = useMemo(() => viewFor(project, null), [project]);
  /** The frame the preview composes: the phone's in Short mode, else the export's. */
  const previewFrame = shortMode ? "9:16" : project.export.frame;
  const framedPreview = framed(previewFrame);
  /** The whole-picture view: the clip's own picture with the frame's window drawn over it, to place by hand. */
  const pictureView = windowView && framedPreview;
  const spans = useMemo(() => planExport(landscape), [landscape]);
  const range = useMemo(() => exportRange(project), [project]);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  /** The span the Loop button repeats: the short in Short mode, else the export range, else everything. */
  const loopSpan = useMemo(() => (shortMode && activeShort ? { from: activeShort.from, to: activeShort.to } : range), [shortMode, activeShort, range]);
  const loopSpanRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    loopSpanRef.current = loopSpan;
  }, [loopSpan]);
  const setRange = (r: { from: number; to: number } | null) => setProject((p) => ({ ...p, export: { ...p.export, range: r } }));
  const setTags = (patch: Partial<ExportTags>) => setProject((p) => ({ ...p, export: { ...p.export, tags: { ...p.export.tags, ...patch } } }));
  const setShorts = (fn: (list: Short[]) => Short[]) => setProject((p) => ({ ...p, shorts: fn(p.shorts ?? []) }));
  const updateShort = (id: string, patch: Partial<Short>) => setShorts((l) => l.map((x) => (x.id === id ? clampShort({ ...x, ...patch }, durationRef.current) : x)));
  /** A new short, in Short mode, selected: from the playhead for the default length unless both ends are given. */
  const addShortAt = (from: number, to?: number, name?: string): Short => {
    const made = clampShort(newShort(from, to ?? from + DEFAULT_SHORT_SECONDS, (projectRef.current?.shorts?.length ?? 0) + 1, name), durationRef.current);
    setProject((p) => ({ ...p, mode: "short", shorts: [...(p.shorts ?? []), made] }));
    setCurrentShort(made.id);
    setTab("shorts");
    return made;
  };
  /** Work on a short: Short mode, the Shorts tab, and (for a click) the playhead at its start. */
  const selectShort = (id: string, jump = true) => {
    const x = (projectRef.current?.shorts ?? []).find((y) => y.id === id);
    if (!x) return;
    setCurrentShort(id);
    setProject((p) => (p.mode === "short" ? p : { ...p, mode: "short" }));
    if (jump) stepTo(x.from);
  };
  /** A short goes with its titles; the footage stays. */
  const removeShort = (id: string) => {
    setProject((p) => ({ ...p, shorts: (p.shorts ?? []).filter((x) => x.id !== id), titles: p.titles.filter((t) => t.short !== id) }));
    if (currentShort === id) setCurrentShort(null);
  };
  const duplicateShort = (id: string) => {
    setProject((p) => {
      const list = p.shorts ?? [];
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return p;
      const copy: Short = { ...list[i], id: newId(), name: `${list[i].name} copy`, exported: null };
      const titles = p.titles.filter((t) => t.short === id).map((t) => ({ ...t, id: newId(), short: copy.id }));
      return { ...p, shorts: [...list.slice(0, i + 1), copy, ...list.slice(i + 1)], titles: [...p.titles, ...titles] };
    });
  };
  const moveShort = (id: string, dir: -1 | 1) =>
    setShorts((l) => {
      const i = l.findIndex((x) => x.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  /** Landscape or Short: Short mode with no short yet starts one at the playhead. */
  const setMode = (mode: EditorMode) => {
    if (mode === "short" && !(projectRef.current?.shorts ?? []).length) {
      addShortAt(playheadRef.current);
      return;
    }
    setProject((p) => ({ ...p, mode }));
    if (mode === "short") setTab("shorts");
    else if (tab === "shorts") setTab("trim");
  };
  const shortLength = (seconds: number) => {
    if (!activeShort) return;
    updateShort(activeShort.id, { to: activeShort.from + seconds });
  };
  const shortActions = {
    markIn: () => {
      const t = playheadRef.current, x = activeShort;
      if (!x || !shortMode) addShortAt(t);
      else updateShort(x.id, { from: Math.min(t, x.to - MIN_SHORT_SECONDS) });
    },
    markOut: () => {
      const t = playheadRef.current, x = activeShort;
      if (!x || !shortMode) addShortAt(Math.max(0, t - DEFAULT_SHORT_SECONDS), Math.max(MIN_SHORT_SECONDS, t));
      else updateShort(x.id, { to: Math.max(t, x.from + MIN_SHORT_SECONDS) });
    },
    newAt: () => void addShortAt(playheadRef.current),
    nudge: (end: "from" | "to", delta: number) => {
      const x = activeShort;
      if (!x || !shortMode) return;
      updateShort(x.id, end === "from" ? { from: Math.min(x.to - MIN_SHORT_SECONDS, x.from + delta) } : { to: Math.max(x.from + MIN_SHORT_SECONDS, x.to + delta) });
    },
  };
  useEffect(() => {
    shortActionsRef.current = shortActions;
  });
  const fingerprint = useMemo(() => exportFingerprint(project), [project]);
  /** Everything the sound mix depends on; a measurement is current while this is unchanged. */
  const audioKey = useMemo(
    () =>
      JSON.stringify({
        c: placed.map((c) => [c.media, c.in, c.out, c.gainDb, c.muted, c.speed ?? 1]),
        m: project.music.map((m) => [m.media, m.lane, m.start, m.in, m.out, m.gainDb, m.muted, m.fadeIn, m.fadeOut, m.keyframes]),
        r: range,
      }),
    [placed, project.music, range],
  );
  const levels = soundLevels(project);
  const soundSt = useMemo(() => soundState(project), [project]);
  const matchGain = loudness && loudness.result.integrated !== null ? gainToReach(loudness.result.integrated, loudness.result.peakDb) : 0;
  const fixGain = fixFile && fixFile.loudness.integrated !== null ? gainToReach(fixFile.loudness.integrated, fixFile.loudness.peakDb, fixTarget) : 0;

  /** Progress for the small jobs, at most four times a second. */
  const tick = (fraction: number, message?: string) => {
    const now = performance.now();
    if (now - progressAt.current < 250 && fraction < 1) return;
    progressAt.current = now;
    setJob((j) => (j ? { ...j, fraction: Math.max(0, Math.min(1, fraction)), message } : j));
  };
  const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
  /** Runs the export's sound mix over the export range and measures it. */
  const measureMix = async () => {
    if (!placed.length || job) return;
    const abort = new AbortController();
    const from = range?.from ?? 0, to = range?.to ?? duration;
    setJob({ kind: "loudness", label: "Measuring the mix", fraction: 0, abort });
    setError(null);
    try {
      const result = await measureLoudness({ project, getFile: (id) => store.getFile(id), sampleRate: 48000, from, to, signal: abort.signal, onProgress: (done, total) => tick(done / Math.max(1e-6, total), fmtTime(done)) });
      setLoudness({ fingerprint: audioKey, result });
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "The mix could not be measured.");
    } finally {
      setJob(null);
    }
  };
  /** Raises or lowers every clip and track together so the mix lands at YouTube's level, as far as the peaks allow. */
  const matchLevel = () => {
    if (!loudness || loudness.result.integrated === null) return;
    const g = gainToReach(loudness.result.integrated, loudness.result.peakDb);
    if (Math.abs(g) < 0.05) return;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    setProject((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.muted || c.gainDb <= -60 ? c : { ...c, gainDb: r1(c.gainDb + g) })),
      music: p.music.map((m) => (m.muted || m.gainDb <= -60 ? m : { ...m, gainDb: r1(m.gainDb + g), keyframes: m.keyframes.map((k) => ({ ...k, db: r1(k.db + g) })) })),
    }));
    setLoudness((l) => (l && l.result.integrated !== null ? { fingerprint: "", predicted: true, result: { ...l.result, integrated: l.result.integrated + g, peakDb: l.result.peakDb + g } } : l));
  };
  const loadFixFile = async (file: File) => {
    if (job) return;
    const abort = new AbortController();
    setJob({ kind: "loudness", label: `Measuring ${file.name}`, fraction: 0, abort });
    setFixed(null);
    setError(null);
    try {
      const result = await measureFile(file, { signal: abort.signal, onProgress: (done, total) => tick(done / Math.max(1e-6, total), fmtTime(done)) });
      setFixFile({ file, loudness: result });
    } catch (e) {
      if (!isAbort(e)) setError(`${file.name}: ${e instanceof Error ? e.message : "could not be read."}`);
    } finally {
      setJob(null);
    }
  };
  /** Writes a copy of the opened file with its sound at the target level into the project folder. */
  const runFix = async () => {
    if (!fixFile || fixFile.loudness.integrated === null || job) return;
    if (!store.hasFolder) return setError("Pick a project folder first — the fixed copy is written there.");
    const gainDb = gainToReach(fixFile.loudness.integrated, fixFile.loudness.peakDb, fixTarget);
    const name = `${fixFile.file.name.replace(/\.(mp4|mov|m4v)$/i, "")}-${fixTarget === YOUTUBE_LUFS ? "youtube-level" : `${Math.abs(fixTarget)}lufs`}.mp4`;
    const abort = new AbortController();
    setJob({ kind: "fix", label: `Writing ${name}`, fraction: 0, abort });
    setError(null);
    try {
      const { writable } = await store.createWritable(name);
      const result = await fixLevel({
        file: fixFile.file,
        writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
        gainDb,
        audioBitrateKbps: project.export.audioBitrateKbps,
        signal: abort.signal,
        onProgress: (stage, fraction) => tick(stage === "video" ? fraction * 0.6 : stage === "audio" ? 0.6 + fraction * 0.35 : 0.95 + fraction * 0.05, stage === "video" ? "copying the picture" : stage === "audio" ? "re-levelling the sound" : "closing the file"),
      });
      setFixed({ name, bytes: result.bytes, gainDb });
      setFilesVersion((v) => v + 1);
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : "The fixed copy could not be written.");
    } finally {
      setJob(null);
    }
  };
  // A stopped export's finished parts, found in the project folder: what the Export tab offers to resume.
  const [resumable, setResumable] = useState<{ manifest: ExportManifest; folder: string; bytes: number; largest: number } | null>(null);
  const loadResumable = useCallback(async () => {
    if (!store.hasFolder) return setResumable(null);
    for (const folder of await store.subFolders()) {
      if (!folder.endsWith(".parts")) continue;
      const text = await store.readText("resume.json", folder);
      if (!text) continue;
      try {
        const manifest = JSON.parse(text) as ExportManifest;
        if (manifest.version !== 1 || !Array.isArray(manifest.parts)) continue;
        let bytes = 0, largest = 0;
        for (const part of manifest.parts) {
          if (part.consumed) continue;
          const size = (await store.fileIn(part.file, folder))?.size ?? 0;
          bytes += size;
          largest = Math.max(largest, size);
        }
        setResumable({ manifest, folder, bytes, largest });
        return;
      } catch {
        /* not a manifest */
      }
    }
    setResumable(null);
  }, [store]);
  useEffect(() => {
    if (!folder) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void loadResumable();
    });
    return () => {
      active = false;
    };
  }, [folder, loadResumable]);
  const discardParts = async () => {
    if (!resumable) return;
    if (!window.confirm(`Remove the ${resumable.manifest.parts.length} kept part${resumable.manifest.parts.length === 1 ? "" : "s"} (${fmtBytes(resumable.bytes)})? A later export starts from the beginning.`)) return;
    await store.remove(null, resumable.folder);
    setResumable(null);
  };
  /* ------------------------------------------------------------ export set-up: name, estimate, pre-flight, files */
  const firstMedia = project.media[project.clips[0]?.media ?? ""];
  const { width: outW, height: outH } = outputSize(firstMedia?.width || 7680, firstMedia?.height || 4320, project.export);
  const frameChosen = project.export.frame ?? "source";
  const sizeLabel = frameChosen !== "source" ? `${outW}x${outH}` : outH >= 4320 ? "8K" : outH >= 2160 ? "4K" : `${outH}p`;
  /** "1080×1920" for a resolution choice in the chosen frame, for the Picture section's options. */
  const sizeFor = (resolution: "source" | number) => (firstMedia?.width && firstMedia.height ? sizeText(outputSize(firstMedia.width, firstMedia.height, { resolution, frame: project.export.frame })) : null);
  const autoName = `${project.name.replace(/[^\w-]+/g, "-")}-${sizeLabel}${range ? `-${Math.round(range.from)}s-${Math.round(range.to)}s` : ""}.mp4`;
  const fileName = exportName === null ? autoName : /\.mp4$/i.test(exportName) ? exportName : `${exportName}.mp4`;
  const speedProfile = `${firstMedia?.height ?? 0}>${outH}:${project.export.codec}:${project.export.preset}`;
  // Which encoders exist at the output size (the header's warning is about 8K; a 1080p export may well have H.264).
  const [outSupport, setOutSupport] = useState<{ hevc: boolean; avc: boolean; w: number; h: number } | null>(null);
  useEffect(() => {
    let active = true;
    encoderSupport(outW, outH)
      .then((sup) => active && setOutSupport({ ...sup, w: outW, h: outH }))
      .catch(() => active && setOutSupport({ hevc: false, avc: false, w: outW, h: outH }));
    return () => {
      active = false;
    };
  }, [outW, outH]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setPriors(loadPriors(speedProfile, `${outH}p ${project.export.codec.toUpperCase()}`));
    });
    return () => {
      active = false;
    };
  }, [speedProfile, outH, project.export.codec, done]);
  const fps = firstMedia?.fps || 30;
  const guess = defaultSpeeds((firstMedia?.width ?? outW) * (firstMedia?.height ?? outH), outW * outH);
  const estimate = useMemo(() => estimateExport(landscape, spans, (priors?.encode ?? guess.encode) * fps, 0.4, priors?.closeBytesPerS ?? guess.closeBytesPerS), [landscape, spans, priors, fps, guess.encode, guess.closeBytesPerS]);
  const estimateBasis = priors?.label ? `speed of ${priors.label}` : "a first guess; your first export teaches it";
  const resumableView: ResumableView | null = resumable
    ? (() => {
        const live = resumable.manifest.parts.filter((p) => !p.consumed);
        const consumed = resumable.manifest.parts.filter((p) => p.consumed);
        return { name: resumable.manifest.name, parts: live.length, bytes: resumable.bytes, endAt: live.length ? Math.max(...live.map((p) => p.end)) : 0, total: resumable.manifest.total, matches: resumable.manifest.fingerprint === fingerprint, folder: resumable.folder, consumedParts: consumed.length, consumedSeconds: consumed.reduce((a, p) => a + (p.end - p.start), 0), skipped: resumable.manifest.skipped.length };
      })()
    : null;
  // Room the export wants on the drive holding the project folder: the parts, then the join on top of them. The
  // browser cannot read a drive's free space (Chrome tells every site the same figure), so it is stated, not compared.
  const roomPlan = useMemo(() => {
    if (!project.clips.length) return null;
    const seconds = range ? range.to - range.from : duration;
    const audio = audioBytesFor(project.export.audioBitrateKbps, seconds);
    const onePart = Math.min(estimate.bytes, partNeed(project.export.bitrateMbps, PART_SECONDS));
    if (resumable) {
      const live = resumable.manifest.parts.filter((p) => !p.consumed);
      const covered = live.reduce((a, p) => a + (p.end - p.start), 0);
      const rest = estimate.bytes * Math.max(0, 1 - covered / Math.max(1e-6, resumable.manifest.total));
      const all = resumable.bytes + rest;
      const mode = joinMode(all);
      return { parts: rest, join: joinNeed(mode === "remove" ? [Math.max(resumable.largest, onePart)] : [all], audio, mode, all), mode, resumable: true };
    }
    const mode = joinMode(estimate.bytes);
    return { parts: estimate.bytes, join: joinNeed(mode === "remove" ? [onePart] : [estimate.bytes], audio, mode, estimate.bytes), mode, resumable: false };
  }, [project.clips.length, project.export.audioBitrateKbps, project.export.bitrateMbps, estimate.bytes, range, duration, resumable]);
  const checks = preflight(landscape, estimate, { width: outW, height: outH }, {
    fileSystem: hasFileSystemAccess(),
    folderName: folder,
    missing: missingMedia.length,
    room: roomPlan,
    support: outSupport && outSupport.w === outW && outSupport.h === outH ? outSupport : null,
    loudness: loudness ? { integrated: loudness.result.integrated, peakDb: loudness.result.peakDb, stale: loudness.fingerprint !== audioKey, predicted: !!loudness.predicted, matchGain: Math.round(matchGain * 10) / 10 } : null,
    resumable: resumableView,
    onBattery,
    seconds: range ? range.to - range.from : duration,
    fps,
  });
  const blockers = preflightBlocks(checks).map((i) => i.title);
  /** The account of the last export, for the result card: what happened, step by step. */
  const account = useMemo(() => {
    if (!done) return null;
    const d = done;
    const looks = [...new Set(project.clips.map((c) => c.grade.lut))].filter((l) => l !== "none");
    const input: ReportInput = {
      version: pkg.version,
      at: d.at,
      browser: describeBrowser(navigator.userAgent),
      result: { kind: d.kind, name: d.name, folder: d.folder, seconds: d.seconds, bytes: d.bytes, activeMs: d.activeMs, pausedMs: d.pausedMs, estimatedMs: d.estimatedMs, codec: d.codec, width: d.width, height: d.height, bitrateMbps: d.bitrateMbps, audioKbps: d.audioKbps, parts: d.parts, resumedFrom: d.resumedFrom, joinMode: d.joinMode, skipped: d.skipped, message: d.message, keptAt: d.keptAt, keptParts: d.keptParts, space: d.space },
      steps: d.steps ?? [],
      join: d.join,
      events: d.events ?? [],
      check: d.kind !== "done" ? null : d.checking ? undefined : d.report === undefined ? (d.checkError ? { ok: false, summary: d.checkError, findings: [] } : undefined) : d.report === null ? null : { ok: d.report.ok, summary: d.report.verdict, findings: d.report.findings.map((f) => f.title) },
      settings: {
        preset: project.export.preset,
        codec: project.export.codec,
        resolution: String(project.export.resolution),
        bitrateMbps: project.export.bitrateMbps,
        audioBitrateKbps: project.export.audioBitrateKbps,
        clips: project.clips.length,
        titles: project.titles.length,
        music: project.music.length,
        looks,
        watermark: !!project.watermark.media,
        sound: project.sound ?? "footage",
        tags: Object.fromEntries(Object.entries(project.export.tags ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>,
        range: project.export.range,
      },
    };
    return exportReport(input);
  }, [done, project]);
  const saveReport = async () => {
    if (!done || !account) return "Nothing to save";
    const name = reportFileName(done.name);
    await store.writeText(name, account);
    setFilesVersion((v) => v + 1);
    return `Saved ${name} in the project folder`;
  };
  const codecLabel = project.export.codec === "hevc" ? "HEVC" : "H.264";
  const presetLabel = { quality: "quality", balanced: "balanced", fast: "fast" }[project.export.preset];
  const pictureLine = `${frameChosen !== "source" ? `${FRAME_LABELS[frameChosen]} · ` : ""}${codecLabel} · ${outW}×${outH} · ${project.export.bitrateMbps} Mbps · ${presetLabel} encoder · smart copy ${project.export.smartCopy ? "on" : "off"}${project.export.steadyLights && project.export.steadyLights !== "off" ? " · steady lights" : ""}`;
  const soundLine = `${SOUND_LABELS[project.sound ?? "footage"]} · camera ${fmtDb(levels.camera)} · music ${fmtDb(levels.music)} · AAC ${project.export.audioBitrateKbps} kbps`;
  const tagsLine = project.export.tags.title.trim() ? `${project.export.tags.kind === "music-video" ? "Music video" : "Video"} · “${project.export.tags.title}”${project.export.tags.artist ? ` · ${project.export.tags.artist}` : ""}${project.export.tags.album ? ` · ${project.export.tags.album}` : ""}` : `${project.export.tags.kind === "music-video" ? "Music video" : "Video"} · no title yet (the project name is used)`;
  const previewScopeLabel = { around: "30 s around the playhead", intro: "the intro", range: "the export range", all: "the whole timeline" }[previewOpts.scope];
  const testLine = `${Math.min(previewOpts.height, firstMedia?.height ?? previewOpts.height)}p · ${previewScopeLabel}`;
  const checkLabel = { full: "Full scan after export", quick: "Quick check after export", off: "No check after export" }[project.export.check ?? "full"];
  const optionsLine = `${(project.export.review ?? "on") === "on" ? "Checklist before export" : "No checklist"} · ${checkLabel} · ${notify ? "notifications on" : "no notifications"} · test render ${testLine}`;
  const summaryLines = [range ? `${fmtTime(range.to - range.from)} of ${fmtTime(duration)}` : fmtTime(duration), `${outW}×${outH} ${codecLabel} ${project.export.bitrateMbps} Mbps`, `AAC ${project.export.audioBitrateKbps} kbps · ${SOUND_LABELS[project.sound ?? "footage"]}`, ...(estimate.copySeconds > 0 ? [`${fmtTime(estimate.copySeconds)} copied as is · ${fmtTime(estimate.encodeSeconds)} re-encoded`] : [])];
  const onPreflightAction = (id: string) => {
    if (id === "pick-folder") void chooseFolder();
    else if (id === "locate") void relinkFiles();
    else if (id === "use-avc") setProject((p) => ({ ...p, export: { ...p.export, codec: "avc" } }));
    else if (id === "use-hevc") setProject((p) => ({ ...p, export: { ...p.export, codec: "hevc" } }));
    else if (id === "lower-resolution") setProject((p) => ({ ...p, export: { ...p.export, resolution: 2160 } }));
    else if (id === "whole-timeline") setRange(null);
    else if (id === "apply-levels") setProject((p) => applySoundLevels(p));
    else if (id === "measure") void measureMix();
    else if (id === "match") matchLevel();
    else if (id.startsWith("set-bitrate:")) setProject((p) => ({ ...p, export: { ...p.export, bitrateMbps: Number(id.slice("set-bitrate:".length)) } }));
    else if (id.startsWith("set-audio:")) setProject((p) => ({ ...p, export: { ...p.export, audioBitrateKbps: Number(id.slice("set-audio:".length)) } }));
    else if (id === "open-range") setOpenSections((o) => ({ ...o, range: true }));
    else if (id === "open-tags") setOpenSections((o) => ({ ...o, tags: true }));
    else if (id === "resume") void runExport(resumable);
    else if (id === "discard") void discardParts();
  };
  /** The frame the engine just composed, scaled into the run view's small canvas. */
  const drawLive = (frame: OffscreenCanvas, t: number) => {
    const c = liveRef.current;
    if (!c) return;
    const w = 320, h = Math.max(1, Math.round((w * frame.height) / frame.width));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.getContext("2d")?.drawImage(frame, 0, 0, w, h);
    setLiveAt(t);
  };
  const logEvent = (kind: RunEvent["kind"], text: string) => setEvents((l) => [...l, { at: Date.now(), kind, text }]);
  /** The doctor runs one file at a time; "skip the rest" aborts the full scan and the quick findings stand. */
  const doctorAbort = useRef<Map<string, AbortController>>(new Map());
  const runDoctor = async (name: string, file: File, depth: DoctorDepth, onProgress: (p: DoctorProgress) => void): Promise<DoctorReport> => {
    doctorAbort.current.get(name)?.abort();
    const abort = new AbortController();
    doctorAbort.current.set(name, abort);
    try {
      return await diagnose(file, { target: "youtube", depth, signal: abort.signal, onProgress });
    } finally {
      if (doctorAbort.current.get(name) === abort) doctorAbort.current.delete(name);
    }
  };
  const cancelDoctor = (name: string) => doctorAbort.current.get(name)?.abort();
  /** Runs the doctor on a file just written (the result card) at the depth the project asks for, and keeps the report with it. */
  const checkWritten = async (name: string, depth: DoctorDepth | "off" = project.export.check ?? "full") => {
    if (depth === "off") return setDone((d) => (d && d.name === name ? { ...d, checking: null, report: null } : d));
    setDone((d) => (d && d.name === name ? { ...d, checking: { stage: "Reading the index", fraction: 0 }, checkError: undefined } : d));
    try {
      const f = await store.fileIn(name);
      if (!f) throw new Error("it is not in the project folder any more");
      const report = await runDoctor(name, f, depth, (p) => setDone((d) => (d && d.name === name ? { ...d, checking: p } : d)));
      setDone((d) => (d && d.name === name ? { ...d, checking: null, report } : d));
    } catch (e) {
      setDone((d) => (d && d.name === name ? { ...d, checking: null, checkError: e instanceof Error ? e.message : String(e) } : d));
    }
  };
  /** The fixes the editor can carry out itself; the others link to the tools that do them. */
  const canFix = (kind: FixKind) => (kind === "repair-index" || kind === "fix-level") && store.hasFolder;
  const fixFinding = async (name: string, finding: Finding, where: "done" | "files") => {
    if (!finding.fix) return;
    if (finding.fix.kind === "repair-index") {
      if (where === "done") await repairWritten(name);
      else await repairFile(name);
    } else if (finding.fix.kind === "fix-level") {
      setTab("export");
      setExportView("files");
      await fixByName(name);
    }
  };
  /**
   * Repairs a file's index in place: only the moov at the tail is rewritten, after the old one is saved beside the
   * file as a backup; the picture and sound are not read or written.
   */
  const repairIndexOf = async (name: string): Promise<{ changes: string[]; report: DoctorReport } | null> => {
    if (job) return null;
    const f = await store.fileIn(name);
    const h = await store.fileHandle(name);
    if (!f || !h) {
      setError(`${name} is not in the project folder any more.`);
      return null;
    }
    const abort = new AbortController();
    setJob({ kind: "check", label: `Repairing the index of ${name}`, fraction: 0, abort });
    setError(null);
    try {
      const plan = await planRepair(f);
      if (!plan) return null;
      if (!window.confirm(`Rewrite the index of ${name}?\n\nOnly the ${fmtBytes(plan.oldSize)} index at the end of the file changes; the picture and sound stay exactly as they are. The old index is saved first as ${name}.index.bak.\n\n${plan.changes.join("\n")}`)) return null;
      const backup = await store.createWritable(`${name}.index.bak`);
      await backup.writable.write(f.slice(plan.moovAt, plan.moovAt + plan.oldSize));
      await backup.writable.close();
      await applyRepair(h, plan);
      const after = await store.fileIn(name);
      if (!after) throw new Error("the repaired file could not be read back");
      const report = await diagnose(after, { target: "youtube", depth: "quick" });
      setStatus(`Repaired the index of ${name} — ${plan.changes.join("; ")}`);
      return { changes: plan.changes, report };
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setJob(null);
      setFilesVersion((v) => v + 1);
    }
  };
  const repairWritten = async (name: string) => {
    const r = await repairIndexOf(name);
    if (r) setDone((d) => (d && d.name === name ? { ...d, report: r.report, repaired: r.changes } : d));
  };
  const isFixedCopy = (name: string) => /-(youtube-level|\d+lufs)\.mp4$/i.test(name);
  /** The videos in the project folder that are not recordings; checks run in the background for the ones not yet checked. */
  const loadFiles = async () => {
    if (!store.hasFolder) return setFiles([]);
    setFilesLoading(true);
    try {
      const list = [...(await store.listFiles()), ...(await store.listFiles(SHORTS_FOLDER))];
      const recordings = new Set(Object.values(project.media).map((m) => m.name));
      const videos = list.filter((f) => /\.(mp4|mov|m4v)$/i.test(f.name) && !recordings.has(f.name));
      // A file that changed (a repair, a re-export) is checked again; what a repair did stays with it.
      const next: FileEntry[] = videos.map((f) => {
        const old = files.find((o) => o.name === f.name);
        if (old && old.size === f.size && old.lastModified === f.lastModified) return old;
        return { name: f.name, size: f.size, lastModified: f.lastModified, kind: f.name.startsWith("preview-") ? "preview" : isFixedCopy(f.name) ? "fixed" : "export", repaired: old?.repaired };
      });
      setFiles(next);
      for (const f of next) if (!f.report && !f.error && !f.checking) await checkFile(f.name);
    } finally {
      setFilesLoading(false);
    }
  };
  const checkFile = async (name: string, depth: DoctorDepth = "quick") => {
    setFiles((l) => l.map((f) => (f.name === name ? { ...f, checking: { stage: "Reading the index", fraction: 0 }, error: undefined } : f)));
    try {
      const f = await store.fileIn(name);
      if (!f) throw new Error("not in the folder any more");
      const report = await runDoctor(name, f, depth, (p) => setFiles((l) => l.map((x) => (x.name === name ? { ...x, checking: p } : x))));
      setFiles((l) => l.map((x) => (x.name === name ? { ...x, checking: null, report } : x)));
    } catch (e) {
      setFiles((l) => l.map((x) => (x.name === name ? { ...x, checking: null, error: e instanceof Error ? e.message : String(e) } : x)));
    }
  };
  const repairFile = async (name: string) => {
    const r = await repairIndexOf(name);
    if (r) setFiles((l) => l.map((x) => (x.name === name ? { ...x, report: r.report, repaired: r.changes } : x)));
  };
  const fixByName = async (name: string) => {
    const f = await store.fileIn(name);
    if (!f) return setError(`${name} is not in the project folder any more.`);
    await loadFixFile(f);
  };
  const deleteFile = async (name: string) => {
    if (!window.confirm(`Delete ${name} from the project folder? This cannot be undone.`)) return;
    await store.remove(name);
    setFiles((l) => l.filter((f) => f.name !== name));
    if (fixFile?.file.name === name) setFixFile(null);
    setFilesVersion((v) => v + 1);
  };
  useEffect(() => {
    if (tab !== "export" || exportView !== "files" || !folder) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void loadFiles();
    });
    return () => {
      active = false;
    };
    // The list is reloaded when the view opens and whenever a file is written or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, exportView, folder, filesVersion]);
  const fixView: FixState | null = fixFile ? { name: fixFile.file.name, loudness: fixFile.loudness, target: fixTarget, gain: fixGain, setTarget: setFixTarget, run: () => void runFix(), done: fixed } : null;

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
    const ro = new ResizeObserver((entries) => {
      setTimelineWidth(Math.max(200, Math.round(entries[0].contentRect.width)));
      setScrollbarH(Math.max(0, el.offsetHeight - el.clientHeight));
    });
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
  /** Move the playhead without touching playback: a trim while playing carries on from the new place. */
  const seekTo = useCallback((t: number) => {
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
        const frame = await renderFrame({ project: view, getFile: (id) => store.getFile(id), logo, t, height: spec.height, type: spec.type, quality: spec.quality });
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
    [project, view, job, store, logo],
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
  /**
   * The Trim tab's actions, shared by its buttons and the Q, W, C, ⌫, J and bracket keys. Those that act at the playhead
   * take the clip under it; the rest take the selected clip. Each returns whether anything changed. The key handler reads
   * them through a ref so it need not re-bind on every selection change.
   */
  const atPlayhead = () => {
    const t = Math.min(playheadRef.current, Math.max(0, durationRef.current - 0.001));
    return { t, under: clipAt(project.clips, t) };
  };
  const trimActions = {
    trimStartHere: () => {
      const { under } = atPlayhead();
      // Less than a frame would remain: nothing to trim to.
      if (!under || clipLength({ ...under.clip, in: under.sourceTime }) < 1 / fpsRef.current - 1e-6) return false;
      setProject((p) => ({ ...p, clips: updateClip(p.clips, under.clip.id, { in: under.sourceTime }) }));
      // The frame under the playhead is now the clip's first; clips sit end to end, so it moved to the clip's start. Go there,
      // playing on if the preview was playing.
      seekTo(under.clip.start);
      return true;
    },
    trimEndHere: () => {
      const { under } = atPlayhead();
      if (!under || clipLength({ ...under.clip, out: under.sourceTime }) < 1 / fpsRef.current - 1e-6) return false;
      setProject((p) => ({ ...p, clips: updateClip(p.clips, under.clip.id, { out: under.sourceTime }) }));
      return true;
    },
    splitHere: () => {
      const { t, under } = atPlayhead();
      if (!under) return false;
      setProject((p) => ({ ...p, clips: splitClip(p.clips, under.clip.id, t) }));
      return true;
    },
    deleteSelected: () => {
      if (!selected) return false;
      const id = selected;
      setProject((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }));
      setSelected(null);
      return true;
    },
    mergeSelected: () => {
      if (!selected || !canMergeWithNext(project.clips, selected)) return false;
      const id = selected;
      setProject((p) => ({ ...p, clips: mergeWithNext(p.clips, id) }));
      return true;
    },
    unjoinSelected: () => {
      if (!selected || !project.clips.find((c) => c.id === selected)?.joinedToPrevious) return false;
      const id = selected;
      setProject((p) => ({ ...p, clips: unjoin(p.clips, id) }));
      return true;
    },
    moveSelected: (dir: -1 | 1) => {
      if (!selected) return false;
      const id = selected;
      const i = project.clips.findIndex((c) => c.id === id);
      if (i < 0 || (dir < 0 && i === 0) || (dir > 0 && i === project.clips.length - 1)) return false;
      setProject((p) => ({ ...p, clips: moveClip(p.clips, id, dir) }));
      return true;
    },
  };
  const trimActionsRef = useRef(trimActions);
  useEffect(() => {
    trimActionsRef.current = trimActions;
  });

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
      } else if ((e.key === "Delete" || e.key === "Backspace") && !inField(e) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!e.repeat) trimActionsRef.current.deleteSelected();
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
        if (e.key === "ArrowLeft") { if (e.altKey) windowActionsRef.current.jumpKey(-1); else stepTo(t - (e.shiftKey ? 1 : frame)); }
        else if (e.key === "ArrowRight") { if (e.altKey) windowActionsRef.current.jumpKey(1); else stepTo(t + (e.shiftKey ? 1 : frame)); }
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
        // Trimming: a held key must not keep cutting, so repeats are ignored.
        else if (e.key === "q" || e.key === "Q") { if (!e.repeat) trimActionsRef.current.trimStartHere(); }
        else if (e.key === "w" || e.key === "W") { if (!e.repeat) trimActionsRef.current.trimEndHere(); }
        else if (e.key === "c" || e.key === "C") { if (!e.repeat) trimActionsRef.current.splitHere(); }
        else if (e.key === "j" || e.key === "J") { if (!e.repeat) (e.shiftKey ? trimActionsRef.current.unjoinSelected : trimActionsRef.current.mergeSelected)(); }
        else if (e.key === "[" || e.key === "]") { if (!e.repeat) trimActionsRef.current.moveSelected(e.key === "[" ? -1 : 1); }
        else if (e.key === "l" || e.key === "L") { if (!e.repeat) setLoop((l) => !l); }
        else if (e.key === "i" || e.key === "I") { if (!e.repeat) shortActionsRef.current.markIn(); }
        else if (e.key === "o" || e.key === "O") { if (!e.repeat) shortActionsRef.current.markOut(); }
        else if (e.key === "n" || e.key === "N") { if (!e.repeat) shortActionsRef.current.newAt(); }
        else if (e.code === "Comma" || e.code === "Period") shortActionsRef.current.nudge(e.shiftKey ? "to" : "from", (e.altKey ? 1 : frame) * (e.code === "Comma" ? -1 : 1));
        else if (e.key === "k" || e.key === "K") { if (!e.repeat) (e.shiftKey ? windowActionsRef.current.removeKey : windowActionsRef.current.keyHere)(); }
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
      setReconnectable(await store.pendingHandles(p.id));
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
      void fillKeyframesRef.current(loaded.project);
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
        // Where its keyframes fall, so the export can copy whole groups of it as they are.
        const keys = await probeKeyframes(f).catch((e: unknown) => ({ times: [] as number[], note: e instanceof Error ? e.message : "the keyframes could not be read" }));
        refs.push({ id, name: f.name, size: f.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, codec: info.codec ?? undefined, hasAudio: info.hasAudio, sampleRate: info.sampleRate, rotation: info.rotation, ...(keys.times.length ? { keyframeTimes: keys.times } : { keyframeNote: keys.note ?? "no keyframes read" }), ...(where ? { where } : {}) });
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
      clips: [...p.clips, ...ordered.map((m): Clip => ({ id: newId(), media: m.id, in: 0, out: m.duration, transform: { ...NEUTRAL_TRANSFORM, crop: { ...NEUTRAL_TRANSFORM.crop } }, grade: { ...NEUTRAL_GRADE }, gainDb: soundLevels(p).camera, muted: false }))],
    }));
    void store.persistHandles(project.id);
    setFilesVersion((v) => v + 1);
    // Proxies in the background, one at a time.
    if (store.hasFolder) for (const m of ordered) await makeProxy(m, files.find((f) => f.name === m.name)!, previewRef.current);
  };

  /**
   * Recordings added before the editor read keyframes, or whose index could not be read then, get their keyframe
   * list and rotation filled in one at a time in the background, so the export can copy them as they are. No undo
   * step: nothing the user did changes, only what is known about the file.
   */
  const keyframeFill = useRef<Set<string>>(new Set());
  const fillKeyframes = async (p: Project) => {
    const patchMedia = (id: string, patch: Partial<MediaRef>) =>
      setProjectState((q) => {
        if (!q.media[id]) return q;
        const next = { ...q, media: { ...q.media, [id]: { ...q.media[id], ...patch } } };
        store.autosave(next);
        return next;
      });
    for (const m of Object.values(p.media)) {
      if (!m.width || m.keyframeTimes?.length || m.keyframeNote || keyframeFill.current.has(m.id)) continue;
      const f = await store.getFile(m.id);
      if (!f) continue;
      keyframeFill.current.add(m.id);
      try {
        const [info, keys] = await Promise.all([probe(f), probeKeyframes(f)]);
        patchMedia(m.id, { rotation: info.rotation, ...(keys.times.length ? { keyframeTimes: keys.times } : { keyframeNote: keys.note ?? "no keyframes read" }) });
      } catch (e) {
        patchMedia(m.id, { keyframeNote: e instanceof Error ? e.message : "the keyframes could not be read" });
      }
    }
  };
  const fillKeyframesRef = useRef(fillKeyframes);
  fillKeyframesRef.current = fillKeyframes;

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
    void fillKeyframesRef.current(project);
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

  /** Chrome hands back files outside the project folder only after a click: this click asks for all of them at once. */
  const reconnectFiles = async () => {
    await resolveMedia(project, true);
    const left = store.missing(Object.keys(project.media)).length;
    setStatus(left ? `${left} file${left === 1 ? " is" : "s are"} still missing — locate ${left === 1 ? "it" : "them"} by hand` : "Every file is back");
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
        setProject((p) => ({ ...p, media: { ...p.media, [id]: ref }, music: [...p.music, appendMusic(p.music, { id: newId(), media: id, lane: 0, in: 0, out: info.duration, gainDb: soundLevels(p).music, muted: false, fadeIn: 2, fadeOut: 3, keyframes: [] }, 2, timelineDuration(p))] }));
        await decodeMusic(id, f);
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "couldn't read the file."}`);
      }
    }
    // Remembered like recordings, so music outside the project folder comes back after a reload without asking.
    void store.persistHandles(project.id);
  };

  // The logo comes back with the project: once its file is at hand again, the bitmap is made anew.
  useEffect(() => {
    const id = project.watermark.media;
    if (!id || logo) return;
    let active = true;
    void store
      .getFile(id)
      .then((f) => f && createImageBitmap(f).then((bmp) => active && setLogo(bmp)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [project.watermark.media, logo, store, filesVersion]);
  const addLogo = async (h: File | FileSystemFileHandle) => {
    const id = newId();
    const f = h instanceof File ? h : await h.getFile();
    store.registerFile(id, h);
    const bmp = await createImageBitmap(f);
    setLogo(bmp);
    const where = (await store.whereIs(h)) ?? undefined;
    setProject((p) => ({ ...p, media: { ...p.media, [id]: { id, name: f.name, size: f.size, duration: 0, ...(where ? { where } : {}) } }, watermark: { ...p.watermark, media: id } }));
    void store.persistHandles(project.id);
  };
  /** The picker that hands back a handle, so the logo is remembered across reloads; the plain input otherwise. */
  const pickLogo = async () => {
    const picker = (window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
    if (!picker) return void logoInput.current?.click();
    try {
      const [h] = await picker({ multiple: false, types: [{ description: "Logo", accept: { "image/*": [".png", ".svg", ".webp"] } }] });
      if (h) await addLogo(h);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Preview: proxy video element (or source file when no proxy) drawn through the grader.
  const under = useMemo(() => clipAt(project.clips, Math.max(0, Math.min(playhead, Math.max(0, duration - 0.001)))), [project.clips, playhead, duration]);
  const underRef = useRef(under);
  useEffect(() => {
    underRef.current = under;
  }, [under]);
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
        // Right after a seek Chrome's clock can sit a few ms before the in-point (audio-frame alignment on a real device); the
        // clip's own span bounds the time, so the first clip never reads as negative and the player is never left without a clip.
        const t = Math.min(under.clip.end, Math.max(under.clip.start, under.clip.start + (v.currentTime - under.clip.in) / clipSpeed(under.clip)));
        const loopTo = loopSpanRef.current ? loopSpanRef.current.from : 0, loopEnd = loopSpanRef.current ? loopSpanRef.current.to : duration;
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
          // The composer is the export's: the frame's shape, the layout and each clip's window, from the proxy or the file.
          const composeFrame = pictureView ? "source" : previewFrame;
          const frameKey = `${w}x${h}:${composeFrame ?? "source"}:${layoutChoice(project.layout)}`;
          if (!graderRef.current || graderRef.current.key !== frameKey) graderRef.current = { key: frameKey, composer: new FrameComposer(w, h, composeFrame, project.layout) };
          const grader = graderRef.current.composer;
          grader.setCustomLut(customLut);
          if (fileLuts) for (const [k, l] of Object.entries(fileLuts)) if (l) grader.provideLut(k as LutKind, l);
          const ctx = c.getContext("2d")!;
          const alt = altRef.current;
          const tr = windows.length ? transitionAt(windows, playhead) : null;
          // Inside the intro the clips draw through the style's look, and its effects go on before the titles.
          const intro = introFrameAt(project, placed, playhead, tr);
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
                sc.a.getContext("2d")!.drawImage(grader.compose(v, gradeFor(under.clip), under.clip, under.sourceTime, v.videoWidth, v.videoHeight), 0, 0);
                sc.b.getContext("2d")!.drawImage(grader.compose(alt, gradeFor(other), other, want, alt.videoWidth, alt.videoHeight), 0, 0);
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
          if (!composed) ctx.drawImage(grader.compose(v, gradeFor(under.clip), under.clip, under.sourceTime, v.videoWidth, v.videoHeight), 0, 0);
          if (intro) {
            if (!fxScratchRef.current || fxScratchRef.current.w !== w || fxScratchRef.current.h !== h) fxScratchRef.current = { a: new OffscreenCanvas(w, h), b: new OffscreenCanvas(w, h), w, h };
            drawIntroFx(ctx, w, h, intro, project, fxScratchRef.current, introBlendAt(project, placed, tr, playhead));
          }
          if (!pictureView) drawOverlays(ctx as unknown as OffscreenCanvasRenderingContext2D, w, h, playhead, view, logo);
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
  }, [under, playhead, project, view, shortMode, pictureView, previewFrame, placed, logo, duration, windows, playing, rate, previewUrlFor, customLut, fileLuts]);

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
  /** In Short mode a new title belongs to the short and starts inside it. */
  const titleAt = () => (shortMode && activeShort ? Math.min(Math.max(playhead, activeShort.from), Math.max(activeShort.from, activeShort.to - 0.5)) : playhead);
  const tagForShort = (t: Title): Title => (shortMode && activeShort ? { ...t, short: activeShort.id } : t);
  const untag = (t: Title): Title => {
    const { short, ...rest } = t;
    void short;
    return rest;
  };
  const parseWordAt = (s: string) => {
    const list = s.split(/[\s,;]+/).map(Number).filter((v) => Number.isFinite(v) && v >= 0);
    return list.length ? list : undefined;
  };
  const addTitle = (kind: Title["kind"], text?: string, subtitle?: string) => {
    const t = tagForShort(newTitle(kind, kind === "intro" && !shortMode ? 0 : titleAt(), text ?? ( kind === "intro" ? project.name : kind === "lowerThird" ? "Location" : kind === "hook" ? "Wait for it" : kind === "caption" ? "Caption" : "Title"), subtitle ?? (kind === "intro" ? new Date().toLocaleDateString() : "")));
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
  const setCard = (patch: Partial<IntroCard>) => setIntro({ card: { ...project.intro.card, ...patch } });
  const introCard = cardSettings(project.intro.card);
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
  const thumbKey = introReg ? [...introReg.scenes, ...(introReg.card ? [introReg.card] : [])].map((c) => `${c.id}:${c.in.toFixed(2)}:${c.out.toFixed(2)}`).join("|") + `@${project.intro.style}@${JSON.stringify(project.intro.card)}@${project.intro.outro ?? "look"}@${project.name}` : "";
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
      save: () => store.save(project),
      reconnect: reconnectFiles,
      pendingHandles: () => store.pendingHandles(project.id),
      missing: () => store.missing(Object.keys(project.media)),
      getProject: () => project,
      frameAt: (t: number, height?: number) => renderFrame({ project: view, getFile: (id) => store.getFile(id), logo, t, height, type: "image/png" }).then((f) => f.blob),
      getShorts: () => project.shorts ?? [],
      getView: () => view,
      getSeam: () => seam,
      setMode,
      addShortAt,
      selectShort,
      exportShorts: (all: boolean) => startShortExport(all),
      findSeam,
      suggestShorts,
      saveShortCover,
      setWindowView: (v: boolean) => setWindowView(v),
      trackWindow: (how: "track" | "road") => trackWindow(how),
      getWindowRect: () => windowRect,
      windowKeys: () => under?.clip.reframe?.keys ?? [],
      analyseTrackBeats,
      getBeats: () => beats,
      cutShortToBeats,
      punchShort,
      slowShort,
      setSnapBeats: (v: boolean) => setSnapBeats(v),
      patchTitle,
      getPlayhead: () => playhead,
      stepTo,
      getDone: () => done,
      getFiles: () => files,
      isPlaying: () => playing,
      getReview: () => ({ open: reviewOpen, ticked, items: review.items.map((i) => ({ id: i.id, state: i.state, title: i.title, key: i.key })) }),
      timelineScroll: () => ({ left: timelineRef.current?.scrollLeft ?? 0, width: timelineRef.current?.clientWidth ?? 0, playheadPx: playheadRef.current * pxRef.current, following: followRef.current }),
      setTimelineScroll: (left: number) => { if (timelineRef.current) timelineRef.current.scrollLeft = left; },
      getEvents: () => events,
      getPreflight: () => checks,
      setExportView: (v: "setup" | "files") => setExportView(v),
      openSection: (id: string) => setOpenSections((o) => ({ ...o, [id]: true })),
      checkFile,
      loadFiles,
      setProject: (fn: (p: Project) => Project) => setProject(fn),
      traceFrames: (fn: ((timelineT: number) => void) | null) => {
        frameTrace = fn;
      },
      exportOptions: (o: Partial<typeof testExportOptions>) => {
        Object.assign(testExportOptions, o);
        testBytes.all = 0;
        testBytes.final = 0;
      },
      getJob: () => job,
      getResumable: () => resumable,
      measureMix,
      matchLevel,
      getLoudness: () => loudness,
      loadFixFile,
      runFix,
      getFixed: () => fixed,
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
    if (pauseRef.current.paused !== paused) logEvent(paused ? "pause" : "resume", paused ? "Paused" : "Resumed");
    pauseRef.current.paused = paused;
    if (!paused) {
      for (const w of pauseRef.current.waiters) w();
      pauseRef.current.waiters = [];
    }
    setJob((j) => (j ? { ...j, paused } : j));
  };
  /**
   * The drive refused a write: a writable that has refused once refuses for good, so the engine stops at the last
   * finished part once this returns (the kept parts carry the export on); this tells the user at once.
   */
  const onWriteBlocked = async (stop: SpaceStop) => {
    logEvent("space", `${stop.message} Stopping at the last finished part.`);
    alertUser("Drive full — export stopped", `${roomAdvice(stop.where, stop.need, stop.join)} Then press Resume.`);
  };
  /**
   * Export to the project folder. The video is written in parts (one every few minutes, plus whatever was done the
   * moment the export stops) that survive a failure or a cancel, then joined into the file; `resume` continues the
   * parts of an earlier stopped export of the same project.
   */
  // The editor's checklist: the project summarised item by item, ticked before the file is written. Ticks are kept per
  // project in this browser, keyed by each item's content, so a re-export after no change does not ask again.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [ticked, setTicked] = useState<Record<string, string>>({});
  const [framesSaved, setFramesSaved] = useState<boolean | null>(null);
  const reviewKey = `bench:video:review:${project.id}`;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        setTicked(JSON.parse(localStorage.getItem(reviewKey) ?? "{}") as Record<string, string>);
      } catch {
        setTicked({});
      }
    });
    return () => {
      active = false;
    };
  }, [reviewKey]);
  const saveTicks = (next: Record<string, string>) => {
    setTicked(next);
    try {
      localStorage.setItem(reviewKey, JSON.stringify(next));
    } catch {
      /* no storage */
    }
  };
  const review = useMemo(
    () => reviewProject(project, { loudness: loudness ? { integrated: loudness.result.integrated, peakDb: loudness.result.peakDb, stale: !loudness.predicted && loudness.fingerprint !== audioKey, predicted: !!loudness.predicted } : null, folderName: folder, fileName, framesSaved, doctorDepth: project.export.check ?? "full", outWidth: outW, outHeight: outH, estimateBytes: estimate.bytes, seconds: range ? range.to - range.from : duration }),
    [project, loudness, audioKey, folder, fileName, framesSaved, outW, outH, estimate.bytes, range, duration],
  );
  const refreshFramesSaved = async () => {
    if (!store.hasFolder) return setFramesSaved(null);
    try {
      const folders = await store.subFolders();
      setFramesSaved(folders.includes(FRAMES_DIR));
    } catch {
      setFramesSaved(null);
    }
  };
  /** Export, through the checklist unless it is off or already ticked for this state of the project. */
  /* ------------------------------------------------------------ the window's keys */
  /** One key written on a clip (and along its joined run): the key at that instant replaced, or added in order. */
  const writeWindowKey = (clipId: string, key: ReframeKey) => setProject((p) => ({ ...p, clips: updateClip(p.clips, clipId, { reframe: { keys: setKey(p.clips.find((c) => c.id === clipId)?.reframe?.keys, key) } }) }));
  const windowKeyHere = () => {
    if (!under || !framedPreview) return;
    writeWindowKey(under.clip.id, keyFor(under.clip.reframe?.keys, under.sourceTime));
  };
  const removeWindowKeyHere = () => {
    if (!under) return;
    const keys = removeKeyAt(under.clip.reframe?.keys, under.sourceTime);
    update(under.clip.id, { reframe: keys.length ? { keys } : undefined });
  };
  const jumpWindowKey = (dir: -1 | 1) => {
    if (!under) return;
    const k = keyAround(under.clip.reframe?.keys, under.sourceTime, dir);
    if (k) stepTo(under.clip.start + (k.t - under.clip.in) / clipSpeed(under.clip));
  };
  const windowActions = { keyHere: windowKeyHere, removeKey: removeWindowKeyHere, jumpKey: jumpWindowKey };
  useEffect(() => {
    windowActionsRef.current = windowActions;
  });
  /** A drag on the picture moves the window; a click centres it there; the key at the playhead takes the result. */
  const onWindowPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !under) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const key = keyFor(under.clip.reframe?.keys, under.sourceTime);
    windowDragRef.current = { startX: e.clientX, startY: e.clientY, key, clipId: under.clip.id, moved: false };
    setDragKey(key);
  };
  const onWindowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = windowDragRef.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - d.startX) / r.width, dy = (e.clientY - d.startY) / r.height;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
    d.moved = true;
    setDragKey(movedKey(d.key, dx, dy));
  };
  const onWindowPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = windowDragRef.current;
    if (!d) return;
    windowDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    if (d.moved) writeWindowKey(d.clipId, movedKey(d.key, (e.clientX - d.startX) / r.width, (e.clientY - d.startY) / r.height));
    else writeWindowKey(d.clipId, { ...d.key, cx: (e.clientX - r.left) / r.width, cy: (e.clientY - r.top) / r.height });
    setDragKey(null);
  };
  // The wheel zooms the window; a native listener, so the page does not scroll under it.
  useEffect(() => {
    const el = windowOverlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const u = underRef.current;
      if (!u) return;
      writeWindowKey(u.clip.id, zoomedKey(keyFor(u.clip.reframe?.keys, u.sourceTime), e.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureView, under]);
  const copyKeysToNext = () => {
    if (!current?.reframe?.keys.length) return;
    const i = placed.findIndex((c) => c.id === current.id);
    const next = placed[i + 1];
    if (!next) return;
    update(next.id, { reframe: { keys: carryKeys(current.reframe.keys, current.in, next.in, next.out) } });
    setStatus(`${current.reframe.keys.length} key${current.reframe.keys.length === 1 ? "" : "s"} carried to the next clip at the same offsets`);
  };
  /**
   * Keys written for the clip from the footage: Track puts the window on where the picture moves at each instant;
   * Road (experimental) on where the lane edges meet, falling back to the motion where it is unsure. The span is the
   * short's part of the clip in Short mode, else the whole clip; the keys are smoothed and thinned.
   */
  const trackWindow = async (how: "track" | "road") => {
    const clip = current;
    const pc = clip ? placed.find((c) => c.id === clip.id) : null;
    if (!clip || !pc || job) return;
    const speed = clipSpeed(clip);
    let from = clip.in, to = clip.out;
    if (shortMode && activeShort) {
      const a = Math.max(pc.start, activeShort.from), b = Math.min(pc.end, activeShort.to);
      if (b > a) {
        from = sourceTimeAt(pc, a);
        to = sourceTimeAt(pc, b);
      }
    }
    const step = Math.max(0.25, Math.min(1, (to - from) / 24));
    const times: number[] = [];
    for (let t = from; t <= to - step / 2; t += step) times.push(Math.round(t * 1e3) / 1e3);
    times.push(Math.round(Math.max(from, to - 0.15) * 1e3) / 1e3);
    const abort = new AbortController();
    setJob({ kind: "shorts", label: how === "road" ? "Following the road" : "Following the motion", fraction: 0, abort });
    try {
      const file = await fileForIntro(clip.media);
      if (!file) throw new Error("The recording is not at hand.");
      const motion = await scanMotionTrack(file, times, abort.signal);
      let samples = motion.map((m) => ({ t: m.t, cx: m.cx, cy: m.cy }));
      let sure = 0;
      if (how === "road") {
        const plain: Project = { ...landscape, export: { ...project.export, frame: "source" }, titles: [], watermark: { ...project.watermark, media: null } };
        const out: { t: number; cx: number; cy: number }[] = [];
        for (let i = 0; i < times.length; i++) {
          if (abort.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const t = times[i];
          const f = await renderFrame({ project: plain, getFile: fileForIntro, logo: null, t: pc.start + (t - clip.in) / speed, height: 180, type: "image/jpeg", quality: 0.85 });
          const bmp = await createImageBitmap(f.blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(bmp, 0, 0);
          const vp = vanishingPoint(greyOf(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height), c.width, c.height);
          const m = samples.find((x) => x.t === t) ?? { cx: 0.5, cy: 0.5 };
          if (vp.confidence >= ROAD_CONFIDENCE) {
            sure++;
            out.push({ t, cx: vp.x, cy: vp.y });
          } else out.push({ t, cx: m.cx, cy: m.cy });
          setJob((j) => (j ? { ...j, fraction: (i + 1) / times.length, message: `${i + 1} of ${times.length} frames` } : j));
        }
        samples = out;
      }
      const zoom = keyFor(clip.reframe?.keys, from).zoom;
      const keys = thinKeys(smoothKeys(keysFromSamples(samples, zoom), 2), 0.01);
      update(clip.id, { reframe: { keys } });
      setStatus(how === "road" ? `Road: ${sure} of ${times.length} frames showed the lane edges meeting; ${times.length - sure ? `the rest follow the motion; ` : ""}${keys.length} key${keys.length === 1 ? "" : "s"} written — Smooth or drag any of them` : `Track: the window follows where the picture moves, ${keys.length} key${keys.length === 1 ? "" : "s"} over ${(to - from).toFixed(1)} s`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };
  /* ------------------------------------------------------------ the beat */
  /** The track's beats from its samples: tempo, grid, downbeats, drop (beats.ts), kept on the track. */
  const analyseTrackBeats = async (id: string) => {
    const m = projectRef.current?.music.find((x) => x.id === id);
    if (!m || job) return;
    const file = await store.getFile(m.media);
    if (!file) return setError("The music file is not at hand — Locate it in the missing-files notice first.");
    const abort = new AbortController();
    setJob({ kind: "beats", label: "Listening for the beat", fraction: 0, abort });
    try {
      const { pcm, sampleRate } = await decodeMono(file, { signal: abort.signal, onProgress: (d, t) => setJob((j) => (j ? { ...j, fraction: d / Math.max(1, t) } : j)) });
      const grid = analyseBeats(pcm, sampleRate);
      updateMusic(id, { beats: grid });
      setStatus(`${grid.bpm} BPM, ${grid.beats.length} beats${grid.drop !== null ? `, the drop at ${fmtTime(grid.drop)} of the track` : ""} — ticks on the ruler, snapping on, cuts and punch-ins on the beat in the Shorts tab`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };
  /** The short's clips cut on every n-th beat inside it. */
  const cutShortToBeats = (every: 1 | 2 | 4) => {
    const x = activeShort;
    if (!x || !beats.length) return;
    const r = cutToBeats(project.clips, beats, x.from, x.to, every);
    setProject((p) => ({ ...p, clips: r.clips }));
    setStatus(r.cuts ? `${r.cuts} cut${r.cuts === 1 ? "" : "s"} on the beat inside ${x.name}` : "No beat falls inside the short's clips away from a cut");
  };
  /** A small zoom on every n-th beat inside the short, as window keys. */
  const punchShort = (every: 1 | 2 | 4) => {
    const x = activeShort;
    if (!x || !beats.length) return;
    const r = punchIns(project.clips, beats, x.from, x.to, every, beatPeriod(project.music) ?? 0.5);
    setProject((p) => ({ ...p, clips: r.clips }));
    setStatus(r.punches ? `${r.punches} punch-in${r.punches === 1 ? "" : "s"} on the beat inside ${x.name} — window keys, in the Crop tab` : "No beat inside the short");
  };
  /** The short's stretch at half speed: the timeline grows, the short and everything after it move with it. */
  const slowShort = () => {
    const x = activeShort;
    if (!x) return;
    const r = slowStretch(project.clips, x.from, x.to, 0.5);
    if (!r.added) return setStatus("Nothing to slow there");
    setProject((p) => ({
      ...p,
      clips: r.clips,
      shorts: (p.shorts ?? []).map((s) => (s.id === x.id ? { ...s, to: s.to + r.added } : s.from >= x.to - 1e-6 ? { ...s, from: s.from + r.added, to: s.to + r.added } : s)),
      titles: p.titles.map((t) => (t.short === x.id ? t : t.start >= x.to - 1e-6 ? { ...t, start: t.start + r.added } : t)),
    }));
    setStatus(`${x.name} plays at half speed: ${fmtTime(x.to - x.from)} of footage over ${fmtTime(x.to - x.from + r.added)}; the shorts after it moved on by ${r.added.toFixed(2)} s`);
  };
  /* ------------------------------------------------------------ Short mode: export, cover, seam, suggestions */
  /** One short's file into the shorts folder, then the doctor's quick look at it. */
  const exportShort = async (x: Short, index: number, noMusic: boolean, signal: AbortSignal) => {
    const derived = shortProject(projectRef.current ?? project, x);
    if (!derived.clips.length) throw new Error(`${x.name} covers no footage.`);
    const target = noMusic ? { ...derived, music: [] } : derived;
    const name = `${SHORTS_FOLDER}/${shortFileName(index, x, noMusic ? "no-music" : "")}`;
    const src = derived.media[derived.clips[0].media];
    const out = outputSize(src?.width || 3840, src?.height || 2160, derived.export);
    const seconds = shortTimelineDuration(derived);
    const output = { name, codec: derived.export.codec.toUpperCase(), width: out.width, height: out.height, bitrateMbps: derived.export.bitrateMbps, preset: derived.export.preset, estimatedBytes: shortBytes(derived, seconds) };
    setJob((j) => (j ? { ...j, label: `Exporting ${name}`, fraction: 0, output } : j));
    setEvents([{ at: Date.now(), kind: "start", text: `Started ${name} — ${output.codec} ${out.width}×${out.height} at ${derived.export.bitrateMbps} Mbps, ${fmtTime(seconds)}` }]);
    const { writable, handle } = await store.createWritable(name);
    const result = await exportProject({
      project: target,
      getFile: (id) => store.getFile(id),
      logo,
      writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
      signal,
      onProgress: (progress) => {
        setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j));
        lastProgress.current = progress;
      },
      onPreview: drawLive,
      onEvent: (ev) => setEvents((l) => [...l, ev]),
      onFault: async (fault) => {
        setEvents((l) => [...l, { at: Date.now(), kind: "fault", text: `${fault.message} — skipped` }]);
        return "skip";
      },
    });
    const file = await handle.getFile();
    setDone({ kind: "done", at: Date.now(), name, folder: folder ? `${folder}/${SHORTS_FOLDER}` : null, seconds, bytes: file.size, activeMs: result.activeMs, pausedMs: result.pausedMs, estimatedMs: 0, codec: output.codec, width: out.width, height: out.height, bitrateMbps: derived.export.bitrateMbps, audioKbps: derived.export.audioBitrateKbps, parts: 1, resumedFrom: 0, steps: lastProgress.current?.steps ?? [], events: [...eventsRef.current], skipped: result.skipped, checking: { stage: "Reading the index", fraction: 0 } });
    setShorts((l) => l.map((y) => (y.id === x.id ? { ...y, exported: { name, bytes: file.size, at: Date.now() } } : y)));
    await store.writeText(`${SHORTS_FOLDER}/${shortFileName(index, x, "post")}`, shortPostText(derived, x.targets, index, (projectRef.current?.shorts ?? []).length, seconds));
    setFilesVersion((v) => v + 1);
    await checkWritten(name, "quick");
    return file;
  };
  /** The short being worked on, or every short in a row — each with a version without music when asked. */
  const startShortExport = async (all: boolean) => {
    if (job) return;
    if (!store.hasFolder) return setError("Pick a project folder first — the shorts are written into its shorts folder.");
    const list = all ? shorts : activeShort ? [activeShort] : [];
    if (!list.length) return setError("No short to export — press N to start one at the playhead.");
    const abort = new AbortController();
    setDone(null);
    setJob({ kind: "export", label: all ? `Exporting ${list.length} shorts` : "Exporting the short", fraction: 0, abort, output: { name: "", codec: "", width: 0, height: 0, bitrateMbps: 0, preset: "balanced", estimatedBytes: 0 }, paused: false, partsMode: false, resumedFrom: 0 });
    setPlaying(false);
    setError(null);
    let made = 0;
    try {
      for (const x of list) {
        if (abort.signal.aborted) break;
        const index = shorts.indexOf(x) + 1;
        await exportShort(x, index, false, abort.signal);
        if (withoutMusic && projectRef.current?.music.length) await exportShort(x, index, true, abort.signal);
        made++;
      }
      setStatus(made === 1 && !all ? `Exported ${shortFileName(shorts.indexOf(list[0]) + 1, list[0])} into ${SHORTS_FOLDER}/` : `${made} short${made === 1 ? "" : "s"} exported into ${SHORTS_FOLDER}/`);
      notifyDone(all ? "Shorts exported" : "Short exported", `${made} file${made === 1 ? "" : "s"} in ${SHORTS_FOLDER}/`, lastProgress.current ?? undefined);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") setStatus(`Export stopped after ${made} short${made === 1 ? "" : "s"}`);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      document.title = pageTitleRef.current;
      setJob(null);
    }
  };
  /** The frame at the playhead as the short's 1080×1920 cover, beside its export. */
  const saveShortCover = async () => {
    if (!activeShort || job || !store.hasFolder) return;
    const abort = new AbortController();
    setJob({ kind: "frame", label: "Saving the cover", fraction: 0.5, abort });
    try {
      const derived = shortProject(project, activeShort);
      const t = Math.max(0, Math.min(activeShort.to - activeShort.from, playhead - activeShort.from));
      const frame = await renderFrame({ project: derived, getFile: (id) => store.getFile(id), logo, t, height: 1920, type: "image/jpeg", quality: 0.92 });
      const src = derived.media[derived.clips[0]?.media ?? ""];
      const want = src?.width && src.height ? outputSize(src.width, src.height, { resolution: 1080, frame: "9:16" }) : { width: frame.width, height: frame.height };
      let blob = frame.blob;
      if (frame.width !== want.width || frame.height !== want.height) {
        const bmp = await createImageBitmap(frame.blob);
        const c = new OffscreenCanvas(want.width, want.height);
        c.getContext("2d")!.drawImage(bmp, 0, 0, want.width, want.height);
        blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      }
      const name = `${SHORTS_FOLDER}/${shortFileName(shortIndex, activeShort, "cover")}`;
      const { writable } = await store.createWritable(name);
      await writable.write(blob);
      await writable.close();
      updateShort(activeShort.id, { cover: playhead });
      setStatus(`Cover saved: ${name}, ${want.width}×${want.height}, from ${fmtTime(playhead)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };
  /** A small graded frame of the view at a timeline instant, as pixels and as a thumbnail. */
  const seamFrame = async (t: number) => {
    const f = await renderFrame({ project: viewFor(project, activeShort), getFile: fileForIntro, logo: null, t, height: 96, type: "image/jpeg", quality: 0.8 });
    const bmp = await createImageBitmap(f.blob);
    const c = new OffscreenCanvas(36, 64);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, 36, 64);
    return { pixels: ctx.getImageData(0, 0, 36, 64).data, thumb: URL.createObjectURL(f.blob) };
  };
  /**
   * The loop's seam: how the last frame meets the first, and the frame in the last second that meets it best — the
   * end moves there when it is a better match than the end there is.
   */
  const findSeam = async () => {
    const x = activeShort;
    if (!x || job) return;
    const fps = fpsRef.current;
    setSeam({ shortId: x.id, lastThumb: null, firstThumb: null, score: null, scanning: true });
    try {
      const first = await seamFrame(x.from);
      const last = await seamFrame(Math.max(x.from, x.to - 1 / fps));
      const now = seamScore(last.pixels, first.pixels);
      setSeam({ shortId: x.id, lastThumb: last.thumb, firstThumb: first.thumb, score: now, scanning: true });
      let best = { t: x.to, score: now, thumb: last.thumb };
      for (const t of seamCandidates(x.from, x.to, fps, 1)) {
        if (Math.abs(t - x.to) < 1e-6) continue;
        const f = await seamFrame(Math.max(x.from, t - 1 / fps));
        const score = seamScore(f.pixels, first.pixels);
        if (score < best.score - 0.005) best = { t, score, thumb: f.thumb };
      }
      if (best.t !== x.to) {
        updateShort(x.id, { to: best.t });
        setSeam({ shortId: x.id, lastThumb: best.thumb, firstThumb: first.thumb, score: best.score, movedFrom: x.to, scanning: false });
        setStatus(`The end moved from ${fmtTime(x.to, fps)} to ${fmtTime(best.t, fps)}: the seam is ${Math.round(best.score * 100)}% apart instead of ${Math.round(now * 100)}%`);
      } else {
        setSeam({ shortId: x.id, lastThumb: last.thumb, firstThumb: first.thumb, score: now, movedFrom: null, scanning: false });
        setStatus(`The end stays: no frame in the last second meets the first better (${Math.round(now * 100)}% apart)`);
      }
    } catch (e) {
      setSeam(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** Shorts across the whole drive: the timeline in equal stretches, each short on the liveliest moment of its stretch. */
  const suggestShorts = async (count: number, seconds: number) => {
    if (job || !placed.length) return;
    const abort = new AbortController();
    setJob({ kind: "shorts", label: `Looking for ${count} short${count === 1 ? "" : "s"}`, fraction: 0, abort });
    try {
      const windows = suggestWindows(project, count, seconds);
      let picks = windows.map((w) => ({ stretch: w.stretch, moment: w.candidates[Math.floor(w.candidates.length / 2)] }));
      try {
        const stats = await scanMoments(fileForIntro, project, windows.map((w) => w.candidates), { signal: abort.signal, onProgress: (d, t) => setJob((j) => (j ? { ...j, fraction: d / Math.max(1, t), message: `${d} of ${t} moments looked at` } : j)) });
        const scored = scoreShortMoments(windows.map((w) => w.candidates), stats);
        picks = windows.map((w, i) => ({ stretch: w.stretch, moment: scored[i]?.reduce((best, m) => ((m.score ?? 0) > (best.score ?? 0) ? m : best)) ?? picks[i].moment }));
      } catch (e) {
        if ((e as DOMException).name === "AbortError") throw e;
        setStatus("Couldn't look at the footage; the shorts are spaced evenly instead.");
      }
      const made = shortsFromMoments(picks, seconds, shorts.length);
      setProject((p) => ({ ...p, mode: "short", shorts: [...(p.shorts ?? []), ...made] }));
      if (made[0]) {
        setCurrentShort(made[0].id);
        stepTo(made[0].from);
      }
      setTab("shorts");
      setStatus(`${made.length} short${made.length === 1 ? "" : "s"} suggested, ${seconds} s each, on the liveliest moment of each stretch — trim, loop and export them from the Shorts tab`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };
  const copyShortPost = async () => {
    if (!activeShort) return;
    const derived = shortProject(project, activeShort);
    const text = shortPostText(derived, activeShort.targets, shortIndex, shorts.length, shortTimelineDuration(derived));
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Post text copied: the title, description and hashtags");
    } catch {
      setError("The browser would not copy — open Post text below and copy it by hand.");
    }
  };
  const onShortAction = (id: string) => {
    if (/hook|caption|title/.test(id)) {
      setTab("titles");
      addTitle("hook");
    } else if (/length|shorten/.test(id) && activeShort) shortLength(Math.min(activeShort.to - activeShort.from, 60));
    else setStatus("Change it in the Shorts tab, then export again.");
  };
  const shortPreflight = useMemo(() => {
    if (!activeShort || !shortMode) return [];
    const derived = shortProject(project, activeShort);
    return derived.clips.length ? shortChecks(derived, activeShort.targets, fps) : [];
  }, [project, activeShort, shortMode, fps]);
  const shortPost = useMemo(() => {
    if (!activeShort) return "";
    const derived = shortProject(project, activeShort);
    return shortPostText(derived, activeShort.targets, shortIndex, shorts.length, shortTimelineDuration(derived));
  }, [project, activeShort, shortIndex, shorts.length]);
  const startExport = () => {
    if ((project.export.review ?? "on") === "off" || allTicked(review, ticked)) return void runExport();
    void refreshFramesSaved();
    setReviewOpen(true);
  };
  const onReviewAction = (id: string) => {
    setReviewOpen(false);
    if (id.startsWith("tab:")) setTab(id.slice(4) as Tab);
    else if (id.startsWith("section:")) {
      setTab("export");
      setExportView("setup");
      setOpenSections((o) => ({ ...o, [id.slice(8)]: true }));
    } else if (id === "save-frame") void saveFrame("thumb").then(() => refreshFramesSaved());
    else if (id === "measure") {
      setTab("export");
      setExportView("setup");
      setOpenSections((o) => ({ ...o, sound: true }));
      void measureMix();
    } else if (id === "scan-stops") setTab("trim");
  };
  useEffect(() => {
    if (!reviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewOpen]);

  const runExport = async (resume: { manifest: ExportManifest; folder: string } | null = null) => {
    if (!store.hasFolder) return setError("Pick a project folder first — the export is written there.");
    if (notify && "Notification" in window && Notification.permission === "default") void Notification.requestPermission().then((perm) => setNotifyPermission(perm));
    const name = resume ? resume.manifest.name : fileName;
    const partsFolder = resume ? resume.folder : `${name.replace(/\.mp4$/, "")}.parts`;
    const exportSeconds = range ? range.to - range.from : duration;
    const manifest: ExportManifest = resume ? resume.manifest : { version: 1, fingerprint, name, total: exportSeconds, parts: [], skipped: [], updatedAt: 0 };
    const live = manifest.parts.filter((p) => !p.consumed);
    const covered = live.reduce((a, p) => a + (p.end - p.start), 0);
    const resumedFrom = live.length ? Math.max(...live.map((p) => p.end)) : 0;
    notifyAt.current = 0;
    const abort = new AbortController();
    pauseRef.current = { paused: false, waiters: [] };
    autoSkipRef.current = false;
    let joinSeen: JoinInfo | undefined;
    const output = { name, codec: project.export.codec.toUpperCase(), width: outW, height: outH, bitrateMbps: project.export.bitrateMbps, preset: project.export.preset, estimatedBytes: estimate.bytes };
    const profile = speedProfile;
    const partStore: PartStore = {
      createWritable: async (file) => testWritable((await store.createWritable(file, partsFolder)).writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>),
      file: (file) => store.fileIn(file, partsFolder),
      remove: (file) => store.remove(file, partsFolder),
      save: (m) => store.writeText("resume.json", JSON.stringify(m), partsFolder),
    };
    setJob({ kind: "export", label: resumedFrom ? `Resuming from ${fmtTime(resumedFrom)}` : "Exporting", fraction: 0, abort, output, paused: false, partsMode: true, resumedFrom });
    setPlaying(false);
    setDone(null);
    setLiveAt(null);
    setSkipped(manifest.skipped.map((k) => ({ from: k.from, to: k.to })));
    setEvents([{ at: Date.now(), kind: "start", text: resumedFrom ? `Resuming ${name} from ${fmtTime(resumedFrom)} — ${live.length} finished part${live.length === 1 ? "" : "s"} kept` : `Started ${name} — ${output.codec} ${outW}×${outH} at ${output.bitrateMbps} Mbps, about ${fmtBytes(estimate.bytes)}` }]);
    setError(null);
    setResumable(null);
    try {
      const { writable } = await store.createWritable(name);
      const result = await exportProject({
        project: landscape,
        getFile: (id) => store.getFile(id),
        logo,
        writable: testWritable(writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, true),
        signal: abort.signal,
        priors: loadPriors(profile, `${outH}p ${project.export.codec.toUpperCase()}`),
        whilePaused: () => (pauseRef.current.paused ? new Promise<void>((r) => pauseRef.current.waiters.push(r)) : undefined),
        onWriteBlocked,
        onFrame: (t) => frameTrace?.(t),
        onPreview: drawLive,
        onEvent: (ev) => setEvents((l) => [...l, ev]),
        parts: testExportOptions.noParts
          ? undefined
          : {
              store: partStore,
              manifest,
              seconds: testExportOptions.partSeconds,
              onJoin: (join) => {
                joinSeen = join;
                setJob((j) => (j ? { ...j, join } : j));
              },
              testJoinMode: testExportOptions.joinMode,
              testFailJoinAfter: testExportOptions.failJoinAfter,
            },
        onFault: askAboutFault,
        onProgress: (progress) => {
          setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j));
          document.title = `${(progress.fraction * 100).toFixed(1)}% · ${progress.paused ? "Paused" : "Exporting"} · Bench`;
          lastProgress.current = progress;
          maybeNotify(`Exporting ${name}`, progress);
        },
      });
      // The parts are inside the file now.
      await store.remove(null, partsFolder);
      setResumable(null);
      notifyDone("Export finished", `${name} — ${fmtBytes(result.bytesWritten)} in ${fmtDuration(result.activeMs)}`, lastProgress.current ?? undefined);
      savePriors(profile, result.measured);
      setDone({ kind: "done", at: Date.now(), name, folder, seconds: result.seconds, bytes: result.bytesWritten, activeMs: result.activeMs, pausedMs: result.pausedMs, estimatedMs: estimate.wallSeconds * 1000, codec: output.codec, width: outW, height: outH, bitrateMbps: output.bitrateMbps, audioKbps: project.export.audioBitrateKbps, parts: result.parts, resumedFrom: result.resumedFrom, joinMode: result.join?.mode, join: result.join, steps: lastProgress.current?.steps ?? [], events: [...eventsRef.current], skipped: result.skipped, copiedSeconds: result.copiedSeconds, descriptions: result.descriptions, checking: (project.export.check ?? "full") === "off" ? null : { stage: "Reading the index", fraction: 0 } });
      void checkWritten(name);
      setFilesVersion((v) => v + 1);
      const stepMs = (kind: StepProgress["kind"]) => result.steps.filter((s) => s.kind === kind).reduce((a, s) => a + s.elapsedMs, 0);
      const skippedNote = result.skipped.length
        ? ` · ${result.skipped.length} stretch${result.skipped.length === 1 ? "" : "es"} skipped (${result.skipped.reduce((a, k) => a + (k.to - k.from), 0).toFixed(2)} s in all, at ${result.skipped.map((k) => fmtTime(k.from)).join(", ")})`
        : "";
      const joinNote = result.join?.mode === "remove" ? ", each removed as it went in" : "";
      const redone = covered > 0 && !result.resumedFrom ? `${fmtTime(Math.max(0, Math.round(exportSeconds - covered)))} exported again; ` : "";
      const howNote = result.resumedFrom ? ` (resumed from ${fmtTime(result.resumedFrom)}; ${result.parts} parts joined${joinNote})` : result.parts > 1 ? ` (${redone}${result.parts} parts joined${joinNote})` : "";
      setStatus(
        `Exported ${name}${howNote} — ${fmtBytes(result.bytesWritten)} in ${fmtDuration(result.activeMs)}${result.copiedSeconds > 0 ? ` (${fmtTime(result.copiedSeconds)} copied as is)` : ""}${result.pausedMs > 500 ? ` plus ${fmtDuration(result.pausedMs)} paused` : ""} (${(result.seconds / Math.max(0.001, result.activeMs / 1000)).toFixed(2)}× realtime) · prepare ${fmtDuration(stepMs("prepare"))} · video ${fmtDuration(stepMs("video"))} · audio ${fmtDuration(stepMs("audio"))} · finish ${fmtDuration(stepMs("finalize"))}${skippedNote}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const keptParts = manifest.parts.filter((p) => !p.consumed);
      const kept = keptParts.length ? Math.max(...keptParts.map((p) => p.end)) : 0;
      const consumed = manifest.parts.length - keptParts.length;
      const parts = `${keptParts.length} part${keptParts.length === 1 ? "" : "s"}${consumed ? `; ${consumed} already joined into the unfinished file will be exported again` : ""}`;
      const aborted = (e as DOMException).name === "AbortError";
      // The drive refused a write: the engine says where (a part, the join, the file) and what room that step wants.
      const stop = e instanceof SpaceStop ? e : !aborted && isSpaceError(e) ? new SpaceStop(testExportOptions.noParts ? "file" : "part", null, e) : null;
      const space = stop ? { where: stop.where, need: stop.need ?? (stop.where === "file" ? estimate.bytes : stop.where === "part" ? partNeed(project.export.bitrateMbps, testExportOptions.partSeconds ?? PART_SECONDS) : null), mode: stop.join?.mode, consumed } : undefined;
      if (!aborted || kept > 0) {
        const p = lastProgress.current;
        setDone({ kind: aborted || (stop && kept > 0) ? "stopped" : "failed", at: Date.now(), name, folder, seconds: exportSeconds, bytes: p?.bytesWritten ?? 0, activeMs: p?.elapsedMs ?? 0, pausedMs: p?.pausedMs ?? 0, estimatedMs: estimate.wallSeconds * 1000, codec: output.codec, width: outW, height: outH, bitrateMbps: output.bitrateMbps, audioKbps: project.export.audioBitrateKbps, parts: keptParts.length, resumedFrom, joinMode: joinSeen?.mode, join: joinSeen, steps: p?.steps ?? [], events: [...eventsRef.current], skipped: manifest.skipped, message: aborted ? "Stopped on request." : message, keptAt: kept, keptParts: keptParts.length, space });
      }
      if (stop && space) {
        const advice = roomAdvice(space.where, space.need, stop.join);
        const again = consumed ? ` (the ${consumed} part${consumed === 1 ? "" : "s"} already in the unfinished file ${consumed === 1 ? "is" : "are"} exported again)` : "";
        setStatus(
          stop.where === "join"
            ? `Export encoded to the end, but joining the ${manifest.parts.length} parts into the file failed: the drive refused a write. ${advice} Then press Resume — the join starts over and nothing else is encoded again${again}.`
            : kept > 0
              ? `Export stopped at ${fmtTime(kept)} of ${fmtTime(exportSeconds)}: the drive refused a write. ${parts} kept. ${advice} Then press Resume.`
              : `Export failed: the drive refused a write and nothing was finished yet. ${advice} Then export again.`,
        );
        notifyDone(kept > 0 ? "Drive full — export stopped" : "Drive full — export failed", advice, lastProgress.current ?? undefined);
      } else if (aborted) {
        setStatus(kept > 0 ? `Export stopped at ${fmtTime(kept)} of ${fmtTime(exportSeconds)} — ${parts} kept. Resume continues from there; Discard removes them.` : "Export cancelled.");
      } else {
        setError(kept > 0 ? `Export stopped at ${fmtTime(kept)} of ${fmtTime(exportSeconds)}: ${message} Everything finished so far is kept (${parts}); press Resume to carry on from there.` : `Export failed: ${message}`);
        notifyDone("Export stopped", kept > 0 ? `${message} Finished parts are kept — resume from ${fmtTime(kept)}.` : message, lastProgress.current ?? undefined);
      }
      await loadResumable();
    } finally {
      document.title = pageTitleRef.current;
      setJob(null);
    }
  };
  /** Once the user says "skip any that fail", the rest of this export skips without asking. */
  const autoSkipRef = useRef(false);
  const askAboutFault = (fault: ExportFault): Promise<"skip" | "stop"> => {
    if (autoSkipRef.current) return Promise.resolve("skip");
    alertUser("A frame failed — the export is waiting", `${fault.clipName} at ${fmtTime(fault.timelineT)}: ${fault.message}`);
    logEvent("fault", `A frame failed at ${fmtTime(fault.timelineT)} — ${fault.clipName}: ${fault.message}`);
    return new Promise((resolve) => {
      setJob((j) =>
        j
          ? {
              ...j,
              fault: {
                fault,
                resolve: (answer, all) => {
                  if (all) autoSkipRef.current = true;
                  if (answer === "skip") {
                    const from = fault.timelineT - (rangeRef.current?.from ?? 0);
                    setSkipped((list) => [...list, { from, to: from + fault.stretch }]);
                  }
                  setJob((k) => (k ? { ...k, fault: undefined } : k));
                  resolve(answer);
                },
              },
            }
          : j,
      );
    });
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
    const outH = Math.min(opts.height, firstMedia?.height ?? opts.height);
    const outW = firstMedia?.width && firstMedia.height ? Math.round((firstMedia.width * (outH / firstMedia.height)) / 2) * 2 : Math.round((outH * 16) / 9);
    const bitrateMbps = Math.max(1, Math.round(outH / 90));
    const seconds = scope ? scope.to - scope.from : duration;
    const preview: Project = { ...landscape, export: { ...project.export, resolution: outH, codec: "avc", bitrateMbps, preset: "fast", smartCopy: false, range: scope } };
    const name = `preview-${outH}p.mp4`;
    setJob({ kind: "export", label: "Test render", fraction: 0, abort, output: { name, codec: "AVC", width: outW, height: outH, bitrateMbps, preset: "fast", estimatedBytes: (bitrateMbps * 1e6 * seconds) / 8 }, paused: false });
    setPlaying(false);
    setLiveAt(null);
    setSkipped([]);
    setEvents([{ at: Date.now(), kind: "start", text: `Test render of ${scope ? `${fmtTime(scope.from)} → ${fmtTime(scope.to)}` : "the whole timeline"} at ${outH}p` }]);
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
        onPreview: drawLive,
        onProgress: (progress) => {
          setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j));
          document.title = `${(progress.fraction * 100).toFixed(1)}% · Test render · Bench`;
          lastProgress.current = progress;
          maybeNotify("Rendering preview", progress);
        },
      });
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
  /** The analysed music's beats as timeline instants; the ruler shows them when they are at least six pixels apart, else the downbeats. */
  const beats = useMemo(() => timelineBeats(project.music, duration), [project.music, duration]);
  const beatTicks = useMemo(() => {
    const period = beatPeriod(project.music);
    if (!period) return [] as number[];
    if (period * pxPerSec >= 6) return beats;
    if (period * 4 * pxPerSec >= 6) return timelineBeats(project.music, duration, true);
    return [] as number[];
  }, [project.music, duration, pxPerSec, beats]);
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
      let snapped = false;
      for (const c of visibleCuts(placed)) {
        if (Math.abs(c - t) * pxPerSec <= SNAP_PX) {
          t = c;
          snapped = true;
          break;
        }
      }
      if (!snapped && snapBeats && beats.length) {
        const b = nearestBeat(beats, t, SNAP_PX / pxPerSec);
        if (b !== null) t = b;
      }
    }
    return t;
  };
  /**
   * The time under the pointer: the clock while hovering; while the pointer is held, plain seconds (3600s, 12.5s) in
   * the unit the title, music and range fields take, so a time can be read straight off the timeline and typed in.
   */
  const showHoverTime = (t: number) => {
    const el = hoverLabelRef.current;
    if (!el) return;
    const held = !!scrubRef.current;
    el.textContent = held ? `${Math.round(t * 100) / 100}s` : fmtTime(t);
    el.dataset.held = held ? "true" : "false";
  };
  const onTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    scrubRef.current = { pointerId: e.pointerId };
    const t = timeAtPointer(el, e.clientX, !e.altKey);
    setPlayhead(t);
    setSeekToken((x) => x + 1);
    showHoverTime(t);
  };
  const onTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const t = timeAtPointer(el, e.clientX, !e.altKey);
    if (scrubRef.current) setPlayhead(t);
    if (hoverLineRef.current) {
      hoverLineRef.current.style.left = `${t * pxPerSec}px`;
      hoverLineRef.current.style.display = clipDragRef.current?.moved ? "none" : "block";
    }
    showHoverTime(t);
  };
  /* The shorts lane: a short is dragged to move it, its edges to trim it; the empty lane draws a new one. */
  const shortDragRef = useRef<{ id: string | null; kind: "move" | "from" | "to" | "draw"; startT: number; from: number; to: number; moved: boolean } | null>(null);
  const onShortsLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !timelineRef.current) return;
    e.stopPropagation();
    const t = timeAtPointer(timelineRef.current, e.clientX, !e.altKey);
    const target = e.target as HTMLElement;
    const id = (target.closest("[data-short-span]") as HTMLElement | null)?.dataset.shortSpan ?? null;
    const handle = target.dataset.shortHandle as "from" | "to" | undefined;
    const x = id ? shorts.find((y) => y.id === id) : null;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (x) {
      shortDragRef.current = { id: x.id, kind: handle ?? "move", startT: t, from: x.from, to: x.to, moved: false };
      selectShort(x.id, false);
    } else shortDragRef.current = { id: null, kind: "draw", startT: t, from: t, to: t, moved: false };
  };
  const onShortsLanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = shortDragRef.current;
    if (!d || !timelineRef.current) return;
    const t = timeAtPointer(timelineRef.current, e.clientX, !e.altKey);
    const delta = t - d.startT;
    if (!d.moved && Math.abs(delta) * pxPerSec < 3) return;
    d.moved = true;
    const total = durationRef.current;
    if (d.kind === "draw") {
      const from = Math.min(d.startT, t), to = Math.max(d.startT, t);
      if (!d.id) {
        if (to - from < MIN_SHORT_SECONDS) return;
        d.id = addShortAt(from, to).id;
      } else updateShort(d.id, { from, to });
    } else if (d.kind === "move") {
      const len = d.to - d.from, from = Math.max(0, Math.min(total - len, d.from + delta));
      updateShort(d.id!, { from, to: from + len });
    } else if (d.kind === "from") updateShort(d.id!, { from: Math.min(d.to - MIN_SHORT_SECONDS, Math.max(0, d.from + delta)) });
    else updateShort(d.id!, { to: Math.max(d.from + MIN_SHORT_SECONDS, Math.min(total, d.to + delta)) });
    showHoverTime(t);
  };
  const onShortsLanePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = shortDragRef.current;
    if (!d) return;
    shortDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved && d.id) selectShort(d.id, true);
  };
  const onTimelinePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubRef.current) return;
    scrubRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setSeekToken((x) => x + 1);
    showHoverTime(timeAtPointer(e.currentTarget, e.clientX, !e.altKey));
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
  // While playing, the view follows the playhead: when it runs off the right edge the timeline scrolls on — unless the
  // user scrolled the timeline by hand, which stops the following until play or pause brings the playhead back.
  const followRef = useRef(true);
  // Where the editor itself last scrolled the lane to: a scroll event landing there is the editor's own, anything
  // else is the user's hand (a counter would drift when the browser merges two of our scrolls into one event).
  const ownTargetRef = useRef<number | null>(null);
  const scrollTimelineTo = useCallback((left: number) => {
    const el = timelineRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth));
    if (Math.abs(el.scrollLeft - next) < 1) return;
    ownTargetRef.current = next;
    el.scrollLeft = next;
  }, []);
  const onTimelineScroll = () => {
    const el = timelineRef.current;
    if (!el) return;
    if (ownTargetRef.current !== null && Math.abs(el.scrollLeft - ownTargetRef.current) < 1.5) {
      ownTargetRef.current = null;
      return;
    }
    ownTargetRef.current = null;
    if (playingRef.current) followRef.current = false;
  };
  useEffect(() => {
    if (!playing || scrubRef.current || !followRef.current) return;
    const el = timelineRef.current;
    if (!el) return;
    const px = playhead * pxPerSec, view = el.clientWidth;
    if (px < el.scrollLeft || px > el.scrollLeft + view - 24) scrollTimelineTo(px - view * 0.2);
  }, [playhead, playing, pxPerSec, scrollTimelineTo]);
  // Play or pause: follow again, and bring the playhead into view if it is off screen.
  useEffect(() => {
    followRef.current = true;
    const el = timelineRef.current;
    if (!el) return;
    const px = playheadRef.current * pxRef.current, view = el.clientWidth;
    if (px < el.scrollLeft + 8 || px > el.scrollLeft + view - 8) scrollTimelineTo(px - view * 0.3);
  }, [playing, scrollTimelineTo]);
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
  const sourceAspect = first?.width && first.height ? first.width / first.height : 16 / 9;
  // The preview takes the export frame's shape, so a vertical cut is seen as it will come out.
  const underMedia = under ? project.media[under.clip.media] : null;
  const previewAspect = pictureView && under && underMedia?.width && underMedia.height ? pictureAspect(under.clip.transform, underMedia.width, underMedia.height) : frameAspect(previewFrame, first?.width || 16, first?.height || 9);
  /** The window on the clip under the playhead, as fractions of its picture: the overlay of the picture view (a drag shows where it is going). */
  const windowRect = useMemo(() => {
    if (!under || !framedPreview || !underMedia?.width || !underMedia.height) return null;
    const key = dragKey ?? reframeAt(under.clip.reframe?.keys, under.sourceTime);
    return windowInPicture(under.clip.transform.crop, key, frameAspect(previewFrame, underMedia.width, underMedia.height), underMedia.width, underMedia.height, under.clip.transform.rotate % 2 === 1);
  }, [under, framedPreview, underMedia, dragKey, previewFrame]);
  const thumbH = Math.min(THUMB_HEIGHT, first?.height ?? THUMB_HEIGHT);
  const thumbSize = `${Math.round((sourceAspect * thumbH) / 2) * 2}×${thumbH}`;

  // The timeline panel, rendered under the row or alone while an export runs.
  // The lanes share the panel's height by flex: the video lane three parts, each title row and music lane one, with
  // floors so a short panel still shows every lane; nothing scrolls vertically.
  const laneVideo = { flex: "3 1 0px", minHeight: 28 } as const;
  const laneTitles = { flex: `${titleLaneOf.count} 1 0px`, minHeight: Math.max(0, titleLaneOf.count * 20 - 2) } as const;
  const laneMusic = { flex: "1 1 0px", minHeight: 18 } as const;
  // The shorts lane shows whenever there are shorts, and in Short mode from the start.
  const showShortsLane = shortMode || shorts.length > 0;
  const laneShorts = { flex: "1 1 0px", minHeight: 22 } as const;
  // The smallest the timeline pane may be: every lane at its floor plus the header, the hint line and padding. The rows
  // split holds it as a hard floor, so a notice or a result card above the rows squeezes the preview, never the lanes.
  const timelineFloor = 216 + 20 * titleLaneOf.count + (showShortsLane ? 26 : 0);
  const timelinePanel = (
      <div className="panel flex h-full min-h-0 flex-col select-none overflow-hidden p-2" data-timeline>
        <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
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
        <div className="flex min-h-0 flex-1" data-timeline-lanes>
          <div className="flex min-h-0 w-14 shrink-0 flex-col overflow-hidden pr-1.5 text-right text-[10.5px] leading-none text-faint select-none" style={{ paddingBottom: scrollbarH }} aria-hidden>
            <div className="h-5 shrink-0" />
            <div className="mt-1 flex items-center justify-end" style={laneVideo}>Video</div>
            {showShortsLane && <div className="mt-1 flex items-center justify-end" style={laneShorts}>Shorts</div>}
            <div className="mt-1 flex items-center justify-end" style={laneTitles}>Titles</div>
            {[0, 1, 2].map((lane) => (
              <div key={lane} className="mt-1 flex items-center justify-end" style={laneMusic}>Music {lane + 1}</div>
            ))}
          </div>
        <div ref={timelineRef} className="relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden" onScroll={onTimelineScroll} onPointerDown={onTimelinePointerDown} onPointerMove={onTimelinePointerMove} onPointerUp={onTimelinePointerUp} onPointerCancel={onTimelinePointerUp} onPointerLeave={onTimelinePointerLeave} data-timeline-scroll>
          <div className="relative flex h-full flex-col" style={{ width: Math.max(100, Math.max(duration, musicFarEnd) * pxPerSec + 40) }}>
            {/* ruler */}
            <div className="h-5 shrink-0 cursor-ew-resize border-b border-edge text-[10px] text-faint" data-ruler title="Click or drag to scrub; snaps to cuts (hold ⌥ to scrub freely)">
              {Array.from({ length: Math.ceil(duration / rulerStep(duration, zoom)) + 1 }, (_, i) => i * rulerStep(duration, zoom)).map((t) => (
                <span key={t} className="absolute top-0" style={{ left: t * pxPerSec }}>
                  {fmtTime(t)}
                </span>
              ))}
              {beatTicks.map((t) => (
                <span key={t} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-accent/70" style={{ left: t * pxPerSec }} data-beat-tick={t} />
              ))}
            </div>
            {/* video lane */}
            <div className="relative mt-1" style={laneVideo} data-video-lane>
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
                    className={cn("absolute top-0 flex h-full flex-col justify-center overflow-hidden border text-left text-[11.5px]", c.joinedToPrevious ? "rounded-l-none border-l-0 pl-0" : "rounded-l-[var(--radius-sm)] pl-2", joinsNext ? "rounded-r-none border-r-0 pr-0" : "rounded-r-[var(--radius-sm)] pr-2", selectedRun.has(c.id) ? "border-accent bg-accent-soft text-ink" : c.introRole && introReg && i <= introReg.scenes.length ? "border-[#d9a400]/60 bg-[#d9a400]/15 text-muted" : "border-edge bg-raised text-muted")}
                    style={{ left: c.start * pxPerSec, width: Math.max(4, (c.end - c.start) * pxPerSec - (joinsNext ? 0 : 1)) }}
                    title={`${c.introRole === "card" ? "Intro title card · " : c.introRole ? "Intro scene · " : ""}${project.media[c.media]?.name} ${fmtTime(c.in)}–${fmtTime(c.out)}${c.joinedToPrevious ? " · joined to the previous clip" : ""}${describeWhere(project, project.media[c.media]) ? ` · ${describeWhere(project, project.media[c.media])}` : ""}${c.introRole ? "" : " · drag to move it"}`}
                    data-clip={c.id}
                    data-joined={c.joinedToPrevious ? "true" : undefined}
                    data-intro-clip={c.introRole}
                  >
                    {c.reframe?.keys.map((k) => {
                      const at = c.start + (k.t - c.in) / clipSpeed(c);
                      if (at < c.start - 1e-6 || at > c.end + 1e-6) return null;
                      return <span key={k.t} className={cn("pointer-events-none absolute bottom-0.5 h-2 w-2 rotate-45 border border-white/80", k.hold ? "bg-warn" : "bg-accent")} style={{ left: (at - c.start) * pxPerSec - 4 }} title={`Window key at ${fmtTime(at)}${k.hold ? " (held)" : ""}`} data-key-mark={k.t} />;
                    })}
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
              {job?.kind === "export" && job.progress && job.label !== "Test render" && <div className="pointer-events-none absolute top-0 h-full bg-accent/25" style={{ left: (range?.from ?? 0) * pxPerSec, width: Math.max(0, job.progress.timelineT) * pxPerSec }} title={`Rendered up to ${fmtTime((range?.from ?? 0) + job.progress.timelineT)}`} data-export-progress-band />}
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
            {/* shorts lane: each short a span to drag or trim; the empty lane draws a new one */}
            {showShortsLane && (
              <div className="relative mt-1" style={laneShorts} data-shorts-lane onPointerDown={onShortsLanePointerDown} onPointerMove={onShortsLanePointerMove} onPointerUp={onShortsLanePointerUp} onPointerCancel={onShortsLanePointerUp}>
                {!shorts.length && <div className="pointer-events-none absolute inset-0 flex items-center rounded-[3px] border border-dashed border-edge px-2 text-[10.5px] text-faint">Drag here to draw a short, or press N at the playhead</div>}
                {shorts.map((x, i) => {
                  const active = activeShort?.id === x.id;
                  return (
                    <div key={x.id} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") selectShort(x.id); }} className={cn("absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded-[3px] border px-1.5 text-[10.5px] select-none", active ? "z-10 border-accent bg-accent/30 text-ink" : "border-edge bg-accent/10 text-muted", x.loop !== "off" && "border-dashed")} style={{ left: x.from * pxPerSec, width: Math.max(6, (x.to - x.from) * pxPerSec) }} title={`${x.name} · ${fmtTime(x.from)}–${fmtTime(x.to)} · drag to move it, its edges to trim it`} data-short-span={x.id} data-active={active ? "true" : "false"}>
                      <span className="pointer-events-none truncate">{String(i + 1).padStart(2, "0")} {x.name} · {(x.to - x.from).toFixed(1)} s</span>
                      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-accent/60" data-short-handle="from" />
                      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-accent/60" data-short-handle="to" />
                    </div>
                  );
                })}
              </div>
            )}
            {/* title lanes: overlapping titles stack */}
            <div className="relative mt-1" style={laneTitles} data-title-lane>
              {!project.titles.length && project.clips.length > 0 && <div className="pointer-events-none absolute inset-0 flex items-center rounded-[3px] border border-dashed border-edge px-2 text-[10.5px] text-faint">Titles and lower thirds from the Titles tab land here</div>}
              {project.titles.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setTab("titles");
                    focusTitle(t);
                  }}
                  className={cn("absolute truncate rounded-[3px] bg-[#e5484d]/70 px-1 text-left text-[10.5px] text-white", selectedTitle === t.id && "ring-2 ring-white/90", (shortMode ? t.short !== activeShort?.id : !!t.short) && "opacity-35")}
                  style={{ left: t.start * pxPerSec, width: Math.max(4, t.duration * pxPerSec), top: `${((titleLaneOf.lanes[t.id] ?? 0) / titleLaneOf.count) * 100}%`, height: `calc(${100 / titleLaneOf.count}% - 2px)` }}
                  title={t.text}
                >
                  {t.text}
                </button>
              ))}
            </div>
            {/* music lanes */}
            {[0, 1, 2].map((lane) => (
              <div key={lane} className="relative mt-1" style={laneMusic} data-music-lane={lane}>
                {lane === 0 && !project.music.length && project.clips.length > 0 && <div className="pointer-events-none absolute inset-0 flex items-center rounded-[3px] border border-dashed border-edge px-2 text-[10.5px] text-faint">Drop music onto the preview, or add it from the Audio tab</div>}
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
                      className="pointer-events-none absolute top-0 flex h-full items-center truncate rounded-r-[3px] border border-l-0 border-dashed border-edge bg-[repeating-linear-gradient(135deg,rgba(128,128,128,0.28)_0_4px,transparent_4px_8px)] px-1.5 text-[10.5px] text-faint"
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
              <span ref={hoverLabelRef} data-hover-label className="absolute top-0 left-1 rounded-[3px] bg-black/75 px-1 font-mono text-[10px] leading-4 text-white tabular" />
            </div>
            <div ref={dropLineRef} className="pointer-events-none absolute top-5 bottom-0 z-10 w-0.5 bg-accent" style={{ display: "none" }} data-drop-line />
            <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#e5484d]" style={{ left: playhead * pxPerSec }} />
            <div className="pointer-events-none absolute top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#e5484d]" style={{ left: playhead * pxPerSec - 5 }} data-playhead-handle />
          </div>
        </div>
        </div>
        <p className="mt-1.5 shrink-0 truncate text-[11.5px] text-faint">
          Click the ruler to seek · Space plays, hold it for double speed · hold Control to skim the cuts · Q, W and C trim and split at the playhead · S saves the frame (⇧S full-size JPEG, ⌥S PNG) · <kbd className="rounded border border-edge px-1 font-mono">?</kbd> lists every shortcut.
        </p>
      </div>
  );

  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-col", focus ? "h-[calc(100dvh-16px)] gap-2" : "h-[calc(100dvh-var(--editor-top,240px))] gap-3")} style={{ "--rows-min": `${(job?.kind === "export" ? 0 : 260 + 12) + timelineFloor}px` } as CSSProperties} data-video-editor data-focus-layout={focus ? "on" : "off"}>
      {/* project bar */}
      <input ref={templateJsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importTemplateJson(e.target.files[0])} data-template-input />
      <input ref={relinkInput} type="file" accept="video/*,audio/*,.mp4,.mov,.mp3,.m4a,.wav,.aac,.flac,.ogg" multiple hidden onChange={(e) => e.target.files?.length && void linkFiles(Array.from(e.target.files))} data-relink-input />
      <div className={cn("panel flex flex-wrap items-center gap-2 p-2", focus && "hidden")} data-project-bar>
        <button type="button" onClick={chooseFolder} className={cn(GHOST, "h-9")} disabled={!hasFileSystemAccess()}>
          <FolderOpen size={14} /> {folder ? folder : "Choose project folder"}
        </button>
        <input value={project.name} onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))} className={cn(INPUT, "w-48")} aria-label="Project name" />
        <div className="flex items-center rounded-[var(--radius-sm)] border border-edge p-0.5 text-[12px]" role="group" aria-label="Editor mode" data-mode={shortMode ? "short" : "landscape"}>
          <button type="button" onClick={() => setMode("landscape")} aria-pressed={!shortMode} className={cn("h-7 rounded-[var(--radius-sm)] px-2", !shortMode ? "bg-accent text-on-accent" : "text-muted hover:text-ink")} title="The landscape edit: the whole timeline, exported as one file" data-mode-landscape>
            Landscape
          </button>
          <button type="button" onClick={() => setMode("short")} aria-pressed={shortMode} className={cn("flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2", shortMode ? "bg-accent text-on-accent" : "text-muted hover:text-ink")} title="Short mode: vertical shorts cut from this timeline, one at a time, in the phone's shape" data-mode-short>
            <Smartphone size={12} /> Short
          </button>
        </div>
        <button type="button" onClick={() => void store.save(project)} disabled={!folder} className={GHOST}>
          <Save size={13} /> Save
        </button>
        <button type="button" onClick={undo} disabled={!history.length} className={GHOST}>
          Undo
        </button>
        <button type="button" onClick={() => setClearOpen(true)} className={cn(GHOST, "hover:border-danger hover:text-danger")} title="Start over: forget this project in the browser, optionally delete its files from the folder">
          <Trash2 size={13} /> Clear
        </button>
        <span className="text-[12px] text-faint" data-status>{status}</span>
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
          <span className="min-w-0 flex-1" data-missing-notice data-reconnectable={reconnectable}>
            {missingMedia.length === 1 ? "One file can" : `${missingMedia.length} files can`}&apos;t be found right now: {nameSome(missingMedia.map((id) => project.media[id]?.name ?? id))}. The timeline is intact
            {reconnectable > 0 ? "; the browser hands back files outside the project folder only after a click — press Reconnect, and tick “Allow on every visit” in its prompt to make this the last time." : `; pick the file${missingMedia.length === 1 ? "" : "s"} again to preview and export.`}
          </span>
          {whereSummary(project, missingMedia.map((id) => project.media[id]).filter(Boolean)) && (
            <span className="basis-full text-[12px] text-faint" data-missing-where>
              Last seen {whereSummary(project, missingMedia.map((id) => project.media[id]).filter(Boolean))}.
            </span>
          )}
          <button type="button" onClick={() => void rememberFolder()} disabled={!hasFileSystemAccess()} className={cn(GHOST, "ml-auto")} title="Point at the folder the files live in: their paths inside it are recorded, missing ones are found there by name, and next time they are located without asking" data-remember-folder>
            Remember a folder…
          </button>
          {reconnectable > 0 && (
            <button type="button" onClick={() => void reconnectFiles()} className={cn(GHOST, "border-accent text-accent")} data-reconnect>
              Reconnect {reconnectable} file{reconnectable === 1 ? "" : "s"}
            </button>
          )}
          <button type="button" onClick={() => void relinkFiles()} className={cn(GHOST, reconnectable > 0 ? "" : "border-accent text-accent")} data-locate>
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
      {job?.kind === "export" && <ExportRun job={job} events={events} skipped={skipped} liveRef={liveRef} liveAt={liveAt} onPause={() => setExportPaused(true)} onResume={() => setExportPaused(false)} onStop={() => job.abort.abort()} />}
      {done && job?.kind !== "export" && (
        /* The result card never takes the preview's room: past two fifths of the editor it scrolls within itself. */
        <div className="min-h-0 max-h-[42%] shrink-0 overflow-y-auto" data-done-scroll>
        <ExportDone
          done={done}
          busy={!!job}
          account={account}
          onSaveReport={saveReport}
          onDismiss={() => setDone(null)}
          onAgain={() => {
            setDone(null);
            setTab("export");
            setExportView("setup");
          }}
          onFiles={() => {
            setTab("export");
            setExportView("files");
          }}
          onRecheck={(depth) => void checkWritten(done.name, depth)}
          onCancelCheck={() => cancelDoctor(done.name)}
          canFix={canFix}
          onFixFinding={(f) => void fixFinding(done.name, f, "done")}
          onResume={() => void runExport(resumable)}
          onDiscard={() => void discardParts()}
          onFix={() => {
            setTab("export");
            setExportView("files");
            void fixByName(done.name);
          }}
        />
        </div>
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

      {/* preview + inspector — a split pane (the tools fold away to leave the picture and the timeline), hidden while an export runs */}
      {/* preview + tools over the timeline: a vertical split, the row's height yours to drag; while an export runs the row is
          kept mounted but out of sight (the run view stands in for it) and the timeline takes the room */}
      <SplitPane id="video-editor-rows" direction="vertical" defaultRatio={0.64} minFirst={260} minSecond={timelineFloor} floor="second" collapsible="second" firstLabel="preview and tools" secondLabel="timeline" stackBelow="never" gap={12} className="min-h-[var(--rows-min)] flex-1" hidden={job?.kind === "export" ? "first" : null} first={
      <SplitPane id="video-editor-main" direction="horizontal" defaultRatio={0.6} minFirst={320} minSecond={300} collapsible="both" firstLabel="preview" secondLabel="tools" className="h-full min-h-0 gap-0" first={<>
        <div className="panel flex h-full min-h-0 flex-col p-2">
          {/* The stage takes what the row leaves; the picture is the largest box of the video's shape that fits it. */}
          <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden" data-preview-stage>
          <div
            ref={previewBoxRef}
            className={cn("group relative overflow-hidden rounded-[var(--radius-sm)] bg-black", dragOver && "ring-2 ring-accent")}
            style={stage && stage.h > 40 ? { width: Math.min(stage.w, stage.h * previewAspect), height: Math.min(stage.w, stage.h * previewAspect) / previewAspect } : { width: "100%", aspectRatio: String(previewAspect) }}
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
            <canvas ref={canvasRef} width={previewAspect >= 1 ? 1280 : Math.round(1280 * previewAspect)} height={previewAspect >= 1 ? Math.round(1280 / previewAspect) : 1280} className="absolute inset-0 h-full w-full object-contain" data-preview-canvas />
            {pictureView && windowRect && (
              <div ref={windowOverlayRef} className="absolute inset-0 cursor-move touch-none select-none" data-window-view onPointerDown={onWindowPointerDown} onPointerMove={onWindowPointerMove} onPointerUp={onWindowPointerUp} onPointerCancel={onWindowPointerUp}>
                <div className="pointer-events-none absolute rounded-[2px] border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" style={{ left: `${windowRect.x * 100}%`, top: `${windowRect.y * 100}%`, width: `${windowRect.w * 100}%`, height: `${windowRect.h * 100}%` }} data-window-rect />
                <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white" data-window-hint>
                  drag to place the window · wheel to zoom · click to centre it there · K keys it here
                </div>
              </div>
            )}
            {shortMode && activeShort && (
              <>
                {ghost && !pictureView && view.safeArea && <SafeGhost safe={view.safeArea} />}
                <div className="pointer-events-none absolute bottom-2 left-2 rounded-[var(--radius-sm)] bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white tabular" data-short-clock>
                  {fmtTime(Math.max(0, playhead - activeShort.from), first?.fps)} / {fmtTime(activeShort.to - activeShort.from)} · {String(shortIndex).padStart(2, "0")} {activeShort.name}
                </div>
                <button type="button" onClick={() => setGhost((g) => !g)} aria-pressed={ghost} className="absolute top-2 left-2 rounded-[var(--radius-sm)] bg-black/50 px-1.5 py-0.5 text-[11px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-black/70" title="Show what the platforms' own buttons and captions cover" data-ghost-toggle>
                  {ghost ? "Hide the phone's UI" : "Show the phone's UI"}
                </button>
              </>
            )}
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
            <button type="button" onClick={() => setLoop((l) => !l)} aria-pressed={loop} className={cn(GHOST, "h-8 px-2 text-[12px]", loop && "border-accent text-accent")} title={shortMode && activeShort ? "Loop the short (L)" : range ? "Loop the export range (L)" : "Loop the whole timeline (L)"} aria-label={shortMode && activeShort ? "Loop the short" : range ? "Loop the export range" : "Loop the whole timeline"}>
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
                  <Camera size={12} /> Save frame <Key k="S" />
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

        </>} second={<>
        {/* The inspector never grows past the preview: it scrolls inside, so the timeline stays within reach. */}
        <div className="relative h-full min-h-0 max-lg:min-h-[360px]">
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
                <div className="grid grid-cols-2 gap-1.5" data-trim-actions>
                  <button type="button" disabled={!under} onClick={trimActions.splitHere} className={GHOST} title="Cut the clip under the playhead in two (C)" data-split>
                    <Scissors size={13} /> Split at playhead <Key k="C" />
                  </button>
                  <button
                    type="button"
                    disabled={!current || !mergeKind}
                    onClick={trimActions.mergeSelected}
                    className={GHOST}
                    title={`${mergeKind === "merge" ? "The next clip is the rest of this recording: make them one clip again, with no cut" : mergeKind === "join" ? "Hide the cut to the next clip: no marker or transition, and it takes this clip's grade, crop and audio so the seam is invisible" : "Select a clip that has one after it"} (J)`}
                    data-merge-next
                  >
                    {mergeKind === "join" ? "Join with next" : "Merge with next"} <Key k="J" />
                  </button>
                  {current?.joinedToPrevious && (
                    <button type="button" onClick={trimActions.unjoinSelected} className={GHOST} title="Show the cut before this clip again (⇧J)" data-unjoin>
                      Unjoin from previous <Key k="⇧J" />
                    </button>
                  )}
                  <button type="button" disabled={!under} onClick={trimActions.trimStartHere} className={GHOST} title="Drop everything before the playhead from the clip under it; the playhead then sits on the clip's new first frame (Q)" data-trim-start>
                    Trim start to here <Key k="Q" />
                  </button>
                  <button type="button" disabled={!under} onClick={trimActions.trimEndHere} className={GHOST} title="Drop everything after the playhead from the clip under it (W)" data-trim-end>
                    Trim end to here <Key k="W" />
                  </button>
                  <button type="button" disabled={!current} onClick={trimActions.deleteSelected} className={cn(GHOST, "hover:border-danger hover:text-danger")} title="Remove the selected clip from the timeline (⌫)" data-delete-clip>
                    <Trash2 size={13} /> Delete clip <Key k="⌫" />
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === 0} onClick={() => trimActions.moveSelected(-1)} className={GHOST} title="Play this clip before the previous one ([)" data-move-earlier>
                    ◀ Move earlier <Key k="[" />
                  </button>
                  <button type="button" disabled={!current || placed.findIndex((c) => c.id === current.id) === placed.length - 1} onClick={() => trimActions.moveSelected(1)} className={GHOST} title="Play this clip after the next one (])" data-move-later>
                    Move later ▶ <Key k="]" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-edge p-2" data-speed-box>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    Speed
                    <select value={current ? clipSpeed(current) : 1} disabled={!current} onChange={(e) => current && update(current.id, { speed: Number(e.target.value) })} className={cn(SEL, "h-7 text-[12px]")} aria-label="Clip speed" title="Play this clip faster (time-lapse) or slower (slow motion); it gets shorter or longer on the timeline and the export follows">
                      {(current && !(CLIP_SPEEDS as readonly number[]).includes(clipSpeed(current)) ? [...CLIP_SPEEDS, clipSpeed(current)].sort((a, b) => a - b) : [...CLIP_SPEEDS]).map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted" title={`Or type any speed from ${MIN_CLIP_SPEED}× to ${MAX_CLIP_SPEED}× — Enter or leaving the field applies it`}>
                    or
                    <input
                      key={current ? `${current.id}:${clipSpeed(current)}` : "none"}
                      type="number"
                      min={MIN_CLIP_SPEED}
                      max={MAX_CLIP_SPEED}
                      step={0.05}
                      defaultValue={current ? clipSpeed(current) : 1}
                      disabled={!current}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (current && Number.isFinite(v) && v >= MIN_CLIP_SPEED && v <= MAX_CLIP_SPEED && v !== clipSpeed(current)) update(current.id, { speed: Math.round(v * 100) / 100 });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className={cn(INPUT, "h-7 w-20 font-mono text-[12px]")}
                      aria-label="Clip speed, typed"
                      data-speed-input
                    />
                    ×
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted" role="radiogroup" aria-label="Ending" data-intro-outro>
                    <span>Ending</span>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="intro-outro" checked={(project.intro.outro ?? "look") === "look"} onChange={() => setIntro({ outro: "look" })} className="accent-[var(--accent)]" /> the look’s own ({TRANSITIONS.find((x) => x.kind === introStyle(project.intro.style).outro.kind)?.name.toLowerCase() ?? introStyle(project.intro.style).outro.kind})
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="intro-outro" checked={project.intro.outro === "open"} onChange={() => setIntro({ outro: "open" })} className="accent-[var(--accent)]" /> open to the full frame
                    </label>
                    <span className="basis-full text-faint">
                      {project.intro.outro === "open"
                        ? introStyle(project.intro.style).fx.letterbox
                          ? "The title fades and the bars slide away over a dissolve into the video."
                          : "The title fades over a dissolve into the video (this look has no bars to open)."
                        : "The look’s own transition into the video; the card’s title and effects fade out with the picture."}
                    </span>
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
                            <button type="button" onClick={() => (isCard ? setCard({ enabled: false }) : applyIntro((p) => removeScene(p, c.id)))} className="text-faint hover:text-danger" aria-label={isCard ? "Remove the title card" : `Remove scene ${i + 1}`}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2 text-[12px] text-muted" data-intro-card>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 font-medium text-ink">
                          <input type="checkbox" checked={hasCard(project.intro.card)} onChange={(e) => setCard({ enabled: e.target.checked, seconds: e.target.checked && !(project.intro.card.seconds > 0) ? DEFAULT_CARD.seconds : project.intro.card.seconds })} className="accent-[var(--accent)]" data-card-enabled /> Title card
                        </label>
                        {hasCard(project.intro.card) && (
                          <label className="flex items-center gap-1">
                            <input type="number" min={0.5} max={10} step={0.5} value={project.intro.card.seconds} onChange={(e) => setCard({ seconds: Math.max(0.5, Math.min(10, Number(e.target.value) || 0.5)) })} className={cn(INPUT, "h-6 w-16 font-mono")} aria-label="Card seconds" /> s
                          </label>
                        )}
                      </div>
                      {hasCard(project.intro.card) ? (
                        <>
                          <input value={project.intro.card.text} onChange={(e) => setCard({ text: e.target.value })} placeholder={project.name} className={INPUT} aria-label="Card title" />
                          <input value={project.intro.card.subtitle} onChange={(e) => setCard({ subtitle: e.target.value })} placeholder="Subtitle (optional): a place, a date" className={INPUT} aria-label="Card subtitle" />
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-card-style>
                            <span className="grid grid-cols-3 gap-0.5" title="Where the title sits" role="group" aria-label="Card position">
                              {TITLE_POSITIONS.map((pos) => (
                                <button key={pos} type="button" onClick={() => setCard({ position: pos })} aria-label={POSITION_NAMES[pos]} title={POSITION_NAMES[pos]} aria-pressed={introCard.position === pos} className={cn("h-4 w-4 rounded-[2px] border", introCard.position === pos ? "border-accent bg-accent" : "border-edge bg-base hover:border-accent")} data-card-position={pos} />
                              ))}
                            </span>
                            <label className="flex items-center gap-1">
                              Text
                              <input type="color" value={toHex(introCard.color)} onChange={(e) => setCard({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-edge bg-base p-0" aria-label="Card text colour" />
                            </label>
                            <label className="flex items-center gap-1">
                              Font
                              <select
                                value={introCard.font in TITLE_FONTS || TITLE_FAMILIES.includes(introCard.font) || localFonts?.includes(introCard.font) ? introCard.font : "__other"}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "__installed") return void listLocalFonts();
                                  setCard({ font: v === "__other" ? "" : v });
                                }}
                                className={cn(SEL, "h-6 max-w-[160px] text-[12px]")}
                                aria-label="Card font"
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
                              {!(introCard.font in TITLE_FONTS || TITLE_FAMILIES.includes(introCard.font) || localFonts?.includes(introCard.font)) && <input value={introCard.font} onChange={(e) => setCard({ font: e.target.value })} placeholder="Family name" className={cn(INPUT, "h-6 w-32 text-[12px]")} aria-label="Card font family name" style={{ fontFamily: introCard.font ? `"${introCard.font}"` : undefined }} />}
                            </label>
                            <label className="flex min-w-[140px] flex-1 items-center gap-1">
                              Size
                              <input type="range" min={0.04} max={0.2} step={0.005} value={introCard.size} onChange={(e) => setCard({ size: Number(e.target.value) })} className={RANGE} aria-label="Card text size" />
                              <span className="font-mono tabular">{Math.round(introCard.size * 100)}%</span>
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-card-footage>
                            <label className="flex min-w-[140px] flex-1 items-center gap-1" title="How dark the footage goes under the title">
                              Dim
                              <input type="range" min={0} max={0.9} step={0.05} value={introCard.dim} onChange={(e) => setCard({ dim: Number(e.target.value) })} className={RANGE} aria-label="Dim the footage" />
                              <span className="font-mono tabular">{Math.round(introCard.dim * 100)}%</span>
                            </label>
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={introCard.blur} onChange={(e) => setCard({ blur: e.target.checked })} className="accent-[var(--accent)]" /> soften the footage
                            </label>
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={introCard.caps} onChange={(e) => setCard({ caps: e.target.checked })} className="accent-[var(--accent)]" /> subtitle in capitals
                            </label>
                            <label className="flex items-center gap-1">
                              Fade in
                              <input type="number" min={0} max={2} step={0.1} value={introCard.fade} onChange={(e) => setCard({ fade: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })} className={cn(INPUT, "h-6 w-16 font-mono")} aria-label="Card fade in seconds" /> s
                            </label>
                          </div>
                        </>
                      ) : (
                        <p className="text-faint">The intro ends on its last scene; tick Title card to end on the project name instead.</p>
                      )}
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
                {(frameChosen !== "source" || shortMode || current.reframe) &&
                  (() => {
                    const keys = current.reframe?.keys ?? [];
                    const here = under?.clip.id === current.id ? under.sourceTime : current.in;
                    const key = keyFor(keys, here);
                    const onKey = keyIndexAt(keys, here) >= 0;
                    const setHere = (patch: Partial<ReframeKey>) => writeWindowKey(current.id, { ...key, ...patch });
                    const nextClip = placed[placed.findIndex((c) => c.id === current.id) + 1];
                    const frameName = FRAME_LABELS[frameChosen === "source" ? "9:16" : frameChosen];
                    return (
                      <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2" data-reframe>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[12.5px] text-ink" title="A frame narrower than the recording shows a window of it; a key says where the window sits at an instant, and it eases between keys">
                            Window — where the {frameName} frame looks
                          </span>
                          <span className="text-[12px] text-faint" data-keys-summary>
                            {describeKeys(keys)}
                            {keys.length ? (onKey ? " · on a key" : " · between keys") : ""}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Slider label="Across" value={key.cx} min={0} max={1} step={0.005} onChange={(v) => setHere({ cx: v })} format={(v) => `${v === 0.5 ? "centre" : `${Math.round((v - 0.5) * 200)}%`}`} />
                          <Slider label="Up / down" value={key.cy} min={0} max={1} step={0.005} onChange={(v) => setHere({ cy: v })} format={(v) => `${v === 0.5 ? "centre" : `${Math.round((v - 0.5) * 200)}%`}`} />
                          <Slider label="Zoom" value={key.zoom} min={1} max={MAX_REFRAME_ZOOM} step={0.05} onChange={(v) => setHere({ zoom: v })} format={(v) => `${v.toFixed(2)}×`} />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={windowKeyHere} className={cn(GHOST, "h-7 text-[12px]")} title="Write the window as it is here as a key at this frame (K)" data-key-here>
                            Key here
                          </button>
                          <button type="button" onClick={removeWindowKeyHere} disabled={!onKey} className={cn(GHOST, "h-7 text-[12px]")} title="Delete the key at this frame (⇧K)" data-key-remove>
                            Delete key
                          </button>
                          <label className="flex items-center gap-1 text-[12px] text-muted" title="Hold this window until the next key instead of easing towards it">
                            <input type="checkbox" checked={!!key.hold} onChange={(e) => setHere({ hold: e.target.checked })} className="accent-[var(--accent)]" data-key-hold /> hold
                          </label>
                          <button type="button" onClick={() => jumpWindowKey(-1)} disabled={!keyAround(keys, here, -1)} className={cn(GHOST, "h-7 px-1.5 text-[12px]")} title="The previous key (⌥←)" data-key-prev>
                            ‹ key
                          </button>
                          <button type="button" onClick={() => jumpWindowKey(1)} disabled={!keyAround(keys, here, 1)} className={cn(GHOST, "h-7 px-1.5 text-[12px]")} title="The next key (⌥→)" data-key-next>
                            key ›
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={() => setWindowView((v) => !v)} aria-pressed={windowView} className={cn(GHOST, "h-7 text-[12px]", windowView && "border-accent text-accent")} title="The whole picture with the window drawn over it: drag it, click where the road goes, wheel to zoom" data-window-view-toggle>
                            {windowView ? "Show the frame" : "Show the whole picture"}
                          </button>
                          <button type="button" onClick={() => void trackWindow("track")} disabled={!!job} className={cn(GHOST, "h-7 text-[12px]")} title="Keys on where the picture moves at each instant" data-track>
                            Track
                          </button>
                          <button type="button" onClick={() => void trackWindow("road")} disabled={!!job} className={cn(GHOST, "h-7 text-[12px]")} title="Experimental: keys on where the lane edges meet, the motion where it is unsure" data-road>
                            Road
                          </button>
                          <button type="button" onClick={() => update(current.id, { reframe: { keys: smoothKeys(keys) } })} disabled={keys.length < 3} className={cn(GHOST, "h-7 text-[12px]")} title="Each key averaged with its neighbours" data-keys-smooth>
                            Smooth
                          </button>
                          <button type="button" onClick={() => update(current.id, { reframe: { keys: thinKeys(keys) } })} disabled={keys.length < 3} className={cn(GHOST, "h-7 text-[12px]")} title="Keys the eased path already passes are dropped" data-keys-thin>
                            Thin
                          </button>
                          <button type="button" onClick={copyKeysToNext} disabled={!keys.length || !nextClip} className={cn(GHOST, "h-7 text-[12px]")} title="The same windows at the same offsets on the next clip" data-keys-copy>
                            Copy to next clip
                          </button>
                          <button type="button" onClick={() => update(current.id, { reframe: undefined })} disabled={!keys.length} className={cn(GHOST, "h-7 text-[12px]")} data-reframe-reset>
                            Centre
                          </button>
                        </div>
                        <p className="text-[12px] text-faint">Follow by hand: show the whole picture, step with ← and →, and click where the road goes at a few frames — the window eases between. Track keys the window on where the picture moves; Road (experimental) on where the lane edges meet, falling back to Track where it is unsure.</p>
                      </div>
                    );
                  })()}
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
                      <button type="button" onClick={() => update(current.id, { gainDb: levels.camera })} className={GHOST}>
                        Reset to {fmtDb(levels.camera)}
                      </button>
                      <span className="text-[12px] text-faint">New clips start at {fmtDb(levels.camera)} — the {SOUND_LABELS[project.sound ?? "footage"].toLowerCase()} mix; the Sound section of Export changes it.</span>
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
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted" data-beats-row>
                      <button type="button" onClick={() => void analyseTrackBeats(currentMusic.id)} disabled={!!job} className={cn(GHOST, "h-7 text-[12px]")} title="Find the track's tempo, beats, downbeats and drop from its samples" data-analyse-beats>
                        {currentMusic.beats ? "Analyse the beat again" : "Analyse the beat"}
                      </button>
                      <span data-beats-info>{currentMusic.beats ? `${currentMusic.beats.bpm} BPM · ${currentMusic.beats.beats.length} beats${currentMusic.beats.drop !== null ? ` · drop at ${fmtTime(currentMusic.beats.drop)}` : ""}` : "no beats yet"}</span>
                      <label className="flex items-center gap-1" title="Scrubbing, the shorts' ends and the title starts land on the nearest beat">
                        <input type="checkbox" checked={snapBeats} onChange={(e) => setSnapBeats(e.target.checked)} className="accent-[var(--accent)]" data-snap-beats /> snap to beats
                      </label>
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
                  <button type="button" onClick={() => addTitle("hook")} className={GHOST} title="The big bold line that opens a short, in for its first beats" data-add-hook>
                    + Hook
                  </button>
                  <button type="button" onClick={() => addTitle("caption")} className={GHOST} title="A bold caption on a dark pill, wrapped to the frame and kept inside the platform's safe area" data-add-caption>
                    + Caption
                  </button>
                  <button type="button" onClick={() => addTitle("words", "Wait *for* it")} className={GHOST} title="A caption whose words land one by one, big and outlined; *stars* mark the highlighted words" data-add-words>
                    + Word by word
                  </button>
                  <button type="button" onClick={() => addTitle("badge", "Part {part} / {of}")} className={GHOST} title="A small badge in the corner; {part} and {of} are filled per short" data-add-badge>
                    + Part badge
                  </button>
                  <button type="button" onClick={() => addTitle("place", "{name}", "{date}")} className={GHOST} title="Where and when, low in the frame; {name} is the project's, {date} the recording's" data-add-place>
                    + Place &amp; date
                  </button>
                  <button type="button" onClick={() => addTitle("cta", "Follow for the next part")} className={GHOST} title="A call to action on a bright pill, sliding up into the safe area near the end" data-add-cta>
                    + Call to action
                  </button>
                  <button type="button" onClick={() => addTitle("counter", "120 km/h")} className={GHOST} title="A big bare number that zooms in" data-add-counter>
                    + Counter
                  </button>
                  <input ref={logoInput} type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={(e) => e.target.files?.[0] && void addLogo(e.target.files[0])} />
                  <button type="button" onClick={() => void pickLogo()} className={GHOST}>
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
                {shortMode && activeShort && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <p className="text-accent" data-titles-short>Short mode: these titles belong to {String(shortIndex).padStart(2, "0")} {activeShort.name}; a new one starts inside it.</p>
                    {shorts.length > 1 && (
                      <button type="button" onClick={() => setProject((p) => copyTitlesToShorts(p, activeShort.id))} disabled={!project.titles.some((t) => t.short === activeShort.id)} className={cn(GHOST, "h-6 text-[11.5px]")} title="Every other short gets copies of these titles at the same offsets from its start; {part}, {of}, {name}, {date} and {short} are filled per short" data-titles-to-all>
                        Use these for every short
                      </button>
                    )}
                  </div>
                )}
                {view.titles.length > 0 && <p className="text-[12px] text-faint">In time order. Open one to edit it; titles that overlap in time are all drawn, so give them different positions.</p>}
                {[...view.titles]
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
                    {shorts.length > 0 && (
                      <label className="flex items-center gap-1 text-[12px] text-muted">
                        Belongs to
                        <select value={t.short ?? ""} onChange={(e) => setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? (e.target.value ? { ...x, short: e.target.value } : untag(x)) : x)) }))} className={cn(INPUT, "h-7")} aria-label="Belongs to" data-title-short>
                          <option value="">The landscape edit</option>
                          {shorts.map((x, i) => (
                            <option key={x.id} value={x.id}>
                              {String(i + 1).padStart(2, "0")} {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                      <label className="flex items-center gap-1">
                        In
                        <select value={t.enter ?? "fade"} onChange={(e) => patchTitle(t.id, { enter: e.target.value as TitleEnter })} className={cn(INPUT, "h-7")} aria-label="Entrance" data-title-enter>
                          {TITLE_ENTERS.map((k) => (
                            <option key={k} value={k}>
                              {TITLE_ENTER_NAMES[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        Out
                        <select value={t.exit ?? "fade"} onChange={(e) => patchTitle(t.id, { exit: e.target.value as TitleExit })} className={cn(INPUT, "h-7")} aria-label="Exit" data-title-exit>
                          {TITLE_EXITS.map((k) => (
                            <option key={k} value={k}>
                              {TITLE_EXIT_NAMES[k]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1">
                        Style
                        <select value="" onChange={(e) => { const id = e.target.value; if (id) setProject((p) => ({ ...p, titles: p.titles.map((x) => (x.id === t.id ? applyTitlePreset(x, id) : x)) })); }} className={cn(INPUT, "h-7")} aria-label="Style preset" data-title-preset>
                          <option value="">preset…</option>
                          {TITLE_PRESETS.map((p) => (
                            <option key={p.id} value={p.id} title={p.hint}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1" title="The colour of words written *like this*">
                        Highlight
                        <input type="text" value={t.highlight ?? "#ffd60a"} onChange={(e) => patchTitle(t.id, { highlight: e.target.value })} className={cn(INPUT, "h-7 w-24 font-mono")} aria-label="Highlight colour" data-title-highlight />
                      </label>
                      {(t.kind === "words" || !!t.wordAt?.length) && (
                        <label className="flex items-center gap-1" title="When each word appears, seconds after the start, e.g. 0 0.4 0.8; empty spreads them evenly before the fade">
                          Words at
                          <input type="text" key={`${t.id}:${(t.wordAt ?? []).join(",")}`} defaultValue={(t.wordAt ?? []).join(" ")} onBlur={(e) => patchTitle(t.id, { wordAt: parseWordAt(e.target.value) })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={cn(INPUT, "h-7 w-40 font-mono")} aria-label="Word times" data-title-wordat />
                        </label>
                      )}
                    </div>
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
            {tab === "shorts" && (
              <ShortsPanel
                shorts={shorts}
                current={shortMode ? activeShort : null}
                duration={duration}
                fps={fps}
                playhead={playhead}
                busy={!!job}
                titlesCount={activeShort ? project.titles.filter((t) => t.short === activeShort.id).length : 0}
                checks={shortPreflight}
                seam={seam}
                withoutMusic={withoutMusic}
                loop={loop}
                postText={shortPost}
                onSelect={(id) => selectShort(id, true)}
                onChange={updateShort}
                onAdd={() => void addShortAt(playhead)}
                onRemove={removeShort}
                onDuplicate={duplicateShort}
                onMove={moveShort}
                onJump={stepTo}
                onMarkIn={() => shortActionsRef.current.markIn()}
                onMarkOut={() => shortActionsRef.current.markOut()}
                onNudge={(end, delta) => shortActionsRef.current.nudge(end, delta)}
                onLength={shortLength}
                onLoopToggle={() => setLoop((l) => !l)}
                onFindSeam={() => void findSeam()}
                onSuggest={(count, seconds) => void suggestShorts(count, seconds)}
                onExport={(all) => void startShortExport(all)}
                onWithoutMusic={setWithoutMusic}
                onSaveCover={() => void saveShortCover()}
                onCopyPost={() => void copyShortPost()}
                onTitles={() => setTab("titles")}
                onAction={onShortAction}
                beats={project.music.find((m) => m.beats)?.beats ? { bpm: project.music.find((m) => m.beats)!.beats!.bpm, count: beats.length } : null}
                hasMusic={project.music.length > 0}
                onAnalyseBeats={() => { const m = project.music[0]; if (m) void analyseTrackBeats(m.id); }}
                onCutToBeats={cutShortToBeats}
                onPunchIns={punchShort}
                onSlowHalf={slowShort}
              />
            )}
            {tab === "export" && (
              <>
                <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-edge p-0.5 text-[12.5px]" role="tablist" aria-label="Export views">
                  {(["setup", "files"] as const).map((v) => (
                    <button key={v} type="button" role="tab" aria-selected={exportView === v} onClick={() => setExportView(v)} className={cn("h-7 flex-1 rounded-[var(--radius-sm)] px-2 transition-colors", exportView === v ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink")} data-export-view={v}>
                      {v === "setup" ? "Export" : `Files${files.length ? ` · ${files.length}` : ""}`}
                    </button>
                  ))}
                </div>
                {exportView === "files" ? (
                  <ExportFiles files={files} loading={filesLoading} onRefresh={() => void loadFiles()} onCheck={(n, depth) => void checkFile(n, depth)} onCancelCheck={cancelDoctor} canFix={canFix} onFixFinding={(n, f) => void fixFinding(n, f, "files")} onFix={(n) => void fixByName(n)} onDelete={(n) => void deleteFile(n)} fix={fixView} busy={!!job} resumable={resumableView} onResume={() => void runExport(resumable)} onDiscard={() => void discardParts()} hasFolder={store.hasFolder} />
                ) : (
                  <>
                    <ExportSummary name={exportName === null ? autoName : exportName} auto={exportName === null} onName={setExportName} folder={folder} onPickFolder={() => void chooseFolder()} lines={summaryLines} estimate={estimate} basis={estimateBasis} blockers={blockers} busy={!!job} hasClips={project.clips.length > 0} onExport={startExport} onTest={() => void renderPreview()} testLine={testLine} />
                    <PresetsRow current={matchPreset(project.export)} onPick={(id) => setProject((p) => ({ ...p, export: applyPreset(p.export, id) }))} />
                    <Preflight items={checks} onAction={onPreflightAction} />
                    <Section id="range" title="Range" summary={range ? `${fmtTime(range.from)} → ${fmtTime(range.to)} · ${fmtTime(range.to - range.from)}` : `Whole timeline · ${fmtTime(duration)}`} open={!!openSections.range} onToggle={() => toggleSection("range")} hook="export-range">
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
                      <p className="text-[12px] text-faint">Export a part of the timeline to check a grade quickly or to cut one section for a short; the band on the timeline shows it.</p>
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                        <Link href="/media/shorts?from=editor" className={cn(GHOST, "h-7 text-[12px]")} title="The Shorts & Reels Maker opens this project's footage, as trimmed and graded, and plans vertical shorts from it cut on the beat" data-make-shorts>
                          <Clapperboard size={12} /> Make shorts from this project
                        </Link>
                        <span>Vertical shorts, planned from the liveliest moments and cut on the beat, in their own folder.</span>
                      </div>
                    </Section>
                    <Section id="picture" title="Picture" summary={pictureLine} open={!!openSections.picture} onToggle={() => toggleSection("picture")} hook="export-picture">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[12.5px] text-muted">
                          Codec
                          <select value={project.export.codec} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, codec: e.target.value as "hevc" | "avc" } }))} className={cn(SEL, "mt-1 w-full")} data-export-codec>
                            <option value="hevc">HEVC / H.265 — for 8K and 4K</option>
                            <option value="avc">H.264 — plays anywhere</option>
                          </select>
                        </label>
                        <label className="text-[12.5px] text-muted">
                          Resolution
                          <select value={String(project.export.resolution)} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, resolution: e.target.value === "source" ? "source" : Number(e.target.value) } }))} className={cn(SEL, "mt-1 w-full")} data-export-resolution>
                            <option value="source">Source{sizeFor("source") ? ` (${sizeFor("source")})` : ""}</option>
                            <option value="2160">4K{frameChosen === "source" ? " (2160p)" : sizeFor(2160) ? ` (${sizeFor(2160)})` : ""}</option>
                            <option value="1440">1440p{frameChosen !== "source" && sizeFor(1440) ? ` (${sizeFor(1440)})` : ""}</option>
                            <option value="1080">1080p{frameChosen !== "source" && sizeFor(1080) ? ` (${sizeFor(1080)})` : ""}</option>
                          </select>
                        </label>
                        <label className="text-[12.5px] text-muted">
                          Frame
                          <select value={frameChosen} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, frame: e.target.value as Frame } }))} className={cn(SEL, "mt-1 w-full")} data-export-frame title="A vertical, square or portrait frame shows a window of the picture — Shorts, Reels and TikTok take 9:16. Where the window sits is set per clip in Transform; the whole timeline is re-encoded">
                            {FRAMES.map((f) => (
                              <option key={f} value={f}>
                                {FRAME_LABELS[f]}
                                {f === "9:16" ? " — Shorts, Reels, TikTok" : f === "4:5" ? " — Instagram feed" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[12.5px] text-muted">
                          Layout
                          <select value={layoutChoice(project.layout)} disabled={frameChosen === "source"} onChange={(e) => setProject((p) => ({ ...p, layout: LAYOUT_CHOICES.find((c) => c.id === e.target.value)?.layout ?? null }))} className={cn(SEL, "mt-1 w-full")} data-export-layout title="How the frame is filled: the window alone, the whole picture fitted over a blurred copy of the window or over black, or the whole picture along one edge with the window in the rest">
                            {LAYOUT_CHOICES.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[12.5px] text-muted">
                          Encoder
                          <select value={project.export.preset} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, preset: e.target.value as "quality" | "balanced" | "fast" } }))} className={cn(SEL, "mt-1 w-full")} data-export-preset>
                            <option value="quality">Quality — slower, best picture</option>
                            <option value="balanced">Balanced</option>
                            <option value="fast">Fast — quicker, slightly softer</option>
                          </select>
                        </label>
                        <label className="text-[12.5px] text-muted">
                          LED flicker
                          <select value={project.export.steadyLights ?? "off"} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, steadyLights: e.target.value as SteadyLights } }))} className={cn(SEL, "mt-1 w-full")} aria-label="LED flicker" title="LED signs and lights pulse faster than the shutter and blink on camera; Steady lights holds each light at its brightest over the last two or three frames so it stays lit. Fast-moving lights at night can leave a short trail — prefer 2 frames then">
                            <option value="off">Leave as recorded</option>
                            <option value="light">Steady lights — hold over 2 frames</option>
                            <option value="strong">Steady lights — hold over 3 frames</option>
                          </select>
                        </label>
                      </div>
                      <Slider label="Video bitrate" value={project.export.bitrateMbps} min={10} max={300} step={5} onChange={(v) => setProject((p) => ({ ...p, export: { ...p.export, bitrateMbps: v } }))} format={(v) => `${v} Mbps`} />
                      <label className="flex items-center gap-1.5 text-muted" title="Stretches with no grade, crop or scaling are copied from the recording as they are — whole keyframe groups, at the recording's own quality, with no decoding or encoding. Only the frames from a cut to the next keyframe, and those under a transition or a title, are re-encoded">
                        <input type="checkbox" checked={project.export.smartCopy} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, smartCopy: e.target.checked } }))} className="accent-[var(--accent)]" data-export-smart-copy />
                        Smart copy — copy untouched footage as it is; re-encode only around cuts, transitions and titles
                      </label>
                      <p className="text-[12px] text-faint" data-export-reencode>
                        {estimate.copySeconds > 0 ? `${fmtTime(estimate.copySeconds)} copied as is · ` : ""}
                        {fmtTime(estimate.encodeSeconds)} re-encoded{spans.some((sp) => sp.kind === "encode") ? ` (${[...new Set(spans.flatMap((sp) => sp.reasons))].join(", ") || "titles"})` : ""}
                      </p>
                    </Section>
                    <Section id="sound" title="Sound" summary={soundLine} open={!!openSections.sound} onToggle={() => toggleSection("sound")} hook="export-sound">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-muted">
                          Mix
                          <select value={project.sound ?? "footage"} onChange={(e) => setProject((p) => ({ ...p, sound: e.target.value as SoundMode }))} className={SEL} aria-label="Sound mode" data-sound-mode>
                            {SOUND_MODES.map((m) => (
                              <option key={m} value={m}>
                                {SOUND_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-muted">
                          AAC
                          <select value={project.export.audioBitrateKbps} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, audioBitrateKbps: Number(e.target.value) } }))} className={SEL} aria-label="Audio bitrate" data-export-audio-bitrate>
                            {[128, 192, 256, 320].map((b) => (
                              <option key={b} value={b}>
                                {b} kbps
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="font-mono text-[12.5px] text-ink" data-sound-levels>
                          Camera sound {fmtDb(levels.camera)} · Music {fmtDb(levels.music)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted" data-sound-state>
                          {describeSoundState(soundSt, levels)}
                        </span>
                        {soundSt.clipsOther + soundSt.musicOther > 0 && (
                          <button type="button" onClick={() => setProject((p) => applySoundLevels(p))} className={cn(GHOST, "border-accent text-accent")} data-sound-apply>
                            Set every clip and track to these levels
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-1.5">
                        <button type="button" onClick={() => void measureMix()} disabled={!placed.length || !!job} className={GHOST} data-measure-loudness>
                          <Gauge size={13} /> Measure loudness
                        </button>
                        {loudness && (
                          <span className={cn("font-mono text-[12.5px]", loudness.predicted || loudness.fingerprint === audioKey ? "text-ink" : "text-faint")} data-loudness-result>
                            {loudness.predicted ? "about " : ""}
                            {describeLoudness(loudness.result)}
                            {loudness.predicted ? " after the change — measure again to confirm" : loudness.fingerprint !== audioKey ? " · measured before the last change" : ""}
                          </span>
                        )}
                        {loudness && !loudness.predicted && loudness.result.integrated !== null && Math.abs(matchGain) >= 0.5 && (
                          <button type="button" onClick={matchLevel} className={cn(GHOST, "border-accent text-accent")} data-match-level>
                            Match YouTube level ({matchGain > 0 ? "+" : ""}
                            {matchGain} dB)
                          </button>
                        )}
                      </div>
                      {loudness && !loudness.predicted && loudness.result.integrated !== null && (
                        <p className={cn("text-[12px]", loudness.result.integrated < YOUTUBE_LUFS - 3 ? "text-warn" : "text-faint")} data-loudness-verdict>
                          {loudness.result.integrated < YOUTUBE_LUFS - 1
                            ? `This mix would play ${(YOUTUBE_LUFS - loudness.result.integrated).toFixed(1)} dB quieter than YouTube's level${matchGain < YOUTUBE_LUFS - loudness.result.integrated - 0.1 ? ` — its peaks allow raising it ${matchGain} dB` : ""}.`
                            : loudness.result.integrated > YOUTUBE_LUFS + 1
                              ? `YouTube would turn this mix down by ${(loudness.result.integrated - YOUTUBE_LUFS).toFixed(1)} dB.`
                              : "At YouTube's level."}
                        </p>
                      )}
                      <p className="text-[12px] text-faint">A music video keeps the music at full level with the camera sound underneath; footage keeps its own sound in front. YouTube plays everything at {YOUTUBE_LUFS} LUFS and never turns a quiet video up; Measure runs the export&apos;s mix over the {range ? "export range" : "whole timeline"} without writing anything, and Match moves every clip and track together as far as the peaks allow.</p>
                    </Section>
                    <Section id="tags" title="File tags" summary={tagsLine} open={!!openSections.tags} onToggle={() => toggleSection("tags")} hook="export-tags">
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="col-span-2 text-muted">
                          Title
                          <input value={project.export.tags.title} onChange={(e) => setTags({ title: e.target.value })} placeholder={project.name} className={cn(INPUT, "mt-0.5")} aria-label="Tag title" data-tag-title />
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
                        <label className="text-muted">
                          Kind
                          <select value={project.export.tags.kind} onChange={(e) => setTags({ kind: e.target.value as ExportTags["kind"] })} className={cn(SEL, "mt-0.5 w-full")} aria-label="Media kind" data-tag-kind>
                            <option value="music-video">Music video</option>
                            <option value="video">Plain video</option>
                          </select>
                        </label>
                        <label className="text-muted">
                          Comment
                          <input value={project.export.tags.comment} onChange={(e) => setTags({ comment: e.target.value })} className={cn(INPUT, "mt-0.5")} aria-label="Tag comment" />
                        </label>
                      </div>
                      <p className="text-[12px] text-faint">
                        Written into the MP4 as the iTunes-style atoms ffmpeg writes. YouTube takes the title from the file; the Music category and the song credits are set on the upload page. For a file you already have, use the{" "}
                        <Link href="/media/mp4-tags" className="text-accent underline-offset-2 hover:underline">
                          MP4 tag editor
                        </Link>
                        .
                      </p>
                    </Section>
                    <Section id="options" title="Options" summary={optionsLine} open={!!openSections.options} onToggle={() => toggleSection("options")} hook="export-options">
                      <label className="flex flex-wrap items-center gap-1.5 text-muted" data-review-setting>
                        Before the export
                        <select value={project.export.review ?? "on"} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, review: e.target.value as "on" | "off" } }))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Checklist before export" title="The editor's checklist: the cuts and transitions, the intro and every title, the camera sound and the music, the loudness, the tags, the chapters and the thumbnail — summarised from the project and ticked off before the file is written" data-export-review>
                          <option value="on">show the editor&apos;s checklist, summarised from the project</option>
                          <option value="off">export straight away</option>
                        </select>
                      </label>
                      <label className="flex flex-wrap items-center gap-1.5 text-muted" data-check-setting>
                        After the export, the doctor
                        <select value={project.export.check ?? "full"} onChange={(e) => setProject((p) => ({ ...p, export: { ...p.export, check: e.target.value as "full" | "quick" | "off" } }))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Check the finished file" title="The finished file is checked for the defects that stall YouTube's processing: a full scan reads every packet, decodes the whole soundtrack and the picture at every cut (minutes on a big file); a quick check reads only the index (seconds)" data-export-check>
                          <option value="full">scans the whole file — every packet, the sound, the picture at every cut</option>
                          <option value="quick">checks the index only — seconds</option>
                          <option value="off">does nothing</option>
                        </select>
                      </label>
                      <label className="flex flex-wrap items-center gap-1.5 text-muted" data-notify-setting>
                        <input type="checkbox" checked={notify} onChange={(e) => setNotifySetting(e.target.checked)} className="accent-[var(--accent)]" />
                        Notify about progress while this tab is hidden, and when an export finishes
                        {notifyPermission === "denied" && <span className="text-warn">— blocked in the browser; allow notifications for this site to get them</span>}
                        {notifyPermission === "unsupported" && <span className="text-faint">— not available in this browser</span>}
                      </label>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted" data-preview-render>
                        <span className="font-medium text-ink">Test render</span>
                        <label className="flex items-center gap-1.5">
                          Size
                          <select value={previewOpts.height} onChange={(e) => setPreviewOpts((o) => ({ ...o, height: Number(e.target.value) }))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Test render size">
                            {[180, 240, 360, 540, 720].map((h) => (
                              <option key={h} value={h}>
                                {h}p
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          Stretch
                          <select value={previewOpts.scope} onChange={(e) => setPreviewOpts((o) => ({ ...o, scope: e.target.value as typeof previewOpts.scope }))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Test render stretch">
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
                      <p className="text-[12px] text-faint">A test render runs the real export — the same spans, grades, transitions, intro effects, titles and steady lights — small and short, into the browser&apos;s private storage, and plays it in the preview box so cuts can be checked frame by frame. The export itself can run with the tab hidden or the window minimised: the page holds a lock so the browser does not freeze it, keeps the display awake while visible, and the tab title carries the progress.</p>
                    </Section>
                  </>
                )}
              </>
            )}
          </div>
          </div>
        </div>
      </>} />
        } second={timelinePanel} />
      {reviewOpen && (
        <ExportReview
          review={review}
          ticked={ticked}
          onTick={(id, key, on) => {
            const next = { ...ticked };
            if (on) next[id] = key;
            else delete next[id];
            saveTicks(next);
          }}
          onTickAll={(on) => saveTicks(on ? Object.fromEntries(review.items.map((i) => [i.id, i.key])) : {})}
          onAction={onReviewAction}
          onCancel={() => setReviewOpen(false)}
          onExport={() => {
            setReviewOpen(false);
            void runExport();
          }}
          busy={!!job}
          fileLine={`${fileName} · ${summaryLines.join(" · ")}`}
        />
      )}
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
