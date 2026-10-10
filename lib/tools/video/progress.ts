/**
 * Export progress bookkeeping as pure maths: frames, timeline seconds and
 * bytes done, active time (pauses excluded), recent speed and a remaining-time
 * estimate. The engine feeds it; the UI renders its snapshots.
 */

import type { ExportSpan } from "./project";

export type ExportPhase = "video" | "audio" | "finalize" | "done";

export interface ExportProgress {
  phase: ExportPhase;
  /** Overall 0…1: video fills the first 90 %, audio the next 9 %, finalising the last 1 %. */
  fraction: number;
  /** Timeline seconds covered so far and in total (the export range). */
  timelineT: number;
  total: number;
  span?: ExportSpan;
  spanIndex: number;
  spanCount: number;
  frames: number;
  framesTotal: number;
  /** Frames per wall-clock second over the last few seconds, and timeline seconds per wall second overall. */
  fps: number;
  realtime: number;
  bytesWritten: number;
  /** Wall time spent working (pauses excluded) and paused. */
  elapsedMs: number;
  pausedMs: number;
  /** Estimated remaining wall time, or null before there is anything to go on. */
  etaMs: number | null;
  paused: boolean;
  /** Date.now() when the export started. */
  startedAt: number;
  /** Audio mixed so far (timeline seconds), in the audio phase. */
  audioT: number;
}

const VIDEO_SHARE = 0.9, AUDIO_SHARE = 0.09;

export class ProgressTracker {
  frames = 0;
  bytes = 0;
  /** Timeline seconds of video rendered so far. */
  processed = 0;
  audioT = 0;
  private readonly start: number;
  private pausedMs = 0;
  private pauseStart: number | null = null;
  private audioStart: number | null = null;
  private window: { at: number; frames: number }[] = [];
  readonly startedAt: number;
  readonly total: number;
  readonly framesTotal: number;
  private readonly now: () => number;

  constructor(now: () => number, total: number, framesTotal: number, startedAt = Date.now()) {
    this.now = now;
    this.total = total;
    this.framesTotal = framesTotal;
    this.start = now();
    this.startedAt = startedAt;
  }

  get paused() {
    return this.pauseStart !== null;
  }
  pause() {
    if (this.pauseStart === null) this.pauseStart = this.now();
  }
  resume() {
    if (this.pauseStart !== null) {
      this.pausedMs += this.now() - this.pauseStart;
      this.pauseStart = null;
    }
  }
  /** Active wall time so far, pauses excluded. */
  elapsedMs() {
    return this.now() - this.start - this.pausedMs - (this.pauseStart !== null ? this.now() - this.pauseStart : 0);
  }
  frame(timelineEnd: number) {
    this.frames++;
    this.processed = Math.max(this.processed, Math.min(this.total, timelineEnd));
    const at = this.now();
    this.window.push({ at, frames: this.frames });
    while (this.window.length > 2 && this.window[0].at < at - 3000) this.window.shift();
  }
  addBytes(n: number) {
    this.bytes += n;
  }
  audio(timelineT: number) {
    if (this.audioStart === null) this.audioStart = this.now();
    this.audioT = Math.min(this.total, Math.max(this.audioT, timelineT));
  }
  /** Frames per second over the recent window. */
  fps() {
    if (this.window.length < 2) return 0;
    const a = this.window[0], b = this.window[this.window.length - 1];
    const dt = (b.at - a.at) / 1000;
    return dt > 0 ? (b.frames - a.frames) / dt : 0;
  }
  /** Timeline seconds rendered per active wall second. */
  realtime() {
    const s = this.elapsedMs() / 1000;
    return s > 0 ? this.processed / s : 0;
  }
  snapshot(phase: ExportPhase, span: ExportSpan | undefined, spanIndex: number, spanCount: number): ExportProgress {
    const total = Math.max(1e-6, this.total);
    const videoFrac = Math.min(1, this.processed / total);
    const audioFrac = Math.min(1, this.audioT / total);
    const fraction = phase === "done" ? 1 : phase === "finalize" ? VIDEO_SHARE + AUDIO_SHARE : phase === "audio" ? VIDEO_SHARE + AUDIO_SHARE * audioFrac : VIDEO_SHARE * videoFrac;
    let etaMs: number | null = null;
    if (phase === "video") {
      const rt = this.realtime();
      if (rt > 0 && this.processed > 0.5) etaMs = ((total - this.processed) / rt) * 1000 * (1 + AUDIO_SHARE / VIDEO_SHARE);
    } else if (phase === "audio") {
      const s = this.audioStart !== null ? (this.now() - this.audioStart) / 1000 : 0;
      const rate = s > 0 ? this.audioT / s : 0;
      if (rate > 0 && this.audioT > 0.5) etaMs = ((total - this.audioT) / rate) * 1000;
    } else if (phase === "finalize") etaMs = 2000;
    else etaMs = 0;
    return {
      phase,
      fraction,
      timelineT: this.processed,
      total: this.total,
      span,
      spanIndex,
      spanCount,
      frames: this.frames,
      framesTotal: this.framesTotal,
      fps: this.fps(),
      realtime: this.realtime(),
      bytesWritten: this.bytes,
      elapsedMs: this.elapsedMs(),
      pausedMs: this.pausedMs + (this.pauseStart !== null ? this.now() - this.pauseStart : 0),
      etaMs,
      paused: this.paused,
      startedAt: this.startedAt,
      audioT: this.audioT,
    };
  }
}

/** h:mm:ss.mmm for timeline positions. */
export function fmtMs(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = ms % 1000;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
}
/** h:mm:ss.t for durations of wall time. */
export function fmtDuration(ms: number): string {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), d = Math.floor((t % 1000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}
/** Bytes as MB / GB with sensible precision. */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(3)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e3).toFixed(0)} kB`;
}
