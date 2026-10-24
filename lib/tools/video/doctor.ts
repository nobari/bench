/**
 * The Video Doctor: what is wrong with a video file, why it matters for where it is going, and what can be done.
 *
 * Two depths. "quick" reads only the file's headers and index (a few megabytes wherever the file is 200 GB) and
 * judges the structure, the codec parameters and the target's rules. "full" also reads every packet of every track,
 * decodes the whole soundtrack with the loudness meter running, and decodes the picture for a second around every
 * irregular cut, at both ends and at evenly spaced points — the checks a stalled upload needs.
 *
 * Two targets. "youtube" applies YouTube's limits and recommendations; "playback" judges a file for ordinary players.
 * The rules are data, so a target is a table, not code.
 *
 * Every finding carries what was observed, why it matters and how it was detected, and a fix when one exists.
 * The fixes themselves (rewriting the index, re-levelling the sound) need file handles, so they live with the UI;
 * this module only names them.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, EncodedPacketSink, Input, VideoSampleSink, type AudioSample } from "mediabunny";
import { checkMp4, type Mp4Check, type TrackCheck } from "./check";
import { LoudnessMeter, YOUTUBE_LUFS, type Loudness } from "./loudness";

export type DoctorTarget = "youtube" | "playback";
export type DoctorDepth = "quick" | "full";
export type Severity = "error" | "warn" | "info";
export type FixKind = "repair-index" | "fix-level" | "tags" | "convert" | "re-export";

export interface Finding {
  id: string;
  severity: Severity;
  /** The finding in a few words. */
  title: string;
  /** What was observed, with the numbers. */
  what: string;
  /** Why it matters for the target, and how it was detected. */
  why: string;
  /** Timeline positions involved, seconds, when there are some. */
  at?: number[];
  fix?: { kind: FixKind; label: string; detail: string };
}

export interface CheckRun {
  id: string;
  title: string;
  status: "ok" | "problem" | "skipped" | "failed" | "cancelled";
  detail: string;
}

export interface DoctorFacts {
  name: string;
  size: number;
  durationS: number;
  layout: Mp4Check["layout"];
  video?: {
    codec: string;
    /** "HEVC Main, level 6.0, 4:2:0 8-bit" */
    label: string;
    width: number;
    height: number;
    fps: number;
    frames: number;
    mbps: number;
    /** "BT.709 primaries, sRGB transfer, BT.709 matrix, limited range" */
    colour: string;
    keyEveryS: number | null;
  };
  audio?: {
    codec: string;
    /** "AAC-LC 48 kHz stereo, 322 kbps" */
    label: string;
    sampleRate: number;
    channels: number;
    kbps: number;
    frames: number;
  };
  tags: Record<string, string>;
  /** Full depth only: the soundtrack's loudness as decoded. */
  loudness?: Loudness;
}

export interface DoctorReport {
  target: DoctorTarget;
  depth: DoctorDepth;
  facts: DoctorFacts;
  findings: Finding[];
  checks: CheckRun[];
  errors: number;
  warnings: number;
  /** No errors. */
  ok: boolean;
  /** "Ready for YouTube", "2 problems" … */
  verdict: string;
  ms: number;
  index: Mp4Check;
  /** The full scan was cancelled before it finished; the quick findings stand. */
  cancelled?: boolean;
}

export interface DoctorProgress {
  stage: string;
  /** 0…1 over the whole run. */
  fraction: number;
}

export interface DiagnoseOptions {
  target: DoctorTarget;
  depth: DoctorDepth;
  signal?: AbortSignal;
  onProgress?: (p: DoctorProgress) => void;
}

/* ------------------------------------------------------------------ targets */

export const TARGETS: Record<DoctorTarget, { label: string; blurb: string; rules: string[] }> = {
  youtube: {
    label: "YouTube upload",
    blurb: "YouTube's limits and recommendations, and the defects its processing is known to choke on.",
    rules: [
      "A file of at most 256 GB and 12 hours; 128 GB and more is flagged as very large, since processing can take a day or more.",
      "Picture up to 7680×4320 at up to 60 fps, as H.264, HEVC, AV1 or VP9 in MP4 or MOV.",
      "The HEVC or H.264 level declared in the file must cover the picture size and rate (8K at 30 fps needs HEVC level 6.0).",
      "Video bitrate against YouTube's recommended range for the resolution and frame rate (8K SDR: 80–160 Mbps at 30 fps, 120–240 at 60).",
      "Sound as AAC-LC at 48 kHz or 44.1 kHz, stereo or 5.1, at 128 kbps or more; the loudness near YouTube's −14 LUFS playback level, since quieter uploads are never turned up.",
      "A keyframe at least every 10 seconds, so processing and seeking can split the file.",
      "No two frames on one timestamp, no empty edit delaying the picture, no negative composition offsets, every sample accounted for in the index: the index defects that have left uploads in processing indefinitely.",
      "Tags are not required; a title in the file pre-fills the upload's title.",
    ],
  },
  playback: {
    label: "General playback",
    blurb: "What ordinary players, phones and TVs need: no limits on size or length, but a sound index and codecs they can decode.",
    rules: [
      "A complete index with every sample accounted for, no two frames on one timestamp, no empty edit, no negative composition offsets.",
      "H.264 plays everywhere; HEVC needs hardware or a recent player; AV1 and VP9 need recent ones.",
      "The declared level within what common decoders handle for the picture size and rate.",
      "A keyframe at least every 10 seconds, or seeking is slow.",
      "The index at the front of the file (fast start) lets playback begin before the whole file is downloaded; at the end is fine for local files.",
      "AAC-LC sound at 48 kHz or 44.1 kHz; the level reasonable against −14 to −16 LUFS where streaming services sit.",
    ],
  },
};

/** YouTube's recommended video bitrates (SDR, Mbps) by picture height: at up to 30 fps and at 60 fps. */
const YOUTUBE_MBPS: { height: number; lo30: number; hi30: number; lo60: number; hi60: number }[] = [
  { height: 4320, lo30: 80, hi30: 160, lo60: 120, hi60: 240 },
  { height: 2160, lo30: 35, hi30: 45, lo60: 53, hi60: 68 },
  { height: 1440, lo30: 16, hi30: 16, lo60: 24, hi60: 24 },
  { height: 1080, lo30: 8, hi30: 8, lo60: 12, hi60: 12 },
  { height: 720, lo30: 5, hi30: 5, lo60: 7.5, hi60: 7.5 },
  { height: 480, lo30: 2.5, hi30: 2.5, lo60: 4, hi60: 4 },
  { height: 360, lo30: 1, hi30: 1, lo60: 1.5, hi60: 1.5 },
];
export function youtubeBitrate(height: number, fps: number): { lo: number; hi: number; height: number } | null {
  const row = YOUTUBE_MBPS.find((r) => height >= r.height * 0.9) ?? YOUTUBE_MBPS[YOUTUBE_MBPS.length - 1];
  if (!row) return null;
  return fps > 36 ? { lo: row.lo60, hi: row.hi60, height: row.height } : { lo: row.lo30, hi: row.hi30, height: row.height };
}
const YOUTUBE_MAX_BYTES = 256e9, YOUTUBE_LARGE_BYTES = 128e9, YOUTUBE_MAX_SECONDS = 12 * 3600;

