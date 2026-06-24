import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ToolDef } from "@/lib/tools/types";
import { getCategory } from "@/lib/tools/categories";
import { cn } from "@/lib/utils";

export function ToolCard({
  tool,
  className,
}: {
  tool: ToolDef;
  className?: string;
}) {
  const Icon = tool.icon;
  const cat = getCategory(tool.category);

  return (
    <Link
      href={`/${tool.category}/${tool.slug}`}
      style={{ ["--accent" as string]: `var(${cat?.accentVar})` }}
      className={cn(
        "group registered relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius)] border border-edge bg-surface p-4 transition-colors duration-200 hover:border-accent",
        className,
      )}
    >
      {/* accent wash on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, var(--accent) -40%, transparent 45%)",
          mixBlendMode: "soft-light",
        }}
      />
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-edge bg-base text-muted transition-colors group-hover:border-accent group-hover:text-accent">
          <Icon size={17} />
        </span>
        {tool.status === "beta" && (
          <span className="readout rounded border border-edge px-1.5 py-0.5 text-[10px] text-warn">
            beta
          </span>
        )}
      </div>

      <div className="flex-1">
        <h3 className="font-display text-[15px] font-semibold leading-tight text-ink">
          {tool.title}
        </h3>
        <p className="mt-1 text-[13px] leading-snug text-muted">
          {tool.tagline}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="readout text-[10px]">{cat?.name}</span>
        <ArrowUpRight
          size={15}
          className="text-faint transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
        />
      </div>
    </Link>
  );
}
