/**
 * The song library and "Shuffle & fill" of the landscape lanes: every song a project knows, with how it is liked and
 * whether the shuffle may place it; the lay-out of songs end to end over the whole video — the opener first, liked
 * songs more often, the closer ending with the video, crossfades between them, the stretches a sound region keeps free
 * of music left empty — and the ways to clear the lanes or take songs out of the project. Pure arithmetic over the
 * project; the editor owns the state and the files.
 */
import type { BeatGrid } from "./beats";
import { DEFAULT_FILL, DEFAULT_SONG_PREFS, LIKE_WEIGHTS, REGION_PRESETS, effectiveMusicEnd, fmtTime, musicFreeSpans, musicLength, newId, regionPreset, soundLevels, tidyRegions, type FillOrder, type FillSettings, type MediaRef, type MusicTrack, type Project, type SongLike, type SongPrefs, type SoundRegion } from "./project";

/** A song as the library lists it: the file, its preferences and what it covers on the lanes. */
export interface LibrarySong {
  media: MediaRef;
  prefs: SongPrefs;
  /** Placements on the landscape lanes. */
  placements: number;
  /** Seconds of the video those placements cover (parts past the video's end left out). */
  seconds: number;
  /** The song opens the video / closes it. */
  first: boolean;
  last: boolean;
}

/** What the library says about each like level. */
export const LIKE_LABELS: Record<SongLike, string> = { 0: "Like it: placed about twice as often", 1: "Liked · placed about twice as often — click for a favourite, four times", 2: "Favourite · placed about four times as often — click to like it no more than the others" };

/** The least a song cut short before the closer or a music-free region still plays, seconds; a shorter piece is left out. */
const MIN_PIECE = 1;
/** The least a free stretch between music-free regions must span for a song to be placed in it, seconds. */
const MIN_SPAN = 3;

/** An audio file: it has a length and no picture (the logo has no length). */
export const isSong = (m: MediaRef) => m.duration > 0 && !m.width && !m.height;
export const songPrefs = (p: Project, id: string): SongPrefs => ({ ...DEFAULT_SONG_PREFS, ...(p.songs?.[id] ?? {}) });
export const fillSettings = (p: Project): FillSettings => ({ ...DEFAULT_FILL, ...(p.fill ?? {}) });
export const cycleLike = (like: SongLike): SongLike => ((like + 1) % 3) as SongLike;

/** Every song the project knows, in the order added, with its preferences and what it covers on the lanes. */
export function songLibrary(p: Project, timelineEnd = Infinity): LibrarySong[] {
  const fill = fillSettings(p);
  return Object.values(p.media)
    .filter(isSong)
    .map((media) => {
      const mine = p.music.filter((m) => m.media === media.id);
      return { media, prefs: songPrefs(p, media.id), placements: mine.length, seconds: mine.reduce((a, m) => a + Math.max(0, effectiveMusicEnd(m, timelineEnd) - m.start), 0), first: fill.first === media.id, last: fill.last === media.id };
    });
}

/** The songs the shuffle may place: in the library, ticked, with a length. */
export const fillPool = (p: Project): MediaRef[] => songLibrary(p).filter((s) => s.prefs.use && s.media.duration > 0).map((s) => s.media);

