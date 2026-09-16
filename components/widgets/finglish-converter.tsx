"use client";

import { useMemo, useState } from "react";
import { useQueryState, parseAsString, parseAsBoolean } from "nuqs";
import { X, RotateCcw, Info } from "lucide-react";
import {
  transliterateFinglish,
  FINGLISH_DICT_SIZE,
  type FinglishToken,
} from "@/lib/tools/text/finglish";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

const FA_FONT =
  "Vazirmatn, 'Noto Sans Arabic', 'Segoe UI', Tahoma, 'Geeza Pro', system-ui, sans-serif";

/** "3.1,7.2" ⇄ Map<wordIndex, candidateIndex> */
function parseOverrides(s: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const part of s.split(",")) {
    const [a, b] = part.split(".");
    const i = Number(a);
    const c = Number(b);
    if (Number.isInteger(i) && Number.isInteger(c) && i >= 0 && c > 0) m.set(i, c);
  }
  return m;
}
function serializeOverrides(m: Map<number, number>): string {
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([i, c]) => `${i}.${c}`)
    .join(",");
}

interface Placed {
  token: FinglishToken;
  /** Index among word tokens (−1 for text). */
  wordIndex: number;
  /** Chosen candidate index (0 = best). */
  choice: number;
  text: string;
}

const LEGEND: [string, string][] = [
  ["kh", "خ"], ["gh / q", "ق غ"], ["sh", "ش"], ["ch", "چ"], ["zh", "ژ"],
  ["aa / â", "آ ا"], ["oo / u", "و"], ["ee / i", "ی"], ["'", "ع"], ["e (final)", "ه"],
];

