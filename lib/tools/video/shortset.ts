/**
 * A set of shorts cut from one drive: the shorts folder holds this file — the source recordings and their order, the
 * music with its beats, the plan and the list of shorts — and one sub-folder per short with an ordinary editor project
 * in it, so any short opens in the Video Editor. Footage is never copied; it is referred to by handle and place.
 */

import type { BeatGrid } from "./beats";
import { DEFAULT_PLAN, type PlanSettings } from "./shortplan";
import { deserialize, newId, newProject, type Clip, type MediaRef, type Project } from "./project";
import { PLATFORM_IDS, type PlatformId } from "./shorts";

export const SET_FILE = "shorts.benchshorts.json";

export interface ShortEntry {
  /** The short's project id and the sub-folder it lives in. */
  id: string;
  folder: string;
  name: string;
  seconds: number;
  scenes: number;
  updatedAt: number;
  /** The last export written for it, when one was. */
  exported?: { name: string; bytes: number; at: number };
}

export interface ShortsSet {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Every recording and song the set knows, by id. */
  media: Record<string, MediaRef>;
  /** The drive as a timeline: the recordings in order with their trims and grades (an editor project's clips when one was opened). */
  clips: Clip[];
  customLut?: { name: string; cube: string } | null;
  /** The editor project folder the footage came from, for the record. */
  sourceName?: string | null;
  /** The music for the set and its beats once read. */
  music: { media: string; grid: BeatGrid | null } | null;
  plan: PlanSettings;
  /** Proxy state per media id, like a project's. */
  proxies: Record<string, { ready: boolean; file?: string }>;
  /** Remembered folders outside the shorts folder, by key: their names. */
  folders?: Record<string, string>;
  shorts: ShortEntry[];
}

export function newSet(name = "Shorts"): ShortsSet {
  const now = Date.now();
  return { version: 1, id: newId(), name, createdAt: now, updatedAt: now, media: {}, clips: [], customLut: null, sourceName: null, music: null, plan: { ...DEFAULT_PLAN, targets: [...DEFAULT_PLAN.targets] }, proxies: {}, shorts: [] };
}

export const serializeSet = (s: ShortsSet) => JSON.stringify({ ...s, updatedAt: Date.now() });

/** A saved set read back with its plan filled in and anything odd corrected; null when the text is not a set. */
export function deserializeSet(json: string): ShortsSet | null {
  try {
    const s = JSON.parse(json) as ShortsSet;
    if (s?.version !== 1 || !s.media || !Array.isArray(s.clips) || !Array.isArray(s.shorts)) return null;
    const base = newSet(s.name);
    const plan: PlanSettings = { ...DEFAULT_PLAN, ...(s.plan ?? {}) };
    plan.targets = Array.isArray(plan.targets) ? (plan.targets.filter((t) => PLATFORM_IDS.includes(t as PlatformId)) as PlatformId[]) : [...DEFAULT_PLAN.targets];
    if (!(plan.seconds > 0)) plan.seconds = DEFAULT_PLAN.seconds;
    if (!(plan.count >= 1)) plan.count = 1;
    if (!(plan.sceneSeconds >= 0.4)) plan.sceneSeconds = DEFAULT_PLAN.sceneSeconds;
    const music = s.music && typeof s.music === "object" && typeof s.music.media === "string" && s.media[s.music.media] ? { media: s.music.media, grid: s.music.grid && Array.isArray(s.music.grid.beats) ? s.music.grid : null } : null;
    return { ...base, ...s, plan, music, proxies: s.proxies ?? {}, shorts: s.shorts.filter((e) => e && typeof e.folder === "string" && typeof e.id === "string") };
  } catch {
    return null;
  }
}

/** The set as the source project the planner reads: the drive's clips with every recording the set knows. */
export function sourceProject(s: ShortsSet): Project {
  return { ...newProject(s.name), id: `${s.id}-source`, media: s.media, clips: s.clips, customLut: s.customLut ?? null, proxies: s.proxies };
}

/** The sub-folder name for a short: numbered so the folder lists them in order, the name made safe for a file system. */
export const shortFolderName = (index: number, name: string) => `${String(index).padStart(2, "0")} ${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Short"}`;

/** What an editor project contributes to a set: its main clips (never the intro's scenes), the LUT and the names. */
export function importEditorProject(s: ShortsSet, p: Project): ShortsSet {
  const main = p.clips.filter((c) => !c.introRole).map((c) => ({ ...c }));
  const media: Record<string, MediaRef> = { ...s.media };
  for (const c of main) if (p.media[c.media]) media[c.media] = { ...p.media[c.media] };
  for (const t of p.music) if (p.media[t.media]) media[t.media] = { ...p.media[t.media] };
  const music = s.music ?? (p.music[0] && p.media[p.music[0].media] ? { media: p.music[0].media, grid: null } : null);
  return { ...s, name: s.shorts.length ? s.name : p.name, sourceName: p.name, media, clips: [...s.clips, ...main], customLut: p.customLut ?? s.customLut ?? null, music, proxies: { ...s.proxies, ...p.proxies } };
}

/** Re-read a saved short's project and keep what the set file knows about it in step. */
export function entryFor(project: Project, folder: string, seconds: number, exported?: ShortEntry["exported"]): ShortEntry {
  return { id: project.id, folder, name: project.name, seconds: +seconds.toFixed(2), scenes: project.clips.length, updatedAt: Date.now(), ...(exported ? { exported } : {}) };
}

export { deserialize as deserializeProject };
