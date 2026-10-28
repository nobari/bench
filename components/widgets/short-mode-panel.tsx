"use client";
/**
 * The Shorts tab of the Video Editor in Short mode: the shorts cut from the timeline as a list, and the one being
 * worked on — its span, length against the platforms, loop and seam, targets, preset, pre-flight and export. Pure
 * presentation: every change goes back through the callbacks.
 */
import { ArrowDown, ArrowUp, Copy, Loader, Play, Repeat, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { EXPORT_PRESETS } from "@/lib/tools/video/export-presets";
import type { PreflightItem } from "@/lib/tools/video/preflight";
import { SHORT_LOOPS, fmtTime, type Short, type ShortTarget } from "@/lib/tools/video/project";
import { DEFAULT_SHORT_PRESET, DEFAULT_SHORT_SECONDS, SHORT_PRESETS, lengthBand, seamWord, shortFileName, shortSeconds } from "@/lib/tools/video/short-mode";
import { SHORT_LENGTHS, lengthFor, type PlatformId } from "@/lib/tools/video/shorts";
import { Preflight } from "./video-export";
import { PlatformChips } from "./shorts-parts";
import { GHOST, INPUT, PRIMARY } from "./video-styles";

/** The loop's seam as the editor last measured it: the short's last and first frames and how far apart they are. */
export interface SeamState {
  shortId: string;
  lastThumb: string | null;
  firstThumb: string | null;
  score: number | null;
  /** After "Find a better end": where the end moved from, and the seam it found. */
  movedFrom?: number | null;
  scanning: boolean;
}

const BAND_CLASS = { short: "text-warn", sweet: "text-positive", ok: "text-muted", over: "text-danger" } as const;

export function ShortsPanel({ shorts, current, duration, fps, playhead, busy, titlesCount, checks, seam, withoutMusic, loop, postText, beats, hasMusic, onAnalyseBeats, onCutToBeats, onPunchIns, onSlowHalf, onSelect, onChange, onAdd, onRemove, onDuplicate, onMove, onJump, onMarkIn, onMarkOut, onNudge, onLength, onLoopToggle, onFindSeam, onSuggest, onExport, onWithoutMusic, onSaveCover, onCopyPost, onTitles, onAction }: {
  beats: { bpm: number; count: number } | null;
  hasMusic: boolean;
  onAnalyseBeats: () => void;
  onCutToBeats: (every: 1 | 2 | 4) => void;
  onPunchIns: (every: 1 | 2 | 4) => void;
  onSlowHalf: () => void;
  shorts: Short[];
  current: Short | null;
  duration: number;
  fps: number;
  playhead: number;
  busy: boolean;
  titlesCount: number;
  checks: PreflightItem[];
  seam: SeamState | null;
  withoutMusic: boolean;
  loop: boolean;
  postText: string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Short>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onJump: (t: number) => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onNudge: (end: "from" | "to", delta: number) => void;
  onLength: (seconds: number) => void;
  onLoopToggle: () => void;
  onFindSeam: () => void;
  onSuggest: (count: number, seconds: number) => void;
  onExport: (all: boolean) => void;
  onWithoutMusic: (v: boolean) => void;
  onSaveCover: () => void;
  onCopyPost: () => void;
  onTitles: () => void;
  onAction: (id: string) => void;
}) {
  const [count, setCount] = useState(3);
  const [seconds, setSeconds] = useState(DEFAULT_SHORT_SECONDS);
  const frame = 1 / Math.max(1, fps);
  const index = current ? shorts.indexOf(current) + 1 : 0;
  const band = current ? lengthBand(shortSeconds(current), current.targets as PlatformId[]) : null;
  const maxLen = current ? lengthFor(current.targets as PlatformId[]).max : 180;
  return (
    <div className="space-y-2 text-[12.5px]" data-shorts-panel>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ink">
          {shorts.length ? `${shorts.length} short${shorts.length === 1 ? "" : "s"} on this timeline` : "No shorts yet"}
        </span>
        <button type="button" onClick={onAdd} disabled={busy || duration <= 0} className={cn(GHOST, "h-7 text-[12px]")} title="A new short starting at the playhead (N)" data-add-short>
          <Smartphone size={12} /> New at playhead
        </button>
        <span className="ml-auto flex items-center gap-1 text-[12px] text-muted" title="Split the timeline into equal stretches and start a short on the liveliest moment of each">
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Math.round(Number(e.target.value)) || 1)))} className={cn(INPUT, "w-14 font-mono")} aria-label="How many shorts to suggest" data-suggest-count />
          ×
          <input type="number" min={5} max={180} step={5} value={seconds} onChange={(e) => setSeconds(Math.max(5, Math.min(180, Number(e.target.value) || DEFAULT_SHORT_SECONDS)))} className={cn(INPUT, "w-16 font-mono")} aria-label="Seconds per suggested short" data-suggest-seconds />
          s
          <button type="button" onClick={() => onSuggest(count, seconds)} disabled={busy || duration <= 0} className={cn(GHOST, "h-7 text-[12px]")} data-suggest-shorts>
            <Sparkles size={12} /> Suggest
          </button>
        </span>
      </div>
      {shorts.length > 0 && (
        <ol className="space-y-1" data-short-list>
          {shorts.map((s, i) => {
            const b = lengthBand(shortSeconds(s), s.targets as PlatformId[]);
            const active = current?.id === s.id;
            return (
              <li key={s.id} className={cn("flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-1.5 py-1", active ? "border-accent bg-accent-soft" : "border-edge")} data-short-row={s.id} data-active={active ? "true" : "false"}>
                <button type="button" onClick={() => onSelect(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Work on this short">
                  <span className="w-5 shrink-0 font-mono text-[11px] text-faint tabular">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint tabular">
                    {fmtTime(s.from)}–{fmtTime(s.to)} · <span className={BAND_CLASS[b.state]}>{shortSeconds(s).toFixed(1)} s</span>
                  </span>
                  {s.loop !== "off" && <Repeat size={11} className="shrink-0 text-faint" aria-label="loops" />}
                  {s.exported && <span className="shrink-0 rounded bg-positive/15 px-1 text-[10.5px] text-positive" title={`${s.exported.name} · ${new Date(s.exported.at).toLocaleTimeString()}`}>exported</span>}
                </button>
                <button type="button" onClick={() => onJump(s.from)} className="text-faint hover:text-ink" aria-label="Go to its start" title="Go to its start">
                  <Play size={12} />
                </button>
                <button type="button" onClick={() => onMove(s.id, -1)} disabled={i === 0} className="text-faint hover:text-ink disabled:opacity-30" aria-label="Move earlier in the list">
                  <ArrowUp size={12} />
                </button>
                <button type="button" onClick={() => onMove(s.id, 1)} disabled={i === shorts.length - 1} className="text-faint hover:text-ink disabled:opacity-30" aria-label="Move later in the list">
                  <ArrowDown size={12} />
                </button>
                <button type="button" onClick={() => onDuplicate(s.id)} className="text-faint hover:text-ink" aria-label="Duplicate" title="A copy, with its titles">
                  <Copy size={12} />
                </button>
                <button type="button" onClick={() => onRemove(s.id)} className="text-faint hover:text-danger" aria-label="Delete short" title="Remove the short and its titles (the footage stays)">
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {current && band && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2" data-short-editor={current.id}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-faint tabular">{String(index).padStart(2, "0")}</span>
            <input value={current.name} onChange={(e) => onChange(current.id, { name: e.target.value })} className={cn(INPUT, "min-w-0 flex-1")} aria-label="Short name" data-short-name />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted">From</span>
            <button type="button" onClick={() => onNudge("from", -frame)} className={cn(GHOST, "h-7 px-1.5 font-mono")} title="A frame earlier (,; ⌥ for a second)" aria-label="Start a frame earlier">
              ‹
            </button>
            <button type="button" onClick={() => onJump(current.from)} className="font-mono text-ink tabular hover:text-accent" title="Go there" data-short-from>
              {fmtTime(current.from, fps)}
            </button>
            <button type="button" onClick={() => onNudge("from", frame)} className={cn(GHOST, "h-7 px-1.5 font-mono")} title="A frame later (.; ⌥ for a second)" aria-label="Start a frame later">
              ›
            </button>
            <button type="button" onClick={onMarkIn} className={cn(GHOST, "h-7 text-[12px]")} title="Start the short at the playhead (I)" data-mark-in>
              ⇤ playhead
            </button>
            <span className="ml-2 text-muted">To</span>
            <button type="button" onClick={() => onNudge("to", -frame)} className={cn(GHOST, "h-7 px-1.5 font-mono")} title="A frame earlier (⇧,; ⌥ for a second)" aria-label="End a frame earlier">
              ‹
            </button>
            <button type="button" onClick={() => onJump(Math.max(current.from, current.to - frame))} className="font-mono text-ink tabular hover:text-accent" title="Go to the last frame" data-short-to>
              {fmtTime(current.to, fps)}
            </button>
            <button type="button" onClick={() => onNudge("to", frame)} className={cn(GHOST, "h-7 px-1.5 font-mono")} title="A frame later (⇧.; ⌥ for a second)" aria-label="End a frame later">
              ›
            </button>
            <button type="button" onClick={onMarkOut} className={cn(GHOST, "h-7 text-[12px]")} title="End the short at the playhead (O)" data-mark-out>
              playhead ⇥
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("font-mono tabular", BAND_CLASS[band.state])} data-short-length data-band={band.state}>
              {shortSeconds(current).toFixed(2)} s
            </span>
            <span className="text-[12px] text-muted">— {band.note}</span>
            <span className="ml-auto flex items-center gap-1" role="group" aria-label="Length">
              {SHORT_LENGTHS.filter((n) => n <= maxLen).map((n) => (
                <button key={n} type="button" onClick={() => onLength(n)} className={cn(GHOST, "h-6 px-1.5 font-mono text-[11px]", Math.abs(shortSeconds(current) - n) < 0.01 && "border-accent text-accent")} title={`${n} s from the start`} data-length-chip={n}>
                  {n}
                </button>
              ))}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted">Loop</span>
            <select value={current.loop} onChange={(e) => onChange(current.id, { loop: e.target.value as Short["loop"] })} className={cn(INPUT, "h-7")} aria-label="Loop" title={SHORT_LOOPS.find((l) => l.id === current.loop)?.hint} data-short-loop>
              {SHORT_LOOPS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={onLoopToggle} aria-pressed={loop} className={cn(GHOST, "h-7 text-[12px]", loop && "border-accent text-accent")} title="Play the short round and round in the preview (L)" data-loop-play>
              <Repeat size={12} /> {loop ? "Looping" : "Play as a loop"}
            </button>
            <button type="button" onClick={onFindSeam} disabled={busy || seam?.scanning} className={cn(GHOST, "h-7 text-[12px]")} title="Measure how the last frame meets the first, and move the end to the frame in the last second that matches the first best" data-find-seam>
              {seam?.scanning ? <Loader size={12} className="animate-spin" /> : null} Find a better end
            </button>
          </div>
          {seam && seam.shortId === current.id && (seam.lastThumb || seam.firstThumb) && (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-raised p-1.5" data-seam>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {seam.lastThumb ? <img src={seam.lastThumb} alt="The last frame" className="h-16 rounded bg-black object-contain" /> : null}
              <span className="text-faint">→</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {seam.firstThumb ? <img src={seam.firstThumb} alt="The first frame" className="h-16 rounded bg-black object-contain" /> : null}
              <span className="text-[12px] text-muted" data-seam-word={seam.score === null ? "" : seamWord(seam.score)}>
                {seam.score === null ? "Measuring the seam…" : `The seam is ${seamWord(seam.score)} (${Math.round(seam.score * 100)}% apart)`}
                {seam.movedFrom != null ? ` — the end moved from ${fmtTime(seam.movedFrom, fps)} to ${fmtTime(current.to, fps)}` : ""}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5" data-beat-tools>
            <span className="text-muted">Beat</span>
            {beats ? (
              <>
                <span className="font-mono text-[11px] text-faint tabular" data-beat-info>
                  {beats.bpm} BPM · {beats.count} on the timeline
                </span>
                <span className="flex items-center gap-1" role="group" aria-label="Cut on the beat">
                  <span className="text-[11.5px] text-muted">cut every</span>
                  {([1, 2, 4] as const).map((n) => (
                    <button key={n} type="button" onClick={() => onCutToBeats(n)} disabled={busy} className={cn(GHOST, "h-6 px-1.5 font-mono text-[11px]")} title={`A cut on every ${n === 1 ? "beat" : `${n} beats`} inside the short`} data-cut-beats={n}>
                      {n}
                    </button>
                  ))}
                </span>
                <span className="flex items-center gap-1" role="group" aria-label="Punch in on the beat">
                  <span className="text-[11.5px] text-muted">punch in every</span>
                  {([1, 2, 4] as const).map((n) => (
                    <button key={n} type="button" onClick={() => onPunchIns(n)} disabled={busy} className={cn(GHOST, "h-6 px-1.5 font-mono text-[11px]")} title={`A small zoom on every ${n === 1 ? "beat" : `${n} beats`}, as window keys`} data-punch-beats={n}>
                      {n}
                    </button>
                  ))}
                </span>
              </>
            ) : (
              <button type="button" onClick={onAnalyseBeats} disabled={busy || !hasMusic} className={cn(GHOST, "h-6 text-[11.5px]")} title={hasMusic ? "Find the music's tempo and beats, for ticks, snapping, cuts and punch-ins" : "Add music in the Audio tab first"} data-analyse-beats-short>
                {hasMusic ? "Analyse the music's beat" : "No music yet"}
              </button>
            )}
            <button type="button" onClick={onSlowHalf} disabled={busy} className={cn(GHOST, "h-6 text-[11.5px]")} title="The short's stretch at half speed; the short grows with it" data-slow-half>
              Slow ½×
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">For</span>
            <PlatformChips chosen={current.targets as PlatformId[]} onToggle={(id) => onChange(current.id, { targets: (current.targets.includes(id as ShortTarget) ? current.targets.filter((t) => t !== id) : [...current.targets, id as ShortTarget]) as ShortTarget[] })} />
            <select value={current.preset ?? DEFAULT_SHORT_PRESET} onChange={(e) => onChange(current.id, { preset: e.target.value })} className={cn(INPUT, "h-7")} aria-label="Export preset" data-short-preset>
              {EXPORT_PRESETS.filter((p) => SHORT_PRESETS.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id} title={p.blurb}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span data-short-titles>{titlesCount ? `${titlesCount} title${titlesCount === 1 ? "" : "s"} for this short` : "No titles for this short yet"}</span>
            <button type="button" onClick={onTitles} className={cn(GHOST, "h-6 text-[11.5px]")} title="Add a hook or a caption; in Short mode new titles belong to this short">
              Titles
            </button>
          </div>
          <Preflight items={checks} onAction={onAction} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => onExport(false)} disabled={busy} className={cn(PRIMARY, "h-8 px-3 text-[13px]")} title={`Writes shorts/${shortFileName(index, current)} beside the project`} data-export-short>
              Export this short
            </button>
            <button type="button" onClick={() => onExport(true)} disabled={busy || shorts.length < 2} className={cn(GHOST, "h-8 text-[12px]")} data-export-all-shorts>
              Export all {shorts.length}
            </button>
            <label className="flex items-center gap-1 text-[12px] text-muted" title="A second file with the footage's sound only, for a trending sound added in the app">
              <input type="checkbox" checked={withoutMusic} onChange={(e) => onWithoutMusic(e.target.checked)} className="accent-[var(--accent)]" data-without-music /> also without music
            </label>
            <button type="button" onClick={onSaveCover} disabled={busy} className={cn(GHOST, "h-8 text-[12px]")} title="The frame at the playhead as a 1080×1920 JPEG beside the export" data-save-short-cover>
              Save cover
            </button>
            <button type="button" onClick={onCopyPost} className={cn(GHOST, "h-8 text-[12px]")} title="The title, description and hashtags, to paste into the app" data-copy-post>
              Copy post text
            </button>
          </div>
          <details className="text-[12px] text-muted">
            <summary className="cursor-pointer">Post text</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-raised p-2 font-sans text-[12px] text-ink" data-post-text>
              {postText}
            </pre>
          </details>
          <p className="text-[11.5px] text-faint">
            I and O set the start and end at the playhead, N starts a new short, L loops it; , and . move the start a frame, ⇧ for the end, ⌥ for a second. The playhead is at {fmtTime(playhead, fps)}.
          </p>
        </div>
      )}
    </div>
  );
}
