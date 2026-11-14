import { normalizeObscure, type ObscureArea } from "./obscure";
/**
 * The video editor's project model and the pure arithmetic on it: timeline
 * layout from clips, music placement with overlaps and crossfades, gain
 * keyframes, the smart-copy export plan, and serialisation for autosave.
 * Nothing here touches the DOM, files or codecs — see engine.ts for that.
 */
import type { StopScan } from "./stops";
import type { BeatGrid } from "./beats";

/** Built-in conversions, plus the project's own .cube (DJI's official file, say). */
export type LutKind = "none" | "dji-official" | "dlogm" | "dji-official-vivid" | "dji-official-vivid-sky" | "dji-official-night" | "dji-official-night-balanced" | "dji-official-night-steady" | "dji-official-study" | "dlogm-study" | "dlogm-natural" | "dlogm-vivid" | "dlogm-vivid-sky" | "dlogm-night" | "dlogm-night-balanced" | "dlogm-night-steady" | "dlog" | "custom";
export const LUT_KINDS: LutKind[] = ["none", "dji-official", "dlogm", "dji-official-vivid", "dji-official-vivid-sky", "dji-official-night", "dji-official-night-balanced", "dji-official-night-steady", "dji-official-study", "dlogm-study", "dlogm-natural", "dlogm-vivid", "dlogm-vivid-sky", "dlogm-night", "dlogm-night-balanced", "dlogm-night-steady", "dlog", "custom"];
/** Conversions computed from DJI's own LUT file (fetched at runtime) rather than the modelled curves. */
export type FileLutKind = "dji-official" | "dji-official-vivid" | "dji-official-vivid-sky" | "dji-official-night" | "dji-official-night-balanced" | "dji-official-night-steady" | "dji-official-study";
export const FILE_LUT_KINDS: FileLutKind[] = ["dji-official", "dji-official-vivid", "dji-official-vivid-sky", "dji-official-night", "dji-official-night-balanced", "dji-official-night-steady", "dji-official-study"];
export type MathLutKind = Exclude<LutKind, "none" | "custom" | FileLutKind>;
export const isFileLutKind = (k: LutKind): k is FileLutKind => (FILE_LUT_KINDS as LutKind[]).includes(k);

export interface Grade {
  /** Which conversion to apply first; "none" skips the LUT. */
  lut: LutKind;
  /** Stops of exposure, −3…+3. */
  exposure: number;
  /** White balance: temperature shift (blue ↔ amber) and tint (green ↔ magenta), −100…100. */
  temperature: number;
  tint: number;
  /** 0 = flat, 1 = neutral, 2 = strong. */
  contrast: number;
  saturation: number;
}

export const NEUTRAL_GRADE: Grade = { lut: "none", exposure: 0, temperature: 0, tint: 0, contrast: 1, saturation: 1 };

export interface Transform {
  /** Quarter turns, 0–3. */
  rotate: 0 | 1 | 2 | 3;
  /** Fine straightening in degrees, −10…10. */
  straighten: number;
  /** Crop as fractions of the (rotated) frame, 0–1. */
  crop: { x: number; y: number; w: number; h: number };
}

export const NEUTRAL_TRANSFORM: Transform = { rotate: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };

/**
 * The export frame's shape: the recording's own, or a vertical, square or portrait frame cut from it. A frame that is
 * not the recording's shows a window of the (cropped) picture — see reframe.ts for where the window sits.
 */
export type Frame = "source" | "9:16" | "1:1" | "4:5";
export const FRAMES: Frame[] = ["source", "9:16", "1:1", "4:5"];
export const FRAME_ASPECT: Record<Exclude<Frame, "source">, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };
export const FRAME_LABELS: Record<Frame, string> = { source: "As recorded", "9:16": "Vertical 9:16", "1:1": "Square 1:1", "4:5": "Portrait 4:5" };

/**
 * Where the frame's window into the footage sits at one moment: its centre as fractions of the clip's picture and how
 * far in it is (1 shows as much of the picture as the frame's shape allows, 2 half of that). Several keys make the
 * window move over the clip: eased between them, held beyond the first and the last.
 */
export interface ReframeKey {
  /** Source seconds. */
  t: number;
  cx: number;
  cy: number;
  zoom: number;
  /** Hold this window until the next key instead of easing towards it. */
  hold?: boolean;
}
export interface Reframe {
  keys: ReframeKey[];
}
export const MAX_REFRAME_ZOOM = 4;

/**
 * How a frame that is not the recording's shape is filled: the window alone (fill), the whole picture fitted into it
 * over a blurred copy of the window or a plain colour (fit), or the whole picture along the top or bottom with the
 * window filling the rest (stack).
 */
export type LayoutKind = "fill" | "fit" | "stack";
export const LAYOUT_KINDS: LayoutKind[] = ["fill", "fit", "stack"];
export type LayoutBackground = "blur" | "black" | "colour";
export interface Layout {
  kind: LayoutKind;
  /** Behind a fitted picture: the window blurred and dimmed, black, or `colour`. */
  background?: LayoutBackground;
  colour?: string;
  /** Fit: where the picture sits, 0 at the top, 1 at the bottom, 0.5 centred. */
  position?: number;
  /** Stack: which edge the whole picture runs along. */
  wideAt?: "top" | "bottom";
  /** Blur radius as a fraction of the frame width, and how dark the blurred copy goes, 0–0.9. */
  blur?: number;
  dim?: number;
}
export const DEFAULT_LAYOUT: Required<Layout> = { kind: "fill", background: "blur", colour: "#000000", position: 0.5, wideAt: "top", blur: 0.03, dim: 0.35 };
export const layoutSettings = (l: Layout | null | undefined): Required<Layout> => ({ ...DEFAULT_LAYOUT, ...(l ?? {}) });

/**
 * The part of the frame a platform's own buttons and captions leave visible, as fractions of each edge: titles are
 * placed inside it. Null or missing: the whole frame is safe, as for a YouTube upload.
 */
export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where a media file lives, as near to a path as the browser allows: a folder the editor holds a handle for — the
 * project folder, or one the user asked it to remember — and the file's path inside it.
 */
export interface MediaWhere {
  /** "project", or the key of a remembered folder (see Project.folders). */
  folder: string;
  path: string;
}

export interface MediaRef {
  /** Key into the project store's file handles. */
  id: string;
  name: string;
  size: number;
  where?: MediaWhere;
  /** Media duration in seconds. */
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  hasAudio?: boolean;
  sampleRate?: number;
  /** Rotation the file asks players for, degrees; a recording is only copied as is when it needs none. */
  rotation?: number;
  /**
   * Where the recording's keyframes fall (source seconds, presentation order), read from its index when it is linked.
   * The export copies whole keyframe groups as they are and re-encodes only around cuts, transitions and titles; a
   * recording without this list is re-encoded throughout, and `keyframeNote` says why none could be read.
   */
  keyframeTimes?: number[];
  keyframeNote?: string;
}

export interface Clip {
  id: string;
  media: string;
  /** Trim in/out within the source, seconds. */
  in: number;
  out: number;
  transform: Transform;
  /** Fixed rectangles in the output frame, applied for this clip. */
  obscure?: ObscureArea[];
  /** Where the export frame's window sits in this clip when the frame is not the recording's shape (or to punch in); missing: centred, as much as fits. */
  reframe?: Reframe;
  grade: Grade;
  /** Original audio gain in dB (−60 mutes) and mute flag. */
  gainDb: number;
  muted: boolean;
  /** The transition leading into this clip from the one before it, if any. */
  transitionIn?: Transition;
  /** This clip continues the previous one with no visible cut: no marker, no transition, and shared grade, crop and audio. */
  joinedToPrevious?: boolean;
  /** Playback speed: 2 plays the footage twice as fast (half as long on the timeline), 0.5 is slow motion. Missing means 1. */
  speed?: number;
  /** Part of the intro at the head of the timeline: a scene lifted from the drive, or the title card that ends the intro. */
  introRole?: IntroRole;
  /** An intro scene's intended timeline length; its in/out follow this at the style's speed, as far as the footage allows. */
  introSeconds?: number;
}

export type IntroRole = "scene" | "card";
export const INTRO_ROLES: IntroRole[] = ["scene", "card"];

/**
 * The intro that opens the video: its scenes are ordinary clips tagged with introRole at the head of the
 * timeline (see intro.ts); these settings say how they are styled and what the title card shows.
 */
/** The title card that ends the intro: the project name set over the last scene's footage, dimmed and softened. */
export interface IntroCard {
  /** Empty = the project name. */
  text: string;
  subtitle: string;
  /** Length in seconds (0 = no card). */
  seconds: number;
  /** false leaves the card out while keeping its settings. */
  enabled?: boolean;
  /** Where the title sits: top/middle/bottom × left/centre/right. */
  position?: TitlePosition;
  /** A preset key (sans, serif, mono, rounded) or any font family name. */
  font?: string;
  /** CSS colour of the text. */
  color?: string;
  /** Title height as a fraction of the frame height; the subtitle is 0.42 of it. */
  size?: number;
  /** How dark the footage goes under the title, 0 (as it is) to 0.9. */
  dim?: number;
  /** Soften the footage under the title. */
  blur?: boolean;
  /** The subtitle in spaced capitals. */
  caps?: boolean;
  /** Seconds the title takes to rise and fade in. */
  fade?: number;
}
export const DEFAULT_CARD: Required<IntroCard> = { text: "", subtitle: "", seconds: 2.5, enabled: true, position: "mc", font: "sans", color: "#ffffff", size: 0.1, dim: 0.55, blur: true, caps: true, fade: 0.5 };
/** The card's settings with every field filled in (projects saved before the options existed carry only the first three). */
export const cardSettings = (card: IntroCard): Required<IntroCard> => ({ ...DEFAULT_CARD, ...card });
/** Whether the intro ends on a card at all. */
export const hasCard = (card: IntroCard) => card.enabled !== false && card.seconds > 0;
/** How the intro hands over to the video: the look's own transition, or opening out — the title fades and the letterbox bars slide away over a dissolve. */
export type IntroOutro = "look" | "open";
export const INTRO_OUTROS: IntroOutro[] = ["look", "open"];

export interface IntroSettings {
  /** One of the ten looks in intro.ts. */
  style: string;
  /** Timeline seconds per new scene; null takes the style's own. */
  sceneSeconds: number | null;
  /** The title card that ends the intro. */
  card: IntroCard;
  /** Scenes keep their own sound (at their speed); off, they play quiet under the music. */
  keepAudio: boolean;
  /** The ending; missing means the look's own. */
  outro?: IntroOutro;
}
export const DEFAULT_INTRO: IntroSettings = { style: "cinematic", sceneSeconds: null, card: { ...DEFAULT_CARD }, keepAudio: false, outro: "look" };

export const CLIP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.75, 1.8, 2, 3, 4, 8, 16] as const;
export const MIN_CLIP_SPEED = 0.1, MAX_CLIP_SPEED = 16;
/** A clip's speed, clamped; 1 when unset. */
export const clipSpeed = (c: Pick<Clip, "speed">) => (c.speed && Number.isFinite(c.speed) ? Math.min(MAX_CLIP_SPEED, Math.max(MIN_CLIP_SPEED, c.speed)) : 1);
/** Timeline instant → where in the source a clip is showing at that moment. */
export const sourceTimeAt = (c: Clip & { start: number }, t: number) => c.in + (t - c.start) * clipSpeed(c);

export interface Keyframe {
  /** Seconds from the start of the music track's own timeline position. */
  t: number;
  /** Gain in dB. */
  db: number;
}

export interface MusicTrack {
  id: string;
  media: string;
  /** Lane 0, 1 or 2 — tracks on different lanes may overlap. */
  lane: number;
  /** Timeline position of the track start, seconds. */
  start: number;
  /** Trim within the music file, seconds. */
  in: number;
  out: number;
  gainDb: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  keyframes: Keyframe[];
  /** The track's beats, once analysed (beats.ts), for ticks, snapping and cuts on the beat. */
  beats?: BeatGrid | null;
}

/* ---------------------------------------------------------- the song library (music-fill.ts) */

/** How much a song is liked: 0 as any other, 1 liked (placed about twice as often), 2 a favourite (about four times). */
export type SongLike = 0 | 1 | 2;
export const LIKE_WEIGHTS: Record<SongLike, number> = { 0: 1, 1: 2, 2: 4 };

/** What the project remembers about a song beyond its file: how it is liked and whether the shuffle may place it. */
export interface SongPrefs {
  like: SongLike;
  /** False keeps the song out of the shuffle; it stays in the library and may still open or close the video. */
  use: boolean;
}
export const DEFAULT_SONG_PREFS: SongPrefs = { like: 0, use: true };

export type FillOrder = "shuffle" | "listed";
export const FILL_ORDERS: FillOrder[] = ["shuffle", "listed"];
/** How "Shuffle & fill" lays the songs over the video, saved with the project. */
export interface FillSettings {
  /** Seconds one song overlaps the next for the crossfade. */
  overlap: number;
  /** The song the video opens with and the one it closes with (its end at the video's end); null leaves it to the shuffle. */
  first: string | null;
  last: string | null;
  order: FillOrder;
}
export const DEFAULT_FILL: FillSettings = { overlap: 2, first: null, last: null, order: "shuffle" };

/** Saved song preferences made whole; anything unreadable falls back to the defaults. */
export function normalizeSongPrefs(raw: unknown): SongPrefs {
  const s = (raw ?? {}) as Partial<SongPrefs>;
  return { like: s.like === 1 || s.like === 2 ? s.like : 0, use: s.use !== false };
}

/** Saved fill settings made whole. */
export function normalizeFill(raw: unknown): FillSettings {
  const f = (raw ?? {}) as Partial<FillSettings>;
  return { overlap: typeof f.overlap === "number" && f.overlap >= 0 ? Math.min(10, f.overlap) : DEFAULT_FILL.overlap, first: typeof f.first === "string" ? f.first : null, last: typeof f.last === "string" ? f.last : null, order: FILL_ORDERS.includes(f.order as FillOrder) ? (f.order as FillOrder) : "shuffle" };
}

/* ---------------------------------------------------------- sound regions */

/**
 * A stretch of the video mixed its own way: the camera's sound at a level of its own (or as the clips are), the music
 * held under a level (or off, or as placed), the levels easing in over a ramp before the region and out over one
 * after it, so the whole region sits at its levels. Regions never overlap. They shape the landscape export, the
 * preview and any short cut from those seconds; Shuffle & fill leaves a region with the music off empty.
 */
