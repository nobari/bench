/**
 * Video (and audio) conversion and compression on top of mediabunny's conversion pipeline: probe any container the
 * browser can demux, then rewrap or re-encode to MP4, MOV, WebM or MKV — or to an audio-only file — with the codec,
 * rate (a quality level, a bitrate, or a target file size), size, fit, frame rate, rotation, crop, trim, sound and
 * tag options. Streams whose codec already fits the container are copied packet by packet unless something about
 * them changes. Everything runs locally with WebCodecs; the pure parts (rate maths, sizes, names) run in Node.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  QUALITY_VERY_LOW,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type MetadataTags,
  type OutputFormat,
  type Quality,
  type Rotation,
  type StreamTargetChunk,
  type VideoCodec,
} from "mediabunny";
import { applyGain, ensureMp3Encoder, measurePeak } from "@/lib/tools/audio/convert";

/* -------------------------------------------------------------- containers */

export type ContainerId = "mp4" | "mov" | "webm" | "mkv" | "m4a" | "mp3" | "ogg" | "flac" | "wav";

export interface ContainerDef {
  id: ContainerId;
  label: string;
  ext: string;
  mime: string;
  /** Audio-only containers drop the picture. */
  kind: "video" | "audio";
  /** Video codecs the container takes, in order of preference. */
  video: VideoCodec[];
  /** Audio codecs the container takes, in order of preference. */
  audio: AudioCodec[];
  note: string;
  make: (stream: boolean) => OutputFormat;
}

export const CONTAINERS: ContainerDef[] = [
  { id: "mp4", label: "MP4", ext: "mp4", mime: "video/mp4", kind: "video", video: ["avc", "hevc", "av1", "vp9"], audio: ["aac", "opus", "mp3", "flac"], note: "Plays everywhere", make: (stream) => new Mp4OutputFormat({ fastStart: stream ? false : "in-memory" }) },
  { id: "mov", label: "MOV", ext: "mov", mime: "video/quicktime", kind: "video", video: ["avc", "hevc", "av1", "vp9"], audio: ["aac", "opus", "mp3", "flac", "pcm-s16"], note: "QuickTime, Final Cut, iPhone", make: (stream) => new MovOutputFormat({ fastStart: stream ? false : "in-memory" }) },
  { id: "webm", label: "WebM", ext: "webm", mime: "video/webm", kind: "video", video: ["vp9", "av1", "vp8"], audio: ["opus"], note: "Web-native, open codecs", make: () => new WebMOutputFormat() },
  { id: "mkv", label: "MKV", ext: "mkv", mime: "video/x-matroska", kind: "video", video: ["avc", "hevc", "av1", "vp9", "vp8"], audio: ["aac", "opus", "mp3", "flac", "pcm-s16"], note: "Any codec, any track", make: () => new MkvOutputFormat() },
  { id: "m4a", label: "M4A", ext: "m4a", mime: "audio/mp4", kind: "audio", video: [], audio: ["aac"], note: "AAC audio only", make: (stream) => new Mp4OutputFormat({ fastStart: stream ? false : "in-memory" }) },
  { id: "mp3", label: "MP3", ext: "mp3", mime: "audio/mpeg", kind: "audio", video: [], audio: ["mp3"], note: "Audio only, plays everywhere", make: () => new Mp3OutputFormat() },
  { id: "ogg", label: "Ogg", ext: "ogg", mime: "audio/ogg", kind: "audio", video: [], audio: ["opus"], note: "Opus audio only", make: () => new OggOutputFormat() },
  { id: "flac", label: "FLAC", ext: "flac", mime: "audio/flac", kind: "audio", video: [], audio: ["flac"], note: "Lossless audio", make: () => new FlacOutputFormat() },
  { id: "wav", label: "WAV", ext: "wav", mime: "audio/wav", kind: "audio", video: [], audio: ["pcm-s16"], note: "Uncompressed audio", make: () => new WavOutputFormat() },
];
export const containerById = (id: string): ContainerDef => CONTAINERS.find((c) => c.id === id) ?? CONTAINERS[0];

