/**
 * A short planned from a drive: the liveliest moments of a stretch of the source timeline lifted as scenes whose
 * lengths land every cut on the music's beat (or run even without music), ordered to open on the hook or to build to
 * it, cut in one of the editor's looks or left as graded, with the hook title, the music aligned to a downbeat or the
 * drop, the platforms' safe area, the Shorts / Reels export settings — and, for a long drive, several shorts that each
 * cover their own stretch. Pure: the widget scans the footage and hands the scored moments in.
 */

import { cutDurations, musicInFor, type BeatGrid, type BeatsPerCut } from "./beats";
import { applyPreset } from "./export-presets";
import { introStyle, pickMoments, type Moment } from "./intro";
import { DEFAULT_CARD, DEFAULT_EXPORT, clipSpeed, newId, newProject, newTitle, placeClips, soundLevels, type Clip, type MediaRef, type MusicTrack, type PlacedClip, type Project, type TransitionKind } from "./project";
import { lengthFor, safeAreaFor, type PlatformId } from "./shorts";

export type ShortOrder = "hook-first" | "chronological" | "build";
export const SHORT_ORDERS: { id: ShortOrder; name: string; hint: string }[] = [
  { id: "hook-first", name: "Hook first", hint: "The liveliest moment opens the short, the rest follow in order" },
  { id: "chronological", name: "In order", hint: "The moments as they happened along the drive" },
  { id: "build", name: "Build to it", hint: "Quieter moments first, the liveliest last" },
];

export interface PlanSettings {
  targets: PlatformId[];
  /** The short's length in seconds. */
  seconds: number;
  /** An intro look's id, or "none" for the footage as graded. */
  look: string;
  order: ShortOrder;
  /** Cuts on the beat when the music has a grid; else every `sceneSeconds`. */
  beatsPerCut: BeatsPerCut;
  sceneSeconds: number;
  /** Between scenes without a look: a hard cut or a quick transition. */
  cut: "cut" | TransitionKind;
  /** End on the opening frame, so the short loops cleanly. */
  loop: boolean;
  /** How many shorts to make across the drive, each from its own stretch. */
  count: number;
  /** The hook line; empty takes the project's name. */
  hook: string;
  /** Camera sound under the music, or off. */
  cameraSound: boolean;
  /** Where the music starts: a downbeat on the first frame, or the drop at the end of the hook. */
  musicStart: "downbeat" | "drop";
}

export const DEFAULT_PLAN: PlanSettings = { targets: ["shorts", "reels"], seconds: 30, look: "none", order: "hook-first", beatsPerCut: 2, sceneSeconds: 2.5, cut: "cut", loop: false, count: 1, hook: "", cameraSound: false, musicStart: "downbeat" };

/** The plan's length kept inside the chosen platforms' limit. */
export const clampPlan = (s: PlanSettings): PlanSettings => ({ ...s, seconds: Math.min(s.seconds, lengthFor(s.targets).max), count: Math.max(1, Math.min(20, Math.round(s.count))) });

/** One line on the plan, for the step's summary. */
export function describePlan(s: PlanSettings, hasMusic: boolean): string {
  const look = s.look === "none" ? "as graded" : `${introStyle(s.look).name} look`;
  const cuts = hasMusic ? (s.beatsPerCut === "mixed" ? "cuts in a mixed beat pattern" : `a cut every ${s.beatsPerCut} beat${s.beatsPerCut === 1 ? "" : "s"}`) : `a scene every ${s.sceneSeconds} s`;
  return `${s.count > 1 ? `${s.count} shorts of ` : ""}${s.seconds} s · ${look} · ${cuts} · ${SHORT_ORDERS.find((o) => o.id === s.order)?.name.toLowerCase() ?? s.order}${s.loop ? " · loops" : ""}`;
}

/** The main content's span on a timeline, with a margin at each end left out (the parking lot, the arrival). */
export function contentSpan(placed: PlacedClip[], margin = 0.04): { from: number; to: number } | null {
  if (!placed.length) return null;
  const t0 = placed[0].start, t1 = placed[placed.length - 1].end, len = t1 - t0;
  if (len <= 0) return null;
  return { from: t0 + len * margin, to: t1 - len * margin };
}

/** `count` equal stretches of the content span, one per short. */
export function stretches(placed: PlacedClip[], count: number, margin = 0.04): { from: number; to: number }[] {
  const span = contentSpan(placed, margin);
  if (!span) return [];
  const n = Math.max(1, count), w = (span.to - span.from) / n;
  return Array.from({ length: n }, (_, i) => ({ from: span.from + w * i, to: span.from + w * (i + 1) }));
}

/**
 * Candidate instants across a stretch of the timeline: `windows` equal windows with `perWindow` instants spread in
 * each, every instant with `needSeconds` of footage around it within its clip (it slides to where there is).
 */