export interface SoundRegion {
  id: string;
  name?: string;
  /** Timeline seconds. */
  from: number;
  to: number;
  /** The camera's sound inside, in dB (−60 off); null leaves the clips at their own levels. A muted or switched-off clip stays silent. */
  camera: number | null;
  /** The most the music may be inside, in dB (−60 off); null leaves the tracks as placed. Fades and crossfades keep their shape under it. */
  music: number | null;
  /** Seconds the levels take to change, before the region begins and again after it ends. */
  ramp: number;
}
export const DEFAULT_REGION_RAMP = 1;
export const MAX_REGION_RAMP = 5;
/** The least a region may span, seconds. */
export const MIN_REGION_SECONDS = 0.5;
export type RegionPreset = "camera" | "quiet" | "music";
/** The three mixes a region is usually for; the levels stay editable. */
export const REGION_PRESETS: { id: RegionPreset; name: string; hint: string; camera: number | null; music: number | null }[] = [
  { id: "camera", name: "The video's sound only", hint: "The music steps aside and the camera's sound plays at full level.", camera: 0, music: -60 },
  { id: "quiet", name: "Quieter video, a little music", hint: "The camera's sound a touch down, the music far under it.", camera: -6, music: -24 },
  { id: "music", name: "Music only", hint: "The camera's sound goes out; the music plays as placed.", camera: -60, music: null },
];
/** Which preset a region's levels are, if any. */
export const regionPreset = (r: Pick<SoundRegion, "camera" | "music">): RegionPreset | null => REGION_PRESETS.find((p) => p.camera === r.camera && p.music === r.music)?.id ?? null;
export function newRegion(from: number, to: number, preset: RegionPreset = "camera"): SoundRegion {
  const p = REGION_PRESETS.find((x) => x.id === preset) ?? REGION_PRESETS[0];
  return { id: newId(), from, to, camera: p.camera, music: p.music, ramp: DEFAULT_REGION_RAMP };
}
const dbOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(-60, Math.min(12, v)) : null);
/** A saved region made whole; one without a span is dropped. */
export function normalizeRegion(raw: unknown): SoundRegion | null {
  const r = raw as Partial<SoundRegion> | null;
  if (!r || typeof r !== "object" || typeof r.from !== "number" || typeof r.to !== "number" || !(r.to > r.from)) return null;
  return {
    id: typeof r.id === "string" && r.id ? r.id : newId(),
    ...(typeof r.name === "string" && r.name.trim() ? { name: r.name } : {}),
    from: Math.max(0, r.from),
    to: r.to,
    camera: dbOrNull(r.camera),
    music: dbOrNull(r.music),
    ramp: typeof r.ramp === "number" && r.ramp >= 0 ? Math.min(MAX_REGION_RAMP, r.ramp) : DEFAULT_REGION_RAMP,
  };
}
/** A stretch of the timeline with an id — a sound region, a zoom; the span helpers below serve both. */
export interface Span {
  id: string;
  from: number;
  to: number;
}
/**
 * Spans in time order and never overlapping: one that begins inside the one before it starts where that ends, all are
 * cut at the end of the video when it is given, and what is left shorter than the least span is dropped.
 */
export function tidySpans<T extends Span>(spans: T[], end = Infinity): T[] {
  const out: T[] = [];
  for (const r of [...spans].sort((a, b) => a.from - b.from)) {
    const prev = out[out.length - 1];
    const from = Math.max(r.from, prev ? prev.to : 0), to = Math.min(r.to, end);
    if (to - from >= MIN_REGION_SECONDS - 1e-9) out.push(from === r.from && to === r.to ? r : { ...r, from, to });
  }
  return out;
}
/** The room a span has: from the end of the span before it to the start of the one after it (a neighbour is before it when that neighbour's middle lies before its own), inside the video. */
export function spanRoom(all: Span[], r: Span, end: number): { lo: number; hi: number } {
  const mid = (r.from + r.to) / 2;
  const others = all.filter((x) => x.id !== r.id);
  return {
    lo: others.filter((x) => (x.from + x.to) / 2 < mid).reduce((a, x) => Math.max(a, x.to), 0),
    hi: others.filter((x) => (x.from + x.to) / 2 >= mid).reduce((a, x) => Math.min(a, x.from), end),
  };
}
/** A span trimmed or set: each end held inside its room, at least the least span kept; unchanged when nothing has to give. */
export function clampSpan<T extends Span>(all: T[], r: T, end: number): T {
  const { lo, hi } = spanRoom(all, r, end);
  if (hi - lo < MIN_REGION_SECONDS) return r;
  const from = Math.max(lo, Math.min(r.from, hi - MIN_REGION_SECONDS));
  const to = Math.min(hi, Math.max(r.to, from + MIN_REGION_SECONDS));
  return from === r.from && to === r.to ? r : { ...r, from, to };
}
/** A new span fitted into the room where it is asked for; null when there is no room — less than a second of it (or half of what was asked) would fit. */
export function fitSpan<T extends Span>(all: T[], r: T, end: number): T | null {
  const { lo, hi } = spanRoom(all, r, end);
  if (hi - lo < MIN_REGION_SECONDS || r.from >= end) return null;
  const fit = clampSpan(all, r, end);
  return fit.to - fit.from >= Math.max(MIN_REGION_SECONDS, Math.min(1, (r.to - r.from) / 2)) - 1e-9 ? fit : null;
}
/** A span moved to begin at `from`, its length kept, stopping at its neighbours and the video's edges. */
export function moveSpan<T extends Span>(all: T[], r: T, from: number, end: number): T {
  const len = r.to - r.from;
  const { lo, hi } = spanRoom(all, { id: r.id, from, to: from + len }, end);
  if (hi - lo < MIN_REGION_SECONDS) return r;
  const l = Math.min(len, hi - lo);
  const f = Math.max(lo, Math.min(from, hi - l));
  return f === r.from && f + l === r.to ? r : { ...r, from: f, to: f + l };
}
/** The spans that fall in a stretch of the video, cut to it and timed from its start — for a short's own project. */
export function spansBetween<T extends Span>(spans: T[] | undefined, from: number, to: number): T[] {
  return tidySpans(
    (spans ?? []).filter((r) => r.to > from && r.from < to).map((r) => ({ ...r, from: Math.max(0, r.from - from), to: Math.min(to, r.to) - from })),
    to - from,
  );
}
export const regionsBetween = (regions: SoundRegion[] | undefined, from: number, to: number): SoundRegion[] => spansBetween(regions, from, to);
/** The stretches a region keeps free of music (its music off), in time order and cut to the video. */
export const musicFreeSpans = (regions: SoundRegion[] | undefined, end: number): { from: number; to: number }[] => tidySpans(regions ?? [], end).filter((r) => r.music !== null && r.music <= -60).map((r) => ({ from: r.from, to: r.to }));

/* ---------------------------------------------------------- zooms */

/**
 * A part of the video that pushes into a point of the picture: over the first `ease` seconds the frame closes in to
 * `zoom` times on the centre, holds, and opens out again over the last. Timeline seconds, like titles and sound
 * regions, so a zoom spans whatever footage is under it, cuts included; the centre is a fraction of the clip's
 * (cropped) picture, as the window keys have it. Zooms never overlap. A short cut from those seconds keeps them, the
 * push taken inside its own window.
 */
export interface Zoom extends Span {
  name?: string;
  /** How far in, 1–MAX_REFRAME_ZOOM. */
  zoom: number;
  cx: number;
  cy: number;
  /** Seconds the push in and the pull out each take, never more than half the zoom. */
  ease: number;
}
export const DEFAULT_ZOOM = 1.5;
export const DEFAULT_ZOOM_EASE = 0.6;
export const MAX_ZOOM_EASE = 5;
export const newZoom = (from: number, to: number, zoom = DEFAULT_ZOOM, cx = 0.5, cy = 0.5): Zoom => ({ id: newId(), from, to, zoom, cx, cy, ease: DEFAULT_ZOOM_EASE });
/** A saved zoom made whole; one without a span is dropped. */
export function normalizeZoom(raw: unknown): Zoom | null {
  const z = raw as Partial<Zoom> | null;
  if (!z || typeof z !== "object" || typeof z.from !== "number" || typeof z.to !== "number" || !(z.to > z.from)) return null;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    id: typeof z.id === "string" && z.id ? z.id : newId(),
    ...(typeof z.name === "string" && z.name.trim() ? { name: z.name } : {}),
    from: Math.max(0, z.from),
    to: z.to,
    zoom: num(z.zoom, 1, MAX_REFRAME_ZOOM, DEFAULT_ZOOM),
    cx: num(z.cx, 0, 1, 0.5),
    cy: num(z.cy, 0, 1, 0.5),
    ease: num(z.ease, 0, MAX_ZOOM_EASE, DEFAULT_ZOOM_EASE),
  };
}
export const zoomsBetween = (zooms: Zoom[] | undefined, from: number, to: number): Zoom[] => spansBetween(zooms, from, to);
/** How far into the picture the frame is pushed at an instant and where: a factor over 1 and a centre in picture fractions. */
export interface Punch {
  zoom: number;
  cx: number;
  cy: number;
}
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/**
 * The push at a timeline instant: inside a zoom, its factor eased in log zoom (an S-curve over the ease at either
 * end, the ease never more than half the zoom) with its centre; null outside every zoom and where the factor is 1.
 */
export function zoomAt(zooms: Zoom[] | undefined, t: number): Punch | null {
  for (const z of zooms ?? []) {
    if (t < z.from || t > z.to || !(z.zoom > 1)) continue;
    const ease = Math.min(z.ease, (z.to - z.from) / 2);
    const u = ease > 0 ? Math.min((t - z.from) / ease, (z.to - t) / ease, 1) : 1;
    const factor = Math.exp(Math.log(z.zoom) * smooth(u));
    return factor > 1.0005 ? { zoom: factor, cx: z.cx, cy: z.cy } : null;
  }
  return null;
}
const fmtZoom = (z: number) => `${(Math.round(z * 100) / 100).toFixed(z * 100 % 10 ? 2 : 1)}×`;
/** "1.5× · centre", "2× · left, up" — the factor and where in the picture. */
export function zoomLabel(z: Pick<Zoom, "zoom" | "cx" | "cy">): string {
  const across = z.cx < 0.4 ? "left" : z.cx > 0.6 ? "right" : "", down = z.cy < 0.4 ? "up" : z.cy > 0.6 ? "down" : "";
  const where = [across, down].filter(Boolean).join(", ") || "centre";
  return `${fmtZoom(z.zoom)} · ${where}`;
}
/** One line about the zooms: how many, the seconds they cover, the strongest. */
export function describeZooms(zooms: Zoom[] | undefined, end: number): string {
  const list = tidySpans(zooms ?? [], end);
  if (!list.length) return "none yet";
  const covered = list.reduce((a, z) => a + (z.to - z.from), 0);
  return `${list.length} zoom${list.length === 1 ? "" : "s"} · ${fmtTime(covered)} pushed in · up to ${fmtZoom(Math.max(...list.map((z) => z.zoom)))}`;
}

/* ---------------------------------------------------------- shorts (Short mode) */

/** The platforms a short is made for — the same ids as shorts.ts's PlatformId. */
export type ShortTarget = "shorts" | "reels" | "tiktok";
export const SHORT_TARGETS: ShortTarget[] = ["shorts", "reels", "tiktok"];
export type ShortLoop = "off" | "cut" | "glimpse";
export const SHORT_LOOPS: { id: ShortLoop; name: string; hint: string }[] = [
  { id: "off", name: "No loop", hint: "The short ends where it ends." },
  { id: "cut", name: "Loop on a cut", hint: "The end is chosen to match the start, so the platform's replay runs on without a jolt." },
  { id: "glimpse", name: "Loop with a glimpse", hint: "The first fraction of a second returns at the end under a short dissolve, so the replay lands on a frame already seen." },
];
/** How much of the start a glimpse loop shows again at the end, in seconds. */
export const GLIMPSE_SECONDS = 0.4;
/**
 * A short in Short mode: a named span of the landscape timeline with its own loop, targets and export preset. Its
 * titles are the timeline's titles tagged with its id; its window keys are the clips' own.
 */
export interface Short {
  id: string;
  name: string;
  /** Timeline seconds. */
  from: number;
  to: number;
  loop: ShortLoop;
  targets: ShortTarget[];
  /** The export preset for the short's file (export-presets.ts); the Shorts / Reels file when unset. */
  preset?: string;
  /** The cover frame, in timeline seconds; the first frame when unset. */
  cover?: number | null;
  exported?: { name: string; bytes: number; at: number } | null;
  /**
   * The short's own music, timed from the short's start (so the song moves with the short), independent of the
   * landscape lanes. Absent only in a project saved before 1.91.0: the loader gives such a short a copy of what it
   * heard from the landscape under its span, so nothing already exported changes.
   */
  music?: MusicTrack[];
}
export type EditorMode = "landscape" | "short";
export const newShort = (from: number, to: number, index: number, name?: string): Short => ({ id: newId(), name: name ?? `Short ${index}`, from, to, loop: "off", targets: ["shorts", "reels"] });
/** A saved short made whole: an unknown loop or target dropped, a span that is not a span refused. */
export function normalizeShort(s: Partial<Short> | null | undefined): Short | null {
  if (!s || typeof s !== "object" || typeof s.from !== "number" || typeof s.to !== "number" || !(s.to > s.from)) return null;
  const targets = Array.isArray(s.targets) ? s.targets.filter((t): t is ShortTarget => SHORT_TARGETS.includes(t as ShortTarget)) : [];
  return {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    name: typeof s.name === "string" && s.name.trim() ? s.name : "Short",
    from: Math.max(0, s.from),
    to: s.to,
    loop: SHORT_LOOPS.some((l) => l.id === s.loop) ? (s.loop as ShortLoop) : "off",
    targets: targets.length ? targets : ["shorts", "reels"],
    ...(typeof s.preset === "string" && s.preset ? { preset: s.preset } : {}),
    ...(typeof s.cover === "number" && s.cover >= 0 ? { cover: s.cover } : {}),
    ...(s.exported && typeof s.exported === "object" && typeof s.exported.name === "string" ? { exported: { name: s.exported.name, bytes: Number(s.exported.bytes) || 0, at: Number(s.exported.at) || 0 } } : {}),
    ...(Array.isArray(s.music) ? { music: s.music.map((m) => normalizeMusicTrack(m)).filter((m): m is MusicTrack => !!m) } : {}),
  };
}

