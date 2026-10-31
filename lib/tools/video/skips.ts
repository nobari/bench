import type { ExportSpan } from "./project";

/** A stretch of the export's time left out after a frame failed (export time: seconds from the export's start). */
export interface SkippedStretch {
  from: number;
  to: number;
  message: string;
}

/** The stretches in order, touching or overlapping ones merged (a fault answered twice at one place recorded it twice). */
export function mergeSkips(list: SkippedStretch[]): SkippedStretch[] {
  const sorted = list.filter((k) => k.to > k.from + 1e-9).sort((a, b) => a.from - b.from);
  const out: SkippedStretch[] = [];
  for (const k of sorted) {
    const last = out[out.length - 1];
    if (last && k.from <= last.to + 1e-6) {
      if (k.to > last.to) last.to = k.to;
    } else out.push({ ...k });
  }
  return out;
}

/** The spans split at timeline time `t`: the one covering it becomes two, its source range cut to match. */
export function cutAt(spans: ExportSpan[], t: number): ExportSpan[] {
  return spans.flatMap((s) => {
    if (t <= s.start + 1e-6 || t >= s.end - 1e-6) return [s];
    const speed = s.speed || 1;
    const sourceT = s.sourceIn + (t - s.start) * speed;
    return [
      { ...s, end: t, sourceOut: sourceT },
      { ...s, start: t, sourceIn: sourceT },
    ];
  });
}

/**
 * The span minus the skipped stretches (given in export time, `offset` seconds before the timeline's): the pieces
 * left to decode, in order. A piece that begins where a skip ends starts at the footage's next keyframe when the
 * skip was sized to one, so the packets that failed are never handed to a decoder again.
 */
export function cutBySkips(span: ExportSpan, skips: { from: number; to: number }[], offset: number): ExportSpan[] {
  let pieces = [span];
  for (const k of skips) {
    const from = k.from + offset, to = k.to + offset;
    pieces = pieces.flatMap((s) => {
      if (to <= s.start + 1e-6 || from >= s.end - 1e-6) return [s];
      const speed = s.speed || 1;
      const out: ExportSpan[] = [];
      if (from > s.start + 1e-6) out.push({ ...s, end: from, sourceOut: s.sourceIn + (from - s.start) * speed });
      if (to < s.end - 1e-6) out.push({ ...s, start: to, sourceIn: s.sourceIn + (to - s.start) * speed });
      return out;
    });
  }
  return pieces;
}