/* ------------------------------------------------------------------ levels */

/** HEVC levels: level idc, the largest picture (luma samples) and the most luma samples per second they allow. */
const HEVC_LEVELS: [number, number, number][] = [
  [30, 36864, 552960],
  [60, 122880, 3686400],
  [63, 245760, 7372800],
  [90, 552960, 16588800],
  [93, 983040, 33177600],
  [120, 2228224, 66846720],
  [123, 2228224, 133693440],
  [150, 8912896, 267386880],
  [153, 8912896, 534773760],
  [156, 8912896, 1069547520],
  [180, 35651584, 1069547520],
  [183, 35651584, 2139095040],
  [186, 35651584, 4278190080],
];
/** H.264 levels: level idc, the largest frame in macroblocks and the most macroblocks per second. */
const AVC_LEVELS: [number, number, number][] = [
  [10, 99, 1485],
  [11, 396, 3000],
  [12, 396, 6000],
  [13, 396, 11880],
  [20, 396, 11880],
  [21, 792, 19800],
  [22, 1620, 20250],
  [30, 1620, 40500],
  [31, 3600, 108000],
  [32, 5120, 216000],
  [40, 8192, 245760],
  [41, 8192, 245760],
  [42, 8704, 522240],
  [50, 22080, 589824],
  [51, 36864, 983040],
  [52, 36864, 2073600],
  [60, 139264, 4177920],
  [61, 139264, 8355840],
  [62, 139264, 16711680],
];
export function hevcLevelNeeded(width: number, height: number, fps: number): number {
  const ps = width * height, sr = ps * fps;
  return HEVC_LEVELS.find(([, maxPs, maxSr]) => ps <= maxPs && sr <= maxSr)?.[0] ?? 186;
}
export function avcLevelNeeded(width: number, height: number, fps: number): number {
  const fs = Math.ceil(width / 16) * Math.ceil(height / 16), mbps = fs * fps;
  return AVC_LEVELS.find(([, maxFs, maxMbps]) => fs <= maxFs && mbps <= maxMbps)?.[0] ?? 62;
}
export const fmtHevcLevel = (idc: number) => `${Math.floor(idc / 30)}.${Math.round((idc % 30) / 3)}`;
export const fmtAvcLevel = (idc: number) => (idc === 11 ? "1.1" : `${Math.floor(idc / 10)}.${idc % 10}`);

const HEVC_PROFILES: Record<number, string> = { 1: "Main", 2: "Main 10", 3: "Main Still Picture", 4: "Range extensions" };
const AVC_PROFILES: Record<number, string> = { 66: "Baseline", 77: "Main", 88: "Extended", 100: "High", 110: "High 10", 122: "High 4:2:2", 244: "High 4:4:4" };
const PRIMARIES: Record<number, string> = { 1: "BT.709", 5: "BT.601 (625)", 6: "BT.601 (525)", 9: "BT.2020", 12: "DCI-P3" };
const TRANSFERS: Record<number, string> = { 1: "BT.709", 6: "BT.601", 8: "linear", 13: "sRGB", 14: "BT.2020 10-bit", 15: "BT.2020 12-bit", 16: "PQ (HDR10)", 18: "HLG" };
const MATRICES: Record<number, string> = { 0: "identity", 1: "BT.709", 5: "BT.601 (625)", 6: "BT.601 (525)", 9: "BT.2020" };
const CODEC_NAMES: Record<string, string> = { hvc1: "HEVC", hev1: "HEVC", avc1: "H.264", avc3: "H.264", av01: "AV1", vp09: "VP9", mp4a: "AAC", Opus: "Opus", fLaC: "FLAC", "ac-3": "AC-3", "ec-3": "E-AC-3" };
const VIDEO_OK = new Set(["hvc1", "hev1", "avc1", "avc3", "av01", "vp09"]);
const CHROMA: Record<number, string> = { 0: "monochrome", 1: "4:2:0", 2: "4:2:2", 3: "4:4:4" };

/* ------------------------------------------------------------------ words */

const fmtInt = (n: number) => n.toLocaleString("en-US");
export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};
const fmtGb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 1 : 2)} GB`;
const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const listAt = (at: number[], max = 3) => at.slice(0, max).map(fmtClock).join(", ") + (at.length > max ? ", …" : "");

/* ------------------------------------------------------------------ facts */

export function factsOf(name: string, index: Mp4Check): DoctorFacts {
  const v = index.tracks.find((t) => t.kind === "video"), a = index.tracks.find((t) => t.kind === "audio");
  const facts: DoctorFacts = { name, size: index.size, durationS: index.durationS, layout: index.layout, tags: index.tags };
  if (v) {
    const fps = v.nominalDelta ? v.timescale / v.nominalDelta : 0;
    const e = v.entry;
    const parts: string[] = [CODEC_NAMES[v.codec] ?? v.codec];
    if (e.hevc) parts[0] += ` ${HEVC_PROFILES[e.hevc.profile] ?? `profile ${e.hevc.profile}`}${e.hevc.tier === "high" ? " High tier" : ""}, level ${fmtHevcLevel(e.hevc.level)}, ${CHROMA[e.hevc.chroma] ?? `chroma ${e.hevc.chroma}`} ${e.hevc.bitDepth}-bit`;
    else if (e.avc) parts[0] += ` ${AVC_PROFILES[e.avc.profile] ?? `profile ${e.avc.profile}`}, level ${fmtAvcLevel(e.avc.level)}`;
    const colour = e.colr ? `${PRIMARIES[e.colr.primaries] ?? `primaries ${e.colr.primaries}`} primaries, ${TRANSFERS[e.colr.transfer] ?? `transfer ${e.colr.transfer}`} transfer, ${MATRICES[e.colr.matrix] ?? `matrix ${e.colr.matrix}`} matrix, ${e.colr.fullRange ? "full" : "limited"} range` : "no colour tags";
    facts.video = { codec: v.codec, label: parts[0], width: e.width ?? 0, height: e.height ?? 0, fps, frames: v.samples, mbps: v.durationS > 0 ? (v.bytes * 8) / v.durationS / 1e6 : 0, colour, keyEveryS: v.keyframes && v.keyframes > 0 ? v.durationS / v.keyframes : null };
  }
  if (a) {
    const e = a.entry;
    const sampleRate = e.aac?.sampleRate || e.audio?.sampleRate || a.timescale;
    const channels = e.aac?.channels || e.audio?.channels || 0;
    const kbps = a.durationS > 0 ? (a.bytes * 8) / a.durationS / 1000 : 0;
    const codecName = a.codec === "mp4a" ? (e.aac ? (e.aac.objectType === 2 ? "AAC-LC" : e.aac.objectType === 5 ? "HE-AAC" : e.aac.objectType === 29 ? "HE-AAC v2" : `AAC (object type ${e.aac.objectType})`) : "AAC") : (CODEC_NAMES[a.codec] ?? a.codec);
    facts.audio = { codec: a.codec, label: `${codecName} ${sampleRate >= 1000 ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0)} kHz` : `${sampleRate} Hz`} ${channels === 1 ? "mono" : channels === 2 ? "stereo" : channels === 6 ? "5.1" : `${channels} channels`}, ${Math.round(kbps)} kbps`, sampleRate, channels, kbps, frames: a.samples };
  }
  return facts;
}

