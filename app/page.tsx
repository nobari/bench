import Link from "next/link";
import { CATEGORIES } from "@/lib/tools/categories";
import { TOOLS, getToolsByCategory } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tool-card";
import { CommandTrigger } from "@/components/command-trigger";
import { jsonLdScript, toolItemListJsonLd, websiteJsonLd } from "@/lib/seo";

export default function HomePage() {
  return (
    <div className="px-4 py-6 sm:px-5 lg:px-8 lg:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(websiteJsonLd())} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(toolItemListJsonLd(TOOLS))} />

      <div className="max-w-2xl">
        <h1 className="text-[22px] font-semibold text-ink">All tools</h1>
        <p className="mt-1 text-[14px] text-muted">
          {TOOLS.length} utilities for text, data, images, files, hashing, time, color, math and the web.
          Everything runs in your browser, and every result has a link you can share.
        </p>
        <div className="mt-4">
          <CommandTrigger />
        </div>
      </div>

      <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {CATEGORIES.map((cat) => {
          const tools = getToolsByCategory(cat.slug);
          if (!tools.length) return null;
          const Icon = cat.icon;
          return (
            <section key={cat.slug} aria-labelledby={`cat-${cat.slug}`}>
              <h2
                id={`cat-${cat.slug}`}
                className="flex items-center gap-2 border-b border-edge pb-2 text-[13px] font-semibold text-ink"
              >
                <Icon size={14} style={{ color: `var(${cat.accentVar})` }} />
                <Link href={`/${cat.slug}`} className="hover:text-accent">
                  {cat.name}
                </Link>
                <span className="ml-auto text-[12px] font-normal tabular text-faint">{tools.length}</span>
              </h2>
              <ul className="-mx-2.5 mt-1.5">
                {tools.map((t) => (
                  <li key={t.slug}>
                    <ToolCard tool={t} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-[13px] text-muted">
        Missing something?{" "}
        <Link href="/suggest" className="text-accent hover:underline">
          Suggest a tool
        </Link>
        .
      </p>
    </div>
  );
}
