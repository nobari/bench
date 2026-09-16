import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ToolDef } from "@/lib/tools/types";
import { getCategory } from "@/lib/tools/categories";
import { getRelatedTools } from "@/lib/tools/registry";
import { ToolMount } from "@/components/tool-mount";
import { ToolCard } from "@/components/tool-card";
import { ShareButton } from "@/components/share-button";
import { breadcrumbJsonLd, faqJsonLd, jsonLdScript, softwareAppJsonLd } from "@/lib/seo";

export function ToolShell({ tool }: { tool: ToolDef }) {
  const cat = getCategory(tool.category);
  const related = getRelatedTools(tool);
  const base = `/${tool.category}/${tool.slug}`;
  const Icon = tool.icon;

  return (
    <div className="px-4 py-5 sm:px-5 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(softwareAppJsonLd(tool))} />
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
        <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd(tool.faq))} />
      ) : null}

      {/* header: where you are, what this does, and the one primary action */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-muted">
            <Link href="/" className="hover:text-ink">
              All tools
            </Link>
            <ChevronRight size={12} className="text-faint" />
            <Link href={`/${tool.category}`} className="hover:text-ink">
              {cat?.name}
            </Link>
          </nav>
          <div className="mt-2 flex items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-edge bg-surface"
              style={{ color: `var(${cat?.accentVar})` }}
            >
              <Icon size={17} />
            </span>
            <h1 className="text-[22px] font-semibold leading-tight text-ink">{tool.title}</h1>
            {tool.status === "beta" && (
              <span className="rounded border border-edge px-1.5 text-[11px] font-medium leading-5 text-muted">
                beta
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">{tool.tagline}</p>
        </div>
        <ShareButton className="w-full sm:w-auto" />
      </header>

      <div className="mt-5">
        <ToolMount widget={tool.widget} widgetProps={tool.widgetProps} />
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-10">
          {tool.howItWorks && (
            <section>
              <h2 className="text-[15px] font-semibold text-ink">How it works</h2>
              <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-muted">{tool.howItWorks}</p>
            </section>
          )}

          {tool.faq?.length ? (
            <section>
              <h2 className="text-[15px] font-semibold text-ink">Questions</h2>
              <div className="mt-2 divide-y divide-edge border-y border-edge">
                {tool.faq.map((f) => (
                  <details key={f.q} className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-medium text-ink">
                      {f.q}
                      <ChevronRight
                        size={15}
                        className="shrink-0 text-faint transition-transform group-open:rotate-90"
                      />
                    </summary>
                    <p className="mt-2 max-w-prose pr-8 text-[13.5px] leading-relaxed text-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-8">
          {tool.examples?.length ? (
            <section>
              <h2 className="text-[13px] font-semibold text-ink">Examples</h2>
              <ul className="mt-2 space-y-1">
                {tool.examples.map((ex) => (
                  <li key={ex.query}>
                    {/* A plain anchor: widgets read large inputs from the URL once on mount, so an
                        example must remount the page rather than soft-navigate within it. */}
                    <a
                      href={`${base}?${ex.query}`}
                      className="block rounded-[var(--radius-sm)] border border-edge bg-surface px-3 py-2 text-[13px] text-ink transition-colors hover:border-accent"
                    >
                      {ex.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {related.length ? (
            <section>
              <h2 className="text-[13px] font-semibold text-ink">Related tools</h2>
              <ul className="-mx-2.5 mt-1">
                {related.map((t) => (
                  <li key={`${t.category}/${t.slug}`}>
                    <ToolCard tool={t} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
