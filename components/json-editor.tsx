"use client";

import { useRef } from "react";
import { highlightJson } from "@/lib/tools/json/utils";
import { cn } from "@/lib/utils";

/** Shared by both layers so the typed text and its coloured copy sit on the same pixels. */
const METRICS = "m-0 whitespace-pre-wrap break-words font-mono";

/**
 * A JSON textarea with syntax colouring: the text is typed into a transparent textarea laid over a coloured copy of
 * itself, so editing, selecting, scrolling and resizing all work as in a plain textarea while the keys, strings,
 * numbers and literals keep the viewer's token colours.
 */
export function JsonEditor({
  value,
  onChange,
  placeholder,
  className,
  textClass = "text-[13px] leading-relaxed",
  padding = "p-3",
  minHeight = "min-h-[300px]",
  resize = "resize-y",
  readOnly,
  ariaLabel,
  ...data
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  /** The wrapper: it grows with the textarea. */
  className?: string;
  /** Font size and line height, applied to both layers. */
  textClass?: string;
  padding?: string;
  minHeight?: string;
  resize?: string;
  readOnly?: boolean;
  ariaLabel?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const sync = (el: HTMLTextAreaElement) => {
    const pre = preRef.current;
    if (!pre) return;
    pre.scrollTop = el.scrollTop;
    pre.scrollLeft = el.scrollLeft;
  };
  return (
    <div className={cn("relative flex min-w-0 flex-1 flex-col", className)} data-json-editor="" {...data}>
      <pre
        ref={preRef}
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 overflow-hidden text-ink", METRICS, textClass, padding)}
        dangerouslySetInnerHTML={{ __html: highlightJson(value) + "\n" }}
      />
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={(e) => sync(e.currentTarget)}
        onInput={(e) => sync(e.currentTarget)}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn("relative w-full flex-1 bg-transparent text-transparent outline-none placeholder:text-faint", METRICS, textClass, padding, minHeight, resize)}
        style={{ caretColor: "var(--color-ink)" }}
      />
    </div>
  );
}

/** Read-only JSON with the same colouring. */
export function JsonBlock({ value, className, ...data }: { value: string; className?: string } & Record<`data-${string}`, string | boolean | undefined>) {
  return <pre className={cn("overflow-auto whitespace-pre-wrap break-words font-mono text-ink", className)} dangerouslySetInnerHTML={{ __html: highlightJson(value) }} data-json-block="" {...data} />;
}
