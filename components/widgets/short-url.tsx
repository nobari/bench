"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, QrCode, RotateCcw, Scissors, X } from "lucide-react";
import {
  MAX_URL_LENGTH,
  formatBytes,
  validateLongUrl,
  type ShortenResponse,
} from "@/lib/tools/web/shortlink";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/**
 * The long URL is deliberately NOT mirrored into the query string (it can be
 * 10,000 characters and may be private). `?i=` is read once for deep links and
 * `?missing=` is set by /s/<code> when a link is unknown or has been evicted.
 */
function readInitial(): { input: string; missing: string | null } {
  if (typeof window === "undefined") return { input: "", missing: null };
  const q = new URLSearchParams(window.location.search);
  return { input: q.get("i") ?? "", missing: q.get("missing") };
}

export function ShortUrlWidget() {
  const [initial] = useState(readInitial);
  const [input, setInput] = useState(initial.input);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShortenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingDismissed, setMissingDismissed] = useState(false);

  const validation = validateLongUrl(input);
  const showValidation = input.trim() !== "" && !validation.ok;
  const over = input.length > MAX_URL_LENGTH;

  const shorten = async () => {
    if (!validation.ok || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: validation.value }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ShortenResponse> & { error?: string };
      if (!res.ok || !data.shortUrl) {
        setError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
      } else {
        setResult(data as ShortenResponse);
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setInput("");
    setResult(null);
    setError(null);
  };

  return (
    <div className="space-y-3">
      {initial.missing && !missingDismissed && (
        <div className="panel flex items-start gap-2 border-warn/40 p-3 text-sm text-muted">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <p className="flex-1">
            The short link <span className="font-mono text-ink">/s/{initial.missing}</span> doesn&apos;t
            exist — it was never created, or it has been cleared to make room for newer links.
          </p>
          <button
            onClick={() => setMissingDismissed(true)}
            aria-label="Dismiss"
            className="text-faint hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* input */}
      <div className={cn("panel registered flex flex-col", showValidation && "border-danger/50")}>
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Long URL</span>
          {input && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") shorten();
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="https://example.com/a/very/long/path?with=lots&of=query&parameters…"
          className="min-h-[160px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-edge px-3 py-2">
          <span className={cn("readout tabular", over && "text-danger")}>
            {input.length.toLocaleString()} / {MAX_URL_LENGTH.toLocaleString()} ch
          </span>
          {showValidation && (
            <span className="font-mono text-xs text-danger">{validation.error}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-mono text-[10px] text-faint sm:inline">⌘⏎</span>
            <button
              onClick={shorten}
              disabled={!validation.ok || busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-[#070806] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
              {busy ? "Shortening…" : "Shorten"}
            </button>
          </div>
        </div>
      </div>

      {/* error */}
      {error && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}

      {/* result */}
      {result && (
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Short link</span>
            <div className="flex items-center gap-2">
              {result.reused && (
                <span
                  title="This URL had been shortened before, so you get the same link"
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 py-1 font-mono text-[10px] text-muted"
                >
                  <RotateCcw size={11} /> existing
                </span>
              )}
              <a
                href={result.shortUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <ExternalLink size={13} /> Open
              </a>
              <a
                href={`/generators/qr-code?i=${encodeURIComponent(result.shortUrl)}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <QrCode size={13} /> QR
              </a>
              <CopyButton value={result.shortUrl} />
            </div>
          </div>
          <div className="p-4">
            <a
              href={result.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glow break-all font-mono text-xl text-accent sm:text-2xl"
            >
              {result.shortUrl}
            </a>
            <p className="mt-3 max-w-prose text-xs leading-relaxed text-faint">
              Best-effort link: it stays up as long as there is room in the store. Older and larger
              links are cleared first, so treat it as a way to hand off a long URL — not a permanent
              reference.
            </p>
          </div>
          {result.store && (
            <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
              <span>{result.store.links.toLocaleString()} links stored</span>
              <span>
                {formatBytes(result.store.bytes)} of {formatBytes(result.store.capBytes)}
              </span>
              <span className="ml-auto">
                {Math.min(100, (result.store.bytes / result.store.capBytes) * 100).toFixed(1)}% full
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
