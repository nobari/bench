/**
 * Stops: stretches where the car stood still — a red light, a queue, a level crossing — found from how little the
 * picture changes between small frames, listed per recording in source seconds, and cut out of the timeline with a
 * margin so each one still shows the car halting and pulling away.
 */
import { clipSpeed, placeClips, removeRange, type Clip } from "./project";

/** Mean absolute luma change between consecutive samples, 0–1, one score per `step` seconds. */
export interface MotionTrace {
  step: number;
  scores: number[];
}

/** A still stretch in a recording's own seconds. */
export interface Still {
  from: number;
  to: number;
}

/** The scan kept on the project: runs per media id, so the minimum can change without scanning again. */
export interface StopScan {
  step: number;
  runs: Record<string, Still[]>;
  thresholds: Record<string, number>;
  /** Stops shorter than this many seconds are ignored. */
  minSeconds: number;
  /** Footage kept at each end of a stop, seconds. */
  margin: number;
  scannedAt: number;
}

export const DEFAULT_STOPS = { minSeconds: 2, margin: 0.5, step: 0.25 };
/** Runs this short are recorded so the minimum can be lowered later without a new scan. */
export const RUN_MIN = 1;

/** Below this much change the picture counts as still; set from the recording itself so night footage or a dull road still works. */
export function stillThreshold(scores: number[]): number {
  if (!scores.length) return 0.006;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.min(0.012, Math.max(0.004, 0.35 * median));
}

/** Runs of at least `minSeconds` where the smoothed score stays under the threshold. */
export function stillRuns(trace: MotionTrace, threshold: number, minSeconds = RUN_MIN): Still[] {
  const { step, scores } = trace;
  const n = scores.length;
  if (!n) return [];
  // A median of three hides a single car crossing the frame while stopped, and a single dropped frame while driving.
  const smooth = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = scores[Math.max(0, i - 1)], b = scores[i], c = scores[Math.min(n - 1, i + 1)];
    smooth[i] = a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
  }
  const runs: Still[] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const still = i < n && smooth[i] < threshold;
    if (still && start < 0) start = i;
    if (!still && start >= 0) {
      const from = start * step, to = i * step;
      if (to - from >= minSeconds - 1e-9) runs.push({ from, to });
      start = -1;
    }
  }
  return runs;
}

/** A stop as it sits on the timeline: the still stretch, and the part of it to cut once the margins are kept. */
export interface TimelineStop {
  clipId: string;
  /** The still stretch, timeline seconds. */
  stillFrom: number;
  stillTo: number;
  /** Real seconds the car stood still (the recording's own time). */
  seconds: number;
  /** What a cut removes, timeline seconds. */
  from: number;
  to: number;
}

export function stopKey(s: TimelineStop): string {
  return `${s.clipId}:${s.stillFrom.toFixed(2)}`;
}

/** The scan's stops as they fall on the current clips: intro scenes are skipped, trims respected, speeds honoured. */
export function stopsOnTimeline(clips: Clip[], scan: StopScan): TimelineStop[] {
  const out: TimelineStop[] = [];
  for (const c of placeClips(clips)) {
    if (c.introRole) continue;
    const runs = scan.runs[c.media];
    if (!runs?.length) continue;
    const speed = clipSpeed(c);
    for (const r of runs) {
      const a = Math.max(r.from, c.in), b = Math.min(r.to, c.out);
      if (b - a < scan.minSeconds - 1e-9) continue;
      const stillFrom = c.start + (a - c.in) / speed, stillTo = c.start + (b - c.in) / speed;
      const from = stillFrom + scan.margin / speed, to = stillTo - scan.margin / speed;
      if (to - from < 0.1) continue;
      out.push({ clipId: c.id, stillFrom, stillTo, seconds: b - a, from, to });
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** Cut the stops out, last first so earlier times stay valid. */
export function cutOutStops(clips: Clip[], stops: TimelineStop[]): Clip[] {
  let out = clips;
  for (const s of [...stops].sort((a, b) => b.from - a.from)) out = removeRange(out, s.from, s.to);
  return out;
}

export function stopsTotal(stops: TimelineStop[]): number {
  return stops.reduce((a, s) => a + (s.to - s.from), 0);
}
