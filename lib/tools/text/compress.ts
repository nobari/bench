/**
 * Text compression via the browser-native CompressionStream /
 * DecompressionStream APIs — no library, no upload. SSR-safe: the streams are
 * only constructed when a function is called (widgets are client-only).
 */

/** Formats CompressionStream supports natively in every modern browser. */
export type CompressFormat = "gzip" | "deflate" | "deflate-raw";

export const COMPRESS_FORMATS: { id: CompressFormat; label: string; note: string }[] = [
  { id: "gzip", label: "gzip", note: "RFC 1952 · .gz files, Content-Encoding: gzip" },
  { id: "deflate", label: "deflate (zlib)", note: "RFC 1950 · zlib wrapper, Content-Encoding: deflate" },
  { id: "deflate-raw", label: "deflate-raw", note: "RFC 1951 · bare stream, no header or checksum" },
];

async function pipe(data: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function compressBytes(data: Uint8Array, format: CompressFormat): Promise<Uint8Array> {
  return pipe(data, new CompressionStream(format));
}

export function decompressBytes(data: Uint8Array, format: CompressFormat): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream(format));
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Throws on invalid UTF-8 so binary payloads aren't shown as mojibake. */
export function utf8DecodeStrict(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Parse pasted compressed data: Base64 (standard or url-safe, whitespace
 * tolerated) or a plain hex string.
 */
export function parseBinaryInput(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, "");
  if (!compact) throw new Error("Paste Base64 (or hex) of compressed data.");
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0 && compact.length >= 8) {
    const out = new Uint8Array(compact.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const b64 = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new Error("Input is not valid Base64 (or hex).");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Sniff the container from magic bytes; null means "probably raw deflate". */
export function detectFormat(bytes: Uint8Array): CompressFormat | null {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length > 2 && bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]) % 31 === 0)
    return "deflate";
  return null;
}

/** Decompress trying the sniffed format first, then the others. */
export async function smartDecompress(
  bytes: Uint8Array,
): Promise<{ format: CompressFormat; data: Uint8Array }> {
  const detected = detectFormat(bytes);
  const order: CompressFormat[] = detected
    ? [detected, ...(["gzip", "deflate", "deflate-raw"] as const).filter((f) => f !== detected)]
    : ["deflate-raw", "gzip", "deflate"];
  for (const format of order) {
    try {
      return { format, data: await decompressBytes(bytes, format) };
    } catch {
      /* try next */
    }
  }
  throw new Error("Not valid gzip, zlib or raw-deflate data.");
}
