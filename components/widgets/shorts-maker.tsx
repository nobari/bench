"use client";

/**
 * The Shorts & Reels Maker: a drive's recordings (or a Video Editor project) in, vertical shorts out — planned from
 * the liveliest moments cut on the music's beat, framed per scene, captioned inside the platforms' safe area,
 * exported as the file YouTube Shorts, Instagram Reels and TikTok take, with the words to post. Every short is an
 * ordinary editor project in its own sub-folder of the shorts folder; nothing is copied.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import { Camera, Clapperboard, Download, FolderOpen, Loader, Music, Pause, Play, Plus, RefreshCw, Sparkles, Trash2, Upload, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnsavedWork, confirmLeave } from "@/lib/unsaved-work";
import { ProjectStore, PROJECT_FILE, hasFileSystemAccess, rememberFolder, rememberedFolder } from "@/lib/tools/video/store";
import { SET_FILE, deserializeSet, entryFor, importEditorProject, newSet, serializeSet, shortFolderName, sourceProject, type ShortEntry, type ShortsSet } from "@/lib/tools/video/shortset";
import { SHORT_ORDERS, candidatesIn, describePlan, needSeconds, planShort, sceneCount, shortSeconds, stretches, type PlanSettings } from "@/lib/tools/video/shortplan";
import { BEATS_PER_CUT, analyseBeats, type BeatGrid, type BeatsPerCut } from "@/lib/tools/video/beats";
import { PLATFORMS, SHORT_LENGTHS, lengthFor, postCopy, postingNotes, shortLimits } from "@/lib/tools/video/shorts";
import { FRAME_LABELS, LAYOUT_KINDS, MAX_REFRAME_ZOOM, NEUTRAL_GRADE, NEUTRAL_TRANSFORM, TRANSITIONS, clipSpeed, deserialize, estimateExport, exportFingerprint, fmtTime, newId, newTitle, orderRecordings, placeClips, planExport, soundLevels, type Clip, type Layout, type MediaRef, type Project, type ReframeKey, type Title } from "@/lib/tools/video/project";
import { outputSize, sizeText } from "@/lib/tools/video/reframe";
import { INTRO_STYLES } from "@/lib/tools/video/intro";
import { buildProxy, decodeMono, encoderSupport, exportProject, measureLoudness, probe, renderFrame, scanMoments, scanMotionColumns, type ExportFault } from "@/lib/tools/video/engine";
import { scoreMoments } from "@/lib/tools/video/intro";
import { fmtBytes, defaultSpeeds } from "@/lib/tools/video/progress";
import { applyPreset, matchPreset } from "@/lib/tools/video/export-presets";
import { preflight } from "@/lib/tools/video/preflight";
import { gainToReach, YOUTUBE_LUFS, type Loudness } from "@/lib/tools/video/loudness";
import { diagnose, type DoctorReport } from "@/lib/tools/video/doctor";
import { parseTemplateImport, videoTemplate } from "@/lib/tools/video/template";
import { ExportDone, ExportRun, Preflight, PresetsRow, Section, type DoneResult, type ExportJobView, type RunEvent } from "./video-export";
import { PhonePreview, PlatformChips, PostCopyView, SceneStrip, Slider, type SceneView } from "./shorts-parts";
import { GHOST, INPUT, PRIMARY, SEL } from "./video-styles";

type StepId = "source" | "plan" | "cut" | "frame" | "text" | "export";
const STEPS: { id: StepId; title: string }[] = [
  { id: "source", title: "Source" },
  { id: "plan", title: "Plan" },
  { id: "cut", title: "Cut" },
  { id: "frame", title: "Frame" },
  { id: "text", title: "Text & sound" },
  { id: "export", title: "Export & post" },
];

const LAYOUT_CHOICES: { id: string; label: string; layout: Layout | null }[] = [
  { id: "fill", label: "The window fills the frame", layout: null },
  { id: "fit-blur", label: "Whole picture over a blurred copy", layout: { kind: "fit", background: "blur" } },
  { id: "fit-black", label: "Whole picture over black", layout: { kind: "fit", background: "black" } },
  { id: "stack-top", label: "Whole picture above the window", layout: { kind: "stack", wideAt: "top" } },
  { id: "stack-bottom", label: "Whole picture below the window", layout: { kind: "stack", wideAt: "bottom" } },
];
const layoutChoice = (l: Layout | null | undefined) => (!l || l.kind === "fill" ? "fill" : l.kind === "fit" ? (l.background === "blur" || !l.background ? "fit-blur" : "fit-black") : l.wideAt === "bottom" ? "stack-bottom" : "stack-top");

/** Three caption looks: outlined text alone, text on a dark pill, text in a box. */
const CAPTION_STYLES: { id: string; name: string; patch: Partial<Title> }[] = [
  { id: "outline", name: "Outline", patch: { background: "", shadow: "outline", shadowColor: "rgba(0,0,0,0.85)", padding: 0.4, radius: 0.15 } },
  { id: "pill", name: "Pill", patch: { background: "rgba(0,0,0,0.6)", shadow: "none", padding: 0.5, radius: 0.6 } },
  { id: "box", name: "Box", patch: { background: "rgba(255,255,255,0.9)", color: "#111111", shadow: "none", padding: 0.5, radius: 0.1 } },
];
const captionStyle = (t: Title) => (t.background === "" ? "outline" : t.background.startsWith("rgba(255") ? "box" : "pill");

const QUICK_CAPTIONS = ["Wait for it", "POV: night drive", "Sound on", "Full drive on the channel"];

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "Short";

