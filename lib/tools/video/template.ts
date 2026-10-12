/**
 * One JSON template for both the intro and the titles: what the video contains, what each part can be, and the
 * current values as worked examples. An LLM fills it in; the import applies both parts at once. A bare titles
 * array or the older titles-only template still import (titles only).
 */
import { INTRO_STYLES, introRegion, introStyle, minSceneSeconds, sceneHandle, sceneSecondsFor, type Moment } from "./intro";
import { HANDLE_MARGIN, clipSpeed, parseTitlesImport, placeClips, titlesTemplate, type IntroSettings, type Project, type Title } from "./project";

export const TEMPLATE_FORMAT = "bench-video-template/2";

/** The intro part of an import: settings, how many scenes to pick when no moments are named, and named moments. */
export interface IntroImport {
  enabled: boolean;
  settings: IntroSettings;
  scenes: number;
  moments: Moment[];
}

const fileKey = (name: string) => name.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, "");

export function videoTemplate(p: Project): Record<string, unknown> {
  const base = titlesTemplate(p) as { instructions: string[]; options: Record<string, unknown>; titles: unknown[] } & Record<string, unknown>;
  const placed = placeClips(p.clips);
  const reg = introRegion(placed);
  // A scene is cut so its moment sits 30 % in (see sceneClip), so the moment is recovered from the scene's own bounds.
  const moments = reg ? reg.scenes.map((s) => ({ file: p.media[s.media]?.name ?? s.media, at: +(s.in + 0.3 * (s.out - s.in)).toFixed(3) })) : [];
  // Where a scene may be centred in each recording so its transitions never run out of footage: the handle (half the
  // style's transition plus the margin) stays inside the recording on both sides of the scene.
  const style = introStyle(p.intro.style);
  const need = Math.max(sceneSecondsFor(p), minSceneSeconds(style)) * style.speed, lead = need * 0.3, h = sceneHandle(style);
  const mainClipsInfo = placed
    .filter((c) => !c.introRole)
    .map((c) => {
      const media = p.media[c.media];
      const lo = Math.max(0, c.in) + h + lead, hi = Math.min(media?.duration ?? c.out, c.out) - h - (need - lead);
      return { file: media?.name ?? c.media, start: +c.start.toFixed(3), end: +c.end.toFixed(3), recordingFrom: +c.in.toFixed(3), recordingTo: +c.out.toFixed(3), momentRange: hi > lo ? [+lo.toFixed(3), +hi.toFixed(3)] : null };
    });
  const project = { ...(base.project as Record<string, unknown>), clips: mainClipsInfo, transitionSeconds: p.transition.duration, handleMarginSeconds: HANDLE_MARGIN };
  return {
    ...base,
    format: TEMPLATE_FORMAT,
    project,
    instructions: [
      "This one file describes both the intro and the titles of a driving video. Fill it in, save it, and import it in the Intro or Titles tab of the Bench video editor (Import JSON): both parts are applied at once.",
      "intro: set enabled to false for no intro. style is the id of one of options.introStyles (each lists its name and look). scenes (1–20) is how many moments are lifted from the drive when moments is empty — the editor then picks lively ones itself. sceneSeconds is seconds per scene (null = the style's own; never shorter than the style's transition plus 0.3 s). card ends the intro: text (empty = the project name), subtitle, and seconds (0 = no card). keepAudio keeps the scenes' own sound instead of playing them quiet under the music. moments, optional, names the exact moments to use, in order: file is one of project.clips files and at is seconds into that recording.",
      "Avoid jumps: a cross dissolve shows the outgoing clip past its end and the incoming clip before its start, so each side of a cut needs its half of the transition plus a margin of handleMarginSeconds inside the recording. Pick every moment's at inside that clip's momentRange (recording seconds): it already leaves the handles and the margin on both sides of the scene; outside it the scene is moved or shortened, and a scene with no room would freeze. Likewise keep a title's start and end at least transitionSeconds / 2 + handleMarginSeconds away from a cut between clips (clips lists start and end on the timeline) unless the title spans the cut entirely.",
      ...base.instructions.slice(1),
    ],
    options: {
      ...base.options,
      introStyles: INTRO_STYLES.map((s) => ({ id: s.id, name: s.name, look: s.hint, sceneSeconds: s.sceneSeconds })),
      introScenesRange: [1, 20],
      introSceneSecondsRange: [0.5, 10],
      introCardSecondsRange: [0, 10],
    },
    intro: {
      enabled: true,
      style: p.intro.style,
      scenes: reg?.scenes.length || 6,
      sceneSeconds: p.intro.sceneSeconds,
      card: { ...p.intro.card },
      keepAudio: p.intro.keepAudio,
      moments,
    },
    titles: base.titles,
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

function parseIntro(raw: unknown, p: Project, warnings: string[]): IntroImport {
  if (raw === false || raw === null) return { enabled: false, settings: p.intro, scenes: 0, moments: [] };
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (r.enabled === false) return { enabled: false, settings: p.intro, scenes: 0, moments: [] };
  const styleText = typeof r.style === "string" ? r.style.trim().toLowerCase() : "";
  const style = INTRO_STYLES.find((s) => s.id === styleText || s.name.toLowerCase() === styleText);
  if (styleText && !style) warnings.push(`intro: style "${String(r.style)}" not understood, kept ${p.intro.style}`);
  let sceneSeconds: number | null = r.sceneSeconds === null ? null : (num(r.sceneSeconds) ?? p.intro.sceneSeconds);
  if (sceneSeconds !== null && (sceneSeconds < 0.5 || sceneSeconds > 10)) {
    warnings.push(`intro: sceneSeconds ${sceneSeconds} is outside 0.5–10, clamped`);
    sceneSeconds = Math.max(0.5, Math.min(10, sceneSeconds));
  }
  const c = r.card && typeof r.card === "object" ? (r.card as Record<string, unknown>) : null;
  let cardSeconds = c ? (num(c.seconds) ?? p.intro.card.seconds) : p.intro.card.seconds;
  if (cardSeconds < 0 || cardSeconds > 10) {
    warnings.push(`intro: card seconds ${cardSeconds} is outside 0–10, clamped`);
    cardSeconds = Math.max(0, Math.min(10, cardSeconds));
  }
  const card = { text: c && typeof c.text === "string" ? c.text.trim() : p.intro.card.text, subtitle: c && typeof c.subtitle === "string" ? c.subtitle.trim() : p.intro.card.subtitle, seconds: cardSeconds };
  const keepAudio = typeof r.keepAudio === "boolean" ? r.keepAudio : p.intro.keepAudio;
  let scenes = Math.round(num(r.scenes) ?? 6);
  if (scenes < 1 || scenes > 20) {
    warnings.push(`intro: scenes ${scenes} is outside 1–20, clamped`);
    scenes = Math.max(1, Math.min(20, scenes));
  }
  const moments: Moment[] = [];
  if (Array.isArray(r.moments)) {
    const main = placeClips(p.clips).filter((cl) => !cl.introRole);
    r.moments.forEach((m, i) => {
      const tag = `intro moment #${i + 1}`;
      const mm = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
      const file = mm && typeof mm.file === "string" ? mm.file : "";
      const at = mm ? num(mm.at) : undefined;
      if (!file || at === undefined) return void warnings.push(`${tag}: needs file and at, skipped`);
      const mediaId = Object.keys(p.media).find((id) => fileKey(p.media[id].name) === fileKey(file));
      if (!mediaId) return void warnings.push(`${tag}: no recording called "${file}", skipped`);
      const clips = main.filter((cl) => cl.media === mediaId);
      if (!clips.length) return void warnings.push(`${tag}: "${file}" is not on the timeline, skipped`);
      let clip = clips.find((cl) => at >= cl.in && at <= cl.out);
      let sourceTime = at;
      if (!clip) {
        clip = clips[0];
        sourceTime = Math.max(clip.in, Math.min(clip.out, at));
        warnings.push(`${tag}: ${at} s is outside the part of "${file}" on the timeline, moved to ${sourceTime.toFixed(1)} s`);
      }
      moments.push({ clipId: clip.id, sourceTime, timelineT: clip.start + (sourceTime - clip.in) / clipSpeed(clip) });
    });
  }
  return { enabled: true, settings: { style: style?.id ?? p.intro.style, sceneSeconds, card, keepAudio }, scenes, moments };
}

/** Read a filled template: titles (as before) and, when the file has an intro section, the intro. */
export function parseTemplateImport(text: string, p: Project): { titles: Title[]; intro: IntroImport | null; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const hasTitles = Array.isArray(data) || (!!obj && Array.isArray(obj.titles));
  const hasIntro = !!obj && "intro" in obj;
  if (!hasTitles && !hasIntro) throw new Error("Expected the template's intro section and/or a titles array — the shape of the downloaded template.");
  const warnings: string[] = [];
  let titles: Title[] = [];
  if (hasTitles) {
    const r = parseTitlesImport(text, p);
    titles = r.titles;
    warnings.push(...r.warnings);
  }
  const intro = hasIntro ? parseIntro(obj!.intro, p, warnings) : null;
  return { titles, intro, warnings };
}