/** A saved music track made whole: a track without a file or a span is dropped, the rest defaulted. */
export function normalizeMusicTrack(raw: unknown): MusicTrack | null {
  const m = raw as Partial<MusicTrack> | null;
  if (!m || typeof m !== "object" || typeof m.media !== "string" || !m.media) return null;
  const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
  const inPoint = Math.max(0, num(m.in, 0)), out = num(m.out, NaN);
  if (!(out > inPoint)) return null;
  return {
    id: typeof m.id === "string" && m.id ? m.id : newId(),
    media: m.media,
    lane: Math.min(2, Math.max(0, Math.round(num(m.lane, 0)))),
    start: Math.max(0, num(m.start, 0)),
    in: inPoint,
    out,
    gainDb: num(m.gainDb, 0),
    muted: m.muted === true,
    fadeIn: Math.max(0, num(m.fadeIn, 0)),
    fadeOut: Math.max(0, num(m.fadeOut, 0)),
    keyframes: Array.isArray(m.keyframes) ? m.keyframes.filter((k) => k && typeof k.t === "number" && typeof k.db === "number").map((k) => ({ t: k.t, db: k.db })) : [],
    ...(m.beats && typeof m.beats === "object" && Array.isArray(m.beats.beats) ? { beats: m.beats } : {}),
  };
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

export interface Title {
  id: string;
  kind: TitleKind;
  text: string;
  subtitle?: string;
  /** Timeline start and duration, seconds. */
  start: number;
  duration: number;
  /** For the intro: fade in from black over this many seconds. */
  fade: number;
  /** Where the text sits: top/middle/bottom × left/centre/right. */
  position: TitlePosition;
  /** CSS colours; an empty background means no backing box. */
  color: string;
  background: string;
  /** A preset key (sans, serif, mono, rounded) or any font family name, including fonts installed on this machine. */
  font: string;
  /** Text height as a fraction of the frame height. */
  size: number;
  /** CSS font weight 300–800, italic, and letter spacing in em. */
  weight: number;
  italic: boolean;
  letterSpacing: number;
  shadow: TitleShadow;
  shadowColor: string;
  /** Text alignment inside the block; auto follows the position column. */
  align: TitleAlign;
  /** Box padding, corner radius and border width as multiples of the text size; the border draws even without a background. */
  padding: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  /** How the title comes in over its fade: fading alone, popping up from slightly smaller, or rising a little. Missing: fade. */
  enter?: TitleEnter;
  exit?: TitleExit;
  /** Word by word: when each word appears, seconds after the title's start; unset, the words share the time before the fade evenly. */
  wordAt?: number[];
  /** The colour of words written *like this*. */
  highlight?: string;
  /** false lets the title ignore the project's safe area (the frame's edges still keep their margin). */
  safe?: boolean;
  /** The short this title belongs to (Short mode): shown and exported only with that short; unset, it is the landscape edit's. */
  short?: string;
}
/** intro: a full-screen card on black. title: text over the picture. lowerThird: a small caption in a corner with a box. hook: the big line that opens a short. caption: a short's wrapped caption line, inside the platform's safe area. */
export type TitleKind = "intro" | "title" | "lowerThird" | "hook" | "caption" | "words" | "badge" | "place" | "cta" | "counter";
export const TITLE_KINDS: TitleKind[] = ["intro", "title", "lowerThird", "hook", "caption", "words", "badge", "place", "cta", "counter"];
/** How a title comes in over its fade: the block as one, or (typewriter, wordPop) word by word. */
export type TitleEnter = "fade" | "pop" | "rise" | "slideLeft" | "slideRight" | "slideUp" | "slideDown" | "typewriter" | "blur" | "zoomOut" | "wordPop";
export const TITLE_ENTERS: TitleEnter[] = ["fade", "pop", "rise", "slideLeft", "slideRight", "slideUp", "slideDown", "typewriter", "blur", "zoomOut", "wordPop"];
export const TITLE_ENTER_NAMES: Record<TitleEnter, string> = { fade: "Fade", pop: "Pop", rise: "Rise", slideLeft: "Slide from the left", slideRight: "Slide from the right", slideUp: "Slide up", slideDown: "Slide down", typewriter: "Typewriter", blur: "Blur in", zoomOut: "Zoom out", wordPop: "Word by word" };
/** How a title goes out over its fade; none is a hard cut. */
export type TitleExit = "fade" | "popOut" | "slideOut" | "drop" | "none";
export const TITLE_EXITS: TitleExit[] = ["fade", "popOut", "slideOut", "drop", "none"];
export const TITLE_EXIT_NAMES: Record<TitleExit, string> = { fade: "Fade", popOut: "Pop out", slideOut: "Slide out", drop: "Drop", none: "Cut" };
export type TitleShadow = "none" | "soft" | "hard" | "outline";
export const TITLE_SHADOWS: TitleShadow[] = ["none", "soft", "hard", "outline"];
export type TitleAlign = "auto" | "left" | "center" | "right";
export const TITLE_ALIGNS: TitleAlign[] = ["auto", "left", "center", "right"];
export const TITLE_WEIGHTS = [300, 400, 500, 600, 700, 800];
/** Families that are on nearly every Mac and PC, offered next to the presets and whatever is installed locally. */
export const TITLE_FAMILIES = ["Inter", "Helvetica Neue", "Arial", "Avenir Next", "Futura", "Gill Sans", "Trebuchet MS", "Verdana", "Georgia", "Times New Roman", "Baskerville", "Palatino", "Didot", "Menlo", "Courier New", "Impact", "American Typewriter", "Chalkboard SE"];
/** The CSS font-family for a title: a preset stack, or the family name quoted with a sans fallback. */
export function fontFamilyCss(font: string): string {
  if (font in TITLE_FONTS) return TITLE_FONTS[font as TitleFont];
  const name = font.trim().replace(/["\\]/g, "");
  return name ? `"${name}", ${TITLE_FONTS.sans}` : TITLE_FONTS.sans;
}

export type TitlePosition = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";
export const TITLE_POSITIONS: TitlePosition[] = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
export const TITLE_FONTS = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  rounded: "ui-rounded, 'Avenir Next Rounded', 'Nunito', system-ui, sans-serif",
} as const;
export type TitleFont = keyof typeof TITLE_FONTS;

type TitleStyle = Pick<Title, "position" | "color" | "background" | "font" | "size" | "duration" | "fade" | "weight" | "italic" | "letterSpacing" | "shadow" | "shadowColor" | "align" | "padding" | "radius" | "borderWidth" | "borderColor" | "enter">;
const STYLE_BASE = { font: "sans", weight: 600, italic: false, letterSpacing: 0, shadowColor: "rgba(0,0,0,0.6)", align: "auto" as TitleAlign, padding: 0.4, radius: 0.15, borderWidth: 0, borderColor: "#ffffff", fade: 1, enter: "fade" as TitleEnter };
const TITLE_DEFAULTS: Record<TitleKind, TitleStyle> = {
  intro: { ...STYLE_BASE, position: "mc", color: "#ffffff", background: "", size: 0.07, duration: 4, shadow: "soft" },
  title: { ...STYLE_BASE, position: "mc", color: "#ffffff", background: "", size: 0.06, duration: 5, shadow: "soft" },
  lowerThird: { ...STYLE_BASE, position: "bl", color: "#ffffff", background: "rgba(0,0,0,0.55)", size: 0.04, duration: 5, shadow: "none" },
  // A short's opening line: big, bold, outlined so it reads over any footage, in for the first beats.
  hook: { ...STYLE_BASE, position: "mc", color: "#ffffff", background: "", size: 0.055, duration: 2.5, fade: 0.25, weight: 800, letterSpacing: -0.01, shadow: "outline", shadowColor: "rgba(0,0,0,0.85)", enter: "pop" },
  // A caption line: bold on a dark pill at the foot of the safe area, wrapped to the frame.
  caption: { ...STYLE_BASE, position: "bc", color: "#ffffff", background: "rgba(0,0,0,0.6)", size: 0.038, duration: 3, fade: 0.2, weight: 700, padding: 0.5, radius: 0.6, shadow: "none", enter: "rise" },
  // A caption whose words land one by one, big and outlined in the middle, the way shorts carry speech and punchlines.
  words: { ...STYLE_BASE, position: "mc", color: "#ffffff", background: "", size: 0.05, duration: 3, fade: 0.15, weight: 800, shadow: "outline", shadowColor: "rgba(0,0,0,0.85)", enter: "wordPop" },
  // "Part 3 / 7" in a corner, small, for the whole short.
  badge: { ...STYLE_BASE, position: "tl", color: "#ffffff", background: "rgba(0,0,0,0.55)", size: 0.028, duration: 10, fade: 0.2, weight: 700, padding: 0.5, radius: 0.5, shadow: "none", enter: "fade" },
  // Where and when, low in the frame.
  place: { ...STYLE_BASE, position: "bl", color: "#ffffff", background: "rgba(0,0,0,0.5)", size: 0.034, duration: 4, fade: 0.3, weight: 600, padding: 0.5, radius: 0.3, shadow: "none", enter: "slideLeft" },
  // "Follow for part 2" near the end, sliding up into the safe area.
  cta: { ...STYLE_BASE, position: "bc", color: "#111111", background: "#ffd60a", size: 0.04, duration: 3, fade: 0.25, weight: 800, padding: 0.6, radius: 0.8, shadow: "none", enter: "slideUp" },
  // A number that counts: "120 km/h", "Day 3", big and bare.
  counter: { ...STYLE_BASE, position: "tc", color: "#ffffff", background: "", size: 0.075, duration: 3, fade: 0.2, weight: 800, letterSpacing: -0.02, shadow: "hard", shadowColor: "rgba(0,0,0,0.7)", enter: "zoomOut" },
};

export function newTitle(kind: TitleKind, start: number, text: string, subtitle = ""): Title {
  const d = TITLE_DEFAULTS[kind];
  const { duration, fade, ...style } = d;
  return { id: newId(), kind, text, subtitle, start, duration, fade, ...style };
}

/** Fill in the fields older project files did not have. */
export function normalizeTitle(t: Partial<Title> & { kind: Title["kind"] }): Title {
  const d = TITLE_DEFAULTS[t.kind] ?? TITLE_DEFAULTS.title;
  return {
    id: t.id ?? newId(),
    kind: t.kind,
    text: t.text ?? "",
    subtitle: t.subtitle ?? "",
    start: t.start ?? 0,
    duration: t.duration ?? d.duration,
    fade: typeof t.fade === "number" && t.fade >= 0 ? t.fade : d.fade,
    position: TITLE_POSITIONS.includes(t.position as TitlePosition) ? (t.position as TitlePosition) : d.position,
    color: t.color ?? d.color,
    background: t.background ?? d.background,
    font: typeof t.font === "string" && t.font.trim() ? t.font.trim() : d.font,
    size: t.size ?? d.size,
    weight: typeof t.weight === "number" ? Math.min(800, Math.max(300, Math.round(t.weight / 100) * 100)) : d.weight,
    italic: typeof t.italic === "boolean" ? t.italic : d.italic,
    letterSpacing: typeof t.letterSpacing === "number" ? Math.min(0.5, Math.max(-0.1, t.letterSpacing)) : d.letterSpacing,
    shadow: TITLE_SHADOWS.includes(t.shadow as TitleShadow) ? (t.shadow as TitleShadow) : d.shadow,
    shadowColor: typeof t.shadowColor === "string" && t.shadowColor ? t.shadowColor : d.shadowColor,
    align: TITLE_ALIGNS.includes(t.align as TitleAlign) ? (t.align as TitleAlign) : d.align,
    padding: typeof t.padding === "number" ? Math.min(2, Math.max(0, t.padding)) : d.padding,
    radius: typeof t.radius === "number" ? Math.min(1, Math.max(0, t.radius)) : d.radius,
    borderWidth: typeof t.borderWidth === "number" ? Math.min(0.5, Math.max(0, t.borderWidth)) : d.borderWidth,
    borderColor: typeof t.borderColor === "string" && t.borderColor ? t.borderColor : d.borderColor,
    enter: TITLE_ENTERS.includes(t.enter as TitleEnter) ? (t.enter as TitleEnter) : d.enter,
    ...(TITLE_EXITS.includes(t.exit as TitleExit) && t.exit !== "fade" ? { exit: t.exit as TitleExit } : {}),
    ...(Array.isArray(t.wordAt) && t.wordAt.length ? { wordAt: t.wordAt.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0).map((v) => Math.round(v * 1e3) / 1e3) } : {}),
    ...(typeof t.highlight === "string" && t.highlight ? { highlight: t.highlight } : {}),
    ...(typeof t.short === "string" && t.short ? { short: t.short } : {}),
    ...(t.safe === false ? { safe: false } : {}),
  };
}

/** A CSS colour the canvas will accept: #hex, rgb()/rgba(), or a plain name. */
const COLOR_NAMES = new Set(["white", "black", "red", "green", "blue", "yellow", "orange", "cyan", "magenta", "gray", "grey", "silver", "gold", "navy", "teal", "olive", "maroon", "purple", "pink", "brown", "beige", "ivory", "coral", "salmon", "tomato", "crimson", "lime", "indigo", "violet", "turquoise", "lavender", "khaki", "tan", "wheat"]);
export const isCssColor = (v: unknown): v is string => typeof v === "string" && (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^(rgba?|hsla?)\(/i.test(v) || COLOR_NAMES.has(v.toLowerCase()));

/**
 * The JSON to hand an LLM: what the video contains, what a title can be,
 * and the current titles as worked examples. Only `titles` is read back.
 */
export function titlesTemplate(p: Project): Record<string, unknown> {
  const placed = placeClips(p.clips);
  const fps = Object.values(p.media).find((m) => m.fps)?.fps ?? 30;
  const strip = (t: Title) => {
    const { id, ...rest } = t;
    void id;
    return rest;
  };
  return {
    format: "bench-video-titles/1",
    instructions: [
      "Fill the titles array with the on-screen text for this video, then save this file and import it in the Titles tab of the Bench video editor (Import JSON).",
      "Each title has: kind — intro (a full-screen card on black, usually at 0 s), title (text over the picture), lowerThird (a small caption such as a place name, usually in a corner with a dark box), hook (the big bold line that opens a vertical short, in for its first 2–3 s) or caption (a short's bold caption line on a dark pill, wrapped to the frame and kept inside the platform's safe area); text; subtitle (optional, smaller line under the text); start and duration in seconds; fade in seconds (fade in and out); position — tl tc tr ml mc mr bl bc br meaning top/middle/bottom × left/centre/right; color as #rrggbb; background — empty string for none, rgba(0,0,0,0.55) for a dark box, rgba(255,255,255,0.85) for a light box, or #rrggbb; font — sans, serif, mono, rounded, or any font family name installed on the editing machine (e.g. Avenir Next); size — text height as a fraction of the frame height, 0.02 to 0.16.",
      "Styling, all optional: enter — fade, pop (comes up from slightly smaller) or rise (drifts up a little) over the fade; weight 300–800 (600 default); italic true/false; letterSpacing in em (0 default, up to 0.5); shadow — none, soft, hard or outline, with shadowColor (rgba or #rrggbb); align — auto (follows the position), left, center or right; padding, radius and borderWidth as multiples of the text size (0.4, 0.15 and 0 by default; a border draws even without a background) with borderColor.",
      "Keep every title inside 0 to durationSeconds, and inside the clip it belongs to where that matters (clips lists each recording with its start and end on the timeline). Titles may overlap in time only if they use different positions. Lower thirds for locations typically last 5 to 8 seconds at bl; an intro typically starts at 0 for 4 seconds.",
      "Leave project, options and instructions as they are. Missing fields get sensible defaults and unknown fields are ignored on import.",
    ],
    project: {
      name: p.name,
      durationSeconds: +timelineDuration(p).toFixed(3),
      fps,
      clips: placed.map((c) => ({ file: p.media[c.media]?.name ?? c.media, start: +c.start.toFixed(3), end: +c.end.toFixed(3) })),
    },
    options: {
      kinds: TITLE_KINDS,
      enters: TITLE_ENTERS,
      exits: TITLE_EXITS,
      positions: TITLE_POSITIONS,
      fonts: [...Object.keys(TITLE_FONTS), ...TITLE_FAMILIES, "<any installed family name>"],
      sizeRange: [0.02, 0.16],
      weights: TITLE_WEIGHTS,
      shadows: TITLE_SHADOWS,
      aligns: TITLE_ALIGNS,
      paddingRange: [0, 2],
      radiusRange: [0, 1],
      borderWidthRange: [0, 0.5],
      backgroundPresets: { none: "", dark: "rgba(0,0,0,0.55)", light: "rgba(255,255,255,0.85)" },
    },
    titles: p.titles.length
      ? p.titles.map(strip)
      : [
          { kind: "intro", text: p.name, subtitle: "<date or place, e.g. Tokyo, 9 Oct 2026>", start: 0, duration: 4, fade: 1, position: "mc", color: "#ffffff", background: "", font: "sans", size: 0.07 },
          { kind: "lowerThird", text: "<Place name>", subtitle: "<district, venue or landmark>", start: 12, duration: 6, fade: 1, position: "bl", color: "#ffffff", background: "rgba(0,0,0,0.55)", font: "sans", size: 0.04 },
          { kind: "title", text: "<A short remark shown mid-video>", subtitle: "", start: 40, duration: 5, fade: 1, position: "tc", color: "#ffffff", background: "", font: "sans", size: 0.05 },
        ],
  };
}

/** Read titles back from a filled template, or a bare array. Bad entries are skipped and odd values corrected, each with a note. */
export function parseTitlesImport(text: string, p: Project): { titles: Title[]; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { titles?: unknown }).titles) ? (data as { titles: unknown[] }).titles : null;
  if (!list) throw new Error("Expected a titles array — the shape of the downloaded template.");
  const total = timelineDuration(p);
  const warnings: string[] = [];
  const titles: Title[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  list.forEach((raw, i) => {
    const tag = `#${i + 1}`;
    if (!raw || typeof raw !== "object") return void warnings.push(`${tag}: not an object, skipped`);
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) return void warnings.push(`${tag}: no text, skipped`);
    let kind: TitleKind = "title";
    if (TITLE_KINDS.includes(r.kind as TitleKind)) kind = r.kind as TitleKind;
    else if (r.kind !== undefined) warnings.push(`${tag} "${text}": unknown kind "${String(r.kind)}", used title`);
    let start = Math.max(0, num(r.start) ?? 0);
    let duration = num(r.duration);
    if (duration !== undefined && duration < 0.5) {
      warnings.push(`${tag} "${text}": duration under 0.5 s, raised to 0.5`);
      duration = 0.5;
    }
    if (total > 0 && start >= total) {
      warnings.push(`${tag} "${text}": starts after the end of the video (${start} s), moved to the last ${duration ?? 5} s`);
      start = Math.max(0, total - (duration ?? 5));
    }
    if (total > 0 && duration !== undefined && start + duration > total) duration = Math.max(0.5, total - start);
    const color = isCssColor(r.color) ? r.color : r.color !== undefined ? (warnings.push(`${tag} "${text}": colour "${String(r.color)}" not understood, used white`), undefined) : undefined;
    const background = r.background === "" || isCssColor(r.background) ? (r.background as string) : r.background !== undefined ? (warnings.push(`${tag} "${text}": background "${String(r.background)}" not understood, used none`), "") : undefined;
    const size = num(r.size);
    if (typeof r.position === "string" && !TITLE_POSITIONS.includes(r.position as TitlePosition)) warnings.push(`${tag} "${text}": position "${r.position}" not understood, used the default`);
    if (typeof r.shadow === "string" && !TITLE_SHADOWS.includes(r.shadow as TitleShadow)) warnings.push(`${tag} "${text}": shadow "${r.shadow}" not understood, used the default`);
    if (typeof r.align === "string" && !TITLE_ALIGNS.includes(r.align as TitleAlign)) warnings.push(`${tag} "${text}": align "${r.align}" not understood, used auto`);
    const shadowColor = isCssColor(r.shadowColor) ? r.shadowColor : r.shadowColor !== undefined ? (warnings.push(`${tag} "${text}": shadowColor not understood, used the default`), undefined) : undefined;
    const borderColor = isCssColor(r.borderColor) ? r.borderColor : r.borderColor !== undefined ? (warnings.push(`${tag} "${text}": borderColor not understood, used white`), undefined) : undefined;
    titles.push(
      normalizeTitle({
        kind,
        text,
        subtitle: typeof r.subtitle === "string" ? r.subtitle : "",
        start,
        duration,
        fade: num(r.fade),
        position: typeof r.position === "string" ? (r.position as TitlePosition) : undefined,
        color,
        background,
        font: typeof r.font === "string" ? r.font : undefined,
        size: size !== undefined ? Math.min(0.16, Math.max(0.02, size)) : undefined,
        weight: num(r.weight),
        italic: typeof r.italic === "boolean" ? r.italic : r.italic === "true" ? true : undefined,
        letterSpacing: num(r.letterSpacing),
        shadow: typeof r.shadow === "string" ? (r.shadow as TitleShadow) : undefined,
        shadowColor,
        align: typeof r.align === "string" ? (r.align as TitleAlign) : undefined,
        padding: num(r.padding),
        radius: num(r.radius),
        borderWidth: num(r.borderWidth),
        borderColor,
        enter: typeof r.enter === "string" ? (r.enter as TitleEnter) : undefined,
        exit: typeof r.exit === "string" ? (r.exit as TitleExit) : undefined,
        wordAt: Array.isArray(r.wordAt) ? (r.wordAt.map(num).filter((v): v is number => v !== undefined) as number[]) : undefined,
        highlight: isCssColor(r.highlight) ? r.highlight : undefined,
        safe: r.safe === false ? false : undefined,
      }),
    );
  });
  return { titles, warnings };
}

