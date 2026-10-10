/**
 * Colour: .cube LUT parsing and sampling, the DJI D-Log / D-Log M → Rec.709
 * conversions (modelled on DJI's own LUT), and the exposure / white balance / contrast / saturation
 * adjustments — as pure maths (used by tests and the CPU preview) and as a
 * GLSL fragment shader (used for every frame on export and proxy playback).
 */

import type { FileLutKind, Grade, MathLutKind } from "./project";

export interface Lut3D {
  size: number;
  /** size³ × 3 floats, R fastest then G then B (the .cube order). */
  data: Float32Array;
  title: string;
}

/** Parse Adobe/Resolve .cube text (3D only). */
export function parseCube(text: string): Lut3D {
  let size = 0, title = "";
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^TITLE/i.test(line)) title = line.replace(/^TITLE\s*/i, "").replace(/^"|"$/g, "");
    else if (/^LUT_3D_SIZE/i.test(line)) size = Number(line.split(/\s+/)[1]);
    else if (/^LUT_1D_SIZE/i.test(line)) throw new Error("1D LUTs aren't supported — use a 3D .cube file.");
    else if (/^(DOMAIN_MIN|DOMAIN_MAX|LUT_3D_INPUT_RANGE)/i.test(line)) continue;
    else if (/^[-\d.]/.test(line)) {
      const parts = line.split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) values.push(parts[0], parts[1], parts[2]);
    }
  }
  if (!size || values.length !== size * size * size * 3) throw new Error(`Malformed .cube: expected ${size ? size ** 3 : "?"} entries, found ${values.length / 3}.`);
  return { size, data: Float32Array.from(values), title };
}

/** Trilinear sample of a 3D LUT at r,g,b ∈ [0,1]. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size, m = n - 1;
  const fx = Math.min(Math.max(r, 0), 1) * m, fy = Math.min(Math.max(g, 0), 1) * m, fz = Math.min(Math.max(b, 0), 1) * m;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, m), y1 = Math.min(y0 + 1, m), z1 = Math.min(z0 + 1, m);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const at = (x: number, y: number, z: number, c: number) => lut.data[((z * n + y) * n + x) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - tx) + at(x1, y0, z0, c) * tx;
    const c10 = at(x0, y1, z0, c) * (1 - tx) + at(x1, y1, z0, c) * tx;
    const c01 = at(x0, y0, z1, c) * (1 - tx) + at(x1, y0, z1, c) * tx;
    const c11 = at(x0, y1, z1, c) * (1 - tx) + at(x1, y1, z1, c) * tx;
    out[c] = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
  return out;
}

/* ------------------------------------------------- D-Log → linear → 709 */

/* ------------------------------------------------ DJI log curves */

/**
 * DJI D-Log, exactly as published in DJI's white paper "D-Log and D-Gamut of
 * DJI Cinema Color System" (Zenmuse X7 2017, X9 2022): 18 % grey sits at code
 * 0.3988 (10-bit 408), 90 % white at 0.573, black at 0.0929.
 */
export function dlogToLinear(x: number): number {
  return x <= 0.14 ? Math.max(0, (x - 0.0929) / 6.025) : (10 ** (3.89616 * x - 2.27752) - 0.0108) / 0.9892;
}
export function linearToDlog(v: number): number {
  return v <= 0.0078 ? 6.025 * v + 0.0929 : Math.log10(v * 0.9892 + 0.0108) * 0.256663 + 0.584555;
}
/** D-Gamut RGB → Rec.709 RGB in linear light, from the same paper (row-major). */
export const DGAMUT_TO_709 = [1.6746, -0.5797, -0.0949, -0.0981, 1.334, -0.2359, -0.041, -0.243, 1.284] as const;