export function candidatesIn(placed: PlacedClip[], from: number, to: number, windows: number, perWindow: number, needSeconds: number): Moment[][] {
  if (!placed.length || windows < 1 || perWindow < 1 || to <= from) return [];
  const wlen = (to - from) / windows;
  const out: Moment[][] = [];
  for (let i = 0; i < windows; i++) {
    const window: Moment[] = [];
    for (let j = 0; j < perWindow; j++) {
      const t = from + wlen * (i + (j + 0.5) / perWindow);
      const clip = placed.find((c) => t >= c.start && t < c.end) ?? placed[placed.length - 1];
      const speed = clipSpeed(clip);
      const lead = needSeconds * speed * 0.3, tail = needSeconds * speed - lead;
      let src = clip.in + (t - clip.start) * speed;
      src = Math.min(src, clip.out - tail);
      src = Math.max(src, clip.in + lead);
      src = Math.min(clip.out, Math.max(clip.in, src));
      window.push({ clipId: clip.id, sourceTime: src, timelineT: clip.start + (src - clip.in) / speed });
    }
    out.push(window);
  }
  return out;
}

/** The moments in the order the plan wants them. */
export function orderMoments(moments: Moment[], order: ShortOrder): Moment[] {
  const byTime = [...moments].sort((a, b) => a.timelineT - b.timelineT);
  if (order === "chronological" || moments.length < 2) return byTime;
  const score = (m: Moment) => m.score ?? 0;
  if (order === "build") return [...moments].sort((a, b) => score(a) - score(b));
  const best = byTime.reduce((x, m) => (score(m) > score(x) ? m : x), byTime[0]);
  return [best, ...byTime.filter((m) => m !== best)];
}

/** A scene lifted from a source clip around an instant: `seconds` on the timeline at `speed`, kept inside the footage with `handle` seconds spare at each edge for a transition. */
export function liftScene(project: Project, source: Clip, sourceTime: number, seconds: number, speed: number, handle: number): Clip {
  const media = project.media[source.media];
  const need = Math.max(0.25, seconds) * speed;
  const lead = need * 0.3;
  const lo0 = Math.max(0, source.in), hi0 = Math.min(media?.duration ?? source.out, source.out);
  const room = hi0 - lo0 >= need + 2 * handle;
  const lo = room ? lo0 + handle : lo0, hi = room ? hi0 - handle : hi0;
  let start = sourceTime - lead;
  if (start + need > hi) start = hi - need;
  if (start < lo) start = lo;
  const out = Math.min(hi0, start + need);
  const clip: Clip = { id: newId(), media: source.media, in: start, out, transform: { ...source.transform, crop: { ...source.transform.crop } }, grade: { ...source.grade }, gainDb: source.gainDb, muted: source.muted };
  if (source.reframe) clip.reframe = { keys: source.reframe.keys.map((k) => ({ ...k })) };
  if (speed !== 1) clip.speed = speed;
  return clip;
}

export interface ShortInput {
  /** The short's name (the folder and the file take it). */
  name: string;
  /** The source timeline the moments point into. */
  source: Project;
  /** Scored candidate windows for this short's stretch, one scene per window. */
  windows: Moment[][];
  settings: PlanSettings;
  /** The music for the set, with its beats when they were read. */
  music?: { media: MediaRef; grid: BeatGrid | null } | null;
  /** This short's place in the set, for the tags. */
  index?: number;
  of?: number;
}

/** How long the hook shows: the first two beats, or two and a half seconds. */
const hookSeconds = (grid: BeatGrid | null | undefined, musicIn: number) => {
  if (!grid || grid.beats.length < 3) return 2.5;
  const i = grid.beats.findIndex((b) => b >= musicIn - 1e-3);
  const a = grid.beats[i], b = grid.beats[i + 2];
  return a !== undefined && b !== undefined ? Math.min(4, Math.max(1.2, b - a)) : 2.5;
};

/**
 * Scene lengths for a short of this length: on the beat when the music has a grid, even otherwise — and the grid's
 * start depends on where the music is made to begin, which depends on the hook's length, so both are settled here.
 */
export function planTiming(s: PlanSettings, grid: BeatGrid | null | undefined): { durations: number[]; musicIn: number; hookSeconds: number } {
  if (!grid) {
    return { durations: cutDurations(null, 0, s.seconds, s.beatsPerCut, s.sceneSeconds), musicIn: 0, hookSeconds: 2.5 };
  }
  // The drop lands where the hook ends; a downbeat lands on the first frame.
  const hook = hookSeconds(grid, musicInFor(grid, "downbeat", 0));
  const musicIn = musicInFor(grid, s.musicStart, s.musicStart === "drop" ? hook : 0);
  return { durations: cutDurations(grid, musicIn, s.seconds, s.beatsPerCut, s.sceneSeconds), musicIn, hookSeconds: hookSeconds(grid, musicIn) };
}

