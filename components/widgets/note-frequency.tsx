"use client";

import { useEffect, useRef } from "react";
import { useQueryState, parseAsString, parseAsFloat } from "nuqs";
import { Play } from "lucide-react";
import { describeFrequency, frequencyToMidi, fmt, midiToFrequency, midiToNote, noteTable, parseNote, type Accidentals } from "@/lib/tools/audio/music";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const INPUT = "h-10 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-3 font-mono text-[15px] text-ink outline-none focus:border-accent";
const TUNINGS = [415, 432, 440, 442, 443, 444];

export function NoteFrequencyWidget() {
  const [kind, setKind] = useQueryState("k", parseAsString.withDefault("note").withOptions({ history: "replace" }));
  const [value, setValue] = useQueryState("v", parseAsString.withDefault("A4").withOptions({ history: "replace", throttleMs: 150 }));
  const [a4, setA4] = useQueryState("a4", parseAsFloat.withDefault(440).withOptions({ history: "replace" }));
  const [acc, setAcc] = useQueryState("acc", parseAsString.withDefault("sharp").withOptions({ history: "replace" }));
  const ctxRef = useRef<AudioContext | null>(null);
  const prefer = (acc === "flat" ? "flat" : "sharp") as Accidentals;

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
    };
  }, []);

  // Resolve whichever field was edited last into a (fractional) MIDI number.
  let midi: number | null = null;
  let error: string | null = null;
  if (kind === "hz") {
    const hz = Number(value);
    if (Number.isFinite(hz) && hz > 0) midi = frequencyToMidi(hz, a4);
    else error = "Enter a frequency in hertz, e.g. 261.63";
  } else if (kind === "midi") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 127) midi = n;
    else error = "MIDI note numbers run from 0 (C-1) to 127 (G9)";
  } else {
    const n = parseNote(value);
    if (n !== null) midi = n;
    else error = "Enter a note like A4, C#3, Bb2 or E♭5";
  }
  const hz = midi === null ? null : midiToFrequency(midi, a4);
  const info = hz ? describeFrequency(hz, a4, prefer) : null;

  const noteText = kind === "note" ? value : info ? info.note.label : "";
  const hzText = kind === "hz" ? value : hz ? fmt(hz, 3) : "";
  const midiText = kind === "midi" ? value : midi !== null ? fmt(midi, 2) : "";

  function play() {
    if (!hz) return;
    const ctx = (ctxRef.current ??= new AudioContext());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.25);
  }

  const rows = noteTable(a4, prefer, 21, 108);
  const nearest = info?.nearest ?? -1;

  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["note", "Note", "A4"],
              ["hz", "Frequency (Hz)", "440"],
              ["midi", "MIDI note number", "69"],
            ] as const
          ).map(([k, label, placeholder]) => (
            <label key={k} className="text-[12.5px] text-muted">
              {label}
              <input
                value={k === "note" ? noteText : k === "hz" ? hzText : midiText}
                onChange={(e) => {
                  setKind(k === "note" ? null : k);
                  setValue(e.target.value);
                }}
                placeholder={placeholder}
                spellCheck={false}
                className={cn(INPUT, "mt-1", kind === k && "border-accent")}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>A4 =</span>
          <input type="number" value={a4} min={300} max={500} step={0.1} onChange={(e) => setA4(Number(e.target.value) === 440 ? null : Number(e.target.value))} className="h-7 w-20 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[12.5px] text-ink outline-none focus:border-accent" />
          <span>Hz</span>
          <div className="flex gap-1">
            {TUNINGS.map((t) => (
              <button key={t} type="button" onClick={() => setA4(t === 440 ? null : t)} className={cn("h-7 rounded-[var(--radius-sm)] px-2 font-mono text-[12px]", a4 === t ? "bg-accent font-medium text-on-accent" : "border border-edge text-muted hover:text-ink")}>
                {t}
              </button>
            ))}
          </div>
          <div className="ml-auto flex rounded-[var(--radius-sm)] border border-edge p-0.5">
            {(["sharp", "flat"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setAcc(p === "sharp" ? null : p)} className={cn("h-6 rounded-[3px] px-2 text-[12px]", prefer === p ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}>
                {p === "sharp" ? "♯" : "♭"}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      </div>

      {info && hz && midi !== null && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="panel p-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[44px] font-semibold leading-none text-ink">{info.note.label}</span>
              {Math.abs(info.cents) >= 0.5 && (
                <span className={cn("font-mono text-[14px]", Math.abs(info.cents) > 10 ? "text-warn" : "text-muted")}>
                  {info.cents > 0 ? "+" : ""}
                  {info.cents.toFixed(1)} ¢
                </span>
              )}
              <button type="button" onClick={play} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 text-[12.5px] text-muted hover:border-accent hover:text-accent">
                <Play size={13} /> Play
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-faint">Frequency</dt>
              <dd className="flex items-center gap-2 font-mono text-ink">
                {fmt(hz, 3)} Hz <CopyButton value={fmt(hz, 3)} label="" className="h-6 px-1.5" />
              </dd>
              <dt className="text-faint">MIDI</dt>
              <dd className="font-mono text-ink">
                {info.nearest}
                {Math.abs(info.cents) >= 0.5 ? ` (${fmt(midi, 2)})` : ""}
              </dd>
              <dt className="text-faint">Period</dt>
              <dd className="font-mono text-ink">{fmt(info.periodMs, 3)} ms</dd>
              <dt className="text-faint">Wavelength</dt>
              <dd className="font-mono text-ink">{fmt(info.wavelengthM, 3)} m (in air, 20 °C)</dd>
              <dt className="text-faint">Octaves</dt>
              <dd className="font-mono text-[12.5px] text-muted">
                {[-24, -12, 12, 24].filter((d) => info.nearest + d >= 0 && info.nearest + d <= 127).map((d) => `${midiToNote(info.nearest + d, prefer).label} ${fmt(midiToFrequency(info.nearest + d, a4), 2)} Hz`).join(" · ")}
              </dd>
            </dl>
          </div>
          <div className="panel max-h-[420px] overflow-auto">
            <table className="w-full text-left font-mono text-[12.5px]">
              <thead className="sticky top-0 bg-surface text-faint">
                <tr>
                  <th className="px-3 py-1.5 font-normal">Note</th>
                  <th className="px-3 py-1.5 font-normal">MIDI</th>
                  <th className="px-3 py-1.5 font-normal">Hz</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.midi} className={cn(r.midi === nearest && "bg-accent-soft text-accent")}>
                    <td className="px-3 py-0.5">{r.label}</td>
                    <td className="px-3 py-0.5 tabular">{r.midi}</td>
                    <td className="px-3 py-0.5 tabular">{fmt(r.hz, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
