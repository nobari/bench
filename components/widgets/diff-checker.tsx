"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsBoolean, parseAsStringLiteral } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, ArrowLeftRight, ChevronsUpDown, Download, FileDiff, X } from "lucide-react";
import {
  applyPatchText,
  foldRows,
  inlineDiff,
  lineDiff,
  makePatch,
  normalizeJsonText,
  type Block,
  type DiffOptions,
  type LineRow,
  type Segment,
} from "@/lib/tools/web/diff";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const GRANULARITIES = ["line", "word", "char"] as const;
const VIEWS = ["unified", "split"] as const;
const WS = ["none", "trim", "all"] as const;
const CONTEXTS = ["3", "5", "10", "all"] as const;
const FUZZ = ["0", "1", "2", "3"] as const;

/** Inputs come from the compressed hash (Share) or plain `a`/`b` query params (older links, examples). */
function readInitial(): { a: string; b: string } {
  if (typeof window === "undefined") return { a: "", b: "" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const q = new URLSearchParams(window.location.search);
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decompressFromEncodedURIComponent(v) || null;
    } catch {
      return null;
    }
  };
  return { a: dec(hash.get("a")) ?? q.get("a") ?? "", b: dec(hash.get("b")) ?? q.get("b") ?? "" };
}

const SEL =
  "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-1.5 pr-6 text-[12px] text-ink outline-none focus:border-accent";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