export function FinglishConverterWidget() {
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [zwnj, setZwnj] = useQueryState(
    "z",
    parseAsBoolean.withDefault(true).withOptions({ history: "replace" }),
  );
  const [digits, setDigits] = useQueryState(
    "d",
    parseAsBoolean.withDefault(true).withOptions({ history: "replace" }),
  );
  const [overridesRaw, setOverridesRaw] = useQueryState(
    "o",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [selected, setSelected] = useState<number | null>(null);

  const overrides = useMemo(() => parseOverrides(overridesRaw), [overridesRaw]);

  const placed = useMemo<Placed[]>(() => {
    const tokens = transliterateFinglish(input, { zwnj, persianDigits: digits });
    let wi = 0;
    return tokens.map((token) => {
      if (token.kind !== "word" || !token.word) return { token, wordIndex: -1, choice: 0, text: token.text };
      const idx = wi++;
      const want = overrides.get(idx) ?? 0;
      const choice = want < token.word.candidates.length ? want : 0;
      return { token, wordIndex: idx, choice, text: token.word.candidates[choice] ?? token.word.best };
    });
  }, [input, zwnj, digits, overrides]);

  const output = useMemo(() => placed.map((p) => p.text).join(""), [placed]);
  const words = placed.filter((p) => p.wordIndex >= 0);
  const guessed = words.filter((p) => !p.token.word?.known).length;
  const current = selected !== null ? words.find((p) => p.wordIndex === selected) ?? null : null;

  const choose = (wordIndex: number, candidate: number) => {
    const next = new Map(overrides);
    if (candidate === 0) next.delete(wordIndex);
    else next.set(wordIndex, candidate);
    setOverridesRaw(serializeOverrides(next) || null);
  };

  const clearAll = () => {
    setInput("");
    setOverridesRaw(null);
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <Toggle on={zwnj} onChange={setZwnj} label="نیم‌فاصله" hint="Join prefixes and suffixes with a zero-width non-joiner (می‌رم, کتاب‌ها)" />
        <Toggle on={digits} onChange={setDigits} label="۱۲۳ ؟ ،" hint="Persian digits and punctuation" />
        <span className="ml-auto readout hidden sm:inline">
          {FINGLISH_DICT_SIZE.toLocaleString()}-word dictionary · verbs · affixes · phonetic fallback
        </span>
      </div>

      {/* io grid */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Finglish</span>
            {input && (
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="salam, khoobi? man emrooz miram daneshgah…"
            className="min-h-[260px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{[...input].length} ch</span>
            <span>{words.length} w</span>
          </div>
        </div>

        {/* output */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">فارسی</span>
            <div className="flex items-center gap-2">
              <ShareButton />
              <CopyButton value={output} />
            </div>
          </div>
          <div
            dir="rtl"
            lang="fa"
            style={{ fontFamily: FA_FONT }}
            className="min-h-[260px] flex-1 whitespace-pre-wrap break-words p-3 text-[17px] leading-[2] text-ink"
          >
            {placed.length === 0 ? (
              <span dir="ltr" className="font-mono text-sm text-faint">
                Persian text appears here… tap any word to pick another spelling.
              </span>
            ) : (
              placed.map((p, i) =>
                p.wordIndex < 0 ? (
                  <span key={i}>{p.text}</span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelected(p.wordIndex === selected ? null : p.wordIndex)}
                    title={`${p.token.word?.source} · ${p.token.word?.candidates.length} spellings`}
                    className={cn(
                      "rounded-[3px] px-0.5 underline decoration-1 underline-offset-[6px] transition-colors hover:bg-raised",
                      !p.token.word?.known && "decoration-dotted decoration-warn/70",
                      p.token.word?.known && p.choice === 0 && "decoration-transparent",
                      p.choice > 0 && "decoration-accent decoration-solid",
                      selected === p.wordIndex && "bg-raised text-accent",
                    )}
                  >
                    {p.text}
                  </button>
                ),
              )
            )}
          </div>
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{[...output].length} ch</span>
            {guessed > 0 && (
              <span className="text-warn">{guessed} guessed</span>
            )}
            {overrides.size > 0 && (
              <button
                onClick={() => setOverridesRaw(null)}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                <RotateCcw size={11} /> reset {overrides.size} pick{overrides.size > 1 ? "s" : ""}
              </button>
            )}
            <span className="ml-auto">
              {words.length ? `${words.length - guessed} / ${words.length} recognised` : " "}
            </span>
          </div>
        </div>
      </div>

      {/* alternatives strip */}
      {current && current.token.word && (
        <div className="panel flex flex-wrap items-center gap-2 p-2">
          <span className="readout px-1">
            <span className="font-mono text-ink">{current.token.word.source}</span>
            <span className="mx-1.5 text-faint">→</span>
            {current.token.word.known ? "spellings" : "phonetic guesses"}
          </span>
          <div dir="rtl" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {current.token.word.candidates.map((c, ci) => (
              <button
                key={c}
                onClick={() => choose(current.wordIndex, ci)}
                lang="fa"
                style={{ fontFamily: FA_FONT }}
                className={cn(
                  "rounded-[var(--radius-sm)] px-2.5 py-1 text-[15px] transition-colors",
                  ci === current.choice
                    ? "bg-accent text-[#070806]"
                    : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSelected(null)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 font-mono text-xs text-faint hover:text-ink"
          >
            <X size={12} /> Close
          </button>
        </div>
      )}

      {/* legend */}
      <details className="group panel px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 readout">
          <Info size={12} /> Spelling guide
          <span className="ml-auto text-faint group-open:hidden">show</span>
        </summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-edge pt-2">
          {LEGEND.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
              {k}
              <span className="text-faint">→</span>
              <span lang="fa" dir="rtl" style={{ fontFamily: FA_FONT }} className="text-sm text-ink">
                {v}
              </span>
            </span>
          ))}
          <p className="basis-full text-xs leading-relaxed text-faint">
            Short vowels (a, e, o) are not written in Persian; write long â as <span className="font-mono text-muted">aa</span>. Dotted words
            were not in the dictionary and are spelled phonetically — tap them to choose ص/ث, ط, ض/ظ, ح or غ variants.
          </p>
        </div>
      </details>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={hint}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 font-mono text-xs transition-colors",
        on ? "border-accent/60 text-accent" : "border-edge text-muted hover:text-ink",
      )}
    >
      <span
        className={cn(
          "relative inline-block h-3.5 w-6 rounded-full transition-colors",
          on ? "bg-accent" : "bg-edge-bright",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-base transition-all",
            on ? "left-3" : "left-0.5",
          )}
        />
      </span>
      <span lang="fa" style={{ fontFamily: FA_FONT }}>{label}</span>
    </button>
  );
}
