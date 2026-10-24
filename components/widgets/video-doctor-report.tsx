"use client";

/**
 * The doctor's report, shared by the Video Editor (after an export, in the Files view) and the Video Doctor page:
 * progress while it runs, then the verdict, the facts, every finding with what was seen and why it matters, the fix
 * where there is one, and what was checked.
 */

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Gauge, Info, Loader, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { GHOST } from "./video-styles";
import { fmtBytes, fmtDuration } from "@/lib/tools/video/progress";
import { fmtClock, type DoctorProgress, type DoctorReport, type Finding, type FixKind } from "@/lib/tools/video/doctor";

export interface DoctorReportProps {
  report?: DoctorReport | null;
  /** While a run is on: its stage and fraction. */
  running?: DoctorProgress | null;
  error?: string | null;
  onCancel?: () => void;
  /** Fixes the host can carry out here (the index repair, the level fix); the others link to the tools that do them. */
  canFix?: (kind: FixKind) => boolean;
  onFix?: (finding: Finding) => void;
  busy?: boolean;
  /** Prefix of the data attributes: `data-<hook>` carries the state. */
  hook: string;
  /** Hide the facts line (when the host shows the file's facts itself). */
  noFacts?: boolean;
}

const SEVERITY_LABEL: Record<Finding["severity"], string> = { error: "Problem", warn: "Warning", info: "Note" };

function SeverityIcon({ severity, size = 14 }: { severity: Finding["severity"]; size?: number }) {
  if (severity === "error") return <XCircle size={size} className="shrink-0 text-danger" aria-label="problem" />;
  if (severity === "warn") return <AlertTriangle size={size} className="shrink-0 text-warn" aria-label="warning" />;
  return <Info size={size} className="shrink-0 text-faint" aria-label="note" />;
}

