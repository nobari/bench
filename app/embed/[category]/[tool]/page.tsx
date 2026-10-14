import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allToolParams, getTool } from "@/lib/tools/registry";
import { EmbedShell } from "@/components/embed-shell";

export const dynamicParams = false;

type Params = { category: string; tool: string };

export function generateStaticParams() {
  return allToolParams();
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category, tool: slug } = await params;
  const tool = getTool(category, slug);
  if (!tool) return {};
  return { title: tool.title, description: tool.description, robots: { index: false, follow: false }, alternates: { canonical: `/${tool.category}/${tool.slug}` } };
}

/** A tool on its own, without the site around it: what a Markdown `embed` block frames. */
export default async function EmbedPage({ params }: { params: Promise<Params> }) {
  const { category, tool: slug } = await params;
  const tool = getTool(category, slug);
  if (!tool) notFound();
  return <EmbedShell category={tool.category} slug={tool.slug} />;
}
