"use client";

/** The small shared pieces of PDF Studio's interface: button classes, a modal, menus. */
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const BTN = "inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
export const ICON_BTN = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
export const TOOL_BTN = "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40";
export const PRIMARY = "inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-2.5 text-[12px] font-medium text-on-accent transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40";

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose(): void; wide?: boolean }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-label={title} className={cn("max-h-full w-full overflow-auto rounded-[var(--radius)] border border-edge bg-base p-4 shadow-dialog", wide ? "max-w-xl" : "max-w-md")} onClick={(e) => e.stopPropagation()} data-pdf-dialog={title}>
        <div className="mb-3 flex items-center">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          <button type="button" onClick={onClose} className={cn(ICON_BTN, "ml-auto h-7 w-7 border-0")} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Menu({ children, onClose, align = "left" }: { children: React.ReactNode; onClose(): void; align?: "left" | "right" }) {
  return (
    <div role="menu" className={cn("absolute top-full z-40 mt-1 max-h-[70vh] min-w-56 overflow-auto rounded-[var(--radius)] border border-edge bg-base p-1 shadow-pop", align === "right" ? "right-0" : "left-0")} onClick={onClose} data-menu-list>
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, hint }: { children: React.ReactNode; onClick(): void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-faint">{hint}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 border-t border-edge" />;

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="readout px-2 pb-0.5 pt-1.5">{children}</div>;
}

/** A labelled row inside a dialog form. */
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-[13px]", className)}>
      <span className="text-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/** A short row of mutually exclusive choices. */
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { id: NoInfer<T>; label: string; title?: string }[]; onChange(v: NoInfer<T>): void; label?: string }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-edge p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} title={o.title} className={cn("h-7 rounded-[var(--radius-sm)] px-2 text-[12px] text-muted hover:text-ink", value === o.id && "bg-raised text-ink")} aria-pressed={value === o.id}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SWATCHES = ["#1b1b1f", "#c0392b", "#1f5fbf", "#1e8449", "#7d3c98", "#e67e22", "#7f8c8d", "#ffffff"];

export function ColorField({ value, onChange, label = "Colour" }: { value: string; onChange(v: string): void; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted">{label}</span>
      {SWATCHES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn("h-5 w-5 rounded-full border border-black/15", value.toLowerCase() === c && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--color-surface)]")} style={{ background: c }} aria-label={c} aria-pressed={value.toLowerCase() === c} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-7 cursor-pointer rounded border border-edge bg-transparent" aria-label={`${label} (any)`} />
    </span>
  );
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Page selection text shared by dialogs: "all", "current" or a range string. */
export function PageScope({ value, onChange, current, count }: { value: string; onChange(v: string): void; current: number; count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-muted">Pages</span>
      <Choice value={value === "all" || value === "current" ? value : "range"} options={[{ id: "all", label: `All ${count}` }, { id: "current", label: `Page ${current}` }, { id: "range", label: "Range" }]} onChange={(v) => onChange(v === "range" ? (value === "all" || value === "current" ? "" : value) : v)} />
      {value !== "all" && value !== "current" && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="1-3, 5, 8-" className="input h-7 w-32 px-2 py-0 text-[12px]" aria-label="Page range" autoFocus />}
    </div>
  );
}
