import Link from "next/link";
import { ArrowRight, Lightbulb, Lock, Link2, Infinity as InfinityIcon } from "lucide-react";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS, getToolsByCategory } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tool-card";
import { CommandTrigger } from "@/components/command-trigger";
import {
  jsonLdScript,
  toolItemListJsonLd,
  websiteJsonLd,
} from "@/lib/seo";

const VALUE_PROPS = [
  {
    icon: Lock,
    title: "Runs in your browser",
    body: "Every tool executes locally. Your text, JSON and images never leave your device.",
  },
  {
    icon: Link2,
    title: "Shareable by URL",
    body: "Inputs and settings live in the address bar — copy the link to reproduce any result.",
  },
  {
    icon: InfinityIcon,
    title: "No limits, no accounts",
    body: "No sign-up, no rate limits, no tracking. Open a tab and get to work.",
  },
];

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(websiteJsonLd())}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(toolItemListJsonLd(TOOLS))}
      />

      {/* ----------------------------------------------------------- HERO */}
      <section className="mx-auto max-w-[1240px] px-4 pt-12 sm:px-6 sm:pt-20">
        <div className="registered relative overflow-hidden rounded-[var(--radius-lg)] border border-edge bg-base-2 bg-ticks px-6 py-14 sm:px-12 sm:py-20">
          {/* phosphor bloom */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full opacity-[0.18] blur-3xl"
            style={{ background: "var(--color-signal)" }}
          />

          <p className="rise readout flex items-center gap-2" style={{ animationDelay: "0ms" }}>
            <span className="blink inline-block h-1.5 w-1.5 rounded-full bg-signal" />
            System online — {TOOLS.length} instruments — 100% local
          </p>

          <h1
            className="rise mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            A workbench of{" "}
            <span className="text-signal glow">precise, private</span> tools for
            the web.
          </h1>

          <p
            className="rise mt-5 max-w-xl text-balance text-base leading-relaxed text-muted sm:text-lg"
            style={{ animationDelay: "120ms" }}
          >
            Encode, decode, convert, inspect and generate — from Base64 and JSON
            to GIFs. Fast, shareable, and processed entirely in your browser.
          </p>

          <div
            className="rise mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
            style={{ animationDelay: "180ms" }}
          >
            <CommandTrigger />
            <Link
              href="#tools"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius)] border border-edge px-5 font-mono text-sm text-muted transition-colors hover:border-edge-bright hover:text-ink"
            >
              Browse all tools <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ TOOLS GRID */}
      <section id="tools" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 pt-20 sm:px-6">
        <div className="space-y-16">
          {CATEGORIES.map((cat) => {
            const tools = getToolsByCategory(cat.slug);
            if (!tools.length) return null;
            const Icon = cat.icon;
            return (
              <div
                key={cat.slug}
                style={{ ["--accent" as string]: `var(${cat.accentVar})` }}
              >
                <div className="flex items-end justify-between gap-4 border-b border-edge pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-accent">
                      <Icon size={17} />
                    </span>
                    <div>
                      <h2 className="font-display text-xl font-bold text-ink">
                        {cat.name}
                      </h2>
                      <p className="text-sm text-muted">{cat.tagline}</p>
                    </div>
                  </div>
                  <Link
                    href={`/${cat.slug}`}
                    className="hidden shrink-0 items-center gap-1 font-mono text-xs text-faint transition-colors hover:text-accent sm:flex"
                  >
                    View category <ArrowRight size={13} />
                  </Link>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tools.map((t) => (
                    <ToolCard key={t.slug} tool={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------ VALUE STRIP */}
      <section className="mx-auto max-w-[1240px] px-4 pt-24 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {VALUE_PROPS.map((v) => {
            const Icon = v.icon;
            return (
              <div key={v.title} className="panel p-5">
                <Icon size={18} className="text-signal" />
                <h3 className="mt-3 font-display text-base font-semibold text-ink">
                  {v.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {v.body}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* --------------------------------------------------------- SUGGEST */}
      <section className="mx-auto max-w-[1240px] px-4 pt-12 sm:px-6">
        <Link
          href="/suggest"
          className="group registered flex flex-col items-start justify-between gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-edge bg-surface p-6 transition-colors hover:border-signal sm:flex-row sm:items-center sm:p-8"
        >
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] border border-edge text-signal">
              <Lightbulb size={20} />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink">
                Missing a tool?
              </h2>
              <p className="text-sm text-muted">
                Suggest it — new instruments are added to the bench regularly.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 font-mono text-sm text-signal-dim transition-colors group-hover:text-signal">
            Suggest a tool <ArrowRight size={15} />
          </span>
        </Link>
      </section>
    </>
  );
}
