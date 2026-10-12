"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, TreeDeciduous } from "lucide-react";
import { THEMES, currentTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = { light: Sun, wood: TreeDeciduous, dark: Moon };

/** Light / Wood / Dark: three buttons, the showing one pressed; the choice is remembered per browser. */
export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    queueMicrotask(() => setThemeState(currentTheme()));
    const unsub = subscribeTheme(setThemeState);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => setThemeState(currentTheme());
    mq.addEventListener("change", onSystem);
    return () => {
      unsub();
      mq.removeEventListener("change", onSystem);
    };
  }, []);
  return (
    <div role="group" aria-label="Theme" className={cn("flex h-8 items-center rounded-[var(--radius-sm)] border border-edge p-0.5", className)} data-theme-switch>
      {THEMES.map(({ id, name, hint }) => {
        const Icon = ICONS[id];
        const on = theme === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setThemeState(id);
              setTheme(id);
            }}
            aria-pressed={on}
            aria-label={`${name} theme`}
            title={`${name}: ${hint}`}
            className={cn("flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius-sm)-2px)] transition-colors", on ? "bg-accent text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}
            data-theme-value={id}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
