"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { CalendarDays, Clock, Globe, X } from "lucide-react";
import {
  parseDate,
  standardFormats,
  calendarRows,
  MAJOR_ZONES,
  allTimeZones,
  zoneTime,
  zoneOffset,
  localZone,
} from "@/lib/tools/time/date-formats";
import { CopyButton } from "@/components/copy-button";
import { ExpandableValue } from "@/components/expandable-value";

const ALL_ZONES = allTimeZones();

export function DateConverterWidget() {
  const [input, setInput] = useQueryState(
    "d",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [now, setNow] = useState(() => Date.now());
  const [focusZone, setFocusZone] = useState(() => localZone());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = input.trim() ? parseDate(input) : new Date(now);
  const invalid = input.trim() !== "" && date === null;

  const formats = date ? standardFormats(date, now) : [];
  const calendars = date ? calendarRows(date) : [];

  return (
    <div className="space-y-3">
      {/* input */}
      <div className="panel registered">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Date, ISO, locale, or epoch</span>
          <span className="font-mono text-xs tabular text-faint">
            {input.trim() ? "" : "live"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 2026-06-23T00:00:00Z, June 23 2026, or 1782518400"
            spellCheck={false}
            className="input flex-1"
          />
          <button
            onClick={() => setInput(new Date(Date.now()).toISOString())}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Clock size={14} /> Now
          </button>
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
            Couldn’t parse that — try an ISO date, a locale date, or a Unix timestamp.
          </p>
        )}
      </div>

      {date && (
        <>
          {/* CALENDARS — the headline */}
          <div className="panel registered">
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
              <CalendarDays size={14} className="text-accent" />
              <span className="readout">Calendar systems</span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-edge sm:grid-cols-2 lg:grid-cols-3">
              {calendars.map((c) => (
                <div key={c.label} className="group flex flex-col gap-0.5 bg-surface px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[13px] font-semibold text-ink">{c.label}</span>
                    <CopyButton
                      value={c.value}
                      label=""
                      className="h-6 shrink-0 border-0 px-1 opacity-0 group-hover:opacity-100"
                    />
                  </div>
                  <code className="font-mono text-[13px] tabular text-accent">{c.value}</code>
                  <span className="readout text-[9px] text-faint">{c.note}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            {/* standard formats */}
            <div className="panel">
              <div className="border-b border-edge px-3 py-2">
                <span className="readout">Formats & fields</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {formats.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center gap-2 border-edge px-3 py-2 [&:not(:last-child)]:border-b sm:[&:nth-child(odd)]:border-r"
                  >
                    <span className="readout w-28 shrink-0 text-[10px]">{r.label}</span>
                    <ExpandableValue value={r.value} className="flex-1 text-xs tabular text-ink" />
                    <CopyButton value={r.value} label="" className="h-6 shrink-0 self-start border-0 px-1" />
                  </div>
                ))}
              </div>
            </div>

            {/* timezones */}
            <div className="panel">
              <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
                <Globe size={14} className="text-accent" />
                <span className="readout">Time zones</span>
              </div>
              <div className="border-b border-edge p-3">
                <select
                  value={focusZone}
                  onChange={(e) => setFocusZone(e.target.value)}
                  className="input mb-2 font-mono text-xs"
                  aria-label="Focus time zone"
                >
                  {ALL_ZONES.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
                <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-accent/40 bg-accent/[0.06] px-3 py-2">
                  <div className="min-w-0">
                    <p className="readout text-[10px] text-accent">{focusZone} · {zoneOffset(date, focusZone)}</p>
                    <code className="font-mono text-[13px] tabular text-ink">{zoneTime(date, focusZone)}</code>
                  </div>
                  <CopyButton value={zoneTime(date, focusZone)} label="" className="shrink-0" />
                </div>
              </div>
              <div className="divide-y divide-edge">
                {MAJOR_ZONES.map((z) => (
                  <div key={z.zone} className="flex items-center gap-2 px-3 py-2">
                    <span className="readout w-24 shrink-0 text-[10px]">{z.label}</span>
                    <ExpandableValue value={zoneTime(date, z.zone)} className="flex-1 text-xs tabular text-ink" />
                    <span className="shrink-0 self-start font-mono text-[10px] text-faint">{zoneOffset(date, z.zone)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