/* ------------------------------------------------------------------ quick findings */

/** Whether the index repair applies: the index at the tail and no composition offsets to adjust. */
export const indexRepairable = (index: Mp4Check) => index.layout === "moov-last" && !index.tracks.some((t) => t.kind === "video" && t.hasCtts);

const REPAIR_FIX = { kind: "repair-index" as const, label: "Repair index", detail: "Rewrites only the index at the end of the file — the picture and sound are not touched; the old index is kept as a backup. Seconds, whatever the size." };
const REMUX_FIX = { kind: "convert" as const, label: "Remux", detail: "Copy the streams into a fresh container with the Video Converter (codec kept, nothing re-encoded): a new index is written from scratch." };
const REEXPORT_FIX = { kind: "re-export" as const, label: "Export again", detail: "The data itself is incomplete; a new export is the only way to a sound file." };
const LEVEL_FIX = { kind: "fix-level" as const, label: "Fix the level", detail: "Writes a copy with the sound raised or lowered to the target and limited at −1 dBFS; the picture is copied packet by packet, so it takes minutes, not hours." };
const TAGS_FIX = { kind: "tags" as const, label: "Add tags", detail: "The MP4 tag editor writes a title, artist, album, genre, year and the media kind into the index without touching the streams." };

/** The findings the index alone supports: structure, codec parameters, the target's limits, the tags. */
export function quickFindings(index: Mp4Check, facts: DoctorFacts, target: DoctorTarget): Finding[] {
  const out: Finding[] = [];
  const yt = target === "youtube";
  const v = index.tracks.find((t) => t.kind === "video"), a = index.tracks.find((t) => t.kind === "audio");
  const push = (f: Finding) => out.push(f);
  const repairFix = indexRepairable(index) ? REPAIR_FIX : REMUX_FIX;

  // --- structure
  if (index.moovAt < 0 || index.moovSize === 0) {
    push({ id: "no-index", severity: "error", title: "No index in the file", what: "No moov box was found, so nothing says where the frames are or when they play.", why: "An MP4 without its index is unplayable and unprocessable: a recording or export that was cut short before it was closed, or not an MP4 at all. Detected by walking the top-level boxes.", fix: REEXPORT_FIX });
    return out;
  }
  if (!index.sizesMatch) push({ id: "sizes", severity: "error", title: "The index does not match the data", what: `The samples listed in the index add up to ${fmtGb(index.tracks.reduce((s, t) => s + t.bytes, 0))} but the media data holds ${fmtGb(Math.max(0, index.mdatSize))}.`, why: "Every sample's size and offset is in the index; when they do not fill the data exactly, some frames point past the end or into the wrong bytes. Players stop or show garbage there; a processor rejects the file. Detected by summing the sample sizes of every track against the mdat.", fix: REEXPORT_FIX });
  if (!v) push({ id: "no-video", severity: yt ? "error" : "info", title: "No picture track", what: "The file carries sound only.", why: yt ? "YouTube needs a picture track; an audio-only MP4 is refused at upload." : "Players treat it as an audio file." });
  if (!a) push({ id: "no-audio", severity: "info", title: "No sound track", what: "The file carries picture only.", why: yt ? "YouTube accepts silent uploads; the video simply has no sound." : "Silent playback; nothing wrong with the file." });
  for (const t of index.tracks) {
    if (t.samples === 0) push({ id: `empty-${t.kind}`, severity: "error", title: `The ${t.kind} track is empty`, what: "The track exists but lists no samples.", why: "A track with no samples usually means an export that never wrote a frame of it; players may refuse the file. Detected from the sample table.", fix: REEXPORT_FIX });
    if (t.zeroLength) push({ id: `zero-${t.kind}`, severity: "error", title: `${t.zeroLength === 1 ? "Two frames share one timestamp" : `${fmtInt(t.zeroLength)} places where two frames share one timestamp`}`, what: `${t.kind === "video" ? "Frame" : "Sample"}${t.zeroLength === 1 ? "" : "s"} with a zero-length entry in the time table at ${listAt(t.zeroLengthAt)}: the next ${t.kind === "video" ? "frame" : "sample"} has the same timestamp.`, why: "ffmpeg-based pipelines see a non-monotonic DTS there and may abort or stall; YouTube left a file like this in processing indefinitely (October 2026). Players drop one of the two frames. Detected from the stts table.", at: t.zeroLengthAt, fix: repairFix });
    if (t.kind === "video" && t.emptyEdit) {
      const ms = t.elst![0].segDur > 0 && index.durationS > 0 ? (t.elst![0].segDur / (t.elst!.reduce((s, e) => s + e.segDur, 0) / index.durationS)) * 1000 : 0;
      push({ id: "empty-edit", severity: yt ? "error" : "warn", title: "The picture starts late through an empty edit", what: `The edit list delays the picture by ${ms.toFixed(1)} ms before the first frame shows.`, why: "An empty edit is legal, but it is one of the two differences between an export that stalled on YouTube and one that processed; some players ignore edit lists and start the picture early, others honour it and show black first. Detected from the elst box.", fix: repairFix });
    } else if (t.elst && t.elst.length > 1) push({ id: `elst-${t.kind}`, severity: "info", title: `The ${t.kind} track has an edit list with ${t.elst.length} entries`, what: "Several edits map the media onto the timeline.", why: "Edit lists are honoured by most players and by YouTube, but ignored by some; a file that needs none is safer. Detected from the elst box." });
    if (t.kind === "video" && t.negativeCtts) push({ id: "negative-ctts", severity: "error", title: "Frames placed before their predecessors", what: "The composition offsets table carries negative values.", why: "A negative offset puts a frame earlier than the one decoded before it; ffmpeg reports backward timestamps and YouTube's processing stalled on a file like this (October 2026). Detected from a version-1 ctts box.", fix: REMUX_FIX });
    const drift = t.durationS - index.durationS;
    if (Math.abs(drift) > 5) push({ id: `drift-${t.kind}`, severity: "warn", title: `The ${t.kind} track runs ${Math.abs(drift).toFixed(1)} s ${drift > 0 ? "longer" : "shorter"} than the movie`, what: `Track ${fmtClock(t.durationS)}, movie ${fmtClock(index.durationS)}.`, why: "Picture and sound of different lengths end with one of them alone; a large gap usually means a track was cut short. Detected by comparing the track and movie headers." });
  }
  if (v && v.maxKeyGapS !== null && v.maxKeyGapS > 10) push({ id: "key-gap", severity: "warn", title: `Up to ${v.maxKeyGapS.toFixed(1)} s between keyframes`, what: `${fmtInt(v.keyframes ?? 0)} keyframes; the longest stretch without one is ${v.maxKeyGapS.toFixed(1)} s.`, why: yt ? "YouTube splits the file into chunks at keyframes to process it in parallel and to seek; long gaps slow both and can fail very long files. Detected from the stss table." : "Seeking lands on the previous keyframe and decodes forward from there, so long gaps make seeking slow. Detected from the stss table." });
  if (v && v.keyframes === null) push({ id: "all-key", severity: "info", title: "Every frame is a keyframe", what: "The index has no sync-sample table, which means every frame can be decoded on its own.", why: "Fine for playback; the file is larger than it needs to be." });
  if (v && v.shortFrames) push({ id: "short-frames", severity: "info", title: `${plural(v.shortFrames, "frame")} under a fifth of a frame long`, what: `At cuts, the last frame of a clip is shown only until the next clip's first frame: ${plural(v.shortFrames, "such sliver")} in this file.`, why: "Legal and played correctly; a constant-rate re-encoder (ffmpeg's default output) collapses such a frame into its neighbour, which is harmless. Detected from the stts table." });
  if (index.layout !== "moov-last" && index.layout !== "moov-first") push({ id: "layout", severity: "warn", title: "The index sits in the middle of the file", what: "Neither at the front nor at the end.", why: "Unusual; most tools write it at one end. Players cope, but in-place tag and index edits cannot be done." });
  else if (!yt && index.layout === "moov-last") push({ id: "layout", severity: "info", title: "Index at the end of the file", what: "A player over a network has to fetch the end of the file before it can start.", why: "Local playback is unaffected; for streaming from a plain web server, a fast-start file (index first) begins immediately. YouTube does not mind either way." });

  // --- codec parameters
  if (v && facts.video) {
    const fv = facts.video, e = v.entry;
    if (!VIDEO_OK.has(v.codec)) push({ id: "video-codec", severity: "warn", title: `Picture codec ${v.codec}`, what: `The picture is stored as "${v.codec}".`, why: yt ? "YouTube accepts H.264, HEVC, AV1, VP9 and a few older codecs; anything else is re-encoded if it is recognised at all." : "Many players will not decode it.", fix: { kind: "convert", label: "Convert", detail: "Re-encode the picture as H.264 or HEVC with the Video Converter." } });
    if (e.hevc) {
      const need = hevcLevelNeeded(fv.width, fv.height, fv.fps || 30);
      if (e.hevc.level < need) push({ id: "hevc-level", severity: "warn", title: `Declared HEVC level ${fmtHevcLevel(e.hevc.level)} is below what the picture needs (${fmtHevcLevel(need)})`, what: `${fv.width}×${fv.height} at ${fv.fps.toFixed(2)} fps needs level ${fmtHevcLevel(need)}; the file declares ${fmtHevcLevel(e.hevc.level)}.`, why: "Strict decoders (hardware ones in particular) refuse a stream whose level does not cover it; ffmpeg-based processing ignores the field. Detected from the hvcC box.", fix: { kind: "convert", label: "Re-encode", detail: "Re-encode the picture with the Video Converter so the level is declared correctly." } });
      if (e.hevc.profile > 2) push({ id: "hevc-profile", severity: "warn", title: `HEVC profile ${HEVC_PROFILES[e.hevc.profile] ?? e.hevc.profile}`, what: "A profile beyond Main and Main 10.", why: "Range-extension profiles (4:2:2, 4:4:4, 12-bit) are not decoded by most hardware and are re-encoded or refused by services. Detected from the hvcC box.", fix: { kind: "convert", label: "Re-encode", detail: "Re-encode as HEVC Main or H.264 High 4:2:0 with the Video Converter." } });
      if (e.hevc.bitDepth > 8 && !(e.colr && (e.colr.transfer === 16 || e.colr.transfer === 18))) push({ id: "ten-bit-sdr", severity: "info", title: `${e.hevc.bitDepth}-bit picture without HDR tags`, what: "Main 10 without a PQ or HLG transfer.", why: yt ? "YouTube treats it as SDR and makes 8-bit renditions; fine, just not HDR." : "Plays as SDR on most devices." });
      if (e.colr && (e.colr.transfer === 16 || e.colr.transfer === 18)) push({ id: "hdr", severity: "info", title: "HDR picture", what: `${TRANSFERS[e.colr.transfer]} transfer, ${PRIMARIES[e.colr.primaries] ?? "unknown"} primaries.`, why: yt ? "YouTube makes HDR and SDR renditions from it; the SDR one is a tone-mapped guess unless the file carries metadata." : "Needs an HDR display; SDR players show it tone-mapped or washed out." });
    }
    if (e.avc) {
      const need = avcLevelNeeded(fv.width, fv.height, fv.fps || 30);
      if (e.avc.level < need) push({ id: "avc-level", severity: "warn", title: `Declared H.264 level ${fmtAvcLevel(e.avc.level)} is below what the picture needs (${fmtAvcLevel(need)})`, what: `${fv.width}×${fv.height} at ${fv.fps.toFixed(2)} fps needs level ${fmtAvcLevel(need)}; the file declares ${fmtAvcLevel(e.avc.level)}.`, why: "Strict decoders refuse a stream whose level does not cover it; ffmpeg-based processing ignores the field. Detected from the avcC box.", fix: { kind: "convert", label: "Re-encode", detail: "Re-encode the picture with the Video Converter so the level is declared correctly." } });
      if (e.avc.profile > 100) push({ id: "avc-profile", severity: "warn", title: `H.264 profile ${AVC_PROFILES[e.avc.profile] ?? e.avc.profile}`, what: "A profile beyond High.", why: "High 10, 4:2:2 and 4:4:4 are not decoded by most hardware players. Detected from the avcC box.", fix: { kind: "convert", label: "Re-encode", detail: "Re-encode as H.264 High or HEVC Main with the Video Converter." } });
    }
    if (!e.colr) push({ id: "no-colr", severity: "info", title: "No colour tags", what: "The picture does not say which primaries, transfer and matrix it uses.", why: "Players and YouTube assume BT.709, which is right for ordinary SDR footage; wrong for wide-gamut or HDR material. Detected by the absence of a colr box." });
    else if (e.colr.transfer === 13) push({ id: "srgb-transfer", severity: "info", title: "sRGB transfer tag on the picture", what: "The colr box says sRGB transfer with BT.709 primaries and matrix.", why: "Unusual for video (it is what a browser canvas produces) but harmless: YouTube and players treat it as BT.709. The October 17 upload that processed carried the same tag." });
    if (yt && (fv.width > 7680 || fv.height > 4320)) push({ id: "too-big", severity: "error", title: `${fv.width}×${fv.height} is larger than 8K`, what: "YouTube's largest rendition is 7680×4320.", why: "Larger pictures are refused or scaled; nothing is gained.", fix: { kind: "convert", label: "Scale down", detail: "Scale to 8K or less with the Video Converter." } });
    if (yt && fv.fps > 60.5) push({ id: "fps", severity: "warn", title: `${fv.fps.toFixed(0)} fps`, what: "Above 60 frames per second.", why: "YouTube plays at most 60 fps; higher rates are halved or dropped during processing.", fix: { kind: "convert", label: "Change the rate", detail: "Set 60 or 30 fps in the Video Converter." } });
    if (yt) {
      const rec = youtubeBitrate(fv.height, fv.fps);
      if (rec && fv.mbps > 0) {
        if (fv.mbps < rec.lo * 0.5) push({ id: "bitrate-low", severity: "warn", title: `${fv.mbps.toFixed(1)} Mbps is well under YouTube's recommendation for ${rec.height}p`, what: `YouTube recommends ${rec.lo === rec.hi ? `${rec.lo}` : `${rec.lo}–${rec.hi}`} Mbps for ${rec.height}p at ${fv.fps > 36 ? "60" : "up to 30"} fps (SDR); this file averages ${fv.mbps.toFixed(1)}.`, why: "YouTube re-encodes everything; a low source bitrate limits the quality of every rendition. Computed from the picture track's bytes over its length." });
        else if (fv.mbps < rec.lo) push({ id: "bitrate-under", severity: "info", title: `${fv.mbps.toFixed(1)} Mbps, a little under YouTube's recommendation`, what: `Recommended ${rec.lo === rec.hi ? `${rec.lo}` : `${rec.lo}–${rec.hi}`} Mbps for ${rec.height}p.`, why: "Fine; a touch more would survive YouTube's re-encode a little better." });
        else if (fv.mbps > rec.hi * 1.6) push({ id: "bitrate-high", severity: "info", title: `${fv.mbps.toFixed(1)} Mbps, more than YouTube uses`, what: `Recommended up to ${rec.hi} Mbps for ${rec.height}p.`, why: "No harm: YouTube re-encodes to its own rates. The upload just takes longer." });
        else push({ id: "bitrate-ok", severity: "info", title: `${fv.mbps.toFixed(1)} Mbps, inside YouTube's recommended range`, what: `${rec.lo === rec.hi ? `${rec.lo}` : `${rec.lo}–${rec.hi}`} Mbps for ${rec.height}p at ${fv.fps > 36 ? "60" : "up to 30"} fps.`, why: "What YouTube asks for." });
      }
    } else if (v.codec === "hvc1" || v.codec === "hev1") push({ id: "hevc-playback", severity: "info", title: "HEVC picture", what: "Hardware decoding on recent phones, Macs, TVs and Windows with the HEVC extension; older players lack it.", why: "If the file must play everywhere, H.264 is the safe choice." });
  }
  if (a && facts.audio) {
    const fa = facts.audio, e = a.entry;
    if (a.codec !== "mp4a") push({ id: "audio-codec", severity: yt ? "info" : "warn", title: `Sound as ${CODEC_NAMES[a.codec] ?? a.codec}`, what: `The sound is stored as "${a.codec}".`, why: yt ? "YouTube accepts AAC, MP3, PCM, Opus and FLAC and re-encodes them." : "Only AAC plays everywhere in MP4; other codecs need a capable player.", fix: { kind: "convert", label: "Convert the sound", detail: "Re-encode the sound as AAC with the Video Converter, the picture copied." } });
    else if (e.aac && e.aac.objectType !== 2) push({ id: "aac-he", severity: "warn", title: `${fa.label.split(" ")[0]} sound`, what: "The AAC object type is not LC.", why: yt ? "HE-AAC is accepted but decoded through its SBR extension; LC is what YouTube and every player handle without surprises." : "Some players decode HE-AAC without its extension and play it dull and at half the rate.", fix: { kind: "convert", label: "Convert the sound", detail: "Re-encode the sound as AAC-LC with the Video Converter, the picture copied." } });
    if (fa.sampleRate && fa.sampleRate !== 48000 && fa.sampleRate !== 44100) push({ id: "sample-rate", severity: "info", title: `${fa.sampleRate} Hz sound`, what: "Neither 48 kHz nor 44.1 kHz.", why: yt ? "YouTube resamples to 48 kHz." : "Players resample; nothing wrong." });
    if (fa.channels > 2) push({ id: "channels", severity: "info", title: `${fa.channels}-channel sound`, what: fa.channels === 6 ? "5.1 surround." : `${fa.channels} channels.`, why: yt ? "YouTube keeps 5.1 where it can and makes a stereo mix for everyone else." : "Stereo devices play a downmix." });
    if (yt && fa.kbps > 0 && fa.kbps < 120) push({ id: "audio-bitrate", severity: "warn", title: `${Math.round(fa.kbps)} kbps sound`, what: "Under YouTube's 128 kbps minimum recommendation.", why: "The sound is re-encoded on upload; a low source rate shows.", fix: { kind: "convert", label: "Convert the sound", detail: "Re-encode the sound at 256 kbps or more with the Video Converter, the picture copied." } });
  }

  // --- target limits
  if (yt) {
    if (index.size > YOUTUBE_MAX_BYTES) push({ id: "size-max", severity: "error", title: `${fmtGb(index.size)} is over YouTube's 256 GB limit`, what: "Uploads above 256 GB are refused.", why: "A hard limit.", fix: { kind: "convert", label: "Compress", detail: "Lower the bitrate or the resolution with the Video Converter, or export a shorter range." } });
    else if (index.size > YOUTUBE_LARGE_BYTES) push({ id: "size-large", severity: "info", title: `${fmtGb(index.size)}: a very large upload`, what: "Over 128 GB; YouTube allows up to 256 GB.", why: "Processing of 8K uploads of this size has taken a day or more; 'processing will begin shortly' can sit for many hours with nothing wrong with the file." });
    if (index.durationS > YOUTUBE_MAX_SECONDS) push({ id: "length-max", severity: "error", title: `${fmtClock(index.durationS)} is over YouTube's 12-hour limit`, what: "Uploads above 12 hours are refused.", why: "A hard limit.", fix: { kind: "re-export", label: "Export a range", detail: "Export the timeline in two parts, each under 12 hours." } });
  }

  // --- tags
  if (!index.tags.title) push({ id: "no-title", severity: "info", title: "No title in the file", what: `${Object.keys(index.tags).filter((k) => k !== "encoder").length ? "Other tags are present but no title." : "No tags in the file."}`, why: yt ? "YouTube pre-fills the upload's title from the file's title tag, else from the file name. Not needed for processing." : "Players show the file name instead.", fix: TAGS_FIX });
  else push({ id: "tags", severity: "info", title: `Tagged “${index.tags.title}”${index.tags.artist ? ` by ${index.tags.artist}` : ""}`, what: Object.entries(index.tags).filter(([k]) => k !== "encoder" && k !== "title" && k !== "artist").map(([k, val]) => `${k === "albumArtist" ? "album artist" : k} ${val}`).join(", ") || "Title only.", why: yt ? "YouTube takes the title; the Music category and song credits are set on the upload page, and that is what YouTube Music lists by." : "What players show." });
  return out;
}

