import { cn } from "@/lib/utils";

/** The bench glyph: a top and two legs. */
export function BenchMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <rect x="2" y="6.5" width="20" height="4" rx="1" />
      <rect x="5" y="10.5" width="3" height="7" />
      <rect x="16" y="10.5" width="3" height="7" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-accent text-on-accent">
        <BenchMark className="h-4 w-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">Bench</span>
    </span>
  );
}
