/**
 * The video editor's project model and the pure arithmetic on it: timeline
 * layout from clips, music placement with overlaps and crossfades, gain
 * keyframes, the smart-copy export plan, and serialisation for autosave.
 * Nothing here touches the DOM, files or codecs — see engine.ts for that.
 */

/** Built-in conversions, plus the project's own .cube (DJI's official file, say). */
export type LutKind = "none" | "dlogm" | "dlogm-study" | "dlogm-natural" | "dlogm-vivid" | "dlog" | "custom";
export const LUT_KINDS: LutKind[] = ["none", "dlogm", "dlogm-study", "dlogm-natural", "dlogm-vivid", "dlog", "custom"];

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

export interface MediaRef {
  /** Key into the project store's file handles. */
  id: string;
  name: string;
  size: number;
  /** Media duration in seconds. */
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  hasAudio?: boolean;
  sampleRate?: number;
}

export interface Clip {
  id: string;
  media: string;
  /** Trim in/out within the source, seconds. */
  in: number;
  out: number;
  transform: Transform;
  grade: Grade;
  /** Original audio gain in dB (−60 mutes) and mute flag. */
  gainDb: number;
  muted: boolean;
  /** The transition leading into this clip from the one before it, if any. */
  transitionIn?: Transition;
}

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
}

export interface Title {
  id: string;
  kind: "intro" | "title" | "lowerThird";
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
  font: TitleFont;
  /** Text height as a fraction of the frame height. */
  size: number;
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

const TITLE_DEFAULTS: Record<Title["kind"], Pick<Title, "position" | "color" | "background" | "font" | "size" | "duration">> = {
  intro: { position: "mc", color: "#ffffff", background: "", font: "sans", size: 0.07, duration: 4 },
  title: { position: "mc", color: "#ffffff", background: "", font: "sans", size: 0.06, duration: 5 },
  lowerThird: { position: "bl", color: "#ffffff", background: "rgba(0,0,0,0.55)", font: "sans", size: 0.04, duration: 5 },
};

export function newTitle(kind: Title["kind"], start: number, text: string, subtitle = ""): Title {
  const d = TITLE_DEFAULTS[kind];
  return { id: newId(), kind, text, subtitle, start, duration: d.duration, fade: 1, position: d.position, color: d.color, background: d.background, font: d.font, size: d.size };
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
    fade: t.fade ?? 1,
    position: TITLE_POSITIONS.includes(t.position as TitlePosition) ? (t.position as TitlePosition) : d.position,
    color: t.color ?? d.color,
    background: t.background ?? d.background,
    font: t.font && t.font in TITLE_FONTS ? t.font : d.font,
    size: t.size ?? d.size,
  };
}

export interface Watermark {
  media: string | null;
  corner: "tl" | "tr" | "bl" | "br";
  /** Width as a fraction of the frame. */
  size: number;
  opacity: number;
  margin: number;
}

export interface ExportSettings {
  codec: "hevc" | "avc";
  /** Target video bitrate, Mbps. */
  bitrateMbps: number;
  /** Encoder quality/speed hint. */
  preset: "quality" | "balanced" | "fast";
  audioBitrateKbps: number;
  /** "source" keeps the first clip's resolution; otherwise a height to scale to. */
  resolution: "source" | 2160 | 1440 | 1080;
  /** Whether untouched spans may be stream-copied. */
  smartCopy: boolean;
  /** Export only this part of the timeline (seconds); null means all of it. */
  range: { from: number; to: number } | null;
}

export type TransitionKind = "dissolve" | "dipBlack" | "dipWhite" | "zoom" | "blur" | "wipe" | "push";
export interface Transition {
  kind: TransitionKind;
  /** Seconds, centred on the cut. */
  duration: number;
}
/** The project's choice for new transitions (the last one used). */
export type TransitionSettings = Transition;
export const DEFAULT_TRANSITION: Transition = { kind: "dissolve", duration: 1 };
/** Transitions that suit road footage, in the order the menu shows them. */
export const TRANSITIONS: { kind: TransitionKind; name: string; hint: string }[] = [
  { kind: "dissolve", name: "Cross dissolve", hint: "A soft blend — the classic for continuous driving." },
  { kind: "dipBlack", name: "Dip to black", hint: "Stops, parking and jumps in time." },
  { kind: "dipWhite", name: "Flash to white", hint: "Tunnel exits and driving into the sun." },
  { kind: "zoom", name: "Drive through", hint: "The shot accelerates into the cut; the next one arrives close and settles." },
  { kind: "blur", name: "Speed blur", hint: "A blur washes over the cut and clears on the new road." },
  { kind: "wipe", name: "Road wipe", hint: "The new road sweeps in from the left behind a soft edge." },
  { kind: "push", name: "Overtake", hint: "The next clip slides in from the right and pushes the old one out." },
];

