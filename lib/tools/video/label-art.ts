/**
 * The pictures behind the labels: decoding them and drawing them on a frame. An SVG is drawn through an <img> (the
 * only way Chrome decodes one: createImageBitmap refuses SVG, and in an image nothing in it runs or loads) and
 * rasterised at the size it lands at, so it is as sharp in an 8K export as in the preview; a GIF, an animated PNG or
 * an animated WebP is decoded frame by frame with each frame's own delay, and the frame shown is picked from the
 * timeline's time, so the preview, a saved frame and the export agree. The entrance and exit moves are the titles'.
 */
import { animationFrameAt, artBytes, labelBox, labelSource, overlayPhase, type LabelArt, type LabelArtType, type LabelLoop, type Project, type TitleEnter, type TitleExit } from "./project";

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A picture ready to draw. */
export interface LoadedArt {
  type: LabelArtType;
  /** Its own size in pixels (an SVG's as the browser reads it: its width and height, else its viewBox's shape). */
  width: number;
  height: number;
  /** How many frames it has, and how long one pass runs (0 for a still). */
  frames: number;
  seconds: number;
  /** Set when not every frame could be kept in memory. */
  note?: string;
  /** The image to draw `local` seconds into the label, for a box of w × h output pixels. */
  imageAt(local: number, loop: LabelLoop, w: number, h: number): CanvasImageSource;
  dispose(): void;
}
/** Loaded pictures by label source (see labelSource): "art:<key>" or "media:<id>". */
export type LabelArtMap = ReadonlyMap<string, LoadedArt>;

/** The decoded frames of one animation may take this much memory; a longer one keeps its first frames. */
export const MAX_ANIMATION_BYTES = 256 * 1024 * 1024;
/** Browsers play a frame with a delay of 10 ms or less at 100 ms; so does the editor, so a GIF runs as it does elsewhere. */
export const frameSeconds = (micros: number | null | undefined) => (!micros || micros <= 10_000 ? 0.1 : micros / 1e6);

