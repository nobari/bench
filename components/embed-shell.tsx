"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getTool } from "@/lib/tools/registry";
import { ToolMount } from "@/components/tool-mount";
import { COLOR_KEY, THEME_KEY, applyColor, applyTheme, readStoredColor, readStoredTheme } from "@/lib/theme";

/** Tells the page that frames this one how tall the content is, so the frame can fit it. */
export const EMBED_HEIGHT_MESSAGE = "bench:embed-height";

/**
 * A tool without the site around it, for framing in a Markdown document: the widget, a slim bar with the tool's
 * name and a link to the full page carrying the same state, the host's theme and colour, and a height report
 * to the framing page whenever the content grows or shrinks.
 */
export function EmbedShell({ category, slug }: { category: string; slug: string }) {
  // Looked up here rather than passed in: a tool's icon is a component, which cannot cross from the server page.
  const tool = getTool(category, slug)!;
  const [openHref, setOpenHref] = useState(`/${category}/${slug}`);
  useEffect(() => {
    const sync = () => setOpenHref(`/${tool.category}/${tool.slug}${window.location.search}${window.location.hash}`);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    const id = setInterval(sync, 1500);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      clearInterval(id);
    };
  }, [tool.category, tool.slug]);
  useEffect(() => {
    if (window.parent === window) return;
    const post = () => window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height: Math.ceil(document.documentElement.scrollHeight) }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    post();
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) applyTheme(readStoredTheme());
      if (e.key === COLOR_KEY) applyColor(readStoredColor() ?? false);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      ro.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const Icon = tool.icon;
  return (
    <div className="flex min-h-full flex-col" data-embed-page>
      <div className="flex-1 px-3 py-3 sm:px-4">
        <ToolMount widget={tool.widget} widgetProps={tool.widgetProps} />
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5 text-[12px] text-muted sm:px-4">
        <Icon size={13} className="shrink-0 text-accent" />
        <span className="truncate">{tool.title}</span>
        <a href={openHref} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-accent hover:underline" data-embed-open>
          Open in Bench <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