export function ShortsMakerWidget() {
  const router = useRouter();
  const [from] = useQueryState("from", parseAsString.withDefault(""));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setStore = useMemo(() => new ProjectStore(setStatus, { lastKey: "lastShortsFolder", pickerId: "bench-shorts-folder" }), []);
  const shortStore = useMemo(() => new ProjectStore(undefined, { lastKey: "lastShortsShort", pickerId: "bench-shorts-short" }), []);
  const [folder, setFolder] = useState<string | null>(null);
  const [set, setSetState] = useState<ShortsSet>(() => newSet());
  const setRef = useRef(set);
  setRef.current = set;
  const [short, setShortState] = useState<Project | null>(null);
  const shortRef = useRef(short);
  shortRef.current = short;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [missing, setMissing] = useState(0);
  const [open, setOpen] = useState<Record<StepId, boolean>>({ source: true, plan: false, cut: false, frame: false, text: false, export: false });
  const [job, setJob] = useState<(ExportJobView & { kind: "export" | "scan" | "proxy" | "beats" | "render" | "loudness" | "cover"; fraction: number; abort: AbortController; message?: string }) | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [done, setDone] = useState<DoneResult | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ url: string; bytes: number } | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [ghost, setGhost] = useState(true);
  const [scan, setScan] = useState<boolean | null>(null);
  const [withoutMusic, setWithoutMusic] = useState(false);
  const [coverTitles, setCoverTitles] = useState(true);
  const [loudness, setLoudness] = useState<{ result: Loudness; key: string } | null>(null);
  const [outSupport, setOutSupport] = useState<{ hevc: boolean; avc: boolean; w: number; h: number } | null>(null);
  const [editorFolder, setEditorFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const musicInput = useRef<HTMLInputElement | null>(null);
  const templateInput = useRef<HTMLInputElement | null>(null);

  useUnsavedWork(job ? "Work is running in the Shorts Maker; leaving now would abandon it." : null);

  /* ------------------------------------------------------------- the set */
  const saveSetSoon = useCallback(
    (next: ShortsSet) => {
      if (!setStore.hasFolder) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setStore.writeText(SET_FILE, serializeSet(next)).catch(() => setStatus("Could not save the shorts file"));
      }, 800);
    },
    [setStore],
  );
  const setSet = useCallback(
    (fn: (s: ShortsSet) => ShortsSet) => {
      setSetState((s) => {
        const next = fn(s);
        saveSetSoon(next);
        return next;
      });
    },
    [saveSetSoon],
  );
  const setShort = useCallback(
    (fn: (p: Project) => Project) => {
      setShortState((p) => {
        if (!p) return p;
        const next = { ...fn(p), updatedAt: Date.now() };
        shortStore.autosave(next);
        return next;
      });
    },
    [shortStore],
  );

  /** A recording's proxy when there is one, else the file itself — for scans, thumbs and the preview. */
  const fileFor = useCallback(
    async (id: string): Promise<File | null> => {
      const px = setRef.current.proxies[id];
      if (px?.ready && px.file) {
        const f = await setStore.proxyFile(px.file);
        if (f) return f;
      }
      return setStore.getFile(id);
    },
    [setStore],
  );

  const resolveMedia = useCallback(
    async (s: ShortsSet, interactive: boolean) => {
      await setStore.restoreHandles(s.id, interactive);
      await setStore.loadFolders(s.id, interactive);
      for (const m of Object.values(s.media)) if (!setStore.hasFile(m.id) && m.where) await setStore.locateByPath(m.id, m.where);
      for (const m of Object.values(s.media)) if (!setStore.hasFile(m.id)) await setStore.resolveByName(m.id, m.name);
      setMissing(setStore.missing(Object.keys(s.media)).length);
    },
    [setStore],
  );

  const openShort = useCallback(
    async (entry: ShortEntry) => {
      const root = setStore.directory;
      if (!root) return;
      try {
        const sub = await root.getDirectoryHandle(entry.folder);
        await shortStore.adopt(sub, false);
        const loaded = await shortStore.load();
        if (!loaded) throw new Error(`No project in ${entry.folder}`);
        for (const id of Object.keys(loaded.project.media)) {
          const h = setStore.handleOf(id);
          if (h) shortStore.registerFile(id, h);
        }
        setShortState(loaded.project);
        setActiveId(entry.id);
        setSelectedScene(loaded.project.clips[0]?.id ?? null);
        setPlayhead(0);
        setDone(null);
        setRendered(null);
        setLoudness(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setStore, shortStore],
  );

  const loadSet = useCallback(
    async (interactive: boolean) => {
      const text = await setStore.readText(SET_FILE);
      const s = (text && deserializeSet(text)) || newSet(setStore.folderName ?? "Shorts");
      await resolveMedia(s, interactive);
      setSetState(s);
      if (s.shorts.length) await openShort(s.shorts[0]);
      else {
        setShortState(null);
        setActiveId(null);
      }
      return s;
    },
    [setStore, resolveMedia, openShort],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      if (!hasFileSystemAccess()) return;
      const dir = await rememberedFolder("lastFolder");
      if (active && dir) setEditorFolder(dir);
      if (!(await setStore.reopenLast())) return;
      if (!active) return;
      setFolder(setStore.folderName);
      await loadSet(false);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [setStore, loadSet]);

  const pickFolder = async () => {
    try {
      await setStore.pickFolder();
      setFolder(setStore.folderName);
      const s = await loadSet(true);
      if (!s.shorts.length && !Object.keys(s.media).length) await setStore.writeText(SET_FILE, serializeSet(s));
      setStatus(`Shorts folder: ${setStore.folderName}`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  /* ------------------------------------------------------------ sources */
  const addVideos = async (inputs: (File | FileSystemFileHandle)[]) => {
    if (!setStore.hasFolder) return setError("Pick the shorts folder first.");
    const refs: MediaRef[] = [];
    for (const h of inputs) {
      const id = newId();
      const f = h instanceof File ? h : await h.getFile();
      setStore.registerFile(id, h);
      try {
        const info = await probe(f);
        if (!info.canDecode) {
          setError(`${f.name}: this browser can't decode ${info.codec ?? "that codec"}.`);
          continue;
        }
        const where = (await setStore.whereIs(h)) ?? undefined;
        refs.push({ id, name: f.name, size: f.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, codec: info.codec ?? undefined, hasAudio: info.hasAudio, sampleRate: info.sampleRate, rotation: info.rotation, ...(where ? { where } : {}) });
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "couldn't read the file."}`);
      }
    }
    if (!refs.length) return;
    const ordered = orderRecordings(refs);
    setSet((s) => ({
      ...s,
      media: { ...s.media, ...Object.fromEntries(ordered.map((m) => [m.id, m])) },
      clips: [...s.clips, ...ordered.map((m): Clip => ({ id: newId(), media: m.id, in: 0, out: m.duration, transform: { ...NEUTRAL_TRANSFORM, crop: { ...NEUTRAL_TRANSFORM.crop } }, grade: { ...NEUTRAL_GRADE }, gainDb: -12, muted: false }))],
    }));
    void setStore.persistHandles(setRef.current.id);
    setMissing(0);
    setStatus(`${ordered.length} recording${ordered.length === 1 ? "" : "s"} added`);
  };

  const addMusic = async (h: File | FileSystemFileHandle) => {
    if (!setStore.hasFolder) return setError("Pick the shorts folder first.");
    const id = newId();
    const f = h instanceof File ? h : await h.getFile();
    setStore.registerFile(id, h);
    try {
      const info = await probe(f);
      const where = (await setStore.whereIs(h)) ?? undefined;
      const ref: MediaRef = { id, name: f.name, size: f.size, duration: info.duration, hasAudio: true, sampleRate: info.sampleRate, ...(where ? { where } : {}) };
      setSet((s) => ({ ...s, media: { ...s.media, [id]: ref }, music: { media: id, grid: null } }));
      void setStore.persistHandles(setRef.current.id);
      await analyseMusic(id, f);
    } catch (e) {
      setError(`${f.name}: ${e instanceof Error ? e.message : "couldn't read the file."}`);
    }
  };

  const analyseMusic = async (id: string, file?: File) => {
    const f = file ?? (await setStore.getFile(id));
    if (!f) return setError("The music file is not at hand.");
    const abort = new AbortController();
    setJob({ kind: "beats", label: `Reading the beats of ${f.name}`, fraction: 0, abort });
    try {
      const { pcm, sampleRate } = await decodeMono(f, { signal: abort.signal, onProgress: (d, t) => setJob((j) => (j ? { ...j, fraction: (d / Math.max(1, t)) * 0.7 } : j)) });
      const grid: BeatGrid = analyseBeats(pcm, sampleRate);
      setSet((s) => (s.music?.media === id ? { ...s, music: { media: id, grid } } : s));
      setStatus(`${grid.bpm} BPM, ${grid.beats.length} beats${grid.drop !== null ? `, the drop at ${fmtTime(grid.drop)}` : ""}${grid.confidence < 0.25 ? " — the beat is faint; cuts may not land" : ""}`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  /** Bring in a Video Editor project folder: its recordings in order with their grades, its LUT and its music. */
  const importEditor = async (dir?: FileSystemDirectoryHandle) => {
    if (!setStore.hasFolder) return setError("Pick the shorts folder first.");
    try {
      const picked = dir ?? (await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: "bench-video-project", mode: "read" }));
      type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
      const perm = picked as unknown as Perm;
      let state = await perm.queryPermission({ mode: "read" }).catch(() => "denied");
      if (state === "prompt") state = await perm.requestPermission({ mode: "read" }).catch(() => "denied");
      if (state !== "granted") return setError("The browser did not grant access to that folder.");
      const text = await (await (await picked.getFileHandle(PROJECT_FILE)).getFile()).text();
      const project = deserialize(text);
      if (!project) return setError(`${picked.name} holds no Video Editor project.`);
      const key = await setStore.addFolder(setRef.current.id, picked);
      // Files inside that folder are found by their place; others by name near it.
      const media: Record<string, MediaRef> = {};
      for (const m of Object.values(project.media)) {
        const where = m.where?.folder === "project" ? { folder: key, path: m.where.path } : undefined;
        let found = where ? await setStore.locateByPath(m.id, where) : false;
        if (!found) found = !!(await setStore.findInFolder(key, m.name, m.id));
        media[m.id] = { ...m, where: where ?? (found ? ((await setStore.whereIs(setStore.handleOf(m.id) as FileSystemFileHandle)) ?? undefined) : undefined) };
      }
      const next = importEditorProject({ ...setRef.current, folders: { ...(setRef.current.folders ?? {}), [key]: picked.name } }, { ...project, media });
      // Proxies live in the editor's folder, not here: they are not carried over.
      setSet(() => ({ ...next, proxies: setRef.current.proxies }));
      await setStore.persistHandles(setRef.current.id);
      setMissing(setStore.missing(Object.keys(next.media)).length);
      if (next.music && !next.music.grid) void analyseMusic(next.music.media);
      setStatus(`Opened ${project.name}: ${project.clips.filter((c) => !c.introRole).length} clips${project.music.length ? ", its music" : ""}, as graded`);
      setOpen((o) => ({ ...o, plan: true }));
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    }
  };

  const makeProxies = async () => {
    const s = setRef.current;
    const ids = [...new Set(s.clips.map((c) => c.media))].filter((id) => !s.proxies[id]?.ready);
    for (const id of ids) {
      const m = s.media[id];
      const f = await setStore.getFile(id);
      if (!m || !f) continue;
      const name = `${id}.proxy360.mp4`;
      const abort = new AbortController();
      setJob({ kind: "proxy", label: `360p proxy for ${m.name}`, fraction: 0, abort });
      try {
        const { writable } = await setStore.createWritable(name, "proxies");
        await buildProxy(f, writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, 360, (fr) => setJob((j) => (j ? { ...j, fraction: fr } : j)), abort.signal);
        setSet((x) => ({ ...x, proxies: { ...x.proxies, [id]: { ready: true, file: name } } }));
      } catch (e) {
        if ((e as DOMException).name === "AbortError") break;
        setError(`Proxy failed for ${m.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setJob(null);
      }
    }
  };

  const removeSource = (id: string) => {
    setSet((s) => ({ ...s, clips: s.clips.filter((c) => c.media !== id), media: Object.fromEntries(Object.entries(s.media).filter(([k]) => k !== id || s.music?.media === id)) }));
  };

  /* --------------------------------------------------------------- plan */
  const plan = set.plan;
  const setPlan = (patch: Partial<PlanSettings>) => setSet((s) => ({ ...s, plan: { ...s.plan, ...patch, seconds: Math.min(patch.seconds ?? s.plan.seconds, lengthFor(patch.targets ?? s.plan.targets).max) } }));
  const grid = set.music?.grid ?? null;
  const sourceMedia = useMemo(() => [...new Set(set.clips.map((c) => c.media))].map((id) => set.media[id]).filter(Boolean), [set.clips, set.media]);
  const driveSeconds = useMemo(() => set.clips.reduce((a, c) => a + (c.out - c.in) / clipSpeed(c), 0), [set.clips]);
  const canScanQuickly = sourceMedia.length > 0 && sourceMedia.every((m) => set.proxies[m.id]?.ready || (m.height ?? 0) <= 2160);
  const scanOn = scan ?? canScanQuickly;

  const planOne = async (index: number, count: number, source: Project, stretch: { from: number; to: number }, signal: AbortSignal): Promise<Project> => {
    const s = setRef.current;
    const placed = placeClips(source.clips);
    const n = sceneCount(s.plan, grid);
    const perWindow = scanOn ? 3 : 1;
    let windows = candidatesIn(placed, stretch.from, stretch.to, n, perWindow, needSeconds(s.plan, grid));
    if (perWindow > 1) {
      try {
        const stats = await scanMoments(fileFor, source, windows, { signal, onProgress: (d, t) => setJob((j) => (j ? { ...j, fraction: (index + d / Math.max(1, t)) / count, message: `${index + 1} of ${count}: ${d} of ${t} candidates` } : j)) });
        windows = scoreMoments(windows, stats);
      } catch (e) {
        if ((e as DOMException).name === "AbortError") throw e;
        setStatus("Couldn't scan the footage; the moments are spaced evenly instead.");
      }
    }
    const music = s.music && s.media[s.music.media] ? { media: s.media[s.music.media], grid: s.music.grid } : null;
    const name = count > 1 ? `${s.name} ${index + 1}` : s.name;
    return planShort({ name, source, windows, settings: s.plan, music, index: index + 1, of: count });
  };

  /** Save a planned short into its own sub-folder and list it in the set; returns its entry. */
  const storeShort = async (project: Project, folderName: string): Promise<ShortEntry> => {
    const root = setStore.directory;
    if (!root) throw new Error("Pick the shorts folder first.");
    const sub = await root.getDirectoryHandle(folderName, { create: true });
    const tmp = new ProjectStore(undefined, { lastKey: "lastShortsShort" });
    await tmp.adopt(sub, false);
    for (const id of Object.keys(project.media)) {
      const h = setStore.handleOf(id);
      if (h) tmp.registerFile(id, h);
    }
    await tmp.save(project);
    return entryFor(project, folderName, shortSeconds(project));
  };

  const makeShorts = async () => {
    const s = setRef.current;
    if (!s.clips.length) return setError("Add recordings, or open a Video Editor project, first.");
    if (job) return;
    const source = sourceProject(s);
    const placed = placeClips(source.clips);
    const count = Math.max(1, Math.min(20, s.plan.count));
    const parts = stretches(placed, count);
    const abort = new AbortController();
    setJob({ kind: "scan", label: count > 1 ? `Planning ${count} shorts` : "Planning the short", fraction: 0, abort });
    try {
      const entries: ShortEntry[] = [];
      const base = s.shorts.length;
      for (let i = 0; i < parts.length; i++) {
        const project = await planOne(i, count, source, parts[i], abort.signal);
        if (!project.clips.length) continue;
        entries.push(await storeShort(project, shortFolderName(base + i + 1, project.name)));
      }
      setSet((x) => ({ ...x, shorts: [...x.shorts, ...entries] }));
      if (entries[0]) await openShort(entries[0]);
      setOpen((o) => ({ ...o, plan: false, cut: true }));
      setStatus(`${entries.length} short${entries.length === 1 ? "" : "s"} planned — ${scanOn ? "the liveliest moments of each stretch" : "moments spaced evenly across each stretch"}, ${grid ? `cut on the beat at ${grid.bpm} BPM` : `a scene every ${s.plan.sceneSeconds} s`}`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  /** Plan the active short again from its stretch, keeping its name and folder. */
  const replan = async () => {
    const s = setRef.current;
    const entry = s.shorts.find((e) => e.id === activeId);
    if (!entry || !short || job) return;
    const index = s.shorts.indexOf(entry);
    const source = sourceProject(s);
    const parts = stretches(placeClips(source.clips), Math.max(1, s.shorts.length));
    const abort = new AbortController();
    setJob({ kind: "scan", label: `Planning ${short.name} again`, fraction: 0, abort });
    try {
      const planned = await planOne(index, s.shorts.length, source, parts[index] ?? parts[0], abort.signal);
      const next = { ...planned, id: short.id, name: short.name, safeArea: short.safeArea, layout: short.layout };
      await shortStore.save(next);
      setShortState(next);
      setSet((x) => ({ ...x, shorts: x.shorts.map((e) => (e.id === entry.id ? entryFor(next, e.folder, shortSeconds(next)) : e)) }));
      setSelectedScene(next.clips[0]?.id ?? null);
      setPlayhead(0);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  const removeShort = async (entry: ShortEntry) => {
    if (!window.confirm(`Remove ${entry.name}? Its folder "${entry.folder}" and anything in it are deleted; the recordings are untouched.`)) return;
    await setStore.remove(null, entry.folder);
    setSet((s) => ({ ...s, shorts: s.shorts.filter((e) => e.id !== entry.id) }));
    if (activeId === entry.id) {
      setShortState(null);
      setActiveId(null);
    }
  };

  /* ---------------------------------------------------------------- cut */
  const placed = useMemo(() => (short ? placeClips(short.clips) : []), [short]);
  const seconds = useMemo(() => (short ? shortSeconds(short) : 0), [short]);
  const first = short?.media[short.clips[0]?.media ?? ""];
  const track = short?.music[0] ?? null;
  /** A beat's length in timeline seconds when the short has a grid, for nudging scenes. */
  const beatSeconds = grid && track ? 60 / Math.max(1, grid.bpm) : null;
  /** Beat instants on the short's timeline, for the scrubber. */
  const beatTicks = useMemo(() => (grid && track ? grid.beats.map((b) => b - track.in + track.start).filter((t) => t >= 0 && t <= seconds) : []), [grid, track, seconds]);

  const defaultTransition = (p: Project, scene: number): Clip["transitionIn"] | undefined => {
    const style = INTRO_STYLES.find((st) => st.id === p.intro.style);
    const looked = p.clips.some((c) => c.introRole);
    const want = looked ? style?.transition ?? null : plan.cut === "cut" ? null : { kind: plan.cut, duration: 0.5 };
    return want ? { kind: want.kind, duration: +Math.min(want.duration, 0.4 * scene).toFixed(3) } : undefined;
  };
  /** After scenes move or go: the first has no transition in, the others keep theirs or get the plan's. */
  const restamp = (p: Project, clips: Clip[]): Clip[] =>
    clips.map((c, i) => {
      const next = { ...c };
      if (i === 0) delete next.transitionIn;
      else if (!next.transitionIn) {
        const tr = defaultTransition(p, (c.out - c.in) / clipSpeed(c));
        if (tr) next.transitionIn = tr;
      }
      return next;
    });
  const moveScene = (id: string, dir: -1 | 1) =>
    setShort((p) => {
      const i = p.clips.findIndex((c) => c.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= p.clips.length) return p;
      const clips = [...p.clips];
      [clips[i], clips[j]] = [clips[j], clips[i]];
      return { ...p, clips: restamp(p, clips) };
    });
  const removeScene = (id: string) => setShort((p) => ({ ...p, clips: restamp(p, p.clips.filter((c) => c.id !== id)) }));
  const nudgeScene = (id: string, by: number) =>
    setShort((p) => ({
      ...p,
      clips: p.clips.map((c) => {
        if (c.id !== id) return c;
        const dur = p.media[c.media]?.duration ?? c.out;
        const len = c.out - c.in;
        const start = Math.max(0, Math.min(dur - len, c.in + by * clipSpeed(c)));
        return { ...c, in: start, out: start + len };
      }),
    }));
  const lengthenScene = (id: string, delta: number) =>
    setShort((p) => ({
      ...p,
      clips: p.clips.map((c) => {
        if (c.id !== id) return c;
        const dur = p.media[c.media]?.duration ?? c.out;
        const out = Math.max(c.in + 0.25 * clipSpeed(c), Math.min(dur, c.out + delta * clipSpeed(c)));
        return { ...c, out, ...(c.introSeconds ? { introSeconds: (out - c.in) / clipSpeed(c) } : {}) };
      }),
    }));
  const setSceneSpeed = (id: string, speed: number) =>
    setShort((p) => ({
      ...p,
      clips: p.clips.map((c) => {
        if (c.id !== id) return c;
        const len = (c.out - c.in) / clipSpeed(c);
        const dur = p.media[c.media]?.duration ?? c.out;
        const out = Math.min(dur, c.in + len * speed);
        const next = { ...c, out };
        if (speed === 1) delete next.speed;
        else next.speed = speed;
        return next;
      }),
    }));

  const scenes: SceneView[] = useMemo(() => {
    if (!short) return [];
    const loopFrom = plan.loop && placed.length > 1 && placed[placed.length - 1].media === placed[0].media && Math.abs(placed[placed.length - 1].in - placed[0].in) < 1e-3 ? placed[placed.length - 1].id : null;
    return placed.map((c, i) => ({ id: c.id, index: i, start: c.start, seconds: c.end - c.start, sourceTime: c.in, speed: clipSpeed(c), thumb: thumbs.get(c.id) ?? null, transition: c.transitionIn ? (TRANSITIONS.find((t) => t.kind === c.transitionIn!.kind)?.name ?? c.transitionIn.kind) : null, isLoop: c.id === loopFrom }));
  }, [short, placed, thumbs, plan.loop]);

  // Thumbnails: one frame a third into each scene, from proxies when there are any.
  const thumbKey = placed.map((c) => `${c.id}:${c.in.toFixed(2)}:${c.out.toFixed(2)}:${c.speed ?? 1}`).join("|") + `|${short?.export.frame}|${layoutChoice(short?.layout)}|${JSON.stringify(placed.map((c) => c.reframe ?? null))}`;
  useEffect(() => {
    const p = shortRef.current;
    if (!p || !p.clips.length) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const made = new Map<string, string>();
      for (const c of placeClips(p.clips)) {
        if (abort.signal.aborted) break;
        try {
          const f = await renderFrame({ project: { ...p, titles: [] }, getFile: fileFor, logo: null, t: c.start + (c.end - c.start) * 0.35, height: 320, type: "image/jpeg", quality: 0.7 });
          made.set(c.id, URL.createObjectURL(f.blob));
        } catch {
          /* a scene without a frame shows blank */
        }
      }
      if (abort.signal.aborted) {
        for (const u of made.values()) URL.revokeObjectURL(u);
        return;
      }
      setThumbs((old) => {
        for (const u of old.values()) URL.revokeObjectURL(u);
        return made;
      });
    }, 500);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [thumbKey, fileFor]);

  /* -------------------------------------------------------------- frame */
  const selected = short?.clips.find((c) => c.id === selectedScene) ?? short?.clips[0] ?? null;
  const key: ReframeKey = selected?.reframe?.keys[0] ?? { t: 0, cx: 0.5, cy: 0.5, zoom: 1 };
  const lastKey: ReframeKey | null = selected && selected.reframe && selected.reframe.keys.length > 1 ? selected.reframe.keys[selected.reframe.keys.length - 1] : null;
  const pan = lastKey ? +(lastKey.cx - key.cx).toFixed(3) : 0;
  const setWindow = (patch: Partial<ReframeKey>, panTo?: number) => {
    if (!selected) return;
    const id = selected.id;
    setShort((p) => ({
      ...p,
      clips: p.clips.map((c) => {
        if (c.id !== id) return c;
        const start = { ...key, ...patch, t: c.in };
        const amount = panTo ?? pan;
        const keys = amount ? [start, { ...start, t: c.out, cx: Math.min(1, Math.max(0, start.cx + amount)) }] : [start];
        return { ...c, reframe: { keys } };
      }),
    }));
  };
  const applyWindowToAll = () => {
    if (!selected) return;
    const src = selected.reframe;
    setShort((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, reframe: src ? { keys: src.keys.map((k, i) => ({ ...k, t: i === 0 ? c.in : c.out })) } : undefined })) }));
  };
  const autoCentre = async () => {
    if (!selected || !short) return;
    const f = await fileFor(selected.media);
    if (!f) return setError("The recording is not at hand.");
    const abort = new AbortController();
    setJob({ kind: "scan", label: "Finding the action", fraction: 0.3, abort });
    try {
      const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((k) => selected.in + (selected.out - selected.in) * k);
      const { cx } = await scanMotionColumns(f, times, abort.signal);
      setWindow({ cx: +cx.toFixed(3) });
      setStatus(`The action sits ${Math.round((cx - 0.5) * 200)}% ${cx < 0.5 ? "left" : "right"} of centre; the window follows it`);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  /* ---------------------------------------------------------- text & sound */
  const hook = short?.titles.find((t) => t.kind === "hook") ?? null;
  const captions = useMemo(() => (short ? short.titles.filter((t) => t.kind !== "hook").sort((a, b) => a.start - b.start) : []), [short]);
  const setHookText = (text: string) =>
    setShort((p) => {
      const has = p.titles.some((t) => t.kind === "hook");
      return { ...p, titles: has ? p.titles.map((t) => (t.kind === "hook" ? { ...t, text } : t)) : [...p.titles, { ...newTitle("hook", 0, text || p.name) }] };
    });
  const patchTitle = (id: string, patch: Partial<Title>) => setShort((p) => ({ ...p, titles: p.titles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const addCaption = (text: string, at = playhead, duration?: number) =>
    setShort((p) => {
      const t = newTitle("caption", Math.max(0, Math.min(Math.max(0, seconds - 1), at)), text);
      if (duration) t.duration = duration;
      if (t.start + t.duration > seconds) t.duration = Math.max(0.5, seconds - t.start);
      return { ...p, titles: [...p.titles, t] };
    });
  const removeTitle = (id: string) => setShort((p) => ({ ...p, titles: p.titles.filter((t) => t.id !== id) }));
  const downloadTemplate = () => {
    if (!short) return;
    const blob = new Blob([JSON.stringify(videoTemplate(short), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(short.name)}.titles.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importTemplate = async (file: File) => {
    if (!short) return;
    try {
      const { titles, warnings } = parseTemplateImport(await file.text(), short);
      setShort((p) => ({ ...p, titles }));
      setStatus(`${titles.length} title${titles.length === 1 ? "" : "s"} imported${warnings.length ? ` — ${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 2).join("; ")}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const setMusicStart = (at: "downbeat" | "drop") => {
    if (!grid || !track) return;
    setPlan({ musicStart: at });
    setShort((p) => {
      const hookEnd = p.titles.find((t) => t.kind === "hook")?.duration ?? 2.5;
      const musicIn = at === "drop" && grid.drop !== null ? Math.max(0, grid.drop - hookEnd) : (grid.beats.filter((_, i) => i % 4 === grid.downbeatPhase)[0] ?? 0);
      return { ...p, music: p.music.map((m) => (m.id === track.id ? { ...m, in: musicIn, out: Math.min(p.media[m.media]?.duration ?? Infinity, musicIn + seconds + 1), fadeIn: at === "drop" ? 0 : 0.3 } : m)) };
    });
  };
  const setCameraSound = (on: boolean) =>
    setShort((p) => {
      const sound = on ? "footage" : "music-video";
      const levels = soundLevels({ sound });
      return { ...p, sound, clips: p.clips.map((c) => ({ ...c, muted: !on, gainDb: levels.camera })), music: p.music.map((m) => ({ ...m, gainDb: levels.music })) };
    });
  const audioKey = short ? JSON.stringify([short.clips.map((c) => [c.media, c.in, c.out, c.gainDb, c.muted, c.speed]), short.music, short.sound]) : "";
  const measureMix = async () => {
    if (!short || job) return;
    const abort = new AbortController();
    setJob({ kind: "loudness", label: "Measuring the mix", fraction: 0, abort });
    try {
      const result = await measureLoudness({ project: short, getFile: (id) => setStore.getFile(id), sampleRate: 48000, from: 0, to: seconds, signal: abort.signal, onProgress: (d, t) => setJob((j) => (j ? { ...j, fraction: d / Math.max(1, t) } : j)) });
      setLoudness({ result, key: audioKey });
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };
  const matchGain = loudness?.result.integrated !== null && loudness?.result.integrated !== undefined ? gainToReach(loudness.result.integrated, loudness.result.peakDb) : 0;
  const matchLevel = () => {
    if (!matchGain) return;
    setShort((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, gainDb: c.gainDb + matchGain })), music: p.music.map((m) => ({ ...m, gainDb: m.gainDb + matchGain })) }));
    setLoudness((l) => (l && l.result.integrated !== null ? { result: { ...l.result, integrated: l.result.integrated + matchGain, peakDb: l.result.peakDb + matchGain }, key: "" } : l));
  };

  /* -------------------------------------------------------------- export */
  const size = useMemo(() => (first?.width && first.height && short ? outputSize(first.width, first.height, short.export) : { width: 1080, height: 1920 }), [first?.width, first?.height, short]);
  useEffect(() => {
    let active = true;
    encoderSupport(size.width, size.height)
      .then((sup) => active && setOutSupport({ ...sup, w: size.width, h: size.height }))
      .catch(() => active && setOutSupport({ hevc: false, avc: false, w: size.width, h: size.height }));
    return () => {
      active = false;
    };
  }, [size.width, size.height]);
  const spans = useMemo(() => (short ? planExport(short) : []), [short]);
  const estimate = useMemo(() => estimateExport(short ?? newSetProject(), spans, defaultSpeeds((first?.width ?? 1920) * (first?.height ?? 1080), size.width * size.height).encode), [short, spans, first?.width, first?.height, size.width, size.height]);
  const fps = first?.fps || 30;
  const firstCut = placed.length > 1 ? placed[1].start : null;
  const checks = useMemo(() => {
    if (!short) return [];
    const editor = preflight(short, estimate, size, { fileSystem: hasFileSystemAccess(), folderName: folder, missing: setStore.missing(Object.keys(short.media)).length, room: null, support: outSupport && outSupport.w === size.width && outSupport.h === size.height ? outSupport : null, loudness: loudness ? { integrated: loudness.result.integrated, peakDb: loudness.result.peakDb, stale: loudness.key !== audioKey && loudness.key !== "", predicted: loudness.key === "", matchGain } : null, resumable: null, onBattery: null, seconds, fps }).filter((i) => !["range", "limit", "audio"].includes(i.id));
    const shorts = shortLimits(short, plan.targets, { seconds, fps, bytes: estimate.bytes, firstTitleAt: short.titles.length ? Math.min(...short.titles.map((t) => t.start)) : null, firstCutAt: firstCut, music: short.music.some((m) => !m.muted), cameraSound: short.clips.some((c) => !c.muted && c.gainDb > -60) });
    return [...shorts, ...editor];
  }, [short, estimate, size, folder, setStore, outSupport, loudness, audioKey, matchGain, seconds, fps, plan.targets, firstCut]);
  const blockers = checks.filter((c) => c.state === "block").map((c) => c.title);
  const onPreflightAction = (id: string) => {
    if (id === "pick-folder") void pickFolder();
    else if (id === "measure") void measureMix();
    else if (id === "match") matchLevel();
    else if (id === "use-avc") setShort((p) => ({ ...p, export: { ...p.export, codec: "avc" } }));
    else if (id === "use-hevc") setShort((p) => ({ ...p, export: { ...p.export, codec: "hevc" } }));
    else if (id === "lower-resolution") setShort((p) => ({ ...p, export: { ...p.export, resolution: 1080 } }));
    else if (id.startsWith("set-bitrate:")) setShort((p) => ({ ...p, export: { ...p.export, bitrateMbps: Number(id.slice(12)) } }));
    else if (id.startsWith("set-frame:")) setShort((p) => ({ ...p, export: { ...p.export, frame: id.slice(10) as Project["export"]["frame"] } }));
    else if (id === "add-hook") {
      setHookText(hook?.text ?? short?.name ?? "");
      setOpen((o) => ({ ...o, text: true }));
    } else if (id === "open-range") setOpen((o) => ({ ...o, cut: true }));
    else if (id === "apply-levels") setCameraSound(short?.sound === "footage");
    else if (id === "open-tags") setOpen((o) => ({ ...o, export: true }));
  };

  const drawLive = (frame: OffscreenCanvas, t: number) => {
    const c = liveRef.current;
    if (!c) return;
    const w = 180, h = Math.max(1, Math.round((w * frame.height) / frame.width));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.getContext("2d")?.drawImage(frame, 0, 0, w, h);
    setLiveAt(t);
  };
  const logEvent = (kind: RunEvent["kind"], text: string) => setEvents((l) => [...l, { at: Date.now(), kind, text }]);

  /** Write one short's file into the shorts folder; with `noMusic` a second version without the music. */
  const exportOne = async (project: Project, noMusic: boolean, signal: AbortSignal): Promise<DoneResult> => {
    const name = `${safeName(project.name)}${noMusic ? " (no music)" : ""}.mp4`;
    const target = noMusic ? { ...project, music: [] } : project;
    const out = outputSize(project.media[project.clips[0].media].width!, project.media[project.clips[0].media].height!, project.export);
    const started = Date.now();
    setJob((j) => (j ? { ...j, label: `Exporting ${name}`, output: { name, codec: project.export.codec.toUpperCase(), width: out.width, height: out.height, bitrateMbps: project.export.bitrateMbps, preset: project.export.preset, estimatedBytes: estimate.bytes } } : j));
    setEvents([{ at: started, kind: "start", text: `Started ${name} — ${project.export.codec.toUpperCase()} ${sizeText(out)} at ${project.export.bitrateMbps} Mbps` }]);
    const { writable, handle } = await setStore.createWritable(name);
    const result = await exportProject({
      project: target,
      getFile: (id) => setStore.getFile(id),
      logo: null,
      writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
      signal,
      onProgress: (progress) => setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j)),
      onPreview: drawLive,
      onEvent: (e) => logEvent(e.kind, e.text),
      onFault: async (fault: ExportFault) => {
        logEvent("fault", `${fault.message} — skipped`);
        return "skip";
      },
    });
    const file = await handle.getFile();
    const doneResult: DoneResult = { kind: "done", at: Date.now(), name, folder, seconds: shortSeconds(target), bytes: file.size, activeMs: result.activeMs, pausedMs: 0, estimatedMs: estimate.wallSeconds * 1000, codec: project.export.codec.toUpperCase(), width: out.width, height: out.height, bitrateMbps: project.export.bitrateMbps, audioKbps: project.export.audioBitrateKbps, parts: 0, resumedFrom: 0, skipped: result.skipped ?? [], events: [], report: undefined, checking: { stage: "Checking the file", fraction: 0 } };
    setDone(doneResult);
    try {
      const report: DoctorReport = await diagnose(file, { target: "youtube", depth: "quick", signal, onProgress: (p) => setDone((d) => (d && d.name === name ? { ...d, checking: p } : d)) });
      setDone((d) => (d && d.name === name ? { ...d, report, checking: null } : d));
      doneResult.report = report;
    } catch (e) {
      setDone((d) => (d && d.name === name ? { ...d, checking: null, checkError: e instanceof Error ? e.message : String(e) } : d));
    }
    setSet((s) => ({ ...s, shorts: s.shorts.map((e) => (e.id === project.id ? { ...e, exported: { name, bytes: file.size, at: Date.now() } } : e)) }));
    return doneResult;
  };

  const loadShortProject = async (entry: ShortEntry): Promise<Project | null> => {
    const root = setStore.directory;
    if (!root) return null;
    const sub = await root.getDirectoryHandle(entry.folder);
    const tmp = new ProjectStore(undefined, { lastKey: "lastShortsShort" });
    await tmp.adopt(sub, false);
    const loaded = await tmp.load();
    return loaded?.project ?? null;
  };

  const startExport = async (all = false) => {
    if (job) return;
    const list = all ? setRef.current.shorts : short ? [setRef.current.shorts.find((e) => e.id === short.id) ?? null] : [];
    const abort = new AbortController();
    setDone(null);
    setJob({ kind: "export", label: all ? `Exporting ${list.length} shorts` : "Exporting", fraction: 0, abort });
    try {
      let n = 0;
      for (const entry of list) {
        if (abort.signal.aborted) break;
        const project = entry && entry.id !== short?.id ? await loadShortProject(entry) : short;
        if (!project || !project.clips.length) continue;
        if (project.id === short?.id) await shortStore.save(project);
        await exportOne(project, false, abort.signal);
        if (withoutMusic && project.music.length) await exportOne(project, true, abort.signal);
        n++;
      }
      setStatus(all ? `${n} short${n === 1 ? "" : "s"} exported into ${folder}` : `Exported into ${folder}`);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") setStatus("Export stopped");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  const saveCover = async () => {
    if (!short || job) return;
    const abort = new AbortController();
    setJob({ kind: "cover", label: "Saving the cover", fraction: 0.5, abort });
    try {
      const frame = await renderFrame({ project: coverTitles ? short : { ...short, titles: [] }, getFile: (id) => setStore.getFile(id), logo: null, t: playhead, height: 1920, type: "image/jpeg", quality: 0.92 });
      // The platforms take a 1080-wide cover; footage smaller than that is scaled up to it.
      const target = first?.width && first.height ? outputSize(first.width, first.height, { resolution: 1080, frame: short.export.frame ?? "9:16" }) : { width: frame.width, height: frame.height };
      let blob = frame.blob;
      if (frame.width !== target.width || frame.height !== target.height) {
        const bmp = await createImageBitmap(frame.blob);
        const c = new OffscreenCanvas(target.width, target.height);
        c.getContext("2d")!.drawImage(bmp, 0, 0, target.width, target.height);
        blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      }
      const name = `${safeName(short.name)}.cover.jpg`;
      const { writable } = await setStore.createWritable(name);
      await writable.write(blob);
      await writable.close();
      setStatus(`Cover saved: ${name}, ${target.width}×${target.height}, from ${fmtTime(playhead)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  /** Hand the active short to the Video Editor: its folder becomes the editor's last one. */
  const openInEditor = async () => {
    const entry = setRef.current.shorts.find((e) => e.id === activeId);
    const root = setStore.directory;
    if (!entry || !root || !short) return;
    await shortStore.save(short);
    await rememberFolder("lastFolder", await root.getDirectoryHandle(entry.folder));
    if (confirmLeave()) router.push("/media/editor");
  };

  /* ------------------------------------------------------------- preview */
  const frameKey = short ? `${exportFingerprint(short)}|${playhead.toFixed(2)}` : "";
  useEffect(() => {
    const p = shortRef.current;
    if (!p || !p.clips.length || rendered) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const f = await renderFrame({ project: p, getFile: fileFor, logo: null, t: Math.min(playhead, Math.max(0, shortSeconds(p) - 0.01)), height: 960, type: "image/jpeg", quality: 0.86 });
        if (!active) return;
        const url = URL.createObjectURL(f.blob);
        setFrameUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch {
        /* no frame to show */
      }
    }, 140);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [frameKey, playhead, fileFor, rendered]);

  const renderPreview = async () => {
    if (!short || job) return;
    const abort = new AbortController();
    const outW = 540, outH = 960;
    const preview: Project = { ...short, export: { ...short.export, resolution: 540, frame: short.export.frame ?? "9:16", codec: "avc", bitrateMbps: 6, preset: "fast", smartCopy: false, range: null } };
    setJob({ kind: "render", label: "Rendering the preview", fraction: 0, abort, output: { name: "preview.mp4", codec: "AVC", width: outW, height: outH, bitrateMbps: 6, preset: "fast", estimatedBytes: (6e6 * seconds) / 8 } });
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("bench-preview-renders", { create: true });
      const fh = await dir.getFileHandle("short-preview.mp4", { create: true });
      const writable = await fh.createWritable();
      await exportProject({ project: preview, getFile: fileFor, logo: null, writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>, signal: abort.signal, onProgress: (progress) => setJob((j) => (j ? { ...j, fraction: progress.fraction, progress } : j)), onPreview: drawLive });
      const file = await fh.getFile();
      setRendered((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(file), bytes: file.size };
      });
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  /* ------------------------------------------------------------ summaries */
  const sourceLine = !folder ? "Pick the shorts folder" : `${sourceMedia.length} recording${sourceMedia.length === 1 ? "" : "s"} · ${fmtTime(driveSeconds)}${set.sourceName ? ` · from ${set.sourceName}` : ""}${set.music ? ` · music${grid ? ` ${grid.bpm} BPM` : ""}` : ""}${missing ? ` · ${missing} missing` : ""}`;
  const planLine = describePlan(plan, !!grid) + (set.shorts.length ? ` · ${set.shorts.length} made` : "");
  const cutLine = short ? `${placed.length} scenes · ${fmtTime(seconds)}${beatSeconds ? ` · on the beat` : ""}` : "No short yet";
  const frameLine = short ? `${FRAME_LABELS[short.export.frame ?? "source"]} · ${LAYOUT_CHOICES.find((c) => c.id === layoutChoice(short.layout))?.label ?? ""}` : "—";
  const textLine = short ? `${hook ? `Hook “${hook.text}”` : "No hook"} · ${captions.length} caption${captions.length === 1 ? "" : "s"} · ${track ? `music ${short.music[0].gainDb} dB` : "no music"} · camera sound ${short.sound === "footage" ? "on" : "off"}` : "—";
  const exportLine = short ? `${short.export.codec.toUpperCase()} ${sizeText(size)} · ${short.export.bitrateMbps} Mbps · about ${fmtBytes(estimate.bytes)} · ${plan.targets.map((t) => PLATFORMS[t].name).join(", ") || "no platform chosen"}` : "—";
  const toggle = (id: StepId) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const preset = short ? matchPreset(short.export) : null;
  const sceneWindowLabel = selected ? `scene ${placed.findIndex((c) => c.id === selected.id) + 1}` : "scene";

  // Exposed for automated tests, which cannot drive the folder picker.
  useEffect(() => {
    (window as unknown as { __benchShorts?: unknown }).__benchShorts = {
      useDirectory: async (d: FileSystemDirectoryHandle) => {
        await setStore.adopt(d, false);
        setFolder(d.name || "shorts");
        return loadSet(false);
      },
      getSet: () => set,
      getShort: () => short,
      setSet,
      setShort,
      addVideos,
      addMusic,
      makeShorts,
      replan,
      openShort: (i: number) => openShort(set.shorts[i]),
      startExport,
      saveCover,
      renderPreview,
      measureMix,
      getDone: () => done,
      getJob: () => job,
      getChecks: () => checks,
      getScenes: () => scenes,
      setPlayhead: (t: number) => setPlayhead(t),
      fileFor,
      frameAt: (t: number, height?: number) => (short ? renderFrame({ project: short, getFile: fileFor, logo: null, t, height, type: "image/png" }).then((f) => f.blob) : Promise.reject(new Error("no short"))),
    };
  });

  const busy = !!job;
  const openSteps = (ids: StepId[]) => setOpen((o) => ({ ...o, ...Object.fromEntries(ids.map((i) => [i, true])) }));

  return (
    <div className="space-y-3" data-shorts-maker>
      {(status || error) && (
        <div className={cn("flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-[12.5px]", error ? "border-danger/50 text-danger" : "border-edge text-muted")} data-shorts-status role="status">
          <span className="min-w-0 flex-1">{error ?? status}</span>
          <button type="button" onClick={() => (error ? setError(null) : setStatus(null))} className="text-faint hover:text-ink" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        {/* the phone */}
        <div className="panel space-y-2 p-3" data-shorts-preview>
          <PhonePreview
            src={frameUrl}
            safe={short?.safeArea ?? null}
            ghost={ghost}
            height={520}
            video={rendered ? <video src={rendered.url} autoPlay controls playsInline className="absolute inset-0 h-full w-full object-contain" data-rendered-preview /> : undefined}
          >
            {job?.kind === "export" || job?.kind === "render" ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-2 py-1 text-[11px] text-white">
                <Loader size={11} className="animate-spin" /> {job.label} · {Math.round(job.fraction * 100)}%
              </div>
            ) : null}
          </PhonePreview>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => (rendered ? setRendered(null) : void renderPreview())} disabled={!short || (busy && !rendered)} className={cn(GHOST, "h-8")} title={rendered ? "Back to frames at the playhead" : "Render the real export small and play it here, music and all"} data-preview-play>
              {rendered ? <Pause size={13} /> : <Play size={13} />}
              {rendered ? "Frames" : "Play"}
            </button>
            <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Ghost the platform's buttons, title and captions over the frame to see what they cover">
              <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} className="accent-[var(--accent)]" data-ghost-toggle />
              Platform UI
            </label>
            <span className="ml-auto font-mono text-[12px] tabular text-ink" data-playhead>
              {fmtTime(playhead, fps)} / {fmtTime(seconds)}
            </span>
          </div>
          <div className="relative" data-scrubber>
            <input type="range" min={0} max={Math.max(0.01, seconds)} step={0.01} value={Math.min(playhead, seconds)} onChange={(e) => setPlayhead(Number(e.target.value))} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" aria-label="Playhead" disabled={!short} />
            <div className="pointer-events-none absolute inset-x-0 top-3 h-2">
              {placed.slice(1).map((c) => (
                <span key={c.id} className="absolute top-0 h-2 w-px bg-ink/60" style={{ left: `${(c.start / Math.max(0.01, seconds)) * 100}%` }} />
              ))}
              {beatTicks.map((t, i) => (
                <span key={i} className="absolute top-1 h-1 w-px bg-accent/50" style={{ left: `${(t / Math.max(0.01, seconds)) * 100}%` }} data-beat-tick />
              ))}
            </div>
          </div>
          {set.shorts.length > 0 && (
            <div className="space-y-1 pt-1" data-shorts-list>
              <div className="readout">Shorts in this folder</div>
              {set.shorts.map((e) => (
                <div key={e.id} className={cn("flex items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1 text-[12.5px]", e.id === activeId ? "border-accent bg-accent-soft" : "border-edge")} data-short-entry={e.id} data-active={e.id === activeId ? "true" : "false"}>
                  <button type="button" onClick={() => void openShort(e)} className="min-w-0 flex-1 truncate text-left text-ink" title={`${e.folder} — ${e.scenes} scenes, ${fmtTime(e.seconds)}${e.exported ? `, exported ${e.exported.name}` : ""}`}>
                    {e.name}
                  </button>
                  <span className="font-mono text-[11px] tabular text-faint">{fmtTime(e.seconds)}</span>
                  {e.exported ? <Download size={11} className="text-positive" aria-label="Exported" /> : null}
                  <button type="button" onClick={() => void removeShort(e)} className="text-faint hover:text-danger" aria-label={`Remove ${e.name}`} data-short-remove>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* the steps */}
        <div className="min-w-0 space-y-2">
          <Section id="source" title="1 · Source" summary={sourceLine} open={open.source} onToggle={() => toggle("source")} hook="shorts-source">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => void pickFolder()} className={cn(folder ? GHOST : PRIMARY, "h-9")} data-pick-folder>
                <FolderOpen size={14} /> {folder ? `Shorts folder: ${folder}` : "Pick the shorts folder"}
              </button>
              <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple hidden onChange={(e) => e.target.files && void addVideos(Array.from(e.target.files))} />
              <button type="button" onClick={() => videoInput.current?.click()} disabled={!folder} className={GHOST} data-add-videos>
                <Upload size={13} /> Add recordings or an export
              </button>
              <button type="button" onClick={() => void importEditor()} disabled={!folder} className={GHOST} title="Open a Video Editor project folder: its recordings in order, as trimmed and graded, its LUT and its music" data-open-editor>
                <Clapperboard size={13} /> Open a Video Editor project
              </button>
              {editorFolder && folder && (
                <button type="button" onClick={() => void importEditor(editorFolder)} className={cn(GHOST, from === "editor" && "border-accent text-accent")} title={`The editor's last project folder: ${editorFolder.name}`} data-open-last-editor>
                  <Sparkles size={13} /> {`Use the editor's last project (${editorFolder.name})`}
                </button>
              )}
              <input ref={musicInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.flac" hidden onChange={(e) => e.target.files?.[0] && void addMusic(e.target.files[0])} />
              <button type="button" onClick={() => musicInput.current?.click()} disabled={!folder} className={GHOST} data-add-music>
                <Music size={13} /> {set.music ? "Replace the music" : "Add music"}
              </button>
            </div>
            <p className="text-[12px] text-faint">The shorts folder holds one sub-folder per short — each an ordinary Video Editor project — and the exports. Footage stays where it is; the browser remembers where.</p>
            {sourceMedia.length > 0 && (
              <ul className="space-y-0.5 text-[12.5px]" data-source-list>
                {sourceMedia.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                    <span className="font-mono text-[11.5px] tabular text-faint">
                      {m.width}×{m.height} · {fmtTime(m.duration)}
                      {set.proxies[m.id]?.ready ? " · 360p proxy" : ""}
                      {!setStore.hasFile(m.id) ? " · missing" : ""}
                    </span>
                    <button type="button" onClick={() => removeSource(m.id)} className="text-faint hover:text-danger" aria-label={`Remove ${m.name}`}>
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {set.music && set.media[set.music.media] && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-music-line>
                <Music size={12} className="text-accent" />
                <span className="text-ink">{set.media[set.music.media].name}</span>
                {grid ? (
                  <span className="text-muted" data-beats-line>
                    {grid.bpm} BPM · {grid.beats.length} beats{grid.drop !== null ? ` · drop at ${fmtTime(grid.drop)}` : ""} · {grid.confidence >= 0.5 ? "steady beat" : grid.confidence >= 0.25 ? "beat found" : "faint beat"}
                  </span>
                ) : (
                  <span className="text-faint">beats not read yet</span>
                )}
                <button type="button" onClick={() => void analyseMusic(set.music!.media)} disabled={busy} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} data-analyse-beats>
                  <RefreshCw size={11} /> Read the beats
                </button>
              </div>
            )}
            {sourceMedia.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <button type="button" onClick={() => void makeProxies()} disabled={busy || sourceMedia.every((m) => set.proxies[m.id]?.ready)} className={cn(GHOST, "h-7 text-[12px]")} data-make-proxies>
                  <Wand2 size={12} /> Make 360p proxies
                </button>
                <span>{canScanQuickly ? "Scanning for lively moments is quick with this footage." : "8K footage without proxies is slow to scan — proxies take a few minutes once and make every scan, thumbnail and preview quick."}</span>
              </div>
            )}
          </Section>

          <Section id="plan" title="2 · Plan" summary={planLine} open={open.plan} onToggle={() => toggle("plan")} hook="shorts-plan">
            <div className="space-y-1">
              <div className="readout">For</div>
              <PlatformChips chosen={plan.targets} onToggle={(id) => setPlan({ targets: plan.targets.includes(id) ? plan.targets.filter((t) => t !== id) : [...plan.targets, id] })} />
              <p className="text-[12px] text-faint">{plan.targets.map((t) => PLATFORMS[t].limitNote).join(". ")}{plan.targets.length ? "." : "Pick at least one platform."}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-[12.5px] text-muted">
                Length
                <select value={String(plan.seconds)} onChange={(e) => setPlan({ seconds: Number(e.target.value) })} className={cn(SEL, "mt-1 w-full")} data-plan-seconds>
                  {SHORT_LENGTHS.filter((s) => s <= lengthFor(plan.targets).max)
                    .concat(SHORT_LENGTHS.includes(plan.seconds) ? [] : [plan.seconds])
                    .sort((a, b) => a - b)
                    .map((s) => (
                      <option key={s} value={s}>
                        {fmtTime(s)}
                        {s >= lengthFor(plan.targets).sweet[0] && s <= lengthFor(plan.targets).sweet[1] ? " — sweet spot" : s > lengthFor(plan.targets).sweet[1] ? " — long for the feed" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-[12.5px] text-muted">
                Look
                <select value={plan.look} onChange={(e) => setPlan({ look: e.target.value })} className={cn(SEL, "mt-1 w-full")} data-plan-look>
                  <option value="none">As graded — the footage as it is</option>
                  {INTRO_STYLES.map((s) => (
                    <option key={s.id} value={s.id} title={s.hint}>
                      {s.name}
                      {s.speed !== 1 ? ` (${s.speed}×)` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12.5px] text-muted">
                Order
                <select value={plan.order} onChange={(e) => setPlan({ order: e.target.value as PlanSettings["order"] })} className={cn(SEL, "mt-1 w-full")} data-plan-order>
                  {SHORT_ORDERS.map((o) => (
                    <option key={o.id} value={o.id} title={o.hint}>
                      {o.name} — {o.hint.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
              {grid ? (
                <label className="text-[12.5px] text-muted">
                  Cuts
                  <select value={String(plan.beatsPerCut)} onChange={(e) => setPlan({ beatsPerCut: (e.target.value === "mixed" ? "mixed" : Number(e.target.value)) as BeatsPerCut })} className={cn(SEL, "mt-1 w-full")} data-plan-beats>
                    {BEATS_PER_CUT.map((b) => (
                      <option key={String(b)} value={String(b)}>
                        {b === "mixed" ? "A mixed pattern — 2, 2, 1, 1, 4 beats" : `Every ${b} beat${b === 1 ? "" : "s"} (${((60 / grid.bpm) * (b as number)).toFixed(2)} s)`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Slider label="Seconds per scene" value={plan.sceneSeconds} min={0.5} max={6} step={0.25} onChange={(v) => setPlan({ sceneSeconds: v })} format={(v) => `${v.toFixed(2)} s`} hook="plan-scene-seconds" />
              )}
              {plan.look === "none" && (
                <label className="text-[12.5px] text-muted">
                  Between scenes
                  <select value={plan.cut} onChange={(e) => setPlan({ cut: e.target.value as PlanSettings["cut"] })} className={cn(SEL, "mt-1 w-full")} data-plan-cut>
                    <option value="cut">Hard cuts</option>
                    {TRANSITIONS.map((t) => (
                      <option key={t.kind} value={t.kind} title={t.hint}>
                        {t.name}, half a second
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {grid && (
                <label className="text-[12.5px] text-muted">
                  Music starts
                  <select value={plan.musicStart} onChange={(e) => setPlan({ musicStart: e.target.value as PlanSettings["musicStart"] })} className={cn(SEL, "mt-1 w-full")} data-plan-music-start>
                    <option value="downbeat">On a downbeat at the first frame</option>
                    <option value="drop" disabled={grid.drop === null}>
                      {grid.drop === null ? "The drop (none found)" : `The drop lands as the hook ends (${fmtTime(grid.drop)} in the track)`}
                    </option>
                  </select>
                </label>
              )}
              <Slider label="Shorts from this drive" value={plan.count} min={1} max={20} step={1} onChange={(v) => setPlan({ count: v })} format={(v) => `${v}`} hook="plan-count" />
            </div>
            <label className="block text-[12.5px] text-muted">
              Hook — the first line on screen
              <input value={plan.hook} onChange={(e) => setPlan({ hook: e.target.value })} placeholder={set.name} className={cn(INPUT, "mt-1")} data-plan-hook />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
              <label className="flex items-center gap-1.5" title="End on a glimpse of the opening frames, dissolved into, so the short loops without a jump">
                <input type="checkbox" checked={plan.loop} onChange={(e) => setPlan({ loop: e.target.checked })} className="accent-[var(--accent)]" data-plan-loop />
                Loop-friendly ending
              </label>
              <label className="flex items-center gap-1.5" title="Keep the camera's own sound under the music">
                <input type="checkbox" checked={plan.cameraSound} onChange={(e) => setPlan({ cameraSound: e.target.checked })} className="accent-[var(--accent)]" data-plan-camera />
                Camera sound under the music
              </label>
              <label className="flex items-center gap-1.5" title="Decode a few frames at each candidate and keep the liveliest; off, the moments are spaced evenly">
                <input type="checkbox" checked={scanOn} onChange={(e) => setScan(e.target.checked)} className="accent-[var(--accent)]" data-plan-scan />
                Pick the liveliest moments{!canScanQuickly ? " (slow at 8K without proxies)" : ""}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void makeShorts()} disabled={busy || !set.clips.length || !plan.targets.length} className={cn(PRIMARY, "h-10")} data-make-shorts>
                <Sparkles size={14} /> Make {plan.count > 1 ? `${plan.count} shorts` : "the short"}
              </button>
              {short && (
                <button type="button" onClick={() => void replan()} disabled={busy} className={GHOST} title="Plan the open short again from its stretch with the settings above" data-replan>
                  <RefreshCw size={13} /> Plan this one again
                </button>
              )}
              {job && (job.kind === "scan" || job.kind === "beats" || job.kind === "proxy") && (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted" data-plan-job>
                  <Loader size={12} className="animate-spin" /> {job.label}
                  {job.message ? ` — ${job.message}` : ""} · {Math.round(job.fraction * 100)}%
                  <button type="button" onClick={() => job.abort.abort()} className="text-faint hover:text-ink" aria-label="Stop">
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          </Section>

          <Section id="cut" title="3 · Cut" summary={cutLine} open={open.cut} onToggle={() => toggle("cut")} hook="shorts-cut">
            {short ? (
              <>
                <SceneStrip scenes={scenes} selected={selected?.id ?? null} onSelect={(id) => { setSelectedScene(id); const c = placed.find((x) => x.id === id); if (c) setPlayhead(c.start + 0.05); }} onMove={moveScene} onRemove={removeScene} onNudge={nudgeScene} onLength={lengthenScene} beatSeconds={beatSeconds} />
                {selected && (
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    <span>
                      {sceneWindowLabel}: from {fmtTime(selected.in)} of {short.media[selected.media]?.name ?? "the recording"}
                    </span>
                    <label className="flex items-center gap-1.5">
                      Speed
                      <select value={String(clipSpeed(selected))} onChange={(e) => setSceneSpeed(selected.id, Number(e.target.value))} className={cn(SEL, "h-7 text-[12px]")} data-scene-speed>
                        {[0.5, 1, 2, 4, 8].map((s) => (
                          <option key={s} value={s}>
                            {s}×
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="text-faint">− and + change a scene by {beatSeconds ? "a beat" : "half a second"}; ‹ and › slide it through the recording; the arrows reorder.</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Make a short in Plan first.</p>
            )}
          </Section>

          <Section id="frame" title="4 · Frame" summary={frameLine} open={open.frame} onToggle={() => toggle("frame")} hook="shorts-frame">
            {short ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[12.5px] text-muted">
                    Frame
                    <select value={short.export.frame ?? "source"} onChange={(e) => setShort((p) => ({ ...p, export: { ...p.export, frame: e.target.value as Project["export"]["frame"] } }))} className={cn(SEL, "mt-1 w-full")} data-short-frame>
                      <option value="9:16">Vertical 9:16 — Shorts, Reels, TikTok</option>
                      <option value="1:1">Square 1:1</option>
                      <option value="4:5">Portrait 4:5 — Instagram feed</option>
                      <option value="source">As recorded</option>
                    </select>
                  </label>
                  <label className="text-[12.5px] text-muted">
                    Layout
                    <select value={layoutChoice(short.layout)} onChange={(e) => setShort((p) => ({ ...p, layout: LAYOUT_CHOICES.find((c) => c.id === e.target.value)?.layout ?? null }))} className={cn(SEL, "mt-1 w-full")} data-short-layout>
                      {LAYOUT_CHOICES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selected && (
                  <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2" data-short-window>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                      <span className="text-ink">Window for {sceneWindowLabel} — where the frame looks{pan ? `, panning ${pan > 0 ? "right" : "left"}` : ""}</span>
                      <span className="flex gap-1.5">
                        <button type="button" onClick={() => void autoCentre()} disabled={busy} className={cn(GHOST, "h-6 px-2 text-[12px]")} title="Find where the picture moves most across this scene and centre the window there" data-auto-centre>
                          <Wand2 size={11} /> Auto-centre
                        </button>
                        <button type="button" onClick={applyWindowToAll} className={cn(GHOST, "h-6 px-2 text-[12px]")} data-window-all>
                          Apply to all scenes
                        </button>
                        <button type="button" onClick={() => setShort((p) => ({ ...p, clips: p.clips.map((c) => (c.id === selected.id ? { ...c, reframe: undefined } : c)) }))} className={cn(GHOST, "h-6 px-2 text-[12px]")} data-window-reset>
                          Centre
                        </button>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Slider label="Across" value={key.cx} min={0} max={1} step={0.005} onChange={(v) => setWindow({ cx: v })} format={(v) => (v === 0.5 ? "centre" : `${Math.round((v - 0.5) * 200)}%`)} hook="window-cx" />
                      <Slider label="Up / down" value={key.cy} min={0} max={1} step={0.005} onChange={(v) => setWindow({ cy: v })} format={(v) => (v === 0.5 ? "centre" : `${Math.round((v - 0.5) * 200)}%`)} hook="window-cy" />
                      <Slider label="Zoom" value={key.zoom} min={1} max={MAX_REFRAME_ZOOM} step={0.05} onChange={(v) => setWindow({ zoom: v })} format={(v) => `${v.toFixed(2)}×`} hook="window-zoom" />
                      <Slider label="Pan over the scene" value={pan} min={-0.5} max={0.5} step={0.01} onChange={(v) => setWindow({}, v)} format={(v) => (v === 0 ? "still" : `${Math.round(v * 200)}%`)} hook="window-pan" />
                    </div>
                  </div>
                )}
                <p className="text-[12px] text-faint">Tick Platform UI under the preview to see what the buttons and captions cover; titles are kept inside the clear part.</p>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Make a short in Plan first.</p>
            )}
          </Section>

          <Section id="text" title="5 · Text & sound" summary={textLine} open={open.text} onToggle={() => toggle("text")} hook="shorts-text">
            {short ? (
              <>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="text-[12.5px] text-muted">
                    Hook — the first {hook ? hook.duration.toFixed(1) : "2.5"} s
                    <input value={hook?.text ?? ""} onChange={(e) => setHookText(e.target.value)} placeholder={short.name} className={cn(INPUT, "mt-1")} data-hook-text />
                  </label>
                  {hook && (
                    <label className="text-[12.5px] text-muted">
                      Style
                      <select value={captionStyle(hook)} onChange={(e) => patchTitle(hook.id, CAPTION_STYLES.find((s) => s.id === e.target.value)?.patch ?? {})} className={cn(SEL, "mt-1 w-full")} data-hook-style>
                        {CAPTION_STYLES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="space-y-1" data-captions>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="readout">Captions</span>
                    <button type="button" onClick={() => addCaption("Caption")} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} data-add-caption>
                      <Plus size={11} /> At {fmtTime(playhead)}
                    </button>
                    {QUICK_CAPTIONS.map((q) => (
                      <button key={q} type="button" onClick={() => addCaption(q, q.startsWith("Full drive") ? Math.max(0, seconds - 3) : playhead, q.startsWith("Full drive") ? 3 : undefined)} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} data-quick-caption>
                        {q}
                      </button>
                    ))}
                    <span className="ml-auto flex gap-1.5">
                      <button type="button" onClick={downloadTemplate} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} title="One JSON with this short's timeline and every title property, ready for an LLM to fill in" data-template-download>
                        <Download size={11} /> Template JSON
                      </button>
                      <input ref={templateInput} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importTemplate(e.target.files[0])} />
                      <button type="button" onClick={() => templateInput.current?.click()} className={cn(GHOST, "h-6 px-1.5 text-[11.5px]")} data-template-import>
                        <Upload size={11} /> Import JSON
                      </button>
                    </span>
                  </div>
                  {captions.map((t) => (
                    <div key={t.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1.5 text-[12.5px]" data-caption={t.id}>
                      <input value={t.text} onChange={(e) => patchTitle(t.id, { text: e.target.value })} className={cn(INPUT, "h-7")} aria-label="Caption text" />
                      <input type="number" step={0.1} min={0} max={Math.max(0, seconds - 0.5)} value={+t.start.toFixed(2)} onChange={(e) => patchTitle(t.id, { start: Math.max(0, Number(e.target.value)) })} className={cn(INPUT, "h-7 w-16 font-mono")} aria-label="Start, seconds" title="Start, seconds" />
                      <input type="number" step={0.1} min={0.5} value={+t.duration.toFixed(2)} onChange={(e) => patchTitle(t.id, { duration: Math.max(0.5, Number(e.target.value)) })} className={cn(INPUT, "h-7 w-16 font-mono")} aria-label="Length, seconds" title="Length, seconds" />
                      <select value={captionStyle(t)} onChange={(e) => patchTitle(t.id, CAPTION_STYLES.find((s) => s.id === e.target.value)?.patch ?? {})} className={cn(SEL, "h-7 text-[12px]")} aria-label="Style">
                        {CAPTION_STYLES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeTitle(t.id)} className="text-faint hover:text-danger" aria-label="Remove caption">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5 border-t border-edge pt-2" data-sound>
                  <div className="readout">Sound</div>
                  {track ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Slider label={`Music · ${short.media[track.media]?.name ?? ""}`} value={track.gainDb} min={-24} max={6} step={0.5} onChange={(v) => setShort((p) => ({ ...p, music: p.music.map((m) => ({ ...m, gainDb: v })) }))} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} hook="music-gain" />
                      <Slider label="Fade out" value={track.fadeOut} min={0} max={4} step={0.1} onChange={(v) => setShort((p) => ({ ...p, music: p.music.map((m) => ({ ...m, fadeOut: v })) }))} format={(v) => `${v.toFixed(1)} s`} />
                      {grid && (
                        <label className="text-[12.5px] text-muted">
                          Music starts
                          <select value={plan.musicStart} onChange={(e) => setMusicStart(e.target.value as "downbeat" | "drop")} className={cn(SEL, "mt-1 w-full")} data-music-start>
                            <option value="downbeat">On a downbeat at the first frame</option>
                            <option value="drop" disabled={grid.drop === null}>
                              {grid.drop === null ? "The drop (none found)" : "The drop as the hook ends"}
                            </option>
                          </select>
                        </label>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted">No music in this short — add a track in Source and plan again, or post it with a sound added in the app.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={short.sound === "footage"} onChange={(e) => setCameraSound(e.target.checked)} className="accent-[var(--accent)]" data-camera-sound />
                      Camera sound {short.sound === "footage" ? `at ${soundLevels(short).camera} dB under the music` : "off"}
                    </label>
                    <button type="button" onClick={() => void measureMix()} disabled={busy} className={cn(GHOST, "h-7 text-[12px]")} data-measure-mix>
                      Measure loudness
                    </button>
                    {loudness && (
                      <span data-loudness-line>
                        {loudness.result.integrated === null ? "silent" : `${loudness.result.integrated.toFixed(1)} LUFS`} against {YOUTUBE_LUFS} LUFS
                        {matchGain && Math.abs(matchGain) >= 0.5 ? (
                          <button type="button" onClick={matchLevel} className={cn(GHOST, "ml-2 h-7 text-[12px]")} data-match-level>
                            {matchGain > 0 ? `Raise ${matchGain} dB` : `Lower ${Math.abs(matchGain)} dB`}
                          </button>
                        ) : (
                          " — at the level"
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Make a short in Plan first.</p>
            )}
          </Section>

          <Section id="export" title="6 · Export & post" summary={exportLine} open={open.export} onToggle={() => toggle("export")} hook="shorts-export">
            {short ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={short.name} onChange={(e) => setShort((p) => ({ ...p, name: e.target.value, export: { ...p.export, tags: { ...p.export.tags, title: e.target.value } } }))} onBlur={() => setSet((s) => ({ ...s, shorts: s.shorts.map((e) => (e.id === short.id ? { ...e, name: short.name } : e)) }))} className={cn(INPUT, "max-w-xs font-mono")} aria-label="Short name" data-short-name />
                  <span className="text-[12.5px] text-muted">→ {safeName(short.name)}.mp4 in {folder}</span>
                </div>
                <PresetsRow current={preset} onPick={(id) => setShort((p) => ({ ...p, export: applyPreset(p.export, id) }))} />
                <Preflight items={checks} onAction={onPreflightAction} />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void startExport(false)} disabled={busy || blockers.length > 0} className={cn(PRIMARY, "h-10")} title={blockers[0] ?? "Write this short's file into the shorts folder"} data-export-short>
                    <Download size={14} /> Export this short
                  </button>
                  {set.shorts.length > 1 && (
                    <button type="button" onClick={() => void startExport(true)} disabled={busy || blockers.length > 0} className={cn(GHOST, "h-10")} data-export-all>
                      <Download size={13} /> Export all {set.shorts.length}
                    </button>
                  )}
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted" title="A second file with the camera sound only, for adding a trending sound in the app">
                    <input type="checkbox" checked={withoutMusic} onChange={(e) => setWithoutMusic(e.target.checked)} className="accent-[var(--accent)]" data-without-music />
                    Also a version without music
                  </label>
                  <button type="button" onClick={() => void openInEditor()} disabled={busy} className={cn(GHOST, "h-8 ml-auto")} title="Open this short in the Video Editor for anything finer: its folder is an ordinary project" data-open-in-editor>
                    <Clapperboard size={13} /> Open in Video Editor
                  </button>
                </div>
                {job?.kind === "export" && <ExportRun job={job} events={events} skipped={[]} liveRef={liveRef} liveAt={liveAt} onPause={() => undefined} onResume={() => undefined} onStop={() => job.abort.abort()} />}
                {done && <ExportDone done={done} busy={busy} onDismiss={() => setDone(null)} onAgain={() => void startExport(false)} onFiles={() => undefined} onRecheck={() => undefined} onCancelCheck={() => undefined} canFix={() => false} onFixFinding={() => undefined} onResume={() => undefined} onDiscard={() => undefined} onFix={() => undefined} />}
                <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2" data-cover>
                  <button type="button" onClick={() => void saveCover()} disabled={busy} className={cn(GHOST, "h-8")} title="The frame at the playhead as a 1080×1920 JPEG beside the exports — the cover to pick in the app" data-save-cover>
                    <Camera size={13} /> Save cover from {fmtTime(playhead)}
                  </button>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                    <input type="checkbox" checked={coverTitles} onChange={(e) => setCoverTitles(e.target.checked)} className="accent-[var(--accent)]" />
                    with the titles
                  </label>
                </div>
                <div className="border-t border-edge pt-2">
                  <div className="readout mb-1">Post</div>
                  <PostCopyView copy={postCopy(short, plan.targets, { part: set.shorts.length > 1 ? { index: set.shorts.findIndex((e) => e.id === short.id) + 1, of: set.shorts.length } : undefined, seconds })} notes={postingNotes(plan.targets)} />
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Make a short in Plan first.</p>
            )}
          </Section>
          <p className="text-[11.5px] text-faint">
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" onClick={() => openSteps([s.id])} className="mr-2 hover:text-ink">
                {i + 1} {s.title}
              </button>
            ))}
            {LAYOUT_KINDS.length ? "" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/** An empty project for the estimate before a short exists. */
function newSetProject(): Project {
  return { ...sourceProject(newSet()), clips: [] };
}
