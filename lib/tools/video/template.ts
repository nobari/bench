/**
 * One JSON template for the intro, the titles and the labels: what the video contains, what each part can be, and
 * the current values as worked examples. An LLM fills it in; the import applies every part the file carries. A bare
 * titles array, the older titles-only template and the template from before labels (format /2) still import.
 */
import { INTRO_STYLES, introRegion, introStyle, minSceneSeconds, sceneHandle, sceneSecondsFor, type Moment } from "./intro";
import { DEFAULT_LABEL, HANDLE_MARGIN, INTRO_OUTROS, LABEL_ART_TYPES, LABEL_ENTERS, LABEL_LOOPS, LABEL_OFFSET_RANGE, LABEL_WIDTH_RANGE, MAX_ART_BYTES, MIN_LABEL_SECONDS, TITLE_EXITS, TITLE_POSITIONS, artBytes, artKey, cardSettings, clipSpeed, isCssColor, normalizeLabel, parseTitlesImport, placeClips, timelineDuration, titlesTemplate, uniqueArtName, type IntroCard, type IntroOutro, type IntroSettings, type Label, type LabelArt, type LabelArtType, type LabelEnter, type LabelLoop, type Project, type Title, type TitleExit, type TitlePosition } from "./project";

export const TEMPLATE_FORMAT = "bench-video-template/3";

/** The labels part of an import: the labels, and the art they brought with them (by key, to merge into the project's). */
export interface LabelsImport {
  labels: Label[];
  art: Record<string, LabelArt>;
}

/** SVG markup up to this length is written into the template as it is; longer art is named with "existing:<name>". */
export const TEMPLATE_INLINE_SVG = 4000;
const EXISTING = "existing:";

/** What the template tells an LLM about labels. */
export const LABELS_INSTRUCTION =
  "labels: pictures laid over the video — a logo, a badge, a sticker, an arrow, an animated GIF. Each label gives its art in exactly one of three ways. svg: the SVG markup itself as one string, starting <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 W H\"> (the viewBox gives its shape); it is drawn as a still, as sharp as the video, so use shapes, paths, gradients and text in common fonts — scripts, linked images or fonts and the SVG's own animation are not run. image: a data URI in base64, data:image/png;base64,… (png, jpeg, webp or gif, at most 2 MB decoded); an animated GIF, PNG or WebP plays with its own frame delays. art: \"existing:<name>\" to use a picture the project already has (project.art lists them by name), as many times as needed. Web addresses are not loaded. The rest: name; start and duration in seconds; position — as for titles — then offsetX and offsetY to move it from there (fractions of the frame's width and height, positive is right and down, −1 to 1); width — a fraction of the frame's width, 0.02 to 1, the height following the art's shape; opacity 0 to 1; rotate in degrees clockwise, −180 to 180; fade — seconds the entrance and the exit each take; enter — one of options.labelEnters; exit — one of options.exits (none is a cut); loop — loop or once, for animated art (once holds the last frame). Labels are drawn over the titles and move with the same entrances and exits. Remove the labels key to leave the project's labels as they are.";

const EXAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><rect width="240" height="80" rx="40" fill="#e5484d"/><text x="120" y="55" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#ffffff">NEW</text></svg>';