/**
 * DJI D-Log M has no published formula and is not a plain log. These are the
 * OpenOSV constants (Apache-2.0, Kemerd and the OpenOSV contributors): a
 * seven-parameter curve least-squares fitted to the neutral axis of DJI's own
 * Osmo 360 D-Log M → Rec.709 LUT. 18 % grey at code 0.400; code 1.0 is 3.76,
 * about 4.4 stops over grey.
 */
const DLOGM = { xShift: -2.360862594, yShift: 0.630835854, scale: 6.691455736, slope: 1.011886004, slope2: 3.035658045, intercept: 0.822056039, mid: 0.00786506109 };
const DLOGM_CUT = DLOGM.intercept / (DLOGM.slope2 - DLOGM.slope);
export function dlogmToLinear(code: number): number {
  const t = 2 ** (DLOGM.scale * code + DLOGM.yShift) + DLOGM.xShift;
  return Math.max(0, (t < DLOGM_CUT ? t * DLOGM.slope + DLOGM.intercept : t * DLOGM.slope2) * DLOGM.mid);
}
export function linearToDlogm(lin: number): number {
  const pw = Math.max(0, lin) / DLOGM.mid;
  let t = pw / DLOGM.slope2;
  if (t < DLOGM_CUT) t = (pw - DLOGM.intercept) / DLOGM.slope;
  const a = t - DLOGM.xShift;
  return a > 0 ? Math.max(0, (Math.log2(a) - DLOGM.yShift) / DLOGM.scale) : 0;
}

/* ------------------------------------------- DJI's Rec.709 rendering */

/**
 * How DJI itself renders D-Log M to Rec.709, measured on the official Osmo
 * Action 6 LUT (v1.0, 2025-11-13): the display value at each of its 33 grey
 * grid points, joined by a monotone cubic so nothing overshoots.
 * 18 % grey (code 0.41) lands near display 0.40; the curve is gentle — about
 * 1.3× slope through the mids — which is why DJI's look is calm rather than
 * punchy. A log-curve-plus-gamma guess is roughly twice as steep.
 */
const DJI_TONE = [0, 0.00371, 0.01133, 0.02497, 0.04557, 0.07176, 0.10284, 0.1375, 0.17481, 0.21572, 0.25989, 0.30528, 0.35025, 0.39466, 0.43662, 0.47407, 0.50715, 0.53826, 0.56939, 0.60153, 0.63521, 0.66851, 0.70192, 0.73453, 0.76802, 0.80164, 0.83479, 0.86609, 0.89494, 0.92182, 0.94746, 0.97117, 0.98795];
/** Monotone piecewise-cubic (Fritsch–Carlson) through uniformly spaced knots on [0, 1]. */
function pchip(knots: number[], x: number): number {
  const n = knots.length - 1, h = 1 / n;
  const d = knots.slice(0, n).map((y, i) => (knots[i + 1] - y) / h);
  const m = knots.map((_, i) => (i === 0 ? d[0] : i === n ? d[n - 1] : d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i])));
  const i = Math.min(n - 1, Math.max(0, Math.floor(x * n)));
  const t = x * n - i, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * knots[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * knots[i + 1] + (t3 - t2) * h * m[i + 1];
}
export const djiTone = (code: number) => pchip(DJI_TONE, Math.min(1, Math.max(0, code)));
/**
 * Hue and saturation of that rendering: a 3×3 applied in log space before the
 * tone curve, least-squares fitted to every unclipped entry of the Action 6
 * LUT with each row constrained to sum to 1, so greys stay exactly neutral.
 * 0.033 RMS against the cube; chroma gain around mid grey within 3 % of DJI's.
 */
const DJI_LOG_MATRIX = [1.25866, -0.16277, -0.09589, -0.10848, 1.16525, -0.05678, -0.07455, -0.12533, 1.19988];
/** Display-referred 18 % grey of this rendering — the pivot for the looks' contrast. */
const GREY_DISPLAY = pchip(DJI_TONE, 0.4);

