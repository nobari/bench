/**
 * Shorts, Reels and TikTok: what each platform takes and shows, as published (YouTube's and Meta's help pages; TikTok's
 * figures are the commonly reported ones, since its organic limits are not on a page we could reach), the part of the
 * frame their buttons leave visible, the warnings an export deserves before it is wasted, and the words that go with a
 * post. Pure.
 */

import type { PreflightItem } from "./preflight";
import { fmtTime, type Project, type SafeArea } from "./project";

export type PlatformId = "shorts" | "reels" | "tiktok";
export const PLATFORM_IDS: PlatformId[] = ["shorts", "reels", "tiktok"];

export interface Platform {
  id: PlatformId;
  name: string;
  /** Seconds past which the platform refuses the file, or stops treating it as a short. */
  maxSeconds: number;
  /** Where the platform's own guidance and its feed favour a short's length, in seconds. */
  sweet: [number, number];
  /** What the limit means, in a sentence. */
  limitNote: string;
  /** The part of the frame the platform's buttons, captions and title leave visible. */
  safe: SafeArea;
  /** The lowest frame rate the platform asks for, when it names one. */
  minFps?: number;
  /** A file size past which uploads are reported to fail or stall. */
  maxBytes?: number;
  /** Whether the figures come from the platform's own pages. */
  official: boolean;
  /** Hashtags the platform's search leans on. */
  tags: string[];
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  shorts: {
    id: "shorts",
    name: "YouTube Shorts",
    maxSeconds: 180,
    sweet: [15, 60],
    limitNote: "YouTube lists any square or vertical upload up to 3 minutes as a Short; in the Shorts feed an ad plays only its first 60 seconds",
    // Google's margins for vertical ads that run in Shorts: 288 and 672 px of 1920 above and below, 48 and 192 px of 1080 at the sides.
    safe: { top: 0.15, bottom: 0.35, left: 0.045, right: 0.18 },
    official: true,
    tags: ["#shorts"],
  },
  reels: {
    id: "reels",
    name: "Instagram Reels",
    maxSeconds: 180,
    sweet: [15, 90],
    limitNote: "Instagram takes reels up to 20 minutes but says one over 3 minutes reaches fewer new viewers; a boosted reel stops at 90 seconds",
    // Meta's safe zone for Reels: the top 14 %, the bottom 35 % and 6 % at each side.
    safe: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 },
    minFps: 30,
    official: true,
    tags: ["#reels", "#reelsinstagram"],
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    maxSeconds: 600,
    sweet: [9, 60],
    limitNote: "reported, not from a TikTok page: finished videos up to 10 minutes through its posting API, 1080×1920 H.264 with AAC sound",
    safe: { top: 0.12, bottom: 0.3, left: 0.06, right: 0.14 },
    maxBytes: 500e6,
    official: false,
    tags: ["#fyp", "#tiktok"],
  },
};

/** The part of the frame every chosen platform leaves visible — the largest clear on each side; null for none chosen. */
export function safeAreaFor(ids: PlatformId[]): SafeArea | null {
  const chosen = ids.map((id) => PLATFORMS[id]).filter(Boolean);
  if (!chosen.length) return null;
  const side = (k: keyof SafeArea) => Math.max(...chosen.map((p) => p.safe[k]));
  return { top: side("top"), bottom: side("bottom"), left: side("left"), right: side("right") };
}

/** The shortest of the chosen platforms' limits, and the length they all favour. */
export function lengthFor(ids: PlatformId[]): { max: number; sweet: [number, number] } {
  const chosen = ids.map((id) => PLATFORMS[id]).filter(Boolean);
  if (!chosen.length) return { max: 180, sweet: [15, 60] };
  return { max: Math.min(...chosen.map((p) => p.maxSeconds)), sweet: [Math.max(...chosen.map((p) => p.sweet[0])), Math.min(...chosen.map((p) => p.sweet[1]))] };
}

/** The length choices offered, in seconds. */
export const SHORT_LENGTHS = [15, 30, 45, 60, 90, 180];

