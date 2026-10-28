"use client";

/**
 * The Shorts Maker's pieces: the phone-shaped preview with the platforms' buttons ghosted over it, the platform chips,
 * a slider, the strip of scenes, and the post copy. Presentational; the maker holds the state.
 */

import { type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import { PLATFORMS, type PlatformId, type PostCopy } from "@/lib/tools/video/shorts";
import { fmtTime, type SafeArea } from "@/lib/tools/video/project";
import { GHOST, RANGE } from "./video-styles";

export function Slider({ label, value, min, max, step, onChange, format, hook }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hook?: string }) {
  return (
    <label className="block text-[12.5px] text-muted">
      <span className="flex items-center justify-between">
        {label}
        <span className="font-mono tabular text-ink">{format ? format(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cn(RANGE, "mt-1")} {...(hook ? { [`data-${hook}`]: "" } : {})} />
    </label>
  );
}

/** The platforms a short is for; each chip names its limit. */
export function PlatformChips({ chosen, onToggle }: { chosen: PlatformId[]; onToggle: (id: PlatformId) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-platforms>
      {(Object.values(PLATFORMS) as (typeof PLATFORMS)[PlatformId][]).map((p) => {
        const on = chosen.includes(p.id);
        return (
          <button key={p.id} type="button" onClick={() => onToggle(p.id)} aria-pressed={on} className={cn(GHOST, on && "border-accent bg-accent-soft text-ink")} title={`${p.limitNote}.`} data-platform={p.id}>
            {on ? <Check size={12} /> : null}
            {p.name}
            <span className="text-[11px] text-faint">{fmtTime(p.maxSeconds)}{p.official ? "" : " · reported"}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The 9:16 preview: the frame at the playhead (or the rendered preview playing), with the platforms' own buttons and
 * caption area ghosted over it when asked, so what they will cover is plain.
 */
/** What a platform's own interface covers, ghosted over a vertical frame: the bars, the buttons on the right, the dashed safe area. */
export function SafeGhost({ safe }: { safe: SafeArea }) {
  return (
    <div className="pointer-events-none absolute inset-0" data-phone-ghost>
          {/* what the platform's own interface covers */}
          <div className="absolute inset-x-0 top-0 bg-white/10" style={{ height: `${safe.top * 100}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-white/10" style={{ height: `${safe.bottom * 100}%` }}>
            <div className="absolute left-3 bottom-[28%] h-2 w-1/2 rounded bg-white/50" />
            <div className="absolute left-3 bottom-[18%] h-1.5 w-2/3 rounded bg-white/35" />
            <div className="absolute left-3 bottom-[10%] h-1.5 w-1/3 rounded bg-white/35" />
          </div>
          <div className="absolute top-0 right-0 bottom-0 bg-white/10" style={{ width: `${safe.right * 100}%` }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="absolute right-1/2 h-6 w-6 translate-x-1/2 rounded-full bg-white/45" style={{ bottom: `${safe.bottom * 100 + 4 + i * 11}%` }} />
            ))}
          </div>
          <div className="absolute top-0 bottom-0 left-0 bg-white/10" style={{ width: `${safe.left * 100}%` }} />
          <div className="absolute border border-dashed border-white/50" style={{ top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%`, left: `${safe.left * 100}%`, right: `${safe.right * 100}%` }} />
        </div>
  );
}

export function PhonePreview({ src, video, safe, ghost, children, height = 520, hook }: { src: string | null; video?: ReactNode; safe: SafeArea | null; ghost: boolean; children?: ReactNode; height?: number; hook?: string }) {
  const w = Math.round((height * 9) / 16);
  return (
    <div className="relative mx-auto overflow-hidden rounded-[22px] border-[6px] border-edge bg-black" style={{ width: w + 12, height: height + 12 }} data-phone-preview {...(hook ? { [`data-${hook}`]: "" } : {})}>
      <div className="relative h-full w-full bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {video ?? (src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" data-phone-frame /> : <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40">No frame yet</div>)}
        {ghost && safe && <SafeGhost safe={safe} />}
        {children}
      </div>
    </div>
  );
}

export interface SceneView {
  id: string;
  index: number;
  start: number;
  seconds: number;
  sourceTime: number;
  speed: number;
  thumb: string | null;
  transition: string | null;
  isLoop: boolean;
}

/** The scenes in order, as cards: thumb, length, where it came from; one selected. */
export function SceneStrip({ scenes, selected, onSelect, onMove, onRemove, onNudge, onLength, beatSeconds }: { scenes: SceneView[]; selected: string | null; onSelect: (id: string) => void; onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void; onNudge: (id: string, seconds: number) => void; onLength: (id: string, delta: number) => void; beatSeconds: number | null }) {
  const step = beatSeconds ?? 0.5;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" data-scene-strip>
      {scenes.map((s) => (
        <div key={s.id} className={cn("w-[132px] shrink-0 rounded-[var(--radius-sm)] border p-1.5", selected === s.id ? "border-accent bg-accent-soft" : "border-edge")} data-scene={s.id} data-selected={selected === s.id ? "true" : "false"}>
          <button type="button" onClick={() => onSelect(s.id)} className="block w-full text-left" title={`${s.isLoop ? "The loop's last glimpse — " : ""}from ${fmtTime(s.sourceTime)} of the recording`}>
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.thumb ? <img src={s.thumb} alt="" className="h-full w-full object-cover" /> : null}
              <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{s.isLoop ? "loop" : s.index + 1}</span>
              {s.speed !== 1 ? <span className="absolute top-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{s.speed}×</span> : null}
              {s.transition ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{s.transition}</span> : null}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
              <span className="font-mono tabular text-ink">{s.seconds.toFixed(2)} s</span>
              <span>{fmtTime(s.start)}</span>
            </div>
          </button>
          <div className="mt-1 flex items-center justify-between gap-0.5">
            <button type="button" onClick={() => onLength(s.id, -step)} className="rounded border border-edge px-1 text-[11px] text-muted hover:text-ink" title={`Shorter by ${beatSeconds ? "a beat" : "half a second"}`} data-scene-shorter>
              −
            </button>
            <button type="button" onClick={() => onLength(s.id, step)} className="rounded border border-edge px-1 text-[11px] text-muted hover:text-ink" title={`Longer by ${beatSeconds ? "a beat" : "half a second"}`} data-scene-longer>
              +
            </button>
            <button type="button" onClick={() => onNudge(s.id, -2)} className="rounded border border-edge px-1 text-[11px] text-muted hover:text-ink" title="Two seconds earlier in the recording" data-scene-earlier>
              ‹
            </button>
            <button type="button" onClick={() => onNudge(s.id, 2)} className="rounded border border-edge px-1 text-[11px] text-muted hover:text-ink" title="Two seconds later in the recording" data-scene-later>
              ›
            </button>
            <button type="button" onClick={() => onMove(s.id, -1)} className="rounded border border-edge px-1 text-muted hover:text-ink" title="Move earlier" aria-label="Move earlier">
              <ArrowUp size={11} />
            </button>
            <button type="button" onClick={() => onMove(s.id, 1)} className="rounded border border-edge px-1 text-muted hover:text-ink" title="Move later" aria-label="Move later">
              <ArrowDown size={11} />
            </button>
            <button type="button" onClick={() => onRemove(s.id)} className="rounded border border-edge px-1 text-muted hover:text-danger" title="Remove this scene" aria-label="Remove this scene" data-scene-remove>
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The words for the post, ready to copy, with the platforms' reminders. */
export function PostCopyView({ copy, notes }: { copy: PostCopy; notes: string[] }) {
  return (
    <div className="space-y-2" data-post-copy>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5 text-[12.5px]">
          <div className="flex items-start gap-2">
            <span className="readout w-20 shrink-0 pt-0.5">Title</span>
            <span className="text-ink" data-post-title>
              {copy.title}
            </span>
            <CopyButton value={copy.title} label="" className="ml-auto h-6 shrink-0 px-1.5" />
          </div>
          <div className="flex items-start gap-2">
            <span className="readout w-20 shrink-0 pt-0.5">Description</span>
            <span className="whitespace-pre-wrap text-ink">{copy.description || "—"}</span>
            {copy.description ? <CopyButton value={copy.description} label="" className="ml-auto h-6 shrink-0 px-1.5" /> : null}
          </div>
          <div className="flex items-start gap-2">
            <span className="readout w-20 shrink-0 pt-0.5">Hashtags</span>
            <span className="text-ink" data-post-hashtags>
              {copy.hashtags.join(" ")}
            </span>
            <CopyButton value={copy.hashtags.join(" ")} label="" className="ml-auto h-6 shrink-0 px-1.5" />
          </div>
        </div>
        <CopyButton value={copy.text} label="Copy all" className="h-8 self-start" />
      </div>
      <ul className="space-y-1 text-[12px] text-faint">
        {notes.map((n) => (
          <li key={n} className="flex gap-1.5">
            <Copy size={11} className="mt-0.5 shrink-0" />
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
