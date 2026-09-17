/**
 * Base64 ⇄ image helpers: tolerant Base64 / data-URI parsing, MIME sniffing
 * from magic bytes, and the copy-ready snippets (data URI, HTML, CSS,
 * Markdown, URL-encoded SVG).
 */

export interface Sniffed {
  mime: string;
  ext: string;
}

const SIGNATURES: { mime: string; ext: string; bytes: number[]; offset?: number }[] = [
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", ext: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/bmp", ext: "bmp", bytes: [0x42, 0x4d] },
  { mime: "image/x-icon", ext: "ico", bytes: [0x00, 0x00, 0x01, 0x00] },
  { mime: "image/tiff", ext: "tif", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { mime: "image/tiff", ext: "tif", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { mime: "application/pdf", ext: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
];

/** Identify an image format from its first bytes; null when unknown. */
export function sniffMime(bytes: Uint8Array): Sniffed | null {
  for (const s of SIGNATURES) {
    const off = s.offset ?? 0;
    if (bytes.length >= off + s.bytes.length && s.bytes.every((b, i) => bytes[off + i] === b)) return { mime: s.mime, ext: s.ext };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand.startsWith("avi")) return { mime: "image/avif", ext: "avif" };
    if (brand.startsWith("hei") || brand.startsWith("mif")) return { mime: "image/heic", ext: "heic" };
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 512)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return { mime: "image/svg+xml", ext: "svg" };
  return null;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/tiff": "tif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export function extensionFor(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? "bin";
}

/** Base64 length for a byte count (with padding). */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(out);
}

export interface ParsedBase64 {
  /** Normalised standard Base64 (padded, no whitespace). */
  base64: string;
  bytes: Uint8Array;
  /** MIME from the data URI prefix, if there was one. */
  declaredMime: string | null;
  /** MIME sniffed from the bytes, if recognised. */
  sniffed: Sniffed | null;
}

/**
 * Accepts a data URI, raw Base64, Base64URL, wrapped lines, missing padding,
 * or a `url("data:…")` / `src="data:…"` fragment. Returns null when the text
 * isn't Base64 at all.
 */
export function parseBase64Input(input: string): ParsedBase64 | null {
  let text = input.trim();
  const uriMatch = text.match(/data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[^;,]*)*)(;base64)?,([\s\S]*)$/i);
  let declaredMime: string | null = null;
  let isUriEncoded = false;
  if (uriMatch) {
    declaredMime = uriMatch[1]?.toLowerCase() ?? null;
    isUriEncoded = !uriMatch[3];
    // Inside url("…") or src="…" fragments the payload ends at the first quote, paren or tag close.
    // URL-encoded SVG keeps its single quotes and parentheses, so only a double quote or a trailing ");" ends it.
    text = isUriEncoded ? uriMatch[4].split('"')[0].replace(/[)\s;]+$/, "") : (uriMatch[4].match(/^[A-Za-z0-9+/=\-_\s]*/)?.[0] ?? "");
  }
  if (isUriEncoded) {
    // A non-Base64 data URI (e.g. URL-encoded SVG): decode it to bytes directly.
    try {
      const bytes = new TextEncoder().encode(decodeURIComponent(text));
      return { base64: bytesToBase64(bytes), bytes, declaredMime, sniffed: sniffMime(bytes) };
    } catch {
      return null;
    }
  }
  let b64 = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!b64 || /[^A-Za-z0-9+/]/.test(b64) || b64.length % 4 === 1) return null;
  b64 += "=".repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { base64: b64, bytes, declaredMime, sniffed: sniffMime(bytes) };
}

/** Minimal URL-encoding for inline SVG: far smaller than Base64 and readable. */
export function svgToDataUri(svg: string): string {
  const body = svg
    .replace(/^﻿/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "'")
    .replace(/[<>#%{}|\\^`\[\]"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `data:image/svg+xml,${body}`;
}

export interface SnippetInput {
  dataUri: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface Snippets {
  dataUri: string;
  html: string;
  css: string;
  markdown: string;
}

export function makeSnippets({ dataUri, alt = "", width, height }: SnippetInput): Snippets {
  const dims = width && height ? ` width="${width}" height="${height}"` : "";
  return {
    dataUri,
    html: `<img src="${dataUri}" alt="${alt.replace(/"/g, "&quot;")}"${dims}>`,
    css: `background-image: url("${dataUri}");`,
    markdown: `![${alt.replace(/[\[\]]/g, "")}](${dataUri})`,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Above this, inlining usually costs more than a cached separate request. */
export const INLINE_ADVICE_BYTES = 50 * 1024;
