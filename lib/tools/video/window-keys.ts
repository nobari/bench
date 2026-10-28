/**
 * The window keys of a clip, edited frame by frame: a key is where the vertical frame's window sits at a source
 * instant (centre and zoom), the window eases between keys or holds. Pure helpers for the editor's keys lane, the
 * drag on the preview, the sliders, Smooth, Thin and the tracking assists that write many keys at once.
 */
import { MAX_REFRAME_ZOOM, type ReframeKey, type Transform } from "./project";
import { reframeAt, windowCrop } from "./reframe";

/** Two keys closer than this in source seconds are the same key (half a frame at 60 fps). */
export const KEY_TOLERANCE = 1 / 120;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampZoom = (z: number) => Math.min(MAX_REFRAME_ZOOM, Math.max(1, z));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

export const sortKeys = (keys: ReframeKey[]) => [...keys].sort((a, b) => a.t - b.t);
export const cleanKey = (k: ReframeKey): ReframeKey => ({ t: round(k.t), cx: round(clamp01(k.cx)), cy: round(clamp01(k.cy)), zoom: round(clampZoom(k.zoom)), ...(k.hold ? { hold: true } : {}) });

/** The index of the key at a source instant, or -1. */
export function keyIndexAt(keys: ReframeKey[] | undefined, t: number, tolerance = KEY_TOLERANCE): number {
  if (!keys) return -1;
  return keys.findIndex((k) => Math.abs(k.t - t) <= tolerance);
}

/** The keys with this one in place: the key at its instant replaced, or the new one in its place in time order. */
export function setKey(keys: ReframeKey[] | undefined, key: ReframeKey): ReframeKey[] {
  const next = (keys ?? []).filter((k) => Math.abs(k.t - key.t) > KEY_TOLERANCE);
  next.push(cleanKey(key));
  return sortKeys(next);
}

export function removeKeyAt(keys: ReframeKey[] | undefined, t: number): ReframeKey[] {
  return (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_TOLERANCE);
}

/** The window at a source instant as a key there: what Key here writes, the eased window made explicit. */
export function keyFor(keys: ReframeKey[] | undefined, t: number): ReframeKey {
  const i = keyIndexAt(keys, t);
  if (keys && i >= 0) return cleanKey(keys[i]);
  const w = reframeAt(keys, t);
  return cleanKey({ t, cx: w.cx, cy: w.cy, zoom: w.zoom });
}

/** The nearest key strictly before (-1) or after (+1) an instant, or null. */
export function keyAround(keys: ReframeKey[] | undefined, t: number, dir: -1 | 1): ReframeKey | null {
  if (!keys?.length) return null;
  const sorted = sortKeys(keys);
  if (dir < 0) return [...sorted].reverse().find((k) => k.t < t - KEY_TOLERANCE) ?? null;
  return sorted.find((k) => k.t > t + KEY_TOLERANCE) ?? null;
}

/** The window moved by a fraction of the picture, kept inside it (the crop clamps it again by the window's size). */
export const movedKey = (key: ReframeKey, dx: number, dy: number): ReframeKey => cleanKey({ ...key, cx: key.cx + dx, cy: key.cy + dy });
/** The window zoomed by a factor around its centre, between 1× and the ceiling. */
export const zoomedKey = (key: ReframeKey, factor: number): ReframeKey => cleanKey({ ...key, zoom: key.zoom * factor });

/**
 * The keys smoothed: each middle key's centre and zoom become the 1-2-1 average with its neighbours, the first and
 * last stay, holds stay. One pass per call.
 */
export function smoothKeys(keys: ReframeKey[], passes = 1): ReframeKey[] {
  let out = sortKeys(keys);
  for (let p = 0; p < passes; p++) {
    if (out.length < 3) return out;
    out = out.map((k, i, all) => {
      if (i === 0 || i === all.length - 1) return k;
      const a = all[i - 1], b = all[i + 1];
      return cleanKey({ ...k, cx: (a.cx + 2 * k.cx + b.cx) / 4, cy: (a.cy + 2 * k.cy + b.cy) / 4, zoom: (a.zoom + 2 * k.zoom + b.zoom) / 4 });
    });
  }
  return out;
}

/**
 * The keys with the ones the eased path already passes dropped: a middle key goes when, without it, the window at
 * its instant is within `epsilon` of it (zoom counted at a quarter). Keeps a track's shape with far fewer keys.
 */
export function thinKeys(keys: ReframeKey[], epsilon = 0.01): ReframeKey[] {
  let out = sortKeys(keys);
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i].hold || out[i - 1].hold) continue;
      const without = [...out.slice(0, i), ...out.slice(i + 1)];
      const w = reframeAt(without, out[i].t);
      if (Math.abs(w.cx - out[i].cx) <= epsilon && Math.abs(w.cy - out[i].cy) <= epsilon && Math.abs(w.zoom - out[i].zoom) <= epsilon * 4) {
        out = without;
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Keys from a track's samples (fractions of the picture), at one zoom; a missing cy keeps the picture's middle. */
export function keysFromSamples(samples: { t: number; cx: number; cy?: number }[], zoom = 1): ReframeKey[] {
  return sortKeys(samples.map((s) => cleanKey({ t: s.t, cx: s.cx, cy: s.cy ?? 0.5, zoom })));
}

/** The keys of one clip carried to another: the same windows at the same offsets from each clip's in-point. */
export function carryKeys(keys: ReframeKey[], fromIn: number, toIn: number, toOut: number): ReframeKey[] {
  return sortKeys(keys.map((k) => cleanKey({ ...k, t: toIn + (k.t - fromIn) }))).filter((k) => k.t <= toOut + KEY_TOLERANCE);
}

/**
 * Where the window sits on the clip's own (cropped) picture — the picture the whole-picture view shows — as
 * fractions of it: x, y, w, h. A quarter-turned clip shows its window transposed, since the crop is taken before
 * the turn.
 */
export function windowInPicture(base: Transform["crop"], key: ReframeKey, outAspect: number, srcW: number, srcH: number, quarter: boolean): { x: number; y: number; w: number; h: number } {
  const c = windowCrop(base, key, outAspect, srcW, srcH, quarter);
  const r = { x: (c.x - base.x) / base.w, y: (c.y - base.y) / base.h, w: c.w / base.w, h: c.h / base.h };
  return quarter ? { x: r.y, y: r.x, w: r.h, h: r.w } : r;
}

/** "3 keys · 2.1–6.4 s" or "1 key" or "no keys". */
export function describeKeys(keys: ReframeKey[] | undefined): string {
  if (!keys?.length) return "no keys";
  if (keys.length === 1) return `1 key${keys[0].hold ? " (held)" : ""}`;
  const sorted = sortKeys(keys);
  return `${keys.length} keys · ${sorted[0].t.toFixed(1)}–${sorted[sorted.length - 1].t.toFixed(1)} s`;
}
