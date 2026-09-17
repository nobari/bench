"use client";

import { useState } from "react";
import { useQueryState, parseAsFloat, parseAsInteger } from "nuqs";
import {
  BITRATE_PRESETS,
  amplitudeToDb,
  bitDepthDynamicRange,
  centsToRatio,
  dbToAmplitude,
  dbToPower,
  dbuToVolts,
  dbvToVolts,
  durationSeconds,
  fmt,
  formatBytes,
  formatDuration,
  intervalName,
  loudnessRatio,
  nearestJust,
  pcmBitrate,
  powerToDb,
  ratioToSemitones,
  semitonesToRatio,
  sizeBytes,
  splAtDistance,
  voltsToDbu,
  voltsToDbv,
} from "@/lib/tools/audio/music";
import { SAMPLE_RATES } from "@/lib/tools/audio/convert";
import { cn } from "@/lib/utils";

const INPUT = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[13px] text-ink outline-none focus:border-accent";
const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";

function KV({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="font-mono text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------- decibel */

function Decibel() {
  const [db, setDb] = useQueryState("db", parseAsFloat.withDefault(-6).withOptions({ history: "replace", throttleMs: 100 }));
  const [amp, setAmp] = useState("");
  const [pow, setPow] = useState("");
  const [level, setLevel] = useState<{ kind: "dbu" | "dbv" | "v"; value: string }>({ kind: "dbu", value: "4" });
  const [bits, setBits] = useState(16);
  const [spl, setSpl] = useState({ spl: "94", from: "1", to: "4" });

  const ampDb = Number(amp) > 0 ? amplitudeToDb(Number(amp)) : null;
  const powDb = Number(pow) > 0 ? powerToDb(Number(pow)) : null;
  const lv = Number(level.value);
  const volts = level.kind === "v" ? lv : level.kind === "dbu" ? dbuToVolts(lv) : dbvToVolts(lv);
  const splTo = splAtDistance(Number(spl.spl), Number(spl.from), Number(spl.to));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <span className="readout">Decibels ↔ ratios</span>
        <label className="block text-[12.5px] text-muted">
          Level difference (dB)
          <input type="number" step={0.1} value={db} onChange={(e) => setDb(Number(e.target.value) === -6 ? null : Number(e.target.value))} className={cn(INPUT, "mt-1 h-10 text-[16px]")} />
        </label>
        <KV
          rows={[
            ["Amplitude / voltage ratio", `×${fmt(dbToAmplitude(db), 4)}`],
            ["Power ratio", `×${fmt(dbToPower(db), 4)}`],
            ["Perceived loudness", `×${fmt(loudnessRatio(db), 3)} (10 dB ≈ twice as loud)`],
            ["Gain as %", `${fmt(dbToAmplitude(db) * 100, 2)}%`],
          ]}
        />
        <div className="grid grid-cols-2 gap-2 border-t border-edge pt-3">
          <label className="text-[12.5px] text-muted">
            Amplitude ratio → dB
            <input value={amp} onChange={(e) => setAmp(e.target.value)} placeholder="0.5" className={cn(INPUT, "mt-1")} />
            <span className="mt-1 block font-mono text-ink">{ampDb !== null ? `${fmt(ampDb, 3)} dB` : "—"}</span>
          </label>
          <label className="text-[12.5px] text-muted">
            Power ratio → dB
            <input value={pow} onChange={(e) => setPow(e.target.value)} placeholder="2" className={cn(INPUT, "mt-1")} />
            <span className="mt-1 block font-mono text-ink">{powDb !== null ? `${fmt(powDb, 3)} dB` : "—"}</span>
          </label>
        </div>
      </div>
      <div className="space-y-3">
        <div className="panel space-y-3 p-3">
          <span className="readout">dBu · dBV · volts</span>
          <div className="flex gap-2">
            <select value={level.kind} onChange={(e) => setLevel((l) => ({ ...l, kind: e.target.value as "dbu" | "dbv" | "v" }))} className={SEL} aria-label="Unit">
              <option value="dbu">dBu</option>
              <option value="dbv">dBV</option>
              <option value="v">volts RMS</option>
            </select>
            <input value={level.value} onChange={(e) => setLevel((l) => ({ ...l, value: e.target.value }))} className={INPUT} aria-label="Level" />
          </div>
          {Number.isFinite(lv) && volts > 0 && (
            <KV
              rows={[
                ["dBu", `${fmt(voltsToDbu(volts), 3)} dBu`],
                ["dBV", `${fmt(voltsToDbv(volts), 3)} dBV`],
                ["Volts RMS", `${fmt(volts, 4)} V`],
                ["Volts peak", `${fmt(volts * Math.SQRT2, 4)} V`],
              ]}
            />
          )}
          <p className="text-[12px] text-faint">+4 dBu is pro line level (1.228 V), −10 dBV consumer line level (0.316 V); dBu = dBV + 2.22.</p>
        </div>
        <div className="panel space-y-2 p-3">
          <span className="readout">Bit depth → dynamic range</span>
          <div className="flex items-center gap-2 text-[13px]">
            <select value={bits} onChange={(e) => setBits(Number(e.target.value))} className={SEL} aria-label="Bit depth">
              {[8, 12, 16, 20, 24, 32].map((b) => (
                <option key={b} value={b}>
                  {b}-bit
                </option>
              ))}
            </select>
            <span className="font-mono text-ink">{fmt(bitDepthDynamicRange(bits), 2)} dB</span>
            <span className="text-faint">(6.02 n + 1.76)</span>
          </div>
        </div>
        <div className="panel space-y-2 p-3">
          <span className="readout">SPL at a distance (inverse square)</span>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <input value={spl.spl} onChange={(e) => setSpl((s) => ({ ...s, spl: e.target.value }))} className={cn(INPUT, "w-16")} aria-label="SPL" /> dB at
            <input value={spl.from} onChange={(e) => setSpl((s) => ({ ...s, from: e.target.value }))} className={cn(INPUT, "w-14")} aria-label="From distance" /> m →
            <input value={spl.to} onChange={(e) => setSpl((s) => ({ ...s, to: e.target.value }))} className={cn(INPUT, "w-14")} aria-label="To distance" /> m =
            <span className="font-mono text-ink">{Number.isFinite(splTo) ? `${fmt(splTo, 1)} dB` : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- pitch */

function Pitch() {
  const [st, setSt] = useQueryState("st", parseAsFloat.withDefault(7).withOptions({ history: "replace", throttleMs: 100 }));
  const [kind, setKind] = useState<"st" | "cents" | "ratio" | "speed">("st");
  const [raw, setRaw] = useState("");
  const [rates, setRates] = useState({ from: 44100, to: 48000 });

  // The URL keeps semitones; the other fields derive from it unless being edited.
  let semis = st;
  if (raw !== "" && kind !== "st") {
    const v = Number(raw);
    if (Number.isFinite(v)) semis = kind === "cents" ? v / 100 : kind === "ratio" && v > 0 ? ratioToSemitones(v) : kind === "speed" && v > 0 ? ratioToSemitones(v / 100) : st;
  }
  const ratio = semitonesToRatio(semis);
  const cents = semis * 100;
  const just = nearestJust(ratio);
  const rateShift = ratioToSemitones(rates.to / rates.from);

  const field = (k: typeof kind, label: string, value: string) => (
    <label className="text-[12.5px] text-muted">
      {label}
      <input
        value={kind === k && raw !== "" ? raw : value}
        onChange={(e) => {
          setKind(k);
          setRaw(e.target.value);
          if (k === "st" && Number.isFinite(Number(e.target.value))) setSt(Number(e.target.value) === 7 ? null : Number(e.target.value));
        }}
        onBlur={() => {
          if (kind !== "st" && raw !== "") {
            setSt(Math.round(semis * 1000) / 1000);
            setRaw("");
          }
        }}
        className={cn(INPUT, "mt-1", kind === k && "border-accent")}
      />
    </label>
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <span className="readout">Semitones ↔ cents ↔ ratio ↔ speed</span>
        <div className="grid grid-cols-2 gap-2">
          {field("st", "Semitones", fmt(semis, 3))}
          {field("cents", "Cents", fmt(cents, 1))}
          {field("ratio", "Frequency ratio", fmt(ratio, 5))}
          {field("speed", "Playback speed %", fmt(ratio * 100, 3))}
        </div>
        <KV
          rows={[
            ["Interval", intervalName(semis)],
            ["Nearest just interval", `${just.name} (${just.centsOff >= 0 ? "+" : ""}${fmt(just.centsOff, 1)} ¢ off)`],
            ["Length change", `×${fmt(1 / ratio, 4)} (${fmt((1 / ratio - 1) * 100, 2)}%)`],
            ["Example", `440 Hz → ${fmt(440 * ratio, 2)} Hz`],
          ]}
        />
      </div>
      <div className="space-y-3">
        <div className="panel space-y-2 p-3">
          <span className="readout">Playing at the wrong sample rate</span>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            Recorded at
            <select value={rates.from} onChange={(e) => setRates((r) => ({ ...r, from: Number(e.target.value) }))} className={SEL} aria-label="Recorded rate">
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString()}
                </option>
              ))}
            </select>
            played at
            <select value={rates.to} onChange={(e) => setRates((r) => ({ ...r, to: Number(e.target.value) }))} className={SEL} aria-label="Playback rate">
              {SAMPLE_RATES.map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[13px] text-muted">
            Pitch shifts <span className="font-mono text-ink">{rateShift >= 0 ? "+" : ""}{fmt(rateShift, 3)} st</span> ({fmt(rateShift * 100, 0)} ¢), speed ×{fmt(rates.to / rates.from, 4)}.
          </p>
        </div>
        <div className="panel p-3 text-[12.5px] leading-relaxed text-muted">
          <span className="readout">Quick reference</span>
          <ul className="mt-2 space-y-0.5 font-mono">
            {[1, 2, 3, 4, 5, 7, 12].map((s) => (
              <li key={s}>
                {s} st = {fmt(s * 100, 0)} ¢ = ×{fmt(semitonesToRatio(s), 4)} · {intervalName(s)}
              </li>
            ))}
            <li>100 ¢ = ×{fmt(centsToRatio(100), 4)} · 1 ¢ = ×{fmt(centsToRatio(1), 5)}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- bitrate */

function Bitrate() {
  const [sr, setSr] = useQueryState("sr", parseAsInteger.withDefault(44100).withOptions({ history: "replace" }));
  const [bd, setBd] = useQueryState("bd", parseAsInteger.withDefault(16).withOptions({ history: "replace" }));
  const [ch, setCh] = useQueryState("ch", parseAsInteger.withDefault(2).withOptions({ history: "replace" }));
  const [kbps, setKbps] = useQueryState("kbps", parseAsFloat.withDefault(320).withOptions({ history: "replace", throttleMs: 100 }));
  const [dur, setDur] = useQueryState("dur", parseAsFloat.withDefault(240).withOptions({ history: "replace", throttleMs: 100 }));
  const [sizeMb, setSizeMb] = useState("100");

  const pcm = pcmBitrate(sr, bd, ch);
  const compBps = kbps * 1000;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <span className="readout">Uncompressed PCM</span>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[12.5px] text-muted">
            Sample rate
            <select value={sr} onChange={(e) => setSr(Number(e.target.value) === 44100 ? null : Number(e.target.value))} className={cn(SEL, "mt-1 w-full")}>
              {[...SAMPLE_RATES, 176400, 192000].map((r) => (
                <option key={r} value={r}>
                  {r.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-muted">
            Bit depth
            <select value={bd} onChange={(e) => setBd(Number(e.target.value) === 16 ? null : Number(e.target.value))} className={cn(SEL, "mt-1 w-full")}>
              {[8, 16, 24, 32].map((b) => (
                <option key={b} value={b}>
                  {b}-bit
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-muted">
            Channels
            <select value={ch} onChange={(e) => setCh(Number(e.target.value) === 2 ? null : Number(e.target.value))} className={cn(SEL, "mt-1 w-full")}>
              {[1, 2, 4, 6, 8].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <KV
          rows={[
            ["Bitrate", `${fmt(pcm / 1000, 1)} kbps (${fmt(pcm / 8 / 1024, 1)} KB/s)`],
            ["Per minute", formatBytes(sizeBytes(pcm, 60))],
            ["Per hour", formatBytes(sizeBytes(pcm, 3600))],
            ["Bytes per sample frame", `${(bd / 8) * ch}`],
            ["Nyquist limit", `${fmt(sr / 2000, 2)} kHz`],
          ]}
        />
      </div>
      <div className="space-y-3">
        <div className="panel space-y-3 p-3">
          <span className="readout">Any bitrate ↔ size ↔ duration</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12.5px] text-muted">
              Bitrate (kbps)
              <input type="number" value={kbps} onChange={(e) => setKbps(Number(e.target.value) === 320 ? null : Number(e.target.value))} className={cn(INPUT, "mt-1")} />
            </label>
            <label className="text-[12.5px] text-muted">
              Preset
              <select value="" onChange={(e) => e.target.value && setKbps(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")}>
                <option value="">choose…</option>
                {BITRATE_PRESETS.map((p) => (
                  <option key={p.label} value={p.kbps}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12.5px] text-muted">
              Duration (seconds)
              <input type="number" value={dur} onChange={(e) => setDur(Number(e.target.value) === 240 ? null : Number(e.target.value))} className={cn(INPUT, "mt-1")} />
            </label>
            <label className="text-[12.5px] text-muted">
              Or a size (MB)
              <input value={sizeMb} onChange={(e) => setSizeMb(e.target.value)} className={cn(INPUT, "mt-1")} />
            </label>
          </div>
          <KV
            rows={[
              [`${formatDuration(dur)} at ${fmt(kbps, 1)} kbps`, formatBytes(sizeBytes(compBps, dur))],
              ["Per minute", formatBytes(sizeBytes(compBps, 60))],
              ["Per hour", formatBytes(sizeBytes(compBps, 3600))],
              [`${sizeMb || 0} MB lasts`, formatDuration(durationSeconds(Number(sizeMb) * 1024 * 1024, compBps))],
              ["vs. this PCM", `${fmt(compBps / pcm * 100, 1)}% of ${fmt(pcm / 1000, 0)} kbps`],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

export function AudioUnitsWidget({ preset = "decibel" }: { preset?: "decibel" | "pitch" | "bitrate" }) {
  if (preset === "pitch") return <Pitch />;
  if (preset === "bitrate") return <Bitrate />;
  return <Decibel />;
}