export function DoctorReportView({ report, running, error, onCancel, canFix, onFix, busy, hook, noFacts }: DoctorReportProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const attr = (state: string) => ({ [`data-${hook}`]: state });
  if (running)
    return (
      <div className="space-y-1.5 text-[12.5px]" {...attr("running")}>
        <div className="flex flex-wrap items-center gap-2 text-muted">
          <Loader size={13} className="animate-spin text-accent" />
          <span className="text-ink" {...{ [`data-${hook}-stage`]: "" }}>
            {running.stage}
          </span>
          <span className="font-mono tabular">{Math.round(running.fraction * 100)}%</span>
          {onCancel && (
            <button type="button" onClick={onCancel} className="ml-auto text-faint hover:text-ink" {...{ [`data-${hook}-cancel`]: "" }}>
              skip the rest
            </button>
          )}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.min(100, running.fraction * 100)}%` }} />
        </div>
      </div>
    );
  if (error)
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-warn" {...attr("error")}>
        <AlertTriangle size={13} /> The file could not be checked: {error}
      </div>
    );
  if (!report) return null;
  const problems = report.findings.filter((f) => f.severity !== "info"), notes = report.findings.filter((f) => f.severity === "info");
  const state = report.errors ? "problems" : report.warnings ? "warnings" : "ok";
  const f = report.facts;
  return (
    <div className="space-y-2 text-[12.5px]" {...attr(state)} data-doctor-depth={report.depth} data-doctor-target={report.target}>
      <div className={cn("flex flex-wrap items-center gap-2 text-[13px]", report.errors ? "text-danger" : report.warnings ? "text-warn" : "text-positive")}>
        {report.errors ? <XCircle size={15} /> : report.warnings ? <AlertTriangle size={15} /> : <Check size={15} />}
        <span className="font-medium" {...{ [`data-${hook}-verdict`]: "" }}>
          {report.verdict}
        </span>
        <span className="text-[12px] text-faint">
          {report.depth === "full" ? "full scan" : "quick check"} · {fmtDuration(report.ms)}
          {report.cancelled ? " · stopped early" : ""}
        </span>
      </div>
      {!noFacts && (
        <p className="text-[12px] text-muted" {...{ [`data-${hook}-facts`]: "" }}>
          {fmtBytes(f.size)} · {fmtClock(f.durationS)}
          {f.video ? ` · ${f.video.width}×${f.video.height} at ${f.video.fps.toFixed(f.video.fps % 1 ? 2 : 0)} fps, ${f.video.label}, ${f.video.mbps.toFixed(1)} Mbps` : " · no picture"}
          {f.audio ? ` · ${f.audio.label}` : " · no sound"}
          {f.video ? ` · ${f.video.colour}` : ""}
          {f.video?.keyEveryS ? ` · a keyframe every ${f.video.keyEveryS.toFixed(1)} s` : ""}
          {f.loudness && f.loudness.integrated !== null ? ` · ${f.loudness.integrated.toFixed(1)} LUFS` : ""}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="space-y-2" {...{ [`data-${hook}-findings`]: "" }}>
          {problems.map((x) => (
            <FindingRow key={x.id} finding={x} canFix={canFix} onFix={onFix} busy={busy} />
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <div>
          <button type="button" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink" {...{ [`data-${hook}-notes`]: "" }}>
            {notesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {notes.length} note{notes.length === 1 ? "" : "s"}
            {!notesOpen ? `: ${notes.map((x) => x.title).join(" · ")}` : ""}
          </button>
          {notesOpen && (
            <ul className="mt-1.5 space-y-2 border-l border-edge pl-3">
              {notes.map((x) => (
                <FindingRow key={x.id} finding={x} canFix={canFix} onFix={onFix} busy={busy} />
              ))}
            </ul>
          )}
        </div>
      )}
      <div>
        <button type="button" onClick={() => setChecksOpen((v) => !v)} aria-expanded={checksOpen} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-ink" {...{ [`data-${hook}-checks`]: "" }}>
          {checksOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          what was checked ({report.checks.length})
        </button>
        {checksOpen && (
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {report.checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2" data-check={c.id} data-status={c.status}>
                <span className={cn("font-medium", c.status === "ok" ? "text-positive" : c.status === "problem" ? "text-danger" : "text-faint")}>{c.status === "ok" ? "✓" : c.status === "problem" ? "✕" : "–"}</span>
                <span className="text-ink">{c.title}</span>
                <span className="text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FindingRow({ finding: x, canFix, onFix, busy }: { finding: Finding; canFix?: (kind: FixKind) => boolean; onFix?: (finding: Finding) => void; busy?: boolean }) {
  const fix = x.fix;
  const local = fix && canFix?.(fix.kind) && onFix;
  return (
    <li className="space-y-0.5" data-finding={x.id} data-severity={x.severity}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityIcon severity={x.severity} />
        <span className="font-medium text-ink">{x.title}</span>
        <span className="text-[11px] uppercase tracking-wide text-faint">{SEVERITY_LABEL[x.severity]}</span>
        {fix && (
          <span className="ml-auto">
            {local ? (
              <button type="button" onClick={() => onFix(x)} disabled={busy} className={cn(GHOST, "h-7 border-accent px-2 text-[12px] text-accent")} title={fix.detail} data-fix={fix.kind}>
                {fix.kind === "fix-level" ? <Gauge size={12} /> : <Wrench size={12} />} {fix.label}
              </button>
            ) : fix.kind === "tags" ? (
              <Link href="/media/mp4-tags" className={cn(GHOST, "h-7 px-2 text-[12px] no-underline")} title={fix.detail} data-fix={fix.kind}>
                {fix.label}
              </Link>
            ) : fix.kind === "convert" ? (
              <Link href="/media/video-converter" className={cn(GHOST, "h-7 px-2 text-[12px] no-underline")} title={fix.detail} data-fix={fix.kind}>
                {fix.label}
              </Link>
            ) : (
              <span className="text-[12px] text-muted" title={fix.detail} data-fix={fix.kind}>
                {fix.label}
              </span>
            )}
          </span>
        )}
      </div>
      <p className="pl-[22px] text-ink">{x.what}</p>
      <p className="pl-[22px] text-[12px] text-muted">
        {x.why}
        {fix ? ` ${fix.detail}` : ""}
        {x.at && x.at.length > 3 ? ` At ${x.at.slice(0, 6).map(fmtClock).join(", ")}${x.at.length > 6 ? ", …" : ""}.` : ""}
      </p>
    </li>
  );
}
