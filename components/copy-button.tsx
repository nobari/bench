"use client";

import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { ClipboardFallback } from "@/components/clipboard-fallback";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
  disabled,
}: {
  value: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }, [value]);

  return (
    <span className="inline-flex min-w-0 flex-col items-start">
    <button
      type="button"
      onClick={copy}
      disabled={disabled || !value}
      aria-label={label}
      aria-live="polite"
      className={cn(
        "inline-flex h-8 select-none items-center gap-1.5 rounded-[var(--radius-sm)] border border-accent bg-accent px-2.5 text-[13px] text-on-accent transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-40",
        copied && "border-positive bg-positive",
        className,
      )}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
    {failed && <ClipboardFallback value={value} onClose={() => setFailed(false)} />}
    </span>
  );
}