/** Options offered for log footage, in menu order. */
export const LUT_OPTIONS: { kind: MathLutKind | FileLutKind; name: string; hint: string }[] = [
  { kind: "dji-official", name: "D-Log M → Rec.709 (DJI's own file)", hint: "DJI's official Osmo Action 6 D-Log M to Rec.709 LUT (v1.0, November 2025), applied exactly as DJI ships it. Punchy, saturated and faithful; the reference everything else is measured against." },
  { kind: "dlogm", name: "D-Log M → Rec.709 (DJI, modelled)", hint: "A compact model of DJI's file: tone, hue and saturation measured from it. Within about two 8-bit levels of the file on real footage." },
  { kind: "dji-official-study", name: "D-Log M → Study drive (on DJI's file)", hint: "The recommended look for long-play study, focus and work videos: DJI's own colour science with the Study treatment on top — crisp mids, a soft shoulder, sky held off cyan and neutral near white, shadows opened a touch, a hint of warmth, saturation 0.9." },
  { kind: "dlogm-study", name: "D-Log M → Study drive", hint: "Tuned on Osmo Action 6 footage for long-play study, focus and work videos: DJI's tone with mids kept crisp, a soft shoulder that keeps sky gradients smooth, bright sky held off cyan, shadows opened a touch, a hint of warmth and calmer saturation." },
  { kind: "dlogm-natural", name: "D-Log M → Natural", hint: "DJI's rendering with 12 % less saturation and slightly less contrast — flattering for tarmac, dashboards and overcast days." },
  { kind: "dlogm-vivid", name: "D-Log M → Vivid", hint: "DJI's rendering with 10 % more saturation and a little more contrast, in the spirit of DJI's own vivid LUTs." },
  { kind: "dlog", name: "D-Log → Rec.709 (DJI)", hint: "DJI's published D-Log curve and D-Gamut matrix (Mavic 3 Pro Hasselblad camera, Inspire 3, Zenmuse), rendered with the same tone as the D-Log M look." },
];
/**
 * A look is a few display-space moves after DJI's rendering: exposure (stops),
 * warmth (as the Temperature slider, 1 = +100), a nudge of blue-dominant
 * pixels away from cyan, saturation with extra desaturation towards white
 * (keeps bright sky and clouds neutral), contrast about 18 % grey, a soft
 * shoulder above a display level, and a black lift.
 */
