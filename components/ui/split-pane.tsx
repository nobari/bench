"use client";

/**
 * Two panes with a handle between them: drag to resize, arrow keys on the handle for small steps, double-click to
 * reset, and a chevron on the handle to fold either pane away to a thin strip with a restore control. The split is
 * remembered per id in this browser. Below the large breakpoint the panes stack and the handle is hidden, as the
 * grids they replace did.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SplitPaneProps {
  /** Remembers the split under bench:split:<id>. */
  id: string;
  direction?: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  /** Share of the first pane, 0…1. */
  defaultRatio?: number;
  /** Smallest size of each pane in pixels before it folds. */
  minFirst?: number;
  minSecond?: number;
  /**
   * A pane whose minimum is a floor: it is never drawn smaller than it, whatever the saved split or the room, and the
   * other pane yields instead. Off by default: the minimums then only hold while the handle is dragged.
   */
  floor?: "first" | "second" | "both" | "none";
  /** Which panes may be folded away. */
  collapsible?: "first" | "second" | "both" | "none";
  /** Names for the folded strips' restore controls. */
  firstLabel?: string;
  secondLabel?: string;
  className?: string;
  /** Below this breakpoint the panes stack (no handle). */
  stackBelow?: "lg" | "md" | "never";
  /** Gap between the panes, pixels (the handle sits in it). */
  gap?: number;
  /** Keep one pane mounted but out of sight (display none); the other takes the whole room and the handle goes. */
  hidden?: "first" | "second" | null;
}

interface Saved {
  ratio: number;
  collapsed: "first" | "second" | null;
}
const load = (id: string, fallback: Saved): Saved => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`bench:split:${id}`);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    return { ratio: typeof s.ratio === "number" && s.ratio > 0.05 && s.ratio < 0.95 ? s.ratio : fallback.ratio, collapsed: s.collapsed === "first" || s.collapsed === "second" ? s.collapsed : null };
  } catch {
    return fallback;
  }
};
const save = (id: string, s: Saved) => {
  try {
    localStorage.setItem(`bench:split:${id}`, JSON.stringify(s));
  } catch {
    /* no storage */
  }
};

