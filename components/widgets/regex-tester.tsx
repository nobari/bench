"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, Info, X } from "lucide-react";
import { CHEATSHEET, FLAGS, toLiteral, type Match, type RegexResult } from "@/lib/tools/web/regex";
import type { RegexRequest } from "./regex.worker";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const TIMEOUT_MS = 2500;
const MATCH_LIMIT = 5000;
const LIST_LIMIT = 500;

const DEFAULT_TEXT = `Contact: ada@example.com, bob@test.org
Released 2026-09-16, updated 2026-10-01.
# a comment line
const total = 42 + 7;`;

/** Text and replacement come from the compressed hash (Share) or plain `i`/`r` query params. */
function readInitial(): { text: string; replacement: string; hadText: boolean } {
  if (typeof window === "undefined") return { text: DEFAULT_TEXT, replacement: "", hadText: false };
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
  const text = dec(hash.get("i")) ?? q.get("i");
  return { text: text ?? DEFAULT_TEXT, replacement: dec(hash.get("r")) ?? q.get("r") ?? "", hadText: text !== null };
}

const MONO = "font-mono text-[13px] leading-relaxed";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent";

type Outcome = { kind: "idle" } | { kind: "result"; result: RegexResult } | { kind: "error"; error: string } | { kind: "timeout" };

