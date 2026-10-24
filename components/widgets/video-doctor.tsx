"use client";

/**
 * Video Doctor: open any MP4 or MOV, choose where it is going and how deep to look, and get a report of what is
 * wrong, why it matters and what can be done — with the index repair and the level fix done right here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { ChevronDown, ChevronRight, FolderOpen, Gauge, HeartPulse, Loader, Play, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GHOST, PRIMARY, SEL } from "./video-styles";
import { DoctorReportView } from "./video-doctor-report";
import { diagnose, TARGETS, type DoctorDepth, type DoctorProgress, type DoctorReport, type DoctorTarget, type Finding, type FixKind } from "@/lib/tools/video/doctor";
import { applyRepair, planRepair } from "@/lib/tools/video/check";
import { fixLevel, measureFile } from "@/lib/tools/video/engine";
import { gainToReach, YOUTUBE_LUFS, type Loudness } from "@/lib/tools/video/loudness";
import { fmtBytes, fmtDuration } from "@/lib/tools/video/progress";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { useKeepAwake } from "@/lib/keep-awake";

type OpenPicker = (opts?: { id?: string; multiple?: boolean; types?: { description?: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
type SavePicker = (opts?: { id?: string; suggestedName?: string; types?: { description?: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
const openPicker = () => (typeof window === "undefined" ? undefined : (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker);
const savePicker = () => (typeof window === "undefined" ? undefined : (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker);
const VIDEO_TYPES = [{ description: "MP4 or MOV video", accept: { "video/mp4": [".mp4", ".m4v"], "video/quicktime": [".mov"] } }];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const TARGET_IDS = ["youtube", "playback"] as const;
const DEPTH_IDS = ["full", "quick"] as const;

interface Loaded {
  file: File;
  /** A handle when the file came from the chooser or a drop in Chrome: repairs can be written in place. */
  handle: FileSystemFileHandle | null;
}
interface FixState {
  loudness: Loudness;
  target: number;
}

