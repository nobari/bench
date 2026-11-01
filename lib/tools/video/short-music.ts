/**
 * Music per short (Short mode): each short carries its own tracks, timed from its own start, apart from the landscape
 * lanes — a song chosen for one short never touches the landscape edit or another short. Pure helpers: the songs a
 * project knows, the track a song makes for a short, slipping it to another part of the song, trimming it on the
 * timeline, carrying one song through a series of shorts, and the tracks placed on the timeline for the preview and
 * the beat tools. Nothing here imports short-mode.ts, which imports this.
 */
import { musicLength, newId, type MediaRef, type MusicTrack, type Short } from "./project";

/** What a short's song starts with: straight in with a touch of fade so it never clicks, out over the last moment. */
export const SHORT_FADE_IN = 0.1;
export const SHORT_FADE_OUT = 0.8;
/** The least of a song a track keeps when slipped or trimmed, seconds. */
const MIN_USE = 0.5;
/** A carried-on song starts over when less than this much of it is left (or half of a very short song). */
export const CARRY_MIN_LEFT = 5;

const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
const lenOf = (s: Pick<Short, "from" | "to">) => Math.max(0, s.to - s.from);

/** The songs a project knows — audio files added anywhere, on the landscape lanes or in any short; never a recording or the logo. By name. */
export function songsOf(media: Record<string, MediaRef>): MediaRef[] {
  return Object.values(media)
    .filter((m) => m.duration > 0 && !m.width && !m.height)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The short's own tracks, each cut to its song's length when the file is known (a track may name an out past it), in lane order. */
export function shortMusicOf(short: Pick<Short, "music">, media?: Record<string, MediaRef>): MusicTrack[] {
  return (short.music ?? [])
    .map((m) => {
      const len = media?.[m.media]?.duration;
      return len && m.out > len ? { ...m, out: len } : m;
    })
    .filter((m) => m.out > m.in);
}

/** A track for one song in a short: from `inPoint` of the song, at the short's start, open to the song's end (the short's own end cuts it). */
export function songTrack(song: MediaRef, inPoint: number, like: Pick<MusicTrack, "gainDb" | "fadeIn" | "fadeOut" | "muted"> & { beats?: MusicTrack["beats"] }): MusicTrack {
  const inn = r3(Math.max(0, Math.min(inPoint, Math.max(0, song.duration - MIN_USE))));
  return { id: newId(), media: song.id, lane: 0, start: 0, in: inn, out: song.duration, gainDb: like.gainDb, muted: like.muted, fadeIn: like.fadeIn, fadeOut: like.fadeOut, keyframes: [], ...(like.beats ? { beats: like.beats } : {}) };
}

/** Seconds of the song a short plays from a track: from its in-point to its out or the short's end, whichever comes first. */
export const usedSeconds = (track: MusicTrack, shortLen: number) => Math.max(0, Math.min(musicLength(track), shortLen - track.start));

/** How long before the short's end the music stops — 0 when it plays to the end. */
export const silentTail = (track: MusicTrack, shortLen: number) => Math.max(0, shortLen - (track.start + musicLength(track)));

/**
 * The track slid to another part of the song: the in-point moves, what is heard stays as long, and a track open to
 * the song's end stays open (so a short that grows later keeps being covered). Volume keyframes stay where they are on
 * the timeline.
 */
export function slipTrack(track: MusicTrack, inPoint: number, songLen: number): MusicTrack {
  const open = track.out >= songLen - 1e-3;
  const len = musicLength(track);
  const inn = r3(Math.max(0, Math.min(inPoint, Math.max(0, songLen - Math.min(len, MIN_USE)))));
  const out = r3(open ? songLen : Math.min(songLen, inn + len));
  return inn === track.in && out === track.out ? track : { ...track, in: inn, out };
}

/**
 * The track's head moved to `start` seconds into the short: the song's content stays where it was on the timeline, so
 * what plays at any moment does not change — only where the music begins. Neither end of the song nor of the short
 * is passed, and at least half a second of the song stays.
 */
export function trimTrackStart(track: MusicTrack, start: number, shortLen: number): MusicTrack {
  const want = start - track.start;
  const d = Math.max(-track.in, -track.start, Math.min(want, track.out - MIN_USE - track.in, shortLen - MIN_USE - track.start));
  if (Math.abs(d) < 1e-6) return track;
  return { ...track, start: r3(track.start + d), in: r3(track.in + d), keyframes: track.keyframes.map((k) => ({ ...k, t: k.t - d })).filter((k) => k.t >= 0) };
}

/** The track's tail set at `end` seconds into the short; at the short's end (or past it) the track opens to the song's end again. */
export function trimTrackEnd(track: MusicTrack, end: number, shortLen: number, songLen: number): MusicTrack {
  if (end >= shortLen - 1e-3) return track.out === songLen ? track : { ...track, out: songLen };
  const out = r3(Math.max(track.in + MIN_USE, Math.min(songLen, track.in + (end - track.start))));
  return out === track.out ? track : { ...track, out };
}

/**
 * The track a following short takes to carry a song on: the same song, from where the previous short's playing of it
 * stopped, with the same gain and fades; from the song's start again when too little of it is left.
 */
export function continueTrack(prev: MusicTrack, prevShortLen: number, songLen: number): MusicTrack {
  const next = prev.in + usedSeconds(prev, prevShortLen);
  const left = songLen - next;
  const inn = left < Math.min(CARRY_MIN_LEFT, songLen / 2) ? 0 : next;
  return { ...prev, id: newId(), start: 0, in: r3(inn), out: songLen, keyframes: [] };
}

/** The music a new short starts with: the song of the last short that has one, carried on from where it stopped; none when no short has music. */
export function musicForNewShort(shorts: Short[], media: Record<string, MediaRef>): MusicTrack[] {
  for (let i = shorts.length - 1; i >= 0; i--) {
    const s = shorts[i];
    const t = shortMusicOf(s, media)[0];
    const song = t ? media[t.media] : undefined;
    if (t && song) return [continueTrack(t, lenOf(s), song.duration)];
  }
  return [];
}

/** From the short on, in list order, every later short takes up its song where the one before it stopped. */
export function carryThrough(shorts: Short[], fromId: string, media: Record<string, MediaRef>): Short[] {
  const i = shorts.findIndex((s) => s.id === fromId);
  if (i < 0) return shorts;
  let prev = shorts[i];
  let prevTrack = shortMusicOf(prev, media)[0];
  const song = prevTrack ? media[prevTrack.media] : undefined;
  if (!prevTrack || !song) return shorts;
  return shorts.map((s, j) => {
    if (j <= i) return s;
    const t = continueTrack(prevTrack, lenOf(prev), song.duration);
    prev = s;
    prevTrack = t;
    return { ...s, music: [t] };
  });
}

/** Every other short takes this short's song as it is set here — the same part of it, gain and fades. */
export function spreadToAll(shorts: Short[], fromId: string): Short[] {
  const t = shorts.find((s) => s.id === fromId)?.music?.[0];
  if (!t) return shorts;
  return shorts.map((s) => (s.id === fromId ? s : { ...s, music: [{ ...t, id: newId(), start: Math.min(t.start, Math.max(0, lenOf(s) - MIN_USE)), keyframes: [] }] }));
}

/** The short's tracks as they sit on the timeline (the short's start added), for the preview and the beat tools. */
export const placeShortMusic = (short: Short, media?: Record<string, MediaRef>): MusicTrack[] => shortMusicOf(short, media).map((m) => ({ ...m, start: short.from + m.start }));

const clock = (s: number) => {
  const v = Math.max(0, s);
  const m = Math.floor(v / 60), sec = v - m * 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec.toFixed(1)}`;
};

/** One line about a short's music: where in the song it starts, how much of it plays, and whether it reaches the short's end. */
export function describeShortMusic(track: MusicTrack, song: MediaRef | undefined, shortLen: number): string {
  const songLen = song?.duration ?? track.out;
  const used = usedSeconds(track, shortLen);
  const tail = silentTail(track, shortLen);
  const head = track.start > 0.05 ? `from ${clock(track.start)} into the short, ` : "";
  const where = track.in > 0.05 ? `${clock(track.in)} into the song` : "the song's start";
  const end = tail > 0.05 ? `the music stops ${clock(tail)} before the short ends` : "to the short's end";
  return `${head}${where} · ${clock(used)} of ${clock(songLen)} · ${end}`;
}