/* ------------------------------------------------------------------ labels */

/**
 * A label is a picture on the video for a stretch of the timeline: an SVG, a still image or an animated GIF, placed
 * like a title (a position on the 3×3 grid plus an offset), with a width, an opacity, a rotation and the titles'
 * entrances and exits. Its art is either stored in the project (`Project.art`: SVG markup or base64, which is how an
 * LLM hands one over in the template) or a file on disk remembered by its handle (`Project.media`), never copied.
 */
export type LabelArtType = "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export const LABEL_ART_TYPES: LabelArtType[] = ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif"];
/** The most one piece of art stored in the project may weigh, decoded. */
export const MAX_ART_BYTES = 2 * 1024 * 1024;
export interface LabelArt {
  /** What the art is called in the list and in the template ("existing:<name>"). */
  name: string;
  type: LabelArtType;
  /** SVG: the markup itself. Everything else: the file's bytes in base64. */
  data: string;
  /** Filled in once the art has been decoded: its size in pixels and, when animated, how long one pass runs. */
  width?: number;
  height?: number;
  seconds?: number;
}
/** The titles' entrances that move a block as a whole (the word-by-word ones have nothing to act on in a picture). */
export type LabelEnter = Exclude<TitleEnter, "typewriter" | "wordPop">;
export const LABEL_ENTERS: LabelEnter[] = ["fade", "pop", "rise", "slideLeft", "slideRight", "slideUp", "slideDown", "blur", "zoomOut"];
/** An animated picture plays round and round, or once and then holds its last frame. */
export type LabelLoop = "loop" | "once";
export const LABEL_LOOPS: LabelLoop[] = ["loop", "once"];
export interface Label {
  id: string;
  name?: string;
  /** The art: a key of `Project.art`, or the id of a file in `Project.media`. One of the two. */
  art?: string;
  media?: string;
  /** Timeline start and duration, seconds. */
  start: number;
  duration: number;
  /** Seconds the entrance and the exit each take. */
  fade: number;
  /** Where it sits: top/middle/bottom × left/centre/right, then moved by the offsets (fractions of the frame's width and height). */
  position: TitlePosition;
  offsetX: number;
  offsetY: number;
  /** Width as a fraction of the frame's width; the height follows the art's shape. */
  width: number;
  opacity: number;
  /** Degrees, clockwise. */
  rotate: number;
  enter?: LabelEnter;
  exit?: TitleExit;
  /** Animated art only; missing: loop. */
  loop?: LabelLoop;
  /** false lets the label ignore the project's safe area (the frame's edges still keep their margin). */
  safe?: boolean;
  /** The short this label belongs to (Short mode); unset, it is the landscape edit's. */
  short?: string;
}
export const LABEL_WIDTH_RANGE: [number, number] = [0.02, 1];
export const LABEL_OFFSET_RANGE: [number, number] = [-1, 1];
export const MIN_LABEL_SECONDS = 0.2;
export const DEFAULT_LABEL = { duration: 5, fade: 0.4, position: "tr" as TitlePosition, offsetX: 0, offsetY: 0, width: 0.18, opacity: 1, rotate: 0, enter: "fade" as LabelEnter };

export function newLabel(source: { art: string } | { media: string }, start: number, name?: string): Label {
  return { id: newId(), ...(name ? { name } : {}), ...source, start, ...DEFAULT_LABEL };
}

/** A label read from a project file or a template: every field in range, nothing when it has no art or no time. */
export function normalizeLabel(raw: unknown): Label | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Label>;
  const n = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const art = typeof r.art === "string" && r.art ? r.art : undefined;
  const media = !art && typeof r.media === "string" && r.media ? r.media : undefined;
  if (!art && !media) return null;
  const duration = n(r.duration, MIN_LABEL_SECONDS, Infinity, DEFAULT_LABEL.duration);
  const d = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    id: typeof r.id === "string" && r.id ? r.id : newId(),
    ...(typeof r.name === "string" && r.name.trim() ? { name: r.name.slice(0, 80) } : {}),
    ...(art ? { art } : { media: media! }),
    start: n(r.start, 0, Infinity, 0),
    duration,
    fade: n(r.fade, 0, duration / 2, Math.min(DEFAULT_LABEL.fade, duration / 2)),
    position: TITLE_POSITIONS.includes(r.position as TitlePosition) ? (r.position as TitlePosition) : DEFAULT_LABEL.position,
    offsetX: d(n(r.offsetX, LABEL_OFFSET_RANGE[0], LABEL_OFFSET_RANGE[1], 0)),
    offsetY: d(n(r.offsetY, LABEL_OFFSET_RANGE[0], LABEL_OFFSET_RANGE[1], 0)),
    width: d(n(r.width, LABEL_WIDTH_RANGE[0], LABEL_WIDTH_RANGE[1], DEFAULT_LABEL.width)),
    opacity: n(r.opacity, 0, 1, 1),
    rotate: n(r.rotate, -180, 180, 0),
    enter: LABEL_ENTERS.includes(r.enter as LabelEnter) ? (r.enter as LabelEnter) : "fade",
    ...(TITLE_EXITS.includes(r.exit as TitleExit) && r.exit !== "fade" ? { exit: r.exit as TitleExit } : {}),
    ...(r.loop === "once" ? { loop: "once" as LabelLoop } : {}),
    ...(r.safe === false ? { safe: false } : {}),
    ...(typeof r.short === "string" && r.short ? { short: r.short } : {}),
  };
}

export function normalizeArt(raw: unknown): LabelArt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LabelArt>;
  if (!LABEL_ART_TYPES.includes(r.type as LabelArtType) || typeof r.data !== "string" || !r.data) return null;
  const size = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const width = size(r.width), height = size(r.height), seconds = size(r.seconds);
  return { name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : "art", type: r.type as LabelArtType, data: r.data, ...(width && height ? { width, height } : {}), ...(seconds ? { seconds } : {}) };
}

/** How many bytes a piece of stored art weighs, decoded. */
export const artBytes = (a: Pick<LabelArt, "type" | "data">) => (a.type === "image/svg+xml" ? a.data.length : Math.floor((a.data.length * 3) / 4));

const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
/** The key a piece of art is stored under: the same picture always gets the same key, so it is stored once. */
export const artKey = (type: LabelArtType, data: string) => `a${fnv(type + data)}${data.length.toString(36)}`;

/** Where a label's picture comes from, as one string: the key the loaded pictures are held under. */
export const labelSource = (l: Pick<Label, "art" | "media">) => (l.art ? `art:${l.art}` : l.media ? `media:${l.media}` : "");

/** What a label is called: its own name, else its art's, else its file's. */
export function labelName(p: Pick<Project, "art" | "media">, l: Label): string {
  return l.name || (l.art ? p.art?.[l.art]?.name : l.media ? p.media[l.media]?.name : "") || "Label";
}

/** The project with its labels set: art no label uses any more is dropped, and empty lists leave no key behind. */
export function withLabels(p: Project, labels: Label[], art: Record<string, LabelArt> | undefined = p.art): Project {
  const { labels: was, art: wasArt, ...rest } = p;
  void was;
  void wasArt;
  const used = new Set(labels.map((l) => l.art).filter(Boolean));
  const kept = Object.fromEntries(Object.entries(art ?? {}).filter(([k]) => used.has(k)));
  // A file only a label used goes with its last label.
  const stale = (p.labels ?? []).map((l) => l.media).filter((id): id is string => !!id && !labels.some((l) => l.media === id));
  const media = stale.length ? Object.fromEntries(Object.entries(p.media).filter(([id]) => !stale.includes(id))) : p.media;
  return { ...rest, media, ...(labels.length ? { labels } : {}), ...(Object.keys(kept).length ? { art: kept } : {}) } as Project;
}