export interface TransitionWindow {
  kind: TransitionKind;
  outgoing: PlacedClip;
  incoming: PlacedClip;
  cut: number;
  start: number;
  end: number;
}

/**
 * One window per cut that carries a transition, centred on the cut so no
 * timing shifts. A window never exceeds either clip's length, which also
 * keeps neighbouring windows apart.
 */
export function transitionWindows(placed: PlacedClip[]): TransitionWindow[] {
  const out: TransitionWindow[] = [];
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1], b = placed[i], tr = b.transitionIn;
    if (!tr || !(tr.duration > 0)) continue;
    const d = Math.min(tr.duration, a.end - a.start, b.end - b.start);
    if (d < 0.2) continue;
    out.push({ kind: tr.kind, outgoing: a, incoming: b, cut: b.start, start: b.start - d / 2, end: b.start + d / 2 });
  }
  return out;
}

/** Set (or with null, remove) the transition on the cut leading into a clip. The first clip has no cut before it. */
export function setTransition(clips: Clip[], incomingId: string, tr: Transition | null): Clip[] {
  return clips.map((c, i) => {
    if (c.id !== incomingId) return c;
    const { transitionIn, ...rest } = c;
    void transitionIn;
    return tr && i > 0 ? { ...rest, transitionIn: { ...tr } } : rest;
  });
}

/** Stamp one transition on every cut (null clears them all). */
export function applyTransitionToAll(clips: Clip[], tr: Transition | null): Clip[] {
  return clips.map((c, i) => {
    const { transitionIn, ...rest } = c;
    void transitionIn;
    return tr && i > 0 ? { ...rest, transitionIn: { ...tr } } : rest;
  });
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
export function titleLanes(titles: Title[]): { lanes: Record<string, number>; count: number } {
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
  /** A .cube the user loaded (expects the camera's log in, Rec.709 out), applied by clips whose lut is "custom". */
  customLut?: { name: string; cube: string } | null;
  /** Proxy state per media id: whether a proxy exists (and which file). */
  proxies: Record<string, { ready: boolean; file?: string }>;
}

export const DEFAULT_EXPORT: ExportSettings = { codec: "hevc", bitrateMbps: 100, preset: "balanced", audioBitrateKbps: 256, resolution: "source", smartCopy: true, range: null };

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

export function newProject(name = "Untitled drive"): Project {
  const now = Date.now();
  return { version: 1, id: newId(), name, createdAt: now, updatedAt: now, media: {}, clips: [], music: [], titles: [], watermark: { media: null, corner: "br", size: 0.08, opacity: 0.85, margin: 0.03 }, export: { ...DEFAULT_EXPORT }, preview: { ...DEFAULT_PREVIEW }, transition: { ...DEFAULT_TRANSITION }, proxies: {} };
}

/* ---------------------------------------------------------- timeline */

export interface PlacedClip extends Clip {
  /** Timeline position, seconds. */
  start: number;
  end: number;
  index: number;
}

export const clipLength = (c: Clip) => Math.max(0, c.out - c.in);

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
  for (const c of placeClips(clips)) if (t >= c.start && (t < c.end || (t === c.end && c.end === timelineDuration({ clips } as Project)))) return { clip: c, sourceTime: c.in + Math.min(t - c.start, clipLength(c)) };
  return null;
}

