import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allToolParams, getTool } from "@/lib/tools/registry";
import { ToolShell } from "@/components/tool-shell";
import { pageMetadata } from "@/lib/seo";

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
    ...pageMetadata(tool.title, tool.description, path),
    keywords: tool.keywords,
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
