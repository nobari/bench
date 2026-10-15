"use client";

/** Small shared pieces for the wallet panels: buttons, segmented controls, fields, notes, amounts, modals. */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fiatValue, formatAmount, formatFiat, type Fiat, type Unit } from "@/lib/tools/crypto/btc/units";

export function Btn({ tone = "ghost", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" | "warn" }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 font-mono text-xs transition-colors disabled:pointer-events-none disabled:opacity-40",
        tone === "primary" && "bg-accent font-semibold text-on-accent hover:brightness-110",
        tone === "ghost" && "border border-edge text-muted hover:border-accent hover:text-accent",
        tone === "danger" && "border border-danger/50 text-danger hover:bg-danger/10",
        tone === "warn" && "border border-warn/60 text-warn hover:bg-warn/10",
        className,
      )}
    />
  );
}

export function Seg<T extends string>({ options, value, onChange, size = "sm", className, name }: { options: { id: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; size?: "sm" | "xs"; className?: string; name?: string }) {
  return (
    <div className={cn("flex rounded-[var(--radius-sm)] border border-edge p-0.5", className)} role="tablist" data-seg={name}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          title={o.title}
          data-seg-option={o.id}
          onClick={() => onChange(o.id)}
          className={cn("rounded-[3px] font-mono transition-colors", size === "sm" ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-[11px]", value === o.id ? "bg-accent text-on-accent" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center justify-between">
        <span className="readout">{label}</span>
        {right}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}

export function Note({ tone = "info", children, className, ...rest }: { tone?: "info" | "ok" | "warn" | "error"; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-[var(--radius-sm)] border px-3 py-2 text-[12.5px] leading-relaxed",
        tone === "info" && "border-edge bg-raised/40 text-muted",
        tone === "ok" && "border-positive/40 bg-positive/[0.06] text-positive",
        tone === "warn" && "border-warn/40 bg-warn/[0.06] text-warn",
        tone === "error" && "border-danger/40 bg-danger/[0.06] text-danger",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Money({ sats, unit, fiat, price, className, sign, size = "md" }: { sats: bigint; unit: Unit; fiat: Fiat | "none"; price: number | null; className?: string; sign?: boolean; size?: "sm" | "md" | "lg" }) {
  const text = formatAmount(sats, unit);
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 tabular", className)}>
      <span className={cn("font-mono", size === "lg" ? "text-xl font-semibold text-ink" : size === "md" ? "text-sm text-ink" : "text-xs text-ink")}>
        {sign && sats > 0n ? "+" : ""}
        {text}
      </span>
      {fiat !== "none" && price !== null && <span className={cn("font-mono text-faint", size === "lg" ? "text-xs" : "text-[11px]")}>≈ {formatFiat(fiatValue(sats < 0n ? -sats : sats, price), fiat)}</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-modal={testId}>
      <div className={cn("panel shadow-dialog w-full", wide ? "max-w-3xl" : "max-w-xl")} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Row({ k, v, mono = true, className }: { k: ReactNode; v: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 py-1.5 text-[12.5px]", className)}>
      <span className="shrink-0 text-muted">{k}</span>
      <span className={cn("min-w-0 break-all text-right text-ink", mono && "font-mono")}>{v}</span>
    </div>
  );
}

export const inputCls = "input";
export const when = (t: number | null | undefined) => (t ? new Date(t * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "pending");