interface Look {
  exposure: number;
  warm: number;
  blueHue: number;
  sat: number;
  hiDesat: number;
  con: number;
  shoulder: number;
  lift: number;
}
const PLAIN: Look = { exposure: 0, warm: 0, blueHue: 0, sat: 1, hiDesat: 0, con: 1, shoulder: 1, lift: 0 };
// Measured on a sunny Tokyo drive: median 0.4 stop over grey, sky at code 0.35/0.5/0.65, p99 three stops over grey.
export const STUDY_LOOK: Look = { exposure: -0.05, warm: 0.05, blueHue: 0.08, sat: 0.9, hiDesat: 0.35, con: 1, shoulder: 0.88, lift: 0.008 };
const LOOKS: Record<MathLutKind | FileLutKind, Look> = {
  "dji-official": PLAIN,
  "dji-official-study": STUDY_LOOK,
  dlogm: PLAIN,
  "dlogm-study": STUDY_LOOK,
  "dlogm-natural": { ...PLAIN, sat: 0.88, con: 0.94 },
  "dlogm-vivid": { ...PLAIN, sat: 1.1, con: 1.04 },
  dlog: PLAIN,
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function applyLook(rgb: [number, number, number], L: Look): [number, number, number] {
  let [r, g, b] = rgb;
  if (L.exposure) {
    const gain = 2 ** L.exposure;
    r *= gain;
    g *= gain;
    b *= gain;
  }
  if (L.warm) {
    r *= 1 + 0.25 * L.warm;
    b *= 1 - 0.25 * L.warm;
  }
  if (L.blueHue && b > r && b > g) g -= L.blueHue * (b - r);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const s = L.sat * (1 - L.hiDesat * smoothstep(0.7, 1, y));
  if (s !== 1) {
    r = y + s * (r - y);
    g = y + s * (g - y);
    b = y + s * (b - y);
  }
  if (L.con !== 1) {
    r = GREY_DISPLAY + (r - GREY_DISPLAY) * L.con;
    g = GREY_DISPLAY + (g - GREY_DISPLAY) * L.con;
    b = GREY_DISPLAY + (b - GREY_DISPLAY) * L.con;
  }
  const k = L.shoulder;
  const sh = (v: number) => (k < 1 && v > k ? k + (1 - k) * (1 - Math.exp(-(v - k) / (1 - k))) : v);
  const fin = (v: number) => clamp01(L.lift + (1 - L.lift) * clamp01(sh(v)));
  return [fin(r), fin(g), fin(b)];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mul3 = (m: readonly number[], v: [number, number, number]): [number, number, number] => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** One log triplet → display Rec.709, for the built-in conversions. */
export function convertLog(kind: MathLutKind, rgb: [number, number, number]): [number, number, number] {
  let out: [number, number, number];
  if (kind === "dlog") {
    // Published curve and gamut, then DJI's rendering via the D-Log M code it corresponds to.
    const lin = mul3(DGAMUT_TO_709, [dlogToLinear(rgb[0]), dlogToLinear(rgb[1]), dlogToLinear(rgb[2])]);
    out = [djiTone(linearToDlogm(lin[0])), djiTone(linearToDlogm(lin[1])), djiTone(linearToDlogm(lin[2]))];
  } else {
    const c = mul3(DJI_LOG_MATRIX, rgb);
    out = [djiTone(c[0]), djiTone(c[1]), djiTone(c[2])];
  }
  const L = LOOKS[kind];
  return L === PLAIN ? [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])] : applyLook(out, L);
}

/** Build a built-in conversion as a 3D LUT (33³, the industry size). */
export function buildDlogLut(kind: MathLutKind, size = 33): Lut3D {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = convertLog(kind, [r / (size - 1), g / (size - 1), b / (size - 1)]);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
  return { size, data, title: LUT_OPTIONS.find((o) => o.kind === kind)?.name ?? kind };
}

/* ------------------------------------------- DJI's own LUT file */

/** DJI's Osmo Action 6 D-Log M → Rec.709 LUT v1.0 (2025-11-13), served as downloaded from dji.com/lut. © DJI. */
export const DJI_OFFICIAL_LUT_URL = "/luts/dji-osmo-action-6-dlogm-to-rec709-v1.cube";
let officialLut: Promise<Lut3D> | null = null;
/** Fetch and parse DJI's file once per page. */
export function fetchOfficialLut(): Promise<Lut3D> {
  officialLut ??= fetch(DJI_OFFICIAL_LUT_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load DJI's LUT (${r.status}).`);
      return r.text();
    })
    .then((t) => parseCube(t))
    .catch((e) => {
      officialLut = null;
      throw e;
    });
  return officialLut;
}
/** A conversion built from DJI's file: as-is, or with a look applied to every entry (exact, no resampling). */
export function deriveLut(base: Lut3D, kind: FileLutKind): Lut3D {
  const name = LUT_OPTIONS.find((o) => o.kind === kind)?.name ?? kind;
  const L = LOOKS[kind];
  if (L === PLAIN) return { ...base, title: name };
  const data = new Float32Array(base.data.length);
  for (let i = 0; i < data.length; i += 3) {
    const o = applyLook([base.data[i], base.data[i + 1], base.data[i + 2]], L);
    data[i] = o[0];
    data[i + 1] = o[1];
    data[i + 2] = o[2];
  }
  return { size: base.size, data, title: name };
}

