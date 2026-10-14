import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allToolParams, getTool } from "@/lib/tools/registry";
import { ToolShell } from "@/components/tool-shell";
import { absoluteUrl } from "@/lib/site";

export const dynamicParams = false;

type Params = { category: string; tool: string };

export function generateStaticParams() {
  return allToolParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category, tool: slug } = await params;
  const tool = getTool(category, slug);
  if (!tool) return {};

  const path = `/${tool.category}/${tool.slug}`;
  return {
    title: tool.title,
    description: tool.description,
    keywords: tool.keywords,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title: tool.title,
      description: tool.description,
      url: absoluteUrl(path),
    },
    twitter: {
      card: "summary_large_image",
      title: tool.title,
      description: tool.description,
    },
  };
}

export default async function ToolPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category, tool: slug } = await params;
  const tool = getTool(category, slug);
  if (!tool) notFound();
  return <ToolShell tool={tool} />;
}
