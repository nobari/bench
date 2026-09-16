/**
 * Pure helpers for the comic book reader (CBZ/CBR/CB7/CBT).
 * Archive extraction itself is browser-only and lives in the widget;
 * everything here is deterministic and unit-testable.
 */

/** One extracted, displayable page. */
export interface ComicPage {
  /** Full path inside the archive (dirs + filename). */
  path: string;
  /** Filename only. */
  name: string;
  size: number;
}

const IMAGE_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}

/** MIME type for an image path inside an archive ("" if not an image). */
export function imageMime(path: string): string {
  return IMAGE_EXT[ext(path)] ?? "";
}

/**
 * Is this archive entry a comic page? Filters out macOS resource forks,
 * hidden files and non-image entries (ComicInfo.xml, .nfo, .txt …).
 */
export function isComicPage(path: string): boolean {
  if (!IMAGE_EXT[ext(path)]) return false;
  const segments = path.split("/");
  if (segments.includes("__MACOSX")) return false;
  const name = segments[segments.length - 1];
  return !name.startsWith(".");
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Natural page order: "page2.jpg" before "page10.jpg", grouped by directory.
 * This matches how every desktop comic reader orders archive entries.
 */
export function comparePagePaths(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Archive kinds the reader accepts (all handled by libarchive). */
export const COMIC_ACCEPT = ".cbz,.cbr,.cb7,.cbt,.zip,.rar,.7z,.tar";

/** Human label for the archive container, from the filename. */
export function archiveKind(fileName: string): string {
  switch (ext(fileName)) {
    case "cbz":
      return "CBZ (ZIP)";
    case "cbr":
      return "CBR (RAR)";
    case "cb7":
      return "CB7 (7-Zip)";
    case "cbt":
      return "CBT (TAR)";
    case "zip":
      return "ZIP";
    case "rar":
      return "RAR";
    case "7z":
      return "7-Zip";
    case "tar":
      return "TAR";
    default:
      return "Archive";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
