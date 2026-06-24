import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lightbulb } from "lucide-react";
import { SuggestForm } from "@/components/suggest-form";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Suggest a Tool",
  description:
    "Missing a utility on Bench? Suggest a new tool and it may be added to the bench. Submissions become public GitHub issues.",
  alternates: { canonical: "/suggest" },
};

export default function SuggestPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-faint">
        <Link href="/" className="hover:text-ink">Home</Link>
        <ChevronRight size={12} />
        <span className="text-muted">Suggest a tool</span>
      </nav>

      <header className="mt-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius)] border border-edge bg-surface text-signal">
          <Lightbulb size={22} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Suggest a tool
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted sm:text-base">
            Got an idea for a utility {SITE.name} should have? Tell us what it
            should do. Good suggestions get built — submissions are filed as
            public GitHub issues you can follow.
          </p>
        </div>
      </header>

      <div className="mt-8">
        <SuggestForm />
      </div>
    </div>
  );
}
