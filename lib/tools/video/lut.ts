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
  { kind: "dji-official-vivid", name: "D-Log M → Vivid (on DJI's file)", hint: "The attractive look for travel, drives and scenery: DJI's own colour science with the Vivid treatment on top — richer colour where it is muted (vibrance, skin tones held back), a gentle S-curve about mid grey with a soft shoulder so bright sky and clouds stay clean and nothing clips, mids a touch brighter and a hint of warmth." },
  { kind: "dji-official-vivid-sky", name: "D-Log M → Vivid, deep sky (on DJI's file)", hint: "Vivid with the sky given the depth of colour the D-Log → Rec.709 path has, at DJI's own blue (never cyan) and without clipping, and the shadows kept open: trees and hedges come out brighter than in DJI's file, not darker. Clouds, greys and skin are untouched by the sky boost. Measured on real drives: sky saturation 0.69 against DJI's 0.38 and the D-Log path's 0.72, foliage 4 % brighter than DJI's, nothing crushed." },
  { kind: "dji-official-night", name: "D-Log M → Night (on DJI's file)", hint: "For night drives and illuminations: DJI's own colour science with the Night treatment on top — the sky and the night between the leaves taken to a true black, greys cleared of their tint and pulled down so the asphalt reads black under white lane lines, lamp-lit colour lifted a quarter of a stop and given Vivid's richness so trees glow from the lamp at their foot. Keyed on saturation rather than brightness, so lines, lamps and signs keep their light. Measured on the November night drive: asphalt 24 of 255 against DJI's 106, lane lines 154, lit foliage brighter and richer than DJI's, sky 0. Not for daylight: it blackens every grey." },
  { kind: "dji-official-study", name: "D-Log M → Study (on DJI's file)", hint: "The recommended look for long-play study, focus and work videos: DJI's own colour science with the Study treatment on top — crisp mids, a soft shoulder, sky held off cyan and neutral near white, shadows opened a touch, a hint of warmth, saturation 0.9." },
  { kind: "dlogm-study", name: "D-Log M → Study", hint: "Tuned on Osmo Action 6 footage for long-play study, focus and work videos: DJI's tone with mids kept crisp, a soft shoulder that keeps sky gradients smooth, bright sky held off cyan, shadows opened a touch, a hint of warmth and calmer saturation." },
  { kind: "dlogm-natural", name: "D-Log M → Natural", hint: "DJI's rendering with 12 % less saturation and slightly less contrast — flattering for overcast days and muted scenes." },
  { kind: "dlogm-vivid", name: "D-Log M → Vivid", hint: "The Vivid treatment on the modelled conversion: richer colour where it is muted with skin tones held back, a gentle S-curve with a soft shoulder, mids a touch brighter and a hint of warmth." },
  { kind: "dlogm-vivid-sky", name: "D-Log M → Vivid, deep sky", hint: "The deep-sky Vivid on the modelled conversion: the sky alone deepened to the D-Log path's saturation at DJI's blue, the shadows kept open, Vivid's colour everywhere else." },
  { kind: "dlogm-night", name: "D-Log M → Night", hint: "The Night treatment on the modelled conversion: greys cleared of their tint and pulled towards black, lamp-lit colour lifted and given Vivid's richness, a toe that reaches a true black. For night footage only — in daylight it blackens every grey." },
  { kind: "dlog", name: "D-Log → Rec.709 (DJI)", hint: "DJI's published D-Log curve and D-Gamut matrix (Mavic 3 Pro Hasselblad camera, Inspire 3, Zenmuse), rendered with the same tone as the D-Log M look." },
];
/**
 * A look is a few display-space moves after DJI's rendering: exposure (stops),
 * warmth (as the Temperature slider, 1 = +100), a nudge of blue-dominant
 * pixels away from cyan, saturation with extra desaturation towards white
 * (keeps bright sky and clouds neutral), vibrance (extra saturation that
 * fades as a colour gets richer, so muted colours bloom while strong ones
 * don't go neon), skin protection (how much of the vibrance and saturation
 * skin-coloured pixels are spared), contrast about 18 % grey, a soft
 * shoulder above a display level, a soft toe below one (so added contrast
 * deepens shadows without crushing them to black), a black lift, and a sky
 * boost: extra colour for blue-dominant pixels out of the shadows (the sky,
 * never clouds or greys), applied before everything else; and the night moves
 * (see nightPre): greys cleared of their tint and pulled down, lamp-lit colour
 * lifted, and a toe that reaches a true black.
 */