/** A name no other piece of art in the project carries, so "existing:<name>" in a template points at one picture. */
export function uniqueArtName(taken: Iterable<string>, wanted: string): string {
  const names = new Set([...taken].map((n) => n.toLowerCase()));
  const base = wanted.trim().slice(0, 72) || "art";
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * Where a label lands on a frame of w × h, given its art's shape (width over height): placed on the grid inside the
 * frame's margin and the safe area like a title, then moved by its offsets.
 */
export function labelBox(l: Pick<Label, "position" | "offsetX" | "offsetY" | "width" | "safe">, aspect: number, w: number, h: number, safe?: SafeArea | null): LabelBox {
  const bw = w * l.width,
    bh = bw / (aspect > 0 ? aspect : 1);
  const pad = w * 0.04;
  const s = l.safe === false ? null : safe;
  const inL = Math.max(pad, w * (s?.left ?? 0)),
    inR = Math.max(pad, w * (s?.right ?? 0)),
    inT = Math.max(pad, h * (s?.top ?? 0)),
    inB = Math.max(pad, h * (s?.bottom ?? 0));
  const row = l.position[0],
    col = l.position[1];
  const x = col === "l" ? inL : col === "r" ? w - inR - bw : inL + (w - inL - inR - bw) / 2;
  const y = row === "t" ? inT : row === "b" ? h - inB - bh : inT + (h - inT - inB - bh) / 2;
  return { x: x + l.offsetX * w, y: y + l.offsetY * h, w: bw, h: bh };
}

/** How far a title or a label is through its entrance and its exit at t (1 = fully in), or null when it is not on. */
export function overlayPhase(o: { start: number; duration: number; fade: number; exit?: TitleExit }, t: number): { local: number; enter: number; exit: number } | null {
  if (t < o.start || t > o.start + o.duration) return null;
  const local = t - o.start;
  const enter = o.fade > 0 ? Math.min(1, local / o.fade) : 1;
  // The exit over the last fade's worth; "none" is a hard cut at the end.
  const exit = o.exit === "none" ? 1 : o.fade > 0 ? Math.min(1, (o.start + o.duration - t) / o.fade) : 1;
  return { local, enter, exit };
}

/**
 * Which frame of an animated picture shows `local` seconds after its label starts. `ends` is when each frame ends,
 * in seconds from the first frame; looping wraps round, once holds the last frame.
 */
export function animationFrameAt(ends: number[], local: number, loop: LabelLoop = "loop"): number {
  const n = ends.length,
    total = ends[n - 1] ?? 0;
  if (n < 2 || !(total > 0)) return 0;
  if (loop === "once" && local >= total) return n - 1;
  const at = ((local % total) + total) % total;
  let lo = 0,
    hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at < ends[mid] - 1e-9) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The labels that play between two instants, moved to start from zero and cut to the span. */
export function labelsBetween(labels: Label[] | undefined, from: number, to: number): Label[] {
  return (labels ?? [])
    .filter((l) => l.start < to && l.start + l.duration > from)
    .map((l) => {
      const start = Math.max(0, l.start - from);
      return { ...l, start, duration: Math.max(MIN_LABEL_SECONDS, Math.min(to - from, l.start + l.duration - from) - start) };
    });
}

export interface Watermark {
  media: string | null;
  corner: "tl" | "tr" | "bl" | "br";
  /** Width as a fraction of the frame. */
  size: number;
  opacity: number;
  margin: number;
}

/**
 * How the camera sound and the music are balanced. The mode sets what new clips and music start at; the export
 * panel shows the levels and can set every clip and track to them. A music video keeps the camera sound well under
 * the music, where it adds presence without masking it; footage keeps its own sound in front with the music under it.
 */
export type SoundMode = "music-video" | "footage";
export const SOUND_MODES: SoundMode[] = ["music-video", "footage"];
export interface SoundLevels {
  /** Gain of the clips' own sound, dB. */
  camera: number;
  /** Gain of the music tracks, dB. */
  music: number;
}
export const SOUND_LEVELS: Record<SoundMode, SoundLevels> = { "music-video": { camera: -22, music: 0 }, footage: { camera: -12, music: -12 } };
export const SOUND_LABELS: Record<SoundMode, string> = { "music-video": "Music video", footage: "Footage with music under it" };
export const soundLevels = (p: Pick<Project, "sound">): SoundLevels => SOUND_LEVELS[p.sound ?? "footage"];

/** Every clip's sound and every music track set to the mode's levels; mutes, fades and keyframes stay. */
export function applySoundLevels(p: Project): Project {
  const { camera, music } = soundLevels(p);
  return { ...p, clips: p.clips.map((c) => (c.gainDb === camera ? c : { ...c, gainDb: camera })), music: p.music.map((m) => (m.gainDb === music ? m : { ...m, gainDb: music })) };
}

/** Which clips and tracks sit at the mode's levels, for the export panel's summary. */
export function soundState(p: Project): { clipsAt: number; clipsOff: number; clipsOther: number; musicAt: number; musicOff: number; musicOther: number } {
  const { camera, music } = soundLevels(p);
  const out = { clipsAt: 0, clipsOff: 0, clipsOther: 0, musicAt: 0, musicOff: 0, musicOther: 0 };
  for (const c of p.clips) {
    if (c.muted || c.gainDb <= -60) out.clipsOff++;
    else if (c.gainDb === camera) out.clipsAt++;
    else out.clipsOther++;
  }
  for (const m of p.music) {
    if (m.muted || m.gainDb <= -60) out.musicOff++;
    else if (m.gainDb === music) out.musicAt++;
    else out.musicOther++;
  }
  return out;
}

export interface ExportSettings {
  codec: "hevc" | "avc";
  /** Target video bitrate, Mbps. */
  bitrateMbps: number;
  /** Encoder quality/speed hint. */
  preset: "quality" | "balanced" | "fast";
  audioBitrateKbps: number;
  /** "source" keeps the first clip's resolution; otherwise a height to scale to — the short side for a vertical or square frame (1080 is 1080×1920 at 9:16). */
  resolution: "source" | number;
  /** The frame's shape; missing means the recording's own. */
  frame?: Frame;
  /** Whether untouched spans may be stream-copied. */
  smartCopy: boolean;
  /** Export only this part of the timeline (seconds); null means all of it. */
  range: { from: number; to: number } | null;
  /** What the file says about itself: the iTunes-style tags written into the MP4. */
  tags: ExportTags;
  /** Hold LED lights (traffic lights, brake lights, signs) at their brightest over the last 2 or 3 frames so they stop blinking. */
  steadyLights: SteadyLights;
  /** What the doctor does to the finished file: a full scan (every packet, the sound, the picture at every cut), a quick index check, or nothing. */
  check: "full" | "quick" | "off";
  /** The editor's checklist before an export: shown, or skipped. */
  review: "on" | "off";
}

export type SteadyLights = "off" | "light" | "strong";
/** How many frames each setting looks back over (the current one included). */
export const STEADY_FRAMES: Record<SteadyLights, 0 | 2 | 3> = { off: 0, light: 2, strong: 3 };

/**
 * Tags written into the MP4's metadata (the `ilst` atoms players, libraries
 * and ffprobe read), the same ones `ffmpeg -metadata` writes. "Music video"
 * also sets the media kind atom (`stik` = 6) that ffmpeg writes for
 * `-metadata media_type=6`.
 */
export interface ExportTags {
  kind: "music-video" | "video";
  /** Empty: the project name. */
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  comment: string;
}
export const DEFAULT_TAGS: ExportTags = { kind: "music-video", title: "", artist: "", album: "", genre: "Music", year: "", comment: "" };

/** The metadata object for the MP4 writer (mediabunny's MetadataTags): only the fields that are filled in, plus the encoder name and the media kind. */
export function exportTags(p: Project, encoder: string): { title: string; artist?: string; albumArtist?: string; album?: string; genre?: string; comment?: string; raw: Record<string, string | Uint8Array> } {
  const t = { ...DEFAULT_TAGS, ...p.export.tags };
  const s = (v: string) => (v.trim() ? v.trim() : undefined);
  const raw: Record<string, string | Uint8Array> = { "©too": encoder };
  if (s(t.year)) raw["©day"] = s(t.year)!;
  if (t.kind === "music-video") raw.stik = new Uint8Array([6]);
  const out: ReturnType<typeof exportTags> = { title: s(t.title) ?? p.name, raw };
  if (s(t.artist)) {
    out.artist = s(t.artist);
    out.albumArtist = s(t.artist);
  }
  if (s(t.album)) out.album = s(t.album);
  if (s(t.genre)) out.genre = s(t.genre);
  if (s(t.comment)) out.comment = s(t.comment);
  return out;
}

export type TransitionKind = "dissolve" | "dipBlack" | "dipWhite" | "zoom" | "blur" | "wipe" | "push";
export interface Transition {
  kind: TransitionKind;
  /** Seconds, centred on the cut. */
  duration: number;
}
/** The project's choice for new transitions (the last one used). */
export type TransitionSettings = Transition;
/** What a new cut gets: a 2 s cross dissolve, centred on the cut. */
export const DEFAULT_TRANSITION: Transition = { kind: "dissolve", duration: 2 };
/** Transitions, in the order the menu shows them. */
export const TRANSITIONS: { kind: TransitionKind; name: string; hint: string }[] = [
  { kind: "dissolve", name: "Cross dissolve", hint: "A soft blend — the classic for continuous footage." },
  { kind: "dipBlack", name: "Dip to black", hint: "Pauses, scene changes and jumps in time." },
  { kind: "dipWhite", name: "Flash to white", hint: "Bright moments: stepping into daylight, turning into the sun." },
  { kind: "zoom", name: "Zoom through", hint: "The shot accelerates into the cut; the next one arrives close and settles." },
  { kind: "blur", name: "Speed blur", hint: "A blur washes over the cut and clears on the new shot." },
  { kind: "wipe", name: "Soft wipe", hint: "The new shot sweeps in from the left behind a soft edge." },
  { kind: "push", name: "Push", hint: "The next clip slides in from the right and pushes the old one out." },
];

export interface TransitionWindow {
  kind: TransitionKind;
  outgoing: PlacedClip;
  incoming: PlacedClip;
  cut: number;
  start: number;
  end: number;
  /** The seconds asked for, and how the window could be fitted to the footage around the cut. */
  want: number;
  fit: "full" | "shifted" | "shortened" | "none";
  /** Why it is not simply centred, for the panel and the marker. */
  note?: string;
}

/**
 * One window per cut that carries a transition. A dissolve centred on the cut shows the outgoing clip past its end
 * and the incoming clip before its start, so each half needs spare footage beyond that clip's edge: where a side
 * has none (a recording's first frame, a clip trimmed to its last) the window slides onto the other side, and when
 * both are tight it shrinks — never a frozen frame. A window never covers more than half of either clip, which keeps
 * neighbouring windows apart. Pass the project's media so the footage beyond each edge is known.
 */
/** Seconds at each end of a recording that transitions and intro scenes never use, on top of the footage they need. */
export const HANDLE_MARGIN = 1;

export function transitionWindows(placed: PlacedClip[], media?: Record<string, MediaRef>): TransitionWindow[] {
  const out: TransitionWindow[] = [];
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1], b = placed[i], tr = b.transitionIn;
    if (!tr || !(tr.duration > 0) || b.joinedToPrevious) continue;
    const want = tr.duration;
    const la = a.end - a.start, lb = b.end - b.start, sa = clipSpeed(a), sb = clipSpeed(b);
    // A title card's last frame is held under the transition out of the intro, so its side never runs short.
    const ma = a.introRole === "card" ? undefined : media?.[a.media]?.duration, mb = media?.[b.media]?.duration;
    // After the cut the outgoing clip must supply footage past its end; before it the incoming clip, before its start.
    // (A recording's first and last HANDLE_MARGIN seconds are kept clear as well.)
    const roomAfter = Math.max(0, Math.min(lb / 2, ma !== undefined ? (ma - a.out - HANDLE_MARGIN) / sa : Infinity));
    const roomBefore = Math.max(0, Math.min(la / 2, mb !== undefined ? (b.in - HANDLE_MARGIN) / sb : Infinity));
    let before = Math.min(want / 2, roomBefore), after = Math.min(want / 2, roomAfter);
    let rest = want - before - after;
    if (rest > 1e-9) {
      const more = Math.min(rest, roomBefore - before);
      before += more;
      rest -= more;
      const moreAfter = Math.min(rest, roomAfter - after);
      after += moreAfter;
      rest -= moreAfter;
    }
    const d = before + after;
    const name = TRANSITIONS.find((t) => t.kind === tr.kind)?.name.toLowerCase() ?? tr.kind;
    if (d < 0.2) {
      out.push({ kind: tr.kind, outgoing: a, incoming: b, cut: b.start, start: b.start, end: b.start, want, fit: "none", note: `No spare footage on either side of this cut, so the ${name} cannot run here: it plays as a plain cut. Make room trims the clips' own ends to make it — each side gives half the transition plus the ${HANDLE_MARGIN} s margin where the clip sits at its recording's end — or trim them away from their recordings' ends by hand.` });
      continue;
    }
    const fit = rest > 1e-6 ? "shortened" : Math.abs(before - after) > 1e-6 ? "shifted" : "full";
    const note =
      fit === "shortened"
        ? `Only ${d.toFixed(1)} s of spare footage around this cut, so the ${name} is ${d.toFixed(1)} s here instead of ${want} s; Make room trims the clips' own ends for the rest.`
        : fit === "shifted"
          ? `The ${name} runs ${after > before ? "mostly after" : "mostly before"} the cut, because the clip ${after > before ? "after it has too little footage before its start" : "before it has too little footage after its end"}; nothing freezes.`
          : undefined;
    out.push({ kind: tr.kind, outgoing: a, incoming: b, cut: b.start, start: b.start - before, end: b.start + after, want, fit, ...(note ? { note } : {}) });
  }
  return out;
}

/**
 * Room for a cut's transition from the clips' own footage, as an overlap would take it in any editor: where a side
 * has too little spare footage beyond its edge, the outgoing clip gives up its end and the incoming clip its start —
 * half the transition plus the margin where the clip sits at its recording's end — and that footage becomes the
 * handle the transition plays; the timeline shortens by what was trimmed. Each clip keeps at least the transition's
 * length (a second at the least); a side that cannot give enough gives what it can. Nothing changes when the
 * handles are already there.
 */
export function makeRoomForTransition(clips: Clip[], incomingId: string, media?: Record<string, MediaRef>): { clips: Clip[]; trimmedOut: number; trimmedIn: number } {
  const none = { clips, trimmedOut: 0, trimmedIn: 0 };
  const placed = placeClips(clips);
  const i = placed.findIndex((c) => c.id === incomingId);
  if (i < 1) return none;
  const a = placed[i - 1], b = placed[i], tr = b.transitionIn;
  if (!tr || !(tr.duration > 0) || b.joinedToPrevious) return none;
  const want = tr.duration, sa = clipSpeed(a), sb = clipSpeed(b);
  const keep = Math.max(1, want);
  const ma = a.introRole === "card" ? undefined : media?.[a.media]?.duration, mb = media?.[b.media]?.duration;
  let trimmedOut = 0, trimmedIn = 0;
  if (ma !== undefined) {
    // Timeline seconds of handle the outgoing side has (negative inside the margin), and what it is short of.
    const spare = (ma - a.out - HANDLE_MARGIN) / sa;
    const short = Math.max(0, want / 2 - spare);
    trimmedOut = Math.min(short, Math.max(0, a.end - a.start - keep));
  }
  if (mb !== undefined) {
    const spare = (b.in - HANDLE_MARGIN) / sb;
    const short = Math.max(0, want / 2 - spare);
    trimmedIn = Math.min(short, Math.max(0, b.end - b.start - keep));
  }
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  trimmedOut = round(trimmedOut);
  trimmedIn = round(trimmedIn);
  if (trimmedOut < 1e-6 && trimmedIn < 1e-6) return none;
  return {
    clips: clips.map((c) => (c.id === a.id && trimmedOut > 0 ? { ...c, out: round(c.out - trimmedOut * sa) } : c.id === b.id && trimmedIn > 0 ? { ...c, in: round(c.in + trimmedIn * sb) } : c)),
    trimmedOut,
    trimmedIn,
  };
}

/** Room made at every cut that carries a transition, in order; the seconds trimmed in all. */
export function makeRoomForAll(clips: Clip[], media?: Record<string, MediaRef>): { clips: Clip[]; trimmed: number; cuts: number } {
  let out = clips, trimmed = 0, cuts = 0;
  for (const c of clips) {
    if (!c.transitionIn || c.joinedToPrevious) continue;
    const r = makeRoomForTransition(out, c.id, media);
    if (r.trimmedOut + r.trimmedIn > 0) {
      out = r.clips;
      trimmed += r.trimmedOut + r.trimmedIn;
      cuts++;
    }
  }
  return { clips: out, trimmed: Math.round(trimmed * 1e4) / 1e4, cuts };
}

/**
 * Set (or with null, remove) the transition on the cut leading into a clip.
 * The first clip has no cut before it. Putting a transition on a joined cut
 * makes the cut visible again.
 */
export function setTransition(clips: Clip[], incomingId: string, tr: Transition | null): Clip[] {
  return clips.map((c, i) => {
    if (c.id !== incomingId) return c;
    const { transitionIn, joinedToPrevious, ...rest } = c;
    void transitionIn;
    if (tr && i > 0) return { ...rest, transitionIn: { ...tr } };
    return joinedToPrevious ? { ...rest, joinedToPrevious } : rest;
  });
}

/** Stamp one transition on every visible cut (null clears them all); joined cuts stay hidden. */
export function applyTransitionToAll(clips: Clip[], tr: Transition | null): Clip[] {
  return clips.map((c, i) => {
    if (c.joinedToPrevious) return c;
    const { transitionIn, ...rest } = c;
    void transitionIn;
    return tr && i > 0 ? { ...rest, transitionIn: { ...tr } } : rest;
  });
}

/* ---------------------------------------------------------- merging clips */

/** Whether b picks up exactly where a leaves off in the same recording. */
export const isContiguous = (a: Clip, b: Clip) => a.media === b.media && Math.abs(b.in - a.out) < 0.002 && clipSpeed(a) === clipSpeed(b);

/**
 * What "merge with next" would do for a clip: "merge" rejoins two halves of
 * one recording into a single clip; "join" hides the cut to a different (or
 * non-adjacent) piece of footage; null when there is no next clip.
 */
export function canMergeWithNext(clips: Clip[], id: string): "merge" | "join" | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0 || i + 1 >= clips.length) return null;
  return isContiguous(clips[i], clips[i + 1]) ? "merge" : "join";
}

/** The keys a joined run shares, so nothing changes at the hidden cut. */
const SHARED_KEYS = ["grade", "transform", "reframe", "obscure", "gainDb", "muted", "speed"] as const;
const shared = (from: Clip): Pick<Clip, (typeof SHARED_KEYS)[number]> => ({ obscure: from.obscure?.map((a) => ({ ...a })), grade: { ...from.grade }, transform: { ...from.transform, crop: { ...from.transform.crop } }, reframe: from.reframe ? { keys: from.reframe.keys.map((k) => ({ ...k })) } : undefined, gainDb: from.gainDb, muted: from.muted, speed: clipSpeed(from) });

