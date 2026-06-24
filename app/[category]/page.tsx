import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CATEGORIES, getCategory } from "@/lib/tools/categories";
import { getToolsByCategory } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tool-card";
import { SITE, absoluteUrl } from "@/lib/site";
import { breadcrumbJsonLd, jsonLdScript, toolItemListJsonLd } from "@/lib/seo";

export const dynamicParams = false;

type Params = { category: string };

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
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

export default async function CategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category } = await params;
  const cat = getCategory(category);
  if (!cat) notFound();

  const tools = getToolsByCategory(cat.slug);
  const Icon = cat.icon;

  return (
    <div
      className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 sm:py-12"
      style={{ ["--accent" as string]: `var(${cat.accentVar})` }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: cat.name, path: `/${cat.slug}` },
          ]),
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(toolItemListJsonLd(tools))}
      />

      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-faint">
        <Link href="/" className="hover:text-ink">Home</Link>
        <ChevronRight size={12} />
        <span className="text-muted">{cat.name}</span>
      </nav>

      <header className="mt-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius)] border border-edge bg-surface text-accent">
          <Icon size={22} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            {cat.name}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted sm:text-base">
            {cat.description}
          </p>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <ToolCard key={t.slug} tool={t} />
        ))}
      </div>

      {tools.length === 0 && (
        <p className="mt-8 font-mono text-sm text-faint">
          No tools here yet — they’re on the way.
        </p>
      )}
    </div>
  );
}
