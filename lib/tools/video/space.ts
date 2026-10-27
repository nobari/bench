/**
 * Room on the drive. The web platform has no disk API, and navigator.storage.estimate() is no stand-in: Chrome
 * answers usage + 10 GiB to every site whatever the disk holds (CalculateReportedQuota, a static figure since the
 * kStaticStorageQuota switch), so nothing here guesses at a drive. What can be known exactly is what an export
 * needs, and a drive that is full says so by refusing a write.
 */

import { fmtBytes } from "./progress";

/** Parts under this many bytes stay until the file is finished (the join then needs their room once more, beside them); above it each part is removed as soon as it is in the file. */
export const JOIN_KEEP_UNDER = 8e9;

export type JoinMode = "keep" | "remove";
/** Where a refused write happened: a part being written, the parts being joined into the file, or a one-piece file. */
export type SpaceWhere = "part" | "join" | "file";

/** How the parts are joined: a small file is copied beside its parts; a big one would need its room twice. */
export const joinMode = (partBytes: number): JoinMode => (partBytes < JOIN_KEEP_UNDER ? "keep" : "remove");

/** Bytes of audio an export of this many seconds writes. */
export const audioBytesFor = (kbps: number, seconds: number) => Math.ceil(((kbps * 1000) / 8) * Math.max(0, seconds));

/**
 * Room the join wants on the drive holding the project folder: in "remove" mode the largest part (a part is removed
 * only once it is in the file) plus the audio; in "keep" mode every part plus the audio; with a margin for the MP4
 * index. `totalBytes` is what the whole file will hold when `sizes` lists only some of the parts.
 */
export function joinNeed(sizes: number[], audioBytes: number, mode: JoinMode, totalBytes = sizes.reduce((a, b) => a + b, 0)): number {
  const largest = sizes.reduce((a, b) => Math.max(a, b), 0);
  return Math.ceil((mode === "remove" ? largest : totalBytes) + audioBytes + Math.max(100e6, totalBytes * 0.001));
}

/** Room one part of a resumable export wants while it is written: its seconds at the video bitrate, with a margin. */
export const partNeed = (bitrateMbps: number, seconds: number) => Math.ceil(((bitrateMbps * 1e6) / 8) * seconds * 1.1 + 50e6);

/** True when an error from a write most likely means the disk is full. */
export function isSpaceError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = String((e as { message?: string } | null)?.message ?? "").toLowerCase();
  return name === "QuotaExceededError" || name === "NotAllowedError" || /quota|space|disk|enospc/.test(msg);
}

const WHERE_TEXT: Record<SpaceWhere, string> = {
  part: "while a part was being written",
  join: "while the parts were being joined into the file",
  file: "while the file was being written",
};

/**
 * The drive refused a write. A writable that has refused once rejects every later write with the same stored error,
 * so the export stops; this names where it was and how much room that step wants, for the editor to say.
 */
export class SpaceStop extends Error {
  readonly name = "QuotaExceededError";
  readonly where: SpaceWhere;
  /** Room the refused step wants on the drive, when known. */
  readonly need: number | null;
  readonly reason: unknown;
  /** The join under way, when it was the join. */
  readonly join?: { mode: JoinMode; parts: number; bytes: number };
  constructor(where: SpaceWhere, need: number | null, reason: unknown, join?: { mode: JoinMode; parts: number; bytes: number }) {
    super(`The drive holding the project folder refused a write ${WHERE_TEXT[where]} (${(reason as { message?: string } | null)?.message || (reason as { name?: string } | null)?.name || "no room"}): it is full.`);
    this.where = where;
    this.need = need;
    this.reason = reason;
    this.join = join;
  }
}

/** What to free, in words, after a refused write. */
export function roomAdvice(where: SpaceWhere, need: number | null, join?: { mode: JoinMode }): string {
  const drive = "on the drive holding the project folder";
  if (where === "join") {
    if (need === null) return `Free room ${drive} for the join.`;
    const how = join?.mode === "remove" ? "the largest part plus the audio, since each part is removed as it goes in" : "room for the whole file beside the parts";
    return `Joining the parts needs about ${fmtBytes(need)} free ${drive} (${how}); free that.`;
  }
  if (where === "part") return need === null ? `Free room ${drive}.` : `Each part needs about ${fmtBytes(need)} free ${drive} while it is written; free at least that.`;
  return need === null ? `Free room ${drive}.` : `The file needs about ${fmtBytes(need)} free ${drive}; free that.`;
}