export const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = { avc: "H.264 / AVC", hevc: "H.265 / HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", prores: "ProRes" };
export const AUDIO_CODEC_LABELS: Partial<Record<AudioCodec, string>> = { aac: "AAC", opus: "Opus", mp3: "MP3", flac: "FLAC", "pcm-s16": "PCM 16-bit", vorbis: "Vorbis" };
export const VIDEO_CODEC_NOTES: Record<VideoCodec, string> = {
  avc: "Universal; the largest files at a given quality",
  hevc: "About 40 % smaller than H.264; plays on phones, TVs and Apple devices",
  av1: "The smallest files; slow to encode without hardware, plays on recent devices",
  vp9: "YouTube's codec; open, smaller than H.264",
  vp8: "Old WebM codec",
  prores: "Editing codec; not encodable in browsers",
};

/* ---------------------------------------------------------------- settings */

export type RateMode = "quality" | "bitrate" | "size";
export type Fit = "contain" | "cover" | "fill";
export type Hardware = "no-preference" | "prefer-hardware" | "prefer-software";
export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ConvertSettings {
  container: ContainerId;
  /** "auto" keeps the source codec when the container takes it (copied without re-encoding when nothing else changes). */
  videoCodec: VideoCodec | "auto";
  audioCodec: AudioCodec | "auto";
  rate: RateMode;
  /** 1 (very low) … 5 (very high). */
  quality: number;
  videoKbps: number;
  /** Target size of the whole file, MB. */
  targetMb: number;
  /** Output height; 0 keeps the source. */
  height: number;
  /** Custom width with the height; 0 keeps the aspect. */
  width: number;
  fit: Fit;
  /** 0 keeps the source frame rate. */
  fps: number;
  rotate: Rotation;
  crop: Crop | null;
  /** Seconds between keyframes; 0 leaves it to the encoder. */
  keyframeSeconds: number;
  hardware: Hardware;
  noVideo: boolean;
  noAudio: boolean;
  /** Re-encode even streams that could be copied as they are. */
  forceTranscode: boolean;
  audioKbps: number;
  /** 0 keeps the source. */
  sampleRate: number;
  /** 0 keeps the source; 1 mono; 2 stereo. */
  channels: number;
  gainDb: number;
  normalize: boolean;
  trimStart: number;
  /** 0 means the end. */
  trimEnd: number;
  tags: "keep" | "strip";
  title: string;
  artist: string;
}

export const DEFAULT_SETTINGS: ConvertSettings = {
  container: "mp4",
  videoCodec: "auto",
  audioCodec: "auto",
  rate: "quality",
  quality: 3,
  videoKbps: 8000,
  targetMb: 25,
  height: 0,
  width: 0,
  fit: "contain",
  fps: 0,
  rotate: 0,
  crop: null,
  keyframeSeconds: 0,
  hardware: "no-preference",
  noVideo: false,
  noAudio: false,
  forceTranscode: false,
  audioKbps: 160,
  sampleRate: 0,
  channels: 0,
  gainDb: 0,
  normalize: false,
  trimStart: 0,
  trimEnd: 0,
  tags: "keep",
  title: "",
  artist: "",
};

export const QUALITY_LEVELS: { value: number; label: string; quality: Quality }[] = [
  { value: 1, label: "Very low", quality: QUALITY_VERY_LOW },
  { value: 2, label: "Low", quality: QUALITY_LOW },
  { value: 3, label: "Medium", quality: QUALITY_MEDIUM },
  { value: 4, label: "High", quality: QUALITY_HIGH },
  { value: 5, label: "Very high", quality: QUALITY_VERY_HIGH },
];
export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240];
export const FRAME_RATES = [60, 50, 30, 25, 24, 15, 10];
export const AUDIO_KBPS = [64, 96, 128, 160, 192, 256, 320];
export const SAMPLE_RATES = [22050, 32000, 44100, 48000];
export const RATE_LABELS: Record<RateMode, string> = { quality: "Quality level", bitrate: "Bitrate", size: "Target size" };

