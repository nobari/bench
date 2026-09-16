"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { RefreshCw } from "lucide-react";
import { generateIds, type IdKind } from "@/lib/tools/generators/ids";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const KINDS: [IdKind, string][] = [
  ["uuid-v4", "UUID v4"],
  ["uuid-v7", "UUID v7"],
  ["nanoid", "NanoID"],
];

export function IdGeneratorWidget() {
  const [kind, setKind] = useQueryState(
    "kind",
    parseAsString.withDefault("uuid-v4").withOptions({ history: "replace" }),
  );
  const [count, setCount] = useQueryState(
    "n",
    parseAsInteger.withDefault(5).withOptions({ history: "replace" }),
  );
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [nanoSize, setNanoSize] = useState(21);
  const [nonce, setNonce] = useState(0);
  const [ids, setIds] = useState<string[]>([]);

  // Generation is random (impure), so it runs in a deferred effect callback
  // rather than during render. Re-runs on any config change or regenerate.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const n = Math.min(Math.max(count, 1), 200);
      setIds(
        generateIds(
          { kind: kind as IdKind, count: n, uppercase, hyphens, nanoSize },
          Date.now(),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [kind, count, uppercase, hyphens, nanoSize, nonce]);

  const regenerate = () => setNonce((n) => n + 1);
  const isUuid = kind !== "nanoid";

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      {/* controls */}
      <div className="panel registered space-y-4 p-4">
        <p className="readout">Generator</p>

        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {KINDS.map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setKind(val)}
              className={cn(
                "h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors",
                kind === val ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="readout">Count</span>
            <span className="font-mono text-xs tabular text-muted">{count}</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
        </div>

        {!isUuid && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="readout">Length</span>
              <span className="font-mono text-xs tabular text-muted">{nanoSize}</span>
            </div>
            <input
              type="range"
              min={6}
              max={36}
              value={nanoSize}
              onChange={(e) => setNanoSize(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Toggle label="Uppercase" active={uppercase} onClick={() => setUppercase((v) => !v)} />
          {isUuid && (
            <Toggle label="Hyphens" active={hyphens} onClick={() => setHyphens((v) => !v)} />
          )}
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
          <span className="readout">Output · {ids.length}</span>
          <div className="flex items-center gap-2">
            <CopyButton value={ids.join("\n")} label="Copy all" />
          </div>
        </div>
        <div className="max-h-[420px] flex-1 divide-y divide-edge overflow-auto">
          {ids.map((id, i) => (
            <div key={i} className="group flex items-center gap-3 px-3 py-2">
              <span className="readout w-8 shrink-0 tabular">{i + 1}</span>
              <code className="flex-1 select-all truncate font-mono text-[13px] text-ink">
                {id}
              </code>
              <CopyButton value={id} label="" className="shrink-0 opacity-0 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 font-mono text-xs transition-colors",
        active ? "border-accent text-accent" : "border-edge text-muted hover:text-ink",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-faint")} />
      {label}
    </button>
  );
}
