import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "signal" | "solid" | "outline" | "ghost";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  signal:
    "bg-accent text-[#070806] font-semibold hover:brightness-110 active:brightness-95",
  solid:
    "bg-raised text-ink border border-edge hover:border-edge-bright hover:bg-[#171c1e]",
  outline:
    "border border-edge text-ink hover:border-accent hover:text-accent bg-transparent",
  ghost: "text-muted hover:text-ink hover:bg-raised",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  icon: "h-9 w-9 justify-center",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "solid", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center rounded-[var(--radius-sm)] font-mono transition-[filter,background-color,border-color,color] duration-150 disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
