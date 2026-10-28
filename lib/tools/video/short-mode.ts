/**
 * Short mode in the Video Editor: many shorts cut from one landscape timeline. A short is a named span of the edit
 * with its own loop, targets and export preset; its titles are the timeline's titles tagged with its id, and its
 * window keys are the clips' own. Everything here is pure and deterministic: the project an export of one short
 * renders, the names its files take, the checks before it, the seam score behind a loop, and the suggestions.
 */
import { EXPORT_PRESETS, applyPreset } from "./export-presets";
import type { Moment } from "./intro";
import type { PreflightItem } from "./preflight";
import { GLIMPSE_SECONDS, clipSpeed, musicLength, newId, newShort, placeClips, timelineDuration, type Clip, type MusicTrack, type Project, type Short, type Title } from "./project";
import { PLATFORMS, lengthFor, postCopy, safeAreaFor, shortLimits, type PlatformId, type ShortEnv } from "./shorts";
import { candidatesIn, stretches } from "./shortplan";
import { shortFolderName } from "./shortset";

/** The sub-folder of the project folder the shorts' files go into. */
export const SHORTS_FOLDER = "shorts";
/** What a new short takes from the playhead when nothing else says. */
export const DEFAULT_SHORT_SECONDS = 30;
export const MIN_SHORT_SECONDS = 1;
/** The export presets a short may use: the vertical ones. */
export const SHORT_PRESETS = EXPORT_PRESETS.filter((p) => p.settings.frame === "9:16").map((p) => p.id);
export const DEFAULT_SHORT_PRESET = "shorts-1080";

/** A short's span kept inside the timeline and at least a second long. */
export function clampShort(s: Short, duration: number): Short {
  const from = Math.max(0, Math.min(s.from, Math.max(0, duration - MIN_SHORT_SECONDS)));
  const to = Math.max(from + MIN_SHORT_SECONDS, Math.min(s.to, Math.max(duration, from + MIN_SHORT_SECONDS)));
  return from === s.from && to === s.to ? s : { ...s, from, to };
}

export const shortSeconds = (s: Short) => s.to - s.from;

/** The titles the landscape edit shows and exports: those not tagged for a short. */
export const landscapeTitles = (titles: Title[]) => titles.filter((t) => !t.short);
/** The titles a short shows and exports: those tagged with its id. */
export const titlesOf = (titles: Title[], shortId: string) => titles.filter((t) => t.short === shortId);

/**
 * The project as one mode sees it: the landscape edit without the shorts' titles, or one short's titles alone, still
 * at their timeline places (the preview plays the timeline itself), with the short's safe area.
 */
export function viewFor(project: Project, short: Short | null): Project {
  if (!short) return project.titles.some((t) => t.short) ? { ...project, titles: landscapeTitles(project.titles) } : project;
  return { ...project, titles: titlesOf(project.titles, short.id), safeArea: safeAreaFor(short.targets as PlatformId[]) };
}

/** The timeline's clips between two instants, trimmed at both ends; the first loses its incoming transition. */
export function clipsBetween(clips: Clip[], from: number, to: number): Clip[] {
  const out: Clip[] = [];
  for (const c of placeClips(clips)) {
    if (c.end <= from + 1e-6 || c.start >= to - 1e-6) continue;
    const speed = clipSpeed(c);
    const { start, end, index, ...rest } = c;
    void start;
    void end;
    void index;
    const cut: Clip = { ...rest, in: c.in + Math.max(0, from - c.start) * speed, out: c.out - Math.max(0, c.end - to) * speed };
    if (!out.length) {
      delete cut.transitionIn;
      delete cut.joinedToPrevious;
    }
    if (cut.out - cut.in > 1e-6) out.push(cut);
  }
  return out;
}

/** The titles that play between two instants, moved to start from zero and cut to the span. */
export function titlesBetween(titles: Title[], from: number, to: number): Title[] {
  return titles
    .filter((t) => t.start < to && t.start + t.duration > from)
    .map((t) => {
      const cutFront = Math.max(0, from - t.start);
      const start = Math.max(0, t.start - from);
      const duration = Math.min(t.duration - cutFront, to - from - start);
      return { ...t, start, duration };
    });
}

/**
 * The music heard between two instants, moved to start from zero and cut to the span: a track the span cuts into
 * fades in briefly, one it cuts short fades out — shorter fades for a loop, so the seam is soft but not slow.
 */
