/** Color conversions for the Color Converter: HEX, RGB, HSL, OKLCH + contrast. */

export interface RGBA {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function rgbToHex({ r, g, b, a }: RGBA): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a < 1 ? `${base}${h(a * 255)}` : base;
}

export function rgbToHsl({ r, g, b, a }: RGBA): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return a < 1
    ? `hsla(${H}, ${S}%, ${L}%, ${+a.toFixed(2)})`
    : `hsl(${H}, ${S}%, ${L}%)`;
}

const linearize = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

export function rgbToOklch({ r, g, b, a }: RGBA): string {
  const lr = linearize(r), lg = linearize(g), lb = linearize(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  const Lp = (L * 100).toFixed(1);
  const Cp = C.toFixed(4);
  const Hp = H.toFixed(2);
  return a < 1
    ? `oklch(${Lp}% ${Cp} ${Hp} / ${+a.toFixed(2)})`
    : `oklch(${Lp}% ${Cp} ${Hp})`;
}

function relLuminance({ r, g, b }: RGBA): number {
  const lr = linearize(r), lg = linearize(g), lb = linearize(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relLuminance(a), lb = relLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  hwb: string;
  oklch: string;
  cmyk: string;
}

export function toFormats(c: RGBA): ColorFormats {
  return {
    hex: rgbToHex(c),
    rgb:
      c.a < 1
        ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(2)})`
        : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`,
    hsl: rgbToHsl(c),
    hwb: rgbToHwb(c),
    oklch: rgbToOklch(c),
    cmyk: rgbToCmyk(c),
  };
}

/** Pure hex parser (#rgb / #rgba / #rrggbb / #rrggbbaa) — no DOM needed. */
export function parseHex(hex: string): RGBA | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/* ----------------------------------------------- HSV (for the colour picker) */

export interface HSV {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv({ r, g, b }: { r: number; g: number; b: number }): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex(h: number, s: number, v: number, a = 1): string {
  return rgbToHex({ ...hsvToRgb(h, s, v), a });
}

export function rgbToHwb({ r, g, b, a }: RGBA): string {
  const { h } = rgbToHsv({ r, g, b });
  const w = Math.min(r, g, b) / 255;
  const bl = 1 - Math.max(r, g, b) / 255;
  const base = `hwb(${Math.round(h)} ${Math.round(w * 100)}% ${Math.round(bl * 100)}%`;
  return a < 1 ? `${base} / ${+a.toFixed(2)})` : `${base})`;
}

export function rgbToCmyk({ r, g, b }: RGBA): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return "cmyk(0%, 0%, 0%, 100%)";
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return `cmyk(${Math.round(c * 100)}%, ${Math.round(m * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%)`;
}

/* --------------------------------------------------------- nearest CSS name */

const NAMED: [string, number, number, number][] = [
  ["black", 0, 0, 0], ["white", 255, 255, 255], ["red", 255, 0, 0],
  ["green", 0, 128, 0], ["blue", 0, 0, 255], ["yellow", 255, 255, 0],
  ["cyan", 0, 255, 255], ["magenta", 255, 0, 255], ["orange", 255, 165, 0],
  ["purple", 128, 0, 128], ["pink", 255, 192, 203], ["brown", 165, 42, 42],
  ["gray", 128, 128, 128], ["silver", 192, 192, 192], ["gold", 255, 215, 0],
  ["navy", 0, 0, 128], ["teal", 0, 128, 128], ["olive", 128, 128, 0],
  ["maroon", 128, 0, 0], ["lime", 0, 255, 0], ["indigo", 75, 0, 130],
  ["violet", 238, 130, 238], ["coral", 255, 127, 80], ["salmon", 250, 128, 114],
  ["crimson", 220, 20, 60], ["tomato", 255, 99, 71], ["turquoise", 64, 224, 208],
  ["skyblue", 135, 206, 235], ["royalblue", 65, 105, 225], ["slateblue", 106, 90, 205],
  ["seagreen", 46, 139, 87], ["forestgreen", 34, 139, 34], ["khaki", 240, 230, 140],
  ["plum", 221, 160, 221], ["orchid", 218, 112, 214], ["chocolate", 210, 105, 30],
  ["tan", 210, 180, 140], ["beige", 245, 245, 220], ["lavender", 230, 230, 250],
  ["mint", 189, 252, 201], ["ivory", 255, 255, 240], ["charcoal", 54, 69, 79],
];

export function nearestNamed({ r, g, b }: RGBA): string {
  let best = "", min = Infinity;
  for (const [name, nr, ng, nb] of NAMED) {
    const d = (r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2;
    if (d < min) { min = d; best = name; }
  }
  return best;
}

/** Colour-harmony hues (relative to a base hue) → hex strings. */
export function harmony(h: number, s: number, v: number, offsets: number[]): string[] {
  return offsets.map((o) => hsvToHex((h + o + 360) % 360, s, v));
}

/** A lightness ramp (tints → shades) of the base hue/sat. */
export function shadeRamp(h: number, s: number, steps = 9): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const v = 0.95 - (i / (steps - 1)) * 0.85;
    return hsvToHex(h, s, v);
  });
}
