"use client";

import { useMemo, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { AlertTriangle, Search, X } from "lucide-react";
import {
  buildAsciiTable,
  filterRows,
  encodeText,
  decodeCodes,
  textStatsSafe,
  ENCODE_FORMATS,
  SEPARATORS,
  DECODE_BASES,
  type EncodeFormat,
  type Separator,
  type DecodeBase,
} from "@/lib/tools/text/ascii";
import { CopyButton } from "@/components/copy-button";
import { ShareButton } from "@/components/share-button";
import { cn } from "@/lib/utils";

type Mode = "table" | "encode" | "decode";

const MODES: [Mode, string][] = [
  ["table", "Table"],
  ["encode", "Encode"],
  ["decode", "Decode"],
];

export function AsciiGeneratorWidget() {
  const [mode, setMode] = useQueryState(
    "mode",
    parseAsString.withDefault("table").withOptions({ history: "replace" }),
  );
  const current = (MODES.some(([m]) => m === mode) ? mode : "table") as Mode;

  return (
    <div className="space-y-3">
      {/* segmented control */}
      <div className="panel flex items-center gap-1 p-1">
        <div className="flex w-full rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setMode(val)}
              className={cn(
                "h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors",
                current === val
                  ? "bg-accent text-[#070806] font-semibold"
                  : "text-muted hover:text-ink",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {current === "table" && <TablePanel />}
      {current === "encode" && <EncodePanel />}
      {current === "decode" && <DecodePanel />}
    </div>
  );
}

/* ----------------------------------------------------------------- table */

function TablePanel() {
  const [extended, setExtended] = useState(false);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => buildAsciiTable(extended), [extended]);
  const visible = useMemo(() => filterRows(rows, query), [rows, query]);

  return (
    <div className="panel registered flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <span className="readout">ASCII Reference</span>
        <div className="ml-auto flex items-center gap-2">
          {/* range toggle */}
          <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
            {[
              ["0–127", false],
              ["0–255", true],
            ].map(([lbl, val]) => (
              <button
                key={String(val)}
                onClick={() => setExtended(val as boolean)}
                className={cn(
                  "h-7 rounded-[3px] px-2.5 font-mono text-xs transition-colors",
                  extended === val
                    ? "bg-raised text-accent"
                    : "text-muted hover:text-ink",
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          {/* filter */}
          <div className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge bg-base px-2.5">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="w-24 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint sm:w-32"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear filter">
                <X size={12} className="text-faint hover:text-danger" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-h-[520px] overflow-auto">
        <table className="w-full border-collapse font-mono text-xs tabular">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-edge text-left">
              <th className="readout px-3 py-2 font-normal">Char</th>
              <th className="readout px-3 py-2 font-normal">Dec</th>
              <th className="readout px-3 py-2 font-normal">Hex</th>
              <th className="readout px-3 py-2 font-normal">Oct</th>
              <th className="readout px-3 py-2 font-normal">Binary</th>
              <th className="readout px-3 py-2 font-normal">HTML</th>
              <th className="readout px-3 py-2 font-normal">Name</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.dec}
                className="border-b border-edge/60 transition-colors hover:bg-raised"
              >
                <td
                  className={cn(
                    "px-3 py-1.5 text-sm",
                    r.control ? "text-faint" : "text-ink",
                  )}
                >
                  {r.char}
                </td>
                <td className="px-3 py-1.5 text-accent">{r.dec}</td>
                <td className="px-3 py-1.5 text-muted">0x{r.hex}</td>
                <td className="px-3 py-1.5 text-muted">{r.oct}</td>
                <td className="px-3 py-1.5 text-faint">{r.bin}</td>
                <td className="px-3 py-1.5 text-muted">{r.html}</td>
                <td className="px-3 py-1.5 text-muted">
                  {r.name || (r.entity ? r.entity : "")}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center font-mono text-xs text-faint"
                >
                  No matching characters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
        <span>{visible.length} rows</span>
        <span className="ml-auto">{extended ? "0–255" : "0–127"}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- encode */

function EncodePanel() {
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({
      history: "replace",
      throttleMs: 300,
    }),
  );
  const [format, setFormat] = useState<EncodeFormat>("dec");
  const [separator, setSeparator] = useState<Separator>("space");

  const output = useMemo(
    () => encodeText(input, format, separator),
    [input, format, separator],
  );
  const stats = useMemo(() => textStatsSafe(input), [input]);

  return (
    <div className="space-y-3">
      {/* options */}
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2">
          <span className="readout">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as EncodeFormat)}
            className="input w-auto"
          >
            {ENCODE_FORMATS.map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="readout">Separator</span>
          <select
            value={separator}
            onChange={(e) => setSeparator(e.target.value as Separator)}
            className="input w-auto"
          >
            {SEPARATORS.map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Text</span>
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
            placeholder="Type or paste text to encode…"
            className="min-h-[220px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{stats.chars} ch</span>
            <span className="ml-auto">{stats.bytes} B</span>
          </div>
        </div>

        {/* output */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Codes</span>
            <div className="flex items-center gap-2">
              <ShareButton />
              <CopyButton value={output} />
            </div>
          </div>
          <textarea
            value={output}
            readOnly
            spellCheck={false}
            placeholder="Encoded codes appear here…"
            className="min-h-[220px] flex-1 resize-y select-all bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{stats.chars} codes</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- decode */

function DecodePanel() {
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({
      history: "replace",
      throttleMs: 300,
    }),
  );
  const [base, setBase] = useState<DecodeBase>("auto");

  const result = useMemo(() => decodeCodes(input, base), [input, base]);
  const output = result.ok ? result.value : "";
  const error = result.ok ? null : result.error;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-3 p-3">
        <label className="flex items-center gap-2">
          <span className="readout">Base</span>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value as DecodeBase)}
            className="input w-auto"
          >
            {DECODE_BASES.map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
        <p className="font-mono text-xs text-faint">
          Accepts space/comma-separated codes, 0x / \x / \u prefixes and &amp;#nn; entities.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Codes</span>
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
            placeholder="72 101 108 108 111  ·  48 65 6C 6C 6F"
            className="min-h-[220px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
        </div>

        {/* output */}
        <div
          className={cn(
            "panel registered flex flex-col",
            error && "border-danger/50",
          )}
        >
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Text</span>
            <div className="flex items-center gap-2">
              <ShareButton />
              <CopyButton value={output} />
            </div>
          </div>
          {error ? (
            <div className="flex min-h-[220px] flex-1 items-center justify-center p-6">
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
              placeholder="Decoded text appears here…"
              className="min-h-[220px] flex-1 resize-y select-all bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
            />
          )}
        </div>
      </div>
    </div>
  );
}