export interface Preset {
  id: string;
  label: string;
  note: string;
  patch: Partial<ConvertSettings>;
}
export const PRESETS: Preset[] = [
  { id: "web", label: "Web MP4", note: "H.264 1080p, plays everywhere", patch: { container: "mp4", videoCodec: "avc", audioCodec: "aac", rate: "quality", quality: 4, height: 1080, fps: 0, noVideo: false, noAudio: false, forceTranscode: false } },
  { id: "small", label: "Smallest file", note: "AV1 when this browser encodes it, else HEVC, else VP9", patch: { container: "mp4", videoCodec: "av1", audioCodec: "opus", rate: "quality", quality: 2, noVideo: false, noAudio: false, forceTranscode: false } },
  { id: "chat", label: "Messaging", note: "720p H.264 around 2 Mbit/s for WhatsApp, Telegram, mail", patch: { container: "mp4", videoCodec: "avc", audioCodec: "aac", rate: "bitrate", videoKbps: 2000, height: 720, fps: 30, audioKbps: 96, noVideo: false, noAudio: false, forceTranscode: false } },
  { id: "audio", label: "Audio only", note: "The sound as MP3 at 192 kbit/s", patch: { container: "mp3", audioCodec: "mp3", audioKbps: 192, noVideo: true, noAudio: false } },
  { id: "remux", label: "Lossless remux", note: "Same streams in a new container, nothing re-encoded", patch: { container: "mkv", videoCodec: "auto", audioCodec: "auto", height: 0, fps: 0, rotate: 0, crop: null, noVideo: false, noAudio: false, forceTranscode: false, gainDb: 0, normalize: false } },
];

/* ------------------------------------------------------------------- probe */

export interface MediaInfo {
  container: string;
  mime: string;
  size: number;
  duration: number;
  video: { codec: VideoCodec | null; width: number; height: number; fps: number; rotation: Rotation; canDecode: boolean } | null;
  audio: { codec: AudioCodec | null; sampleRate: number; channels: number; canDecode: boolean } | null;
  bitrateKbps: number | null;
  tags: MetadataTags;
}

export async function probeMedia(file: File): Promise<MediaInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = await input.getFormat();
  const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  if (!video && !audio) throw new Error("No picture or sound track in this file.");
  const [duration, tags, mime] = await Promise.all([input.computeDuration(), input.getMetadataTags().catch(() => ({}) as MetadataTags), input.getMimeType().catch(() => file.type)]);
  let v: MediaInfo["video"] = null;
  if (video) {
    const [stats, canDecode] = await Promise.all([video.computePacketStats(200).catch(() => ({ averagePacketRate: 0 })), video.canDecode().catch(() => false)]);
    v = { codec: video.codec, width: video.displayWidth, height: video.displayHeight, fps: Math.round(stats.averagePacketRate * 1000) / 1000, rotation: video.rotation, canDecode };
  }
  let a: MediaInfo["audio"] = null;
  if (audio) a = { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.numberOfChannels, canDecode: await audio.canDecode().catch(() => false) };
  return { container: format.name, mime, size: file.size, duration, video: v, audio: a, bitrateKbps: duration > 0 ? (file.size * 8) / duration / 1000 : null, tags };
}

/* ----------------------------------------------------------------- support */

export interface Support {
  video: Record<VideoCodec, boolean>;
  audio: Record<string, boolean>;
}

/** Which codecs this browser can encode (MP3 through the WASM encoder, loaded on demand). */
export async function encodableCodecs(): Promise<Support> {
  const video = {} as Record<VideoCodec, boolean>;
  for (const c of ["avc", "hevc", "av1", "vp9", "vp8", "prores"] as VideoCodec[]) video[c] = await canEncodeVideo(c).catch(() => false);
  const audio: Record<string, boolean> = {};
  for (const c of ["aac", "opus", "flac", "pcm-s16", "vorbis"] as AudioCodec[]) audio[c] = await canEncodeAudio(c).catch(() => false);
  audio.mp3 = await ensureMp3Encoder();
  return { video, audio };
}