/* ------------------------------------------------------------------ full scan */

/** Interleaved stereo floats from a decoded sample (a mono track is doubled). */
function stereoOf(sample: AudioSample): Float32Array {
  const frames = sample.numberOfFrames, ch = sample.numberOfChannels;
  const tmp = new Float32Array(frames * ch);
  sample.copyTo(tmp, { format: "f32", planeIndex: 0 });
  if (ch === 2) return tmp;
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = tmp[i * ch];
    out[i * 2 + 1] = ch > 1 ? tmp[i * ch + 1] : tmp[i * ch];
  }
  return out;
}
const abortError = () => new DOMException("Cancelled", "AbortError");
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Where the picture is decoded in a full run: both ends, every irregular cut (thinned for big pictures) and every ten minutes. */
export function probeSpots(v: TrackCheck | undefined, durationS: number): number[] {
  if (!v || durationS <= 0) return [];
  const pixels = (v.entry.width ?? 0) * (v.entry.height ?? 0);
  const cap = pixels > 3840 * 2160 ? 120 : pixels > 1920 * 1080 ? 250 : 500;
  const cuts = v.irregularAt.length <= cap ? v.irregularAt : Array.from({ length: cap }, (_, i) => v.irregularAt[Math.floor((i * v.irregularAt.length) / cap)]);
  const spots = new Set<number>([0.5, Math.max(0.5, durationS - 0.5), ...cuts]);
  for (let t = 600; t < durationS - 30; t += 600) spots.add(t);
  return [...spots].filter((t) => t >= 0 && t <= durationS).sort((x, y) => x - y);
}

