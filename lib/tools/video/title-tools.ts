/**
 * Titles for shorts: the words of a title with their highlights and when each appears, the placeholders a title set
 * fills per short ({part}, {of}, {name}, {date}, {short}), the style presets, and a short's titles copied to every
 * other short. Pure and deterministic.
 */
import { newId, type Project, type Short, type Title } from "./project";

export interface Placeholders {
  part?: number;
  of?: number;
  name?: string;
  date?: string;
  short?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct 2026" from a recording's name such as DJI_20261012100000_0001_D.MP4, or null. */
export function dateFromName(name: string): string | null {
  const m = name.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}

/** What the placeholders stand for in this project and, in Short mode, this short. */
export function placeholdersFor(project: Project, short: Short | null): Placeholders {
  const shorts = project.shorts ?? [];
  const index = short ? shorts.findIndex((s) => s.id === short.id) + 1 : 0;
  const firstName = Object.values(project.media)[0]?.name ?? "";
  return { part: index || undefined, of: shorts.length || undefined, name: project.name, short: short?.name, date: dateFromName(firstName) ?? undefined };
}

/** The text with its placeholders filled; an unknown one stays as written. */
export function fillPlaceholders(text: string, p: Placeholders): string {
  return text.replace(/\{(part|of|name|date|short)\}/gi, (whole, key: string) => {
    const v = p[key.toLowerCase() as keyof Placeholders];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** The titles with their placeholders filled, for a view or an export. */
export const fillTitles = (titles: Title[], p: Placeholders): Title[] => titles.map((t) => (/\{(part|of|name|date|short)\}/i.test(t.text + (t.subtitle ?? "")) ? { ...t, text: fillPlaceholders(t.text, p), subtitle: t.subtitle ? fillPlaceholders(t.subtitle, p) : t.subtitle } : t));

export interface Word {
  text: string;
  highlight: boolean;
}

/** The words of a title, a *starred* word marked for the highlight colour; the stars themselves are not shown. */
export function splitWords(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const m = w.match(/^\*(.+?)\*([.,!?;:]*)$/);
      return m ? { text: m[1] + m[2], highlight: true } : { text: w, highlight: false };
    });
}

/**
 * When each word appears, seconds after the title's start: the title's own times when it has them (padded with the
 * last, cut to the words), else the words spread evenly over the time before the fade-out, the first at once.
 */
export function wordTimes(title: Pick<Title, "text" | "duration" | "fade" | "wordAt">): number[] {
  const n = splitWords(title.text).length;
  if (!n) return [];
  if (title.wordAt?.length) {
    const given = [...title.wordAt].sort((a, b) => a - b);
    return Array.from({ length: n }, (_, i) => given[Math.min(i, given.length - 1)]);
  }
  const span = Math.max(0.3, title.duration - Math.max(title.fade, 0.1));
  return Array.from({ length: n }, (_, i) => Math.round(((span * i) / n) * 1e3) / 1e3);
}

/** A style preset for shorts: what it changes on a title; the kind, text and timing stay. */
export interface TitlePreset {
  id: string;
  name: string;
  hint: string;
  patch: Partial<Pick<Title, "color" | "background" | "weight" | "shadow" | "shadowColor" | "padding" | "radius" | "letterSpacing" | "borderWidth" | "borderColor" | "italic" | "highlight">>;
}
export const TITLE_PRESETS: TitlePreset[] = [
  { id: "bold", name: "Bold outline", hint: "White, heavy, outlined in black — reads over anything", patch: { color: "#ffffff", background: "", weight: 800, shadow: "outline", shadowColor: "rgba(0,0,0,0.85)", padding: 0.4, radius: 0.15, letterSpacing: -0.01, borderWidth: 0, italic: false, highlight: "#ffd60a" } },
  { id: "pill", name: "Dark pill", hint: "White on a rounded dark pill", patch: { color: "#ffffff", background: "rgba(0,0,0,0.6)", weight: 700, shadow: "none", padding: 0.5, radius: 0.6, letterSpacing: 0, borderWidth: 0, italic: false, highlight: "#ffd60a" } },
  { id: "box", name: "Black box", hint: "White on a square black box, the subtitle look", patch: { color: "#ffffff", background: "#000000", weight: 700, shadow: "none", padding: 0.35, radius: 0.08, letterSpacing: 0, borderWidth: 0, italic: false, highlight: "#ffd60a" } },
  { id: "yellow", name: "Yellow", hint: "Yellow, heavy, outlined — the punchline colour", patch: { color: "#ffd60a", background: "", weight: 800, shadow: "outline", shadowColor: "rgba(0,0,0,0.85)", padding: 0.4, radius: 0.15, letterSpacing: -0.01, borderWidth: 0, italic: false, highlight: "#ffffff" } },
  { id: "neon", name: "Neon glow", hint: "Bright on a soft glow of its own colour", patch: { color: "#5cf2ff", background: "", weight: 700, shadow: "soft", shadowColor: "rgba(92,242,255,0.9)", padding: 0.4, radius: 0.15, letterSpacing: 0.02, borderWidth: 0, italic: false, highlight: "#ff5cf2" } },
  { id: "minimal", name: "Minimal", hint: "Light, spaced, no box, no shadow", patch: { color: "#ffffff", background: "", weight: 400, shadow: "none", padding: 0.4, radius: 0.15, letterSpacing: 0.08, borderWidth: 0, italic: false, highlight: "#ffd60a" } },
];
export function applyTitlePreset(t: Title, id: string): Title {
  const p = TITLE_PRESETS.find((x) => x.id === id);
  return p ? { ...t, ...p.patch } : t;
}

/**
 * One short's titles as the set for every short: each other short loses its own titles and gets copies at the same
 * offsets from its start, cut to its length, with their placeholders left to fill per short.
 */
export function copyTitlesToShorts(project: Project, fromShortId: string): Project {
  const shorts = project.shorts ?? [];
  const from = shorts.find((s) => s.id === fromShortId);
  if (!from) return project;
  const set = project.titles.filter((t) => t.short === fromShortId);
  const kept = project.titles.filter((t) => !t.short || t.short === fromShortId);
  const copies: Title[] = [];
  for (const s of shorts) {
    if (s.id === fromShortId) continue;
    for (const t of set) {
      const start = s.from + (t.start - from.from);
      if (start >= s.to) continue;
      copies.push({ ...t, id: newId(), short: s.id, start: Math.max(s.from, start), duration: Math.min(t.duration, s.to - Math.max(s.from, start)) });
    }
  }
  return { ...project, titles: [...kept, ...copies] };
}
