/**
 * YouTube's published upload limits and recommendations, so an export is not wasted on a file YouTube will not
 * take. From support.google.com/youtube/answer/71673 (size and length), /1722171 (encoding) and /6375112
 * (resolutions), read in October 2026.
 */

import { audioBytesFor } from "./space";

/** The most YouTube takes: 256 GB or 12 hours, whichever comes first — and 15 minutes from an unverified account. */
export const YOUTUBE_MAX_BYTES = 256e9;
export const YOUTUBE_MAX_SECONDS = 12 * 3600;
export const YOUTUBE_UNVERIFIED_SECONDS = 15 * 60;
/** YouTube's recommended audio: AAC-LC stereo at 384 kbps. */
export const YOUTUBE_AUDIO_KBPS = 384;

export const fmtGb = (n: number) => (n < 1e9 ? `${(n / 1e6).toFixed(n < 10e6 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(n >= 100e9 ? 0 : 1)} GB`);

/** The whole-Mbps video bitrate at which this many seconds, with this audio, fit under the size limit with a 3 % margin; 0 when none does. */
export function fitBitrate(seconds: number, audioKbps: number, maxBytes = YOUTUBE_MAX_BYTES): number {
  if (seconds <= 0) return 0;
  const budget = maxBytes * 0.97 - audioBytesFor(audioKbps, seconds);
  return Math.max(0, Math.floor((budget * 8) / seconds / 1e6));
}

export interface UploadLimits {
  /** The expected file is over 256 GB. */
  overSize: boolean;
  /** The export is longer than 12 hours. */
  overLength: boolean;
  /** Over 15 minutes: only a verified account can upload it. */
  needsVerified: boolean;
  /** The bitrate that would fit under 256 GB (0 when none). */
  fit: number;
}

export function uploadLimits(bytes: number, seconds: number, audioKbps: number): UploadLimits {
  return { overSize: bytes > YOUTUBE_MAX_BYTES, overLength: seconds > YOUTUBE_MAX_SECONDS, needsVerified: seconds > YOUTUBE_UNVERIFIED_SECONDS, fit: fitBitrate(seconds, audioKbps) };
}
