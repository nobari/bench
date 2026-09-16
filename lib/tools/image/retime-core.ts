/**
 * Pure maths for the slow-motion → real-time converter: the output frame
 * schedule, translation-only motion estimation and trajectory smoothing.
 * No browser APIs here so it can be unit-tested; `./retime.ts` does the
 * decoding, drawing and encoding.
 */

export interface FramePlan {
  /** Output frame count. */
  count: number;
  /** Output duration in seconds. */
  duration: number;
  /** Seconds of source time covered by one output frame. */
  sourceStep: number;
  /** Output frame k shows the source frame nearest to `k * sourceStep`. */
  sourceTime: (k: number) => number;
  /** Output presentation timestamp of frame k. */
  outputTime: (k: number) => number;
}

/**
 * Even retiming: every output frame samples the source at exactly the same
 * real-time interval, which is what keeps sped-up slow-motion judder-free.
 */
export function planFrames(sourceDuration: number, speed: number, outputFps: number): FramePlan {
  const duration = sourceDuration / speed;
  const count = Math.max(1, Math.round(duration * outputFps));
  const sourceStep = speed / outputFps;
  return {
    count,
    duration,
    sourceStep,
    sourceTime: (k) => k * sourceStep,
    outputTime: (k) => k / outputFps,
  };
}

/** Sensible output frame-rate choices for a given source rate × speed. */
export function outputFpsChoices(sourceFps: number, speed: number): number[] {
  const real = sourceFps * speed;
  const set = new Set<number>([24, 25, 30, 50, 60, 120].filter((f) => f <= real + 0.01));
  if (real <= 120.01) set.add(Math.round(real * 100) / 100);
  return [...set].sort((a, b) => a - b);
}

/* ---------------------------------------------------------- motion estimate */

/** Sum of absolute differences between `a` and `b` shifted by (dx, dy), over the overlap minus a border. */
function sad(a: Float32Array, b: Float32Array, w: number, h: number, dx: number, dy: number, border: number): number {
  let sum = 0;
  let n = 0;
  const y0 = border + Math.max(0, -dy), y1 = h - border - Math.max(0, dy);
  const x0 = border + Math.max(0, -dx), x1 = w - border - Math.max(0, dx);
  for (let y = y0; y < y1; y += 1) {
    const ra = y * w, rb = (y + dy) * w + dx;
    for (let x = x0; x < x1; x += 1) {
      sum += Math.abs(a[ra + x] - b[rb + x]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

/** Box-downsample a grayscale image by 2. */
export function halve(src: Float32Array, w: number, h: number): { data: Float32Array; w: number; h: number } {
  const w2 = Math.floor(w / 2), h2 = Math.floor(h / 2);
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4;
    }
  return { data: out, w: w2, h: h2 };
}

export interface Shift {
  dx: number;
  dy: number;
  /** Matching quality: SAD at the best offset divided by SAD at zero (lower = confident). */
  confidence: number;
}

/**
 * Global translation that best maps `prev` onto `cur` (grayscale, row-major),
 * coarse-to-fine block matching. `radius` is the search range in pixels at
 * full analysis resolution.
 */
export function estimateShift(prev: Float32Array, cur: Float32Array, w: number, h: number, radius = 8): Shift {
  const p2 = halve(prev, w, h), c2 = halve(cur, w, h);
  const r2 = Math.ceil(radius / 2);
  let best = { dx: 0, dy: 0, s: Infinity };
  for (let dy = -r2; dy <= r2; dy++)
    for (let dx = -r2; dx <= r2; dx++) {
      const s = sad(p2.data, c2.data, p2.w, p2.h, dx, dy, r2);
      if (s < best.s) best = { dx, dy, s };
    }
  let fine = { dx: best.dx * 2, dy: best.dy * 2, s: Infinity };
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const s = sad(prev, cur, w, h, best.dx * 2 + dx, best.dy * 2 + dy, radius);
      if (s < fine.s) fine = { dx: best.dx * 2 + dx, dy: best.dy * 2 + dy, s };
    }
  const zero = sad(prev, cur, w, h, 0, 0, radius);
  return { dx: fine.dx, dy: fine.dy, confidence: zero > 0 ? fine.s / zero : 1 };
}

/* ------------------------------------------------------------- smoothing */

/** Cumulative camera path from per-frame shifts. */
export function trajectory(shifts: { dx: number; dy: number }[]): { x: number[]; y: number[] } {
  const x: number[] = [], y: number[] = [];
  let cx = 0, cy = 0;
  for (const s of shifts) {
    cx += s.dx;
    cy += s.dy;
    x.push(cx);
    y.push(cy);
  }
  return { x, y };
}

/** Gaussian-weighted moving average with the given half-window (frames). */
export function smooth(values: number[], halfWindow: number): number[] {
  if (halfWindow <= 0) return [...values];
  const sigma = halfWindow / 2;
  const weights: number[] = [];
  for (let k = -halfWindow; k <= halfWindow; k++) weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return values.map((_, i) => {
    let sum = 0, wsum = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const w = weights[k + halfWindow];
      sum += values[j] * w;
      wsum += w;
    }
    return wsum ? sum / wsum : values[i];
  });
}

/**
 * Per-frame corrections (smoothed path minus actual path), clamped to the
 * crop margin so the frame always covers the canvas.
 */
export function corrections(shifts: Shift[], halfWindow: number, maxShift: number): { x: number; y: number }[] {
  const safe = shifts.map((s) => (s.confidence > 0.85 ? { dx: 0, dy: 0 } : s)); // scene cut / no lock → don't chase
  const path = trajectory(safe);
  const sx = smooth(path.x, halfWindow), sy = smooth(path.y, halfWindow);
  const clamp = (v: number) => Math.max(-maxShift, Math.min(maxShift, v));
  return path.x.map((_, i) => ({ x: clamp(sx[i] - path.x[i]), y: clamp(sy[i] - path.y[i]) }));
}

/** Bytes-per-second target for H.264 at a given size and frame rate (~0.1 bit per pixel per frame). */
export function targetBitrate(width: number, height: number, fps: number, quality: "high" | "medium"): number {
  const bpp = quality === "high" ? 0.12 : 0.07;
  return Math.round(Math.min(80e6, Math.max(1.5e6, width * height * fps * bpp)));
}

/** Scale (w, h) so the longest side is at most `max` (0 = keep), keeping even dimensions. */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  let w = width, h = height;
  if (max > 0 && Math.max(w, h) > max) {
    const s = max / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  return { width: w - (w % 2), height: h - (h % 2) };
}
