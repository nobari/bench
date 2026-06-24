import Link from "next/link";
import { ChevronRight, ArrowUpRight } from "lucide-react";
import type { ToolDef } from "@/lib/tools/types";
import { getCategory } from "@/lib/tools/categories";
import { getRelatedTools } from "@/lib/tools/registry";
import { ToolMount } from "@/components/tool-mount";
import { ToolCard } from "@/components/tool-card";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdScript,
  softwareAppJsonLd,
} from "@/lib/seo";

export function ToolShell({ tool }: { tool: ToolDef }) {
  const cat = getCategory(tool.category);
  const related = getRelatedTools(tool);
  const base = `/${tool.category}/${tool.slug}`;
  const Icon = tool.icon;

  return (
    <div
      className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 sm:py-12"
      style={{ ["--accent" as string]: `var(${cat?.accentVar})` }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(softwareAppJsonLd(tool))}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: cat?.name ?? tool.category, path: `/${tool.category}` },
            { name: tool.title, path: base },
          ]),
        )}
      />
      {tool.faq?.length ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(tool.faq))}
        />
      ) : null}

      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-faint">
        <Link href="/" className="hover:text-ink">Home</Link>
        <ChevronRight size={12} />
        <Link href={`/${tool.category}`} className="hover:text-accent">
          {cat?.name}
        </Link>
        <ChevronRight size={12} />
        <span className="text-muted">{tool.title}</span>
      </nav>

      {/* header */}
      <header className="mt-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius)] border border-edge bg-surface text-accent">
          <Icon size={22} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            {tool.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted sm:text-base">
            {tool.tagline}
          </p>
        </div>
      </header>

      {/* the interactive widget */}
      <div className="mt-8">
        <ToolMount widget={tool.widget} widgetProps={tool.widgetProps} />
      </div>

      {/* content: how it works + examples + faq */}
      <div className="mt-14 grid gap-12 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-10">
          {tool.howItWorks && (
            <section>
              <h2 className="readout mb-3">How it works</h2>
              <p className="max-w-prose text-[15px] leading-relaxed text-muted">
                {tool.howItWorks}
              </p>
            </section>
          )}

          {tool.faq?.length ? (
            <section>
              <h2 className="readout mb-4">Frequently asked</h2>
              <div className="divide-y divide-edge border-y border-edge">
                {tool.faq.map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[15px] font-semibold text-ink">
                      {f.q}
                      <ChevronRight
                        size={16}
                        className="shrink-0 text-faint transition-transform group-open:rotate-90 group-open:text-accent"
                      />
                    </summary>
                    <p className="mt-2 max-w-prose pr-8 text-sm leading-relaxed text-muted">
                      {f.a}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-10">
          {tool.examples?.length ? (
            <section>
              <h2 className="readout mb-3">Try an example</h2>
              <ul className="space-y-2">
                {tool.examples.map((ex) => (
                  <li key={ex.query}>
                    <Link
                      href={`${base}?${ex.query}`}
                      className="group flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-edge bg-surface px-3 py-2.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                    >
                      {ex.label}
                      <ArrowUpRight size={14} className="text-faint group-hover:text-accent" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {related.length ? (
            <section>
              <h2 className="readout mb-3">Related tools</h2>
              <div className="grid gap-3">
                {related.map((t) => (
                  <ToolCard key={`${t.category}/${t.slug}`} tool={t} />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
