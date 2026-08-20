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
  count: number;
}

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

/**
 * Visit every solid fill/stroke color in the document. Handles static values,
 * keyframed colors, and solid-layer `sc` hex strings. Gradients are left
 * alone. `visit` receives the current hex and may return a replacement
 * [r, g, b] (0–1 floats) to write back.
 */
function walkColors(
  node: unknown,
  visit: (hex: string, write: (rgb: [number, number, number]) => void) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) walkColors(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as LottieJson;

  if ((obj.ty === "fl" || obj.ty === "st") && obj.c && typeof obj.c === "object") {
    const c = obj.c as LottieJson;
    const k = c.k;
    if (Array.isArray(k) && typeof k[0] === "number" && k.length >= 3) {
      const arr = k as number[];
      visit(rgbToHex(arr[0], arr[1], arr[2]), (rgb) => {
        arr[0] = rgb[0];
        arr[1] = rgb[1];
        arr[2] = rgb[2];
      });
    } else if (Array.isArray(k)) {
      for (const kf of k as LottieJson[]) {
        const s = kf?.s;
        if (Array.isArray(s) && typeof s[0] === "number" && s.length >= 3) {
          const arr = s as number[];
          visit(rgbToHex(arr[0], arr[1], arr[2]), (rgb) => {
            arr[0] = rgb[0];
            arr[1] = rgb[1];
            arr[2] = rgb[2];
          });
        }
      }
    }
  }

  if (typeof obj.sc === "string" && /^#[0-9a-fA-F]{6}$/.test(obj.sc)) {
    visit(obj.sc.toLowerCase(), (rgb) => {
      obj.sc = rgbToHex(rgb[0], rgb[1], rgb[2]);
    });
  }

  for (const key of Object.keys(obj)) walkColors(obj[key], visit);
}

/** Unique solid colors used by fills/strokes/solids, most frequent first. */
export function collectColors(anim: LottieJson): ColorUse[] {
  const counts = new Map<string, number>();
  walkColors(anim, (hex) => counts.set(hex, (counts.get(hex) ?? 0) + 1));
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count);
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
