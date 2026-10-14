import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CATEGORIES, getCategory } from "@/lib/tools/categories";
import { getCategoryTree } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tool-card";
import { SITE, absoluteUrl } from "@/lib/site";
import { breadcrumbJsonLd, jsonLdScript, toolItemListJsonLd } from "@/lib/seo";

export const dynamicParams = false;

type Params = { category: string };

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) return {};
  const title = `${cat.name} Tools`;
  return {
    title,
    description: cat.description,
    alternates: { canonical: `/${cat.slug}` },
    openGraph: {
      type: "website",
      title: `${title} · ${SITE.name}`,
      description: cat.description,
      url: absoluteUrl(`/${cat.slug}`),
    },
  };
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) notFound();

  const tree = getCategoryTree(cat.slug);
  const tools = tree.flatMap((g) => g.tools);
  const grouped = tree.length > 1;
  const Icon = cat.icon;

  return (
    <div className="px-4 py-5 sm:px-5 lg:px-8" data-cat={cat.slug} style={{ "--cat": `var(${cat.accentVar})` } as CSSProperties}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: cat.name, path: `/${cat.slug}` },
          ]),
        )}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(toolItemListJsonLd(tools))} />

      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/" className="hover:text-ink">
          All tools
        </Link>
        <ChevronRight size={12} className="text-faint" />
        <span className="text-ink">{cat.name}</span>
      </nav>

      <header className="mt-2 flex items-center gap-3">
        <span
          className="cat-tile flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-edge bg-surface"
          style={{ color: `var(${cat.accentVar})` }}
        >
          <Icon size={17} />
        </span>
        <h1 className="cat-name text-[22px] font-semibold leading-tight text-ink">{cat.name}</h1>
        <span className="text-[13px] tabular text-faint">
          {tools.length} {tools.length === 1 ? "tool" : "tools"}
        </span>
      </header>
      <p className="mt-1.5 max-w-2xl text-[14px] text-muted">{cat.description}</p>

      {tools.length ? (
        <div className="mt-5 max-w-3xl space-y-5">
          {tree.map(({ group, tools: members }) => (
            <section key={group.id} id={group.id} className="scroll-mt-16" data-group={group.id}>
              {grouped && (
                <h2 className="readout flex items-center gap-2 border-b border-edge pb-1.5">
                  {group.name}
                  <span className="tabular text-faint">{members.length}</span>
                </h2>
              )}
              <ul className="-mx-2.5 mt-1">
                {members.map((t) => (
                  <li key={t.slug}>
                    <ToolCard tool={t} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-[13px] text-muted">
          Nothing here yet.{" "}
          <Link href="/suggest" className="text-accent hover:underline">
            Suggest the first tool
          </Link>
          .
        </p>
      )}
    </div>
  );
}