/**
 * The channel count and sample rate the encoder will take for a codec: the request when it can, else the same
 * channels at the nearest rate it accepts (Chrome's AAC takes only 44.1 and 48 kHz), so a mono request stays mono
 * instead of mediabunny's fallback to stereo at 48 kHz.
 */
export async function encodableAudioParams(codec: AudioCodec, channels: number, sampleRate: number): Promise<{ channels: number; sampleRate: number }> {
  const ok = (ch: number, sr: number) => canEncodeAudio(codec, { numberOfChannels: ch, sampleRate: sr }).catch(() => false);
  if (await ok(channels, sampleRate)) return { channels, sampleRate };
  const rates = [44100, 48000, 32000, 22050, 16000, 8000].sort((a, b) => Math.abs(a - sampleRate) - Math.abs(b - sampleRate));
  for (const sr of rates) if (await ok(channels, sr)) return { channels, sampleRate: sr };
  return { channels, sampleRate };
}

/* ------------------------------------------------------------------- maths */

/** The stretch of the file the conversion covers, seconds. */
export function coveredSeconds(info: Pick<MediaInfo, "duration">, s: Pick<ConvertSettings, "trimStart" | "trimEnd">): number {
  const end = s.trimEnd > 0 ? Math.min(s.trimEnd, info.duration) : info.duration;
  return Math.max(0, end - Math.max(0, s.trimStart));
}

/** The video bitrate (bit/s) a target size calls for, after the sound's share; never under 100 kbit/s. */
export function bitrateForSize(targetMb: number, seconds: number, audioKbps: number): number {
  if (seconds <= 0) return 100_000;
  const total = (targetMb * 1e6 * 8) / seconds;
  return Math.max(100_000, Math.round(total - audioKbps * 1000));
}

/** What the encoder is asked for: a quality level, a bitrate, or the bitrate a target size works out to. */
export function videoRate(s: ConvertSettings, info: MediaInfo): number | Quality {
  if (s.rate === "bitrate") return Math.max(100, s.videoKbps) * 1000;
  if (s.rate === "size") return bitrateForSize(s.targetMb, coveredSeconds(info, s), s.noAudio || !info.audio ? 0 : s.audioKbps);
  return (QUALITY_LEVELS.find((q) => q.value === s.quality) ?? QUALITY_LEVELS[2]).quality;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The picture's size after the rotation, then the crop (taken in the rotated picture, clamped to it), then the scaling. */
export function outputSize(info: MediaInfo, s: ConvertSettings): { width: number; height: number } | null {
  if (!info.video) return null;
  let w = info.video.width, h = info.video.height;
  if (s.rotate === 90 || s.rotate === 270) [w, h] = [h, w];
  if (s.crop) {
    const left = Math.min(Math.max(0, s.crop.left), w), top = Math.min(Math.max(0, s.crop.top), h);
    w = Math.max(1, Math.min(s.crop.width, w - left));
    h = Math.max(1, Math.min(s.crop.height, h - top));
  }
  if (s.height > 0 && h > 0) {
    const targetH = s.height, targetW = s.width > 0 ? s.width : (w * targetH) / h;
    if (s.fit === "fill" || s.width === 0) return { width: even(targetW), height: even(targetH) };
    // contain / cover with a custom size: the box is what was asked for
    return { width: even(targetW), height: even(targetH) };
  }
  return { width: even(w), height: even(h) };
}

/** The bitrate (bit/s) the quality levels stand for at a picture size — mediabunny's own curve, used for estimates. */
export function qualityBitrate(level: number, width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height);
  // Calibrated so that medium at 1080p30 ≈ 6 Mbit/s and the levels step by ~1.6×.
  const base = 6e6 * (pixels / (1920 * 1080)) ** 0.8 * Math.max(0.5, Math.min(2, (fps || 30) / 30)) ** 0.5;
  return Math.round(base * 1.6 ** (level - 3));
}

