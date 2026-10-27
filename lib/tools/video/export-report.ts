/**
 * The account of an export, written when it ends: the result, each step against its estimate, every event with
 * its clock time, what was skipped, the doctor's verdict, the settings and the machine. Plain Markdown, so it reads
 * in the result card, saves beside the file and pastes anywhere. Pure, so it is tested in Node.
 */

import { fmtBytes, fmtDelta, fmtDuration, fmtMs, type StepProgress } from "./progress";
import { fmtTime } from "./project";
import type { JoinInfo } from "./engine";
import type { SpaceWhere, JoinMode } from "./space";

export interface ReportResult {
  kind: "done" | "stopped" | "failed";
  name: string;
  folder: string | null;
  seconds: number;
  bytes: number;
  activeMs: number;
  pausedMs: number;
  estimatedMs: number;
  codec: string;
  width: number;
  height: number;
  bitrateMbps: number;
  audioKbps: number;
  parts: number;
  resumedFrom: number;
  joinMode?: JoinMode;
  skipped: { from: number; to: number; message: string }[];
  message?: string;
  keptAt?: number;
  keptParts?: number;
  space?: { where: SpaceWhere; need: number | null; mode?: JoinMode; consumed: number };
}

export interface ReportInput {
  version: string;
  /** When the export ended (ms since the epoch) and the browser, as `describeBrowser` puts it. */
  at: number;
  browser: string;
  result: ReportResult;
  /** The steps as they stood at the end, and the join when there was one. */
  steps: StepProgress[];
  join?: JoinInfo;
  events: { at: number; kind: string; text: string }[];
  /** The doctor's verdict: undefined while it is still looking, null when the check is off. */
  check?: { ok: boolean; summary: string; findings: string[] } | null;
  settings: {
    preset: string;
    codec: string;
    resolution: string;
    bitrateMbps: number;
    audioBitrateKbps: number;
    clips: number;
    titles: number;
    music: number;
    looks: string[];
    watermark: boolean;
    sound: string;
    tags: Record<string, string>;
    range: { from: number; to: number } | null;
  };
}

/** The report's file name beside the video. */
export const reportFileName = (name: string) => `${name.replace(/\.mp4$/i, "")}.report.md`;

