/**
 * Palette generation in OKLCH, so hue rotations keep perceived lightness and
 * tints/shades step evenly. Harmonies, Tailwind-style scales, seeded random
 * palettes, k-means extraction from image pixels, and code exports.
 */

import { contrastRatio, parseHex, rgbToHex, rgbToHsl, type RGBA } from "./convert";

/* --------------------------------------------------------------- OKLab maths */

export interface Oklch {
  /** 0–1 */
  l: number;
  /** ~0–0.4 */
  c: number;
  /** degrees 0–360 */
  h: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = toLinear(r / 255), lg = toLinear(g / 255), lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → linear-light sRGB (may fall outside 0–1 when out of gamut). */
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [L, a, b] = rgbToOklab(rgb.r, rgb.g, rgb.b);
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function inGamut(lin: [number, number, number]): boolean {
  return lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

/** OKLCH → hex, reducing chroma until the colour fits in sRGB (lightness and hue are kept). */
export function oklchToHex(o: Oklch): string {
  const l = Math.min(1, Math.max(0, o.l));
  const hr = (o.h * Math.PI) / 180;
  let c = Math.max(0, o.c);
  let lin = oklabToLinearRgb(l, c * Math.cos(hr), c * Math.sin(hr));
  if (!inGamut(lin)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const t = oklabToLinearRgb(l, mid * Math.cos(hr), mid * Math.sin(hr));
      if (inGamut(t)) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklabToLinearRgb(l, c * Math.cos(hr), c * Math.sin(hr));
  }
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255);
  return rgbToHex({ r: to255(lin[0]), g: to255(lin[1]), b: to255(lin[2]), a: 1 });
}

/* ----------------------------------------------------------------- schemes */

export type Scheme = "analogous" | "complementary" | "split" | "triadic" | "tetradic" | "monochromatic";

export const SCHEMES: { id: Scheme; label: string; hint: string }[] = [
  { id: "analogous", label: "Analogous", hint: "Neighbouring hues, 30° apart — calm and cohesive" },
  { id: "complementary", label: "Complementary", hint: "The base and its opposite hue — maximum contrast" },
  { id: "split", label: "Split complementary", hint: "The base plus the two hues flanking its opposite" },
  { id: "triadic", label: "Triadic", hint: "Three hues 120° apart — vivid but balanced" },
  { id: "tetradic", label: "Tetradic", hint: "Four hues 90° apart — two complementary pairs" },
  { id: "monochromatic", label: "Monochromatic", hint: "One hue across lightness — safest for UI" },
];

const HUE_OFFSETS: Record<Exclude<Scheme, "monochromatic">, number[]> = {
  analogous: [0, 30, -30, 60, -60],
  complementary: [0, 180],
  split: [0, 150, 210],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
};

const clampL = (l: number) => Math.min(0.95, Math.max(0.15, l));

/** `count` colours (3–10) around `baseHex` in the given scheme; the base is always first. */
export function harmonyPalette(baseHex: string, scheme: Scheme, count = 5): string[] {
  const base = hexToOklch(baseHex);
  if (!base) return [];
  const n = Math.min(10, Math.max(2, Math.round(count)));
  const out: string[] = [];
  if (scheme === "monochromatic") {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const l = 0.92 - t * 0.66;
      // Chroma peaks around mid-lightness and fades toward white and black.
      const c = base.c * (0.35 + 0.65 * (1 - Math.abs(l - 0.6) / 0.45));
      out.push(oklchToHex({ l, c: Math.max(0.01, c), h: base.h }));
    }
    // Keep the exact base where it fits best.
    let best = 0, bestD = Infinity;
    out.forEach((hex, i) => {
      const d = Math.abs((hexToOklch(hex)?.l ?? 0) - base.l);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    out[best] = rgbToHex(parseHex(baseHex) as RGBA);
    return out;
  }
  const hues = HUE_OFFSETS[scheme];
  for (let i = 0; i < n; i++) {
    const dh = hues[i % hues.length];
    const variant = Math.floor(i / hues.length);
    const dl = variant === 0 ? 0 : (variant % 2 ? 1 : -1) * 0.17 * Math.ceil(variant / 2);
    if (i === 0) out.push(rgbToHex(parseHex(baseHex) as RGBA));
    else out.push(oklchToHex({ l: clampL(base.l + dl), c: base.c, h: (base.h + dh + 360) % 360 }));
  }
  return out;
}

/* ------------------------------------------------------------------- scale */

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const SCALE_L = [0.975, 0.945, 0.9, 0.83, 0.75, 0.65, 0.55, 0.45, 0.36, 0.28, 0.2];

/** Tailwind-style 50–950 tint/shade scale that contains the base colour at its nearest step. */
export function scalePalette(baseHex: string): { step: number; hex: string }[] {
  const base = hexToOklch(baseHex);
  if (!base) return [];
  const bell = (l: number) => Math.min(1, Math.max(0.15, 1 - Math.abs(l - 0.6) * 1.15));
  const k0 = bell(base.l);
  const out = SCALE_STEPS.map((step, i) => {
    const l = SCALE_L[i];
    return { step, hex: oklchToHex({ l, c: (base.c * bell(l)) / k0, h: base.h }) };
  });
  let best = 0, bestD = Infinity;
  SCALE_L.forEach((l, i) => {
    const d = Math.abs(l - base.l);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  out[best] = { step: SCALE_STEPS[best], hex: rgbToHex(parseHex(baseHex) as RGBA) };
  return out;
}

/* ------------------------------------------------------------------ random */

/** Small deterministic PRNG so a palette can be regenerated from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pleasing random palette: a random mid-toned base, a random scheme, harmonised. */
export function randomPalette(count: number, rng: () => number = Math.random): string[] {
  const schemes = SCHEMES.map((s) => s.id);
  const scheme = schemes[Math.floor(rng() * schemes.length)];
  const base = oklchToHex({ l: 0.45 + rng() * 0.3, c: 0.08 + rng() * 0.14, h: rng() * 360 });
  return harmonyPalette(base, scheme, count);
}

/* ----------------------------------------------------------- image colours */

export interface ExtractedColor {
  hex: string;
  /** Fraction of sampled pixels closest to this colour. */
  share: number;
}

/** k-means in OKLab over RGBA pixels (transparent pixels skipped), most common first. */
export function extractPalette(pixels: Uint8ClampedArray, count: number, iterations = 16): ExtractedColor[] {
  const pts: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(pixels.length / 4 / 20000)); // sample at most ~20k pixels
  for (let i = 0; i < pixels.length; i += 4 * step) {
    if (pixels[i + 3] < 128) continue;
    pts.push(rgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]));
  }
  if (!pts.length) return [];
  const k = Math.min(count, pts.length);
  // k-means++ seeding with a fixed RNG so the same image gives the same palette.
  const rng = mulberry32(7);
  const centers: [number, number, number][] = [pts[Math.floor(rng() * pts.length)]];
  while (centers.length < k) {
    const d2 = pts.map((p) => Math.min(...centers.map((c) => dist2(p, c))));
    const sum = d2.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    let idx = 0;
    while (idx < pts.length - 1 && (r -= d2[idx]) > 0) idx++;
    centers.push(pts[idx]);
  }
  const assign = new Array<number>(pts.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(pts[i], centers[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const s = sums[assign[i]];
      s[0] += pts[i][0];
      s[1] += pts[i][1];
      s[2] += pts[i][2];
      s[3]++;
    }
    for (let c = 0; c < k; c++) if (sums[c][3]) centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    if (!changed) break;
  }
  const counts = new Array<number>(k).fill(0);
  for (const a of assign) counts[a]++;
  const out = centers
    .map((c, i) => ({ hex: oklabToHex(c), share: counts[i] / pts.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
  // Merge near-duplicates.
  const merged: ExtractedColor[] = [];
  for (const c of out) {
    const o = hexToOklch(c.hex)!;
    const dup = merged.find((m) => {
      const mo = hexToOklch(m.hex)!;
      return Math.abs(mo.l - o.l) < 0.03 && Math.hypot(mo.c * Math.cos((mo.h * Math.PI) / 180) - o.c * Math.cos((o.h * Math.PI) / 180), mo.c * Math.sin((mo.h * Math.PI) / 180) - o.c * Math.sin((o.h * Math.PI) / 180)) < 0.03;
    });
    if (dup) dup.share += c.share;
    else merged.push(c);
  }
  return merged;
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function oklabToHex([L, a, b]: [number, number, number]): string {
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return oklchToHex({ l: L, c, h });
}

/* ------------------------------------------------------------- utilities */

export function bestTextColor(hex: string): "#000000" | "#ffffff" {
  const rgb = parseHex(hex);
  if (!rgb) return "#000000";
  const white = contrastRatio(rgb, { r: 255, g: 255, b: 255, a: 1 });
  const black = contrastRatio(rgb, { r: 0, g: 0, b: 0, a: 1 });
  return white >= black ? "#ffffff" : "#000000";
}

export function contrastWith(hex: string, textHex: string): number {
  const a = parseHex(hex), b = parseHex(textHex);
  return a && b ? contrastRatio(a, b) : 1;
}

export function describeColor(hex: string): { hex: string; hsl: string; oklch: string } {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const o = hexToOklch(hex) ?? { l: 0, c: 0, h: 0 };
  return {
    hex: rgbToHex(rgb),
    hsl: rgbToHsl(rgb),
    oklch: `oklch(${(o.l * 100).toFixed(1)}% ${o.c.toFixed(3)} ${o.h.toFixed(1)})`,
  };
}

/** Normalise user input like "68a52a" or "#5B8A3C" to "#68a52a"; null if invalid. */
export function normalizeHex(input: string): string | null {
  const t = input.trim();
  const rgb = parseHex(t.startsWith("#") ? t : `#${t}`);
  return rgb ? rgbToHex({ ...rgb, a: 1 }) : null;
}

/* ------------------------------------------------------------------ export */

export type ExportFormat = "css" | "tailwind" | "scss" | "json";
export const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "css", label: "CSS variables" },
  { id: "tailwind", label: "Tailwind theme" },
  { id: "scss", label: "SCSS variables" },
  { id: "json", label: "JSON" },
];

export interface NamedColor {
  name: string;
  hex: string;
}

export function exportPalette(colors: NamedColor[], format: ExportFormat, group = "palette"): string {
  switch (format) {
    case "css":
      return `:root {\n${colors.map((c) => `  --${group}-${c.name}: ${c.hex};`).join("\n")}\n}\n`;
    case "scss":
      return colors.map((c) => `$${group}-${c.name}: ${c.hex};`).join("\n") + "\n";
    case "tailwind":
      return `// tailwind.config.js → theme.extend.colors\n${group}: {\n${colors.map((c) => `  "${c.name}": "${c.hex}",`).join("\n")}\n},\n`;
    case "json":
      return JSON.stringify(Object.fromEntries(colors.map((c) => [c.name, c.hex])), null, 2) + "\n";
  }
}
