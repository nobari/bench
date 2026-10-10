/**
 * Export progress bookkeeping as pure maths. The export is a fixed ladder of
 * steps — prepare, one video step per span, the audio mix, finishing the file —
 * and each step carries its own estimate, which starts as a guess (a default,
 * or the speed of your last export) and is replaced by measurement as the
 * step runs. The engine feeds the tracker; the UI renders its snapshots.
 */

import type { ExportSpan } from "./project";

export type ExportPhase = "prepare" | "video" | "audio" | "finalize" | "done";
export type StepKind = "prepare" | "video" | "audio" | "finalize";
export type StepStatus = "pending" | "running" | "done";
/** How trustworthy an estimate is: a built-in guess, a speed learned from an earlier export, or measured in this one. */
export type EstimateSource = "default" | "learned" | "measured" | "actual";

export interface ExportStep {
  id: string;
  kind: StepKind;
  /** Short name ("Render span 2 of 3") and what the step does, in words. */
  title: string;
  detail: string;
  /** Work in the step: timeline seconds for video spans and the audio mix, 1 for prepare and finish. */
  units: number;
  /** Timeline seconds of video before this span (for progress inside it). */
  offset: number;
  spanIndex?: number;
  span?: ExportSpan;
}

export interface StepProgress extends ExportStep {
  status: StepStatus;
  /** Work done so far, in the step's units. */
  done: number;
  /** 0…1 inside the step; null for steps with no measurable inner progress (prepare, finish). */
  fraction: number | null;
  /** Active ms spent in the step so far. */
  elapsedMs: number;
  /** Predicted total active ms: elapsed + remaining while running; the actual time once done. */
  estimateMs: number;
  remainingMs: number;
  source: EstimateSource;
  /** The estimate in words ("measured over the last few seconds", "your last export", "default guess"). */
  basis: string;
  /** What was predicted when the step started, to compare with the actual time once done. */
  promisedMs: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ExportProgress {
  phase: ExportPhase;
  /** Overall 0…1, weighted by each step's estimated time; steps back only when the plan is revised well upward. */
  fraction: number;
  /** Timeline seconds of video rendered so far and in total (the export range). */
  timelineT: number;
  total: number;
  span?: ExportSpan;
  spanIndex: number;
  spanCount: number;
  frames: number;
  framesTotal: number;
  /** Frames per wall second over the last few seconds, and timeline seconds per active wall second for video so far. */
  fps: number;
  realtime: number;
  bytesWritten: number;
  /** Wall time spent working (pauses excluded) and paused. */
  elapsedMs: number;
  pausedMs: number;
  /** Estimated remaining active time across all unfinished steps, and how much of it rests on measurement. */
  etaMs: number;
  etaSource: EstimateSource;
  /** Predicted total active time for the whole export (elapsed + remaining). */
  totalEstimateMs: number;
  paused: boolean;
  /** Date.now() when the export started. */
  startedAt: number;
  /** Audio mixed so far (timeline seconds). */
  audioT: number;
  steps: StepProgress[];
  currentStep: string | null;
}

/** Speeds to estimate from before anything is measured: timeline seconds per active wall second, and fixed ms. */
export interface SpeedPriors {
  encode?: number;
  copy?: number;
  audio?: number;
  prepareMs?: number;
  finalizeMs?: number;
  /** Where these came from, for the UI ("your last export at 2160p HEVC on 9 Oct"). */
  label?: string;
}

/**
 * Built-in guesses, scaled by the pixels decoded and encoded per frame. They
 * are replaced by measurement within a few seconds of each step starting.
 */
export function defaultSpeeds(sourcePixels: number, outputPixels: number): Required<Omit<SpeedPriors, "label">> {
  const px = Math.max(1, sourcePixels, outputPixels);
  const encode = Math.min(8, Math.max(0.15, 25e6 / px));
  return { encode, copy: Math.min(12, encode * 1.6), audio: 40, prepareMs: 800, finalizeMs: 1200 };
}

export interface PlanInput {
  spans: ExportSpan[];
  clipName: (clipId: string) => string;
  /** Conversions that must be loaded before the first frame (DJI's .cube, a custom .cube). */
  lutsToLoad: string[];
  audio: { clips: number; music: number; bitrateKbps: number };
  output: { codec: string; width: number; height: number; preset: string; bitrateMbps: number };
}

/** The ladder of steps for an export, in order, with what each one will do. */
export function planSteps(input: PlanInput): ExportStep[] {
  const steps: ExportStep[] = [];
  const o = input.output;
  const prep = [`check the ${o.codec.toUpperCase()} ${o.width}×${o.height} encoder`, "open the output file"];
  if (input.lutsToLoad.length) prep.push(`load ${input.lutsToLoad.join(" and ")}`);
  prep.push("start the MP4 writer");
  steps.push({ id: "prepare", kind: "prepare", title: "Prepare", detail: prep.join(", ") + ".", units: 1, offset: 0 });
  let offset = 0;
  input.spans.forEach((span, i) => {
    const n = i + 1, len = span.end - span.start;
    const what = span.kind === "copy" ? "re-encode as is, no grade" : `decode, grade on the GPU${span.reasons.length ? ` (${span.reasons.join(", ")})` : ""}, draw titles and overlays, encode`;
    steps.push({
      id: `span-${n}`,
      kind: "video",
      title: `${span.kind === "copy" ? "Copy" : "Render"} span ${n} of ${input.spans.length}`,
      detail: `${input.clipName(span.clipId)} · ${fmtMs(span.start)} → ${fmtMs(span.end)} (${fmtMs(len)}) · ${what}.`,
      units: len,
      offset,
      spanIndex: n,
      span,
    });
    offset += len;
  });
  const a = input.audio;
  const sources = [a.clips ? `the original audio of ${a.clips} clip${a.clips === 1 ? "" : "s"} with their gains` : "", a.music ? `${a.music} music track${a.music === 1 ? "" : "s"} with fades, cut at the end of the video` : ""].filter(Boolean);
  steps.push({
    id: "audio",
    kind: "audio",
    title: "Mix and encode audio",
    detail: `${sources.length ? `Decode and mix ${sources.join(" and ")}` : "No audio sources: write silence"}, resample to 48 kHz stereo, encode AAC at ${a.bitrateKbps} kbps, and write it beside the video.`,
    units: offset,
    offset: 0,
  });
  steps.push({ id: "finalize", kind: "finalize", title: "Finish the file", detail: "Flush the encoders, write the MP4 index (moov) and close the file in the project folder.", units: 1, offset: 0 });
  return steps;
}

interface StepState {
  status: StepStatus;
  /** Active-clock ms at start and end (pauses excluded). */
  startActive: number | null;
  endActive: number | null;
  startedAt: number | null;
  endedAt: number | null;
  promisedMs: number | null;
}

const describe = (s: EstimateSource, label?: string) => (s === "measured" ? "measured in this export" : s === "learned" ? (label ?? "your last export") : "default guess");

export class ProgressTracker {
  frames = 0;
  bytes = 0;
  /** Timeline seconds of video rendered so far. */
  processed = 0;
  audioT = 0;
  readonly steps: ExportStep[];
  readonly startedAt: number;
  readonly total: number;
  readonly framesTotal: number;
  private readonly priors: SpeedPriors;
  private readonly defaults: Required<Omit<SpeedPriors, "label">>;
  private readonly state = new Map<string, StepState>();
  private current: string | null = null;
  private readonly start: number;
  private pausedMs = 0;
  private pauseStart: number | null = null;
  private window: { at: number; frames: number }[] = [];
  /** The overall fraction never falls — unless the plan is revised upward by a quarter or more, when it is allowed to step back. */
  private maxFraction = 0;
  private maxTotal = 0;
  private readonly now: () => number;