/** A rough size of the output, bytes; null when nothing is known about the source. */
export function estimateBytes(info: MediaInfo, s: ConvertSettings, container: ContainerDef): number | null {
  const seconds = coveredSeconds(info, s);
  if (seconds <= 0) return null;
  let bits = 0;
  const keepVideo = container.kind === "video" && !s.noVideo && info.video;
  if (keepVideo && info.video) {
    const copied = !pictureReencoded(s, info, container);
    if (copied && info.bitrateKbps) bits += Math.max(0, info.bitrateKbps * 1000 - (info.audio ? 128_000 : 0)) * seconds;
    else {
      const size = outputSize(info, s)!;
      const rate = videoRate(s, info);
      const bps = typeof rate === "number" ? rate : qualityBitrate(s.quality, size.width, size.height, s.fps || info.video.fps);
      bits += bps * seconds;
    }
  }
  if (!s.noAudio && info.audio) {
    const codec = s.audioCodec === "auto" ? (info.audio.codec && container.audio.includes(info.audio.codec) ? info.audio.codec : container.audio[0]) : s.audioCodec;
    const copied = !soundReencoded(s, info, container);
    bits += (copied ? 128_000 : codec === "pcm-s16" ? (s.sampleRate || info.audio.sampleRate) * (s.channels || info.audio.channels) * 16 : codec === "flac" ? 700_000 : s.audioKbps * 1000) * seconds;
  }
  return Math.round(bits / 8);
}

/** Whether a picture setting forces the video to be decoded and encoded again. */
export function transformsPicture(s: ConvertSettings): boolean {
  return s.height > 0 || s.width > 0 || s.fps > 0 || s.rotate !== 0 || s.crop !== null;
}

/**
 * Whether the picture is encoded again rather than copied: always for an explicit codec, a bitrate or a target size,
 * any change to the picture, or "always re-encode"; otherwise only when the source codec does not fit the container.
 */
export function pictureReencoded(s: ConvertSettings, info: MediaInfo, container: ContainerDef): boolean {
  if (!info.video) return false;
  if (s.forceTranscode || transformsPicture(s) || s.videoCodec !== "auto" || s.rate !== "quality") return true;
  return !(info.video.codec && container.video.includes(info.video.codec));
}

/** Whether the sound is encoded again rather than copied. */
export function soundReencoded(s: ConvertSettings, info: MediaInfo, container: ContainerDef): boolean {
  if (!info.audio) return false;
  if (s.forceTranscode || s.audioCodec !== "auto" || s.sampleRate > 0 || s.channels > 0 || s.gainDb !== 0 || s.normalize) return true;
  return !(info.audio.codec && container.audio.includes(info.audio.codec));
}

export function outputName(fileName: string, container: ContainerDef): string {
  const base = fileName.replace(/\.[^.]+$/, "") || "converted";
  const ext = fileName.toLowerCase().endsWith(`.${container.ext}`) ? `.converted.${container.ext}` : `.${container.ext}`;
  return base + ext;
}

/* ----------------------------------------------------------------- convert */

export interface ConvertResult {
  name: string;
  bytes: number;
  /** Encoding passes it took: a target size gets a second pass when the first lands more than 10 % off. */
  passes: number;
  /** Set when the output was kept in memory. */
  blob: Blob | null;
  seconds: number;
  /** What the picture and the sound ended up as. */
  video: { codec: string; copied: boolean } | null;
  audio: { codec: string; copied: boolean } | null;
  peakDb: number | null;
}

export type Destination = { kind: "memory" } | { kind: "stream"; writable: WritableStream<StreamTargetChunk> };

/** How far a target-size result may land from the target before a second pass corrects the bitrate. */
export const SIZE_TOLERANCE = 0.1;

/**
 * Converts one file. A target size is approximate on the first pass — encoders hold a bitrate loosely, hardware ones
 * especially on short clips — so when the output is kept in memory and lands more than 10 % off, the picture's bitrate
 * is scaled by the miss and the file encoded once more; the pass closer to the target (preferring under it) is kept.
 */
