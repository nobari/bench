"use client";

import { useMemo } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { ArrowLeftRight } from "lucide-react";
import { diffLines } from "@/lib/tools/web/diff";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

export function DiffCheckerWidget() {
  const [a, setA] = useQueryState(
    "a",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 400 }),
  );
  const [b, setB] = useQueryState(
    "b",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 400 }),
  );

  const result = useMemo(() => diffLines(a, b), [a, b]);
  const swap = () => {
    const tmp = a;
    setA(b);
    setB(tmp);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Pane label="Original" value={a} onChange={setA} onClear={() => setA("")} />
        <Pane label="Changed" value={b} onChange={setB} onClear={() => setB("")} />
      </div>

      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <div className="flex items-center gap-3 readout tabular">
            <span className="text-positive">+{result.added}</span>
            <span className="text-danger">−{result.removed}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={swap}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <ArrowLeftRight size={13} /> Swap
            </button>
            <ShareButton />
          </div>
        </div>

        <div className="max-h-[460px] overflow-auto font-mono text-[13px]">
          {a === "" && b === "" ? (
            <p className="px-3 py-10 text-center text-faint">
              Paste two versions above to see the differences.
            </p>
          ) : result.added === 0 && result.removed === 0 ? (
            <p className="px-3 py-10 text-center text-positive">
              The two inputs are identical.
            </p>
          ) : (
            result.ops.map((op, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-3 px-3 py-[2px]",
                  op.type === "add" && "bg-positive/10",
                  op.type === "del" && "bg-danger/10",
                )}
              >
                <span className="w-10 shrink-0 select-none text-right tabular text-faint">
                  {op.aLine ?? ""}
                </span>
                <span className="w-10 shrink-0 select-none text-right tabular text-faint">
                  {op.bLine ?? ""}
                </span>
                <span
                  className={cn(
                    "w-3 shrink-0 select-none",
                    op.type === "add" && "text-positive",
                    op.type === "del" && "text-danger",
                    op.type === "eq" && "text-faint",
                  )}
                >
                  {op.type === "add" ? "+" : op.type === "del" ? "−" : " "}
                </span>
                <span
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    op.type === "add" && "text-positive",
                    op.type === "del" && "text-danger",
                    op.type === "eq" && "text-muted",
                  )}
                >
                  {op.text || " "}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Pane({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="panel registered flex flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="readout">{label}</span>
        {value && (
          <button onClick={onClear} className="font-mono text-xs text-faint hover:text-danger">
            Clear
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={`Paste the ${label.toLowerCase()} text…`}
        className="min-h-[200px] resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
      />
    </div>
  );
}