/**
 * Merge a clip with the one after it. Two halves of the same recording become
 * one clip again (the first keeps its settings and transition). Anything else
 * is joined: the second clip stays its own piece of footage but the cut is
 * hidden — no marker, no transition — and it takes the first clip's grade,
 * crop and audio so the seam is invisible.
 */
export function mergeWithNext(clips: Clip[], id: string): Clip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0 || i + 1 >= clips.length) return clips;
  const a = clips[i], b = clips[i + 1];
  if (isContiguous(a, b)) return clips.flatMap((c, k) => (k === i ? [{ ...a, out: b.out }] : k === i + 1 ? [] : [c]));
  const { transitionIn, ...rest } = b;
  void transitionIn;
  return clips.map((c, k) => (k === i + 1 ? { ...rest, ...shared(a), joinedToPrevious: true } : c));
}

/** Make the cut before a clip visible again. */
export function unjoin(clips: Clip[], id: string): Clip[] {
  return clips.map((c) => {
    if (c.id !== id || !c.joinedToPrevious) return c;
    const { joinedToPrevious, ...rest } = c;
    void joinedToPrevious;
    return rest;
  });
}

/** Ids of the joined run a clip belongs to (just itself when it stands alone), in timeline order. */
export function groupOf(clips: Clip[], id: string): string[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return [];
  let from = i, to = i;
  while (from > 0 && clips[from].joinedToPrevious) from--;
  while (to + 1 < clips.length && clips[to + 1].joinedToPrevious) to++;
  return clips.slice(from, to + 1).map((c) => c.id);
}

/** Patch one clip; grade, crop and audio changes also go to the rest of its joined run. */
export function updateClip(clips: Clip[], id: string, patch: Partial<Clip>): Clip[] {
  const run = new Set(groupOf(clips, id));
  const sharedPatch: Partial<Clip> = {};
  for (const k of SHARED_KEYS) if (k in patch) (sharedPatch as Record<string, unknown>)[k] = patch[k];
  const spread = Object.keys(sharedPatch).length > 0;
  return clips.map((c) => (c.id === id ? { ...c, ...patch } : spread && run.has(c.id) ? { ...c, ...sharedPatch } : c));
}

/** Timeline instants of the cuts that show: every clip start after the first, except joined ones. */
export function visibleCuts(placed: PlacedClip[]): number[] {
  return placed.filter((c, i) => i > 0 && !c.joinedToPrevious).map((c) => c.start);
}

/** Swap a clip with its neighbour; cuts around the moved clips become visible, since the footage no longer continues. */
export function moveClip(clips: Clip[], id: string, dir: -1 | 1): Clip[] {
  const i = clips.findIndex((c) => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= clips.length) return clips;
  const out = moveItem(clips, id, dir);
  const lo = Math.min(i, j), hi = Math.max(i, j) + 1;
  return out.map((c, k) => (k >= lo && k <= hi ? unjoin([c], c.id)[0] : c));
}

/** Move a clip to just before `beforeId` (or to the end with null); cuts whose neighbours change are shown again. */
export function reorderClip(clips: Clip[], id: string, beforeId: string | null): Clip[] {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0 || beforeId === id) return clips;
  const rest = clips.filter((c) => c.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((c) => c.id === beforeId);
  if (at < 0) return clips;
  const out = [...rest.slice(0, at), clips[i], ...rest.slice(at)];
  if (out.every((c, k) => c.id === clips[k].id)) return clips;
  const prevBefore = new Map(clips.map((c, k) => [c.id, clips[k - 1]?.id ?? null]));
  return out.map((c, k) => (c.joinedToPrevious && prevBefore.get(c.id) !== (out[k - 1]?.id ?? null) ? unjoin([c], c.id)[0] : c));
}

/**
 * Add a transition at a timeline instant: on the cut there if one is within
 * a frame or so, otherwise by splitting the clip under the playhead first.
 * Returns null when there is nothing to cut (too close to the ends).
 */
export function addTransitionAt(clips: Clip[], t: number, tr: Transition, snap = 0.05): { clips: Clip[]; incomingId: string } | null {
  const placed = placeClips(clips);
  const atCut = placed.find((c, i) => i > 0 && Math.abs(c.start - t) <= snap);
  if (atCut) return { clips: setTransition(clips, atCut.id, tr), incomingId: atCut.id };
  const under = placed.find((c) => t > c.start && t < c.end);
  if (!under || t - under.start < 0.2 || under.end - t < 0.2) return null;
  const split = splitClip(clips, under.id, t);
  const second = split[split.findIndex((c) => c.id === under.id) + 1];
  if (!second || second.media !== under.media) return null;
  return { clips: setTransition(split, second.id, tr), incomingId: second.id };
}

/** The transition in progress at a timeline instant, with 0 → 1 progress across its window. */
export function transitionAt(windows: TransitionWindow[], t: number): { window: TransitionWindow; progress: number } | null {
  for (const w of windows) if (t >= w.start && t < w.end) return { window: w, progress: (t - w.start) / (w.end - w.start) };
  return null;
}

/** Stack titles that overlap in time onto separate timeline lanes (first fit, in start order). */
export function titleLanes(titles: Pick<Title, "id" | "start" | "duration">[]): { lanes: Record<string, number>; count: number } {
  const ends: number[] = [];
  const lanes: Record<string, number> = {};
  for (const t of [...titles].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))) {
    let lane = ends.findIndex((e) => e <= t.start + 1e-6);
    if (lane < 0) {
      lane = ends.length;
      ends.push(0);
    }
    ends[lane] = t.start + t.duration;
    lanes[t.id] = lane;
  }
  return { lanes, count: Math.max(1, ends.length) };
}

export type ProxyHeight = 1080 | 720 | 360 | 0;
export interface PreviewSettings {
  /** Proxy size for preview; 0 previews the full-resolution source. */
  proxyHeight: ProxyHeight;
}
/** Off by default: the preview plays the originals until a proxy size is chosen. */
export const DEFAULT_PREVIEW: PreviewSettings = { proxyHeight: 0 };

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  media: Record<string, MediaRef>;
  clips: Clip[];
  music: MusicTrack[];
  titles: Title[];
  watermark: Watermark;
  export: ExportSettings;
  preview: PreviewSettings;
  transition: TransitionSettings;
  intro: IntroSettings;
  /** The balance of camera sound and music; projects from before it was recorded were mixed as "footage". */
  sound?: SoundMode;
  /** A .cube the user loaded (expects the camera's log in, Rec.709 out), applied by clips whose lut is "custom". */
  customLut?: { name: string; cube: string } | null;
  /** Proxy state per media id: whether a proxy exists (and which file). */
  proxies: Record<string, { ready: boolean; file?: string }>;
  /** Where the car stood still, from the last scan (see stops.ts); null until one has run. */
  stops?: StopScan | null;
  /** Remembered folders outside the project folder, by key: their names, for the record. */
  folders?: Record<string, string>;
  /** How a vertical, square or portrait frame is filled; null or missing: the window fills it. */
  layout?: Layout | null;
  /** The part of the frame a platform leaves visible, for placing titles; null or missing: all of it. */
  safeArea?: SafeArea | null;
  /** Short mode: the editor shows one short at a time, in the phone's shape. */
  mode?: EditorMode;
  /** The shorts cut from this timeline (Short mode). */
  shorts?: Short[];
  /** The song library's preferences by media id (likes, in the shuffle or not); a song without an entry takes the defaults. */
  songs?: Record<string, SongPrefs>;
  /** How "Shuffle & fill" lays the songs out; missing: the defaults. */
  fill?: FillSettings;
  /** Parts of the video mixed their own way: the camera's sound and the music each at a level of the region's (see SoundRegion). */
  regions?: SoundRegion[];
  /** Parts of the video pushed into a point of the picture (see Zoom). */
  zooms?: Zoom[];
  /** Pictures on the video: SVGs, images and animated GIFs with a place, a time and transitions (see Label). */
  labels?: Label[];
  /** The art stored in the project for its labels, by key (see LabelArt). */
  art?: Record<string, LabelArt>;
}

/** A readable location for a media file. */
const folderName = (p: Project, where: MediaWhere) => (where.folder === "project" ? "project folder" : (p.folders?.[where.folder] ?? "a remembered folder"));
export function describeWhere(p: Project, m: MediaRef): string | null {
  if (!m.where) return null;
  return `${folderName(p, m.where)}/${m.where.path}`;
}

/** A few names in full and the rest as a count, so a list of a hundred recordings stays one line: "a, b, c and 97 more". */
export function nameSome(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * Where some recordings were last seen, for the missing-files notice: every path when there are a few ("at
 * project folder/a.MP4, project folder/b.MP4"), otherwise the folders with how many each held ("in project folder (97),
 * SD card (2)"). Null when none of them has a known place.
 */
export function whereSummary(p: Project, media: MediaRef[], max = 3): string | null {
  const placed = media.filter((m) => m.where);
  if (!placed.length) return null;
  if (placed.length <= max) return `at ${placed.map((m) => describeWhere(p, m)).join(", ")}`;
  const counts = new Map<string, number>();
  for (const m of placed) {
    const f = folderName(p, m.where as MediaWhere);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return `in ${[...counts].map(([f, n]) => `${f} (${n})`).join(", ")}`;
}

export const DEFAULT_EXPORT: ExportSettings = { codec: "hevc", bitrateMbps: 120, preset: "balanced", audioBitrateKbps: 320, resolution: "source", frame: "source", smartCopy: true, range: null, tags: { ...DEFAULT_TAGS }, steadyLights: "off", check: "full", review: "on" };

/** The part of the timeline an export covers: the chosen range clamped to the timeline, or null for all of it (also when the range is empty or backwards). */
export function exportRange(p: Project): { from: number; to: number } | null {
  const r = p.export.range;
  if (!r) return null;
  const total = timelineDuration(p);
  const from = Math.max(0, Math.min(total, r.from)), to = Math.max(0, Math.min(total, r.to));
  if (!(to - from > 0.05)) return null;
  if (from <= 0 && to >= total) return null;
  return { from, to };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function newProject(name = "Untitled project"): Project {
  const now = Date.now();
  return { version: 1, id: newId(), name, createdAt: now, updatedAt: now, media: {}, clips: [], music: [], titles: [], watermark: { media: null, corner: "br", size: 0.08, opacity: 0.85, margin: 0.03 }, export: { ...DEFAULT_EXPORT }, preview: { ...DEFAULT_PREVIEW }, transition: { ...DEFAULT_TRANSITION }, intro: { ...DEFAULT_INTRO, card: { ...DEFAULT_INTRO.card } }, sound: "music-video", proxies: {}, stops: null };
}

/* ---------------------------------------------------------- timeline */

export interface PlacedClip extends Clip {
  /** Timeline position, seconds. */
  start: number;
  end: number;
  index: number;
}

/** How long a clip lasts on the timeline: its trimmed footage divided by its speed. */
export const clipLength = (c: Clip) => Math.max(0, (c.out - c.in) / clipSpeed(c));

/** Clips laid end to end, in order — continuous footage with no gaps. */
export function placeClips(clips: Clip[]): PlacedClip[] {
  let t = 0;
  return clips.map((c, index) => {
    const start = t;
    t += clipLength(c);
    return { ...c, start, end: t, index };
  });
}

export const timelineDuration = (p: Project) => placeClips(p.clips).reduce((m, c) => Math.max(m, c.end), 0);

/** Which clip is under a timeline instant, and the matching source time. */
export function clipAt(clips: Clip[], t: number): { clip: PlacedClip; sourceTime: number } | null {
  for (const c of placeClips(clips)) if (t >= c.start && (t < c.end || (t === c.end && c.end === timelineDuration({ clips } as Project)))) return { clip: c, sourceTime: Math.min(c.out, sourceTimeAt(c, t)) };
  return null;
}

/** Split a clip at a timeline instant into two clips sharing its settings. */
export function splitClip(clips: Clip[], clipId: string, t: number): Clip[] {
  const placed = placeClips(clips);
  const p = placed.find((c) => c.id === clipId);
  if (!p || t <= p.start + 0.01 || t >= p.end - 0.01) return clips;
  const cut = sourceTimeAt(p, t);
  const a: Clip = { ...p, out: cut, id: p.id };
  // The new second half follows its sibling with a plain cut; it never inherits the transition leading into the first half.
  const b: Clip = { ...p, in: cut, id: newId() };
  delete b.transitionIn;
  delete b.joinedToPrevious;
  const strip = (c: PlacedClip): Clip => { const { start, end, index, ...rest } = c; void start; void end; void index; return rest; };
  return clips.flatMap((c) => (c.id === clipId ? [strip({ ...a, start: 0, end: 0, index: 0 }), strip({ ...b, start: 0, end: 0, index: 0 })] : [c]));
}

/** Remove a timeline range, trimming or deleting whatever it covers — "cut out the petrol stop". */
export function removeRange(clips: Clip[], from: number, to: number): Clip[] {
  if (to <= from) return clips;
  const out: Clip[] = [];
  for (const c of placeClips(clips)) {
    const strip = (c: PlacedClip): Clip => { const { start, end, index, ...rest } = c; void start; void end; void index; return rest; };
    if (c.end <= from || c.start >= to) out.push(strip(c));
    else {
      if (c.start < from) out.push({ ...strip(c), out: sourceTimeAt(c, from) });
      if (c.end > to) {
        const tail: Clip = { ...strip(c), id: c.start < from ? newId() : c.id, in: sourceTimeAt(c, to) };
        if (c.start < from) delete tail.transitionIn;
        // Footage was removed just before this piece: the cut shows again.
        delete tail.joinedToPrevious;
        out.push(tail);
      }
    }
  }
  // A clip stays joined only while the footage right before it is what it was: the same recording ending at the same frame.
  return out.map((c, i) => {
    if (!c.joinedToPrevious) return c;
    if (i === 0) return unjoin([c], c.id)[0];
    const was = clips[clips.findIndex((x) => x.id === c.id) - 1], now = out[i - 1];
    return was && was.media === now.media && was.out === now.out ? c : unjoin([c], c.id)[0];
  });
}

/**
 * Sort key for a camera file: the date-time embedded in its name if any
 * (DJI_20240915103012_0001_D, PXL_20240915_103012, 2024-09-15 10.30.12),
 * then its sequence number, then GoPro chapter (GX01nnnn, GX02nnnn…).
 */
export function recordingKey(name: string): { time: number; seq: number; chapter: number } {
  const base = name.replace(/\.[^.]+$/, "");
  const dt = base.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T.]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})?/);
  const month = dt ? Number(dt[2]) : 0, day = dt ? Number(dt[3]) : 0, hour = dt ? Number(dt[4]) : 0, minute = dt ? Number(dt[5]) : 0;
  const valid = !!dt && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59;
  const time = valid ? Date.UTC(Number(dt![1]), month - 1, day, hour, minute, Number(dt![6] ?? 0)) : 0;
  const gp = base.match(/^G[HX](\d{2})(\d{4})$/i);
  if (gp) return { time, seq: Number(gp[2]), chapter: Number(gp[1]) };
  const rest = valid ? base.slice(dt!.index! + dt![0].length) : base;
  const seqMatch = rest.match(/(\d{2,})/) ?? base.match(/(\d+)(?!.*\d)/);
  return { time, seq: seqMatch ? Number(seqMatch[1]) : 0, chapter: 0 };
}