  constructor(now: () => number, steps: ExportStep[], total: number, framesTotal: number, priors: SpeedPriors = {}, defaults = defaultSpeeds(0, 0), startedAt = Date.now()) {
    this.now = now;
    this.steps = steps;
    this.total = total;
    this.framesTotal = framesTotal;
    this.priors = priors;
    this.defaults = defaults;
    this.start = now();
    this.startedAt = startedAt;
    for (const s of steps) this.state.set(s.id, { status: "pending", startActive: null, endActive: null, startedAt: null, endedAt: null, promisedMs: null });
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
  private wall() {
    return this.startedAt + (this.now() - this.start);
  }

  /** Enter a step; any step still running is closed first. */
  beginStep(id: string) {
    if (this.current) this.endStep();
    const st = this.state.get(id);
    if (!st) throw new Error(`Unknown export step ${id}`);
    st.promisedMs = this.estimate(this.steps.find((s) => s.id === id)!).estimateMs;
    st.status = "running";
    st.startActive = this.elapsedMs();
    st.startedAt = this.wall();
    this.current = id;
  }
  endStep() {
    if (!this.current) return;
    const st = this.state.get(this.current)!;
    st.status = "done";
    st.endActive = this.elapsedMs();
    st.endedAt = this.wall();
    this.current = null;
  }
  get currentStep() {
    return this.current;
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
    this.audioT = Math.min(this.total, Math.max(this.audioT, timelineT));
  }
  /** Frames per second over the recent window. */
  fps() {
    if (this.window.length < 2) return 0;
    const a = this.window[0], b = this.window[this.window.length - 1];
    const dt = (b.at - a.at) / 1000;
    return dt > 0 ? (b.frames - a.frames) / dt : 0;
  }
  /** Timeline seconds of video rendered per active wall second spent in video steps. */
  realtime() {
    const ms = this.activeIn((s) => s.kind === "video");
    return ms > 0 ? this.processed / (ms / 1000) : 0;
  }

  /* ---------------------------------------------------------------- estimates */

  private stepActive(id: string) {
    const st = this.state.get(id)!;
    if (st.startActive === null) return 0;
    return (st.endActive ?? this.elapsedMs()) - st.startActive;
  }
  private activeIn(pick: (s: ExportStep) => boolean) {
    return this.steps.filter(pick).reduce((a, s) => a + this.stepActive(s.id), 0);
  }
  private doneUnits(s: ExportStep) {
    // A finished step is whole, whatever the last frame's timestamp said.
    if (this.state.get(s.id)!.status === "done") return s.units;
    if (s.kind === "video") return Math.max(0, Math.min(s.units, this.processed - s.offset));
    if (s.kind === "audio") return Math.min(s.units, this.audioT);
    return this.state.get(s.id)!.status === "done" ? 1 : 0;
  }
  /** Rate for a kind of work, measured across this export when there is enough to go on, else a prior. */
  private rate(kind: "encode" | "copy" | "audio"): { rate: number; source: EstimateSource } {
    const pick = (s: ExportStep) => (kind === "audio" ? s.kind === "audio" : s.kind === "video" && s.span?.kind === kind);
    const ms = this.activeIn(pick);
    const units = this.steps.filter(pick).reduce((a, s) => a + this.doneUnits(s), 0);
    const prior = this.priors[kind] !== undefined ? { rate: this.priors[kind]!, source: "learned" as const } : { rate: this.defaults[kind], source: "default" as const };
    if (ms >= 1000 && units >= 0.25) {
      const measured = units / (ms / 1000);
      // Lean on the measurement as it accumulates; after three seconds it stands alone.
      const w = Math.min(1, (ms - 1000) / 2000);
      return { rate: w * measured + (1 - w) * prior.rate, source: w >= 0.5 ? "measured" : prior.source };
    }
    return prior;
  }
  private estimate(s: ExportStep): { estimateMs: number; remainingMs: number; source: EstimateSource; basis: string } {
    const st = this.state.get(s.id)!;
    const elapsed = this.stepActive(s.id);
    if (st.status === "done") return { estimateMs: elapsed, remainingMs: 0, source: "actual", basis: "actual time" };
    if (s.kind === "prepare" || s.kind === "finalize") {
      const key = s.kind === "prepare" ? "prepareMs" : "finalizeMs";
      const learned = this.priors[key];
      const guess = learned ?? this.defaults[key];
      const source: EstimateSource = learned !== undefined ? "learned" : "default";
      // No inner progress to measure: once past the guess, promise a little more rather than zero.
      const remaining = st.status === "running" ? Math.max(elapsed > guess ? guess * 0.25 : guess - elapsed, 0) : guess;
      return { estimateMs: elapsed + remaining, remainingMs: remaining, source, basis: describe(source, this.priors.label) };
    }
    const kind = s.kind === "audio" ? "audio" : s.span?.kind === "copy" ? "copy" : "encode";
    const r = this.rate(kind);
    const remaining = ((s.units - this.doneUnits(s)) / Math.max(1e-6, r.rate)) * 1000;
    const basis = r.source === "measured" ? (st.status === "running" ? "measured in this step" : `measured on an earlier ${kind === "audio" ? "audio" : kind} step`) : describe(r.source, this.priors.label) + (st.status === "running" ? ", measuring…" : "");
    return { estimateMs: elapsed + remaining, remainingMs: remaining, source: r.source, basis };
  }

  /** The measured speeds of this export, to seed the next one's estimates. */
  measured(): SpeedPriors {
    const out: SpeedPriors = {};
    for (const kind of ["encode", "copy", "audio"] as const) {
      const pick = (s: ExportStep) => (kind === "audio" ? s.kind === "audio" : s.kind === "video" && s.span?.kind === kind);
      const ms = this.activeIn(pick), units = this.steps.filter(pick).reduce((a, s) => a + this.doneUnits(s), 0);
      if (ms >= 150 && units >= 0.5) out[kind] = units / (ms / 1000);
    }
    for (const [id, key] of [["prepare", "prepareMs"], ["finalize", "finalizeMs"]] as const) {
      if (this.state.get(id)?.status === "done") out[key] = this.stepActive(id);
    }
    return out;
  }

  snapshot(): ExportProgress {
    const steps: StepProgress[] = this.steps.map((s) => {
      const st = this.state.get(s.id)!;
      const e = this.estimate(s);
      const done = this.doneUnits(s);
      return {
        ...s,
        status: st.status,
        done,
        fraction: s.kind === "prepare" || s.kind === "finalize" ? (st.status === "done" ? 1 : null) : Math.min(1, done / Math.max(1e-6, s.units)),
        elapsedMs: this.stepActive(s.id),
        estimateMs: e.estimateMs,
        remainingMs: e.remainingMs,
        source: e.source,
        basis: e.basis,
        promisedMs: st.promisedMs,
        startedAt: st.startedAt,
        endedAt: st.endedAt,
      };
    });
    const cur = steps.find((s) => s.status === "running") ?? null;
    const allDone = steps.every((s) => s.status === "done");
    const phase: ExportPhase = allDone ? "done" : (cur ?? steps.find((s) => s.status === "pending"))?.kind ?? "done";
    const totalEstimateMs = steps.reduce((a, s) => a + s.estimateMs, 0);
    const doneMs = steps.reduce((a, s) => a + (s.status === "done" ? s.estimateMs : s.elapsedMs), 0);
    const etaMs = allDone ? 0 : steps.reduce((a, s) => a + s.remainingMs, 0);
    const measuredMs = steps.reduce((a, s) => a + (s.source === "measured" ? s.remainingMs : 0), 0);
    const learnedMs = steps.reduce((a, s) => a + (s.source === "learned" ? s.remainingMs : 0), 0);
    const etaSource: EstimateSource = allDone ? "actual" : etaMs > 0 && measuredMs / etaMs >= 0.8 ? "measured" : etaMs > 0 && (measuredMs + learnedMs) / etaMs >= 0.8 ? "learned" : "default";
    const raw = allDone ? 1 : totalEstimateMs > 0 ? Math.min(0.999, doneMs / totalEstimateMs) : 0;
    if (totalEstimateMs > this.maxTotal * 1.25) {
      // A guess turned out far too optimistic: an honest bar steps back rather than stalling at the old figure.
      this.maxFraction = raw;
      this.maxTotal = totalEstimateMs;
    } else this.maxFraction = Math.max(this.maxFraction, raw);
    const videoSteps = steps.filter((s) => s.kind === "video");
    const spanStep = cur?.kind === "video" ? cur : null;
    return {
      phase,
      fraction: this.maxFraction,
      timelineT: this.processed,
      total: this.total,
      span: spanStep?.span,
      spanIndex: spanStep?.spanIndex ?? (phase === "prepare" ? 0 : videoSteps.length),
      spanCount: videoSteps.length,
      frames: this.frames,
      framesTotal: this.framesTotal,
      fps: this.fps(),
      realtime: this.realtime(),
      bytesWritten: this.bytes,
      elapsedMs: this.elapsedMs(),
      pausedMs: this.pausedMs + (this.pauseStart !== null ? this.now() - this.pauseStart : 0),
      etaMs,
      etaSource,
      totalEstimateMs,
      paused: this.paused,
      startedAt: this.startedAt,
      audioT: this.audioT,
      steps,
      currentStep: cur?.id ?? null,
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
/** "+12%" / "−8%" of actual against what was promised; far off, "4.2× longer" reads better than "+320%". */
export function fmtDelta(actualMs: number, promisedMs: number): string {
  if (promisedMs <= 0) return "";
  const ratio = actualMs / promisedMs;
  if (ratio >= 3) return `${ratio.toFixed(1)}× longer`;
  if (ratio > 0 && ratio <= 1 / 3) return `${(1 / ratio).toFixed(1)}× shorter`;
  const d = Math.round((ratio - 1) * 100);
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)}%`;
}
