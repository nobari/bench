/**
 * Audio file conversion on top of mediabunny: probe any container the
 * browser can demux, then transcode to MP3 / AAC / Opus / FLAC / WAV with
 * bitrate, sample-rate, channel, trim, gain/normalise and tag options.
 * Everything runs locally (WebCodecs + a WASM LAME encoder for MP3).
 */

import {
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type MetadataTags,
  type OutputFormat,
} from "mediabunny";

export type OutputId = "mp3" | "m4a" | "ogg" | "webm" | "aac" | "flac" | "wav";

export interface OutputFormatDef {
  id: OutputId;
  label: string;
  ext: string;
  mime: string;
  codec: AudioCodec;
  lossy: boolean;
  bitrates: number[];
  defaultBitrate: number;
  note: string;
  make: () => OutputFormat;
}

const LOSSY = [48, 64, 96, 128, 160, 192, 256, 320];

export const OUTPUT_FORMATS: OutputFormatDef[] = [
  { id: "mp3", label: "MP3", ext: "mp3", mime: "audio/mpeg", codec: "mp3", lossy: true, bitrates: LOSSY, defaultBitrate: 192, note: "Plays everywhere", make: () => new Mp3OutputFormat() },
  { id: "m4a", label: "AAC · M4A", ext: "m4a", mime: "audio/mp4", codec: "aac", lossy: true, bitrates: LOSSY, defaultBitrate: 192, note: "Apple & streaming default", make: () => new Mp4OutputFormat({ fastStart: "in-memory" }) },
  { id: "ogg", label: "Opus · Ogg", ext: "ogg", mime: "audio/ogg", codec: "opus", lossy: true, bitrates: [32, 48, 64, 96, 128, 160, 192, 256], defaultBitrate: 128, note: "Best quality per kilobit", make: () => new OggOutputFormat() },
  { id: "webm", label: "Opus · WebM", ext: "webm", mime: "audio/webm", codec: "opus", lossy: true, bitrates: [32, 48, 64, 96, 128, 160, 192, 256], defaultBitrate: 128, note: "Web-native container", make: () => new WebMOutputFormat() },
  { id: "aac", label: "AAC · ADTS", ext: "aac", mime: "audio/aac", codec: "aac", lossy: true, bitrates: LOSSY, defaultBitrate: 192, note: "Raw AAC stream", make: () => new AdtsOutputFormat() },
  { id: "flac", label: "FLAC", ext: "flac", mime: "audio/flac", codec: "flac", lossy: false, bitrates: [], defaultBitrate: 0, note: "Lossless, ~50–60% of WAV", make: () => new FlacOutputFormat() },
  { id: "wav", label: "WAV", ext: "wav", mime: "audio/wav", codec: "pcm-s16", lossy: false, bitrates: [], defaultBitrate: 0, note: "Uncompressed PCM", make: () => new WavOutputFormat() },
];

export const WAV_DEPTHS: { id: AudioCodec; label: string }[] = [
  { id: "pcm-s16", label: "16-bit" },
  { id: "pcm-s24", label: "24-bit" },
  { id: "pcm-f32", label: "32-bit float" },
];

export const SAMPLE_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000];

let mp3Ready: Promise<boolean> | null = null;
/** MP3 encoding is rarely native; load the WASM LAME encoder on demand. */
export function ensureMp3Encoder(): Promise<boolean> {
  if (!mp3Ready) {
    mp3Ready = (async () => {
      if (await canEncodeAudio("mp3")) return true;
      const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
      registerMp3Encoder();
      return canEncodeAudio("mp3");
    })().catch(() => false);
  }
  return mp3Ready;
}

export async function encodableFormats(): Promise<Record<OutputId, boolean>> {
  const out = {} as Record<OutputId, boolean>;
  for (const f of OUTPUT_FORMATS) out[f.id] = f.id === "mp3" ? await ensureMp3Encoder() : await canEncodeAudio(f.codec).catch(() => false);
  return out;
}

export interface AudioInfo {
  container: string;
  mime: string;
  duration: number;
  codec: string | null;
  sampleRate: number;
  channels: number;
  bitrateKbps: number | null;
  tags: MetadataTags;
  hasVideo: boolean;
}

