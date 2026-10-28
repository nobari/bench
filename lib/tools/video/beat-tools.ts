/**
 * Beat tools for shorts: the music's beats on the timeline, the nearest beat to snap to, cuts on the beat, punch-ins
 * on the beat, and a stretch slowed down. Pure on the project's clips and music.
 */
import { clipSpeed, placeClips, sourceTimeAt, splitClip, type Clip, type MusicTrack } from "./project";
import { reframeAt } from "./reframe";
import { setKey } from "./window-keys";

/** The beats (or the downbeats) of every analysed track as timeline instants inside the timeline, in order, no doubles. */
export function timelineBeats(music: MusicTrack[], duration: number, down = false): number[] {
  const out: number[] = [];
  for (const m of music) {
    const g = m.beats;
    if (!g || m.muted) continue;
    g.beats.forEach((b, i) => {
      if (down && i % 4 !== g.downbeatPhase) return;
      if (b < m.in - 1e-6 || b > m.out + 1e-6) return;
      const t = m.start + (b - m.in);
      if (t >= 0 && t <= duration + 1e-6) out.push(Math.round(t * 1e3) / 1e3);
    });
  }
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t - out[i - 1] > 0.02);
}

/** Seconds per beat of the first analysed track, or null. */
export function beatPeriod(music: MusicTrack[]): number | null {
  const g = music.find((m) => m.beats && m.beats.bpm > 0)?.beats;
  return g ? 60 / g.bpm : null;
}

/** The beat nearest an instant when it is within reach, else null. */
export function nearestBeat(beats: number[], t: number, within: number): number | null {
  let best: number | null = null;
  for (const b of beats) if (Math.abs(b - t) <= within && (best === null || Math.abs(b - t) < Math.abs(best - t))) best = b;
  return best;
}

/** The beats strictly inside a span, every n-th from the first. */
export const beatsWithin = (beats: number[], from: number, to: number, every = 1) => beats.filter((b) => b > from + 0.05 && b < to - 0.05).filter((_, i) => i % Math.max(1, every) === 0);

/** The clips split on every chosen beat inside the span: a cut on each, nothing else changed. */
export function cutToBeats(clips: Clip[], beats: number[], from: number, to: number, every = 1): { clips: Clip[]; cuts: number } {
  let out = clips;
  let cuts = 0;
  for (const b of beatsWithin(beats, from, to, every)) {
    const under = placeClips(out).find((c) => b > c.start + 0.01 && b < c.end - 0.01);
    if (!under) continue;
    const next = splitClip(out, under.id, b);
    if (next !== out) cuts++;
    out = next;
  }
  return { clips: out, cuts };
}

/**
 * A small zoom on each chosen beat: the window keys jump to `zoom` times its zoom at the beat and ease back over a
 * third of a beat (the beat's length from `period`), on whichever clip the beat falls in.
 */
export function punchIns(clips: Clip[], beats: number[], from: number, to: number, every: number, period: number, zoom = 1.08): { clips: Clip[]; punches: number } {
  const placed = placeClips(clips);
  const patches = new Map<string, Clip["reframe"]>();
  let punches = 0;
  for (const b of beatsWithin(beats, from, to, every)) {
    const c = placed.find((x) => b >= x.start && b < x.end);
    if (!c) continue;
    const speed = clipSpeed(c);
    const s = sourceTimeAt(c, b);
    const back = Math.min(c.out, s + period * 0.33 * speed);
    let keys = patches.get(c.id)?.keys ?? c.reframe?.keys ?? [];
    const base = reframeAt(keys, s);
    const before = reframeAt(keys, Math.max(c.in, s - 0.04 * speed));
    keys = setKey(keys, { t: Math.max(c.in, s - 0.04 * speed), cx: before.cx, cy: before.cy, zoom: before.zoom, hold: true });
    keys = setKey(keys, { t: s, cx: base.cx, cy: base.cy, zoom: Math.min(4, base.zoom * zoom) });
    keys = setKey(keys, { t: back, cx: base.cx, cy: base.cy, zoom: base.zoom });
    patches.set(c.id, { keys });
    punches++;
  }
  return { clips: clips.map((c) => (patches.has(c.id) ? { ...c, reframe: patches.get(c.id) } : c)), punches };
}

/** The stretch between two instants cut out as its own clips and slowed (or sped) to `speed`; `added` is how much longer the timeline gets. */
export function slowStretch(clips: Clip[], from: number, to: number, speed: number): { clips: Clip[]; added: number } {
  let out = clips;
  for (const t of [from, to]) {
    const under = placeClips(out).find((c) => t > c.start + 0.01 && t < c.end - 0.01);
    if (under) out = splitClip(out, under.id, t);
  }
  const placed = placeClips(out);
  const ids = new Set(placed.filter((c) => c.start >= from - 0.02 && c.end <= to + 0.02).map((c) => c.id));
  if (!ids.size) return { clips, added: 0 };
  let added = 0;
  const next = out.map((c) => {
    if (!ids.has(c.id)) return c;
    const len = (c.out - c.in) / clipSpeed(c);
    added += (c.out - c.in) / speed - len;
    return { ...c, speed };
  });
  return { clips: next, added: Math.round(added * 1e3) / 1e3 };
}