/** Consecutive recordings from the same camera in shooting order, ready to butt together. */
export function orderRecordings(media: MediaRef[]): MediaRef[] {
  return [...media].sort((a, b) => {
    const ka = recordingKey(a.name), kb = recordingKey(b.name);
    return ka.time - kb.time || ka.seq - kb.seq || ka.chapter - kb.chapter || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Swap an item with its neighbour — reordering clips changes playback order. */
export function moveItem<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* --------------------------------------------------------------- audio */

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20));

/** Linear-in-dB interpolation between keyframes; before the first / after the last holds that value. */
export function keyframeDb(keyframes: Keyframe[], t: number, fallbackDb: number): number {
  if (!keyframes.length) return fallbackDb;
  const ks = [...keyframes].sort((a, b) => a.t - b.t);
  if (t <= ks[0].t) return ks[0].db;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].db;
  for (let i = 0; i + 1 < ks.length; i++) {
    if (t >= ks[i].t && t <= ks[i + 1].t) {
      const f = (t - ks[i].t) / Math.max(1e-9, ks[i + 1].t - ks[i].t);
      return ks[i].db + (ks[i + 1].db - ks[i].db) * f;
    }
  }
  return fallbackDb;
}

export const musicLength = (m: MusicTrack) => Math.max(0, m.out - m.in);

/**
 * Gain (linear) for a music track at a timeline instant: base gain, keyframes,
 * fade in/out, and an equal-power crossfade where two tracks on the same lane overlap.
 */
export function musicGainAt(track: MusicTrack, all: MusicTrack[], timelineT: number, timelineEnd = Infinity): number {
  if (track.muted) return 0;
  const local = timelineT - track.start;
  const len = musicLength(track);
  // A track that runs past the end of the video is cut there; its fade-out moves to meet the cut (1 s if it had none).
  const end = Math.min(track.start + len, timelineEnd);
  const cut = end < track.start + len;
  const fadeOut = cut && track.fadeOut === 0 ? 1 : track.fadeOut;
  if (local < 0 || timelineT > end) return 0;
  let g = dbToGain(keyframeDb(track.keyframes, local, track.gainDb));
  if (track.fadeIn > 0 && local < track.fadeIn) g *= Math.sin(((local / track.fadeIn) * Math.PI) / 2);
  const tail = end - timelineT;
  if (fadeOut > 0 && tail < fadeOut) g *= Math.sin(((tail / fadeOut) * Math.PI) / 2);
  // Equal-power crossfade with the next/previous track on the same lane.
  for (const o of all) {
    if (o.id === track.id || o.lane !== track.lane || o.muted) continue;
    const oStart = o.start, oEnd = o.start + musicLength(o);
    const tStart = track.start, tEnd = track.start + len;
    const lo = Math.max(tStart, oStart), hi = Math.min(tEnd, oEnd);
    if (hi <= lo || timelineT < lo || timelineT > hi) continue;
    const f = (timelineT - lo) / (hi - lo);
    // The earlier-starting track fades out across the overlap, the later one fades in.
    g *= tStart <= oStart ? Math.cos((f * Math.PI) / 2) : Math.sin((f * Math.PI) / 2);
  }
  return g;
}

/* ----------------------------------------------------------- sound regions in the mix */

/**
 * The region that counts at a timeline instant and how far it has come in (0–1): 1 inside it, rising over the ramp
 * before it and falling over the ramp after it; where two regions sit closer than a ramp, the nearer one counts.
 */
export function regionAt(regions: SoundRegion[] | undefined, t: number): { region: SoundRegion; w: number } | null {
  let best: { region: SoundRegion; w: number } | null = null;
  for (const r of regions ?? []) {
    let w: number;
    if (t >= r.from && t <= r.to) w = 1;
    else {
      const d = t < r.from ? r.from - t : t - r.to;
      if (!(r.ramp > 0) || d >= r.ramp) continue;
      w = 1 - d / r.ramp;
    }
    if (!best || w > best.w) best = { region: r, w };
  }
  return best;
}

/**
 * Gain (linear) for a clip's own sound at a timeline instant: its gain, or inside a region that sets the camera's
 * level, that level — reached linearly in dB over the ramp, or with an equal-power fade when the region takes the
 * sound out. A muted or switched-off clip stays silent whatever the region says.
 */
export function cameraGainAt(regions: SoundRegion[] | undefined, clip: Pick<Clip, "gainDb" | "muted">, t: number): number {
  if (clip.muted || clip.gainDb <= -60) return 0;
  const hit = regionAt(regions, t);
  const level = hit?.region.camera ?? null;
  if (!hit || level === null) return dbToGain(clip.gainDb);
  if (level <= -60) return hit.w >= 1 ? 0 : dbToGain(clip.gainDb) * Math.cos((hit.w * Math.PI) / 2);
  return dbToGain(clip.gainDb + hit.w * (level - clip.gainDb));
}

/**
 * What the regions do to a music track's gain at a timeline instant, as a factor on musicGainAt: 1 outside them, an
 * equal-power fade to 0 into a region with the music off, and under a region's level a pull-down — in dB, over the
 * ramp — from the track's own level (its gain and keyframes) to that level, so its fades and crossfades keep their
 * shape beneath. A track already under the level is left alone.
 */
export function regionMusicGain(regions: SoundRegion[] | undefined, track: Pick<MusicTrack, "gainDb" | "keyframes" | "start">, t: number): number {
  const hit = regionAt(regions, t);
  const level = hit?.region.music ?? null;
  if (!hit || level === null) return 1;
  if (level <= -60) return hit.w >= 1 ? 0 : Math.cos((hit.w * Math.PI) / 2);
  const own = keyframeDb(track.keyframes, t - track.start, track.gainDb);
  const duck = Math.max(0, own - level);
  return duck > 0 ? 10 ** (-(hit.w * duck) / 20) : 1;
}

/** Where a track actually stops: its own end, or the end of the video if that comes first. */
export const effectiveMusicEnd = (track: MusicTrack, timelineEnd: number) => Math.max(track.start, Math.min(track.start + musicLength(track), timelineEnd));

/** Seconds of a track that run past the end of the video and are never heard. */
export const musicUnused = (track: MusicTrack, timelineEnd: number) => Math.max(0, track.start + musicLength(track) - Math.max(track.start, effectiveMusicEnd(track, timelineEnd)));

/** A track must begin inside the video with at least a second of it (or all of a shorter track) before the end. */
export function clampMusicStart(start: number, track: Pick<MusicTrack, "in" | "out">, timelineEnd: number): number {
  const latest = Math.max(0, timelineEnd - Math.min(1, musicLength(track as MusicTrack)));
  return Math.max(0, Math.min(start, latest));
}

/** Move a music track earlier or later on its lane; the lane is re-laid keeping each slot's overlap. */
export function reorderMusic(music: MusicTrack[], id: string, dir: -1 | 1): MusicTrack[] {
  const track = music.find((m) => m.id === id);
  if (!track) return music;
  const lane = music.filter((m) => m.lane === track.lane).sort((a, b) => a.start - b.start);
  const overlaps = lane.map((m, i) => (i === 0 ? 0 : lane[i - 1].start + musicLength(lane[i - 1]) - m.start));
  const i = lane.findIndex((m) => m.id === id), j = i + dir;
  if (j < 0 || j >= lane.length) return music;
  const order = [...lane];
  [order[i], order[j]] = [order[j], order[i]];
  let cursor = lane[0].start;
  const placed = new Map<string, number>();
  order.forEach((m, k) => {
    const start = Math.max(0, k === 0 ? cursor : cursor - overlaps[k]);
    placed.set(m.id, start);
    cursor = start + musicLength(m);
  });
  return music.map((m) => (placed.has(m.id) ? { ...m, start: placed.get(m.id)! } : m));
}

/** Overlaps on the same lane become crossfades; report them so the UI can show the duration. */
export function crossfades(music: MusicTrack[]): { a: string; b: string; from: number; to: number }[] {
  const out: { a: string; b: string; from: number; to: number }[] = [];
  const sorted = [...music].sort((x, y) => x.start - y.start);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.lane !== b.lane) continue;
      const from = Math.max(a.start, b.start), to = Math.min(a.start + musicLength(a), b.start + musicLength(b));
      if (to > from) out.push({ a: a.id, b: b.id, from, to });
    }
  return out;
}

/**
 * Where a new track lands: after the last one on its lane, overlapping by `overlap` seconds for a crossfade. It must
 * start inside the video (see clampMusicStart). When the lane already reaches the end of the video there is no place
 * for it and the answer is null: the song stays in the project's songs, unplaced. It is never handed to another lane,
 * where it would play on top of the music already there — a second lane is the user's choice, not a spill-over.
 */
export function appendMusic(music: MusicTrack[], track: Omit<MusicTrack, "start">, overlap = 2, timelineEnd = Infinity): MusicTrack | null {
  const latest = timelineEnd === Infinity ? Infinity : clampMusicStart(Infinity, track, timelineEnd);
  const on = music.filter((m) => m.lane === track.lane);
  const end = on.reduce((m, t) => Math.max(m, t.start + musicLength(t)), 0);
  const start = Math.max(0, end - (on.length ? overlap : 0));
  return start <= latest ? { ...track, start } : null;
}

/* ---------------------------------------------------------- export plan */

export type SpanKind = "copy" | "encode";

export interface ExportSpan {
  kind: SpanKind;
  clipId: string;
  /** Source and timeline ranges, seconds. */
  sourceIn: number;
  sourceOut: number;
  start: number;
  end: number;
  /** Why this span re-encodes (for the UI). */
  reasons: string[];
  /** Source seconds per timeline second (the clip's speed). */
  speed: number;
}

const isNeutralGrade = (g: Grade) => g.lut === "none" && g.exposure === 0 && g.temperature === 0 && g.tint === 0 && g.contrast === 1 && g.saturation === 1;
const isNeutralTransform = (t: Transform) => t.rotate === 0 && t.straighten === 0 && t.crop.x === 0 && t.crop.y === 0 && t.crop.w === 1 && t.crop.h === 1;

/** Half a frame: a cut this close to a keyframe counts as on it. */
export const keyTolerance = (fps?: number) => 0.5 / (fps && fps > 0 ? fps : 30);

/** Why an unchanged stretch is re-encoded all the same: it runs from a cut to the next keyframe, or from the last keyframe to a cut. */
export const BRIDGE_REASON = "cut between keyframes";
/** Why a recording is re-encoded throughout until its index has been read. */
export const KEYFRAMES_PENDING = "keyframes not read yet";

/** The first keyframe at or after `t`, and the last one at or before it, in a sorted list. */
export function keyAtOrAfter(times: number[], t: number): number | null {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length ? times[lo] : null;
}
export function keyAtOrBefore(times: number[], t: number): number | null {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? times[lo - 1] : null;
}

/**
 * A copy span cut to whole keyframe groups. Copied packets must begin on a keyframe and end before one, so the
 * stretch from a cut to the next keyframe, and from the last keyframe to the cut after it, is re-encoded instead
 * (a bridge, the same frames one generation down). A cut within half a frame of a keyframe counts as on it; a
 * span that holds no whole group is a bridge from end to end. Spans of other kinds pass through untouched.
 */
export function splitAtKeyframes(span: ExportSpan, times: number[] | undefined, fps?: number): ExportSpan[] {
  if (span.kind !== "copy") return [span];
  if (!times?.length) return [{ ...span, kind: "encode", reasons: [KEYFRAMES_PENDING] }];
  const tol = keyTolerance(fps);
  const a = span.sourceIn, b = span.sourceOut;
  const at = (sIn: number, sOut: number, kind: SpanKind): ExportSpan => ({ ...span, kind, reasons: kind === "copy" ? [] : [BRIDGE_REASON], sourceIn: sIn, sourceOut: sOut, start: span.start + (sIn - a), end: span.start + (sOut - a), speed: 1 });
  const k1 = keyAtOrAfter(times, a - tol), k2 = keyAtOrBefore(times, b + tol);
  // Copying needs two keyframes in the span, one to start on and one to stop before.
  if (k1 === null || k2 === null || k2 <= k1 + tol) return [at(a, b, "encode")];
  const copyIn = k1 <= a + tol ? a : k1, copyOut = k2 >= b - tol ? b : k2;
  const out: ExportSpan[] = [];
  if (copyIn > a) out.push(at(a, copyIn, "encode"));
  out.push(at(copyIn, copyOut, "copy"));
  if (copyOut < b) out.push(at(copyOut, b, "encode"));
  return out;
}

