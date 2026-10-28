/**
 * Beats in a music track, from its samples alone: an onset envelope from spectral flux (what rises in each frame's
 * spectrum, the low bands counted most for the kick), the tempo from the envelope's autocorrelation between 60 and
 * 200 BPM with a gentle preference for the range most music sits in, the beat grid phased to the onsets and snapped
 * to them beat by beat, the downbeats every four, and the drop — where the track builds the most. Pure arithmetic on
 * mono PCM; the engine decodes the file (see decodeMono). Cutting a short on the grid is here too.
 */

export interface BeatGrid {
  bpm: number;
  /** Beat instants in track seconds. */
  beats: number[];
  /** Which beat index is the first downbeat (0–3); downbeats are every fourth from there. */
  downbeatPhase: number;
  /** Where the track builds the most, in track seconds; null when it never does. */
  drop: number | null;
  /** How clear the tempo is, 0–1. */
  confidence: number;
  /** The onset strength every `step` seconds, 0–1, for drawing. */
  strength: number[];
  step: number;
  /** The track's length in seconds. */
  seconds: number;
}

export const MIN_BPM = 60, MAX_BPM = 200;
const FRAME = 2048, HOP = 512;

/** In-place iterative radix-2 FFT; `re` and `im` are the same power-of-two length. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Onset strength per hop: the positive change of each spectral bin's log magnitude from the frame before, low bins
 * doubled, with the local mean over about a second taken away so only what stands out is left. Also the frame
 * energy, for the drop.
 */
export function onsetEnvelope(pcm: Float32Array, sampleRate: number): { onsets: Float32Array; energy: Float32Array; hopSeconds: number } {
  const frames = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1);
  const onsets = new Float32Array(frames), energy = new Float32Array(frames);
  if (!frames) return { onsets, energy, hopSeconds: HOP / sampleRate };
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const re = new Float32Array(FRAME), im = new Float32Array(FRAME);
  const bins = FRAME / 2;
  const lowBins = Math.max(2, Math.round((250 / sampleRate) * FRAME));
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = pcm[at + i];
      re[i] = v * window[i];
      im[i] = 0;
      e += v * v;
    }
    energy[f] = Math.sqrt(e / FRAME);
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) flux += k < lowBins ? 2 * d : d;
    }
    // The first frame has no spectrum before it, so its whole spectrum would read as one huge onset.
    onsets[f] = f > 1 ? flux : 0;
    const t = prev;
    prev = cur;
    cur = t;
  }
  // Take away the local mean (about a second each side) so a steady loud passage does not read as onsets throughout.
  const half = Math.round(sampleRate / HOP / 2);
  const out = new Float32Array(frames);
  let acc = 0, lo = 0, hi = -1;
  for (let f = 0; f < frames; f++) {
    while (hi < Math.min(frames - 1, f + half)) acc += onsets[++hi];
    while (lo < f - half) acc -= onsets[lo++];
    const mean = acc / (hi - lo + 1);
    out[f] = Math.max(0, onsets[f] - mean);
  }
  // Scaled so the strong onsets sit near 1 — by the 99th percentile, not the single loudest frame.
  const sorted = Float32Array.from(out).sort();
  const scale = sorted[Math.min(frames - 1, Math.floor(frames * 0.99))] || sorted[frames - 1] || 0;
  if (scale > 0) for (let f = 0; f < frames; f++) out[f] = Math.min(1, out[f] / scale);
  return { onsets: out, energy, hopSeconds: HOP / sampleRate };
}

