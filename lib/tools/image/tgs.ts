/**
 * Pure helpers for the TGS (Telegram sticker) studio. A .tgs file is a
 * gzip-compressed Lottie/Bodymovin JSON with extra constraints (512×512,
 * ≤3 s, ≤60 fps, ≤64 KB, no images/text). Rendering happens in the widget;
 * everything here is data-in/data-out.
 */

/** Loose Lottie document — we only touch a few well-known keys. */
export type LottieJson = Record<string, unknown>;

export const TGS_MAX_BYTES = 64 * 1024;

export interface LottieInfo {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  inPoint: number;
  outPoint: number;
  /** Total frames (outPoint − inPoint). */
  frames: number;
  /** Seconds. */
  duration: number;
  version: string;
  layerCount: number;
  hasImages: boolean;
  hasText: boolean;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Throws if the JSON doesn't look like a Lottie animation. */
export function parseLottieInfo(anim: LottieJson): LottieInfo {
  const layers = Array.isArray(anim.layers) ? (anim.layers as LottieJson[]) : null;
  const fr = num(anim.fr);
  const op = num(anim.op);
  if (!layers || fr <= 0 || op <= 0)
    throw new Error("This JSON is not a Lottie animation (missing layers/fr/op).");
  const ip = num(anim.ip);
  const assets = Array.isArray(anim.assets) ? (anim.assets as LottieJson[]) : [];
  return {
    name: typeof anim.nm === "string" ? anim.nm : "",
    width: num(anim.w),
    height: num(anim.h),
    frameRate: fr,
    inPoint: ip,
    outPoint: op,
    frames: Math.max(1, Math.round(op - ip)),
    duration: (op - ip) / fr,
    version: typeof anim.v === "string" ? anim.v : "?",
    layerCount: layers.length,
    hasImages: assets.some((a) => typeof a.p === "string" || typeof a.u === "string"),
    hasText: layers.some((l) => num(l.ty, -1) === 5),
  };
}

export interface TelegramCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Telegram animated-sticker requirements, checkable from the JSON + size. */
export function telegramChecks(info: LottieInfo, tgsBytes: number | null): TelegramCheck[] {
  const checks: TelegramCheck[] = [
    {
      label: "Canvas is 512 × 512",
      ok: info.width === 512 && info.height === 512,
      detail: `${info.width} × ${info.height}`,
    },
    {
      label: "Duration ≤ 3 s",
      ok: info.duration <= 3.001,
      detail: `${info.duration.toFixed(2)} s`,
    },
    {
      label: "Frame rate ≤ 60 fps",
      ok: info.frameRate <= 60,
      detail: `${info.frameRate} fps`,
    },
    {
      label: "No bitmap images",
      ok: !info.hasImages,
      detail: info.hasImages ? "image assets found" : "vector only",
    },
    {
      label: "No text layers",
      ok: !info.hasText,
      detail: info.hasText ? "text layers found" : "none",
    },
  ];
  if (tgsBytes !== null)
    checks.push({
      label: ".tgs size ≤ 64 KB",
      ok: tgsBytes <= TGS_MAX_BYTES,
      detail: `${(tgsBytes / 1024).toFixed(1)} KB`,
    });
  return checks;
}

/* ------------------------------------------------------------------ colors */

export interface ColorUse {
  hex: string;
  /** Uses as a fill, stroke, solid layer or gradient stop. */
  count: number;
  /** How many of those uses are gradient stops. */
  gradient: number;
}

export type ColorKind = "fill" | "stroke" | "gradient" | "solid";

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** One color in the document: its current hex and a writer taking a replacement [r, g, b] (0–1 floats). */
interface ColorSlot {
  hex: string;
  write: (rgb: [number, number, number]) => void;
}

/**
 * Visit every color-bearing node in the document — solid fills and strokes (static or keyframed), gradient fills and
 * strokes (every color stop, static or keyframed), and solid layers — with all of that node's colors together.
 */
function walkColorNodes(node: unknown, visit: (slots: ColorSlot[], kind: ColorKind) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkColorNodes(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as LottieJson;

  const slot = (arr: number[], o: number): ColorSlot => ({
    hex: rgbToHex(arr[o], arr[o + 1], arr[o + 2]),
    write: (rgb) => {
      arr[o] = rgb[0];
      arr[o + 1] = rgb[1];
      arr[o + 2] = rgb[2];
    },
  });

  if ((obj.ty === "fl" || obj.ty === "st") && obj.c && typeof obj.c === "object") {
    const slots: ColorSlot[] = [];
    const k = (obj.c as LottieJson).k;
    if (Array.isArray(k) && typeof k[0] === "number" && k.length >= 3) slots.push(slot(k as number[], 0));
    else if (Array.isArray(k)) {
      for (const kf of k as LottieJson[]) {
        const s = kf?.s;
        if (Array.isArray(s) && typeof s[0] === "number" && s.length >= 3) slots.push(slot(s as number[], 0));
      }
    }
    if (slots.length) visit(slots, obj.ty === "fl" ? "fill" : "stroke");
  }

  // A gradient's stops are one flat array: [offset, r, g, b] × p color stops, then [offset, alpha] pairs.
  if ((obj.ty === "gf" || obj.ty === "gs") && obj.g && typeof obj.g === "object") {
    const g = obj.g as LottieJson;
    const p = typeof g.p === "number" && g.p > 0 ? g.p : Infinity;
    const slots: ColorSlot[] = [];
    const stops = (arr: number[]) => {
      const n = Math.min(p, Math.floor(arr.length / 4));
      for (let i = 0; i < n; i++) slots.push(slot(arr, i * 4 + 1));
    };
    const kk = g.k && typeof g.k === "object" ? (g.k as LottieJson).k : undefined;
    if (Array.isArray(kk) && typeof kk[0] === "number") stops(kk as number[]);
    else if (Array.isArray(kk)) {
      for (const kf of kk as LottieJson[]) {
        const s = kf?.s;
        if (Array.isArray(s) && typeof s[0] === "number") stops(s as number[]);
      }
    }
    if (slots.length) visit(slots, "gradient");
  }

  if (typeof obj.sc === "string" && /^#[0-9a-fA-F]{6}$/.test(obj.sc)) {
    visit(
      [
        {
          hex: obj.sc.toLowerCase(),
          write: (rgb) => {
            obj.sc = rgbToHex(rgb[0], rgb[1], rgb[2]);
          },
        },
      ],
      "solid",
    );
  }

  for (const key of Object.keys(obj)) walkColorNodes(obj[key], visit);
}

/** Visit every color in the document, one at a time, with what kind of use it is. */
function walkColors(node: unknown, visit: (hex: string, write: ColorSlot["write"], kind: ColorKind) => void): void {
  walkColorNodes(node, (slots, kind) => {
    for (const s of slots) visit(s.hex, s.write, kind);
  });
}

/**
 * A copy in which only `spot` keeps its color (as mapped) — every other color becomes `dim`. A gradient that has
 * `spot` among its stops is kept whole, since the stop paints the gradient's shape together with the others.
 */
export function highlightColor(anim: LottieJson, spot: string, map: Record<string, string>, dim = "#9a9a9a"): LottieJson {
  const copy = structuredClone(anim);
  const dimRgb = hexToRgb(dim);
  walkColorNodes(copy, (slots) => {
    const keep = slots.some((s) => s.hex === spot);
    for (const s of slots) s.write(keep ? hexToRgb(map[s.hex] ?? s.hex) : dimRgb);
  });
  return copy;
}

/** Unique colors used by fills, strokes, gradient stops and solids, most frequent first. */
export function collectColors(anim: LottieJson): ColorUse[] {
  const uses = new Map<string, ColorUse>();
  walkColors(anim, (hex, _write, kind) => {
    const u = uses.get(hex) ?? { hex, count: 0, gradient: 0 };
    u.count++;
    if (kind === "gradient") u.gradient++;
    uses.set(hex, u);
  });
  return [...uses.values()].sort((a, b) => b.count - a.count);
}

/**
 * Returns a deep copy with colors swapped per `map` (original hex → new hex).
 * Mapping always from the ORIGINAL document keeps repeated edits stable.
 */
export function applyColorMap(anim: LottieJson, map: Record<string, string>): LottieJson {
  const copy = structuredClone(anim);
  walkColors(copy, (hex, write) => {
    const to = map[hex];
    if (to) write(hexToRgb(to));
  });
  return copy;
}

/* -------------------------------------------------------------- gzip (tgs) */

export function isGzipData(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isZipData(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function pipe(data: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream("gzip"));
}

/** Serialize an animation as a .tgs payload (adds the `tgs: 1` marker). */
export function serializeTgs(anim: LottieJson): Promise<Uint8Array> {
  const json = JSON.stringify({ ...anim, tgs: 1 });
  return pipe(new TextEncoder().encode(json), new CompressionStream("gzip"));
}

/* ------------------------------------------------------------------ links */

/** Gzip of the plain animation JSON — what a share link carries. */
export function gzipJson(anim: LottieJson): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(JSON.stringify(anim)), new CompressionStream("gzip"));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
export const MAX_COLOR_MAP = 500;

/** Keeps only `#rrggbb → #rrggbb` entries, lower-cased, capped in number. */
export function parseColorMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== "string" || !HEX_RE.test(k) || !HEX_RE.test(v)) continue;
    out[k.toLowerCase()] = v.toLowerCase();
    if (++n >= MAX_COLOR_MAP) break;
  }
  return out;
}

