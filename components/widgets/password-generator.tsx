"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsInteger } from "nuqs";
import { RefreshCw } from "lucide-react";
import {
  generatePassword,
  generatePassphrase,
  charEntropy,
  passphraseEntropy,
  rateStrength,
  type CharOptions,
  type PassphraseOptions,
} from "@/lib/tools/generators/password";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

type Mode = "chars" | "phrase";

const SEPARATORS: [string, string][] = [
  ["-", "hyphen -"],
  [".", "dot ."],
  ["_", "underscore _"],
  [" ", "space"],
];

export function PasswordGeneratorWidget() {
  const [mode, setMode] = useState<Mode>("chars");

  // Character mode state
  const [length, setLength] = useQueryState(
    "len",
    parseAsInteger.withDefault(20).withOptions({ history: "replace" }),
  );
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [count, setCount] = useState(1);

  // Passphrase mode state
  const [words, setWords] = useState(4);
  const [separator, setSeparator] = useState("-");
  const [capitalize, setCapitalize] = useState(true);
  const [appendNumber, setAppendNumber] = useState(true);

  const [nonce, setNonce] = useState(0);
  const [outputs, setOutputs] = useState<string[]>([]);

  const charOpts: CharOptions = {
    length: Math.min(Math.max(length, 4), 64),
    lower,
    upper,
    digits,
    symbols,
    excludeAmbiguous,
  };
  const phraseOpts: PassphraseOptions = {
    words,
    separator,
    capitalize,
    appendNumber,
  };

  const noPool =
    mode === "chars" && !lower && !upper && !digits && !symbols;

  // Generation is impure (crypto.getRandomValues), so it runs in a deferred
  // effect callback — never during render. Re-runs on any option change.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (mode === "chars") {
        if (noPool) {
          setOutputs([]);
          return;
        }
        const n = Math.min(Math.max(count, 1), 10);
        const list: string[] = [];
        for (let i = 0; i < n; i++) list.push(generatePassword(charOpts));
        setOutputs(list);
      } else {
        setOutputs([generatePassphrase(phraseOpts)]);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    length,
    lower,
    upper,
    digits,
    symbols,
    excludeAmbiguous,
    count,
    words,
    separator,
    capitalize,
    appendNumber,
    noPool,
    nonce,
  ]);

  const regenerate = () => setNonce((n) => n + 1);

  const bits =
    mode === "chars"
      ? noPool
        ? 0
        : charEntropy(charOpts)
      : passphraseEntropy(phraseOpts);
  const strength = rateStrength(bits);
  const strengthColor =
    strength.label === "Weak"
      ? "text-danger"
      : strength.label === "Fair"
        ? "text-warn"
        : "text-positive";
  const barColor =
    strength.label === "Weak"
      ? "bg-danger"
      : strength.label === "Fair"
        ? "bg-warn"
        : "bg-positive";

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      {/* controls */}
      <div className="panel registered space-y-4 p-4">
        <p className="readout">Generator</p>

        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["chars", "Characters"],
              ["phrase", "Passphrase"],
            ] as [Mode, string][]
          ).map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setMode(val)}
              className={cn(
                "h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors",
                mode === val
                  ? "bg-accent text-on-accent"
                  : "text-muted hover:text-ink",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === "chars" ? (
          <>
            <Slider
              label="Length"
              value={charOpts.length}
              min={4}
              max={64}
              onChange={setLength}
            />
            <div className="flex flex-wrap gap-2">
              <Toggle label="a-z" active={lower} onClick={() => setLower((v) => !v)} />
              <Toggle label="A-Z" active={upper} onClick={() => setUpper((v) => !v)} />
              <Toggle label="0-9" active={digits} onClick={() => setDigits((v) => !v)} />
              <Toggle
                label="!@#"
                active={symbols}
                onClick={() => setSymbols((v) => !v)}
              />
              <Toggle
                label="No ambiguous"
                active={excludeAmbiguous}
                onClick={() => setExcludeAmbiguous((v) => !v)}
              />
            </div>
            <Slider
              label="Count"
              value={Math.min(Math.max(count, 1), 10)}
              min={1}
              max={10}
              onChange={setCount}
            />
            {noPool && (
              <p className="font-mono text-xs text-danger">
                Select at least one character set.
              </p>
            )}
          </>
        ) : (
          <>
            <Slider
              label="Words"
              value={words}
              min={3}
              max={8}
              onChange={setWords}
            />
            <div>
              <p className="readout mb-1.5">Separator</p>
              <select
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                className="input"
              >
                {SEPARATORS.map(([val, lbl]) => (
                  <option key={lbl} value={val}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle
                label="Capitalize"
                active={capitalize}
                onClick={() => setCapitalize((v) => !v)}
              />
              <Toggle
                label="Append number"
                active={appendNumber}
                onClick={() => setAppendNumber((v) => !v)}
              />
            </div>
          </>
        )}

        {/* strength readout */}
        <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge bg-base p-3">
          <div className="flex items-center justify-between">
            <span className="readout">Strength</span>
            <span className={cn("font-mono text-xs font-semibold", strengthColor)}>
              {strength.label}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div
              className={cn("h-full rounded-full transition-all", barColor)}
              style={{ width: `${Math.round(strength.ratio * 100)}%` }}
            />
          </div>
          <p className="font-mono text-[11px] tabular text-muted">
            ~{strength.bits} bits of entropy
          </p>
        </div>

        <button
          onClick={regenerate}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-on-accent transition-[filter] hover:brightness-110"
        >
          <RefreshCw size={15} /> Regenerate
        </button>
      </div>

      {/* output */}
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Output · {outputs.length}</span>
          <div className="flex items-center gap-2">
            <CopyButton value={outputs.join("\n")} label="Copy all" />
          </div>
        </div>
        <div className="max-h-[420px] flex-1 divide-y divide-edge overflow-auto">
          {outputs.length === 0 ? (
            <p className="px-3 py-6 font-mono text-xs text-faint">
              No output — adjust the options.
            </p>
          ) : (
            outputs.map((pw, i) => (
              <div key={i} className="group flex items-center gap-3 px-3 py-2.5">
                {outputs.length > 1 && (
                  <span className="readout w-6 shrink-0 tabular">{i + 1}</span>
                )}
                <code className="flex-1 break-all select-all font-mono text-[13px] text-ink">
                  {pw}
                </code>
                <CopyButton
                  value={pw}
                  label=""
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="readout">{label}</span>
        <span className="font-mono text-xs tabular text-muted">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
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
