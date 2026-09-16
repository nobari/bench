"use client";

import { useMemo } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import {
  parseInBase,
  formatInBase,
  groupBits,
  isValidBase,
} from "@/lib/tools/math/base";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const QUICK_BASES = [2, 8, 10, 16] as const;
const ALL_BASES = Array.from({ length: 35 }, (_, i) => i + 2); // 2..36

/** The four standard radixes shown as labelled rows. */
const STANDARD = [
  { base: 2, name: "Binary", upper: false, group: true },
  { base: 8, name: "Octal", upper: false, group: false },
  { base: 10, name: "Decimal", upper: false, group: false },
  { base: 16, name: "Hexadecimal", upper: true, group: false },
] as const;

function render(value: bigint, base: number, upper: boolean, group: boolean): string {
  let s = formatInBase(value, base);
  if (upper) s = s.toUpperCase();
  if (group && base === 2) s = groupBits(s, 4);
  return s;
}

export function BaseConverterWidget() {
  const [value, setValue] = useQueryState(
    "v",
    parseAsString.withDefault("255").withOptions({ history: "replace", throttleMs: 200 }),
  );
  const [from, setFrom] = useQueryState(
    "from",
    parseAsInteger.withDefault(10).withOptions({ history: "replace" }),
  );
  const [target, setTarget] = useQueryState(
    "to",
    parseAsInteger.withDefault(36).withOptions({ history: "replace" }),
  );

  const fromBase = isValidBase(from) ? from : 10;
  const targetBase = isValidBase(target) ? target : 36;

  const parsed = useMemo(() => parseInBase(value, fromBase), [value, fromBase]);

  return (
    <div className="space-y-3">
      {/* input + source base */}
      <div className="panel registered p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="readout">Value (base {fromBase})</span>
        </div>

        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Enter a non-negative integer…"
          className="input font-mono"
          aria-label="Value to convert"
        />

        {!parsed.ok && value.trim() !== "" && (
          <p className="font-mono text-xs text-danger">{parsed.error}</p>
        )}

        <div className="space-y-2">
          <span className="readout">Source base</span>
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_BASES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setFrom(b)}
                className={cn(
                  "h-8 rounded-[var(--radius-sm)] border px-3 font-mono text-xs transition-colors",
                  fromBase === b
                    ? "border-accent bg-accent text-on-accent font-semibold"
                    : "border-edge text-muted hover:border-accent hover:text-accent",
                )}
              >
                {b}
              </button>
            ))}
            <label className="flex items-center gap-2">
              <span className="readout">Base</span>
              <select
                value={fromBase}
                onChange={(e) => setFrom(Number(e.target.value))}
                className="input w-auto"
                aria-label="Source base 2 to 36"
              >
                {ALL_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* standard radixes */}
      <div className="panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Standard bases</span>
        </div>
        <div className="divide-y divide-edge">
          {STANDARD.map((row) => {
            const out = parsed.ok ? render(parsed.value, row.base, row.upper, row.group) : "";
            return (
              <div key={row.base} className="flex items-center gap-3 px-3 py-2.5">
                <span className="readout w-28 shrink-0">{row.name}</span>
                <code className="flex-1 truncate font-mono text-[13px] tabular text-ink">
                  {out || <span className="text-faint">—</span>}
                </code>
                <CopyButton value={out} label="" className="shrink-0" disabled={!out} />
              </div>
            );
          })}
        </div>
      </div>

      {/* custom target base */}
      <div className="panel p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="readout">Custom target base</span>
          <label className="flex items-center gap-2">
            <span className="readout">Base</span>
            <select
              value={targetBase}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="input w-auto"
              aria-label="Target base 2 to 36"
            >
              {ALL_BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(() => {
          const out = parsed.ok ? render(parsed.value, targetBase, true, targetBase === 2) : "";
          return (
            <div className="flex items-center gap-3">
              <code className="flex-1 truncate font-mono text-[13px] tabular text-ink">
                {out || <span className="text-faint">—</span>}
              </code>
              <CopyButton value={out} label="" className="shrink-0" disabled={!out} />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
