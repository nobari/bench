"use client";

import { useMemo } from "react";
import { useQueryState, parseAsString } from "nuqs";
import {
  CATEGORIES,
  getCategory,
  convert,
  formatResult,
  type CategoryDef,
} from "@/lib/tools/math/units";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

/** Resolve a category by key, falling back to the first defined category. */
function resolveCategory(key: string): CategoryDef {
  return getCategory(key) ?? CATEGORIES[0];
}

export function UnitConverterWidget() {
  const [cat, setCat] = useQueryState(
    "cat",
    parseAsString.withDefault("length").withOptions({ history: "replace" }),
  );
  const [from, setFrom] = useQueryState(
    "from",
    parseAsString.withDefault("m").withOptions({ history: "replace" }),
  );
  const [val, setVal] = useQueryState(
    "val",
    parseAsString.withDefault("1").withOptions({ history: "replace", throttleMs: 200 }),
  );

  const category = resolveCategory(cat);
  // Resolve the from-unit, falling back to the category default when the URL
  // unit doesn't belong to the active category (e.g. after switching category).
  const fromUnit =
    category.units.find((un) => un.key === from) ??
    category.units.find((un) => un.key === category.defaultFrom) ??
    category.units[0];

  const parsed = useMemo(() => {
    const trimmed = val.trim();
    if (trimmed === "") return { ok: false as const, n: NaN };
    const n = Number(trimmed);
    return Number.isFinite(n) ? { ok: true as const, n } : { ok: false as const, n: NaN };
  }, [val]);

  const rows = useMemo(() => {
    if (!parsed.ok) return [];
    try {
      return category.units
        .filter((un) => un.key !== fromUnit.key)
        .map((un) => ({
          key: un.key,
          label: un.label,
          value: formatResult(convert(category, parsed.n, fromUnit.key, un.key)),
        }));
    } catch {
      return [];
    }
  }, [category, fromUnit, parsed]);

  return (
    <div className="space-y-3">
      {/* category selector */}
      <div className="panel registered p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="readout">Category</span>
          <ShareButton />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setCat(c.key);
                setFrom(c.defaultFrom);
              }}
              className={cn(
                "h-8 rounded-[var(--radius-sm)] border px-3 font-mono text-xs transition-colors",
                category.key === c.key
                  ? "border-accent bg-accent text-[#070806] font-semibold"
                  : "border-edge text-muted hover:border-accent hover:text-accent",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* value + from unit */}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            spellCheck={false}
            inputMode="decimal"
            placeholder="Enter a value…"
            className="input font-mono"
            aria-label="Value to convert"
          />
          <select
            value={fromUnit.key}
            onChange={(e) => setFrom(e.target.value)}
            className="input w-full sm:w-auto"
            aria-label="From unit"
          >
            {category.units.map((un) => (
              <option key={un.key} value={un.key}>
                {un.label}
              </option>
            ))}
          </select>
        </div>

        {!parsed.ok && val.trim() !== "" && (
          <p className="font-mono text-xs text-danger">Enter a valid number.</p>
        )}
      </div>

      {/* converted values */}
      <div className="panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">
            {parsed.ok ? `${val} ${fromUnit.label} =` : "Converted"}
          </span>
        </div>
        <div className="divide-y divide-edge">
          {parsed.ok && rows.length > 0 ? (
            rows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-44 shrink-0 font-mono text-xs text-muted">{row.label}</span>
                <code className="flex-1 truncate font-mono text-[13px] tabular text-ink">
                  {row.value}
                </code>
                <CopyButton value={row.value} label="" className="shrink-0" />
              </div>
            ))
          ) : (
            <p className="px-3 py-6 text-center font-mono text-xs text-faint">
              Enter a numeric value to convert.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