export async function convertMedia(
  file: File,
  info: MediaInfo,
  s: ConvertSettings,
  dest: Destination,
  onProgress?: (fraction: number, processedSeconds: number, pass: number) => void,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const first = await convertOnce(file, info, s, dest, (f, t) => onProgress?.(f, t, 1), signal);
  if (s.rate !== "size" || dest.kind !== "memory" || !first.video || first.video.copied) return first;
  const target = s.targetMb * 1e6;
  const miss = first.bytes / target;
  if (Math.abs(miss - 1) <= SIZE_TOLERANCE) return first;
  const seconds = coveredSeconds(info, s);
  const soundBits = first.audio && !first.audio.copied ? s.audioKbps * 1000 * seconds : first.audio ? 128_000 * seconds : 0;
  const pictureBits = Math.max(1, first.bytes * 8 - soundBits);
  const wantedPictureBits = Math.max(100_000 * seconds, target * 8 - soundBits);
  const firstRate = videoRate(s, info);
  if (typeof firstRate !== "number") return first;
  const corrected = Math.max(100_000, Math.round(firstRate * (wantedPictureBits / pictureBits)));
  const second = await convertOnce(file, info, { ...s, rate: "bitrate", videoKbps: corrected / 1000 }, dest, (f, t) => onProgress?.(f, t, 2), signal);
  const pick = (r: ConvertResult) => (r.bytes <= target ? target - r.bytes : (r.bytes - target) * 2);
  const best = pick(second) <= pick(first) ? second : first;
  return { ...best, passes: 2 };
}

