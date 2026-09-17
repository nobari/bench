"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsInteger, parseAsString } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { Minus, Plus } from "lucide-react";
import { CIRCLE_MAJOR, keyDistance, keyInfo, transposeText, type Accidentals, type Mode } from "@/lib/tools/audio/music";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const SAMPLE = `[Verse]
G          D          Em         C
Country roads, take me home
G          D          C          G
To the place I belong

[Chorus]
G     D     Em    C
Bm/D  G/B   Am7   D7sus4`;

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const KEY_NAMES = [...CIRCLE_MAJOR].sort((a, b) => a.localeCompare(b));

function readInitial(): string {
  if (typeof window === "undefined") return SAMPLE;
  const h = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("i");
  if (h) {
    try {
      return decompressFromEncodedURIComponent(h) || SAMPLE;
    } catch {
      /* fall through */
    }
  }
  return new URLSearchParams(window.location.search).get("i") ?? SAMPLE;
}

export function TransposerWidget() {
  const [semitones, setSemitones] = useQueryState("n", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [prefer, setPrefer] = useQueryState("p", parseAsString.withDefault("auto").withOptions({ history: "replace" }));
  const [capo, setCapo] = useQueryState("capo", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [fromKey, setFromKey] = useQueryState("from", parseAsString.withDefault("").withOptions({ history: "replace" }));
  const [mode, setMode] = useQueryState("mode", parseAsString.withDefault("major").withOptions({ history: "replace" }));
  const [onlyChords, setOnlyChords] = useQueryState("all", parseAsInteger.withDefault(0).withOptions({ history: "replace" }));
  const [text, setText] = useState(readInitial);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (text && text !== SAMPLE) h.set("i", compressToEncodedURIComponent(text));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h.size ? `#${h}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [text]);

  const pref = (prefer === "sharp" || prefer === "flat" ? prefer : "auto") as Accidentals | "auto";
  const m = (mode === "minor" ? "minor" : "major") as Mode;
  const n = ((semitones % 12) + 12) % 12;
  const shown = n > 6 ? n - 12 : n;
  const output = transposeText(text, semitones, pref, !onlyChords);
  const capoOutput = capo > 0 ? transposeText(output, -capo, pref, !onlyChords) : null;
  const from = fromKey ? keyInfo(fromKey, m, pref) : null;
  const toTonic = from ? transposeText(from.tonic, semitones, pref, false) : null;
  const to = toTonic ? keyInfo(toTonic, m, pref) : null;
  const capoKey = to && capo > 0 ? keyInfo(transposeText(to.tonic, -capo, pref, false), m, pref) : null;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-3 p-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSemitones(semitones - 1)} aria-label="Down a semitone" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent">
            <Minus size={14} />
          </button>
          <span className="w-16 text-center font-mono text-[15px] text-ink">
            {shown > 0 ? "+" : ""}
            {shown} st
          </span>
          <button type="button" onClick={() => setSemitones(semitones + 1)} aria-label="Up a semitone" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
          from
          <select value={fromKey} onChange={(e) => setFromKey(e.target.value || null)} className={SEL} aria-label="From key">
            <option value="">key…</option>
            {KEY_NAMES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select value={m} onChange={(e) => setMode(e.target.value === "major" ? null : e.target.value)} className={SEL} aria-label="Mode">
            <option value="major">major</option>
            <option value="minor">minor</option>
          </select>
          to
          <select
            value={to?.tonic ?? ""}
            onChange={(e) => {
              if (!fromKey || !e.target.value) return;
              const d = keyDistance(fromKey, e.target.value);
              if (d !== null) setSemitones(d);
            }}
            disabled={!fromKey}
            className={SEL}
            aria-label="To key"
          >
            <option value="">key…</option>
            {KEY_NAMES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(["auto", "sharp", "flat"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPrefer(p === "auto" ? null : p)} className={cn("h-7 rounded-[3px] px-2.5 text-[12.5px]", pref === p ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink")}>
              {p === "auto" ? "Auto" : p === "sharp" ? "♯" : "♭"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          Capo
          <select value={capo} onChange={(e) => setCapo(Number(e.target.value) || null)} className={SEL}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => (
              <option key={f} value={f}>
                {f === 0 ? "none" : `fret ${f}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <input type="checkbox" checked={!!onlyChords} onChange={(e) => setOnlyChords(e.target.checked ? 1 : null)} className="accent-[var(--accent)]" />
          Transpose every line
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Chords {from ? `in ${from.label}` : ""}</span>
            <button type="button" onClick={() => setText("")} className="text-[12px] text-faint hover:text-danger">
              Clear
            </button>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="Paste a chord sheet: chord lines above lyrics, or a bare progression like  Am F C G" className="min-h-[260px] flex-1 resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none" />
        </div>
        <div className="panel flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Transposed {to ? `to ${to.label}` : shown ? `${shown > 0 ? "+" : ""}${shown} st` : ""}</span>
            <CopyButton value={output} label="Copy" className="h-7 px-2.5 text-[12px]" />
          </div>
          <pre className="min-h-[260px] flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[13px] leading-relaxed text-ink">{output}</pre>
          {capoOutput !== null && (
            <div className="border-t border-edge">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="readout">
                  With a capo on fret {capo}, play these shapes{capoKey ? ` (${capoKey.label} shapes)` : ""}
                </span>
                <CopyButton value={capoOutput} label="Copy" className="h-7 px-2.5 text-[12px]" />
              </div>
              <pre className="overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[13px] leading-relaxed text-ink">{capoOutput}</pre>
            </div>
          )}
        </div>
      </div>

      {(from || to) && (
        <div className="grid gap-3 md:grid-cols-2">
          {[from, to].filter((k): k is NonNullable<typeof k> => !!k).map((k, i) => (
            <div key={i} className="panel p-3 text-[13px]">
              <span className="readout">{i === 0 ? "From" : "To"} · {k.label}</span>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-faint">Scale</dt>
                <dd className="font-mono text-ink">{k.notes.join("  ")}</dd>
                <dt className="text-faint">Key signature</dt>
                <dd className="text-ink">{k.signatureLabel}</dd>
                <dt className="text-faint">Relative</dt>
                <dd className="text-ink">{k.relative.label}</dd>
                <dt className="text-faint">Parallel</dt>
                <dd className="text-ink">{k.parallel.label}</dd>
                <dt className="text-faint">Diatonic chords</dt>
                <dd className="font-mono text-ink">{k.chords.map((c) => `${c.degree} ${c.chord}`).join("  ")}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
