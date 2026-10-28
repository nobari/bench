/**
 * The export frame and the window into the footage. A frame narrower than the recording — 9:16 cut from 16:9 — shows
 * a window of it: where the window sits in each clip and how far in it is can be set and moved over time (the
 * clip's reframe keys), and the layout says whether the window alone fills the frame, the whole picture sits in it
 * over a blurred copy, or the two share it. Pure maths on fractions and pixels; the engine draws from it.
 */

import { layoutSettings, MAX_REFRAME_ZOOM, type Clip, type ExportSettings, type Frame, type Layout, type ReframeKey, type Transform, FRAME_ASPECT } from "./project";

/** Even pixel counts, as encoders want. */
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The frame's width over its height: the recording's own for the source frame. */
export const frameAspect = (frame: Frame | undefined, srcW: number, srcH: number) => (frame && frame !== "source" ? FRAME_ASPECT[frame] : srcW / srcH);

/**
 * The export's size in pixels. The source frame scales the recording to the chosen height. The other frames name
 * their short side — 1080 is 1080×1920 at 9:16 — and "source" keeps the window's own pixels: the recording's full
 * height when the frame is narrower than it, its full width when wider. `maxHeight` caps the result (a preview).
 */
export function outputSize(srcW: number, srcH: number, s: Pick<ExportSettings, "resolution" | "frame">, maxHeight?: number): { width: number; height: number } {
  const frame = s.frame ?? "source";
  const srcAspect = srcW / srcH;
  const aspect = frameAspect(frame, srcW, srcH);
  let h: number;
  if (frame === "source") h = s.resolution === "source" ? srcH : s.resolution;
  else if (s.resolution === "source") h = aspect <= srcAspect ? srcH : srcW / aspect;
  else h = aspect < 1 ? s.resolution / aspect : s.resolution;
  if (maxHeight) h = Math.min(h, maxHeight);
  return { width: even(h * aspect), height: even(h) };
}

/** "1080×1920" for the summary lines. */
export const sizeText = (size: { width: number; height: number }) => `${size.width}×${size.height}`;

export const DEFAULT_KEY: ReframeKey = { t: 0, cx: 0.5, cy: 0.5, zoom: 1 };
const smooth = (x: number) => x * x * (3 - 2 * x);

/** The window's centre and zoom at a source instant: the keys eased between, held beyond the first and the last. */
export function reframeAt(keys: ReframeKey[] | undefined, t: number): ReframeKey {
  if (!keys?.length) return DEFAULT_KEY;
  const sorted = keys.length > 1 ? [...keys].sort((a, b) => a.t - b.t) : keys;
  if (t <= sorted[0].t) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last;
  let i = 1;
  while (sorted[i].t < t) i++;
  const a = sorted[i - 1], b = sorted[i];
  if (a.hold) return { t, cx: a.cx, cy: a.cy, zoom: a.zoom };
  const u = b.t > a.t ? smooth((t - a.t) / (b.t - a.t)) : 1;
  return { t, cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u, zoom: a.zoom + (b.zoom - a.zoom) * u };
}

/**
 * The crop a frame of this shape shows: a window of the clip's cropped picture with the frame's aspect, centred where
 * the key says and `zoom` times smaller than the largest window that fits, kept inside the picture. A quarter turn
 * swaps the window's sides, since the crop is taken before the rotation. Fractions of the source frame, as the grader
 * takes them.
 */
export function windowCrop(base: Transform["crop"], key: ReframeKey, outAspect: number, srcW: number, srcH: number, quarter: boolean): Transform["crop"] {
  const want = quarter ? 1 / outAspect : outAspect;
  const baseAspect = (srcW * base.w) / (srcH * base.h);
  let w = 1, h = 1;
  if (want < baseAspect) w = want / baseAspect;
  else h = baseAspect / want;
  const z = Math.min(MAX_REFRAME_ZOOM, Math.max(1, key.zoom || 1));
  w /= z;
  h /= z;
  const cx = Math.min(1 - w / 2, Math.max(w / 2, key.cx)), cy = Math.min(1 - h / 2, Math.max(h / 2, key.cy));
  return { x: base.x + base.w * (cx - w / 2), y: base.y + base.h * (cy - h / 2), w: base.w * w, h: base.h * h };
}

/** Whether a frame of this shape shows a window of the clip rather than its whole (cropped) picture. */
export const framed = (frame: Frame | undefined) => !!frame && frame !== "source";

/**
 * The clip's transform at a source instant for a frame of this shape: its own when the frame is the recording's and
 * nothing is reframed, else with the window crop in place of its crop.
 */
export function transformAt(clip: Pick<Clip, "transform" | "reframe">, sourceT: number, frame: Frame | undefined, outAspect: number, srcW: number, srcH: number): Transform {
  if (!framed(frame) && !clip.reframe?.keys.length) return clip.transform;
  const key = reframeAt(clip.reframe?.keys, sourceT);
  const quarter = clip.transform.rotate % 2 === 1;
  return { ...clip.transform, crop: windowCrop(clip.transform.crop, key, outAspect, srcW, srcH, quarter) };
}

/** The clip's whole (cropped) picture's width over its height in pixels, after its quarter turns. */
export function pictureAspect(transform: Transform, srcW: number, srcH: number): number {
  const a = (srcW * transform.crop.w) / (srcH * transform.crop.h);
  return transform.rotate % 2 === 1 ? 1 / a : a;
}

/** One region of the frame and what goes in it: the reframed window, or the whole picture fitted. */
export interface Pane {
  x: number;
  y: number;
  w: number;
  h: number;
  source: "window" | "whole";
  /** Blur radius in pixels and how dark it goes, for a blurred backdrop. */
  blur?: number;
  dim?: number;
}

/**
 * How a frame of this size is filled for a layout, as panes in drawing order. Fill: the window. Fit: the whole
 * picture fitted to the frame's width (or height, when it is the taller), over the window blurred and dimmed when the
 * background is blur. Stack: the whole picture along the top or bottom edge and the window in the rest; when nothing
 * is left over it falls back to fit.
 */
export function framePanes(layout: Layout | null | undefined, outW: number, outH: number, picAspect: number): Pane[] {
  const l = layoutSettings(layout);
  const full: Pane = { x: 0, y: 0, w: outW, h: outH, source: "window" };
  if (l.kind === "fill") return [full];
  const fitW = picAspect >= outW / outH ? outW : outH * picAspect, fitH = fitW / picAspect;
  const rest = outH - fitH;
  if (l.kind === "stack" && rest >= 2) {
    const wideTop = l.wideAt === "top";
    return [
      { x: 0, y: wideTop ? fitH : 0, w: outW, h: rest, source: "window" },
      { x: (outW - fitW) / 2, y: wideTop ? 0 : rest, w: fitW, h: fitH, source: "whole" },
    ];
  }
  const panes: Pane[] = [];
  if (l.background === "blur") panes.push({ ...full, blur: l.blur * outW, dim: l.dim });
  panes.push({ x: (outW - fitW) / 2, y: (outH - fitH) * Math.min(1, Math.max(0, l.position)), w: fitW, h: fitH, source: "whole" });
  return panes;
}

/** The plain colour behind the panes: nothing when the window fills the frame or the backdrop is the blurred window. */
export function layoutBackdrop(layout: Layout | null | undefined): string | null {
  const l = layoutSettings(layout);
  if (l.kind === "fill" || (l.kind === "fit" && l.background === "blur")) return null;
  return l.background === "colour" ? l.colour : "#000000";
}
