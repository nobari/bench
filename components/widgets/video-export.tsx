"use client";

/**
 * The Video Editor's export views: the summary and pre-flight before an export, the run view while it works, the
 * result card when it is done, and the Files list of what the project folder holds. State lives in the editor; these
 * components render it and hand actions back.
 */

import { useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Copy, Download, Eye, FileText, FlaskConical, FolderOpen, Gauge, Info, Loader, Pause, Play, RotateCcw, Save, Square, Trash2, X, XCircle } from "lucide-react";
import { roomAdvice, type JoinMode, type SpaceWhere } from "@/lib/tools/video/space";
import { reportFileName } from "@/lib/tools/video/export-report";
import { cn } from "@/lib/utils";
import { GHOST, PRIMARY, SEL } from "./video-styles";
import { fmtBytes, fmtDelta, fmtDuration, fmtMs, type EstimateSource, type ExportProgress, type StepProgress } from "@/lib/tools/video/progress";
import { fmtTime, type ExportEstimate } from "@/lib/tools/video/project";
import { EXPORT_PRESETS } from "@/lib/tools/video/export-presets";
import type { PreflightItem, PreflightState } from "@/lib/tools/video/preflight";
import { DoctorReportView } from "./video-doctor-report";

/** "2160p" for a landscape picture; a vertical or square frame is named in full, "1080×1920". */
const pictureText = (width: number, height: number) => (width > height ? `${height}p` : `${width}×${height}`);
import type { DoctorDepth, DoctorProgress, DoctorReport, Finding, FixKind } from "@/lib/tools/video/doctor";
import { allTicked, tickedCount, type Review, type ReviewState } from "@/lib/tools/video/review";
import type { ExportEvent, ExportFault, JoinInfo } from "@/lib/tools/video/engine";
import type { Loudness } from "@/lib/tools/video/loudness";
import { YOUTUBE_LUFS } from "@/lib/tools/video/loudness";

/* ------------------------------------------------------------------ shared types */

/** What the run view needs to know about the export job. The editor's job type carries these fields. */
export interface ExportJobView {
  label: string;
  progress?: ExportProgress;
  output?: { name: string; codec: string; width: number; height: number; bitrateMbps: number; preset: string; estimatedBytes: number };
  paused?: boolean;
  fault?: { fault: ExportFault; resolve: (answer: "skip" | "stop", all?: boolean) => void };
  partsMode?: boolean;
  resumedFrom?: number;
  join?: JoinInfo;
}

/** A line in the run's log: the engine's events plus the editor's own (started, paused, resumed, waiting). */
export interface RunEvent {
  at: number;
  kind: ExportEvent["kind"] | "start" | "pause" | "resume" | "space" | "fault";
  text: string;
}

export interface Skip {
  from: number;
  to: number;
}

/** How an export ended, for the result card. */
export interface DoneResult {
  kind: "done" | "stopped" | "failed";
  at: number;
  name: string;
  folder: string | null;
  /** Length of the export (timeline seconds) and what was written. */
  seconds: number;
  bytes: number;
  activeMs: number;
  pausedMs: number;
  /** What the plan promised, to compare with activeMs. */
  estimatedMs: number;
  codec: string;
  width: number;
  height: number;
  bitrateMbps: number;
  audioKbps: number;
  parts: number;
  resumedFrom: number;
  joinMode?: JoinInfo["mode"];
  /** Seconds of picture copied from the recordings as they are, and how many codec configurations the picture carries. */
  copiedSeconds?: number;
  descriptions?: number;
  skipped: { from: number; to: number; message: string }[];
  /** Stopped or failed: why, and what is kept. */
  message?: string;
  keptAt?: number;
  keptParts?: number;
  /** Stopped because the drive refused a write: where, the room that step wants, the join's mode and the parts already consumed. */
  space?: { where: SpaceWhere; need: number | null; mode?: JoinMode; consumed: number };
  /** For the report: the steps and the log as they stood at the end, and the join when there was one. */
  steps?: StepProgress[];
  events?: RunEvent[];
  join?: JoinInfo;
  /** The doctor's report on the written file (done exports only); null when the check is off. */
  report?: DoctorReport | null;
  /** While the doctor runs: its stage and fraction. */
  checking?: DoctorProgress | null;
  checkError?: string;
  repaired?: string[];
}

export interface FileEntry {
  name: string;
  size: number;
  lastModified: number;
  kind: "export" | "preview" | "fixed" | "other" | "unfinished";
  report?: DoctorReport | null;
  checking?: DoctorProgress | null;
  error?: string;
  repaired?: string[];
}

export interface FixState {
  name: string;
  loudness: Loudness;
  target: number;
  gain: number;
  setTarget: (t: number) => void;
  run: () => void;
  done: { name: string; bytes: number; gainDb: number } | null;
}

export interface ResumableView {
  name: string;
  parts: number;
  bytes: number;
  endAt: number;
  total: number;
  matches: boolean;
  folder: string;
  /** Parts already joined into a file that did not finish, and the seconds they covered (exported again on resume). */
  consumedParts: number;
  consumedSeconds: number;
  skipped: number;
}

const describeLoud = (r: Loudness) => (r.integrated === null ? "silent" : `${r.integrated.toFixed(1)} LUFS · peaks ${r.peakDb.toFixed(1)} dBFS`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ------------------------------------------------------------------ set-up */

export function ExportSummary({ name, auto, onName, folder, onPickFolder, lines, estimate, basis, blockers, busy, hasClips, onExport, onTest, testLine }: { name: string; auto: boolean; onName: (n: string | null) => void; folder: string | null; onPickFolder: () => void; lines: string[]; estimate: ExportEstimate; basis: string; blockers: string[]; busy: boolean; hasClips: boolean; onExport: () => void; onTest: () => void; testLine: string }) {
  return (
    <div className="panel space-y-2 p-3" data-export-summary>
      <div className="flex min-w-0 items-center gap-2">
        <Download size={15} className="shrink-0 text-accent" />
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          onBlur={(e) => {
            if (!e.target.value.trim()) onName(null);
          }}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent font-mono text-[14px] font-medium text-ink outline-none focus:border-accent"
          aria-label="File name"
          title="The file's name; click to change it (.mp4 is added)"
          data-export-name
        />
        {!auto && (
          <button type="button" onClick={() => onName(null)} className="shrink-0 text-[11.5px] text-faint hover:text-ink" title="Back to the name made from the project and the resolution" data-export-name-reset>
            reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1">
          <FolderOpen size={12} />
          {folder ? (
            <>
              into <span className="text-ink">{folder}</span>
            </>
          ) : (
            <button type="button" onClick={onPickFolder} className="text-accent hover:underline" data-export-pick-folder>
              pick a project folder
            </button>
          )}
        </span>
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted" data-export-estimate>
        <span>
          About <span className="font-mono text-ink">{fmtBytes(estimate.bytes)}</span>
        </span>
        <span>
          roughly <span className="font-mono text-ink">{fmtDuration(estimate.wallSeconds * 1000)}</span>
        </span>
        <span className="text-faint">{basis}</span>
        {estimate.copySeconds > 0 && <span className="text-faint">{fmtTime(estimate.copySeconds)} copied as is, no re-encoding</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onExport} disabled={busy || !hasClips || blockers.length > 0} className={cn(PRIMARY, "h-10 flex-1 justify-center px-5")} title={blockers[0] ?? "Write the file into the project folder"} data-export-run>
          <Download size={15} /> Export
        </button>
        <button type="button" onClick={onTest} disabled={busy || !hasClips} className={cn(GHOST, "h-10 text-[12.5px]")} title={`Run the real export, small and short — ${testLine} — and play it in the preview`} data-export-test>
          <FlaskConical size={13} /> Test render
        </button>
      </div>
      {blockers.length > 0 && (
        <p className="text-[12px] text-danger" data-export-blocked>
          Not yet: {blockers.join(" · ")}
        </p>
      )}
    </div>
  );
}

export function PresetsRow({ current, onPick }: { current: string | null; onPick: (id: string) => void }) {
  const chosen = EXPORT_PRESETS.find((p) => p.id === current);
  return (
    <div className="space-y-1" data-presets>
      <div className="flex flex-wrap items-center gap-1.5">
        {EXPORT_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} aria-pressed={current === p.id} title={p.blurb} className={cn(GHOST, "h-7 px-2.5 text-[12px]", current === p.id && "border-accent bg-accent-soft text-ink")} data-preset={p.id}>
            {p.name}
          </button>
        ))}
        <span className={cn("inline-flex h-7 items-center rounded-[var(--radius-sm)] px-2 text-[12px]", current ? "text-faint" : "border border-dashed border-edge text-ink")} data-preset-custom={current ? "false" : "true"}>
          {current ? "" : "Custom"}
        </span>
      </div>
      <p className="text-[12px] text-faint">{chosen ? chosen.blurb : "Your own combination of codec, size, bitrate and sound — pick a preset to go back to a known-good one."}</p>
    </div>
  );
}

