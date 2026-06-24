"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { Sparkles, History, Trash2 } from "lucide-react";
import {
  parseEntries,
  pickWinners,
  randomEntry,
  shuffle,
  splitTeams,
  dedupeEntries,
} from "@/lib/tools/generators/draw";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

const SAMPLE = "Alice\nBob\nCharlie\nDana\nEli\nFatima\nGrace\nHiro";

type Mode = "winners" | "shuffle" | "teams";

const MODES: [Mode, string][] = [
  ["winners", "Draw winners"],
  ["shuffle", "Shuffle order"],
  ["teams", "Teams"],
];

/** Reveal speed presets: tick = scramble cadence, dur = total scramble time. */
const SPEEDS: { label: string; tick: number; dur: number }[] = [
  { label: "Instant", tick: 0, dur: 0 },
  { label: "Fast", tick: 50, dur: 650 },
  { label: "Normal", tick: 70, dur: 1200 },
  { label: "Slow", tick: 95, dur: 2000 },
];

/** Pause between sequential winner reveals, scaled by speed (idx 0 = instant). */
const SEQ_GAP = [0, 220, 380, 600];

type HistoryEntry = {
  at: number;
  mode: Mode;
  summary: string;
  payload: string;
};

export function LuckyDrawWidget() {
  // Entries live in LOCAL state — lists can be large, don't put them in the URL.
  const [text, setText] = useState(SAMPLE);

  // Shareable knobs go in the URL.
  const [mode, setMode] = useQueryState(
    "mode",
    parseAsString.withDefault("winners").withOptions({ history: "replace" }),
  );
  const [winnerCount, setWinnerCount] = useQueryState(
    "n",
    parseAsInteger.withDefault(1).withOptions({ history: "replace" }),
  );
  const [teamCount, setTeamCount] = useQueryState(
    "g",
    parseAsInteger.withDefault(2).withOptions({ history: "replace" }),
  );
  const [speedIdx, setSpeedIdx] = useQueryState(
    "sp",
    parseAsInteger.withDefault(2).withOptions({ history: "replace" }),
  );

  // Local toggles.
  const [withoutReplacement, setWithoutReplacement] = useState(true);
  const [dedupe, setDedupe] = useState(false);
  const [sequential, setSequential] = useState(false);

  // Results state.
  const [winners, setWinners] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[][]>([]);
  const [revealed, setRevealed] = useState(0); // for sequential reveal
  const [scramble, setScramble] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [resultMode, setResultMode] = useState<Mode>("winners");
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const timers = useRef<number[]>([]);

  const m = (mode as Mode) ?? "winners";
  const speed = SPEEDS[Math.min(Math.max(speedIdx, 0), SPEEDS.length - 1)];
  const speedSafe = Math.min(Math.max(speedIdx, 0), SPEEDS.length - 1);

  const rawEntries = parseEntries(text);
  const entries = dedupe ? dedupeEntries(rawEntries) : rawEntries;
  const entryCount = entries.length;
  const dupesRemoved = rawEntries.length - entries.length;

  const maxWinners = Math.max(1, entryCount);
  const effectiveCount = Math.min(Math.max(winnerCount, 1), maxWinners);
  const tooFew = withoutReplacement && winnerCount > entryCount && entryCount > 0;

  const maxTeams = Math.max(2, entryCount);
  const effectiveTeams = Math.min(Math.max(teamCount, 2), maxTeams);
  const teamsTooMany = teamCount > entryCount && entryCount > 0;

  // Clean up any running timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((id) => clearTimeout(id));
    };
  }, []);

  const clearTimers = () => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current = [];
  };

  const pushHistory = (entry: HistoryEntry) => {
    setHistory((h) => [entry, ...h].slice(0, 6));
  };

  // Settle the final result for the current mode (called from a timer callback,
  // so randomness never runs during render).
  const settle = () => {
    setSpinning(false);
    setScramble([]);
    setResultMode(m);

    if (m === "winners") {
      const picked = pickWinners(entries, effectiveCount, withoutReplacement);
      setWinners(picked);
      if (sequential && speedSafe > 0 && picked.length > 1) {
        setRevealed(1);
        const gap = SEQ_GAP[speedSafe];
        picked.forEach((_, i) => {
          if (i === 0) return;
          const id = window.setTimeout(() => setRevealed(i + 1), gap * i);
          timers.current.push(id);
        });
      } else {
        setRevealed(picked.length);
      }
      pushHistory({
        at: Date.now(),
        mode: "winners",
        summary: `${picked.length} winner${picked.length > 1 ? "s" : ""}`,
        payload: picked.join("\n"),
      });
    } else if (m === "shuffle") {
      const ordered = shuffle(entries);
      setOrder(ordered);
      setRevealed(ordered.length);
      pushHistory({
        at: Date.now(),
        mode: "shuffle",
        summary: `Shuffled ${ordered.length}`,
        payload: ordered.map((x, i) => `${i + 1}. ${x}`).join("\n"),
      });
    } else {
      const split = splitTeams(entries, effectiveTeams);
      setTeams(split);
      setRevealed(split.length);
      pushHistory({
        at: Date.now(),
        mode: "teams",
        summary: `${split.length} teams`,
        payload: teamsToText(split),
      });
    }
  };

  const run = () => {
    if (entryCount === 0 || spinning) return;
    clearTimers();
    setWinners([]);
    setOrder([]);
    setTeams([]);
    setRevealed(0);

    // Number of scramble slots to animate.
    const slots =
      m === "winners" ? effectiveCount : m === "teams" ? effectiveTeams : 1;

    if (speed.tick === 0 || speed.dur === 0) {
      // Instant: settle on the next tick (still a timer callback, not render).
      const id = window.setTimeout(settle, 0);
      timers.current.push(id);
      setSpinning(true);
      return;
    }

    setSpinning(true);
    let elapsed = 0;
    const tickOnce = () => {
      setScramble(Array.from({ length: slots }, () => randomEntry(entries)));
      elapsed += speed.tick;
      if (elapsed >= speed.dur) {
        settle();
        return;
      }
      const id = window.setTimeout(tickOnce, speed.tick);
      timers.current.push(id);
    };
    const id = window.setTimeout(tickOnce, speed.tick);
    timers.current.push(id);
  };

  const hasResult =
    resultMode === "winners"
      ? winners.length > 0
      : resultMode === "shuffle"
        ? order.length > 0
        : teams.length > 0;

  const copyValue =
    resultMode === "winners"
      ? winners.join("\n")
      : resultMode === "shuffle"
        ? order.map((x, i) => `${i + 1}. ${x}`).join("\n")
        : teamsToText(teams);

  const stageLabel = spinning
    ? "Working…"
    : !hasResult
      ? "Stage"
      : resultMode === "winners"
        ? `Winner${winners.length > 1 ? "s" : ""} · ${winners.length}`
        : resultMode === "shuffle"
          ? `Shuffled · ${order.length}`
          : `Teams · ${teams.length}`;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
      {/* ============================ CONTROLS ============================ */}
      <div className="panel registered space-y-4 p-4">
        <p className="readout">Mode</p>
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setMode(val)}
              disabled={spinning}
              className={cn(
                "h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors disabled:opacity-50",
                m === val ? "bg-accent text-[#070806]" : "text-muted hover:text-ink",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="readout">Entries</span>
            <span className="font-mono text-xs tabular text-muted">
              {entryCount} {entryCount === 1 ? "entry" : "entries"}
              {dupesRemoved > 0 && (
                <span className="text-faint"> · −{dupesRemoved} dup</span>
              )}
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="One entry per line…"
            className="input h-40 resize-y leading-relaxed"
          />
        </div>

        {/* Mode-specific count control */}
        {m === "winners" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="readout">Winners</span>
              <span className="font-mono text-xs tabular text-muted">
                {effectiveCount}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={maxWinners}
              value={effectiveCount}
              onChange={(e) => setWinnerCount(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
          </div>
        )}

        {m === "teams" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="readout">Teams</span>
              <span className="font-mono text-xs tabular text-muted">
                {effectiveTeams}
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={maxTeams}
              value={effectiveTeams}
              onChange={(e) => setTeamCount(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
          </div>
        )}

        {/* Animation speed */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="readout">Reveal speed</span>
            <span className="font-mono text-xs tabular text-muted">
              {speed.label}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={SPEEDS.length - 1}
            value={speedSafe}
            onChange={(e) => setSpeedIdx(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-2">
          {m === "winners" && (
            <Toggle
              label="No repeats"
              active={withoutReplacement}
              onClick={() => setWithoutReplacement((v) => !v)}
            />
          )}
          {m === "winners" && (
            <Toggle
              label="Sequential reveal"
              active={sequential}
              onClick={() => setSequential((v) => !v)}
            />
          )}
          <Toggle
            label="Dedupe entries"
            active={dedupe}
            onClick={() => setDedupe((v) => !v)}
          />
        </div>

        {/* Inline messages */}
        {entryCount === 0 && (
          <p className="font-mono text-xs text-danger">
            Add at least one entry to {m === "teams" ? "split" : m === "shuffle" ? "shuffle" : "draw"}.
          </p>
        )}
        {m === "winners" && tooFew && (
          <p className="font-mono text-xs text-warn">
            Only {entryCount} entries — fewer than {winnerCount} requested. Will
            draw {entryCount}.
          </p>
        )}
        {m === "teams" && teamsTooMany && (
          <p className="font-mono text-xs text-warn">
            Only {entryCount} entries for {teamCount} teams — some teams will be
            empty. Capped to {entryCount}.
          </p>
        )}

        <button
          onClick={run}
          disabled={entryCount === 0 || spinning}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
        >
          <Sparkles size={16} className={spinning ? "blink" : undefined} />
          {spinning
            ? "Working…"
            : hasResult
              ? m === "winners"
                ? "Draw again"
                : m === "shuffle"
                  ? "Shuffle again"
                  : "Re-split"
              : m === "winners"
                ? "Draw"
                : m === "shuffle"
                  ? "Shuffle"
                  : "Make teams"}
        </button>
      </div>

      {/* ============================= STAGE ============================== */}
      <div className="flex flex-col gap-3">
        <div className="panel registered bg-ticks flex min-h-[280px] flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">{stageLabel}</span>
            <div className="flex items-center gap-2">
              <ShareButton />
              <CopyButton value={copyValue} label="Copy" disabled={!hasResult} />
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center p-5">
            <Stage
              spinning={spinning}
              scramble={scramble}
              mode={spinning ? m : resultMode}
              winners={winners}
              order={order}
              teams={teams}
              revealed={revealed}
              effectiveCount={effectiveCount}
              effectiveTeams={effectiveTeams}
            />
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="panel space-y-1.5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="readout inline-flex items-center gap-1.5">
                <History size={12} /> Recent draws
              </span>
              <button
                onClick={() => setHistory([])}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-faint transition-colors hover:text-danger"
              >
                <Trash2 size={11} /> Clear
              </button>
            </div>
            {history.map((h) => (
              <div
                key={h.at}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1"
              >
                <span className="readout w-[58px] shrink-0 tabular text-faint">
                  {fmtTime(h.at)}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-muted">
                  <span className="text-accent">{labelFor(h.mode)}</span> ·{" "}
                  {h.summary}
                </span>
                <CopyButton
                  value={h.payload}
                  label=""
                  className="shrink-0"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Stage ---------------------------------- */

function Stage({
  spinning,
  scramble,
  mode,
  winners,
  order,
  teams,
  revealed,
  effectiveCount,
  effectiveTeams,
}: {
  spinning: boolean;
  scramble: string[];
  mode: Mode;
  winners: string[];
  order: string[];
  teams: string[][];
  revealed: number;
  effectiveCount: number;
  effectiveTeams: number;
}) {
  // While spinning, show scramble cards in the slot grid.
  if (spinning) {
    if (mode === "shuffle") {
      return (
        <WinnerCard name={scramble[0] ?? "…"} spinning solo />
      );
    }
    if (mode === "teams") {
      return (
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: effectiveTeams }, (_, i) => (
            <div
              key={i}
              className="registered rounded-[var(--radius)] border border-edge bg-base/60 p-3"
            >
              <p className="readout mb-1">Team {i + 1}</p>
              <p className="truncate font-mono text-sm text-muted">
                {scramble[i] ?? "…"}
              </p>
            </div>
          ))}
        </div>
      );
    }
    // winners scramble
    return <WinnerGrid names={scramble} spinning />;
  }

  // Settled results.
  if (mode === "winners") {
    if (winners.length === 0) {
      return (
        <p className="font-mono text-sm text-faint">
          Press Draw to pick {effectiveCount === 1 ? "a winner" : "winners"}.
        </p>
      );
    }
    return <WinnerGrid names={winners.slice(0, revealed)} />;
  }

  if (mode === "shuffle") {
    if (order.length === 0) {
      return (
        <p className="font-mono text-sm text-faint">
          Press Shuffle to randomize the full list.
        </p>
      );
    }
    return (
      <ol className="max-h-[360px] w-full space-y-1 overflow-auto">
        {order.map((name, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-edge bg-base/60 px-3 py-2 rise"
            style={{ animationDelay: `${Math.min(i * 28, 420)}ms` }}
          >
            <span className="readout w-7 shrink-0 tabular text-accent">
              {i + 1}
            </span>
            <span className="flex-1 truncate font-mono text-sm text-ink">
              {name}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  // teams
  if (teams.length === 0) {
    return (
      <p className="font-mono text-sm text-faint">
        Press Make teams to split everyone into groups.
      </p>
    );
  }
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {teams.map((team, i) => (
        <div
          key={i}
          className="registered rounded-[var(--radius)] border border-accent bg-base shadow-accent rise"
          style={{ animationDelay: `${Math.min(i * 70, 420)}ms` }}
        >
          <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
            <span className="readout text-accent">Team {i + 1}</span>
            <span className="font-mono text-[11px] tabular text-muted">
              {team.length}
            </span>
          </div>
          <ul className="space-y-0.5 p-3">
            {team.length === 0 ? (
              <li className="font-mono text-xs text-faint">— empty —</li>
            ) : (
              team.map((name, j) => (
                <li key={j} className="truncate font-mono text-sm text-ink">
                  {name}
                </li>
              ))
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function WinnerGrid({
  names,
  spinning,
}: {
  names: string[];
  spinning?: boolean;
}) {
  if (names.length === 0) return null;
  return (
    <ul
      className={cn(
        "w-full",
        names.length > 1
          ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
          : "space-y-3",
      )}
    >
      {names.map((name, i) => (
        <li key={i}>
          <WinnerCard name={name} spinning={spinning} solo={names.length === 1} />
        </li>
      ))}
    </ul>
  );
}

function WinnerCard({
  name,
  spinning,
  solo,
}: {
  name: string;
  spinning?: boolean;
  solo?: boolean;
}) {
  return (
    <div
      className={cn(
        "registered relative flex min-h-[72px] items-center justify-center rounded-[var(--radius)] border px-4 py-3 text-center",
        spinning ? "border-edge bg-base/60" : "border-accent bg-base shadow-accent rise",
      )}
    >
      <span
        className={cn(
          "font-display font-semibold tracking-tight break-words",
          solo ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl",
          spinning ? "text-muted" : "text-accent glow",
        )}
      >
        {name || "…"}
      </span>
    </div>
  );
}

/* ------------------------------- Toggle --------------------------------- */

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 font-mono text-xs transition-colors",
        active ? "border-accent text-accent" : "border-edge text-muted hover:text-ink",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-faint")}
      />
      {label}
    </button>
  );
}

/* ------------------------------- helpers -------------------------------- */

function teamsToText(teams: string[][]): string {
  return teams
    .map((team, i) => `Team ${i + 1}\n${team.map((n) => `  ${n}`).join("\n")}`)
    .join("\n\n");
}

function labelFor(mode: Mode): string {
  return mode === "winners" ? "Draw" : mode === "shuffle" ? "Shuffle" : "Teams";
}

function fmtTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