export function SplitPane({ id, direction = "horizontal", first, second, defaultRatio = 0.6, minFirst = 240, minSecond = 240, collapsible = "both", floor = "none", firstLabel = "left pane", secondLabel = "right pane", className, stackBelow = "lg", gap = 12, hidden = null }: SplitPaneProps) {
  const horizontal = direction === "horizontal";
  const [state, setState] = useState<Saved>(() => load(id, { ratio: defaultRatio, collapsed: null }));
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointerId: number } | null>(null);
  const [live, setLive] = useState(false);
  const commit = useCallback(
    (next: Saved) => {
      setState(next);
      save(id, next);
    },
    [id],
  );
  const total = () => {
    const el = ref.current;
    if (!el) return 0;
    return (horizontal ? el.clientWidth : el.clientHeight) - gap;
  };
  const clampRatio = (r: number) => {
    const t = total();
    if (t <= 0) return Math.min(0.95, Math.max(0.05, r));
    const lo = minFirst / t, hi = 1 - minSecond / t;
    return Math.min(Math.max(r, lo), hi);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { pointerId: e.pointerId };
    setLive(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pos = horizontal ? e.clientX - r.left : e.clientY - r.top;
    const t = total();
    if (t <= 0) return;
    const raw = (pos - gap / 2) / t;
    // Dragging past a pane's minimum folds it; dragging back out restores it.
    if (collapsible !== "none" && collapsible !== "second" && raw * t < minFirst * 0.5) {
      if (state.collapsed !== "first") commit({ ...state, collapsed: "first" });
      return;
    }
    if (collapsible !== "none" && collapsible !== "first" && (1 - raw) * t < minSecond * 0.5) {
      if (state.collapsed !== "second") commit({ ...state, collapsed: "second" });
      return;
    }
    commit({ ratio: clampRatio(raw), collapsed: null });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    setLive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const less = horizontal ? "ArrowLeft" : "ArrowUp", more = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key !== less && e.key !== more && e.key !== "Home" && e.key !== "End" && e.key !== "Enter") return;
    e.preventDefault();
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "Enter") return commit({ ratio: defaultRatio, collapsed: null });
    if (e.key === "Home") return commit({ ...state, collapsed: collapsible === "first" || collapsible === "both" ? "first" : null });
    if (e.key === "End") return commit({ ...state, collapsed: collapsible === "second" || collapsible === "both" ? "second" : null });
    commit({ ratio: clampRatio(state.ratio + (e.key === more ? step : -step)), collapsed: null });
  };
  const reset = () => commit({ ratio: defaultRatio, collapsed: null });
  const fold = (which: "first" | "second") => commit({ ...state, collapsed: state.collapsed === which ? null : which });
  // A pane that is folded keeps its size for when it comes back.
  useEffect(() => {
    if (!live) return;
    const prev = document.body.style.cursor, prevSel = document.body.style.userSelect;
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prev;
      document.body.style.userSelect = prevSel;
    };
  }, [live, horizontal]);

  const stacked = stackBelow === "lg" ? "max-lg:!flex max-lg:!flex-col" : stackBelow === "md" ? "max-md:!flex max-md:!flex-col" : "";
  const handleHidden = stackBelow === "lg" ? "max-lg:hidden" : stackBelow === "md" ? "max-md:hidden" : "";
  const STRIP = 28;
  const c = state.collapsed;
  // Sizes come from flex-grow shares, never from percentages: a percentage height inside nested flex columns is
  // unreliable in Chrome, a grow share is not. A folded pane is a fixed strip; the other takes the rest. A floored
  // pane carries its minimum as a hard min size, so the shares only divide what is left above it.
  const grow = (which: "first" | "second"): React.CSSProperties => {
    if (hidden === which) return { display: "none" };
    if (hidden) return { flex: "1 1 0px" };
    if (c === which) return { flex: `0 0 ${STRIP}px` };
    if (c) return { flex: "1 1 0px" };
    const share = which === "first" ? state.ratio : 1 - state.ratio;
    const min = floor === which || floor === "both" ? (which === "first" ? minFirst : minSecond) : 0;
    return { flex: `${share} 1 0px`, ...(min > 0 ? (horizontal ? { minWidth: min } : { minHeight: min }) : {}) };
  };
  // Below the breakpoint the panes stack at their natural size.
  const stackedPane = stackBelow === "lg" ? "max-lg:!flex-none max-lg:!w-full" : stackBelow === "md" ? "max-md:!flex-none max-md:!w-full" : "";
  const FoldFirstIcon = horizontal ? ChevronLeft : ChevronUp, FoldSecondIcon = horizontal ? ChevronRight : ChevronDown;
  return (
    <div ref={ref} className={cn("flex min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col", stacked, className)} style={{ gap: 0 }} data-split={id} data-split-collapsed={c ?? "none"} data-split-ratio={state.ratio.toFixed(3)}>
      <div className={cn("min-h-0 min-w-0", stackedPane)} style={grow("first")} data-split-first>
        {c === "first" ? <FoldedStrip which="first" label={firstLabel} horizontal={horizontal} onRestore={() => fold("first")} /> : first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(state.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className={cn("group relative flex shrink-0 items-center justify-center outline-none", horizontal ? "cursor-col-resize flex-col" : "cursor-row-resize flex-row", handleHidden, hidden && "hidden")}
        style={horizontal ? { width: gap } : { height: gap }}
        title="Drag to resize · double-click to reset · arrows on the keyboard"
        data-split-handle
      >
        <div className={cn("rounded-full bg-edge transition-colors group-hover:bg-accent group-focus-visible:bg-accent", live && "bg-accent", horizontal ? "h-10 w-1" : "h-1 w-10")} />
        {collapsible !== "none" && (
          <div className={cn("absolute flex", horizontal ? "top-1/2 -translate-y-1/2 flex-col gap-0.5" : "left-1/2 -translate-x-1/2 flex-row gap-0.5", "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", live && "opacity-0")} style={horizontal ? { marginTop: 32 } : { marginLeft: 32 }}>
            {(collapsible === "first" || collapsible === "both") && c !== "first" && (
              <button type="button" onClick={(e) => { e.stopPropagation(); fold("first"); }} onPointerDown={(e) => e.stopPropagation()} className="rounded border border-edge bg-surface p-0.5 text-muted hover:text-accent" title={`Hide the ${firstLabel}`} data-split-fold="first">
                <FoldFirstIcon size={11} />
              </button>
            )}
            {(collapsible === "second" || collapsible === "both") && c !== "second" && (
              <button type="button" onClick={(e) => { e.stopPropagation(); fold("second"); }} onPointerDown={(e) => e.stopPropagation()} className="rounded border border-edge bg-surface p-0.5 text-muted hover:text-accent" title={`Hide the ${secondLabel}`} data-split-fold="second">
                <FoldSecondIcon size={11} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className={cn("min-h-0 min-w-0", stackedPane)} style={grow("second")} data-split-second>
        {c === "second" ? <FoldedStrip which="second" label={secondLabel} horizontal={horizontal} onRestore={() => fold("second")} /> : second}
      </div>
    </div>
  );
}

/** A folded pane: a thin strip naming what is hidden, which brings it back. */
function FoldedStrip({ which, label, horizontal, onRestore }: { which: "first" | "second"; label: string; horizontal: boolean; onRestore: () => void }) {
  return (
    <button type="button" onClick={onRestore} className={cn("flex h-full w-full items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-edge text-[11px] text-faint hover:border-accent hover:text-accent", horizontal && "[writing-mode:vertical-rl]")} title={`Show the ${label}`} data-split-restore={which}>
      {which === "first" ? (horizontal ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : horizontal ? <ChevronLeft size={12} /> : <ChevronUp size={12} />}
      {label}
    </button>
  );
}
