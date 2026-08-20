/**
 * Pure helpers for the archive extractor / creator tools. Extraction and
 * creation run in the browser via libarchive (WASM) inside the widgets;
 * everything here is deterministic and SSR-safe.
 *
 * Output formats are what the in-house writers produce (zip-write.ts /
 * tar-write.ts on native CompressionStream). libarchive is read-only here:
 * its write path can't emit a plain ZIP (the `compression` option is an outer
 * filter) and its fixed output buffer overflows on incompressible input.
 */

export interface OutputFormat {
  id: string;
  label: string;
  ext: string;
}

export const OUTPUT_FORMATS: OutputFormat[] = [
  { id: "zip", label: "ZIP", ext: ".zip" },
  { id: "tgz", label: "TAR.GZ", ext: ".tar.gz" },
];

export const EXTRACT_ACCEPT =
  ".zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz,.gz,.cbz,.cbr,.cb7,.cbt,.iso";

const KIND_BY_EXT: [RegExp, string][] = [
  [/\.tar\.gz$|\.tgz$/i, "TAR.GZ"],
  [/\.tar\.bz2$|\.tbz2$/i, "TAR.BZ2"],
  [/\.tar\.xz$|\.txz$/i, "TAR.XZ"],
  [/\.tar$/i, "TAR"],
  [/\.zip$/i, "ZIP"],
  [/\.rar$/i, "RAR"],
  [/\.7z$/i, "7-Zip"],
  [/\.gz$/i, "GZIP"],
  [/\.cbz$/i, "CBZ (ZIP)"],
  [/\.cbr$/i, "CBR (RAR)"],
  [/\.cb7$/i, "CB7 (7-Zip)"],
  [/\.cbt$/i, "CBT (TAR)"],
  [/\.iso$/i, "ISO"],
];

/** Human label for an archive, from its filename. */
export function archiveLabel(fileName: string): string {
  for (const [re, label] of KIND_BY_EXT) if (re.test(fileName)) return label;
  return "Archive";
}

/** A bare gzip-compressed file (not a tarball) — handled by DecompressionStream. */
export function isSingleGzip(fileName: string): boolean {
  return /\.gz$/i.test(fileName) && !/\.tar\.gz$/i.test(fileName);
}

/** Is this a RAR container? The wasm build can't decrypt RAR at all. */
export function isRarFile(fileName: string): boolean {
  return /\.(rar|cbr)$/i.test(fileName);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural ordering for entry paths (file2 before file10, grouped by dir). */
export function compareEntryPaths(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Strip directories and characters that make filesystem-hostile names. */
export function sanitizeBaseName(name: string): string {
  const clean = name.replace(/[/\\:*?"<>|]/g, "-").trim();
  return clean || "archive";
}
