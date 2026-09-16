import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "signal" | "solid" | "outline" | "ghost";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent font-medium hover:bg-[var(--color-accent-hover)]",
  // Legacy alias kept for older widgets.
  signal: "bg-accent text-on-accent font-medium hover:bg-[var(--color-accent-hover)]",
  solid: "border border-edge bg-surface text-ink hover:border-edge-bright hover:bg-raised",
  outline: "border border-edge bg-transparent text-ink hover:border-accent hover:text-accent",
  ghost: "text-muted hover:bg-raised hover:text-ink",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
  icon: "h-9 w-9 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "solid", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center rounded-[var(--radius-sm)] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
