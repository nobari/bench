/**
 * Waveforms for the editor's music: a decoded song reduced once to peaks, a stretch of them picked for a bar of any
 * width, and the SVG path that draws them. Pure arithmetic over typed arrays, so it runs in Node and in a worker.
 */

/** How many peaks a song is reduced to: one per 20 ms, at most 12 000 (a four-minute song fits). */
export const peakBins = (seconds: number) => Math.max(1, Math.min(12000, Math.ceil(seconds * 50)));

/**
 * Peaks of a decoded song for drawing: `bins` columns across its length, each the loudest sample magnitude in it over
 * every channel, scaled so the loudest column is 1 (a quiet song still draws).
 */
export function peaksOf(channels: ArrayLike<number>[], bins: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(Math.max(1, bins));
  if (!n || !channels.length) return out;
  const per = n / out.length;
  for (const ch of channels) {
    for (let b = 0; b < out.length; b++) {
      const from = Math.floor(b * per), to = Math.min(n, Math.max(from + 1, Math.floor((b + 1) * per)));
      let peak = out[b];
      for (let i = from; i < to; i++) {
        const v = ch[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      out[b] = peak;
    }
  }
  let max = 0;
  for (let b = 0; b < out.length; b++) if (out[b] > max) max = out[b];
  if (max > 0) for (let b = 0; b < out.length; b++) out[b] /= max;
  return out;
}

/**
 * The columns of a stretch of the song, `from` to `to` seconds, `n` of them: each the loudest peak it covers, and the
 * peak under it when the stretch is zoomed in past the peaks. Outside the song a column is 0.
 */
export function peaksBetween(peaks: Float32Array, songSeconds: number, from: number, to: number, n: number): Float32Array {
  const out = new Float32Array(Math.max(1, Math.floor(n)));
  if (!peaks.length || !(songSeconds > 0) || !(to > from)) return out;
  const perSec = peaks.length / songSeconds;
  const step = (to - from) / out.length;
  for (let c = 0; c < out.length; c++) {
    const t0 = from + c * step, t1 = t0 + step;
    if (t1 <= 0 || t0 >= songSeconds) continue;
    const b0 = Math.max(0, Math.floor(t0 * perSec)), b1 = Math.min(peaks.length, Math.max(b0 + 1, Math.ceil(t1 * perSec)));
    let peak = 0;
    for (let b = b0; b < b1; b++) if (peaks[b] > peak) peak = peaks[b];
    out[c] = peak;
  }
  return out;
}

/**
 * An SVG path of the columns as a mirrored envelope around the middle of a `w`×`h` box — the familiar waveform — with
 * a floor of `min` of the height so silence still shows as a hairline.
 */
export function wavePath(cols: Float32Array, w: number, h: number, min = 0.06): string {
  if (!cols.length || !(w > 0) || !(h > 0)) return "";
  const cw = w / cols.length, mid = h / 2;
  const top: string[] = [], bottom: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    const amp = Math.max(min, Math.min(1, cols[i])) * mid;
    const x0 = +(i * cw).toFixed(2), x1 = +((i + 1) * cw).toFixed(2);
    const y0 = +(mid - amp).toFixed(2), y1 = +(mid + amp).toFixed(2);
    top.push(`${x0},${y0} ${x1},${y0}`);
    bottom.push(`${x1},${y1} ${x0},${y1}`);
  }
  return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
}