/** The labels section of the template: the options, the art the project has, and the current labels (or one example). */
export function labelsTemplate(p: Project): { options: Record<string, unknown>; art: unknown[]; labels: unknown[] } {
  const labels = p.labels ?? [];
  const artName = (l: Label) => (l.art ? p.art?.[l.art]?.name : p.media[l.media ?? ""]?.name) ?? "";
  const seen = new Set<string>();
  const art: unknown[] = [];
  for (const l of labels) {
    const key = l.art ?? l.media ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    const a = l.art ? p.art?.[l.art] : undefined, m = l.media ? p.media[l.media] : undefined;
    const width = a?.width ?? m?.width, height = a?.height ?? m?.height;
    art.push({ name: artName(l), ...(a ? { type: a.type } : {}), ...(m ? { file: true } : {}), ...(width && height ? { width, height } : {}), ...(a?.seconds ? { animatedSeconds: +a.seconds.toFixed(3) } : {}) });
  }
  const r3 = (v: number) => +v.toFixed(3);
  return {
    options: {
      labelEnters: LABEL_ENTERS,
      labelLoops: LABEL_LOOPS,
      labelWidthRange: LABEL_WIDTH_RANGE,
      labelOffsetRange: LABEL_OFFSET_RANGE,
      labelOpacityRange: [0, 1],
      labelRotateRange: [-180, 180],
      labelImageTypes: LABEL_ART_TYPES,
      labelImageMaxBytes: MAX_ART_BYTES,
    },
    art,
    labels: labels.length
      ? labels.map((l) => {
          const a = l.art ? p.art?.[l.art] : undefined;
          const source = a?.type === "image/svg+xml" && a.data.length <= TEMPLATE_INLINE_SVG ? { svg: a.data } : { art: `${EXISTING}${artName(l)}` };
          return { name: l.name ?? artName(l), ...source, start: r3(l.start), duration: r3(l.duration), fade: r3(l.fade), position: l.position, offsetX: l.offsetX, offsetY: l.offsetY, width: l.width, opacity: l.opacity, rotate: l.rotate, enter: l.enter ?? "fade", exit: l.exit ?? "fade", loop: l.loop ?? "loop" };
        })
      : [{ name: "Example badge", svg: EXAMPLE_SVG, start: 2, duration: 5, fade: DEFAULT_LABEL.fade, position: "tr", offsetX: 0, offsetY: 0, width: 0.14, opacity: 1, rotate: 0, enter: "pop", exit: "fade", loop: "loop" }],
  };
}

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
  const labelsPart = labelsTemplate(p);
  const project = { ...(base.project as Record<string, unknown>), clips: mainClipsInfo, transitionSeconds: p.transition.duration, handleMarginSeconds: HANDLE_MARGIN, art: labelsPart.art };
  return {
    ...base,
    format: TEMPLATE_FORMAT,
    project,
    instructions: [
      "This one file describes the intro, the titles and the labels (pictures) of a video. Fill it in, save it, and import it in the Intro or Titles tab of the Bench video editor (Import JSON): every part the file carries is applied at once.",
      "intro: set enabled to false for no intro. style is the id of one of options.introStyles (each lists its name and look). scenes (1–20) is how many moments are lifted from the footage when moments is empty — the editor then picks lively ones itself. sceneSeconds is seconds per scene (null = the style's own; never shorter than the style's transition plus 0.3 s). card ends the intro: enabled (false = no card), text (empty = the project name), subtitle, seconds (0 = no card), position (tl tc tr ml mc mr bl bc br), font (sans, serif, mono, rounded or a font family name), color (#rrggbb), size (title height as a fraction of the frame height, 0.04–0.2), dim (how dark the footage goes under the title, 0–0.9), blur (true softens the footage), caps (true sets the subtitle in spaced capitals) and fade (seconds the title takes to rise in). outro is how the intro hands over to the video: look (the look's own transition) or open (the title fades and the letterbox bars slide away over a dissolve into the video). keepAudio keeps the scenes' own sound instead of playing them quiet under the music. moments, optional, names the exact moments to use, in order: file is one of project.clips files and at is seconds into that recording.",
      "Avoid jumps: a cross dissolve shows the outgoing clip past its end and the incoming clip before its start, so each side of a cut needs its half of the transition plus a margin of handleMarginSeconds inside the recording. Pick every moment's at inside that clip's momentRange (recording seconds): it already leaves the handles and the margin on both sides of the scene; outside it the scene is moved or shortened, and a scene with no room would freeze. Likewise keep a title's start and end at least transitionSeconds / 2 + handleMarginSeconds away from a cut between clips (clips lists start and end on the timeline) unless the title spans the cut entirely.",
      ...base.instructions.slice(1, -1),
      LABELS_INSTRUCTION,
      ...base.instructions.slice(-1),
    ],
    options: {
      ...base.options,
      introStyles: INTRO_STYLES.map((s) => ({ id: s.id, name: s.name, look: s.hint, sceneSeconds: s.sceneSeconds })),
      introScenesRange: [1, 20],
      introSceneSecondsRange: [0.5, 10],
      introCardSecondsRange: [0, 10],
      introCardPositions: TITLE_POSITIONS,
      introCardSizeRange: [0.04, 0.2],
      introCardDimRange: [0, 0.9],
      introCardFadeRange: [0, 2],
      introOutros: INTRO_OUTROS,
      ...labelsPart.options,
    },
    intro: {
      enabled: true,
      style: p.intro.style,
      scenes: reg?.scenes.length || 6,
      sceneSeconds: p.intro.sceneSeconds,
      card: cardSettings(p.intro.card),
      outro: p.intro.outro ?? "look",
      keepAudio: p.intro.keepAudio,
      moments,
    },
    titles: base.titles,
    labels: labelsPart.labels,
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
  const was = cardSettings(p.intro.card);
  const card: IntroCard = { ...p.intro.card, text: c && typeof c.text === "string" ? c.text.trim() : p.intro.card.text, subtitle: c && typeof c.subtitle === "string" ? c.subtitle.trim() : p.intro.card.subtitle, seconds: cardSeconds };
  if (r.card === false) card.enabled = false;
  if (c) {
    if (typeof c.enabled === "boolean") card.enabled = c.enabled;
    if (c.position !== undefined) {
      if (typeof c.position === "string" && TITLE_POSITIONS.includes(c.position as TitlePosition)) card.position = c.position as TitlePosition;
      else warnings.push(`intro: card position "${String(c.position)}" not understood, kept ${was.position}`);
    }
    if (typeof c.font === "string" && c.font.trim()) card.font = c.font.trim();
    if (c.color !== undefined) {
      if (isCssColor(c.color)) card.color = c.color;
      else warnings.push(`intro: card colour "${String(c.color)}" not understood, kept ${was.color}`);
    }
    const ranged = (key: "size" | "dim" | "fade", lo: number, hi: number) => {
      const v = num(c[key]);
      if (c[key] === undefined) return;
      if (v === undefined) return void warnings.push(`intro: card ${key} "${String(c[key])}" is not a number, kept ${was[key]}`);
      if (v < lo || v > hi) warnings.push(`intro: card ${key} ${v} is outside ${lo}–${hi}, clamped`);
      card[key] = Math.max(lo, Math.min(hi, v));
    };
    ranged("size", 0.04, 0.2);
    ranged("dim", 0, 0.9);
    ranged("fade", 0, 2);
    if (typeof c.blur === "boolean") card.blur = c.blur;
    if (typeof c.caps === "boolean") card.caps = c.caps;
  }
  let outro: IntroOutro = p.intro.outro ?? "look";
  if (r.outro !== undefined) {
    const o = typeof r.outro === "string" ? r.outro.trim().toLowerCase() : "";
    if (INTRO_OUTROS.includes(o as IntroOutro)) outro = o as IntroOutro;
    else warnings.push(`intro: outro "${String(r.outro)}" not understood (look or open), kept ${outro}`);
  }
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
  return { enabled: true, settings: { style: style?.id ?? p.intro.style, sceneSeconds, card, keepAudio, outro }, scenes, moments };
}