export function VideoDoctorWidget() {
  const [target, setTarget] = useQueryState("t", parseAsStringLiteral(TARGET_IDS).withDefault("youtube").withOptions({ history: "replace" }));
  const [depth, setDepth] = useQueryState("d", parseAsStringLiteral(DEPTH_IDS).withDefault("full").withOptions({ history: "replace" }));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState<DoctorProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repaired, setRepaired] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"repair" | "measure" | "fix" | null>(null);
  const [fix, setFix] = useState<FixState | null>(null);
  const [fixProgress, setFixProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [fixDone, setFixDone] = useState<{ name: string; bytes: number; gainDb: number } | null>(null);
  const [needsHandle, setNeedsHandle] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef(target), depthRef = useRef(depth);
  useEffect(() => {
    targetRef.current = target;
    depthRef.current = depth;
  }, [target, depth]);

  useUnsavedWork(running ? "A check is running in the Video Doctor; leaving now would abandon it." : busy === "fix" ? "A re-levelled copy is being written; leaving now would abandon it." : null);
  useKeepAwake(!!running || busy === "fix", "bench-video-doctor");

  const run = useCallback(async (file: File, t: DoctorTarget = targetRef.current, d: DoctorDepth = depthRef.current) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning({ stage: "Reading the index", fraction: 0 });
    setError(null);
    try {
      const r = await diagnose(file, { target: t, depth: d, signal: abort.signal, onProgress: setRunning });
      setReport(r);
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      setRunning(null);
    }
  }, []);
  const load = useCallback(
    (file: File, handle: FileSystemFileHandle | null) => {
      abortRef.current?.abort();
      setLoaded({ file, handle });
      setReport(null);
      setRepaired(null);
      setFix(null);
      setFixDone(null);
      setNeedsHandle(null);
      setError(null);
      void run(file);
    },
    [run],
  );
  // Other tools (and tests) can hand a File or a file handle over: window.dispatchEvent(new CustomEvent("bench:open-file", { detail }))
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<File | FileSystemFileHandle>).detail;
      if (d instanceof File) load(d, null);
      else if (d && typeof d === "object" && "getFile" in d) void d.getFile().then((f) => load(f, d));
    };
    window.addEventListener("bench:open-file", onOpen);
    return () => window.removeEventListener("bench:open-file", onOpen);
  }, [load]);
  // Exposed for automated tests.
  useEffect(() => {
    (window as unknown as { __benchDoctor?: unknown }).__benchDoctor = { open: (f: File | FileSystemFileHandle) => window.dispatchEvent(new CustomEvent("bench:open-file", { detail: f })), run: () => loaded && run(loaded.file), getReport: () => report, getState: () => ({ running, busy, error, repaired, fix, fixDone, needsHandle, hasHandle: !!loaded?.handle }) };
  });

  const open = async () => {
    const pick = openPicker();
    if (!pick) return inputRef.current?.click();
    try {
      const [h] = await pick({ id: "bench-video-doctor", multiple: false, types: VIDEO_TYPES });
      if (h) load(await h.getFile(), h);
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const item = e.dataTransfer.items?.[0];
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    let handle: FileSystemFileHandle | null = null;
    try {
      const getHandle = (item as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })?.getAsFileSystemHandle;
      const h = getHandle ? await getHandle.call(item) : null;
      if (h && h.kind === "file") handle = h as FileSystemFileHandle;
    } catch {
      /* a plain File then: checks work, in-place repairs do not */
    }
    load(file, handle);
  };
  const cancel = () => abortRef.current?.abort();

  /** Rewrite the index in place. The old index is offered as a download first, since the page cannot write beside the file. */
  const repair = async () => {
    if (!loaded || busy) return;
    if (!loaded.handle) return setNeedsHandle("Open the file with the chooser (Chrome or Edge) to repair it in place; a dropped file from another browser can only be checked.");
    setBusy("repair");
    setError(null);
    try {
      const plan = await planRepair(loaded.file);
      if (!plan) return setError("Nothing in the index needs repairing.");
      const name = loaded.file.name;
      if (!window.confirm(`Rewrite the index of ${name}?\n\nOnly the ${fmtBytes(plan.oldSize)} index at the end of the file changes; the picture and sound stay exactly as they are. The old index is downloaded first as ${name}.index.bak.\n\n${plan.changes.join("\n")}`)) return;
      const backup = URL.createObjectURL(loaded.file.slice(plan.moovAt, plan.moovAt + plan.oldSize));
      const a = document.createElement("a");
      a.href = backup;
      a.download = `${name}.index.bak`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(backup), 30000);
      if ("requestPermission" in loaded.handle) {
        const perm = await (loaded.handle as unknown as { requestPermission: (o: { mode: string }) => Promise<string> }).requestPermission({ mode: "readwrite" });
        if (perm !== "granted") throw new Error("the browser did not allow writing to the file");
      }
      await applyRepair(loaded.handle, plan);
      const after = await loaded.handle.getFile();
      setLoaded({ file: after, handle: loaded.handle });
      setRepaired(plan.changes);
      await run(after, targetRef.current, "quick");
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  /** Measure (when the report did not) and offer the level fix. */
  const startFix = async () => {
    if (!loaded || busy) return;
    setFixDone(null);
    if (report?.facts.loudness) return setFix({ loudness: report.facts.loudness, target: YOUTUBE_LUFS });
    setBusy("measure");
    setError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      setFixProgress({ stage: "Measuring the loudness", fraction: 0 });
      const loudness = await measureFile(loaded.file, { signal: abort.signal, onProgress: (done, total) => setFixProgress({ stage: "Measuring the loudness", fraction: done / Math.max(1e-6, total) }) });
      setFix({ loudness, target: YOUTUBE_LUFS });
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    } finally {
      setBusy(null);
      setFixProgress(null);
      if (abortRef.current === abort) abortRef.current = null;
    }
  };
  const fixGain = fix && fix.loudness.integrated !== null ? gainToReach(fix.loudness.integrated, fix.loudness.peakDb, fix.target) : 0;
  /** Write the re-levelled copy where the user chooses (Chrome's save dialog streams it to disk). */
  const writeFix = async () => {
    if (!loaded || !fix || busy) return;
    const save = savePicker();
    if (!save) return setNeedsHandle("Writing a copy needs Chrome or Edge (the File System Access API); the Video Editor's Files view can also write it into a project folder.");
    const suggested = `${loaded.file.name.replace(/\.(mp4|mov|m4v)$/i, "")}-${fix.target === YOUTUBE_LUFS ? "youtube-level" : `${Math.abs(fix.target)}lufs`}.mp4`;
    let handle: FileSystemFileHandle;
    try {
      handle = await save({ id: "bench-video-doctor-fix", suggestedName: suggested, types: VIDEO_TYPES });
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
      return;
    }
    setBusy("fix");
    setError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const writable = await handle.createWritable();
      const result = await fixLevel({
        file: loaded.file,
        writable: writable as unknown as WritableStream<import("mediabunny").StreamTargetChunk>,
        gainDb: fixGain,
        audioBitrateKbps: 320,
        signal: abort.signal,
        onProgress: (stage, fraction) => setFixProgress({ stage: stage === "video" ? "Copying the picture" : stage === "audio" ? "Re-levelling the sound" : "Closing the file", fraction: stage === "video" ? fraction * 0.6 : stage === "audio" ? 0.6 + fraction * 0.35 : 0.95 + fraction * 0.05 }),
      });
      setFixDone({ name: handle.name, bytes: result.bytes, gainDb: fixGain });
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    } finally {
      setBusy(null);
      setFixProgress(null);
      if (abortRef.current === abort) abortRef.current = null;
    }
  };
  const canFix = (kind: FixKind) => kind === "repair-index" || kind === "fix-level";
  const onFix = (f: Finding) => {
    if (f.fix?.kind === "repair-index") void repair();
    else if (f.fix?.kind === "fix-level") void startFix();
  };
  const rerun = (t: DoctorTarget = target, d: DoctorDepth = depth) => loaded && void run(loaded.file, t, d);

  return (
    <div className="space-y-3">
      <div className={cn("panel registered space-y-3 p-4", dragging && "border-accent")} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => void onDrop(e)} data-doctor-drop>
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.m4v,.mov" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) load(f, null); }} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void open()} disabled={!!busy} className={cn(PRIMARY, "h-9")} data-doctor-open>
            <FolderOpen size={14} /> {loaded ? "Open another file" : "Open a video"}
          </button>
          <span className="text-[12.5px] text-muted">{loaded ? "" : "or drop an MP4 or MOV here · nothing is uploaded"}</span>
          {loaded && (
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink" title={loaded.file.name} data-doctor-file>
              {loaded.file.name} <span className="text-muted">· {fmtBytes(loaded.file.size)}{loaded.handle ? "" : " · checks only (no write access)"}</span>
            </span>
          )}
          {loaded && (
            <button type="button" onClick={() => { cancel(); setLoaded(null); setReport(null); setFix(null); setFixDone(null); setRepaired(null); }} className="rounded p-1 text-faint hover:text-ink" aria-label="Close the file" data-doctor-close>
              <X size={15} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-muted">
          <label className="flex items-center gap-1.5">
            For
            <select value={target} onChange={(e) => { const t = e.target.value as DoctorTarget; void setTarget(t); if (loaded && !running) rerun(t, depth); }} className={SEL} aria-label="Target" data-doctor-target>
              {TARGET_IDS.map((t) => (
                <option key={t} value={t}>
                  {TARGETS[t].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Depth
            <select value={depth} onChange={(e) => void setDepth(e.target.value as DoctorDepth)} className={SEL} aria-label="Depth" title="Quick reads only the index (seconds on any size). Full also reads every packet, decodes the whole soundtrack and the picture at every cut — minutes on a big file" data-doctor-depth>
              <option value="full">Full scan — every packet, the sound, the picture at every cut</option>
              <option value="quick">Quick — the index only, seconds</option>
            </select>
          </label>
          {running ? (
            <button type="button" onClick={cancel} className={cn(GHOST, "ml-auto")} data-doctor-cancel>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => rerun()} disabled={!loaded || !!busy} className={cn(GHOST, "ml-auto")} data-doctor-run>
              <Play size={13} /> {report ? "Check again" : "Check"}
            </button>
          )}
        </div>
        <p className="text-[12px] text-faint">{TARGETS[target].blurb}</p>
      </div>

      {(loaded || error) && (
        <div className="panel space-y-2.5 p-4" data-doctor-report-panel>
          <DoctorReportView report={report} running={running} error={error} onCancel={cancel} canFix={canFix} onFix={onFix} busy={!!busy} hook="doctor" />
          {repaired && (
            <p className="text-[12px] text-positive" data-doctor-repaired>
              Repaired: {repaired.join("; ")}. The old index was downloaded as {loaded?.file.name}.index.bak.
            </p>
          )}
          {needsHandle && (
            <p className="text-[12px] text-warn" data-doctor-needs-handle>
              {needsHandle}
            </p>
          )}
          {busy === "repair" && (
            <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
              <Loader size={13} className="animate-spin text-accent" /> Rewriting the index…
            </p>
          )}
          {fixProgress && (
            <div className="space-y-1 text-[12.5px]" data-doctor-fix-progress>
              <div className="flex items-center gap-2 text-muted">
                <Loader size={13} className="animate-spin text-accent" /> {fixProgress.stage} <span className="font-mono tabular">{Math.round(fixProgress.fraction * 100)}%</span>
                <button type="button" onClick={cancel} className="ml-auto text-faint hover:text-ink">
                  cancel
                </button>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-raised">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, fixProgress.fraction * 100)}%` }} />
              </div>
            </div>
          )}
          {fix && !fixProgress && (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-base p-2 text-[12.5px]" data-doctor-fix>
              <Gauge size={13} className="text-accent" />
              <span className="font-mono text-ink" data-doctor-fix-measured>
                {fix.loudness.integrated === null ? "silent" : `${fix.loudness.integrated.toFixed(1)} LUFS · peaks ${fix.loudness.peakDb.toFixed(1)} dBFS`}
              </span>
              {fix.loudness.integrated !== null && (
                <>
                  <label className="flex items-center gap-1 text-muted">
                    Target
                    <select value={fix.target} onChange={(e) => setFix({ ...fix, target: Number(e.target.value) })} className={cn(SEL, "h-7 text-[12px]")} aria-label="Target loudness" data-doctor-fix-target>
                      {[-14, -16, -18, -23].map((t) => (
                        <option key={t} value={t}>
                          {t} LUFS{t === YOUTUBE_LUFS ? " (YouTube)" : t === -23 ? " (broadcast)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="font-mono text-ink" data-doctor-fix-gain>
                    {fixGain > 0 ? "+" : ""}
                    {fixGain} dB
                  </span>
                  {Math.abs(fixGain) < 0.1 ? (
                    <span className="text-[12px] text-positive">already at the target</span>
                  ) : (
                    <button type="button" onClick={() => void writeFix()} disabled={!!busy} className={cn(PRIMARY, "h-7 px-2.5 text-[12px]")} data-doctor-fix-run>
                      Write a copy at {fix.target} LUFS…
                    </button>
                  )}
                </>
              )}
              {fixDone && (
                <span className="basis-full text-[12px] text-positive" data-doctor-fix-done>
                  Written {fixDone.name} ({fmtBytes(fixDone.bytes)}): the picture copied as it was, the sound {fixDone.gainDb > 0 ? "raised" : "lowered"} by {Math.abs(fixDone.gainDb)} dB and limited at −1 dBFS, the tags kept.
                </span>
              )}
            </div>
          )}
          {report && !running && <p className="text-[12px] text-faint">Report in {fmtDuration(report.ms)}. Change the target or the depth above and check again; a quick check reads only the index, a full scan reads the whole file.</p>}
        </div>
      )}

      <div className="panel p-4 text-[12.5px]" data-doctor-rules>
        <button type="button" onClick={() => setRulesOpen((v) => !v)} aria-expanded={rulesOpen} className="inline-flex items-center gap-1.5 font-medium text-ink">
          {rulesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <HeartPulse size={14} className="text-accent" /> What the doctor checks for {TARGETS[target].label.toLowerCase()}
        </button>
        {rulesOpen && (
          <ul className="mt-2 list-disc space-y-1 pl-6 text-muted">
            {TARGETS[target].rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>A full scan adds: every packet of every track read through and counted against the index, timestamps in order; the whole soundtrack decoded with the BS.1770-4 loudness meter running; the picture decoded for a second around every irregular cut, at both ends and every ten minutes, with the browser&apos;s hardware decoder.</li>
          </ul>
        )}
      </div>
    </div>
  );
}
