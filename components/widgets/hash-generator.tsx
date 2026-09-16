"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { X } from "lucide-react";
import { computeHashes, type HashResult } from "@/lib/tools/crypto/hash";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export function HashGeneratorWidget() {
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [uppercase, setUppercase] = useState(false);
  const [results, setResults] = useState<HashResult[]>([]);

  useEffect(() => {
    let active = true;
    computeHashes(input).then((r) => {
      if (active) setResults(r);
    });
    return () => {
      active = false;
    };
  }, [input]);

  const cased = (v: string) => (uppercase ? v.toUpperCase() : v);

  return (
    <div className="space-y-3">
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Input</span>
          <div className="flex items-center gap-2">
            {input && (
              <button
                onClick={() => setInput("")}
                className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          placeholder="Type or paste text to hash…"
          className="min-h-[140px] resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
        />
      </div>

      <div className="panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Digests</span>
          <button
            onClick={() => setUppercase((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors",
              uppercase ? "border-accent text-accent" : "border-edge text-muted hover:text-ink",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", uppercase ? "bg-accent" : "bg-faint")} />
            Uppercase
          </button>
        </div>
        <div className="divide-y divide-edge">
          {results.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="readout w-24 shrink-0">{r.label}</span>
              <code className="flex-1 truncate font-mono text-[13px] text-ink">
                {input ? cased(r.value) : <span className="text-faint">—</span>}
              </code>
              <CopyButton value={input ? cased(r.value) : ""} label="" className="shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
