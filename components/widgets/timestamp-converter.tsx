"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { Clock, X } from "lucide-react";
import { parseTime, breakdown } from "@/lib/tools/time/timestamp";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";

export function TimestampConverterWidget() {
  const [input, setInput] = useQueryState(
    "t",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = input.trim() ? parseTime(input) : new Date(now);
  const data = date ? breakdown(date, now) : null;
  const invalid = input.trim() !== "" && date === null;

  const rows = data
    ? [
        ["Unix (seconds)", String(data.unixSec)],
        ["Unix (milliseconds)", String(data.unixMs)],
        ["ISO 8601", data.iso],
        ["UTC", data.utc],
        ["Local", data.local],
        ["Relative", data.relative],
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="panel registered">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Timestamp or date</span>
          <span className="font-mono text-xs tabular text-faint">
            now: {Math.floor(now / 1000)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 1719100800, 1719100800000, or 2026-06-23T00:00:00Z"
            className="input flex-1"
          />
          <button
            onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Clock size={14} /> Now
          </button>
          <ShareButton />
          {input && (
            <button
              onClick={() => setInput("")}
              className="inline-flex h-9 items-center gap-1 px-2 font-mono text-xs text-faint hover:text-danger"
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>
        {invalid && (
          <p className="border-t border-edge px-3 py-2 font-mono text-xs text-danger">
            Couldn’t parse that — try a Unix timestamp or an ISO date.
          </p>
        )}
      </div>

      {data && (
        <div className="panel divide-y divide-edge">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 px-3 py-2.5">
              <span className="readout w-40 shrink-0">{label}</span>
              <code className="flex-1 truncate font-mono text-[13px] text-ink">{value}</code>
              <CopyButton value={value} label="" className="shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