/** Neighbouring re-encoded spans of one clip, contiguous in the footage, as one span (a transition window and its bridges, say). */
export function mergeAdjacentSpans(spans: ExportSpan[]): ExportSpan[] {
  const out: ExportSpan[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "encode" && s.kind === "encode" && prev.clipId === s.clipId && prev.speed === s.speed && Math.abs(prev.end - s.start) < 1e-6 && Math.abs(prev.sourceOut - s.sourceIn) < 1e-6) {
      out[out.length - 1] = { ...prev, end: s.end, sourceOut: s.sourceOut, reasons: [...new Set([...prev.reasons, ...s.reasons])] };
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/**
 * Which parts of the timeline are copied from the recording as they are and which are re-encoded. Copying needs:
 * smart copy on, no grade, no transform, no watermark, the recording's own size, frame rate and codec in the export,
 * and the recording's keyframes read. Within such a clip, a title, a label, a transition or a zoom re-encodes only the frames
 * it covers, and every copied stretch is then cut to whole keyframe groups (see `splitAtKeyframes`): the few frames
 * between a cut and the keyframe beside it are re-encoded as a bridge. Neighbouring re-encoded spans merge.
 */
export function planExport(p: Project): ExportSpan[] {
  const spans: ExportSpan[] = [];
  const placed = placeClips(p.clips);
  const windows = transitionWindows(placed, p.media);
  const first = p.media[placed[0]?.media ?? ""];
  const sameCodec = (m: MediaRef | undefined) => !!m?.codec && m.codec.startsWith(p.export.codec);
  for (const c of placed) {
    const reasons: string[] = [];
    const m = p.media[c.media];
    if (!p.export.smartCopy) reasons.push("smart copy off");
    if (!isNeutralGrade(c.grade)) reasons.push("colour grade");
    if (c.obscure?.length) reasons.push("obscured areas");
    if (!isNeutralTransform(c.transform)) reasons.push("rotate / crop");
    if (!sameCodec(m)) reasons.push(`source is ${m?.codec ?? "unknown"}, export is ${p.export.codec}`);
    if (p.export.resolution !== "source") reasons.push("scaled output");
    if (p.export.frame && p.export.frame !== "source") reasons.push(`${p.export.frame} frame`);
    else if (c.reframe?.keys.length) reasons.push("reframed");
    if (m && first && m !== first && (m.width !== first.width || m.height !== first.height || m.fps !== first.fps)) reasons.push("size or frame rate differs from the first recording");
    if (m?.rotation) reasons.push("rotated recording");
    if (p.watermark.media) reasons.push("watermark");
    const speed = clipSpeed(c);
    if (speed !== 1) reasons.push(`speed ${speed}×`);
    if (c.introRole) reasons.push(c.introRole === "card" ? "intro title card" : "intro scene");
    if (!reasons.length && m && !m.keyframeTimes?.length) reasons.push(m.keyframeNote ?? KEYFRAMES_PENDING);
    const overlays = p.titles.filter((t) => t.start < c.end && t.start + t.duration > c.start);
    if (reasons.length) {
      spans.push({ kind: "encode", clipId: c.id, sourceIn: c.in, sourceOut: c.out, start: c.start, end: c.end, reasons, speed });
      continue;
    }
    // Titles, labels, transitions and zooms only force re-encoding of the frames they cover.
    let cursor = c.start;
    const cuts: [number, number, string][] = [
      ...overlays.map((t) => [Math.max(c.start, t.start), Math.min(c.end, t.start + t.duration), "title"] as [number, number, string]),
      ...windows.filter((w) => w.start < c.end && w.end > c.start).map((w) => [Math.max(c.start, w.start), Math.min(c.end, w.end), "transition"] as [number, number, string]),
      ...(p.zooms ?? []).filter((z) => z.from < c.end && z.to > c.start && z.zoom > 1).map((z) => [Math.max(c.start, z.from), Math.min(c.end, z.to), "zoom"] as [number, number, string]),
      ...(p.labels ?? []).filter((l) => l.start < c.end && l.start + l.duration > c.start).map((l) => [Math.max(c.start, l.start), Math.min(c.end, l.start + l.duration), "label"] as [number, number, string]),
    ].sort((a, b) => a[0] - b[0]);
    for (const [ts, te, why] of cuts) {
      if (te <= cursor) continue;
      if (ts > cursor) spans.push({ kind: "copy", clipId: c.id, sourceIn: c.in + (cursor - c.start), sourceOut: c.in + (ts - c.start), start: cursor, end: ts, reasons: [], speed: 1 });
      spans.push({ kind: "encode", clipId: c.id, sourceIn: c.in + (Math.max(cursor, ts) - c.start), sourceOut: c.in + (te - c.start), start: Math.max(cursor, ts), end: te, reasons: [why], speed: 1 });
      cursor = Math.max(cursor, te);
    }
    if (cursor < c.end) spans.push({ kind: "copy", clipId: c.id, sourceIn: c.in + (cursor - c.start), sourceOut: c.out, start: cursor, end: c.end, reasons: [], speed: 1 });
  }
  // A partial export keeps only what falls inside the range, trimming spans at its edges.
  const range = exportRange(p);
  const ranged = !range
    ? spans
    : spans.flatMap((s) => {
        const s0 = Math.max(s.start, range.from), e0 = Math.min(s.end, range.to);
        if (e0 - s0 <= 1e-6) return [];
        return [{ ...s, sourceIn: s.sourceIn + (s0 - s.start) * s.speed, sourceOut: s.sourceOut - (s.end - e0) * s.speed, start: s0, end: e0 }];
      });
  // Copied stretches run keyframe to keyframe; what a cut leaves between is a bridge.
  const media = (s: ExportSpan) => p.media[p.clips.find((c) => c.id === s.clipId)?.media ?? ""];
  return mergeAdjacentSpans(ranged.flatMap((s) => splitAtKeyframes(s, media(s)?.keyframeTimes, media(s)?.fps)));
}

export interface ExportEstimate {
  copySeconds: number;
  encodeSeconds: number;
  /** Rough wall-clock estimate in seconds, given an encode speed in frames/s — finishing the file included. */
  wallSeconds: number;
  /** Closing the file: the browser reads it all back to check it before moving it into place. */
  finishSeconds: number;
  /** Output size estimate in bytes. */
  bytes: number;
}

/** Export time and size: copying is I/O-bound (fast); re-encoding 8K runs near real time on Apple silicon. */
export function estimateExport(p: Project, spans: ExportSpan[], encodeFps = 30, copyGBps = 0.4, closeBytesPerS = 400e6): ExportEstimate {
  const copySeconds = spans.filter((s) => s.kind === "copy").reduce((a, s) => a + (s.end - s.start), 0);
  const encodeSeconds = spans.filter((s) => s.kind === "encode").reduce((a, s) => a + (s.end - s.start), 0);
  const fps = Object.values(p.media).find((m) => m.fps)?.fps ?? 30;
  const videoBytes = ((p.export.bitrateMbps * 1e6) / 8) * (copySeconds + encodeSeconds);
  const audioBytes = ((p.export.audioBitrateKbps * 1e3) / 8) * (copySeconds + encodeSeconds);
  const copyBytes = spans.filter((s) => s.kind === "copy").reduce((a, s) => { const m = p.media[p.clips.find((c) => c.id === s.clipId)?.media ?? ""]; return a + (m ? (m.size / Math.max(1, m.duration)) * (s.end - s.start) : 0); }, 0);
  const bytes = videoBytes + audioBytes;
  const finishSeconds = 1.5 + bytes / closeBytesPerS;
  return { copySeconds, encodeSeconds, wallSeconds: (encodeSeconds * fps) / encodeFps + copyBytes / (copyGBps * 1e9) + finishSeconds, finishSeconds, bytes };
}

/**
 * A short hash of everything that shapes an export's file — clips, media, grades, titles, music, intro, watermark,
 * export settings — so finished parts of a stopped export can tell whether the project still matches them.
 */
/** JSON with every object's keys in sorted order and nothing null or undefined: the same edit reads the same however it was built. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined || v === null ? "null" : canonical(v))).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined && o[k] !== null)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A hash of what shapes the landscape export's frames and sound, so finished parts of an export can tell whether
 * the project they came from is still this one. It reads the same after a reload or a newer build: keys are sorted
 * and absent values dropped (a project loaded from its file orders keys differently from one edited in place, and a
 * newer build fills in fields older ones never wrote), and whatever does not reach the file is left out — the doctor
 * and review settings, proxies, the preview, the stop scan, remembered folders, the shorts and the editor's mode,
 * titles and labels that belong to a short, the labels' stored art (its key is a hash of it, and the labels carry
 * the key), and a recording's keyframe list, rotation and whereabouts.
 */
export function exportFingerprint(p: Project): string {
  // Likes and the fill settings only steer the next shuffle; they change no frame or sample of the file.
  const { updatedAt, createdAt, proxies, preview, stops, shorts, mode, folders, songs, fill, export: ex, media, titles, labels, art, ...rest } = p as Project & { updatedAt?: number; folders?: unknown };
  void updatedAt;
  void createdAt;
  void proxies;
  void preview;
  void stops;
  void shorts;
  void mode;
  void folders;
  void songs;
  void fill;
  const { check, review, ...exportRest } = ex;
  void check;
  void review;
  const text = canonical({
    ...rest,
    export: exportRest,
    media: Object.fromEntries(
      Object.entries(media).map(([id, m]) => {
        const { keyframeTimes, keyframeNote, rotation, where, ...keep } = m;
        void keyframeTimes;
        void keyframeNote;
        void rotation;
        void where;
        return [id, keep];
      }),
    ),
    titles: titles.filter((t) => !t.short),
    // The landscape edit's labels, and their art by its key (a hash of the picture) rather than the picture itself.
    ...(labels?.some((l) => !l.short) ? { labels: labels.filter((l) => !l.short) } : {}),
  });
  void art;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `2-${h.toString(16).padStart(8, "0")}-${text.length.toString(36)}`;
}

/* --------------------------------------------------------- serialisation */

export function serialize(p: Project): string {
  return JSON.stringify({ ...p, updatedAt: Date.now() });
}

/** A saved reframe with every key a number, in order; nothing when there is none worth keeping. */
function normalizeReframe(r: unknown): { reframe: Reframe } | Record<string, never> {
  const keys = (r as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return {};
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const clean = keys
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => ({ t: num(k.t, 0, Infinity, 0), cx: num(k.cx, 0, 1, 0.5), cy: num(k.cy, 0, 1, 0.5), zoom: num(k.zoom, 1, MAX_REFRAME_ZOOM, 1), ...(k.hold === true ? { hold: true } : {}) }))
    .sort((a, b) => a.t - b.t);
  return clean.length ? { reframe: { keys: clean } } : {};
}

const safeFrac = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(0.45, Math.max(0, v)) : 0);

export function deserialize(json: string): Project | null {
  try {
    const p = JSON.parse(json) as Project;
    if (p?.version !== 1 || !Array.isArray(p.clips) || !p.media) return null;
    // Until 1.12.0 one transition setting applied to every cut; carry it onto the cuts it covered. Projects saved since
    // carry the export range key (added in the same release) and their transition setting is only the default for new
    // cuts — stamping it on every cut again would add transitions the user never placed, on every reload.
    const legacy = (p.transition ?? {}) as { kind?: string; duration?: number };
    const known = TRANSITIONS.some((t) => t.kind === legacy.kind);
    const transition: Transition = { kind: known ? (legacy.kind as TransitionKind) : DEFAULT_TRANSITION.kind, duration: legacy.duration ?? DEFAULT_TRANSITION.duration };
    const perCutEra = !!p.export && "range" in p.export;
    const migrated = known && !perCutEra && !p.clips.some((c) => c.transitionIn) ? applyTransitionToAll(p.clips, transition) : p.clips;
    const clips = migrated.map((c) => {
      const { introRole, introSeconds, reframe, obscure, ...rest } = c;
      const base = LUT_KINDS.includes(rest.grade?.lut) ? rest : { ...rest, grade: { ...rest.grade, lut: "none" as LutKind } };
      return { ...base, ...(obscure ? { obscure: normalizeObscure(obscure) } : {}), ...(rest.speed !== undefined ? { speed: clipSpeed(rest) } : {}), ...(introRole && INTRO_ROLES.includes(introRole) ? { introRole } : {}), ...(typeof introSeconds === "number" && introSeconds > 0 ? { introSeconds } : {}), ...normalizeReframe(reframe) };
    });
    const frame: Frame = FRAMES.includes(p.export?.frame as Frame) ? (p.export.frame as Frame) : "source";
    const rawLayout = p.layout as Partial<Layout> | null | undefined;
    const layout: Layout | null = rawLayout && typeof rawLayout === "object" && LAYOUT_KINDS.includes(rawLayout.kind as LayoutKind) ? { ...rawLayout, kind: rawLayout.kind as LayoutKind } : null;
    const rawSafe = p.safeArea as Partial<SafeArea> | null | undefined;
    const safeArea: SafeArea | null = rawSafe && typeof rawSafe === "object" ? { top: safeFrac(rawSafe.top), bottom: safeFrac(rawSafe.bottom), left: safeFrac(rawSafe.left), right: safeFrac(rawSafe.right) } : null;
    const intro: IntroSettings = { ...DEFAULT_INTRO, ...(p.intro ?? {}), card: { ...DEFAULT_INTRO.card, ...(p.intro?.card ?? {}) } };
    const stops: StopScan | null = p.stops && typeof p.stops === "object" && p.stops.runs && typeof p.stops.runs === "object" ? { ...p.stops, minSeconds: p.stops.minSeconds > 0 ? p.stops.minSeconds : 2, margin: p.stops.margin >= 0 ? p.stops.margin : 0.5 } : null;
    if (typeof intro.sceneSeconds !== "number" || !(intro.sceneSeconds > 0)) intro.sceneSeconds = null;
    if (!INTRO_OUTROS.includes(intro.outro as IntroOutro)) intro.outro = "look";
    const sound: SoundMode = SOUND_MODES.includes(p.sound as SoundMode) ? (p.sound as SoundMode) : "footage";
    // Before 1.91.0 a short had no music of its own and heard the landscape's under its span; such a short takes a copy
    // of that, so it sounds as it did, and from then on its music is its own.
    const landscapeMusic = Array.isArray(p.music) ? p.music.map((m) => normalizeMusicTrack(m)).filter((m): m is MusicTrack => !!m) : [];
    const shorts: Short[] = Array.isArray(p.shorts)
      ? p.shorts
          .map((x) => normalizeShort(x))
          .filter((x): x is Short => !!x)
          .map((x) => (x.music ? x : { ...x, music: musicBetween(landscapeMusic, x.from, x.to, x.loop !== "off").map((m) => ({ ...m, id: newId(), lane: 0 })) }))
      : [];
    const mode: EditorMode = p.mode === "short" ? "short" : "landscape";
    const songs = p.songs && typeof p.songs === "object" ? Object.fromEntries(Object.entries(p.songs).map(([id, s]) => [id, normalizeSongPrefs(s)])) : undefined;
    const fill = p.fill && typeof p.fill === "object" ? normalizeFill(p.fill) : undefined;
    const regions = Array.isArray(p.regions) ? tidySpans(p.regions.map((r) => normalizeRegion(r)).filter((r): r is SoundRegion => !!r)) : undefined;
    const zooms = Array.isArray(p.zooms) ? tidySpans(p.zooms.map((z) => normalizeZoom(z)).filter((z): z is Zoom => !!z)) : undefined;
    const loaded: Project = { ...newProject(), ...p, clips, sound, layout, safeArea, shorts, mode, ...(songs ? { songs } : {}), ...(fill ? { fill } : {}), export: { ...DEFAULT_EXPORT, ...p.export, frame, tags: { ...DEFAULT_TAGS, ...(p.export?.tags ?? {}) } }, preview: { ...DEFAULT_PREVIEW, ...(p.preview ?? (Object.values(p.proxies ?? {}).some((x) => x?.ready) ? { proxyHeight: 1080 } : {})) }, transition, intro, stops, titles: (p.titles ?? []).map((t) => normalizeTitle(t)) };
    if (regions) loaded.regions = regions;
    else delete loaded.regions;
    if (zooms) loaded.zooms = zooms;
    else delete loaded.zooms;
    // Labels keep only art that is there, and art only what a label uses.
    const art = p.art && typeof p.art === "object" ? Object.fromEntries(Object.entries(p.art).map(([k, a]) => [k, normalizeArt(a)] as const).filter((e): e is [string, LabelArt] => !!e[1])) : {};
    const labels = Array.isArray(p.labels) ? p.labels.map((l) => normalizeLabel(l)).filter((l): l is Label => !!l && (l.art ? !!art[l.art] : !!loaded.media[l.media!])) : [];
    return withLabels(loaded, labels, art);
  } catch {
    return null;
  }
}

/** Copy one clip's grade onto others — "match the whole drive". */
/** What clips started at before the sound modes (1.64.0): the "footage" level. */
export const DEFAULT_CLIP_GAIN_DB = SOUND_LEVELS.footage.camera;

/** Copy one clip's original-audio gain and mute to the others. */
export function applyAudioTo(clips: Clip[], fromId: string, toIds: string[] | "all"): Clip[] {
  const src = clips.find((c) => c.id === fromId);
  if (!src) return clips;
  return clips.map((c) => (c.id !== fromId && (toIds === "all" || toIds.includes(c.id)) ? { ...c, gainDb: src.gainDb, muted: src.muted } : c));
}

export function applyGradeTo(clips: Clip[], fromId: string, toIds: string[] | "all"): Clip[] {
  const src = clips.find((c) => c.id === fromId);
  if (!src) return clips;
  return clips.map((c) => (c.id !== fromId && (toIds === "all" || toIds.includes(c.id)) ? { ...c, grade: { ...src.grade } } : c));
}

/** "1:02:30", "2:05", "95", "1:02.5" → seconds; NaN when it is not a time. */
export const parseTime = (text: string): number => {
  const parts = text.trim().split(":");
  if (!parts.length || parts.some((x) => !/^\d+(\.\d+)?$/.test(x.trim()))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + Number(n), 0);
};

export const fmtTime = (secs: number, frames?: number) => {
  // Never a negative clock: a time a hair below zero (or not a number) reads as the start.
  const s = secs > 0 ? secs : 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const base = `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
  return frames ? `${base}.${String(Math.floor((s % 1) * frames)).padStart(2, "0")}` : base;
};
