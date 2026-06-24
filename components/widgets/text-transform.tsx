"use client";

import { useMemo, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { ArrowLeftRight, ChevronDown, Search, X, AlertTriangle } from "lucide-react";
import {
  TRANSFORMS,
  GROUP_LABELS,
  getTransform,
  runTransform,
  textStats,
  type TransformGroup,
} from "@/lib/tools/text/transforms";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

interface Props {
  preset?: string;
  featured?: string[];
}

export function TextTransformWidget({ preset, featured }: Props) {
  const [transformId, setTransformId] = useQueryState(
    "t",
    parseAsString.withDefault(preset ?? "base64-encode").withOptions({
      history: "replace",
    }),
  );
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({
      history: "replace",
      throttleMs: 300,
    }),
  );

  const transform = getTransform(transformId) ?? getTransform("base64-encode")!;
  const result = useMemo(() => runTransform(transform.id, input), [transform.id, input]);
  const output = result.ok ? result.value : "";
  const error = result.ok ? null : result.error;

  const inStats = textStats(input);
  const outStats = textStats(output);

  const swap = () => {
    if (!transform.inverse) return;
    setTransformId(transform.inverse);
    setInput(output);
  };

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <TransformPicker value={transform.id} onChange={(id) => setTransformId(id)} />

        {featured && featured.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {featured.map((id) => {
              const t = getTransform(id);
              if (!t) return null;
              const active = t.id === transform.id;
              return (
                <button
                  key={id}
                  onClick={() => setTransformId(id)}
                  className={cn(
                    "shrink-0 rounded-[var(--radius-sm)] px-2.5 py-1.5 font-mono text-xs transition-colors",
                    active
                      ? "bg-accent text-[#070806]"
                      : "text-muted hover:bg-raised hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {transform.inverse && (
            <button
              onClick={swap}
              title="Swap input/output and reverse the transform"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <ArrowLeftRight size={13} /> Swap
            </button>
          )}
        </div>
      </div>

      {/* io grid */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Input</span>
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
            placeholder="Paste or type your text here…"
            className="min-h-[260px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <StatBar stats={inStats} />
        </div>

        {/* output */}
        <div
          className={cn(
            "panel registered flex flex-col",
            error && "border-danger/50",
          )}
        >
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Output</span>
            <div className="flex items-center gap-2">
              <ShareButton />
              <CopyButton value={output} />
            </div>
          </div>
          {error ? (
            <div className="flex min-h-[260px] flex-1 items-center justify-center p-6">
              <div className="flex max-w-sm items-start gap-2 text-sm text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            </div>
          ) : (
            <textarea
              value={output}
              readOnly
              spellCheck={false}
              placeholder="Result appears here…"
              className="min-h-[260px] flex-1 resize-y select-all bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
            />
          )}
          <StatBar stats={outStats} />
        </div>
      </div>
    </div>
  );
}

function StatBar({ stats }: { stats: ReturnType<typeof textStats> }) {
  return (
    <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
      <span>{stats.chars} ch</span>
      <span>{stats.words} w</span>
      <span>{stats.lines} ln</span>
      <span className="ml-auto">{stats.bytes} B</span>
    </div>
  );
}

/* --------------------------------------------------- transform picker popover */

function TransformPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = getTransform(value);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<TransformGroup, typeof TRANSFORMS>();
    for (const t of TRANSFORMS) {
      if (q && !`${t.label} ${t.summary} ${t.id}`.toLowerCase().includes(q)) continue;
      const arr = map.get(t.group) ?? [];
      arr.push(t);
      map.set(t.group, arr);
    }
    return map;
  }, [query]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-edge bg-base px-3 font-mono text-xs text-ink transition-colors hover:border-edge-bright"
      >
        <span className="max-w-[42vw] truncate sm:max-w-none">
          {current?.label ?? "Select transform"}
        </span>
        <ChevronDown size={13} className={cn("text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[min(88vw,360px)] overflow-hidden rounded-[var(--radius)] border border-edge bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]">
            <div className="flex items-center gap-2 border-b border-edge px-3">
              <Search size={14} className="text-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter transforms…"
                className="h-10 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint"
              />
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-1.5">
              {[...groups.entries()].map(([group, items]) => (
                <div key={group} className="mb-1">
                  <p className="readout px-2 py-1.5">{GROUP_LABELS[group]}</p>
                  {items.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onChange(t.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 text-left font-mono text-xs transition-colors",
                        t.id === value
                          ? "bg-raised text-accent"
                          : "text-muted hover:bg-raised hover:text-ink",
                      )}
                    >
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 truncate text-[10px] text-faint">
                        {t.summary}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {groups.size === 0 && (
                <p className="px-3 py-6 text-center font-mono text-xs text-faint">
                  No matches.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