async function convertOnce(
  file: File,
  info: MediaInfo,
  s: ConvertSettings,
  dest: Destination,
  onProgress?: (fraction: number, processedSeconds: number) => void,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const container = containerById(s.container);
  if (s.container === "mp3" || s.audioCodec === "mp3") {
    if (!(await ensureMp3Encoder())) throw new Error("MP3 encoding isn't available in this browser.");
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const stream = dest.kind === "stream";
  let written = 0;
  const target =
    dest.kind === "stream"
      ? new StreamTarget(
          new WritableStream<StreamTargetChunk>({
            write: async (chunk) => {
              written += chunk.data.byteLength;
              await writer.write(chunk);
            },
            close: () => writer.close(),
            abort: (r) => writer.abort(r),
          }),
          { chunked: true },
        )
      : new BufferTarget();
  const writer = dest.kind === "stream" ? dest.writable.getWriter() : null!;
  const output = new Output({ format: container.make(stream), target });

  let gain = s.gainDb ? 10 ** (s.gainDb / 20) : 1;
  let peakDb: number | null = null;
  const trim = s.trimStart > 0 || s.trimEnd > 0 ? { start: s.trimStart > 0 ? s.trimStart : undefined, end: s.trimEnd > 0 ? s.trimEnd : undefined } : undefined;
  if (s.normalize && !s.noAudio && info.audio) {
    const peak = await measurePeak(input, trim?.start, trim?.end);
    if (peak > 0) {
      peakDb = 20 * Math.log10(peak);
      gain *= 10 ** (-1 / 20) / peak;
    }
  }
  const soundChanges = Math.abs(gain - 1) > 1e-6;
  const dropVideo = container.kind === "audio" || s.noVideo || !info.video;
  const videoCodec = s.videoCodec === "auto" ? undefined : s.videoCodec;
  const audioCodec = s.audioCodec === "auto" ? undefined : s.audioCodec;
  const size = !dropVideo && (s.height > 0 || s.width > 0) ? outputSize(info, s) : null;
  // A bitrate or quality option makes mediabunny re-encode, so they are passed only when the stream is meant to be.
  const reencodePicture = !dropVideo && pictureReencoded(s, info, container);
  const reencodeSound = !s.noAudio && !!info.audio && (soundReencoded(s, info, container) || soundChanges);
  const soundCodec = audioCodec ?? (info.audio?.codec && container.audio.includes(info.audio.codec) ? info.audio.codec : container.audio[0]);
  const lossless = soundCodec === "pcm-s16" || soundCodec === "flac";
  // A rate or channel count the encoder refuses would make mediabunny fall back to stereo at 48 kHz; settle them first.
  const wantCh = s.channels || info.audio?.channels || 2, wantSr = s.sampleRate || info.audio?.sampleRate || 48000;
  const soundParams = reencodeSound && !lossless ? await encodableAudioParams(soundCodec, wantCh, wantSr) : { channels: wantCh, sampleRate: wantSr };
  const conversion = await Conversion.init({
    input,
    output,
    showWarnings: false,
    video: dropVideo
      ? { discard: true }
      : {
          codec: videoCodec,
          bitrate: reencodePicture ? videoRate(s, info) : undefined,
          width: size?.width,
          height: size?.height,
          fit: size ? s.fit : undefined,
          rotate: s.rotate || undefined,
          // Baked into the pixels, not left as a rotation flag players may or may not honour.
          allowRotationMetadata: s.rotate ? false : undefined,
          crop: s.crop ?? undefined,
          frameRate: s.fps || undefined,
          keyFrameInterval: s.keyframeSeconds || undefined,
          hardwareAcceleration: s.hardware === "no-preference" ? undefined : s.hardware,
          forceTranscode: reencodePicture || undefined,
        },
    audio:
      s.noAudio || !info.audio
        ? { discard: true }
        : {
            codec: audioCodec,
            bitrate: reencodeSound && !lossless ? s.audioKbps * 1000 : undefined,
            sampleRate: reencodeSound && (s.sampleRate || soundParams.sampleRate !== wantSr) ? soundParams.sampleRate : undefined,
            numberOfChannels: reencodeSound && s.channels ? soundParams.channels : undefined,
            forceTranscode: reencodeSound || undefined,
            process: soundChanges ? (sample) => applyGain(sample, gain) : undefined,
          },
    trim,
    tags: s.tags === "strip" ? () => ({}) : s.title.trim() || s.artist.trim() ? (t) => ({ ...t, ...(s.title.trim() ? { title: s.title.trim() } : {}), ...(s.artist.trim() ? { artist: s.artist.trim() } : {}) }) : undefined,
  });
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${String(d.reason).replace(/_/g, " ")}`).join("; ");
    throw new Error(`This file can't be converted like this${why ? ` (${why})` : ""}.`);
  }
  const onAbort = () => void conversion.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    conversion.onProgress = (p, t) => onProgress?.(p, t);
    await conversion.execute();
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  } catch (e) {
    if (dest.kind === "stream") await writer.abort(e).catch(() => undefined);
    throw signal?.aborted ? new DOMException("Cancelled", "AbortError") : e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const outVideo = conversion.utilizedTracks.find((t) => t.type === "video");
  const outAudio = conversion.utilizedTracks.find((t) => t.type === "audio");
  const seconds = coveredSeconds(info, s);
  const pictureCopied = !!outVideo && !reencodePicture;
  const soundCopied = !!outAudio && !reencodeSound;
  const name = outputName(file.name, container);
  if (dest.kind === "stream") {
    return { name, bytes: written, passes: 1, blob: null, seconds, video: outVideo ? { codec: String(outVideo.codec), copied: pictureCopied } : null, audio: outAudio ? { codec: String(outAudio.codec), copied: soundCopied } : null, peakDb };
  }
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("The conversion produced no data.");
  return { name, bytes: buffer.byteLength, passes: 1, blob: new Blob([buffer], { type: container.mime }), seconds, video: outVideo ? { codec: String(outVideo.codec), copied: pictureCopied } : null, audio: outAudio ? { codec: String(outAudio.codec), copied: soundCopied } : null, peakDb };
}

/** m:ss or h:mm:ss (or plain seconds) → seconds; 0 when unreadable. */
export function parseClock(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const rs = r % 1 ? r.toFixed(1).padStart(4, "0") : String(Math.round(r)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rs}` : `${m}:${rs}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
