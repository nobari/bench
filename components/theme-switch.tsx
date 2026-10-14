"use client";

import { useEffect, useState } from "react";
import { Moon, Palette, Sun, TreeDeciduous } from "lucide-react";
import { THEMES, currentColor, currentTheme, setColor, setTheme, subscribeColor, subscribeTheme, type Theme } from "@/lib/theme";
import { useShareState } from "@/lib/share-state";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof Sun> = { light: Sun, wood: TreeDeciduous, dark: Moon };

/**
 * Light / Wood / Dark: three buttons, the showing one pressed, and next to them the colour switch; both choices
 * are remembered per browser. Colour rides in share links softly; the theme never does.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [color, setColorState] = useState(false);
  useShareState("ui", color ? { color: true } : null);
  useEffect(() => {
    queueMicrotask(() => {
      setThemeState(currentTheme());
      setColorState(currentColor());
    });
    const unsub = subscribeTheme(setThemeState);
    const unsubColor = subscribeColor(setColorState);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => setThemeState(currentTheme());
    mq.addEventListener("change", onSystem);
    return () => {
      unsub();
      unsubColor();
      mq.removeEventListener("change", onSystem);
    };
  }, []);
  return (
    <div role="group" aria-label="Appearance" className={cn("flex h-8 items-center rounded-[var(--radius-sm)] border border-edge p-0.5", className)} data-theme-switch>
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
      <span className="mx-0.5 h-5 w-px bg-edge" aria-hidden />
      <button
        type="button"
        onClick={() => {
          setColorState(!color);
          setColor(!color);
        }}
        aria-pressed={color}
        aria-label={color ? "Turn colours off" : "Turn colours on"}
        title={color ? "Colours on: actions, links, status and categories in colour. Click for the neutral look." : "Colours off: the neutral graphite look. Click for coloured actions, links, status and categories."}
        className={cn("flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius-sm)-2px)] transition-colors", color ? "bg-accent text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}
        data-color-toggle
      >
        <Palette size={14} />
      </button>
    </div>
  );
}
