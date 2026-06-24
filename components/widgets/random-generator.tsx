"use client";

import { useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { Dices } from "lucide-react";
import {
  generateIntegers,
  generateDecimals,
  generateStrings,
  generateBytes,
  rollDice,
  flipCoins,
  type Charset,
} from "@/lib/tools/generators/random";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

type Mode = "integers" | "decimals" | "strings" | "bytes" | "dice" | "coin";

const MODES: [Mode, string][] = [
  ["integers", "Integers"],
  ["decimals", "Decimals"],
  ["strings", "Strings"],
  ["bytes", "Bytes"],
  ["dice", "Dice"],
  ["coin", "Coin"],
];

const CHARSETS: [Charset, string][] = [
  ["alphanumeric", "Alphanumeric"],
  ["hex", "Hex"],
  ["letters", "Letters"],
  ["digits", "Digits"],
];

interface Result {
  lines: string[];
  /** plain text copied by "Copy all" */
  copyText: string;
  /** optional summary line shown above the list */
  summary?: string;
}

export function RandomGeneratorWidget() {
  const [mode, setMode] = useQueryState(
    "mode",
    parseAsString.withDefault("integers").withOptions({ history: "replace" }),
  );

  // Integers
  const [intMin, setIntMin] = useState(1);
  const [intMax, setIntMax] = useState(100);
  const [intCount, setIntCount] = useState(5);
  const [intUnique, setIntUnique] = useState(false);

  // Decimals
  const [decMin, setDecMin] = useState(0);
  const [decMax, setDecMax] = useState(1);
  const [decPlaces, setDecPlaces] = useState(4);
  const [decCount, setDecCount] = useState(5);

  // Strings
  const [strLen, setStrLen] = useState(16);
  const [strCharset, setStrCharset] = useState<Charset>("alphanumeric");
  const [strCount, setStrCount] = useState(5);

  // Bytes
  const [byteN, setByteN] = useState(16);

  // Dice
  const [diceN, setDiceN] = useState(2);
  const [diceM, setDiceM] = useState(6);

  // Coin
  const [coinN, setCoinN] = useState(10);

  const [result, setResult] = useState<Result | null>(null);

  // All generation happens in this event handler (crypto is impure).
  const run = () => {
    const m = mode as Mode;
    if (m === "integers") {
      const nums = generateIntegers(intMin, intMax, intCount, intUnique);
      setResult({ lines: nums.map(String), copyText: nums.join("\n") });
    } else if (m === "decimals") {
      const nums = generateDecimals(decMin, decMax, decPlaces, decCount);
      setResult({ lines: nums, copyText: nums.join("\n") });
    } else if (m === "strings") {
      const strs = generateStrings(strLen, strCharset, strCount);
      setResult({ lines: strs, copyText: strs.join("\n") });
    } else if (m === "bytes") {
      const { hex, base64 } = generateBytes(byteN);
      setResult({
        lines: [`hex     ${hex}`, `base64  ${base64}`],
        copyText: `hex: ${hex}\nbase64: ${base64}`,
      });
    } else if (m === "dice") {
      const { rolls, sum, notation } = rollDice(diceN, diceM);
      setResult({
        lines: rolls.map((r, i) => `Die ${i + 1}: ${r}`),
        copyText: rolls.join(", "),
        summary: `${notation} → sum ${sum}`,
      });
    } else {
      const { flips, heads, tails } = flipCoins(coinN);
      setResult({
        lines: [flips.join(" ")],
        copyText: flips.join(" "),
        summary: `${heads} heads · ${tails} tails`,
      });
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      {/* controls */}
      <div className="panel registered space-y-4 p-4">
        <p className="readout">Mode</p>

        <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setMode(val)}
              className={cn(
                "h-8 rounded-[3px] font-mono text-xs transition-colors",
                mode === val
                  ? "bg-accent text-[#070806]"
                  : "text-muted hover:text-ink",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === "integers" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Min" value={intMin} onChange={setIntMin} />
              <NumField label="Max" value={intMax} onChange={setIntMax} />
            </div>
            <NumField label="Count" value={intCount} min={1} onChange={setIntCount} />
            <div className="flex gap-2">
              <Toggle
                label="Unique (no repeats)"
                active={intUnique}
                onClick={() => setIntUnique((v) => !v)}
              />
            </div>
          </>
        )}

        {mode === "decimals" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Min" value={decMin} onChange={setDecMin} step="any" />
              <NumField label="Max" value={decMax} onChange={setDecMax} step="any" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="Places"
                value={decPlaces}
                min={0}
                max={10}
                onChange={setDecPlaces}
              />
              <NumField label="Count" value={decCount} min={1} onChange={setDecCount} />
            </div>
          </>
        )}

        {mode === "strings" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Length" value={strLen} min={1} onChange={setStrLen} />
              <NumField label="Count" value={strCount} min={1} onChange={setStrCount} />
            </div>
            <div>
              <p className="readout mb-1.5">Charset</p>
              <select
                value={strCharset}
                onChange={(e) => setStrCharset(e.target.value as Charset)}
                className="input"
              >
                {CHARSETS.map(([val, lbl]) => (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {mode === "bytes" && (
          <NumField
            label="Bytes"
            value={byteN}
            min={1}
            max={4096}
            onChange={setByteN}
          />
        )}

        {mode === "dice" && (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Dice (N)" value={diceN} min={1} max={100} onChange={setDiceN} />
            <NumField label="Sides (M)" value={diceM} min={2} max={1000} onChange={setDiceM} />
          </div>
        )}

        {mode === "coin" && (
          <NumField label="Coins" value={coinN} min={1} max={1000} onChange={setCoinN} />
        )}

        <button
          onClick={run}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110"
        >
          <Dices size={15} /> {mode === "dice" || mode === "coin" ? "Roll" : "Generate"}
        </button>
      </div>

      {/* output */}
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">
            Output{result ? ` · ${result.lines.length}` : ""}
          </span>
          <div className="flex items-center gap-2">
            <ShareButton />
            <CopyButton value={result?.copyText ?? ""} label="Copy all" />
          </div>
        </div>
        <div className="max-h-[440px] flex-1 overflow-auto">
          {!result ? (
            <p className="px-3 py-6 font-mono text-xs text-faint">
              Press {mode === "dice" || mode === "coin" ? "Roll" : "Generate"} to produce values.
            </p>
          ) : (
            <>
              {result.summary && (
                <div className="border-b border-edge px-3 py-2 font-mono text-sm font-semibold text-accent tabular">
                  {result.summary}
                </div>
              )}
              <div className="divide-y divide-edge">
                {result.lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <code className="flex-1 break-all select-all font-mono text-[13px] tabular text-ink">
                      {line}
                    </code>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <div>
      <p className="readout mb-1.5">{label}</p>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="input tabular"
      />
    </div>
  );
}

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