interface ScanResult {
  findings: Finding[];
  checks: CheckRun[];
  loudness?: Loudness;
  cancelled: boolean;
}

async function fullScan(file: Blob, index: Mp4Check, facts: DoctorFacts, target: DoctorTarget, signal: AbortSignal | undefined, progress: (stage: string, fraction: number) => void): Promise<ScanResult> {
  const findings: Finding[] = [], checks: CheckRun[] = [];
  const yt = target === "youtube";
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let cancelled = false;
  let loudness: Loudness | undefined;
  const v = index.tracks.find((t) => t.kind === "video"), a = index.tracks.find((t) => t.kind === "audio");
  try {
    // 1. every packet of every track: readable, counted, in order
    const tracks = await input.getTracks();
    const totalBytes = Math.max(1, index.tracks.reduce((s, t) => s + t.bytes, 0));
    let readBytes = 0;
    const packetProblems: string[] = [];
    for (const track of tracks) {
      const tc = track.type === "video" ? v : track.type === "audio" ? a : undefined;
      const sink = new EncodedPacketSink(track);
      const frameDur = tc && tc.nominalDelta && tc.timescale ? tc.nominalDelta / tc.timescale : 1 / 30;
      const ordered = !!tc && !tc.hasCtts;
      let prev = -Infinity, n = 0, backward = 0, dup = 0, empty = 0;
      const gaps: number[] = [], backAt: number[] = [];
      try {
        for await (const p of sink.packets()) {
          if (signal?.aborted) throw abortError();
          n++;
          readBytes += p.byteLength;
          if (p.byteLength === 0) empty++;
          if (ordered && prev > -Infinity) {
            if (p.timestamp < prev - 1e-6) {
              backward++;
              if (backAt.length < 12) backAt.push(prev);
            } else if (Math.abs(p.timestamp - prev) < 1e-6) {
              dup++;
              if (backAt.length < 12) backAt.push(prev);
            }
          }
          if (track.type === "video" && prev > -Infinity && p.timestamp - prev > frameDur * 2.5 && gaps.length < 12) gaps.push(prev);
          prev = p.timestamp;
          if ((n & 127) === 0) progress("Reading every packet", 0.05 + 0.5 * Math.min(1, readBytes / totalBytes));
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        packetProblems.push(`${track.type}: ${e instanceof Error ? e.message : String(e)} after ${fmtInt(n)} packets`);
        findings.push({ id: `unreadable-${track.type}`, severity: "error", title: `The ${track.type} data could not be read through`, what: `Reading stopped after ${fmtInt(n)} of ${fmtInt(tc?.samples ?? 0)} packets${prev > -Infinity ? ` at ${fmtClock(prev)}` : ""}: ${e instanceof Error ? e.message : String(e)}.`, why: "A packet whose offset or size points outside the file, or a container structure the demuxer rejects. Players stop there; processing fails. Detected by reading every packet of the track.", at: prev > -Infinity ? [prev] : undefined, fix: REEXPORT_FIX });
        continue;
      }
      if (tc && n !== tc.samples) {
        packetProblems.push(`${track.type}: ${fmtInt(n)} packets read, the index lists ${fmtInt(tc.samples)}`);
        findings.push({ id: `count-${track.type}`, severity: "error", title: `The ${track.type} track delivers ${fmtInt(n)} packets but its index lists ${fmtInt(tc.samples)}`, what: "The demuxer and the index disagree on how many samples there are.", why: "Some samples cannot be reached; a player or processor runs out of data before the end. Detected by counting every packet read against the sample table.", fix: REEXPORT_FIX });
      }
      if (empty) {
        packetProblems.push(`${track.type}: ${fmtInt(empty)} empty packets`);
        findings.push({ id: `empty-packets-${track.type}`, severity: "warn", title: `${plural(empty, "empty packet")} in the ${track.type} track`, what: "Packets of zero bytes.", why: "A decoder gets nothing for that sample; most skip it, some stop. Detected by reading every packet." });
      }
      if (backward || dup) {
        const hasZero = !!tc?.zeroLength;
        packetProblems.push(`${track.type}: ${fmtInt(backward)} backward and ${fmtInt(dup)} repeated timestamps`);
        if (!hasZero) findings.push({ id: `order-${track.type}`, severity: "error", title: `${track.type === "video" ? "Frames" : "Samples"} out of order in the ${track.type} track`, what: `${backward ? `${fmtInt(backward)} timestamps step backwards` : ""}${backward && dup ? " and " : ""}${dup ? `${fmtInt(dup)} repeat the previous one` : ""}, first at ${listAt(backAt)}.`, why: "ffmpeg-based pipelines report a non-monotonic DTS and may abort or stall there; players drop or freeze. Detected by reading every packet in order.", at: backAt, fix: indexRepairable(index) ? REPAIR_FIX : REMUX_FIX });
      }
      if (gaps.length) findings.push({ id: "gaps", severity: "warn", title: `${plural(gaps.length, "gap")} in the picture's timestamps`, what: `More than two and a half frames pass between one frame and the next, first at ${listAt(gaps)}.`, why: "A frozen picture for the length of the gap; harmless for an intentional hold, a sign of dropped frames otherwise. Detected by reading every packet.", at: gaps });
    }
    checks.push({ id: "packets", title: "Every packet read", status: packetProblems.length ? "problem" : "ok", detail: packetProblems.length ? packetProblems.join("; ") : `${fmtGb(readBytes)} read through ${tracks.length} track${tracks.length === 1 ? "" : "s"}; every packet reachable${v && !v.hasCtts ? ", timestamps in order" : ""}` });

    // 2. the whole soundtrack decoded, with the loudness meter running
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && (await audioTrack.canDecode())) {
      const meter = new LoudnessMeter(audioTrack.sampleRate);
      const sink = new AudioSampleSink(audioTrack);
      let t = 0, failed: string | null = null;
      try {
        for await (const s of sink.samples()) {
          if (signal?.aborted) {
            s.close();
            throw abortError();
          }
          meter.add(stereoOf(s));
          t = s.timestamp + s.duration;
          s.close();
          progress("Decoding the sound", 0.55 + 0.2 * Math.min(1, t / Math.max(1e-6, facts.durationS)));
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        failed = e instanceof Error ? e.message : String(e);
      }
      if (failed) {
        findings.push({ id: "audio-decode", severity: "error", title: "The sound stops decoding", what: `The decoder failed at ${fmtClock(t)}: ${failed}.`, why: "Corrupt or truncated audio data; players go silent or stop there, processing fails. Detected by decoding the whole soundtrack.", at: [t], fix: REEXPORT_FIX });
        checks.push({ id: "audio", title: "Soundtrack decoded", status: "problem", detail: `failed at ${fmtClock(t)}` });
      } else {
        loudness = meter.result();
        checks.push({ id: "audio", title: "Soundtrack decoded", status: "ok", detail: `${fmtClock(t)} decoded; ${loudness.integrated === null ? "silent" : `${loudness.integrated.toFixed(1)} LUFS, peaks at ${loudness.peakDb.toFixed(1)} dBFS`}` });
        if (loudness.integrated === null) findings.push({ id: "silent", severity: "warn", title: "The soundtrack is silent", what: "Nothing above the loudness gate over the whole file.", why: "An export without any music or camera sound, or a muted mix. Detected by metering the decoded sound." });
        else if (yt) {
          const gap = YOUTUBE_LUFS - loudness.integrated;
          if (gap > 3) findings.push({ id: "quiet", severity: "warn", title: `${loudness.integrated.toFixed(1)} LUFS: ${gap.toFixed(1)} dB quieter than YouTube's level`, what: `YouTube plays everything at ${YOUTUBE_LUFS} LUFS and never turns a quiet upload up; this one would play ${gap.toFixed(1)} dB under everything else. Peaks at ${loudness.peakDb.toFixed(1)} dBFS leave room to raise it.`, why: "Measured with the ITU-R BS.1770-4 meter over the whole decoded soundtrack, the same meter YouTube's normalisation uses.", fix: LEVEL_FIX });
          else if (gap < -3) findings.push({ id: "loud", severity: "info", title: `${loudness.integrated.toFixed(1)} LUFS: YouTube will turn it down by ${(-gap).toFixed(1)} dB`, what: `Louder than YouTube's ${YOUTUBE_LUFS} LUFS playback level.`, why: "No harm beyond the lost headroom; the limiting in the master stays. Measured with the BS.1770-4 meter." });
          else findings.push({ id: "level-ok", severity: "info", title: `${loudness.integrated.toFixed(1)} LUFS, at YouTube's level`, what: `Within 3 dB of ${YOUTUBE_LUFS} LUFS; peaks at ${loudness.peakDb.toFixed(1)} dBFS.`, why: "Plays as loud as everything else on YouTube. Measured with the BS.1770-4 meter." });
        } else if (loudness.integrated < -20) findings.push({ id: "quiet", severity: "info", title: `${loudness.integrated.toFixed(1)} LUFS: a quiet soundtrack`, what: `Streaming services sit around −14 to −16 LUFS; peaks at ${loudness.peakDb.toFixed(1)} dBFS.`, why: "Viewers turn it up; nothing wrong with the file. Measured with the BS.1770-4 meter.", fix: LEVEL_FIX });
        if (loudness.integrated !== null && loudness.peakDb > -0.1) findings.push({ id: "peaks", severity: "info", title: "Peaks at full scale", what: `The sound reaches ${loudness.peakDb.toFixed(2)} dBFS.`, why: "Samples at 0 dBFS can clip after YouTube's re-encode; −1 dBFS of headroom avoids it. Measured on the decoded sound." });
      }
    } else checks.push({ id: "audio", title: "Soundtrack decoded", status: "skipped", detail: audioTrack ? "this browser has no decoder for the sound codec" : "no sound track" });

    // 3. the picture decoded at the spots that matter
    const videoTrack = await input.getPrimaryVideoTrack();
    if (videoTrack && (await videoTrack.canDecode())) {
      const spots = probeSpots(v, facts.durationS);
      const sink = new VideoSampleSink(videoTrack);
      const failures: { t: number; message: string }[] = [];
      let frames = 0, done = 0;
      for (const t of spots) {
        if (signal?.aborted) throw abortError();
        const from = Math.max(0, t - 0.6), to = Math.min(facts.durationS, from + 1.2);
        try {
          for await (const s of sink.samples(from, to)) {
            s.close();
            frames++;
            if (signal?.aborted) throw abortError();
          }
        } catch (e) {
          if (isAbort(e)) throw e;
          if (failures.length < 12) failures.push({ t, message: e instanceof Error ? e.message : String(e) });
        }
        done++;
        progress(`Decoding the picture at ${spots.length} spots`, 0.75 + 0.25 * (done / spots.length));
      }
      if (failures.length) findings.push({ id: "video-decode", severity: "error", title: `The picture fails to decode at ${plural(failures.length, "spot")}`, what: failures.slice(0, 3).map((f) => `${fmtClock(f.t)}: ${f.message}`).join("; ") + (failures.length > 3 ? "; …" : ""), why: "Corrupt frame data or a broken reference chain; players show artefacts or freeze there, processing fails. Detected by decoding a second of picture at each spot with the browser's decoder.", at: failures.map((f) => f.t), fix: REEXPORT_FIX });
      checks.push({ id: "video", title: `Picture decoded at ${spots.length} spots`, status: failures.length ? "problem" : "ok", detail: failures.length ? `${failures.length} of ${spots.length} spots failed` : `${fmtInt(frames)} frames decoded around every cut, at both ends and every ten minutes` });
    } else checks.push({ id: "video", title: "Picture decoded", status: "skipped", detail: videoTrack ? "this browser has no decoder for the picture (an 8K HEVC file needs a hardware decoder)" : "no picture track" });
  } catch (e) {
    if (!isAbort(e)) throw e;
    cancelled = true;
    checks.push({ id: "cancelled", title: "Full scan", status: "cancelled", detail: "stopped before it finished; the quick findings stand" });
  } finally {
    input.dispose?.();
  }
  return { findings, checks, loudness, cancelled };
}

/* ------------------------------------------------------------------ diagnose */

export function describeReport(r: Pick<DoctorReport, "errors" | "warnings" | "target" | "cancelled">): string {
  if (r.errors) return `${plural(r.errors, "problem")}${r.warnings ? `, ${plural(r.warnings, "warning")}` : ""}`;
  if (r.warnings) return `No problems, ${plural(r.warnings, "warning")}`;
  return r.target === "youtube" ? "Ready for YouTube" : "Plays fine";
}

export async function diagnose(file: Blob & { name?: string }, opts: DiagnoseOptions): Promise<DoctorReport> {
  const started = Date.now();
  // The scans report after every packet and every decoded sample; the host re-renders on each report, so they are
  // thinned to a stage change, a quarter of a second, or the end.
  let lastStage = "", lastAt = 0;
  const progress = (stage: string, fraction: number) => {
    const now = Date.now();
    if (stage === lastStage && fraction < 1 && now - lastAt < 250) return;
    lastStage = stage;
    lastAt = now;
    opts.onProgress?.({ stage, fraction });
  };
  progress("Reading the index", 0.01);
  const index = await checkMp4(file);
  const facts = factsOf(file.name ?? "video", index);
  const findings = quickFindings(index, facts, opts.target);
  const checks: CheckRun[] = [
    { id: "index", title: "Container and index", status: index.ok ? "ok" : "problem", detail: index.ok ? `${index.tracks.length} track${index.tracks.length === 1 ? "" : "s"}, ${fmtClock(index.durationS)}, every sample accounted for` : index.problems.join("; ") },
    { id: "codec", title: "Codec parameters", status: findings.some((f) => f.severity !== "info" && /level|profile|codec|fps|too-big/.test(f.id)) ? "problem" : "ok", detail: [facts.video?.label, facts.audio?.label].filter(Boolean).join(" · ") || "no streams" },
    { id: "rules", title: `${TARGETS[opts.target].label} rules`, status: findings.some((f) => f.severity === "error" && /size|length|too-big/.test(f.id)) ? "problem" : "ok", detail: opts.target === "youtube" ? `${fmtGb(index.size)}, ${fmtClock(index.durationS)}${facts.video ? `, ${facts.video.width}×${facts.video.height} at ${facts.video.fps.toFixed(2)} fps` : ""}` : "no limits apply" },
  ];
  let cancelled = false;
  if (opts.depth === "full" && index.moovAt >= 0 && index.tracks.length) {
    const scan = await fullScan(file, index, facts, opts.target, opts.signal, progress);
    findings.push(...scan.findings);
    checks.push(...scan.checks);
    if (scan.loudness) facts.loudness = scan.loudness;
    cancelled = scan.cancelled;
  }
  progress("Done", 1);
  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  const errors = findings.filter((f) => f.severity === "error").length, warnings = findings.filter((f) => f.severity === "warn").length;
  const report: DoctorReport = { target: opts.target, depth: opts.depth, facts, findings, checks, errors, warnings, ok: errors === 0, verdict: "", ms: Date.now() - started, index, cancelled: cancelled || undefined };
  report.verdict = describeReport(report);
  return report;
}
