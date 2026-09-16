import Link from "next/link";
import type { ToolDef } from "@/lib/tools/types";
import { toolShortTitle } from "@/lib/tools/types";
import { getCategory } from "@/lib/tools/categories";
import { cn } from "@/lib/utils";

/** One row in a tool index: icon, name, one-line purpose. */
export function ToolCard({ tool, className }: { tool: ToolDef; className?: string }) {
  const Icon = tool.icon;
  const cat = getCategory(tool.category);

  return (
    <Link
      href={`/${tool.category}/${tool.slug}`}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors hover:bg-raised",
        className,
      )}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-edge bg-surface"
        style={{ color: `var(${cat?.accentVar})` }}
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{toolShortTitle(tool)}</span>
          {tool.status === "beta" && (
            <span className="shrink-0 rounded border border-edge px-1 text-[10px] font-medium leading-4 text-muted">
              beta
            </span>
          )}
        </span>
        <span className="block truncate text-[12.5px] text-muted">{tool.tagline}</span>
      </span>
    </Link>
  );
}
