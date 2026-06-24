import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lock, Link2, Zap, Layers } from "lucide-react";
import { SITE } from "@/lib/site";
import { TOOLS } from "@/lib/tools/registry";

export const metadata: Metadata = {
  title: "About",
  description: `About ${SITE.name} — a fast, private, client-side toolkit for everyday text, data and image tasks.`,
  alternates: { canonical: "/about" },
};

const PRINCIPLES = [
  { icon: Lock, title: "Private by default", body: "Tools run entirely in your browser. Your data is never uploaded, logged or tracked." },
  { icon: Link2, title: "Shareable state", body: "Inputs and settings live in the URL, so a result is always one link away." },
  { icon: Zap, title: "Fast & static", body: "Pages are statically generated and served from the edge for instant loads." },
  { icon: Layers, title: "Always growing", body: "New instruments are added to the bench regularly — and you can suggest them." },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-faint">
        <Link href="/" className="hover:text-ink">Home</Link>
        <ChevronRight size={12} />
        <span className="text-muted">About</span>
      </nav>

      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
        A workbench, not a web app.
      </h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-muted">
        {SITE.name} is a growing collection of {TOOLS.length}+ precise, private
        utilities for the web — the kind of small tools you reach for a dozen
        times a day. Encode something, inspect some JSON, turn a few images into
        a GIF, and get back to work. No sign-up, no clutter, no nonsense.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {PRINCIPLES.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="panel p-5">
              <Icon size={18} className="text-signal" />
              <h2 className="mt-3 font-display text-base font-semibold text-ink">
                {p.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-10 panel registered flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Built something you wish existed here?
        </p>
        <Link
          href="/suggest"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius)] bg-signal px-4 font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110"
        >
          Suggest a tool
        </Link>
      </div>
    </div>
  );
}