/** The tempo: the autocorrelation lag between 60 and 200 BPM that scores highest, with a mild preference around 120 BPM, refined between frames. */
export function estimateTempo(onsets: Float32Array, hopSeconds: number): { bpm: number; periodFrames: number; confidence: number } {
  const n = onsets.length;
  const minLag = Math.max(1, Math.floor(60 / MAX_BPM / hopSeconds)), maxLag = Math.min(n - 1, Math.ceil(60 / MIN_BPM / hopSeconds));
  if (n < 4 || maxLag <= minLag) return { bpm: 0, periodFrames: 0, confidence: 0 };
  const acf = new Float64Array(maxLag + 2);
  let total = 0;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    if (lag < 1 || lag >= n) continue;
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onsets[i] * onsets[i + lag];
    acf[lag] = s / (n - lag);
    total += acf[lag];
  }
  const prior = (lag: number) => {
    const bpm = 60 / (lag * hopSeconds);
    const x = Math.log2(bpm / 120) / 0.7;
    return Math.exp(-0.5 * x * x);
  };
  let best = minLag, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = acf[lag] * (0.35 + 0.65 * prior(lag));
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement between neighbouring lags.
  const a = acf[best - 1] ?? acf[best], b = acf[best], c = acf[best + 1] ?? acf[best];
  const denom = a - 2 * b + c;
  const period = best + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0);
  const mean = total / Math.max(1, maxLag - minLag + 3);
  const confidence = mean > 0 ? Math.max(0, Math.min(1, (acf[best] - mean) / (acf[best] + mean))) : 0;
  return { bpm: 60 / (period * hopSeconds), periodFrames: period, confidence };
}

/**
 * The beat grid: the phase along the first half minute where the onsets line up best with the period, then beat
 * after beat from there, each snapped to the strongest onset within a sixth of a beat so small drifts are followed.
 */
export function trackBeats(onsets: Float32Array, periodFrames: number): number[] {
  const n = onsets.length;
  if (!n || periodFrames < 2) return [];
  const span = Math.min(n, Math.round(periodFrames * 64));
  let bestPhase = 0, bestScore = -1;
  const steps = Math.max(8, Math.round(periodFrames));
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * periodFrames;
    let score = 0;
    for (let t = phase; t < span; t += periodFrames) score += onsets[Math.round(t)] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  const beats: number[] = [];
  const win = Math.max(1, Math.round(periodFrames / 6));
  let t = bestPhase;
  while (t < n - 1) {
    const centre = Math.round(t);
    let at = centre, peak = -1;
    for (let k = Math.max(0, centre - win); k <= Math.min(n - 1, centre + win); k++)
      if (onsets[k] > peak) {
        peak = onsets[k];
        at = k;
      }
    // Only a clear onset pulls the beat off the grid; silence keeps the clock.
    const snapped = peak > 0.15 ? at : centre;
    beats.push(snapped);
    t = snapped + periodFrames;
  }
  return beats;
}

/** Which of the four phases carries the loudest beats (the frame energy around each beat): the downbeats. */
export function downbeatPhase(energy: Float32Array, beatFrames: number[]): number {
  const around = (f: number) => {
    let m = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(energy.length - 1, f + 2); k++) m = Math.max(m, energy[k]);
    return m;
  };
  let best = 0, bestMean = -1;
  for (let q = 0; q < 4; q++) {
    let s = 0, c = 0;
    for (let i = q; i < beatFrames.length; i += 4) {
      s += around(beatFrames[i]);
      c++;
    }
    const mean = c ? s / c : 0;
    if (mean > bestMean) {
      bestMean = mean;
      best = q;
    }
  }
  return best;
}

/** Where the track builds the most: the moment the next two seconds are loudest against the four before, when that is a real rise. */
export function findDrop(energy: Float32Array, hopSeconds: number): number | null {
  const n = energy.length;
  const before = Math.round(4 / hopSeconds), after = Math.round(2 / hopSeconds);
  if (n < before + after + 2) return null;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + energy[i];
  const mean = (a: number, b: number) => (prefix[b] - prefix[a]) / Math.max(1, b - a);
  let best = -1, bestRatio = 0;
  for (let t = before; t + after <= n; t++) {
    const pre = mean(t - before, t), post = mean(t, t + after);
    const ratio = post / (pre + 1e-6);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = t;
    }
  }
  return best >= 0 && bestRatio >= 1.6 ? best * hopSeconds : null;
}

