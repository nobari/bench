"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A monospace value cell that truncates with an ellipsis by default but:
 *  - shows the full value as a native tooltip (title) on hover, and
 *  - expands inline (wraps) when clicked or activated with the keyboard,
 * so a long, ellipsised value can always be read in full.
 */
export function ExpandableValue({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

  return (
    <code
      role="button"
      tabIndex={0}
      title={value}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn(
        "cursor-pointer rounded-[3px] font-mono outline-none transition-colors hover:bg-raised focus-visible:bg-raised",
        open ? "whitespace-pre-wrap break-all" : "truncate",
        className,
      )}
    >
      {value}
    </code>
  );
}