export function musicBetween(music: MusicTrack[], from: number, to: number, loop: boolean): MusicTrack[] {
  const len = to - from;
  return music
    .filter((m) => m.start < to && m.start + musicLength(m) > from)
    .map((m) => {
      const cutFront = Math.max(0, from - m.start);
      const start = Math.max(0, m.start - from);
      const inPoint = m.in + cutFront;
      const out = Math.min(m.out, inPoint + (len - start));
      const keyframes = m.keyframes.map((k) => ({ ...k, t: k.t - cutFront })).filter((k) => k.t >= 0 && k.t <= out - inPoint);
      const cutEnd = m.out - out > 1e-6;
      return {
        ...m,
        start,
        in: inPoint,
        out,
        keyframes,
        fadeIn: cutFront > 0 ? Math.max(m.fadeIn, loop ? 0.15 : 0.1) : m.fadeIn,
        fadeOut: cutEnd ? Math.max(m.fadeOut, loop ? 0.3 : 0.5) : m.fadeOut,
      };
    });
}

/**
 * The project an export of one short renders: its clips cut to the span (a glimpse loop repeats the first fraction of
 * a second at the end under a short dissolve), its titles and music moved to start from zero, the vertical frame, the
 * short's preset and safe area, no range, no review, the quick check — an ordinary Project the engine already knows.
 */
export function shortProject(project: Project, short: Short): Project {
  const s = clampShort(short, timelineDuration(project));
  const loop = s.loop !== "off";
  const clips = clipsBetween(project.clips, s.from, s.to);
  if (s.loop === "glimpse" && clips.length) {
    const first = clips[0];
    const speed = clipSpeed(first);
    const { introRole, introSeconds, joinedToPrevious, ...rest } = first;
    void introRole;
    void introSeconds;
    void joinedToPrevious;
    clips.push({ ...rest, id: newId(), in: first.in, out: Math.min(first.out, first.in + GLIMPSE_SECONDS * speed), transitionIn: { kind: "dissolve", duration: Math.min(0.3, GLIMPSE_SECONDS * 0.75) } });
  }
  const music = musicBetween(project.music, s.from, s.to, loop);
  const used = new Set<string>([...clips.map((c) => c.media), ...music.map((m) => m.media), ...(project.watermark.media ? [project.watermark.media] : [])]);
  const media = Object.fromEntries(Object.entries(project.media).filter(([id]) => used.has(id)));
  const preset = SHORT_PRESETS.includes(s.preset ?? "") ? s.preset! : DEFAULT_SHORT_PRESET;
  return {
    ...project,
    id: s.id,
    name: s.name,
    clips,
    titles: titlesBetween(titlesOf(project.titles, s.id), s.from, s.to),
    music,
    media,
    export: { ...applyPreset(project.export, preset), frame: "9:16", range: null, smartCopy: false, review: "off", check: "quick", tags: { ...project.export.tags, title: s.name } },
    safeArea: safeAreaFor(s.targets as PlatformId[]),
    stops: null,
    shorts: [],
    mode: "landscape",
  };
}

/** "01 Drive 1.mp4", "01 Drive 1 (no music).mp4", "01 Drive 1.jpg", "01 Drive 1.post.txt" — one stem per short, numbered by its place. */
export const shortStem = (index: number, short: Short) => shortFolderName(index, short.name);
export const shortFileName = (index: number, short: Short, variant: "" | "no-music" | "cover" | "post" = "") =>
  `${shortStem(index, short)}${variant === "no-music" ? " (no music).mp4" : variant === "cover" ? ".jpg" : variant === "post" ? ".post.txt" : ".mp4"}`;

export type LengthState = "short" | "sweet" | "ok" | "over";
/** A short's length against its targets: under the sweet spot, in it, inside the limit, or over it (and for whom). */
export function lengthBand(seconds: number, targets: PlatformId[]): { state: LengthState; note: string } {
  const { max, sweet } = lengthFor(targets);
  if (seconds > max) {
    const refusing = targets.filter((id) => PLATFORMS[id] && seconds > PLATFORMS[id].maxSeconds).map((id) => PLATFORMS[id].name);
    return { state: "over", note: `over ${fmtS(max)} — ${refusing.length ? refusing.join(" and ") : "the platforms"} will not treat it as a short` };
  }
  if (seconds < sweet[0]) return { state: "short", note: `under the ${sweet[0]} s sweet spot` };
  if (seconds <= sweet[1]) return { state: "sweet", note: `in the sweet spot, ${sweet[0]}–${sweet[1]} s` };
  return { state: "ok", note: `inside the limit; past ${sweet[1]} s fewer new viewers are reached` };
}
const fmtS = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/**
 * How far two frames are from each other, 0 (the same picture) to 1: the mean absolute difference of their grey
 * levels, pixel by pixel, on small copies of the same size (RGBA bytes).
 */