export interface Look {
  exposure: number;
  warm: number;
  blueHue: number;
  sat: number;
  hiDesat: number;
  vibrance: number;
  skin: number;
  con: number;
  shoulder: number;
  toe: number;
  lift: number;
  /** The sky's chroma is scaled by up to 1 + sky, by how blue a pixel is (see skyBoost); 0 leaves it alone. */
  sky: number;
  /** How much of their tint low-saturation pixels lose (cool tints at any brightness, others out of the brights); 0 = none. */
  greyDesat: number;
  /** Stops of darkening for low-saturation pixels out of the brights, fading out by saturation 0.5 and by luma 0.72; 0 = none. */
  greyPull: number;
  /** Stops of brightening for saturated warm pixels in the mids (lamp-lit foliage), fading out before the brights; 0 = none. */
  warmLift: number;
  /** Display levels under this are eased to black (v × smoothstep(0, nightToe, v)); nothing above it moves; 0 = off. */
  nightToe: number;
}
const PLAIN: Look = { exposure: 0, warm: 0, blueHue: 0, sat: 1, hiDesat: 0, vibrance: 0, skin: 0, con: 1, shoulder: 1, toe: 0, lift: 0, sky: 0, greyDesat: 0, greyPull: 0, warmLift: 0, nightToe: 0 };
// Measured on a sunny Tokyo drive: median 0.4 stop over grey, sky at code 0.35/0.5/0.65, p99 three stops over grey.
export const STUDY_LOOK: Look = { ...PLAIN, exposure: -0.05, warm: 0.05, blueHue: 0.08, sat: 0.9, hiDesat: 0.35, shoulder: 0.88, lift: 0.008 };
/**
 * Tuned on Osmo Action 6 drives, an autumn mountain road and an overcast street against DJI's file: colour up by about
 * a quarter where it is muted and a tenth where it is already strong, skin spared half of that, an S-curve of 8 % about
 * mid grey with the shoulder from 0.9 so clouds and sky keep their gradients, mids a twentieth of a stop brighter, a
 * hint of warmth, bright near-whites kept clean, and a toe from 0.03 so the shadows the S-curve deepens never crush.
 */
export const VIVID_LOOK: Look = { ...PLAIN, exposure: 0.05, warm: 0.04, blueHue: 0.04, sat: 1.1, hiDesat: 0.25, vibrance: 0.28, skin: 0.5, con: 1.08, shoulder: 0.9, toe: 0.03 };
/**
 * Vivid with a deep sky and open shadows, asked for from two renderings of one dusk frame (Nov 2026): the D-Log →
 * Rec.709 path's sky (saturation 0.72 on eight real frames, DJI's file 0.38, Vivid 0.44) without its dark trees
 * (foliage luma 0.126 against DJI's 0.167, pixel-pooled). The sky alone is deepened before the look (×2.2 at
 * most, at DJI's hue rather than the D-Log path's cyan, never clipping), the S-curve is eased to 2 % with the toe
 * from 0.04 and the blacks lifted 0.4 % (black stays within four 8-bit levels), and the mids go a twelfth of a stop
 * brighter. Measured on the same frames: sky 0.67 at the same brightness, foliage 0.176 (5 % brighter than DJI's),
 * 1.4 % of pixels under 5 % luma (DJI's file 1.5 %, Vivid 4.1 %), nothing crushed or clipped.
 */
