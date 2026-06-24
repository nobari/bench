"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copies the current page URL — which encodes the tool's state — to the clipboard. */
export function ShareButton({ className }: { className?: string }) {
  const [done, setDone] = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className={cn(
        "inline-flex h-8 select-none items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent",
        done && "border-positive text-positive",
        className,
      )}
    >
      {done ? <Check size={13} /> : <Link2 size={13} />}
      {done ? "Link copied" : "Share"}
    </button>
  );
}