export function seamScore(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  const n = Math.min(a.length, b.length) >> 2;
  if (!n) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const ga = (a[j] * 299 + a[j + 1] * 587 + a[j + 2] * 114) / 1000, gb = (b[j] * 299 + b[j + 1] * 587 + b[j + 2] * 114) / 1000;
    sum += Math.abs(ga - gb);
  }
  return sum / n / 255;
}
/** The seam in a word. */
export const seamWord = (score: number) => (score < 0.06 ? "seamless" : score < 0.12 ? "close" : score < 0.25 ? "visible" : "a jump");
/** Candidate end points for a loop: every frame in the last `window` seconds of the short, earliest first. */
export function seamCandidates(from: number, to: number, fps: number, window = 1): number[] {
  const step = 1 / Math.max(1, fps);
  const floor = Math.max(from + MIN_SHORT_SECONDS, to - window);
  const out: number[] = [];
  for (let t = to; t > floor + 1e-6; t -= step) out.push(Math.round(t * 1e4) / 1e4);
  return out.reverse();
}

/** A span of `seconds` around a moment, inside a stretch: the moment lands three tenths in, so what led to it is seen. */
export function spanAround(t: number, seconds: number, stretch: { from: number; to: number }): { from: number; to: number } {
  const len = Math.min(seconds, stretch.to - stretch.from);
  const from = Math.round(Math.max(stretch.from, Math.min(t - len * 0.3, stretch.to - len)) * 1e3) / 1e3;
  return { from, to: Math.round((from + len) * 1e3) / 1e3 };
}
/**
 * Where to look for `count` shorts of `seconds` across the timeline: the timeline in equal stretches, and in each a
 * few candidate moments the caller can score (the engine's scan) before `spanAround` places the short.
 */
export function suggestWindows(project: Project, count: number, seconds: number, perStretch = 3): { stretch: { from: number; to: number }; candidates: Moment[] }[] {
  const placed = placeClips(project.clips);
  return stretches(placed, count).map((stretch) => ({ stretch, candidates: candidatesIn(placed, stretch.from, stretch.to, 1, perStretch, seconds).flat() }));
}
/** The shorts suggested from the chosen moments, numbered after the ones there are. */
export function shortsFromMoments(picks: { stretch: { from: number; to: number }; moment: Moment }[], seconds: number, existing: number): Short[] {
  return picks.map((p, i) => {
    const span = spanAround(p.moment.timelineT, seconds, p.stretch);
    return newShort(span.from, span.to, existing + i + 1);
  });
}

/** What the export of a short will weigh, from its settings alone. */
export const shortBytes = (derived: Project, seconds: number) => Math.round(((derived.export.bitrateMbps * 1e6 + derived.export.audioBitrateKbps * 1e3) / 8) * seconds);

/** The pre-flight for one short: the platforms' limits and the things that lose viewers in the first seconds. */
export function shortChecks(derived: Project, targets: PlatformId[], fps: number): PreflightItem[] {
  const placed = placeClips(derived.clips);
  const seconds = placed.length ? placed[placed.length - 1].end : 0;
  const env: ShortEnv = {
    seconds,
    fps,
    bytes: shortBytes(derived, seconds),
    firstTitleAt: derived.titles.length ? Math.min(...derived.titles.map((t) => t.start)) : null,
    firstCutAt: placed.length > 1 ? placed[1].start : null,
    music: derived.music.some((m) => !m.muted && m.gainDb > -60),
    cameraSound: derived.clips.some((c) => !c.muted && c.gainDb > -60),
  };
  return shortLimits(derived, targets, env);
}

/** The title, description and hashtags to post with a short, as the file beside it holds them. */
export function shortPostText(derived: Project, targets: PlatformId[], index: number, of: number, seconds: number): string {
  return postCopy(derived, targets, { part: of > 1 ? { index, of } : undefined, seconds }).text;
}