export const DEEP_SKY_LOOK: Look = { ...VIVID_LOOK, blueHue: 0, exposure: 0.08, hiDesat: 0.2, con: 1.02, toe: 0.04, lift: 0.004, sky: 1.2 };
/**
 * Night, asked for from two renderings of the November 2026 illuminated-maples drive ("sky black, asphalt black with
 * white lines, trees vivid and lit from the bottom up"). In DJI's file the asphalt (luma 106/255, saturation 0.17)
 * and the lamp-lit foliage (83, saturation 0.79) sit at the same brightness, so no tone curve separates them and the
 * look keys on saturation instead: greys lose their tint (0.8; cool tints such as headlight glare fully, at any
 * brightness) and are pulled 2.2 stops down, saturated warm mids gain a quarter of a stop, Vivid's colour follows
 * with skin protection off (the maples are that hue), contrast 1.12, near-white desaturation 0.3 so lines and lamps
 * stay white, and a toe from 0.10 reaches a true black; Vivid's own toe (which keeps shadows open) and the sky boost
 * (which finds the road at night) are off. Measured on eight real night frames: sky 1 (DJI 4), asphalt 24 (106),
 * lane lines 154 (176), lit foliage 87 at saturation 0.89 (83 at 0.79), lit against unlit foliage ×10.7 (×5.4),
 * nothing clipped. Chosen over a 1.5-stop and a 3-stop version as the one that reads black without hardening the
 * foliage edges.
 */
export const NIGHT_LOOK: Look = { ...VIVID_LOOK, skin: 0, exposure: 0, toe: 0, lift: 0, hiDesat: 0.3, shoulder: 0.88, warm: 0.03, con: 1.12, greyDesat: 0.8, greyPull: 2.2, warmLift: 0.25, nightToe: 0.1 };
const LOOKS: Record<MathLutKind | FileLutKind, Look> = {
  "dji-official": PLAIN,
  "dji-official-vivid": VIVID_LOOK,
  "dji-official-vivid-sky": DEEP_SKY_LOOK,
  "dji-official-night": NIGHT_LOOK,
  "dji-official-study": STUDY_LOOK,
  dlogm: PLAIN,
  "dlogm-study": STUDY_LOOK,
  "dlogm-natural": { ...PLAIN, sat: 0.88, con: 0.94 },
  "dlogm-vivid": VIVID_LOOK,
  "dlogm-vivid-sky": DEEP_SKY_LOOK,
  "dlogm-night": NIGHT_LOOK,
  dlog: PLAIN,
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** How skin-coloured a display pixel is: a hue between orange-red and yellow-orange with some colour in it. */
function skinWeight(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c < 0.03 || max !== r) return 0;
  // Hue in degrees for the red-dominant sextant: 0 at red, 60 at yellow (g ≥ b); b > r never counts.
  const hue = g >= b ? 60 * ((g - b) / c) : 360 - 60 * ((b - g) / c);
  if (hue > 60) return 0;
  return smoothstep(8, 18, hue) * (1 - smoothstep(40, 52, hue)) * smoothstep(0.03, 0.1, c);
}
/**
 * Extra colour for the sky: blue-dominant pixels out of the shadows and short of white, weighted by how blue they
 * are and fading out as they get rich (a pale sky gains most, a deep blue is left as it is), so clouds, greys, the
 * ground and strong blues are untouched. The chroma is scaled with the luma kept while the blue has room below
 * white; past that the other two channels are pulled down instead (the hue stays, the sky deepens a little, never by
 * more than a sixth of its brightness and never to a channel at zero), so nothing clips. Exported for the tests.
 */
export function skyBoost(rgb: [number, number, number], k: number): [number, number, number] {
  const [r, g, b] = rgb;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b, other = Math.max(r, g), min = Math.min(r, g);
  if (!(k > 0) || b <= other || b <= 0) return rgb;
  const w = smoothstep(0.02, 0.12, (b - r) / b) * smoothstep(0.12, 0.35, y) * (1 - smoothstep(0.88, 0.98, y)) * (1 - smoothstep(0.45, 0.85, (b - min) / b));
  if (w <= 0) return rgb;
  const want = 1 + k * w;
  const room = b > y ? (1 - y) / (b - y) : want;
  const roomMin = min < y ? y / (y - min) : want;
  const s1 = Math.max(1, Math.min(room, roomMin, want));
  let r1 = y + s1 * (r - y), g1 = y + s1 * (g - y);
  const b1 = y + s1 * (b - y);
  let rest = want / s1;
  if (rest > 1.001) {
    // Pulling the other channels down darkens: stop at a sixth of the luma, and short of zero on either channel.
    const drop = 0.2126 * (b1 - r1) + 0.7152 * (b1 - g1);
    const min1 = Math.min(r1, g1);
    rest = Math.min(rest, drop > 0 ? 1 + (y / 6) / drop : rest, min1 < b1 ? 0.9 * (b1 / (b1 - min1)) : rest);
    if (rest > 1) {
      r1 = b1 - (b1 - r1) * rest;
      g1 = b1 - (b1 - g1) * rest;
    }
  }
  return [r1, g1, b1];
}
/** HSV hue in degrees of a display pixel (0 for grey). */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), c = max - Math.min(r, g, b);
  if (c < 1e-6) return 0;
  if (max === r) return (60 * ((g - b) / c) + 360) % 360;
  if (max === g) return 60 * ((b - r) / c) + 120;
  return 60 * ((r - g) / c) + 240;
}
/**
 * The night moves, ahead of the rest of the look and keyed on saturation over wide bands (narrow ones posterise the
 * road), never on position: low-saturation pixels lose their tint — cool tints such as headlight glare on the road
 * at any brightness, up to a moderate saturation, so the glare turns white while a blue sign stays blue; other
 * tints out of the brights, so lamplight keeps its warmth — then low-saturation pixels out of the brights are pulled
 * down by `greyPull` stops (the asphalt, the pavement, what is left of the sky), and saturated warm pixels in the
 * mids are lifted by `warmLift` stops (lamp-lit foliage; the unlit crown is too dark and too grey to qualify, so the
 * light reads as climbing the tree). Lane lines, lamps and signs sit above or outside the bands. The saturation the
 * keys read is the pixel's before any of this. Exported for the tests.
 */