export function DiffCheckerWidget() {
  const [granularity, setGranularity] = useQueryState(
    "g",
    parseAsStringLiteral(GRANULARITIES).withDefault("line").withOptions({ history: "replace" }),
  );
  const [view, setView] = useQueryState("v", parseAsStringLiteral(VIEWS).withDefault("unified").withOptions({ history: "replace" }));
  const [ws, setWs] = useQueryState("ws", parseAsStringLiteral(WS).withDefault("none").withOptions({ history: "replace" }));
  const [ignoreCase, setIgnoreCase] = useQueryState("ic", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const [json, setJson] = useQueryState("json", parseAsBoolean.withDefault(false).withOptions({ history: "replace" }));
  const [ctx, setCtx] = useQueryState("ctx", parseAsStringLiteral(CONTEXTS).withDefault("3").withOptions({ history: "replace" }));
  const [wrap, setWrap] = useQueryState("wrap", parseAsBoolean.withDefault(true).withOptions({ history: "replace" }));

  const [initial] = useState(readInitial);
  const [a, setA] = useState(initial.a);
  const [b, setB] = useState(initial.b);
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchText, setPatchText] = useState("");
  const [fuzz, setFuzz] = useState<(typeof FUZZ)[number]>("0");
  const [patchNote, setPatchNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const urlsRef = useRef<string[]>([]);

  const da = useDeferredValue(a);
  const db = useDeferredValue(b);
  const opts: DiffOptions = useMemo(() => ({ whitespace: ws, ignoreCase }), [ws, ignoreCase]);

  // JSON normalisation (sorted keys, pretty-printed) when both sides parse.
  const prepared = useMemo(() => {
    if (!json) return { a: da, b: db, applied: false };
    const na = normalizeJsonText(da), nb = normalizeJsonText(db);
    if (na !== null && nb !== null) return { a: na, b: nb, applied: true };
    return { a: da, b: db, applied: false };
  }, [da, db, json]);

  const lines = useMemo(
    () => (granularity === "line" ? lineDiff(prepared.a, prepared.b, opts) : null),
    [granularity, prepared, opts],
  );
  const inline = useMemo(
    () => (granularity !== "line" ? inlineDiff(prepared.a, prepared.b, granularity, opts) : null),
    [granularity, prepared, opts],
  );
  const blocks: Block[] = useMemo(
    () => (lines ? foldRows(lines.rows, ctx === "all" ? Infinity : Number(ctx)) : []),
    [lines, ctx],
  );
  const patch = useMemo(() => makePatch(prepared.a, prepared.b, ctx === "all" ? 1_000_000 : Number(ctx)), [prepared, ctx]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (a) h.set("a", compressToEncodedURIComponent(a));
      if (b) h.set("b", compressToEncodedURIComponent(b));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [a, b]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const empty = a === "" && b === "";
  const identical = lines ? lines.added + lines.removed + lines.modified === 0 : inline ? inline.added + inline.removed === 0 : true;

  const swap = () => {
    setA(b);
    setB(a);
  };
  const downloadPatch = () => {
    const url = URL.createObjectURL(new Blob([patch], { type: "text/x-diff" }));
    urlsRef.current.push(url);
    const el = document.createElement("a");
    el.href = url;
    el.download = "changes.patch";
    el.click();
  };
  const applyPatchNow = () => {
    const r = applyPatchText(a, patchText, Number(fuzz));
    if (!r.ok) {
      setPatchNote({ tone: "err", text: r.error });
      return;
    }
    setB(r.value);
    setPatchNote({ tone: "ok", text: "Patch applied — the result is now in Changed." });
  };
  const folds = blocks.filter((bl) => bl.kind === "fold").map((bl) => bl.start);
  const allExpanded = folds.length > 0 && folds.every((s) => expanded.has(s));

  const stats = lines
    ? { plus: lines.added + lines.modified, minus: lines.removed + lines.modified, mod: lines.modified, sim: lines.similarity }
    : inline
      ? { plus: inline.added, minus: inline.removed, mod: 0, sim: inline.similarity }
      : null;

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
        <Segmented
          value={granularity}
          onChange={(g) => setGranularity(g)}
          items={[
            ["line", "Lines"],
            ["word", "Words"],
            ["char", "Characters"],
          ]}
        />
        <Segmented
          value={granularity === "line" ? view : "unified"}
          onChange={(v) => setView(v)}
          disabled={granularity !== "line"}
          items={[
            ["unified", "Unified"],
            ["split", "Side by side"],
          ]}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Whitespace
          <select value={ws} onChange={(e) => setWs(e.target.value as (typeof WS)[number])} className={SEL}>
            <option value="none">compare</option>
            <option value="trim">ignore edges</option>
            <option value="all">ignore all</option>
          </select>
        </label>
        <Check label="Ignore case" checked={ignoreCase} onChange={setIgnoreCase} />
        <Check label="JSON: sort keys" checked={json} onChange={setJson} title="When both sides are JSON, compare them with keys sorted and consistent formatting" />
        {granularity === "line" && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Context
            <select value={ctx} onChange={(e) => setCtx(e.target.value as (typeof CONTEXTS)[number])} className={SEL}>
              {CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "show all" : `${c} lines`}
                </option>
              ))}
            </select>
          </label>
        )}
        <Check label="Wrap" checked={wrap} onChange={setWrap} />

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={swap} className={GHOST} title="Swap original and changed">
            <ArrowLeftRight size={13} /> Swap
          </button>
          <button
            onClick={() => setPatchOpen((o) => !o)}
            className={cn(GHOST, patchOpen && "border-accent text-accent")}
            title="Apply a unified diff to the original"
          >
            <FileDiff size={13} /> Apply patch
          </button>
        </div>
      </div>

      {/* inputs */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Pane label="Original" value={a} onChange={setA} />
        <Pane label="Changed" value={b} onChange={setB} />
      </div>

      {patchOpen && (
        <div className="panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
            <span className="readout">Unified diff to apply to Original</span>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-muted">
                Fuzz
                <select value={fuzz} onChange={(e) => setFuzz(e.target.value as (typeof FUZZ)[number])} className={SEL}>
                  {FUZZ.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={applyPatchNow}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)]"
              >
                Apply → Changed
              </button>
              <button onClick={() => setPatchOpen(false)} aria-label="Close" className="text-faint hover:text-ink">
                <X size={14} />
              </button>
            </div>
          </div>
          <textarea
            value={patchText}
            onChange={(e) => setPatchText(e.target.value)}
            spellCheck={false}
            placeholder={"--- original\n+++ changed\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n context"}
            className="min-h-[140px] w-full resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          {patchNote && (
            <p
              className={cn(
                "flex items-center gap-2 border-t border-edge px-3 py-2 text-[12.5px]",
                patchNote.tone === "ok" ? "text-positive" : "text-danger",
              )}
            >
              {patchNote.tone === "err" && <AlertTriangle size={14} />}
              {patchNote.text}
            </p>
          )}
        </div>
      )}

      {/* result */}
      <div className="panel flex flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge px-3 py-2">
          <span className="readout">Differences</span>
          {stats && !empty && (
            <span className="flex items-center gap-3 text-[12.5px] tabular">
              <span className="text-positive">+{stats.plus}</span>
              <span className="text-danger">−{stats.minus}</span>
              {granularity === "line" && stats.mod > 0 && <span className="text-warn">~{stats.mod}</span>}
              <span className="text-faint">{Math.round(stats.sim * 100)}% same</span>
              {prepared.applied && <span className="text-faint">JSON normalised</span>}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {folds.length > 0 && (
              <button
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(folds))}
                className={GHOST}
              >
                <ChevronsUpDown size={13} /> {allExpanded ? "Collapse unchanged" : "Expand all"}
              </button>
            )}
            <button onClick={downloadPatch} disabled={empty || identical} className={GHOST} title="Download as a unified diff">
              <Download size={13} /> .patch
            </button>
            <CopyButton value={empty || identical ? "" : patch} label="Copy patch" />
          </div>
        </div>

        <div className={cn("max-h-[560px] overflow-auto font-mono text-[12.5px] leading-[1.6]", !wrap && "overflow-x-auto")}>
          {empty ? (
            <p className="px-3 py-10 text-center text-faint">Paste two versions above to see the differences.</p>
          ) : identical ? (
            <p className="px-3 py-10 text-center text-positive">
              The two inputs are identical{ws !== "none" || ignoreCase || prepared.applied ? " under the current options" : ""}.
            </p>
          ) : inline ? (
            <div className={cn("p-3 text-ink", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
              {inline.segments.map((s, i) => (
                <Seg key={i} seg={s} />
              ))}
            </div>
          ) : view === "split" ? (
            <SplitView blocks={blocks} expanded={expanded} onExpand={(s) => setExpanded((e) => new Set(e).add(s))} wrap={wrap} />
          ) : (
            <UnifiedView blocks={blocks} expanded={expanded} onExpand={(s) => setExpanded((e) => new Set(e).add(s))} wrap={wrap} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sub-pieces */

function Segmented<T extends string>({
  value,
  onChange,
  items,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  items: [T, string][];
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex rounded-[var(--radius-sm)] border border-edge p-0.5", disabled && "opacity-40")}>
      {items.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          disabled={disabled}
          className={cn(
            "h-6 rounded-[3px] px-2.5 text-[12.5px] transition-colors",
            value === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Pane({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const lines = value === "" ? 0 : value.split("\n").length;
  return (
    <div className="panel flex min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="readout">{label}</span>
        {value && (
          <button onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
            <X size={12} /> Clear
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
      <div className="flex items-center gap-3 border-t border-edge px-3 py-1.5 readout tabular">
        <span>{lines.toLocaleString()} ln</span>
        <span className="ml-auto">{value.length.toLocaleString()} ch</span>
      </div>
    </div>
  );
}

function Seg({ seg }: { seg: Segment }) {
  if (seg.type === "eq") return <>{seg.text}</>;
  return (
    <span className={cn("rounded-[2px]", seg.type === "add" ? "bg-positive/25 text-positive" : "bg-danger/25 text-danger line-through decoration-danger/50")}>
      {seg.text}
    </span>
  );
}

function LineText({ text, segs, wrap }: { text: string; segs?: Segment[]; wrap: boolean }) {
  return (
    <span className={cn("min-w-0 flex-1 px-2", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
      {segs ? segs.map((s, i) => <Seg key={i} seg={s} />) : text || " "}
    </span>
  );
}

const NUM = "w-11 shrink-0 select-none border-r border-edge pr-2 text-right text-[11.5px] tabular text-faint";
const BG: Record<LineRow["kind"] | "empty", string> = {
  eq: "",
  add: "bg-positive/10",
  del: "bg-danger/10",
  mod: "",
  empty: "bg-raised/60",
};

function Fold({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      className="flex w-full items-center gap-2 border-y border-edge bg-base-2 px-3 py-1 text-left text-[12px] text-muted hover:bg-raised hover:text-ink"
    >
      <ChevronsUpDown size={12} /> {count.toLocaleString()} unchanged {count === 1 ? "line" : "lines"}
    </button>
  );
}

function UnifiedView({
  blocks,
  expanded,
  onExpand,
  wrap,
}: {
  blocks: Block[];
  expanded: Set<number>;
  onExpand: (start: number) => void;
  wrap: boolean;
}) {
  const line = (key: string, kind: "eq" | "add" | "del", aNo: number | undefined, bNo: number | undefined, text: string, segs?: Segment[]) => (
    <div key={key} className={cn("flex", BG[kind])}>
      <span className={NUM}>{aNo ?? ""}</span>
      <span className={NUM}>{bNo ?? ""}</span>
      <span className={cn("w-5 shrink-0 select-none text-center", kind === "add" ? "text-positive" : kind === "del" ? "text-danger" : "text-faint")}>
        {kind === "add" ? "+" : kind === "del" ? "−" : " "}
      </span>
      <LineText text={text} segs={segs} wrap={wrap} />
    </div>
  );
  return (
    <div className="py-1">
      {blocks.map((bl) =>
        bl.kind === "fold" && !expanded.has(bl.start) ? (
          <Fold key={`f${bl.start}`} count={bl.rows.length} onExpand={() => onExpand(bl.start)} />
        ) : (
          bl.rows.flatMap((r, i) => {
            const k = `${bl.start}-${i}`;
            if (r.kind === "eq") return [line(k, "eq", r.aNo, r.bNo, r.a ?? "")];
            if (r.kind === "add") return [line(k, "add", undefined, r.bNo, r.b ?? "")];
            if (r.kind === "del") return [line(k, "del", r.aNo, undefined, r.a ?? "")];
            return [line(`${k}a`, "del", r.aNo, undefined, r.a ?? "", r.aSegs), line(`${k}b`, "add", undefined, r.bNo, r.b ?? "", r.bSegs)];
          })
        ),
      )}
    </div>
  );
}

function SplitView({
  blocks,
  expanded,
  onExpand,
  wrap,
}: {
  blocks: Block[];
  expanded: Set<number>;
  onExpand: (start: number) => void;
  wrap: boolean;
}) {
  const cell = (kind: LineRow["kind"] | "empty", no: number | undefined, text: string | undefined, segs?: Segment[]) => (
    <div className={cn("flex min-w-0", BG[kind])}>
      <span className={NUM}>{no ?? ""}</span>
      {kind === "empty" ? <span className="flex-1" /> : <LineText text={text ?? ""} segs={segs} wrap={wrap} />}
    </div>
  );
  return (
    <div className="py-1">
      {blocks.map((bl) =>
        bl.kind === "fold" && !expanded.has(bl.start) ? (
          <Fold key={`f${bl.start}`} count={bl.rows.length} onExpand={() => onExpand(bl.start)} />
        ) : (
          bl.rows.map((r, i) => (
            <div key={`${bl.start}-${i}`} className="grid grid-cols-2 divide-x divide-edge">
              {r.kind === "add" ? cell("empty", undefined, undefined) : cell(r.kind === "mod" ? "del" : r.kind, r.aNo, r.a, r.aSegs)}
              {r.kind === "del" ? cell("empty", undefined, undefined) : cell(r.kind === "mod" ? "add" : r.kind, r.bNo, r.b, r.bSegs)}
            </div>
          ))
        ),
      )}
    </div>
  );
}