/** A LUT as .cube text, for download. */
export function lutToCube(lut: Lut3D): string {
  const lines = [`TITLE "${lut.title}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return lines.join("\n") + "\n";
}

/* ----------------------------------------------------- adjustments */

/** Exposure, white balance, contrast, saturation on display-referred RGB in [0,1]. Same maths as the shader. */
export function adjust([r, g, b]: [number, number, number], grade: Grade): [number, number, number] {
  const exp = 2 ** grade.exposure;
  // Temperature: warm (+) lifts red and lowers blue; tint (+) lifts magenta (R+B) against green.
  const t = grade.temperature / 100, n = grade.tint / 100;
  let R = r * exp * (1 + 0.25 * t) * (1 + 0.1 * n), G = g * exp * (1 - 0.12 * n), B = b * exp * (1 - 0.25 * t) * (1 + 0.1 * n);
  // Contrast about mid-grey (0.5 display).
  const c = grade.contrast;
  R = 0.5 + (R - 0.5) * c;
  G = 0.5 + (G - 0.5) * c;
  B = 0.5 + (B - 0.5) * c;
  // Saturation about Rec.709 luma.
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const s = grade.saturation;
  R = Y + (R - Y) * s;
  G = Y + (G - Y) * s;
  B = Y + (B - Y) * s;
  const cl = (v: number) => Math.min(Math.max(v, 0), 1);
  return [cl(R), cl(G), cl(B)];
}

/** Full pipeline for one pixel (display RGB in [0,1]): LUT then adjustments. */
export function gradePixel(rgb: [number, number, number], grade: Grade, lut: Lut3D | null): [number, number, number] {
  const base = lut && grade.lut !== "none" ? sampleLut(lut, rgb[0], rgb[1], rgb[2]) : rgb;
  return adjust(base, grade);
}

/** GLSL ES 3.0 fragment shader doing the same thing per fragment: LUT (as a 2D-packed 3D texture) and adjustments. */
export const GRADE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFrame;
uniform sampler2D uLut;
uniform float uLutSize;
uniform int uUseLut;
uniform float uExposure;
uniform float uTemperature;
uniform float uTint;
uniform float uContrast;
uniform float uSaturation;

vec3 sampleLut(vec3 c) {
  float n = uLutSize;
  float m = n - 1.0;
  vec3 p = clamp(c, 0.0, 1.0) * m;
  float z0 = floor(p.b);
  float z1 = min(z0 + 1.0, m);
  float tz = p.b - z0;
  // Slices stacked vertically: texel (x = r, y = z*n + g).
  vec2 uv0 = vec2((p.r + 0.5) / n, (z0 * n + p.g + 0.5) / (n * n));
  vec2 uv1 = vec2((p.r + 0.5) / n, (z1 * n + p.g + 0.5) / (n * n));
  return mix(texture(uLut, uv0).rgb, texture(uLut, uv1).rgb, tz);
}

void main() {
  vec3 c = texture(uFrame, vUv).rgb;
  if (uUseLut == 1) c = sampleLut(c);
  float e = pow(2.0, uExposure);
  float t = uTemperature / 100.0;
  float n = uTint / 100.0;
  c = vec3(c.r * e * (1.0 + 0.25 * t) * (1.0 + 0.1 * n), c.g * e * (1.0 - 0.12 * n), c.b * e * (1.0 - 0.25 * t) * (1.0 + 0.1 * n));
  c = 0.5 + (c - 0.5) * uContrast;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = y + (c - y) * uSaturation;
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

/** Pack a 3D LUT into the 2D RGBA float texture the shader expects (width n, height n²); alpha is unused. */
export function lutTexture(lut: Lut3D): { width: number; height: number; data: Float32Array } {
  const n = lut.size;
  const data = new Float32Array(n * n * n * 4);
  // .cube order is already r fastest, then g, then b — exactly the stacked layout.
  for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) {
    data[j] = lut.data[i];
    data[j + 1] = lut.data[i + 1];
    data[j + 2] = lut.data[i + 2];
    data[j + 3] = 1;
  }
  return { width: n, height: n * n, data };
}