/** Split a clip at a timeline instant into two clips sharing its settings. */
export function splitClip(clips: Clip[], clipId: string, t: number): Clip[] {
  const placed = placeClips(clips);
  const p = placed.find((c) => c.id === clipId);
  if (!p || t <= p.start + 0.01 || t >= p.end - 0.01) return clips;
  const cut = p.in + (t - p.start);
  const a: Clip = { ...p, out: cut, id: p.id };
  // The new second half follows its sibling with a plain cut; it never inherits the transition leading into the first half.
  const b: Clip = { ...p, in: cut, id: newId() };
  delete b.transitionIn;
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
      if (c.start < from) out.push({ ...strip(c), out: c.in + (from - c.start) });
      if (c.end > to) {
        const tail: Clip = { ...strip(c), id: c.start < from ? newId() : c.id, in: c.in + (to - c.start) };
        if (c.start < from) delete tail.transitionIn;
        out.push(tail);
      }
    }
  }
  return out;
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

/** Where a track actually stops: its own end, or the end of the video if that comes first. */
export const effectiveMusicEnd = (track: MusicTrack, timelineEnd: number) => Math.min(track.start + musicLength(track), timelineEnd);

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

/** Drop a track so that it overlaps the previous one on the lane by `overlap` seconds. */
export function appendMusic(music: MusicTrack[], track: Omit<MusicTrack, "start">, overlap = 2): MusicTrack {
  const lane = music.filter((m) => m.lane === track.lane);
  const end = lane.reduce((m, t) => Math.max(m, t.start + musicLength(t)), 0);
  return { ...track, start: Math.max(0, end - (lane.length ? overlap : 0)) };
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
}

const isNeutralGrade = (g: Grade) => g.lut === "none" && g.exposure === 0 && g.temperature === 0 && g.tint === 0 && g.contrast === 1 && g.saturation === 1;
const isNeutralTransform = (t: Transform) => t.rotate === 0 && t.straighten === 0 && t.crop.x === 0 && t.crop.y === 0 && t.crop.w === 1 && t.crop.h === 1;

/**
 * Which parts of the timeline can be stream-copied from the source and which
 * must be re-encoded. Copy needs: no grade, no transform, no title or
 * watermark drawn over it, the same codec as the export, and smart copy on.
 * (Copying also has to start on a keyframe; the engine snaps to the previous
 * keyframe and encodes the few frames in between.)
 */
export function planExport(p: Project): ExportSpan[] {
  const spans: ExportSpan[] = [];
  const placed = placeClips(p.clips);
  const windows = transitionWindows(placed);
  const sameCodec = (m: MediaRef | undefined) => !!m?.codec && m.codec.startsWith(p.export.codec);
  for (const c of placed) {
    const reasons: string[] = [];
    if (!p.export.smartCopy) reasons.push("smart copy off");
    if (!isNeutralGrade(c.grade)) reasons.push("colour grade");
    if (!isNeutralTransform(c.transform)) reasons.push("rotate / crop");
    if (!sameCodec(p.media[c.media])) reasons.push(`source is ${p.media[c.media]?.codec ?? "unknown"}, export is ${p.export.codec}`);
    if (p.export.resolution !== "source") reasons.push("scaled output");
    if (p.watermark.media) reasons.push("watermark");
    const overlays = p.titles.filter((t) => t.start < c.end && t.start + t.duration > c.start);
    if (reasons.length) {
      spans.push({ kind: "encode", clipId: c.id, sourceIn: c.in, sourceOut: c.out, start: c.start, end: c.end, reasons });
      continue;
    }
    // Titles and transitions only force re-encoding of the frames they cover.
    let cursor = c.start;
    const cuts: [number, number, string][] = [
      ...overlays.map((t) => [Math.max(c.start, t.start), Math.min(c.end, t.start + t.duration), "title"] as [number, number, string]),
      ...windows.filter((w) => w.start < c.end && w.end > c.start).map((w) => [Math.max(c.start, w.start), Math.min(c.end, w.end), "transition"] as [number, number, string]),
    ].sort((a, b) => a[0] - b[0]);
    for (const [ts, te, why] of cuts) {
      if (te <= cursor) continue;
      if (ts > cursor) spans.push({ kind: "copy", clipId: c.id, sourceIn: c.in + (cursor - c.start), sourceOut: c.in + (ts - c.start), start: cursor, end: ts, reasons: [] });
      spans.push({ kind: "encode", clipId: c.id, sourceIn: c.in + (Math.max(cursor, ts) - c.start), sourceOut: c.in + (te - c.start), start: Math.max(cursor, ts), end: te, reasons: [why] });
      cursor = Math.max(cursor, te);
    }
    if (cursor < c.end) spans.push({ kind: "copy", clipId: c.id, sourceIn: c.in + (cursor - c.start), sourceOut: c.out, start: cursor, end: c.end, reasons: [] });
  }
  // A partial export keeps only what falls inside the range, trimming spans at its edges.
  const range = exportRange(p);
  if (!range) return spans;
  return spans.flatMap((s) => {
    const s0 = Math.max(s.start, range.from), e0 = Math.min(s.end, range.to);
    if (e0 - s0 <= 1e-6) return [];
    return [{ ...s, sourceIn: s.sourceIn + (s0 - s.start), sourceOut: s.sourceOut - (s.end - e0), start: s0, end: e0 }];
  });
}