const SNIFF: [LabelArtType, (b: string) => boolean][] = [
  ["image/png", (b) => b.startsWith("\x89PNG")],
  ["image/gif", (b) => b.startsWith("GIF8")],
  ["image/jpeg", (b) => b.startsWith("\xff\xd8\xff")],
  ["image/webp", (b) => b.startsWith("RIFF") && b.slice(8, 12) === "WEBP"],
];
const looksSvg = (s: string) => /<svg[\s>]/i.test(s);
const utf8 = (binary: string) => new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));

/** One picture from a template entry: SVG markup, a data URI or bare base64. Says why not when it cannot be used. */
export function parseArtSource(value: string): Pick<LabelArt, "type" | "data"> | string {
  const v = value.trim();
  if (!v) return "empty";
  if (/^(https?:)?\/\//i.test(v)) return "web addresses are not loaded — give the SVG markup or a base64 data URI";
  if (looksSvg(v) && !/^data:/i.test(v)) {
    const markup = v.slice(v.search(/<svg[\s>]/i));
    if (!/<\/svg>\s*$/i.test(markup) && !/^<svg[^>]*\/>\s*$/i.test(markup)) return "the SVG is cut short (no closing </svg>)";
    const data = /<svg\b[^>]*\sxmlns\s*=/.test(markup) ? markup : markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return data.length > MAX_ART_BYTES ? `the SVG is over ${MAX_ART_BYTES / 1024 / 1024} MB` : { type: "image/svg+xml", data };
  }
  let body = v, declared = "", base64 = true;
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(v);
  if (m) {
    declared = m[1].toLowerCase();
    base64 = /;base64/i.test(m[2]);
    body = m[3];
  }
  if (declared === "image/svg+xml") {
    let markup: string;
    try {
      markup = base64 ? utf8(atob(body.replace(/\s+/g, ""))) : decodeURIComponent(body);
    } catch {
      return "the SVG data URI could not be decoded";
    }
    return looksSvg(markup) ? parseArtSource(markup) : "the data URI holds no SVG";
  }
  if (!base64) return "the image must be base64 (data:image/png;base64,…)";
  const b64 = body.replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) return "the image is not valid base64";
  let head: string;
  try {
    head = atob(b64.slice(0, 24));
  } catch {
    return "the image is not valid base64";
  }
  const type = SNIFF.find(([, is]) => is(head))?.[0];
  if (!type) return `the data is not a PNG, JPEG, WebP or GIF${declared ? ` (it says ${declared})` : ""}`;
  const padded = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
  if (artBytes({ type, data: padded }) > MAX_ART_BYTES) return `the image is over ${MAX_ART_BYTES / 1024 / 1024} MB`;
  return { type, data: padded };
}