const STATE_ICON: Record<PreflightState, typeof Check> = { ok: Check, warn: AlertTriangle, block: XCircle, info: Info };
const STATE_COLOR: Record<PreflightState, string> = { ok: "text-positive", warn: "text-warn", block: "text-danger", info: "text-faint" };

export function Preflight({ items, onAction }: { items: PreflightItem[]; onAction: (id: string) => void }) {
  const blocks = items.filter((i) => i.state === "block").length;
  const warns = items.filter((i) => i.state === "warn").length;
  const summary = blocks ? `${blocks} thing${blocks === 1 ? "" : "s"} to fix first` : warns ? `${warns} worth a look` : "all clear";
  return (
    <div className="rounded-[var(--radius-sm)] border border-edge" data-preflight data-blocks={blocks} data-warns={warns}>
      <div className="flex items-center gap-2 border-b border-edge px-2.5 py-1.5 text-[12px] text-muted">
        <span className="font-medium text-ink">Before you export</span>
        <span data-preflight-summary>{summary}</span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((i) => {
          const Icon = STATE_ICON[i.state];
          return (
            <li key={i.id} className="flex flex-wrap items-start gap-2 px-2.5 py-1.5 text-[12.5px]" data-preflight-item={i.id} data-state={i.state} {...(i.id === "parts" ? { "data-resumable": "" } : {})}>
              <Icon size={14} className={cn("mt-0.5 shrink-0", STATE_COLOR[i.state])} aria-label={i.state} />
              <div className="min-w-0 flex-1">
                <div className={cn(i.state === "ok" ? "text-muted" : "text-ink", i.state === "block" && "font-medium")}>{i.title}</div>
                {i.detail && <div className="text-[12px] text-faint">{i.detail}</div>}
              </div>
              {i.actions?.map((a) => (
                <button key={a.id} type="button" onClick={() => onAction(a.id)} className={cn(GHOST, "h-7 px-2 text-[12px]", i.state === "block" && "border-accent text-accent")} data-preflight-action={a.id} {...(a.hook ? { [`data-${a.hook}`]: "" } : {})}>
                  {a.label}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Section({ id, title, summary, open, onToggle, children, right, hook }: { id: string; title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode; right?: ReactNode; hook?: string }) {
  return (
    <section className="rounded-[var(--radius-sm)] border border-edge" data-section={id} data-open={open ? "true" : "false"} {...(hook ? { [`data-${hook}`]: "" } : {})}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]" data-section-toggle>
          {open ? <ChevronDown size={14} className="shrink-0 text-faint" /> : <ChevronRight size={14} className="shrink-0 text-faint" />}
          <span className="shrink-0 font-medium text-ink">{title}</span>
          {!open && (
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted" data-section-summary>
              {summary}
            </span>
          )}
        </button>
        {right}
      </div>
      {open && <div className="space-y-2 border-t border-edge p-2.5 text-[12.5px]">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ run view */

export const PHASE_LABEL: Record<ExportProgress["phase"], string> = { prepare: "Preparing", video: "Rendering video", audio: "Mixing the sound", finalize: "Finishing the file", done: "Done" };
const SOURCE_LABEL: Record<EstimateSource, string> = { default: "a default guess", learned: "your last export", measured: "measured now", actual: "actual" };
const GROUP_LABEL: Record<StepProgress["kind"], string> = { prepare: "Prepare", video: "Video", audio: "Sound", finalize: "Finish" };

function Stat({ label, value, title, hook }: { label: string; value: ReactNode; title?: string; hook?: string }) {
  return (
    <div className="min-w-0" title={title} {...(hook ? { [`data-${hook}`]: "" } : {})}>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="truncate font-mono text-[13.5px] tabular text-ink">{value}</div>
    </div>
  );
}

export function ExportRun({ job, events, skipped, liveRef, liveAt, onPause, onResume, onStop }: { job: ExportJobView; events: RunEvent[]; skipped: Skip[]; liveRef: RefObject<HTMLCanvasElement | null>; liveAt: number | null; onPause: () => void; onResume: () => void; onStop: () => void }) {
  const [details, setDetails] = useState(false);
  const [allEvents, setAllEvents] = useState(false);
  const p = job.progress;
  const out = job.output;
  const steps = p?.steps ?? [];
  const running = steps.find((s) => s.status === "running");
  const state: "running" | "paused" | "fault" = job.fault ? "fault" : job.paused ? "paused" : "running";
  const stateLabel = { running: "Running", paused: "Paused", fault: "A frame failed — waiting for you" }[state];
  const ladder = groupSteps(steps, job);
  const pct = Math.min(100, (p?.fraction ?? 0) * 100);
  const finishAt = p && p.etaMs > 0 ? clock(p.startedAt + p.elapsedMs + p.pausedMs + p.etaMs) : null;
  const phaseLine = !p ? "Starting…" : p.phase === "video" && p.span?.kind === "copy" ? "Copying video" : PHASE_LABEL[p.phase] + (running?.stage ? ` — ${running.stage}` : "");
  // Phase groups along the bar, sized by their estimated time; the fill is the tracker's weighted fraction on the same axis.
  const totalMs = steps.reduce((a, s) => a + s.estimateMs, 0);
  const groups = (["prepare", "video", "audio", "finalize"] as StepProgress["kind"][]).map((kind) => ({ kind, ms: steps.filter((s) => s.kind === kind).reduce((a, s) => a + s.estimateMs, 0) })).filter((g) => g.ms > 0);
  const total = p?.total ?? 0;
  return (
    <div className={cn("panel space-y-3 border-2 p-4", state === "running" ? "border-accent" : "border-warn")} data-export-panel data-run-state={state} aria-live="polite">
      {job.fault && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-warn/50 bg-warn/10 px-3 py-2 text-[13px]" role="alertdialog" aria-live="assertive" data-export-fault>
          <AlertTriangle size={15} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-ink">A frame failed at {fmtTime(job.fault.fault.timelineT)}</span> — {job.fault.fault.clipName} at {fmtTime(job.fault.fault.sourceT)} in the footage: {job.fault.fault.message}{" "}
            <span className="text-muted">Skip leaves out {job.fault.fault.stretch < 0.1 ? "that frame" : `${job.fault.fault.stretch.toFixed(2)} s, up to the footage's next keyframe`} and carries on; Stop keeps the finished parts to resume from.</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => job.fault!.resolve("skip")} className={cn(PRIMARY, "h-8")} data-fault-skip>
              Skip and continue
            </button>
            <button type="button" onClick={() => job.fault!.resolve("skip", true)} className={cn(GHOST, "h-8")} title="Skip this one and any other frame that fails, without asking again" data-fault-skip-all>
              Skip any that fail
            </button>
            <button type="button" onClick={() => job.fault!.resolve("stop")} className={cn(GHOST, "h-8 hover:border-danger hover:text-danger")} data-fault-stop>
              Stop, keep what is done
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {state === "running" ? <Loader size={18} className="animate-spin text-accent" /> : <Pause size={18} className="text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
            <span>
              {job.label} · {out?.name}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", state === "running" ? "border-accent/40 text-accent" : "border-warn/50 text-warn")} data-run-chip>
              {stateLabel}
            </span>
          </div>
          <div className="text-[12.5px] text-muted" data-run-phase>
            {phaseLine}
            {p?.span && p.phase === "video" ? ` · span ${p.spanIndex} of ${p.spanCount} · ${fmtMs(p.span.start)} → ${fmtMs(p.span.end)}` : ""}
            {job.resumedFrom ? ` · resumed from ${fmtTime(job.resumedFrom)}` : ""}
            {job.join ? (job.join.done ? ` · ${job.join.parts} parts joined` : ` · joining part ${Math.max(1, job.join.at)} of ${job.join.parts} (${fmtBytes(job.join.copied)} of ${fmtBytes(job.join.bytes)})${job.join.mode === "remove" ? ", each removed as it goes in" : ""}`) : ""}
          </div>
        </div>
        {job.paused ? (
          <button type="button" onClick={onResume} className={cn(PRIMARY, "h-9")} data-export-resume>
            <Play size={13} /> Resume
          </button>
        ) : (
          <button type="button" onClick={onPause} className={cn(GHOST, "h-9")} disabled={!p || p.phase === "prepare" || p.phase === "finalize" || p.phase === "done"} data-export-pause>
            <Pause size={13} /> Pause
          </button>
        )}
        <button type="button" onClick={onStop} className={cn(GHOST, "h-9 hover:border-danger hover:text-danger")} title={job.partsMode ? "Stop now; the finished parts are kept and the export can be resumed" : "Stop and discard"} data-export-stop>
          <Square size={12} /> Stop
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(200px,280px)_1fr]">
        <div className="space-y-1" data-export-live>
          <div className="relative aspect-video overflow-hidden rounded-[var(--radius-sm)] bg-black">
            <canvas ref={liveRef} className="h-full w-full object-contain" aria-label="The frame being encoded" />
            {liveAt === null && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-faint">{p?.phase === "video" ? "first frame…" : phaseLine}</div>}
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-faint">
            <span>the frame being encoded</span>
            <span className="font-mono tabular text-muted" data-live-time>
              {liveAt !== null ? fmtMs(liveAt) : "—"}
            </span>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-[34px] font-semibold leading-none tabular text-ink" data-export-pct>
              {pct.toFixed(1)}%
            </span>
            <span className="text-[14px] text-ink" data-run-eta>
              {p && p.etaMs > 0 ? `about ${fmtDuration(p.etaMs)} left` : "estimating…"}
              {finishAt ? <span className="text-muted"> · finishes around {finishAt}</span> : null}
            </span>
            <span className="text-[12.5px] text-muted" data-run-speed>
              {p && p.fps > 0 ? `${p.realtime.toFixed(2)}× realtime · ${p.fps.toFixed(1)} fps` : ""}
            </span>
          </div>
          <div className="space-y-1">
            <div className="relative h-3 overflow-hidden rounded-full bg-raised" title="Overall progress, weighted by each phase's estimated time; the marks are where one phase hands over to the next">
              <div className={cn("h-full transition-[width] duration-200", state === "running" ? "bg-accent" : "bg-warn")} style={{ width: `${pct}%` }} />
              {totalMs > 0 &&
                groups.slice(0, -1).map((g, i) => {
                  const at = groups.slice(0, i + 1).reduce((a, x) => a + x.ms, 0) / totalMs;
                  return <div key={g.kind} className="absolute top-0 h-full w-px bg-ink/40" style={{ left: `${(at * 100).toFixed(2)}%` }} />;
                })}
            </div>
            {totalMs > 0 && (
              <div className="flex text-[10.5px] uppercase tracking-wide text-faint" data-run-phases>
                {groups.map((g) => (
                  <span key={g.kind} className="truncate" style={{ width: `${((g.ms / totalMs) * 100).toFixed(2)}%` }}>
                    {g.ms / totalMs > 0.07 ? GROUP_LABEL[g.kind] : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          {p && total > 0 && (
            <div className="space-y-1" title="The export's own time: the video rendered so far, the sound mixed so far, and any stretch skipped">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-raised" data-run-range>
                <div className="absolute inset-y-0 left-0 bg-accent/80" style={{ width: `${Math.min(100, (p.timelineT / total) * 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-accent/35" style={{ width: `${Math.min(100, (p.audioT / total) * 100)}%` }} />
                {skipped.map((k) => (
                  <div key={k.from} className="absolute inset-y-0 bg-danger" style={{ left: `${((k.from / total) * 100).toFixed(2)}%`, width: `${Math.max(0.2, ((k.to - k.from) / total) * 100).toFixed(2)}%` }} title={`skipped ${fmtMs(k.from)} → ${fmtMs(k.to)}`} />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-faint">
                <span>video {fmtMs(p.timelineT)}</span>
                <span>sound {fmtMs(p.audioT)}</span>
                <span>{fmtMs(total)}</span>
              </div>
            </div>
          )}
          {ladder.length > 0 && (
            <div className="text-[12.5px] text-muted" data-run-steps data-steps-done={ladder.filter((g) => g.status === "done").length} data-steps-total={ladder.length}>
              {summaryLine(ladder)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Written" value={p ? `${fmtBytes(p.bytesWritten)}${out ? ` of ~${fmtBytes(out.estimatedBytes)}` : ""}` : "0 kB"} />
            <Stat label="Frames" value={p ? `${p.frames.toLocaleString()} / ${p.framesTotal.toLocaleString()}` : "—"} />
            <Stat label="Elapsed" value={p ? `${fmtDuration(p.elapsedMs)}${p.pausedMs > 500 ? ` +${fmtDuration(p.pausedMs)} paused` : ""}` : "0:00:00"} />
            <Stat label="Started" value={p ? clock(p.startedAt) : "—"} />
            <Stat label="Output" value={out ? `${out.codec} ${pictureText(out.width, out.height)} · ${out.bitrateMbps} Mbps` : "—"} />
            <Stat label="Estimate rests on" value={p ? SOURCE_LABEL[p.etaSource] : "—"} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} className="text-accent hover:underline" data-export-details>
          {details ? "Hide details" : "Details"}
        </button>
        {p && <span>estimates rest on {SOURCE_LABEL[p.etaSource]}</span>}
        {job.partsMode && !job.join && <span>written in parts: a stop keeps what is finished</span>}
        <span className="ml-auto">keep this tab open; the title shows the progress</span>
      </div>
      {details && p && (
        <div className="space-y-3" data-export-detail-panel>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Position" value={`${fmtMs(p.phase === "audio" ? p.audioT : p.timelineT)} / ${fmtMs(p.total)}`} />
            <Stat label="Remaining" value={`≈ ${fmtDuration(p.etaMs)}`} />
            <Stat label="Total expected" value={`≈ ${fmtDuration(p.totalEstimateMs)}`} title="Elapsed plus remaining, pauses excluded" />
            <Stat label="Finish at" value={finishAt ?? "—"} />
            <Stat label="Preset" value={out ? `${out.preset} · ${out.width}×${out.height}` : "—"} />
            <Stat label="Video · sound" value={`${Math.min(100, (p.timelineT / Math.max(1e-6, p.total)) * 100).toFixed(2)}% · ${Math.min(100, (p.audioT / Math.max(1e-6, p.total)) * 100).toFixed(2)}%`} />
          </div>
          <StepLadder groups={ladder} paused={!!job.paused} />
        </div>
      )}
      {events.length > 0 && (
        <ol className="space-y-0.5 text-[12px]" data-export-events>
          {(allEvents ? [...events].reverse() : [...events].reverse().slice(0, 4)).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-2">
              <span className="shrink-0 font-mono tabular text-faint">{clock(e.at)}</span>
              <span className={cn(e.kind === "skip" || e.kind === "space" || e.kind === "fault" ? "text-warn" : "text-muted")}>{e.text}</span>
            </li>
          ))}
          {events.length > 4 && (
            <li>
              <button type="button" onClick={() => setAllEvents((v) => !v)} className="text-accent hover:underline">
                {allEvents ? "Fewer" : `All ${events.length} events`}
              </button>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

/** One export step: what it does, how far it is, what it was expected to take and what it actually took. */
/* ------------------------------------------------------------------ the steps, folded */

type GroupId = "prepare" | "video" | "audio" | "join" | "finalize";
interface StepGroup {
  id: GroupId;
  title: string;
  status: StepStatus;
  /** One line: what was done, what is happening, or what is expected. */
  fact: string;
  /** The running stage, when the step has one. */
  stage?: string;
  steps: StepProgress[];
  join?: JoinInfo;
}
type StepStatus = StepProgress["status"];
const GROUP_TITLE: Record<GroupId, string> = { prepare: "Prepare", video: "Video", audio: "Sound", join: "Join parts", finalize: "Finish" };

const groupStatus = (steps: StepProgress[]): StepStatus => (steps.length && steps.every((s) => s.status === "done") ? "done" : steps.some((s) => s.status === "running") || (steps.some((s) => s.status === "done") && steps.some((s) => s.status === "pending")) ? "running" : "pending");
const sum = (steps: StepProgress[], f: (s: StepProgress) => number) => steps.reduce((a, s) => a + f(s), 0);
const expectedNote = (steps: StepProgress[]) => {
  const promised = sum(steps, (s) => s.promisedMs ?? 0);
  return promised > 0 ? ` · expected ${fmtDuration(promised)} (${fmtDelta(sum(steps, (s) => s.elapsedMs), promised)})` : "";
};
/** One fact line for a group of steps: done → took vs expected; running → position, remaining and the estimate's basis; pending → the estimate. */
function groupFact(steps: StepProgress[], status: StepStatus): string {
  if (!steps.length) return "";
  const running = steps.find((s) => s.status === "running");
  if (status === "done") return `took ${fmtDuration(sum(steps, (s) => s.elapsedMs))}${expectedNote(steps)}`;
  if (status === "running") {
    const remaining = sum(steps, (s) => (s.status === "done" ? 0 : s.remainingMs));
    const basis = running?.basis ?? steps.find((s) => s.status === "pending")?.basis ?? "";
    return `${fmtDuration(sum(steps, (s) => s.elapsedMs))} so far · ≈ ${fmtDuration(remaining)} left${basis ? ` · ${basis}` : ""}`;
  }
  return `≈ ${fmtDuration(sum(steps, (s) => s.estimateMs))}${steps[0].basis ? ` · ${steps[0].basis}` : ""}`;
}

/** The export's steps folded into five rows at most: Prepare, Video (every span), Sound, Join parts (parts exports only), Finish. */
export function groupSteps(steps: StepProgress[], job: ExportJobView): StepGroup[] {
  if (!steps.length) return [];
  const by = (kind: StepProgress["kind"]) => steps.filter((s) => s.kind === kind);
  const groups: StepGroup[] = [];
  const prepare = by("prepare"), video = by("video"), audio = by("audio"), finalize = by("finalize");
  if (prepare.length) groups.push({ id: "prepare", title: GROUP_TITLE.prepare, status: groupStatus(prepare), fact: groupFact(prepare, groupStatus(prepare)), stage: prepare.find((s) => s.status === "running")?.stage, steps: prepare });
  if (video.length) {
    const status = groupStatus(video);
    const running = video.find((s) => s.status === "running");
    const done = video.filter((s) => s.status === "done").length;
    const where = status === "running" ? `span ${running ? running.spanIndex ?? done + 1 : done + 1} of ${video.length} · ${fmtMs(sum(video, (s) => s.done))} of ${fmtMs(sum(video, (s) => s.units))} · ` : status === "pending" ? `${video.length} span${video.length === 1 ? "" : "s"} · ${fmtMs(sum(video, (s) => s.units))} of timeline · ` : `${video.length} span${video.length === 1 ? "" : "s"} · `;
    groups.push({ id: "video", title: GROUP_TITLE.video, status, fact: where + groupFact(video, status), steps: video });
  }
  if (audio.length) groups.push({ id: "audio", title: GROUP_TITLE.audio, status: groupStatus(audio), fact: groupFact(audio, groupStatus(audio)), steps: audio });
  // The join is part of the tracker's finish step; it gets its own row from what the engine reports as it goes.
  const j = job.join;
  const joinStatus: StepStatus = j ? (j.done ? "done" : "running") : "pending";
  if (job.partsMode) {
    const fact = !j ? "copies the finished parts into the file — no re-encoding" : j.done ? `${j.parts} parts, ${fmtBytes(j.bytes)} copied into the file${j.mode === "remove" ? ", each removed as it went in" : ""}` : `part ${Math.max(1, j.at)} of ${j.parts} · ${fmtBytes(j.copied)} of ${fmtBytes(j.bytes)}${j.mode === "remove" ? " · each removed as it goes in" : ""}`;
    groups.push({ id: "join", title: GROUP_TITLE.join, status: joinStatus, fact, steps: [], join: j });
  }
  if (finalize.length) {
    // While the join runs the finish step is already "running" for the tracker; here it waits its turn.
    const status: StepStatus = j && !j.done ? "pending" : groupStatus(finalize);
    groups.push({ id: "finalize", title: GROUP_TITLE.finalize, status, fact: groupFact(finalize, status), stage: status === "running" ? finalize.find((s) => s.status === "running")?.stage : undefined, steps: finalize });
  }
  return groups;
}

/** "2 of 5 steps done · Video running, span 14 of 91 · to go: Sound, Join parts, Finish" */
export function summaryLine(groups: StepGroup[]): string {
  const done = groups.filter((g) => g.status === "done").length;
  const running = groups.find((g) => g.status === "running");
  const toGo = groups.filter((g) => g.status === "pending").map((g) => g.title);
  const runningNote = running ? `${running.title} running${running.id === "video" || running.id === "join" ? `, ${running.fact.split(" · ")[0]}` : ""}` : done === groups.length ? "all done" : "";
  return [`${done} of ${groups.length} steps done`, runningNote, toGo.length ? `to go: ${toGo.join(", ")}` : ""].filter(Boolean).join(" · ");
}

function StatusMark({ status, paused, size = 15 }: { status: StepStatus; paused: boolean; size?: number }) {
  if (status === "done") return <Check size={size} className="text-accent" aria-label="done" />;
  if (status === "running") return paused ? <Pause size={size} className="text-warn" aria-label="paused" /> : <Loader size={size} className="animate-spin text-accent" aria-label="running" />;
  return <Circle size={size - 2} className="mt-0.5 text-faint" aria-label="pending" />;
}

/** The five rows, each with a status mark, a fact line and a "more" that opens the row's own detail. */
export function StepLadder({ groups, paused }: { groups: StepGroup[]; paused: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <ol className="divide-y divide-line rounded-[var(--radius-sm)] border border-line" data-export-steps>
      {groups.map((g, i) => {
        const isOpen = !!open[g.id];
        return (
          <li key={g.id} className={cn("px-3 py-1.5", g.status === "running" && "bg-accent-soft/40")} data-step-group={g.id} data-status={g.status}>
            <div className="grid grid-cols-[20px_1fr_auto] items-start gap-x-2">
              <div className="pt-0.5">
                <StatusMark status={g.status} paused={paused} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
                  <span className={cn("font-medium", g.status === "pending" ? "text-muted" : "text-ink")}>
                    {i + 1}. {g.title}
                  </span>
                  <span className="font-mono text-[12px] tabular text-muted" data-step-fact>
                    {g.fact}
                  </span>
                </div>
                {g.stage && g.status === "running" && (
                  <div className="mt-0.5 text-[12px] text-ink" data-step-stage>
                    now: {g.stage}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))} aria-expanded={isOpen} className="flex items-center gap-0.5 text-[12px] text-accent hover:underline" data-step-more>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {isOpen ? "less" : "more"}
              </button>
            </div>
            {isOpen && (
              <div className="mt-1.5 pl-7 text-[12px]" data-step-detail>
                <GroupDetail group={g} paused={paused} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** What a row holds: Prepare its sub-tasks, Video its spans (done ones folded into a count), Sound its sources, Join the parts and room, Finish its two stages. */
function GroupDetail({ group: g, paused }: { group: StepGroup; paused: boolean }) {
  if (g.id === "join") {
    const j = g.join;
    return (
      <div className="space-y-0.5 text-muted">
        <div>The finished parts are copied into the file packet by packet, no re-encoding, then the audio goes in beside them.</div>
        {j ? (
          <div>
            {j.parts} parts, {fmtBytes(j.bytes)} in all (largest {fmtBytes(j.largest)}); needs about <span className="text-ink">{fmtBytes(j.need)}</span> free on the drive holding the project folder — {j.mode === "remove" ? "the largest part plus the audio, since each part is removed as soon as it is in the file" : "room for the whole file beside the parts, which stay until it is finished"}.
          </div>
        ) : (
          <div>Parts under 8 GB stay until the file is finished; above that each is removed as it goes in, so the join needs the room of one part at a time.</div>
        )}
      </div>
    );
  }
  if (g.id === "video") {
    const done = g.steps.filter((s) => s.status === "done");
    const running = g.steps.find((s) => s.status === "running");
    const pending = g.steps.filter((s) => s.status === "pending");
    const next = pending.slice(0, 3), rest = pending.slice(3);
    return (
      <div className="space-y-1">
        {done.length > 0 && (
          <div className="text-muted" data-spans-done>
            {done.length} span{done.length === 1 ? "" : "s"} done · {fmtMs(sum(done, (s) => s.units))} of video · took {fmtDuration(sum(done, (s) => s.elapsedMs))}
            {expectedNote(done)}
          </div>
        )}
        {running && (
          <ol className="rounded-[var(--radius-sm)] border border-line">
            <StepRow step={running} index={(running.spanIndex ?? 1) - 1} paused={paused} />
          </ol>
        )}
        {next.map((s) => (
          <div key={s.id} className="flex flex-wrap gap-x-2 text-muted" data-span-next>
            <span className="text-ink">{s.title}</span>
            <span>{s.span ? `${fmtMs(s.span.start)} → ${fmtMs(s.span.end)} (${fmtMs(s.units)})` : fmtMs(s.units)}</span>
            <span className="font-mono tabular">≈ {fmtDuration(s.estimateMs)}</span>
          </div>
        ))}
        {rest.length > 0 && (
          <div className="text-faint">
            and {rest.length} more span{rest.length === 1 ? "" : "s"} ({fmtMs(sum(rest, (s) => s.units))}, ≈ {fmtDuration(sum(rest, (s) => s.estimateMs))})
          </div>
        )}
      </div>
    );
  }
  if (g.id === "finalize") {
    const s = g.steps[0];
    return (
      <div className="space-y-0.5 text-muted">
        <div>1. Flush the encoders and write the MP4 index (moov).</div>
        <div>2. Close the file: the browser reads the whole file back to check it, then moves it into place — this grows with the file size.</div>
        {s && s.status === "done" && <div>took {fmtDuration(s.elapsedMs)}{expectedNote([s])}</div>}
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-muted">
      {g.steps.map((s) => (
        <div key={s.id}>
          {s.detail}
          {s.status === "done" ? ` Took ${fmtDuration(s.elapsedMs)}${expectedNote([s])}.` : s.status === "running" ? ` ${fmtDuration(s.elapsedMs)} so far of ≈ ${fmtDuration(s.estimateMs)}.` : ` ≈ ${fmtDuration(s.estimateMs)} · ${s.basis}.`}
        </div>
      ))}
    </div>
  );
}

function StepRow({ step: s, index, paused }: { step: StepProgress; index: number; paused: boolean }) {
  const running = s.status === "running", done = s.status === "done";
  const timed = s.kind === "video" || s.kind === "audio";
  const timing = done
    ? `took ${fmtDuration(s.elapsedMs)}${s.promisedMs != null && s.promisedMs > 0 ? ` · expected ${fmtDuration(s.promisedMs)} (${fmtDelta(s.elapsedMs, s.promisedMs)})` : ""}`
    : running
      ? `${fmtDuration(s.elapsedMs)} of ≈ ${fmtDuration(s.estimateMs)} · ${s.basis}`
      : `≈ ${fmtDuration(s.estimateMs)} · ${s.basis}`;
  return (
    <li className={cn("grid grid-cols-[20px_1fr] gap-x-2 px-3 py-1.5", running && "bg-accent-soft/40")} data-step={s.id} data-status={s.status}>
      <div className="pt-0.5">{done ? <Check size={15} className="text-accent" aria-label="done" /> : running ? paused ? <Pause size={15} className="text-warn" aria-label="paused" /> : <Loader size={15} className="animate-spin text-accent" aria-label="running" /> : <Circle size={13} className="mt-0.5 text-faint" aria-label="pending" />}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
          <span className={cn("font-medium", done || running ? "text-ink" : "text-muted")}>
            {index + 1}. {s.title}
          </span>
          {timed && (running || done) && (
            <span className="font-mono tabular text-ink" data-step-inner>
              {((s.fraction ?? 0) * 100).toFixed(1)}%
            </span>
          )}
          {timed && <span className="font-mono tabular text-muted">{running || done ? `${fmtMs(s.done)} / ${fmtMs(s.units)}` : `${fmtMs(s.units)} of timeline`}</span>}
          <span className="ml-auto font-mono text-[12px] tabular text-muted" data-step-timing>
            {timing}
          </span>
        </div>
        <div className="text-[12px] text-faint">{s.detail}</div>
        {running && s.stage && (
          <div className="mt-0.5 text-[12px] text-ink" data-step-stage>
            now: {s.stage}
          </div>
        )}
        {running && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">{s.fraction != null ? <div className={cn("h-full transition-[width] duration-200", paused ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, s.fraction * 100)}%` }} /> : <div className={cn("h-full w-1/3 animate-pulse", paused ? "bg-warn" : "bg-accent")} />}</div>}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ result card */

/** The run's report behind a toggle: read it here, save it beside the file, download or copy it. */
function ExportAccount({ text, name, onSave }: { text: string; name: string; onSave?: () => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = reportFileName(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = () => void navigator.clipboard?.writeText(text).then(() => setNote("Copied"), () => setNote("Could not copy"));
  const save = () => onSave?.().then(setNote, (e) => setNote(e instanceof Error ? e.message : String(e)));
  return (
    <div className="text-[12.5px]" data-done-report>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 text-accent hover:underline" data-report-toggle>
          <FileText size={13} /> {open ? "Hide report" : "Report"}
        </button>
        <span className="text-faint">what happened, step by step — kept with the file if you save it</span>
        {open && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {onSave && (
              <button type="button" onClick={save} className={cn(GHOST, "h-7 px-2 text-[12px]")} data-report-save>
                <Save size={12} /> Save beside the file
              </button>
            )}
            <button type="button" onClick={download} className={cn(GHOST, "h-7 px-2 text-[12px]")} data-report-download>
              <Download size={12} /> Download
            </button>
            <button type="button" onClick={copy} className={cn(GHOST, "h-7 px-2 text-[12px]")} data-report-copy>
              <Copy size={12} /> Copy
            </button>
            {note && <span className="text-muted" data-report-note>{note}</span>}
          </span>
        )}
      </div>
      {open && <pre className="mt-1.5 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-edge bg-raised/40 p-3 font-mono text-[11.5px] leading-relaxed text-ink" data-report-text>{text}</pre>}
    </div>
  );
}

/** The doctor's verdict on a file, with a line of what a repair did and a way to run it again. */
export function FileVerdict({ report, checking, error, repaired, onCancel, onAgain, canFix, onFix, busy, hook, noFacts }: { report?: DoctorReport | null; checking?: DoctorProgress | null; error?: string; repaired?: string[]; onCancel?: () => void; onAgain?: (depth: DoctorDepth) => void; canFix: (kind: FixKind) => boolean; onFix: (finding: Finding) => void; busy: boolean; hook: string; noFacts?: boolean }) {
  if (!checking && !error && report === null)
    return (
      <p className="text-[12px] text-faint" {...{ [`data-${hook}`]: "off" }}>
        The file was not checked (the doctor is off in Options).
        {onAgain && (
          <button type="button" onClick={() => onAgain("full")} disabled={busy} className="ml-2 text-accent hover:underline" {...{ [`data-${hook}-again`]: "" }}>
            check it now
          </button>
        )}
      </p>
    );
  if (!checking && !error && !report) return null;
  return (
    <div className="space-y-1">
      <DoctorReportView report={report} running={checking} error={error} onCancel={onCancel} canFix={canFix} onFix={onFix} busy={busy} hook={hook} noFacts={noFacts} />
      {repaired && repaired.length > 0 && (
        <p className="text-[12px] text-positive" {...{ [`data-${hook}-repaired`]: "" }}>
          Repaired: {repaired.join("; ")}.
        </p>
      )}
      {report && !checking && onAgain && (
        <p className="text-[12px] text-faint">
          <button type="button" onClick={() => onAgain(report.depth === "full" ? "full" : "quick")} disabled={busy} className="hover:text-ink" {...{ [`data-${hook}-again`]: "" }}>
            check again
          </button>
          {report.depth !== "full" && (
            <>
              {" · "}
              <button type="button" onClick={() => onAgain("full")} disabled={busy} className="hover:text-ink" {...{ [`data-${hook}-full`]: "" }}>
                full scan
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function ExportDone({ done, busy, onDismiss, onAgain, onFiles, onRecheck, onCancelCheck, canFix, onFixFinding, onResume, onDiscard, onFix, account, onSaveReport }: { done: DoneResult; busy: boolean; onDismiss: () => void; onAgain: () => void; onFiles: () => void; onRecheck: (depth: DoctorDepth) => void; onCancelCheck: () => void; canFix: (kind: FixKind) => boolean; onFixFinding: (finding: Finding) => void; onResume: () => void; onDiscard: () => void; onFix: () => void; account?: string | null; onSaveReport?: () => Promise<string> }) {
  const ok = done.kind === "done";
  const ratio = done.estimatedMs > 0 ? done.activeMs / done.estimatedMs : 1;
  const pace = done.estimatedMs <= 0 ? "" : Math.abs(ratio - 1) < 0.05 ? "as estimated" : ratio > 1.5 ? `${ratio.toFixed(1)}× the estimate` : ratio < 0.67 ? `${(1 / ratio).toFixed(1)}× faster than estimated` : ratio > 1 ? `${Math.round((ratio - 1) * 100)}% slower than estimated` : `${Math.round((1 - ratio) * 100)}% faster than estimated`;
  const realtime = done.activeMs > 0 ? done.seconds / (done.activeMs / 1000) : 0;
  return (
    <div className={cn("panel space-y-2.5 border-2 p-4", ok ? (done.report && !done.report.ok ? "border-warn" : "border-positive/60") : "border-warn")} data-export-done={done.kind} aria-live="polite">
      <div className="flex flex-wrap items-start gap-3">
        {ok ? <Check size={20} className="mt-0.5 shrink-0 text-positive" /> : <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink" data-done-title>
            {ok ? `Exported ${done.name}` : done.space?.where === "join" ? "Export encoded to the end — joining the parts failed" : done.kind === "stopped" ? `Export stopped${done.keptAt ? ` at ${fmtTime(done.keptAt)} of ${fmtTime(done.seconds)}` : ""}` : `Export failed${done.keptAt ? ` at ${fmtTime(done.keptAt)} of ${fmtTime(done.seconds)}` : ""}`}
          </div>
          <div className="text-[12.5px] text-muted" data-done-facts>
            {ok ? (
              <>
                {fmtBytes(done.bytes)} · {fmtTime(done.seconds)} · {done.codec} {pictureText(done.width, done.height)} at {done.bitrateMbps} Mbps · AAC {done.audioKbps} kbps · took {fmtDuration(done.activeMs)}
                {done.copiedSeconds ? ` · ${fmtTime(done.copiedSeconds)} copied as is` : ""}
                {done.pausedMs > 500 ? ` (+${fmtDuration(done.pausedMs)} paused)` : ""}
                {realtime > 0 ? ` at ${realtime.toFixed(2)}× realtime` : ""}
                {pace ? `, ${pace}` : ""}
                {done.folder ? ` · in ${done.folder}` : ""}
                {done.parts > 1 ? ` · ${done.parts} parts joined${done.joinMode === "remove" ? ", each removed as it went in" : ""}` : ""}
                {done.resumedFrom ? ` · resumed from ${fmtTime(done.resumedFrom)}` : ""}
              </>
            ) : (
              <>
                {done.message}
                {done.keptParts ? ` ${done.keptParts} part${done.keptParts === 1 ? "" : "s"} kept in the folder — Resume carries on from there, Discard removes them.` : ""}
              </>
            )}
          </div>
          {done.skipped.length > 0 && (
            <div className="text-[12px] text-warn" data-done-skipped>
              {done.skipped.length} stretch{done.skipped.length === 1 ? "" : "es"} skipped after frames failed ({done.skipped.reduce((a, k) => a + (k.to - k.from), 0).toFixed(2)} s in all, at {done.skipped.map((k) => fmtTime(k.from)).join(", ")}).
            </div>
          )}
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 rounded p-1 text-faint hover:text-ink" aria-label="Dismiss" data-done-dismiss>
          <X size={15} />
        </button>
      </div>
      {done.space && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-danger/50 bg-danger/10 px-3 py-2 text-[13px]" role="alert" data-done-space data-where={done.space.where}>
          <AlertTriangle size={15} className="shrink-0 text-danger" />
          <span>
            <span className="font-medium text-ink">{done.space.where === "join" ? "The drive refused a write while the parts were being joined." : done.space.where === "part" ? "The drive refused a write while a part was being written." : "The drive refused a write."}</span> {roomAdvice(done.space.where, done.space.need, done.space.mode ? { mode: done.space.mode } : undefined)}
            {done.keptParts
              ? done.space.where === "join"
                ? ` Then press Resume: the join starts over and nothing else is encoded again${done.space.consumed ? `, but for the ${done.space.consumed} part${done.space.consumed === 1 ? "" : "s"} already in the unfinished file` : ""}.`
                : " Then press Resume: the kept parts carry on from where they stopped."
              : " Then export again: nothing was finished yet, so it starts from the beginning."}
          </span>
        </div>
      )}
      {account && <ExportAccount text={account} name={done.name} onSave={onSaveReport} />}
      {ok && <FileVerdict report={done.report} checking={done.checking} error={done.checkError} repaired={done.repaired} onCancel={onCancelCheck} onAgain={onRecheck} canFix={canFix} onFix={onFixFinding} busy={busy} hook="done-check" />}
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {!ok && done.keptParts ? (
          <>
            <button type="button" onClick={onResume} disabled={busy} className={cn(PRIMARY, "h-8")} data-done-resume>
              <Play size={13} /> Resume
            </button>
            <button type="button" onClick={onDiscard} disabled={busy} className={cn(GHOST, "hover:border-danger hover:text-danger")} data-done-discard>
              <Trash2 size={13} /> Discard parts
            </button>
          </>
        ) : (
          <button type="button" onClick={onAgain} disabled={busy} className={GHOST} data-done-again>
            <RotateCcw size={13} /> Export again
          </button>
        )}
        {ok && (
          <button type="button" onClick={onFix} disabled={busy} className={GHOST} title="Measure the file's loudness and write a copy at YouTube's level without touching the picture" data-done-fix>
            <Gauge size={13} /> Check or fix the level
          </button>
        )}
        <button type="button" onClick={onFiles} className={GHOST} data-done-files>
          <FolderOpen size={13} /> Files in the folder
        </button>
        {ok && (
          <Link href="/media/mp4-tags" className={cn(GHOST, "no-underline")}>
            Tag editor
          </Link>
        )}
        {ok && <span className="text-[12px] text-faint">On YouTube, set the category to Music and add the song credits on the upload page; that is what YouTube Music lists by.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ files */

const KIND_LABEL: Record<FileEntry["kind"], string> = { export: "export", preview: "test render", fixed: "re-levelled copy", other: "video", unfinished: "unfinished export" };

export function ExportFiles({ files, loading, onRefresh, onCheck, onCancelCheck, canFix, onFixFinding, onFix, onDelete, fix, busy, resumable, onResume, onDiscard, hasFolder }: { files: FileEntry[]; loading: boolean; onRefresh: () => void; onCheck: (name: string, depth: DoctorDepth) => void; onCancelCheck: (name: string) => void; canFix: (kind: FixKind) => boolean; onFixFinding: (name: string, finding: Finding) => void; onFix: (name: string) => void; onDelete: (name: string) => void; fix: FixState | null; busy: boolean; resumable: ResumableView | null; onResume: () => void; onDiscard: () => void; hasFolder: boolean }) {
  return (
    <div className="space-y-2" data-export-files>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <span className="font-medium text-ink">Files in the project folder</span>
        <span>{hasFolder ? `${files.length} video${files.length === 1 ? "" : "s"} besides the recordings` : "pick a project folder first"}</span>
        <button type="button" onClick={onRefresh} disabled={loading || !hasFolder} className={cn(GHOST, "ml-auto h-7 px-2 text-[12px]")} data-files-refresh>
          {loading ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />} Refresh
        </button>
      </div>
      {resumable && (
        <div className={cn("flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border p-2.5 text-[12.5px]", resumable.matches ? "border-accent/60 bg-accent-soft/40" : "border-warn/50 bg-warn/10")} data-files-resumable>
          <Play size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-muted">
            <span className="font-medium text-ink">
              Parts of an export of {resumable.name}: {fmtTime(resumable.endAt)} of {fmtTime(resumable.total)} done
            </span>{" "}
            — {resumable.parts} part{resumable.parts === 1 ? "" : "s"}, {fmtBytes(resumable.bytes)}, in {resumable.folder}.{resumable.consumedParts ? ` ${resumable.consumedParts} already joined into a file that did not finish; Resume exports ${fmtTime(resumable.consumedSeconds)} of them again.` : ""} {resumable.matches ? "Resume carries on from there and joins them without re-encoding." : "The project may have changed since they were made (or the editor was updated): Resume anyway carries on all the same — the parts stay as they are and only the rest follows the current edit."}
          </span>
          <button type="button" onClick={onResume} disabled={busy} className={cn(resumable.matches ? PRIMARY : GHOST, "h-8")} data-files-resume {...(resumable.matches ? {} : { "data-resume-anyway": "" })}>
            <Play size={13} /> {resumable.matches ? "Resume" : "Resume anyway"}
          </button>
          <button type="button" onClick={onDiscard} disabled={busy} className={cn(GHOST, "h-8 hover:border-danger hover:text-danger")} data-files-discard>
            <Trash2 size={13} /> Discard parts
          </button>
        </div>
      )}
      {hasFolder && !loading && files.length === 0 && <p className="text-[12.5px] text-faint">Nothing exported yet. Exports, test renders and re-levelled copies land here, next to your recordings.</p>}
      <ul className="divide-y divide-line rounded-[var(--radius-sm)] border border-edge" data-files-list>
        {files.map((f) => {
          const report = f.report;
          return (
            <li key={f.name} className="space-y-1.5 p-2.5 text-[12.5px]" data-file={f.name} data-file-kind={f.kind} data-file-state={f.checking ? "checking" : report ? (report.errors ? "problems" : report.warnings ? "warnings" : "ok") : f.error ? "error" : "unchecked"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink" title={f.name}>
                  {f.name}
                </span>
                <span className="text-[12px] text-faint">{KIND_LABEL[f.kind]}</span>
                <span className="font-mono text-[12px] tabular text-muted">{fmtBytes(f.size)}</span>
                <span className="text-[12px] text-faint">{new Date(f.lastModified).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                {f.kind === "unfinished" ? (
                  <span className="text-muted" data-file-unfinished>
                    An export that stopped before its parts were joined — Resume above carries on from them; Discard parts removes them.
                  </span>
                ) : (
                  !f.checking && !report && (f.error ? <span className="text-warn">{f.error}</span> : <span className="text-faint">not checked</span>)
                )}
                {!f.checking && report && (
                  <span className="inline-flex items-center gap-1 font-medium text-ink" data-file-verdict>
                    {fmtTime(report.facts.durationS)}
                    {report.facts.video ? ` · ${report.facts.video.width}×${report.facts.video.height} ${report.facts.video.label.split(",")[0]}` : ""}
                    {report.index.tags.title ? ` · “${report.index.tags.title}”` : ""}
                  </span>
                )}
                {f.kind !== "unfinished" && (
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => onCheck(f.name, "quick")} disabled={busy || !!f.checking} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Read the index and judge the structure, codec parameters and YouTube's rules — seconds" data-file-check>
                    {report ? "Check again" : "Check"}
                  </button>
                  <button type="button" onClick={() => onCheck(f.name, "full")} disabled={busy || !!f.checking} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Also read every packet, decode the whole soundtrack and the picture at every cut" data-file-check-full>
                    Full scan
                  </button>
                  <button type="button" onClick={() => onFix(f.name)} disabled={busy} className={cn(GHOST, "h-7 px-2 text-[12px]")} title="Measure the loudness and, if it is off, write a copy at the right level — the picture copied as it is" data-file-fix>
                    <Gauge size={12} /> Level
                  </button>
                  <button type="button" onClick={() => onDelete(f.name)} disabled={busy} className={cn(GHOST, "h-7 px-2 text-[12px] hover:border-danger hover:text-danger")} data-file-delete>
                    <Trash2 size={12} />
                  </button>
                </span>
                )}
              </div>
              <FileVerdict report={report} checking={f.checking} error={f.checking || report ? undefined : f.error} repaired={f.repaired} onCancel={() => onCancelCheck(f.name)} canFix={canFix} onFix={(x) => onFixFinding(f.name, x)} busy={busy} hook="file-report" />
              {fix && fix.name === f.name && (
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-base p-2" data-fix-level>
                  <span className="font-mono text-[12px] text-ink" data-fix-measured>
                    {describeLoud(fix.loudness)}
                  </span>
                  {fix.loudness.integrated !== null && (
                    <>
                      <label className="flex items-center gap-1 text-muted">
                        Target
                        <select value={fix.target} onChange={(e) => fix.setTarget(Number(e.target.value))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Target loudness" data-fix-target>
                          {[-14, -16, -18, -23].map((t) => (
                            <option key={t} value={t}>
                              {t} LUFS{t === YOUTUBE_LUFS ? " (YouTube)" : t === -23 ? " (broadcast)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="font-mono text-[12.5px] text-ink" data-fix-gain>
                        {fix.gain > 0 ? "+" : ""}
                        {fix.gain} dB
                      </span>
                      {Math.abs(fix.gain) < 0.1 ? (
                        <span className="text-[12px] text-positive">already at the target</span>
                      ) : (
                        <button type="button" onClick={fix.run} disabled={busy} className={cn(PRIMARY, "h-7 px-2.5 text-[12px]")} data-fix-run>
                          Write a copy at {fix.target} LUFS
                        </button>
                      )}
                    </>
                  )}
                  {fix.done && (
                    <span className="basis-full text-[12px] text-positive" data-fix-done>
                      Written {fix.done.name} ({fmtBytes(fix.done.bytes)}): the picture copied as it was, the sound {fix.done.gainDb > 0 ? "raised" : "lowered"} by {Math.abs(fix.done.gainDb)} dB and limited at −1 dBFS, the tags kept.
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ the editor's checklist */

const REVIEW_ICON: Record<ReviewState, ReactNode> = { ok: <Check size={14} className="shrink-0 text-positive" aria-label="fine" />, look: <Eye size={14} className="shrink-0 text-warn" aria-label="look" />, info: <Info size={14} className="shrink-0 text-faint" aria-label="note" /> };

/**
 * The review sheet before an export: the project summarised item by item, each with a tick box, the action that
 * takes you to the place to change it, and the chapters list for the description. Export enables when every item
 * is ticked; ticks are the host's, keyed by item content.
 */
export function ExportReview({ review, ticked, onTick, onTickAll, onAction, onCancel, onExport, busy, fileLine }: { review: Review; ticked: Record<string, string>; onTick: (id: string, key: string, on: boolean) => void; onTickAll: (on: boolean) => void; onAction: (id: string) => void; onCancel: () => void; onExport: () => void; busy: boolean; fileLine: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const done = tickedCount(review, ticked), total = review.items.length, all = allTicked(review, ticked);
  const look = review.items.filter((i) => i.state === "look").length;
  const copyChapters = async () => {
    try {
      await navigator.clipboard.writeText(review.chapters.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused */
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="review-title" data-review-dialog>
      <div className="absolute inset-0 bg-scrim" onClick={onCancel} />
      <div className="panel relative flex max-h-full w-full max-w-3xl flex-col shadow-xl">
        <div className="flex flex-wrap items-start gap-3 border-b border-edge p-4">
          <div className="min-w-0 flex-1">
            <h2 id="review-title" className="text-[15px] font-semibold text-ink">
              Before you export — the editor&apos;s checklist
            </h2>
            <p className="text-[12.5px] text-muted">
              {fileLine} · {look ? `${look} item${look === 1 ? "" : "s"} worth a look, ` : ""}
              <span data-review-count>
                {done} of {total} ticked
              </span>
            </p>
          </div>
          <button type="button" onClick={() => onTickAll(!all)} className={cn(GHOST, "h-8")} data-review-tick-all>
            {all ? "Untick all" : "Tick all"}
          </button>
          <button type="button" onClick={onCancel} className="rounded p-1 text-faint hover:text-ink" aria-label="Close" data-review-cancel>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {review.groups.map((g) => (
            <section key={g.id} className="mb-4 last:mb-0" data-review-group={g.id}>
              <h3 className="readout mb-1.5 text-faint">{g.title}</h3>
              <ul className="divide-y divide-line rounded-[var(--radius-sm)] border border-edge">
                {g.items.map((it) => {
                  const on = ticked[it.id] === it.key;
                  const many = (it.lines?.length ?? 0) > 5 && !expanded[it.id];
                  const lines = many ? it.lines!.slice(0, 5) : it.lines;
                  return (
                    <li key={it.id} className={cn("flex gap-3 p-2.5 text-[12.5px]", on && "bg-base/60")} data-review-item={it.id} data-state={it.state} data-ticked={on ? "true" : "false"}>
                      <label className="flex shrink-0 items-start pt-0.5">
                        <input type="checkbox" checked={on} onChange={(e) => onTick(it.id, it.key, e.target.checked)} className="accent-[var(--accent)]" aria-label={`Reviewed: ${it.title}`} data-review-tick />
                      </label>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {REVIEW_ICON[it.state]}
                          <span className={cn("font-medium", on ? "text-muted line-through decoration-edge" : "text-ink")}>{it.title}</span>
                          {it.action && (
                            <button type="button" onClick={() => onAction(it.action!.id)} className={cn(GHOST, "ml-auto h-7 px-2 text-[12px]")} data-review-action={it.action.id}>
                              {it.action.label}
                            </button>
                          )}
                        </div>
                        <p className="text-muted">{it.summary}</p>
                        {lines && lines.length > 0 && (
                          <div className={cn("rounded-[var(--radius-sm)] bg-base px-2 py-1.5 text-[12px] text-ink", it.id === "chapters" && "font-mono whitespace-pre-wrap")} data-review-lines>
                            {lines.map((ln, i) => (
                              <div key={i}>{ln}</div>
                            ))}
                            {many && (
                              <button type="button" onClick={() => setExpanded((x) => ({ ...x, [it.id]: true }))} className="mt-1 text-accent hover:underline">
                                show all {it.lines!.length}
                              </button>
                            )}
                          </div>
                        )}
                        {it.id === "chapters" && review.chapters.lines.length > 0 && (
                          <button type="button" onClick={() => void copyChapters()} className={cn(GHOST, "h-7 px-2 text-[12px]")} data-review-copy-chapters>
                            {copied ? "Copied" : "Copy the chapters"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge p-4">
          <span className="text-[12.5px] text-muted">{all ? "Everything reviewed." : "Tick each item once you have looked at it; Export opens when all are ticked."}</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className={cn(GHOST, "h-9")}>
              Back to editing
            </button>
            <button type="button" onClick={onExport} disabled={!all || busy} className={cn(PRIMARY, "h-9")} title={all ? "Write the file into the project folder" : "Tick every item first"} data-review-export>
              <Download size={14} /> Export
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
