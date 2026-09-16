/**
 * Slow-motion → real-time video conversion in the browser.
 *
 * Decode with WebCodecs (via mediabunny), pick source frames at exactly even
 * real-time intervals, optionally blend or stabilise, draw to a canvas and
 * encode H.264 into an MP4 — hardware accelerated where the browser allows.
 * Audio is dropped: a sped-up slow-motion soundtrack is never wanted.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  canEncodeVideo,
  type Rotation,
  type StreamTargetChunk,
  type VideoCodec,
  type VideoSample,
} from "mediabunny";
import { corrections, estimateShift, fitSize, planFrames, targetBitrate, type Shift } from "./retime-core";

export interface VideoInfo {
  width: number;
  height: number;
  rotation: Rotation;
  fps: number;
  duration: number;
  frames: number;
  codec: string | null;
  canDecode: boolean;
  hasAudio: boolean;
  fileSize: number;
}

export function webCodecsSupported(): boolean {
  return typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined";
}

export async function probeVideo(file: File): Promise<VideoInfo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track found in this file.");
    const [stats, duration, canDecode, audio] = await Promise.all([
      track.computePacketStats(300),
      input.computeDuration(),
      track.canDecode(),
      input.getPrimaryAudioTrack(),
    ]);
    const fps = stats.averagePacketRate;
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      rotation: track.rotation,
      fps,
      duration,
      frames: Math.round(fps * duration),
      codec: track.codec,
      canDecode,
      hasAudio: audio !== null,
      fileSize: file.size,
    };
  } finally {
    input.dispose();
  }
}

export interface RetimeOptions {
  /** Playback speed multiplier (4 = four times faster). */
  speed: number;
  outputFps: number;
  /** Average all source frames covering each output frame (motion blur) instead of picking one. */
  blend: boolean;
  stabilize: boolean;
  /** Smoothing window in seconds of real time. */
  stabilizeWindow: number;
  /** Longest output side (0 keeps the source size). */
  maxSize: number;
  quality: "high" | "medium";
  /**
   * Where the MP4 goes. A writable stream (e.g. a FileSystemWritableFileStream
   * from showSaveFilePicker) is written to as encoding proceeds, so output
   * size is bounded by disk, not memory. Without it the file is assembled in
   * memory — browsers cap a single ArrayBuffer at about 2 GB.
   */
  output?: { writable: WritableStream<StreamTargetChunk> };
  onProgress?: (p: { phase: "analyse" | "render" | "finalize"; done: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface RetimeResult {
  /** The file when assembled in memory; null when it was streamed to `output`. */
  blob: Blob | null;
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  codec: VideoCodec;
}

const ANALYSIS_WIDTH = 160;
/** Stabilisation crop margin per side (the frame is zoomed to hide the shifted edges). */
const CROP = 0.05;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Conversion cancelled.", "AbortError");
}

type Emit = (k: number, sample: VideoSample) => void | Promise<void>;

/**
 * Walk the decoded samples in order and call `emit(k, sample)` for every
 * source sample that contributes to output frame k. Without `blend`, output
 * frame k takes the source frame that contains its target time; with it, every
 * frame whose centre falls in the frame's window contributes. Windows that no
 * frame lands in (speed < 1) reuse the previous frame. Samples are closed
 * after use.
 */
async function walk(
  sink: VideoSampleSink,
  count: number,
  sourceTime: (k: number) => number,
  step: number,
  blend: boolean,
  emit: Emit,
  signal?: AbortSignal,
) {
  let k = 0;
  let contributed = false;
  let last: VideoSample | null = null;
  for await (const sample of sink.samples()) {
    throwIfAborted(signal);
    if (blend) {
      const centre = sample.timestamp + sample.duration / 2;
      const j = Math.floor(centre / step + 0.5);
      while (k < j && k < count) {
        if (!contributed && last) await emit(k, last);
        k++;
        contributed = false;
      }
      if (j === k && k < count) {
        await emit(k, sample);
        contributed = true;
      }
    } else {
      while (k < count && sourceTime(k) < sample.timestamp + sample.duration) {
        await emit(k, sample);
        k++;
      }
    }
    last?.close();
    last = sample;
  }
  if (blend && contributed) k++;
  while (k < count && last) {
    await emit(k, last);
    k++;
  }
  last?.close();
}

export async function retimeVideo(file: File, opts: RetimeOptions): Promise<RetimeResult> {
  if (!webCodecsSupported()) throw new Error("This browser doesn't support WebCodecs (needed to decode and encode video).");
  const info = await probeVideo(file);
  if (!info.canDecode) throw new Error(`This browser can't decode ${info.codec ?? "this"} video with WebCodecs.`);

  const { width, height } = fitSize(info.width, info.height, opts.maxSize);
  const plan = planFrames(info.duration, opts.speed, opts.outputFps);
  const bitrate = targetBitrate(width, height, opts.outputFps, opts.quality);

  let codec: VideoCodec = "avc";
  if (!(await canEncodeVideo("avc", { width, height, bitrate }))) {
    if (await canEncodeVideo("hevc", { width, height, bitrate })) codec = "hevc";
    else throw new Error(`This browser can't encode ${width}×${height} video. Try a smaller output size.`);
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const report = (phase: "analyse" | "render" | "finalize", done: number, total: number) =>
    opts.onProgress?.({ phase, done, total });

  try {
    const track = (await input.getPrimaryVideoTrack())!;

    /* ---- pass 1: motion analysis (stabilisation only) ---- */
    let shifts: { x: number; y: number }[] | null = null;
    if (opts.stabilize) {
      const aw = ANALYSIS_WIDTH;
      const ah = Math.max(16, Math.round((aw * height) / width));
      const small = document.createElement("canvas");
      small.width = aw;
      small.height = ah;
      const sctx = small.getContext("2d", { alpha: false, willReadFrequently: true })!;
      let prev: Float32Array | null = null;
      const measured: Shift[] = [];
      await walk(
        new VideoSampleSink(track),
        plan.count,
        plan.sourceTime,
        plan.sourceStep,
        false,
        (k, sample) => {
          sample.draw(sctx, 0, 0, aw, ah);
          const px = sctx.getImageData(0, 0, aw, ah).data;
          const g = new Float32Array(aw * ah);
          for (let i = 0; i < g.length; i++) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
          measured.push(prev ? estimateShift(prev, g, aw, ah, 8) : { dx: 0, dy: 0, confidence: 0 });
          prev = g;
          if (k % 5 === 0) report("analyse", k + 1, plan.count);
        },
        opts.signal,
      );
      const halfWindow = Math.max(1, Math.round((opts.stabilizeWindow * opts.outputFps) / 2));
      const maxShiftSmall = (CROP * aw) / (1 - 2 * CROP);
      const scale = width / aw;
      shifts = corrections(measured, halfWindow, maxShiftSmall).map((c) => ({ x: c.x * scale, y: c.y * scale }));
    }

    /* ---- pass 2: render + encode ---- */
    // No in-memory fast start: it would hold every sample until the end. The moov box is
    // written last with positioned writes, which both targets support.
    const target = opts.output ? new StreamTarget(opts.output.writable, { chunked: true }) : new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: opts.outputFps });
    await output.start();

    const zoom = shifts ? 1 / (1 - 2 * CROP) : 1;
    const dw = width * zoom, dh = height * zoom;
    const baseX = (width - dw) / 2, baseY = (height - dh) / 2;
    const frameDuration = 1 / opts.outputFps;
    let current = -1;
    let contributions = 0;

    const flush = async () => {
      if (current < 0) return;
      ctx.globalAlpha = 1;
      await source.add(plan.outputTime(current), frameDuration);
      if (current % 5 === 0) report("render", current + 1, plan.count);
    };

    try {
      await walk(
        new VideoSampleSink(track),
        plan.count,
        plan.sourceTime,
        plan.sourceStep,
        opts.blend,
        async (k, sample) => {
          if (k !== current) {
            await flush();
            current = k;
            contributions = 0;
          }
          const c = shifts?.[k] ?? { x: 0, y: 0 };
          // Running average: the n-th contribution is drawn with alpha 1/n.
          ctx.globalAlpha = 1 / (contributions + 1);
          sample.draw(ctx, baseX + c.x, baseY + c.y, dw, dh);
          contributions++;
        },
        opts.signal,
      );
      await flush();
      throwIfAborted(opts.signal);
      report("finalize", plan.count, plan.count);
      await output.finalize();
    } catch (e) {
      await output.cancel().catch(() => undefined);
      throw e;
    }

    const blob = target instanceof BufferTarget && target.buffer ? new Blob([target.buffer], { type: "video/mp4" }) : null;
    return { blob, width, height, fps: opts.outputFps, frames: plan.count, duration: plan.duration, codec };
  } finally {
    input.dispose();
  }
}
