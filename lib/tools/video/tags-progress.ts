/**
 * Progress and estimates for saving tags into a large file.
 *
 * Saving into a file in Chrome means writing a fresh copy of the whole file (the browser works in a
 * swap file; measured, writing the copy ourselves in chunks is both faster than its own
 * keepExistingData copy and the only way to see progress), then the browser's close, which reads
 * every byte back for a Safe Browsing check before moving the copy into place, then a quick read of
 * the result to confirm the tags. Three stages, two of them sized by the file, one of them opaque.
 *
 * Pure: time comes in as a number so tests can drive the clock.
 */
import { fmtBytes } from "./progress";

export type SaveStageId = "copy" | "close" | "verify";
export type SaveSource = "default" | "learned" | "measured" | "actual";

/** Rates to estimate from: learned on this machine, or the defaults. */
export interface SaveRates {
  copyBytesPerS?: number;
  closeBytesPerS?: number;
  verifyMs?: number;
  /** Where the copy and verify figures came from ("your last save (12/10/2026)"). */
  label?: string;
  /** Where the close rate came from ("an earlier export (12/10/2026)"): it is shared with the video editor. */
  closeLabel?: string;
}

export const DEFAULT_RATES: Required<Pick<SaveRates, "copyBytesPerS" | "closeBytesPerS" | "verifyMs">> = { copyBytesPerS: 400e6, closeBytesPerS: 400e6, verifyMs: 300 };

/** Copies are written in pieces this big so progress ticks several times a second even on a fast disk. */
export const COPY_CHUNK = 64 * 1024 * 1024;

export interface SaveStage {
  id: SaveStageId;
  title: string;
  /** What is happening, in words, while it runs. */
  detail: string;
  status: "pending" | "running" | "done";
  /** Bytes done and total for the stage with inner progress (copy); 0/0 for the opaque ones. */
  done: number;
  total: number;
  elapsedMs: number;
  estimateMs: number;
  remainingMs: number;
  source: SaveSource;
  basis: string;
}

export interface SaveProgress {
  stages: SaveStage[];
  current: SaveStageId | null;
  /** 0..1 of the whole save, by time: elapsed against elapsed plus what remains. */
  fraction: number;
  elapsedMs: number;
  remainingMs: number;
  /** Epoch ms when it should be finished. */
  etaAt: number;
  /** Bytes written so far and in total (the copy stage). */
  bytesDone: number;
  bytesTotal: number;
  /** Current copy throughput in bytes/s, once measurable. */
  throughput: number | null;
  done: boolean;
}

function describe(source: SaveSource, label: string | undefined): string {
  if (source === "learned") return label ? `learned from ${label}` : "learned from an earlier save";
  if (source === "measured") return "measured as it runs";
  if (source === "actual") return "actual time";
  return "default guess";
}

/** Time left in a stage with no inner progress: what is left of the guess, and once past it a quarter of the time spent so far, so the promise keeps moving instead of sticking at zero. */
export function overrun(guessMs: number, elapsedMs: number): number {
  return Math.max(guessMs - elapsedMs, 0.25 * Math.max(guessMs, elapsedMs));
}

interface StageState {
  startedAt: number | null;
  endedAt: number | null;
}

export class SaveTracker {
  private readonly state: Record<SaveStageId, StageState> = { copy: { startedAt: null, endedAt: null }, close: { startedAt: null, endedAt: null }, verify: { startedAt: null, endedAt: null } };
  private copied = 0;
  private readonly startedAt: number;
  /** Bytes of the new file (all of it is written). */
  private readonly bytes: number;
  private readonly rates: SaveRates;
  private readonly defaults: typeof DEFAULT_RATES;

  constructor(now: number, bytes: number, rates: SaveRates = {}, defaults = DEFAULT_RATES) {
    this.startedAt = now;
    this.bytes = bytes;
    this.rates = rates;
    this.defaults = defaults;
  }

  begin(id: SaveStageId, now: number) {
    const s = this.state[id];
    if (s.startedAt === null) s.startedAt = now;
  }

  /** The copy stage wrote this many more bytes. */
  advance(bytes: number) {
    this.copied += bytes;
  }

  end(id: SaveStageId, now: number) {
    const s = this.state[id];
    if (s.startedAt === null) s.startedAt = now;
    if (s.endedAt === null) s.endedAt = now;
    if (id === "copy") this.copied = this.bytes;
  }

  private elapsed(id: SaveStageId, now: number): number {
    const s = this.state[id];
    if (s.startedAt === null) return 0;
    return (s.endedAt ?? now) - s.startedAt;
  }

  private status(id: SaveStageId): SaveStage["status"] {
    const s = this.state[id];
    return s.endedAt !== null ? "done" : s.startedAt !== null ? "running" : "pending";
  }

  /** The copy rate to plan with: measured once enough has been written, else learned, else the default. */
  private copyRate(now: number): { rate: number; source: SaveSource } {
    const elapsed = this.elapsed("copy", now);
    if (this.status("copy") === "running" && elapsed >= 1000 && this.copied >= 16e6) return { rate: this.copied / (elapsed / 1000), source: "measured" };
    if (this.rates.copyBytesPerS) return { rate: this.rates.copyBytesPerS, source: "learned" };
    return { rate: this.defaults.copyBytesPerS, source: "default" };
  }