export function RegexTesterWidget() {
  const [pattern, setPattern] = useQueryState("p", parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 200 }));
  const [flags, setFlags] = useQueryState("f", parseAsString.withDefault("g").withOptions({ history: "replace" }));
  const [initial] = useState(readInitial);
  const [text, setText] = useState(initial.text);
  const [replacement, setReplacement] = useState(initial.replacement);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [cheat, setCheat] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const reqRef = useRef(0);
  const preRef = useRef<HTMLPreElement | null>(null);

  const dPattern = useDeferredValue(pattern);
  const dText = useDeferredValue(text);
  const dReplacement = useDeferredValue(replacement);

  useEffect(() => {
    return () => {
      // Also drop the reference: StrictMode remounts would otherwise reuse a terminated worker.
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dPattern) {
      queueMicrotask(() => setOutcome({ kind: "idle" }));
      return;
    }
    const id = ++reqRef.current;
    if (!workerRef.current) {
      // A classic worker: Turbopack's worker bootstrap loads chunks with importScripts, which module workers forbid.
      const w = new Worker(new URL("./regex.worker.ts", import.meta.url));
      readyRef.current = new Promise<void>((resolve) => {
        const onReady = (e: MessageEvent<{ type?: string }>) => {
          if (e.data?.type === "ready") {
            w.removeEventListener("message", onReady);
            resolve();
          }
        };
        w.addEventListener("message", onReady);
      });
      w.addEventListener("error", () => {
        w.terminate();
        if (workerRef.current === w) workerRef.current = null;
        setOutcome({ kind: "error", error: "The matcher worker failed to start — reload the page and try again." });
      });
      workerRef.current = w;
    }
    const worker = workerRef.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent<{ id?: number; result?: RegexResult | { ok: false; error: string } }>) => {
      if (e.data.id !== id || !e.data.result || !active) return;
      clearTimeout(timer);
      setOutcome(e.data.result.ok ? { kind: "result", result: e.data.result } : { kind: "error", error: e.data.result.error });
    };
    worker.addEventListener("message", onMessage);
    const req: RegexRequest = { id, pattern: dPattern, flags, text: dText, replacement: dReplacement ? dReplacement : null, limit: MATCH_LIMIT };
    // The time limit covers matching only — not loading the worker script.
    readyRef.current.then(() => {
      if (!active) return;
      worker.postMessage(req);
      timer = setTimeout(() => {
        if (!active) return;
        worker.terminate();
        workerRef.current = null;
        setOutcome({ kind: "timeout" });
      }, TIMEOUT_MS);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
    };
  }, [dPattern, flags, dText, dReplacement]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (text && text !== DEFAULT_TEXT) h.set("i", compressToEncodedURIComponent(text));
      if (replacement) h.set("r", compressToEncodedURIComponent(replacement));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [text, replacement]);

  const toggleFlag = (f: string) => {
    const next = flags.includes(f) ? flags.replace(f, "") : flags + f;
    // u and v are mutually exclusive.
    const cleaned = f === "u" ? next.replace("v", "") : f === "v" ? next.replace("u", "") : next;
    setFlags([...new Set(cleaned)].sort().join(""));
  };

  const result = outcome.kind === "result" ? outcome.result : null;
  const matches = useMemo(() => result?.matches ?? [], [result]);
  const highlighted = useMemo(() => renderHighlights(dText, matches), [dText, matches]);

  return (
    <div className="space-y-3">
      {/* pattern + flags */}
      <div className={cn("panel", outcome.kind === "error" && "border-danger/50")}>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="flex min-w-[260px] flex-1 items-center rounded-[var(--radius-sm)] border border-edge bg-base px-2 focus-within:border-accent">
            <span className="select-none font-mono text-[14px] text-faint">/</span>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="pattern"
              className="h-9 min-w-0 flex-1 bg-transparent px-1 font-mono text-[14px] text-ink outline-none placeholder:text-faint"
            />
            <span className="select-none font-mono text-[14px] text-faint">/{flags}</span>
          </div>
          <div className="flex items-center gap-1">
            {FLAGS.map((f) => (
              <button
                key={f.flag}
                onClick={() => toggleFlag(f.flag)}
                title={`${f.label} — ${f.hint}`}
                aria-pressed={flags.includes(f.flag)}
                className={cn(
                  "h-8 w-8 rounded-[var(--radius-sm)] border font-mono text-[13px] transition-colors",
                  flags.includes(f.flag) ? "border-accent bg-accent-soft text-accent" : "border-edge text-muted hover:text-ink",
                )}
              >
                {f.flag}
              </button>
            ))}
          </div>
          <CopyButton value={pattern ? toLiteral(pattern, flags) : ""} label="Copy /literal/" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge px-3 py-1.5 text-[12.5px]">
          {outcome.kind === "error" && (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <AlertTriangle size={13} /> {outcome.error}
            </span>
          )}
          {outcome.kind === "timeout" && (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <AlertTriangle size={13} /> Stopped after {TIMEOUT_MS / 1000} s — this pattern backtracks catastrophically on this text. Make quantifiers
              more specific or anchor it.
            </span>
          )}
          {outcome.kind === "idle" && <span className="text-faint">Type a pattern — matches highlight as you type.</span>}
          {result && (
            <>
              <span className={cn("font-medium", matches.length ? "text-positive" : "text-muted")}>
                {matches.length === 0 ? "No matches" : `${matches.length.toLocaleString()}${result.truncated ? "+" : ""} match${matches.length === 1 ? "" : "es"}`}
              </span>
              <span className="text-faint">
                {result.groupCount} group{result.groupCount === 1 ? "" : "s"}
                {result.groupNames.length ? ` (${result.groupNames.join(", ")})` : ""} · {result.ms < 1 ? "<1" : result.ms.toFixed(0)} ms
              </span>
              {!flags.includes("g") && matches.length === 1 && <span className="text-faint">first match only — add the g flag for all</span>}
            </>
          )}
          <button onClick={() => setCheat((c) => !c)} className={cn("ml-auto inline-flex items-center gap-1 text-muted hover:text-ink", cheat && "text-accent")}>
            <Info size={13} /> Cheat sheet
          </button>
        </div>
      </div>

      {cheat && (
        <div className="panel grid gap-x-6 gap-y-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {CHEATSHEET.map((g) => (
            <div key={g.group}>
              <p className="text-[12.5px] font-semibold text-ink">{g.group}</p>
              <dl className="mt-1 space-y-0.5">
                {g.items.map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-[12px]">
                    <dt className="w-32 shrink-0 font-mono text-ink">{k}</dt>
                    <dd className="text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* test text with highlight overlay */}
        <div className="panel flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Test text</span>
            {text && (
              <button onClick={() => setText("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                <X size={12} /> Clear
              </button>
            )}
          </div>
          <div className="relative min-h-[260px] flex-1">
            <pre ref={preRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-3 text-transparent", MONO)}>
              {highlighted}
            </pre>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onScroll={(e) => {
                if (preRef.current) {
                  preRef.current.scrollTop = e.currentTarget.scrollTop;
                  preRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Text to test against…"
              className={cn("absolute inset-0 h-full w-full resize-none whitespace-pre-wrap break-words bg-transparent p-3 text-ink outline-none placeholder:text-faint", MONO)}
              style={{ caretColor: "var(--color-ink)" }}
            />
          </div>
          <div className="flex items-center gap-3 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{[...text].length.toLocaleString()} ch</span>
            <span>{text ? text.split("\n").length : 0} ln</span>
          </div>
        </div>

        {/* matches */}
        <div className="panel flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Matches</span>
            {matches.length > 0 && <CopyButton value={matches.map((m) => m.text).join("\n")} label="Copy all" />}
          </div>
          <div className="max-h-[420px] min-h-[120px] overflow-auto">
            {matches.length === 0 ? (
              <p className="p-3 text-[13px] text-muted">
                {outcome.kind === "result" ? "Nothing matched." : outcome.kind === "idle" ? "Matches, with their capture groups, appear here." : " "}
              </p>
            ) : (
              <ol className="divide-y divide-edge">
                {matches.slice(0, LIST_LIMIT).map((m, i) => (
                  <li key={i} className="px-3 py-2 text-[12.5px]">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="tabular text-faint">
                        #{i + 1} · {m.index}–{m.end}
                      </span>
                      <code className="break-all font-mono text-ink">{m.text === "" ? <span className="text-faint">(empty)</span> : visible(m.text)}</code>
                    </div>
                    {m.groups.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.groups.map((g) => (
                          <span key={g.key} className="inline-flex max-w-full items-baseline gap-1 rounded border border-edge px-1.5 py-0.5 font-mono text-[11.5px]">
                            <span className="text-muted">{/^\d+$/.test(g.key) ? `$${g.key}` : g.key}</span>
                            <span className={cn("truncate", g.value === undefined ? "text-faint italic" : "text-ink")}>
                              {g.value === undefined ? "undefined" : visible(g.value)}
                            </span>
                            {g.start !== undefined && (
                              <span className="text-faint">
                                @{g.start}–{g.end}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {matches.length > LIST_LIMIT && <p className="px-3 py-2 text-[12px] text-faint">Showing the first {LIST_LIMIT} of {matches.length.toLocaleString()} matches.</p>}
          </div>
        </div>
      </div>

      {/* replace */}
      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
          <span className="readout">Replace with</span>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            placeholder="$1, $<name>, $& … leave empty to skip"
            className="h-8 min-w-[220px] flex-1 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
          {result?.replaced !== undefined && <CopyButton value={result.replaced} label="Copy result" />}
          {replacement && (
            <button onClick={() => setReplacement("")} className={GHOST}>
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {result?.replaced !== undefined ? (
          <pre className={cn("max-h-[260px] overflow-auto whitespace-pre-wrap break-words p-3 text-ink", MONO)}>{result.replaced}</pre>
        ) : (
          <p className="px-3 py-2 text-[12.5px] text-faint">Enter a replacement to preview the result of text.replace(regex, replacement).</p>
        )}
      </div>
    </div>
  );
}

/** Make whitespace-only or control characters readable in the match list. */
function visible(s: string): string {
  return s.replace(/\n/g, "⏎").replace(/\t/g, "⇥").replace(/^ +| +$/g, (m) => "␣".repeat(m.length));
}

/** Text with matches wrapped in <mark>s (alternating tints) for the overlay. */
function renderHighlights(text: string, matches: Match[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.index < pos) return; // overlapping (sticky/lookahead edge cases)
    if (m.index > pos) out.push(text.slice(pos, m.index));
    if (m.end === m.index) {
      out.push(<span key={i} className="border-l-2 border-accent" />);
    } else {
      out.push(
        <mark key={i} className={cn("rounded-[2px] text-transparent", i % 2 ? "bg-warn/30" : "bg-accent/25")}>
          {text.slice(m.index, m.end)}
        </mark>,
      );
    }
    pos = m.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  // A trailing newline needs a placeholder so the overlay keeps the textarea's height.
  if (text.endsWith("\n")) out.push(" ");
  return out;
}
