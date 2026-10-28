/**
 * Where a road leads to in a frame: the vanishing point, found from the lane edges — the straight, slanted edges in
 * the lower part of the picture that converge on one point near the horizon. Every strong edge pixel votes for the
 * point where the line through it (along the edge) crosses each candidate horizon row; the cell with the most votes
 * is the vanishing point, and the vote's share and the balance of left- and right-leaning edges say how sure it is.
 * Pure arithmetic on grey levels, so it runs on a 320×180 proxy frame in a few milliseconds.
 */

export interface VanishingPoint {
  /** Fractions of the frame's width and height. */
  x: number;
  y: number;
  /** 0–1: the peak's share of all votes, scaled by how evenly edges from both sides agree on it. */
  confidence: number;
  /** How much of the vote came from edges leaning each way. */
  left: number;
  right: number;
}

/** Grey levels (0–255) from RGBA bytes. */
export function greyOf(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  return g;
}

/** A 3×3 box blur; twice over it is close to a Gaussian, enough to take the stairs out of a slanted edge before Sobel reads its direction. */
function blur3(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += g[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  return out;
}

/** A road is sure enough to follow from this confidence on. */
export const ROAD_CONFIDENCE = 0.15;

export function vanishingPoint(grey: Float32Array, w: number, h: number, opts: { fromRow?: number; horizonFrom?: number; horizonTo?: number } = {}): VanishingPoint {
  const g = blur3(blur3(grey, w, h), w, h);
  const fromRow = Math.max(1, Math.floor((opts.fromRow ?? 0.3) * h));
  const hFrom = (opts.horizonFrom ?? 0.12) * h, hTo = (opts.horizonTo ?? 0.65) * h;
  const rows = 24, cols = Math.max(16, Math.round(w / 6));
  const grid = new Float32Array(rows * cols), gridL = new Float32Array(rows * cols), gridR = new Float32Array(rows * cols);
  // Sobel on the lower part; the strongest tenth of the edges vote.
  const mags: number[] = [];
  const edges: { x: number; y: number; dx: number; dy: number; mag: number }[] = [];
  for (let y = Math.max(fromRow, 1); y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] + g[i - w + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + w - 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 24) continue;
      // The edge runs across the gradient.
      const len = mag;
      const dx = -gy / len, dy = gx / len;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      // Lane edges slant: not near horizontal (markings, bumper), not near vertical (poles).
      if (ay < 0.3 || ax < 0.12) continue;
      mags.push(mag);
      edges.push({ x, y, dx, dy, mag });
    }
  if (edges.length < 20) return { x: 0.5, y: 0.4, confidence: 0, left: 0, right: 0 };
  mags.sort((a, b) => a - b);
  // The strongest edges vote: the top tenth, and never fainter than a quarter of the strongest (noise stays out).
  const threshold = Math.max(mags[Math.floor(mags.length * 0.9)], mags[mags.length - 1] * 0.25);
  let total = 0;
  for (const e of edges) {
    if (e.mag < threshold) continue;
    total += e.mag;
    const slope = e.dx / e.dy; // x per y
    // Going down the picture, a left edge moves left and a right edge moves right.
    const leftLean = slope < 0;
    for (let r = 0; r < rows; r++) {
      const yh = hFrom + ((hTo - hFrom) * (r + 0.5)) / rows;
      if (yh >= e.y) continue; // the horizon is above the edge
      const xh = e.x + (yh - e.y) * slope;
      if (xh < 0 || xh >= w) continue;
      const c = Math.min(cols - 1, Math.floor((xh / w) * cols));
      const k = r * cols + c;
      grid[k] += e.mag;
      if (leftLean) gridL[k] += e.mag;
      else gridR[k] += e.mag;
    }
  }
  if (total <= 0) return { x: 0.5, y: 0.4, confidence: 0, left: 0, right: 0 };
  // The peak: the 3×3 neighbourhood with the most votes, its centroid as the point.
  let best = -1, bestK = 0;
  const sum3 = (arr: Float32Array, r: number, c: number) => {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) s += arr[rr * cols + cc]; }
    return s;
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const s = sum3(grid, r, c);
      if (s > best) { best = s; bestK = r * cols + c; }
    }
  const br = Math.floor(bestK / cols), bc = bestK % cols;
  let sx = 0, sy = 0, sw = 0;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = br + dr, cc = bc + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const v = grid[rr * cols + cc];
      sx += v * ((cc + 0.5) / cols);
      sy += v * ((hFrom + ((hTo - hFrom) * (rr + 0.5)) / rows) / h);
      sw += v;
    }
  // An edge can land in three of the neighbourhood's cells (one per row), so its share is over three times the vote.
  const left = sum3(gridL, br, bc) / (3 * total), right = sum3(gridR, br, bc) / (3 * total);
  const share = best / (3 * total);
  const balance = Math.max(left, right) > 0 ? Math.min(left, right) / Math.max(left, right) : 0;
  return { x: sw > 0 ? sx / sw : 0.5, y: sw > 0 ? sy / sw : 0.4, confidence: share * (0.2 + 0.8 * balance), left, right };
}