/** The whole analysis of a track's mono samples. */
export function analyseBeats(pcm: Float32Array, sampleRate: number): BeatGrid {
  const seconds = pcm.length / sampleRate;
  const { onsets, energy, hopSeconds } = onsetEnvelope(pcm, sampleRate);
  const tempo = estimateTempo(onsets, hopSeconds);
  const beatFrames = tempo.periodFrames ? trackBeats(onsets, tempo.periodFrames) : [];
  // The strength for drawing: about every tenth of a second, a whole number of hops.
  const per = Math.max(1, Math.round(0.1 / hopSeconds));
  const step = +(per * hopSeconds).toFixed(5);
  const strength: number[] = [];
  for (let f = 0; f < onsets.length; f += per) {
    let m = 0;
    for (let k = f; k < Math.min(onsets.length, f + per); k++) m = Math.max(m, onsets[k]);
    strength.push(+m.toFixed(3));
  }
  // A frame answers for the sound at its centre: the window peaks on an attack when it sits in the middle.
  const centre = FRAME / 2 / sampleRate;
  const drop = findDrop(energy, hopSeconds);
  return {
    bpm: +tempo.bpm.toFixed(1),
    beats: beatFrames.map((f) => +(f * hopSeconds + centre).toFixed(3)),
    downbeatPhase: downbeatPhase(energy, beatFrames),
    drop: drop === null ? null : +(drop + centre).toFixed(3),
    confidence: +tempo.confidence.toFixed(3),
    strength,
    step,
    seconds,
  };
}

/** The downbeats (every fourth beat from the phase), in track seconds. */
export const downbeats = (g: BeatGrid) => g.beats.filter((_, i) => i % 4 === g.downbeatPhase);

/** The first beat at or after a track instant, preferring a downbeat when `down` is set. */
export function beatAtOrAfter(g: BeatGrid, t: number, down = false): number | null {
  const list = down ? downbeats(g) : g.beats;
  return list.find((b) => b >= t - 1e-3) ?? null;
}

export type BeatsPerCut = 1 | 2 | 4 | "mixed";
export const BEATS_PER_CUT: BeatsPerCut[] = [1, 2, 4, "mixed"];
/** The mixed pattern: two bars of twos, a bar of ones, then a long one, and round again. */
const MIXED = [2, 2, 1, 1, 4];

/**
 * Scene lengths that land every cut on a beat, starting from the beat the music begins on (`musicIn`, track seconds)
 * and covering `seconds` of timeline: each scene spans `perCut` beats (or the mixed pattern), and the last one is
 * trimmed to the length. Without a grid the scenes are even.
 */
export function cutDurations(grid: BeatGrid | null | undefined, musicIn: number, seconds: number, perCut: BeatsPerCut, sceneSeconds = 2.5): number[] {
  if (seconds <= 0) return [];
  if (!grid || grid.beats.length < 2) {
    const n = Math.max(1, Math.round(seconds / Math.max(0.4, sceneSeconds)));
    return new Array(n).fill(seconds / n);
  }
  const start = grid.beats.findIndex((b) => b >= musicIn - 1e-3);
  const beats = start >= 0 ? grid.beats.slice(start) : [];
  const period = 60 / Math.max(1, grid.bpm);
  const out: number[] = [];
  let i = 0, at = 0, k = 0;
  while (at < seconds - 1e-6) {
    const span = perCut === "mixed" ? MIXED[k++ % MIXED.length] : perCut;
    const from = beats[i] ?? musicIn + i * period, to = beats[i + span] ?? from + span * period;
    const d = Math.max(0.25, Math.min(to - from, seconds - at));
    out.push(+d.toFixed(3));
    at += d;
    i += span;
  }
  return out;
}

/** Where a track should start (its `in`) so a downbeat, or the drop, lands at a timeline instant. */
export function musicInFor(grid: BeatGrid | null | undefined, at: "downbeat" | "drop", target: number): number {
  if (!grid) return 0;
  if (at === "drop" && grid.drop !== null) return Math.max(0, grid.drop - target);
  const down = downbeats(grid);
  const first = down.find((b) => b >= target) ?? grid.beats.find((b) => b >= target) ?? 0;
  return Math.max(0, first - target);
}