/** Read the labels of a filled template. Bad entries are skipped and odd values corrected, each with a note. */
export function parseLabelsImport(raw: unknown, p: Project, warnings: string[]): LabelsImport {
  const out: LabelsImport = { labels: [], art: {} };
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) warnings.push("labels: expected an array, left the labels alone");
    return out;
  }
  const total = timelineDuration(p);
  // The pictures the project has, by the names a template may use for them: the art's name, the file's, a label's own.
  const existing = new Map<string, { art: string } | { media: string }>();
  for (const l of p.labels ?? []) {
    const src = l.art ? { art: l.art } : { media: l.media! };
    for (const name of [l.name, l.art ? p.art?.[l.art]?.name : p.media[l.media ?? ""]?.name]) if (name && !existing.has(name.toLowerCase())) existing.set(name.toLowerCase(), src);
  }
  for (const [key, a] of Object.entries(p.art ?? {})) existing.set(a.name.toLowerCase(), { art: key });
  const names = new Set(Object.values(p.art ?? {}).map((a) => a.name));
  raw.forEach((entry, i) => {
    const r = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const name = r && typeof r.name === "string" ? r.name.trim() : "";
    const tag = `label #${i + 1}${name ? ` "${name}"` : ""}`;
    if (!r) return void warnings.push(`${tag}: not an object, skipped`);
    let source: { art: string } | { media: string } | null = null;
    const ref = typeof r.art === "string" ? r.art.trim() : "";
    const given = typeof r.svg === "string" && r.svg.trim() ? r.svg : typeof r.image === "string" && r.image.trim() ? r.image : ref && !ref.toLowerCase().startsWith(EXISTING) && (looksSvg(ref) || /^data:/i.test(ref)) ? ref : "";
    if (given) {
      const parsed = parseArtSource(given);
      if (typeof parsed === "string") return void warnings.push(`${tag}: ${parsed}, skipped`);
      const key = artKey(parsed.type, parsed.data);
      if (!p.art?.[key] && !out.art[key]) {
        const artName = uniqueArtName(names, name || `art ${Object.keys(out.art).length + 1}`);
        names.add(artName);
        out.art[key] = { name: artName, ...parsed };
      }
      source = { art: key };
    } else if (ref) {
      const wanted = ref.toLowerCase().startsWith(EXISTING) ? ref.slice(EXISTING.length).trim() : ref;
      source = existing.get(wanted.toLowerCase()) ?? null;
      if (!source) return void warnings.push(`${tag}: the project has no picture called "${wanted}", skipped`);
    } else return void warnings.push(`${tag}: no art — give svg, image or art, skipped`);
    let start = Math.max(0, num(r.start) ?? 0);
    let duration = num(r.duration) ?? DEFAULT_LABEL.duration;
    if (duration < MIN_LABEL_SECONDS) {
      warnings.push(`${tag}: duration under ${MIN_LABEL_SECONDS} s, raised to ${MIN_LABEL_SECONDS}`);
      duration = MIN_LABEL_SECONDS;
    }
    if (total > 0 && start >= total) {
      warnings.push(`${tag}: starts after the end of the video (${start} s), moved to the last ${Math.min(duration, total)} s`);
      start = Math.max(0, total - duration);
    }
    if (total > 0 && start + duration > total) duration = Math.max(MIN_LABEL_SECONDS, total - start);
    const ranged = (key: "offsetX" | "offsetY" | "width" | "opacity" | "rotate" | "fade", lo: number, hi: number): number | undefined => {
      if (r[key] === undefined || r[key] === null) return undefined;
      const v = num(r[key]);
      if (v === undefined) return void warnings.push(`${tag}: ${key} "${String(r[key])}" is not a number, used the default`);
      if (v < lo || v > hi) warnings.push(`${tag}: ${key} ${v} is outside ${lo} to ${hi}, clamped`);
      return Math.min(hi, Math.max(lo, v));
    };
    const oneOf = <T extends string>(key: string, list: readonly T[], fallback: string): T | undefined => {
      const v = r[key];
      if (v === undefined || v === null) return undefined;
      if (typeof v === "string" && list.includes(v.trim() as T)) return v.trim() as T;
      return void warnings.push(`${tag}: ${key} "${String(v)}" not understood, used ${fallback}`);
    };
    const label = normalizeLabel({
      ...source,
      ...(name ? { name } : {}),
      start: Math.round(start * 1e3) / 1e3,
      duration: Math.round(duration * 1e3) / 1e3,
      fade: ranged("fade", 0, 5),
      position: oneOf<TitlePosition>("position", TITLE_POSITIONS, DEFAULT_LABEL.position),
      offsetX: ranged("offsetX", LABEL_OFFSET_RANGE[0], LABEL_OFFSET_RANGE[1]),
      offsetY: ranged("offsetY", LABEL_OFFSET_RANGE[0], LABEL_OFFSET_RANGE[1]),
      width: ranged("width", LABEL_WIDTH_RANGE[0], LABEL_WIDTH_RANGE[1]),
      opacity: ranged("opacity", 0, 1),
      rotate: ranged("rotate", -180, 180),
      enter: oneOf<LabelEnter>("enter", LABEL_ENTERS, "fade"),
      exit: oneOf<TitleExit>("exit", TITLE_EXITS, "fade"),
      loop: oneOf<LabelLoop>("loop", LABEL_LOOPS, "loop"),
      safe: r.safe === false ? false : undefined,
    } as Partial<Label>);
    if (label) out.labels.push(label);
  });
  return out;
}

/** Read a filled template: titles (as before), the intro when the file has an intro section, the labels when it has a labels one. */
export function parseTemplateImport(text: string, p: Project): { titles: Title[]; intro: IntroImport | null; labels: LabelsImport | null; warnings: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const hasTitles = Array.isArray(data) || (!!obj && Array.isArray(obj.titles));
  const hasIntro = !!obj && "intro" in obj;
  const hasLabels = !!obj && "labels" in obj;
  if (!hasTitles && !hasIntro && !hasLabels) throw new Error("Expected the template's intro section, a titles array or a labels array — the shape of the downloaded template.");
  const warnings: string[] = [];
  let titles: Title[] = [];
  if (hasTitles) {
    const r = parseTitlesImport(text, p);
    titles = r.titles;
    warnings.push(...r.warnings);
  }
  const intro = hasIntro ? parseIntro(obj!.intro, p, warnings) : null;
  const labels = hasLabels ? parseLabelsImport(obj!.labels, p, warnings) : null;
  return { titles, intro, labels, warnings };
}
