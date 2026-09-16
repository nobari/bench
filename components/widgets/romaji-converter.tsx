"use client";

import { useMemo } from "react";
import { useQueryState, parseAsString, parseAsStringLiteral } from "nuqs";
import { ArrowLeftRight, Info, X } from "lucide-react";
import {
  romajiToKana,
  kanaToRomaji,
  hiraganaToKatakana,
  katakanaToHiragana,
} from "@/lib/tools/text/romaji";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const MODES = ["hira", "kata", "romaji"] as const;
const STYLES = ["hepburn", "wapuro"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABEL: Record<Mode, string> = {
  hira: "Romaji → ひらがな",
  kata: "Romaji → カタカナ",
  romaji: "かな → Romaji",
};

const JA_FONT =
  "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', Meiryo, system-ui, sans-serif";

const LEGEND: [string, string][] = [
  ["shi / si", "し"], ["chi / ti", "ち"], ["tsu / tu", "つ"], ["fu / hu", "ふ"], ["ji / zi", "じ"],
  ["kya", "きゃ"], ["nn · n'", "ん"], ["kk / tt / pp", "っ"], ["ō · ou · o-", "おう / オー"],
  ["xtsu / ltu", "っ"], ["xa / la", "ぁ"], ["wa · e · o (alone)", "は · へ · を"],
];

export function RomajiConverterWidget() {
  const [mode, setMode] = useQueryState(
    "m",
    parseAsStringLiteral(MODES).withDefault("hira").withOptions({ history: "replace" }),
  );
  const [style, setStyle] = useQueryState(
    "s",
    parseAsStringLiteral(STYLES).withDefault("hepburn").withOptions({ history: "replace" }),
  );
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );

  const output = useMemo(() => {
    if (!input) return "";
    if (mode === "romaji") return kanaToRomaji(input, style);
    return romajiToKana(input, mode === "hira" ? "hiragana" : "katakana");
  }, [input, mode, style]);

  /** The other kana script, for the secondary readout. */
  const alt = useMemo(() => {
    if (!output || mode === "romaji") return "";
    return mode === "hira" ? hiraganaToKatakana(output) : katakanaToHiragana(output);
  }, [output, mode]);

  const swap = () => {
    if (!output) return;
    setInput(output);
    setMode(mode === "romaji" ? "hira" : "romaji");
  };

  const toKana = mode !== "romaji";

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map((id) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              lang="ja"
              className={cn(
                "h-8 rounded-[3px] px-3 font-mono text-xs transition-colors",
                mode === id ? "bg-accent text-on-accent font-semibold" : "text-muted hover:text-ink",
              )}
            >
              {MODE_LABEL[id]}
            </button>
          ))}
        </div>

        {!toKana && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {(
              [
                ["hepburn", "Hepburn (tōkyō)", "Modified Hepburn — long vowels as macrons, ん as n'"],
                ["wapuro", "Wāpuro (toukyou)", "As you'd type it: long vowels spelled out, ー as -"],
              ] as const
            ).map(([id, label, hint]) => (
              <button
                key={id}
                onClick={() => setStyle(id)}
                title={hint}
                className={cn(
                  "shrink-0 rounded-[var(--radius-sm)] px-2.5 py-1.5 font-mono text-xs transition-colors",
                  style === id ? "bg-accent text-on-accent" : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={swap}
            disabled={!output}
            title="Move the output into the input and reverse the direction"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowLeftRight size={13} /> Swap
          </button>
        </div>
      </div>

      {/* io grid */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">{toKana ? "Romaji" : "Hiragana / Katakana"}</span>
            {input && (
              <button
                onClick={() => setInput("")}
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
            lang={toKana ? "en" : "ja"}
            style={toKana ? undefined : { fontFamily: JA_FONT }}
            placeholder={toKana ? "konnichiwa, watashi wa gakusei desu…" : "こんにちは、わたし は がくせい です…"}
            className={cn(
              "min-h-[260px] flex-1 resize-y bg-transparent p-3 leading-relaxed text-ink outline-none placeholder:text-faint",
              toKana ? "font-mono text-sm" : "text-base",
            )}
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{[...input].length} ch</span>
          </div>
        </div>

        {/* output */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout" lang="ja">
              {mode === "hira" ? "ひらがな" : mode === "kata" ? "カタカナ" : "Romaji"}
            </span>
            <div className="flex items-center gap-2">
              <CopyButton value={output} />
            </div>
          </div>
          <textarea
            value={output}
            readOnly
            spellCheck={false}
            lang={toKana ? "ja" : "en"}
            style={toKana ? { fontFamily: JA_FONT } : undefined}
            placeholder="Result appears here…"
            className={cn(
              "min-h-[260px] flex-1 resize-y select-all bg-transparent p-3 leading-relaxed text-ink outline-none placeholder:text-faint",
              toKana ? "text-lg" : "font-mono text-sm",
            )}
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{[...output].length} ch</span>
            {alt && (
              <span
                lang="ja"
                style={{ fontFamily: JA_FONT }}
                className="ml-auto min-w-0 truncate normal-case tracking-normal text-faint"
                title={mode === "hira" ? "Same text in katakana" : "Same text in hiragana"}
              >
                {alt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* legend */}
      <details className="group panel px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 readout">
          <Info size={12} /> Typing guide
          <span className="ml-auto text-faint group-open:hidden">show</span>
        </summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-edge pt-2">
          {LEGEND.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
              {k}
              <span className="text-faint">→</span>
              <span lang="ja" style={{ fontFamily: JA_FONT }} className="text-sm text-ink">
                {v}
              </span>
            </span>
          ))}
          <p className="basis-full text-xs leading-relaxed text-faint">
            Works like a Japanese IME: Hepburn, Kunrei and Nihon-shiki spellings are all accepted. In katakana mode
            <span className="font-mono text-muted"> ti</span> / <span className="font-mono text-muted">di</span> become ティ / ディ for loanwords.
            Kanji and anything unrecognised pass through unchanged.
          </p>
        </div>
      </details>
    </div>
  );
}
