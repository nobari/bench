"use client";

import { useState } from "react";
import { Check, Link2, Loader2 } from "lucide-react";
import { MAX_URL_LENGTH, type ShortenResponse } from "@/lib/tools/web/shortlink";
import { cn } from "@/lib/utils";

/** Share links longer than this go through the URL shortener (/web/short-url). */
export const SHORTEN_SHARE_ABOVE = 2000;

export type ShareResult = "full" | "short";

async function shorten(url: string): Promise<string | null> {
  try {
    const res = await fetch("/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ShortenResponse>;
    return data.shortUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Copy a share link to the clipboard. Long URLs are shortened first; if the
 * shortener is unavailable (or the URL exceeds its limit) the full URL is
 * copied instead. The clipboard write is promise-backed so Safari keeps the
 * user gesture alive across the network round-trip.
 */
export async function copyShareLink(url: string, opts: { forceFull?: boolean } = {}): Promise<ShareResult> {
  const wantShort = !opts.forceFull && url.length > SHORTEN_SHARE_ABOVE && url.length <= MAX_URL_LENGTH;
  if (!wantShort) {
    await navigator.clipboard.writeText(url);
    return "full";
  }

  let result: ShareResult = "full";
  const text = shorten(url).then((short) => {
    if (short) result = "short";
    return short ?? url;
  });

  if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) }),
      ]);
      return result;
    } catch {
      /* fall back to writeText below */
    }
  }
  await navigator.clipboard.writeText(await text);
  return result;
}

/** Copies the current page URL — which encodes the tool's state — shortening it when long. */
export function ShareButton({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | ShareResult>("idle");

  const share = async (e: React.MouseEvent) => {
    if (state === "busy") return;
    const href = window.location.href;
    const forceFull = e.shiftKey;
    if (!forceFull && href.length > SHORTEN_SHARE_ABOVE && href.length <= MAX_URL_LENGTH) setState("busy");
    try {
      const result = await copyShareLink(href, { forceFull });
      setState(result);
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("idle");
    }
  };

  const done = state === "full" || state === "short";
  const label =
    state === "busy" ? "Shortening…" : state === "short" ? "Short link copied" : state === "full" ? "Link copied" : "Share";

  return (
    <button
      type="button"
      onClick={share}
      title={`Copy a link to this exact state. Links over ${SHORTEN_SHARE_ABOVE.toLocaleString()} characters are shortened automatically (best-effort) — shift-click to copy the full URL.`}
      className={cn(
        "inline-flex h-8 select-none items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent",
        done && "border-positive text-positive",
        className,
      )}
    >
      {state === "busy" ? (
        <Loader2 size={13} className="animate-spin" />
      ) : done ? (
        <Check size={13} />
      ) : (
        <Link2 size={13} />
      )}
      {label}
    </button>
  );
}
