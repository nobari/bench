import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="readout text-signal">Error · 404</p>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink">
        Off the grid
      </h1>
      <p className="mt-3 text-sm text-muted">
        That instrument isn’t on the bench. It may have moved, or never existed.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-[var(--radius)] border border-edge px-4 font-mono text-sm text-ink transition-colors hover:border-signal hover:text-signal"
      >
        <ArrowLeft size={15} /> Back to the bench
      </Link>
    </div>
  );
}
