"use client";

import { useState } from "react";
import { useQueryState, parseAsFloat, parseAsInteger } from "nuqs";
import { NOTE_VALUES, barsToSeconds, beatMs, delayTable, fmt, msToBpm, secondsToBars, tapTempo, tempoChange } from "@/lib/tools/audio/music";
import { SAMPLE_RATES } from "@/lib/tools/audio/convert";
import { cn } from "@/lib/utils";

const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[13px] text-ink outline-none focus:border-accent";
const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";

export function BpmCalculatorWidget() {
  const [bpm, setBpm] = useQueryState("bpm", parseAsFloat.withDefault(120).withOptions({ history: "replace", throttleMs: 100 }));
  const [sr, setSr] = useQueryState("sr", parseAsInteger.withDefault(44100).withOptions({ history: "replace" }));
  const [beatsPerBar, setBeatsPerBar] = useQueryState("ts", parseAsInteger.withDefault(4).withOptions({ history: "replace" }));
  const [taps, setTaps] = useState<number[]>([]);
  const [ms, setMs] = useState("500");
  const [msValue, setMsValue] = useState("1/4");
  const [bars, setBars] = useState("8");
  const [seconds, setSeconds] = useState("30");
  const [toBpm, setToBpm] = useState("128");

  const valid = Number.isFinite(bpm) && bpm > 0;
  const rows = valid ? delayTable(bpm, sr) : [];
  const tap = tapTempo(taps);
  const msBeats = NOTE_VALUES.find((v) => v.id === msValue)?.beats ?? 1;
  const msBpm = Number(ms) > 0 ? msToBpm(Number(ms), msBeats) : null;
  const barsSec = valid && Number(bars) > 0 ? barsToSeconds(Number(bars), bpm, beatsPerBar) : null;
  const secBars = valid && Number(seconds) > 0 ? secondsToBars(Number(seconds), bpm, beatsPerBar) : null;
  const change = valid && Number(toBpm) > 0 ? tempoChange(bpm, Number(toBpm)) : null;

  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12.5px] text-muted">
            Tempo (BPM)
            <input type="number" min={1} max={999} step={0.1} value={bpm} onChange={(e) => setBpm(Number(e.target.value) === 120 ? null : Number(e.target.value))} className={cn(INPUT, "mt-1 h-10 w-32 text-[18px]")} />
          </label>
          <input type="range" min={40} max={240} step={1} value={Math.min(240, Math.max(40, bpm))} onChange={(e) => setBpm(Number(e.target.value) === 120 ? null : Number(e.target.value))} className="h-1.5 min-w-[160px] flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" aria-label="Tempo" />
          <button
            type="button"
            onClick={(e) => {
              const next = [...taps, e.timeStamp].slice(-16);
              setTaps(next);
              const t = tapTempo(next);
              if (t) setBpm(Math.round(t.bpm * 10) / 10);
            }}
            className="h-10 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)]"
          >
            Tap tempo
          </button>
          <span className="text-[12.5px] text-faint">{tap ? `${tap.count} taps · ${fmt(tap.intervalMs, 0)} ms apart` : "Tap the button on the beat"}</span>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-muted">
            Sample rate
            <select value={sr} onChange={(e) => setSr(Number(e.target.value) === 44100 ? null : Number(e.target.value))} className={SEL}>
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString()} Hz
                </option>
              ))}
            </select>
          </label>
        </div>
        {valid && (
          <p className="mt-2 text-[13px] text-muted">
            One beat = <span className="font-mono text-ink">{fmt(beatMs(bpm), 2)} ms</span> · one bar of {beatsPerBar}/4 = <span className="font-mono text-ink">{fmt(beatMs(bpm) * beatsPerBar, 1)} ms</span> · beat frequency <span className="font-mono text-ink">{fmt(bpm / 60, 4)} Hz</span>
          </p>
        )}
      </div>

      {valid && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[560px] text-left font-mono text-[12.5px]">
            <thead className="text-faint">
              <tr>
                <th className="px-3 py-2 font-normal">Note value</th>
                <th className="px-3 py-2 font-normal">Straight</th>
                <th className="px-3 py-2 font-normal">Dotted</th>
                <th className="px-3 py-2 font-normal">Triplet</th>
                <th className="px-3 py-2 font-normal">Hz (LFO)</th>
                <th className="px-3 py-2 font-normal">Samples</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-edge">
                  <td className="px-3 py-1.5">
                    {r.id} <span className="text-faint">{r.label}</span>
                  </td>
                  <td className="px-3 py-1.5 tabular">{fmt(r.straightMs, 2)} ms</td>
                  <td className="px-3 py-1.5 tabular">{fmt(r.dottedMs, 2)} ms</td>
                  <td className="px-3 py-1.5 tabular">{fmt(r.tripletMs, 2)} ms</td>
                  <td className="px-3 py-1.5 tabular">{fmt(r.hz, 3)}</td>
                  <td className="px-3 py-1.5 tabular">{r.samples?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel space-y-2 p-3">
          <span className="readout">Milliseconds → BPM</span>
          <div className="flex gap-2">
            <input value={ms} onChange={(e) => setMs(e.target.value)} placeholder="500" className={INPUT} aria-label="Milliseconds" />
            <select value={msValue} onChange={(e) => setMsValue(e.target.value)} className={SEL} aria-label="Note value">
              {NOTE_VALUES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[13px] text-muted">
            {msBpm ? (
              <>
                A {msValue} note of {ms} ms means <span className="font-mono text-ink">{fmt(msBpm, 2)} BPM</span>
              </>
            ) : (
              "Enter a delay or loop length in ms."
            )}
          </p>
        </div>
        <div className="panel space-y-2 p-3">
          <span className="readout">Bars ↔ seconds</span>
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <input value={bars} onChange={(e) => setBars(e.target.value)} className={cn(INPUT, "w-16")} aria-label="Bars" />
            bars of
            <select value={beatsPerBar} onChange={(e) => setBeatsPerBar(Number(e.target.value) === 4 ? null : Number(e.target.value))} className={SEL} aria-label="Beats per bar">
              {[2, 3, 4, 5, 6, 7, 12].map((n) => (
                <option key={n} value={n}>
                  {n}/4
                </option>
              ))}
            </select>
          </div>
          <p className="text-[13px] text-muted">{barsSec !== null ? <span className="font-mono text-ink">{fmt(barsSec, 3)} s</span> : "—"}</p>
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <input value={seconds} onChange={(e) => setSeconds(e.target.value)} className={cn(INPUT, "w-16")} aria-label="Seconds" />
            seconds
          </div>
          <p className="text-[13px] text-muted">
            {secBars ? (
              <>
                = <span className="font-mono text-ink">{secBars.bars} bars {secBars.beats} beats</span>
                {secBars.remainderBeats > 0.005 ? <span className="font-mono text-faint"> +{fmt(secBars.remainderBeats, 2)}</span> : ""} ({fmt(secBars.totalBeats, 2)} beats)
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <div className="panel space-y-2 p-3">
          <span className="readout">Tempo change</span>
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            {fmt(bpm, 1)} → <input value={toBpm} onChange={(e) => setToBpm(e.target.value)} className={cn(INPUT, "w-20")} aria-label="Target BPM" /> BPM
          </div>
          {change && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-faint">Speed</dt>
              <dd className="font-mono text-ink">
                ×{fmt(change.ratio, 4)} ({change.percent >= 0 ? "+" : ""}
                {fmt(change.percent, 2)}%)
              </dd>
              <dt className="text-faint">If repitched</dt>
              <dd className="font-mono text-ink">
                {change.semitones >= 0 ? "+" : ""}
                {fmt(change.semitones, 2)} st ({fmt(change.cents, 0)} ¢)
              </dd>
              <dt className="text-faint">Length</dt>
              <dd className="font-mono text-ink">×{fmt(change.durationFactor, 4)}</dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