/** A whole short as an editor project, from the scored moments of its stretch. */
export function planShort(input: ShortInput): Project {
  const { source, settings: s, music } = input;
  const grid = music?.grid ?? null;
  const timing = planTiming(s, grid);
  const style = s.look !== "none" ? introStyle(s.look) : null;
  const speed = style?.speed ?? 1;
  // The transition between scenes: the look's own, or the plan's, never longer than two fifths of the shorter scene.
  const transitionFor = (seconds: number) => {
    const want = style ? style.transition : s.cut === "cut" ? null : { kind: s.cut, duration: 0.5 };
    if (!want) return null;
    return { kind: want.kind, duration: +Math.min(want.duration, 0.4 * seconds).toFixed(3) };
  };
  const placed = placeClips(source.clips);
  const moments = orderMoments(pickMoments(input.windows), s.order).slice(0, timing.durations.length);
  const clips: Clip[] = [];
  moments.forEach((m, i) => {
    const src = placed.find((c) => c.id === m.clipId);
    if (!src) return;
    const seconds = timing.durations[i];
    const tr = transitionFor(seconds);
    const clip = liftScene(source, src, m.sourceTime, seconds, speed, (tr?.duration ?? 0) / 2 + 0.2);
    clip.muted = !s.cameraSound;
    if (style) {
      clip.introRole = "scene";
      clip.introSeconds = seconds;
    }
    if (i > 0 && tr) clip.transitionIn = tr;
    clips.push(clip);
  });
  // The loop: a last glimpse of the opening frames, dissolved into, so the end meets the start.
  if (s.loop && clips.length) {
    const first = clips[0];
    const tail = { ...first, id: newId(), out: Math.min(first.out, first.in + 0.6 * speed), transitionIn: { kind: "dissolve" as TransitionKind, duration: 0.5 } };
    if (style) tail.introSeconds = 0.6;
    clips.push(tail);
  }
  const project = newProject(input.name);
  project.id = newId();
  const mediaIds = new Set(clips.map((c) => c.media));
  const media: Record<string, MediaRef> = {};
  for (const id of mediaIds) if (source.media[id]) media[id] = { ...source.media[id] };
  if (music) media[music.media.id] = { ...music.media };
  const tracks: MusicTrack[] = [];
  const total = clips.reduce((a, c) => a + (c.out - c.in) / clipSpeed(c), 0);
  if (music) tracks.push({ id: newId(), media: music.media.id, lane: 0, start: 0, in: timing.musicIn, out: Math.min(music.media.duration || Infinity, timing.musicIn + total + 1), gainDb: 0, muted: false, fadeIn: s.musicStart === "drop" ? 0 : 0.3, fadeOut: 1.2, keyframes: [] });
  const hook = newTitle("hook", 0, s.hook.trim() || input.name);
  hook.duration = +timing.hookSeconds.toFixed(2);
  const presetExport = applyPreset(DEFAULT_EXPORT, "shorts-1080");
  const sound = s.cameraSound ? "footage" : "music-video";
  const levels = soundLevels({ sound });
  return {
    ...project,
    media,
    clips: clips.map((c) => ({ ...c, gainDb: levels.camera })),
    music: tracks.map((t) => ({ ...t, gainDb: levels.music })),
    titles: [hook],
    sound,
    customLut: source.customLut ?? null,
    export: { ...presetExport, frame: "9:16", smartCopy: false, range: null, check: "quick", review: "off", tags: { ...presetExport.tags, kind: "video", title: input.name, comment: input.of && input.of > 1 ? `Short ${input.index ?? 1} of ${input.of} from ${source.name}` : `Short from ${source.name}` } },
    intro: style ? { style: style.id, sceneSeconds: null, card: { ...DEFAULT_CARD, enabled: false, seconds: 0 }, keepAudio: s.cameraSound, outro: "look" } : project.intro,
    safeArea: safeAreaFor(s.targets),
    layout: null,
    proxies: Object.fromEntries(Object.entries(source.proxies ?? {}).filter(([id]) => mediaIds.has(id))),
  };
}

/** Timeline seconds a short lasts, from its clips. */
export const shortSeconds = (p: Project) => p.clips.reduce((a, c) => a + (c.out - c.in) / clipSpeed(c), 0);

/** How many scenes a short of this length needs, so the widget knows how many windows to scan. */
export const sceneCount = (s: PlanSettings, grid: BeatGrid | null | undefined) => Math.max(1, planTiming(s, grid).durations.length);

/** The footage a candidate needs around it: the longest scene at the look's speed plus a transition's handles. */
export function needSeconds(s: PlanSettings, grid: BeatGrid | null | undefined): number {
  const style = s.look !== "none" ? introStyle(s.look) : null;
  const longest = Math.max(0.5, ...planTiming(s, grid).durations);
  return longest * (style?.speed ?? 1) + 1;
}