/** Seconds of the video that have music under them, the lanes together (overlaps counted once). */
export function coveredSeconds(music: MusicTrack[], timelineEnd: number): number {
  const spans = music
    .filter((m) => !m.muted && m.gainDb > -60)
    .map((m) => [Math.min(m.start, timelineEnd), effectiveMusicEnd(m, timelineEnd)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, from = 0, to = -1;
  for (const [a, b] of spans) {
    if (a > to) {
      if (to > from) total += to - from;
      from = a;
      to = b;
    } else to = Math.max(to, b);
  }
  if (to > from) total += to - from;
  return total;
}

/** Seconds of the video with no music under them outside the stretches kept free of music on purpose. */
export function silentSeconds(music: MusicTrack[], free: { from: number; to: number }[], timelineEnd: number): number {
  const spans = music
    .filter((m) => !m.muted && m.gainDb > -60)
    .map((m) => [Math.min(m.start, timelineEnd), effectiveMusicEnd(m, timelineEnd)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const gaps: [number, number][] = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (a > at) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < timelineEnd) gaps.push([at, timelineEnd]);
  let total = 0;
  for (const [a, b] of gaps) {
    let inFree = 0;
    for (const f of free) inFree += Math.max(0, Math.min(b, f.to) - Math.max(a, f.from));
    total += b - a - inFree;
  }
  return Math.max(0, total);
}
export const freeSeconds = (free: { from: number; to: number }[]) => free.reduce((a, f) => a + Math.max(0, f.to - f.from), 0);

/** The beats found for a song on any of its tracks — the landscape lanes first, then the shorts'. */
export function beatsOfSong(p: Project, mediaId: string): BeatGrid | null {
  const all = [...p.music, ...(p.shorts ?? []).flatMap((s) => s.music ?? [])];
  return all.find((m) => m.media === mediaId && m.beats)?.beats ?? null;
}

export const setSongPrefs = (p: Project, id: string, patch: Partial<SongPrefs>): Project => ({ ...p, songs: { ...(p.songs ?? {}), [id]: { ...songPrefs(p, id), ...patch } } });
export const setFill = (p: Project, patch: Partial<FillSettings>): Project => ({ ...p, fill: { ...fillSettings(p), ...patch } });
/** The lanes emptied; the songs stay in the library. */
export const clearLanes = (p: Project): Project => (p.music.length ? { ...p, music: [] } : p);

/** Songs taken out of the project: off the landscape lanes, out of every short, out of the library and its settings. */
export function removeSongs(p: Project, ids: string[]): Project {
  const gone = new Set(ids.filter((id) => p.media[id] && isSong(p.media[id])));
  if (!gone.size) return p;
  const fill = fillSettings(p);
  const shorts = p.shorts?.map((s) => (s.music?.some((m) => gone.has(m.media)) ? { ...s, music: s.music.filter((m) => !gone.has(m.media)) } : s));
  return {
    ...p,
    media: Object.fromEntries(Object.entries(p.media).filter(([id]) => !gone.has(id))),
    music: p.music.filter((m) => !gone.has(m.media)),
    ...(shorts ? { shorts } : {}),
    ...(p.songs ? { songs: Object.fromEntries(Object.entries(p.songs).filter(([id]) => !gone.has(id))) } : {}),
    ...(p.fill ? { fill: { ...fill, first: fill.first && gone.has(fill.first) ? null : fill.first, last: fill.last && gone.has(fill.last) ? null : fill.last } } : {}),
  };
}

/** A small deterministic generator for tests and repeatable shuffles (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OrderOptions {
  first: string | null;
  order: FillOrder;
  /** Placement weight by song id (LIKE_WEIGHTS of the like); 1 when missing. */
  weights?: Record<string, number>;
}

/**
 * The order songs come round in, endlessly: the opener first (even when it is not in the pool), then — shuffled — by
 * weight, a liked song about twice as often and a favourite four times, never the same song twice in a row and a
 * plain song not again until about half the others have played (a liked song waits half as long, a favourite hardly
 * at all); or, "listed", the pool in its order, turned so the opener leads. One song alone comes round and round.
 */
export function* songOrder(pool: MediaRef[], opts: OrderOptions, rng: () => number = Math.random): Generator<string, void, undefined> {
  const ids = pool.map((m) => m.id);
  if (opts.first) yield opts.first;
  if (!ids.length) return;
  if (opts.order === "listed") {
    const at = opts.first ? ids.indexOf(opts.first) : -1;
    const cycle = at >= 0 ? [...ids.slice(at + 1), ...ids.slice(0, at + 1)] : ids;
    for (;;) for (const id of cycle) yield id;
  }
  const weight = (id: string) => Math.max(0.01, opts.weights?.[id] ?? 1);
  const n = ids.length;
  const window = Math.min(n - 1, Math.floor(n / 2));
  const cooldown = (id: string) => Math.max(n > 1 ? 1 : 0, Math.floor(window / weight(id)));
  const history: string[] = opts.first ? [opts.first] : [];
  for (;;) {
    let candidates = ids.filter((id) => !history.slice(history.length - cooldown(id)).includes(id));
    if (!candidates.length) candidates = ids;
    const total = candidates.reduce((a, id) => a + weight(id), 0);
    let r = rng() * total, pick = candidates[candidates.length - 1];
    for (const id of candidates) {
      r -= weight(id);
      if (r < 0) {
        pick = id;
        break;
      }
    }
    history.push(pick);
    if (history.length > n) history.splice(0, history.length - n);
    yield pick;
  }
}

/** The track every placement of a song is modelled on: its first placement's trim, gain, fades and beats, else the mode's level with the stock fades. */
export function songTemplate(p: Project, song: MediaRef): Omit<MusicTrack, "id" | "start" | "lane"> {
  const prev = p.music.find((m) => m.media === song.id && musicLength(m) > 0) ?? (p.shorts ?? []).flatMap((s) => s.music ?? []).find((m) => m.media === song.id && m.beats);
  const beats = beatsOfSong(p, song.id);
  const base = prev && p.music.includes(prev) ? { in: prev.in, out: Math.min(prev.out, song.duration), gainDb: prev.gainDb, fadeIn: prev.fadeIn, fadeOut: prev.fadeOut } : { in: 0, out: song.duration, gainDb: soundLevels(p).music, fadeIn: 2, fadeOut: 3 };
  return { media: song.id, ...base, muted: false, keyframes: [], ...(beats ? { beats } : {}) };
}

export interface FillPlanOptions {
  timelineEnd: number;
  overlap: number;
  first: string | null;
  last: string | null;
  order: FillOrder;
  weights?: Record<string, number>;
  /** Stretches kept free of music (regions with the music off): songs stop at their edges and a fresh one starts after. */
  free?: { from: number; to: number }[];
}

/**
 * Songs laid end to end over the whole video, all on the first lane: the opener at the start, then the order's songs
 * each overlapping the one before by `overlap` seconds (never more than half a song) for the crossfade, until the
 * video is covered — the last one is cut at the end by playback as usual. With a closer, it sits so that it ends with
 * the video and the song before it is cut where the crossfade into it begins. Stretches kept free of music are left
 * empty: the song reaching one is cut at its edge, the next song in the order starts where that stretch ends, and the order
 * runs on across it so the weights and the no-repeat rule hold; a free stretch shorter than MIN_SPAN stays empty, and
 * a closer longer than the last stretch loses its head so it still ends with the video. Templates give each song its
 * trim, gain and fades. Empty when there is nothing to place.
 */
export function planFill(songs: Record<string, MediaRef>, templates: Record<string, Omit<MusicTrack, "id" | "start" | "lane">>, pool: MediaRef[], o: FillPlanOptions, rng: () => number = Math.random): MusicTrack[] {
  const end = o.timelineEnd;
  if (!(end > 0)) return [];
  const usable = (id: string | null) => (id && songs[id] && templates[id] && musicLength(templates[id] as MusicTrack) > 0 ? id : null);
  const first = usable(o.first), last = usable(o.last);
  const poolOk = pool.filter((m) => usable(m.id));
  if (!first && !last && !poolOk.length) return [];
  const ovOf = (t: Omit<MusicTrack, "id" | "start" | "lane">) => Math.min(Math.max(0, o.overlap), musicLength(t as MusicTrack) / 2);
  // The stretches to fill: the video less what is kept free of music; a sliver between two free stretches stays empty.
  const spans: { from: number; to: number }[] = [];
  let at = 0;
  for (const g of [...(o.free ?? [])].sort((a, b) => a.from - b.from)) {
    if (g.from > at) spans.push({ from: at, to: Math.min(g.from, end) });
    at = Math.max(at, g.to);
  }
  if (at < end) spans.push({ from: at, to: end });
  const fillable = spans.filter((s) => spans.length === 1 || s.to - s.from >= MIN_SPAN);
  if (!fillable.length) return [];
  const out: MusicTrack[] = [];
  const place = (id: string, start: number, inPoint?: number) => {
    const t = templates[id];
    const track: MusicTrack = { ...t, id: newId(), lane: 0, start, muted: false, keyframes: [], ...(inPoint !== undefined ? { in: inPoint } : {}) };
    out.push(track);
    return track;
  };
  // What runs past a limit is cut there; a sliver is left out instead. Returns how many tracks of the span remain.
  const cutBack = (limit: number, count: number) => {
    while (count > 0) {
      const tail = out[out.length - 1];
      if (tail.start + musicLength(tail) <= limit + 1e-6) break;
      const keep = limit - tail.start;
      if (keep >= MIN_PIECE) {
        out[out.length - 1] = { ...tail, out: tail.in + keep };
        break;
      }
      out.pop();
      count--;
    }
    return count;
  };
  const lastSpan = fillable[fillable.length - 1];
  // The closer's geometry in the last stretch: it ends with the video; a stretch too short for it takes its tail.
  const closerT = last ? templates[last] : null;
  const closerLen = closerT ? musicLength(closerT as MusicTrack) : 0;
  const closerStart = closerT ? Math.max(lastSpan.from, end - closerLen) : end;
  const closerIn = closerT ? closerT.in + (closerLen - (end - closerStart)) : 0;
  const closerOv = closerT ? Math.min(ovOf(closerT), (end - closerStart) / 2) : 0;
  const order = songOrder(poolOk, { first, order: o.order, weights: o.weights }, rng);
  for (const span of fillable) {
    const isLast = span === lastSpan;
    const target = isLast && closerT ? closerStart + closerOv : span.to;
    let covered = span.from, count = 0;
    // A last stretch the closer fills on its own (or all but a sliver of) takes no filler before it.
    const fillers = !(isLast && closerT) || target - span.from >= MIN_SPAN;
    for (let guard = 0; fillers && guard < 5000 && covered < target - 1e-6; guard++) {
      const next = order.next();
      if (next.done) break;
      const id = next.value;
      if (!usable(id)) continue;
      const t = templates[id];
      const start = count ? Math.max(span.from, covered - ovOf(t)) : span.from;
      if (count && start <= out[out.length - 1].start) break; // no room left at all
      place(id, start);
      count++;
      covered = start + musicLength(t as MusicTrack);
    }
    if (!closerT || !isLast) {
      // A song reaching a music-free region is cut at its edge; the last one may run past the end of the video, where
      // playback cuts it as usual.
      if (span.to < end - 1e-9) cutBack(span.to, count);
      continue;
    }
    // The song before the closer is cut where the crossfade into the closer begins; a sliver is left out instead.
    // The closer never follows itself: a filler of the same song right before it gives way to another song long enough.
    const prev = out[out.length - 1];
    if (count && prev.media === last && poolOk.length > 1) {
      const need = target - prev.start;
      const others = poolOk.filter((m) => m.id !== last && musicLength(templates[m.id] as MusicTrack) >= need);
      if (others.length) {
        const swap = others[Math.floor(rng() * others.length)];
        out[out.length - 1] = { ...templates[swap.id], id: newId(), lane: 0, start: prev.start, muted: false, keyframes: [] };
      }
    }
    count = cutBack(target, count);
    if (!count || closerStart > out[out.length - 1].start) place(last!, closerStart, closerIn > closerT.in + 1e-9 ? closerIn : undefined);
  }
  return out;
}

/** The project's lanes filled from its library and settings; `rng` seeds a repeatable order. Unchanged when nothing can be placed. */
export function fillProject(p: Project, timelineEnd: number, rng: () => number = Math.random): Project {
  const fill = fillSettings(p);
  const library = songLibrary(p);
  const songs = Object.fromEntries(library.map((s) => [s.media.id, s.media]));
  const templates = Object.fromEntries(library.map((s) => [s.media.id, songTemplate(p, s.media)]));
  const weights = Object.fromEntries(library.map((s) => [s.media.id, LIKE_WEIGHTS[s.prefs.like]]));
  const tracks = planFill(songs, templates, fillPool(p), { timelineEnd, overlap: fill.overlap, first: fill.first, last: fill.last, order: fill.order, weights, free: musicFreeSpans(p.regions, timelineEnd) }, rng);
  return tracks.length ? { ...p, music: tracks } : p;
}

/** One line about a fill: placements, songs, what opens and closes, the crossfade. */
export function describeFill(p: Project, timelineEnd: number): string {
  const fill = fillSettings(p);
  const distinct = new Set(p.music.map((m) => m.media)).size;
  const parts = [`${p.music.length} placement${p.music.length === 1 ? "" : "s"} from ${distinct} song${distinct === 1 ? "" : "s"} cover ${fmtTime(coveredSeconds(p.music, timelineEnd))} of ${fmtTime(timelineEnd)}`];
  const firstName = fill.first ? p.media[fill.first]?.name : null, lastName = fill.last ? p.media[fill.last]?.name : null;
  if (firstName) parts.push(`opens with ${firstName}`);
  if (lastName) parts.push(`closes with ${lastName}`);
  if (fill.overlap > 0) parts.push(`${fill.overlap} s crossfades`);
  const free = freeSeconds(musicFreeSpans(p.regions, timelineEnd));
  if (free > 0.5) parts.push(`${fmtTime(free)} kept free of music`);
  return parts.join(" · ");
}

/** The library's one-line summary for the Audio tab. */
export function describeLibrary(p: Project, timelineEnd: number): string {
  const library = songLibrary(p, timelineEnd);
  if (!library.length) return "no songs yet";
  const covered = coveredSeconds(p.music, timelineEnd);
  const free = musicFreeSpans(p.regions, timelineEnd);
  const gap = silentSeconds(p.music, free, timelineEnd);
  const kept = freeSeconds(free);
  const head = `${library.length} song${library.length === 1 ? "" : "s"} · ${p.music.length ? `${p.music.length} placement${p.music.length === 1 ? "" : "s"} cover ${fmtTime(covered)} of ${fmtTime(timelineEnd)}` : "nothing on the lanes"}`;
  return [head, ...(p.music.length && gap > 0.5 ? [`${fmtTime(gap)} without music`] : []), ...(p.music.length && kept > 0.5 ? [`${fmtTime(kept)} kept free of music`] : [])].join(" · ");
}

/* ------------------------------------------------------------- sound regions */

const dbText = (v: number) => (v <= -60 ? "off" : `${v > 0 ? "+" : ""}${v} dB`);
/** A region's mix in a few words: its preset's name, else the two levels. */
export function regionLabel(r: SoundRegion): string {
  const preset = regionPreset(r);
  if (preset) return REGION_PRESETS.find((p) => p.id === preset)!.name;
  const camera = r.camera === null ? "as the clips are" : dbText(r.camera), music = r.music === null ? "as placed" : dbText(r.music);
  return `video ${camera} · music ${music}`;
}
/** One line about the regions: how many, and the seconds under each kind of mix. */
export function describeRegions(p: Project, timelineEnd: number): string {
  const regions = tidyRegions(p.regions ?? [], timelineEnd);
  if (!regions.length) return "none yet";
  const by = new Map<string, number>();
  for (const r of regions) by.set(regionLabel(r), (by.get(regionLabel(r)) ?? 0) + (r.to - r.from));
  return [`${regions.length} region${regions.length === 1 ? "" : "s"}`, ...[...by.entries()].map(([label, s]) => `${fmtTime(s)} ${label.charAt(0).toLowerCase()}${label.slice(1)}`)].join(" · ");
}