export async function probeAudio(file: File): Promise<AudioInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = await input.getFormat();
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("No audio track in this file.");
  const [duration, video, tags, mime] = await Promise.all([
    input.computeDuration(),
    input.getPrimaryVideoTrack(),
    input.getMetadataTags().catch(() => ({}) as MetadataTags),
    input.getMimeType().catch(() => file.type),
  ]);
  return {
    container: format.name,
    mime,
    duration,
    codec: track.codec,
    sampleRate: track.sampleRate,
    channels: track.numberOfChannels,
    bitrateKbps: duration > 0 ? (file.size * 8) / duration / 1000 : null,
    tags,
    hasVideo: !!video,
  };
}

export interface ConvertOptions {
  format: OutputId;
  bitrateKbps?: number;
  /** 0 / undefined keeps the source rate. */
  sampleRate?: number;
  /** 0 / undefined keeps the source channel count. */
  channels?: number;
  wavCodec?: AudioCodec;
  trimStart?: number;
  trimEnd?: number;
  gainDb?: number;
  /** Peak-normalise to −1 dBFS (two passes). */
  normalize?: boolean;
  /** undefined keeps the source tags, null strips them, an object is merged over them. */
  tags?: MetadataTags | null;
}

export interface ConvertResult {
  blob: Blob;
  name: string;
  bytes: number;
  /** Source peak level when normalising, in dBFS. */
  peakDb: number | null;
}

export async function convertAudio(file: File, opts: ConvertOptions, onProgress?: (p: number) => void): Promise<ConvertResult> {
  const def = OUTPUT_FORMATS.find((f) => f.id === opts.format);
  if (!def) throw new Error("Unknown output format.");
  if (def.id === "mp3" && !(await ensureMp3Encoder())) throw new Error("MP3 encoding isn't available in this browser.");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let gain = opts.gainDb ? 10 ** (opts.gainDb / 20) : 1;
  let peakDb: number | null = null;
  if (opts.normalize) {
    const peak = await measurePeak(input, opts.trimStart, opts.trimEnd);
    if (peak > 0) {
      peakDb = 20 * Math.log10(peak);
      gain *= 10 ** (-1 / 20) / peak;
    }
  }
  const output = new Output({ format: def.make(), target: new BufferTarget() });
  const codec: AudioCodec = def.id === "wav" ? (opts.wavCodec ?? "pcm-s16") : def.codec;
  const transform = Math.abs(gain - 1) > 1e-6;
  const edited = opts.tags;
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      codec,
      bitrate: def.lossy && opts.bitrateKbps ? opts.bitrateKbps * 1000 : undefined,
      sampleRate: opts.sampleRate || undefined,
      numberOfChannels: opts.channels || undefined,
      forceTranscode: transform || undefined,
      process: transform ? (s) => applyGain(s, gain) : undefined,
    },
    trim: opts.trimStart || opts.trimEnd ? { start: opts.trimStart || undefined, end: opts.trimEnd || undefined } : undefined,
    tags: edited === null ? () => ({}) : edited ? (inputTags) => ({ ...inputTags, ...edited }) : undefined,
  });
  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => String(d.reason).replace(/_/g, " ")).join(", ");
    throw new Error(`This file can't be converted${why ? ` (${why})` : ""}.`);
  }
  if (onProgress) conversion.onProgress = (p) => onProgress(p);
  await conversion.execute();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("The conversion produced no data.");
  const base = file.name.replace(/\.[^.]+$/, "") || "audio";
  return { blob: new Blob([buffer], { type: def.mime }), name: `${base}.${def.ext}`, bytes: buffer.byteLength, peakDb };
}

async function measurePeak(input: Input, start?: number, end?: number): Promise<number> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) return 0;
  const sink = new AudioSampleSink(track);
  let peak = 0;
  for await (const sample of sink.samples(start || undefined, end || undefined)) {
    const buf = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
    sample.copyTo(buf, { format: "f32", planeIndex: 0 });
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    sample.close();
  }
  return peak;
}

function applyGain(sample: AudioSample, gain: number): AudioSample {
  const buf = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
  sample.copyTo(buf, { format: "f32", planeIndex: 0 });
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(-1, Math.min(1, buf[i] * gain));
  const out = new AudioSample({ data: buf, format: "f32", numberOfChannels: sample.numberOfChannels, sampleRate: sample.sampleRate, timestamp: sample.timestamp });
  sample.close();
  return out;
}