/** "Chrome 142 on macOS", from a user-agent string. */
export function describeBrowser(ua: string): string {
  const edge = /Edg\/(\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const browser = edge ? `Edge ${edge[1]}` : chrome ? `Chrome ${chrome[1]}` : /Safari\//.test(ua) ? "Safari" : /Firefox\/(\d+)/.test(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : "a browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};
const dateTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${clock(ms)}`;
};
const label = (s: StepProgress) => (s.kind === "video" ? s.title : s.kind === "prepare" ? "Prepare" : s.kind === "audio" ? "Sound" : "Finish");

/** The pace in words: how the time taken compares with what was promised. */
export function paceText(activeMs: number, estimatedMs: number): string {
  if (estimatedMs <= 0 || activeMs <= 0) return "";
  const ratio = activeMs / estimatedMs;
  if (Math.abs(ratio - 1) < 0.05) return "as estimated";
  if (ratio > 1.5) return `${ratio.toFixed(1)}× the estimate`;
  if (ratio < 0.67) return `${(1 / ratio).toFixed(1)}× faster than estimated`;
  return ratio > 1 ? `${Math.round((ratio - 1) * 100)} % slower than estimated` : `${Math.round((1 - ratio) * 100)} % faster than estimated`;
}

export function exportReport(i: ReportInput): string {
  const r = i.result;
  const s = i.settings;
  const out: string[] = [];
  const outcome = r.kind === "done" ? "Exported" : r.kind === "stopped" ? "Stopped" : "Failed";
  out.push(`# Export report — ${r.name}`, "", `${outcome} · ${dateTime(i.at)} · Bench ${i.version} · ${i.browser}`, "");

  out.push("## Result");
  if (r.kind === "done") out.push(`- Exported ${r.name}${r.folder ? ` to the folder “${r.folder}”` : ""}: ${fmtBytes(r.bytes)}, ${fmtTime(r.seconds)} of video.`);
  else {
    const at = r.keptAt ? ` at ${fmtTime(r.keptAt)} of ${fmtTime(r.seconds)}` : "";
    out.push(`- ${outcome}${at}${r.message ? `: ${r.message}` : "."}`);
    if (r.keptParts) out.push(`- ${r.keptParts} finished part${r.keptParts === 1 ? "" : "s"} kept in the folder; Resume carries on from ${fmtTime(r.keptAt ?? 0)}.`);
    if (r.space) out.push(`- The drive refused a write ${r.space.where === "join" ? "while the parts were being joined" : r.space.where === "part" ? "while a part was being written" : "while the file was being written"}${r.space.need !== null ? `; that step wants about ${fmtBytes(r.space.need)} free on the drive holding the project folder` : ""}.${r.space.consumed ? ` ${r.space.consumed} part${r.space.consumed === 1 ? " was" : "s were"} already in the unfinished file and will be exported again.` : ""}`);
  }
  out.push(`- ${r.codec} ${r.width}×${r.height} at ${r.bitrateMbps} Mbps, AAC ${r.audioKbps} kbps.`);
  const pace = paceText(r.activeMs, r.estimatedMs);
  const realtime = r.activeMs > 0 ? r.seconds / (r.activeMs / 1000) : 0;
  out.push(`- Took ${fmtDuration(r.activeMs)} working${r.pausedMs > 500 ? ` plus ${fmtDuration(r.pausedMs)} paused` : ""}${realtime > 0 ? ` — ${realtime.toFixed(2)}× realtime` : ""}${pace ? `; the estimate said ${fmtDuration(r.estimatedMs)} (${pace})` : ""}.`);
  if (r.parts > 0) out.push(`- Written in ${r.parts} part${r.parts === 1 ? "" : "s"}${r.kind === "done" ? `, joined into the file at the end${r.joinMode === "remove" ? ", each removed as it went in" : r.joinMode === "keep" ? ", kept beside it until it was finished" : ""}` : ""}${r.resumedFrom ? `; resumed from ${fmtTime(r.resumedFrom)}` : ""}.`);
  if (i.join) out.push(`- Join: ${i.join.parts} parts, ${fmtBytes(i.join.bytes)} (largest ${fmtBytes(i.join.largest)}), needing about ${fmtBytes(i.join.need)} free on the drive${i.join.done ? "; finished" : i.join.at ? `; stopped at part ${i.join.at}` : ""}.`);
  if (r.skipped.length) out.push(`- ${r.skipped.length} stretch${r.skipped.length === 1 ? "" : "es"} skipped after frames failed (${r.skipped.reduce((a, k) => a + (k.to - k.from), 0).toFixed(2)} s in all).`);
  if (i.check === undefined) out.push("- Check: the doctor had not finished when this report was written.");
  else if (i.check === null) out.push("- Check: off.");
  else out.push(`- Check: ${i.check.ok ? "passed" : "findings"} — ${i.check.summary}${i.check.findings.length ? ` (${i.check.findings.join("; ")})` : ""}.`);
  out.push("");

  if (i.steps.length) {
    out.push("## Steps", "", "| Step | Status | Took | Expected | Note |", "|---|---|---|---|---|");
    for (const st of i.steps) {
      const took = st.status === "done" ? fmtDuration(st.elapsedMs) : st.status === "running" ? `${fmtDuration(st.elapsedMs)} so far` : "—";
      const expected = st.promisedMs != null && st.promisedMs > 0 ? `${fmtDuration(st.promisedMs)}${st.status === "done" ? ` (${fmtDelta(st.elapsedMs, st.promisedMs)})` : ""}` : st.status === "pending" ? `≈ ${fmtDuration(st.estimateMs)}` : "—";
      const note = st.kind === "video" && st.span ? `${fmtMs(st.span.start)} → ${fmtMs(st.span.end)}, ${st.span.kind === "copy" ? "copied" : "rendered"}` : st.kind === "audio" ? `${fmtMs(st.units)} mixed` : st.stage ?? "";
      out.push(`| ${label(st)} | ${st.status} | ${took} | ${expected} | ${note} |`);
    }
    out.push("");
  }

  if (r.skipped.length) {
    out.push("## Skipped stretches", "");
    for (const k of r.skipped) out.push(`- ${fmtTime(k.from)} → ${fmtTime(k.to)} (${(k.to - k.from).toFixed(2)} s): ${k.message}`);
    out.push("");
  }

  if (i.events.length) {
    out.push("## Events", "");
    for (const e of i.events) out.push(`- ${clock(e.at)} — ${e.text}`);
    out.push("");
  }

  out.push("## Settings", "");
  out.push(`- Preset ${s.preset}: ${s.codec.toUpperCase()}, ${s.resolution === "source" ? "source resolution" : `${s.resolution}p`}, ${s.bitrateMbps} Mbps video, ${s.audioBitrateKbps} kbps audio.`);
  out.push(`- Timeline: ${s.clips} clip${s.clips === 1 ? "" : "s"}, ${s.titles} title${s.titles === 1 ? "" : "s"}, ${s.music} music track${s.music === 1 ? "" : "s"}${s.watermark ? ", a watermark" : ""}; sound mode ${s.sound}.${s.range ? ` Range ${fmtTime(s.range.from)} → ${fmtTime(s.range.to)}.` : ""}`);
  if (s.looks.length) out.push(`- Looks: ${s.looks.join(", ")}.`);
  const tags = Object.entries(s.tags).filter(([, v]) => v && v.trim());
  if (tags.length) out.push(`- Tags: ${tags.map(([k, v]) => `${k} “${v}”`).join(", ")}.`);
  out.push("");
  return out.join("\n");
}