export interface ExportEstimate {
  copySeconds: number;
  encodeSeconds: number;
  /** Rough wall-clock estimate in seconds, given an encode speed in frames/s. */
  wallSeconds: number;
  /** Output size estimate in bytes. */
  bytes: number;
}

/** Export time and size: copying is I/O-bound (fast); re-encoding 8K runs near real time on Apple silicon. */
export function estimateExport(p: Project, spans: ExportSpan[], encodeFps = 30, copyGBps = 0.4): ExportEstimate {
  const copySeconds = spans.filter((s) => s.kind === "copy").reduce((a, s) => a + (s.end - s.start), 0);
  const encodeSeconds = spans.filter((s) => s.kind === "encode").reduce((a, s) => a + (s.end - s.start), 0);
  const fps = Object.values(p.media).find((m) => m.fps)?.fps ?? 30;
  const videoBytes = ((p.export.bitrateMbps * 1e6) / 8) * (copySeconds + encodeSeconds);
  const audioBytes = ((p.export.audioBitrateKbps * 1e3) / 8) * (copySeconds + encodeSeconds);
  const copyBytes = spans.filter((s) => s.kind === "copy").reduce((a, s) => { const m = p.media[p.clips.find((c) => c.id === s.clipId)?.media ?? ""]; return a + (m ? (m.size / Math.max(1, m.duration)) * (s.end - s.start) : 0); }, 0);
  return { copySeconds, encodeSeconds, wallSeconds: (encodeSeconds * fps) / encodeFps + copyBytes / (copyGBps * 1e9), bytes: videoBytes + audioBytes };
}

/* --------------------------------------------------------- serialisation */

export function serialize(p: Project): string {
  return JSON.stringify({ ...p, updatedAt: Date.now() });
}

export function deserialize(json: string): Project | null {
  try {
    const p = JSON.parse(json) as Project;
    if (p?.version !== 1 || !Array.isArray(p.clips) || !p.media) return null;
    // Until 1.12.0 one transition setting applied to every cut; carry it onto the cuts it covered.
    const legacy = (p.transition ?? {}) as { kind?: string; duration?: number };
    const known = TRANSITIONS.some((t) => t.kind === legacy.kind);
    const transition: Transition = { kind: known ? (legacy.kind as TransitionKind) : DEFAULT_TRANSITION.kind, duration: legacy.duration ?? DEFAULT_TRANSITION.duration };
    const migrated = known && !p.clips.some((c) => c.transitionIn) ? applyTransitionToAll(p.clips, transition) : p.clips;
    const clips = migrated.map((c) => (LUT_KINDS.includes(c.grade?.lut) ? c : { ...c, grade: { ...c.grade, lut: "none" as LutKind } }));
    return { ...newProject(), ...p, clips, export: { ...DEFAULT_EXPORT, ...p.export }, preview: { ...DEFAULT_PREVIEW, ...(p.preview ?? (Object.values(p.proxies ?? {}).some((x) => x?.ready) ? { proxyHeight: 1080 } : {})) }, transition, titles: (p.titles ?? []).map((t) => normalizeTitle(t)) };
  } catch {
    return null;
  }
}

/** Copy one clip's grade onto others — "match the whole drive". */
/** New clips start with their road noise well under the music. */
export const DEFAULT_CLIP_GAIN_DB = -12;

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

export const fmtTime = (s: number, frames?: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const base = `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
  return frames ? `${base}.${String(Math.floor((s % 1) * frames)).padStart(2, "0")}` : base;
};
