"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Long prose clamped to a few lines with a fade and a "Read more" control; the full text stays in the DOM, so
 * search engines and readers who expand it see the same thing. Short texts show no control at all.
 */
export function ReadMore({ children, maxHeight = 176, className }: { children: React.ReactNode; maxHeight?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOverflows(el.scrollHeight > maxHeight + 8));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);
  const clamped = overflows && !open;
  return (
    <div className={className} data-read-more={overflows ? (open ? "open" : "clamped") : "short"}>
      <div ref={ref} className={cn("relative overflow-hidden transition-[max-height]", clamped && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]")} style={{ maxHeight: clamped ? maxHeight : undefined }}>
        {children}
      </div>
      {overflows && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-[13px] font-medium text-accent hover:underline" data-read-more-toggle>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
