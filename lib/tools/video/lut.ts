/**
 * Colour: .cube LUT parsing and sampling, the DJI D-Log / D-Log M → Rec.709
 * conversion, and the exposure / white balance / contrast / saturation
 * adjustments — as pure maths (used by tests and the CPU preview) and as a
 * GLSL fragment shader (used for every frame on export and proxy playback).
 */

import type { Grade } from "./project";

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

/**
 * DJI D-Log decode (from DJI's published white paper): a log segment above
 * the toe and a linear segment below it, mapping encoded [0,1] to scene
 * linear. D-Log M is the same family with a brighter mid-grey and less
 * range, so it uses a gentler curve.
 */
export function dlogToLinear(x: number, variant: "dlog" | "dlogm" = "dlog"): number {
  if (variant === "dlogm") {
    // D-Log M: ~1.5 stops less dynamic range than D-Log, mid-grey near 0.41.
    return x < 0.104 ? (x - 0.0929) / 5.3 + 0.0 : Math.max(0, (10 ** ((x - 0.584) / 0.256) - 0.0108) / (1 - 0.0108));
  }
  // D-Log: toe below 0.0929, log above (mid-grey 0.3773).
  return x < 0.0929 ? (x - 0.0929) / 8.0 + 0.0 : Math.max(0, (10 ** ((x - 0.584) / 0.209) - 0.0108) / (1 - 0.0108));
}

/** Scene linear → Rec.709 (BT.1886-ish) display, with a soft shoulder so highlights roll off instead of clipping. */
export function linearTo709(v: number): number {
  const shoulder = v > 0.8 ? 0.8 + (1 - Math.exp(-(v - 0.8) * 2.5)) * 0.2 : v;
  const c = Math.min(Math.max(shoulder, 0), 1);
  return c < 0.018 ? 4.5 * c : 1.099 * Math.pow(c, 0.45) - 0.099;
}

/** Encoded mid-grey (18% scene reflectance) for each log curve, from DJI's documentation. */
const MID_GREY = { dlog: 0.3773, dlogm: 0.41 } as const;

/**
 * Build the D-Log / D-Log M → Rec.709 conversion as a 3D LUT (33³, the
 * industry size). Scene linear is scaled so that 18% grey lands at 0.18
 * linear exactly, which Rec.709 then shows at the conventional ~0.46 —
 * the same anchoring DJI's own LUTs use, so footage looks "normal" rather than dark.
 */
export function buildDlogLut(variant: "dlog" | "dlogm", size = 33): Lut3D {
  const data = new Float32Array(size ** 3 * 3);
  const norm = 0.18 / Math.max(1e-6, dlogToLinear(MID_GREY[variant], variant));
  const conv = (x: number) => linearTo709(dlogToLinear(x, variant) * norm);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        // D-Log is encoded per channel with Rec.709-ish primaries, so per-channel decode is a faithful first-order conversion.
        data[i++] = conv(r / (size - 1));
        data[i++] = conv(g / (size - 1));
        data[i++] = conv(b / (size - 1));
      }
  return { size, data, title: variant === "dlog" ? "DJI D-Log to Rec.709" : "DJI D-Log M to Rec.709" };
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