export function nightPre(rgb: [number, number, number], L: Look): [number, number, number] {
  let [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0, y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L.greyDesat) {
    const cool = max > 0 && b > r ? smoothstep(0, 0.08, (b - r) / max) * (1 - smoothstep(0.4, 0.65, sat)) : 0;
    const s = 1 - Math.max(L.greyDesat * (1 - smoothstep(0.25, 0.5, sat)) * (1 - smoothstep(0.5, 0.8, y)), cool);
    if (s < 1) {
      r = y + s * (r - y);
      g = y + s * (g - y);
      b = y + s * (b - y);
    }
  }
  let gain = 1;
  if (L.greyPull) gain *= 2 ** (-L.greyPull * (1 - smoothstep(0.25, 0.5, sat)) * (1 - smoothstep(0.3, 0.72, y)));
  if (L.warmLift && max > 0 && (max === r || (max === g && r > b))) {
    const h = hueOf(r, g, b);
    const hw = h <= 75 ? 1 - smoothstep(55, 75, h) : h >= 330 ? smoothstep(330, 350, h) : 0;
    gain *= 2 ** (L.warmLift * hw * smoothstep(0.25, 0.55, sat) * (1 - smoothstep(0.45, 0.75, y)));
  }
  return gain === 1 ? [r, g, b] : [r * gain, g * gain, b * gain];
}
/** A look applied to one display-referred RGB triplet; exported for the tests and for tuning. */
export function applyLook(rgb: [number, number, number], L: Look): [number, number, number] {
  let [r, g, b] = L.sky ? skyBoost(rgb, L.sky) : rgb;
  if (L.greyDesat || L.greyPull || L.warmLift) [r, g, b] = nightPre([r, g, b], L);
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
  let boost = L.sat - 1;
  if (L.vibrance) {
    // Richness as HSV saturation: 0 for grey, 1 for a pure colour; the vibrance fades out as it rises.
    const max = Math.max(r, g, b), c = max - Math.min(r, g, b);
    boost += L.vibrance * (1 - (max > 0 ? c / max : 0));
  }
  if (L.skin && boost > 0) boost *= 1 - L.skin * skinWeight(r, g, b);
  const s = (1 + boost) * (1 - L.hiDesat * smoothstep(0.7, 1, y));
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
  const k = L.shoulder, t = L.toe;
  const sh = (v: number) => (k < 1 && v > k ? k + (1 - k) * (1 - Math.exp(-(v - k) / (1 - k))) : v);
  // The toe mirrors the shoulder: below t it eases towards 0 instead of clipping, meeting the line at t with the same slope.
  const to = (v: number) => (t > 0 && v < t ? t * Math.exp(-(t - v) / t) : v);
  const nt = L.nightToe;
  const fin = (v: number) => {
    const o = clamp01(L.lift + (1 - L.lift) * clamp01(sh(to(v))));
    return nt > 0 && o < nt ? o * smoothstep(0, nt, o) : o;
  };
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
