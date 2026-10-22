/**
 * Loudness, as broadcasters and YouTube measure it (ITU-R BS.1770-4 / EBU R128): K-weighting, 400 ms blocks with
 * 75 % overlap, an absolute gate at −70 LUFS and a relative gate 10 LU under the ungated mean. Feed it interleaved
 * stereo floats block by block; it keeps the sample peak as well. Pure, so it runs in Node for tests.
 *
 * Also the export's peak limiter: identity up to the knee, a smooth squeeze above it, never past full scale.
 */

/** YouTube plays everything at this level; louder uploads are turned down, quieter ones are left as they are. */
export const YOUTUBE_LUFS = -14;
/** Peaks are kept this far under full scale after a level change, so the encoder's own overshoot stays clean. */
export const TARGET_PEAK_DBFS = -1;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The K-weighting pre-filter (a high shelf) and RLB high-pass for any sample rate, from the standard's analogue prototypes. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  })();
  const high = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + K / Q + K * K;
    return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  })();
  return [shelf, high];
}

export interface Loudness {
  /** Integrated loudness, LUFS; null when nothing rose above the absolute gate (silence). */
  integrated: number | null;
  /** Sample peak, dBFS (−Infinity for silence). */
  peakDb: number;
  /** Audio measured, seconds. */
  seconds: number;
}

export class LoudnessMeter {
  private readonly sampleRate: number;
  private readonly filters: [Biquad, Biquad];
  /** Filter memories: [channel][stage] → (x1, x2, y1, y2). */
  private readonly mem = [
    [new Float64Array(4), new Float64Array(4)],
    [new Float64Array(4), new Float64Array(4)],
  ];
  private readonly hop: number;
  private subSum = 0;
  private subCount = 0;
  /** Mean square (both channels summed) of every finished 100 ms sub-block. */
  private readonly subs: number[] = [];
  private peak = 0;
  private frames = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.filters = kWeighting(sampleRate);
    this.hop = Math.round(sampleRate / 10);
  }

  private weigh(ch: number, x: number): number {
    let v = x;
    for (let s = 0; s < 2; s++) {
      const f = this.filters[s], m = this.mem[ch][s];
      const y = f.b0 * v + f.b1 * m[0] + f.b2 * m[1] - f.a1 * m[2] - f.a2 * m[3];
      m[1] = m[0];
      m[0] = v;
      m[3] = m[2];
      m[2] = y;
      v = y;
    }
    return v;
  }

  /** Interleaved stereo samples in [−1, 1]. */
  add(samples: Float32Array): void {
    const n = samples.length >> 1;
    for (let i = 0; i < n; i++) {
      const l = samples[i * 2], r = samples[i * 2 + 1];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > this.peak) this.peak = al;
      if (ar > this.peak) this.peak = ar;
      const wl = this.weigh(0, l), wr = this.weigh(1, r);
      this.subSum += wl * wl + wr * wr;
      if (++this.subCount === this.hop) {
        this.subs.push(this.subSum / this.hop);
        this.subSum = 0;
        this.subCount = 0;
      }
    }
    this.frames += n;
  }

  result(): Loudness {
    const seconds = this.frames / this.sampleRate;
    const peakDb = this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
    // 400 ms blocks, every 100 ms.
    const blocks: number[] = [];
    for (let i = 3; i < this.subs.length; i++) blocks.push((this.subs[i - 3] + this.subs[i - 2] + this.subs[i - 1] + this.subs[i]) / 4);
    const lk = (z: number) => -0.691 + 10 * Math.log10(z);
    const above = blocks.filter((z) => z > 0 && lk(z) > -70);
    if (!above.length) return { integrated: null, peakDb, seconds };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const gate = lk(mean(above)) - 10;
    const kept = above.filter((z) => lk(z) > gate);
    return { integrated: kept.length ? lk(mean(kept)) : null, peakDb, seconds };
  }
}

/** The knee of the export's limiter: nothing under −1.4 dBFS is touched. */
export const LIMIT_KNEE = 0.85;

/** Identity up to the knee; above it the rest of the way to full scale is squeezed smoothly, so nothing ever clips. */
export function softLimit(x: number): number {
  const a = Math.abs(x);
  if (a <= LIMIT_KNEE) return x;
  const room = 1 - LIMIT_KNEE;
  const y = LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room);
  return x < 0 ? -y : y;
}

/**
 * The gain (dB) that brings a mix at `measured` LUFS to `target`, held back so the sample peak lands no higher than
 * TARGET_PEAK_DBFS — a mix that would need its peaks limited more than that lands a little under the target instead.
 */
export function gainToReach(measured: number, peakDb: number, target = YOUTUBE_LUFS): number {
  const wanted = target - measured;
  const headroom = TARGET_PEAK_DBFS - peakDb;
  return Math.round(Math.min(wanted, headroom) * 10) / 10;
}