export interface ShortEnv {
  /** The export's length in seconds, frame rate and expected size. */
  seconds: number;
  fps: number;
  bytes: number;
  /** When the first title starts, if any; null for no title. */
  firstTitleAt: number | null;
  /** When the first cut comes, in seconds; null when there is one scene. */
  firstCutAt: number | null;
  /** Whether a music track plays, and whether any camera sound is heard. */
  music: boolean;
  cameraSound: boolean;
}

const fmtMb = (n: number) => (n < 1e9 ? `${Math.round(n / 1e6)} MB` : `${(n / 1e9).toFixed(1)} GB`);

/**
 * What the chosen platforms will do with this export, as pre-flight items: the frame's shape, its length against each
 * platform's limit and sweet spot, the frame rate, the size, and the things that lose viewers in the first seconds —
 * no hook text, a first cut that comes late, no sound.
 */
export function shortLimits(project: Project, ids: PlatformId[], env: ShortEnv): PreflightItem[] {
  const items: PreflightItem[] = [];
  const chosen = ids.map((id) => PLATFORMS[id]).filter(Boolean);
  if (!chosen.length) return items;
  const names = chosen.map((p) => p.name);
  const frame = project.export.frame ?? "source";
  if (frame === "9:16") items.push({ id: "short-frame", state: "ok", title: `Vertical 9:16 — the frame ${names.join(", ")} fill the screen with` });
  else if (frame === "1:1" || frame === "4:5") items.push({ id: "short-frame", state: "info", title: `${frame} frame: shown with bars on ${names.join(", ")}`, detail: "YouTube still lists a square upload as a Short; a 9:16 frame fills the phone's screen.", actions: [{ id: "set-frame:9:16", label: "Use 9:16" }] });
  else items.push({ id: "short-frame", state: "warn", title: "The frame is the recording's own, not vertical", detail: "YouTube treats a 16:9 upload as a regular video, not a Short, and Reels and TikTok letterbox it. Set the frame to 9:16 and place the window per clip in Crop.", actions: [{ id: "set-frame:9:16", label: "Use 9:16" }] });

  const over = chosen.filter((p) => env.seconds > p.maxSeconds);
  const past = chosen.filter((p) => env.seconds <= p.maxSeconds && env.seconds > p.sweet[1]);
  if (over.length) items.push({ id: "short-length", state: "warn", title: `${fmtTime(env.seconds)} is over ${over.map((p) => `${p.name}'s ${fmtTime(p.maxSeconds)}`).join(" and ")}`, detail: over.map((p) => p.limitNote).join(". ") + ".", actions: [{ id: "open-range", label: "Shorten the range" }] });
  else if (past.length) items.push({ id: "short-length", state: "info", title: `${fmtTime(env.seconds)}: longer than the ${past.map((p) => `${fmtTime(p.sweet[1])} ${p.name}`).join(" and ")} favour`, detail: "Within the limits; shorter shorts are watched to the end more often, which is what the feeds reward." });
  else if (env.seconds > 0) items.push({ id: "short-length", state: "ok", title: `${fmtTime(env.seconds)}: inside every chosen platform's limit${chosen.every((p) => env.seconds >= p.sweet[0]) ? " and sweet spot" : ""}` });

  const slow = chosen.filter((p) => p.minFps && env.fps < p.minFps);
  if (slow.length) items.push({ id: "short-fps", state: "warn", title: `${env.fps} fps is below the ${slow.map((p) => `${p.minFps} fps ${p.name} asks for`).join(", ")}` });

  const big = chosen.filter((p) => p.maxBytes && env.bytes > p.maxBytes);
  if (big.length) items.push({ id: "short-size", state: "info", title: `About ${fmtMb(env.bytes)}: ${big.map((p) => `${p.name} is reported to want under ${fmtMb(p.maxBytes!)}`).join("; ")}`, actions: [{ id: "set-bitrate:12", label: "Use 12 Mbps" }] });

  if (env.seconds > 0) {
    if (env.firstTitleAt === null) items.push({ id: "short-hook", state: "info", title: "No hook text in the opening", detail: "A line in the first second or two tells a scrolling viewer what they are about to see; most drive shorts that are watched through open with one.", actions: [{ id: "add-hook", label: "Add a hook" }] });
    else if (env.firstTitleAt > 2) items.push({ id: "short-hook", state: "info", title: `The first text comes at ${fmtTime(env.firstTitleAt)}`, detail: "The first two seconds decide whether a viewer stays; a hook belongs there.", actions: [{ id: "add-hook", label: "Add a hook at 0:00" }] });
    else items.push({ id: "short-hook", state: "ok", title: `A hook opens the short at ${fmtTime(env.firstTitleAt)}` });
    if (env.firstCutAt !== null && env.firstCutAt > 4) items.push({ id: "short-cut", state: "info", title: `The first cut comes at ${fmtTime(env.firstCutAt)}`, detail: "Shorts that hold attention change the picture every two to four seconds; the Plan step cuts on the beat." });
    if (!env.music && !env.cameraSound) items.push({ id: "short-sound", state: "warn", title: "No sound at all", detail: "Reels and TikTok play with sound on and rank silent posts lower; add music or keep the camera sound." });
    else if (!env.music) items.push({ id: "short-sound", state: "info", title: "Camera sound only — no music", detail: "Fine for adding a trending sound in the app; for a finished post, music carries a drive short." });
  }
  return items;
}

/** Hashtags for a drive short: the platform's own, the subject, and the user's words as tags. */
export function hashtagsFor(ids: PlatformId[], words: string[] = []): string[] {
  const tags = new Set<string>();
  for (const id of ids) for (const t of PLATFORMS[id]?.tags ?? []) tags.add(t);
  for (const t of ["#drive", "#roadtrip", "#dashcam", "#nightdrive", "#8k", "#pov"]) tags.add(t);
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (clean.length > 1) tags.add(`#${clean}`);
  }
  return [...tags];
}

export interface PostCopy {
  title: string;
  description: string;
  hashtags: string[];
  /** The whole thing, ready to paste. */
  text: string;
}

/**
 * The words for a post: a title from the short's name, a description that says what and where, and the hashtags.
 * `part` numbers a short in a series; `places` are words from the titles and the name.
 */
export function postCopy(project: Project, ids: PlatformId[], opts: { part?: { index: number; of: number }; words?: string[]; seconds?: number } = {}): PostCopy {
  const name = project.name.trim() || "Drive";
  const hook = project.titles.find((t) => t.kind === "hook")?.text.trim();
  const title = `${hook && hook.toLowerCase() !== name.toLowerCase() ? `${hook} — ` : ""}${name}${opts.part && opts.part.of > 1 ? ` (${opts.part.index} of ${opts.part.of})` : ""}`;
  const captions = project.titles.filter((t) => t.kind === "caption" || t.kind === "lowerThird").map((t) => t.text.trim()).filter(Boolean);
  const lines = [opts.seconds ? `${fmtTime(opts.seconds)} from the drive${captions.length ? `: ${captions.slice(0, 3).join(" · ")}` : "."}` : captions.length ? captions.slice(0, 3).join(" · ") : ""].filter(Boolean);
  const words = [...(opts.words ?? []), ...name.split(/\s+/)];
  const hashtags = hashtagsFor(ids, words);
  const description = lines.join("\n");
  return { title, description, hashtags, text: [title, description, hashtags.join(" ")].filter(Boolean).join("\n\n") };
}

/** What to remember when posting, per platform, as the Post step lists them. */
export function postingNotes(ids: PlatformId[]): string[] {
  const notes: string[] = [];
  for (const id of ids) {
    const p = PLATFORMS[id];
    if (id === "shorts") notes.push("YouTube: upload the vertical file like any video; it is listed as a Short by its shape and length — no #shorts tag needed, though it does no harm. The first frame is the default cover; pick a frame in YouTube Studio or upload the cover saved here.");
    if (id === "reels") notes.push("Instagram: post from the app with the file in the camera roll; pick the cover from the frames or the cover saved here, and add a trending sound in the app to the music-free version if you want the reach its sounds bring.");
    if (id === "tiktok") notes.push("TikTok: the web uploader takes bigger files than the apps; add a sound in the app for the music-free version, and write the caption and hashtags there — the first line shows in the feed.");
    void p;
  }
  return notes;
}