/* ------------------------------------------------------------ pixel lookup */

/** The palette entry closest to an on-screen pixel (0–255 channels), with the RGB distance (0–441). */
export function nearestColor(rgb: [number, number, number], palette: string[]): { hex: string; distance: number } | null {
  let best: { hex: string; distance: number } | null = null;
  for (const hex of palette) {
    const [r, g, b] = hexToRgb(hex);
    const d = Math.hypot(r * 255 - rgb[0], g * 255 - rgb[1], b * 255 - rgb[2]);
    if (!best || d < best.distance) best = { hex, distance: d };
  }
  return best;
}

export function pixelHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------- sample data */

/** Tiny hand-written Lottie meeting every Telegram constraint — demo/testing. */
export function sampleSticker(): LottieJson {
  const transform = {
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
  return {
    v: "5.5.2",
    fr: 60,
    ip: 0,
    op: 180,
    w: 512,
    h: 512,
    nm: "Bench Bounce",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "ball",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: {
            a: 1,
            k: [
              { i: { x: 0.3, y: 1 }, o: { x: 0.7, y: 0 }, t: 0, s: [256, 150, 0], to: [0, 43, 0], ti: [0, -43, 0] },
              { i: { x: 0.3, y: 1 }, o: { x: 0.7, y: 0 }, t: 90, s: [256, 408, 0], to: [0, -43, 0], ti: [0, 43, 0] },
              { t: 180, s: [256, 150, 0] },
            ],
          },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [170, 170] } },
              { ty: "fl", c: { a: 0, k: [0.282, 0.784, 0.949, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr", ...transform },
            ],
          },
        ],
        ip: 0,
        op: 180,
        st: 0,
        bm: 0,
      },
      {
        ddd: 0,
        ind: 2,
        ty: 4,
        nm: "ground",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [256, 468, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        shapes: [
          {
            ty: "gr",
            it: [
              { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [340, 26] }, r: { a: 0, k: 13 } },
              { ty: "fl", c: { a: 0, k: [0.784, 0.945, 0.208, 1] }, o: { a: 0, k: 100 } },
              { ty: "tr", ...transform },
            ],
          },
        ],
        ip: 0,
        op: 180,
        st: 0,
        bm: 0,
      },
    ],
  };
}