const EXT_TYPES: Record<string, LabelArtType> = { svg: "image/svg+xml", png: "image/png", apng: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
/** The kind of picture a file is, from its type or its name; null when it is not one a label can show. */
export function artTypeOf(file: { type?: string; name?: string }): LabelArtType | null {
  const t = (file.type ?? "").toLowerCase().split(";")[0];
  if (t === "image/jpg") return "image/jpeg";
  if (t === "image/apng") return "image/png";
  if ((Object.values(EXT_TYPES) as string[]).includes(t)) return t as LabelArtType;
  return EXT_TYPES[(file.name ?? "").toLowerCase().split(".").pop() ?? ""] ?? null;
}

/** SVG markup an <img> will take: the namespace it needs is added when the author left it out. */
export function svgMarkup(text: string): string {
  const s = text.trim();
  if (/<svg\b[^>]*\sxmlns\s*=/.test(s)) return s;
  return s.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export function base64Bytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadSvg(markup: string): Promise<LoadedArt> {
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(markup))}`;
  try {
    await img.decode();
  } catch {
    throw new Error("The SVG could not be drawn: it is not well-formed.");
  }
  const width = img.naturalWidth || 300,
    height = img.naturalHeight || 150;
  // The vector drawn once per size it is asked for: the preview's and the export's, each kept.
  const rasters = new Map<string, OffscreenCanvas>();
  return {
    type: "image/svg+xml",
    width,
    height,
    frames: 1,
    seconds: 0,
    imageAt(_local, _loop, w, h) {
      const rw = Math.max(1, Math.min(16384, Math.round(w))),
        rh = Math.max(1, Math.min(16384, Math.round(h)));
      const key = `${rw}x${rh}`;
      let c = rasters.get(key);
      if (!c) {
        c = new OffscreenCanvas(rw, rh);
        c.getContext("2d")!.drawImage(img, 0, 0, rw, rh);
        if (rasters.size >= 4) rasters.delete(rasters.keys().next().value!);
        rasters.set(key, c);
      }
      return c;
    },
    dispose() {
      rasters.clear();
    },
  };
}

function still(type: LabelArtType, bmp: ImageBitmap): LoadedArt {
  return { type, width: bmp.width, height: bmp.height, frames: 1, seconds: 0, imageAt: () => bmp, dispose: () => bmp.close() };
}

async function loadRaster(type: LabelArtType, blob: Blob): Promise<LoadedArt> {
  const Decoder = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
  if (type !== "image/jpeg" && Decoder && (await Decoder.isTypeSupported(type).catch(() => false))) {
    const decoder = new Decoder({ data: await blob.arrayBuffer(), type });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      const count = track?.frameCount ?? 1;
      if (track?.animated && count > 1) {
        const frames: ImageBitmap[] = [];
        const ends: number[] = [];
        let at = 0,
          note: string | undefined;
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          if (i > 0 && (frames.length + 1) * image.displayWidth * image.displayHeight * 4 > MAX_ANIMATION_BYTES) {
            image.close();
            note = `Only the first ${frames.length} of its ${count} frames are played: the rest would not fit in memory.`;
            break;
          }
          at += frameSeconds(image.duration);
          frames.push(await createImageBitmap(image));
          ends.push(at);
          image.close();
        }
        return {
          type,
          width: frames[0].width,
          height: frames[0].height,
          frames: frames.length,
          seconds: at,
          ...(note ? { note } : {}),
          imageAt: (local, loop) => frames[animationFrameAt(ends, local, loop)],
          dispose: () => frames.forEach((f) => f.close()),
        };
      }
    } finally {
      decoder.close();
    }
  }
  try {
    return still(type, await createImageBitmap(blob));
  } catch {
    throw new Error("The image could not be decoded.");
  }
}

/** Decode a picture: art stored in the project, or a file from disk. */
export async function loadArt(source: Pick<LabelArt, "type" | "data"> | File): Promise<LoadedArt> {
  if (source instanceof Blob) {
    const type = artTypeOf(source);
    if (!type) throw new Error(`${source.name} is not an SVG, PNG, JPEG, WebP or GIF.`);
    return type === "image/svg+xml" ? loadSvg(await source.text()) : loadRaster(type, source);
  }
  if (source.type === "image/svg+xml") return loadSvg(source.data);
  return loadRaster(source.type, new Blob([base64Bytes(source.data)], { type: source.type }));
}

/** A file as art to store in the project (what pasting or dropping a small picture does). */
export async function fileArt(file: File): Promise<Pick<LabelArt, "type" | "data">> {
  const type = artTypeOf(file);
  if (!type) throw new Error(`${file.name} is not an SVG, PNG, JPEG, WebP or GIF.`);
  return type === "image/svg+xml" ? { type, data: svgMarkup(await file.text()) } : { type, data: bytesBase64(new Uint8Array(await file.arrayBuffer())) };
}

export { artBytes };

/**
 * The logo watermark's bitmap. Chrome's createImageBitmap refuses an SVG file, so an SVG logo is drawn through an
 * <img> at up to 4096 px on its long side — more than the 30 % of an 8K frame the watermark can take.
 */
export async function logoBitmap(file: File): Promise<ImageBitmap> {
  if (artTypeOf(file) !== "image/svg+xml") return createImageBitmap(file);
  const svg = await loadSvg(await file.text());
  const k = 4096 / Math.max(svg.width, svg.height);
  const w = Math.max(1, Math.round(svg.width * k)),
    h = Math.max(1, Math.round(svg.height * k));
  return createImageBitmap(svg.imageAt(0, "loop", w, h) as OffscreenCanvas);
}

/**
 * The entrance over the fade-in and the exit over the fade-out, shared by titles and labels: the block moves, scales
 * or blurs as a whole about its centre. `px` sets the blur's strength (a title's text size).
 */
export function applyEntrance(ctx: Ctx, enterKind: TitleEnter | undefined, exitKind: TitleExit | undefined, enter: number, exit: number, cx: number, cy: number, w: number, h: number, px: number) {
  const scaleAt = (k: number) => {
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
  };
  if (enter < 1) {
    switch (enterKind) {
      case "pop":
        scaleAt(0.92 + 0.08 * enter);
        break;
      case "rise":
        ctx.translate(0, (1 - enter) * h * 0.02);
        break;
      case "slideLeft":
        ctx.translate(-(1 - enter) * w * 0.12, 0);
        break;
      case "slideRight":
        ctx.translate((1 - enter) * w * 0.12, 0);
        break;
      case "slideUp":
        ctx.translate(0, (1 - enter) * h * 0.08);
        break;
      case "slideDown":
        ctx.translate(0, -(1 - enter) * h * 0.08);
        break;
      case "zoomOut":
        scaleAt(1 + 0.35 * (1 - enter));
        break;
      case "blur":
        if ("filter" in ctx) ctx.filter = `blur(${((1 - enter) * px * 0.35).toFixed(1)}px)`;
        break;
      default:
        break;
    }
  }
  if (exit < 1) {
    switch (exitKind) {
      case "popOut":
        scaleAt(1 - 0.08 * (1 - exit));
        break;
      case "slideOut":
        ctx.translate((1 - exit) * w * 0.12, 0);
        break;
      case "drop":
        ctx.translate(0, (1 - exit) * h * 0.06);
        break;
      default:
        break;
    }
  }
}

/** The labels on at t, drawn over the frame; one whose picture is not loaded is left out. */
export function drawLabels(ctx: Ctx, w: number, h: number, t: number, project: Pick<Project, "labels" | "safeArea">, art: LabelArtMap | null | undefined) {
  if (!project.labels?.length || !art) return;
  for (const l of project.labels) {
    const phase = overlayPhase(l, t);
    if (!phase) continue;
    const a = art.get(labelSource(l));
    if (!a) continue;
    const box = labelBox(l, a.width / a.height, w, h, project.safeArea);
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2;
    ctx.save();
    ctx.globalAlpha = l.opacity * Math.min(phase.enter, phase.exit);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    applyEntrance(ctx, l.enter, l.exit, phase.enter, phase.exit, cx, cy, w, h, box.h * 0.3);
    if (l.rotate) {
      ctx.translate(cx, cy);
      ctx.rotate((l.rotate * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(a.imageAt(phase.local, l.loop ?? "loop", box.w, box.h), box.x, box.y, box.w, box.h);
    ctx.restore();
  }
}
