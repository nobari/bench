"use client";

/**
 * Main-thread rendering helpers: pages to images with pdf.js (with black boxes for redaction when asked), image files
 * to PNG or JPEG bytes pdf-lib can embed, and the pictures of signatures and stamps.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ImageFile } from "@/lib/tools/files/pdf/stamps";

export interface RenderOptions {
  dpi: number;
  format: "png" | "jpeg";
  quality?: number;
  /** Extra rotation on top of the page's own, degrees. */
  rotation?: number;
  /** Rectangles in PDF user space to paint black. */
  boxes?: [number, number, number, number][];
  /** Draw the page's annotations too. */
  annotations?: boolean;
}

export async function renderPage(pdf: PDFDocumentProxy, pageIndex: number, opts: RenderOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const page = await pdf.getPage(pageIndex + 1);
  const scale = opts.dpi / 72;
  const viewport = page.getViewport({ scale, rotation: (page.rotate + (opts.rotation ?? 0)) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  if (opts.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvasContext: ctx, canvas, viewport, annotationMode: opts.annotations === false ? 0 : 1 } as never).promise;
  if (opts.boxes?.length) {
    ctx.fillStyle = "#000000";
    for (const [x0, y0, x1, y1] of opts.boxes) {
      const a = viewport.convertToViewportPoint(x0, y0), b = viewport.convertToViewportPoint(x1, y1);
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opts.format === "png" ? "image/png" : "image/jpeg", opts.quality ?? 0.9));
  if (!blob) throw new Error("The page could not be encoded");
  return { blob, width: canvas.width, height: canvas.height };
}

export async function renderPageFile(pdf: PDFDocumentProxy, pageIndex: number, opts: RenderOptions): Promise<ImageFile> {
  const { blob } = await renderPage(pdf, pageIndex, opts);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: opts.format === "png" ? "png" : "jpg" };
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const isPng = (b: Uint8Array) => PNG.every((v, i) => b[i] === v);
const isJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

export const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff|svg\+xml)$/i;
export const isImageFile = (f: File) => IMAGE_TYPES.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?|svg)$/i.test(f.name);

/** An image file as bytes pdf-lib can embed: PNG and JPEG pass through, anything else is drawn to a canvas. */
export async function toPdfImage(file: File): Promise<ImageFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) return { bytes, kind: "png", name: file.name };
  if (isJpg(bytes)) return { bytes, kind: "jpg", name: file.name };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`“${file.name}” could not be decoded as an image.`);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(`“${file.name}” could not be converted.`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: "png", name: file.name.replace(/\.[^.]+$/, ".png") };
}

/* ------------------------------------------------------------ pictures */

export type Point = { x: number; y: number; p: number };

/** A drawn signature as a transparent PNG: strokes in device pixels, scaled up for crispness. */
export async function signatureFromStrokes(strokes: Point[][], color: string, width: number, box: { width: number; height: number }): Promise<Blob> {
  // Crop to the ink with a margin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) throw new Error("Nothing was drawn");
  const pad = width * 2 + 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(box.width, maxX + pad);
  maxY = Math.min(box.height, maxY + pad);
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((maxX - minX) * scale));
  canvas.height = Math.max(1, Math.round((maxY - minY) * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(s[0].x, s[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      ctx.lineWidth = width * (0.6 + 0.8 * ((a.p + b.p) / 2));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  return canvasBlob(canvas);
}

export const SIGNATURE_FONTS: { id: string; label: string; family: string }[] = [
  { id: "script", label: "Script", family: "'Snell Roundhand', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', 'Apple Chancery', cursive" },
  { id: "hand", label: "Handwritten", family: "'Bradley Hand', 'Comic Sans MS', 'Segoe Print', 'Chalkboard', cursive" },
  { id: "serif", label: "Serif italic", family: "Georgia, 'Times New Roman', serif" },
  { id: "sans", label: "Plain", family: "var(--font-sans), Arial, sans-serif" },
];

/** A typed signature as a transparent PNG. */
export async function signatureFromText(text: string, fontId: string, color: string): Promise<Blob> {
  const font = SIGNATURE_FONTS.find((f) => f.id === fontId) ?? SIGNATURE_FONTS[0];
  const size = 64;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `${font.id === "serif" ? "italic " : ""}${size}px ${font.family}`;
  const m = probe.measureText(text);
  const w = Math.ceil(m.width + size * 0.6), h = Math.ceil(size * 1.6);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = probe.font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, size * 0.3, h / 2);
  return canvasBlob(canvas);
}

export interface StampSpec {
  text: string;
  subtitle?: string;
  color: string;
  /** "box": rounded border; "plain": text only; "round": circular seal. */
  shape: "box" | "plain" | "round";
}

/** A stamp as a transparent PNG at 3× for crisp edges. */
export async function stampImage(spec: StampSpec): Promise<Blob> {
  const scale = 3;
  const size = 36;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `bold ${size}px var(--font-sans), Arial, sans-serif`;
  const tw = probe.measureText(spec.text.toUpperCase()).width;
  probe.font = `${size * 0.4}px var(--font-sans), Arial, sans-serif`;
  const sw = spec.subtitle ? probe.measureText(spec.subtitle).width : 0;
  const padX = size * 0.6, padY = size * 0.35;
  const w = spec.shape === "round" ? size * 5 : Math.ceil(Math.max(tw, sw) + padX * 2);
  const h = spec.shape === "round" ? size * 5 : Math.ceil(size * 1.15 + (spec.subtitle ? size * 0.55 : 0) + padY * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.strokeStyle = spec.color;
  ctx.fillStyle = spec.color;
  ctx.lineWidth = 3;
  if (spec.shape === "box") {
    const r = 8;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, r);
    ctx.stroke();
  } else if (spec.shape === "round") {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fit = (text: string, px: number, maxW: number, weight: string) => {
    let s = px;
    ctx.font = `${weight} ${s}px var(--font-sans), Arial, sans-serif`;
    while (s > 8 && ctx.measureText(text).width > maxW) {
      s -= 1;
      ctx.font = `${weight} ${s}px var(--font-sans), Arial, sans-serif`;
    }
  };
  const maxW = spec.shape === "round" ? w * 0.7 : w - padX * 2;
  fit(spec.text.toUpperCase(), size, maxW, "bold");
  ctx.fillText(spec.text.toUpperCase(), w / 2, spec.subtitle ? h / 2 - size * 0.22 : h / 2);
  if (spec.subtitle) {
    fit(spec.subtitle, size * 0.4, maxW, "normal");
    ctx.fillText(spec.subtitle, w / 2, h / 2 + size * 0.42);
  }
  return canvasBlob(canvas);
}

/** Makes near-white pixels transparent (for a photographed or scanned signature). */
export async function removeWhiteBackground(file: File, threshold = 235): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const min = Math.min(d[i], d[i + 1], d[i + 2]);
    if (min >= threshold) d[i + 3] = 0;
    else if (min > threshold - 40) d[i + 3] = Math.round((255 * (threshold - min)) / 40);
  }
  ctx.putImageData(img, 0, 0);
  return canvasBlob(canvas);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be encoded"))), "image/png"));
}

export const blobToFile = (blob: Blob, name: string) => new File([blob], name, { type: blob.type || "image/png" });