  private stage(id: SaveStageId, now: number): SaveStage {
    const status = this.status(id);
    const elapsed = this.elapsed(id, now);
    const late = " · past the guess, still going";
    if (id === "copy") {
      const { rate, source } = this.copyRate(now);
      const remaining = status === "done" ? 0 : ((this.bytes - this.copied) / Math.max(1, rate)) * 1000;
      const basis = status === "done" ? `actual time: ${fmtBytes(this.bytes / Math.max(0.001, elapsed / 1000))}/s` : `${fmtBytes(this.bytes)} at ${fmtBytes(rate)}/s (${describe(source, this.rates.label)})`;
      return {
        id,
        title: "Write a fresh copy of the file",
        detail: status === "running" ? `writing ${fmtBytes(this.copied)} of ${fmtBytes(this.bytes)}: the video and audio are copied around the new index` : "the browser cannot change a file in place: the whole file is written again with the new index in it",
        status,
        done: this.copied,
        total: this.bytes,
        elapsedMs: elapsed,
        estimateMs: elapsed + remaining,
        remainingMs: remaining,
        source: status === "done" ? "actual" : source,
        basis,
      };
    }
    if (id === "close") {
      const learned = this.rates.closeBytesPerS;
      const rate = Math.max(1, learned ?? this.defaults.closeBytesPerS);
      const guess = (this.bytes / rate) * 1000;
      const remaining = status === "done" ? 0 : status === "running" ? overrun(guess, elapsed) : guess;
      const source: SaveSource = status === "done" ? "actual" : learned !== undefined ? "learned" : "default";
      const basis = status === "done" ? `actual time: ${fmtBytes(this.bytes / Math.max(0.001, elapsed / 1000))}/s` : `${fmtBytes(this.bytes)} at ${fmtBytes(rate)}/s (${describe(source, this.rates.closeLabel)})${status === "running" && elapsed > guess ? late : ""}`;
      return {
        id,
        title: "Close the file",
        detail: `Chrome reads all ${fmtBytes(this.bytes)} back to check it, then moves the copy into place; nothing reports progress during this`,
        status,
        done: 0,
        total: 0,
        elapsedMs: elapsed,
        estimateMs: elapsed + remaining,
        remainingMs: remaining,
        source,
        basis,
      };
    }
    const learned = this.rates.verifyMs;
    const guess = learned ?? this.defaults.verifyMs;
    const remaining = status === "done" ? 0 : status === "running" ? overrun(guess, elapsed) : guess;
    const source: SaveSource = status === "done" ? "actual" : learned !== undefined ? "learned" : "default";
    return {
      id,
      title: "Read the tags back",
      detail: "the saved file's index is read again to confirm the tags are in it",
      status,
      done: 0,
      total: 0,
      elapsedMs: elapsed,
      estimateMs: elapsed + remaining,
      remainingMs: remaining,
      source,
      basis: status === "done" ? "actual time" : describe(source, this.rates.label) + (status === "running" && elapsed > guess ? late : ""),
    };
  }

  snapshot(now: number): SaveProgress {
    const stages = (["copy", "close", "verify"] as SaveStageId[]).map((id) => this.stage(id, now));
    const current = stages.find((s) => s.status === "running")?.id ?? null;
    const remainingMs = stages.reduce((a, s) => a + s.remainingMs, 0);
    const elapsedMs = now - this.startedAt;
    const done = stages.every((s) => s.status === "done");
    const copy = stages[0];
    const throughput = copy.status === "running" && copy.elapsedMs >= 200 && copy.done >= 32e6 ? copy.done / (copy.elapsedMs / 1000) : null;
    return {
      stages,
      current,
      fraction: done ? 1 : elapsedMs + remainingMs > 0 ? elapsedMs / (elapsedMs + remainingMs) : 0,
      elapsedMs,
      remainingMs: done ? 0 : remainingMs,
      etaAt: now + (done ? 0 : remainingMs),
      bytesDone: this.copied,
      bytesTotal: this.bytes,
      throughput,
      done,
    };
  }

  /** What this save measured, for next time: only figures big enough to mean something. The close rate is skipped when the close was instant (private storage), so it never poisons the shared figure. */
  measured(now: number): SaveRates {
    const out: SaveRates = {};
    const copyMs = this.elapsed("copy", now);
    if (this.status("copy") === "done" && copyMs >= 100 && this.bytes >= 8e6) out.copyBytesPerS = this.bytes / (copyMs / 1000);
    const closeMs = this.elapsed("close", now);
    if (this.status("close") === "done" && closeMs >= 100 && this.bytes >= 8e6) out.closeBytesPerS = this.bytes / (closeMs / 1000);
    const verifyMs = this.elapsed("verify", now);
    if (this.status("verify") === "done" && verifyMs > 0) out.verifyMs = verifyMs;
    return out;
  }
}

/** The up-front promise for the Save panel, before anything runs. */
export function estimateSave(bytes: number, rates: SaveRates = {}, defaults = DEFAULT_RATES): { totalMs: number; copyMs: number; closeMs: number; copyRate: number; closeRate: number; source: SaveSource } {
  const copyRate = rates.copyBytesPerS ?? defaults.copyBytesPerS;
  const closeRate = rates.closeBytesPerS ?? defaults.closeBytesPerS;
  const copyMs = (bytes / copyRate) * 1000;
  const closeMs = (bytes / closeRate) * 1000;
  const totalMs = copyMs + closeMs + (rates.verifyMs ?? defaults.verifyMs);
  // as good as its bigger half
  const source: SaveSource = (copyMs >= closeMs ? rates.copyBytesPerS : rates.closeBytesPerS) !== undefined ? "learned" : "default";
  return { totalMs, copyMs, closeMs, copyRate, closeRate, source };
}

/** Rough wall time in words: "about 4 min", "about 12 s", "about 1 h 20 min". */
export function fmtRough(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 1) return "under a second";
  if (s < 60) return `about ${Math.ceil(s)} s`;
  const m = s / 60;
  if (m < 60) return `about ${Math.ceil(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m - h * 60);
  return r ? `about ${h} h ${r} min` : `about ${h} h`;
}
